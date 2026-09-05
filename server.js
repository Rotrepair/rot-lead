const http=require('http');
const fs=require('fs');
const path=require('path');
const port=process.env.PORT||3000;
const publicDir=path.join(__dirname,'public');
const etaFile='/tmp/amazon-hub-eta.json';

function readEta(){try{return JSON.parse(fs.readFileSync(etaFile,'utf8'))}catch{return {latest:null,history:[]}}}
function writeEta(data){try{fs.writeFileSync(etaFile,JSON.stringify(data,null,2))}catch(e){console.error('ETA save error',e.message)}}
function parseEtaMessage(body=''){
  const pkg=body.match(/(\d+)\s*(?:packages?|pkgs?)/i);
  const eta=body.match(/\beta\s*[:\-]?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|\d+\s*(?:mins?|minutes?|hrs?|hours?))/i);
  return {packages:pkg?Number(pkg[1]):null,eta:eta?eta[1].trim():null};
}
function driverName(from){
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
function collect(req){return new Promise((resolve,reject)=>{let b='';req.on('data',d=>{b+=d;if(b.length>1e6)req.destroy()});req.on('end',()=>resolve(b));req.on('error',reject)})}
function json(res,obj,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}

const server=http.createServer(async(req,res)=>{
  const reqPath=req.url.split('?')[0];
  if(reqPath==='/api/eta'&&req.method==='GET')return json(res,readEta());
  if(reqPath==='/sms'&&req.method==='POST'){
    try{
      const raw=await collect(req),form=new URLSearchParams(raw),from=form.get('From')||'',body=form.get('Body')||'',parsed=parseEtaMessage(body),name=driverName(from),now=new Date().toISOString();
      const update={id:Date.now(),driver:name,from,body,packages:parsed.packages,eta:parsed.eta,receivedAt:now,status:parsed.eta?'ETA Received':'Message Received'};
      const data=readEta();data.latest=update;data.history=[update,...(data.history||[])].slice(0,100);writeEta(data);
      const owner=process.env.OWNER_PHONE_NUMBER;
      const alert=`Amazon Hub update — ${name}: ${parsed.packages!=null?parsed.packages+' packages, ':''}${parsed.eta?'ETA '+parsed.eta:body}`;
      try{await sendSms(owner,alert)}catch(e){console.error('Alert SMS failed',e.message)}
      res.writeHead(200,{'Content-Type':'text/xml'});
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>Update received${parsed.eta?`: ETA ${parsed.eta}`:''}. Thank you.</Message></Response>`);
    }catch(e){console.error(e);res.writeHead(500,{'Content-Type':'text/plain'});return res.end('Webhook error')}
  }
  let p=reqPath==='/'?'/index.html':reqPath;
  const filePath=path.join(publicDir,p);
  if(!filePath.startsWith(publicDir)){res.writeHead(403);return res.end('Forbidden')}
  fs.readFile(filePath,(err,data)=>{if(err){res.writeHead(404,{'Content-Type':'text/plain'});return res.end('Not found')}const ext=path.extname(filePath),type=ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.css'?'text/css':'application/octet-stream';res.writeHead(200,{'Content-Type':type});res.end(data)})
});
server.listen(port,'0.0.0.0',()=>console.log(`Amazon Hub Tracker running on ${port}`));
