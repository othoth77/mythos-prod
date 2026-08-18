#!/usr/bin/env node
// =====================================================
// Mythos — Project Memory Ingestion Tool
// scripts/memory-ingest.js
//
// Backfills existing human-readable project records into the
// provider-independent project memory store (core/memory.js), closing the
// "human-readable, not yet structured for machine retrieval" gap recorded
// for Project Memory's precursors (docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md §3 F).
//
// Deterministic and idempotent: rerunning skips days already ingested for
// the given project. Writes only to the project memory store (never Git,
// never /tmp for its target data) via core/memory.js.
//
// Commands:
//   node scripts/memory-ingest.js daily-history [project]
//     — ingest docs/history/DAILY_HISTORY.md as execution_history entries.
//       project defaults to "mythos-os".
// =====================================================
'use strict';

var fs = require('fs');
var path = require('path');

var BASE = path.join(__dirname, '..');
var memory = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'core', 'memory'));

function cmdDailyHistory() {
  var project = process.argv[3] || 'mythos-os';
  var file = path.join(BASE, 'docs', 'history', 'DAILY_HISTORY.md');
  if (!fs.existsSync(file)) {
    console.error('Missing docs/history/DAILY_HISTORY.md');
    process.exit(1);
  }
  var text = fs.readFileSync(file, 'utf8');
  var result = memory.ingestDailyHistory(project, text);

  console.log('Mythos Project Memory — daily-history ingest (project: ' + project + ')');
  console.log('  Ingested: ' + result.ingested.length + (result.ingested.length ? ' (' + result.ingested.join(', ') + ')' : ''));
  console.log('  Already present (skipped): ' + result.skipped.length);
  if (result.errors.length) {
    console.log('  Errors: ' + result.errors.length);
    result.errors.forEach(function (e) { console.log('    - ' + e.date + ': ' + e.error); });
    process.exit(1);
  }
  process.exit(0);
}

var command = process.argv[2];
switch (command) {
  case 'daily-history': cmdDailyHistory(); break;
  default:
    console.log('Usage: node scripts/memory-ingest.js <daily-history> [project]');
    console.log('Backfills human-readable project records into structured project memory (core/memory.js).');
    process.exit(command ? 1 : 0);
}
