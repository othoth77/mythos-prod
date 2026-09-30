'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Risk Engine
// projects/mythos-trading-agent/src/risk/engine.js
//
// Mission §8: "Risk Engine ALWAYS has final authority. Neither Jev nor any AI
// agent can bypass Risk Engine."
//
// THIS MODULE IS THE LAST WRITER OF POSITION SIZE. Nothing downstream may use a
// size it did not return. The recovery ladder, a strategy, or an agent may
// REQUEST a size; this engine returns `approvedLots` and the executor takes that
// and nothing else (src/backtest/engine.js reads only the approved figure).
//
// THE THREE VERDICTS, AND WHY CLAMP EXISTS
//
//   ALLOW — the requested size is inside every limit.
//   CLAMP — allowed, but at the size THIS ENGINE chose, which is smaller.
//   BLOCK — no trade at any size.
//
// CLAMP is the common case on a $100 account and it is deliberately a distinct
// verdict rather than a silent adjustment, because "the ladder asked for 0.09 and
// got 0.01" is the single most important fact about how the recovery option
// behaves at this account size (ADR-0002). Hiding it inside an ALLOW would make
// the recovery research meaningless.
//
// THE LIMITS ARE CHECKED IN TWO PLACES ON PURPOSE
//
//   preTradeGate()  — account-level state that forbids trading AT ALL right now:
//                     emergency stop, max drawdown, daily loss, losing streak.
//   assess()        — candidate-level sizing and structural limits.
//
// They are separate because the first is a reason to stop for the day and the
// second is a reason to skip one setup, and conflating them makes the audit trail
// unable to distinguish "the account is hurt" from "this trade is wrong".
//
// EVERY CHECK RECORDS ITS NUMBERS. mission §17 asks "why did Risk Engine block
// it?" — `limitsChecked` answers with the observed value, the limit value and
// whether it bound. A boolean would not be an answer.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var instrumentMod = require('../core/instrument');

/** Reason codes. Stable strings — they are persisted and analysed. */
var Reason = Object.freeze({
  // account-level blocks
  EMERGENCY_STOP_ACTIVE: 'EMERGENCY_STOP_ACTIVE',
  MAX_DRAWDOWN_REACHED: 'MAX_DRAWDOWN_REACHED',
  DAILY_LOSS_LIMIT_REACHED: 'DAILY_LOSS_LIMIT_REACHED',
  MAX_CONSECUTIVE_LOSSES_REACHED: 'MAX_CONSECUTIVE_LOSSES_REACHED',
  ACCOUNT_EQUITY_EXHAUSTED: 'ACCOUNT_EQUITY_EXHAUSTED',
  // candidate-level blocks
  SPREAD_ABOVE_LIMIT: 'SPREAD_ABOVE_LIMIT',
  STOP_BELOW_MINIMUM: 'STOP_BELOW_MINIMUM',
  STOP_ABOVE_MAXIMUM: 'STOP_ABOVE_MAXIMUM',
  REWARD_RISK_BELOW_MINIMUM: 'REWARD_RISK_BELOW_MINIMUM',
  NET_EXPECTANCY_NOT_POSITIVE: 'NET_EXPECTANCY_NOT_POSITIVE',
  SIZE_BELOW_MINIMUM: 'SIZE_BELOW_MINIMUM',
  RECOVERY_LEVEL_EXCEEDED: 'RECOVERY_LEVEL_EXCEEDED',
  // clamps
  MAX_ACCOUNT_RISK_PER_TRADE: 'MAX_ACCOUNT_RISK_PER_TRADE',
  MAX_POSITION_SIZE: 'MAX_POSITION_SIZE',
  INSTRUMENT_MAX_LOT: 'INSTRUMENT_MAX_LOT',
  DAILY_LOSS_HEADROOM: 'DAILY_LOSS_HEADROOM',
  DRAWDOWN_HEADROOM: 'DRAWDOWN_HEADROOM',
  // allow
  WITHIN_ALL_LIMITS: 'WITHIN_ALL_LIMITS'
});

/**
 * @param {object} spec
 * @param {object} spec.config validated platform config
 * @param {object} [spec.logger]
 * @param {object} [spec.store]
 */
function create(spec) {
  var config = spec.config;
  var risk = config.risk;
  var logger = spec.logger || require('../core/logger').nullLogger();
  var store = spec.store || null;

  // An emergency stop raised at runtime. Once true it never returns to false
  // within a run: a kill switch a later decision could reset would not be one.
  var emergencyStopped = config.risk.emergencyStop === true;
  var emergencyReason = emergencyStopped ? 'CONFIGURED_EMERGENCY_STOP' : null;

  function limit(name, observed, limitValue, binding) {
    return { limit: name, observed: observed, limitValue: limitValue, binding: !!binding };
  }

  /**
   * Account-level check: may the system open ANY trade right now?
   *
   * @param {object} q
   * @param {object} q.account
   * @param {number} q.ts
   * @returns {{allowed, reasonCodes, limitsChecked, escalate}}
   */
  function preTradeGate(q) {
    var account = q.account;
    var snap = account.snapshot();
    var checks = [];
    var reasons = [];

    var ddPct = snap.drawdownPct;
    checks.push(limit('MAX_DRAWDOWN_PCT', ddPct, risk.maxDrawdownPct, ddPct >= risk.maxDrawdownPct));
    if (ddPct >= risk.maxDrawdownPct) reasons.push(Reason.MAX_DRAWDOWN_REACHED);

    var dailyLossPct = account.dailyLossPct(q.ts);
    checks.push(limit('MAX_DAILY_LOSS_PCT', dailyLossPct, risk.maxDailyLossPct, dailyLossPct >= risk.maxDailyLossPct));
    if (dailyLossPct >= risk.maxDailyLossPct) reasons.push(Reason.DAILY_LOSS_LIMIT_REACHED);

    var streak = snap.consecutiveLosses;
    checks.push(limit('MAX_CONSECUTIVE_LOSSES', streak, risk.maxConsecutiveLosses, streak >= risk.maxConsecutiveLosses));
    if (streak >= risk.maxConsecutiveLosses) reasons.push(Reason.MAX_CONSECUTIVE_LOSSES_REACHED);

    checks.push(limit('EMERGENCY_STOP', emergencyStopped, false, emergencyStopped));
    if (emergencyStopped) reasons.push(Reason.EMERGENCY_STOP_ACTIVE);

    if (!(snap.equity > 0)) reasons.push(Reason.ACCOUNT_EQUITY_EXHAUSTED);

    return {
      allowed: reasons.length === 0,
      reasonCodes: reasons,
      limitsChecked: checks,
      // A drawdown breach is not a bad day, it is the end of the run.
      escalate: reasons.indexOf(Reason.MAX_DRAWDOWN_REACHED) !== -1,
      accountEquity: snap.equity
    };
  }

  /**
   * Candidate-level assessment. Returns the size this engine approves, which may
   * be smaller than the one requested and may be none at all.
   *
   * @param {object} q
   * @param {object} q.candidate
   * @param {object} q.instrument
   * @param {object} q.account
   * @param {number} q.requestedLots what the caller WANTS (recovery or base size)
   * @param {number} q.ts
   * @param {number} [q.recoveryLevel=0]
   * @param {number} [q.price] reference price; defaults to the candidate entry
   */
  function assess(q) {
    var c = q.candidate;
    var inst = q.instrument;
    var account = q.account;
    var price = q.price === undefined ? c.entry : q.price;
    var snap = account.snapshot();
    var checks = [];
    var reasons = [];
    var requested = q.requestedLots;

    if (!(requested > 0)) {
      throw errors.RiskAuthorityViolation(
        'assess() needs a positive requestedLots; a caller with no size to request must not reach the Risk Engine',
        { requestedLots: requested }
      );
    }

    // ---- 1. account-level gate ---------------------------------------
    var gate = preTradeGate({ account: account, ts: q.ts });
    checks = checks.concat(gate.limitsChecked);
    if (!gate.allowed) {
      return verdict(enums.RiskVerdict.BLOCK, 0, gate.reasonCodes, checks, {
        requestedLots: requested, accountEquity: snap.equity, stage: 'ACCOUNT'
      });
    }

    // ---- 2. structural limits ----------------------------------------
    var spreadLimit = inst.typicalSpreadPips * risk.maxSpreadMultiple;
    checks.push(limit('MAX_SPREAD_PIPS', c.spreadPips, spreadLimit, c.spreadPips > spreadLimit));
    if (c.spreadPips > spreadLimit) reasons.push(Reason.SPREAD_ABOVE_LIMIT);

    checks.push(limit('MIN_STOP_PIPS', c.riskPips, risk.minStopPips, c.riskPips < risk.minStopPips));
    if (c.riskPips < risk.minStopPips) reasons.push(Reason.STOP_BELOW_MINIMUM);

    checks.push(limit('MAX_STOP_PIPS', c.riskPips, risk.maxStopPips, c.riskPips > risk.maxStopPips));
    if (c.riskPips > risk.maxStopPips) reasons.push(Reason.STOP_ABOVE_MAXIMUM);

    var netRR = c.netRewardRisk === null ? 0 : c.netRewardRisk;
    checks.push(limit('MIN_REWARD_RISK', netRR, risk.minRewardRisk, netRR < risk.minRewardRisk));
    if (netRR < risk.minRewardRisk) reasons.push(Reason.REWARD_RISK_BELOW_MINIMUM);

    checks.push(limit('MIN_NET_EXPECTED_VALUE', c.expectedNetPips, risk.minNetExpectedValue,
      c.expectedNetPips <= risk.minNetExpectedValue));
    if (c.expectedNetPips <= risk.minNetExpectedValue) reasons.push(Reason.NET_EXPECTANCY_NOT_POSITIVE);

    var recoveryLevel = q.recoveryLevel || 0;
    checks.push(limit('MAX_RECOVERY_LEVEL', recoveryLevel, config.recovery.maxRecoveryLevel,
      recoveryLevel > config.recovery.maxRecoveryLevel));
    if (recoveryLevel > config.recovery.maxRecoveryLevel) reasons.push(Reason.RECOVERY_LEVEL_EXCEEDED);

    if (reasons.length) {
      return verdict(enums.RiskVerdict.BLOCK, 0, reasons, checks, {
        requestedLots: requested, accountEquity: snap.equity, stage: 'STRUCTURAL'
      });
    }

    // ---- 3. sizing ----------------------------------------------------
    // The risk budget is the SMALLEST of three allowances, so a trade can never
    // be sized to breach a limit that a later trade would have to honour anyway.
    var perTradeBudget = money.money(snap.equity * risk.maxAccountRiskPerTradePct / 100);

    var dailyUsed = account.dailyLossMoney(q.ts);
    var dailyAllowance = money.money(snap.initialCapital * risk.maxDailyLossPct / 100);
    var dailyHeadroom = money.money(Math.max(0, dailyAllowance - dailyUsed));

    var drawdownAllowance = money.money(snap.peakEquity * risk.maxDrawdownPct / 100);
    var drawdownUsed = money.money(snap.peakEquity - snap.equity);
    var drawdownHeadroom = money.money(Math.max(0, drawdownAllowance - drawdownUsed));

    var budget = Math.min(perTradeBudget, dailyHeadroom, drawdownHeadroom);
    var budgetSource = budget === perTradeBudget ? Reason.MAX_ACCOUNT_RISK_PER_TRADE
      : (budget === dailyHeadroom ? Reason.DAILY_LOSS_HEADROOM : Reason.DRAWDOWN_HEADROOM);

    checks.push(limit('RISK_BUDGET_MONEY', money.round(budget, 4), money.round(perTradeBudget, 4), budget < perTradeBudget));
    checks.push(limit('DAILY_LOSS_HEADROOM_MONEY', dailyHeadroom, dailyAllowance, dailyHeadroom < perTradeBudget));
    checks.push(limit('DRAWDOWN_HEADROOM_MONEY', drawdownHeadroom, drawdownAllowance, drawdownHeadroom < perTradeBudget));

    var maxLotsByRisk = instrumentMod.lotsForRisk(inst, budget, c.riskPips, price);
    var caps = [
      { lots: maxLotsByRisk, reason: budgetSource },
      { lots: risk.maxPositionSizeLots, reason: Reason.MAX_POSITION_SIZE },
      { lots: inst.maxLot, reason: Reason.INSTRUMENT_MAX_LOT }
    ];

    var approved = requested;
    var binding = [];
    caps.forEach(function (cap) {
      if (cap.lots < approved) {
        approved = cap.lots;
        binding = [cap.reason];
      } else if (cap.lots === approved && approved < requested) {
        binding.push(cap.reason);
      }
    });
    approved = money.floorToStep(approved, inst.lotStep);

    checks.push(limit('MAX_LOTS_BY_RISK', maxLotsByRisk, maxLotsByRisk, maxLotsByRisk < requested));
    checks.push(limit('MAX_POSITION_SIZE_LOTS', requested, risk.maxPositionSizeLots, requested > risk.maxPositionSizeLots));
    checks.push(limit('INSTRUMENT_MAX_LOT', requested, inst.maxLot, requested > inst.maxLot));
    checks.push(limit('INSTRUMENT_MIN_LOT', approved, inst.minLot, approved < inst.minLot));

    // ---- 4. verdict ---------------------------------------------------
    if (approved < inst.minLot) {
      // The honest and common answer on a $100 account: the smallest tradable
      // size already risks more than the budget allows. NO TRADE.
      return verdict(enums.RiskVerdict.BLOCK, 0, [Reason.SIZE_BELOW_MINIMUM].concat(binding), checks, {
        requestedLots: requested,
        accountEquity: snap.equity,
        riskBudgetMoney: money.round(budget, 4),
        riskAtMinLot: instrumentMod.riskMoneyForLots(inst, inst.minLot, c.riskPips, price),
        stage: 'SIZING'
      });
    }

    var approvedRisk = instrumentMod.riskMoneyForLots(inst, approved, c.riskPips, price);
    var isClamped = approved < requested;
    return verdict(
      isClamped ? enums.RiskVerdict.CLAMP : enums.RiskVerdict.ALLOW,
      approved,
      isClamped ? binding : [Reason.WITHIN_ALL_LIMITS],
      checks,
      {
        requestedLots: requested,
        accountEquity: snap.equity,
        riskBudgetMoney: money.round(budget, 4),
        approvedRiskMoney: approvedRisk,
        approvedRiskPct: money.round(money.fraction(approvedRisk, snap.equity) * 100, 4),
        stage: 'SIZING'
      }
    );
  }

  function verdict(v, approvedLots, reasonCodes, checks, extra) {
    var out = {
      verdict: v,
      approvedLots: approvedLots,
      reasonCodes: reasonCodes,
      limitsChecked: checks
    };
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    return out;
  }

  /**
   * Per-bar monitoring. Called from the engine's onBar hook, which runs whether
   * or not a decision was requested — a kill switch that only fired when the slot
   * was free could not fire while a position was open, which is when it matters.
   *
   * @returns {{emergencyStop: boolean, reason: string|null, checks: Array}}
   */
  function monitor(q) {
    var gate = preTradeGate({ account: q.account, ts: q.ts });
    if (gate.escalate && !emergencyStopped) {
      raiseEmergencyStop('MAX_DRAWDOWN_REACHED at ' + money.round(q.account.snapshot().drawdownPct, 3) + '%');
    }
    return {
      emergencyStop: emergencyStopped,
      reason: emergencyReason,
      allowed: gate.allowed,
      reasonCodes: gate.reasonCodes,
      checks: gate.limitsChecked
    };
  }

  function raiseEmergencyStop(reason) {
    if (emergencyStopped) return false;
    emergencyStopped = true;
    emergencyReason = reason;
    logger.error('risk.emergency_stop', { reason: reason });
    if (store) {
      store.table('system_events').insert({
        ts: null, kind: 'RISK_EMERGENCY_STOP', severity: 'ERROR', message: reason
      });
    }
    return true;
  }

  /**
   * Records an assessment into the store. Separate from assess() so a research
   * caller can evaluate without writing, and so the engine has no opinion about
   * when persistence happens.
   */
  function persist(storeRef, candidateId, ts, assessment) {
    storeRef.table('risk_assessments').insert({
      candidateId: candidateId,
      ts: ts,
      verdict: assessment.verdict,
      requestedLots: assessment.requestedLots,
      approvedLots: assessment.approvedLots,
      reasonCodes: assessment.reasonCodes,
      limitsChecked: assessment.limitsChecked,
      accountEquity: assessment.accountEquity,
      riskBudgetMoney: assessment.riskBudgetMoney === undefined ? null : assessment.riskBudgetMoney,
      approvedRiskMoney: assessment.approvedRiskMoney === undefined ? null : assessment.approvedRiskMoney,
      stage: assessment.stage
    });
    return assessment;
  }

  return {
    Reason: Reason,
    assess: assess,
    preTradeGate: preTradeGate,
    monitor: monitor,
    persist: persist,
    raiseEmergencyStop: raiseEmergencyStop,
    isEmergencyStopped: function () { return emergencyStopped; },
    emergencyReason: function () { return emergencyReason; },
    /** The configured limits, for reports and for the approval record. */
    limits: function () {
      return {
        maxAccountRiskPerTradePct: risk.maxAccountRiskPerTradePct,
        maxPositionSizeLots: risk.maxPositionSizeLots,
        maxOpenTrades: risk.maxOpenTrades,
        maxDailyLossPct: risk.maxDailyLossPct,
        maxDrawdownPct: risk.maxDrawdownPct,
        maxConsecutiveLosses: risk.maxConsecutiveLosses,
        maxSpreadMultiple: risk.maxSpreadMultiple,
        maxSlippageMultiple: risk.maxSlippageMultiple,
        minStopPips: risk.minStopPips,
        maxStopPips: risk.maxStopPips,
        minRewardRisk: risk.minRewardRisk,
        minNetExpectedValue: risk.minNetExpectedValue,
        maxRecoveryLevel: config.recovery.maxRecoveryLevel,
        emergencyStop: risk.emergencyStop
      };
    }
  };
}

module.exports = {
  create: create,
  Reason: Reason
};
