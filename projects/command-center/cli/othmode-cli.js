#!/usr/bin/env node
'use strict';
// =====================================================
// OTHMODE — operator CLI
// projects/command-center/cli/othmode-cli.js
//
// The operator-side path to the OTHMODE store: read/flip the OthMode
// switch, record signals and evolution events, advance stages, record
// recovery steps — all without the HTTP layer (and therefore usable when
// the service is down, which is exactly when recovery records matter).
// Same append-only store module as the API; the CLI actor is recorded as
// operator:<os user>. HIGH-risk review approval via this CLI is a HUMAN
// acting by definition — the store records who.
//
// Usage:
//   node othmode-cli.js mode [ON|OFF]
//   node othmode-cli.js signal <source> "<description>" [dedup_key]
//   node othmode-cli.js signals
//   node othmode-cli.js event "<title>" <LOW|MEDIUM|HIGH> [gene_type]
//   node othmode-cli.js stage <event-id> <STAGE> '<json data>'
//   node othmode-cli.js events
//   node othmode-cli.js recovery <component> <STEP> ["note"] [STATE]
//   node othmode-cli.js store-status
//
// Environment: OTHMODE_STORE_ROOT overrides the store location.
// =====================================================

var os = require('os');
var store = require('../reference/othmode/store.js');
var evolution = require('../reference/othmode/evolution.js');
var healthMod = require('../reference/othmode/health.js');

var actor = 'operator:' + (os.userInfo().username || 'unknown');
var args = process.argv.slice(2);
var cmd = args[0];

function out(x) { console.log(JSON.stringify(x, null, 2)); }
function fail(msg) { console.error('ERROR: ' + msg); process.exit(1); }

try {
  if (cmd === 'mode') {
    if (args[1] === 'ON' || args[1] === 'OFF') {
      out(store.setMode(args[1], actor));
      var ev = evolution.createEvent({ title: 'OthMode switched ' + args[1] + ' (CLI)', risk_tier: 'LOW', trigger: 'operator CLI' }, actor);
      evolution.addStage(ev.id, { stage: 'RESULT', data: { outcome: 'APPLIED' } }, actor, 'owner');
    } else {
      out(store.getMode());
    }
  } else if (cmd === 'signal') {
    if (!args[1] || !args[2]) fail('usage: signal <source> "<description>" [dedup_key]');
    out(evolution.recordSignal({ source: args[1], description: args[2], dedup_key: args[3] }, actor));
  } else if (cmd === 'signals') {
    out(evolution.listSignals());
  } else if (cmd === 'event') {
    if (!args[1] || !args[2]) fail('usage: event "<title>" <LOW|MEDIUM|HIGH> [gene_type]');
    out(evolution.createEvent({ title: args[1], risk_tier: args[2], gene_type: args[3] }, actor));
  } else if (cmd === 'stage') {
    if (!args[1] || !args[2]) fail('usage: stage <event-id> <STAGE> \'<json data>\'');
    var data = args[3] ? JSON.parse(args[3]) : {};
    // A human is at this keyboard: the CLI carries the owner role. The
    // HTTP path derives the role from the bearer token instead.
    out(evolution.addStage(args[1], { stage: args[2], data: data }, actor, 'owner'));
  } else if (cmd === 'events') {
    out(evolution.listEvents());
  } else if (cmd === 'recovery') {
    if (!args[1] || !args[2]) fail('usage: recovery <component> <STEP> ["note"] [STATE]');
    out(healthMod.recordRecoveryStep({ component: args[1], step: args[2], note: args[3], state: args[4] }, actor));
  } else if (cmd === 'store-status') {
    out({ root: store.root(), provisioned: store.provisioned(), mode: store.getMode() });
  } else {
    fail('unknown command "' + (cmd || '') + '" — see the header of this file for usage');
  }
} catch (e) {
  fail(e.message);
}
