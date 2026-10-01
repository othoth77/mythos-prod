'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — read models over a run's store
// projects/mythos-trading-control-center/server/views.js
//
// Everything the explorers show is a QUERY over rows the Trading Agent already
// wrote: candidates, regimes, Jev verdicts, cost and risk assessments, recovery
// states, orders, positions, trades. This file joins them. It computes nothing
// the agent did not record, and that is the whole discipline:
//
//  * A stage with no stored row is reported as NOT_RECORDED or NOT_REACHED,
//    with the stage that stopped the candidate. It is never reconstructed. A
//    decision chain rebuilt from what "must have" happened is a story, and the
//    reason this store exists is that it is evidence.
//  * A number is only shown with its sample size. Below the threshold the
//    group is marked insufficient rather than presented as a statistic.
//  * The Risk Engine's `approvedLots` is the size; `requestedLots` is what the
//    recovery ladder asked for. They are always shown side by side and never
//    merged into one "size" column.
//
// `tables` is a tiny interface — rows(name) → array — satisfied both by a live
// store (a paper session) and by a sealed run read back from disk.
// =====================================================

var JEV_BANDS = Object.freeze([
  { key: '70-79', low: 70, high: 79 },
  { key: '80-89', low: 80, high: 89 },
  { key: '90-94', low: 90, high: 94 },
  { key: '95-100', low: 95, high: 100 }
]);

/** The pipeline in the order the mission states it. */
var CHAIN_STAGES = Object.freeze([
  'MARKET', 'REGIME', 'STRATEGY', 'CANDIDATE', 'JEV', 'COST',
  'RISK_ENGINE', 'RECOVERY', 'EXECUTION', 'RESULT', 'ANALYSIS'
]);

function fromStore(store, meta) {
  return {
    live: true,
    meta: meta || {},
    rows: function (name) { return store.table(name).all(); },
    counts: function () { return store.counts(); }
  };
}

function fromTables(tablesObj, meta) {
  var t = tablesObj || {};
  return {
    live: false,
    meta: meta || {},
    rows: function (name) { return t[name] || []; },
    counts: function () {
      var out = {};
      Object.keys(t).forEach(function (k) { if (t[k].length) out[k] = t[k].length; });
      return out;
    }
  };
}

function round(n, d) {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  var f = Math.pow(10, d === undefined ? 4 : d);
  return Math.round(n * f) / f;
}

function indexBy(rows, field) {
  var out = Object.create(null);
  rows.forEach(function (r) { out[r[field]] = r; });
  return out;
}

function groupBy(rows, field) {
  var out = Object.create(null);
  rows.forEach(function (r) {
    var k = r[field];
    if (!out[k]) out[k] = [];
    out[k].push(r);
  });
  return out;
}

function frequency(list) {
  var counts = Object.create(null);
  list.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
  return Object.keys(counts).map(function (k) { return { value: k, count: counts[k] }; })
    .sort(function (a, b) { return b.count - a.count || (a.value < b.value ? -1 : 1); });
}

function page(rows, q) {
  var limit = Math.min(Math.max((q && q.limit) || 100, 1), 500);
  var offset = Math.max((q && q.offset) || 0, 0);
  return { total: rows.length, limit: limit, offset: offset, items: rows.slice(offset, offset + limit) };
}

function bandOf(score) {
  if (typeof score !== 'number') return null;
  for (var i = 0; i < JEV_BANDS.length; i++) {
    if (score >= JEV_BANDS[i].low && score < JEV_BANDS[i].high + 1) return JEV_BANDS[i].key;
  }
  return 'BELOW_70';
}

/** Per-request join indexes. Cheap enough to rebuild; never cached across a live store's growth. */
function indexes(t) {
  var decisions = t.rows('decisions');
  var finalDecision = Object.create(null);
  decisions.forEach(function (d) { if (d.candidateId) finalDecision[d.candidateId] = d; });
  var costPre = Object.create(null);
  var costRealised = Object.create(null);
  t.rows('cost_assessments').forEach(function (c) {
    if (c.phase === 'REALISED') costRealised[c.candidateId] = c;
    else costPre[c.candidateId] = c;
  });
  return {
    candidates: indexBy(t.rows('candidates'), 'candidateId'),
    jev: indexBy(t.rows('jev_decisions'), 'candidateId'),
    risk: indexBy(t.rows('risk_assessments'), 'candidateId'),
    costPre: costPre,
    costRealised: costRealised,
    finalDecision: finalDecision,
    trades: indexBy(t.rows('trades'), 'candidateId'),
    orders: groupBy(t.rows('orders'), 'candidateId'),
    positions: groupBy(t.rows('positions'), 'candidateId')
  };
}

// ---------------------------------------------------------------------------
// candidates
// ---------------------------------------------------------------------------

function candidateSummary(c, ix) {
  var d = ix.finalDecision[c.candidateId] || null;
  var j = ix.jev[c.candidateId] || null;
  var r = ix.risk[c.candidateId] || null;
  return {
    candidateId: c.candidateId,
    ts: c.ts,
    symbol: c.symbol,
    strategyId: c.strategyId,
    direction: c.direction,
    regime: c.regime,
    signal: c.reasonCodes || [],
    entry: c.entry, stopLoss: c.stopLoss, takeProfit: c.takeProfit,
    rewardRisk: c.rewardRisk, netRewardRisk: c.netRewardRisk,
    jev: j ? { score: j.score, confidence: j.confidence, decision: j.decision, band: bandOf(j.score) } : null,
    risk: r ? { verdict: r.verdict, requestedLots: r.requestedLots, approvedLots: r.approvedLots } : null,
    decision: d ? d.decision : null,
    stage: d ? d.stage : null,
    // The recorded reason. Never inferred: when no decision row exists the
    // field is null and `decisionRecorded` says so.
    reasonCodes: d ? (d.reasonCodes || []) : [],
    decisionRecorded: !!d
  };
}

function candidates(t, q) {
  var f = q || {};
  var ix = indexes(t);
  var rows = t.rows('candidates').map(function (c) { return candidateSummary(c, ix); }).filter(function (c) {
    if (f.symbol && c.symbol !== f.symbol) return false;
    if (f.strategy && c.strategyId !== f.strategy) return false;
    if (f.direction && c.direction !== f.direction) return false;
    if (f.regime && c.regime !== f.regime) return false;
    if (f.decision && c.decision !== f.decision) return false;
    if (f.stage && c.stage !== f.stage) return false;
    return true;
  });
  rows.reverse();   // newest first; rows are stored in decision order
  var out = page(rows, f);
  out.rejected = rows.filter(function (c) { return c.decision === 'NO_TRADE'; }).length;
  out.entered = rows.filter(function (c) { return c.decision === 'ENTER'; }).length;
  out.withoutRecordedDecision = rows.filter(function (c) { return !c.decisionRecorded; }).length;
  return out;
}

// ---------------------------------------------------------------------------
// decisions and the decision chain
// ---------------------------------------------------------------------------

function decisions(t, q) {
  var f = q || {};
  var ix = indexes(t);
  var rows = t.rows('decisions').filter(function (d) {
    if (f.symbol && d.symbol !== f.symbol) return false;
    if (f.decision && d.decision !== f.decision) return false;
    if (f.stage && d.stage !== f.stage) return false;
    if (f.strategy) {
      var c = d.candidateId ? ix.candidates[d.candidateId] : null;
      if (!c || c.strategyId !== f.strategy) return false;
    }
    return true;
  }).map(function (d) {
    var c = d.candidateId ? ix.candidates[d.candidateId] : null;
    return {
      seq: d._seq, ts: d.ts, symbol: d.symbol, decision: d.decision, stage: d.stage,
      candidateId: d.candidateId, reasonCodes: d.reasonCodes || [],
      strategyId: c ? c.strategyId : null, direction: c ? c.direction : null,
      hasTrade: !!(d.candidateId && ix.trades[d.candidateId])
    };
  });
  rows.reverse();
  var out = page(rows, f);
  out.byStage = frequency(rows.filter(function (d) { return d.decision === 'NO_TRADE'; }).map(function (d) { return d.stage; }));
  out.entered = rows.filter(function (d) { return d.decision === 'ENTER'; }).length;
  return out;
}

function stage(name, status, record, note) {
  return { stage: name, status: status, record: record === undefined ? null : record, note: note || null };
}

/**
 * The complete chain for one candidate, from stored rows only.
 *
 * status is one of
 *   RECORDED      a stored row exists and is shown
 *   NOT_REACHED   the pipeline stopped before this stage; `note` names where
 *   NOT_RECORDED  the stage ran (or may have) but no row is stored
 */
function chain(t, candidateId, analysis) {
  var ix = indexes(t);
  var c = ix.candidates[candidateId];
  if (!c) return null;

  var d = ix.finalDecision[candidateId] || null;
  var stoppedAt = d && d.decision === 'NO_TRADE' ? d.stage : null;
  function unreached(name) {
    return stage(name, 'NOT_REACHED', null, 'the pipeline stopped at ' + stoppedAt + ': ' + (d.reasonCodes || []).join(', '));
  }

  var out = [];

  // MARKET — the data this run saw for the instrument. Not the bar itself: the
  // store keeps provenance, not prices, and the chain does not pretend otherwise.
  var meta = t.rows('market_data_meta').filter(function (m) { return m.symbol === c.symbol; })[0] || null;
  out.push(meta
    ? stage('MARKET', 'RECORDED', {
        symbol: meta.symbol, timeframe: meta.timeframe, datasetVersion: meta.datasetVersion,
        sourceKind: meta.sourceKind, barCount: meta.barCount, firstBarTs: meta.firstBarTs,
        lastBarTs: meta.lastBarTs, gapCount: meta.gapCount === undefined ? null : meta.gapCount, barTs: c.ts
      }, 'The store records data provenance, not individual bars.')
    : stage('MARKET', 'NOT_RECORDED', { symbol: c.symbol, barTs: c.ts }, 'no market_data_meta row for ' + c.symbol + ' in this store'));

  // REGIME — the classification for this symbol at this bar.
  var regime = null;
  var regimes = t.rows('regimes');
  for (var i = regimes.length - 1; i >= 0; i--) {
    if (regimes[i].ts === c.ts && regimes[i].symbol === c.symbol) { regime = regimes[i]; break; }
  }
  out.push(regime
    ? stage('REGIME', 'RECORDED', {
        ts: regime.ts, regime: regime.regime, direction: regime.direction, confidence: regime.confidence,
        held: regime.held, features: regime.features, scores: regime.scores
      })
    : stage('REGIME', 'NOT_RECORDED', { regimeOnCandidate: c.regime, regimeConfidence: c.regimeConfidence },
        'no regime row at this bar; the candidate itself carries the label it was built under'));

  // STRATEGY
  var strat = t.rows('strategies').filter(function (s) { return s.strategyId === c.strategyId; })[0] || null;
  var ver = t.rows('strategy_versions').filter(function (s) { return s.strategyId === c.strategyId; })[0] || null;
  out.push(strat
    ? stage('STRATEGY', 'RECORDED', {
        strategyId: strat.strategyId, family: strat.family, name: strat.name, version: strat.version,
        preferredRegimes: strat.preferredRegimes, paramsHash: ver ? ver.paramsHash : c.paramsHash, params: ver ? ver.params : null,
        signal: c.reasonCodes || [], strategyConfidence: c.strategyConfidence
      })
    : stage('STRATEGY', 'NOT_RECORDED', { strategyId: c.strategyId }, 'no strategies row for ' + c.strategyId));

  // CANDIDATE
  var cand = {};
  Object.keys(c).forEach(function (k) { if (k !== '_table') cand[k] = c[k]; });
  out.push(stage('CANDIDATE', 'RECORDED', cand));

  // COST runs BEFORE Jev in the agent; the mission lists Jev first. Both are
  // shown under their own names with their own stored row.
  var cost = ix.costPre[candidateId] || null;
  var jev = ix.jev[candidateId] || null;

  if (jev) {
    out.push(stage('JEV', 'RECORDED', {
      score: jev.score, confidence: jev.confidence, decision: jev.decision, band: bandOf(jev.score),
      storedBand: jev.band, threshold: jev.threshold, minConfidence: jev.minConfidence, model: jev.model,
      reasonCodes: jev.reasonCodes, riskFlags: jev.riskFlags, hardFlags: jev.hardFlags || [],
      components: jev.components, priorSampleSize: jev.priorSampleSize
    }));
  } else if (stoppedAt === 'COST') {
    out.push(unreached('JEV'));
  } else {
    out.push(stage('JEV', 'NOT_RECORDED', null, 'no jev_decisions row for this candidate'));
  }

  out.push(cost
    ? stage('COST', 'RECORDED', {
        passed: cost.passed, reasonCodes: cost.reasonCodes || [], spreadMoney: cost.spreadMoney,
        commissionMoney: cost.commissionMoney, slippageMoney: cost.slippageMoney, swapMoney: cost.swapMoney,
        totalCostMoney: cost.totalCostMoney, costPips: cost.costPips, netRewardPips: cost.netRewardPips, phase: cost.phase
      }, 'The agent applies the cost filter before the Jev gate.')
    : stage('COST', 'NOT_RECORDED', null, 'no pre-trade cost_assessments row for this candidate'));

  // RISK ENGINE — final authority on size.
  var risk = ix.risk[candidateId] || null;
  if (risk) {
    out.push(stage('RISK_ENGINE', 'RECORDED', {
      verdict: risk.verdict, requestedLots: risk.requestedLots, approvedLots: risk.approvedLots,
      reasonCodes: risk.reasonCodes, accountEquity: risk.accountEquity, riskBudgetMoney: risk.riskBudgetMoney,
      approvedRiskMoney: risk.approvedRiskMoney, approvedRiskPct: risk.approvedRiskPct,
      riskAtMinLot: risk.riskAtMinLot, limitsChecked: risk.limitsChecked,
      bindingLimits: (risk.limitsChecked || []).filter(function (l) { return l.binding; }).map(function (l) { return l.limit; })
    }, 'The approved size is the only size that reaches execution.'));
  } else if (stoppedAt === 'COST' || stoppedAt === 'JEV') {
    out.push(unreached('RISK_ENGINE'));
  } else {
    out.push(stage('RISK_ENGINE', 'NOT_RECORDED', null, 'no risk_assessments row for this candidate'));
  }

  // RECOVERY — the ladder's state for this asset at or before this bar.
  var recRows = t.rows('recovery_states').filter(function (r) { return r.symbol === c.symbol && r.ts !== null && r.ts <= c.ts; });
  var rec = recRows.length ? recRows[recRows.length - 1] : null;
  var tpRow = t.rows('recovery_states').filter(function (r) {
    return r.symbol === c.symbol && r.ts === c.ts && r.reason === 'TP_UNREACHABLE';
  })[0] || null;
  if (stoppedAt === 'COST' || stoppedAt === 'JEV') {
    out.push(unreached('RECOVERY'));
  } else if (tpRow || rec) {
    var shown = tpRow || rec;
    out.push(stage('RECOVERY', 'RECORDED', {
      symbol: shown.symbol, level: shown.level, cumulativeLossMoney: shown.cumulativeLossMoney,
      nextLotsUncapped: shown.nextLotsUncapped, nextLotsRequested: shown.nextLotsRequested, reason: shown.reason,
      stateTs: shown.ts, requiredPips: shown.requiredPips === undefined ? null : shown.requiredPips,
      offeredPips: shown.offeredPips === undefined ? null : shown.offeredPips,
      requestedLots: risk ? risk.requestedLots : null, approvedLots: risk ? risk.approvedLots : null
    }, tpRow ? 'Recorded at this bar.' : 'The most recent recovery state recorded for ' + c.symbol + ' at or before this bar.'));
  } else {
    out.push(stage('RECOVERY', 'NOT_RECORDED', risk ? { requestedLots: risk.requestedLots, approvedLots: risk.approvedLots } : null,
      'no recovery state had been recorded for ' + c.symbol + ' by this bar (the ladder was at its base level or disabled)'));
  }

  // EXECUTION
  var orders = ix.orders[candidateId] || [];
  var positions = ix.positions[candidateId] || [];
  if (orders.length || positions.length) {
    out.push(stage('EXECUTION', 'RECORDED', {
      orders: orders.map(function (o) {
        return { orderId: o.orderId, ts: o.ts, status: o.status, type: o.type, direction: o.direction, lots: o.lots,
          requestedPrice: o.requestedPrice, filledPrice: o.filledPrice === undefined ? null : o.filledPrice,
          rejectReason: o.rejectReason || null, paper: o.paper === true };
      }),
      positions: positions.map(function (p) {
        return { positionId: p.positionId, status: p.status, entryTs: p.entryTs, entryPrice: p.entryPrice,
          exitTs: p.exitTs === undefined ? null : p.exitTs, exitPrice: p.exitPrice === undefined ? null : p.exitPrice,
          lots: p.lots, stopLoss: p.stopLoss, takeProfit: p.takeProfit, paper: p.paper === true };
      })
    }));
  } else if (stoppedAt) {
    out.push(unreached('EXECUTION'));
  } else {
    out.push(stage('EXECUTION', 'NOT_RECORDED', null, 'no orders or positions row for this candidate'));
  }

  // RESULT
  var trade = ix.trades[candidateId] || null;
  if (trade) {
    var tr = {};
    Object.keys(trade).forEach(function (k) { if (k !== '_table') tr[k] = trade[k]; });
    tr.rMultiple = typeof trade.riskMoney === 'number' && trade.riskMoney > 0 ? round(trade.netPnl / trade.riskMoney, 4) : null;
    out.push(stage('RESULT', 'RECORDED', tr));
  } else if (stoppedAt) {
    out.push(unreached('RESULT'));
  } else {
    out.push(stage('RESULT', 'NOT_RECORDED', null,
      'no trades row: the position was never opened, or is still open'));
  }

  // ANALYSIS — the Analysis Agent's stored groups this trade belongs to.
  if (!trade) {
    out.push(stoppedAt ? unreached('ANALYSIS')
      : stage('ANALYSIS', 'NOT_RECORDED', null, 'the Analysis Agent reports on closed trades; this candidate has none'));
  } else if (!analysis) {
    out.push(stage('ANALYSIS', 'NOT_RECORDED', null, 'no Analysis Agent report is stored for this run'));
  } else {
    var jb = jev ? (jev.band === null || jev.band === undefined ? 'BELOW_BANDS' : jev.band) : null;
    out.push(stage('ANALYSIS', 'RECORDED', {
      minSample: analysis.minSample,
      byStrategy: (analysis.byStrategy || {})[trade.strategyId] || null,
      bySymbol: (analysis.bySymbol || {})[trade.symbol] || null,
      byRegime: analysis.regimes && analysis.regimes.performanceByRegime ? analysis.regimes.performanceByRegime[trade.regime] || null : null,
      byJevBand: jb && analysis.jev && analysis.jev.bandPerformance ? analysis.jev.bandPerformance[jb] || null : null,
      inWorstLosingStreak: !!(analysis.losingStreaks && analysis.losingStreaks.worstStreak &&
        trade.entryTs >= analysis.losingStreaks.worstStreak.fromTs && trade.exitTs <= analysis.losingStreaks.worstStreak.toTs &&
        trade.outcome === 'LOSS')
    }, 'Group statistics from the stored Analysis Agent report; each carries its own sample size.'));
  }

  var recorded = out.filter(function (s) { return s.status === 'RECORDED'; }).length;
  return {
    candidateId: candidateId,
    symbol: c.symbol,
    ts: c.ts,
    decision: d ? d.decision : null,
    stoppedAt: stoppedAt,
    reasonCodes: d ? (d.reasonCodes || []) : [],
    decisionRecorded: !!d,
    stages: out,
    integrity: {
      stages: out.length,
      recorded: recorded,
      notReached: out.filter(function (s) { return s.status === 'NOT_REACHED'; }).length,
      notRecorded: out.filter(function (s) { return s.status === 'NOT_RECORDED'; }).map(function (s) { return s.stage; }),
      order: out.map(function (s) { return s.stage; })
    }
  };
}

// ---------------------------------------------------------------------------
// trades
// ---------------------------------------------------------------------------

function tradeView(tr, ix) {
  var c = ix.candidates[tr.candidateId] || null;
  var j = ix.jev[tr.candidateId] || null;
  var r = ix.risk[tr.candidateId] || null;
  return {
    tradeId: tr.tradeId,
    candidateId: tr.candidateId,
    symbol: tr.symbol,
    strategyId: tr.strategyId,
    direction: tr.direction,
    entryTs: tr.entryTs, exitTs: tr.exitTs,
    entry: tr.entryPrice, exit: tr.exitPrice,
    stopLoss: tr.stopLoss === undefined ? (c ? c.stopLoss : null) : tr.stopLoss,
    takeProfit: tr.takeProfit === undefined ? (c ? c.takeProfit : null) : tr.takeProfit,
    requestedLots: r ? r.requestedLots : null,
    approvedLots: r ? r.approvedLots : null,
    lots: tr.lots,
    jevScore: tr.jevScore,
    jevConfidence: j ? j.confidence : null,
    jevBand: bandOf(tr.jevScore),
    riskVerdict: r ? r.verdict : null,
    riskReasons: r ? r.reasonCodes : [],
    recoveryLevel: tr.recoveryLevel,
    regime: tr.regime,
    grossPnl: tr.grossPnl,
    costs: {
      total: tr.costsMoney,
      spread: tr.spreadMoney === undefined ? null : tr.spreadMoney,
      commission: tr.commissionMoney === undefined ? null : tr.commissionMoney,
      slippage: tr.slippageMoney === undefined ? null : tr.slippageMoney,
      swap: tr.swapMoney === undefined ? null : tr.swapMoney
    },
    netPnl: tr.netPnl,
    riskMoney: tr.riskMoney === undefined ? null : tr.riskMoney,
    rMultiple: typeof tr.riskMoney === 'number' && tr.riskMoney > 0 ? round(tr.netPnl / tr.riskMoney, 4) : null,
    outcome: tr.outcome,
    exitReason: tr.exitReason,
    barsHeld: tr.barsHeld,
    equityAfter: tr.equityAfter,
    gapped: !!tr.gapped,
    paper: tr.paper === true
  };
}

function trades(t, q) {
  var f = q || {};
  var ix = indexes(t);
  var rows = t.rows('trades').filter(function (tr) {
    if (f.symbol && tr.symbol !== f.symbol) return false;
    if (f.strategy && tr.strategyId !== f.strategy) return false;
    if (f.direction && tr.direction !== f.direction) return false;
    if (f.outcome && tr.outcome !== f.outcome) return false;
    if (f.regime && tr.regime !== f.regime) return false;
    return true;
  }).map(function (tr) { return tradeView(tr, ix); });
  rows.reverse();
  return page(rows, f);
}

function trade(t, tradeId) {
  var ix = indexes(t);
  var tr = t.rows('trades').filter(function (r) { return r.tradeId === tradeId; })[0];
  return tr ? tradeView(tr, ix) : null;
}

// ---------------------------------------------------------------------------
// group statistics, always with the sample size
// ---------------------------------------------------------------------------

function tradeStats(list, minSample) {
  var n = list.length;
  var wins = list.filter(function (x) { return x.outcome === 'WIN'; });
  var losses = list.filter(function (x) { return x.outcome === 'LOSS'; });
  var net = 0, winSum = 0, lossSum = 0, costs = 0;
  list.forEach(function (x) { net += x.netPnl; costs += x.costsMoney || 0; });
  wins.forEach(function (x) { winSum += x.netPnl; });
  losses.forEach(function (x) { lossSum += -x.netPnl; });
  var streak = 0, maxStreak = 0;
  list.forEach(function (x) {
    if (x.outcome === 'LOSS') { streak++; if (streak > maxStreak) maxStreak = streak; } else streak = 0;
  });
  return {
    sampleSize: n,
    sufficient: n >= minSample,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? round(wins.length / n, 4) : null,
    netPnl: n ? round(net, 4) : null,
    totalCosts: n ? round(costs, 4) : null,
    expectancy: n ? round(net / n, 4) : null,
    profitFactor: lossSum > 0 ? round(winSum / lossSum, 4) : null,
    maxConsecutiveLosses: maxStreak
  };
}

function strategyStats(t, strategies, minSample) {
  var min = minSample || 20;
  var ix = indexes(t);
  var cands = groupBy(t.rows('candidates'), 'strategyId');
  var trs = groupBy(t.rows('trades'), 'strategyId');
  return strategies.map(function (s) {
    var list = cands[s.strategyId] || [];
    var stages = [];
    var entered = 0;
    list.forEach(function (c) {
      var d = ix.finalDecision[c.candidateId];
      if (!d) return;
      if (d.decision === 'ENTER') entered++;
      else stages.push(d.stage);
    });
    return {
      strategyId: s.strategyId, family: s.family, name: s.name, version: s.version,
      preferredRegimes: s.preferredRegimes, enabled: s.enabled,
      candidates: list.length,
      entered: entered,
      rejectedByStage: frequency(stages),
      byRegime: frequency(list.map(function (c) { return c.regime; })),
      trades: tradeStats(trs[s.strategyId] || [], min)
    };
  });
}

// ---------------------------------------------------------------------------
// Jev
// ---------------------------------------------------------------------------

function jevSummary(t, minSample) {
  var min = minSample || 20;
  var verdicts = t.rows('jev_decisions');
  var ix = indexes(t);
  var tradesAll = t.rows('trades');
  var bands = JEV_BANDS.map(function (b) { return b.key; }).concat(['BELOW_70']);
  var byBand = {};
  bands.forEach(function (k) { byBand[k] = { band: k, considered: 0, allowed: 0, blocked: 0, trades: null }; });
  verdicts.forEach(function (v) {
    var b = byBand[bandOf(v.score)];
    if (!b) return;
    b.considered++;
    if (v.decision === 'ENTER') b.allowed++; else b.blocked++;
  });
  bands.forEach(function (k) {
    byBand[k].trades = tradeStats(tradesAll.filter(function (tr) { return bandOf(tr.jevScore) === k; }), min);
  });
  var reasons = [], flags = [];
  verdicts.forEach(function (v) { reasons = reasons.concat(v.reasonCodes || []); flags = flags.concat(v.riskFlags || []); });
  var recent = verdicts.slice(-60).reverse().map(function (v) {
    var c = ix.candidates[v.candidateId];
    return {
      candidateId: v.candidateId, ts: v.ts, symbol: c ? c.symbol : null, strategyId: c ? c.strategyId : null,
      score: v.score, confidence: v.confidence, decision: v.decision, band: bandOf(v.score),
      reasonCodes: v.reasonCodes, riskFlags: v.riskFlags
    };
  });
  var last = verdicts.length ? verdicts[verdicts.length - 1] : null;
  return {
    verdicts: verdicts.length,
    allowed: verdicts.filter(function (v) { return v.decision === 'ENTER'; }).length,
    blocked: verdicts.filter(function (v) { return v.decision === 'REJECT'; }).length,
    // The stored decision values are ENTER and REJECT. ALLOW / BLOCK are the
    // same two outcomes under the Control Center's labels.
    vocabulary: { ENTER: 'ALLOW', REJECT: 'BLOCK' },
    threshold: last ? last.threshold : null,
    minConfidence: last ? last.minConfidence : null,
    model: last ? last.model : null,
    bands: bands.map(function (k) { return byBand[k]; }),
    topReasonCodes: frequency(reasons).slice(0, 12),
    topRiskFlags: frequency(flags).slice(0, 12),
    recent: recent,
    last: recent.length ? recent[0] : null,
    minSample: min
  };
}

// ---------------------------------------------------------------------------
// Risk Engine
// ---------------------------------------------------------------------------

function riskSummary(t) {
  var rows = t.rows('risk_assessments');
  var ix = indexes(t);
  var byVerdict = { ALLOW: 0, CLAMP: 0, BLOCK: 0 };
  var reasons = [], binding = [];
  rows.forEach(function (r) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
    reasons = reasons.concat(r.reasonCodes || []);
    (r.limitsChecked || []).forEach(function (l) { if (l.binding) binding.push(l.limit); });
  });
  function view(r) {
    var c = ix.candidates[r.candidateId];
    return {
      candidateId: r.candidateId, ts: r.ts, symbol: c ? c.symbol : null, strategyId: c ? c.strategyId : null,
      verdict: r.verdict, requestedLots: r.requestedLots, approvedLots: r.approvedLots,
      reasonCodes: r.reasonCodes, accountEquity: r.accountEquity, riskBudgetMoney: r.riskBudgetMoney,
      approvedRiskMoney: r.approvedRiskMoney, approvedRiskPct: r.approvedRiskPct, riskAtMinLot: r.riskAtMinLot,
      bindingLimits: (r.limitsChecked || []).filter(function (l) { return l.binding; }).map(function (l) { return l.limit; })
    };
  }
  var last = rows.length ? rows[rows.length - 1] : null;
  // The most recent recorded measurement of EACH limit. One assessment does not
  // check every limit — an account-level block stops before sizing — so the
  // latest row alone would leave the budget blank exactly when the account is
  // in trouble. Each value keeps the bar time it was measured at.
  var observed = null;
  if (last) {
    observed = {};
    for (var oi = rows.length - 1; oi >= 0 && oi >= rows.length - 400; oi--) {
      var checked = rows[oi].limitsChecked || [];
      for (var oj = 0; oj < checked.length; oj++) {
        var lim = checked[oj];
        if (observed[lim.limit] === undefined) {
          observed[lim.limit] = { observed: lim.observed, limit: lim.limitValue, binding: lim.binding, ts: rows[oi].ts };
        }
      }
    }
  }
  var curve = t.rows('equity_curve');
  var lastEquity = curve.length ? curve[curve.length - 1] : null;
  var events = t.rows('system_events').filter(function (e) {
    return /EMERGENCY_STOP|STREAK_BREAKER|RISK/.test(e.kind);
  });
  return {
    assessments: rows.length,
    byVerdict: byVerdict,
    blockRate: rows.length ? round(byVerdict.BLOCK / rows.length, 4) : null,
    clampRate: rows.length ? round(byVerdict.CLAMP / rows.length, 4) : null,
    topReasons: frequency(reasons).slice(0, 14),
    topBindingLimits: frequency(binding).slice(0, 14),
    lastObserved: observed,
    lastAssessment: last ? view(last) : null,
    exposure: lastEquity ? {
      ts: lastEquity.ts, equity: lastEquity.equity, balance: lastEquity.balance,
      openRiskMoney: lastEquity.openRisk, drawdownPct: lastEquity.drawdownPct
    } : null,
    clamps: rows.filter(function (r) { return r.verdict === 'CLAMP'; }).slice(-40).reverse().map(view),
    blocks: rows.filter(function (r) { return r.verdict === 'BLOCK'; }).slice(-40).reverse().map(view),
    events: events.slice(-40).reverse().map(function (e) {
      return { ts: e.ts, kind: e.kind, severity: e.severity, message: e.message };
    })
  };
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

function recoverySummary(t, symbols) {
  var rows = t.rows('recovery_states');
  var ix = indexes(t);
  var bySymbol = groupBy(rows, 'symbol');
  var riskRows = t.rows('risk_assessments');
  // The assets THIS source traded, from its own data provenance — not the
  // platform's current universe, which may have changed since the run.
  var sourceSymbols = t.rows('market_data_meta').map(function (m) { return m.symbol; });
  var listed = symbols || (sourceSymbols.length ? sourceSymbols : Object.keys(bySymbol));
  var perAsset = listed.filter(function (sym, i) { return listed.indexOf(sym) === i; }).map(function (sym) {
    var list = bySymbol[sym] || [];
    var last = list.length ? list[list.length - 1] : null;
    // The latest Risk Engine verdict for this asset: what the ladder asked for
    // versus what was approved.
    var lastRisk = null;
    for (var i = riskRows.length - 1; i >= 0; i--) {
      var c = ix.candidates[riskRows[i].candidateId];
      if (c && c.symbol === sym) { lastRisk = riskRows[i]; break; }
    }
    return {
      symbol: sym,
      recorded: !!last,
      level: last ? last.level : null,
      cumulativeLossMoney: last ? last.cumulativeLossMoney : null,
      nextLotsUncapped: last ? last.nextLotsUncapped : null,
      nextLotsRequested: last ? last.nextLotsRequested : null,
      lastReason: last ? last.reason : null,
      lastTs: last ? last.ts : null,
      requestedLots: lastRisk ? lastRisk.requestedLots : null,
      approvedLots: lastRisk ? lastRisk.approvedLots : null,
      riskVerdict: lastRisk ? lastRisk.verdict : null,
      transitions: list.length,
      maxLevel: list.length ? Math.max.apply(null, list.map(function (r) { return r.level; })) : null,
      resets: list.filter(function (r) { return r.reason === 'WIN_RESET'; }).length,
      abandonedAtCap: list.filter(function (r) { return r.reason === 'CAP_ABANDONED'; }).length,
      abandonedByRisk: list.filter(function (r) { return r.reason === 'RISK_BLOCK_ABANDONED'; }).length
    };
  });
  return {
    transitions: rows.length,
    byReason: frequency(rows.map(function (r) { return r.reason; })),
    perAsset: perAsset,
    history: rows.slice(-80).reverse().map(function (r) {
      return {
        ts: r.ts, symbol: r.symbol, level: r.level, cumulativeLossMoney: r.cumulativeLossMoney,
        nextLotsUncapped: r.nextLotsUncapped, nextLotsRequested: r.nextLotsRequested, reason: r.reason,
        approvedLots: r.approvedLots === undefined ? null : r.approvedLots,
        tradeId: r.tradeId || null, netPnl: r.netPnl === undefined ? null : r.netPnl
      };
    })
  };
}

// ---------------------------------------------------------------------------
// series for charts — downsampled, never smoothed
// ---------------------------------------------------------------------------

/** Keeps every k-th sample plus the last, so the end of the curve is exact. */
function downsample(rows, maxPoints) {
  if (rows.length <= maxPoints) return rows.slice();
  var step = Math.ceil(rows.length / maxPoints);
  var out = [];
  for (var i = 0; i < rows.length; i += step) out.push(rows[i]);
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1]);
  return out;
}

function equitySeries(t, maxPoints) {
  var rows = t.rows('equity_curve');
  return {
    points: rows.length,
    source: rows.length ? 'MARK_TO_MARKET' : 'NONE',
    series: downsample(rows, maxPoints || 400).map(function (r) {
      return { ts: r.ts, equity: r.equity, balance: r.balance, drawdownPct: r.drawdownPct };
    })
  };
}

function histogram(values, buckets) {
  if (!values.length) return [];
  var min = Math.min.apply(null, values);
  var max = Math.max.apply(null, values);
  if (min === max) return [{ from: min, to: max, count: values.length }];
  var n = buckets || 12;
  var width = (max - min) / n;
  var out = [];
  for (var i = 0; i < n; i++) out.push({ from: round(min + i * width, 4), to: round(min + (i + 1) * width, 4), count: 0 });
  values.forEach(function (v) {
    var idx = Math.min(n - 1, Math.floor((v - min) / width));
    out[idx].count++;
  });
  return out;
}

function charts(t) {
  var trs = t.rows('trades');
  var byStrategy = groupBy(trs, 'strategyId');
  var regimes = t.rows('regimes');
  var js = jevSummary(t, 1);
  return {
    equity: equitySeries(t, 400),
    tradeDistribution: histogram(trs.map(function (x) { return x.netPnl; }), 14),
    strategyContribution: Object.keys(byStrategy).sort().map(function (k) {
      var net = 0;
      byStrategy[k].forEach(function (x) { net += x.netPnl; });
      return { strategyId: k, trades: byStrategy[k].length, netPnl: round(net, 4) };
    }),
    jevBands: js.bands.map(function (b) {
      return { band: b.band, considered: b.considered, allowed: b.allowed, blocked: b.blocked,
        trades: b.trades.sampleSize, netPnl: b.trades.netPnl };
    }),
    regimeDistribution: frequency(regimes.map(function (r) { return r.regime; }))
  };
}

// ---------------------------------------------------------------------------
// activity derived from a store
// ---------------------------------------------------------------------------

function storeEvents(t, sourceLabel) {
  var out = [];
  var ix = indexes(t);
  function push(ts, type, severity, asset, strategy, message, ref) {
    out.push({ ts: ts, type: type, severity: severity, asset: asset || null, strategy: strategy || null,
      message: message, ref: ref || null, source: sourceLabel });
  }
  t.rows('trades').forEach(function (tr) {
    push(tr.exitTs, 'trade', tr.outcome === 'LOSS' ? 'WARN' : 'INFO', tr.symbol, tr.strategyId,
      tr.direction + ' ' + tr.lots + ' closed ' + tr.exitReason + ' net ' + tr.netPnl, { tradeId: tr.tradeId, candidateId: tr.candidateId });
  });
  t.rows('candidates').forEach(function (c) {
    push(c.ts, 'candidate', 'INFO', c.symbol, c.strategyId,
      c.direction + ' proposed by ' + c.strategyId + ' in ' + c.regime + ': entry ' + c.entry + ', stop ' + c.stopLoss + ', target ' + c.takeProfit,
      { candidateId: c.candidateId });
  });
  t.rows('decisions').forEach(function (d) {
    var c = d.candidateId ? ix.candidates[d.candidateId] : null;
    push(d.ts, 'decision', 'INFO', d.symbol, c ? c.strategyId : null,
      d.decision + (d.decision === 'NO_TRADE' ? ' at ' + d.stage : '') + ': ' + (d.reasonCodes || []).join(', '),
      { candidateId: d.candidateId });
  });
  t.rows('risk_assessments').forEach(function (r) {
    if (r.verdict === 'ALLOW') return;
    var c = ix.candidates[r.candidateId];
    push(r.ts, 'risk', r.verdict === 'BLOCK' ? 'WARN' : 'INFO', c ? c.symbol : null, c ? c.strategyId : null,
      r.verdict + ' requested ' + r.requestedLots + ' approved ' + r.approvedLots + ': ' + (r.reasonCodes || []).join(', '),
      { candidateId: r.candidateId });
  });
  t.rows('jev_decisions').forEach(function (j) {
    if (j.decision !== 'REJECT') return;
    var c = ix.candidates[j.candidateId];
    push(j.ts, 'jev', 'INFO', c ? c.symbol : null, c ? c.strategyId : null,
      'BLOCK score ' + j.score + ' confidence ' + j.confidence + ': ' + (j.reasonCodes || []).join(', '),
      { candidateId: j.candidateId });
  });
  t.rows('recovery_states').forEach(function (r) {
    push(r.ts, 'recovery', /ABANDONED|UNREACHABLE/.test(r.reason) ? 'WARN' : 'INFO', r.symbol, null,
      r.reason + ' level ' + r.level + ' next requested ' + r.nextLotsRequested, null);
  });
  t.rows('system_events').forEach(function (e) {
    push(e.ts, e.severity === 'ERROR' ? 'error' : (e.severity === 'WARN' ? 'warning' : 'system'), e.severity,
      e.symbol || null, null, e.kind + ': ' + e.message, null);
  });
  return out;
}

module.exports = {
  JEV_BANDS: JEV_BANDS,
  CHAIN_STAGES: CHAIN_STAGES,
  fromStore: fromStore,
  fromTables: fromTables,
  candidates: candidates,
  decisions: decisions,
  chain: chain,
  trades: trades,
  trade: trade,
  strategyStats: strategyStats,
  jevSummary: jevSummary,
  riskSummary: riskSummary,
  recoverySummary: recoverySummary,
  equitySeries: equitySeries,
  charts: charts,
  storeEvents: storeEvents,
  tradeStats: tradeStats,
  bandOf: bandOf,
  frequency: frequency,
  downsample: downsample,
  page: page
};
