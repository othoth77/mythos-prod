'use strict';
// =====================================================
// MYTHOS AUTO auto-reply — business data port (integration boundary)
// projects/automotive/comms/lib/business-data.js
//
// The ONLY place a reply may get a business fact from. Catalogue, stock,
// price, vehicle compatibility, order and CRM data are MYTHOS business
// integrations that do not exist yet for the communication layer (the
// automotive control plane of projects/automotive/ is a schema; the
// ssangyong.autos catalogue API is a read-only loopback reference, not
// deployed). Until a port is connected, every lookup answers
// "unavailable" — and an unavailable fact is a handoff, never a guess.
//
// Port contract (each function optional; absent = unavailable):
//
//   ports = {
//     vehicle(entities, ctx)   → Promise<{ ok, data } | null>   identification / compatibility base
//     parts(entities, ctx)     → Promise<{ ok, data } | null>   catalogue matches
//     price(entities, ctx)     → Promise<{ ok, data } | null>   price for identified parts
//     stock(entities, ctx)     → Promise<{ ok, data } | null>   availability / lead time
//     order(entities, ctx)     → Promise<{ ok, data } | null>   order / delivery / payment status
//   }
//
// `gather(ports, kinds, entities, ctx)` calls the ports an intent needs and
// returns { required, available, missing, data, errors } where `available`
// and `missing` are kind NAMES (recorded on the decision) and `data` holds
// the verified values for the generator. A port that throws, times out or
// returns anything but { ok: true, data } counts as missing: the reply
// never sees a half-answer.
//
// What an intent needs (Issue #173 §7):
//   greeting                 nothing
//   vehicle_identification   nothing to reply (echo); `vehicle` if connected
//   part_inquiry             vehicle? + parts
//   price_availability       vehicle? + parts + price + stock
//   order_status             order
//   human_request            nothing (handoff)
//   unsupported / ambiguous  nothing
// =====================================================

var KINDS = ['vehicle', 'parts', 'price', 'stock', 'order'];
var REQUIRED_BY_INTENT = {
  greeting: [],
  vehicle_identification: [],
  part_inquiry: ['parts'],
  price_availability: ['parts', 'price', 'stock'],
  order_status: ['order'],
  human_request: [],
  unsupported: [],
  ambiguous: []
};
var PORT_TIMEOUT_MS = 5000;

// A port set with nothing connected: the state of every project today.
function none() { return {}; }

function requiredFor(intent) {
  return (REQUIRED_BY_INTENT[intent] || []).slice();
}

function withTimeout(promise, ms) {
  var timer;
  var t = new Promise(function (_, reject) { timer = setTimeout(function () { reject(new Error('PORT_TIMEOUT')); }, ms); });
  return Promise.race([promise, t]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
}

function errorName(e) {
  var msg = e && typeof e.message === 'string' ? e.message : '';
  return /^[A-Z][A-Z0-9_]{2,40}$/.test(msg) ? msg : 'PORT_ERROR';
}

function gather(ports, kinds, entities, ctx, opts) {
  ports = ports || {};
  opts = opts || {};
  kinds = Array.isArray(kinds) ? kinds.filter(function (k) { return KINDS.indexOf(k) !== -1; }) : [];
  var out = { required: kinds.slice(), available: [], missing: [], data: {}, errors: {} };
  return Promise.all(kinds.map(function (kind) {
    var port = ports[kind];
    if (typeof port !== 'function') { out.missing.push(kind); out.errors[kind] = 'PORT_NOT_CONNECTED'; return null; }
    var call;
    try { call = Promise.resolve(port(entities, ctx)); } catch (e) { call = Promise.reject(e); }
    return withTimeout(call, opts.timeoutMs || PORT_TIMEOUT_MS).then(function (r) {
      if (r && r.ok === true && r.data !== undefined && r.data !== null) { out.available.push(kind); out.data[kind] = r.data; }
      else { out.missing.push(kind); out.errors[kind] = r && typeof r.reason === 'string' ? r.reason.slice(0, 40) : 'PORT_NO_DATA'; }
    }, function (e) {
      out.missing.push(kind);
      out.errors[kind] = errorName(e);
    });
  })).then(function () {
    // deterministic order, whatever the ports' timing
    out.available = kinds.filter(function (k) { return out.available.indexOf(k) !== -1; });
    out.missing = kinds.filter(function (k) { return out.missing.indexOf(k) !== -1; });
    return out;
  });
}

module.exports = {
  KINDS: KINDS,
  REQUIRED_BY_INTENT: REQUIRED_BY_INTENT,
  none: none,
  requiredFor: requiredFor,
  gather: gather
};
