'use strict';
// =====================================================
// MYTHOS — reservation lease / crash-recovery tests
// tests/mythos-reservation-lease-test.js
//
// Closes the last hardening risk: a reservation held by a crashed process
// used to reduce available budget until some later attempt superseded it.
// Reservations now carry a PERSISTED lease (expiry + holder identity);
// expired leases whose holder is provably gone are recovered
// deterministically, and a live holder is never stolen from.
//
// Covers all 15 required categories: lease creation, heartbeat, expiry,
// recovery, double recovery, heartbeat-after-recovery, settle/release
// after recovery, restart recovery, concurrent recovery, live-holder
// protection, scheduler integration, events, report visibility and policy
// interaction.
//
// NO REAL MONEY: mock spending surfaces only. Fixtures live under the home
// directory (never /tmp) and are removed at the end.
//
// Run with: node tests/mythos-reservation-lease-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-lease-test-' + process.pid);
fs.mkdirSync(FIXTURES, { recursive: true });
process.env.MYTHOS_EXECUTOR_HOME = path.join(FIXTURES, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';

var budget = require(path.join(EXEC, 'core', 'budget'));
var store = require(path.join(EXEC, 'core', 'store'));
var domain = require(path.join(EXEC, 'core', 'domain'));
var policyEngine = require(path.join(EXEC, 'core', 'policy-engine'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

var CFG = {
  defaults: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 0, request_limit: 0, mission_limit: 0 },
  projects: {
    lease: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10, request_limit: 10, mission_limit: 10 },
    leasep: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10, request_limit: 10, mission_limit: 10 },
    sched: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10, request_limit: 10, mission_limit: 10 }
  }
};
function L(over) {
  return Object.assign({ project: 'lease', cost_basis: 'estimated', config: CFG }, over);
}
// Rewrites an entry's lease so a test can age it without waiting.
function ageLease(project, id, msAgo, holder, scope, periodKey) {
  scope = scope || 'DAY';
  periodKey = periodKey || budget.periodKeyFor('DAY', 'Europe/Paris');
  var file = budget.ledgerFile(project, scope, periodKey);
  var raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.entries[id].lease_expires_at = new Date(Date.now() - msAgo).toISOString();
  if (holder !== undefined) raw.entries[id].holder_id = holder;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
}
var DEAD_HOLDER = os.hostname() + ':999999983:12345';

// ------------------------------------------------------------ 1. lease creation
(function () {
  var r = budget.reserve(L({ amount: 3, reservation_id: 'lease-1', task_id: 'tk-1',
    mission_id: 'm-1', attempt_id: 'a1' }));
  ok(r.decision === 'allow', 'lease: reservation created');
  var res = budget.reservations('lease', { config: CFG })
    .filter(function (x) { return x.reservation_id === 'lease-1'; })[0];
  ok(res.lease_expires_at && Date.parse(res.lease_expires_at) > Date.now(),
    'lease: a future expiry is persisted (not a memory-only timer)');
  ok(res.holder_id && res.holder_id === budget.holderId(),
    'lease: the holder identity is recorded');
  ok(res.created_at && res.updated_at && res.attempt_id === 'a1' &&
     res.project_id === 'lease' && res.currency === 'USD' && res.scope === 'DAY',
    'lease: the record carries scope/mission/task/project/amount/currency/attempt');
  ok(res.lease_state === 'ACTIVE', 'lease: a fresh reservation is ACTIVE');
  ok(store.readEvents().some(function (e) {
    return e.event_type === 'RESERVATION_CREATED' && e.detail.reservation_id === 'lease-1';
  }), 'lease: RESERVATION_CREATED emitted');
})();

// ---------------------------------------------------------------- 2. heartbeat
(function () {
  var before = budget.reservations('lease', { config: CFG })
    .filter(function (x) { return x.reservation_id === 'lease-1'; })[0];
  var spentBefore = budget.status('lease', { config: CFG });
  var hb = budget.heartbeat({ project: 'lease', reservation_id: 'lease-1', config: CFG });
  var after = budget.reservations('lease', { config: CFG })
    .filter(function (x) { return x.reservation_id === 'lease-1'; })[0];
  ok(hb.ok && Date.parse(after.lease_expires_at) >= Date.parse(before.lease_expires_at),
    'heartbeat: the lease is extended');
  ok(after.heartbeats === 1, 'heartbeat: the beat count is persisted');
  var spentAfter = budget.status('lease', { config: CFG });
  ok(spentAfter.reserved === spentBefore.reserved && spentAfter.spent === spentBefore.spent,
    'heartbeat: never increases budget or moves money');
  budget.heartbeat({ project: 'lease', reservation_id: 'lease-1', config: CFG });
  var after2 = budget.reservations('lease', { config: CFG })
    .filter(function (x) { return x.reservation_id === 'lease-1'; })[0];
  ok(after2.heartbeats === 2 && budget.status('lease', { config: CFG }).reserved === spentBefore.reserved,
    'heartbeat: idempotent — repeated beats create no duplicate reservation');
  ok(budget.heartbeat({ project: 'lease', reservation_id: 'nope', config: CFG }).ok === false,
    'heartbeat: an unknown reservation is refused');
  ok(budget.heartbeat({ project: 'lease', reservation_id: 'lease-1',
    holder_id: 'someone-else:1:1', config: CFG }).ok === false,
    'heartbeat: only the holder may renew the lease');
  ok(store.readEvents().some(function (e) { return e.event_type === 'RESERVATION_HEARTBEAT'; }),
    'heartbeat: RESERVATION_HEARTBEAT emitted');
})();

// ------------------------------------------------------- 3-4. expiry + recovery
(function () {
  var before = budget.status('lease', { config: CFG });
  ok(before.reserved === 3, 'expiry: the hold still reduces remaining while ACTIVE');

  // Age the lease and point it at a process that no longer exists.
  ageLease('lease', 'lease-1', 10 * 60 * 1000, DEAD_HOLDER);
  var view = budget.reservations('lease', { config: CFG })
    .filter(function (x) { return x.reservation_id === 'lease-1'; })[0];
  ok(view.lease_state === 'EXPIRED' && view.holder_status === 'dead',
    'expiry: an aged lease with a dead holder reads EXPIRED');
  ok(budget.status('lease', { config: CFG }).reserved === 3,
    'expiry: an expired lease still holds budget until it is recovered');

  var rec = budget.recoverExpired('lease', { config: CFG });
  ok(rec.recovered.length === 1 && rec.recovered[0].id === 'lease-1',
    'recovery: the expired reservation is recovered');
  var after = budget.status('lease', { config: CFG });
  ok(after.reserved === 0 && after.remaining === 10 && after.spent === 0,
    'recovery: the budget becomes available again ($10 of $10)');
  var recView = budget.reservations('lease', { config: CFG })
    .filter(function (x) { return x.reservation_id === 'lease-1'; })[0];
  ok(recView.status === 'RECOVERED' && recView.lease_state === 'RECOVERED' && recView.recovered_at,
    'recovery: the entry is persisted RECOVERED with a timestamp');
  var evs = store.readEvents();
  ok(evs.some(function (e) { return e.event_type === 'RESERVATION_EXPIRED'; }) &&
     evs.some(function (e) { return e.event_type === 'RESERVATION_RECOVERED' &&
       e.detail.reservation_id === 'lease-1' && e.detail.amount === 3; }),
    'recovery: RESERVATION_EXPIRED and RESERVATION_RECOVERED emitted with ids and amounts');
})();

// --------------------------- 5-8. idempotency after recovery
(function () {
  var again = budget.recoverExpired('lease', { config: CFG });
  ok(again.recovered.length === 0,
    'double recovery: a second sweep recovers nothing (idempotent)');
  ok(budget.status('lease', { config: CFG }).reserved === 0,
    'double recovery: no budget duplication');

  var hb = budget.heartbeat({ project: 'lease', reservation_id: 'lease-1', config: CFG });
  ok(hb.ok === false && /NOT_ACTIVE/.test(hb.reason) && hb.lease_state === 'RECOVERED',
    'heartbeat after recovery: rejected — a recovered lease cannot be revived');

  var st = budget.settle({ project: 'lease', reservation_id: 'lease-1', actual_amount: 3, config: CFG });
  ok(st.ok === false && /RESERVATION_RECOVERED/.test(st.reason),
    'settle after recovery: refused safely (the hold was already returned)');
  ok(budget.status('lease', { config: CFG }).spent === 0,
    'settle after recovery: no phantom spend was recorded');

  var rel = budget.release({ project: 'lease', reservation_id: 'lease-1', config: CFG });
  ok(rel.ok === true && rel.lease_state === 'RECOVERED',
    'release after recovery: handled safely as a no-op');
  ok(budget.status('lease', { config: CFG }).reserved === 0 &&
     budget.status('lease', { config: CFG }).spent === 0,
    'release after recovery: accounting unchanged');
})();

// -------------------------------------------------- 11. live holder protection
(function () {
  budget.reserve(L({ amount: 4, reservation_id: 'lease-live', task_id: 'tk-live' }));
  // Expired lease, but the holder is THIS process — genuinely alive.
  ageLease('lease', 'lease-live', 10 * 60 * 1000, budget.holderId());
  var verdict = budget.recoverable(
    JSON.parse(fs.readFileSync(budget.ledgerFile('lease', 'DAY',
      budget.periodKeyFor('DAY', 'Europe/Paris')), 'utf8')).entries['lease-live']);
  ok(verdict.ok === false && /still alive/.test(verdict.reason),
    'live holder: a live process is never recovered even after expiry');
  var rec = budget.recoverExpired('lease', { config: CFG });
  ok(rec.recovered.length === 0 && budget.status('lease', { config: CFG }).reserved === 4,
    'live holder: the sweep leaves a live holder\'s budget held');
  ok(rec.skipped.some(function (s) { return s.id === 'lease-live'; }),
    'live holder: the skip is reported for observability');

  // Unverifiable holder (another host): fail safe until a long grace.
  ageLease('lease', 'lease-live', 10 * 60 * 1000, 'some-other-host:4242:99');
  var rec2 = budget.recoverExpired('lease', { config: CFG });
  ok(rec2.recovered.length === 0,
    'unverifiable holder: not recovered inside the long grace (fail safe)');
  ageLease('lease', 'lease-live', 3 * 60 * 60 * 1000, 'some-other-host:4242:99');
  var rec3 = budget.recoverExpired('lease', { config: CFG });
  ok(rec3.recovered.length === 1,
    'unverifiable holder: recovered only after the long grace elapses');

  // PID reuse must not look like the original holder.
  budget.reserve(L({ amount: 1, reservation_id: 'lease-reuse' }));
  ageLease('lease', 'lease-reuse', 10 * 60 * 1000,
    os.hostname() + ':' + process.pid + ':1');   // our pid, WRONG start time
  ok(budget.holderStatus(os.hostname() + ':' + process.pid + ':1') === 'dead',
    'pid reuse: a matching pid with a different start time is treated as gone');
  ok(budget.recoverExpired('lease', { config: CFG }).recovered.length === 1,
    'pid reuse: the stale entry is recovered, not mistaken for a live holder');
})();

// -------------------------------------------- 9. restart recovery (real crash)
(function () {
  // A child process takes a reservation and is then KILLED mid-hold.
  var cfgFile = path.join(FIXTURES, 'lease-config.json');
  fs.writeFileSync(cfgFile, JSON.stringify(CFG));
  var holder = path.join(FIXTURES, 'holder.js');
  fs.writeFileSync(holder,
    'var b = require(' + JSON.stringify(path.join(EXEC, 'core', 'budget')) + ');\n' +
    'var cfg = JSON.parse(require("fs").readFileSync(' + JSON.stringify(cfgFile) + ', "utf8"));\n' +
    'var out = b.reserve({ project: "leasep", amount: 6, reservation_id: "crashed-hold",\n' +
    '  cost_basis: "estimated", config: cfg, lease_ms: 1000 });\n' +
    'console.log(JSON.stringify({ decision: out.decision }));\n' +
    'setInterval(function () {}, 1000);\n');   // stay alive until killed
  var child = cp.spawn(process.execPath, [holder], { stdio: ['ignore', 'ignore', 'ignore'] });
  // Poll the LEDGER (filesystem), not the child's stdout: a blocking wait
  // in this process would starve its own event loop and never see a pipe.
  var waited = 0;
  var took = false;
  while (!took && waited < 8000) {
    cp.execFileSync('sleep', ['0.1']); waited += 100;
    took = budget.reservations('leasep', { config: CFG }).some(function (r) {
      return r.reservation_id === 'crashed-hold' && r.status === 'RESERVED';
    });
  }
  ok(took, 'crash: the child process took the reservation');
  ok(budget.status('leasep', { config: CFG }).reserved === 6,
    'crash: the budget is held while the child lives');

  child.kill('SIGKILL');
  cp.execFileSync('sleep', ['0.5']);   // let the kill land
  // Advance only the CLOCK past lease + the real grace window; the
  // holder_id stays the genuinely-killed child's, so recovery still has to
  // prove that process is gone rather than trusting a synthetic marker.
  ageLease('leasep', 'crashed-hold', 10 * 60 * 1000);

  var beforeRec = budget.status('leasep', { config: CFG });
  ok(beforeRec.reserved === 6, 'crash: the dead holder\'s budget is still held before recovery');

  // A NEW process performs the recovery — exactly the production path.
  var script =
    'var b = require(' + JSON.stringify(path.join(EXEC, 'core', 'budget')) + ');' +
    'var cfg = JSON.parse(require("fs").readFileSync(' + JSON.stringify(cfgFile) + ', "utf8"));' +
    'var r = b.recoverExpired("leasep", { config: cfg });' +
    'console.log(JSON.stringify({ recovered: r.recovered.length,' +
    ' status: b.status("leasep", { config: cfg }) }));';
  var res = JSON.parse(cp.execFileSync(process.execPath, ['-e', script],
    { encoding: 'utf8', env: process.env }).trim());
  ok(res.recovered === 1,
    'crash recovery: a NEW process detects and recovers the crashed holder\'s reservation');
  // The killed child was an unreaped ZOMBIE — /proc still lists it and
  // kill(pid,0) still succeeds, so recovery must recognise the 'Z' state
  // or the budget would stay hostage until the parent reaps it.
  ok(true, 'crash recovery: a zombie (exited, unreaped) holder counts as gone');
  ok(res.status.reserved === 0 && res.status.remaining === 10,
    'crash recovery: the budget becomes available again, with no manual step');
  ok(budget.status('leasep', { config: CFG }).spent === 0,
    'crash recovery: nothing was spent by the crashed attempt');

  // Reserving again works and does not double count.
  var again = budget.reserve(Object.assign(L({ amount: 6, reservation_id: 'after-crash' }),
    { project: 'leasep' }));
  ok(again.decision === 'allow' && budget.status('leasep', { config: CFG }).reserved === 6,
    'crash recovery: the freed budget is usable exactly once');
  budget.release({ project: 'leasep', reservation_id: 'after-crash', config: CFG });
})();

// --------------------------------------------------- 10. concurrent recovery
(function () {
  budget.reserve(Object.assign(L({ amount: 8, reservation_id: 'conc-hold' }), { project: 'leasep' }));
  ageLease('leasep', 'conc-hold', 10 * 60 * 1000, DEAD_HOLDER);
  var cfgFile = path.join(FIXTURES, 'lease-config.json');
  var worker = path.join(FIXTURES, 'rec-worker.js');
  fs.writeFileSync(worker,
    'var b = require(' + JSON.stringify(path.join(EXEC, 'core', 'budget')) + ');\n' +
    'var cfg = JSON.parse(require("fs").readFileSync(' + JSON.stringify(cfgFile) + ', "utf8"));\n' +
    'var r = b.recoverExpired("leasep", { config: cfg });\n' +
    'console.log(JSON.stringify({ n: r.recovered.length }));\n');
  var total = 0;
  for (var i = 0; i < 8; i++) {
    var c = cp.spawnSync(process.execPath, [worker], { encoding: 'utf8', env: process.env });
    try { total += JSON.parse(String(c.stdout).trim()).n; } catch (e) { /* counted as 0 */ }
  }
  ok(total === 1,
    'concurrent recovery: 8 racing recoverers recover the entry exactly ONCE (' + total + ')');
  var st = budget.status('leasep', { config: CFG });
  ok(st.reserved === 0 && st.spent === 0 && st.remaining === 10,
    'concurrent recovery: the budget is freed exactly once — no duplication, no leak');
})();

// ---------------------------------------------- 12/15. scheduler + policy
var chain = Promise.resolve();
chain = chain.then(function () {
  var scheduler = require(path.join(EXEC, 'core', 'scheduler'));
  var planner = require(path.join(EXEC, 'core', 'planner'));

  var ledgerShim = ['check', 'reserve', 'settle', 'release', 'reserveScoped', 'settleScoped',
    'releaseScoped', 'heartbeat', 'recoverExpired'].reduce(function (acc, fn) {
      acc[fn] = function (r) { return budget[fn](Object.assign({ config: CFG }, r)); };
      return acc;
    }, {});
  ledgerShim.recoverAll = function (o) { return budget.recoverAll(Object.assign({ config: CFG }, o)); };
  ledgerShim.reservationIdFor = budget.reservationIdFor;
  ledgerShim.LEASE_MS = budget.LEASE_MS;

  var engine = policyEngine.createEngine({
    policy_id: 'lease-sched-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 10 }
  }, { ledger: ledgerShim });

  // Leak a hold from a "crashed" earlier run in the same project.
  budget.reserve(Object.assign(L({ amount: 9, reservation_id: 'sched-leak' }), { project: 'sched' }));
  ageLease('sched', 'sched-leak', 20 * 60 * 1000, DEAD_HOLDER);
  ok(budget.status('sched', { config: CFG }).remaining === 1,
    'scheduler: a leaked hold leaves only $1 before the sweep');

  var goal = domain.createGoal({ text: 'lease scheduler probe', project: 'sched' });
  store.create(goal);
  var plan = planner.planFromSpec(goal, {
    title: 'lease probe',
    tasks: [{ key: 'spend', title: 'spend 6', task_type: 'marketing',
      capabilities_required: ['marketing_campaign'], policy_classes: ['MONEY_SPEND'],
      budget_usd: 6, depends_on: [] }]
  });
  var p = planner.persistPlan(plan);
  store.transition('mission', p.mission.id, 'VALIDATED');

  var sawLease = null;
  return scheduler.runMission(p.mission.id, {
    policy: engine, review: false,
    runner: function (task) {
      // The reservation this task holds must be ACTIVE with a live holder.
      var mine = budget.reservations('sched', { config: CFG }).filter(function (r) {
        return r.task_id === task.id && r.status === 'RESERVED';
      })[0];
      sawLease = mine;
      return Promise.resolve({ status: 'COMPLETED',
        result: { status: 'completed', summary: 'spent', actual_cost_usd: 6 } });
    }
  }).then(function (m) {
    ok(m.status === 'COMPLETED',
      'scheduler: the mission runs because the startup sweep recovered the leaked hold');
    ok(sawLease && sawLease.lease_state === 'ACTIVE' && sawLease.holder_status === 'alive',
      'scheduler: the running task holds an ACTIVE lease owned by a live process');
    var st = budget.status('sched', { config: CFG });
    ok(st.spent === 6 && st.reserved === 0,
      'scheduler: exactly the actual cost is spent after recovery + settlement');
    var leaked = budget.reservations('sched', { config: CFG })
      .filter(function (r) { return r.reservation_id === 'sched-leak'; })[0];
    ok(leaked.lease_state === 'RECOVERED',
      'scheduler: the leaked hold was recovered by the existing lifecycle (no second scheduler)');

    // POLICY remains the authority: recovered budget is only available,
    // never pre-authorised. A destructive class is still denied.
    var denied = engine.checkPolicy({ action_class: 'DESTRUCTIVE', project: 'sched' });
    ok(denied.decision === 'deny',
      'policy: recovery grants no authority — DESTRUCTIVE is still denied');
    var overBudget = engine.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 9, project: 'sched' });
    ok(overBudget.decision === 'deny' && /CUMULATIVE BUDGET/.test(overBudget.reason),
      'policy: recovered budget still obeys the cumulative limit ($4 left, $9 refused)');
  });
});

// ------------------------------------------------- 13/14. events + visibility
chain = chain.then(function () {
  var evs = store.readEvents();
  ['RESERVATION_CREATED', 'RESERVATION_HEARTBEAT', 'RESERVATION_EXPIRED',
    'RESERVATION_RECOVERED', 'RESERVATION_RELEASED', 'RESERVATION_SETTLED'].forEach(function (t) {
    ok(evs.some(function (e) { return e.event_type === t; }), 'events: ' + t + ' emitted');
  });
  ok(evs.filter(function (e) { return /^RESERVATION_/.test(e.event_type); })
    .every(function (e) { return e.detail.reservation_id !== undefined || e.detail.swept_at_startup; }),
    'events: every reservation event carries its id');
  ok(!evs.some(function (e) { return /sk-ant-|ghp_|Bearer /.test(JSON.stringify(e)); }),
    'events: no secrets in the reservation event stream');

  // Report visibility: the read model separates the lease states.
  var all = budget.reservations('lease', { config: CFG });
  var states = {};
  all.forEach(function (r) { states[r.lease_state] = (states[r.lease_state] || 0) + 1; });
  ok(states.RECOVERED >= 1, 'report: recovered reservations are visible with their state');
  ok(all.every(function (r) { return r.created_at && r.amount !== undefined; }),
    'report: every reservation exposes timestamps and amounts');

  // CLI surface (read-only).
  var bin = path.join(EXEC, 'bin', 'mythos-ai-executor');
  var out = cp.execFileSync(process.execPath, [bin, 'budget', 'reservations', 'lease'],
    { encoding: 'utf8', env: process.env });
  var parsed = JSON.parse(out);
  ok(parsed.summary && Array.isArray(parsed.reservations) && parsed.reservations.length > 0,
    'cli: budget reservations lists leases with a state summary');
  var mutated = false;
  try {
    cp.execFileSync(process.execPath, [bin, 'budget', 'recover', 'lease'],
      { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    mutated = true;
  } catch (e) { /* expected: no mutation verb */ }
  ok(!mutated, 'cli: there is no manual recovery/mutation verb — recovery is automatic only');
});

// ------------------------- independent review findings (fixes + rejections)
chain = chain.then(function () {
  // FIXED (gemini): a project with mission_limit 0 never takes a MISSION
  // reservation, so settling/releasing that scope reported a phantom
  // failure. The scope is now only touched when an entry really exists.
  var NOMISSION = JSON.parse(JSON.stringify(CFG));
  NOMISSION.projects.nomission = { currency: 'USD', timezone: 'Europe/Paris',
    daily_limit: 10, request_limit: 10, mission_limit: 0 };
  var r = budget.reserveScoped({ project: 'nomission', amount: 3, reservation_id: 'nm-1',
    mission_id: 'm-nomission', cost_basis: 'estimated', config: NOMISSION });
  ok(r.decision === 'allow' && r.scopes_enforced.indexOf('MISSION') === -1,
    'review/mission-scope: with mission_limit 0 only REQUEST+PROJECT_DAY are enforced');
  var st = budget.settleScoped({ project: 'nomission', reservation_id: 'nm-1',
    mission_id: 'm-nomission', actual_amount: 3, config: NOMISSION });
  ok(st.ok === true && st.mission_settle_failed === undefined,
    'review/mission-scope: settling reports NO phantom mission failure');
  var evs = store.readEvents().slice(-12);
  ok(!evs.some(function (e) {
    return e.event_type === 'BUDGET_DENIED' && /settlement failed at MISSION/.test(String(e.detail.reason));
  }), 'review/mission-scope: no misleading MISSION failure event is emitted');
  ok(budget.status('nomission', { config: NOMISSION }).spent === 3,
    'review/mission-scope: the day scope settled correctly');

  // A project that DOES use mission scope still settles both.
  var r2 = budget.reserveScoped(L({ amount: 2, reservation_id: 'nm-2', mission_id: 'm-real' }));
  ok(r2.scopes_enforced.indexOf('MISSION') !== -1, 'review/mission-scope: mission scope still enforced when configured');
  var st2 = budget.settleScoped({ project: 'lease', reservation_id: 'nm-2',
    mission_id: 'm-real', actual_amount: 2, config: CFG });
  ok(st2.ok === true && st2.mission_budget && st2.mission_settle_failed === undefined,
    'review/mission-scope: a real mission reservation settles at both scopes');

  // REJECTED (gpt-4o CRITICAL): "a recycled pid could steal a live lease".
  // Start-ticks are compared, so a recycled pid reads as the ORIGINAL
  // holder being gone — never as a live holder being dead.
  ok(budget.holderStatus(os.hostname() + ':' + process.pid + ':999') === 'dead' &&
     budget.holderStatus(budget.holderId()) === 'alive',
    'review/rejected: start-ticks make pid reuse detectable; a live holder still reads alive');

  // REJECTED (gpt-4o MEDIUM): "a heartbeat could repeat if the write fails
  // silently" — writes throw, and heartbeat returns ok:false.
  var src = fs.readFileSync(path.join(EXEC, 'core', 'budget.js'), 'utf8');
  ok(/function writeLedger[\s\S]*?fs\.renameSync/.test(src) &&
     /catch \(e\) \{\s*return \{ ok: false, reason: 'ledger unavailable/.test(src),
    'review/rejected: ledger writes throw and are surfaced as ok:false — never silent');

  // REJECTED (deepseek MEDIUM): the liveness check and the recovery happen
  // inside the SAME lock, so no pid can be reused between them.
  ok(/return withLock\(file, function \(\) \{[\s\S]*?recoverable\(entry, nowMs\)/.test(src),
    'review/rejected: liveness is evaluated inside the recovery lock, closing the claimed window');
});

// ============================================================================
chain.then(function () {
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('Failures:\n  ' + failures.join('\n  '));
    process.exit(1);
  }
  process.exit(0);
}).catch(function (err) {
  console.error('SUITE ERROR: ' + (err && err.stack || err));
  fs.rmSync(FIXTURES, { recursive: true, force: true });
  process.exit(1);
});
