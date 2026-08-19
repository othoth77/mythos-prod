// =====================================================
// OTH Knowledge — Gemini conversation importer
// projects/oth-knowledge/lib/importers/gemini.js
//
// Imports a Gemini conversation export (JSON: {conversations:[{id,title,
// create_time,update_time,messages:[{author,text,create_time}]}]}) under
// source class `gemini`. The original JSON is preserved as the artifact;
// each conversation yields one EXTRACTED event with truth time =
// create_time. Message texts stay in the artifact/document; extraction
// never invents content and never promotes model output to fact — any
// assistant statement worth keeping enters as a CLAIM asserted by
// 'gemini', not as a fact.
// =====================================================
'use strict';

const ingest = require('../ingest.js');
const extract = require('../extract.js');
const model = require('../model.js');

const PARSER_VERSION = 'gemini/1.0.0';
const SOURCE_CLASS = 'gemini';
const MAX_CONVERSATIONS = 10000;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function parseExport(bytes) {
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch (e) { throw fail('OTHK_IMPORT_FORMAT', 'gemini export is not valid JSON'); }
  if (!parsed || !Array.isArray(parsed.conversations)) {
    throw fail('OTHK_IMPORT_FORMAT', 'gemini export missing conversations[]');
  }
  return parsed;
}

// importExport(store, classes, { bytes, filename, captured_at, collection? })
function importExport(store, classes, input) {
  if (!input || !Buffer.isBuffer(input.bytes)) throw fail('OTHK_IMPORT_INPUT', 'bytes required');
  if (!input.captured_at) throw fail('OTHK_IMPORT_INPUT', 'captured_at required');
  const parsed = parseExport(input.bytes); // validate BEFORE storing anything
  const collection = input.collection || 'gemini-export';

  const res = ingest.ingestArtifact(store, classes, {
    bytes: input.bytes,
    filename: input.filename || 'gemini-export.json',
    source_class: SOURCE_CLASS,
    source_collection: collection,
    source_reference: SOURCE_CLASS + '/' + collection + '/' + (input.filename || 'gemini-export.json'),
    captured_at: input.captured_at,
    parser_version: PARSER_VERSION,
    importer: PARSER_VERSION,
    metadata: { assertion_class: 'OBSERVED', conversation_count: parsed.conversations.length },
  });

  const report = { artifact: res.artifact.id, deduplicated: res.deduplicated, conversations: 0, events: 0, skipped: [] };
  let n = 0;
  for (const conv of parsed.conversations) {
    if (n >= MAX_CONVERSATIONS) break;
    n++;
    if (!conv || typeof conv !== 'object') { report.skipped.push({ index: n - 1, reason: 'not an object' }); continue; }
    const when = typeof conv.create_time === 'string' && model.isIsoTimestamp(conv.create_time) ? conv.create_time : null;
    if (!when) { report.skipped.push({ index: n - 1, reason: 'missing/invalid create_time' }); continue; }
    const title = typeof conv.title === 'string' && conv.title.trim() ? conv.title.slice(0, 400) : 'Gemini conversation ' + (conv.id || n);
    extract.addEvent(store, classes, {
      title: 'Gemini conversation: ' + title,
      occurred_at: when,
      prov: {
        source_class: SOURCE_CLASS, source_collection: collection,
        source_reference: res.artifact.provenance.source_reference + '#conversation-' + (conv.id || n),
        captured_at: input.captured_at, observed_at: when,
        artifact_ref: res.artifact.content_ref,
      },
      tags: ['EXTRACTED', 'conversation'],
      metadata: {
        assertion_class: 'EXTRACTED', parser_version: PARSER_VERSION,
        message_count: Array.isArray(conv.messages) ? conv.messages.length : 0,
        conversation_id: typeof conv.id === 'string' ? conv.id.slice(0, 100) : null,
      },
    });
    report.conversations++; report.events++;
  }
  return report;
}

module.exports = { PARSER_VERSION, SOURCE_CLASS, parseExport, importExport };
