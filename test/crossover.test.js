const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crossover = require('../lib/crossover');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hub-xo-'));
}

describe('crossover contract (Scanner PR #2)', () => {
  it('normalizes names the same way as rot_v2.normalize', () => {
    assert.equal(crossover.normalize('Eric Pryor Sr.'), 'eric pryor sr');
    assert.equal(crossover.normalize('J-1042'), 'j 1042');
  });

  it('builds availability and conflict dedupe keys from the README', () => {
    const avail = {
      person_name: 'Eric Pryor Sr.',
      starts_at: '2026-11-24T08:00:00-06:00',
      ends_at: '2026-11-24T17:00:00-06:00'
    };
    assert.equal(
      crossover.availabilityKey(avail, 'hub'),
      'eric pryor sr|2026-11-24T08:00:00-06:00|2026-11-24T17:00:00-06:00|hub'
    );
    assert.equal(
      crossover.availabilityKey({external_id: 'person-1', ...avail}, 'hub'),
      'ext:person 1:hub'
    );
    assert.equal(
      crossover.conflictKey({person_name: 'Alex Rivera', conflict_date: '2026-11-24'}, 'hub'),
      'alex rivera|2026-11-24|hub'
    );
  });

  it('signs compact JSON with X-ROTR-Signature sha256= HMAC of the raw body', () => {
    const body = crossover.dumps({event: 'availability.upserted', source_app: 'rotr'});
    const header = crossover.signBody(body, 'test-secret');
    assert.match(header, /^sha256=[0-9a-f]{64}$/);
    assert.equal(crossover.signatureIsValid(body, header, 'test-secret'), true);
    assert.equal(crossover.signatureIsValid(body, header, 'other'), false);
    assert.equal(crossover.signatureIsValid(body, '', 'test-secret'), false);
    assert.equal(crossover.signatureIsValid(body, '', ''), true);
    assert.equal(crossover.SIGNATURE_HEADER, 'X-ROTR-Signature');
  });

  it('applies inbound Scanner events and rejects driver PII', () => {
    const dir = tmpDir();
    const updated = crossover.applyInboundEvent(dir, {
      event: 'company_profile.updated',
      source_app: 'rotr',
      record: {profile_key: 'rotr', legal_name: 'S.M.G. LLC', phone: '(712) 635-2510'}
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.company_profile.legal_name, 'S.M.G. LLC');

    const avail = crossover.applyInboundEvent(dir, {
      event: 'availability.upserted',
      source_app: 'rotr',
      record: {
        person_name: 'Eric Pryor Sr.',
        starts_at: '2026-11-24T08:00:00-06:00',
        ends_at: '2026-11-24T17:00:00-06:00',
        kind: 'hub_day'
      }
    });
    assert.equal(avail.ok, true);
    assert.equal(avail.availability[0].dedupe_key, 'eric pryor sr|2026-11-24T08:00:00-06:00|2026-11-24T17:00:00-06:00|rotr');

    const conflict = crossover.applyInboundEvent(dir, {
      event: 'crew_conflict.upserted',
      source_app: 'rotr',
      record: {person_name: 'Alex Rivera', conflict_date: '2026-11-24', unavailable: true}
    });
    assert.equal(conflict.ok, true);
    assert.equal(conflict.crew_conflicts[0].conflict_date, '2026-11-24');

    const banned = crossover.importCrossover(dir, {
      availability: [{person_name: 'Eric Pryor Sr.', starts_at: '2026-11-25T08:00:00-06:00', ends_at: '2026-11-25T17:00:00-06:00', kind: 'off', driver_phone: '555-0100'}]
    }, 'rotr');
    assert.equal(banned.ok, false);
    assert.ok(banned.errors.some((e) => /Driver personal details/.test(e.error)));

    const hubDriver = crossover.importCrossover(dir, {
      availability: [{person_name: 'Valerie', starts_at: '2026-11-25T08:00:00-06:00', ends_at: '2026-11-25T17:00:00-06:00', kind: 'hub_day'}]
    }, 'hub');
    assert.equal(hubDriver.ok, false);

    const ignored = crossover.applyInboundEvent(dir, {event: 'opportunity.updated', record: {title: 'a lead'}});
    assert.equal(ignored.ignored, true);
  });

  it('does not put a garage door code on the company profile', () => {
    const {profile} = crossover.normalizeProfile({notes: 'pickup only', door_code: '9999'});
    assert.equal(profile.phone, '(712) 635-2510');
    assert.equal(profile.door_code, undefined);
    assert.equal(profile.legal_name, 'S.M.G. LLC');
  });
});
