'use strict';
// =====================================================
// OTHMODE — trust scan runner (SKILL-TRUST-0)
// projects/command-center/cli/lib/skill-trust-scan.js
//
// The one place that spawns a scanner — and deliberately NOT under
// reference/othmode/: the modules the HTTP runtime serves never execute
// anything (tests/othmode-2-platform-test.js enforces it); only the
// operator CLI, run by a human or CI, may spawn the scanners. The pipeline the mandate asks for,
// in order, with nothing built that a maintained tool already provides:
//
//   DISCOVER   subjects.js (the two existing registries; no third store)
//   FETCH      nothing to fetch — skills arrive by reviewed Git diff
//   NORMALIZE  subjects.js resolves the target + content hash
//   SCAN       NVIDIA SkillSpector (static, --no-llm)        security
//              Gitleaks (dir mode)                            secrets
//              NVIDIA SkillEvaluator Tier 1                   schema/PII/license/unicode/quality/lint
//   EVALUATE   normalize.js → one internal result per scanner
//   POLICY     policy.js → ACCEPT / REVIEW / BLOCK
//   ATTEST     ledger.js (Git) + store trust stream (history, outside Git)
//
// Scanner processes get a MINIMAL environment — PATH, HOME, LANG, TMPDIR —
// never the caller's variables, so no provider key, token or bearer can
// reach a third-party tool; SkillSpector runs with --no-llm, so nothing
// leaves the host. A scanner that is absent, crashes, times out, or exits
// with an error status is a FAILURE, and the policy's answer to a failure
// is never ACCEPT. A scanner whose output cannot be understood is UNKNOWN,
// which the policy also never accepts.
//
// Test seam: SKILL_TRUST_<SCANNER>_BIN points at any executable honouring
// the same command line, so the offline suite drives the entire pipeline
// with canned reports and never depends on the real tools being present.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var TRUST = path.join(__dirname, '..', '..', 'reference', 'othmode', 'trust');
var normalize = require(path.join(TRUST, 'normalize.js'));
var policyLib = require(path.join(TRUST, 'policy.js'));
var subjects = require(path.join(TRUST, 'subjects.js'));
var ledger = require(path.join(TRUST, 'ledger.js'));

var RUNNER_VERSION = '1.0.0';

function minimalEnv() {
  var home = process.env.HOME || os.homedir();
  var pathVar = (process.env.PATH || '/usr/local/bin:/usr/bin:/bin');
  if (pathVar.indexOf(home + '/.local/bin') === -1) pathVar = home + '/.local/bin:' + pathVar;
  return { PATH: pathVar, HOME: home, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TMPDIR: process.env.TMPDIR || os.tmpdir(),
    PYTHONDONTWRITEBYTECODE: '1', NO_COLOR: '1', TERM: 'dumb' };
}

function binFor(name, policy) {
  var env = process.env['SKILL_TRUST_' + name.toUpperCase() + '_BIN'];
  if (env) return env;
  return (policy.scan && policy.scan.bins && policy.scan.bins[name]) || name;
}

// run(bin, args, opts) → { ok, status, signal, error, stdout, stderr, timedOut }
function run(bin, args, opts) {
  opts = opts || {};
  var r;
  try {
    r = cp.spawnSync(bin, args, { cwd: opts.cwd, env: minimalEnv(), encoding: 'utf8',
      timeout: opts.timeoutMs, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { ok: false, status: null, signal: null, error: e.message, stdout: '', stderr: '', timedOut: false };
  }
  var timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  return { ok: !r.error, status: r.status, signal: r.signal, error: r.error ? (r.error.code || r.error.message) : null,
    stdout: r.stdout || '', stderr: r.stderr || '', timedOut: timedOut };
}

function readJsonFile(file) {
  try { return { ok: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { return { ok: false, reason: e.code === 'ENOENT' ? 'report file absent' : 'report unparseable: ' + e.message }; }
}

function describeFailure(r) {
  if (r.timedOut) return 'timed out';
  if (r.error === 'ENOENT') return 'binary not found';
  if (r.error) return 'spawn error ' + r.error;
  if (r.signal) return 'killed by ' + r.signal;
  var tail = String(r.stderr || r.stdout || '').trim().split('\n').slice(-2).join(' | ').slice(0, 300);
  return 'exit ' + r.status + (tail ? ' (' + tail + ')' : '');
}

// --- one scanner each ------------------------------------------------------

// The REVIEW → ACCEPT path for a triaged finding is SkillSpector's own
// baseline mechanism (docs/SUPPRESSION.md upstream): an operator records the
// accepted finding, with a reason, in the Git-reviewed baseline file named
// by policy.scan.skillspector_baseline; the rescan then scores only what is
// NOT triaged. No OTHMODE-side override exists — the suppression is a diff.
function baselineArgs(policy) {
  var rel = policy.scan && typeof policy.scan.skillspector_baseline === 'string' ? policy.scan.skillspector_baseline : null;
  if (!rel) return [];
  var file = path.isAbsolute(rel) ? rel : path.join(require(path.join(TRUST, '..', 'resolve.js')).REPO_ROOT, rel);
  try { fs.accessSync(file, fs.constants.R_OK); } catch (e) { return []; }
  return ['--baseline', file];
}

function runSkillspector(target, work, policy, timeoutMs) {
  var out = path.join(work, 'skillspector.json');
  var r = run(binFor('skillspector', policy), ['scan', target, '--no-llm', '--format', 'json', '--output', out].concat(baselineArgs(policy)), { cwd: work, timeoutMs: timeoutMs });
  // Contract: 0 = scan completed (SAFE/CAUTION), 1 = scan completed (DO_NOT_INSTALL), 2 = error.
  if (!r.ok || (r.status !== 0 && r.status !== 1)) return normalize.failure('skillspector', describeFailure(r));
  var rep = readJsonFile(out);
  if (!rep.ok) return normalize.unknown('skillspector', rep.reason);
  return normalize.fromSkillspector(rep.data);
}

function runGitleaks(target, work, policy, timeoutMs) {
  var bin = binFor('gitleaks', policy);
  var ver = run(bin, ['version'], { cwd: work, timeoutMs: 20000 });
  var version = ver.ok && ver.status === 0 ? ver.stdout.trim().split('\n').pop().replace(/^v/, '') : null;
  var out = path.join(work, 'gitleaks.json');
  var r = run(bin, ['dir', target, '--report-format', 'json', '--report-path', out, '--no-banner', '--exit-code', '9'], { cwd: work, timeoutMs: timeoutMs });
  // Contract: 0 = no leaks, 9 = leaks found (our --exit-code), anything else = error.
  if (!r.ok || (r.status !== 0 && r.status !== 9)) return normalize.failure('gitleaks', describeFailure(r), version);
  var rep = readJsonFile(out);
  if (!rep.ok) return normalize.unknown('gitleaks', rep.reason, version);
  return normalize.fromGitleaks(rep.data, version);
}

function runSkillevaluator(target, work, policy, timeoutMs) {
  var bin = binFor('skillevaluator', policy);
  var ver = run(bin, ['--version'], { cwd: work, timeoutMs: 30000 });
  var vm = ver.ok && ver.status === 0 ? /version\s+([0-9][^\s]*)/i.exec(ver.stdout) : null;
  var version = vm ? vm[1] : null;
  var outDir = path.join(work, 'skillevaluator');
  fs.mkdirSync(outDir, { recursive: true });
  var checks = Array.isArray(policy.skillevaluator.checks) && policy.skillevaluator.checks.length ? policy.skillevaluator.checks : ['schema', 'pii', 'license', 'unicode', 'quality', 'lint'];
  var r = run(bin, ['validate', target, '--no-dedup', '--checks', checks.join(','), '-r', 'json', '-o', outDir, '-c'], { cwd: work, timeoutMs: timeoutMs });
  // Contract: 0 = every gate passed, 1 = a gate failed (a normal, complete run). Crash / missing → failure.
  if (!r.ok || (r.status !== 0 && r.status !== 1)) return normalize.failure('skillevaluator', describeFailure(r), version);
  var files;
  try { files = fs.readdirSync(outDir).filter(function (f) { return /^skillevaluator-output-.*\.json$/.test(f); }).sort(); }
  catch (e) { files = []; }
  if (!files.length) return normalize.failure('skillevaluator', 'no JSON report written (' + describeFailure(r) + ')', version);
  var rep = readJsonFile(path.join(outDir, files[files.length - 1]));
  if (!rep.ok) return normalize.unknown('skillevaluator', rep.reason, version);
  return normalize.fromSkillevaluator(rep.data, version);
}

var RUNNERS = { skillspector: runSkillspector, gitleaks: runGitleaks, skillevaluator: runSkillevaluator };

// --- the pipeline for one subject -----------------------------------------
//
// scanSubject(subj, loadedPolicy, opts) → attestation entry (not yet written)
//   opts.scanners  optional subset (default: policy.required_scanners ∪ known)
//   opts.actor     recorded as scanned_by
function scanSubject(subj, loaded, opts) {
  opts = opts || {};
  if (!loaded || !loaded.valid) {
    return entryFor(subj, { decision: 'BLOCK', reasons: ['trust policy unavailable: ' + (loaded ? loaded.reason : 'not loaded') + ' — fail closed'], per_scanner: {} }, [], null, opts.actor);
  }
  var policy = loaded.policy;
  var timeoutMs = policy.scan && typeof policy.scan.timeout_ms === 'number' ? policy.scan.timeout_ms : 180000;
  var names = Array.isArray(opts.scanners) && opts.scanners.length ? opts.scanners : Object.keys(RUNNERS);
  var work = fs.mkdtempSync(path.join(os.tmpdir(), 'othmode-trust-'));
  var results = [];
  try {
    names.forEach(function (name) {
      if (!RUNNERS[name]) { results.push(normalize.failure(name, 'no runner for scanner')); return; }
      results.push(RUNNERS[name](subj.target, work, policy, timeoutMs));
    });
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* scratch only */ }
  }
  var decision = policyLib.decide(results, policy);
  return entryFor(subj, decision, results, loaded.policy.policy_version, opts.actor);
}

function entryFor(subj, decision, results, policyVersion, actor) {
  var cap = 50;
  var findings = [];
  var scanners = {};
  results.forEach(function (r) {
    scanners[r.scanner] = { version: r.version, status: r.status, reason: r.reason, summary: r.summary };
    r.findings.forEach(function (f) {
      if (findings.length >= cap) return;
      findings.push({ scanner: r.scanner, id: f.id, category: f.category, severity: f.severity, file: f.file, line: f.line });
    });
  });
  return {
    id: subj.id,
    registry: subj.registry,
    source_path: subj.source_path,
    version: subj.version || null,
    content_sha256: subj.content_sha256,
    decision: decision.decision,
    reasons: decision.reasons,
    per_scanner: decision.per_scanner,
    scanned_at: new Date().toISOString(),
    scanned_by: actor || ('operator:' + (os.userInfo().username || 'unknown')),
    runner_version: RUNNER_VERSION,
    policy_version: policyVersion,
    scanners: scanners,
    findings_recorded: findings.length,
    findings_total: results.reduce(function (n, r) { return n + r.findings.length; }, 0),
    findings: findings
  };
}

// scanAndAttest(registry, id, opts) → { subject, entry, written: {file} | null, history: record|null }
// opts.policyPath, opts.store (the OTHMODE store module, optional), opts.dryRun
function scanAndAttest(registry, id, opts) {
  opts = opts || {};
  var subj = subjects.subject(registry, id);
  if (!subj.ok) {
    var e = new Error('cannot attest ' + registry + ':' + id + ' — ' + subj.reason);
    e.code = 'OTHMODE_TRUST_SUBJECT';
    throw e;
  }
  var loaded = policyLib.loadPolicy(opts.policyPath);
  var entry = scanSubject(subj, loaded, opts);
  var written = null;
  var history = null;
  if (!opts.dryRun) {
    written = ledger.upsert(registry, entry, loaded.valid ? loaded.policy.policy_version : null);
    if (opts.store && typeof opts.store.appendRecord === 'function' && opts.store.provisioned()) {
      history = opts.store.appendRecord('trust', { type: 'skill_scan', skill: entry.id, registry: entry.registry,
        content_sha256: entry.content_sha256, decision: entry.decision, reasons: entry.reasons,
        scanners: Object.keys(entry.scanners).map(function (k) { return { name: k, version: entry.scanners[k].version, status: entry.scanners[k].status }; }),
        policy_version: entry.policy_version, actor: entry.scanned_by });
    }
  }
  return { subject: subj, entry: entry, written: written, history: history };
}

module.exports = {
  RUNNER_VERSION: RUNNER_VERSION,
  RUNNERS: RUNNERS,
  minimalEnv: minimalEnv,
  binFor: binFor,
  scanSubject: scanSubject,
  scanAndAttest: scanAndAttest,
  entryFor: entryFor
};
