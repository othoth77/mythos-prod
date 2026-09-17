'use strict';
// =====================================================
// MYTHOS Guardian — remediation planner and executor
// ops/guardian/lib/remediate.js
//
// plan()    decides which actions are candidates and why each is or is not.
// execute() runs an approved plan, or simulates it exactly, and writes an
//           audit record either way.
//
// EVERY action passes all of these, in this order, and the plan records the
// first one it fails so a human can see why nothing happened:
//
//   1. observe_only        — if true, nothing runs. Full stop.
//   2. flag                — the action's config flag must be true.
//   3. registry            — the id must exist in actions.js.
//   4. level               — the domain must be at or above min_level.
//   5. precondition        — the action's own pure check.
//   6. protected           — the argv must not mention a protected resource.
//   7. allowlist           — io.allowedAction(argv) must be true.
//   8. cooldown            — since the last run of THIS action.
//   9. rate limit          — runs in a rolling 24 h.
//  10. budget              — total actions this tick.
//
// A dry run evaluates 1-10 identically and stops before execution. That is
// the point: `--dry-run` tells you what WOULD happen under the real gates,
// not what a simplified copy of them thinks.
// =====================================================

var levels = require('./levels');
var actionsMod = require('./actions');

var GATES = ['observe_only', 'flag', 'registry', 'level', 'precondition', 'protected', 'allowlist', 'cooldown', 'rate_limit', 'budget'];

function emptyHistory() { return { last_run_ms: {}, runs: {} }; }

function normaliseHistory(prev) {
  var h = emptyHistory();
  if (!prev || typeof prev !== 'object') return h;
  if (prev.last_run_ms && typeof prev.last_run_ms === 'object') h.last_run_ms = prev.last_run_ms;
  if (prev.runs && typeof prev.runs === 'object') h.runs = prev.runs;
  return h;
}

function runsInWindow(history, id, nowMs, windowMs) {
  var list = history.runs[id] || [];
  return list.filter(function (t) { return nowMs - t <= windowMs; });
}

// --- candidate discovery ------------------------------------------------
// Which actions even apply to this report? Pure: no io, no side effects.
function candidates(report, cfg, ctxBase) {
  var out = [];
  actionsMod.list().forEach(function (a) {
    var domain = report.domains[a.domain];
    if (!domain) return;

    if (a.id === 'ACTION_RESTART_APPROVED_SERVICE') {
      // One candidate per down support unit that configuration marks restartable.
      var table = (domain.summary && domain.summary.table) || {};
      (cfg.services.restartable || []).forEach(function (id) {
        var row = table[id];
        if (!row) return;
        var unitCfg = (cfg.services.units || []).filter(function (u) { return u.id === id; })[0];
        if (!unitCfg) return;
        out.push({
          action: a,
          target: {
            id: id, unit: unitCfg.unit, manager: unitCfg.manager, class: row.class,
            status: row.status, attempts: (ctxBase.history.runs[a.id + ':' + id] || []).length
          }
        });
      });
      return;
    }
    out.push({ action: a, target: null });
  });
  return out;
}

// --- the gates ----------------------------------------------------------
function evaluate(candidate, report, cfg, io, ctxBase) {
  var a = candidate.action;
  var key = a.id + (candidate.target ? ':' + candidate.target.id : '');
  var domain = report.domains[a.domain];
  var decision = { action: a.id, key: key, target: candidate.target ? candidate.target.id : null,
    title: a.title, domain: a.domain, allowed: false, gate: null, reason: null, evidence: null, argv: null, kind: a.publish ? 'publish' : 'command' };

  // 1 — observe_only wins over everything, including an enabled flag.
  if (cfg.observe_only === true) {
    decision.gate = 'observe_only';
    decision.reason = 'Guardian is in observe-only mode; no action runs';
    return decision;
  }
  // 2 — the flag.
  if (cfg[a.flag] !== true) {
    decision.gate = 'flag';
    decision.reason = a.flag + ' is not enabled';
    return decision;
  }
  // 3 — registry identity. Belt and braces: the object must BE the registry's.
  if (actionsMod.get(a.id) !== a) {
    decision.gate = 'registry';
    decision.reason = 'action is not the registry instance of ' + a.id;
    return decision;
  }
  // 4 — level.
  if (levels.rank(domain.level) < levels.rank(a.min_level)) {
    decision.gate = 'level';
    decision.reason = a.domain + ' is ' + domain.level + ', below ' + a.min_level;
    return decision;
  }
  // 5 — the action's own precondition.
  var ctx = Object.assign({}, ctxBase, { target: candidate.target, policy: cfg.remediation, memory_level: report.domains.memory.level });
  var pre;
  try { pre = a.precondition(ctx); } catch (e) { pre = { ok: false, reason: 'precondition threw: ' + String(e && e.message) }; }
  if (!pre.ok) {
    decision.gate = 'precondition';
    decision.reason = pre.reason;
    return decision;
  }
  decision.evidence = pre.evidence;

  // 6 + 7 — what will actually run, checked against PROTECTED and the allowlist.
  if (a.publish) {
    var pub = a.publish(ctx);
    decision.argv = ['<publish>', pub.file];
    var hitP = actionsMod.protectedHit(pub.file);
    if (hitP) { decision.gate = 'protected'; decision.reason = 'publication name mentions ' + hitP; return decision; }
  } else {
    var argv = a.command(ctx);
    decision.argv = argv;
    var refusal = actionsMod.refusesProtected(argv);
    if (refusal) { decision.gate = 'protected'; decision.reason = refusal; return decision; }
    if (!io.constructor && false) { /* unreachable; keeps io referenced for clarity */ }
    if (!require('./io').allowedAction(argv)) {
      decision.gate = 'allowlist';
      decision.reason = 'argv is not in ACTION_COMMANDS: ' + argv.join(' ');
      return decision;
    }
  }

  // 8 — cooldown.
  var last = ctxBase.history.last_run_ms[key];
  if (last && (ctxBase.nowMs - last) < a.cooldown_s * 1000) {
    decision.gate = 'cooldown';
    decision.reason = 'last run ' + Math.round((ctxBase.nowMs - last) / 1000) + ' s ago; cooldown is ' + a.cooldown_s + ' s';
    return decision;
  }
  // 9 — rolling 24 h rate limit.
  var recent = runsInWindow(ctxBase.history, key, ctxBase.nowMs, 86400000);
  if (recent.length >= a.max_per_day) {
    decision.gate = 'rate_limit';
    decision.reason = recent.length + ' runs in the last 24 h; the ceiling is ' + a.max_per_day;
    return decision;
  }
  // 10 — how many actions this tick may take at all.
  if (ctxBase.taken >= cfg.remediation.max_actions_per_tick) {
    decision.gate = 'budget';
    decision.reason = 'tick budget of ' + cfg.remediation.max_actions_per_tick + ' action(s) already used';
    return decision;
  }

  decision.allowed = true;
  return decision;
}

// --- plan ---------------------------------------------------------------
function plan(report, cfg, io, opts) {
  var o = opts || {};
  var history = normaliseHistory(o.history);
  var ctxBase = {
    nowMs: o.now_ms || Date.now(),
    history: history,
    taken: 0,
    disk: report.domains.disk.summary,
    sessions: report.domains.sessions.summary,
    memory_level: report.domains.memory.level,
    recommended_ceiling: (cfg.sessions.max_concurrency || {})[report.domains.memory.level],
    npm_cache_mib: o.measure ? o.measure.npmCacheMib() : null,
    docker: o.docker || null,
    measure: o.measure || { npmCacheMib: function () { return null; }, dockerBuildCacheGb: function () { return null; } }
  };

  var decisions = [];
  candidates(report, cfg, ctxBase).forEach(function (c) {
    var d = evaluate(c, report, cfg, io, ctxBase);
    if (d.allowed) ctxBase.taken += 1;
    d._candidate = c;
    decisions.push(d);
  });

  return {
    at: new Date(ctxBase.nowMs).toISOString(),
    observe_only: cfg.observe_only === true,
    decisions: decisions,
    approved: decisions.filter(function (d) { return d.allowed; }),
    ctx: ctxBase
  };
}

// --- execute ------------------------------------------------------------
function execute(thePlan, cfg, io, opts) {
  var o = opts || {};
  var dry = o.dry_run !== false;          // execution is opt-IN, never the default
  var results = [];

  thePlan.approved.forEach(function (d) {
    var a = actionsMod.get(d.action);
    var c = d._candidate;
    var ctx = Object.assign({}, thePlan.ctx, { target: c.target, policy: cfg.remediation, memory_level: thePlan.ctx.memory_level });
    var record = {
      at: new Date(thePlan.ctx.nowMs).toISOString(),
      action: a.id, target: d.target, title: a.title, domain: a.domain,
      trigger: d.reason || (d.evidence ? JSON.stringify(d.evidence) : null),
      before: d.evidence, argv: d.argv, mode: dry ? 'dry-run' : 'executed',
      reversible: a.reversible, protects: a.protects,
      result: null, verified: null, error: null
    };

    if (dry) {
      record.result = 'would-run';
      results.push(record);
      return;
    }

    // ARM for exactly one operation, and disarm in finally. Nothing else in
    // Guardian ever sets this.
    io.armed = true;
    try {
      if (a.publish) {
        var pub = a.publish(ctx);
        var w = io.publishAdvisory(cfg.remediation.publish_dir, pub.file, pub.body);
        record.result = w.ok ? 'published' : 'failed';
        record.error = w.ok ? null : w.error;
      } else {
        var r = io.act(d.argv, { timeout_ms: cfg.remediation.action_timeout_ms });
        record.result = (r.status === 0) ? 'ran' : 'failed';
        record.exit_status = r.status;
        record.error = r.refused ? r.error : (r.status === 0 ? null : String(r.stderr || '').slice(0, 300));
      }
    } catch (e) {
      record.result = 'failed';
      record.error = String((e && e.message) || e);
    } finally {
      io.armed = false;
    }

    if (record.result === 'ran' || record.result === 'published') {
      try {
        var v = a.verify(io, ctx, d.evidence || {});
        record.verified = v.ok;
        record.verification = v.detail;
      } catch (e) {
        record.verified = false;
        record.verification = 'verification threw: ' + String(e && e.message);
      }
    }
    results.push(record);
  });

  return results;
}

// --- history ------------------------------------------------------------
function recordRuns(history, results, nowMs) {
  var h = normaliseHistory(history);
  results.forEach(function (r) {
    if (r.mode !== 'executed') return;
    var key = r.action + (r.target ? ':' + r.target : '');
    h.last_run_ms[key] = nowMs;
    h.runs[key] = (h.runs[key] || []).filter(function (t) { return nowMs - t <= 86400000; }).concat([nowMs]).slice(-100);
  });
  return h;
}

module.exports = {
  GATES: GATES, plan: plan, execute: execute, candidates: candidates, evaluate: evaluate,
  recordRuns: recordRuns, emptyHistory: emptyHistory, normaliseHistory: normaliseHistory
};
