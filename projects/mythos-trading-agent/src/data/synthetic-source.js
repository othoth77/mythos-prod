'use strict';
// =====================================================
// MYTHOS TRADING AGENT — seeded synthetic market data
// projects/mythos-trading-agent/src/data/synthetic-source.js
//
// This build has no market-data access, so strategy and engine MECHANICS are
// exercised against a generator. Read docs/COMPLIANCE_AND_RISK.md §3.4 before
// drawing any conclusion from it: synthetic data can show that a stop fills, a
// cost is deducted, a limit binds and a run reproduces. It cannot show that a
// strategy has an edge, because the process that produced it is one we wrote.
//
// The generator is a regime-switching random walk:
//
//   regime chain  →  per-bar drift and volatility  →  log-return  →  OHLC
//
// Two design choices are worth the ink:
//
//  1. IT PUBLISHES ITS OWN GROUND TRUTH. `regimeTruth[i]` is the regime the
//     generator was actually in at bar i. The Market Regime Engine can then be
//     scored against a known answer instead of against our impression of a
//     chart — a test that would be impossible with real data.
//
//  2. IT RESPECTS THE INSTRUMENT'S CALENDAR. Timestamps skip the FX weekend and
//     any session window the instrument declares, so a strategy cannot be
//     validated on bars that could never have been traded, and the bar count
//     per day matches what a real feed would deliver.
//
// Everything is derived from the seed. Two calls with the same arguments
// produce byte-identical bars, which is what makes a stress test's verdict
// stable enough to gate a promotion.
// =====================================================

var rngMod = require('../core/rng');
var clock = require('../core/clock');
var enums = require('../core/enums');
var errors = require('../core/errors');
var hashMod = require('../core/hash');
var money = require('../core/money');
var sourceMod = require('./source');

/** Annualised volatility assumption per asset class. Documented estimates. */
var ANNUAL_VOL = {
  FX: 0.08,
  METAL: 0.16,
  CRYPTO: 0.60,
  INDEX: 0.18,
  FUTURE: 0.20
};

/**
 * Per-regime behaviour. `driftSigmas` is drift expressed in units of the bar's
 * own volatility, which keeps the shape of a regime the same across instruments
 * of very different volatility.
 *
 * CALIBRATION NOTE, because the first draft of these numbers was wrong in a way
 * worth recording: drift accumulates LINEARLY in the number of bars while noise
 * accumulates as its square root. A trend segment of 300 bars at 0.32σ per bar
 * carries 96σ of drift against 17σ of noise — a 5.6:1 signal-to-noise ratio that
 * no market produces, and one that would make every trend-following strategy
 * look brilliant. TREND is therefore 0.06σ per bar, which over a 300-bar segment
 * gives drift ≈ noise. That is still generous; it is not absurd.
 */
var REGIME_MODELS = {
  TREND:           { volMult: 1.00, driftSigmas: 0.06, meanReversion: 0,    minBars: 60, maxBars: 320 },
  RANGE:           { volMult: 0.80, driftSigmas: 0,    meanReversion: 0.06, minBars: 60, maxBars: 300 },
  BREAKOUT:        { volMult: 1.70, driftSigmas: 0.35, meanReversion: 0,    minBars: 8,  maxBars: 40 },
  HIGH_VOLATILITY: { volMult: 2.20, driftSigmas: 0,    meanReversion: 0,    minBars: 30, maxBars: 140 },
  LOW_VOLATILITY:  { volMult: 0.45, driftSigmas: 0,    meanReversion: 0.02, minBars: 60, maxBars: 260 },
  UNSTABLE:        { volMult: 1.80, driftSigmas: 0,    meanReversion: 0,    minBars: 20, maxBars: 120, flip: true }
};

/**
 * Wick extension as a fraction of the bar's sigma, per side. Chosen so the mean
 * bar range lands near what a real M15 series shows (EURUSD ≈ 6 pips, gold ≈
 * $2.5) rather than the ≈2x that a full-body-plus-full-wicks construction gives.
 */
var WICK_SIGMAS = 0.35;

/**
 * Regime transition weights. A breakout tends to resolve into a trend; a trend
 * tends to exhaust into a range or high volatility. Not calibrated to anything
 * — it exists to produce varied, non-degenerate series.
 */
var TRANSITIONS = {
  TREND:           { RANGE: 0.35, HIGH_VOLATILITY: 0.2, LOW_VOLATILITY: 0.1, BREAKOUT: 0.15, UNSTABLE: 0.1, TREND: 0.1 },
  RANGE:           { BREAKOUT: 0.3, TREND: 0.2, LOW_VOLATILITY: 0.25, HIGH_VOLATILITY: 0.1, UNSTABLE: 0.1, RANGE: 0.05 },
  BREAKOUT:        { TREND: 0.55, HIGH_VOLATILITY: 0.2, RANGE: 0.15, UNSTABLE: 0.1 },
  HIGH_VOLATILITY: { RANGE: 0.3, TREND: 0.25, UNSTABLE: 0.2, LOW_VOLATILITY: 0.15, BREAKOUT: 0.1 },
  LOW_VOLATILITY:  { RANGE: 0.4, BREAKOUT: 0.25, TREND: 0.2, HIGH_VOLATILITY: 0.15 },
  UNSTABLE:        { RANGE: 0.35, HIGH_VOLATILITY: 0.25, TREND: 0.2, LOW_VOLATILITY: 0.2 }
};

/** Approximate tradable bars per year, used to scale annual vol to a bar. */
function barsPerYear(timeframe, weekendClosed) {
  var perDay = 1440 / clock.timeframeMinutes(timeframe);
  var days = weekendClosed ? 260 : 365;
  return perDay * days;
}

function pickWeighted(gen, weights) {
  var keys = Object.keys(weights);
  var total = 0;
  keys.forEach(function (k) { total += weights[k]; });
  var r = gen.float() * total;
  for (var i = 0; i < keys.length; i++) {
    r -= weights[keys[i]];
    if (r <= 0) return keys[i];
  }
  return keys[keys.length - 1];
}

/**
 * Advances a timestamp to the next tradable bar open for this instrument.
 * Skips the FX weekend and any declared session window.
 */
function nextTradableTs(ts, stepMs, inst) {
  var t = ts;
  var guard = 0;
  while (guard++ < 20000) {
    var ok = true;
    if (inst.weekendClosed && clock.isForexWeekend(t)) ok = false;
    var th = inst.tradingHoursUtc;
    if (ok && th.start !== th.end && !clock.inHourWindow(t, th.start, th.end)) ok = false;
    if (ok) return t;
    t += stepMs;
  }
  throw errors.DataError('could not find a tradable bar time for ' + inst.symbol + ' after ' + clock.iso(ts));
}

/**
 * Generates one series.
 *
 * @param {object} spec
 * @param {object} spec.instrument instrument spec from the catalog
 * @param {string} spec.timeframe
 * @param {number} spec.bars how many bars to produce
 * @param {string|number} spec.seed
 * @param {string} [spec.startIso='2023-01-02T00:00:00Z']
 * @param {number} [spec.startPrice] defaults to the instrument's referencePrice
 * @param {number} [spec.volMultiplier=1] global volatility scaling
 * @param {string[]} [spec.regimeSequence] force an exact regime order (tests)
 * @returns {{bars: object[], regimeTruth: string[], segments: object[], params: object}}
 */
function generate(spec) {
  var inst = spec.instrument;
  var timeframe = spec.timeframe;
  enums.assertEnum(enums.Timeframe, timeframe, 'timeframe');
  var count = spec.bars;
  if (!(count > 0)) throw errors.DataError('generate() needs a positive bar count');

  var gen = rngMod.create(spec.seed === undefined ? 'mythos-synthetic' : spec.seed);
  var stepMs = clock.timeframeMinutes(timeframe) * clock.MINUTE;
  var startTs = clock.floorToTimeframe(clock.parse(spec.startIso || '2023-01-02T00:00:00Z'), timeframe);
  var price = spec.startPrice === undefined ? inst.referencePrice : spec.startPrice;
  var volMultiplier = spec.volMultiplier === undefined ? 1 : spec.volMultiplier;

  var annualVol = ANNUAL_VOL[inst.assetClass];
  if (annualVol === undefined) throw errors.DataError('no volatility assumption for asset class ' + inst.assetClass);
  var baseSigma = annualVol / Math.sqrt(barsPerYear(timeframe, inst.weekendClosed)) * volMultiplier;

  var bars = [];
  var regimeTruth = [];
  var segments = [];

  var forced = spec.regimeSequence ? spec.regimeSequence.slice() : null;
  var regime = forced ? forced.shift() : 'RANGE';
  enums.assertEnum(enums.Regime, regime, 'regime');
  var model = REGIME_MODELS[regime];
  var segmentLeft = gen.int(model.minBars, model.maxBars);
  var segmentStart = 0;
  var trendSign = gen.bool() ? 1 : -1;
  var anchor = Math.log(price);
  var ts = nextTradableTs(startTs, stepMs, inst);

  for (var i = 0; i < count; i++) {
    if (segmentLeft <= 0) {
      segments.push({ regime: regime, fromIndex: segmentStart, toIndex: i - 1, bars: i - segmentStart, direction: trendSign > 0 ? 'LONG' : 'SHORT' });
      regime = forced && forced.length ? forced.shift() : pickWeighted(gen, TRANSITIONS[regime]);
      model = REGIME_MODELS[regime];
      segmentLeft = gen.int(model.minBars, model.maxBars);
      segmentStart = i;
      trendSign = gen.bool() ? 1 : -1;
      anchor = Math.log(price);
    }

    var sigma = baseSigma * model.volMult;
    var drift = model.driftSigmas * sigma * (model.flip ? (gen.bool() ? 1 : -1) : trendSign);
    if (model.meanReversion > 0) {
      drift += -model.meanReversion * (Math.log(price) - anchor);
    }

    var open = price;
    var ret = drift + sigma * gen.normal(0, 1);
    var close = open * Math.exp(ret);

    // Wicks: an extension beyond the body drawn from a half-normal scaled to the
    // bar's own volatility, so a quiet regime produces small wicks.
    var extScale = sigma * open;
    var hiExt = Math.abs(gen.normal(0, 1)) * extScale * WICK_SIGMAS;
    var loExt = Math.abs(gen.normal(0, 1)) * extScale * WICK_SIGMAS;
    var high = Math.max(open, close) + hiExt;
    var low = Math.min(open, close) - loExt;
    if (low <= 0) low = Math.min(open, close) * 0.999;

    var d = inst.digits;
    var bar = {
      ts: ts,
      open: money.round(open, d),
      high: money.round(high, d),
      low: money.round(low, d),
      close: money.round(close, d),
      volume: Math.round(Math.exp(gen.normal(6, 0.5)))
    };
    // Rounding can invert a doji's high/low by one tick; repair rather than emit
    // a bar that bar.validateSeries would reject.
    if (bar.high < bar.open) bar.high = bar.open;
    if (bar.high < bar.close) bar.high = bar.close;
    if (bar.low > bar.open) bar.low = bar.open;
    if (bar.low > bar.close) bar.low = bar.close;

    bars.push(bar);
    regimeTruth.push(regime);
    price = close;
    segmentLeft--;
    ts = nextTradableTs(ts + stepMs, stepMs, inst);
  }
  segments.push({ regime: regime, fromIndex: segmentStart, toIndex: count - 1, bars: count - segmentStart, direction: trendSign > 0 ? 'LONG' : 'SHORT' });

  var params = {
    symbol: inst.symbol,
    timeframe: timeframe,
    bars: count,
    seed: String(spec.seed),
    startIso: clock.iso(startTs),
    startPrice: spec.startPrice === undefined ? inst.referencePrice : spec.startPrice,
    volMultiplier: volMultiplier,
    annualVol: annualVol,
    generator: 'regime-switching-gbm-v1'
  };

  return { bars: bars, regimeTruth: regimeTruth, segments: segments, params: params };
}

/**
 * Builds a data source over generated series for a set of symbols.
 *
 * @param {object} spec
 * @param {object} spec.catalog instrument catalog
 * @param {string[]} spec.symbols
 * @param {string} spec.timeframe
 * @param {number} spec.bars
 * @param {string|number} spec.seed
 * @param {string} [spec.startIso]
 */
function createSource(spec) {
  var catalog = spec.catalog;
  var symbols = spec.symbols.slice();
  var timeframe = spec.timeframe;
  var rootSeed = String(spec.seed === undefined ? 'mythos-synthetic' : spec.seed);

  var generated = Object.create(null);
  var truth = Object.create(null);
  symbols.forEach(function (sym) {
    // Per-symbol seed derived from the root: changing one symbol's data cannot
    // silently shift another's.
    var res = generate({
      instrument: catalog.get(sym),
      timeframe: timeframe,
      bars: spec.bars,
      seed: rootSeed + '::' + sym,
      startIso: spec.startIso,
      volMultiplier: spec.volMultiplier
    });
    generated[sym] = res.bars;
    truth[sym] = { regimeTruth: res.regimeTruth, segments: res.segments, params: res.params };
  });

  var datasetVersion = 'synthetic-' + hashMod.shortHash({
    generator: 'regime-switching-gbm-v1',
    seed: rootSeed, symbols: symbols, timeframe: timeframe,
    bars: spec.bars, startIso: spec.startIso || '2023-01-02T00:00:00Z',
    volMultiplier: spec.volMultiplier === undefined ? 1 : spec.volMultiplier
  });

  var src = {
    kind: 'synthetic',
    datasetVersion: datasetVersion,
    symbols: function () { return symbols.slice(); },
    timeframes: function () { return [timeframe]; },
    load: function (symbol, tf, range) {
      if (tf !== timeframe) {
        throw errors.DataError('synthetic source was generated at ' + timeframe + ', not ' + tf +
          ' — resample with src/data/resample.js rather than regenerating');
      }
      var bars = generated[symbol];
      if (!bars) throw errors.DataError('synthetic source has no series for ' + symbol);
      if (!range || (range.fromTs === undefined && range.toTs === undefined)) return bars;
      return require('./bar').slice(bars, range.fromTs, range.toTs);
    },
    describe: function () {
      return {
        kind: 'synthetic',
        datasetVersion: datasetVersion,
        generator: 'regime-switching-gbm-v1',
        symbols: symbols.slice(),
        timeframe: timeframe,
        bars: spec.bars,
        seed: rootSeed,
        warning: 'SYNTHETIC DATA. Validates mechanics only. No statement about edge or profitability can be derived from it.'
      };
    },
    /** The generator's own regime labels — ground truth for regime tests. */
    truth: function (symbol) { return truth[symbol] || null; }
  };

  return sourceMod.assertSource(src);
}

module.exports = {
  generate: generate,
  createSource: createSource,
  ANNUAL_VOL: ANNUAL_VOL,
  REGIME_MODELS: REGIME_MODELS,
  WICK_SIGMAS: WICK_SIGMAS,
  barsPerYear: barsPerYear
};
