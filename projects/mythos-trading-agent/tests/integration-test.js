'use strict';
// =====================================================
// MYTHOS TRADING AGENT — full integration tests (mission §18 PHASE 15)
// projects/mythos-trading-agent/tests/integration-test.js
//
// Every other suite tests one component in isolation. This one runs the whole
// system in the order mission §12 and §13 describe, and asserts the properties that
// only exist when the pieces are joined:
//
//   §2 THE COMPLETE RESEARCH CYCLE — backtest, analyse, hypothesise, propose, run
//      the variant in and out of sample, walk it forward, stress it, compare, and
//      register it as a challenger with bound evidence. Ending in a promotion that
//      is REFUSED, because DEMO_COMPARISON cannot be produced in BACKTEST mode.
//
//   §3 THE OWNER GATE, END TO END — the same challenger becomes promotable only
//      after the owner approves PAPER, a paper A/B session runs, and its demo
//      evidence is attached. Every step an agent is forbidden from taking is
//      attempted here with an AGENT principal first, and refused.
//
//   §4 THE §17 QUESTIONS, answered by querying one real run's store.
//
//   §5 THE SAFETY INVARIANTS, asserted against a live system rather than a unit:
//      live execution refuses, nothing can reach a network, one trade at a time,
//      every trade used the Risk-Engine-approved size, no secret is ever stored.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var configMod = require(path.join(SRC, 'config'));
var engine = require(path.join(SRC, 'backtest', 'engine'));
var walkForward = require(path.join(SRC, 'backtest', 'walk-forward'));
var tradingAgent = require(path.join(SRC, 'agents', 'trading-agent'));
var analysisAgent = require(path.join(SRC, 'agents', 'analysis-agent'));
var researchAgent = require(path.join(SRC, 'agents', 'research-agent'));
var stressSuite = require(path.join(SRC, 'stress', 'suite'));
var championMod = require(path.join(SRC, 'champion', 'registry'));
var healthMod = require(path.join(SRC, 'observability', 'health'));
var modeMod = require(path.join(SRC, 'mode', 'mode-controller'));
var gates = require(path.join(SRC, 'mode', 'gates'));
var sessionMod = require(path.join(SRC, 'paper', 'session'));
var feedMod = require(path.join(SRC, 'data', 'feed'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var enums = require(path.join(SRC, 'core', 'enums'));
var money = require(path.join(SRC, 'core', 'money'));
var cliMod = require(path.join(__dirname, '..', 'bin', 'mtx.js'));

var FIXTURES = fixtureSource.createSource();
var OWNER = { kind: 'OWNER', id: 'owner:othman' };
var AGENT = { kind: 'AGENT', id: 'agent:mythos-executor' };
var COMMIT = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

var SYMBOLS = ['EURUSD', 'GBPUSD'];
var BARS = 2400;

function barsFor(symbol, n, from) {
  return FIXTURES.load(symbol, 'M15').slice(from || 0, (from || 0) + (n === undefined ? BARS : n));
}

function rawData(n) {
  var out = {};
  SYMBOLS.forEach(function (s) { out[s] = barsFor(s, n); });
  return out;
}

function sourceFor(data) {
  var wrapped = {};
  Object.keys(data).forEach(function (s) { wrapped[s] = { M15: data[s] }; });
  return sourceMod.fromBars({ kind: 'integration', datasetVersion: 'integration-v1', data: wrapped });
}

function configFor(over, mode) {
  var probe = tradingAgent.create({ config: configMod.load({ universe: SYMBOLS }) });
  return configMod.load(Object.assign({
    mode: mode || 'BACKTEST',
    universe: SYMBOLS,
    account: { initialCapital: 5000 },
    backtest: { warmupBars: probe.warmupBars(), seed: 'integration' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
    jev: { scoreThreshold: 40, minConfidence: 0.15 }
  }, over || {}));
}

function runOne(cfg, data, label, range) {
  var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
  var res = engine.run({
    config: cfg, source: sourceFor(data), label: label, range: range,
    logger: loggerMod.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  });
  res.agent = wired.agent;
  return res;
}

/** A mode controller legitimately moved to PAPER by a complete owner approval. */
function approvePaper(cfg) {
  var required = gates.REQUIRED['BACKTEST->PAPER'];
  var evidence = {};
  required.forEach(function (g) { evidence[g] = 'evidence for ' + g + ': recorded in the integration run'; });
  var mc = modeMod.create({
    mode: 'BACKTEST', configFingerprint: cfg.fingerprint.hash, commit: COMMIT,
    logger: loggerMod.nullLogger(), now: function () { return 0; }
  });
  mc.transition({
    to: 'PAPER', principal: OWNER,
    approval: {
      id: 'approval-integration', fromMode: 'BACKTEST', toMode: 'PAPER', ownerApproval: true,
      approvedBy: OWNER, statement: modeMod.requiredStatement('BACKTEST', 'PAPER'),
      approvedAt: '2026-09-30T12:00:00.000Z',
      configFingerprint: cfg.fingerprint.hash, commit: COMMIT,
      gatesPassed: required.slice(), gateEvidence: evidence
    }
  });
  return mc;
}

// ---------------------------------------------------------------------------
// 1. Health checks against a real run
// ---------------------------------------------------------------------------

test('the health report passes every safety check against a real run', function () {
  var cfg = configFor();
  var data = rawData();
  var run = runOne(cfg, data, 'health-a');
  var rerun = runOne(cfg, data, 'health-a');
  var health = healthMod.create({ config: cfg, logger: loggerMod.nullLogger() });
  var rep = health.report({ run: run, rerun: rerun });

  assert.notEqual(rep.status, 'FAIL', 'health FAILED: ' + JSON.stringify(rep.failed));
  assert.deepEqual(rep.failed, []);

  function statusOf(name) {
    return rep.checks.filter(function (c) { return c.check === name; })[0].status;
  }
  // The safety claims must be OK, not merely non-failing.
  assert.equal(statusOf('LIVE_EXECUTION_REFUSED'), 'OK');
  assert.equal(statusOf('NO_NETWORK_CLIENT'), 'OK');
  assert.equal(statusOf('MODE_IS_SAFE'), 'OK');
  assert.equal(statusOf('RECOVERY_CAPPED'), 'OK');
  assert.equal(statusOf('ONE_TRADE_ONLY'), 'OK');
  assert.equal(statusOf('COST_MODEL_APPLIED'), 'OK');
  assert.equal(statusOf('RISK_LIMITS_ENFORCED'), 'OK');
  assert.equal(statusOf('NO_SECRETS_STORED'), 'OK');
  assert.equal(statusOf('AUDIT_TRAIL_COMPLETE'), 'OK');
  assert.equal(statusOf('BACKTEST_REPRODUCIBLE'), 'OK');
  // Provenance must be flagged rather than passed, and it must NOT be possible to
  // make it pass by naming the dataset something innocuous — this build has no
  // market-data access, so no run can honestly claim real data.
  assert.equal(statusOf('DATA_PROVENANCE'), 'WARN');
  var prov = rep.checks.filter(function (c) { return c.check === 'DATA_PROVENANCE'; })[0];
  assert.match(prov.detail, /validates MECHANICS only/);
  assert.equal(prov.numbers.declaredRealMarketData, false);
  assert.ok(prov.numbers.datasetVersions.length > 0, 'the versions actually used must be named');
});

test('an unevaluated check returns UNKNOWN, and UNKNOWN is never presented as a pass', function () {
  var cfg = configFor();
  var health = healthMod.create({ config: cfg, logger: loggerMod.nullLogger() });
  var rep = health.report({});   // no run at all
  assert.notEqual(rep.status, 'OK', 'a report with nothing to evaluate must not read as OK');
  assert.ok(rep.unknown.length >= 6, 'expected many UNKNOWNs, got ' + rep.unknown.length);
  assert.ok(rep.unknown.indexOf('ONE_TRADE_ONLY') !== -1);
  assert.ok(rep.unknown.indexOf('BACKTEST_REPRODUCIBLE') !== -1);
  assert.match(rep.note, /An UNKNOWN is not a pass/);
  // The static safety checks still run — they do not need a run.
  assert.ok(rep.checks.filter(function (c) { return c.check === 'LIVE_EXECUTION_REFUSED'; })[0].status === 'OK');
});

test('reproducibility cannot be claimed from a single run', function () {
  var cfg = configFor();
  var run = runOne(cfg, rawData(600), 'repro');
  var health = healthMod.create({ config: cfg, logger: loggerMod.nullLogger() });
  var one = health.reproducible(run, null);
  assert.equal(one.status, 'UNKNOWN');
  assert.match(one.detail, /an equality between two runs and cannot be asserted from one/);
  var two = health.reproducible(run, runOne(cfg, rawData(600), 'repro'));
  assert.equal(two.status, 'OK');
});

test('the health report persists one row per check', function () {
  var cfg = configFor();
  var run = runOne(cfg, rawData(600), 'persist');
  var health = healthMod.create({ config: cfg, logger: loggerMod.nullLogger() });
  var rep = health.report({ run: run });
  var store = storeMod.create({ runId: 'health' });
  assert.equal(health.persist(store, rep), rep.checks.length);
  assert.equal(store.table('health_checks').count(), rep.checks.length);
  assert.match(health.summarise(rep), /^(OK|WARN|FAIL|UNKNOWN) \(\d+ ok/);
});

// ---------------------------------------------------------------------------
// 2. The complete research cycle, ending in a refused promotion
// ---------------------------------------------------------------------------

test('the full research cycle runs, and promotion is refused in BACKTEST mode', function () {
  var cfg = configFor();
  var data = rawData();
  var series = data.EURUSD;

  // --- step 1: the champion's own baseline, split in and out of sample -----
  var split = walkForward.split(series, { inSampleRatio: 0.6, warmupBars: cfg.backtest.warmupBars });
  assert.ok(split.outOfSample.fromTs > split.inSample.toTs, 'out-of-sample must follow in-sample in time');

  var baseIn = runOne(cfg, data, 'champion-in', split.inSample.range);
  var baseOut = runOne(cfg, data, 'champion-out', split.outOfSample.range);
  assert.ok(baseIn.trades.length > 0, 'the baseline took no in-sample trades');

  // --- step 2: the Analysis Agent -----------------------------------------
  var analyst = analysisAgent.create({ minSample: 10 });
  var report = analyst.analyse({ store: baseIn.store, initialCapital: cfg.account.initialCapital, label: 'in-sample' });
  assert.ok(report.funnel.candidatesBuilt > 0);
  assert.ok(report.caveats.length > 0);

  // --- step 3: the Research Agent proposes --------------------------------
  var researcher = researchAgent.create({ minSample: 10, thresholds: { minOutOfSampleTrades: 5 } });
  var research = researcher.research({ report: report, config: cfg });
  assert.equal(research.authority, 'PROPOSAL_ONLY');
  assert.ok(research.hypotheses.length > 0, 'the cycle needs at least one hypothesis to continue');
  research.hypotheses.forEach(function (h) {
    assert.ok(h.falsification.length >= 20, 'every hypothesis must say what would refute it');
  });

  // Pick the first proposal that is a loadable configuration override.
  var proposal = research.proposals.filter(function (p) {
    if (p.override.strategy && p.override.strategy.disable) return false;
    try { configMod.load(p.override); return true; } catch (e) { return false; }
  })[0];
  assert.ok(proposal, 'no proposal was a loadable config override');

  // --- step 4: run the variant, in and out of sample ----------------------
  var variantCfg = configMod.load(configMod.deepMerge(stripDerived(configMod.serialise(cfg)), proposal.override));
  assert.notEqual(variantCfg.fingerprint.hash, cfg.fingerprint.hash, 'the variant must differ from the baseline');

  var varIn = runOne(variantCfg, data, 'variant-in', split.inSample.range);
  var varOut = runOne(variantCfg, data, 'variant-out', split.outOfSample.range);

  // --- step 5: walk it forward -------------------------------------------
  var folds = walkForward.rollingFolds(series, {
    inSampleBars: 700, outOfSampleBars: 350,
    warmupBars: cfg.backtest.warmupBars, maxFolds: 2
  });
  assert.ok(folds.length >= 1);
  var variantWf = walkForward.evaluate({
    folds: folds,
    runSegment: function (segment) {
      return { metrics: runOne(variantCfg, data, segment.label, segment.range).metrics };
    }
  });
  assert.equal(variantWf.folds.length, folds.length);

  // --- step 6: stress the variant ----------------------------------------
  var suite = stressSuite.create({
    config: variantCfg, logger: loggerMod.nullLogger(), seed: 'integration-stress',
    severities: { monteCarloReplications: 150 },
    runVariant: function (override, label) {
      var stressed = configMod.load(configMod.deepMerge(stripDerived(configMod.serialise(variantCfg)), override));
      var r = runOne(stressed, data, label, split.outOfSample.range);
      return { metrics: r.metrics, trades: r.trades, timeline: r.timeline };
    }
  });
  var stress = suite.run({ baseline: { metrics: varOut.metrics, trades: varOut.trades } });
  assert.equal(typeof stress.survived, 'boolean');
  assert.ok(stress.scenariosRun >= 5);

  // --- step 7: compare ---------------------------------------------------
  var comparison = researcher.compare({
    baseline: { inSample: { metrics: baseIn.metrics }, outOfSample: { metrics: baseOut.metrics } },
    variant: {
      inSample: { metrics: varIn.metrics }, outOfSample: { metrics: varOut.metrics },
      walkForward: variantWf
    },
    stress: stress,
    hypothesis: research.hypotheses[0]
  });
  assert.ok(['APPROVE_AS_CHALLENGER', 'REJECT', 'INCONCLUSIVE'].indexOf(comparison.verdict) !== -1);
  assert.equal(comparison.authority, 'PROPOSAL_ONLY');
  assert.ok(comparison.findings.length >= 3);

  // --- step 8: register the challenger with BOUND evidence ---------------
  var store = storeMod.create({ runId: 'integration-governance' });
  var backtestMode = modeMod.create({ mode: 'BACKTEST' });
  var registry = championMod.create({
    store: store, modeController: backtestMode, logger: loggerMod.nullLogger(),
    rules: { minOutOfSampleTrades: 5 }, now: function () { return 1; }
  });
  registry.seedChampion({
    principal: OWNER, configHash: cfg.fingerprint.hash,
    basis: 'the Phase 9 baseline configuration, seeded as the first champion with no incumbent to compare against'
  });
  var challenger = registry.registerChallenger({
    principal: AGENT, configHash: variantCfg.fingerprint.hash,
    hypothesisId: research.hypotheses[0].hypothesisId, proposalId: proposal.proposalId
  });

  // Evidence from TWO segments, each bound to the variant's own config hash.
  attachAll(registry, challenger.recordId, variantCfg.fingerprint.hash, {
    inSample: varIn, outOfSample: varOut, stress: stress, wf: variantWf,
    championOut: baseOut, championHash: cfg.fingerprint.hash, registry: registry
  });

  // --- step 9: the promotion is REFUSED ---------------------------------
  var verdict = registry.dryRun(challenger.recordId);
  assert.equal(verdict.promotable, false,
    'a promotion cannot succeed in BACKTEST mode, because DEMO_COMPARISON is impossible there');
  assert.ok(verdict.blockers.some(function (b) { return b.code === 'EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE'; }),
    'blockers were: ' + verdict.blockers.map(function (b) { return b.code; }).join(', '));
  assert.deepEqual(verdict.unsatisfiableInCurrentMode, ['DEMO_COMPARISON']);
  assert.throws(function () { registry.promote({ recordId: challenger.recordId, principal: OWNER }); },
    /EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE/);
  assert.equal(registry.champion().configHash, cfg.fingerprint.hash, 'the champion must be unchanged');

  // The whole trail is on the record.
  assert.ok(store.table('champions').count() >= 1);
  assert.ok(store.table('challengers').count() >= 1);
  var refusals = registry.history().filter(function (h) { return h.event === 'PROMOTION_REFUSED'; });
  assert.equal(refusals.length, 1);
});

/** Removes the fields config.load() derives, so a serialised config can be re-merged. */
function stripDerived(serialised) {
  delete serialised.fingerprint;
  delete serialised.unreachableInstruments;
  return serialised;
}

/** Attaches the full §13 evidence set across two segments. */
function attachAll(registry, recordId, configHash, ctx) {
  var IS = 'in-sample';
  var OOS = 'out-of-sample';
  function add(kind, segment, passed, metrics) {
    registry.attachEvidence(recordId, {
      kind: kind, configHash: configHash, segment: segment, passed: passed, metrics: metrics || null
    });
  }
  add('BACKTEST', IS, true, ctx.inSample.metrics);
  add('OUT_OF_SAMPLE', OOS, true, ctx.outOfSample.metrics);
  add('WALK_FORWARD', OOS, ctx.wf.aggregate.folds > 0, { folds: ctx.wf.aggregate.folds });
  add('STRESS_SUITE', OOS, true, { scenariosRun: ctx.stress.scenariosRun });
  add('MONTE_CARLO', OOS, true, { replications: 150 });
  add('COST_MODEL_APPLIED', IS, ctx.inSample.metrics.totalCosts > 0, { totalCosts: ctx.inSample.metrics.totalCosts });
  add('DRAWDOWN_WITHIN_LIMIT', OOS, true, { maxDrawdownPct: ctx.outOfSample.metrics.maxDrawdownPct });
  add('LOSING_STREAK_WITHIN_LIMIT', OOS, true, { maxConsecutiveLosses: ctx.outOfSample.metrics.maxConsecutiveLosses });
  // The comparison, with deltas computed by the registry so the signs cannot drift.
  var cmp = ctx.registry.comparisonEvidence({
    configHash: configHash, segment: OOS,
    championMetrics: ctx.championOut.metrics, challengerMetrics: ctx.outOfSample.metrics,
    championConfigHash: ctx.championHash
  });
  // Forced to pass, because this test is about the GOVERNANCE path rather than about
  // whether an untuned strategy on synthetic data happens to beat another one.
  cmp.passed = true;
  cmp.metrics.expectancyDelta = 0.5;
  cmp.metrics.drawdownDeltaPct = -1;
  cmp.metrics.streakDelta = -1;
  cmp.metrics.outOfSampleTrades = Math.max(cmp.metrics.outOfSampleTrades, 30);
  registry.attachEvidence(recordId, cmp);
  add('DEMO_COMPARISON', OOS, true, { note: 'claimed from a paper session' });
}

// ---------------------------------------------------------------------------
// 3. The owner gate, end to end
// ---------------------------------------------------------------------------

test('every step an agent is forbidden from taking is refused end to end', function () {
  var cfg = configFor();
  var mc = modeMod.create({ mode: 'BACKTEST', configFingerprint: cfg.fingerprint.hash, commit: COMMIT });
  var registry = championMod.create({ logger: loggerMod.nullLogger() });

  // 1. An agent cannot raise the mode.
  assert.throws(function () {
    mc.transition({ to: 'PAPER', principal: AGENT, approval: { ownerApproval: true } });
  }, /only an OWNER principal may raise the execution mode/);
  assert.equal(mc.mode(), 'BACKTEST');

  // 2. An agent cannot seed or promote a champion.
  assert.throws(function () {
    registry.seedChampion({ principal: AGENT, configHash: cfg.fingerprint.hash, basis: 'a'.repeat(40) });
  }, /an AGENT principal may not seed the initial champion/);

  // 3. An agent cannot start a paper session, because it cannot reach PAPER.
  assert.throws(function () {
    sessionMod.create({
      modeController: mc,
      feed: feedMod.replay({ data: { EURUSD: barsFor('EURUSD', 20) }, timeframe: 'M15' }),
      arms: []
    });
  }, /cannot be created in BACKTEST mode/);

  // 4. Nothing can reach LIVE at all: there is no gate set for BACKTEST -> LIVE.
  assert.equal(gates.requiredFor('BACKTEST', 'LIVE'), null);
  assert.throws(function () {
    mc.transition({ to: 'LIVE', principal: OWNER, approval: { fromMode: 'BACKTEST', toMode: 'LIVE' } });
  }, /no gate set is defined for BACKTEST -> LIVE/);

  // 5. And PAPER -> LIVE needs gates this build cannot satisfy.
  var paper = approvePaper(cfg);
  var live = paper.dryRun('LIVE', null);
  assert.equal(live.ok, false);
  assert.equal(live.unsatisfiableGates.length, 3);
});

test('after the owner approves PAPER, a paper A/B session produces the missing demo evidence', function () {
  var championCfg = configFor({}, 'PAPER');
  var challengerCfg = configFor({ jev: { scoreThreshold: 70, minConfidence: 0.15 } }, 'PAPER');
  var mc = approvePaper(championCfg);
  assert.equal(mc.mode(), 'PAPER', 'the owner approval must actually have moved the mode');

  var data = {};
  SYMBOLS.forEach(function (s) { data[s] = barsFor(s, 900); });
  var t = 1700000000000;
  var session = sessionMod.create({
    modeController: mc,
    feed: feedMod.replay({ data: data, timeframe: 'M15' }),
    logger: loggerMod.nullLogger(),
    now: function () { return t += 1000; },
    heartbeatEveryTicks: 300,
    arms: [
      { label: 'champion', config: championCfg, hooks: tradingAgent.wire({ config: championCfg, logger: loggerMod.nullLogger() }).engineHooks },
      { label: 'challenger', config: challengerCfg, hooks: tradingAgent.wire({ config: challengerCfg, logger: loggerMod.nullLogger() }).engineHooks }
    ]
  });
  var res = session.run();

  assert.equal(res.mode, 'PAPER');
  assert.equal(res.arms.length, 2);
  assert.ok(res.comparison, 'a two-arm session must produce a comparison');
  assert.equal(res.comparison.sameFeed, true);
  assert.match(res.comparison.note, /does NOT call a winner/);
  res.arms.forEach(function (arm) {
    arm.trades.forEach(function (tr) { assert.equal(tr.paper, true); });
    assert.equal(arm.slot.verifyInvariant().ok, true);
  });

  // The demo evidence is now producible, and the registry accepts it in PAPER mode.
  var registry = championMod.create({
    modeController: mc, logger: loggerMod.nullLogger(),
    rules: { minOutOfSampleTrades: 1 }, now: function () { return 1; }
  });
  registry.seedChampion({
    principal: OWNER, configHash: championCfg.fingerprint.hash,
    basis: 'the champion configuration under paper comparison in the integration test'
  });
  var challenger = registry.registerChallenger({
    principal: AGENT, configHash: challengerCfg.fingerprint.hash
  });
  registry.attachEvidence(challenger.recordId, {
    kind: 'DEMO_COMPARISON', configHash: challengerCfg.fingerprint.hash, segment: 'paper-2026-09',
    passed: true, metrics: { netPnlDelta: res.comparison.netPnlDelta }
  });
  var v = registry.dryRun(challenger.recordId);
  assert.deepEqual(v.unsatisfiableInCurrentMode, [],
    'in PAPER mode nothing is unsatisfiable any more');
  assert.ok(!v.blockers.some(function (b) { return b.code === 'EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE'; }),
    'demo evidence produced in PAPER mode must be accepted');
  // It is still not promotable — the other nine kinds are missing, which is correct.
  assert.equal(v.promotable, false);
  assert.ok(v.evidenceMissing.length === 9);
});

test('a challenger with complete, two-segment evidence in PAPER mode promotes — and only for the owner', function () {
  var championCfg = configFor({}, 'PAPER');
  var challengerCfg = configFor({ jev: { scoreThreshold: 55, minConfidence: 0.15 } }, 'PAPER');
  var mc = approvePaper(championCfg);
  var registry = championMod.create({
    modeController: mc, logger: loggerMod.nullLogger(),
    rules: { minOutOfSampleTrades: 1 }, now: function () { return 1; }
  });
  registry.seedChampion({
    principal: OWNER, configHash: championCfg.fingerprint.hash,
    basis: 'seeded for the promotion path test, with no incumbent to compare against'
  });
  var challenger = registry.registerChallenger({ principal: AGENT, configHash: challengerCfg.fingerprint.hash });

  var hash = challengerCfg.fingerprint.hash;
  championMod.REQUIRED_EVIDENCE.forEach(function (kind, i) {
    registry.attachEvidence(challenger.recordId, {
      kind: kind, configHash: hash,
      segment: i % 2 === 0 ? 'oos-A' : 'oos-B', passed: true,
      metrics: kind === 'CHAMPION_COMPARISON'
        ? { expectancyDelta: 0.3, drawdownDeltaPct: -0.5, streakDelta: 0, outOfSampleTrades: 40 } : null
    });
  });

  assert.equal(registry.dryRun(challenger.recordId).promotable, true);
  // Still refused for an agent, with the evidence complete.
  assert.throws(function () { registry.promote({ recordId: challenger.recordId, principal: AGENT }); },
    /an AGENT principal may not promote/);
  var champ = registry.promote({ recordId: challenger.recordId, principal: OWNER, basis: 'integration path' });
  assert.equal(champ.configHash, hash);
  assert.equal(champ.origin, 'PROMOTED');
  assert.equal(champ.evidence.length, 10);
  assert.equal(champ.previousChampionConfigHash, championCfg.fingerprint.hash);

  // And it can be rolled back without new evidence.
  var back = registry.rollback({ principal: OWNER, reason: 'paper behaviour diverged' });
  assert.equal(back.configHash, championCfg.fingerprint.hash);
});

// ---------------------------------------------------------------------------
// 4. The §17 questions, from one real run
// ---------------------------------------------------------------------------

test('one real run answers every question mission §17 asks', function () {
  var cfg = configFor({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var run = runOne(cfg, rawData(), 'seventeen');
  var store = run.store;
  assert.ok(run.trades.length > 0, 'the run must have traded for these questions to have answers');

  // WHY DID IT ENTER? — candidate, Jev verdict with components, risk verdict.
  var t = run.trades[0];
  var cand = store.table('candidates').first('candidateId', t.candidateId);
  var jev = store.table('jev_decisions').first('candidateId', t.candidateId);
  var risk = store.table('risk_assessments').first('candidateId', t.candidateId);
  assert.ok(cand && jev && risk);
  assert.equal(jev.decision, 'ENTER');
  assert.equal(Object.keys(jev.components).length, 6);
  assert.ok(cand.reasonCodes.length > 0);
  assert.ok(cand.breakevenWinRate > 0, 'the candidate must record what win rate it needed to break even');
  assert.ok(risk.limitsChecked.length > 0);
  assert.equal(risk.approvedLots, t.lots, 'the trade must have used the approved size');

  // WHY DID IT REJECT? — by stage, with reason codes, for every rejection.
  var rejections = store.table('decisions').by('decision', 'NO_TRADE');
  assert.ok(rejections.length > 0);
  var stages = {};
  rejections.forEach(function (d) {
    assert.ok(enums.isValid(enums.PipelineStage, d.stage));
    assert.ok(d.reasonCodes.length > 0);
    stages[d.stage] = true;
  });
  assert.ok(Object.keys(stages).length >= 2, 'rejections came from only one stage: ' + Object.keys(stages));

  // WHY DID IT LOSE? — regime, Jev score, recovery level, exit reason.
  var losses = run.trades.filter(function (x) { return x.outcome === 'LOSS'; });
  assert.ok(losses.length > 0);
  losses.forEach(function (l) {
    assert.ok(enums.isValid(enums.Regime, l.regime));
    assert.ok(l.jevScore !== null && l.jevScore !== undefined);
    assert.ok(l.recoveryLevel !== undefined);
    assert.ok(enums.isValid(enums.ExitReason, l.exitReason));
    assert.equal(l.netPnl, money.money(l.grossPnl - l.costsMoney));
  });

  // WHY DID RECOVERY INCREASE? — the transition, with the size it wanted.
  var recoveryRows = store.table('recovery_states').all();
  if (recoveryRows.length) {
    recoveryRows.forEach(function (r) {
      assert.ok(r.reason, 'a recovery transition with no reason cannot answer the question');
      assert.ok(r.nextLotsUncapped !== undefined, 'the record must show what the ladder WANTED');
      assert.ok(r.level <= 2);
    });
  }

  // WHY DID RISK ENGINE BLOCK IT? — the named limit and its numbers.
  var blocks = store.table('risk_assessments').by('verdict', 'BLOCK');
  assert.ok(blocks.length > 0);
  blocks.forEach(function (b) {
    assert.ok(b.reasonCodes.length > 0);
    assert.ok(b.limitsChecked.some(function (l) { return l.binding; }) || b.reasonCodes.length > 0);
  });

  // WHY DID JEV REJECT IT? — score, band, components, flags.
  var jevRejects = store.table('jev_decisions').by('decision', 'REJECT');
  assert.ok(jevRejects.length > 0);
  jevRejects.forEach(function (j) {
    assert.ok(j.reasonCodes.length > 0);
    assert.ok(j.band !== undefined, 'a rejected candidate must still carry its band');
    assert.equal(Object.keys(j.components).length, 6);
  });

  // WHAT WAS THE MARKET DOING? — the regime with its features, per bar.
  var regimes = store.table('regimes').all();
  assert.equal(regimes.length, run.agent.counts().barsClassified);
  assert.ok(regimes[0].features.adx !== undefined);
});

// ---------------------------------------------------------------------------
// 5. Safety invariants, against a live system
// ---------------------------------------------------------------------------

test('across a multi-asset run with recovery on, every safety invariant holds', function () {
  var cfg = configFor({
    account: { initialCapital: 100 },
    recovery: { enabled: true, maxRecoveryLevel: 3 }
  });
  var run = runOne(cfg, rawData(), 'safety');

  // One trade at a time, reconstructed from the stored positions.
  var events = [];
  run.store.table('positions').all().forEach(function (p) {
    events.push({ ts: p.status === 'OPEN' ? p.entryTs : p.exitTs, delta: p.status === 'OPEN' ? 1 : -1 });
  });
  events.sort(function (a, b) { return a.ts - b.ts || b.delta - a.delta; });
  var open = 0;
  events.forEach(function (e) {
    open += e.delta;
    assert.ok(open <= 1 && open >= 0, 'the one-trade invariant broke');
  });
  assert.equal(run.slot.verifyInvariant().ok, true);

  // Every trade used the Risk-Engine-approved size, and no size exceeded the caps.
  run.trades.forEach(function (t) {
    var a = run.store.table('risk_assessments').first('candidateId', t.candidateId);
    assert.equal(t.lots, a.approvedLots);
    assert.ok(t.lots <= cfg.risk.maxPositionSizeLots + 1e-9);
    assert.ok(t.recoveryLevel <= 3);
  });

  // The recovery ladder never got past its cap.
  run.store.table('recovery_states').all().forEach(function (r) { assert.ok(r.level <= 3); });

  // Costs were charged on every trade.
  run.trades.forEach(function (t) { assert.ok(t.costsMoney > 0); });

  // And the health report agrees.
  var rep = healthMod.create({ config: cfg, logger: loggerMod.nullLogger() }).report({ run: run });
  assert.deepEqual(rep.failed, [], 'health failed: ' + JSON.stringify(rep.failed));
});

test('the whole platform is reproducible: two runs of one configuration agree exactly', function () {
  var cfg = configFor({ recovery: { enabled: true, maxRecoveryLevel: 2 } });
  var data = rawData(1200);
  var a = runOne(cfg, data, 'repro-x');
  var b = runOne(cfg, data, 'repro-x');
  assert.equal(a.digest(), b.digest(), 'the store digests must match');
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.agent.counts(), b.agent.counts());
  assert.deepEqual(
    a.trades.map(function (t) { return [t.symbol, t.entryTs, t.exitTs, t.lots, t.netPnl, t.recoveryLevel]; }),
    b.trades.map(function (t) { return [t.symbol, t.entryTs, t.exitTs, t.lots, t.netPnl, t.recoveryLevel]; })
  );
});

// ---------------------------------------------------------------------------
// 6. The CLI
// ---------------------------------------------------------------------------

test('the CLI exposes the commands it documents, and no mode flag', function () {
  assert.deepEqual(cliMod.COMMANDS.slice().sort(),
    ['analyse', 'backtest', 'health', 'help', 'research', 'status', 'stress', 'walkforward']);
  var parsed = cliMod.parseArgs(['backtest', '--bars', '500', '--recovery', '--json']);
  assert.equal(parsed.command, 'backtest');
  assert.equal(parsed.flags.bars, '500');
  assert.equal(parsed.flags.recovery, true);
  assert.equal(parsed.flags.json, true);
  // There is deliberately no way to set the mode from the command line.
  var cfg = cliMod.buildConfig({ symbols: 'EURUSD', capital: '100' });
  assert.equal(cfg.mode, 'BACKTEST');
  var withModeFlag = cliMod.buildConfig({ mode: 'PAPER', symbols: 'EURUSD' });
  assert.equal(withModeFlag.mode, 'BACKTEST',
    'a --mode flag must be ignored; the mode changes only through an owner-approval record');
});

test('the CLI builds a runnable configuration from its flags', function () {
  var cfg = cliMod.buildConfig({ symbols: 'EURUSD,XAUUSD', capital: '250', jev: '60', recovery: true, seed: 'x' });
  assert.deepEqual(cfg.universe, ['EURUSD', 'XAUUSD']);
  assert.equal(cfg.account.initialCapital, 250);
  assert.equal(cfg.jev.scoreThreshold, 60);
  assert.equal(cfg.recovery.enabled, true);
  assert.equal(cfg.backtest.seed, 'x');
  assert.ok(cfg.backtest.warmupBars > 200, 'the CLI must size the warmup from the agent, not guess');
});
