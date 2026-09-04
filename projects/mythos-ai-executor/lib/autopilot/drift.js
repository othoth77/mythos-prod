'use strict';
// =====================================================
// MYTHOS Autopilot — runtime drift detection
// projects/mythos-ai-executor/lib/autopilot/drift.js
//
// Four identities, one verdict:
//
//   SOURCE    origin/<branch> after fetch            (GitHub, the truth)
//   CODE      refs/heads/<branch> on the checkout    (disk)
//   BRIDGE    a fresh process per timer tick, so its identity IS the disk
//             identity at tick time (bridge/github-bridge.js runtimeIdentity)
//   EXECUTOR  a long-lived daemon: the code it loaded when it STARTED. It
//             reports that in GET /health as `code_identity` (this stage);
//             an executor older than this stage has no such field, so the
//             identity is INFERRED from the branch reflog entry in force at
//             the process start time and labelled `reflog_inference`.
//
//   CURRENT                      source == code == executor
//   CODE_BEHIND_SOURCE           checkout can be fast-forwarded (git-sync)
//   CODE_AHEAD / CODE_DIVERGED   never touched automatically
//   EXECUTOR_RESTART_REQUIRED    code == source, executor loaded older code
//   EXECUTOR_UNVERIFIED          executor identity cannot be established
//                                (fail-closed: not CURRENT, not restartable)
// =====================================================

var fs = require('fs');
var path = require('path');
var http = require('http');

var STATES = ['CURRENT', 'CODE_BEHIND_SOURCE', 'CODE_AHEAD', 'CODE_DIVERGED', 'EXECUTOR_RESTART_REQUIRED', 'EXECUTOR_UNVERIFIED', 'SOURCE_UNVERIFIED'];

function readFileSafe(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } }

// Process start time (ms since epoch) from /proc: btime + starttime/CLK_TCK.
function procStartMs(pid, opts) {
  opts = opts || {};
  var procRoot = opts.proc_root || '/proc';
  var stat = readFileSafe(path.join(procRoot, String(pid), 'stat'));
  var sys = readFileSafe(path.join(procRoot, 'stat'));
  if (!stat || !sys) return null;
  var m = /btime (\d+)/.exec(sys);
  if (!m) return null;
  var after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  var startTicks = parseInt(after[19], 10); // field 22 overall
  if (isNaN(startTicks)) return null;
  var hz = opts.clk_tck || 100;
  return (parseInt(m[1], 10) + startTicks / hz) * 1000;
}

// The reflog entry of <branch> that was current at time t.
function reflogHeadAt(git, repo, branch, tMs) {
  var r = git(repo, ['reflog', 'show', '--date=iso-strict', '--format=%H %gd', 'refs/heads/' + branch]);
  if (!r.ok || !r.out) return null;
  var entries = r.out.split('\n').map(function (line) {
    var m = /^([0-9a-f]{40}) .*@\{([^}]+)\}$/.exec(line.trim());
    if (!m) return null;
    var ts = Date.parse(m[2]);
    return isNaN(ts) ? null : { sha: m[1], at: ts };
  }).filter(Boolean);
  // reflog is newest-first; the first entry not after t is the one in force.
  for (var i = 0; i < entries.length; i++) if (entries[i].at <= tMs) return entries[i];
  return entries.length ? { sha: entries[entries.length - 1].sha, at: entries[entries.length - 1].at, oldest: true } : null;
}

function fetchHealth(url, timeoutMs) {
  return new Promise(function (resolve) {
    var req = http.get(url, { timeout: timeoutMs || 3000 }, function (res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { try { resolve({ ok: true, status: res.statusCode, body: JSON.parse(body) }); } catch (e) { resolve({ ok: false, error: 'invalid json' }); } });
    });
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', function (e) { resolve({ ok: false, error: e.code || e.message }); });
  });
}

function executorPid(opts) {
  if (opts.executor_pid) return opts.executor_pid;
  var raw = readFileSafe(path.join(opts.executor_home, 'daemon.lock'));
  var pid = raw ? parseInt(raw, 10) : NaN;
  return isNaN(pid) ? null : pid;
}

// executorIdentity(opts) → Promise<{ sha, source, pid, started_at, health }>
function executorIdentity(opts) {
  opts = opts || {};
  var git = opts.git;
  var pid = executorPid(opts);
  var alive = pid ? (function () { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } })() : false;
  var out = { sha: null, source: null, pid: pid, alive: alive, started_at: null, health: null, reason: null };
  var healthP = opts.health_url ? fetchHealth(opts.health_url, opts.health_timeout_ms) : Promise.resolve({ ok: false, error: 'no health url' });
  return healthP.then(function (h) {
    out.health = h.ok ? { status: h.status, ok: !!(h.body && h.body.ok) } : { ok: false, error: h.error };
    var ci = h.ok && h.body && h.body.code_identity;
    if (ci && /^[0-9a-f]{40}$/.test(String(ci.head || ''))) {
      out.sha = ci.head; out.source = 'health'; out.started_at = ci.started_at || null;
      if (ci.pid) out.pid = ci.pid;
      out.alive = true; // it answered
      return out;
    }
    if (!pid || !alive) { out.reason = pid ? 'executor pid ' + pid + ' not alive' : 'no executor pid (daemon.lock missing)'; return out; }
    var start = opts.proc_start_ms || procStartMs(pid, opts);
    if (!start) { out.reason = 'cannot read process start time'; return out; }
    out.started_at = new Date(start).toISOString();
    var entry = git && opts.repo ? reflogHeadAt(git, opts.repo, opts.branch || 'main', start) : null;
    if (!entry) { out.reason = 'no reflog entry covers the process start time'; return out; }
    out.sha = entry.sha; out.source = 'reflog_inference';
    if (entry.oldest) out.reason = 'process predates the oldest reflog entry; identity is the oldest known';
    return out;
  });
}

function verdict(source, code, exec, relation) {
  if (!source) return 'SOURCE_UNVERIFIED';
  if (code !== source) {
    if (relation === 'behind') return 'CODE_BEHIND_SOURCE';
    if (relation === 'ahead') return 'CODE_AHEAD';
    return 'CODE_DIVERGED';
  }
  if (!exec || !exec.sha) return 'EXECUTOR_UNVERIFIED';
  if (exec.sha !== code) return 'EXECUTOR_RESTART_REQUIRED';
  return 'CURRENT';
}

// detect(opts) → Promise<report>. opts.inspection is a git-reconcile
// inspection (already fetched); the rest locate the executor.
function detect(opts) {
  opts = opts || {};
  var ins = opts.inspection;
  return executorIdentity(opts).then(function (exec) {
    var rep = {
      measured_at: new Date().toISOString(),
      source: { ref: (ins.remote || 'origin') + '/' + (ins.branch || 'main'), sha: ins.remote_head, fetch_ok: ins.fetch_ok },
      code: { checkout: ins.repo, branch: ins.current_branch, sha: ins.head, clean: ins.clean, relation_to_source: ins.relation },
      bridge: { sha: ins.head, source: 'fresh_process_per_tick' },
      executor: exec,
      state: verdict(ins.remote_head, ins.head, exec, ins.relation)
    };
    rep.next_action = nextAction(rep);
    return rep;
  });
}

function nextAction(rep) {
  switch (rep.state) {
    case 'CURRENT': return { mode: 'NONE', text: 'nothing to do' };
    case 'CODE_BEHIND_SOURCE': return { mode: 'AUTO', text: 'git-sync fast-forward ' + String(rep.code.sha).slice(0, 12) + ' → ' + String(rep.source.sha).slice(0, 12) };
    case 'EXECUTOR_RESTART_REQUIRED': return { mode: 'APPROVAL', text: 'restart mythos-ai-executor (loaded ' + String(rep.executor.sha).slice(0, 12) + ', checkout ' + String(rep.code.sha).slice(0, 12) + ')' };
    case 'EXECUTOR_UNVERIFIED': return { mode: 'MANUAL', text: 'executor identity unknown: ' + (rep.executor.reason || 'no evidence') };
    case 'CODE_AHEAD': return { mode: 'NONE', text: 'local commits await the delivery relay' };
    case 'CODE_DIVERGED': return { mode: 'MANUAL', text: 'diverged checkout: operator merge decision' };
    default: return { mode: 'MANUAL', text: 'source unverified (fetch failed?)' };
  }
}

module.exports = { STATES: STATES, detect: detect, executorIdentity: executorIdentity, verdict: verdict, reflogHeadAt: reflogHeadAt, procStartMs: procStartMs, nextAction: nextAction };
