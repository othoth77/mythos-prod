// =====================================================
// Mythos Personal Intelligence — Context Assembler Reference
// projects/personal-intelligence/reference/context-assembler.js
//
// Illustrative, dependency-free implementation of
// docs/MYTHOS_CONTEXT_ARCHITECTURE.md §2 (classification + assembly) and §3
// (retrieval interface shape).
//
// STATUS: reference only. In-memory. Not wired into the production
// application. No vector database. Exercised by
// tests/mpi-0-personal-intelligence-test.js.
// =====================================================
'use strict';

var scope = require('./scope');

// -----------------------------------------------------------------------
// classify(item, task) -> 'REQUIRED' | 'USEFUL' | 'IRRELEVANT' | 'FORBIDDEN'
//
// item: { key, value, requiredForCapability, relatedCapabilities, forbidden }
// task: { capabilityId }
// -----------------------------------------------------------------------
function classify(item, task) {
  if (!item) return 'IRRELEVANT';
  if (item.forbidden) return 'FORBIDDEN'; // permission/privacy exclusion always wins
  if (task && item.requiredForCapability === task.capabilityId) return 'REQUIRED';
  if (task && Array.isArray(item.relatedCapabilities) && item.relatedCapabilities.indexOf(task.capabilityId) !== -1) {
    return 'USEFUL';
  }
  return 'IRRELEVANT';
}

// -----------------------------------------------------------------------
// retrieveRelevantMemory({ userId, organisationId, domainId, task, memoryStore, limit })
//   -> ranked, permission-filtered memory items (docs/MYTHOS_CONTEXT_ARCHITECTURE.md §3)
//
// This is a minimal in-memory ranking (most-recent, then most-evidenced).
// A future MPI-1 implementation may replace the ranking strategy (e.g. with
// semantic/vector search) without changing this function's contract.
// -----------------------------------------------------------------------
function retrieveRelevantMemory(opts) {
  var ctx = { userId: opts.userId, organisationId: opts.organisationId, domainId: opts.domainId, sessionId: opts.sessionId };
  var visible = scope.filterByScope(opts.memoryStore || [], ctx);
  var relevant = visible.filter(function (m) {
    if (!opts.task || !opts.task.capabilityId) return true;
    return !m.relatedCapabilities || m.relatedCapabilities.indexOf(opts.task.capabilityId) !== -1;
  });
  relevant.sort(function (a, b) {
    var at = new Date(a.lastObservedAt || a.createdAt || 0).getTime();
    var bt = new Date(b.lastObservedAt || b.createdAt || 0).getTime();
    return bt - at;
  });
  var limit = typeof opts.limit === 'number' ? opts.limit : relevant.length;
  return relevant.slice(0, limit);
}

// -----------------------------------------------------------------------
// assembleContext({ globalRules, domainContext, organisationContext,
//                    permissions, userPreferences, memory, task })
//   -> ContextPackage-shaped object (docs/MYTHOS_CONTEXT_ARCHITECTURE.md §5)
//
// FORBIDDEN items are excluded before relevance is ever considered.
// -----------------------------------------------------------------------
function assembleContext(input) {
  var task = input.task || {};
  var allCandidates = []
    .concat((input.globalRules || []).map(function (i) { return Object.assign({ source: 'global' }, i); }))
    .concat((input.domainContext || []).map(function (i) { return Object.assign({ source: 'domain' }, i); }))
    .concat((input.organisationContext || []).map(function (i) { return Object.assign({ source: 'organisation' }, i); }))
    .concat((input.userPreferences || []).map(function (i) { return Object.assign({ source: 'user' }, i); }))
    .concat((input.memory || []).map(function (i) { return Object.assign({ source: 'memory' }, i); }));

  var required = [], useful = [], excludedForbidden = 0, excludedIrrelevant = 0;

  allCandidates.forEach(function (item) {
    var classification = classify(item, task);
    if (classification === 'FORBIDDEN') { excludedForbidden++; return; }
    if (classification === 'REQUIRED') { required.push(item); return; }
    if (classification === 'USEFUL') { useful.push(item); return; }
    excludedIrrelevant++;
  });

  return {
    intent: task.capabilityId || null,
    requiredFacts: required,
    relevantPreferences: useful.filter(function (i) { return i.source === 'user'; }),
    organisationRules: required.concat(useful).filter(function (i) { return i.source === 'organisation'; }),
    domainInstructions: required.concat(useful).filter(function (i) { return i.source === 'domain'; }),
    permissions: input.permissions || null,
    selectedSkills: task.capabilityId ? [task.capabilityId] : [],
    entities: input.entities || [],
    outputRequirements: input.outputRequirements || null,
    _stats: {
      requiredCount: required.length,
      usefulCount: useful.length,
      excludedForbiddenCount: excludedForbidden,
      excludedIrrelevantCount: excludedIrrelevant
    }
  };
}

module.exports = {
  classify: classify,
  retrieveRelevantMemory: retrieveRelevantMemory,
  assembleContext: assembleContext
};
