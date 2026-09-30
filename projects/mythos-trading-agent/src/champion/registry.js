'use strict';
// =====================================================
// MYTHOS TRADING AGENT — Champion / Challenger registry
// projects/mythos-trading-agent/src/champion/registry.js
//
// Mission §13:
//
//   "A Challenger may only become Champion after: backtest, out-of-sample test,
//    stress test, Monte Carlo, cost test, drawdown test, losing-streak test,
//    demo comparison. Never promote based on one profitable period."
//
// That last sentence is the hard part, because it is the one a promotion gate
// usually fails to enforce. A checklist of eight boxes can all be ticked by eight
// reports about the SAME profitable stretch of data. So this registry enforces two
// things a checklist does not:
//
//  1. EVIDENCE IS BOUND TO THE CHALLENGER'S CONFIG HASH. A stress report produced
//     under a different configuration is not evidence about this one. Unbound
//     evidence is refused at the point it is attached, not silently counted at
//     promotion time — the same binding rule the mode controller applies to owner
//     approvals, and for the same reason.
//
//  2. EVIDENCE MUST SPAN DISTINCT SEGMENTS. `minDistinctSegments` refuses a
//     promotion whose entire case comes from one window of data, however many
//     report types it was sliced into. This is the mechanical form of "never
//     promote based on one profitable period".
//
// AND AN AGENT MAY NOT PROMOTE. The champion is, in mission §13's own words, "the
// currently approved system", and approved means a person approved it. A gate that
// an autonomous agent can satisfy and then act on is not a gate — it is a delay.
// So promote() refuses an AGENT principal outright, before any evidence is read,
// exactly as the mode controller does. An agent may register challengers, attach
// evidence and call dryRun() all day; it cannot change what is approved.
//
// DEMO_COMPARISON IS UNSATISFIABLE UNTIL THE OWNER APPROVES PAPER MODE. It is
// listed rather than omitted so that an approval attempt fails with it named,
// instead of the requirement quietly not existing.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var hashMod = require('../core/hash');

/** Evidence kinds, one per item in mission §13's promotion list. */
var Evidence = Object.freeze({
  BACKTEST: 'BACKTEST',
  OUT_OF_SAMPLE: 'OUT_OF_SAMPLE',
  WALK_FORWARD: 'WALK_FORWARD',
  STRESS_SUITE: 'STRESS_SUITE',
  MONTE_CARLO: 'MONTE_CARLO',
  COST_MODEL_APPLIED: 'COST_MODEL_APPLIED',
  DRAWDOWN_WITHIN_LIMIT: 'DRAWDOWN_WITHIN_LIMIT',
  LOSING_STREAK_WITHIN_LIMIT: 'LOSING_STREAK_WITHIN_LIMIT',
  CHAMPION_COMPARISON: 'CHAMPION_COMPARISON',
  DEMO_COMPARISON: 'DEMO_COMPARISON'
});

/** Every kind above is required. The list is mission §13's, not a subset of it. */
var REQUIRED_EVIDENCE = Object.freeze(Object.keys(Evidence).map(function (k) { return Evidence[k]; }));

/**
 * Evidence that cannot be produced while the platform is in BACKTEST mode.
 * Listed, not omitted — an absent requirement is one nobody argues about.
 */
var REQUIRES_PAPER_MODE = Object.freeze([Evidence.DEMO_COMPARISON]);

/** Who is asking. Only a non-AGENT principal may change what is approved. */
var PrincipalKind = Object.freeze({
  OWNER: 'OWNER',
  OPERATOR: 'OPERATOR',
  AGENT: 'AGENT',
  SYSTEM: 'SYSTEM'
});

var DEFAULT_RULES = Object.freeze({
  /** How many distinct data segments the evidence must span. */
  minDistinctSegments: 2,
  /** Minimum out-of-sample trades behind the comparison. */
  minOutOfSampleTrades: 30,
  /** The variant must beat the champion's expectancy by more than this. */
  minExpectancyImprovement: 0,
  /** Percentage points of extra drawdown tolerated. Zero by default. */
  maxDrawdownWorseningPct: 0,
  /** Extra consecutive losses tolerated. Zero by default. */
  maxStreakWorsening: 0
});

/**
 * @param {object} spec
 * @param {object} [spec.rules]
 * @param {object} [spec.store]
 * @param {object} [spec.logger]
 * @param {function} [spec.now] () => epoch ms
 * @param {object} [spec.modeController] when given, DEMO_COMPARISON is checked
 *        against the live mode rather than assumed
 */
function create(spec) {
  var o = spec || {};
  var rules = {};
  Object.keys(DEFAULT_RULES).forEach(function (k) { rules[k] = DEFAULT_RULES[k]; });
  Object.keys(o.rules || {}).forEach(function (k) {
    if (DEFAULT_RULES[k] === undefined) {
      throw errors.ConfigError('unknown champion/challenger rule "' + k + '"');
    }
    rules[k] = o.rules[k];
  });
  Object.freeze(rules);

  var store = o.store || null;
  var logger = o.logger || require('../core/logger').nullLogger();
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var modeController = o.modeController || null;

  var champion = null;
  var challengers = Object.create(null);   // recordId → challenger
  var history = [];
  var seq = 0;

  function nextId(prefix) {
    seq++;
    return prefix + '-' + String(seq).padStart(4, '0');
  }

  function record(entry) {
    var e = { at: now(), seq: history.length };
    Object.keys(entry).forEach(function (k) { e[k] = entry[k]; });
    history.push(e);
    return e;
  }

  // =====================================================================
  // the champion
  // =====================================================================

  /**
   * Installs the first champion. Requires a non-AGENT principal for the same
   * reason promotion does: the initial champion is an approved system too.
   *
   * The first champion is allowed WITHOUT the full evidence set — there is nothing
   * to compare it against and no incumbent to protect — but it must carry a stated
   * basis, and the fact that it was seeded rather than promoted is recorded so a
   * later reader cannot mistake it for something that passed the gate.
   */
  function seedChampion(q) {
    assertPrincipal(q.principal, 'seed the initial champion');
    if (champion) {
      throw errors.PromotionRefused(
        'a champion is already installed (' + champion.configHash.slice(0, 12) + '); use promote() to replace it',
        { existing: champion.recordId }
      );
    }
    if (typeof q.configHash !== 'string' || q.configHash.length < 8) {
      throw errors.ConfigError('seedChampion needs the configuration hash it is installing');
    }
    if (typeof q.basis !== 'string' || q.basis.trim().length < 20) {
      throw errors.PromotionRefused(
        'the initial champion needs a stated basis (at least a sentence). A champion with no recorded reason ' +
        'for being the champion cannot be argued with later.',
        { basis: q.basis }
      );
    }
    champion = {
      recordId: nextId('champ'),
      configHash: q.configHash,
      config: q.config || null,
      state: enums.ContenderState.CHAMPION,
      promotedAt: now(),
      promotedBy: { kind: q.principal.kind, id: q.principal.id },
      /** SEEDED, not promoted. The distinction is permanent and visible. */
      origin: 'SEEDED',
      basis: q.basis,
      evidence: [],
      previousChampionConfigHash: null,
      metrics: q.metrics || null
    };
    persistChampion(champion);
    record({ event: 'CHAMPION_SEEDED', configHash: q.configHash, principal: q.principal.kind });
    logger.warn('champion.seeded', { configHash: q.configHash.slice(0, 12), principal: q.principal.kind });
    return champion;
  }

  // =====================================================================
  // challengers
  // =====================================================================

  /**
   * Registers a challenger. An AGENT may do this — proposing and testing is the
   * Research Agent's job, and nothing is approved by registering.
   */
  function registerChallenger(q) {
    if (typeof q.configHash !== 'string' || q.configHash.length < 8) {
      throw errors.ConfigError('registerChallenger needs the configuration hash it is testing');
    }
    if (champion && q.configHash === champion.configHash) {
      throw errors.PromotionRefused(
        'the proposed challenger has the same configuration hash as the champion; there is nothing to compare',
        { configHash: q.configHash }
      );
    }
    var existing = Object.keys(challengers).filter(function (id) {
      return challengers[id].configHash === q.configHash &&
        challengers[id].state === enums.ContenderState.CHALLENGER;
    });
    if (existing.length) {
      throw errors.PromotionRefused(
        'configuration ' + q.configHash.slice(0, 12) + ' is already registered as challenger ' + existing[0],
        { existing: existing[0] }
      );
    }

    var c = {
      recordId: nextId('chal'),
      configHash: q.configHash,
      config: q.config || null,
      state: enums.ContenderState.CHALLENGER,
      createdAt: now(),
      createdBy: q.principal ? { kind: q.principal.kind, id: q.principal.id } : null,
      baselineConfigHash: champion ? champion.configHash : (q.baselineConfigHash || null),
      hypothesisId: q.hypothesisId || null,
      proposalId: q.proposalId || null,
      override: q.override || null,
      evidence: [],
      rejectedReason: null
    };
    challengers[c.recordId] = c;
    persistChallenger(c);
    record({ event: 'CHALLENGER_REGISTERED', recordId: c.recordId, configHash: c.configHash });
    logger.info('challenger.registered', {
      recordId: c.recordId, configHash: c.configHash.slice(0, 12), hypothesisId: c.hypothesisId
    });
    return c;
  }

  /**
   * Attaches one piece of evidence.
   *
   * THE BINDING CHECK HAPPENS HERE, not at promotion time. A stress report produced
   * under a different configuration is not evidence about this challenger, and
   * refusing it at attachment means the challenger's evidence list is always
   * exactly what it claims to be.
   */
  function attachEvidence(recordId, item) {
    var c = getChallenger(recordId);
    if (c.state !== enums.ContenderState.CHALLENGER) {
      throw errors.PromotionRefused(
        'challenger ' + recordId + ' is ' + c.state + '; evidence can only be attached while it is a CHALLENGER',
        { state: c.state }
      );
    }
    if (!Evidence[item.kind]) {
      throw errors.ConfigError(
        'unknown evidence kind "' + item.kind + '"; expected one of [' + REQUIRED_EVIDENCE.join(', ') + ']'
      );
    }
    if (item.configHash !== c.configHash) {
      throw errors.PromotionRefused(
        'evidence ' + item.kind + ' was produced under configuration ' +
        String(item.configHash).slice(0, 12) + ' but challenger ' + recordId + ' is ' +
        c.configHash.slice(0, 12) + '. Evidence about a different configuration is not evidence about this one.',
        { evidenceConfigHash: item.configHash, challengerConfigHash: c.configHash }
      );
    }
    if (typeof item.passed !== 'boolean') {
      throw errors.ConfigError('evidence ' + item.kind + ' must state passed: true or false explicitly');
    }
    if (typeof item.segment !== 'string' || item.segment.length === 0) {
      throw errors.ConfigError(
        'evidence ' + item.kind + ' must name the data SEGMENT it came from. Without it, eight reports about ' +
        'one profitable window are indistinguishable from eight independent tests.'
      );
    }

    var e = {
      kind: item.kind,
      configHash: item.configHash,
      segment: item.segment,
      passed: item.passed,
      recordedAt: now(),
      detail: item.detail || null,
      metrics: item.metrics || null,
      source: item.source || null
    };
    // Later evidence of the same kind from the same segment replaces the earlier,
    // so a re-run does not accumulate duplicates that would inflate the segment
    // count. Different segments are kept side by side, which is the point.
    c.evidence = c.evidence.filter(function (x) {
      return !(x.kind === e.kind && x.segment === e.segment);
    });
    c.evidence.push(e);
    record({ event: 'EVIDENCE_ATTACHED', recordId: recordId, kind: e.kind, segment: e.segment, passed: e.passed });
    logger.debug('challenger.evidence', { recordId: recordId, kind: e.kind, segment: e.segment, passed: e.passed });
    return e;
  }

  // =====================================================================
  // the gate
  // =====================================================================

  /**
   * Reports whether a challenger WOULD be promotable, and why not. Read-only, so
   * an agent may call it freely — which is the point of separating it from
   * promote().
   */
  function dryRun(recordId) {
    var c = getChallenger(recordId);
    var blockers = [];
    var byKind = Object.create(null);
    c.evidence.forEach(function (e) {
      if (!byKind[e.kind]) byKind[e.kind] = [];
      byKind[e.kind].push(e);
    });

    // 1. every required kind present, and passing.
    var missing = REQUIRED_EVIDENCE.filter(function (k) { return !byKind[k]; });
    if (missing.length) {
      blockers.push({
        code: 'MISSING_EVIDENCE',
        detail: 'no evidence of: ' + missing.join(', '),
        missing: missing
      });
    }
    var failing = c.evidence.filter(function (e) { return !e.passed; });
    if (failing.length) {
      blockers.push({
        code: 'FAILED_EVIDENCE',
        detail: failing.map(function (e) { return e.kind + '@' + e.segment; }).join(', ') + ' did not pass',
        failing: failing.map(function (e) { return { kind: e.kind, segment: e.segment }; })
      });
    }

    // 2. NEVER ON ONE PROFITABLE PERIOD. Distinct segments, not distinct reports.
    var segments = {};
    c.evidence.forEach(function (e) { segments[e.segment] = true; });
    var distinct = Object.keys(segments);
    if (distinct.length < rules.minDistinctSegments) {
      blockers.push({
        code: 'SINGLE_PERIOD_EVIDENCE',
        detail: 'all evidence comes from ' + distinct.length + ' data segment(s) (' + distinct.join(', ') +
          '); mission §13 forbids promoting on one profitable period, so at least ' +
          rules.minDistinctSegments + ' distinct segments are required',
        segments: distinct
      });
    }

    // 3. the comparison against the incumbent must actually be favourable.
    var comparison = byKind[Evidence.CHAMPION_COMPARISON]
      ? byKind[Evidence.CHAMPION_COMPARISON][byKind[Evidence.CHAMPION_COMPARISON].length - 1] : null;
    if (comparison && comparison.metrics) {
      var m = comparison.metrics;
      if (typeof m.outOfSampleTrades === 'number' && m.outOfSampleTrades < rules.minOutOfSampleTrades) {
        blockers.push({
          code: 'INSUFFICIENT_OUT_OF_SAMPLE_TRADES',
          detail: m.outOfSampleTrades + ' out-of-sample trades, need ' + rules.minOutOfSampleTrades
        });
      }
      if (typeof m.expectancyDelta === 'number' && m.expectancyDelta <= rules.minExpectancyImprovement) {
        blockers.push({
          code: 'NO_EXPECTANCY_IMPROVEMENT',
          detail: 'expectancy delta ' + m.expectancyDelta + ' does not exceed ' + rules.minExpectancyImprovement
        });
      }
      if (typeof m.drawdownDeltaPct === 'number' && m.drawdownDeltaPct > rules.maxDrawdownWorseningPct) {
        blockers.push({
          code: 'DRAWDOWN_WORSENED',
          detail: 'drawdown rose by ' + m.drawdownDeltaPct + ' percentage points'
        });
      }
      if (typeof m.streakDelta === 'number' && m.streakDelta > rules.maxStreakWorsening) {
        blockers.push({
          code: 'LOSING_STREAK_WORSENED',
          detail: 'the maximum losing streak rose by ' + m.streakDelta
        });
      }
    }

    // 4. evidence that needs PAPER mode, when a mode controller is available.
    var modeBlocked = [];
    if (modeController) {
      REQUIRES_PAPER_MODE.forEach(function (kind) {
        if (byKind[kind] && modeController.mode() === enums.Mode.BACKTEST) {
          modeBlocked.push(kind);
        }
      });
      if (modeBlocked.length) {
        blockers.push({
          code: 'EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE',
          detail: modeBlocked.join(', ') + ' cannot have been produced in BACKTEST mode; the platform is in ' +
            modeController.mode() + ', so this evidence did not come from a paper run',
          kinds: modeBlocked
        });
      }
    }

    return {
      recordId: recordId,
      configHash: c.configHash,
      promotable: blockers.length === 0,
      blockers: blockers,
      evidencePresent: Object.keys(byKind).sort(),
      evidenceMissing: missing,
      distinctSegments: distinct.sort(),
      rules: rules,
      /**
       * Which requirements cannot be met right now whatever the research shows.
       * Named so an approval attempt fails with the reason visible.
       */
      unsatisfiableInCurrentMode: modeController && modeController.mode() === enums.Mode.BACKTEST
        ? REQUIRES_PAPER_MODE.slice() : []
    };
  }

  /**
   * Promotes a challenger to champion.
   *
   * Refuses an AGENT principal before reading any evidence: the champion is "the
   * currently approved system", and a gate an autonomous agent can satisfy and
   * then act on is a delay, not a gate.
   */
  function promote(q) {
    var c = getChallenger(q.recordId);
    assertPrincipal(q.principal, 'promote a challenger to champion');

    var verdict = dryRun(q.recordId);
    if (!verdict.promotable) {
      var lines = verdict.blockers.map(function (b) { return '  - ' + b.code + ': ' + b.detail; });
      logger.error('champion.promotion.refused', {
        recordId: q.recordId, blockers: verdict.blockers.map(function (b) { return b.code; })
      });
      record({ event: 'PROMOTION_REFUSED', recordId: q.recordId, blockers: verdict.blockers.map(function (b) { return b.code; }) });
      throw errors.PromotionRefused(
        'challenger ' + q.recordId + ' is not promotable:\n' + lines.join('\n'),
        { blockers: verdict.blockers }
      );
    }

    var previous = champion;
    if (previous) {
      previous.state = enums.ContenderState.RETIRED;
      previous.retiredAt = now();
      persistChampion(previous);
    }

    c.state = enums.ContenderState.PROMOTED;
    champion = {
      recordId: nextId('champ'),
      configHash: c.configHash,
      config: c.config,
      state: enums.ContenderState.CHAMPION,
      promotedAt: now(),
      promotedBy: { kind: q.principal.kind, id: q.principal.id },
      origin: 'PROMOTED',
      basis: q.basis || null,
      /** The evidence travels with the champion — it IS the approval record. */
      evidence: c.evidence.slice(),
      fromChallenger: c.recordId,
      previousChampionConfigHash: previous ? previous.configHash : null,
      previousChampionRecordId: previous ? previous.recordId : null,
      metrics: q.metrics || null
    };
    persistChallenger(c);
    persistChampion(champion);
    record({
      event: 'CHAMPION_PROMOTED', recordId: champion.recordId, fromChallenger: c.recordId,
      configHash: c.configHash, principal: q.principal.kind,
      previousChampionConfigHash: champion.previousChampionConfigHash
    });
    logger.warn('champion.promoted', {
      configHash: c.configHash.slice(0, 12), fromChallenger: c.recordId,
      principal: q.principal.kind, evidence: c.evidence.length
    });
    return champion;
  }

  /** Rejects a challenger. An AGENT may do this — rejecting approves nothing. */
  function reject(recordId, reason) {
    var c = getChallenger(recordId);
    if (typeof reason !== 'string' || reason.trim().length < 5) {
      throw errors.ConfigError('rejecting a challenger requires a reason');
    }
    c.state = enums.ContenderState.REJECTED;
    c.rejectedReason = reason;
    c.rejectedAt = now();
    persistChallenger(c);
    record({ event: 'CHALLENGER_REJECTED', recordId: recordId, reason: reason });
    logger.info('challenger.rejected', { recordId: recordId, reason: reason });
    return c;
  }

  /**
   * Rolls the champion back to the one it replaced.
   *
   * Requires a non-AGENT principal like promotion does, and needs the previous
   * champion's record to still exist. Rollback is deliberately available without
   * fresh evidence: reverting to a system that was already approved reduces
   * exposure, and a safety mechanism that needs paperwork to undo a mistake gets
   * bypassed exactly when it matters.
   */
  function rollback(q) {
    assertPrincipal(q.principal, 'roll the champion back');
    if (!champion) throw errors.PromotionRefused('there is no champion to roll back');
    if (!champion.previousChampionRecordId) {
      throw errors.PromotionRefused(
        'champion ' + champion.recordId + ' has no predecessor recorded; it was seeded rather than promoted',
        { origin: champion.origin }
      );
    }
    var prior = history.filter(function (h) { return h.event === 'CHAMPION_PROMOTED' || h.event === 'CHAMPION_SEEDED'; });
    var restored = {
      recordId: nextId('champ'),
      configHash: champion.previousChampionConfigHash,
      config: null,
      state: enums.ContenderState.CHAMPION,
      promotedAt: now(),
      promotedBy: { kind: q.principal.kind, id: q.principal.id },
      origin: 'ROLLBACK',
      basis: q.reason || 'rollback',
      evidence: [],
      previousChampionConfigHash: champion.configHash,
      previousChampionRecordId: champion.recordId,
      rolledBackFrom: champion.recordId
    };
    var rolledBack = champion;
    rolledBack.state = enums.ContenderState.RETIRED;
    rolledBack.retiredAt = now();
    persistChampion(rolledBack);
    champion = restored;
    persistChampion(champion);
    record({
      event: 'CHAMPION_ROLLED_BACK', recordId: champion.recordId,
      from: rolledBack.configHash, to: champion.configHash,
      principal: q.principal.kind, reason: q.reason || null, promotions: prior.length
    });
    logger.warn('champion.rolled_back', {
      from: rolledBack.configHash.slice(0, 12), to: champion.configHash.slice(0, 12), reason: q.reason || null
    });
    return champion;
  }

  // =====================================================================
  // helpers
  // =====================================================================

  function assertPrincipal(principal, what) {
    if (!principal || !PrincipalKind[principal.kind]) {
      throw errors.PromotionRefused(
        'to ' + what + ', a principal of kind [' + Object.keys(PrincipalKind).join(', ') + '] must be named',
        { principal: principal || null }
      );
    }
    if (principal.kind === PrincipalKind.AGENT) {
      throw errors.PromotionRefused(
        'an AGENT principal may not ' + what + '. The champion is the currently APPROVED system, and a gate ' +
        'an autonomous agent can satisfy and then act on is a delay rather than a gate. Register challengers, ' +
        'attach evidence and call dryRun() freely; changing what is approved is a human decision.',
        { principal: { kind: principal.kind, id: principal.id } }
      );
    }
    if (typeof principal.id !== 'string' || principal.id.length === 0) {
      throw errors.PromotionRefused('the principal must carry a non-empty id', { principal: principal });
    }
    return principal;
  }

  function getChallenger(recordId) {
    var c = challengers[recordId];
    if (!c) {
      throw errors.ConfigError(
        'unknown challenger ' + JSON.stringify(recordId) + ' (known: ' + Object.keys(challengers).join(', ') + ')'
      );
    }
    return c;
  }

  function persistChampion(c) {
    if (!store) return;
    store.table('champions').insert({
      recordId: c.recordId,
      configHash: c.configHash,
      state: c.state,
      promotedAt: c.promotedAt,
      evidence: c.evidence.map(function (e) {
        return { kind: e.kind, segment: e.segment, passed: e.passed, configHash: e.configHash };
      }),
      origin: c.origin,
      basis: c.basis,
      promotedBy: c.promotedBy,
      fromChallenger: c.fromChallenger || null,
      previousChampionConfigHash: c.previousChampionConfigHash,
      retiredAt: c.retiredAt || null
    });
  }

  function persistChallenger(c) {
    if (!store) return;
    store.table('challengers').insert({
      recordId: c.recordId,
      configHash: c.configHash,
      state: c.state,
      createdAt: c.createdAt,
      baselineConfigHash: c.baselineConfigHash,
      hypothesisId: c.hypothesisId,
      proposalId: c.proposalId,
      evidenceCount: c.evidence.length,
      evidenceKinds: c.evidence.map(function (e) { return e.kind; }).sort(),
      distinctSegments: Object.keys(c.evidence.reduce(function (acc, e) { acc[e.segment] = true; return acc; }, {})).sort(),
      rejectedReason: c.rejectedReason
    });
  }

  /**
   * Builds a CHAMPION_COMPARISON evidence payload from two run results. Provided
   * so the deltas are computed one way rather than by each caller, and so the sign
   * conventions cannot drift.
   */
  function comparisonEvidence(q) {
    var champMetrics = q.championMetrics;
    var challMetrics = q.challengerMetrics;
    var expectancyDelta = (champMetrics.expectancy === null || challMetrics.expectancy === null)
      ? null : money.round(challMetrics.expectancy - champMetrics.expectancy, 6);
    return {
      kind: Evidence.CHAMPION_COMPARISON,
      configHash: q.configHash,
      segment: q.segment,
      passed: expectancyDelta !== null && expectancyDelta > rules.minExpectancyImprovement &&
        (challMetrics.maxDrawdownPct - champMetrics.maxDrawdownPct) <= rules.maxDrawdownWorseningPct &&
        (challMetrics.maxConsecutiveLosses - champMetrics.maxConsecutiveLosses) <= rules.maxStreakWorsening,
      metrics: {
        expectancyDelta: expectancyDelta,
        drawdownDeltaPct: money.round(challMetrics.maxDrawdownPct - champMetrics.maxDrawdownPct, 6),
        streakDelta: challMetrics.maxConsecutiveLosses - champMetrics.maxConsecutiveLosses,
        outOfSampleTrades: challMetrics.tradeCount,
        championExpectancy: champMetrics.expectancy,
        challengerExpectancy: challMetrics.expectancy
      },
      detail: { championConfigHash: q.championConfigHash }
    };
  }

  return {
    Evidence: Evidence,
    REQUIRED_EVIDENCE: REQUIRED_EVIDENCE,
    REQUIRES_PAPER_MODE: REQUIRES_PAPER_MODE,
    PrincipalKind: PrincipalKind,
    rules: rules,

    seedChampion: seedChampion,
    registerChallenger: registerChallenger,
    attachEvidence: attachEvidence,
    dryRun: dryRun,
    promote: promote,
    reject: reject,
    rollback: rollback,
    comparisonEvidence: comparisonEvidence,

    champion: function () { return champion; },
    challenger: function (recordId) { return challengers[recordId] || null; },
    challengers: function () {
      return Object.keys(challengers).sort().map(function (k) { return challengers[k]; });
    },
    active: function () {
      return Object.keys(challengers).sort()
        .map(function (k) { return challengers[k]; })
        .filter(function (c) { return c.state === enums.ContenderState.CHALLENGER; });
    },
    history: function () { return history.slice(); },
    /** A serialisable snapshot for a report or a handover. */
    describe: function () {
      return {
        champion: champion ? {
          configHash: champion.configHash, origin: champion.origin,
          promotedAt: champion.promotedAt, evidence: champion.evidence.length,
          previousChampionConfigHash: champion.previousChampionConfigHash
        } : null,
        challengers: Object.keys(challengers).sort().map(function (k) {
          var c = challengers[k];
          return {
            recordId: c.recordId, configHash: c.configHash, state: c.state,
            evidence: c.evidence.length,
            distinctSegments: Object.keys(c.evidence.reduce(function (a, e) { a[e.segment] = true; return a; }, {})).length
          };
        }),
        rules: rules,
        requiredEvidence: REQUIRED_EVIDENCE.slice(),
        unsatisfiableInBacktestMode: REQUIRES_PAPER_MODE.slice(),
        historyEntries: history.length,
        fingerprint: hashMod.shortHash({
          champion: champion ? champion.configHash : null,
          challengers: Object.keys(challengers).map(function (k) { return challengers[k].configHash; }).sort()
        })
      };
    }
  };
}

module.exports = {
  create: create,
  Evidence: Evidence,
  REQUIRED_EVIDENCE: REQUIRED_EVIDENCE,
  REQUIRES_PAPER_MODE: REQUIRES_PAPER_MODE,
  PrincipalKind: PrincipalKind,
  DEFAULT_RULES: DEFAULT_RULES
};
