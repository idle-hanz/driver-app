const V='agr-v44';const CORE=['./','index.html','app.js','lib.js','style.css','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon.png','stations.json','vendor/pdf.min.mjs','vendor/pdf.worker.min.mjs'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('agr-v')&&x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
// Share target (cold-start safe): respondWith immediately; await formData + IndexedDB write complete; only then redirect.
// The page polls shareInbox briefly so a cold launch still sees the files on the first share.
function inbox(items){return new Promise((res,rej)=>{const r=indexedDB.open('agr-driver',1);r.onupgradeneeded=()=>{const db=r.result;for(const s of['kv','pdfs'])if(!db.objectStoreNames.contains(s))db.createObjectStore(s)};r.onerror=()=>rej(r.error);
 r.onsuccess=()=>{const db=r.result,t=db.transaction('kv','readwrite'),o=t.objectStore('kv'),g=o.get('shareInbox');
  g.onsuccess=()=>{try{o.put((Array.isArray(g.result)?g.result:[]).concat(items),'shareInbox')}catch(e){rej(e)}};g.onerror=()=>rej(g.error);
  t.oncomplete=()=>{db.close();res()};t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||new Error('aborted'))}})}
self.addEventListener('fetch',e=>{const u0=new URL(e.request.url);
 if(e.request.method==='POST'&&u0.origin===location.origin&&/\/share$/.test(u0.pathname)){
  e.respondWith((async()=>{let err='';try{const fd=await e.request.formData(),items=[];for(const[,f]of fd.entries())if(f&&typeof f!=='string'&&f.size)items.push({name:f.name||'shared',type:f.type||'',blob:new Blob([await f.arrayBuffer()],{type:f.type||''})});await inbox(items)}catch(x){err=String(x&&x.message||x).slice(0,200)}
   return Response.redirect(new URL('./?share=1'+(err?'&err='+encodeURIComponent(err):'')+'#set',self.registration.scope).href,303)})());return}
 if(u0.origin!==location.origin||e.request.method!=='GET')return;
 // Network first so updates show straight away; cache when offline. Live APIs and user data are never cached here.
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(res=>{if(res.ok){const c=res.clone();caches.open(V).then(x=>x.put(e.request,c))}return res}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});
