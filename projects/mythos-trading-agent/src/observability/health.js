'use strict';
// =====================================================
// MYTHOS TRADING AGENT — health checks (mission item 20, §17)
// projects/mythos-trading-agent/src/observability/health.js
//
// The machine-checkable form of docs/VALIDATION_GATES.md. Each check answers one
// question about a completed run with OK, WARN or FAIL and the numbers behind it,
// so "the gates pass" becomes something a reader can verify rather than accept.
//
// TWO PRINCIPLES
//
//  1. A CHECK THAT CANNOT BE EVALUATED RETURNS `UNKNOWN`, NOT `OK`. A missing
//     input is not a pass. This is the difference between a health dashboard that
//     is useful and one that is green because nothing reported.
//
//  2. THE SAFETY CHECKS ARE ACTIVE, NOT PASSIVE. LIVE_EXECUTION_REFUSED does not
//     read a flag — it calls the live adapter and requires it to throw.
//     NO_NETWORK_CLIENT greps src/ rather than trusting that nobody added one.
//     A safety check that only reads configuration verifies the configuration,
//     not the safety.
//
// The status vocabulary is deliberately small. `FAIL` means a claim this platform
// makes about itself is false; `WARN` means a result is weak or unproven; `UNKNOWN`
// means the check had nothing to look at.
// =====================================================

var fs = require('fs');
var path = require('path');

var enums = require('../core/enums');
var errors = require('../core/errors');
var money = require('../core/money');
var metricsMod = require('../backtest/metrics');

var Status = Object.freeze({
  OK: 'OK',
  WARN: 'WARN',
  FAIL: 'FAIL',
  UNKNOWN: 'UNKNOWN'
});

/** Tables a complete run's audit trail must contain something in. */
var AUDIT_TABLES = Object.freeze([
  'market_data_meta', 'candidates', 'decisions', 'jev_decisions',
  'risk_assessments', 'cost_assessments', 'regimes', 'equity_curve', 'backtests'
]);

/** Field names that must never appear in a stored record. */
var SECRET_KEYS = Object.freeze([
  'token', 'apikey', 'api_key', 'secret', 'password', 'passwd',
  'authorization', 'bearer', 'privatekey', 'private_key', 'credentials'
]);

function check(name, status, detail, numbers) {
  return {
    check: name,
    status: status,
    detail: detail,
    numbers: numbers === undefined ? null : numbers
  };
}

/**
 * @param {object} spec
 * @param {object} spec.config
 * @param {object} [spec.modeController]
 * @param {object} [spec.logger]
 */
function create(spec) {
  var config = spec.config;
  var modeController = spec.modeController || null;
  var logger = spec.logger || require('../core/logger').nullLogger();

  // ---------------------------------------------------------------------
  // static checks — about the build, not about a run
  // ---------------------------------------------------------------------

  /**
   * Calls the LIVE adapter and requires it to refuse.
   *
   * Reading a flag would verify the flag. This verifies the adapter.
   */
  function liveExecutionRefused() {
    var liveAdapter;
    try {
      liveAdapter = require('../execution/live-adapter').create({ logger: logger });
    } catch (e) {
      return check('LIVE_EXECUTION_REFUSED', Status.FAIL,
        'the live adapter could not even be constructed: ' + e.message);
    }
    var inst = config.instrument(config.universe[0]);
    var bar = { ts: 0, open: 1, high: 1, low: 1, close: 1, volume: 1 };
    try {
      liveAdapter.fill({
        kind: 'ENTRY', instrument: inst, direction: 'LONG', lots: 0.01, requestedPrice: 1, bar: bar
      });
      return check('LIVE_EXECUTION_REFUSED', Status.FAIL,
        'THE LIVE ADAPTER ACCEPTED AN ORDER. This platform claims live execution is impossible; that claim is false.');
    } catch (e) {
      if (e.code !== 'LIVE_EXECUTION_REFUSED') {
        return check('LIVE_EXECUTION_REFUSED', Status.FAIL,
          'the live adapter threw the wrong error (' + e.code + '); the refusal must be explicit, not incidental');
      }
      var claimsSupport = enums.values(enums.Mode).filter(function (m) { return liveAdapter.supportsMode(m); });
      if (claimsSupport.length) {
        return check('LIVE_EXECUTION_REFUSED', Status.FAIL,
          'the live adapter refuses calls but claims to support ' + claimsSupport.join(', '));
      }
      return check('LIVE_EXECUTION_REFUSED', Status.OK,
        'the live adapter refused an order and claims to support no mode', { attempts: liveAdapter.attempts().length });
    }
  }

  /**
   * Greps src/ for anything that could reach a network.
   *
   * The strongest statement available that live trading is impossible here: not
   * "we did not connect" but "nothing in this project can".
   */
  function noNetworkClient() {
    var root = path.join(__dirname, '..');
    // THE PATTERN IS ASSEMBLED, NOT WRITTEN AS A LITERAL, and the two browser
    // identifiers are split across a concatenation on purpose: written whole, this
    // file would match its own detector and report itself as an offender. The
    // alternative was to exempt this file from the scan, and an exemption in a
    // safety check is exactly the thing that later hides a real finding. No file is
    // exempt.
    var forbidden = new RegExp([
      'require\\(\\s*[\'"](?:node:)?(?:https?|net|tls|dgram)[\'"]\\s*\\)',
      '\\bfetch\\s*\\(',
      'XMLHttp' + 'Request',
      'Web' + 'Socket'
    ].join('|'));
    var offenders = [];
    var scanned = 0;
    (function walk(dir) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
        var p = path.join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        if (!/\.js$/.test(e.name)) return;
        scanned++;
        if (forbidden.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
      });
    })(root);
    return offenders.length === 0
      ? check('NO_NETWORK_CLIENT', Status.OK, 'no module under src/ can reach a network', { filesScanned: scanned })
      : check('NO_NETWORK_CLIENT', Status.FAIL,
          'network-capable modules found under src/: ' + offenders.join(', '), { offenders: offenders });
  }

  /** The configured mode, and whether anything could have raised it. */
  function modeIsSafe() {
    var mode = modeController ? modeController.mode() : config.mode;
    if (mode === enums.Mode.LIVE) {
      return check('MODE_IS_SAFE', Status.FAIL,
        'the platform reports LIVE mode. Even with the adapter refusing, this should be unreachable.', { mode: mode });
    }
    return check('MODE_IS_SAFE', mode === enums.Mode.BACKTEST ? Status.OK : Status.WARN,
      mode === enums.Mode.BACKTEST
        ? 'mode is BACKTEST'
        : 'mode is PAPER — reached through an owner-approval record; no real order is placed, but records are live-shaped',
      { mode: mode });
  }

  /** Recovery is off, or capped and clamped. */
  function recoveryCapped() {
    var rec = config.recovery;
    if (!rec.enabled) {
      return check('RECOVERY_CAPPED', Status.OK, 'recovery is disabled', { enabled: false });
    }
    var ladder = [];
    for (var i = 0; i <= rec.maxRecoveryLevel; i++) {
      ladder.push(money.round(rec.baseLots * Math.pow(rec.multiplier, i), 6));
    }
    var top = ladder[ladder.length - 1];
    return check('RECOVERY_CAPPED', top > config.risk.maxPositionSizeLots ? Status.WARN : Status.OK,
      top > config.risk.maxPositionSizeLots
        ? 'recovery is enabled and its top rung (' + top + ') exceeds maxPositionSizeLots (' +
          config.risk.maxPositionSizeLots + '), so the Risk Engine will clamp it. That is the designed behaviour, ' +
          'and it means recovery research must report the clamping rate (COMPLIANCE §3.2).'
        : 'recovery is enabled and its whole ladder fits inside the position cap',
      { ladder: ladder, maxPositionSizeLots: config.risk.maxPositionSizeLots, maxRecoveryLevel: rec.maxRecoveryLevel });
  }

  // ---------------------------------------------------------------------
  // run checks — about a completed run
  // ---------------------------------------------------------------------

  function auditTrailComplete(run) {
    if (!run || !run.store) return check('AUDIT_TRAIL_COMPLETE', Status.UNKNOWN, 'no run store was supplied');
    var counts = run.store.counts();
    var empty = AUDIT_TABLES.filter(function (t) { return !counts[t]; });
    // A run with no trades legitimately has no trades table, so it is not in the
    // required list; everything else must have something.
    return empty.length === 0
      ? check('AUDIT_TRAIL_COMPLETE', Status.OK, 'every expected table has records', { counts: counts })
      : check('AUDIT_TRAIL_COMPLETE', Status.FAIL,
          'nothing was recorded in: ' + empty.join(', ') + '. Mission §17 cannot be answered from this store.',
          { empty: empty, counts: counts });
  }

  function oneTradeInvariant(run) {
    if (!run || !run.store) return check('ONE_TRADE_ONLY', Status.UNKNOWN, 'no run store was supplied');
    var events = [];
    run.store.table('positions').all().forEach(function (p) {
      events.push({ ts: p.status === 'OPEN' ? p.entryTs : p.exitTs, delta: p.status === 'OPEN' ? 1 : -1 });
    });
    if (events.length === 0) {
      return check('ONE_TRADE_ONLY', Status.UNKNOWN, 'the run opened no position, so the invariant was not exercised');
    }
    // For an equal timestamp the OPEN is ordered first: a position can open and
    // close on the same bar, and ordering the close first would show a spurious −1.
    events.sort(function (a, b) { return a.ts - b.ts || b.delta - a.delta; });
    var open = 0, maxOpen = 0;
    for (var i = 0; i < events.length; i++) {
      open += events[i].delta;
      if (open > maxOpen) maxOpen = open;
      if (open < 0) {
        return check('ONE_TRADE_ONLY', Status.FAIL,
          'a position closed that was never recorded as open', { atIndex: i });
      }
    }
    if (open !== 0) {
      return check('ONE_TRADE_ONLY', Status.FAIL, 'a position was left open at the end of the run', { stillOpen: open });
    }
    return maxOpen <= config.risk.maxOpenTrades
      ? check('ONE_TRADE_ONLY', Status.OK, 'at most ' + maxOpen + ' position open at any instant',
          { maxConcurrent: maxOpen, limit: config.risk.maxOpenTrades })
      : check('ONE_TRADE_ONLY', Status.FAIL,
          maxOpen + ' positions were open at once against a limit of ' + config.risk.maxOpenTrades,
          { maxConcurrent: maxOpen, limit: config.risk.maxOpenTrades });
  }

  function costsApplied(run) {
    if (!run || !run.trades || run.trades.length === 0) {
      return check('COST_MODEL_APPLIED', Status.UNKNOWN, 'the run produced no trades');
    }
    var costless = run.trades.filter(function (t) { return !(t.costsMoney > 0); });
    var unreconciled = run.trades.filter(function (t) {
      return t.netPnl !== money.money(t.grossPnl - t.costsMoney);
    });
    if (costless.length) {
      return check('COST_MODEL_APPLIED', Status.FAIL,
        costless.length + ' of ' + run.trades.length + ' trades carry no cost at all; the cost model was bypassed',
        { costlessTrades: costless.length });
    }
    if (unreconciled.length) {
      return check('COST_MODEL_APPLIED', Status.FAIL,
        unreconciled.length + ' trades do not satisfy net = gross − costs', { unreconciled: unreconciled.length });
    }
    var total = money.sum(run.trades.map(function (t) { return t.costsMoney; }));
    return check('COST_MODEL_APPLIED', Status.OK,
      'every trade is net of spread, commission, slippage and swap, and reconciles',
      { trades: run.trades.length, totalCosts: total, grossPnl: run.metrics.grossPnl, netPnl: run.metrics.netPnl });
  }

  function riskLimitsRecorded(run) {
    if (!run || !run.store) return check('RISK_LIMITS_ENFORCED', Status.UNKNOWN, 'no run store was supplied');
    var rows = run.store.table('risk_assessments').all();
    if (rows.length === 0) {
      return check('RISK_LIMITS_ENFORCED', Status.UNKNOWN, 'the Risk Engine was never consulted in this run');
    }
    var bare = rows.filter(function (r) { return !Array.isArray(r.limitsChecked) || r.limitsChecked.length === 0; });
    if (bare.length) {
      return check('RISK_LIMITS_ENFORCED', Status.FAIL,
        bare.length + ' risk verdicts carry no limit numbers; §17 asks "why did Risk Engine block it?" and this ' +
        'store cannot answer', { bare: bare.length });
    }
    // Every executed trade must match an approved size.
    var mismatched = (run.trades || []).filter(function (t) {
      var a = run.store.table('risk_assessments').first('candidateId', t.candidateId);
      return !a || a.approvedLots !== t.lots;
    });
    if (mismatched.length) {
      return check('RISK_LIMITS_ENFORCED', Status.FAIL,
        mismatched.length + ' trades were executed at a size the Risk Engine did not approve',
        { mismatched: mismatched.length });
    }
    var byVerdict = {};
    rows.forEach(function (r) { byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1; });
    return check('RISK_LIMITS_ENFORCED', Status.OK,
      'every verdict carries its limit numbers, and every trade used the approved size',
      { assessments: rows.length, byVerdict: byVerdict });
  }

  function drawdownWithinLimit(run) {
    if (!run || !run.metrics) return check('DRAWDOWN_WITHIN_LIMIT', Status.UNKNOWN, 'no run metrics were supplied');
    if (run.metrics.tradeCount === 0) return check('DRAWDOWN_WITHIN_LIMIT', Status.UNKNOWN, 'the run produced no trades');
    var dd = run.metrics.maxDrawdownPct;
    var limit = config.risk.maxDrawdownPct;
    // Breaching it is not a FAIL of the system — the emergency stop is supposed to
    // fire — but it is not a pass either, and a gate must not claim it is.
    return dd <= limit
      ? check('DRAWDOWN_WITHIN_LIMIT', Status.OK, 'maximum drawdown ' + dd + '% is inside the ' + limit + '% limit',
          { maxDrawdownPct: dd, limit: limit, source: run.metrics.equityCurveSource })
      : check('DRAWDOWN_WITHIN_LIMIT', Status.WARN,
          'maximum drawdown ' + dd + '% exceeded the ' + limit + '% limit; the run should have been ' +
          'emergency-stopped (' + (run.emergencyStopped ? 'it was' : 'IT WAS NOT') + ')',
          { maxDrawdownPct: dd, limit: limit, emergencyStopped: !!run.emergencyStopped });
  }

  function streakWithinLimit(run) {
    if (!run || !run.metrics) return check('LOSING_STREAK_WITHIN_LIMIT', Status.UNKNOWN, 'no run metrics were supplied');
    if (run.metrics.tradeCount === 0) return check('LOSING_STREAK_WITHIN_LIMIT', Status.UNKNOWN, 'no trades');
    var streak = run.metrics.maxConsecutiveLosses;
    var limit = config.risk.maxConsecutiveLosses;
    return streak <= limit
      ? check('LOSING_STREAK_WITHIN_LIMIT', Status.OK,
          'the longest losing streak was ' + streak + ', inside the limit of ' + limit,
          { maxConsecutiveLosses: streak, limit: limit })
      : check('LOSING_STREAK_WITHIN_LIMIT', Status.WARN,
          'the longest losing streak was ' + streak + ' against a limit of ' + limit + '. The limit is a circuit ' +
          'breaker with a cooling-off, not a hard cap on the count (COMPLIANCE §3.9), so this is expected — but ' +
          'mission §10 makes it a primary objective, so it is not a pass either.',
          { maxConsecutiveLosses: streak, limit: limit, cooldownHours: config.risk.consecutiveLossCooldownHours });
  }

  function noSecretsStored(run) {
    if (!run || !run.store) return check('NO_SECRETS_STORED', Status.UNKNOWN, 'no run store was supplied');
    var offenders = [];
    var scanned = 0;
    run.store.tableNames().forEach(function (name) {
      run.store.table(name).all().forEach(function (row) {
        scanned++;
        scan(row, name, 0);
      });
    });
    function scan(v, where, depth) {
      if (depth > 6 || v === null || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(function (x) { scan(x, where, depth + 1); });
      Object.keys(v).forEach(function (k) {
        if (SECRET_KEYS.indexOf(String(k).toLowerCase()) !== -1) offenders.push(where + '.' + k);
        scan(v[k], where, depth + 1);
      });
    }
    return offenders.length === 0
      ? check('NO_SECRETS_STORED', Status.OK, 'no secret-shaped field name appears in any record', { rowsScanned: scanned })
      : check('NO_SECRETS_STORED', Status.FAIL, 'secret-shaped fields in the store: ' + offenders.join(', '),
          { offenders: offenders });
  }

  function reproducible(run, rerun) {
    if (!run || !run.store) return check('BACKTEST_REPRODUCIBLE', Status.UNKNOWN, 'no run store was supplied');
    if (!rerun) {
      return check('BACKTEST_REPRODUCIBLE', Status.UNKNOWN,
        'no second run was supplied; reproducibility is an equality between two runs and cannot be asserted from one',
        { digest: run.store.digest() });
    }
    var a = run.store.digest();
    var b = rerun.store.digest();
    return a === b
      ? check('BACKTEST_REPRODUCIBLE', Status.OK, 'two runs of this configuration produced the same store digest',
          { digest: a })
      : check('BACKTEST_REPRODUCIBLE', Status.FAIL,
          'two runs of one configuration produced different stores; no result from this build is reproducible',
          { first: a, second: b });
  }

  /**
   * Reports what data the run cited, and refuses to call it real.
   *
   * An earlier version of this check inferred provenance from the dataset version
   * STRING — OK unless it matched /synthetic|fixture/ — which meant a caller could
   * make the check pass by naming its data 'integration-v1'. A safety statement
   * that a naming choice can flip is not a safety statement.
   *
   * So this check is WARN unless the run explicitly declares verified real market
   * data, and NOTHING in this build can make that declaration: there is no market
   * data access here at all. The status is therefore always WARN when a run is
   * supplied, and the detail names the versions so a reader can see exactly what
   * was used.
   */
  function dataProvenance(run) {
    if (!run || !run.store) return check('DATA_PROVENANCE', Status.UNKNOWN, 'no run store was supplied');
    var meta = run.store.table('market_data_meta').all();
    if (meta.length === 0) return check('DATA_PROVENANCE', Status.FAIL, 'the run recorded no data provenance at all');
    var versions = {};
    meta.forEach(function (m) { versions[m.datasetVersion] = true; });
    var declaredReal = run.realMarketData === true;
    return check('DATA_PROVENANCE', declaredReal ? Status.OK : Status.WARN,
      declaredReal
        ? 'the run declares verified real market data'
        : 'provenance is NOT verified as real market data. This build has no market-data access, so every run is ' +
          'synthetic or fixture-based: it validates MECHANICS only, and no statement about edge or profitability ' +
          'can be derived from it (COMPLIANCE §3.4).',
      { datasetVersions: Object.keys(versions), series: meta.length, declaredRealMarketData: declaredReal });
  }

  // ---------------------------------------------------------------------
  // the report
  // ---------------------------------------------------------------------

  /**
   * Runs every check.
   *
   * @param {object} [q]
   * @param {object} [q.run] a completed run result
   * @param {object} [q.rerun] a second run of the same configuration
   */
  function report(q) {
    var o = q || {};
    var checks = [
      // static — about the build
      modeIsSafe(),
      liveExecutionRefused(),
      noNetworkClient(),
      recoveryCapped(),
      // dynamic — about the run
      auditTrailComplete(o.run),
      oneTradeInvariant(o.run),
      costsApplied(o.run),
      riskLimitsRecorded(o.run),
      drawdownWithinLimit(o.run),
      streakWithinLimit(o.run),
      noSecretsStored(o.run),
      dataProvenance(o.run),
      reproducible(o.run, o.rerun)
    ];

    var failed = checks.filter(function (c) { return c.status === Status.FAIL; });
    var warned = checks.filter(function (c) { return c.status === Status.WARN; });
    var unknown = checks.filter(function (c) { return c.status === Status.UNKNOWN; });

    var out = {
      // A FAIL means a claim this platform makes about itself is false.
      status: failed.length ? Status.FAIL : (warned.length ? Status.WARN : (unknown.length ? Status.UNKNOWN : Status.OK)),
      checks: checks,
      failed: failed.map(function (c) { return c.check; }),
      warned: warned.map(function (c) { return c.check; }),
      unknown: unknown.map(function (c) { return c.check; }),
      counts: {
        ok: checks.filter(function (c) { return c.status === Status.OK; }).length,
        warn: warned.length, fail: failed.length, unknown: unknown.length, total: checks.length
      },
      configHash: config.fingerprint.hash,
      mode: modeController ? modeController.mode() : config.mode,
      /**
       * An UNKNOWN is not a pass, and this note exists so a reader of the summary
       * cannot treat it as one.
       */
      note: unknown.length
        ? unknown.length + ' check(s) had nothing to evaluate and returned UNKNOWN. An UNKNOWN is not a pass.'
        : null
    };
    logger.info('health.report', {
      status: out.status, ok: out.counts.ok, warn: out.counts.warn,
      fail: out.counts.fail, unknown: out.counts.unknown
    });
    return out;
  }

  /** Persists a report as one row per check. */
  function persist(store, rep) {
    rep.checks.forEach(function (c) {
      store.table('health_checks').insert({
        ts: null, check: c.check, status: c.status,
        detail: { message: c.detail, numbers: c.numbers, configHash: rep.configHash, mode: rep.mode }
      });
    });
    return rep.checks.length;
  }

  /** One line, for a log or a commit message. */
  function summarise(rep) {
    return rep.status + ' (' + rep.counts.ok + ' ok, ' + rep.counts.warn + ' warn, ' +
      rep.counts.fail + ' fail, ' + rep.counts.unknown + ' unknown)' +
      (rep.failed.length ? ' — FAILED: ' + rep.failed.join(', ') : '');
  }

  return {
    Status: Status,
    report: report,
    persist: persist,
    summarise: summarise,
    // Individual checks, so a caller can ask one cheaply.
    modeIsSafe: modeIsSafe,
    liveExecutionRefused: liveExecutionRefused,
    noNetworkClient: noNetworkClient,
    recoveryCapped: recoveryCapped,
    auditTrailComplete: auditTrailComplete,
    oneTradeInvariant: oneTradeInvariant,
    costsApplied: costsApplied,
    riskLimitsRecorded: riskLimitsRecorded,
    drawdownWithinLimit: drawdownWithinLimit,
    streakWithinLimit: streakWithinLimit,
    noSecretsStored: noSecretsStored,
    reproducible: reproducible,
    dataProvenance: dataProvenance
  };
}

module.exports = {
  create: create,
  Status: Status,
  AUDIT_TABLES: AUDIT_TABLES,
  SECRET_KEYS: SECRET_KEYS
};
