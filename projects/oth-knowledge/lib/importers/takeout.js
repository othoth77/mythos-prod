// =====================================================
// OTH Knowledge — Google Takeout importer
// projects/oth-knowledge/lib/importers/takeout.js
//
// Imports an EXTRACTED Google Takeout directory (the operator unzips the
// archive; no zip dependency in the zero-dep layer). Every file becomes
// an artifact under source class `google-takeout`, one collection per
// export directory; My Activity JSON files additionally yield EXTRACTED
// event records, one per activity entry, with truth time = the entry's
// own timestamp (never the ingestion time).
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ingest = require('../ingest.js');
const extract = require('../extract.js');
const model = require('../model.js');

const PARSER_VERSION = 'takeout/1.0.0';
const SOURCE_CLASS = 'google-takeout';
const SUPPORTED = ['.json', '.html', '.txt', '.csv', '.md'];
const MAX_EVENTS_PER_FILE = 5000;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function walk(dir, out) {
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue; // refuse symlink traversal
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function looksLikeActivity(parsed) {
  return Array.isArray(parsed) && parsed.length > 0 && parsed.every(
    (e) => e && typeof e === 'object' && typeof e.title === 'string'
  ) && parsed.some((e) => typeof e.time === 'string');
}

// importDirectory(store, classes, dir, { captured_at, collection? })
function importDirectory(store, classes, dir, opts) {
  const o = opts || {};
  if (!o.captured_at) throw fail('OTHK_IMPORT_INPUT', 'captured_at required');
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw fail('OTHK_IMPORT_INPUT', 'not a directory: ' + root);
  }
  const collection = o.collection || ('takeout-' + path.basename(root));
  const report = { imported: 0, deduplicated: 0, skipped: [], events: 0, files: 0 };

  for (const file of walk(root, [])) {
    report.files++;
    const rel = path.relative(root, file);
    if (rel.split(path.sep).some((seg) => seg === '..')) continue; // containment
    const ext = path.extname(file).toLowerCase();
    if (SUPPORTED.indexOf(ext) === -1) {
      report.skipped.push({ file: rel, reason: 'unsupported type ' + ext });
      continue;
    }
    const bytes = fs.readFileSync(file);
    let res;
    try {
      res = ingest.ingestArtifact(store, classes, {
        bytes,
        filename: path.basename(file),
        source_class: SOURCE_CLASS,
        source_collection: collection,
        source_reference: SOURCE_CLASS + '/' + collection + '/' + rel.split(path.sep).join('/'),
        captured_at: o.captured_at,
        parser_version: PARSER_VERSION,
        importer: PARSER_VERSION,
        metadata: { relative_path: rel.split(path.sep).join('/'), assertion_class: 'OBSERVED' },
      });
    } catch (e) {
      report.skipped.push({ file: rel, reason: String(e.code || e.message).slice(0, 120) });
      continue;
    }
    if (res.deduplicated) report.deduplicated++; else report.imported++;

    // Activity extraction: entries carry their own truth timestamps.
    if (ext === '.json') {
      let parsed = null;
      try { parsed = JSON.parse(bytes.toString('utf8')); } catch (e) { parsed = null; }
      if (parsed && looksLikeActivity(parsed)) {
        let n = 0;
        for (const entry of parsed) {
          if (n >= MAX_EVENTS_PER_FILE) break;
          if (typeof entry.time !== 'string' || !model.isIsoTimestamp(entry.time)) continue;
          extract.addEvent(store, classes, {
            title: String(entry.title).slice(0, 500),
            occurred_at: entry.time,
            prov: {
              source_class: SOURCE_CLASS, source_collection: collection,
              source_reference: res.artifact.provenance.source_reference + '#entry-' + n,
              captured_at: o.captured_at, observed_at: entry.time,
              artifact_ref: res.artifact.content_ref,
            },
            tags: ['EXTRACTED', 'activity'],
            metadata: {
              assertion_class: 'EXTRACTED', parser_version: PARSER_VERSION,
              activity_header: typeof entry.header === 'string' ? entry.header.slice(0, 100) : null,
            },
          });
          n++; report.events++;
        }
      }
    }
  }
  return report;
}

module.exports = { PARSER_VERSION, SOURCE_CLASS, importDirectory, looksLikeActivity };
