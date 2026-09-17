'use strict';
// =====================================================
// MYTHOS Guardian V0 — human-readable rendering
// ops/guardian/lib/report.js
//
// Pure formatting. Two audiences:
//   text()     — an operator reading a terminal or a journal line
//   incident() — the OTH incident format: what happened, what the evidence
//                was, what Guardian did (in V0: observed), what a human
//                should consider next. Guardian never recommends a
//                destructive action.
// =====================================================

var levels = require('./levels');

var GLYPH = { NORMAL: 'ok', RECOVERY: 'recovering', WARNING: 'warning', HIGH: 'high', CRITICAL: 'critical', EMERGENCY: 'emergency' };

function pad(s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)); }

function text(report) {
  var L = [];
  var h = report.host;
  L.push('MYTHOS Guardian — ' + h.level + ' (' + GLYPH[h.level] + ')' + (h.partial ? '  [PARTIAL: ' + h.unknown_domains.join(', ') + ' unknown]' : ''));
  L.push('  generated ' + report.generated_at + '   tick ' + report.tick + '   mode ' + report.mode);
  L.push('  guardian  ' + report.guardian.state + '   observing ' + report.guardian.observed_domains + '/' + report.guardian.total_domains +
    ' domains   remediation ' + remediationLine(report.guardian.remediation));
  if (report.guardian.issues.length) report.guardian.issues.forEach(function (i) { L.push('            - ' + i); });
  L.push('');
  L.push('  DOMAIN     LEVEL       SINCE                     DETAIL');
  Object.keys(report.domains).forEach(function (d) {
    var v = report.domains[d];
    L.push('  ' + pad(d, 10) + ' ' + pad(v.level + (v.unknown ? '?' : ''), 11) + ' ' + pad(v.since || '-', 25) + ' ' + detail(d, v));
  });
  if (report.findings.length) {
    L.push('');
    L.push('  FINDINGS');
    report.findings.forEach(function (f) { L.push('   [' + pad(f.severity, 9) + '] ' + f.domain + '/' + f.kind + ': ' + f.trigger); });
  }
  if (report.transitions.length) {
    L.push('');
    L.push('  TRANSITIONS');
    report.transitions.forEach(function (t) { L.push('   ' + t.domain + ': ' + t.from + ' -> ' + t.to + ' (' + t.reason + ')'); });
  }
  if (report.incident) {
    L.push('');
    L.push('  INCIDENT ' + report.incident.id + ' OPEN since ' + report.incident.opened_at +
      ' — peak ' + report.incident.peak_level + ', ' + report.incident.ticks + ' tick(s), domains: ' + report.incident.domains.join(', '));
  }
  return L.join('\n');
}

function remediationLine(r) {
  if (!r) return 'unknown';
  if (!r.remediation_available) return r.observe_only ? 'off (observe-only)' : 'off (no flag enabled)';
  return 'ON for ' + (r.enabled_flags || []).join(', ') + ' — max ' + r.max_actions_per_tick + '/tick';
}

function detail(domain, v) {
  var s = v.summary;
  if (!s) return v.unknown ? 'no usable signal' : '-';
  if (domain === 'memory') {
    return 'RG=' + (s.resource_guard_level || '?') + '  avail=' + s.mem_available_mib + 'MiB  psi60=' + s.psi_some_avg60 +
      '  swap=' + s.swap_used_pct + '%  oom=' + s.oom_kill + (s.oom_kill_delta ? ' (+' + s.oom_kill_delta + ')' : '');
  }
  if (domain === 'sessions') {
    return 'agents=' + s.remote_sessions + '/' + s.admission_ceiling + '  rss=' + s.remote_rss_mib + 'MiB  orphans=' + s.orphan_count + '  procs=' + s.process_count;
  }
  if (domain === 'disk') return 'used=' + s.used_pct + '%  free=' + s.free_gb + 'GB  inodes=' + s.inode_used_pct + '%';
  if (domain === 'services') {
    var bad = Object.keys(s.table).filter(function (k) { return s.table[k].status !== 'OK'; });
    return bad.length ? bad.length + ' not OK: ' + bad.slice(0, 6).join(', ') : 'all observed units and containers OK';
  }
  if (domain === 'backup') return s.backup_state + '  ' + s.restore_test_state;
  return '-';
}

// --- OTH incident format ------------------------------------------------
function incident(report, opts) {
  var o = opts || {};
  var inc = report.incident;
  var L = [];
  var title = inc ? ('Guardian incident ' + inc.id + ' — host ' + report.host.level) : ('Guardian observation — host ' + report.host.level);
  L.push('# ' + title);
  L.push('');
  L.push('- **Observed at:** ' + report.generated_at + ' (tick ' + report.tick + ', mode ' + report.mode + ')');
  L.push('- **Host level:** ' + report.host.level + (report.host.partial ? ' (partial — ' + report.host.unknown_domains.join(', ') + ' unobserved)' : ''));
  L.push('- **Guardian health:** ' + report.guardian.state + ' — ' + report.guardian.observed_domains + '/' + report.guardian.total_domains + ' domains observed');
  if (inc) {
    L.push('- **Incident:** ' + inc.state + ' since ' + inc.opened_at + ', peak ' + inc.peak_level + ', ' + inc.ticks + ' tick(s)');
    L.push('- **Domains involved:** ' + inc.domains.join(', '));
  }
  L.push('');
  L.push('## What Guardian saw');
  L.push('');
  L.push('| Domain | Level | Evidence |');
  L.push('|---|---|---|');
  Object.keys(report.domains).forEach(function (d) {
    var v = report.domains[d];
    L.push('| ' + d + ' | ' + v.level + (v.unknown ? ' (unknown)' : '') + ' | ' + detail(d, v).replace(/\|/g, '\\|') + ' |');
  });
  if (report.findings.length) {
    L.push('');
    L.push('## Findings');
    L.push('');
    report.findings.forEach(function (f) { L.push('- **' + f.severity + '** ' + f.domain + '/' + f.kind + ' — ' + f.trigger); });
  }
  if (report.transitions.length) {
    L.push('');
    L.push('## Transitions this tick');
    L.push('');
    report.transitions.forEach(function (t) { L.push('- ' + t.domain + ': `' + t.from + '` → `' + t.to + '` (' + t.reason + ')'); });
  }
  L.push('');
  L.push('## What Guardian did');
  L.push('');
  var taken = (report.actions || []).filter(function (a) { return a.mode === 'executed'; });
  if (!taken.length) {
    L.push('Nothing. It reads state that other components already own and records a verdict.');
    L.push('It has no kill and no delete, and it made no change to any service, file, container, database or backup.');
    var blocked = ((report.remediation && report.remediation.decisions) || []).filter(function (d) { return !d.allowed; });
    if (blocked.length) {
      L.push('');
      L.push('What it considered, and why each was not done:');
      L.push('');
      blocked.forEach(function (d) {
        L.push('- `' + d.action + '`' + (d.target ? ' on `' + d.target + '`' : '') + ' — ' + d.gate + ': ' + d.reason);
      });
    }
  } else {
    L.push('');
    L.push('| Action | Target | Ran | Verified |');
    L.push('|---|---|---|---|');
    taken.forEach(function (a) {
      L.push('| `' + a.action + '` | ' + (a.target || '—') + ' | `' + (a.argv || []).join(' ') + '` | ' +
        (a.verified === true ? 'yes — ' + (a.verification || '') : (a.verified === false ? '**no** — ' + (a.verification || a.error || '') : 'n/a')) + ' |');
    });
    L.push('');
    taken.forEach(function (a) { L.push('- Undoing `' + a.action + '`: ' + a.reversible); });
    L.push('');
    L.push('Nothing else was touched. Every action is a static entry in `ops/guardian/lib/actions.js`,');
    L.push('individually gated, and Guardian still has no kill and no delete path.');
  }
  if (o.suggestions !== false) {
    var sug = suggestions(report);
    if (sug.length) {
      L.push('');
      L.push('## For a human to consider');
      L.push('');
      L.push('These are read-only observations, not automated actions. Each needs an operator decision.');
      L.push('');
      sug.forEach(function (s) { L.push('- ' + s); });
    }
  }
  return L.join('\n');
}

// Non-destructive suggestions only: nothing here proposes deleting data,
// pruning volumes, force-resetting a checkout or stopping a production unit.
function suggestions(report) {
  var out = [];
  var f = report.findings;
  function has(kind) { return f.some(function (x) { return x.kind === kind; }); }
  if (has('oom_kill') || levels.rank(report.domains.memory.level) >= levels.rank('CRITICAL')) {
    out.push('Memory: check which agent sessions are resident (`mythos-session-guard` reports them) and close finished ones from their own client before anything is killed.');
  }
  if (has('agent_concurrency') || has('agent_concurrency_under_pressure')) {
    out.push('Sessions: concurrency is above the ceiling for the current memory level. Admission control belongs to the session guard; enabling its enforcement marker is an owner decision.');
  }
  if (has('orphan_processes')) {
    out.push('Orphans: tool processes reparented to PID 1 were observed. Identify their owning session before terminating anything.');
  }
  if (levels.rank(report.domains.disk.level) >= levels.rank('WARNING')) {
    out.push('Disk: review the reported growth sources. Cleanup on this host is owner-gated and every candidate needs a verified copy first — no broad prune.');
  }
  if (has('restart_loop')) {
    out.push('Services: a restart loop was observed. Read the unit journal before restarting it again; repeated restarts can mask the real fault.');
  }
  if (has('backup_failed') || has('backup_warning')) {
    out.push('Backup: a health record is stale or failed. Verify against the remote copy before any corrective run; never delete an existing backup.');
  }
  if (has('restore_test_failed') || has('restore_test_unverified')) {
    out.push('Restore: the restore test is overdue or unverified. A backup that has not been restored is not yet a backup.');
  }
  if (report.guardian.state !== 'OK') {
    out.push('Guardian: ' + report.guardian.issues.join('; ') + '. Guardian health is separate from host health — a degraded Guardian does not mean a degraded host.');
  }
  return out;
}

module.exports = { text: text, incident: incident, remediationLine: remediationLine, suggestions: suggestions, detail: detail };
