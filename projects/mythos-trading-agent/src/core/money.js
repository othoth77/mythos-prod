'use strict';
// =====================================================
// MYTHOS TRADING AGENT — money and quantity arithmetic
// projects/mythos-trading-agent/src/core/money.js
//
// A $100 account trading 0.01 lots produces P&L figures in cents. Binary
// floating point accumulates visible error at that scale, and a backtest whose
// equity curve drifts is not reproducible, so every value that enters the
// ledger is rounded at a declared precision here rather than wherever it
// happened to be computed.
//
// Rounding is HALF-AWAY-FROM-ZERO, not JavaScript's Math.round (which is
// half-up and therefore asymmetric for negatives: Math.round(-0.5) === -0
// while Math.round(0.5) === 1). A P&L ledger that rounds losses differently
// from wins is a bias, so we make it symmetric.
// =====================================================

/** Ledger precision: 1/100 of a cent. Small enough for 0.01-lot FX P&L. */
var MONEY_DP = 4;

/** Lot precision. 0.01 is the smallest tradable size in this platform. */
var LOT_DP = 2;

function isFiniteNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

function assertNumber(v, label) {
  if (!isFiniteNumber(v)) {
    throw new TypeError((label || 'value') + ' must be a finite number, got ' + JSON.stringify(v));
  }
  return v;
}

/**
 * Rounds `v` to `dp` decimals, half away from zero.
 *
 * The 1e-9 epsilon compensates for representations that land just below the
 * .5 boundary (1.005 is stored as 1.00499999999999989), which would otherwise
 * round down and make `round(1.005, 2)` disagree with arithmetic done by hand.
 */
function round(v, dp) {
  assertNumber(v, 'round(v)');
  var p = typeof dp === 'number' ? dp : MONEY_DP;
  var f = Math.pow(10, p);
  var scaled = v * f;
  var eps = Math.abs(scaled) * 1e-12 + 1e-9;
  var r = scaled >= 0
    ? Math.floor(scaled + 0.5 + eps)
    : -Math.floor(-scaled + 0.5 + eps);
  var out = r / f;
  // Normalise -0 to 0 so JSON and equality comparisons stay stable.
  return out === 0 ? 0 : out;
}

/** Rounds a money amount to ledger precision. */
function money(v) {
  return round(v, MONEY_DP);
}

/** Rounds to whole cents — for display and for reported metrics only. */
function cents(v) {
  return round(v, 2);
}

/**
 * Rounds a lot size DOWN to the instrument's lot step. Sizing always rounds
 * down: rounding a risk-derived size up would silently exceed the risk budget
 * the Risk Engine approved.
 */
function floorToStep(v, step) {
  assertNumber(v, 'floorToStep(v)');
  assertNumber(step, 'floorToStep(step)');
  if (step <= 0) throw new RangeError('lot step must be > 0, got ' + step);
  var n = Math.floor(round(v / step, 9) + 1e-9);
  return round(n * step, LOT_DP + 4);
}

/** Rounds a lot size to lot precision (for comparison and persistence). */
function lots(v) {
  return round(v, LOT_DP);
}

/** Clamps `v` into [lo, hi]. Throws when the range is inverted. */
function clamp(v, lo, hi) {
  assertNumber(v, 'clamp(v)');
  assertNumber(lo, 'clamp(lo)');
  assertNumber(hi, 'clamp(hi)');
  if (lo > hi) throw new RangeError('clamp range inverted: [' + lo + ', ' + hi + ']');
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Sums an array at ledger precision, rounding once at the end. */
function sum(list) {
  var t = 0;
  for (var i = 0; i < list.length; i++) t += assertNumber(list[i], 'sum[' + i + ']');
  return money(t);
}

/** True when a and b agree to `dp` decimals. */
function eq(a, b, dp) {
  return round(a, dp === undefined ? MONEY_DP : dp) === round(b, dp === undefined ? MONEY_DP : dp);
}

/**
 * Percentage of `base` represented by `part`, as a fraction (0.05 === 5 %).
 * A zero base yields 0 rather than Infinity — a drawdown on an account that
 * never had equity is not an infinite drawdown, it is an absent measurement.
 */
function fraction(part, base) {
  assertNumber(part, 'fraction(part)');
  assertNumber(base, 'fraction(base)');
  if (base === 0) return 0;
  return part / base;
}

module.exports = {
  MONEY_DP: MONEY_DP,
  LOT_DP: LOT_DP,
  round: round,
  money: money,
  cents: cents,
  lots: lots,
  floorToStep: floorToStep,
  clamp: clamp,
  sum: sum,
  eq: eq,
  fraction: fraction,
  isFiniteNumber: isFiniteNumber,
  assertNumber: assertNumber
};
