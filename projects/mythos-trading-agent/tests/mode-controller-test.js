'use strict';
// =====================================================
// MYTHOS TRADING AGENT — mode controller tests
// projects/mythos-trading-agent/tests/mode-controller-test.js
//
// These are the tests that enforce the owner's hardest rule: "the agent must
// never autonomously switch from backtest to paper or from paper to live."
//
// The suite is therefore written as an ADVERSARY. It does not check that a
// correct approval works and stop there — it tries every route an autonomous
// agent would plausibly take to raise the mode without one: no record, a record
// for the wrong transition, a self-signed record, a replayed record, a record
// bound to a different config, construction directly into LIVE, and a
// gates-claimed-but-not-evidenced record. Every one must be refused.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var mc = require(path.join(SRC, 'mode', 'mode-controller'));
var gates = require(path.join(SRC, 'mode', 'gates'));
var errors = require(path.join(SRC, 'core', 'errors'));
var logger = require(path.join(SRC, 'core', 'logger'));

var OWNER = { kind: mc.PrincipalKind.OWNER, id: 'owner:othman' };
var AGENT = { kind: mc.PrincipalKind.AGENT, id: 'agent:mythos-executor' };

var FP = 'cfg-fingerprint-abc';
var COMMIT = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

function controller(opts) {
  var o = opts || {};
  return mc.create({
    mode: o.mode || 'BACKTEST',
    configFingerprint: o.fp === undefined ? FP : o.fp,
    commit: o.commit === undefined ? COMMIT : o.commit,
    logger: o.logger || logger.create({ level: 'DEBUG', now: function () { return 0; } }),
    now: function () { return 0; }
  });
}

/** A fully valid BACKTEST -> PAPER approval. Tests then break one thing at a time. */
function paperApproval(overrides) {
  var required = gates.REQUIRED['BACKTEST->PAPER'];
  var evidence = {};
  required.forEach(function (g) { evidence[g] = 'evidence for ' + g + ': see docs/VALIDATION_GATES.md'; });
  var base = {
    id: 'approval-001',
    fromMode: 'BACKTEST',
    toMode: 'PAPER',
    ownerApproval: true,
    approvedBy: { kind: 'OWNER', id: 'owner:othman' },
    statement: mc.requiredStatement('BACKTEST', 'PAPER') + ' on the evidence recorded below.',
    approvedAt: '2026-09-30T12:00:00.000Z',
    configFingerprint: FP,
    commit: COMMIT,
    gatesPassed: required.slice(),
    gateEvidence: evidence
  };
  Object.keys(overrides || {}).forEach(function (k) { base[k] = overrides[k]; });
  return base;
}

// --- 1. the default state ---------------------------------------------------
test('a fresh controller is in BACKTEST', function () {
  var c = controller();
  assert.equal(c.mode(), 'BACKTEST');
  assert.equal(c.isBacktest(), true);
  assert.equal(c.isLive(), false);
});

test('a controller cannot even be constructed in LIVE', function () {
  assert.throws(function () { mc.create({ mode: 'LIVE' }); },
    function (e) {
      assert.equal(e.code, 'MODE_TRANSITION_REFUSED');
      assert.equal(errors.isRefusal(e), true);
      return true;
    });
});

test('an invalid mode string is rejected outright', function () {
  assert.throws(function () { mc.create({ mode: 'DEMO' }); }, /must be one of/);
});

// --- 2. the agent may not raise the mode ------------------------------------
test('an AGENT principal cannot raise the mode even holding a perfect approval', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: AGENT, approval: paperApproval() });
  }, /only an OWNER principal may raise the execution mode/);
  assert.equal(c.mode(), 'BACKTEST', 'the mode must be unchanged after a refusal');
});

test('an OPERATOR or SYSTEM principal cannot raise the mode either', function () {
  [mc.PrincipalKind.OPERATOR, mc.PrincipalKind.SYSTEM].forEach(function (kind) {
    var c = controller();
    assert.throws(function () {
      c.transition({ to: 'PAPER', principal: { kind: kind, id: 'x' }, approval: paperApproval() });
    }, /only an OWNER principal/);
    assert.equal(c.mode(), 'BACKTEST');
  });
});

test('a transition with no principal at all is refused', function () {
  var c = controller();
  assert.throws(function () { c.transition({ to: 'PAPER', approval: paperApproval() }); },
    /only an OWNER principal/);
});

// --- 3. no approval, or a broken one ---------------------------------------
test('an owner without an approval record is still refused', function () {
  var c = controller();
  assert.throws(function () { c.transition({ to: 'PAPER', principal: OWNER }); },
    /no owner-approval record was supplied/);
  assert.equal(c.mode(), 'BACKTEST');
});

test('an approval for the wrong transition is refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ toMode: 'LIVE' }) });
  }, /record toMode is "LIVE" but the requested mode is PAPER/);
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ fromMode: 'PAPER' }) });
  }, /record fromMode is "PAPER" but the current mode is BACKTEST/);
});

test('an approval not marked ownerApproval, or signed by a non-owner, is refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ ownerApproval: false }) });
  }, /does not carry ownerApproval === true/);
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ approvedBy: { kind: 'AGENT', id: 'a' } }) });
  }, /approvedBy.kind must be OWNER/);
});

test('an approval whose statement is not the exact required sentence is refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ statement: 'looks fine to me' }) });
  }, /statement must contain exactly/);
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ statement: 'I approve the Mythos Trading Agent transition PAPER -> LIVE' }) });
  }, /statement must contain exactly/);
});

test('an approval missing gates, or claiming unknown gates, is refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ gatesPassed: [] }) });
  }, /gates not satisfied/);
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ gatesPassed: ['EVERYTHING_IS_FINE'] }) });
  }, /claims unknown gates: EVERYTHING_IS_FINE/);
});

test('gates claimed without written evidence are refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ gateEvidence: {} }) });
  }, /gateEvidence missing or too short/);
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ gateEvidence: { UNIT_TESTS_PASS: 'ok' } }) });
  }, /gateEvidence missing or too short/);
});

test('an approval bound to a different config or commit is refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ configFingerprint: 'other' }) });
  }, /configFingerprint "other" does not match/);
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ commit: 'cafe' }) });
  }, /commit "cafe" does not match/);
});

test('an approval with a nonsense timestamp is refused', function () {
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval({ approvedAt: 'yesterday' }) });
  }, /approvedAt must be an ISO-8601 timestamp/);
});

// --- 4. the approved path works, once --------------------------------------
test('a complete owner approval raises BACKTEST to PAPER', function () {
  var c = controller();
  var res = c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval(), reason: 'gates satisfied' });
  assert.equal(res.changed, true);
  assert.equal(c.mode(), 'PAPER');
  var last = c.history()[c.history().length - 1];
  assert.equal(last.direction, 'UPGRADE');
  assert.equal(last.approvalId, 'approval-001');
  assert.equal(last.principal.kind, 'OWNER');
});

test('an approval record is single-use', function () {
  var c = controller();
  var approval = paperApproval();
  c.transition({ to: 'PAPER', principal: OWNER, approval: approval });
  c.transition({ to: 'BACKTEST', principal: OWNER, reason: 'back to research' });
  assert.equal(c.mode(), 'BACKTEST');
  assert.throws(function () { c.transition({ to: 'PAPER', principal: OWNER, approval: approval }); },
    /has already been used; approvals are single-use/);
  assert.equal(c.mode(), 'BACKTEST');
});

test('re-entering the same mode is a recorded no-op, not a transition', function () {
  var c = controller();
  var res = c.transition({ to: 'BACKTEST', principal: AGENT });
  assert.equal(res.changed, false);
  assert.equal(c.history().length, 1, 'a no-op adds no history entry');
});

// --- 5. PAPER -> LIVE is blocked by unsatisfiable gates --------------------
test('PAPER -> LIVE requires gates this build cannot satisfy', function () {
  var required = gates.REQUIRED['PAPER->LIVE'];
  assert.ok(required.indexOf(gates.Gate.LIVE_ADAPTER_IMPLEMENTED) !== -1);
  assert.ok(required.indexOf(gates.Gate.EXTERNAL_LEGAL_REVIEW) !== -1);
  assert.ok(required.indexOf(gates.Gate.VENUE_COSTS_VERIFIED) !== -1);
  gates.UNSATISFIABLE_IN_BUILD.forEach(function (g) {
    assert.equal(gates.isUnsatisfiable(g), true);
    assert.match(gates.GATE_DESCRIPTIONS[g], /NOT SATISFIABLE/);
  });
});

test('a realistic attempt at LIVE fails on the gates it cannot honestly claim', function () {
  var c = controller({ mode: 'PAPER' });
  var honest = {
    id: 'approval-live-1', fromMode: 'PAPER', toMode: 'LIVE', ownerApproval: true,
    approvedBy: OWNER,
    statement: mc.requiredStatement('PAPER', 'LIVE'),
    approvedAt: '2026-09-30T12:00:00.000Z',
    configFingerprint: FP, commit: COMMIT,
    acknowledgedCapitalAtRisk: true,
    // Everything a run of this repository could truthfully evidence:
    gatesPassed: gates.REQUIRED['PAPER->LIVE'].filter(function (g) { return !gates.isUnsatisfiable(g); }),
    gateEvidence: {}
  };
  gates.REQUIRED['PAPER->LIVE'].forEach(function (g) { honest.gateEvidence[g] = 'evidence placeholder for ' + g; });
  assert.throws(function () { c.transition({ to: 'LIVE', principal: OWNER, approval: honest }); },
    /gates not satisfied: VENUE_COSTS_VERIFIED, LIVE_ADAPTER_IMPLEMENTED, EXTERNAL_LEGAL_REVIEW/);
  assert.equal(c.mode(), 'PAPER');
});

test('LIVE additionally demands an explicit capital-at-risk acknowledgement', function () {
  var c = controller({ mode: 'PAPER' });
  var v = mc.verifyApproval({
    fromMode: 'PAPER', toMode: 'LIVE', ownerApproval: true, approvedBy: OWNER,
    statement: mc.requiredStatement('PAPER', 'LIVE'),
    approvedAt: '2026-09-30T12:00:00.000Z', configFingerprint: FP, commit: COMMIT,
    gatesPassed: gates.REQUIRED['PAPER->LIVE'].slice(),
    gateEvidence: (function () {
      var e = {};
      gates.REQUIRED['PAPER->LIVE'].forEach(function (g) { e[g] = 'evidence for ' + g; });
      return e;
    })()
  }, { fromMode: 'PAPER', toMode: 'LIVE', configFingerprint: FP, commit: COMMIT });
  assert.equal(v.ok, false);
  assert.deepEqual(v.problems, ['a transition to LIVE additionally requires acknowledgedCapitalAtRisk === true']);
});

test('BACKTEST -> LIVE has no gate set at all, so it cannot be approved', function () {
  assert.equal(gates.requiredFor('BACKTEST', 'LIVE'), null);
  var c = controller();
  assert.throws(function () {
    c.transition({ to: 'LIVE', principal: OWNER, approval: paperApproval({ toMode: 'LIVE' }) });
  }, /no gate set is defined for BACKTEST -> LIVE/);
  assert.equal(c.mode(), 'BACKTEST');
});

// --- 6. downgrades are always allowed -------------------------------------
test('anyone may downgrade toward BACKTEST without paperwork', function () {
  var c = controller({ mode: 'PAPER' });
  var res = c.transition({ to: 'BACKTEST', principal: AGENT, reason: 'anomaly detected' });
  assert.equal(res.changed, true);
  assert.equal(c.mode(), 'BACKTEST');
  assert.equal(c.history()[1].direction, 'DOWNGRADE');
  assert.equal(c.history()[1].reason, 'anomaly detected');
});

// --- 7. assertMode and dryRun ---------------------------------------------
test('assertMode refuses work that the current mode does not permit', function () {
  var c = controller();
  assert.equal(c.assertMode(['BACKTEST', 'PAPER'], 'place order'), 'BACKTEST');
  assert.throws(function () { c.assertMode('PAPER', 'place paper order'); },
    /place paper order requires mode in \[PAPER\] but the platform is in BACKTEST/);
});

test('dryRun reports what an approval would need without applying anything', function () {
  var c = controller();
  var res = c.dryRun('PAPER', null);
  assert.equal(res.ok, false);
  assert.equal(res.upgrade, true);
  assert.ok(res.requiredGates.length >= 10);
  assert.deepEqual(res.unsatisfiableGates, []);
  assert.equal(c.mode(), 'BACKTEST', 'dryRun must not change anything');

  var live = mc.create({ mode: 'PAPER', configFingerprint: FP, commit: COMMIT }).dryRun('LIVE', null);
  assert.deepEqual(live.unsatisfiableGates.slice().sort(), gates.UNSATISFIABLE_IN_BUILD.slice().sort());
  assert.equal(live.unsatisfiableGates.length, 3);

  var down = mc.create({ mode: 'PAPER' }).dryRun('BACKTEST', null);
  assert.equal(down.ok, true);
  assert.equal(down.upgrade, false);
});

// --- 8. every attempt is logged ------------------------------------------
test('refused upgrades are logged at ERROR with a machine-readable reason', function () {
  var log = logger.create({ level: 'DEBUG', now: function () { return 0; } });
  var c = controller({ logger: log });
  try { c.transition({ to: 'PAPER', principal: AGENT, approval: paperApproval() }); } catch (e) { /* expected */ }
  try { c.transition({ to: 'PAPER', principal: OWNER }); } catch (e) { /* expected */ }
  var refusals = log.memory().byEvent('mode.upgrade.refused');
  assert.equal(refusals.length, 2);
  assert.equal(refusals[0].reason, 'NON_OWNER_PRINCIPAL');
  assert.equal(refusals[1].reason, 'APPROVAL_INSUFFICIENT');
  assert.ok(Array.isArray(refusals[1].problems));
  refusals.forEach(function (r) { assert.equal(r.level, 'ERROR'); });
});

test('a successful upgrade is logged at WARN — it is never routine', function () {
  var log = logger.create({ level: 'DEBUG', now: function () { return 0; } });
  var c = controller({ logger: log });
  c.transition({ to: 'PAPER', principal: OWNER, approval: paperApproval() });
  var up = log.memory().byEvent('mode.upgraded');
  assert.equal(up.length, 1);
  assert.equal(up[0].level, 'WARN');
  assert.equal(up[0].to, 'PAPER');
});
