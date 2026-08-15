// =====================================================
// Mythos Personal Intelligence — MPI-2H Ingestion Boundary (closed portion)
// projects/personal-intelligence/persistence/ingestion.js
//
// Implements ONLY the parts of docs/MPI_2H_INGESTION_SPECIFICATION.md that
// are fully determined by ratified decisions (D1/D2/D3/D5, §3–§6, §11–§17,
// §22, §29–§30 of that spec). Everything depending on an OPEN owner decision
// (O-2H-1..6) is deliberately absent: no data source, no trigger, no
// scheduler, no retention, no encryption, no erasure design. This module is
// a guarded boundary with nothing wired to feed it.
//
// Composition (spec §29): the caller supplies a client (persistence/client),
// a D3 content store (persistence/content-store), and the ingestion flag
// value. This module never reads process.env itself, never loads config,
// never touches credentials.
//
// STATUS: scratch implementation. Not wired into any application. The real
// ingestion flag defaults OFF and REAL-class items additionally require
// per-batch operator gate assertions (spec §24), which no code path asserts.
// =====================================================
'use strict';

const { KIND } = require('./client');
const lifecycles = require('./lifecycles');
const contentStoreModule = require('./content-store');

// Spec §29: strict-flag discipline, identical to MPI_PERSISTENCE_ENABLED —
// only the exact string 'true' enables; default false; never coerced.
const REAL_INGESTION_FLAG = 'MPI_REAL_MEMORY_INGESTION_ENABLED';
function loadIngestionFlag(env) {
  return !!env && env[REAL_INGESTION_FLAG] === 'true';
}

// Spec's four data classes (spec preamble + §20.7 of the architecture).
// PROHIBITED_THIRD_PARTY is not a class value: such data has no admissible
// representation here at all — it is refused by validation, not classified.
const INGESTION_CLASSES = ['SYNTHETIC', 'OPERATOR_TEST', 'REAL'];

// Spec §3: the only provider that does not imply an external import, with its
// four allowed source types. External providers are importer territory
// (post-2H, §14 of the architecture); `contacts` is permanently excluded (D1).
const ALLOWED_PROVIDER = 'mythos';
const ALLOWED_SOURCE_TYPES = ['explicit_instruction', 'observation', 'feedback', 'note'];
const EXCLUDED_SOURCE_TYPE = 'contacts';

// Sensitive-shape rejection (spec §5, architecture §8.2): a credential-shaped
// value is rejected at capture, before normalization, and only the KIND is
// audited. The patterns are the repository's established precedents — the
// key=value shapes from offhost-backup.js redact() and the sensitive field
// names from reference/context-compiler.js — not a new detection policy.
const SENSITIVE_VALUE_PATTERNS = [
  /(access[_ -]?key|secret|token|signature|credential|password)(\s*[=:]\s*|%3[dD])[^\s&,]+/i,
  /AKIA[0-9A-Z]{16}/
];
function sensitiveShape(text) {
  if (typeof text !== 'string') return false;
  for (let i = 0; i < SENSITIVE_VALUE_PATTERNS.length; i++) {
    if (SENSITIVE_VALUE_PATTERNS[i].test(text)) return true;
  }
  return false;
}

function refusal(code) {
  // Refusal messages carry the rule violated, never the offending value —
  // the same value-free discipline as activation.js and the S3 adapter.
  const e = new Error(code);
  e.refused = true;
  return e;
}

// Structural whitelists (spec §4). Unknown fields are refused, which is also
// the structural half of D2: the contract has no field in which an MPI-owned
// person/organisation/project could be expressed.
const ITEM_FIELDS = ['class', 'memory', 'provenance', 'content', 'event'];
const MEMORY_FIELDS = ['memoryRecordId', 'userId', 'organisationId', 'domainId', 'memoryType',
  'scope', 'contentSummary', 'contentReference', 'isRedacted', 'sessionId', 'expiresAt',
  'observedAt', 'validFrom', 'validTo'];
const PROVENANCE_FIELDS = ['memoryProvenanceId', 'provider', 'sourceType', 'sourceReference',
  'importBatchRef', 'observedAt', 'confidence', 'actorRef', 'actorType'];

// Record-anchored events (O-EV-1a, spec §34). memoryRecordId is deliberately
// ABSENT from the whitelist: the anchor is derived from the item's own memory
// record inside one transaction, so a standalone real event is structurally
// impossible. The event_type whitelist is the ratified vocabulary, enforced
// here because the column carries no DB CHECK (§34).
const EVENT_FIELDS = ['memoryEventId', 'eventType', 'eventSummary', 'occurredAt',
  'projectRef', 'domainId', 'validFrom', 'validTo', 'content', 'contentReference'];
const EVENT_TYPES = ['DECISION', 'GOAL', 'ROUTINE', 'PROJECT_STATE', 'MILESTONE'];

function assertOnlyFields(obj, allowed, where) {
  const extra = Object.keys(obj).filter(function (k) { return allowed.indexOf(k) === -1; });
  if (extra.length) throw refusal('INGESTION_UNKNOWN_FIELD in ' + where + ': ' + extra.join(','));
}

// validateItem(item) — every closed rule of spec §3–§6, §11–§13. Throws a
// refusal; returns the normalized item on success. Pure (no I/O).
function validateItem(item) {
  if (!item || typeof item !== 'object') throw refusal('INGESTION_ITEM_REQUIRED');
  assertOnlyFields(item, ITEM_FIELDS, 'item');
  if (INGESTION_CLASSES.indexOf(item.class) === -1) throw refusal('INGESTION_CLASS_INVALID');
  if (!item.memory || typeof item.memory !== 'object') throw refusal('INGESTION_MEMORY_REQUIRED');
  if (!item.provenance || typeof item.provenance !== 'object') throw refusal('INGESTION_PROVENANCE_REQUIRED');
  assertOnlyFields(item.memory, MEMORY_FIELDS, 'memory');
  assertOnlyFields(item.provenance, PROVENANCE_FIELDS, 'provenance');

  const m = item.memory;
  const p = item.provenance;

  // Spec §4: content_summary is mandatory, short, non-sensitive.
  if (typeof m.contentSummary !== 'string' || !m.contentSummary.length) throw refusal('INGESTION_SUMMARY_REQUIRED');
  if (m.contentSummary.length > 512) throw refusal('INGESTION_SUMMARY_TOO_LONG');

  // Spec §3 / D1: provider and source-type boundary.
  if (p.provider !== ALLOWED_PROVIDER) throw refusal('INGESTION_PROVIDER_NOT_ALLOWED');
  if (p.sourceType === EXCLUDED_SOURCE_TYPE) throw refusal('INGESTION_CONTACTS_EXCLUDED_D1');
  if (ALLOWED_SOURCE_TYPES.indexOf(p.sourceType) === -1) throw refusal('INGESTION_SOURCE_TYPE_NOT_ALLOWED');

  // Spec §13: opaque source_reference is mandatory (F8 keys on it).
  // Spec §11/§14: import_batch_ref is mandatory — reversibility is not optional.
  if (typeof p.sourceReference !== 'string' || !p.sourceReference.length) throw refusal('INGESTION_SOURCE_REFERENCE_REQUIRED');
  if (typeof p.importBatchRef !== 'string' || !p.importBatchRef.length) throw refusal('INGESTION_BATCH_REF_REQUIRED');

  // D3 (spec §9): raw content and a pre-minted reference are mutually
  // exclusive; a supplied reference must parse under the ratified scheme.
  if (item.content !== undefined && m.contentReference !== undefined) {
    throw refusal('INGESTION_CONTENT_AND_REFERENCE_EXCLUSIVE');
  }
  if (m.contentReference !== undefined) {
    try {
      contentStoreModule.parseContentReference(m.contentReference);
    } catch (e) {
      throw refusal('INGESTION_CONTENT_REFERENCE_INVALID: ' + e.message);
    }
  }

  // Record-anchored event (§34): validated only as a pairing with THIS item's
  // memory record; there is no way to express an event without one.
  if (item.event !== undefined) {
    if (!item.event || typeof item.event !== 'object') throw refusal('INGESTION_EVENT_INVALID');
    assertOnlyFields(item.event, EVENT_FIELDS, 'event');
    const ev = item.event;
    if (typeof ev.memoryEventId !== 'string' || !ev.memoryEventId.length) throw refusal('INGESTION_EVENT_ID_REQUIRED');
    if (EVENT_TYPES.indexOf(ev.eventType) === -1) throw refusal('INGESTION_EVENT_TYPE_INVALID');
    if (typeof ev.eventSummary !== 'string' || !ev.eventSummary.length) throw refusal('INGESTION_EVENT_SUMMARY_REQUIRED');
    if (ev.eventSummary.length > 512) throw refusal('INGESTION_EVENT_SUMMARY_TOO_LONG');
    if (typeof ev.occurredAt !== 'string' || isNaN(Date.parse(ev.occurredAt))) throw refusal('INGESTION_EVENT_OCCURRED_AT_REQUIRED');
    if (ev.content !== undefined && ev.contentReference !== undefined) {
      throw refusal('INGESTION_EVENT_CONTENT_AND_REFERENCE_EXCLUSIVE');
    }
    if (ev.contentReference !== undefined) {
      try {
        contentStoreModule.parseContentReference(ev.contentReference);
      } catch (e) {
        throw refusal('INGESTION_EVENT_CONTENT_REFERENCE_INVALID: ' + e.message);
      }
    }
  }

  // Lifecycle-owned columns are not ingestion inputs (§4 of the spec:
  // allowed fields only; state/supersession/evidence are managed by
  // lifecycles.js, never asserted by a source).
  return item;
}

// classifySensitive(item) -> null | kind. Checked before any write (§8.2:
// rejected at capture, never persisted, only the kind recorded).
function classifySensitive(item) {
  if (sensitiveShape(item.memory.contentSummary)) return 'credential_shape_in_summary';
  if (sensitiveShape(item.provenance.sourceReference)) return 'credential_shape_in_source_reference';
  if (item.content !== undefined && sensitiveShape(Buffer.from(item.content).toString())) {
    return 'credential_shape_in_content';
  }
  if (item.event !== undefined) {
    if (sensitiveShape(item.event.eventSummary)) return 'credential_shape_in_event_summary';
    if (item.event.content !== undefined && sensitiveShape(Buffer.from(item.event.content).toString())) {
      return 'credential_shape_in_event_content';
    }
  }
  return null;
}

// createIngestion({ client, contentStore, flagEnabled }) — the guarded
// boundary. flagEnabled is the loaded REAL-ingestion flag (spec §29);
// SYNTHETIC and OPERATOR_TEST classes never require it, REAL always does.
function createIngestion(opts) {
  if (!opts || !opts.client) throw new Error('ingestion requires a client');
  if (!opts.contentStore) throw new Error('ingestion requires a content store');
  const client = opts.client;
  const contentStore = opts.contentStore;
  const flagEnabled = opts.flagEnabled === true;

  // ingestItem(item, gates) -> { ingested } | { alreadyIngested } | throws refusal.
  //   gates (REAL class only, spec §24): every assertion is per-batch,
  //   operator-made and must be truthful — exactly the migrate.js gate
  //   discipline. This module can verify their presence, never their truth.
  //     realDataAuthorised — the §24(5) explicit, scope-bound owner order exists
  //     backupVerified     — the §25 fresh verified backup exists (freshness
  //                          tolerance itself is O-2H-6; absent a decision the
  //                          only safe assertion is same-session)
  async function ingestItem(item, gates) {
    validateItem(item);

    if (item.class === 'REAL') {
      if (!flagEnabled) throw refusal('INGESTION_REAL_FLAG_DISABLED');
      if (!gates || gates.realDataAuthorised !== true) throw refusal('INGESTION_REAL_NOT_AUTHORISED');
      if (!gates || gates.backupVerified !== true) throw refusal('INGESTION_BACKUP_NOT_VERIFIED');
    }

    // §8.2: sensitive shapes are dropped before any persistence, with a
    // guard-decision audit row recording only the kind. The audit write is
    // standalone by design (§19.5 of the architecture) — it must survive
    // even though the item itself is refused.
    const sensitiveKind = classifySensitive(item);
    if (sensitiveKind) {
      await lifecycles.recordGuardDecision(client, {
        guardDecisionId: 'gd_' + item.provenance.importBatchRef + '_' + Date.now(),
        userId: item.memory.userId,
        organisationId: item.memory.organisationId,
        domainId: item.memory.domainId || null,
        capabilityId: 'memory.capture',
        automationLevelRequested: null,
        dataClassification: 'sensitive',
        decision: 'DENY'
      });
      throw refusal('INGESTION_SENSITIVE_REJECTED:' + sensitiveKind);
    }

    // D3 ordering rule (spec §9): content becomes durable — put resolved and
    // HEAD-verified inside putContent — BEFORE the referencing row commits.
    // Applies identically to memory content and event content.
    const memory = Object.assign({}, item.memory);
    if (item.content !== undefined) {
      const stored = await contentStore.putContent(item.content);
      memory.contentReference = stored.contentReference;
    }
    let event = null;
    if (item.event !== undefined) {
      event = Object.assign({}, item.event);
      if (event.content !== undefined) {
        const storedEv = await contentStore.putContent(event.content);
        event.contentReference = storedEv.contentReference;
        delete event.content;
      }
    }

    try {
      // §34: an item carrying an event writes memory + provenance + event in
      // ONE transaction via the record-anchored lifecycle; the anchor is the
      // item's own record. A UNIQUE rollback aborts all three together, so a
      // replay duplicates neither the record nor its event.
      const created = event
        ? await lifecycles.createMemoryWithProvenanceAndEvent(client, {
            memory: memory, provenance: item.provenance, event: event
          })
        : await lifecycles.createMemoryWithProvenance(client, {
            memory: memory, provenance: item.provenance
          });
      const out = { ingested: true, memory: created.memory, provenance: created.provenance };
      if (created.event) out.event = created.event;
      return out;
    } catch (e) {
      // F8 (spec §14/§15): a UNIQUE violation on the provenance triple is the
      // idempotent-replay signal — already ingested, not an error, and the
      // index is never to be weakened to avoid it.
      if (e && e.kind === KIND.UNIQUE) {
        return { alreadyIngested: true };
      }
      throw e;
    }
  }

  // reverseBatch(importBatchRef, input) — spec §17/§22 and architecture
  // §20.10 Data: a batch reverses by TOMBSTONE via import_batch_ref, never by
  // DELETE. Tombstones each still-active memory whose provenance carries the
  // batch ref, through the existing atomic tombstone lifecycle.
  async function reverseBatch(importBatchRef, input) {
    if (typeof importBatchRef !== 'string' || !importBatchRef.length) throw refusal('INGESTION_BATCH_REF_REQUIRED');
    if (!input || typeof input.deletionReason !== 'string' || !input.deletionReason.length) {
      throw refusal('INGESTION_REVERSAL_REASON_REQUIRED');
    }
    const rows = await client.withTransaction(async function (exec) {
      return (await exec.query(
        'SELECT DISTINCT p.memory_record_id AS id, m.user_id AS uid, m.organisation_id AS oid ' +
        'FROM pi_memory_provenance p JOIN pi_memory_records m ON m.memory_record_id = p.memory_record_id ' +
        "WHERE p.import_batch_ref = $1 AND m.state <> 'tombstoned'", [importBatchRef])).rows;
    });
    const tombstoned = [];
    for (let i = 0; i < rows.length; i++) {
      const r = await lifecycles.tombstoneMemory(client, {
        tombstone: {
          memoryTombstoneId: 'ts_' + importBatchRef + '_' + i,
          memoryRecordId: rows[i].id,
          userId: rows[i].uid,
          organisationId: rows[i].oid,
          deletionReason: input.deletionReason,
          requestedByRef: input.requestedByRef || null,
          importBatchRef: importBatchRef
        }
      });
      tombstoned.push(r.tombstone.memory_tombstone_id);
    }
    return { reversed: tombstoned.length, tombstones: tombstoned };
  }

  return { ingestItem: ingestItem, reverseBatch: reverseBatch };
}

module.exports = {
  loadIngestionFlag: loadIngestionFlag,
  createIngestion: createIngestion,
  validateItem: validateItem,
  classifySensitive: classifySensitive,
  sensitiveShape: sensitiveShape,
  REAL_INGESTION_FLAG: REAL_INGESTION_FLAG,
  INGESTION_CLASSES: INGESTION_CLASSES,
  ALLOWED_PROVIDER: ALLOWED_PROVIDER,
  ALLOWED_SOURCE_TYPES: ALLOWED_SOURCE_TYPES,
  EVENT_TYPES: EVENT_TYPES
};
