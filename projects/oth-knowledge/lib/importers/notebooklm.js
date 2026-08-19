// =====================================================
// OTH Knowledge — NotebookLM importer
// projects/oth-knowledge/lib/importers/notebooklm.js
//
// Imports manually exported NotebookLM notes (markdown/plain text; one
// file per notebook or note) under source class `notebooklm`. NotebookLM
// output is model-assisted, so extracted statements enter as CLAIMS
// asserted by 'notebooklm', never as facts; the note text itself is the
// document. Sources listed in a "Sources:" section are preserved as
// claim metadata for provenance.
// =====================================================
'use strict';

const ingest = require('../ingest.js');
const extract = require('../extract.js');

const PARSER_VERSION = 'notebooklm/1.0.0';
const SOURCE_CLASS = 'notebooklm';
const MAX_CLAIMS_PER_NOTE = 200;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// Parses the light structure of an exported note:
//   # <notebook/note title>
//   Sources: <comma-separated source names>        (optional line)
//   - Key point: <statement>                        (repeatable)
//   ...free text...
function parseNote(text) {
  const lines = text.split('\n');
  let title = null;
  const sources = [];
  const keyPoints = [];
  for (const line of lines) {
    const t = line.trim();
    if (!title && /^#\s+/.test(t)) { title = t.replace(/^#\s+/, '').slice(0, 400); continue; }
    const src = t.match(/^Sources?:\s*(.+)$/i);
    if (src) { src[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => sources.push(s.slice(0, 200))); continue; }
    const kp = t.match(/^[-*]\s*Key point:\s*(.+)$/i);
    if (kp && keyPoints.length < MAX_CLAIMS_PER_NOTE) keyPoints.push(kp[1].slice(0, 2000));
  }
  return { title: title || null, sources, keyPoints };
}

// importNote(store, classes, { bytes, filename, captured_at, observed_at?, collection? })
function importNote(store, classes, input) {
  if (!input || !Buffer.isBuffer(input.bytes)) throw fail('OTHK_IMPORT_INPUT', 'bytes required');
  if (!input.captured_at) throw fail('OTHK_IMPORT_INPUT', 'captured_at required');
  const collection = input.collection || 'notebooklm-export';

  const sourceRef = SOURCE_CLASS + '/' + collection + '/' + (input.filename || 'note.md');
  const res = ingest.ingestArtifact(store, classes, {
    bytes: input.bytes,
    filename: input.filename || 'note.md',
    source_class: SOURCE_CLASS,
    source_collection: collection,
    source_reference: sourceRef,
    captured_at: input.captured_at,
    observed_at: input.observed_at,
    parser_version: PARSER_VERSION,
    importer: PARSER_VERSION,
    metadata: { assertion_class: 'OBSERVED' },
  });

  const parsed = parseNote(res.document.text);
  const report = { artifact: res.artifact.id, deduplicated: res.deduplicated, title: parsed.title, claims: 0 };

  for (const statement of parsed.keyPoints) {
    // Model-assisted output → CLAIM asserted by notebooklm, never a fact.
    const claim = extract.addClaim(store, classes, {
      statement,
      asserted_by: 'notebooklm' + (parsed.title ? ':' + parsed.title : ''),
      prov: {
        source_class: SOURCE_CLASS, source_collection: collection,
        source_reference: sourceRef + '#key-point',
        captured_at: input.captured_at, observed_at: input.observed_at,
        artifact_ref: res.artifact.content_ref,
      },
      tags: ['EXTRACTED', 'model-assisted'],
    });
    extract.addEvidence(store, {
      supports_id: claim.id,
      evidence_ids: [res.document.id],
      note: 'extracted from NotebookLM note' + (parsed.sources.length ? '; note cites: ' + parsed.sources.join(', ').slice(0, 500) : ''),
    });
    report.claims++;
  }
  return report;
}

module.exports = { PARSER_VERSION, SOURCE_CLASS, parseNote, importNote };
