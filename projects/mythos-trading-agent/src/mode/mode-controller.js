'use strict';
// =====================================================
// MYTHOS TRADING AGENT — mode controller
// projects/mythos-trading-agent/src/mode/mode-controller.js
//
// THE SINGLE MOST SAFETY-CRITICAL FILE IN THE PLATFORM.
//
// The owner's rule: "the agent must never autonomously switch from backtest to
// paper or from paper to live." This file is how that rule is enforced rather
// than remembered.
//
// The design, and why each part is the way it is:
//
//  1. UPGRADES NEED AN OWNER-APPROVAL RECORD. There is no code path — no flag,
//     no environment variable, no config key — that raises the mode. The only
//     entry point is transition(), and it refuses without a record that passes
//     verifyApproval(). config/schema.js separately refuses to even PARSE a
//     config whose mode is LIVE, so the file-editing route does not exist.
//
//  2. THE PRINCIPAL MUST BE THE OWNER. Every transition names who asked. A
//     principal of kind AGENT is refused for an upgrade, unconditionally and
//     before any other check, so an autonomous agent that somehow held a valid
//     approval record still cannot apply it. An agent MAY downgrade.
//
//  3. DOWNGRADES ARE ALWAYS ALLOWED, FOR ANYONE. Moving toward BACKTEST reduces
//     exposure. A safety mechanism that needs paperwork to make things safer
//     gets bypassed in the moment it matters.
//
//  4. APPROVAL RECORDS ARE SINGLE-USE AND BOUND. A record names fromMode,
//     toMode, the config fingerprint and the commit. Replaying it after either
//     changed is refused: an approval of one system is not an approval of a
//     later one.
//
//  5. EVEN AN APPROVED LIVE MODE CANNOT TRADE. The live execution adapter is a
//     stub that refuses every call. LIVE therefore takes two independent locks
//     to open, and this build ships only one of them — by design, and recorded
//     as an unsatisfiable gate in gates.js.
// =====================================================

var enums = require('../core/enums');
var errors = require('../core/errors');
var gates = require('./gates');
var hashMod = require('../core/hash');

var MODE_RANK = { BACKTEST: 0, PAPER: 1, LIVE: 2 };

/** Principal kinds. Only OWNER may raise the mode. */
var PrincipalKind = Object.freeze({
  OWNER: 'OWNER',
  AGENT: 'AGENT',
  OPERATOR: 'OPERATOR',
  SYSTEM: 'SYSTEM'
});

/**
 * The exact sentence an approval record must contain, so that an approval
 * cannot be produced by filling in a form without reading it.
 */
function requiredStatement(fromMode, toMode) {
  return 'I approve the Mythos Trading Agent transition ' + fromMode + ' -> ' + toMode;
}

/**
 * Verifies an owner-approval record against the transition being attempted.
 * Returns { ok, problems } — never throws, so callers can report every reason
 * an approval was insufficient at once.
 */
function verifyApproval(approval, ctx) {
  var problems = [];
  var from = ctx.fromMode;
  var to = ctx.toMode;

  if (!approval || typeof approval !== 'object') {
    return { ok: false, problems: ['no owner-approval record was supplied'] };
  }

  if (approval.fromMode !== from) {
    problems.push('record fromMode is ' + JSON.stringify(approval.fromMode) + ' but the current mode is ' + from);
  }
  if (approval.toMode !== to) {
    problems.push('record toMode is ' + JSON.stringify(approval.toMode) + ' but the requested mode is ' + to);
  }
  if (approval.ownerApproval !== true) {
    problems.push('record does not carry ownerApproval === true');
  }
  if (!approval.approvedBy || approval.approvedBy.kind !== PrincipalKind.OWNER) {
    problems.push('record approvedBy.kind must be OWNER');
  }
  if (typeof approval.approvedBy === 'object' && approval.approvedBy &&
      (typeof approval.approvedBy.id !== 'string' || approval.approvedBy.id.length === 0)) {
    problems.push('record approvedBy.id must be a non-empty string');
  }
  var stmt = requiredStatement(from, to);
  if (typeof approval.statement !== 'string' || approval.statement.indexOf(stmt) === -1) {
    problems.push('record statement must contain exactly: "' + stmt + '"');
  }
  if (typeof approval.approvedAt !== 'string' || !isFinite(Date.parse(approval.approvedAt))) {
    problems.push('record approvedAt must be an ISO-8601 timestamp');
  }

  // Binding: an approval is of a specific system, not of the idea of one.
  if (ctx.configFingerprint !== undefined && ctx.configFingerprint !== null) {
    if (approval.configFingerprint !== ctx.configFingerprint) {
      problems.push('record configFingerprint ' + JSON.stringify(approval.configFingerprint) +
        ' does not match the running configuration ' + JSON.stringify(ctx.configFingerprint));
    }
  }
  if (ctx.commit !== undefined && ctx.commit !== null) {
    if (approval.commit !== ctx.commit) {
      problems.push('record commit ' + JSON.stringify(approval.commit) + ' does not match the running commit ' + JSON.stringify(ctx.commit));
    }
  }

  var required = gates.requiredFor(from, to);
  if (!required) {
    problems.push('no gate set is defined for ' + from + ' -> ' + to + ', so it cannot be approved');
  } else {
    if (!Array.isArray(approval.gatesPassed)) {
      problems.push('record gatesPassed must be an array of gate identifiers');
    } else {
      var unknown = approval.gatesPassed.filter(function (g) { return !gates.Gate[g]; });
      if (unknown.length) problems.push('record claims unknown gates: ' + unknown.join(', '));
      var miss = gates.missing(required, approval.gatesPassed);
      if (miss.length) {
        problems.push('gates not satisfied: ' + miss.join(', '));
      }
      // Evidence is required per gate, so "gate passed" cannot be a bare claim.
      var ev = approval.gateEvidence || {};
      var noEvidence = required.filter(function (g) {
        return typeof ev[g] !== 'string' || ev[g].trim().length < 8;
      });
      if (noEvidence.length) {
        problems.push('gateEvidence missing or too short for: ' + noEvidence.join(', '));
      }
    }
  }

  if (to === enums.Mode.LIVE && approval.acknowledgedCapitalAtRisk !== true) {
    problems.push('a transition to LIVE additionally requires acknowledgedCapitalAtRisk === true');
  }

  return { ok: problems.length === 0, problems: problems };
}

/**
 * Creates the controller.
 *
 * @param {object} [opts]
 * @param {string} [opts.mode='BACKTEST'] starting mode; LIVE is refused here too
 * @param {string} [opts.configFingerprint] binds approvals to this config
 * @param {string} [opts.commit] binds approvals to this commit
 * @param {object} [opts.logger]
 * @param {function} [opts.now] () => epoch ms
 */
function create(opts) {
  var o = opts || {};
  var mode = o.mode || enums.Mode.BACKTEST;
  enums.assertEnum(enums.Mode, mode, 'initial mode');
  if (mode === enums.Mode.LIVE) {
    // Not even construction may start in LIVE. A constructor argument is a code
    // path, and §"mode changes only via an explicit owner-approval record"
    // admits no code path.
    throw errors.ModeTransitionRefused(
      'a mode controller cannot be constructed in LIVE mode; LIVE is reachable only through transition() with a verified owner-approval record, and the live execution adapter refuses regardless',
      { attempted: enums.Mode.LIVE }
    );
  }

  var logger = o.logger || require('../core/logger').nullLogger();
  var now = typeof o.now === 'function' ? o.now : function () { return Date.now(); };
  var configFingerprint = o.configFingerprint === undefined ? null : o.configFingerprint;
  var commit = o.commit === undefined ? null : o.commit;
  var history = [{
    at: now(),
    fromMode: null,
    toMode: mode,
    direction: 'INITIAL',
    principal: { kind: PrincipalKind.SYSTEM, id: 'mode-controller' },
    approvalId: null
  }];
  var usedApprovals = Object.create(null);

  function record(entry) {
    history.push(entry);
    return entry;
  }

  var api = {
    mode: function () { return mode; },
    isBacktest: function () { return mode === enums.Mode.BACKTEST; },
    isPaper: function () { return mode === enums.Mode.PAPER; },
    isLive: function () { return mode === enums.Mode.LIVE; },

    /** Throws unless the current mode is one of `allowed`. */
    assertMode: function (allowed, what) {
      var list = Array.isArray(allowed) ? allowed : [allowed];
      if (list.indexOf(mode) === -1) {
        throw errors.ModeTransitionRefused(
          (what || 'operation') + ' requires mode in [' + list.join(', ') + '] but the platform is in ' + mode,
          { mode: mode, allowed: list }
        );
      }
      return mode;
    },

    /**
     * The ONLY way the mode changes.
     *
     * @param {object} req
     * @param {string} req.to target mode
     * @param {object} req.principal { kind, id }
     * @param {object} [req.approval] owner-approval record; required for upgrades
     * @param {string} [req.reason] free text, recorded
     */
    transition: function (req) {
      var r = req || {};
      var to = r.to;
      enums.assertEnum(enums.Mode, to, 'target mode');
      var principal = r.principal || { kind: PrincipalKind.SYSTEM, id: 'unknown' };
      var from = mode;

      if (to === from) {
        logger.info('mode.transition.noop', { mode: mode, principal: principal.kind });
        return { changed: false, mode: mode, reason: 'already in ' + mode };
      }

      var isUpgrade = MODE_RANK[to] > MODE_RANK[from];

      if (!isUpgrade) {
        // Downgrade: always permitted, always recorded.
        mode = to;
        var entry = record({
          at: now(), fromMode: from, toMode: to, direction: 'DOWNGRADE',
          principal: { kind: principal.kind, id: principal.id }, approvalId: null,
          reason: r.reason || 'risk reduction'
        });
        logger.warn('mode.downgraded', { from: from, to: to, principal: principal.kind, reason: entry.reason });
        return { changed: true, mode: mode, entry: entry };
      }

      // ---- upgrade path -------------------------------------------------
      if (principal.kind !== PrincipalKind.OWNER) {
        logger.error('mode.upgrade.refused', { from: from, to: to, principal: principal.kind, reason: 'NON_OWNER_PRINCIPAL' });
        throw errors.ModeTransitionRefused(
          'only an OWNER principal may raise the execution mode; ' + principal.kind + ' principal "' +
          principal.id + '" attempted ' + from + ' -> ' + to,
          { from: from, to: to, principal: principal }
        );
      }

      var verdict = verifyApproval(r.approval, {
        fromMode: from, toMode: to, configFingerprint: configFingerprint, commit: commit
      });
      if (!verdict.ok) {
        logger.error('mode.upgrade.refused', {
          from: from, to: to, principal: principal.kind,
          reason: 'APPROVAL_INSUFFICIENT', problems: verdict.problems
        });
        throw errors.ModeTransitionRefused(
          'owner-approval record does not authorise ' + from + ' -> ' + to + ':\n  - ' + verdict.problems.join('\n  - '),
          { from: from, to: to, problems: verdict.problems }
        );
      }

      var approvalId = r.approval.id || hashMod.shortHash(r.approval);
      if (usedApprovals[approvalId]) {
        throw errors.ModeTransitionRefused(
          'owner-approval record ' + approvalId + ' has already been used; approvals are single-use',
          { approvalId: approvalId }
        );
      }
      usedApprovals[approvalId] = true;

      mode = to;
      var up = record({
        at: now(), fromMode: from, toMode: to, direction: 'UPGRADE',
        principal: { kind: principal.kind, id: principal.id },
        approvalId: approvalId,
        gatesPassed: r.approval.gatesPassed.slice(),
        reason: r.reason || null
      });
      logger.warn('mode.upgraded', { from: from, to: to, approvalId: approvalId, gates: up.gatesPassed.length });
      return { changed: true, mode: mode, entry: up };
    },

    /**
     * Reports whether an approval WOULD be accepted, without applying it. This
     * is the function an agent may call; transition() is not.
     */
    dryRun: function (to, approval) {
      enums.assertEnum(enums.Mode, to, 'target mode');
      if (MODE_RANK[to] <= MODE_RANK[mode]) {
        return { ok: true, upgrade: false, problems: [], note: 'downgrade or no-op; no approval required' };
      }
      var v = verifyApproval(approval, {
        fromMode: mode, toMode: to, configFingerprint: configFingerprint, commit: commit
      });
      return {
        ok: v.ok, upgrade: true, problems: v.problems,
        requiredGates: gates.requiredFor(mode, to) || [],
        unsatisfiableGates: (gates.requiredFor(mode, to) || []).filter(gates.isUnsatisfiable)
      };
    },

    history: function () { return history.map(function (h) { return h; }); },
    requiredStatement: requiredStatement,
    bindings: function () { return { configFingerprint: configFingerprint, commit: commit }; }
  };

  return api;
}

module.exports = {
  create: create,
  verifyApproval: verifyApproval,
  requiredStatement: requiredStatement,
  PrincipalKind: PrincipalKind,
  MODE_RANK: MODE_RANK
};
