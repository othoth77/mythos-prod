#!/usr/bin/env node
'use strict';
// =====================================================
// Facebook Ads Monitor — daily READ-ONLY run
// projects/meta-ads-monitor/bin/meta-ads-monitor.js
//
// Facebook Ads Monitor is READ-ONLY by design: it reads Meta Ads data
// through lib/graph.js (HTTP GET against an allowlist of read endpoints),
// compares it with the previous snapshot, and writes a plain-language
// report. It never creates, edits, pauses, activates or deletes anything.
//
// Usage:
//   node projects/meta-ads-monitor/bin/meta-ads-monitor.js run
//   node projects/meta-ads-monitor/bin/meta-ads-monitor.js run --fixture <responses.json> [--now <ISO>]   offline data, no network
//   node projects/meta-ads-monitor/bin/meta-ads-monitor.js status
//
// Exit codes: 0 report written (OK or NOT_CONFIGURED) · 1 run failed ·
//             75 another run holds the lock (systemd SuccessExitStatus).
// Env: META_ADS_MONITOR_STATE_DIR, META_ADS_MONITOR_SECRET_FILE (tests/ops).
// =====================================================

var fs = require('fs');
var path = require('path');
var config = require('../lib/config.js');
var graph = require('../lib/graph.js');
var collect = require('../lib/collect.js');
var diff = require('../lib/diff.js');
var report = require('../lib/report.js');
var store = require('../lib/store.js');

var RUN_DEADLINE_MS = 10 * 60 * 1000;

function log(msg) { console.log('[meta-ads-monitor] ' + msg); }

// Offline transport: { "<path>?<sorted query without fields/limit/after>": body }
function fixtureFetch(file) {
  var map = JSON.parse(fs.readFileSync(file, 'utf8'));
  return async function (url, init) {
    if (!init || init.method !== 'GET') throw new Error('fixture transport: non-GET refused');
    var u = new URL(url);
    var p = u.pathname.replace(/^\/v\d+\.\d\//, '');
    var keep = [];
    u.searchParams.forEach(function (v, k) { if (['fields', 'limit', 'after'].indexOf(k) === -1) keep.push(k + '=' + v); });
    var key = p + (keep.length ? '?' + keep.sort().join('&') : '');
    var body = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : { data: [] };
    return { ok: true, status: 200, text: async function () { return JSON.stringify(body); } };
  };
}

function withDeadline(promise, ms) {
  var t;
  return Promise.race([promise, new Promise(function (_, rej) {
    t = setTimeout(function () { var e = new Error('run exceeded ' + ms + ' ms deadline'); e.code = 'DEADLINE'; rej(e); }, ms);
  })]).finally(function () { clearTimeout(t); });
}

async function run(argv) {
  var nowIdx = argv.indexOf('--now');
  var now = nowIdx !== -1 ? new Date(argv[nowIdx + 1]) : new Date();
  if (isNaN(now.getTime())) { console.error('invalid --now'); return 2; }
  var root = config.stateDir();
  store.ensureDirs(root);
  var release = store.acquireLock(root, now);
  if (!release) { log('another run is in progress — skipping (duplicate-run protection)'); return 75; }
  var prevStatus = store.readStatus(root) || {};
  var status = { state: null, last_run_at: now.toISOString(), last_success_at: prevStatus.last_success_at || null,
    consecutive_failures: 0, last_error: null, report: null, accounts: null, read_only: true };
  var token = null;
  try {
    var fixIdx = argv.indexOf('--fixture');
    var cfg = fixIdx !== -1 ? { state: 'CONFIGURED', token: 'fixture-token-not-a-secret', accountIds: [], version: null } : config.load();
    if (cfg.state !== 'CONFIGURED') {
      var md0 = report.renderNotConfigured({ date: now.toISOString().slice(0, 10), reason: cfg.reason, file: cfg.file });
      status.report = store.writeReport(root, md0, null, now);
      status.state = cfg.state;
      status.last_error = cfg.reason;
      log('state ' + cfg.state + ': ' + cfg.reason + ' — wrote setup report, no Meta request made');
      store.applyRetention(root, now);
      store.writeStatus(root, status);
      return 0;
    }
    token = cfg.token;
    var client = graph.createClient({ token: token, version: cfg.version || undefined,
      fetch: fixIdx !== -1 ? fixtureFetch(argv[fixIdx + 1]) : undefined });
    var snap = await withDeadline(collect.collect(client, { accountIds: cfg.accountIds, now: now, version: cfg.version || graph.DEFAULT_VERSION }), RUN_DEADLINE_MS);
    var failedAll = snap.accounts.length > 0 && snap.accounts.every(function (a) { return a.campaigns === null && a.insights.yesterday === null; });
    if (failedAll) { var fe = new Error('every data section failed for every account'); fe.code = 'NO_DATA'; throw fe; }
    var prev = store.latestSnapshot(root);
    if (prev.skipped.length) log('skipped unreadable previous snapshot(s): ' + prev.skipped.join(', '));
    var findings = diff.analyse(snap, prev.snapshot);
    var md = report.render({ date: now.toISOString().slice(0, 10), findings: findings });
    status.report = store.writeReport(root, md, token, now);
    store.writeSnapshot(root, snap, token, now);
    var removed = store.applyRetention(root, now);
    status.state = 'OK';
    status.last_success_at = now.toISOString();
    status.accounts = snap.accounts.length;
    status.requests = client.requestCount();
    log('OK: ' + snap.accounts.length + ' account(s), ' + client.requestCount() + ' GET request(s), report ' + path.basename(status.report) +
      (removed.snapshots.length + removed.reports.length ? ', retention removed ' + (removed.snapshots.length + removed.reports.length) + ' file(s)' : ''));
    store.writeStatus(root, status);
    return 0;
  } catch (e) {
    status.state = 'FAILED';
    status.consecutive_failures = (prevStatus.consecutive_failures || 0) + 1;
    status.last_error = graph.redact((e.code ? e.code + ': ' : '') + (e.message || e), token);
    log('FAILED (' + status.consecutive_failures + ' in a row): ' + status.last_error + ' — previous snapshot kept, next run retries');
    try { store.writeStatus(root, status); } catch (x) { log('could not write status: ' + x.message); }
    return 1;
  } finally {
    release();
  }
}

function showStatus() {
  var st = store.readStatus(config.stateDir());
  console.log(JSON.stringify(st || { state: 'NEVER_RUN' }, null, 2));
  return 0;
}

(async function main() {
  var cmd = process.argv[2];
  var code;
  if (cmd === 'run') code = await run(process.argv.slice(3));
  else if (cmd === 'status') code = showStatus();
  else { console.error('usage: meta-ads-monitor.js run [--fixture file] | status'); code = 2; }
  process.exitCode = code;
})();
