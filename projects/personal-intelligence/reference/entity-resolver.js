'use strict';

function invalid(message) { var error = new TypeError(message); error.code = 'INVALID_ENTITY_REFERENCE'; throw error; }

function validateReference(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) invalid('Entity reference must be an object');
  if (!reference.organisationScope || !reference.permissionScope) invalid('Entity reference requires organisationScope and permissionScope');
  if (!reference.id && !reference.externalId && !reference.alias && !reference.name) invalid('Entity reference requires an identifier, alias, or name');
}

function inScope(entity, reference) {
  var permission = reference.permissionScope;
  var allowed = Array.isArray(permission) ? permission : [permission];
  return entity && entity.organisationScope === reference.organisationScope &&
    allowed.indexOf(entity.permissionScope) !== -1;
}

function publicCandidate(entity) {
  return {
    id: entity.id,
    externalId: entity.externalId || null,
    name: entity.name || null,
    organisationScope: entity.organisationScope,
    permissionScope: entity.permissionScope,
    provenance: entity.provenance || null
  };
}

function resolve(reference, candidates) {
  validateReference(reference);
  if (!Array.isArray(candidates)) invalid('Entity candidates must be an array');
  var scoped = candidates.filter(function (candidate) { return inScope(candidate, reference); });
  var strong = scoped.filter(function (candidate) {
    return (reference.id && candidate.id === reference.id) ||
      (reference.externalId && candidate.externalId === reference.externalId);
  });
  if (strong.length === 1) return { status: 'EXACT_MATCH', confidence: 1, entity: publicCandidate(strong[0]), candidates: [], reference: reference };
  if (strong.length > 1) return { status: 'CONFLICTING_IDENTITIES', confidence: 1, entity: null, candidates: strong.map(publicCandidate), reference: reference };
  var aliases = scoped.filter(function (candidate) {
    return reference.alias && Array.isArray(candidate.aliases) && candidate.aliases.indexOf(reference.alias) !== -1;
  });
  if (aliases.length === 1) return { status: 'ALIAS_MATCH', confidence: 0.9, entity: publicCandidate(aliases[0]), candidates: [], reference: reference };
  if (aliases.length > 1) return { status: 'POSSIBLE_MATCH', confidence: 0.5, entity: null, candidates: aliases.map(publicCandidate), reference: reference };
  var nameMatches = scoped.filter(function (candidate) {
    return reference.name && candidate.name && candidate.name.toLocaleLowerCase() === reference.name.toLocaleLowerCase();
  });
  if (nameMatches.length) return { status: 'POSSIBLE_MATCH', confidence: 0.4, entity: null, candidates: nameMatches.map(publicCandidate), reference: reference };
  return { status: 'NOT_FOUND', confidence: 0, entity: null, candidates: [], reference: reference };
}

function resolveAll(references, candidates) {
  if (!Array.isArray(references)) invalid('Entity references must be an array');
  return references.map(function (reference) { return resolve(reference, candidates || []); });
}

module.exports = { validateReference: validateReference, resolve: resolve, resolveAll: resolveAll };
