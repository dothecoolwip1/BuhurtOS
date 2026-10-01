/* BuhurtOS service worker: the app opens and scores with no signal after one visit. */
const BUILD_ID = 'dev';
const PRECACHE = [];
const CACHE = 'bos-v2-' + BUILD_ID;
const FONTS = 'bos-fonts';
const API = 'bos-api-v1';
const API_MAX = 80;
// Public Supabase reads that are safe to keep for offline use. Nothing else from the API is ever stored.
const API_TABLES = ['events', 'competitions', 'matches'];
// Live scores must not lag a poll behind, so these go to the network first and only fall back to the cache offline.
const API_NETWORK_FIRST = ['matches'];
const BASE = self.registration.scope;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([BASE, ...PRECACHE.map(p => new URL(p, BASE).href)]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bos-') && k !== CACHE && k !== FONTS && k !== API).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Web fonts: serve from cache, refresh in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONTS).then(async cache => {
      const hit = await cache.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
    return;
  }
  const table = publicApiTable(req, url);
  if (table) { event.respondWith(apiRead(event, req, table)); return; }
  if (url.origin !== self.location.origin) return;

  // Page loads: network first, fall back to the cached app so deep links open offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => { const copy = res.clone(); if (res.ok) caches.open(CACHE).then(c => c.put(BASE, copy)); return res; })
        .catch(() => caches.match(BASE).then(r => r || Response.error()))
    );
    return;
  }
  // Built files are fingerprinted: cache first.
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});

/**
 * A request is a cacheable public read only when it is a GET to /rest/v1/<allowed table> on Supabase and carries no user
 * identity. supabase-js sends the public key as the Authorization bearer for signed-out visitors, so that exact value
 * (equal to the apikey header) counts as anonymous; any other Authorization, such as a signed-in user's token, is never cached or served from cache.
 */
function publicApiTable(req, url) {
  if (req.method !== 'GET' || !url.hostname.endsWith('.supabase.co')) return null;
  const m = /^\/rest\/v1\/([a-z_]+)\/?$/.exec(url.pathname);
  if (!m || !API_TABLES.includes(m[1])) return null;
  const auth = req.headers.get('authorization');
  const key = req.headers.get('apikey');
  if (auth && !(key && auth === 'Bearer ' + key)) return null;
  if (!auth && !key) return null;
  return m[1];
}

async function apiRead(event, req, table) {
  const cache = await caches.open(API);
  // The key is the bare URL, never the request itself, so no headers or credentials are stored with it.
  const key = new Request(req.url, { method: 'GET' });
  const refresh = () => fetch(req).then(async res => {
    if (res.status === 200 && !/no-store|private/i.test(res.headers.get('cache-control') || '')) {
      await cache.put(key, res.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - API_MAX)).map(k => cache.delete(k)));
    }
    return res;
  });
  if (API_NETWORK_FIRST.includes(table)) {
    return refresh().catch(async () => (await cache.match(key)) || Response.error());
  }
  const hit = await cache.match(key);
  const fresh = refresh();
  if (hit) { event.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}
