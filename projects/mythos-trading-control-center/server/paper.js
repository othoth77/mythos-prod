'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — paper / demo control room
// projects/mythos-trading-control-center/server/paper.js
//
// Drives the Trading Agent's OWN paper session (src/paper/session.js) one tick
// at a time and reports what it recorded. There is no second execution path
// here: a fill is the agent's paper adapter's fill, a size is the Risk
// Engine's approved size, and every event shown is a row the agent wrote to
// its store.
//
// WHAT "PAPER" MEANS IN THIS BUILD, stated where it cannot be missed:
//
//  * NO ORDER GOES ANYWHERE. There is no venue, no credential and no network
//    client. The paper adapter computes fills; it does not send them.
//  * THE FEED IS A REPLAY of committed or seeded synthetic bars, delivered one
//    timestamp at a time. This build has no market-data access, so a "live"
//    paper session is not possible and is not imitated. Every state carries
//    feedKind REPLAY so a session can never be mistaken for a forward test on
//    real prices.
//  * IT CANNOT START OUTSIDE PAPER MODE. The agent's session refuses to be
//    created unless its mode controller is in PAPER, and PAPER is reachable
//    only through an owner-approval record. This file checks first only to
//    give a clearer refusal; the agent's check is the one that binds.
//
// DEMO is a paper session with TWO arms — champion and challenger — fed
// identical ticks. It reports deltas and never calls a winner.
//
// STATES   IDLE → RUNNING ⇄ PAUSED → STOPPED     (HALTED on an error)
// RESET archives a finished or halted session and returns to IDLE. Nothing a
// session recorded is deleted by it.
// =====================================================

var path = require('path');
var fs = require('fs');

var State = Object.freeze({
  IDLE: 'IDLE', RUNNING: 'RUNNING', PAUSED: 'PAUSED', STOPPED: 'STOPPED', HALTED: 'HALTED'
});

var EVENT_BUFFER = 3000;
var TICK_INTERVAL_MS = 250;
var TICK_TIME_BUDGET_MS = 60;
var MAX_SUBSCRIBERS = 24;

/** Tables whose new rows become control-room events, in pipeline order. */
var EVENT_TABLES = ['regimes', 'candidates', 'cost_assessments', 'jev_decisions', 'risk_assessments',
  'recovery_states', 'decisions', 'orders', 'trades', 'system_events'];

function refusal(code, message, extra) {
  var e = new Error(message);
  e.code = code;
  e.refusal = true;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

/**
 * @param {object} spec
 * @param {object} spec.agent
 * @param {object} spec.control
 * @param {object} spec.runs
 * @param {object} [spec.research] champion registry wrapper (for DEMO arms)
 * @param {function} [spec.now]
 * @param {function} [spec.onSystemEvent] (event) => void
 * @param {boolean} [spec.autoTick=true] false in tests that drive ticks by hand
 */
function create(spec) {
  var agent = spec.agent;
  var control = spec.control;
  var runs = spec.runs;
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };
  var onSystemEvent = typeof spec.onSystemEvent === 'function' ? spec.onSystemEvent : function () {};
  var autoTick = spec.autoTick !== false;
  var research = spec.research || null;

  var state = State.IDLE;
  var current = null;        // the session record; null when IDLE
  var lastArchived = null;   // summary of the previous session, kept across RESET
  var events = [];           // ring buffer
  var eventSeq = 0;          // never reset, so a stale client cursor is detectable
  var subscribers = [];
  var timer = null;
  var sessionCounter = 0;

  // =====================================================================
  // events
  // =====================================================================

  function emit(type, arm, row, summary, data) {
    eventSeq += 1;
    var ev = {
      seq: eventSeq,
      at: new Date(now()).toISOString(),
      sessionId: current ? current.sessionId : null,
      type: type,
      arm: arm || null,
      ts: row && row.ts !== undefined ? row.ts : null,
      symbol: (row && row.symbol) || (data && data.symbol) || null,
      strategyId: (row && row.strategyId) || (data && data.strategyId) || null,
      candidateId: (row && row.candidateId) || null,
      summary: summary,
      data: data || null
    };
    events.push(ev);
    if (events.length > EVENT_BUFFER) events.shift();
    subscribers.slice().forEach(function (s) {
      try { s.send(ev); } catch (e) { unsubscribe(s); }
    });
    return ev;
  }

  /** Turns the rows a tick appended to an arm's store into events. */
  function harvest(arm) {
    var cursors = arm.cursors;
    var store = arm.ref.store;
    var candIndex = arm.candIndex;
    EVENT_TABLES.forEach(function (name) {
      var rows = store.table(name).all();
      var from = cursors[name] || 0;
      for (var i = from; i < rows.length; i++) {
        var r = rows[i];
        var c = r.candidateId ? candIndex[r.candidateId] : null;
        switch (name) {
          case 'regimes':
            // One event per CHANGE of label per symbol; one row per bar would
            // bury everything else.
            if (arm.lastRegime[r.symbol] !== r.regime) {
              arm.lastRegime[r.symbol] = r.regime;
              emit('regime', arm.label, r, r.symbol + ' regime ' + r.regime + ' ' + r.direction + ' (confidence ' + r.confidence + ')',
                { regime: r.regime, direction: r.direction, confidence: r.confidence, held: r.held });
            }
            break;
          case 'candidates':
            candIndex[r.candidateId] = { symbol: r.symbol, strategyId: r.strategyId };
            emit('strategy', arm.label, r, r.strategyId + ' signalled ' + r.direction + ' on ' + r.symbol + ': ' + (r.reasonCodes || []).join(', '),
              { signal: r.reasonCodes || [], strategyConfidence: r.strategyConfidence });
            emit('candidate', arm.label, r, r.symbol + ' ' + r.direction + ' entry ' + r.entry + ' SL ' + r.stopLoss + ' TP ' + r.takeProfit,
              { direction: r.direction, entry: r.entry, stopLoss: r.stopLoss, takeProfit: r.takeProfit,
                rewardRisk: r.rewardRisk, netRewardRisk: r.netRewardRisk, regime: r.regime });
            break;
          case 'cost_assessments':
            if (r.phase === 'PRE_TRADE' && r.passed === false) {
              emit('cost', arm.label, r, 'cost filter rejected: ' + (r.reasonCodes || []).join(', '),
                { symbol: r.symbol, strategyId: c ? c.strategyId : null, totalCostMoney: r.totalCostMoney, reasonCodes: r.reasonCodes });
            }
            break;
          case 'jev_decisions':
            emit('jev', arm.label, r, 'Jev ' + (r.decision === 'ENTER' ? 'ALLOW' : 'BLOCK') + ' score ' + r.score + ' confidence ' + r.confidence,
              { symbol: c ? c.symbol : null, strategyId: c ? c.strategyId : null, score: r.score, confidence: r.confidence,
                decision: r.decision, band: r.band, reasonCodes: r.reasonCodes, riskFlags: r.riskFlags });
            break;
          case 'risk_assessments':
            emit('risk', arm.label, r, 'Risk Engine ' + r.verdict + ' requested ' + r.requestedLots + ' approved ' + r.approvedLots,
              { symbol: c ? c.symbol : null, strategyId: c ? c.strategyId : null, verdict: r.verdict,
                requestedLots: r.requestedLots, approvedLots: r.approvedLots, reasonCodes: r.reasonCodes });
            break;
          case 'recovery_states':
            emit('recovery', arm.label, r, r.symbol + ' recovery ' + r.reason + ' level ' + r.level + ' next requested ' + r.nextLotsRequested,
              { level: r.level, reason: r.reason, cumulativeLossMoney: r.cumulativeLossMoney,
                nextLotsUncapped: r.nextLotsUncapped, nextLotsRequested: r.nextLotsRequested });
            break;
          case 'decisions':
            if (r.decision === 'NO_TRADE') {
              emit('decision', arm.label, r, r.symbol + ' NO_TRADE at ' + r.stage + ': ' + (r.reasonCodes || []).join(', '),
                { strategyId: c ? c.strategyId : null, decision: r.decision, stage: r.stage, reasonCodes: r.reasonCodes });
            }
            break;
          case 'orders':
            emit('execution', arm.label, r, r.symbol + ' order ' + r.status + ' ' + r.direction + ' ' + r.lots +
              (r.filledPrice !== undefined ? ' @ ' + r.filledPrice : ''),
              { strategyId: c ? c.strategyId : null, orderId: r.orderId, status: r.status, direction: r.direction, lots: r.lots,
                requestedPrice: r.requestedPrice, filledPrice: r.filledPrice === undefined ? null : r.filledPrice,
                rejectReason: r.rejectReason || null, paper: r.paper === true });
            break;
          case 'trades':
            var kind = r.exitReason === 'STOP_LOSS' ? 'sl' : (r.exitReason === 'TAKE_PROFIT' ? 'tp' : 'close');
            emit(kind, arm.label, { ts: r.exitTs, symbol: r.symbol, strategyId: r.strategyId, candidateId: r.candidateId },
              r.symbol + ' closed ' + r.exitReason + ' @ ' + r.exitPrice,
              { tradeId: r.tradeId, exitReason: r.exitReason, exitPrice: r.exitPrice, entryPrice: r.entryPrice, lots: r.lots, gapped: !!r.gapped });
            emit('result', arm.label, { ts: r.exitTs, symbol: r.symbol, strategyId: r.strategyId, candidateId: r.candidateId },
              r.outcome + ' net ' + r.netPnl + ' (gross ' + r.grossPnl + ', costs ' + r.costsMoney + ')',
              { tradeId: r.tradeId, outcome: r.outcome, netPnl: r.netPnl, grossPnl: r.grossPnl, costsMoney: r.costsMoney,
                equityAfter: r.equityAfter, recoveryLevel: r.recoveryLevel });
            break;
          case 'system_events':
            emit(r.severity === 'ERROR' ? 'error' : 'system', arm.label, r, r.kind + ': ' + r.message,
              { kind: r.kind, severity: r.severity });
            break;
          default:
            break;
        }
      }
      cursors[name] = rows.length;
    });
  }

  // =====================================================================
  // SSE subscribers
  // =====================================================================

  function subscribe(sub) {
    if (subscribers.length >= MAX_SUBSCRIBERS) return false;
    subscribers.push(sub);
    return true;
  }

  function unsubscribe(sub) {
    subscribers = subscribers.filter(function (s) { return s !== sub; });
  }

  /** Events after `since`. `gap` is true when some were already dropped. */
  function eventsSince(since, limit) {
    var s = typeof since === 'number' && since >= 0 ? since : 0;
    var first = events.length ? events[0].seq : eventSeq + 1;
    var list = events.filter(function (e) { return e.seq > s; });
    var max = Math.min(limit || 500, 1000);
    return {
      // A client that asks for events older than the buffer holds must reload
      // the state rather than assume it has the full stream.
      gap: first - 1 > s,
      firstSeq: events.length ? first : null,
      lastSeq: eventSeq,
      items: list.slice(0, max),
      more: list.length > max
    };
  }

  // =====================================================================
  // lifecycle
  // =====================================================================

  function requirePaper(what) {
    if (control.mode() !== agent.enums.Mode.PAPER) {
      throw refusal('PAPER_MODE_REQUIRED',
        'cannot ' + what + ': the platform is in ' + control.mode() + '. A paper session needs PAPER mode, which is ' +
        'reachable only through an owner-approval record bound to the running configuration and commit.',
        { mode: control.mode() });
    }
  }

  /**
   * @param {object} q { data: {kind, bars, seed, symbols, timeframe}, ticksPerSecond, demo: {challengerRecordId} }
   */
  function start(q, actor) {
    if (state === State.RUNNING || state === State.PAUSED) {
      throw refusal('PAPER_SESSION_ACTIVE', 'a paper session is already ' + state + '; stop it before starting another');
    }
    if (state === State.STOPPED || state === State.HALTED) {
      throw refusal('PAPER_RESET_REQUIRED', 'the previous session is ' + state + '; reset the control room before starting a new one');
    }
    requirePaper('start a paper session');
    if (!control.tradingEnabled()) {
      throw refusal('TRADING_DISABLED',
        'trading is disabled (the Risk Engine emergency stop is set), so a session would block every candidate. Enable trading first.');
    }

    var req = q || {};
    var config = control.paperConfig();
    var enabled = control.enabledStrategies();
    var dataSpec = Object.assign({ kind: 'FIXTURE' }, req.data || {});
    if (!dataSpec.symbols) dataSpec.symbols = defaultSymbols(config, dataSpec.kind);
    var runConfig = control.paperConfig({ universe: dataSpec.symbols });
    var dataset = agent.loadDataset(runConfig, dataSpec);

    var alloc = runs.newRunDir('pp');
    sessionCounter += 1;
    var sessionId = alloc.runId;

    var armSpecs = [buildArm('main', runConfig, enabled, path.join(alloc.dir, 'store'), sessionId)];
    var demo = null;
    if (req.demo && req.demo.challengerRecordId) {
      if (!research) throw refusal('DEMO_UNAVAILABLE', 'no champion/challenger registry is available for a demo session');
      var challenger = research.challengerOverride(req.demo.challengerRecordId);
      var chalConfig = agent.buildConfig(
        agent.config.deepMerge(control.overrides(), challenger.override),
        enabled,
        { mode: agent.enums.Mode.PAPER, universe: dataSpec.symbols }
      );
      armSpecs[0].label = 'champion';
      armSpecs.push(buildArm('challenger', chalConfig, enabled, path.join(alloc.dir, 'store-challenger'), sessionId));
      demo = { challengerRecordId: challenger.recordId, challengerConfigHash: challenger.configHash };
    }

    var controller = control.modeController();
    var session = agent.paperSession.create({
      modeController: controller,
      feed: agent.feed.replay({ data: agent.feedData(dataset), timeframe: dataset.timeframe }),
      now: now,
      heartbeatEveryTicks: 50,
      arms: armSpecs.map(function (a) { return { label: a.label, config: a.config, hooks: a.hooks, store: a.store }; })
    });

    current = {
      sessionId: sessionId,
      runDir: alloc.dir,
      session: session,
      controller: controller,
      kind: demo ? 'DEMO' : 'PAPER',
      demo: demo,
      startedAt: new Date(now()).toISOString(),
      startedBy: actor ? { id: actor.id, role: actor.role } : null,
      stoppedAt: null,
      stopReason: null,
      commit: control.commit(),
      configHash: runConfig.fingerprint.hash,
      platformFingerprint: control.config().fingerprint.hash,
      data: {
        kind: dataset.provenance.kind, label: 'PAPER', dataLabel: dataset.provenance.label,
        datasetVersion: dataset.datasetVersion, provenance: dataset.provenance, timeframe: dataset.timeframe,
        symbols: dataset.symbols, window: dataset.window
      },
      feedKind: 'REPLAY',
      ticksPerSecond: clampSpeed(req.ticksPerSecond),
      totalTicks: dataset.window.bars,
      arms: armSpecs.map(function (a) {
        return { label: a.label, config: a.config, ref: session.arm(a.label), cursors: {}, candIndex: Object.create(null), lastRegime: Object.create(null) };
      }),
      error: null,
      result: null,
      tickDebt: 0
    };
    state = State.RUNNING;
    emit('session', null, null, current.kind + ' session started on ' + dataset.symbols.join(', ') +
      ' (' + dataset.provenance.label + ' replay feed)', { state: state, kind: current.kind, symbols: dataset.symbols });
    // Rows the agent wrote while binding to the store (composition, schedule).
    current.arms.forEach(harvest);
    schedule();
    return view();
  }

  function defaultSymbols(config, kind) {
    if (kind !== 'FIXTURE') return config.universe.slice();
    var available = agent.dataCatalog().kinds[0].symbols;
    var inUniverse = config.universe.filter(function (s) { return available.indexOf(s) !== -1; });
    if (inUniverse.length === 0) {
      throw refusal('NO_DATA_FOR_UNIVERSE', 'no committed fixture exists for any asset in the configured universe; use the SYNTHETIC source');
    }
    return inUniverse;
  }

  function buildArm(label, config, enabled, storeDir, sessionId) {
    var wired = agent.wire(config, enabled);
    var lastTs = 0;
    var store = agent.store.create({
      runId: sessionId + '.' + label,
      dir: storeDir,
      now: function () { return lastTs; },
      meta: { label: 'paper-' + label, configHash: config.fingerprint.hash, mode: agent.enums.Mode.PAPER,
        commit: control.commit(), controlCenterRunId: sessionId, feedKind: 'REPLAY' }
    });
    return { label: label, config: config, hooks: wired.engineHooks, store: store, agent: wired.agent };
  }

  function clampSpeed(v) {
    var n = typeof v === 'number' && isFinite(v) ? v : 8;
    return Math.max(1, Math.min(400, Math.round(n)));
  }

  function schedule() {
    clearTimer();
    if (!autoTick) return;
    timer = setInterval(pump, TICK_INTERVAL_MS);
    if (timer.unref) timer.unref();
  }

  function clearTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  /** One timer beat: as many ticks as the speed allows, inside a time budget. */
  function pump() {
    if (state !== State.RUNNING || !current) return;
    current.tickDebt += current.ticksPerSecond * (TICK_INTERVAL_MS / 1000);
    var n = Math.floor(current.tickDebt);
    if (n <= 0) return;
    current.tickDebt -= n;
    var started = Date.now();
    for (var i = 0; i < n; i++) {
      if (!step()) break;
      if (Date.now() - started > TICK_TIME_BUDGET_MS) { current.tickDebt = 0; break; }
    }
  }

  /**
   * Advances the session by one tick. Returns false when it stopped.
   * Exposed so tests can drive a session deterministically.
   */
  function step() {
    if (state !== State.RUNNING || !current) return false;
    var tick;
    try {
      // The agent's adapter re-checks the mode on every fill; this check only
      // turns a mode change into a clean halt instead of a thrown fill.
      if (current.controller !== control.modeController()) {
        halt(refusal('PAPER_CONFIG_CHANGED', 'the platform configuration changed; this session ran under the previous one and cannot continue'));
        return false;
      }
      if (current.controller.mode() !== agent.enums.Mode.PAPER) {
        halt(refusal('PAPER_MODE_LOST', 'the platform left PAPER mode; the session cannot continue'));
        return false;
      }
      tick = current.session.tick();
    } catch (e) {
      halt(e);
      return false;
    }
    if (tick === null) {
      finishSession('FEED_EXHAUSTED', null);
      return false;
    }
    current.arms.forEach(harvest);
    return true;
  }

  function halt(err) {
    clearTimer();
    var message = String(err && err.message ? err.message : err).slice(0, 1000);
    if (current) {
      current.error = { code: (err && err.code) || 'PAPER_ERROR', message: message, refusal: !!(err && err.refusal) };
      current.stoppedAt = new Date(now()).toISOString();
      current.stopReason = 'HALTED';
    }
    state = State.HALTED;
    emit('error', null, null, 'session halted: ' + message, { code: (err && err.code) || 'PAPER_ERROR' });
    onSystemEvent({ kind: 'PAPER_SESSION_HALTED', severity: 'ERROR', message: message });
    archive();
  }

  function finishSession(reason, actor) {
    clearTimer();
    var res;
    try {
      res = current.session.finish();
    } catch (e) {
      halt(e);
      return;
    }
    current.arms.forEach(harvest);
    current.result = res;
    current.stoppedAt = new Date(now()).toISOString();
    current.stopReason = reason;
    current.stoppedBy = actor ? { id: actor.id, role: actor.role } : null;
    state = State.STOPPED;
    emit('session', null, null, 'session stopped: ' + reason, { state: state, reason: reason });
    archive();
  }

  /** Seals each arm's store and registers the session as a run. Never throws. */
  function archive() {
    if (!current || current.archived) return;
    current.archived = true;
    try {
      var res = current.result;
      current.arms.forEach(function (arm) {
        if (!arm.ref.store.isSealed()) arm.ref.store.seal();
      });
      var main = current.arms[0];
      var metrics = res ? res.arms[0].metrics : null;
      var analysis = null;
      if (res) {
        analysis = agent.analysisAgent.create({ minSample: 20 }).analyse({
          store: main.ref.store, initialCapital: main.config.account.initialCapital, label: 'paper-' + current.sessionId
        });
        writeDoc('analysis.json', analysis);
        writeDoc('research.json', agent.researchAgent.create({ minSample: 10 }).research({ report: analysis, config: main.config }));
      }
      var result = {
        runId: current.sessionId,
        kind: current.kind,
        label: 'PAPER',
        paper: true,
        feedKind: current.feedKind,
        commit: current.commit,
        configHash: current.configHash,
        config: agent.config.serialise(main.config),
        enabledStrategies: control.enabledStrategies(),
        data: current.data,
        ticks: current.session.ticks(),
        stopReason: current.stopReason,
        error: current.error,
        metrics: metrics,
        counts: res ? res.arms[0].counts : null,
        emergencyStopped: res ? res.arms[0].emergencyStopped : main.ref.emergencyStopped,
        emergencyReason: res ? res.arms[0].emergencyReason : main.ref.emergencyReason,
        arms: res ? res.arms.map(function (a) {
          return { label: a.label, configHash: a.configHash, metrics: a.metrics, counts: a.counts,
            emergencyStopped: a.emergencyStopped, emergencyReason: a.emergencyReason, digest: a.digest() };
        }) : null,
        comparison: res ? res.comparison : null,
        demo: current.demo,
        caveats: analysis ? analysis.caveats : null,
        note: 'PAPER on a replay feed of synthetic bars. No order was sent anywhere. Mechanics only.'
      };
      writeDoc('result.json', result);
      runs.register({
        runId: current.sessionId,
        kind: current.kind,
        label: 'PAPER',
        status: state === State.HALTED ? runs.Status.FAILED : runs.Status.COMPLETED,
        stage: state,
        createdAt: current.startedAt,
        startedAt: current.startedAt,
        finishedAt: current.stoppedAt,
        durationMs: Date.parse(current.stoppedAt) - Date.parse(current.startedAt),
        actor: current.startedBy,
        commit: current.commit,
        configHash: current.configHash,
        data: { kind: current.data.kind, label: 'PAPER', datasetVersion: current.data.datasetVersion,
          timeframe: current.data.timeframe, symbols: current.data.symbols },
        request: { ticksPerSecond: current.ticksPerSecond, demo: current.demo },
        summary: metrics ? { headline: agent.metrics.headline(metrics), stopReason: current.stopReason } : null,
        error: current.error
      });
      lastArchived = { sessionId: current.sessionId, kind: current.kind, stoppedAt: current.stoppedAt,
        stopReason: current.stopReason, trades: metrics ? metrics.tradeCount : null };
    } catch (e) {
      onSystemEvent({ kind: 'PAPER_ARCHIVE_FAILED', severity: 'ERROR', message: String(e.message).slice(0, 500) });
    }
  }

  function writeDoc(name, value) {
    var file = path.join(current.runDir, name);
    fs.writeFileSync(file + '.tmp', JSON.stringify(value) + '\n', { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }

  function pause(actor) {
    if (state !== State.RUNNING) throw refusal('PAPER_NOT_RUNNING', 'only a RUNNING session can be paused; the session is ' + state);
    clearTimer();
    state = State.PAUSED;
    emit('session', null, null, 'session paused', { state: state, by: actor ? actor.id : null });
    return view();
  }

  function resume(actor) {
    if (state !== State.PAUSED) throw refusal('PAPER_NOT_PAUSED', 'only a PAUSED session can be resumed; the session is ' + state);
    requirePaper('resume the session');
    state = State.RUNNING;
    emit('session', null, null, 'session resumed', { state: state, by: actor ? actor.id : null });
    schedule();
    return view();
  }

  function stop(actor, reason) {
    if (state !== State.RUNNING && state !== State.PAUSED) {
      throw refusal('PAPER_NOT_ACTIVE', 'there is no active session to stop; the session is ' + state);
    }
    finishSession(reason || 'STOPPED_BY_OPERATOR', actor);
    return view();
  }

  /** Stops an active session without throwing when there is none. */
  function stopIfActive(reason) {
    if (state === State.RUNNING || state === State.PAUSED) {
      finishSession(reason, null);
      return true;
    }
    return false;
  }

  function reset(actor) {
    var wasActive = state === State.RUNNING || state === State.PAUSED;
    if (wasActive) finishSession('RESET', actor);
    var previous = current ? current.sessionId : null;
    current = null;
    state = State.IDLE;
    emit('session', null, null, 'control room reset', { state: state, archivedSession: previous, by: actor ? actor.id : null });
    return view();
  }

  function setSpeed(ticksPerSecond) {
    if (!current) throw refusal('PAPER_NOT_ACTIVE', 'there is no session');
    current.ticksPerSecond = clampSpeed(ticksPerSecond);
    return view();
  }

  // =====================================================================
  // views
  // =====================================================================

  function armView(arm) {
    var ref = arm.ref;
    var snap = ref.account.snapshot();
    var pos = ref.openPosition;
    var world = pos ? ref.world[pos.symbol] : null;
    var lastRegimes = {};
    Object.keys(arm.lastRegime).forEach(function (k) { lastRegimes[k] = arm.lastRegime[k]; });
    return {
      label: arm.label,
      configHash: arm.config.fingerprint.hash,
      initialCapital: snap.initialCapital,
      balance: snap.balance,
      equity: snap.equity,
      netProfit: snap.netProfit,
      returnPct: snap.returnPct,
      drawdownPct: snap.drawdownPct,
      maxDrawdownPct: snap.maxDrawdownPct,
      trades: snap.tradeCount,
      wins: snap.wins,
      losses: snap.losses,
      winRate: snap.tradeCount ? Math.round((snap.wins / snap.tradeCount) * 10000) / 10000 : null,
      consecutiveLosses: snap.consecutiveLosses,
      maxConsecutiveLosses: snap.maxConsecutiveLosses,
      totalCosts: snap.totalCosts,
      openPosition: pos ? {
        positionId: pos.positionId, symbol: pos.symbol, strategyId: pos.strategyId, direction: pos.direction,
        lots: pos.lots, entryTs: pos.entryTs, entryPrice: pos.entryPrice, stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit, recoveryLevel: pos.recoveryLevel, regime: pos.regime, jevScore: pos.jevScore,
        riskMoney: pos.riskMoney, lastClose: world ? world.lastClose : null
      } : null,
      pendingEntry: ref.pendingEntry ? {
        symbol: ref.pendingEntry.symbol, direction: ref.pendingEntry.direction, lots: ref.pendingEntry.lots,
        decidedAtTs: ref.pendingEntry.decidedAtTs, strategyId: ref.pendingEntry.strategyId
      } : null,
      emergencyStopped: ref.emergencyStopped,
      emergencyReason: ref.emergencyReason,
      regimes: lastRegimes,
      counts: JSON.parse(JSON.stringify(ref.counts)),
      storeRows: ref.store.rowCount()
    };
  }

  function view() {
    var mode = control.mode();
    var base = {
      state: state,
      mode: mode,
      paperModeActive: mode === agent.enums.Mode.PAPER,
      tradingEnabled: control.tradingEnabled(),
      lastEventSeq: eventSeq,
      subscribers: subscribers.length,
      lastArchived: lastArchived,
      placesRealOrders: false,
      feedKind: 'REPLAY',
      feedNote: 'Replay of synthetic bars. This build has no market-data access; no order is sent anywhere.'
    };
    if (!current) {
      base.session = null;
      base.reason = mode === agent.enums.Mode.PAPER
        ? 'No session. Start one to begin.'
        : 'The platform is in ' + mode + '. PAPER requires an owner-approval record (Control Center → Mode).';
      return base;
    }
    var feed = current.session.feed();
    base.session = {
      sessionId: current.sessionId,
      kind: current.kind,
      label: 'PAPER',
      startedAt: current.startedAt,
      startedBy: current.startedBy,
      stoppedAt: current.stoppedAt,
      stopReason: current.stopReason,
      commit: current.commit,
      configHash: current.configHash,
      // Whether the platform configuration is still the one this session started under.
      configCurrent: current.platformFingerprint === control.config().fingerprint.hash,
      data: current.data,
      ticks: current.session.ticks(),
      totalTicks: feed.ticks === undefined ? current.totalTicks : feed.ticks,
      remainingTicks: feed.remainingTicks === undefined ? null : feed.remainingTicks,
      ticksPerSecond: current.ticksPerSecond,
      demo: current.demo,
      error: current.error,
      arms: current.arms.map(armView),
      comparison: current.result ? current.result.comparison : null,
      archived: !!current.archived
    };
    return base;
  }

  /** The live tables of an active or finished-but-not-reset session's arm. */
  function liveStore(label) {
    if (!current) return null;
    var arm = label ? current.arms.filter(function (a) { return a.label === label; })[0] : current.arms[0];
    return arm ? { store: arm.ref.store, config: arm.config, sessionId: current.sessionId, label: arm.label } : null;
  }

  function shutdown() {
    clearTimer();
    if (state === State.RUNNING || state === State.PAUSED) {
      try { finishSession('PROCESS_SHUTDOWN', null); } catch (e) { /* best effort */ }
    }
    subscribers.slice().forEach(function (s) { try { s.close(); } catch (e) { /* closing anyway */ } });
    subscribers = [];
  }

  return {
    State: State,
    start: start,
    pause: pause,
    resume: resume,
    stop: stop,
    stopIfActive: stopIfActive,
    reset: reset,
    setSpeed: setSpeed,
    step: step,
    view: view,
    state: function () { return state; },
    isActive: function () { return state === State.RUNNING || state === State.PAUSED; },
    hasSession: function () { return !!current; },
    eventsSince: eventsSince,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    liveStore: liveStore,
    lastEventSeq: function () { return eventSeq; },
    shutdown: shutdown,
    EVENT_BUFFER: EVENT_BUFFER
  };
}

module.exports = { create: create, State: State };
