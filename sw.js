const V='agr-v37';const CORE=['./','index.html','app.js','lib.js','style.css','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon.png','stations.json','vendor/pdf.min.mjs','vendor/pdf.worker.min.mjs'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
// Network first so updates show straight away; cache when offline. Live APIs and user data are never cached here.
// Share target: Share > AGR Driver posts the PDFs here; keep them in this phone's database and open the app to import them
function inbox(items){return new Promise((res,rej)=>{const r=indexedDB.open('agr-driver',1);r.onupgradeneeded=()=>['kv','pdfs'].forEach(s=>r.result.createObjectStore(s));r.onerror=()=>rej(r.error);
 r.onsuccess=()=>{const db=r.result,t=db.transaction('kv','readwrite'),o=t.objectStore('kv'),g=o.get('shareInbox');g.onsuccess=()=>{o.put((g.result||[]).concat(items),'shareInbox')};t.oncomplete=()=>{db.close();res()};t.onerror=()=>rej(t.error)}})}
self.addEventListener('fetch',e=>{const u0=new URL(e.request.url);if(e.request.method==='POST'&&u0.origin===location.origin&&/\/share$/.test(u0.pathname)){e.respondWith((async()=>{
  try{const fd=await e.request.formData(),items=[];for(const f of fd.getAll('pdfs'))if(f&&f.size)items.push({name:f.name||'shared.pdf',blob:new Blob([await f.arrayBuffer()],{type:'application/pdf'})});await inbox(items)}catch(err){}
  return Response.redirect(new URL('./?share=1#set',self.registration.scope).href,303)})());return}});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
 e.respondWith(fetch(e.request,{cache:'no-cache'}).then(res=>{if(res.ok){const c=res.clone();caches.open(V).then(x=>x.put(e.request,c))}return res}).catch(()=>caches.match(e.request,{ignoreSearch:true})))});
