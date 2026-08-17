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
// A reservation held this long without settling or releasing is reported
// as stale (observability only — never auto-released).
var STALE_RESERVATION_MS = 6 * 60 * 60 * 1000;

// --- Reservation leases -------------------------------------------------------
// A reservation is held under a LEASE: a persisted expiry plus the identity
// of the holder. A crashed holder's lease expires and the budget is
// recovered deterministically, with no memory-only timers and no manual
// step. A LIVE holder is never stolen from — recovery is fail-safe.
var LEASE_MS = 15 * 60 * 1000;              // default lease granted on reserve
var LEASE_GRACE_MS = 2 * 60 * 1000;         // slack past expiry before recovery
var UNVERIFIABLE_HOLDER_GRACE_MS = 60 * 60 * 1000; // holder we cannot probe (other host)
var LEASE_STATES = ['ACTIVE', 'EXPIRED', 'RELEASED', 'SETTLED', 'RECOVERED'];
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
      : (typeof defaults.daily_limit === 'number' ? defaults.daily_limit : 0),
    // REQUEST scope: the maximum a SINGLE spend request may be.
    request_limit: p && typeof p.request_limit === 'number' ? p.request_limit
      : (typeof defaults.request_limit === 'number' ? defaults.request_limit : 0),
    // MISSION scope: the maximum cumulative spend of ONE mission.
    mission_limit: p && typeof p.mission_limit === 'number' ? p.mission_limit
      : (typeof defaults.mission_limit === 'number' ? defaults.mission_limit : 0)
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
  // MISSION ledgers are keyed by the mission id itself: one mission is one
  // period, independent of clock time, provider, agent, retry or process.
  if (scope === 'MISSION') throw new Error('MISSION_SCOPE_NEEDS_EXPLICIT_PERIOD_KEY (the mission id)');
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

// Holder identity: host + pid + the process's own start time. The start
// time makes the identity immune to PID reuse — a new process that happens
// to get the dead holder's pid does not look like the dead holder.
// Reads /proc/<pid>/stat once: the fields after the final ')' start at
// field 3 (state), so index 0 is state and index 19 is starttime (22).
function procStat(pid) {
  try {
    var stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    var after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { state: after[0] || null, starttime: after[19] || null };
  } catch (e) {
    return null;
  }
}

function processStartTicks(pid) {
  var st = procStat(pid);
  return st ? st.starttime : null;
}

function holderId() {
  return [require('os').hostname(), process.pid, processStartTicks(process.pid) || '0'].join(':');
}

// Returns 'alive' | 'dead' | 'unknown'. 'unknown' means we cannot prove
// either way (e.g. another host) and callers must treat it as alive until
// a much longer grace period has passed.
function holderStatus(id) {
  if (!id || typeof id !== 'string') return 'unknown';
  var parts = id.split(':');
  var host = parts[0], pid = parseInt(parts[1], 10), ticks = parts[2];
  if (host !== require('os').hostname()) return 'unknown';
  if (!pid) return 'unknown';
  var alive;
  try { process.kill(pid, 0); alive = true; } catch (e) { alive = (e.code === 'EPERM'); }
  if (!alive) return 'dead';
  var st = procStat(pid);
  // A ZOMBIE has exited but has not been reaped by its parent. /proc still
  // lists it and kill(pid,0) still succeeds, so a naive liveness check
  // would keep its budget hostage until the parent happens to reap it.
  // It has stopped executing, so for lease purposes it is dead.
  if (st && st.state === 'Z') return 'dead';
  // The pid exists — but is it the SAME process that took the lease?
  var current = st ? st.starttime : null;
  if (ticks && ticks !== '0' && current && current !== ticks) return 'dead'; // pid reused
  return 'alive';
}

// Derived lease state for one entry. EXPIRED is derived from the clock;
// RECOVERED/SETTLED/RELEASED are persisted terminal facts.
function leaseState(entry, nowMs) {
  if (!entry) return null;
  if (entry.status === 'SETTLED') return 'SETTLED';
  if (entry.status === 'RELEASED') return 'RELEASED';
  if (entry.status === 'RECOVERED') return 'RECOVERED';
  var expires = entry.lease_expires_at ? Date.parse(entry.lease_expires_at) : null;
  if (expires && (nowMs === undefined ? Date.now() : nowMs) > expires) return 'EXPIRED';
  return 'ACTIVE';
}

// A reservation may be recovered only when its lease has expired AND its
// holder is provably gone (or unverifiable for a long grace). Uncertainty
// always resolves to "do not recover".
function recoverable(entry, nowMs) {
  nowMs = nowMs === undefined ? Date.now() : nowMs;
  if (!entry || entry.status !== 'RESERVED') return { ok: false, reason: 'not an active reservation' };
  var expires = entry.lease_expires_at ? Date.parse(entry.lease_expires_at) : null;
  if (!expires) return { ok: false, reason: 'no lease recorded (legacy entry) — left untouched' };
  if (nowMs <= expires + LEASE_GRACE_MS) return { ok: false, reason: 'lease still valid (within grace)' };
  var status = holderStatus(entry.holder_id);
  if (status === 'alive') return { ok: false, reason: 'holder is still alive — never steal a live reservation' };
  if (status === 'unknown') {
    if (nowMs <= expires + UNVERIFIABLE_HOLDER_GRACE_MS) {
      return { ok: false, reason: 'holder liveness unverifiable — waiting out the long grace (fail safe)' };
    }
    return { ok: true, reason: 'holder unverifiable and long grace elapsed' };
  }
  return { ok: true, reason: 'holder is gone and the lease expired' };
}

// --- Ledger read/write ---------------------------------------------------------------

function emptyLedger(project, scope, periodKey, budget, limitOverride) {
  return {
    ledger_version: '1.0.0',
    project: project,
    scope: scope,
    period_key: periodKey,
    timezone: budget.timezone,
    currency: budget.currency,
    limit: typeof limitOverride === 'number' ? limitOverride : budget.daily_limit,
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
  var nowMs = Date.now();
  var stale = Object.keys(ledger.entries).filter(function (id) {
    var e = ledger.entries[id];
    return e.status === 'RESERVED' &&
      (nowMs - Date.parse(e.reserved_at)) > STALE_RESERVATION_MS;
  });
  return {
    project: project, scope: scope, period_key: periodKey, timezone: ledger.timezone,
    currency: t.currency, limit: t.limit, reserved: t.reserved, spent: t.spent,
    remaining: t.remaining, configured: budget.configured,
    entry_count: Object.keys(ledger.entries).length,
    // Holds older than the threshold are almost certainly leaked by a
    // crashed attempt. They are NOT auto-released (that would risk
    // freeing money a live task still intends to spend); they are made
    // visible so an operator can see why remaining is low.
    stale_reservations: stale.length,
    stale_reservation_ids: stale.slice(0, 10)
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
  // A MISSION ledger carries the mission's own limit, not the daily one.
  var effectiveLimit = typeof req.__limit_override === 'number'
    ? req.__limit_override : budget.daily_limit;

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
  if (!budget.configured || !(effectiveLimit > 0)) {
    var denyNoBudget = {
      decision: 'deny',
      reason: 'project "' + String(project).slice(0, 40) + '" has no configured spending budget (limit ' +
        effectiveLimit + ' ' + budget.currency + ')',
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
    var ledger = readLedgerRaw(file) || emptyLedger(project, scope, periodKey, budget, effectiveLimit);
    // Config may have changed since the period started; the committed
    // config is authoritative for the limit.
    ledger.limit = effectiveLimit;
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

    var nowIso = new Date().toISOString();
    var leaseMs = typeof req.lease_ms === 'number' && req.lease_ms > 0 ? req.lease_ms : LEASE_MS;
    ledger.entries[req.reservation_id] = {
      status: 'RESERVED', amount: Math.round(req.amount * 100) / 100,
      cost_basis: req.cost_basis,
      provider: req.provider || null, agent: req.agent || null, tool: req.tool || null,
      mission_id: req.mission_id || null, task_id: req.task_id || null,
      project_id: project, currency: budget.currency, scope: scope,
      attempt_id: req.attempt_id || null,
      reserved_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
      // The lease is PERSISTED, never a memory-only timer: any process can
      // read it and decide recovery deterministically.
      holder_id: req.holder_id || holderId(),
      lease_ms: leaseMs,
      lease_expires_at: new Date(Date.now() + leaseMs).toISOString(),
      heartbeats: 0
    };
    writeLedger(file, ledger);
    var after = totals(ledger);
    emitBudgetEvent('BUDGET_RESERVED', {
      project: project, period_key: periodKey, reservation_id: req.reservation_id,
      amount: req.amount, remaining: after.remaining, task_id: req.task_id || null,
      mission_id: req.mission_id || null, provider: req.provider || null
    });
    emitBudgetEvent('RESERVATION_CREATED', {
      project: project, period_key: periodKey, scope: scope,
      reservation_id: req.reservation_id, amount: req.amount,
      currency: after.currency, task_id: req.task_id || null, mission_id: req.mission_id || null,
      attempt_id: req.attempt_id || null,
      lease_expires_at: ledger.entries[req.reservation_id].lease_expires_at
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
    if (entry.status === 'RECOVERED') {
      // Settling after recovery is handled SAFELY: the hold was already
      // returned to the budget, so re-settling it would spend money the
      // ledger has re-offered to someone else. Refused, not silently
      // applied; the caller must take a fresh reservation.
      return { ok: false, reason: 'RESERVATION_RECOVERED: the lease expired and was recovered — ' +
        'take a new reservation instead of settling a recovered one',
        lease_state: 'RECOVERED' };
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
    emitBudgetEvent('RESERVATION_SETTLED', {
      project: req.project, period_key: periodKey, scope: scope,
      reservation_id: req.reservation_id, amount: entry.amount, settled_amount: actual,
      currency: after.currency, task_id: entry.task_id, mission_id: entry.mission_id
    });
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
    if (entry.status === 'RECOVERED') {
      // Releasing after recovery is a no-op: the budget is already free.
      return { ok: true, idempotent_replay: true, lease_state: 'RECOVERED',
        reason: 'already recovered — the hold was returned when the lease expired',
        budget: Object.assign({ project: req.project, period_key: periodKey }, totals(ledger)) };
    }
    entry.status = 'RELEASED';
    entry.released_at = new Date().toISOString();
    entry.release_reason = String(req.reason || 'unspecified').slice(0, 200);
    writeLedger(file, ledger);
    var after = totals(ledger);
    emitBudgetEvent('RESERVATION_RELEASED', {
      project: req.project, period_key: periodKey, scope: scope,
      reservation_id: req.reservation_id, amount: entry.amount,
      currency: after.currency, task_id: entry.task_id, reason: entry.release_reason
    });
    emitBudgetEvent('BUDGET_RELEASED', {
      project: req.project, period_key: periodKey, reservation_id: req.reservation_id,
      amount: entry.amount, remaining: after.remaining, task_id: entry.task_id,
      scope: scope, reason: entry.release_reason
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
// --- Lease heartbeat and recovery ------------------------------------------------

// Renews the lease on a live reservation. Idempotent, persisted, and it
// NEVER changes the amount — a heartbeat can only move the expiry forward,
// so it can neither create budget nor duplicate a reservation.
function heartbeat(req) {
  req = req || {};
  var scope = req.scope || 'DAY';
  var budget = projectBudget(req.project, req.config);
  var periodKey = req.period_key ||
    (scope === 'MISSION' ? String(req.mission_id) : periodKeyFor(scope, budget.timezone, req.at));
  var file = ledgerFile(req.project, scope, periodKey);
  try {
    return withLock(file, function () {
      var ledger = readLedgerRaw(file);
      var entry = ledger && ledger.entries[req.reservation_id];
      if (!entry) return { ok: false, reason: 'NO_SUCH_RESERVATION: ' + String(req.reservation_id).slice(0, 60) };
      if (entry.status !== 'RESERVED') {
        // Rejected after recovery/settlement/release: a terminal
        // reservation can never be revived by a heartbeat.
        return { ok: false, reason: 'NOT_ACTIVE: reservation is ' + entry.status +
          ' — a heartbeat cannot revive it', lease_state: leaseState(entry) };
      }
      if (req.holder_id && entry.holder_id && req.holder_id !== entry.holder_id) {
        return { ok: false, reason: 'NOT_THE_HOLDER: this process does not hold the lease' };
      }
      var leaseMs = typeof req.lease_ms === 'number' && req.lease_ms > 0 ? req.lease_ms
        : (entry.lease_ms || LEASE_MS);
      var amountBefore = entry.amount;
      entry.lease_expires_at = new Date(Date.now() + leaseMs).toISOString();
      entry.updated_at = new Date().toISOString();
      entry.heartbeats = (entry.heartbeats || 0) + 1;
      entry.amount = amountBefore;   // explicit: a heartbeat never moves money
      writeLedger(file, ledger);
      emitBudgetEvent('RESERVATION_HEARTBEAT', {
        project: req.project, period_key: periodKey, scope: scope,
        reservation_id: req.reservation_id, amount: entry.amount,
        heartbeats: entry.heartbeats, lease_expires_at: entry.lease_expires_at,
        task_id: entry.task_id, mission_id: entry.mission_id
      });
      return { ok: true, lease_expires_at: entry.lease_expires_at,
        heartbeats: entry.heartbeats, lease_state: 'ACTIVE' };
    });
  } catch (e) {
    return { ok: false, reason: 'ledger unavailable: ' + String(e.message).slice(0, 160) };
  }
}

// Sweeps one ledger and recovers every reservation whose lease expired AND
// whose holder is provably gone. Atomic, idempotent (an already RECOVERED
// entry is skipped), and fail-safe (uncertainty leaves the hold in place).
function recoverExpired(project, opts) {
  opts = opts || {};
  var scope = opts.scope || 'DAY';
  var budget = projectBudget(project, opts.config);
  var periodKey = opts.period_key ||
    (scope === 'MISSION' ? String(opts.mission_id) : periodKeyFor(scope, budget.timezone, opts.at));
  var file = ledgerFile(project, scope, periodKey);
  if (!fs.existsSync(file)) return { recovered: [], skipped: [], scanned: 0 };
  var nowMs = opts.at || Date.now();
  try {
    return withLock(file, function () {
      var ledger = readLedgerRaw(file);
      if (!ledger) return { recovered: [], skipped: [], scanned: 0 };
      var recovered = [], skipped = [];
      Object.keys(ledger.entries).forEach(function (id) {
        var entry = ledger.entries[id];
        if (entry.status !== 'RESERVED') return;
        var verdict = recoverable(entry, nowMs);
        if (!verdict.ok) {
          if (leaseState(entry, nowMs) === 'EXPIRED') skipped.push({ id: id, reason: verdict.reason });
          return;
        }
        entry.status = 'RECOVERED';
        entry.recovered_at = new Date().toISOString();
        entry.updated_at = entry.recovered_at;
        entry.recovery_reason = verdict.reason;
        recovered.push({ id: id, amount: entry.amount, holder_id: entry.holder_id,
          task_id: entry.task_id, mission_id: entry.mission_id });
      });
      if (recovered.length) writeLedger(file, ledger);
      var after = totals(ledger);
      recovered.forEach(function (r) {
        emitBudgetEvent('RESERVATION_EXPIRED', {
          project: project, period_key: periodKey, scope: scope,
          reservation_id: r.id, amount: r.amount, task_id: r.task_id, mission_id: r.mission_id
        });
        emitBudgetEvent('RESERVATION_RECOVERED', {
          project: project, period_key: periodKey, scope: scope,
          reservation_id: r.id, amount: r.amount, currency: after.currency,
          remaining_after: after.remaining, task_id: r.task_id, mission_id: r.mission_id
        });
      });
      return { recovered: recovered, skipped: skipped,
        scanned: Object.keys(ledger.entries).length, budget: after };
    });
  } catch (e) {
    return { recovered: [], skipped: [], scanned: 0,
      error: 'ledger unavailable: ' + String(e.message).slice(0, 160) };
  }
}

// Startup sweep across every ledger the store holds. Called by the
// scheduler at mission start — no second scheduler, no daemon of its own.
function recoverAll(opts) {
  opts = opts || {};
  var root = budgetsRoot();
  if (!fs.existsSync(root)) return { ledgers: 0, recovered: [] };
  var recovered = [];
  var ledgers = 0;
  fs.readdirSync(root).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
    var parts = f.replace(/\.json$/, '').split('__');
    if (parts.length !== 3) return;
    ledgers += 1;
    var out = recoverExpired(parts[0], { scope: parts[1], period_key: parts[2],
      at: opts.at, config: opts.config });
    out.recovered.forEach(function (r) {
      recovered.push(Object.assign({ project: parts[0], scope: parts[1], period_key: parts[2] }, r));
    });
  });
  return { ledgers: ledgers, recovered: recovered };
}

// Read model: every reservation with its derived lease state.
function reservations(project, opts) {
  opts = opts || {};
  var scope = opts.scope || 'DAY';
  var budget = projectBudget(project, opts.config);
  var periodKey = opts.period_key ||
    (scope === 'MISSION' ? String(opts.mission_id) : periodKeyFor(scope, budget.timezone, opts.at));
  var ledger = readLedgerRaw(ledgerFile(project, scope, periodKey));
  if (!ledger) return [];
  var nowMs = opts.at || Date.now();
  return Object.keys(ledger.entries).map(function (id) {
    var e = ledger.entries[id];
    return {
      reservation_id: id, scope: e.scope || scope, project_id: e.project_id || project,
      mission_id: e.mission_id || null, task_id: e.task_id || null,
      attempt_id: e.attempt_id || null, holder_id: e.holder_id || null,
      amount: e.amount, currency: e.currency || ledger.currency,
      status: e.status, lease_state: leaseState(e, nowMs),
      holder_status: e.holder_id ? holderStatus(e.holder_id) : null,
      created_at: e.created_at || e.reserved_at, updated_at: e.updated_at || null,
      lease_expires_at: e.lease_expires_at || null, heartbeats: e.heartbeats || 0,
      settled_amount: e.settled_amount === undefined ? null : e.settled_amount,
      recovered_at: e.recovered_at || null, released_at: e.released_at || null
    };
  }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
}

// --- Scope hierarchy: REQUEST → MISSION → PROJECT/DAY --------------------------
//
// A spend must pass EVERY applicable boundary. Enforcement order is
// cheapest-and-strictest first:
//
//   1. REQUEST  — a pure comparison against request_limit (no state).
//   2. PROJECT/DAY — reserve in the day ledger (atomic).
//   3. MISSION  — reserve in the mission ledger (atomic). If this fails the
//      project hold taken in step 2 is released immediately, so a rejected
//      request leaves no trace and cannot strand budget.
//
// No lower scope can widen a higher one: each holds its own ledger and the
// first refusal wins.

function missionLimitFor(budget, opts) {
  // A mission may declare a SMALLER limit than the project default; it can
  // never grant itself a larger one (a lower scope never widens a higher).
  var configured = budget.mission_limit;
  var declared = opts && typeof opts.mission_limit === 'number' ? opts.mission_limit : null;
  if (declared === null) return configured;
  return Math.min(declared, configured > 0 ? configured : declared);
}

// Reserves across every applicable scope. Same contract as reserve(), plus
// `mission_id` (enables MISSION scope) and optional `mission_limit`.
function reserveScoped(req) {
  req = req || {};
  var budget = projectBudget(req.project, req.config);

  // 1. REQUEST scope — a single request may never exceed request_limit.
  if (typeof req.amount === 'number' && isFinite(req.amount) && budget.request_limit > 0 &&
      req.amount > budget.request_limit) {
    var overRequest = {
      decision: req.allow_approval ? 'require_approval' : 'deny',
      scope_denied: 'REQUEST',
      reason: 'REQUEST scope: ' + req.amount + ' ' + budget.currency +
        ' exceeds the per-request maximum of ' + budget.request_limit,
      budget: status(req.project, { scope: 'DAY', at: req.at, config: req.config })
    };
    emitBudgetEvent(overRequest.decision === 'deny' ? 'BUDGET_DENIED' : 'BUDGET_APPROVAL_REQUIRED', {
      project: req.project, amount: req.amount, scope: 'REQUEST',
      request_limit: budget.request_limit, task_id: req.task_id, mission_id: req.mission_id
    });
    return overRequest;
  }

  // 2. PROJECT/DAY scope.
  var day = reserve(req);
  if (day.decision !== 'allow') {
    day.scope_denied = day.scope_denied || 'PROJECT_DAY';
    return day;
  }

  // 3. MISSION scope (only when a mission id and a mission limit exist).
  var missionLimit = missionLimitFor(budget, req);
  if (!req.mission_id || !(missionLimit > 0)) {
    day.scopes_enforced = ['REQUEST', 'PROJECT_DAY'];
    return day;
  }
  var missionHold;
  try {
    missionHold = reserve(Object.assign({}, req, {
      scope: 'MISSION',
      period_key: String(req.mission_id),
      __limit_override: missionLimit
    }));
  } catch (e) {
    missionHold = { decision: 'deny', reason: 'mission ledger unavailable: ' + String(e.message).slice(0, 140) };
  }
  if (missionHold.decision !== 'allow') {
    // Roll the project hold back: a refused request must leave nothing behind.
    try {
      release({ project: req.project, reservation_id: req.reservation_id,
        reason: 'rolled back: MISSION scope refused', config: req.config, at: req.at });
    } catch (e) { /* best effort; the hold would expire with the period anyway */ }
    missionHold.scope_denied = 'MISSION';
    missionHold.reason = 'MISSION scope: ' + missionHold.reason;
    return missionHold;
  }
  day.scopes_enforced = ['REQUEST', 'PROJECT_DAY', 'MISSION'];
  day.mission_budget = missionHold.budget;
  return day;
}

// Settles across every scope the reservation was taken in.
// True only when this reservation really was taken at MISSION scope.
// A project with mission_limit 0 never reserves there, so settling or
// releasing that scope would report a phantom failure.
function hasMissionEntry(project, missionId, reservationId) {
  if (!missionId) return false;
  try {
    var ledger = readLedgerRaw(ledgerFile(project, 'MISSION', String(missionId)));
    return !!(ledger && ledger.entries[reservationId]);
  } catch (e) {
    return false;
  }
}

function settleScoped(req) {
  req = req || {};
  var out = settle(req);
  if (hasMissionEntry(req.project, req.mission_id, req.reservation_id)) {
    var m = settle(Object.assign({}, req, { scope: 'MISSION', period_key: String(req.mission_id) }));
    if (m && m.ok) out.mission_budget = m.budget;
    else {
      // Cannot overspend — the mission ledger simply keeps its hold — but
      // the inconsistency is surfaced instead of silently swallowed.
      out.mission_settle_failed = (m && m.reason) || 'unknown';
      emitBudgetEvent('BUDGET_DENIED', { project: req.project, mission_id: req.mission_id,
        reservation_id: req.reservation_id, scope: 'MISSION',
        reason: 'settlement failed at MISSION scope: ' + out.mission_settle_failed });
    }
  }
  return out;
}

// Releases across every scope.
function releaseScoped(req) {
  req = req || {};
  var out = release(req);
  if (hasMissionEntry(req.project, req.mission_id, req.reservation_id)) {
    var m = release(Object.assign({}, req, { scope: 'MISSION', period_key: String(req.mission_id) }));
    if (m && m.ok) out.mission_budget = m.budget;
  }
  return out;
}

// Read model for a mission's own ledger.
function missionStatus(project, missionId, opts) {
  opts = opts || {};
  var budget = projectBudget(project, opts.config);
  var limit = missionLimitFor(budget, opts);
  var file = ledgerFile(project, 'MISSION', String(missionId));
  var ledger = readLedgerRaw(file) ||
    emptyLedger(project, 'MISSION', String(missionId), budget, limit);
  var t = totals(ledger);
  return {
    project: project, scope: 'MISSION', mission_id: String(missionId),
    currency: t.currency, limit: limit, reserved: t.reserved, spent: t.spent,
    remaining: Math.round((limit - t.reserved - t.spent) * 100) / 100,
    entry_count: Object.keys(ledger.entries).length
  };
}

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
  hasMissionEntry: hasMissionEntry,
  reserveScoped: reserveScoped,
  settleScoped: settleScoped,
  releaseScoped: releaseScoped,
  missionStatus: missionStatus,
  missionLimitFor: missionLimitFor,
  reservationIdFor: reservationIdFor,
  STALE_RESERVATION_MS: STALE_RESERVATION_MS,
  LEASE_MS: LEASE_MS,
  LEASE_GRACE_MS: LEASE_GRACE_MS,
  UNVERIFIABLE_HOLDER_GRACE_MS: UNVERIFIABLE_HOLDER_GRACE_MS,
  LEASE_STATES: LEASE_STATES,
  holderId: holderId,
  holderStatus: holderStatus,
  leaseState: leaseState,
  recoverable: recoverable,
  heartbeat: heartbeat,
  recoverExpired: recoverExpired,
  recoverAll: recoverAll,
  reservations: reservations,
  withLock: withLock
};
