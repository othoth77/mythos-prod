'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — the Trading Agent boundary
// projects/mythos-trading-control-center/server/agent.js
//
// THE ONLY FILE THAT REQUIRES A TRADING AGENT MODULE. Everything the Control
// Center knows about the agent it learns through the contracts loaded here —
// the same ones bin/mtx.js uses — so the agent's own tests keep describing the
// system this console drives.
//
// WHY THE CONTROL CENTER IS A SEPARATE PROJECT AND NOT A FOLDER UNDER THE
// AGENT'S src/. The agent's NO_NETWORK_CLIENT health check greps its src/ for
// anything that could reach a network and FAILS if it finds one. An HTTP
// server needs `http`. Putting it there would have meant weakening or
// exempting that check, and an exemption in a safety scan is what later hides
// a real finding. So the agent stays network-free and this project imports it.
//
// WHAT IS DELIBERATELY NOT LOADED: src/execution/live-adapter.js is required
// only by the agent's own health check. Nothing in this project imports it,
// constructs it, or holds a reference to it, and tests/live-lock-test.js
// asserts that at source level.
// =====================================================

var path = require('path');

var DEFAULT_AGENT_ROOT = path.join(__dirname, '..', '..', 'mythos-trading-agent');

/** Timeframes each data kind can serve. Fixtures are committed at M15 only. */
var SYNTHETIC_TIMEFRAMES = ['M5', 'M15', 'M30', 'H1'];
var MAX_SYNTHETIC_BARS = 6000;
var MIN_RUN_BARS_OVER_WARMUP = 50;

function refusal(code, message) {
  var e = new Error(message);
  e.code = code;
  e.refusal = true;
  return e;
}

function load(agentRoot) {
  var root = agentRoot || DEFAULT_AGENT_ROOT;
  var SRC = path.join(root, 'src');
  function req(rel) { return require(path.join(SRC, rel)); }

  var m = {
    root: root,
    enums: req('core/enums'),
    errors: req('core/errors'),
    hash: req('core/hash'),
    money: req('core/money'),
    clock: req('core/clock'),
    rng: req('core/rng'),
    logger: req('core/logger'),
    config: req('config'),
    configSchema: req('config/schema'),
    mode: req('mode/mode-controller'),
    gates: req('mode/gates'),
    store: req('db/store'),
    storeSchema: req('db/schema'),
    bar: req('data/bar'),
    source: req('data/source'),
    fixtureSource: req('data/fixture-source'),
    syntheticSource: req('data/synthetic-source'),
    feed: req('data/feed'),
    engine: req('backtest/engine'),
    metrics: req('backtest/metrics'),
    walkForward: req('backtest/walk-forward'),
    stressSuite: req('stress/suite'),
    tradingAgent: req('agents/trading-agent'),
    analysisAgent: req('agents/analysis-agent'),
    researchAgent: req('agents/research-agent'),
    champion: req('champion/registry'),
    health: req('observability/health'),
    paperSession: req('paper/session'),
    strategyRegistry: req('strategy/registry'),
    instrument: req('core/instrument')
  };

  var fixtures = null;
  function fixtureCatalog() {
    if (!fixtures) fixtures = m.fixtureSource.createSource();
    return fixtures;
  }

  /** The strategy ids the platform ships, in registry order. */
  function strategyIds() { return m.strategyRegistry.standard().ids(); }

  /**
   * Builds the validated, frozen configuration the platform runs under.
   *
   * The enabled-strategy set is not a key in the agent's config schema — it is
   * an argument to the agent — so on its own it would sit OUTSIDE the config
   * fingerprint, and an owner approval bound to that fingerprint would not
   * cover it. It is therefore written into `notes.controlCenter`, which the
   * schema defines as free-form provenance that IS part of the fingerprint.
   * Changing which strategies run changes the hash, and so invalidates an
   * approval of the previous system.
   *
   * `backtest.warmupBars` is raised to what the wired pipeline actually needs,
   * exactly as bin/mtx.js does, so a decision is never requested before the
   * regime engine has history.
   */
  function buildConfig(overrides, enabledStrategies, extra) {
    var over = m.config.deepMerge(overrides || {}, extra || {});
    var enabled = (enabledStrategies || strategyIds()).slice().sort();
    over.notes = { controlCenter: { enabledStrategies: enabled } };
    var first = m.config.load(over);
    var probe = m.tradingAgent.create({ config: first, enabledStrategies: enabled });
    var need = probe.warmupBars();
    if (first.backtest.warmupBars >= need) return first;
    over = m.config.deepMerge(over, { backtest: { warmupBars: need } });
    return m.config.load(over);
  }

  /**
   * Turns a Research Agent proposal override into what a run can be built
   * from: { overrides, enabled }.
   *
   * The Research Agent expresses "stop using this strategy" as
   * { strategy: { disable: [id] } }. That is not a configuration key — in the
   * agent, WHICH strategies run is a wiring argument, not a limit — so the
   * override cannot be merged into a config as it stands. Here it is applied
   * to the enabled set instead, which the Control Center already carries
   * inside the config fingerprint. Everything else in the override is merged
   * and validated by the agent's own loader, unchanged.
   *
   * A proposal can only REMOVE strategies. There is no key by which one could
   * add a strategy, a size or a mode.
   */
  function applyProposal(overrides, enabledStrategies, proposalOverride) {
    var po = JSON.parse(JSON.stringify(proposalOverride || {}));
    // Order is preserved: the variant must differ from its baseline by the
    // proposal and by nothing else.
    var enabled = (enabledStrategies || strategyIds()).slice();
    if (po.strategy !== undefined) {
      var keys = Object.keys(po.strategy || {});
      var disable = po.strategy && po.strategy.disable;
      if (keys.length !== 1 || !Array.isArray(disable)) {
        throw refusal('PROPOSAL_NOT_APPLICABLE', 'the only strategy change a proposal may carry is strategy.disable: [ids]');
      }
      var known = strategyIds();
      disable.forEach(function (id) {
        if (known.indexOf(id) === -1) throw refusal('PROPOSAL_NOT_APPLICABLE', 'the proposal disables an unknown strategy: ' + String(id).slice(0, 60));
      });
      enabled = enabled.filter(function (id) { return disable.indexOf(id) === -1; });
      if (enabled.length === 0) throw refusal('PROPOSAL_NOT_APPLICABLE', 'the proposal would leave no strategy enabled');
      delete po.strategy;
    }
    return { overrides: m.config.deepMerge(overrides || {}, po), enabled: enabled };
  }

  /** Wires an agent with the engine hooks, restricted to the enabled strategies. */
  function wire(config, enabledStrategies, logger) {
    return m.tradingAgent.wire({
      config: config,
      enabledStrategies: (enabledStrategies || strategyIds()).slice(),
      logger: logger || m.logger.nullLogger()
    });
  }

  /** What data this build can actually serve. There is no market-data access. */
  function dataCatalog() {
    var fx = fixtureCatalog();
    var catalog = m.instrument.defaultCatalog();
    var fixtureSymbols = fx.symbols();
    var ranges = {};
    fixtureSymbols.forEach(function (s) {
      var bars = fx.load(s, 'M15');
      ranges[s] = { bars: bars.length, fromTs: bars[0].ts, toTs: bars[bars.length - 1].ts };
    });
    return {
      kinds: [
        {
          kind: 'FIXTURE', label: 'SYNTHETIC', available: true,
          description: 'Committed fixture bars. Generated by the seeded regime-switching generator, content-hashed.',
          symbols: fixtureSymbols, timeframes: ['M15'], ranges: ranges, datasetVersion: fx.datasetVersion
        },
        {
          kind: 'SYNTHETIC', label: 'SYNTHETIC', available: true,
          description: 'Seeded regime-switching generator. Reproducible from its seed.',
          symbols: catalog.symbols.slice(), timeframes: SYNTHETIC_TIMEFRAMES.slice(), maxBars: MAX_SYNTHETIC_BARS
        },
        {
          kind: 'HISTORICAL', label: 'HISTORICAL', available: false,
          description: 'Real market history.',
          reason: 'This build has no market-data access and no network client. No historical dataset exists to run against.'
        }
      ],
      warning: 'Every dataset available here is SYNTHETIC. It validates mechanics only; no statement about edge or profitability can be derived from it.'
    };
  }

  /**
   * Loads bars for a run.
   *
   * @param {object} config validated config (for the catalog and warmup)
   * @param {object} spec { kind, symbols, timeframe, bars, seed, fromTs, toTs }
   * @returns {{source, raw, datasetVersion, provenance, timeframe, range}}
   */
  function loadDataset(config, spec) {
    var kind = spec.kind || 'FIXTURE';
    var symbols = (spec.symbols || config.universe).slice();
    var timeframe = spec.timeframe || config.backtest.baseTimeframe;
    var raw = {};
    var datasetVersion, provenance;

    if (kind === 'FIXTURE') {
      var fx = fixtureCatalog();
      if (timeframe !== 'M15') {
        throw m.errors.DataError('committed fixtures exist at M15 only; ' + timeframe + ' needs the SYNTHETIC source');
      }
      var missing = symbols.filter(function (s) { return fx.timeframes(s).indexOf('M15') === -1; });
      if (missing.length) {
        throw m.errors.DataError('no committed fixture for ' + missing.join(', ') + ' (available: ' +
          fx.symbols().join(', ') + '); use the SYNTHETIC source for the others');
      }
      var n = spec.bars || Infinity;
      symbols.forEach(function (s) {
        var all = fx.load(s, 'M15');
        raw[s] = {};
        raw[s][timeframe] = isFinite(n) ? all.slice(0, n) : all.slice();
      });
      datasetVersion = fx.datasetVersion + (isFinite(n) ? ':' + n : '');
      provenance = {
        kind: 'FIXTURE', label: 'SYNTHETIC', generator: 'regime-switching-gbm-v1',
        note: 'Committed fixture, produced by the synthetic generator. Mechanics only.'
      };
    } else if (kind === 'SYNTHETIC') {
      if (SYNTHETIC_TIMEFRAMES.indexOf(timeframe) === -1) {
        throw m.errors.DataError('the synthetic source serves ' + SYNTHETIC_TIMEFRAMES.join(', ') + ', not ' + timeframe);
      }
      var bars = spec.bars || 3000;
      if (bars > MAX_SYNTHETIC_BARS) {
        throw m.errors.DataError('at most ' + MAX_SYNTHETIC_BARS + ' synthetic bars per run');
      }
      var syn = m.syntheticSource.createSource({
        catalog: config.catalog, symbols: symbols, timeframe: timeframe, bars: bars,
        seed: spec.seed === undefined ? 'control-center' : spec.seed
      });
      symbols.forEach(function (s) {
        raw[s] = {};
        raw[s][timeframe] = syn.load(s, timeframe);
      });
      datasetVersion = syn.datasetVersion;
      provenance = {
        kind: 'SYNTHETIC', label: 'SYNTHETIC', generator: 'regime-switching-gbm-v1',
        seed: String(spec.seed === undefined ? 'control-center' : spec.seed),
        note: 'Seeded synthetic series. Mechanics only.'
      };
    } else {
      throw m.errors.DataError(
        'data kind ' + kind + ' is not available. This build has no market-data access; HISTORICAL data does not exist here.'
      );
    }

    // Date range, applied by slicing: the engine sees only the bars asked for.
    var range = null;
    if (spec.fromTs !== undefined || spec.toTs !== undefined) {
      var from = spec.fromTs === undefined ? -Infinity : spec.fromTs;
      var to = spec.toTs === undefined ? Infinity : spec.toTs;
      if (from > to) throw m.errors.DataError('the date range is inverted (from is after to)');
      symbols.forEach(function (s) {
        raw[s][timeframe] = raw[s][timeframe].filter(function (b) { return b.ts >= from && b.ts <= to; });
      });
      range = { fromTs: isFinite(from) ? from : null, toTs: isFinite(to) ? to : null };
      datasetVersion += ':range-' + (range.fromTs === null ? '' : range.fromTs) + '-' + (range.toTs === null ? '' : range.toTs);
    }

    var need = config.backtest.warmupBars + MIN_RUN_BARS_OVER_WARMUP;
    symbols.forEach(function (s) {
      var len = raw[s][timeframe].length;
      if (len < need) {
        throw m.errors.DataError(s + ' has ' + len + ' bars in the requested window; at least ' + need +
          ' are needed (' + config.backtest.warmupBars + ' warmup + ' + MIN_RUN_BARS_OVER_WARMUP + ')');
      }
    });

    var first = raw[symbols[0]][timeframe];
    return {
      source: m.source.fromBars({ kind: kind === 'FIXTURE' ? 'fixture-window' : 'synthetic', datasetVersion: datasetVersion, data: raw }),
      raw: raw,
      datasetVersion: datasetVersion,
      provenance: provenance,
      timeframe: timeframe,
      symbols: symbols,
      range: range,
      window: { fromTs: first[0].ts, toTs: first[first.length - 1].ts, bars: first.length }
    };
  }

  /** The feed form of a dataset: { SYMBOL: bars[] }. */
  function feedData(dataset) {
    var out = {};
    dataset.symbols.forEach(function (s) { out[s] = dataset.raw[s][dataset.timeframe]; });
    return out;
  }

  m.DEFAULT_AGENT_ROOT = DEFAULT_AGENT_ROOT;
  m.SYNTHETIC_TIMEFRAMES = SYNTHETIC_TIMEFRAMES;
  m.MAX_SYNTHETIC_BARS = MAX_SYNTHETIC_BARS;
  m.strategyIds = strategyIds;
  m.buildConfig = buildConfig;
  m.applyProposal = applyProposal;
  m.wire = wire;
  m.dataCatalog = dataCatalog;
  m.loadDataset = loadDataset;
  m.feedData = feedData;
  return m;
}

module.exports = {
  load: load,
  DEFAULT_AGENT_ROOT: DEFAULT_AGENT_ROOT
};
