'use strict';
// =====================================================
// MYTHOS TRADING AGENT — incremental bar feed
// projects/mythos-trading-agent/src/data/feed.js
//
// A backtest has the whole series up front. A paper session does not: bars arrive
// one at a time and the next bar's timestamp is not knowable in advance. That
// difference is not cosmetic — it is the reason a paper run can expose ordering
// bugs a backtest cannot, so the paper session drives a FEED rather than an array.
//
// THE INTERFACE IS DELIBERATELY POORER THAN AN ARRAY. There is no random access,
// no length, and no way to look at a bar that has not arrived. Code written
// against it therefore cannot accidentally depend on the future, and the same code
// can later be driven by a real socket without changing its shape.
//
// A tick is a GROUP of bars sharing one timestamp, because in a multi-asset session
// several instruments print at the same instant and the engine's ordering rules
// (exits before entries, one trade globally) are defined per instant rather than
// per bar.
// =====================================================

var errors = require('../core/errors');
var barMod = require('./bar');
var enums = require('../core/enums');

var REQUIRED_METHODS = ['symbols', 'next', 'isDone', 'describe'];

/** Throws unless `f` implements the feed interface. */
function assertFeed(f) {
  if (!f || typeof f !== 'object') throw errors.DataError('a feed must be an object');
  if (typeof f.kind !== 'string' || !f.kind) throw errors.DataError('a feed must declare a string `kind`');
  REQUIRED_METHODS.forEach(function (m) {
    if (typeof f[m] !== 'function') throw errors.DataError('feed "' + f.kind + '" is missing method ' + m + '()');
  });
  // A feed that offered random access would let a consumer read the future.
  ['at', 'get', 'slice', 'bars', 'all', 'length', 'peekAhead'].forEach(function (banned) {
    if (f[banned] !== undefined) {
      throw errors.DataError(
        'feed "' + f.kind + '" exposes ' + banned + ', which would let a consumer read bars that have not ' +
        'arrived. A feed is deliberately poorer than an array.'
      );
    }
  });
  return f;
}

/**
 * A feed that replays bars already in memory, one timestamp at a time.
 *
 * Used for tests and for the deterministic paper sessions this build can run. It
 * is the same shape a socket-backed feed would have, so the session code does not
 * know which it is driving.
 *
 * @param {object} spec
 * @param {object} spec.data { SYMBOL: bars[] }
 * @param {string} spec.timeframe
 * @param {boolean} [spec.validate=true]
 */
function replay(spec) {
  var data = spec.data;
  var timeframe = spec.timeframe;
  enums.assertEnum(enums.Timeframe, timeframe, 'feed timeframe');
  var symbols = Object.keys(data).sort();
  if (symbols.length === 0) throw errors.DataError('a replay feed needs at least one symbol');

  if (spec.validate !== false) {
    symbols.forEach(function (s) { barMod.validateSeries(data[s], { timeframe: timeframe }); });
  }

  // The timeline is built once, from data already held. A live feed would not have
  // this, which is exactly why it is private and never exposed.
  var seen = Object.create(null);
  symbols.forEach(function (s) {
    data[s].forEach(function (b) { seen[b.ts] = true; });
  });
  var timeline = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  var cursor = 0;
  var index = Object.create(null);
  symbols.forEach(function (s) {
    index[s] = Object.create(null);
    data[s].forEach(function (b, i) { index[s][b.ts] = i; });
  });
  var emitted = 0;

  return assertFeed({
    kind: 'replay',
    timeframe: timeframe,
    symbols: function () { return symbols.slice(); },

    /** The next tick, or null when the feed is exhausted. */
    next: function () {
      if (cursor >= timeline.length) return null;
      var ts = timeline[cursor++];
      var bars = [];
      symbols.forEach(function (s) {
        var i = index[s][ts];
        if (i === undefined) return;
        bars.push({ symbol: s, bar: data[s][i] });
      });
      emitted += bars.length;
      return { ts: ts, bars: bars };
    },

    isDone: function () { return cursor >= timeline.length; },

    describe: function () {
      return {
        kind: 'replay', timeframe: timeframe, symbols: symbols.slice(),
        ticks: timeline.length, barsEmitted: emitted, remainingTicks: timeline.length - cursor
      };
    },

    /** Progress, for a heartbeat. Not a way to read ahead. */
    progress: function () {
      return { ticksEmitted: cursor, ticksTotal: timeline.length, barsEmitted: emitted };
    }
  });
}

/**
 * Wraps a feed so every emitted bar is validated and so a tick that goes backwards
 * in time is refused.
 *
 * A live feed can deliver a stale or duplicated bar, and a session that accepted
 * one would compute indicators over a series that is not monotonic — the silent
 * corruption this guard exists to prevent.
 */
function guarded(feed) {
  assertFeed(feed);
  var lastTs = null;
  var rejected = 0;

  return assertFeed({
    kind: feed.kind + '+guarded',
    timeframe: feed.timeframe,
    symbols: function () { return feed.symbols(); },
    next: function () {
      var tick = feed.next();
      if (tick === null) return null;
      if (!tick.bars || tick.bars.length === 0) {
        throw errors.DataError('feed "' + feed.kind + '" emitted a tick with no bars at ' + tick.ts);
      }
      if (lastTs !== null && tick.ts <= lastTs) {
        rejected++;
        throw errors.DataError(
          'feed "' + feed.kind + '" went backwards: tick at ' + tick.ts + ' is not after ' + lastTs +
          '. A session that accepted it would compute indicators over a non-monotonic series.',
          { ts: tick.ts, lastTs: lastTs }
        );
      }
      tick.bars.forEach(function (entry) {
        var problem = barMod.barProblem(entry.bar);
        if (problem) {
          throw errors.DataError('feed "' + feed.kind + '" emitted an invalid ' + entry.symbol + ' bar: ' + problem);
        }
        if (entry.bar.ts !== tick.ts) {
          throw errors.DataError(
            'feed "' + feed.kind + '" put a ' + entry.symbol + ' bar stamped ' + entry.bar.ts +
            ' in a tick stamped ' + tick.ts
          );
        }
      });
      lastTs = tick.ts;
      return tick;
    },
    isDone: function () { return feed.isDone(); },
    describe: function () {
      var d = feed.describe();
      d.guarded = true;
      d.rejectedTicks = rejected;
      return d;
    },
    progress: function () { return feed.progress ? feed.progress() : null; }
  });
}

module.exports = {
  replay: replay,
  guarded: guarded,
  assertFeed: assertFeed,
  REQUIRED_METHODS: REQUIRED_METHODS
};
