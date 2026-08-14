// =====================================================
// D3 — Content store (object storage, content_reference only)
// tests/mpi-d3-content-store-test.js
//
// Offline suite: an in-memory adapter implements the provider contract
// (put/get/head) and a recording fake client stands in for PostgreSQL.
// No network, no real R2, no database. All fixture values are synthetic.
// =====================================================
'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const BASE = path.join(__dirname, '..');
const cs = require(path.join(BASE, 'projects/personal-intelligence/persistence/content-store.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectError(fn, re, label) {
  try { await fn(); ok(false, label + ' (expected error, but it succeeded)'); }
  catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }

// In-memory adapter honouring the s3-compatible contract, with fault
// injection and call recording.
function fakeAdapter() {
  const objects = new Map();
  const calls = [];
  const faults = {};
  return {
    objects: objects,
    calls: calls,
    faults: faults,
    put: async function (k, b, m) {
      calls.push(['put', k]);
      if (faults.put) throw new Error(faults.put);
      objects.set(k, { bytes: Buffer.from(b), sha256: (m && m.sha256) || sha(Buffer.from(b)) });
      return { size: b.length, sha256: (m && m.sha256) || sha(Buffer.from(b)) };
    },
    get: async function (k) {
      calls.push(['get', k]);
      if (faults.get) throw new Error(faults.get);
      if (!objects.has(k)) throw new Error('missing object');
      return objects.get(k).bytes;
    },
    head: async function (k) {
      calls.push(['head', k]);
      if (faults.head) throw new Error(faults.head);
      if (!objects.has(k)) throw new Error('missing object');
      const o = objects.get(k);
      return { size: o.bytes.length, sha256: o.sha256 };
    }
  };
}

// Recording fake PostgreSQL client for verifyConsistency: schema-driven
// column discovery plus per-table reference rows.
function fakeClient(tables) {
  const statements = [];
  return {
    statements: statements,
    query: async function (sql) {
      statements.push(sql);
      if (/information_schema\.columns/.test(sql)) {
        return { rows: Object.keys(tables).map(function (t) { return { table_name: t }; }) };
      }
      const m = /FROM mythos_intelligence\.([a-z0-9_]+)/.exec(sql);
      if (m && tables[m[1]]) {
        return { rows: tables[m[1]].map(function (r) { return { ref: r }; }) };
      }
      throw new Error('unexpected sql in fake client: ' + sql.slice(0, 60));
    }
  };
}

(async function main() {
  console.log('\nD3 CONTENT STORE — reference scheme');

  const bytesA = Buffer.from('synthetic-memory-content-A.invalid');
  const bytesB = Buffer.from('synthetic-memory-content-B.invalid');

  const refA = cs.contentReferenceFor(bytesA);
  ok(refA === cs.contentReferenceFor(Buffer.from(bytesA)), '1 deterministic: same bytes -> same reference');
  ok(refA !== cs.contentReferenceFor(bytesB), '2 different bytes -> different reference');
  ok(refA === 'mpi-content://sha256/' + sha(bytesA), '3 reference is the sha256 of the bytes');
  ok(refA.length <= 256, '4 reference fits VARCHAR(256) (length ' + refA.length + ')');
  ok((function () { try { cs.parseContentReference('https://example.invalid/x'); return false; } catch (e) { return true; } })(),
    '5 foreign URI scheme refused');
  ok((function () { try { cs.parseContentReference('mpi-content://sha256/XYZ'); return false; } catch (e) { return true; } })(),
    '6 malformed digest refused');

  console.log('\nD3 CONTENT STORE — put/get/head round trip');

  const a1 = fakeAdapter();
  const store = cs.createContentStore({ adapter: a1 });

  const put1 = await store.putContent(bytesA);
  ok(put1.contentReference === refA && put1.deduplicated === false && put1.size === bytesA.length,
    '7 putContent stores and returns the deterministic reference');
  ok(a1.objects.has('content/sha256/' + sha(bytesA)), '8 object key is content/sha256/<digest>');

  const got = await store.getContent(refA);
  ok(Buffer.compare(got, bytesA) === 0, '9 getContent returns byte-identical content');

  const head1 = await store.headContent(refA);
  ok(head1.exists === true && head1.size === bytesA.length && head1.sha256 === sha(bytesA),
    '10 headContent reports existence, size, sha256');

  const putsBefore = a1.calls.filter(function (c) { return c[0] === 'put'; }).length;
  const put2 = await store.putContent(bytesA);
  const putsAfter = a1.calls.filter(function (c) { return c[0] === 'put'; }).length;
  ok(put2.deduplicated === true && put2.contentReference === refA && putsAfter === putsBefore,
    '11 duplicate content deduplicates: same reference, no second upload');

  console.log('\nD3 CONTENT STORE — integrity and failure handling');

  const missingRef = 'mpi-content://sha256/' + sha(Buffer.from('never-stored.invalid'));
  const headMissing = await store.headContent(missingRef);
  ok(headMissing.exists === false, '12 headContent on missing object -> exists=false');
  await expectError(function () { return store.getContent(missingRef); }, /missing object/,
    '13 getContent on missing object fails closed');

  // Corrupt the stored bytes without updating the key: hash-of-name check must catch it.
  a1.objects.get('content/sha256/' + sha(bytesA)).bytes = Buffer.from('tampered.invalid');
  await expectError(function () { return store.getContent(refA); }, /content integrity failure/,
    '14 corrupted object refused: bytes must hash to their own name');
  a1.objects.get('content/sha256/' + sha(bytesA)).bytes = bytesA; // restore

  a1.objects.get('content/sha256/' + sha(bytesA)).sha256 = 'not-the-hash';
  await expectError(function () { return store.headContent(refA); }, /content integrity failure/,
    '15 metadata/reference mismatch refused on head');
  a1.objects.get('content/sha256/' + sha(bytesA)).sha256 = sha(bytesA); // restore

  const a2 = fakeAdapter();
  a2.faults.put = 'provider request failed';
  const store2 = cs.createContentStore({ adapter: a2 });
  await expectError(function () { return store2.putContent(bytesB); }, /provider request failed/,
    '16 provider failure on put propagates; no reference is minted');
  ok(a2.objects.size === 0, '17 failed put leaves no object behind');

  a2.faults.put = null; a2.faults.head = 'provider request failed';
  await expectError(function () { return store2.putContent(bytesB); }, /provider request failed/,
    '18 provider failure on verification head propagates (fail closed, not fail open)');

  console.log('\nD3 CONTENT STORE — destination guards (D5)');

  const s3ish = { create: function () { return fakeAdapter(); } };
  const plantedSecret = 'planted-secret-value.invalid';
  ok((function () {
    try { cs.createFromConfig({ BUCKET: 'mythos-offhost-backups', SECRET_ACCESS_KEY: plantedSecret }, s3ish); return false; }
    catch (e) { return /refuses the production backup bucket/.test(e.message) && e.message.indexOf(plantedSecret) === -1; }
  })(), '19 forbidden bucket mythos-offhost-backups refused, message value-free');
  ok((function () {
    try { cs.createFromConfig({ BUCKET: 'some-other-bucket', SECRET_ACCESS_KEY: plantedSecret }, s3ish); return false; }
    catch (e) { return /unexpected bucket/.test(e.message) && e.message.indexOf(plantedSecret) === -1; }
  })(), '20 unexpected bucket refused, message value-free');
  ok(!!cs.createFromConfig({ BUCKET: 'mythos-mpi-backups' }, s3ish), '21 dedicated MPI bucket accepted');

  console.log('\nD3 CONTENT STORE — no deletion, no SQL, no embedded content');

  ok(typeof store.deleteContent === 'undefined' && typeof store.del === 'undefined' && typeof store.remove === 'undefined',
    '22 no deletion operation exposed (erasure is F14, future governance)');
  const source = fs.readFileSync(path.join(BASE, 'projects/personal-intelligence/persistence/content-store.js'), 'utf8');
  ok(!/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(source.replace(/\/\/[^\n]*\n/g, '\n')),
    '23 module contains no SQL INSERT/UPDATE/DELETE — PostgreSQL never receives content');

  console.log('\nD3 CONTENT STORE — database/object consistency (backup pair)');

  const a3 = fakeAdapter();
  const store3 = cs.createContentStore({ adapter: a3 });
  const p1 = await store3.putContent(Buffer.from('event-detail-1.invalid'));
  const p2 = await store3.putContent(Buffer.from('record-detail-2.invalid'));

  const clientOk = fakeClient({
    pi_memory_events: [p1.contentReference],
    pi_memory_records: [p2.contentReference]
  });
  const v1 = await cs.verifyConsistency(clientOk, store3);
  ok(v1.ok === true && v1.checked === 2 && v1.columns === 2 && v1.missing.length === 0,
    '24 all database references resolve in the store -> consistent pair');
  ok(clientOk.statements.every(function (s) { return /^\s*SELECT/i.test(s); }),
    '25 verifyConsistency is read-only: SELECT statements only');

  const clientMissing = fakeClient({
    pi_memory_events: [p1.contentReference, missingRef]
  });
  const v2 = await cs.verifyConsistency(clientMissing, store3);
  ok(v2.ok === false && v2.missing.length === 1 && v2.missing[0] === missingRef,
    '26 dangling reference detected and named');

  const clientMalformed = fakeClient({
    pi_memory_events: ['not-a-reference.invalid']
  });
  const v3 = await cs.verifyConsistency(clientMalformed, store3);
  ok(v3.ok === false && v3.malformed.length === 1, '27 malformed reference detected, never dereferenced');

  console.log('\nD3 content store: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + e.message);
  process.exit(1);
});
