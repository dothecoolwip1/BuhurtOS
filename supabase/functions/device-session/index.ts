// BuhurtOS temporary event devices (Supabase Edge Function): sign in with a device code, refresh, sign out, and mint codes for organizers.
// All logic is in ../_shared/deviceSession.ts (tested). This file only wires the platform: secrets, the Data API and the clock.
//
// Deploy with verify_jwt OFF (a device has no JWT before it signs in; create/replace forward the organizer's JWT to the database, which checks it).
// Secrets (set by the project owner, never in the repository): DEVICE_JWT_PRIVATE_JWK (ES256 private JWK incl. "kid"), DEVICE_CODE_PEPPER (32+ random chars),
// DEVICE_ALLOWED_ORIGINS (comma-separated app origins). SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
// Nothing here logs a request body, a code, a secret or a token.
import { handleRequest, type Deps } from '../_shared/deviceSession.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const jwk = JSON.parse(Deno.env.get('DEVICE_JWT_PRIVATE_JWK') ?? 'null');
const pepper = Deno.env.get('DEVICE_CODE_PEPPER') ?? '';
const ready = jwk && typeof jwk.kid === 'string' && pepper.length >= 32;

const deps: Deps = {
  env: { pepper, signing: { alg: 'ES256', jwk, kid: jwk?.kid ?? '' }, allowedOrigins: (Deno.env.get('DEVICE_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean) },
  rpc: async (name, args, as) => {
    const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: 'service' in as ? serviceKey : anonKey, Authorization: `Bearer ${'service' in as ? serviceKey : as.jwt}` },
      body: JSON.stringify(args)
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* an empty answer */ }
    return { ok: res.ok, status: res.status, data };
  },
  nowMs: () => Date.now(),
  randomBytes: n => crypto.getRandomValues(new Uint8Array(n)),
  sleep: ms => new Promise(r => setTimeout(r, ms))
};

Deno.serve(req => (ready ? handleRequest(req, deps) : new Response(JSON.stringify({ error: 'not configured' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
