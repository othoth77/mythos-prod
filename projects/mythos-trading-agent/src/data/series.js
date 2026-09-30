'use strict';
// =====================================================
// MYTHOS TRADING AGENT — series and the look-ahead-proof view
// projects/mythos-trading-agent/src/data/series.js
//
// Mission §14: "Prevent look-ahead bias. Prevent data leakage."
//
// Those are not achieved by being careful. They are achieved by making the
// future UNREACHABLE. A strategy never receives the bar array; it receives a
// VIEW pinned to bar index i, whose entire API is expressed in offsets BACKWARD
// from i. `view.bar(-1)` does not return tomorrow's bar — it throws, with a
// message naming look-ahead, so the mistake surfaces in a test instead of in a
// backtest that looks wonderful.
//
// Indicators are precomputed over the whole array for speed, which is only safe
// because every indicator in src/indicators/ is CAUSAL: value[j] depends on
// bars 0..j and never on j+1. tests/data-layer-test.js proves that property
// mechanically — it recomputes each indicator over a prefix and requires the
// last value to be identical. An indicator that peeked would fail that test,
// which is the only defence that keeps working as indicators are added.
//
// Insufficient history is distinguished from look-ahead on purpose:
//   * asking for the future     → throws (a bug, always)
//   * asking for more past than exists → null (normal during warmup)
// =====================================================

var errors = require('../core/errors');
var barMod = require('./bar');

/**
 * @param {object} spec
 * @param {string} spec.symbol
 * @param {string} spec.timeframe
 * @param {object[]} spec.bars validated ascending bars
 * @param {boolean} [spec.validate=true]
 */
function create(spec) {
  var symbol = spec.symbol;
  var timeframe = spec.timeframe;
  var bars = spec.bars;
  if (spec.validate !== false) barMod.validateSeries(bars, { timeframe: timeframe });

  var indicators = Object.create(null);
  var closes = bars.map(function (b) { return b.close; });
  var highs = bars.map(function (b) { return b.high; });
  var lows = bars.map(function (b) { return b.low; });
  var opens = bars.map(function (b) { return b.open; });

  var api = {
    symbol: symbol,
    timeframe: timeframe,
    length: bars.length,
    bars: function () { return bars; },
    closes: function () { return closes; },
    highs: function () { return highs; },
    lows: function () { return lows; },
    opens: function () { return opens; },

    /**
     * Registers a precomputed indicator array (or a function of the series).
     * The array must be the same length as the series and causal.
     */
    addIndicator: function (name, valuesOrFn) {
      var values = typeof valuesOrFn === 'function' ? valuesOrFn(api) : valuesOrFn;
      if (!Array.isArray(values) || values.length !== bars.length) {
        throw errors.DataError(
          'indicator "' + name + '" must be an array of ' + bars.length + ' values, got ' +
          (Array.isArray(values) ? values.length : typeof values)
        );
      }
      indicators[name] = values;
      return api;
    },
    hasIndicator: function (name) { return !!indicators[name]; },
    indicatorNames: function () { return Object.keys(indicators); },
    indicatorValues: function (name) {
      if (!indicators[name]) throw errors.DataError('unknown indicator "' + name + '" on ' + symbol + ' ' + timeframe);
      return indicators[name];
    },

    /** A view pinned to bar `i`. The only thing a strategy ever sees. */
    viewAt: function (i) {
      if (!(i >= 0 && i < bars.length && i === Math.floor(i))) {
        throw errors.DataError('viewAt(' + i + ') is outside the series (0..' + (bars.length - 1) + ')');
      }
      return makeView(i);
    }
  };

  function checkOffset(offset, what) {
    if (typeof offset !== 'number' || offset !== Math.floor(offset)) {
      throw errors.DataError(what + '(' + offset + ') needs an integer offset');
    }
    if (offset < 0) {
      throw errors.DataError(
        'LOOK-AHEAD: ' + what + '(' + offset + ') asks for a bar after the current one. ' +
        'Views are backward-only; offset 0 is the current bar, 1 is the previous.',
        { offset: offset, symbol: symbol, timeframe: timeframe }
      );
    }
  }

  function makeView(i) {
    var view = {
      symbol: symbol,
      timeframe: timeframe,
      index: i,
      /** Number of bars visible: i + 1. */
      size: i + 1,
      ts: bars[i].ts,

      /** Bar at `offset` bars back. null when that far back does not exist. */
      bar: function (offset) {
        var off = offset === undefined ? 0 : offset;
        checkOffset(off, 'bar');
        var j = i - off;
        return j >= 0 ? bars[j] : null;
      },

      /** True when at least n bars of history are visible. */
      hasHistory: function (n) { return i + 1 >= n; },

      /** The last n closes, oldest → newest. null when history is short. */
      closes: function (n) { return window(closes, n); },
      highs: function (n) { return window(highs, n); },
      lows: function (n) { return window(lows, n); },
      opens: function (n) { return window(opens, n); },
      /** The last n bars, oldest → newest. */
      window: function (n) { return window(bars, n); },

      /** Indicator value `offset` bars back; null during warmup. */
      indicator: function (name, offset) {
        var off = offset === undefined ? 0 : offset;
        checkOffset(off, 'indicator');
        var values = api.indicatorValues(name);
        var j = i - off;
        return j >= 0 ? values[j] : null;
      },

      /** Last n values of an indicator, oldest → newest. */
      indicatorWindow: function (name, n) { return window(api.indicatorValues(name), n); },

      /** Highest high over the last n bars (including the current one). */
      highest: function (n) {
        var w = window(highs, n);
        return w === null ? null : w.reduce(function (a, b) { return b > a ? b : a; }, -Infinity);
      },
      /** Lowest low over the last n bars (including the current one). */
      lowest: function (n) {
        var w = window(lows, n);
        return w === null ? null : w.reduce(function (a, b) { return b < a ? b : a; }, Infinity);
      },

      /** Convenience: the current bar. */
      current: function () { return bars[i]; },
      /** Convenience: the current close. */
      close: function () { return bars[i].close; },
      typical: function () { return barMod.typical(bars[i]); }
    };

    function window(arr, n) {
      if (typeof n !== 'number' || n < 1) throw errors.DataError('window size must be >= 1, got ' + n);
      var start = i - n + 1;
      if (start < 0) return null;
      return arr.slice(start, i + 1);
    }

    return view;
  }

  return api;
}

module.exports = {
  create: create
};
