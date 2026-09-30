'use strict';
// =====================================================
// MYTHOS TRADING AGENT — data source interface
// projects/mythos-trading-agent/src/data/source.js
//
// ADR-0001 names this as one of the five adoption seams: everything that reads
// market data goes through this interface, so a future Qlib/LEAN dataset or a
// venue history API replaces one file instead of the platform.
//
// Every source must publish a `datasetVersion`. Mission §14 requires a backtest
// to record the dataset it ran on and to be reproducible from that record — a
// source that cannot name its data makes the reproducibility claim uncheckable,
// so assertSource() refuses it.
//
// THIS BUILD HAS NO NETWORK ACCESS AND NO MARKET-DATA CREDENTIALS. The two
// concrete sources are a seeded synthetic generator and committed fixtures.
// Synthetic data validates mechanics; it cannot validate edge, and
// docs/COMPLIANCE_AND_RISK.md §3.4 says so in the same words.
// =====================================================

var errors = require('../core/errors');
var barMod = require('./bar');
var enums = require('../core/enums');

var REQUIRED_METHODS = ['symbols', 'timeframes', 'load', 'describe'];

/**
 * Throws unless `src` implements the interface.
 * @returns {object} the source, unchanged
 */
function assertSource(src) {
  if (!src || typeof src !== 'object') {
    throw errors.DataError('a data source must be an object');
  }
  if (typeof src.kind !== 'string' || src.kind.length === 0) {
    throw errors.DataError('a data source must declare a string `kind`');
  }
  if (typeof src.datasetVersion !== 'string' || src.datasetVersion.length === 0) {
    throw errors.DataError(
      'data source "' + src.kind + '" must declare a datasetVersion; a backtest that cannot name its data cannot be reproduced'
    );
  }
  REQUIRED_METHODS.forEach(function (m) {
    if (typeof src[m] !== 'function') {
      throw errors.DataError('data source "' + src.kind + '" is missing method ' + m + '()');
    }
  });
  return src;
}

/**
 * Wraps a source so every load() result is validated before it reaches the
 * engine, and so repeated loads of the same key are served from memory.
 *
 * The validation is not belt-and-braces: a fixture edited by hand, or a future
 * network source, can emit a high below a close or a duplicate timestamp, and
 * both corrupt backtest results in ways that look like strategy behaviour.
 */
function guarded(src, opts) {
  assertSource(src);
  var o = opts || {};
  var cache = Object.create(null);
  var requireContiguous = !!o.requireContiguous;

  return {
    kind: src.kind + '+guarded',
    datasetVersion: src.datasetVersion,
    symbols: function () { return src.symbols(); },
    timeframes: function (symbol) { return src.timeframes(symbol); },
    describe: function () { return src.describe(); },
    load: function (symbol, timeframe, range) {
      enums.assertEnum(enums.Timeframe, timeframe, 'timeframe');
      var key = symbol + '|' + timeframe + '|' + (range ? (range.fromTs || '') + '-' + (range.toTs || '') : 'all');
      if (cache[key]) return cache[key];
      var bars = src.load(symbol, timeframe, range);
      if (!Array.isArray(bars)) {
        throw errors.DataError('source "' + src.kind + '" returned a non-array for ' + symbol + ' ' + timeframe);
      }
      if (bars.length === 0) {
        throw errors.DataError('source "' + src.kind + '" has no bars for ' + symbol + ' ' + timeframe + ' in the requested range');
      }
      barMod.validateSeries(bars, { timeframe: timeframe, requireContiguous: requireContiguous });
      cache[key] = bars;
      return bars;
    },
    /** Structural report used by the backtest's market_data_meta record. */
    meta: function (symbol, timeframe, range) {
      var bars = this.load(symbol, timeframe, range);
      var summary = barMod.validateSeries(bars, { timeframe: timeframe });
      return {
        symbol: symbol,
        timeframe: timeframe,
        barCount: summary.bars,
        firstBarTs: summary.firstTs,
        lastBarTs: summary.lastTs,
        gapCount: summary.gaps.length,
        datasetVersion: src.datasetVersion,
        sourceKind: src.kind
      };
    },
    clearCache: function () { cache = Object.create(null); }
  };
}

/** A source backed by bars already in memory — the simplest test double. */
function fromBars(spec) {
  var datasetVersion = spec.datasetVersion;
  var data = spec.data; // { SYMBOL: { TIMEFRAME: bars } }
  if (!datasetVersion) throw errors.DataError('fromBars() requires a datasetVersion');
  return assertSource({
    kind: spec.kind || 'memory',
    datasetVersion: datasetVersion,
    symbols: function () { return Object.keys(data); },
    timeframes: function (symbol) {
      return data[symbol] ? Object.keys(data[symbol]) : [];
    },
    load: function (symbol, timeframe, range) {
      var bySymbol = data[symbol];
      if (!bySymbol) throw errors.DataError('memory source has no data for ' + symbol);
      var bars = bySymbol[timeframe];
      if (!bars) {
        throw errors.DataError('memory source has no ' + timeframe + ' data for ' + symbol +
          ' (available: ' + Object.keys(bySymbol).join(', ') + ')');
      }
      if (!range || (range.fromTs === undefined && range.toTs === undefined)) return bars;
      return barMod.slice(bars, range.fromTs, range.toTs);
    },
    describe: function () {
      return { kind: spec.kind || 'memory', datasetVersion: datasetVersion, symbols: Object.keys(data) };
    }
  });
}

module.exports = {
  assertSource: assertSource,
  guarded: guarded,
  fromBars: fromBars,
  REQUIRED_METHODS: REQUIRED_METHODS
};
