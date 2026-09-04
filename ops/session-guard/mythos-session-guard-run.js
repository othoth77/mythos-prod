#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS Session Guard — root runner  (GitHub Issue #144)
// ops/session-guard/mythos-session-guard-run.js
//
// The single entry point of mythos-session-guard.service. It is a
// SEPARATE, self-contained file from bin/mythos-session-guard on purpose:
//
//   * This one runs as ROOT (the Desktop Remote sessions belong to root,
//     so nothing else can signal them), and root must never execute code
//     out of a deploy-writable checkout. install-session-guard.sh copies
//     exactly this file and session-guard.js into
//     /usr/local/lib/mythos-session-guard/, root:root 0644/0755, and the
//     unit runs that copy.
//   * It therefore requires ONLY ./session-guard.js — no lib/state.js, no
//     executor, no repository. Two root-owned files, no other surface.
//
// It cannot escalate anything: it reads /proc, decides, and at most sends
// SIGTERM (then SIGKILL after the grace window) to processes that
// session-guard.js positively classified as Claude Desktop Remote ccd-cli
// sessions. Every other process on the host, including every MYTHOS
// executor subprocess, is vetoed by classification before a signal exists.
//
// DEFAULT POSTURE IS OBSERVE. Without the enable marker it tracks, plans
// and logs, and signals nothing. Installing the timer therefore changes
// no behaviour; enforcement begins only when the operator creates the
// marker, and removing the marker is the rollback.
//
//   enable   : touch /var/lib/mythos-session-guard/session-guard.enabled
//   rollback : rm    /var/lib/mythos-session-guard/session-guard.enabled
//   hard off : systemctl disable --now mythos-session-guard.timer
//
// Env overrides (all optional; used by the tests to drive it over a
// fixture tree without touching the real host):
//   MYTHOS_SESSION_GUARD_HOME      state + ledger + marker directory
//   MYTHOS_SESSION_GUARD_PROC      /proc root (read by session-guard.js)
//   MYTHOS_SESSION_GUARD_RG_STATE  the Resource Guard's state file
//   MYTHOS_SESSION_GUARD_MAX       concurrent-session ceiling
//   MYTHOS_SESSION_GUARD_IDLE      idle timeout in seconds
//   MYTHOS_SESSION_GUARD=off       kill switch, overrides the marker
// =====================================================

var fs = require('fs');
var path = require('path');

var guard = require('./session-guard');

var HOME = process.env.MYTHOS_SESSION_GUARD_HOME || '/var/lib/mythos-session-guard';
// Execution Lifecycle registry (deploy-owned, read-only from here) and the
// host snapshot this runner exports for non-root readers. Both optional:
// an absent registry changes nothing, and the snapshot is skipped when its
// directory is not writable (the unit must grant /var/lib/mythos/lifecycle).
var LIFECYCLE = process.env.MYTHOS_SESSION_GUARD_LIFECYCLE || '/home/deploy/mythos-ai-executor/lifecycle';
var SNAPSHOT = process.env.MYTHOS_LIFECYCLE_SNAPSHOT || '/var/lib/mythos/lifecycle/host-sessions.json';
var vpsRuntime = null;
try { vpsRuntime = require('./runtime-vps'); } catch (e) { vpsRuntime = null; }
var RG_STATE = process.env.MYTHOS_SESSION_GUARD_RG_STATE ||
  '/home/deploy/.mythos-ai-executor/resource-guard.json';
// How stale the Resource Guard's state may be and still be believed. The
// executor samples every 15s; beyond this the file is ignored and the
// level read as NORMAL, which only ever makes this guard LESS eager.
var RG_MAX_AGE_MS = 5 * 60 * 1000;

// The memory signal is READ from the Resource Guard, never recomputed
// here: gh-issue-101 owns the thresholds, the hysteresis and the rule that
// swap is reported and never a trigger. A second memory reader would be a
// second opinion, and the two would eventually disagree.
function pressureLevel() {
  try {
    var raw = JSON.parse(fs.readFileSync(RG_STATE, 'utf8'));
    var age = Date.now() - Date.parse(raw.updated_at);
    if (isNaN(age) || age < 0 || age > RG_MAX_AGE_MS) return 'NORMAL';
    return ['NORMAL', 'WARNING', 'CRITICAL'].indexOf(raw.level) >= 0 ? raw.level : 'NORMAL';
  } catch (e) {
    return 'NORMAL';
  }
}

function intEnv(name) {
  var v = parseInt(process.env[name] || '', 10);
  return isNaN(v) ? null : v;
}

function main() {
  var cfg = {
    state_path: path.join(HOME, 'session-guard.json'),
    ledger_path: path.join(HOME, 'session-guard.jsonl'),
    enable_marker_path: path.join(HOME, 'session-guard.enabled'),
    pressure_level: pressureLevel(),
    lifecycle_registry: fs.existsSync(LIFECYCLE) ? LIFECYCLE : null
  };
  var max = intEnv('MYTHOS_SESSION_GUARD_MAX');
  if (max !== null) cfg.max_sessions = max;
  var idle = intEnv('MYTHOS_SESSION_GUARD_IDLE');
  if (idle !== null) cfg.idle_seconds = idle;

  try { fs.mkdirSync(HOME, { recursive: true, mode: 0o700 }); } catch (e) { /* reported below */ }

  var enabled = guard.enforcementEnabled(cfg);
  cfg.enforce = enabled.enabled;

  // Host snapshot FIRST: pid ↔ session uuid ↔ transcript turn state. Ids
  // and timestamps only — no argv, no transcript content. Written for the
  // deploy-side lifecycle and handed to this very plan as the transcript-
  // turn idle evidence (an idle ccd-cli still burns CPU, so without it the
  // CPU clock never clears).
  var snapshot = { written: false, sessions: null };
  if (vpsRuntime) {
    try {
      var snap = vpsRuntime.snapshot({ snapshot_path: SNAPSHOT });
      snapshot.sessions = snap.sessions.length;
      if (!snap.denied) {
        cfg.lifecycle_snapshot = snap;
        if (vpsRuntime.writeSnapshot({ snapshot_path: SNAPSHOT }, snap)) {
          snapshot.written = true;
          try { var owner = fs.statSync(LIFECYCLE); fs.chownSync(SNAPSHOT, 0, owner.gid); } catch (e) { /* group handoff best effort */ }
        }
      }
    } catch (e) { snapshot.error = String(e && e.message).slice(0, 80); }
  }

  var r = guard.run(cfg);
  var rep = guard.report(r);

  // One line to the journal per run: this is the operational record an
  // operator greps, with the durable detail in session-guard.jsonl.
  console.log(JSON.stringify({
    at: rep.at,
    mode: enabled.enabled ? 'enforce' : 'observe',
    enforcement_reason: enabled.reason,
    ok: rep.ok,
    counts: rep.counts,
    resident_mib: rep.resident_mib,
    pressure_level: rep.pressure_level,
    over_limit: rep.concurrency ? rep.concurrency.over_limit : null,
    lifecycle: rep.lifecycle || null,
    snapshot: snapshot,
    sessions_over_by: rep.concurrency ? rep.concurrency.over_by : null,
    planned: rep.planned_terminations,
    applied: (r.results || []).filter(function (x) { return x.applied; })
      .map(function (x) { return { pid: x.pid, signal: x.signal, reason: x.reason }; }),
    vetoes: rep.vetoes
  }));

  // Exit 0 even in observe mode and even with nothing to do: a oneshot
  // that "failed" every quiet tick would train operators to ignore it.
  // Only a guard that could not run at all is a failure.
  process.exit(r.ok ? 0 : 1);
}

main();
