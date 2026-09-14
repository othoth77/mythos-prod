'use strict';
// =====================================================
// MYTHOS Guardian — backup domain (read-only)
// ops/guardian/lib/backup.js
//
// Consumes what the existing backup system already produces; it does not
// schedule, run or redesign anything:
//   * ops/backup health records (~deploy/mythos-backups/health/*.json)
//   * the systemd result of the monthly restore-test units
//
// States: BACKUP_OK | BACKUP_WARNING | BACKUP_FAILED and
//         RESTORE_TEST_OK | RESTORE_TEST_UNVERIFIED | RESTORE_TEST_FAILED.
// A backup whose restore test failed or is overdue is never reported as
// BACKUP_OK: a backup that cannot be shown to restore is not healthy.
// =====================================================

var path = require('path');

function parseSystemdTime(v) {
  if (!v) return null;
  var at = /^@(\d+)/.exec(v);
  if (at) return parseInt(at[1], 10) * 1000;
  var m = /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(v);
  return m ? Date.parse(m[1] + 'T' + m[2] + 'Z') : null;
}

function collect(cfg, io) {
  var m = { records: {}, restore: {} };
  (cfg.records || []).forEach(function (r) {
    m.records[r.id] = io.exists(r.file) ? (io.readJson(r.file) || { unreadable: true }) : null;
  });
  (cfg.restore_tests || []).forEach(function (t) {
    var r = io.spawn(['systemctl', 'show', '--no-pager', '--timestamp=unix', '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ExecMainExitTimestamp', t.unit], { timeout_ms: 10000 });
    var o = {};
    (r.stdout || '').split('\n').forEach(function (l) { var i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); });
    var newestDir = null;
    if (t.fallback_dir) {
      (io.readdir(t.fallback_dir) || []).forEach(function (n) {
        var mm = /^restore-test-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(n);
        if (!mm) return;
        var ms = Date.parse(mm[1] + '-' + mm[2] + '-' + mm[3] + 'T' + mm[4] + ':' + mm[5] + ':' + mm[6] + 'Z');
        if (!newestDir || ms > newestDir) newestDir = ms;
      });
    }
    m.restore[t.id] = { result: o.Result || null, exec_status: o.ExecMainStatus || null, exit_at_ms: parseSystemdTime(o.ExecMainExitTimestamp), newest_dir_ms: newestDir };
  });
  return m;
}

function classify(m, cfg, prev, ctx) {
  var nowMs = ctx.nowMs;
  var findings = [];
  var recStates = {}, resStates = {};

  (cfg.records || []).forEach(function (r) {
    var h = m.records[r.id];
    var st, why = null;
    if (!h) { st = r.required ? 'BACKUP_FAILED' : 'BACKUP_WARNING'; why = 'no health record at ' + r.file; }
    else if (h.unreadable) { st = 'BACKUP_FAILED'; why = 'unreadable health record'; }
    else {
      var last = Date.parse(h.last_success_at || '');
      var ageH = isNaN(last) ? Infinity : (nowMs - last) / 3600000;
      if (ageH <= (r.fresh_hours || 26) && h.status === 'ok') st = 'BACKUP_OK';
      else if (ageH <= (r.failed_hours || 50)) { st = 'BACKUP_WARNING'; why = h.status === 'ok' ? 'last success ' + Math.round(ageH) + ' h ago' : 'last run failed; last success ' + Math.round(ageH) + ' h ago'; }
      else { st = 'BACKUP_FAILED'; why = isFinite(ageH) ? 'no successful backup for ' + Math.round(ageH) + ' h' : 'no successful backup ever recorded'; }
    }
    recStates[r.id] = { state: st, detail: why, last_success_at: h && h.last_success_at || null, consecutive_failures: h && h.consecutive_failures };
    if (st !== 'BACKUP_OK') findings.push({ severity: st === 'BACKUP_FAILED' ? 'HIGH' : 'WARNING', kind: st.toLowerCase(), affected: r.id, trigger: r.id + ': ' + why });
  });

  (cfg.restore_tests || []).forEach(function (t) {
    var o = m.restore[t.id] || {};
    var maxMs = (t.max_age_days || 40) * 86400000;
    var st, why = null;
    if (o.exit_at_ms && o.result) {
      if (o.result !== 'success' || (o.exec_status && o.exec_status !== '0')) { st = 'RESTORE_TEST_FAILED'; why = 'last run result ' + o.result + ' status ' + o.exec_status; }
      else if (nowMs - o.exit_at_ms > maxMs) { st = 'RESTORE_TEST_FAILED'; why = 'no restore test in ' + t.max_age_days + ' days'; }
      else st = 'RESTORE_TEST_OK';
    } else if (o.newest_dir_ms && nowMs - o.newest_dir_ms <= maxMs) {
      st = 'RESTORE_TEST_UNVERIFIED'; why = 'result not in systemd (host rebooted?); newest restore-test directory is recent';
    } else { st = 'RESTORE_TEST_FAILED'; why = 'no evidence of a restore test within ' + (t.max_age_days || 40) + ' days'; }
    resStates[t.id] = { state: st, detail: why, last_run_at: o.exit_at_ms ? new Date(o.exit_at_ms).toISOString() : null };
    if (st !== 'RESTORE_TEST_OK') findings.push({ severity: 'WARNING', kind: st.toLowerCase(), affected: t.id, trigger: t.id + ': ' + why });
  });

  var recList = Object.keys(recStates).map(function (k) { return recStates[k].state; });
  var resList = Object.keys(resStates).map(function (k) { return resStates[k].state; });
  var backupState = recList.indexOf('BACKUP_FAILED') >= 0 ? 'BACKUP_FAILED'
    : (recList.indexOf('BACKUP_WARNING') >= 0 ? 'BACKUP_WARNING' : 'BACKUP_OK');
  var restoreState = resList.indexOf('RESTORE_TEST_FAILED') >= 0 ? 'RESTORE_TEST_FAILED'
    : (resList.indexOf('RESTORE_TEST_UNVERIFIED') >= 0 ? 'RESTORE_TEST_UNVERIFIED' : 'RESTORE_TEST_OK');
  if (backupState === 'BACKUP_OK' && restoreState !== 'RESTORE_TEST_OK') backupState = 'BACKUP_WARNING';

  var raw = backupState === 'BACKUP_FAILED' ? 'HIGH' : (backupState === 'BACKUP_WARNING' ? 'WARNING' : 'NORMAL');
  return {
    raw: raw, immediate: false, findings: findings, plan: [], stateOut: {},
    summary: { backup_state: backupState, restore_test_state: restoreState, records: recStates, restore_tests: resStates }
  };
}

module.exports = { collect: collect, classify: classify, parseSystemdTime: parseSystemdTime };
