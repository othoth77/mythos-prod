'use strict';
// =====================================================
// MYTHOS Autopilot — change-aware test selection
// projects/mythos-ai-executor/lib/autopilot/test-impact.js
//
//   changed files ──▶ affected suites ──▶ run ──▶ PASS → continue / FAIL → STOP
//
// The audit found that the existing map (projects/meta/test-impact-map.json,
// hand-written 2026-08-08) covers none of the operational core, and that
// ~90 of 153 suites never `require()` the code they test — they read it as
// text (readFileSync + regex). So the map is GENERATED from the suites
// themselves: every require() target AND every path-shaped string literal
// (incl. path.join(BASE, 'projects', 'x', ...) sequences) becomes a
// dependency of that suite. A changed file selects a suite when the suite
// depends on the file, on its directory, or on any parent directory it
// names. Suites are excluded when they need a database, docker, sudo or
// the network (metadata, not guesswork: detected from the source).
//
// Sensitive paths (governance-protected list mirror, service/, ops/,
// .github/, bridge/ core) force FULL regression. Full regression is always
// available on request (`--full`).
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var DANGEROUS = {
  'tests/erp-acceptance-test.js': 'hits a real PostgreSQL; run tests/erp-acceptance-drill.sh',
  'tests/erp-security-test.js': 'hits a real PostgreSQL; run tests/erp-acceptance-drill.sh',
  'tests/mos-e2e-lifecycle-test.js': 'completes real missions and refuses to run where the mythos-prod checkout exists; isolated container only',
  'tests/core-test.js': 'known-failing on an unmodified tree (ReferenceError in cleanup)',
  'tests/mpi-0-finalization-governance-test.js': 'known-failing on an unmodified tree (skills registry drift)'
};

var SENSITIVE_PREFIXES = [
  'projects/mythos-ai-executor/service/', 'projects/mythos-ai-executor/lib/policy.js', 'projects/mythos-ai-executor/lib/state.js',
  'projects/mythos-ai-executor/config/policy.json', 'projects/mythos-ai-executor/config/budgets.json', 'projects/mythos-ai-executor/core/policy-engine.js',
  'projects/mythos-ai-executor/executor.js', 'projects/mythos-ai-executor/server.js', 'projects/mythos-ai-executor/bridge/github-bridge.js',
  '.github/', 'ops/session-guard/', 'ops/hostops/', 'projects/mythos-orchestrator/lib/redact.js'
];

var PATH_ROOTS = ['projects/', 'ops/', 'scripts/', 'docs/', 'deploy/', 'sites/', 'tests/', '.github/', 'js/', 'css/', 'tools/', 'oth-knowledge/'];

function readSuiteDeps(file) {
  var src = fs.readFileSync(file, 'utf8');
  var deps = {};
  var reqDeps = {};
  var add = function (p) {
    p = String(p).replace(/^\.\//, '').replace(/\/+$/, '');
    if (!p || p.indexOf('..') === 0) return;
    deps[p] = 1;
  };
  // require('<relative>') resolved against the test file.
  var re = /require\(\s*(?:path\.join\(\s*__dirname\s*,\s*)?['"]([^'"]+)['"]/g, m;
  while ((m = re.exec(src))) {
    var t = m[1];
    if (t.indexOf('.') === 0 || t.indexOf('/') === 0) {
      var abs = path.resolve(path.dirname(file), t);
      var relTarget = path.relative(REPO_ROOT, abs).replace(/\.js$/, '');
      add(relTarget); reqDeps[relTarget] = 1;
    }
  }
  // path.join(<ident>, 'a', 'b', ...) → a/b (when the segments look like repo paths)
  var rj = /path\.join\(\s*[A-Za-z_$][\w$.]*\s*((?:,\s*['"][^'"]+['"]\s*)+)\)/g;
  while ((m = rj.exec(src))) {
    var segs = m[1].match(/['"]([^'"]+)['"]/g).map(function (s) { return s.slice(1, -1); });
    var joined = segs.join('/');
    if (PATH_ROOTS.some(function (r) { return joined.indexOf(r) === 0; }) || segs[0] === 'AGENTS.md' || segs[0] === 'CLAUDE.md') {
      add(joined.replace(/\.js$/, ''));
      if (/require\(\s*$/.test(src.slice(Math.max(0, m.index - 16), m.index))) reqDeps[joined.replace(/\.js$/, '')] = 1;
    }
  }
  // bare path-shaped string literals
  var rs = /['"`]((?:projects|ops|scripts|docs|deploy|sites|tests|\.github|js|css|tools)\/[A-Za-z0-9_./@-]+)['"`]/g;
  while ((m = rs.exec(src))) add(m[1].replace(/\.js$/, ''));
  var needs = [];
  var DB_RE = /require\(\s*['"](pg|pg-native|mysql2?|better-sqlite3)['"]\s*\)|DATABASE_URL|['"]psql['"]/;
  if (DB_RE.test(src)) needs.push('database');
  // One level down: a suite that requires a project module which itself
  // requires a database driver needs that driver installed (mpi-2h-cli).
  // Only real require() targets are followed — a path literal in an
  // assertion is a reference, not a dependency.
  if (needs.indexOf('database') === -1) {
    Object.keys(reqDeps).some(function (d) {
      var cand = [path.join(REPO_ROOT, d + '.js'), path.join(REPO_ROOT, d, 'index.js'), path.join(REPO_ROOT, d)];
      for (var i = 0; i < cand.length; i++) {
        try { if (fs.statSync(cand[i]).isFile() && DB_RE.test(fs.readFileSync(cand[i], 'utf8'))) { needs.push('database'); return true; } } catch (e) { /* not a file */ }
      }
      return false;
    });
  }
  if (/['"]docker['"]|\bdocker\s/.test(src) && /spawnSync|execFileSync|execSync/.test(src)) needs.push('docker');
  if (/spawnSync\(\s*['"](sudo|\/usr\/bin\/sudo)['"]/.test(src)) needs.push('sudo');
  return { deps: Object.keys(deps), needs: needs };
}

var REPO_ROOT = null;

// buildMap(repoRoot) → { generated_at, suites: { 'tests/x-test.js': {deps, needs, excluded} } }
function buildMap(repoRoot) {
  REPO_ROOT = repoRoot;
  var dir = path.join(repoRoot, 'tests');
  var suites = {};
  fs.readdirSync(dir).filter(function (n) { return /-test\.js$/.test(n); }).sort().forEach(function (n) {
    var rel = 'tests/' + n;
    var info;
    try { info = readSuiteDeps(path.join(dir, n)); } catch (e) { info = { deps: [], needs: [], error: e.message }; }
    suites[rel] = { deps: info.deps, needs: info.needs, excluded: DANGEROUS[rel] || (info.needs.length ? 'needs ' + info.needs.join('+') : null) };
  });
  return { generated_at: new Date().toISOString(), repo: repoRoot, suites: suites };
}

function normalise(p) { return String(p).replace(/^\.\//, '').replace(/\.js$/, ''); }

// A dependency d "covers" changed file f when f == d, f is under directory d,
// or d is under f's directory (a suite naming a sibling in the same module dir).
function covers(dep, file) {
  var d = normalise(dep), f = normalise(file);
  if (d === f) return true;
  if (f.indexOf(d + '/') === 0) return true;
  var fdir = f.slice(0, f.lastIndexOf('/'));
  if (fdir && d.indexOf(fdir + '/') === 0 && d.split('/').length === f.split('/').length) return true;
  return false;
}

// select(map, changedFiles) → { suites, full, sensitive, unmatched, excluded }
function select(map, changed) {
  var sensitive = changed.filter(function (f) { return SENSITIVE_PREFIXES.some(function (p) { return f.indexOf(p) === 0; }); });
  var selected = {}, unmatched = [], excluded = [];
  changed.forEach(function (f) {
    var hit = false;
    Object.keys(map.suites).forEach(function (s) {
      var info = map.suites[s];
      if (info.deps.some(function (d) { return covers(d, f); })) {
        hit = true;
        if (info.excluded) excluded.push({ suite: s, reason: info.excluded, for: f });
        else selected[s] = (selected[s] || []).concat([f]);
      }
    });
    // A changed test file selects itself.
    if (/^tests\/.*-test\.js$/.test(f) && map.suites[f] && !map.suites[f].excluded) { selected[f] = (selected[f] || []).concat([f]); hit = true; }
    if (!hit) unmatched.push(f);
  });
  var docOnly = changed.length > 0 && changed.every(function (f) { return /^docs\/|\.md$/.test(f); });
  return {
    suites: Object.keys(selected).sort().map(function (s) { return { suite: s, because: selected[s] }; }),
    full: sensitive.length > 0,
    full_reason: sensitive.length ? 'sensitive path(s) changed: ' + sensitive.join(', ') : null,
    sensitive: sensitive, unmatched: unmatched, excluded: dedupe(excluded), doc_only: docOnly
  };
}

function dedupe(list) { var seen = {}; return list.filter(function (x) { var k = x.suite + '|' + x.reason; if (seen[k]) return false; seen[k] = true; return true; }); }

function changedFiles(git, cwd, base) {
  var r = git(cwd, ['diff', '--name-only', base + '...HEAD']);
  var files = r.ok && r.out ? r.out.split('\n').filter(Boolean) : [];
  var st = git(cwd, ['status', '--porcelain', '--untracked-files=all']);
  // porcelain lines are "XY path" (or "XY old -> new"); the runner trims the
  // output, so the first line may have lost its leading space — parse, don't slice.
  if (st.ok && st.out) st.out.split('\n').filter(Boolean).forEach(function (l) {
    var m = /^\s*([MADRCU?! ]{1,2})\s+(.+)$/.exec(l);
    if (!m) return;
    var f = m[2].indexOf(' -> ') >= 0 ? m[2].split(' -> ').pop() : m[2];
    f = f.trim().replace(/^"|"$/g, '');
    if (f && files.indexOf(f) === -1) files.push(f);
  });
  return files;
}

// run(repoRoot, suites, opts) — sequential, STOP on first failure, JSON result.
function run(repoRoot, suites, opts) {
  opts = opts || {};
  var results = [], stopped = null;
  for (var i = 0; i < suites.length; i++) {
    var s = suites[i];
    var started = Date.now();
    var r = cp.spawnSync(process.execPath, [path.join(repoRoot, s)], { cwd: repoRoot, encoding: 'utf8', timeout: opts.timeout_ms || 600000, maxBuffer: 16 * 1024 * 1024, env: Object.assign({}, process.env, opts.env || {}) });
    var out = String(r.stdout || '') + String(r.stderr || '');
    var counts = parseCounts(out);
    var rec = { suite: s, status: r.status, ok: r.status === 0 && !r.error, passed: counts.passed, failed: counts.failed, duration_ms: Date.now() - started, error: r.error ? String(r.error.message) : null, tail: out.split('\n').slice(-8).join('\n') };
    results.push(rec);
    if (opts.log) opts.log(rec);
    if (!rec.ok && opts.stop_on_fail !== false) { stopped = s; break; }
  }
  return { ok: !stopped && results.every(function (r) { return r.ok; }), results: results, stopped_at: stopped, ran: results.length, requested: suites.length, at: new Date().toISOString() };
}

function parseCounts(out) {
  var m = /(\d+)\s*(?:passed|\/)\s*,?\s*(\d+)\s*failed/i.exec(out) || /passed[:=]?\s*(\d+).*?failed[:=]?\s*(\d+)/i.exec(out) || /(\d+)\/(\d+)\s*(?:passed|ok)/i.exec(out);
  if (m) return { passed: parseInt(m[1], 10), failed: parseInt(m[2], 10) };
  return { passed: null, failed: null };
}

module.exports = { DANGEROUS: DANGEROUS, SENSITIVE_PREFIXES: SENSITIVE_PREFIXES, buildMap: buildMap, select: select, covers: covers, changedFiles: changedFiles, run: run, parseCounts: parseCounts };
