'use strict';
// =====================================================
// MYTHOS TRADING AGENT — LIVE execution adapter (refusing stub)
// projects/mythos-trading-agent/src/execution/live-adapter.js
//
// THIS ADAPTER REFUSES EVERY CALL. That is its entire function, and it is not a
// placeholder to be filled in casually.
//
// It is the third of three independent locks on live execution (ADR-0002):
//
//   1. config/schema.js will not parse a configuration whose mode is LIVE.
//   2. src/mode/mode-controller.js raises the mode only for an OWNER principal
//      with a single-use, evidence-bearing, config-bound approval record.
//   3. this file — which refuses regardless of mode, approval, or caller.
//
// The consequence, stated so it cannot be mistaken for an oversight: even a
// correctly approved LIVE mode cannot place an order in this build. The
// LIVE_ADAPTER_IMPLEMENTED gate in src/mode/gates.js is listed as required for
// PAPER → LIVE precisely so that this refusal shows up as a named, unsatisfiable
// requirement in any approval attempt instead of as a surprise.
//
// Whoever eventually replaces this file: it must not be done in the same change
// as anything else, it needs the owner's explicit instruction, and the venue's
// terms of service and the jurisdiction's rules are prerequisites, not
// follow-ups. See docs/COMPLIANCE_AND_RISK.md §2.
// =====================================================

var errors = require('../core/errors');
var enums = require('../core/enums');
var adapterMod = require('./adapter');

var REFUSAL_MESSAGE =
  'LIVE execution is not implemented and is refused by design. This build is a ' +
  'research and paper-trading platform: there is no venue connectivity, no ' +
  'credentials, and no network client anywhere in projects/mythos-trading-agent. ' +
  'Reaching live execution requires the LIVE_ADAPTER_IMPLEMENTED, ' +
  'VENUE_COSTS_VERIFIED and EXTERNAL_LEGAL_REVIEW gates, none of which can be ' +
  'satisfied from this repository. See docs/COMPLIANCE_AND_RISK.md.';

/**
 * @param {object} [spec]
 * @param {object} [spec.logger] every refusal is logged at ERROR
 */
function create(spec) {
  var s = spec || {};
  var logger = s.logger || require('../core/logger').nullLogger();
  var attempts = [];

  function refuse(operation, detail) {
    var record = { at: attempts.length, operation: operation, detail: detail || null };
    attempts.push(record);
    logger.error('execution.live.refused', {
      operation: operation,
      attempt: attempts.length,
      detail: detail || null
    });
    throw errors.LiveExecutionRefused(REFUSAL_MESSAGE, { operation: operation, detail: detail || null });
  }

  var api = adapterMod.assertAdapter({
    kind: 'live-refusing-stub',
    mode: enums.Mode.LIVE,

    /** Refuses. Always. Regardless of the request, the mode, or the caller. */
    fill: function (req) {
      refuse('fill', req ? { symbol: req.instrument && req.instrument.symbol, kind: req.kind, lots: req.lots } : null);
    },

    /**
     * Reports that no mode is supported — including LIVE. An adapter that said
     * "yes, I support LIVE" and then threw would be a worse lie than one that
     * says no.
     */
    supportsMode: function () { return false; },

    describe: function () {
      return {
        kind: 'live-refusing-stub',
        implemented: false,
        refusesEveryCall: true,
        reason: REFUSAL_MESSAGE,
        requiredGates: ['LIVE_ADAPTER_IMPLEMENTED', 'VENUE_COSTS_VERIFIED', 'EXTERNAL_LEGAL_REVIEW'],
        attempts: attempts.length
      };
    },

    /** Also refuses — so an "account query" cannot be used as a way in. */
    accountState: function () { refuse('accountState'); },
    cancel: function () { refuse('cancel'); },
    positions: function () { refuse('positions'); },
    connect: function () { refuse('connect'); },

    /** Read-only: how many times something tried to execute live. */
    attempts: function () { return attempts.slice(); }
  });

  return api;
}

module.exports = {
  create: create,
  REFUSAL_MESSAGE: REFUSAL_MESSAGE
};
