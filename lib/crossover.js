// Mirrors Rotrepair/rot-lead-scanner PR #2 (README.md + crossover.py).
// Only company_profile, availability, and crew_conflicts cross to the Scanner.
// Never send Hub driver PII or hiring leads. Token/HMAC come from env only.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const SIGNATURE_HEADER = 'X-ROTR-Signature';
const SOURCE_APP = 'hub';
const AVAILABILITY_KINDS = new Set(['available', 'busy', 'off', 'hub_day']);
const PROFILE_FIELDS = [
  'profile_key', 'legal_name', 'dba', 'owner_name', 'phone', 'email', 'website',
  'address', 'city', 'state', 'postal_code', 'service_area', 'service_radius_miles',
  'uei', 'cage', 'duns', 'contractor_registration', 'mbe_certification', 'tsb_certificate',
  'naics', 'self_perform', 'trade_subs_note', 'insurance_notes', 'notes'
];
const AVAILABILITY_FIELDS = ['external_id', 'person_name', 'starts_at', 'ends_at', 'kind', 'note'];
const CONFLICT_FIELDS = ['external_id', 'person_name', 'conflict_date', 'unavailable', 'note'];
const BANNED_KEYS = new Set([
  'driver', 'driver_name', 'drivers', 'driver_phone', 'driver_email', 'phone', 'email',
  'license', 'licence', 'license_number', 'dl', 'dl_number', 'cdl', 'ssn',
  'hiring', 'applicant', 'applicants', 'lead', 'leads'
]);
const INBOUND_EVENTS = new Set([
  'company_profile.updated',
  'availability.upserted',
  'crew_conflict.upserted'
]);

// Public company facts already documented in Scanner PR #2. No door code, no driver PII.
const DEFAULT_COMPANY_PROFILE = Object.freeze({
  profile_key: 'rotr',
  legal_name: 'S.M.G. LLC',
  dba: 'Right On Time Repair',
  owner_name: 'Eric Pryor Sr.',
  phone: '(712) 635-2510',
  email: 'info.rotrepair@gmail.com',
  website: 'https://rotrepair.github.io/',
  address: '',
  city: 'Sioux City',
  state: 'IA',
  postal_code: '',
  service_area: 'Sioux City, IA',
  service_radius_miles: 90,
  uei: 'WY37ZH2CRFD8',
  cage: '11C02',
  duns: '056608718',
  contractor_registration: 'Iowa registered contractor C149169',
  mbe_certification: 'NMSDC MBE certified (WS068019, exp 5/31/2027)',
  tsb_certificate: 'Iowa TSB certificate, valid through April 24, 2027',
  naics: '236118, 236220, 238320, 238330, 238350, 238990, 561210',
  self_perform: 'Facilities support, property maintenance, repairs, remodeling, interior carpentry, drywall, painting, doors, punch-list, grab bars, board-up',
  trade_subs_note: 'HVAC and plumbing are performed by trade subcontractors only. Those subcontractors are not listed in this app.',
  insurance_notes: '',
  notes: ''
});

function hmacSecret() {
  return String(process.env.ROT_HMAC_SECRET || '').trim();
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isEric(name) {
  const key = normalize(name);
  return key === 'eric' || key === 'eric pryor' || key === 'eric pryor sr' || key === 'me';
}

function canonicalPerson(name) {
  return isEric(name) ? 'Eric Pryor Sr.' : String(name || '').trim();
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

function signBody(body, secret) {
  const key = Buffer.from(secret == null ? hmacSecret() : secret, 'utf8');
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return 'sha256=' + crypto.createHmac('sha256', key).update(raw).digest('hex');
}

function signatureHeaderName() { return SIGNATURE_HEADER; }

function presentedSignature(req) {
  const headers = req && req.headers || {};
  return String(headers['x-rotr-signature'] || headers['X-ROTR-Signature'] || '').trim();
}

// Same rule as Scanner crossover.py: if ROT_HMAC_SECRET is unset, signature check passes;
// if it is set, the header must match HMAC-SHA256 of the raw body, prefixed sha256=.
function signatureIsValid(body, header, secret) {
  const key = String(secret == null ? hmacSecret() : secret).trim();
  if (!key) return true;
  const presented = String(header || '').trim();
  if (!presented) return false;
  return safeEqual(signBody(body, key), presented);
}

function dumps(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

function availabilityKey(fields, sourceApp) {
  const external = normalize(String(fields && fields.external_id || ''));
  const source = sourceApp || SOURCE_APP;
  if (external) return `ext:${external}:${source}`;
  const person = normalize(String(fields && fields.person_name || ''));
  const start = String(fields && fields.starts_at || '').trim();
  const end = String(fields && fields.ends_at || '').trim();
  return `${person}|${start}|${end}|${source}`;
}

function conflictKey(fields, sourceApp) {
  const external = normalize(String(fields && fields.external_id || ''));
  const source = sourceApp || SOURCE_APP;
  if (external) return `ext:${external}:${source}`;
  const person = normalize(String(fields && fields.person_name || ''));
  const day = String(fields && fields.conflict_date || '').trim();
  return `${person}|${day}|${source}`;
}

function bannedKey(payload, allowSwitchboard) {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = bannedKey(item, allowSwitchboard);
      if (found) return found;
    }
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  for (const [key, value] of Object.entries(payload)) {
    const k = String(key).trim().toLowerCase();
    if (BANNED_KEYS.has(k)) {
      if (allowSwitchboard && (k === 'phone' || k === 'email')) continue;
      return String(key);
    }
    const found = bannedKey(value, allowSwitchboard);
    if (found) return found;
  }
  return null;
}

function allow(raw, fields) {
  const kept = {};
  const stripped = [];
  if (!raw || typeof raw !== 'object') return {kept, stripped};
  for (const [key, value] of Object.entries(raw)) {
    if (fields.includes(key)) kept[key] = value;
    else stripped.push(key);
  }
  return {kept, stripped};
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

function normalizeProfile(raw) {
  const {kept, stripped} = allow(raw || {}, PROFILE_FIELDS.concat(['updated_at']));
  const out = {...DEFAULT_COMPANY_PROFILE, ...kept};
  out.profile_key = out.profile_key || 'rotr';
  out.legal_name = out.legal_name || 'S.M.G. LLC';
  out.phone = out.phone || DEFAULT_COMPANY_PROFILE.phone;
  out.updated_at = kept.updated_at || isoNow();
  return {profile: out, stripped};
}

function normalizeAvailability(raw, sourceApp) {
  const {kept, stripped} = allow(raw || {}, AVAILABILITY_FIELDS.concat(['id', 'dedupe_key', 'source_app', 'updated_at']));
  const person = canonicalPerson(kept.person_name);
  const kind = String(kept.kind || 'busy').trim().toLowerCase().replace(/\s+/g, '_');
  if (!AVAILABILITY_KINDS.has(kind)) throw new Error('kind must be available, busy, off, or hub_day.');
  if (!String(kept.starts_at || '').trim() || !String(kept.ends_at || '').trim()) {
    throw new Error('starts_at and ends_at are required.');
  }
  const source = kept.source_app || sourceApp || SOURCE_APP;
  const row = {
    external_id: kept.external_id || null,
    person_name: person,
    starts_at: String(kept.starts_at).trim(),
    ends_at: String(kept.ends_at).trim(),
    kind,
    source_app: source,
    note: kept.note == null ? null : String(kept.note),
    updated_at: kept.updated_at || isoNow()
  };
  row.dedupe_key = availabilityKey(row, source);
  if (kept.id != null) row.id = kept.id;
  return {row, stripped};
}

function normalizeConflict(raw, sourceApp) {
  const {kept, stripped} = allow(raw || {}, CONFLICT_FIELDS.concat(['id', 'dedupe_key', 'source_app', 'updated_at']));
  const person = canonicalPerson(kept.person_name);
  const day = String(kept.conflict_date || '').trim();
  if (day.length < 10) throw new Error('conflict_date must be YYYY-MM-DD.');
  const source = kept.source_app || sourceApp || SOURCE_APP;
  const row = {
    external_id: kept.external_id || null,
    person_name: person,
    conflict_date: day.slice(0, 10),
    unavailable: kept.unavailable === false ? false : true,
    source_app: source,
    note: kept.note == null ? null : String(kept.note),
    updated_at: kept.updated_at || isoNow()
  };
  row.dedupe_key = conflictKey(row, source);
  if (kept.id != null) row.id = kept.id;
  return {row, stripped};
}

function storePath(dataDir) {
  return path.join(dataDir, 'amazon-hub-crossover.json');
}

function emptyStore() {
  return {
    company_profile: {...DEFAULT_COMPANY_PROFILE, updated_at: null},
    availability: [],
    crew_conflicts: [],
    updated_at: null
  };
}

function readStore(dataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(dataDir), 'utf8'));
    return {
      company_profile: data.company_profile || emptyStore().company_profile,
      availability: Array.isArray(data.availability) ? data.availability : [],
      crew_conflicts: Array.isArray(data.crew_conflicts) ? data.crew_conflicts : (data.crewConflicts || []),
      updated_at: data.updated_at || data.updatedAt || null
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(dataDir, store) {
  const file = storePath(dataDir);
  const tmp = file + '.tmp';
  const payload = {...store, updated_at: store.updated_at || isoNow()};
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, file);
  return payload;
}

function upsertRow(list, row, keyFn) {
  const key = row.dedupe_key || keyFn(row, row.source_app);
  const idx = list.findIndex((item) => (item.dedupe_key || keyFn(item, item.source_app)) === key);
  if (idx >= 0) {
    list[idx] = {...list[idx], ...row, dedupe_key: key};
    return {inserted: false, row: list[idx]};
  }
  list.push({...row, dedupe_key: key});
  return {inserted: true, row: list[list.length - 1]};
}

function importCrossover(dataDir, payload, sourceApp) {
  const source = sourceApp || SOURCE_APP;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Crossover body must be a JSON object.');
  }
  const store = readStore(dataDir);
  const errors = [];
  const stripped = [];
  const results = [];
  let inserted = 0, updated = 0;

  if (payload.company_profile != null) {
    if (typeof payload.company_profile !== 'object' || Array.isArray(payload.company_profile)) {
      errors.push({object: 'company_profile', error: 'company_profile must be an object.'});
    } else if (bannedKey(payload.company_profile, true)) {
      errors.push({object: 'company_profile', error: 'That profile record is not accepted on the crossover.'});
    } else {
      const {profile, stripped: extra} = normalizeProfile(payload.company_profile);
      if (extra.length) stripped.push({object: 'company_profile', fields: extra});
      store.company_profile = profile;
      results.push({object: 'company_profile', dedupe_key: profile.profile_key, inserted: false});
      updated += 1;
    }
  }

  const take = (name, items, normalizer, keyFn) => {
    if (items == null) return;
    if (!Array.isArray(items)) {
      errors.push({object: name, error: `${name} must be a list.`});
      return;
    }
    items.forEach((raw, i) => {
      const index = i + 1;
      if (!raw || typeof raw !== 'object') {
        errors.push({object: name, row: index, error: 'Each item must be an object.'});
        return;
      }
      if (bannedKey(raw, false)) {
        errors.push({object: name, row: index, error: 'Driver personal details and hiring leads are not stored here.'});
        return;
      }
      let row;
      try {
        const out = normalizer(raw, source);
        row = out.row;
        if (out.stripped.length) stripped.push({object: name, row: index, fields: out.stripped});
      } catch (err) {
        errors.push({object: name, row: index, error: err.message});
        return;
      }
      if (name === 'availability' && !isEric(row.person_name)) {
        // Hub must not push driver names into the Scanner. ROT crew names may arrive inbound from Scanner.
        if (source === SOURCE_APP) {
          errors.push({object: name, row: index, error: 'Availability can name Eric Pryor Sr. only when sent from the Hub.'});
          return;
        }
      }
      if (name === 'crew_conflicts' && source === SOURCE_APP && !isEric(row.person_name)) {
        errors.push({object: name, row: index, error: 'Crew conflicts sent from the Hub can name Eric Pryor Sr. only (no Hub driver PII).'});
        return;
      }
      const list = name === 'availability' ? store.availability : store.crew_conflicts;
      const outcome = upsertRow(list, row, keyFn);
      if (outcome.inserted) inserted += 1;
      else updated += 1;
      results.push({object: name, row: index, dedupe_key: outcome.row.dedupe_key, inserted: outcome.inserted});
    });
  };

  take('availability', payload.availability, normalizeAvailability, availabilityKey);
  take('crew_conflicts', payload.crew_conflicts, normalizeConflict, conflictKey);

  store.updated_at = isoNow();
  writeStore(dataDir, store);
  return {
    ok: errors.length === 0,
    resource: 'crossover',
    source_app: source,
    received: 1,
    inserted,
    updated,
    skipped: 0,
    errors,
    stripped,
    results,
    company_profile: store.company_profile,
    availability: store.availability,
    crew_conflicts: store.crew_conflicts,
    updated_at: store.updated_at
  };
}

function applyInboundEvent(dataDir, body) {
  const event = body && body.event;
  if (!INBOUND_EVENTS.has(event)) {
    return {ok: true, ignored: true, event: event || null};
  }
  const record = body.record && typeof body.record === 'object' ? body.record : {};
  if (event === 'company_profile.updated') {
    return importCrossover(dataDir, {company_profile: record}, body.source_app || 'rotr');
  }
  if (event === 'availability.upserted') {
    return importCrossover(dataDir, {availability: [record]}, body.source_app || 'rotr');
  }
  return importCrossover(dataDir, {crew_conflicts: [record]}, body.source_app || 'rotr');
}

function filterSince(rows, since) {
  if (!since) return rows.slice();
  const t = Date.parse(since);
  if (Number.isNaN(t)) return rows.slice();
  return rows.filter((row) => {
    const rt = Date.parse(row && row.updated_at || '') || 0;
    return rt >= t;
  });
}

function exportCrossover(dataDir, since) {
  const store = readStore(dataDir);
  let profile = store.company_profile || {...DEFAULT_COMPANY_PROFILE};
  if (!profile.updated_at) profile = {...DEFAULT_COMPANY_PROFILE, ...profile, updated_at: store.updated_at || isoNow()};
  if (since) {
    const t = Date.parse(since);
    const updated = Date.parse(profile.updated_at || '') || 0;
    if (!Number.isNaN(t) && updated < t) profile = null;
  }
  const availability = filterSince(store.availability, since);
  const conflicts = filterSince(store.crew_conflicts, since);
  const stamps = []
    .concat(availability.map((r) => r.updated_at), conflicts.map((r) => r.updated_at), profile && profile.updated_at ? [profile.updated_at] : [])
    .filter(Boolean);
  return {
    since: since || null,
    server_time: isoNow(),
    company_profile: profile,
    availability,
    crew_conflicts: conflicts,
    next_since: stamps.length ? stamps.sort().slice(-1)[0] : since || null,
    updated_at: store.updated_at
  };
}

function outboundPayload(dataDir) {
  const store = readStore(dataDir);
  const profile = {...DEFAULT_COMPANY_PROFILE, ...(store.company_profile || {})};
  profile.profile_key = profile.profile_key || 'rotr';
  return {
    company_profile: profile,
    availability: store.availability || [],
    crew_conflicts: store.crew_conflicts || []
  };
}

function scannerImportUrl() {
  return String(process.env.ROT_SCANNER_CROSSOVER_URL || process.env.SCANNER_CROSSOVER_URL || '').trim();
}

function scannerToken() {
  return String(process.env.ROT_CROSSOVER_TOKEN || process.env.ROT_API_TOKEN || '').trim();
}

function postToScanner(dataDir) {
  const url = scannerImportUrl();
  if (!url) return Promise.resolve({ok: false, skipped: true, error: 'ROT_SCANNER_CROSSOVER_URL is not set'});
  const body = dumps(outboundPayload(dataDir));
  const secret = hmacSecret();
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'amazon-hub-tracker-crossover'
  };
  if (secret) headers[SIGNATURE_HEADER] = signBody(body, secret);
  const token = scannerToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  return postRaw(url, body, headers);
}

function postRaw(url, body, headers) {
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
      headers,
      timeout: 8000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode}));
    });
    req.on('error', (e) => resolve({ok: false, error: e.message}));
    req.on('timeout', () => { req.destroy(); resolve({ok: false, error: 'timeout'}); });
    req.end(body);
  });
}

module.exports = {
  SIGNATURE_HEADER,
  SOURCE_APP,
  PROFILE_FIELDS,
  AVAILABILITY_FIELDS,
  CONFLICT_FIELDS,
  AVAILABILITY_KINDS,
  DEFAULT_COMPANY_PROFILE,
  INBOUND_EVENTS,
  normalize,
  isEric,
  safeEqual,
  signBody,
  signatureIsValid,
  presentedSignature,
  signatureHeaderName,
  dumps,
  availabilityKey,
  conflictKey,
  bannedKey,
  normalizeProfile,
  normalizeAvailability,
  normalizeConflict,
  readStore,
  writeStore,
  importCrossover,
  applyInboundEvent,
  exportCrossover,
  outboundPayload,
  postToScanner,
  hmacSecret
};
