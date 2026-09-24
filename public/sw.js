const CACHE_PREFIX = 'buhurtos-shell-';
const CACHE = `${CACHE_PREFIX}v4`;
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE = SCOPE_URL.pathname;
const SHELL = [SCOPE, `${SCOPE}manifest.webmanifest`];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
])));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Cache the public shell only. Authenticated data belongs to the app's data layer.
  if (request.method !== 'GET' || request.headers.has('authorization') ||
      url.origin !== SCOPE_URL.origin || !url.pathname.startsWith(SCOPE) || url.search) return;
  const shell = SHELL.includes(url.pathname) || url.pathname === `${SCOPE}index.html`;
  const asset = url.pathname.startsWith(`${SCOPE}assets/`) || url.pathname === `${SCOPE}icon.svg`;
  if (!shell && !asset) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque' && !response.headers.get('cache-control')?.match(/no-store|private/i)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => undefined));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate' && shell) {
      const fallback = await caches.match(SCOPE);
      if (fallback) return fallback;
    }
    return new Response('Unavailable offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
self.addEventListener('sync', event => {
  if (event.tag !== 'buhurtos-sync') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) client.postMessage({ type: 'BuhurtOS_SYNC_REQUEST' });
  }));
});
