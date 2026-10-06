import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { assertBatchAllowed, assertRequestAllowed, EMPTY_POLICY, type AllowedRequest, type BatchItem, type ObsPolicy } from './allowlist';
import { LOOPBACK_HOST } from '../config';
import type { Logger } from '../log';

/**
 * An obs-websocket v5 client, written for this job: loopback only, a typed allow-list in front of EVERY request (and every request in a batch), and
 * a reconnect loop that never gives up (1, 2, 5, 10 s, then every 10 s) and tells its owner each time it has (re)identified so the controller can reconcile.
 * Protocol: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 */

/** secret = base64(sha256(password + salt)); auth = base64(sha256(secret + challenge)). */
export function obsAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash('sha256').update(password + salt).digest('base64');
  return createHash('sha256').update(secret + challenge).digest('base64');
}

/** Event subscription bits (EventSubscription in the protocol). */
export const Sub = { General: 1, Config: 2, Scenes: 4, Inputs: 8, Transitions: 16, Filters: 32, Outputs: 64, SceneItems: 128, MediaInputs: 256, Vendors: 512, Ui: 1024, InputVolumeMeters: 1 << 16 } as const;
/** What the Companion listens to. The meter bit is the high-volume one: used only to tell "mic quiet / speaking"; raw levels never leave the laptop. */
export const SUBSCRIPTIONS_BASE = Sub.General | Sub.Scenes | Sub.Inputs | Sub.Outputs | Sub.Filters | Sub.MediaInputs;
export const SUBSCRIPTIONS_WITH_METERS = SUBSCRIPTIONS_BASE | Sub.InputVolumeMeters;

export const BACKOFF_MS = [1000, 2000, 5000, 10_000] as const;

export type ObsConnState = 'stopped' | 'connecting' | 'authenticating' | 'identified' | 'waiting';
export interface ObsEvent { eventType: string; eventIntent?: number; eventData?: Record<string, unknown> }
export class ObsRequestFailed extends Error {
  constructor(readonly requestType: string, readonly status: number, comment?: string) { super(`OBS answered ${requestType} with code ${status}${comment ? `: ${comment}` : ''}`); this.name = 'ObsRequestFailed'; }
}
export class ObsNotConnected extends Error { constructor(msg = 'OBS is not connected') { super(msg); this.name = 'ObsNotConnected'; } }

export interface ObsClientOptions {
  port: number;
  /** Always this laptop. Anything else is refused at construction. */
  host?: string;
  getPassword: () => Promise<string | null>;
  policy: () => ObsPolicy;
  logger: Logger;
  meters?: () => boolean;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  backoffMs?: readonly number[];
}

type Pending = { type: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
export interface ObsClientEvents {
  state: [ObsConnState, string];
  identified: [{ obsVersion: string; obsWebSocketVersion: string }];
  closed: [string];
  event: [ObsEvent];
}

export class ObsClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private stopped = true;
  private attempt = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;
  state: ObsConnState = 'stopped';
  /** Why the last attempt failed, in plain words (for the screen). */
  lastProblem: string | null = null;
  version: { obsVersion: string; obsWebSocketVersion: string } | null = null;
  private readonly host: string;
  private readonly opts: Required<Omit<ObsClientOptions, 'host' | 'meters'>> & { meters: () => boolean };

  constructor(o: ObsClientOptions) {
    super();
    const host = o.host ?? LOOPBACK_HOST;
    if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('the Companion only ever connects to OBS on this laptop (127.0.0.1)');
    this.host = host;
    this.opts = { requestTimeoutMs: 5000, handshakeTimeoutMs: 5000, backoffMs: BACKOFF_MS, meters: () => false, ...o };
  }

  on<K extends keyof ObsClientEvents>(event: K, fn: (...a: ObsClientEvents[K]) => void): this { return super.on(event, fn as (...a: unknown[]) => void); }
  emit<K extends keyof ObsClientEvents>(event: K, ...a: ObsClientEvents[K]): boolean { return super.emit(event, ...a); }

  get connected(): boolean { return this.state === 'identified'; }
  private setState(s: ObsConnState, why = ''): void { if (s !== this.state || why) { this.state = s; this.emit('state', s, why); } }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.wake?.();
    this.ws?.terminate();
    this.failAll(new ObsNotConnected('stopping'));
    this.setState('stopped');
  }
  /** Connect again right now (after the password changed, for instance) instead of waiting for the backoff. */
  retryNow(): void { this.attempt = 0; if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; } this.wake?.(); }
  /** Drop the connection on purpose (the loop reconnects and the owner reconciles again). */
  reconnect(): void { this.ws?.terminate(); }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const reached = await this.connectOnce().catch(e => { this.lastProblem = String((e as Error).message ?? e); return false; });
      if (this.stopped) break;
      if (reached) this.attempt = 0;                       // we were identified: start the backoff again
      const wait = this.opts.backoffMs[Math.min(this.attempt, this.opts.backoffMs.length - 1)];
      this.attempt++;
      this.setState('waiting', `retrying in ${wait / 1000} s`);
      await new Promise<void>(res => { this.wake = res; this.retryTimer = setTimeout(res, wait); });
      this.wake = null; this.retryTimer = null;
    }
  }

  /** One connection from open to close. Resolves true if it got as far as being identified. */
  private connectOnce(): Promise<boolean> {
    return new Promise(resolve => {
      let identified = false, done = false;
      const finish = (why: string) => {
        if (done) return; done = true;
        clearTimeout(hs);
        this.failAll(new ObsNotConnected(why));
        this.ws = null;
        this.emit('closed', why);
        resolve(identified);
      };
      let ws: WebSocket;
      try { ws = new WebSocket(`ws://${this.host === '::1' ? '[::1]' : this.host}:${this.opts.port}`, 'obswebsocket.json', { handshakeTimeout: this.opts.handshakeTimeoutMs, perMessageDeflate: false, maxPayload: 8 * 1024 * 1024 }); }
      catch (e) { this.lastProblem = String((e as Error).message); finish('could not open'); return; }
      this.ws = ws;
      this.setState('connecting');
      const hs = setTimeout(() => { if (!identified) { this.lastProblem = 'OBS did not answer the handshake'; ws.terminate(); } }, this.opts.handshakeTimeoutMs + 1000);
      ws.on('error', e => { const code = (e as NodeJS.ErrnoException).code; this.lastProblem = code === 'ECONNREFUSED' ? 'OBS is not running, or its WebSocket server is off (connection refused)' : `connection problem: ${e.message}`; });
      ws.on('close', (code, reason) => {
        if (code === 4009) this.lastProblem = 'OBS rejected the password';
        else if (code === 4007 || code === 4008) this.lastProblem = `OBS closed the session (${code})`;
        else if (code !== 1005 && code !== 1006 && code !== 1000 && identified) this.lastProblem = `OBS closed the connection (${code}${reason?.length ? `: ${reason.toString().slice(0, 80)}` : ''})`;
        this.version = null;
        finish(this.lastProblem ?? 'closed');
      });
      ws.on('message', raw => {
        let m: { op: number; d?: Record<string, unknown> };
        try { m = JSON.parse(raw.toString()); } catch { return; }
        void this.onMessage(ws, m, () => { identified = true; clearTimeout(hs); }).catch(e => this.opts.logger.warn('OBS message problem', { message: (e as Error).message }));
      });
    });
  }

  private async onMessage(ws: WebSocket, m: { op: number; d?: Record<string, unknown> }, markIdentified: () => void): Promise<void> {
    const d = m.d ?? {};
    switch (m.op) {
      case 0: {                                                      // Hello
        this.setState('authenticating');
        const auth = d.authentication as { challenge: string; salt: string } | undefined;
        const identify: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: this.opts.meters() ? SUBSCRIPTIONS_WITH_METERS : SUBSCRIPTIONS_BASE };
        if (auth) {
          const pw = await this.opts.getPassword();
          if (!pw) { this.lastProblem = 'OBS asks for a password and none is set here'; ws.close(1000, 'no password'); return; }
          identify.authentication = obsAuth(pw, auth.salt, auth.challenge);
        }
        ws.send(JSON.stringify({ op: 1, d: identify }));
        return;
      }
      case 2: {                                                      // Identified
        markIdentified();
        this.lastProblem = null;
        this.setState('identified');
        try {
          const v = await this.request('GetVersion');
          this.version = { obsVersion: String(v.obsVersion ?? ''), obsWebSocketVersion: String(v.obsWebSocketVersion ?? '') };
        } catch { this.version = { obsVersion: '', obsWebSocketVersion: '' }; }
        this.emit('identified', this.version);
        return;
      }
      case 5: this.emit('event', { eventType: String(d.eventType ?? ''), eventIntent: typeof d.eventIntent === 'number' ? d.eventIntent : undefined, eventData: d.eventData as Record<string, unknown> | undefined }); return;
      case 7: {                                                      // RequestResponse
        const p = this.pending.get(String(d.requestId));
        if (!p) return;
        this.pending.delete(String(d.requestId)); clearTimeout(p.timer);
        const st = (d.requestStatus ?? {}) as { result?: boolean; code?: number; comment?: string };
        if (st.result) p.resolve(d.responseData ?? {}); else p.reject(new ObsRequestFailed(p.type, st.code ?? 0, st.comment));
        return;
      }
      case 9: {                                                      // RequestBatchResponse
        const p = this.pending.get(String(d.requestId));
        if (!p) return;
        this.pending.delete(String(d.requestId)); clearTimeout(p.timer);
        p.resolve(d.results ?? []);
        return;
      }
      default: return;
    }
  }

  private failAll(e: Error): void { for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(e); this.pending.delete(id); } }

  private send(op: number, d: Record<string, unknown>, id: string, type: string): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || (this.state !== 'identified' && type !== 'GetVersion')) return Promise.reject(new ObsNotConnected());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new ObsRequestFailed(type, -1, 'no answer from OBS in time')); }, this.opts.requestTimeoutMs);
      this.pending.set(id, { type, resolve, reject, timer });
      ws.send(JSON.stringify({ op, d }), err => { if (err) { clearTimeout(timer); this.pending.delete(id); reject(new ObsNotConnected(err.message)); } });
    });
  }

  /**
   * THE ONLY WAY a request reaches OBS. The allow-list is checked first; a refused request never touches the socket.
   * Resolves with OBS's responseData, rejects with ObsRequestDenied (refused here), ObsRequestFailed (OBS said no) or ObsNotConnected.
   */
  async request(type: AllowedRequest, data?: Record<string, unknown>): Promise<Record<string, any>> {
    assertRequestAllowed(type, data, this.opts.policy());
    const id = `bos-${++this.seq}`;
    return (await this.send(6, { requestType: type, requestId: id, ...(data && Object.keys(data).length ? { requestData: data } : {}) }, id, type)) as Record<string, any>;
  }

  /** A request batch. EVERY request in it is checked before the batch is sent; one refusal refuses all of it. */
  async batch(items: BatchItem[], o: { executionType?: 0 | 1 | 2; haltOnFailure?: boolean } = {}): Promise<Array<{ requestType: string; ok: boolean; code: number; data: Record<string, any> }>> {
    assertBatchAllowed(items, this.opts.policy());
    const id = `bos-${++this.seq}`;
    const res = (await this.send(8, { requestId: id, haltOnFailure: o.haltOnFailure ?? false, executionType: o.executionType ?? 0, requests: items.map(i => ({ requestType: i.requestType, ...(i.requestData && Object.keys(i.requestData).length ? { requestData: i.requestData } : {}) })) }, id, 'RequestBatch')) as Array<{ requestType: string; requestStatus?: { result?: boolean; code?: number }; responseData?: Record<string, any> }>;
    return res.map(r => ({ requestType: r.requestType, ok: !!r.requestStatus?.result, code: r.requestStatus?.code ?? 0, data: r.responseData ?? {} }));
  }

  // ------------------------------------------------------------------ typed wrappers (the only requests the rest of the program makes)
  getVersion() { return this.request('GetVersion'); }
  getStats() { return this.request('GetStats'); }
  async getSceneList(): Promise<{ current: string; scenes: string[] }> {
    const r = await this.request('GetSceneList');
    return { current: String(r.currentProgramSceneName ?? ''), scenes: ((r.scenes ?? []) as Array<{ sceneName: string }>).map(s => s.sceneName) };
  }
  async getCurrentProgramScene(): Promise<string> { const r = await this.request('GetCurrentProgramScene'); return String(r.sceneName ?? r.currentProgramSceneName ?? ''); }
  setCurrentProgramScene(sceneName: string) { return this.request('SetCurrentProgramScene', { sceneName }); }
  async getStudioModeEnabled(): Promise<boolean> { return !!(await this.request('GetStudioModeEnabled')).studioModeEnabled; }
  async getInputList(): Promise<Array<{ inputName: string; inputKind: string }>> { const r = await this.request('GetInputList'); return (r.inputs ?? []) as Array<{ inputName: string; inputKind: string }>; }
  async getInputMute(inputName: string): Promise<boolean> { return !!(await this.request('GetInputMute', { inputName })).inputMuted; }
  setInputMute(inputName: string, inputMuted: boolean) { return this.request('SetInputMute', { inputName, inputMuted }); }
  async getInputVolume(inputName: string): Promise<{ db: number; mul: number }> { const r = await this.request('GetInputVolume', { inputName }); return { db: Number(r.inputVolumeDb), mul: Number(r.inputVolumeMul) }; }
  setInputVolumeDb(inputName: string, inputVolumeDb: number) { return this.request('SetInputVolume', { inputName, inputVolumeDb }); }
  async getSourceFilterList(sourceName: string): Promise<Array<{ filterName: string; filterKind: string; filterEnabled: boolean; filterSettings: Record<string, unknown> }>> { return ((await this.request('GetSourceFilterList', { sourceName })).filters ?? []) as never; }
  getSourceFilter(sourceName: string, filterName: string) { return this.request('GetSourceFilter', { sourceName, filterName }); }
  setSourceFilterEnabled(sourceName: string, filterName: string, filterEnabled: boolean) { return this.request('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled }); }
  setSourceFilterSettings(sourceName: string, filterName: string, filterSettings: Record<string, string | number | boolean>) { return this.request('SetSourceFilterSettings', { sourceName, filterName, filterSettings, overlay: true }); }
  async getMediaInputStatus(inputName: string): Promise<string> { return String((await this.request('GetMediaInputStatus', { inputName })).mediaState ?? ''); }
  mediaPlay(inputName: string) { return this.request('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY' }); }
  mediaPause(inputName: string) { return this.request('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE' }); }
  async getStreamStatus(): Promise<{ active: boolean }> { return { active: !!(await this.request('GetStreamStatus')).outputActive }; }
  async getRecordStatus(): Promise<{ active: boolean }> { return { active: !!(await this.request('GetRecordStatus')).outputActive }; }
}

export { EMPTY_POLICY };
