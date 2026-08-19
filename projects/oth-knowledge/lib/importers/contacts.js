// =====================================================
// OTH Knowledge — Google Contacts importer (METADATA-ONLY)
// projects/oth-knowledge/lib/importers/contacts.js
//
// The `google-contacts` source class is metadata-only, fail-closed
// (deferential to the ecosystem's ratified third-party-PII stance).
// This importer therefore NEVER stores contact content: no names, no
// phone numbers, no emails, no addresses — not in records, not in logs,
// not in errors. It parses the export in memory and persists only:
//   - the file's content hash (opaque identity, content NOT stored)
//   - row/column counts and column NAMES (schema, not data)
//   - exact-duplicate row counts and cross-file overlap counts
// Content ingestion of this class stays refused until an explicit owner
// decision reverses the policy.
// =====================================================
'use strict';

const crypto = require('crypto');
const ingestLib = require('../ingest.js');
const normalize = require('../normalize.js');
const extract = require('../extract.js');

const PARSER_VERSION = 'contacts/1.0.0';
const SOURCE_CLASS = 'google-contacts';

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

// Header validation — the PII firewall. Column NAMES are the only file
// content this importer ever persists, so a first data row mistaken for
// a header would leak a contact. Fail closed: the header must look like
// a contacts-export schema and must NOT look like data.
const KNOWN_HEADER_TOKENS = /^(name|given name|additional name|family name|first name|middle name|last name|nickname|birthday|gender|notes|labels|organization.*|e-?mail.*|phone.*|address.*|website.*|relation.*|group membership|photo|.*prefix|.*suffix)$/i;
const EMAIL_SHAPE = /@/;
const PHONE_SHAPE = /^[+()\d][\d\s().\/-]{4,}$/;

function validateHeader(header) {
  const known = header.filter((h) => KNOWN_HEADER_TOKENS.test(String(h).trim()));
  if (known.length === 0) {
    throw fail('OTHK_IMPORT_FORMAT', 'contacts CSV header not recognized (no known contacts column names) — refusing so a data row can never be persisted as column names');
  }
  for (const cell of header) {
    const c = String(cell).trim();
    if (EMAIL_SHAPE.test(c) || PHONE_SHAPE.test(c)) {
      throw fail('OTHK_IMPORT_FORMAT', 'contacts CSV header contains a data-shaped cell — refusing (nothing persisted)');
    }
    if (c.length > 120) throw fail('OTHK_IMPORT_FORMAT', 'contacts CSV header cell exceeds 120 chars — refusing');
  }
}

// Parses in memory; returns aggregates + an in-memory row-hash set for
// cross-file overlap measurement. Row hashes are NEVER persisted.
function analyzeCsv(bytes) {
  if (bytes.length > ingestLib.MAX_ARTIFACT_BYTES) {
    throw fail('OTHK_INGEST_TOO_LARGE', bytes.length + ' bytes exceeds the ' + ingestLib.MAX_ARTIFACT_BYTES + '-byte limit');
  }
  const text = normalize.decodeUtf8Strict(bytes);
  const parsed = normalize.parseCsv(text);
  validateHeader(parsed.header);
  const rowHashes = new Set();
  let duplicateRows = 0;
  for (const row of parsed.rows) {
    const h = sha256(Buffer.from(row.join(''), 'utf8'));
    if (rowHashes.has(h)) duplicateRows++; else rowHashes.add(h);
  }
  const nonEmptyByColumn = parsed.header.map((name, i) => ({
    column: String(name).slice(0, 120),
    non_empty: parsed.rows.reduce((s, r) => s + (r[i] && r[i].trim() ? 1 : 0), 0),
  }));
  return {
    content_hash: sha256(bytes),
    rows: parsed.rows.length,
    columns: parsed.header.length,
    column_names: parsed.header.map((h) => String(h).slice(0, 120)),
    duplicate_rows: duplicateRows,
    non_empty_by_column: nonEmptyByColumn,
    _rowHashes: rowHashes, // in-memory only, caller must not persist
  };
}

// importMetadata(store, classes, { bytes, filename, captured_at,
//   observed_at?, collection?, compare_with? (a prior analyzeCsv result) })
function importMetadata(store, classes, input) {
  if (!input || !Buffer.isBuffer(input.bytes)) throw fail('OTHK_IMPORT_INPUT', 'bytes required');
  if (!input.captured_at) throw fail('OTHK_IMPORT_INPUT', 'captured_at required');
  const collection = input.collection || 'contacts-export';
  const a = analyzeCsv(input.bytes);
  const opaqueRef = SOURCE_CLASS + '/sha256/' + a.content_hash;

  ingestLib.ensureSource(store, classes, SOURCE_CLASS, collection);

  const prov = {
    source_class: SOURCE_CLASS, source_collection: collection,
    source_reference: opaqueRef, // hash identity; content deliberately NOT stored
    captured_at: input.captured_at, observed_at: input.observed_at,
  };
  const statement =
    'METADATA-ONLY contacts import: file "' + String(input.filename || 'contacts.csv').slice(0, 200) +
    '" — ' + a.rows + ' rows, ' + a.columns + ' columns, ' + a.duplicate_rows +
    ' exact-duplicate rows. Content hash sha256:' + a.content_hash +
    '. Contact content NOT stored (class policy metadata-only, fail-closed).' +
    (input.compare_with ? ' Overlap with ' + input.compare_with.content_hash.slice(0, 12) + '…: ' + overlapCount(a, input.compare_with) + ' identical rows.' : '');

  const obs = extract.addObservation(store, classes, {
    statement,
    observed_at: input.observed_at || input.captured_at,
    prov,
    tags: ['OBSERVED', 'metadata-only', 'contacts'],
    metadata: {
      assertion_class: 'OBSERVED', parser_version: PARSER_VERSION,
      normalizer_version: normalize.NORMALIZER_VERSION,
      content_hash: a.content_hash, rows: a.rows, columns: a.columns,
      duplicate_rows: a.duplicate_rows, column_names: a.column_names,
    },
  });

  return {
    observation: obs.id,
    content_hash: a.content_hash,
    rows: a.rows, columns: a.columns, duplicate_rows: a.duplicate_rows,
    overlap_with_compare: input.compare_with ? overlapCount(a, input.compare_with) : null,
    analysis: a,
  };
}

function overlapCount(a, b) {
  let n = 0;
  for (const h of a._rowHashes) if (b._rowHashes && b._rowHashes.has(h)) n++;
  return n;
}

module.exports = { PARSER_VERSION, SOURCE_CLASS, analyzeCsv, importMetadata, overlapCount };
