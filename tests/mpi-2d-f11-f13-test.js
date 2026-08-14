// =====================================================
// MPI-2D — F11 (transaction connection affinity) + F13 (preference reinforcement)
// tests/mpi-2d-f11-f13-test.js
//
// Regression suite for the two HIGH findings fixed in this stage.
//
//   MPI_SCRATCH_CONTAINER=<name> MPI_SCRATCH_DB=<db> node tests/mpi-2d-f11-f13-test.js
// Without those variables the database cases are reported as skipped, never
// as passed.
//
// F11 is exercised with a POOL-SHAPED driver over multiple real psql sessions —
// the shape that previously broke atomicity silently. A real pg.Pool over TCP
// cannot be used because the scratch container runs --network none; pg's own
// source (connect → query → release per call) establishes the equivalence.
//
// All fixture values are synthetic `.invalid`.
// =====================================================
'use strict';

const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const { createClient, PersistenceError } = require(path.join(P, 'client'));
const { createRepositories } = require(path.join(P, 'repositories'));
const adapters = require(path.join(P, 'adapters'));
const learning = require(path.join(BASE, 'projects/personal-intelligence/reference/learning-engine'));
const migrate = require(path.join(P, 'migrate'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

// ---------------------------------------------------------------------------
// Offline: the contract itself.
// ---------------------------------------------------------------------------
function offlineChecks() {
  console.log('\nMPI-2D CONTRACT (offline)');

  // A query-only driver must be REFUSED for transactions rather than silently
  // assumed session-affine — that assumption was F11.
  const queryOnly = { query: async function () { return { rows: [] }; } };
  const c = createClient({ driver: queryOnly, schema: 'mythos_intelligence' });
  let refused = false;
  return c.withTransaction(async function () { return 1; })
    .then(function () { ok(false, '1 query-only driver refused for transactions'); })
    .catch(function (e) {
      refused = /acquire\(\)/.test(e.message) || /F11/.test(e.message);
      ok(refused, '1 query-only driver REFUSED for transactions (no silent split)');
    })
    .then(function () {
      // A pg-Pool-shaped driver (connect() → client with release()) is adapted.
      let released = 0, statements = [];
      const poolShaped = {
        query: async function () { return { rows: [] }; },
        connect: async function () {
          return {
            query: async function (q) { statements.push(q.text); return { rows: [] }; },
            release: function () { released++; }
          };
        }
      };
      const pc = createClient({ driver: poolShaped, schema: 'mythos_intelligence' });
      return pc.withTransaction(async function (e) { await e.query('SELECT 1'); })
        .then(function () {
          ok(statements[0] === 'BEGIN' && statements[statements.length - 1] === 'COMMIT',
             '2 pg-Pool-shaped driver adapted via connect(): BEGIN…COMMIT on one client');
          ok(released === 1, '3 client released exactly once after success');
        });
    })
    .then(function () {
      let released = 0;
      const poolShaped = {
        query: async function () { return { rows: [] }; },
        connect: async function () {
          return { query: async function () { throw Object.assign(new Error('boom'), { code: '23505' }); },
                   release: function () { released++; } };
        }
      };
      const pc = createClient({ driver: poolShaped, schema: 'mythos_intelligence' });
      return pc.withTransaction(async function (e) { await e.query('SELECT 1'); })
        .then(function () { ok(false, '4 error propagates'); })
        .catch(function (e) {
          ok(e instanceof PersistenceError && e.kind === 'UNIQUE_VIOLATION', '4 error propagates with mapped kind');
          ok(released === 1, '5 client released exactly once after failure');
        });
    });
}

// ---------------------------------------------------------------------------
// Database cases.
// ---------------------------------------------------------------------------
async function dbChecks(container, database) {
  const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));

  // Pool-shaped driver over N independent real psql sessions, round-robined per
  // query() — pg-pool's affinity behaviour, real PostgreSQL semantics.
  function createPoolDriver(n) {
    const conns = [];
    for (let i = 0; i < n; i++) conns.push({ id: String.fromCharCode(65 + i), drv: createPsqlDriver({ container, database }) });
    let i = 0, acquired = 0, released = 0;
    const log = [];
    return {
      log, stats: function () { return { acquired, released }; },
      async query(q) { const c = conns[i++ % conns.length]; log.push({ conn: c.id, sql: q.text.trim().split('\n')[0] }); return c.drv.query(q); },
      async acquire() {
        const c = conns[i++ % conns.length]; acquired++;
        return { query: function (q) { log.push({ conn: c.id, sql: q.text.trim().split('\n')[0] }); return c.drv.query(q); },
                 release: function () { released++; } };
      },
      async end() { for (const c of conns) await c.drv.end(); }
    };
  }

  console.log('\nMPI-2D F11 — pool-shaped driver over real PostgreSQL');
  const pool = createPoolDriver(3);
  const pc = createClient({ driver: pool, schema: 'mythos_intelligence' });
  const probe = createPsqlDriver({ container, database });
  await probe.query({ text: 'CREATE TABLE IF NOT EXISTS public.f11 (id text primary key)', values: [] });
  await probe.query({ text: 'DELETE FROM public.f11', values: [] });

  // 1 successful transaction
  await pc.withTransaction(async function (e) { await e.query("INSERT INTO public.f11 (id) VALUES ('ok-1')"); });
  let n = (await probe.query({ text: "SELECT count(*)::int AS n FROM public.f11 WHERE id='ok-1'", values: [] })).rows[0].n;
  ok(Number(n) === 1, '6 successful transaction commits');

  // 2 all statements on ONE connection
  const conns = new Set(pool.log.map(function (r) { return r.conn; }));
  ok(conns.size === 1, '7 every statement of the transaction used ONE connection (was 3 before the fix)');

  // 3 rollback after a write
  try {
    await pc.withTransaction(async function (e) {
      await e.query("INSERT INTO public.f11 (id) VALUES ('rb-1')");
      await e.query("INSERT INTO public.f11 (id) VALUES ('rb-2')");
      throw new Error('forced failure after two writes');
    });
  } catch (_) { /* expected */ }
  n = (await probe.query({ text: "SELECT count(*)::int AS n FROM public.f11 WHERE id LIKE 'rb-%'", values: [] })).rows[0].n;
  ok(Number(n) === 0, '8 rollback after multiple writes leaves NOTHING (F11 regression)');

  // 4 release on every path
  const st = pool.stats();
  ok(st.acquired === st.released && st.acquired >= 2, '9 connection released on both success and failure paths (' + st.acquired + '/' + st.released + ')');

  // 5 connection reuse across sequential transactions
  await pc.withTransaction(async function (e) { await e.query("INSERT INTO public.f11 (id) VALUES ('ok-2')"); });
  n = (await probe.query({ text: 'SELECT count(*)::int AS n FROM public.f11', values: [] })).rows[0].n;
  ok(Number(n) === 2, '10 connection reuse across sequential transactions works');

  // 6 the single-session driver stays compatible
  const single = createPsqlDriver({ container, database });
  const sc = createClient({ driver: single, schema: 'mythos_intelligence' });
  try {
    await sc.withTransaction(async function (e) {
      await e.query("INSERT INTO public.f11 (id) VALUES ('sd-1')");
      throw new Error('forced failure');
    });
  } catch (_) { /* expected */ }
  n = (await probe.query({ text: "SELECT count(*)::int AS n FROM public.f11 WHERE id='sd-1'", values: [] })).rows[0].n;
  ok(Number(n) === 0, '11 existing single-session psql driver remains compatible and rolls back');

  console.log('\nMPI-2D F13 — preference reinforcement persists');
  const sysid = (await sc.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
  await migrate.apply(sc, { expectedDatabase: database, expectedSystemIdentifier: sysid,
    diskOk: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true,
    applicationReady: true, allowExistingSchema: true, skipPreflight: true });
  await sc.withTransaction(async function (e) {
    await e.query("INSERT INTO pi_domains (domain_id,display_name) VALUES ('D2D.invalid','d')");
    await e.query("INSERT INTO pi_organisations (organisation_id,organisation_ref,organisation_ref_source,domain_id) VALUES ('O2D.invalid','r','s','D2D.invalid')");
    await e.query("INSERT INTO pi_users (user_id,user_ref,user_ref_source,organisation_id) VALUES ('U2D.invalid','r','s','O2D.invalid')");
  });
  const PID = 'PRF2D.invalid';
  await sc.withTransaction(function (e) {
    return createRepositories(e).preferences.create({
      preferenceId: PID, userId: 'U2D.invalid', organisationId: 'O2D.invalid',
      preferenceKey: 'k', preferenceValueSummary: 'same', source: 'OBSERVATION',
      status: 'SESSION_OBSERVATION', evidenceCount: 1, confidence: 'LOW' });
  });
  const rowOf = async function () {
    return (await sc.read('SELECT status, confidence, evidence_count, last_observed_at FROM pi_learned_preferences WHERE preference_id=$1', [PID])).rows[0];
  };
  const start = await rowOf();
  let a = 0;
  // Each iteration RELOADS from the database, as a real request must.
  async function observeOnce() {
    const db = await rowOf();
    const store = [{ preferenceId: PID, userId: 'U2D.invalid', organisationId: 'O2D.invalid',
      preferenceKey: 'k', preferenceValueSummary: 'same', status: db.status,
      evidenceCount: Number(db.evidence_count), confidence: db.confidence,
      firstObservedAt: db.last_observed_at, lastObservedAt: db.last_observed_at }];
    await adapters.persistObservation(sc, { existingPreferences: store,
      observation: { userId: 'U2D.invalid', organisationId: 'O2D.invalid', preferenceKey: 'k',
        preferenceValueSummary: 'same', source: 'OBSERVATION' },
      actorRef: 'A.invalid', actorType: 'HUMAN', auditIdFor: function () { return 'AUD2D' + (++a) + '.invalid'; } });
    return rowOf();
  }
  const r1 = await observeOnce();
  ok(Number(r1.evidence_count) === 2, '12 reinforcement 1: evidence_count 1 -> 2 PERSISTED (F13 regression)');
  ok(String(r1.last_observed_at) !== String(start.last_observed_at), '13 last_observed_at moved T1 -> T2');
  const r2 = await observeOnce();
  ok(Number(r2.evidence_count) === 3, '14 reinforcement 2 after reload: 2 -> 3 PERSISTED');
  const r3 = await observeOnce();
  ok(Number(r3.evidence_count) === 4, '15 reinforcement 3 after reload: 3 -> 4 PERSISTED');
  // The domain owns promotion; the test asserts the domain's own rule, never a
  // hard-coded state. ESTABLISHED_THRESHOLD is 4.
  ok(r3.status === learning.STATUS.ESTABLISHED_PREFERENCE,
     '16 promotion to ESTABLISHED survives reload at the domain threshold (' + learning.ESTABLISHED_THRESHOLD + ')');
  ok(r3.confidence === 'HIGH', '17 confidence consistent with the resulting state (no longer stuck at LOW)');
  const audits = (await sc.read('SELECT count(*)::int AS n FROM pi_preference_audit WHERE preference_id=$1', [PID])).rows[0];
  ok(Number(audits.n) === 3, '18 one audit row per reinforcement, no duplicates');

  await pool.end(); await single.end(); await probe.end();
}

(async function main() {
  await offlineChecks();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  const database = process.env.MPI_SCRATCH_DB;
  if (!container || !database) {
    skipped = 13;
    console.log('\nMPI-2D DATABASE CASES: SKIPPED (set MPI_SCRATCH_CONTAINER and MPI_SCRATCH_DB)');
  } else {
    try { await dbChecks(container, database); }
    catch (e) { failed++; console.log('  FAIL suite aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI-2D F11/F13: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
