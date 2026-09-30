'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Monte Carlo over realised trades
// projects/mythos-trading-agent/src/stress/monte-carlo.js
//
// Mission §15 asks for Monte Carlo trade-order randomisation, to "determine
// survival characteristics". This module does that, and it is important to be
// exact about what the answer is worth, because the technique is routinely
// oversold.
//
// WHAT REORDERING ASSUMES, AND WHERE THAT ASSUMPTION IS FALSE
//
// Shuffling realised trades asks: "if the same trades had arrived in a different
// order, how bad could the equity path have been?" That is a real and useful
// question about SEQUENCE RISK. It rests on an assumption that is false in at
// least three ways for this platform, and each is handled rather than ignored:
//
//  1. TRADE OUTCOMES ARE NOT INDEPENDENT. They cluster by regime: a run of losses
//     in a choppy stretch is one event, not six coin flips. Reordering breaks the
//     clustering and therefore UNDERSTATES the streaks a real market produces.
//     `blockBootstrap()` exists for this — it resamples contiguous blocks, keeping
//     local clustering intact.
//
//  2. POSITION SIZE IS PATH-DEPENDENT WHEN RECOVERY IS ON. The ladder's size
//     depends on the outcome of the previous trade, so a reordered sequence would
//     have been traded at different sizes and the P&L figures no longer apply.
//     reorder() REFUSES a trade set containing recovery levels above base rather
//     than producing a confident-looking number about a system that could not
//     have existed.
//
//  3. THE RISK ENGINE WOULD HAVE INTERVENED. A reordered path that breaches the
//     daily loss limit or the drawdown limit would, in reality, have stopped
//     trading at that point. So the reordered curves are a PESSIMISTIC bound on
//     the path and an optimistic one on the outcome: they show how deep the hole
//     could have got, while assuming the system kept digging. That is stated in
//     the result rather than left for the reader to work out.
//
// Everything is seeded. A stress verdict that changed between runs could not gate
// a promotion.
// =====================================================

var rngMod = require('../core/rng');
var money = require('../core/money');
var errors = require('../core/errors');
var enums = require('../core/enums');
var metricsMod = require('../backtest/metrics');

/** Equity path statistics for one ordering of trades. */
function pathStats(trades, initialCapital) {
  var equity = initialCapital;
  var peak = initialCapital;
  var maxDdPct = 0;
  var maxDdMoney = 0;
  var streak = 0, maxStreak = 0;
  var minEquity = initialCapital;
  for (var i = 0; i < trades.length; i++) {
    equity = money.money(equity + trades[i].netPnl);
    if (equity > peak) peak = equity;
    if (equity < minEquity) minEquity = equity;
    var ddMoney = money.money(peak - equity);
    var ddPct = peak === 0 ? 0 : (ddMoney / peak) * 100;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
    if (ddMoney > maxDdMoney) maxDdMoney = ddMoney;
    if (trades[i].outcome === enums.TradeOutcome.LOSS) {
      streak++;
      if (streak > maxStreak) maxStreak = streak;
    } else if (trades[i].outcome === enums.TradeOutcome.WIN) {
      streak = 0;
    }
    // A breakeven holds the streak, matching the account's own convention.
  }
  return {
    finalEquity: equity,
    netPnl: money.money(equity - initialCapital),
    minEquity: minEquity,
    maxDrawdownPct: money.round(maxDdPct, 6),
    maxDrawdownMoney: maxDdMoney,
    maxConsecutiveLosses: maxStreak
  };
}

function quantile(sortedAsc, q) {
  if (!sortedAsc.length) return null;
  var pos = (sortedAsc.length - 1) * q;
  var lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function distribution(values, dp) {
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var p = dp === undefined ? 6 : dp;
  var sum = 0;
  for (var i = 0; i < sorted.length; i++) sum += sorted[i];
  return {
    n: sorted.length,
    min: money.round(sorted[0], p),
    p5: money.round(quantile(sorted, 0.05), p),
    p25: money.round(quantile(sorted, 0.25), p),
    median: money.round(quantile(sorted, 0.5), p),
    p75: money.round(quantile(sorted, 0.75), p),
    p95: money.round(quantile(sorted, 0.95), p),
    max: money.round(sorted[sorted.length - 1], p),
    mean: money.round(sum / sorted.length, p)
  };
}

/**
 * Refuses a trade set whose sizes were path-dependent.
 *
 * With recovery active, a reordered sequence would have been traded at different
 * sizes, so the recorded netPnl values describe a system that the reordering
 * could not have produced. Reporting percentiles from them would be a confident
 * number about a fiction.
 */
function assertReorderable(trades) {
  var withRecovery = trades.filter(function (t) { return (t.recoveryLevel || 0) > 0; });
  if (withRecovery.length) {
    throw errors.ConfigError(
      'cannot reorder ' + trades.length + ' trades: ' + withRecovery.length + ' were taken above base recovery ' +
      'level, so their sizes depended on the order they arrived in. Reordering them would produce percentiles ' +
      'for a system that never existed. Use a re-run stress scenario (src/stress/suite.js) instead, which ' +
      'replays the pipeline and lets the ladder respond to the new sequence.'
    );
  }
  return true;
}

/**
 * Trade-order randomisation.
 *
 * @param {object} spec
 * @param {object[]} spec.trades realised trades
 * @param {number} spec.initialCapital
 * @param {number} [spec.replications=1000]
 * @param {string|number} [spec.seed='monte-carlo']
 * @param {number} [spec.drawdownLimitPct] to report a breach probability
 * @param {number} [spec.ruinEquity] equity at or below which the account is ruined
 * @param {boolean} [spec.allowRecovery=false] bypass the path-dependence refusal
 */
function reorder(spec) {
  var trades = spec.trades || [];
  if (trades.length < 2) {
    throw errors.ConfigError('Monte Carlo reordering needs at least 2 trades, got ' + trades.length);
  }
  if (!spec.allowRecovery) assertReorderable(trades);

  var reps = spec.replications === undefined ? 1000 : spec.replications;
  var gen = rngMod.create(spec.seed === undefined ? 'monte-carlo' : spec.seed);
  var capital = spec.initialCapital;
  var ruinEquity = spec.ruinEquity === undefined ? 0 : spec.ruinEquity;

  var finals = [], dds = [], streaks = [], mins = [];
  var ruined = 0, breached = 0;
  for (var r = 0; r < reps; r++) {
    var s = pathStats(gen.shuffle(trades), capital);
    finals.push(s.finalEquity);
    dds.push(s.maxDrawdownPct);
    streaks.push(s.maxConsecutiveLosses);
    mins.push(s.minEquity);
    if (s.minEquity <= ruinEquity) ruined++;
    if (spec.drawdownLimitPct !== undefined && s.maxDrawdownPct >= spec.drawdownLimitPct) breached++;
  }

  var actual = pathStats(trades, capital);
  return {
    kind: 'TRADE_ORDER_REORDER',
    replications: reps,
    seed: String(spec.seed === undefined ? 'monte-carlo' : spec.seed),
    trades: trades.length,
    initialCapital: capital,
    /** The path that actually happened, for comparison against the distribution. */
    actual: actual,
    finalEquity: distribution(finals, 4),
    maxDrawdownPct: distribution(dds, 4),
    maxConsecutiveLosses: distribution(streaks, 2),
    minEquity: distribution(mins, 4),
    probabilityOfRuin: money.round(ruined / reps, 6),
    ruinEquity: ruinEquity,
    probabilityOfBreachingDrawdownLimit: spec.drawdownLimitPct === undefined
      ? null : money.round(breached / reps, 6),
    drawdownLimitPct: spec.drawdownLimitPct === undefined ? null : spec.drawdownLimitPct,
    /**
     * Where the realised path sat in the distribution. A run that happened to land
     * at the 5th percentile was lucky, and saying so is more useful than a mean.
     */
    actualPercentile: {
      finalEquity: percentileOf(finals, actual.finalEquity),
      maxDrawdownPct: percentileOf(dds, actual.maxDrawdownPct)
    },
    caveats: [
      'ORDER_INDEPENDENCE_ASSUMED: reordering breaks the regime clustering that produces real losing runs, ' +
        'so the streak distribution here UNDERSTATES what a clustered market delivers. See blockBootstrap().',
      'RISK_ENGINE_NOT_SIMULATED: a reordered path that breaches the daily-loss or drawdown limit would in ' +
        'reality have stopped trading at that point. These curves assume the system kept going, so they bound ' +
        'how deep the hole could get while being optimistic about the outcome.',
      'SAME_TRADES_ONLY: this says nothing about trades the strategy would have taken in a different market.'
    ]
  };
}

function percentileOf(values, x) {
  var below = 0;
  for (var i = 0; i < values.length; i++) if (values[i] <= x) below++;
  return money.round(below / values.length, 6);
}

/**
 * Bootstrap resampling: draws `trades.length` trades WITH replacement.
 *
 * Answers a different question from reorder(): not "what if these trades had come
 * in another order" but "what if the process that produced them had produced a
 * different sample of the same length". It is the more honest one for expectancy
 * uncertainty, and the less honest one for sequence risk, because it destroys
 * clustering completely.
 */
function bootstrap(spec) {
  var trades = spec.trades || [];
  if (trades.length < 2) throw errors.ConfigError('bootstrap needs at least 2 trades');
  if (!spec.allowRecovery) assertReorderable(trades);
  var reps = spec.replications === undefined ? 1000 : spec.replications;
  var gen = rngMod.create(spec.seed === undefined ? 'bootstrap' : spec.seed);
  var capital = spec.initialCapital;

  var finals = [], dds = [], streaks = [], expectancies = [];
  var ruinEquity = spec.ruinEquity === undefined ? 0 : spec.ruinEquity;
  var ruined = 0;
  for (var r = 0; r < reps; r++) {
    var sample = gen.resample(trades, trades.length);
    var s = pathStats(sample, capital);
    finals.push(s.finalEquity);
    dds.push(s.maxDrawdownPct);
    streaks.push(s.maxConsecutiveLosses);
    expectancies.push(money.money(s.netPnl / sample.length));
    if (s.minEquity <= ruinEquity) ruined++;
  }
  return {
    kind: 'BOOTSTRAP_RESAMPLE',
    replications: reps,
    seed: String(spec.seed === undefined ? 'bootstrap' : spec.seed),
    trades: trades.length,
    finalEquity: distribution(finals, 4),
    maxDrawdownPct: distribution(dds, 4),
    maxConsecutiveLosses: distribution(streaks, 2),
    expectancy: distribution(expectancies, 6),
    probabilityOfRuin: money.round(ruined / reps, 6),
    /**
     * The confidence interval that matters: if the 5th percentile of expectancy is
     * negative, the observed edge is not distinguishable from none at this sample
     * size, whatever the point estimate says.
     */
    expectancyPositiveAtP5: quantile(expectancies.slice().sort(function (a, b) { return a - b; }), 0.05) > 0,
    caveats: [
      'CLUSTERING_DESTROYED: sampling with replacement removes all serial structure, so the streak and ' +
        'drawdown distributions here are the most optimistic of the three methods in this module.',
      'FIXED_SAMPLE_SIZE: each replication has the same number of trades as the original, so this measures ' +
        'expectancy uncertainty at THIS sample size and nothing about a longer run.'
    ]
  };
}

/**
 * Block bootstrap: resamples contiguous BLOCKS of trades, preserving local
 * clustering.
 *
 * This is the closest of the three to how losing runs actually happen — a bad
 * stretch arrives as a stretch — and therefore the one whose streak and drawdown
 * percentiles should be believed over the other two.
 *
 * @param {number} [spec.blockSize=5]
 */
function blockBootstrap(spec) {
  var trades = spec.trades || [];
  var blockSize = spec.blockSize === undefined ? 5 : spec.blockSize;
  if (trades.length < blockSize * 2) {
    throw errors.ConfigError('block bootstrap needs at least ' + (blockSize * 2) + ' trades, got ' + trades.length);
  }
  if (!spec.allowRecovery) assertReorderable(trades);
  var reps = spec.replications === undefined ? 1000 : spec.replications;
  var gen = rngMod.create(spec.seed === undefined ? 'block-bootstrap' : spec.seed);
  var capital = spec.initialCapital;
  var ruinEquity = spec.ruinEquity === undefined ? 0 : spec.ruinEquity;

  var finals = [], dds = [], streaks = [];
  var ruined = 0, breached = 0;
  var blocks = Math.ceil(trades.length / blockSize);
  for (var r = 0; r < reps; r++) {
    var sample = [];
    for (var b = 0; b < blocks; b++) {
      var start = gen.int(0, trades.length - blockSize);
      for (var k = 0; k < blockSize; k++) sample.push(trades[start + k]);
    }
    sample = sample.slice(0, trades.length);
    var s = pathStats(sample, capital);
    finals.push(s.finalEquity);
    dds.push(s.maxDrawdownPct);
    streaks.push(s.maxConsecutiveLosses);
    if (s.minEquity <= ruinEquity) ruined++;
    if (spec.drawdownLimitPct !== undefined && s.maxDrawdownPct >= spec.drawdownLimitPct) breached++;
  }
  return {
    kind: 'BLOCK_BOOTSTRAP',
    replications: reps,
    blockSize: blockSize,
    seed: String(spec.seed === undefined ? 'block-bootstrap' : spec.seed),
    trades: trades.length,
    finalEquity: distribution(finals, 4),
    maxDrawdownPct: distribution(dds, 4),
    maxConsecutiveLosses: distribution(streaks, 2),
    probabilityOfRuin: money.round(ruined / reps, 6),
    probabilityOfBreachingDrawdownLimit: spec.drawdownLimitPct === undefined
      ? null : money.round(breached / reps, 6),
    caveats: [
      'BLOCKS_PRESERVE_CLUSTERING: of the three resampling methods here this is the one whose streak and ' +
        'drawdown percentiles should be believed, because a bad stretch arrives as a stretch.',
      'BLOCK_SIZE_MATTERS: too small and clustering is lost, too large and there is no resampling left. ' +
        'Report the block size with any conclusion.'
    ]
  };
}

/**
 * Explicit losing-streak stress (mission §15): what would a streak of length k
 * have done to this account, at the average loss size actually observed?
 *
 * Not a simulation — an arithmetic statement. It answers "how many consecutive
 * losses can this account absorb?", which is the question a $100 account most
 * needs answered and which no percentile makes obvious.
 */
function streakStress(spec) {
  var trades = spec.trades || [];
  var losses = trades.filter(function (t) { return t.outcome === enums.TradeOutcome.LOSS; });
  if (losses.length === 0) {
    return { kind: 'STREAK_STRESS', losses: 0, note: 'no losing trades to measure' };
  }
  var avgLoss = money.money(money.sum(losses.map(function (t) { return Math.abs(t.netPnl); })) / losses.length);
  var worstLoss = money.money(Math.max.apply(null, losses.map(function (t) { return Math.abs(t.netPnl); })));
  var capital = spec.initialCapital;
  var limitPct = spec.drawdownLimitPct;

  var rows = [];
  for (var k = 1; k <= (spec.maxK || 12); k++) {
    var atAvg = money.money(k * avgLoss);
    var atWorst = money.money(k * worstLoss);
    rows.push({
      k: k,
      lossAtAverage: atAvg,
      lossAtWorst: atWorst,
      drawdownPctAtAverage: money.round((atAvg / capital) * 100, 4),
      drawdownPctAtWorst: money.round((atWorst / capital) * 100, 4),
      breachesLimitAtAverage: limitPct !== undefined ? (atAvg / capital) * 100 >= limitPct : null,
      breachesLimitAtWorst: limitPct !== undefined ? (atWorst / capital) * 100 >= limitPct : null
    });
  }
  var firstBreachAvg = rows.filter(function (r) { return r.breachesLimitAtAverage; })[0];
  var firstBreachWorst = rows.filter(function (r) { return r.breachesLimitAtWorst; })[0];

  return {
    kind: 'STREAK_STRESS',
    losses: losses.length,
    averageLossMoney: avgLoss,
    worstLossMoney: worstLoss,
    observedMaxStreak: metricsMod.compute({ trades: trades, initialCapital: capital }).maxConsecutiveLosses,
    table: rows,
    /** The headline: how many average losses the drawdown limit allows. */
    streakToBreachLimitAtAverage: firstBreachAvg ? firstBreachAvg.k : null,
    streakToBreachLimitAtWorst: firstBreachWorst ? firstBreachWorst.k : null,
    drawdownLimitPct: limitPct === undefined ? null : limitPct,
    note: 'Arithmetic, not simulation: k consecutive losses at the observed average (and worst) loss size. ' +
      'It ignores the wins that would in practice interleave, which is the point — it is a survival bound.'
  };
}

module.exports = {
  reorder: reorder,
  bootstrap: bootstrap,
  blockBootstrap: blockBootstrap,
  streakStress: streakStress,
  pathStats: pathStats,
  distribution: distribution,
  assertReorderable: assertReorderable
};
