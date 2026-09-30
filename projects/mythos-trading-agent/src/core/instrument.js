'use strict';
// =====================================================
// MYTHOS TRADING AGENT — instrument model and P&L arithmetic
// projects/mythos-trading-agent/src/core/instrument.js
//
// One place converts between price, pips, lots and account currency. Every
// other module asks this one, because the conversion is where silent errors of
// a factor of 10 (or of 1/150, for USDJPY) live, and a sizing bug of that size
// turns a "0.5 % risk" rule into a blown account.
//
// The subtlety this module exists for: a lot's value is NOT constant in the
// account currency. For EURUSD on a USD account it is (quote is USD), but for
// USDJPY the profit is earned in JPY and must be divided by the USD/JPY rate at
// the time of conversion. Getting that wrong overstates USDJPY P&L by ~150x.
// =====================================================

var enums = require('./enums');
var money = require('./money');
var errors = require('./errors');

var REQUIRED_FIELDS = [
  'symbol', 'assetClass', 'base', 'quote', 'digits', 'pipSize', 'contractSize',
  'quoteConversion', 'minLot', 'maxLot', 'lotStep', 'typicalSpreadPips',
  'maxSpreadPips', 'commissionPerLotPerSide', 'slippagePips',
  'swapLongPerLotPerDay', 'swapShortPerLotPerDay', 'tradingHoursUtc',
  'weekendClosed', 'referencePrice'
];

/**
 * Validates and freezes one instrument spec.
 * @throws {ConfigError} on any missing or impossible field
 */
function define(spec) {
  if (!spec || typeof spec !== 'object') {
    throw errors.ConfigError('instrument spec must be an object');
  }
  REQUIRED_FIELDS.forEach(function (f) {
    if (spec[f] === undefined || spec[f] === null) {
      throw errors.ConfigError('instrument ' + (spec.symbol || '?') + ' missing field "' + f + '"');
    }
  });
  enums.assertEnum(enums.AssetClass, spec.assetClass, 'instrument.assetClass');
  enums.assertEnum(enums.QuoteConversion, spec.quoteConversion, 'instrument.quoteConversion');

  if (spec.pipSize <= 0) throw errors.ConfigError(spec.symbol + ': pipSize must be > 0');
  if (spec.contractSize <= 0) throw errors.ConfigError(spec.symbol + ': contractSize must be > 0');
  if (spec.lotStep <= 0) throw errors.ConfigError(spec.symbol + ': lotStep must be > 0');
  if (spec.minLot < spec.lotStep) {
    throw errors.ConfigError(spec.symbol + ': minLot (' + spec.minLot + ') below lotStep (' + spec.lotStep + ')');
  }
  if (spec.maxLot < spec.minLot) {
    throw errors.ConfigError(spec.symbol + ': maxLot below minLot');
  }
  if (spec.maxSpreadPips < spec.typicalSpreadPips) {
    throw errors.ConfigError(spec.symbol + ': maxSpreadPips below typicalSpreadPips');
  }
  if (spec.quoteConversion === enums.QuoteConversion.FIXED &&
      !(typeof spec.fixedQuoteRate === 'number' && spec.fixedQuoteRate > 0)) {
    throw errors.ConfigError(spec.symbol + ': quoteConversion FIXED requires a positive fixedQuoteRate');
  }
  if (spec.referencePrice <= 0) throw errors.ConfigError(spec.symbol + ': referencePrice must be > 0');

  var sl = spec.slippagePips;
  if (typeof sl !== 'object' || !(sl.mean >= 0) || !(sl.sd >= 0) || !(sl.max >= 0)) {
    throw errors.ConfigError(spec.symbol + ': slippagePips needs non-negative mean, sd, max');
  }
  var th = spec.tradingHoursUtc;
  if (typeof th !== 'object' || !isHour(th.start) || !isHour(th.end)) {
    throw errors.ConfigError(spec.symbol + ': tradingHoursUtc needs integer UTC hours 0-23');
  }

  var out = {};
  Object.keys(spec).forEach(function (k) { out[k] = spec[k]; });
  out.slippagePips = Object.freeze({ mean: sl.mean, sd: sl.sd, max: sl.max });
  out.tradingHoursUtc = Object.freeze({ start: th.start, end: th.end });
  return Object.freeze(out);
}

function isHour(h) {
  return typeof h === 'number' && h === Math.floor(h) && h >= 0 && h <= 23;
}

/** Builds a symbol → instrument map from the instruments.json shape. */
function loadCatalog(json) {
  if (!json || !Array.isArray(json.instruments)) {
    throw errors.ConfigError('instrument catalog must have an "instruments" array');
  }
  var bySymbol = Object.create(null);
  json.instruments.forEach(function (spec) {
    var inst = define(spec);
    if (bySymbol[inst.symbol]) throw errors.ConfigError('duplicate instrument ' + inst.symbol);
    bySymbol[inst.symbol] = inst;
  });
  return Object.freeze({
    accountCurrency: json.accountCurrency || 'USD',
    schemaVersion: json.schemaVersion || 1,
    symbols: Object.freeze(Object.keys(bySymbol)),
    get: function (symbol) {
      var i = bySymbol[symbol];
      if (!i) throw errors.ConfigError('unknown instrument ' + JSON.stringify(symbol));
      return i;
    },
    has: function (symbol) { return !!bySymbol[symbol]; },
    all: function () { return Object.keys(bySymbol).map(function (s) { return bySymbol[s]; }); }
  });
}

/** Reads the shipped catalog from config/instruments.json. */
function defaultCatalog() {
  var fs = require('fs');
  var path = require('path');
  var p = path.join(__dirname, '..', '..', 'config', 'instruments.json');
  return loadCatalog(JSON.parse(fs.readFileSync(p, 'utf8')));
}

/** Price distance expressed in pips. Always non-negative for |delta|. */
function toPips(inst, priceDelta) {
  return priceDelta / inst.pipSize;
}

/** Pips expressed as a price distance. */
function toPrice(inst, pips) {
  return pips * inst.pipSize;
}

/** Rounds a price to the instrument's quoted precision. */
function roundPrice(inst, price) {
  return money.round(price, inst.digits);
}

/**
 * Quote-currency → account-currency rate at `price`.
 *
 * DIRECT: 1 (profit is already in the account currency).
 * INVERSE: 1/price (profit is in the foreign quote currency; `price` is
 *          account-currency-per-unit-of-quote inverted, i.e. USD/JPY).
 * FIXED: the documented constant on the instrument.
 */
function quoteRate(inst, price) {
  if (inst.quoteConversion === enums.QuoteConversion.DIRECT) return 1;
  if (inst.quoteConversion === enums.QuoteConversion.FIXED) return inst.fixedQuoteRate;
  if (!(price > 0)) {
    throw errors.DataError(inst.symbol + ': INVERSE conversion needs a positive price, got ' + price);
  }
  return 1 / price;
}

/**
 * Account-currency value of one pip for one lot, at `price`.
 * EURUSD @ any price → 10. USDJPY @ 150 → 100000 * 0.01 / 150 ≈ 6.667.
 */
function pipValuePerLot(inst, price) {
  return inst.contractSize * inst.pipSize * quoteRate(inst, price);
}

/**
 * Account-currency P&L of a closed position, gross of costs.
 *
 * @param {object} inst
 * @param {'LONG'|'SHORT'} direction
 * @param {number} entryPrice
 * @param {number} exitPrice
 * @param {number} lots
 * @param {number} [conversionPrice] rate used for INVERSE conversion; defaults
 *        to the exit price, which is when the position's quote-currency result
 *        is actually converted
 */
function grossPnl(inst, direction, entryPrice, exitPrice, lots, conversionPrice) {
  enums.assertEnum(enums.Direction, direction, 'direction');
  if (direction === enums.Direction.NEUTRAL) {
    throw errors.CandidateError('grossPnl() requires LONG or SHORT, not NEUTRAL');
  }
  var sign = direction === enums.Direction.LONG ? 1 : -1;
  var units = inst.contractSize * lots;
  var quoteProfit = (exitPrice - entryPrice) * sign * units;
  var rate = quoteRate(inst, conversionPrice === undefined ? exitPrice : conversionPrice);
  return money.money(quoteProfit * rate);
}

/**
 * Lot size that puts `riskMoney` of the account at stake over `stopPips`.
 * Rounds DOWN to the lot step — never up, see money.floorToStep.
 */
function lotsForRisk(inst, riskMoney, stopPips, price) {
  if (!(stopPips > 0)) {
    throw errors.CandidateError(inst.symbol + ': stop distance must be > 0 pips, got ' + stopPips);
  }
  var perPip = pipValuePerLot(inst, price);
  if (!(perPip > 0)) throw errors.DataError(inst.symbol + ': non-positive pip value');
  var raw = riskMoney / (stopPips * perPip);
  return money.floorToStep(raw, inst.lotStep);
}

/** Money at risk if a position of `lots` loses `stopPips`. */
function riskMoneyForLots(inst, lots, stopPips, price) {
  return money.money(lots * stopPips * pipValuePerLot(inst, price));
}

/** True when `lots` is a tradable size for this instrument. */
function isTradableSize(inst, lots) {
  if (!(lots >= inst.minLot) || !(lots <= inst.maxLot)) return false;
  var steps = lots / inst.lotStep;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

module.exports = {
  define: define,
  loadCatalog: loadCatalog,
  defaultCatalog: defaultCatalog,
  toPips: toPips,
  toPrice: toPrice,
  roundPrice: roundPrice,
  quoteRate: quoteRate,
  pipValuePerLot: pipValuePerLot,
  grossPnl: grossPnl,
  lotsForRisk: lotsForRisk,
  riskMoneyForLots: riskMoneyForLots,
  isTradableSize: isTradableSize,
  REQUIRED_FIELDS: REQUIRED_FIELDS
};
