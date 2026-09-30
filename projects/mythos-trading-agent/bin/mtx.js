#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS TRADING AGENT — command line interface
// projects/mythos-trading-agent/bin/mtx.js
//
//   node bin/mtx.js status                  the platform's own state and limits
//   node bin/mtx.js health                  run the health checks
//   node bin/mtx.js backtest [options]      one backtest over the fixtures
//   node bin/mtx.js walkforward [options]   rolling in/out-of-sample folds
//   node bin/mtx.js analyse [options]       backtest, then the Analysis Agent
//   node bin/mtx.js research [options]      analyse, then hypotheses and proposals
//   node bin/mtx.js stress [options]        backtest, then the stress suite
//
// Options: --symbols EURUSD,XAUUSD  --bars 3000  --capital 100  --jev 45
//          --recovery  --seed LABEL  --json  --store DIR
//
// WHAT THIS CLI CANNOT DO, BY CONSTRUCTION:
//   * it cannot reach PAPER or LIVE. There is no --mode flag, because the mode
//     changes only through an owner-approval record (src/mode/mode-controller.js),
//     and a command-line flag is exactly the thing that must not substitute for one.
//   * it cannot promote a champion. Promotion refuses an AGENT principal, and
//     anything invoked from a shell in an autonomous run is one.
//   * it places no order. There is no venue, no credential and no network client.
//
// Every command prints the cost, drawdown and losing-streak figures alongside any
// profit figure, because mission §9 forbids reporting a gross result as if it were
// profitability.
// =====================================================

var path = require('path');

var SRC = path.join(__dirname, '..', 'src');
var configMod = require(path.join(SRC, 'config'));
var engine = require(path.join(SRC, 'backtest', 'engine'));
var walkForward = require(path.join(SRC, 'backtest', 'walk-forward'));
var tradingAgent = require(path.join(SRC, 'agents', 'trading-agent'));
var analysisAgent = require(path.join(SRC, 'agents', 'analysis-agent'));
var researchAgent = require(path.join(SRC, 'agents', 'research-agent'));
var stressSuite = require(path.join(SRC, 'stress', 'suite'));
var healthMod = require(path.join(SRC, 'observability', 'health'));
var championMod = require(path.join(SRC, 'champion', 'registry'));
var fixtureSource = require(path.join(SRC, 'data', 'fixture-source'));
var sourceMod = require(path.join(SRC, 'data', 'source'));
var loggerMod = require(path.join(SRC, 'core', 'logger'));
var metricsMod = require(path.join(SRC, 'backtest', 'metrics'));
var gates = require(path.join(SRC, 'mode', 'gates'));
var money = require(path.join(SRC, 'core', 'money'));

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var out = { command: argv[0] || 'status', flags: {} };
  for (var i = 1; i < argv.length; i++) {
    var a = argv[i];
    if (a.slice(0, 2) !== '--') continue;
    var key = a.slice(2);
    var next = argv[i + 1];
    if (next === undefined || next.slice(0, 2) === '--') {
      out.flags[key] = true;
    } else {
      out.flags[key] = next;
      i++;
    }
  }
  return out;
}

function buildConfig(flags) {
  var symbols = flags.symbols ? String(flags.symbols).split(',') : ['EURUSD'];
  var probe = tradingAgent.create({ config: configMod.load({ universe: symbols }) });
  var over = {
    universe: symbols,
    backtest: { warmupBars: probe.warmupBars(), seed: flags.seed ? String(flags.seed) : 'cli' },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 }
  };
  if (flags.capital) over.account = { initialCapital: Number(flags.capital) };
  if (flags.jev) over.jev = { scoreThreshold: Number(flags.jev), minConfidence: 0.15 };
  if (flags.recovery) over.recovery = { enabled: true, maxRecoveryLevel: 3 };
  return configMod.load(over);
}

function loadBars(cfg, flags) {
  var fixtures = fixtureSource.createSource();
  var n = flags.bars ? Number(flags.bars) : 3000;
  var data = {};
  cfg.universe.forEach(function (s) {
    if (!fixtures.symbols().length || fixtures.timeframes(s).length === 0) {
      fail('no committed fixture for ' + s + '. Available: ' + fixtures.symbols().join(', ') +
        '. Regenerate with: node bin/make-fixtures.js');
    }
    data[s] = { M15: fixtures.load(s, 'M15').slice(0, n) };
  });
  return {
    source: sourceMod.fromBars({ kind: 'fixture-window', datasetVersion: fixtures.datasetVersion + ':' + n, data: data }),
    raw: data,
    datasetVersion: fixtures.datasetVersion
  };
}

function runBacktest(cfg, bars, label, storeDir) {
  var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
  var res = engine.run({
    config: cfg,
    source: bars.source,
    label: label || 'cli',
    logger: loggerMod.nullLogger(),
    decide: wired.engineHooks.decide,
    onRunStart: wired.engineHooks.onRunStart,
    onSeriesReady: wired.engineHooks.onSeriesReady,
    onBar: wired.engineHooks.onBar,
    onTradeClosed: wired.engineHooks.onTradeClosed
  });
  res.agent = wired.agent;
  if (storeDir) {
    var written = res.store.seal();
    out('store sealed: ' + res.store.dir + ' (' + written.rows + ' rows)');
  }
  return res;
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

var JSON_MODE = false;
function out(line) { if (!JSON_MODE) process.stdout.write(line + '\n'); }
function emit(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function fail(message) {
  process.stderr.write('mtx: ' + message + '\n');
  process.exit(1);
}

/**
 * Mission §9: a profit figure is never printed without its costs, its drawdown and
 * its losing streak beside it.
 */
function printMetrics(m, label) {
  out('');
  out((label || 'RESULT') + ':');
  out('  trades            ' + m.tradeCount);
  out('  win rate          ' + (m.winRate === null ? 'n/a' : (100 * m.winRate).toFixed(1) + '%'));
  out('  GROSS P&L         ' + m.grossPnl);
  out('  costs             ' + m.totalCosts + (m.costRatio === null ? '' : '  (' + (100 * m.costRatio).toFixed(1) + '% of gross profit)'));
  out('  NET P&L           ' + m.netPnl + '   <- the only profitability figure');
  out('  expectancy/trade  ' + (m.expectancy === null ? 'n/a' : m.expectancy));
  out('  profit factor     ' + (m.profitFactor === null ? 'n/a (no losses in sample)' : m.profitFactor));
  out('  max drawdown      ' + m.maxDrawdownPct + '%   (' + m.equityCurveSource + ')');
  out('  max loss streak   ' + m.maxConsecutiveLosses);
  out('  return/drawdown   ' + (m.returnOverMaxDrawdown === null ? 'n/a' : m.returnOverMaxDrawdown));
  out('  max recovery lvl  ' + m.maxRecoveryLevel);
  if (m.streakProbabilities && m.streakProbabilities.length) {
    out('  P(k consecutive losses), measured:');
    m.streakProbabilities.slice(0, 5).forEach(function (p) {
      out('    k=' + p.k + '  ' + (100 * p.probability).toFixed(2) + '%  (' + p.hits + '/' + p.windows + ' windows)');
    });
  }
}

function printCaveats() {
  out('');
  out('CAVEATS (docs/COMPLIANCE_AND_RISK.md):');
  out('  * Data is synthetic/fixture. It validates MECHANICS only — no statement');
  out('    about edge or profitability can be derived from it (§3.4).');
  out('  * Cost figures are documented estimates, not a named venue\'s schedule (§2.6).');
  out('  * No profitability or regulatory-compliance claim is made.');
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

var COMMANDS = {

  status: function (flags) {
    var cfg = buildConfig(flags);
    var agent = tradingAgent.create({ config: cfg });
    var registry = championMod.create({});
    var info = {
      mode: cfg.mode,
      modeReachableFromCli: ['BACKTEST'],
      configHash: cfg.fingerprint.shortHash,
      capital: cfg.account.initialCapital,
      universe: cfg.universe,
      strategies: agent.components.registry.count(),
      warmupBars: agent.warmupBars(),
      risk: agent.components.risk.limits(),
      recovery: agent.components.recovery.config(),
      jev: { model: cfg.jev.model, threshold: cfg.jev.scoreThreshold, minConfidence: cfg.jev.minConfidence },
      liveExecution: 'REFUSED — the adapter throws on every call; see src/execution/live-adapter.js',
      promotionRequires: championMod.REQUIRED_EVIDENCE,
      unsatisfiableInBacktest: championMod.REQUIRES_PAPER_MODE,
      paperRequires: 'an owner-approval record; ' + gates.REQUIRED['BACKTEST->PAPER'].length + ' gates'
    };
    if (JSON_MODE) return emit(info);
    out('MYTHOS TRADING AGENT — status');
    out('  mode                 ' + info.mode + '   (this CLI cannot reach PAPER or LIVE)');
    out('  config               ' + info.configHash);
    out('  capital              $' + info.capital);
    out('  universe             ' + info.universe.join(', '));
    out('  strategies           ' + info.strategies + ' families');
    out('  warmup               ' + info.warmupBars + ' bars');
    out('  live execution       ' + info.liveExecution);
    out('');
    out('  RISK LIMITS (the Risk Engine has final authority):');
    Object.keys(info.risk).forEach(function (k) { out('    ' + k.padEnd(30) + info.risk[k]); });
    out('');
    out('  RECOVERY x3:');
    out('    enabled                      ' + info.recovery.enabled + (info.recovery.enabled ? '' : '   (opt-in, off by default)'));
    out('    ladder                       ' + info.recovery.ladder.join(' -> '));
    out('    maxRecoveryLevel             ' + info.recovery.maxRecoveryLevel);
    out('');
    out('  PROMOTION needs ' + info.promotionRequires.length + ' kinds of evidence across >=2 data segments.');
    out('    Unsatisfiable in BACKTEST:   ' + info.unsatisfiableInBacktest.join(', '));
    out('  PAPER needs                    ' + info.paperRequires);
  },

  health: function (flags) {
    var cfg = buildConfig(flags);
    var bars = loadBars(cfg, flags);
    var run = runBacktest(cfg, bars, 'health');
    var rerun = runBacktest(cfg, loadBars(cfg, flags), 'health');
    var health = healthMod.create({ config: cfg, logger: loggerMod.nullLogger() });
    var rep = health.report({ run: run, rerun: rerun });
    if (JSON_MODE) return emit(rep);
    out('MYTHOS TRADING AGENT — health: ' + health.summarise(rep));
    out('');
    rep.checks.forEach(function (c) {
      out('  [' + c.status.padEnd(7) + '] ' + c.check);
      out('            ' + c.detail);
    });
    if (rep.note) { out(''); out('  ' + rep.note); }
    if (rep.status === 'FAIL') process.exitCode = 1;
  },

  backtest: function (flags) {
    var cfg = buildConfig(flags);
    var bars = loadBars(cfg, flags);
    var run = runBacktest(cfg, bars, 'cli-backtest', flags.store);
    if (JSON_MODE) {
      return emit({
        configHash: cfg.fingerprint.hash, datasetVersion: run.datasetVersion,
        metrics: run.metrics, counts: run.counts, digest: run.digest(),
        emergencyStopped: run.emergencyStopped, emergencyReason: run.emergencyReason
      });
    }
    out('backtest  config ' + cfg.fingerprint.shortHash + '  data ' + run.datasetVersion);
    out('  bars ' + run.timeline.bars + '  symbols ' + cfg.universe.join(',') + '  capital $' + cfg.account.initialCapital);
    var c = run.agent.counts();
    out('');
    out('PIPELINE FUNNEL (mission §3):');
    out('  bars classified   ' + c.barsClassified);
    out('  decisions asked   ' + c.decisionsRequested + '   (only when the single trade slot is free)');
    out('  candidates built  ' + c.candidatesBuilt);
    out('  rejected by cost  ' + c.rejectedByCost);
    out('  rejected by Jev   ' + c.rejectedByJev);
    out('  blocked by risk   ' + c.blockedByRisk);
    out('  clamped by risk   ' + c.clampedByRisk);
    out('  orders proposed   ' + c.ordersProposed);
    out('  slot blocked      ' + run.counts.slotBlocked);
    printMetrics(run.metrics, 'RESULT');
    if (run.emergencyStopped) { out(''); out('  EMERGENCY STOPPED: ' + run.emergencyReason); }
    out('');
    out('  store digest      ' + run.digest());
    printCaveats();
  },

  walkforward: function (flags) {
    var cfg = buildConfig(flags);
    var bars = loadBars(cfg, flags);
    var symbol = cfg.universe[0];
    var series = bars.raw[symbol].M15;
    var folds;
    try {
      folds = walkForward.rollingFolds(series, {
        inSampleBars: Number(flags.insample || 900),
        outOfSampleBars: Number(flags.outsample || 450),
        warmupBars: cfg.backtest.warmupBars,
        maxFolds: flags.folds ? Number(flags.folds) : undefined
      });
    } catch (e) { fail(e.message); }

    var res = walkForward.evaluate({
      folds: folds,
      runSegment: function (segment) {
        var wired = tradingAgent.wire({ config: cfg, logger: loggerMod.nullLogger() });
        var r = engine.run({
          config: cfg, source: bars.source, range: segment.range, label: segment.label,
          logger: loggerMod.nullLogger(),
          decide: wired.engineHooks.decide, onRunStart: wired.engineHooks.onRunStart,
          onSeriesReady: wired.engineHooks.onSeriesReady, onBar: wired.engineHooks.onBar,
          onTradeClosed: wired.engineHooks.onTradeClosed
        });
        return { metrics: r.metrics };
      }
    });
    if (JSON_MODE) return emit({ folds: walkForward.describe(folds), aggregate: res.aggregate });
    out('walk-forward  ' + folds.length + ' folds  config ' + cfg.fingerprint.shortHash);
    out('');
    res.folds.forEach(function (f, i) {
      out('  fold ' + i + '  in-sample: ' + f.inSample.metrics.tradeCount + ' trades net ' +
        f.inSample.metrics.netPnl + '   out-of-sample: ' + f.outOfSample.metrics.tradeCount +
        ' trades net ' + f.outOfSample.metrics.netPnl);
    });
    var a = res.aggregate;
    out('');
    out('AGGREGATE:');
    out('  in-sample     net ' + a.inSample.totalNetPnl + '  expectancy ' + a.inSample.meanExpectancy +
      '  worst streak ' + a.inSample.worstMaxConsecutiveLosses);
    out('  out-of-sample net ' + a.outOfSample.totalNetPnl + '  expectancy ' + a.outOfSample.meanExpectancy +
      '  worst streak ' + a.outOfSample.worstMaxConsecutiveLosses);
    out('  profitable folds  ' + a.outOfSample.profitableFolds + '/' + a.folds);
    out('  DEGRADATION       ' + (a.degradation === null ? 'n/a — ' + a.degradationNote : a.degradation +
      '   (out-of-sample expectancy / in-sample; 1 means the result held)'));
    printCaveats();
  },

  analyse: function (flags) {
    var cfg = buildConfig(flags);
    var bars = loadBars(cfg, flags);
    var run = runBacktest(cfg, bars, 'cli-analyse');
    var agent = analysisAgent.create({ minSample: flags.minsample ? Number(flags.minsample) : 20 });
    var report = agent.analyse({ store: run.store, initialCapital: cfg.account.initialCapital, label: 'cli' });
    if (JSON_MODE) return emit(report);
    out('analysis  ' + agent.summarise(report));
    out('');
    out('FUNNEL: ' + report.funnel.candidatesBuilt + ' candidates -> ' + report.funnel.entered + ' entered (' +
      (100 * report.funnel.entryRate).toFixed(2) + '%)');
    Object.keys(report.funnel.rejectedByStage).forEach(function (s) {
      var st = report.funnel.rejectedByStage[s];
      out('  ' + s.padEnd(12) + st.rejected + '  top: ' +
        st.topReasons.slice(0, 3).map(function (r) { return r.value + '(' + r.count + ')'; }).join(' '));
    });
    out('');
    out('BY STRATEGY (sample size / sufficient):');
    Object.keys(report.byStrategy).forEach(function (k) {
      var g = report.byStrategy[k];
      out('  ' + k.padEnd(24) + 'n=' + String(g.sampleSize).padStart(4) + (g.sufficient ? ' [ok]  ' : ' [thin]') +
        '  net ' + g.netPnl + '  expectancy ' + g.expectancy + '  maxStreak ' + g.maxConsecutiveLosses);
    });
    out('');
    out('JEV: ' + report.jev.verdicts + ' verdicts, ' + (100 * report.jev.enterRate).toFixed(1) + '% entered');
    out('  interpretation: ' + report.jev.interpretation.conclusion);
    out('  ' + report.jev.interpretation.detail);
    out('');
    out('LOSING STREAKS: max ' + report.losingStreaks.maxConsecutiveLosses +
      ', avg ' + report.losingStreaks.avgLosingStreak + ', histogram ' + JSON.stringify(report.losingStreaks.histogram));
    out('DRAWDOWN: max ' + report.drawdown.maxDrawdownPct + '%, ' +
      report.drawdown.episodesOverOnePercent + ' episodes over 1%' +
      (report.drawdown.neverRecovered ? ', NEVER RECOVERED' : ''));
    out('COSTS: gross ' + report.costs.grossPnl + ' - costs ' + report.costs.totalCosts +
      ' = net ' + report.costs.netPnl + (report.costs.costsFlippedTheSign ? '   <- COSTS FLIPPED THE SIGN' : ''));
    out('');
    out('CAVEATS:');
    report.caveats.forEach(function (c) { out('  * ' + c); });
  },

  research: function (flags) {
    var cfg = buildConfig(flags);
    var bars = loadBars(cfg, flags);
    var run = runBacktest(cfg, bars, 'cli-research');
    var report = analysisAgent.create({ minSample: flags.minsample ? Number(flags.minsample) : 10 })
      .analyse({ store: run.store, initialCapital: cfg.account.initialCapital });
    var agent = researchAgent.create({ minSample: flags.minsample ? Number(flags.minsample) : 10 });
    var res = agent.research({ report: report, config: cfg });
    if (JSON_MODE) return emit(res);
    out('research  ' + res.observations.length + ' observations, ' + res.actionable + ' actionable, ' +
      res.hypotheses.length + ' hypotheses');
    out('  authority: ' + res.authority + ' — nothing here changes any rule');
    out('');
    res.observations.forEach(function (o) {
      out('  OBSERVATION ' + o.kind + '  (' + o.subject + ', n=' + o.sampleSize +
        (o.actionable ? '' : ', NOT actionable') + ')');
    });
    out('');
    res.hypotheses.forEach(function (h) {
      out('  HYPOTHESIS ' + h.hypothesisId);
      out('    claim:        ' + h.statement);
      out('    change:       ' + JSON.stringify(h.proposedChange));
      out('    REFUTED IF:   ' + h.falsification);
    });
    out('');
    out('NEXT: ' + res.nextStep);
  },

  stress: function (flags) {
    var cfg = buildConfig(flags);
    var bars = loadBars(cfg, flags);
    var baseline = runBacktest(cfg, bars, 'cli-stress-baseline');
    var suite = stressSuite.create({
      config: cfg,
      logger: loggerMod.nullLogger(),
      seed: flags.seed ? String(flags.seed) : 'cli-stress',
      runVariant: function (override, label, opts) {
        // Data-gap and adverse-regime scenarios ask the caller to change the data;
        // this CLI supports the gap case and skips the forced-regime one, which
        // needs the synthetic generator rather than a fixture.
        var variantCfg = configMod.load(configMod.deepMerge(configMod.serialise(cfg), override));
        var variantBars = bars;
        if (opts && opts.dropFraction) {
          var rng = require(path.join(SRC, 'core', 'rng')).create(opts.seed || 'gaps');
          var thinned = {};
          Object.keys(bars.raw).forEach(function (s) {
            thinned[s] = { M15: bars.raw[s].M15.filter(function () { return rng.float() >= opts.dropFraction; }) };
          });
          variantBars = {
            source: sourceMod.fromBars({ kind: 'gapped', datasetVersion: 'gapped', data: thinned }),
            raw: thinned, datasetVersion: 'gapped'
          };
        }
        var r = runBacktest(variantCfg, variantBars, label);
        return { metrics: r.metrics, trades: r.trades, timeline: r.timeline };
      }
    });
    var res = suite.run({ baseline: { metrics: baseline.metrics, trades: baseline.trades } });
    if (JSON_MODE) return emit(res);
    out('stress  survived=' + res.survived + '  ' + res.scenariosRun + ' scenarios, ' +
      res.scenariosFailed + ' failed, ' + res.scenariosSkipped + ' skipped');
    out('');
    res.scenarios.forEach(function (s) {
      out('  [' + (s.skipped ? 'SKIP' : (s.passed ? 'PASS' : 'FAIL')) + '] ' + s.scenario +
        (s.metrics ? '  net ' + s.metrics.netPnl + '  maxDD ' + s.metrics.maxDrawdownPct +
          '%  streak ' + s.metrics.maxConsecutiveLosses : ''));
      s.failures.forEach(function (f) {
        out('          ' + f.limit + ': ' + f.observed + ' exceeds ' + f.allowed);
      });
      if (s.skipped) out('          ' + s.detail.note);
    });
    if (res.coverageWarning) { out(''); out('  ' + res.coverageWarning); }
    if (!res.survived) { out(''); out('  REASON: ' + res.reason); }
    printCaveats();
    if (!res.survived) process.exitCode = 1;
  },

  help: function () {
    out('MYTHOS TRADING AGENT');
    out('');
    out('  node bin/mtx.js <command> [options]');
    out('');
    out('COMMANDS');
    out('  status        the platform\'s mode, limits, recovery ladder and gates');
    out('  health        run the health checks against a fresh backtest');
    out('  backtest      one backtest over the committed fixtures');
    out('  walkforward   rolling in-sample / out-of-sample folds');
    out('  analyse       backtest, then the Analysis Agent\'s report');
    out('  research      analyse, then hypotheses with their falsification criteria');
    out('  stress        backtest, then the stress suite');
    out('');
    out('OPTIONS');
    out('  --symbols EURUSD,XAUUSD   --bars 3000     --capital 100');
    out('  --jev 45                  --recovery      --seed LABEL');
    out('  --insample 900            --outsample 450 --folds 3');
    out('  --minsample 20            --store DIR     --json');
    out('');
    out('THIS CLI CANNOT reach PAPER or LIVE (no --mode flag exists: the mode changes');
    out('only through an owner-approval record), promote a champion (promotion refuses');
    out('an AGENT principal), or place an order (there is no venue and no network client).');
  }
};

// ---------------------------------------------------------------------------

function main() {
  var parsed = parseArgs(process.argv.slice(2));
  JSON_MODE = !!parsed.flags.json;
  var cmd = COMMANDS[parsed.command];
  if (!cmd) {
    if (parsed.command === '--help' || parsed.command === '-h') return COMMANDS.help();
    process.stderr.write('mtx: unknown command "' + parsed.command + '"\n\n');
    COMMANDS.help();
    process.exit(1);
  }
  try {
    cmd(parsed.flags);
  } catch (e) {
    // A designed refusal is not a crash, and the exit code says which it was.
    var refusal = e && e.refusal === true;
    process.stderr.write('mtx: ' + (refusal ? 'REFUSED — ' : 'error — ') + e.message + '\n');
    process.exit(refusal ? 2 : 1);
  }
}

if (require.main === module) main();

module.exports = { parseArgs: parseArgs, buildConfig: buildConfig, COMMANDS: Object.keys(COMMANDS) };
