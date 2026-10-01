'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — research and champion/challenger
// projects/mythos-trading-control-center/server/research.js
//
// A thin, journalled wrapper around the Trading Agent's own champion registry
// (src/champion/registry.js). The registry decides everything that matters:
// which evidence is acceptable, whether a challenger is promotable, and that
// an AGENT may never change what is approved. This file adds two things only.
//
//  1. A JOURNAL. The registry is in-memory. Every call that changed it is
//     appended to research-journal.jsonl and replayed at start-up through the
//     SAME registry functions, so the state after a restart is the state the
//     gate produced — never a snapshot somebody could have edited into a
//     champion.
//
//  2. EVIDENCE COLLECTION FROM RECORDED RUNS. Evidence is built from the
//     result of an experiment or demo run that exists on disk, and is bound to
//     that run's variant config hash. The console cannot attach a free-typed
//     "passed: true".
//
// RESEARCH DOES NOT ALTER TRADING RULES. Nothing here touches the running
// configuration. A challenger is a config HASH and an inert override; even a
// promotion only records which configuration is the approved one. Putting a
// champion's settings into effect is a separate configuration change by an
// OWNER, with its own audit entry and its own mode consequences.
// =====================================================

var JOURNAL = 'research-journal.jsonl';

function refusal(code, message) {
  var e = new Error(message);
  e.code = code;
  e.refusal = true;
  return e;
}

/**
 * @param {object} spec
 * @param {object} spec.agent
 * @param {object} spec.control
 * @param {object} spec.runs
 * @param {object} spec.state
 * @param {function} [spec.now]
 */
function create(spec) {
  var agent = spec.agent;
  var control = spec.control;
  var runs = spec.runs;
  var state = spec.state;
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };

  // During replay the registry must see the clock and the mode of the moment
  // each entry was written, or a promotion that was legitimate in PAPER would
  // be refused when replayed in BACKTEST and the champion silently lost.
  var replay = null;
  var registry = agent.champion.create({
    now: function () { return replay ? replay.at : now(); },
    modeController: { mode: function () { return replay ? replay.mode : control.mode(); } }
  });
  var replayProblems = [];

  var OPS = {
    SEED_CHAMPION: function (a) { return registry.seedChampion(a); },
    REGISTER_CHALLENGER: function (a) { return registry.registerChallenger(a); },
    ATTACH_EVIDENCE: function (a) { return registry.attachEvidence(a.recordId, a.item); },
    PROMOTE: function (a) { return registry.promote(a); },
    REJECT: function (a) { return registry.reject(a.recordId, a.reason); },
    ROLLBACK: function (a) { return registry.rollback(a); }
  };

  state.readLines(JOURNAL).forEach(function (entry, i) {
    replay = { at: entry.at, mode: entry.mode };
    try {
      if (!OPS[entry.op]) throw new Error('unknown journal operation ' + entry.op);
      OPS[entry.op](entry.args);
    } catch (e) {
      replayProblems.push({ line: i + 1, op: entry.op, message: String(e.message).slice(0, 300) });
    }
  });
  replay = null;

  /** Runs an operation and journals it only if the registry accepted it. */
  function apply(op, args) {
    var at = now();
    var res = OPS[op](args);          // throws the registry's own typed refusal
    state.appendLine(JOURNAL, { at: at, mode: control.mode(), op: op, args: args });
    return res;
  }

  function requireRun(runId, kinds) {
    var run = runs.get(runId);
    if (!run) throw refusal('RUN_NOT_FOUND', 'no run ' + runId);
    if (kinds.indexOf(run.kind) === -1) throw refusal('WRONG_RUN_KIND', 'run ' + runId + ' is a ' + run.kind + ', expected ' + kinds.join(' or '));
    if (run.status !== runs.Status.COMPLETED) throw refusal('RUN_NOT_COMPLETED', 'run ' + runId + ' is ' + run.status);
    return run;
  }

  // =====================================================================
  // champion
  // =====================================================================

  function seedChampion(q, actor) {
    var cfg = control.config();
    var metrics = null;
    if (q.runId) {
      var run = requireRun(q.runId, ['BACKTEST']);
      var result = runs.readDoc(q.runId, 'result.json');
      if (!result || result.configHash !== cfg.fingerprint.hash) {
        throw refusal('RUN_CONFIG_MISMATCH', 'run ' + run.runId + ' was produced under a different configuration than the one running now');
      }
      metrics = agent.metrics.headline(result.metrics);
    }
    return apply('SEED_CHAMPION', {
      principal: control.principalFor(actor),
      configHash: cfg.fingerprint.hash,
      config: null,
      basis: q.basis,
      metrics: metrics
    });
  }

  // =====================================================================
  // challengers — only from a proposal the Research Agent actually produced
  // =====================================================================

  function findProposal(runId, proposalId) {
    requireRun(runId, ['BACKTEST', 'PAPER', 'DEMO']);
    var research = runs.readDoc(runId, 'research.json');
    if (!research) throw refusal('NO_RESEARCH_REPORT', 'run ' + runId + ' has no stored Research Agent report');
    var proposal = (research.proposals || []).filter(function (p) { return p.proposalId === proposalId; })[0];
    if (!proposal) throw refusal('PROPOSAL_NOT_FOUND', 'run ' + runId + ' has no proposal ' + proposalId);
    var hypothesis = (research.hypotheses || []).filter(function (h) { return h.hypothesisId === proposal.hypothesisId; })[0] || null;
    return { proposal: proposal, hypothesis: hypothesis };
  }

  /** The config a proposal's override would produce, validated by the agent. */
  function variantFor(override) {
    var merged = agent.config.deepMerge(control.overrides(), override);
    return agent.buildConfig(merged, control.enabledStrategies());
  }

  function registerChallenger(q, actor) {
    var found = findProposal(q.runId, q.proposalId);
    var variant = variantFor(found.proposal.override);
    return apply('REGISTER_CHALLENGER', {
      principal: control.principalFor(actor),
      configHash: variant.fingerprint.hash,
      config: null,
      baselineConfigHash: control.config().fingerprint.hash,
      hypothesisId: found.proposal.hypothesisId,
      proposalId: found.proposal.proposalId,
      override: found.proposal.override
    });
  }

  /** Used by the paper control room to build a DEMO challenger arm. */
  function challengerOverride(recordId) {
    var c = registry.challenger(recordId);
    if (!c) throw refusal('CHALLENGER_NOT_FOUND', 'no challenger ' + recordId);
    if (c.state !== agent.enums.ContenderState.CHALLENGER) throw refusal('CHALLENGER_NOT_ACTIVE', 'challenger ' + recordId + ' is ' + c.state);
    if (!c.override) throw refusal('CHALLENGER_HAS_NO_OVERRIDE', 'challenger ' + recordId + ' carries no override to run');
    return { recordId: c.recordId, configHash: c.configHash, override: c.override };
  }

  // =====================================================================
  // evidence, from recorded runs only
  // =====================================================================

  function segName(tag, range) {
    return tag + ':' + (range && range.fromTs !== undefined ? range.fromTs : '') + '-' + (range && range.toTs !== undefined ? range.toTs : '');
  }

  /**
   * Attaches the evidence an EXPERIMENT run produced. Each item's `passed` is
   * computed from the recorded numbers by the rule stated beside it; an item
   * that did not pass is attached as not passed, never omitted.
   */
  function attachExperimentEvidence(recordId, experimentRunId) {
    var c = registry.challenger(recordId);
    if (!c) throw refusal('CHALLENGER_NOT_FOUND', 'no challenger ' + recordId);
    requireRun(experimentRunId, ['EXPERIMENT']);
    var ex = runs.readDoc(experimentRunId, 'result.json');
    if (!ex) throw refusal('NO_EXPERIMENT_RESULT', 'run ' + experimentRunId + ' has no stored result');
    if (ex.variantConfigHash !== c.configHash) {
      throw refusal('EVIDENCE_CONFIG_MISMATCH',
        'experiment ' + experimentRunId + ' tested configuration ' + String(ex.variantConfigHash).slice(0, 12) +
        ' but challenger ' + recordId + ' is ' + c.configHash.slice(0, 12));
    }
    var cfg = variantFor(c.override);
    var rules = registry.rules;
    var inSeg = segName('in-sample', ex.segments.inSample);
    var outSeg = segName('out-of-sample', ex.segments.outOfSample);
    var vIn = ex.variant.inSample;
    var vOut = ex.variant.outOfSample;
    var bOut = ex.baseline.outOfSample;
    var blockers = (ex.comparison.blockers || []).map(function (b) { return b.code; });
    var source = { run: experimentRunId, dataLabel: ex.data.label, datasetVersion: ex.data.datasetVersion };
    function has(code) { return blockers.indexOf(code) !== -1; }
    var mc = ex.stress.scenarios.filter(function (s) { return /MONTE_CARLO|BOOTSTRAP|REORDER/i.test(s.scenario); });

    var items = [
      { kind: 'BACKTEST', segment: inSeg, passed: vIn.tradeCount > 0,
        metrics: vIn, detail: { rule: 'the in-sample backtest produced at least one trade' } },
      { kind: 'OUT_OF_SAMPLE', segment: outSeg,
        passed: vOut.tradeCount >= rules.minOutOfSampleTrades && vOut.expectancy !== null && vOut.expectancy > 0,
        metrics: vOut, detail: { rule: 'at least ' + rules.minOutOfSampleTrades + ' out-of-sample trades and positive net expectancy' } },
      { kind: 'WALK_FORWARD', segment: outSeg,
        passed: !!ex.variant.walkForward && !has('NO_WALK_FORWARD') && !has('WALK_FORWARD_INCONSISTENT') && !has('EXCESSIVE_DEGRADATION'),
        metrics: ex.variant.walkForward, detail: { rule: 'walk-forward ran and the Research Agent raised no walk-forward blocker', error: ex.variant.walkForwardError } },
      { kind: 'STRESS_SUITE', segment: inSeg, passed: ex.stress.survived === true,
        metrics: { scenariosRun: ex.stress.scenariosRun, scenariosFailed: ex.stress.scenariosFailed, scenariosSkipped: ex.stress.scenariosSkipped },
        detail: { rule: 'every stress scenario stayed inside its limits', reason: ex.stress.reason, coverageWarning: ex.stress.coverageWarning } },
      { kind: 'MONTE_CARLO', segment: inSeg,
        passed: mc.length > 0 && mc.every(function (s) { return s.passed && !s.skipped; }),
        metrics: { scenarios: mc.map(function (s) { return { scenario: s.scenario, passed: s.passed, skipped: s.skipped }; }) },
        detail: { rule: 'every resampling scenario ran (none skipped) and passed' } },
      { kind: 'COST_MODEL_APPLIED', segment: outSeg,
        passed: cfg.cost.includeCommission === true && cfg.cost.includeSwap === true && vOut.tradeCount > 0 && vOut.totalCosts > 0,
        metrics: { totalCosts: vOut.totalCosts, tradeCount: vOut.tradeCount },
        detail: { rule: 'commission and swap are included and the out-of-sample trades carry costs' } },
      { kind: 'DRAWDOWN_WITHIN_LIMIT', segment: outSeg, passed: vOut.maxDrawdownPct <= cfg.risk.maxDrawdownPct,
        metrics: { maxDrawdownPct: vOut.maxDrawdownPct, limit: cfg.risk.maxDrawdownPct },
        detail: { rule: 'out-of-sample maximum drawdown is inside risk.maxDrawdownPct' } },
      { kind: 'LOSING_STREAK_WITHIN_LIMIT', segment: outSeg, passed: vOut.maxConsecutiveLosses <= cfg.risk.maxConsecutiveLosses,
        metrics: { maxConsecutiveLosses: vOut.maxConsecutiveLosses, limit: cfg.risk.maxConsecutiveLosses },
        detail: { rule: 'out-of-sample longest losing streak is inside risk.maxConsecutiveLosses' } }
    ];

    var attached = items.map(function (item) {
      item.configHash = c.configHash;
      item.source = source;
      return apply('ATTACH_EVIDENCE', { recordId: recordId, item: item });
    });
    // The comparison's deltas are computed by the registry itself, so the sign
    // conventions cannot drift from the ones its gate reads.
    var cmp = registry.comparisonEvidence({
      championMetrics: bOut, challengerMetrics: vOut, configHash: c.configHash, segment: outSeg,
      championConfigHash: ex.baselineConfigHash
    });
    cmp.source = source;
    attached.push(apply('ATTACH_EVIDENCE', { recordId: recordId, item: cmp }));
    return { recordId: recordId, attached: attached.map(function (e) { return { kind: e.kind, segment: e.segment, passed: e.passed }; }) };
  }

  /** DEMO_COMPARISON, from a two-arm paper session that included this challenger. */
  function attachDemoEvidence(recordId, paperRunId) {
    var c = registry.challenger(recordId);
    if (!c) throw refusal('CHALLENGER_NOT_FOUND', 'no challenger ' + recordId);
    requireRun(paperRunId, ['DEMO']);
    var res = runs.readDoc(paperRunId, 'result.json');
    if (!res || !res.demo || res.demo.challengerRecordId !== recordId || !res.comparison) {
      throw refusal('DEMO_RUN_MISMATCH', 'run ' + paperRunId + ' is not a demo comparison for challenger ' + recordId);
    }
    var cmp = res.comparison;
    var item = {
      kind: 'DEMO_COMPARISON',
      configHash: c.configHash,
      segment: 'paper:' + paperRunId,
      passed: typeof cmp.netPnlDelta === 'number' && cmp.netPnlDelta > 0 &&
        typeof cmp.drawdownDeltaPct === 'number' && cmp.drawdownDeltaPct <= 0 && cmp.streakDelta <= 0,
      metrics: cmp,
      detail: { rule: 'the challenger arm beat the champion arm on net P&L without a deeper drawdown or a longer losing streak',
        feedKind: res.feedKind },
      source: { run: paperRunId, dataLabel: 'PAPER', datasetVersion: res.data.datasetVersion }
    };
    var e = apply('ATTACH_EVIDENCE', { recordId: recordId, item: item });
    return { recordId: recordId, attached: [{ kind: e.kind, segment: e.segment, passed: e.passed }] };
  }

  function promote(q, actor) {
    return apply('PROMOTE', { recordId: q.recordId, principal: control.principalFor(actor), basis: q.basis || null });
  }

  function reject(q) {
    return apply('REJECT', { recordId: q.recordId, reason: q.reason });
  }

  function rollback(q, actor) {
    return apply('ROLLBACK', { principal: control.principalFor(actor), reason: q.reason });
  }

  // =====================================================================
  // views
  // =====================================================================

  function evidenceView(e) {
    return { kind: e.kind, segment: e.segment, passed: e.passed, recordedAt: e.recordedAt,
      metrics: e.metrics, detail: e.detail, source: e.source };
  }

  function view() {
    var champ = registry.champion();
    var running = control.config().fingerprint.hash;
    return {
      authority: 'PROPOSAL_ONLY',
      note: 'Research proposes. Nothing here changes a trading rule; applying a configuration is a separate OWNER change.',
      runningConfigHash: running,
      champion: champ ? {
        recordId: champ.recordId, configHash: champ.configHash, origin: champ.origin, basis: champ.basis,
        promotedAt: champ.promotedAt, promotedBy: champ.promotedBy, metrics: champ.metrics,
        evidence: (champ.evidence || []).map(evidenceView),
        previousChampionConfigHash: champ.previousChampionConfigHash,
        isRunningConfig: champ.configHash === running
      } : null,
      challengers: registry.challengers().map(function (c) {
        var dry = c.state === agent.enums.ContenderState.CHALLENGER ? registry.dryRun(c.recordId) : null;
        return {
          recordId: c.recordId, configHash: c.configHash, state: c.state, createdAt: c.createdAt, createdBy: c.createdBy,
          baselineConfigHash: c.baselineConfigHash, hypothesisId: c.hypothesisId, proposalId: c.proposalId,
          override: c.override, rejectedReason: c.rejectedReason || null,
          evidence: c.evidence.map(evidenceView),
          gate: dry ? {
            promotable: dry.promotable, blockers: dry.blockers, evidencePresent: dry.evidencePresent,
            evidenceMissing: dry.evidenceMissing, distinctSegments: dry.distinctSegments,
            unsatisfiableInCurrentMode: dry.unsatisfiableInCurrentMode
          } : null
        };
      }),
      requiredEvidence: registry.REQUIRED_EVIDENCE.slice(),
      requiresPaperMode: registry.REQUIRES_PAPER_MODE.slice(),
      rules: registry.rules,
      history: registry.history().slice(-100).reverse(),
      replayProblems: replayProblems
    };
  }

  return {
    seedChampion: seedChampion,
    registerChallenger: registerChallenger,
    challengerOverride: challengerOverride,
    attachExperimentEvidence: attachExperimentEvidence,
    attachDemoEvidence: attachDemoEvidence,
    promote: promote,
    reject: reject,
    rollback: rollback,
    findProposal: findProposal,
    dryRun: function (recordId) { return registry.dryRun(recordId); },
    view: view,
    registry: function () { return registry; },
    replayProblems: function () { return replayProblems.slice(); }
  };
}

module.exports = { create: create };
