'use strict';
// =====================================================
// MYTHOS — cumulative budget ledger tests
// tests/mythos-budget-ledger-test.js
//
// Covers the 23 required categories for the spend ledger: basics,
// remaining, reserve/settle/release, denial, approval, parallel
// reservations (including 10+ concurrent against one budget), duplicate
// settlement/release, restart recovery, project isolation, daily period
// and timezone boundaries, provider independence, quota-vs-budget
// separation, retry and provider-switch bypass attempts, multi-mission
// cumulative spend, reports, the event stream, and policy interaction.
//
// NO REAL MONEY: every spending surface is a mock/sandbox tool and no
// external paid API is called. Fixtures live under the home directory
// (never /tmp) and are removed at the end.
//
// Run with: node tests/mythos-budget-ledger-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');

var FIXTURES = path.join(os.homedir(), 'mythos-budget-test-' + process.pid);
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

// A test budget config: sandbox has 10 USD/day, "starved" has none.
var CFG = {
  config_id: 'test-budgets',
  defaults: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 0 },
  projects: {
    sandbox: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 },
    other: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 },
    tokyo: { currency: 'USD', timezone: 'Asia/Tokyo', daily_limit: 10 },
    starved: { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 0 }
  }
};
function R(over) {
  return Object.assign({ project: 'sandbox', cost_basis: 'estimated', config: CFG }, over);
}

// ---------------------------------------------------------------- 1-2. basics
(function () {
  var st = budget.status('sandbox', { config: CFG });
  ok(st.limit === 10 && st.spent === 0 && st.reserved === 0 && st.remaining === 10,
    'basic: fresh period starts at the configured limit');
  ok(st.currency === 'USD' && st.timezone === 'Europe/Paris' && st.configured === true,
    'basic: currency and timezone come from config');
  var none = budget.status('unlisted-project', { config: CFG });
  ok(none.configured === false && none.limit === 0 && none.remaining === 0,
    'basic: an unconfigured project has NO budget (never a default allowance)');
})();

// ------------------------------------------------------------- 3-5. lifecycle
(function () {
  var a = budget.reserve(R({ amount: 4, reservation_id: 'rsv-a' }));
  ok(a.decision === 'allow' && a.budget.reserved === 4 && a.budget.remaining === 6,
    'reserve: holds the amount and reduces remaining immediately');
  ok(budget.status('sandbox', { config: CFG }).spent === 0,
    'reserve: a reservation is not yet spend');

  var s = budget.settle({ project: 'sandbox', reservation_id: 'rsv-a', actual_amount: 3, config: CFG });
  ok(s.ok && s.settled_amount === 3 && s.budget.spent === 3 && s.budget.reserved === 0 &&
     s.budget.remaining === 7,
    'settle: actual amount becomes spend and the hold is freed');

  var b = budget.reserve(R({ amount: 2, reservation_id: 'rsv-b' }));
  var rel = budget.release({ project: 'sandbox', reservation_id: 'rsv-b', reason: 'execution failed', config: CFG });
  ok(b.decision === 'allow' && rel.ok && rel.budget.reserved === 0 && rel.budget.remaining === 7,
    'release: a failed execution returns the hold, spend unchanged');
  ok(rel.budget.spent === 3, 'release: released money never counts as spent');
})();

// --------------------------------------------------------- 6-7. deny/approval
(function () {
  // Remaining is 7 at this point.
  var over = budget.reserve(R({ amount: 8, reservation_id: 'rsv-over' }));
  ok(over.decision === 'deny' && /exceeds remaining/.test(over.reason),
    'deny: a request beyond remaining is denied');
  ok(budget.status('sandbox', { config: CFG }).reserved === 0,
    'deny: a denied request holds nothing');

  var appr = budget.reserve(R({ amount: 8, reservation_id: 'rsv-appr', allow_approval: true }));
  ok(appr.decision === 'require_approval' && /exceeds remaining/.test(appr.reason),
    'approval: over-budget with approval allowed → require_approval');
  ok(budget.status('sandbox', { config: CFG }).reserved === 0,
    'approval: a parked request holds nothing until approved');
  ok(appr.budget.limit === 10 && appr.budget.spent === 3 && appr.budget.remaining === 7,
    'approval: the decision carries limit/spent/remaining for the record');

  var starved = budget.reserve(R({ project: 'starved', amount: 1, reservation_id: 'rsv-starved' }));
  ok(starved.decision === 'deny' && /no configured spending budget/.test(starved.reason),
    'deny: a project without budget cannot spend at all');
})();

// -------------------------------------------------- 8/20. parallel + 10 racers
(function () {
  // Fresh project namespace for the concurrency probe.
  var CFG2 = JSON.parse(JSON.stringify(CFG));
  CFG2.projects.race = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };

  // In-process sequential-but-interleaved check first: A holds 7, B wants 7.
  var a = budget.reserve(R({ project: 'race', amount: 7, reservation_id: 'race-a', config: CFG2 }));
  var b = budget.reserve(R({ project: 'race', amount: 7, reservation_id: 'race-b', config: CFG2 }));
  ok(a.decision === 'allow' && b.decision === 'deny',
    'parallel: the second overlapping request cannot see the same remaining');
  ok(budget.status('race', { config: CFG2 }).reserved === 7,
    'parallel: only one reservation is held');
  budget.release({ project: 'race', reservation_id: 'race-a', config: CFG2 });

  // TRUE concurrency: 12 separate PROCESSES each try to reserve 1 USD
  // against a 10 USD budget at the same moment.
  var cfgFile = path.join(FIXTURES, 'race-config.json');
  fs.writeFileSync(cfgFile, JSON.stringify(CFG2));
  var worker = path.join(FIXTURES, 'race-worker.js');
  fs.writeFileSync(worker,
    'var budget = require(' + JSON.stringify(path.join(EXEC, 'core', 'budget')) + ');\n' +
    'var cfg = JSON.parse(require("fs").readFileSync(' + JSON.stringify(cfgFile) + ', "utf8"));\n' +
    'var id = process.argv[2];\n' +
    'var out = budget.reserve({ project: "concurrent", amount: 1, reservation_id: id,\n' +
    '  cost_basis: "estimated", config: cfg });\n' +
    'console.log(JSON.stringify({ id: id, decision: out.decision }));\n');
  CFG2.projects.concurrent = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };
  fs.writeFileSync(cfgFile, JSON.stringify(CFG2));

  var children = [];
  for (var i = 0; i < 12; i++) {
    children.push(cp.spawnSync(process.execPath, [worker, 'conc-' + i], {
      encoding: 'utf8', env: Object.assign({}, process.env)
    }));
  }
  var allowed = 0, denied = 0;
  children.forEach(function (c) {
    try {
      var r = JSON.parse(String(c.stdout).trim());
      if (r.decision === 'allow') allowed++; else denied++;
    } catch (e) { denied++; }
  });
  var finalState = budget.status('concurrent', { config: CFG2 });
  ok(allowed === 10 && denied === 2,
    '10+ concurrent: exactly the affordable number succeeded (' + allowed + ' allow / ' + denied + ' deny)');
  ok(finalState.reserved <= finalState.limit && finalState.reserved === 10,
    'concurrent: reserved never exceeds the limit');
  ok(finalState.reserved + finalState.spent <= finalState.limit,
    'concurrent: reserved + spent <= limit at all times');
})();

// ------------------------------------------------- 9-10. idempotent operations
(function () {
  budget.reserve(R({ project: 'other', amount: 5, reservation_id: 'idem-1' }));
  var s1 = budget.settle({ project: 'other', reservation_id: 'idem-1', actual_amount: 5, config: CFG });
  var s2 = budget.settle({ project: 'other', reservation_id: 'idem-1', actual_amount: 5, config: CFG });
  ok(s1.ok && s2.ok && s2.idempotent_replay === true,
    'idempotency: a repeated settlement is acknowledged as a replay');
  ok(budget.status('other', { config: CFG }).spent === 5,
    'idempotency: duplicate settlement counts ONCE');

  budget.reserve(R({ project: 'other', amount: 2, reservation_id: 'idem-2' }));
  budget.release({ project: 'other', reservation_id: 'idem-2', config: CFG });
  var r2 = budget.release({ project: 'other', reservation_id: 'idem-2', config: CFG });
  ok(r2.ok && r2.idempotent_replay === true &&
     budget.status('other', { config: CFG }).reserved === 0,
    'idempotency: duplicate release is a no-op');

  var badSettle = budget.settle({ project: 'other', reservation_id: 'idem-2', config: CFG });
  ok(badSettle.ok === false && /RELEASED/.test(badSettle.reason),
    'idempotency: a released reservation can never later be settled');
  budget.reserve(R({ project: 'other', amount: 1, reservation_id: 'idem-3' }));
  budget.settle({ project: 'other', reservation_id: 'idem-3', config: CFG });
  var lateRelease = budget.release({ project: 'other', reservation_id: 'idem-3', config: CFG });
  ok(lateRelease.ok === false && /ALREADY_SETTLED/.test(lateRelease.reason),
    'idempotency: a settled spend is never un-spent by a late release');

  var replay = budget.reserve(R({ project: 'other', amount: 5, reservation_id: 'idem-1' }));
  ok(replay.decision === 'allow' && replay.idempotent_replay === true &&
     budget.status('other', { config: CFG }).spent === 6,
    'idempotency: replaying a reservation id does not double-hold');
})();

// ------------------------------------------------------- 11. restart recovery
(function () {
  budget.reserve(R({ project: 'sandbox', amount: 2, reservation_id: 'restart-hold' }));
  var before = budget.status('sandbox', { config: CFG });
  var script =
    'var b = require(' + JSON.stringify(path.join(EXEC, 'core', 'budget')) + ');' +
    'var cfg = ' + JSON.stringify(JSON.stringify(CFG)) + ';' +
    'console.log(JSON.stringify(b.status("sandbox", { config: JSON.parse(cfg) })));';
  var after = JSON.parse(cp.execFileSync(process.execPath, ['-e', script],
    { encoding: 'utf8', env: Object.assign({}, process.env) }).trim());
  ok(after.spent === before.spent && after.reserved === before.reserved &&
     after.remaining === before.remaining,
    'restart: a fresh process sees identical spent/reserved/remaining');
  ok(after.reserved === 2 && after.remaining === 5,
    'restart: an unsettled reservation still holds budget (restart creates no free money)');
  budget.release({ project: 'sandbox', reservation_id: 'restart-hold', config: CFG });
})();

// ------------------------------------------------------- 12. project isolation
(function () {
  var s = budget.status('sandbox', { config: CFG });
  var o = budget.status('other', { config: CFG });
  ok(s.spent === 3 && o.spent === 6,
    'isolation: each project keeps its own cumulative spend');
  var files = fs.readdirSync(budget.budgetsRoot());
  ok(files.some(function (f) { return f.indexOf('sandbox__DAY__') === 0; }) &&
     files.some(function (f) { return f.indexOf('other__DAY__') === 0; }),
    'isolation: separate ledger files per project and period');
})();

// -------------------------------------------------- 13-14. period + timezone
(function () {
  var parisNewYearEve = Date.parse('2026-12-31T22:30:00Z'); // 23:30 Paris, 07:30 Tokyo (Jan 1)
  ok(budget.periodKeyFor('DAY', 'Europe/Paris', parisNewYearEve) === '2026-12-31',
    'period: Paris date computed in the configured zone');
  ok(budget.periodKeyFor('DAY', 'Asia/Tokyo', parisNewYearEve) === '2027-01-01',
    'timezone: the same instant is a DIFFERENT day in another zone');
  ok(budget.periodKeyFor('DAY', 'UTC', parisNewYearEve) === '2026-12-31',
    'timezone: UTC is explicit, never implicit local time');

  // Midnight boundary: the period key flips exactly at local midnight.
  var justBefore = Date.parse('2026-06-15T21:59:00Z'); // 23:59 Paris (CEST)
  var justAfter = Date.parse('2026-06-15T22:01:00Z');  // 00:01 Paris next day
  ok(budget.periodKeyFor('DAY', 'Europe/Paris', justBefore) === '2026-06-15' &&
     budget.periodKeyFor('DAY', 'Europe/Paris', justAfter) === '2026-06-16',
    'period: the daily boundary flips at local midnight');

  // DST transition (Europe/Paris springs forward 2026-03-29 02:00 → 03:00).
  var dstBefore = Date.parse('2026-03-29T00:30:00Z'); // 01:30 CET
  var dstAfter = Date.parse('2026-03-29T01:30:00Z');  // 03:30 CEST
  ok(budget.periodKeyFor('DAY', 'Europe/Paris', dstBefore) === '2026-03-29' &&
     budget.periodKeyFor('DAY', 'Europe/Paris', dstAfter) === '2026-03-29',
    'DST: a spring-forward transition stays inside the same budget day');

  // A new period starts fresh; the old one keeps its history.
  var tomorrow = Date.now() + 24 * 3600 * 1000;
  var freshDay = budget.status('sandbox', { config: CFG, at: tomorrow });
  ok(freshDay.spent === 0 && freshDay.remaining === 10,
    'period: the next day starts with the full limit (period reset)');
  ok(budget.status('sandbox', { config: CFG }).spent === 3,
    'period: today\'s ledger is untouched by reading another period');
})();

// ------------------------------- 15-16/18. provider independence + separation
(function () {
  // A different provider/agent CANNOT create new budget: identity is the
  // configured scope (project + period), never the actor.
  var CFG3 = JSON.parse(JSON.stringify(CFG));
  CFG3.projects.switching = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 5 };
  var claude = budget.reserve(R({ project: 'switching', amount: 5, reservation_id: 'sw-claude',
    provider: 'claude-code', agent: 'claude-code', config: CFG3 }));
  var gemini = budget.reserve(R({ project: 'switching', amount: 5, reservation_id: 'sw-gemini',
    provider: 'gemini', agent: 'gemini-advisor', config: CFG3 }));
  ok(claude.decision === 'allow' && gemini.decision === 'deny',
    'provider independence: switching provider cannot bypass the project budget');
  var openai = budget.reserve(R({ project: 'switching', amount: 5, reservation_id: 'sw-openai',
    provider: 'openai-compat', agent: 'omniroute-advisory', config: CFG3 }));
  ok(openai.decision === 'deny',
    'provider independence: a third provider is equally bounded');
  var hist = budget.history('switching', { config: CFG3 });
  ok(hist.length === 1 && hist[0].provider === 'claude-code',
    'provider independence: provider/agent are recorded as labels only');

  // Retry cannot bypass: a NEW reservation id for the same work still
  // faces the same remaining budget.
  var retry = budget.reserve(R({ project: 'switching', amount: 5, reservation_id: 'sw-claude-retry2',
    provider: 'claude-code', config: CFG3 }));
  ok(retry.decision === 'deny', 'retry: a retried attempt cannot exceed the budget');

  // Unknown cost is never zero.
  var unknown = budget.reserve(R({ project: 'sandbox', amount: NaN, reservation_id: 'sw-unknown' }));
  ok(unknown.decision === 'deny' && /unknown cost is never treated as zero/.test(unknown.reason),
    'cost basis: unknown cost is refused, never silently zero');
  var badBasis = budget.reserve({ project: 'sandbox', amount: 1, reservation_id: 'sw-basis',
    cost_basis: 'guess', config: CFG });
  ok(badBasis.decision === 'deny' && /cost_basis/.test(badBasis.reason),
    'cost basis: only known|estimated are spendable');
})();

// --------------------------------------------------------- 17/23. policy layer
(function () {
  // Policy + ledger together: the STRICTER boundary wins.
  var engine = policyEngine.createEngine({
    policy_id: 'budget-test-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 5 }
  }, { ledger: { check: function (req) { return budget.check(Object.assign({ config: CFG }, req)); } } });

  // sandbox: limit 10, spent 3 → remaining 7. A 5 USD request passes both.
  var okDec = engine.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 5, project: 'sandbox' });
  ok(okDec.decision === 'allow' && /cumulative/.test(okDec.reason),
    'policy: within per-request AND cumulative → allow, both stated');

  // A per-request-legal amount that the cumulative budget cannot afford.
  var CFG4 = JSON.parse(JSON.stringify(CFG));
  CFG4.projects.tight = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 3 };
  var tightEngine = policyEngine.createEngine({
    policy_id: 'budget-test-v2',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 5 }
  }, { ledger: { check: function (req) { return budget.check(Object.assign({ config: CFG4 }, req)); } } });
  var strict = tightEngine.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 5, project: 'tight' });
  ok(strict.decision === 'deny' && /CUMULATIVE BUDGET/.test(strict.reason),
    'policy: per-request passes but cumulative fails → the stricter boundary wins');
  ok(strict.budget && strict.budget.limit === 3,
    'policy: the decision carries the budget snapshot');

  // A ledger failure fails CLOSED.
  var brokenEngine = policyEngine.createEngine({
    policy_id: 'budget-test-v3',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 5 }
  }, { ledger: { check: function () { throw new Error('ledger exploded'); } } });
  var closed = brokenEngine.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 1, project: 'sandbox' });
  ok(closed.decision === 'deny' && /fails closed/.test(closed.reason),
    'policy: an unavailable ledger denies spending (fails closed)');

  // QUOTA IS NOT BUDGET: quota availability never implies spend authority.
  var quota = require(path.join(EXEC, 'lib', 'quota'));
  ok(typeof quota.classifyFailure === 'function' &&
     tightEngine.checkPolicy({ action_class: 'MONEY_SPEND', amount_usd: 5, project: 'tight' }).decision === 'deny',
    'quota≠budget: provider quota being available does not grant spend authority');
})();

// ------------------------------------------- 19/21/22. multi-mission + events
(function () {
  var CFG5 = JSON.parse(JSON.stringify(CFG));
  CFG5.projects.campaign = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };
  // Mission A $5, Mission B $3 → remaining $2, so a further $5 must fail.
  var mA = budget.reserve(R({ project: 'campaign', amount: 5, reservation_id: 'mission-a', config: CFG5,
    mission_id: 'm-aaa', task_id: 'tk-aaa' }));
  budget.settle({ project: 'campaign', reservation_id: 'mission-a', config: CFG5 });
  var mB = budget.reserve(R({ project: 'campaign', amount: 3, reservation_id: 'mission-b', config: CFG5,
    mission_id: 'm-bbb', task_id: 'tk-bbb' }));
  budget.settle({ project: 'campaign', reservation_id: 'mission-b', config: CFG5 });
  var mC = budget.reserve(R({ project: 'campaign', amount: 5, reservation_id: 'mission-c', config: CFG5,
    mission_id: 'm-ccc' }));
  ok(mA.decision === 'allow' && mB.decision === 'allow' && mC.decision === 'deny',
    'multi-mission: cumulative spend across missions is enforced ($5 + $3, then $5 denied)');
  var st = budget.status('campaign', { config: CFG5 });
  ok(st.spent === 8 && st.remaining === 2,
    'multi-mission: remaining reflects the sum of all missions');

  // Report surface exposes the decision trail.
  var hist = budget.history('campaign', { config: CFG5 });
  ok(hist.length === 2 && hist.every(function (h) { return h.status === 'SETTLED'; }),
    'report: history exposes settled entries with mission/task labels');
  ok(hist[0].mission_id === 'm-aaa' && hist[0].settled_amount === 5,
    'report: entries carry mission id and settled amount');

  // Durable events.
  var events = store.readEvents();
  var types = {};
  events.forEach(function (e) { types[e.event_type] = (types[e.event_type] || 0) + 1; });
  ['BUDGET_RESERVED', 'BUDGET_SETTLED', 'BUDGET_RELEASED', 'BUDGET_DENIED',
    'BUDGET_APPROVAL_REQUIRED', 'BUDGET_CHECKED'].forEach(function (t) {
    ok(types[t] > 0, 'events: ' + t + ' emitted durably');
  });
  var withSecrets = events.filter(function (e) {
    return /sk-ant-|ghp_|Bearer /.test(JSON.stringify(e));
  });
  ok(withSecrets.length === 0, 'events: no secrets in the budget event stream');
})();

// --------------------------------------- scheduler integration (reserve→settle)
var chain = Promise.resolve();
chain = chain.then(function () {
  var scheduler = require(path.join(EXEC, 'core', 'scheduler'));
  var planner = require(path.join(EXEC, 'core', 'planner'));

  var CFG6 = JSON.parse(JSON.stringify(CFG));
  CFG6.projects['sched-budget'] = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };
  var ledgerShim = {
    check: function (req) { return budget.check(Object.assign({ config: CFG6 }, req)); },
    reserve: function (req) { return budget.reserve(Object.assign({ config: CFG6 }, req)); },
    settle: function (req) { return budget.settle(Object.assign({ config: CFG6 }, req)); },
    release: function (req) { return budget.release(Object.assign({ config: CFG6 }, req)); },
    reservationIdFor: budget.reservationIdFor
  };
  var engine = policyEngine.createEngine({
    policy_id: 'sched-budget-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 10 }
  }, { ledger: ledgerShim });

  function spendMission(key, amount) {
    var goal = domain.createGoal({ text: 'spend probe ' + key, project: 'sched-budget' });
    store.create(goal);
    var plan = planner.planFromSpec(goal, {
      title: 'spend ' + key,
      tasks: [{ key: key, title: 'spend ' + amount, task_type: 'marketing',
        capabilities_required: ['marketing_campaign'],
        policy_classes: ['EXTERNAL_API', 'MONEY_SPEND'], budget_usd: amount, depends_on: [] }]
    });
    var p = planner.persistPlan(plan);
    store.transition('mission', p.mission.id, 'VALIDATED');
    return p;
  }

  // Mission A spends 6 (settles at 5, the real cost).
  var a = spendMission('spend-a', 6);
  return scheduler.runMission(a.mission.id, {
    policy: engine, review: false,
    runner: function () {
      return Promise.resolve({ status: 'COMPLETED',
        result: { status: 'completed', summary: 'sandbox spend', actual_cost_usd: 5 } });
    }
  }).then(function (m) {
    var t = store.load('task', a.tasks[0].id);
    ok(m.status === 'COMPLETED' && t.metadata.budget_reservation_id,
      'scheduler: a MONEY_SPEND task reserves before running');
    ok(t.metadata.budget_settlement && t.metadata.budget_settlement.amount === 5,
      'scheduler: the ACTUAL cost is settled, not the reservation');
    var st = budget.status('sched-budget', { config: CFG6 });
    ok(st.spent === 5 && st.reserved === 0 && st.remaining === 5,
      'scheduler: ledger reflects settled spend after the mission');

    // Mission B wants 6 but only 5 remains → denied before execution.
    var b = spendMission('spend-b', 6);
    var ran = 0;
    return scheduler.runMission(b.mission.id, {
      policy: engine, review: false,
      runner: function () { ran += 1; return Promise.resolve({ status: 'COMPLETED' }); }
    }).then(function (m2) {
      var t2 = store.load('task', b.tasks[0].id);
      ok(ran === 0 && ['CANCELLED', 'WAITING_FOR_APPROVAL'].indexOf(t2.status) !== -1,
        'scheduler: an unaffordable spend never executes');
      ok(/CUMULATIVE BUDGET|exceeds remaining/.test(
        String(t2.metadata.policy_denied || t2.metadata.approval_reason)),
        'scheduler: the refusal names the cumulative budget');
      ok(budget.status('sched-budget', { config: CFG6 }).spent === 5,
        'scheduler: a refused mission changes no spend');
    });
  }).then(function () {
    // Failure path releases the hold.
    var c = spendMission('spend-c', 4);
    return scheduler.runMission(c.mission.id, {
      policy: engine, review: false,
      runner: function () { return Promise.resolve({ status: 'FAILED', error: 'provider blew up' }); }
    }).then(function () {
      var st = budget.status('sched-budget', { config: CFG6 });
      ok(st.reserved === 0 && st.spent === 5,
        'scheduler: a failed spending task RELEASES its reservation (money not consumed)');
      var t3 = store.load('task', c.tasks[0].id);
      ok(t3.metadata.budget_settlement && t3.metadata.budget_settlement.settled === false,
        'scheduler: the release is recorded on the task for the report');
    });
  });
});

// ------------------------------ independent-review findings (regression tests)
chain = chain.then(function () {
  // FINDING (CRITICAL/race, deepseek + gpt-4o): a LIVE holder's lock must
  // never be broken on age alone.
  var CFG7 = JSON.parse(JSON.stringify(CFG));
  CFG7.projects.locked = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };
  var lockFile = budget.ledgerFile('locked', 'DAY', budget.periodKeyFor('DAY', 'Europe/Paris')) + '.lock';
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  // A lock held by a LIVE process (this one's parent is alive by
  // definition) and deliberately aged well beyond the stale window.
  fs.writeFileSync(lockFile, String(process.ppid));
  var old = Date.now() - 3600 * 1000;
  fs.utimesSync(lockFile, new Date(old), new Date(old));
  var start = Date.now();
  var blocked = budget.reserve(R({ project: 'locked', amount: 1, reservation_id: 'lock-probe', config: CFG7 }));
  var waited = Date.now() - start;
  ok(blocked.decision === 'deny' && /BUDGET_LOCK_TIMEOUT|ledger unavailable/.test(String(blocked.reason || '')),
    'review/race: a live holder\'s stale-aged lock is NOT stolen — the request fails closed instead');
  ok(waited >= 1000, 'review/race: the waiter genuinely waited on the live lock (' + waited + 'ms)');
  ok(budget.status('locked', { config: CFG7 }).reserved === 0,
    'review/race: the blocked request reserved nothing');
  fs.unlinkSync(lockFile);

  // A lock whose holder is genuinely gone IS broken.
  fs.writeFileSync(lockFile, '999999983');
  var afterDead = budget.reserve(R({ project: 'locked', amount: 1, reservation_id: 'lock-probe-2', config: CFG7 }));
  ok(afterDead.decision === 'allow',
    'review/race: a dead holder\'s lock is broken so the ledger never deadlocks');

  // FINDING (HIGH/idempotency, deepseek): no unevidenced upgrade to 'known'.
  budget.reserve(R({ project: 'locked', amount: 2, reservation_id: 'basis-probe', config: CFG7 }));
  budget.settle({ project: 'locked', reservation_id: 'basis-probe', cost_basis: 'known', config: CFG7 });
  var basisHist = budget.history('locked', { config: CFG7 }).filter(function (e) { return e.id === 'basis-probe'; })[0];
  ok(basisHist.cost_basis === 'estimated',
    'review/basis: settling without an actual figure cannot relabel an estimate as known');
  budget.reserve(R({ project: 'locked', amount: 2, reservation_id: 'basis-probe-2', config: CFG7 }));
  budget.settle({ project: 'locked', reservation_id: 'basis-probe-2', cost_basis: 'known',
    actual_amount: 2, config: CFG7 });
  var basisHist2 = budget.history('locked', { config: CFG7 }).filter(function (e) { return e.id === 'basis-probe-2'; })[0];
  ok(basisHist2.cost_basis === 'known',
    'review/basis: an actual figure DOES justify the known basis');
});

chain = chain.then(function () {
  // FINDING (gemini): a reservation leaked by a crashed attempt must not
  // shrink the budget forever — the next attempt supersedes it.
  var scheduler = require(path.join(EXEC, 'core', 'scheduler'));
  var planner = require(path.join(EXEC, 'core', 'planner'));
  var CFG8 = JSON.parse(JSON.stringify(CFG));
  CFG8.projects.leak = { currency: 'USD', timezone: 'Europe/Paris', daily_limit: 10 };
  var ledgerShim = {
    check: function (r) { return budget.check(Object.assign({ config: CFG8 }, r)); },
    reserve: function (r) { return budget.reserve(Object.assign({ config: CFG8 }, r)); },
    settle: function (r) { return budget.settle(Object.assign({ config: CFG8 }, r)); },
    release: function (r) { return budget.release(Object.assign({ config: CFG8 }, r)); },
    reservationIdFor: budget.reservationIdFor
  };
  var engine = policyEngine.createEngine({
    policy_id: 'leak-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 10 }
  }, { ledger: ledgerShim });

  var goal = domain.createGoal({ text: 'leak probe', project: 'leak' });
  store.create(goal);
  var plan = planner.planFromSpec(goal, {
    title: 'leak', tasks: [{ key: 'spend', title: 'spend 6', task_type: 'marketing',
      capabilities_required: ['marketing_campaign'], policy_classes: ['MONEY_SPEND'],
      budget_usd: 6, max_attempts: 3, depends_on: [] }]
  });
  var p = planner.persistPlan(plan);
  store.transition('mission', p.mission.id, 'VALIDATED');

  // Simulate a crashed attempt: reserve under the id attempt 1 would use,
  // then leave it RESERVED (no settle, no release).
  var leakedId = budget.reservationIdFor(p.tasks[0].id, 1, 'spend');
  budget.reserve({ project: 'leak', amount: 6, reservation_id: leakedId,
    cost_basis: 'estimated', config: CFG8 });
  var t0 = store.load('task', p.tasks[0].id);
  t0.metadata.budget_reservation_id = leakedId;
  t0.attempt = 1;
  store.save(t0);
  ok(budget.status('leak', { config: CFG8 }).reserved === 6,
    'review/leak: a crashed attempt leaves its reservation held');

  return scheduler.runMission(p.mission.id, {
    policy: engine, review: false,
    runner: function () {
      return Promise.resolve({ status: 'COMPLETED',
        result: { status: 'completed', summary: 'retry after crash', actual_cost_usd: 6 } });
    }
  }).then(function (m) {
    var st = budget.status('leak', { config: CFG8 });
    ok(m.status === 'COMPLETED',
      'review/leak: the retry succeeds instead of being denied by its own leaked hold');
    ok(st.spent === 6 && st.reserved === 0,
      'review/leak: exactly one spend is counted (' + st.spent + ' spent, ' + st.reserved + ' held)');
  });
});

chain = chain.then(function () {
  // FINDING (MEDIUM/policy, gpt-4o): an unusable ledger must fail closed
  // at the scheduler, not crash the mission.
  var scheduler = require(path.join(EXEC, 'core', 'scheduler'));
  var planner = require(path.join(EXEC, 'core', 'planner'));
  var brokenLedger = {
    check: function () { return { affordable: false, budget: { limit: 0, spent: 0, reserved: 0, remaining: 0 }, reason: 'ledger down' }; },
    reserve: function () { throw new Error('ledger config missing'); },
    settle: function () { throw new Error('ledger config missing'); },
    release: function () { throw new Error('ledger config missing'); },
    reservationIdFor: budget.reservationIdFor
  };
  var engine = policyEngine.createEngine({
    policy_id: 'broken-v1',
    classes: { READ: 'allow', PROJECT_WRITE: 'allow', GIT: 'allow', SERVICE: 'require_approval',
      DEPLOY: 'require_approval', ROOT: 'deny', EXTERNAL_API: 'allow', DESTRUCTIVE: 'deny' },
    money_spend: { enabled: true, daily_limit_usd: 10 }
  }, { ledger: brokenLedger });
  var goal = domain.createGoal({ text: 'broken ledger probe', project: 'broken' });
  store.create(goal);
  var plan = planner.planFromSpec(goal, {
    title: 'broken', tasks: [{ key: 'spend', title: 'spend', task_type: 'marketing',
      capabilities_required: ['marketing_campaign'], policy_classes: ['MONEY_SPEND'],
      budget_usd: 1, depends_on: [] }]
  });
  var p = planner.persistPlan(plan);
  store.transition('mission', p.mission.id, 'VALIDATED');
  var ran = 0;
  return scheduler.runMission(p.mission.id, {
    policy: engine, review: false,
    runner: function () { ran += 1; return Promise.resolve({ status: 'COMPLETED' }); }
  }).then(function (m) {
    var t = store.load('task', p.tasks[0].id);
    ok(ran === 0 && t.status === 'CANCELLED',
      'review/policy: a throwing ledger fails closed (no execution, no crash)');
    ok(/ledger unavailable|CUMULATIVE BUDGET|ledger down/.test(
      String(t.metadata.policy_denied || '')),
      'review/policy: the refusal reason names the ledger problem');
  });
});

// ------------------------------------------------------------ CLI (read-only)
chain = chain.then(function () {
  var bin = path.join(EXEC, 'bin', 'mythos-ai-executor');
  var out = cp.execFileSync(process.execPath, [bin, 'budget', 'status', 'sandbox'],
    { encoding: 'utf8', env: process.env });
  var st = JSON.parse(out);
  ok(st.project === 'sandbox' && typeof st.remaining === 'number',
    'cli: budget status reports the live ledger');
  out = cp.execFileSync(process.execPath, [bin, 'budget', 'history', 'sandbox'],
    { encoding: 'utf8', env: process.env });
  ok(Array.isArray(JSON.parse(out).entries), 'cli: budget history lists entries');
  var mutating = false;
  try {
    cp.execFileSync(process.execPath, [bin, 'budget', 'set', 'sandbox', '999'],
      { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    mutating = true;
  } catch (e) { /* expected: no mutation verb exists */ }
  ok(!mutating, 'cli: there is NO budget mutation verb (limits change only in committed config)');
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
