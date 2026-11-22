const {describe, it} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sync = require('../lib/sync');
const connecteam = require('../lib/connecteam');
const {writeXlsx, readXlsx} = require('../lib/xlsx-simple');

describe('sync import/export and Connecteam shift report', () => {
  it('dedupes hub entries on id or date|driver|hub|packages', () => {
    const existing = [{id: 1, date: '2026-11-21', driver: 'Annette', packages: 27, hub: 'S.M.G LLC'}];
    const incoming = [
      {id: 1, date: '2026-11-21', driver: 'Annette', packages: 28, hub: 'S.M.G LLC'},
      {date: '2026-11-22', driver: 'Me', packages: 59, hub: 'S.M.G LLC'}
    ];
    const out = sync.dedupeEntries(existing, incoming);
    assert.equal(out.total, 2);
    assert.equal(out.entries.find((e) => e.id === 1).packages, 28);
    assert.equal(sync.entryDedupeKey(incoming[1]), 'nat:2026-11-22|Me|S.M.G LLC|59');
  });

  it('filters export rows by since and stamps updated_at', () => {
    const state = {
      updatedAt: '2026-11-22T22:40:25.297Z',
      revision: 268,
      entries: [{id: 1, date: '2026-11-22', driver: 'Me', packages: 59}]
    };
    const all = sync.buildExport(state, null);
    assert.equal(all.revision, 268);
    assert.equal(all.entries[0].updated_at, '2026-11-22T22:40:25.297Z');
    const none = sync.buildExport(state, '2026-11-23T00:00:00Z');
    assert.equal(none.entries.length, 0);
  });

  it('imports a Connecteam Shift Report xlsx and dedupes on shift id or driver+date', () => {
    const rows = [
      {'Shift ID': 'SH-100', Employee: 'Annette', Date: '2026-11-21', 'Clock In': '2026-11-21T09:00:00-06:00', 'Clock Out': '2026-11-21T14:00:00-06:00', Hours: 5},
      {'Shift ID': 'SH-100', Employee: 'Annette', Date: '2026-11-21', 'Clock In': '2026-11-21T09:00:00-06:00', Hours: 5.25},
      {Employee: 'Suzanne', Date: '2026-11-18', 'Clock In': '2026-11-18T09:30:00-06:00', Hours: 4}
    ];
    const buf = writeXlsx(rows);
    const parsed = readXlsx(buf);
    assert.equal(parsed.length, 3);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-ct-'));
    const first = connecteam.importShifts(dir, parsed.slice(0, 2));
    assert.equal(first.total, 1);
    assert.equal(first.shifts[0].shiftId, 'SH-100');
    assert.equal(first.shifts[0].hours, 5.25);
    const second = connecteam.importShifts(dir, parsed.slice(2));
    assert.equal(second.total, 2);
    assert.equal(connecteam.shiftDedupeKey({shiftId: 'SH-100'}), 'connecteam:SH-100');
    assert.match(connecteam.shiftDedupeKey(second.shifts.find((s) => s.driver === 'Suzanne')), /^connecteam-nat:suzanne\|2026-11-18\|/);
  });

  it('keeps the Connecteam API adapter disabled on the free plan', () => {
    const status = connecteam.status();
    assert.equal(status.enabled, false);
    assert.equal(status.api, 'disabled-stub');
    assert.match(status.reason, /free plan/i);
    assert.match(status.reason, /January 12, 2027/);
  });

  it('detects a shift report vs a package-entry import', () => {
    const shift = sync.interpretImport(JSON.stringify({
      source: 'connecteam',
      shifts: [{Employee: 'Annette', Date: '2026-11-21', 'Clock In': '09:00', 'Shift ID': '1'}]
    }), 'application/json', {source: 'connecteam'});
    assert.equal(shift.kind, 'connecteam');
    const entries = sync.interpretImport(JSON.stringify({
      entries: [{date: '2026-11-22', driver: 'Me', packages: 59, hub: 'S.M.G LLC'}]
    }), 'application/json', {});
    assert.equal(entries.kind, 'entries');
    assert.equal(entries.entries[0].packages, 59);
  });
});
