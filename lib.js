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
export async function renderPages(el,pdfName,pages,width,hl){const tok=(el._tok=(el._tok||0)+1);const blob=await idb.get('pdfs',pdfName);if(!blob){el.innerHTML='<p class="err">Running card PDF not on this phone — import it in Settings.</p>';return}
 const doc=await pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;if(tok!==el._tok)return;el.innerHTML='';
 for(const p of pages){const page=await doc.getPage(p),v0=page.getViewport({scale:1}),sc=(width*(devicePixelRatio||1))/v0.width,v=page.getViewport({scale:sc});
  const c=document.createElement('canvas');c.width=v.width;c.height=v.height;c.className='rc';await page.render({canvasContext:c.getContext('2d'),viewport:v}).promise;if(tok!==el._tok)return;
  if(hl){const x=c.getContext('2d'),top=(v0.height-hl.y-hl.hh*0.3)*sc,hgt=hl.hh*1.35*sc;x.fillStyle='rgba(255,220,0,0.35)';x.fillRect(0,top-hgt*0.75,c.width,hgt);x.strokeStyle='#e0a800';x.lineWidth=2*sc;x.strokeRect(1,top-hgt*0.75,c.width-2,hgt)}el.appendChild(c)}}

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
