// =====================================================
// OTHKM — fail-closed store readability (regression)
// tests/othk-21-store-fail-closed-test.js
//
// Guards the defect where a store that EXISTS but is UNREADABLE by the
// calling user was opened as an empty-but-healthy store: fs.existsSync()
// returns false for EACCES exactly as for ENOENT, so _load() took the
// "absent store" branch, verify() reported ok with 0 problems, and
// promote-run --dry-run reported `would_add: 0` — indistinguishable from
// "analysed correctly, nothing to promote".
//
// Absence must stay legitimate (a fresh root initialises empty);
// inaccessibility must fail closed with OTHK_STORE_UNREADABLE.
//
// NOTE ON PRIVILEGE: root bypasses permission bits (CAP_DAC_OVERRIDE), so
// chmod 000 does not produce EACCES for uid 0. The permission cases are
// therefore SKIPPED — never silently passed — when run as root. Run this
// suite as the deploy user, which is the project's standing convention.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const storeLib = require(path.join(BASE, 'lib/store.js'));
const extract = require(path.join(BASE, 'lib/extract.js'));
const provenance = require(path.join(BASE, 'lib/provenance.js'));

let passed = 0, failed = 0, skipped = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function skip(label) { skipped++; console.log('  SKIP ' + label); }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-fc-')); }

const CLASSES = provenance.loadSourceClasses();
const PROV = { source_class: 'manual', source_collection: 'c', source_reference: 'manual/c/x', captured_at: '2022-01-01T00:00:00Z' };
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

// Throws with the given code?
function codeOf(fn) { try { fn(); return null; } catch (e) { return e.code || 'UNTYPED'; } }

// ---- 1. absent root => normal empty initialization (no regression) -------
{
  const absent = path.join(tmpRoot(), 'not-created-yet');
  let s = null;
  const code = codeOf(() => { s = storeLib.openStore(absent); });
  ok(code === null, 'A1: a genuinely absent store root opens without error');
  ok(s && s.allRecords().length === 0, 'A2: absent root initialises as an empty store');
  ok(s && s.verify().ok === true, 'A3: absent root verifies ok (unchanged behaviour)');
}

// ---- 2. provisioned root, no records.jsonl yet => still empty-ok ---------
{
  const root = tmpRoot(); // exists, readable, no log file
  let s = null;
  const code = codeOf(() => { s = storeLib.openStore(root); });
  ok(code === null && s && s.allRecords().length === 0,
    'B1: provisioned-but-empty root still initialises empty (seed/ingest on a fresh root keeps working)');
}

// ---- 3. readable root with records => unchanged --------------------------
{
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  extract.addClaim(s, CLASSES, { statement: 'readable store statement', asserted_by: 'test', prov: PROV });
  const reopened = storeLib.openStore(root);
  // addClaim also ensures the `source` record for its class, so a one-claim
  // store holds two records; assert on the claim rather than a bare count.
  const claims = reopened.allRecords().filter((r) => r.kind === 'claim');
  ok(claims.length === 1 && claims[0].statement === 'readable store statement',
    'C1: a readable store still loads its records');
  ok(reopened.verify().ok === true, 'C2: a readable store still verifies ok');
}

// ---- 4. unreadable records.jsonl => OTHK_STORE_UNREADABLE ----------------
{
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  extract.addClaim(s, CLASSES, { statement: 'soon unreadable', asserted_by: 'test', prov: PROV });
  const log = path.join(root, 'records.jsonl');
  fs.chmodSync(log, 0o000);
  if (IS_ROOT) {
    skip('D1: unreadable records.jsonl => OTHK_STORE_UNREADABLE (root bypasses permissions; run as deploy)');
  } else {
    const code = codeOf(() => storeLib.openStore(root));
    ok(code === 'OTHK_STORE_UNREADABLE', 'D1: unreadable records.jsonl => OTHK_STORE_UNREADABLE (got ' + code + ')');
    // The whole point: it must NOT come back as a healthy empty store.
    let silentEmpty = false;
    try { silentEmpty = storeLib.openStore(root).allRecords().length === 0; } catch (e) { silentEmpty = false; }
    ok(silentEmpty === false, 'D2: an unreadable log never yields an empty-but-healthy store');
  }
  fs.chmodSync(log, 0o600);
}

// ---- 5. unreadable ROOT => OTHK_STORE_UNREADABLE -------------------------
{
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  extract.addClaim(s, CLASSES, { statement: 'root soon unreadable', asserted_by: 'test', prov: PROV });
  fs.chmodSync(root, 0o000);
  if (IS_ROOT) {
    skip('E1: unreadable store root => OTHK_STORE_UNREADABLE (root bypasses permissions; run as deploy)');
  } else {
    const code = codeOf(() => storeLib.openStore(root));
    ok(code === 'OTHK_STORE_UNREADABLE', 'E1: unreadable store root => OTHK_STORE_UNREADABLE (got ' + code + ')');
  }
  fs.chmodSync(root, 0o700);
}

// ---- 6. unreadable run-store + promote-run => non-zero, never would_add:0 -
{
  const canonical = tmpRoot();
  const cs = storeLib.openStore(canonical);
  extract.addClaim(cs, CLASSES, { statement: 'canonical anchor', asserted_by: 'test', prov: PROV });

  const run = tmpRoot();
  const rs = storeLib.openStore(run);
  extract.addClaim(rs, CLASSES, { statement: 'pending promotion', asserted_by: 'test', prov: PROV });

  const cli = path.join(BASE, 'cli/othk-cli.js');
  fs.chmodSync(path.join(run, 'records.jsonl'), 0o000);

  if (IS_ROOT) {
    skip('F1: promote-run --dry-run on an unreadable run store exits non-zero (root bypasses permissions; run as deploy)');
    skip('F2: promote-run --dry-run on an unreadable run store never reports would_add: 0');
  } else {
    let out = '', status = 0;
    try {
      out = execFileSync(process.execPath, [cli, '--store', canonical, 'promote-run', run, '--dry-run'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      status = e.status === undefined ? 1 : e.status;
      out = (e.stdout || '') + (e.stderr || '');
    }
    ok(status !== 0, 'F1: promote-run --dry-run on an unreadable run store exits non-zero (status ' + status + ')');
    let wouldAddZero = false;
    try { wouldAddZero = JSON.parse(out).would_add === 0; } catch (e) { wouldAddZero = false; }
    ok(wouldAddZero === false, 'F2: promote-run --dry-run on an unreadable run store never reports would_add: 0');
    ok(/OTHK_STORE_UNREADABLE/.test(out), 'F3: the refusal names OTHK_STORE_UNREADABLE rather than a missing store');
  }
  fs.chmodSync(path.join(run, 'records.jsonl'), 0o600);

  // Control: the SAME batch, readable, must still dry-run cleanly.
  let out2 = '';
  try {
    out2 = execFileSync(process.execPath, [cli, '--store', canonical, 'promote-run', run, '--dry-run'], { encoding: 'utf8' });
  } catch (e) { out2 = (e.stdout || '') + (e.stderr || ''); }
  let parsed = null;
  try { parsed = JSON.parse(out2); } catch (e) { parsed = null; }
  ok(parsed && parsed.dry_run === true && parsed.would_add > 0,
    'F4: control — the same run store, readable, still dry-runs with would_add > 0');
}

// ---- 7. seed loader supports claims (authorised curated path) ------------
{
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  const seedLib = require(path.join(BASE, 'lib/seed.js'));
  const seedPath = path.join(tmpRoot(), 'seed.json');
  fs.writeFileSync(seedPath, JSON.stringify({
    format: 'othk-seed', version: 1, source_class: 'mythos-repo',
    source_collection: 'unit', source_reference: 'mythos-repo/unit/x',
    captured_at: '2026-09-06T00:00:00Z', confidence: 'HIGH',
    entities: [{ key: 'sys', entity_type: 'system', name: 'unit-system' }],
    claims: [{
      key: 'k1', statement: 'A repository-derived architectural statement.',
      asserted_by: 'mythos-repo:docs/EXAMPLE.md#1. Principle', entities: ['sys'], tags: ['unit'],
    }],
  }));
  const created = seedLib.loadSeed(s, CLASSES, seedPath);
  ok(created.claims === 1, 'G1: seed loader creates claims from a `claims:` array');
  const rec = s.allRecords().filter((r) => r.kind === 'claim')[0];
  ok(!!rec && rec.asserted_by === 'mythos-repo:docs/EXAMPLE.md#1. Principle',
    'G2: the claim carries asserted_by from the seed');
  ok(!!rec && rec.entity_ids.length === 1, 'G3: claim entity references resolve through seed keys');

  // asserted_by is mandatory for a claim — a seed omitting it must be refused.
  const badPath = path.join(tmpRoot(), 'bad.json');
  fs.writeFileSync(badPath, JSON.stringify({
    format: 'othk-seed', version: 1, source_class: 'mythos-repo',
    captured_at: '2026-09-06T00:00:00Z',
    claims: [{ key: 'b1', statement: 'Missing its assertor.' }],
  }));
  const code = codeOf(() => seedLib.loadSeed(storeLib.openStore(tmpRoot()), CLASSES, badPath));
  ok(code === 'OTHK_SEED_INPUT', 'G4: a claim without asserted_by is refused (got ' + code + ')');

  // Facts must keep working unchanged alongside claims.
  const mixPath = path.join(tmpRoot(), 'mix.json');
  fs.writeFileSync(mixPath, JSON.stringify({
    format: 'othk-seed', version: 1, source_class: 'manual',
    captured_at: '2026-09-06T00:00:00Z', confidence: 'HIGH',
    facts: [{ key: 'f1', statement: 'A plain fact still loads.' }],
  }));
  const mix = seedLib.loadSeed(storeLib.openStore(tmpRoot()), CLASSES, mixPath);
  ok(mix.facts === 1 && mix.claims === 0, 'G5: existing fact-only seeds load unchanged');
}

console.log('othk-21: ' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
if (skipped && IS_ROOT) console.log('  (permission cases skipped: run as deploy to exercise them)');
process.exit(failed ? 1 : 0);
