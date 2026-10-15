const V='agr-v2';const CORE=['./','index.html','app.js','lib.js','style.css','manifest.webmanifest','icon-192.png','icon-512.png','vendor/pdf.min.mjs','vendor/pdf.worker.min.mjs'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))));self.clients.claim()});
// App shell only. Live APIs (TfL, TomTom) are never cached; user data lives in IndexedDB, not here.
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
 e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)))});
