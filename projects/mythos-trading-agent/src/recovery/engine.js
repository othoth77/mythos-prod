'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Recovery ×3 engine (opt-in, capped)
// projects/mythos-trading-agent/src/recovery/engine.js
//
// The owner's instruction, quoted because it is the whole specification:
//
//   "Recovery ×3 may be implemented ONLY as a capped, fully risk-controlled,
//    opt-in option. It must never override the Risk Engine or the maximum-loss
//    limits."
//
// So this module CANNOT SET A POSITION SIZE. It returns `requestedLots`, which
// goes to the Risk Engine, which returns `approvedLots` — and the executor uses
// only the approved figure. There is no function here that returns a size the
// caller can act on directly, and `requestedLots` is deliberately named so that
// a call site using it as a final size reads wrong.
//
// WHAT THE LADDER ACTUALLY DOES ON $100, measured rather than assumed:
// 0.01 → 0.03 → 0.09. On a $100 account with a 2 % per-trade cap ($2) and a
// 20-pip stop on EURUSD, the minimum lot ALREADY risks exactly $2. So level 1
// requests 0.03 and is clamped straight back to 0.01, and so is level 2. The
// ladder is allowed to exist and is structurally unable to matter more than the
// limits — which is exactly what the owner asked for, and why the clamping rate
// is a headline metric rather than a footnote (ADR-0002, COMPLIANCE §3.2).
//
// THREE CAPS, NOT ONE
//   1. `enabled` defaults to FALSE. Nothing happens unless it is switched on.
//   2. `maxRecoveryLevel` caps the ladder. Reaching it is an ABANDON, not an
//      escalation: the state resets and the accumulated loss is realised rather
//      than carried into a larger bet. A ladder that "tries once more" at the cap
//      is a ladder with no cap.
//   3. The Risk Engine clamps every size regardless. That cap cannot be
//      misconfigured, because it is derived from equity and the hard limits
//      rather than from the ladder.
//
// PER-ASSET STATE (mission §7). EURUSD at level 3 and XAUUSD at base are
// independent; a loss on one never advances the other.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var instrumentMod = require('../core/instrument');

/** Why a recovery state changed. Persisted on every transition. */
var RecoveryReason = Object.freeze({
  DISABLED: 'DISABLED',
  BASE_LEVEL: 'BASE_LEVEL',
  LOSS_ESCALATED: 'LOSS_ESCALATED',
  WIN_RESET: 'WIN_RESET',
  BREAKEVEN_HELD: 'BREAKEVEN_HELD',
  CAP_ABANDONED: 'CAP_ABANDONED',
  RISK_BLOCK_ABANDONED: 'RISK_BLOCK_ABANDONED',
  TP_UNREACHABLE: 'TP_UNREACHABLE'
});

/**
 * @param {object} spec
 * @param {object} spec.config validated platform config
 * @param {object} [spec.logger]
 * @param {object} [spec.store]
 */
function create(spec) {
  var config = spec.config;
  var cfg = config.recovery;
  var logger = spec.logger || require('../core/logger').nullLogger();
  var store = spec.store || null;

  var states = Object.create(null);   // symbol → state
  var stats = { escalations: 0, resets: 0, abandonedAtCap: 0, abandonedByRisk: 0, clamped: 0, requestsMade: 0 };

  function stateFor(symbol) {
    if (!states[symbol]) {
      states[symbol] = {
        symbol: symbol,
        level: 0,
        cumulativeLossMoney: 0,
        consecutiveLosses: 0,
        lastUpdateTs: null,
        lastReason: RecoveryReason.BASE_LEVEL
      };
    }
    return states[symbol];
  }

  function record(state, reason, extra) {
    if (!store) return;
    var row = {
      ts: state.lastUpdateTs,
      symbol: state.symbol,
      level: state.level,
      cumulativeLossMoney: state.cumulativeLossMoney,
      nextLotsUncapped: uncappedLots(state.level),
      nextLotsRequested: requestedLotsFor(state).lots,
      reason: reason
    };
    Object.keys(extra || {}).forEach(function (k) { row[k] = extra[k]; });
    store.table('recovery_states').insert(row);
  }

  /** The raw ×3 ladder, ignoring every cap. Recorded so the cap is visible. */
  function uncappedLots(level) {
    return money.round(cfg.baseLots * Math.pow(cfg.multiplier, level), 6);
  }

  function requestedLotsFor(state) {
    if (!cfg.enabled) {
      return { lots: cfg.baseLots, level: 0, uncapped: cfg.baseLots, cappedByLevel: false };
    }
    var level = Math.min(state.level, cfg.maxRecoveryLevel);
    var uncapped = uncappedLots(state.level);
    return {
      lots: money.round(cfg.baseLots * Math.pow(cfg.multiplier, level), 6),
      level: level,
      uncapped: uncapped,
      cappedByLevel: state.level > cfg.maxRecoveryLevel
    };
  }

  /**
   * The size to REQUEST from the Risk Engine for the next trade on this symbol.
   *
   * The name says `request` because that is all it is. Passing this to an
   * executor without a Risk Engine verdict in between is the bug this module is
   * shaped to make obvious.
   *
   * @param {string} symbol
   * @returns {{requestedLots, level, uncappedLots, cappedByLevel, cumulativeLossMoney, enabled}}
   */
  function request(symbol) {
    var state = stateFor(symbol);
    var r = requestedLotsFor(state);
    stats.requestsMade++;
    return {
      symbol: symbol,
      enabled: cfg.enabled,
      requestedLots: r.lots,
      level: r.level,
      uncappedLots: r.uncapped,
      cappedByLevel: r.cappedByLevel,
      cumulativeLossMoney: state.cumulativeLossMoney,
      maxRecoveryLevel: cfg.maxRecoveryLevel,
      multiplier: cfg.multiplier,
      baseLots: cfg.baseLots
    };
  }

  /**
   * The take-profit distance, in pips, that would recover the accumulated loss
   * plus the cost of the recovery trade itself.
   *
   * THIS IS THE ARITHMETIC MISSION §7 ASKS FOR, and it is the part that makes
   * recovery honest: at a clamped size the required distance grows every level,
   * because the same loss has to be recovered by a position that the Risk Engine
   * refused to enlarge. When it exceeds what the candidate offers, the answer is
   * NO TRADE — not a bigger position.
   *
   * @param {object} q
   * @param {object} q.instrument
   * @param {number} q.lots the size the RISK ENGINE approved, not the request
   * @param {number} q.price
   * @param {number} q.costMoney round-trip cost estimate for this trade
   * @param {number} [q.desiredProfitMoney=0] profit wanted on top of recovery
   * @returns {{requiredPips, recoverMoney, pipValue, achievable}}
   */
  function requiredTakeProfitPips(q) {
    var state = stateFor(q.instrument.symbol);
    var pipValue = instrumentMod.pipValuePerLot(q.instrument, q.price) * q.lots;
    var recoverMoney = money.money(
      state.cumulativeLossMoney + (q.costMoney || 0) + (q.desiredProfitMoney || 0)
    );
    if (!(pipValue > 0)) {
      return { requiredPips: Infinity, recoverMoney: recoverMoney, pipValue: 0, achievable: false };
    }
    var requiredPips = money.round(recoverMoney / pipValue, 4);
    return {
      requiredPips: requiredPips,
      recoverMoney: recoverMoney,
      pipValue: money.round(pipValue, 6),
      achievable: isFinite(requiredPips)
    };
  }

  /**
   * Does this candidate's target reach far enough to recover the ladder?
   * Only meaningful when recovery is enabled AND the state is above base.
   */
  function targetCoversRecovery(q) {
    var state = stateFor(q.instrument.symbol);
    if (!cfg.enabled || state.level === 0 || !cfg.requireFullRecoveryTp) {
      return { required: false, ok: true, requiredPips: 0, offeredPips: q.offeredPips };
    }
    var req = requiredTakeProfitPips(q);
    return {
      required: true,
      ok: q.offeredPips >= req.requiredPips,
      requiredPips: req.requiredPips,
      offeredPips: q.offeredPips,
      recoverMoney: req.recoverMoney
    };
  }

  /**
   * Records that the Risk Engine refused a recovery-sized trade.
   * With `abandonOnRiskBlock` the ladder resets rather than waiting for a moment
   * when the same over-sized request might slip through — which is what an
   * un-abandoned ladder is really doing while it waits.
   */
  function onRiskBlocked(symbol, ts, reasonCodes) {
    var state = stateFor(symbol);
    if (!cfg.enabled || state.level === 0) return { reset: false, level: state.level };
    if (!cfg.abandonOnRiskBlock) return { reset: false, level: state.level };
    state.level = 0;
    state.cumulativeLossMoney = 0;
    state.consecutiveLosses = 0;
    state.lastUpdateTs = ts;
    state.lastReason = RecoveryReason.RISK_BLOCK_ABANDONED;
    stats.abandonedByRisk++;
    record(state, RecoveryReason.RISK_BLOCK_ABANDONED, { riskReasonCodes: reasonCodes || [] });
    logger.warn('recovery.abandoned', { symbol: symbol, cause: 'RISK_BLOCK', reasonCodes: reasonCodes });
    return { reset: true, level: 0 };
  }

  /**
   * Advances or resets the ladder after a closed trade.
   *
   * @param {object} trade closed trade record
   * @returns {object} the transition that was applied
   */
  function onTradeClosed(trade) {
    var state = stateFor(trade.symbol);
    var before = { level: state.level, cumulativeLossMoney: state.cumulativeLossMoney };
    state.lastUpdateTs = trade.exitTs;

    if (!cfg.enabled) {
      state.lastReason = RecoveryReason.DISABLED;
      return transition(state, before, RecoveryReason.DISABLED, trade);
    }

    if (trade.outcome === enums.TradeOutcome.WIN) {
      if (cfg.resetOnWin) {
        state.level = 0;
        state.cumulativeLossMoney = 0;
        state.consecutiveLosses = 0;
        stats.resets++;
        state.lastReason = RecoveryReason.WIN_RESET;
        record(state, RecoveryReason.WIN_RESET, { tradeId: trade.tradeId, netPnl: trade.netPnl });
        return transition(state, before, RecoveryReason.WIN_RESET, trade);
      }
    }

    if (trade.outcome === enums.TradeOutcome.BREAKEVEN) {
      // A scratch neither advances nor resets: it changed nothing, and treating
      // it as a win would let a run of scratches clear a real accumulated loss.
      state.lastReason = RecoveryReason.BREAKEVEN_HELD;
      record(state, RecoveryReason.BREAKEVEN_HELD, { tradeId: trade.tradeId, netPnl: trade.netPnl });
      return transition(state, before, RecoveryReason.BREAKEVEN_HELD, trade);
    }

    if (trade.outcome === enums.TradeOutcome.LOSS) {
      state.cumulativeLossMoney = money.money(state.cumulativeLossMoney + Math.abs(trade.netPnl));
      state.consecutiveLosses++;
      var nextLevel = state.level + 1;

      if (nextLevel > cfg.maxRecoveryLevel) {
        // THE CAP IS AN ABANDON. The accumulated loss is realised here and the
        // ladder starts again from base. A ladder that tried "just one more" at
        // the cap would have no cap.
        state.level = 0;
        var abandoned = state.cumulativeLossMoney;
        state.cumulativeLossMoney = 0;
        state.consecutiveLosses = 0;
        stats.abandonedAtCap++;
        state.lastReason = RecoveryReason.CAP_ABANDONED;
        record(state, RecoveryReason.CAP_ABANDONED, { tradeId: trade.tradeId, abandonedLossMoney: abandoned });
        logger.warn('recovery.abandoned', {
          symbol: trade.symbol, cause: 'MAX_LEVEL', maxRecoveryLevel: cfg.maxRecoveryLevel,
          abandonedLossMoney: abandoned
        });
        return transition(state, before, RecoveryReason.CAP_ABANDONED, trade, { abandonedLossMoney: abandoned });
      }

      state.level = nextLevel;
      stats.escalations++;
      state.lastReason = RecoveryReason.LOSS_ESCALATED;
      record(state, RecoveryReason.LOSS_ESCALATED, { tradeId: trade.tradeId, netPnl: trade.netPnl });
      return transition(state, before, RecoveryReason.LOSS_ESCALATED, trade);
    }

    return transition(state, before, state.lastReason, trade);
  }

  function transition(state, before, reason, trade, extra) {
    var out = {
      symbol: state.symbol,
      reason: reason,
      levelBefore: before.level,
      levelAfter: state.level,
      cumulativeLossBefore: before.cumulativeLossMoney,
      cumulativeLossAfter: state.cumulativeLossMoney,
      tradeId: trade ? trade.tradeId : null,
      nextRequestedLots: requestedLotsFor(state).lots,
      nextUncappedLots: uncappedLots(state.level)
    };
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /** Notes that the Risk Engine reduced a recovery-sized request. */
  function noteClamped() { stats.clamped++; }

  return {
    RecoveryReason: RecoveryReason,
    enabled: cfg.enabled,
    /** Binds this engine to a run's store — see the Risk Engine's attachStore. */
    attachStore: function (s) { store = s; return store; },
    request: request,
    requiredTakeProfitPips: requiredTakeProfitPips,
    targetCoversRecovery: targetCoversRecovery,
    onTradeClosed: onTradeClosed,
    onRiskBlocked: onRiskBlocked,
    noteClamped: noteClamped,
    state: function (symbol) {
      var s = stateFor(symbol);
      return { symbol: s.symbol, level: s.level, cumulativeLossMoney: s.cumulativeLossMoney, lastReason: s.lastReason };
    },
    states: function () {
      return Object.keys(states).sort().map(function (k) {
        return { symbol: k, level: states[k].level, cumulativeLossMoney: states[k].cumulativeLossMoney };
      });
    },
    /**
     * The clamping rate — how often the Risk Engine cut a recovery request.
     * Research about recovery that does not report this is describing a system
     * that was never run (COMPLIANCE §3.2).
     */
    stats: function () {
      var out = {};
      Object.keys(stats).forEach(function (k) { out[k] = stats[k]; });
      out.clampRate = stats.requestsMade > 0 ? money.round(stats.clamped / stats.requestsMade, 6) : null;
      return out;
    },
    config: function () {
      return {
        enabled: cfg.enabled, baseLots: cfg.baseLots, multiplier: cfg.multiplier,
        maxRecoveryLevel: cfg.maxRecoveryLevel, resetOnWin: cfg.resetOnWin,
        requireFullRecoveryTp: cfg.requireFullRecoveryTp, abandonOnRiskBlock: cfg.abandonOnRiskBlock,
        ladder: ladder()
      };
    },
    /** The full ladder as configured — 0.01, 0.03, 0.09 … up to the cap. */
    ladder: ladder
  };

  function ladder() {
    var out = [];
    for (var lvl = 0; lvl <= cfg.maxRecoveryLevel; lvl++) out.push(uncappedLots(lvl));
    return out;
  }
}

module.exports = {
  create: create,
  RecoveryReason: RecoveryReason
};
