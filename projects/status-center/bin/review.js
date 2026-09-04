#!/usr/bin/env node
// =====================================================
// MYTHOS STATUS CENTER — review CLI
// projects/status-center/bin/review.js
//
// Usage:
//   node projects/status-center/bin/review.js            # run + persist a review
//   node projects/status-center/bin/review.js --dry-run  # run, print summary, write nothing
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

let result;
try {
  result = engine.runReview({ repoRoot: repoRoot, dataDir: dataDir, siteDir: siteDir });
} catch (e) {
  console.error('REVIEW FAILED (fail-closed): ' + e.message);
  process.exit(1);
}

const s = result.snapshot;
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
