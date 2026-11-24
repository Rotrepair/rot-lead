const {describe, it, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const {spawn} = require('child_process');
const twilioSign = require('../lib/twilio-sign');

const root = path.join(__dirname, '..');
const PASSWORD = 'test-ui-password';
const SESSION = 'test-session-secret';
const API_TOKEN = 'test-api-token';
const TWILIO = 'test-twilio-token';
const CANARIES = ['555-014-2099', 'owner-secret@example.com', 'garage-note-secret', '7.75'];

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function seedState() {
  return {
    revision: 3,
    entries: [{
      id: 4242,
      date: '2026-11-20',
      driver: 'Me',
      packages: 10,
      hours: 7.75,
      miles: 42.5,
      expense: 19.25,
      source: 'manual'
    }],
    roster: [{
      name: 'Me',
      displayName: 'Eric',
      phone: '555-014-2099',
      email: 'owner-secret@example.com',
      role: 'Owner',
      status: 'active',
      availability: ['Mon'],
      note: 'garage-note-secret',
      hubs: ['S.M.G LLC']
    }],
    drivers: ['Me'],
    stops: [],
    deleted: []
  };
}

async function startServer(extraEnv, seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-auth-'));
  if (seed) fs.writeFileSync(path.join(dir, 'amazon-hub-state.json'), JSON.stringify(seed));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || os.homedir(),
      PORT: String(port),
      HUB_DATA_DIR: dir,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  let ready = false;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server start timed out\n' + log)), 8000);
      const onData = (buf) => {
        log += buf.toString();
        if (!ready && log.includes('running on')) {
          ready = true;
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => {
        if (!ready) {
          clearTimeout(timer);
          reject(new Error('server exited ' + code + '\n' + log));
        }
      });
    });
  } catch (err) {
    child.kill('SIGKILL');
    throw err;
  }
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    dir,
    stop() { child.kill('SIGTERM'); }
  };
}

function assertNoCanaries(text) {
  for (const secret of CANARIES) assert.equal(text.includes(secret), false, 'response leaked ' + secret);
}

describe('twilio signature', () => {
  it('matches the documented HMAC-SHA1 construction', () => {
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675310',
      Digits: '1234',
      From: '+14158675310',
      To: '+18005551212'
    };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    assert.equal(twilioSign.signatureFor('12345', url, params), 'GvWf1cFY/Q7PnoempGyD5oXAezc=');
  });

  it('builds the public URL Railway forwards', () => {
    const url = twilioSign.requestUrl({
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'amazon-hub-tracker-production.up.railway.app',
        host: 'internal:3000'
      },
      url: '/sms'
    });
    assert.equal(url, 'https://amazon-hub-tracker-production.up.railway.app/sms');
    assert.equal(twilioSign.requestUrl({
      headers: {'x-forwarded-proto': 'https', host: 'example.com:443'},
      url: '/sms'
    }), 'https://example.com/sms');
  });

  it('rejects a missing token without throwing', () => {
    const prev = process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      const verdict = twilioSign.verify({headers: {}, url: '/sms'}, 'Body=hi');
      assert.equal(verdict.ok, false);
      assert.equal(verdict.reason, 'missing-token');
    } finally {
      if (prev === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = prev;
    }
  });
});

describe('hub owner gate', () => {
  let hub;
  before(async () => {
    hub = await startServer({
      HUB_UI_PASSWORD: PASSWORD,
      SESSION_SECRET: SESSION,
      HUB_API_TOKEN: API_TOKEN,
      TWILIO_AUTH_TOKEN: TWILIO
    }, seedState());
  });
  after(() => hub && hub.stop());

  it('does not ship the old write header', () => {
    for (const file of ['server.js', 'public/index.html', 'public/request.html']) {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.equal(text.includes('x-hub-write'), false, file);
      assert.equal(text.includes('X-Hub-Write'), false, file);
      assert.equal(text.includes('explicit-v2'), false, file);
    }
  });

  it('keeps a public request closed and free of roster and pay data', async () => {
    const paths = ['/api/hub-state', '/api/company-profile', '/api/eta', '/api/today-route', '/api/hub-request-form'];
    for (const p of paths) {
      const res = await fetch(hub.base + p);
      const text = await res.text();
      assert.equal(res.status, 401, p);
      assert.equal(text, '{"ok":false,"error":"unauthorized"}');
      assertNoCanaries(text);
    }
    const page = await fetch(hub.base + '/', {redirect: 'manual'});
    const html = await page.text();
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login');
    assert.equal(html.includes('1.10'), false);
    assertNoCanaries(html);
    const history = await fetch(hub.base + '/history-data.js', {redirect: 'manual'});
    const script = await history.text();
    assert.equal(history.status, 302);
    assert.equal(script.includes('Imported 2026 history'), false);
    assertNoCanaries(script);
    const sync = await fetch(hub.base + '/api/sync/export');
    const syncBody = await sync.text();
    assert.notEqual(sync.status, 200);
    assertNoCanaries(syncBody);
  });

  it('gives the owner session the full hub', async () => {
    const login = await fetch(hub.base + '/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({password: PASSWORD}),
      redirect: 'manual'
    });
    assert.equal(login.status, 302);
    const setCookie = login.headers.get('set-cookie') || '';
    const session = setCookie.split(';')[0];
    assert.match(session, /^hub_ui_session=/);
    const res = await fetch(hub.base + '/api/hub-state', {headers: {cookie: session}});
    const text = await res.text();
    assert.equal(res.status, 200);
    for (const secret of CANARIES) assert.equal(text.includes(secret), true, 'session response missing ' + secret);
    const page = await fetch(hub.base + '/', {headers: {cookie: session}, redirect: 'manual'});
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.equal(html.includes('Add Daily Route'), true);
    assert.equal(html.includes('Employee Pay'), true);
    const history = await fetch(hub.base + '/history-data.js', {headers: {cookie: session}, redirect: 'manual'});
    assert.equal(history.status, 200);
    assert.equal((await history.text()).includes('Imported 2026 history'), true);
  });

  it('gives the bot token the full hub', async () => {
    const res = await fetch(hub.base + '/api/hub-state', {headers: {Authorization: 'Bearer ' + API_TOKEN}});
    const text = await res.text();
    assert.equal(res.status, 200);
    for (const secret of CANARIES) assert.equal(text.includes(secret), true);
    const wrong = await fetch(hub.base + '/api/hub-state', {headers: {Authorization: 'Bearer wrong-token'}});
    const hidden = await wrong.text();
    assert.equal(wrong.status, 401);
    assertNoCanaries(hidden);
  });

  it('rejects a write with no auth, including the old header', async () => {
    const before = fs.readFileSync(path.join(hub.dir, 'amazon-hub-state.json'), 'utf8');
    const body = JSON.stringify({entries: [{id: 999001, date: '2026-11-21', driver: 'Me', packages: 1, hours: 9}]});
    const open = await fetch(hub.base + '/api/hub-state', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body
    });
    assert.equal(open.status, 401);
    assertNoCanaries(await open.text());
    const headerOnly = await fetch(hub.base + '/api/hub-state', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Hub-Write': 'explicit-v2'},
      body
    });
    assert.equal(headerOnly.status, 401);
    assert.equal(fs.readFileSync(path.join(hub.dir, 'amazon-hub-state.json'), 'utf8'), before);
    const authed = await fetch(hub.base + '/api/hub-state', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + API_TOKEN},
      body: JSON.stringify({entries: [{id: 4242, date: '2026-11-20', driver: 'Me', packages: 11, hours: 7.75, miles: 42.5, expense: 19.25}]})
    });
    const saved = await authed.text();
    assert.equal(authed.status, 200, saved);
    assert.equal(saved.includes('"ok":true'), true);
    assert.equal(saved.includes('7.75'), true);
  });

  it('rejects a bad Twilio signature and accepts a real one', async () => {
    const badBody = new URLSearchParams({From: '+15550001111', Body: 'PWNED-ETA 3 packages'}).toString();
    const bad = await fetch(hub.base + '/sms', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'not-a-real-signature'},
      body: badBody
    });
    assert.equal(bad.status, 403);
    const etaPath = path.join(hub.dir, 'amazon-hub-eta.json');
    if (fs.existsSync(etaPath)) assert.equal(fs.readFileSync(etaPath, 'utf8').includes('PWNED-ETA'), false);

    const fields = {From: '+15550001111', Body: 'Eric 12 packages ETA 4pm'};
    const raw = new URLSearchParams(fields).toString();
    const url = `http://127.0.0.1:${hub.port}/sms`;
    const signature = twilioSign.signatureFor(TWILIO, url, fields);
    const good = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature},
      body: raw
    });
    const text = await good.text();
    assert.equal(good.status, 200, text);
    assert.equal(text.includes('Hub Tracker updated'), true);
    const saved = fs.readFileSync(etaPath, 'utf8');
    assert.equal(saved.includes('Eric'), true);
    assert.equal(saved.includes('PWNED-ETA'), false);
  });
});

describe('missing secrets fail closed', () => {
  let hub;
  before(async () => {
    hub = await startServer({HUB_UI_PASSWORD: PASSWORD}, seedState());
  });
  after(() => hub && hub.stop());

  it('stays up and hides data when the session secret, api token, and twilio token are unset', async () => {
    const api = await fetch(hub.base + '/api/hub-state');
    const text = await api.text();
    assert.equal(api.status, 401);
    assertNoCanaries(text);
    const page = await fetch(hub.base + '/', {redirect: 'manual'});
    assert.equal(page.status, 302);
    const login = await fetch(hub.base + '/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({password: PASSWORD}),
      redirect: 'manual'
    });
    const loginBody = await login.text();
    assert.equal(login.status, 503);
    assert.equal(loginBody.includes('SESSION_SECRET'), true);
    assert.equal((login.headers.get('set-cookie') || '').includes('hub_ui_session='), false);
    const sms = await fetch(hub.base + '/sms', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'anything'},
      body: 'Body=hello'
    });
    assert.equal(sms.status, 403);
    const still = await fetch(hub.base + '/login');
    assert.equal(still.status, 200);
  });

  it('stays up and hides data when the owner password is unset', async () => {
    const closed = await startServer({}, seedState());
    try {
      const api = await fetch(closed.base + '/api/hub-state');
      const text = await api.text();
      assert.equal(api.status, 401);
      assertNoCanaries(text);
      const page = await fetch(closed.base + '/', {redirect: 'manual'});
      assert.equal(page.status, 302);
      const login = await fetch(closed.base + '/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({password: PASSWORD}),
        redirect: 'manual'
      });
      const body = await login.text();
      assert.equal(login.status, 503);
      assert.equal(body.includes('password is not set'), true);
      const again = await fetch(closed.base + '/login');
      assert.equal(again.status, 200);
    } finally {
      closed.stop();
    }
  });
});
