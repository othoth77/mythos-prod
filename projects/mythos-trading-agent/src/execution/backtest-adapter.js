'use strict';
// =====================================================
// MYTHOS TRADING AGENT — backtest execution adapter
// projects/mythos-trading-agent/src/execution/backtest-adapter.js
//
// Simulates fills against a bar. Three rules carry all the honesty in this file:
//
//  1. A GAP FILLS AT THE OPEN, NOT AT THE LEVEL. If a bar opens through a stop,
//     the position is gone at the open price — worse than the stop. This is the
//     single most important thing a bar-replay backtest can get right, because a
//     simulator that always fills stops exactly at the stop is pretending that
//     the largest losses in real trading do not happen.
//
//  2. WHEN A BAR CONTAINS BOTH THE STOP AND THE TARGET, THE ORDER IS UNKNOWABLE.
//     OHLC does not say whether the low or the high came first. The policy is
//     configurable and defaults to STOP_FIRST — the pessimistic reading, and the
//     only one that cannot flatter a strategy. TARGET_FIRST exists so the size
//     of the ambiguity can be MEASURED (run both, compare), not so it can be
//     chosen for a nicer number.
//
//  3. ENTRIES FILL AT A BAR OPEN, NEVER AT THE CLOSE THAT PRODUCED THE SIGNAL.
//     The engine enforces the one-bar delay; this adapter refuses an entry whose
//     requested price is not the bar's open, so the rule cannot be bypassed by
//     a caller passing a different price.
//
// Frictions (spread, commission, slippage, swap) are money deductions applied by
// src/cost/model.js and are NOT folded into these prices — see that file's
// header for why.
// =====================================================

var adapterMod = require('./adapter');
var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');

var IntrabarPolicy = Object.freeze({
  STOP_FIRST: 'STOP_FIRST',
  TARGET_FIRST: 'TARGET_FIRST',
  SKIP: 'SKIP'
});

/**
 * Decides what, if anything, closes a position on this bar.
 *
 * @param {object} spec
 * @param {object} spec.position { direction, stopLoss, takeProfit }
 * @param {object} spec.bar
 * @param {string} [spec.policy='STOP_FIRST'] intrabar ambiguity policy
 * @param {boolean} [spec.isEntryBar=false] when the position opened on this bar,
 *        only the part of the bar AFTER the open can be used — see note below
 * @returns {null|{kind, price, gapped, ambiguous}}
 */
function evaluateExit(spec) {
  var pos = spec.position;
  var bar = spec.bar;
  var policy = spec.policy || IntrabarPolicy.STOP_FIRST;
  var isLong = pos.direction === enums.Direction.LONG;
  var stop = pos.stopLoss;
  var target = pos.takeProfit;

  // NOTE ON THE ENTRY BAR. When a position opens at this bar's open, the bar's
  // high and low include movement that happened after the entry, so they are
  // legitimately usable. What is NOT usable is a "gap at the open" against a
  // level, since the entry happened AT that open: a stop below the entry cannot
  // have been gapped through before the position existed. isEntryBar therefore
  // disables gap pricing while leaving trigger detection intact.
  var allowGap = !spec.isEntryBar;

  var stopHit = stop !== null && stop !== undefined &&
    (isLong ? bar.low <= stop : bar.high >= stop);
  var targetHit = target !== null && target !== undefined &&
    (isLong ? bar.high >= target : bar.low <= target);

  if (!stopHit && !targetHit) return null;

  var ambiguous = stopHit && targetHit;
  if (ambiguous && policy === IntrabarPolicy.SKIP) {
    return { kind: 'AMBIGUOUS', price: null, gapped: false, ambiguous: true };
  }

  var takeStop = stopHit && (!targetHit || policy === IntrabarPolicy.STOP_FIRST);

  if (takeStop) {
    var stopPrice = stop;
    var gapped = false;
    if (allowGap && (isLong ? bar.open < stop : bar.open > stop)) {
      // The market was already through the level when the bar opened.
      stopPrice = bar.open;
      gapped = true;
    }
    return { kind: adapterMod.FillKind.STOP, price: stopPrice, gapped: gapped, ambiguous: ambiguous };
  }

  var targetPrice = target;
  var tGapped = false;
  if (allowGap && (isLong ? bar.open > target : bar.open < target)) {
    // A favourable gap: the target was already exceeded at the open, so the fill
    // is better than the target. Modelled because it is real, and because
    // refusing to model favourable gaps while modelling adverse ones would bias
    // the result in the other direction.
    targetPrice = bar.open;
    tGapped = true;
  }
  return { kind: adapterMod.FillKind.TARGET, price: targetPrice, gapped: tGapped, ambiguous: ambiguous };
}

/**
 * @param {object} [spec]
 * @param {object} [spec.logger]
 * @param {string} [spec.mode='BACKTEST'] BACKTEST or PAPER
 * @param {string} [spec.intrabarPolicy='STOP_FIRST']
 */
function create(spec) {
  var s = spec || {};
  var logger = s.logger || require('../core/logger').nullLogger();
  var mode = s.mode || enums.Mode.BACKTEST;
  enums.assertEnum(enums.Mode, mode, 'adapter mode');
  if (mode === enums.Mode.LIVE) {
    throw errors.LiveExecutionRefused(
      'the backtest adapter cannot be constructed in LIVE mode; live execution is refused by src/execution/live-adapter.js',
      { attempted: mode }
    );
  }
  var policy = s.intrabarPolicy || IntrabarPolicy.STOP_FIRST;
  if (!IntrabarPolicy[policy]) {
    throw errors.ConfigError('intrabarPolicy must be one of [' + Object.keys(IntrabarPolicy).join(', ') + '], got ' + policy);
  }
  var fills = 0;
  var rejections = 0;

  return adapterMod.assertAdapter({
    kind: 'backtest',
    mode: mode,
    intrabarPolicy: policy,

    supportsMode: function (m) { return m === enums.Mode.BACKTEST || m === enums.Mode.PAPER; },

    /**
     * Fills a request against its bar.
     * @returns {object} a FILLED or REJECTED result from adapter.js
     */
    fill: function (req) {
      adapterMod.assertRequest(req);
      var bar = req.bar;
      var digits = req.instrument.digits;

      if (req.kind === adapterMod.FillKind.ENTRY) {
        // Guard rule 3: an entry executes at the bar's open, not at a price the
        // caller chose. A mismatch is a programming error, not a market event.
        if (money.round(req.requestedPrice, digits) !== money.round(bar.open, digits)) {
          rejections++;
          return adapterMod.rejected(
            adapterMod.RejectReason.PRICE_UNREACHABLE,
            'an entry must execute at the bar open (' + bar.open + '), not at ' + req.requestedPrice +
            '; the one-bar execution delay is enforced by the engine and must not be bypassed'
          );
        }
        fills++;
        return adapterMod.filled(money.round(bar.open, digits), bar.ts, { kind: req.kind });
      }

      if (req.kind === adapterMod.FillKind.MARKET_EXIT) {
        var px = req.atOpen ? bar.open : bar.close;
        fills++;
        return adapterMod.filled(money.round(px, digits), bar.ts, { kind: req.kind });
      }

      // STOP / TARGET: the level must actually be inside the bar.
      var reachable = req.kind === adapterMod.FillKind.STOP
        ? (req.direction === enums.Direction.LONG ? bar.low <= req.requestedPrice : bar.high >= req.requestedPrice)
        : (req.direction === enums.Direction.LONG ? bar.high >= req.requestedPrice : bar.low <= req.requestedPrice);
      if (!reachable) {
        rejections++;
        return adapterMod.rejected(
          adapterMod.RejectReason.PRICE_UNREACHABLE,
          req.kind + ' at ' + req.requestedPrice + ' is outside the bar range [' + bar.low + ', ' + bar.high + ']'
        );
      }
      fills++;
      return adapterMod.filled(money.round(req.fillPrice === undefined ? req.requestedPrice : req.fillPrice, digits), bar.ts, {
        kind: req.kind,
        gapped: !!req.gapped
      });
    },

    evaluateExit: function (position, bar, isEntryBar) {
      return evaluateExit({ position: position, bar: bar, policy: policy, isEntryBar: !!isEntryBar });
    },

    describe: function () {
      return { kind: 'backtest', mode: mode, intrabarPolicy: policy, fills: fills, rejections: rejections };
    },

    stats: function () { return { fills: fills, rejections: rejections }; }
  });
}

module.exports = {
  create: create,
  evaluateExit: evaluateExit,
  IntrabarPolicy: IntrabarPolicy
};
