// =====================================================
// OTH Knowledge — existing-knowledge migration (Phase 3)
// projects/oth-knowledge/lib/migrate-source.js
//
// Turns existing curated knowledge (KMS decision/lesson/failure files,
// project docs, handovers) into gated candidates WITHOUT destroying the
// originals and without touching canonical truth directly:
//
//   markdown source → candidate (statement + preserved provenance) →
//   decide (dedupe/conflict) → promotion gate → staging → report
//
// Original provenance is preserved (source_class + repo-relative
// source_reference). Duplicates become NOOP (originals kept). It never
// writes canonical; the operator promotes staging → OTHKM afterwards.
// dryRun:true stages nothing and only reports what WOULD happen.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const propose = require('./propose.js');
const decisionLib = require('./extract-decision.js');
const gateLib = require('./promotion-gate.js');

// Extract candidate statements from one markdown file: the H1 title and any
// H2 headings (each a distilled decision/lesson). Bodies are NOT copied —
// memory holds distilled facts by pointer, never whole documents.
function candidatesFromMarkdown(text, o) {
  const out = [];
  const lines = String(text).split('\n');
  for (const line of lines) {
    const m1 = /^#\s+(.+?)\s*$/.exec(line);
    const m2 = /^##\s+(.+?)\s*$/.exec(line);
    const title = (m1 && m1[1]) || (m2 && m2[1]);
    if (title && title.length >= 4 && title.length <= 300) out.push(title.trim());
    if (out.length >= (o && o.maxPerFile || 20)) break;
  }
  return out;
}

function migrateMarkdown(stagingStore, canonicalStore, input, opts) {
  const o = opts || {};
  const files = (input && input.files) || [];
  const sourceClass = (input && input.source_class) || 'mythos-repo';
  const repoRoot = (input && input.repoRoot) || '';
  const capturedAt = (input && input.captured_at) || o.captured_at || new Date().toISOString();
  const namespace = input && input.namespace;
  const dryRun = !!(input && input.dryRun);

  const report = { files: [], totals: { candidates: 0, staged: 0, noop: 0, rejected: 0, would_add: 0 } };
  for (const file of files) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { report.files.push({ path: file, error: 'unreadable' }); continue; }
    const rel = repoRoot ? path.relative(repoRoot, file) : path.basename(file);
    const titles = candidatesFromMarkdown(text, o);
    const fileRep = { path: rel, candidates: titles.length, staged: 0, noop: 0, rejected: 0, would_add: 0 };
    for (let i = 0; i < titles.length; i++) {
      const cand = {
        kind: 'claim', statement: titles[i], asserted_by: 'repo:' + rel,
        provenance: { source_class: sourceClass, source_collection: 'migration', source_reference: rel + '#h' + i, captured_at: capturedAt },
        namespace, tags: ['migrated'],
      };
      if (dryRun) {
        const g = gateLib.gate(cand, { classes: o.classes, trustModel: o.trustModel });
        if (!g.ok) { fileRep.rejected++; continue; }
        const d = decisionLib.decide(canonicalStore, cand);
        if (d.action === 'NOOP') fileRep.noop++; else fileRep.would_add++;
      } else {
        const r = propose.proposeMemory(stagingStore, canonicalStore, cand, { classes: o.classes, trustModel: o.trustModel });
        if (r.staged) fileRep.staged++; else if (r.action === 'NOOP') fileRep.noop++; else fileRep.rejected++;
      }
    }
    report.files.push(fileRep);
    report.totals.candidates += fileRep.candidates;
    report.totals.staged += fileRep.staged; report.totals.noop += fileRep.noop;
    report.totals.rejected += fileRep.rejected; report.totals.would_add += fileRep.would_add;
  }
  report.dry_run = dryRun;
  return report;
}

module.exports = { migrateMarkdown, candidatesFromMarkdown };
