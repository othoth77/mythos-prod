// =====================================================
// Mythos Personal Intelligence — Scope Reference
// projects/personal-intelligence/reference/scope.js
//
// Illustrative, dependency-free implementation of the scope/isolation and
// precedence rules documented in:
//   docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §7 (Precedence Rules)
//   docs/MYTHOS_AI_MULTI_TENANCY.md
//
// STATUS: reference only. Not wired into the production application.
// No persistence. Exercised by tests/mpi-0-personal-intelligence-test.js.
// =====================================================
'use strict';

// Fixed, permanent precedence order — see docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §7.
const PRECEDENCE_ORDER = [
  'system_security_legal_constraints',
  'current_authorised_organisation_policy',
  'current_role_permissions',
  'current_explicit_user_instruction',
  'explicit_persistent_user_rule',
  'verified_organisation_workflow',
  'established_user_preference',
  'domain_default',
  'generic_mythos_default'
];

const SCOPES = ['session', 'user', 'organisation', 'domain', 'global'];

// -----------------------------------------------------------------------
// Isolation enforcement — application/data-layer, never prompt-only.
// A record is visible to a request context only if its scope-defining
// identifiers match the requester's. Guessed/absent identifiers never
// grant a match.
// -----------------------------------------------------------------------
function recordVisibleToContext(record, ctx) {
  if (!record || !ctx) return false;
  if (!ctx.userId || !ctx.organisationId) return false; // no anonymous/incomplete context ever matches
  if (record.scope === 'session') {
    // Both sessionIds must be present and equal — two records/contexts that
    // both happen to lack a sessionId must never be treated as a match.
    return !!record.sessionId && !!ctx.sessionId
      && record.sessionId === ctx.sessionId
      && record.userId === ctx.userId;
  }
  if (record.scope === 'user') {
    return record.userId === ctx.userId && record.organisationId === ctx.organisationId;
  }
  if (record.scope === 'organisation') {
    return record.organisationId === ctx.organisationId;
  }
  if (record.scope === 'domain') {
    // Domain scope is intentionally domain-wide, not organisation-scoped —
    // a domain default is meant to be shared by every organisation in that
    // domain (see docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §3). It
    // is NOT an organisation-private record, so this is not a tenant leak;
    // it must still never match on two absent/undefined domainIds.
    return !!record.domainId && !!ctx.domainId && record.domainId === ctx.domainId;
  }
  if (record.scope === 'global') {
    return true;
  }
  return false;
}

function filterByScope(records, ctx) {
  return (records || []).filter(function (r) { return recordVisibleToContext(r, ctx); });
}

// -----------------------------------------------------------------------
// Precedence resolution — given a map of { precedenceKey: value }, return
// the value from the highest-precedence key that is actually present.
// A lower-precedence value is never selected merely because it exists if a
// higher-precedence key is also present, and a preference never appears
// ahead of a permission/policy key in PRECEDENCE_ORDER.
// -----------------------------------------------------------------------
function resolveByPrecedence(candidates) {
  for (var i = 0; i < PRECEDENCE_ORDER.length; i++) {
    var key = PRECEDENCE_ORDER[i];
    if (candidates && Object.prototype.hasOwnProperty.call(candidates, key) && candidates[key] !== undefined) {
      return { key: key, value: candidates[key] };
    }
  }
  return null;
}

module.exports = {
  PRECEDENCE_ORDER: PRECEDENCE_ORDER,
  SCOPES: SCOPES,
  recordVisibleToContext: recordVisibleToContext,
  filterByScope: filterByScope,
  resolveByPrecedence: resolveByPrecedence
};
