// =====================================================
// Mythos Personal Intelligence — MPI-2H Operator CLI (composition root)
// projects/personal-intelligence/cli/mpi-ingest-cli.js
//
// Implements the O-2H-2(a) ratified hosting decision
// (docs/MPI_2H_INGESTION_SPECIFICATION.md §32): an operator-run CLI batch on
// the VPS, on-demand per owner order. No service, no Coolify, no scheduling.
//
// This is a COMPOSITION ROOT ONLY (§29): it wires the existing, tested
// machinery — activation.js (real pg driver, env contract, no fallback),
// content-store.js (D3/D5), ingestion.js (validation, D1/D2, F8 replay,
// fail-closed REAL gates) — and adds the O-2H-1 initial-source restriction.
// It contains no second persistence path and no policy of its own.
//
// NO STANDING AUTHORISATION CAN EXIST (§24(5)). Every REAL invocation must
// carry, as per-invocation ARGUMENTS bound to the specific batch:
//   --real-order <importBatchRef>      the owner's scope-bound order names
//                                      exactly this batch ref
//   --backup-evidence <file>           JSON from the same-session backup
//                                      round-trip; its for_batch must equal
//                                      this batch ref, C1 must equal C2, and
//                                      the isolated restore must be PASS —
//                                      so evidence from a previous session
//                                      or batch can never be reused
//   --assert-first-party-only          the operator's D1/O-2H-1 attestation
//                                      for this batch's content
// Nothing is read from a config file for these gates; a previous batch's
// arguments cannot satisfy a new batch (different ref ⇒ different order and
// different evidence). Re-running the SAME ref is idempotent by F8.
//
// Usage:
//   node mpi-ingest-cli.js dry-run --items <file.json>
//   node mpi-ingest-cli.js ingest  --items <file.json> --content-config <env-file>
//        [--real-order <ref> --backup-evidence <file> --assert-first-party-only]
//
// dry-run validates only: no environment contract, no database, no object
// storage, no side effects of any kind.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ingestion = require('../persistence/ingestion');
const contentStore = require('../persistence/content-store');
const activation = require('../persistence/activation');
const s3 = require('../../idauto/ops/adapters/s3-compatible.js');

// O-2H-1 (ratified, §32): the initial source is explicit_instruction + note
// ONLY. observation/feedback remain valid module-level vocabulary but are NOT
// authorised for this CLI until the owner re-decides O-2H-1.
const INITIAL_SOURCE_TYPES = ['explicit_instruction', 'note'];

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

function readItemsFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw refusal('CLI_ITEMS_FILE_UNREADABLE');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw refusal('CLI_ITEMS_EMPTY');
  return parsed;
}

// batchScope(items) — §24(5) scope identification: one batch per invocation.
// Every item must carry the same import_batch_ref and the same class; that
// single ref IS the batch scope the owner order and backup evidence bind to.
function batchScope(items) {
  const refs = {};
  const classes = {};
  items.forEach(function (it) {
    if (it && it.provenance && it.provenance.importBatchRef) refs[it.provenance.importBatchRef] = true;
    if (it && it.class) classes[it.class] = true;
  });
  if (Object.keys(refs).length !== 1) throw refusal('CLI_BATCH_REF_NOT_UNIQUE');
  if (Object.keys(classes).length !== 1) throw refusal('CLI_BATCH_CLASS_NOT_UNIQUE');
  return { importBatchRef: Object.keys(refs)[0], itemClass: Object.keys(classes)[0] };
}

// validateBatch(items) — module validation (D1/D2/D3, provenance, sensitive
// shapes) plus the CLI's O-2H-1 initial-source restriction. Pure.
function validateBatch(items) {
  const scope = batchScope(items);
  const verdicts = items.map(function (it, i) {
    try {
      ingestion.validateItem(it);
      if (INITIAL_SOURCE_TYPES.indexOf(it.provenance.sourceType) === -1) {
        throw refusal('CLI_SOURCE_TYPE_NOT_IN_INITIAL_SOURCE (O-2H-1)');
      }
      const sensitive = ingestion.classifySensitive(it);
      if (sensitive) throw refusal('CLI_SENSITIVE_SHAPE:' + sensitive);
      return { index: i, ok: true };
    } catch (e) {
      return { index: i, ok: false, refusal: e.message };
    }
  });
  return { scope: scope, verdicts: verdicts, ok: verdicts.every(function (v) { return v.ok; }) };
}

// verifyBackupEvidence(file, importBatchRef) — the O-2H-6(a) same-session
// gate, made mechanically un-reusable: evidence is bound to THIS batch ref.
function verifyBackupEvidence(file, importBatchRef) {
  let ev;
  try {
    ev = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw refusal('CLI_BACKUP_EVIDENCE_UNREADABLE');
  }
  if (ev.for_batch !== importBatchRef) throw refusal('CLI_BACKUP_EVIDENCE_WRONG_BATCH (stale or reused)');
  if (typeof ev.c1 !== 'string' || !/^[a-f0-9]{64}$/.test(ev.c1)) throw refusal('CLI_BACKUP_EVIDENCE_C1_INVALID');
  if (ev.c1 !== ev.c2) throw refusal('CLI_BACKUP_EVIDENCE_C1_NE_C2');
  if (ev.restore_result !== 'PASS') throw refusal('CLI_BACKUP_EVIDENCE_RESTORE_NOT_PASS');
  if (!ev.completed_at_utc || isNaN(Date.parse(ev.completed_at_utc))) throw refusal('CLI_BACKUP_EVIDENCE_TIMESTAMP_INVALID');
  return ev;
}

function argValue(argv, name) {
  const i = argv.indexOf('--' + name);
  return i < 0 ? null : argv[i + 1];
}
function hasArg(argv, name) {
  return argv.indexOf('--' + name) >= 0;
}

// run(argv, deps) — deps injection exists ONLY so the test suite can drive
// this composition without a production database. Production main() passes
// no deps: every dependency resolves to the real module, and there is no
// mock, memory, or scratch fallback anywhere in this file.
async function run(argv, deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const out = d.out || function (line) { process.stdout.write(line + '\n'); };
  const cmd = argv[0];

  if (cmd === 'dry-run') {
    const items = readItemsFile(argValue(argv, 'items') || refuseMissing('items'));
    const result = validateBatch(items);
    out('DRY-RUN batch=' + result.scope.importBatchRef + ' class=' + result.scope.itemClass);
    result.verdicts.forEach(function (v) {
      out('  item[' + v.index + '] ' + (v.ok ? 'OK' : 'REFUSED ' + v.refusal));
    });
    out('DRY-RUN ' + (result.ok ? 'PASS' : 'FAIL') + ' (no connection, no writes, no objects)');
    return { ok: result.ok, dryRun: true, scope: result.scope };
  }

  if (cmd !== 'ingest') {
    throw refusal('CLI_UNKNOWN_COMMAND');
  }

  const items = readItemsFile(argValue(argv, 'items') || refuseMissing('items'));
  const validation = validateBatch(items);
  if (!validation.ok) {
    validation.verdicts.filter(function (v) { return !v.ok; }).forEach(function (v) {
      out('REFUSED item[' + v.index + '] ' + v.refusal);
    });
    throw refusal('CLI_BATCH_VALIDATION_FAILED');
  }
  const scope = validation.scope;

  // ---- REAL-class gates (§24) — argument-bound, never standing -------------
  let gates = {};
  if (scope.itemClass === 'REAL') {
    const order = argValue(argv, 'real-order');
    if (!order) throw refusal('CLI_REAL_ORDER_REQUIRED (§24(5): a scope-bound owner order names the batch)');
    if (order !== scope.importBatchRef) throw refusal('CLI_REAL_ORDER_SCOPE_MISMATCH');
    const evidenceFile = argValue(argv, 'backup-evidence');
    if (!evidenceFile) throw refusal('CLI_BACKUP_EVIDENCE_REQUIRED (O-2H-6a: same-session backup)');
    verifyBackupEvidence(evidenceFile, scope.importBatchRef);
    if (!hasArg(argv, 'assert-first-party-only')) {
      throw refusal('CLI_FIRST_PARTY_ATTESTATION_REQUIRED (D1/O-2H-1)');
    }
    if (!ingestion.loadIngestionFlag(env)) throw refusal('CLI_REAL_FLAG_DISABLED');
    gates = { realDataAuthorised: true, backupVerified: true };
  }

  // ---- Composition (§29): activation → content store → ingestion ----------
  const activate = d.activate || activation.activate;
  const activated = await activate({ env: env, pg: d.pg || require('../../idauto/node_modules/pg') });
  if (!activated.enabled) throw refusal('CLI_PERSISTENCE_DISABLED (MPI_PERSISTENCE_ENABLED is not true)');
  const client = activated.client;

  const configFile = argValue(argv, 'content-config');
  if (!configFile) throw refusal('CLI_CONTENT_CONFIG_REQUIRED');
  const store = d.store || contentStore.createFromConfig(s3.loadConfig(configFile), s3);

  const ing = ingestion.createIngestion({
    client: client,
    contentStore: store,
    flagEnabled: ingestion.loadIngestionFlag(env)
  });

  let ingested = 0, replayed = 0;
  for (let i = 0; i < items.length; i++) {
    const r = await ing.ingestItem(items[i], gates);
    if (r.ingested) ingested++;
    if (r.alreadyIngested) replayed++;
  }

  // ---- Post-batch verification (§26–§28 subset executable here) ------------
  const consistency = await contentStore.verifyConsistency(client, store);
  if (!consistency.ok) throw refusal('CLI_POST_BATCH_CONSISTENCY_FAILED');
  const health = await (d.checkReady || activation.isReady)(client);
  if (health !== true) throw refusal('CLI_POST_BATCH_HEALTH_FAILED');

  out('INGEST batch=' + scope.importBatchRef + ' class=' + scope.itemClass +
    ' ingested=' + ingested + ' replayed=' + replayed +
    ' consistency=ok references_checked=' + consistency.checked);
  if (scope.itemClass === 'REAL') {
    out('NOTE: the §26 post-batch backup round-trip must now be executed and recorded.');
  }
  return { ok: true, scope: scope, ingested: ingested, replayed: replayed };
}

function refuseMissing(name) {
  throw refusal('CLI_ARG_REQUIRED: --' + name);
}

async function main() {
  try {
    const r = await run(process.argv.slice(2));
    process.exitCode = r.ok ? 0 : 2;
  } catch (e) {
    // Refusal messages are rule-named and value-free by construction.
    process.stderr.write('REFUSED: ' + (e && e.message || 'unknown failure') + '\n');
    process.exitCode = e && e.refused ? 3 : 1;
  }
}

if (require.main === module) main();

module.exports = {
  run: run,
  validateBatch: validateBatch,
  batchScope: batchScope,
  verifyBackupEvidence: verifyBackupEvidence,
  INITIAL_SOURCE_TYPES: INITIAL_SOURCE_TYPES
};
