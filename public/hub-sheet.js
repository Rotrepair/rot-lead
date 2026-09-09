(()=>{
  const STOP_KEY='amazonHubStops';
  const ENTRY_KEY='amazonHubEntries';
  const AMAZON_RATE=2.50;
  const style=document.createElement('style');
  style.textContent='.hubroute{border-color:#22c55e}.hubroute .grid{margin-bottom:0}.hubmedia{margin-top:10px}.hubmedia a{color:#7dd3fc}.hubsmall{font-size:12px;color:#94a3b8}.stopstats{border-color:#f59e0b}.stopmsg{font-size:12px;color:#94a3b8;margin-top:8px}.hubrefresh{width:auto;padding:7px 11px;margin-left:8px}.liveok{color:#86efac}.livewarn{color:#fcd34d}';
  document.head.appendChild(style);
  const etaSection=document.querySelector('.section.eta');
  if(!etaSection)return;
  const localDate=()=>{const d=new Date(),off=d.getTimezoneOffset()*60000;return new Date(d-off).toISOString().slice(0,10)};
  const localDateFromIso=(iso)=>{if(!iso)return null;const d=new Date(iso);if(Number.isNaN(d.getTime()))return String(iso).slice(0,10);const off=d.getTimezoneOffset()*60000;return new Date(d-off).toISOString().slice(0,10)};
  const weekStart=(s)=>{const d=new Date(s+'T12:00:00'),day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return d.toISOString().slice(0,10)};
  function readStops(){try{const x=JSON.parse(localStorage.getItem(STOP_KEY)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
  function writeStops(x){try{localStorage.setItem(STOP_KEY,JSON.stringify(x));return true}catch{return false}}
  function readEntries(){try{const x=JSON.parse(localStorage.getItem(ENTRY_KEY)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
  function upsertStop(date,stops,source){if(!date||!Number.isFinite(Number(stops))||Number(stops)<0)return;const n=Number(stops),rows=readStops(),i=rows.findIndex(r=>r.date===date);const rec={date,stops:n,source:source||'Manual',updatedAt:new Date().toISOString()};if(i>=0)rows[i]={...rows[i],...rec};else rows.push(rec);writeStops(rows);renderStopStats()}
  function totalFor(pred){return readStops().filter(pred).reduce((s,r)=>s+Number(r.stops||0),0)}
  function routeHours(date){return readEntries().filter(r=>r.date===date).reduce((s,r)=>s+Number(r.hours||0),0)}
  function localPackageTotals(){
    const rows=readEntries(),today=localDate(),week=weekStart(today),month=today.slice(0,7);
    const daily=rows.filter(r=>r.date===today).reduce((s,r)=>s+Number(r.packages||0),0);
    const weekly=rows.filter(r=>r.date&&weekStart(r.date)===week).reduce((s,r)=>s+Number(r.packages||0),0);
    const monthly=rows.filter(r=>String(r.date||'').slice(0,7)===month).reduce((s,r)=>s+Number(r.packages||0),0);
    return {daily,weekly,monthly};
  }
  const money=n=>'$'+Number(n||0).toFixed(2);

  const section=document.createElement('div');
  section.className='section hubroute';
  section.innerHTML='<div class="top"><h2>Today\'s Hub Route</h2><div><span class="status" id="hubStatus">Checking live feed…</span><button class="secondary hubrefresh" id="hubRefreshBtn" type="button">Refresh Now</button></div></div><div class="grid"><div class="card"><small>Driver</small><div class="big" id="hubDriver">—</div></div><div class="card"><small>Stops</small><div class="big" id="hubStops">—</div></div><div class="card"><small>Packages</small><div class="big" id="hubPackages">—</div></div><div class="card"><small>Arrival ETA</small><div class="big gold" id="hubEta">—</div></div></div><div class="hubsmall" id="hubReceived">Checking for today\'s Hub update…</div><div class="hubmedia" id="hubMedia"></div>';
  etaSection.insertAdjacentElement('afterend',section);

  const routeForm=[...document.querySelectorAll('.section')].find(s=>s.querySelector('h2')?.textContent.trim()==='Add Daily Route');
  if(routeForm){
    const form=routeForm.querySelector('.form');
    if(form&&!document.getElementById('stops')){
      const box=document.createElement('div');
      box.innerHTML='<label>Total Stops</label><input id="stops" type="number" min="0" step="1" placeholder="Daily stops">';
      form.insertBefore(box,form.children[3]||null);
    }
    const stopSection=document.createElement('div');
    stopSection.className='section stopstats';
    stopSection.innerHTML='<div class="top"><h2>Stop Performance</h2><span class="status" id="stopSaveState">Stops tracked separately from packages</span></div><div class="grid"><div class="card"><small>Today\'s Stops</small><div class="big gold" id="todayStops">0</div></div><div class="card"><small>This Week Stops</small><div class="big gold" id="weekStops">0</div></div><div class="card"><small>This Month Stops</small><div class="big gold" id="monthStops">0</div></div><div class="card"><small>Today Stops/Hour</small><div class="big" id="stopsPerHour">0.0</div></div></div><div class="stopmsg">Manual stops save with the selected date. Live Hub stops only update today when the incoming message is actually from today.</div>';
    routeForm.insertAdjacentElement('afterend',stopSection);
    const stopsInput=document.getElementById('stops');
    const dateInput=document.getElementById('date');
    const existing=readStops().find(r=>r.date===(dateInput?.value||localDate()));if(existing)stopsInput.value=existing.stops;
    dateInput?.addEventListener('change',()=>{const r=readStops().find(x=>x.date===dateInput.value);stopsInput.value=r?.stops??''});
    document.getElementById('saveBtn')?.addEventListener('click',()=>{
      const date=dateInput?.value||localDate(),v=stopsInput?.value;
      if(v!==''&&Number(v)>=0){upsertStop(date,Number(v),'Manual');const s=document.getElementById('stopSaveState');if(s){s.textContent='Stops saved ✓';setTimeout(()=>s.textContent='Stops tracked separately from packages',1800)}}
    },true);
  }

  function renderStopStats(){
    const today=localDate(),week=weekStart(today),month=today.slice(0,7),td=totalFor(r=>r.date===today),wd=totalFor(r=>weekStart(r.date)===week),md=totalFor(r=>String(r.date).slice(0,7)===month),hrs=routeHours(today);
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
    set('todayStops',td);set('weekStops',wd);set('monthStops',md);set('stopsPerHour',hrs>0?(td/hrs).toFixed(1):'0.0');
  }

  function applyLivePackageCards(e){
    if(e?.packages==null)return;
    const routeDate=e.receivedAt?localDateFromIso(e.receivedAt):(e.date||null);
    if(routeDate!==localDate())return;
    const live=Number(e.packages||0),t=localPackageTotals(),delta=Math.max(0,live-t.daily);
    const todayPkgs=Math.max(t.daily,live),weekPkgs=t.weekly+delta,monthPkgs=t.monthly+delta;
    const set=(id,v)=>{const x=document.getElementById(id);if(x)x.textContent=v};
    set('todayPkgs',todayPkgs);
    set('todayRev',money(todayPkgs*AMAZON_RATE));
    set('weekPkgs',weekPkgs);
    const wg=document.getElementById('weekGoalText');if(wg){const goal=350;wg.textContent=`${weekPkgs} / ${goal} (${Math.min(100,Math.round((weekPkgs/goal)*100))}%)`;}
    const wp=document.getElementById('weekProgress');if(wp)wp.style.width=Math.min(100,(weekPkgs/350)*100)+'%';
    const mp=document.getElementById('monthPkgs');if(mp)mp.textContent=monthPkgs+' packages';
    const mr=document.getElementById('monthRev');if(mr)mr.textContent=money(monthPkgs*AMAZON_RATE);
  }

  function clearLiveDisplay(message){
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
    set('hubDriver','—');set('hubStops','—');set('hubPackages','—');set('hubEta','—');set('hubStatus','No Hub update today');set('hubReceived',message||'No inbound Hub text/MMS has reached the tracker today.');
    const media=document.getElementById('hubMedia');if(media)media.innerHTML='';
  }

  let lastId=null,loading=false;
  async function load(){
    if(loading)return;loading=true;
    const btn=document.getElementById('hubRefreshBtn');if(btn){btn.disabled=true;btn.textContent='Refreshing…'}
    try{
      const r=await fetch('/api/today-route?ts='+Date.now(),{cache:'no-store'});
      if(!r.ok){clearLiveDisplay('Live feed returned HTTP '+r.status+'.');return;}
      const e=await r.json();
      if(!e||!e.id){clearLiveDisplay('No inbound Hub text/MMS has reached the tracker today.');return;}
      const routeDate=e.receivedAt?localDateFromIso(e.receivedAt):(e.date||null);
      const isToday=routeDate===localDate();
      if(!isToday){clearLiveDisplay('Last Hub update was '+(e.receivedAt?new Date(e.receivedAt).toLocaleString():routeDate)+'. Waiting for today\'s message.');return;}
      document.getElementById('hubStatus').textContent=e.status||'Live update received';
      document.getElementById('hubDriver').textContent=e.driver||'Driver';
      document.getElementById('hubStops').textContent=e.stops??'—';
      document.getElementById('hubPackages').textContent=e.packages??'—';
      document.getElementById('hubEta').textContent=e.eta||'—';
      document.getElementById('hubReceived').textContent='Live • '+(e.receivedAt?new Date(e.receivedAt).toLocaleString():'')+(e.body?' • '+e.body:'');
      const media=document.getElementById('hubMedia');
      if(Array.isArray(e.media)&&e.media.length){media.innerHTML='<b>Hub sheet attached:</b> '+e.media.map((m,i)=>`<a href="/api/media/${i}?v=${encodeURIComponent(e.id)}" target="_blank" rel="noopener">Attachment ${i+1}</a>`).join(' • ')} else media.innerHTML='';
      if(e.stops!=null){upsertStop(routeDate,Number(e.stops),'Hub SMS/MMS');const input=document.getElementById('stops');const date=document.getElementById('date');if(input&&date?.value===routeDate)input.value=e.stops}
      applyLivePackageCards(e);
      if(lastId!==e.id){lastId=e.id;try{localStorage.setItem('amazonHubLatestDispatch',JSON.stringify(e))}catch{}}
    }catch(err){clearLiveDisplay('Could not refresh live feed. Check connection and try Refresh Now.');}
    finally{loading=false;if(btn){btn.disabled=false;btn.textContent='Refresh Now'}renderStopStats();}
  }
  document.getElementById('hubRefreshBtn')?.addEventListener('click',load);
  window.addEventListener('focus',load);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});
  renderStopStats();load();setInterval(load,10000);
})();
