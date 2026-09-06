// =====================================================
// OTH Knowledge — file-backed knowledge store
// projects/oth-knowledge/lib/store.js
//
// Append-only JSONL record log + content-addressed object store.
// No database, no network. Corrections are new versions; deletion is a
// tombstone version; nothing is ever rewritten in place.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const ids = require('./ids.js');
const model = require('./model.js');

const FORMAT_VERSION = 1;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function objectPath(root, hash) {
  return path.join(root, 'objects', 'sha256', hash.slice(0, 2), hash);
}

class Store {
  constructor(root) {
    this.root = root;
    this.logPath = path.join(root, 'records.jsonl');
    this.metaPath = path.join(root, 'meta.json');
    // In-memory index: id → array of stored envelopes (version order).
    this._byId = new Map();
    this._seq = 0;
  }

  // fs.existsSync() is accessSync(F_OK) with every error swallowed: it
  // returns false for EACCES/EPERM exactly as it does for ENOENT. Treating
  // those alike would take the "absent store" branch on a permission error
  // and hand back an EMPTY store that verify() then reports as healthy —
  // a silent zero indistinguishable from a genuinely empty store. That is
  // how an unreadable run store once dry-ran as `would_add: 0` instead of
  // failing. Absence is legitimate (a fresh root initialises empty);
  // inaccessibility never is, so it fails closed with a typed error.
  //
  // Probing the log path alone is sufficient and is deliberately narrow: an
  // unreadable root, an unreadable parent, and an unreadable records.jsonl
  // all surface here as EACCES, while both real absences (no root, or a
  // provisioned root with no log yet) surface as ENOENT and are allowed
  // through unchanged. A root that is traversable but not listable (0711)
  // is therefore never falsely refused.
  _assertLogReadable() {
    try {
      fs.accessSync(this.logPath, fs.constants.R_OK);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw fail('OTHK_STORE_UNREADABLE',
          this.logPath + ' exists but is not readable (' + e.code + '); '
          + 'refusing to present an unreadable store as an empty one');
      }
    }
  }

  _load() {
    this._assertLogReadable();
    if (!fs.existsSync(this.logPath)) return;
    const lines = fs.readFileSync(this.logPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      let env;
      try { env = JSON.parse(line); } catch (e) {
        throw fail('OTHK_STORE_CORRUPT', 'unparseable record log line ' + (i + 1));
      }
      this._indexEnvelope(env);
    }
  }

  _indexEnvelope(env) {
    if (!env || typeof env.seq !== 'number' || !env.record || typeof env.record.id !== 'string') {
      throw fail('OTHK_STORE_CORRUPT', 'malformed envelope in record log');
    }
    if (env.seq > this._seq) this._seq = env.seq;
    const list = this._byId.get(env.record.id) || [];
    list.push(env);
    this._byId.set(env.record.id, list);
  }

  // ---- objects -------------------------------------------------------
  putObject(bytes) {
    if (!Buffer.isBuffer(bytes)) throw fail('OTHK_STORE_INPUT', 'putObject requires a Buffer');
    const ref = ids.contentRef(bytes);
    const p = objectPath(this.root, ids.hashFromRef(ref));
    if (fs.existsSync(p)) return { ref, deduplicated: true };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, p);
    return { ref, deduplicated: false };
  }

  hasObject(ref) { return fs.existsSync(objectPath(this.root, ids.hashFromRef(ref))); }

  getObject(ref) {
    const p = objectPath(this.root, ids.hashFromRef(ref));
    if (!fs.existsSync(p)) throw fail('OTHK_STORE_MISSING_OBJECT', ref);
    const bytes = fs.readFileSync(p);
    if (ids.contentRef(bytes) !== ref) throw fail('OTHK_STORE_CORRUPT', 'object bytes do not match reference ' + ref);
    return bytes;
  }

  // ---- records -------------------------------------------------------
  // Appends a validated record. If the id already exists the append is a
  // new version superseding the previous one (identical payloads are
  // idempotent no-ops). Returns the stored envelope.
  appendRecord(record, opts) {
    model.validateRecord(record);
    const existing = this._byId.get(record.id) || [];
    const prev = existing.length ? existing[existing.length - 1] : null;
    if (prev && !(opts && opts.allowNewVersion)) {
      if (JSON.stringify(prev.record) === JSON.stringify(record) && !prev.deleted) {
        return { envelope: prev, created: false, deduplicated: true };
      }
      throw fail('OTHK_STORE_VERSION', record.id + ' exists; pass allowNewVersion to supersede (never silently overwrite)');
    }
    const env = {
      seq: ++this._seq,
      version: prev ? prev.version + 1 : 1,
      supersedes: prev ? prev.seq : null,
      deleted: false,
      written_at: new Date().toISOString(),
      record,
    };
    this._appendLine(env);
    return { envelope: env, created: true, deduplicated: false };
  }

  // Tombstone: marks a record id deleted without destroying history.
  tombstone(id, reason) {
    const list = this._byId.get(id);
    if (!list || !list.length) throw fail('OTHK_STORE_MISSING', id);
    const prev = list[list.length - 1];
    const env = {
      seq: ++this._seq,
      version: prev.version + 1,
      supersedes: prev.seq,
      deleted: true,
      reason: typeof reason === 'string' ? reason.slice(0, 500) : 'tombstoned',
      written_at: new Date().toISOString(),
      record: prev.record,
    };
    this._appendLine(env);
    return env;
  }

  _appendLine(env) {
    fs.mkdirSync(this.root, { recursive: true });
    fs.appendFileSync(this.logPath, JSON.stringify(env) + '\n');
    if (!fs.existsSync(this.metaPath)) {
      fs.writeFileSync(this.metaPath, JSON.stringify({ format: 'othk-store', format_version: FORMAT_VERSION }, null, 2) + '\n');
    }
    this._indexEnvelope(env);
  }

  getRecord(id) {
    const list = this._byId.get(id);
    if (!list || !list.length) return null;
    const env = list[list.length - 1];
    return env.deleted ? null : env.record;
  }

  getVersions(id) { return (this._byId.get(id) || []).slice(); }

  // Latest live records, optionally filtered by kind / predicate.
  allRecords(filter) {
    const out = [];
    for (const list of this._byId.values()) {
      const env = list[list.length - 1];
      if (env.deleted) continue;
      const rec = env.record;
      if (filter && filter.kind && rec.kind !== filter.kind) continue;
      if (filter && typeof filter.where === 'function' && !filter.where(rec, env)) continue;
      out.push(rec);
    }
    return out;
  }

  // ---- export --------------------------------------------------------
  // JSONL export of latest live records (or full history with history:true),
  // plus the manifest of referenced objects. Lossless re-import interchange.
  exportRecords(opts) {
    const o = opts || {};
    const lines = [];
    const objectRefs = new Set();
    for (const list of this._byId.values()) {
      const envs = o.history ? list : [list[list.length - 1]];
      for (const env of envs) {
        if (!o.history && env.deleted) continue;
        const rec = env.record;
        if (o.kind && rec.kind !== o.kind) continue;
        if (o.source_class && !(rec.provenance && rec.provenance.source_class === o.source_class) && rec.source_class !== o.source_class) continue;
        lines.push(JSON.stringify(env));
        if (rec.kind === 'artifact' && rec.content_ref) objectRefs.add(rec.content_ref);
      }
    }
    return { jsonl: lines.join('\n') + (lines.length ? '\n' : ''), objects: Array.from(objectRefs).sort(), count: lines.length };
  }

  importRecords(jsonl) {
    let imported = 0, skipped = 0;
    for (const line of String(jsonl).split('\n')) {
      if (!line.trim()) continue;
      const env = JSON.parse(line);
      const res = this.appendRecord(env.record, { allowNewVersion: true });
      if (res.created === false) skipped++; else imported++;
    }
    return { imported, skipped };
  }

  // ---- integrity -----------------------------------------------------
  // Verifies referential integrity and object consistency.
  verify() {
    const problems = [];
    const live = this.allRecords();
    const liveIds = new Set(live.map((r) => r.id));
    for (const rec of live) {
      try { model.validateRecord(rec); } catch (e) { problems.push({ id: rec.id, problem: 'invalid: ' + e.message }); }
      if (rec.kind === 'artifact') {
        if (!this.hasObject(rec.content_ref)) problems.push({ id: rec.id, problem: 'missing object ' + rec.content_ref });
        else {
          try { this.getObject(rec.content_ref); }
          catch (e) { problems.push({ id: rec.id, problem: 'object hash mismatch: ' + e.message }); }
        }
      }
      const refs = [];
      if (rec.kind === 'document') refs.push(rec.artifact_id);
      if (rec.kind === 'chunk') refs.push(rec.document_id);
      if (rec.kind === 'relationship') refs.push(rec.from_id, rec.to_id);
      if (rec.kind === 'evidence') refs.push(rec.supports_id, ...rec.evidence_ids);
      if (rec.kind === 'derived') refs.push(...rec.derived_from);
      for (const ref of refs) {
        if (!liveIds.has(ref)) problems.push({ id: rec.id, problem: 'orphan reference ' + ref });
      }
    }
    return { ok: problems.length === 0, problems, records: live.length };
  }

  stats() {
    const byKind = {};
    for (const rec of this.allRecords()) byKind[rec.kind] = (byKind[rec.kind] || 0) + 1;
    return { records: this.allRecords().length, byKind, seq: this._seq };
  }
}

// The knowledge store must never live in Git (AGENTS.md §3). The
// executor consumer enforces this on the read path; enforce it on the
// WRITER path too (F6) — this is the only component that puts bytes on
// disk. Refuse an in-repository root unless it is the sanctioned,
// git-ignored fixtures/tests directory (projects/oth-knowledge/data/).
// Symlinks are resolved (realpath) so a symlink pointing back into the
// repo cannot smuggle the store in lexically.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SANCTIONED_INREPO = path.resolve(__dirname, '..', 'data');

function containmentResolve(p) {
  // realpath the deepest existing ancestor so a not-yet-created store
  // whose parent is a symlink is still checked against its real target.
  let cur = path.resolve(p);
  const tail = [];
  // walk up to an existing path
  // (bounded by the filesystem root; cur shrinks each iteration)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(cur)) {
      let real;
      try { real = fs.realpathSync(cur); } catch (e) { real = cur; }
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    }
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(p); // reached fs root; nothing existed
    tail.push(path.basename(cur));
    cur = parent;
  }
}

function assertNotInRepo(resolved) {
  const real = containmentResolve(resolved);
  const inRepo = real === REPO_ROOT || real.indexOf(REPO_ROOT + path.sep) === 0;
  if (!inRepo) return;
  const sanctioned = real === SANCTIONED_INREPO || real.indexOf(SANCTIONED_INREPO + path.sep) === 0;
  if (!sanctioned) {
    throw fail('OTHK_STORE_INREPO', 'store root is inside the repository (' + real + ') — the knowledge store must never live in Git; use an out-of-repo path or the git-ignored projects/oth-knowledge/data/');
  }
}

function openStore(root) {
  if (typeof root !== 'string' || !root) throw fail('OTHK_STORE_INPUT', 'store root required');
  const resolved = path.resolve(root);
  assertNotInRepo(resolved);
  const store = new Store(resolved);
  store._load();
  return store;
}

module.exports = { openStore, Store, FORMAT_VERSION };
