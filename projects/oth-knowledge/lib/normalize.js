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
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ');
}

// JSON artifacts (e.g. Takeout-shaped exports) flatten to searchable text
// while preserving structure in metadata.
function flattenJson(value, prefix, out) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out.push((prefix ? prefix + ': ' : '') + String(value));
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => flattenJson(v, prefix + '[' + i + ']', out));
  } else if (typeof value === 'object') {
    for (const k of Object.keys(value)) flattenJson(value[k], prefix ? prefix + '.' + k : k, out);
  }
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

module.exports = { MEDIA_TYPES, mediaTypeFor, decodeUtf8Strict, stripHtml, normalize, chunkText };
