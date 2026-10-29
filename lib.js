// Data layer: IndexedDB storage + in-browser parsing (port of build_data.py). Nothing leaves the phone.
import * as pdfjs from './vendor/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
export {pdfjs};
const DBN='agr-driver',ST=['kv','pdfs'];
const open=()=>new Promise((res,rej)=>{const r=indexedDB.open(DBN,1);r.onupgradeneeded=()=>ST.forEach(s=>r.result.createObjectStore(s));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function tx(store,mode,fn){const db=await open();return new Promise((res,rej)=>{const t=db.transaction(store,mode),q=fn(t.objectStore(store));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})}
export const idb={get:(s,k)=>tx(s,'readonly',o=>o.get(k)),put:(s,k,v)=>tx(s,'readwrite',o=>o.put(v,k)),clear:s=>tx(s,'readwrite',o=>o.clear()),keys:s=>tx(s,'readonly',o=>o.getAllKeys()),del:(s,k)=>tx(s,'readwrite',o=>o.delete(k))};
export async function wipe(){await idb.clear('kv');await idb.clear('pdfs')}
function parseCsv(t){const rows=[];for(const line of t.replace(/^\uFEFF/,'').split(/\r?\n/)){if(!line.trim())continue;const c=[];let cur='',q=false;
 for(const ch of line){if(ch==='"')q=!q;else if(ch===','&&!q){c.push(cur);cur=''}else cur+=ch}c.push(cur);rows.push(c)}
 const h=rows.shift()||[];return rows.map(r=>Object.fromEntries(h.map((k,i)=>[k.trim(),(r[i]||'').trim()])))}
const KEEP=['tmi','sign_on','length','sign_off','group','section','clock_change','oc'];
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
 for(const it of tc.items){if(!it.str.trim())continue;const y=it.transform[5],x=it.transform[4];let r=rows.find(r=>Math.abs(r.y-y)<3);if(!r)rows.push(r={y,hh:0,items:[]});r.hh=Math.max(r.hh,it.height||0);r.items.push({x,w:it.width,s:it.str})}
 rows.sort((a,b)=>b.y-a.y);const out=rows.map(r=>r.items.sort((a,b)=>a.x-b.x).reduce((o,i,k,a)=>o+(k&&i.x-(a[k-1].x+a[k-1].w)>1?' ':'')+i.s,'').replace(/\s+/g,' ').trim());
 out.hl=rows.map(r=>({y:r.y,hh:r.hh||10}));out.ph=page.view[3];return out}
// ---- Weekly Display Sheet (TCOP roster) — parse on the phone, keep only this driver's duties ----
// The PDF lists every driver. We never store the PDF, never keep names, and never keep anyone else's staff number.
export function looksLikeWds(pages){return pages.flat().some(l=>/WEEKLY DISPLAY SHEET/i.test(l))}
export function mapWdsCode(tok){const t=String(tok||'').trim().toUpperCase();if(!t)return{code:'',flag:'empty'};
 if(t==='R'||t==='RD'||t==='REST')return{code:'RD',flag:''};
 if(t==='**AL'||t==='AL'||/^\*\*AL/.test(t))return{code:'AL',flag:''};
 if(/^\d{3}[A-Z0-9]?$/.test(t))return{code:t.slice(0,3),flag:''};
 if(t==='NOT'||t==='ASSIGNED')return{code:'',flag:'Not assigned'};
 return{code:'',flag:t.replace(/^\?\?/,'')}}
/** Find this driver's week. staffNo is the 8-digit number saved in Settings. Returns duties only — no names. */
export function findWdsRow(pages,staffNo){const want=String(staffNo||'').replace(/\D/g,'');if(!/^\d{8}$/.test(want))return{err:'staff'};
 const lines=pages.flat().map(l=>String(l||'').replace(/\s+/g,' ').trim()).filter(Boolean);
 let dates=null,weekEnding=null;
 for(let i=0;i<lines.length;i++){const l=lines[i];
  if(/WEEK ENDING:\s*\d{2}\.\d{2}\.\d{4}/.test(l)){const m=l.match(/WEEK ENDING:\s*(\d{2})\.(\d{2})\.(\d{4})/);if(m)weekEnding=`${m[3]}-${m[2]}-${m[1]}`}
  if(/^Employee\b/.test(l)&&/\d{2}\.\d{2}\.\d{4}/.test(l)){dates=[...l.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)].map(m=>`${m[3]}-${m[2]}-${m[1]}`)}
  const sm=l.match(/^(\d{8})\b/);if(!sm||sm[1]!==want)continue;
  if(!dates||dates.length!==7)return{err:'dates'};
  const prev=lines[i-1]||'';const rm=prev.match(/^(\d{3})\s+(.+)$/)||prev.match(/^(\d{3})$/);
  if(!rm)return{err:'row'};
  const raw=(rm[2]||'').trim()?rm[2].trim().split(/\s+/):[];
  // Pad / trim to 7 day slots; ignore a trailing 'Not' 'assigned' pair by collapsing
  let toks=raw.slice();
  if(toks.length>7){const flat=[];for(let k=0;k<toks.length;k++){if(toks[k]==='Not'&&toks[k+1]==='assigned'){flat.push('UNAV');k++}else flat.push(toks[k])}toks=flat}
  while(toks.length<7)toks.push('');
  toks=toks.slice(0,7);
  const days=toks.map((t,di)=>{const m=mapWdsCode(t);return{date:dates[di],raw:t,code:m.code,flag:m.flag}});
  // Never return name, never return other staff numbers, never return the matched staff number in clear form beyond confirmation that it matched
  return{ok:true,rota:rm[1],weekEnding:weekEnding||dates[6],dates,days}}
 return{err:'missing'}}
export async function readPdfPages(file,progress){const buf=await file.arrayBuffer(),head=new TextDecoder().decode(new Uint8Array(buf.slice(0,5)));
 if(head!=='%PDF-')throw new Error('not a PDF');
 const doc=await pdfjs.getDocument({data:new Uint8Array(buf.slice(0))}).promise,pages=[];
 try{for(let i=1;i<=doc.numPages;i++){progress&&progress(`page ${i}/${doc.numPages}`);pages.push(await pageLines(await doc.getPage(i)))}}
 finally{try{await doc.destroy()}catch(e){}}
 return pages}

const PLACE=/^(\d{3}) (\d\d:\d\d)(?::? ?\d\d)? ([A-Z]{2,4}(?: (?:E|W|SG|DT|\d)(?:E|W)?\b)?)/;
export function meals(lines){const out=[],seen=new Set();for(const m of lines.join('\n').matchAll(/Meal\s+Relief\s+(\d\d:\d\d)\s+to\s+(\d\d:\d\d)\s+at\s+([A-Z][A-Za-z ]{1,20}?)(?=\s{2,}|\s*$|\s+\d|\n)/gim)){const k=m[1]+m[2];if(seen.has(k))continue;seen.add(k);out.push({from:m[1],to:m[2],at:m[3].trim()})}return out}
// Every timing point (time + place) in a trip block, in card order: departures and arrivals, e.g. 10:29 CFS, 10:49 AGR W
const PT=/(\d\d:\d\d)(?::?\s?\d\d(?=\s))?\s+(?:(?:Ety|Stand)\s+)?([A-Z]{2,4}(?: (?:E|W|SG|DT|\d)(?:E|W)?)?)\b/g;
function timingPoints(lines,j){const blk=[];for(let k=j;k<lines.length;k++){const t=lines[k];if(k>j&&PLACE.test(t))break;if(/Relieved at|Finish at/.test(t))break;blk.push(t.replace(/Meal\s+Relief.*$/i,''))}
 const txt=blk.join(' ').replace(/^\d{3} /,''),out=[];for(const m of txt.matchAll(PT)){if(/^(ETY|STAND)$/i.test(m[2]))continue;const last=out[out.length-1];if(last&&last.t===m[1]&&last.at===m[2])continue;const d=(m[2].match(/ (E|W)$/)||[])[1];out.push({t:m[1],at:m[2],dir:d==='E'?'Eastbound':d==='W'?'Westbound':''})}return out}
function pickups(lines){const out=[];lines.forEach((l,j)=>{const m=l.match(PLACE);if(!m)return;let relief='',endAt='';for(const k of [l,...lines.slice(j+1)]){if(k!==l&&PLACE.test(k))break;const rr=k.match(/Relieved at (\d\d:\d\d)/);if(rr){relief=rr[1];break}
  const ms=[...k.matchAll(/(?:\d\d:\d\d(?::? ?\d\d)?\s+)([A-Z]{2,4}(?: (?:E|W|SG|DT|\d)(?:E|W)?)?)\b/g)];if(ms.length)endAt=ms[ms.length-1][1];else{const bare=k.match(/^([A-Z]{2,4}(?: (?:E|W|SG|DT|\d)(?:E|W)?)?)$/);if(bare)endAt=bare[1]}}let place=m[3],tok=place.split(' '),dir={E:'Eastbound',W:'Westbound'}[tok[tok.length-1]];
 // 'CFS DTE'/'DTW' are depot road names, not directions
 if(!dir)for(const k of lines.slice(j,j+3)){const z=[...k.matchAll(/\b([A-Z]{2,4}) (E|W)\b/g)];if(z.length){dir={E:'Eastbound',W:'Westbound'}[z[z.length-1][2]];break}}
 // Reverser rule: bare station (no E/W/SG/DT) + Stand = train arrives in the opposite direction to the one it departs in
 let rev='';if(tok.length===1&&tok[0]==='CFS'&&!/\bStand\b/.test(l)&&!/^\s*Stand\b/.test(lines[j+1]||''))dir='Westbound'; // Cockfosters is a terminus: a bare CFS start departs westbound
 if(tok.length===1&&(/\bStand\b/.test(l)||/^(\d\d:\d\d(:\d\d)? )?Stand\b/.test(lines[j+1]||''))){let dep=null;for(const k of lines.slice(j+1,j+6)){const z=[...k.matchAll(/\b([A-Z]{2,4}) (E|W)\b/g)];if(z.length){dep=z[0][2];break}}
  if(dep){rev={E:'Eastbound',W:'Westbound'}[dep];dir={E:'Westbound',W:'Eastbound'}[dep]}}
 out.push({train:m[1],time:m[2],at:place,dir:dir||'see card',rev,relief,endAt,pts:timingPoints(lines,j),kind:tok.some(x=>/^(SG|DT)[EW]?$/.test(x))?'Depot road / sidings':'Platform'})});return out}
// Lenient: works with renamed copies ("RC-P26145-AGR (1).pdf", "document.pdf"), empty MIME types, and any import order.
const DAYN={Sunday:'Sun',Monday:'Mon',Tuesday:'Tue',Wednesday:'Wed',Thursday:'Thu',Friday:'Fri',Saturday:'Sat'};
function guessNotice(name,text,notices,rcPages){
 let m=name.match(/P\s*26\s*[-_/ ]?\s*(\d{3})/i)||text.match(/P26\/(\d{3})/);if(m)return'P26/'+m[1];
 // RC books don't print the notice number: match duty, weekday and sign-on against the imported CSVs
 const score={};for(const p of rcPages)for(const n of Object.values(notices)){const d=n.duties&&n.duties[p.duty];if(d&&d.sign_on===p.on&&(!p.day||p.day===n.day))score[n.notice]=(score[n.notice]||0)+1}
 const best=Object.entries(score).sort((a,b)=>b[1]-a[1])[0];return best?best[0]:null}

// ---- Normal (current) duty book: detected by content ("DUTY BOOK" + "Duty: NNN <day type> Duty Length") or "Duty Book" in the name ----
const WD={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};
export function dayTypeDays(dt){const out=new Set();for(const part of dt.split('&')){const r=part.trim().toLowerCase().match(/^(\w{3})\w*(?:\s*-\s*(\w{3})\w*)?$/);if(!r||!(r[1] in WD))continue;
 const a=WD[r[1]],b=r[2]&&r[2] in WD?WD[r[2]]:a;for(let d=a;;d=(d+1)%7){out.add(d);if(d===b)break}}return[...out].sort()}
const MON={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
function isoFrom(d,m,y){return`${y}-${String(MON[m.toLowerCase()]).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
const COVER_ROW=/^(\d{3}) (\d\d:\d\d) ([A-Z]{2,4}) (.+?) (\d\d:\d\d) ?(\*|[A-Z]{2,4}(?: DT)?)? (\d\d:\d\d)$/;
function coverTable(lines,pi){const out=[];let note='';for(const l of lines){const n=l.match(/^\*:?\s*(These.*may finish.*)$/i);if(n&&!note)note=n[1]}
 lines.forEach((l,j)=>{const m=l.match(COVER_ROW);if(!m)return;let desc=m[4];const nx=lines[j+1]||'';if(/^and\/or /i.test(nx))desc+=' '+nx;
  out.push({duty:m[1],on:m[2],from:m[3],desc,finish:m[5],finishAt:m[6]||'',length:m[7],note:m[6]==='*'?note:'',pages:[pi+1],hl:{y:lines.hl[j].y,hh:lines.hl[j].hh,ph:lines.ph},cover:true,pickups:[]})});return out}
function parseDutyBook(name,pages){const first=pages.slice(0,3).flat().join(' ');
 const v=first.match(/From (\d{1,2}) ([A-Za-z]+) (\d{4}) until (\d{1,2}) ([A-Za-z]+) (\d{4})/i),tn=first.match(/Notice (\d{2,4})/i);
 const duties=[],covers=[];pages.forEach((lines,pi)=>{let cur=null;for(const l of lines){const m=l.match(/^Duty:\s*(\d{3}) (.+?) Duty Length:\s*(\d\d:\d\d)/);
  if(m){cur={duty:m[1],dt:m[2].trim(),days:dayTypeDays(m[2]),length:m[3],pages:[pi+1],lines:[]};duties.push(cur);continue}if(cur)cur.lines.push(l)}
  if(lines.some(l=>/^Cover Duties$/i.test(l))){for(const c of coverTable(lines,pi)){c.tablePage=pi+1;covers.push(c)}}});
 // A cover table belongs to the book section it ends: its weekdays = all duty headers since the previous cover table
 let prev=0;const tpages=[...new Set(covers.map(c=>c.tablePage))].sort((a,b)=>a-b),secDays={};
 for(const tp of tpages){const cnt=[0,0,0,0,0,0,0];for(const d of duties)if(d.pages[0]>prev&&d.pages[0]<=tp)d.days.forEach(x=>cnt[x]++);const mx=Math.max(...cnt);secDays[tp]=cnt.map((c,i)=>c>=mx/2&&c>0?i:-1).filter(i=>i>=0);prev=tp}
 const DN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 for(const c of covers){c.days=secDays[c.tablePage]||[];c.dt='Cover duty ('+(c.days.length>1?DN[c.days[0]]+' - '+DN[c.days[c.days.length-1]]:DN[c.days[0]]||'?')+')';delete c.tablePage}
 for(const d of duties){const t=d.lines.join('\n');const om=t.match(/On:\s*(\d\d:\d\d)(?:\s+([A-Z]{2,4}))?/)||[];d.on=om[1]||'';d.onAt=om[2]||'';d.finish=(t.match(/Finish:\s*(\S+)/)||[])[1]||'';
  const fm=t.match(/Finish:\s*\S+ \*/),nt=t.match(/\*:?\s*(This duty may finish[^\n]*)/i);if(fm&&nt)d.note=nt[1];if(/Spare Day on the Rota/i.test(t))d.spare=true;d.pickups=pickups(d.lines);d.meals=meals(d.lines);delete d.lines}
 return{name,timetable:tn?tn[1]:'',from:v?isoFrom(v[1],v[2],v[3]):'',until:v?isoFrom(v[4],v[5],v[6]):'',duties:duties.filter(d=>d.days.length).concat(covers.filter(c=>c.days.length))}}
function looksLikeDutyBook(name,pages){const t=pages.slice(0,3).flat().join(' ');const hdr=pages.flat().some(l=>/^Duty:\s*\d{3} .+ Duty Length:/.test(l));
 return hdr&&(/duty\s*book/i.test(name)||/DUTY BOOK/i.test(t))&&!/P\s*26\s*[-_/ ]?\s*\d{3}/i.test(name)}
export const PARSER_VERSION=8;
// 'To manager's instructions' spare turns: 'TO MANAGER'S INSTRUCTIONS' (P26 compact lines), 'MGR INSTR.', 'Duty Managers Instructions', 'DMI'
export const TMI=/MANAGER'?S?\s+INSTRUCTIONS|MGR\.?\s*INSTR|DUTY\s+MANAGER'?S?'?\s+INSTR|\bDMI\b/i;
export async function importPdfs(files,progress){const cards=(await idb.get('kv','cards'))||{},compact=(await idb.get('kv','compact'))||{},notices=(await idb.get('kv','notices'))||{};
 const sum={files:files.length,pdfs:0,rcPages:0,compactPages:0,errors:[],normal:null};
 try{if(navigator.storage&&navigator.storage.persist)await navigator.storage.persist()}catch(e){}
 for(const f of files){try{
  const buf=await f.arrayBuffer(),head=new TextDecoder().decode(new Uint8Array(buf.slice(0,5)));
  if(head!=='%PDF-'){sum.errors.push(`${f.name}: not a PDF`);continue}
  const blob=new Blob([buf],{type:'application/pdf'}),doc=await pdfjs.getDocument({data:new Uint8Array(buf.slice(0))}).promise;
  const pages=[];for(let i=1;i<=doc.numPages;i++){progress&&progress(`${f.name}: page ${i}/${doc.numPages}`);pages.push(await pageLines(await doc.getPage(i)))}
  await doc.destroy();
  if(looksLikeWds(pages)){sum.wds=(sum.wds||[]).concat(f.name);continue}
  if(looksLikeDutyBook(f.name,pages)){const nb=parseDutyBook(f.name,pages);nb.pdf='NORMAL-'+(nb.timetable||'book')+'.pdf';await idb.put('pdfs',nb.pdf,blob);
   const books=((await idb.get('kv','normal'))||[]).filter(b=>b.pdf!==nb.pdf&&!(nb.timetable&&b.timetable===nb.timetable)&&!(nb.from&&b.from&&b.from<=nb.until&&nb.from<=b.until));/* a replacement book supersedes overlapping ones */books.push(nb);await idb.put('kv','normal',books);sum.pdfs++;
   const types=[...new Set(nb.duties.filter(d=>!d.cover).map(d=>d.dt))],nc=nb.duties.filter(d=>d.cover).length;sum.normal=(sum.normal||[]).concat(`Normal duty book${nb.timetable?' '+nb.timetable:''}: ${nb.duties.length-nc} duty cards + ${nc} cover duties (${[...new Set(nb.duties.filter(d=>d.cover).map(d=>d.dt))].join(', ')}), day types ${types.join(', ')}${nb.from?` (valid ${nb.from} to ${nb.until})`:''}`);continue}
  const rcPages=pages.map((l,i)=>{const t=l.join('\n'),d=t.match(/Duty:\s*(\d{3})\s*([A-Za-z]+)?/),on=t.match(/On:\s*(\d\d:\d\d)(?:\s+([A-Z]{2,4}))?/);return d?{i:i+1,duty:d[1],day:DAYN[d[2]]||'',on:on&&on[1],onAt:on&&on[2]||'',lines:l}:null}).filter(Boolean);
  const isRc=rcPages.length>0,key=guessNotice(f.name,pages.flat().join('\n'),notices,rcPages);
  if(!key){sum.errors.push(`${f.name}: could not tell which notice this is — import the CSVs first, then this PDF again`);continue}
  const id=(isRc?'RC-':'C-')+key.replace('/','')+'.pdf';await idb.put('pdfs',id,blob);sum.pdfs++;
  if(isRc){cards[key]={};for(const p of rcPages){const c=cards[key][p.duty]||(cards[key][p.duty]={pdf:id,onAt:p.onAt,pages:[],pickups:pickups(p.lines),meals:[]});for(const m of meals(p.lines))if(!c.meals.some(x=>x.from===m.from))c.meals.push(m);c.pages.push(p.i);sum.rcPages++}}
  else{compact[key]={};pages.forEach((ls,i)=>{for(const l of ls){const d=l.match(/^(\d{3}) (\d\d:\d\d)(?: ([A-Z]{2,4}))?/);if(d&&!compact[key][d[1]]){const j=ls.indexOf(l);compact[key][d[1]]={pdf:id,page:i+1,on:d[2],onAt:d[3]||'',tmi:TMI.test(l),hl:{y:ls.hl[j].y,hh:ls.hl[j].hh,ph:ls.ph}};sum.compactPages++}}})}
 }catch(e){sum.errors.push(`${f.name}: ${e&&e.name==='QuotaExceededError'?'phone storage full':(e&&e.message)||e}`)}}
 await idb.put('kv','cards',cards);await idb.put('kv','compact',compact);await idb.put('kv','parserVersion',PARSER_VERSION);return sum}
export async function loadData(){const st=(await idb.get('kv','notices'))||{};
 return{normal:(await idb.get('kv','normal'))||[],notices:Object.values(st).filter(n=>n.status==='OK'||n.status==='PAST'),cards:(await idb.get('kv','cards'))||{},compact:(await idb.get('kv','compact'))||{}}}
// Duty sheet drawing. Kept robust because Android can wipe a canvas when the app is backgrounded or the screen locks
// (2D canvas context loss), and memory pressure can make a render fail. The last request is remembered on the element so
// ensureSheet() can redraw it; pdf.js documents are cached (max 2) and destroyed when evicted instead of leaking one per render.
const docCache=new Map();
async function openDoc(name,fresh){if(fresh&&docCache.has(name)){try{(await docCache.get(name)).destroy()}catch(e){}docCache.delete(name)}
 if(!docCache.has(name)){const pr=(async()=>{const blob=await idb.get('pdfs',name);if(!blob)return null;return pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise})();docCache.set(name,pr);pr.catch(()=>docCache.delete(name));
  while(docCache.size>2){const [k,v]=docCache.entries().next().value;docCache.delete(k);v.then(d=>d&&d.destroy()).catch(()=>{})}}
 const d=await docCache.get(name);if(!d)docCache.delete(name);return d}
export function dropDocs(){for(const v of docCache.values())v.then(d=>d&&d.destroy()).catch(()=>{});docCache.clear()}
export async function renderPages(el,pdfName,pages,width,hl){el._sheet={pdfName,pages,width,hl};const tok=(el._tok=(el._tok||0)+1);
 if(!el.querySelector('canvas.rc'))el.innerHTML='<p class="muted sheetwait">Loading duty sheet…</p>';
 for(let attempt=0;attempt<2;attempt++){try{
  const doc=await openDoc(pdfName,attempt>0);if(tok!==el._tok)return;if(!doc){el.innerHTML='<p class="err">Running card PDF not on this phone — import it in Settings.</p>';return}
  const out=[];for(const p of pages){const page=await doc.getPage(p),v0=page.getViewport({scale:1}),sc=(width*(devicePixelRatio||1))/v0.width,v=page.getViewport({scale:sc});
   const c=document.createElement('canvas');c.width=v.width;c.height=v.height;c.className='rc';await page.render({canvasContext:c.getContext('2d'),viewport:v}).promise;if(tok!==el._tok)return;
   if(hl){const x=c.getContext('2d'),top=(v0.height-hl.y-hl.hh*0.3)*sc,hgt=hl.hh*1.35*sc;x.fillStyle='rgba(255,220,0,0.35)';x.fillRect(0,top-hgt*0.75,c.width,hgt);x.strokeStyle='#e0a800';x.lineWidth=2*sc;x.strokeRect(1,top-hgt*0.75,c.width-2,hgt)}
   // a wiped canvas is redrawn as soon as the browser gives it back
   c.addEventListener('contextlost',()=>{el._lost=true});c.addEventListener('contextrestored',()=>{el._lost=false;ensureSheet(el,true)});out.push(c)}
  el.innerHTML='';out.forEach(c=>el.appendChild(c));el._lost=false;return}
 catch(e){if(tok!==el._tok)return;if(attempt===1){sheetFail(el,e);return}}}}
function sheetFail(el,e){el.innerHTML=`<p class="err">Could not draw the duty sheet${e&&e.message?' ('+String(e.message).slice(0,120).replace(/[<>&]/g,'')+')':''}.</p><button class="b" type="button">Show duty sheet</button>`;el.querySelector('button').onclick=()=>ensureSheet(el,true)}
// Redraw the remembered sheet if the container is empty, lost its canvas, or force is set
export function ensureSheet(el,force){const s=el&&el._sheet;if(!s)return false;const cs=[...el.querySelectorAll('canvas.rc')];
 const bad=force||el._lost||!cs.length||cs.some(c=>!c.width||(c.getContext('2d').isContextLost&&c.getContext('2d').isContextLost()));if(!bad)return false;
 renderPages(el,s.pdfName,s.pages,s.width,s.hl);return true}


// Re-run the current parser over the PDFs already stored on this device (no re-import needed)
export async function reparseIfOld(){const v=(await idb.get('kv','parserVersion'))||0;if(v>=PARSER_VERSION)return null;
 const ids=await idb.keys('pdfs');if(!ids.length){await idb.put('kv','parserVersion',PARSER_VERSION);return null}
 const files=[];for(const id of ids){const b=await idb.get('pdfs',id);if(b)files.push(new File([b],id,{type:'application/pdf'}))}
 // normal books first is not required; RC/compact keyed by notice, books keyed by id
 return importPdfs(files)}

// ---- Delete old files: only items whose end date (from the files themselves) is before today, or a duty book replaced by a newer one already in force ----
export async function oldFiles(today){const notices=(await idb.get('kv','notices'))||{},cards=(await idb.get('kv','cards'))||{},compact=(await idb.get('kv','compact'))||{},books=(await idb.get('kv','normal'))||[],pdfs=new Set(await idb.keys('pdfs')),out=[];
 const keys=new Set([...Object.keys(notices),...Object.keys(cards),...Object.keys(compact)]);
 for(const k of [...keys].sort()){const ds=((notices[k]||{}).dates||[]).filter(Boolean).sort();if(!ds.length)continue;const end=ds[ds.length-1];if(end>=today)continue;const id=k.replace('/','');
  const files=[];if(notices[k])files.push({kind:'csv',label:`Notice ${k} (from CSV)`});if(pdfs.has('C-'+id+'.pdf'))files.push({kind:'pdf',id:'C-'+id+'.pdf',label:`Notice ${k} PDF`});if(pdfs.has('RC-'+id+'.pdf'))files.push({kind:'pdf',id:'RC-'+id+'.pdf',label:`Running cards ${k} PDF`});
  out.push({type:'notice',key:k,dates:ds,end,files})}
 for(const b of books){const newer=books.find(o=>o!==b&&o.from&&b.from&&o.from>b.from&&o.from<=today);if((b.until&&b.until<today)||newer)out.push({type:'book',key:b.pdf,timetable:b.timetable,from:b.from,until:b.until,why:newer?`replaced by book ${newer.timetable}`:'ended',files:[{kind:'pdf',id:b.pdf,label:`Duty book ${b.timetable}`}]})}
 return out}
export async function deleteOld(list){const notices=(await idb.get('kv','notices'))||{},cards=(await idb.get('kv','cards'))||{},compact=(await idb.get('kv','compact'))||{};let books=(await idb.get('kv','normal'))||[],n=0;
 for(const it of list){for(const f of it.files){if(f.kind==='pdf')await idb.del('pdfs',f.id);n++}
  if(it.type==='notice'){delete notices[it.key];delete cards[it.key];delete compact[it.key]}else books=books.filter(b=>b.pdf!==it.key)}
 await idb.put('kv','notices',notices);await idb.put('kv','cards',cards);await idb.put('kv','compact',compact);await idb.put('kv','normal',books);return n}
