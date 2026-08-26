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
//   node othmode-cli.js detect                  run deterministic signal detectors
//   node othmode-cli.js export [dest-dir]       snapshot the store for backup
//   node othmode-cli.js login-link [identity]   one-time browser sign-in URL
//   node othmode-cli.js sessions                count active sessions/codes
//   node othmode-cli.js revoke-sessions         sign every browser out
//
// Environment: OTHMODE_STORE_ROOT overrides the store location.
// =====================================================

var os = require('os');
var store = require('../reference/othmode/store.js');
var evolution = require('../reference/othmode/evolution.js');
var healthMod = require('../reference/othmode/health.js');
var sessions = require('../reference/othmode/sessions.js');

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
  } else if (cmd === 'detect') {
    // Deterministic E1 detectors (health states + repeated execution
    // failures). No database on the CLI path: the library source is
    // covered by the service; the file-backed sources are what the
    // detectors need. Findings fold by dedup_key; disposition stays NOTED.
    var detect = require('../reference/othmode/detect.js');
    var stubDb = { query: function () { return Promise.reject(new Error('cli: no db')); } };
    detect.run(stubDb, actor).then(function (r) { out(r); }).catch(function (e) { fail(e.message); });
  } else if (cmd === 'export') {
    // Backup/recovery for the OTHMODE store: copies the append-only
    // streams and the switch config — with a manifest of sha256 sums —
    // into a timestamped snapshot directory. SESSIONS ARE DELIBERATELY
    // EXCLUDED: session hashes are auth material, not evolution history,
    // and a restored backup must never resurrect old sign-ins.
    var fsx = require('fs');
    var pathx = require('path');
    var cryptox = require('crypto');
    if (!store.provisioned()) fail('store not provisioned — nothing to export');
    var destRoot = args[1] || pathx.join(os.homedir(), 'mythos-backups', 'othmode-store');
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    var dest = pathx.join(destRoot, stamp);
    var items = ['evolution/events.jsonl', 'recovery/records.jsonl', 'config/othmode.json'];
    var manifest = { exported_at: new Date().toISOString(), source: store.root(), files: {} };
    fsx.mkdirSync(dest, { recursive: true, mode: 448 });
    items.forEach(function (rel) {
      var src = pathx.join(store.root(), rel);
      var body;
      try { body = fsx.readFileSync(src); } catch (e) { return; } // absent stream = nothing yet
      var target = pathx.join(dest, rel.replace(/\//g, '__'));
      fsx.writeFileSync(target, body, { mode: 384 });
      manifest.files[rel] = { sha256: cryptox.createHash('sha256').update(body).digest('hex'), bytes: body.length };
    });
    // Evidence objects: content-addressed, copied verbatim.
    var evDir = pathx.join(store.root(), 'evolution', 'evidence');
    var evOut = pathx.join(dest, 'evidence');
    try {
      var names = fsx.readdirSync(evDir);
      fsx.mkdirSync(evOut, { recursive: true, mode: 448 });
      names.forEach(function (n) {
        if (!/^[0-9a-f]{64}$/.test(n)) return;
        fsx.copyFileSync(pathx.join(evDir, n), pathx.join(evOut, n));
      });
      manifest.evidence_objects = names.length;
    } catch (e) { manifest.evidence_objects = 0; }
    fsx.writeFileSync(pathx.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 384 });
    out({ exported_to: dest, files: Object.keys(manifest.files), evidence_objects: manifest.evidence_objects });
  } else if (cmd === 'login-link') {
    // Token-free browser sign-in: prints a ONE-TIME URL (15-minute TTL).
    // Open it once in the browser that should stay signed in; the code is
    // burned on use and only its hash was ever stored. The identity
    // defaults to owner — this CLI runs on the host as the operator, which
    // is already the owner trust boundary.
    var identity = args[1] || 'owner';
    var minted = sessions.createLoginCode(identity);
    var base = process.env.OTHMODE_BASE_URL || 'https://othmode.mythosprod.xyz';
    console.log(base + '/auth/' + minted.code);
    console.error('one-time login link for identity "' + identity + '" — expires ' + minted.expires_at + ', single use');
  } else if (cmd === 'sessions') {
    out(sessions.status());
  } else if (cmd === 'revoke-sessions') {
    out({ revoked: sessions.revokeAll() });
  } else {
    fail('unknown command "' + (cmd || '') + '" — see the header of this file for usage');
  }
} catch (e) {
  fail(e.message);
}
