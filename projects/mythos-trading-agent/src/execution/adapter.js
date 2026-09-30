'use strict';
// =====================================================
// MYTHOS TRADING AGENT — execution adapter interface
// projects/mythos-trading-agent/src/execution/adapter.js
//
// ADR-0001 names this as an adoption seam: a future NautilusTrader or broker
// execution client implements this interface and nothing above it changes.
//
// The interface is narrow on purpose. An adapter answers exactly one question —
// "at what price did this order actually fill, if at all?" — and has no opinion
// about size, risk or whether the trade should happen. Those decisions were
// already made, by the Risk Engine, before an order reached here. An adapter
// that could resize an order would be a second authority over position size,
// and ADR-0002 allows only one.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');

var REQUIRED_METHODS = ['fill', 'supportsMode', 'describe'];

/** Reasons an adapter may reject a fill. */
var RejectReason = Object.freeze({
  MODE_NOT_SUPPORTED: 'MODE_NOT_SUPPORTED',
  NO_LIQUIDITY: 'NO_LIQUIDITY',
  MARKET_CLOSED: 'MARKET_CLOSED',
  PRICE_UNREACHABLE: 'PRICE_UNREACHABLE',
  ADAPTER_REFUSED: 'ADAPTER_REFUSED'
});

/** Order intents an adapter must understand. */
var FillKind = Object.freeze({
  ENTRY: 'ENTRY',
  STOP: 'STOP',
  TARGET: 'TARGET',
  MARKET_EXIT: 'MARKET_EXIT'
});

function assertAdapter(a) {
  if (!a || typeof a !== 'object') throw errors.ConfigError('an execution adapter must be an object');
  if (typeof a.kind !== 'string' || !a.kind) throw errors.ConfigError('an execution adapter must declare a string `kind`');
  REQUIRED_METHODS.forEach(function (m) {
    if (typeof a[m] !== 'function') {
      throw errors.ConfigError('execution adapter "' + a.kind + '" is missing method ' + m + '()');
    }
  });
  return a;
}

/**
 * Validates a fill request before it reaches an adapter, so every adapter can
 * assume a well-formed request and none has to re-check.
 */
function assertRequest(req) {
  if (!req || typeof req !== 'object') throw errors.ConfigError('a fill request must be an object');
  if (!FillKind[req.kind]) {
    throw errors.ConfigError('fill request kind must be one of [' + Object.keys(FillKind).join(', ') + '], got ' + JSON.stringify(req.kind));
  }
  enums.assertEnum(enums.Direction, req.direction, 'fill request direction');
  if (req.direction === enums.Direction.NEUTRAL) {
    throw errors.ConfigError('a fill request cannot be NEUTRAL');
  }
  if (!(req.lots > 0)) throw errors.ConfigError('fill request lots must be > 0, got ' + req.lots);
  if (!(req.requestedPrice > 0)) throw errors.ConfigError('fill request requestedPrice must be > 0, got ' + req.requestedPrice);
  if (!req.instrument || !req.instrument.symbol) throw errors.ConfigError('a fill request needs an instrument');
  if (!req.bar) throw errors.ConfigError('a fill request needs the bar it is executing against');
  return req;
}

/** A standard FILLED result. */
function filled(price, ts, extra) {
  var out = { status: 'FILLED', price: price, ts: ts, slippagePips: 0, gapped: false };
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

/** A standard REJECTED result. Rejection is a normal outcome, not an error. */
function rejected(reason, detail) {
  return { status: 'REJECTED', reason: reason, detail: detail || null, price: null, ts: null };
}

module.exports = {
  assertAdapter: assertAdapter,
  assertRequest: assertRequest,
  filled: filled,
  rejected: rejected,
  RejectReason: RejectReason,
  FillKind: FillKind,
  REQUIRED_METHODS: REQUIRED_METHODS
};
