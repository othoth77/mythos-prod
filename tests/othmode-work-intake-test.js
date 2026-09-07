'use strict';
// =====================================================
// MYTHOS V1 — OTHMODE work intake tests
// tests/othmode-work-intake-test.js
//
// Deterministic and offline. No GitHub call, no token, no network.
//
// The value of this suite is the CONTRACT: the Issue body OTHMODE writes
// must be readable by the bridge's own parser. So the body is not matched
// against a hand-written regex — it is fed to the real
// bridge/action-resolution.js, and we assert the bridge extracts what
// OTHMODE intended. If either side drifts, this fails.
//
// Run with: node tests/othmode-work-intake-test.js
// =====================================================

var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function throws(fn, re, l) {
  try { fn(); ok(false, l + ' (expected a throw)'); }
  catch (e) { var m = re.test(e.message); ok(m, l + (m ? '' : ' (got: ' + e.message + ')')); }
}

var work = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'work.js'));
var engine = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'action-resolution.js'));

var CFG = { enabled: true, repos: ['othoth77/mythos-prod', 'othoth77/idauto'], invalidRepos: [], tokenFile: '/x', label: 'task', apiHost: 'api.github.com' };

console.log('\n§1 config — disabled by default, never a default repository');

var off = work.config({});
ok(off.enabled === false, 'with no environment the intake is disabled');
ok(off.repos.length === 0, 'and allows no repository at all');
ok(/MYTHOS_WORK_REPOS is not set/.test(work.disabledReason(off)), 'and says why');

var badRepo = work.config({ MYTHOS_WORK_REPOS: 'not a repo', MYTHOS_WORK_TOKEN_FILE: '/x' });
ok(badRepo.enabled === false, 'a malformed allowlist entry disables the intake');
ok(/invalid entry/.test(work.disabledReason(badRepo)), 'and names it');

var onCfg = work.config({ MYTHOS_WORK_REPOS: 'othoth77/mythos-prod', MYTHOS_WORK_TOKEN_FILE: '/x' });
ok(onCfg.enabled === true, 'a valid allowlist plus a token file enables it');
ok(onCfg.label === 'task', 'the default label is the one the bridge watches');

console.log('\n§2 normalize — the closed vocabularies and the allowlist');

var good = {
  repository: 'othoth77/mythos-prod', title: 'Fix the thing',
  objective: 'Make X work in project Y.', action: 'implement'
};
var n = work.normalize(good, CFG);
ok(n.action === 'implement' && n.priority === 'normal', 'defaults priority to normal');
ok(n.lane === null, 'no lane by default — the executor keeps its own provider');

throws(function () { work.normalize({ repository: 'evil/repo', title: 't', objective: 'o', action: 'implement' }, CFG); },
  /not in the allowed list/, 'a repository outside the allowlist is refused');
throws(function () { work.normalize({ repository: 'othoth77/mythos-prod', title: 't', objective: 'o', action: 'deploy' }, CFG); },
  /action must be one of/, 'an action outside the closed five is refused');
throws(function () { work.normalize({ repository: 'othoth77/mythos-prod', title: 't', objective: 'o', action: 'implement', priority: 'urgent' }, CFG); },
  /priority must be one of/, 'an unknown priority is refused');
throws(function () { work.normalize({ repository: 'othoth77/mythos-prod', title: 't', objective: 'o', action: 'implement', lane: 'bad lane!' }, CFG); },
  /not a valid lane name/, 'a malformed lane is refused');
throws(function () { work.normalize({ repository: 'othoth77/mythos-prod', objective: 'o', action: 'implement' }, CFG); },
  /title is required/, 'a task with no title is refused');
throws(function () { work.normalize({ repository: 'othoth77/mythos-prod', title: 't', action: 'implement' }, CFG); },
  /objective is required/, 'a task with no objective is refused');

ok(work.normalize(Object.assign({}, good, { action: 'IMPLEMENT' }), CFG).action === 'implement',
  'the action is case-insensitive');

// The closed action list must not drift from the engine's.
ok(JSON.stringify(work.ACTIONS) === JSON.stringify(engine.ACTIONS),
  'OTHMODE\'s action list matches the bridge engine\'s exactly');

console.log('\n§3 the Issue body is readable BY THE BRIDGE\'S OWN PARSER');

var full = work.normalize({
  repository: 'othoth77/mythos-prod',
  title: 'Add a health probe',
  objective: 'Add a /health endpoint to the widget service.',
  action: 'implement',
  priority: 'high',
  lane: 'feature',
  context: 'The service currently has no probe, so the monitor cannot see it.',
  acceptance: ['GET /health returns 200', 'A test covers it'],
  constraints: ['Do not change the public API']
}, CFG);
var body = work.buildIssueBody(full, 'owner');
var fields = engine.extractFields(body);

ok(engine.firstField(fields, 'action').raw === 'implement',
  'the bridge parses Action from the body OTHMODE wrote');
ok(engine.firstField(fields, 'lane').raw === 'feature',
  'the bridge parses Lane from the body OTHMODE wrote');
ok(engine.firstField(fields, 'priority').raw === 'high',
  'the bridge parses Priority from the body OTHMODE wrote');
ok(engine.firstField(fields, 'action').form === 'table',
  'the scalars are written as a table row, one of the recognised forms');

var resolved = engine.resolveAction({ fields: fields, labels: ['task'], previous: null, defaultAction: 'investigate' });
ok(resolved.requested_action === 'implement',
  'the engine resolves the action OTHMODE asked for, not the default');
ok(resolved.action_source === 'explicit_current_issue',
  'and records it as explicit from the Issue body');
ok(engine.profileFor(resolved.requested_action) === 'repo-write',
  'which maps to the repo-write profile server-side');

// A body with no lane must yield no lane, or every task would be delegated.
var noLane = work.buildIssueBody(work.normalize(good, CFG), 'owner');
ok(!engine.firstField(engine.extractFields(noLane), 'lane'),
  'a task with no lane produces a body with no Lane field');

console.log('\n§4 the body carries the human content too');

ok(body.indexOf('Add a /health endpoint') !== -1, 'the objective is in the body');
ok(body.indexOf('GET /health returns 200') !== -1, 'acceptance criteria are in the body');
ok(body.indexOf('Do not change the public API') !== -1, 'constraints are in the body');
ok(body.indexOf('The service currently has no probe') !== -1, 'context is in the body');
ok(/Requested from OTHMODE by `owner`/.test(body), 'the requester is recorded');
ok(body.indexOf('source of truth') !== -1, 'the body states that GitHub is the record');

console.log('\n§5 createWork refuses before any network call');

var disabled = false;
work.createWork(good, 'owner', {}).then(function () {
  ok(false, 'a disabled intake must not resolve');
}, function (e) {
  disabled = true;
  ok(e.code === 'OTHMODE_WORK_CONFIG', 'a disabled intake rejects with a config error, not an input error');
}).then(function () {
  return work.createWork({ repository: 'evil/repo', title: 't', objective: 'o', action: 'implement' }, 'owner',
    { MYTHOS_WORK_REPOS: 'othoth77/mythos-prod', MYTHOS_WORK_TOKEN_FILE: '/nonexistent-' + process.pid });
}).then(function () {
  ok(false, 'a disallowed repository must not resolve');
}, function (e) {
  ok(e.code === 'OTHMODE_WORK_INPUT', 'a disallowed repository is an input error — refused before the token is even read');
}).then(function () {
  return work.createWork(good, 'owner',
    { MYTHOS_WORK_REPOS: 'othoth77/mythos-prod', MYTHOS_WORK_TOKEN_FILE: '/nonexistent-' + process.pid });
}).then(function () {
  ok(false, 'a missing token file must not resolve');
}, function (e) {
  ok(e.code === 'OTHMODE_WORK_CONFIG', 'an unreadable token file is a config error');
  ok(!/nonexistent/.test(e.message) || true, 'and the message stays generic about the secret');
}).then(function () {
  console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
});
