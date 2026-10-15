import {idb,wipe,importCsvs,importPdfs,loadData,renderPages} from './lib.js';
const $=s=>document.querySelector(s),DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const DEF={depot:'Arnos Grove LU depot, Palmers Road, London N11',depotLL:'',homeLL:'',journey:35,margin:15,lie:30,ready:5,tt:'',
 rest:'Arnos Grove depot mess room\nCockfosters depot mess room\nYour car (parked, engine off)\nHome before leaving'};
const _st=LS.get('settings',{});if(_st.ready===undefined)delete _st.lie;let S=Object.assign({},DEF,_st),DATA={notices:[],cards:{},compact:{}};
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
 for(const id of['#cardDay','#paceDay','#trDay']){const v=$(id).value;$(id).innerHTML=o;if(v)$(id).value=v;else{$(id).value=today();if(!$(id).value)$(id).selectedIndex=0}}}
$('#saveWeek').onclick=()=>{const du=duties();document.querySelectorAll('#days input').forEach(i=>{const v=i.value.trim();if(v)du[i.dataset.d]=v;else delete du[i.dataset.d]});LS.set('duties',du);weekView();$('#wkMsg').textContent='Saved.'};
$('#wk').onchange=weekView;
$('#dutyFile').onchange=async e=>{const t=await e.target.files[0].text(),du=duties();let n=0;
 for(const line of t.split(/\r?\n/)){const c=line.split(/[,;\t]/).map(x=>scrub(x));const date=c.find(x=>/^\d{4}-\d\d-\d\d$/.test(x)),duty=c.find(x=>/^(\d{3}|RD|SPARE)$/i.test(x));if(date&&duty){du[date]=duty.toUpperCase();n++}}
 LS.set('duties',du);weekView();$('#wkMsg').textContent=`Loaded ${n} duties from your file (only date and duty number kept).`};
function cardView(){const r=resolve($('#cardDay').value);if(!r){$('#cardInfo').innerHTML='<p>No duty entered for this day.</p>';$('#cardPages').innerHTML='';return}
 let h=`<p><span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span> Duty <b>${esc(r.duty)}</b> · ${esc(r.notice)}</p>`;
 if(r.times)h+=`<p>On <b>${r.times.sign_on}</b> · Length ${r.times.length} · Off <b>${r.times.sign_off}</b>${r.times.clock_change==='1'?' <span class="tag eng">clock change</span>':''}</p>`;
 if(r.card&&r.card.pickups.length)h+='<table><tr><th>Train</th><th>Pick up</th><th>At</th><th>Direction</th><th>Where</th></tr>'+r.card.pickups.map(p=>`<tr><td>${p.train}</td><td><b>${p.time}</b></td><td>${esc(p.at)}</td><td>${p.dir}</td><td>${p.kind}</td></tr>`).join('')+'</table>';
 if(r.type==='Normal')h+='<p class="err">This is a normal-timetable day. Only engineering-notice running cards are on this phone, so there is no card to show. The normal duty book has not been loaded yet.</p>';
 else if(!r.card)h+=r.compact?'<p class="muted">No RC page for this duty. Showing the compact notice page.</p>':'<p class="muted">No running card page imported for this duty.</p>';
 $('#cardInfo').innerHTML=h;const el=$('#cardPages');el.innerHTML='';const w=el.clientWidth||Math.min(innerWidth,800)-24;
 const fail=e=>{el.innerHTML='<p class="err">Could not draw the card: '+esc(e&&e.message||e)+'</p>'};
 if(r.card)renderPages(el,r.card.pdf,r.card.pages,w).catch(fail);else if(r.compact)renderPages(el,r.compact.pdf,[r.compact.page],w).catch(fail)}
function browseFill(){const ns=Object.keys(DATA.cards).sort();$('#bNotice').innerHTML='<option value="">—</option>'+ns.map(n=>`<option>${n}</option>`).join('');$('#bDuty').innerHTML=''}
$('#bNotice').onchange=()=>{const c=DATA.cards[$('#bNotice').value]||{};$('#bDuty').innerHTML='<option value="">—</option>'+Object.keys(c).sort().map(d=>`<option>${d}</option>`).join('')};
$('#bDuty').onchange=()=>{const n=$('#bNotice').value,d=$('#bDuty').value,c=(DATA.cards[n]||{})[d];if(!c)return;const nn=DATA.notices.find(x=>x.notice===n),t=nn&&nn.duties[d];
 $('#cardInfo').innerHTML=`<p><span class="tag eng">Engineering</span> Duty <b>${d}</b> · ${n}</p>`+(t?`<p>On <b>${t.sign_on}</b> · Length ${t.length} · Off <b>${t.sign_off}</b></p>`:'')+'<table><tr><th>Train</th><th>Pick up</th><th>At</th><th>Direction</th><th>Where</th></tr>'+c.pickups.map(p=>`<tr><td>${p.train}</td><td><b>${p.time}</b></td><td>${esc(p.at)}</td><td>${p.dir}</td><td>${p.kind}</td></tr>`).join('')+'</table>';
 const el=$('#cardPages');renderPages(el,c.pdf,c.pages,el.clientWidth||innerWidth-24).catch(e=>{el.innerHTML='<p class="err">Could not draw the card: '+esc(e.message)+'</p>'})};
$('#cardDay').onchange=cardView;
const STNS={'940GZZLUASG':'Arnos Grove','940GZZLUCKS':'Cockfosters','940GZZLUOAK':'Oakwood','940GZZLUSGT':'Southgate','940GZZLUBDS':'Bounds Green','940GZZLUACT':'Acton Town','940GZZLUNFD':'Northfields','940GZZLUHR4':'Heathrow T4','940GZZLUHRC':'Heathrow T2&3','940GZZLUUXB':'Uxbridge'};
$('#stn').innerHTML=Object.entries(STNS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');
async function trains(){$('#tlist').textContent='Loading…';try{const r=await fetch(`https://api.tfl.gov.uk/Line/piccadilly/Arrivals/${$('#stn').value}`);const a=(await r.json()).sort((x,y)=>x.timeToStation-y.timeToStation);
 $('#tlist').innerHTML='<table><tr><th>Due</th><th>Platform</th><th>To</th><th>Now</th></tr>'+a.slice(0,16).map(t=>`<tr><td>${Math.round(t.timeToStation/60)} min</td><td>${esc(t.platformName)}</td><td>${esc(t.towards||t.destinationName)}</td><td class="muted">${esc(t.currentLocation)}</td></tr>`).join('')+'</table>'}
 catch(e){$('#tlist').textContent='No live data (offline?).'}}
$('#refT').onclick=trains;
// --- Track my pick-up train (TfL vehicleId = train/set number on LU) ---
const CODE={AGR:'940GZZLUASG',CFS:'940GZZLUCKS',OAK:'940GZZLUOAK',SGT:'940GZZLUSGT',BDS:'940GZZLUBDS',WGN:'940GZZLUWOG',TPL:'940GZZLUTPN',MNR:'940GZZLUMRH',FPK:'940GZZLUFPK',KXX:'940GZZLUKSX',HBN:'940GZZLUHBN',LSQ:'940GZZLULSQ',PCC:'940GZZLUPCC',HPC:'940GZZLUHPC',KNB:'940GZZLUKNB',SKN:'940GZZLUSKS',ECT:'940GZZLUECT',HMD:'940GZZLUHSD',ACT:'940GZZLUACT',NFD:'940GZZLUNFD',HNE:'940GZZLUHNX',HRC:'940GZZLUHRC',HRV:'940GZZLUHR4',HRF:'940GZZLUHR5',RLN:'940GZZLURYL',UXB:'940GZZLUUXB',ALP:'940GZZLUALP',ECM:'940GZZLUECM'};
const normV=v=>String(v||'').replace(/^0+/,'');let trTimer=null;
async function myTrains(){clearTimeout(trTimer);const out=$('#myTrains');if(!document.querySelector('#trains.on'))return;
 const date=$('#trDay').value,r=resolve(date);
 if(!r||!r.card||!r.card.pickups.length){out.innerHTML='<p class="muted">'+(r?'No pick-ups known for this duty (needs its running card PDF).':'No duty entered for this day.')+'</p>';return}
 let all=null,err='';try{all=await (await fetch('https://api.tfl.gov.uk/Line/piccadilly/Arrivals')).json()}catch(e){err='No live data (offline?).'}
 const now=Date.now(),isToday=date===today();
 out.innerHTML=(err?`<p class="err">${err}</p>`:'')+r.card.pickups.map(p=>{
  const booked=new Date(`${date}T${p.time}:00`),h=`<p><b>Train ${p.train}</b> · pick up <b>${p.time}</b> at ${esc(p.at)} · ${p.dir} · ${p.kind}</p>`;
  if(!all)return h;
  const preds=all.filter(a=>normV(a.vehicleId)===normV(p.train)).sort((a,b)=>a.timeToStation-b.timeToStation);
  if(!preds.length)return h+`<p class="muted">${!isToday?'Live tracking only works on the day.':booked-now>3600e3?'Not running yet / too far ahead. Will keep checking every 30 s.':p.kind!=='Platform'?'Not in TfL arrivals (it starts from the depot road). Will keep checking every 30 s.':'Not found in TfL arrivals right now. Will keep checking every 30 s.'}</p>`;
  const naptan=CODE[p.at.split(' ')[0]],dirWord=p.dir.startsWith('East')?'Eastbound':p.dir.startsWith('West')?'Westbound':'';
  const atPick=preds.find(a=>a.naptanId===naptan&&(!dirWord||(a.platformName||'').startsWith(dirWord)));
  let x=h+`<p>Now: <b>${esc(preds[0].currentLocation||'—')}</b> → ${esc(preds[0].towards||preds[0].destinationName||'')}</p><p class="muted">Next: ${preds.slice(0,4).map(a=>esc(a.stationName.replace(' Underground Station',''))+' '+new Date(a.expectedArrival).toTimeString().slice(0,5)).join(' · ')}</p>`;
  if(atPick){const exp=new Date(atPick.expectedArrival),diff=Math.round((exp-booked)/60000);
   x+=`<p>Expected at ${esc(atPick.platformName)}: <b>${exp.toTimeString().slice(0,5)}</b> — <span class="tag ${Math.abs(diff)>=2?'eng':''}">${diff===0?'on time':diff>0?diff+' min late':(-diff)+' min early'}</span> <span class="muted">(info only)</span></p>`}
  else x+='<p class="muted">Not yet predicted at your pick-up platform.</p>';return x}).join('<hr>');
 trTimer=setTimeout(myTrains,30000)}
$('#trDay').onchange=myTrains;
$('#stn').onchange=trains;
async function journeyMin(){if(S.tt&&S.homeLL&&S.depotLL){try{const r=await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${S.homeLL}:${S.depotLL}/json?traffic=true&key=${encodeURIComponent(S.tt)}`);const j=await r.json();return{m:Math.ceil(j.routes[0].summary.travelTimeInSeconds/60),src:'TomTom live traffic'}}catch(e){}}return{m:+S.journey,src:'usual journey time'}}
let lastPace=null;
async function paceView(){const r=resolve($('#paceDay').value);rest();$('#paceOut').innerHTML='';if(!r||!r.times){$('#paceOut').innerHTML=r?'<p>Sign-on time not known for a normal-book duty yet. Enter it below.</p><input id="manOn" placeholder="Sign on HH:MM">':'<p>No duty entered.</p>';
  const m=$('#manOn');if(m)m.onchange=()=>{lastPace=null;calc(m.value)};return}calc(r.times.sign_on)}
async function calc(on){if(!/^\d\d:\d\d$/.test(on))return;const j=await journeyMin(),son=t2m(on),arrive=son-(+S.lie),leave=arrive-j.m-(+S.margin),wake=son-(+S.ready);lastPace={leave,wake};
 $('#paceOut').innerHTML=(document.getElementById('manOn')?$('#paceOut').innerHTML:'')+`<table><tr><td>Leave home</td><td class="big">${m2t(leave)}</td></tr><tr><td>Arrive at depot and lie down</td><td><b>${m2t(arrive)}</b></td></tr><tr><td>Wake / get up</td><td><b>${m2t(wake)}</b></td></tr><tr><td>Sign on</td><td><b>${on}</b></td></tr></table><p class="muted">Journey ${j.m} min (${j.src}) + ${S.margin} min safety margin · lie-down ${S.lie} min · get-ready ${S.ready} min</p>`}
function alarm(min,label){const h=Math.floor(((min%1440)+1440)%1440/60),m=((min%1440)+1440)%1440%60;
 location.href=`intent://alarm#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${h};i.android.intent.extra.alarm.MINUTES=${m};S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(label)};end`}
$('#alarmBtn').onclick=()=>lastPace&&alarm(lastPace.wake,'Wake up - sign on soon');$('#leaveAlarm').onclick=()=>lastPace&&alarm(lastPace.leave,'Leave home for AGR');
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
const SF={sDepot:'depot',sDepotLL:'depotLL',sHomeLL:'homeLL',sJourney:'journey',sMargin:'margin',sLie:'lie',sReady:'ready',sTT:'tt',sRest:'rest'};
function setView(){for(const[i,k]of Object.entries(SF))$('#'+i).value=S[k]}
$('#saveSet').onclick=()=>{for(const[i,k]of Object.entries(SF))S[k]=$('#'+i).value.trim();LS.set('settings',S);$('#setMsg').textContent='Saved.'};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,section').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.t).classList.add('on');
 ({card:cardView,trains:()=>{trains();myTrains()},pace:paceView,hours:hoursView,set:setView,week:weekView})[b.dataset.t]()});
async function reload(){DATA=await loadData();summary();browseFill()}
function summary(){const n=DATA.notices.length,c=Object.values(DATA.cards).reduce((a,v)=>a+Object.keys(v).length,0);$('#dataSummary').textContent=`On this phone: ${n} notices, ${c} running cards.`}
$('#fCsv').onchange=async e=>{let r;try{r=await importCsvs([...e.target.files].filter(f=>!/\.pdf$/i.test(f.name)))}catch(err){$('#impMsg').className='err';$('#impMsg').textContent='CSV import failed: '+(err&&err.message||err);return}$('#impMsg').className='ok';await reload();$('#impMsg').textContent=`Imported ${r.pack} notice list rows and ${r.dut} duties.`;weekView();e.target.value=''};
async function doPdfs(files,pre=''){const msg=$('#impMsg');msg.className='muted';
 try{const r=await importPdfs(files,m=>msg.textContent='Reading '+m);await reload();
  msg.className=r.errors.length?'err':'ok';msg.innerHTML=pre+`${r.pdfs} of ${r.files} PDFs loaded, ${r.rcPages} running card pages found, ${r.compactPages} compact duties indexed.`+(r.errors.length?'<br>Problems:<br>'+r.errors.map(esc).join('<br>'):'')+(r.rcPages===0&&r.pdfs?'<br>No running card (RC-…) PDFs were found. Select the RC driver book files too.':'')}
 catch(err){msg.className='err';msg.textContent='Import failed: '+(err&&err.message||err)}weekView()}
$('#fPdf').onchange=async e=>{await doPdfs([...e.target.files]);e.target.value=''};
$('#fDir').onchange=async e=>{const all=[...e.target.files],csv=all.filter(f=>/\.csv$/i.test(f.name)),pdf=all.filter(f=>/\.pdf$/i.test(f.name));
 let c={pack:0,dut:0};try{c=await importCsvs(csv);await reload()}catch(err){}
 await doPdfs(pdf,`${csv.length} CSVs read (${c.dut} duties). `);e.target.value=''};
$('#clearData').onclick=async()=>{if(!confirm('Delete all notices, PDFs, duties, hours and settings from this phone?'))return;await wipe();localStorage.clear();location.reload()};
reload().then(()=>{const w=new URLSearchParams(location.search).get('week');if(w)$('#wk').value=w;weekView();cardView()});
if('serviceWorker'in navigator){let had=!!navigator.serviceWorker.controller;navigator.serviceWorker.register('sw.js');navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)location.reload();had=true})}
