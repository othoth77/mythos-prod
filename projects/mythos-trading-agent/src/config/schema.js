'use strict';
// =====================================================
// MYTHOS TRADING AGENT — configuration schema and validator
// projects/mythos-trading-agent/src/config/schema.js
//
// Configuration is the surface through which every safety limit is set, so it
// is validated STRICTLY and in one pass that reports all problems at once:
//   * unknown keys are errors, not ignored. A typo in "maxDrawdownPct" that
//     silently falls back to a default is exactly how a risk limit stops
//     existing without anyone noticing;
//   * every numeric limit has a declared range, so a negative drawdown cap or a
//     1000 % per-trade risk cannot be loaded at all;
//   * `mode` may be BACKTEST or PAPER here. LIVE can never be reached by
//     editing a config file — it requires an owner-approval record through
//     src/mode/mode-controller.js. This is the single most important rule in
//     this file.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');

function num(min, max, opts) {
  return Object.assign({ type: 'number', min: min, max: max }, opts || {});
}
function int(min, max, opts) {
  return Object.assign({ type: 'integer', min: min, max: max }, opts || {});
}
function bool() { return { type: 'boolean' }; }
function str(opts) { return Object.assign({ type: 'string' }, opts || {}); }
function enumOf(e) { return { type: 'enum', values: enums.values(e) }; }

/**
 * The schema. `fields` describes an object with a closed key set; `optional`
 * marks a key that may be absent (its default comes from config/default.json,
 * never from here — one source of defaults).
 */
var SCHEMA = {
  type: 'object',
  fields: {
    schemaVersion: int(1, 1000),
    // Config may select BACKTEST or PAPER only — see the header.
    mode: { type: 'enum', values: [enums.Mode.BACKTEST, enums.Mode.PAPER] },
    label: str({ minLength: 1, maxLength: 64, pattern: /^[A-Za-z0-9_.-]+$/ }),

    account: {
      type: 'object',
      fields: {
        currency: str({ minLength: 3, maxLength: 5 }),
        initialCapital: num(1, 1e9)
      }
    },

    universe: { type: 'array', minItems: 1, maxItems: 64, items: str({ minLength: 3, maxLength: 16 }) },

    risk: {
      type: 'object',
      fields: {
        // 25 % is not a recommendation — it is the ceiling above which the
        // schema refuses to load at all. Defaults live in default.json.
        maxAccountRiskPerTradePct: num(0.01, 25),
        maxPositionSizeLots: num(0.01, 100),
        maxOpenTrades: int(1, 1),          // mission §7: ONE trade, globally
        maxDailyLossPct: num(0.1, 50),
        maxDrawdownPct: num(0.5, 90),
        maxConsecutiveLosses: int(1, 50),
        /**
         * How long trading pauses after the consecutive-loss limit is hit, before
         * the streak counter is cleared and trading may resume.
         *
         * This is NOT a convenience. Without a reset the limit deadlocks: hitting
         * it blocks all trading, so no win can occur, so the streak never clears.
         * 0 means the breaker trips and clears on the same bar, which makes the
         * limit inert — allowed, but only as an explicit choice.
         */
        consecutiveLossCooldownHours: num(0, 168),
        maxSpreadMultiple: num(1, 20),
        maxSlippageMultiple: num(1, 20),
        minStopPips: num(0.1, 1000),
        maxStopPips: num(1, 100000),
        minRewardRisk: num(0, 100),
        minNetExpectedValue: num(-1e6, 1e6),
        emergencyStop: bool()
      }
    },

    recovery: {
      type: 'object',
      fields: {
        enabled: bool(),                   // OPT-IN. Default false.
        baseLots: num(0.01, 10),
        multiplier: num(1, 5),
        maxRecoveryLevel: int(0, 8),       // hard cap on the ×3 ladder
        resetOnWin: bool(),
        requireFullRecoveryTp: bool(),
        abandonOnRiskBlock: bool()
      }
    },

    strategy: {
      type: 'object',
      fields: {
        /**
         * Bars a strategy must wait after signalling before it may signal again
         * on the same instrument.
         *
         * Some strategies are state-based rather than event-based: range-trading
         * fires on every bar price sits in the buy zone, which over 3000 bars
         * produced 906 signals from roughly thirty distinct episodes. Those are
         * not 906 opportunities, and letting them all through swamps the
         * candidate record and the Jev statistics with near-duplicates.
         *
         * DEFAULT 0 (OFF), because suppression loses evidence and the honest
         * default is to record everything. Every suppressed signal is counted, so
         * turning it on never hides how much it removed.
         */
        signalCooldownBars: int(0, 500)
      }
    },

    jev: {
      type: 'object',
      fields: {
        model: str({ minLength: 1, maxLength: 64 }),
        scoreThreshold: num(0, 100),
        minConfidence: num(0, 1),
        thresholdBands: {
          type: 'array', minItems: 1, maxItems: 16,
          items: { type: 'array', minItems: 2, maxItems: 2, items: num(0, 100) }
        }
      }
    },

    cost: {
      type: 'object',
      fields: {
        spreadModel: { type: 'enum', values: ['instrument-typical', 'fixed', 'bar-derived'] },
        slippageModel: { type: 'enum', values: ['none', 'fixed', 'gaussian'] },
        includeCommission: bool(),
        includeSwap: bool(),
        executionDelayBars: int(0, 10),
        swapChargeHoursUtc: int(0, 23),
        fixedSpreadPips: num(0, 10000, { optional: true }),
        fixedSlippagePips: num(0, 10000, { optional: true })
      }
    },

    schedule: {
      type: 'object',
      fields: {
        respectInstrumentHours: bool(),
        blockForexWeekend: bool(),
        blockedWeekdaysUtc: { type: 'array', minItems: 0, maxItems: 7, items: int(0, 6) },
        perAsset: { type: 'map', values: {
          type: 'object',
          fields: {
            startHourUtc: int(0, 23, { optional: true }),
            endHourUtc: int(0, 23, { optional: true }),
            blockedWeekdaysUtc: { type: 'array', minItems: 0, maxItems: 7, items: int(0, 6), optional: true },
            enabled: { type: 'boolean', optional: true }
          }
        } }
      }
    },

    backtest: {
      type: 'object',
      fields: {
        seed: { type: 'seed' },
        warmupBars: int(0, 100000),
        baseTimeframe: enumOf(enums.Timeframe),
        higherTimeframe: enumOf(enums.Timeframe),
        maxBarsInTrade: int(1, 1000000),
        // When a bar's range contains BOTH the stop and the target, the bar's
        // internal order is unknowable from OHLC alone. STOP_FIRST is the
        // pessimistic assumption and the only honest default.
        allowIntrabarStopAndTarget: { type: 'enum', values: ['STOP_FIRST', 'TARGET_FIRST', 'SKIP'] }
      }
    },

    observability: {
      type: 'object',
      fields: {
        logLevel: enumOf(enums.LogLevel),
        auditEveryCandidate: bool()
      }
    },

    // Free-form, never read by the engine: provenance notes a research run
    // wants to carry into its own config fingerprint.
    notes: { type: 'any', optional: true }
  }
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function walk(spec, value, path, out) {
  if (value === undefined) {
    if (!spec.optional) out.push({ path: path, message: 'is required' });
    return;
  }
  switch (spec.type) {
    case 'any':
      return;
    case 'boolean':
      if (typeof value !== 'boolean') out.push({ path: path, message: 'must be a boolean, got ' + describe(value) });
      return;
    case 'string':
      if (typeof value !== 'string') { out.push({ path: path, message: 'must be a string, got ' + describe(value) }); return; }
      if (spec.minLength !== undefined && value.length < spec.minLength) out.push({ path: path, message: 'must be at least ' + spec.minLength + ' characters' });
      if (spec.maxLength !== undefined && value.length > spec.maxLength) out.push({ path: path, message: 'must be at most ' + spec.maxLength + ' characters' });
      if (spec.pattern && !spec.pattern.test(value)) out.push({ path: path, message: 'must match ' + spec.pattern });
      return;
    case 'seed':
      if (!(typeof value === 'string' && value.length > 0) && !(typeof value === 'number' && isFinite(value))) {
        out.push({ path: path, message: 'must be a non-empty string or a finite number (an RNG seed)' });
      }
      return;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !isFinite(value)) { out.push({ path: path, message: 'must be a finite number, got ' + describe(value) }); return; }
      if (spec.type === 'integer' && value !== Math.floor(value)) out.push({ path: path, message: 'must be an integer, got ' + value });
      if (spec.min !== undefined && value < spec.min) out.push({ path: path, message: 'must be >= ' + spec.min + ', got ' + value });
      if (spec.max !== undefined && value > spec.max) out.push({ path: path, message: 'must be <= ' + spec.max + ', got ' + value });
      return;
    case 'enum':
      if (spec.values.indexOf(value) === -1) {
        out.push({ path: path, message: 'must be one of [' + spec.values.join(', ') + '], got ' + describe(value) });
      }
      return;
    case 'array':
      if (!Array.isArray(value)) { out.push({ path: path, message: 'must be an array, got ' + describe(value) }); return; }
      if (spec.minItems !== undefined && value.length < spec.minItems) out.push({ path: path, message: 'needs at least ' + spec.minItems + ' item(s)' });
      if (spec.maxItems !== undefined && value.length > spec.maxItems) out.push({ path: path, message: 'allows at most ' + spec.maxItems + ' item(s)' });
      for (var i = 0; i < value.length; i++) walk(spec.items, value[i], path + '[' + i + ']', out);
      return;
    case 'map':
      if (!isPlainObject(value)) { out.push({ path: path, message: 'must be an object, got ' + describe(value) }); return; }
      Object.keys(value).forEach(function (k) { walk(spec.values, value[k], path + '.' + k, out); });
      return;
    case 'object':
      if (!isPlainObject(value)) { out.push({ path: path, message: 'must be an object, got ' + describe(value) }); return; }
      Object.keys(spec.fields).forEach(function (k) {
        walk(spec.fields[k], value[k], path === '' ? k : path + '.' + k, out);
      });
      Object.keys(value).forEach(function (k) {
        if (!spec.fields[k]) {
          out.push({ path: (path === '' ? k : path + '.' + k), message: 'is not a known configuration key (unknown keys are rejected so a misspelt limit cannot silently vanish)' });
        }
      });
      return;
    default:
      out.push({ path: path, message: 'internal: unknown schema type ' + spec.type });
  }
}

function describe(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  return typeof v + ' ' + JSON.stringify(v);
}

/**
 * Cross-field rules a per-field schema cannot express. These are invariants,
 * not preferences — each one, if violated, makes some other component's
 * arithmetic meaningless.
 */
function semanticChecks(cfg, out) {
  var r = cfg.risk || {};
  var rec = cfg.recovery || {};
  var bt = cfg.backtest || {};
  var TF = enums.TIMEFRAME_MINUTES;

  if (r.minStopPips !== undefined && r.maxStopPips !== undefined && r.minStopPips >= r.maxStopPips) {
    out.push({ path: 'risk', message: 'minStopPips (' + r.minStopPips + ') must be below maxStopPips (' + r.maxStopPips + ')' });
  }
  if (r.maxDailyLossPct !== undefined && r.maxDrawdownPct !== undefined && r.maxDailyLossPct > r.maxDrawdownPct) {
    out.push({ path: 'risk', message: 'maxDailyLossPct (' + r.maxDailyLossPct + ') exceeds maxDrawdownPct (' + r.maxDrawdownPct + '); the daily limit would never bind' });
  }
  if (rec.enabled === true && rec.maxRecoveryLevel === 0) {
    out.push({ path: 'recovery', message: 'enabled with maxRecoveryLevel 0 — either disable recovery or allow at least one level' });
  }
  if (bt.baseTimeframe && bt.higherTimeframe && TF[bt.higherTimeframe] < TF[bt.baseTimeframe]) {
    out.push({ path: 'backtest.higherTimeframe', message: 'must be >= baseTimeframe (' + bt.baseTimeframe + '), got ' + bt.higherTimeframe });
  }
  if (cfg.cost) {
    if (cfg.cost.spreadModel === 'fixed' && cfg.cost.fixedSpreadPips === undefined) {
      out.push({ path: 'cost.fixedSpreadPips', message: 'is required when cost.spreadModel is "fixed"' });
    }
    if (cfg.cost.slippageModel === 'fixed' && cfg.cost.fixedSlippagePips === undefined) {
      out.push({ path: 'cost.fixedSlippagePips', message: 'is required when cost.slippageModel is "fixed"' });
    }
  }
  if (Array.isArray(cfg.universe)) {
    var seen = {};
    cfg.universe.forEach(function (s) {
      if (seen[s]) out.push({ path: 'universe', message: 'duplicate symbol ' + s });
      seen[s] = true;
    });
  }
  if (cfg.jev && Array.isArray(cfg.jev.thresholdBands)) {
    cfg.jev.thresholdBands.forEach(function (b, i) {
      if (Array.isArray(b) && b.length === 2 && b[0] > b[1]) {
        out.push({ path: 'jev.thresholdBands[' + i + ']', message: 'band low (' + b[0] + ') exceeds band high (' + b[1] + ')' });
      }
    });
  }
}

/**
 * Validates a config object.
 * @returns {{ok: boolean, problems: Array<{path: string, message: string}>}}
 */
function check(cfg) {
  var problems = [];
  walk(SCHEMA, cfg, '', problems);
  if (problems.length === 0) semanticChecks(cfg, problems);
  return { ok: problems.length === 0, problems: problems };
}

/**
 * Validates and returns the config, or throws a ConfigError listing every
 * problem found. Nothing partially-valid is ever returned.
 */
function assertValid(cfg) {
  var res = check(cfg);
  if (!res.ok) {
    var lines = res.problems.map(function (p) { return '  - ' + (p.path || '<root>') + ' ' + p.message; });
    throw errors.ConfigError(
      'configuration invalid (' + res.problems.length + ' problem' + (res.problems.length === 1 ? '' : 's') + '):\n' + lines.join('\n'),
      { problems: res.problems }
    );
  }
  return cfg;
}

module.exports = {
  SCHEMA: SCHEMA,
  check: check,
  assertValid: assertValid
};
