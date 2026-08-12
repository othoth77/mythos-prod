'use strict';

var PACKAGE_FIELDS = ['intent', 'requiredFacts', 'relevantPreferences', 'organisationRules', 'domainInstructions', 'permissions', 'selectedSkills', 'entities', 'outputRequirements'];
var ITEM_FIELDS = ['requiredFacts', 'relevantPreferences', 'organisationRules', 'domainInstructions'];
var PROVIDER_KEYS = ['messages', 'system', 'role', 'content', 'max_tokens', 'stop_sequences', 'candidates', 'parts', 'choices', 'completion'];

function validatePackage(pkg) {
  var errors = [];
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return { valid: false, errors: ['Package must be an object'] };
  PACKAGE_FIELDS.forEach(function (key) { if (!Object.prototype.hasOwnProperty.call(pkg, key)) errors.push('Missing field: ' + key); });
  Object.keys(pkg).forEach(function (key) { if (PACKAGE_FIELDS.indexOf(key) === -1 && key.charAt(0) !== '_') errors.push('Unexpected field: ' + key); });
  ITEM_FIELDS.concat(['selectedSkills', 'entities']).forEach(function (key) { if (!Array.isArray(pkg[key])) errors.push(key + ' must be an array'); });
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(function (key) {
      if (PROVIDER_KEYS.indexOf(key) !== -1) errors.push('Provider-specific field: ' + key);
      if (/^(credential|credentials|secret|secrets|password|token|api[_-]?key|environment|env)$/i.test(key)) errors.push('Sensitive field: ' + key);
      inspect(value[key]);
    });
  }
  inspect(pkg);
  return { valid: errors.length === 0, errors: errors };
}

function categoryFor(item) {
  if (item.source === 'user' || item.source === 'memory') return item.source === 'user' ? 'relevantPreferences' : 'requiredFacts';
  if (item.source === 'organisation') return 'organisationRules';
  if (item.source === 'domain') return 'domainInstructions';
  return 'requiredFacts';
}

function compile(assembly, options) {
  options = options || {};
  if (!assembly || assembly.type !== 'AssemblyResult' || !Array.isArray(assembly.items)) throw new TypeError('A valid AssemblyResult is required');
  if (options.approxBudget !== undefined && (!Number.isInteger(options.approxBudget) || options.approxBudget < 0)) throw new TypeError('approxBudget must be a non-negative character budget');
  if (options.maxItems !== undefined && (!Number.isInteger(options.maxItems) || options.maxItems < 0)) throw new TypeError('maxItems must be a non-negative integer');
  var include = options.includeCategories || null, exclude = options.excludeCategories || [];
  var domains = options.domains || options.domainConstraints || null;
  var items = assembly.items.filter(function (item) {
    var category = categoryFor(item);
    if (include && include.indexOf(category) === -1) return false;
    if (exclude.indexOf(category) !== -1) return false;
    if (domains && item.domainId && domains.indexOf(item.domainId) === -1) return false;
    if (options.permissionScope && item.permissionScope && options.permissionScope.indexOf(item.permissionScope) === -1) return false;
    if ((options.requireProvenance || options.provenanceRequirement) && !item.provenance) return false;
    return true;
  });
  var trimmed = [];
  function dropUsefulFirst(reason) {
    var usefulIndex = -1;
    for (var i = items.length - 1; i >= 0; i--) if (items[i].classification === 'USEFUL') { usefulIndex = i; break; }
    var index = usefulIndex === -1 ? items.length - 1 : usefulIndex;
    if (index >= 0) trimmed.push({ reason: reason, sourceReference: items[index].provenance && items[index].provenance.reference, classification: items[index].classification }), items.splice(index, 1);
  }
  while (options.maxItems !== undefined && items.length > options.maxItems) dropUsefulFirst('maxItems');
  function build() {
    var pkg = {
      intent: assembly.intent,
      requiredFacts: [], relevantPreferences: [], organisationRules: [], domainInstructions: [],
      permissions: assembly.permissions, selectedSkills: assembly.selectedSkills || [], entities: assembly.entities || [],
      outputRequirements: assembly.outputRequirements === undefined ? null : assembly.outputRequirements
    };
    items.forEach(function (item) { pkg[categoryFor(item)].push(item); });
    pkg._diagnostics = { exclusions: assembly.exclusions, conflicts: assembly.conflicts || [], trimmed: trimmed, approxBudgetUnit: 'characters' };
    return pkg;
  }
  var pkg = build();
  while (options.approxBudget !== undefined && JSON.stringify(pkg).length > options.approxBudget && items.length) { dropUsefulFirst('approxBudget'); pkg = build(); }
  pkg._diagnostics.budgetOverflow = options.approxBudget !== undefined && JSON.stringify(pkg).length > options.approxBudget;
  var validation = validatePackage(pkg);
  if (!validation.valid) { var error = new TypeError('Invalid ContextPackage: ' + validation.errors.join('; ')); error.validation = validation; throw error; }
  return pkg;
}

module.exports = { PACKAGE_FIELDS: PACKAGE_FIELDS, compile: compile, validatePackage: validatePackage };
