import { describe, expect, it } from 'vitest';
import { b64uDecode, b64uEncode, encryptPayload, endpointAllowed, generateVapidKeys, outcomeForStatus, sendWebPush, vapidAuthorization } from './webpush';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A subscriber (browser) that can decrypt, written step by step from RFC 8291 section 3.4 and independent of the sender's code path. */
async function subscriber() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, authSecret, pub, keys: { p256dh: b64uEncode(pub), auth: b64uEncode(authSecret) } };
}
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let at = 0; for (const x of p) { o.set(x, at); at += x.length; } return o; };
async function decrypt(body: Uint8Array, sub: Awaited<ReturnType<typeof subscriber>>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16, false);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);
  const asKey = await crypto.subtle.importKey('raw', asPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.pair.privateKey, 256));
  const prkKey = await hmac(sub.authSecret, secret);
  const ikm = (await hmac(prkKey, cat(enc.encode('WebPush: info\0'), sub.pub, asPublic, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, cipher as BufferSource));
  expect(plain[plain.length - 1]).toBe(2);   // last-record delimiter
  return dec.decode(plain.slice(0, -1));
}

describe('web push encryption (RFC 8291)', () => {
  it('a subscriber following the RFC reads exactly what was sent', async () => {
    const sub = await subscriber();
    const message = JSON.stringify({ title: 'On deck', body: 'You\'re up next on Field 1. Get to the bullpen.', route: '/events/e1#my-next-fight', tag: 'fight-1' });
    const body = await encryptPayload(enc.encode(message), sub.keys);
    expect(await decrypt(body, sub)).toBe(message);
  });
  it('handles non-ASCII text such as the middle dot in "Longsword · Field 1"', async () => {
    const sub = await subscriber();
    const message = JSON.stringify({ body: 'Longsword · Field 1 — ÅÄÖ 🛡' });
    expect(await decrypt(await encryptPayload(enc.encode(message), sub.keys), sub)).toBe(message);
  });
  it('uses a fresh key and salt every time, so two pushes of the same text differ', async () => {
    const sub = await subscriber();
    const a = await encryptPayload(enc.encode('same'), sub.keys);
    const b = await encryptPayload(enc.encode('same'), sub.keys);
    expect(b64uEncode(a)).not.toBe(b64uEncode(b));
  });
  it('another subscriber cannot read it', async () => {
    const sub = await subscriber();
    const other = await subscriber();
    const body = await encryptPayload(enc.encode('private'), sub.keys);
    await expect(decrypt(body, other)).rejects.toBeDefined();
  });
  it('refuses malformed keys and oversized payloads', async () => {
    const sub = await subscriber();
    await expect(encryptPayload(enc.encode('x'), { p256dh: 'AAAA', auth: sub.keys.auth })).rejects.toThrow();
    await expect(encryptPayload(enc.encode('x'), { p256dh: sub.keys.p256dh, auth: 'AAAA' })).rejects.toThrow();
    await expect(encryptPayload(new Uint8Array(4000), sub.keys)).rejects.toThrow(/too large/);
  });
});

describe('VAPID (RFC 8292)', () => {
  it('signs a token a push service can verify with the public key', async () => {
    const keys = await generateVapidKeys();
    expect(b64uDecode(keys.publicKey)).toHaveLength(65);
    expect(b64uDecode(keys.privateKey)).toHaveLength(32);
    const now = Date.UTC(2026, 9, 6, 12, 0, 0);
    const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', 'https://example.test/', keys, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth)!;
    expect(m).not.toBeNull();
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(dec.decode(b64uDecode(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(now / 1000) + 43200, sub: 'https://example.test/' });
    expect(JSON.parse(dec.decode(b64uDecode(m[1])))).toEqual({ typ: 'JWT', alg: 'ES256' });
    const pub = await crypto.subtle.importKey('raw', b64uDecode(keys.publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, b64uDecode(m[3]) as BufferSource, enc.encode(`${m[1]}.${m[2]}`) as BufferSource);
    expect(ok).toBe(true);
  });
  it('a token for another key does not verify', async () => {
    const a = await generateVapidKeys(); const b = await generateVapidKeys();
    const auth = await vapidAuthorization('https://push.example.com/x', 'https://example.test/', a);
    const m = /t=([\w-]+)\.([\w-]+)\.([\w-]+),/.exec(auth)!;
    const pubB = await crypto.subtle.importKey('raw', b64uDecode(b.publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubB, b64uDecode(m[3]) as BufferSource, enc.encode(`${m[1]}.${m[2]}`) as BufferSource)).toBe(false);
  });
});

describe('sending', () => {
  it('maps push-service answers to what the database should record', () => {
    expect(outcomeForStatus(201)).toBe('sent');
    expect(outcomeForStatus(410)).toBe('gone');
    expect(outcomeForStatus(404)).toBe('gone');
    expect(outcomeForStatus(429)).toBe('retry');
    expect(outcomeForStatus(503)).toBe('retry');
    expect(outcomeForStatus(400)).toBe('failed');
    expect(outcomeForStatus(403)).toBe('failed');
  });
  it('only ever posts to a public https push service', () => {
    expect(endpointAllowed('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
    expect(endpointAllowed('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://user:pw@push.example.com/x', 'not a url', 'https://[::1]/x', 'https://internal/x']) expect(endpointAllowed(bad), bad).toBe(false);
  });
  it('sends one encrypted POST with the headers a push service needs, and reports the outcome', async () => {
    const sub = await subscriber(); const vapid = await generateVapidKeys();
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    const r = await sendWebPush({ endpoint: 'https://push.example.com/wpush/abc', ...sub.keys }, { body: { title: 'Hi' }, ttl: 600, urgent: true }, vapid, 'https://example.test/', fake);
    expect(r).toMatchObject({ outcome: 'sent', status: 201 });
    const h = seen!.init.headers as Record<string, string>;
    expect(h['Content-Encoding']).toBe('aes128gcm');
    expect(h.TTL).toBe('600');
    expect(h.Urgency).toBe('high');
    expect(h.Authorization.startsWith('vapid t=')).toBe(true);
    expect(JSON.parse(await decrypt(seen!.init.body as Uint8Array, sub))).toEqual({ title: 'Hi' });
  });
  it('reports gone for 410, retry for a network failure, and never contacts a private address', async () => {
    const sub = await subscriber(); const vapid = await generateVapidKeys();
    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    expect((await sendWebPush({ endpoint: 'https://push.example.com/x', ...sub.keys }, { body: {}, ttl: 1, urgent: false }, vapid, 'https://e.test/', gone)).outcome).toBe('gone');
    const down = (async () => { throw new Error('connection reset'); }) as unknown as typeof fetch;
    expect((await sendWebPush({ endpoint: 'https://push.example.com/x', ...sub.keys }, { body: {}, ttl: 1, urgent: false }, vapid, 'https://e.test/', down)).outcome).toBe('retry');
    let called = false;
    const spy = (async () => { called = true; return new Response(null, { status: 201 }); }) as unknown as typeof fetch;
    const r = await sendWebPush({ endpoint: 'https://169.254.169.254/x', ...sub.keys }, { body: {}, ttl: 1, urgent: false }, vapid, 'https://e.test/', spy);
    expect(called).toBe(false);
    expect(r.outcome).toBe('gone');
  });
});
