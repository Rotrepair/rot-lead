// Token-auth import/export and HMAC webhooks. Token comes only from env vars.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const {buildCrossoverPayload, inboundCrossover, stripBlocked} = require('./company-profile');
const {readXlsx} = require('./xlsx-simple');
const connecteam = require('./connecteam');

function syncToken() {
  return String(process.env.HUB_SYNC_TOKEN || '').trim();
}

function webhookSecret() {
  return String(process.env.HUB_WEBHOOK_SECRET || '').trim();
}

function webhookUrls(envName) {
  return String(process.env[envName] || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    if (left.length) crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function offeredToken(req) {
  const header = String(req.headers.authorization || '');
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  return bearer || String(req.headers['x-hub-sync-token'] || '').trim();
}

function requireSyncAuth(req) {
  const expected = syncToken();
  if (!expected) return {ok: false, status: 503, error: 'HUB_SYNC_TOKEN is not configured'};
  const given = offeredToken(req);
  if (!given || !safeEqual(given, expected)) return {ok: false, status: 401, error: 'unauthorized'};
  return {ok: true};
}

function entryDedupeKey(entry) {
  if (entry && entry.id != null && String(entry.id).trim() !== '') return 'id:' + String(entry.id);
  const date = String(entry && entry.date || '').trim();
  const driver = String(entry && entry.driver || '').trim();
  const hub = String(entry && entry.hub || '').trim();
  const packages = entry && entry.packages != null ? String(entry.packages) : '';
  return 'nat:' + [date, driver, hub, packages].join('|');
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const parseLine = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = parseLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] != null ? cols[i].trim() : ''; });
    if (row.packages != null && row.packages !== '') row.packages = Number(row.packages);
    if (row.hours != null && row.hours !== '') row.hours = Number(row.hours);
    if (row.miles != null && row.miles !== '') row.miles = Number(row.miles);
    if (row.expense != null && row.expense !== '') row.expense = Number(row.expense);
    return row;
  }).filter((row) => row.date || row.driver || row.id);
}

function isXlsxType(contentType, raw) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('spreadsheetml') || type.includes('application/vnd.ms-excel') || type.endsWith('sheet') || type.includes('application/xlsx')) return true;
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || '');
  return buf.length >= 4 && buf.slice(0, 2).toString() === 'PK';
}

function toBuffer(raw) {
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw || '');
}

function interpretImport(raw, contentType, query) {
  const q = query && typeof query === 'object' ? query : {};
  const forced = String(q.type || q.source || '').toLowerCase();
  const type = String(contentType || '');
  let rows, format;

  if (isXlsxType(type, raw) && (forced === 'connecteam' || forced === 'shifts' || forced === '' || type.includes('spreadsheet') || type.includes('xlsx'))) {
    try {
      rows = readXlsx(toBuffer(raw));
      format = 'xlsx';
    } catch (err) {
      if (forced === 'connecteam' || type.includes('spreadsheet') || type.includes('xlsx')) throw err;
    }
  }

  if (!rows) {
    if (type.includes('text/csv') || type.includes('application/csv') || forced === 'csv') {
      rows = parseCsv(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
      format = 'csv';
    } else {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '{}');
      const body = JSON.parse(text || '{}');
      format = 'json';
      if (Array.isArray(body)) rows = body;
      else if (Array.isArray(body.shifts)) rows = body.shifts;
      else if (Array.isArray(body.entries)) rows = body.entries;
      else if (body && (body.date || body.driver || body.id || body.shiftId || body.employee)) rows = [body];
      else rows = [];
      if (forced === 'connecteam' || forced === 'shifts' || body && (body.source === 'connecteam' || body.type === 'connecteam')) {
        return {kind: 'connecteam', rows, format, entries: []};
      }
    }
  }

  const wantShifts = forced === 'connecteam' || forced === 'shifts' || format === 'xlsx' || connecteam.looksLikeShiftReport(rows);
  if (wantShifts) return {kind: 'connecteam', rows, format, entries: []};
  return {kind: 'entries', entries: rows, rows, format};
}

function parseImportBody(raw, contentType) {
  return interpretImport(raw, contentType, {});
}


function dedupeEntries(existing, incoming) {
  const map = new Map();
  for (const e of existing || []) map.set(entryDedupeKey(e), e);
  let upserts = 0, skipped = 0;
  for (const e of incoming || []) {
    if (!e || !(e.date && e.driver) && e.id == null) { skipped++; continue; }
    const key = entryDedupeKey(e);
    if (key === 'nat:|||') { skipped++; continue; }
    const prev = map.get(key) || {};
    map.set(key, {...prev, ...e, updated_at: new Date().toISOString()});
    upserts++;
  }
  return {entries: [...map.values()], upserts, skipped, total: map.size};
}

function stampUpdated(entry, fallback) {
  return {...entry, updated_at: entry && (entry.updated_at || entry.updatedAt) || fallback};
}

function filterSince(records, since, fallback) {
  if (!since) return records.map((r) => stampUpdated(r, fallback));
  const t = Date.parse(since);
  if (Number.isNaN(t)) return records.map((r) => stampUpdated(r, fallback));
  const fb = Date.parse(fallback || '') || 0;
  return records
    .map((r) => stampUpdated(r, fallback))
    .filter((r) => {
      const rt = Date.parse(r.updated_at) || fb;
      return rt >= t;
    });
}

function signBody(body, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function postWebhook(url, body, secret) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { return resolve({ok: false, error: 'bad url'}); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Hub-Signature-256': secret ? signBody(body, secret) : '',
        'User-Agent': 'amazon-hub-tracker-sync'
      },
      timeout: 8000
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve({ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode}));
    });
    req.on('error', (e) => resolve({ok: false, error: e.message}));
    req.on('timeout', () => { req.destroy(); resolve({ok: false, error: 'timeout'}); });
    req.end(body);
  });
}

function notifyChange(event, crossover, revision, updatedAt) {
  const secret = webhookSecret();
  const ping = JSON.stringify({
    event,
    updated_at: updatedAt,
    revision: revision || null
  });
  const scannerBody = JSON.stringify({
    event,
    updated_at: updatedAt,
    revision: revision || null,
    crossover: stripBlocked(crossover)
  });
  const general = webhookUrls('HUB_WEBHOOK_URLS').map((url) => postWebhook(url, ping, secret));
  const scanner = webhookUrls('HUB_SCANNER_WEBHOOK_URLS').map((url) => postWebhook(url, scannerBody, secret));
  Promise.allSettled([...general, ...scanner]).then((results) => {
    const failed = results.filter((r) => r.status === 'rejected' || (r.value && r.value.ok === false)).length;
    if (failed) console.error('Webhook deliveries failed:', failed);
  });
}

function crossoverPath(dataDir) {
  return path.join(dataDir, 'amazon-hub-crossover.json');
}

function readCrossover(dataDir) {
  try { return JSON.parse(fs.readFileSync(crossoverPath(dataDir), 'utf8')); }
  catch { return {companyProfile: null, ericSchedule: null, crewConflicts: [], updated_at: null}; }
}

function writeCrossover(dataDir, data) {
  const file = crossoverPath(dataDir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = {
  syncToken,
  safeEqual,
  requireSyncAuth,
  entryDedupeKey,
  parseCsv,
  parseImportBody,
  interpretImport,
  isXlsxType,
  dedupeEntries,
  filterSince,
  signBody,
  notifyChange,
  readCrossover,
  writeCrossover,
  buildExport: function(state, since) {
    const updatedAt = state && state.updatedAt || null;
    return {
      updated_at: updatedAt,
      revision: state && state.revision || 0,
      since: since || null,
      entries: filterSince(state && state.entries || [], since, updatedAt),
      stops: filterSince(state && state.stops || [], since, updatedAt)
    };
  },
  buildCrossoverExport: function(dataDir, since) {
    const stored = readCrossover(dataDir);
    const payload = buildCrossoverPayload(stored, stored.updated_at || new Date().toISOString());
    if (since) {
      const t = Date.parse(since);
      const updated = Date.parse(payload.updated_at) || 0;
      if (!Number.isNaN(t) && updated < t) {
        return {updated_at: payload.updated_at, since, companyProfile: payload.companyProfile, ericSchedule: null, crewConflicts: []};
      }
    }
    return {...payload, since: since || null};
  },
  applyCrossoverImport: function(dataDir, body) {
    const next = inboundCrossover(body);
    writeCrossover(dataDir, next);
    return next;
  }
};
