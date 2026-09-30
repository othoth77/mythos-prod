'use strict';
// =====================================================
// MYTHOS TRADING AGENT — cost model
// projects/mythos-trading-agent/src/cost/model.js
//
// Mission §9: "Never report gross profit as final profitability." This module
// is how that rule is kept, and the design decision behind it is deliberate:
//
//   COSTS ARE EXPLICIT MONEY DEDUCTIONS. They are never hidden inside a fill
//   price.
//
// The alternative — quoting bid/ask and letting the spread disappear into the
// entry and exit prices — is more realistic in the second decimal place and
// much worse for the thing this platform is for. A trade record here carries
// grossPnl, spreadMoney, commissionMoney, slippageMoney, swapMoney and netPnl
// as separate fields, so the question "did costs eat the edge?" is a column
// sum rather than an inference. On a $100 account taking 0.01-lot trades with
// 15-pip stops, the spread is roughly 8 % of the risk per trade; it deserves to
// be visible.
//
// THE APPROXIMATION THIS BUYS, stated plainly: bars are treated as mid prices
// and stop/target triggers are evaluated against mid highs and lows. A real
// long exits on the bid, so its stop triggers about half a spread earlier than
// modelled and its target about half a spread later. The round-trip spread is
// still charged in full, so the P&L is right and only the trigger INSTANT is
// approximate. Recorded in docs/COMPLIANCE_AND_RISK.md §3.3.
//
// Every figure this module uses comes from config/instruments.json, where it is
// a documented estimate rather than a named venue's schedule — the single
// largest source of optimism in any result this platform produces.
// =====================================================

var instrumentMod = require('../core/instrument');
var money = require('../core/money');
var clock = require('../core/clock');
var enums = require('../core/enums');
var errors = require('../core/errors');

/**
 * Session widening factors applied to the typical spread, by UTC hour.
 * The 21:00-23:00 band is the daily rollover, when retail spreads routinely
 * triple. Documented estimate, not a measurement.
 */
function sessionSpreadFactor(ts) {
  var h = clock.hour(ts);
  var dow = clock.weekday(ts);
  if (dow === 0) return 3.0;                 // Sunday reopen — the widest hour of the week
  if (h >= 21 || h < 1) return 2.2;          // rollover
  if (h >= 1 && h < 6) return 1.5;           // thin Asian session
  return 1.0;
}

/**
 * @param {object} config validated platform config
 * @param {object} [opts]
 * @param {object} [opts.rng] seeded generator for the gaussian slippage model;
 *        required when cost.slippageModel === 'gaussian'
 */
function create(config, opts) {
  var o = opts || {};
  var cfg = config.cost;
  var gen = o.rng || null;

  if (cfg.slippageModel === 'gaussian' && !gen) {
    throw errors.ConfigError('cost.slippageModel "gaussian" needs a seeded RNG; pass { rng } so results stay reproducible');
  }

  /**
   * Spread in pips at a moment.
   *
   * @param {object} inst
   * @param {object} ctx
   * @param {number} ctx.ts
   * @param {number} [ctx.volatilityRatio] current ATR / average ATR; widens the
   *        spread when the market is moving, which is when it really widens
   * @param {number} [ctx.barRangePips] used by the 'bar-derived' model
   */
  function spreadPips(inst, ctx) {
    var base;
    if (cfg.spreadModel === 'fixed') {
      base = cfg.fixedSpreadPips;
    } else if (cfg.spreadModel === 'bar-derived') {
      // A common proxy when only OHLC is available: a fraction of the bar range,
      // floored at the instrument's typical spread.
      var derived = (ctx.barRangePips || 0) * 0.15;
      base = Math.max(inst.typicalSpreadPips, derived);
    } else {
      base = inst.typicalSpreadPips;
    }

    var factor = sessionSpreadFactor(ctx.ts);
    if (typeof ctx.volatilityRatio === 'number' && isFinite(ctx.volatilityRatio)) {
      var vr = money.clamp(ctx.volatilityRatio, 0.5, 4);
      factor *= 1 + 0.6 * (vr - 1);
    }
    var out = base * factor;
    // Never below the instrument's typical spread, never above its stated
    // maximum — the maximum is what the Risk Engine's MAX_SPREAD limit is
    // expressed against, so the model must not silently exceed it.
    return money.clamp(out, inst.typicalSpreadPips, inst.maxSpreadPips);
  }

  /**
   * Slippage in pips for one side of a trade. ALWAYS non-negative: this model
   * never grants positive slippage. Real execution sometimes improves, but a
   * backtest that models favourable slippage is choosing to be optimistic about
   * the one thing it cannot observe.
   *
   * @param {string} kind 'ENTRY' | 'STOP' | 'TARGET'
   */
  function slippagePips(inst, kind) {
    if (cfg.slippageModel === 'none') return 0;
    if (cfg.slippageModel === 'fixed') {
      return kind === 'TARGET' ? 0 : cfg.fixedSlippagePips;
    }
    // gaussian
    if (kind === 'TARGET') return 0; // a resting limit fills at its price or better
    var s = inst.slippagePips;
    // Stops are hit when the market is moving against the position, so they slip
    // harder than a discretionary entry. 1.6x is a documented estimate.
    var scale = kind === 'STOP' ? 1.6 : 1;
    var draw = Math.abs(gen.normal(s.mean * scale, s.sd * scale));
    return money.clamp(draw, 0, s.max * scale);
  }

  /** Money value of a pip distance for a position size. */
  function pipsToMoney(inst, pips, lots, price) {
    return money.money(pips * lots * instrumentMod.pipValuePerLot(inst, price));
  }

  /** Round-trip spread cost: the spread is paid once, on the round trip. */
  function spreadMoney(inst, pips, lots, price) {
    return pipsToMoney(inst, pips, lots, price);
  }

  /** Round-trip commission (both sides). */
  function commissionMoney(inst, lots) {
    if (!cfg.includeCommission) return 0;
    return money.money(inst.commissionPerLotPerSide * lots * 2);
  }

  /**
   * Swap for holding across `nights` rollovers. Sign convention: the returned
   * value is a COST, so a positive carry (which the account earns) is negative.
   */
  function swapMoney(inst, direction, lots, nights) {
    if (!cfg.includeSwap || nights <= 0) return 0;
    enums.assertEnum(enums.Direction, direction, 'direction');
    var perLot = direction === enums.Direction.LONG ? inst.swapLongPerLotPerDay : inst.swapShortPerLotPerDay;
    return money.money(-perLot * lots * nights);
  }

  /**
   * Number of rollovers crossed between two instants.
   *
   * Every rollover instant in the interval is counted, including weekend ones.
   * FX does not roll over on a closed weekend, so this OVERSTATES the swap cost
   * by at most two nights per weekend a position is held. That is the direction
   * a backtest should err, and a one-trade-only system holding through a
   * weekend is rare enough that the overcount is not worth a calendar.
   *
   * Triple swap on the configured weekday (Wednesday, by venue convention) is
   * NOT modelled. Recorded in docs/COMPLIANCE_AND_RISK.md rather than silently
   * assumed away.
   */
  function nightsHeld(entryTs, exitTs) {
    if (exitTs <= entryTs) return 0;
    var h = cfg.swapChargeHoursUtc;
    var d = new Date(entryTs);
    var roll = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0, 0, 0);
    if (roll <= entryTs) roll += clock.DAY;
    var count = 0;
    while (roll <= exitTs) { count++; roll += clock.DAY; }
    return count;
  }

  /**
   * Full round-trip breakdown for a position.
   *
   * @param {object} spec
   * @param {object} spec.instrument
   * @param {string} spec.direction
   * @param {number} spec.lots
   * @param {number} spec.price reference price for pip valuation
   * @param {number} spec.spreadPips
   * @param {number} [spec.entrySlippagePips=0]
   * @param {number} [spec.exitSlippagePips=0]
   * @param {number} [spec.nights=0]
   * @returns {{spreadMoney, commissionMoney, slippageMoney, swapMoney, totalMoney, ...}}
   */
  function roundTrip(spec) {
    var inst = spec.instrument;
    var lots = spec.lots;
    var price = spec.price;
    var sp = spreadMoney(inst, spec.spreadPips, lots, price);
    var com = commissionMoney(inst, lots);
    var slipPips = (spec.entrySlippagePips || 0) + (spec.exitSlippagePips || 0);
    var slip = pipsToMoney(inst, slipPips, lots, price);
    var swap = swapMoney(inst, spec.direction, lots, spec.nights || 0);
    return {
      spreadPips: spec.spreadPips,
      spreadMoney: sp,
      commissionMoney: com,
      slippagePips: slipPips,
      slippageMoney: slip,
      swapMoney: swap,
      nights: spec.nights || 0,
      totalMoney: money.money(sp + com + slip + swap)
    };
  }

  /**
   * Pre-trade estimate used by the cost filter, before an entry exists. Assumes
   * the mean slippage rather than a draw, so the filter's decision does not
   * depend on a random number.
   */
  function estimate(spec) {
    var inst = spec.instrument;
    var s = inst.slippagePips;
    var entrySlip = cfg.slippageModel === 'none' ? 0
      : cfg.slippageModel === 'fixed' ? cfg.fixedSlippagePips
      : s.mean;
    // The pessimistic branch: assume the trade ends on its stop, which is the
    // side that slips. A cost filter that assumes the target is reached is
    // filtering on the outcome it hopes for.
    var exitSlip = cfg.slippageModel === 'none' ? 0
      : cfg.slippageModel === 'fixed' ? cfg.fixedSlippagePips
      : s.mean * 1.6;
    return roundTrip({
      instrument: inst,
      direction: spec.direction,
      lots: spec.lots,
      price: spec.price,
      spreadPips: spec.spreadPips,
      entrySlippagePips: entrySlip,
      exitSlippagePips: exitSlip,
      nights: spec.nights || 0
    });
  }

  return {
    config: cfg,
    spreadPips: spreadPips,
    slippagePips: slippagePips,
    pipsToMoney: pipsToMoney,
    spreadMoney: spreadMoney,
    commissionMoney: commissionMoney,
    swapMoney: swapMoney,
    nightsHeld: nightsHeld,
    roundTrip: roundTrip,
    estimate: estimate,
    sessionSpreadFactor: sessionSpreadFactor
  };
}

module.exports = {
  create: create,
  sessionSpreadFactor: sessionSpreadFactor
};
