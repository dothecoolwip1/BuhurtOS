// BuhurtOS temporary event devices: the door (pure, dependency-injected; the Deno entry point is ../device-session/index.ts).
//
// What this function does, and nothing else:
//   signin   a 12-character device code -> a short-lived token + a session secret      (public; throttled by the database)
//   refresh  the session secret -> a new short-lived token                              (public; the database re-checks revocation and expiry)
//   signout  the session secret -> the session ends
//   create / replace   the event's PERMANENT organizer asks for a device code; the organizer's own JWT is forwarded to the database, which decides
//
// What it never does: decide who may do anything (the database does, on every call), log a code or a secret, return a verifier, store anything.
// The token it signs carries the custom database role `bos_event_device` (or `bos_controller`), `sub` = the SESSION id (not a person), and nothing
// else: no event, no role of the device. The database looks all of that up in tables on every call, so a token can carry no authority of its own.
// Erasable TypeScript only (no enums, no parameter properties): Deno runs it as is and Node (the local test stack) can strip the types.

export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32: no I, L, O, U
export const CODE_LENGTH = 12;                                    // 12 x 5 bits = 60 bits
export const TOKEN_TTL_SECONDS = 600;                             // a token is only a convenience; the database checks the session on every call
export const MIN_RESPONSE_MS = 350;                               // wrong, expired, revoked and throttled all take at least this long

export interface HandlerEnv {
  /** HMAC key for code verifiers. Lives only in this function's secrets, never in the database. */
  pepper: string;
  /** HS256 shared secret (local test stack) or an ES256 private JWK as JSON (hosted: the imported signing key). */
  signing: { alg: 'HS256'; secret: string } | { alg: 'ES256'; jwk: Record<string, unknown>; kid: string };
  /** Origins that may call this function from a browser. '*' only on the local test stack. */
  allowedOrigins: string[];
  /** Test hook only (the local stack's reliability scenario shortens it); the deployed function never sets it, so the token lasts TOKEN_TTL_SECONDS. */
  tokenTtlSeconds?: number;
}
export interface RpcResult { ok: boolean; status: number; data: unknown }
export interface Deps {
  env: HandlerEnv;
  /** Calls a database function through the Data API. `as` = the service role, or the caller's own JWT (so the database decides). */
  rpc: (name: string, args: Record<string, unknown>, as: { service: true } | { jwt: string }) => Promise<RpcResult>;
  nowMs: () => number;
  randomBytes: (n: number) => Uint8Array;
  sleep: (ms: number) => Promise<void>;
}

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b as ArrayBuffer), x => x.toString(16).padStart(2, '0')).join('');
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === 'string' ? enc.encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const sha256 = async (data: Uint8Array | string) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data as BufferSource));
async function hmac(key: string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

// ---------------------------------------------------------------- the code
/** `K7Q2-M9XD-4TRH` -> `K7Q2M9XD4TRH`; the look-alikes O, I, L read as 0, 1, 1. Returns null for anything that cannot be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const c = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (c.length !== CODE_LENGTH) return null;
  for (const ch of c) if (!CODE_ALPHABET.includes(ch)) return null;
  return c;
}
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
/** 60 random bits, no modulo bias (256 is a multiple of 32). */
export function generateCode(randomBytes: (n: number) => Uint8Array): string {
  const b = randomBytes(CODE_LENGTH);
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[b[i] & 31];
  return c;
}
/** The stored verifier: keyed, so a database copy alone cannot be brute-forced. 32 bytes, as a Postgres bytea literal. */
export async function codeVerifier(pepper: string, code: string): Promise<string> { return '\\x' + hex(await hmac(pepper, 'bos-device-code:v1:' + code)); }
export async function secretVerifier(secretB64: string): Promise<string> { return '\\x' + hex(await sha256('bos-device-session:v1:' + secretB64)); }

// ---------------------------------------------------------------- the token
export async function signToken(env: HandlerEnv, claims: Record<string, unknown>): Promise<string> {
  if (env.signing.alg === 'HS256') {
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), body = b64url(JSON.stringify(claims));
    return `${head}.${body}.${b64url(await hmac(env.signing.secret, `${head}.${body}`))}`;
  }
  const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: env.signing.kid })), body = b64url(JSON.stringify(claims));
  const key = await crypto.subtle.importKey('jwk', env.signing.jwk as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`));   // raw r||s, which is what JWS wants
  return `${head}.${body}.${b64url(sig)}`;
}
const dbRole = (kind: string) => (kind === 'controller' ? 'bos_controller' : 'bos_event_device');

// ---------------------------------------------------------------- the door
interface Opened { ok: boolean; session_id?: string; kind?: string; role?: string; label?: string; credential_id?: string; expires_at?: string; event?: { id: string; slug: string; name: string; timezone: string } }
const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const started = deps.nowMs();
  const origin = req.headers.get('origin') ?? '';
  const allowed = deps.env.allowedOrigins.includes('*') || (origin !== '' && deps.env.allowedOrigins.includes(origin));
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': deps.env.allowedOrigins.includes('*') ? '*' : (allowed ? origin : 'null'),
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin'
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const refuse = async () => {   // one answer for every way a code or session can fail, after the same minimum time
    const wait = MIN_RESPONSE_MS - (deps.nowMs() - started);
    if (wait > 0) await deps.sleep(wait);
    return reply({ error: 'That code did not work. Check it, or ask the organizer for a new one.' }, 401);
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  if (!deps.env.allowedOrigins.includes('*') && !allowed) return reply({ error: 'forbidden' }, 403);

  let body: Record<string, unknown>;
  try { body = asObject(await req.json()); } catch { return reply({ error: 'bad request' }, 400); }
  const action = body.action;

  const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '').split(',')[0].trim();
  const day = new Date(deps.nowMs()).toISOString().slice(0, 10);
  const ipHash = hex(await sha256(`bos-ip:${day}:${deps.env.pepper}:${ip}`)).slice(0, 32);

  const mint = async (o: Opened) => {
    const iat = Math.floor(deps.nowMs() / 1000);
    const ttl = deps.env.tokenTtlSeconds && deps.env.tokenTtlSeconds > 0 ? deps.env.tokenTtlSeconds : TOKEN_TTL_SECONDS;
    const token = await signToken(deps.env, { aud: 'authenticated', role: dbRole(o.kind ?? 'device'), sub: o.session_id, session_id: o.session_id, iat, exp: iat + ttl });
    return { access_token: token, expires_in: ttl, expires_at: iat + ttl,
      whoami: { session_id: o.session_id, credential_id: o.credential_id, kind: o.kind, role: o.role, label: o.label, event: o.event, expires_at: o.expires_at } };
  };

  if (action === 'signin') {
    const code = normalizeCode(body.code);
    if (!code) return refuse();
    const secret = b64url(deps.randomBytes(32));
    const r = await deps.rpc('device_open_session', { p_code_hash: await codeVerifier(deps.env.pepper, code), p_secret_hash: await secretVerifier(secret), p_ip_hash: ipHash }, { service: true });
    const o = asObject(r.data) as Opened;
    if (!r.ok || !o.ok) return refuse();
    const wait = MIN_RESPONSE_MS - (deps.nowMs() - started);
    if (wait > 0) await deps.sleep(wait);
    return reply({ ...(await mint(o)), session_secret: secret });
  }
  if (action === 'refresh' || action === 'signout') {
    const secret = typeof body.session_secret === 'string' && body.session_secret.length >= 20 && body.session_secret.length <= 100 ? body.session_secret : null;
    if (!secret) return refuse();
    if (action === 'signout') {
      await deps.rpc('device_close_session', { p_secret_hash: await secretVerifier(secret) }, { service: true });
      return reply({ ok: true });
    }
    const r = await deps.rpc('device_refresh_session', { p_secret_hash: await secretVerifier(secret) }, { service: true });
    const o = asObject(r.data) as Opened;
    if (!r.ok || !o.ok) return refuse();
    return reply(await mint(o));
  }
  if (action === 'create' || action === 'replace') {
    // The caller is the event's permanent organizer. Their own JWT goes to the database, which refuses anyone else; this function only makes the code.
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return reply({ error: 'sign in as an organizer' }, 401);
    const code = generateCode(deps.randomBytes);
    const verifier = await codeVerifier(deps.env.pepper, code);
    // The event's reusable Counter QR (kind counter_pool) keeps its plaintext on the credential, so scoring staff can show it again: it signs in
    // counters only (no staff role, an allow-list of counter functions), so it is low privilege by construction. Every other kind keeps a verifier only.
    // Pack 27B: the Training Counter QR is a second pool (training = true); its sessions only ever hold learning seats.
    const pool = body.kind === 'counter_pool';
    const training = pool && body.training === true;
    const r = action === 'create'
      ? await deps.rpc('create_event_credential', { p_event: body.event, p_kind: body.kind ?? 'device', p_label: body.label ?? (pool ? (training ? 'Training Counter QR' : 'Counter QR') : undefined), p_role: pool ? 'counter' : body.role, p_code_hash: verifier, p_expires_at: body.expires_at ?? null, p_pool_code: pool ? code : null, p_training: training }, { jwt })
      : await deps.rpc('replace_event_credential', { p_credential: body.credential, p_code_hash: verifier }, { jwt });
    if (!r.ok) {
      const msg = typeof asObject(r.data).message === 'string' ? String(asObject(r.data).message) : 'could not create the code';
      return reply({ error: msg }, r.status === 403 || r.status === 401 ? 403 : 400);
    }
    return reply({ credential: r.data, code: formatCode(code) });   // the only time the plaintext exists outside the organizer's screen
  }
  return reply({ error: 'unknown action' }, 400);
}
