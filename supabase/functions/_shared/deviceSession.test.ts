import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, MIN_RESPONSE_MS, TOKEN_TTL_SECONDS, codeVerifier, formatCode, generateCode, handleRequest, normalizeCode, secretVerifier, signToken, type Deps, type RpcResult } from './deviceSession.ts';

const PEPPER = 'p'.repeat(40);
const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());
const claimsOf = (jwt: string) => dec(jwt.split('.')[1]);

function harness(over: { rpc?: (name: string, args: Record<string, unknown>, as: { service: true } | { jwt: string }) => RpcResult | Promise<RpcResult>; origins?: string[] } = {}) {
  let now = 1_800_000_000_000;
  const calls: { name: string; args: Record<string, unknown>; as: { service: true } | { jwt: string } }[] = [];
  const sleeps: number[] = [];
  const deps: Deps = {
    env: { pepper: PEPPER, signing: { alg: 'HS256', secret: 's'.repeat(40) }, allowedOrigins: over.origins ?? ['*'] },
    rpc: async (name, args, as) => { calls.push({ name, args, as }); return over.rpc ? over.rpc(name, args, as) : { ok: true, status: 200, data: {} }; },
    nowMs: () => now,
    randomBytes: n => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 255; return b; },
    sleep: async ms => { sleeps.push(ms); now += ms; }
  };
  const post = (body: unknown, headers: Record<string, string> = {}) => handleRequest(new Request('https://f.test/device-session', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), deps);
  return { deps, calls, sleeps, post, elapsed: () => now - 1_800_000_000_000 };
}
const OPENED = { ok: true, session_id: '11111111-1111-4111-8111-111111111111', credential_id: 'c0', kind: 'device', role: 'marshal', label: 'Marshal Phone', expires_at: '2026-10-12T06:00:00Z', event: { id: 'e1', slug: 'rumble', name: 'Rumble', timezone: 'America/Edmonton' } };

afterEach(() => vi.restoreAllMocks());

describe('the device code', () => {
  it('reads what a person types: case, dashes, spaces, look-alike letters', () => {
    expect(normalizeCode('k7q2-m9xd-4trh')).toBe('K7Q2M9XD4TRH');
    expect(normalizeCode(' K7Q2 M9XD 4TRH ')).toBe('K7Q2M9XD4TRH');
    expect(normalizeCode('O0OO-IL1I-LLOO')).toBe('000011111100');   // O reads 0, I and L read 1
    expect(normalizeCode('K7Q2-M9XD-4TR')).toBeNull();
    expect(normalizeCode('K7Q2-M9XD-4TRHH')).toBeNull();
    expect(normalizeCode('K7Q2-M9XD-4TRU')).toBeNull();   // U is not in the alphabet
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode({})).toBeNull();
    expect(normalizeCode('A'.repeat(200))).toBeNull();
  });
  it('is 12 characters of 5 bits each, with no modulo bias, and groups as XXXX-XXXX-XXXX', () => {
    expect(CODE_LENGTH * Math.log2(CODE_ALPHABET.length)).toBe(60);
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(generateCode(n => new Uint8Array(n).fill(255))).toBe('Z'.repeat(12));
    expect(generateCode(n => new Uint8Array(n).fill(0))).toBe('0'.repeat(12));
    const c = generateCode(n => crypto.getRandomValues(new Uint8Array(n)));
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(formatCode('K7Q2M9XD4TRH')).toBe('K7Q2-M9XD-4TRH');
    expect(normalizeCode(formatCode(c))).toBe(c);
  });
  it('is stored as a keyed verifier only: 32 bytes, depends on the pepper, never contains the code', async () => {
    const v = await codeVerifier(PEPPER, 'K7Q2M9XD4TRH');
    expect(v).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(v).toBe(await codeVerifier(PEPPER, 'K7Q2M9XD4TRH'));
    expect(v).not.toBe(await codeVerifier('q'.repeat(40), 'K7Q2M9XD4TRH'));
    expect(v).not.toBe(await codeVerifier(PEPPER, 'K7Q2M9XD4TRJ'));
    expect(v.toLowerCase()).not.toContain('k7q2');
    expect(await secretVerifier('abc')).toMatch(/^\\x[0-9a-f]{64}$/);
  });
});

describe('the token', () => {
  it('HS256 (local stack): a verifiable JWT with the database role and the SESSION id as sub, and nothing else', async () => {
    const h = harness();
    const t = await signToken(h.deps.env, { aud: 'authenticated', role: 'bos_event_device', sub: 'x', exp: 9 });
    const [head, body, sig] = t.split('.');
    expect(dec(head)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const want = (await import('node:crypto')).createHmac('sha256', 's'.repeat(40)).update(`${head}.${body}`).digest('base64url');
    expect(sig).toBe(want);
  });
  it('ES256 (hosted): verifies with the public key (raw r||s signature) and carries the kid', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey) as Record<string, unknown>;
    const env = { ...harness().deps.env, signing: { alg: 'ES256' as const, jwk, kid: 'key-1' } };
    const t = await signToken(env, { sub: 'x', role: 'bos_event_device' });
    const [head, body, sig] = t.split('.');
    expect(dec(head)).toEqual({ alg: 'ES256', typ: 'JWT', kid: 'key-1' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${head}.${body}`));
    expect(ok).toBe(true);
    expect(Buffer.from(sig, 'base64url')).toHaveLength(64);
  });
});

describe('sign in', () => {
  it('opens a session through the service role and returns a short token, a session secret and who it is; no authority in the token', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: OPENED }) });
    const res = await h.post({ action: 'signin', code: 'k7q2-m9xd-4trh' }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    const c = claimsOf(body.access_token);
    expect(c).toMatchObject({ aud: 'authenticated', role: 'bos_event_device', sub: OPENED.session_id, session_id: OPENED.session_id });
    expect(c.exp - c.iat).toBe(TOKEN_TTL_SECONDS);
    expect(Object.keys(c).sort()).toEqual(['aud', 'exp', 'iat', 'role', 'session_id', 'sub']);   // no event, no device role, no email: the database looks those up
    expect(body.session_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.whoami).toMatchObject({ label: 'Marshal Phone', role: 'marshal', kind: 'device', event: { slug: 'rumble' } });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].name).toBe('device_open_session');
    expect(h.calls[0].as).toEqual({ service: true });
  });
  it('sends the database only verifiers: never the code, never the secret, never the raw address', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: OPENED }) });
    const res = await h.post({ action: 'signin', code: 'K7Q2-M9XD-4TRH' }, { 'x-forwarded-for': '203.0.113.9' });
    const body = await res.json();
    const sent = JSON.stringify(h.calls[0].args);
    expect(sent).not.toMatch(/K7Q2|M9XD|4TRH/i);
    expect(sent).not.toContain(body.session_secret);
    expect(sent).not.toContain('203.0.113.9');
    expect(h.calls[0].args.p_code_hash).toBe(await codeVerifier(PEPPER, 'K7Q2M9XD4TRH'));
    expect(h.calls[0].args.p_secret_hash).toBe(await secretVerifier(body.session_secret));
    expect(String(h.calls[0].args.p_ip_hash)).toMatch(/^[0-9a-f]{32}$/);
  });
  it('a controller session is signed with the controller role', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: { ...OPENED, kind: 'controller', role: 'broadcast_controller', label: 'Stream Laptop' } }) });
    const body = await (await h.post({ action: 'signin', code: 'K7Q2M9XD4TRH' })).json();
    expect(claimsOf(body.access_token).role).toBe('bos_controller');
  });
  it('every failure looks the same and takes the same minimum time: bad format, unknown code, throttled, database error', async () => {
    const cases: Array<[string, unknown, (name: string) => RpcResult]> = [
      ['bad format', 'nope', () => ({ ok: true, status: 200, data: OPENED })],
      ['unknown or revoked or expired', 'K7Q2M9XD4TRH', () => ({ ok: true, status: 200, data: { ok: false } })],
      ['database error', 'K7Q2M9XD4TRH', () => ({ ok: false, status: 500, data: { message: 'boom' } })],
      ['garbage answer', 'K7Q2M9XD4TRH', () => ({ ok: true, status: 200, data: 'x' })]
    ];
    const seen: string[] = [];
    for (const [, code, rpc] of cases) {
      const h = harness({ rpc: (n) => rpc(n) });
      const res = await h.post({ action: 'signin', code });
      expect(res.status).toBe(401);
      seen.push(await res.text());
      expect(h.elapsed()).toBeGreaterThanOrEqual(MIN_RESPONSE_MS);
    }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).not.toMatch(/expired|revoked|throttl|not found|invalid code/i);
  });
  it('a success also takes the minimum time (a fast answer would tell a guesser it was right)', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: OPENED }) });
    await h.post({ action: 'signin', code: 'K7Q2M9XD4TRH' });
    expect(h.elapsed()).toBeGreaterThanOrEqual(MIN_RESPONSE_MS);
  });
  it('logs nothing at all (no code, secret or token can reach a log)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: OPENED }) });
    await h.post({ action: 'signin', code: 'K7Q2M9XD4TRH' });
    await h.post({ action: 'signin', code: 'bad' });
    await h.post({ action: 'refresh', session_secret: 'x'.repeat(43) });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('refresh and sign out', () => {
  it('refresh trades the session secret for a new token (no new secret); the database decides', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: OPENED }) });
    const secret = 'S'.repeat(43);
    const body = await (await h.post({ action: 'refresh', session_secret: secret })).json();
    expect(claimsOf(body.access_token).sub).toBe(OPENED.session_id);
    expect(body.session_secret).toBeUndefined();
    expect(h.calls[0]).toMatchObject({ name: 'device_refresh_session', as: { service: true } });
    expect(h.calls[0].args.p_secret_hash).toBe(await secretVerifier(secret));
  });
  it('a revoked, expired or unknown session is refused with the same answer as a wrong code', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: { ok: false } }) });
    const res = await h.post({ action: 'refresh', session_secret: 'S'.repeat(43) });
    expect(res.status).toBe(401);
    const wrong = await harness().post({ action: 'signin', code: 'zzz' });
    expect(await res.text()).toBe(await wrong.text());
    expect((await harness().post({ action: 'refresh', session_secret: 'short' })).status).toBe(401);
    expect((await harness().post({ action: 'refresh' })).status).toBe(401);
  });
  it('sign out ends the session and always says ok', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: { ok: true } }) });
    const res = await h.post({ action: 'signout', session_secret: 'S'.repeat(43) });
    expect(await res.json()).toEqual({ ok: true });
    expect(h.calls[0]).toMatchObject({ name: 'device_close_session', as: { service: true } });
  });
});

describe('creating and replacing a code (the organizer)', () => {
  const created = { id: 'cred1', kind: 'device', label: 'Counter Phone 1', role: 'counter', expires_at: '2026-10-12T06:00:00+00:00' };
  it('forwards the ORGANIZER\'s own token to the database (it decides who may), returns the code once, and sends only the verifier', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: created }) });
    const res = await h.post({ action: 'create', event: 'e1', kind: 'device', label: 'Counter Phone 1', role: 'counter' }, { authorization: 'Bearer organizer.jwt.value' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(body.credential).toEqual(created);
    expect(h.calls[0].as).toEqual({ jwt: 'organizer.jwt.value' });      // never the service role
    expect(h.calls[0].name).toBe('create_event_credential');
    const sent = JSON.stringify(h.calls[0].args);
    expect(sent).not.toContain(body.code.replace(/-/g, ''));
    expect(h.calls[0].args.p_code_hash).toBe(await codeVerifier(PEPPER, normalizeCode(body.code)!));
  });
  it('needs a signed-in caller, and a database refusal is passed on as a refusal (no code is returned)', async () => {
    expect((await harness().post({ action: 'create', event: 'e1', label: 'x', role: 'counter' })).status).toBe(401);
    const h = harness({ rpc: () => ({ ok: false, status: 403, data: { message: 'only an organizer of this event can create device codes' } }) });
    const res = await h.post({ action: 'create', event: 'e1', label: 'x', role: 'counter' }, { authorization: 'Bearer a.b.c' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBeUndefined();
    expect(body.error).toContain('only an organizer');
  });
  it('the event\'s reusable Counter QR (kind counter_pool): the plaintext goes to the database with the verifier, as a counter, labelled by default', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: { ...created, kind: 'counter_pool', label: 'Counter QR' } }) });
    const body = await (await h.post({ action: 'create', event: 'e1', kind: 'counter_pool' }, { authorization: 'Bearer a.b.c' })).json();
    expect(h.calls[0].name).toBe('create_event_credential');
    expect(h.calls[0].args).toMatchObject({ p_kind: 'counter_pool', p_role: 'counter', p_label: 'Counter QR', p_pool_code: normalizeCode(body.code) });
    expect(h.calls[0].args.p_code_hash).toBe(await codeVerifier(PEPPER, normalizeCode(body.code)!));
  });
  it('an ordinary device code never sends a plaintext to the database', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: created }) });
    await h.post({ action: 'create', event: 'e1', kind: 'device', label: 'Marshal Phone', role: 'marshal' }, { authorization: 'Bearer a.b.c' });
    expect(h.calls[0].args.p_pool_code).toBeNull();
  });
  it('replace goes the same way', async () => {
    const h = harness({ rpc: () => ({ ok: true, status: 200, data: created }) });
    const body = await (await h.post({ action: 'replace', credential: 'cred1' }, { authorization: 'Bearer a.b.c' })).json();
    expect(h.calls[0]).toMatchObject({ name: 'replace_event_credential', as: { jwt: 'a.b.c' } });
    expect(body.code).toHaveLength(14);
  });
});

describe('the browser door', () => {
  it('answers the preflight, refuses other methods and unknown actions, and bad JSON', async () => {
    const h = harness();
    expect((await handleRequest(new Request('https://f.test/', { method: 'OPTIONS', headers: { origin: 'https://app.test' } }), h.deps)).status).toBe(204);
    expect((await handleRequest(new Request('https://f.test/', { method: 'GET' }), h.deps)).status).toBe(405);
    expect((await h.post({ action: 'dance' })).status).toBe(400);
    expect((await handleRequest(new Request('https://f.test/', { method: 'POST', body: 'not json' }), h.deps)).status).toBe(400);
  });
  it('only the configured origins may call it from a browser (hosted); never cached', async () => {
    const h = harness({ origins: ['https://app.test'], rpc: () => ({ ok: true, status: 200, data: OPENED }) });
    expect((await h.post({ action: 'signin', code: 'K7Q2M9XD4TRH' }, { origin: 'https://evil.test' })).status).toBe(403);
    const ok = await h.post({ action: 'signin', code: 'K7Q2M9XD4TRH' }, { origin: 'https://app.test' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.test');
    expect(ok.headers.get('cache-control')).toBe('no-store');
  });
});
