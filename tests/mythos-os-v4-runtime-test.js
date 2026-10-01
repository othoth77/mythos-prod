'use strict';
// =====================================================
// MYTHOS OS v4 — runtime wiring: the CLI and the health report
// tests/mythos-os-v4-runtime-test.js
//
// Runs the REAL command (`projects/mythos-os-v4/bin/mythos-os`) as a child
// process with the production wiring and NO injected dependency. Only the
// host around it is a fixture: HOME is a per-run directory (so every
// default path — key files, stores, the Claude working directory — is
// isolated), `claude` and `systemctl` on PATH are executable stand-ins, and
// the local runtime URL points at a loopback server.
//
//   C  configuration: the shipped policy and registry load; a broken policy
//      stops the command instead of running on defaults
//   H  health: one check per layer; WARN where a tier is not configured on
//      the host, FAIL where a critical path is broken, and the exit code
//      follows; a tampered ledger and a stalled goal are reported
//   E  end to end through the CLI: goal submit → run → COMPLETED, trace,
//      ledger verify, ask, jev route, watchdog, escalation
//   L  live probes (`health --live`) call the engines and the answer route
//      and report who actually served
//
// Offline (loopback only) and deterministic.
// Run with: node tests/mythos-os-v4-runtime-test.js
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var path = require('path');

var h = require('./support/mythos-os-v4-harness');
var dirs = h.setup('runtime');
var t = h.counter('mythos-os-v4 runtime tests');

var CLI = path.join(h.V4, 'bin', 'mythos-os');
var FABLE = 'claude-fable-5-1';
var claude = h.fakeClaude(dirs);
var qwenCtl = {};
var qwen;

// The fixture host.
var home = path.join(dirs.root, 'home');
var execHome = path.join(dirs.root, 'haddad-executor-home');
var workerEnv = path.join(dirs.root, 'worker.env');
var runtimeKey = path.join(dirs.root, 'runtime.key');
var unitState = path.join(dirs.bin, 'unit-state');
fs.mkdirSync(home, { recursive: true });
fs.mkdirSync(execHome, { recursive: true });
fs.writeFileSync(workerEnv, 'MYTHOS_EXECUTOR_HOME=' + execHome + '\n');
fs.writeFileSync(runtimeKey, 'fixture-runtime-key\n', { mode: 0o600 });
fs.writeFileSync(unitState, 'active');
fs.writeFileSync(path.join(dirs.bin, 'systemctl'), [
  '#!/usr/bin/env node',
  "var fs = require('fs'); var path = require('path');",
  "var s = fs.readFileSync(path.join(__dirname, 'unit-state'), 'utf8').trim();",
  "console.log(s); process.exit(s === 'active' ? 0 : 3);"
].join('\n') + '\n', { mode: 0o755 });

function env(extra) {
  return Object.assign({
    HOME: home,
    PATH: dirs.bin + ':' + path.dirname(process.execPath) + ':/usr/bin:/bin',
    MYTHOS_OS_HOME: dirs.osHome,
    MYTHOS_EXECUTOR_HOME: dirs.executorHome,
    MYTHOS_FREE_LLM_KEY_DIR: dirs.freeKeys,
    MYTHOS_OS_EXECUTOR_ENV_FILE: workerEnv,
    HADDAD_RUNTIME_BASE_URL: qwen.url + '/v1',
    HADDAD_RUNTIME_KEY_FILE: runtimeKey
  }, extra || {});
}

// Async on purpose: the loopback runtime lives in THIS process.
function cli(args, extraEnv) {
  return new Promise(function (resolve) {
    var child = cp.spawn(process.execPath, [CLI].concat(args), { env: env(extraEnv), stdio: ['ignore', 'pipe', 'pipe'] });
    var out = '', err = '';
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { err += d; });
    var timer = setTimeout(function () { child.kill('SIGKILL'); }, 60000);
    child.on('close', function (code) {
      clearTimeout(timer);
      var json = null;
      try { json = JSON.parse(out); } catch (e) { json = null; }
      resolve({ code: code, out: out, err: err, json: json });
    });
  });
}
function check(report, id) { return report.checks.filter(function (c) { return c.id === id; })[0] || {}; }
function section(name) { console.log('\n# ' + name); }

var d = h.directive;
var goalId;

h.startServer(h.qwenBehaviour(qwenCtl)).then(function (s) {
  qwen = s;

  section('C — configuration');
  var policy = require(path.join(h.V4, 'lib', 'policy')).load();
  var registry = require(path.join(h.V4, 'lib', 'jev')).loadRegistry();
  t.ok(policy.version === '4.0.0' && registry.version === '4.0.0', 'the shipped policy and model registry load and validate');
  var tiers = Object.keys(registry.models).map(function (n) { return registry.models[n].tier; });
  t.ok(['free', 'local', 'paid'].every(function (x) { return tiers.indexOf(x) !== -1; }), 'the shipped registry has a model in every tier: free, local, paid');
  t.ok(Object.keys(registry.models).filter(function (n) { return registry.models[n].work_provider; }).join() === 'qwen-local', 'exactly one registered model can execute repository work: Qwen through haddad-agent');
  var orchestratorRoles = require(path.join(h.BASE, 'projects', 'mythos-orchestrator', 'config', 'openai.json')).roles;
  t.ok(orchestratorRoles[policy.executive.openai_role] && orchestratorRoles[policy.watchdog.openai_review_role] && orchestratorRoles[registry.models['openai-advisor'].openai_role] && orchestratorRoles.smoke,
    'every OpenAI role v4 names exists in the orchestrator\'s config (one model list, not two)');
  var claudeCatalog = require(path.join(h.BASE, 'projects', 'mythos-ai-executor', 'config', 'model-policy.json')).catalog;
  t.ok(claudeCatalog[registry.models['claude-sonnet'].claude_policy_key].enabled === true && Object.keys(claudeCatalog).some(function (k) { return claudeCatalog[k].model === policy.executive.fable_model; }),
    'the paid Claude key and the FABLE model both resolve in the executor\'s model catalog');
  t.ok(fs.existsSync(path.join(h.BASE, policy.haddad.supervisor_config)) && fs.existsSync(path.join(h.BASE, 'scripts', 'mythos-supervise.js')) && fs.existsSync(path.join(h.BASE, 'projects', 'mythos-ai-executor', 'bin', 'mythos-ai-executor')),
    'the Haddad supervisor config, the Supervisor CLI and the executor CLI that v4 calls all exist in this repository');
  var all = [fs.readFileSync(path.join(h.V4, 'config', 'dots-policy.json'), 'utf8'), fs.readFileSync(path.join(h.V4, 'config', 'jev-models.json'), 'utf8')].join('\n');
  t.ok(require(path.join(h.BASE, 'projects', 'mythos-orchestrator', 'lib', 'redact')).findSecretKinds(all).length === 0 && !/api[_-]?key"\s*:/i.test(all), 'the committed configuration carries no credential');

  var brokenPolicy = path.join(dirs.root, 'broken-policy.json');
  var bp = h.policy(); delete bp.loop.max_cycles;
  fs.writeFileSync(brokenPolicy, JSON.stringify(bp));
  return cli(['health'], { MYTHOS_OS_POLICY: brokenPolicy });
}).then(function (r) {
  t.ok(r.code === 5 && /POLICY_INVALID: loop\.max_cycles/.test(r.err) && r.out === '', 'a broken policy stops the command (exit 5) — it never runs on defaults');
  return cli(['nonsense']);
}).then(function (r) {
  t.ok(r.code === 1 && /^usage:/.test(r.out), 'an unknown command prints usage and exits 1');

  section('H — health');
  return cli(['health', '--json']);
}).then(function (r) {
  var rep = r.json;
  t.ok(r.code === 0 && rep.result === 'PASS_WITH_WARNINGS' && rep.counts.fail === 0 && rep.live === false, 'on a host with FABLE, Qwen, a paid model and the executor: no FAIL, exit 0');
  t.ok(check(rep, 'dots_policy').status === 'PASS' && check(rep, 'dots_store').status === 'PASS' && check(rep, 'ledger_chain').status === 'PASS' && check(rep, 'dots_goals').status === 'PASS', 'DOTS: policy, store, ledger and goals pass');
  t.ok(check(rep, 'fable_executive').status === 'PASS', 'FABLE executive: PASS (CLI present)');
  t.ok(check(rep, 'openai_watchdog').status === 'WARN' && /no key file/.test(check(rep, 'openai_watchdog').detail), 'OpenAI watchdog: WARN, and the report says why (no key file on this host)');
  t.ok(check(rep, 'executive_no_spof').status === 'PASS' && /fable, direct/.test(check(rep, 'executive_no_spof').detail), 'the executive still has two paths (fable, direct)');
  t.ok(check(rep, 'free_llm_tier').status === 'WARN' && check(rep, 'qwen_tier').status === 'PASS' && check(rep, 'paid_tier').status === 'PASS', 'tiers: free WARN (no key), Qwen PASS, paid PASS');
  t.ok(check(rep, 'model_no_spof').status === 'PASS' && /qwen-local\[local\] → claude-sonnet\[paid\]/.test(check(rep, 'jev').detail), 'JEV: the answer route is Qwen → paid Claude');
  t.ok(check(rep, 'jev_work_route').status === 'PASS' && /qwen-local via haddad-agent/.test(check(rep, 'jev_work_route').detail), 'JEV: the work route is Qwen through haddad-agent');
  t.ok(check(rep, 'haddad_executor').status === 'PASS', 'Haddad executor: unit active, store and CLI present');
  t.ok(claude.calls().length === 0 && qwen.calls.every(function (c) { return c.url === '/health'; }), 'the default health run costs nothing: no model was called, only the runtime\'s /health');
  return cli(['health']);
}).then(function (r) {
  t.ok(r.code === 0 && /RESULT: PASS_WITH_WARNINGS \(\d+ pass, 2 warn, 0 fail\)/.test(r.out) && /WARN {2}openai_watchdog/.test(r.out), 'the human-readable report shows the same result');

  fs.writeFileSync(unitState, 'inactive');
  return cli(['health', '--json']);
}).then(function (r) {
  t.ok(r.code === 4 && r.json.result === 'FAIL' && check(r.json, 'haddad_executor').status === 'FAIL' && /is not active/.test(check(r.json, 'haddad_executor').detail), 'executor daemon inactive: haddad_executor FAIL and exit 4');
  fs.writeFileSync(unitState, 'active');

  qwenCtl.unhealthy = true;
  return cli(['health', '--json']);
}).then(function (r) {
  t.ok(r.code === 4 && check(r.json, 'qwen_tier').status === 'FAIL' && check(r.json, 'jev_work_route').status === 'FAIL' && check(r.json, 'model_no_spof').status === 'FAIL', 'Qwen runtime not healthy: qwen_tier, the work route and model_no_spof all FAIL');
  t.ok(check(r.json, 'jev').status === 'PASS' && /claude-sonnet\[paid\]/.test(check(r.json, 'jev').detail), 'while answers still have a (paid) route');
  delete qwenCtl.unhealthy;

  return cli(['health', '--json'], { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin:' + path.join(dirs.root, 'nowhere'), MYTHOS_CLAUDE_BIN: path.join(dirs.root, 'no-claude') });
}).then(function (r) {
  t.ok(check(r.json, 'fable_executive').status === 'FAIL' && check(r.json, 'executive_no_spof').status === 'FAIL', 'no Claude CLI: FABLE FAIL, and with OpenAI also absent the executive has one path left → executive_no_spof FAIL');

  section('E — end to end through the CLI');
  var plan = d('execute', { steps: [h.step('s1', 'answer', 'analyze', 'Explain how the cache works.')] });
  var done = d('complete', { final_answer: 'The cache keeps the most recent entries.' });
  var script = { by_model: {}, default: { result: 'paid answer' } };
  script.by_model[FABLE] = [{ result: JSON.stringify(plan) }, { result: JSON.stringify(done) }];
  claude.script(script);
  return cli(['goal', 'submit', '--title', 'Explain the cache', '--objective', 'Explain how the cache works.', '--priority', 'high', '--by', 'runtime-test']);
}).then(function (r) {
  goalId = r.json && r.json.goal_id;
  t.ok(r.code === 0 && r.json.status === 'QUEUED' && r.json.priority === 'high' && /^goal-\d{14}-[a-z0-9]{6}$/.test(goalId), 'goal submit: QUEUED with an id');
  return cli(['goal', 'run', goalId]);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.status === 'COMPLETED' && r.json.result.final_answer === 'The cache keeps the most recent entries.' && r.json.result.completed_by === 'fable', 'goal run: COMPLETED by FABLE (exit 0)');
  t.eq(r.json.history.map(function (x) { return [x.step_id, x.ok, x.model, x.tier]; }), [['s1', true, 'qwen-local', 'local']], 'the step was executed by Qwen (free tier unconfigured on this host → local)');
  var fableCalls = claude.calls().filter(function (c) { return c.model === FABLE; });
  t.ok(fableCalls.length === 2 && qwen.calls.some(function (c) { return c.url === '/v1/chat/completions' && c.auth === 'Bearer fixture-runtime-key'; }), 'FABLE was really spawned twice and Qwen really answered over HTTP with the runtime key');
  return cli(['trace', goalId]);
}).then(function (r) {
  t.eq(r.json.map(function (x) { return x.actor + ':' + x.type; }), [
    'dots:GOAL_SUBMITTED', 'dots:GOAL_STARTED', 'fable:EXECUTIVE_CALL', 'dots:DIRECTIVE_AUTHORIZED', 'haddad:STEP_STARTED', 'jev:ROUTE_DECISION',
    'gateway:ANSWER_RESULT', 'haddad:STEP_RESULT', 'fable:EXECUTIVE_CALL', 'dots:DIRECTIVE_AUTHORIZED', 'dots:GOAL_COMPLETED'
  ], 'trace: the full chain DOTS → FABLE → JEV → Haddad, actor by actor');
  return cli(['ledger', 'verify']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.ok === true && r.json.records >= 11, 'ledger verify: chain intact');
  return cli(['goal', 'run', goalId]);
}).then(function (r) {
  t.ok(r.code === 2 && /GOAL_NOT_RUNNABLE: COMPLETED/.test(r.err), 'running a completed goal again is refused (exit 2)');
  return cli(['goal', 'submit', '--title', 'x', '--objective', 'log in with password=' + 'CorrectHorseBatteryStaple9']);
}).then(function (r) {
  t.ok(r.code === 2 && /GOAL_CARRIES_SECRET/.test(r.err) && r.err.indexOf('CorrectHorse') === -1, 'a goal with a credential is refused (exit 2) and the credential is not echoed');
  return cli(['goal', 'status', 'goal-00000000000000-zzzzzz']);
}).then(function (r) {
  t.ok(r.code === 1, 'an unknown goal: exit 1');
  return cli(['ask', '--prompt', 'What is 2+2?']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.ok && r.json.model === 'qwen-local' && r.json.tier === 'local' && r.json.text === 'qwen says hello', 'ask: one answer through JEV and the gateway, served by Qwen');
  qwenCtl.status = 500;
  return cli(['ask', '--prompt', 'What is 2+2?']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.model === 'claude-sonnet' && r.json.tier === 'paid' && r.json.fallback_used === true && r.json.text === 'paid answer', 'ask with Qwen failing: the paid model answers (fallback through the real CLI wiring)');
  delete qwenCtl.status;
  // Health is persistent state, shared by every command: the two failed
  // tries above opened Qwen's circuit, and the NEXT process sees it.
  return cli(['jev', 'route', '--capability', 'repo_work', '--kind', 'work']);
}).then(function (r) {
  t.ok(r.code === 2 && r.json.reason === 'NO_ROUTE' && /^COOLDOWN_UNTIL/.test(r.json.rejected.filter(function (x) { return x.model === 'qwen-local'; })[0].reason),
    'after Qwen failed twice, a later command finds it in cooldown: no work route (health survives the process)');
  return cli(['jev', 'reset']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.models['qwen-local'].state === 'closed' && r.json.models['qwen-local'].cooldown_until === null, 'jev reset: the owner clears the cooldown after a repair');
  return cli(['jev', 'route', '--capability', 'repo_work', '--kind', 'work']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.candidates.length === 1 && r.json.candidates[0].work_provider === 'haddad-agent', 'jev route (work): Qwen via haddad-agent');
  return cli(['jev', 'route', '--capability', 'analysis', '--pool', 'hidden']);
}).then(function (r) {
  t.ok(r.code === 2 && r.json.reason === 'BAD_REQUEST', 'jev route for an unconfigured pool: refused (exit 2)');
  return cli(['jev', 'status']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.models['qwen-local'].tier === 'local' && r.json.models['free-llm-pool'].available === false && r.json.spend.calls === 1, 'jev status: health per model and the paid spend (1 call so far)');
  return cli(['watchdog', 'status']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.mode === 'fable' && r.json.leading === 'fable' && r.json.failures_in_window === 0, 'watchdog status: FABLE leading, no failures');

  // A goal that needs approval: escalation list / resolve through the CLI.
  var write = d('execute', { steps: [h.step('w1', 'work', 'implement', 'Change lib/cache.js.')] });
  var script = { by_model: {}, default: { result: 'paid answer' } };
  script.by_model[FABLE] = [{ result: JSON.stringify(write) }];
  claude.script(script);
  return cli(['goal', 'submit', '--title', 'Change the cache', '--objective', 'Change lib/cache.js to evict by age.']);
}).then(function (r) {
  return cli(['goal', 'run-next']);
}).then(function (r) {
  t.ok(r.code === 3 && r.json.status === 'ESCALATED' && r.json.steps_executed === 0, 'a goal whose plan needs to write: ESCALATED, nothing executed (exit 3)');
  return cli(['escalation', 'list']).then(function (e) {
    t.ok(e.json.length === 1 && e.json[0].code === 'HUMAN_APPROVAL' && e.json[0].goal_id === r.json.goal_id, 'escalation list: one OPEN escalation, HUMAN_APPROVAL');
    return cli(['escalation', 'resolve', e.json[0].escalation_id, 'cancel', '--by', 'runtime-test']);
  });
}).then(function (r) {
  t.ok(r.code === 0 && r.json.goal.status === 'CANCELLED' && r.json.escalation.status === 'RESOLVED', 'escalation resolve cancel: the goal is CANCELLED');
  return cli(['escalation', 'list']);
}).then(function (r) {
  t.ok(r.json.length === 0, 'no escalation is left open');

  section('L — live probes');
  var script = { by_model: {}, default: { result: 'pong' } };
  script.by_model[FABLE] = [{ result: '{"pong":"pong"}' }];
  claude.script(script);
  return cli(['health', '--live', '--json']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.live === true && check(r.json, 'live_fable').status === 'PASS' && /served by claude-fable-5-1/.test(check(r.json, 'live_fable').detail), 'health --live: FABLE answers the probe and the report names the model that served it');
  t.ok(check(r.json, 'live_openai').status === undefined, 'no live probe is attempted for an engine that is not available');
  t.ok(check(r.json, 'live_answer_route').status === 'PASS' && /answered by qwen-local \[local\]/.test(check(r.json, 'live_answer_route').detail), 'health --live: one real answer went through the gateway, served by Qwen');
  var script = { by_model: {}, default: { result: 'pong' } };
  script.by_model[FABLE] = [{ result: '{"pong":"pong"}', served_by: ['claude-sonnet-5'] }];
  claude.script(script);
  return cli(['health', '--live', '--json']);
}).then(function (r) {
  t.ok(r.code === 4 && check(r.json, 'live_fable').status === 'FAIL' && /IDENTITY_MISMATCH/.test(check(r.json, 'live_fable').detail), 'health --live: a probe answered by another model under FABLE\'s name is a FAIL');

  // Tampered ledger and a stalled goal, reported by health.
  var ledgerFile = path.join(dirs.osHome, 'ledger', 'decisions.jsonl');
  var good = fs.readFileSync(ledgerFile, 'utf8');
  fs.writeFileSync(ledgerFile, good.replace('"GOAL_COMPLETED"', '"GOAL_COMPLETED_EDITED"'));
  return cli(['health', '--json']).then(function (bad) {
    t.ok(bad.code === 4 && check(bad.json, 'ledger_chain').status === 'FAIL' && /hash mismatch/.test(check(bad.json, 'ledger_chain').detail), 'health: an edited ledger record is a FAIL');
    return cli(['ledger', 'verify']);
  }).then(function (v) {
    t.ok(v.code === 4 && v.json.ok === false, 'ledger verify exits 4 on a broken chain');
    fs.writeFileSync(ledgerFile, good);
  });
}).then(function () {
  var file = path.join(dirs.osHome, 'goals', goalId + '.json');
  var rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  rec.status = 'RUNNING'; rec.runner_pid = 2147483646; rec.deadline_at = new Date(Date.now() + 3600000).toISOString();
  fs.writeFileSync(file, JSON.stringify(rec));
  return cli(['health', '--json']);
}).then(function (r) {
  t.ok(check(r.json, 'dots_goals').status === 'WARN' && /1 stalled/.test(check(r.json, 'dots_goals').detail), 'health: a goal whose runner died is reported as stalled');
  return cli(['watchdog', 'tick']);
}).then(function (r) {
  t.ok(r.code === 0 && r.json.escalated_stalled_goals.length === 1 && r.json.escalated_stalled_goals[0] === goalId, 'watchdog tick: the stalled goal is escalated');
  return cli(['goal', 'status', goalId]);
}).then(function (r) {
  t.ok(r.json.status === 'ESCALATED', 'and its status says so');
  var leaked = fs.readFileSync(path.join(dirs.osHome, 'ledger', 'decisions.jsonl'), 'utf8');
  t.ok(leaked.indexOf('fixture-runtime-key') === -1, 'the runtime key never reached the ledger');
  return qwen.close();
}).then(function () { t.finish(dirs); }, t.crash(dirs));
