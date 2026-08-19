#!/usr/bin/env node
// =====================================================
// OTH Knowledge — retrieval evaluation runner
// projects/oth-knowledge/eval/run-eval.js
//
// Builds a fresh corpus from the committed fixtures + infrastructure
// seed in a throwaway store, then measures Recall@k and MRR for
// lexical, vector and hybrid modes against eval/retrieval-eval.json.
// Search quality is claimed only from these measured numbers.
//
// Usage: node run-eval.js [--json]
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const api = require('../lib/api.js');
const seedLib = require('../lib/seed.js');

const BASE = path.join(__dirname, '..');

function buildCorpus(root) {
  const kb = api.open(root);
  const fixtures = [
    ['manual', 'manual', 'deploy-notes.md'],
    ['google-takeout', 'takeout-fixture', 'activity.json'],
    ['gemini', 'gemini-fixture', 'conversation-notes.md'],
    ['notebooklm', 'notebooklm-fixture', 'research-notes.txt'],
    ['mythos-repo', 'repo-fixture', 'storage-pipeline.md'],
  ];
  for (const [cls, collection, file] of fixtures) {
    const dir = { manual: 'manual', 'google-takeout': 'google-takeout', gemini: 'gemini', notebooklm: 'notebooklm', 'mythos-repo': 'mythos-repo' }[cls];
    kb.ingestArtifact({
      bytes: fs.readFileSync(path.join(BASE, 'fixtures', dir, file)),
      filename: file, source_class: cls, source_collection: collection,
      captured_at: '2026-08-19T00:00:00Z',
    });
  }
  seedLib.loadSeed(kb.store, kb.classes, path.join(BASE, 'seeds', 'infrastructure-2026-08-19.json'));
  return kb;
}

function matches(hitRecText, hit, expect) {
  if (expect.kind && hit.kind !== expect.kind) return false;
  return hitRecText.toLowerCase().indexOf(expect.contains.toLowerCase()) !== -1;
}

function evaluate(kb, evalSet) {
  const modes = ['lexical', 'vector', 'hybrid'];
  const k = evalSet.k || 5;
  const results = {};
  for (const mode of modes) {
    let hitsAtK = 0, rrSum = 0;
    const misses = [];
    for (const q of evalSet.queries) {
      const hits = kb.search(q.q, { mode, limit: k });
      let rank = 0;
      for (let i = 0; i < hits.length; i++) {
        const full = kb.store.getRecord(hits[i].id);
        const text = full ? (full.text || full.statement || full.title || '') : '';
        if (matches(text, hits[i], q.expect)) { rank = i + 1; break; }
      }
      if (rank) { hitsAtK++; rrSum += 1 / rank; } else misses.push(q.q);
    }
    results[mode] = {
      queries: evalSet.queries.length,
      recall_at_k: +(hitsAtK / evalSet.queries.length).toFixed(3),
      mrr: +(rrSum / evalSet.queries.length).toFixed(3),
      k,
      misses,
    };
  }
  return results;
}

function main() {
  const evalSet = JSON.parse(fs.readFileSync(path.join(__dirname, 'retrieval-eval.json'), 'utf8'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'othk-eval-'));
  try {
    const kb = buildCorpus(root);
    const verify = kb.verify();
    const results = evaluate(kb, evalSet);
    const report = { corpus: kb.stats(), integrity_ok: verify.ok, embedder: 'hashed-ngram-pseudo-semantic (offline default)', results };
    if (process.argv.indexOf('--json') !== -1) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('OTH Knowledge retrieval evaluation (' + evalSet.queries.length + ' queries, k=' + (evalSet.k || 5) + ')');
      console.log('corpus records: ' + report.corpus.records + ' · integrity: ' + (verify.ok ? 'OK' : 'FAIL'));
      for (const mode of Object.keys(results)) {
        const r = results[mode];
        console.log('  ' + mode.padEnd(8) + ' recall@' + r.k + '=' + r.recall_at_k + '  mrr=' + r.mrr + (r.misses.length ? '  misses: ' + r.misses.join(' | ') : ''));
      }
    }
    return report;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) main();
module.exports = { buildCorpus, evaluate, main };
