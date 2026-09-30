'use strict';
// =====================================================
// MYTHOS TRADING AGENT — configuration loading
// projects/mythos-trading-agent/src/config/index.js
//
// There is exactly one source of defaults (config/default.json) and one
// validator (schema.js). A caller supplies a partial override, which is deep
// merged, validated, deep frozen, and fingerprinted.
//
// The fingerprint is not decoration: mission §14 requires a backtest to record
// the configuration hash it ran under, and §13 forbids promoting a challenger
// without comparable evidence. Two results are only comparable if their
// fingerprints differ in the way the experiment claims and no other.
//
// DEEP FREEZE matters more than it looks. A strategy that mutated
// cfg.risk.maxDrawdownPct mid-run would produce a result whose recorded
// fingerprint is a lie. Frozen config turns that into a thrown error.
// =====================================================

var fs = require('fs');
var path = require('path');

var schema = require('./schema');
var hashMod = require('../core/hash');
var errors = require('../core/errors');
var instrument = require('../core/instrument');

var DEFAULT_PATH = path.join(__dirname, '..', '..', 'config', 'default.json');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep merge. Arrays REPLACE rather than concatenate: a `universe` override of
 * ['EURUSD'] must mean "just EURUSD", not "the defaults plus EURUSD".
 */
function deepMerge(base, override) {
  if (!isPlainObject(override)) return clone(override);
  var out = isPlainObject(base) ? clone(base) : {};
  Object.keys(override).forEach(function (k) {
    var v = override[k];
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = clone(v);
  });
  return out;
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlainObject(v)) {
    var o = {};
    Object.keys(v).forEach(function (k) { o[k] = clone(v[k]); });
    return o;
  }
  return v;
}

function deepFreeze(v) {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  Object.keys(v).forEach(function (k) { deepFreeze(v[k]); });
  return Object.freeze(v);
}

/** The raw defaults, re-read from disk on each call (cheap, and never shared). */
function defaults() {
  return JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));
}

/**
 * Builds a validated, frozen, fingerprinted configuration.
 *
 * @param {object} [overrides] partial config; arrays replace, objects merge
 * @param {object} [opts]
 * @param {object} [opts.catalog] instrument catalog; defaults to the shipped one
 * @returns {object} { ...config, fingerprint, catalog, instrument(symbol) }
 */
function load(overrides, opts) {
  var o = opts || {};
  var merged = deepMerge(defaults(), overrides || {});
  schema.assertValid(merged);

  var catalog = o.catalog || instrument.defaultCatalog();

  // Every symbol in the universe must exist in the catalog, and its currency
  // must match the account's — a universe entry nothing can price is a config
  // error, not a runtime surprise three hours into a walk-forward.
  merged.universe.forEach(function (sym) {
    if (!catalog.has(sym)) {
      throw errors.ConfigError('universe contains ' + sym + ', which is not in the instrument catalog (known: ' + catalog.symbols.join(', ') + ')');
    }
  });
  if (catalog.accountCurrency !== merged.account.currency) {
    throw errors.ConfigError('account currency ' + merged.account.currency + ' does not match the instrument catalog currency ' + catalog.accountCurrency);
  }
  Object.keys(merged.schedule.perAsset).forEach(function (sym) {
    if (!catalog.has(sym)) {
      throw errors.ConfigError('schedule.perAsset has an entry for unknown instrument ' + sym);
    }
  });

  // maxPositionSizeLots below an instrument's minLot means that instrument can
  // never trade. That is a legitimate choice, but it must be a visible one.
  var unreachable = merged.universe.filter(function (sym) {
    return catalog.get(sym).minLot > merged.risk.maxPositionSizeLots;
  });

  var fp = hashMod.fingerprint(merged);
  var cfg = merged;
  cfg.fingerprint = { hash: fp.hash, shortHash: fp.shortHash };
  cfg.unreachableInstruments = unreachable;

  // Attached NON-ENUMERABLE, and before the freeze: after deepFreeze the object
  // is not extensible, and hash/JSON both walk enumerable keys only — so the
  // catalog and its functions stay out of the fingerprint and out of every
  // serialised copy, while still being reachable as cfg.catalog.
  Object.defineProperty(cfg, 'catalog', { value: catalog, enumerable: false });
  Object.defineProperty(cfg, 'instrument', {
    value: function (symbol) { return catalog.get(symbol); },
    enumerable: false
  });

  deepFreeze(cfg);
  return cfg;
}

/** Loads a config from a JSON file, treating its contents as overrides. */
function loadFile(filePath, opts) {
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw errors.ConfigError('cannot read config file ' + filePath + ': ' + e.message);
  }
  return load(raw, opts);
}

/**
 * The plain, JSON-serialisable form — what gets stored on a backtest record.
 * Excludes the catalog and the helper functions by construction.
 */
function serialise(cfg) {
  return JSON.parse(JSON.stringify(cfg));
}

module.exports = {
  DEFAULT_PATH: DEFAULT_PATH,
  defaults: defaults,
  load: load,
  loadFile: loadFile,
  deepMerge: deepMerge,
  serialise: serialise
};
