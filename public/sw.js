const CACHE='buhurtos-shell-v4';
const SCOPE_URL=new URL(self.registration.scope);
const SCOPE_PATH=SCOPE_URL.pathname;
const SHELL=[SCOPE_PATH,SCOPE_PATH+'manifest.webmanifest',SCOPE_PATH+'icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  ]));
});

function cacheableStatic(request,url,response){
  return url.origin===self.location.origin
    && response.ok
    && ['script','style','image','font','manifest'].includes(request.destination)
    && response.type!=='opaque';
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  // Supabase, authentication, Realtime and every other cross-origin response are
  // always network-only. Private event data must never enter shared Cache Storage.
  if(url.origin!==self.location.origin)return;

  if(request.mode==='navigate'){
    event.respondWith(
      fetch(request)
        .then(response=>{
          if(response.ok)caches.open(CACHE).then(cache=>cache.put(SCOPE_PATH,response.clone()));
          return response;
        })
        .catch(()=>caches.match(SCOPE_PATH).then(hit=>hit||Response.error()))
    );
    return;
  }

  if(['script','style','image','font','manifest'].includes(request.destination)){
    event.respondWith(
      caches.match(request).then(cached=>{
        const network=fetch(request).then(response=>{
          if(cacheableStatic(request,url,response))caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
          return response;
        });
        return cached||network;
      })
    );
  }
});

self.addEventListener('sync',event=>{
  if(event.tag!=='buhurtos-sync')return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    for(const client of clients)client.postMessage({type:'BuhurtOS_SYNC_REQUEST'});
  }));
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
