'use strict';
// =====================================================
// MYTHOS — end-to-end mission lifecycle test
// tests/mos-e2e-lifecycle-test.js
//
// Proves ONE complete real mission lifecycle across the real modules,
// wired together the way production wires them — no stub control plane:
//
//   Instruction
//     → Command Center (projects/mythos-os-console, real HTTP server,
//       real sign-in, automatic title rule)
//     → Mission creation (real relay to the REAL executor HTTP API)
//     → Mission Executor (projects/mythos-ai-executor, real createTask,
//       real capacity-gated dispatch, real state machine)
//     → Execution (providers/mock.js standing in for the execution
//       provider, exactly as the executor suite uses it — no real AI
//       quota, no real repository writes)
//     → Verification (report extraction/validation, git verification
//       surface, executed ≠ completed)
//     → Persistent result (task.json / status.json / report.json /
//       checkpoint.json / events.log on disk)
//     → Persistent handover: EVERY module instance is torn down and
//       re-required — a genuinely fresh "session" — and Mission B is
//       created from nothing but what the public read API returns about
//       Mission A. No hidden conversational context.
//
// Deterministic and offline. The ONLY provider substitution is at the
// executor's own exported PROVIDERS seam, in this test process — the
// boundary providers/mock.js exists for. Nothing in any payload selects
// the mock; the console still only accepts its real provider enum.
//
// SAFETY — read before running anywhere. The console fixes
// project='mythos-prod', and a completed mission's report delivery
// (report_to_git) targets that project's registered checkout path. On
// this suite's hosts that path must NOT exist: the suite REFUSES to run
// (hard abort, mcc-1 discipline) when the registered mythos-prod
// checkout is present, so it can never commit a test report into the
// real repository. Run it in an isolated container/CI workspace.
//
// Run with: node tests/mos-e2e-lifecycle-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var crypto = require('crypto');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var REF = path.join(BASE, 'projects', 'mythos-os-console', 'reference');

// --- SAFETY GUARD (before anything else) -----------------------------------
var PROJECTS_CFG = JSON.parse(fs.readFileSync(path.join(EXEC, 'config', 'projects.json'), 'utf8'));
var PROD_PATH = (PROJECTS_CFG['mythos-prod'] || {}).path;
if (PROD_PATH && fs.existsSync(path.join(PROD_PATH, '.git'))) {
  console.error('REFUSED: the registered mythos-prod checkout exists at ' + PROD_PATH + '.');
  console.error('This suite completes real missions for project mythos-prod; report delivery');
  console.error('would touch that repository. Run this suite only in an isolated container.');
  process.exit(1);
}

// --- Environment (before any executor/console require) ---------------------
var FIXTURES = path.join(os.homedir(), 'mos-e2e-lifecycle-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
var EXECUTOR_TOKEN = crypto.randomBytes(24).toString('hex');
var CONSOLE_SECRET = 'mos-e2e-console-secret-' + crypto.randomBytes(8).toString('hex');
var SECRET_FILE = path.join(FIXTURES, 'console-secret');
fs.writeFileSync(SECRET_FILE, 'MOS_CONSOLE_SECRET=' + CONSOLE_SECRET + '\n', { mode: 0o600 });
fs.chmodSync(SECRET_FILE, 0o600);

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'executor-home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
delete process.env.MYTHOS_MOCK_SCRIPT;
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIXTURES, 'no-advisory-credential.env');
process.env.MYTHOS_EXECUTOR_TOKEN = EXECUTOR_TOKEN;
process.env.MOS_CONSOLE_SECRET_FILE = SECRET_FILE;
process.env.MOS_EXECUTOR_TOKEN = EXECUTOR_TOKEN;
delete process.env.MOS_EXECUTOR_TOKEN_FILE;
delete process.env.MOS_ALLOW_REPO_WRITE;

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}
function eq(actual, expected, name) {
  ok(actual === expected, name + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

// --- module lifecycle: require fresh, tear down completely ------------------
function dropProjectModules() {
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf(path.sep + path.join('projects', 'mythos-ai-executor') + path.sep) !== -1 ||
        k.indexOf(path.sep + path.join('projects', 'mythos-os-console') + path.sep) !== -1 ||
        k.indexOf(path.sep + path.join('projects', 'mythos-orchestrator') + path.sep) !== -1) {
      delete require.cache[k];
    }
  });
}

// Boots the real executor HTTP server with the mock standing in at the
// executor's own exported PROVIDERS seam for the execution provider —
// executionAuthority preserved so the task keeps its real execution
// profile and working-directory shape.
// The executor's start() treats port 0 as "use the default", so an
// ephemeral port is reserved explicitly first.
function freePort() {
  return new Promise(function (resolve) {
    var probe = require('net').createServer();
    probe.listen(0, '127.0.0.1', function () {
      var p = probe.address().port;
      probe.close(function () { resolve(p); });
    });
  });
}

function bootExecutor() {
  var executor = require(path.join(EXEC, 'executor'));
  var mockProvider = require(path.join(EXEC, 'providers', 'mock'));
  var serverMod = require(path.join(EXEC, 'server'));
  executor.PROVIDERS['claude-code'] = Object.assign({}, mockProvider, {
    executionAuthority: true,
    version: function () { return 'mock-as-execution-provider/1'; }
  });
  return freePort().then(function (port) {
    var servers = serverMod.start({ port: port, binds: ['127.0.0.1'] });
    return new Promise(function (resolve) {
      servers[0].on('listening', function () {
        resolve({ executor: executor, mock: mockProvider, servers: servers, port: servers[0].address().port });
      });
    });
  });
}

function bootConsole(executorPort) {
  process.env.MOS_EXECUTOR_URL = 'http://127.0.0.1:' + executorPort;
  var consoleServer = require(path.join(REF, 'server.js'));
  return consoleServer.start({ port: 0, bind: '127.0.0.1' }).then(function (s) {
    return { server: s, port: s.address().port };
  });
}

function req(port, p, method, body, cookie) {
  return new Promise(function (resolve) {
    var payload = body !== undefined ? JSON.stringify(body) : null;
    var headers = payload !== null
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (cookie) headers.Cookie = cookie;
    var r = http.request({ host: '127.0.0.1', port: port, path: p, method: method || 'GET', headers: headers }, function (res) {
      var b = '';
      res.on('data', function (d) { b += d; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(b); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, text: b, json: json, setCookie: res.headers['set-cookie'] || [] });
      });
    });
    r.on('error', function () { resolve({ status: 0, text: '', json: null, setCookie: [] }); });
    if (payload !== null) r.write(payload);
    r.end();
  });
}

function login(port) {
  return req(port, '/api/login', 'POST', { password: CONSOLE_SECRET }).then(function (r) {
    var raw = r.setCookie[0] || '';
    return raw ? raw.split(';')[0] : null;
  });
}

function setScript(mock, entries) {
  process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify(entries);
  mock.reset();
}

var TERMINAL = ['COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];
function waitTerminal(port, cookie, taskId, tries) {
  tries = tries === undefined ? 200 : tries;
  return req(port, '/api/missions/' + taskId, 'GET', undefined, cookie).then(function (r) {
    var st = r.json && r.json.data && r.json.data.status && r.json.data.status.status;
    if (st && TERMINAL.indexOf(st) !== -1) return r;
    if (tries <= 0) throw new Error('TIMEOUT waiting for ' + taskId + ' (last status: ' + st + ')');
    return new Promise(function (resolve) { setTimeout(resolve, 25); })
      .then(function () { return waitTerminal(port, cookie, taskId, tries - 1); });
  });
}

// State-file readers — the persistent record itself, straight from disk.
function taskFile(taskId, name) {
  var p = path.join(process.env.MYTHOS_EXECUTOR_HOME, '.mythos-ai-executor', 'tasks', taskId, name);
  if (!fs.existsSync(p)) {
    // lib/state roots under MYTHOS_EXECUTOR_HOME directly on some layouts —
    // resolve through the live module instead of guessing twice.
    var state = require(path.join(EXEC, 'lib', 'state'));
    return { json: state.readJSON(taskId, name), text: state.readText(taskId, name) };
  }
  var raw = fs.readFileSync(p, 'utf8');
  var json = null;
  try { json = JSON.parse(raw); } catch (e) { /* not JSON */ }
  return { json: json, text: raw };
}
function eventsOf(taskId) {
  var text = taskFile(taskId, 'events.log').text || '';
  return text.trim().split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
}

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

var INSTRUCTION_A = 'Validate the end-to-end mission lifecycle\nacross the Command Center, the executor and the persistent store.';
var TITLE_A = 'Validate the end-to-end mission lifecycle';

var phase1; // { executor, mock, servers, port } + console handle
var missionA = null;

bootExecutor().then(function (ex) {
  phase1 = ex;
  return bootConsole(ex.port).then(function (con) { phase1.console = con; });
}).then(function () {
  return login(phase1.console.port);
}).then(function (cookie) {
  phase1.cookie = cookie;
  ok(!!cookie, 'phase 1: real sign-in against the real console issues a session');

  // ---- Instruction → Command Center → Mission (automatic title) ----------
  setScript(phase1.mock, [{ kind: 'success', summary: 'lifecycle mission A executed', text: 'Mission A done' }]);
  return req(phase1.console.port, '/api/missions/start', 'POST',
    { instruction: INSTRUCTION_A, provider: 'claude-code' }, phase1.cookie);
}).then(function (r) {
  eq(r.status, 200, 'E2E: a titleless instruction entered through the Command Center becomes a mission');
  missionA = r.json && r.json.data && r.json.data.task_id;
  ok(/^t-[a-z0-9-]+$/.test(String(missionA)), 'E2E: the mission ID is generated in the executor\'s own format (' + missionA + ')');
  eq(r.json.data.provider, 'claude-code', 'E2E: the resolved provider is echoed back');
  ok(r.json.data.status === 'RUNNING' || r.json.data.status === 'QUEUED',
     'E2E: the mission is admitted by the real capacity-gated dispatcher (' + r.json.data.status + ')');

  // ---- Execution → terminal state ----------------------------------------
  return waitTerminal(phase1.console.port, phase1.cookie, missionA);
}).then(function (r) {
  var d = r.json.data;
  eq(d.status.status, 'COMPLETED', 'E2E: the mission ran to COMPLETED through the real executor state machine');
  eq(d.task.stage, TITLE_A, 'E2E: the mission title IS the first meaningful instruction line, end to end');
  eq(d.task.instruction, INSTRUCTION_A, 'E2E: the original instruction reached the executor byte-identical — never mutated by titling');
  eq(d.task.project, 'mythos-prod', 'E2E: project context is fixed server-side and preserved');
  eq(d.task.execution_profile, 'repo-read', 'E2E: the execution policy (default read-only ceiling) is preserved on the mission');
  eq(d.task.priority, 'normal', 'E2E: priority is preserved on the mission');

  // ---- Verification layer: Requested / Executed / Succeeded / Verified ---
  var events = eventsOf(missionA);
  var kinds = events.map(function (e) { return e.event; });
  ok(kinds.indexOf('created') !== -1, 'verification: REQUESTED is a distinct persisted state (created event)');
  ok(kinds.indexOf('provider_launch') !== -1, 'verification: EXECUTED is a distinct persisted state (provider_launch event)');
  ok(kinds.indexOf('finished') !== -1, 'verification: SUCCEEDED is a distinct persisted state (finished event)');
  var report = taskFile(missionA, 'report.json').json;
  ok(report && report.git && 'git_verified' in report.git,
     'verification: VERIFIED is a distinct surface (report.json carries an independent git-verification result, not the provider\'s claim)');
  var finished = events.filter(function (e) { return e.event === 'finished'; })[0];
  eq(finished.report_committed, false,
     'verification: report delivery honestly records that no repository was available here');
  ok(!!finished.delivery_problem,
     'verification: the delivery outcome carries an explicit machine-readable reason, never a silent fallback');

  // ---- Persistent result (§ result-persistence checklist) ----------------
  var task = taskFile(missionA, 'task.json').json;
  var status = taskFile(missionA, 'status.json').json;
  var checkpoint = taskFile(missionA, 'checkpoint.json').json;
  eq(task.task_id, missionA, 'persistence: mission ID persisted');
  eq(task.instruction, INSTRUCTION_A, 'persistence: instruction persisted verbatim');
  eq(task.stage, TITLE_A, 'persistence: title persisted');
  eq(task.project, 'mythos-prod', 'persistence: project persisted');
  eq(status.status, 'COMPLETED', 'persistence: execution state persisted');
  eq(report.report.status, 'completed', 'persistence: result persisted');
  eq(report.report.summary, 'lifecycle mission A executed', 'persistence: result summary persisted');
  ok(Array.isArray(report.problems), 'persistence: verification findings persisted');
  ok(!!task.created_at && !!status.ended_at, 'persistence: timestamps persisted');
  ok(!!status.next_action, 'persistence: next action persisted (' + status.next_action + ')');
  ok(checkpoint && checkpoint.current_step === 'done', 'persistence: checkpoint records the completed lifecycle');
  ok(taskFile(missionA, 'report.md').text.indexOf(missionA) !== -1,
     'persistence: the human-readable handover report exists and names the mission');
  var everything = JSON.stringify(task) + JSON.stringify(status) + JSON.stringify(report);
  ok(everything.indexOf(EXECUTOR_TOKEN) === -1 && everything.indexOf(CONSOLE_SECRET) === -1,
     'persistence: no credential appears anywhere in the persisted mission record');

  // ---- Failure injection at the same seam ---------------------------------
  // (a) executed ≠ completed: a run that exits 0 but delivers no verifiable
  //     report must NOT become COMPLETED.
  setScript(phase1.mock, [{ kind: 'malformed' }]);
  return req(phase1.console.port, '/api/missions/start', 'POST',
    { instruction: 'Produce a run with no structured report', provider: 'claude-code' }, phase1.cookie);
}).then(function (r) {
  eq(r.status, 200, 'failure injection: the no-report mission is admitted');
  return waitTerminal(phase1.console.port, phase1.cookie, r.json.data.task_id);
}).then(function (r) {
  eq(r.json.data.status.status, 'BLOCKED',
     'failure injection: a run that executed cleanly but produced no verifiable report lands BLOCKED — "command executed" is never "mission completed"');
  ok(/no structured report/.test(r.json.data.status.next_action || ''),
     'failure injection: the blocked state names exactly what is missing');

  // (b) blocked execution becomes actionable persisted information.
  setScript(phase1.mock, [{ kind: 'blocked' }]);
  return req(phase1.console.port, '/api/missions/start', 'POST',
    { instruction: 'Hit a credential blocker deterministically', provider: 'claude-code' }, phase1.cookie);
}).then(function (r) {
  return waitTerminal(phase1.console.port, phase1.cookie, r.json.data.task_id).then(function (rr) {
    var d = rr.json.data;
    eq(d.status.status, 'BLOCKED', 'blocked state: a genuine blocker lands BLOCKED, not FAILED and not silently retried');
    ok(!!d.status.last_error, 'blocked state: the exact blocker evidence is persisted');
    ok(/human blocker|re-queue/.test(d.status.next_action || ''),
       'blocked state: the persisted next action names the required human intervention');
    var kinds = eventsOf(d.task.task_id).map(function (e) { return e.event; });
    ok(kinds.indexOf('blocked_failure') !== -1, 'blocked state: the blocker is a machine-readable event, not a dead end');
  });
}).then(function () {
  // (c) malformed missions are refused before any state exists.
  return Promise.all([
    req(phase1.console.port, '/api/missions/start', 'POST', { instruction: '   \n  ', provider: 'claude-code' }, phase1.cookie),
    req(phase1.console.port, '/api/missions/start', 'POST', { instruction: 'x', provider: 'not-a-provider' }, phase1.cookie),
    req(phase1.console.port, '/api/missions/start', 'POST', { instruction: 'x', provider: 'claude-code', execution_profile: 'deploy' }, phase1.cookie)
  ]);
}).then(function (rr) {
  eq(rr[0].status, 400, 'failure injection: an empty instruction (even titleless) is refused explicitly');
  eq(rr[1].status, 400, 'failure injection: an unknown provider is refused explicitly');
  eq(rr[2].status, 400, 'failure injection: a profile outside the console allowlist is refused explicitly');

  // ---- PERSISTENT HANDOVER: tear EVERYTHING down ---------------------------
  // Close both real servers, drop every executor/console/orchestrator module
  // from the require cache, and boot a genuinely fresh instance of the whole
  // stack. Whatever Mission B can learn about Mission A must come from the
  // persisted store through the public API — there is no other channel left.
  phase1.console.server.close();
  return new Promise(function (resolve) {
    var open = phase1.servers.length;
    phase1.servers.forEach(function (s) { s.close(function () { if (--open === 0) resolve(); }); });
  });
}).then(function () {
  dropProjectModules();
  return bootExecutor();
}).then(function (ex) {
  phase1 = ex;
  return bootConsole(ex.port).then(function (con) {
    phase1.console = con;
    return login(con.port);
  }).then(function (cookie) { phase1.cookie = cookie; });
}).then(function () {
  ok(!!phase1.cookie, 'phase 2: a fresh console instance (fresh modules, fresh session) signs in');
  return req(phase1.console.port, '/api/missions', 'GET', undefined, phase1.cookie);
}).then(function (r) {
  var rows = (r.json && r.json.data && r.json.data.tasks) || [];
  var a = rows.filter(function (t) { return t.task_id === missionA; })[0];
  ok(!!a, 'handover: the fresh instance sees Mission A in the persistent store');
  eq(a && a.status, 'COMPLETED', 'handover: Mission A\'s terminal state survived the full restart');
  eq(a && a.stage, TITLE_A, 'handover: Mission A\'s derived title survived the full restart');
  return req(phase1.console.port, '/api/missions/' + missionA + '/report', 'GET', undefined, phase1.cookie);
}).then(function (r) {
  eq(r.status, 200, 'handover: Mission A\'s report is readable through the public API after restart');
  eq(r.json.data.status, 'completed', 'handover: the persisted result status is served');
  eq(r.json.data.summary, 'lifecycle mission A executed', 'handover: the persisted result summary is served');

  // ---- Mission B consumes Mission A's persisted result --------------------
  // Composed ONLY from what the public API just returned — the exact
  // continuation flow an operator or the operating layer performs.
  var instructionB = 'Continue from mission ' + missionA + '\n' +
    'Previous result: ' + r.json.data.summary + '\n' +
    'Verify the previous mission\'s outcome and proceed with the next stage.';
  setScript(phase1.mock, [{ kind: 'success', summary: 'lifecycle mission B consumed mission A', text: 'Mission B done' }]);
  return req(phase1.console.port, '/api/missions/start', 'POST',
    { instruction: instructionB, provider: 'claude-code' }, phase1.cookie);
}).then(function (r) {
  eq(r.status, 200, 'loop: Mission B (titleless, derived from its first line) is admitted');
  return waitTerminal(phase1.console.port, phase1.cookie, r.json.data.task_id);
}).then(function (r) {
  var d = r.json.data;
  eq(d.status.status, 'COMPLETED', 'loop: Mission B ran to COMPLETED');
  eq(d.task.stage, 'Continue from mission ' + missionA,
     'loop: Mission B\'s derived title names the mission it continues from');
  ok(d.task.instruction.indexOf(missionA) !== -1 &&
     d.task.instruction.indexOf('lifecycle mission A executed') !== -1,
     'loop: Mission B\'s persisted record carries Mission A\'s ID and result — the continuation is reconstructable from persistent state alone');
  var promptText = taskFile(d.task.task_id, 'prompt.md').text || '';
  ok(promptText.indexOf(missionA) !== -1,
     'loop: the prompt the execution provider actually received carries Mission A\'s persisted result reference');

  // ---- dependency-unavailable injection: executor goes away ---------------
  phase1.executorDown = new Promise(function (resolve) {
    var open = phase1.servers.length;
    phase1.servers.forEach(function (s) { s.close(function () { if (--open === 0) resolve(); }); });
  });
  return phase1.executorDown;
}).then(function () {
  return req(phase1.console.port, '/api/missions/start', 'POST',
    { instruction: 'This must fail loudly — the executor is down', provider: 'claude-code' }, phase1.cookie);
}).then(function (r) {
  ok(r.status >= 500, 'failure injection: an unavailable executor is an explicit upstream error (' + r.status + '), never a silent mission loss');
  ok(!!(r.json && (r.json.error || r.json.detail)), 'failure injection: the error names itself machine-readably');
  phase1.console.server.close();
}).then(function () {
  console.log('\nMOS E2E lifecycle: ' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) failures.forEach(function (f) { console.log('  - ' + f); });
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(failed ? 1 : 0);
}).catch(function (err) {
  console.error('E2E SUITE ERROR: ' + (err && err.stack || err));
  try { fs.rmSync(FIXTURES, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  process.exit(1);
});
