import {idb,wipe,importCsvs,importPdfs,loadData,renderPages,reparseIfOld} from './lib.js';
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
const SPECIAL={RD:'Rest day',AL:'Annual leave',SPARE:'Spare'};
function resolve(date){const duty=duties()[date];if(!duty)return null;if(!/^\d{3}$/.test(duty))return{date,duty,type:SPECIAL[duty]||'Other',special:true,notice:'',times:null,card:null};
 for(const n of DATA.notices){if(n.dates.includes(date)){const d=n.duties[duty];
   if(d||n.kind==='FULL')return{date,duty,type:'Engineering',notice:n.notice,times:d||null,cover:!!(d&&d.section==='cover'),spare:!!(d&&d.section==='spare'),card:(DATA.cards[n.notice]||{})[duty]||null,compact:(DATA.compact[n.notice]||{})[duty]||null}}}
 const wd=new Date(date+'T12:00:00').getDay();let best=null,book=null;
 for(const b of DATA.normal||[]){const inRange=!b.from||(date>=b.from&&date<=b.until);for(const d of b.duties)if(d.duty===duty&&d.days.includes(wd)){const sc=(inRange?0:100)+d.days.length*2+(d.cover?1:0);if(!best||sc<best.sc){best={...d,sc,inRange};book=b}}}
 if(best)return{date,duty,type:'Normal',notice:`Duty book ${book.timetable} · ${best.dt}`+(best.inRange?'':' (outside book dates!)'),times:{sign_on:best.on,length:best.length,sign_off:best.finish+(best.finishAt&&best.finishAt!=='*'?' '+best.finishAt:best.finishAt==='*'?' *':'')},cover:!!best.cover,spare:!!best.spare,note:best.note||'',desc:best.desc||'',card:{pdf:book.pdf,pages:best.pages,pickups:best.pickups,hl:best.hl}};
 return{date,duty,type:'Normal',notice:'Normal duty book',times:null,card:null}}
const sat=s=>addD(sunday(s),6);
function wkOptions(){const cur=sat(today()),sel=$('#wk').value||cur;let o='';for(let k=-8;k<=26;k++){const d=addD(cur,k*7);o+=`<option value="${d}">${k===0?'▶ ':''}Sat ${d.slice(8)}/${d.slice(5,7)}/${d.slice(2,4)}${k===0?' (this week)':''}</option>`}
 $('#wk').innerHTML=o;if(![...$('#wk').options].some(x=>x.value===sel))$('#wk').insertAdjacentHTML('afterbegin',`<option value="${sel}">w/e Sat ${sel.slice(8)}/${sel.slice(5,7)}/${sel.slice(0,4)}</option>`);$('#wk').value=sel}
function weekView(){if(!$('#wk').options.length)wkOptions();const e=$('#wk').value,s=addD(e,-6),du=duties(),td=today();$('#wk').classList.toggle('cur',e===sat(td));let h='';
 for(let i=0;i<7;i++){const d=addD(s,i),r=resolve(d),v=du[d]||'',sp=SPECIAL[v];
  h+=`<div class="day${d===td?' today':''}${sp?' rest':''}"><div><b>${DAYS[i]}</b> <span class="muted">${d.slice(8)}/${d.slice(5,7)}</span>${d===td?' <span class="tag eng">Today</span>':''}</div><input data-d="${d}" inputmode="numeric" placeholder="Duty" value="${esc(sp?v:v)}">
  <div>${r?(r.special?`<b class="${v==='RD'?'restday':''}">${r.type}</b>`:`<span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span>${esc(r.notice)}${r.times?` · On ${r.times.sign_on} · Off ${r.times.sign_off}`:''}`):''}</div>
  <div class="chips">${['RD','SPARE','AL'].map(c=>`<button class="chip${v===c?' on':''}" data-d="${d}" data-c="${c}">${c==='RD'?'Rest':c==='SPARE'?'Spare':'Leave (AL)'}</button>`).join('')}</div></div>`}
 $('#days').innerHTML=h;
 document.querySelectorAll('#days .chip').forEach(b=>b.onclick=()=>{const du=duties();if(du[b.dataset.d]===b.dataset.c)delete du[b.dataset.d];else du[b.dataset.d]=b.dataset.c;LS.set('duties',du);weekView()});
 document.querySelectorAll('#days input').forEach(i=>i.onchange=()=>{const du=duties(),v=normCode(i.value);if(v)du[i.dataset.d]=v;else delete du[i.dataset.d];LS.set('duties',du);weekView()});
 fillDays()}
function normCode(v){v=String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(!v)return'';if(/^(RD|R|REST.*|OFF)$/.test(v))return'RD';if(/^(AL|A|LEAVE|ANNUALLEAVE|HOL)$/.test(v))return'AL';if(/^(SP|SPARE|S)$/.test(v))return'SPARE';return v}
(function migrate(){const du=duties();let ch=false;for(const k in du){const n=normCode(du[k]);if(n!==du[k]){ch=true;if(n)du[k]=n;else delete du[k]}}if(ch)LS.set('duties',du)})();
$('#wkPrev').onclick=()=>{const o=$('#wk');if(o.selectedIndex>0){o.selectedIndex--;weekView()}};$('#wkNext').onclick=()=>{const o=$('#wk');if(o.selectedIndex<o.options.length-1){o.selectedIndex++;weekView()}};
$('#wkNow').onclick=()=>{$('#wk').value=sat(today());weekView()};
function fillDays(){const s=addD($('#wk').value,-6),o=[...Array(7)].map((_,i)=>{const d=addD(s,i);const v=duties()[d];return`<option value="${d}">${d===today()?'▶ ':''}${DAYS[i]} ${d} — ${esc(SPECIAL[v]||v||'no duty')}</option>`}).join('');
 for(const id of['#cardDay','#paceDay']){const v=$(id).value;$(id).innerHTML=o;if(v)$(id).value=v;else{$(id).value=today();if(!$(id).value)$(id).selectedIndex=0}}}
$('#saveWeek').onclick=()=>{const du=duties();document.querySelectorAll('#days input').forEach(i=>{const v=normCode(i.value);if(v)du[i.dataset.d]=v;else delete du[i.dataset.d]});LS.set('duties',du);weekView();$('#wkMsg').textContent='Saved.'};
$('#wk').onchange=weekView;
$('#dutyFile').onchange=async e=>{const t=await e.target.files[0].text(),du=duties();let n=0;
 for(const line of t.split(/\r?\n/)){const c=line.split(/[,;\t]/).map(x=>scrub(x));const date=c.find(x=>/^\d{4}-\d\d-\d\d$/.test(x)),duty=c.find(x=>/^(\d{3}|RD|SPARE)$/i.test(x));if(date&&duty){du[date]=duty.toUpperCase();n++}}
 LS.set('duties',du);weekView();$('#wkMsg').textContent=`Loaded ${n} duties from your file (only date and duty number kept).`};
function cardView(){const r=resolve($('#cardDay').value);if(!r||r.special){$('#cardInfo').innerHTML=r?`<p class="restday">${r.type}</p><p class="muted">No running card.</p>`:'<p>No duty entered for this day.</p>';$('#cardPages').innerHTML='';return}
 let h=`<p><span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span> Duty <b>${esc(r.duty)}</b> · ${esc(r.notice)}</p>`;
 if(r.times)h+=`<p>On <b>${r.times.sign_on}</b> · Length ${r.times.length} · Off <b>${r.times.sign_off}</b>${r.times.clock_change==='1'?' <span class="tag eng">clock change</span>':''}</p>`;
 if(r.cover)h+=`<p><span class="tag eng">Cover duty</span> No running card${r.desc?' — '+esc(r.desc):''}. The cover table is shown below with this duty highlighted.</p>`;else if(r.spare)h+='<p><span class="tag">Spare</span> No booked train.</p>';if(r.note)h+=`<p class="muted">* ${esc(r.note)}</p>`;
 if(r.card&&r.card.pickups.length)h+='<table><tr><th>Train</th><th>Pick up</th><th>At</th><th>Direction</th><th>Where</th></tr>'+r.card.pickups.map(p=>`<tr><td>${p.train}</td><td><b>${p.time}</b></td><td>${esc(p.at)}</td><td>${p.rev?'Reverser':p.dir}</td><td>${p.kind}</td></tr>`).join('')+'</table>';
 if(r.type==='Normal'&&!r.card)h+=(DATA.normal&&DATA.normal.length)?'<p class="err">Duty '+esc(r.duty)+' is not in the normal duty book for this weekday.</p>':'<p class="err">This is a normal-timetable day. Import the normal duty book PDF (e.g. "Arnos Grove Duty Book 132…pdf") in Settings to see its running card.</p>';
 else if(!r.card)h+=r.compact?'<p class="muted">No RC page for this duty. Showing the compact notice page (row highlighted).</p>':'<p class="muted">No running card page imported for this duty.</p>';
 $('#cardInfo').innerHTML=h;const el=$('#cardPages');el.innerHTML='';const w=el.clientWidth||Math.min(innerWidth,800)-24;
 const fail=e=>{el.innerHTML='<p class="err">Could not draw the card: '+esc(e&&e.message||e)+'</p>'};
 if(r.card)renderPages(el,r.card.pdf,r.card.pages,w,r.card.hl).catch(fail);else if(r.compact)renderPages(el,r.compact.pdf,[r.compact.page],w,r.compact.hl).catch(fail)}
function browseFill(){const ns=Object.keys(DATA.cards).sort();$('#bNotice').innerHTML='<option value="">—</option>'+ns.map(n=>`<option>${n}</option>`).join('');$('#bDuty').innerHTML=''}
$('#bNotice').onchange=()=>{const c=DATA.cards[$('#bNotice').value]||{};$('#bDuty').innerHTML='<option value="">—</option>'+Object.keys(c).sort().map(d=>`<option>${d}</option>`).join('')};
$('#bDuty').onchange=()=>{const n=$('#bNotice').value,d=$('#bDuty').value,c=(DATA.cards[n]||{})[d];if(!c)return;const nn=DATA.notices.find(x=>x.notice===n),t=nn&&nn.duties[d];
 $('#cardInfo').innerHTML=`<p><span class="tag eng">Engineering</span> Duty <b>${d}</b> · ${n}</p>`+(t?`<p>On <b>${t.sign_on}</b> · Length ${t.length} · Off <b>${t.sign_off}</b></p>`:'')+'<table><tr><th>Train</th><th>Pick up</th><th>At</th><th>Direction</th><th>Where</th></tr>'+c.pickups.map(p=>`<tr><td>${p.train}</td><td><b>${p.time}</b></td><td>${esc(p.at)}</td><td>${p.rev?'Reverser':p.dir}</td><td>${p.kind}</td></tr>`).join('')+'</table>';
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
const NOW=()=>{const q=new URLSearchParams(location.search).get('now');return q?new Date(q):new Date()};
let trSel=null;
async function myTrains(){clearTimeout(trTimer);const out=$('#myTrains');if(!document.querySelector('#trains.on'))return;
 const nowD=NOW(),now=+nowD,date=`${nowD.getFullYear()}-${String(nowD.getMonth()+1).padStart(2,'0')}-${String(nowD.getDate()).padStart(2,'0')}`,r=resolve(date);
 const head=`<p class="muted">Today ${DAYS[nowD.getDay()]} ${date.slice(8)}/${date.slice(5,7)}${r?' · '+(r.special?r.type:'duty '+esc(r.duty)):''}</p>`;
 if(r&&(r.cover||r.spare)){out.innerHTML=head+`<p class="big">${r.cover?'Cover':'Spare'} duty ${esc(r.duty)}</p><p>No booked pick-up. Sign on ${r.times?r.times.sign_on:'—'} at AGR.</p>`;return}
 if(r&&r.special){out.innerHTML=head+`<p class="restday">${r.type}</p><p class="muted">No train to track today.</p>`;return}
 if(!r){out.innerHTML=head+'<p class="big">No duty set for today</p><p class="muted">Enter today\'s duty on the Week tab.</p>';return}
 if(!r.card||!r.card.pickups.length){out.innerHTML=head+'<p class="big">No pick-ups known</p><p class="muted">This duty\'s running card is not on this device. Import it in Settings.</p>';return}
 const ps=r.card.pickups,on=t2m(r.times&&r.times.sign_on||ps[0].time);
 const at=t=>{const d=new Date(`${date}T${t}:00`);if(t2m(t)<on-60)d.setDate(d.getDate()+1);return d};
 const end=(p,i)=>p.relief?at(p.relief):ps[i+1]?at(ps[i+1].time):new Date(+at(p.time)+4*3600e3);
 let cur=ps.findIndex((p,i)=>now<end(p,i));const auto=cur;if(trSel!==null&&ps[trSel])cur=trSel;
 const sel=`<div class="pick">${ps.map((p,i)=>`<button data-i="${i}" class="${i===cur?'on':''}">${p.train} · ${p.time}${i===auto?' (now)':''}</button>`).join('')}${trSel!==null?'<button data-i="auto">Follow current</button>':''}</div>`;
 if(cur<0){out.innerHTML=head+'<p class="big">All pick-ups done</p><p class="muted">Last relief has passed.</p>'+sel;bindSel();return}
 const p=ps[cur],booked=at(p.time),working=now>=+booked,rel=p.relief?` · relieved ${p.relief}`:'';
 const dirTxt=p.rev?'Reverser':`${p.dir}`;
 let h=head+`<div class="trainhead"><div><div class="muted">Train</div><div class="trainno" id="curTrain">${esc(p.train)}</div></div><div><div>Pick up <b class="big">${p.time}</b></div><div>at <b>${esc(p.at)}</b> · ${dirTxt} · ${p.kind}${rel}</div>${working?'<div class="tag eng">Working this train now</div>':''}</div></div>`;
 let all=null;try{all=await (await fetch('https://api.tfl.gov.uk/Line/piccadilly/Arrivals')).json()}catch(e){h+='<p class="err">No live data (offline?).</p>'}
 if(all){const preds=all.filter(a=>normV(a.vehicleId)===normV(p.train)).sort((a,b)=>a.timeToStation-b.timeToStation),T=`<span class="tno">${esc(p.train)}</span>`;
  if(!preds.length)h+=`<p>${T}${booked-now>3600e3?'Not running yet / too far ahead.':p.kind!=='Platform'&&!working?'Not in TfL arrivals yet (starts from the depot road).':'Not found in TfL arrivals right now.'} Checking again every 30 s.</p>`;
  else{h+=`<p>${T}Now: <b>${esc(preds[0].currentLocation||'—')}</b> → ${esc(preds[0].towards||preds[0].destinationName||'')}</p>`+preds.filter((a,i,l)=>l.findIndex(b=>b.naptanId===a.naptanId)===i).slice(0,4).map(a=>`<p class="muted">${T}${esc(a.stationName.replace(' Underground Station',''))} ${new Date(a.expectedArrival).toTimeString().slice(0,5)} · ${esc(a.platformName||'')}</p>`).join('');
   if(!working){const naptan=CODE[p.at.split(' ')[0]],dw=p.dir.startsWith('East')?'Eastbound':p.dir.startsWith('West')?'Westbound':'';
    const ap=preds.find(a=>a.naptanId===naptan&&(!dw||(a.platformName||'').startsWith(dw)));
    if(ap&&Math.abs(new Date(ap.expectedArrival)-booked)<=40*60e3){const exp=new Date(ap.expectedArrival),diff=Math.round((exp-booked)/60000);
     h+=`<p>${T}Expected at ${esc(ap.platformName)}: <b class="big">${exp.toTimeString().slice(0,5)}</b> <span class="tag ${Math.abs(diff)>=2?'eng':''}">${diff===0?'on time':diff>0?diff+' min late':(-diff)+' min early'}</span> <span class="muted">(info only)</span></p>`}
    else if(ap)h+=`<p class="muted">${T}is on an earlier trip (due at your platform ${new Date(ap.expectedArrival).toTimeString().slice(0,5)}). Your ${p.time} pick-up is not predicted yet.</p>`;
    else h+=`<p class="muted">${T}not yet predicted at your pick-up platform.</p>`}}}
 out.innerHTML=h+'<p class="muted" style="margin-top:12px">Other pick-ups on this duty:</p>'+sel;bindSel();trTimer=setTimeout(myTrains,30000)}
function bindSel(){document.querySelectorAll('#myTrains .pick button').forEach(b=>b.onclick=()=>{trSel=b.dataset.i==='auto'?null:+b.dataset.i;myTrains()})}
$('#allTrains').addEventListener('toggle',()=>{if($('#allTrains').open)trains()});

$('#stn').onchange=trains;
async function journeyMin(){if(S.tt&&S.homeLL&&S.depotLL){try{const r=await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${S.homeLL}:${S.depotLL}/json?traffic=true&key=${encodeURIComponent(S.tt)}`);const j=await r.json();return{m:Math.ceil(j.routes[0].summary.travelTimeInSeconds/60),src:'TomTom live traffic'}}catch(e){}}return{m:+S.journey,src:'usual journey time'}}
let lastPace=null;
async function paceView(){const r=resolve($('#paceDay').value);rest();$('#paceOut').innerHTML='';if(r&&r.special){$('#paceOut').innerHTML=`<p class="restday">${r.type}</p><p class="muted">Nothing to pace.</p>`;lastPace=null;return}if(!r||!r.times){$('#paceOut').innerHTML=r?'<p>Sign-on time not known for a normal-book duty yet. Enter it below.</p><input id="manOn" placeholder="Sign on HH:MM">':'<p>No duty entered.</p>';
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
 ({card:cardView,trains:()=>{trSel=null;myTrains()},pace:paceView,hours:hoursView,set:setView,week:weekView})[b.dataset.t]()});
async function reload(){DATA=await loadData();summary();browseFill()}
function summary(){const n=DATA.notices.length,c=Object.values(DATA.cards).reduce((a,v)=>a+Object.keys(v).length,0);$('#dataSummary').textContent=`On this phone: ${n} notices, ${c} running cards`+((DATA.normal||[]).map(b=>`, normal duty book ${b.timetable} (${b.duties.length} duties)`).join(''))+'.'}
$('#fCsv').onchange=async e=>{let r;try{r=await importCsvs([...e.target.files].filter(f=>!/\.pdf$/i.test(f.name)))}catch(err){$('#impMsg').className='err';$('#impMsg').textContent='CSV import failed: '+(err&&err.message||err);return}$('#impMsg').className='ok';await reload();$('#impMsg').textContent=`Imported ${r.pack} notice list rows and ${r.dut} duties.`;weekView();e.target.value=''};
async function doPdfs(files,pre=''){const msg=$('#impMsg');msg.className='muted';
 try{const r=await importPdfs(files,m=>msg.textContent='Reading '+m);await reload();
  msg.className=r.errors.length?'err':'ok';msg.innerHTML=pre+(r.normal?r.normal.map(esc).join('<br>')+'<br>':'')+`${r.pdfs} of ${r.files} PDFs loaded, ${r.rcPages} running card pages found, ${r.compactPages} compact duties indexed.`+(r.errors.length?'<br>Problems:<br>'+r.errors.map(esc).join('<br>'):'')+(r.rcPages===0&&r.pdfs&&!r.normal?'<br>No running card (RC-…) PDFs were found. Select the RC driver book files too.':'')}
 catch(err){msg.className='err';msg.textContent='Import failed: '+(err&&err.message||err)}weekView()}
$('#fPdf').onchange=async e=>{await doPdfs([...e.target.files]);e.target.value=''};
$('#fDir').onchange=async e=>{const all=[...e.target.files],csv=all.filter(f=>/\.csv$/i.test(f.name)),pdf=all.filter(f=>/\.pdf$/i.test(f.name));
 let c={pack:0,dut:0};try{c=await importCsvs(csv);await reload()}catch(err){}
 await doPdfs(pdf,`${csv.length} CSVs read (${c.dut} duties). `);e.target.value=''};
$('#clearData').onclick=async()=>{if(!confirm('Delete all notices, PDFs, duties, hours and settings from this phone?'))return;await wipe();localStorage.clear();location.reload()};
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),4000)}
reparseIfOld().then(r=>{if(r)toast('Updated card data')}).catch(e=>toast('Card data update failed: '+(e&&e.message||e))).then(reload).then(()=>{const w=new URLSearchParams(location.search).get('week');wkOptions();if(w){const e=sat(w);if(![...$('#wk').options].some(x=>x.value===e))$('#wk').insertAdjacentHTML('afterbegin',`<option value="${e}">w/e Sat ${e}</option>`);$('#wk').value=e}weekView();cardView()});
if('serviceWorker'in navigator){let had=!!navigator.serviceWorker.controller;navigator.serviceWorker.register('sw.js');navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)location.reload();had=true})}
