'use strict';
// =====================================================
// Mythos MVP — n8n bridge / campaign service suite
// tests/mythos-n8n-bridge-test.js
//
// The bridge's job is to let an automation layer drive long-running
// autonomous work WITHOUT becoming a decision-maker. So most of what is
// asserted here is what the bridge REFUSES: a second campaign, a
// continuation past an approval or a block, two advances at once, and any
// attempt to choose provider/profile/repo through the payload.
//
// Offline: mock agent runner, no provider quota, no network.
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

// Isolated runtime root so the suite never touches real campaign state.
// MYTHOS_EXECUTOR_HOME is the ONE variable store.root() reads — setting
// anything else silently writes into the live orchestration store, which is
// exactly what an early draft of this suite did.
var RUNTIME = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-bridge-'));
process.env.MYTHOS_EXECUTOR_HOME = RUNTIME;

var EXEC = path.join(__dirname, '..', 'projects', 'mythos-ai-executor');
var svc = require(path.join(EXEC, 'core', 'campaign-service'));
var campaign = require(path.join(EXEC, 'core', 'campaign'));
var store = require(path.join(EXEC, 'core', 'store'));
var selfImprove = require(path.join(EXEC, 'core', 'self-improve'));

function makeRepo(name) {
  var dir = path.join(RUNTIME, name);
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  // The parser requires exactly "### <KEY>. <Title> — <STATUS>".
  fs.writeFileSync(path.join(dir, 'docs', 'MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md'),
    '# Vision\n\n## 3. Components\n\n' +
    '### A. Adapter Improvement — PARTIAL (Phase 2)\n\nA safe capability.\n\n' +
    '### B. Second Capability — PLANNED (Phase 2)\n\nAnother safe capability.\n');
  cp.execFileSync('git', ['init', '-q'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  cp.execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  cp.execFileSync('git', ['add', '.'], { cwd: dir });
  cp.execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

console.log('MYTHOS MVP — n8n bridge suite\n');

// ===========================================================================
console.log('1. GOAL INTAKE NEVER FORKS A LIVE CAMPAIGN');
// ===========================================================================
(function () {
  var repo = makeRepo('intake-repo');
  var first = svc.submitGoal({
    objective: 'Develop the remaining Mythos capabilities safely.',
    project: 'bridge-test-a', requested_by: 'n8n'
  });
  ok(first.created === true, 'intake: the first goal creates a campaign');
  ok(/^c-/.test(first.campaign_id), 'intake: a campaign id is returned');

  var second = svc.submitGoal({
    objective: 'A completely different objective for the same project.',
    project: 'bridge-test-a', requested_by: 'n8n'
  });
  ok(second.created === false, 'intake: a second submission does NOT create a rival campaign');
  ok(second.campaign_id === first.campaign_id,
    'intake: the caller is handed the existing live campaign instead');
  ok(/never created while one is live/.test(second.reason || ''),
    'intake: the refusal explains itself');

  var other = svc.submitGoal({
    objective: 'Work on a genuinely separate project.',
    project: 'bridge-test-b', requested_by: 'n8n'
  });
  ok(other.created === true && other.campaign_id !== first.campaign_id,
    'intake: a genuinely different project still gets its own campaign');

  // A webhook cannot point Mythos at an arbitrary checkout.
  var sneaky = svc.submitGoal({
    objective: 'Try to redirect the repository through the payload.',
    project: 'bridge-test-c', repo_path: '/etc', requested_by: 'n8n'
  });
  var loaded = campaign.loadCampaign(sneaky.campaign_id);
  ok(loaded.repo_path !== '/etc',
    'intake: repo_path in the payload is IGNORED — the repository is configuration');
  ok(repo.length > 0, 'intake: fixture repo built');
})();

// ===========================================================================
console.log('\n2. CONTINUATION REFUSES DECISION STATES');
// ===========================================================================
(function () {
  var g = svc.submitGoal({ objective: 'Campaign used for state refusal checks.', project: 'bridge-states' });
  var c = campaign.loadCampaign(g.campaign_id);

  c.state = 'WAITING_FOR_APPROVAL';
  c.approval_required = [{ capability_key: 'P', reason: 'would weaken the policy engine' }];
  campaign.saveCampaign(c);
  var r1 = svc.continueCampaign(g.campaign_id, {});
  ok(r1.accepted === false && r1.code === 'NEEDS_HUMAN',
    'continue: WAITING_FOR_APPROVAL is never auto-continued');
  ok(/policy engine/.test(r1.reason), 'continue: the refusal carries the real approval reason');

  c = campaign.loadCampaign(g.campaign_id);
  c.state = 'BLOCKED';
  c.approval_required = [];
  c.blocked_missions = [{ capability_key: 'X', reason: 'infrastructure outage' }];
  campaign.saveCampaign(c);
  var r2 = svc.continueCampaign(g.campaign_id, {});
  ok(r2.accepted === false && r2.code === 'NEEDS_HUMAN',
    'continue: BLOCKED is never auto-continued');
  ok(/infrastructure outage/.test(r2.reason), 'continue: the refusal names the blocker');

  c = campaign.loadCampaign(g.campaign_id);
  c.state = 'COMPLETED';
  c.blocked_missions = [];
  campaign.saveCampaign(c);
  var r3 = svc.continueCampaign(g.campaign_id, {});
  ok(r3.accepted === false && r3.code === 'COMPLETED',
    'continue: a completed campaign is not restarted');

  var r4 = svc.continueCampaign('c-does-not-exist-000000', {});
  ok(r4.accepted === false && r4.code === 'NOT_FOUND', 'continue: unknown campaign is a clean 404');

  // WAITING_FOR_QUOTA is the documented recovery path, NOT a decision state:
  // resuming it is exactly what the quota design asks for.
  c = campaign.loadCampaign(g.campaign_id);
  c.state = 'WAITING_FOR_QUOTA';
  campaign.saveCampaign(c);
  ok(svc.CONTINUABLE.indexOf('WAITING_FOR_QUOTA') !== -1,
    'continue: WAITING_FOR_QUOTA is resumable, not a human-decision state');
  ok(svc.DECISION_STATES.indexOf('WAITING_FOR_QUOTA') === -1,
    'continue: quota waiting is never confused with an approval gate');
})();

// ===========================================================================
console.log('\n3. SINGLE-FLIGHT: A RETRYING TRIGGER CANNOT DOUBLE-RUN');
// ===========================================================================
(function () {
  var g = svc.submitGoal({ objective: 'Campaign used for the single-flight lease.', project: 'bridge-lock' });
  var c = campaign.loadCampaign(g.campaign_id);
  c.state = 'READY';
  campaign.saveCampaign(c);

  var first = svc.acquireLock(g.campaign_id);
  ok(first.acquired === true, 'lease: the first continuation acquires the lease');

  var second = svc.continueCampaign(g.campaign_id, {});
  ok(second.accepted === false && second.code === 'ALREADY_RUNNING',
    'lease: a concurrent continuation is refused, not queued into a parallel run');

  ok(!!svc.lockHolder(g.campaign_id), 'lease: the holder is visible while held');
  svc.releaseLock(g.campaign_id);
  ok(!svc.lockHolder(g.campaign_id), 'lease: releasing clears the holder');

  // A dead holder must never wedge the campaign forever.
  var lockFile = path.join(campaign.campaignsRoot(), g.campaign_id + '.run.lock');
  fs.writeFileSync(lockFile, JSON.stringify({
    campaign_id: g.campaign_id,
    holder_id: os.hostname() + ':999999:1',   // a pid that is not running
    acquired_at: new Date().toISOString()
  }));
  ok(svc.lockHolder(g.campaign_id) === null,
    'lease: a DEAD holder does not hold the lease (crash recovery, not a deadlock)');
  var reacquired = svc.acquireLock(g.campaign_id);
  ok(reacquired.acquired === true, 'lease: the lease is reclaimable after a crash');
  svc.releaseLock(g.campaign_id);
})();

// ===========================================================================
console.log('\n4. THE BRIDGE CANNOT WIDEN AUTHORITY');
// ===========================================================================
(function () {
  var g = svc.submitGoal({ objective: 'Campaign used for authority checks.', project: 'bridge-auth' });
  var c = campaign.loadCampaign(g.campaign_id);
  c.state = 'READY';
  campaign.saveCampaign(c);

  // max_steps is the only knob, and it is clamped at both ends.
  var huge = svc.continueCampaign(g.campaign_id, { max_steps: 10000 });
  ok(huge.accepted === true && huge.max_steps <= 20,
    'authority: max_steps is clamped — a caller cannot request unbounded work');
  svc.releaseLock(g.campaign_id);

  c = campaign.loadCampaign(g.campaign_id);
  c.state = 'READY';
  campaign.saveCampaign(c);
  var neg = svc.continueCampaign(g.campaign_id, { max_steps: -5 });
  ok(neg.accepted === true && neg.max_steps >= 1, 'authority: a nonsense max_steps floors at 1');
  svc.releaseLock(g.campaign_id);

  // The service source must not read provider/profile/permission from input.
  var src = fs.readFileSync(path.join(EXEC, 'core', 'campaign-service.js'), 'utf8');
  ['input.provider', 'input.execution_profile', 'input.permission_mode',
    'opts.provider', 'opts.execution_profile', 'opts.permission_mode',
    'payload.provider'].forEach(function (bad) {
    ok(src.indexOf(bad) === -1,
      'authority: campaign-service never reads ' + bad + ' from a caller');
  });

  var routes = fs.readFileSync(path.join(EXEC, 'server.js'), 'utf8');
  var campaignBlock = routes.slice(routes.indexOf("if (url === '/campaigns'"),
    routes.indexOf('Read-only budget inspection'));
  ['payload.provider', 'payload.execution_profile', 'payload.permission_mode',
    'payload.repo_path', 'payload.capability_key', 'payload.allowedTools'].forEach(function (bad) {
    ok(campaignBlock.indexOf(bad) === -1,
      'authority: the /campaigns routes never accept ' + bad);
  });
})();

// ===========================================================================
console.log('\n5. OBSERVABILITY: STATUS AND EVENT CURSOR');
// ===========================================================================
(function () {
  var g = svc.submitGoal({ objective: 'Campaign used for observability checks.', project: 'bridge-obs' });
  var d = svc.describe(g.campaign_id);
  ok(d && d.campaign_id === g.campaign_id, 'status: describe returns the campaign');
  ['state', 'running', 'continuable', 'needs_human', 'completed_missions',
    'blocked_missions', 'approval_required'].forEach(function (f) {
    ok(Object.prototype.hasOwnProperty.call(d, f), 'status: reports ' + f);
  });
  ok(svc.describe('c-nope-00000000') === null, 'status: unknown campaign is null, not a throw');

  var before = new Date().toISOString();
  store.appendEventLine({
    event_type: 'MISSION_COMPLETED', subject_id: g.campaign_id,
    project: 'bridge-obs', detail: { marker: 'cursor-test' }
  });
  var feed = svc.eventsSince(before, 50);
  ok(feed.count >= 1, 'events: the cursor feed returns events after the cursor');
  ok(feed.events.some(function (e) { return e.detail && e.detail.marker === 'cursor-test'; }),
    'events: the new event is present');
  ok(typeof feed.cursor === 'string', 'events: a cursor is returned for the next poll');

  var empty = svc.eventsSince(new Date(Date.now() + 60000).toISOString(), 50);
  ok(empty.count === 0, 'events: a future cursor returns nothing (no replay storm)');

  var capped = svc.eventsSince(null, 99999);
  ok(capped.events.length <= 500, 'events: the page size is capped regardless of the request');

  // NO EVENT LOSS AT A MILLISECOND BOUNDARY. A timestamp cursor drops any
  // event written in the same millisecond as the cursor, and never returns
  // it, because the next poll's cursor has already passed that millisecond.
  // A burst inside one millisecond is normal for a campaign, so the feed
  // pages by sequence number instead.
  var burstStart = svc.eventsSince(null, 500).cursor_seq;
  for (var i = 0; i < 5; i++) {
    store.appendEventLine({
      event_type: 'DECISION_MADE', subject_id: 'c-burst-000000',
      project: 'bridge-obs', detail: { burst: i }
    });
  }
  var page = svc.eventsSince(null, 500, burstStart);
  var burst = page.events.filter(function (e) {
    return e.detail && typeof e.detail.burst === 'number';
  });
  ok(burst.length === 5,
    'events: a 5-event same-millisecond burst is delivered in full (' + burst.length + '/5)');
  ok(burst.map(function (e) { return e.detail.burst; }).join(',') === '0,1,2,3,4',
    'events: burst order is preserved and nothing is skipped');
  var afterBurst = svc.eventsSince(null, 500, page.cursor_seq);
  ok(afterBurst.count === 0, 'events: paging past the cursor returns nothing new');
  ok(page.events.every(function (e) { return typeof e.seq === 'number'; }),
    'events: every event carries its sequence number for the next cursor');
})();

// ===========================================================================
console.log('\n6. THE BRIDGE IS INSIDE THE GOVERNANCE CAGE');
// ===========================================================================
(function () {
  ok(selfImprove.isProtectedPath('projects/mythos-ai-executor/core/campaign-service.js'),
    'cage: campaign-service.js cannot be autonomously rewritten');
  ok(selfImprove.isProtectedPath('/home/deploy/projects/mythos-prod/projects/mythos-ai-executor/core/campaign-service.js'),
    'cage: the absolute form is caged too');
  ok(selfImprove.isProtectedPath('projects/mythos-ai-executor/core/../core/campaign-service.js'),
    'cage: the non-normalised form is caged too');
})();

// ===========================================================================
console.log('\n7. THE OWNER CAN ANSWER AN APPROVAL (AND ONLY THE OWNER)');
// ===========================================================================
// WAITING_FOR_APPROVAL used to be a ONE-WAY DOOR: the loop could enter it but
// there was no supported way out except hand-editing persisted JSON — the
// exact untracked state surgery the approval mechanism exists to prevent.
// Long-running autonomy needs a decision path that is auditable and that
// cannot be taken by the loop itself.
(function () {
  var repo = makeRepo('approval-repo');
  var g = svc.submitGoal({ objective: 'Campaign used for approval resolution.', project: 'bridge-approval' });
  var c = campaign.loadCampaign(g.campaign_id);
  c.repo_path = repo;
  campaign.saveCampaign(c);

  campaign.parkForApproval(g.campaign_id, {
    mission_id: 'm-fake-0001', capability_key: 'A',
    objective: 'Improve the adapter', reason: 'governance violation in the real diff: policy.js',
    action_class: 'GOVERNANCE'
  });
  var parked = campaign.loadCampaign(g.campaign_id);
  ok(parked.state === 'WAITING_FOR_APPROVAL', 'approval: parking sets WAITING_FOR_APPROVAL');
  ok(parked.approval_required[0].approval_id && parked.approval_required[0].capability_key === 'A',
    'approval: the parked record carries BOTH an approval id and the capability key');
  ok(svc.continueCampaign(g.campaign_id, {}).code === 'NEEDS_HUMAN',
    'approval: while parked, the bridge still refuses to continue');

  // A decision requires a human identity and an explicit boolean.
  var threw = 0;
  try { campaign.resolveApproval(g.campaign_id, { capability_key: 'A', granted: false }); }
  catch (e) { if (/NEEDS_DECIDER/.test(e.message)) threw++; }
  try { campaign.resolveApproval(g.campaign_id, { capability_key: 'A', decided_by: 'someone' }); }
  catch (e) { if (/EXPLICIT_DECISION/.test(e.message)) threw++; }
  ok(threw === 2, 'approval: a decision needs a human identity AND an explicit grant/deny');

  var res = campaign.resolveApproval(g.campaign_id, {
    capability_key: 'A', granted: false, decided_by: 'owner-under-test', note: 'not now'
  });
  ok(res.granted === false && res.remaining_approvals === 0, 'approval: the denial is recorded');
  ok(res.state === 'READY',
    'approval: with no approvals left the campaign returns to READY and can pick other work');

  var after = campaign.loadCampaign(g.campaign_id);
  ok(after.approval_decisions.length === 1 &&
     after.approval_decisions[0].decided_by === 'owner-under-test',
    'approval: the decision is persisted with its decider (auditable, not a silent state flip)');

  var rmap = require(path.join(EXEC, 'core', 'roadmap'));
  var capA = rmap.candidates(repo).filter(function (x) { return x.key === 'A'; })[0];
  ok(capA && capA.effective_status === 'OWNER_DENIED',
    'approval: a denied capability is recorded OWNER_DENIED, not silently forgotten');
  ok(capA && capA.selectable === false,
    'approval: the loop will not propose the denied capability again');
  ok(!/implemented/i.test((capA.blocked_reasons || []).join(' ')),
    'approval: denial does NOT masquerade as "already implemented"');

  // Denying grants nothing — the conservative direction is always available,
  // but a GRANT still demands the same human identity.
  // Parking from READY must WORK: the pre-flight governance gate refuses a
  // capability at selection time, before any agent runs, and that is the
  // cheapest possible refusal. It used to throw ILLEGAL_CAMPAIGN_TRANSITION.
  var parkedFromReady = true;
  try {
    campaign.parkForApproval(g.campaign_id, {
      mission_id: 'm-fake-0002', capability_key: 'B', reason: 'second gate', action_class: 'GOVERNANCE'
    });
  } catch (e) { parkedFromReady = false; }
  ok(parkedFromReady,
    'approval: a READY campaign can be parked by the pre-flight gate (zero agent invocations)');

  var t2 = 0;
  try {
    campaign.resolveApproval(g.campaign_id, { capability_key: 'B', granted: true });
  } catch (e) { if (/NEEDS_DECIDER/.test(e.message)) t2++; }
  ok(t2 === 1, 'approval: granting is held to the same human-identity requirement as denying');
})();

// ===========================================================================
console.log('\n8. CLEANUP');
// ===========================================================================
(function () {
  try { fs.rmSync(RUNTIME, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  ok(true, 'cleanup: isolated runtime removed');
})();

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
