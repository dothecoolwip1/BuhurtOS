/**
 * Web Push for the BuhurtOS dispatcher, with nothing but WebCrypto (works in Deno, Node 20+ and browsers), so it can be unit tested
 * without a push service. Implements:
 *   RFC 8291  message encryption (aes128gcm content coding), and
 *   RFC 8292  VAPID (an ES256 JWT proving which application server is sending).
 * Contains no secrets and no I/O except `sendWebPush`, which makes one HTTPS POST to the device's push service.
 */

const enc = new TextEncoder();

export const b64uEncode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64uDecode = (text: string): Uint8Array => {
  const pad = '='.repeat((4 - (text.length % 4)) % 4);
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

export interface PushKeys { p256dh: string; auth: string }
export interface EncryptOptions { salt?: Uint8Array; serverKeys?: CryptoKeyPair }

/** RFC 8291 section 3-4: one record, `aes128gcm`. The header carries the salt, record size and our ephemeral public key. */
export async function encryptPayload(plaintext: Uint8Array, keys: PushKeys, opts: EncryptOptions = {}): Promise<Uint8Array> {
  const uaPublic = b64uDecode(keys.p256dh);
  const authSecret = b64uDecode(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh is not an uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('auth secret must be 16 bytes');
  if (plaintext.length > 3993) throw new Error('payload too large for one push record');

  const server = opts.serverKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', server.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aes = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, aes, concat(plaintext, new Uint8Array([2])) as BufferSource));   // 0x02: last (and only) record

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export interface VapidKeys { publicKey: string; privateKey: string }

/** A fresh VAPID key pair as base64url: the 65-byte public point and the 32-byte private scalar. */
export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { publicKey: b64uEncode(raw), privateKey: jwk.d! };
}

async function importVapidPrivate(keys: VapidKeys): Promise<CryptoKey> {
  const pub = b64uDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('VAPID public key is not an uncompressed P-256 point');
  return crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** RFC 8292: `Authorization: vapid t=<jwt>, k=<public key>`. The token names the push service's origin and expires within 12 hours. */
export async function vapidAuthorization(endpoint: string, subject: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signed = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await importVapidPrivate(keys), enc.encode(signed) as BufferSource));   // raw r||s, which is what JWS wants
  return `vapid t=${signed}.${b64uEncode(sig)}, k=${keys.publicKey}`;
}

export type Outcome = 'sent' | 'gone' | 'retry' | 'failed';
/** What the push service's answer means for us. 404/410: the device is gone for good. 429 and 5xx: try again. Anything else: this message will not work. */
export const outcomeForStatus = (status: number): Outcome =>
  status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'gone' : status === 429 || status >= 500 ? 'retry' : 'failed';

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushMessage { body: unknown; ttl: number; urgent: boolean }

/** Only a real push service over HTTPS: a stored endpoint is never fetched when it points anywhere else. */
export function endpointAllowed(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.username && !u.password && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(u.hostname) && u.hostname.includes('.');
  } catch { return false; }
}

export async function sendWebPush(target: PushTarget, message: PushMessage, vapid: VapidKeys, subject: string, fetchImpl: typeof fetch = fetch): Promise<{ outcome: Outcome; status: number; error?: string }> {
  if (!endpointAllowed(target.endpoint)) return { outcome: 'gone', status: 0, error: 'endpoint is not a public https push service' };
  try {
    const body = await encryptPayload(enc.encode(JSON.stringify(message.body)), { p256dh: target.p256dh, auth: target.auth });
    const res = await fetchImpl(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(target.endpoint, subject, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(Math.max(0, Math.floor(message.ttl))),
        Urgency: message.urgent ? 'high' : 'normal'
      },
      body: body as BodyInit,
      signal: AbortSignal.timeout(10_000)
    });
    await res.body?.cancel().catch(() => undefined);
    return { outcome: outcomeForStatus(res.status), status: res.status, error: res.status >= 300 ? `HTTP ${res.status}` : undefined };
  } catch (e) {
    return { outcome: 'retry', status: 0, error: e instanceof Error ? e.message.slice(0, 120) : 'network error' };
  }
}
