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
var entityResolver = require('./entity-resolver');

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

// Runtime assembler. Unlike assembleContext, this returns a normalised
// AssemblyResult for the provider-neutral compiler rather than a package.
function assemble(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Assembler input must be an object');
  if (input.permissions !== undefined && (!input.permissions || typeof input.permissions !== 'object' || Array.isArray(input.permissions))) throw new TypeError('permissions must be an object');
  var task = input.task || {};
  var sources = ['globalRules', 'domainContext', 'organisationContext', 'sessionContext', 'userPreferences', 'memory'];
  var sourceNames = { globalRules: 'global', domainContext: 'domain', organisationContext: 'organisation', sessionContext: 'session', userPreferences: 'user', memory: 'memory' };
  var exclusions = { FORBIDDEN: 0, IRRELEVANT: 0, DUPLICATE: 0, OUT_OF_SCOPE: 0 };
  var deniedReferences = [];
  var candidates = [];
  sources.forEach(function (sourceKey) {
    var records = input[sourceKey] || [];
    if (!Array.isArray(records)) throw new TypeError(sourceKey + ' must be an array');
    records.forEach(function (record, index) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || !record.key) throw new TypeError('Malformed entry in ' + sourceKey);
      var item = Object.assign({}, record, { source: sourceNames[sourceKey] });
      item.provenance = Object.assign({}, record.provenance || {}, { source: sourceNames[sourceKey], reference: (record.provenance && record.provenance.reference) || sourceKey + ':' + index });
      var permissionAllowed = !record.private && !record.forbidden && record.permissionDecision !== 'DENY' &&
        (!record.permissionScope || !input.permissions || !Array.isArray(input.permissions.allowedScopes) || input.permissions.allowedScopes.indexOf(record.permissionScope) !== -1);
      if (!permissionAllowed) { exclusions.FORBIDDEN++; deniedReferences.push({ reference: item.provenance.reference, reason: 'permission_or_privacy' }); return; }
      item.classification = classify(item, task);
      item.provenance.classification = item.classification;
      candidates.push(item);
    });
  });
  var relevant = candidates.filter(function (item) { if (item.classification === 'IRRELEVANT') { exclusions.IRRELEVANT++; return false; } return true; });
  relevant.sort(function (a, b) {
    var rank = { REQUIRED: 0, USEFUL: 1 };
    var sessionA = a.source === 'session' ? -1 : 0, sessionB = b.source === 'session' ? -1 : 0;
    return (rank[a.classification] - rank[b.classification]) || (sessionA - sessionB) || a.provenance.reference.localeCompare(b.provenance.reference);
  });
  var seen = {}, items = [], conflicts = [], byKey = {};
  relevant.forEach(function (item) {
    var semantic = item.key + '|' + JSON.stringify(item.value);
    if (seen[semantic]) { exclusions.DUPLICATE++; return; }
    seen[semantic] = true;
    if (byKey[item.key] && JSON.stringify(byKey[item.key].value) !== JSON.stringify(item.value)) conflicts.push({ key: item.key, items: [byKey[item.key], item] });
    else byKey[item.key] = item;
    items.push(item);
  });
  var retrievalRequest = { userId: input.userId || null, organisationId: input.organisationId || null, domainId: input.domainId || null, task: task, limit: input.memoryLimit === undefined ? null : input.memoryLimit };
  var entities = entityResolver.resolveAll(input.entityReferences || [], input.entityCandidates || []);
  return { type: 'AssemblyResult', intent: task.capabilityId || null, items: items, retrieval: { request: retrievalRequest, count: items.filter(function (i) { return i.source === 'memory'; }).length }, entities: entities, conflicts: conflicts, exclusions: { counts: exclusions, denied: deniedReferences }, permissions: input.permissions || null, selectedSkills: input.selectedSkills || (task.capabilityId ? [task.capabilityId] : []), outputRequirements: input.outputRequirements === undefined ? null : input.outputRequirements };
}

module.exports = {
  classify: classify,
  retrieveRelevantMemory: retrieveRelevantMemory,
  assembleContext: assembleContext,
  assemble: assemble
};
