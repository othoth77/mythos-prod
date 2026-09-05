#!/usr/bin/env node
// =====================================================
// MYTHOS STATUS CENTER — review CLI
// projects/status-center/bin/review.js
//
// Usage:
//   node projects/status-center/bin/review.js            # run + persist a review
//   node projects/status-center/bin/review.js --dry-run  # run, print summary, write nothing
//   node projects/status-center/bin/review.js --dry-run --json
//                       # same, one JSON object on stdout (machine-readable:
//                       # ops/dagu/bin/mythos-status-center-check consumes it)
//
// This is the [REVIEW NOW] engine. It is strictly read-only over the
// repository and writes ONLY:
//   sites/status.mythosprod.xyz/reviews/YYYY/…-review-NNN.json  (immutable)
//   sites/status.mythosprod.xyz/data/current.json
//   sites/status.mythosprod.xyz/data/reviews-index.json
//   sites/status.mythosprod.xyz/health.json
// =====================================================
'use strict';

const path = require('path');
const engine = require('../lib/engine.js');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dataDir = path.join(repoRoot, 'projects', 'status-center', 'data');
const siteDir = path.join(repoRoot, 'sites', 'status.mythosprod.xyz');
const dryRun = process.argv.indexOf('--dry-run') !== -1;
const asJson = process.argv.indexOf('--json') !== -1;

let result;
try {
  result = engine.runReview({ repoRoot: repoRoot, dataDir: dataDir, siteDir: siteDir });
} catch (e) {
  console.error('REVIEW FAILED (fail-closed): ' + e.message);
  process.exit(1);
}

const s = result.snapshot;
if (asJson) {
  // Machine-readable summary — ids, counts and names only (no evidence
  // bodies, no secrets; the snapshot itself is never printed).
  const summary = {
    review_id: s.review_id,
    timestamp: s.timestamp,
    origin_main: s.git.origin_main || null,
    previous_review: s.previous_review || null,
    projects: s.projects.length,
    tracks: s.tracks.length,
    blocked: s.blockers.filter(function (b) { return b.status === 'BLOCKED'; }).length,
    owner_action: s.blockers.filter(function (b) { return b.status === 'OWNER_ACTION'; }).length,
    new_repo_discoveries: s.new_discoveries.map(function (d) { return d.full_name || String(d); }),
    monorepo_discovery_checked: s.monorepo_discovery.checked,
    new_project_discoveries: s.monorepo_discovery.new_discoveries.map(function (d) { return d.directory || String(d); }),
    changes: {
      added: s.changes.added.length, completed: s.changes.completed.length, unblocked: s.changes.unblocked.length,
      blocked: s.changes.blocked.length, regressed: s.changes.regressed.length, changed: s.changes.changed.length
    },
    dry_run: dryRun,
    persisted: null
  };
  if (!dryRun) {
    const p = engine.persistReview(result, siteDir);
    summary.persisted = { file: path.relative(repoRoot, p.file), index_size: p.index_size };
  }
  console.log(JSON.stringify(summary));
  process.exit(0);
}
console.log('Review:        ' + s.review_id);
console.log('Timestamp:     ' + s.timestamp);
console.log('origin/main:   ' + (s.git.origin_main || 'NOT_VERIFIED'));
console.log('Projects:      ' + s.projects.length);
console.log('Tracks:        ' + s.tracks.length);
console.log('Blockers:      ' + s.blockers.filter(function (b) { return b.status === 'BLOCKED'; }).length + ' blocked, ' +
  s.blockers.filter(function (b) { return b.status === 'OWNER_ACTION'; }).length + ' owner-action');
console.log('Evidence:      ' + s.evidence.length + ' items (' +
  s.evidence.filter(function (e) { return e.evidence_status === 'VERIFIED'; }).length + ' verified here, ' +
  s.evidence.filter(function (e) { return e.evidence_status === 'RECORDED'; }).length + ' recorded, ' +
  s.evidence.filter(function (e) { return e.evidence_status === 'NOT_VERIFIED'; }).length + ' NOT verified)');
console.log('New repo discoveries: ' + s.new_discoveries.length);
console.log('New project discoveries (projects/*): ' + s.monorepo_discovery.new_discoveries.length +
  ' (checked ' + s.monorepo_discovery.directories_checked + ' directories)');
console.log('Previous review:      ' + (s.previous_review || 'none (baseline)'));
const ch = s.changes;
console.log('Changes: +' + ch.added.length + ' added, ' + ch.completed.length + ' completed, ' +
  ch.unblocked.length + ' unblocked, ' + ch.blocked.length + ' blocked, ' +
  ch.regressed.length + ' regressed, ' + ch.changed.length + ' changed');

if (dryRun) {
  console.log('(dry run — nothing written)');
  process.exit(0);
}

const persisted = engine.persistReview(result, siteDir);
console.log('Snapshot:      ' + path.relative(repoRoot, persisted.file));
console.log('Review index:  ' + persisted.index_size + ' snapshots');
