// =====================================================
// OTH Knowledge — normalization and parsing
// projects/oth-knowledge/lib/normalize.js
//
// Turns original artifact bytes into a normalized text document plus
// deterministic chunks. The original bytes are never modified; this
// module only derives. Unsupported or malformed input fails with typed
// errors so ingest can quarantine instead of silently dropping.
// =====================================================
'use strict';

const path = require('path');

// Bumped whenever normalization output can change for identical input.
const NORMALIZER_VERSION = '1.1.0';
// Parser-abuse guards.
const MAX_JSON_DEPTH = 64;
const MAX_CSV_FIELDS = 512;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

const MEDIA_TYPES = Object.freeze({
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.csv': 'text/csv',
});

function mediaTypeFor(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  return MEDIA_TYPES[ext] || null;
}

// Strict UTF-8 decode: replacement characters or NUL bytes are refused.
function decodeUtf8Strict(bytes) {
  if (!Buffer.isBuffer(bytes)) throw fail('OTHK_NORMALIZE_INPUT', 'bytes must be a Buffer');
  if (bytes.length === 0) throw fail('OTHK_NORMALIZE_EMPTY', 'empty artifact');
  if (bytes.includes(0)) throw fail('OTHK_NORMALIZE_ENCODING', 'NUL byte in text artifact');
  const text = bytes.toString('utf8');
  if (text.indexOf('�') !== -1) throw fail('OTHK_NORMALIZE_ENCODING', 'invalid UTF-8 sequence');
  return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function stripHtml(html) {
  // Body-bounded script/style patterns: the naive /<script[\s\S]*?<\/script>/
  // rescans to end-of-string from every "<script" when the tag is
  // unterminated, which is quadratic and a single-file DoS (F5). These
  // consume only up to the next "<", never past a missing close tag.
  return html
    .replace(/<script\b[^>]*>[^<]*(?:<(?!\/script>)[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[^<]*(?:<(?!\/style>)[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ');
}

// JSON artifacts (e.g. Takeout-shaped exports) flatten to searchable text
// while preserving structure in metadata.
function flattenJson(value, prefix, out, depth) {
  const d = depth || 0;
  if (d > MAX_JSON_DEPTH) throw fail('OTHK_NORMALIZE_MALFORMED', 'JSON nesting exceeds depth ' + MAX_JSON_DEPTH);
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push((prefix ? prefix + ': ' : '') + String(value));
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flattenJson(v, prefix + '[' + i + ']', out, d + 1));
  } else if (typeof value === 'object') {
    for (const k of Object.keys(value)) flattenJson(value[k], prefix ? prefix + '.' + k : k, out, d + 1);
  }
}

// Minimal RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF).
// Returns { header: string[], rows: string[][] }.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
    if (row.length > MAX_CSV_FIELDS) throw fail('OTHK_NORMALIZE_MALFORMED', 'CSV row exceeds ' + MAX_CSV_FIELDS + ' fields');
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (inQuotes) throw fail('OTHK_NORMALIZE_MALFORMED', 'CSV ends inside a quoted field');
  if (!rows.length) throw fail('OTHK_NORMALIZE_EMPTY', 'CSV has no rows');
  return { header: rows[0], rows: rows.slice(1) };
}

// Derives { text, media_type } from artifact bytes.
function normalize(bytes, filename) {
  const media = mediaTypeFor(filename);
  if (!media) throw fail('OTHK_NORMALIZE_UNSUPPORTED', 'unsupported file type: ' + path.extname(String(filename || '')));
  const raw = decodeUtf8Strict(bytes);
  let text;
  if (media === 'application/json') {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { throw fail('OTHK_NORMALIZE_MALFORMED', 'invalid JSON: ' + e.message); }
    const lines = [];
    flattenJson(parsed, '', lines);
    text = lines.join('\n');
  } else if (media === 'text/html') {
    text = stripHtml(raw);
  } else if (media === 'text/csv') {
    const parsed = parseCsv(raw);
    const lines = [];
    for (const row of parsed.rows) {
      lines.push(row.map((v, i) => (parsed.header[i] || 'col' + i) + ': ' + v).filter((s) => !/: $/.test(s)).join(' · '));
    }
    text = lines.join('\n');
  } else {
    text = raw;
  }
  text = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!text) throw fail('OTHK_NORMALIZE_EMPTY', 'artifact normalized to empty text');
  return { text, media_type: media };
}

// Deterministic chunking: paragraph-preserving packing to a target size.
function chunkText(text, opts) {
  const target = (opts && opts.target) || 1200;
  const max = (opts && opts.max) || 2000;
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  const push = () => { if (cur) { chunks.push(cur); cur = ''; } };
  for (let p of paragraphs) {
    while (p.length > max) { // hard-split oversized paragraphs deterministically
      push();
      chunks.push(p.slice(0, max));
      p = p.slice(max);
    }
    if (cur && cur.length + 2 + p.length > target) push();
    cur = cur ? cur + '\n\n' + p : p;
  }
  push();
  return chunks;
}

module.exports = {
  NORMALIZER_VERSION, MAX_JSON_DEPTH, MAX_CSV_FIELDS,
  MEDIA_TYPES, mediaTypeFor, decodeUtf8Strict, stripHtml, parseCsv, normalize, chunkText,
};
