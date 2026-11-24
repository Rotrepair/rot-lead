// Owner login for the hub UI and /api routes.
// Password: HUB_UI_PASSWORD. Cookie key: SESSION_SECRET (HUB_UI_SESSION_SECRET still works).
// Bots: Authorization: Bearer <HUB_API_TOKEN>.
// If a secret is missing, access stays closed. This module does not throw for that.
'use strict';

const crypto = require('crypto');
const {safeEqual} = require('./sync');

const COOKIE = 'hub_ui_session';
const MAX_AGE = 7 * 24 * 3600;

function uiPassword() { return String(process.env.HUB_UI_PASSWORD || '').trim(); }
function enabled() { return !!uiPassword(); }
function sessionSecret() {
  return String(process.env.SESSION_SECRET || process.env.HUB_UI_SESSION_SECRET || '').trim();
}
function apiToken() { return String(process.env.HUB_API_TOKEN || '').trim(); }

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
  // Missing password or signing secret must not leave the hub open.
  if (!enabled() || !sessionSecret()) return false;
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

function presentedBearer(req) {
  const header = String((req.headers && req.headers.authorization) || '');
  if (!/^Bearer\s+\S/i.test(header)) return '';
  return header.replace(/^Bearer\s+/i, '').trim();
}

function validBearer(req) {
  const expected = apiToken();
  if (!expected) return false;
  const given = presentedBearer(req);
  if (!given) return false;
  return safeEqual(given, expected);
}

function hasAccess(req) {
  return validSession(req) || validBearer(req);
}

// /sms is checked separately (Twilio signature). Sync and crossover keep their own tokens.
function isOpenPath(reqPath) {
  return reqPath === '/login' || reqPath === '/login.html' || reqPath === '/logout' || reqPath === '/sms';
}

function needsGate(reqPath) {
  return !isOpenPath(reqPath);
}

function loginPage(error) {
  const err = error ? `<p class="err">${error}</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hub Tracker login</title>
<style>body{font-family:system-ui,Arial;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
form{background:#111827;border:1px solid #243047;border-radius:16px;padding:24px;width:100%;max-width:360px}
label{display:block;margin:0 0 8px;color:#94a3b8;font-size:13px}input,button{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#fff}
button{margin-top:12px;background:#0ea5e9;border:0;font-weight:700;cursor:pointer}.err{color:#fca5a5;font-size:14px}</style></head>
<body><form method="post" action="/login"><h1 style="margin-top:0;font-size:22px">Amazon Hub Tracker</h1>
<p style="color:#94a3b8;font-size:14px">Owner sign-in. The hub stays closed until this password is accepted.</p>
${err}<label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button></form></body></html>`;
}

function deny(res, reqPath) {
  if (String(reqPath || '').startsWith('/api/')) {
    res.writeHead(401, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify({ok: false, error: 'unauthorized'}));
    return;
  }
  res.writeHead(302, {Location: '/login', 'Cache-Control': 'no-store'});
  res.end();
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
      if (!enabled()) {
        res.writeHead(503, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
        res.end(loginPage('The hub password is not set on the server yet.'));
        return true;
      }
      if (given && safeEqual(given, uiPassword())) {
        if (!sessionSecret()) {
          res.writeHead(503, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
          res.end(loginPage('Sign-in needs SESSION_SECRET on the server before it can open the hub.'));
          return true;
        }
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
  if (reqPath === '/sms') return false;
  if (!hasAccess(req)) {
    deny(res, reqPath);
    return true;
  }
  return false;
}

module.exports = {
  enabled,
  handle,
  validSession,
  validBearer,
  hasAccess,
  needsGate,
  sessionSecret,
  apiToken
};
