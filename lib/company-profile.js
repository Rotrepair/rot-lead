// Company profile and Scanner crossover allowlist.
// Never put a garage door code, passwords, or driver PII in this file.
'use strict';

const COMPANY_PROFILE = Object.freeze({
  hub: 'S.M.G LLC',
  alsoKnownAs: ['SMG LLC'],
  notTheLabel: 'ROTR',
  pickup: {
    address: '610 35th Street garage, Sioux City, IA',
    window: '9–10 AM'
  },
  pay: {
    perPackage: 1.10,
    classification: '1099',
    week: 'Sunday–Saturday',
    paid: 'following Monday',
    ownerPayout: false
  },
  route: 'Northside',
  weeklyGoal: 420,
  phone: '(712) 635-2510'
});

const ACTIVE_ROSTER_DEFAULTS = Object.freeze([
  {name: 'Me', displayName: 'Eric', role: 'Owner', payout: false},
  {name: 'Valerie', displayName: 'Val', role: 'Driver'},
  {name: 'Annette', displayName: 'Annette', role: 'Driver'},
  {name: 'Suzanne', displayName: 'Suzanne', role: 'Driver'},
  {name: 'Brianna', displayName: 'Brianna', role: 'Driver', weekends: false}
]);

const CROSSOVER_KEYS = Object.freeze(['companyProfile', 'ericSchedule', 'crewConflicts', 'updated_at', 'updatedAt']);

const BLOCKED_KEYS = /phone|email|mobile|tel|lead|applicant|ssn|dob|address|door|pin|password|token|secret|credential|license/i;

function stripBlocked(value) {
  if (Array.isArray(value)) return value.map(stripBlocked);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (BLOCKED_KEYS.test(k)) continue;
    out[k] = stripBlocked(v);
  }
  return out;
}

function defaultEricSchedule() {
  return {
    name: 'Eric',
    role: 'Owner',
    payout: false,
    availability: 'Owner; no package payout',
    week: 'Sunday–Saturday'
  };
}

function sanitizeConflicts(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => {
    const clean = stripBlocked(row && typeof row === 'object' ? row : {summary: String(row || '')});
    // Do not send other drivers' contact info or leads. Keep day-level coverage notes only.
    return {
      day: clean.day || clean.date || null,
      status: clean.status || 'conflict',
      summary: String(clean.summary || clean.note || clean.reason || '').slice(0, 200)
    };
  }).filter((row) => row.day || row.summary);
}

function buildCrossoverPayload(stored, nowIso) {
  const src = stored && typeof stored === 'object' ? stored : {};
  const profile = {...COMPANY_PROFILE, ...(stripBlocked(src.companyProfile) || {})};
  // Re-assert hard rules so an import cannot rename the hub or add a door code.
  profile.hub = 'S.M.G LLC';
  profile.phone = COMPANY_PROFILE.phone;
  profile.pickup = {
    address: COMPANY_PROFILE.pickup.address,
    window: (src.companyProfile && src.companyProfile.pickup && src.companyProfile.pickup.window) || COMPANY_PROFILE.pickup.window
  };
  delete profile.doorCode;
  delete profile.garageCode;
  const updated = src.updated_at || src.updatedAt || nowIso;
  return {
    companyProfile: profile,
    ericSchedule: stripBlocked(src.ericSchedule) || defaultEricSchedule(),
    crewConflicts: sanitizeConflicts(src.crewConflicts),
    updated_at: updated
  };
}

function inboundCrossover(body) {
  const src = body && typeof body === 'object' ? body : {};
  const picked = {};
  for (const key of ['companyProfile', 'ericSchedule', 'crewConflicts']) {
    if (src[key] != null) picked[key] = src[key];
  }
  // Drop anything else (leads, roster, entries, driver PII).
  const built = buildCrossoverPayload(picked, new Date().toISOString());
  built.updated_at = new Date().toISOString();
  return built;
}

module.exports = {
  COMPANY_PROFILE,
  ACTIVE_ROSTER_DEFAULTS,
  CROSSOVER_KEYS,
  stripBlocked,
  defaultEricSchedule,
  sanitizeConflicts,
  buildCrossoverPayload,
  inboundCrossover
};
