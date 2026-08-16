'use strict';
// =====================================================
// Mythos Orchestration Core — provider-independent project memory (Phase 2B)
// projects/mythos-ai-executor/core/memory.js
//
// Durable project knowledge that belongs to MYTHOS, not to any provider
// (vision §4): switching or adding a provider must never lose or require
// rewriting project knowledge. Strictly separated concerns:
//
//   LONG-TERM PROJECT MEMORY   → this module (decisions, architecture, lessons)
//   CURRENT RUNTIME STATE      → core/store.js entities + Phase 1 lib/state.js
//   TASK CONTEXT               → core/context.js (assembled per task)
//   TRANSIENT EXECUTION OUTPUT → per-task stdout/stderr logs
//
// Memory REFUSES secret-shaped content outright (it does not silently
// redact — a secret offered to memory is a caller bug worth failing on).
// Entries are append-oriented: corrections supersede, they do not erase,
// so the history of what was believed remains auditable.
// =====================================================

var domain = require('./domain');
var store = require('./store');
var redact = require('../../mythos-orchestrator/lib/redact');

var CATEGORIES = [
  'identity',           // what the project is
  'architecture',
  'decision',
  'constraint',
  'roadmap',
  'known_issue',
  'completed_work',
  'dependency',
  'integration',
  'lesson',
  'execution_history',
  'agent_outcome'
];

// Category weights bias recall toward durable, load-bearing knowledge.
var CATEGORY_WEIGHT = {
  constraint: 3.0, decision: 2.6, architecture: 2.4, identity: 2.2,
  known_issue: 2.0, dependency: 1.8, integration: 1.8, lesson: 1.6,
  roadmap: 1.4, completed_work: 1.2, execution_history: 1.0, agent_outcome: 1.0
};

var STOPWORDS = ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was',
  'has', 'have', 'not', 'its', 'into', 'per', 'all', 'any', 'can', 'must', 'should'];

function terms(text) {
  return String(text || '').toLowerCase()
    .split(/[^a-z0-9_.-]+/)
    .filter(function (w) { return w.length >= 3 && STOPWORDS.indexOf(w) === -1; });
}

// Records one memory entry. Refuses secrets and unknown categories.
function remember(fields) {
  if (CATEGORIES.indexOf(fields.category) === -1) {
    throw new Error('UNKNOWN_MEMORY_CATEGORY: ' + String(fields.category).slice(0, 40));
  }
  var secretKinds = redact.findSecretKinds(
    String(fields.title || '') + '\n' + String(fields.content || ''));
  if (secretKinds.length) {
    throw new Error('MEMORY_REFUSES_SECRETS: content matches ' + secretKinds.join(', ') +
      ' — credentials never become project memory');
  }
  var entry = domain.createMemoryEntry(fields);
  store.create(entry);
  store.appendEventLine({
    event_type: 'MEMORY_UPDATED', subject_id: entry.id,
    project: entry.project, detail: { category: entry.category, title: entry.title }
  });
  return entry;
}

// Marks an entry superseded by a newer one (append-oriented correction).
function supersede(oldId, fields) {
  var old = store.load('memory_entry', oldId);
  if (!old) throw new Error('NO_SUCH_MEMORY: ' + oldId);
  var next = remember(Object.assign({}, fields, {
    project: fields.project || old.project,
    parent_id: old.id,
    correlation_id: old.correlation_id
  }));
  old.status = 'SUPERSEDED';
  old.metadata.superseded_by = next.id;
  store.save(old);
  return next;
}

function listProject(project) {
  return store.list('memory_entry', function (e) {
    return e.project === project && e.status === 'ACTIVE';
  });
}

// Lexical relevance recall — deterministic and offline by design. Scores
// combine term overlap (title counts double), tag hits, category weight,
// and confidence. Entries below the floor are excluded entirely: recall
// returns nothing rather than padding with noise.
function recall(project, query, opts) {
  opts = opts || {};
  var queryTerms = terms(query);
  var limit = opts.limit || 8;
  var floor = opts.floor === undefined ? 1.0 : opts.floor;
  var scored = listProject(project).map(function (e) {
    var titleTerms = terms(e.title);
    var contentTerms = terms(e.content);
    var tagTerms = (e.tags || []).map(function (t) { return String(t).toLowerCase(); });
    var overlap = 0;
    queryTerms.forEach(function (q) {
      if (titleTerms.indexOf(q) !== -1) overlap += 2;
      if (tagTerms.indexOf(q) !== -1) overlap += 2;
      if (contentTerms.indexOf(q) !== -1) overlap += 1;
    });
    var score = overlap === 0 ? 0
      : overlap * (CATEGORY_WEIGHT[e.category] || 1.0) * (0.5 + e.confidence / 2);
    return { entry: e, score: score };
  }).filter(function (s) { return s.score >= floor; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, limit);
}

module.exports = {
  CATEGORIES: CATEGORIES,
  CATEGORY_WEIGHT: CATEGORY_WEIGHT,
  terms: terms,
  remember: remember,
  supersede: supersede,
  listProject: listProject,
  recall: recall
};
