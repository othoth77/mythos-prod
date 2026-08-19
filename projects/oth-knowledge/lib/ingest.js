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

// Oversized-input guard: refuse pathological artifacts before parsing.
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

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
// (Canonical implementation lives in provenance.js; re-exported here for
// existing callers.)
const ensureSource = provenance.ensureSource;

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
  if (input.bytes.length > MAX_ARTIFACT_BYTES) {
    throw fail('OTHK_INGEST_TOO_LARGE', input.bytes.length + ' bytes exceeds the ' + MAX_ARTIFACT_BYTES + '-byte artifact limit');
  }

  const cls = provenance.requireClass(classes, input.source_class);
  const collection = (typeof input.source_collection === 'string' && input.source_collection) ? input.source_collection : 'default';

  // Refusal gates run BEFORE any store write (fail-closed — nothing is
  // persisted on refusal, not even the source envelope). Only after all
  // gates pass is the source record ensured (F8).
  if (cls.policy === 'metadata-only') {
    throw fail('OTHK_INGEST_POLICY', 'source class ' + cls.name + ' is metadata-only; content ingestion refused (register pointers via addRecord instead)');
  }

  // Secret gate on BOTH the normalized text AND the raw decoded bytes:
  // normalization strips <script>/<style>/comment bodies, so a gate on
  // the normalized text alone would let credential bytes reach the
  // preserved-original artifact (F1). The raw scan closes that hole.
  const norm = normalize.normalize(input.bytes, input.filename);
  const secretHits = Array.from(new Set(
    detectSecretShapes(norm.text).concat(detectSecretShapes(input.bytes.toString('utf8')))));
  if (secretHits.length) {
    // Now ensure the source (so the refusal record has a source), then
    // record the refusal — pattern names only, never content.
    const source0 = ensureSource(store, classes, cls.name, collection);
    const obsId = ids.recordId('observation', 'secret-refusal/' + ids.contentRef(input.bytes));
    if (!store.getRecord(obsId)) {
      store.appendRecord({
        kind: 'observation', id: obsId,
        statement: 'Ingestion refused: credential-shaped content detected (' + secretHits.join(', ') + '). Content not stored.',
        observed_at: input.captured_at,
        provenance: provenance.buildProvenance(classes, {
          source_class: cls.name, source_collection: source0.metadata.collection,
          source_reference: 'refused:' + input.filename, captured_at: input.captured_at,
        }),
        tags: ['quarantine', 'secret-refusal'],
      });
    }
    throw fail('OTHK_INGEST_SECRET', 'credential-shaped content refused: ' + secretHits.join(', '));
  }

  // All refusal gates passed — now it is safe to create the source record.
  const source = ensureSource(store, classes, cls.name, collection);

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
    // Same bytes re-presented. Identical (class, collection): pure
    // idempotent replay. DIFFERENT class/collection: the fact that this
    // source also contained these bytes must not vanish — record an
    // explicit also_present_in relationship (idempotent) linking the
    // existing artifact to the current source, carrying the current
    // import's own reference. The original attribution is never edited.
    const ap = already.provenance;
    if (ap && (ap.source_class !== prov.source_class || ap.source_collection !== prov.source_collection)) {
      const rel = {
        kind: 'relationship',
        id: ids.recordId('relationship', 'also_present_in/' + already.id + '/' + prov.source_class + '/' + prov.source_collection),
        rel_type: 'also_present_in',
        from_id: already.id, to_id: source.id,
        metadata: {
          source_reference: prov.source_reference,
          captured_at: prov.captured_at,
          filename: input.filename,
        },
      };
      if (!store.getRecord(rel.id)) store.appendRecord(rel);
    }
    const docId = ids.recordId('document', artifactId);
    return {
      source, artifact: already, document: store.getRecord(docId),
      chunks: store.allRecords({ kind: 'chunk', where: (r) => r.document_id === docId }),
      deduplicated: true,
    };
  }

  // Import lineage: which importer/parser produced this, and which
  // normalizer version derived the document — reproducibility anchors.
  const lineage = {
    parser_version: input.parser_version || 'ingest/1.0.0',
    normalizer_version: normalize.NORMALIZER_VERSION || '1.0.0',
    ingested_at: input.captured_at,
  };
  if (input.importer) lineage.importer = String(input.importer).slice(0, 100);

  const artifact = {
    kind: 'artifact', id: artifactId,
    content_ref: put.ref, filename: input.filename, byte_size: input.bytes.length,
    provenance: prov,
    metadata: Object.assign({}, input.metadata || {}, lineage),
    tags: input.tags || [],
  };
  store.appendRecord(artifact);

  const docId = ids.recordId('document', artifactId);
  const document = {
    kind: 'document', id: docId,
    artifact_id: artifactId, text: norm.text, media_type: norm.media_type,
    provenance: prov,
    metadata: lineage,
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

module.exports = { SECRET_PATTERNS, MAX_ARTIFACT_BYTES, detectSecretShapes, ensureSource, ingestArtifact };
