#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — autonomous supervisor CLI
// scripts/mythos-supervise.js
//
//   submit  --objective "…" [--accept "…"]… [--timeout S]   record an objective (the timer does the rest)
//           structured (LOCAL plan, no model): --action A [--check kind[:arg]]… [--scope …] [--validation …] [--constraint …]
//   costs   <TASK_ID>                            OpenAI / Qwen / local decisions for the whole lineage, with reasons
//   tick                                         one supervision pass (systemd timer runs this)
//   watch   <TASK_ID> [--interval S] [--max-minutes M]   tick until COMPLETED/BLOCKED
//   status  [<TASK_ID>]                          task state (all tasks when omitted)
//   trace   <TASK_ID>                            the correlated journal: objective → Issue →
//                                                execution → Fable → report → decision → next
//   resume  <TASK_ID> --reason "…"               human: leave BLOCKED (never automatic)
//   cancel  <TASK_ID> --reason "…"               close an unclaimed attempt and block
//
// Exit codes: 0 ok · 1 usage · 2 task BLOCKED (watch) · 3 lock held (tick)
// =====================================================

var path = require('path');
var fs = require('fs');

var BASE = path.join(__dirname, '..');
var ORCH = path.join(BASE, 'projects', 'mythos-orchestrator');
var store = require(path.join(ORCH, 'supervisor', 'store.js'));
var states = require(path.join(ORCH, 'supervisor', 'states.js'));

function loadConfig() {
  var p = process.env.MYTHOS_SUPERVISOR_CONFIG || path.join(ORCH, 'config', 'supervisor.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function build() {
  var cfg = loadConfig();
  var gh = require(path.join(ORCH, 'supervisor', 'gh.js')).create({ timeoutMs: cfg.gh_timeout_seconds * 1000 });
  var bridge = require(path.join(ORCH, 'supervisor', 'bridge.js')).create(gh, cfg);
  var monitor = require(path.join(ORCH, 'supervisor', 'monitor.js')).create(cfg);
  var brain = require(path.join(ORCH, 'supervisor', 'brain.js')).create(cfg);
  return require(path.join(ORCH, 'supervisor', 'supervisor.js')).create({ cfg: cfg, bridge: bridge, monitor: monitor, brain: brain });
}

function flag(args, name) {
  var i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}
function flags(args, name) {
  var out = [];
  args.forEach(function (a, i) { if (a === name && args[i + 1] !== undefined) out.push(args[i + 1]); });
  return out;
}

function summary(t) {
  return {
    task_id: t.task_id, status: t.status, parent_task_id: t.parent_task_id, root_task_id: t.root_task_id,
    correlation_id: t.correlation_id, issue: t.issue_number || null, action: t.spec ? t.spec.action : null,
    attempt_count: t.attempt_count, recovery_count: t.recovery_count, children: t.children, active_child: t.active_child,
    last_action: t.last_action, last_error: t.last_error, last_failure_signature: t.last_failure_signature,
    progress_marker: t.progress_marker, blocked: t.blocked || null,
    executions: (t.executions || []).map(function (e) {
      return { execution_id: e.execution_id, issue: e.issue_number, bridge_task_id: e.bridge_task_id, executor_task_id: e.executor_task_id || null,
        dispatch: e.dispatch, settled: e.settled, outcome: e.outcome || null, monitor_state: e.monitor ? e.monitor.monitor_state : null };
    }),
    costs: t.costs || null,
    consult: t.consult || null,
    updated_at: t.updated_at
  };
}

function print(o) { console.log(JSON.stringify(o, null, 2)); }

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  var args = process.argv.slice(2);
  var cmd = args[0];
  if (cmd === 'submit') {
    var objective = flag(args, '--objective');
    if (!objective) { console.error('submit needs --objective'); process.exit(1); }
    var t = build().submitObjective({
      objective: objective, title: flag(args, '--title'), acceptance: flags(args, '--accept').concat(flags(args, '--check').map(function (c) { return 'check:' + c; })),
      action: flag(args, '--action'), scope: flags(args, '--scope'), constraints: flags(args, '--constraint'), validation: flags(args, '--validation'),
      requested_by: flag(args, '--by') || 'owner', timeout_seconds: flag(args, '--timeout')
    });
    print(summary(t));
    return 0;
  }
  if (cmd === 'tick') {
    var s = await build().tick();
    print(s);
    return s.ran ? 0 : 3;
  }
  if (cmd === 'watch') {
    var id = args[1];
    var interval = parseInt(flag(args, '--interval') || '30', 10) * 1000;
    var until = Date.now() + parseInt(flag(args, '--max-minutes') || '120', 10) * 60000;
    var sup = build();
    while (Date.now() < until) {
      await sup.tick();
      var cur = store.loadTask(id);
      if (!cur) { console.error('no such task ' + id); return 1; }
      console.log(new Date().toISOString() + ' ' + id + ' ' + cur.status + ' ' + (cur.last_action || ''));
      if (states.TERMINAL.indexOf(cur.status) !== -1) { print(summary(cur)); return cur.status === 'COMPLETED' ? 0 : 2; }
      await sleep(interval);
    }
    console.error('watch timed out');
    return 1;
  }
  if (cmd === 'status') {
    if (args[1]) { var one = store.loadTask(args[1]); if (!one) return 1; print(summary(one)); return 0; }
    print(store.listTasks().map(function (x) { return { task_id: x.task_id, status: x.status, issue: x.issue_number || null, last_action: x.last_action, updated_at: x.updated_at }; }));
    return 0;
  }
  if (cmd === 'trace') {
    var tr = store.loadTask(args[1]);
    if (!tr) return 1;
    print(store.readJournal(function (e) { return e.correlation_id === tr.correlation_id; }));
    return 0;
  }
  if (cmd === 'costs') {
    var ct0 = store.loadTask(args[1]);
    if (!ct0) return 1;
    var lineage = store.listTasks().filter(function (x) { return x.root_task_id === ct0.root_task_id; });
    var tot = { openai: 0, qwen: 0, local: 0 };
    var rows = lineage.map(function (x) {
      var c = x.costs || { openai: { total: 0 }, qwen: 0, local: 0, escalations: [] };
      tot.openai += c.openai.total; tot.qwen += c.qwen; tot.local += c.local;
      return { task_id: x.task_id, status: x.status, recovery: !!x.parent_task_id, openai: c.openai, qwen: c.qwen, local: c.local, escalations: c.escalations };
    });
    print({ root: ct0.root_task_id, totals: tot, tasks: rows });
    return 0;
  }
  if (cmd === 'resume') {
    var reason = flag(args, '--reason');
    if (!reason) { console.error('resume needs --reason'); return 1; }
    print(summary(build().resume(args[1], reason)));
    return 0;
  }
  if (cmd === 'cancel') {
    var ct = store.loadTask(args[1]);
    var why = flag(args, '--reason') || 'cancelled by the owner';
    if (!ct || !ct.executions.length) return 1;
    var cfg = loadConfig();
    var gh = require(path.join(ORCH, 'supervisor', 'gh.js')).create({ timeoutMs: cfg.gh_timeout_seconds * 1000 });
    var br = require(path.join(ORCH, 'supervisor', 'bridge.js')).create(gh, cfg);
    print(await br.cancelTask(ct.executions[ct.executions.length - 1], why));
    return 0;
  }
  console.log('usage: mythos-supervise.js submit|tick|watch|status|trace|resume|cancel (see header)');
  return cmd ? 1 : 0;
}

main().then(function (code) { process.exit(code || 0); }, function (e) { console.error(String(e && e.stack || e)); process.exit(1); });
