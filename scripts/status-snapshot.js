#!/usr/bin/env node
// =====================================================
// Mythos Status Center — repository discovery snapshot refresher
// scripts/status-snapshot.js
//
// The Status Center review engine ALREADY performs reconciliation:
// lib/engine.js runReview() verifies evidence, reconciles documents,
// compares against the previous immutable snapshot, and — via
// discoverRepositories() — classifies anything present on the account but
// absent from the curated registry as NEW_DISCOVERY. That mechanism is the
// ecosystem's reconnaissance layer and must not be rebuilt.
//
// What was missing is only its FEEDER. data/repo-snapshot.json is the
// input discoverRepositories() compares against, and nothing wrote it:
// the file itself says "Refresh by re-listing and rewriting this file",
// and no script in the repository did. It had gone stale, so
// NEW_DISCOVERY could not fire for anything created since.
//
// This script writes exactly that one file, in exactly the schema the
// engine already reads, and nothing else. It is not a source of truth: it
// records what the GitHub account listing showed at a moment in time. The
// registry stays the curated, human/AI-classified layer, and a discovered
// repository is never silently classified — it surfaces as NEW_DISCOVERY
// requiring classification.
//
// Reads GitHub through the already-authorized `gh` CLI session. No token
// is read, stored, printed or written by this script.
//
// Usage:
//   node scripts/status-snapshot.js [--dry-run] [--out <path>]
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(BASE, 'projects', 'status-center', 'data', 'repo-snapshot.json');
const REGISTRY = path.join(BASE, 'projects', 'status-center', 'data', 'registry.json');
const MAX_REPOS = 500;

const CAPTURE_METHOD =
  'Authorized `gh repo list` session listing for the account, written by '
  + 'scripts/status-snapshot.js. Refresh by re-running that script. Any repository '
  + 'present here but missing from registry.json appears in the dashboard as '
  + 'NEW_DISCOVERY requiring classification — it is never classified automatically.';

function fail(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function listRepos() {
  const r = spawnSync('gh',
    ['repo', 'list', '--limit', String(MAX_REPOS), '--json', 'nameWithOwner,pushedAt,visibility'],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.error) fail('the gh CLI is not available on this host');
  if (r.status !== 0) fail('gh repo list failed (exit ' + r.status + ') — is the session authorized?');
  let rows;
  try { rows = JSON.parse(r.stdout); }
  catch (e) { fail('gh returned output that is not valid JSON'); }
  if (!Array.isArray(rows)) fail('gh returned an unexpected shape');
  if (rows.length >= MAX_REPOS) fail('repository count reached the ' + MAX_REPOS + ' cap; raise it deliberately');
  return rows.map((x) => ({
    full_name: x.nameWithOwner,
    pushed_at: x.pushedAt || null,
    visibility: String(x.visibility || '').toLowerCase() || null,
  })).sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at)));
}

// Reported, not acted on: classification stays a curated decision.
function previewDiscoveries(repos) {
  let known = [];
  try { known = (JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).repositories || []); }
  catch (e) { return null; }
  const set = new Set(known.map((r) => String(r.full_name || '').toLowerCase()));
  return repos.filter((r) => !set.has(r.full_name.toLowerCase())).map((r) => r.full_name);
}

function main() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--out') out = argv[++i];
    else fail('unknown argument: ' + argv[i]);
  }

  const repos = listRepos();
  const snapshot = {
    captured_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    capture_method: CAPTURE_METHOD,
    repos,
  };

  let previousAt = null;
  try { previousAt = JSON.parse(fs.readFileSync(out, 'utf8')).captured_at || null; } catch (e) { /* first run */ }

  const news = previewDiscoveries(repos);
  const report = {
    out: path.relative(BASE, out).replace(/\\/g, '/'),
    dry_run: dryRun,
    previous_captured_at: previousAt,
    captured_at: snapshot.captured_at,
    repositories: repos.length,
    would_surface_as_new_discovery: news === null ? 'registry unreadable' : news,
  };

  if (!dryRun) fs.writeFileSync(out, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();
module.exports = { listRepos, previewDiscoveries, CAPTURE_METHOD, DEFAULT_OUT };
