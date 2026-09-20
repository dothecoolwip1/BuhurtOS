const CACHE = 'buhurtos-shell-v3';
const SCOPE = new URL(self.registration.scope).pathname;
const SHELL = [SCOPE, `${SCOPE}manifest.webmanifest`];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match(SCOPE))));
});
self.addEventListener('sync', event => {
  if (event.tag !== 'buhurtos-sync') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) client.postMessage({ type: 'BuhurtOS_SYNC_REQUEST' });
  }));
});
