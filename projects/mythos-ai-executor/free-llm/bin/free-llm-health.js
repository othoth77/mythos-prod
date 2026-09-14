#!/usr/bin/env node
'use strict';
// Runs one health probe per catalog provider (sequential, never
// parallel — see registry.js's checkAllHealth comment) and prints the
// resulting status table. Safe to run with zero credentials configured:
// every provider simply reports 'unconfigured'.
//
// Usage: node bin/free-llm-health.js [provider-id]

var registry = require('../registry');

var only = process.argv[2];

function pad(text, width) { return (text + '                              ').slice(0, width); }

function printRow(id, r) {
  console.log(
    pad(id, 34) + pad(r.status, 18) +
    'latency_ms=' + (r.latency_ms == null ? '-' : r.latency_ms) +
    (r.last_failure_reason ? '  reason=' + String(r.last_failure_reason).slice(0, 80) : '')
  );
}

var work = only ? registry.checkProviderHealth(only).then(function (r) { printRow(only, r); }) :
  registry.checkAllHealth().then(function (results) {
    Object.keys(results).sort().forEach(function (id) { printRow(id, results[id]); });
  });

work.catch(function (err) {
  console.error('FREE_LLM_HEALTH_FAILED: ' + err.message);
  process.exitCode = 1;
});
