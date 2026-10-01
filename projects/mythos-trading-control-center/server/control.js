'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — configuration and mode control
// projects/mythos-trading-control-center/server/control.js
//
// Holds the one configuration the platform runs under, and the one mode
// controller that says which execution mode it is in. Every way either of them
// changes is in this file.
//
// THE RULES THIS FILE ENFORCES, AND WHERE THE REAL AUTHORITY IS
//
//  1. THE TRADING AGENT VALIDATES THE CONFIGURATION, NOT THIS FILE. A change is
//     deep-merged and handed to the agent's own config loader; its closed-key
//     schema and range checks decide. This file adds an ALLOWLIST of what the
//     console may touch at all — `mode`, `risk.maxOpenTrades`, `schemaVersion`
//     and the audit switch are not on it — and nothing else.
//
//  2. THE MODE CHANGES ONLY THROUGH THE AGENT'S MODE CONTROLLER. This file
//     assembles the owner-approval record from the owner's submission and the
//     AUTHENTICATED SESSION and calls transition(). It cannot raise the mode by
//     any other route, and it never asks for LIVE: the target is checked
//     against [BACKTEST, PAPER] before the agent is even consulted.
//
//  3. AN APPROVAL IS OF ONE SYSTEM. The controller is bound to the running
//     config fingerprint and commit. When the configuration changes, the
//     fingerprint changes, and a NEW controller is created in BACKTEST: an
//     approval of the previous system is not an approval of this one.
//
//  4. APPROVAL IDENTIFIERS ARE SINGLE-USE ACROSS RESTARTS. The agent's
//     controller remembers used approvals in memory; a restart would forget
//     them. The used set is persisted here so a replayed record is refused.
//
//  5. A RESTART COMES UP IN BACKTEST. The mode is not persisted. Coming back
//     in PAPER because a file said so would be exactly the "config key raises
//     the mode" path the agent's design rules out.
// =====================================================

var crypto = require('crypto');

var CONTROL_FILE = 'control.json';
var HISTORY_FILE = 'config-history.jsonl';
var MODE_FILE = 'mode-events.jsonl';
var APPROVALS_FILE = 'approvals-used.json';

/**
 * What the console may change. A path absent from this list cannot be reached
 * by any request, whatever the agent's schema would accept.
 */
var EDITABLE = Object.freeze({
  label: true,
  'account.initialCapital': true,
  universe: true,
  'risk.maxAccountRiskPerTradePct': true,
  'risk.maxPositionSizeLots': true,
  'risk.maxDailyLossPct': true,
  'risk.maxDrawdownPct': true,
  'risk.maxConsecutiveLosses': true,
  'risk.consecutiveLossCooldownHours': true,
  'risk.maxSpreadMultiple': true,
  'risk.maxSlippageMultiple': true,
  'risk.minStopPips': true,
  'risk.maxStopPips': true,
  'risk.minRewardRisk': true,
  'risk.minNetExpectedValue': true,
  'recovery.enabled': true,
  'recovery.baseLots': true,
  'recovery.multiplier': true,
  'recovery.maxRecoveryLevel': true,
  'recovery.resetOnWin': true,
  'recovery.requireFullRecoveryTp': true,
  'recovery.abandonOnRiskBlock': true,
  'strategy.signalCooldownBars': true,
  'jev.scoreThreshold': true,
  'jev.minConfidence': true,
  'cost.spreadModel': true,
  'cost.slippageModel': true,
  'cost.includeCommission': true,
  'cost.includeSwap': true,
  'cost.executionDelayBars': true,
  'cost.fixedSpreadPips': true,
  'cost.fixedSlippagePips': true,
  'schedule.respectInstrumentHours': true,
  'schedule.blockForexWeekend': true,
  'schedule.blockedWeekdaysUtc': true,
  'schedule.perAsset': true,
  'backtest.seed': true,
  'backtest.maxBarsInTrade': true,
  'backtest.allowIntrabarStopAndTarget': true
});

/** Named, with the reason, so a refusal can say why. */
var LOCKED = Object.freeze({
  mode: 'the execution mode changes only through an owner-approval record (POST /api/config/mode)',
  schemaVersion: 'the schema version is the platform\'s, not the operator\'s',
  'risk.maxOpenTrades': 'one trade globally is a platform invariant',
  'risk.emergencyStop': 'trading is enabled or disabled through POST /api/config/trading, which records the reason',
  'observability.auditEveryCandidate': 'disabling candidate audit would remove the decision trail',
  'observability.logLevel': 'not operator-configurable',
  'jev.model': 'the Jev model is fixed in this build',
  'jev.thresholdBands': 'the Jev bands are the mission\'s reporting bands',
  'backtest.warmupBars': 'derived from what the wired pipeline needs',
  'backtest.baseTimeframe': 'chosen per run in the Backtest Center',
  'backtest.higherTimeframe': 'chosen per run in the Backtest Center',
  'cost.swapChargeHoursUtc': 'not operator-configurable',
  'account.currency': 'must match the instrument catalog',
  notes: 'written by the Control Center itself'
});

function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/** Flattens an override object to leaf paths. `universe`, arrays and perAsset are leaves. */
function leafPaths(obj, prefix, out) {
  var acc = out || [];
  Object.keys(obj).forEach(function (k) {
    var p = prefix ? prefix + '.' + k : k;
    var v = obj[k];
    if (isPlainObject(v) && !EDITABLE[p] && !LOCKED[p]) leafPaths(v, p, acc);
    else acc.push({ path: p, value: v });
  });
  return acc;
}

function getPath(obj, path) {
  var cur = obj;
  var parts = path.split('.');
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/**
 * @param {object} spec
 * @param {object} spec.agent loaded agent boundary (server/agent.js)
 * @param {object} spec.state state directory handle
 * @param {string} spec.commit running commit, or null when unknown
 * @param {function} [spec.now]
 */
function create(spec) {
  var agent = spec.agent;
  var state = spec.state;
  var commit = spec.commit || null;
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };
  var enums = agent.enums;

  var persisted = state.readJSON(CONTROL_FILE, null) || {};
  var overrides = isPlainObject(persisted.overrides) ? persisted.overrides : {};
  var allStrategies = agent.strategyIds();
  var enabledStrategies = Array.isArray(persisted.enabledStrategies)
    ? persisted.enabledStrategies.filter(function (id) { return allStrategies.indexOf(id) !== -1; })
    : allStrategies.slice();
  if (enabledStrategies.length === 0) enabledStrategies = allStrategies.slice();
  var revision = typeof persisted.revision === 'number' ? persisted.revision : 0;

  var config;
  var startupProblem = null;
  try {
    config = agent.buildConfig(overrides, enabledStrategies);
  } catch (e) {
    // A persisted override the current schema no longer accepts must not stop
    // the console from starting — and must not be silently used either. Fall
    // back to the shipped defaults WITH TRADING DISABLED and say so.
    startupProblem = 'persisted configuration was rejected by the Trading Agent and was not applied: ' + e.message;
    overrides = { risk: { emergencyStop: true } };
    enabledStrategies = allStrategies.slice();
    config = agent.buildConfig(overrides, enabledStrategies);
  }

  var usedApprovals = state.readJSON(APPROVALS_FILE, { ids: [] });
  if (!usedApprovals || !Array.isArray(usedApprovals.ids)) usedApprovals = { ids: [] };

  var modeController = newController('PROCESS_START');

  function newController(why) {
    var mc = agent.mode.create({
      mode: enums.Mode.BACKTEST,
      configFingerprint: config.fingerprint.hash,
      commit: commit,
      now: now
    });
    state.appendLine(MODE_FILE, {
      ts: new Date(now()).toISOString(), fromMode: null, toMode: enums.Mode.BACKTEST, direction: 'INITIAL',
      principalKind: 'SYSTEM', principalId: 'control-center', approvalId: null, reason: why,
      configFingerprint: config.fingerprint.hash, commit: commit
    });
    return mc;
  }

  function persistControl() {
    state.writeJSON(CONTROL_FILE, {
      revision: revision,
      overrides: overrides,
      enabledStrategies: enabledStrategies,
      fingerprint: config.fingerprint.hash,
      savedAt: new Date(now()).toISOString()
    });
  }

  function principalFor(actor) {
    var role = actor && actor.role;
    var kind = role === 'OWNER' ? agent.mode.PrincipalKind.OWNER : agent.mode.PrincipalKind.OPERATOR;
    return { kind: kind, id: (kind === 'OWNER' ? 'owner:' : 'operator:') + (actor && actor.id ? actor.id : 'unknown') };
  }

  // =====================================================================
  // configuration
  // =====================================================================

  /**
   * Checks a requested change against the allowlist. Returns the leaf list or
   * the problems; touches nothing.
   */
  function inspectChanges(changes) {
    if (!isPlainObject(changes) || Object.keys(changes).length === 0) {
      return { ok: false, problems: [{ path: 'changes', message: 'must be a non-empty object of configuration keys' }] };
    }
    var leaves = leafPaths(changes, '');
    var problems = [];
    leaves.forEach(function (l) {
      if (LOCKED[l.path]) problems.push({ path: l.path, message: 'cannot be changed here: ' + LOCKED[l.path] });
      else if (!EDITABLE[l.path]) {
        var top = l.path.split('.')[0];
        problems.push({ path: l.path, message: LOCKED[top] ? 'cannot be changed here: ' + LOCKED[top] : 'is not a configurable key' });
      }
    });
    return problems.length ? { ok: false, problems: problems } : { ok: true, leaves: leaves };
  }

  /**
   * Applies a configuration change.
   *
   * @param {object} q { changes, reason, expectedFingerprint? }
   * @param {object} actor { id, role }
   * @returns {{changed, diff, before, after, modeReset}}
   */
  function applyChange(q, actor, kind) {
    var inspected = q.internal ? { ok: true, leaves: leafPaths(q.changes, '') } : inspectChanges(q.changes);
    if (!inspected.ok) {
      var bad = new Error('configuration change refused');
      bad.code = 'CONFIG_CHANGE_NOT_ALLOWED';
      bad.problems = inspected.problems;
      throw bad;
    }
    if (q.expectedFingerprint && q.expectedFingerprint !== config.fingerprint.hash) {
      var stale = new Error('the configuration changed since it was loaded (expected ' +
        q.expectedFingerprint.slice(0, 12) + ', running ' + config.fingerprint.shortHash + '); reload and re-apply');
      stale.code = 'CONFIG_STALE';
      stale.refusal = true;
      throw stale;
    }

    var nextOverrides = agent.config.deepMerge(overrides, q.changes);
    // The per-asset schedule map REPLACES rather than merges: a merge could add
    // or change an asset's window but never remove one.
    if (q.changes.schedule && q.changes.schedule.perAsset !== undefined) {
      nextOverrides.schedule.perAsset = JSON.parse(JSON.stringify(q.changes.schedule.perAsset));
    }
    var nextStrategies = q.enabledStrategies || enabledStrategies;
    var nextConfig = agent.buildConfig(nextOverrides, nextStrategies);   // throws ConfigError with .details.problems

    var before = agent.config.serialise(config);
    var after = agent.config.serialise(nextConfig);
    var diff = [];
    inspected.leaves.forEach(function (l) {
      var o = getPath(before, l.path);
      var n = getPath(after, l.path);
      if (!same(o, n)) diff.push({ path: l.path, oldValue: o === undefined ? null : o, newValue: n === undefined ? null : n });
    });
    if (q.enabledStrategies && !same(enabledStrategies.slice().sort(), q.enabledStrategies.slice().sort())) {
      diff.push({ path: 'strategies.enabled', oldValue: enabledStrategies.slice().sort(), newValue: q.enabledStrategies.slice().sort() });
    }
    var fpBefore = config.fingerprint.hash;
    if (diff.length === 0 && nextConfig.fingerprint.hash === fpBefore) {
      return { changed: false, diff: [], fingerprintBefore: fpBefore, fingerprintAfter: fpBefore, modeReset: false, revision: revision };
    }

    var modeBefore = modeController.mode();
    overrides = nextOverrides;
    enabledStrategies = nextStrategies.slice();
    config = nextConfig;
    revision += 1;
    persistControl();

    // Rule 3: a new fingerprint is a new system. The previous controller — and
    // any approval it accepted — described the old one.
    var modeReset = false;
    if (config.fingerprint.hash !== fpBefore) {
      modeController = newController('CONFIG_CHANGED');
      modeReset = modeBefore !== enums.Mode.BACKTEST;
      if (modeReset) {
        state.appendLine(MODE_FILE, {
          ts: new Date(now()).toISOString(), fromMode: modeBefore, toMode: enums.Mode.BACKTEST, direction: 'DOWNGRADE',
          principalKind: 'SYSTEM', principalId: 'control-center', approvalId: null,
          reason: 'configuration changed; the approval was bound to fingerprint ' + fpBefore.slice(0, 12),
          configFingerprint: config.fingerprint.hash, commit: commit
        });
      }
    }

    var entry = {
      revision: revision,
      ts: new Date(now()).toISOString(),
      kind: kind || 'CONFIG_UPDATE',
      actor: actor ? { id: actor.id, role: actor.role } : { id: 'system', role: 'SYSTEM' },
      reason: q.reason || null,
      diff: diff,
      fingerprintBefore: fpBefore,
      fingerprintAfter: config.fingerprint.hash,
      commit: commit,
      modeReset: modeReset
    };
    state.appendLine(HISTORY_FILE, entry);
    return {
      changed: true, diff: diff, fingerprintBefore: fpBefore, fingerprintAfter: config.fingerprint.hash,
      modeReset: modeReset, revision: revision
    };
  }

  /**
   * Directions in which a change LOOSENS a protection. A change that moves a
   * limit this way is reported by preview() so the API can demand an explicit
   * confirmation before applying it.
   */
  var LOOSENS = {
    'risk.maxAccountRiskPerTradePct': 'UP', 'risk.maxPositionSizeLots': 'UP', 'risk.maxDailyLossPct': 'UP',
    'risk.maxDrawdownPct': 'UP', 'risk.maxConsecutiveLosses': 'UP', 'risk.maxSpreadMultiple': 'UP',
    'risk.maxSlippageMultiple': 'UP', 'risk.maxStopPips': 'UP', 'risk.minStopPips': 'DOWN',
    'risk.consecutiveLossCooldownHours': 'DOWN', 'risk.minRewardRisk': 'DOWN', 'risk.minNetExpectedValue': 'DOWN',
    'recovery.maxRecoveryLevel': 'UP', 'recovery.multiplier': 'UP', 'recovery.baseLots': 'UP',
    'jev.scoreThreshold': 'DOWN', 'jev.minConfidence': 'DOWN'
  };
  var LOOSENS_WHEN = {
    'recovery.enabled': true, 'recovery.resetOnWin': false, 'recovery.requireFullRecoveryTp': false,
    'recovery.abandonOnRiskBlock': false, 'cost.includeCommission': false, 'cost.includeSwap': false,
    'risk.emergencyStop': false
  };

  /**
   * What a change WOULD do, without applying it: the diff, the fingerprint it
   * would produce, and which protections it loosens. Throws exactly what
   * applyChange would throw for an invalid or disallowed change.
   */
  function preview(q) {
    var inspected = q.internal ? { ok: true, leaves: leafPaths(q.changes, '') } : inspectChanges(q.changes);
    if (!inspected.ok) {
      var bad = new Error('configuration change refused');
      bad.code = 'CONFIG_CHANGE_NOT_ALLOWED';
      bad.problems = inspected.problems;
      throw bad;
    }
    var nextOverrides = agent.config.deepMerge(overrides, q.changes);
    if (q.changes.schedule && q.changes.schedule.perAsset !== undefined) {
      nextOverrides.schedule.perAsset = JSON.parse(JSON.stringify(q.changes.schedule.perAsset));
    }
    var nextConfig = agent.buildConfig(nextOverrides, q.enabledStrategies || enabledStrategies);
    var before = agent.config.serialise(config);
    var after = agent.config.serialise(nextConfig);
    var diff = [];
    var loosened = [];
    inspected.leaves.forEach(function (l) {
      var o = getPath(before, l.path);
      var n = getPath(after, l.path);
      if (same(o, n)) return;
      diff.push({ path: l.path, oldValue: o === undefined ? null : o, newValue: n === undefined ? null : n });
      var dir = LOOSENS[l.path];
      if (dir && typeof o === 'number' && typeof n === 'number' && ((dir === 'UP' && n > o) || (dir === 'DOWN' && n < o))) {
        loosened.push({ path: l.path, oldValue: o, newValue: n });
      }
      if (Object.prototype.hasOwnProperty.call(LOOSENS_WHEN, l.path) && n === LOOSENS_WHEN[l.path]) {
        loosened.push({ path: l.path, oldValue: o === undefined ? null : o, newValue: n });
      }
    });
    return {
      diff: diff,
      loosened: loosened,
      fingerprintBefore: config.fingerprint.hash,
      fingerprintAfter: nextConfig.fingerprint.hash,
      wouldResetMode: nextConfig.fingerprint.hash !== config.fingerprint.hash && modeController.mode() !== enums.Mode.BACKTEST
    };
  }

  function setStrategies(q, actor) {
    var ids = q.enabled;
    var unknown = ids.filter(function (id) { return allStrategies.indexOf(id) === -1; });
    if (unknown.length) {
      var e = new Error('unknown strategy id(s): ' + unknown.join(', '));
      e.code = 'UNKNOWN_STRATEGY';
      throw e;
    }
    if (ids.length === 0) {
      var e2 = new Error('at least one strategy must stay enabled; to stop trading, disable trading instead');
      e2.code = 'NO_STRATEGY_ENABLED';
      throw e2;
    }
    // Keep registry order, so the enabled list is canonical.
    var ordered = allStrategies.filter(function (id) { return ids.indexOf(id) !== -1; });
    return applyChange({ changes: {}, internal: true, enabledStrategies: ordered, reason: q.reason,
      expectedFingerprint: q.expectedFingerprint }, actor, 'STRATEGIES_UPDATE');
  }

  /**
   * Trading ENABLE / DISABLE. This is the agent's own kill switch —
   * `risk.emergencyStop` — so "disabled" means the Risk Engine blocks every
   * candidate, not that a UI flag asks nicely.
   */
  function setTrading(q, actor) {
    return applyChange({
      changes: { risk: { emergencyStop: !q.enabled } }, internal: true, reason: q.reason,
      expectedFingerprint: q.expectedFingerprint
    }, actor, q.enabled ? 'TRADING_ENABLED' : 'TRADING_DISABLED');
  }

  // =====================================================================
  // mode
  // =====================================================================

  function modeRequirements(to) {
    var from = modeController.mode();
    var required = agent.gates.requiredFor(from, to) || [];
    return {
      fromMode: from,
      toMode: to,
      requiredStatement: agent.mode.requiredStatement(from, to),
      configFingerprint: config.fingerprint.hash,
      commit: commit,
      commitKnown: !!commit,
      gates: required.map(function (g) {
        return { gate: g, description: agent.gates.GATE_DESCRIPTIONS[g], unsatisfiableInThisBuild: agent.gates.isUnsatisfiable(g) };
      }),
      minimumEvidenceLength: 8
    };
  }

  /** Builds the agent's approval record from an owner submission + the session. */
  function buildApproval(submission, actor, from, to, approvalId) {
    return {
      id: approvalId,
      fromMode: from,
      toMode: to,
      ownerApproval: submission.ownerApproval === true,
      approvedBy: principalFor(actor),          // from the SESSION, never the payload
      statement: submission.statement,
      approvedAt: new Date(now()).toISOString(),
      configFingerprint: submission.configFingerprint,
      commit: submission.commit,
      gatesPassed: submission.gatesPassed,
      gateEvidence: submission.gateEvidence
    };
  }

  function refuse(code, message, extra) {
    var e = new Error(message);
    e.code = code;
    e.refusal = true;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  /**
   * Changes the execution mode. Upgrades go to the agent's mode controller with
   * an OWNER principal and an approval record; downgrades need neither.
   */
  function setMode(q, actor) {
    var to = q.to;
    // LIVE is not a target this console can name. Checked first, before roles,
    // approvals or the agent — there is no input that reaches transition() with it.
    if (to !== enums.Mode.BACKTEST && to !== enums.Mode.PAPER) {
      throw refuse('LIVE_NOT_AVAILABLE',
        'the Control Center can select BACKTEST or PAPER only. LIVE execution does not exist in this build: ' +
        'there is no venue connectivity and the live adapter refuses every call.');
    }
    var from = modeController.mode();
    if (to === from) return { changed: false, mode: from, entry: null };

    var isUpgrade = agent.mode.MODE_RANK[to] > agent.mode.MODE_RANK[from];
    var principal = principalFor(actor);
    var approval = null;
    var approvalId = null;

    if (isUpgrade) {
      if (!commit) {
        throw refuse('COMMIT_UNKNOWN',
          'the running commit could not be determined, so an approval cannot be bound to it. PAPER is refused.');
      }
      if (!q.approval) throw refuse('APPROVAL_REQUIRED', 'raising the mode requires an owner-approval record');
      approvalId = 'approval-' + crypto.createHash('sha256').update(JSON.stringify({
        by: principal.id, statement: q.approval.statement, fp: q.approval.configFingerprint,
        commit: q.approval.commit, gates: q.approval.gatesPassed, evidence: q.approval.gateEvidence,
        nonce: q.approval.nonce || null
      })).digest('hex').slice(0, 24);
      if (usedApprovals.ids.indexOf(approvalId) !== -1) {
        throw refuse('APPROVAL_ALREADY_USED',
          'this owner-approval record has already been used; approvals are single-use. Submit a new one.',
          { approvalId: approvalId });
      }
      approval = buildApproval(q.approval, actor, from, to, approvalId);
    }

    // The agent decides. A refusal propagates as its own typed error.
    var res = modeController.transition({ to: to, principal: principal, approval: approval, reason: q.reason });

    if (isUpgrade) {
      usedApprovals.ids.push(approvalId);
      state.writeJSON(APPROVALS_FILE, usedApprovals);
    }
    state.appendLine(MODE_FILE, {
      ts: new Date(now()).toISOString(), fromMode: from, toMode: to, direction: res.entry.direction,
      principalKind: principal.kind, principalId: principal.id, approvalId: approvalId,
      reason: q.reason || null, gatesPassed: isUpgrade ? approval.gatesPassed : null,
      configFingerprint: config.fingerprint.hash, commit: commit
    });
    return { changed: true, mode: modeController.mode(), entry: res.entry, approvalId: approvalId };
  }

  /** Reports whether an approval WOULD be accepted. Changes nothing. */
  function dryRunMode(q, actor) {
    var to = q.to;
    if (to !== enums.Mode.BACKTEST && to !== enums.Mode.PAPER) {
      return { ok: false, upgrade: true, problems: ['LIVE is not available in this build'], requiredGates: [], unsatisfiableGates: [] };
    }
    var from = modeController.mode();
    var approval = q.approval ? buildApproval(q.approval, actor, from, to, 'dry-run') : null;
    var res = modeController.dryRun(to, approval);
    if (res.upgrade && actor.role !== 'OWNER') {
      res.ok = false;
      res.problems = ['only an OWNER may raise the execution mode'].concat(res.problems || []);
    }
    if (res.upgrade && !commit) {
      res.ok = false;
      res.problems = ['the running commit is unknown, so an approval cannot be bound to it'].concat(res.problems || []);
    }
    return res;
  }

  // =====================================================================
  // views
  // =====================================================================

  function tradingEnabled() { return config.risk.emergencyStop !== true; }

  function view() {
    var catalog = config.catalog;
    var registry = agent.strategyRegistry.standard();
    return {
      revision: revision,
      fingerprint: config.fingerprint.hash,
      shortFingerprint: config.fingerprint.shortHash,
      commit: commit,
      mode: modeController.mode(),
      tradingEnabled: tradingEnabled(),
      config: agent.config.serialise(config),
      overrides: JSON.parse(JSON.stringify(overrides)),
      editable: Object.keys(EDITABLE),
      locked: LOCKED,
      startupProblem: startupProblem,
      assets: catalog.symbols.map(function (sym) {
        var inst = catalog.get(sym);
        var perAsset = config.schedule.perAsset[sym] || {};
        return {
          symbol: sym, assetClass: inst.assetClass, inUniverse: config.universe.indexOf(sym) !== -1,
          minLot: inst.minLot, maxLot: inst.maxLot, typicalSpreadPips: inst.typicalSpreadPips,
          tradingHoursUtc: inst.tradingHoursUtc, weekendClosed: inst.weekendClosed,
          reachable: inst.minLot <= config.risk.maxPositionSizeLots,
          schedule: {
            enabled: perAsset.enabled !== false,
            startHourUtc: perAsset.startHourUtc === undefined ? null : perAsset.startHourUtc,
            endHourUtc: perAsset.endHourUtc === undefined ? null : perAsset.endHourUtc,
            blockedWeekdaysUtc: perAsset.blockedWeekdaysUtc || null
          }
        };
      }),
      strategies: registry.describe().map(function (s) {
        return {
          strategyId: s.strategyId, family: s.family, name: s.name, version: s.version,
          preferredRegimes: s.preferredRegimes, usesHigherTimeframe: s.usesHigherTimeframe,
          enabled: enabledStrategies.indexOf(s.strategyId) !== -1
        };
      }),
      ranges: ranges()
    };
  }

  /** The agent schema's declared ranges for the editable numeric keys. */
  function ranges() {
    var out = {};
    var S = agent.configSchema.SCHEMA.fields;
    Object.keys(EDITABLE).forEach(function (p) {
      var parts = p.split('.');
      var node = S[parts[0]];
      for (var i = 1; i < parts.length && node; i++) node = node.fields ? node.fields[parts[i]] : null;
      if (!node) return;
      if (node.type === 'number' || node.type === 'integer') out[p] = { type: node.type, min: node.min, max: node.max };
      else if (node.type === 'enum') out[p] = { type: 'enum', values: node.values.slice() };
      else if (node.type === 'boolean') out[p] = { type: 'boolean' };
    });
    return out;
  }

  function history(q) {
    var rows = state.readLines(HISTORY_FILE).reverse();
    var limit = (q && q.limit) || 100;
    var offset = (q && q.offset) || 0;
    return { total: rows.length, items: rows.slice(offset, offset + limit) };
  }

  function modeEvents(limit) {
    var rows = state.readLines(MODE_FILE).reverse();
    return rows.slice(0, limit || 50);
  }

  return {
    EDITABLE: EDITABLE,
    LOCKED: LOCKED,
    config: function () { return config; },
    /** The same overrides with mode PAPER — what a paper arm runs. */
    paperConfig: function (extra) {
      return agent.buildConfig(overrides, enabledStrategies, agent.config.deepMerge({ mode: enums.Mode.PAPER }, extra || {}));
    },
    overrides: function () { return JSON.parse(JSON.stringify(overrides)); },
    enabledStrategies: function () { return enabledStrategies.slice(); },
    modeController: function () { return modeController; },
    mode: function () { return modeController.mode(); },
    commit: function () { return commit; },
    revision: function () { return revision; },
    tradingEnabled: tradingEnabled,
    principalFor: principalFor,
    inspectChanges: inspectChanges,
    preview: preview,
    updateConfig: function (q, actor) { return applyChange(q, actor, 'CONFIG_UPDATE'); },
    setStrategies: setStrategies,
    setTrading: setTrading,
    setMode: setMode,
    dryRunMode: dryRunMode,
    modeRequirements: modeRequirements,
    view: view,
    history: history,
    modeEvents: modeEvents,
    startupProblem: function () { return startupProblem; }
  };
}

module.exports = {
  create: create,
  EDITABLE: EDITABLE,
  LOCKED: LOCKED
};
