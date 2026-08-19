// =====================================================
// OTH Knowledge — contradiction handling
// projects/oth-knowledge/lib/conflict.js
//
// Contradictory information never silently overwrites older
// information. Competing records stay live, linked by a conflicts_with
// relationship carrying an explicit resolution state.
// =====================================================
'use strict';

const ids = require('./ids.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

const STATEMENT_KINDS = ['fact', 'claim', 'observation'];

// Registers a conflict between two live statement records.
function registerConflict(store, idA, idB, note) {
  const a = store.getRecord(idA), b = store.getRecord(idB);
  if (!a || !b) throw fail('OTHK_CONFLICT_MISSING', 'both records must exist and be live');
  if (STATEMENT_KINDS.indexOf(a.kind) === -1 || STATEMENT_KINDS.indexOf(b.kind) === -1) {
    throw fail('OTHK_CONFLICT_KIND', 'conflicts are registered between fact/claim/observation records');
  }
  const pair = [idA, idB].sort();
  const rel = {
    kind: 'relationship',
    id: ids.recordId('relationship', 'conflicts_with/' + pair.join('~')),
    rel_type: 'conflicts_with',
    from_id: pair[0], to_id: pair[1],
    resolution_state: 'open',
    metadata: {
      note: typeof note === 'string' ? note.slice(0, 1000) : '',
      from_source_class: (a.provenance && a.provenance.source_class) || null,
      to_source_class: (b.provenance && b.provenance.source_class) || null,
      from_observed_at: a.observed_at || (a.provenance && a.provenance.observed_at) || null,
      to_observed_at: b.observed_at || (b.provenance && b.provenance.observed_at) || null,
      from_confidence: a.confidence || (a.provenance && a.provenance.confidence) || null,
      to_confidence: b.confidence || (b.provenance && b.provenance.confidence) || null,
    },
  };
  const existing = store.getRecord(rel.id);
  if (existing) return existing;
  store.appendRecord(rel);
  return rel;
}

// Explicit resolution: a NEW VERSION of the relationship records the
// decision; both statement records remain live and readable.
function resolveConflict(store, relId, resolution) {
  const rel = store.getRecord(relId);
  if (!rel || rel.rel_type !== 'conflicts_with') throw fail('OTHK_CONFLICT_MISSING', 'no live conflict ' + relId);
  const state = resolution && resolution.state;
  if (['resolved', 'superseded', 'coexisting'].indexOf(state) === -1) {
    throw fail('OTHK_CONFLICT_STATE', 'resolution state must be resolved/superseded/coexisting');
  }
  if (typeof resolution.decided_by !== 'string' || !resolution.decided_by) throw fail('OTHK_CONFLICT_STATE', 'decided_by required');
  const next = JSON.parse(JSON.stringify(rel));
  next.resolution_state = state;
  next.metadata = next.metadata || {};
  next.metadata.resolution = {
    state,
    decided_by: resolution.decided_by.slice(0, 200),
    decided_at: resolution.decided_at,
    winner_id: resolution.winner_id || null,
    rationale: typeof resolution.rationale === 'string' ? resolution.rationale.slice(0, 2000) : '',
  };
  store.appendRecord(next, { allowNewVersion: true });
  return next;
}

function listConflicts(store, filter) {
  return store.allRecords({
    kind: 'relationship',
    where: (r) => r.rel_type === 'conflicts_with' && (!filter || !filter.state || r.resolution_state === filter.state),
  });
}

module.exports = { registerConflict, resolveConflict, listConflicts, STATEMENT_KINDS };
