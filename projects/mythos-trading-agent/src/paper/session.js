'use strict';
// =====================================================
// MYTHOS TRADING AGENT — paper trading session (mission §18 PHASE 14)
// projects/mythos-trading-agent/src/paper/session.js
//
// A paper session drives the same decision pipeline as a backtest, from a FEED
// rather than an array, in PAPER mode. It places no order anywhere: there is no
// network client in this project, and the LIVE adapter refuses regardless.
//
// THREE THINGS THIS FILE IS BUILT AROUND
//
//  1. IT CANNOT RUN WITHOUT OWNER APPROVAL. create() asserts the mode controller is
//     in PAPER, and PAPER is only reachable through a single-use owner-approval
//     record bound to the running config and commit (src/mode/mode-controller.js).
//     A caller cannot paper-trade by choosing a different adapter or passing a flag.
//
//  2. IT MUST BEHAVE IDENTICALLY TO THE BACKTEST ENGINE. Paper results are only
//     evidence for a promotion if the two agree, so the ordering rules here mirror
//     src/backtest/engine.js exactly — pending fill, then exits, then
//     mark-to-market, then the per-bar hook, then decisions — and
//     tests/paper-test.js asserts that a replayed paper session produces the same
//     trades, in the same order, at the same prices, as engine.run() over the same
//     bars. If they ever diverge, that test fails rather than the difference
//     turning up inside a promotion case.
//
//  3. INDICATORS ARE RECOMPUTED OVER THE FULL HISTORY ON EVERY TICK, and that is
//     deliberate. Several indicators here are seeded from the start of the series
//     (EMA from the SMA of its first window, ATR/RSI/ADX from Wilder's seed, the
//     ATR percentile from a long lookback), so a trailing-window recomputation
//     would produce DIFFERENT values and break the equivalence above. The cost is
//     O(n²) across a whole replay, which is irrelevant in the setting that matters:
//     a real M15 session gets one tick every fifteen minutes, and recomputing a
//     50,000-bar history takes well under a second. It matters only in a fast
//     replay, which is why the equivalence test uses a few hundred bars.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var clock = require('../core/clock');
var idsMod = require('../core/ids');
var rngMod = require('../core/rng');
var instrumentMod = require('../core/instrument');

var seriesMod = require('../data/series');
var resampleMod = require('../data/resample');
var feedMod = require('../data/feed');
var costModelMod = require('../cost/model');
var accountMod = require('../account/account');
var slotMod = require('../account/one-trade-controller');
var paperAdapter = require('../execution/paper-adapter');
var adapterMod = require('../execution/adapter');
var storeMod = require('../db/store');
var metricsMod = require('../backtest/metrics');

/**
 * Creates a paper session.
 *
 * @param {object} spec
 * @param {object} spec.modeController REQUIRED, must be in PAPER
 * @param {object} spec.feed
 * @param {object[]} spec.arms one or two arms: [{ label, config, hooks }]
 *        Two arms is the DEMO A/B mission §12 asks for: both see the same ticks,
 *        each keeps its own account, store and recovery state.
 * @param {object} [spec.logger]
 * @param {function} [spec.now] wall clock
 * @param {number} [spec.heartbeatEveryTicks=50]
 */
function create(spec) {
  var modeController = spec.modeController;
  if (!modeController || typeof modeController.mode !== 'function') {
    throw errors.ConfigError('a paper session requires a modeController');
  }
  if (modeController.mode() !== enums.Mode.PAPER) {
    throw errors.ModeTransitionRefused(
      'a paper session cannot be created in ' + modeController.mode() + ' mode. PAPER is reachable only ' +
      'through an owner-approval record bound to this configuration and commit ' +
      '(src/mode/mode-controller.js), and no flag or adapter choice substitutes for it.',
      { mode: modeController.mode(), required: enums.Mode.PAPER }
    );
  }

  var feed = feedMod.guarded(spec.feed);
  var logger = spec.logger || require('../core/logger').nullLogger();
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };
  var heartbeatEvery = spec.heartbeatEveryTicks === undefined ? 50 : spec.heartbeatEveryTicks;

  if (!Array.isArray(spec.arms) || spec.arms.length === 0 || spec.arms.length > 2) {
    throw errors.ConfigError(
      'a paper session needs one or two arms. Two is the A/B comparison (champion vs challenger); more than ' +
      'two would share one feed between competing accounts without a defined comparison.'
    );
  }

  var arms = spec.arms.map(function (a) { return createArm(a); });
  var ticks = 0;
  var startedAt = now();
  var finishedAt = null;
  var heartbeats = [];

  // =====================================================================
  // one arm
  // =====================================================================

  function createArm(armSpec) {
    var config = armSpec.config;
    if (config.mode !== enums.Mode.PAPER) {
      // The config's own mode must agree; a PAPER session running a BACKTEST
      // configuration would record results under the wrong mode.
      throw errors.ConfigError(
        'arm "' + armSpec.label + '" was given a configuration whose mode is ' + config.mode +
        '; a paper session must run a PAPER configuration so its records carry the right mode'
      );
    }
    var hooks = armSpec.hooks || {};
    if (typeof hooks.decide !== 'function') {
      throw errors.ConfigError('arm "' + armSpec.label + '" needs a decide(ctx) hook');
    }

    var runId = idsMod.runId('paper-' + armSpec.label, config.fingerprint.shortHash);
    var seq = idsMod.createSequence(runId);
    var rootRng = rngMod.create(String(config.backtest.seed) + '::' + runId);
    var armLogger = logger.child({ arm: armSpec.label, runId: runId });

    var store = armSpec.store || storeMod.create({
      runId: runId,
      now: function () { return lastTs === null ? startedAt : lastTs; },
      meta: {
        label: 'paper-' + armSpec.label,
        configHash: config.fingerprint.hash,
        mode: enums.Mode.PAPER,
        feed: feed.describe(),
        startedAtWallClock: startedAt
      }
    });

    var account = accountMod.create({
      initialCapital: config.account.initialCapital, logger: armLogger, store: store
    });
    var slot = slotMod.create({ logger: armLogger });
    var costModel = armSpec.costModel || costModelMod.create(config, { rng: rootRng.fork('cost') });
    var adapter = armSpec.adapter || paperAdapter.create({
      modeController: modeController, logger: armLogger,
      intrabarPolicy: config.backtest.allowIntrabarStopAndTarget, now: now
    });
    if (!adapter.supportsMode(enums.Mode.PAPER)) {
      throw errors.ConfigError('arm "' + armSpec.label + '" was given an adapter that does not support PAPER');
    }

    var arm = {
      label: armSpec.label,
      config: config,
      hooks: hooks,
      runId: runId,
      seq: seq,
      rng: rootRng,
      logger: armLogger,
      store: store,
      account: account,
      slot: slot,
      costModel: costModel,
      adapter: adapter,
      world: Object.create(null),      // symbol → accumulated bars + series
      openPosition: null,
      pendingEntry: null,
      trades: [],
      emergencyStopped: false,
      emergencyReason: null,
      counts: {
        ticks: 0, bars: 0, decisionsRequested: 0, candidates: 0,
        noTradeByStage: Object.create(null), slotBlocked: 0,
        entriesFilled: 0, entriesRejected: 0, pendingCancelled: 0,
        ambiguousBars: 0, gappedExits: 0
      }
    };

    if (hooks.onRunStart) {
      hooks.onRunStart({
        store: store, config: config, runId: runId, label: 'paper-' + armSpec.label,
        symbols: feed.symbols(), timeframe: feed.timeframe,
        higherTimeframe: config.backtest.higherTimeframe,
        datasetVersion: 'paper-feed:' + feed.kind, mode: enums.Mode.PAPER, logger: armLogger
      });
    }
    return arm;
  }

  var lastTs = null;

  // =====================================================================
  // per-symbol state, grown one bar at a time
  // =====================================================================

  function ingest(arm, symbol, bar) {
    var w = arm.world[symbol];
    if (!w) {
      w = arm.world[symbol] = {
        symbol: symbol,
        instrument: arm.config.instrument(symbol),
        bars: [],
        series: null,
        higherSeries: null,
        higherAlign: null,
        lastClose: null,
        barsSeen: 0
      };
    }
    w.bars.push(bar);
    w.barsSeen++;
    w.lastClose = bar.close;

    // Rebuilt over the FULL accumulated history — see point 3 in the file header.
    w.series = seriesMod.create({
      symbol: symbol, timeframe: feed.timeframe, bars: w.bars, validate: false
    });
    var htf = resampleMod.higherTimeframeView(w.bars, feed.timeframe, arm.config.backtest.higherTimeframe);
    w.higherSeries = htf.bars.length
      ? seriesMod.create({ symbol: symbol, timeframe: arm.config.backtest.higherTimeframe, bars: htf.bars, validate: false })
      : null;
    w.higherAlign = htf.align;

    if (arm.hooks.onSeriesReady) {
      arm.hooks.onSeriesReady({
        symbol: symbol, instrument: w.instrument, series: w.series,
        higherSeries: w.higherSeries, higherAlign: w.higherAlign, config: arm.config
      });
    }

    var index = w.bars.length - 1;
    var hIdx = w.higherAlign[index];
    return {
      w: w,
      index: index,
      bar: bar,
      view: w.series.viewAt(index),
      higherView: (w.higherSeries && hIdx >= 0) ? w.higherSeries.viewAt(hIdx) : null
    };
  }

  // =====================================================================
  // the tick — mirrors src/backtest/engine.js step for step
  // =====================================================================

  function step(arm, tick) {
    arm.counts.ticks++;
    var active = [];
    // Symbols are processed in the CONFIG'S UNIVERSE ORDER, not alphabetically —
    // the same order src/backtest/engine.js uses. With one global trade slot the
    // order decides which of two simultaneous candidates gets considered first, so
    // a different ordering here would make paper and backtest results diverge on
    // multi-asset runs for a reason that has nothing to do with the market.
    var universe = arm.config.universe;
    tick.bars.slice().sort(function (a, b) {
      var ia = universe.indexOf(a.symbol);
      var ib = universe.indexOf(b.symbol);
      if (ia === -1) ia = universe.length;
      if (ib === -1) ib = universe.length;
      if (ia !== ib) return ia - ib;
      return a.symbol < b.symbol ? -1 : 1;
    }).forEach(function (entry) {
      active.push(ingest(arm, entry.symbol, entry.bar));
    });
    arm.counts.bars += active.length;

    // 1. pending fill, then exits — in that order, on the same bar.
    active.forEach(function (a) {
      var openedOnThisBar = false;
      if (arm.pendingEntry && arm.pendingEntry.symbol === a.w.symbol) {
        if (arm.emergencyStopped) {
          cancelPendingEntry(arm, 'EMERGENCY_STOP', tick.ts);
        } else if (a.w.barsSeen > arm.pendingEntry.executeAfterBarsSeen) {
          openedOnThisBar = executePendingEntry(arm, a);
        }
      }
      if (arm.openPosition && arm.openPosition.symbol === a.w.symbol) {
        evaluateOpenPosition(arm, a, openedOnThisBar);
      }
    });

    // 2. mark to market, net of committed costs.
    markToMarket(arm, tick.ts);

    // 3. the per-bar hook, BEFORE decisions.
    if (arm.hooks.onBar) {
      arm.hooks.onBar({
        ts: tick.ts, active: active, views: active, account: arm.account,
        openPosition: arm.openPosition, slot: arm.slot, pendingEntry: arm.pendingEntry,
        store: arm.store, emergencyStopped: arm.emergencyStopped,
        emergencyStop: function (reason) { return stopEverything(arm, reason, tick.ts); }
      });
    }

    // 4. decisions — only with a free slot and no emergency stop.
    if (!arm.emergencyStopped && arm.slot.isFree()) {
      for (var i = 0; i < active.length; i++) {
        if (!arm.slot.isFree()) { arm.slot.noteBlocked(); arm.counts.slotBlocked++; continue; }
        var d = active[i];
        if (d.index < arm.config.backtest.warmupBars) continue;
        var outcome = askDecide(arm, d, tick.ts);
        if (outcome && outcome.accepted) break;
      }
    } else if (!arm.slot.isFree()) {
      arm.counts.slotBlocked++;
    }
  }

  function askDecide(arm, a, atTs) {
    arm.counts.decisionsRequested++;
    var ctx = {
      ts: atTs,
      symbol: a.w.symbol,
      instrument: a.w.instrument,
      view: a.view,
      higherView: a.higherView,
      higherTimeframe: arm.config.backtest.higherTimeframe,
      barIndex: a.index,
      account: arm.account,
      accountSnapshot: arm.account.snapshot(),
      config: arm.config,
      costModel: arm.costModel,
      store: arm.store,
      logger: arm.logger,
      rng: arm.rng,
      ids: arm.seq,
      slotFree: arm.slot.isFree(),
      mode: enums.Mode.PAPER,
      emergencyStop: function (reason) { return stopEverything(arm, reason, atTs); },
      spreadPips: function () {
        return arm.costModel.spreadPips(a.w.instrument, {
          ts: atTs,
          volatilityRatio: volatilityRatioAt(a.w, a.index),
          barRangePips: instrumentMod.toPips(a.w.instrument, a.bar.high - a.bar.low)
        });
      }
    };

    var result;
    try {
      result = arm.hooks.decide(ctx);
    } catch (e) {
      arm.store.table('system_events').insert({
        ts: atTs, kind: 'DECIDE_THREW', severity: 'ERROR',
        message: e.message, symbol: a.w.symbol, errorCode: e.code || null, arm: arm.label
      });
      throw e;
    }

    if (arm.emergencyStopped && result && result.decision === enums.PipelineDecision.ENTER) {
      arm.store.table('decisions').insert({
        ts: atTs, symbol: a.w.symbol, decision: enums.PipelineDecision.NO_TRADE,
        stage: enums.PipelineStage.RISK, candidateId: result.candidateId || null,
        reasonCodes: ['EMERGENCY_STOP_RAISED_DURING_DECISION']
      });
      return { accepted: false };
    }

    if (!result || result.decision === enums.PipelineDecision.NO_TRADE) {
      var stage = (result && result.stage) || enums.PipelineStage.STRATEGY;
      arm.counts.noTradeByStage[stage] = (arm.counts.noTradeByStage[stage] || 0) + 1;
      if (result && result.record !== false) {
        arm.store.table('decisions').insert({
          ts: atTs, symbol: a.w.symbol, decision: enums.PipelineDecision.NO_TRADE,
          stage: stage, candidateId: (result && result.candidateId) || null,
          reasonCodes: (result && result.reasonCodes) || []
        });
      }
      return { accepted: false };
    }

    requireOrderFields(result, a.w.symbol);
    arm.counts.candidates++;

    // A live feed cannot name the next bar's timestamp, so the pending entry is
    // scheduled against the COUNT of bars seen for this symbol. Over contiguous
    // replay data that is identical to the engine's index arithmetic.
    arm.pendingEntry = {
      candidateId: result.candidateId,
      orderId: arm.seq.next('order'),
      symbol: a.w.symbol,
      direction: result.direction,
      lots: result.lots,
      stopLoss: result.stopLoss,
      takeProfit: result.takeProfit,
      decidedAtTs: atTs,
      executeAfterBarsSeen: a.w.barsSeen + arm.config.cost.executionDelayBars,
      riskMoney: result.riskMoney === undefined ? null : result.riskMoney,
      recoveryLevel: result.recoveryLevel || 0,
      regime: result.regime || null,
      strategyId: result.strategyId || 'unknown',
      jevScore: result.jevScore === undefined ? null : result.jevScore
    };
    arm.slot.reserve({ candidateId: result.candidateId, symbol: a.w.symbol }, atTs);

    arm.store.table('orders').insert({
      orderId: arm.pendingEntry.orderId, candidateId: arm.pendingEntry.candidateId, ts: atTs,
      symbol: arm.pendingEntry.symbol, type: enums.OrderType.MARKET,
      direction: arm.pendingEntry.direction, lots: arm.pendingEntry.lots,
      requestedPrice: a.bar.close, status: enums.OrderStatus.PENDING,
      stopLoss: arm.pendingEntry.stopLoss, takeProfit: arm.pendingEntry.takeProfit,
      paper: true
    });
    arm.store.table('decisions').insert({
      ts: atTs, symbol: arm.pendingEntry.symbol, decision: enums.PipelineDecision.ENTER,
      stage: enums.PipelineStage.EXECUTION, candidateId: arm.pendingEntry.candidateId,
      reasonCodes: result.reasonCodes || []
    });
    return { accepted: true };
  }

  function executePendingEntry(arm, a) {
    var p = arm.pendingEntry;
    var inst = a.w.instrument;
    var fill = arm.adapter.fill({
      kind: adapterMod.FillKind.ENTRY, instrument: inst, direction: p.direction,
      lots: p.lots, requestedPrice: a.bar.open, bar: a.bar
    });
    if (fill.status !== 'FILLED') {
      arm.counts.entriesRejected++;
      arm.store.table('orders').insert({
        orderId: p.orderId, candidateId: p.candidateId, ts: a.bar.ts, symbol: p.symbol,
        type: enums.OrderType.MARKET, direction: p.direction, lots: p.lots,
        requestedPrice: a.bar.open, status: enums.OrderStatus.REJECTED,
        rejectReason: fill.reason, paper: true
      });
      arm.slot.release('ENTRY_REJECTED', a.bar.ts);
      arm.pendingEntry = null;
      return false;
    }

    var spreadPips = arm.costModel.spreadPips(inst, {
      ts: a.bar.ts,
      volatilityRatio: volatilityRatioAt(a.w, a.index),
      barRangePips: instrumentMod.toPips(inst, a.bar.high - a.bar.low)
    });
    var entrySlipPips = arm.costModel.slippagePips(inst, 'ENTRY');
    var committed = arm.costModel.roundTrip({
      instrument: inst, direction: p.direction, lots: p.lots, price: fill.price,
      spreadPips: spreadPips, entrySlippagePips: entrySlipPips, exitSlippagePips: 0, nights: 0
    });

    arm.openPosition = {
      positionId: arm.seq.next('pos'),
      orderId: p.orderId, candidateId: p.candidateId, symbol: p.symbol,
      strategyId: p.strategyId, direction: p.direction, lots: p.lots,
      entryTs: a.bar.ts, entryPrice: fill.price, entryIndex: a.index,
      stopLoss: p.stopLoss, takeProfit: p.takeProfit, status: enums.PositionStatus.OPEN,
      spreadPips: spreadPips, entrySlippagePips: entrySlipPips,
      committedCosts: money.money(committed.spreadMoney + committed.commissionMoney + committed.slippageMoney),
      riskMoney: p.riskMoney, recoveryLevel: p.recoveryLevel, regime: p.regime, jevScore: p.jevScore
    };

    arm.store.table('orders').insert({
      orderId: p.orderId, candidateId: p.candidateId, ts: a.bar.ts, symbol: p.symbol,
      type: enums.OrderType.MARKET, direction: p.direction, lots: p.lots,
      requestedPrice: a.bar.open, status: enums.OrderStatus.FILLED, filledPrice: fill.price,
      paper: true, wallClockAt: fill.wallClockAt, latencyMs: fill.latencyMs
    });
    arm.store.table('positions').insert({
      positionId: arm.openPosition.positionId, orderId: p.orderId, symbol: p.symbol,
      direction: p.direction, lots: p.lots, entryTs: a.bar.ts, entryPrice: fill.price,
      stopLoss: p.stopLoss, takeProfit: p.takeProfit, status: enums.PositionStatus.OPEN,
      candidateId: p.candidateId, recoveryLevel: p.recoveryLevel, regime: p.regime, paper: true
    });
    arm.slot.occupy(arm.openPosition, a.bar.ts);
    arm.counts.entriesFilled++;
    arm.pendingEntry = null;
    return true;
  }

  function evaluateOpenPosition(arm, a, openedOnThisBar) {
    var exit = arm.adapter.evaluateExit(arm.openPosition, a.bar, openedOnThisBar);
    if (exit && exit.kind === 'AMBIGUOUS') {
      arm.counts.ambiguousBars++;
      arm.store.table('system_events').insert({
        ts: a.bar.ts, kind: 'INTRABAR_AMBIGUOUS', severity: 'WARN',
        message: 'bar contained both stop and target; policy SKIP left the position open',
        symbol: a.w.symbol, positionId: arm.openPosition.positionId
      });
      return;
    }
    if (exit) {
      if (exit.gapped) arm.counts.gappedExits++;
      closePosition(arm, {
        bar: a.bar, index: a.index, price: exit.price,
        reason: exit.kind === adapterMod.FillKind.STOP ? enums.ExitReason.STOP_LOSS : enums.ExitReason.TAKE_PROFIT,
        gapped: exit.gapped, ambiguous: exit.ambiguous
      });
      return;
    }
    var barsHeld = a.index - arm.openPosition.entryIndex;
    if (barsHeld >= arm.config.backtest.maxBarsInTrade) {
      closePosition(arm, {
        bar: a.bar, index: a.index, price: a.bar.close,
        reason: enums.ExitReason.TIME_STOP, gapped: false
      });
    }
  }

  function closePosition(arm, s) {
    var pos = arm.openPosition;
    var inst = arm.world[pos.symbol].instrument;
    var exitPrice = money.round(s.price, inst.digits);
    var gross = instrumentMod.grossPnl(inst, pos.direction, pos.entryPrice, exitPrice, pos.lots);

    var isStop = s.reason === enums.ExitReason.STOP_LOSS;
    var exitSlipPips = arm.costModel.slippagePips(
      inst, isStop ? 'STOP' : (s.reason === enums.ExitReason.TAKE_PROFIT ? 'TARGET' : 'ENTRY')
    );
    var nights = arm.costModel.nightsHeld(pos.entryTs, s.bar.ts);
    var costs = arm.costModel.roundTrip({
      instrument: inst, direction: pos.direction, lots: pos.lots, price: exitPrice,
      spreadPips: pos.spreadPips, entrySlippagePips: pos.entrySlippagePips,
      exitSlippagePips: exitSlipPips, nights: nights
    });
    var net = money.money(gross - costs.totalMoney);
    var outcome = net > 0 ? enums.TradeOutcome.WIN : (net < 0 ? enums.TradeOutcome.LOSS : enums.TradeOutcome.BREAKEVEN);

    arm.account.applyTrade({
      ts: s.bar.ts, netPnl: net, grossPnl: gross, costsMoney: costs.totalMoney, outcome: outcome
    });

    var trade = {
      tradeId: arm.seq.next('trade'),
      positionId: pos.positionId, candidateId: pos.candidateId, symbol: pos.symbol,
      strategyId: pos.strategyId, direction: pos.direction,
      entryTs: pos.entryTs, exitTs: s.bar.ts, entryPrice: pos.entryPrice, exitPrice: exitPrice,
      lots: pos.lots, grossPnl: gross, costsMoney: costs.totalMoney, netPnl: net,
      outcome: outcome, exitReason: s.reason, regime: pos.regime, jevScore: pos.jevScore,
      recoveryLevel: pos.recoveryLevel, barsHeld: s.index - pos.entryIndex,
      equityAfter: arm.account.balance(), riskMoney: pos.riskMoney,
      stopLoss: pos.stopLoss, takeProfit: pos.takeProfit,
      spreadPips: pos.spreadPips, spreadMoney: costs.spreadMoney,
      commissionMoney: costs.commissionMoney, slippagePips: costs.slippagePips,
      slippageMoney: costs.slippageMoney, swapMoney: costs.swapMoney, nightsHeld: nights,
      gapped: !!s.gapped, intrabarAmbiguous: !!s.ambiguous,
      /** The marker that keeps paper evidence distinguishable from a backtest. */
      paper: true
    };
    arm.trades.push(trade);
    arm.store.table('trades').insert(trade);
    arm.store.table('cost_assessments').insert({
      candidateId: pos.candidateId, ts: s.bar.ts, symbol: pos.symbol,
      spreadMoney: costs.spreadMoney, commissionMoney: costs.commissionMoney,
      slippageMoney: costs.slippageMoney, swapMoney: costs.swapMoney,
      totalCostMoney: costs.totalMoney, passed: true, phase: 'REALISED'
    });
    arm.store.table('positions').insert({
      positionId: pos.positionId, orderId: pos.orderId, symbol: pos.symbol,
      direction: pos.direction, lots: pos.lots, entryTs: pos.entryTs, entryPrice: pos.entryPrice,
      stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, status: enums.PositionStatus.CLOSED,
      exitTs: s.bar.ts, exitPrice: exitPrice, candidateId: pos.candidateId, paper: true
    });

    arm.openPosition = null;
    arm.slot.release(s.reason, s.bar.ts);
    if (arm.hooks.onTradeClosed) arm.hooks.onTradeClosed(trade, { account: arm.account, store: arm.store });
  }

  function markToMarket(arm, atTs) {
    var openPnl = 0;
    var openRisk = 0;
    if (arm.openPosition) {
      var w = arm.world[arm.openPosition.symbol];
      var inst = w.instrument;
      var px = w.lastClose === null ? arm.openPosition.entryPrice : w.lastClose;
      openPnl = money.money(
        instrumentMod.grossPnl(inst, arm.openPosition.direction, arm.openPosition.entryPrice, px, arm.openPosition.lots) -
        arm.openPosition.committedCosts
      );
      openRisk = arm.openPosition.riskMoney || 0;
    }
    arm.account.markToMarket(atTs, openPnl, openRisk);
  }

  function cancelPendingEntry(arm, reason, ts) {
    if (!arm.pendingEntry) return null;
    var id = arm.pendingEntry.candidateId;
    arm.store.table('orders').insert({
      orderId: arm.pendingEntry.orderId, candidateId: id, ts: ts, symbol: arm.pendingEntry.symbol,
      type: enums.OrderType.MARKET, direction: arm.pendingEntry.direction, lots: arm.pendingEntry.lots,
      requestedPrice: arm.pendingEntry.stopLoss, status: enums.OrderStatus.CANCELLED,
      rejectReason: reason, paper: true
    });
    arm.slot.release(reason, ts);
    arm.counts.pendingCancelled++;
    arm.pendingEntry = null;
    return id;
  }

  function stopEverything(arm, reason, ts) {
    if (arm.emergencyStopped) return;
    arm.emergencyStopped = true;
    arm.emergencyReason = reason;
    var cancelled = arm.pendingEntry ? cancelPendingEntry(arm, 'EMERGENCY_STOP', ts) : null;
    arm.store.table('system_events').insert({
      ts: ts, kind: 'EMERGENCY_STOP', severity: 'ERROR', message: reason,
      cancelledPendingEntry: cancelled, arm: arm.label
    });
    arm.logger.error('paper.emergency_stop', { reason: reason, arm: arm.label });
  }

  function volatilityRatioAt(w, index) {
    if (!w.series.hasIndicator('volRatio')) return undefined;
    var v = w.series.indicatorValues('volRatio')[index];
    return v === null ? undefined : v;
  }

  // =====================================================================
  // the session
  // =====================================================================

  /** Advances every arm by one tick. Returns the tick, or null when exhausted. */
  function tick() {
    var t = feed.next();
    if (t === null) return null;
    lastTs = t.ts;
    ticks++;
    arms.forEach(function (arm) { step(arm, t); });
    if (heartbeatEvery > 0 && ticks % heartbeatEvery === 0) beat();
    return t;
  }

  /** Runs until the feed is exhausted or `maxTicks` is reached. */
  function run(maxTicks) {
    var limit = maxTicks === undefined ? Infinity : maxTicks;
    var n = 0;
    while (n < limit) {
      if (tick() === null) break;
      n++;
    }
    return finish();
  }

  /**
   * Records a heartbeat. A paper session that stops reporting is indistinguishable
   * from one that is idle, which is why this exists and a backtest has no need of it.
   */
  function beat() {
    var hb = {
      at: now(), ticks: ticks, lastBarTs: lastTs,
      lastBarIso: lastTs === null ? null : clock.iso(lastTs),
      feed: feed.progress ? feed.progress() : null,
      arms: arms.map(function (arm) {
        return {
          label: arm.label,
          equity: arm.account.equity(),
          trades: arm.trades.length,
          open: arm.openPosition ? arm.openPosition.symbol : null,
          pending: arm.pendingEntry ? arm.pendingEntry.symbol : null,
          emergencyStopped: arm.emergencyStopped
        };
      })
    };
    heartbeats.push(hb);
    arms.forEach(function (arm) {
      arm.store.table('health_checks').insert({
        ts: lastTs, check: 'PAPER_HEARTBEAT', status: arm.emergencyStopped ? 'STOPPED' : 'OK', detail: hb
      });
      if (arm.adapter.heartbeat) arm.adapter.heartbeat({ ticks: ticks });
    });
    logger.info('paper.heartbeat', { ticks: ticks, arms: hb.arms.length });
    return hb;
  }

  /** Closes anything open, seals nothing, and returns the result per arm. */
  function finish() {
    finishedAt = now();
    arms.forEach(function (arm) {
      if (arm.pendingEntry) cancelPendingEntry(arm, 'SESSION_ENDED_PENDING', lastTs);
      if (arm.openPosition) {
        var w = arm.world[arm.openPosition.symbol];
        var lastIndex = w.bars.length - 1;
        closePosition(arm, {
          bar: w.bars[lastIndex], index: lastIndex, price: w.bars[lastIndex].close,
          reason: enums.ExitReason.END_OF_DATA, gapped: false
        });
      }
      var invariant = arm.slot.verifyInvariant();
      if (!invariant.ok) {
        throw errors.RiskAuthorityViolation(
          'one-trade-only invariant violated in paper arm "' + arm.label + '" at transition ' + invariant.at,
          invariant
        );
      }
    });
    beat();
    return result();
  }

  function armResult(arm) {
    var metrics = metricsMod.compute({
      trades: arm.trades,
      initialCapital: arm.config.account.initialCapital,
      equityCurve: arm.account.equityCurve(),
      counts: plainCounts(arm.counts)
    });
    arm.store.table('backtests').insert({
      backtestId: 'paper-' + arm.runId,
      label: 'paper-' + arm.label,
      configHash: arm.config.fingerprint.hash,
      datasetVersion: 'paper-feed:' + feed.kind,
      seed: String(arm.config.backtest.seed),
      segment: {
        timeframe: feed.timeframe, symbols: feed.symbols(),
        fromTs: arm.account.equityCurve().length ? arm.account.equityCurve()[0].ts : null,
        toTs: lastTs, bars: arm.counts.bars
      },
      metrics: metrics,
      startedAt: startedAt,
      finishedAt: finishedAt,
      mode: enums.Mode.PAPER,
      paper: true,
      emergencyStopped: arm.emergencyStopped,
      emergencyReason: arm.emergencyReason
    });
    return {
      label: arm.label,
      runId: arm.runId,
      configHash: arm.config.fingerprint.hash,
      metrics: metrics,
      trades: arm.trades,
      account: arm.account,
      slot: arm.slot,
      store: arm.store,
      counts: plainCounts(arm.counts),
      emergencyStopped: arm.emergencyStopped,
      emergencyReason: arm.emergencyReason,
      adapterStats: arm.adapter.stats ? arm.adapter.stats() : null,
      digest: function () { return arm.store.digest(); }
    };
  }

  function result() {
    var armResults = arms.map(armResult);
    var out = {
      mode: enums.Mode.PAPER,
      paper: true,
      ticks: ticks,
      startedAt: startedAt,
      finishedAt: finishedAt,
      wallClockMs: finishedAt === null ? null : finishedAt - startedAt,
      feed: feed.describe(),
      arms: armResults,
      heartbeats: heartbeats.slice(),
      /** The A/B comparison, when there are two arms. */
      comparison: armResults.length === 2 ? compareArms(armResults[0], armResults[1]) : null
    };
    return out;
  }

  /**
   * The A/B comparison mission §12 calls DEMO A/B.
   *
   * Both arms saw the SAME ticks, which is the whole point: a difference between
   * them is attributable to the configuration rather than to the market. It reports
   * deltas and refuses to call a winner — that is the Champion/Challenger gate's
   * decision, on more evidence than one session.
   */
  function compareArms(a, b) {
    function delta(field) {
      if (typeof a.metrics[field] !== 'number' || typeof b.metrics[field] !== 'number') return null;
      return money.round(b.metrics[field] - a.metrics[field], 6);
    }
    return {
      armA: a.label,
      armB: b.label,
      sameFeed: true,
      netPnlDelta: delta('netPnl'),
      expectancyDelta: delta('expectancy'),
      drawdownDeltaPct: delta('maxDrawdownPct'),
      streakDelta: b.metrics.maxConsecutiveLosses - a.metrics.maxConsecutiveLosses,
      tradeCountA: a.metrics.tradeCount,
      tradeCountB: b.metrics.tradeCount,
      note: 'Both arms consumed identical ticks, so a difference is attributable to the configuration. This ' +
        'reports deltas and does NOT call a winner: promoting is the Champion/Challenger gate\'s decision, on ' +
        'more evidence than one session (mission §13).'
    };
  }

  function plainCounts(counts) {
    var out = {};
    Object.keys(counts).forEach(function (k) {
      var v = counts[k];
      if (v && typeof v === 'object') {
        var inner = {};
        Object.keys(v).sort().forEach(function (kk) { inner[kk] = v[kk]; });
        out[k] = inner;
      } else out[k] = v;
    });
    return out;
  }

  function requireOrderFields(order, symbol) {
    ['candidateId', 'direction', 'lots', 'stopLoss', 'takeProfit'].forEach(function (f) {
      if (order[f] === undefined || order[f] === null) {
        throw errors.CandidateError(
          'decide() returned an ENTER for ' + symbol + ' without "' + f + '"', { missing: f }
        );
      }
    });
    enums.assertEnum(enums.Direction, order.direction, 'order.direction');
    if (order.direction === enums.Direction.NEUTRAL) {
      throw errors.CandidateError('an ENTER cannot be NEUTRAL for ' + symbol);
    }
    if (!(order.lots > 0)) {
      throw errors.CandidateError('an ENTER for ' + symbol + ' must have lots > 0, got ' + order.lots);
    }
    return order;
  }

  return {
    mode: enums.Mode.PAPER,
    tick: tick,
    run: run,
    finish: finish,
    heartbeat: beat,
    result: result,
    arms: function () { return arms.map(function (a) { return a.label; }); },
    arm: function (label) {
      var found = arms.filter(function (a) { return a.label === label; })[0];
      return found || null;
    },
    ticks: function () { return ticks; },
    feed: function () { return feed.describe(); },
    heartbeats: function () { return heartbeats.slice(); }
  };
}

module.exports = { create: create };
