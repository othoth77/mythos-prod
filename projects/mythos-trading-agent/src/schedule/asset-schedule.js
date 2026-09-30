'use strict';
// =====================================================
// MYTHOS TRADING AGENT — per-asset trading schedule
// projects/mythos-trading-agent/src/schedule/asset-schedule.js
//
// Mission §11 asks for a per-asset schedule stored independently. This module
// answers one question — "may this instrument be traded at this instant?" — and
// returns the REASON when the answer is no, because a silently skipped bar and a
// deliberately excluded one look identical in a result.
//
// Three layers, most specific last:
//   1. the platform default (weekend, blocked weekdays)
//   2. the instrument's own declared trading hours
//   3. a per-asset override in config.schedule.perAsset
//
// The weekend rule is deliberately CONSERVATIVE — Friday 21:00 UTC to Sunday
// 21:00 UTC (src/core/clock.js). A wider closed window drops a few legitimate
// bars rather than pretending an untradable weekend price was tradable, and that
// is the direction a backtest should err.
//
// DST is NOT handled: session windows are UTC hours, so London and New York
// boundaries drift by an hour across the transitions. Recorded in
// docs/COMPLIANCE_AND_RISK.md §3.5 rather than silently ignored, and it matters
// most for the session strategy.
// =====================================================

var clock = require('../core/clock');
var errors = require('../core/errors');

var Reason = Object.freeze({
  OPEN: 'OPEN',
  FOREX_WEEKEND: 'FOREX_WEEKEND',
  OUTSIDE_INSTRUMENT_HOURS: 'OUTSIDE_INSTRUMENT_HOURS',
  OUTSIDE_ASSET_WINDOW: 'OUTSIDE_ASSET_WINDOW',
  BLOCKED_WEEKDAY: 'BLOCKED_WEEKDAY',
  ASSET_DISABLED: 'ASSET_DISABLED'
});

/**
 * @param {object} spec
 * @param {object} spec.config validated platform config
 */
function create(spec) {
  var cfg = spec.config.schedule;

  /**
   * @param {object} instrument
   * @param {number} ts
   * @returns {{open: boolean, reason: string, sessionQuality: number}}
   */
  function check(instrument, ts) {
    var perAsset = cfg.perAsset[instrument.symbol] || {};

    if (perAsset.enabled === false) {
      return closed(Reason.ASSET_DISABLED);
    }

    var blockedDays = perAsset.blockedWeekdaysUtc || cfg.blockedWeekdaysUtc;
    if (blockedDays.indexOf(clock.weekday(ts)) !== -1) {
      return closed(Reason.BLOCKED_WEEKDAY);
    }

    if (cfg.blockForexWeekend && instrument.weekendClosed && clock.isForexWeekend(ts)) {
      return closed(Reason.FOREX_WEEKEND);
    }

    if (cfg.respectInstrumentHours) {
      var th = instrument.tradingHoursUtc;
      if (th.start !== th.end && !clock.inHourWindow(ts, th.start, th.end)) {
        return closed(Reason.OUTSIDE_INSTRUMENT_HOURS);
      }
    }

    if (perAsset.startHourUtc !== undefined && perAsset.endHourUtc !== undefined) {
      if (!clock.inHourWindow(ts, perAsset.startHourUtc, perAsset.endHourUtc)) {
        return closed(Reason.OUTSIDE_ASSET_WINDOW);
      }
    }

    return { open: true, reason: Reason.OPEN, sessionQuality: sessionQuality(ts) };
  }

  function closed(reason) {
    return { open: false, reason: reason, sessionQuality: 0 };
  }

  /**
   * How tradable the hour is, 0..1. Feeds the Jev gate's confidence rather than
   * blocking: a thin session is a reason to trust a setup less, not a reason the
   * market is shut.
   *
   * The bands mirror the cost model's spread widening, so "thin" means the same
   * thing to both — an hour the cost model charges more for is an hour Jev trusts
   * less, rather than two unrelated notions of thinness.
   */
  function sessionQuality(ts) {
    var h = clock.hour(ts);
    var dow = clock.weekday(ts);
    if (dow === 0) return 0.3;              // Sunday reopen
    if (h >= 21 || h < 1) return 0.4;       // rollover
    if (h >= 1 && h < 6) return 0.65;       // thin Asian session
    if (h >= 7 && h < 17) return 1;         // London + New York
    return 0.85;
  }

  /** Every symbol the schedule would allow right now. Used by reports. */
  function openSymbols(catalog, symbols, ts) {
    return symbols.filter(function (s) { return check(catalog.get(s), ts).open; });
  }

  /**
   * A per-asset description for the store. Mission §11 wants the schedule stored
   * per asset, so this is the serialisable form.
   */
  function describe(instrument) {
    var perAsset = cfg.perAsset[instrument.symbol] || {};
    return {
      symbol: instrument.symbol,
      enabled: perAsset.enabled !== false,
      instrumentHoursUtc: cfg.respectInstrumentHours ? instrument.tradingHoursUtc : null,
      assetWindowUtc: (perAsset.startHourUtc !== undefined && perAsset.endHourUtc !== undefined)
        ? { start: perAsset.startHourUtc, end: perAsset.endHourUtc } : null,
      blockedWeekdaysUtc: (perAsset.blockedWeekdaysUtc || cfg.blockedWeekdaysUtc).slice(),
      blockForexWeekend: cfg.blockForexWeekend && instrument.weekendClosed
    };
  }

  return {
    Reason: Reason,
    check: check,
    sessionQuality: sessionQuality,
    openSymbols: openSymbols,
    describe: describe
  };
}

module.exports = {
  create: create,
  Reason: Reason
};
