'use strict';
// =====================================================
// Mythos Orchestration Core — artifact manager (capability AA)
// projects/mythos-ai-executor/core/artifact-manager.js
//
// Tracked storage for non-Git outputs (images, reports, datasets, builds)
// with provenance. Today artifacts either go into Git or into
// product-specific storage; this gives them one durable, content-addressed
// home outside both.
//
// domain.js already defines the 'artifact' entity (task_id, kind, path,
// digest) and store.js already persists it under orchestration/artifacts/
// — nothing previously called createArtifact. This module is what
// actually writes the bytes and wires them to that existing record:
//
//   orchestration/artifact-blobs/<aa>/<bb>/<sha256>   content, once per digest
//   orchestration/artifacts/<id>.json                 provenance record (store.js)
//
// Content-addressing gives free deduplication and tamper evidence: retrieve()
// refuses to hand back bytes whose digest no longer matches the record.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var domain = require('./domain');
var entityStore = require('./store');

function blobsRoot() {
  return path.join(
    process.env.MYTHOS_EXECUTOR_HOME || path.join(os.homedir(), 'mythos-ai-executor'),
    'orchestration', 'artifact-blobs'
  );
}

function digestOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function blobPath(digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('INVALID_DIGEST: ' + String(digest).slice(0, 80));
  var full = path.join(blobsRoot(), digest.slice(0, 2), digest.slice(2, 4), digest);
  if (path.dirname(path.resolve(full)) !== path.resolve(path.join(blobsRoot(), digest.slice(0, 2), digest.slice(2, 4)))) {
    throw new Error('PATH_ESCAPE: resolved blob path left its directory');
  }
  return full;
}

// Stores content as a tracked artifact and returns its provenance record.
// Identical bytes (same digest) are written to disk only once; a fresh
// provenance record is still created per call so the same content can be
// traced back to multiple producing tasks.
function storeArtifact(content, opts) {
  opts = opts || {};
  var buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  var digest = digestOf(buf);
  var full = blobPath(digest);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
    var tmp = full + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, full);
  }
  var entity = domain.createArtifact({
    task_id: opts.task_id || null,
    kind: opts.kind,
    path: full,
    digest: digest,
    project: opts.project || null,
    parent_id: opts.mission_id || null,
    correlation_id: opts.correlation_id || null,
    metadata: Object.assign({
      filename: opts.filename || null,
      mime_type: opts.mime_type || null,
      size_bytes: buf.length,
      produced_by: opts.produced_by || null
    }, opts.metadata || {})
  });
  entityStore.create(entity);
  entityStore.appendEventLine({
    event_type: 'ARTIFACT_STORED',
    subject_id: entity.id,
    correlation_id: entity.correlation_id,
    project: entity.project,
    detail: { kind: entity.kind, digest: digest, size_bytes: buf.length, task_id: entity.task_id }
  });
  return entity;
}

// Returns the provenance record only (no disk read) — the metadata half of
// an artifact lookup, for callers that don't need the bytes.
function get(id) {
  return entityStore.load('artifact', id);
}

// Reads an artifact's content back, verifying the blob on disk still
// matches its recorded digest. Provenance is worthless without integrity.
function retrieve(id) {
  var entity = get(id);
  if (!entity) return null;
  if (!fs.existsSync(entity.path)) {
    throw new Error('ARTIFACT_BLOB_MISSING: ' + id);
  }
  var buf = fs.readFileSync(entity.path);
  var actual = digestOf(buf);
  if (actual !== entity.digest) {
    throw new Error('ARTIFACT_DIGEST_MISMATCH: ' + id + ' expected ' + entity.digest + ' got ' + actual);
  }
  entityStore.appendEventLine({
    event_type: 'ARTIFACT_RETRIEVED',
    subject_id: id,
    correlation_id: entity.correlation_id,
    project: entity.project,
    detail: { kind: entity.kind, digest: entity.digest }
  });
  return { entity: entity, content: buf };
}

function list(filter) {
  return entityStore.list('artifact', filter);
}

function listByTask(taskId) {
  return list(function (a) { return a.task_id === taskId; });
}

function listByKind(kind) {
  return list(function (a) { return a.kind === kind; });
}

module.exports = {
  blobsRoot: blobsRoot,
  digestOf: digestOf,
  blobPath: blobPath,
  store: storeArtifact,
  get: get,
  retrieve: retrieve,
  list: list,
  listByTask: listByTask,
  listByKind: listByKind
};
