'use strict';
// =====================================================
// MYTHOS Autopilot — unified operational state
// projects/mythos-ai-executor/lib/autopilot/status.js
//
//   SOURCE / CODE / RUNTIME / BRIDGE / EXECUTOR / TASKS / WORKTREES /
//   RESOURCE / LIFECYCLE / CLEANUP / DEPLOYMENT
//
// One JSON document assembled from the other autopilot modules plus the
// guard/lifecycle state files. Written atomically to <root>/state.json by
// every tick and served by GET /autopilot on the executor; the Status Center
// monitor can consume it through an `autopilot-state` probe. Every section
// is measured or explicitly UNKNOWN — never curated.
// =====================================================

var fs = require('fs');
var path = require('path');

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
function marker(root, name) { try { fs.statSync(path.join(root, name)); return true; } catch (e) { return false; } }

function bridgeState(executorHome, now) {
  var fence = readJson(path.join(executorHome, 'bridge', 'fence.json'));
  var age = fence && fence.updated_at ? now - Date.parse(fence.updated_at) : null;
  var lock = readJson(path.join(executorHome, 'bridge', 'bridge.lock'));
  return { last_tick_at: fence ? fence.updated_at : null, last_tick_age_ms: age, fence: fence ? fence.fence : null, lock_held: !!lock, healthy: age !== null && age < 10 * 60 * 1000 ? true : (age === null ? null : false) };
}

function resourceState(executorHome, now) {
  var st = readJson(path.join(executorHome, 'resource-guard.json'));
  if (!st) return { level: 'UNKNOWN' };
  var age = st.updated_at ? now - Date.parse(st.updated_at) : null;
  return { level: st.level || 'UNKNOWN', updated_at: st.updated_at || null, stale: age === null || age > 5 * 60 * 1000, signals: st.last_sample || null };
}

function lifecycleState(executorHome) {
  var root = process.env.MYTHOS_LIFECYCLE_HOME || path.join(executorHome, 'lifecycle');
  var present = fs.existsSync(root);
  var env = String(process.env.MYTHOS_LIFECYCLE_CLEANUP || '').toLowerCase();
  var cleanup = env === 'off' ? 'disabled' : (env === 'on' || marker(root, 'cleanup.enabled') ? 'enabled' : 'disabled');
  return { registry_present: present, cleanup: cleanup, root: root };
}

function build(parts) {
  var now = parts.now || Date.now();
  var d = parts.drift || {};
  var ins = parts.inspection || {};
  var wd = parts.watchdog || {};
  var wt = parts.worktrees || {};
  var deployment;
  if (!d.state || d.state === 'SOURCE_UNVERIFIED') deployment = 'BLOCKED';
  else if (d.state === 'CURRENT') deployment = 'CURRENT';
  else if (d.state === 'CODE_BEHIND_SOURCE' || d.state === 'EXECUTOR_RESTART_REQUIRED') deployment = 'DRIFTED';
  else deployment = 'BLOCKED';
  var executorState = !d.executor ? 'UNKNOWN' : (!d.executor.alive ? 'DOWN' : (d.state === 'EXECUTOR_RESTART_REQUIRED' ? 'RESTART_REQUIRED' : (d.executor.health && d.executor.health.ok ? 'HEALTHY' : (d.executor.health && d.executor.health.error ? 'UNHEALTHY' : 'UNVERIFIED'))));
  var bridge = bridgeState(parts.executor_home, now);
  var tasks = { scanned: wd.tasks_scanned || 0, state: wd.state || 'UNKNOWN', counts: wd.counts || {}, findings: (wd.findings || []).map(function (f) { return { code: f.code, mode: f.mode, task_id: f.task_id, first_seen: f.first_seen || null }; }) };
  return {
    version: 1,
    measured_at: new Date(now).toISOString(),
    SOURCE: { ref: d.source ? d.source.ref : 'origin/main', sha: d.source ? d.source.sha : null, fetch_ok: ins.fetch_ok === undefined ? null : ins.fetch_ok },
    CODE: { sha: ins.head || null, branch: ins.current_branch || null, clean: ins.clean === undefined ? null : ins.clean, relation: ins.relation || null, behind: ins.behind === undefined ? null : ins.behind, ahead: ins.ahead === undefined ? null : ins.ahead },
    RUNTIME: { executor_sha: d.executor ? d.executor.sha : null, executor_source: d.executor ? d.executor.source : null, bridge_sha: d.bridge ? d.bridge.sha : null, drift: d.state || 'UNKNOWN' },
    BRIDGE: Object.assign({ state: bridge.healthy === null ? 'UNKNOWN' : (bridge.healthy ? 'HEALTHY' : 'UNHEALTHY') }, bridge),
    EXECUTOR: { state: executorState, pid: d.executor ? d.executor.pid : null, started_at: d.executor ? d.executor.started_at : null, health: d.executor ? d.executor.health : null, restart: parts.restart || null },
    TASKS: tasks,
    WORKTREES: { state: wt.state || 'UNKNOWN', total: wt.worktrees ? wt.worktrees.length : null, summary: wt.summary || null, auto_removable: wt.worktrees ? wt.worktrees.filter(function (w) { return w.decision === 'AUTO'; }).length : null, branches_auto_deletable: wt.branches ? wt.branches.filter(function (b) { return b.decision === 'AUTO'; }).length : null },
    RESOURCE: resourceState(parts.executor_home, now),
    LIFECYCLE: lifecycleState(parts.executor_home),
    CLEANUP: { git_sync: parts.enablement ? parts.enablement.sync : 'disabled', worktrees: parts.enablement ? parts.enablement.worktrees : 'disabled', restart_auto: parts.enablement ? parts.enablement.restart_auto : 'disabled', autopilot: parts.enablement ? parts.enablement.autopilot : 'disabled' },
    DEPLOYMENT: { state: deployment, next_action: d.next_action || null, git_sync: parts.sync ? { decision: parts.sync.decision, code: parts.sync.code, reason: parts.sync.reason } : null },
    sync_decision: parts.sync ? parts.sync.code : null
  };
}

// A stable fingerprint of the parts that matter, so the ledger records a
// state CHANGE once, not every tick.
function fingerprint(s) {
  return [s.SOURCE.sha, s.CODE.sha, s.RUNTIME.executor_sha, s.RUNTIME.drift, s.EXECUTOR.state, s.BRIDGE.state, s.TASKS.state, JSON.stringify(s.TASKS.counts), s.WORKTREES.state, s.WORKTREES.auto_removable, s.RESOURCE.level, s.DEPLOYMENT.state, s.CLEANUP.git_sync, s.CLEANUP.worktrees].join('|');
}

module.exports = { build: build, fingerprint: fingerprint, bridgeState: bridgeState, resourceState: resourceState, lifecycleState: lifecycleState };
