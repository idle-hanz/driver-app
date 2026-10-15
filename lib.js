// Data layer: IndexedDB storage + in-browser parsing (port of build_data.py). Nothing leaves the phone.
import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
export {pdfjs};
const DBN='agr-driver',ST=['kv','pdfs'];
const open=()=>new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>ST.forEach(s=>r.result.createObjectStore(s));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function tx(store,mode,fn){const db=await open();return new Promise((res,rej)=>{const t=db.transaction(store,mode),q=fn(t.objectStore(store));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})}
export const idb={get:(s,k)=>tx(s,'readonly',o=>o.get(k)),put:(s,k,v)=>tx(s,'readwrite',o=>o.put(v,k)),clear:s=>tx(s,'readwrite',o=>o.clear()),keys:s=>tx(s,'readonly',o=>o.getAllKeys())};
export async function wipe(){await idb.clear('kv');await idb.clear('pdfs')}
function parseCsv(t){const rows=[];for(const line of t.replace(/^\uFEFF/,'').split(/\r?\n/)){if(!line.trim())continue;const c=[];let cur='',q=false;
 for(const ch of line){if(ch==='"')q=!q;else if(ch===','&&!q){c.push(cur);cur=''}else cur+=ch}c.push(cur);rows.push(c)}
 const h=rows.shift()||[];return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k.trim(),(r[i]||'').trim()])))}
const KEEP=['sign_on','length','sign_off','group','section','clock_change','oc'];
// Only whitelisted columns are kept, so names/phone numbers in a file can never be stored.
export async function importCsvs(files){const st=(await idb.get('kv','notices'))||{};let pack=0,dut=0;
 for(const f of files){const rows=parseCsv(await f.text());if(!rows.length)continue;
  if('status' in rows[0]&&!('duty' in rows[0])){for(const r of rows){if(!r.notice)continue;const n=st[r.notice]||(st[r.notice]={notice:r.notice,duties:{}});
    Object.assign(n,{kind:r.kind,dates:r.dates?r.dates.split(';'):[],day:r.day,status:r.status});pack++}}
  else if('duty' in rows[0]){for(const r of rows){if(!/^\d{3}$/.test(r.duty)||!r.notice)continue;const n=st[r.notice]||(st[r.notice]={notice:r.notice,duties:{},status:'OK'});
    if(!n.kind)n.kind=r.kind;if(!n.dates||!n.dates.length)n.dates=(r.dates||'').split(';').filter(Boolean);n.day=n.day||r.day;
    n.duties[r.duty]=Object.fromEntries(KEEP.map(k=>[k,r[k]||'']));dut++}}}
 await idb.put('kv','notices',st);return{pack,dut}}
async function pageLines(page){const tc=await page.getTextContent(),rows=[];
 for(const it of tc.items){if(!it.str.trim())continue;const y=it.transform[5],x=it.transform[4];let r=rows.find(r=>Math.abs(r.y-y)<3);if(!r)rows.push(r={y,items:[]});r.items.push({x,w:it.width,s:it.str})}
 return rows.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.x-b.x).reduce((o,i,k,a)=>o+(k&&i.x-(a[k-1].x+a[k-1].w)>1?' ':'')+i.s,'').replace(/\s+/g,' ').trim())}
const PLACE=/^(\d{3}) (\d\d:\d\d)(?::? ?\d\d)? ([A-Z]{2,4}(?: (?:E|W|SG|DT|\d)(?:E|W)?\b)?)/;
function pickups(lines){const out=[];lines.forEach((l,j)=>{const m=l.match(PLACE);if(!m)return;let place=m[3],tok=place.split(' '),dir={E:'Eastbound',W:'Westbound'}[tok[tok.length-1]];
 // 'CFS DTE'/'DTW' are depot road names, not directions
 if(!dir)for(const k of lines.slice(j,j+3)){const z=[...k.matchAll(/\b([A-Z]{2,4}) (E|W)\b/g)];if(z.length){dir={E:'Eastbound',W:'Westbound'}[z[z.length-1][2]];break}}
 out.push({train:m[1],time:m[2],at:place,dir:dir||'see card',kind:tok.some(x=>/^(SG|DT)[EW]?$/.test(x))?'Depot road / sidings':'Platform'})});return out}
export async function importPdfs(files,progress){const cards=(await idb.get('kv','cards'))||{},compact=(await idb.get('kv','compact'))||{};let n=0;
 for(const f of files){const m=f.name.match(/P26(\d{3})/);if(!m)continue;const key='P26/'+m[1],rc=/^RC-/i.test(f.name),buf=await f.arrayBuffer();
  await idb.put('pdfs',f.name,new Blob([buf],{type:'application/pdf'}));
  const doc=await pdfjs.getDocument({data:new Uint8Array(buf)}).promise;
  if(rc)cards[key]={};else compact[key]={};
  for(let i=1;i<=doc.numPages;i++){progress&&progress(`${f.name}: page ${i}/${doc.numPages}`);const lines=await pageLines(await doc.getPage(i));
   if(rc){const d=lines.join('\n').match(/Duty:\s*(\d{3})/);if(!d)continue;const c=cards[key][d[1]]||(cards[key][d[1]]={pdf:f.name,pages:[],pickups:pickups(lines)});c.pages.push(i);n++}
   else for(const l of lines){const d=l.match(/^(\d{3}) \d\d:\d\d/);if(d&&!compact[key][d[1]])compact[key][d[1]]={pdf:f.name,page:i}}}
  await doc.destroy()}
 await idb.put('kv','cards',cards);await idb.put('kv','compact',compact);return n}
export async function loadData(){const st=(await idb.get('kv','notices'))||{};
 return{notices:Object.values(st).filter(n=>n.status==='OK'||n.status==='PAST'),cards:(await idb.get('kv','cards'))||{},compact:(await idb.get('kv','compact'))||{}}}
export async function renderPages(el,pdfName,pages,width){const blob=await idb.get('pdfs',pdfName);if(!blob){el.textContent='PDF not on this phone — import it in Settings.';return}
 const doc=await pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;el.innerHTML='';
 for(const p of pages){const page=await doc.getPage(p),v0=page.getViewport({scale:1}),sc=(width*(devicePixelRatio||1))/v0.width,v=page.getViewport({scale:sc});
  const c=document.createElement('canvas');c.width=v.width;c.height=v.height;c.className='rc';await page.render({canvasContext:c.getContext('2d'),viewport:v}).promise;el.appendChild(c)}}
