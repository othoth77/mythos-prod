// =====================================================
// Mythos Personal Intelligence — Personal Learning Engine Reference
// projects/personal-intelligence/reference/learning-engine.js
//
// Illustrative, dependency-free implementation of the learning pipeline in
// docs/MYTHOS_USER_MEMORY_POLICY.md §2-§4:
//   INTERACTION -> OBSERVATION -> CLASSIFICATION -> CANDIDATE PATTERN
//     -> CONFIDENCE -> CONFLICT CHECK -> PERSIST / DISCARD -> AUDIT
//
// STATUS: reference only. In-memory. Not wired into any persistent store.
// Exercised by tests/mpi-0-personal-intelligence-test.js.
// =====================================================
'use strict';

var STATUS = {
  SESSION_OBSERVATION: 'SESSION_OBSERVATION',
  CANDIDATE_PREFERENCE: 'CANDIDATE_PREFERENCE',
  ESTABLISHED_PREFERENCE: 'ESTABLISHED_PREFERENCE',
  EXPLICIT_USER_RULE: 'EXPLICIT_USER_RULE',
  SUPERSEDED: 'SUPERSEDED',
  DISCARDED: 'DISCARDED'
};

// Evidence count thresholds for the reference implementation only — a
// production engine may replace these with a different, better-justified
// method (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md §8 explicitly
// does not mandate bare numeric thresholds).
var CANDIDATE_THRESHOLD = 2;
var ESTABLISHED_THRESHOLD = 4;

// -----------------------------------------------------------------------
// observe(existingPreferences, observation) -> updated preference record
//
// observation: { userId, organisationId, domainId, preferenceKey,
//                 preferenceValueSummary, source, scope }
//
// source === 'EXPLICIT_INSTRUCTION' always yields EXPLICIT_USER_RULE
// immediately, regardless of evidence count (docs/MYTHOS_USER_MEMORY_POLICY.md §4).
// -----------------------------------------------------------------------
function observe(existingPreferences, observation) {
  var now = new Date().toISOString();
  var existing = (existingPreferences || []).find(function (p) {
    return p.userId === observation.userId
      && p.organisationId === observation.organisationId
      && p.preferenceKey === observation.preferenceKey
      && p.status !== STATUS.SUPERSEDED
      && p.status !== STATUS.DISCARDED;
  });

  if (observation.source === 'EXPLICIT_INSTRUCTION') {
    var explicitRecord = {
      preferenceId: observation.preferenceId || ('pref_' + Date.now()),
      userId: observation.userId,
      organisationId: observation.organisationId,
      domainId: observation.domainId || null,
      scope: observation.scope || 'user',
      status: STATUS.EXPLICIT_USER_RULE,
      preferenceKey: observation.preferenceKey,
      preferenceValueSummary: observation.preferenceValueSummary,
      source: observation.source,
      evidenceCount: (existing ? existing.evidenceCount : 0) + 1,
      confidence: 'EXPLICIT',
      firstObservedAt: existing ? existing.firstObservedAt : now,
      lastObservedAt: now,
      supersedesPreferenceId: existing ? existing.preferenceId : null
    };
    if (existing) existing.status = STATUS.SUPERSEDED; // conflict check: newer explicit rule supersedes older record
    return explicitRecord;
  }

  if (!existing) {
    return {
      preferenceId: observation.preferenceId || ('pref_' + Date.now()),
      userId: observation.userId,
      organisationId: observation.organisationId,
      domainId: observation.domainId || null,
      scope: observation.scope || 'user',
      status: STATUS.SESSION_OBSERVATION,
      preferenceKey: observation.preferenceKey,
      preferenceValueSummary: observation.preferenceValueSummary,
      source: observation.source || 'OBSERVATION',
      evidenceCount: 1,
      confidence: 'LOW',
      firstObservedAt: now,
      lastObservedAt: now,
      supersedesPreferenceId: null
    };
  }

  // Conflict check: a materially different value for the same key does not
  // silently accumulate evidence for the old value — it starts a fresh
  // candidate and marks the old one superseded once the new one is established
  // enough to be trusted (kept simple here: immediate supersede on conflict).
  if (existing.preferenceValueSummary !== observation.preferenceValueSummary) {
    existing.status = STATUS.SUPERSEDED;
    return {
      preferenceId: observation.preferenceId || ('pref_' + Date.now()),
      userId: observation.userId,
      organisationId: observation.organisationId,
      domainId: observation.domainId || null,
      scope: observation.scope || 'user',
      status: STATUS.SESSION_OBSERVATION,
      preferenceKey: observation.preferenceKey,
      preferenceValueSummary: observation.preferenceValueSummary,
      source: observation.source || 'OBSERVATION',
      evidenceCount: 1,
      confidence: 'LOW',
      firstObservedAt: now,
      lastObservedAt: now,
      supersedesPreferenceId: existing.preferenceId
    };
  }

  existing.evidenceCount += 1;
  existing.lastObservedAt = now;
  if (existing.evidenceCount >= ESTABLISHED_THRESHOLD) {
    existing.status = STATUS.ESTABLISHED_PREFERENCE;
    existing.confidence = 'HIGH';
  } else if (existing.evidenceCount >= CANDIDATE_THRESHOLD) {
    existing.status = STATUS.CANDIDATE_PREFERENCE;
    existing.confidence = 'MEDIUM';
  }
  return existing;
}

module.exports = {
  STATUS: STATUS,
  CANDIDATE_THRESHOLD: CANDIDATE_THRESHOLD,
  ESTABLISHED_THRESHOLD: ESTABLISHED_THRESHOLD,
  observe: observe
};
