// =====================================================
// Mythos Personal Intelligence — MPI-3 Stage R3 Context Runtime
// projects/personal-intelligence/persistence/context-runtime.js
//
// Composition, not redesign: wires the UNCHANGED reference context-assembler
// to the real §10 retrieval adapter (persistence/retrieval.js), replacing
// only the injected in-memory memoryStore array the assembler has always
// consumed (the §19.4 SEAM-3 pattern, previously fed by loadMemoryStore).
//
//   user request -> §10 retrieval (permission filtering in WHERE, BEFORE
//   ranking; O-R1(b) tombstone refusal; deterministic bounded order)
//   -> mapped memoryStore records -> assembler.retrieveRelevantMemory
//   (its existing scope gate + capability filter + recency ranking,
//   UNCHANGED) -> relevant memories / assembled context.
//
// Ranking is the assembler's existing documented strategy (most-recent
// first). No new ranking algorithm is introduced. Node's stable Array.sort
// preserves the adapter's deterministic order on timestamp ties, so the
// composed pipeline is deterministic end to end.
//
// intent/entities: accepted and ECHOED in diagnostics only. The assembler's
// defined relevance input is `task` ({capabilityId}, MYTHOS_CONTEXT_
// ARCHITECTURE §3), which callers may pass explicitly; nothing here invents
// an intent->ranking mapping the contracts do not define. Note the schema
// carries no capability linkage on memory rows, so a task filter admits
// rows without relatedCapabilities — the assembler's existing behaviour,
// preserved as-is.
//
// D3: records carry contentReference only; nothing here hydrates content.
// Explicit hydration remains retrieval.hydrateContent.
//
// READ-ONLY by construction: this module issues no SQL of its own — every
// database access goes through the R1 adapter's SELECTs.
// =====================================================
'use strict';

const retrieval = require('./retrieval');
const assembler = require('../reference/context-assembler');

// mapRow(row) — the SEAM-3 field mapping (loadMemoryStore's, extended with
// the R1 adapter's provenance/tags/reference payload). Pure.
function mapRow(r) {
  const firstProv = (r.provenance && r.provenance[0]) || null;
  return {
    memoryRecordId: r.memory_record_id,
    userId: r.user_id,
    organisationId: r.organisation_id,
    domainId: r.domain_id,
    sessionId: r.session_id,
    scope: r.scope,
    memoryType: r.memory_type,
    contentSummary: r.content_summary,
    state: r.state,
    evidenceCount: r.evidence_count,
    lastObservedAt: r.observed_at || r.updated_at,
    createdAt: r.created_at,
    contentReference: r.content_reference || null,
    tags: r.tags || [],
    provenance: {
      reference: (firstProv && firstProv.source_reference) || r.memory_record_id,
      provider: firstProv && firstProv.provider,
      sourceType: firstProv && firstProv.source_type,
      confidence: firstProv && firstProv.confidence
    },
    provenanceRecords: r.provenance || []
  };
}

// retrieveRelevantMemory(client, q, opts) -> { items, conflicts, diagnostics }
//   q    — the §10 query (validated and executed by the R1 adapter: scope,
//          permissions REQUIRED, bounded limit REQUIRED, includeStates with
//          tombstoned REFUSED, minConfidence, timeRange, tags, domain,
//          projectRef, requireProvenance).
//   opts — { task, sessionId }: the assembler's own contract inputs.
async function retrieveRelevantMemory(client, q, opts) {
  const o = opts || {};
  const r = await retrieval.retrieveMemory(client, q);
  const memoryStore = r.items.map(mapRow);
  const items = assembler.retrieveRelevantMemory({
    userId: q.userId,
    organisationId: q.organisationId,
    domainId: q.domainId,
    sessionId: o.sessionId,
    task: o.task,
    memoryStore: memoryStore,
    limit: q.limit
  });
  return {
    items: items,
    conflicts: r.conflicts,
    diagnostics: {
      retrieval: r.diagnostics,
      assembler: {
        candidates: memoryStore.length,
        ranked: items.length,
        task: (o.task && o.task.capabilityId) || null,
        intentEcho: q.intent !== undefined ? q.intent : null,
        entitiesEcho: q.entities !== undefined ? q.entities : null,
        ranking: 'assembler recency (stable sort; adapter deterministic order preserved on ties)'
      }
    }
  };
}

// assembleContext(client, q, input) — full AssemblyResult composition: loads
// memory through the same path and hands the assembler's UNCHANGED assemble()
// the mapped key/value records alongside the caller's other sources. The
// assembler's classification rules apply exactly as written (a memory row is
// admitted as REQUIRED/USEFUL only relative to input.task, per its contract).
async function assembleContext(client, q, input) {
  const r = await retrieval.retrieveMemory(client, q);
  const memory = r.items.map(function (row) {
    const m = mapRow(row);
    return {
      key: m.memoryRecordId,
      value: m.contentSummary,
      permissionScope: m.scope,
      requiredForCapability: undefined,
      relatedCapabilities: undefined,
      contentReference: m.contentReference,
      provenance: { reference: m.provenance.reference }
    };
  });
  const result = assembler.assemble(Object.assign({}, input || {}, {
    memory: memory,
    permissions: q.permissions
  }));
  return {
    assembly: result,
    conflicts: r.conflicts,
    diagnostics: { retrieval: r.diagnostics, memoryCandidates: memory.length }
  };
}

module.exports = {
  retrieveRelevantMemory: retrieveRelevantMemory,
  assembleContext: assembleContext,
  mapRow: mapRow
};
