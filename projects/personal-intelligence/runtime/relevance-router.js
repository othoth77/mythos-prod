// =====================================================
// Mythos Personal Intelligence — MPI-4 O-4-4 Relevance Router
// projects/personal-intelligence/runtime/relevance-router.js
//
// The real memory->capability linking policy that replaces M4-2's interim
// rule ("every ranked memory is USEFUL", a documented composition choice,
// never a relevance judgment — MPI_4_RUNTIME_SPECIFICATION.md §3, O-4-4).
//
// WHAT THIS MODULE IS. The missing producer of the linkage inputs the
// UNCHANGED assembler has always consumed. `context-assembler.classify`
// (MYTHOS_CONTEXT_ARCHITECTURE.md §2) maps
// `requiredForCapability` / `relatedCapabilities` / `forbidden` onto
// REQUIRED / USEFUL / IRRELEVANT / FORBIDDEN; nothing in the system ever
// produced those fields for a real memory row. This router produces them,
// and produces nothing else. It does NOT re-implement classification, does
// NOT rank inside the package (the assembler's documented ordering stands),
// and does NOT introduce a second relevance mechanism.
//
// WHAT IT MAY NEVER DO (structural, asserted by tests/mpi-4-relevance-router-test.js):
//   - retrieve (no client, no SQL, no I/O — this module requires NOTHING)
//   - widen permissions: it only narrows an already permission-filtered set
//   - infer identity, domain, or scope
//   - resolve a conflict (D4 stays open; `disputed` can never be REQUIRED)
//   - read instructions out of memory content (classification derives only
//     from typed columns, never from `content_summary` text)
//   - egress anything (the O-4-1 §2.2 serializer is untouched and still
//     sends intent + item summaries + user message only)
//
// AUTHORITATIVE SOURCES (nothing here is invented policy):
//   MYTHOS_CONTEXT_ARCHITECTURE.md §2  — the four classes; FORBIDDEN wins;
//     permission filtering precedes relevance, always.
//   MYTHOS_CHATBOT_ARCHITECTURE.md §5  — routing ranks on domain, role,
//     organisation, enabled capabilities, permissions, workflow patterns;
//     "routing from keyword matching alone is explicitly insufficient".
//     Encoded literally below: lexical overlap can never LINK an item, only
//     break ties between items already linked structurally.
//   MYTHOS_CHATBOT_ARCHITECTURE.md §6  — never infer with false confidence;
//     degrade gracefully instead. Encoded as the REQUIRED confidence floor:
//     an under-evidenced item is demoted to USEFUL, never promoted.
//   SKILLS_SUPERPOSER.md §3            — only capabilities actually available
//     in the runtime are ever composed; an unavailable one fails closed and
//     is never silently substituted. Encoded as CAPABILITY_PROFILES, a
//     whitelist of one (the identity-bridge precedent) — extending it is a
//     reviewed code change, never a runtime affordance.
//   MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §7 — the precedence ladder
//     that gives `precedenceRank` its numbers (see below).
//   MYTHOS_USER_MEMORY_POLICY.md §1/§3/§4 — the seven memory types, scope
//     non-promotion, and the LOW/MEDIUM/HIGH/EXPLICIT confidence ladder.
// =====================================================
'use strict';

// The retrieval adapter's confidence ladder (persistence/retrieval.js), kept
// as a local constant so this module stays dependency-free.
var CONFIDENCE_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, EXPLICIT: 4 };

// The seven memory types of MYTHOS_USER_MEMORY_POLICY.md §1 (A-G), exactly
// as the schema's `pi_memory_records.memory_type` comment enumerates them.
var MEMORY_TYPES = ['WORKING_PREFERENCE', 'WORKFLOW', 'DOMAIN_CONTEXT', 'ORG_KNOWLEDGE',
  'TASK_HISTORY', 'DECISION', 'EPHEMERAL_SESSION'];

// -----------------------------------------------------------------------
// CAPABILITY_PROFILES — the declared memory->capability linkage.
//
// A whitelist of ONE, for the same reason the identity bridge is: every
// domain-pack capability (`assessment.prepare`, `estimate.prepare`, ...) is
// documented as having NO runtime implementation (MYTHOS_DOMAIN_PACKS.md
// §"Status"), and SKILLS_SUPERPOSER.md §3 forbids composing a capability the
// runtime does not actually have. The operator runtime's own capability is
// the only one that exists, so it is the only one declared here.
//
// Per profile:
//   requiredMemoryTypes — types the capability cannot be handled correctly
//                         without (the REQUIRED definition, §2)
//   usefulMemoryTypes   — types that improve the answer but never block it
//   admissibleScopes    — memory scopes this capability may consider at all;
//                         `session` is absent because EPHEMERAL_SESSION rows
//                         are useful only inside their own interaction
//                         (MYTHOS_USER_MEMORY_POLICY.md §1 G)
//   requiredMinConfidence — the floor below which a REQUIRED-eligible type is
//                         demoted to USEFUL rather than asserted (§6)
// -----------------------------------------------------------------------
var CAPABILITY_PROFILES = {
  'operator.context_review': {
    capabilityId: 'operator.context_review',
    requiredMemoryTypes: ['DECISION', 'ORG_KNOWLEDGE'],
    usefulMemoryTypes: ['WORKING_PREFERENCE', 'WORKFLOW', 'DOMAIN_CONTEXT', 'TASK_HISTORY'],
    admissibleScopes: ['user', 'organisation', 'domain', 'global'],
    requiredMinConfidence: 'HIGH'
  }
};

function refusal(code) {
  var e = new Error(code);
  e.refused = true;
  return e;
}

// Fields the router alone is authoritative for. A memory record arriving
// with any of them pre-set is refused whole rather than trusted — a memory
// row must never be able to declare its own relevance or its own permission
// verdict. (The R3 mapping cannot produce these; this is the boundary
// assertion, mirroring the identity bridge's strict scope object.)
var SMUGGLED_FIELDS = ['requiredForCapability', 'relatedCapabilities', 'forbidden',
  'permissionDecision', 'classification', 'private'];

function assertItem(m, index) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw refusal('ROUTER_ITEM_MALFORMED: index ' + index);
  if (typeof m.memoryRecordId !== 'string' || !m.memoryRecordId.length) throw refusal('ROUTER_ITEM_MALFORMED: memoryRecordId at index ' + index);
  if (typeof m.memoryType !== 'string' || !m.memoryType.length) throw refusal('ROUTER_ITEM_MALFORMED: memoryType at index ' + index);
  if (typeof m.scope !== 'string' || !m.scope.length) throw refusal('ROUTER_ITEM_MALFORMED: scope at index ' + index);
  if (!m.provenance || typeof m.provenance !== 'object' || typeof m.provenance.reference !== 'string') {
    throw refusal('ROUTER_ITEM_MALFORMED: provenance.reference at index ' + index);
  }
  SMUGGLED_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(m, f)) {
      throw refusal('ROUTER_ITEM_LINKAGE_SMUGGLED: ' + f + ' at index ' + index);
    }
  });
}

function resolveProfile(capabilityId) {
  if (typeof capabilityId !== 'string' || !capabilityId.trim().length) throw refusal('ROUTER_CAPABILITY_REQUIRED');
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_PROFILES, capabilityId)) {
    // Fail closed. Never substitute a neighbouring capability, never fall
    // back to "link everything as USEFUL" — that was the interim rule this
    // stage exists to remove.
    throw refusal('ROUTER_CAPABILITY_NOT_AVAILABLE: ' + capabilityId +
      ' (declared runtime capabilities: ' + Object.keys(CAPABILITY_PROFILES).join(', ') + ')');
  }
  return CAPABILITY_PROFILES[capabilityId];
}

// -----------------------------------------------------------------------
// Lexical overlap — a TIE-BREAKER ONLY.
//
// MYTHOS_CHATBOT_ARCHITECTURE.md §5 states that routing from keyword
// matching alone is explicitly insufficient. This function therefore feeds
// nothing but the ordering comparator: `link()` below reaches its verdict
// before any overlap is consulted, so a memory can never become relevant by
// resembling the request text.
// -----------------------------------------------------------------------
function tokenize(text) {
  if (typeof text !== 'string') return [];
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(function (t) { return t.length >= 3; });
}

function lexicalOverlap(message, summary) {
  var a = tokenize(message), seen = {}, n = 0;
  a.forEach(function (t) { seen[t] = true; });
  var counted = {};
  tokenize(summary).forEach(function (t) {
    if (seen[t] && !counted[t]) { counted[t] = true; n++; }
  });
  return n;
}

// -----------------------------------------------------------------------
// precedenceRank(item) — MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §7,
// restricted to the rungs memory can actually occupy. Rungs 1 (system /
// security / legal), 3 (role / permissions) and 4 (this turn's explicit
// instruction) are deliberately absent: none of them is a memory record —
// 1 and 3 are enforced upstream of relevance and 4 is the user message
// itself. Lower number = higher precedence.
// -----------------------------------------------------------------------
function precedenceRank(m) {
  var conf = CONFIDENCE_RANK[m.provenance && m.provenance.confidence] || 0;
  if (m.scope === 'organisation' && m.memoryType === 'ORG_KNOWLEDGE') return 2; // organisation policy
  if (conf === 4 && (m.memoryType === 'DECISION' || m.memoryType === 'WORKING_PREFERENCE')) return 5; // explicit persistent user rule
  if (m.scope === 'organisation' && m.memoryType === 'WORKFLOW') return 6; // verified organisation workflow
  if (m.memoryType === 'WORKING_PREFERENCE' && conf >= 3) return 7; // established user preference
  if (m.memoryType === 'DOMAIN_CONTEXT' || m.scope === 'domain') return 8; // domain default
  return 9; // generic default
}

// -----------------------------------------------------------------------
// link(m, profile, ctx) -> { classification, reason, signals }
//
// Gates first (each an exclusion, never a promotion), then type linkage,
// then the REQUIRED evidence floor. Every branch records why.
// -----------------------------------------------------------------------
function link(m, profile, ctx) {
  var signals = [];

  // Gate: scope admissibility. Never widens — an inadmissible scope is
  // dropped here even though R1/the assembler would also drop it.
  if (profile.admissibleScopes.indexOf(m.scope) === -1) {
    return { classification: 'IRRELEVANT', reason: 'scope_not_admissible', signals: signals };
  }

  // Gate: domain. A memory belonging to a different declared domain is never
  // carried across (MYTHOS_USER_MEMORY_POLICY.md §3 — no automatic
  // cross-scope application). An undeclared domain infers nothing.
  if (ctx.domainId && m.domainId && m.domainId !== ctx.domainId) {
    return { classification: 'IRRELEVANT', reason: 'domain_mismatch', signals: signals };
  }
  if (ctx.domainId && m.domainId === ctx.domainId) signals.push('domain_match');
  if (ctx.tags && ctx.tags.length && Array.isArray(m.tags) &&
      m.tags.some(function (t) { return ctx.tags.indexOf(t) !== -1; })) {
    signals.push('tag_match');
  }

  // Structural linkage: the memory TYPE decides whether this capability has
  // any business seeing the record. A type outside both lists is irrelevant
  // no matter how well its text matches the request.
  var isRequiredType = profile.requiredMemoryTypes.indexOf(m.memoryType) !== -1;
  var isUsefulType = profile.usefulMemoryTypes.indexOf(m.memoryType) !== -1;
  if (!isRequiredType && !isUsefulType) {
    return { classification: 'IRRELEVANT', reason: 'type_not_linked_to_capability', signals: signals };
  }
  signals.push(isRequiredType ? 'type_required' : 'type_useful');

  if (!isRequiredType) return { classification: 'USEFUL', reason: 'type_useful', signals: signals };

  // REQUIRED evidence floor. Below it the item still travels — demoted, not
  // discarded, and never asserted as something the answer depends on.
  if (m.state !== 'active') {
    // Includes `disputed`: a conflict is surfaced, never resolved (D4).
    return { classification: 'USEFUL', reason: 'state_not_active:' + m.state, signals: signals };
  }
  var conf = CONFIDENCE_RANK[m.provenance && m.provenance.confidence] || 0;
  if (conf < CONFIDENCE_RANK[profile.requiredMinConfidence]) {
    return { classification: 'USEFUL', reason: 'confidence_below_required_floor', signals: signals };
  }
  return { classification: 'REQUIRED', reason: 'type_required_with_evidence', signals: signals };
}

// -----------------------------------------------------------------------
// route({ task, items, message, domainId, tags })
//   -> { capabilityId, items, decisions, diagnostics }
//
// `items` are R3's already-ranked, already-permission-filtered records. The
// returned `items` are assembler input — the SAME shape M4-2 produced, with
// the linkage fields now genuinely decided instead of blanket-assigned.
// IRRELEVANT records are handed to the assembler too, unlinked, so its own
// exclusion counters stay honest; `classify` drops them exactly as written.
//
// Pure: same inputs -> byte-identical output.
// -----------------------------------------------------------------------
function route(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw refusal('ROUTER_INPUT_REQUIRED');
  if (!input.task || typeof input.task !== 'object') throw refusal('ROUTER_CAPABILITY_REQUIRED');
  var profile = resolveProfile(input.task.capabilityId);
  if (!Array.isArray(input.items)) throw refusal('ROUTER_ITEMS_REQUIRED');
  if (input.tags !== undefined && !Array.isArray(input.tags)) throw refusal('ROUTER_TAGS_MALFORMED');
  if (input.domainId !== undefined && input.domainId !== null && typeof input.domainId !== 'string') {
    throw refusal('ROUTER_DOMAIN_MALFORMED');
  }
  var ctx = { domainId: input.domainId || null, tags: input.tags || [] };

  var decided = input.items.map(function (m, index) {
    assertItem(m, index);
    var verdict = link(m, profile, ctx);
    return {
      record: m,
      index: index,
      classification: verdict.classification,
      reason: verdict.reason,
      signals: verdict.signals,
      precedenceRank: precedenceRank(m),
      confidenceRank: CONFIDENCE_RANK[m.provenance && m.provenance.confidence] || 0,
      // Consulted ONLY by the comparator below, and only between items that
      // are already linked. Never an input to `link`.
      lexicalOverlap: lexicalOverlap(input.message, m.contentSummary)
    };
  });

  var CLASS_RANK = { REQUIRED: 0, USEFUL: 1, IRRELEVANT: 2 };
  decided.sort(function (a, b) {
    return (CLASS_RANK[a.classification] - CLASS_RANK[b.classification]) ||
      (a.precedenceRank - b.precedenceRank) ||
      (b.confidenceRank - a.confidenceRank) ||
      (b.lexicalOverlap - a.lexicalOverlap) ||
      (a.index - b.index) ||
      a.record.memoryRecordId.localeCompare(b.record.memoryRecordId);
  });

  var counts = { candidates: decided.length, required: 0, useful: 0, irrelevant: 0 };
  var items = decided.map(function (d) {
    var m = d.record;
    if (d.classification === 'REQUIRED') counts.required++;
    else if (d.classification === 'USEFUL') counts.useful++;
    else counts.irrelevant++;
    var item = {
      key: m.memoryRecordId,
      value: m.contentSummary,
      // Permission scope and provenance travel verbatim — the router copies,
      // it never rewrites, relaxes, or synthesises either one.
      permissionScope: m.scope,
      contentReference: m.contentReference,
      provenance: { reference: m.provenance.reference }
    };
    if (d.classification === 'REQUIRED') item.requiredForCapability = profile.capabilityId;
    if (d.classification === 'USEFUL') item.relatedCapabilities = [profile.capabilityId];
    return item;
  });

  return {
    capabilityId: profile.capabilityId,
    items: items,
    decisions: decided.map(function (d) {
      // Ids, references and typed verdicts only — never a summary, never a
      // content body (the operator-visibility convention of O-4-2 Phase 6).
      return {
        id: d.record.memoryRecordId,
        reference: d.record.provenance.reference,
        classification: d.classification,
        reason: d.reason,
        signals: d.signals,
        precedenceRank: d.precedenceRank
      };
    }),
    diagnostics: {
      capabilityId: profile.capabilityId,
      profile: {
        requiredMemoryTypes: profile.requiredMemoryTypes,
        usefulMemoryTypes: profile.usefulMemoryTypes,
        admissibleScopes: profile.admissibleScopes,
        requiredMinConfidence: profile.requiredMinConfidence
      },
      counts: counts,
      policy: 'O-4-4 relevance router: memory->capability linkage from declared capability ' +
        'profile (typed columns only), permission-filtered upstream, REQUIRED gated by state=active ' +
        'and confidence >= ' + profile.requiredMinConfidence + '; lexical overlap is a tie-breaker, never a link',
      rankingRule: 'classification, then MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §7 precedence, ' +
        'then confidence, then lexical overlap, then retrieval order, then memory id (deterministic)'
    }
  };
}

module.exports = {
  CONFIDENCE_RANK: CONFIDENCE_RANK,
  MEMORY_TYPES: MEMORY_TYPES,
  CAPABILITY_PROFILES: CAPABILITY_PROFILES,
  resolveProfile: resolveProfile,
  precedenceRank: precedenceRank,
  lexicalOverlap: lexicalOverlap,
  route: route
};
