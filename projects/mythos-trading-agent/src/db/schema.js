'use strict';
// =====================================================
// MYTHOS TRADING AGENT — persistence schema
// projects/mythos-trading-agent/src/db/schema.js
//
// Mission §16 lists what must be storable and §17 lists the questions the store
// must be able to answer ("why did it enter / reject / lose / increase recovery
// / get blocked"). Those two lists constrain each other: a question is only
// answerable if the record that would answer it carries the field, so each
// table below names the question it exists to answer.
//
// The store is APPEND-ONLY. Nothing is updated in place; a state change is a
// new record with a later sequence number. An audit trail that can be rewritten
// is not one, and a trade log with mutable rows cannot support the
// reproducibility claim in mission §14.
// =====================================================

/**
 * Table definitions.
 *  required  — fields that must be present and non-undefined on every record
 *  indexed   — fields the store builds a lookup index for
 *  answers   — the §17 question this table exists to answer (documentation)
 */
var TABLES = Object.freeze({
  // ---- reference / metadata -----------------------------------------------
  market_data_meta: {
    required: ['symbol', 'timeframe', 'barCount', 'firstBarTs', 'lastBarTs', 'datasetVersion', 'sourceKind'],
    indexed: ['symbol', 'datasetVersion'],
    answers: 'Which data did this run see, and can I get the same bars again?'
  },
  strategies: {
    required: ['strategyId', 'family', 'name'],
    indexed: ['strategyId', 'family'],
    answers: 'What strategies exist, and what family does each belong to?'
  },
  strategy_versions: {
    required: ['strategyId', 'version', 'paramsHash', 'params'],
    indexed: ['strategyId', 'paramsHash'],
    answers: 'Which exact parameter set produced this result?'
  },

  // ---- the decision pipeline ----------------------------------------------
  candidates: {
    required: [
      'candidateId', 'ts', 'symbol', 'strategyId', 'timeframe', 'direction',
      'entry', 'stopLoss', 'takeProfit', 'rewardRisk', 'regime', 'spreadPips',
      'estimatedCostMoney', 'expectedNetMoney'
    ],
    indexed: ['candidateId', 'symbol', 'strategyId', 'regime'],
    answers: 'What did the strategies actually propose, and at what expected net outcome?'
  },
  regimes: {
    required: ['ts', 'symbol', 'timeframe', 'regime', 'direction', 'confidence', 'features'],
    indexed: ['symbol', 'regime'],
    answers: 'What did the platform believe the market was doing at that moment?'
  },
  jev_decisions: {
    required: ['candidateId', 'ts', 'score', 'confidence', 'decision', 'reasonCodes', 'riskFlags', 'model', 'threshold'],
    indexed: ['candidateId', 'decision'],
    answers: 'WHY DID JEV REJECT IT? — and at what score band.'
  },
  cost_assessments: {
    required: ['candidateId', 'ts', 'symbol', 'spreadMoney', 'commissionMoney', 'slippageMoney', 'swapMoney', 'totalCostMoney', 'passed'],
    indexed: ['candidateId'],
    answers: 'Did costs alone make this trade uneconomic?'
  },
  risk_assessments: {
    required: ['candidateId', 'ts', 'verdict', 'requestedLots', 'approvedLots', 'reasonCodes', 'limitsChecked', 'accountEquity'],
    indexed: ['candidateId', 'verdict'],
    answers: 'WHY DID RISK ENGINE BLOCK IT? — which named limit bound, at what value.'
  },
  recovery_states: {
    required: ['ts', 'symbol', 'level', 'cumulativeLossMoney', 'nextLotsUncapped', 'nextLotsRequested', 'reason'],
    indexed: ['symbol', 'level'],
    answers: 'WHY DID RECOVERY INCREASE? — and what size it asked for before clamping.'
  },
  decisions: {
    required: ['ts', 'symbol', 'decision', 'stage', 'candidateId', 'reasonCodes'],
    indexed: ['symbol', 'decision', 'stage'],
    answers: 'The one-line verdict per candidate: ENTER, or NO_TRADE at which stage.'
  },

  // ---- execution and results ----------------------------------------------
  orders: {
    required: ['orderId', 'candidateId', 'ts', 'symbol', 'type', 'direction', 'lots', 'requestedPrice', 'status'],
    indexed: ['orderId', 'candidateId', 'symbol', 'status'],
    answers: 'What was sent, at what size, and was it accepted?'
  },
  positions: {
    required: ['positionId', 'orderId', 'symbol', 'direction', 'lots', 'entryTs', 'entryPrice', 'stopLoss', 'takeProfit', 'status'],
    indexed: ['positionId', 'symbol', 'status'],
    answers: 'What was open, when, and with which protective levels?'
  },
  trades: {
    required: [
      'tradeId', 'positionId', 'candidateId', 'symbol', 'strategyId', 'direction',
      'entryTs', 'exitTs', 'entryPrice', 'exitPrice', 'lots', 'grossPnl',
      'costsMoney', 'netPnl', 'outcome', 'exitReason', 'regime', 'jevScore',
      'recoveryLevel', 'barsHeld', 'equityAfter'
    ],
    indexed: ['tradeId', 'symbol', 'strategyId', 'outcome', 'regime'],
    answers: 'WHY DID IT LOSE? — with the regime, the Jev score and the recovery level it was taken under.'
  },
  equity_curve: {
    required: ['ts', 'equity', 'balance', 'openRisk', 'drawdownPct'],
    indexed: [],
    answers: 'What did the account do over time, including intra-trade?'
  },

  // ---- research and governance -------------------------------------------
  backtests: {
    required: ['backtestId', 'label', 'configHash', 'datasetVersion', 'seed', 'segment', 'metrics', 'startedAt', 'finishedAt'],
    indexed: ['backtestId', 'configHash', 'label'],
    answers: 'Can this result be reproduced from its recorded inputs?'
  },
  stress_tests: {
    required: ['stressId', 'backtestId', 'kind', 'params', 'seed', 'replications', 'summary'],
    indexed: ['stressId', 'backtestId', 'kind'],
    answers: 'What did the system survive, and at what percentile did it stop surviving?'
  },
  experiments: {
    required: ['experimentId', 'hypothesisId', 'baselineConfigHash', 'variantConfigHash', 'comparison'],
    indexed: ['experimentId', 'hypothesisId'],
    answers: 'What was compared against what, and by how much did it differ?'
  },
  hypotheses: {
    required: ['hypothesisId', 'state', 'observation', 'statement', 'proposedChange', 'createdAt'],
    indexed: ['hypothesisId', 'state'],
    answers: 'What is the Research Agent currently claiming, and on what observation?'
  },
  champions: {
    required: ['recordId', 'configHash', 'state', 'promotedAt', 'evidence'],
    indexed: ['configHash', 'state'],
    answers: 'What is the approved system right now, and on what evidence was it approved?'
  },
  challengers: {
    required: ['recordId', 'configHash', 'state', 'createdAt', 'baselineConfigHash'],
    indexed: ['configHash', 'state'],
    answers: 'What is being tried, against which champion?'
  },
  performance: {
    required: ['scope', 'key', 'metrics', 'sampleSize'],
    indexed: ['scope', 'key'],
    answers: 'How does this strategy / regime / Jev band / asset actually perform?'
  },

  // ---- operations ----------------------------------------------------------
  mode_events: {
    required: ['ts', 'fromMode', 'toMode', 'direction', 'principalKind', 'approvalId'],
    indexed: ['direction'],
    answers: 'Who changed the execution mode, when, and under which approval?'
  },
  system_events: {
    required: ['ts', 'kind', 'severity', 'message'],
    indexed: ['kind', 'severity'],
    answers: 'What happened to the system itself — emergency stops, data gaps, failures.'
  },
  agent_activity: {
    required: ['ts', 'agent', 'action', 'outcome'],
    indexed: ['agent', 'action'],
    answers: 'Which agent did what, and did it succeed?'
  },
  health_checks: {
    required: ['ts', 'check', 'status', 'detail'],
    indexed: ['check', 'status'],
    answers: 'Was the system healthy while it was making these decisions?'
  }
});

var TABLE_NAMES = Object.freeze(Object.keys(TABLES));

function isTable(name) {
  return Object.prototype.hasOwnProperty.call(TABLES, name);
}

function definition(name) {
  if (!isTable(name)) {
    throw new Error('unknown table ' + JSON.stringify(name) + '; known tables: ' + TABLE_NAMES.join(', '));
  }
  return TABLES[name];
}

module.exports = {
  TABLES: TABLES,
  TABLE_NAMES: TABLE_NAMES,
  isTable: isTable,
  definition: definition
};
