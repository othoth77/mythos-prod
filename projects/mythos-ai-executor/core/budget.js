'use strict';
// =====================================================
// Mythos Orchestration Core — cumulative budget ledger
// projects/mythos-ai-executor/core/budget.js
//
// Closes the gap the first production mission found: the policy engine
// could enforce a PER-REQUEST spend threshold but kept no cumulative
// total, so N requests of the limit each would all pass.
//
//   REQUEST → policy → ledger (reserve) → execute → settle/release
//
// Design rules, all load-bearing:
//
//   * RESERVE-THEN-SETTLE. A reservation is taken BEFORE the spending
//     action and settled (or released) after, so two parallel tasks can
//     never both see the same "remaining".
//   * ATOMIC under concurrency without a new database: every mutation
//     happens inside an exclusive lock taken with O_EXCL create
//     (fs.openSync 'wx'), which is atomic on POSIX. Stale locks (dead
//     holder) are broken deterministically; the ledger file itself is
//     written tmp+rename like the rest of the store.
//   * IDEMPOTENT. Reservations, settlements and releases are keyed by a
//     caller-supplied stable id; replaying an operation never
//     double-counts.
//   * PROVIDER-INDEPENDENT. The ledger records provider/agent/tool as
//     labels only; no provider is special, and switching provider or
//     agent cannot create new budget because identity is the configured
//     SCOPE (project + period), never the actor.
//   * UNKNOWN COST IS NEVER ZERO. A spend request must carry a numeric
//     amount with a cost basis (known/estimated); unknown is refused.
//   * QUOTA ≠ BUDGET. This module knows nothing about provider quota.
//
// Persistence (beside the rest of the orchestration state, never /tmp):
//   <orchestration root>/budgets/<project>__<scope>__<period>.json
// =====================================================

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var store = require('./store');

var CONFIG_PATH = path.join(__dirname, '..', 'config', 'budgets.json');

var SCOPES = ['DAY', 'PROJECT', 'MISSION', 'REQUEST'];
var COST_BASIS = ['known', 'estimated'];   // 'unknown' is deliberately NOT spendable
var ENTRY_STATES = ['RESERVED', 'SETTLED', 'RELEASED'];

var LOCK_STALE_MS = 30000;
var LOCK_WAIT_MS = 5000;

// --- Configuration -------------------------------------------------------------

function loadConfig(injected) {
  return injected || JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

// A project with no configured budget has NO budget (limit 0): spending
// authority is granted explicitly in committed config, never by default.
function projectBudget(project, injectedConfig) {
  var cfg = loadConfig(injectedConfig);
  var defaults = cfg.defaults || {};
  var p = (cfg.projects || {})[project];
  return {
    project: project,
    configured: !!p,
    currency: (p && p.currency) || defaults.currency || 'USD',
    timezone: (p && p.timezone) || defaults.timezone || 'UTC',
    daily_limit: p && typeof p.daily_limit === 'number' ? p.daily_limit
      : (typeof defaults.daily_limit === 'number' ? defaults.daily_limit : 0)
  };
}

// --- Period computation (timezone-explicit, never implicit local time) ----------

// Returns the calendar date in the configured zone as YYYY-MM-DD. Uses
// Intl with an explicit timeZone so the boundary is deterministic
// regardless of the server's own timezone, and DST-correct because the
// zone's own rules decide when the date flips.
function periodKeyFor(scope, timezone, atMs) {
  var when = new Date(atMs === undefined ? Date.now() : atMs);
  if (scope === 'DAY') {
    var parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(when);
    return parts; // en-CA yields YYYY-MM-DD
  }
  if (scope === 'PROJECT') return 'all-time';
  throw new Error('UNSUPPORTED_BUDGET_SCOPE: ' + String(scope));
}

// --- Paths and locking ------------------------------------------------------------

function budgetsRoot() { return path.join(store.root(), 'budgets'); }

var SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function ledgerFile(project, scope, periodKey) {
  if (!SAFE.test(String(project)) || !SAFE.test(String(periodKey)) || SCOPES.indexOf(scope) === -1) {
    throw new Error('INVALID_LEDGER_IDENTITY: ' +
      JSON.stringify({ project: String(project).slice(0, 40), scope: scope, period: String(periodKey).slice(0, 40) }));
  }
  var file = path.join(budgetsRoot(), project + '__' + scope + '__' + periodKey + '.json');
  if (path.dirname(path.resolve(file)) !== path.resolve(budgetsRoot())) {
    throw new Error('LEDGER_PATH_ESCAPE');
  }
  return file;
}

// Exclusive lock via atomic O_EXCL create. Returns a release function.
function withLock(file, fn) {
  var lock = file + '.lock';
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  var deadline = Date.now() + LOCK_WAIT_MS;
  var fd = null;
  for (;;) {
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Break a stale lock ONLY when its holder is provably gone. A live
      // holder's lock is never broken on age alone: a slow or suspended
      // holder would otherwise have its lock stolen while it is still
      // mutating, letting two writers in at once (independent review,
      // CRITICAL/race). Age only decides the case where the holder pid
      // cannot be determined at all.
      var stale = false;
      try {
        var st = fs.statSync(lock);
        var holder = parseInt(fs.readFileSync(lock, 'utf8'), 10);
        if (!holder) {
          // Unreadable/incomplete lock file: fall back to age.
          stale = (Date.now() - st.mtimeMs > LOCK_STALE_MS);
        } else if (holder === process.pid) {
          stale = false; // our own lock: never self-break inside one process
        } else {
          var alive;
          try { process.kill(holder, 0); alive = true; } catch (k) { alive = (k.code === 'EPERM'); }
          stale = !alive;
        }
      } catch (e2) {
        stale = true; // lock vanished between calls
      }
      if (stale) {
        try { fs.unlinkSync(lock); } catch (e3) { /* someone else won the race */ }
        continue;
      }
      if (Date.now() > deadline) throw new Error('BUDGET_LOCK_TIMEOUT: ' + path.basename(lock));
      // Busy-wait briefly: mutations are sub-millisecond file writes.
      var spinUntil = Date.now() + 2;
      while (Date.now() < spinUntil) { /* spin */ }
    }
  }
  try {
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    fd = null;
    return fn();
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
    try { fs.unlinkSync(lock); } catch (e) { /* already released */ }
  }
}

// --- Ledger read/write ---------------------------------------------------------------

function emptyLedger(project, scope, periodKey, budget) {
  return {
    ledger_version: '1.0.0',
    project: project,
    scope: scope,
    period_key: periodKey,
    timezone: budget.timezone,
    currency: budget.currency,
    limit: budget.daily_limit,
    entries: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

function readLedgerRaw(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error('LEDGER_CORRUPT: ' + path.basename(file) + ' — refusing to spend against an unreadable ledger');
  }
}

function writeLedger(file, ledger) {
  ledger.updated_at = new Date().toISOString();
  var tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex');
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function totals(ledger) {
  var reserved = 0, spent = 0;
  Object.keys(ledger.entries).forEach(function (id) {
    var e = ledger.entries[id];
    if (e.status === 'RESERVED') reserved += e.amount;
    else if (e.status === 'SETTLED') spent += (typeof e.settled_amount === 'number' ? e.settled_amount : e.amount);
  });
  // Round to cents to keep float drift out of comparisons.
  reserved = Math.round(reserved * 100) / 100;
  spent = Math.round(spent * 100) / 100;
  return {
    limit: ledger.limit, reserved: reserved, spent: spent,
    remaining: Math.round((ledger.limit - reserved - spent) * 100) / 100,
    currency: ledger.currency
  };
}

// --- Public read model ----------------------------------------------------------------

function status(project, opts) {
  opts = opts || {};
  var budget = projectBudget(project, opts.config);
  var scope = opts.scope || 'DAY';
  var periodKey = opts.period_key || periodKeyFor(scope, budget.timezone, opts.at);
  var file = ledgerFile(project, scope, periodKey);
  var ledger = readLedgerRaw(file) || emptyLedger(project, scope, periodKey, budget);
  var t = totals(ledger);
  return {
    project: project, scope: scope, period_key: periodKey, timezone: ledger.timezone,
    currency: t.currency, limit: t.limit, reserved: t.reserved, spent: t.spent,
    remaining: t.remaining, configured: budget.configured,
    entry_count: Object.keys(ledger.entries).length
  };
}

function history(project, opts) {
  opts = opts || {};
  var budget = projectBudget(project, opts.config);
  var scope = opts.scope || 'DAY';
  var periodKey = opts.period_key || periodKeyFor(scope, budget.timezone, opts.at);
  var ledger = readLedgerRaw(ledgerFile(project, scope, periodKey));
  if (!ledger) return [];
  return Object.keys(ledger.entries).map(function (id) {
    var e = ledger.entries[id];
    return {
      id: id, status: e.status, amount: e.amount,
      settled_amount: e.settled_amount === undefined ? null : e.settled_amount,
      cost_basis: e.cost_basis, provider: e.provider, agent: e.agent, tool: e.tool,
      mission_id: e.mission_id, task_id: e.task_id,
      external_reference: e.external_reference || null,
      reserved_at: e.reserved_at, settled_at: e.settled_at || null, released_at: e.released_at || null
    };
  }).sort(function (a, b) { return String(a.reserved_at).localeCompare(String(b.reserved_at)); });
}

// --- Mutations (all atomic, all idempotent) -----------------------------------------------

function emitBudgetEvent(type, detail) {
  try {
    store.appendEventLine({ event_type: type, subject_id: detail.task_id || detail.mission_id || null,
      project: detail.project, detail: detail });
  } catch (e) { /* telemetry must never break a budget decision */ }
}

// Attempts to reserve `amount` for a spend. Returns
// { decision: 'allow'|'deny'|'require_approval', reservation_id?, budget: {...}, reason }
// The reservation is only created when the decision is 'allow'.
//
// req: { project, amount, reservation_id, cost_basis, provider?, agent?, tool?,
//        mission_id?, task_id?, allow_approval?, scope?, at?, config? }
function reserve(req) {
  req = req || {};
  var project = req.project;
  var scope = req.scope || 'DAY';
  var budget = projectBudget(project, req.config);
  var periodKey = req.period_key || periodKeyFor(scope, budget.timezone, req.at);

  if (!req.reservation_id || !SAFE.test(String(req.reservation_id))) {
    return { decision: 'deny', reason: 'reservation_id (stable, safe slug) is required for idempotency' };
  }
  // UNKNOWN cost never becomes zero: a spend must declare a real amount
  // with a basis of known|estimated.
  if (typeof req.amount !== 'number' || !isFinite(req.amount) || req.amount < 0) {
    return { decision: 'deny', reason: 'spend requires a finite non-negative amount; unknown cost is never treated as zero' };
  }
  if (COST_BASIS.indexOf(req.cost_basis) === -1) {
    return { decision: 'deny', reason: 'cost_basis must be one of ' + COST_BASIS.join('|') + ' (unknown cost is not spendable)' };
  }
  if (!budget.configured || !(budget.daily_limit > 0)) {
    var denyNoBudget = {
      decision: 'deny',
      reason: 'project "' + String(project).slice(0, 40) + '" has no configured spending budget (limit ' +
        budget.daily_limit + ' ' + budget.currency + ')',
      budget: status(project, { scope: scope, at: req.at, config: req.config })
    };
    emitBudgetEvent('BUDGET_DENIED', { project: project, amount: req.amount, task_id: req.task_id,
      mission_id: req.mission_id, reason: 'no configured budget' });
    return denyNoBudget;
  }

  var file = ledgerFile(project, scope, periodKey);
  // A ledger that cannot be locked or read must DENY, never throw into
  // the caller's control flow: spending fails closed (independent review).
  try {
  return withLock(file, function () {
    var ledger = readLedgerRaw(file) || emptyLedger(project, scope, periodKey, budget);
    // Config may have changed since the period started; the committed
    // config is authoritative for the limit.
    ledger.limit = budget.daily_limit;
    ledger.currency = budget.currency;
    ledger.timezone = budget.timezone;

    // Idempotency: replaying a reservation returns the existing one.
    var existing = ledger.entries[req.reservation_id];
    if (existing) {
      var t0 = totals(ledger);
      if (existing.status === 'RESERVED' || existing.status === 'SETTLED') {
        return { decision: 'allow', reservation_id: req.reservation_id, idempotent_replay: true,
          budget: Object.assign({ project: project, period_key: periodKey }, t0),
          reason: 'existing ' + existing.status.toLowerCase() + ' entry replayed; no double count' };
      }
      return { decision: 'deny', reservation_id: req.reservation_id,
        budget: Object.assign({ project: project, period_key: periodKey }, t0),
        reason: 'reservation ' + req.reservation_id + ' was already released' };
    }

    var t = totals(ledger);
    if (req.amount > t.remaining) {
      var over = {
        project: project, period_key: periodKey, requested: req.amount,
        limit: t.limit, reserved: t.reserved, spent: t.spent, remaining: t.remaining,
        currency: t.currency, mission_id: req.mission_id || null, task_id: req.task_id || null,
        provider: req.provider || null, agent: req.agent || null
      };
      if (req.allow_approval) {
        emitBudgetEvent('BUDGET_APPROVAL_REQUIRED', over);
        return { decision: 'require_approval',
          reason: 'requested ' + req.amount + ' ' + t.currency + ' exceeds remaining ' + t.remaining +
            ' (limit ' + t.limit + ', reserved ' + t.reserved + ', spent ' + t.spent + ')',
          budget: Object.assign({ project: project, period_key: periodKey }, t) };
      }
      emitBudgetEvent('BUDGET_DENIED', over);
      return { decision: 'deny',
        reason: 'requested ' + req.amount + ' ' + t.currency + ' exceeds remaining ' + t.remaining +
          ' (limit ' + t.limit + ', reserved ' + t.reserved + ', spent ' + t.spent + ')',
        budget: Object.assign({ project: project, period_key: periodKey }, t) };
    }

    ledger.entries[req.reservation_id] = {
      status: 'RESERVED', amount: Math.round(req.amount * 100) / 100,
      cost_basis: req.cost_basis,
      provider: req.provider || null, agent: req.agent || null, tool: req.tool || null,
      mission_id: req.mission_id || null, task_id: req.task_id || null,
      reserved_at: new Date().toISOString()
    };
    writeLedger(file, ledger);
    var after = totals(ledger);
    emitBudgetEvent('BUDGET_RESERVED', {
      project: project, period_key: periodKey, reservation_id: req.reservation_id,
      amount: req.amount, remaining: after.remaining, task_id: req.task_id || null,
      mission_id: req.mission_id || null, provider: req.provider || null
    });
    return { decision: 'allow', reservation_id: req.reservation_id,
      budget: Object.assign({ project: project, period_key: periodKey }, after),
      reason: 'reserved ' + req.amount + ' ' + after.currency + '; remaining ' + after.remaining };
  });
  } catch (e) {
    emitBudgetEvent('BUDGET_DENIED', { project: project, amount: req.amount,
      task_id: req.task_id, reason: 'ledger unavailable' });
    return { decision: 'deny', reason: 'ledger unavailable: ' + String(e.message).slice(0, 160) };
  }
}

// Settles a reservation into spent. Idempotent: settling twice counts once.
// actual_amount may differ from the reservation (final cost); it may never
// exceed limit-minus-others (a settlement above the reservation is capped
// and reported, never silently overspent).
function settle(req) {
  req = req || {};
  var scope = req.scope || 'DAY';
  var budget = projectBudget(req.project, req.config);
  var periodKey = req.period_key || periodKeyFor(scope, budget.timezone, req.at);
  var file = ledgerFile(req.project, scope, periodKey);
  try {
  return withLock(file, function () {
    var ledger = readLedgerRaw(file);
    if (!ledger || !ledger.entries[req.reservation_id]) {
      return { ok: false, reason: 'NO_SUCH_RESERVATION: ' + String(req.reservation_id).slice(0, 60) };
    }
    var entry = ledger.entries[req.reservation_id];
    if (entry.status === 'SETTLED') {
      return { ok: true, idempotent_replay: true, reason: 'already settled; not counted twice',
        budget: Object.assign({ project: req.project, period_key: periodKey }, totals(ledger)) };
    }
    if (entry.status === 'RELEASED') {
      return { ok: false, reason: 'RESERVATION_RELEASED: cannot settle a released reservation' };
    }
    var actual = typeof req.actual_amount === 'number' && isFinite(req.actual_amount) && req.actual_amount >= 0
      ? Math.round(req.actual_amount * 100) / 100 : entry.amount;
    // Cap an over-settlement at what the budget can still absorb, and say so.
    var capped = false;
    var otherTotals = totals({ limit: ledger.limit, currency: ledger.currency, entries:
      Object.keys(ledger.entries).reduce(function (acc, k) {
        if (k !== req.reservation_id) acc[k] = ledger.entries[k];
        return acc;
      }, {}) });
    var headroom = Math.round((ledger.limit - otherTotals.reserved - otherTotals.spent) * 100) / 100;
    if (actual > headroom) { actual = headroom; capped = true; }

    entry.status = 'SETTLED';
    entry.settled_amount = actual;
    entry.settled_at = new Date().toISOString();
    if (req.external_reference) entry.external_reference = String(req.external_reference).slice(0, 200);
    // A cost basis may only be upgraded to 'known' when an actual figure
    // was supplied with the settlement — otherwise an estimate could be
    // relabelled as certain with no evidence (independent review).
    if (req.cost_basis && COST_BASIS.indexOf(req.cost_basis) !== -1) {
      var upgradingToKnown = req.cost_basis === 'known' && entry.cost_basis !== 'known';
      if (!upgradingToKnown || typeof req.actual_amount === 'number') entry.cost_basis = req.cost_basis;
    }
    writeLedger(file, ledger);
    var after = totals(ledger);
    emitBudgetEvent('BUDGET_SETTLED', {
      project: req.project, period_key: periodKey, reservation_id: req.reservation_id,
      settled: actual, capped: capped, spent: after.spent, remaining: after.remaining,
      task_id: entry.task_id, mission_id: entry.mission_id, provider: entry.provider
    });
    return { ok: true, settled_amount: actual, capped: capped,
      budget: Object.assign({ project: req.project, period_key: periodKey }, after) };
  });
  } catch (e) {
    return { ok: false, reason: 'ledger unavailable: ' + String(e.message).slice(0, 160) };
  }
}

// Releases an unsettled reservation (execution failed / task cancelled).
// Idempotent; a settled reservation is never silently un-spent.
function release(req) {
  req = req || {};
  var scope = req.scope || 'DAY';
  var budget = projectBudget(req.project, req.config);
  var periodKey = req.period_key || periodKeyFor(scope, budget.timezone, req.at);
  var file = ledgerFile(req.project, scope, periodKey);
  try {
  return withLock(file, function () {
    var ledger = readLedgerRaw(file);
    if (!ledger || !ledger.entries[req.reservation_id]) {
      return { ok: false, reason: 'NO_SUCH_RESERVATION: ' + String(req.reservation_id).slice(0, 60) };
    }
    var entry = ledger.entries[req.reservation_id];
    if (entry.status === 'RELEASED') {
      return { ok: true, idempotent_replay: true, reason: 'already released',
        budget: Object.assign({ project: req.project, period_key: periodKey }, totals(ledger)) };
    }
    if (entry.status === 'SETTLED') {
      return { ok: false, reason: 'ALREADY_SETTLED: a settled spend is never released' };
    }
    entry.status = 'RELEASED';
    entry.released_at = new Date().toISOString();
    entry.release_reason = String(req.reason || 'unspecified').slice(0, 200);
    writeLedger(file, ledger);
    var after = totals(ledger);
    emitBudgetEvent('BUDGET_RELEASED', {
      project: req.project, period_key: periodKey, reservation_id: req.reservation_id,
      amount: entry.amount, remaining: after.remaining, task_id: entry.task_id
    });
    return { ok: true, budget: Object.assign({ project: req.project, period_key: periodKey }, after) };
  });
  } catch (e) {
    return { ok: false, reason: 'ledger unavailable: ' + String(e.message).slice(0, 160) };
  }
}

// Read-only affordability check (no reservation). Used by the policy
// engine so a decision can be explained before anything is held.
function check(req) {
  req = req || {};
  var scope = req.scope || 'DAY';
  var budget = projectBudget(req.project, req.config);
  var st = status(req.project, { scope: scope, at: req.at, config: req.config });

  // A task that ALREADY holds a reservation for this spend must not be
  // blocked by its own hold when its tools are granted — otherwise a task
  // reserves, then fails its own affordability check, fails, retries, and
  // is denied against the budget it itself is holding. Its own hold is
  // added back for this comparison only; the ledger is not modified.
  var ownHold = 0;
  if (req.exclude_reservation_id) {
    try {
      var periodKey = req.period_key || periodKeyFor(scope, budget.timezone, req.at);
      var ledger = readLedgerRaw(ledgerFile(req.project, scope, periodKey));
      var own = ledger && ledger.entries[req.exclude_reservation_id];
      if (own && own.status === 'RESERVED') ownHold = own.amount;
    } catch (e) { ownHold = 0; }
  }
  var effectiveRemaining = Math.round((st.remaining + ownHold) * 100) / 100;
  var affordable = budget.configured && budget.daily_limit > 0 &&
    typeof req.amount === 'number' && req.amount >= 0 && req.amount <= effectiveRemaining;
  emitBudgetEvent('BUDGET_CHECKED', {
    project: req.project, period_key: st.period_key, amount: req.amount,
    remaining: st.remaining, affordable: affordable, task_id: req.task_id || null
  });
  return { affordable: affordable, budget: st, own_hold: ownHold,
    reason: !budget.configured || !(budget.daily_limit > 0)
      ? 'no configured budget for project "' + String(req.project).slice(0, 40) + '"'
      : (affordable
        ? 'within remaining budget' + (ownHold ? ' (including this task\'s own reservation of ' + ownHold + ')' : '')
        : 'requested ' + req.amount + ' ' + st.currency + ' exceeds remaining ' + effectiveRemaining) };
}

// Deterministic reservation id for a task attempt: stable across retries
// of the SAME attempt (idempotent) but distinct per attempt.
function reservationIdFor(taskId, attempt, label) {
  return 'rsv-' + String(taskId).replace(/[^A-Za-z0-9]/g, '') + '-' + (attempt || 1) +
    (label ? '-' + String(label).replace(/[^A-Za-z0-9]/g, '').slice(0, 20) : '');
}

module.exports = {
  SCOPES: SCOPES,
  COST_BASIS: COST_BASIS,
  ENTRY_STATES: ENTRY_STATES,
  CONFIG_PATH: CONFIG_PATH,
  projectBudget: projectBudget,
  periodKeyFor: periodKeyFor,
  budgetsRoot: budgetsRoot,
  ledgerFile: ledgerFile,
  status: status,
  history: history,
  check: check,
  reserve: reserve,
  settle: settle,
  release: release,
  reservationIdFor: reservationIdFor,
  withLock: withLock
};
