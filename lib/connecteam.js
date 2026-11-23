// Connecteam: stay on the free plan (no API). The live feed is a Shift Report import.
// Time Clock > Timesheets > Export > Shift Report (.xlsx), or a CSV/JSON a bot posts.
// The API adapter remains a disabled stub. Revisit if the roster goes over 10 users,
// the 2nd hub goes live, or after January 12, 2027. Do not sign up or request API access.
'use strict';

const fs = require('fs');
const path = require('path');
const {excelSerialToIso} = require('./xlsx-simple');

const REVISIT = 'Revisit the paid Connecteam API only if we go over 10 users, the 2nd hub goes live, or after January 12, 2027.';

function apiStatus() {
  return {
    enabled: false,
    plan: 'free',
    api: 'disabled-stub',
    reason: 'Staying on the Connecteam free plan (no API). Clock-ins and shifts enter this tracker from a Shift Report export (xlsx/CSV/JSON) through token-auth POST /api/sync/import. ' + REVISIT,
    supports: ['shift-report-import'],
    revisit: {
      overTenUsers: true,
      secondHubLive: true,
      after: '2027-01-12'
    }
  };
}

async function syncClockIns() { return {ok: false, ...apiStatus()}; }
async function syncShifts() { return {ok: false, ...apiStatus()}; }
async function syncRoster() { return {ok: false, ...apiStatus()}; }

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
}

function pick(row, patterns) {
  for (const [key, val] of Object.entries(row || {})) {
    const h = normHeader(key);
    if (patterns.some((re) => re.test(h))) return val;
  }
  return '';
}

function looksLikeShiftRow(row) {
  if (!row || typeof row !== 'object') return false;
  const headers = Object.keys(row).map(normHeader);
  const hasPerson = headers.some((h) => /^(employee|user|member|worker|driver|full name|name)$/.test(h) || /employee name|user name/.test(h));
  const hasShift = headers.some((h) => /shift id|timesheet|clock in|clock-in|time in|shift date|start time/.test(h) || h === 'clock in');
  const hasPackagesOnly = headers.includes('packages') && headers.includes('driver') && headers.includes('date') && !hasShift;
  return (hasPerson || hasShift) && !hasPackagesOnly;
}

function looksLikeShiftReport(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.filter(looksLikeShiftRow).length >= Math.ceil(rows.length * 0.5);
}

function toDate(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return excelSerialToIso(value).slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 80000) return excelSerialToIso(n).slice(0, 10);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    const iso = `${year.padStart(4, '0')}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    // If it looks month-first and month > 12, treat as D/M/Y; otherwise assume M/D/Y (US).
    const a = Number(m[1]), b = Number(m[2]);
    const nice = a > 12 ? `${year}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}` : `${year}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
    return nice;
  }
  return s.slice(0, 10);
}

function toWhen(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && value > 20000) return excelSerialToIso(value);
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000) return excelSerialToIso(n);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return s;
}

function shiftDedupeKey(shift) {
  const id = String(shift && (shift.shiftId || shift.id) || '').trim();
  if (id) return 'connecteam:' + id;
  const driver = String(shift && shift.driver || '').trim().toLowerCase();
  const date = String(shift && shift.date || '').trim();
  const clockIn = String(shift && shift.clockIn || '').trim();
  return 'connecteam-nat:' + [driver, date, clockIn].join('|');
}

function normalizeShift(row) {
  const shiftId = String(pick(row, [/^shift id$/, /^shiftid$/, /^id$/, /^timesheet id$/, /^timesheetid$/]) || '').trim();
  const driver = String(pick(row, [/^employee name$/, /^employee$/, /^user name$/, /^user$/, /^member$/, /^worker$/, /^driver$/, /^full name$/, /^name$/]) || '').trim();
  const rawDate = pick(row, [/^shift date$/, /^work date$/, /^date$/, /^start date$/, /^day$/]);
  const clockIn = toWhen(pick(row, [/^clock in$/, /^clock-in$/, /^time in$/, /^start time$/, /^start$/]));
  const clockOut = toWhen(pick(row, [/^clock out$/, /^clock-out$/, /^time out$/, /^end time$/, /^end$/]));
  const hoursRaw = pick(row, [/^hours$/, /^total hours$/, /^duration$/, /^time clock hours$/]);
  const hours = hoursRaw === '' || hoursRaw == null ? null : Number(hoursRaw);
  const job = String(pick(row, [/^job$/, /^job title$/, /^title$/, /^site$/, /^location$/, /^hub$/]) || '').trim();
  const packagesRaw = pick(row, [/^packages delivered$/, /^packages$/, /^pkg$/]);
  const date = toDate(rawDate) || (clockIn ? clockIn.slice(0, 10) : '');
  if (!driver && !shiftId) return null;
  if (!date && !clockIn) return null;
  return {
    shiftId: shiftId || null,
    driver,
    date,
    clockIn: clockIn || null,
    clockOut: clockOut || null,
    hours: Number.isFinite(hours) ? hours : null,
    job: job || null,
    packagesDelivered: packagesRaw === '' || packagesRaw == null ? null : Number(packagesRaw),
    source: 'connecteam-shift-report',
    updated_at: new Date().toISOString()
  };
}

function normalizeShifts(rows) {
  return (rows || []).map(normalizeShift).filter(Boolean);
}

function dedupeShifts(existing, incoming) {
  const map = new Map();
  for (const s of existing || []) map.set(shiftDedupeKey(s), s);
  let upserts = 0, skipped = 0;
  for (const s of incoming || []) {
    const key = shiftDedupeKey(s);
    if (key === 'connecteam-nat:||' || key === 'connecteam:') { skipped++; continue; }
    const prev = map.get(key) || {};
    map.set(key, {...prev, ...s, updated_at: s.updated_at || new Date().toISOString()});
    upserts++;
  }
  return {shifts: [...map.values()], upserts, skipped, total: map.size};
}

function shiftsPath(dataDir) {
  return path.join(dataDir, 'amazon-hub-connecteam-shifts.json');
}

function readShifts(dataDir) {
  try {
    const data = JSON.parse(fs.readFileSync(shiftsPath(dataDir), 'utf8'));
    return Array.isArray(data) ? {shifts: data, updated_at: null} : {shifts: data.shifts || [], updated_at: data.updated_at || null};
  } catch {
    return {shifts: [], updated_at: null};
  }
}

function writeShifts(dataDir, payload) {
  const file = shiftsPath(dataDir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, file);
}

function importShifts(dataDir, rows) {
  const incoming = normalizeShifts(rows);
  const current = readShifts(dataDir);
  const merged = dedupeShifts(current.shifts, incoming);
  const payload = {shifts: merged.shifts, updated_at: new Date().toISOString(), source: 'connecteam-shift-report'};
  writeShifts(dataDir, payload);
  return {...merged, updated_at: payload.updated_at, imported: incoming.length};
}

module.exports = {
  status: apiStatus,
  apiStatus,
  syncClockIns,
  syncShifts,
  syncRoster,
  looksLikeShiftRow,
  looksLikeShiftReport,
  shiftDedupeKey,
  normalizeShift,
  normalizeShifts,
  dedupeShifts,
  readShifts,
  importShifts,
  REVISIT
};
