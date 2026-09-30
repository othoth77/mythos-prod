'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Champion / Challenger tests
// projects/mythos-trading-agent/tests/champion-test.js
//
// Mission §13's hardest sentence is "Never promote based on one profitable
// period", because an eight-item checklist can be satisfied by eight reports about
// the SAME profitable stretch. §3 is the section that tests the two mechanisms that
// actually prevent that:
//
//   * evidence is BOUND to the challenger's config hash and refused at attachment
//     if it came from a different configuration;
//   * evidence must span `minDistinctSegments` distinct data segments, so a
//     single-window case is refused however many report types it was sliced into.
//
// §2 tests the authority rule: an AGENT may register challengers, attach evidence
// and call dryRun() freely, and may not promote. A gate an autonomous agent can
// satisfy and then act on is a delay, not a gate.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var championMod = require(path.join(SRC, 'champion', 'registry'));
var modeMod = require(path.join(SRC, 'mode', 'mode-controller'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var errors = require(path.join(SRC, 'core', 'errors'));
var enums = require(path.join(SRC, 'core', 'enums'));
var money = require(path.join(SRC, 'core', 'money'));

var OWNER = { kind: 'OWNER', id: 'owner:othman' };
var OPERATOR = { kind: 'OPERATOR', id: 'operator:console' };
var AGENT = { kind: 'AGENT', id: 'agent:research' };

var CHAMP_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
var CHAL_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
var OTHER_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

var BASIS = 'seeded as the first champion from the Phase 9 baseline run; no incumbent existed to compare against';

function registry(over) {
  var o = over || {};
  var t = 1000;
  return championMod.create({
    rules: o.rules,
    store: o.store,
    modeController: o.modeController,
    logger: o.logger || loggerMod.nullLogger(),
    now: function () { return t++; }
  });
}

/** A registry with a seeded champion and one registered challenger. */
function withChallenger(over) {
  var r = registry(over);
  r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: BASIS });
  var c = r.registerChallenger({ principal: AGENT, configHash: CHAL_HASH, hypothesisId: 'hyp-0001' });
  return { registry: r, challenger: c };
}

/** Full passing evidence, spread across two segments. */
function attachFullEvidence(r, recordId, opts) {
  var o = opts || {};
  var hash = o.configHash || CHAL_HASH;
  var required = championMod.REQUIRED_EVIDENCE;
  required.forEach(function (kind, i) {
    r.attachEvidence(recordId, {
      kind: kind,
      configHash: hash,
      // Alternate segments so the distinct-segment rule is satisfied honestly.
      segment: o.singleSegment ? 'oos-2023H1' : (i % 2 === 0 ? 'oos-2023H1' : 'oos-2023H2'),
      passed: o.failKind === kind ? false : true,
      metrics: kind === championMod.Evidence.CHAMPION_COMPARISON ? Object.assign({
        expectancyDelta: 0.4,
        drawdownDeltaPct: -1.2,
        streakDelta: -1,
        outOfSampleTrades: 80
      }, o.comparisonMetrics || {}) : null
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Seeding and registration
// ---------------------------------------------------------------------------

test('the first champion is SEEDED, not promoted, and the distinction is permanent', function () {
  var r = registry();
  var c = r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: BASIS });
  assert.equal(c.origin, 'SEEDED',
    'a seeded champion must never be mistaken for one that passed the gate');
  assert.equal(c.state, 'CHAMPION');
  assert.equal(c.previousChampionConfigHash, null);
  assert.deepEqual(c.evidence, []);
  assert.equal(r.champion().configHash, CHAMP_HASH);
});

test('the initial champion needs a stated basis', function () {
  var r = registry();
  assert.throws(function () { r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: 'because' }); },
    /needs a stated basis/);
  assert.throws(function () { r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH }); },
    /needs a stated basis/);
  assert.throws(function () { r.seedChampion({ principal: OWNER, basis: BASIS }); },
    /needs the configuration hash/);
});

test('a champion cannot be seeded twice', function () {
  var r = registry();
  r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: BASIS });
  assert.throws(function () { r.seedChampion({ principal: OWNER, configHash: OTHER_HASH, basis: BASIS }); },
    /a champion is already installed/);
});

test('a challenger identical to the champion is refused', function () {
  var r = registry();
  r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: BASIS });
  assert.throws(function () { r.registerChallenger({ principal: AGENT, configHash: CHAMP_HASH }); },
    /same configuration hash as the champion; there is nothing to compare/);
});

test('the same challenger configuration cannot be registered twice while active', function () {
  var ctx = withChallenger();
  assert.throws(function () { ctx.registry.registerChallenger({ principal: AGENT, configHash: CHAL_HASH }); },
    /already registered as challenger/);
  // Once rejected, the configuration may be tried again.
  ctx.registry.reject(ctx.challenger.recordId, 'refuted by the out-of-sample comparison');
  assert.doesNotThrow(function () { ctx.registry.registerChallenger({ principal: AGENT, configHash: CHAL_HASH }); });
});

test('a challenger records the champion it is measured against', function () {
  var ctx = withChallenger();
  assert.equal(ctx.challenger.baselineConfigHash, CHAMP_HASH);
  assert.equal(ctx.challenger.state, 'CHALLENGER');
  assert.equal(ctx.challenger.hypothesisId, 'hyp-0001');
});

// ---------------------------------------------------------------------------
// 2. Authority — an agent may test, not approve
// ---------------------------------------------------------------------------

test('an AGENT may register challengers, attach evidence and dryRun', function () {
  var r = registry();
  r.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: BASIS });
  var c = r.registerChallenger({ principal: AGENT, configHash: CHAL_HASH });
  assert.doesNotThrow(function () {
    r.attachEvidence(c.recordId, { kind: 'BACKTEST', configHash: CHAL_HASH, segment: 'is-2023', passed: true });
  });
  assert.doesNotThrow(function () { r.dryRun(c.recordId); });
  assert.doesNotThrow(function () { r.reject(c.recordId, 'the agent refuted its own hypothesis'); });
});

test('an AGENT may NOT promote, seed or roll back — before any evidence is read', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  // The evidence is complete, so only the principal rule can be refusing.
  assert.equal(ctx.registry.dryRun(ctx.challenger.recordId).promotable, true);
  assert.throws(function () {
    ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: AGENT });
  }, function (e) {
    assert.equal(e.code, 'PROMOTION_REFUSED');
    assert.equal(errors.isRefusal(e), true);
    assert.match(e.message, /an AGENT principal may not promote a challenger to champion/);
    assert.match(e.message, /a delay rather than a gate/);
    return true;
  });
  assert.equal(ctx.registry.champion().configHash, CHAMP_HASH, 'the champion must be unchanged');

  var r2 = registry();
  assert.throws(function () { r2.seedChampion({ principal: AGENT, configHash: CHAMP_HASH, basis: BASIS }); },
    /an AGENT principal may not seed the initial champion/);
});

test('a promotion with no principal at all is refused', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  assert.throws(function () { ctx.registry.promote({ recordId: ctx.challenger.recordId }); },
    /a principal of kind \[OWNER, OPERATOR, AGENT, SYSTEM\] must be named/);
  assert.throws(function () {
    ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: { kind: 'OWNER' } });
  }, /must carry a non-empty id/);
});

test('an OPERATOR may promote', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  var champ = ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OPERATOR });
  assert.equal(champ.configHash, CHAL_HASH);
  assert.equal(champ.promotedBy.kind, 'OPERATOR');
});

// ---------------------------------------------------------------------------
// 3. "Never promote based on one profitable period"
// ---------------------------------------------------------------------------

test('evidence from one data segment cannot promote, however many report types it has', function () {
  var ctx = withChallenger();
  // ALL ten required kinds, all passing — but all from the same window.
  attachFullEvidence(ctx.registry, ctx.challenger.recordId, { singleSegment: true });
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.equal(v.promotable, false);
  assert.deepEqual(v.evidenceMissing, [], 'every required kind is present, so only the segment rule can be blocking');
  var b = v.blockers.filter(function (x) { return x.code === 'SINGLE_PERIOD_EVIDENCE'; })[0];
  assert.ok(b, 'blockers were: ' + v.blockers.map(function (x) { return x.code; }).join(', '));
  assert.match(b.detail, /forbids promoting on one profitable period/);
  assert.deepEqual(b.segments, ['oos-2023H1']);
  assert.throws(function () { ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER }); },
    /SINGLE_PERIOD_EVIDENCE/);
});

test('the same kind re-run on the same segment replaces rather than accumulates', function () {
  var ctx = withChallenger();
  var id = ctx.challenger.recordId;
  ctx.registry.attachEvidence(id, { kind: 'BACKTEST', configHash: CHAL_HASH, segment: 'is-2023', passed: false });
  ctx.registry.attachEvidence(id, { kind: 'BACKTEST', configHash: CHAL_HASH, segment: 'is-2023', passed: true });
  assert.equal(ctx.registry.challenger(id).evidence.length, 1, 'a re-run must not double-count');
  assert.equal(ctx.registry.challenger(id).evidence[0].passed, true, 'the later result stands');
  // A different segment is kept alongside, which is the point.
  ctx.registry.attachEvidence(id, { kind: 'BACKTEST', configHash: CHAL_HASH, segment: 'oos-2024', passed: true });
  assert.equal(ctx.registry.challenger(id).evidence.length, 2);
  assert.deepEqual(ctx.registry.dryRun(id).distinctSegments, ['is-2023', 'oos-2024']);
});

test('evidence must name the segment it came from', function () {
  var ctx = withChallenger();
  assert.throws(function () {
    ctx.registry.attachEvidence(ctx.challenger.recordId, { kind: 'BACKTEST', configHash: CHAL_HASH, passed: true });
  }, /must name the data SEGMENT it came from/);
  try {
    ctx.registry.attachEvidence(ctx.challenger.recordId, { kind: 'BACKTEST', configHash: CHAL_HASH, passed: true });
  } catch (e) {
    assert.match(e.message, /eight reports about one profitable window are indistinguishable/);
  }
});

test('the distinct-segment requirement is configurable and reported', function () {
  var ctx = withChallenger({ rules: { minDistinctSegments: 4 } });
  attachFullEvidence(ctx.registry, ctx.challenger.recordId); // spans 2 segments
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.equal(v.promotable, false);
  assert.equal(v.rules.minDistinctSegments, 4);
  assert.match(v.blockers.filter(function (b) { return b.code === 'SINGLE_PERIOD_EVIDENCE'; })[0].detail,
    /at least 4 distinct segments are required/);
});

// ---------------------------------------------------------------------------
// 4. Evidence binding
// ---------------------------------------------------------------------------

test('evidence from a different configuration is refused at attachment', function () {
  var ctx = withChallenger();
  assert.throws(function () {
    ctx.registry.attachEvidence(ctx.challenger.recordId, {
      kind: 'STRESS_SUITE', configHash: OTHER_HASH, segment: 'oos-2023H1', passed: true
    });
  }, /Evidence about a different configuration is not evidence about this one/);
  assert.equal(ctx.registry.challenger(ctx.challenger.recordId).evidence.length, 0,
    'the refused evidence must not be stored');
});

test('evidence must state pass or fail explicitly', function () {
  var ctx = withChallenger();
  assert.throws(function () {
    ctx.registry.attachEvidence(ctx.challenger.recordId, {
      kind: 'BACKTEST', configHash: CHAL_HASH, segment: 's'
    });
  }, /must state passed: true or false explicitly/);
  assert.throws(function () {
    ctx.registry.attachEvidence(ctx.challenger.recordId, {
      kind: 'BACKTEST', configHash: CHAL_HASH, segment: 's', passed: 'yes'
    });
  }, /must state passed: true or false explicitly/);
});

test('an unknown evidence kind is refused', function () {
  var ctx = withChallenger();
  assert.throws(function () {
    ctx.registry.attachEvidence(ctx.challenger.recordId, {
      kind: 'VIBES', configHash: CHAL_HASH, segment: 's', passed: true
    });
  }, /unknown evidence kind "VIBES"/);
});

test('evidence cannot be attached to a challenger that is no longer one', function () {
  var ctx = withChallenger();
  ctx.registry.reject(ctx.challenger.recordId, 'refuted out of sample');
  assert.throws(function () {
    ctx.registry.attachEvidence(ctx.challenger.recordId, {
      kind: 'BACKTEST', configHash: CHAL_HASH, segment: 's', passed: true
    });
  }, /is REJECTED; evidence can only be attached while it is a CHALLENGER/);
});

// ---------------------------------------------------------------------------
// 5. The gate itself
// ---------------------------------------------------------------------------

test('all ten mission §13 evidence kinds are required', function () {
  assert.deepEqual(championMod.REQUIRED_EVIDENCE.slice().sort(), [
    'BACKTEST', 'CHAMPION_COMPARISON', 'COST_MODEL_APPLIED', 'DEMO_COMPARISON',
    'DRAWDOWN_WITHIN_LIMIT', 'LOSING_STREAK_WITHIN_LIMIT', 'MONTE_CARLO',
    'OUT_OF_SAMPLE', 'STRESS_SUITE', 'WALK_FORWARD'
  ]);
});

test('missing evidence is named, kind by kind', function () {
  var ctx = withChallenger();
  ctx.registry.attachEvidence(ctx.challenger.recordId, {
    kind: 'BACKTEST', configHash: CHAL_HASH, segment: 'is-2023', passed: true
  });
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.equal(v.promotable, false);
  var b = v.blockers.filter(function (x) { return x.code === 'MISSING_EVIDENCE'; })[0];
  assert.equal(b.missing.length, championMod.REQUIRED_EVIDENCE.length - 1);
  assert.ok(b.missing.indexOf('STRESS_SUITE') !== -1);
  assert.deepEqual(v.evidencePresent, ['BACKTEST']);
});

test('one failing piece of evidence blocks the promotion', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId, { failKind: 'STRESS_SUITE' });
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.equal(v.promotable, false);
  var b = v.blockers.filter(function (x) { return x.code === 'FAILED_EVIDENCE'; })[0];
  assert.ok(b);
  assert.match(b.detail, /STRESS_SUITE@/);
  assert.equal(b.failing.length, 1);
});

test('a comparison that does not beat the champion blocks the promotion', function () {
  var cases = [
    { metrics: { expectancyDelta: 0 }, code: 'NO_EXPECTANCY_IMPROVEMENT' },
    { metrics: { expectancyDelta: -0.2 }, code: 'NO_EXPECTANCY_IMPROVEMENT' },
    { metrics: { drawdownDeltaPct: 3 }, code: 'DRAWDOWN_WORSENED' },
    { metrics: { streakDelta: 2 }, code: 'LOSING_STREAK_WORSENED' },
    { metrics: { outOfSampleTrades: 4 }, code: 'INSUFFICIENT_OUT_OF_SAMPLE_TRADES' }
  ];
  cases.forEach(function (c) {
    var ctx = withChallenger();
    attachFullEvidence(ctx.registry, ctx.challenger.recordId, { comparisonMetrics: c.metrics });
    var v = ctx.registry.dryRun(ctx.challenger.recordId);
    assert.equal(v.promotable, false, JSON.stringify(c.metrics) + ' should have blocked');
    assert.ok(v.blockers.some(function (b) { return b.code === c.code; }),
      'expected ' + c.code + ', got ' + v.blockers.map(function (b) { return b.code; }).join(', '));
  });
});

test('comparisonEvidence computes the deltas one way, with a consistent sign convention', function () {
  var r = registry();
  var champMetrics = { expectancy: 0.2, maxDrawdownPct: 8, maxConsecutiveLosses: 6, tradeCount: 90 };
  var better = { expectancy: 0.6, maxDrawdownPct: 6, maxConsecutiveLosses: 5, tradeCount: 80 };
  var e = r.comparisonEvidence({
    configHash: CHAL_HASH, segment: 'oos-2024',
    championMetrics: champMetrics, challengerMetrics: better, championConfigHash: CHAMP_HASH
  });
  assert.equal(e.kind, 'CHAMPION_COMPARISON');
  assert.equal(e.metrics.expectancyDelta, 0.4);
  assert.equal(e.metrics.drawdownDeltaPct, -2, 'less drawdown must be a NEGATIVE delta');
  assert.equal(e.metrics.streakDelta, -1);
  assert.equal(e.passed, true);

  var worse = { expectancy: 0.6, maxDrawdownPct: 12, maxConsecutiveLosses: 5, tradeCount: 80 };
  var e2 = r.comparisonEvidence({
    configHash: CHAL_HASH, segment: 'oos-2024',
    championMetrics: champMetrics, challengerMetrics: worse, championConfigHash: CHAMP_HASH
  });
  assert.equal(e2.passed, false, 'better expectancy with worse drawdown must not pass');
  assert.equal(e2.metrics.drawdownDeltaPct, 4);
});

test('unknown rules are refused and the rule set is frozen', function () {
  assert.throws(function () { championMod.create({ rules: { beNice: true } }); },
    /unknown champion\/challenger rule "beNice"/);
  assert.ok(Object.isFrozen(registry().rules));
});

// ---------------------------------------------------------------------------
// 6. Promotion, and what travels with it
// ---------------------------------------------------------------------------

test('a fully evidenced challenger promotes, and the evidence travels with the champion', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  var champ = ctx.registry.promote({
    recordId: ctx.challenger.recordId, principal: OWNER,
    basis: 'promoted on the two-segment out-of-sample comparison'
  });
  assert.equal(champ.configHash, CHAL_HASH);
  assert.equal(champ.origin, 'PROMOTED');
  assert.equal(champ.fromChallenger, ctx.challenger.recordId);
  assert.equal(champ.previousChampionConfigHash, CHAMP_HASH);
  assert.equal(champ.evidence.length, championMod.REQUIRED_EVIDENCE.length,
    'the evidence IS the approval record and must travel with the champion');
  assert.equal(ctx.registry.challenger(ctx.challenger.recordId).state, 'PROMOTED');
  assert.equal(ctx.registry.champion().configHash, CHAL_HASH);
});

test('promotion is recorded in the history with what it replaced', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER });
  var events = ctx.registry.history().map(function (h) { return h.event; });
  assert.ok(events.indexOf('CHAMPION_SEEDED') !== -1);
  assert.ok(events.indexOf('CHALLENGER_REGISTERED') !== -1);
  assert.ok(events.indexOf('EVIDENCE_ATTACHED') !== -1);
  assert.ok(events.indexOf('CHAMPION_PROMOTED') !== -1);
  var promo = ctx.registry.history().filter(function (h) { return h.event === 'CHAMPION_PROMOTED'; })[0];
  assert.equal(promo.previousChampionConfigHash, CHAMP_HASH);
  assert.equal(promo.principal, 'OWNER');
});

test('a refused promotion is recorded too', function () {
  var ctx = withChallenger();
  try { ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER }); } catch (e) { /* expected */ }
  var refusal = ctx.registry.history().filter(function (h) { return h.event === 'PROMOTION_REFUSED'; })[0];
  assert.ok(refusal, 'a refused promotion must leave a trace');
  assert.ok(refusal.blockers.indexOf('MISSING_EVIDENCE') !== -1);
});

test('rollback restores the previous champion without fresh evidence', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER });
  assert.equal(ctx.registry.champion().configHash, CHAL_HASH);

  var restored = ctx.registry.rollback({ principal: OWNER, reason: 'live behaviour diverged from the backtest' });
  assert.equal(restored.configHash, CHAMP_HASH, 'rollback must restore the configuration that was replaced');
  assert.equal(restored.origin, 'ROLLBACK');
  assert.equal(restored.previousChampionConfigHash, CHAL_HASH);
  var event = ctx.registry.history().filter(function (h) { return h.event === 'CHAMPION_ROLLED_BACK'; })[0];
  assert.equal(event.to, CHAMP_HASH);
  assert.equal(event.reason, 'live behaviour diverged from the backtest');
});

test('an AGENT may not roll back either, and a seeded champion has nothing to roll back to', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER });
  assert.throws(function () { ctx.registry.rollback({ principal: AGENT }); },
    /an AGENT principal may not roll the champion back/);

  var fresh = registry();
  fresh.seedChampion({ principal: OWNER, configHash: CHAMP_HASH, basis: BASIS });
  assert.throws(function () { fresh.rollback({ principal: OWNER }); },
    /has no predecessor recorded; it was seeded rather than promoted/);
});

test('rejecting a challenger needs a reason', function () {
  var ctx = withChallenger();
  assert.throws(function () { ctx.registry.reject(ctx.challenger.recordId, ''); }, /requires a reason/);
  assert.throws(function () { ctx.registry.reject('chal-9999', 'gone'); }, /unknown challenger/);
});

// ---------------------------------------------------------------------------
// 7. DEMO_COMPARISON cannot come from a BACKTEST run
// ---------------------------------------------------------------------------

test('DEMO_COMPARISON is listed as unsatisfiable while the platform is in BACKTEST', function () {
  var mc = modeMod.create({ mode: 'BACKTEST' });
  var ctx = withChallenger({ modeController: mc });
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.deepEqual(v.unsatisfiableInCurrentMode, ['DEMO_COMPARISON'],
    'an absent requirement is one nobody argues about; a named unsatisfiable one is auditable');
  assert.ok(championMod.REQUIRES_PAPER_MODE.indexOf('DEMO_COMPARISON') !== -1);
});

test('demo evidence claimed while in BACKTEST mode is rejected as impossible', function () {
  var mc = modeMod.create({ mode: 'BACKTEST' });
  var ctx = withChallenger({ modeController: mc });
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.equal(v.promotable, false);
  var b = v.blockers.filter(function (x) { return x.code === 'EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE'; })[0];
  assert.ok(b, 'blockers: ' + v.blockers.map(function (x) { return x.code; }).join(', '));
  assert.match(b.detail, /cannot have been produced in BACKTEST mode/);
  assert.deepEqual(b.kinds, ['DEMO_COMPARISON']);
  assert.throws(function () { ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER }); },
    /EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE/);
});

test('without a mode controller the mode check is simply absent, not assumed satisfied', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  var v = ctx.registry.dryRun(ctx.challenger.recordId);
  assert.deepEqual(v.unsatisfiableInCurrentMode, []);
  assert.equal(v.promotable, true,
    'a caller that supplies no mode controller takes responsibility for the provenance of its evidence');
});

// ---------------------------------------------------------------------------
// 8. Persistence and reporting
// ---------------------------------------------------------------------------

test('champions and challengers persist, including the refused states', function () {
  var store = storeMod.create({ runId: 'champ' });
  var ctx = withChallenger({ store: store });
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER });

  var champions = store.table('champions').all();
  assert.ok(champions.length >= 3, 'seed, retire and promote must each be recorded');
  var states = champions.map(function (c) { return c.state; });
  assert.ok(states.indexOf('CHAMPION') !== -1);
  assert.ok(states.indexOf('RETIRED') !== -1);

  var challengerRows = store.table('challengers').all();
  assert.ok(challengerRows.length >= 2);
  var last = challengerRows[challengerRows.length - 1];
  assert.equal(last.state, 'PROMOTED');
  assert.equal(last.evidenceCount, championMod.REQUIRED_EVIDENCE.length);
  assert.deepEqual(last.distinctSegments, ['oos-2023H1', 'oos-2023H2']);
});

test('describe() is a serialisable snapshot with the unsatisfiable requirements named', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  var d = ctx.registry.describe();
  assert.equal(d.champion.configHash, CHAMP_HASH);
  assert.equal(d.champion.origin, 'SEEDED');
  assert.equal(d.challengers.length, 1);
  assert.equal(d.challengers[0].distinctSegments, 2);
  assert.equal(d.requiredEvidence.length, 10);
  assert.deepEqual(d.unsatisfiableInBacktestMode, ['DEMO_COMPARISON']);
  assert.equal(d.fingerprint.length, 12);
  JSON.parse(JSON.stringify(d));
});

test('active() lists only challengers still under test', function () {
  var ctx = withChallenger();
  ctx.registry.registerChallenger({ principal: AGENT, configHash: OTHER_HASH });
  assert.equal(ctx.registry.active().length, 2);
  ctx.registry.reject(ctx.challenger.recordId, 'refuted by the walk-forward');
  assert.equal(ctx.registry.active().length, 1);
  assert.equal(ctx.registry.active()[0].configHash, OTHER_HASH);
  assert.equal(ctx.registry.challengers().length, 2, 'the rejected one is retained for the record');
});

test('contender states come from the shared enum', function () {
  var ctx = withChallenger();
  attachFullEvidence(ctx.registry, ctx.challenger.recordId);
  ctx.registry.promote({ recordId: ctx.challenger.recordId, principal: OWNER });
  assert.ok(enums.isValid(enums.ContenderState, ctx.registry.champion().state));
  ctx.registry.challengers().forEach(function (c) {
    assert.ok(enums.isValid(enums.ContenderState, c.state), 'bad state ' + c.state);
  });
});
