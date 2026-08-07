'use strict';
// =====================================================
// MYTHOS — Stage MPI-0 automated tests
// tests/mpi-0-personal-intelligence-test.js
//
// Validates the Personal Intelligence Foundation reference implementation
// in projects/personal-intelligence/reference/ against the architecture
// documented in docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md,
// docs/MYTHOS_USER_MEMORY_POLICY.md, docs/MYTHOS_CONTEXT_ARCHITECTURE.md,
// docs/MYTHOS_AI_MULTI_TENANCY.md, and docs/MYTHOS_CHATBOT_ARCHITECTURE.md.
//
// This is a reference-implementation test, not a production integration
// test — no database, no HTTP, no persistence.
//
// Run with: node tests/mpi-0-personal-intelligence-test.js
// =====================================================

var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var scope = require(path.join(BASE, 'projects/personal-intelligence/reference/scope.js'));
var ctxAssembler = require(path.join(BASE, 'projects/personal-intelligence/reference/context-assembler.js'));
var learning = require(path.join(BASE, 'projects/personal-intelligence/reference/learning-engine.js'));
var guard = require(path.join(BASE, 'projects/personal-intelligence/reference/guard.js'));
var intent = require(path.join(BASE, 'projects/personal-intelligence/reference/intent-router.js'));

// ─────────────────────────────────────────────────────────────────────────
console.log('\n1. USER ISOLATION');
(function () {
  var store = [
    { scope: 'user', userId: 'teacherA', organisationId: 'orgX', key: 'answer_key_style', value: 'concise' },
    { scope: 'user', userId: 'teacherB', organisationId: 'orgX', key: 'answer_key_style', value: 'detailed' }
  ];
  var visibleToA = scope.filterByScope(store, { userId: 'teacherA', organisationId: 'orgX' });
  var visibleToB = scope.filterByScope(store, { userId: 'teacherB', organisationId: 'orgX' });
  ok(visibleToA.length === 1 && visibleToA[0].value === 'concise', 'Teacher A sees only their own preference');
  ok(visibleToB.length === 1 && visibleToB[0].value === 'detailed', 'Teacher B sees only their own preference');
  ok(visibleToA[0].value !== visibleToB[0].value, 'Teacher A preference does not affect Teacher B');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n2. ORGANISATION ISOLATION');
(function () {
  var store = [
    { scope: 'organisation', organisationId: 'workshopA', key: 'pricing_policy', value: 'standard' },
    { scope: 'organisation', organisationId: 'workshopB', key: 'pricing_policy', value: 'premium' }
  ];
  var visibleToA = scope.filterByScope(store, { userId: 'u1', organisationId: 'workshopA' });
  var visibleToB = scope.filterByScope(store, { userId: 'u2', organisationId: 'workshopB' });
  ok(visibleToA.length === 1 && visibleToA[0].value === 'standard', 'Workshop A sees only its own organisation knowledge');
  ok(visibleToB.length === 1 && visibleToB[0].value === 'premium', 'Workshop B sees only its own organisation knowledge');
  ok(visibleToA[0].value !== visibleToB[0].value, 'Workshop A knowledge does not leak to Workshop B');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n3. ROLE ISOLATION (same organisation, different roles/permissions)');
(function () {
  var userAdmin = guard.evaluate({ permissionDecision: 'ALLOW', capabilityId: 'invoice.prepare' });
  var userReadOnly = guard.evaluate({ permissionDecision: 'READ_ONLY', capabilityId: 'invoice.prepare' });
  ok(userAdmin === 'ALLOW', 'Admin-role user in an organisation receives ALLOW for invoice.prepare');
  ok(userReadOnly === 'READ_ONLY', 'Read-only-role user in the SAME organisation receives READ_ONLY for the same capability');
  ok(userAdmin !== userReadOnly, 'Two users in the same organisation can receive different permission decisions');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n4. PERSONALISATION — two teachers, shared skill, different context');
(function () {
  var base = {
    task: { capabilityId: 'assessment.prepare' },
    globalRules: [{ requiredForCapability: 'assessment.prepare', key: 'global.formatting_rules' }],
    domainContext: [{ requiredForCapability: 'assessment.prepare', key: 'education.assessment_shape' }]
  };
  var pkgA = ctxAssembler.assembleContext(Object.assign({}, base, {
    userPreferences: [{ relatedCapabilities: ['assessment.prepare'], key: 'difficulty', value: 'easier' }]
  }));
  var pkgB = ctxAssembler.assembleContext(Object.assign({}, base, {
    userPreferences: [{ relatedCapabilities: ['assessment.prepare'], key: 'difficulty', value: 'harder' }]
  }));
  ok(pkgA.relevantPreferences[0].value === 'easier', 'Teacher A context package carries Teacher A preference');
  ok(pkgB.relevantPreferences[0].value === 'harder', 'Teacher B context package carries Teacher B preference');
  ok(pkgA.domainInstructions.length === pkgB.domainInstructions.length, 'Both share the same underlying domain instructions');
})();

console.log('\n4b. PERSONALISATION — two workshop users, shared skill, distinct workflow');
(function () {
  var pkgUser1 = ctxAssembler.assembleContext({
    task: { capabilityId: 'estimate.prepare' },
    organisationContext: [{ requiredForCapability: 'estimate.prepare', key: 'pricing_policy', value: 'workshopA-standard' }],
    userPreferences: [{ relatedCapabilities: ['estimate.prepare'], key: 'workflow', value: 'estimate_after_diagnostic' }]
  });
  var pkgUser2 = ctxAssembler.assembleContext({
    task: { capabilityId: 'estimate.prepare' },
    organisationContext: [{ requiredForCapability: 'estimate.prepare', key: 'pricing_policy', value: 'workshopB-premium' }],
    userPreferences: [{ relatedCapabilities: ['estimate.prepare'], key: 'workflow', value: 'estimate_on_request' }]
  });
  ok(pkgUser1.organisationRules[0].value === 'workshopA-standard', 'Workshop A user gets Workshop A pricing policy');
  ok(pkgUser2.organisationRules[0].value === 'workshopB-premium', 'Workshop B user gets Workshop B pricing policy');
  ok(pkgUser1.relevantPreferences[0].value !== pkgUser2.relevantPreferences[0].value, 'Distinct workflow preferences produce distinct context packages');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n5. SESSION — temporary instruction does not become permanent preference');
(function () {
  var precedence = scope.resolveByPrecedence({
    current_explicit_user_instruction: 'answer_in_french_this_turn',
    established_user_preference: 'answer_in_arabic'
  });
  ok(precedence.key === 'current_explicit_user_instruction', 'This-turn instruction outranks established preference for THIS turn');
  // Simulate a single session-scoped observation — must NOT be classified as a candidate/established preference.
  var observation = learning.observe([], {
    userId: 'teacherA', organisationId: 'orgX', preferenceKey: 'session_language', preferenceValueSummary: 'fr', source: 'OBSERVATION'
  });
  ok(observation.status === learning.STATUS.SESSION_OBSERVATION, 'A single observation stays SESSION_OBSERVATION, never becomes a permanent preference automatically');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n6. LEARNING — observation to candidate to established; explicit rule supersedes');
(function () {
  var records = [];
  var r1 = learning.observe(records, { userId: 'u1', organisationId: 'orgX', preferenceKey: 'k', preferenceValueSummary: 'v1', source: 'OBSERVATION' });
  records.push(r1);
  ok(r1.status === learning.STATUS.SESSION_OBSERVATION, 'First occurrence -> SESSION_OBSERVATION');

  var r2 = learning.observe(records, { userId: 'u1', organisationId: 'orgX', preferenceKey: 'k', preferenceValueSummary: 'v1', source: 'OBSERVATION' });
  ok(r2.status === learning.STATUS.CANDIDATE_PREFERENCE, 'Repeated compatible behaviour -> CANDIDATE_PREFERENCE');

  var r3 = learning.observe(records, { userId: 'u1', organisationId: 'orgX', preferenceKey: 'k', preferenceValueSummary: 'v1', source: 'OBSERVATION' });
  var r4 = learning.observe(records, { userId: 'u1', organisationId: 'orgX', preferenceKey: 'k', preferenceValueSummary: 'v1', source: 'OBSERVATION' });
  ok(r4.status === learning.STATUS.ESTABLISHED_PREFERENCE, 'Sufficiently repeated consistent behaviour -> ESTABLISHED_PREFERENCE');

  var explicit = learning.observe(records, { userId: 'u1', organisationId: 'orgX', preferenceKey: 'k', preferenceValueSummary: 'v2', source: 'EXPLICIT_INSTRUCTION' });
  ok(explicit.status === learning.STATUS.EXPLICIT_USER_RULE, 'Explicit user instruction -> EXPLICIT_USER_RULE immediately');
  ok(r4.status === learning.STATUS.SUPERSEDED, 'Conflicting newer explicit rule supersedes the older established preference');
  ok(explicit.supersedesPreferenceId === r4.preferenceId, 'Explicit rule records what it superseded, for audit');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n7. PERMISSION — preference cannot grant access; learning cannot elevate automation level');
(function () {
  var deny = guard.evaluate({ permissionDecision: 'DENY', capabilityId: 'invoice.prepare', learnedPreferenceRequestsLevel: 'ALLOW' });
  ok(deny === 'DENY', 'A learned preference requesting ALLOW cannot override an existing DENY');

  var boundary = guard.evaluate({ permissionDecision: 'ALLOW', capabilityId: 'estimate.commit', learnedPreferenceRequestsLevel: 'ALLOW' });
  ok(boundary === 'REQUIRE_APPROVAL', 'A permanent-boundary capability stays REQUIRE_APPROVAL even if permission and preference both request ALLOW');

  var narrow = guard.evaluate({ permissionDecision: 'ALLOW', capabilityId: 'assessment.prepare', learnedPreferenceRequestsLevel: 'DRY_RUN_ONLY' });
  ok(narrow === 'DRY_RUN_ONLY', 'A learned preference MAY narrow an ALLOW to DRY_RUN_ONLY (never widen)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n8. MEMORY — relevant retrieved, irrelevant excluded, forbidden excluded');
(function () {
  var memoryStore = [
    { scope: 'user', userId: 'u1', organisationId: 'orgX', relatedCapabilities: ['assessment.prepare'], lastObservedAt: '2026-08-01T00:00:00Z', key: 'relevant_item' },
    { scope: 'user', userId: 'u1', organisationId: 'orgX', relatedCapabilities: ['invoice.prepare'], lastObservedAt: '2026-08-02T00:00:00Z', key: 'irrelevant_item' },
    { scope: 'user', userId: 'u2', organisationId: 'orgX', relatedCapabilities: ['assessment.prepare'], lastObservedAt: '2026-08-03T00:00:00Z', key: 'other_user_item' }
  ];
  var retrieved = ctxAssembler.retrieveRelevantMemory({
    userId: 'u1', organisationId: 'orgX', task: { capabilityId: 'assessment.prepare' }, memoryStore: memoryStore
  });
  ok(retrieved.length === 1 && retrieved[0].key === 'relevant_item', 'Only relevant, in-scope memory is retrieved');

  var pkg = ctxAssembler.assembleContext({
    task: { capabilityId: 'assessment.prepare' },
    memory: [
      { requiredForCapability: 'assessment.prepare', key: 'allowed_fact' },
      { forbidden: true, key: 'private_document_content' }
    ]
  });
  ok(pkg.requiredFacts.some(function (f) { return f.key === 'allowed_fact'; }), 'Allowed required memory fact is included');
  ok(!pkg.requiredFacts.some(function (f) { return f.key === 'private_document_content'; }), 'FORBIDDEN memory item is excluded regardless of relevance');
  ok(pkg._stats.excludedForbiddenCount === 1, 'Forbidden exclusion is explicitly counted');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n9. CONTEXT COMPRESSION — only required/useful context enters the package');
(function () {
  var pkg = ctxAssembler.assembleContext({
    task: { capabilityId: 'estimate.prepare' },
    globalRules: [{ requiredForCapability: 'estimate.prepare', key: 'req1' }],
    domainContext: [{ relatedCapabilities: ['estimate.prepare'], key: 'useful1' }],
    organisationContext: [{ key: 'unrelated_org_fact' }], // no relation to current task -> IRRELEVANT
    userPreferences: [{ key: 'unrelated_pref' }]
  });
  var totalIncluded = pkg._stats.requiredCount + pkg._stats.usefulCount;
  ok(pkg._stats.requiredCount === 1, 'Exactly the required item is classified REQUIRED');
  ok(pkg._stats.usefulCount === 1, 'Exactly the related item is classified USEFUL');
  ok(pkg._stats.excludedIrrelevantCount === 2, 'Unrelated items are excluded as IRRELEVANT, not silently included');
  ok(totalIncluded < 4, 'Total included context is smaller than the full candidate set (compression, not a dump)');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n10. INTENT — Arabic, Tunisian Arabic, French, English, mixed');
(function () {
  ok(intent.detectLanguageFamily('اعمللي فرض جديد') === 'ar', 'Standard Arabic script detected as ar');
  ok(intent.detectLanguageFamily('3andi devoir barcha sa3eb') === 'ar-TN', 'Tunisian Arabic (Latin script / Arabizi) detected as ar-TN');
  ok(intent.detectLanguageFamily('Peux-tu préparer le devoir') === 'fr', 'French detected as fr');
  ok(intent.detectLanguageFamily('Please prepare the homework') === 'en', 'English detected as en');
  ok(intent.detectLanguageFamily('اعمللي devoir كيف المرة الي فاتت') === 'ar-fr-mixed', 'Mixed Arabic/French detected as ar-fr-mixed');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n11. DOMAIN ROUTING — teacher vs workshop requests');
(function () {
  var teacherResult = intent.normalizeIntent({ text: 'اعمللي devoir سهل', availableDomainIds: ['education', 'automotive_workshop'] });
  ok(teacherResult.hintedDomainId === 'education', 'Teacher-style request hints the education domain');

  var workshopResult = intent.normalizeIntent({ text: 'حضّرلي devis للسيارة', availableDomainIds: ['education', 'automotive_workshop'] });
  ok(workshopResult.hintedDomainId === 'automotive_workshop', 'Workshop-style request hints the automotive_workshop domain');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n12. CROSS-DOMAIN — user with multiple permitted domains resolves active domain safely');
(function () {
  var singleDomainUser = intent.resolveActiveDomain(['education'], null);
  ok(singleDomainUser.domainId === 'education', 'A user with exactly one available domain resolves to it without needing a hint');

  var multiDomainUserNoHint = intent.resolveActiveDomain(['education', 'automotive_workshop'], null);
  ok(multiDomainUserNoHint.domainId === null && multiDomainUserNoHint.reason === 'AMBIGUOUS_MULTIPLE_DOMAINS_REQUIRE_DISAMBIGUATION',
    'A user with multiple available domains and no hint does NOT guess a domain — never fabricates false confidence');

  var multiDomainUserWithHint = intent.resolveActiveDomain(['education', 'automotive_workshop'], 'automotive_workshop');
  ok(multiDomainUserWithHint.domainId === 'automotive_workshop', 'A user with multiple available domains resolves correctly once a valid hint is present');

  var unauthorisedHint = intent.resolveActiveDomain(['education'], 'automotive_workshop');
  ok(unauthorisedHint.domainId === null, 'A hinted domain the user is NOT permitted for is never selected');
})();

// ─────────────────────────────────────────────────────────────────────────
console.log('\n13. PRECEDENCE — permission/policy always outranks preference');
(function () {
  var resolved = scope.resolveByPrecedence({
    established_user_preference: 'preferred_answer',
    current_role_permissions: 'permitted_answer'
  });
  ok(resolved.key === 'current_role_permissions', 'Role/permissions outrank an established user preference when both are present');
  ok(scope.PRECEDENCE_ORDER.indexOf('current_role_permissions') < scope.PRECEDENCE_ORDER.indexOf('established_user_preference'),
    'Permission precedence is structurally higher than preference precedence');
})();

console.log('\nStage MPI-0: ' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
process.exit(0);
