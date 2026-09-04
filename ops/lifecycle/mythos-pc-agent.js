#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS PC Agent — lifecycle relay for Claude sessions on a PC
// ops/lifecycle/mythos-pc-agent.js
//
// Runs on the owner's PC (Windows, macOS or Linux), next to Claude Code.
// It is the PC half of the PC Runtime (lib/lifecycle/runtime-pc.js):
//
//   * claude-lifecycle-hook.js (wired into Claude's hooks on the PC with
//     MYTHOS_LIFECYCLE_LOCATION=PC) drops events into a local SPOOL dir;
//   * this agent relays the spool to the VPS executor API
//     (POST /lifecycle/events, bearer token + HMAC signature), in order,
//     with retries and exponential backoff — the spool IS the durable state,
//     so a disconnect loses nothing;
//   * it sends a HEARTBEAT for every session it knows to be open, so the
//     VPS can tell "idle" from "relay lost";
//   * after a SessionEnd it watches the PID and sends PROCESS_GONE when the
//     process has actually disappeared — the only proof of closure the VPS
//     accepts for a PC session;
//   * it polls its outbox (GET /lifecycle/outbox/PC) for register_execution
//     and close_request messages. A close request is honoured ONLY when this
//     agent's own config says allow_close=true, only for a PID it registered
//     itself from a hook event, only with the platform's graceful signal
//     (SIGTERM / taskkill without /F); force_close_request additionally
//     requires allow_force=true. Nothing else is executed. Ever.
//
// Config (JSON file, path in MYTHOS_PC_AGENT_CONFIG, default ~/.mythos-pc-agent/config.json):
//   { "endpoint": "http://127.0.0.1:8130",      // reach the VPS executor via an SSH tunnel or a private route
//     "token_file": "~/.mythos-pc-agent/token",  // executor bearer token (0600)
//     "secret_file": "~/.mythos-pc-agent/secret",// HMAC secret shared with MYTHOS_LIFECYCLE_RELAY_SECRET on the VPS
//     "spool": "~/.mythos-pc-agent/spool",
//     "host": "owner-pc",
//     "poll_ms": 15000, "heartbeat_ms": 60000,
//     "allow_close": false, "allow_force": false }
//
// No dependencies beyond node core. Secrets are read from files, never
// from argv or logs.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var https = require('https');
var crypto = require('crypto');
var cp = require('child_process');

function expand(p) { return p ? p.replace(/^~(?=$|[\\/])/, os.homedir()) : p; }

function loadConfig() {
  var file = expand(process.env.MYTHOS_PC_AGENT_CONFIG || path.join(os.homedir(), '.mythos-pc-agent', 'config.json'));
  var cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { cfg = {}; }
  var base = path.join(os.homedir(), '.mythos-pc-agent');
  return {
    endpoint: cfg.endpoint || process.env.MYTHOS_PC_AGENT_ENDPOINT || 'http://127.0.0.1:8130',
    token_file: expand(cfg.token_file || path.join(base, 'token')),
    secret_file: expand(cfg.secret_file || path.join(base, 'secret')),
    spool: expand(cfg.spool || process.env.MYTHOS_LIFECYCLE_SPOOL || path.join(base, 'spool')),
    state_file: expand(cfg.state_file || path.join(base, 'state.json')),
    host: cfg.host || process.env.MYTHOS_LIFECYCLE_HOST || os.hostname(),
    poll_ms: cfg.poll_ms || 15000,
    heartbeat_ms: cfg.heartbeat_ms || 60000,
    allow_close: cfg.allow_close === true,
    allow_force: cfg.allow_force === true,
    max_backoff_ms: cfg.max_backoff_ms || 5 * 60 * 1000
  };
}

function readSecret(file) { try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { return null; } }

function request(cfg, method, urlPath, body) {
  return new Promise(function (resolve) {
    var token = readSecret(cfg.token_file);
    var secret = readSecret(cfg.secret_file);
    var u = new URL(urlPath, cfg.endpoint);
    var data = body ? JSON.stringify(body) : '';
    var ts = String(Date.now());
    var headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': 'Bearer ' + (token || ''), 'X-Mythos-Timestamp': ts };
    if (secret) headers['X-Mythos-Signature'] = 'sha256=' + crypto.createHmac('sha256', secret).update(ts + '.' + data).digest('hex');
    var mod = u.protocol === 'https:' ? https : http;
    var req = mod.request({ method: method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: headers, timeout: 15000 }, function (res) {
      var chunks = [];
      res.on('data', function (d) { chunks.push(d); });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: json });
      });
    });
    req.on('timeout', function () { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.on('error', function (e) { resolve({ ok: false, status: 0, error: e.code || e.message }); });
    req.end(data);
  });
}

// --- local state: which sessions are open, which pids we own -------------------------------
function loadState(cfg) { try { return JSON.parse(fs.readFileSync(cfg.state_file, 'utf8')); } catch (e) { return { sessions: {} }; } }
function saveState(cfg, st) {
  try { fs.mkdirSync(path.dirname(cfg.state_file), { recursive: true }); var tmp = cfg.state_file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st, null, 2), { mode: 0o600 }); fs.renameSync(tmp, cfg.state_file); } catch (e) { /* ignore */ }
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function gracefulClose(pid) {
  if (process.platform === 'win32') { try { cp.execFileSync('taskkill', ['/PID', String(pid)], { stdio: 'ignore', timeout: 10000 }); return true; } catch (e) { return false; } }
  try { process.kill(pid, 'SIGTERM'); return true; } catch (e) { return false; }
}
function forceClose(pid) {
  if (process.platform === 'win32') { try { cp.execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore', timeout: 10000 }); return true; } catch (e) { return false; } }
  try { process.kill(pid, 'SIGKILL'); return true; } catch (e) { return false; }
}

// --- the loop --------------------------------------------------------------------------------------
function log(o) { console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString() }, o))); }

async function relaySpool(cfg, st) {
  var names;
  try { names = fs.readdirSync(cfg.spool).filter(function (n) { return /\.json$/.test(n); }).sort(); } catch (e) { return { sent: 0 }; }
  var events = [];
  var files = [];
  names.slice(0, 100).forEach(function (n) {
    try { var ev = JSON.parse(fs.readFileSync(path.join(cfg.spool, n), 'utf8')); ev.location = 'PC'; ev.host = cfg.host; events.push(ev); files.push(n); }
    catch (e) { try { fs.renameSync(path.join(cfg.spool, n), path.join(cfg.spool, n + '.bad')); } catch (e2) { /* ignore */ } }
  });
  if (!events.length) return { sent: 0 };
  // Track sessions/pids we learned from OUR hooks — the only pids a close request may ever touch.
  events.forEach(function (ev) {
    if (!ev.session_id) return;
    var s = st.sessions[ev.session_id] = st.sessions[ev.session_id] || { pid: null, open: true, ended_at: null };
    if (ev.pid) s.pid = ev.pid;
    if (ev.type === 'SESSION_END') { s.ended_at = ev.at; }
    if (ev.type === 'PROCESS_GONE' || ev.type === 'SESSION_CLOSED') { s.open = false; }
  });
  var r = await request(cfg, 'POST', '/lifecycle/events', { events: events });
  if (!r.ok) return { sent: 0, error: r.error || r.status };
  files.forEach(function (n) { try { fs.unlinkSync(path.join(cfg.spool, n)); } catch (e) { /* ignore */ } });
  saveState(cfg, st);
  return { sent: events.length };
}

function spoolEvent(cfg, ev) {
  try {
    fs.mkdirSync(cfg.spool, { recursive: true });
    var f = path.join(cfg.spool, Date.now() + '-agent-' + Math.random().toString(36).slice(2, 8) + '.json');
    fs.writeFileSync(f + '.part', JSON.stringify(Object.assign({ at: new Date().toISOString(), source: 'pc-agent', agent: 'claude-code', provider: 'claude-code' }, ev)));
    fs.renameSync(f + '.part', f);
  } catch (e) { /* ignore */ }
}

function heartbeatsAndExits(cfg, st) {
  Object.keys(st.sessions).forEach(function (sid) {
    var s = st.sessions[sid];
    if (!s.open) return;
    if (s.ended_at || (s.pid && !pidAlive(s.pid))) {
      if (!pidAlive(s.pid)) { spoolEvent(cfg, { type: 'PROCESS_GONE', session_id: sid, pid: s.pid, reason: s.ended_at ? 'ended and process gone' : 'process gone without SessionEnd' }); s.open = false; return; }
    }
    spoolEvent(cfg, { type: 'HEARTBEAT', session_id: sid, pid: s.pid });
  });
  saveState(cfg, st);
}

async function pollOutbox(cfg, st) {
  var r = await request(cfg, 'GET', '/lifecycle/outbox/PC');
  if (!r.ok || !r.body || !Array.isArray(r.body.requests)) return { handled: 0 };
  var handled = 0;
  for (var i = 0; i < r.body.requests.length; i++) {
    var m = r.body.requests[i];
    var result = 'ignored';
    if (m.expires_at && Date.parse(m.expires_at) < Date.now()) result = 'expired';
    else if (m.kind === 'register_execution') { st.executions = st.executions || {}; st.executions[m.execution_id] = { task_id: m.task_id, at: new Date().toISOString() }; result = 'registered'; }
    else if (m.kind === 'close_request' || m.kind === 'force_close_request') {
      var s = st.sessions[m.session_id];
      if (!cfg.allow_close) result = 'refused:allow_close=false';
      else if (!s || !s.pid) result = 'refused:unknown_session';
      else if (m.pid && m.pid !== s.pid) result = 'refused:pid_mismatch';
      else if (!pidAlive(s.pid)) { result = 'already_gone'; spoolEvent(cfg, { type: 'PROCESS_GONE', session_id: m.session_id, pid: s.pid, reason: 'gone before close request' }); }
      else if (m.kind === 'force_close_request' && !cfg.allow_force) result = 'refused:allow_force=false';
      else { var okc = m.kind === 'force_close_request' ? forceClose(s.pid) : gracefulClose(s.pid); result = okc ? 'signalled' : 'signal_failed'; }
    }
    await request(cfg, 'POST', '/lifecycle/outbox/PC/ack', { request_id: m.request_id, result: result });
    log({ outbox: m.kind, request_id: m.request_id, result: result });
    handled++;
  }
  saveState(cfg, st);
  return { handled: handled };
}

async function main() {
  var cfg = loadConfig();
  var st = loadState(cfg);
  var backoff = cfg.poll_ms;
  var lastHb = 0;
  log({ agent: 'started', host: cfg.host, endpoint: cfg.endpoint, spool: cfg.spool, allow_close: cfg.allow_close, allow_force: cfg.allow_force });
  for (;;) {
    var now = Date.now();
    if (now - lastHb >= cfg.heartbeat_ms) { heartbeatsAndExits(cfg, st); lastHb = now; }
    var sent = await relaySpool(cfg, st);
    var ob = sent.error ? { handled: 0 } : await pollOutbox(cfg, st);
    if (sent.error) { backoff = Math.min(backoff * 2, cfg.max_backoff_ms); log({ relay: 'unreachable', error: sent.error, retry_ms: backoff }); }
    else { backoff = cfg.poll_ms; if (sent.sent || ob.handled) log({ relayed: sent.sent, outbox_handled: ob.handled }); }
    await new Promise(function (r) { setTimeout(r, backoff); });
  }
}

if (require.main === module) main().catch(function (e) { log({ fatal: e.message }); process.exit(1); });

module.exports = { loadConfig: loadConfig, relaySpool: relaySpool, pollOutbox: pollOutbox, heartbeatsAndExits: heartbeatsAndExits, request: request, gracefulClose: gracefulClose };
