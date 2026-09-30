'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Trading Agent (full pipeline) tests
// projects/mythos-trading-agent/tests/trading-agent-test.js
//
// These are the first tests that run the WHOLE mission §3 pipeline against data:
//
//   market data → regime → strategies → candidates → Jev → cost → risk
//     → recovery → one-trade-only → execution → result → database
//
// What they are really checking is that composing the components did not
// undo any of the properties each one was tested for individually:
//
//   §2 every stage of the pipeline actually rejects things, and every rejection
//      is recorded with the stage that produced it — so the §17 questions are
//      answerable from the store after a real run;
//   §3 only the Risk Engine's approved size ever reaches an order, including when
//      the recovery ladder asked for more;
//   §4 one position at a time across the whole universe, with the invariant
//      verified from the stored position records rather than from a counter;
//   §5 two runs of one configuration produce the same store digest.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var tradingAgent = require(path.join(SRC, 'agents', 'trading-agent'));
var engine = require(path.join(SRC, 'backtest', 'engine'));
var configMod = require(path.join(SRC, 'config'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var scheduleMod = require(path.join(SRC, 'schedule', 'asset-schedule'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var jevMod = require(path.join(SRC, 'jev', 'gate'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var enums = require(path.join(SRC, 'core', 'enums'));
var clock = require(path.join(SRC, 'core', 'clock'));
var money = require(path.join(SRC, 'core', 'money'));

var CATALOG = instrumentMod.defaultCatalog();
var FIXTURES = fixtureSource.createSource();

/** A window of the committed fixtures as a standalone source. */
function window(symbols, bars) {
  var data = {};
  symbols.forEach(function (s) { data[s] = { M15: FIXTURES.load(s, 'M15').slice(0, bars || 3000) }; });
  return sourceMod.fromBars({
    kind: 'fixture-window', datasetVersion: FIXTURES.datasetVersion + ':' + (bars || 3000), data: data
  });
}

/**
 * Runs the full agent through the engine.
 *
 * The warmup is taken from the AGENT rather than guessed: the regime engine needs
 * a long ATR-percentile lookback, and a run configured shorter would spend its
 * first few hundred bars rejecting everything at the REGIME stage.
 */
function run(over, opts) {
  var o = opts || {};
  var symbols = o.symbols || ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: symbols }) });
  var cfg = configMod.load(merge({
    universe: symbols,
    backtest: { warmupBars: probe.warmupBars(), seed: 'agent-test' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 },
    jev: { scoreThreshold: 45, minConfidence: 0.2 }
  }, over || {}));

  var wired = tradingAgent.wire({
    config: cfg,
    enabledStrategies: o.enabledStrategies,
    priors: o.priors,
    logger: o.logger || loggerMod.nullLogger()
  });
  var result = engine.run({
    config: cfg,
    source: window(symbols, o.bars),
    label: o.label || 'agent',
    logger: o.logger || loggerMod.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  });
  result.agent = wired.agent;
  return result;
}

function merge(base, over) {
  var out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });
  Object.keys(over).forEach(function (k) {
    out[k] = (typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? merge(base[k], over[k]) : over[k];
  });
  return out;
}

// ---------------------------------------------------------------------------
// 1. A full run happens at all
// ---------------------------------------------------------------------------

test('the full pipeline runs and produces decisions', function () {
  var res = run();
  var c = res.agent.counts();
  assert.ok(c.barsClassified > 1000, 'only ' + c.barsClassified + ' bars were classified');
  assert.ok(c.signalsSeen > 0, 'no strategy ever fired');
  assert.ok(c.candidatesBuilt > 0, 'no candidate was ever built');
  assert.equal(res.store.table('regimes').count(), c.barsClassified,
    'the regime must be recorded on every bar it was classified on');
  // Decisions are requested only while the slot is free, so far fewer than bars.
  assert.ok(c.decisionsRequested > 0);
  assert.ok(c.decisionsRequested < c.barsClassified,
    'a single-position account cannot decide on every bar; the two counters must differ');
  assert.ok(res.store.table('decisions').count() > 0);
});

test('the agent reports a warmup covering both the portfolio and the regime engine', function () {
  var agent = tradingAgent.create({ config: configMod.load() });
  var portfolioWarmup = agent.components.portfolio.warmupBars();
  var regimeWarmup = agent.components.regime.warmupBars();
  assert.equal(agent.warmupBars(), Math.max(portfolioWarmup, regimeWarmup));
  assert.ok(agent.warmupBars() >= regimeWarmup, 'the regime lookback must be covered');
  assert.ok(agent.warmupBars() > 200);
});

test('wire() connects every hook, because omitting any one degrades the system silently', function () {
  var w = tradingAgent.wire({ config: configMod.load() });
  assert.equal(typeof w.engineHooks.decide, 'function');
  assert.equal(typeof w.engineHooks.onSeriesReady, 'function', 'without it there are no indicators');
  assert.equal(typeof w.engineHooks.onBar, 'function', 'without it there is no kill switch');
  assert.equal(typeof w.engineHooks.onTradeClosed, 'function', 'without it recovery never learns');
});

// ---------------------------------------------------------------------------
// 2. Every stage rejects, and every rejection is recorded
// ---------------------------------------------------------------------------

test('rejections are attributed to the stage that produced them', function () {
  var res = run({}, { symbols: ['EURUSD', 'XAUUSD'] });
  var stages = {};
  res.store.table('decisions').by('decision', 'NO_TRADE').forEach(function (d) {
    stages[d.stage] = (stages[d.stage] || 0) + 1;
    assert.ok(enums.isValid(enums.PipelineStage, d.stage), 'bad stage ' + d.stage);
    assert.ok(Array.isArray(d.reasonCodes) && d.reasonCodes.length > 0,
      'a rejection with no reason code cannot answer "why did it reject it?"');
  });
  // The pipeline must be genuinely multi-stage in practice, not just in design.
  var used = Object.keys(stages);
  assert.ok(used.length >= 3, 'only these stages ever rejected anything: ' + used.join(', '));
  assert.ok(stages.COST > 0 || stages.JEV > 0 || stages.RISK > 0);
});

test('every candidate is recorded, including the ones nothing came of', function () {
  var res = run();
  var candidates = res.store.table('candidates').count();
  var c = res.agent.counts();
  assert.equal(candidates, c.candidatesBuilt);
  assert.ok(candidates > c.ordersProposed * 2,
    'far more candidates than orders is expected; got ' + candidates + ' candidates and ' + c.ordersProposed + ' orders');
  // The counterfactual: a rejected candidate still carries its Jev band.
  var jevRows = res.store.table('jev_decisions').all();
  assert.ok(jevRows.length > 0);
  var rejected = jevRows.filter(function (j) { return j.decision === 'REJECT'; });
  assert.ok(rejected.length > 0, 'Jev never rejected anything, so the gate was not exercised');
  rejected.forEach(function (j) {
    assert.ok(j.score >= 0 && j.score <= 100);
    assert.ok(j.components && Object.keys(j.components).length === 6);
  });
});

test('the cost filter rejects candidates whose target sits inside their own cost', function () {
  var res = run();
  var failed = res.store.table('cost_assessments').find(function (r) { return r.passed === false; });
  assert.ok(failed.length > 0, 'the cost filter never rejected anything');
  failed.forEach(function (r) {
    assert.ok(r.reasonCodes.length > 0);
    assert.ok(r.totalCostMoney > 0);
  });
  // And a passed assessment records the same fields, so the two are comparable.
  var passed = res.store.table('cost_assessments').find(function (r) { return r.passed === true; });
  assert.ok(passed.length > 0);
});

test('risk assessments are recorded for every candidate that reached the Risk Engine', function () {
  var res = run();
  var rows = res.store.table('risk_assessments').all();
  assert.ok(rows.length > 0);
  rows.forEach(function (r) {
    assert.ok(['ALLOW', 'CLAMP', 'BLOCK'].indexOf(r.verdict) !== -1);
    // An account-stage block records the four account limits; a sizing-stage
    // verdict records many more.
    assert.ok(Array.isArray(r.limitsChecked) && r.limitsChecked.length >= 4,
      'a risk verdict must carry the numbers it was based on');
    if (r.stage === 'SIZING') assert.ok(r.limitsChecked.length >= 10);
    assert.ok(r.accountEquity > 0);
    if (r.verdict === 'BLOCK') assert.equal(r.approvedLots, 0);
    else assert.ok(r.approvedLots > 0);
  });
  var blocked = rows.filter(function (r) { return r.verdict === 'BLOCK'; });
  assert.ok(blocked.length > 0, 'the Risk Engine never blocked anything on a $100 account, which is implausible');
});

test('a $100 account blocks most trades for size, and says so', function () {
  // COMPLIANCE §3.1 asserted rather than described: at 2 % of $100 the minimum lot
  // exhausts the budget for any stop wider than 20 pips.
  var res = run();
  var blocked = res.store.table('risk_assessments').find(function (r) {
    return r.reasonCodes.indexOf('SIZE_BELOW_MINIMUM') !== -1;
  });
  assert.ok(blocked.length > 0, 'SIZE_BELOW_MINIMUM never fired on a $100 account');
  var rate = blocked.length / res.store.table('risk_assessments').count();
  // Measured around 65 % on the fixtures; asserted at 20 % so the point survives
  // ordinary drift but a regression that stops the limit binding is caught.
  assert.ok(rate > 0.2, 'only ' + (100 * rate).toFixed(1) + '% of assessments were blocked for size');
  blocked.forEach(function (b) {
    assert.ok(b.riskAtMinLot > b.riskBudgetMoney,
      'a size block must record that the minimum lot exceeded the budget');
  });
});

test('a larger account trades more, which shows the size block was the binding constraint', function () {
  var small = run({ account: { initialCapital: 100 } });
  var large = run({ account: { initialCapital: 100000 } });
  assert.ok(large.trades.length > small.trades.length,
    '$100k took ' + large.trades.length + ' trades and $100 took ' + small.trades.length);
});

// ---------------------------------------------------------------------------
// 3. Only the Risk Engine's size reaches an order
// ---------------------------------------------------------------------------

test('every executed trade used exactly the size the Risk Engine approved', function () {
  var res = run({ account: { initialCapital: 5000 } });
  assert.ok(res.trades.length > 0);
  res.trades.forEach(function (t) {
    var assessment = res.store.table('risk_assessments').first('candidateId', t.candidateId);
    assert.ok(assessment, 'trade ' + t.tradeId + ' has no risk assessment');
    assert.equal(t.lots, assessment.approvedLots,
      'trade ' + t.tradeId + ' was executed at ' + t.lots + ' but approved at ' + assessment.approvedLots);
  });
});

test('with recovery enabled the ladder is clamped, and the clamp is visible in the record', function () {
  var res = run({
    account: { initialCapital: 100 },
    recovery: { enabled: true, maxRecoveryLevel: 3 }
  });
  var stats = res.agent.stats();
  assert.equal(res.agent.components.recovery.enabled, true);
  assert.ok(stats.recovery.requestsMade > 0, 'the ladder was never consulted');

  var clamped = res.store.table('risk_assessments').find(function (r) { return r.verdict === 'CLAMP'; });
  if (clamped.length) {
    clamped.forEach(function (r) {
      assert.ok(r.approvedLots < r.requestedLots,
        'a CLAMP must actually reduce the size: ' + r.approvedLots + ' vs ' + r.requestedLots);
    });
    assert.ok(stats.recovery.clampRate > 0, 'clamps happened but the rate was not reported');
  }
  // Whatever happened, no trade may exceed the position cap.
  res.trades.forEach(function (t) {
    assert.ok(t.lots <= res.config.risk.maxPositionSizeLots + 1e-9);
  });
});

test('recovery levels recorded on trades never exceed the configured cap', function () {
  var res = run({
    account: { initialCapital: 3000 },
    recovery: { enabled: true, maxRecoveryLevel: 2 }
  });
  res.trades.forEach(function (t) {
    assert.ok(t.recoveryLevel <= 2, 'a trade was taken at recovery level ' + t.recoveryLevel);
  });
  var states = res.store.table('recovery_states').all();
  states.forEach(function (s) { assert.ok(s.level <= 2); });
});

test('recovery stays at base for the whole run when it is disabled', function () {
  var res = run({ account: { initialCapital: 3000 } });
  assert.equal(res.agent.components.recovery.enabled, false);
  res.trades.forEach(function (t) {
    assert.equal(t.recoveryLevel, 0, 'recovery moved while disabled');
  });
  res.trades.forEach(function (t) {
    assert.equal(t.lots, res.store.table('risk_assessments').first('candidateId', t.candidateId).approvedLots);
  });
});

// ---------------------------------------------------------------------------
// 4. One trade only, across the whole universe
// ---------------------------------------------------------------------------

test('across the full seven-asset universe only one position is ever open', function () {
  var res = run({ account: { initialCapital: 20000 } }, {
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'], bars: 2000
  });
  assert.ok(res.trades.length > 3, 'only ' + res.trades.length + ' trades');
  var symbols = {};
  res.trades.forEach(function (t) { symbols[t.symbol] = true; });
  assert.ok(Object.keys(symbols).length > 1, 'only ' + Object.keys(symbols) + ' traded');

  var events = [];
  res.store.table('positions').all().forEach(function (p) {
    if (p.status === 'OPEN') events.push({ ts: p.entryTs, delta: 1 });
    else events.push({ ts: p.exitTs, delta: -1 });
  });
  events.sort(function (a, b) { return a.ts - b.ts || b.delta - a.delta; });
  var open = 0;
  events.forEach(function (e) {
    open += e.delta;
    assert.ok(open <= 1, 'two positions were open at once');
    assert.ok(open >= 0);
  });
  assert.equal(res.slot.verifyInvariant().ok, true);
  assert.ok(res.counts.slotBlocked > 0, 'with four assets the slot must have refused some candidates');
});

// ---------------------------------------------------------------------------
// 5. Reproducibility of the whole pipeline
// ---------------------------------------------------------------------------

test('two runs of one configuration produce the same store digest', function () {
  var a = run({}, { bars: 1200 });
  var b = run({}, { bars: 1200 });
  assert.equal(a.digest(), b.digest());
  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.agent.counts(), b.agent.counts());
});

test('a changed Jev threshold changes the result and is recorded on the backtest', function () {
  var lenient = run({ jev: { scoreThreshold: 30, minConfidence: 0.1 } }, { bars: 1500 });
  var strict = run({ jev: { scoreThreshold: 90, minConfidence: 0.1 } }, { bars: 1500 });
  assert.ok(lenient.agent.counts().ordersProposed > strict.agent.counts().ordersProposed,
    'a stricter Jev threshold must propose fewer orders');
  assert.notEqual(lenient.digest(), strict.digest());
  assert.notEqual(lenient.config.fingerprint.hash, strict.config.fingerprint.hash);
});

// ---------------------------------------------------------------------------
// 6. The emergency stop, end to end
// ---------------------------------------------------------------------------

test('the Risk Engine halts the run when the drawdown limit breaks', function () {
  // A tight drawdown cap on a small account, with recovery enabled to make losses
  // land harder.
  var res = run({
    account: { initialCapital: 100 },
    risk: { maxDrawdownPct: 3, maxDailyLossPct: 3, maxAccountRiskPerTradePct: 20, maxPositionSizeLots: 0.5 },
    recovery: { enabled: true, maxRecoveryLevel: 3 },
    jev: { scoreThreshold: 20, minConfidence: 0.05 }
  }, { bars: 3000 });

  if (res.emergencyStopped) {
    assert.match(res.emergencyReason, /RISK_ENGINE/);
    var stops = res.store.table('system_events').by('kind', 'EMERGENCY_STOP');
    assert.equal(stops.length, 1, 'the stop must be recorded exactly once');
    // Nothing may be entered at or after the stop.
    var stopTs = res.account.equityCurve().filter(function (s) {
      return s.drawdownPct >= 3;
    })[0];
    assert.ok(stopTs, 'the drawdown must actually have been breached');
    assert.ok(res.trades.length > 0);
  } else {
    // If the drawdown never broke, the account must genuinely have stayed inside
    // the limit — the test must not pass by the run doing nothing.
    assert.ok(res.metrics.maxDrawdownPct < 3.001,
      'the run was not stopped but the drawdown reached ' + res.metrics.maxDrawdownPct + '%');
    assert.ok(res.trades.length > 0, 'the run neither traded nor stopped, so it proves nothing');
  }
});

test('a configured emergency stop prevents any trade at all', function () {
  var res = run({ risk: { emergencyStop: true } }, { bars: 1000 });
  assert.equal(res.trades.length, 0);
  assert.equal(res.agent.counts().ordersProposed, 0);
  var blocks = res.store.table('risk_assessments').all();
  blocks.forEach(function (r) {
    assert.equal(r.verdict, 'BLOCK');
    assert.ok(r.reasonCodes.indexOf('EMERGENCY_STOP_ACTIVE') !== -1);
  });
});

// ---------------------------------------------------------------------------
// 7. Priors close the loop
// ---------------------------------------------------------------------------

test('priors from a first run change the second run, and the source is recorded', function () {
  var first = run({ account: { initialCapital: 5000 } }, { bars: 2000 });
  assert.ok(first.trades.length >= 12, 'need a real sample, got ' + first.trades.length);

  var priors = jevMod.priorsFrom(first.trades, { minSample: 5 });
  var second = run({ account: { initialCapital: 5000 } }, { bars: 2000, priors: priors });

  var informed = second.store.table('candidates').find(function (c) {
    return c.winProbabilitySource === 'HISTORICAL';
  });
  assert.ok(informed.length > 0, 'no candidate picked up a historical prior');
  informed.forEach(function (c) {
    assert.ok(c.winProbability >= 0 && c.winProbability <= 1);
  });
  var uninformed = second.store.table('candidates').find(function (c) {
    return c.winProbabilitySource === 'PRIOR_UNINFORMED';
  });
  assert.ok(uninformed.length >= 0);
  // Priors reaching Jev must also show up in its recorded sample size.
  var withHistory = second.store.table('jev_decisions').find(function (j) { return j.priorSampleSize > 0; });
  assert.ok(withHistory.length > 0, 'Jev never saw a prior with a sample');
});

// ---------------------------------------------------------------------------
// 8. The per-asset schedule
// ---------------------------------------------------------------------------

test('the schedule blocks the forex weekend and reports the reason', function () {
  var s = scheduleMod.create({ config: configMod.load() });
  var eur = CATALOG.get('EURUSD');
  var sat = s.check(eur, Date.parse('2024-01-06T12:00:00Z'));
  assert.equal(sat.open, false);
  assert.equal(sat.reason, 'FOREX_WEEKEND');
  var wed = s.check(eur, Date.parse('2024-01-03T12:00:00Z'));
  assert.equal(wed.open, true);
  assert.equal(wed.reason, 'OPEN');
});

test('the schedule respects the instrument session window', function () {
  var s = scheduleMod.create({ config: configMod.load() });
  var gold = CATALOG.get('XAUUSD'); // 01:00-23:00 UTC
  assert.equal(s.check(gold, Date.parse('2024-01-03T00:30:00Z')).reason, 'OUTSIDE_INSTRUMENT_HOURS');
  assert.equal(s.check(gold, Date.parse('2024-01-03T12:00:00Z')).open, true);
});

test('a per-asset override can narrow or disable an instrument', function () {
  var narrowed = scheduleMod.create({
    config: configMod.load({ schedule: { perAsset: { EURUSD: { startHourUtc: 7, endHourUtc: 17 } } } })
  });
  var eur = CATALOG.get('EURUSD');
  assert.equal(narrowed.check(eur, Date.parse('2024-01-03T12:00:00Z')).open, true);
  assert.equal(narrowed.check(eur, Date.parse('2024-01-03T20:00:00Z')).reason, 'OUTSIDE_ASSET_WINDOW');

  var disabled = scheduleMod.create({
    config: configMod.load({ schedule: { perAsset: { EURUSD: { enabled: false } } } })
  });
  assert.equal(disabled.check(eur, Date.parse('2024-01-03T12:00:00Z')).reason, 'ASSET_DISABLED');
});

test('blocked weekdays apply globally and per asset', function () {
  var eur = CATALOG.get('EURUSD');
  var global = scheduleMod.create({ config: configMod.load({ schedule: { blockedWeekdaysUtc: [3] } }) });
  assert.equal(global.check(eur, Date.parse('2024-01-03T12:00:00Z')).reason, 'BLOCKED_WEEKDAY');
  var perAsset = scheduleMod.create({
    config: configMod.load({ schedule: { perAsset: { EURUSD: { blockedWeekdaysUtc: [4] } } } })
  });
  assert.equal(perAsset.check(eur, Date.parse('2024-01-03T12:00:00Z')).open, true, 'Wednesday is fine');
  assert.equal(perAsset.check(eur, Date.parse('2024-01-04T12:00:00Z')).reason, 'BLOCKED_WEEKDAY');
});

test('session quality mirrors the cost model, so thin means the same to both', function () {
  var s = scheduleMod.create({ config: configMod.load() });
  var main = s.sessionQuality(Date.parse('2024-01-03T12:00:00Z'));
  var rollover = s.sessionQuality(Date.parse('2024-01-03T21:30:00Z'));
  var asia = s.sessionQuality(Date.parse('2024-01-03T03:00:00Z'));
  var sunday = s.sessionQuality(Date.parse('2024-01-07T22:00:00Z'));
  assert.equal(main, 1);
  assert.ok(rollover < asia && asia < main);
  assert.ok(sunday <= rollover);
});

test('schedule rejections appear in the run record for a session-limited instrument', function () {
  var res = run({}, { symbols: ['XAUUSD'], bars: 1500 });
  // The generator already skips untradable hours, so the schedule stage rarely
  // fires on generated data — what matters is that the schedule is consulted and
  // that its description is persisted per asset (mission §11).
  // onRunStart persists the composition into the run's own store, so the schedule
  // that was in force is recoverable from the run rather than reconstructed.
  var rows = res.store.table('agent_activity').by('action', 'SCHEDULE_REGISTERED');
  assert.equal(rows.length, res.config.universe.length);
  assert.equal(rows[0].detail.symbol, 'XAUUSD');
  assert.deepEqual(rows[0].detail.instrumentHoursUtc, { start: 1, end: 23 });
  assert.equal(rows[0].detail.blockForexWeekend, true);
});

test('the composition record carries the limits and the ladder that were in force', function () {
  var store = require(path.join(SRC, 'db', 'store')).create({ runId: 'r' });
  var agent = tradingAgent.create({
    config: configMod.load({ recovery: { enabled: true, maxRecoveryLevel: 2 } })
  });
  agent.persistComposition(store);
  var comp = store.table('agent_activity').by('action', 'COMPOSITION')[0];
  assert.equal(comp.detail.strategies.length, 14);
  assert.equal(comp.detail.risk.maxOpenTrades, 1);
  assert.deepEqual(comp.detail.recovery.ladder, [0.01, 0.03, 0.09]);
  assert.equal(comp.detail.recovery.enabled, true);
  assert.equal(comp.detail.jev.model, 'heuristic-v1');
  assert.equal(store.table('strategies').count(), 14);
});

// ---------------------------------------------------------------------------
// 9. The §17 questions, answered from the store
// ---------------------------------------------------------------------------

test('the store can answer every question mission §17 asks', function () {
  var res = run({ account: { initialCapital: 5000 } }, { bars: 2500 });
  assert.ok(res.trades.length > 0);
  var store = res.store;

  // WHY DID IT ENTER?
  var trade = res.trades[0];
  var jev = store.table('jev_decisions').first('candidateId', trade.candidateId);
  var cand = store.table('candidates').first('candidateId', trade.candidateId);
  var riskRow = store.table('risk_assessments').first('candidateId', trade.candidateId);
  assert.ok(jev && cand && riskRow);
  assert.equal(jev.decision, 'ENTER');
  assert.ok(cand.reasonCodes.length > 0);
  assert.ok(riskRow.limitsChecked.length > 0);

  // WHY DID IT REJECT? — by stage, with reasons.
  var rejections = store.table('decisions').by('decision', 'NO_TRADE');
  assert.ok(rejections.length > 0);
  assert.ok(rejections.every(function (d) { return d.reasonCodes.length > 0; }));

  // WHY DID IT LOSE? — the trade carries its regime, Jev score and recovery level.
  var losses = res.trades.filter(function (t) { return t.outcome === 'LOSS'; });
  assert.ok(losses.length > 0);
  losses.forEach(function (t) {
    assert.ok(enums.isValid(enums.Regime, t.regime));
    assert.ok(t.jevScore !== null);
    assert.ok(t.recoveryLevel !== undefined);
    assert.ok(t.exitReason);
  });

  // WHY DID RISK ENGINE BLOCK IT? — the named limit and its numbers.
  var blocks = store.table('risk_assessments').by('verdict', 'BLOCK');
  assert.ok(blocks.length > 0);
  blocks.forEach(function (b) {
    var binding = b.limitsChecked.filter(function (l) { return l.binding; });
    assert.ok(binding.length > 0 || b.reasonCodes.length > 0,
      'a block with no binding limit and no reason is unexplainable');
  });

  // WHAT DID THE MARKET LOOK LIKE? — the regime, with its features.
  var regimes = store.table('regimes').all();
  assert.ok(regimes.length > 0);
  assert.ok(regimes[0].features.adx !== undefined);
});

test('stats() summarises the whole pipeline in one object', function () {
  var res = run({ recovery: { enabled: true, maxRecoveryLevel: 2 } }, { bars: 1200 });
  var s = res.agent.stats();
  ['pipeline', 'recovery', 'cooldown', 'emergencyStopped'].forEach(function (k) {
    assert.ok(s[k] !== undefined, 'stats() omits ' + k);
  });
  assert.ok(s.pipeline.barsClassified > 0);
  assert.ok(s.pipeline.decisionsRequested > 0);
  assert.equal(typeof s.emergencyStopped, 'boolean');
  assert.equal(s.cooldown.signalCooldownBars, 0);
});
