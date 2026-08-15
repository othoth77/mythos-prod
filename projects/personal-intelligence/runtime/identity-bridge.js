// =====================================================
// Mythos Personal Intelligence — MPI-4 M4-2 Identity Bridge (owner scope)
// projects/personal-intelligence/runtime/identity-bridge.js
//
// The MINIMUM explicit owner-declared identity bridge for the operator
// runtime, per the M4-2 order. The bridge is a whitelist of exactly one
// owner-ratified scope — the registry rows the owner seeded and authorised
// on 2026-08-15 (usr_othman / org_mythos). Nothing else resolves.
//
// Fail-closed by construction:
//   - identity must arrive as EXPLICIT input to resolveScope(); this module
//     reads no environment, no filesystem, no network, no session store,
//     no hostname, no IP — it has no capability to infer anything
//   - absent, malformed, or unknown identity is a refusal, never a default
//   - the legacy application's shared-password session is NOT an identity
//     source and is not consulted (O-4-3, the general bridge, stays OPEN)
//
// STATUS: scratch. Not wired into any application.
// =====================================================
'use strict';

// The single owner-declared mapping (owner-authorised registry seed,
// 2026-08-15). Extending this list is an owner decision (O-4-3), not an edit.
const OWNER_SCOPES = [
  { userId: 'usr_othman', organisationId: 'org_mythos' }
];

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

// resolveScope(input) -> { userId, organisationId } | throws refusal.
// O-4-3 hardening: the scope object is STRICT — only userId/organisationId
// may appear. A scope carrying runtime metadata (hostname, ip, session,
// email, anything) is refused whole, so untrusted metadata can never ride
// alongside — let alone substitute for — the explicit identity.
const SCOPE_FIELDS = ['userId', 'organisationId'];
function resolveScope(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw refusal('IDENTITY_SCOPE_REQUIRED');
  }
  const extra = Object.keys(input).filter(function (k) { return SCOPE_FIELDS.indexOf(k) === -1; });
  if (extra.length) {
    throw refusal('IDENTITY_SCOPE_UNKNOWN_FIELDS: ' + extra.join(',') + ' (identity is explicit userId/organisationId only; metadata is never an identity source)');
  }
  if (typeof input.userId !== 'string' || !input.userId.length) {
    throw refusal('IDENTITY_USER_REQUIRED');
  }
  if (typeof input.organisationId !== 'string' || !input.organisationId.length) {
    throw refusal('IDENTITY_ORGANISATION_REQUIRED');
  }
  const match = OWNER_SCOPES.find(function (s) {
    return s.userId === input.userId && s.organisationId === input.organisationId;
  });
  if (!match) {
    throw refusal('IDENTITY_SCOPE_NOT_DECLARED (only the owner-ratified scope resolves; extending the bridge is owner decision O-4-3)');
  }
  return { userId: match.userId, organisationId: match.organisationId };
}

module.exports = { resolveScope: resolveScope, OWNER_SCOPES: OWNER_SCOPES };
