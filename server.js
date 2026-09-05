const http=require('http');
const fs=require('fs');
const path=require('path');
const port=process.env.PORT||3000;
const publicDir=path.join(__dirname,'public');
const etaFile='/tmp/amazon-hub-eta.json';

function readEta(){try{return JSON.parse(fs.readFileSync(etaFile,'utf8'))}catch{return {latest:null,history:[]}}}
function writeEta(data){try{fs.writeFileSync(etaFile,JSON.stringify(data,null,2))}catch(e){console.error('ETA save error',e.message)}}
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
function collect(req){return new Promise((resolve,reject)=>{let b='';req.on('data',d=>{b+=d;if(b.length>2e6)req.destroy()});req.on('end',()=>resolve(b));req.on('error',reject)})}
function json(res,obj,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}

const server=http.createServer(async(req,res)=>{
  const reqPath=req.url.split('?')[0];
  if(reqPath==='/api/eta'&&req.method==='GET')return json(res,readEta());
  if(reqPath==='/api/today-route'&&req.method==='GET')return json(res,readEta().latest||{});
  if(reqPath==='/sms'&&req.method==='POST'){
    try{
      const raw=await collect(req),form=new URLSearchParams(raw),from=form.get('From')||'',body=form.get('Body')||'',parsed=parseMessage(body),name=driverName(from,parsed.driverFromBody),now=new Date().toISOString(),numMedia=Number(form.get('NumMedia')||0),media=[];
      for(let i=0;i<numMedia;i++){
        const url=form.get(`MediaUrl${i}`),type=form.get(`MediaContentType${i}`);
        if(url)media.push({url,type:type||''});
      }
      let status='Message Received';
      if(parsed.done)status='Route Complete';
      else if(media.length&&parsed.eta)status='Hub Sheet + ETA Received';
      else if(media.length)status='Hub Sheet Received';
      else if(parsed.eta)status='ETA Received';
      const update={id:Date.now(),date:now.slice(0,10),driver:name,from,body,packages:parsed.packages,stops:parsed.stops,eta:parsed.eta,receivedAt:now,status,media,numMedia,source:media.length?'Hub MMS':'Hub SMS'};
      const data=readEta();data.latest=update;data.todayRoute=update;data.history=[update,...(data.history||[])].slice(0,100);writeEta(data);
      const owner=process.env.OWNER_PHONE_NUMBER;
      const parts=[`${name}`];if(parsed.stops!=null)parts.push(`${parsed.stops} stops`);if(parsed.packages!=null)parts.push(`${parsed.packages} packages`);if(parsed.eta)parts.push(`ETA ${parsed.eta}`);if(media.length)parts.push('hub sheet received');
      try{await sendSms(owner,`Amazon Hub update — ${parts.join(' • ')}`)}catch(e){console.error('Alert SMS failed',e.message)}
      res.writeHead(200,{'Content-Type':'text/xml'});
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hub Tracker updated${parsed.eta?`: ETA ${parsed.eta}`:''}${media.length?' with route sheet':''}.</Message></Response>`);
    }catch(e){console.error(e);res.writeHead(500,{'Content-Type':'text/plain'});return res.end('Webhook error')}
  }
  let p=reqPath==='/'?'/index.html':reqPath;
  const filePath=path.join(publicDir,p);
  if(!filePath.startsWith(publicDir)){res.writeHead(403);return res.end('Forbidden')}
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}
    const ext=path.extname(filePath),type=ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.css'?'text/css':'application/octet-stream';
    if(ext==='.html'&&path.basename(filePath)==='index.html'){
      const html=data.toString('utf8').replace('</body>','<script src="/hub-sheet.js"></script></body>');
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});return res.end(html);
    }
    res.writeHead(200,{'Content-Type':type});res.end(data)
  })
});
server.listen(port,'0.0.0.0',()=>console.log(`Amazon Hub Tracker running on ${port}`));
