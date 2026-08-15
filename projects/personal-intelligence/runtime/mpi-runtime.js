// =====================================================
// Mythos Personal Intelligence — MPI-4 M4-2 Runtime Composition (OFFLINE)
// projects/personal-intelligence/runtime/mpi-runtime.js
//
// The smallest provider-neutral runtime the architecture defines, composed
// ENTIRELY from existing components — no second retrieval path, no second
// memory store, nothing bypasses R1 -> R3:
//
//   request -> identity bridge (explicit owner scope, fail-closed)
//     -> R3 context runtime (real §10 adapter: permission-before-ranking,
//        O-R1(b), bounded deterministic retrieval)
//     -> assembler.assemble (UNCHANGED) -> compiler.compile (UNCHANGED,
//        bounded, trim-with-reasons) -> ContextPackage
//     -> M4-1 provider adapter (package re-validated; conflicts surfaced,
//        never resolved) -> injected provider -> response.
//
// Under ratified O-4-1 (DEFER — MPI_4_RUNTIME_SPECIFICATION.md §2) the only
// permitted provider is the offline mock; this module has no provider
// selection surface, no endpoint configuration, and no credential handling.
//
// O-4-4 RELEVANCE ROUTER (ratified — MPI_4_RUNTIME_SPECIFICATION.md §6):
// the interim linking rule ("every ranked memory is USEFUL", a documented
// composition choice, never a relevance judgment) is REMOVED. Linkage is now
// decided per memory by `runtime/relevance-router.js` from typed columns
// against a declared capability profile, and the UNCHANGED assembler
// classifies that linkage exactly as it always has. The router adds no
// retrieval, no store, no egress and no permission.
//
// READ-ONLY: this module issues no SQL, hydrates no content, writes nothing.
// =====================================================
'use strict';

const bridge = require('./identity-bridge');
const router = require('./relevance-router');
const contextRuntime = require('../persistence/context-runtime');
const assembler = require('../reference/context-assembler');
const compiler = require('../reference/context-compiler');
const adapterModule = require('./provider-adapter');

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

// createRuntime({ client, provider }) -> { ask(request) }
//   client   — the activated persistence client (read path)
//   provider — a provider implementation for the M4-1 adapter; under O-4-1
//              DEFER the composition root passes the offline mock only
function createRuntime(opts) {
  if (!opts || !opts.client) throw refusal('RUNTIME_CLIENT_REQUIRED');
  if (!opts.provider) throw refusal('RUNTIME_PROVIDER_REQUIRED');
  const client = opts.client;
  const adapter = adapterModule.createProviderAdapter(opts.provider);

  // ask({ scope:{userId,organisationId}, message, limit, task?,
  //       domainId?, tags?, timeRange?, minConfidence?, maxItems?, approxBudget? })
  async function ask(request) {
    if (!request || typeof request !== 'object') throw refusal('RUNTIME_REQUEST_REQUIRED');
    if (typeof request.message !== 'string' || !request.message.trim().length) {
      throw refusal('RUNTIME_MESSAGE_REQUIRED');
    }
    const scope = bridge.resolveScope(request.scope); // fail-closed identity
    const task = request.task && request.task.capabilityId
      ? { capabilityId: request.task.capabilityId }
      : { capabilityId: 'operator.context_review' }; // the operator runtime's own capability id

    // §10 retrieval through R3 — bounded, permission-filtered, deterministic.
    const q = {
      userId: scope.userId,
      organisationId: scope.organisationId,
      permissions: request.permissions || {},
      limit: request.limit
    };
    if (request.domainId !== undefined) q.domainId = request.domainId;
    if (request.projectRef !== undefined) q.projectRef = request.projectRef;
    if (request.tags !== undefined) q.tags = request.tags;
    if (request.timeRange !== undefined) q.timeRange = request.timeRange;
    if (request.minConfidence !== undefined) q.minConfidence = request.minConfidence;
    if (request.includeStates !== undefined) q.includeStates = request.includeStates;

    const ranked = await contextRuntime.retrieveRelevantMemory(client, q, { task: task });

    // O-4-4: real memory->capability linking. The router refuses an
    // undeclared capability before anything is assembled, and only ever
    // narrows the already permission-filtered R3 result.
    const routed = router.route({
      task: task,
      items: ranked.items,
      message: request.message,
      domainId: request.domainId,
      tags: request.tags
    });
    const assembly = assembler.assemble({
      task: task,
      memory: routed.items,
      permissions: q.permissions
    });
    const compileOptions = {};
    if (request.maxItems !== undefined) compileOptions.maxItems = request.maxItems;
    if (request.approxBudget !== undefined) compileOptions.approxBudget = request.approxBudget;
    const pkg = compiler.compile(assembly, compileOptions);

    const response = await adapter.complete(pkg, request.message);
    return {
      response: response,
      diagnostics: {
        retrieval: ranked.diagnostics,
        conflicts: ranked.conflicts,
        package: pkg._diagnostics,
        router: routed.diagnostics,
        routing: routed.decisions,
        // Operator visibility: ids + opaque provenance references only —
        // never summaries or content bodies. "Used" now means what the router
        // actually linked; an IRRELEVANT memory was retrieved, not used.
        memoriesUsed: routed.decisions
          .filter(function (d) { return d.classification !== 'IRRELEVANT'; })
          .map(function (d) {
            return { id: d.id, reference: d.reference, classification: d.classification };
          }),
        linkingRule: routed.diagnostics.policy
      }
    };
  }

  return { ask: ask };
}

module.exports = { createRuntime: createRuntime };
