'use strict';
// =====================================================
// MYTHOS TRADING AGENT — deterministic identifiers
// projects/mythos-trading-agent/src/core/ids.js
//
// Record ids must be stable across reruns of the same backtest, otherwise two
// runs of one configuration produce diffs that are pure noise and the
// reproducibility claim in mission §14 cannot be checked by comparing stores.
//
// So ids are COUNTER-BASED per sequence, not time- or random-based. A sequence
// belongs to a run; the run itself is identified by its config fingerprint plus
// an explicit label, never by Date.now().
// =====================================================

/**
 * Creates an id factory.
 *
 * @param {string} runId short, stable identifier of the enclosing run
 * @returns {object} { next(prefix), peek(prefix), counters() }
 */
function createSequence(runId) {
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new TypeError('createSequence(runId) requires a non-empty string');
  }
  var counters = Object.create(null);

  return {
    runId: runId,
    /** e.g. next('cand') → 'cand-<runId>-000001' */
    next: function (prefix) {
      var p = String(prefix || 'id');
      counters[p] = (counters[p] || 0) + 1;
      return p + '-' + runId + '-' + pad(counters[p]);
    },
    /** How many ids of this prefix have been issued. */
    peek: function (prefix) {
      return counters[String(prefix || 'id')] || 0;
    },
    counters: function () {
      var out = {};
      Object.keys(counters).forEach(function (k) { out[k] = counters[k]; });
      return out;
    }
  };
}

function pad(n) {
  var s = String(n);
  while (s.length < 6) s = '0' + s;
  return s;
}

/**
 * A run id built from a label and a config fingerprint. Two runs of the same
 * config under the same label get the same run id — which is the point: their
 * stores must be byte-comparable.
 */
function runId(label, configShortHash) {
  var l = String(label || 'run').replace(/[^A-Za-z0-9_.-]+/g, '-');
  return l + '.' + String(configShortHash || 'nohash');
}

module.exports = {
  createSequence: createSequence,
  runId: runId
};
