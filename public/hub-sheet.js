(()=>{
  const style=document.createElement('style');
  style.textContent='.hubroute{border-color:#22c55e}.hubroute .grid{margin-bottom:0}.hubmedia{margin-top:10px}.hubmedia a{color:#7dd3fc}.hubsmall{font-size:12px;color:#94a3b8}';
  document.head.appendChild(style);
  const etaSection=document.querySelector('.section.eta');
  if(!etaSection)return;
  const section=document.createElement('div');
  section.className='section hubroute';
  section.innerHTML='<div class="top"><h2>Today\'s Hub Route</h2><span class="status" id="hubStatus">Waiting for Hub message</span></div><div class="grid"><div class="card"><small>Driver</small><div class="big" id="hubDriver">—</div></div><div class="card"><small>Stops</small><div class="big" id="hubStops">—</div></div><div class="card"><small>Packages</small><div class="big" id="hubPackages">—</div></div><div class="card"><small>Arrival ETA</small><div class="big gold" id="hubEta">—</div></div></div><div class="hubsmall" id="hubReceived">No Hub route received yet.</div><div class="hubmedia" id="hubMedia"></div>';
  etaSection.insertAdjacentElement('afterend',section);
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
      if(Array.isArray(e.media)&&e.media.length){media.innerHTML='<b>Hub sheet attached:</b> '+e.media.map((m,i)=>`<a href="${m.url}" target="_blank" rel="noopener">Attachment ${i+1}</a>`).join(' • ')} else media.innerHTML='';
      if(lastId!==e.id){lastId=e.id;try{localStorage.setItem('amazonHubLatestDispatch',JSON.stringify(e))}catch{}}
    }catch{}
  }
  load();setInterval(load,15000);
})();
