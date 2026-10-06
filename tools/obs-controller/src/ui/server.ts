import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { parseConfig, type Config } from '../config';
import type { Controller } from '../controller';
import type { CredentialStore } from '../credentials';
import type { Logger } from '../log';
import type { ControllerSession } from '../session';
import { PAGE_HTML } from './page';

/**
 * The Companion's local screen. It listens on 127.0.0.1 ONLY and refuses anything that is not plainly the operator's own browser on this laptop:
 *   - the socket peer must be loopback;
 *   - the Host header must be 127.0.0.1 / localhost / [::1] on our own port (this defeats DNS rebinding: a web page cannot reach it through a hostile name);
 *   - every change (POST) must carry `X-BOS-Companion: 1` and `Content-Type: application/json` (a web page on another site cannot send that without a
 *     cross-origin preflight, which this server never approves) and, if the browser sends an Origin, it must be our own.
 * Nothing secret is ever returned: credentials go in (write-only) and never come back.
 */
export const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export interface GuardInput { remoteAddress: string | undefined; host: string | undefined; origin?: string | undefined; method: string; contentType?: string | undefined; marker?: string | undefined; fetchSite?: string | undefined }

/** null = allowed, else a refusal. `port` is the port the server is really listening on. */
export function guardRequest(g: GuardInput, port: number): { status: number; message: string } | null {
  if (!g.remoteAddress || !LOOPBACK_ADDRS.has(g.remoteAddress)) return { status: 403, message: 'this screen is only for the laptop it runs on' };
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!g.host || !hosts.has(g.host.toLowerCase())) return { status: 421, message: 'wrong host name: open http://127.0.0.1:' + port };
  if (g.fetchSite && !['same-origin', 'none'].includes(g.fetchSite)) return { status: 403, message: 'cross-site requests are not accepted' };
  const m = g.method.toUpperCase();
  if (m === 'GET' || m === 'HEAD') return null;
  if (m !== 'POST') return { status: 405, message: 'method not allowed' };
  if (g.origin && ![...hosts].some(h => g.origin === `http://${h}`)) return { status: 403, message: 'cross-site requests are not accepted' };
  if (g.marker !== '1') return { status: 403, message: 'missing X-BOS-Companion header' };
  if (!/^application\/json(\s*;|$)/i.test(g.contentType ?? '')) return { status: 415, message: 'send JSON' };
  return null;
}

export interface UiDeps {
  controller: Controller; session: ControllerSession; store: CredentialStore; logger: Logger;
  saveConfig: (f: (c: Config) => Config) => void;
  onQuit?: () => void;
}

const MAX_BODY = 64 * 1024;

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let n = 0, big = false;
    req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY) big = true; else chunks.push(c); });     // keep reading (and drop it) so the answer can be delivered
    req.on('end', () => { if (big) { reject(new Error('too large')); return; } try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown; resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}); } catch { reject(new Error('bad JSON')); } });
    req.on('error', reject);
  });
}

export function startUi(deps: UiDeps, port: number): Promise<{ server: http.Server; port: number; close: () => Promise<void> }> {
  const { controller, session, store, logger } = deps;
  const server = http.createServer((req, res) => { void handle(req, res).catch(e => { logger.warn('screen request failed', { message: (e as Error).message }); if (!res.headersSent) send(res, 500, { error: 'something went wrong' }); else res.end(); }); });
  const send = (res: http.ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", 'referrer-policy': 'no-referrer' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const str = (v: unknown, max = 300): string | null => (typeof v === 'string' && v.length <= max ? v : null);

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const actual = (server.address() as AddressInfo | null)?.port ?? port;
    const refusal = guardRequest({
      remoteAddress: req.socket.remoteAddress, host: req.headers.host, origin: req.headers.origin as string | undefined, method: req.method ?? 'GET',
      contentType: req.headers['content-type'], marker: req.headers['x-bos-companion'] as string | undefined, fetchSite: req.headers['sec-fetch-site'] as string | undefined
    }, actual);
    if (refusal) { send(res, refusal.status, { error: refusal.message }); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'GET') {
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, PAGE_HTML, 'text/html; charset=utf-8');
      if (url.pathname === '/api/state') return send(res, 200, { ...controller.status(), log: logger.tail(80).map(l => `${l.at.slice(11, 19)} ${l.level} ${l.msg}`) });
      return send(res, 404, { error: 'not found' });
    }
    const body = await readJson(req).catch(e => { send(res, (e as Error).message === 'too large' ? 413 : 400, { error: (e as Error).message }); return null; });
    if (!body) return;
    const ok = (extra: Record<string, unknown> = {}) => send(res, 200, { ok: true, ...extra });
    switch (url.pathname) {
      case '/api/camera-off': await controller.setLocalCameraOff(); return ok();
      case '/api/camera-off/clear': await controller.clearLocalCameraOff(); return ok();
      case '/api/take': {
        const kind = body.kind;
        if (kind !== 'lyst' && kind !== 'holding' && kind !== 'break') return send(res, 400, { error: 'say what to show' });
        const field = str(body.field, 40);
        if (kind === 'lyst' && !field) return send(res, 400, { error: 'say which Lyst' });
        await controller.takeLocal(kind, field); return ok();
      }
      case '/api/auto': await controller.returnToAuto(); return ok();
      case '/api/music': { const m = body.mode; if (m !== 'auto' && m !== 'muted' && m !== 'paused') return send(res, 400, { error: 'unknown music mode' }); await controller.setLocalMusic(m); return ok(); }
      case '/api/resume-music': await controller.resumeMusic(); return ok();
      case '/api/test-scene': { const n = str(body.scene, 256); if (!n) return send(res, 400, { error: 'say which scene' }); const r = await controller.testScene(n); return send(res, r.ok ? 200 : 409, r); }
      case '/api/mapping': {
        deps.saveConfig(c => parseConfig({ ...c, mapping: body.mapping })); controller.settingsChanged({ micSource: controller.status().audio.config.micSource }); return ok();
      }
      case '/api/audio': {
        const prev = controller.status().audio.config.micSource;
        deps.saveConfig(c => parseConfig({ ...c, audio: { ...c.audio, ...(body.audio as object) } })); controller.settingsChanged({ micSource: prev }); return ok();
      }
      case '/api/settings': {
        deps.saveConfig(c => parseConfig({ ...c, supabaseUrl: body.supabaseUrl ?? c.supabaseUrl, supabaseKey: body.supabaseKey ?? c.supabaseKey, eventSlug: body.eventSlug === undefined ? c.eventSlug : body.eventSlug }));
        return ok({ note: 'Address changes take effect when the Companion is restarted' });
      }
      case '/api/credentials': {
        // write-only: nothing here is ever sent back
        const pw = str(body.obsPassword, 200), code = str(body.controllerCode, 80);
        if (pw !== null && pw.length > 0) { logger.redactor.add(pw); await store.set('obs_password', pw); controller.obsPasswordChanged(); }
        if (body.clearObsPassword === true) { await store.delete('obs_password'); }
        if (code !== null && code.trim().length > 0) { logger.redactor.add(code); await session.useNewCode(code.trim()); }
        if (body.clearControllerCode === true) await session.clearCode();
        return ok();
      }
      case '/api/quit': logger.warn('quit requested from the screen'); send(res, 200, { ok: true }); setTimeout(() => deps.onQuit?.(), 200); return;
      default: return send(res, 404, { error: 'not found' });
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as AddressInfo).port;
      resolve({ server, port: actual, close: () => new Promise<void>(r => { server.close(() => r()); server.closeAllConnections?.(); }) });
    });
  });
}
