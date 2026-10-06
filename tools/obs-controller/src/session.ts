import type { CredentialStore } from './credentials';
import type { Logger } from './log';

/**
 * The Companion's own sign-in to BuhurtOS: a controller credential (a code, entered once) opens a SESSION through the `device-session` Edge Function.
 * The function returns a short-lived token (database role bos_controller: it can read public data, call controller_state() and report its heartbeat,
 * nothing else) and a long-lived session secret that only this laptop keeps. The token is refreshed before it expires; a network outage keeps whatever
 * is still valid and retries; a refused code stops after a slow backoff (it never hammers the sign-in).
 */
export type SessionStatus = 'no_code' | 'ok' | 'offline' | 'rejected';
export interface Whoami { session_id: string; credential_id: string; kind: string; role: string; label: string; event: { id: string; slug: string; name: string; timezone: string }; expires_at: string }

export interface SessionOptions {
  baseUrl: () => string | null;
  anonKey: () => string | null;
  store: CredentialStore;
  logger: Logger;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Refresh when this little is left on the token. */
  refreshBeforeMs?: number;
  timeoutMs?: number;
}

type TokenAnswer = { access_token: string; expires_at: number; expires_in?: number; session_secret?: string; whoami?: Whoami };

export class ControllerSession {
  status: SessionStatus = 'no_code';
  whoami: Whoami | null = null;
  lastProblem: string | null = null;
  private token: { jwt: string; expMs: number } | null = null;
  private inflight: Promise<void> | null = null;
  private retryAt = 0;
  private rejections = 0;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly refreshBefore: number;

  constructor(private readonly o: SessionOptions) {
    this.fetchFn = o.fetchFn ?? fetch; this.now = o.now ?? Date.now; this.refreshBefore = o.refreshBeforeMs ?? 90_000;
  }

  private url(): string | null { const b = this.o.baseUrl(); return b ? `${b.replace(/\/+$/, '')}/functions/v1/device-session` : null; }

  private async call(body: Record<string, unknown>): Promise<{ status: number; data: TokenAnswer | null }> {
    const url = this.url(), key = this.o.anonKey();
    if (!url || !key) throw new Error('the BuhurtOS address and key are not set');
    const res = await this.fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', apikey: key }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.o.timeoutMs ?? 10_000) });
    let data: TokenAnswer | null = null;
    try { data = (await res.json()) as TokenAnswer; } catch { /* no body */ }
    return { status: res.status, data };
  }

  /** The token for a request, or null (no code, signed out, or expired while offline: the request then goes out as an ordinary public read). */
  async getToken(): Promise<string | null> {
    if (this.token && this.token.expMs - this.now() > 5_000) return this.token.jwt;
    return null;
  }

  get hasToken(): boolean { return !!this.token && this.token.expMs > this.now(); }

  /** Make sure a valid token exists (call it on a timer). Concurrent calls share one attempt. Never throws. */
  ensure(): Promise<void> {
    this.inflight ??= this.run().catch(e => { this.lastProblem = String((e as Error).message ?? e); }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private accept(a: TokenAnswer): void {
    this.token = { jwt: a.access_token, expMs: (a.expires_at > 1e12 ? a.expires_at : a.expires_at * 1000) };
    this.o.logger.redactor.add(a.access_token);
    if (a.whoami) this.whoami = a.whoami;
    this.status = 'ok'; this.lastProblem = null; this.rejections = 0; this.retryAt = 0;
  }

  private async run(): Promise<void> {
    const code = await this.o.store.get('controller_code');
    let secret = await this.o.store.get('session_secret');
    this.o.logger.redactor.add(code); this.o.logger.redactor.add(secret);
    if (!code && !secret) { this.status = 'no_code'; this.token = null; this.whoami = null; return; }
    if (this.token && this.token.expMs - this.now() > this.refreshBefore) { this.status = 'ok'; return; }
    if (this.now() < this.retryAt) { if (!this.hasToken && this.status === 'ok') this.status = 'offline'; return; }

    try {
      if (secret) {
        const r = await this.call({ action: 'refresh', session_secret: secret });
        if (r.status === 200 && r.data?.access_token) { this.accept(r.data); return; }
        if (r.status === 401) { this.o.logger.info('the session was ended by BuhurtOS; signing in again with the code'); await this.o.store.delete('session_secret'); secret = null; this.token = null; }
        else throw new Error(`refresh answered ${r.status}`);
      }
      if (code) {
        const r = await this.call({ action: 'signin', code });
        if (r.status === 200 && r.data?.access_token) {
          if (r.data.session_secret) { this.o.logger.redactor.add(r.data.session_secret); await this.o.store.set('session_secret', r.data.session_secret); }
          this.accept(r.data);
          this.o.logger.info('signed in to BuhurtOS as the stream controller', { label: r.data.whoami?.label, event: r.data.whoami?.event?.slug });
          return;
        }
        if (r.status === 401) {
          this.status = 'rejected'; this.token = null; this.whoami = null; this.rejections++;
          this.retryAt = this.now() + Math.min(30_000 * 2 ** (this.rejections - 1), 300_000);
          this.lastProblem = 'BuhurtOS refused the controller code (it may be wrong, expired or revoked)';
          this.o.logger.warn(this.lastProblem);
          return;
        }
        throw new Error(`sign-in answered ${r.status}`);
      }
      this.status = 'rejected';
    } catch (e) {
      // no network, a timeout or a server error: keep the token we have while it lasts, and try again soon
      this.lastProblem = `cannot reach BuhurtOS (${String((e as Error).message ?? e).slice(0, 100)})`;
      this.status = this.hasToken ? 'ok' : 'offline';
      this.retryAt = this.now() + 3_000;
    }
  }

  /** The token was not accepted: drop it so the next check signs in again. */
  invalidate(): void { this.token = null; this.retryAt = 0; }

  /** The operator entered a new code: forget the old session, sign in fresh. */
  async useNewCode(code: string): Promise<void> {
    await this.o.store.set('controller_code', code);
    this.o.logger.redactor.add(code);
    await this.o.store.delete('session_secret');
    this.token = null; this.whoami = null; this.retryAt = 0; this.rejections = 0; this.status = 'offline';
    await this.ensure();
  }
  async clearCode(): Promise<void> {
    await this.o.store.delete('controller_code'); await this.o.store.delete('session_secret');
    this.token = null; this.whoami = null; this.status = 'no_code';
  }
  /** Sign the session out (best effort) on a clean shutdown. */
  async signOut(): Promise<void> {
    const secret = await this.o.store.get('session_secret');
    if (!secret) return;
    try { await this.call({ action: 'signout', session_secret: secret }); } catch { /* offline: the session simply expires */ }
  }
}
