'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — run job (child process)
// projects/mythos-trading-control-center/server/jobs/run-job.js
//
// A backtest is CPU-bound and synchronous. Run inside the HTTP process it
// would freeze every other request — including the one an operator would use
// to disable trading. So each run is a separate process, forked by
// server/runs.js, with its own memory ceiling and a hard timeout.
//
// The job receives ONE message (its spec), does its work through the Trading
// Agent's own engine — the same calls bin/mtx.js makes — writes its results
// into the run directory it was given, and exits. It opens no socket, reads no
// environment variable for configuration, and cannot change the platform's
// configuration or mode: it is handed a finished override object and a
// directory, nothing else.
//
// Job kinds
//   BACKTEST    one run; optionally a second identical run so reproducibility
//               is an observed equality rather than a claim
//   EXPERIMENT  a research proposal evaluated against its baseline: in/out of
//               sample, walk-forward, stress, then the Research Agent's compare()
// =====================================================

var fs = require('fs');
var path = require('path');

function writeJSON(file, value) {
  var tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function send(msg) {
  if (process.send) process.send(msg);
}

function runOne(agent, config, enabledStrategies, dataset, label, opts) {
  var o = opts || {};
  var wired = agent.wire(config, enabledStrategies);
  var spec = {
    config: config,
    source: dataset.source,
    timeframe: dataset.timeframe,
    label: label,
    logger: agent.logger.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  };
  if (o.range) spec.range = o.range;
  if (o.store) spec.store = o.store;
  var res = agent.engine.run(spec);
  res.agent = wired.agent;
  return res;
}

function backtest(agent, job) {
  var spec = job.spec;
  var config = agent.buildConfig(spec.overrides, spec.enabledStrategies);
  var dataset = agent.loadDataset(config, spec.data);

  send({ type: 'progress', stage: 'RUNNING', detail: 'engine' });
  var storeDir = path.join(job.runDir, 'store');
  var lastTs = 0;
  var store = agent.store.create({
    runId: job.runId,
    dir: storeDir,
    now: function () { return lastTs; },
    meta: {
      label: job.label, configHash: config.fingerprint.hash, datasetVersion: dataset.datasetVersion,
      timeframe: dataset.timeframe, symbols: dataset.symbols, mode: config.mode,
      provenance: dataset.provenance, commit: job.commit, controlCenterRunId: job.runId
    }
  });
  var run = runOne(agent, config, spec.enabledStrategies, dataset, job.label, { store: store });
  lastTs = run.timeline.toTs || 0;

  // Reproducibility is an equality between two runs. The second run uses a
  // store of its own and is discarded; only its digest is kept.
  var rerun = null;
  if (spec.verifyReproducible !== false) {
    send({ type: 'progress', stage: 'RUNNING', detail: 'reproducibility' });
    rerun = runOne(agent, config, spec.enabledStrategies, agent.loadDataset(config, spec.data), job.label);
  }

  send({ type: 'progress', stage: 'RUNNING', detail: 'health' });
  var health = agent.health.create({ config: config });
  var healthReport = health.report({ run: run, rerun: rerun || undefined });

  send({ type: 'progress', stage: 'RUNNING', detail: 'analysis' });
  var minSample = spec.minSample || 20;
  var analysis = agent.analysisAgent.create({ minSample: minSample })
    .analyse({ store: run.store, initialCapital: config.account.initialCapital, label: job.label });
  var research = agent.researchAgent.create({ minSample: Math.min(minSample, 10) })
    .research({ report: analysis, config: config });

  var digest = run.digest();
  health.persist(run.store, healthReport);
  var sealed = run.store.seal();

  var m = run.metrics;
  var result = {
    runId: job.runId,
    kind: 'BACKTEST',
    label: job.label,
    commit: job.commit,
    configHash: config.fingerprint.hash,
    config: agent.config.serialise(config),
    enabledStrategies: spec.enabledStrategies,
    data: {
      kind: dataset.provenance.kind, label: dataset.provenance.label, datasetVersion: dataset.datasetVersion,
      provenance: dataset.provenance, timeframe: dataset.timeframe, symbols: dataset.symbols,
      window: dataset.window, range: dataset.range
    },
    metrics: m,
    counts: run.counts,
    pipeline: run.agent.counts(),
    agentStats: run.agent.stats(),
    emergencyStopped: run.emergencyStopped,
    emergencyReason: run.emergencyReason,
    timeline: run.timeline,
    // The digest BEFORE the health rows were added: the one a re-run reproduces.
    digest: digest,
    rerunDigest: rerun ? rerun.digest() : null,
    reproducible: rerun ? rerun.digest() === digest : null,
    sealedDigest: sealed.digest,
    storeRows: sealed.rows,
    tables: sealed.counts,
    health: healthReport,
    results: {
      netPnl: m.netPnl, grossPnl: m.grossPnl, returnPct: m.returnPct, maxDrawdownPct: m.maxDrawdownPct,
      winRate: m.winRate, profitFactor: m.profitFactor, expectancy: m.expectancy, trades: m.tradeCount,
      avgWin: m.avgWin, avgLoss: m.avgLoss, maxConsecutiveLosses: m.maxConsecutiveLosses,
      recoveryFailures: {
        abandonedAtCap: analysis.recovery.abandonedAtCap,
        abandonedByRisk: analysis.recovery.abandonedByRisk,
        maxLevelReached: analysis.recovery.maxLevelReached
      },
      largestPositionLots: m.largestPositionLots,
      costs: analysis.costs.trades === 0 ? { trades: 0 } : {
        total: analysis.costs.totalCosts, byComponent: analysis.costs.byComponent,
        costsFlippedTheSign: analysis.costs.costsFlippedTheSign, costsOverAbsGross: analysis.costs.costsOverAbsGross
      }
    },
    caveats: analysis.caveats
  };
  writeJSON(path.join(job.runDir, 'analysis.json'), analysis);
  writeJSON(path.join(job.runDir, 'research.json'), research);
  writeJSON(path.join(job.runDir, 'result.json'), result);
  return {
    headline: agent.metrics.headline(m),
    configHash: config.fingerprint.hash,
    data: result.data,
    reproducible: result.reproducible,
    health: { status: healthReport.status, counts: healthReport.counts },
    emergencyStopped: run.emergencyStopped
  };
}

function strip(cfgSerialised) {
  var out = JSON.parse(JSON.stringify(cfgSerialised));
  delete out.fingerprint;
  delete out.unreachableInstruments;
  return out;
}

function experiment(agent, job) {
  var spec = job.spec;
  var baseline = agent.buildConfig(spec.overrides, spec.enabledStrategies);
  var variantOverrides = agent.config.deepMerge(spec.overrides, spec.proposal.override);
  var variant = agent.buildConfig(variantOverrides, spec.enabledStrategies);
  if (variant.fingerprint.hash === baseline.fingerprint.hash) {
    throw new Error('the proposal does not change the configuration; there is nothing to compare');
  }
  var dataset = agent.loadDataset(baseline, spec.data);
  var symbol = dataset.symbols[0];
  var series = dataset.raw[symbol][dataset.timeframe];
  var split = agent.walkForward.split(series, { inSampleRatio: 0.7, warmupBars: baseline.backtest.warmupBars });

  function side(config, tag) {
    send({ type: 'progress', stage: 'RUNNING', detail: tag + ' in-sample' });
    var ins = runOne(agent, config, spec.enabledStrategies, dataset, tag + '-in', { range: split.inSample.range });
    send({ type: 'progress', stage: 'RUNNING', detail: tag + ' out-of-sample' });
    var oos = runOne(agent, config, spec.enabledStrategies, dataset, tag + '-oos', { range: split.outOfSample.range });
    send({ type: 'progress', stage: 'RUNNING', detail: tag + ' walk-forward' });
    var wf = null, wfError = null;
    try {
      var folds = agent.walkForward.rollingFolds(series, {
        inSampleBars: Math.floor(series.length * 0.3), outOfSampleBars: Math.floor(series.length * 0.15),
        warmupBars: config.backtest.warmupBars
      });
      wf = agent.walkForward.evaluate({
        folds: folds,
        runSegment: function (segment) {
          return { metrics: runOne(agent, config, spec.enabledStrategies, dataset, tag + '-' + segment.label, { range: segment.range }).metrics };
        }
      });
    } catch (e) { wfError = e.message; }
    return { inSample: { metrics: ins.metrics }, outOfSample: { metrics: oos.metrics, trades: oos.trades },
      walkForward: wf, walkForwardError: wfError, full: null };
  }

  var base = side(baseline, 'baseline');
  var vari = side(variant, 'variant');

  send({ type: 'progress', stage: 'RUNNING', detail: 'stress' });
  var variantFull = runOne(agent, variant, spec.enabledStrategies, dataset, 'variant-stress-baseline');
  var suite = agent.stressSuite.create({
    config: variant,
    logger: agent.logger.nullLogger(),
    seed: 'control-center-experiment',
    runVariant: function (override, label, opts) {
      var cfg = agent.config.load(agent.config.deepMerge(strip(agent.config.serialise(variant)), override));
      var ds = dataset;
      if (opts && opts.dropFraction) {
        var rng = agent.rng.create(opts.seed || 'gaps');
        var thinned = {};
        dataset.symbols.forEach(function (s) {
          thinned[s] = {};
          thinned[s][dataset.timeframe] = dataset.raw[s][dataset.timeframe].filter(function () { return rng.float() >= opts.dropFraction; });
        });
        ds = {
          source: agent.source.fromBars({ kind: 'gapped', datasetVersion: 'gapped', data: thinned }),
          raw: thinned, timeframe: dataset.timeframe, symbols: dataset.symbols
        };
      }
      var r = runOne(agent, cfg, spec.enabledStrategies, ds, label);
      return { metrics: r.metrics, trades: r.trades, timeline: r.timeline };
    }
  });
  var stress = suite.run({ baseline: { metrics: variantFull.metrics, trades: variantFull.trades } });

  var researcher = agent.researchAgent.create({ minSample: 10 });
  var comparison = researcher.compare({
    baseline: { inSample: base.inSample, outOfSample: base.outOfSample, walkForward: base.walkForward || undefined },
    variant: { inSample: vari.inSample, outOfSample: vari.outOfSample, walkForward: vari.walkForward || undefined },
    hypothesis: spec.proposal.hypothesis || undefined,
    stress: stress
  });

  function headline(m) { return agent.metrics.headline(m); }
  function full(m) {
    return {
      expectancy: m.expectancy, maxDrawdownPct: m.maxDrawdownPct, maxConsecutiveLosses: m.maxConsecutiveLosses,
      profitFactor: m.profitFactor, winRate: m.winRate, tradeCount: m.tradeCount, totalCosts: m.totalCosts,
      netPnl: m.netPnl, returnPct: m.returnPct, maxRecoveryLevel: m.maxRecoveryLevel,
      tradesAtRecoveryLevel: m.tradesAtRecoveryLevel
    };
  }
  var result = {
    runId: job.runId,
    kind: 'EXPERIMENT',
    commit: job.commit,
    proposal: spec.proposal,
    baselineConfigHash: baseline.fingerprint.hash,
    variantConfigHash: variant.fingerprint.hash,
    variantOverrides: variantOverrides,
    data: {
      kind: dataset.provenance.kind, label: dataset.provenance.label, datasetVersion: dataset.datasetVersion,
      timeframe: dataset.timeframe, symbols: dataset.symbols, window: dataset.window
    },
    segments: { inSample: split.inSample.range, outOfSample: split.outOfSample.range },
    baseline: {
      inSample: full(base.inSample.metrics), outOfSample: full(base.outOfSample.metrics),
      walkForward: base.walkForward ? base.walkForward.aggregate : null, walkForwardError: base.walkForwardError
    },
    variant: {
      inSample: full(vari.inSample.metrics), outOfSample: full(vari.outOfSample.metrics),
      walkForward: vari.walkForward ? vari.walkForward.aggregate : null, walkForwardError: vari.walkForwardError
    },
    stress: {
      survived: stress.survived, reason: stress.reason, scenariosRun: stress.scenariosRun,
      scenariosFailed: stress.scenariosFailed, scenariosSkipped: stress.scenariosSkipped,
      coverageWarning: stress.coverageWarning,
      scenarios: stress.scenarios.map(function (s) {
        return { scenario: s.scenario, passed: s.passed, skipped: !!s.skipped,
          metrics: s.metrics ? headline(s.metrics) : null, failures: s.failures };
      })
    },
    comparison: comparison,
    note: 'Synthetic data. A verdict here is about mechanics under this dataset, not about edge.'
  };
  writeJSON(path.join(job.runDir, 'result.json'), result);
  return {
    verdict: comparison.verdict,
    blockers: comparison.blockers.map(function (b) { return b.code; }),
    baselineConfigHash: baseline.fingerprint.hash,
    variantConfigHash: variant.fingerprint.hash,
    data: result.data
  };
}

function main(job) {
  var agent = require('../agent').load(job.agentRoot);
  var summary;
  if (job.kind === 'BACKTEST') summary = backtest(agent, job);
  else if (job.kind === 'EXPERIMENT') summary = experiment(agent, job);
  else throw new Error('unknown job kind ' + job.kind);
  send({ type: 'done', summary: summary });
}

var started = false;
process.on('message', function (job) {
  if (started) return;
  started = true;
  try {
    main(job);
    // Give the IPC channel a turn to flush before exiting.
    setImmediate(function () { process.exit(0); });
  } catch (e) {
    send({
      type: 'failed',
      error: {
        message: String(e && e.message ? e.message : e).slice(0, 2000),
        code: e && e.code ? String(e.code) : 'JOB_FAILED',
        refusal: !!(e && e.refusal),
        problems: e && e.details && Array.isArray(e.details.problems) ? e.details.problems.slice(0, 50) : null
      }
    });
    setImmediate(function () { process.exit(1); });
  }
});

// A job that never receives its spec must not linger.
setTimeout(function () { if (!started) process.exit(2); }, 15000).unref();
