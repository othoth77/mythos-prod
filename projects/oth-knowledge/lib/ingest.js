// =====================================================
// OTH Knowledge — ingestion pipeline
// projects/oth-knowledge/lib/ingest.js
//
// source system → source collection → original artifact (preserved) →
// normalized document → chunks. Every step provenance-stamped. Dedup by
// content address. Credential-shaped content is refused fail-closed and
// only the refusal (never the content) is recorded.
// =====================================================
'use strict';

const ids = require('./ids.js');
const provenance = require('./provenance.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// Credential-shape gate. Matches are refused; only the pattern NAME is
// ever recorded or logged — never the matching text.
const SECRET_PATTERNS = Object.freeze([
  { name: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/ },
  { name: 'github-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'password-assignment', re: /\b(password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/i },
  { name: 'authorization-bearer', re: /\bAuthorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/i },
]);

function detectSecretShapes(text) {
  const hits = [];
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push(p.name);
  return hits;
}

// Ensures the source record for (class, collection) exists; idempotent.
function ensureSource(store, classes, sourceClass, sourceCollection) {
  const cls = provenance.requireClass(classes, sourceClass);
  const collection = sourceCollection || 'default';
  const id = ids.recordId('source', cls.name + '/' + collection);
  const existing = store.getRecord(id);
  if (existing) return existing;
  const rec = {
    kind: 'source', id,
    source_class: cls.name,
    title: cls.title + ' — ' + collection,
    metadata: { collection, policy: cls.policy },
  };
  store.appendRecord(rec);
  return rec;
}

// Ingests one original artifact. Input:
//   { bytes, filename, source_class, source_collection, source_reference?,
//     captured_at, observed_at?, confidence?, actor?, metadata?, tags? }
// Returns { source, artifact, document, chunks, deduplicated }.
// Typed failures: OTHK_INGEST_*, OTHK_NORMALIZE_*, OTHK_SOURCE_*.
function ingestArtifact(store, classes, input, normalizeLib) {
  const normalize = normalizeLib || require('./normalize.js');
  if (!input || !Buffer.isBuffer(input.bytes)) throw fail('OTHK_INGEST_INPUT', 'bytes Buffer required');
  if (typeof input.filename !== 'string' || !input.filename) throw fail('OTHK_INGEST_INPUT', 'filename required');
  if (typeof input.captured_at !== 'string') throw fail('OTHK_INGEST_INPUT', 'captured_at required');

  const cls = provenance.requireClass(classes, input.source_class);
  const source = ensureSource(store, classes, cls.name, input.source_collection);

  // Normalize first: policy + secret gates must see the text BEFORE any
  // byte or record is persisted (fail-closed — nothing stored on refusal).
  const norm = normalize.normalize(input.bytes, input.filename);

  if (cls.policy === 'metadata-only') {
    throw fail('OTHK_INGEST_POLICY', 'source class ' + cls.name + ' is metadata-only; content ingestion refused (register pointers via addRecord instead)');
  }

  const secretHits = detectSecretShapes(norm.text);
  if (secretHits.length) {
    // Record the refusal — pattern names only, never content.
    const obsId = ids.recordId('observation', 'secret-refusal/' + ids.contentRef(input.bytes));
    if (!store.getRecord(obsId)) {
      store.appendRecord({
        kind: 'observation', id: obsId,
        statement: 'Ingestion refused: credential-shaped content detected (' + secretHits.join(', ') + '). Content not stored.',
        observed_at: input.captured_at,
        provenance: provenance.buildProvenance(classes, {
          source_class: cls.name, source_collection: source.metadata.collection,
          source_reference: 'refused:' + input.filename, captured_at: input.captured_at,
        }),
        tags: ['quarantine', 'secret-refusal'],
      });
    }
    throw fail('OTHK_INGEST_SECRET', 'credential-shaped content refused: ' + secretHits.join(', '));
  }

  // Original artifact: content-addressed, byte-identical, deduplicated.
  const put = store.putObject(input.bytes);
  const artifactId = ids.recordId('artifact', put.ref);
  const already = store.getRecord(artifactId);
  const prov = provenance.buildProvenance(classes, {
    source_class: cls.name,
    source_collection: source.metadata.collection,
    source_reference: input.source_reference || (cls.name + '/' + source.metadata.collection + '/' + input.filename),
    captured_at: input.captured_at,
    observed_at: input.observed_at,
    confidence: input.confidence,
    actor: input.actor,
    artifact_ref: put.ref,
  });

  if (already) {
    // Same bytes re-presented: idempotent replay, no new records.
    const docId = ids.recordId('document', artifactId);
    return {
      source, artifact: already, document: store.getRecord(docId),
      chunks: store.allRecords({ kind: 'chunk', where: (r) => r.document_id === docId }),
      deduplicated: true,
    };
  }

  const artifact = {
    kind: 'artifact', id: artifactId,
    content_ref: put.ref, filename: input.filename, byte_size: input.bytes.length,
    provenance: prov,
    metadata: input.metadata || {},
    tags: input.tags || [],
  };
  store.appendRecord(artifact);

  const docId = ids.recordId('document', artifactId);
  const document = {
    kind: 'document', id: docId,
    artifact_id: artifactId, text: norm.text, media_type: norm.media_type,
    provenance: prov,
  };
  store.appendRecord(document);

  const chunkTexts = normalize.chunkText(norm.text);
  const chunks = chunkTexts.map((text, position) => {
    const chunk = {
      kind: 'chunk', id: ids.recordId('chunk', docId + '#' + position),
      document_id: docId, text, position, provenance: prov,
    };
    store.appendRecord(chunk);
    return chunk;
  });

  return { source, artifact, document, chunks, deduplicated: false };
}

module.exports = { SECRET_PATTERNS, detectSecretShapes, ensureSource, ingestArtifact };
