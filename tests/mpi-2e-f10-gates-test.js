// =====================================================
// MPI-2E — F10 fail-closed external gate enforcement
// tests/mpi-2e-f10-gates-test.js
//
// The migration runner must refuse unless backupGateClosed, pcGateClosed and
// inventoryReconciled are ALL explicit boolean true — and it must refuse
// BEFORE opening a connection or executing any statement.
//
// The connection spy is the point of this suite: "fails closed" is not good
// enough if the runner has already touched the target database on the way to
// refusing.
//
//   MPI_SCRATCH_CONTAINER=<name> node tests/mpi-2e-f10-gates-test.js
// The positive path needs a scratch database; without it that case is
// reported as skipped, never as passed.
// =====================================================
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const P = path.join(__dirname, '..', 'projects/personal-intelligence/persistence');
const migrate = require(path.join(P, 'migrate'));
const { createClient } = require(path.join(P, 'client'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

// Records every attempt to reach the database. If any counter is non-zero on a
// refusal path, the gate did not fail closed early enough.
function createSpy() {
  const spy = { connects: 0, queries: 0, statements: [] };
  spy.driver = {
    query: async function (q) { spy.queries++; spy.statements.push(q.text); return { rows: [] }; },
    connect: async function () {
      spy.connects++;
      return { query: async function (q) { spy.queries++; spy.statements.push(q.text); return { rows: [] }; },
               release: function () {} };
    }
  };
  return spy;
}

const T = true;
const CASES = [
  ['1  all three gates true',        { backupGateClosed: T, pcGateClosed: T, inventoryReconciled: T }, true],
  ['2  backup false',                { backupGateClosed: false, pcGateClosed: T, inventoryReconciled: T }, false],
  ['3  PC false',                    { backupGateClosed: T, pcGateClosed: false, inventoryReconciled: T }, false],
  ['4  inventory false',             { backupGateClosed: T, pcGateClosed: T, inventoryReconciled: false }, false],
  ['5  all false',                   { backupGateClosed: false, pcGateClosed: false, inventoryReconciled: false }, false],
  ['6  backup undefined',            { pcGateClosed: T, inventoryReconciled: T }, false],
  ['7  PC undefined',                { backupGateClosed: T, inventoryReconciled: T }, false],
  ['8  inventory undefined',         { backupGateClosed: T, pcGateClosed: T }, false],
  ['9  backup null',                 { backupGateClosed: null, pcGateClosed: T, inventoryReconciled: T }, false],
  ['10 PC null',                     { backupGateClosed: T, pcGateClosed: null, inventoryReconciled: T }, false],
  ['11 inventory null',              { backupGateClosed: T, pcGateClosed: T, inventoryReconciled: null }, false],
  ['12 string "true"',               { backupGateClosed: 'true', pcGateClosed: T, inventoryReconciled: T }, false],
  ['13 numeric 1',                   { backupGateClosed: 1, pcGateClosed: T, inventoryReconciled: T }, false],
  ['14 empty string',                { backupGateClosed: '', pcGateClosed: T, inventoryReconciled: T }, false],
  ['15 object',                      { backupGateClosed: {}, pcGateClosed: T, inventoryReconciled: T }, false],
  ['16 array',                       { backupGateClosed: [], pcGateClosed: T, inventoryReconciled: T }, false],
  ['17 string "false"',              { backupGateClosed: 'false', pcGateClosed: T, inventoryReconciled: T }, false],
  ['18 string "yes"',                { backupGateClosed: 'yes', pcGateClosed: T, inventoryReconciled: T }, false],
  ['19 string "TRUE"',               { backupGateClosed: 'TRUE', pcGateClosed: T, inventoryReconciled: T }, false],
  ['20 numeric 0',                   { backupGateClosed: 0, pcGateClosed: T, inventoryReconciled: T }, false],
  ['21 string "1"',                  { backupGateClosed: '1', pcGateClosed: T, inventoryReconciled: T }, false],
  ['22 no options at all',           {}, false]
];

async function matrix() {
  console.log('\nMPI-2E — GATE MATRIX (strict boolean, no truthiness)');
  for (const [label, gates, shouldPass] of CASES) {
    const accepted = migrate.checkExternalGates(gates).ok;
    ok(accepted === shouldPass, label + ' -> ' + (accepted ? 'accepted' : 'REFUSED'));
  }
}

async function preConnectionProof() {
  console.log('\nMPI-2E — PRE-CONNECTION PROOF (refusal must precede any database contact)');
  for (const [label, gates, shouldPass] of CASES) {
    if (shouldPass) continue;
    const spy = createSpy();
    const client = createClient({ driver: spy.driver, schema: 'mythos_intelligence' });
    const opts = Object.assign({ expectedDatabase: 'scratch', expectedSystemIdentifier: 'x',
                                 diskOk: true, applicationReady: true }, gates);

    // preflight() must report the refusal without touching the database.
    const pre = await migrate.preflight(client, opts);
    // apply() must throw before anything, even with skipPreflight set.
    let threw = false, code = null;
    try { await migrate.apply(client, Object.assign({}, opts, { skipPreflight: true })); }
    catch (e) { threw = true; code = e.code; }

    const clean = spy.connects === 0 && spy.queries === 0;
    ok(pre.ok === false && pre.refusedBeforeConnection === true && threw
       && code === 'EXTERNAL_GATE_REFUSED' && clean,
       label + ' -> refused; connect=' + spy.connects + ' query=' + spy.queries + ' migration=0');
  }
}

async function messages() {
  console.log('\nMPI-2E — REFUSAL MESSAGES');
  let msg = '';
  try { migrate.assertExternalGates({ backupGateClosed: true }); } catch (e) { msg = e.message; }
  ok(/^MIGRATION REFUSED:/.test(msg), '23 message starts with MIGRATION REFUSED:');
  ok(/pcGateClosed must be explicit boolean true/.test(msg), '24 names the specific failed gate');
  ok(/No connection was opened/.test(msg), '25 states that nothing was touched');
  let leak = '';
  try { migrate.assertExternalGates({ backupGateClosed: 'postgres://user:secret@host/db' }); } catch (e) { leak = e.message; }
  ok(!/secret|postgres:\/\//.test(leak) && /string \(length/.test(leak),
     '26 a mistakenly-supplied connection string is NOT echoed (length only)');
  ok(migrate.REFUSAL_CONDITIONS.some(function (r) { return /pcGateClosed/.test(r); }),
     '27 refusal conditions document the external gate contract');
}

async function singleDecision() {
  console.log('\nMPI-2E — ONE AUTHORITATIVE DECISION PER GATE');
  const spy = createSpy();
  const client = createClient({ driver: spy.driver, schema: 'mythos_intelligence' });
  const pre = await migrate.preflight(client, { backupGateClosed: true, pcGateClosed: false,
    inventoryReconciled: true, expectedDatabase: 'x', expectedSystemIdentifier: 'y', diskOk: true, applicationReady: true });
  const backupChecks = pre.checks.filter(function (c) { return c.name === 'backup_gate_closed'; });
  ok(backupChecks.length === 1, '28 backup gate appears exactly once in checks (no duplicate interpretation)');
  ok(pre.checks.some(function (c) { return c.name === 'pc_gate_closed'; })
     && pre.checks.some(function (c) { return c.name === 'inventory_reconciled'; }),
     '29 PC and inventory gates are reported as first-class checks');
  ok(pre.checks.filter(function (c) { return c.operatorAsserted; }).length >= 3,
     '30 all three are marked operator-asserted, not machine-verified');
}

async function positivePath(container) {
  console.log('\nMPI-2E — POSITIVE PATH (scratch only, no production)');
  const db = 'f10pos';
  try { execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'DROP DATABASE IF EXISTS ' + db]); } catch (_) {}
  execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'CREATE DATABASE ' + db]);
  ['mythos_intelligence_app', 'mythos_intelligence_maint', 'mythos_intelligence_owner'].forEach(function (r) {
    try { execFileSync('sudo', ['docker', 'exec', container, 'psql', '-U', 'postgres', '-q', '-c', 'DROP ROLE IF EXISTS ' + r]); } catch (_) {}
  });
  const { createPsqlDriver } = require(path.join(P, 'testing', 'psql-driver'));
  const driver = createPsqlDriver({ container: container, database: db });
  const client = createClient({ driver: driver, schema: 'mythos_intelligence' });
  const sysid = (await client.query('SELECT system_identifier::text AS s FROM pg_control_system()', [])).rows[0].s;
  const opts = { expectedDatabase: db, expectedSystemIdentifier: sysid, diskOk: true,
                 applicationReady: true, backupGateClosed: true, pcGateClosed: true, inventoryReconciled: true };

  const pre = await migrate.preflight(client, opts);
  ok(pre.ok === true, '31 all gates true -> preflight succeeds and a connection is permitted');
  const applied = await migrate.apply(client, opts);
  ok(applied.length === 3 && applied.every(function (r) { return r.status === 'applied'; }),
     '32 migration planning and application proceed on scratch');
  const asserts = await migrate.assertSchema(client);
  ok(asserts.ok === true, '33 schema assertions run after the gates pass');
  await driver.end();
}

(async function main() {
  await matrix();
  await preConnectionProof();
  await messages();
  await singleDecision();
  const container = process.env.MPI_SCRATCH_CONTAINER;
  if (!container) { skipped = 3; console.log('\nMPI-2E POSITIVE PATH: SKIPPED (set MPI_SCRATCH_CONTAINER)'); }
  else {
    try { await positivePath(container); }
    catch (e) { failed++; console.log('  FAIL positive path aborted: ' + (e && e.message)); }
  }
  console.log('\nMPI-2E F10 gates: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
  process.exit(failed === 0 ? 0 : 1);
})();
