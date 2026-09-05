// =====================================================
// OTHKM strengthening — Phase 4 (bi-temporal memory)
// tests/othk-12-bitemporal-test.js
//
// Event-time validity (valid_from/valid_to) alongside transaction time
// (written_at / derived expired_at); "what was valid at T"; and the
// invalidate-don't-delete supersession rule (suggested valid_to only,
// never a mutation). All fixtures synthetic.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..', 'projects', 'oth-knowledge');
const ids = require(path.join(BASE, 'lib/ids.js'));
const model = require(path.join(BASE, 'lib/model.js'));
const storeLib = require(path.join(BASE, 'lib/store.js'));
const temporal = require(path.join(BASE, 'lib/temporal.js'));

let passed = 0, failed = 0;
function ok(v, label) { if (v) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function expectError(fn, re, label) { try { fn(); ok(false, label + ' (expected error)'); } catch (e) { ok(re.test(e.message), label + (re.test(e.message) ? '' : ' [' + e.message + ']')); } }
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk-test-')); }
function prov(cap) { return { source_class: 'manual', source_collection: 'c', source_reference: 'manual/c/x', captured_at: cap }; }
function fact(seed, statement, extra) { return Object.assign({ kind: 'fact', id: ids.recordId('fact', seed), statement, confidence: 'HIGH', provenance: prov('2020-01-01T00:00:00Z') }, extra || {}); }

// model: valid_from/valid_to accepted; ordering enforced; expired_at refused.
ok(model.validateRecord(fact('t1', 'x', { valid_from: '2021-01-01T00:00:00Z', valid_to: '2022-01-01T00:00:00Z' })).valid_to === '2022-01-01T00:00:00Z', 'P4: valid_from/valid_to accepted');
expectError(() => model.validateRecord(fact('t2', 'x', { valid_from: '2022-01-01T00:00:00Z', valid_to: '2021-01-01T00:00:00Z' })), /valid_to must not precede/, 'P4: valid_to before valid_from refused');
expectError(() => model.validateRecord(fact('t3', 'x', { valid_from: 'not-a-date' })), /valid_from must be an ISO/, 'P4: non-ISO valid_from refused');
expectError(() => model.validateRecord(fact('t4', 'x', { expired_at: '2021-01-01T00:00:00Z' })), /expired_at is derived/, 'P4: storing expired_at refused (it is derived)');

// validAt: half-open interval [from, to).
const r = fact('t5', 'CEO is Alice', { valid_from: '2021-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z' });
ok(temporal.validAt(r, '2022-06-01T00:00:00Z'), 'P4: valid inside interval');
ok(!temporal.validAt(r, '2020-06-01T00:00:00Z'), 'P4: not yet valid before valid_from');
ok(!temporal.validAt(r, '2023-01-01T00:00:00Z'), 'P4: not valid AT valid_to (half-open)');
ok(!temporal.validAt(r, '2024-01-01T00:00:00Z'), 'P4: expired after valid_to');
ok(temporal.validAt(fact('t6', 'open ended', { valid_from: '2021-01-01T00:00:00Z' }), '2099-01-01T00:00:00Z'), 'P4: open-ended valid_to is permissive');

// transaction-time expiredAt: derived from supersession/tombstone.
const s = storeLib.openStore(tmpRoot());
const idA = ids.recordId('fact', 't7');
s.appendRecord(fact('t7', 'v1'));
ok(temporal.expiredAt(s, idA) === null, 'P4: live single-version record has no expired_at');
s.appendRecord(fact('t7', 'v2', { statement: 'v2 corrected' }), { allowNewVersion: true });
ok(typeof temporal.expiredAt(s, idA) === 'string', 'P4: superseded record has a derived expired_at (transaction time)');
s.tombstone(idA, 'retired');
ok(typeof temporal.expiredAt(s, idA) === 'string', 'P4: tombstoned record has expired_at');

// "What was valid at T" via bi-temporal validAndKnownAt.
const s2 = storeLib.openStore(tmpRoot());
// Alice is CEO 2021..2023 (known 2021); Bob is CEO from 2023 (known 2023).
s2.appendRecord(fact('ceo-a', 'CEO is Alice', { valid_from: '2021-01-01T00:00:00Z', valid_to: '2023-01-01T00:00:00Z', provenance: prov('2021-01-01T00:00:00Z') }));
s2.appendRecord(fact('ceo-b', 'CEO is Bob', { valid_from: '2023-01-01T00:00:00Z', provenance: prov('2023-01-01T00:00:00Z') }));
const recA = s2.getRecord(ids.recordId('fact', 'ceo-a'));
const recB = s2.getRecord(ids.recordId('fact', 'ceo-b'));
ok(temporal.validAndKnownAt(s2, recA, '2022-06-01T00:00:00Z') && !temporal.validAndKnownAt(s2, recB, '2022-06-01T00:00:00Z'), 'P4: at 2022 → Alice valid, Bob not');
ok(temporal.validAndKnownAt(s2, recB, '2024-01-01T00:00:00Z') && !temporal.validAndKnownAt(s2, recA, '2024-01-01T00:00:00Z'), 'P4: at 2024 → Bob valid, Alice expired');
ok(!temporal.validAndKnownAt(s2, recB, '2022-06-01T00:00:00Z'), 'P4: Bob not "known" at 2022 (captured later) — no leak of future knowledge');

// suggestValidTo: invalidate-don't-delete default (loser.valid_to = winner.valid_from).
ok(temporal.suggestValidTo(recB, recA) === '2023-01-01T00:00:00Z', 'P4: suggested valid_to = winner start (Graphiti rule)');
ok(temporal.suggestValidTo(recA, recB) === null, 'P4: never move valid_to earlier than the loser start');

console.log('othk-12: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
