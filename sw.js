const VERSION='12';
const CACHE='workers-ledger-v'+VERSION;
const FILES=['./','./index.html','./style.css','./app.js','./ledger.js','./storage.js','./i18n.js','./report.js','./transfer.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(
 caches.open(CACHE).then(cache=>cache.addAll(FILES.map(file=>new Request(new URL(file,self.registration.scope),{cache:'reload'})))).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('workers-ledger-')&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
 for(const client of await self.clients.matchAll({type:'window'}))client.postMessage({type:'UPDATE_READY',version:VERSION});
})()));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==location.origin)return;
 const url=new URL(event.request.url);
 // The recovery page must always bypass application caches.
 if(url.pathname.endsWith('/update.html')){event.respondWith(fetch(new Request(event.request,{cache:'no-store'})));return;}
 if(event.request.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(new Request(event.request,{cache:'no-cache'}));
    if(response.ok){const cache=await caches.open(CACHE);await cache.put(new URL('./',self.registration.scope).href,response.clone());return response;}
    throw Error('navigation');
   }catch{
    return (await caches.match(new URL('./',self.registration.scope).href))||(await caches.match(new URL('index.html',self.registration.scope).href))||Response.error();
   }
  })());return;
 }
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});
