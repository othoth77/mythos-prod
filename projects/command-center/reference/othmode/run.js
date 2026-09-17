'use strict';
// =====================================================
// OTHMODE V2 — command runs (Command → Task → Executor → Provider → Result)
// projects/command-center/reference/othmode/run.js
//
// The ONE edge that turns a library command into an executor task without
// leaving OTHMODE. It reuses, never re-implements:
//   * the MCC command library (mcc_commands + variables.render) for the text,
//   * the executor's own HTTP API on loopback for /route (provider selection
//     by the registry/router/reputation) and /tasks (creation),
//   * the executor's per-task status.json / report.json on disk for the
//     lifecycle (same host, same user — no second copy of task state),
//   * the OTHMODE store (append-only JSONL stream `runs`) for the record of
//     WHO ran WHAT, and the unified Command History for reading it back.
//
// Safe by default: only ACTIVE commands with safety SAFE or READ_ONLY are
// runnable here, and every run is an ADVISORY task (repo-read profile,
// report_to_git off) — a provider can only turn the command text into a
// report. Anything that must modify a repository keeps going through the
// governed work-intake edge (GitHub Issue → bridge → executor).
//
// The executor bearer token is read from a 0600 file at call time and used
// only as an Authorization header. It is never returned, stored or logged.
// =====================================================

var fs = require('fs');
var http = require('http');
var path = require('path');
var url = require('url');

var resolve = require('./resolve.js');
var store = require('./store.js');
var variables = require('../variables.js');

var RUNNABLE_SAFETY = ['SAFE', 'READ_ONLY'];
var PROVIDER_CHOICES = ['auto', 'free-llm-pool', 'openai-compat'];
var TASK_TYPES = ['research', 'analysis', 'review', 'planning'];
var DEFAULT_TIMEOUT_S = 300;

// Executor state → the simple lifecycle a user reads (V2 §8).
var LIFECYCLE = {
  QUEUED: 'queued', RUNNING: 'running', WAITING_RETRY: 'retrying', WAITING_FOR_QUOTA: 'waiting_for_quota',
  COMPLETED: 'completed', FAILED: 'failed', BLOCKED: 'failed', CANCELLED: 'cancelled', INTERRUPTED: 'retrying'
};
var TERMINAL = ['completed', 'failed', 'cancelled'];

function vErr(msg) { var e = new Error(msg); e.code = 'OTHMODE_RUN_INPUT'; return e; }

function config(env) {
  var e = env || process.env;
  return {
    enabled: !!e.OTHMODE_EXECUTOR_TOKEN_FILE,
    url: e.OTHMODE_EXECUTOR_URL || 'http://127.0.0.1:8130',
    tokenFile: e.OTHMODE_EXECUTOR_TOKEN_FILE || null,
    project: e.OTHMODE_EXECUTOR_PROJECT || 'mythos-prod'
  };
}

function disabledReason(cfg) {
  if (!cfg.tokenFile) return 'OTHMODE_EXECUTOR_TOKEN_FILE is not set — command runs are disabled on this host';
  return 'command runs are disabled';
}

function readToken(cfg) {
  try {
    var m = /^MYTHOS_EXECUTOR_TOKEN=(.+)$/m.exec(fs.readFileSync(cfg.tokenFile, 'utf8'));
    return m ? m[1].trim() : null;
  } catch (e) { return null; }
}

// Loopback JSON request. Injectable (module.transport) so the suite never
// needs a real executor.
function defaultTransport(opts, body) {
  return new Promise(function (resolveP, reject) {
    var target = url.parse(opts.url);
    var data = body ? JSON.stringify(body) : null;
    var req = http.request({
      hostname: target.hostname, port: target.port, path: target.path, method: opts.method,
      headers: Object.assign({ 'Authorization': 'Bearer ' + opts.token },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      timeout: opts.timeoutMs || 15000
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
        resolveP({ status: res.statusCode, body: parsed, text: text.slice(0, 500) });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('executor request timed out')); });
    req.on('error', reject);
    req.end(data);
  });
}
var transport = defaultTransport;
function setTransport(fn) { transport = fn || defaultTransport; }

function executor(cfg, method, p, body) {
  var token = readToken(cfg);
  if (!token) return Promise.reject(new Error('executor credential unreadable'));
  return transport({ url: cfg.url.replace(/\/$/, '') + p, method: method, token: token }, body);
}

// --- selection --------------------------------------------------------------

// Asks the executor's router (registry + health + reputation) which advisory
// agent should take the task. A router that is off (core disabled), refuses,
// or waits for quota falls back to the free pool — never to an
// execution-authority agent, and never silently to nothing.
function selectProvider(cfg, taskType) {
  return executor(cfg, 'POST', '/route', { task_type: taskType, execution_profile: 'repo-read' })
    .then(function (r) {
      var b = r.body || {};
      if (r.status === 200 && (b.action === 'route' || b.action === 'fallback') && b.provider && b.authority === false) {
        return { provider: b.provider, agent: b.agent || null, action: b.action, reason: null };
      }
      return { provider: 'free-llm-pool', agent: null, action: 'default',
        reason: r.status === 200 ? (b.reason || b.action || 'router gave no advisory route') : 'router unavailable (HTTP ' + r.status + ')' };
    })
    .catch(function (e) {
      return { provider: 'free-llm-pool', agent: null, action: 'default', reason: 'router unreachable: ' + e.message };
    });
}

// --- run ---------------------------------------------------------------------

var COMMAND_SQL = 'SELECT c.id, c.slug, c.title, c.body, c.variables, c.safety_level, c.status, p.slug AS project_slug ' +
  'FROM mcc_commands c LEFT JOIN mcc_projects p ON p.id = c.project_id WHERE c.slug = $1';

function startRun(db, slug, input, actor, envCfg) {
  var cfg = envCfg || config();
  var body = input || {};
  if (!cfg.enabled) return Promise.reject(vErr(disabledReason(cfg)));
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(String(slug))) return Promise.reject(vErr('invalid command reference'));
  var providerChoice = body.provider ? String(body.provider) : 'auto';
  if (PROVIDER_CHOICES.indexOf(providerChoice) === -1) return Promise.reject(vErr('provider must be one of: ' + PROVIDER_CHOICES.join(', ')));
  var taskType = body.task_type ? String(body.task_type) : 'research';
  if (TASK_TYPES.indexOf(taskType) === -1) return Promise.reject(vErr('task_type must be one of: ' + TASK_TYPES.join(', ')));
  var timeoutS = body.timeout_seconds === undefined ? DEFAULT_TIMEOUT_S : parseInt(body.timeout_seconds, 10);
  if (!(timeoutS >= 30 && timeoutS <= 1800)) return Promise.reject(vErr('timeout_seconds must be between 30 and 1800'));
  var values = body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values : {};

  return db.query(COMMAND_SQL, [String(slug)]).then(function (result) {
    var cmd = result.rows[0];
    if (!cmd) { var e = new Error('command not found'); e.code = 'OTHMODE_RUN_NOT_FOUND'; throw e; }
    if (cmd.status !== 'ACTIVE') throw vErr('only ACTIVE commands can be run (this one is ' + cmd.status + ')');
    if (RUNNABLE_SAFETY.indexOf(cmd.safety_level) === -1) {
      throw vErr('only SAFE or READ_ONLY commands run as advisory tasks here (this one is ' + cmd.safety_level +
        '); anything that modifies a repository goes through work intake');
    }
    var rendered = variables.render(cmd.body, values);
    var missing = variables.unresolved(cmd.body, values);
    if (missing.length) throw vErr('unresolved placeholders: ' + missing.join(', '));

    var selection = providerChoice === 'auto'
      ? selectProvider(cfg, taskType)
      : Promise.resolve({ provider: providerChoice, agent: null, action: 'requested', reason: null });

    return selection.then(function (sel) {
      var payload = {
        project: cfg.project,
        stage: 'OTHMODE-RUN-' + cmd.slug,
        instruction: rendered,
        provider: sel.provider,
        report_to_git: false,
        requested_by: 'othmode:' + String(actor || 'unknown').slice(0, 60),
        priority: 'normal',
        timeout_seconds: timeoutS,
        max_retries: 1,
        expected_delivery: 'report'
      };
      return executor(cfg, 'POST', '/tasks', payload).then(function (r) {
        if (r.status !== 201 || !r.body || !r.body.task_id) {
          throw vErr('executor refused the task: ' + ((r.body && r.body.error) || ('HTTP ' + r.status)));
        }
        var record = store.appendRecord('runs', {
          type: 'run',
          command_slug: cmd.slug,
          command_title: cmd.title,
          command_id: Number(cmd.id),
          project: cmd.project_slug || null,
          task_id: r.body.task_id,
          task_type: taskType,
          provider_requested: providerChoice,
          provider: sel.provider,
          route: { action: sel.action, agent: sel.agent, reason: sel.reason },
          actor: String(actor || 'unknown')
        });
        return { run: record, task_id: r.body.task_id, provider: sel.provider, route: sel };
      });
    });
  });
}

// --- lifecycle (disk reads; the executor writes, OTHMODE only reads) ----------

function taskFiles(taskId) {
  if (!/^t-[0-9]{14}-[a-z0-9]{6}$/.test(String(taskId))) return null;
  var dir = path.join(resolve.executorTasksDir(), taskId);
  return {
    status: resolve.readJson(path.join(dir, 'status.json')),
    task: resolve.readJson(path.join(dir, 'task.json')),
    report: resolve.readJson(path.join(dir, 'report.json'))
  };
}

function safeError(text) {
  if (!text) return null;
  return String(text).replace(/\/[^\s'"`):,]+/g, '[path]').slice(0, 300);
}

function lifecycleOf(taskId) {
  var files = taskFiles(taskId);
  if (!files) return { task_id: taskId, status: 'unknown', reason: 'invalid task id' };
  if (!files.status.ok) return { task_id: taskId, status: 'unknown', reason: 'task state ' + files.status.reason + ' on this host' };
  var s = files.status.data;
  // Every executor status maps; an unmapped one is shown as itself (lower
  // case) rather than hidden behind 'unknown'.
  var life = LIFECYCLE[s.status] || String(s.status || 'unknown').toLowerCase();
  var started = s.started_at || s.created_at || null;
  var ended = s.ended_at || null;
  var duration = started && ended ? Math.max(0, Date.parse(ended) - Date.parse(started)) : null;
  var rep = files.report.ok ? (files.report.data.structured || files.report.data.report || null) : null;
  var attempts = Array.isArray(s.attempts) ? s.attempts : null;
  return {
    task_id: taskId,
    status: life,
    terminal: TERMINAL.indexOf(life) !== -1,
    executor_status: s.status,
    // status.json carries no provider of its own — the task record does.
    provider: s.provider || (files.task.ok ? files.task.data.provider || null : null),
    provider_used: s.provider_used || null,
    model_used: s.model_used || null,
    attempts: attempts ? attempts.length : null,
    fallback: !!s.fallback,
    retry_count: s.retry_count || 0,
    created_at: s.created_at || null,
    started_at: started,
    ended_at: ended,
    duration_ms: duration,
    error: life === 'failed' || life === 'retrying' ? safeError(s.last_error) : null,
    next_action: s.next_action || null,
    result: rep ? { status: rep.status || null, summary: rep.summary ? String(rep.summary).slice(0, 2000) : null } : null
  };
}

function listRuns(limit) {
  var cap = Math.min(Math.max(parseInt(limit || 50, 10) || 50, 1), 200);
  var res = store.readStream('runs', cap);
  if (!res.provisioned) return { provisioned: false, reason: res.reason, runs: [] };
  var runs = res.rows.filter(function (r) { return r.type === 'run'; }).reverse().map(function (r) {
    return Object.assign({}, r, { lifecycle: lifecycleOf(r.task_id) });
  });
  return { provisioned: true, runs: runs };
}

function getRun(taskId) {
  var res = store.readStream('runs', 500);
  var rec = res.provisioned ? res.rows.filter(function (r) { return r.type === 'run' && r.task_id === taskId; }).pop() : null;
  var life = lifecycleOf(taskId);
  if (!rec && life.status === 'unknown') return null;
  return { run: rec || null, lifecycle: life };
}

// Anonymous projection of a run record: same shape, the actor (an account
// label) removed, then the same masking Command History applies. The stored
// record is never mutated.
function publicRun(rec) {
  if (!rec) return rec;
  var copy = Object.assign({}, rec);
  delete copy.actor;
  return copy;
}

// Rows for the unified Command History (source `run`).
function historyRows(limit) {
  var list = listRuns(limit);
  if (!list.provisioned) return { available: false, reason: list.reason, rows: [] };
  return {
    available: true, reason: null,
    rows: list.runs.map(function (r) {
      var l = r.lifecycle;
      return {
        source: 'run',
        command: r.command_title,
        command_ref: r.command_slug,
        timestamp: l.ended_at || l.started_at || r.ts,
        duration_ms: l.duration_ms,
        status: String(l.status).toUpperCase(),
        result: l.result && l.result.summary ? l.result.summary : (l.error || null),
        evidence: 'executor-task:' + r.task_id,
        next_action: l.next_action || null,
        project: r.project || null,
        provider: l.provider_used || r.provider || null,
        fallback: l.fallback
      };
    })
  };
}

module.exports = {
  RUNNABLE_SAFETY: RUNNABLE_SAFETY,
  PROVIDER_CHOICES: PROVIDER_CHOICES,
  TASK_TYPES: TASK_TYPES,
  LIFECYCLE: LIFECYCLE,
  config: config,
  disabledReason: disabledReason,
  selectProvider: selectProvider,
  startRun: startRun,
  lifecycleOf: lifecycleOf,
  listRuns: listRuns,
  getRun: getRun,
  historyRows: historyRows,
  publicRun: publicRun,
  setTransport: setTransport
};
