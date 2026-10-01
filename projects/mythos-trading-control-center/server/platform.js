'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — platform
// projects/mythos-trading-control-center/server/platform.js
//
// Composes the pieces — configuration and mode, runs, the paper control room,
// research, the testing center — into the one object the HTTP layer talks to.
// The HTTP layer never reaches past it: no route holds a store, a config or a
// mode controller.
//
// TWO RULES LIVE HERE BECAUSE THEY SPAN MODULES
//
//  1. EXPOSURE-REDUCING ACTIONS NEVER WAIT. Disabling trading and lowering the
//     mode stop an active paper session first and then proceed. Everything
//     that could raise exposure or change the system under a running session —
//     a configuration edit, a strategy change, enabling trading — is refused
//     while a session is active.
//
//  2. NO DATA IS A VALUE, NOT A ZERO. Every read model that can lack a source
//     returns { available: false, reason } instead of defaults. A dashboard
//     that shows "balance 0" for an account that does not exist is fabricating
//     a number; "NO DATA — no run has completed" is the truth.
// =====================================================

var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var agentMod = require('./agent');
var stateMod = require('./state');
var controlMod = require('./control');
var runsMod = require('./runs');
var paperMod = require('./paper');
var researchMod = require('./research');
var testingMod = require('./testing');
var views = require('./views');

var VERSION = '1.0.0';
var PROJECT_ROOT = path.join(__dirname, '..');

function refusal(code, message, extra) {
  var e = new Error(message);
  e.code = code;
  e.refusal = true;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

function noData(reason, extra) {
  var out = { available: false, reason: reason };
  if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

/**
 * The commit this process is running. Environment first (a release directory
 * has no .git), then a COMMIT file the release script writes, then git.
 * Unknown is a real answer: PAPER approvals are refused when it is.
 */
function resolveCommit(explicit) {
  if (explicit && /^[0-9a-f]{7,40}$/.test(explicit)) return explicit;
  var env = process.env.TCC_COMMIT;
  if (env && /^[0-9a-f]{7,40}$/.test(env)) return env;
  try {
    var file = fs.readFileSync(path.join(PROJECT_ROOT, 'COMMIT'), 'utf8').trim();
    if (/^[0-9a-f]{7,40}$/.test(file)) return file;
  } catch (e) { /* no COMMIT file */ }
  try {
    var out = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PROJECT_ROOT, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    }).toString().trim();
    if (/^[0-9a-f]{40}$/.test(out)) return out;
  } catch (e2) { /* not a git checkout */ }
  return null;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.stateDir]
 * @param {string} [opts.agentRoot]
 * @param {string} [opts.commit]
 * @param {function} [opts.now]
 * @param {boolean} [opts.paperAutoTick]
 * @param {number} [opts.maxRuns]
 * @param {object} [opts.testEnv]
 */
function create(opts) {
  var o = opts || {};
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var startedAt = now();
  // `commit: false` forces the unknown-commit path; tests use it to prove that
  // PAPER is refused when an approval cannot be bound to a commit.
  var commit = o.commit === false ? null : resolveCommit(o.commit);
  var agentRoot = o.agentRoot || agentMod.DEFAULT_AGENT_ROOT;
  var agent = agentMod.load(agentRoot);
  var state = stateMod.create({ dir: o.stateDir });

  var systemEvents = [];    // the Control Center's own events, newest last
  function systemEvent(ev) {
    systemEvents.push({
      ts: new Date(now()).toISOString(), kind: String(ev.kind).slice(0, 64),
      severity: ev.severity || 'INFO', message: String(ev.message || '').slice(0, 600)
    });
    if (systemEvents.length > 500) systemEvents.shift();
  }

  var control = controlMod.create({ agent: agent, state: state, commit: commit, now: now });
  if (control.startupProblem()) systemEvent({ kind: 'CONFIG_REJECTED_AT_START', severity: 'ERROR', message: control.startupProblem() });
  if (!commit) systemEvent({ kind: 'COMMIT_UNKNOWN', severity: 'WARN', message: 'the running commit could not be determined; PAPER approvals are refused' });

  var runs = runsMod.create({
    state: state, agentRoot: agentRoot, commit: commit, now: now, maxRuns: o.maxRuns,
    timeoutMs: o.jobTimeoutMs,
    onFinished: function (run) {
      if (run.status !== runsMod.Status.COMPLETED) {
        systemEvent({ kind: 'RUN_' + run.status, severity: 'ERROR',
          message: run.runId + ': ' + (run.error ? run.error.message : run.status) });
      }
    }
  });
  var research = researchMod.create({ agent: agent, control: control, runs: runs, state: state, now: now });
  research.replayProblems().forEach(function (p) {
    systemEvent({ kind: 'RESEARCH_JOURNAL_REPLAY', severity: 'WARN', message: 'line ' + p.line + ' (' + p.op + '): ' + p.message });
  });
  var paper = paperMod.create({
    agent: agent, control: control, runs: runs, research: research, now: now,
    autoTick: o.paperAutoTick, onSystemEvent: systemEvent
  });
  var testing = testingMod.create({
    state: state, agentRoot: agentRoot, projectRoot: PROJECT_ROOT, commit: commit, now: now, env: o.testEnv,
    roots: o.testRoots, fileTimeoutMs: o.testFileTimeoutMs,
    onFinished: function (run) {
      if (run.status === 'FAILED') {
        systemEvent({ kind: 'TEST_RUN_FAILED', severity: 'ERROR', message: run.runId + ': ' + run.totals.failed + ' failed of ' + run.totals.total });
      }
    }
  });

  var staticHealthCache = null;

  // =====================================================================
  // context — which store a read model looks at
  // =====================================================================

  /**
   * Resolves the data context for an explorer request.
   *   run=<id>    that run's sealed store
   *   (none)      the live paper session when there is one, else the latest
   *               completed run, else nothing
   */
  function context(q) {
    var f = q || {};
    if (f.run) {
      var run = runs.get(f.run);
      if (!run) throw refusal('RUN_NOT_FOUND', 'no run ' + f.run);
      if (run.kind === 'EXPERIMENT') return noData('run ' + f.run + ' is an experiment; it has no decision store of its own', { runId: f.run });
      var sub = f.arm === 'challenger' ? 'store-challenger' : 'store';
      var loaded = runs.tables(f.run, sub);
      if (!loaded) return noData('run ' + f.run + ' has no sealed store (status ' + run.status + ')', { runId: f.run });
      return {
        available: true, source: run.kind === 'BACKTEST' ? 'BACKTEST_RUN' : 'PAPER_RUN', runId: run.runId,
        label: run.label === 'PAPER' ? 'PAPER' : (run.data ? run.data.label : null), live: false,
        tables: views.fromTables(loaded.tables), finishedAt: run.finishedAt, configHash: run.configHash
      };
    }
    var live = paper.liveStore(f.arm);
    if (live) {
      return {
        available: true, source: 'PAPER_SESSION', runId: live.sessionId, label: 'PAPER', live: paper.isActive(),
        tables: views.fromStore(live.store), finishedAt: null, configHash: live.config.fingerprint.hash
      };
    }
    var latest = runs.latest(['BACKTEST', 'PAPER', 'DEMO']);
    if (!latest) return noData('no backtest has completed and no paper session exists. Run a backtest to produce data.');
    var t = runs.tables(latest.runId, 'store');
    if (!t) return noData('the latest run (' + latest.runId + ') has no readable store', { runId: latest.runId });
    return {
      available: true, source: latest.kind === 'BACKTEST' ? 'BACKTEST_RUN' : 'PAPER_RUN', runId: latest.runId,
      label: latest.label === 'PAPER' ? 'PAPER' : (latest.data ? latest.data.label : null), live: false,
      tables: views.fromTables(t.tables), finishedAt: latest.finishedAt, configHash: latest.configHash
    };
  }

  function contextHeader(ctx) {
    if (!ctx.available) return ctx;
    return { available: true, source: ctx.source, runId: ctx.runId, label: ctx.label, live: ctx.live,
      finishedAt: ctx.finishedAt, configHash: ctx.configHash };
  }

  function withContext(q, fn) {
    var ctx = context(q);
    if (!ctx.available) return { context: ctx, data: null };
    return { context: contextHeader(ctx), data: fn(ctx) };
  }

  function strategiesMeta() {
    return control.view().strategies;
  }

  // =====================================================================
  // guards shared by mutations
  // =====================================================================

  function refuseWhilePaperActive(what) {
    if (paper.isActive()) {
      throw refusal('PAPER_SESSION_ACTIVE',
        'cannot ' + what + ' while a paper session is ' + paper.state() + '. Stop the session first.');
    }
  }

  // =====================================================================
  // status / dashboard / system
  // =====================================================================

  function status() {
    var cfg = control.config();
    var pv = paper.view();
    return {
      service: 'mythos-trading-control-center',
      version: VERSION,
      commit: commit,
      time: new Date(now()).toISOString(),
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      mode: control.mode(),
      modesAvailable: ['BACKTEST', 'PAPER'],
      liveExecution: {
        available: false,
        statement: 'LIVE execution does not exist in this build. There is no venue connectivity, no credential and no ' +
          'network client in the Trading Agent, and its live adapter refuses every call.'
      },
      tradingEnabled: control.tradingEnabled(),
      configFingerprint: cfg.fingerprint.hash,
      configRevision: control.revision(),
      universe: cfg.universe.slice(),
      strategiesEnabled: control.enabledStrategies().length,
      strategiesTotal: agent.strategyIds().length,
      paper: { state: pv.state, sessionId: pv.session ? pv.session.sessionId : null, kind: pv.session ? pv.session.kind : null },
      job: runs.active() ? { runId: runs.active().runId, kind: runs.active().kind, stage: runs.active().stage } : null,
      testRun: testing.busy(),
      persistence: state.describe()
    };
  }

  function staticHealth() {
    // The four static checks are cheap except the source scan; cache for a minute.
    if (staticHealthCache && now() - staticHealthCache.at < 60000 &&
        staticHealthCache.fingerprint === control.config().fingerprint.hash && staticHealthCache.mode === control.mode()) {
      return staticHealthCache.checks;
    }
    var h = agent.health.create({ config: control.config(), modeController: control.modeController() });
    var checks = [h.modeIsSafe(), h.liveExecutionRefused(), h.noNetworkClient(), h.recoveryCapped()];
    staticHealthCache = { at: now(), fingerprint: control.config().fingerprint.hash, mode: control.mode(), checks: checks };
    return checks;
  }

  /** The 13 checks: 4 evaluated now, 9 from the latest completed backtest. */
  function health() {
    var stat = staticHealth();
    var latest = runs.latest(['BACKTEST']);
    var result = latest ? runs.readDoc(latest.runId, 'result.json') : null;
    var runChecks = null;
    if (result && result.health) {
      var names = stat.map(function (c) { return c.check; });
      runChecks = result.health.checks.filter(function (c) { return names.indexOf(c.check) === -1; });
    }
    var all = stat.concat(runChecks || []);
    var counts = { ok: 0, warn: 0, fail: 0, unknown: 0, total: 13 };
    all.forEach(function (c) {
      if (c.status === 'OK') counts.ok++; else if (c.status === 'WARN') counts.warn++;
      else if (c.status === 'FAIL') counts.fail++; else counts.unknown++;
    });
    // Checks with no run to look at are UNKNOWN, and UNKNOWN is not a pass.
    counts.unknown += 13 - all.length;
    return {
      status: counts.fail ? 'FAIL' : (counts.warn ? 'WARN' : (counts.unknown ? 'UNKNOWN' : 'OK')),
      counts: counts,
      staticChecks: stat,
      runChecks: runChecks,
      runChecksSource: runChecks ? { runId: latest.runId, finishedAt: latest.finishedAt, configHash: latest.configHash,
        configCurrent: latest.configHash === control.config().fingerprint.hash } : null,
      runChecksReason: runChecks ? null : 'no backtest has completed; nine run checks have nothing to evaluate',
      note: counts.unknown ? counts.unknown + ' check(s) had nothing to evaluate and are UNKNOWN. An UNKNOWN is not a pass.' : null
    };
  }

  function dashboard() {
    var cfg = control.config();
    var pv = paper.view();
    var ctx = context({});
    var h = health();
    var out = {
      agentStatus: {
        state: pv.state === 'RUNNING' ? 'PAPER_SESSION_RUNNING' : (runs.busy() ? 'RUN_IN_PROGRESS' : 'IDLE'),
        detail: pv.state === 'RUNNING' ? 'paper session ' + pv.session.sessionId
          : (runs.busy() ? runs.active().kind + ' ' + runs.active().runId : 'no session and no run in progress')
      },
      mode: control.mode(),
      tradingStatus: control.tradingEnabled() ? 'ENABLED' : 'DISABLED',
      configFingerprint: cfg.fingerprint.hash,
      activeStrategies: { enabled: control.enabledStrategies(), total: agent.strategyIds().length },
      health: { status: h.status, counts: h.counts, note: h.note },
      source: contextHeader(ctx),
      account: null, performance: null, openPosition: null, regime: null,
      jev: null, risk: null, recovery: null, recentActivity: null, errors: null
    };

    // Account and performance.
    if (pv.session) {
      var arm = pv.session.arms[0];
      out.account = { available: true, source: 'PAPER_SESSION', label: 'PAPER', balance: arm.balance, equity: arm.equity,
        netPnl: arm.netProfit, returnPct: arm.returnPct, drawdownPct: arm.drawdownPct, maxDrawdownPct: arm.maxDrawdownPct,
        initialCapital: arm.initialCapital };
      out.openPosition = arm.openPosition ? { available: true, position: arm.openPosition, pendingEntry: arm.pendingEntry }
        : noData(arm.pendingEntry ? 'an entry is pending; no position is open yet' : 'no position is open', { pendingEntry: arm.pendingEntry });
      out.regime = Object.keys(arm.regimes).length ? { available: true, bySymbol: arm.regimes }
        : noData('the session has not classified a bar yet (warmup)');
    } else if (ctx.available) {
      var curve = ctx.tables.rows('equity_curve');
      var last = curve.length ? curve[curve.length - 1] : null;
      out.account = last ? { available: true, source: ctx.source, label: ctx.label, runId: ctx.runId,
        balance: last.balance, equity: last.equity, netPnl: null, drawdownPct: last.drawdownPct, asOfTs: last.ts,
        note: 'End state of the latest completed run — not a live account.' }
        : noData('the latest run recorded no equity curve');
      out.openPosition = noData('no session is running; a completed run holds no open position');
      var regimes = ctx.tables.rows('regimes');
      var bySymbol = {};
      regimes.forEach(function (r) { bySymbol[r.symbol] = r.regime; });
      out.regime = regimes.length ? { available: true, bySymbol: bySymbol, asOfTs: regimes[regimes.length - 1].ts,
        note: 'Last classification in the latest completed run.' } : noData('the latest run recorded no regime');
    } else {
      out.account = noData(ctx.reason);
      out.openPosition = noData(ctx.reason);
      out.regime = noData(ctx.reason);
    }

    if (ctx.available) {
      var trs = ctx.tables.rows('trades');
      var doc = ctx.live || ctx.source === 'PAPER_SESSION' ? null : runs.readDoc(ctx.runId, 'result.json');
      var m = doc && doc.metrics ? doc.metrics
        : agent.metrics.compute({ trades: trs, initialCapital: cfg.account.initialCapital,
            equityCurve: ctx.tables.rows('equity_curve').map(function (r) { return { ts: r.ts, equity: r.equity }; }) });
      var streak = 0;
      for (var i = trs.length - 1; i >= 0 && trs[i].outcome === 'LOSS'; i--) streak++;
      out.performance = {
        available: true, source: ctx.source, label: ctx.label, runId: ctx.runId, trades: m.tradeCount,
        winRate: m.winRate, profitFactor: m.profitFactor, expectancy: m.expectancy, netPnl: m.netPnl,
        grossPnl: m.grossPnl, totalCosts: m.totalCosts, maxDrawdownPct: m.maxDrawdownPct,
        losingStreak: streak, maxLosingStreak: m.maxConsecutiveLosses,
        insufficient: m.tradeCount < 20,
        note: m.tradeCount === 0 ? 'no trade has closed' : (m.tradeCount < 20 ? 'fewer than 20 trades: these figures are not evidence' : null)
      };
      if (out.account && out.account.available && out.account.netPnl === null) out.account.netPnl = m.netPnl;

      var js = views.jevSummary(ctx.tables, 20);
      out.jev = js.verdicts ? { available: true, verdicts: js.verdicts, allowed: js.allowed, blocked: js.blocked,
        threshold: js.threshold, minConfidence: js.minConfidence, last: js.last }
        : noData('no Jev verdict is recorded in this source');
      var rs = views.riskSummary(ctx.tables);
      out.risk = rs.assessments ? { available: true, assessments: rs.assessments, byVerdict: rs.byVerdict,
        lastAssessment: rs.lastAssessment, exposure: rs.exposure }
        : noData('the Risk Engine has not been consulted in this source');
      var rc = views.recoverySummary(ctx.tables, null);
      out.recovery = { available: true, enabled: cfg.recovery.enabled, maxRecoveryLevel: cfg.recovery.maxRecoveryLevel,
        transitions: rc.transitions, perAsset: rc.perAsset,
        note: rc.transitions === 0 ? (cfg.recovery.enabled ? 'no recovery transition is recorded' : 'recovery is disabled') : null };
    } else {
      out.performance = noData(ctx.reason);
      out.jev = noData(ctx.reason);
      out.risk = noData(ctx.reason);
      out.recovery = noData(ctx.reason);
    }
    out.jev.configured = { model: cfg.jev.model, scoreThreshold: cfg.jev.scoreThreshold, minConfidence: cfg.jev.minConfidence };
    out.risk.limits = riskLimits();
    out.risk.emergencyStopConfigured = cfg.risk.emergencyStop === true;

    var act = activity({ limit: 12 });
    out.recentActivity = act.items.length ? { available: true, items: act.items } : noData('nothing has been recorded yet');
    var errs = activity({ severity: 'ERROR', limit: 8 });
    out.errors = { available: true, count: errs.total, items: errs.items };
    return out;
  }

  function riskLimits() {
    var r = control.config().risk;
    return {
      maxAccountRiskPerTradePct: r.maxAccountRiskPerTradePct, maxPositionSizeLots: r.maxPositionSizeLots,
      maxOpenTrades: r.maxOpenTrades, maxDailyLossPct: r.maxDailyLossPct, maxDrawdownPct: r.maxDrawdownPct,
      maxConsecutiveLosses: r.maxConsecutiveLosses, consecutiveLossCooldownHours: r.consecutiveLossCooldownHours,
      maxSpreadMultiple: r.maxSpreadMultiple, minStopPips: r.minStopPips, maxStopPips: r.maxStopPips,
      minRewardRisk: r.minRewardRisk, minNetExpectedValue: r.minNetExpectedValue, emergencyStop: r.emergencyStop
    };
  }

  function system(deps) {
    var d = deps || {};
    var cfg = control.config();
    var h = health();
    var mem = process.memoryUsage();
    var latest = runs.latest(['BACKTEST']);
    var pv = paper.view();
    function comp(name, statusValue, detail) { return { component: name, status: statusValue, detail: detail }; }
    var stat = {};
    h.staticChecks.forEach(function (c) { stat[c.check] = c; });
    var components = [
      comp('Trading Agent', stat.NO_NETWORK_CLIENT.status === 'OK' && stat.LIVE_EXECUTION_REFUSED.status === 'OK' ? 'OK' : 'FAIL',
        agent.strategyIds().length + ' strategy families loaded; ' + stat.LIVE_EXECUTION_REFUSED.detail),
      comp('API', 'OK', 'serving; ' + Math.round((now() - startedAt) / 1000) + ' s uptime'),
      comp('Store', state.persistent ? 'OK' : 'WARN', state.persistent ? 'persistent state directory' : state.describe().note),
      comp('Worker', runs.busy() ? 'BUSY' : 'OK', runs.busy() ? 'running ' + runs.active().runId : 'idle; one run at a time'),
      comp('Paper', control.mode() === 'PAPER' ? (pv.state === 'HALTED' ? 'FAIL' : 'OK') : 'UNAVAILABLE',
        control.mode() === 'PAPER' ? 'session ' + pv.state : 'platform is in ' + control.mode() + '; PAPER needs an owner-approval record'),
      comp('Backtest', latest ? 'OK' : 'UNKNOWN', latest ? 'latest ' + latest.runId + ' at ' + latest.finishedAt : 'no backtest has completed'),
      comp('Analysis', latest ? 'OK' : 'UNKNOWN', latest ? 'report stored with ' + latest.runId : 'no run to analyse'),
      comp('Research', research.replayProblems().length ? 'WARN' : 'OK',
        research.replayProblems().length ? research.replayProblems().length + ' journal entr(ies) could not be replayed' : 'registry consistent with its journal'),
      comp('Jev', 'OK', 'model ' + cfg.jev.model + ', threshold ' + cfg.jev.scoreThreshold + ', min confidence ' + cfg.jev.minConfidence),
      comp('Risk', cfg.risk.emergencyStop ? 'STOPPED' : 'OK',
        cfg.risk.emergencyStop ? 'emergency stop is set — every candidate is blocked' : 'limits loaded; Risk Engine is the final authority on size')
    ];
    return {
      version: VERSION,
      commit: commit,
      commitKnown: !!commit,
      environment: process.env.NODE_ENV || 'development',
      node: process.version,
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      mode: control.mode(),
      configFingerprint: cfg.fingerprint.hash,
      components: components,
      health: h,
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
      persistence: state.describe(),
      runs: { retained: runs.list().length, limits: runs.limits() },
      audit: d.audit ? { entries: d.audit.count(), head: d.audit.head(), integrityAtStart: d.audit.loadedIntegrity() } : null,
      auth: d.auth ? d.auth.userState() : null,
      sessions: d.auth ? d.auth.sessionCount() : null,
      deployment: {
        service: 'mythos-trading-control-center',
        bind: d.bind || null,
        publicOrigin: d.publicOrigin || null,
        webBuild: d.webBuild || null,
        releaseCommit: commit
      },
      liveExecution: { available: false, adapter: 'live-refusing-stub', refusalVerified: stat.LIVE_EXECUTION_REFUSED.status === 'OK' },
      events: systemEvents.slice(-50).reverse()
    };
  }

  // =====================================================================
  // activity — one timeline over the audit chain, the stores and this process
  // =====================================================================

  var ACTIVITY_TYPES = ['configuration', 'agent', 'candidate', 'decision', 'trade', 'risk', 'jev', 'recovery',
    'test', 'backtest', 'paper', 'error', 'warning', 'system'];

  function auditType(action) {
    if (/^config\.|^mode\.|^trading\.|^strategies\./.test(action)) return 'configuration';
    if (/^paper\./.test(action)) return 'paper';
    if (/^backtest\./.test(action)) return 'backtest';
    if (/^testing\./.test(action)) return 'test';
    if (/^research\./.test(action)) return 'agent';
    return 'system';
  }

  var auditRef = null;
  function attachAudit(a) { auditRef = a; }

  /**
   * @param {object} q { type, severity, asset, strategy, fromTs, toTs, limit, offset, run }
   */
  function activity(q) {
    var f = q || {};
    var items = [];

    if (auditRef) {
      auditRef.list({ limit: 2000 }).items.forEach(function (a) {
        items.push({
          at: a.ts, ts: null, type: auditType(a.action),
          severity: a.outcome === 'ACCEPTED' ? 'INFO' : (a.outcome === 'REFUSED' ? 'WARN' : 'ERROR'),
          asset: null, strategy: null,
          message: a.action + ' ' + a.outcome + (a.code ? ' (' + a.code + ')' : '') + ' by ' + a.actor.id +
            (a.reason ? ' — ' + a.reason : ''),
          ref: { auditSeq: a.seq, hash: a.hash }, source: 'AUDIT', clock: 'WALL'
        });
      });
    }
    systemEvents.forEach(function (e) {
      items.push({ at: e.ts, ts: null, type: e.severity === 'ERROR' ? 'error' : (e.severity === 'WARN' ? 'warning' : 'system'),
        severity: e.severity, asset: null, strategy: null, message: e.kind + ': ' + e.message, ref: null,
        source: 'CONTROL_CENTER', clock: 'WALL' });
    });
    runs.list().slice(0, 40).forEach(function (r) {
      items.push({ at: r.finishedAt || r.startedAt, ts: null, type: r.kind === 'BACKTEST' || r.kind === 'EXPERIMENT' ? 'backtest' : 'paper',
        severity: r.status === 'COMPLETED' || r.status === 'RUNNING' ? 'INFO' : 'ERROR', asset: null, strategy: null,
        message: r.kind + ' ' + r.runId + ' ' + r.status + (r.error ? ': ' + r.error.message : ''),
        ref: { runId: r.runId }, source: 'RUNS', clock: 'WALL' });
    });
    testing.view().runs.slice(0, 20).forEach(function (r) {
      items.push({ at: r.finishedAt || r.startedAt, ts: null, type: 'test',
        severity: r.status === 'FAILED' ? 'ERROR' : 'INFO', asset: null, strategy: null,
        message: 'test run ' + r.runId + ' ' + r.status + ' — ' + r.totals.passed + ' passed, ' + r.totals.failed + ' failed, ' + r.totals.skipped + ' skipped',
        ref: { testRunId: r.runId }, source: 'TESTING', clock: 'WALL' });
    });

    // Store-derived events are stamped with the BAR's time, which for synthetic
    // data is not the wall clock. They are kept on their own clock and labelled.
    var ctx;
    try { ctx = context({ run: f.run }); } catch (e) { ctx = noData(e.message); }
    var storeItems = [];
    if (ctx.available) {
      storeItems = views.storeEvents(ctx.tables, ctx.source + ':' + ctx.runId).map(function (e) {
        return { at: null, ts: e.ts, type: e.type, severity: e.severity, asset: e.asset, strategy: e.strategy,
          message: e.message, ref: e.ref, source: e.source, clock: 'BAR' };
      });
    }

    function keep(e) {
      if (f.type && e.type !== f.type) return false;
      if (f.severity && e.severity !== f.severity) return false;
      if (f.asset && e.asset !== f.asset) return false;
      if (f.strategy && e.strategy !== f.strategy) return false;
      var t = e.clock === 'WALL' ? Date.parse(e.at) : e.ts;
      if (f.fromTs !== undefined && (t === null || t < f.fromTs)) return false;
      if (f.toTs !== undefined && (t === null || t > f.toTs)) return false;
      return true;
    }
    var wall = items.filter(keep).sort(function (a, b) { return a.at < b.at ? 1 : (a.at > b.at ? -1 : 0); });
    // Newest bar first. The sort is stable, so rows that share a bar keep the
    // order the pipeline wrote them in.
    var bar = storeItems.filter(keep);
    bar.sort(function (a, b) { return b.ts - a.ts; });
    // Wall-clock events first (they are what the operator did), then the
    // store's events in reverse bar order. Two clocks are never interleaved.
    var all = wall.concat(bar);
    var limit = Math.min(Math.max(f.limit || 100, 1), 500);
    var offset = Math.max(f.offset || 0, 0);
    return {
      total: all.length, limit: limit, offset: offset, items: all.slice(offset, offset + limit),
      types: ACTIVITY_TYPES, severities: ['INFO', 'WARN', 'ERROR'],
      storeSource: contextHeader(ctx),
      clocks: { WALL: 'operator actions, runs and tests — real time', BAR: 'store rows — the simulated bar time of the data' }
    };
  }

  // =====================================================================
  // explorers
  // =====================================================================

  function strategies(q) {
    var meta = strategiesMeta();
    var ctx = context(q);
    return {
      context: contextHeader(ctx),
      enabled: control.enabledStrategies(),
      strategies: ctx.available ? views.strategyStats(ctx.tables, meta, 20)
        : meta.map(function (s) { return Object.assign({}, s, { candidates: null, entered: null, rejectedByStage: null, byRegime: null, trades: null }); }),
      minSample: 20
    };
  }

  function analysisFor(q) {
    var f = q || {};
    var ctx = context(f);
    if (!ctx.available) return { context: ctx, analysis: null };
    if (ctx.source === 'PAPER_SESSION') {
      var live = paper.liveStore(f.arm);
      var report = agent.analysisAgent.create({ minSample: 20 }).analyse({
        store: live.store, initialCapital: live.config.account.initialCapital, label: 'paper-live'
      });
      return { context: contextHeader(ctx), analysis: report, computed: 'LIVE' };
    }
    var doc = runs.readDoc(ctx.runId, 'analysis.json');
    if (!doc) return { context: contextHeader(ctx), analysis: null, reason: 'no Analysis Agent report is stored for run ' + ctx.runId };
    return { context: contextHeader(ctx), analysis: doc, computed: 'STORED' };
  }

  function chainFor(candidateId, q) {
    var ctx = context(q);
    if (!ctx.available) return { context: ctx, chain: null };
    var an = analysisFor(q).analysis;
    return { context: contextHeader(ctx), chain: views.chain(ctx.tables, candidateId, an) };
  }

  function researchFor(q) {
    var f = q || {};
    var out = { registry: research.view(), report: null, context: null, experiments: [] };
    var ctx = context(f);
    if (!ctx.available) { out.context = ctx; }
    else if (ctx.source === 'PAPER_SESSION') {
      out.context = contextHeader(ctx);
      var live = paper.liveStore(f.arm);
      var report = agent.analysisAgent.create({ minSample: 10 }).analyse({
        store: live.store, initialCapital: live.config.account.initialCapital });
      out.report = agent.researchAgent.create({ minSample: 10 }).research({ report: report, config: live.config });
    } else {
      out.context = contextHeader(ctx);
      out.report = runs.readDoc(ctx.runId, 'research.json');
      if (!out.report) out.reportReason = 'no Research Agent report is stored for run ' + ctx.runId;
    }
    out.experiments = runs.list({ kind: 'EXPERIMENT' }).slice(0, 20).map(function (r) {
      var res = r.status === 'COMPLETED' ? runs.readDoc(r.runId, 'result.json') : null;
      return { run: r, result: res };
    });
    return out;
  }

  // =====================================================================
  // backtests and experiments
  // =====================================================================

  /**
   * Builds the full override object a job runs under from the Backtest
   * Center's inputs. Validated here, by the agent's own loader, BEFORE a
   * process is forked — a bad request costs a 400, not a failed run.
   */
  function backtestOverrides(q) {
    var over = control.overrides();
    var extra = {};
    var dataSpec = Object.assign({ kind: 'FIXTURE' }, q.data || {});
    if (q.symbols) { extra.universe = q.symbols; dataSpec.symbols = q.symbols; }
    if (q.initialCapital !== undefined) extra.account = { initialCapital: q.initialCapital };
    if (q.jev) extra.jev = q.jev;
    if (q.risk) extra.risk = q.risk;
    if (q.recovery) extra.recovery = q.recovery;
    if (q.cost) extra.cost = q.cost;
    if (q.timeframe) {
      extra.backtest = { baseTimeframe: q.timeframe };
      dataSpec.timeframe = q.timeframe;
    }
    if (q.seed !== undefined) extra.backtest = Object.assign(extra.backtest || {}, { seed: q.seed });
    if (q.label) extra.label = q.label;
    var merged = agent.config.deepMerge(over, extra);
    var enabled = q.strategies || control.enabledStrategies();
    var unknown = enabled.filter(function (id) { return agent.strategyIds().indexOf(id) === -1; });
    if (unknown.length) throw refusal('UNKNOWN_STRATEGY', 'unknown strategy id(s): ' + unknown.join(', '));
    if (enabled.length === 0) throw refusal('NO_STRATEGY_ENABLED', 'a backtest needs at least one strategy');
    var cfg = agent.buildConfig(merged, enabled);       // throws ConfigError
    if (!dataSpec.symbols) {
      dataSpec.symbols = dataSpec.kind === 'FIXTURE'
        ? cfg.universe.filter(function (s) { return agent.dataCatalog().kinds[0].symbols.indexOf(s) !== -1; })
        : cfg.universe.slice();
      if (dataSpec.symbols.length === 0) {
        throw refusal('NO_DATA_FOR_UNIVERSE', 'no committed fixture exists for any asset in the universe; choose the SYNTHETIC source');
      }
      if (dataSpec.symbols.length !== cfg.universe.length) {
        merged = agent.config.deepMerge(merged, { universe: dataSpec.symbols });
        cfg = agent.buildConfig(merged, enabled);
      }
    }
    if (q.fromTs !== undefined) dataSpec.fromTs = q.fromTs;
    if (q.toTs !== undefined) dataSpec.toTs = q.toTs;
    var dataset = agent.loadDataset(cfg, dataSpec);     // throws DataError
    return { overrides: merged, enabled: enabled, config: cfg, dataSpec: dataSpec, dataset: dataset };
  }

  function startBacktest(q, actor) {
    var built = backtestOverrides(q);
    var label = built.dataset.provenance.label;
    return runs.start({
      kind: 'BACKTEST',
      label: q.label || 'backtest',
      actor: actor,
      configHash: built.config.fingerprint.hash,
      data: { kind: built.dataset.provenance.kind, label: label, datasetVersion: built.dataset.datasetVersion,
        timeframe: built.dataset.timeframe, symbols: built.dataset.symbols, window: built.dataset.window },
      summarySpec: {
        symbols: built.dataset.symbols, timeframe: built.dataset.timeframe, data: built.dataSpec,
        strategies: built.enabled, initialCapital: built.config.account.initialCapital,
        jev: { scoreThreshold: built.config.jev.scoreThreshold, minConfidence: built.config.jev.minConfidence },
        recovery: { enabled: built.config.recovery.enabled, maxRecoveryLevel: built.config.recovery.maxRecoveryLevel },
        cost: agent.config.serialise(built.config).cost,
        risk: agent.config.serialise(built.config).risk
      },
      spec: { overrides: built.overrides, enabledStrategies: built.enabled, data: built.dataSpec,
        verifyReproducible: q.verifyReproducible !== false, minSample: 20 }
    });
  }

  function startExperiment(q, actor) {
    var found = research.findProposal(q.runId, q.proposalId);
    var source = runs.get(q.runId);
    var sourceResult = runs.readDoc(q.runId, 'result.json');
    var dataSpec = sourceResult && sourceResult.data && sourceResult.data.provenance
      ? { kind: sourceResult.data.provenance.kind, symbols: sourceResult.data.symbols, timeframe: sourceResult.data.timeframe,
          seed: sourceResult.data.provenance.seed }
      : { kind: 'FIXTURE' };
    if (source.request && source.request.data && source.request.data.bars) dataSpec.bars = source.request.data.bars;
    var overrides = agent.config.deepMerge(control.overrides(), { universe: dataSpec.symbols || control.config().universe });
    var enabled = control.enabledStrategies();
    var baseline = agent.buildConfig(overrides, enabled);
    var applied = agent.applyProposal(overrides, enabled, found.proposal.override);
    agent.buildConfig(applied.overrides, applied.enabled);   // validates the variant
    agent.loadDataset(baseline, dataSpec);
    return runs.start({
      kind: 'EXPERIMENT',
      label: 'experiment-' + found.proposal.proposalId,
      actor: actor,
      configHash: baseline.fingerprint.hash,
      data: { kind: dataSpec.kind, label: 'SYNTHETIC', symbols: dataSpec.symbols || baseline.universe },
      summarySpec: { sourceRunId: q.runId, proposalId: found.proposal.proposalId, hypothesisId: found.proposal.hypothesisId,
        override: found.proposal.override },
      spec: { overrides: overrides, enabledStrategies: enabled, data: dataSpec,
        proposal: { proposalId: found.proposal.proposalId, hypothesisId: found.proposal.hypothesisId,
          override: found.proposal.override, hypothesis: found.hypothesis } }
    });
  }

  function backtestList() {
    return {
      runs: runs.list().filter(function (r) { return r.kind !== 'EXPERIMENT'; }),
      active: runs.active(),
      limits: runs.limits(),
      data: agent.dataCatalog()
    };
  }

  function backtestRun(runId) {
    var run = runs.get(runId);
    if (!run) return null;
    var result = run.status === runsMod.Status.COMPLETED || run.kind !== 'BACKTEST' ? runs.readDoc(runId, 'result.json') : null;
    var charts = null;
    if (result && run.kind !== 'EXPERIMENT') {
      var t = runs.tables(runId, 'store');
      if (t) charts = views.charts(views.fromTables(t.tables));
    }
    return { run: run, result: result, charts: charts,
      dataLabel: run.label === 'PAPER' ? 'PAPER' : (run.data ? run.data.label : null) };
  }

  function backtestOptions() {
    var cfg = control.config();
    return {
      data: agent.dataCatalog(),
      assets: cfg.catalog.symbols.slice(),
      universe: cfg.universe.slice(),
      strategies: strategiesMeta(),
      defaults: {
        initialCapital: cfg.account.initialCapital,
        jev: { scoreThreshold: cfg.jev.scoreThreshold, minConfidence: cfg.jev.minConfidence },
        recovery: { enabled: cfg.recovery.enabled, maxRecoveryLevel: cfg.recovery.maxRecoveryLevel },
        cost: agent.config.serialise(cfg).cost,
        risk: riskLimits(),
        timeframe: cfg.backtest.baseTimeframe
      },
      ranges: control.view().ranges,
      timeframes: { FIXTURE: ['M15'], SYNTHETIC: agent.SYNTHETIC_TIMEFRAMES },
      maxSyntheticBars: agent.MAX_SYNTHETIC_BARS
    };
  }

  // =====================================================================
  // mutations that span modules
  // =====================================================================

  function updateConfig(q, actor) {
    refuseWhilePaperActive('change the configuration');
    return control.updateConfig(q, actor);
  }

  function setStrategies(q, actor) {
    refuseWhilePaperActive('change the enabled strategies');
    return control.setStrategies(q, actor);
  }

  function setTrading(q, actor) {
    var stopped = false;
    if (q.enabled) refuseWhilePaperActive('enable trading');
    else stopped = paper.stopIfActive('TRADING_DISABLED');     // rule 1: never wait
    var res = control.setTrading(q, actor);
    res.paperSessionStopped = stopped;
    return res;
  }

  function setMode(q, actor) {
    var from = control.mode();
    var isUpgrade = agent.mode.MODE_RANK[q.to] !== undefined && agent.mode.MODE_RANK[q.to] > agent.mode.MODE_RANK[from];
    var stopped = false;
    if (isUpgrade) {
      // The static safety checks must hold before the mode may rise. If the
      // live adapter did not refuse, nothing else on this page can be trusted.
      var bad = staticHealth().filter(function (c) {
        return (c.check === 'LIVE_EXECUTION_REFUSED' || c.check === 'NO_NETWORK_CLIENT') && c.status !== 'OK';
      });
      if (bad.length) {
        throw refusal('SAFETY_CHECK_FAILED', 'the mode cannot be raised while a safety check is failing: ' +
          bad.map(function (c) { return c.check + ' — ' + c.detail; }).join('; '));
      }
    } else if (q.to !== from) {
      stopped = paper.stopIfActive('MODE_DOWNGRADE');
    }
    var res = control.setMode(q, actor);
    res.paperSessionStopped = stopped;
    staticHealthCache = null;
    return res;
  }

  function shutdown() {
    paper.shutdown();
    runs.shutdown();
    testing.shutdown();
    state.close();
  }

  return {
    VERSION: VERSION,
    agent: agent,
    state: state,
    control: control,
    runs: runs,
    paper: paper,
    research: research,
    testing: testing,
    agentRoot: agentRoot,
    commit: function () { return commit; },
    attachAudit: attachAudit,
    systemEvent: systemEvent,
    context: context,
    withContext: withContext,
    status: status,
    dashboard: dashboard,
    health: health,
    system: system,
    activity: activity,
    strategies: strategies,
    analysisFor: analysisFor,
    researchFor: researchFor,
    chainFor: chainFor,
    riskLimits: riskLimits,
    startBacktest: startBacktest,
    startExperiment: startExperiment,
    backtestList: backtestList,
    backtestRun: backtestRun,
    backtestOptions: backtestOptions,
    updateConfig: updateConfig,
    setStrategies: setStrategies,
    setTrading: setTrading,
    setMode: setMode,
    shutdown: shutdown
  };
}

module.exports = {
  create: create,
  resolveCommit: resolveCommit,
  VERSION: VERSION,
  PROJECT_ROOT: PROJECT_ROOT
};
