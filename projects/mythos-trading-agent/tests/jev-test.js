'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Jev decision gate tests
// projects/mythos-trading-agent/tests/jev-test.js
//
// What these tests are really protecting:
//
//   * the gate is AUDITABLE — every component of the score comes back with its
//     value and weight, so mission §17's "why did Jev reject it?" is answerable
//     from the record rather than from re-running the engine;
//   * score and confidence stay SEPARATE, so a high score resting on nothing
//     cannot pass on its own;
//   * hard flags override the score completely — a structurally unsound
//     candidate cannot be scored into acceptance;
//   * the gate has NO authority: the verdict object carries no size, no
//     execution instruction, and nothing that could overrule the Risk Engine.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var jevMod = require(path.join(SRC, 'jev', 'gate'));
var candidateMod = require(path.join(SRC, 'strategy', 'candidate'));
var costModelMod = require(path.join(SRC, 'cost', 'model'));
var configMod = require(path.join(SRC, 'config'));
var instrumentMod = require(path.join(SRC, 'core', 'instrument'));
var storeMod = require(path.join(SRC, 'db', 'store'));
var money = require(path.join(SRC, 'core', 'money'));

var CATALOG = instrumentMod.defaultCatalog();
var EUR = CATALOG.get('EURUSD');
var TS = Date.parse('2024-01-03T10:00:00Z');

function cfg(over) {
  return configMod.load(Object.assign({ cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } }, over || {}));
}

/**
 * A healthy baseline candidate: 20-pip stop, 50-pip target, typical spread.
 * Tests then damage exactly one thing at a time.
 */
function candidate(over, config) {
  var c = config || cfg();
  var o = over || {};
  var entry = o.entry === undefined ? 1.08 : o.entry;
  var stopPips = o.stopPips === undefined ? 20 : o.stopPips;
  var targetPips = o.targetPips === undefined ? 50 : o.targetPips;
  return candidateMod.build({
    candidateId: o.candidateId || 'c1',
    ts: TS,
    instrument: o.instrument || EUR,
    timeframe: 'M15',
    signal: {
      strategyId: o.strategyId || 'trend-following',
      direction: 'LONG',
      referencePrice: entry,
      stopLoss: money.round(entry - stopPips * (o.instrument || EUR).pipSize, (o.instrument || EUR).digits),
      takeProfit: money.round(entry + targetPips * (o.instrument || EUR).pipSize, (o.instrument || EUR).digits),
      confidence: o.strategyConfidence === undefined ? 0.6 : o.strategyConfidence,
      reasonCodes: ['TEST'],
      meta: {}
    },
    strategyFingerprint: { strategyId: o.strategyId || 'trend-following', version: 1, paramsHash: 'h' },
    regime: o.regime || 'TREND',
    regimeConfidence: o.regimeConfidence === undefined ? 0.7 : o.regimeConfidence,
    spreadPips: o.spreadPips === undefined ? 1.2 : o.spreadPips,
    costModel: costModelMod.create(c)
  });
}

function evaluate(over, config, inputOver) {
  var c = config || cfg();
  var gate = jevMod.create({ config: c, priors: (inputOver && inputOver.priors) || undefined });
  return gate.evaluate(Object.assign({
    candidate: candidate(over, c),
    instrument: (over && over.instrument) || EUR,
    regimeAligned: true,
    atr: 0.0018,
    recoveryLevel: 0,
    sessionQuality: 1
  }, inputOver || {}));
}

// ---------------------------------------------------------------------------
// 1. Shape and auditability
// ---------------------------------------------------------------------------

test('a verdict has exactly the shape mission §6 specifies', function () {
  var v = evaluate();
  assert.ok(v.score >= 0 && v.score <= 100);
  assert.ok(v.confidence >= 0 && v.confidence <= 1);
  assert.ok(v.decision === 'ENTER' || v.decision === 'REJECT');
  assert.ok(Array.isArray(v.reasonCodes));
  assert.ok(Array.isArray(v.riskFlags));
  assert.equal(v.model, 'heuristic-v1');
});

test('every scoring component is returned with its value and weight', function () {
  var v = evaluate();
  var expected = ['netRewardRisk', 'costEfficiency', 'regimeFit', 'strategyConviction', 'stopGeometry', 'history'];
  assert.deepEqual(Object.keys(v.components).sort(), expected.slice().sort());
  expected.forEach(function (k) {
    var comp = v.components[k];
    assert.ok(comp.value >= 0 && comp.value <= 1, k + ' value ' + comp.value);
    assert.equal(comp.weight, jevMod.WEIGHTS[k]);
    assert.ok(comp.raw !== undefined, k + ' has no raw input recorded');
  });
});

test('the component weights sum to exactly 1', function () {
  var total = 0;
  Object.keys(jevMod.WEIGHTS).forEach(function (k) { total += jevMod.WEIGHTS[k]; });
  assert.equal(money.round(total, 10), 1);
});

test('the score is reproducible from its own components', function () {
  var v = evaluate();
  var recomputed = 0;
  Object.keys(v.components).forEach(function (k) {
    recomputed += v.components[k].value * v.components[k].weight;
  });
  assert.equal(money.round(money.clamp(recomputed * 100, 0, 100), 4), v.score,
    'the recorded components must add up to the recorded score, or the audit trail lies');
});

test('the verdict satisfies the store and carries no authority', function () {
  var v = evaluate();
  storeMod.create({ runId: 'r' }).table('jev_decisions').insert(v);
  // A gate that could size or execute would be a second authority (ADR-0002).
  assert.equal(v.lots, undefined);
  assert.equal(v.size, undefined);
  assert.equal(v.approvedLots, undefined);
  assert.equal(v.execute, undefined);
  assert.equal(v.override, undefined);
});

test('an unknown model is refused rather than silently substituted', function () {
  assert.throws(function () { jevMod.create({ config: cfg({ jev: { model: 'neural-v9' } }) }); },
    /unknown Jev model "neural-v9"/);
});

test('the gate needs a candidate and an instrument', function () {
  var gate = jevMod.create({ config: cfg() });
  assert.throws(function () { gate.evaluate({}); }, /needs a candidate and its instrument/);
});

// ---------------------------------------------------------------------------
// 2. Scoring behaviour
// ---------------------------------------------------------------------------

test('a better net reward/risk scores higher', function () {
  var poor = evaluate({ targetPips: 22 });
  var good = evaluate({ targetPips: 80 });
  assert.ok(good.score > poor.score, good.score + ' vs ' + poor.score);
  assert.ok(good.components.netRewardRisk.value > poor.components.netRewardRisk.value);
  assert.ok(good.reasonCodes.indexOf('STRONG_NET_REWARD_RISK') !== -1);
});

test('a heavier cost relative to the risk scores lower and is flagged', function () {
  var cheap = evaluate({ stopPips: 60, spreadPips: 1.2 });
  var dear = evaluate({ stopPips: 6, spreadPips: 3.0 });
  assert.ok(dear.components.costEfficiency.value < cheap.components.costEfficiency.value);
  assert.ok(dear.riskFlags.indexOf('COST_HEAVY') !== -1);
  assert.ok(cheap.riskFlags.indexOf('COST_HEAVY') === -1);
});

test('regime misalignment lowers the score without zeroing the candidate', function () {
  var aligned = evaluate({}, null, { regimeAligned: true });
  var off = evaluate({}, null, { regimeAligned: false });
  assert.ok(off.score < aligned.score);
  assert.ok(off.components.regimeFit.value > 0,
    'an off-regime candidate must still score something, or the Research Agent can never learn which regimes suit which strategy');
  assert.ok(off.riskFlags.indexOf('OFF_REGIME') !== -1);
  assert.ok(off.reasonCodes.indexOf('REGIME_MISALIGNED') !== -1);
});

test('an uncertain regime reading lowers both the score and the confidence', function () {
  var sure = evaluate({ regimeConfidence: 0.9 });
  var unsure = evaluate({ regimeConfidence: 0.15 });
  assert.ok(unsure.score < sure.score);
  assert.ok(unsure.confidence < sure.confidence);
  assert.ok(unsure.riskFlags.indexOf('LOW_REGIME_CONFIDENCE') !== -1);
  assert.ok(unsure.reasonCodes.indexOf('REGIME_UNCERTAIN') !== -1);
});

test('stop geometry penalises stops that are too tight or too wide for the ATR', function () {
  // ATR 0.0018 = 18 pips.
  var sane = evaluate({ stopPips: 25 });         // 1.4 ATR
  var tight = evaluate({ stopPips: 4 });          // 0.22 ATR
  var wide = evaluate({ stopPips: 200 });         // 11 ATR
  assert.equal(sane.components.stopGeometry.value, 1);
  assert.ok(tight.components.stopGeometry.value < 0.5);
  assert.ok(wide.components.stopGeometry.value < 0.5);
  assert.ok(sane.reasonCodes.indexOf('STOP_WELL_PLACED') !== -1);
});

test('an unmeasured stop geometry scores neutral, never flattering', function () {
  var noAtr = evaluate({}, null, { atr: undefined });
  assert.equal(noAtr.components.stopGeometry.value, 0.5,
    'a component with no input must not contribute a full score');
  assert.equal(jevMod.stopGeometryScore(null, 20, EUR), 0.5);
  assert.equal(jevMod.stopGeometryScore(0, 20, EUR), 0.5);
});

test('the strategy conviction passes through', function () {
  var meek = evaluate({ strategyConfidence: 0.2 });
  var bold = evaluate({ strategyConfidence: 0.9 });
  assert.equal(meek.components.strategyConviction.value, 0.2);
  assert.equal(bold.components.strategyConviction.value, 0.9);
  assert.ok(bold.score > meek.score);
  assert.ok(meek.reasonCodes.indexOf('STRATEGY_CONVICTION_LOW') !== -1);
});

// ---------------------------------------------------------------------------
// 3. Hard flags override everything
// ---------------------------------------------------------------------------

test('a target inside the cost is rejected no matter how good it otherwise looks', function () {
  var v = evaluate({ stopPips: 40, targetPips: 1 });
  assert.equal(v.decision, 'REJECT');
  assert.ok(v.riskFlags.indexOf('NEGATIVE_NET_REWARD') !== -1);
  assert.deepEqual(v.hardFlags.indexOf('NEGATIVE_NET_REWARD') !== -1, true);
  assert.ok(v.reasonCodes.indexOf('HARD_FLAG_PRESENT') !== -1);
});

test('a spread above the configured multiple is a hard rejection', function () {
  var c = cfg({ risk: { maxSpreadMultiple: 2 } });
  var ok = evaluate({ spreadPips: 2.0 }, c);
  var bad = evaluate({ spreadPips: 3.0 }, c);
  assert.ok(ok.riskFlags.indexOf('SPREAD_ABOVE_LIMIT') === -1);
  assert.equal(bad.decision, 'REJECT');
  assert.ok(bad.riskFlags.indexOf('SPREAD_ABOVE_LIMIT') !== -1);
  // Between typical*1.5 and the limit it is a soft flag, not a rejection.
  var elevated = evaluate({ spreadPips: 1.9 }, c);
  assert.ok(elevated.riskFlags.indexOf('SPREAD_ELEVATED') !== -1);
  assert.ok(elevated.riskFlags.indexOf('SPREAD_ABOVE_LIMIT') === -1);
});

test('stops outside the configured bounds are hard rejections', function () {
  var c = cfg({ risk: { minStopPips: 5, maxStopPips: 100 } });
  assert.ok(evaluate({ stopPips: 3 }, c).riskFlags.indexOf('STOP_BELOW_MINIMUM') !== -1);
  assert.equal(evaluate({ stopPips: 3 }, c).decision, 'REJECT');
  assert.ok(evaluate({ stopPips: 150 }, c).riskFlags.indexOf('STOP_ABOVE_MAXIMUM') !== -1);
  assert.equal(evaluate({ stopPips: 150 }, c).decision, 'REJECT');
  assert.equal(evaluate({ stopPips: 40 }, c).riskFlags.length === 0 ||
    evaluate({ stopPips: 40 }, c).hardFlags.length, 0);
});

test('a reward/risk below the configured minimum is a hard rejection', function () {
  var c = cfg({ risk: { minRewardRisk: 1.5 } });
  var v = evaluate({ stopPips: 20, targetPips: 22 }, c);
  assert.ok(v.riskFlags.indexOf('REWARD_RISK_BELOW_MINIMUM') !== -1);
  assert.equal(v.decision, 'REJECT');
});

test('a hard flag cannot be outscored', function () {
  // Make every soft component excellent, then break one structural thing.
  var c = cfg({ risk: { maxSpreadMultiple: 2 }, jev: { scoreThreshold: 0, minConfidence: 0 } });
  var v = evaluate({ targetPips: 200, spreadPips: 5, regimeConfidence: 1, strategyConfidence: 1 }, c);
  assert.ok(v.score > 0);
  assert.equal(v.decision, 'REJECT', 'a threshold of zero must still not admit a hard-flagged candidate');
  assert.ok(v.hardFlags.length > 0);
});

// ---------------------------------------------------------------------------
// 4. Score and confidence are separate gates
// ---------------------------------------------------------------------------

test('a high score on thin evidence is rejected by the confidence gate', function () {
  var c = cfg({ jev: { scoreThreshold: 40, minConfidence: 0.75 } });
  var v = evaluate({ regimeConfidence: 0.2, spreadPips: 2.5 }, c);
  assert.ok(v.score >= 40, 'the setup must clear the score gate for this test to mean anything');
  assert.ok(v.confidence < 0.75);
  assert.equal(v.decision, 'REJECT');
  assert.ok(v.reasonCodes.indexOf('BELOW_CONFIDENCE_THRESHOLD') !== -1);
});

test('a confident but unattractive candidate is rejected by the score gate', function () {
  var c = cfg({ jev: { scoreThreshold: 85, minConfidence: 0.1 } });
  var v = evaluate({ targetPips: 25, strategyConfidence: 0.2 }, c);
  assert.ok(v.score < 85);
  assert.equal(v.decision, 'REJECT');
  assert.ok(v.reasonCodes.indexOf('BELOW_SCORE_THRESHOLD') !== -1);
});

test('both gates clear means ENTER', function () {
  var c = cfg({ jev: { scoreThreshold: 40, minConfidence: 0.3 } });
  var v = evaluate({ targetPips: 80, regimeConfidence: 0.9, strategyConfidence: 0.8 }, c);
  assert.equal(v.decision, 'ENTER');
  assert.ok(v.hardFlags.length === 0);
});

test('the threshold is configuration, not a constant', function () {
  var lenient = evaluate({}, cfg({ jev: { scoreThreshold: 10, minConfidence: 0 } }));
  var strict = evaluate({}, cfg({ jev: { scoreThreshold: 99, minConfidence: 0 } }));
  assert.equal(lenient.score, strict.score, 'the score must not depend on the threshold');
  assert.equal(lenient.decision, 'ENTER');
  assert.equal(strict.decision, 'REJECT');
  assert.equal(lenient.threshold, 10);
  assert.equal(strict.threshold, 99);
});

// ---------------------------------------------------------------------------
// 5. Bands — the research surface mission §6 asks for
// ---------------------------------------------------------------------------

test('the score band is recorded, including for rejected candidates', function () {
  var c = cfg({ jev: { scoreThreshold: 95 } });
  var v = evaluate({ targetPips: 80 }, c);
  assert.equal(v.decision, 'REJECT');
  assert.notEqual(v.band, undefined,
    'a rejected candidate must still carry its band, or the counterfactual is lost');
});

test('bandOf maps scores onto the configured bands', function () {
  var bands = configMod.load().jev.thresholdBands;
  assert.equal(jevMod.bandOf(75, bands), '70-79');
  assert.equal(jevMod.bandOf(80, bands), '80-89');
  assert.equal(jevMod.bandOf(94, bands), '90-94');
  assert.equal(jevMod.bandOf(100, bands), '95-100');
  assert.equal(jevMod.bandOf(50, bands), null, 'a score below every band belongs to none');
  var gate = jevMod.create({ config: configMod.load() });
  assert.equal(gate.bandOf(88), '80-89');
});

// ---------------------------------------------------------------------------
// 6. Priors — history that is absent must never flatter
// ---------------------------------------------------------------------------

test('with no history the prior is neutral, flagged and confidence-reducing', function () {
  var v = evaluate();
  assert.equal(v.components.history.value, 0.5);
  assert.equal(v.priorSampleSize, 0);
  assert.ok(v.riskFlags.indexOf('NO_STRATEGY_HISTORY') !== -1);
  assert.ok(v.reasonCodes.indexOf('NO_HISTORY') !== -1);
});

test('priorsFrom ignores a sample too small to mean anything', function () {
  var few = [];
  for (var i = 0; i < 5; i++) {
    few.push({ strategyId: 's', symbol: 'EURUSD', regime: 'TREND', outcome: 'WIN', netPnl: 4, riskMoney: 2 });
  }
  var priors = jevMod.priorsFrom(few, { minSample: 12 });
  var p = priors.lookup({ strategyId: 's', symbol: 'EURUSD', regime: 'TREND' });
  assert.equal(p.sampleSize, 0, 'five winning trades must not become a favourable prior');
  assert.equal(p.score, 0.5);
});

test('a favourable history raises the score, an unfavourable one lowers it', function () {
  function tradesWith(netPnl, outcome, n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push({
        strategyId: 'trend-following', symbol: 'EURUSD', regime: 'TREND',
        outcome: outcome, netPnl: netPnl, riskMoney: 2
      });
    }
    return out;
  }
  var good = jevMod.priorsFrom(tradesWith(1.0, 'WIN', 30));   // +0.5R each
  var bad = jevMod.priorsFrom(tradesWith(-1.0, 'LOSS', 30));  // -0.5R each

  var neutralV = evaluate();
  var goodV = evaluate({}, null, { priors: good });
  var badV = evaluate({}, null, { priors: bad });

  assert.ok(goodV.components.history.value > 0.9);
  assert.ok(badV.components.history.value < 0.1);
  assert.ok(goodV.score > neutralV.score);
  assert.ok(badV.score < neutralV.score);
  assert.ok(goodV.reasonCodes.indexOf('HISTORY_FAVOURABLE') !== -1);
  assert.ok(badV.reasonCodes.indexOf('HISTORY_UNFAVOURABLE') !== -1);
  assert.equal(goodV.priorSampleSize, 30);
});

test('a losing history subtracts exactly as much as a winning one adds', function () {
  // Symmetry matters: an asymmetric mapping would let history quietly become a
  // bullish bias that only ever raises scores.
  var up = jevMod.priorsFrom(repeat({ strategyId: 's', symbol: 'E', regime: 'TREND', outcome: 'WIN', netPnl: 0.6, riskMoney: 2 }, 20));
  var down = jevMod.priorsFrom(repeat({ strategyId: 's', symbol: 'E', regime: 'TREND', outcome: 'LOSS', netPnl: -0.6, riskMoney: 2 }, 20));
  var u = up.lookup({ strategyId: 's', symbol: 'E', regime: 'TREND' }).score;
  var d = down.lookup({ strategyId: 's', symbol: 'E', regime: 'TREND' }).score;
  assert.equal(money.round(u - 0.5, 6), money.round(0.5 - d, 6));

  function repeat(t, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(t);
    return out;
  }
});

test('priors resolve most-specific-first and fall back cleanly', function () {
  var trades = [];
  for (var i = 0; i < 20; i++) {
    trades.push({ strategyId: 's', symbol: 'EURUSD', regime: 'TREND', outcome: 'WIN', netPnl: 1, riskMoney: 2 });
  }
  for (var j = 0; j < 20; j++) {
    trades.push({ strategyId: 's', symbol: 'XAUUSD', regime: 'RANGE', outcome: 'LOSS', netPnl: -1, riskMoney: 2 });
  }
  var priors = jevMod.priorsFrom(trades, { minSample: 12 });
  var exact = priors.lookup({ strategyId: 's', symbol: 'EURUSD', regime: 'TREND' });
  assert.equal(exact.sampleSize, 20);
  assert.ok(exact.score > 0.9);
  // Unknown symbol in a known regime falls back to (strategy, regime).
  var fallback = priors.lookup({ strategyId: 's', symbol: 'GBPUSD', regime: 'TREND' });
  assert.equal(fallback.sampleSize, 20);
  // Unknown regime falls back to the strategy's overall record (40 trades).
  var broad = priors.lookup({ strategyId: 's', symbol: 'GBPUSD', regime: 'BREAKOUT' });
  assert.equal(broad.sampleSize, 40);
  assert.equal(money.round(broad.score, 3), 0.5, 'twenty wins and twenty equal losses is break-even');
  // Unknown strategy knows nothing.
  assert.equal(priors.lookup({ strategyId: 'other', symbol: 'EURUSD', regime: 'TREND' }).sampleSize, 0);
});

// ---------------------------------------------------------------------------
// 7. Cross-instrument sanity
// ---------------------------------------------------------------------------

test('an equivalent setup scores comparably on gold and on EURUSD', function () {
  // The gate must not have a hidden instrument bias: a 1.5-ATR stop at 2.5 R
  // should score about the same whatever the contract size.
  var gold = CATALOG.get('XAUUSD');
  var eurV = evaluate({ stopPips: 27, targetPips: 67.5, spreadPips: 1.2 }, null, { atr: 0.0018 });
  var goldV = evaluate(
    { instrument: gold, entry: 2300, stopPips: 450, targetPips: 1125, spreadPips: 28 },
    null,
    { instrument: gold, atr: 3.0 }
  );
  assert.ok(Math.abs(eurV.score - goldV.score) < 8,
    'EURUSD scored ' + eurV.score + ' and gold ' + goldV.score + ' for an equivalent setup');
  assert.equal(eurV.components.stopGeometry.value, goldV.components.stopGeometry.value);
});

test('recovery being active is flagged but is not itself a rejection', function () {
  var v = evaluate({}, cfg({ jev: { scoreThreshold: 10, minConfidence: 0 } }), { recoveryLevel: 2 });
  assert.ok(v.riskFlags.indexOf('RECOVERY_ACTIVE') !== -1);
  assert.equal(v.decision, 'ENTER',
    'Jev records that recovery is active; capping it is the Risk Engine\'s job, not a score adjustment');
});

test('a thin session is flagged and reduces confidence', function () {
  var main = evaluate({}, null, { sessionQuality: 1 });
  var thin = evaluate({}, null, { sessionQuality: 0.3 });
  assert.ok(thin.riskFlags.indexOf('THIN_SESSION') !== -1);
  assert.ok(thin.confidence < main.confidence);
});
