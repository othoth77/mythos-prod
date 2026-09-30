'use strict';
// =====================================================
// MYTHOS TRADING AGENT — enumerations
// projects/mythos-trading-agent/src/core/enums.js
//
// Every value the platform persists or branches on is named here once, so a
// typo becomes a thrown error rather than a silently-never-taken branch. The
// backtest/paper/live boundary in particular is an enum and not a boolean:
// a boolean has two states and this system has three, the third of which must
// never be reachable without an owner-approval record (see src/mode/).
// =====================================================

function frozen(obj) {
  return Object.freeze(obj);
}

/** Execution mode. Default BACKTEST. LIVE is refused by the live adapter. */
var Mode = frozen({
  BACKTEST: 'BACKTEST',
  PAPER: 'PAPER',
  LIVE: 'LIVE'
});

/** Market regime classes (mission §5). Direction is carried separately. */
var Regime = frozen({
  TREND: 'TREND',
  RANGE: 'RANGE',
  BREAKOUT: 'BREAKOUT',
  HIGH_VOLATILITY: 'HIGH_VOLATILITY',
  LOW_VOLATILITY: 'LOW_VOLATILITY',
  UNSTABLE: 'UNSTABLE'
});

/** Direction of a regime or a candidate. NEUTRAL is only valid for a regime. */
var Direction = frozen({
  LONG: 'LONG',
  SHORT: 'SHORT',
  NEUTRAL: 'NEUTRAL'
});

/** Jev gate decision. NO TRADE (REJECT) is a valid, recorded decision. */
var JevDecision = frozen({
  ENTER: 'ENTER',
  REJECT: 'REJECT'
});

/** Terminal verdict of the whole decision pipeline for one candidate. */
var PipelineDecision = frozen({
  ENTER: 'ENTER',
  NO_TRADE: 'NO_TRADE'
});

/** Which stage produced a NO_TRADE. Answers "why did it reject?". */
var PipelineStage = frozen({
  DATA: 'DATA',
  SCHEDULE: 'SCHEDULE',
  REGIME: 'REGIME',
  STRATEGY: 'STRATEGY',
  JEV: 'JEV',
  COST: 'COST',
  RISK: 'RISK',
  RECOVERY: 'RECOVERY',
  ONE_TRADE: 'ONE_TRADE',
  EXECUTION: 'EXECUTION'
});

var OrderType = frozen({
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP: 'STOP'
});

var OrderStatus = frozen({
  PENDING: 'PENDING',
  FILLED: 'FILLED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
});

var PositionStatus = frozen({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
});

var TradeOutcome = frozen({
  WIN: 'WIN',
  LOSS: 'LOSS',
  BREAKEVEN: 'BREAKEVEN'
});

/** Why a position closed. Recorded on every trade. */
var ExitReason = frozen({
  TAKE_PROFIT: 'TAKE_PROFIT',
  STOP_LOSS: 'STOP_LOSS',
  TIME_STOP: 'TIME_STOP',
  SESSION_CLOSE: 'SESSION_CLOSE',
  EMERGENCY_STOP: 'EMERGENCY_STOP',
  END_OF_DATA: 'END_OF_DATA'
});

/**
 * Risk Engine verdicts. The Risk Engine has final authority: no other
 * component may turn BLOCK into ALLOW. CLAMP means "allowed, but at the size
 * the Risk Engine chose" — never at the size the caller asked for.
 */
var RiskVerdict = frozen({
  ALLOW: 'ALLOW',
  CLAMP: 'CLAMP',
  BLOCK: 'BLOCK'
});

/** Instrument asset classes the data/cost model understands. */
var AssetClass = frozen({
  FX: 'FX',
  METAL: 'METAL',
  CRYPTO: 'CRYPTO',
  INDEX: 'INDEX',
  FUTURE: 'FUTURE'
});

/**
 * How an instrument's quote currency converts to the account currency.
 * DIRECT  — quote currency IS the account currency (EURUSD on a USD account).
 * INVERSE — base currency is the account currency (USDJPY on a USD account),
 *           so the conversion rate is 1/price.
 * FIXED   — a constant rate carried on the instrument (documented estimate).
 */
var QuoteConversion = frozen({
  DIRECT: 'DIRECT',
  INVERSE: 'INVERSE',
  FIXED: 'FIXED'
});

/** Champion/challenger lifecycle states. */
var ContenderState = frozen({
  CHAMPION: 'CHAMPION',
  CHALLENGER: 'CHALLENGER',
  PROMOTED: 'PROMOTED',
  RETIRED: 'RETIRED',
  REJECTED: 'REJECTED'
});

/** Research pipeline states (mission §12). */
var HypothesisState = frozen({
  OBSERVATION: 'OBSERVATION',
  HYPOTHESIS: 'HYPOTHESIS',
  PROPOSAL: 'PROPOSAL',
  BACKTESTED: 'BACKTESTED',
  STRESSED: 'STRESSED',
  DEMO: 'DEMO',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED'
});

var LogLevel = frozen({
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
});

/** Standard timeframes, expressed in minutes. */
var Timeframe = frozen({
  M1: 'M1',
  M5: 'M5',
  M15: 'M15',
  M30: 'M30',
  H1: 'H1',
  H4: 'H4',
  D1: 'D1'
});

var TIMEFRAME_MINUTES = frozen({
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440
});

/** Returns the enum's values as an array. */
function values(enumObj) {
  return Object.keys(enumObj).map(function (k) { return enumObj[k]; });
}

/** True when `v` is one of the enum's values. */
function isValid(enumObj, v) {
  return values(enumObj).indexOf(v) !== -1;
}

/**
 * Throws unless `v` belongs to `enumObj`. Used at every boundary that accepts
 * an enum from configuration, a fixture or another component.
 */
function assertEnum(enumObj, v, label) {
  if (!isValid(enumObj, v)) {
    throw new TypeError(
      (label || 'value') + ' must be one of [' + values(enumObj).join(', ') +
      '], got ' + JSON.stringify(v)
    );
  }
  return v;
}

module.exports = {
  Mode: Mode,
  Regime: Regime,
  Direction: Direction,
  JevDecision: JevDecision,
  PipelineDecision: PipelineDecision,
  PipelineStage: PipelineStage,
  OrderType: OrderType,
  OrderStatus: OrderStatus,
  PositionStatus: PositionStatus,
  TradeOutcome: TradeOutcome,
  ExitReason: ExitReason,
  RiskVerdict: RiskVerdict,
  AssetClass: AssetClass,
  QuoteConversion: QuoteConversion,
  ContenderState: ContenderState,
  HypothesisState: HypothesisState,
  LogLevel: LogLevel,
  Timeframe: Timeframe,
  TIMEFRAME_MINUTES: TIMEFRAME_MINUTES,
  values: values,
  isValid: isValid,
  assertEnum: assertEnum
};
