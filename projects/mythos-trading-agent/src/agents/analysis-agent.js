'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Agent 2, the Analysis Agent
// projects/mythos-trading-agent/src/agents/analysis-agent.js
//
// Mission §12: "It must NOT directly modify production trading rules."
//
// SO THIS MODULE IS READ-ONLY BY CONSTRUCTION. It takes a store and returns a
// report. It holds no reference to a config it could mutate, no reference to the
// Risk Engine or the Jev gate, and exposes no setter of any kind — a test asserts
// that. The Research Agent (Phase 11) is the thing allowed to PROPOSE changes, and
// even it may only propose.
//
// THE DISCIPLINE THAT MAKES THIS USEFUL RATHER THAN DECORATIVE
//
//  1. EVERY FIGURE CARRIES ITS SAMPLE SIZE, and any group below `minSample` is
//     marked `sufficient: false`. A Jev band with four trades has a win rate; it
//     does not have evidence. Presenting the two identically is how a backtest
//     becomes a story.
//
//  2. DRAWDOWN IS NOT REPORTED PER SUBSET. Drawdown is path-dependent: the
//     "drawdown of the 90-94 Jev band" is not a quantity — those trades were
//     interleaved with others, and extracting them invents an equity curve that
//     never existed. Per-group reports therefore give expectancy, win rate, profit
//     factor and STREAKS (which are order-preserving within the subset and so
//     legitimate), and drawdown is reported once for the run.
//
//  3. THE REJECTION FUNNEL IS PART OF THE ANALYSIS, NOT AN APPENDIX. On a $100
//     account most candidates never become trades, so an analysis of the trades
//     alone describes a small biased tail of what the system actually decided.
//
//  4. NOTHING HERE CONCLUDES. `interpretJevBands()` reports the monotonicity of
//     expectancy across bands and says whether the sample supports a conclusion;
//     it does not recommend a threshold. That is the Research Agent's proposal to
//     make and the owner's to approve.
// =====================================================

var enums = require('../core/enums');
var money = require('../core/money');
var metricsMod = require('../backtest/metrics');

var DEFAULT_MIN_SAMPLE = 20;

/**
 * @param {object} [spec]
 * @param {number} [spec.minSample=20] below this a group is marked insufficient
 */
function create(spec) {
  var o = spec || {};
  var minSample = o.minSample === undefined ? DEFAULT_MIN_SAMPLE : o.minSample;

  /** Rows from a store table, or [] when the table is empty. */
  function rows(store, table) {
    return store.table(table).all();
  }

  /**
   * Groups trades by a key function and computes per-group metrics.
   * Every group carries its sample size and whether it is big enough to mean
   * anything.
   */
  function groupTrades(trades, keyFn, initialCapital) {
    var groups = Object.create(null);
    trades.forEach(function (t) {
      var k = keyFn(t);
      if (k === null || k === undefined) return;
      var key = String(k);
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    });
    var out = {};
    Object.keys(groups).sort().forEach(function (k) {
      var subset = groups[k];
      var m = metricsMod.compute({ trades: subset, initialCapital: initialCapital });
      out[k] = {
        sampleSize: subset.length,
        sufficient: subset.length >= minSample,
        winRate: m.winRate,
        expectancy: m.expectancy,
        expectancyR: m.expectancyR,
        profitFactor: m.profitFactor,
        netPnl: m.netPnl,
        grossPnl: m.grossPnl,
        totalCosts: m.totalCosts,
        avgWin: m.avgWin,
        avgLoss: m.avgLoss,
        payoffRatio: m.payoffRatio,
        maxConsecutiveLosses: m.maxConsecutiveLosses,
        avgLosingStreak: m.avgLosingStreak,
        avgBarsHeld: m.avgBarsHeld,
        exitReasons: m.exitReasons,
        // Deliberately absent: drawdown. See §2 in the file header.
        drawdownNote: 'drawdown is path-dependent and is reported once for the run, not per group'
      };
    });
    return out;
  }

  /** Counts values, sorted by frequency descending. */
  function frequency(list) {
    var counts = Object.create(null);
    list.forEach(function (v) {
      if (v === null || v === undefined) return;
      var k = String(v);
      counts[k] = (counts[k] || 0) + 1;
    });
    return Object.keys(counts)
      .sort(function (a, b) { return counts[b] - counts[a] || (a < b ? -1 : 1); })
      .map(function (k) { return { value: k, count: counts[k] }; });
  }

  /** The decision funnel: what happened to everything the system considered. */
  function analyseFunnel(store) {
    var decisions = rows(store, 'decisions');
    var byStage = Object.create(null);
    var reasonsByStage = Object.create(null);
    var entered = 0;
    decisions.forEach(function (d) {
      if (d.decision === enums.PipelineDecision.ENTER) { entered++; return; }
      byStage[d.stage] = (byStage[d.stage] || 0) + 1;
      if (!reasonsByStage[d.stage]) reasonsByStage[d.stage] = [];
      reasonsByStage[d.stage] = reasonsByStage[d.stage].concat(d.reasonCodes || []);
    });
    var stages = {};
    Object.keys(byStage).sort().forEach(function (s) {
      stages[s] = { rejected: byStage[s], topReasons: frequency(reasonsByStage[s]).slice(0, 6) };
    });

    var candidates = rows(store, 'candidates');
    return {
      candidatesBuilt: candidates.length,
      decisionsRecorded: decisions.length,
      entered: entered,
      rejectedByStage: stages,
      // The share of everything considered that became an order. On a small
      // account this is tiny, and that IS the finding.
      entryRate: candidates.length > 0 ? money.round(entered / candidates.length, 6) : null
    };
  }

  /** Jev behaviour: score distribution, band performance, flag frequency. */
  function analyseJev(store, trades, initialCapital) {
    var verdicts = rows(store, 'jev_decisions');
    if (verdicts.length === 0) return { verdicts: 0, note: 'no Jev decisions in this store' };

    var enteredCount = verdicts.filter(function (v) { return v.decision === 'ENTER'; }).length;
    var byBand = Object.create(null);
    verdicts.forEach(function (v) {
      var band = v.band === null ? 'BELOW_BANDS' : v.band;
      if (!byBand[band]) byBand[band] = { considered: 0, entered: 0 };
      byBand[band].considered++;
      if (v.decision === 'ENTER') byBand[band].entered++;
    });

    // Trades joined to the Jev band they were taken under. This is the mission §6
    // question, and it can only be asked of trades that actually happened.
    var scoreById = Object.create(null);
    verdicts.forEach(function (v) { scoreById[v.candidateId] = v; });
    var bandPerformance = groupTrades(trades, function (t) {
      var v = scoreById[t.candidateId];
      return v ? (v.band === null ? 'BELOW_BANDS' : v.band) : null;
    }, initialCapital);

    var flags = [];
    var reasons = [];
    verdicts.forEach(function (v) {
      flags = flags.concat(v.riskFlags || []);
      reasons = reasons.concat(v.reasonCodes || []);
    });

    // Mean contribution of each component, so a component that never varies —
    // and therefore never decides anything — is visible.
    var componentStats = Object.create(null);
    verdicts.forEach(function (v) {
      Object.keys(v.components || {}).forEach(function (k) {
        if (!componentStats[k]) componentStats[k] = { sum: 0, n: 0, min: Infinity, max: -Infinity, weight: v.components[k].weight };
        var c = componentStats[k];
        c.sum += v.components[k].value;
        c.n++;
        if (v.components[k].value < c.min) c.min = v.components[k].value;
        if (v.components[k].value > c.max) c.max = v.components[k].value;
      });
    });
    var components = {};
    Object.keys(componentStats).sort().forEach(function (k) {
      var c = componentStats[k];
      components[k] = {
        weight: c.weight,
        mean: money.round(c.sum / c.n, 4),
        min: money.round(c.min, 4),
        max: money.round(c.max, 4),
        spread: money.round(c.max - c.min, 4),
        // A component with no spread contributed a constant, and so decided
        // nothing at all — worth knowing before tuning its weight.
        discriminates: money.round(c.max - c.min, 4) > 0.05
      };
    });

    var scores = verdicts.map(function (v) { return v.score; }).sort(function (a, b) { return a - b; });
    return {
      verdicts: verdicts.length,
      entered: enteredCount,
      enterRate: money.round(enteredCount / verdicts.length, 6),
      scoreDistribution: {
        min: scores[0],
        p25: quantile(scores, 0.25),
        median: quantile(scores, 0.5),
        p75: quantile(scores, 0.75),
        max: scores[scores.length - 1],
        mean: money.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length, 4)
      },
      byBand: byBand,
      bandPerformance: bandPerformance,
      topRiskFlags: frequency(flags).slice(0, 10),
      topReasonCodes: frequency(reasons).slice(0, 10),
      components: components,
      interpretation: interpretJevBands(bandPerformance)
    };
  }

  /**
   * Mission §6 asks whether higher Jev scores actually improve outcomes. This
   * reports the SHAPE of the relationship and whether the sample can support a
   * conclusion. It deliberately stops short of recommending a threshold.
   */
  function interpretJevBands(bandPerformance) {
    var bands = Object.keys(bandPerformance)
      .filter(function (b) { return b !== 'BELOW_BANDS'; })
      .sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
    var usable = bands.filter(function (b) { return bandPerformance[b].sufficient; });

    if (usable.length < 2) {
      return {
        conclusion: 'INSUFFICIENT_SAMPLE',
        detail: 'fewer than two bands have at least ' + minSample + ' trades, so no relationship between ' +
          'Jev score and outcome can be claimed in either direction',
        bandsWithData: bands.length,
        bandsWithEnoughData: usable.length,
        minSample: minSample
      };
    }

    var expectancies = usable.map(function (b) { return bandPerformance[b].expectancy; });
    var winRates = usable.map(function (b) { return bandPerformance[b].winRate; });
    var streaks = usable.map(function (b) { return bandPerformance[b].maxConsecutiveLosses; });
    return {
      conclusion: monotonic(expectancies) === 1 ? 'EXPECTANCY_RISES_WITH_SCORE'
        : (monotonic(expectancies) === -1 ? 'EXPECTANCY_FALLS_WITH_SCORE' : 'NO_MONOTONIC_RELATIONSHIP'),
      bands: usable,
      expectancyByBand: expectancies,
      winRateByBand: winRates,
      maxLosingStreakByBand: streaks,
      expectancyMonotonic: monotonic(expectancies),
      winRateMonotonic: monotonic(winRates),
      detail: 'Direction only. Monotonicity across ' + usable.length + ' bands is not a significance test, ' +
        'and mission §6 asks for a statistical determination — the Research Agent must run the comparison ' +
        'out of sample before any threshold is changed.'
    };
  }

  /** 1 if non-decreasing, -1 if non-increasing, 0 otherwise. Nulls ignored. */
  function monotonic(list) {
    var vals = list.filter(function (v) { return typeof v === 'number'; });
    if (vals.length < 2) return 0;
    var up = true, down = true;
    for (var i = 1; i < vals.length; i++) {
      if (vals[i] < vals[i - 1]) up = false;
      if (vals[i] > vals[i - 1]) down = false;
    }
    if (up && !down) return 1;
    if (down && !up) return -1;
    return 0;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q;
    var lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return money.round(sorted[lo], 4);
    return money.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo), 4);
  }

  /** Where the money went: costs against gross, by component and per trade. */
  function analyseCosts(trades) {
    if (trades.length === 0) return { trades: 0, note: 'no trades' };
    var spread = money.sum(trades.map(function (t) { return t.spreadMoney || 0; }));
    var commission = money.sum(trades.map(function (t) { return t.commissionMoney || 0; }));
    var slippage = money.sum(trades.map(function (t) { return t.slippageMoney || 0; }));
    var swap = money.sum(trades.map(function (t) { return t.swapMoney || 0; }));
    var total = money.sum(trades.map(function (t) { return t.costsMoney; }));
    var gross = money.sum(trades.map(function (t) { return t.grossPnl; }));
    var absGross = money.sum(trades.map(function (t) { return Math.abs(t.grossPnl); }));

    return {
      trades: trades.length,
      grossPnl: gross,
      totalCosts: total,
      netPnl: money.money(gross - total),
      byComponent: {
        spreadMoney: spread,
        commissionMoney: commission,
        slippageMoney: slippage,
        swapMoney: swap
      },
      componentShare: total !== 0 ? {
        spread: money.round(spread / total, 4),
        commission: money.round(commission / total, 4),
        slippage: money.round(slippage / total, 4),
        swap: money.round(swap / total, 4)
      } : null,
      avgCostPerTrade: money.money(total / trades.length),
      /** Costs as a share of the absolute gross movement they were charged on. */
      costsOverAbsGross: absGross > 0 ? money.round(total / absGross, 4) : null,
      /**
       * The counterfactual: what the net result would have been with no costs at
       * all. Reported to show how much of the outcome the cost model decided —
       * NOT as an achievable alternative.
       */
      netIfCostless: gross,
      costsFlippedTheSign: (gross > 0 && money.money(gross - total) < 0)
    };
  }

  /** Streak behaviour — mission §10's primary objective. */
  function analyseLosingStreaks(trades, initialCapital) {
    var m = metricsMod.compute({ trades: trades, initialCapital: initialCapital });
    var streaks = metricsMod.losingStreaks(trades);
    // A plain object, not Object.create(null): the report is serialised, compared
    // and diffed, and a null-prototype object survives none of that cleanly.
    var histogram = {};
    streaks.forEach(function (s) { histogram[s] = (histogram[s] || 0) + 1; });

    // Which strategy was running when the worst streak happened. A streak can
    // span strategies, so this reports the composition rather than a culprit.
    var worst = { length: 0, startIndex: -1 };
    var run = 0;
    for (var i = 0; i < trades.length; i++) {
      if (trades[i].outcome === enums.TradeOutcome.LOSS) {
        run++;
        if (run > worst.length) { worst = { length: run, startIndex: i - run + 1 }; }
      } else { run = 0; }
    }
    var worstTrades = worst.length > 0 ? trades.slice(worst.startIndex, worst.startIndex + worst.length) : [];

    return {
      maxConsecutiveLosses: m.maxConsecutiveLosses,
      avgLosingStreak: m.avgLosingStreak,
      streakCount: streaks.length,
      histogram: histogram,
      probabilities: m.streakProbabilities,
      worstStreak: worst.length === 0 ? null : {
        length: worst.length,
        fromTs: worstTrades[0].entryTs,
        toTs: worstTrades[worstTrades.length - 1].exitTs,
        netPnl: money.sum(worstTrades.map(function (t) { return t.netPnl; })),
        strategies: frequency(worstTrades.map(function (t) { return t.strategyId; })),
        regimes: frequency(worstTrades.map(function (t) { return t.regime; })),
        symbols: frequency(worstTrades.map(function (t) { return t.symbol; })),
        recoveryLevels: frequency(worstTrades.map(function (t) { return t.recoveryLevel; }))
      },
      note: 'P(k consecutive losses) is an empirical window frequency over this run, ' +
        'NOT win-rate^k — trade outcomes are not independent in a regime-switching market.'
    };
  }

  /** Drawdown episodes from the mark-to-market curve. */
  function analyseDrawdown(store, trades, initialCapital) {
    var curve = rows(store, 'equity_curve').map(function (r) { return { ts: r.ts, equity: r.equity }; });
    if (curve.length === 0) {
      curve = metricsMod.curveFromTrades(trades, initialCapital);
    }
    var dd = metricsMod.drawdownFromCurve(curve);

    // Every episode deeper than 1 %, so a single worst number is not the whole
    // story of how often the account was underwater.
    var episodes = [];
    var peak = curve.length ? curve[0].equity : initialCapital;
    var peakTs = curve.length ? curve[0].ts : null;
    var current = null;
    curve.forEach(function (s) {
      if (s.equity >= peak) {
        if (current && current.depthPct >= 1) {
          current.recoveredAtTs = s.ts;
          episodes.push(current);
        }
        current = null;
        peak = s.equity; peakTs = s.ts;
        return;
      }
      var depthPct = peak === 0 ? 0 : ((peak - s.equity) / peak) * 100;
      if (!current) current = { fromTs: peakTs, peakEquity: peak, troughEquity: s.equity, troughTs: s.ts, depthPct: money.round(depthPct, 4), recoveredAtTs: null };
      else if (depthPct > current.depthPct) {
        current.depthPct = money.round(depthPct, 4);
        current.troughEquity = s.equity;
        current.troughTs = s.ts;
      }
    });
    if (current && current.depthPct >= 1) episodes.push(current);

    return {
      maxDrawdownPct: dd.maxDrawdownPct,
      maxDrawdownMoney: dd.maxDrawdownMoney,
      peakTs: dd.peakTs,
      troughTs: dd.troughTs,
      recoveredAtTs: dd.recoveredAtTs,
      neverRecovered: dd.recoveredAtTs === null && dd.maxDrawdownPct > 0,
      episodesOverOnePercent: episodes.length,
      episodes: episodes.slice(0, 20),
      curveSource: rows(store, 'equity_curve').length > 0 ? 'MARK_TO_MARKET' : 'TRADE_CLOSES_ONLY'
    };
  }

  /** Why the Risk Engine refused things, and how often recovery was cut. */
  function analyseRisk(store) {
    var assessments = rows(store, 'risk_assessments');
    if (assessments.length === 0) return { assessments: 0, note: 'no risk assessments in this store' };
    var byVerdict = Object.create(null);
    var reasons = [];
    var bindingLimits = [];
    var clampMagnitudes = [];
    assessments.forEach(function (a) {
      byVerdict[a.verdict] = (byVerdict[a.verdict] || 0) + 1;
      reasons = reasons.concat(a.reasonCodes || []);
      (a.limitsChecked || []).forEach(function (l) { if (l.binding) bindingLimits.push(l.limit); });
      if (a.verdict === enums.RiskVerdict.CLAMP && a.requestedLots > 0) {
        clampMagnitudes.push(a.approvedLots / a.requestedLots);
      }
    });
    return {
      assessments: assessments.length,
      byVerdict: byVerdict,
      blockRate: money.round((byVerdict.BLOCK || 0) / assessments.length, 6),
      clampRate: money.round((byVerdict.CLAMP || 0) / assessments.length, 6),
      topReasons: frequency(reasons).slice(0, 12),
      topBindingLimits: frequency(bindingLimits).slice(0, 12),
      meanClampFactor: clampMagnitudes.length
        ? money.round(clampMagnitudes.reduce(function (a, b) { return a + b; }, 0) / clampMagnitudes.length, 4)
        : null
    };
  }

  /** Recovery ladder behaviour over the run. */
  function analyseRecovery(store, trades) {
    var states = rows(store, 'recovery_states');
    var levels = trades.map(function (t) { return t.recoveryLevel || 0; });
    return {
      transitions: states.length,
      byReason: frequency(states.map(function (s) { return s.reason; })),
      maxLevelReached: states.length ? Math.max.apply(null, states.map(function (s) { return s.level; })) : 0,
      tradesAtLevel: frequency(levels),
      /** Trades taken above base level, as a share. */
      shareAboveBase: trades.length
        ? money.round(levels.filter(function (l) { return l > 0; }).length / trades.length, 6) : null,
      abandonedAtCap: states.filter(function (s) { return s.reason === 'CAP_ABANDONED'; }).length,
      abandonedByRisk: states.filter(function (s) { return s.reason === 'RISK_BLOCK_ABANDONED'; }).length,
      note: 'A recovery conclusion is only meaningful beside the Risk Engine clamp rate — ' +
        'the ladder that ran is not the ladder that was requested (COMPLIANCE §3.2).'
    };
  }

  /** Regime behaviour and the mission §5 cross-tab. */
  function analyseRegimes(store, trades, initialCapital) {
    var regimeRows = rows(store, 'regimes');
    var distribution = frequency(regimeRows.map(function (r) { return r.regime; }));
    var heldShare = regimeRows.length
      ? money.round(regimeRows.filter(function (r) { return r.held; }).length / regimeRows.length, 4) : null;
    var confidences = regimeRows.map(function (r) { return r.confidence; }).sort(function (a, b) { return a - b; });

    return {
      barsClassified: regimeRows.length,
      distribution: distribution,
      heldShare: heldShare,
      confidence: confidences.length ? {
        median: quantile(confidences, 0.5),
        p25: quantile(confidences, 0.25),
        p75: quantile(confidences, 0.75)
      } : null,
      performanceByRegime: groupTrades(trades, function (t) { return t.regime; }, initialCapital),
      // Mission §5: which strategies perform best under which regime. Most cells
      // will be under-sampled in a single run, and each says so.
      strategyByRegime: groupTrades(trades, function (t) { return t.strategyId + '|' + t.regime; }, initialCapital),
      note: 'Regime labels carry classification error (COMPLIANCE §3.7); every conclusion here inherits it.'
    };
  }

  /** The trades that hurt most, and the mechanics that produced them. */
  function analyseFailures(store, trades) {
    var losses = trades.filter(function (t) { return t.outcome === enums.TradeOutcome.LOSS; });
    var sorted = losses.slice().sort(function (a, b) { return a.netPnl - b.netPnl; });
    var gapped = trades.filter(function (t) { return t.gapped; });
    var ambiguous = trades.filter(function (t) { return t.intrabarAmbiguous; });
    var events = rows(store, 'system_events');

    return {
      losses: losses.length,
      worstTrades: sorted.slice(0, 10).map(function (t) {
        return {
          tradeId: t.tradeId, symbol: t.symbol, strategyId: t.strategyId, regime: t.regime,
          netPnl: t.netPnl, grossPnl: t.grossPnl, costsMoney: t.costsMoney,
          exitReason: t.exitReason, gapped: !!t.gapped, jevScore: t.jevScore,
          recoveryLevel: t.recoveryLevel, barsHeld: t.barsHeld
        };
      }),
      gappedExits: gapped.length,
      gappedShare: trades.length ? money.round(gapped.length / trades.length, 6) : null,
      /** How much worse gapped exits were than the rest — the cost of gap risk. */
      gappedMeanNet: gapped.length ? money.money(money.sum(gapped.map(function (t) { return t.netPnl; })) / gapped.length) : null,
      nonGappedMeanNet: (trades.length - gapped.length) > 0
        ? money.money(money.sum(trades.filter(function (t) { return !t.gapped; }).map(function (t) { return t.netPnl; })) / (trades.length - gapped.length))
        : null,
      intrabarAmbiguousTrades: ambiguous.length,
      exitReasons: frequency(trades.map(function (t) { return t.exitReason; })),
      systemEvents: frequency(events.map(function (e) { return e.kind; })),
      emergencyStops: events.filter(function (e) { return /EMERGENCY_STOP/.test(e.kind); }).length
    };
  }

  /** What data the run saw. */
  function analyseData(store) {
    var meta = rows(store, 'market_data_meta');
    return {
      series: meta.length,
      datasetVersions: frequency(meta.map(function (m) { return m.datasetVersion; })),
      totalBars: meta.reduce(function (a, m) { return a + m.barCount; }, 0),
      gaps: meta.reduce(function (a, m) { return a + (m.gapCount || 0); }, 0),
      symbols: meta.map(function (m) { return m.symbol; }).sort(),
      note: 'Synthetic or fixture data validates mechanics only (COMPLIANCE §3.4).'
    };
  }

  /**
   * The full report.
   *
   * @param {object} q
   * @param {object} q.store a sealed or live run store
   * @param {number} q.initialCapital
   * @param {object[]} [q.trades] defaults to the store's trades table
   * @param {string} [q.label]
   */
  function analyse(q) {
    var store = q.store;
    var trades = q.trades || rows(store, 'trades');
    var initialCapital = q.initialCapital;
    var m = metricsMod.compute({
      trades: trades,
      initialCapital: initialCapital,
      equityCurve: rows(store, 'equity_curve').map(function (r) { return { ts: r.ts, equity: r.equity }; })
    });

    return {
      agent: 'ANALYSIS_AGENT',
      label: q.label || null,
      generatedFrom: {
        storeRunId: store.runId,
        trades: trades.length,
        tables: store.counts(),
        digest: store.digest()
      },
      minSample: minSample,
      overview: metricsMod.headline(m),
      metrics: m,
      funnel: analyseFunnel(store),
      byStrategy: groupTrades(trades, function (t) { return t.strategyId; }, initialCapital),
      bySymbol: groupTrades(trades, function (t) { return t.symbol; }, initialCapital),
      byDirection: groupTrades(trades, function (t) { return t.direction; }, initialCapital),
      byExitReason: groupTrades(trades, function (t) { return t.exitReason; }, initialCapital),
      regimes: analyseRegimes(store, trades, initialCapital),
      jev: analyseJev(store, trades, initialCapital),
      costs: analyseCosts(trades),
      losingStreaks: analyseLosingStreaks(trades, initialCapital),
      drawdown: analyseDrawdown(store, trades, initialCapital),
      risk: analyseRisk(store),
      recovery: analyseRecovery(store, trades),
      data: analyseData(store),
      caveats: caveats(trades, m)
    };
  }

  /**
   * Caveats that apply to THIS report, computed rather than boilerplate. An
   * analysis of 11 trades should not read like an analysis of 1,100.
   */
  function caveats(trades, m) {
    var out = [];
    if (trades.length === 0) {
      out.push('NO_TRADES: the run produced no trades, so nothing here is a statement about performance.');
      return out;
    }
    if (trades.length < minSample) {
      out.push('SMALL_SAMPLE: ' + trades.length + ' trades is below the ' + minSample +
        '-trade threshold; no per-group figure in this report is evidence.');
    }
    if (m.equityCurveSource === 'TRADE_CLOSES_ONLY') {
      out.push('DRAWDOWN_UNDERSTATED: no mark-to-market curve was available, so drawdown is computed from trade closes and omits open-position depth.');
    }
    if (m.netPnl < 0) {
      out.push('NEGATIVE_RESULT: this configuration lost money over this data. No strategy conclusion should be drawn in either direction from a single synthetic segment.');
    }
    if (m.maxRecoveryLevel > 0) {
      out.push('RECOVERY_ACTIVE: trades were taken above base recovery level; read the recovery section together with the Risk Engine clamp rate.');
    }
    out.push('SYNTHETIC_DATA: mechanics only. No statement about edge or profitability can be derived (COMPLIANCE §3.4).');
    return out;
  }

  /** A compact text summary — for a log line or a commit message, not a decision. */
  function summarise(report) {
    var o = report.overview;
    return [
      'trades=' + o.trades,
      'winRate=' + (o.winRate === null ? 'n/a' : (100 * o.winRate).toFixed(1) + '%'),
      'net=' + o.netPnl,
      'costs=' + o.costs,
      'expectancy=' + o.expectancy,
      'PF=' + (o.profitFactor === null ? 'n/a' : o.profitFactor),
      'maxDD=' + o.maxDrawdownPct + '%',
      'maxLossStreak=' + o.maxConsecutiveLosses,
      'entryRate=' + (report.funnel.entryRate === null ? 'n/a' : (100 * report.funnel.entryRate).toFixed(2) + '%')
    ].join(' ');
  }

  // A read-only agent. No setters, no config reference, no component handles.
  return {
    agent: 'ANALYSIS_AGENT',
    minSample: minSample,
    analyse: analyse,
    summarise: summarise,
    // Individual sections, so the Research Agent can ask narrow questions.
    analyseFunnel: analyseFunnel,
    analyseJev: analyseJev,
    analyseCosts: analyseCosts,
    analyseLosingStreaks: analyseLosingStreaks,
    analyseDrawdown: analyseDrawdown,
    analyseRisk: analyseRisk,
    analyseRecovery: analyseRecovery,
    analyseRegimes: analyseRegimes,
    analyseFailures: analyseFailures,
    analyseData: analyseData,
    groupTrades: groupTrades,
    interpretJevBands: interpretJevBands,
    monotonic: monotonic
  };
}

module.exports = {
  create: create,
  DEFAULT_MIN_SAMPLE: DEFAULT_MIN_SAMPLE
};
