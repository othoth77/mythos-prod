#!/usr/bin/env node
'use strict';
// =====================================================
// OTHMODE — Skill / MCP trust CLI (SKILL-TRUST-0)
// projects/command-center/cli/skill-trust-cli.js
//
// The operator-side writer of the trust ledgers and the CI-side verifier.
// Runs the reused scanners (NVIDIA SkillSpector, Gitleaks, NVIDIA
// SkillEvaluator Tier 1), applies data/skill-trust-policy.json, writes the
// attestation into the registry's Git ledger and the scan history into the
// OTHMODE store. The HTTP layer never writes a ledger — attestations are
// reviewed diffs.
//
// Usage:
//   node skill-trust-cli.js scan <registry>:<id> [--dry-run]     scan + attest one skill
//   node skill-trust-cli.js scan --all [--registry claude|executor] [--dry-run]
//   node skill-trust-cli.js rescan [--registry ...]              rescan STALE / UNATTESTED only
//   node skill-trust-cli.js status [--registry ...] [--json]     trust row per skill
//   node skill-trust-cli.js verify [--json]                      CI gate: exit 1 if any
//                                                                enabled executor skill is not
//                                                                ACCEPT, or any skill is BLOCK
//   node skill-trust-cli.js mcp [--json]                         MCP layer decisions
//   node skill-trust-cli.js policy                               loaded policy summary
//   node skill-trust-cli.js tools                                which scanner binaries resolve
//
// Environment: OTHMODE_REPO_ROOT, OTHMODE_STORE_ROOT, SKILL_TRUST_POLICY,
//   SKILL_TRUST_{CLAUDE,EXECUTOR}_LEDGER, SKILL_TRUST_<SCANNER>_BIN.
// Exit codes: 0 ok · 1 gate failed / error · 2 usage.
// =====================================================

var os = require('os');
var cp = require('child_process');
var registries = require('../reference/othmode/registries.js');
var subjects = require('../reference/othmode/trust/subjects.js');
var scan = require('./lib/skill-trust-scan.js');
var trust = require('../reference/othmode/trust/index.js');
var store = require('../reference/othmode/store.js');

var args = process.argv.slice(2);
var cmd = args[0];
var flags = {};
var positional = [];
for (var i = 1; i < args.length; i++) {
  if (args[i] === '--registry') flags.registry = args[++i];
  else if (args[i].indexOf('--') === 0) flags[args[i].slice(2)] = true;
  else positional.push(args[i]);
}
var actor = 'operator:' + (os.userInfo().username || 'unknown');

function out(x) { console.log(JSON.stringify(x, null, 2)); }
function fail(msg, code) { console.error('ERROR: ' + msg); process.exit(code || 1); }
function registriesWanted() { return flags.registry ? [flags.registry] : subjects.REGISTRIES.slice(); }

function pad(s, n) { s = String(s === null || s === undefined ? '' : s); return s.length >= n ? s : s + new Array(n - s.length + 1).join(' '); }

function rows(regs) {
  return registries.skills().skills.filter(function (s) { return regs.indexOf(s.registry) !== -1; });
}

function printRows(list) {
  console.log(pad('REGISTRY', 10) + pad('SKILL', 32) + pad('STATUS', 15) + pad('DECISION', 9) + pad('RISK', 6) + pad('SCANNED', 22) + 'REASON');
  list.forEach(function (s) {
    var t = s.trust;
    console.log(pad(s.registry, 10) + pad(s.id, 32) + pad(t.status, 15) + pad(t.decision || '-', 9) + pad(t.risk_score === null ? '-' : t.risk_score, 6) +
      pad(t.scanned_at ? t.scanned_at.slice(0, 19) : '-', 22) + (t.reason || ''));
  });
}

function scanOne(registry, id) {
  var r = scan.scanAndAttest(registry, id, { actor: actor, store: store, dryRun: !!flags['dry-run'] });
  var e = r.entry;
  console.log((flags['dry-run'] ? '[dry-run] ' : '') + registry + ':' + id + ' → ' + e.decision +
    (r.written ? ' (ledger ' + r.written.file + ')' : '') + (r.history ? ' (history ' + r.history.id + ')' : ''));
  e.reasons.forEach(function (x) { console.log('    ' + x); });
  return e;
}

try {
  if (cmd === 'scan') {
    var targets = [];
    if (flags.all) {
      registriesWanted().forEach(function (reg) { subjects.listIds(reg).forEach(function (id) { targets.push([reg, id]); }); });
    } else {
      if (!positional[0] || positional[0].indexOf(':') === -1) fail('usage: scan <registry>:<id> | scan --all [--registry r]', 2);
      var parts = positional[0].split(':');
      targets.push([parts[0], parts.slice(1).join(':')]);
    }
    var tally = {};
    targets.forEach(function (t) { var e = scanOne(t[0], t[1]); tally[e.decision] = (tally[e.decision] || 0) + 1; });
    console.log('\n' + targets.length + ' scanned: ' + JSON.stringify(tally));
    if (!store.provisioned()) console.error('note: OTHMODE store not provisioned — ledger written, scan history not recorded');
  } else if (cmd === 'rescan') {
    var stale = rows(registriesWanted()).filter(function (s) { return ['STALE', 'UNATTESTED', 'LEDGER_INVALID'].indexOf(s.trust.status) !== -1; });
    if (!stale.length) { console.log('nothing to rescan'); }
    stale.forEach(function (s) { scanOne(s.registry, s.registry === 'claude' ? s.source_path.split('/')[2] : s.id); });
  } else if (cmd === 'status') {
    var list = rows(registriesWanted());
    if (flags.json) out({ policy: trust.policyInfo(), summary: trust.summarise(list), skills: list.map(function (s) { return { id: s.id, registry: s.registry, version: s.version, status: s.status, trust: s.trust }; }) });
    else { printRows(list); console.log('\npolicy: ' + JSON.stringify(trust.policyInfo())); console.log('summary: ' + JSON.stringify(trust.summarise(list))); }
  } else if (cmd === 'verify') {
    var all = rows(subjects.REGISTRIES);
    var problems = [];
    all.forEach(function (s) {
      if (s.trust.status === 'BLOCK') problems.push(s.registry + ':' + s.id + ' is BLOCK — ' + s.trust.reason);
      if (s.registry === 'executor' && s.status !== 'DISABLED' && !s.trust.trusted) problems.push('executor:' + s.id + ' enabled but ' + s.trust.status + ' — ' + s.trust.reason);
    });
    var pol = trust.policyInfo();
    if (!pol.valid) problems.push('policy invalid: ' + pol.reason);
    if (flags.json) out({ ok: problems.length === 0, problems: problems, summary: trust.summarise(all), policy: pol });
    else { printRows(all); console.log(''); problems.forEach(function (p) { console.log('FAIL ' + p); }); console.log(problems.length ? 'VERIFY FAILED (' + problems.length + ')' : 'VERIFY OK'); }
    process.exit(problems.length ? 1 : 0);
  } else if (cmd === 'mcp') {
    var view = registries.mcp();
    if (flags.json) out({ checked_at: view.checked_at, summary: view.trust_summary, servers: view.servers.map(function (s) { return { name: s.name, enabled: s.enabled, status: s.status, trust: s.trust }; }), sources: view.sources });
    else {
      console.log(pad('SERVER', 22) + pad('ENABLED', 9) + pad('MEASURED', 14) + pad('DECISION', 9) + 'REASONS');
      view.servers.forEach(function (s) { console.log(pad(s.name, 22) + pad(s.enabled, 9) + pad(s.status || '-', 14) + pad(s.trust.decision, 9) + s.trust.reasons.join(' | ')); });
      console.log('\nsnapshot: ' + (view.checked_at || 'absent') + '  summary: ' + JSON.stringify(view.trust_summary));
    }
  } else if (cmd === 'policy') {
    out(trust.policyInfo());
  } else if (cmd === 'tools') {
    var loaded = require('../reference/othmode/trust/policy.js').loadPolicy(trust.policyPath());
    var names = ['skillspector', 'gitleaks', 'skillevaluator'];
    names.forEach(function (n) {
      var bin = scan.binFor(n, loaded.valid ? loaded.policy : { scan: { bins: {} } });
      var probe = cp.spawnSync(bin, [n === 'gitleaks' ? 'version' : '--version'], { env: scan.minimalEnv(), encoding: 'utf8', timeout: 30000 });
      console.log(pad(n, 16) + pad(bin, 20) + (probe.error ? 'MISSING (' + (probe.error.code || probe.error.message) + ')' : String(probe.stdout || probe.stderr).trim().split('\n').pop()));
    });
  } else {
    console.error('usage: skill-trust-cli.js scan|rescan|status|verify|mcp|policy|tools  (see header)');
    process.exit(2);
  }
} catch (e) {
  fail(e && e.message ? e.message : String(e));
}
