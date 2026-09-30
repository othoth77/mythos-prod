'use strict';
// =====================================================
// MYTHOS TRADING AGENT — PAPER execution adapter
// projects/mythos-trading-agent/src/execution/paper-adapter.js
//
// Paper trading places no real order and risks no real money, but it is NOT a
// backtest, and the difference has to be visible in every record it produces.
// Otherwise a paper fill and a simulated fill are indistinguishable in the store,
// and the demo evidence a promotion depends on cannot be told from the backtest it
// is supposed to corroborate.
//
// So this adapter:
//
//  1. REFUSES ANY MODE BUT PAPER. Constructing it outside PAPER throws, and PAPER
//     is only reachable through an owner-approval record (src/mode/). A caller
//     cannot get paper-marked records out of a backtest by choosing an adapter.
//
//  2. MARKS EVERY FILL. `paper: true`, plus the wall-clock instant the fill was
//     computed alongside the bar's own timestamp. In a backtest those two are
//     unrelated; in a paper session their difference is the session's latency, and
//     a large one means the system is falling behind its own feed.
//
//  3. SHARES ITS FILL ARITHMETIC WITH THE BACKTEST ADAPTER. The gap-fills-at-the-
//     open rule, the intrabar ambiguity policy and the entry-at-bar-open guard are
//     imported rather than reimplemented. Paper and backtest results are only
//     comparable if the fill model is literally the same code, and
//     tests/paper-test.js asserts the two produce identical trades over identical
//     bars.
//
// It still places no order anywhere. There is no network client in this project,
// and the LIVE adapter refuses regardless (src/execution/live-adapter.js).
// =====================================================

var adapterMod = require('./adapter');
var backtestAdapter = require('./backtest-adapter');
var enums = require('../core/enums');
var errors = require('../core/errors');

/**
 * @param {object} spec
 * @param {object} spec.modeController REQUIRED — the adapter checks the live mode
 *        rather than trusting a flag
 * @param {object} [spec.logger]
 * @param {string} [spec.intrabarPolicy]
 * @param {function} [spec.now] wall clock, injected so tests stay deterministic
 */
function create(spec) {
  var o = spec || {};
  if (!o.modeController || typeof o.modeController.mode !== 'function') {
    throw errors.ConfigError(
      'the paper adapter requires a modeController. It checks the live mode on every fill rather than ' +
      'trusting a constructor flag, because a flag is exactly what an agent can set.'
    );
  }
  var modeController = o.modeController;
  var logger = o.logger || require('../core/logger').nullLogger();
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };

  // Checked at construction AND on every fill. Construction alone would leave a
  // window in which the mode was downgraded and the adapter kept filling.
  assertPaper('construct a paper adapter');

  // The fill arithmetic is the backtest adapter's, unchanged.
  var inner = backtestAdapter.create({
    logger: logger,
    mode: enums.Mode.PAPER,
    intrabarPolicy: o.intrabarPolicy
  });

  var fills = 0;
  var rejections = 0;
  var maxLatencyMs = 0;
  var lastHeartbeat = null;

  function assertPaper(what) {
    var mode = modeController.mode();
    if (mode !== enums.Mode.PAPER) {
      throw errors.ModeTransitionRefused(
        'cannot ' + what + ': the platform is in ' + mode + ', not PAPER. Paper records must be ' +
        'distinguishable from backtest records, so this adapter refuses to produce them outside PAPER mode. ' +
        'Reaching PAPER requires an owner-approval record (src/mode/mode-controller.js).',
        { mode: mode, required: enums.Mode.PAPER }
      );
    }
    return mode;
  }

  return adapterMod.assertAdapter({
    kind: 'paper',
    mode: enums.Mode.PAPER,
    intrabarPolicy: inner.intrabarPolicy,

    /** PAPER only. Not BACKTEST, and certainly not LIVE. */
    supportsMode: function (m) { return m === enums.Mode.PAPER; },

    fill: function (req) {
      assertPaper('fill an order');
      var wallClock = now();
      var res = inner.fill(req);
      if (res.status === 'FILLED') {
        fills++;
        // The two clocks: the bar's own time, and when we actually got to it.
        res.paper = true;
        res.wallClockAt = wallClock;
        res.latencyMs = req.bar && typeof req.bar.ts === 'number' ? wallClock - req.bar.ts : null;
        if (res.latencyMs !== null && res.latencyMs > maxLatencyMs) maxLatencyMs = res.latencyMs;
      } else {
        rejections++;
        res.paper = true;
        res.wallClockAt = wallClock;
      }
      return res;
    },

    evaluateExit: function (position, bar, isEntryBar) {
      assertPaper('evaluate an exit');
      return inner.evaluateExit(position, bar, isEntryBar);
    },

    /**
     * A heartbeat, which a backtest has no use for and a paper session does: it is
     * how an operator sees that the session is alive and keeping up.
     */
    heartbeat: function (detail) {
      lastHeartbeat = {
        at: now(), mode: modeController.mode(), fills: fills, rejections: rejections,
        maxLatencyMs: maxLatencyMs, detail: detail || null
      };
      logger.info('paper.heartbeat', lastHeartbeat);
      return lastHeartbeat;
    },

    lastHeartbeat: function () { return lastHeartbeat; },

    describe: function () {
      return {
        kind: 'paper',
        mode: modeController.mode(),
        placesRealOrders: false,
        intrabarPolicy: inner.intrabarPolicy,
        fills: fills,
        rejections: rejections,
        maxLatencyMs: maxLatencyMs,
        note: 'No order reaches any venue. There is no network client in this project, and the LIVE adapter ' +
          'refuses every call regardless of mode.'
      };
    },

    stats: function () {
      return { fills: fills, rejections: rejections, maxLatencyMs: maxLatencyMs };
    }
  });
}

module.exports = { create: create };
