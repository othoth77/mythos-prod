'use strict';
// =====================================================
// MYTHOS TRADING AGENT — in-sample / out-of-sample segmentation
// projects/mythos-trading-agent/src/backtest/walk-forward.js
//
// Mission §14 asks for in-sample, out-of-sample and walk-forward testing, and for
// look-ahead and data leakage to be prevented. This module is where the SEGMENT
// boundaries are defined, and the rules it enforces are the ones that make an
// out-of-sample claim mean anything:
//
//  1. OUT-OF-SAMPLE COMES STRICTLY AFTER IN-SAMPLE, IN TIME. Not a random split.
//     A random split of a time series lets the "unseen" data sit between bars the
//     tuning already saw, which leaks the future through simple continuity.
//
//  2. FOLDS' OUT-OF-SAMPLE WINDOWS NEVER OVERLAP. If they did, the same bars
//     would be counted as fresh evidence more than once, and the aggregate
//     out-of-sample result would be quietly inflated. assertNoOverlap() refuses.
//
//  3. A WARMUP GAP IS NOT OPTIONAL. Indicators need history, so an out-of-sample
//     segment starting at bar N is evaluated with bars before N visible to the
//     indicators. That is legitimate — a live system would have that history too —
//     but the bars used for warmup must be excluded from the in-sample window's
//     TUNING, or the two segments share information. Each segment therefore
//     records its own warmup span explicitly.
//
//  4. EVERY SEGMENT CARRIES ITS BAR COUNT. A fold with 40 out-of-sample bars is
//     not evidence, and a caller that cannot see the count will treat it as such.
// =====================================================

var errors = require('../core/errors');
var clock = require('../core/clock');
var money = require('../core/money');

/**
 * A single chronological in-sample / out-of-sample split.
 *
 * @param {object[]} bars
 * @param {object} [opts]
 * @param {number} [opts.inSampleRatio=0.7]
 * @param {number} [opts.warmupBars=0] bars before the in-sample window that
 *        indicators may see but that tuning must not use
 * @returns {{inSample, outOfSample, warmupBars, totalBars}}
 */
function split(bars, opts) {
  var o = opts || {};
  var ratio = o.inSampleRatio === undefined ? 0.7 : o.inSampleRatio;
  var warmup = o.warmupBars || 0;
  if (!(ratio > 0 && ratio < 1)) {
    throw errors.ConfigError('inSampleRatio must be strictly between 0 and 1, got ' + ratio);
  }
  if (bars.length < warmup + 4) {
    throw errors.DataError('not enough bars to split: ' + bars.length + ' with a warmup of ' + warmup);
  }
  var usable = bars.length - warmup;
  var inCount = Math.floor(usable * ratio);
  if (inCount < 1 || usable - inCount < 1) {
    throw errors.DataError('the split leaves an empty segment: ' + inCount + ' in-sample of ' + usable + ' usable bars');
  }
  var inStart = warmup;
  var inEnd = warmup + inCount;          // exclusive
  return {
    totalBars: bars.length,
    warmupBars: warmup,
    inSample: segment('in-sample', bars, inStart, inEnd, warmup),
    outOfSample: segment('out-of-sample', bars, inEnd, bars.length, warmup)
  };
}

/**
 * Rolling walk-forward folds.
 *
 * @param {object[]} bars
 * @param {object} spec
 * @param {number} spec.inSampleBars
 * @param {number} spec.outOfSampleBars
 * @param {number} [spec.warmupBars=0]
 * @param {boolean} [spec.anchored=false] when true, every fold's in-sample window
 *        starts at the beginning (a growing window) instead of sliding
 * @param {number} [spec.maxFolds]
 * @returns {object[]} folds, each { fold, inSample, outOfSample }
 */
function rollingFolds(bars, spec) {
  var inBars = spec.inSampleBars;
  var outBars = spec.outOfSampleBars;
  var warmup = spec.warmupBars || 0;
  if (!(inBars > 0) || !(outBars > 0)) {
    throw errors.ConfigError('rollingFolds needs positive inSampleBars and outOfSampleBars');
  }
  var folds = [];
  var start = warmup;
  var n = 0;
  while (start + inBars + outBars <= bars.length) {
    var inStart = spec.anchored ? warmup : start;
    var inEnd = start + inBars;
    var outEnd = inEnd + outBars;
    folds.push({
      fold: n,
      anchored: !!spec.anchored,
      warmupBars: warmup,
      inSample: segment('in-sample', bars, inStart, inEnd, warmup),
      outOfSample: segment('out-of-sample', bars, inEnd, outEnd, warmup)
    });
    n++;
    if (spec.maxFolds && n >= spec.maxFolds) break;
    // The window advances by the OUT-OF-SAMPLE length, which is what keeps the
    // out-of-sample windows disjoint — advancing by less would reuse fresh bars.
    start += outBars;
  }
  if (folds.length === 0) {
    throw errors.DataError(
      'no walk-forward fold fits: ' + bars.length + ' bars, warmup ' + warmup +
      ', need at least ' + (warmup + inBars + outBars)
    );
  }
  assertNoOverlap(folds);
  return folds;
}

function segment(label, bars, startIndex, endIndex, warmup) {
  if (!(endIndex > startIndex)) {
    throw errors.DataError('empty ' + label + ' segment: [' + startIndex + ', ' + endIndex + ')');
  }
  var first = bars[startIndex];
  var last = bars[endIndex - 1];
  return {
    label: label,
    fromIndex: startIndex,
    toIndex: endIndex - 1,
    bars: endIndex - startIndex,
    fromTs: first.ts,
    toTs: last.ts,
    fromIso: clock.iso(first.ts),
    toIso: clock.iso(last.ts),
    /**
     * The range to hand the engine. It starts at the segment's own first bar, so
     * indicators warm up INSIDE the segment — the pessimistic choice. Starting
     * earlier would give the segment history the previous segment was tuned on,
     * which is the leakage this module exists to prevent.
     */
    range: { fromTs: first.ts, toTs: last.ts + 1 },
    warmupBarsBefore: warmup
  };
}

/**
 * Refuses overlapping out-of-sample windows. Overlap would let the same bars
 * count as fresh evidence more than once and inflate the aggregate.
 */
function assertNoOverlap(folds) {
  var windows = folds.map(function (f) { return f.outOfSample; })
    .slice().sort(function (a, b) { return a.fromTs - b.fromTs; });
  for (var i = 1; i < windows.length; i++) {
    if (windows[i].fromTs <= windows[i - 1].toTs) {
      throw errors.ConfigError(
        'walk-forward folds have overlapping out-of-sample windows (' +
        windows[i - 1].fromIso + '…' + windows[i - 1].toIso + ' and ' +
        windows[i].fromIso + '…' + windows[i].toIso + '); the same bars would be ' +
        'counted as fresh evidence twice'
      );
    }
  }
  return true;
}

/**
 * Runs a function over every fold and aggregates.
 *
 * @param {object} spec
 * @param {object[]} spec.folds
 * @param {function} spec.runSegment (segment, fold) => { metrics, ... }
 * @returns {{folds: object[], aggregate: object}}
 */
function evaluate(spec) {
  var results = spec.folds.map(function (f) {
    return {
      fold: f.fold,
      inSample: spec.runSegment(f.inSample, f),
      outOfSample: spec.runSegment(f.outOfSample, f)
    };
  });
  return { folds: results, aggregate: aggregate(results) };
}

/**
 * Aggregates fold results.
 *
 * The in-sample / out-of-sample DEGRADATION is the headline, because it is the
 * number that says whether a result was found or manufactured. A configuration
 * that is excellent in-sample and mediocre out-of-sample has been fitted, and the
 * ratio names that directly rather than leaving it to be inferred from two tables.
 */
function aggregate(results) {
  function collect(side, field) {
    return results.map(function (r) { return r[side] && r[side].metrics ? r[side].metrics[field] : null; })
      .filter(function (v) { return typeof v === 'number'; });
  }
  function mean(list) {
    return list.length ? money.round(list.reduce(function (a, b) { return a + b; }, 0) / list.length, 6) : null;
  }

  var inNet = collect('inSample', 'netPnl');
  var outNet = collect('outOfSample', 'netPnl');
  var inExp = collect('inSample', 'expectancy');
  var outExp = collect('outOfSample', 'expectancy');
  var outTrades = collect('outOfSample', 'tradeCount');
  var inTrades = collect('inSample', 'tradeCount');

  var meanInExp = mean(inExp);
  var meanOutExp = mean(outExp);

  return {
    folds: results.length,
    inSample: {
      totalNetPnl: money.money(inNet.reduce(function (a, b) { return a + b; }, 0)),
      meanExpectancy: meanInExp,
      totalTrades: inTrades.reduce(function (a, b) { return a + b; }, 0),
      meanMaxDrawdownPct: mean(collect('inSample', 'maxDrawdownPct')),
      worstMaxConsecutiveLosses: collect('inSample', 'maxConsecutiveLosses').length
        ? Math.max.apply(null, collect('inSample', 'maxConsecutiveLosses')) : null
    },
    outOfSample: {
      totalNetPnl: money.money(outNet.reduce(function (a, b) { return a + b; }, 0)),
      meanExpectancy: meanOutExp,
      totalTrades: outTrades.reduce(function (a, b) { return a + b; }, 0),
      meanMaxDrawdownPct: mean(collect('outOfSample', 'maxDrawdownPct')),
      worstMaxConsecutiveLosses: collect('outOfSample', 'maxConsecutiveLosses').length
        ? Math.max.apply(null, collect('outOfSample', 'maxConsecutiveLosses')) : null,
      profitableFolds: outNet.filter(function (v) { return v > 0; }).length,
      foldsWithTrades: outTrades.filter(function (v) { return v > 0; }).length
    },
    /**
     * out-of-sample expectancy ÷ in-sample expectancy. 1 means the result held;
     * well below 1 means it was fitted. null when either side has no expectancy,
     * and deliberately null rather than 0 when the in-sample expectancy is
     * negative — a ratio of two negative numbers is not a degradation measure.
     */
    degradation: (meanInExp !== null && meanOutExp !== null && meanInExp > 0)
      ? money.round(meanOutExp / meanInExp, 6) : null,
    degradationNote: (meanInExp !== null && meanInExp <= 0)
      ? 'in-sample expectancy is not positive, so a degradation ratio would be meaningless'
      : null,
    /** The share of folds where out-of-sample beat nothing at all. */
    outOfSampleHitRate: outNet.length ? money.round(outNet.filter(function (v) { return v > 0; }).length / outNet.length, 6) : null
  };
}

/**
 * Describes a fold set for a store record, without the per-bar detail.
 */
function describe(folds) {
  return {
    folds: folds.length,
    anchored: folds.length ? !!folds[0].anchored : null,
    inSampleBars: folds.length ? folds[0].inSample.bars : null,
    outOfSampleBars: folds.length ? folds[0].outOfSample.bars : null,
    firstTs: folds.length ? folds[0].inSample.fromTs : null,
    lastTs: folds.length ? folds[folds.length - 1].outOfSample.toTs : null,
    windows: folds.map(function (f) {
      return {
        fold: f.fold,
        inSample: [f.inSample.fromIso, f.inSample.toIso, f.inSample.bars],
        outOfSample: [f.outOfSample.fromIso, f.outOfSample.toIso, f.outOfSample.bars]
      };
    })
  };
}

module.exports = {
  split: split,
  rollingFolds: rollingFolds,
  evaluate: evaluate,
  aggregate: aggregate,
  assertNoOverlap: assertNoOverlap,
  describe: describe
};
