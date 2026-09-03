'use strict';
// =====================================================
// MYTHOS — Action Resolution Engine tests
// tests/bridge-action-resolution-test.js
//
// Pure, offline, sub-second. Pins the ONE parser + decision layer that the
// Issues adapter, the bridge and the executor all use for requested_action,
// execution_profile and model. The regression cases are the literal bodies
// of gh-issue-111 / 114 / 117 / 118 (tests/fixtures/github-issues), which
// the previous parser turned into requested_action=investigate → repo-read.
//
// Run with: node tests/bridge-action-resolution-test.js
// =====================================================
var fs = require('fs');
var path = require('path');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var engine = require(path.join(EXEC, 'bridge', 'action-resolution'));
var modelPolicy = require(path.join(EXEC, 'lib', 'model-policy'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function fixture(n) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github-issues', 'issue-' + n + '.json'), 'utf8')); }
function act(body, extra) { return engine.resolveAction(Object.assign({ body: body }, extra || {})); }

// --- A–I: every accepted way of writing Action -------------------------------------------
var FORMS = {
  'A  Action: implement': 'Action: implement',
  'B  - Action: implement': '- Action: implement',
  'B2 1. Action: implement': '1. Action: implement',
  'B3 * Action: implement': '* Action: implement',
  'C  ## Action: implement': '## Action: implement',
  'C2 ### Action: implement': '### Action: implement',
  'D  ## Action\\n\\nimplement': '## Action\n\nimplement',
  'D2 ## Action\\n\\n\\n**implement**\\n\\n## Objective': '## Action\n\n\n**implement**\n\n## Objective\nx',
  'D3 ## Action\\n- implement': '## Action\n- implement',
  'E  | Action | implement |': '| Field | Value |\n|---|---|\n| Action | implement |',
  'E2 table without header': '| Action | implement |\n| Priority | high |',
  'F  ACTION: IMPLEMENT': 'ACTION: IMPLEMENT',
  'F2 action: implement': 'action: implement',
  'G  **Action:** implement': '**Action:** implement',
  'G2 **Action**: implement': '**Action**: implement',
  'G3 - **Action:** implement': '- **Action:** implement',
  'H  whitespace': '   Action   :    implement   ',
  'I  Action: `implement`': 'Action: `implement`',
  'I2 Action: **implement**': 'Action: **implement**',
  'J  Action:\\nimplement': 'Action:\nimplement',
  'K  Arabic key': 'الإجراء: تنفيذ',
  'L  full-width colon': 'Action： implement',
  'M  Requested action: implement': 'Requested action: implement',
  'N  synonym fix': 'Action: fix',
  'O  synonym build': 'Action: build',
  'P  after prose': '## Objective\nDo the thing.\n\nSome prose about the plan.\n\nAction: implement\n\n## Scope\n- a'
};
Object.keys(FORMS).forEach(function (name) {
  var r = act(FORMS[name]);
  ok(r.requested_action === 'implement' && r.action_source === 'explicit_current_issue' && !r.error,
    'form ' + name + ' → implement/explicit_current_issue (got ' + r.requested_action + '/' + r.action_source + ')');
});
ok(act('Action: implement').action_raw === 'implement' && act('ACTION: IMPLEMENT').action_raw === 'IMPLEMENT' && act('Action: `Implement`').action_raw === 'Implement',
  'action_raw keeps what was literally written (case and all); requested_action is the normalised value');
ok(act('## Action\n\nimplement').candidates[0].form === 'heading_block' && act('## Action: implement').candidates[0].form === 'heading_inline' && act('| Action | implement |').candidates[0].form === 'table',
  'the form that matched is recorded on the candidate');

// Other actions and the closed set.
['investigate', 'review', 'test', 'document', 'implement'].forEach(function (a) {
  ok(act('Action: ' + a).requested_action === a && engine.profileFor(a) === engine.PROFILE_BY_ACTION[a], 'closed set: ' + a + ' → ' + engine.PROFILE_BY_ACTION[a]);
});
var bad = act('Action: deploy');
ok(bad.requested_action === null && /not one of/.test(bad.error) && bad.action_raw === 'deploy' && bad.action_source === 'explicit_current_issue',
  'an unknown Action is an error naming the closed set, with the raw value kept — never a silent default');

// Things that must NOT be read as an Action.
ok(act('## Objective\nThe action plan is to implement X.\n').action_source === 'default', 'prose containing the word action is not a field');
ok(act('```\nAction: implement\n```\n').action_source === 'default', 'a fenced code block is not a field');
ok(act('## Action\n\n## Model\nOpus').action_source === 'default', 'an empty `## Action` heading followed by another heading states nothing');
ok(act('Action items: implement the widget').action_source === 'default', '"Action items:" is not the Action field');
ok(act('Action: implement\nAction: review').requested_action === 'implement' && act('Action: implement\nAction: review').conflict === null,
  'the first explicit statement wins; a second explicit one is not a conflict of sources');

// --- Precedence: explicit current > label > inherited > default -----------------------------------
var prev = { task_id: 'gh-issue-1', requested_action: 'implement' };
ok(act('## Objective\nx', { previous: prev }).action_source === 'inherited_previous_attempt' && act('## Objective\nx', { previous: prev }).requested_action === 'implement',
  'rerun without Action inherits the previous attempt (H)');
ok(act('Action: review', { previous: prev }).requested_action === 'review' && act('Action: review', { previous: prev }).action_source === 'explicit_current_issue',
  'explicit current Action beats the inherited one (I / G)');
ok(act('Action: review', { previous: prev }).conflict === 'inherited_previous_attempt=implement', 'the ignored inherited candidate is recorded as a conflict, not lost');
ok(act('## Objective\nx', { labels: [{ name: 'action:document' }], previous: prev }).action_source === 'action_label' && act('## Objective\nx', { labels: [{ name: 'action:document' }], previous: prev }).requested_action === 'document',
  'a label beats inheritance');
ok(act('Action: review', { labels: [{ name: 'action:implement' }] }).requested_action === 'review' && act('Action: review', { labels: [{ name: 'action:implement' }] }).action_source === 'explicit_current_issue',
  'the explicit body Action beats a label');
ok(act('## Objective\nx').action_source === 'default' && act('## Objective\nx').requested_action === 'investigate' && act('## Objective\nx', { defaultAction: 'review' }).requested_action === 'review',
  'first attempt with nothing stated → configured default');
ok(act('## Objective\nx', { previous: { task_id: 'p', requested_action: 'deploy' } }).action_source === 'default', 'an invalid previous action is never inherited');
var cands = act('Action: review', { labels: ['action:implement'], previous: prev }).candidates;
ok(cands.map(function (c) { return c.source; }).join('>') === 'explicit_current_issue>action_label>inherited_previous_attempt>default', 'candidates are listed in precedence order');

// --- The real bodies that failed live -------------------------------------------------------------
[111, 114, 117, 118].forEach(function (n) {
  var i = fixture(n);
  var r = engine.resolveAction({ body: i.body, labels: i.labels });
  ok(r.requested_action === 'implement' && r.action_source === 'explicit_current_issue' && engine.profileFor(r.requested_action) === 'repo-write',
    'regression #' + n + ': Action resolves to implement → repo-write (got ' + r.requested_action + '/' + r.action_source + ')');
});
[117, 118].forEach(function (n) {
  var i = fixture(n);
  var m = engine.resolveModel({ body: i.body, labels: i.labels, policy: modelPolicy });
  ok(m.model_key === 'fable-5.1' && m.model_raw === 'Fable 5.1' && m.model_source === 'explicit_current_issue' && m.model_id === 'claude-fable-5-1' && !m.error,
    'regression #' + n + ': "## Model: Fable 5.1" resolves to fable-5.1 explicitly (got ' + m.model_key + '/' + m.model_source + ')');
});
ok(engine.resolveModel({ body: fixture(111).body, policy: modelPolicy }).model_source === 'none', 'regression #111: no Model named → none (executor scores)');

// --- Model resolution ------------------------------------------------------------------------------
var entry = modelPolicy.DEFAULT_LOADED.policy.catalog['fable-5.1'];
var savedEnabled = entry.enabled;
entry.enabled = false;
var mu = engine.resolveModel({ body: 'Model: Fable 5.1', policy: modelPolicy });
entry.enabled = savedEnabled;
ok(mu.model_key === 'fable-5.1' && mu.available === false && !mu.error && /not available/.test(mu.reason) && /never substituted/.test(mu.reason) && mu.available_models.indexOf('Fable 5.1') === -1,
  'a known-but-disabled model keeps the explicit choice (key + raw + source), available:false, no substitution');
var mt = engine.resolveModel({ body: 'Model: gpt-4o', policy: modelPolicy });
ok(mt.error && /unknown model/.test(mt.error) && mt.model_key === null, 'an unknown model name is an error with the accepted list');
ok(engine.resolveModel({ body: '## Model\n\nOpus', policy: modelPolicy }).model_key === 'opus' && engine.resolveModel({ body: '| Model | Sonnet 5 |', policy: modelPolicy }).model_key === 'sonnet',
  'Model accepts the same forms as Action (heading block, table)');
ok(engine.resolveModel({ body: 'x', labels: ['model:haiku'], policy: modelPolicy }).model_source === 'model_label', 'model:<x> label is a source');
ok(engine.resolveModel({ body: 'x', previous: { task_id: 'p', model: 'opus' }, policy: modelPolicy }).model_source === 'inherited_previous_attempt', 'a rerun naming no model inherits the previous one');
ok(engine.resolveModel({ body: 'Model: Haiku', previous: { task_id: 'p', model: 'opus' }, policy: modelPolicy }).model_key === 'haiku', 'an explicit current Model beats the inherited one');

// --- Action → profile invariant --------------------------------------------------------------------
ok(engine.checkActionProfile('implement', 'repo-write').ok && engine.checkActionProfile('document', 'repo-write').ok && engine.checkActionProfile('investigate', 'repo-read').ok &&
   engine.checkActionProfile('review', 'repo-read').ok && engine.checkActionProfile('test', 'repo-test').ok, 'invariant: the closed map holds (J)');
var mm = engine.checkActionProfile('implement', 'repo-read');
ok(!mm.ok && mm.code === 'ACTION_PROFILE_MISMATCH' && mm.expected_profile === 'repo-write' && mm.actual_profile === 'repo-read' && /before any provider/.test(mm.reason),
  'invariant: implement + repo-read → ACTION_PROFILE_MISMATCH with expected/actual (K)');
ok(!engine.checkActionProfile('investigate', 'repo-write').ok, 'invariant: investigate + repo-write is a mismatch too (no privilege escalation by profile)');
ok(!engine.checkActionProfile('deploy', 'deploy').ok && engine.checkActionProfile('deploy', 'deploy').expected_profile === null, 'invariant: an unknown action has no profile');
var threw = null;
try { engine.assertActionProfile('implement', 'repo-read', { task_id: 'gh-issue-118', attempt_id: 'gh-issue-118#1' }); } catch (e) { threw = e; }
ok(threw && threw.code === 'ACTION_PROFILE_MISMATCH' && /gh-issue-118#1/.test(threw.message) && threw.details.expected_profile === 'repo-write', 'assertActionProfile throws a coded error carrying task_id/attempt_id');

// --- Attempt snapshot ------------------------------------------------------------------------------
var snapIn = { task_id: 't', attempt_id: 't#1', requested_action: 'implement', execution_profile: 'repo-write', model: 'fable-5.1', objective: 'o', scope: ['a'], constraints: [], validation_requirements: ['v'] };
var snap = engine.attemptSnapshot(snapIn);
ok(/^[0-9a-f]{64}$/.test(snap) && engine.attemptSnapshot(JSON.parse(JSON.stringify(snapIn))) === snap, 'snapshot is a stable sha256 of the immutable decision fields');
ok(engine.checkSnapshot(snapIn, snap).ok, 'an unchanged attempt verifies');
ok(!engine.checkSnapshot(Object.assign({}, snapIn, { execution_profile: 'repo-read' }), snap).ok && engine.checkSnapshot(Object.assign({}, snapIn, { execution_profile: 'repo-read' }), snap).code === 'ATTEMPT_SNAPSHOT_MUTATED',
  'a changed profile is ATTEMPT_SNAPSHOT_MUTATED');
ok(!engine.checkSnapshot(Object.assign({}, snapIn, { model: 'haiku' }), snap).ok && !engine.checkSnapshot(Object.assign({}, snapIn, { requested_action: 'investigate' }), snap).ok, 'a changed model or action is a mutation');
ok(engine.checkSnapshot(Object.assign({}, snapIn, { unrelated: 'x' }), snap).ok, 'fields outside the immutable set do not count');

// --- Retry classification -------------------------------------------------------------------------
['ACTION_PROFILE_MISMATCH', 'MODEL_UNAVAILABLE', 'PERMISSION_DENIED', 'GOVERNANCE_DENIED', 'HUMAN_APPROVAL', 'ATTEMPT_SNAPSHOT_MUTATED', 'STALE_WORKER'].forEach(function (c) {
  ok(engine.isRetryable(c) === false && engine.blocker(c, {}).retryable === false, 'never retried automatically: ' + c);
});
ok(engine.isRetryable('PROVIDER_FAILED') === true && engine.isRetryable(null) === true, 'other outcomes stay on the executor\'s own retry policy');
var b = engine.blocker('MODEL_UNAVAILABLE', { requested_model: 'Fable 5.1', available_models: ['Opus 5'], actual_model: null, reason: 'r' });
ok(b.code === 'MODEL_UNAVAILABLE' && b.requested_model === 'Fable 5.1' && b.actual_model === null && b.available_models[0] === 'Opus 5' && /^\d{4}-/.test(b.at), 'blocker records carry the decision fields');

// --- Idempotency key --------------------------------------------------------------------------------
ok(engine.idempotencyKey(['r', 1, 'c']) === engine.idempotencyKey(['r', 1, 'c']) && engine.idempotencyKey(['r', 1, 'c']) !== engine.idempotencyKey(['r', 2, 'c']), 'idempotency key is deterministic per (repo, issue, attempt, content)');

console.log('action-resolution tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.error(failures.join('\n')); process.exit(1); }
