// =====================================================
// Mythos Personal Intelligence — §10 Retrieval Adapter (MPI-3 Stage R1)
// projects/personal-intelligence/persistence/retrieval.js
//
// Implements the ratified retrieval contract of
// docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §10 over the live schema, plus
// event/timeline retrieval, honouring:
//   - required scope (userId, organisationId) and REQUIRED bounded limit —
//     loadAllUserMemory() is a named anti-pattern and cannot be expressed here
//   - REQUIRED permissions object: filtering, not decoration — the scope
//     filter is applied in WHERE, strictly BEFORE ranking, so an excluded row
//     can never occupy a limit slot
//   - includeStates default ['active']; superseded/disputed only on explicit
//     request
//   - O-R1(b), owner 2026-08-15: tombstoned memories are INVISIBLE to
//     retrieval — includeStates containing 'tombstoned' is REFUSED, never
//     honoured, preserving F14-A suppression
//   - deterministic ordering: confidence rank -> observed_at DESC ->
//     scope precedence (policy §3: session, user, organisation, domain,
//     global — most specific first) -> stable opaque id
//   - requireProvenance default true; confidence rank and minConfidence come
//     from the provenance rows (confidence lives in provenance, §5)
//   - projectRef narrowing resolves through record-anchored events — the only
//     place project linkage exists in the ratified schema (O-EV-1a); no
//     schema change is introduced for it
//   - timeRange: observed_at within [from,to], or validity window overlap
//     (§9 semantics — a fact valid during the range is temporally relevant)
//   - conflicts returned ALONGSIDE items, never collapsed (§10)
//   - D3: rows carry content_reference only; hydrateContent() is the ONLY
//     content path and is explicit — retrieval never fetches content bodies
//
// Vector/semantic search is deliberately absent (§13: deferred, decided).
// STATUS: scratch implementation. Read-only by construction — every SQL
// statement in this module is a SELECT.
// =====================================================
'use strict';

const { createRepositories, assertState } = require('./repositories');
const { EVENT_TYPES } = require('./ingestion');

const CONFIDENCE_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, EXPLICIT: 4 };
// Policy §3 precedence order, most specific first.
const SCOPE_PRECEDENCE = ['session', 'user', 'organisation', 'domain', 'global'];

const CONFIDENCE_RANK_SQL =
  "(CASE p.confidence WHEN 'EXPLICIT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END)";
const SCOPE_RANK_SQL =
  "(CASE m.scope WHEN 'session' THEN 1 WHEN 'user' THEN 2 WHEN 'organisation' THEN 3 WHEN 'domain' THEN 4 WHEN 'global' THEN 5 ELSE 6 END)";

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

function validateCommon(q) {
  if (!q || typeof q !== 'object') throw refusal('RETRIEVAL_QUERY_REQUIRED');
  if (typeof q.userId !== 'string' || !q.userId.length) throw refusal('RETRIEVAL_USER_REQUIRED');
  if (typeof q.organisationId !== 'string' || !q.organisationId.length) throw refusal('RETRIEVAL_ORGANISATION_REQUIRED');
  if (typeof q.limit !== 'number' || !Number.isFinite(q.limit) || q.limit <= 0) {
    throw refusal('RETRIEVAL_LIMIT_REQUIRED');
  }
  if (q.timeRange !== undefined) {
    const t = q.timeRange;
    if (!t || typeof t !== 'object' ||
        (t.from !== undefined && isNaN(Date.parse(t.from))) ||
        (t.to !== undefined && isNaN(Date.parse(t.to)))) {
      throw refusal('RETRIEVAL_TIMERANGE_INVALID');
    }
  }
}

// retrieveMemory(client, q) -> { items, conflicts, diagnostics }  (§10)
async function retrieveMemory(client, q) {
  validateCommon(q);
  // §10: "permissions — REQUIRED — filtering, not decoration".
  if (!q.permissions || typeof q.permissions !== 'object' || Array.isArray(q.permissions)) {
    throw refusal('RETRIEVAL_PERMISSIONS_REQUIRED');
  }
  const states = q.includeStates || ['active'];
  states.forEach(assertState);
  // O-R1(b): tombstoned memory is invisible to retrieval — refused, not honoured.
  if (states.indexOf('tombstoned') !== -1) {
    throw refusal('RETRIEVAL_TOMBSTONED_INVISIBLE (F14-A / O-R1b: erased memory is invisible to retrieval)');
  }
  const requireProvenance = q.requireProvenance !== false; // §10 default true
  if (q.minConfidence !== undefined && !(q.minConfidence in CONFIDENCE_RANK)) {
    throw refusal('RETRIEVAL_MIN_CONFIDENCE_INVALID');
  }

  const params = [q.userId, q.organisationId, states];
  const where = ['m.user_id = $1', 'm.organisation_id = $2', 'm.state = ANY($3)'];
  function arg(v) { params.push(v); return '$' + params.length; }

  if (q.domainId !== undefined) where.push('m.domain_id = ' + arg(q.domainId));
  // Permission filtering BEFORE ranking: scope membership in WHERE.
  if (Array.isArray(q.permissions.allowedScopes)) {
    where.push('m.scope = ANY(' + arg(q.permissions.allowedScopes) + ')');
  }
  if (q.timeRange !== undefined) {
    const from = q.timeRange.from !== undefined ? arg(q.timeRange.from) : null;
    const to = q.timeRange.to !== undefined ? arg(q.timeRange.to) : null;
    const clauses = [];
    if (from && to) {
      clauses.push('(m.observed_at >= ' + from + ' AND m.observed_at <= ' + to + ')');
      clauses.push('(m.valid_from IS NOT NULL AND m.valid_from <= ' + to +
        ' AND (m.valid_to IS NULL OR m.valid_to >= ' + from + '))');
    } else if (from) {
      clauses.push('(m.observed_at >= ' + from + ')');
      clauses.push('(m.valid_to IS NULL AND m.valid_from IS NOT NULL)');
      clauses.push('(m.valid_to >= ' + from + ')');
    } else if (to) {
      clauses.push('(m.observed_at <= ' + to + ')');
      clauses.push('(m.valid_from IS NOT NULL AND m.valid_from <= ' + to + ')');
    }
    if (clauses.length) where.push('(' + clauses.join(' OR ') + ')');
  }
  if (Array.isArray(q.tags) && q.tags.length) {
    where.push('EXISTS (SELECT 1 FROM pi_memory_tags t WHERE t.memory_record_id = m.memory_record_id AND t.tag_key = ANY(' + arg(q.tags) + '))');
  }
  // projectRef narrows through record-anchored events (O-EV-1a): the only
  // ratified carrier of project linkage. No schema change.
  if (q.projectRef !== undefined) {
    where.push('EXISTS (SELECT 1 FROM pi_memory_events ev WHERE ev.memory_record_id = m.memory_record_id AND ev.project_ref = ' + arg(q.projectRef) + ')');
  }
  if (requireProvenance) where.push('pv.prov_count >= 1');
  if (q.minConfidence !== undefined) {
    where.push('pv.max_conf_rank >= ' + arg(CONFIDENCE_RANK[q.minConfidence]));
  }

  const sql =
    'SELECT m.*, COALESCE(pv.prov_count, 0) AS prov_count, pv.max_conf_rank ' +
    'FROM pi_memory_records m ' +
    'LEFT JOIN (SELECT p.memory_record_id, count(*) AS prov_count, max(' + CONFIDENCE_RANK_SQL + ') AS max_conf_rank ' +
    '           FROM pi_memory_provenance p GROUP BY p.memory_record_id) pv ' +
    '  ON pv.memory_record_id = m.memory_record_id ' +
    'WHERE ' + where.join(' AND ') + ' ' +
    'ORDER BY pv.max_conf_rank DESC NULLS LAST, m.observed_at DESC NULLS LAST, ' +
    SCOPE_RANK_SQL + ' ASC, m.memory_record_id ASC ' +
    'LIMIT ' + arg(q.limit);

  return client.withTransaction(async function (exec) {
    const repos = createRepositories(exec);
    const rows = (await exec.query(sql, params)).rows;
    const ids = rows.map(function (r) { return r.memory_record_id; });

    let provenance = [];
    let tags = [];
    let conflicts = [];
    if (ids.length) {
      provenance = await repos.provenance.listForMemories(ids);
      tags = await repos.tags.listForMemories(ids);
      conflicts = await repos.conflicts.listForMemories(ids);
    }
    const provByMemory = {};
    provenance.forEach(function (p) {
      (provByMemory[p.memory_record_id] = provByMemory[p.memory_record_id] || []).push(p);
    });
    const tagsByMemory = {};
    tags.forEach(function (t) {
      (tagsByMemory[t.memory_record_id] = tagsByMemory[t.memory_record_id] || []).push(t.tag_key);
    });

    const items = rows.map(function (r) {
      return Object.assign({}, r, {
        provenance: provByMemory[r.memory_record_id] || [],
        tags: tagsByMemory[r.memory_record_id] || []
      });
    });

    return {
      items: items,
      // §10: conflicts alongside, never collapsed into one winner.
      conflicts: conflicts,
      diagnostics: {
        returned: items.length,
        limit: q.limit,
        includeStates: states,
        requireProvenance: requireProvenance,
        appliedFilters: {
          domainId: q.domainId !== undefined,
          projectRef: q.projectRef !== undefined,
          timeRange: q.timeRange !== undefined,
          tags: Array.isArray(q.tags) && q.tags.length > 0,
          minConfidence: q.minConfidence,
          allowedScopes: Array.isArray(q.permissions.allowedScopes)
        },
        ordering: 'confidence_rank DESC, observed_at DESC, scope_precedence, memory_record_id',
        conflictsFound: conflicts.length
      }
    };
  });
}

// retrieveEvents(client, q) -> { items, diagnostics } — timeline retrieval.
// F14/O-R1(b) carries through the anchor: an event whose parent memory is
// tombstoned is excluded unconditionally (erasure-by-parent, §34).
async function retrieveEvents(client, q) {
  validateCommon(q);
  if (q.eventTypes !== undefined) {
    if (!Array.isArray(q.eventTypes) || !q.eventTypes.length ||
        !q.eventTypes.every(function (t) { return EVENT_TYPES.indexOf(t) !== -1; })) {
      throw refusal('RETRIEVAL_EVENT_TYPES_INVALID');
    }
  }
  const params = [q.userId, q.organisationId];
  const where = ['e.user_id = $1', 'e.organisation_id = $2',
    "(e.memory_record_id IS NULL OR pm.state <> 'tombstoned')"];
  function arg(v) { params.push(v); return '$' + params.length; }
  if (q.eventTypes !== undefined) where.push('e.event_type = ANY(' + arg(q.eventTypes) + ')');
  if (q.domainId !== undefined) where.push('e.domain_id = ' + arg(q.domainId));
  if (q.projectRef !== undefined) where.push('e.project_ref = ' + arg(q.projectRef));
  if (q.timeRange !== undefined) {
    if (q.timeRange.from !== undefined) where.push('e.occurred_at >= ' + arg(q.timeRange.from));
    if (q.timeRange.to !== undefined) where.push('e.occurred_at <= ' + arg(q.timeRange.to));
  }
  const sql =
    'SELECT e.* FROM pi_memory_events e ' +
    'LEFT JOIN pi_memory_records pm ON pm.memory_record_id = e.memory_record_id ' +
    'WHERE ' + where.join(' AND ') + ' ' +
    'ORDER BY e.occurred_at DESC, e.memory_event_id ASC ' +
    'LIMIT ' + arg(q.limit);
  return client.withTransaction(async function (exec) {
    const rows = (await exec.query(sql, params)).rows;
    return {
      items: rows,
      diagnostics: { returned: rows.length, limit: q.limit, tombstonedParentsExcluded: true }
    };
  });
}

// hydrateContent(contentStore, row) — the ONLY content path, and explicit.
// Retrieval itself never touches content bodies (D3: reference-only rows).
async function hydrateContent(contentStore, row) {
  if (!row || typeof row.content_reference !== 'string' || !row.content_reference.length) {
    throw refusal('RETRIEVAL_NO_CONTENT_REFERENCE');
  }
  return contentStore.getContent(row.content_reference);
}

module.exports = {
  retrieveMemory: retrieveMemory,
  retrieveEvents: retrieveEvents,
  hydrateContent: hydrateContent,
  CONFIDENCE_RANK: CONFIDENCE_RANK,
  SCOPE_PRECEDENCE: SCOPE_PRECEDENCE
};
