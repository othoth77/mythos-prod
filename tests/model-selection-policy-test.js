'use strict';
// =====================================================
// MYTHOS — Claude model selection policy tests (Issue #100)
// tests/model-selection-policy-test.js
//
// Offline and deterministic: no provider is launched, no quota is spent.
// The Claude CLI is never invoked — the assertions are about the argv the
// provider WOULD build (providers/claude-code.js buildArgs is pure) and
// about what executor.createTask persists.
//
// The five rules under test:
//   1. an explicitly named model runs, and is never substituted;
//   2. an absent model is CHOSEN (haiku/sonnet/opus), never inherited from
//      the CLI's own default;
//   3. fable is unreachable by any automatic path;
//   4. an unknown or unavailable model is refused with the accepted list;
//   5. the choice is recorded and explainable, and survives a restart
//      (the persisted task record replays to the same --model).
//
// Run with: node tests/model-selection-policy-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIX = path.join(os.homedir(), 'mythos-model-policy-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_ISSUES_REPO = 'fixture-org/fixture-repo';

var mp = require(path.join(EXEC, 'lib', 'model-policy'));
var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var claudeProvider = require(path.join(EXEC, 'providers', 'claude-code'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var issues = require(path.join(EXEC, 'bridge', 'github-issues'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function throws(fn, re, name) {
  try { fn(); ok(false, name + ' (did not throw)'); }
  catch (e) { ok(re.test(e.message), name + ' (threw: ' + e.message.slice(0, 100) + ')'); }
}
function isFable(model) { return /fable/i.test(String(model || '')); }

// --- 1. The catalog itself ---------------------------------------------------

var POLICY = mp.DEFAULT_LOADED.policy;
ok(mp.DEFAULT_LOADED.source === 'config', 'config: config/model-policy.json loads (source=' + mp.DEFAULT_LOADED.source + ' ' + (mp.DEFAULT_LOADED.reason || '') + ')');
ok(Object.keys(POLICY.catalog).every(function (k) { return mp.MODEL_RE.test(POLICY.catalog[k].model); }),
  'catalog: every model id is a bare token (no spaces, no leading "-") — nothing can smuggle a second CLI flag');
ok(Object.keys(POLICY.catalog).every(function (k) { return !isFable(POLICY.catalog[k].model) || POLICY.catalog[k].auto_selectable === false; }),
  'catalog: every fable entry is auto_selectable:false');
ok(['fast', 'balanced', 'deep'].every(function (t) { return POLICY.catalog[POLICY.auto.tiers[t]].auto_selectable === true; }),
  'catalog: all three auto tiers name auto_selectable models');

// --- 2. Explicit selection: the five cases from Issue #100 -------------------

var EXPLICIT = [
  ['Sonnet', 'claude-sonnet-5'],
  ['Opus', 'claude-opus-5'],
  ['Haiku', 'claude-haiku-4-5'],
  ['Fable 5', 'claude-fable-5']
];
EXPLICIT.forEach(function (pair) {
  var r = mp.selectModel({ requested: pair[0] });
  ok(r.ok && r.model === pair[1] && r.mode === 'explicit',
    'explicit: "' + pair[0] + '" → ' + pair[1] + ' (got ' + (r.ok ? r.model : r.error) + ')');
});
// The fifth case. Fable 5.1 is a known request the installed CLI cannot
// serve: it is REFUSED by name rather than silently downgraded to Fable 5.
var f51 = mp.selectModel({ requested: 'Fable 5.1' });
ok(!f51.ok && /Fable 5\.1/.test(f51.error) && /not available/.test(f51.error),
  'explicit: "Fable 5.1" is refused by name, never substituted (' + (f51.ok ? f51.model : f51.error.slice(0, 60)) + ')');

// An explicit request beats every automatic signal, in both directions.
var forcedHaiku = mp.selectModel({
  requested: 'haiku', task_category: 'implement', execution_profile: 'repo-write',
  priority: 'high', instruction: 'security architecture migration refactor '.repeat(80)
});
ok(forcedHaiku.ok && forcedHaiku.model === 'claude-haiku-4-5' && forcedHaiku.mode === 'explicit',
  'explicit: a named haiku survives a task that would otherwise score opus');
var forcedOpus = mp.selectModel({ requested: 'opus', task_category: 'investigate', execution_profile: 'repo-read', instruction: 'fix a typo' });
ok(forcedOpus.ok && forcedOpus.model === 'claude-opus-5', 'explicit: a named opus survives a trivial task');

// Spelling variants a human actually writes.
[['opus', 'claude-opus-5'], ['OPUS', 'claude-opus-5'], ['Opus 5', 'claude-opus-5'],
 ['claude-opus-5', 'claude-opus-5'], ['`Sonnet`', 'claude-sonnet-5'], ['Model: sonnet', 'claude-sonnet-5'],
 ['  HAIKU  ', 'claude-haiku-4-5'], ['fable', 'claude-fable-5'], ['Fable_5', 'claude-fable-5'],
 ['claude sonnet 5', 'claude-sonnet-5']].forEach(function (pair) {
  var r = mp.selectModel({ requested: pair[0] });
  ok(r.ok && r.model === pair[1], 'explicit: variant "' + pair[0] + '" → ' + pair[1] + ' (got ' + (r.ok ? r.model : r.error.slice(0, 50)) + ')');
});

// Unknown values are refused with the accepted list, never guessed at.
['gpt-4o', 'sonet', 'claude-opus-9', 'opus; rm -rf /', '--dangerously-skip-permissions'].forEach(function (bad) {
  var r = mp.selectModel({ requested: bad });
  ok(!r.ok, 'explicit: "' + bad.slice(0, 30) + '" is refused');
});
ok(/accepted values/.test(mp.selectModel({ requested: 'gpt-4o' }).error), 'explicit: the refusal names the accepted values');
// An empty `Model:` line states nothing, so it means "choose for me" — not
// "refuse". It must still never fall through to the CLI's own default.
var blank = mp.selectModel({ requested: '   ', task_category: 'investigate', execution_profile: 'repo-read', instruction: 'look around' });
ok(blank.ok && blank.mode === 'auto' && !isFable(blank.model), 'explicit: a blank Model value means automatic selection (' + blank.model + ')');

// --- 3. Automatic selection --------------------------------------------------

var trivial = mp.selectModel({ task_category: 'investigate', execution_profile: 'repo-read', instruction: 'Report the HEAD commit of the repository.' });
ok(trivial.model === 'claude-haiku-4-5' && trivial.mode === 'auto', 'auto: a short read-only investigation → haiku (got ' + trivial.model + ')');

var ordinary = mp.selectModel({ task_category: 'implement', execution_profile: 'repo-write', instruction: 'Add a status row to the dashboard table and a test for it.' });
ok(ordinary.model === 'claude-sonnet-5', 'auto: an ordinary implement task → sonnet (got ' + ordinary.model + ')');

var hard = mp.selectModel({
  task_category: 'implement', execution_profile: 'repo-write', priority: 'high',
  instruction: 'Redesign the authentication protocol and migrate the schema. '.repeat(120),
  constraints: ['a', 'b', 'c', 'd', 'e', 'f'], required_tests: ['t1', 't2', 't3']
});
ok(hard.model === 'claude-opus-5', 'auto: a long, high-priority architectural task → opus (got ' + hard.model + ' score=' + hard.score + ')');

var testing = mp.selectModel({ task_category: 'test', execution_profile: 'repo-test', instruction: 'Run the status center suite and report failures.' });
ok(testing.model === 'claude-sonnet-5', 'auto: a test task → sonnet (got ' + testing.model + ')');

// The rule the Issue is really about: NO combination of signals reaches fable.
var never = true, cases = 0;
['investigate', 'review', 'test', 'document', 'implement', null].forEach(function (cat) {
  ['repo-read', 'repo-test', 'repo-write', 'autonomous', 'deploy', null].forEach(function (prof) {
    ['low', 'normal', 'high'].forEach(function (pri) {
      ['', 'fable', 'use fable 5.1 please', 'x'.repeat(20000), 'typo fix', 'security architecture'].forEach(function (text) {
        var r = mp.selectModel({ task_category: cat, execution_profile: prof, priority: pri, instruction: text });
        cases++;
        if (!r.ok || isFable(r.model) || r.mode !== 'auto') never = false;
      });
    });
  });
});
ok(never, 'auto: fable is unreachable across all ' + cases + ' signal combinations — including an instruction that begs for it');

// Determinism and explainability.
var a = mp.selectModel({ task_category: 'implement', execution_profile: 'repo-write', instruction: 'refactor the store' });
var b = mp.selectModel({ task_category: 'implement', execution_profile: 'repo-write', instruction: 'refactor the store' });
ok(a.model === b.model && a.reason === b.reason && a.score === b.score, 'auto: identical input → identical decision');
ok(/^auto:/.test(a.reason) && /score=/.test(a.reason) && a.signals.length > 0 &&
   a.signals.every(function (s) { return typeof s.signal === 'string' && typeof s.score === 'number'; }),
  'auto: the reason states the tier, the score and every contributing signal');
ok(a.reason.length <= 300, 'auto: the reason fits the task schema (<=300 chars)');

// --- 4. Config robustness (fail safe, never dark) ----------------------------

var badPath = path.join(FIX, 'broken-policy.json');
fs.writeFileSync(badPath, '{ not json');
var brokenLoad = mp.loadPolicy(badPath);
ok(brokenLoad.source === 'built_in' && /config_unreadable/.test(brokenLoad.reason), 'config: unreadable file falls back to the built-in policy, not to "no policy"');
var fallbackChoice = mp.selectModel({ task_category: 'implement', execution_profile: 'repo-write' }, brokenLoad.policy);
ok(fallbackChoice.ok && !isFable(fallbackChoice.model), 'config: the built-in fallback still selects a non-fable model (' + fallbackChoice.model + ')');

function invalid(mutate, label) {
  var raw = JSON.parse(fs.readFileSync(mp.DEFAULT_POLICY_PATH, 'utf8'));
  mutate(raw);
  var res = mp.validatePolicyObject(raw);
  ok(!res.valid, 'config: rejects ' + label + (res.valid ? '' : ' (' + res.reason.slice(0, 70) + ')'));
}
invalid(function (r) { r.catalog.sonnet.model = 'claude sonnet 5'; }, 'a model id containing a space');
invalid(function (r) { r.catalog.sonnet.model = '--dangerously-skip-permissions'; }, 'a model id that looks like a CLI flag');
invalid(function (r) { r.auto.tiers.deep = 'fable-5'; }, 'an auto tier pointing at a non-auto_selectable model');
invalid(function (r) { r.auto.tiers.balanced = 'nope'; }, 'an auto tier pointing at an unknown key');
invalid(function (r) { r.catalog.opus.aliases.push('sonnet'); }, 'an alias claimed by two models');
invalid(function (r) { r.auto.thresholds.deep_min_score = -5; }, 'thresholds that overlap');
invalid(function (r) { delete r.catalog; }, 'a missing catalog');

// --- 5. executor.createTask --------------------------------------------------

function mk(over) {
  return executor.createTask(Object.assign({
    project: 'executor-selftest', stage: 'model-policy-test', provider: 'claude-code',
    instruction: 'Inspect the repository and report what you find.',
    execution_profile: 'repo-read', task_category: 'investigate'
  }, over || {}));
}

var autoTask = mk({});
ok(autoTask.model === 'claude-haiku-4-5' && autoTask.model_selection_mode === 'auto',
  'createTask: no model named → one is chosen (' + autoTask.model + '/' + autoTask.model_selection_mode + ')');
ok(!isFable(autoTask.model), 'createTask: an absent model never yields fable');
ok(typeof autoTask.model_selection_reason === 'string' && autoTask.model_selection_reason.length > 0,
  'createTask: the reason is persisted on the task record');
var evts = (state.readText(autoTask.task_id, 'events.log') || '').trim().split('\n')
  .filter(Boolean).map(function (l) { return JSON.parse(l); });
var sel = evts.filter(function (e) { return e.event === 'model_selected'; });
ok(sel.length === 1 && sel[0].model === autoTask.model && sel[0].mode === 'auto' && Array.isArray(sel[0].signals),
  'createTask: one model_selected event records the model, the mode and every signal');
ok(JSON.stringify(sel[0]).indexOf('claude-fable') === -1, 'createTask: the audit event of an auto choice never names fable');

var explicitTask = mk({ model: 'Opus' });
ok(explicitTask.model === 'claude-opus-5' && explicitTask.model_selection_mode === 'explicit',
  'createTask: "Opus" is honoured (' + explicitTask.model + ')');
var fableTask = mk({ model: 'Fable 5' });
ok(fableTask.model === 'claude-fable-5' && fableTask.model_selection_mode === 'explicit',
  'createTask: fable runs when — and only when — the task asks for it by name');
throws(function () { mk({ model: 'Fable 5.1' }); }, /MODEL_NOT_ALLOWED/, 'createTask: an unavailable model is refused, not substituted');
throws(function () { mk({ model: 'gpt-4o' }); }, /MODEL_NOT_ALLOWED/, 'createTask: an unknown model is refused');
throws(function () { mk({ model: 'sonnet', fallback_model: 'gpt-4o' }); }, /FALLBACK_MODEL_NOT_ALLOWED/, 'createTask: the fallback model passes the same allow-list');
var withFallback = mk({ model: 'sonnet', fallback_model: 'Haiku' });
ok(withFallback.fallback_model === 'claude-haiku-4-5', 'createTask: an accepted fallback is canonicalised');

// Advisory providers keep their OWN model namespace — a Claude id would be
// meaningless to them, so the policy must not touch those tasks.
var advisory = executor.createTask({
  project: 'executor-selftest', stage: 'model-policy-test', provider: 'openai-compat',
  instruction: 'Advise on the plan.', model: 'gpt-4o-mini'
});
ok(advisory.model === 'gpt-4o-mini' && advisory.model_selection_mode === null,
  'createTask: a non-Claude provider keeps its own model untouched (' + advisory.model + ')');

// --- 6. The argv that actually runs -----------------------------------------

var args = claudeProvider.buildArgs(autoTask, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'start');
ok(args.indexOf('--model') !== -1 && args[args.indexOf('--model') + 1] === autoTask.model,
  'buildArgs: --model carries the task\'s resolved model');
var legacy = { execution_profile: 'repo-write', task_category: 'implement', instruction: 'do the thing', model: null };
var legacyArgs = claudeProvider.buildArgs(legacy, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'start');
var legacyModel = legacyArgs[legacyArgs.indexOf('--model') + 1];
ok(legacyArgs.indexOf('--model') !== -1 && !isFable(legacyModel),
  'buildArgs: a record with no model still gets an explicit --model, never the CLI default (' + legacyModel + ')');

// Restart / recovery: the decision lives in the persisted record, so a resume
// after a crash or a reboot replays the SAME model — never a fresh roll.
var persisted = state.readJSON(explicitTask.task_id, 'task.json');
ok(persisted.model === 'claude-opus-5' && persisted.model_selection_mode === 'explicit',
  'restart: the model survives in the task store');
var resumeArgs = claudeProvider.buildArgs(persisted, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'resume');
ok(resumeArgs[resumeArgs.indexOf('--model') + 1] === 'claude-opus-5' && resumeArgs.indexOf('--resume') !== -1,
  'restart: a resumed run uses the same model as the first run');

// --- 7. Bridge: control task → executor -------------------------------------

var bcfg = bridge.config();
function ctask(over) {
  return Object.assign({
    protocol: 'mythos-control/1', task_id: 'gh-model-0001', project: 'executor-selftest',
    objective: 'Do a small, well-defined thing in the repository.',
    scope: [], constraints: [], priority: 'normal', requested_action: 'implement',
    validation_requirements: [], status: 'PENDING',
    created_at: '2026-09-02T18:00:00.000Z', created_by: 'test'
  }, over || {});
}
ok(bridge.validateTask(bcfg, ctask({}), 'gh-model-0001.json').length === 0, 'bridge: a task with no model is valid');
ok(bridge.validateTask(bcfg, ctask({ model: 'opus' }), 'gh-model-0001.json').length === 0, 'bridge: a task naming opus is valid');
var badModelErrors = bridge.validateTask(bcfg, ctask({ model: 'gpt-4o' }), 'gh-model-0001.json');
ok(badModelErrors.some(function (e) { return /^model: /.test(e); }), 'bridge: an unknown model is a validation error the creator can read');
ok(bridge.validateTask(bcfg, ctask({ model: 'Fable 5.1' }), 'gh-model-0001.json').some(function (e) { return /not available/.test(e); }),
  'bridge: an unavailable model is refused at the bridge, before any execution');
ok(bridge.taskFingerprint(ctask({ model: 'opus' })) !== bridge.taskFingerprint(ctask({})),
  'bridge: changing the model changes the task fingerprint (drift is visible)');

// The instruction the bridge builds must not itself score the task: its own
// boilerplate words are excluded from the signal terms by construction, and
// this pins that — otherwise every GitHub task would drift up a tier.
var instruction = bridge.buildInstruction(bcfg, ctask({}), {
  execution_profile: 'repo-write', worktree: '/home/deploy/wt/gh-model-0001',
  branch: 'mythos/gh/gh-model-0001', base_commit: 'abc123abc123', othmode_task_id: 'OTH-2026-00001'
});
var boiler = mp.scoreTask({ instruction: instruction });
ok(boiler.complexity_hits.length === 0 && boiler.simplicity_hits.length === 0,
  'bridge: the instruction boilerplate contributes no complexity/simplicity signal (hits: ' +
  boiler.complexity_hits.concat(boiler.simplicity_hits).join(',') + ')');
var bridgeAuto = mp.selectModel({
  instruction: instruction, task_category: 'implement', execution_profile: 'repo-write', priority: 'normal'
});
ok(bridgeAuto.model === 'claude-sonnet-5',
  'bridge: a plain implement task from GitHub lands on sonnet (got ' + bridgeAuto.model + ' — ' + bridgeAuto.reason + ')');

// --- 8. Issue intake ---------------------------------------------------------

var icfg = issues.config();
function issue(body, labels) {
  return {
    number: 4242, title: 'TASK: model selection', body: body, html_url: 'https://example.test/4242',
    user: { login: 'othoth77' }, labels: (labels || ['task']).map(function (n) { return { name: n }; })
  };
}
var OBJ = '## Objective\nMake one small change and report it.\n\nAction: implement\n';
var iNone = issues.issueToTask(icfg, issue(OBJ), 1);
ok(iNone.task && iNone.task.model === undefined, 'intake: no Model line → no model field (the executor chooses)');
var iOpus = issues.issueToTask(icfg, issue(OBJ + '\nModel: Opus\n'), 1);
ok(iOpus.task && iOpus.task.model === 'opus', 'intake: "Model: Opus" → model opus (got ' + (iOpus.task ? iOpus.task.model : iOpus.errors.join(';')) + ')');
var iAr = issues.issueToTask(icfg, issue(OBJ + '\nالنموذج: Sonnet 5\n'), 1);
ok(iAr.task && iAr.task.model === 'sonnet', 'intake: Arabic "النموذج: Sonnet 5" → model sonnet');
var iLabel = issues.issueToTask(icfg, issue(OBJ, ['task', 'model:haiku']), 1);
ok(iLabel.task && iLabel.task.model === 'haiku', 'intake: label model:haiku is honoured');
var iFable = issues.issueToTask(icfg, issue(OBJ + '\nModel: Fable 5\n'), 1);
ok(iFable.task && iFable.task.model === 'fable-5', 'intake: "Model: Fable 5" is accepted (explicit request)');
var iF51 = issues.issueToTask(icfg, issue(OBJ + '\nModel: Fable 5.1\n'), 1);
ok(!iF51.task && iF51.errors.some(function (e) { return /^Model: /.test(e) && /not available/.test(e); }),
  'intake: "Model: Fable 5.1" is rejected on the Issue with the reason');
var iBad = issues.issueToTask(icfg, issue(OBJ + '\nModel: gpt-4o\n'), 1);
ok(!iBad.task && iBad.errors.some(function (e) { return /accepted values/.test(e); }),
  'intake: an unknown model is rejected with the accepted values');

// --- done --------------------------------------------------------------------

try { fs.rmSync(FIX, { recursive: true, force: true }); } catch (e) { /* fixture cleanup is best effort */ }
console.log('\nmodel selection policy: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error('failures:\n- ' + failures.join('\n- ')); process.exit(1); }
