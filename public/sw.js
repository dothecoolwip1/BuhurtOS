/* BuhurtOS service worker: the app opens and scores with no signal after one visit. */
const BUILD_ID = 'dev';
const PRECACHE = [];
const CACHE = 'bos-' + BUILD_ID;
const FONTS = 'bos-fonts';
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
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bos-') && k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
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
