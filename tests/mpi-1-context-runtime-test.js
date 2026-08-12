'use strict';
var path = require('path');
var root = path.join(__dirname, '..', 'projects/personal-intelligence/reference');
var assembler = require(path.join(root, 'context-assembler'));
var compiler = require(path.join(root, 'context-compiler'));
var resolver = require(path.join(root, 'entity-resolver'));
var passed = 0, failed = 0;
function ok(value, label) { if (value) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
function throws(fn) { try { fn(); return false; } catch (_) { return true; } }
function base(extra) {
  return Object.assign({ userId: 'u1', organisationId: 'o1', domainId: 'education', task: { capabilityId: 'teach' }, permissions: { allowedScopes: ['read'] } }, extra || {});
}
function item(key, value, extra) { return Object.assign({ key: key, value: value, requiredForCapability: 'teach', provenance: { reference: 'ref-' + key } }, extra || {}); }
function compile(input, options) { return compiler.compile(assembler.assemble(base(input)), options); }
var fields = compiler.PACKAGE_FIELDS.slice().sort();

console.log('\nMPI-1 CONTEXT RUNTIME');
var pkg = compile({ globalRules: [item('rule', 'v')], userPreferences: [item('pref', 'p', { requiredForCapability: null, relatedCapabilities: ['teach'] })] });
ok(Object.keys(pkg).filter(function (k) { return k.charAt(0) !== '_'; }).sort().join('|') === fields.join('|'), '1 canonical ContextPackage shape');
ok(fields.every(function (f) { return Object.prototype.hasOwnProperty.call(pkg, f); }), '2 required fields present');
ok(pkg.outputRequirements === null && pkg.permissions.allowedScopes[0] === 'read', '3 optional field semantics preserved');
ok(JSON.stringify(pkg) === JSON.stringify(compile({ globalRules: [item('rule', 'v')], userPreferences: [item('pref', 'p', { requiredForCapability: null, relatedCapabilities: ['teach'] })] })), '4 deterministic output');
ok(assembler.classify(item('x', 1), { capabilityId: 'teach' }) === 'REQUIRED', '5 intent classification');
ok(compile({ domainContext: [item('ed', 1, { domainId: 'education' }), item('auto', 2, { domainId: 'automotive' })] }, { domains: ['education'] }).domainInstructions.length === 1, '6 domain selection');
ok(assembler.assemble(base({ sessionContext: [item('s', 1)], globalRules: [item('g', 1)] })).items[0].source === 'session', '7 session context priority');
ok(compile({ memory: [item('memory', 1)] }).requiredFacts.some(function (x) { return x.key === 'memory'; }), '8 relevant memory included');
ok(!JSON.stringify(compile({ memory: [item('unrelated', 1, { requiredForCapability: null })] })).includes('unrelated'), '9 irrelevant memory excluded');
ok(assembler.assemble(base({ globalRules: [item('yes', 1), item('no', 2, { requiredForCapability: null })] })).items.length === 1, '10 minimal-context behaviour');
var budgetPkg = compile({ globalRules: [item('r', 'required')], userPreferences: [item('u', 'useful', { requiredForCapability: null, relatedCapabilities: ['teach'] })] }, { approxBudget: 700 });
ok(budgetPkg._diagnostics.approxBudgetUnit === 'characters', '11 configurable generic budget');
ok(compile({ globalRules: [item('a', 1), item('b', 2)] }, { maxItems: 1 }).requiredFacts.length === 1, '12 max item limit');
ok(assembler.assemble(base({ memory: [item('d', 1), item('d', 1, { provenance: { reference: 'other' } })] })).items.length === 1, '13 semantic deduplication');
var conflict = assembler.assemble(base({ memory: [item('k', 'a'), item('k', 'b')] }));
ok(conflict.items.length === 2 && conflict.conflicts.length === 1, '14 conflicting facts preserved');
ok(pkg.requiredFacts[0].provenance.reference === 'ref-rule' && pkg.requiredFacts[0].provenance.classification === 'REQUIRED', '15 provenance preserved');
var entities = [{ id: 'e1', externalId: 'X', name: 'Alice', aliases: ['Al'], organisationScope: 'o1', permissionScope: 'read', provenance: { reference: 'entity-1' } }];
var reference = { externalId: 'X', organisationScope: 'o1', permissionScope: 'read' };
ok(resolver.resolve(reference, entities).status === 'EXACT_MATCH', '16 exact entity resolution');
ok(resolver.resolve({ alias: 'Al', organisationScope: 'o1', permissionScope: 'read' }, entities).status === 'ALIAS_MATCH', '17 alias resolution');
var twins = [{ id: '1', name: 'Sam', organisationScope: 'o1', permissionScope: 'read' }, { id: '2', name: 'Sam', organisationScope: 'o1', permissionScope: 'read' }];
var possible = resolver.resolve({ name: 'Sam', organisationScope: 'o1', permissionScope: 'read' }, twins);
ok(possible.status === 'POSSIBLE_MATCH', '18 ambiguous entity handling');
ok(possible.candidates.length === 2, '19 possible-match carries all candidates');
ok(possible.entity === null && possible.confidence < 0.5, '20 no weak name-only merge');
ok(assembler.assemble(base({ memory: [item('allowed', 1, { permissionScope: 'read' })] })).items.length === 1, '21 permission allowed');
var denied = assembler.assemble(base({ memory: [item('secret-key', 'DENIED_PAYLOAD', { permissionDecision: 'DENY' })] }));
ok(denied.items.length === 0 && denied.exclusions.counts.FORBIDDEN === 1, '22 permission denied');
var mixed = assembler.assemble(base({ memory: [item('a', 1, { permissionScope: 'read' }), item('b', 2, { permissionScope: 'write' })] }));
ok(mixed.items.length === 1 && mixed.exclusions.counts.FORBIDDEN === 1, '23 mixed permissions');
ok(assembler.assemble(base({ memory: [item('private', 'hidden', { private: true })] })).items.length === 0, '24 private context excluded');
ok(!JSON.stringify(compiler.compile(denied)).includes('DENIED_PAYLOAD'), '25 denied payload absent from package');
ok(assembler.assemble(base({ memoryLimit: 3 })).retrieval.request.limit === 3, '26 retrieval request construction');
ok(assembler.assemble(base({ memory: [] })).retrieval.count === 0, '27 empty memory state');
ok(assembler.assemble(base({ sessionContext: [] })).items.length === 0, '28 empty session state');
ok(compile({}).domainInstructions.length === 0, '29 missing optional domain');
ok(throws(function () { assembler.assemble(null); }), '30 malformed assembler input rejected');
ok(throws(function () { assembler.assemble(base({ memory: ['bad'] })); }), '31 malformed memory entry rejected');
ok(throws(function () { resolver.resolve({ name: 'x' }, []); }), '32 malformed entity reference rejected');
ok(throws(function () { assembler.assemble(base({ permissions: [] })); }), '33 malformed permission structure rejected');
ok(compiler.validatePackage({}).valid === false && throws(function () { compiler.compile({ type: 'AssemblyResult', intent: 'x', items: [{ key: 'x', value: { content: 'provider-shaped' }, source: 'global', classification: 'REQUIRED' }] }); }), '34 package validation failure surfaces');
ok(compile({ globalRules: [item('long', 'x'.repeat(1000))] }, { approxBudget: 10 })._diagnostics.budgetOverflow === true, '35 budget overflow handling recorded');
var trimmed = compile({ globalRules: [item('required', 'r')], userPreferences: [item('useful', 'u', { requiredForCapability: null, relatedCapabilities: ['teach'] })] }, { maxItems: 1 });
ok(trimmed.requiredFacts.length === 1 && trimmed.relevantPreferences.length === 0 && trimmed._diagnostics.trimmed[0].classification === 'USEFUL', '36 trimming drops USEFUL before REQUIRED');
ok(assembler.assemble(base({ memory: [item('related', 1), item('history', 2, { requiredForCapability: null })] })).items.length === 1, '37 no full-history dump');
var providerKeys = ['messages', 'system', 'role', 'content', 'max_tokens', 'stop_sequences', 'candidates', 'parts', 'choices', 'completion'];
function noProviderShape(value) { var found = false; (function walk(v) { if (!v || typeof v !== 'object') return; Object.keys(v).forEach(function (k) { if (providerKeys.indexOf(k) !== -1) found = true; walk(v[k]); }); })(value); return !found; }
ok(noProviderShape(pkg), '38 no provider-specific field names');
ok(!Object.prototype.hasOwnProperty.call(pkg, 'messages'), '39 no OpenAI-shaped output');
ok(!Object.prototype.hasOwnProperty.call(pkg, 'system'), '40 no Claude-shaped output');
ok(!Object.prototype.hasOwnProperty.call(pkg, 'candidates'), '41 no Gemini-shaped output');
ok(!Object.prototype.hasOwnProperty.call(pkg, 'completion'), '42 no DeepSeek-shaped output');
ok(!Object.prototype.hasOwnProperty.call(pkg, 'max_tokens'), '43 no Codex-shaped output');
var safePkg = compile({ globalRules: [item('safe', 'ordinary')] });
ok(!/credential|environment dump|api[_-]?key/i.test(JSON.stringify(safePkg)), '44 no credentials or environment dump');
ok(JSON.stringify(compile({ globalRules: [item('stable', 1)] }).requiredFacts[0].provenance) === JSON.stringify(compile({ globalRules: [item('stable', 1)] }).requiredFacts[0].provenance), '45 stable provenance references');
ok(assembler.assemble(base({ memory: [item('a', 1, { provenance: { reference: 'same' } }), item('b', 2, { provenance: { reference: 'same' } })] })).items.length === 2, '46 duplicate source references safe');
ok(compile({ domainContext: [item('e', 1, { domainId: 'education' }), item('a', 2, { domainId: 'automotive' })] }, { domains: ['education', 'automotive'] }).domainInstructions.length === 2, '47 multi-domain request');
ok(compile({ domainContext: [item('e', 1, { domainId: 'education' }), item('a', 2, { domainId: 'automotive' })] }, { domains: ['education'] }).domainInstructions.length === 1, '48 single-domain request');
ok(assembler.retrieveRelevantMemory({ userId: 'u1', organisationId: 'o1', task: { capabilityId: 'teach' }, memoryStore: [{ scope: 'user', userId: 'u2', organisationId: 'o2', relatedCapabilities: ['teach'] }] }).length === 0, '49 cross-project context isolation');
var legacy = assembler.assembleContext({ task: { capabilityId: 'teach' }, globalRules: [item('legacy', 1)] });
ok(typeof assembler.classify === 'function' && typeof assembler.retrieveRelevantMemory === 'function' && legacy.requiredFacts[0].key === 'legacy', '50 MPI-0 compatibility exports');

console.log('\nMPI-1 context runtime: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
