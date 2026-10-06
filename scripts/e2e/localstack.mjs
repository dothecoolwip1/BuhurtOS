// A local stand-in for the hosted Supabase API, so the REAL app can run against a REAL Postgres built from the migrations:
//   /rest/v1/*  -> PostgREST (the real tables, row level security and database functions)
//   /auth/v1/*  -> the REAL Supabase Auth server when AUTH_URL is set (scripts/e2e/realauth.sh); otherwise just enough for a session that is
//                  already in the browser (user lookup, sign-out)
//   /storage/v1/* -> an in-memory stand-in (upload, public read, remove) so picture uploads can be exercised. It does NOT enforce bucket policies:
//                    those are tested directly in the database gates.
//   /realtime   -> not offered (the app then uses its polling fallback)
// LOCAL EVIDENCE TOOLING ONLY: not part of CI, never pointed at a hosted project. Started by scripts/e2e/eventday-live.sh.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.STACK_PORT ?? 54321);
const REST = new URL(process.env.POSTGREST_URL ?? 'http://127.0.0.1:3000');
const SECRET = process.env.JWT_SECRET;
const AUTH = process.env.AUTH_URL ? new URL(process.env.AUTH_URL) : null;
if (!SECRET || SECRET.length < 32) { console.error('JWT_SECRET (32+ characters) is required'); process.exit(2); }

const b64 = (b) => Buffer.from(b).toString('base64url');
export const signJwt = (claims) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
function verify(token) {
  const [h, p, s] = (token ?? '').split('.');
  if (!h || !p || !s) return null;
  const good = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try { const c = JSON.parse(Buffer.from(p, 'base64url').toString()); return c.exp && c.exp < Date.now() / 1000 ? null : c; } catch { return null; }
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'access-control-expose-headers': '*' };

const files = new Map();   // storage stand-in: '<bucket>/<path>' -> { type, body }
const readBody = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verify(bearer);
  if (url.pathname.startsWith('/rest/v1/')) {
    const headers = { ...req.headers, host: REST.host };
    delete headers.origin; delete headers.referer;
    if (claims) headers.authorization = `Bearer ${bearer}`; else delete headers.authorization;   // the app's publishable key is not a JWT: that is an anonymous request
    const up = http.request({ host: REST.hostname, port: REST.port, path: url.pathname.replace('/rest/v1', '') + url.search, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
      r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
    return req.pipe(up);
  }
  if (url.pathname.startsWith('/storage/v1/object/')) {
    const rest = decodeURIComponent(url.pathname.slice('/storage/v1/object/'.length));
    const json = (code, o) => { res.writeHead(code, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'GET' && rest.startsWith('public/')) {
      const f = files.get(rest.slice('public/'.length));
      if (!f) return json(404, { message: 'not found' });
      res.writeHead(200, { ...cors, 'content-type': f.type }); return res.end(f.body);
    }
    if (!claims) return json(401, { message: 'sign in required' });
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readBody(req);
      // supabase-js sends multipart/form-data: keep only the file part's bytes
      const ct = req.headers['content-type'] ?? '';
      let body = raw, type = 'application/octet-stream';
      const m = /boundary=(.+)$/.exec(ct);
      if (m) {
        const text = raw.toString('latin1'), start = text.indexOf('\r\n\r\n', text.indexOf('filename')) + 4, end = text.lastIndexOf('\r\n--' + m[1]);
        body = raw.subarray(start, end); type = /Content-Type: ([^\r\n]+)/i.exec(text.slice(0, start))?.[1] ?? type;
      } else type = ct || type;
      files.set(rest, { type, body });
      return json(200, { Key: rest });
    }
    if (req.method === 'DELETE') {
      const bucket = rest, list = JSON.parse((await readBody(req)).toString() || '{}').prefixes ?? [];
      for (const p of list) files.delete(`${bucket}/${p}`);
      return json(200, list.map((name) => ({ name })));
    }
  }
  if (AUTH && url.pathname.startsWith('/auth/v1/')) {
    const headers = { ...req.headers, host: AUTH.host };
    const up = http.request({ host: AUTH.hostname, port: AUTH.port, path: url.pathname.replace('/auth/v1', '') + url.search, method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, { ...r.headers, ...cors });
      r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
    return req.pipe(up);
  }
  if (url.pathname === '/auth/v1/user') {
    if (!claims) { res.writeHead(401, { ...cors, 'content-type': 'application/json' }); return res.end('{"msg":"invalid token"}'); }
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id: claims.sub, aud: 'authenticated', role: 'authenticated', email: claims.email, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }));
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  res.writeHead(404, { ...cors, 'content-type': 'application/json' });
  res.end('{"msg":"not offered by the local stack"}');
}).listen(PORT, '127.0.0.1', () => console.log(`local stack on :${PORT}`));
