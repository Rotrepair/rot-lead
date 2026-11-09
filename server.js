const http=require('http');
const fs=require('fs');
const path=require('path');
const port=process.env.PORT||3000;
const publicDir=path.join(__dirname,'public');
const dataDir=process.env.HUB_DATA_DIR||'/data';
try{fs.mkdirSync(dataDir,{recursive:true})}catch{}
const etaFile=path.join(dataDir,'amazon-hub-eta.json');
const hubStateFile=path.join(dataDir,'amazon-hub-state.json');
const mediaDir=path.join(dataDir,'amazon-hub-media');
try{fs.mkdirSync(mediaDir,{recursive:true})}catch{}

function readEta(){try{return JSON.parse(fs.readFileSync(etaFile,'utf8'))}catch{return {latest:null,todayRoute:null,history:[]}}}
function writeEta(data){try{fs.writeFileSync(etaFile,JSON.stringify(data,null,2))}catch(e){console.error('ETA save error',e.message)}}
const requiredRouteEntries=[
  {id:100128,date:'2026-09-05',driver:'Me',packages:46,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100129,date:'2026-09-06',driver:'Me',packages:35,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100130,date:'2026-09-07',driver:'Me',packages:32,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100131,date:'2026-09-07',driver:'AJ',packages:30,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100132,date:'2026-09-08',driver:'Me',packages:62,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100133,date:'2026-09-09',driver:'Me',packages:49,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100134,date:'2026-09-10',driver:'Me',packages:47,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100135,date:'2026-09-11',driver:'Me',packages:54,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100136,date:'2026-09-12',driver:'Tisha',packages:47,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100137,date:'2026-09-14',driver:'Tisha',packages:53,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100138,date:'2026-09-15',driver:'Tisha',packages:60,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100139,date:'2026-09-16',driver:'Me',packages:48,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'},
  {id:100140,date:'2026-09-17',driver:'Me',packages:37,hours:0,miles:0,expense:0,source:'Imported Sep 2026 operations'}
];
const DEFAULT_DRIVERS=['Me','Mom','Tisha','AJ','Suzanne'];
const HUB_LIST=[{id:'rotrepair',name:'Right On Time Repair'},{id:'smg',name:'SMG Logistics'}];
const DEFAULT_HUB='Right On Time Repair';
const WEEKDAYS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const ROSTER_STATUSES=['active','occasional','onboarding','inactive'];
const HIRING_NOTE='Hiring: 1 consistent 5-day driver';
const ROSTER_SEED=[
  {name:'Me',displayName:'Eric',phone:'',email:'',role:'Owner',availability:WEEKDAYS.slice(),maybeDays:[],status:'active',hubs:[DEFAULT_HUB],note:'Main hub owner. Past routes stay saved as Me.'},
  {name:'Mom',displayName:'Mom',phone:'',email:'',role:'Driver',availability:[],maybeDays:[],status:'active',hubs:[DEFAULT_HUB],note:''},
  {name:'Tisha',displayName:'Tisha',phone:'',email:'',role:'Driver',availability:[],maybeDays:[],status:'active',hubs:[DEFAULT_HUB],note:''},
  {name:'AJ',displayName:'AJ',phone:'',email:'',role:'Driver',availability:[],maybeDays:[],status:'active',hubs:[DEFAULT_HUB],note:''},
  {name:'Suzanne',displayName:'Suzanne',phone:'',email:'',role:'Driver',availability:['Mon','Wed','Thu'],maybeDays:['Thu'],status:'active',hubs:[DEFAULT_HUB],note:'Thursday is maybe.'},
  {name:'Valerie',displayName:'Valerie',phone:'',email:'',role:'Point of contact',availability:[],maybeDays:[],status:'onboarding',hubs:['SMG Logistics'],note:'Rarely drives. Point of contact for SMG Logistics.'},
  {name:'Roxanne',displayName:'Roxanne',phone:'',email:'',role:'Driver',availability:[],maybeDays:[],status:'occasional',hubs:[DEFAULT_HUB],note:''}
];
function normDeleted(list){return Array.isArray(list)?list.filter(d=>d&&d.id!=null).map(d=>({...d,id:String(d.id)})):[]}
function normDrivers(list){
  const out=[];for(const d of Array.isArray(list)?list:[]){const n=String(d||'').trim().slice(0,40);if(n&&!out.some(x=>x.toLowerCase()===n.toLowerCase()))out.push(n)}
  if(!out.includes('Me'))out.unshift('Me');
  return out;
}
function canonicalHub(value){
  const s=String(value||'').trim();
  if(!s)return '';
  const hit=HUB_LIST.find(h=>h.name.toLowerCase()===s.toLowerCase()||h.id.toLowerCase()===s.toLowerCase());
  return hit?hit.name:'';
}
function entryHubName(e){return canonicalHub(e?.hub)||DEFAULT_HUB}
function normDays(list){
  const out=[];
  for(const d of Array.isArray(list)?list:[]){
    const hit=WEEKDAYS.find(x=>x.toLowerCase()===String(d||'').trim().toLowerCase());
    if(hit&&!out.includes(hit))out.push(hit);
  }
  return out;
}
function normRosterRow(raw){
  const name=String(raw?.name||'').trim().slice(0,40);
  if(!name)return null;
  const seed=ROSTER_SEED.find(r=>r.name.toLowerCase()===name.toLowerCase());
  const src=raw&&typeof raw==='object'?raw:{};
  const storedName=seed?.name==='Me'||name.toLowerCase()==='me'?'Me':name;
  const availability=normDays(src.availability!=null?src.availability:seed?.availability||[]);
  const maybeDays=normDays(src.maybeDays!=null?src.maybeDays:seed?.maybeDays||[]).filter(d=>availability.includes(d));
  const hubs=[];
  for(const h of Array.isArray(src.hubs)?src.hubs:(seed?.hubs||[DEFAULT_HUB])){const n=canonicalHub(h);if(n&&!hubs.includes(n))hubs.push(n)}
  let status=ROSTER_STATUSES.includes(src.status)?src.status:(seed?.status||'active');
  if(storedName==='Me')status='active';
  return {
    name:storedName,
    displayName:String(src.displayName!=null?src.displayName:(seed?.displayName||'')).trim().slice(0,40)||(storedName==='Me'?'Eric':storedName),
    phone:String(src.phone!=null?src.phone:(seed?.phone||'')).trim().slice(0,40),
    email:String(src.email!=null?src.email:(seed?.email||'')).trim().slice(0,80),
    role:String(src.role!=null?src.role:(seed?.role||'')).trim().slice(0,40)||(storedName==='Me'?'Owner':'Driver'),
    availability,maybeDays,status,
    hubs:hubs.length?hubs:[DEFAULT_HUB],
    note:String(src.note!=null?src.note:(seed?.note||'')).trim().slice(0,200)
  };
}
function driversFromRoster(roster){
  return normDrivers(roster.filter(r=>r&&r.status!=='inactive').map(r=>r.name));
}
function buildRoster(state){
  const rosterMissing=!Array.isArray(state.roster);
  let drivers=normDrivers(Array.isArray(state.drivers)?state.drivers:DEFAULT_DRIVERS);
  if(rosterMissing){
    for(const name of ['Valerie','Roxanne']){
      if(!drivers.some(d=>d.toLowerCase()===name.toLowerCase()))drivers.push(name);
    }
  }
  const byName=new Map();
  if(!rosterMissing){
    for(const raw of state.roster){
      const row=normRosterRow(raw);
      if(row)byName.set(row.name.toLowerCase(),row);
    }
  }
  for(const name of drivers){
    const key=name.toLowerCase();
    if(byName.has(key))continue;
    const seed=ROSTER_SEED.find(r=>r.name.toLowerCase()===key);
    byName.set(key,normRosterRow(seed||{name}));
  }
  const roster=[...byName.values()];
  const rank=new Map(drivers.map((n,i)=>[n.toLowerCase(),i]));
  roster.sort((a,b)=>(rank.has(a.name.toLowerCase())?rank.get(a.name.toLowerCase()):1000)-(rank.has(b.name.toLowerCase())?rank.get(b.name.toLowerCase()):1000)||a.name.localeCompare(b.name));
  return {drivers:driversFromRoster(roster),roster};
}
function normIntake(list){
  const map=new Map();
  for(const raw of Array.isArray(list)?list:[]){
    if(!raw||!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date||'')))continue;
    const hub=canonicalHub(raw.hub);
    if(!hub)continue;
    const n=Number(raw.packages);
    if(!Number.isFinite(n)||n<0||n>100000)continue;
    map.set(String(raw.date)+'|'+hub,{date:String(raw.date),hub,packages:Math.round(n),updatedAt:raw.updatedAt||null});
  }
  return [...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.hub.localeCompare(b.hub));
}
function normRequests(list){
  const out=[];
  for(const raw of Array.isArray(list)?list:[]){
    if(!raw||raw.id==null)continue;
    const status=['pending','approved','declined'].includes(raw.status)?raw.status:'pending';
    const packages=Number(raw.packages);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(raw.date||''))||!canonicalHub(raw.hub)||!Number.isFinite(packages))continue;
    const row={
      id:String(raw.id).slice(0,40),
      driver:String(raw.driver||'').trim().slice(0,40),
      hub:canonicalHub(raw.hub),
      date:String(raw.date),
      packages:Math.max(0,Math.round(packages)),
      note:String(raw.note||'').trim().slice(0,280),
      status,
      createdAt:raw.createdAt||null,
      updatedAt:raw.updatedAt||null
    };
    if(status==='approved'){
      const approved=Number(raw.approvedPackages??raw.packages);
      row.approvedPackages=Number.isFinite(approved)?Math.max(0,Math.round(approved)):row.packages;
    }
    if(raw.decidedAt)row.decidedAt=raw.decidedAt;
    out.push(row);
  }
  return out.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id).localeCompare(String(a.id)));
}
function normHiring(h){
  if(h&&typeof h==='object')return {open:h.open!==false,note:h.note!=null?String(h.note).trim().slice(0,120):HIRING_NOTE};
  return {open:true,note:HIRING_NOTE};
}
function rosterPublic(roster){
  return roster.filter(r=>r.status!=='inactive').map(r=>({name:r.name,displayName:r.displayName,hubs:r.hubs,status:r.status,role:r.role}));
}
function ensureRequiredEntries(state){
  const deleted=normDeleted(state.deleted);
  const deadIds=new Set(deleted.map(d=>d.id)),deadKeys=new Set(deleted.map(d=>d.date+'|'+d.driver));
  const built=buildRoster(state);
  const out={...state,entries:Array.isArray(state.entries)?state.entries.filter(e=>!deadIds.has(String(e?.id))).map(e=>({...e})):[],stops:Array.isArray(state.stops)?state.stops:[],deleted,drivers:built.drivers,roster:built.roster,intake:normIntake(state.intake),requests:normRequests(state.requests),hiring:normHiring(state.hiring),hubs:HUB_LIST.map(h=>h.name)};
  const keys=new Set(out.entries.map(e=>e?.date+'|'+e?.driver));
  const liveIds=new Set(out.entries.filter(e=>e?.id!=null).map(e=>String(e.id)));
  for(const e of requiredRouteEntries){const k=e.date+'|'+e.driver;if(deadIds.has(String(e.id))||deadKeys.has(k)||liveIds.has(String(e.id)))continue;if(!keys.has(k)){out.entries.push({...e});keys.add(k)}}
  return out;
}
function readHubState(){try{return ensureRequiredEntries(JSON.parse(fs.readFileSync(hubStateFile,'utf8')))}catch{return ensureRequiredEntries({entries:[],stops:[],updatedAt:null,revision:0})}}
function writeHubState(data){try{fs.writeFileSync(hubStateFile,JSON.stringify(data,null,2));return true}catch(e){console.error('Hub state save error',e.message);return false}}
const packageCorrections={'2026-09-19':44,'2026-09-29':40,'2026-10-05':37};
const clearedStopDates=new Set(['2026-10-05']);
function hasValue(v){return v!==null&&v!==undefined&&v!==''}
function mergeHubState(current,incoming){
  const map=new Map(),byId=new Map();
  // Deleted entries are remembered by id so an old browser cache can never bring them back.
  const deadIds=new Set(normDeleted(current.deleted).map(d=>d.id));
  for(const e of current.entries||[])if(e?.date&&e?.driver){map.set(e.date+'|'+e.driver+'|'+entryHubName(e),{...e});if(e.id!=null)byId.set(String(e.id),{...e})}
  for(const e of incoming.entries||[]){
    if(!e?.date||!e?.driver)continue;
    if(e.id!=null&&deadIds.has(String(e.id)))continue;
    // An entry edited from the history table only accepts writes from clients that have seen that edit.
    const known=e.id!=null?byId.get(String(e.id)):null;
    if(known&&known.editedAt&&e.editedAt!==known.editedAt)continue;
    if(known&&(known.date!==e.date||known.driver!==e.driver||entryHubName(known)!==entryHubName(e)))continue;
    const key=e.date+'|'+e.driver+'|'+entryHubName(e),old=map.get(key)||{},next={...old};
    for(const f of ['id','date','driver','packages','hours','startMiles','endMiles','miles','expense','source']){
      if(hasValue(e[f]))next[f]=e[f];
    }
    if(hasValue(e.hub)){const hub=canonicalHub(e.hub);if(hub)next.hub=hub}
    if(packageCorrections[e.date]!=null&&e.driver==='Me'&&!next.editedAt)next.packages=packageCorrections[e.date];
    if(next.startMiles!=null&&next.endMiles!=null&&Number(next.endMiles)>=Number(next.startMiles))next.miles=Number(next.endMiles)-Number(next.startMiles);
    next.updatedAt=new Date().toISOString(); map.set(key,next);
  }
  for(const [key,e] of map){if(packageCorrections[e.date]!=null&&e.driver==='Me'&&!e.editedAt)e.packages=packageCorrections[e.date];}
  const stopMap=new Map();
  for(const r of current.stops||[])if(r?.date)stopMap.set(r.date,{...r});
  for(const r of incoming.stops||[])if(r?.date&&!clearedStopDates.has(r.date))stopMap.set(r.date,{...stopMap.get(r.date),...r,updatedAt:new Date().toISOString()});
  for(const d of clearedStopDates)stopMap.delete(d);
  return {entries:[...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))),stops:[...stopMap.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))),deleted:normDeleted(current.deleted),drivers:current.drivers,roster:current.roster,intake:normIntake(current.intake),requests:normRequests(current.requests),hiring:normHiring(current.hiring),hubs:HUB_LIST.map(h=>h.name),updatedAt:new Date().toISOString(),revision:Number(current.revision||0)+1};
}
function parseMessage(body=''){
  const pkg=body.match(/(\d+)\s*(?:packages?|pkgs?)/i);
  const stops=body.match(/(\d+)\s*(?:stops?|drops?)/i);
  const eta=body.match(/\beta\s*[:\-]?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|\d+\s*(?:mins?|minutes?|hrs?|hours?))/i);
  const arrival=body.match(/(?:arrival|arrive|drop(?:\s*time)?)\s*(?:eta)?\s*[:\-]?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
  const done=/\b(done|complete|completed|finished)\b/i.test(body);
  const nameMatch=body.match(/^\s*([A-Za-z][A-Za-z .'-]{1,30}?)(?=\s+\d+\s*(?:packages?|pkgs?|stops?|drops?)|\s+ETA\b)/i);
  return {packages:pkg?Number(pkg[1]):null,stops:stops?Number(stops[1]):null,eta:(eta?eta[1]:arrival?arrival[1]:null)?.trim()||null,done,driverFromBody:nameMatch?nameMatch[1].trim():null};
}
function driverName(from,bodyName){
  if(bodyName)return bodyName;
  const map={};
  if(process.env.MOM_PHONE_NUMBER)map[process.env.MOM_PHONE_NUMBER]='Mom';
  if(process.env.DRIVER_PHONE_NUMBER)map[process.env.DRIVER_PHONE_NUMBER]=process.env.DRIVER_NAME||'Driver';
  return map[from]||from||'Driver';
}
async function sendSms(to,body){
  const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN,from=process.env.TWILIO_PHONE_NUMBER;
  if(!sid||!token||!from||!to)return {skipped:true};
  const params=new URLSearchParams({To:to,From:from,Body:body});
  const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,{method:'POST',headers:{'Authorization':'Basic '+Buffer.from(`${sid}:${token}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:params});
  if(!r.ok)throw new Error(`Twilio ${r.status}: ${await r.text()}`);
  return r.json();
}
function basic(user,pass){return user&&pass?'Basic '+Buffer.from(`${user}:${pass}`).toString('base64'):null}
function mediaAuthCandidates(accountSid){
  const out=[];
  const keySid=process.env.TWILIO_API_KEY_SID,keySecret=process.env.TWILIO_API_KEY_SECRET;
  if(keySid&&keySecret)out.push({label:'api-key',header:basic(keySid,keySecret)});
  const envSid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
  if(accountSid&&token)out.push({label:'webhook-account-token',header:basic(accountSid,token)});
  if(envSid&&token&&envSid!==accountSid)out.push({label:'env-account-token',header:basic(envSid,token)});
  return out;
}
async function fetchTwilioMedia(url,accountSid){
  const attempts=mediaAuthCandidates(accountSid);
  if(!attempts.length){console.error('Media fetch blocked: no Twilio media credentials configured');return {response:null,authMode:'missing'};}
  let last=null;
  for(const a of attempts){
    try{
      const r=await fetch(url,{headers:{Authorization:a.header},redirect:'follow'});last=r;
      if(r.ok)return {response:r,authMode:a.label};
      console.error('Media fetch attempt failed',r.status,a.label,new URL(url).hostname);
    }catch(e){console.error('Media fetch error',a.label,e.message)}
  }
  return {response:last,authMode:'failed'};
}
async function cacheMedia(item,idx,accountSid){
  if(!item?.url)return item;
  try{
    const {response:r,authMode}=await fetchTwilioMedia(item.url,accountSid);
    if(!r||!r.ok)return {...item,cacheError:r?`Twilio media returned ${r.status}`:'No media credentials',authMode};
    const buf=Buffer.from(await r.arrayBuffer());
    const type=r.headers.get('content-type')||item.type||'application/octet-stream';
    const ext=type.includes('png')?'.png':type.includes('jpeg')||type.includes('jpg')?'.jpg':type.includes('pdf')?'.pdf':'.bin';
    const file=`route-${Date.now()}-${idx}${ext}`,full=path.join(mediaDir,file);fs.writeFileSync(full,buf);
    return {...item,cachedFile:file,type,authMode,cacheError:null};
  }catch(e){console.error('Media cache error',e.message);return {...item,cacheError:e.message}}
}
function collect(req){return new Promise((resolve,reject)=>{let b='';req.on('data',d=>{b+=d;if(b.length>2e6)req.destroy()});req.on('end',()=>resolve(b));req.on('error',reject)})}
function json(res,obj,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function sameLocalDay(a,b){return a&&b&&String(a).slice(0,10)===String(b).slice(0,10)}

const server=http.createServer(async(req,res)=>{
  const reqPath=req.url.split('?')[0];
  if(reqPath==='/api/hub-state'&&req.method==='GET')return json(res,readHubState());
  if(reqPath==='/api/hub-state'&&req.method==='POST'){
    try{
      const current=readHubState();
      // Only the current client may write shared state. Older open tabs used to POST
      // their whole localStorage every 20 seconds and could overwrite newer data.
      if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:true,ignoredStaleClient:true,...current});
      const raw=await collect(req),incoming=JSON.parse(raw||'{}'),merged=mergeHubState(current,incoming||{});
      if(!writeHubState(merged))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,...merged});
    }catch(e){console.error('Hub sync error',e.message);return json(res,{ok:false,error:e.message},400)}
  }
  const entryMatch=reqPath.match(/^\/api\/hub-state\/entries\/([^/]+)$/);
  if(entryMatch&&(req.method==='DELETE'||req.method==='PUT')){
    if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:false,error:'missing write header'},403);
    try{
      const id=decodeURIComponent(entryMatch[1]),current=readHubState(),idx=current.entries.findIndex(e=>String(e.id)===id);
      if(idx<0)return json(res,{ok:false,error:'entry not found'},404);
      const now=new Date().toISOString(),old=current.entries[idx];
      if(req.method==='DELETE'){
        current.entries.splice(idx,1);
        current.deleted=[...normDeleted(current.deleted).filter(d=>d.id!==id),{id,date:old.date,driver:old.driver,packages:old.packages,deletedAt:now,entry:old}];
      }else{
        const body=JSON.parse(await collect(req)||'{}'),next={...old};
        if(body.date!=null){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date)))return json(res,{ok:false,error:'invalid date'},400);next.date=String(body.date)}
        if(body.driver!=null){const d=String(body.driver).trim().slice(0,40);if(!d)return json(res,{ok:false,error:'driver required'},400);next.driver=d}
        for(const f of ['packages','hours','miles','expense','startMiles','endMiles']){
          if(!(f in body))continue;const v=body[f];
          if(v===null||v===''){next[f]=(f==='startMiles'||f==='endMiles')?null:0;continue}
          const n=Number(v);if(!Number.isFinite(n)||n<0)return json(res,{ok:false,error:'invalid '+f},400);next[f]=n;
        }
        if(next.startMiles!=null&&next.endMiles!=null){if(Number(next.endMiles)<Number(next.startMiles))return json(res,{ok:false,error:'ending odometer is below starting odometer'},400);next.miles=Number(next.endMiles)-Number(next.startMiles)}
        if('hub' in body){const hub=canonicalHub(body.hub);if(!hub)return json(res,{ok:false,error:'invalid hub'},400);next.hub=hub}
        if(current.entries.some((e,i)=>i!==idx&&e.date===next.date&&e.driver===next.driver&&entryHubName(e)===entryHubName(next)))return json(res,{ok:false,error:`There is already an entry for ${next.driver} on ${next.date} at ${entryHubName(next)}. Edit or delete that one instead.`},409);
        next.editedAt=now;next.updatedAt=now;current.entries[idx]=next;
        current.entries.sort((a,b)=>String(a.date).localeCompare(String(b.date)));
        if(!current.drivers.some(d=>d.toLowerCase()===next.driver.toLowerCase()))current.drivers.push(next.driver);
        if(old.date!==next.date||old.driver!==next.driver){
          const seed=requiredRouteEntries.find(e=>e.date===old.date&&e.driver===old.driver);
          // A moved seeded row must not leave its old slot empty for the hardcoded copy to refill.
          // The tombstone id is not the living entry id, so the moved row stays visible.
          if(seed){const tombId='seed:'+seed.id;current.deleted=[...normDeleted(current.deleted).filter(d=>d.id!==tombId),{id:tombId,date:old.date,driver:old.driver,deletedAt:now}];}
        }
      }
      current.updatedAt=now;current.revision=Number(current.revision||0)+1;
      if(!writeHubState(current))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,...readHubState()});
    }catch(e){console.error('Hub entry error',e.message);return json(res,{ok:false,error:e.message},400)}
  }
  if(reqPath==='/api/hub-drivers'&&req.method==='POST'){
    if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:false,error:'missing write header'},403);
    try{
      const body=JSON.parse(await collect(req)||'{}'),current=readHubState();
      if(!Array.isArray(body.drivers))return json(res,{ok:false,error:'drivers list required'},400);
      let diskDrivers=null;
      try{const disk=JSON.parse(fs.readFileSync(hubStateFile,'utf8'));if(Array.isArray(disk.drivers))diskDrivers=normDrivers(disk.drivers)}catch{}
      const baseline=diskDrivers||DEFAULT_DRIVERS.slice();
      const posted=normDrivers(body.drivers);
      const roster=current.roster.map(r=>({...r,availability:(r.availability||[]).slice(),maybeDays:(r.maybeDays||[]).slice(),hubs:(r.hubs||[]).slice()}));
      for(const name of baseline){
        if(name==='Me'||posted.some(p=>p.toLowerCase()===name.toLowerCase()))continue;
        const row=roster.find(r=>r.name.toLowerCase()===name.toLowerCase());
        if(row)row.status='inactive';
      }
      for(const name of posted){
        let row=roster.find(r=>r.name.toLowerCase()===name.toLowerCase());
        if(!row){row=normRosterRow({name});if(row)roster.push(row)}
        else if(row.status==='inactive')row.status='active';
      }
      const me=roster.find(r=>r.name==='Me');if(me)me.status='active';
      current.roster=roster;current.drivers=driversFromRoster(roster);current.updatedAt=new Date().toISOString();current.revision=Number(current.revision||0)+1;
      if(!writeHubState(current))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,...readHubState()});
    }catch(e){return json(res,{ok:false,error:e.message},400)}
  }
  if(reqPath==='/api/hub-roster'&&req.method==='POST'){
    if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:false,error:'missing write header'},403);
    try{
      const body=JSON.parse(await collect(req)||'{}'),current=readHubState();
      if(!Array.isArray(body.roster))return json(res,{ok:false,error:'roster required'},400);
      const rows=[];
      for(const raw of body.roster){
        const row=normRosterRow(raw);
        if(row&&!rows.some(r=>r.name.toLowerCase()===row.name.toLowerCase()))rows.push(row);
      }
      if(!rows.some(r=>r.name==='Me'))rows.unshift(normRosterRow(ROSTER_SEED[0]));
      const me=rows.find(r=>r.name==='Me');if(me)me.status='active';
      current.roster=rows;current.drivers=driversFromRoster(rows);
      if(body.hiring&&typeof body.hiring==='object')current.hiring=normHiring(body.hiring);
      current.updatedAt=new Date().toISOString();current.revision=Number(current.revision||0)+1;
      if(!writeHubState(current))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,...readHubState()});
    }catch(e){return json(res,{ok:false,error:e.message},400)}
  }
  if(reqPath==='/api/hub-intake'&&req.method==='POST'){
    if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:false,error:'missing write header'},403);
    try{
      const body=JSON.parse(await collect(req)||'{}'),current=readHubState();
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date||'')))return json(res,{ok:false,error:'invalid date'},400);
      const hub=canonicalHub(body.hub);if(!hub)return json(res,{ok:false,error:'invalid hub'},400);
      const n=Number(body.packages);if(!Number.isFinite(n)||n<0||n>100000)return json(res,{ok:false,error:'invalid packages'},400);
      const now=new Date().toISOString();
      const next=normIntake(current.intake).filter(r=>!(r.date===String(body.date)&&r.hub===hub));
      next.push({date:String(body.date),hub,packages:Math.round(n),updatedAt:now});
      current.intake=normIntake(next);current.updatedAt=now;current.revision=Number(current.revision||0)+1;
      if(!writeHubState(current))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,...readHubState()});
    }catch(e){return json(res,{ok:false,error:e.message},400)}
  }
  if(reqPath==='/api/hub-request-form'&&req.method==='GET'){
    const current=readHubState();
    return json(res,{ok:true,hubs:current.hubs,hiring:current.hiring,drivers:rosterPublic(current.roster)});
  }
  if(reqPath==='/api/hub-requests'&&req.method==='POST'){
    if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:false,error:'missing write header'},403);
    try{
      const body=JSON.parse(await collect(req)||'{}'),current=readHubState();
      const person=current.roster.find(r=>r.name.toLowerCase()===String(body.driver||'').trim().toLowerCase()&&r.status!=='inactive');
      if(!person)return json(res,{ok:false,error:'Choose a driver from the roster.'},400);
      const hub=canonicalHub(body.hub);if(!hub)return json(res,{ok:false,error:'invalid hub'},400);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date||'')))return json(res,{ok:false,error:'invalid date'},400);
      const n=Number(body.packages);if(!Number.isFinite(n)||n<1||n>5000)return json(res,{ok:false,error:'Enter the number of packages you want.'},400);
      const pending=normRequests(current.requests).filter(r=>r.status==='pending'&&r.driver.toLowerCase()===person.name.toLowerCase()&&r.date===String(body.date)&&r.hub===hub);
      if(pending.length>=3)return json(res,{ok:false,error:'You already have three open requests for that day and hub.'},409);
      const now=new Date().toISOString();
      const row={id:'rq'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),driver:person.name,hub,date:String(body.date),packages:Math.round(n),note:String(body.note||'').trim().slice(0,280),status:'pending',createdAt:now,updatedAt:now};
      current.requests=[row,...normRequests(current.requests)];current.updatedAt=now;current.revision=Number(current.revision||0)+1;
      if(!writeHubState(current))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,request:row,...readHubState()});
    }catch(e){return json(res,{ok:false,error:e.message},400)}
  }
  const requestMatch=reqPath.match(/^\/api\/hub-requests\/([^/]+)$/);
  if(requestMatch&&req.method==='POST'){
    if(req.headers['x-hub-write']!=='explicit-v2')return json(res,{ok:false,error:'missing write header'},403);
    try{
      const id=decodeURIComponent(requestMatch[1]),body=JSON.parse(await collect(req)||'{}'),current=readHubState();
      const idx=current.requests.findIndex(r=>String(r.id)===id);
      if(idx<0)return json(res,{ok:false,error:'request not found'},404);
      const action=String(body.action||'');
      if(action!=='approve'&&action!=='decline')return json(res,{ok:false,error:'action must be approve or decline'},400);
      const now=new Date().toISOString(),row={...current.requests[idx],updatedAt:now,decidedAt:now};
      if(action==='decline')row.status='declined';
      else{
        const n=Number(body.packages??row.packages);
        if(!Number.isFinite(n)||n<0||n>5000)return json(res,{ok:false,error:'invalid packages'},400);
        row.status='approved';row.approvedPackages=Math.round(n);
      }
      current.requests[idx]=row;current.requests=normRequests(current.requests);current.updatedAt=now;current.revision=Number(current.revision||0)+1;
      if(!writeHubState(current))return json(res,{ok:false,error:'save failed'},500);
      return json(res,{ok:true,...readHubState()});
    }catch(e){return json(res,{ok:false,error:e.message},400)}
  }
  if(reqPath==='/api/eta'&&req.method==='GET')return json(res,readEta());
  if(reqPath==='/api/today-route'&&req.method==='GET')return json(res,readEta().todayRoute||readEta().latest||{});
  if(reqPath==='/api/media-status'&&req.method==='GET'){
    const data=readEta(),route=data.todayRoute||data.latest||{},items=route.media||[];
    return json(res,{hasMedia:items.length>0,cached:items.some(x=>x.cachedFile),needsApiKey:items.some(x=>x.cacheError)&&!(process.env.TWILIO_API_KEY_SID&&process.env.TWILIO_API_KEY_SECRET),items:items.map(x=>({type:x.type||'',cached:!!x.cachedFile,error:x.cacheError||null,authMode:x.authMode||null}))});
  }
  if(reqPath.startsWith('/api/media/')&&req.method==='GET'){
    try{
      const idx=Number(reqPath.split('/').pop()),data=readEta(),route=data.todayRoute||data.latest||{},item=(route.media||[])[idx];
      if(!item){res.writeHead(404);return res.end('Route sheet not found')}
      if(item.cachedFile){
        const full=path.join(mediaDir,path.basename(item.cachedFile));
        if(fs.existsSync(full)){const buf=fs.readFileSync(full);res.writeHead(200,{'Content-Type':item.type||'application/octet-stream','Cache-Control':'private, max-age=300'});return res.end(buf)}
      }
      if(!item.url){res.writeHead(404);return res.end('Route sheet not found')}
      const {response:r}=await fetchTwilioMedia(item.url,route.accountSid||process.env.TWILIO_ACCOUNT_SID);
      if(!r||!r.ok){res.writeHead(r?.status||502,{'Content-Type':'text/plain'});return res.end('Route sheet authentication failed. Configure TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET.')}
      const type=r.headers.get('content-type')||item.type||'application/octet-stream',buf=Buffer.from(await r.arrayBuffer());
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'private, max-age=60'});return res.end(buf)
    }catch(e){console.error('Media proxy error',e.message);res.writeHead(500);return res.end('Media error')}
  }
  if(reqPath==='/sms'&&req.method==='POST'){
    try{
      const raw=await collect(req),form=new URLSearchParams(raw),from=form.get('From')||'',body=form.get('Body')||'',parsed=parseMessage(body),name=driverName(from,parsed.driverFromBody),now=new Date().toISOString(),numMedia=Number(form.get('NumMedia')||0),accountSid=form.get('AccountSid')||process.env.TWILIO_ACCOUNT_SID||'',media=[];
      for(let i=0;i<numMedia;i++){
        const url=form.get(`MediaUrl${i}`),type=form.get(`MediaContentType${i}`);
        if(url)media.push({url,type:type||''});
      }
      const cached=[];for(let i=0;i<media.length;i++)cached.push(await cacheMedia(media[i],i,accountSid));
      const finalMedia=cached.length?cached:media;
      const data=readEta(),prev=data.todayRoute&&sameLocalDay(data.todayRoute.receivedAt,now)?data.todayRoute:null;
      let status='Message Received';
      if(parsed.done)status='Route Complete';
      else if(finalMedia.length&&parsed.eta)status='Hub Sheet + ETA Received';
      else if(finalMedia.length)status='Hub Sheet Received';
      else if(parsed.eta)status='ETA Received';
      const update={
        id:Date.now(),date:now.slice(0,10),driver:name,from,body,accountSid,
        packages:parsed.packages!=null?parsed.packages:(prev?.packages??null),
        stops:parsed.stops!=null?parsed.stops:(prev?.stops??null),
        eta:parsed.eta||prev?.eta||null,
        receivedAt:now,status,
        media:finalMedia.length?finalMedia:(prev?.media||[]),
        numMedia:finalMedia.length?finalMedia.length:(prev?.numMedia||0),
        source:finalMedia.length?'Hub MMS':'Hub SMS',
        routeSheetReceived:!!(finalMedia.length||(prev?.media||[]).length),
        routeSheetCached:finalMedia.some(x=>x.cachedFile)||(prev?.routeSheetCached||false),
        routeSheetAuthError:finalMedia.some(x=>x.cacheError)||(prev?.routeSheetAuthError||false),
        firstReceivedAt:prev?.firstReceivedAt||prev?.receivedAt||now
      };
      data.latest=update;data.todayRoute=update;data.history=[update,...(data.history||[])].slice(0,100);writeEta(data);
      const owner=process.env.OWNER_PHONE_NUMBER;
      const parts=[`${name}`];if(update.stops!=null)parts.push(`${update.stops} stops`);if(update.packages!=null)parts.push(`${update.packages} packages`);if(update.eta)parts.push(`ETA ${update.eta}`);if(update.routeSheetCached)parts.push('hub sheet ready');else if(update.routeSheetReceived)parts.push('hub sheet received');
      try{await sendSms(owner,`Amazon Hub update — ${parts.join(' • ')}`)}catch(e){console.error('Alert SMS failed',e.message)}
      res.writeHead(200,{'Content-Type':'text/xml'});
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hub Tracker updated${update.eta?`: ETA ${update.eta}`:''}${update.routeSheetCached?' with route sheet ready':update.routeSheetReceived?' with route sheet received':''}.</Message></Response>`);
    }catch(e){console.error(e);res.writeHead(500,{'Content-Type':'text/plain'});return res.end('Webhook error')}
  }
  let p=reqPath==='/'?'/index.html':reqPath==='/request'?'/request.html':reqPath;
  const filePath=path.join(publicDir,p);
  if(!filePath.startsWith(publicDir)){res.writeHead(403);return res.end('Forbidden')}
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}
    const ext=path.extname(filePath),type=ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.css'?'text/css':'application/octet-stream';
    if(ext==='.html'&&path.basename(filePath)==='index.html'){
      const html=data.toString('utf8').replace('</body>','<script src="/hub-sheet.js"></script></body>');
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(html);
    }
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store, no-cache, must-revalidate','Pragma':'no-cache','Expires':'0'});res.end(data)
  })
});
server.listen(port,'0.0.0.0',()=>console.log(`Amazon Hub Tracker running on ${port}`));
