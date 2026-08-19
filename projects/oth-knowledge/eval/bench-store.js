#!/usr/bin/env node
// =====================================================
// OTH Knowledge — store benchmark
// projects/oth-knowledge/eval/bench-store.js
//
// Evidence generator for the Phase-12 database decision. Generates N
// synthetic chunk records (deterministic content), then measures:
// append throughput, reopen (log replay) time, index build time,
// lexical/hybrid query latency, log size on disk, and process RSS.
//
// Usage: node bench-store.js [N]   (default 5000)
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const storeLib = require('../lib/store.js');
const searchLib = require('../lib/search.js');
const ids = require('../lib/ids.js');

const WORDS = ('storage retrieval provenance conflict entity fact claim event knowledge layer deployment backup restore index query latency benchmark synthetic record version chunk artifact source class temporal filter hybrid lexical vector evidence audit').split(' ');

function synthText(i) {
  const out = [];
  for (let j = 0; j < 40; j++) out.push(WORDS[(i * 7 + j * 13) % WORDS.length] + ((i + j) % 97));
  return 'synthetic bench record ' + i + ': ' + out.join(' ');
}

function main() {
  const N = Number(process.argv[2]) || 5000;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'othk-bench-'));
  const prov = { source_class: 'manual', source_collection: 'bench', source_reference: 'manual/bench/gen', captured_at: '2026-08-19T00:00:00Z' };
  const report = { records: N };
  try {
    let s = storeLib.openStore(root);
    s.appendRecord({ kind: 'source', id: ids.recordId('source', 'manual/bench'), source_class: 'manual', title: 'bench', metadata: { collection: 'bench', policy: 'content' } });

    let t = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      s.appendRecord({ kind: 'chunk', id: ids.recordId('chunk', 'bench#' + i), document_id: 'document-bench', text: synthText(i), position: i, provenance: prov });
    }
    report.append_ms = Number(process.hrtime.bigint() - t) / 1e6;
    report.append_per_sec = Math.round(N / (report.append_ms / 1000));

    t = process.hrtime.bigint();
    s = storeLib.openStore(root); // full log replay
    report.reopen_ms = Number(process.hrtime.bigint() - t) / 1e6;

    t = process.hrtime.bigint();
    const index = searchLib.buildIndex(s);
    report.index_build_ms = Number(process.hrtime.bigint() - t) / 1e6;

    const queries = Array.from({ length: 20 }, (_, i) => 'retrieval provenance ' + WORDS[i] + (i * 31 % 97));
    for (const mode of ['lexical', 'hybrid']) {
      t = process.hrtime.bigint();
      for (const q of queries) searchLib.search(index, q, { mode, limit: 10 });
      report[mode + '_avg_query_ms'] = +(Number(process.hrtime.bigint() - t) / 1e6 / queries.length).toFixed(2);
    }

    report.log_bytes = fs.statSync(path.join(root, 'records.jsonl')).size;
    report.rss_mb = +(process.memoryUsage().rss / 1048576).toFixed(1);
    console.log(JSON.stringify(report, null, 2));
    return report;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) main();
module.exports = { main };
