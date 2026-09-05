#!/usr/bin/env node
// tests/status-center-check-test.js — ops/dagu/bin/mythos-status-center-check +
// review.js --dry-run --json (gh-issue-140 review scheduling).
// Offline: the served health body is a local file; the review engine runs
// dry against this repository and must write nothing.
'use strict';
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var ROOT = path.resolve(__dirname, '..');
var TOOL = path.join(ROOT, 'ops', 'dagu', 'bin', 'mythos-status-center-check');
var SITE = path.join(ROOT, 'sites', 'status.mythosprod.xyz');
var passed = 0, failed = 0;
function ok(c, name) { if (c) passed++; else { failed++; console.error('FAIL: ' + name); } }
function run(args, env) { return cp.spawnSync(TOOL, args, { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) }); }
function lastJson(s) { return JSON.parse(String(s).trim().split('\n').pop()); }
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stc-check-'));
function fingerprint() {
  return ['health.json', 'data/current.json', 'data/reviews-index.json'].map(function (f) { return fs.statSync(path.join(SITE, f)).mtimeMs + ':' + fs.statSync(path.join(SITE, f)).size; }).join(',') +
    ':' + fs.readdirSync(path.join(SITE, 'reviews', '2026')).length;
}
var before = fingerprint();

// review.js --dry-run --json: one JSON object, nothing written.
var rj = cp.spawnSync(process.execPath, [path.join(ROOT, 'projects', 'status-center', 'bin', 'review.js'), '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
ok(rj.status === 0, 'review.js --dry-run --json exits 0');
var j = null; try { j = JSON.parse(rj.stdout.trim()); } catch (e) { j = null; }
ok(j && /^REVIEW-\d{4}-\d{2}-\d{2}-\d{3}$/.test(j.review_id) && j.dry_run === true && j.persisted === null, 'json: review id, dry_run=true, persisted=null');
ok(j && Array.isArray(j.new_repo_discoveries) && Array.isArray(j.new_project_discoveries) && j.monorepo_discovery_checked === true, 'json: discovery arrays present, monorepo discovery ran');
ok(j && j.changes && typeof j.changes.added === 'number' && typeof j.projects === 'number', 'json: counts only');
ok(!/"evidence"|"snapshot"|"documents"/.test(rj.stdout), 'json: no evidence bodies printed');
ok(fingerprint() === before, 'dry run wrote nothing under sites/');

// Tool: served == repo → served_matches_repo true; state depends on discoveries only.
var repoHealth = JSON.parse(fs.readFileSync(path.join(SITE, 'health.json'), 'utf8'));
var same = path.join(tmp, 'same.json'); fs.writeFileSync(same, JSON.stringify(repoHealth));
var r1 = run([ROOT, '--served', same]);
var o1 = lastJson(r1.stdout);
ok(o1.served_matches_repo === true && o1.repo_review === repoHealth.review_id && o1.served_review === repoHealth.review_id, 'tool: served == repo review');
var anyDisco = o1.new_repo_discoveries.length + o1.new_project_discoveries.length > 0;
ok((anyDisco && o1.state === 'ATTENTION' && r1.status === 3 && /classify/.test(o1.next)) || (!anyDisco && o1.state === 'CURRENT' && r1.status === 0 && o1.next === null), 'tool: state follows discoveries (' + o1.state + ', exit ' + r1.status + ')');
ok(o1.checked_at && o1.would_be_review && o1.changes, 'tool: timestamp, would-be review id and change counts');

// Tool: served behind the repo → ATTENTION, exit 3, publish hint.
var stale = path.join(tmp, 'stale.json'); fs.writeFileSync(stale, JSON.stringify(Object.assign({}, repoHealth, { review_id: 'REVIEW-2026-08-26-005', last_review: 'REVIEW-2026-08-26-005' })));
var r2 = run([ROOT, '--served', stale]);
var o2 = lastJson(r2.stdout);
ok(r2.status === 3 && o2.state === 'ATTENTION' && o2.served_matches_repo === false && o2.served_review === 'REVIEW-2026-08-26-005', 'tool: a stale served review is ATTENTION / exit 3');
ok(/deploy-status-center\.sh/.test(o2.next), 'tool: the next step names the sanctioned publish script');

// Tool: served unreachable → measurement failed, exit 2 (never CURRENT).
var r3 = run([ROOT, '--served', path.join(tmp, 'missing.json')]);
ok(r3.status === 2 && lastJson(r3.stdout).state === 'MEASUREMENT_FAILED', 'tool: unreachable served body = MEASUREMENT_FAILED / exit 2');
var r4 = run([ROOT, '--served', 'http://127.0.0.1:9/health.json']);
ok(r4.status === 2 && lastJson(r4.stdout).state === 'MEASUREMENT_FAILED', 'tool: unreachable served URL = MEASUREMENT_FAILED / exit 2');

// Usage.
ok(run([]).status === 64, 'tool: no repo = usage exit 64');
ok(run([path.join(tmp, 'norepo')]).status === 2, 'tool: a directory without review.js = exit 2');
ok(fingerprint() === before, 'the tool wrote nothing under sites/');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('status-center-check tests: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
