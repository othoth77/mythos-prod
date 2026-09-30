'use strict';
// =====================================================
// MYTHOS TRADING AGENT — backtest engine
// projects/mythos-trading-agent/src/backtest/engine.js
//
// A single-position, multi-asset, bar-replay event loop. It owns execution
// mechanics, accounting and the audit trail; it owns NO trading opinion. The
// decision — which asset, which direction, what size, or nothing at all — comes
// from the `decide` callback, which Phase 9's Trading Agent supplies. That split
// is what lets the risk, recovery and Jev layers be tested against this engine
// instead of inside it.
//
// THE FOUR RULES THAT DECIDE WHETHER A BACKTEST IS HONEST
//
//  1. A SIGNAL DECIDED ON BAR i EXECUTES AT THE OPEN OF BAR i+1. You cannot
//     trade at a close you have only just observed. `cost.executionDelayBars` is
//     ADDITIONAL delay on top of that mandatory one bar, never a way to remove
//     it, and src/execution/backtest-adapter.js rejects any entry whose price is
//     not the bar open so the rule cannot be bypassed from a caller.
//
//  2. EXITS ARE EVALUATED BEFORE ENTRIES, per bar. A position that closes on bar
//     i frees the slot for a decision made on bar i, which then executes on bar
//     i+1. Doing it the other way round would let the engine hold two positions
//     for one bar.
//
//  3. THE SLOT IS OCCUPIED WHILE AN ENTRY IS MERELY PENDING. Between the
//     decision on bar i and the fill on bar i+1 nothing is open, but a second
//     symbol must still be refused — otherwise two positions appear one bar
//     later. src/account/one-trade-controller.js has three states for this
//     reason, and the engine asserts its invariant at the end of every run.
//
//  4. EQUITY IS MARKED TO MARKET ON EVERY BAR, net of the costs already
//     committed. A drawdown limit computed from closed trades alone cannot fire
//     while a losing position is still open, which is the only moment it
//     matters.
//
// DETERMINISM. Symbols are processed in a fixed order, ids are counter-based, and
// every random draw comes from a seed derived from the run. Two runs of one
// configuration therefore produce identical stores, and store.digest() equality
// is the reproducibility check mission §14 asks for.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var clock = require('../core/clock');
var idsMod = require('../core/ids');
var rngMod = require('../core/rng');
var loggerMod = require('../core/logger');
var instrumentMod = require('../core/instrument');

var seriesMod = require('../data/series');
var resampleMod = require('../data/resample');
var sourceMod = require('../data/source');

var costModelMod = require('../cost/model');
var accountMod = require('../account/account');
var slotMod = require('../account/one-trade-controller');
var backtestAdapter = require('../execution/backtest-adapter');
var adapterMod = require('../execution/adapter');
var storeMod = require('../db/store');
var metricsMod = require('./metrics');

/**
 * Runs a backtest.
 *
 * @param {object} spec
 * @param {object} spec.config validated, frozen platform config
 * @param {object} spec.source data source (raw or guarded)
 * @param {function} spec.decide (ctx) => order | noTrade | null
 * @param {string[]} [spec.symbols] defaults to config.universe
 * @param {string} [spec.timeframe] defaults to config.backtest.baseTimeframe
 * @param {object} [spec.range] { fromTs, toTs }
 * @param {string} [spec.label] segment label, e.g. 'in-sample'
 * @param {function} [spec.onRunStart] ({store, config, runId, …}) — called once,
 *        before any data is loaded, so the decision layer can bind to this run's
 *        store rather than to one of its own
 * @param {function} [spec.onSeriesReady] ({symbol, series, higherSeries}) — where
 *        strategies register their indicators
 * @param {function} [spec.onTradeClosed] (trade) — where the recovery engine learns
 * @param {function} [spec.onBar] (ctx) — observation only
 * @param {object} [spec.store] existing store; one is created when absent
 * @param {object} [spec.logger]
 * @returns {object} run result
 */
function run(spec) {
  var config = spec.config;
  var timeframe = spec.timeframe || config.backtest.baseTimeframe;
  var higherTimeframe = config.backtest.higherTimeframe;
  var symbols = (spec.symbols || config.universe).slice();
  var label = spec.label || 'backtest';
  var decide = spec.decide;
  if (typeof decide !== 'function') {
    throw errors.ConfigError('engine.run() requires a decide(ctx) function — the engine holds no trading opinion of its own');
  }

  var runId = idsMod.runId(label, config.fingerprint.shortHash);
  var seq = idsMod.createSequence(runId);
  var rootRng = rngMod.create(String(config.backtest.seed) + '::' + runId);
  var logger = (spec.logger || loggerMod.nullLogger()).child({ runId: runId });

  var source = sourceMod.guarded(spec.source);
  var catalog = config.catalog;
  var costModel = spec.costModel || costModelMod.create(config, { rng: rootRng.fork('cost') });
  var adapter = spec.adapter || backtestAdapter.create({
    logger: logger,
    mode: config.mode,
    intrabarPolicy: config.backtest.allowIntrabarStopAndTarget
  });
  if (!adapter.supportsMode(config.mode)) {
    throw errors.ModeTransitionRefused(
      'execution adapter "' + adapter.kind + '" does not support mode ' + config.mode,
      { adapter: adapter.kind, mode: config.mode }
    );
  }

  var store = spec.store || storeMod.create({
    runId: runId,
    now: function () { return lastTs === null ? 0 : lastTs; },
    meta: {
      label: label,
      configHash: config.fingerprint.hash,
      datasetVersion: source.datasetVersion,
      timeframe: timeframe,
      symbols: symbols,
      mode: config.mode
    }
  });

  var account = accountMod.create({
    initialCapital: config.account.initialCapital,
    logger: logger,
    store: store
  });
  var slot = slotMod.create({ logger: logger });

  // ---- 0. run start -----------------------------------------------------
  // Handed to the decision layer BEFORE any data is loaded, so it can bind to
  // THIS run's store. Without this hook a caller has to create the store itself
  // and pass the same object to two places; forgetting meant the agent wrote its
  // candidates, Jev verdicts and risk assessments into a store nobody ever read,
  // and the run still produced trades — a silent, complete loss of the audit
  // trail. The hook exists so that failure mode is unreachable.
  if (spec.onRunStart) {
    spec.onRunStart({
      store: store,
      config: config,
      runId: runId,
      label: label,
      symbols: symbols,
      timeframe: timeframe,
      higherTimeframe: higherTimeframe,
      datasetVersion: source.datasetVersion,
      mode: config.mode,
      logger: logger
    });
  }

  // ---- 1. load and prepare every symbol ---------------------------------
  var world = Object.create(null);
  symbols.forEach(function (sym) {
    var inst = catalog.get(sym);
    var bars = source.load(sym, timeframe, spec.range);
    var series = seriesMod.create({ symbol: sym, timeframe: timeframe, bars: bars, validate: false });
    var htf = resampleMod.higherTimeframeView(bars, timeframe, higherTimeframe);
    var higherSeries = htf.bars.length
      ? seriesMod.create({ symbol: sym, timeframe: higherTimeframe, bars: htf.bars, validate: false })
      : null;

    world[sym] = {
      symbol: sym,
      instrument: inst,
      series: series,
      bars: bars,
      higherSeries: higherSeries,
      higherAlign: htf.align,
      tsToIndex: buildTsIndex(bars),
      lastClose: null
    };
    store.table('market_data_meta').insert(source.meta(sym, timeframe, spec.range));
    if (spec.onSeriesReady) {
      spec.onSeriesReady({
        symbol: sym, instrument: inst, series: series,
        higherSeries: higherSeries, higherAlign: htf.align, config: config
      });
    }
  });

  // ---- 2. the global timeline -------------------------------------------
  var timeline = buildTimeline(world, symbols);
  if (timeline.length === 0) {
    throw errors.DataError('no bars in range for [' + symbols.join(', ') + '] at ' + timeframe);
  }

  // ---- 3. state ----------------------------------------------------------
  var lastTs = null;
  var openPosition = null;
  var pendingEntry = null;
  var trades = [];
  var startedAt = timeline[0];
  var counts = {
    bars: 0,
    decisionsRequested: 0,
    candidates: 0,
    noTradeByStage: Object.create(null),
    slotBlocked: 0,
    entriesFilled: 0,
    entriesRejected: 0,
    pendingCancelled: 0,
    ambiguousBars: 0,
    gappedExits: 0
  };
  var emergencyStopped = false;
  var emergencyReason = null;

  var extraDelay = config.cost.executionDelayBars;

  // ---- 4. the loop ------------------------------------------------------
  for (var ti = 0; ti < timeline.length; ti++) {
    var ts = timeline[ti];
    lastTs = ts;
    var active = [];
    for (var si = 0; si < symbols.length; si++) {
      var w = world[symbols[si]];
      var idx = w.tsToIndex[ts];
      if (idx === undefined) continue;
      w.lastClose = w.bars[idx].close;
      var hIdx0 = w.higherAlign[idx];
      active.push({
        w: w,
        index: idx,
        bar: w.bars[idx],
        // Views are built once per active symbol per bar and shared by the
        // per-bar hook and the decision hook. Building them here rather than
        // inside askDecide() is what lets a per-bar observer (the regime engine)
        // see EVERY bar — see the note on hook ordering below.
        view: w.series.viewAt(idx),
        higherView: (w.higherSeries && hIdx0 >= 0) ? w.higherSeries.viewAt(hIdx0) : null
      });
    }
    counts.bars += active.length;

    // 4a. pending entry, then exits — in that order, on the same bar.
    for (var ai = 0; ai < active.length; ai++) {
      var a = active[ai];
      var openedOnThisBar = false;

      if (pendingEntry && pendingEntry.symbol === a.w.symbol) {
        if (emergencyStopped) {
          // Defensive: with the current hook ordering a pending entry cannot
          // coexist with an emergency stop (the decision hook is gated on it), so
          // this branch is an invariant guard rather than a live path. It stays
          // because the ordering is the only thing making it unreachable, and a
          // future reorder must not turn that into a filled order.
          cancelPendingEntry('EMERGENCY_STOP', ts);
        } else if (ts >= pendingEntry.executeAtTs) {
          openedOnThisBar = executePendingEntry(a);
        }
      }

      if (openPosition && openPosition.symbol === a.w.symbol) {
        evaluateOpenPosition(a, openedOnThisBar);
      }
    }

    // 4b. mark to market on every bar, net of committed costs.
    markToMarket(ts);

    // 4c. THE PER-BAR HOOK, BEFORE DECISIONS. Two reasons, both learned the hard
    // way:
    //   * the Risk Engine's monitor lives here, and running it after decisions
    //     meant a drawdown breach was detected only once that bar had already been
    //     allowed to trade;
    //   * the regime engine lives here too, and it must see EVERY bar. When it was
    //     driven from decide() — which is only reached while the trade slot is
    //     free — the regime was classified on a subset of bars that depended on
    //     trading activity, so its hysteresis dwell counted wrongly and the label
    //     became a function of whether a position happened to be open.
    if (spec.onBar) {
      spec.onBar({
        ts: ts, active: active, views: active, account: account,
        openPosition: openPosition, slot: slot, pendingEntry: pendingEntry, store: store,
        emergencyStopped: emergencyStopped,
        emergencyStop: function (reason) { return stopEverything(reason); }
      });
    }

    // 4d. decisions — only with a free slot and no emergency stop.
    if (!emergencyStopped && slot.isFree()) {
      for (var di = 0; di < active.length; di++) {
        if (!slot.isFree()) { slot.noteBlocked(); counts.slotBlocked++; continue; }
        var d = active[di];
        if (d.index < config.backtest.warmupBars) continue;
        var outcome = askDecide(d, ts);
        if (outcome && outcome.accepted) break; // the slot is taken; stop asking
      }
    } else if (!slot.isFree()) {
      // Every bar on which a signal could not even be considered is counted:
      // "how often did one-trade-only cost us an opportunity?" is a headline
      // number for a single-position account, not a footnote.
      counts.slotBlocked++;
    }
  }

  // ---- 5. close anything still open ------------------------------------
  if (pendingEntry) cancelPendingEntry('END_OF_DATA_PENDING', lastTs);
  if (openPosition) {
    var lastW = world[openPosition.symbol];
    var lastIdx = lastW.bars.length - 1;
    closePosition({
      bar: lastW.bars[lastIdx],
      index: lastIdx,
      price: lastW.bars[lastIdx].close,
      reason: enums.ExitReason.END_OF_DATA,
      gapped: false
    });
  }

  // ---- 6. results ------------------------------------------------------
  var invariant = slot.verifyInvariant();
  if (!invariant.ok) {
    // This is not a trading outcome, it is a broken engine. Fail the run.
    throw errors.RiskAuthorityViolation(
      'one-trade-only invariant violated during the run at transition ' + invariant.at,
      invariant
    );
  }

  var metrics = metricsMod.compute({
    trades: trades,
    initialCapital: config.account.initialCapital,
    equityCurve: account.equityCurve(),
    counts: plainCounts(counts)
  });

  var finishedAt = lastTs;
  store.table('backtests').insert({
    backtestId: 'bt-' + runId,
    label: label,
    configHash: config.fingerprint.hash,
    datasetVersion: source.datasetVersion,
    seed: String(config.backtest.seed),
    segment: {
      timeframe: timeframe,
      symbols: symbols,
      fromTs: startedAt,
      toTs: finishedAt,
      fromIso: clock.iso(startedAt),
      toIso: clock.iso(finishedAt),
      bars: timeline.length
    },
    metrics: metrics,
    startedAt: startedAt,
    finishedAt: finishedAt,
    mode: config.mode,
    emergencyStopped: emergencyStopped,
    emergencyReason: emergencyReason
  });

  logger.info('backtest.finished', {
    label: label, trades: trades.length,
    netPnl: metrics.netPnl, maxDrawdownPct: metrics.maxDrawdownPct,
    maxConsecutiveLosses: metrics.maxConsecutiveLosses
  });

  return {
    runId: runId,
    label: label,
    config: config,
    metrics: metrics,
    trades: trades,
    account: account,
    slot: slot,
    store: store,
    counts: plainCounts(counts),
    timeline: { bars: timeline.length, fromTs: startedAt, toTs: finishedAt },
    datasetVersion: source.datasetVersion,
    emergencyStopped: emergencyStopped,
    emergencyReason: emergencyReason,
    adapterStats: adapter.stats ? adapter.stats() : null,
    digest: function () { return store.digest(); },
    seal: function () { return store.seal(); }
  };

  // =====================================================================
  // internals
  // =====================================================================

  /** Asks `decide` for this symbol and applies whatever comes back. */
  function askDecide(a, atTs) {
    counts.decisionsRequested++;
    var view = a.view;
    var higherView = a.higherView;

    var ctx = {
      ts: atTs,
      symbol: a.w.symbol,
      instrument: a.w.instrument,
      view: view,
      higherView: higherView,
      higherTimeframe: higherTimeframe,
      barIndex: a.index,
      account: account,
      accountSnapshot: account.snapshot(),
      config: config,
      costModel: costModel,
      store: store,
      logger: logger,
      rng: rootRng,
      ids: seq,
      slotFree: slot.isFree(),
      /**
       * Halts every further entry for the remainder of the run. This is the
       * EMERGENCY_STOP hard limit (mission §8): the Risk Engine calls it, and
       * once called nothing re-enables it inside the run — a kill switch that a
       * later decision could reset would not be one.
       */
      emergencyStop: function (reason) { return stopEverything(reason); },
      /** Spread the cost model would quote right now, in pips. */
      spreadPips: function () {
        return costModel.spreadPips(a.w.instrument, {
          ts: atTs,
          volatilityRatio: volatilityRatioAt(a.w, a.index),
          barRangePips: instrumentMod.toPips(a.w.instrument, a.bar.high - a.bar.low)
        });
      }
    };

    var result;
    try {
      result = decide(ctx);
    } catch (e) {
      // A decision layer that throws must not silently become "no trade": the
      // run records it and stops, because a half-evaluated pipeline produces a
      // result nobody can interpret.
      store.table('system_events').insert({
        ts: atTs, kind: 'DECIDE_THREW', severity: 'ERROR',
        message: e.message, symbol: a.w.symbol, errorCode: e.code || null
      });
      throw e;
    }

    // A decision layer that raises the emergency stop DURING its own evaluation
    // must not also be allowed to open a position on that evaluation.
    if (emergencyStopped && result && result.decision === enums.PipelineDecision.ENTER) {
      store.table('decisions').insert({
        ts: atTs, symbol: a.w.symbol, decision: enums.PipelineDecision.NO_TRADE,
        stage: enums.PipelineStage.RISK, candidateId: result.candidateId || null,
        reasonCodes: ['EMERGENCY_STOP_RAISED_DURING_DECISION']
      });
      return { accepted: false };
    }

    if (!result || result.decision === enums.PipelineDecision.NO_TRADE) {
      var stage = (result && result.stage) || enums.PipelineStage.STRATEGY;
      counts.noTradeByStage[stage] = (counts.noTradeByStage[stage] || 0) + 1;
      if (result && result.record !== false) {
        store.table('decisions').insert({
          ts: atTs, symbol: a.w.symbol,
          decision: enums.PipelineDecision.NO_TRADE,
          stage: stage,
          candidateId: (result && result.candidateId) || null,
          reasonCodes: (result && result.reasonCodes) || []
        });
      }
      return { accepted: false };
    }

    // An ENTER must carry everything execution needs; anything missing is a
    // programming error in the decision layer, not a market condition.
    requireOrderFields(result, a.w.symbol);
    counts.candidates++;

    var executeAt = nextExecutableTs(a.w, a.index, 1 + extraDelay);
    if (executeAt === null) {
      // There is no later bar for this symbol, so the order could never fill.
      counts.noTradeByStage['EXECUTION'] = (counts.noTradeByStage['EXECUTION'] || 0) + 1;
      store.table('decisions').insert({
        ts: atTs, symbol: a.w.symbol, decision: enums.PipelineDecision.NO_TRADE,
        stage: enums.PipelineStage.EXECUTION, candidateId: result.candidateId,
        reasonCodes: ['NO_FUTURE_BAR_TO_EXECUTE_ON']
      });
      return { accepted: false };
    }

    slot.reserve({ candidateId: result.candidateId, symbol: a.w.symbol }, atTs);
    pendingEntry = {
      candidateId: result.candidateId,
      orderId: seq.next('order'),
      symbol: a.w.symbol,
      direction: result.direction,
      lots: result.lots,
      stopLoss: result.stopLoss,
      takeProfit: result.takeProfit,
      decidedAtTs: atTs,
      decidedAtIndex: a.index,
      executeAtTs: executeAt,
      riskMoney: result.riskMoney === undefined ? null : result.riskMoney,
      recoveryLevel: result.recoveryLevel || 0,
      regime: result.regime || null,
      strategyId: result.strategyId || 'unknown',
      jevScore: result.jevScore === undefined ? null : result.jevScore,
      meta: result.meta || null
    };

    store.table('orders').insert({
      orderId: pendingEntry.orderId,
      candidateId: pendingEntry.candidateId,
      ts: atTs,
      symbol: pendingEntry.symbol,
      type: enums.OrderType.MARKET,
      direction: pendingEntry.direction,
      lots: pendingEntry.lots,
      requestedPrice: a.bar.close,
      status: enums.OrderStatus.PENDING,
      executeAtTs: executeAt,
      stopLoss: pendingEntry.stopLoss,
      takeProfit: pendingEntry.takeProfit
    });
    store.table('decisions').insert({
      ts: atTs, symbol: pendingEntry.symbol,
      decision: enums.PipelineDecision.ENTER,
      stage: enums.PipelineStage.EXECUTION,
      candidateId: pendingEntry.candidateId,
      reasonCodes: result.reasonCodes || []
    });
    return { accepted: true };
  }

  /** Fills the pending entry at this bar's open. Returns true when it opened. */
  function executePendingEntry(a) {
    var p = pendingEntry;
    var inst = a.w.instrument;
    var req = {
      kind: adapterMod.FillKind.ENTRY,
      instrument: inst,
      direction: p.direction,
      lots: p.lots,
      requestedPrice: a.bar.open,
      bar: a.bar
    };
    var fill = adapter.fill(req);
    if (fill.status !== 'FILLED') {
      counts.entriesRejected++;
      store.table('orders').insert({
        orderId: p.orderId, candidateId: p.candidateId, ts: a.bar.ts, symbol: p.symbol,
        type: enums.OrderType.MARKET, direction: p.direction, lots: p.lots,
        requestedPrice: a.bar.open, status: enums.OrderStatus.REJECTED, rejectReason: fill.reason
      });
      slot.release('ENTRY_REJECTED', a.bar.ts);
      pendingEntry = null;
      return false;
    }

    var spreadPips = costModel.spreadPips(inst, {
      ts: a.bar.ts,
      volatilityRatio: volatilityRatioAt(a.w, a.index),
      barRangePips: instrumentMod.toPips(inst, a.bar.high - a.bar.low)
    });
    var entrySlipPips = costModel.slippagePips(inst, 'ENTRY');
    var committed = costModel.roundTrip({
      instrument: inst, direction: p.direction, lots: p.lots, price: fill.price,
      spreadPips: spreadPips, entrySlippagePips: entrySlipPips, exitSlippagePips: 0, nights: 0
    });

    openPosition = {
      positionId: seq.next('pos'),
      orderId: p.orderId,
      candidateId: p.candidateId,
      symbol: p.symbol,
      strategyId: p.strategyId,
      direction: p.direction,
      lots: p.lots,
      entryTs: a.bar.ts,
      entryPrice: fill.price,
      entryIndex: a.index,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      status: enums.PositionStatus.OPEN,
      spreadPips: spreadPips,
      entrySlippagePips: entrySlipPips,
      committedCosts: money.money(committed.spreadMoney + committed.commissionMoney + committed.slippageMoney),
      riskMoney: p.riskMoney,
      recoveryLevel: p.recoveryLevel,
      regime: p.regime,
      jevScore: p.jevScore
    };

    store.table('orders').insert({
      orderId: p.orderId, candidateId: p.candidateId, ts: a.bar.ts, symbol: p.symbol,
      type: enums.OrderType.MARKET, direction: p.direction, lots: p.lots,
      requestedPrice: a.bar.open, status: enums.OrderStatus.FILLED, filledPrice: fill.price
    });
    store.table('positions').insert({
      positionId: openPosition.positionId, orderId: p.orderId, symbol: p.symbol,
      direction: p.direction, lots: p.lots, entryTs: a.bar.ts, entryPrice: fill.price,
      stopLoss: p.stopLoss, takeProfit: p.takeProfit, status: enums.PositionStatus.OPEN,
      candidateId: p.candidateId, recoveryLevel: p.recoveryLevel, regime: p.regime
    });

    slot.occupy(openPosition, a.bar.ts);
    counts.entriesFilled++;
    pendingEntry = null;
    logger.debug('position.opened', {
      symbol: p.symbol, direction: p.direction, lots: p.lots,
      entry: fill.price, stop: p.stopLoss, target: p.takeProfit, recoveryLevel: p.recoveryLevel
    });
    return true;
  }

  /** Checks stop, target and the time stop for the open position. */
  function evaluateOpenPosition(a, openedOnThisBar) {
    var exit = adapter.evaluateExit(openPosition, a.bar, openedOnThisBar);
    if (exit && exit.kind === 'AMBIGUOUS') {
      // The SKIP policy: the bar is unusable, so no exit is claimed on it. The
      // position stays open and the count makes the frequency visible.
      counts.ambiguousBars++;
      store.table('system_events').insert({
        ts: a.bar.ts, kind: 'INTRABAR_AMBIGUOUS', severity: 'WARN',
        message: 'bar contained both stop and target; policy SKIP left the position open',
        symbol: a.w.symbol, positionId: openPosition.positionId
      });
      return;
    }
    if (exit) {
      if (exit.gapped) counts.gappedExits++;
      closePosition({
        bar: a.bar,
        index: a.index,
        price: exit.price,
        reason: exit.kind === adapterMod.FillKind.STOP ? enums.ExitReason.STOP_LOSS : enums.ExitReason.TAKE_PROFIT,
        gapped: exit.gapped,
        ambiguous: exit.ambiguous
      });
      return;
    }
    var barsHeld = a.index - openPosition.entryIndex;
    if (barsHeld >= config.backtest.maxBarsInTrade) {
      closePosition({
        bar: a.bar, index: a.index, price: a.bar.close,
        reason: enums.ExitReason.TIME_STOP, gapped: false
      });
    }
  }

  /** Closes the open position and writes the trade record. */
  function closePosition(spec2) {
    var pos = openPosition;
    var inst = world[pos.symbol].instrument;
    var exitPrice = money.round(spec2.price, inst.digits);
    var gross = instrumentMod.grossPnl(inst, pos.direction, pos.entryPrice, exitPrice, pos.lots);

    var isStop = spec2.reason === enums.ExitReason.STOP_LOSS;
    var exitSlipPips = costModel.slippagePips(inst, isStop ? 'STOP' : (spec2.reason === enums.ExitReason.TAKE_PROFIT ? 'TARGET' : 'ENTRY'));
    var nights = costModel.nightsHeld(pos.entryTs, spec2.bar.ts);
    var costs = costModel.roundTrip({
      instrument: inst, direction: pos.direction, lots: pos.lots, price: exitPrice,
      spreadPips: pos.spreadPips, entrySlippagePips: pos.entrySlippagePips,
      exitSlippagePips: exitSlipPips, nights: nights
    });
    var net = money.money(gross - costs.totalMoney);
    var outcome = net > 0 ? enums.TradeOutcome.WIN : (net < 0 ? enums.TradeOutcome.LOSS : enums.TradeOutcome.BREAKEVEN);

    account.applyTrade({
      ts: spec2.bar.ts, netPnl: net, grossPnl: gross,
      costsMoney: costs.totalMoney, outcome: outcome
    });

    var trade = {
      tradeId: seq.next('trade'),
      positionId: pos.positionId,
      candidateId: pos.candidateId,
      symbol: pos.symbol,
      strategyId: pos.strategyId,
      direction: pos.direction,
      entryTs: pos.entryTs,
      exitTs: spec2.bar.ts,
      entryPrice: pos.entryPrice,
      exitPrice: exitPrice,
      lots: pos.lots,
      grossPnl: gross,
      costsMoney: costs.totalMoney,
      netPnl: net,
      outcome: outcome,
      exitReason: spec2.reason,
      regime: pos.regime,
      jevScore: pos.jevScore,
      recoveryLevel: pos.recoveryLevel,
      barsHeld: spec2.index - pos.entryIndex,
      equityAfter: account.balance(),
      riskMoney: pos.riskMoney,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      spreadPips: pos.spreadPips,
      spreadMoney: costs.spreadMoney,
      commissionMoney: costs.commissionMoney,
      slippagePips: costs.slippagePips,
      slippageMoney: costs.slippageMoney,
      swapMoney: costs.swapMoney,
      nightsHeld: nights,
      gapped: !!spec2.gapped,
      intrabarAmbiguous: !!spec2.ambiguous
    };
    trades.push(trade);
    store.table('trades').insert(trade);
    store.table('cost_assessments').insert({
      candidateId: pos.candidateId, ts: spec2.bar.ts, symbol: pos.symbol,
      spreadMoney: costs.spreadMoney, commissionMoney: costs.commissionMoney,
      slippageMoney: costs.slippageMoney, swapMoney: costs.swapMoney,
      totalCostMoney: costs.totalMoney, passed: true, phase: 'REALISED'
    });
    store.table('positions').insert({
      positionId: pos.positionId, orderId: pos.orderId, symbol: pos.symbol,
      direction: pos.direction, lots: pos.lots, entryTs: pos.entryTs, entryPrice: pos.entryPrice,
      stopLoss: pos.stopLoss, takeProfit: pos.takeProfit, status: enums.PositionStatus.CLOSED,
      exitTs: spec2.bar.ts, exitPrice: exitPrice, candidateId: pos.candidateId
    });

    openPosition = null;
    slot.release(spec2.reason, spec2.bar.ts);
    logger.debug('position.closed', {
      symbol: trade.symbol, reason: trade.exitReason, netPnl: net,
      gross: gross, costs: costs.totalMoney, outcome: outcome, gapped: trade.gapped
    });
    if (spec.onTradeClosed) spec.onTradeClosed(trade, { account: account, store: store });
  }

  /** Mark-to-market equity, net of the costs already committed. */
  function markToMarket(atTs) {
    var openPnl = 0;
    var openRisk = 0;
    if (openPosition) {
      var w = world[openPosition.symbol];
      var inst = w.instrument;
      var px = w.lastClose === null ? openPosition.entryPrice : w.lastClose;
      openPnl = money.money(
        instrumentMod.grossPnl(inst, openPosition.direction, openPosition.entryPrice, px, openPosition.lots) -
        openPosition.committedCosts
      );
      openRisk = openPosition.riskMoney || 0;
    }
    account.markToMarket(atTs, openPnl, openRisk);
  }

  /** Cancels an unfilled entry and hands the slot back. Returns its candidate id. */
  function cancelPendingEntry(reason, ts) {
    if (!pendingEntry) return null;
    var id = pendingEntry.candidateId;
    store.table('orders').insert({
      orderId: pendingEntry.orderId, candidateId: id,
      ts: ts, symbol: pendingEntry.symbol, type: enums.OrderType.MARKET,
      direction: pendingEntry.direction, lots: pendingEntry.lots,
      requestedPrice: pendingEntry.stopLoss, status: enums.OrderStatus.CANCELLED,
      rejectReason: reason
    });
    slot.release(reason, ts);
    counts.pendingCancelled++;
    pendingEntry = null;
    return id;
  }

  /** Current ATR ratio for the cost model's volatility widening, when available. */
  function volatilityRatioAt(w, index) {
    if (!w.series.hasIndicator('volRatio')) return undefined;
    var v = w.series.indicatorValues('volRatio')[index];
    return v === null ? undefined : v;
  }

  /** Timestamp of the bar `n` bars after `index` for this symbol, or null. */
  function nextExecutableTs(w, index, n) {
    var target = index + n;
    return target < w.bars.length ? w.bars[target].ts : null;
  }

  /**
   * Marks the run emergency-stopped, and CANCELS any entry that has not filled.
   *
   * Cancelling the pending entry is the point of a kill switch: the decision was
   * made a bar ago, nothing has been transacted, and letting it through because
   * it was "already in flight" would mean the emergency stop opens one more
   * position than it prevents. An open position is left alone — closing it is a
   * separate decision with its own cost, and the Risk Engine makes it
   * explicitly rather than as a side effect of the flag being set.
   */
  function stopEverything(reason) {
    if (emergencyStopped) return;
    emergencyStopped = true;
    emergencyReason = reason;
    var cancelled = pendingEntry ? cancelPendingEntry('EMERGENCY_STOP', lastTs) : null;
    store.table('system_events').insert({
      ts: lastTs, kind: 'EMERGENCY_STOP', severity: 'ERROR', message: reason,
      cancelledPendingEntry: cancelled
    });
    logger.error('engine.emergency_stop', { reason: reason, cancelledPendingEntry: cancelled });
  }
}

function requireOrderFields(order, symbol) {
  ['candidateId', 'direction', 'lots', 'stopLoss', 'takeProfit'].forEach(function (f) {
    if (order[f] === undefined || order[f] === null) {
      throw errors.CandidateError(
        'decide() returned an ENTER for ' + symbol + ' without "' + f + '"; execution cannot infer it',
        { missing: f, order: order }
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

function buildTsIndex(bars) {
  var map = Object.create(null);
  for (var i = 0; i < bars.length; i++) map[bars[i].ts] = i;
  return map;
}

/** Sorted unique timestamps across every symbol. */
function buildTimeline(world, symbols) {
  var seen = Object.create(null);
  symbols.forEach(function (sym) {
    world[sym].bars.forEach(function (b) { seen[b.ts] = true; });
  });
  return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
}

function plainCounts(counts) {
  var out = {};
  Object.keys(counts).forEach(function (k) {
    var v = counts[k];
    if (v && typeof v === 'object') {
      var inner = {};
      Object.keys(v).sort().forEach(function (kk) { inner[kk] = v[kk]; });
      out[k] = inner;
    } else {
      out[k] = v;
    }
  });
  return out;
}

module.exports = {
  run: run
};
