import {idb,wipe,importCsvs,importPdfs,loadData,renderPages,reparseIfOld} from './lib.js';
const $=s=>document.querySelector(s),DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>localStorage.setItem(k,JSON.stringify(v))};
const DEF={depot:'Arnos Grove LU depot, Palmers Road, London N11',depotLL:'',homeLL:'',journey:35,margin:15,lie:30,allow:17,boAllow:0,ready:5,tt:'',};
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
// ---- Spare covering: {date:{duty,from}} on this phone. resolve() merges the covered duty from the chosen pick-up. ----
const covers=()=>LS.get('covering',{});
// Flat list of timing points on a card: each knows its pick-up (train) index pi and point index k
function cardRows(card){const out=[];(card.pickups||[]).forEach((p,pi)=>{const pts=p.pts&&p.pts.length?p.pts:[{t:p.time,at:p.at,dir:p.dir}];pts.forEach((q,k)=>out.push({pi,k,train:p.train,t:q.t,at:q.at,dir:k===0?(q.dir||p.dir):(q.dir||''),p}))});return out}
// migrate old {duty,from} to brackets {duty,s:{pi,k},e:null}
function covNorm(cv){if(!cv)return cv;if(!cv.s)return{duty:cv.duty,s:{pi:cv.from||0,k:0},e:null};return cv}
const allowMin=()=>+S.allow||0;
// spare turn's own finish (notice/book), or one the user typed; never guessed
function spareOff(date,b){const s=b&&b.times&&b.times.sign_off||'';if(/^\d\d:\d\d/.test(s))return s.slice(0,5);return LS.get('spareOff',{})[date]||''}
function resolve(date){const b=resolveFor(date,duties()[date]);const cv=covNorm(covers()[date]);if(!b||!(b.cover||b.spare)||!cv||!cv.duty)return b;
 const c=resolveFor(date,cv.duty);if(!c||c.special||!c.card||!c.card.pickups||!c.card.pickups.length)return{...b,covering:{duty:cv.duty,missing:true}};
 const rows=cardRows(c.card),si=Math.max(0,rows.findIndex(r=>r.pi===cv.s.pi&&r.k===cv.s.k)),ei=cv.e?Math.max(si,rows.findIndex(r=>r.pi===cv.e.pi&&r.k===cv.e.k)):rows.length-1,S0=rows[si],E0=rows[ei],toEnd=!cv.e||ei===rows.length-1;
 // direction at a mid-trip takeover: bare station with arrival dir != next departure dir -> Reverser (same rule as reverser pick-ups); else next departing point's direction; else blank
 let tk={dir:S0.dir||'',rev:''};if(S0.k>0){const after=rows.slice(si+1).filter(r=>r.pi===S0.pi&&r.dir),before=rows.slice(0,si).filter(r=>r.pi===S0.pi&&r.dir),nx=after[0]&&after[0].dir,pv=before.length?before[before.length-1].dir:'',bare=!/ (E|W)$/.test(S0.at);
  if(bare&&nx&&pv&&nx!==pv)tk={dir:pv,rev:nx};else tk={dir:nx||'',rev:''}}
 const ps=c.card.pickups,sl=[];for(let pi=S0.pi;pi<=E0.pi;pi++){const p=ps[pi];let q={...p};
  if(pi===S0.pi&&S0.k>0)q={...q,time:S0.t,at:S0.at,dir:tk.dir,rev:tk.rev,midTrip:true,kind:'Platform'};
  if(pi===E0.pi&&!toEnd){q.relief=E0.t;q.endAt=E0.at}sl.push(q)}
 const ptDir=i=>{const r=rows[i];if(r.k===0)return{dir:r.dir||'',rev:r.p.rev||''};if(r.dir)return{dir:r.dir,rev:''};const after=rows.slice(i+1).filter(x=>x.pi===r.pi&&x.dir),before=rows.slice(0,i).filter(x=>x.pi===r.pi&&x.dir),nx=after[0]&&after[0].dir,pv=before.length?before[before.length-1].dir:'',bare=!/ (E|W)$/.test(r.at);
  if(bare&&nx&&pv&&nx!==pv)return{dir:pv,rev:nx};const sfx=(r.at.match(/ (E|W)$/)||[])[1];return{dir:nx||pv||(sfx==='E'?'Eastbound':sfx==='W'?'Westbound':''),rev:''}};
 const ed=ptDir(ei),endInfo={t:E0.t,at:E0.at,code:E0.at.split(' ')[0],train:E0.train,dir:ed.dir,rev:ed.rev,toEnd,last:ei===rows.length-1};
 const st=sl[0],rel=t=>(t2m(t)-t2m(S0.t)+1440)%1440,endRel=rel(E0.t);
 const start=S0.k>0?{train:S0.train,time:S0.t,at:S0.at,dir:tk.dir,rev:tk.rev,kind:'Platform'}:{train:S0.train,time:S0.t,at:S0.at,dir:ps[S0.pi].dir,rev:ps[S0.pi].rev,kind:ps[S0.pi].kind};
 return{...c,duty:b.duty,cover:false,spare:false,onAt:'AGR',times:b.times&&b.times.sign_on?{sign_on:b.times.sign_on,length:'',sign_off:spareOff(date,b)}:null,
  covering:{spareOff:spareOff(date,b),spareOffTyped:!(b.times&&/^\d\d:\d\d/.test(b.times.sign_off||''))&&!!spareOff(date,b),spareDuty:b.duty,spareOn:b.times&&b.times.sign_on||'',spareAt:b.onAt||'',duty:cv.duty,start,end:endInfo,whole:si===0&&toEnd,ctype:c.type,si,ei},
  card:{...c.card,pickups:sl,allPickups:ps,bracket:{si,ei},meals:(c.card.meals||[]).filter(m=>rel(m.from)<endRel&&rel(m.from)<720),allMeals:c.card.meals||[]}}}
function resolveFor(date,duty){if(!duty)return null;if(!/^\d{3}$/.test(duty))return{date,duty,type:SPECIAL[duty]||'Other',special:true,notice:'',times:null,card:null};
 for(const n of DATA.notices){if(n.dates.includes(date)){const d=n.duties[duty];
   const card=(DATA.cards[n.notice]||{})[duty]||null,cp=(DATA.compact[n.notice]||{})[duty]||null;
   // spare turn: CSV tmi flag, compact line says 'to manager's instructions', or the RC book for this notice is on the phone but has no card for a duty the notice lists
   const tmi=!!((d&&d.tmi==='1')||(cp&&cp.tmi)||(!card&&d&&d.section!=='cover'&&DATA.cards[n.notice]&&Object.keys(DATA.cards[n.notice]).length));
   if(d||cp||n.kind==='FULL')return{date,duty,type:'Engineering',notice:n.notice,times:d&&d.sign_on?d:(cp&&cp.on?{sign_on:cp.on,sign_off:'',length:''}:null),cover:!!(d&&d.section==='cover'),spare:!!(d&&d.section==='spare')||tmi,tmi,card,compact:cp,get onAt(){return(this.card&&this.card.onAt)||(this.compact&&this.compact.onAt)||''}}}}
 const wd=new Date(date+'T12:00:00').getDay();let best=null,book=null;
 for(const b of DATA.normal||[]){const inRange=!b.from||(date>=b.from&&date<=b.until);for(const d of b.duties)if(d.duty===duty&&d.days.includes(wd)){const sc=(inRange?0:100)+d.days.length*2+(d.cover?1:0);if(!best||sc<best.sc){best={...d,sc,inRange};book=b}}}
 if(best)return{date,duty,type:'Normal',onAt:best.onAt||best.from||'',warn:best.inRange?'':'Outside the duty book dates!',notice:`Duty book ${book.timetable} · ${best.dt}`,times:{sign_on:best.on,length:best.length,sign_off:best.finish+(best.finishAt&&best.finishAt!=='*'?' '+best.finishAt:best.finishAt==='*'?' *':'')},cover:!!best.cover,spare:!!best.spare,note:best.note||'',desc:best.desc||'',card:{pdf:book.pdf,pages:best.pages,pickups:best.pickups,meals:best.meals||[],hl:best.hl}};
 return{date,duty,type:'Normal',notice:'Normal duty book',times:null,card:null}}
const sat=s=>addD(sunday(s),6);
function wkOptions(){const cur=sat(today()),sel=$('#wk').value||cur;let o='';for(let k=-8;k<=26;k++){const d=addD(cur,k*7);o+=`<option value="${d}">${k===0?'▶ ':''}Sat ${d.slice(8)}/${d.slice(5,7)}/${d.slice(2,4)}${k===0?' (this week)':''}</option>`}
 $('#wk').innerHTML=o;if(![...$('#wk').options].some(x=>x.value===sel))$('#wk').insertAdjacentHTML('afterbegin',`<option value="${sel}">w/e Sat ${sel.slice(8)}/${sel.slice(5,7)}/${sel.slice(0,4)}</option>`);$('#wk').value=sel}
function weekView(){if(!$('#wk').options.length)wkOptions();const e=$('#wk').value,s=addD(e,-6),du=duties(),td=today();$('#wk').classList.toggle('cur',e===sat(td));let h='';
 for(let i=0;i<7;i++){const d=addD(s,i),r=resolve(d),v=du[d]||'',sp=SPECIAL[v];
  h+=`<div class="day${d===td?' today':''}${sp?' rest':''}" data-day="${d}" role="button" title="Open running card"><span class="chev">›</span><div><b>${DAYS[i]}</b> <span class="muted">${d.slice(8)}/${d.slice(5,7)}</span>${d===td?' <span class="tag eng">Today</span>':''}${(LS.get('changes',{})[d]||{}).seen===false?' <span class="tag chgb">Changed</span>':''}</div><input data-d="${d}" inputmode="numeric" placeholder="Duty" value="${esc(sp?v:v)}">
  <div>${r?(r.special?`<b class="${v==='RD'?'restday':''}">${r.type}</b>`:`<span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span>${r.times?` On <b>${r.times.sign_on}</b> ${esc(r.onAt||'')} · Off ${r.times.sign_off}`:''}${r.warn?` <span class="err">${r.warn}</span>`:''}`):''}</div>
  ${r&&(r.cover||r.spare||r.covering)?`<div class="covline">${r.covering?`<span class="tag">Covering ${esc(r.covering.duty)}${r.covering.missing?' (no card)':r.covering.whole?' · whole duty':` · ${esc(r.covering.start.train)} ${r.covering.start.time} ${esc(r.covering.start.at)} · ${getOffTxt(r.covering,false)} · ${spareTxt(r.covering,false)}`}</span> <button class="chip covedit" data-d="${d}">Change</button> <button class="chip covclear" data-d="${d}">Clear</button>`:`<button class="chip covedit" data-d="${d}">Covering…</button>`}</div><div class="coved" id="coved-${d}"></div>`:''}<div class="chips">${['RD'].map(c=>`<button class="chip${v===c?' on':''}" data-d="${d}" data-c="${c}">${c==='RD'?'Rest':c==='SPARE'?'Spare':'Leave (AL)'}</button>`).join('')}</div></div>`}
 $('#days').innerHTML=h;
 document.querySelectorAll('#days .day').forEach(row=>row.onclick=e=>{if(e.target.closest('input,button'))return;const d=row.dataset.day;cardFromWeek=d;document.querySelector('nav button[data-t=card]').click()});
 document.querySelectorAll('#days .covclear').forEach(b=>b.onclick=()=>{const c=covers();delete c[b.dataset.d];LS.set('covering',c);weekView()});
 document.querySelectorAll('#days .covedit').forEach(b=>b.onclick=()=>covEditor(b.dataset.d));
 document.querySelectorAll('#days .chip:not(.covedit):not(.covclear)').forEach(b=>b.onclick=()=>{const du=duties();if(du[b.dataset.d]===b.dataset.c)delete du[b.dataset.d];else du[b.dataset.d]=b.dataset.c;LS.set('duties',du);weekView()});
 document.querySelectorAll('#days input').forEach(i=>i.onchange=()=>{const du=duties(),v=normCode(i.value);if(v)du[i.dataset.d]=v;else delete du[i.dataset.d];LS.set('duties',du);weekView()});
 fillDays()}
let brk=null; // bracket mode {date,duty,si,ei}
function brkView(){const d=brk.date,c=resolveFor(d,brk.duty),b=resolveFor(d,duties()[d]),son=b&&b.times&&b.times.sign_on?t2m(b.times.sign_on):null,lim=allowMin();
 const rows=cardRows(c.card);const el=$('#cardInfo');
 const step=brk.si==null?'Tap the row where you <b>take over</b>.':brk.ei==null?'Now tap the row where you <b>finish</b>, or use “To last row”.':'End set to the latest relief you can make before your spare finishes. Tap another row to change it, then Save.';
 el.innerHTML=`<div class="covbox"><p><b>Covering ${esc(brk.duty)}</b> (${c.type}) · spare ${esc(duties()[d])} book-on ${son!=null?m2t(son):'unknown'}${son!=null?` · rows before ${m2t(son+lim)} (book-on + ${lim} min) can't be chosen`:''}</p><p>${step}</p>
 <p><button class="b s" id="brkEnd" ${brk.si==null?'disabled':''}>To last row</button> <button class="b s" id="brkSave" ${brk.si==null?'disabled':''}>Save</button> <button class="b s" id="brkReset">Start again</button> <button class="b s" id="brkCancel">Cancel</button></p></div>`+bracketTable(c.card,brk.si==null?null:{si:brk.si,ei:brk.ei??(brk.si)},{pick:true,son,lim,endRel:(spareWin(d)||{}).endLim});
 el.querySelectorAll('tr.tap').forEach(tr=>tr.onclick=()=>{const i=+tr.dataset.i;if(brk.si==null||brk.ei!=null||i<brk.si){brk.si=i;brk.ei=null;const w=spareWin(d);if(w&&w.endLim!=null){const isEnd=j=>j===rows.length-1||rows[j+1].pi!==rows[j].pi;for(let j=rows.length-1;j>i;j--){const x=w.rel(rows[j].t);if(isEnd(j)&&x<1200&&x<=w.endLim){brk.ei=j;break}}}}else if(i<brk.si){brk.si=i}else brk.ei=i;brkView()});
 $('#brkEnd').onclick=()=>{const w=spareWin(d);if(w&&w.endLim!=null&&w.rel(rows[rows.length-1].t)>w.endLim){toast('The duty ends after your spare finishes. Tap the last row you can work.');return}brk.ei=rows.length-1;brkView()};$('#brkReset').onclick=()=>{brk.si=brk.ei=null;brkView()};$('#brkCancel').onclick=()=>{brk=null;cardView()};
 $('#brkSave').onclick=()=>{const all=covers(),s=rows[brk.si],e=brk.ei==null||brk.ei===rows.length-1?null:rows[brk.ei];all[d]={duty:brk.duty,s:{pi:s.pi,k:s.k},e:e?{pi:e.pi,k:e.k}:null};LS.set('covering',all);{const t=LS.get('covTravel',{});delete t[d];LS.set('covTravel',t)}brk=null;toast('Covering saved');cardView()};
 $('#cardPages').innerHTML='';renderPages($('#cardPages'),c.card.pdf,c.card.pages,$('#cardPages').clientWidth||Math.min(innerWidth,800)-24,c.card.hl).catch(()=>{})}
// Spare window: book-on + allowance .. spare finish (minutes after book-on, so after-midnight works)
function spareWin(d){const b=resolveFor(d,duties()[d]);if(!b||!b.times||!/^\d\d:\d\d/.test(b.times.sign_on||''))return null;const son=t2m(b.times.sign_on),off=spareOff(d,b);
 const er=off?(t2m(off)-son+1440)%1440:null;return{son,lim:allowMin(),endRel:er,endLim:er==null?null:er-(+S.boAllow||0),off,rel:t=>(t2m(t)-son+1440)%1440}}
function coverFit(card,w){const rows=cardRows({pickups:card.allPickups||card.pickups});let si=-1;
 for(let i=0;i<rows.length;i++){const x=w.rel(rows[i].t);if(x>=w.lim&&x<1200&&(w.endRel==null||x<=w.endRel)){si=i;break}}if(si<0)return null;
 const isEnd=i=>i===rows.length-1||rows[i+1].pi!==rows[i].pi;let ei=-1;
 for(let i=rows.length-1;i>si;i--){if(!isEnd(i))continue;const x=w.rel(rows[i].t);if(x<1200&&x>w.rel(rows[si].t)&&(w.endLim==null||x<=w.endLim)){ei=i;break}}
 if(ei<0)return null;return{si,ei,s:rows[si],e:rows[ei]}}
function firstTakeover(card,w){for(const r of cardRows({pickups:card.allPickups||card.pickups})){const x=w.rel(r.t);if(x>=w.lim&&x<1200&&(w.endRel==null||x<=w.endRel))return r}return null}
function coverCandidates(d){const base=resolveFor(d,duties()[d]),w=spareWin(d);if(!base||!w)return{list:[],w};const keys=new Set();
 if(base.type==='Engineering'&&base.notice)Object.keys(DATA.cards[base.notice]||{}).forEach(k=>keys.add(k));
 else{const wd=new Date(d+'T12:00:00').getDay();for(const bk of DATA.normal||[])for(const x of bk.duties)if(!x.cover&&x.days.includes(wd)&&x.pickups&&x.pickups.length)keys.add(x.duty)}
 const list=[];for(const k of keys){if(k===duties()[d])continue;const c=resolveFor(d,k);if(!c||c.special||c.cover||!c.card||!c.card.pickups||!c.card.pickups.length)continue;const f=w.endLim==null?null:coverFit(c.card,w);if(f)list.push({k,r:f.s,e:f.e,x:w.rel(f.s.t)})}
 return{list:list.sort((p,q)=>p.x-q.x||p.k.localeCompare(q.k)),w}}
function covEditor(d){const el=$('#coved-'+d),cur=covers()[d]||{};
 const {list,w}=coverCandidates(d),win=w?`${m2t(w.son+w.lim)}–${w.off||'?'}`:'';
 el.innerHTML=(!w?'<p class="err">Spare book-on time not known, so duties can\'t be filtered. Type the duty number.</p>':w.endLim==null?'<p class="err">Spare finish time not known, so duties can\'t be checked against it. Type it on the Running card or Pacing, or type a duty number.</p>':list.length?`<p class="muted">Duties you can take over after ${m2t(w.son+w.lim)} (book-on + ${w.lim} min) and be relieved by ${m2t(w.son+w.endLim)} (spare finish ${w.off}${+S.boAllow?` − ${S.boAllow} min book-off allowance`:''}). Tap one, or type a number:</p><div class="englist">${list.map(x=>`<button class="chip" data-k="${x.k}"><b>${x.k}</b><small>${x.r.t} ${esc(x.r.at.split(' ')[0])} → ${x.e.t} ${esc(x.e.at.split(' ')[0])}</small></button>`).join('')}</div>`:`<p class="err">No duty on this phone can be taken over and relieved between ${m2t(w.son+w.lim)} and ${m2t(w.son+w.endLim)}. You can still type a duty number.</p>`)+`<label>Duty you're covering</label><input class="covduty" inputmode="numeric" maxlength="3" placeholder="e.g. 421" value="${esc(cur.duty||'')}"><div class="covpk"></div>`;
 const inp=el.querySelector('.covduty'),pk=el.querySelector('.covpk');
 const show=()=>{const v=inp.value.trim();if(!/^\d{3}$/.test(v)){pk.innerHTML='<p class="muted">Enter the 3-digit duty number.</p>';return}const c=resolveFor(d,v);
  if(!c||c.special||!c.card||!c.card.pickups||!c.card.pickups.length){pk.innerHTML=`<p class="err">No parsed running card with pick-ups for duty ${esc(v)} on this date.</p>`;return}
  const ok=!w||w.endLim==null||coverFit(c.card,w);pk.innerHTML=`<p class="muted">${c.type} card for ${esc(v)} found.</p>${ok?'':`<p class="err">Warning: duty ${esc(v)} doesn't fit your spare hours: no start after ${m2t(w.son+w.lim)} with a relief by ${m2t(w.son+w.endLim)}.</p>`}<button class="b" id="brkGo">Open card to mark start and end…</button>`;
  pk.querySelector('#brkGo').onclick=e=>{e.stopPropagation();brk={date:d,duty:v,si:null,ei:null};cardFromWeek=d;document.querySelector('nav button[data-t=card]').click()}};
 el.querySelectorAll('.englist button').forEach(b=>b.onclick=e=>{e.stopPropagation();inp.value=b.dataset.k;show();pk.scrollIntoView({block:'nearest'})});inp.oninput=show;el.onclick=e=>e.stopPropagation();show();inp.focus()}
function normCode(v){v=String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');if(!v)return'';if(/^(RD|R|REST.*|OFF)$/.test(v))return'RD';if(/^(AL|A|LEAVE|ANNUALLEAVE|HOL)$/.test(v))return'AL';if(/^(SP|SPARE|S)$/.test(v))return'SPARE';return v}
(function migrate(){const du=duties();let ch=false;for(const k in du){const n=normCode(du[k]);if(n!==du[k]){ch=true;if(n)du[k]=n;else delete du[k]}}if(ch)LS.set('duties',du)})();
$('#wkPrev').onclick=()=>{const o=$('#wk');if(o.selectedIndex>0){o.selectedIndex--;weekView()}};$('#wkNext').onclick=()=>{const o=$('#wk');if(o.selectedIndex<o.options.length-1){o.selectedIndex++;weekView()}};
$('#wkNow').onclick=()=>{$('#wk').value=sat(today());weekView()};
function fillDays(){const s=addD($('#wk').value,-6),o=[...Array(7)].map((_,i)=>{const d=addD(s,i);const v=duties()[d];return`<option value="${d}">${d===today()?'▶ ':''}${DAYS[i]} ${d} — ${esc(SPECIAL[v]||v||'no duty')}</option>`}).join('');
 for(const id of['#paceDay']){const v=$(id).value;$(id).innerHTML=o;if(v)$(id).value=v;else{$(id).value=today();if(!$(id).value)$(id).selectedIndex=0}}}
$('#saveWeek').onclick=()=>{const du=duties();document.querySelectorAll('#days input').forEach(i=>{const v=normCode(i.value);if(v)du[i.dataset.d]=v;else delete du[i.dataset.d]});LS.set('duties',du);weekView();$('#wkMsg').textContent='Saved.'};
$('#wk').onchange=weekView;
let cardFromWeek=null;
function todayISO(){const d=NOW();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
// Pick-up table with meal reliefs slotted in time order (times relative to the first pick-up so overnight duties sort right)
function bracketTable(card,sel,opts={}){const rows=cardRows({pickups:card.allPickups||card.pickups}),ms=card.allMeals||card.meals||[],lim=opts.lim;
 const relS=opts.son!=null?t=>(t2m(t)-opts.son+1440)%1440:null;let h='<table class="brk"><tr><th>Train</th><th>Time</th><th>At</th><th>Direction</th></tr>',lastPi=-1;
 rows.forEach((r,i)=>{const early=relS&&(relS(r.t)<lim||relS(r.t)>1200),late=!early&&relS&&opts.endRel!=null&&relS(r.t)>opts.endRel,inB=sel&&i>=sel.si&&i<=(sel.ei??sel.si),edge=sel&&(i===sel.si||i===sel.ei);
  for(const m of ms)if(r.k===0&&r.pi>0&&lastPi!==r.pi&&t2m(m.from)<=t2m(r.t)&&t2m(m.from)>t2m(rows[i-1].t))h+=`<tr class="meal"><td colspan="4">🍽 Meal relief ${m.from}–${m.to} at ${esc(m.at)}</td></tr>`;
  h+=`<tr data-i="${i}" class="${r.k===0?'pu ':''}${early?'early ':late?'late ':opts.pick?'tap ':''}${inB?'inb ':sel?'outb ':''}${edge?'edge':''}"><td>${r.k===0||i===sel?.si?esc(r.train):''}</td><td><b>${r.t}</b></td><td>${esc(r.at)}</td><td>${r.k===0&&r.p.rev?'Reverser':esc(r.dir||'')}${opts.tail&&sel&&i===sel.ei?' <span class="tag getoffTag">Get off here</span>':''}</td></tr>`;if(opts.tail&&sel&&i===sel.ei)h+=`<tr class="tail"><td colspan="4">${opts.tail}</td></tr>`;lastPi=r.pi});
 return h+'</table>'}
function pickTable(c,cov){if(c.bracket)return bracketTable(c,c.bracket,{tail:cov&&!cov.missing?spareTxt(cov):''});const ps=c.allPickups||c.pickups||[],fi=c.fromIdx||0,ms=c.allMeals||c.meals||[],b=ps.length?t2m(ps[0].time)-120:0,rel=t=>(t2m(t)-b+1440)%1440;
 const rows=[...ps.map((p,i)=>({k:rel(p.time),h:`<tr${i<fi?' class="before"':''}><td>${p.train}</td><td><b>${p.time}</b></td><td>${esc(p.at)}</td><td>${p.rev?'Reverser':p.dir}</td><td>${p.kind}</td></tr>`})),
  ...ms.map(m=>({k:rel(m.from)-0.5,h:`<tr class="meal${fi&&rel(m.from)<rel(ps[fi].time)?' before':''}"><td colspan="5">🍽 Meal relief <b>${m.from}–${m.to}</b> at ${esc(m.at)}</td></tr>`}))].sort((x,y)=>x.k-y.k);
 return'<table><tr><th>Train</th><th>Pick up</th><th>At</th><th>Direction</th><th>Where</th></tr>'+rows.map(r=>r.h).join('')+'</table>'}
function mealBanner(card,ps,at,now,cur,working,end,RL){const ms=card.meals||[];for(const m of ms){const f=at(m.from),t=at(m.to);let nx=ps.findIndex(q=>+at(q.time)>=+t);const n=ps[nx];
  const backBy=n?at(n.time):t;if(now>=+f&&now<+backBy){const mins=Math.max(0,Math.ceil((t-now)/60000));
   return`<div class="mealbox"><p class="big">🍽 Meal relief ${m.from}–${m.to} at ${esc(m.at)}</p><p>${now<+t?`Back on in <b>${mins} min</b>`:'Meal over'}${n?`, next train <b>${esc(n.train)}</b> ${n.time} at ${esc(n.at)} (${n.rev?'Reverser':n.dir})`:''}</p></div>`}}
 if(working&&ps[cur]){const e=+end(ps[cur],cur),s=+at(ps[cur].time);const nx=ps[cur+1]?+at(ps[cur+1].time):e+6*3600e3,m=ms.find(m=>+at(m.from)>=s&&+at(m.from)<nx);if(m&&!(RL&&!RL.getOff&&t2m(RL.t)<=t2m(m.from)))return`<p class="tag">Next: meal relief ${m.from} at ${esc(m.at)}</p>`;if(RL)return`<p class="tag">${RL.getOff?'Get off next':'Relieved next'} at ${relTxt(RL)}</p>`}
 return''}
const dTxt=s=>{const d=s.rev?'Reverser':(s.dir&&s.dir!=='see card'?s.dir:'');return(d?' · '+d:'')+(s.kind?' · '+s.kind:'')};
function bindSpOff(el,after){el.querySelectorAll('.spOff').forEach(i=>i.onchange=()=>{const v=i.value.trim(),t=LS.get('spareOff',{});if(/^\d\d:\d\d$/.test(v))t[i.dataset.d]=v;else if(!v)delete t[i.dataset.d];else{toast('Type the time as HH:MM');return}LS.set('spareOff',t);after()})}
function covBanner(r){const c=r.covering;if(c.missing)return`<p class="err">Covering duty ${esc(c.duty)}: no parsed running card for it on this date. Import its card, or change Covering on the Week page.</p>`;
 return`<div class="covbox"><p><span class="tag">Spare ${esc(c.spareDuty)}</span> covering <span class="tag ${c.ctype==='Engineering'?'eng':''}">${c.ctype}</span> duty <b>${esc(c.duty)}</b></p><p>Book on <b>${c.spareOn||'— (not in the notice; type it on Pacing)'}</b> at ${esc(c.spareAt&&c.spareAt!=='AGR'?c.spareAt:'Arnos Grove')} · ${c.whole?'whole duty':`train <b>${esc(c.start.train)}</b> from ${c.start.time} ${esc(c.start.at)}${dTxt(c.start)} `}</p><p class="getoff">${getOffTxt(c)}</p>${backSlot(r.date,c)}<p>${c.spareOff?`${spareTxt(c)}${c.spareOffTyped?' (typed by you)':''}`:`<span class="err">Spare finish time not known.</span>`} <label class="inl">Spare finish: <input class="spOff" data-d="${r.date}" placeholder="HH:MM" size="5" value="${c.spareOffTyped?c.spareOff:''}"></label></p></div>`}
function cardHead(){const d=$('#cardDay').value,t=todayISO(),dd=new Date(d+'T12:00:00');$('#cardHead').innerHTML=`<p><b>${d===t?'Today':''} ${DAYS[dd.getDay()]} ${d.slice(8)}/${d.slice(5,7)}</b>${d!==t?' · <a href="#" id="backToday">Back to today</a>':''}</p>`;const bt=$('#backToday');if(bt)bt.onclick=e=>{e.preventDefault();$('#cardDay').value=t;setHash('card/'+t);cardView()}}
function cardView(){if(!$('#cardDay').value)$('#cardDay').value=todayISO();{const ch=LS.get('changes',{}),cd=$('#cardDay').value;if(ch[cd]&&!ch[cd].seen&&document.querySelector('nav button.on')?.dataset.t==='card'){ch[cd].seen=true;LS.set('changes',ch)}}cardHead();if(brk&&brk.date===$('#cardDay').value){brkView();return}if(brk&&brk.date!==$('#cardDay').value)brk=null;const r=resolve($('#cardDay').value);if(!r||r.special){$('#cardInfo').innerHTML=r?`<p class="restday">${r.type}</p><p class="muted">No running card.</p>`:'<p>No duty entered for this day.</p>';$('#cardPages').innerHTML='';return}
 let h=r.covering?covBanner(r):'';h+=r.covering&&!r.covering.missing?'':`<p><span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span> Duty <b>${esc(r.duty)}</b>${r.warn?' <span class="err">'+r.warn+'</span>':''}</p>`;
 if(r.times&&!r.covering)h+=`<p>On <b>${r.times.sign_on}</b> ${esc(r.onAt||'')} · Length ${r.times.length} · Off <b>${r.times.sign_off}</b>${r.times.clock_change==='1'?' <span class="tag eng">clock change</span>':''}</p>`;
 if(r.cover)h+=`<p><span class="tag eng">Cover duty</span> No running card${r.desc?' — '+esc(r.desc):''}. The cover table is shown below with this duty highlighted.</p>`;else if(r.spare)h+=r.tmi?`<p class="big">Spare turn, to duty manager's instructions. Tap Covering when you know your duty.</p><p><button class="b s" id="cardCov">Covering…</button></p>`:'<p><span class="tag">Spare</span> No booked train.</p>';if(r.note)h+=`<p class="muted">* ${esc(r.note)}</p>`;
 if(r.card&&r.card.pickups.length)h+=pickTable(r.card,r.covering);
 if(r.type==='Normal'&&!r.card)h+=(DATA.normal&&DATA.normal.length)?'<p class="err">Duty '+esc(r.duty)+' is not in the normal duty book for this weekday.</p>':'<p class="err">This is a normal-timetable day. Import the normal duty book PDF (e.g. "Arnos Grove Duty Book 132…pdf") in Settings to see its running card.</p>';
 else if(!r.card)h+=r.compact?'<p class="muted">No RC page for this duty. Showing the compact notice page (row highlighted).</p>':'<p class="muted">No running card page imported for this duty.</p>';
 $('#cardInfo').innerHTML=h;fillBack($('#cardInfo'));bindSpOff($('#cardInfo'),cardView);{const cb=$('#cardCov');if(cb)cb.onclick=()=>{const d=$('#cardDay').value;$('#wk').value=sat(d);document.querySelector('nav button[data-t=week]').click();setTimeout(()=>covEditor(d),50)}}const el=$('#cardPages');el.innerHTML='';const w=el.clientWidth||Math.min(innerWidth,800)-24;
 const fail=e=>{el.innerHTML='<p class="err">Could not draw the card: '+esc(e&&e.message||e)+'</p>'};
 if(r.card)renderPages(el,r.card.pdf,r.card.pages,w,r.card.hl).catch(fail);else if(r.compact)renderPages(el,r.compact.pdf,[r.compact.page],w,r.compact.hl).catch(fail)}
function browseFill(){const ns=Object.keys(DATA.cards).sort();$('#bNotice').innerHTML='<option value="">—</option>'+ns.map(n=>`<option>${n}</option>`).join('');$('#bDuty').innerHTML=''}
$('#bNotice').onchange=()=>{const c=DATA.cards[$('#bNotice').value]||{};$('#bDuty').innerHTML='<option value="">—</option>'+Object.keys(c).sort().map(d=>`<option>${d}</option>`).join('')};
$('#bDuty').onchange=()=>{const n=$('#bNotice').value,d=$('#bDuty').value,c=(DATA.cards[n]||{})[d];if(!c)return;const nn=DATA.notices.find(x=>x.notice===n),t=nn&&nn.duties[d];
 $('#cardInfo').innerHTML=`<p><span class="tag eng">Engineering</span> Duty <b>${d}</b></p>`+(t?`<p>On <b>${t.sign_on}</b> · Length ${t.length} · Off <b>${t.sign_off}</b></p>`:'')+pickTable(c);
 const el=$('#cardPages');renderPages(el,c.pdf,c.pages,el.clientWidth||innerWidth-24).catch(e=>{el.innerHTML='<p class="err">Could not draw the card: '+esc(e.message)+'</p>'})};

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
 const head=`<p class="muted">Today ${DAYS[nowD.getDay()]} ${date.slice(8)}/${date.slice(5,7)}${r?' · '+(r.special?r.type:'duty '+esc(r.duty)+(r.covering&&!r.covering.missing?' covering '+esc(r.covering.duty):'')):''}</p>`;
 if(r&&(r.cover||r.spare)){out.innerHTML=head+`<p class="big">${r.cover?'Cover':'Spare'} duty ${esc(r.duty)}</p><p>No booked pick-up. Sign on ${r.times?r.times.sign_on:'—'} at AGR.</p>`;return}
 if(r&&r.special){out.innerHTML=head+`<p class="restday">${r.type}</p><p class="muted">No train to track today.</p>`;return}
 if(!r){out.innerHTML=head+'<p class="big">No duty set for today</p><p class="muted">Enter today\'s duty on the Week tab.</p>';return}
 if(!r.card||!r.card.pickups.length){out.innerHTML=head+'<p class="big">No pick-ups known</p><p class="muted">This duty\'s running card is not on this device. Import it in Settings.</p>';return}
 const ps=r.card.pickups,on=t2m(r.times&&r.times.sign_on||ps[0].time);
 const at=t=>{const d=new Date(`${date}T${t}:00`);if(t2m(t)<on-60)d.setDate(d.getDate()+1);return d};
 const end=(p,i)=>p.relief?at(p.relief):ps[i+1]?at(ps[i+1].time):new Date(+at(p.time)+4*3600e3);
 if(r.covering&&!r.covering.missing&&now>=+at(r.covering.end.t)){const c=r.covering;out.innerHTML=head+`<p class="big">You're spare until ${c.spareOff||'— (finish not known)'}.</p><p>Driving done at <b>${c.end.t}</b> ${placeTxt(c.end.at,c.end.rev?'Reverser':c.end.dir)}.</p>${backSlot(date,c)}`;fillBack(out);return}
 let cur=ps.findIndex((p,i)=>now<end(p,i));const auto=cur;if(trSel!==null&&ps[trSel])cur=trSel;
 const sel=`<div class="pick">${ps.map((p,i)=>`<button data-i="${i}" class="${i===cur?'on':''}">${p.train} · ${p.time}${i===auto?' (now)':''}</button>`).join('')}${trSel!==null?'<button data-i="auto">Follow current</button>':''}</div>`;
 if(cur<0){out.innerHTML=head+'<p class="big">All pick-ups done</p><p class="muted">Last relief has passed.</p>'+sel;bindSel();return}
 const p=ps[cur],booked=at(p.time),working=now>=+booked,RL=reliefOf(r,ps,cur),rel='';
 const dirTxt=p.rev?'Reverser':`${p.dir}`;
 let h=head+`<div class="trainhead"><div><div class="muted">Train</div><div class="trainno" id="curTrain">${esc(p.train)}</div></div><div><div>Pick up <b class="big">${p.time}</b></div><div>at <b>${esc(p.at)}</b> · ${dirTxt} · ${p.kind}${rel}</div>${RL?`<div class="relief">${RL.getOff?'Get off':'Relieved'} at <b>${relTxt(RL)}</b></div>`:''}${working?'<div class="tag eng">Working this train now</div>':''}</div></div>`;h=h.replace('<div class="trainhead">',mealBanner(r.card,ps,at,now,cur,working,end,RL)+'<div class="trainhead">');
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
async function lineStatus(){return lsCheck();try{const j=await (await fetch('https://api.tfl.gov.uk/Line/piccadilly/Status')).json();const s=(j[0]&&j[0].lineStatuses)||[];
 $('#lineStatus').innerHTML='<p>Piccadilly line: '+s.map(x=>`<b>${esc(x.statusSeverityDescription)}</b>${x.reason?' — '+esc(x.reason):''}`).join('; ')+'</p>'}catch(e){$('#lineStatus').textContent=''}}
let ftTimer=null;
async function findTrain(){clearTimeout(ftTimer);const num=normV(($('#ftNum').value||'').replace(/\D/g,'')),out=$('#ftOut');if(!num){out.innerHTML='';return}
 out.innerHTML='<p class="muted">Looking up '+esc(num)+'…</p>';let all;
 try{all=await (await fetch('https://api.tfl.gov.uk/Line/piccadilly/Arrivals')).json()}catch(e){out.innerHTML='<p class="err">No live data (offline?).</p>';ftTimer=setTimeout(findTrain,30000);return}
 const T=`<span class="tno">${esc(num)}</span>`,preds=all.filter(a=>normV(a.vehicleId)===num).sort((a,b)=>a.timeToStation-b.timeToStation);
 // on today's duty?
 const r=resolve(todayISO()),mine=r&&r.card?r.card.pickups.filter(p=>normV(p.train)===num):[];
 const duty=mine.length?`<p class="tag eng">On today's duty ${esc(r.duty)}</p>`+mine.map(p=>`<p>${T}Pick up <b>${p.time}</b> at ${esc(p.at)} · ${p.rev?'Reverser':p.dir}${p.relief?' · relieved '+p.relief:''}</p>`).join(''):'<p class="muted">Not on today\'s duty card.</p>';
 if(!preds.length){out.innerHTML=`<div class="trainhead"><div class="trainno">${esc(num)}</div></div><p>Train ${esc(num)} is not in TfL's live Piccadilly predictions right now. It may not be in service (e.g. in a depot or siding), or not yet within the prediction window (TfL only predicts the next stops of trains already running).</p>${duty}<p class="muted">Checking again every 30 s. <a href="#" id="ftRetry">Retry now</a></p>`;$('#ftRetry').onclick=e=>{e.preventDefault();findTrain()};ftTimer=setTimeout(findTrain,30000);return}
 const f=preds[0],uniq=preds.filter((a,i,l)=>l.findIndex(b=>b.naptanId===a.naptanId&&b.platformName===a.platformName)===i),hm=x=>new Date(x).toTimeString().slice(0,5);
 const agr=uniq.filter(a=>a.naptanId==='940GZZLUASG'),upd=preds.map(a=>a.timestamp).sort().pop();
 out.innerHTML=`<div class="trainhead"><div class="trainno">${esc(num)}</div><div><div>${T}Now: <b>${esc(f.currentLocation||'—')}</b></div><div>${esc(f.platformName||'')} · towards <b>${esc(f.towards||f.destinationName||'—')}</b>${f.destinationName&&f.towards!==f.destinationName?' (destination '+esc(f.destinationName.replace(' Underground Station',''))+')':''}</div></div></div>
 <p>${T}Next station: <b>${esc(f.stationName.replace(' Underground Station',''))}</b> in ${Math.max(0,Math.round(f.timeToStation/60))} min (${hm(f.expectedArrival)})</p>
 ${uniq.slice(0,8).map(a=>`<p class="muted">${T}${esc(a.stationName.replace(' Underground Station',''))} ${hm(a.expectedArrival)} · ${esc(a.platformName||'')}</p>`).join('')}
 <p>${T}Arnos Grove: ${agr.length?agr.map(a=>`due <b>${hm(a.expectedArrival)}</b> (${esc(a.platformName)})`).join(' · '):'not predicted at AGR in the current window (either direction)'}</p>
 ${duty}<p class="muted">TfL data updated ${upd?hm(upd):'—'}. Information only. Refreshing every 30 s.</p>`;ftTimer=setTimeout(findTrain,30000)}
$('#ftGo').onclick=findTrain;$('#ftNum').addEventListener('keydown',e=>{if(e.key==='Enter')findTrain()});
function bindSel(){document.querySelectorAll('#myTrains .pick button').forEach(b=>b.onclick=()=>{trSel=b.dataset.i==='auto'?null:+b.dataset.i;myTrains()})}
$('#allTrains').addEventListener('toggle',()=>{if($('#allTrains').open)trains()});

$('#stn').onchange=trains;
// ---- Drive time: TomTom Routing with departAt (typical traffic for that weekday/time), cached per weekday+hour ----
const pad2=x=>String(x).padStart(2,'0'),localISO=d=>`${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
const ttCache=()=>LS.get('ttCache',{}),cacheKey=d=>`${d.getDay()}-${d.getHours()}`;
async function ttRoute(depart){const u=`https://api.tomtom.com/routing/1/calculateRoute/${S.homeLL.replace(/\s/g,'')}:${S.depotLL.replace(/\s/g,'')}/json?traffic=true&routeType=fastest&travelMode=car&routeRepresentation=summaryOnly&departAt=${encodeURIComponent(localISO(depart))}&key=${encodeURIComponent(S.tt)}`;
 const r=await fetch(u);if(!r.ok)throw new Error('TomTom '+r.status);const j=await r.json();return Math.ceil(j.routes[0].summary.travelTimeInSeconds/60)}
// arriveMin: minutes from midnight of `date` when you want to arrive (sign-on minus lie-down). Returns {m, leave, src}
async function driveTime(date,arriveMin){const base=new Date(date+'T00:00:00'),at=m=>{const d=new Date(base);d.setMinutes(m);return d};
 let m=+S.journey,leave=arriveMin-m-(+S.margin);
 if(S.tt&&S.homeLL&&S.depotLL){try{for(let k=0;k<2;k++){const t=await ttRoute(at(leave));const changed=t!==m;m=t;leave=arriveMin-m-(+S.margin);if(!changed)break}
   const c=ttCache();c[cacheKey(at(leave))]=m;LS.set('ttCache',c);return{m,leave,src:'TomTom',tt:true}}
  catch(e){const c=ttCache()[cacheKey(at(leave))];if(c){m=c;leave=arriveMin-m-(+S.margin);return{m,leave,src:'TomTom, saved typical for this weekday and hour',tt:true}}}}
 return{m,leave,src:'estimate, no traffic data',tt:false}}
let lastPace=null;
async function paceView(){lastPace=null;alarmLabels();$('#alarmNote').textContent="These open the phone's Clock app with the time filled in.";const r=resolve($('#paceDay').value);$('#paceOut').innerHTML='';if(r&&r.special){$('#paceOut').innerHTML=`<p class="restday">${r.type}</p><p class="muted">Nothing to pace.</p>`;lastPace=null;return}if(!r||!r.times){$('#paceOut').innerHTML=r?'<p>Sign-on time not known for this duty. Type it below.</p><input id="manOn" placeholder="Sign on HH:MM">':'<p>No duty entered.</p>';
  const m=$('#manOn');if(m)m.onchange=()=>{lastPace=null;calc(m.value)};return}calc(r.times.sign_on)}
async function calc(on){if(!/^\d\d:\d\d$/.test(on))return;const date=$('#paceDay').value,r=resolve(date),cov=r&&r.covering&&!r.covering.missing?r.covering:null,son=t2m(on),arrive=cov?son:son-lieMin();
 const pk=r&&((r.card&&r.card.pickups)||(r.compact&&r.compact.pickups))||[],first=pk[0];let wake,wakeTxt;
 if(first&&!r.cover&&!r.spare){wake=t2m(first.time)-10;wakeTxt=`Wake up (10 min before ${esc(first.train)} pick-up ${first.time})`}else{wake=son-10;wakeTxt='Wake up (10 min before sign-on)'}
 $('#paceOut').innerHTML+='<p class="muted" id="paceBusy">Working out drive time…</p>';
 const j=await driveTime(date,arrive),leave=j.leave;lastPace={leave,wake};alarmLabels();lsRender();
 $('#paceOut').innerHTML=(document.getElementById('manOn')?$('#paceOut').innerHTML.replace(/<p class="muted" id="paceBusy">.*?<\/p>/,''):'')+`<table><tr><td>Leave home</td><td class="big">${m2t(leave)}</td></tr>${cov?`<tr><td>Arrive Arnos Grove and book on (spare ${esc(cov.spareDuty)})</td><td><b>${on}</b></td></tr><tr><td>${wakeTxt}</td><td><b>${m2t(wake)}</b></td></tr><tr><td>Leave Arnos by</td><td class="big" id="leaveArnos">…</td></tr>${lieOn()?`<tr><td>Lie down at ${esc(cov.start.at)} (40 min)</td><td><b>${m2t(t2m(cov.start.time)-40)}</b></td></tr>`:''}<tr><td>Take over ${esc(cov.start.train)} at ${esc(cov.start.at)}${dTxt(cov.start)}</td><td><b>${cov.start.time}</b></td></tr><tr><td>${getOffTxt(cov,false)}</td><td><b>${cov.end.t}</b></td></tr>${cov.end.code!=='AGR'?`<tr><td colspan="2">${backSlot(date,cov)}</td></tr>`:''}<tr><td>Spare until (book off at ${esc(cov.spareAt||'AGR')})</td><td>${cov.spareOff?`<b>${cov.spareOff}</b>`:`<input class="spOff" data-d="${date}" placeholder="HH:MM" size="5"> <span class="err">not known, type it</span>`}</td></tr></table><div id="travelOut"></div>`
 :`${lieOn()?`<tr><td>Arrive at depot and lie down</td><td><b>${m2t(arrive)}</b></td></tr>`:''}<tr><td>${wakeTxt}</td><td><b>${m2t(wake)}</b></td></tr><tr><td>Sign on</td><td><b>${on}</b></td></tr></table>`}
 <p>${j.tt?`Typical drive at ${m2t(leave)}: <b>${j.m} min</b> (${j.src})`:`Drive ${j.m} min (<span class="err">${j.src}</span>)`} + ${S.margin} min safety margin${cov?' · no lie-down at Arnos (covering)':(lieOn()?` · lie-down ${S.lie} min`:'')}</p>`;bindSpOff($('#paceOut'),()=>calc(on));if(cov){fillBack($("#paceOut"));leaveArnos(date,cov,son)}}
// Piccadilly depot/relief point codes used on the cards -> TfL station ids. Unknown codes need minutes typed by hand.
const PLACE_IDS={AGR:'940GZZLUASG',ACT:'940GZZLUACT',HMD:'940GZZLUHSD',CFS:'940GZZLUCKS',NFD:'940GZZLUNFD',SHR:'940GZZLUSHH',RLN:'940GZZLURYL'};
async function tflTravel(date,toId,arriveBy){const u=`https://api.tfl.gov.uk/Journey/JourneyResults/940GZZLUASG/to/${toId}?mode=tube&date=${date.replace(/-/g,'')}&time=${m2t(arriveBy).replace(':','')}&timeIs=Arriving`;
 const j=await (await fetch(u)).json();const js=(j.journeys||[]).filter(x=>x.duration>0);if(!js.length)throw new Error('no journeys returned');
 const best=js.sort((x,y)=>new Date(y.startDateTime)-new Date(x.startDateTime))[0];return{m:best.duration,dep:best.startDateTime.slice(11,16)}}
async function leaveArnos(date,cov,son){const o=$('#travelOut'),cell=$('#leaveArnos'),code=cov.start.at.split(' ')[0],pu=t2m(cov.start.time),gap=lieOn()?40:(+S.margin||0),lie=pu-gap,man=LS.get('covTravel',{})[date];
 const put=(m,src)=>{const lv=lie-m;cell.textContent=m2t(lv);o.innerHTML=`<p>Travel Arnos Grove → ${esc(cov.start.at)}: <b>${m} min</b> (${src}) · ${lieOn()?'40 min lie-down':`${gap} min arrival margin`} before ${esc(cov.start.train)} ${cov.start.time}</p>`+(((lv-son-allowMin()+1440)%1440)>720?`<p class="err">Leave Arnos by ${m2t(lv)} is before book-on ${m2t(son)} + ${allowMin()} min allowance (${m2t(son+allowMin())}). You can't make this start from book-on with ${lieOn()?'a full 40 min lie-down':'your arrival margin'}.</p>`:'')+manBox()};
 const manBox=()=>`<p class="muted">Travel minutes by hand: <input id="covMan" type="number" min="0" style="width:5em" value="${man??''}"> ${man!=null?'<a href="#" id="covManClr">use TfL</a>':''}</p>`;
 const bind=()=>{const i=$('#covMan');if(i)i.onchange=()=>{const t=LS.get('covTravel',{});if(i.value==='')delete t[date];else t[date]=+i.value;LS.set('covTravel',t);calc($('#paceOn')?$('#paceOn').value:cov.spareOn)};const c=$('#covManClr');if(c)c.onclick=e=>{e.preventDefault();const t=LS.get('covTravel',{});delete t[date];LS.set('covTravel',t);calc(cov.spareOn)}};
 if(code==='AGR'){put(0,'pick-up is at Arnos Grove');bind();return}
 if(man!=null){put(man,'typed by hand');bind();return}
 if(!PLACE_IDS[code]){cell.textContent='—';o.innerHTML=`<p class="err">Don't know which station "${esc(cov.start.at)}" is. Type the travel minutes:</p>`+manBox();bind();return}
 cell.textContent='…';try{const t=await tflTravel(date,PLACE_IDS[code],lie);put(t.m,`TfL Journey Planner, Piccadilly line, train about ${t.dep}`)}
 catch(e){cell.textContent='—';o.innerHTML=`<p class="err">TfL journey planner failed (${esc(e.message||e)}). Type the travel minutes:</p>`+manBox()}bind()}
$('#geoHome').onclick=async()=>{const g=$('#geoMsg');g.textContent='Getting your location…';try{const p=await getPos(geoStep(g));S.homeLL=`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`;$('#sHomeLL').value=S.homeLL;LS.set('settings',S);g.textContent='Home saved on this phone.'}catch(e){g.textContent=e.message+' Enter lat,lon by hand.'}};
$('#geoDepot').onclick=async()=>{const g=$('#geoMsg'),key=$('#sTT').value.trim()||S.tt,q=$('#sDepot').value.trim()||S.depot;if(!key){g.textContent='Add your TomTom key first, or type the depot lat,lon.';return}
 g.textContent='Looking up the depot…';try{const j=await (await fetch(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q)}.json?countrySet=GB&limit=1&key=${encodeURIComponent(key)}`)).json();const p=j.results&&j.results[0]&&j.results[0].position;if(!p)throw new Error('Address not found.');
  S.depotLL=`${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;$('#sDepotLL').value=S.depotLL;LS.set('settings',S);g.textContent=`Depot set to ${S.depotLL} (${esc(j.results[0].address&&j.results[0].address.freeformAddress||q)}). Check it on a map.`}catch(e){g.textContent='Lookup failed: '+e.message+' Type lat,lon by hand.'}};
const IS_ANDROID=/Android/i.test(navigator.userAgent);
let alarmDay=null;function alarmDate(min){const d=new Date((alarmDay||$('#paceDay').value||todayISO())+'T00:00:00');d.setMinutes(min);return d}
function icsFile(min,label){const d=alarmDate(min),z=x=>String(x).padStart(2,'0'),f=x=>`${x.getFullYear()}${z(x.getMonth()+1)}${z(x.getDate())}T${z(x.getHours())}${z(x.getMinutes())}00`,e=new Date(+d+5*60e3);
 const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AGR Driver//EN','BEGIN:VEVENT',`UID:${+d}-${label.replace(/\W/g,'')}@agr-driver`,`DTSTAMP:${f(new Date())}`,`DTSTART:${f(d)}`,`DTEND:${f(e)}`,`SUMMARY:${label}`,'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${label}`,'TRIGGER:PT0M','END:VALARM','END:VEVENT','END:VCALENDAR'].join('\r\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([ics],{type:'text/calendar'}));a.download=label.replace(/\W+/g,'-').toLowerCase()+'.ics';a.click()}
function alarm(min,label){const n=$('#alarmNote');if(!IS_ANDROID){n.innerHTML='<span class="err">Alarms work on the Android phone only.</span> <a href="#" id="icsDl">Download a calendar reminder (.ics) instead</a>';$('#icsDl').onclick=e=>{e.preventDefault();icsFile(min,label)};return}
 const t=((min%1440)+1440)%1440,h=Math.floor(t/60),m=t%60;
 const url=`intent://#Intent;action=android.intent.action.SET_ALARM;i.android.intent.extra.alarm.HOUR=${h};i.android.intent.extra.alarm.MINUTES=${m};S.android.intent.extra.alarm.MESSAGE=${encodeURIComponent(label)};end`;
 let left=false;const onHide=()=>{if(document.hidden)left=true};document.addEventListener('visibilitychange',onHide);location.href=url;
 setTimeout(()=>{document.removeEventListener('visibilitychange',onHide);if(!left){n.innerHTML='<span class="err">The Clock app did not open.</span> <a href="#" id="icsDl">Download a calendar reminder (.ics) instead</a>';$('#icsDl').onclick=e=>{e.preventDefault();icsFile(min,label)}}},2000)}
function alarmLabels(){$('#leaveAlarm').textContent='Set leave-home alarm'+(lastPace?` (${m2t(lastPace.leave)})`:'');$('#alarmBtn').textContent='Set wake-up alarm'+(lastPace?` (${m2t(lastPace.wake)})`:'');$('#leaveAlarm').disabled=$('#alarmBtn').disabled=!lastPace}
$('#alarmBtn').onclick=()=>lastPace&&alarm(lastPace.wake,'Wake up - sign on soon');$('#leaveAlarm').onclick=()=>lastPace&&alarm(lastPace.leave,'Leave home for AGR');
$('#drive').onclick=()=>{location.href='https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination='+encodeURIComponent(S.depotLL||S.depot)};
$('#paceDay').onchange=paceView;
const hours=()=>LS.get('hours',[]);
function hoursView(){$('#hTab').innerHTML='<tr><th>Date</th><th>Time</th><th>Station</th><th>Duty</th><th>OT</th><th>Finish</th><th>Driven</th><th>Back on</th><th></th></tr>'+hours().map((h,i)=>`<tr><td>${h.date}</td><td>${esc(h.time||'')}</td><td>${esc(h.station||'')}</td><td>${esc(h.duty)}</td><td>${h.ot}</td><td>${esc(h.finish)}</td><td>${esc(h.driven||'')}</td><td>${esc(h.train)}</td><td><button data-i="${i}" class="dkt b s">Docket</button> <button data-i="${i}" class="del">✕</button></td></tr>`).join('');
 document.querySelectorAll('.dkt').forEach(b=>b.onclick=()=>docket(+b.dataset.i));
 document.querySelectorAll('.del').forEach(b=>b.onclick=()=>{if(confirm('Delete entry?')){const a=hours();a.splice(+b.dataset.i,1);LS.set('hours',a);hoursView()}})}
$('#hDate').value=today();$('#hDate').onchange=()=>{$('#hDuty').value=duties()[$('#hDate').value]||'';hoursDefaults()};$('#hDuty').value=duties()[today()]||'';
$('#hAdd').onclick=()=>{const a=hours();a.push({date:$('#hDate').value,time:$('#hTime').value,station:scrub($('#hStation').value),duty:scrub($('#hDuty').value),ot:+$('#hOT').value||0,finish:$('#hFin').value,driven:scrub($('#hDriven').value),train:scrub($('#hSame').checked?$('#hDriven').value:$('#hTrain').value),note:scrub($('#hNote').value)});a.sort((x,y)=>x.date.localeCompare(y.date));LS.set('hours',a);hoursView()};
$('#hCsv').onclick=()=>{const q=v=>'"'+String(v).replace(/"/g,'""')+'"';const csv='date,arrived_time,book_off_station,duty,overtime_min,finish_point,train_driven,train_travelled_back_on,notes\n'+hours().map(h=>[h.date,h.time||'',h.station||'',h.duty,h.ot,h.finish,h.driven||'',h.train,h.note].map(q).join(',')).join('\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`hours-${today()}.csv`;a.click()};
function syncSame(){const s=$('#hSame').checked;$('#hTrain').disabled=s;if(s)$('#hTrain').value=$('#hDriven').value}
$('#hSame').onchange=syncSame;$('#hDriven').oninput=syncSame;
function lastDriven(date){const r=resolve(date);if(!r||!r.card||!r.card.pickups.length)return null;return r.card.pickups[r.card.pickups.length-1]}
function hoursDefaults(){const p=lastDriven($('#hDate').value);$('#hDriven').value=p?normV(p.train):'';$('#hSame').checked=true;syncSame();return p}
const CODE2NAME=c=>{const n=CODE[c];return n&&STATIONS?((STATIONS.find(s=>s[0]===n)||[])[1]||''):''};
// ---- Arrived at book-off: one-shot foreground location -> nearest Piccadilly station -> TfL arrivals there ----
let STATIONS=null;async function stations(){if(!STATIONS)STATIONS=await (await fetch('stations.json')).json();return STATIONS}
function distM(a,b,c,d){const R=6371e3,r=x=>x*Math.PI/180,dl=r(c-a),dn=r(d-b),h=Math.sin(dl/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
// Location: quick network fix first (accepts a fix up to 5 min old), then GPS if that fails. Errors carry the browser's code, message and permission state.
const GEO_NAMES={1:'PERMISSION_DENIED',2:'POSITION_UNAVAILABLE',3:'TIMEOUT'};
async function permState(){try{if(!navigator.permissions||!navigator.permissions.query)return'unknown (no Permissions API)';const r=await Promise.race([navigator.permissions.query({name:'geolocation'}),new Promise((_,j)=>setTimeout(()=>j(new Error('timeout')),1500))]);return r.state}catch(e){return'unknown ('+(e.message||e)+')'}}
function geoOnce({lbl,...o}){return new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,o))}
function getPos(onStep){if(!window.isSecureContext||!navigator.geolocation)return Promise.reject(Object.assign(new Error(`Location API not available (secure context: ${window.isSecureContext}).`),{diag:true}));
 const tries=[{enableHighAccuracy:false,timeout:20000,maximumAge:300000,lbl:'network'},{enableHighAccuracy:true,timeout:45000,maximumAge:300000,lbl:'GPS'}];
 const first=geoOnce(tries[0]); // called synchronously inside the tap handler
 return(async()=>{const errs=[];for(let k=0;k<tries.length;k++){if(onStep)onStep(tries[k].lbl);try{const p=await(k?geoOnce(tries[k]):first);p.via=tries[k].lbl;return p}catch(e){errs.push(`${tries[k].lbl}: code ${e.code} ${GEO_NAMES[e.code]||''} "${e.message||''}"`);if(e.code===1)break}}
  const ps=await permState(),last=errs[errs.length-1]||'';const human=/code 1 /.test(last)?'Location permission denied.':/code 3 /.test(last)?'Location timed out (no fix yet; try near a window or outside).':'Location unavailable (phone could not get a position; check Location is on).';
  throw Object.assign(new Error(`${human} [${errs.join('; ')}; permission: ${ps}]`),{diag:true})})()}
const geoStep=el=>s=>{el.textContent=s==='GPS'?'Still looking — trying GPS (can take up to 45 s indoors)…':'Getting your location…'};

$('#boBtn').onclick=async()=>{const out=$('#boOut'),nowD=NOW(),hm=`${String(nowD.getHours()).padStart(2,'0')}:${String(nowD.getMinutes()).padStart(2,'0')}`,date=todayISO();
 $('#hDate').value=date;$('#hTime').value=hm;$('#hDuty').value=duties()[date]||'';const last=hoursDefaults();out.innerHTML='<p class="muted">Getting your location…</p>';
 const r=resolve(date);const otFrom=off=>{let d=t2m($('#hTime').value||hm)-t2m(off);if(d<-720)d+=1440;if(d>720)d-=1440;$('#hOT').value=Math.max(0,d)};
 if(r&&r.times&&r.times.sign_off&&/^\d\d:\d\d/.test(r.times.sign_off))otFrom(r.times.sign_off.slice(0,5));else if(r&&r.covering&&!r.covering.missing)$('#hOT').value='';
 const spNote=()=>r&&r.covering&&!r.covering.missing?(r.covering.spareOff?`<p>Spare ${esc(r.covering.spareDuty)} finishes <b>${r.covering.spareOff}</b>. Overtime counts from then. Covering ${esc(r.covering.duty)}: ${getOffTxt(r.covering)}.</p>`:`<p class="err">Spare ${esc(r.covering.spareDuty)} finish time not known. Type it to work out overtime: <input class="spOff" data-d="${date}" placeholder="HH:MM" size="5"></p>`):'';
 const spBind=()=>bindSpOff(out,()=>{const v=LS.get('spareOff',{})[date];if(v){otFrom(v);r.covering.spareOff=v;const n=out.querySelector('.spOff');if(n)n.closest('p').outerHTML=spNote()}});
 let st=null,dist=0;
 try{const p=await getPos(s=>{const m=out.querySelector('.muted');if(m)geoStep(m)(s)}),list=(await stations()).map(s=>({id:s[0],name:s[1],d:distM(p.coords.latitude,p.coords.longitude,s[2],s[3])}));
  if(S.depotLL){const[la,lo]=S.depotLL.split(',').map(Number);if(!isNaN(la)&&!isNaN(lo))list.push({id:'940GZZLUASG',name:'Arnos Grove depot',d:distM(p.coords.latitude,p.coords.longitude,la,lo)})}
  list.sort((x,y)=>x.d-y.d);st=list[0];dist=Math.round(st.d)}
 catch(e){out.innerHTML=spNote()+`<p class="err">${esc(e.message)}</p><p class="muted">Time filled in (${hm}). Enter the station and train number by hand below.</p>`;spBind();return}
 if(dist>2000){out.innerHTML=spNote()+`<p class="err">You are ${(dist/1000).toFixed(1)} km from the nearest Piccadilly station (${esc(st.name)}). Enter the station and train by hand.</p>`;spBind();return}
 const bookOff=/^Arnos Grove/.test(st.name); // duty book-off place is AGR
 $('#hStation').value=st.name;$('#hFin').value=bookOff?'Finished on platform':'Book-off travel';
 let h=`<p>Nearest: <b>${esc(st.name)}</b> (${dist} m) · ${bookOff?'at your book-off place':'not your book-off place, so book-off travel'}</p>`;
 try{const arr=await (await fetch(`https://api.tfl.gov.uk/Line/piccadilly/Arrivals/${st.id}`)).json();
  const cand=arr.filter(a=>a.timeToStation<=180).sort((a,b)=>a.timeToStation-b.timeToStation).filter((a,i,l)=>l.findIndex(b=>normV(b.vehicleId)===normV(a.vehicleId))===i);
  const mine=r&&r.card?r.card.pickups.map(p=>normV(p.train)):[];
  const endAt=last&&last.endAt||'',endCode=endAt.split(' ')[0],intoDepot=/\b(SG|DT)[EW]?\b/.test(endAt),elsewhere=endCode&&CODE2NAME(endCode)&&!st.name.startsWith(CODE2NAME(endCode));
  if(last)h+=`<p>Train driven (from your card): <span class="tno">${esc(normV(last.train))}</span> last move ends at ${esc(endAt||'?')}${intoDepot?' (depot/siding)':''}</p>`;
  if(intoDepot||elsewhere){$('#hSame').checked=false;syncSame();$('#hTrain').value='';h+=`<p class="muted">${intoDepot?'Your last train went into the depot/siding':'You booked off away from where your last train finished'}, so the train travelled back on is probably different.</p>`}
  if(cand.length){const best=cand[0];if(intoDepot||elsewhere||!last){$('#hSame').checked=false;syncSame();$('#hTrain').value=normV(best.vehicleId)}
   h+=`<p>Travelled back on — best match from TfL arrivals: <span class="tno">${esc(normV(best.vehicleId))}</span> ${esc(best.platformName||'')} · ${esc(best.currentLocation||'')} (${Math.round(best.timeToStation/60)} min)${mine.includes(normV(best.vehicleId))?' · on your duty card':''}</p><p class="muted">Not certain. Tap another if that wasn't your train:</p><div class="pick">${cand.slice(1,6).map(a=>`<button data-v="${esc(normV(a.vehicleId))}">${esc(normV(a.vehicleId))} · ${esc((a.platformName||'').split(' - ')[0])} · ${Math.round(a.timeToStation/60)}m</button>`).join('')}</div>`}
  else h+='<p class="muted">No train at or due at this station in TfL arrivals in the last ~3 min. Enter the train number by hand.</p>'}
 catch(e){h+='<p class="err">No live TfL data (offline?). Enter the train number by hand.</p>'}
 out.innerHTML=spNote()+h+'<p class="muted">Check the form below, then tap <b>Add to log</b>.</p>';spBind();out.querySelectorAll('.pick button').forEach(b=>b.onclick=()=>{$('#hSame').checked=false;syncSame();$('#hTrain').value=b.dataset.v})};
if(new URLSearchParams(location.search).has('csv'))$('#csvFallback').hidden=false;
const SF={sDepot:'depot',sDepotLL:'depotLL',sHomeLL:'homeLL',sJourney:'journey',sMargin:'margin',sLie:'lie',sAllow:'allow',sBoAllow:'boAllow',sTT:'tt'};
function setView(){for(const[i,k]of Object.entries(SF))$('#'+i).value=S[k];$('#sLieOn').checked=lieOn();$('#sHoursOn').checked=hoursOn()}
// ---- Your setup (per phone): lie-down and hours log on/off. New phones default to off; phones already holding an hours log or duties default to on. ----
function setupDefault(){return LS.get('hours',[]).length>0||Object.keys(LS.get('duties',{})).length>0}
const lieOn=()=>S.lieOn!=null?!!S.lieOn:setupDefault(),hoursOn=()=>S.hoursOn!=null?!!S.hoursOn:setupDefault(),lieMin=()=>lieOn()?(+S.lie||0):0;
function applySetup(){const hb=document.querySelector('nav button[data-t=hours]');hb.hidden=!hoursOn();if(!hoursOn()&&hb.classList.contains('on'))document.querySelector('nav button[data-t=week]').click();
 $('#sLie').closest('label')?0:0;const l=$('#sLie');l.hidden=!lieOn();if(l.previousElementSibling)l.previousElementSibling.hidden=!lieOn()}
function setupCard(){const el=$('#setupW');if(!el)return;if(S.setupDone){el.innerHTML='';return}const d=setupDefault();
 el.innerHTML=`<div class="card setupcard"><b>Your setup</b><p class="muted">Choose what this phone shows. You can change it later in Settings.</p><label class="inl"><input type="checkbox" id="suLie" style="width:auto" ${d?'checked':''}> Lie-down at the depot before sign-on (adds it to Pacing)</label><label class="inl"><input type="checkbox" id="suHours" style="width:auto" ${d?'checked':''}> Hours log and book-off capture</label><p><button class="b" id="suSave">Save</button> <label class="b s" for="fPdf">Load PDFs</label></p><p class="muted">Your files stay on this phone. Load the copies you've been issued.</p></div>`;
 $('#suSave').onclick=()=>{S.lieOn=$('#suLie').checked;S.hoursOn=$('#suHours').checked;S.setupDone=1;LS.set('settings',S);applySetup();setupCard();setView()}}
$('#saveSet').onclick=()=>{for(const[i,k]of Object.entries(SF))S[k]=$('#'+i).value.trim();S.lieOn=$('#sLieOn').checked;S.hoursOn=$('#sHoursOn').checked;S.setupDone=1;applySetup();setupCard();LS.set('settings',S);$('#setMsg').textContent='Saved.'};
function setHash(h){try{history.replaceState(null,'','#'+h)}catch(e){location.hash=h}}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.t!=='card')setHash(b.dataset.t);document.querySelectorAll('nav button,section').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.t).classList.add('on');
 ({card:()=>{const fw=cardFromWeek;$('#cardDay').value=fw||todayISO();cardFromWeek=null;setHash(fw&&fw!==todayISO()?'card/'+fw:'card');cardView()},trains:()=>{trSel=null;myTrains();lineStatus()},pace:()=>{paceView();tomorrowCard();lsRender()},hours:()=>{hoursView();if(!$('#hDriven').value)hoursDefaults()},set:setView,week:()=>{weekView();tomorrowCard();lsRender();remindersView()},_w:weekView})[b.dataset.t]()});
async function reload(){DATA=await loadData();summary();browseFill()}
// ---- What changed after an import: compare parsed results for every entered day from this week on ----
function daySnap(d){const r=resolve(d);if(!r)return null;const pk=r.card&&r.card.pickups&&r.card.pickups.length?r.card.pickups.map(p=>`${p.train} ${p.time} ${p.at}${p.rev?' (Reverser)':''}`).join(', '):null;
 return{type:r.special?r.type:r.type+(r.cover?' cover':r.spare?' spare':''),on:r.times&&r.times.sign_on||'',off:r.times&&r.times.sign_off||'',onAt:r.onAt||'',pk}}
function snapAll(){const from=addD(sat(today()),-6),o={};for(const[d,v]of Object.entries(duties()))if(d>=from&&v)o[d]=daySnap(d);return o}
const descSnap=s=>!s?'—':`${s.type}${s.on?` · on ${s.on}${s.onAt?' '+s.onAt:''} · off ${s.off}`:''}${s.pk?`<br><span class="muted">Pick-ups: ${esc(s.pk)}</span>`:''}`;
function showChanges(before){const ch=LS.get('changes',{}),list=[];
 for(const d of Object.keys(before).sort()){const b=before[d],n=daySnap(d);if(!b||!n)continue;const diff=[];
  if(b.type!==n.type)diff.push('type');if(b.on!==n.on||b.off!==n.off)diff.push('times');if(b.onAt!==n.onAt&&b.onAt&&n.onAt)diff.push('sign-on place');if(b.pk&&n.pk&&b.pk!==n.pk)diff.push('pick-ups');if(!b.pk&&n.pk&&!diff.length)diff.push('running card now on phone');
  if(diff.length){list.push({d,duty:duties()[d],b,n,diff});ch[d]={seen:false}}}
 LS.set('changes',ch);const el=$('#changes');
 el.innerHTML=list.length?`<h3>What changed</h3>`+list.map(x=>{const dd=new Date(x.d+'T12:00:00');return`<div class="chg"><p><b>${DAYS[dd.getDay()]} ${x.d.slice(8)}/${x.d.slice(5,7)}</b> · duty ${esc(x.duty)} · <span class="tag">${x.diff.join(', ')}</span></p><p>Before: ${descSnap(x.b)}</p><p>After: ${descSnap(x.n)}</p></div>`}).join(''):'<p class="muted">What changed: none of your entered days (this week onwards) are affected.</p>'}
async function withDiff(fn){const before=snapAll();await fn();showChanges(before);weekView()}
function summary(){const n=DATA.notices.length,c=Object.values(DATA.cards).reduce((a,v)=>a+Object.keys(v).length,0);$('#dataSummary').textContent=`On this phone: ${n} notices, ${c} running cards`+((DATA.normal||[]).map(b=>`, normal duty book ${b.timetable} (${b.duties.length} duties)`).join(''))+'.'}
$('#fCsv').onchange=e=>withDiff(async()=>{let r;try{r=await importCsvs([...e.target.files].filter(f=>!/\.pdf$/i.test(f.name)))}catch(err){$('#impMsg').className='err';$('#impMsg').textContent='CSV import failed: '+(err&&err.message||err);return}$('#impMsg').className='ok';await reload();$('#impMsg').textContent=`Imported ${r.pack} notice list rows and ${r.dut} duties.`;weekView();e.target.value=''});
async function doPdfs(files,pre=''){const msg=$('#impMsg');msg.className='muted';
 try{const r=await importPdfs(files,m=>msg.textContent='Reading '+m);await reload();
  msg.className=r.errors.length?'err':'ok';msg.innerHTML=pre+`<b>${r.pdfs} of ${r.files} PDFs loaded.</b><br>`+[...(r.normal||[]),...(r.notices||[]),...(r.rcs||[])].map(esc).join('<br>')+(r.errors.length?'<br>Problems:<br>'+r.errors.map(esc).join('<br>'):'');return r}
 catch(err){msg.className='err';msg.textContent='Import failed: '+(err&&err.message||err)}weekView()}
$('#fPdf').onchange=e=>withDiff(async()=>{await doPdfs([...e.target.files]);e.target.value=''});
$('#fDir').onchange=e=>withDiff(async()=>{const all=[...e.target.files],csv=all.filter(f=>/\.csv$/i.test(f.name)),pdf=all.filter(f=>/\.pdf$/i.test(f.name));
 let c={pack:0,dut:0};try{c=await importCsvs(csv);await reload()}catch(err){}
 await doPdfs(pdf,`${csv.length} CSVs read (${c.dut} duties). `);e.target.value=''});
$('#clearData').onclick=async()=>{if(!confirm('Delete all notices, PDFs, duties, hours and settings from this phone?'))return;await wipe();localStorage.clear();location.reload()};
function toast(t){const d=document.createElement('div');d.className='toast';d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),4000)}
reparseIfOld().then(r=>{if(r)toast('Updated card data')}).catch(e=>toast('Card data update failed: '+(e&&e.message||e))).then(reload).then(()=>{const w=new URLSearchParams(location.search).get('week');wkOptions();if(w){const e=sat(w);if(![...$('#wk').options].some(x=>x.value===e))$('#wk').insertAdjacentHTML('afterbegin',`<option value="${e}">w/e Sat ${e}</option>`);$('#wk').value=e}weekView();cardView();
 const hm=(location.hash||'').slice(1).split('/'),tab=hm[0];if(tab&&document.querySelector(`nav button[data-t="${tab}"]:not([hidden])`)&&!(tab==="hours"&&!hoursOn())){if(tab==='card'&&/^\d{4}-\d\d-\d\d$/.test(hm[1]||''))cardFromWeek=hm[1];document.querySelector(`nav button[data-t="${tab}"]`).click()}});
const APP_VERSION='agr-v37';{const v=document.getElementById('appVer');if(v){v.textContent='App version '+APP_VERSION;if(window.caches)caches.keys().then(k=>{v.textContent+=' · offline copy '+(k.filter(x=>/^agr-v/.test(x)).join(', ')||'none yet')})}}
if('serviceWorker'in navigator){let had=!!navigator.serviceWorker.controller;navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>{r.update();document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')r.update()})});navigator.serviceWorker.addEventListener('controllerchange',()=>{if(had)location.reload();had=true})}
// ---- Swipe between tabs (follows the top menu order) ----
(function(){const order=[...document.querySelectorAll('nav button')].map(b=>b.dataset.t);let s=null;
 const skip=el=>el.closest('input,select,textarea,button,a,summary,.pick,.chips,nav,canvas.rc.zoomed')||[...function*(e){for(;e&&e!==document.body;e=e.parentElement)yield e}(el)].some(e=>e.scrollWidth>e.clientWidth+2&&/(auto|scroll)/.test(getComputedStyle(e).overflowX));
 document.addEventListener('touchstart',e=>{if(e.touches.length!==1||(window.visualViewport&&visualViewport.scale>1.01)||skip(e.target)){s=null;return}s={x:e.touches[0].clientX,y:e.touches[0].clientY,t:Date.now()}},{passive:true});
 document.addEventListener('touchmove',e=>{if(e.touches.length>1)s=null},{passive:true});
 document.addEventListener('touchend',e=>{if(!s||e.changedTouches.length!==1)return;const dx=e.changedTouches[0].clientX-s.x,dy=e.changedTouches[0].clientY-s.y,dt=Date.now()-s.t;s=null;
  if(Math.abs(dx)<60||Math.abs(dx)<=Math.abs(dy)*1.5||dt>600)return;const order=[...document.querySelectorAll('nav button:not([hidden])')].map(b=>b.dataset.t),cur=document.querySelector('nav button.on').dataset.t,i=order.indexOf(cur)+(dx<0?1:-1);if(i<0||i>=order.length)return;
  const nb=document.querySelector(`nav button[data-t="${order[i]}"]`);if(order[i]==='card'&&cur==='week'){}nb.click();nb.scrollIntoView({inline:'nearest',block:'nearest'});
  const sec=$('#'+order[i]);sec.classList.remove('slide-l','slide-r');void sec.offsetWidth;sec.classList.add(dx<0?'slide-l':'slide-r')},{passive:true});})();
// ---- Card tab: overscroll past bottom/top pages to next/previous day ----
(function(){const cardOn=()=>{const b=document.querySelector('nav button.on');return b&&b.dataset.t==='card'};
 const sync=()=>document.documentElement.classList.toggle('cardtab',cardOn());new MutationObserver(sync).observe(document.querySelector('nav'),{subtree:true,attributes:true,attributeFilter:['class']});sync();
 const hint=document.createElement('div');hint.id='pageHint';hint.className='pagehint';document.body.appendChild(hint);
 const addDay=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`};
 const lbl=d=>{const x=new Date(d+'T12:00:00');return`${DAYS[x.getDay()].slice(0,3)} ${d.slice(8)}/${d.slice(5,7)}`};
 const se=document.scrollingElement,atBottom=()=>se.scrollTop+innerHeight>=se.scrollHeight-2,atTop=()=>se.scrollTop<=1;
 let s=null;const zoomed=()=>window.visualViewport&&visualViewport.scale>1.01,hide=()=>{hint.classList.remove('show','ready')};
 document.addEventListener('touchstart',e=>{s=null;if(!cardOn()||e.touches.length!==1||zoomed()||e.target.closest('input,select,textarea,canvas.rc.zoomed'))return;
  s={y:e.touches[0].clientY,x:e.touches[0].clientX,t:Date.now(),bot:atBottom(),top:atTop()}},{passive:true});
 document.addEventListener('touchmove',e=>{if(!s)return;if(e.touches.length>1||zoomed()){s=null;hide();return}const dy=e.touches[0].clientY-s.y,dx=e.touches[0].clientX-s.x;
  if(Math.abs(dx)>Math.abs(dy)){hide();return}const d=$('#cardDay').value||todayISO();
  if(dy<-20&&s.bot&&atBottom()){hint.textContent=`${-dy>80?'Release for':'Pull for'} ${lbl(addDay(d,1))} ›`;hint.className='pagehint show bottom'+(-dy>80?' ready':'')}
  else if(dy>20&&s.top&&atTop()){hint.textContent=`‹ ${dy>80?'Release for':'Pull for'} ${lbl(addDay(d,-1))}`;hint.className='pagehint show top'+(dy>80?' ready':'')}else hide()},{passive:true});
 document.addEventListener('touchend',e=>{if(!s)return;const o=s;s=null;hide();if(e.touches.length||e.changedTouches.length!==1||zoomed())return;
  const dy=e.changedTouches[0].clientY-o.y,dx=e.changedTouches[0].clientX-o.x,dt=Date.now()-o.t;if(Math.abs(dy)<=80||Math.abs(dx)*1.5>Math.abs(dy)||dt>700)return;
  let n=0;if(dy<0&&o.bot&&atBottom())n=1;else if(dy>0&&o.top&&atTop())n=-1;if(!n)return;pageCard(n)},{passive:true});
 window.pageCard=n=>{const d=addDay($('#cardDay').value||todayISO(),n);$('#cardDay').value=d;setHash('card/'+d);cardView();se.scrollTop=0;
  const sec=$('#card');sec.classList.remove('slide-u','slide-d');void sec.offsetWidth;sec.classList.add(n>0?'slide-u':'slide-d')};})();

$('#geoTest').onclick=async()=>{const o=$('#geoTestOut');o.textContent='Testing… permission: '+await permState();const t0=Date.now();
 try{const p=await getPos(s=>o.textContent+=`\nTrying ${s}…`);const c=p.coords;o.textContent+=`\nOK via ${p.via} in ${((Date.now()-t0)/1000).toFixed(1)} s\nlat ${c.latitude.toFixed(5)}, lon ${c.longitude.toFixed(5)}\naccuracy ±${Math.round(c.accuracy)} m\nfix age ${Math.round((Date.now()-p.timestamp)/1000)} s`}
 catch(e){o.textContent+=`\nFAILED after ${((Date.now()-t0)/1000).toFixed(1)} s\n${e.message}`}};

// ---- Overtime docket: one clean screen per Hours entry. Blank = fill in; never guessed. Edits are saved on the entry. ----
function docketFields(h){const r=resolve(h.date),cv=r&&r.covering&&!r.covering.missing?r.covering:null,dd=new Date(h.date+'T12:00:00');
 const sched=cv?(cv.spareOff||''):(r&&r.times&&r.times.sign_off?r.times.sign_off.slice(0,5):'');const back=h.train&&h.driven&&normV(h.train)!==normV(h.driven)?h.train:(h.train||h.driven?'same train':'');
 const f=[['date','Date',`${DAYS[dd.getDay()]} ${h.date.slice(8)}/${h.date.slice(5,7)}/${h.date.slice(0,4)}`],['duty','Duty',(h.duty||'')+(cv?` (covering ${cv.duty})`:'')],['on','Sign on',r&&r.times&&r.times.sign_on||''],
  ['sched','Scheduled finish'+(cv?' (spare)':''),sched],['off','Actual book-off',h.time||''],['ot','Overtime (min)',h.ot?String(h.ot):''],['driven','Train driven',h.driven||''],['back','Travelled back on',back],['where','Booked off at',h.station||''],['note','Notes',h.note||'']];
 return f.map(([k,l,v])=>({k,l,v:(h.dk&&k in h.dk)?h.dk[k]:v}))}
function docket(i){const all=hours(),h=all[i];if(!h)return;let o=$('#dk');if(!o){o=document.createElement('div');o.id='dk';document.body.appendChild(o)}
 const fs=docketFields(h);o.innerHTML=`<div class="dkin"><h2>Overtime docket</h2><table>${fs.map(x=>`<tr><th>${x.l}</th><td><input data-k="${x.k}" value="${esc(x.v)}" placeholder="—"></td></tr>`).join('')}</table>
 <p class="dkhint">Blank boxes: fill in yourself. Taken from your log and card; edit anything that's wrong.</p><p><button class="b" id="dkCopy">Copy</button> <button class="b s" id="dkClose">Close</button></p><p id="dkMsg"></p></div>`;
 o.classList.add('on');o.querySelectorAll('input').forEach(inp=>inp.onchange=()=>{const a2=hours();a2[i].dk=Object.assign({},a2[i].dk,{[inp.dataset.k]:inp.value.trim()});LS.set('hours',a2)});
 $('#dkClose').onclick=()=>o.classList.remove('on');
 $('#dkCopy').onclick=async()=>{const txt='Overtime docket\n'+[...o.querySelectorAll('input')].map(inp=>`${inp.closest('tr').querySelector('th').textContent}: ${inp.value.trim()}`).join('\n');
  try{await navigator.clipboard.writeText(txt);$('#dkMsg').textContent='Copied.'}catch(e){const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();try{document.execCommand('copy');$('#dkMsg').textContent='Copied.'}catch(_){$('#dkMsg').textContent='Copy failed. Long-press to select instead.'}t.remove()}}}
// ---- Tomorrow at a glance ----
async function planDay(date){const r=resolve(date);if(!r)return{r};if(r.special)return{r};const cov=r.covering&&!r.covering.missing?r.covering:null;
 const on=r.times&&r.times.sign_on;if(!on||!/^\d\d:\d\d/.test(on))return{r,noOn:true};const son=t2m(on),arrive=cov?son:son-lieMin();
 const pk=(r.card&&r.card.pickups)||[],first=pk[0];const wake=first&&!r.cover&&!r.spare?t2m(first.time)-10:son-10;const j=await driveTime(date,arrive);return{r,cov,son,leave:j.leave,drive:j,wake,first}}
function todayDone(){const n=NOW();if(n.getHours()>=15)return true;const r=resolve(todayISO());if(!r||r.special)return true;const off=r.times&&r.times.sign_off;if(!off||!/^\d\d:\d\d/.test(off))return false;
 const son=r.times.sign_on&&/^\d\d:\d\d/.test(r.times.sign_on)?t2m(r.times.sign_on):0,nowM=n.getHours()*60+n.getMinutes();return((nowM-son+1440)%1440)>((t2m(off.slice(0,5))-son+1440)%1440)}
async function tomorrowCard(){const els=['#tmrW','#tmrP'].map(s=>$(s)).filter(Boolean);if(!todayDone()){els.forEach(e=>e.innerHTML='');return}
 const d=addD(todayISO(),1),dd=new Date(d+'T12:00:00'),lbl=`${DAYS[dd.getDay()]} ${d.slice(8)}/${d.slice(5,7)}`,ch=(LS.get('changes',{})[d]||{}).seen===false?' <span class="tag chgb">Changed</span>':'';
 const p=await planDay(d),r=p.r;let h=`<div class="tmr"><p class="muted">Tomorrow · ${lbl}${ch}</p>`;
 if(!r)h+='<p class="big">No duty entered for tomorrow</p>';
 else if(r.special)h+=`<p class="big">${r.duty==='RD'?'Rest day tomorrow':esc(r.type)+' tomorrow'}</p>`;
 else{const type=r.covering&&!r.covering.missing?`Spare ${esc(r.covering.spareDuty)} covering ${esc(r.covering.duty)}`:(r.tmi||r.spare?'Spare':r.cover?'Cover':esc(r.type));
  h+=`<p><b class="big">${esc(r.duty)}</b> <span class="tag ${r.type==='Engineering'?'eng':''}">${r.type}</span> ${type!==r.type?`<span class="tag">${type}</span>`:''}</p>`;
  if(p.noOn)h+='<p class="err">Sign-on time not known. Check Pacing.</p>';
  else{h+=`<table><tr><td>Sign on</td><td><b>${m2t(p.son)}</b> ${esc(r.onAt||'')}</td></tr><tr><td>Leave home</td><td><b>${m2t(p.leave)}</b> <span class="muted">(${p.drive.tt?'TomTom':'estimate'})</span></td></tr><tr><td>Wake alarm</td><td><b>${m2t(p.wake)}</b></td></tr>`;
   const f=p.cov?p.cov.start:p.first;if(f)h+=`<tr><td>${p.cov?'Take over':'First pick-up'}</td><td><b>${esc(f.train)}</b> ${f.time} ${esc(f.at)} · ${f.rev?'Reverser':esc(f.dir&&f.dir!=='see card'?f.dir:'')}</td></tr>`;
   if(p.cov)h+=`<tr><td>Get off</td><td>${getOffTxt(p.cov).replace(/^Get off /,'')}</td></tr><tr><td>Spare</td><td>${spareTxt(p.cov).replace(/^Spare /,'')}</td></tr>`;
   h+=`</table>${p.cov?backSlot(d,p.cov):''}<p><button class="b s tmrWake">Set wake alarm (${m2t(p.wake)})</button></p>`}}
 h+='</div>';els.forEach(e=>{e.innerHTML=h;fillBack(e);const b=e.querySelector('.tmrWake');if(b)b.onclick=()=>{alarmDay=d;alarm(p.wake,'Wake up - sign on soon');setTimeout(()=>alarmDay=null,3000)}})}
// ---- Line status alert (checks only while the app is open or just reopened) ----
let LSTAT=null,lsTimer=null;
async function lsCheck(){try{const j=await (await fetch('https://api.tfl.gov.uk/Line/piccadilly/Status',{cache:'no-store'})).json();const s=(j[0]&&j[0].lineStatuses)||[];if(!s.length)throw new Error('no status');
  const bad=s.filter(x=>x.statusSeverity!==10);LSTAT={at:NOW(),ok:!bad.length,items:s.map(x=>({sev:x.statusSeverity,desc:x.statusSeverityDescription,reason:x.reason||''})),severe:bad.some(x=>x.statusSeverity<=6||/severe|suspend|clos/i.test(x.statusSeverityDescription))}}
 catch(e){LSTAT={at:NOW(),err:true}}lsRender();lsNotify()}
function lsHtml(lead){if(!LSTAT)return'';const t=m2t(LSTAT.at.getHours()*60+LSTAT.at.getMinutes());if(LSTAT.err)return`<div class="ls lserr">Couldn't check line status (${t}).</div>`;
 if(LSTAT.ok)return`<div class="ls lsok">Piccadilly line: Good Service <span class="muted">(${t})</span></div>`;
 return`<div class="ls ${LSTAT.severe?'lssev':'lsmin'}">${lead?`<b class="big">${lead}</b><br>`:''}<b>Piccadilly line: ${LSTAT.items.filter(x=>x.sev!==10).map(x=>esc(x.desc)).join(', ')}</b> <span class="muted">(checked ${t})</span>${LSTAT.items.filter(x=>x.reason).map(x=>`<p>${esc(x.reason)}</p>`).join('')}</div>`}
function lsRender(){const w=$('#lsW'),t=$('#lineStatus'),pp=$('#lsP');if(w)w.innerHTML=lsHtml();if(t)t.innerHTML=lsHtml();
 if(pp){let lead='';if(LSTAT&&!LSTAT.ok&&!LSTAT.err&&lastPace&&$('#paceDay').value===todayISO()){const n=NOW(),m=n.getHours()*60+n.getMinutes();if(m>=lastPace.leave-90&&m<=lastPace.leave+20)lead='Check before you leave'}pp.innerHTML=lsHtml(lead)}}
let lastHidden=0;
function lsNotify(){if(!LSTAT||LSTAT.err||LSTAT.ok||!('Notification'in window)||Notification.permission!=='granted'||!LS.get('lsNotif',false))return;const key=LSTAT.items.map(x=>x.desc+x.reason).join('|');if(LS.get('lsLastNote','')===key)return;
 if(document.visibilityState==='hidden'&&Date.now()-lastHidden>30*60e3)return;LS.set('lsLastNote',key);const body=LSTAT.items.filter(x=>x.sev!==10).map(x=>x.desc+(x.reason?': '+x.reason:'')).join('\n').slice(0,300);
 navigator.serviceWorker&&navigator.serviceWorker.getRegistration().then(r=>r?r.showNotification('Piccadilly line: '+LSTAT.items.filter(x=>x.sev!==10).map(x=>x.desc).join(', '),{body,tag:'line-status',icon:'icon-192.png'}):new Notification('Piccadilly line',{body}))}
function lsSchedule(){clearInterval(lsTimer);const r=resolve(todayISO());const work=r&&!r.special;if(work)lsTimer=setInterval(()=>{if(document.visibilityState==='visible'||Date.now()-lastHidden<30*60e3)lsCheck()},3*60e3)}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')lastHidden=Date.now();else{lsCheck();tomorrowCard()}});
{const nb=$('#lsNotif');if(nb){const upd=()=>{const p='Notification'in window?Notification.permission:'unsupported';nb.textContent=p==='granted'&&LS.get('lsNotif',false)?'Line status notifications: on (tap to turn off)':'Turn on line status notifications';$('#lsNotifMsg').textContent=p==='denied'?'Notifications are blocked for this site in Chrome settings.':p==='unsupported'?'This browser does not support notifications.':''};
 nb.onclick=async()=>{if(!('Notification'in window))return upd();if(LS.get('lsNotif',false)&&Notification.permission==='granted'){LS.set('lsNotif',false);return upd()}const p=await Notification.requestPermission();LS.set('lsNotif',p==='granted');upd()};upd()}}
setTimeout(()=>{lsCheck();lsSchedule();tomorrowCard();remindersView()},800);setInterval(tomorrowCard,10*60e3);

// ---- Notice reminder: uses only dates parsed from the loaded files ----
function remindersView(){const el=$('#remW');if(!el)return;const t=todayISO(),in7=addD(t,7),in14=addD(t,14),dis=LS.get('remDismiss',{}),out=[];
 const fmt=d=>{const x=new Date(d+'T12:00:00');return`${DAYS[x.getDay()].slice(0,3)} ${d.slice(8)}/${d.slice(5,7)}`};
 for(const n of DATA.notices||[]){const ds=(n.dates||[]).filter(Boolean).sort();if(!ds.length)continue;const end=ds[ds.length-1];if(end>=t&&end<=in7)out.push({k:'n:'+n.notice,h:`Notice ${esc(n.notice)} ends ${fmt(end)}, load the next one when it's out.`})}
 for(const b of DATA.normal||[])if(b.until&&b.until>=t&&b.until<=in7)out.push({k:'b:'+(b.timetable||b.pdf)+':'+b.until,h:`Duty book ${esc(b.timetable||'')} ends ${fmt(b.until)}, load the new book when it's out.`});
 for(const[d,v]of Object.entries(duties()).sort()){if(d<t||d>in14||!v)continue;const r=resolve(d);if(!r||r.special)continue;
  if(r.type==='Engineering'&&!r.card&&!r.spare&&!r.cover&&!(r.covering&&!r.covering.missing))out.push({k:'d:'+d+':'+r.notice,h:`${fmt(d)} duty ${esc(r.duty)} is in engineering notice ${esc(r.notice)} but its running card PDF isn't loaded.`});
  if(r.type==='Normal'&&r.warn)out.push({k:'p:'+d,h:`${fmt(d)} is after the end of the loaded duty book. Load the new book or the notice for that day.`})}
 const show=out.filter(x=>!dis[x.k]);el.innerHTML=show.length?show.map(x=>`<div class="rem"><span>⚠ ${x.h}</span><button class="b s remx" data-k="${esc(x.k)}" aria-label="Dismiss">Dismiss</button></div>`).join(''):'';
 el.querySelectorAll('.remx').forEach(b=>b.onclick=()=>{const d2=LS.get('remDismiss',{});d2[b.dataset.k]=1;LS.set('remDismiss',d2);remindersView()})}

// ---- bracket end wording (no generic 'end of duty') ----
function getOffTxt(c,html=true){const e=c.end,b=s=>html?`<b>${s}</b>`:s,d=e.rev?'Reverser':(e.dir||''),at=e.at.replace(/ (E|W)$/,'');return`Get off ${esc(e.train)} at ${b(e.t)} ${esc(at)}${d?' '+d:''}${e.last?', relieved':''}`}
function spareTxt(c,html=true){const at=c.spareAt||'AGR';return c.spareOff?`Spare until ${html?`<b>${c.spareOff}</b>`:c.spareOff} at ${esc(at)}`:'Spare finish not known'}
const tbCache={};
async function backTravel(date,c){const code=c.end.code;if(code==='AGR')return null;const man=LS.get('covBack',{})[date];if(man!=null)return{m:man,src:'typed by hand'};
 if(!PLACE_IDS[code])return{err:`Don't know which station "${c.end.at}" is.`};const k=date+code+c.end.t;if(tbCache[k])return tbCache[k];
 try{const u=`https://api.tfl.gov.uk/Journey/JourneyResults/${PLACE_IDS[code]}/to/940GZZLUASG?mode=tube&date=${date.replace(/-/g,'')}&time=${c.end.t.replace(':','')}&timeIs=Departing`;
  const j=await (await fetch(u)).json();const js=(j.journeys||[]).filter(x=>x.duration>0).sort((x,y)=>new Date(x.startDateTime)-new Date(y.startDateTime));if(!js.length)throw new Error('no journeys returned');
  return tbCache[k]={m:js[0].duration,src:`TfL Journey Planner, train about ${js[0].startDateTime.slice(11,16)}`,arr:js[0].arrivalDateTime.slice(11,16)}}catch(e){return{err:`TfL journey planner failed (${e.message||e}).`}}}
function backSlot(date,c){return c.end.code==='AGR'?'':`<div class="tback" data-d="${date}">Travel back to Arnos Grove: …</div>`}
async function fillBack(root){for(const el of (root||document).querySelectorAll('.tback')){const d=el.dataset.d,r=resolve(d);if(!r||!r.covering||r.covering.missing){el.remove();continue}const c=r.covering,t=await backTravel(d,c);if(!t){el.remove();continue}
  const man=LS.get('covBack',{})[d];el.innerHTML=(t.err?`<span class="err">Travel back to Arnos Grove: ${esc(t.err)} Type the minutes:</span>`:`Travel back to Arnos Grove: <b>${t.m} min</b> (${esc(t.src)})${t.arr?`, there about <b>${t.arr}</b>`:''}.`)+` <span class="muted">By hand: <input class="cbMan" type="number" min="0" style="width:4.5em" value="${man??''}"> min</span>`;
  const i=el.querySelector('.cbMan');i.onchange=()=>{const m=LS.get('covBack',{});if(i.value==='')delete m[d];else m[d]=+i.value;LS.set('covBack',m);fillBack(el.parentNode)}}}
if(new URLSearchParams(location.search).has('debug'))window.__dbg={cardRows,resolveFor};

// ---- relief point wording: only what the card prints (platform number, E/W side, road), never invented ----
const STN={AGR:'Arnos Grove',HMD:'Hammersmith',ACT:'Acton Town',NFD:'Northfields',CFS:'Cockfosters',RLN:'Rayners Lane',UXB:'Uxbridge',SHR:'South Harrow'};
function placeTxt(at,dir){const [code,q]=String(at||'').split(' '),nm=STN[code],D=dir&&dir!=='see card'?dir:'';
 if(q&&/^\d+$/.test(q))return`${esc(code)} Platform ${q}${nm?` (${nm})`:''}${D?` · ${D}`:''}`;
 if(q==='E'||q==='W')return`${esc(code)} (${q==='E'?'Eastbound':'Westbound'})`;
 if(q==='SG')return`${esc(code)} sidings (SG)`;if(q&&/^DT[EW]?$/.test(q))return`${esc(code)} depot road ${q}`;if(q)return esc(at);
 return`${esc(code)}${D?` (${D})`:''}`}
function reliefOf(r,ps,i){const p=ps[i];if(!p)return null;const c=r.covering&&!r.covering.missing?r.covering:null;
 if(c&&i===ps.length-1)return{t:c.end.t,at:c.end.at,dir:c.end.rev?'Reverser':c.end.dir,getOff:true};
 if(!p.relief)return null;const s=(p.endAt||'').match(/ (E|W)$/);return{t:p.relief,at:p.endAt||'',dir:s?'':''}}
const relTxt=x=>x?`${x.t} ${x.at?placeTxt(x.at,x.dir):'(place not on card)'}`:'';

// ---- Android share target: the service worker stores shared PDFs in this phone's database, then opens ?share=1 ----
async function shareInbox(){const q=new URLSearchParams(location.search);if(!q.has('share'))return;
 const items=(await idb.get('kv','shareInbox'))||[];await idb.put('kv','shareInbox',[]);try{history.replaceState(null,'',location.pathname+'#set')}catch(e){}
 document.querySelector('nav button[data-t=set]').click();const msg=$('#impMsg');
 if(!items.length){msg.className='err';msg.textContent='Nothing was received from the share. Try again, or use Load PDFs.';return}
 const files=items.map(x=>new File([x.blob],x.name||'shared.pdf',{type:'application/pdf'}));await withDiff(async()=>{await doPdfs(files,`Shared from another app: ${files.length} file${files.length>1?'s':''}.<br>`)});msg.scrollIntoView({block:'start'})}
applySetup();setupCard();shareInbox();
