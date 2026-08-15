// =====================================================
// Mythos Personal Intelligence — MPI-4 M4-1 Provider Adapter Contract
// projects/personal-intelligence/runtime/provider-adapter.js
//
// The provider-neutral boundary MODEL_ROUTING_ARCHITECTURE and
// MYTHOS_CONTEXT_ARCHITECTURE §5 define: adapters convert a validated
// ContextPackage into a specific model's format. This module is the
// CONTRACT plus normalisation — it selects no provider, holds no
// credential, opens no connection, and performs no I/O of any kind.
// The injected provider implementation is the only thing that ever talks
// to a model, and in M4-1 the only implementation is the offline mock.
//
// Guarantees enforced here:
//   - the ContextPackage is re-validated (context-compiler.validatePackage)
//     before anything is handed to a provider — provider-specific fields and
//     credential/sensitive-named fields are refused by that validation, so a
//     malformed or leaky package can never cross the boundary
//   - conflicts are NEVER resolved here: the package's conflict diagnostics
//     travel through untouched and are surfaced on the response as
//     unresolvedConflicts (D4 remains an owner decision; no automatic
//     resolution exists on this path)
//   - provider failure is fail-closed: a throwing or malformed provider
//     yields { ok:false, kind }, never a fabricated completion
//   - refusal messages are rule-named and value-free
//
// STATUS: scratch implementation. No real provider exists or is selected
// (owner decision O-4-1); no identity bridge exists (O-4-3); nothing is
// deployed. Not wired into any application.
// =====================================================
'use strict';

const compiler = require('../reference/context-compiler');

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

// buildCompletionRequest(pkg, userMessage, constraints) — pure. Validates
// and freezes the provider-neutral request shape.
function buildCompletionRequest(pkg, userMessage, constraints) {
  const v = compiler.validatePackage(pkg);
  if (!v.valid) {
    throw refusal('ADAPTER_INVALID_CONTEXT_PACKAGE: ' + v.errors.join('; '));
  }
  if (typeof userMessage !== 'string' || !userMessage.length) {
    throw refusal('ADAPTER_USER_MESSAGE_REQUIRED');
  }
  const conflicts = (pkg._diagnostics && pkg._diagnostics.conflicts) || [];
  return {
    contextPackage: pkg,
    userMessage: userMessage,
    constraints: constraints || {},
    conflicts: conflicts
  };
}

// createProviderAdapter(provider) — provider = { name, complete(request) }.
// complete() returns { text, meta? }. Anything else is a malformed response.
function createProviderAdapter(provider) {
  if (!provider || typeof provider.name !== 'string' || !provider.name.length ||
      typeof provider.complete !== 'function') {
    throw refusal('ADAPTER_PROVIDER_CONTRACT_INVALID (requires { name, complete })');
  }
  return {
    name: provider.name,
    async complete(pkg, userMessage, constraints) {
      const request = buildCompletionRequest(pkg, userMessage, constraints);
      let response;
      try {
        response = await provider.complete(request);
      } catch (e) {
        return {
          ok: false,
          provider: provider.name,
          kind: 'PROVIDER_FAILURE',
          message: String((e && e.message) || 'provider failure')
        };
      }
      if (!response || typeof response.text !== 'string') {
        return { ok: false, provider: provider.name, kind: 'PROVIDER_MALFORMED_RESPONSE' };
      }
      return {
        ok: true,
        provider: provider.name,
        text: response.text,
        meta: response.meta || {},
        // Conflicts pass through UNRESOLVED — surfaced, never collapsed.
        conflicts: request.conflicts,
        unresolvedConflicts: request.conflicts.length
      };
    }
  };
}

module.exports = {
  createProviderAdapter: createProviderAdapter,
  buildCompletionRequest: buildCompletionRequest
};
