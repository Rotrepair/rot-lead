// Optional UI login gate. Password is read from HUB_UI_PASSWORD; never hardcoded.
'use strict';

const crypto = require('crypto');
const {safeEqual} = require('./sync');

const COOKIE = 'hub_ui_session';
const MAX_AGE = 7 * 24 * 3600;

function uiPassword() { return String(process.env.HUB_UI_PASSWORD || '').trim(); }
function enabled() { return !!uiPassword(); }
function sessionSecret() {
  return String(process.env.HUB_UI_SESSION_SECRET || process.env.HUB_SYNC_TOKEN || uiPassword()).trim();
}

function sign(payload) {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('hex');
}

function makeCookie() {
  const payload = String(Date.now() + MAX_AGE * 1000);
  return `${COOKIE}=${payload}.${sign(payload)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

function clearCookie() {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function validSession(req) {
  if (!enabled()) return true;
  const raw = String(req.headers.cookie || '');
  const part = raw.split(/;\s*/).find((x) => x.startsWith(COOKIE + '='));
  if (!part) return false;
  const val = part.slice(COOKIE.length + 1);
  const i = val.lastIndexOf('.');
  if (i < 0) return false;
  const payload = val.slice(0, i);
  const sig = val.slice(i + 1);
  if (!safeEqual(sig, sign(payload))) return false;
  return Number(payload) > Date.now();
}

function needsGate(reqPath) {
  if (!enabled()) return false;
  if (reqPath === '/login' || reqPath === '/login.html' || reqPath === '/logout') return false;
  if (reqPath.startsWith('/api/') || reqPath === '/sms') return false;
  const ext = reqPath.includes('.') ? reqPath.slice(reqPath.lastIndexOf('.')) : '';
  if (ext && ext !== '.html') return false;
  return reqPath === '/' || ext === '.html' || reqPath === '/request' || !ext;
}

function loginPage(error) {
  const err = error ? `<p class="err">${error}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hub Tracker login</title>
<style>body{font-family:system-ui,Arial;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#111827;border:1px solid #243047;border-radius:16px;padding:24px;width:100%;max-width:360px}
label{display:block;margin:0 0 8px;color:#94a3b8;font-size:13px}input,button{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#fff}
button{margin-top:12px;background:#0ea5e9;border:0;font-weight:700;cursor:pointer}.err{color:#fca5a5;font-size:14px}</style></head>
<body><form method="post" action="/login"><h1 style="margin-top:0;font-size:22px">Amazon Hub Tracker</h1>
<p style="color:#94a3b8;font-size:14px">S.M.G LLC — sign in to continue.</p>
${err}<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form></body></html>`;
}

async function handle(req, res, reqPath, collect) {
  if (reqPath === '/logout') {
    res.writeHead(302, {Location: '/login', 'Set-Cookie': clearCookie()});
    res.end();
    return true;
  }
  if (reqPath === '/login' || reqPath === '/login.html') {
    if (req.method === 'POST') {
      const raw = await collect(req);
      const params = new URLSearchParams(raw);
      const given = String(params.get('password') || '');
      if (enabled() && given && safeEqual(given, uiPassword())) {
        res.writeHead(302, {Location: '/', 'Set-Cookie': makeCookie()});
        res.end();
        return true;
      }
      res.writeHead(401, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(loginPage('That password did not match.'));
      return true;
    }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(loginPage(''));
    return true;
  }
  if (needsGate(reqPath) && !validSession(req)) {
    res.writeHead(302, {Location: '/login', 'Cache-Control': 'no-store'});
    res.end();
    return true;
  }
  return false;
}

module.exports = {enabled, handle, validSession, needsGate};
