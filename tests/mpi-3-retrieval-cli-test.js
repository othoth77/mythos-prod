// =====================================================
// MPI-3 Stage R2 — Operator retrieval CLI suite (fully offline)
// tests/mpi-3-retrieval-cli-test.js
//
// The deps seam injects a fake activation/client/store; no database, no
// network, no R2. All fixtures synthetic `.invalid`. The production path is
// asserted structurally: real modules, read-only, no ingestion linkage.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const cli = require(path.join(BASE, 'projects/personal-intelligence/cli/mpi-retrieve-cli.js'));
const cs = require(path.join(BASE, 'projects/personal-intelligence/persistence/content-store.js'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectRefusal(fn, re, label) {
  try { await fn(); ok(false, label + ' (expected refusal, but it succeeded)'); }
  catch (e) { ok(e.refused === true && re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}

function fakeRow(id, over) {
  return Object.assign({
    memory_record_id: id, memory_type: 'DECISION', state: 'active', scope: 'user',
    max_conf_rank: 4, observed_at: '2026-08-10T00:00:00Z',
    content_summary: 'summary ' + id + ' .invalid',
    content_reference: null, provenance: [{}], tags: []
  }, over || {});
}

// Fake client whose query answers mimic the adapter's needs.
function fakeClient(rows) {
  const statements = [];
  return {
    statements: statements,
    withTransaction: async function (fn) {
      return fn({ query: async function (sql, params) {
        statements.push(sql);
        if (/FROM pi_memory_records m/.test(sql)) return { rows: rows };
        if (/FROM pi_memory_provenance WHERE memory_record_id = ANY/.test(sql)) {
          return { rows: rows.map(function (r) { return { memory_record_id: r.memory_record_id, confidence: 'EXPLICIT' }; }) };
        }
        if (/FROM pi_memory_tags/.test(sql)) return { rows: [] };
        if (/FROM pi_memory_conflicts/.test(sql)) return { rows: [] };
        if (/FROM pi_memory_events e/.test(sql)) return { rows: [] };
        return { rows: [] };
      } });
    },
    emit: function () {}
  };
}

function deps(rows, over) {
  const client = fakeClient(rows);
  const lines = [];
  return Object.assign({
    lines: lines,
    client: client,
    out: function (l) { lines.push(l); },
    activate: async function () { return { enabled: true, client: client }; }
  }, over || {});
}

const baseArgs = ['memory', '--user', 'u.invalid', '--organisation', 'o.invalid', '--limit', '5'];

(async function main() {
  console.log('\nMPI-3 R2 CLI (offline)');

  const d1 = deps([fakeRow('m1'), fakeRow('m2')]);
  const r1 = await cli.run(baseArgs, d1);
  ok(r1.ok === true && d1.lines.some(function (l) { return /^MEMORY returned=2 limit=5/.test(l); }),
    '1 memory retrieval through the composition, formatted output');
  ok(d1.lines.some(function (l) { return /DIAGNOSTICS \{/.test(l); }), '2 diagnostics emitted');

  await expectRefusal(function () { return cli.run(['memory', '--user', 'u.invalid', '--organisation', 'o.invalid'], deps([])); },
    /LIMIT_REQUIRED/, '3 missing limit surfaces the adapter refusal');
  await expectRefusal(function () {
    return cli.run(baseArgs.concat(['--include-states', 'active,tombstoned']), deps([]));
  }, /TOMBSTONED_INVISIBLE/, '4 O-R1(b) passes through: tombstoned request refused');
  await expectRefusal(function () { return cli.run(['nonsense'], deps([])); },
    /UNKNOWN_COMMAND/, '5 unknown command refused');

  const dDisabled = deps([]);
  dDisabled.activate = async function () { return { enabled: false }; };
  await expectRefusal(function () { return cli.run(baseArgs, dDisabled); },
    /PERSISTENCE_DISABLED/, '6 disabled activation is a refusal, never a fallback');

  const q = cli.buildQuery(['memory', '--user', 'u', '--organisation', 'o', '--limit', '3',
    '--domain', 'd', '--project', 'p', '--intent', 'why', '--entities', 'a,b',
    '--from', '2026-01-01T00:00:00Z', '--to', '2026-02-01T00:00:00Z', '--tags', 't1,t2',
    '--min-confidence', 'HIGH', '--include-states', 'active,superseded',
    '--no-require-provenance', '--allowed-scopes', 'user,organisation']);
  ok(q.userId === 'u' && q.organisationId === 'o' && q.limit === 3 && q.domainId === 'd' &&
     q.projectRef === 'p' && q.intent === 'why' && q.entities.length === 2 &&
     q.timeRange.from === '2026-01-01T00:00:00Z' && q.tags.length === 2 &&
     q.minConfidence === 'HIGH' && q.includeStates.length === 2 &&
     q.requireProvenance === false && q.permissions.allowedScopes.length === 2,
    '7 buildQuery covers the full §10 surface');

  const d2 = deps([fakeRow('m1')]);
  await cli.run(baseArgs.concat(['--intent', 'test-intent']), d2);
  ok(d2.lines.some(function (l) { return /intent\(echo-only\)/.test(l); }),
    '8 intent/entities are echoed as non-ranking inputs, never silently consumed');

  // Hydration: explicit only, from an already-returned item, via injected store.
  const adapterObjects = new Map();
  const store = cs.createContentStore({ adapter: {
    put: async function (k, b, m) { adapterObjects.set(k, { bytes: Buffer.from(b), sha256: m.sha256 }); },
    get: async function (k) { if (!adapterObjects.has(k)) throw new Error('missing object'); return adapterObjects.get(k).bytes; },
    head: async function (k) { if (!adapterObjects.has(k)) throw new Error('missing object'); const o = adapterObjects.get(k); return { size: o.bytes.length, sha256: o.sha256 }; }
  } });
  const body = Buffer.from('hydrated body .invalid');
  const ref = (await store.putContent(body)).contentReference;
  const d3 = deps([fakeRow('m1', { content_reference: ref })], { store: store });
  const r3 = await cli.run(baseArgs.concat(['--hydrate', 'm1', '--content-config', '/ignored.env']), d3);
  ok(r3.ok && d3.lines.some(function (l) { return /HYDRATED m1 bytes=22/.test(l); }),
    '9 explicit hydration of a returned item works');
  await expectRefusal(function () {
    return cli.run(baseArgs.concat(['--hydrate', 'not-returned', '--content-config', '/x.env']), deps([fakeRow('m1')], { store: store }));
  }, /HYDRATE_NOT_IN_RESULT/, '10 hydration limited to items the query actually returned');
  const d4 = deps([fakeRow('m1', { content_reference: ref })], { store: store });
  await cli.run(baseArgs, d4);
  ok(!d4.lines.some(function (l) { return /HYDRATED/.test(l); }),
    '11 without --hydrate no content is ever fetched or printed');

  const source = fs.readFileSync(path.join(BASE, 'projects/personal-intelligence/cli/mpi-retrieve-cli.js'), 'utf8');
  const noComments = source.replace(/\/\/[^\n]*\n/g, '\n');
  ok(!/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM)\b/i.test(noComments) &&
     !/require\([^)]*ingestion/.test(noComments) && !/putContent/.test(noComments),
    '12 structurally read-only: no SQL writes, no ingestion linkage, no content puts');

  const evDeps = deps([]);
  const rEv = await cli.run(['events', '--user', 'u.invalid', '--organisation', 'o.invalid', '--limit', '5'], evDeps);
  ok(rEv.ok === true && evDeps.lines.some(function (l) { return /^EVENTS returned=0/.test(l); }),
    '13 events command flows through the adapter');

  console.log('\nMPI-3 R2 CLI: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
