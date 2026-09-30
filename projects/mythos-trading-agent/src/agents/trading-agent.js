'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Agent 1, the Trading Agent
// projects/mythos-trading-agent/src/agents/trading-agent.js
//
// Mission §3's pipeline, wired end to end:
//
//   MARKET DATA → REGIME ENGINE → STRATEGY PORTFOLIO → CANDIDATES
//     → JEV GATE → COST FILTER → RISK ENGINE → RECOVERY ENGINE
//     → ONE TRADE ONLY → EXECUTION → RESULT → DATABASE
//
// This module is the `decide(ctx)` the backtest engine calls. It owns the ORDER of
// the stages and the recording of every verdict; it owns none of the judgements,
// which live in the components it composes. That separation is why each component
// could be tested adversarially on its own before any of this existed.
//
// FIVE THINGS THIS FILE IS CAREFUL ABOUT
//
//  1. EVERY CANDIDATE IS RECORDED, INCLUDING THE REJECTED ONES. The pipeline
//     evaluates all signals on the bar and persists each one with the stage that
//     stopped it. Mission §17's questions are queries over those rows, and the
//     rejected candidates are where the counterfactual lives — a store containing
//     only the trades that happened cannot answer "would a higher Jev threshold
//     have helped?".
//
//  2. THE STAGES RUN IN THE MISSION'S ORDER, AND CHEAP BEFORE EXPENSIVE. Schedule
//     and regime are per bar; candidate construction, Jev, cost, risk and recovery
//     are per signal. A rejection at an early stage costs nothing later.
//
//  3. ONE SIGNAL FAILING DOES NOT END THE BAR. If the highest-priority candidate
//     is rejected, the next is considered. Only the first candidate that survives
//     every stage becomes an order, because only one trade may be open.
//
//  4. THE RISK ENGINE'S SIZE IS THE ONLY SIZE THAT LEAVES THIS FILE. The recovery
//     ladder's request goes in; `approvedLots` comes out; nothing else is passed
//     to the executor. A CLAMP is recorded as a clamp so the recovery research is
//     about what actually ran.
//
//  5. THE PER-BAR RISK MONITOR RUNS FROM onBar, NOT FROM decide. decide() is only
//     reached when the trade slot is free, so a drawdown kill switch living there
//     could not fire while a position was open — precisely when it is needed.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var instrumentMod = require('../core/instrument');

var portfolioMod = require('../strategy/portfolio');
var registryMod = require('../strategy/registry');
var candidateMod = require('../strategy/candidate');
var regimeMod = require('../regime/engine');
var jevMod = require('../jev/gate');
var riskMod = require('../risk/engine');
var recoveryMod = require('../recovery/engine');
var scheduleMod = require('../schedule/asset-schedule');

/**
 * @param {object} spec
 * @param {object} spec.config validated platform config
 * @param {object} [spec.registry] strategy registry; defaults to the standard one
 * @param {string[]} [spec.enabledStrategies]
 * @param {object} [spec.strategyParams]
 * @param {object} [spec.regimeParams]
 * @param {object} [spec.priors] Jev priors provider
 * @param {object} [spec.store]
 * @param {object} [spec.logger]
 */
function create(spec) {
  var config = spec.config;
  var logger = spec.logger || require('../core/logger').nullLogger();
  var store = spec.store || null;

  var registry = spec.registry || registryMod.standard();
  var portfolio = portfolioMod.create({
    registry: registry,
    enabled: spec.enabledStrategies,
    params: spec.strategyParams,
    signalCooldownBars: config.strategy.signalCooldownBars
  });
  var regime = regimeMod.create(spec.regimeParams);
  var jev = jevMod.create({ config: config, priors: spec.priors, logger: logger });
  var risk = riskMod.create({ config: config, logger: logger, store: store });
  var recovery = recoveryMod.create({ config: config, logger: logger, store: store });
  var schedule = scheduleMod.create({ config: config });

  var regimeStates = Object.create(null);   // symbol → hysteresis state
  /**
   * The most recent classification per symbol, produced on EVERY bar by onBar.
   *
   * The regime is deliberately NOT classified inside decide(): decide is only
   * reached while the trade slot is free, so driving the regime from there
   * classified a subset of bars that depended on trading activity. Its hysteresis
   * dwell then counted wrongly, and the label became a function of whether a
   * position happened to be open — a coupling between position state and market
   * reading that would quietly corrupt every per-regime statistic.
   */
  var lastRegime = Object.create(null);
  var counts = {};
  var idSeq = 0;

  function resetCounts() {
    counts = {
      // Bars the regime engine classified — every bar of every symbol past warmup.
      barsClassified: 0,
      // Bars on which a decision was actually requested, which is only when the
      // single trade slot is free. Much smaller than barsClassified, and the two
      // are named differently because conflating them overstates how much of the
      // market the agent got to act on.
      decisionsRequested: 0,
      scheduleBlocked: 0,
      regimeUnavailable: 0,
      signalsSeen: 0,
      candidatesBuilt: 0,
      rejectedByCost: 0,
      rejectedByJev: 0,
      blockedByRisk: 0,
      clampedByRisk: 0,
      rejectedByRecoveryTp: 0,
      ordersProposed: 0,
      emergencyStops: 0
    };
  }
  resetCounts();

  function regimeStateFor(symbol) {
    if (!regimeStates[symbol]) regimeStates[symbol] = regime.newState();
    return regimeStates[symbol];
  }

  /** The warmup the whole pipeline needs: the largest of its parts. */
  function warmupBars() {
    return Math.max(portfolio.warmupBars(), regime.warmupBars());
  }

  /**
   * Binds the agent to the run's store, records its composition, and clears any
   * state left from a previous run.
   *
   * THIS HOOK EXISTS BECAUSE ITS ABSENCE WAS SILENT. Before it, the agent kept a
   * store passed at construction while the engine created its own; a run then
   * produced trades normally and wrote every candidate, Jev verdict and risk
   * assessment into a store nobody read. The audit trail was completely absent and
   * nothing failed. Binding at run start makes that unreachable.
   */
  function onRunStart(runCtx) {
    store = runCtx.store;
    risk.attachStore(store);
    recovery.attachStore(store);
    portfolio.resetState();
    regimeStates = Object.create(null);
    lastRegime = Object.create(null);
    resetCounts();
    if (store) persistComposition(store);
    return { boundTo: runCtx.runId, warmupBars: warmupBars() };
  }

  /**
   * Registers every indicator the portfolio and the regime engine need.
   * Wired into engine.run({ onSeriesReady }).
   */
  function onSeriesReady(ready) {
    var regimeDeclared = regime.indicators();
    Object.keys(regimeDeclared).forEach(function (k) {
      if (!ready.series.hasIndicator(k)) ready.series.addIndicator(k, regimeDeclared[k]);
    });
    var res = portfolio.prepareSeries(ready);
    if (store) {
      store.table('health_checks').insert({
        ts: null, check: 'INDICATORS_REGISTERED', status: 'OK',
        detail: {
          symbol: ready.symbol,
          regimeIndicators: Object.keys(regimeDeclared).length,
          strategyIndicators: res.base,
          higherTimeframeIndicators: res.higher,
          warmupBars: warmupBars()
        }
      });
    }
    return res;
  }

  /** The decision function the engine calls. Returns an order or a NO_TRADE. */
  function decide(ctx) {
    counts.decisionsRequested++;
    var inst = ctx.instrument;

    // ---- stage 1: schedule ------------------------------------------
    var sched = schedule.check(inst, ctx.ts);
    if (!sched.open) {
      counts.scheduleBlocked++;
      return noTrade(enums.PipelineStage.SCHEDULE, [sched.reason], null);
    }

    // ---- stage 2: regime -------------------------------------------
    // Read, not computed: onBar classified this bar for every symbol before any
    // decision was requested. See the note on `lastRegime`.
    var classification = lastRegime[ctx.symbol];
    if (!classification || classification.ts !== ctx.ts) {
      counts.regimeUnavailable++;
      return noTrade(enums.PipelineStage.REGIME, ['REGIME_WARMUP'], null, { record: false });
    }

    // ---- stage 3: strategies ---------------------------------------
    var signals = portfolio.evaluate({
      symbol: ctx.symbol, instrument: inst, view: ctx.view, higherView: ctx.higherView,
      higherTimeframe: ctx.higherTimeframe, barIndex: ctx.barIndex, ts: ctx.ts,
      regime: classification.regime, config: config
    });
    counts.signalsSeen += signals.length;
    if (signals.length === 0) {
      return noTrade(enums.PipelineStage.STRATEGY, ['NO_SIGNAL'], null, { record: false });
    }
    var ordered = portfolio.prioritise(signals);

    var spreadPips = ctx.spreadPips();
    var atr = regime.features(ctx.view);
    atr = atr ? atr.atr : null;
    var lastStage = enums.PipelineStage.STRATEGY;
    var lastReasons = ['NO_SIGNAL_SURVIVED'];
    var lastCandidateId = null;

    for (var i = 0; i < ordered.length; i++) {
      var attempt = evaluateSignal(ctx, ordered[i], classification, spreadPips, atr, sched);
      if (attempt.order) return attempt.order;
      lastStage = attempt.stage;
      lastReasons = attempt.reasonCodes;
      lastCandidateId = attempt.candidateId;
    }
    return noTrade(lastStage, lastReasons, lastCandidateId);
  }

  /** One signal through candidate → cost → Jev → recovery → risk. */
  function evaluateSignal(ctx, entry, classification, spreadPips, atr, sched) {
    var inst = ctx.instrument;
    var sig = entry.signal;
    idSeq++;
    var candidateId = ctx.ids ? ctx.ids.next('cand') : 'cand-' + idSeq;

    // ---- stage 4: candidate ---------------------------------------
    var prior = jevPrior(entry, classification, ctx);
    var candidate = candidateMod.build({
      candidateId: candidateId,
      ts: ctx.ts,
      instrument: inst,
      timeframe: ctx.view.timeframe,
      signal: sig,
      strategyFingerprint: entry.fingerprint,
      regime: classification.regime,
      regimeConfidence: classification.confidence,
      spreadPips: spreadPips,
      costModel: ctx.costModel,
      winProbability: prior.winProbability,
      winProbabilitySource: prior.source
    });
    counts.candidatesBuilt++;
    if (store && config.observability.auditEveryCandidate) {
      store.table('candidates').insert(candidate);
    }

    // ---- stage 5: cost filter -------------------------------------
    // Runs BEFORE Jev: it is cheaper, and a candidate whose target sits inside
    // its own round-trip cost is not a judgement call.
    var costReasons = candidateMod.costReasons(candidate, config);
    if (store) {
      store.table('cost_assessments').insert({
        candidateId: candidateId, ts: ctx.ts, symbol: ctx.symbol,
        spreadMoney: money.money(candidate.spreadPips * candidate.costBasisLots * instrumentMod.pipValuePerLot(inst, candidate.entry)),
        commissionMoney: money.money(inst.commissionPerLotPerSide * candidate.costBasisLots * 2),
        slippageMoney: money.money(candidate.estimatedSlippagePips * candidate.costBasisLots * instrumentMod.pipValuePerLot(inst, candidate.entry)),
        swapMoney: money.money(candidate.estimatedSwapPips * candidate.costBasisLots * instrumentMod.pipValuePerLot(inst, candidate.entry)),
        totalCostMoney: candidate.estimatedCostMoney,
        costPips: candidate.costPips,
        netRewardPips: candidate.netRewardPips,
        passed: costReasons.length === 0,
        reasonCodes: costReasons,
        phase: 'PRE_TRADE'
      });
    }
    if (costReasons.length) {
      counts.rejectedByCost++;
      recordDecision(ctx, candidateId, enums.PipelineStage.COST, costReasons);
      return { stage: enums.PipelineStage.COST, reasonCodes: costReasons, candidateId: candidateId };
    }

    // ---- stage 6: Jev ---------------------------------------------
    var recState = recovery.state(ctx.symbol);
    var verdict = jev.evaluate({
      candidate: candidate,
      instrument: inst,
      regimeAligned: entry.regimeAligned,
      atr: atr,
      recoveryLevel: recState.level,
      sessionQuality: sched.sessionQuality
    });
    if (store) store.table('jev_decisions').insert(verdict);
    if (verdict.decision === enums.JevDecision.REJECT) {
      counts.rejectedByJev++;
      recordDecision(ctx, candidateId, enums.PipelineStage.JEV, verdict.reasonCodes);
      return { stage: enums.PipelineStage.JEV, reasonCodes: verdict.reasonCodes, candidateId: candidateId };
    }

    // ---- stage 7: recovery REQUESTS a size ------------------------
    var request = recovery.request(ctx.symbol);

    // ---- stage 8: the Risk Engine decides the size ----------------
    var assessment = risk.assess({
      candidate: candidate,
      instrument: inst,
      account: ctx.account,
      requestedLots: request.requestedLots,
      ts: ctx.ts,
      recoveryLevel: request.level
    });
    if (store) risk.persist(store, candidateId, ctx.ts, assessment);

    if (assessment.verdict === enums.RiskVerdict.BLOCK) {
      counts.blockedByRisk++;
      recovery.onRiskBlocked(ctx.symbol, ctx.ts, assessment.reasonCodes);
      recordDecision(ctx, candidateId, enums.PipelineStage.RISK, assessment.reasonCodes);
      return { stage: enums.PipelineStage.RISK, reasonCodes: assessment.reasonCodes, candidateId: candidateId };
    }
    if (assessment.verdict === enums.RiskVerdict.CLAMP) {
      counts.clampedByRisk++;
      recovery.noteClamped();
    }

    // ---- stage 9: can the target still recover the ladder? --------
    // Checked at the APPROVED size, not the requested one — which is what makes
    // the clamp bite rather than being cosmetic.
    var coverage = recovery.targetCoversRecovery({
      instrument: inst,
      lots: assessment.approvedLots,
      price: candidate.entry,
      costMoney: money.money(candidate.costPips * assessment.approvedLots * instrumentMod.pipValuePerLot(inst, candidate.entry)),
      offeredPips: candidate.rewardPips
    });
    if (coverage.required && !coverage.ok) {
      counts.rejectedByRecoveryTp++;
      var reasons = ['RECOVERY_TP_UNREACHABLE'];
      recordDecision(ctx, candidateId, enums.PipelineStage.RECOVERY, reasons);
      if (store) {
        store.table('recovery_states').insert({
          ts: ctx.ts, symbol: ctx.symbol, level: recState.level,
          cumulativeLossMoney: recState.cumulativeLossMoney,
          nextLotsUncapped: request.uncappedLots,
          nextLotsRequested: request.requestedLots,
          reason: recoveryMod.RecoveryReason.TP_UNREACHABLE,
          requiredPips: coverage.requiredPips,
          offeredPips: coverage.offeredPips,
          approvedLots: assessment.approvedLots
        });
      }
      return { stage: enums.PipelineStage.RECOVERY, reasonCodes: reasons, candidateId: candidateId };
    }

    // ---- ENTER ----------------------------------------------------
    counts.ordersProposed++;
    logger.debug('agent.order', {
      symbol: ctx.symbol, strategyId: candidate.strategyId, direction: candidate.direction,
      approvedLots: assessment.approvedLots, requestedLots: request.requestedLots,
      verdict: assessment.verdict, jevScore: verdict.score, regime: classification.regime
    });
    return {
      order: {
        decision: enums.PipelineDecision.ENTER,
        candidateId: candidateId,
        strategyId: candidate.strategyId,
        direction: candidate.direction,
        // The ONLY size that leaves this file is the one the Risk Engine approved.
        lots: assessment.approvedLots,
        stopLoss: candidate.stopLoss,
        takeProfit: candidate.takeProfit,
        riskMoney: assessment.approvedRiskMoney,
        regime: classification.regime,
        jevScore: verdict.score,
        recoveryLevel: request.level,
        reasonCodes: verdict.reasonCodes.concat(assessment.reasonCodes),
        meta: {
          jevBand: verdict.band,
          jevConfidence: verdict.confidence,
          riskVerdict: assessment.verdict,
          requestedLots: request.requestedLots,
          uncappedLadderLots: request.uncappedLots,
          regimeConfidence: classification.confidence,
          netRewardRisk: candidate.netRewardRisk,
          breakevenWinRate: candidate.breakevenWinRate,
          sessionQuality: sched.sessionQuality
        }
      }
    };
  }

  /**
   * The win probability the candidate should carry, and where it came from.
   * Never a flattering default: with no history the prior is 0.5 and the source
   * says so, which is what stops a prior being read as evidence.
   */
  function jevPrior(entry, classification, ctx) {
    if (!spec.priors) return { winProbability: 0.5, source: 'PRIOR_UNINFORMED' };
    var p = spec.priors.lookup({
      strategyId: entry.strategy.strategyId, symbol: ctx.symbol,
      regime: classification.regime, direction: entry.signal.direction
    });
    if (!p || p.sampleSize === 0 || p.winRate === null) {
      return { winProbability: 0.5, source: 'PRIOR_UNINFORMED' };
    }
    return { winProbability: money.clamp(p.winRate, 0, 1), source: 'HISTORICAL' };
  }

  function recordDecision(ctx, candidateId, stage, reasonCodes) {
    if (!store) return;
    store.table('decisions').insert({
      ts: ctx.ts, symbol: ctx.symbol, decision: enums.PipelineDecision.NO_TRADE,
      stage: stage, candidateId: candidateId, reasonCodes: reasonCodes
    });
  }

  function noTrade(stage, reasonCodes, candidateId, opts) {
    var out = {
      decision: enums.PipelineDecision.NO_TRADE,
      stage: stage,
      reasonCodes: reasonCodes,
      candidateId: candidateId
    };
    if (opts && opts.record === false) out.record = false;
    return out;
  }

  /**
   * Per-bar risk monitoring. Wired into engine.run({ onBar }) — which runs on
   * every bar, including while a position is open.
   */
  function onBar(barCtx) {
    // 1. Classify the regime for every symbol that printed a bar, before any
    //    decision is requested and regardless of whether one will be.
    (barCtx.views || []).forEach(function (v) {
      var classification = regime.classify(v.view, regimeStateFor(v.w.symbol));
      if (!classification) return;
      classification.ts = barCtx.ts;
      lastRegime[v.w.symbol] = classification;
      counts.barsClassified++;
      if (store) {
        store.table('regimes').insert({
          ts: barCtx.ts, symbol: v.w.symbol, timeframe: v.view.timeframe,
          regime: classification.regime, direction: classification.direction,
          confidence: classification.confidence, features: classification.features,
          scores: classification.scores, held: classification.held
        });
      }
    });

    // 2. The Risk Engine's per-bar monitor. Runs before decisions, so a drawdown
    //    breach blocks the same bar rather than the next one.
    var m = risk.monitor({ account: barCtx.account, ts: barCtx.ts });
    if (m.emergencyStop && !barCtx.emergencyStopped) {
      counts.emergencyStops++;
      barCtx.emergencyStop('RISK_ENGINE: ' + m.reason);
    }
    return m;
  }

  /** Recovery learns from every closed trade. */
  function onTradeClosed(trade) {
    return recovery.onTradeClosed(trade);
  }

  /** Records the agent's own composition. Called once before a run. */
  function persistComposition(storeRef) {
    portfolio.persist(storeRef);
    config.universe.forEach(function (sym) {
      storeRef.table('agent_activity').insert({
        ts: null, agent: 'TRADING_AGENT', action: 'SCHEDULE_REGISTERED', outcome: 'OK',
        detail: schedule.describe(config.instrument(sym))
      });
    });
    storeRef.table('agent_activity').insert({
      ts: null, agent: 'TRADING_AGENT', action: 'COMPOSITION', outcome: 'OK',
      detail: {
        strategies: portfolio.enabled(),
        warmupBars: warmupBars(),
        jev: { model: jev.model, threshold: jev.threshold, minConfidence: jev.minConfidence },
        risk: risk.limits(),
        recovery: recovery.config()
      }
    });
  }

  return {
    decide: decide,
    onRunStart: onRunStart,
    onSeriesReady: onSeriesReady,
    onBar: onBar,
    onTradeClosed: onTradeClosed,
    warmupBars: warmupBars,
    persistComposition: persistComposition,
    store: function () { return store; },
    reset: function () {
      portfolio.resetState();
      regimeStates = Object.create(null);
      lastRegime = Object.create(null);
      resetCounts();
    },
    counts: function () {
      var out = {};
      Object.keys(counts).forEach(function (k) { out[k] = counts[k]; });
      return out;
    },
    stats: function () {
      return {
        pipeline: this.counts(),
        recovery: recovery.stats(),
        cooldown: portfolio.cooldownStats(),
        emergencyStopped: risk.isEmergencyStopped(),
        emergencyReason: risk.emergencyReason()
      };
    },
    // Exposed for tests and for the Analysis/Research agents.
    components: {
      portfolio: portfolio, regime: regime, jev: jev,
      risk: risk, recovery: recovery, schedule: schedule, registry: registry
    }
  };
}

/**
 * Convenience: build an agent and every engine hook it needs in one call.
 *
 * Each omitted hook degrades the system SILENTLY, which is why this exists:
 *   onRunStart     — no audit trail at all (the agent writes to a store nobody reads)
 *   onSeriesReady  — no indicators, so every strategy is permanently in warmup
 *   onBar          — no kill switch while a position is open
 *   onTradeClosed  — recovery never learns that anything happened
 * None of those produces an error. All four produce a run that looks fine.
 */
function wire(spec) {
  var agent = create(spec);
  return {
    agent: agent,
    engineHooks: {
      decide: agent.decide,
      onRunStart: agent.onRunStart,
      onSeriesReady: agent.onSeriesReady,
      onBar: agent.onBar,
      onTradeClosed: agent.onTradeClosed
    }
  };
}

module.exports = {
  create: create,
  wire: wire
};
