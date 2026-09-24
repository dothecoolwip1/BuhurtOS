const CACHE = 'buhurtos-shell-v4';
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname;
const SHELL = [SCOPE_PATH, `${SCOPE_PATH}manifest.webmanifest`];

const isSameOriginCacheable = request => {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (request.headers.has('authorization')) return false;
  return request.mode === 'navigate'
    || ['script','style','image','font','manifest'].includes(request.destination);
};

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
])));

self.addEventListener('fetch', event => {
  const { request } = event;
  if (!isSameOriginCacheable(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => response.ok ? response : Promise.reject(new Error('Navigation failed')))
        .catch(() => caches.match(SCOPE_PATH))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});

self.addEventListener('sync', event => {
  if (event.tag !== 'buhurtos-sync') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    for (const client of clients) client.postMessage({ type: 'BuhurtOS_SYNC_REQUEST' });
  }));
});
