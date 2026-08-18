'use strict';
// =====================================================
// Mythos MVP — unattended autonomous policy suite
// tests/mythos-unattended-policy-test.js
//
// The owner requirement is unattended overnight operation. The danger in
// satisfying it is obvious: the cheapest way to stop asking is to stop
// gating. So the central assertion here is NOT "the loop keeps going" — it
// is "the loop keeps going AND every automatic answer was a refusal".
//
// A test that only checked the campaign reached READY would pass just as
// happily against an implementation that auto-APPROVED everything. Every
// continuation assertion below is therefore paired with an assertion about
// what was recorded.
//
// Offline: no provider, no network, isolated runtime root.
// =====================================================

process.env.MYTHOS_CORE_ENABLED = 'true';

var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}

var RUNTIME = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-unattended-'));
process.env.MYTHOS_EXECUTOR_HOME = RUNTIME;

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var unattended = require(path.join(EXEC, 'core', 'unattended'));
var campaign = require(path.join(EXEC, 'core', 'campaign'));
var roadmap = require(path.join(EXEC, 'core', 'roadmap'));
var store = require(path.join(EXEC, 'core', 'store'));

// ---------------------------------------------------------------- 1. table
console.log('\n1. Deterministic decision table');

var CASES = [
  ['GOVERNANCE VIOLATION in the real diff: core/tool-registry.js', 'GOVERNANCE', 'DENY', true],
  ['destructive operation: DROP TABLE requested', 'DESTRUCTIVE', 'DENY', true],
  ['approval required for budget increase', 'POLICY', 'DENY', true],
  ['repair budget exhausted after 2 cycles: tests fail', 'REPAIR_EXHAUSTED', 'REJECT_MISSION', true],
  ['conceptual only — needs a human design decision', 'AMBIGUOUS', 'SKIP', true],
  ['some reason nobody anticipated', 'UNCLASSIFIED', 'DENY', false]
];
CASES.forEach(function (c) {
  var d = unattended.classify(c[0]);
  ok(d.kind === c[1] && d.action === c[2], 'classify → ' + c[1] + '/' + c[2]);
  ok(d.terminal_for_capability === c[3],
    c[1] + ' terminal_for_capability = ' + c[3]);
});

// The invariant. If this ever fails the module has stopped being a policy
// and become a bypass.
ok(unattended.DECISIONS.every(function (d) {
  return ['DENY', 'REJECT_MISSION', 'SKIP'].indexOf(d.action) !== -1;
}), 'EVERY table entry is refusal-shaped — no entry can grant');
ok(!unattended.grantsAnything(unattended.classify('anything at all')),
  'grantsAnything() is false for an arbitrary reason');
ok(unattended.classify('governance violation').action === 'DENY' &&
   unattended.classify('GOVERNANCE VIOLATION').action === 'DENY',
  'governance match is case-insensitive');

// Precedence: a governance breach that also mentions repair must not be
// downgraded to the repair branch.
ok(unattended.classify('repair budget exhausted; GOVERNANCE VIOLATION in diff').kind === 'GOVERNANCE',
  'governance outranks repair-exhausted in the same message');

// Quota is a wait, never a denial.
ok(unattended.NEVER_DENIED.indexOf('WAITING_FOR_QUOTA') !== -1,
  'WAITING_FOR_QUOTA is explicitly excluded from denial');

// Off by default — unattended mode is never implicit.
delete process.env.MYTHOS_UNATTENDED;
ok(unattended.enabled() === false, 'unattended mode is OFF unless explicitly enabled');
process.env.MYTHOS_UNATTENDED = 'yes';
ok(unattended.enabled() === false, 'only the exact string "true" enables it');

// ------------------------------------------------------- 2. campaign wiring
console.log('\n2. Park behaviour, attended vs unattended');

function makeRepo(name) {
  var dir = path.join(RUNTIME, name);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md'),
    '# Vision\n\n### A. Alpha — PLANNED\nFirst capability.\n\n' +
    '### B. Beta — PLANNED\nSecond capability.\n');
  fs.mkdirSync(path.join(dir, 'projects', 'mythos-ai-executor', 'config'), { recursive: true });
  cp.execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init',
    { cwd: dir });
  return dir;
}

function newCampaign(repo, label) {
  return campaign.createCampaign({
    objective: 'unattended policy probe ' + label,
    project: 'mythos', repo_path: repo, requested_by: 'test'
  });
}

var repo = makeRepo('repo');

// --- attended mode keeps the human gate ---
delete process.env.MYTHOS_UNATTENDED;
var att = newCampaign(repo, 'attended');
campaign.parkForApproval(att.campaign_id, {
  mission_id: 'm-att', capability_key: 'A', objective: 'x',
  reason: 'GOVERNANCE VIOLATION in the real diff: core/campaign.js',
  action_class: 'GOVERNANCE'
});
var attAfter = campaign.loadCampaign(att.campaign_id);
ok(attAfter.state === 'WAITING_FOR_APPROVAL', 'attended: campaign waits for the owner');
ok((attAfter.approval_required || []).length === 1, 'attended: approval stays outstanding');
ok((attAfter.approval_decisions || []).length === 0, 'attended: nothing decided automatically');

// --- unattended mode denies and continues ---
process.env.MYTHOS_UNATTENDED = 'true';
var un = newCampaign(repo, 'unattended');
var parked = campaign.parkForApproval(un.campaign_id, {
  mission_id: 'm-un', capability_key: 'A', objective: 'x',
  reason: 'GOVERNANCE VIOLATION in the real diff: core/campaign.js',
  action_class: 'GOVERNANCE'
});
var unAfter = campaign.loadCampaign(un.campaign_id);
ok(parked.auto_denied === true, 'unattended: park reports auto_denied');
ok(parked.policy_kind === 'GOVERNANCE', 'unattended: classified as GOVERNANCE');
ok(unAfter.state === 'READY', 'unattended: campaign continues (READY), never WAITING_FOR_APPROVAL');
ok((unAfter.approval_required || []).length === 0, 'unattended: nothing left outstanding');

var dec = (unAfter.approval_decisions || [])[0];
ok(!!dec, 'unattended: a decision record exists');
ok(dec && dec.granted === false, 'unattended: the decision is a DENIAL');
ok(dec && dec.automatic === true, 'unattended: the denial is marked automatic');
ok(dec && /unattended-policy/.test(dec.decided_by),
  'unattended: decider is the policy, never a person');
ok(dec && dec.policy_kind === 'GOVERNANCE', 'unattended: policy kind recorded');

// The audit trail must survive as a real decided approval entity, not just a
// line in the campaign file.
var approval = store.load('approval', parked.id);
ok(approval && approval.status === 'DENIED', 'unattended: policyEngine approval decided DENY');

// Never grants, under any reason, ever.
var grantedAny = false;
['GOVERNANCE VIOLATION x', 'approval required', 'destructive rm -rf',
 'repair budget exhausted after 3 cycles', 'ambiguous objective', 'mystery'
].forEach(function (r, i) {
  var c2 = newCampaign(repo, 'grant-probe-' + i);
  var p2 = campaign.parkForApproval(c2.campaign_id, {
    mission_id: 'm' + i, capability_key: 'B', objective: 'x', reason: r
  });
  if (p2.auto_denied !== true) grantedAny = true;
  var a2 = store.load('approval', p2.id);
  if (!a2 || a2.status !== 'DENIED') grantedAny = true;
});
ok(!grantedAny, 'unattended: NO reason produces a grant — every probe denied');

// ------------------------------------------------------------- 3. roadmap
console.log('\n3. Roadmap records AUTO_DENIED distinctly');

roadmap.recordProgress(repo, 'A', 'AUTO_DENIED', { reason: 'probe' });
var cands = roadmap.candidates(repo);
var a = cands.filter(function (c) { return c.key === 'A'; })[0];
ok(a && a.effective_status === 'AUTO_DENIED', 'AUTO_DENIED is a recordable status');
ok(a && a.selectable === false, 'AUTO_DENIED capability is not selectable');
ok(a && a.blocked_reasons.join(' ').indexOf('unattended policy') !== -1,
  'the reason names the policy, not the owner');

roadmap.recordProgress(repo, 'B', 'OWNER_DENIED', { reason: 'owner said no' });
var b = roadmap.candidates(repo).filter(function (c) { return c.key === 'B'; })[0];
ok(b && b.effective_status === 'OWNER_DENIED', 'OWNER_DENIED still distinct from AUTO_DENIED');
ok(b && b.blocked_reasons.join(' ').indexOf('owner denied') !== -1,
  'an owner denial is never relabelled as a machine denial');

var threw = false;
try { roadmap.recordProgress(repo, 'A', 'MADE_UP', {}); } catch (e) { threw = true; }
ok(threw, 'an unknown status is still rejected');

// ------------------------------------------------- 4. integration boundary
console.log('\n4. Integration with the delivery governance boundary');

// This layer must NOT reimplement delivery enforcement. That lives in the
// other implementation (governance-verify.js, root-installed). Assert we did
// not grow a second one — a duplicate cage is worse than none, because two
// disagreeing lists mean nobody knows which is authoritative.
var svcDir = path.join(EXEC, 'service');
var svcFiles = fs.existsSync(svcDir) ? fs.readdirSync(svcDir) : [];
ok(svcFiles.indexOf('mythos-git-push-verify.sh') === -1,
  'no duplicate verifier script in service/');
ok(svcFiles.indexOf('protected-paths.txt') === -1,
  'no duplicate protected-paths list in service/');
ok(svcFiles.indexOf('governance-verify.js') !== -1,
  'the single governance verifier is the one that already exists');

// The unattended layer decides campaign flow; it must never claim delivery
// authority or reference the signing key.
var policySrc = fs.readFileSync(path.join(EXEC, 'core', 'unattended.js'), 'utf8');
ok(policySrc.indexOf('governance.key') === -1 && policySrc.indexOf('push') === -1,
  'the policy layer never touches delivery or the signing key');

// ------------------------------------------------ 5. continuation semantics
console.log('\n5. Continuation semantics');

var runner = require(path.join(EXEC, 'core', 'campaign-runner'));

// Quota must never be converted into a denial: it is a resumable wait.
ok(campaign.FAILURE_BEHAVIOUR.QUOTA === 'WAITING_FOR_QUOTA',
  'QUOTA remains a resumable wait, not a denial');
ok(unattended.classify('quota exhausted').kind !== 'GOVERNANCE',
  'a quota message is not misread as a governance breach');

// Provider fallback must stay same-authority — unattended operation must
// never widen what a provider may do.
var routerSrc = fs.readFileSync(path.join(EXEC, 'core', 'provider-router.js'), 'utf8');
ok(/same-authority|executionAuthority/.test(routerSrc),
  'provider fallback is authority-constrained in the router');

// Repair stays bounded and is a repair, not an escalation.
ok(campaign.FAILURE_BEHAVIOUR.CODE === 'repair' &&
   campaign.FAILURE_BEHAVIOUR.TEST === 'repair' &&
   campaign.FAILURE_BEHAVIOUR.REVIEW === 'repair',
  'code/test/review failures repair rather than stopping');

// The runner must expose no path that grants an approval automatically.
var runnerSrc = fs.readFileSync(path.join(EXEC, 'core', 'campaign-runner'
  ) + '.js', 'utf8');
ok(runnerSrc.indexOf('approval_granted: true') === -1,
  'the runner never manufactures approval_granted:true');
ok(runnerSrc.indexOf('decideApproval') === -1,
  'the runner never decides an approval itself');

// IDLE: no safe work must not be reported as COMPLETED under unattended mode.
ok(/idle_no_safe_work/.test(runnerSrc),
  'no-safe-work idles and re-evaluates instead of completing');
ok(/UNATTENDED_BLOCKED_STREAK_LIMIT/.test(runnerSrc),
  'blocked-class failures are absorbed but bounded');
ok(/consecutive_blocked = 0/.test(runnerSrc),
  'an accepted mission clears the blocked streak');

// Caged files must never be written by unattended operation. The policy can
// only ever DENY a governance change, so assert the classification directly
// for every caged path the cage knows about.
var selfImprove = require(path.join(EXEC, 'core', 'self-improve'));
var cagedAllDenied = selfImprove.SELF_PROTECTED_PATHS.every(function (pth) {
  var d = unattended.classify('GOVERNANCE VIOLATION in the real diff: ' + pth);
  return d.action === 'DENY' && d.terminal_for_capability === true;
});
ok(cagedAllDenied, 'every caged path classifies as a terminal DENY (' +
  selfImprove.SELF_PROTECTED_PATHS.length + ' paths)');

// ------------------------------------------------------------------ summary
console.log('\n' + passed + ' passed, ' + failed + ' failed');
try { fs.rmSync(RUNTIME, { recursive: true, force: true }); } catch (e) {}
process.exit(failed === 0 ? 0 : 1);
