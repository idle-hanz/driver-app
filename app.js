import {idb,wipe,importCsvs,importPdfs,loadData,renderPages} from './lib.js';
const $=s=>document.querySelector(s),DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const DEF={depot:'Arnos Grove LU depot, Palmers Road, London N11',depotLL:'',homeLL:'',journey:35,margin:15,lie:90,tt:'',
 rest:'Arnos Grove depot mess room\nCockfosters depot mess room\nYour car (parked, engine off)\nHome before leaving'};
let S=Object.assign({},DEF,LS.get('settings',{})),DATA={notices:[],cards:{},compact:{}};
const iso=d=>d.toISOString().slice(0,10),addD=(s,n)=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return iso(d)};
const sunday=s=>{const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-d.getUTCDay());return iso(d)};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const m2t=m=>{m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')},t2m=t=>{const[a,b]=t.split(':').map(Number);return a*60+b};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Strip anything that looks like a phone number or a "name" field from imported text
const scrub=s=>String(s).replace(/(\+44\s?|0)\d[\d\s]{8,12}\d/g,'').trim();
const duties=()=>LS.get('duties',{}); // {date: duty}
// Running card pick: notice whose published dates include this date -> engineering card, else normal book
function resolve(date){const duty=duties()[date];if(!duty)return null;if(!/^\d{3}$/.test(duty))return{date,duty,type:'Rest/other',notice:'',times:null,card:null};
 for(const n of DATA.notices){if(n.dates.includes(date)){const d=n.duties[duty];
   if(d||n.kind==='FULL')return{date,duty,type:'Engineering',notice:n.notice,times:d||null,card:(DATA.cards[n.notice]||{})[duty]||null,compact:(DATA.compact[n.notice]||{})[duty]||null}}}
 return{date,duty,type:'Normal',notice:'Normal duty book',times:null,card:null}}
function weekView(){const s=$('#wk').value||sunday(today());$('#wk').value=s;const du=duties();let h='';
 for(let i=0;i<7;i++){const d=addD(s,i),r=resolve(d);
  h+=`<div class="day"><div><b>${DAYS[i]}</b> <span class="muted">${d.slice(8)}/${d.slice(5,7)}</span></div><input data-d="${d}" inputmode="numeric" placeholder="Duty/RD" value="${esc(du[d]||'')}">
  <div>${r?`<span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span>${esc(r.notice)}${r.times?` · On ${r.times.sign_on} · Off ${r.times.sign_off}`:''}`:''}</div></div>`}
 $('#days').innerHTML=h;fillDays()}
function fillDays(){const s=$('#wk').value,o=[...Array(7)].map((_,i)=>{const d=addD(s,i);return`<option value="${d}">${DAYS[i]} ${d} — ${esc(duties()[d]||'no duty')}</option>`}).join('');
 for(const id of['#cardDay','#paceDay']){const v=$(id).value;$(id).innerHTML=o;if(v)$(id).value=v;else{$(id).value=today();if(!$(id).value)$(id).selectedIndex=0}}}
$('#saveWeek').onclick=()=>{const du=duties();document.querySelectorAll('#days input').forEach(i=>{const v=i.value.trim();if(v)du[i.dataset.d]=v;else delete du[i.dataset.d]});LS.set('duties',du);weekView();$('#wkMsg').textContent='Saved.'};
$('#wk').onchange=weekView;
$('#dutyFile').onchange=async e=>{const t=await e.target.files[0].text(),du=duties();let n=0;
 for(const line of t.split(/\r?\n/)){const c=line.split(/[,;\t]/).map(x=>scrub(x));const date=c.find(x=>/^\d{4}-\d\d-\d\d$/.test(x)),duty=c.find(x=>/^(\d{3}|RD|SPARE)$/i.test(x));if(date&&duty){du[date]=duty.toUpperCase();n++}}
 LS.set('duties',du);weekView();$('#wkMsg').textContent=`Loaded ${n} duties from your file (only date and duty number kept).`};
function cardView(){const r=resolve($('#cardDay').value);if(!r){$('#cardInfo').innerHTML='<p>No duty entered for this day.</p>';$('#cardPages').innerHTML='';return}
 let h=`<p><span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span> Duty <b>${esc(r.duty)}</b> · ${esc(r.notice)}</p>`;
 if(r.times)h+=`<p>On <b>${r.times.sign_on}</b> · Length ${r.times.length} · Off <b>${r.times.sign_off}</b>${r.times.clock_change==='1'?' <span class="tag eng">clock change</span>':''}</p>`;
 if(r.card&&r.card.pickups.length)h+='<table><tr><th>Train</th><th>Pick up</th><th>At</th><th>Direction</th><th>Where</th></tr>'+r.card.pickups.map(p=>`<tr><td>${p.train}</td><td><b>${p.time}</b></td><td>${esc(p.at)}</td><td>${p.dir}</td><td>${p.kind}</td></tr>`).join('')+'</table>';
 if(r.type==='Normal')h+='<p class="muted">Normal duty book not loaded yet (no normal running cards were in the notice folder).</p>';
 else if(!r.card)h+=r.compact?'<p class="muted">No RC page for this duty. Showing the compact notice page.</p>':'<p class="muted">No running card page imported for this duty.</p>';
 $('#cardInfo').innerHTML=h;const el=$('#cardPages');el.innerHTML='';const w=el.clientWidth||Math.min(innerWidth,800)-24;
 if(r.card)renderPages(el,r.card.pdf,r.card.pages,w);else if(r.compact)renderPages(el,r.compact.pdf,[r.compact.page],w)}
$('#cardDay').onchange=cardView;
const STNS={'940GZZLUASG':'Arnos Grove','940GZZLUCKS':'Cockfosters','940GZZLUOAK':'Oakwood','940GZZLUSGT':'Southgate','940GZZLUBDS':'Bounds Green','940GZZLUACT':'Acton Town','940GZZLUNFD':'Northfields','940GZZLUHR4':'Heathrow T4','940GZZLUHRC':'Heathrow T2&3','940GZZLUUXB':'Uxbridge'};
$('#stn').innerHTML=Object.entries(STNS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
async function trains(){$('#tlist').textContent='Loading…';try{const r=await fetch(`https://api.tfl.gov.uk/Line/piccadilly/Arrivals/${$('#stn').value}`);const a=(await r.json()).sort((x,y)=>x.timeToStation-y.timeToStation);
 $('#tlist').innerHTML='<table><tr><th>Due</th><th>Platform</th><th>To</th><th>Now</th></tr>'+a.slice(0,16).map(t=>`<tr><td>${Math.round(t.timeToStation/60)} min</td><td>${esc(t.platformName)}</td><td>${esc(t.towards||t.destinationName)}</td><td class="muted">${esc(t.currentLocation)}</td></tr>`).join('')+'</table>'}
 catch(e){$('#tlist').textContent='No live data (offline?).'}}
$('#refT').onclick=trains;$('#stn').onchange=trains;
async function journeyMin(){if(S.tt&&S.homeLL&&S.depotLL){try{const r=await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${S.homeLL}:${S.depotLL}/json?traffic=true&key=${encodeURIComponent(S.tt)}`);const j=await r.json();return{m:Math.ceil(j.routes[0].summary.travelTimeInSeconds/60),src:'TomTom live traffic'}}catch(e){}}return{m:+S.journey,src:'usual journey time'}}
let lastPace=null;
async function paceView(){const r=resolve($('#paceDay').value);rest();$('#paceOut').innerHTML='';if(!r||!r.times){$('#paceOut').innerHTML=r?'<p>Sign-on time not known for a normal-book duty yet. Enter it below.</p><input id="manOn" placeholder="Sign on HH:MM">':'<p>No duty entered.</p>';
  const m=$('#manOn');if(m)m.onchange=()=>{lastPace=null;calc(m.value)};return}calc(r.times.sign_on)}
async function calc(on){if(!/^\d\d:\d\d$/.test(on))return;const j=await journeyMin(),leave=t2m(on)-j.m-(+S.margin),lie=leave-(+S.lie);lastPace={leave,lie};
 $('#paceOut').innerHTML=(document.getElementById('manOn')?$('#paceOut').innerHTML:'')+`<p>Sign on <b>${on}</b></p><p>Leave by</p><div class="big">${m2t(leave)}</div><p class="muted">${j.m} min (${j.src}) + ${S.margin} min margin</p><p>Lie down at <b>${m2t(lie)}</b> (${S.lie} min before leaving)</p>`}
function alarm(min,label){const h=Math.floor(((min%1440)+1440)%1440/60),m=((min%1440)+1440)%1440%60;
 location.href=`intent://alarm#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${h};i.android.intent.extra.alarm.MINUTES=${m};S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(label)};end`}
$('#alarmBtn').onclick=()=>lastPace&&alarm(lastPace.lie,'Lie down');$('#leaveAlarm').onclick=()=>lastPace&&alarm(lastPace.leave,'Leave for AGR');
$('#drive').onclick=()=>{location.href='https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination='+encodeURIComponent(S.depotLL||S.depot)};
$('#paceDay').onchange=paceView;
function rest(){$('#rest').innerHTML=S.rest.split('\n').filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join('')}
const hours=()=>LS.get('hours',[]);
function hoursView(){$('#hTab').innerHTML='<tr><th>Date</th><th>Duty</th><th>OT</th><th>Finish</th><th>Train</th><th></th></tr>'+hours().map((h,i)=>`<tr><td>${h.date}</td><td>${esc(h.duty)}</td><td>${h.ot}</td><td>${esc(h.finish)}</td><td>${esc(h.train)}</td><td><button data-i="${i}" class="del">✕</button></td></tr>`).join('');
 document.querySelectorAll('.del').forEach(b=>b.onclick=()=>{if(confirm('Delete entry?')){const a=hours();a.splice(+b.dataset.i,1);LS.set('hours',a);hoursView()}})}
$('#hDate').value=today();$('#hDate').onchange=()=>{$('#hDuty').value=duties()[$('#hDate').value]||''};$('#hDuty').value=duties()[today()]||'';
$('#hAdd').onclick=()=>{const a=hours();a.push({date:$('#hDate').value,duty:scrub($('#hDuty').value),ot:+$('#hOT').value||0,finish:$('#hFin').value,train:scrub($('#hTrain').value),note:scrub($('#hNote').value)});a.sort((x,y)=>x.date.localeCompare(y.date));LS.set('hours',a);hoursView()};
$('#hCsv').onclick=()=>{const q=v=>'"'+String(v).replace(/"/g,'""')+'"';const csv='date,duty,overtime_min,finish_point,booking_off_train,notes\n'+hours().map(h=>[h.date,h.duty,h.ot,h.finish,h.train,h.note].map(q).join(',')).join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`hours-${today()}.csv`;a.click()};
const SF={sDepot:'depot',sDepotLL:'depotLL',sHomeLL:'homeLL',sJourney:'journey',sMargin:'margin',sLie:'lie',sTT:'tt',sRest:'rest'};
function setView(){for(const[i,k]of Object.entries(SF))$('#'+i).value=S[k]}
$('#saveSet').onclick=()=>{for(const[i,k]of Object.entries(SF))S[k]=$('#'+i).value.trim();LS.set('settings',S);$('#setMsg').textContent='Saved.'};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,section').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.t).classList.add('on');
 ({card:cardView,trains,pace:paceView,hours:hoursView,set:setView,week:weekView})[b.dataset.t]()});
async function reload(){DATA=await loadData();summary()}
function summary(){const n=DATA.notices.length,c=Object.values(DATA.cards).reduce((a,v)=>a+Object.keys(v).length,0);$('#dataSummary').textContent=`On this phone: ${n} notices, ${c} running cards.`}
$('#fCsv').onchange=async e=>{const r=await importCsvs([...e.target.files]);await reload();$('#impMsg').textContent=`Imported ${r.pack} notice list rows and ${r.dut} duties.`;weekView();e.target.value=''};
$('#fPdf').onchange=async e=>{const n=await importPdfs([...e.target.files],m=>$('#impMsg').textContent='Reading '+m);await reload();$('#impMsg').textContent=`Imported ${e.target.files.length} PDFs (${n} running card pages).`;weekView();e.target.value=''};
$('#clearData').onclick=async()=>{if(!confirm('Delete all notices, PDFs, duties, hours and settings from this phone?'))return;await wipe();localStorage.clear();location.reload()};
reload().then(()=>{const w=new URLSearchParams(location.search).get('week');if(w)$('#wk').value=w;weekView();cardView()});
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');
