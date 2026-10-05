/* BuhurtOS service worker: the app opens and scores with no signal after one visit, and shows push notifications (fight alerts, team and event news) when the app is closed. */
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

// Update policy (Pack 04): a new build is downloaded and then WAITS. It does not take over by itself, because activating it deletes the old
// build's cache and replaces the code under a page that may be in the middle of scoring. The page decides when it is safe (see src/lib/swUpdate.ts)
// and then sends SKIP_WAITING; the page reloads once the new worker is in control. With no old worker (the very first visit) activation is immediate.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([BASE, ...PRECACHE.map(p => new URL(p, BASE).href)])));
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (data.type === 'GET_VERSION') {
    const reply = { type: 'VERSION', buildId: BUILD_ID };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply); else if (event.source) event.source.postMessage(reply);
  }
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

// ---------------------------------------------------------------- push notifications (Pack 12)
// The server (the database picks who and what; an Edge Function delivers) sends a short encrypted JSON message: {title, body, route, tag, urgent}.
// Nothing sensitive is in it, and nothing here is needed for scoring or the queue. Every push shows a notification (browsers require it).
const ICON = new URL('icon-192.png', BASE).href;
const safeRoute = r => (typeof r === 'string' && /^\/[A-Za-z0-9/_?=&#-]*$/.test(r) && r.length < 200 ? r : '/');
const routeUrl = r => new URL(safeRoute(r).replace(/^\//, ''), BASE).href;

self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = {}; }
  const title = typeof m.title === 'string' && m.title ? m.title.slice(0, 80) : 'BuhurtOS';
  const options = {
    body: typeof m.body === 'string' ? m.body.slice(0, 200) : '',
    icon: ICON,
    badge: ICON,
    tag: typeof m.tag === 'string' && m.tag ? m.tag.slice(0, 64) : undefined,   // a newer alert for the same fight replaces the older one on the lock screen
    renotify: typeof m.tag === 'string' && !!m.tag,
    requireInteraction: m.urgent === true,
    vibrate: m.urgent === true ? [200, 100, 200] : undefined,
    data: { route: safeRoute(m.route), category: typeof m.category === 'string' ? m.category : '' }
  };
  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    // Tell any open window so the bell and My next fight refresh now.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(w => w.postMessage({ type: 'PUSH_RECEIVED' }));
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const route = safeRoute(event.notification.data && event.notification.data.route);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.find(w => w.url.startsWith(BASE));
    if (mine) {
      mine.postMessage({ type: 'NAVIGATE', route });   // the app routes in place: nothing reloads, nothing in progress is lost
      await mine.focus().catch(() => undefined);       // bringing it to the front can be refused; the route has been sent either way
      return;
    }
    await self.clients.openWindow(routeUrl(route));   // installed app closed, or a fresh browser: open straight onto the destination
  })());
});

// The browser replaced the subscription (keys rotated or expired). The app re-registers the device the next time it opens (src/lib/push.ts).
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => wins.forEach(w => w.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }))));
});
