// =====================================================
// STC-1 — Mythos Status Center suite
// tests/stc-1-status-center-test.js
//
// Offline suite over the status-center engine and site. Covers: fixed
// vocabulary + stable-ID validation (fail-closed on an invalid
// registry), the real registry validating cleanly, evidence
// verification (file/commit/pr paths, NOT_VERIFIED on failure),
// track-percentage calculation (never invented; NOT_CALCULABLE without
// stages), document reconciliation (missing file → UNVERIFIED),
// repository discovery (NEW_DISCOVERY, never silently classified),
// review-ID allocation + snapshot immutability, review comparison
// semantics (completed/blocked/unblocked/regressed, blocker deltas,
// percent changes), review idempotency, health-endpoint allowlist (no
// secrets), and UI security boundaries (no innerHTML/eval/external
// requests; hostile strings stay data).
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BASE = path.join(REPO, 'projects', 'status-center');
const SITE = path.join(REPO, 'sites', 'status.mythosprod.xyz');

const model = require(path.join(BASE, 'lib', 'model.js'));
const engine = require(path.join(BASE, 'lib', 'engine.js'));

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; }
  else { failed++; console.error('[FAIL] ' + label); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ')'); }
function expectError(fn, re, label) {
  try { fn(); failed++; console.error('[FAIL] ' + label + ' (no error thrown)'); }
  catch (e) { ok(re.test(String(e.message)), label + ' (got: ' + String(e.message).split('\n')[0] + ')'); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'stc-test-')); }

const registry = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'registry.json'), 'utf8'));

console.log('§1 fixed vocabulary and stable IDs');
{
  ok(model.isStatus('BLOCKED') && model.isStatus('OWNER_ACTION'), 'status vocabulary present');
  ok(!model.isStatus('almost done') && !model.isStatus('nearly finished'), 'vague statuses rejected');
  ok(model.isMaturity('PRODUCTION_VERIFIED') && model.isMaturity('ARCHITECTURE_DEFINED'), 'maturity ladder present');
  ok(!model.isMaturity('DONE'), 'status is not a maturity');
  eq(model.idKind('PROJECT-MYTHOS-OS'), 'project', 'project id shape');
  eq(model.idKind('BLOCKER-VPS-EXECUTION'), 'blocker', 'blocker id shape');
  eq(model.idKind('REVIEW-2026-08-20-001'), 'review', 'review id shape');
  eq(model.idKind('lowercase-nope'), null, 'malformed id rejected');
  ok(model.validPercent(0) && model.validPercent(100) && model.validPercent('NOT_CALCULABLE'), 'percent domain');
  ok(!model.validPercent(101) && !model.validPercent(-1) && !model.validPercent('87%'), 'invented percents rejected');
}

console.log('§2 registry validation is fail-closed');
{
  eq(model.validateRegistry(registry), [], 'the real registry validates cleanly');
  const bad = JSON.parse(JSON.stringify(registry));
  bad.projects[0].status = 'ALMOST_DONE';
  ok(model.validateRegistry(bad).length > 0, 'invalid status caught');
  const bad2 = JSON.parse(JSON.stringify(registry));
  bad2.blockers[0].unblock = '';
  ok(model.validateRegistry(bad2).length > 0, 'blocker without unblock procedure caught');
  const bad3 = JSON.parse(JSON.stringify(registry));
  bad3.projects[0].evidence = ['EV-DOES-NOT-EXIST'];
  ok(model.validateRegistry(bad3).some(function (e) { return /unknown evidence/.test(e); }), 'dangling evidence reference caught');
  const bad4 = JSON.parse(JSON.stringify(registry));
  bad4.projects.push(JSON.parse(JSON.stringify(registry.projects[0])));
  ok(model.validateRegistry(bad4).some(function (e) { return /duplicate id/.test(e); }), 'duplicate id caught');
  const bad5 = JSON.parse(JSON.stringify(registry));
  bad5.projects[0].dimensions = { roadmap: { percent: 87 } };
  ok(model.validateRegistry(bad5).some(function (e) { return /requires basis/.test(e); }), 'numeric percent without a declared basis caught');
  const bad6 = JSON.parse(JSON.stringify(registry));
  bad6.projects[0].directories = ['not-a-projects-path'];
  ok(model.validateRegistry(bad6).some(function (e) { return /bad directories/.test(e); }), 'malformed directories entry caught');
}

console.log('§3 evidence verification');
{
  const prLedger = { prs: [{ number: 45, title: 'OTH-K3', state: 'closed', merged: true }] };
  const out = engine.verifyEvidence(REPO, [
    { id: 'EV-A', type: 'file', reference: 'AGENTS.md' },
    { id: 'EV-B', type: 'file', reference: 'docs/DOES_NOT_EXIST_XYZ.md' },
    { id: 'EV-C', type: 'pr', reference: '#45' },
    { id: 'EV-D', type: 'pr', reference: '#9999' },
    { id: 'EV-E', type: 'operator-report', reference: 'on-host validation' },
    { id: 'EV-F', type: 'commit', reference: 'not-a-hash-!!' },
    { id: 'EV-G', type: 'test', reference: 'tests/stc-1-status-center-test.js' }
  ], prLedger);
  eq(out[0].evidence_status, 'VERIFIED', 'existing file VERIFIED');
  eq(out[1].evidence_status, 'NOT_VERIFIED', 'missing file NOT_VERIFIED — never silently complete');
  eq(out[2].evidence_status, 'VERIFIED', 'ledgered PR VERIFIED');
  eq(out[3].evidence_status, 'NOT_VERIFIED', 'unknown PR NOT_VERIFIED');
  eq(out[4].evidence_status, 'RECORDED', 'operator report stays RECORDED (not falsely VERIFIED)');
  eq(out[5].evidence_status, 'NOT_VERIFIED', 'malformed commit hash NOT_VERIFIED');
  eq(out[6].evidence_status, 'VERIFIED', 'test file existence VERIFIED');
}

console.log('§4 track percentage calculation — never invented');
{
  const t = engine.computeTrackProgress({ id: 'TRACK-X', name: 'X', stages: [
    { id: 'A', status: 'DONE' }, { id: 'B', status: 'DONE' },
    { id: 'C', status: 'SUPERSEDED' }, { id: 'D', status: 'OWNER_ACTION' }
  ] });
  eq(t.progress.percent, 75, '3 of 4 closed = 75%');
  eq(t.progress.basis, 'CALCULATED', 'basis declared');
  const t2 = engine.computeTrackProgress({ id: 'TRACK-Y', name: 'Y', stages: [] });
  eq(t2.progress.percent, 'NOT_CALCULABLE', 'no stages → NOT_CALCULABLE, no invented number');
}

console.log('§5 document reconciliation');
{
  const docs = engine.reconcileDocuments(REPO, [
    { path: 'docs/AI_HANDOVER.md', classification: 'CURRENT' },
    { path: 'docs/NO_SUCH_DOC_ANYWHERE.md', classification: 'CURRENT' }
  ]);
  eq(docs[0].exists, true, 'existing doc found');
  eq(docs[1].classification, 'UNVERIFIED', 'missing doc demoted to UNVERIFIED');
}

console.log('§6 repository discovery — nothing silently classified');
{
  const known = [{ id: 'REPO-A', full_name: 'othoth77/known', classification: 'ACTIVE' }];
  const snap = { captured_at: '2026-08-20', repos: [
    { full_name: 'othoth77/known', pushed_at: '2026-08-20' },
    { full_name: 'othoth77/brand-new-repo', pushed_at: '2026-08-20', visibility: 'private' }
  ] };
  const d = engine.discoverRepositories(known, snap);
  eq(d.new_discoveries.length, 1, 'one new discovery');
  eq(d.new_discoveries[0].classification, 'NEW_DISCOVERY', 'new repo is NEW_DISCOVERY, not auto-classified');
  ok(d.repositories.length === 2, 'known + discovered listed');
  eq(d.repositories[0].classification, 'ACTIVE', 'known classification untouched');
}

console.log('§6b monorepo project discovery — nothing silently classified');
{
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'projects', 'known-thing'), { recursive: true });
  fs.mkdirSync(path.join(root, 'projects', 'unclaimed-thing'), { recursive: true });
  const known = [{ id: 'PROJECT-A', directories: ['projects/known-thing'] }];
  const d = engine.discoverMonorepoProjects(root, known);
  eq(d.checked, true, 'discovery ran');
  eq(d.directories_checked, 2, 'both directories seen');
  eq(d.new_discoveries.length, 1, 'exactly the unclaimed directory surfaces');
  eq(d.new_discoveries[0].directory, 'projects/unclaimed-thing', 'unclaimed directory named');
  const clean = engine.discoverMonorepoProjects(root, [
    { id: 'PROJECT-A', directories: ['projects/known-thing'] },
    { id: 'PROJECT-B', directories: ['projects/unclaimed-thing'] }
  ]);
  eq(clean.new_discoveries, [], 'once claimed, the directory is no longer a discovery');
  const noProjectsDir = engine.discoverMonorepoProjects(tmpRoot(), known);
  eq(noProjectsDir.checked, false, 'missing projects/ directory reported, not thrown');
  // The real registry must claim every real projects/* directory (this is
  // the recurring reconciliation gh-issue-140 asked for, not a one-off).
  const real = engine.discoverMonorepoProjects(REPO, registry.projects);
  eq(real.new_discoveries, [], 'every projects/* directory in THIS repository is claimed by some project');
}

console.log('§7 review id allocation + snapshot immutability');
{
  const root = tmpRoot();
  const a = engine.allocateReviewId(root, '2026-08-20');
  eq(a.id, 'REVIEW-2026-08-20-001', 'first id of the day');
  fs.mkdirSync(path.dirname(a.file), { recursive: true });
  fs.writeFileSync(a.file, '{}');
  const b = engine.allocateReviewId(root, '2026-08-20');
  eq(b.id, 'REVIEW-2026-08-20-002', 'second id increments');
  // persistReview refuses to overwrite an existing snapshot
  const siteDir = tmpRoot();
  fs.mkdirSync(path.join(siteDir, 'reviews', '2026'), { recursive: true });
  const file = path.join(siteDir, 'reviews', '2026', '2026-08-20-review-001.json');
  fs.writeFileSync(file, '{"review_id":"REVIEW-2026-08-20-001","timestamp":"t","blockers":[],"git":{}}');
  expectError(function () {
    engine.persistReview({ snapshot: { review_id: 'REVIEW-2026-08-20-001' }, file: file }, siteDir);
  }, /STC_REVIEW_IMMUTABLE/, 'existing snapshot never overwritten');
}

console.log('§8 review comparison semantics');
{
  const prev = {
    review_id: 'REVIEW-2026-08-19-001',
    projects: [
      { id: 'PROJECT-A', status: 'IN_PROGRESS' },
      { id: 'PROJECT-B', status: 'BLOCKED' },
      { id: 'PROJECT-C', status: 'DONE' },
      { id: 'PROJECT-D', status: 'READY' }
    ],
    tracks: [{ id: 'TRACK-T', progress: { percent: 50 }, stages: [{ id: 'S1', status: 'IN_PROGRESS' }] }],
    blockers: [{ id: 'BLOCKER-OLD', title: 'old' }],
    owner_actions: []
  };
  const curr = {
    projects: [
      { id: 'PROJECT-A', status: 'DONE' },
      { id: 'PROJECT-B', status: 'READY' },
      { id: 'PROJECT-C', status: 'IN_PROGRESS' },
      { id: 'PROJECT-D', status: 'BLOCKED' },
      { id: 'PROJECT-E', status: 'NOT_STARTED' }
    ],
    tracks: [{ id: 'TRACK-T', progress: { percent: 75 }, stages: [{ id: 'S1', status: 'DONE' }] }],
    blockers: [{ id: 'BLOCKER-NEW', title: 'new' }],
    owner_actions: [{ id: 'ACTION-X', what: 'x' }]
  };
  const ch = engine.compareReviews(prev, curr);
  ok(ch.completed.some(function (e) { return e.id === 'PROJECT-A'; }), 'IN_PROGRESS → DONE is COMPLETED');
  ok(ch.unblocked.some(function (e) { return e.id === 'PROJECT-B'; }), 'BLOCKED → READY is UNBLOCKED');
  ok(ch.regressed.some(function (e) { return e.id === 'PROJECT-C'; }), 'DONE → IN_PROGRESS is REGRESSED');
  ok(ch.blocked.some(function (e) { return e.id === 'PROJECT-D'; }), 'READY → BLOCKED is BLOCKED');
  ok(ch.new_projects.some(function (e) { return e.id === 'PROJECT-E'; }), 'new project detected');
  ok(ch.completed.some(function (e) { return e.id === 'TRACK-T/S1'; }), 'stage completion detected');
  ok(ch.percent_changes.some(function (e) { return e.id === 'TRACK-T' && e.from === 50 && e.to === 75; }), 'percent change tracked');
  ok(ch.new_blockers.some(function (e) { return e.id === 'BLOCKER-NEW'; }), 'new blocker');
  ok(ch.removed_blockers.some(function (e) { return e.id === 'BLOCKER-OLD'; }), 'removed blocker');
  ok(ch.new_owner_actions.some(function (e) { return e.id === 'ACTION-X'; }), 'new owner action');
  const baseline = engine.compareReviews(null, curr);
  ok(/baseline/.test(baseline.note || ''), 'no previous review → explicit baseline note, no fabricated diff');
}

console.log('§9 full review run + idempotency');
{
  const siteDir = tmpRoot();
  const now = new Date('2026-08-20T12:00:00Z');
  const r1 = engine.runReview({ repoRoot: REPO, dataDir: path.join(BASE, 'data'), siteDir: siteDir, now: now });
  engine.persistReview(r1, siteDir);
  const r2 = engine.runReview({ repoRoot: REPO, dataDir: path.join(BASE, 'data'), siteDir: siteDir, now: now });
  // Identical inputs → the second review differs only in id/previous/changes bookkeeping.
  function material(s) {
    const c = JSON.parse(JSON.stringify(s));
    delete c.review_id; delete c.timestamp; delete c.previous_review; delete c.changes;
    return c;
  }
  eq(JSON.stringify(material(r2.snapshot)) === JSON.stringify(material(r1.snapshot)), true,
    'review is idempotent over unchanged inputs');
  const ch = r2.snapshot.changes;
  eq(ch.completed.length + ch.blocked.length + ch.unblocked.length + ch.regressed.length + ch.changed.length, 0,
    'no phantom changes between identical states');
  eq(r2.snapshot.previous_review, r1.snapshot.review_id, 'previous review linked');
  // Second persist gets id -002 and both snapshots stay on disk.
  engine.persistReview(r2, siteDir);
  const idx = JSON.parse(fs.readFileSync(path.join(siteDir, 'data', 'reviews-index.json'), 'utf8'));
  eq(idx.reviews.length, 2, 'history preserved (2 immutable snapshots)');
  eq(idx.reviews[0].review_id, 'REVIEW-2026-08-20-001', 'first snapshot intact');
}

console.log('§10 health endpoint — allowlist only, no secrets');
{
  const health = JSON.parse(fs.readFileSync(path.join(SITE, 'health.json'), 'utf8'));
  const allowed = ['application', 'version', 'status', 'review_id', 'review_timestamp',
    'data_timestamp', 'repository_head', 'last_review'];
  eq(Object.keys(health).filter(function (k) { return allowed.indexOf(k) === -1; }), [],
    'health body is exactly the allowlist');
  eq(health.application, 'mythos-status-center', 'application name');
  ok(/^REVIEW-\d{4}-\d{2}-\d{2}-\d{3}$/.test(health.review_id), 'review id well-formed');
}

console.log('§11 security boundaries in the published data');
{
  const files = ['data/registry.json', 'data/pr-ledger.json', 'data/repo-snapshot.json'];
  const secretRe = /(api[_-]?key|secret[_-]?key|password\s*[:=]|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/i;
  files.forEach(function (f) {
    const body = fs.readFileSync(path.join(BASE, '..', 'status-center', f).replace('status-center/data', 'status-center/data'), 'utf8');
    ok(!secretRe.test(body), 'no secret material in ' + f);
  });
  const current = fs.readFileSync(path.join(SITE, 'data', 'current.json'), 'utf8');
  ok(!secretRe.test(current), 'no secret material in the published snapshot');
  ok(current.indexOf('MOS_CONSOLE_SECRET=') === -1, 'no secret values (name-only references are policy)');
}

console.log('§12 UI is XSS-safe by construction and self-contained');
{
  const appJsRaw = fs.readFileSync(path.join(SITE, 'assets', 'app.js'), 'utf8');
  // Strip comments so prose about forbidden APIs doesn't mask real usage.
  const appJs = appJsRaw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(appJs.indexOf('innerHTML') === -1, 'app.js never uses innerHTML');
  ok(appJs.indexOf('insertAdjacentHTML') === -1, 'app.js never uses insertAdjacentHTML');
  ok(appJs.indexOf('document.write') === -1, 'app.js never uses document.write');
  ok(!/\beval\s*\(/.test(appJs), 'app.js never uses eval');
  ok(!/new\s+Function/.test(appJs), 'app.js never uses new Function');
  ok(!/https?:\/\//.test(appJs.replace(/\/\/.*$/gm, '')), 'app.js makes no external requests (same-origin only)');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  ok(!/<script(?![^>]*src=)/i.test(html.replace(/<\/script>/gi, '')), 'no inline script blocks in index.html');
  ok(!/\son[a-z]+\s*=/i.test(html), 'no inline event handlers in index.html');
  ok(html.indexOf('assets/app.js') !== -1, 'renderer loaded from same-origin asset');
  ok(/noindex/.test(html), 'robots noindex meta present (operational surface)');
  // A hostile registry string must survive as data, not become markup:
  const hostile = '<img src=x onerror=alert(1)>';
  const reg2 = JSON.parse(JSON.stringify(registry));
  reg2.projects[0].purpose = hostile;
  eq(model.validateRegistry(reg2), [], 'hostile string is valid DATA (rendering path is textContent-only)');
}

console.log('§13 review engine rejects an invalid registry (fail closed)');
{
  const dir = tmpRoot();
  fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ projects: 'nope' }));
  expectError(function () {
    engine.runReview({ repoRoot: REPO, dataDir: dir, siteDir: tmpRoot(), now: new Date('2026-08-20T12:00:00Z') });
  }, /STC_REGISTRY_INVALID/, 'invalid registry refuses to produce a review');
}

console.log('§14 git subcommand allowlist');
{
  const gitfacts = require(path.join(BASE, 'lib', 'gitfacts.js'));
  const denied = gitfacts.tryGit(REPO, ['push', 'origin', 'main']);
  ok(!denied.ok && /STC_GIT_DENIED/.test(denied.error), 'mutating git subcommands denied');
  const r = gitfacts.tryGit(REPO, ['rev-parse', 'HEAD']);
  ok(r.ok && /^[0-9a-f]{40}$/.test(r.value), 'read-only rev-parse allowed');
}

console.log('');
console.log('stc-1: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
