(()=>{
  const STOP_KEY='amazonHubStops';
  const style=document.createElement('style');
  style.textContent='.hubroute{border-color:#22c55e}.hubroute .grid{margin-bottom:0}.hubmedia{margin-top:10px}.hubmedia a{color:#7dd3fc}.hubsmall{font-size:12px;color:#94a3b8}.stopstats{border-color:#f59e0b}.stopmsg{font-size:12px;color:#94a3b8;margin-top:8px}';
  document.head.appendChild(style);
  const etaSection=document.querySelector('.section.eta');
  if(!etaSection)return;
  const localDate=()=>{const d=new Date(),off=d.getTimezoneOffset()*60000;return new Date(d-off).toISOString().slice(0,10)};
  const weekStart=(s)=>{const d=new Date(s+'T12:00:00'),day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return d.toISOString().slice(0,10)};
  function readStops(){try{const x=JSON.parse(localStorage.getItem(STOP_KEY)||'[]');return Array.isArray(x)?x:[]}catch{return []}}
  function writeStops(x){try{localStorage.setItem(STOP_KEY,JSON.stringify(x));return true}catch{return false}}
  function upsertStop(date,stops,source){if(!date||!Number.isFinite(Number(stops))||Number(stops)<0)return;const n=Number(stops),rows=readStops(),i=rows.findIndex(r=>r.date===date);const rec={date,stops:n,source:source||'Manual',updatedAt:new Date().toISOString()};if(i>=0)rows[i]={...rows[i],...rec};else rows.push(rec);writeStops(rows);renderStopStats()}
  function totalFor(pred){return readStops().filter(pred).reduce((s,r)=>s+Number(r.stops||0),0)}
  function routeHours(date){try{const rows=JSON.parse(localStorage.getItem('amazonHubEntries')||'[]');return Array.isArray(rows)?rows.filter(r=>r.date===date).reduce((s,r)=>s+Number(r.hours||0),0):0}catch{return 0}}

  const section=document.createElement('div');
  section.className='section hubroute';
  section.innerHTML='<div class="top"><h2>Today\'s Hub Route</h2><span class="status" id="hubStatus">Waiting for Hub message</span></div><div class="grid"><div class="card"><small>Driver</small><div class="big" id="hubDriver">—</div></div><div class="card"><small>Stops</small><div class="big" id="hubStops">—</div></div><div class="card"><small>Packages</small><div class="big" id="hubPackages">—</div></div><div class="card"><small>Arrival ETA</small><div class="big gold" id="hubEta">—</div></div></div><div class="hubsmall" id="hubReceived">No Hub route received yet.</div><div class="hubmedia" id="hubMedia"></div>';
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
    stopSection.innerHTML='<div class="top"><h2>Stop Performance</h2><span class="status" id="stopSaveState">Stops tracked separately from packages</span></div><div class="grid"><div class="card"><small>Today\'s Stops</small><div class="big gold" id="todayStops">0</div></div><div class="card"><small>This Week Stops</small><div class="big gold" id="weekStops">0</div></div><div class="card"><small>This Month Stops</small><div class="big gold" id="monthStops">0</div></div><div class="card"><small>Today Stops/Hour</small><div class="big" id="stopsPerHour">0.0</div></div></div><div class="stopmsg">Enter Total Stops in Add Daily Route. If the morning Hub message includes a stop count, Today\'s Stops updates automatically.</div>';
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

  let lastId=null;
  async function load(){
    try{
      const r=await fetch('/api/today-route',{cache:'no-store'});if(!r.ok)return;const e=await r.json();if(!e||!e.id)return;
      document.getElementById('hubStatus').textContent=e.status||'Hub update received';
      document.getElementById('hubDriver').textContent=e.driver||'Driver';
      document.getElementById('hubStops').textContent=e.stops??'—';
      document.getElementById('hubPackages').textContent=e.packages??'—';
      document.getElementById('hubEta').textContent=e.eta||'—';
      document.getElementById('hubReceived').textContent='Received '+(e.receivedAt?new Date(e.receivedAt).toLocaleString():'')+(e.body?' • '+e.body:'');
      const media=document.getElementById('hubMedia');
      if(Array.isArray(e.media)&&e.media.length){media.innerHTML='<b>Hub sheet attached:</b> '+e.media.map((m,i)=>`<a href="/api/media/${i}?v=${encodeURIComponent(e.id)}" target="_blank" rel="noopener">Attachment ${i+1}</a>`).join(' • ')} else media.innerHTML='';
      if(e.stops!=null){upsertStop(localDate(),Number(e.stops),'Hub SMS/MMS');const input=document.getElementById('stops');const date=document.getElementById('date');if(input&&date?.value===localDate())input.value=e.stops}
      if(lastId!==e.id){lastId=e.id;try{localStorage.setItem('amazonHubLatestDispatch',JSON.stringify(e))}catch{}}
    }catch{}
    renderStopStats();
  }
  renderStopStats();load();setInterval(load,15000);
})();
