'use strict';
// =====================================================
// OTHMODE-3 — Task Reports test suite
// tests/othmode-3-tasks-test.js
//
// Covers the operational contract: per-command activation (spec cases),
// the persistent Task Report writer/read model over the OTHMODE store
// (fail-closed, append-only, terminal statuses, section persistence,
// evolution reference only when applicable), the unified Command History
// fourth source, route-level auth flags and the secret gate, the CLI task
// path (including the import path for reports prepared off-host), the
// export snapshot, and the static UI/i18n/no-exec guarantees.
//
// Run: node tests/othmode-3-tasks-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var passed = 0;
var failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('  [FAIL] ' + label); }
}
function section(title) { console.log('§ ' + title); }
function tmpRoot(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'othmode3-' + name + '-')); }

var REPO = path.resolve(__dirname, '..');
process.env.OTHMODE_REPO_ROOT = REPO;
var CC = path.join(REPO, 'projects', 'command-center');

// ---------------------------------------------------------------------------
section('activation — the permanent per-command rule (contract cases 1-7)');
var activation = require('../projects/command-center/reference/othmode/activation.js');
ok(activation.isActivated('othmode analyse this project') === true, '1. othmode → OTHMODE');
ok(activation.isActivated('OTHMODE search for the best existing solution') === true, '2. OTHMODE → OTHMODE');
ok(activation.isActivated('OthMode deploy this project') === true, '3. OthMode → OTHMODE');
ok(activation.isActivated('analyse this project') === false, '4. normal command → normal Claude');
ok(activation.isActivated('myothmode test') === false, '5. myothmode → normal');
ok(activation.isActivated('othmodel test') === false, '6. othmodel → normal');
ok(activation.isActivated('othmode-test run') === false, '7. othmode-test → normal');

// ---------------------------------------------------------------------------
section('tasks — fail-closed without a provisioned store');
{
  process.env.OTHMODE_STORE_ROOT = path.join(os.tmpdir(), 'othmode3-absent-' + process.pid);
  var tasksAbsent = require('../projects/command-center/reference/othmode/tasks.js');
  var threw = false;
  try { tasksAbsent.createTask({ command: 'othmode x' }, 'suite'); } catch (e) { threw = e.code === 'OTHMODE_STORE_ABSENT'; }
  ok(threw, 'create without a store throws OTHMODE_STORE_ABSENT (no silent loss, no invented store)');
  var listed = tasksAbsent.listTasks();
  ok(listed.provisioned === false && listed.tasks.length === 0, 'list without a store reports unprovisioned');
}

var STORE_ROOT = tmpRoot('store');
process.env.OTHMODE_STORE_ROOT = STORE_ROOT;
var tasks = require('../projects/command-center/reference/othmode/tasks.js');
var store = require('../projects/command-center/reference/othmode/store.js');

// ---------------------------------------------------------------------------
section('tasks — creation, id format, RUNNING, normal-Claude refusal');
var t1 = tasks.createTask({ command: 'othmode first real operation', project: 'command-center' }, 'claude');
ok(/^OTH-\d{4}-00001$/.test(t1.id), '8. OTHMODE activation creates a task (' + t1.id + ')');
ok(t1.status === 'RUNNING' && t1.phase === 'RUNNING', '10. RUNNING is recorded at activation');
ok(t1.activation === 'othmode' && t1.terminal === false, 'task carries its activation and is not terminal');
{
  var refused = false;
  try { tasks.createTask({ command: 'analyse this project' }, 'claude'); }
  catch (e) { refused = e.code === 'OTHMODE_TASK_INPUT'; }
  ok(refused, '9. normal Claude command creates NO task — refused by the writer itself');
  refused = false;
  try { tasks.createTask({ command: 'myothmode test' }, 'claude'); }
  catch (e) { refused = e.code === 'OTHMODE_TASK_INPUT'; }
  ok(refused, 'compound keyword (myothmode) refused too');
}

// ---------------------------------------------------------------------------
section('tasks — lifecycle updates, sections persisted, terminal statuses');
tasks.updateTask(t1.id, { phase: 'PREFLIGHT', sections: {
  preflight: { status: 'BLOCKED', environment: 'claude-code-remote', blockers: ['network egress policy denies mythosprod.xyz'] }
} }, 'claude');
tasks.updateTask(t1.id, { sections: {
  status_center: { reference: 'UNREACHABLE', reason: 'CONNECT 403 policy denial for status.mythosprod.xyz:443' },
  search_first: { status: 'NOT_STARTED', sources_searched: [], decision: null }
} }, 'claude');
var t1done = tasks.updateTask(t1.id, { status: 'BLOCKED', sections: {
  changes: { files_changed: [] },
  git: { branch: 'claude/first-othmode-operation-u8vzq0', commit: 'NONE' },
  validation: { result: 'NOT_RUN' },
  deployment: { result: 'NONE' },
  outcome: { final_result: 'BLOCKED before execution', next_action: 'restore network access and retry' }
} }, 'claude');
ok(t1done.status === 'BLOCKED' && t1done.terminal === true, '13. BLOCKED is recorded');
ok(t1done.finished_at && t1done.duration_ms !== null && t1done.duration_ms >= 0, 'terminal update stamps finished_at and duration');
ok(t1done.sections.preflight.blockers[0].indexOf('network') !== -1, '16. preflight blocker persisted');
ok(t1done.sections.status_center.reference === 'UNREACHABLE', '17. Status Center UNREACHABLE persisted honestly');
ok(t1done.sections.search_first.status === 'NOT_STARTED', '18. Search First information persisted');
ok(Array.isArray(t1done.sections.changes.files_changed), '19. files changed persisted');
ok(t1done.sections.git.branch.indexOf('claude/') === 0, '20. Git information persisted');
ok(t1done.sections.validation.result === 'NOT_RUN', '21. validation persisted');
ok(t1done.sections.deployment.result === 'NONE', '22. deployment persisted');
ok(t1done.sections.outcome.next_action.indexOf('retry') !== -1, '23. next action persisted');
ok(t1done.evolution_ref === null, '24a. no Evolution reference unless applicable');
{
  var threw2 = false;
  try { tasks.updateTask(t1.id, { phase: 'EXECUTION' }, 'claude'); }
  catch (e) { threw2 = e.code === 'OTHMODE_TASK_INPUT'; }
  ok(threw2, 'terminal task refuses further updates — corrections are a new task');
}

// The other terminal statuses, each on its own task (11,12,14,15).
['COMPLETED', 'FAILED', 'CANCELLED', 'REJECTED'].forEach(function (status) {
  var t = tasks.createTask({ command: 'othmode lifecycle ' + status.toLowerCase() }, 'suite');
  var done = tasks.updateTask(t.id, { status: status }, 'suite');
  ok(done.status === status && done.terminal === true, status + ' is recorded as terminal');
});

// Evolution reference only when the operation qualifies (24b).
{
  var tEvo = tasks.createTask({ command: 'othmode evolution-qualifying op' }, 'suite');
  var doneEvo = tasks.updateTask(tEvo.id, { status: 'COMPLETED', sections: { evolution: { event_id: 'event-abc123', result: 'APPLIED' } } }, 'suite');
  ok(doneEvo.evolution_ref === 'event-abc123', '24b. Evolution reference persisted when applicable');
}

// One-shot recording (the import path): a task that never reached
// execution still gets a full persistent record with honest timestamps.
{
  var imported = tasks.createTask({
    command: 'othmode first real othmode operation (recorded off-host)',
    status: 'BLOCKED',
    started_at: '2026-08-26T08:03:00Z',
    finished_at: '2026-08-26T08:10:00Z',
    sections: { status_center: { reference: 'UNREACHABLE' }, outcome: { final_result: 'BLOCKED', next_action: 'restore network access and retry' } }
  }, 'operator:deploy (import)');
  ok(imported.status === 'BLOCKED' && imported.duration_ms === 7 * 60 * 1000, 'one-shot terminal record keeps its real timing');
  var badTs = false;
  try { tasks.createTask({ command: 'othmode x', finished_at: '2026-01-01T00:00:00Z' }, 'suite'); }
  catch (e) { badTs = e.code === 'OTHMODE_TASK_INPUT'; }
  ok(badTs, 'finished_at without a terminal status refused');
}

// Closed section list — free-form keys never enter the record.
{
  var badSection = false;
  try { tasks.createTask({ command: 'othmode y', sections: { password_dump: {} } }, 'suite'); }
  catch (e) { badSection = e.code === 'OTHMODE_TASK_INPUT'; }
  ok(badSection, 'unknown report section refused (closed vocabulary)');
}

// ---------------------------------------------------------------------------
section('history — OTHMODE tasks are the fourth source of the ONE timeline');
var history = require('../projects/command-center/reference/othmode/history.js');
var stubDb = { query: function () { return Promise.reject(new Error('no db')); } };

// ---------------------------------------------------------------------------
section('routes — auth flags, secret gate, task endpoints');
var routesMod = require('../projects/command-center/reference/othmode/routes.js');
var stubAuth = { identityFromRequest: function (req) { return req && req.identity ? req.identity : null; } };
var routes = routesMod.buildRoutes(stubDb, stubAuth);
function findRoute(method, pathStr) {
  return routes.filter(function (r) { return r.method === method && r.pattern.test(pathStr); })[0];
}
function fakeRes() {
  return {
    statusCode: null, body: null,
    writeHead: function (s) { this.statusCode = s; },
    end: function (b) { this.body = b ? JSON.parse(b) : null; }
  };
}

['GET /api/othmode/tasks', 'GET /api/othmode/tasks/OTH-2026-00001',
 'POST /api/othmode/tasks', 'POST /api/othmode/tasks/OTH-2026-00001/update'].forEach(function (spec) {
  var parts = spec.split(' ');
  var route = findRoute(parts[0], parts[1]);
  ok(!!route && route.auth === true, '26. ' + spec + ' exists and requires authentication');
});

{
  var resSecret = fakeRes();
  findRoute('POST', '/api/othmode/tasks').handler({ identity: 'editor-x' }, resSecret, null, {}, {
    command: 'othmode leak test',
    sections: { execution: { note: 'aws key AKIAIOSFODNN7EXAMPLE and -----BEGIN RSA PRIVATE KEY-----' } }
  });
  ok(resSecret.statusCode === 422, '25. credential-shaped section refused by the secret gate (' + resSecret.statusCode + ')');

  var resCreate = fakeRes();
  findRoute('POST', '/api/othmode/tasks').handler({ identity: 'editor-x' }, resCreate, null, {}, {
    command: 'othmode via-route operation'
  });
  ok(resCreate.statusCode === 201 && /^OTH-\d{4}-\d{5}$/.test(resCreate.body.task.id), 'clean task accepted through the route');

  var routeTaskId = resCreate.body.task.id;
  var resUpd = fakeRes();
  findRoute('POST', '/api/othmode/tasks/x/update').handler({ identity: 'editor-x' }, resUpd, ['/x', routeTaskId], {}, {
    status: 'COMPLETED', sections: { outcome: { final_result: 'done', next_action: 'none' } }
  });
  ok(resUpd.statusCode === 201 && resUpd.body.task.status === 'COMPLETED', '11. COMPLETED recorded through the route');

  var resNormal = fakeRes();
  findRoute('POST', '/api/othmode/tasks').handler({ identity: 'editor-x' }, resNormal, null, {}, { command: 'plain command' });
  ok(resNormal.statusCode === 400, 'normal Claude command via route → 400, never a record');

  var res404 = fakeRes();
  findRoute('GET', '/api/othmode/tasks/OTH-1999-99999').handler({ identity: 'editor-x' }, res404, ['/x', 'OTH-1999-99999'], {}, {});
  ok(res404.statusCode === 404, 'unknown task id → 404');
}

// unified history — run async then continue.
history.unified(stubDb, {}).then(function (h) {
  ok(h.sources.othmode === 'loaded', 'history reports the othmode source as loaded');
  var othRows = h.rows.filter(function (r) { return r.source === 'othmode'; });
  ok(othRows.length >= 6, '29. OTHMODE tasks appear in Command History (' + othRows.length + ' rows)');
  var blocked = othRows.filter(function (r) { return r.command_ref === t1.id; })[0];
  ok(!!blocked && blocked.status === 'BLOCKED', 'the BLOCKED first-operation task row is present with its status');
  ok(blocked && blocked.next_action === 'restore network access and retry', 'history row surfaces the next action');
  return history.unified(stubDb, { source: 'othmode', status: 'BLOCKED' });
}).then(function (h2) {
  ok(h2.rows.length >= 1 && h2.rows.every(function (r) { return r.source === 'othmode' && r.status === 'BLOCKED'; }),
    'history filters by source=othmode and status');
  runCliTests();
}).catch(function (e) {
  ok(false, 'history section crashed: ' + e.message);
  runCliTests();
});

// ---------------------------------------------------------------------------
function runCliTests() {
  section('cli — task path, import path, signal regression, export');
  var CLI = path.join(CC, 'cli', 'othmode-cli.js');
  var env = Object.assign({}, process.env, { OTHMODE_STORE_ROOT: STORE_ROOT });
  function cli(cliArgs) {
    return cp.execFileSync(process.execPath, [CLI].concat(cliArgs), { env: env, encoding: 'utf8' });
  }

  var created = JSON.parse(cli(['task', 'create', JSON.stringify({ command: 'othmode cli-created op' })]));
  ok(/^OTH-\d{4}-\d{5}$/.test(created.id) && created.status === 'RUNNING', 'cli task create works');
  var updated = JSON.parse(cli(['task', 'update', created.id, JSON.stringify({ status: 'CANCELLED' })]));
  ok(updated.status === 'CANCELLED', '14. CANCELLED recorded via cli');
  var shown = JSON.parse(cli(['task', 'show', created.id]));
  ok(shown.id === created.id && shown.terminal === true, 'cli task show returns the folded report');
  var listedCli = JSON.parse(cli(['tasks']));
  ok(listedCli.provisioned === true && listedCli.total >= 8, 'cli tasks lists the store');

  // Import path: a report prepared in an environment that cannot reach
  // OTHMODE (e.g. Claude Code with a blocked network) is recorded here.
  var importFile = path.join(tmpRoot('import'), 'pending-task.json');
  fs.writeFileSync(importFile, JSON.stringify({
    id: 'OTH-9999-99999', // must be ignored — ids are store-assigned
    command: 'othmode imported blocked operation',
    status: 'BLOCKED',
    started_at: '2026-08-26T08:03:00Z',
    finished_at: '2026-08-26T08:10:00Z',
    sections: { status_center: { reference: 'UNREACHABLE' }, outcome: { final_result: 'BLOCKED', next_action: 'retry on host' } }
  }));
  var importedCli = JSON.parse(cli(['task', 'import', importFile]));
  ok(importedCli.status === 'BLOCKED' && importedCli.id !== 'OTH-9999-99999', 'cli task import records with a store-assigned id');
  ok(/\(import\)$/.test(importedCli.actor), 'imported record marks its actor as an import');

  // Regression: the `signal` command used to be a dead branch (duplicated
  // condition with an empty first block) and silently did nothing.
  var sig = JSON.parse(cli(['signal', 'manual', 'cli signal path restored', 'othmode3:cli-signal']));
  ok(sig && sig.id && sig.type === 'signal', 'cli signal records again (dead-branch bug fixed)');

  var exported = JSON.parse(cli(['export', path.join(os.tmpdir(), 'othmode3-export-' + process.pid)]));
  ok(exported.files.indexOf('tasks/records.jsonl') !== -1, 'task stream included in store export/backup');

  runStaticTests();
}

// ---------------------------------------------------------------------------
function runStaticTests() {
  section('ui + i18n + no-exec — static guarantees');
  var webDir = path.join(CC, 'reference', 'web');
  var othmodeJs = fs.readFileSync(path.join(webDir, 'othmode.js'), 'utf8');
  ok(othmodeJs.indexOf("#/history/task/") !== -1, '30. Command History opens a task detail view');
  ok(othmodeJs.indexOf("['othmode', 'othmode']") !== -1, 'history filter offers the othmode source');
  ok(othmodeJs.indexOf('oth.task.sections') !== -1, '31. detail view renders the full report progressively');

  var i18nSrc = fs.readFileSync(path.join(webDir, 'othmode-i18n.js'), 'utf8');
  var titleCount = i18nSrc.split("'oth.task.title'").length - 1;
  ok(titleCount === 3, '32/33. task strings present in EN, FR and AR (' + titleCount + ' locales)');
  ok(i18nSrc.indexOf('مهمّة OTHMODE') !== -1, 'Arabic task title present');

  ['othmode.js', 'othmode-i18n.js'].forEach(function (f) {
    var src = fs.readFileSync(path.join(webDir, f), 'utf8');
    ok(!/child_process|\beval\s*\(|new\s+Function/.test(src), f + ' contains no exec/eval');
    ok(!/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write/.test(src), f + ' never assigns markup from strings');
  });
  var tasksSrc = fs.readFileSync(path.join(CC, 'reference', 'othmode', 'tasks.js'), 'utf8');
  ok(!/child_process|\beval\s*\(|new\s+Function|https?:\/\//.test(tasksSrc), '27. tasks.js has no exec/eval/network');

  // Terminal-status vocabulary is exactly the contract's.
  var tasksMod = require('../projects/command-center/reference/othmode/tasks.js');
  ok(tasksMod.STATUSES.join(',') === 'RUNNING,COMPLETED,FAILED,BLOCKED,CANCELLED,REJECTED', 'status vocabulary matches the contract');
  ok(tasksMod.PHASES.join(',') === 'RUNNING,PREFLIGHT,SEARCH,PLAN,EXECUTION,VALIDATION,DEPLOYMENT,VERIFICATION,COMPLETED', 'lifecycle matches the contract (no workflow engine)');

  finishSuite();
}

function finishSuite() {
  console.log('');
  console.log('OTHMODE-3 tasks suite: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}
