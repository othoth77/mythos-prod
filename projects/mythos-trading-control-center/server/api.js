'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — API route table
// projects/mythos-trading-control-center/server/api.js
//
// EVERY ROUTE THE SERVER ANSWERS IS IN THE ONE ARRAY BELOW. There is no
// second place a route can be registered, so the write surface is a list a
// reviewer can read top to bottom — and tests/security-test.js walks this
// same array to assert that every route has a role and every mutation has an
// audit action.
//
// A route declares:
//   method, path   the path may contain :params (validated by pattern)
//   role           VIEWER | OPERATOR | OWNER, or null for the two public routes
//   bucket         the rate-limit bucket
//   query / body   the declared shape; unknown keys are refused
//   audit          the audit action — REQUIRED on anything that is not a GET
//   handler(ctx)   returns the response body, or { result, audit } for mutations
//
// The mutation contract, enforced by server.js around every non-GET route:
//   authenticate → authorize → validate → execute → audit → deterministic result
//
// THERE IS NO LIVE EXECUTION ROUTE. Not a disabled one, not a hidden one:
// no handler in this file sends an order, and the only mode targets the mode
// route can pass on are BACKTEST and PAPER.
// =====================================================

var v = require('./validate');
var views = require('./views');
var authMod = require('./auth');

var HEX64 = /^[0-9a-f]{64}$/;
var RUN_ID = /^(bt|ex|pp)-[0-9]{14}-[0-9a-f]{6}$/;
var TEST_RUN_ID = /^tr-[0-9]{14}-[0-9a-f]{6}$/;
var ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/;
var SYMBOL = /^[A-Z0-9]{3,16}$/;
var STRATEGY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

var reason = v.str({ minLength: 5, maxLength: 500 });
var symbols = v.arr(v.str({ pattern: SYMBOL }), { minItems: 1, maxItems: 16, unique: true });

function forbidden(message) {
  var e = new Error(message);
  e.code = 'FORBIDDEN';
  e.http = 403;
  return e;
}

function notFound(what) {
  var e = new Error(what + ' not found');
  e.code = 'NOT_FOUND';
  e.http = 404;
  return e;
}

function confirmationRequired(message, extra) {
  var e = new Error(message);
  e.code = 'CONFIRMATION_REQUIRED';
  e.http = 409;
  e.refusal = true;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

var pageQuery = {
  run: v.opt(v.str({ pattern: RUN_ID })),
  arm: v.opt(v.str({ values: ['main', 'champion', 'challenger'] })),
  limit: v.opt(v.int(1, 500)),
  offset: v.opt(v.int(0, 1000000))
};

function q(fields) {
  return v.obj(Object.assign({}, pageQuery, fields || {}));
}

var dataSpec = v.obj({
  kind: v.opt(v.str({ values: ['FIXTURE', 'SYNTHETIC', 'HISTORICAL'] })),
  bars: v.opt(v.int(300, 6000)),
  seed: v.opt(v.str({ minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_.:-]+$/ })),
  symbols: v.opt(symbols),
  timeframe: v.opt(v.str({ values: ['M5', 'M15', 'M30', 'H1'] }))
});

/**
 * @param {object} deps { platform, audit, auth }
 * @returns {object[]} the route table
 */
function routes(deps) {
  var platform = deps.platform;
  var audit = deps.audit;
  var control = platform.control;

  function fp() { return control.config().fingerprint.hash; }

  return [
    // ------------------------------------------------------------------
    // public
    // ------------------------------------------------------------------
    {
      method: 'GET', path: '/api/health', role: null, bucket: 'read',
      // Liveness only. Everything diagnostic is behind the session.
      handler: function (ctx) {
        var out = { ok: true, service: 'mythos-trading-control-center', time: new Date().toISOString() };
        if (ctx.actor) {
          var h = platform.health();
          out.mode = control.mode();
          out.health = { status: h.status, counts: h.counts };
          out.liveExecutionAvailable = false;
        }
        return out;
      }
    },

    // ------------------------------------------------------------------
    // status, dashboard
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/status', role: 'VIEWER', bucket: 'read', handler: function () { return platform.status(); } },
    { method: 'GET', path: '/api/dashboard', role: 'VIEWER', bucket: 'read', handler: function () { return platform.dashboard(); } },

    // ------------------------------------------------------------------
    // configuration
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/config', role: 'VIEWER', bucket: 'read', handler: function () { return control.view(); } },
    {
      method: 'GET', path: '/api/config/history', role: 'VIEWER', bucket: 'read',
      query: v.obj({ limit: v.opt(v.int(1, 500)), offset: v.opt(v.int(0, 1000000)) }),
      handler: function (ctx) {
        var h = control.history(ctx.query);
        return { total: h.total, items: h.items, modeEvents: control.modeEvents(50) };
      }
    },
    {
      method: 'PATCH', path: '/api/config', role: 'OWNER', bucket: 'write', audit: 'config.update',
      body: v.obj({
        changes: { type: 'any' },
        reason: reason,
        expectedFingerprint: v.opt(v.str({ pattern: HEX64 })),
        confirm: v.opt(v.str({ values: ['CONFIRM'] }))
      }),
      handler: function (ctx) {
        var b = ctx.body;
        // Preview first: a change that loosens a protection is not applied
        // until the request says, explicitly, that it means to.
        var pre = control.preview({ changes: b.changes });
        if (pre.loosened.length && b.confirm !== 'CONFIRM') {
          throw confirmationRequired(
            'this change loosens ' + pre.loosened.length + ' protection(s); resend with confirm: "CONFIRM" to apply it',
            { loosened: pre.loosened, wouldResetMode: pre.wouldResetMode });
        }
        var res = platform.updateConfig({ changes: b.changes, reason: b.reason, expectedFingerprint: b.expectedFingerprint }, ctx.actor);
        return {
          result: { changed: res.changed, diff: res.diff, fingerprint: res.fingerprintAfter, revision: res.revision,
            modeReset: res.modeReset, mode: control.mode(), loosened: pre.loosened },
          audit: { target: 'config', reason: b.reason, oldValue: toMap(res.diff, 'oldValue'), newValue: toMap(res.diff, 'newValue'),
            fingerprintBefore: res.fingerprintBefore, fingerprintAfter: res.fingerprintAfter,
            detail: { changed: res.changed, modeReset: res.modeReset, loosened: pre.loosened.map(function (l) { return l.path; }) } }
        };
      }
    },
    {
      method: 'POST', path: '/api/config/preview', role: 'OPERATOR', bucket: 'read', audit: 'config.preview', auditRefusalsOnly: true,
      body: v.obj({ changes: { type: 'any' } }),
      handler: function (ctx) { return { result: control.preview({ changes: ctx.body.changes }) }; }
    },
    {
      method: 'POST', path: '/api/config/strategies', role: 'OWNER', bucket: 'write', audit: 'strategies.update',
      body: v.obj({
        enabled: v.arr(v.str({ pattern: STRATEGY, maxLength: 64 }), { minItems: 1, maxItems: 32, unique: true }),
        reason: reason,
        expectedFingerprint: v.opt(v.str({ pattern: HEX64 }))
      }),
      handler: function (ctx) {
        var before = control.enabledStrategies();
        var res = platform.setStrategies(ctx.body, ctx.actor);
        return {
          result: { changed: res.changed, enabled: control.enabledStrategies(), fingerprint: res.fingerprintAfter,
            revision: res.revision, modeReset: res.modeReset, mode: control.mode() },
          audit: { target: 'strategies', reason: ctx.body.reason, oldValue: before, newValue: control.enabledStrategies(),
            fingerprintBefore: res.fingerprintBefore, fingerprintAfter: res.fingerprintAfter, detail: { modeReset: res.modeReset } }
        };
      }
    },
    {
      // Disabling reduces exposure, so an OPERATOR may do it. Enabling does not,
      // so it needs the OWNER and an explicit confirmation.
      method: 'POST', path: '/api/config/trading', role: 'OPERATOR', bucket: 'write', audit: 'trading.set',
      body: v.obj({
        enabled: v.bool(),
        reason: reason,
        confirm: v.opt(v.str({ values: ['ENABLE'] })),
        expectedFingerprint: v.opt(v.str({ pattern: HEX64 }))
      }),
      handler: function (ctx) {
        var b = ctx.body;
        if (b.enabled) {
          if (ctx.actor.role !== 'OWNER') throw forbidden('only an OWNER may enable trading');
          if (b.confirm !== 'ENABLE') throw confirmationRequired('enabling trading requires confirm: "ENABLE"');
        }
        var was = control.tradingEnabled();
        var res = platform.setTrading(b, ctx.actor);
        return {
          result: { changed: res.changed, tradingEnabled: control.tradingEnabled(), fingerprint: res.fingerprintAfter,
            modeReset: res.modeReset, mode: control.mode(), paperSessionStopped: res.paperSessionStopped },
          audit: { target: 'trading', reason: b.reason, oldValue: { tradingEnabled: was }, newValue: { tradingEnabled: control.tradingEnabled() },
            fingerprintBefore: res.fingerprintBefore, fingerprintAfter: res.fingerprintAfter,
            detail: { modeReset: res.modeReset, paperSessionStopped: res.paperSessionStopped } }
        };
      }
    },
    {
      method: 'GET', path: '/api/config/mode', role: 'VIEWER', bucket: 'read',
      handler: function () {
        return {
          mode: control.mode(),
          modesAvailable: ['BACKTEST', 'PAPER'],
          liveAvailable: false,
          toPaper: control.mode() === 'BACKTEST' ? control.modeRequirements('PAPER') : null,
          events: control.modeEvents(30),
          note: 'DEMO is a two-arm PAPER session (champion vs challenger); it is not a separate execution mode.'
        };
      }
    },
    {
      method: 'POST', path: '/api/config/mode/dry-run', role: 'OPERATOR', bucket: 'read', audit: 'mode.dry-run', auditRefusalsOnly: true,
      body: modeBody(false),
      handler: function (ctx) { return { result: control.dryRunMode(ctx.body, ctx.actor) }; }
    },
    {
      // Role OPERATOR at the door because a DOWNGRADE is open to an operator;
      // an upgrade is checked for OWNER inside, and then by the agent itself.
      method: 'POST', path: '/api/config/mode', role: 'OPERATOR', bucket: 'write', audit: 'mode.set',
      body: modeBody(true),
      handler: function (ctx) {
        var b = ctx.body;
        var from = control.mode();
        var rank = platform.agent.mode.MODE_RANK;
        // A target this console cannot select is refused BY NAME first, whoever
        // asks: "LIVE does not exist" is the answer, not "you lack the role".
        if (b.to !== 'BACKTEST' && b.to !== 'PAPER') platform.setMode(b, ctx.actor);
        var upgrade = rank[b.to] > rank[from];
        if (upgrade && ctx.actor.role !== 'OWNER') throw forbidden('only an OWNER may raise the execution mode');
        var before = fp();
        var res = platform.setMode(b, ctx.actor);
        return {
          result: { changed: res.changed, mode: res.mode, fromMode: from, approvalId: res.approvalId || null,
            paperSessionStopped: res.paperSessionStopped },
          audit: { target: 'mode', reason: b.reason, oldValue: { mode: from }, newValue: { mode: res.mode },
            fingerprintBefore: before, fingerprintAfter: fp(),
            detail: { direction: res.entry ? res.entry.direction : 'NOOP', approvalId: res.approvalId || null,
              gatesPassed: upgrade && b.approval ? b.approval.gatesPassed : null, paperSessionStopped: res.paperSessionStopped } }
        };
      }
    },

    // ------------------------------------------------------------------
    // strategies, candidates, decisions, trades
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/strategies', role: 'VIEWER', bucket: 'read', query: q(), handler: function (ctx) { return platform.strategies(ctx.query); } },
    {
      method: 'GET', path: '/api/candidates', role: 'VIEWER', bucket: 'read',
      query: q({
        symbol: v.opt(v.str({ pattern: SYMBOL })), strategy: v.opt(v.str({ pattern: STRATEGY, maxLength: 64 })),
        direction: v.opt(v.str({ values: ['LONG', 'SHORT'] })), regime: v.opt(v.str({ pattern: /^[A-Z_]{3,32}$/ })),
        decision: v.opt(v.str({ values: ['ENTER', 'NO_TRADE'] })), stage: v.opt(v.str({ pattern: /^[A-Z_]{3,32}$/ }))
      }),
      handler: function (ctx) { return platform.withContext(ctx.query, function (c) { return views.candidates(c.tables, ctx.query); }); }
    },
    {
      method: 'GET', path: '/api/decisions', role: 'VIEWER', bucket: 'read',
      query: q({
        symbol: v.opt(v.str({ pattern: SYMBOL })), strategy: v.opt(v.str({ pattern: STRATEGY, maxLength: 64 })),
        decision: v.opt(v.str({ values: ['ENTER', 'NO_TRADE'] })), stage: v.opt(v.str({ pattern: /^[A-Z_]{3,32}$/ }))
      }),
      handler: function (ctx) {
        var out = platform.withContext(ctx.query, function (c) { return views.decisions(c.tables, ctx.query); });
        out.stages = views.CHAIN_STAGES;
        return out;
      }
    },
    {
      method: 'GET', path: '/api/decisions/:candidateId', role: 'VIEWER', bucket: 'read',
      params: { candidateId: ID }, query: q(),
      handler: function (ctx) {
        var out = platform.chainFor(ctx.params.candidateId, ctx.query);
        if (out.context.available && !out.chain) throw notFound('candidate ' + ctx.params.candidateId);
        return out;
      }
    },
    {
      method: 'GET', path: '/api/trades', role: 'VIEWER', bucket: 'read',
      query: q({
        symbol: v.opt(v.str({ pattern: SYMBOL })), strategy: v.opt(v.str({ pattern: STRATEGY, maxLength: 64 })),
        direction: v.opt(v.str({ values: ['LONG', 'SHORT'] })), outcome: v.opt(v.str({ values: ['WIN', 'LOSS', 'BREAKEVEN'] })),
        regime: v.opt(v.str({ pattern: /^[A-Z_]{3,32}$/ }))
      }),
      handler: function (ctx) { return platform.withContext(ctx.query, function (c) { return views.trades(c.tables, ctx.query); }); }
    },
    {
      method: 'GET', path: '/api/trades/:tradeId', role: 'VIEWER', bucket: 'read',
      params: { tradeId: ID }, query: q(),
      handler: function (ctx) {
        var out = platform.withContext(ctx.query, function (c) { return views.trade(c.tables, ctx.params.tradeId); });
        if (out.context.available && !out.data) throw notFound('trade ' + ctx.params.tradeId);
        return out;
      }
    },

    // ------------------------------------------------------------------
    // Jev, risk, recovery
    // ------------------------------------------------------------------
    {
      method: 'GET', path: '/api/jev', role: 'VIEWER', bucket: 'read', query: q(),
      handler: function (ctx) {
        var cfg = control.config();
        var out = platform.withContext(ctx.query, function (c) { return views.jevSummary(c.tables, 20); });
        out.configured = { enabled: true, model: cfg.jev.model, scoreThreshold: cfg.jev.scoreThreshold,
          minConfidence: cfg.jev.minConfidence, thresholdBands: cfg.jev.thresholdBands };
        out.authority = 'DECISION_GATE — returns a verdict; it carries no size and cannot overrule the Risk Engine';
        return out;
      }
    },
    {
      method: 'GET', path: '/api/risk', role: 'VIEWER', bucket: 'read', query: q(),
      handler: function (ctx) {
        var out = platform.withContext(ctx.query, function (c) { return views.riskSummary(c.tables); });
        out.limits = platform.riskLimits();
        out.tradingEnabled = control.tradingEnabled();
        out.authority = 'FINAL — the Risk Engine is the last writer of position size; no route in this API sets a size';
        return out;
      }
    },
    {
      method: 'GET', path: '/api/recovery', role: 'VIEWER', bucket: 'read', query: q(),
      handler: function (ctx) {
        var cfg = control.config();
        var out = platform.withContext(ctx.query, function (c) { return views.recoverySummary(c.tables, null); });
        var ladder = [];
        for (var i = 0; i <= cfg.recovery.maxRecoveryLevel; i++) {
          ladder.push(Math.round(cfg.recovery.baseLots * Math.pow(cfg.recovery.multiplier, i) * 1e6) / 1e6);
        }
        out.configured = {
          enabled: cfg.recovery.enabled, baseLots: cfg.recovery.baseLots, multiplier: cfg.recovery.multiplier,
          maxRecoveryLevel: cfg.recovery.maxRecoveryLevel, resetOnWin: cfg.recovery.resetOnWin,
          requireFullRecoveryTp: cfg.recovery.requireFullRecoveryTp, abandonOnRiskBlock: cfg.recovery.abandonOnRiskBlock,
          requestedLadder: ladder, maxPositionSizeLots: cfg.risk.maxPositionSizeLots
        };
        out.authority = 'REQUEST ONLY — the ladder requests a size; the Risk Engine approves, clamps or blocks it';
        return out;
      }
    },

    // ------------------------------------------------------------------
    // paper / demo
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/paper', role: 'VIEWER', bucket: 'read', handler: function () { return platform.paper.view(); } },
    {
      method: 'GET', path: '/api/paper/events', role: 'VIEWER', bucket: 'read',
      query: v.obj({ since: v.opt(v.int(0, 1e12)), limit: v.opt(v.int(1, 1000)) }),
      handler: function (ctx) { return platform.paper.eventsSince(ctx.query.since || 0, ctx.query.limit); }
    },
    {
      method: 'POST', path: '/api/paper/start', role: 'OPERATOR', bucket: 'write', audit: 'paper.start',
      body: v.obj({
        data: v.opt(dataSpec),
        ticksPerSecond: v.opt(v.int(1, 400)),
        demo: v.opt(v.obj({ challengerRecordId: v.str({ pattern: ID }) }))
      }),
      handler: function (ctx) {
        var view = platform.paper.start(ctx.body, ctx.actor);
        return {
          result: view,
          audit: { target: 'paper:' + view.session.sessionId, newValue: { state: view.state, kind: view.session.kind,
            symbols: view.session.data.symbols, dataKind: view.session.data.kind }, fingerprintBefore: fp(), fingerprintAfter: fp() }
        };
      }
    },
    paperAction('pause', function (ctx) { return platform.paper.pause(ctx.actor); }),
    paperAction('resume', function (ctx) { return platform.paper.resume(ctx.actor); }),
    paperAction('stop', function (ctx) { return platform.paper.stop(ctx.actor); }),
    {
      method: 'POST', path: '/api/paper/reset', role: 'OPERATOR', bucket: 'write', audit: 'paper.reset',
      body: v.obj({ confirm: v.opt(v.str({ maxLength: 16 })) }),
      handler: function (ctx) {
        if (ctx.body.confirm !== 'RESET') throw confirmationRequired('resetting the control room requires confirm: "RESET"');
        var before = platform.paper.view();
        var view = platform.paper.reset(ctx.actor);
        return {
          result: view,
          audit: { target: 'paper', oldValue: { state: before.state, sessionId: before.session ? before.session.sessionId : null },
            newValue: { state: view.state }, detail: { archivedSession: before.session ? before.session.sessionId : null } }
        };
      }
    },
    {
      method: 'POST', path: '/api/paper/speed', role: 'OPERATOR', bucket: 'write', audit: 'paper.speed',
      body: v.obj({ ticksPerSecond: v.int(1, 400) }),
      handler: function (ctx) {
        var view = platform.paper.setSpeed(ctx.body.ticksPerSecond);
        return { result: view, audit: { target: 'paper', newValue: { ticksPerSecond: view.session.ticksPerSecond } } };
      }
    },

    // ------------------------------------------------------------------
    // backtests
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/backtest', role: 'VIEWER', bucket: 'read', handler: function () { return platform.backtestList(); } },
    { method: 'GET', path: '/api/backtest/options', role: 'VIEWER', bucket: 'read', handler: function () { return platform.backtestOptions(); } },
    {
      method: 'GET', path: '/api/backtest/:runId', role: 'VIEWER', bucket: 'read', params: { runId: RUN_ID },
      handler: function (ctx) {
        var out = platform.backtestRun(ctx.params.runId);
        if (!out) throw notFound('run ' + ctx.params.runId);
        return out;
      }
    },
    {
      method: 'POST', path: '/api/backtest', role: 'OPERATOR', bucket: 'heavy', audit: 'backtest.start',
      body: v.obj({
        label: v.opt(v.str({ minLength: 1, maxLength: 48, pattern: /^[A-Za-z0-9_.-]+$/ })),
        symbols: v.opt(symbols),
        timeframe: v.opt(v.str({ values: ['M5', 'M15', 'M30', 'H1'] })),
        data: v.opt(v.obj({
          kind: v.opt(v.str({ values: ['FIXTURE', 'SYNTHETIC', 'HISTORICAL'] })),
          bars: v.opt(v.int(300, 6000)),
          seed: v.opt(v.str({ minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_.:-]+$/ }))
        })),
        fromTs: v.opt(v.int(0, 4102444800000)),
        toTs: v.opt(v.int(0, 4102444800000)),
        strategies: v.opt(v.arr(v.str({ pattern: STRATEGY, maxLength: 64 }), { minItems: 1, maxItems: 32, unique: true })),
        initialCapital: v.opt(v.num(1, 1e9)),
        seed: v.opt(v.str({ minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_.:-]+$/ })),
        jev: v.opt(v.obj({ scoreThreshold: v.opt(v.num(0, 100)), minConfidence: v.opt(v.num(0, 1)) })),
        risk: v.opt(v.obj({
          maxAccountRiskPerTradePct: v.opt(v.num(0.01, 25)), maxPositionSizeLots: v.opt(v.num(0.01, 100)),
          maxDailyLossPct: v.opt(v.num(0.1, 50)), maxDrawdownPct: v.opt(v.num(0.5, 90)),
          maxConsecutiveLosses: v.opt(v.int(1, 50)), consecutiveLossCooldownHours: v.opt(v.num(0, 168))
        })),
        recovery: v.opt(v.obj({ enabled: v.opt(v.bool()), maxRecoveryLevel: v.opt(v.int(0, 8)) })),
        cost: v.opt(v.obj({
          spreadModel: v.opt(v.str({ values: ['instrument-typical', 'fixed', 'bar-derived'] })),
          fixedSpreadPips: v.opt(v.num(0, 10000)),
          slippageModel: v.opt(v.str({ values: ['none', 'fixed', 'gaussian'] })),
          fixedSlippagePips: v.opt(v.num(0, 10000)),
          includeCommission: v.opt(v.bool()), includeSwap: v.opt(v.bool()),
          executionDelayBars: v.opt(v.int(0, 10))
        })),
        verifyReproducible: v.opt(v.bool())
      }),
      handler: function (ctx) {
        var run = platform.startBacktest(ctx.body, ctx.actor);
        return {
          status: 202,
          result: { run: run },
          audit: { target: 'run:' + run.runId, newValue: { runId: run.runId, configHash: run.configHash, data: run.data },
            fingerprintBefore: fp(), fingerprintAfter: fp(), detail: { request: run.request } }
        };
      }
    },

    // ------------------------------------------------------------------
    // analysis, research
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/analysis', role: 'VIEWER', bucket: 'read', query: q(), handler: function (ctx) { return platform.analysisFor(ctx.query); } },
    { method: 'GET', path: '/api/research', role: 'VIEWER', bucket: 'read', query: q(), handler: function (ctx) { return platform.researchFor(ctx.query); } },
    {
      method: 'POST', path: '/api/research/experiments', role: 'OPERATOR', bucket: 'heavy', audit: 'research.experiment',
      body: v.obj({ runId: v.str({ pattern: RUN_ID }), proposalId: v.str({ pattern: ID }) }),
      handler: function (ctx) {
        var run = platform.startExperiment(ctx.body, ctx.actor);
        return { status: 202, result: { run: run },
          audit: { target: 'run:' + run.runId, newValue: { runId: run.runId, proposalId: ctx.body.proposalId, sourceRunId: ctx.body.runId } } };
      }
    },
    {
      method: 'POST', path: '/api/research/challengers', role: 'OPERATOR', bucket: 'write', audit: 'research.challenger.register',
      body: v.obj({ runId: v.str({ pattern: RUN_ID }), proposalId: v.str({ pattern: ID }) }),
      handler: function (ctx) {
        var c = platform.research.registerChallenger(ctx.body, ctx.actor);
        return { result: { recordId: c.recordId, configHash: c.configHash, state: c.state },
          audit: { target: 'challenger:' + c.recordId, newValue: { configHash: c.configHash, proposalId: c.proposalId, override: c.override } } };
      }
    },
    {
      method: 'POST', path: '/api/research/challengers/:recordId/evidence', role: 'OPERATOR', bucket: 'write', audit: 'research.evidence.attach',
      params: { recordId: ID },
      body: v.obj({ experimentRunId: v.opt(v.str({ pattern: RUN_ID })), demoRunId: v.opt(v.str({ pattern: RUN_ID })) }),
      handler: function (ctx) {
        var b = ctx.body;
        if (!!b.experimentRunId === !!b.demoRunId) {
          var e = new Error('name exactly one of experimentRunId or demoRunId');
          e.code = 'VALIDATION_FAILED'; e.http = 400;
          throw e;
        }
        var res = b.experimentRunId
          ? platform.research.attachExperimentEvidence(ctx.params.recordId, b.experimentRunId)
          : platform.research.attachDemoEvidence(ctx.params.recordId, b.demoRunId);
        return { result: res, audit: { target: 'challenger:' + ctx.params.recordId, newValue: res.attached,
          detail: { source: b.experimentRunId || b.demoRunId } } };
      }
    },
    {
      method: 'POST', path: '/api/research/challengers/:recordId/promote', role: 'OWNER', bucket: 'write', audit: 'research.champion.promote',
      params: { recordId: ID },
      body: v.obj({ basis: v.str({ minLength: 20, maxLength: 1000 }), confirm: v.opt(v.str({ maxLength: 16 })) }),
      handler: function (ctx) {
        if (ctx.body.confirm !== 'PROMOTE') throw confirmationRequired('promoting a champion requires confirm: "PROMOTE"');
        var prev = platform.research.registry().champion();
        var champ = platform.research.promote({ recordId: ctx.params.recordId, basis: ctx.body.basis }, ctx.actor);
        return { result: { recordId: champ.recordId, configHash: champ.configHash, origin: champ.origin,
            note: 'The champion record changed. The RUNNING configuration did not; applying it is a separate configuration change.' },
          audit: { target: 'champion', reason: ctx.body.basis, oldValue: { configHash: prev ? prev.configHash : null },
            newValue: { configHash: champ.configHash, fromChallenger: ctx.params.recordId } } };
      }
    },
    {
      method: 'POST', path: '/api/research/challengers/:recordId/reject', role: 'OPERATOR', bucket: 'write', audit: 'research.challenger.reject',
      params: { recordId: ID }, body: v.obj({ reason: reason }),
      handler: function (ctx) {
        var c = platform.research.reject({ recordId: ctx.params.recordId, reason: ctx.body.reason });
        return { result: { recordId: c.recordId, state: c.state },
          audit: { target: 'challenger:' + c.recordId, reason: ctx.body.reason, newValue: { state: c.state } } };
      }
    },
    {
      method: 'POST', path: '/api/research/champion/seed', role: 'OWNER', bucket: 'write', audit: 'research.champion.seed',
      body: v.obj({ basis: v.str({ minLength: 20, maxLength: 1000 }), runId: v.opt(v.str({ pattern: RUN_ID })) }),
      handler: function (ctx) {
        var champ = platform.research.seedChampion(ctx.body, ctx.actor);
        return { result: { recordId: champ.recordId, configHash: champ.configHash, origin: champ.origin },
          audit: { target: 'champion', reason: ctx.body.basis, newValue: { configHash: champ.configHash, origin: champ.origin } } };
      }
    },
    {
      method: 'POST', path: '/api/research/champion/rollback', role: 'OWNER', bucket: 'write', audit: 'research.champion.rollback',
      body: v.obj({ reason: reason, confirm: v.opt(v.str({ maxLength: 16 })) }),
      handler: function (ctx) {
        if (ctx.body.confirm !== 'ROLLBACK') throw confirmationRequired('rolling the champion back requires confirm: "ROLLBACK"');
        var prev = platform.research.registry().champion();
        var champ = platform.research.rollback({ reason: ctx.body.reason }, ctx.actor);
        return { result: { recordId: champ.recordId, configHash: champ.configHash, origin: champ.origin },
          audit: { target: 'champion', reason: ctx.body.reason, oldValue: { configHash: prev ? prev.configHash : null },
            newValue: { configHash: champ.configHash } } };
      }
    },

    // ------------------------------------------------------------------
    // testing
    // ------------------------------------------------------------------
    { method: 'GET', path: '/api/testing', role: 'VIEWER', bucket: 'read', handler: function () { return platform.testing.view(); } },
    {
      method: 'GET', path: '/api/testing/runs/:runId', role: 'VIEWER', bucket: 'read', params: { runId: TEST_RUN_ID },
      handler: function (ctx) {
        var run = platform.testing.get(ctx.params.runId);
        if (!run) throw notFound('test run ' + ctx.params.runId);
        return run;
      }
    },
    {
      method: 'POST', path: '/api/testing/run', role: 'OPERATOR', bucket: 'heavy', audit: 'testing.run',
      body: v.obj({
        scope: v.str({ values: ['all', 'category', 'test'] }),
        category: v.opt(v.str({ pattern: /^[a-z0-9]{2,16}$/ })),
        file: v.opt(v.str({ pattern: /^(agent|cc):[a-z0-9-]+-test\.js$/, maxLength: 80 })),
        name: v.opt(v.str({ minLength: 1, maxLength: 300 }))
      }),
      handler: function (ctx) {
        var b = ctx.body;
        if (b.scope === 'category' && !b.category) { var e1 = new Error('category is required for scope "category"'); e1.code = 'VALIDATION_FAILED'; e1.http = 400; throw e1; }
        if (b.scope === 'test' && (!b.file || !b.name)) { var e2 = new Error('file and name are required for scope "test"'); e2.code = 'VALIDATION_FAILED'; e2.http = 400; throw e2; }
        var run = platform.testing.start(b, ctx.actor);
        return { status: 202, result: { run: run },
          audit: { target: 'test-run:' + run.runId, newValue: { scope: b.scope, category: b.category || null, file: b.file || null } } };
      }
    },
    {
      method: 'POST', path: '/api/testing/cancel', role: 'OPERATOR', bucket: 'write', audit: 'testing.cancel',
      body: v.obj({}),
      handler: function () {
        var run = platform.testing.cancel();
        return { result: { run: run }, audit: { target: 'test-run:' + run.runId } };
      }
    },

    // ------------------------------------------------------------------
    // activity, audit, system
    // ------------------------------------------------------------------
    {
      method: 'GET', path: '/api/activity', role: 'VIEWER', bucket: 'read',
      query: v.obj({
        type: v.opt(v.str({ pattern: /^[a-z]{2,16}$/ })), severity: v.opt(v.str({ values: ['INFO', 'WARN', 'ERROR'] })),
        asset: v.opt(v.str({ pattern: SYMBOL })), strategy: v.opt(v.str({ pattern: STRATEGY, maxLength: 64 })),
        fromTs: v.opt(v.int(0, 4102444800000)), toTs: v.opt(v.int(0, 4102444800000)),
        run: v.opt(v.str({ pattern: RUN_ID })), limit: v.opt(v.int(1, 500)), offset: v.opt(v.int(0, 1000000))
      }),
      handler: function (ctx) { return platform.activity(ctx.query); }
    },
    {
      method: 'GET', path: '/api/audit', role: 'VIEWER', bucket: 'read',
      query: v.obj({
        action: v.opt(v.str({ pattern: /^[a-z.-]{2,48}$/ })), actor: v.opt(v.str({ pattern: authMod.USER_ID_RE })),
        outcome: v.opt(v.str({ values: ['ACCEPTED', 'REFUSED', 'FAILED'] })),
        fromTs: v.opt(v.int(0, 4102444800000)), toTs: v.opt(v.int(0, 4102444800000)),
        limit: v.opt(v.int(1, 500)), offset: v.opt(v.int(0, 1000000))
      }),
      handler: function (ctx) {
        var out = audit.list(ctx.query);
        out.head = audit.head();
        return out;
      }
    },
    { method: 'GET', path: '/api/audit/verify', role: 'VIEWER', bucket: 'read', handler: function () { return audit.verify(); } },
    {
      method: 'GET', path: '/api/system', role: 'VIEWER', bucket: 'read',
      handler: function (ctx) { return platform.system(ctx.systemDeps); }
    },
    {
      method: 'GET', path: '/api/jobs/:runId', role: 'VIEWER', bucket: 'read', params: { runId: RUN_ID },
      handler: function (ctx) {
        var run = platform.runs.get(ctx.params.runId);
        if (!run) throw notFound('run ' + ctx.params.runId);
        return { run: run };
      }
    }
  ];

  function paperAction(name, fn) {
    return {
      method: 'POST', path: '/api/paper/' + name, role: 'OPERATOR', bucket: 'write', audit: 'paper.' + name,
      body: v.obj({}),
      handler: function (ctx) {
        var before = platform.paper.view();
        var view = fn(ctx);
        return {
          result: view,
          audit: { target: 'paper:' + (before.session ? before.session.sessionId : 'none'),
            oldValue: { state: before.state }, newValue: { state: view.state } }
        };
      }
    };
  }

  function modeBody(withReason) {
    var fields = {
      // A plain string, not an enum: a request naming LIVE must reach the
      // handler so it is refused by name and written to the audit chain.
      to: v.str({ minLength: 3, maxLength: 16, pattern: /^[A-Z_]+$/ }),
      approval: v.opt(v.obj({
        ownerApproval: v.bool(),
        statement: v.str({ minLength: 10, maxLength: 400 }),
        configFingerprint: v.str({ pattern: HEX64 }),
        commit: v.str({ pattern: /^[0-9a-f]{7,40}$/ }),
        gatesPassed: v.arr(v.str({ pattern: /^[A-Z_]{3,48}$/ }), { minItems: 0, maxItems: 40, unique: true }),
        gateEvidence: { type: 'map', keyPattern: /^[A-Z_]{3,48}$/, maxKeys: 40, values: v.str({ maxLength: 2000 }) },
        nonce: v.opt(v.str({ pattern: /^[A-Za-z0-9_-]{8,64}$/ }))
      }))
    };
    if (withReason) fields.reason = reason;
    return v.obj(fields);
  }
}

function toMap(diff, field) {
  var out = {};
  diff.forEach(function (d) { out[d.path] = d[field]; });
  return out;
}

module.exports = { routes: routes };
