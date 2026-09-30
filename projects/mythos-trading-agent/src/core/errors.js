'use strict';
// =====================================================
// MYTHOS TRADING AGENT — typed errors
// projects/mythos-trading-agent/src/core/errors.js
//
// A refusal must be distinguishable from a bug. `LiveExecutionRefused` and
// `ModeTransitionRefused` are not failures of this system — they are it working
// — so they carry a `refusal: true` marker that callers and tests assert on,
// and they are never caught-and-continued by generic error handling.
// =====================================================

function define(name, defaults) {
  function Err(message, details) {
    var e = new Error(message);
    e.name = name;
    e.code = (defaults && defaults.code) || name;
    e.refusal = !!(defaults && defaults.refusal);
    e.details = details || {};
    if (Error.captureStackTrace) Error.captureStackTrace(e, Err);
    return e;
  }
  Err.errorName = name;
  return Err;
}

module.exports = {
  /** Configuration failed validation. Nothing ran. */
  ConfigError: define('ConfigError', { code: 'CONFIG_INVALID' }),

  /** A data source could not satisfy a request (missing bars, gap, bad order). */
  DataError: define('DataError', { code: 'DATA_INVALID' }),

  /** A strategy produced a candidate that does not satisfy the schema. */
  CandidateError: define('CandidateError', { code: 'CANDIDATE_INVALID' }),

  /**
   * The LIVE adapter was asked to do anything at all. This is the designed
   * behaviour of the platform in its current stage, not an incident.
   */
  LiveExecutionRefused: define('LiveExecutionRefused', {
    code: 'LIVE_EXECUTION_REFUSED', refusal: true
  }),

  /**
   * A mode change was attempted without a valid owner-approval record, or
   * along a path the lifecycle forbids.
   */
  ModeTransitionRefused: define('ModeTransitionRefused', {
    code: 'MODE_TRANSITION_REFUSED', refusal: true
  }),

  /** A component tried to overrule the Risk Engine. */
  RiskAuthorityViolation: define('RiskAuthorityViolation', {
    code: 'RISK_AUTHORITY_VIOLATION', refusal: true
  }),

  /** Persistence layer failure (append to a sealed run, unknown table, ...). */
  StoreError: define('StoreError', { code: 'STORE_ERROR' }),

  /** A promotion gate was not satisfied. */
  PromotionRefused: define('PromotionRefused', {
    code: 'PROMOTION_REFUSED', refusal: true
  }),

  /** True for errors that represent a designed refusal rather than a defect. */
  isRefusal: function (e) {
    return !!(e && e.refusal === true);
  }
};
