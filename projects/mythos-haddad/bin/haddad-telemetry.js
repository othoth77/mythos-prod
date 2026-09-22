#!/usr/bin/env node
'use strict';

// =====================================================
// MYTHOS HADDAD — telemetry agent
// projects/mythos-haddad/bin/haddad-telemetry.js
//
// Collects the node's real state and pushes one signed envelope to the
// Status Center. Runs on Haddad, as `othman`, from a systemd USER timer —
// the same shape as the existing health timer, not a new supervisor.
//
// REUSE, NOT DUPLICATION. It builds nothing that already exists:
//   health        read from ~/.local/state/mythos-haddad/health-latest.json,
//                 written by mythos-haddad-health.timer (schema
//                 mythos-haddad-health/1)
//   tasks         read from the EXISTING executor store through
//                 projects/mythos-ai-executor/lib/state.js — the same
//                 module the executor itself writes with
//   runtime       the existing llama-server on 127.0.0.1:8600
//   units         systemctl --user is-active, no new supervision
//   GPU total     the existing bin/haddad-gpu-vram.py
// It defines no new queue, scheduler, executor, state machine or monitor.
//
// SECURITY
//   - Outbound only. Opens no port and publishes no endpoint.
//   - Never reads, carries or logs a token. The runtime's API key is only
//     used as an Authorization header on a loopback request and is never
//     placed in the envelope; the executor bearer is read BY REFERENCE
//     from its own 0600 file, exactly as haddad-mcp-stdio.sh does.
//   - Signs the body with an Ed25519 private key that is generated on this
//     machine, kept 0600, and never transmitted. The VPS holds only the
//     public half, so there is no shared secret anywhere.
//   - A value it cannot measure is null. It never substitutes a guess.
//
// Usage:
//   haddad-telemetry.js            collect and send one envelope
//   haddad-telemetry.js --dry-run  collect and print, send nothing
//   haddad-telemetry.js --print    same as --dry-run, pretty JSON
// Exit codes: 0 sent (or dry run), 1 collection/configuration error,
//             2 the endpoint refused or was unreachable.
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var url = require('url');

var AGENT_VERSION = '1.0.0';
var SCHEMA = 'mythos-node-telemetry/1';

var ARGS = process.argv.slice(2);
var DRY = ARGS.indexOf('--dry-run') !== -1 || ARGS.indexOf('--print') !== -1;

var HOME = os.homedir();
var STATE_DIR = process.env.HADDAD_STATE_DIR || path.join(HOME, '.local', 'state', 'mythos-haddad');
var CONF_DIR = process.env.HADDAD_CONF_DIR || path.join(HOME, '.config', 'mythos-haddad');
var CONF_FILE = path.join(CONF_DIR, 'telemetry.env');
var SEQ_FILE = path.join(STATE_DIR, 'telemetry-seq');
var CURSOR_FILE = path.join(STATE_DIR, 'telemetry-cursor.json');

var UNITS = [
  { id: 'worker', unit: 'mythos-haddad-worker.service', name: 'Executor worker' },
  { id: 'runtime', unit: 'mythos-haddad-runtime.service', name: 'Qwen runtime' },
  { id: 'bridge', unit: 'mythos-haddad-bridge.timer', name: 'GitHub bridge' },
  { id: 'health', unit: 'mythos-haddad-health.timer', name: 'Health monitor' }
];

function sh(cmd, args, opts) {
  var r = cp.spawnSync(cmd, args || [], Object.assign({ encoding: 'utf8', timeout: 8000 }, opts || {}));
  return { ok: !r.error && r.status === 0, code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function n(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

// ── configuration ──────────────────────────────────────────────────
// telemetry.env holds NO secret: an endpoint, a node id and the path of
// the private key. Same idiom as mcp.env (docs/HADDAD_MCP.md §5).
function loadConfig() {
  var cfg = {
    node: 'haddad',
    endpoint: 'https://status.mythosprod.xyz/ingest',
    key_file: path.join(CONF_DIR, 'telemetry-key.pem'),
    timeout_ms: 8000
  };
  var raw;
  try { raw = fs.readFileSync(CONF_FILE, 'utf8'); } catch (e) { return cfg; }
  raw.split('\n').forEach(function (line) {
    var m = /^\s*(?:export\s+)?HADDAD_TELEMETRY_([A-Z_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) return;
    var v = m[2].trim().replace(/^["']|["']$/g, '');
    if (m[1] === 'NODE') cfg.node = v;
    else if (m[1] === 'ENDPOINT') cfg.endpoint = v;
    else if (m[1] === 'KEY_FILE') cfg.key_file = v;
    else if (m[1] === 'TIMEOUT_MS') cfg.timeout_ms = parseInt(v, 10) || cfg.timeout_ms;
  });
  return cfg;
}

// ── units ──────────────────────────────────────────────────────────
// One systemctl call for every unit, not one per unit: this runs every
// 10 s and the process budget matters (docs/TELEMETRY.md § Overhead).
function collectUnits() {
  var r = sh('systemctl', ['--user', 'is-active'].concat(UNITS.map(function (u) { return u.unit; })));
  var lines = r.out.split('\n');
  var out = {};
  UNITS.forEach(function (u, i) { out[u.id] = (lines[i] || 'unknown').trim(); });
  return out;
}

// ── AI runtime (llama-server on 127.0.0.1:8600) ────────────────────
function runtimeKey() {
  var f = path.join(CONF_DIR, 'runtime.env');
  try {
    var m = /^\s*(?:export\s+)?HADDAD_RUNTIME_API_KEY\s*=\s*["']?([^"'\n]+)/m.exec(fs.readFileSync(f, 'utf8'));
    if (m) return m[1].trim();
  } catch (e) { /* not installed */ }
  try { return fs.readFileSync(path.join(CONF_DIR, 'runtime-api-key'), 'utf8').trim(); }
  catch (e) { return null; }
}

// A small blocking loopback GET. `curl` is what haddad-health.js already
// uses for this endpoint; reusing it keeps one idiom and avoids an async
// tangle in a script whose whole life is 200 ms.
function loopbackGet(port, pathname, key, timeoutS) {
  var args = ['-s', '-m', String(timeoutS || 3), 'http://127.0.0.1:' + port + pathname];
  if (key) args = ['-s', '-m', String(timeoutS || 3), '-H', 'Authorization: Bearer ' + key,
    'http://127.0.0.1:' + port + pathname];
  var r = sh('curl', args, { timeout: (timeoutS || 3) * 1000 + 1500 });
  if (!r.ok || !r.out) return null;
  try { return JSON.parse(r.out); } catch (e) { return null; }
}

// The runtime's OWN accounting of what it put on the GPU, taken from the
// load-time journal lines. STATUS.md is explicit that this — not the
// driver — is the figure to trust on this stack: NVK does not populate
// VK_EXT_memory_budget's heapUsage, so the OS-level "VRAM used" reads 0
// with 4.4 GB genuinely resident. Reported with its provenance, never as
// a live sample.
function runtimeLoadFacts() {
  var facts = { gpu_layers: null, gpu_layers_total: null, vram_model_mib: null, last_ready: null, source: null };
  var r = sh('journalctl', ['--user', '-u', 'mythos-haddad-runtime.service', '-n', '600',
    '--no-pager', '-o', 'short-iso'], { timeout: 6000 });
  if (!r.ok || !r.out) return facts;
  var lines = r.out.split('\n');
  // Walk backwards to the most recent load, so a restart is reflected.
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i];
    if (facts.gpu_layers === null) {
      var lm = /offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers/i.exec(line);
      if (lm) { facts.gpu_layers = parseInt(lm[1], 10); facts.gpu_layers_total = parseInt(lm[2], 10); facts.source = 'runtime load accounting (journal)'; }
    }
    if (facts.vram_model_mib === null) {
      var vm = /(?:Vulkan|CUDA|GPU)[^:]*model buffer size\s*=\s*([\d.]+)\s*MiB/i.exec(line) ||
               /load_tensors:\s*(?:Vulkan|CUDA)\S*\s*model buffer size\s*=\s*([\d.]+)\s*MiB/i.exec(line);
      if (vm) { facts.vram_model_mib = Math.round(parseFloat(vm[1])); facts.source = 'runtime load accounting (journal)'; }
    }
    if (facts.last_ready === null && /all slots are idle|server is listening|main loop/i.test(line)) {
      var ts = /^(\S+)/.exec(line);
      if (ts) { var t = Date.parse(ts[1]); if (isFinite(t)) facts.last_ready = new Date(t).toISOString(); }
    }
    if (facts.gpu_layers !== null && facts.vram_model_mib !== null && facts.last_ready !== null) break;
  }
  return facts;
}

function collectRuntime(units) {
  var out = {
    state: 'UNKNOWN', endpoint: 'http://127.0.0.1:8600/v1', model: null, context: null,
    slots_idle: null, slots_total: null, slots_processing: null,
    gpu_layers: null, gpu_layers_total: null, vram_model_mib: null, vram_source: null,
    tokens_per_s: null, last_ready: null, last_restart: null
  };
  if (units.runtime !== 'active') {
    out.state = units.runtime === 'inactive' || units.runtime === 'failed' ? 'STOPPED' : 'UNKNOWN';
    return out;
  }
  var key = runtimeKey();
  var models = loopbackGet(8600, '/v1/models', key);
  if (!models) { out.state = 'DEGRADED'; return out; }
  var first = models.data && models.data[0];
  out.model = (first && (first.id || first.model)) || null;

  var health = loopbackGet(8600, '/health', key);
  if (health) {
    out.slots_idle = n(health.slots_idle);
    out.slots_processing = n(health.slots_processing);
    if (out.slots_idle !== null && out.slots_processing !== null) out.slots_total = out.slots_idle + out.slots_processing;
  }
  // llama.cpp's /props carries the real context size when the build
  // exposes it; absent, context stays null rather than being assumed.
  var props = loopbackGet(8600, '/props', key);
  if (props) {
    out.context = n(props.n_ctx) || n((props.default_generation_settings || {}).n_ctx) || null;
    if (!out.model) out.model = (typeof props.model_path === 'string') ? path.basename(props.model_path) : null;
  }

  var facts = runtimeLoadFacts();
  out.gpu_layers = facts.gpu_layers;
  out.gpu_layers_total = facts.gpu_layers_total;
  out.vram_model_mib = facts.vram_model_mib;
  out.vram_source = facts.source;
  out.last_ready = facts.last_ready;

  var since = sh('systemctl', ['--user', 'show', 'mythos-haddad-runtime.service',
    '-p', 'ActiveEnterTimestamp', '--value']);
  if (since.ok && since.out) { var t = Date.parse(since.out); if (isFinite(t)) out.last_restart = new Date(t).toISOString(); }

  out.state = (out.slots_processing !== null && out.slots_processing > 0) ? 'BUSY' : 'READY';
  return out;
}

// ── GPU ────────────────────────────────────────────────────────────
// vram_total and the device name are real. Utilization, temperature and
// power have NO source on this driver stack (nouveau/NVK, no nvidia-smi,
// no hwmon for this device without root) — they stay null and the reason
// is published so the UI can say why instead of showing a zero.
function collectGpu(health) {
  var out = {
    model: null, driver: null, vram_total_mib: null, vram_used_mib: null,
    utilization_pct: null, temperature_c: null, power_w: null, process: null,
    unavailable_reason: null
  };
  var gpuCheck = (health && health.checks || []).filter(function (c) { return c.id === 'gpu_test' || c.id === 'gpu'; })[0];
  if (gpuCheck && gpuCheck.data) {
    out.model = gpuCheck.data.device || (gpuCheck.data.name || null);
    out.driver = gpuCheck.data.driver || gpuCheck.data.vulkan_api || null;
    out.vram_total_mib = n(gpuCheck.data.vram_mib);
  }
  var vram = path.join(__dirname, 'haddad-gpu-vram.py');
  if (fs.existsSync(vram)) {
    var r = sh('python3', [vram], { timeout: 6000 });
    if (r.ok) {
      try {
        var v = JSON.parse(r.out);
        if (out.vram_total_mib === null) out.vram_total_mib = n(v.vram_total_mib);
        // Documented NVK limitation: heapUsage is 0 even when the model is
        // resident. A zero here is not a measurement, so it is discarded.
        if (n(v.vram_used_mib) > 0) out.vram_used_mib = n(v.vram_used_mib);
      } catch (e) { /* leave null */ }
    }
  }
  if (out.model === null) {
    var dev = sh('sh', ['-c', 'lspci -nn 2>/dev/null | grep -i "VGA\\|3D controller" | head -1']);
    if (dev.ok && dev.out) out.model = dev.out.replace(/^\S+\s+/, '').slice(0, 80);
  }
  if (out.vram_used_mib === null || out.utilization_pct === null) {
    out.unavailable_reason = 'nouveau/NVK exposes no live VRAM, utilisation, temperature or power counter ' +
      'without root debugfs, and there is no nvidia-smi on the open driver stack. ' +
      'The runtime reports what it loaded onto the GPU itself (see runtime.vram_model_mib).';
  }
  return out;
}

// ── system resources ───────────────────────────────────────────────
function collectResources() {
  var out = {
    cpus: os.cpus().length,
    load1: null, load5: null, load15: null,
    mem_used_mib: null, mem_total_mib: null,
    swap_used_mib: null, swap_total_mib: null,
    disk_used_gb: null, disk_total_gb: null, disk_used_pct: null,
    process_count: null, psi_cpu_avg10: null, psi_mem_avg10: null, psi_io_avg10: null
  };
  var la = os.loadavg();
  out.load1 = n(la[0]); out.load5 = n(la[1]); out.load15 = n(la[2]);

  // /proc/meminfo, not os.freemem(): freemem() counts reclaimable page
  // cache as used, which on this box reads as permanent 90 % pressure.
  try {
    var mi = {};
    fs.readFileSync('/proc/meminfo', 'utf8').split('\n').forEach(function (l) {
      var m = /^(\w+):\s+(\d+) kB$/.exec(l); if (m) mi[m[1]] = parseInt(m[2], 10);
    });
    if (mi.MemTotal) {
      out.mem_total_mib = Math.round(mi.MemTotal / 1024);
      var avail = mi.MemAvailable !== undefined ? mi.MemAvailable : mi.MemFree;
      out.mem_used_mib = Math.round((mi.MemTotal - avail) / 1024);
    }
    if (mi.SwapTotal !== undefined) {
      out.swap_total_mib = Math.round(mi.SwapTotal / 1024);
      out.swap_used_mib = Math.round((mi.SwapTotal - (mi.SwapFree || 0)) / 1024);
    }
  } catch (e) { /* leave null */ }

  try {
    var s = fs.statfsSync ? fs.statfsSync('/') : null;
    if (s) {
      var total = s.blocks * s.bsize, free = s.bavail * s.bsize;
      out.disk_total_gb = Math.round(total / 1073741824 * 10) / 10;
      out.disk_used_gb = Math.round((total - free) / 1073741824 * 10) / 10;
      out.disk_used_pct = total ? Math.round((total - free) / total * 1000) / 10 : null;
    }
  } catch (e) { /* leave null */ }

  try { out.process_count = fs.readdirSync('/proc').filter(function (d) { return /^\d+$/.test(d); }).length; }
  catch (e) { /* leave null */ }

  // PSI is the honest pressure signal where the kernel provides it.
  ['cpu', 'memory', 'io'].forEach(function (res) {
    try {
      var txt = fs.readFileSync('/proc/pressure/' + res, 'utf8');
      var m = /some[^\n]*avg10=([\d.]+)/.exec(txt);
      if (m) out['psi_' + (res === 'memory' ? 'mem' : res) + '_avg10'] = parseFloat(m[1]);
    } catch (e) { /* not available */ }
  });
  return out;
}

// ── tasks (the EXISTING executor store, read through its own module) ──
function loadExecutorState() {
  // The executor home is the worker's, not this process's default.
  var home = process.env.MYTHOS_EXECUTOR_HOME;
  if (!home) {
    var envFile = path.join(HOME, '.config', 'mythos-ai-executor', 'executor.env');
    try {
      var m = /^\s*(?:export\s+)?MYTHOS_EXECUTOR_HOME\s*=\s*["']?([^"'\n]+)/m.exec(fs.readFileSync(envFile, 'utf8'));
      if (m) home = m[1].trim();
    } catch (e) { /* fall through */ }
  }
  var repo = process.env.HADDAD_MCP_REPO || path.join(HOME, 'projects', 'mythos-prod');
  var mod = path.join(repo, 'projects', 'mythos-ai-executor', 'lib', 'state.js');
  if (!fs.existsSync(mod)) return null;
  if (home) process.env.MYTHOS_EXECUTOR_HOME = home;
  try { return require(mod); } catch (e) { return null; }
}

var SEVERITY_BY_EVENT = {
  created: 'INFO', transition: 'INFO', model_selected: 'INFO', provider_launch: 'INFO',
  mcp_invoke: 'INFO', mcp_capabilities_resolved: 'INFO', work_delivered: 'SUCCESS',
  finished: 'SUCCESS', interrupted_recovered: 'WARNING', dispatch_deferred: 'WARNING',
  transient_failure: 'WARNING', quota_exhausted: 'WARNING', session_recreated: 'WARNING',
  skill_instructions_unavailable: 'WARNING', failure_classified: 'ERROR',
  dispatch_error: 'ERROR', resume_error: 'ERROR', preflight_blocked: 'ERROR',
  retries_exhausted: 'CRITICAL', hostops_invoked: 'WARNING'
};
function severityFor(ev) {
  if (ev.event === 'transition') {
    if (ev.to === 'COMPLETED') return 'SUCCESS';
    if (ev.to === 'FAILED') return 'ERROR';
    if (ev.to === 'BLOCKED' || ev.to === 'CANCELLED') return 'WARNING';
    return 'INFO';
  }
  return SEVERITY_BY_EVENT[ev.event] || 'INFO';
}
function eventDetail(ev) {
  if (ev.event === 'transition') return ev.from + ' -> ' + ev.to + (ev.reason ? ' (' + ev.reason + ')' : '');
  var bits = [];
  ['to', 'reason', 'classification', 'provider', 'model', 'attempt', 'error', 'summary'].forEach(function (k) {
    if (ev[k] !== undefined && ev[k] !== null && typeof ev[k] !== 'object') bits.push(k + '=' + String(ev[k]));
  });
  return bits.join(' ').slice(0, 300) || null;
}

function collectTasks() {
  var out = { current_task: null, task_counts: {}, events: [], incidents: [] };
  var state = loadExecutorState();
  if (!state) return out;

  var ids;
  try { ids = state.listTasks(); } catch (e) { return out; }

  var records = ids.map(function (id) {
    var status = null, task = null;
    try { status = state.readStatus(id); } catch (e) { /* unreadable task */ }
    try { task = state.readJSON(id, 'task.json'); } catch (e) { /* unreadable task */ }
    if (!status) return null;
    var effective;
    try { effective = state.effectiveStatus(status); } catch (e) { effective = status.status; }
    return { id: id, status: status, task: task || {}, effective: effective };
  }).filter(Boolean);

  records.forEach(function (r) {
    var key = r.effective || r.status.status || 'UNKNOWN';
    out.task_counts[key] = (out.task_counts[key] || 0) + 1;
  });

  // The current task is the running one; with none running, the most
  // recently updated task is shown as the last activity — labelled by its
  // own real status, never as "running".
  var running = records.filter(function (r) { return r.effective === 'RUNNING'; })
    .sort(function (a, b) { return String(b.status.started_at || '').localeCompare(String(a.status.started_at || '')); });
  var pick = running[0] || records.slice().sort(function (a, b) {
    return String(b.status.updated_at || '').localeCompare(String(a.status.updated_at || ''));
  })[0];

  if (pick) {
    var started = pick.status.started_at ? Date.parse(pick.status.started_at) : null;
    var ended = pick.status.ended_at ? Date.parse(pick.status.ended_at) : null;
    var report = null;
    try { report = state.readJSON(pick.id, 'report.json'); } catch (e) { /* no report yet */ }
    var review = report && report.review ? report.review : null;
    var issue = null;
    var im = /(?:issue|gh-issue)[-_ ]?(\d{1,6})/i.exec(String(pick.task.title || pick.task.source || pick.id));
    if (im) issue = parseInt(im[1], 10);
    out.current_task = {
      task_id: pick.id,
      issue: issue,
      project: pick.task.project || null,
      action: pick.task.requested_action || pick.task.stage || null,
      profile: (pick.task.execution && pick.task.execution.execution_profile) || null,
      provider: pick.task.provider || null,
      model: pick.status.model || pick.task.model || null,
      attempt: n(pick.status.retry_count) !== null ? pick.status.retry_count + 1 : null,
      status: pick.status.status || null,
      effective: pick.effective || null,
      started_at: pick.status.started_at || null,
      elapsed_s: started ? Math.round(((ended || Date.now()) - started) / 1000) : null,
      validation: report && report.validation
        ? (typeof report.validation === 'string' ? report.validation : JSON.stringify(report.validation).slice(0, 200))
        : null,
      review: review ? (review.required ? (review.satisfied ? 'satisfied' : 'HUMAN APPROVAL REQUIRED') : 'not required') : null,
      next_action: pick.status.next_action || null
    };
  }

  // Live activity: the real event log of the most recently touched tasks,
  // newest last. Nothing is synthesised — if the executor wrote no event,
  // none is shown.
  var recent = records.slice().sort(function (a, b) {
    return String(b.status.updated_at || '').localeCompare(String(a.status.updated_at || ''));
  }).slice(0, 8);
  var events = [];
  recent.forEach(function (r) {
    var text;
    try { text = state.readText(r.id, 'events.log'); } catch (e) { return; }
    if (!text) return;
    text.trim().split('\n').slice(-40).forEach(function (line) {
      var ev;
      try { ev = JSON.parse(line); } catch (e) { return; }
      if (!ev || !ev.ts || !ev.event) return;
      events.push({
        ts: ev.ts, source: 'executor', event: ev.event, task_id: ev.task_id || r.id,
        severity: severityFor(ev), detail: eventDetail(ev)
      });
    });
  });
  events.sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
  out.events = events.slice(-80);

  // Incidents are DERIVED FROM REAL EVENTS ONLY. An incident is RESOLVED
  // only when a later real event says the task moved on — never assumed.
  var byTask = {};
  records.forEach(function (r) { byTask[r.id] = r; });
  var seen = {};
  events.slice().reverse().forEach(function (ev) {
    if (out.incidents.length >= 15) return;
    if (['retries_exhausted', 'failure_classified', 'resume_error', 'dispatch_error',
      'preflight_blocked', 'session_recreated', 'interrupted_recovered', 'quota_exhausted'].indexOf(ev.event) === -1) return;
    var key = ev.event + ':' + ev.task_id;
    if (seen[key]) return;
    seen[key] = true;
    var rec = byTask[ev.task_id];
    var done = rec && ['COMPLETED', 'CANCELLED'].indexOf(rec.effective) !== -1;
    out.incidents.push({
      id: key, at: ev.ts, kind: ev.event, severity: ev.severity,
      state: done ? 'RESOLVED' : 'OPEN',
      detail: (ev.detail || '') + (done ? ' — task later reached ' + rec.effective : '')
    });
  });
  return out;
}

// ── health ─────────────────────────────────────────────────────────
function collectHealth() {
  var raw = readJson(path.join(STATE_DIR, 'health-latest.json'));
  if (!raw) {
    return { doc: null, summary: { schema: null, generated_at: null, mode: null, status: null, counts: { PASS: 0, WARN: 0, FAIL: 0 }, failing: [], warning: [] } };
  }
  var checks = Array.isArray(raw.checks) ? raw.checks : [];
  return {
    doc: raw,
    summary: {
      schema: raw.schema || null,
      generated_at: raw.generated_at || null,
      mode: raw.mode || null,
      status: raw.status || null,
      counts: {
        PASS: (raw.counts && raw.counts.PASS) || 0,
        WARN: (raw.counts && raw.counts.WARN) || 0,
        FAIL: (raw.counts && raw.counts.FAIL) || 0
      },
      failing: checks.filter(function (c) { return c.status === 'FAIL'; }).map(function (c) { return c.id; }),
      warning: checks.filter(function (c) { return c.status === 'WARN'; }).map(function (c) { return c.id; })
    }
  };
}

// ── workers ────────────────────────────────────────────────────────
// The four units plus the MCP, reported from what is really observable.
// `bridge` and `health` are TIMERS: "active" means scheduled, which is the
// correct healthy state for a per-tick process — it is not a daemon and
// must not be judged as one.
function collectWorkers(units, runtime, health, task) {
  function unitState(v, activeAs) {
    if (v === 'active' || v === 'activating') return activeAs;
    if (v === 'inactive' || v === 'failed') return 'STOPPED';
    return 'UNKNOWN';
  }
  var workers = [
    {
      id: 'executor', name: 'Executor worker',
      state: units.worker === 'active'
        ? (task && task.effective === 'RUNNING' ? 'BUSY' : 'READY')
        : unitState(units.worker, 'READY'),
      detail: 'mythos-haddad-worker.service (' + units.worker + ')'
    },
    { id: 'runtime', name: 'Qwen runtime', state: runtime.state, detail: 'mythos-haddad-runtime.service (' + units.runtime + ')' },
    { id: 'bridge', name: 'GitHub bridge', state: unitState(units.bridge, 'RUNNING'), detail: 'mythos-haddad-bridge.timer (' + units.bridge + ') — per-tick, scheduled' },
    { id: 'health', name: 'Health monitor', state: unitState(units.health, 'RUNNING'), detail: 'mythos-haddad-health.timer (' + units.health + ') — per-tick, scheduled' }
  ];
  // FABLE is this machine's supervising Claude session. It is not a unit
  // and the node cannot observe it, so it is reported UNKNOWN rather than
  // invented. Same for the MCP, unless the health run actually probed it.
  var mcp = (health.doc && health.doc.checks || []).filter(function (c) { return c.id === 'mcp'; })[0];
  workers.push({
    id: 'mcp', name: 'Haddad MCP',
    state: mcp ? (mcp.status === 'PASS' ? 'READY' : mcp.status === 'FAIL' ? 'DEGRADED' : 'UNKNOWN') : 'UNKNOWN',
    detail: mcp ? String(mcp.detail || '').slice(0, 200) : 'not probed by the last health run'
  });
  workers.push({
    id: 'fable', name: 'FABLE supervisor',
    state: 'UNKNOWN',
    detail: 'an interactive Claude session, not a unit — the node cannot observe it'
  });
  return workers;
}

// ── envelope ───────────────────────────────────────────────────────
function nextSeq() {
  var prev = 0;
  try { prev = parseInt(fs.readFileSync(SEQ_FILE, 'utf8').trim(), 10) || 0; } catch (e) { prev = 0; }
  // Seed from the wall clock on first use so a lost state file cannot
  // produce a sequence the receiver has already seen.
  var next = Math.max(prev + 1, Math.floor(Date.now() / 1000));
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(SEQ_FILE, String(next), { mode: 0o600 });
  } catch (e) { /* a non-persisted seq still increases within this boot */ }
  return next;
}

function collect(cfg) {
  var units = collectUnits();
  var health = collectHealth();
  var runtime = collectRuntime(units);
  var tasks = collectTasks();
  var bootAt = new Date(Date.now() - os.uptime() * 1000).toISOString();
  var osRel = {};
  try {
    fs.readFileSync('/etc/os-release', 'utf8').split('\n').forEach(function (l) {
      var m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) osRel[m[1]] = m[2].replace(/^"|"$/g, '');
    });
  } catch (e) { /* leave unknown */ }

  var repo = { head: null, branch: null, dirty: null };
  var repoDir = process.env.HADDAD_MCP_REPO || path.join(HOME, 'projects', 'mythos-prod');
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    var h = sh('git', ['-C', repoDir, 'rev-parse', '--short', 'HEAD']);
    var b = sh('git', ['-C', repoDir, 'branch', '--show-current']);
    var d = sh('git', ['-C', repoDir, 'status', '--porcelain']);
    if (h.ok) repo.head = h.out;
    if (b.ok) repo.branch = b.out || null;
    if (d.ok) repo.dirty = d.out.length > 0;
  }

  return {
    schema: SCHEMA,
    node: cfg.node,
    sent_at: new Date().toISOString(),
    seq: nextSeq(),
    agent_version: AGENT_VERSION,
    node_info: {
      hostname: os.hostname(),
      os: osRel.PRETTY_NAME || null,
      kernel: os.release(),
      uptime_s: Math.round(os.uptime()),
      boot_at: bootAt,
      last_restart: null
    },
    health: health.summary,
    workers: collectWorkers(units, runtime, health, tasks.current_task),
    runtime: runtime,
    gpu: collectGpu(health.doc),
    resources: collectResources(),
    current_task: tasks.current_task,
    task_counts: tasks.task_counts,
    events: tasks.events,
    incidents: tasks.incidents,
    repo: repo
  };
}

// ── send ───────────────────────────────────────────────────────────
function send(cfg, envelope) {
  return new Promise(function (resolve, reject) {
    var body = Buffer.from(JSON.stringify(envelope), 'utf8');
    var key;
    try { key = crypto.createPrivateKey(fs.readFileSync(cfg.key_file, 'utf8')); }
    catch (e) { return reject(new Error('CONFIG: cannot read the signing key ' + cfg.key_file + ': ' + e.message)); }
    if (key.asymmetricKeyType !== 'ed25519') return reject(new Error('CONFIG: the signing key is not ed25519'));
    var sig = crypto.sign(null, body, key);

    var target;
    try { target = new url.URL(cfg.endpoint); } catch (e) { return reject(new Error('CONFIG: invalid endpoint ' + cfg.endpoint)); }
    var mod = target.protocol === 'http:' ? http : https;
    var req = mod.request(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'X-Mythos-Node': envelope.node,
        'X-Mythos-Signature': sig.toString('base64'),
        'User-Agent': 'mythos-haddad-telemetry/' + AGENT_VERSION
      }
    }, function (res) {
      var out = '';
      res.on('data', function (c) { if (out.length < 2048) out += c; });
      res.on('end', function () {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, body: out.trim() });
        reject(new Error('ENDPOINT: HTTP ' + res.statusCode + ' ' + out.trim().slice(0, 200)));
      });
    });
    req.setTimeout(cfg.timeout_ms, function () { req.destroy(new Error('ENDPOINT: timeout after ' + cfg.timeout_ms + 'ms')); });
    req.on('error', function (e) { reject(new Error('ENDPOINT: ' + e.message)); });
    req.end(body);
  });
}

function main() {
  var cfg = loadConfig();
  var envelope;
  try { envelope = collect(cfg); }
  catch (e) {
    process.stderr.write('ERROR: collection failed: ' + String(e && e.message).slice(0, 300) + '\n');
    process.exitCode = 1;
    return;
  }
  if (DRY) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
    return;
  }
  send(cfg, envelope).then(function (r) {
    process.stdout.write('sent seq=' + envelope.seq + ' -> HTTP ' + r.status + ' ' + r.body + '\n');
  }).catch(function (e) {
    process.stderr.write(String(e && e.message).slice(0, 300) + '\n');
    process.exitCode = 2;
  });
}

if (require.main === module) main();

module.exports = {
  AGENT_VERSION: AGENT_VERSION,
  SCHEMA: SCHEMA,
  collect: collect,
  collectResources: collectResources,
  collectWorkers: collectWorkers,
  collectGpu: collectGpu,
  severityFor: severityFor,
  eventDetail: eventDetail,
  loadConfig: loadConfig
};
