'use strict';
// =====================================================
// OTHMODE — deterministic signal detectors (Evolution E1)
// projects/command-center/reference/othmode/detect.js
//
// The first automated stage of Signal Detection from the approved design
// (docs/othmode/OTHMODE_EVOLUTION.md §6 / phase E1): SIMPLE, DETERMINISTIC
// detectors over data OTHMODE already reads — no network, no LLM, no
// heuristics that could manufacture evolution noise. Run explicitly by the
// operator or a timer (othmode-cli.js detect); never on a request path,
// so reading a screen can never write a signal.
//
// Noise control is structural:
//   * every detector emits a stable dedup_key, so repeats FOLD into one
//     signal whose occurrence count grows (the thresholding input);
//   * detectors only ever record with disposition NOTED — promotion to
//     WATCH/CANDIDATE stays a reviewed, explicit act;
//   * one flaky observation therefore cannot start an evolution.
// =====================================================

var healthMod = require('./health.js');
var evolution = require('./evolution.js');

// Component states that constitute a signal-worthy observation. BLOCKED is
// deliberately excluded: a fail-closed absence (store not provisioned,
// credential not tracked) is a normal reportable state, not a failure.
var FAILING_STATES = ['FAILED', 'DEGRADED', 'REPLACEMENT_REQUIRED'];

// Task states in the unified history that indicate a real execution failure.
var FAILED_TASK_STATES = ['FAILED', 'BLOCKED', 'REFUSED'];

function detectFromHealth(overview) {
  var found = [];
  (overview.components || []).forEach(function (c) {
    if (FAILING_STATES.indexOf(c.state) === -1) return;
    found.push({
      source: 'tool-failure',
      description: c.kind + ' ' + c.name + ' is ' + c.state + (c.detail ? ' — ' + String(c.detail).slice(0, 200) : ''),
      dedup_key: 'health:' + c.id
    });
  });
  return found;
}

function detectFromHistory(historyResult) {
  var byRef = {};
  (historyResult.rows || []).forEach(function (r) {
    if (FAILED_TASK_STATES.indexOf(String(r.status).toUpperCase()) === -1) return;
    var key = r.source + ':' + (r.command_ref || r.command);
    byRef[key] = (byRef[key] || 0) + 1;
  });
  var found = [];
  Object.keys(byRef).forEach(function (key) {
    // Threshold at the detector too: a single failed task is an incident
    // for Health, not an evolution signal. Two or more repeats of the same
    // command/task failing is a pattern worth recording.
    if (byRef[key] < 2) return;
    found.push({
      source: 'repeated-failure',
      description: 'execution failed ' + byRef[key] + ' times: ' + key,
      dedup_key: 'history:' + key
    });
  });
  return found;
}

// Runs every detector and records the findings as NOTED signals. Recording
// is idempotent-by-fold: an unchanged situation on the next run increments
// occurrences on the same dedup_key instead of multiplying rows.
async function run(db, actor) {
  var overview = healthMod.overview();
  var historyLib = require('./history.js');
  var hist = await historyLib.unified(db, { limit: 200 });

  var found = detectFromHealth(overview).concat(detectFromHistory(hist));
  var recorded = [];
  found.forEach(function (f) {
    recorded.push(evolution.recordSignal(f, String(actor || 'detector')));
  });
  return {
    detectors: ['health-states', 'history-repeated-failures'],
    observations: found.length,
    recorded: recorded.map(function (r) {
      return { id: r.id, dedup_key: r.dedup_key, occurrences: r.occurrences, disposition: r.disposition };
    })
  };
}

module.exports = { run: run, detectFromHealth: detectFromHealth, detectFromHistory: detectFromHistory };
