'use strict';
// tests/backup-db-only-test.js — proves offhost-backup.js's buildManifest()
// can produce a valid, verifiable, pushable backup set from a database dump
// ALONE, with no media store to reconcile against.
//
// WHY THIS EXISTS
// ----------------
// docs/ERP_MIGRATION_PLAN.md §1 makes off-host backup coverage a hard gate
// before mythos_erp may be provisioned: "a mythos_erp database created on
// [the shared] container would not be in any backup." Tracing the pipeline
// found the gap was not (only) the root-side capture script — it was that
// projects/infrastructure/ops/offhost-backup.js's buildManifest() previously
// REQUIRED a media directory unconditionally (row-count/object-key cross
// check included), and mythos_erp has no content-addressed media store of
// any kind (Phase 0 audit: document upload isn't even built yet). This
// suite exercises the new database-only branch added to buildManifest() to
// close that gap, and — just as importantly — proves the existing
// media-bearing behaviour (idauto) is completely unaffected.
//
// Offline and deterministic: no root, no docker, no network, no real
// PostgreSQL. Fixture "dumps" are plain files standing in for pg_dump -Fc
// output — buildManifest never inspects dump content, only hashes it, so a
// plain file is a faithful stand-in for these assertions.
//
// Run with: node tests/backup-db-only-test.js

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var BASE = path.join(__dirname, '..');
var offhost = require(path.join(BASE, 'projects', 'infrastructure', 'ops', 'offhost-backup.js'));

var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function throwsLike(fn, re, l) {
  try { fn(); fail++; console.log('  FAIL ' + l + ' (expected to throw)'); }
  catch (e) {
    if (re.test(e.message || '')) { pass++; console.log('  PASS ' + l); }
    else { fail++; console.log('  FAIL ' + l + ' [got: ' + e.message + ']'); }
  }
}

var ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-db-only-'));

function dbOnlyFixture(name, filename, bytes) {
  var db = path.join(ROOT, name, 'db');
  fs.mkdirSync(db, { recursive: true });
  fs.writeFileSync(path.join(db, filename), bytes || Buffer.from('pg_dump -Fc bytes, standing in for a real dump'));
  return db;
}

function mediaFixture(name) {
  var media = path.join(ROOT, name, 'media');
  var body = Buffer.from('media-bytes');
  var key = crypto.createHash('sha256').update(body).digest('hex');
  var rel = 'media/' + key.slice(0, 2) + '/' + key.slice(2, 4) + '/' + key;
  fs.mkdirSync(path.dirname(path.join(media, rel)), { recursive: true });
  fs.writeFileSync(path.join(media, rel), body);
  fs.writeFileSync(path.join(media, 'checksums.sha256'), key + '  ' + rel + '\n');
  fs.writeFileSync(path.join(media, 'manifest.json'), JSON.stringify({
    created_at_utc: '2026-08-30T00:00:02.000Z',
    consistency: { state: 'CONSISTENT' },
    database: { row_count: 1, distinct_object_keys: 1 }
  }));
  return media;
}

function memoryAdapter(store) {
  function h(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
  return {
    list: function () { return Promise.resolve(Object.keys(store)); },
    head: function (k) { var b = store[k]; return Promise.resolve(b ? { size: b.length, sha256: h(b) } : null); },
    get: function (k) { var b = store[k]; return b ? Promise.resolve(b) : Promise.reject(new Error('missing ' + k)); },
    put: function (k, b) { store[k] = Buffer.from(b); return Promise.resolve({}); }
  };
}

(async function () {

console.log('§1 a database-only manifest is built, and it is minimal');
var db1 = dbOnlyFixture('m1', 'mythos_erp-20260830T000000Z.dump');
var m1 = offhost.buildManifest({
  dbDir: db1, host: 'test', now: '2026-08-30T00:00:00.000Z',
  databaseCapturedAt: '2026-08-30T00:00:00.000Z'
});
ok(m1.format_version === offhost.FORMAT_VERSION, '1 format_version set, same as the media-bearing path');
ok(m1.database && m1.database.dump_filename === 'mythos_erp-20260830T000000Z.dump', '2 database.dump_filename correct');
ok(!('media' in m1), '3 no media key present at all when mediaDir is omitted');
ok(!('media_row_count' in m1.database), '4 no media_row_count field invented when there is no media to count');
ok(Array.isArray(m1.objects) && m1.objects.length === 1, '5 objects array holds exactly the database entry');
ok(m1.objects[0].path === 'database/mythos_erp-20260830T000000Z.dump', '6 object path is database/<dump filename>');
ok(m1.capture.order.length === 1 && m1.capture.order[0] === 'database', '7 capture order is database-only');
ok(m1.consistency.state === 'CONSISTENT', '8 consistency state is CONSISTENT — nothing exists to be inconsistent with');

console.log('§2 existing media-bearing behaviour (idauto) is completely unaffected — regression check');
var db2 = dbOnlyFixture('m2', 'idauto-20260830T000000Z.dump');
var media2 = mediaFixture('m2');
var m2 = offhost.buildManifest({
  dbDir: db2, mediaDir: media2, host: 'test', now: '2026-08-30T00:00:03.000Z',
  databaseCapturedAt: '2026-08-30T00:00:01.000Z'
});
ok('media' in m2, '9 media key present when mediaDir IS given, exactly as before');
ok('media_row_count' in m2.database, '10 media_row_count still present on the media-bearing path');
ok(m2.objects.length === 3, '11 objects array still holds db + media-manifest + media-entry (3), unchanged');
ok(m2.capture.order.length === 2 && m2.capture.order[1] === 'media', '12 capture order is still database-then-media');
// The media-row consistency assertion must still fire on the media-bearing
// path — prove the guard clause was not accidentally weakened by the new
// early return.
var media3 = mediaFixture('m3');
fs.writeFileSync(path.join(media3, 'manifest.json'), JSON.stringify({
  created_at_utc: '2026-08-30T00:00:02.000Z', consistency: { state: 'CONSISTENT' },
  database: { row_count: 0, distinct_object_keys: 1 }   // rows < distinct: impossible, must refuse
}));
var db3 = dbOnlyFixture('m3', 'idauto-2.dump');
throwsLike(function () {
  offhost.buildManifest({ dbDir: db3, mediaDir: media3, databaseCapturedAt: '2026-08-30T00:00:01.000Z' });
}, /media-row consistency failure/, '13 media-row consistency check still refuses an impossible count, unweakened');

console.log('§3 a missing or unavailable database fails safely — media-optional or not');
throwsLike(function () { offhost.buildManifest({ dbDir: path.join(ROOT, 'does-not-exist') }); },
  /database dump discovery failed|ENOENT/, '14 nonexistent dbDir throws rather than producing a manifest');
var emptyDb = path.join(ROOT, 'm4', 'db'); fs.mkdirSync(emptyDb, { recursive: true });
throwsLike(function () { offhost.buildManifest({ dbDir: emptyDb }); },
  /database dump discovery failed/, '15 empty dbDir throws rather than producing a manifest with no dump');
var twoDb = path.join(ROOT, 'm5', 'db'); fs.mkdirSync(twoDb, { recursive: true });
fs.writeFileSync(path.join(twoDb, 'a.dump'), 'x'); fs.writeFileSync(path.join(twoDb, 'b.dump'), 'y');
throwsLike(function () { offhost.buildManifest({ dbDir: twoDb }); },
  /database dump discovery failed/, '16 an ambiguous dbDir (2 files) throws rather than guessing which one is current');

console.log('§4 full round trip, database-only: stage -> verify-local -> push -> verify-remote -> restore-verify');
var db6 = dbOnlyFixture('m6', 'mythos_erp-20260830T010000Z.dump', Buffer.from('round-trip database contents'));
var dest6 = path.join(ROOT, 'm6', 'stage');
var staged = offhost.stage({
  dbDir: db6, dest: dest6, host: 'test', now: '2026-08-30T01:00:00.000Z',
  databaseCapturedAt: '2026-08-30T01:00:00.000Z'
});
ok(staged.ok === true, '17 stage() succeeds with no mediaDir argument at all');
var vl = offhost.verifyLocal(dest6);
ok(vl.ok === true && vl.verified_objects === 1, '18 verify-local passes with exactly the one database object');

var store = {};
var adapter = memoryAdapter(store);
var pushed = await offhost.push(dest6, adapter, { prefix: 'test-prefix-db-only' });
ok(pushed.ok === true && pushed.uploaded === 1, '19 push uploads exactly the database object');
ok(Object.keys(store).some(function (k) { return k === 'test-prefix-db-only/COMPLETE'; }), '20 COMPLETE marker is written last, as for a media-bearing set');

var vr = await offhost.verifyRemote('test-prefix-db-only', adapter);
ok(vr.ok === true, '21 verify-remote passes for a database-only set');

var restoreDest = path.join(ROOT, 'm6', 'restored');
var rv = await offhost.restoreVerify('test-prefix-db-only', restoreDest, adapter, {});
ok(rv.ok === true, '22 restore-verify reconstructs a database-only set correctly');
ok(fs.existsSync(path.join(restoreDest, 'database', 'mythos_erp-20260830T010000Z.dump')),
  '23 the restored dump lands at the same database/<filename> layout as a media-bearing restore');
ok(fs.readFileSync(path.join(restoreDest, 'database', 'mythos_erp-20260830T010000Z.dump')).toString() === 'round-trip database contents',
  '24 restored dump content is byte-identical to what was staged');

console.log('§5 no destructive behaviour is introduced');
// push()/verifyRemote()/restoreVerify() never call adapter.del/delete for a
// database-only set, same as for a media-bearing one — there is no deletion
// method on the adapter contract at all (memoryAdapter above deliberately
// exposes none), so a destructive call would throw, not silently no-op.
var storeForRetention = {};
var retentionInput = [
  { id: 'db-only-1', created_at_utc: '2026-08-28T00:00:00.000Z' },
  { id: 'db-only-2', created_at_utc: '2026-08-29T00:00:00.000Z' },
  { id: 'db-only-3', created_at_utc: '2026-08-30T00:00:00.000Z' }
];
var ret = offhost.retention(retentionInput);
ok(ret.deleted === 0, '25 retention() reports zero deletions for database-only sets, same contract as before');
ok(ret.keep.length + ret.drop.length === retentionInput.length, '26 retention() partitions report-only — every set is kept or dropped, never removed');

console.log('\nbackup-db-only: ' + pass + ' passed, ' + fail + ' failed');
fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);

})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.stack || e));
  process.exit(1);
});
