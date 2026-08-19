// =====================================================
// Mythos Personal Intelligence — D3 Content Store
// projects/personal-intelligence/persistence/content-store.js
//
// Implements ratified decision D3 (owner, 2026-08-14): memory content lives
// in OBJECT STORAGE; PostgreSQL stores `content_reference` only, never
// embedded content (MPI-0; control-plane-schema.sql header; D3 in
// docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §12.1).
//
// Reference scheme — deterministic, content-addressed:
//   content_reference = 'mpi-content://sha256/<64-hex-lowercase>'
//   object key        = 'content/sha256/<64-hex-lowercase>'
// The reference is derived from the bytes alone, so identical content yields
// the identical reference (deduplication is a property of the scheme, not a
// lookup table), and every reference is verifiable end-to-end: the hash in
// the name must equal the hash of the bytes. Fits VARCHAR(256) by
// construction (78 characters).
//
// Destination (D5): the DEDICATED MPI R2 bucket only. Content objects live
// under the 'content/' prefix; MPI database backups live under
// 'mythos-intelligence/'. The two prefixes share the bucket deliberately —
// D5 ratified one dedicated MPI destination — and never collide.
// `mythos-offhost-backups` is exclusively idauto/coolify/darhijama and is
// refused here by name.
//
// Backup pairing (MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §11.2) — the MPI
// backup unit is the PAIR:
//   (a) the schema dump of `mythos_intelligence` (pg_dump -Fc, per MPI-2G), and
//   (b) the content objects under 'content/sha256/'.
// Consistency rule: content objects are WRITE-ONCE and IMMUTABLE (a key is
// its content's hash), and a content object must be durably stored — put()
// resolved, head-verified — BEFORE any row referencing it is committed.
// Under that ordering, any database dump taken at time T references only
// objects already durable at T, so (dump, content-prefix) restored together
// are consistent: the store is always a superset of the dump's references.
// verifyConsistency() below is the check for exactly that invariant, and is
// the restore-validation step for the pair.
//
// Deletion: NOT provided. The ratified lifecycle reverses by tombstone and
// import_batch_ref, never by row deletion (§20.7), and the erasure policy
// (F14) is explicitly future, separately-governed work. Until F14 is
// ratified, no MPI code path deletes a content object — mirroring the
// report-only retention stance of offhost-backup.js. Provider-side deletion
// remains an explicitly authorised maintenance operation outside this module.
//
// STATUS: scratch implementation. Not wired into any application; no real
// MPI content exists; nothing here is invoked in production.
// =====================================================
'use strict';

const crypto = require('crypto');

const REFERENCE_PREFIX = 'mpi-content://sha256/';
const KEY_PREFIX = 'content/sha256/';
const EXPECTED_BUCKET = 'mythos-mpi-backups';
const FORBIDDEN_BUCKET = 'mythos-offhost-backups';

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// contentReferenceFor(bytes) — the deterministic reference for these exact
// bytes. Pure; requires no store.
function contentReferenceFor(bytes) {
  return REFERENCE_PREFIX + sha256Hex(bytes);
}

// parseContentReference(ref) -> { sha256 } | throws.
// Accepts only the exact ratified scheme; anything else is refused so a
// malformed value can never silently address the wrong object.
function parseContentReference(ref) {
  if (typeof ref !== 'string' || ref.indexOf(REFERENCE_PREFIX) !== 0) {
    throw new Error('invalid content reference scheme');
  }
  const hex = ref.slice(REFERENCE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error('invalid content reference digest');
  }
  return { sha256: hex };
}

function keyFor(sha256) {
  return KEY_PREFIX + sha256;
}

// createContentStore({ adapter }) — adapter is the provider-neutral object
// store contract already established by
// projects/infrastructure/ops/adapters/s3-compatible.js: put(key, bytes, {sha256}),
// get(key) -> bytes, head(key) -> {size, sha256} (throws 'missing object'
// when absent). Injection keeps this module offline-testable and
// provider-neutral, exactly like offhost-backup.js.
function createContentStore(opts) {
  if (!opts || !opts.adapter) throw new Error('content store requires an adapter');
  const adapter = opts.adapter;

  async function headByHash(sha256) {
    try {
      const h = await adapter.head(keyFor(sha256));
      return h || null;
    } catch (e) {
      if (e && /missing object/.test(e.message)) return null;
      throw e;
    }
  }

  return {
    // putContent(bytes) -> { contentReference, sha256, size, deduplicated }
    // Write-once: identical bytes hit the identical key. An existing object
    // with matching integrity metadata is the successful outcome
    // (deduplicated: true) — it is never overwritten, never re-uploaded.
    // The put is HEAD-verified before the reference is returned, which is
    // what makes the write-content-before-row ordering rule assertable.
    putContent: async function (bytes) {
      const buf = Buffer.from(bytes);
      const sha256 = sha256Hex(buf);
      const existing = await headByHash(sha256);
      if (existing) {
        if (existing.sha256 !== sha256 || existing.size !== buf.length) {
          throw new Error('content store integrity failure on existing object');
        }
        return { contentReference: REFERENCE_PREFIX + sha256, sha256: sha256, size: buf.length, deduplicated: true };
      }
      await adapter.put(keyFor(sha256), buf, { sha256: sha256 });
      const verified = await headByHash(sha256);
      if (!verified || verified.sha256 !== sha256 || verified.size !== buf.length) {
        throw new Error('content store write verification failure');
      }
      return { contentReference: REFERENCE_PREFIX + sha256, sha256: sha256, size: buf.length, deduplicated: false };
    },

    // getContent(ref) -> Buffer. The returned bytes are re-hashed and must
    // equal the digest in the reference — an object that does not hash to
    // its own name is corruption, surfaced, never returned.
    getContent: async function (ref) {
      const parsed = parseContentReference(ref);
      const bytes = Buffer.from(await adapter.get(keyFor(parsed.sha256)));
      if (sha256Hex(bytes) !== parsed.sha256) {
        throw new Error('content integrity failure');
      }
      return bytes;
    },

    // headContent(ref) -> { exists, size, sha256 }. Existence plus integrity
    // metadata; never fetches the body.
    headContent: async function (ref) {
      const parsed = parseContentReference(ref);
      const h = await headByHash(parsed.sha256);
      if (!h) return { exists: false, size: null, sha256: null };
      if (h.sha256 !== parsed.sha256) {
        throw new Error('content integrity failure');
      }
      return { exists: true, size: h.size, sha256: h.sha256 };
    }
    // No delete — see header. Erasure is F14, future and separately governed.
  };
}

// verifyConsistency(client, store) — the database/object-store boundary
// check that makes the §11.2 backup pair verifiable. Discovers every
// `content_reference` column in `mythos_intelligence` from the catalog
// (schema-driven — no hardcoded table list to fall out of date), collects
// all non-null references, and requires each to parse and to exist in the
// store. Read-only on both sides.
// -> { ok, columns, checked, missing: [ref], malformed: [ref] }
async function verifyConsistency(client, store) {
  const cols = (await client.query(
    "SELECT table_name FROM information_schema.columns " +
    "WHERE table_schema = 'mythos_intelligence' AND column_name = 'content_reference' " +
    "ORDER BY table_name", [])).rows;
  const result = { ok: true, columns: cols.length, checked: 0, missing: [], malformed: [] };
  for (let i = 0; i < cols.length; i++) {
    const table = cols[i].table_name;
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('unexpected table name in catalog');
    const rows = (await client.query(
      'SELECT DISTINCT content_reference AS ref FROM mythos_intelligence.' + table +
      ' WHERE content_reference IS NOT NULL', [])).rows;
    for (let j = 0; j < rows.length; j++) {
      const ref = rows[j].ref;
      result.checked++;
      let parsed;
      try {
        parsed = parseContentReference(ref);
      } catch (e) {
        result.malformed.push(ref);
        result.ok = false;
        continue;
      }
      const h = await store.headContent(REFERENCE_PREFIX + parsed.sha256);
      if (!h.exists) {
        result.missing.push(ref);
        result.ok = false;
      }
    }
  }
  return result;
}

// createFromConfig(loadedConfig, s3Module) — composition helper binding the
// store to the D5 dedicated MPI destination. Takes an ALREADY-LOADED config
// (the caller owns file location and loading, exactly as MPI-2G composition
// did) plus the s3-compatible module, and refuses any bucket that is not the
// dedicated MPI bucket. The forbidden production-backup bucket is refused by
// name even if expectations are overridden.
function createFromConfig(loadedConfig, s3Module, opts) {
  const expected = (opts && opts.expectedBucket) || EXPECTED_BUCKET;
  if (!loadedConfig || !loadedConfig.BUCKET) throw new Error('content store config missing BUCKET');
  if (loadedConfig.BUCKET === FORBIDDEN_BUCKET) throw new Error('content store refuses the production backup bucket');
  if (loadedConfig.BUCKET !== expected) throw new Error('content store refuses unexpected bucket');
  return createContentStore({ adapter: s3Module.create(loadedConfig) });
}

module.exports = {
  createContentStore: createContentStore,
  createFromConfig: createFromConfig,
  verifyConsistency: verifyConsistency,
  contentReferenceFor: contentReferenceFor,
  parseContentReference: parseContentReference,
  REFERENCE_PREFIX: REFERENCE_PREFIX,
  KEY_PREFIX: KEY_PREFIX,
  EXPECTED_BUCKET: EXPECTED_BUCKET,
  FORBIDDEN_BUCKET: FORBIDDEN_BUCKET
};
