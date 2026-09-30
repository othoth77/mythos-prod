'use strict';
// =====================================================
// MYTHOS TRADING AGENT — performance metrics
// projects/mythos-trading-agent/src/backtest/metrics.js
//
// Mission §10 makes losing-streak behaviour a PRIMARY optimisation objective and
// says explicitly: "DO NOT optimize only for win rate." This module is built so
// that instruction is structurally hard to ignore — the streak family sits
// alongside expectancy and profit factor as first-class output, not in an
// appendix, and `headline()` refuses to summarise a run without them.
//
// Definitions are stated in the code because every one of them has a plausible
// alternative, and a metric whose definition is ambiguous cannot gate a
// promotion:
//
//  * NET means after spread, commission, slippage and swap. Every ratio here is
//    computed on net P&L. The gross figures are reported only next to the cost
//    total, so the two can never be confused (mission §9).
//  * PROFIT FACTOR is sum(net wins) / |sum(net losses)|. With no losses it is
//    reported as null, not Infinity: "infinite profit factor" from a 12-trade
//    sample is noise wearing a suit.
//  * EXPECTANCY is net P&L per trade, in account currency. Where trades carry
//    their risk, expectancyR is also given in R multiples, which is the only
//    form comparable across instruments.
//  * P(k CONSECUTIVE LOSSES) is the empirical frequency of a window of k
//    consecutive losing trades among all windows of size k. It is NOT
//    win-rate^k: trade outcomes in a regime-switching market are not
//    independent, and assuming they are is what makes a martingale look safe.
//  * MAX DRAWDOWN comes from the mark-to-market equity curve when one is given,
//    so an open losing position counts. Falling back to trade-close balances
//    understates it.
// =====================================================

var money = require('../core/money');
var enums = require('../core/enums');

/** Streak lengths reported by default. */
var STREAK_KS = [2, 3, 4, 5, 6, 7, 8];

function isLoss(t) { return t.outcome === enums.TradeOutcome.LOSS; }
function isWin(t) { return t.outcome === enums.TradeOutcome.WIN; }

/** Lengths of every maximal run of consecutive losses, in order. */
function losingStreaks(trades) {
  var out = [];
  var run = 0;
  for (var i = 0; i < trades.length; i++) {
    if (isLoss(trades[i])) {
      run++;
    } else if (run > 0) {
      out.push(run); run = 0;
    }
  }
  if (run > 0) out.push(run);
  return out;
}

/** Lengths of every maximal run of consecutive wins. */
function winningStreaks(trades) {
  var out = [];
  var run = 0;
  for (var i = 0; i < trades.length; i++) {
    if (isWin(trades[i])) {
      run++;
    } else if (run > 0) {
      out.push(run); run = 0;
    }
  }
  if (run > 0) out.push(run);
  return out;
}

/**
 * Empirical probability that k consecutive trades were all losses.
 * Returns null when the sample is too short to contain a window of size k —
 * reporting 0 there would claim evidence that does not exist.
 */
function pConsecutiveLosses(trades, k) {
  var windows = trades.length - k + 1;
  if (windows <= 0) return null;
  var hits = 0;
  for (var i = 0; i < windows; i++) {
    var all = true;
    for (var j = 0; j < k; j++) {
      if (!isLoss(trades[i + j])) { all = false; break; }
    }
    if (all) hits++;
  }
  return { k: k, probability: money.round(hits / windows, 6), windows: windows, hits: hits };
}

/** Max drawdown from an equity curve of { ts, equity } samples. */
function drawdownFromCurve(curve) {
  if (!curve || curve.length === 0) return { maxDrawdownPct: 0, maxDrawdownMoney: 0, peakTs: null, troughTs: null, recoveredAtTs: null };
  var peak = curve[0].equity;
  var peakTs = curve[0].ts;
  var worstPct = 0, worstMoney = 0, worstPeakTs = peakTs, worstTroughTs = peakTs;
  var recovered = null;
  for (var i = 0; i < curve.length; i++) {
    var e = curve[i].equity;
    if (e > peak) {
      peak = e; peakTs = curve[i].ts;
      if (worstPct > 0 && recovered === null) recovered = curve[i].ts;
    }
    var ddMoney = peak - e;
    var ddPct = peak === 0 ? 0 : (ddMoney / peak) * 100;
    if (ddPct > worstPct) {
      worstPct = ddPct; worstMoney = ddMoney;
      worstPeakTs = peakTs; worstTroughTs = curve[i].ts;
      recovered = null;
    }
  }
  return {
    maxDrawdownPct: money.round(worstPct, 6),
    maxDrawdownMoney: money.money(worstMoney),
    peakTs: worstPeakTs,
    troughTs: worstTroughTs,
    recoveredAtTs: recovered
  };
}

/** Equity curve reconstructed from closed trades alone. */
function curveFromTrades(trades, initialCapital) {
  var eq = initialCapital;
  var curve = [{ ts: trades.length ? trades[0].entryTs : null, equity: money.money(eq) }];
  trades.forEach(function (t) {
    eq = money.money(eq + t.netPnl);
    curve.push({ ts: t.exitTs, equity: eq });
  });
  return curve;
}

function mean(list) {
  if (!list.length) return null;
  var s = 0;
  for (var i = 0; i < list.length; i++) s += list[i];
  return s / list.length;
}

function stdev(list) {
  if (list.length < 2) return null;
  var m = mean(list);
  var s = 0;
  for (var i = 0; i < list.length; i++) s += (list[i] - m) * (list[i] - m);
  return Math.sqrt(s / (list.length - 1));
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  var pos = (sorted.length - 1) * q;
  var lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Computes the full metric set.
 *
 * @param {object} spec
 * @param {object[]} spec.trades closed trades, in exit order
 * @param {number} spec.initialCapital
 * @param {object[]} [spec.equityCurve] mark-to-market samples; strongly preferred
 * @param {object} [spec.counts] pipeline counters (candidates, blocks by stage)
 */
function compute(spec) {
  var trades = spec.trades || [];
  var initial = spec.initialCapital;
  var curve = spec.equityCurve && spec.equityCurve.length ? spec.equityCurve : curveFromTrades(trades, initial);

  var wins = trades.filter(isWin);
  var losses = trades.filter(isLoss);
  var breakevens = trades.filter(function (t) { return t.outcome === enums.TradeOutcome.BREAKEVEN; });

  var netList = trades.map(function (t) { return t.netPnl; });
  var grossPnl = money.sum(trades.map(function (t) { return t.grossPnl; }));
  var costs = money.sum(trades.map(function (t) { return t.costsMoney; }));
  var netPnl = money.sum(netList);

  var winSum = money.sum(wins.map(function (t) { return t.netPnl; }));
  var lossSum = money.sum(losses.map(function (t) { return t.netPnl; })); // negative
  var absLossSum = money.money(-lossSum);

  var dd = drawdownFromCurve(curve);
  var lStreaks = losingStreaks(trades);
  var wStreaks = winningStreaks(trades);
  var rMultiples = trades
    .filter(function (t) { return typeof t.riskMoney === 'number' && t.riskMoney > 0; })
    .map(function (t) { return t.netPnl / t.riskMoney; });

  var recoveryLevels = trades.map(function (t) { return t.recoveryLevel || 0; });
  var sortedNet = netList.slice().sort(function (a, b) { return a - b; });

  var m = {
    // --- sample ---------------------------------------------------------
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate: trades.length ? money.round(wins.length / trades.length, 6) : null,

    // --- money (mission §9: gross, costs and net are never conflated) ----
    initialCapital: money.money(initial),
    grossPnl: grossPnl,
    totalCosts: costs,
    netPnl: netPnl,
    finalEquity: money.money(initial + netPnl),
    returnPct: money.round(money.fraction(netPnl, initial) * 100, 6),
    /** Costs as a share of the gross profit that had to pay for them. */
    costRatio: grossPnl > 0 ? money.round(costs / grossPnl, 6) : null,
    /** How much of the gross result the costs consumed, signed-safe. */
    costsOverAbsGross: Math.abs(grossPnl) > 0 ? money.round(costs / Math.abs(grossPnl), 6) : null,

    // --- edge -----------------------------------------------------------
    expectancy: trades.length ? money.money(netPnl / trades.length) : null,
    expectancyR: rMultiples.length ? money.round(mean(rMultiples), 6) : null,
    avgWin: wins.length ? money.money(winSum / wins.length) : null,
    avgLoss: losses.length ? money.money(absLossSum / losses.length) : null,
    payoffRatio: (wins.length && losses.length && absLossSum > 0)
      ? money.round((winSum / wins.length) / (absLossSum / losses.length), 6) : null,
    profitFactor: absLossSum > 0 ? money.round(winSum / absLossSum, 6) : null,
    largestWin: wins.length ? money.money(Math.max.apply(null, wins.map(function (t) { return t.netPnl; }))) : null,
    largestLoss: losses.length ? money.money(Math.min.apply(null, losses.map(function (t) { return t.netPnl; }))) : null,
    medianTrade: trades.length ? money.money(quantile(sortedNet, 0.5)) : null,
    tradeStdev: netList.length > 1 ? money.round(stdev(netList), 6) : null,
    /** Mean/sd of per-trade net P&L. Not annualised — it is per trade. */
    perTradeSharpe: (netList.length > 1 && stdev(netList) > 0)
      ? money.round(mean(netList) / stdev(netList), 6) : null,

    // --- drawdown -------------------------------------------------------
    maxDrawdownPct: dd.maxDrawdownPct,
    maxDrawdownMoney: dd.maxDrawdownMoney,
    drawdownPeakTs: dd.peakTs,
    drawdownTroughTs: dd.troughTs,
    drawdownRecoveredAtTs: dd.recoveredAtTs,
    returnOverMaxDrawdown: dd.maxDrawdownPct > 0
      ? money.round(money.fraction(netPnl, initial) * 100 / dd.maxDrawdownPct, 6) : null,
    equityCurveSource: (spec.equityCurve && spec.equityCurve.length) ? 'MARK_TO_MARKET' : 'TRADE_CLOSES_ONLY',

    // --- streaks (mission §10) -----------------------------------------
    maxConsecutiveLosses: lStreaks.length ? Math.max.apply(null, lStreaks) : 0,
    maxConsecutiveWins: wStreaks.length ? Math.max.apply(null, wStreaks) : 0,
    avgLosingStreak: lStreaks.length ? money.round(mean(lStreaks), 4) : null,
    losingStreakCount: lStreaks.length,
    losingStreaks: lStreaks,
    streakProbabilities: STREAK_KS.map(function (k) { return pConsecutiveLosses(trades, k); }).filter(function (p) { return p !== null; }),

    // --- recovery -------------------------------------------------------
    maxRecoveryLevel: recoveryLevels.length ? Math.max.apply(null, recoveryLevels) : 0,
    tradesAtRecoveryLevel: countBy(recoveryLevels),
    largestPositionLots: trades.length ? Math.max.apply(null, trades.map(function (t) { return t.lots; })) : null,

    // --- holding --------------------------------------------------------
    avgBarsHeld: trades.length ? money.round(mean(trades.map(function (t) { return t.barsHeld || 0; })), 3) : null,
    exitReasons: countBy(trades.map(function (t) { return t.exitReason; }))
  };

  if (spec.counts) m.pipeline = spec.counts;
  return m;
}

function countBy(list) {
  var out = {};
  list.forEach(function (v) {
    var k = String(v);
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

/**
 * Groups trades by a field and computes metrics per group. The Analysis Agent
 * uses this for per-strategy, per-regime, per-asset and per-Jev-band views.
 */
function byGroup(spec, field) {
  var groups = Object.create(null);
  (spec.trades || []).forEach(function (t) {
    var key = String(t[field]);
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  var out = {};
  Object.keys(groups).sort().forEach(function (k) {
    out[k] = compute({ trades: groups[k], initialCapital: spec.initialCapital });
  });
  return out;
}

/**
 * The short form for a report line. Deliberately includes the streak and
 * drawdown fields: a summary of this system that omitted them would be the
 * exact failure mission §10 warns about.
 */
function headline(m) {
  return {
    trades: m.tradeCount,
    winRate: m.winRate,
    netPnl: m.netPnl,
    costs: m.totalCosts,
    expectancy: m.expectancy,
    profitFactor: m.profitFactor,
    maxDrawdownPct: m.maxDrawdownPct,
    maxConsecutiveLosses: m.maxConsecutiveLosses,
    returnOverMaxDrawdown: m.returnOverMaxDrawdown,
    maxRecoveryLevel: m.maxRecoveryLevel
  };
}

module.exports = {
  compute: compute,
  byGroup: byGroup,
  headline: headline,
  losingStreaks: losingStreaks,
  winningStreaks: winningStreaks,
  pConsecutiveLosses: pConsecutiveLosses,
  drawdownFromCurve: drawdownFromCurve,
  curveFromTrades: curveFromTrades,
  STREAK_KS: STREAK_KS
};
