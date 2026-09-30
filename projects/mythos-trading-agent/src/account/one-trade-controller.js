'use strict';
// =====================================================
// MYTHOS TRADING AGENT — global one-trade-only controller
// projects/mythos-trading-agent/src/account/one-trade-controller.js
//
// Mission §3: the agent may evaluate many assets and many strategies, but only
// ONE account-level trade may be open. config/schema.js pins maxOpenTrades to 1
// so it is not even a tunable.
//
// The subtlety that makes this a module rather than a boolean: a signal decided
// on bar i is executed at the open of bar i+1 (see src/backtest/engine.js — you
// cannot trade at a close you have only just observed). Between those two
// instants nothing is open, yet the slot is NOT free: if a second symbol also
// signalled on bar i, allowing it through would produce two positions one bar
// later. The slot therefore has three states, not two:
//
//   FREE → RESERVED (an entry is pending execution) → OCCUPIED (a position is
//   open) → FREE
//
// Every transition is explicit and illegal ones throw, because a controller
// that silently tolerates double-occupancy is worse than no controller: the
// backtest would show a portfolio the risk model never sized.
// =====================================================

var errors = require('../core/errors');

var SlotState = Object.freeze({
  FREE: 'FREE',
  RESERVED: 'RESERVED',
  OCCUPIED: 'OCCUPIED'
});

/**
 * @param {object} [spec]
 * @param {object} [spec.logger]
 */
function create(spec) {
  var s = spec || {};
  var logger = s.logger || require('../core/logger').nullLogger();

  var state = SlotState.FREE;
  var holder = null;     // { candidateId, symbol, since } or a position
  var history = [];
  var blocked = 0;       // how many candidates were turned away by the slot

  function transition(next, who, ts) {
    history.push({ ts: ts === undefined ? null : ts, from: state, to: next, holder: who ? (who.candidateId || who.positionId || null) : null });
    state = next;
  }

  var api = {
    SlotState: SlotState,
    state: function () { return state; },
    isFree: function () { return state === SlotState.FREE; },
    holder: function () { return holder; },
    blockedCount: function () { return blocked; },

    /**
     * Records that a candidate was refused by the slot. Called by the pipeline
     * so "how often did one-trade-only cost us a signal?" is a measured number
     * rather than a guess — it is one of the headline metrics for a $100
     * single-position account.
     */
    noteBlocked: function () { blocked++; return blocked; },

    /** Claims the slot for a pending entry. */
    reserve: function (claim, ts) {
      if (state !== SlotState.FREE) {
        throw errors.RiskAuthorityViolation(
          'one-trade-only: cannot reserve the slot for ' + (claim && claim.candidateId) +
          ' while it is ' + state + ' (held by ' + describeHolder() + ')',
          { state: state, holder: holder }
        );
      }
      holder = { candidateId: claim.candidateId, symbol: claim.symbol, since: ts };
      transition(SlotState.RESERVED, holder, ts);
      logger.debug('slot.reserved', { candidateId: claim.candidateId, symbol: claim.symbol });
      return true;
    },

    /** Turns a reservation into an open position. */
    occupy: function (position, ts) {
      if (state !== SlotState.RESERVED) {
        throw errors.RiskAuthorityViolation(
          'one-trade-only: a position may only occupy the slot from RESERVED, but the slot is ' + state,
          { state: state, positionId: position && position.positionId }
        );
      }
      if (holder && position.candidateId && holder.candidateId !== position.candidateId) {
        throw errors.RiskAuthorityViolation(
          'one-trade-only: the slot is reserved for ' + holder.candidateId + ' but ' + position.candidateId + ' tried to occupy it',
          { reservedFor: holder.candidateId, attempted: position.candidateId }
        );
      }
      holder = position;
      transition(SlotState.OCCUPIED, position, ts);
      logger.debug('slot.occupied', { positionId: position.positionId, symbol: position.symbol });
      return true;
    },

    /**
     * Releases the slot. Legal from RESERVED (the pending entry was cancelled —
     * the Risk Engine changed its mind, or the market gapped past the level) and
     * from OCCUPIED (the position closed).
     */
    release: function (reason, ts) {
      if (state === SlotState.FREE) {
        throw errors.RiskAuthorityViolation('one-trade-only: release() called on a slot that is already FREE', { reason: reason });
      }
      var was = state;
      var prior = holder;
      holder = null;
      transition(SlotState.FREE, prior, ts);
      logger.debug('slot.released', { from: was, reason: reason });
      return was;
    },

    /** The open position, or null. */
    openPosition: function () {
      return state === SlotState.OCCUPIED ? holder : null;
    },

    history: function () { return history.slice(); },

    /**
     * The invariant this module exists to guarantee, checkable from outside:
     * at no point in the recorded history were two holders in the slot at once.
     * The backtest asserts this at the end of every run.
     */
    verifyInvariant: function () {
      var depth = 0;
      for (var i = 0; i < history.length; i++) {
        var h = history[i];
        if (h.to === SlotState.RESERVED) depth++;
        if (h.to === SlotState.FREE) depth--;
        if (depth > 1 || depth < 0) {
          return { ok: false, at: i, depth: depth, entry: h };
        }
      }
      return { ok: true, transitions: history.length, depth: depth };
    }
  };

  function describeHolder() {
    if (!holder) return 'nobody';
    return (holder.candidateId || holder.positionId || '?') + ' on ' + (holder.symbol || '?');
  }

  return api;
}

module.exports = {
  create: create,
  SlotState: SlotState
};
