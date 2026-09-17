'use strict';
// =====================================================
// MYTHOS Guardian — memory domain
// ops/guardian/lib/memory.js
//
// REUSES the MYTHOS Resource Guard (projects/mythos-ai-executor/lib/
// resource-guard.js): same signals, same thresholds, same hysteresis, same
// "oom_kill delta escalates immediately" rule. Guardian keeps its OWN
// resource-guard state file so host protection does not depend on the
// executor (a deploy user service that dies with user@1001) being alive.
//
// Guardian adds exactly two rules on top, both documented with evidence in
// docs/guardian/CONFIGURATION.md:
//   * swap exhaustion — swap is NOT a trigger on its own (it sits at
//     96-100 % for days on this healthy host); it only argues WARNING when
//     swap is nearly full AND MemAvailable is already low.
//   * EMERGENCY — resource-guard CRITICAL and MemAvailable at or below the
//     emergency floor.
// =====================================================

var path = require('path');

function loadResourceGuard() {
  try { return require('./resource-guard'); } catch (e) { /* installed copy absent: repo layout */ }
  return require(path.join(__dirname, '..', '..', '..', 'projects', 'mythos-ai-executor', 'lib', 'resource-guard'));
}
var rg = loadResourceGuard();
var procs = require('./procs');

function collect(cfg, io, ctx) {
  var root = io.procRoot;
  var mem = rg.parseMeminfo(io.readFile(path.join(root, 'meminfo')));
  return {
    at: ctx.nowMs,
    mem_available_mib: mem.mem_available_mib,
    mem_total_mib: mem.mem_total_mib,
    swap_total_mib: mem.swap_total_mib,
    swap_used_mib: mem.swap_used_mib,
    swap_used_pct: mem.swap_used_pct,
    psi_some_avg60: rg.parsePressureSome60(io.readFile(path.join(root, 'pressure', 'memory'))),
    oom_kill: rg.parseOomKill(io.readFile(path.join(root, 'vmstat'))),
    top_rss: procs.topRss(ctx.procs || [], 5)
  };
}

function classify(m, cfg, prev, ctx) {
  var p = prev || {};
  var rgCfg = Object.assign({}, cfg.resource_guard || {});
  var res = rg.evaluate(p.rg || null, m, rgCfg);
  var rgLevel = res.state.level;
  var sample = res.state.last_sample || {};
  var findings = [];
  var raw = rgLevel;          // NORMAL | WARNING | CRITICAL
  var immediate = true;       // resource-guard levels are already confirmed

  if (res.transition) {
    findings.push({
      severity: res.transition.to === 'NORMAL' ? 'INFO' : res.transition.to,
      kind: res.transition.reason === 'oom_kill' ? 'oom_kill' : 'memory_level',
      trigger: 'resource-guard ' + res.transition.from + ' → ' + res.transition.to + ' (' + res.transition.reason + ')',
      evidence: sample
    });
  }

  var swap = cfg.swap_rule || {};
  if (swap.enabled !== false && typeof m.swap_used_pct === 'number' && typeof m.mem_available_mib === 'number' &&
      m.swap_used_pct >= (swap.swap_used_pct_min || 95) && m.mem_available_mib <= (swap.mem_available_max_mib || 1200)) {
    if (raw === 'NORMAL') { raw = 'WARNING'; immediate = false; }
    findings.push({
      severity: 'WARNING', kind: 'swap_exhaustion',
      trigger: 'swap ' + m.swap_used_pct + ' % used with MemAvailable ' + m.mem_available_mib + ' MiB',
      evidence: { swap_used_pct: m.swap_used_pct, mem_available_mib: m.mem_available_mib }
    });
  }

  var emFloor = typeof cfg.emergency_avail_mib === 'number' ? cfg.emergency_avail_mib : 400;
  if (rgLevel === 'CRITICAL' && typeof m.mem_available_mib === 'number' && m.mem_available_mib <= emFloor) {
    raw = 'EMERGENCY';
    immediate = false;        // needs its own confirmation samples
    findings.push({
      severity: 'EMERGENCY', kind: 'memory_emergency',
      trigger: 'MemAvailable ' + m.mem_available_mib + ' MiB ≤ ' + emFloor + ' MiB while CRITICAL',
      evidence: { mem_available_mib: m.mem_available_mib, top_rss: m.top_rss }
    });
  }

  return {
    raw: raw,
    immediate: immediate,
    findings: findings,
    plan: [],
    stateOut: { rg: res.state },
    summary: {
      resource_guard_level: rgLevel,
      mem_available_mib: m.mem_available_mib,
      mem_total_mib: m.mem_total_mib,
      swap_used_pct: m.swap_used_pct,
      psi_some_avg60: m.psi_some_avg60,
      oom_kill: m.oom_kill,
      oom_kill_delta: sample.oom_kill_delta || 0,
      top_rss: m.top_rss
    }
  };
}

// Kernel evidence for an OOM transition, captured BEFORE the journal can
// rotate it away. Bounded to `max_lines`.
function captureOomEvidence(io, maxLines) {
  var r = io.spawn(['journalctl', '-k', '--since', '-15min', '--no-pager', '-o', 'short-iso'], { timeout_ms: 10000 });
  if (r.status !== 0) return { captured: false, error: r.error || ('exit ' + r.status) };
  var lines = r.stdout.split('\n').filter(function (l) { return /oom|killed process|out of memory/i.test(l); });
  return { captured: true, lines: lines.slice(-(maxLines || 200)) };
}

module.exports = { collect: collect, classify: classify, captureOomEvidence: captureOomEvidence, resourceGuard: rg };
