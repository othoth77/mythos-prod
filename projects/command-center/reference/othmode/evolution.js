'use strict';
// =====================================================
// OTHMODE — Evolution layer (memory, events, signals, selector, review,
// validation, rollback)
// projects/command-center/reference/othmode/evolution.js
//
// Implements docs/othmode/OTHMODE_EVOLUTION.md. Controlled evolution:
// observable, reviewable, validated, versioned, reversible. There is no
// code path here that modifies skills, tools, prompts, or anything else —
// this layer RECORDS and GATES; applying a change stays a human/Git act.
// No EvoMap dependency of any kind: no hub, no worker pool, no network.
//
// Data model (append-only records in the OTHMODE store):
//   { type:'signal', source, description, dedup_key, disposition }
//   { type:'signal.disposition', signal_id, disposition, rationale }
//   { type:'event', title, gene_type?, risk_tier, trigger, signal_id? }
//   { type:'event.stage', event_id, stage, data, evidence:[sha256] }
//        stages: TRIGGER SIGNAL CANDIDATE SELECTION REVIEW VALIDATION
//                RESULT ROLLBACK
//   { type:'recovery', component, state, step, note }   (health module)
//
// Genes and capsules are VALIDATED ARTIFACTS and therefore live in Git
// (projects/othmode/evolution/{genes,capsules}) — GEP-compatible shapes,
// reviewed like any other change. The store only references them.
// =====================================================

var path = require('path');
var resolve = require('./resolve.js');
var store = require('./store.js');

// ---------------------------------------------------------------------------
// Vocabularies — closed lists, extended only by review.
// ---------------------------------------------------------------------------

var SIGNAL_SOURCES = ['user-feedback', 'repeated-success', 'repeated-failure', 'tool-failure',
  'skill-failure', 'performance', 'project-change', 'github-release', 'oss-change',
  'pypi-npm-change', 'mcp-change', 'manual'];
var DISPOSITIONS = ['NOTED', 'WATCH', 'CANDIDATE'];
var STAGES = ['TRIGGER', 'SIGNAL', 'CANDIDATE', 'SELECTION', 'REVIEW', 'VALIDATION', 'RESULT', 'ROLLBACK'];
var SELECTOR_VERDICTS = ['KEEP', 'EXTEND', 'MERGE', 'REPLACE', 'DEPRECATE', 'CREATE'];
var RISK_TIERS = ['LOW', 'MEDIUM', 'HIGH'];
var REVIEW_DECISIONS = ['APPROVED', 'REJECTED', 'NEEDS_CHANGES'];
var VALIDATION_RESULTS = ['PASS', 'FAIL'];
var GENE_TYPES = ['rule', 'skill-fragment', 'prompt-strategy', 'tool-selection-strategy',
  'workflow-pattern', 'validation-rule', 'routing-strategy'];
var VALIDATION_DIMENSIONS = ['functional', 'regression', 'security', 'compatibility',
  'performance', 'dependencies', 'scope', 'license'];

function vErr(msg) { var e = new Error(msg); e.code = 'OTHMODE_EVOLUTION_INPUT'; return e; }
function requireIn(value, list, label) {
  var v = String(value == null ? '' : value);
  if (list.indexOf(v) === -1) throw vErr(label + ' must be one of: ' + list.join(', '));
  return v;
}
function requireStr(value, label, max) {
  if (typeof value !== 'string' || value.trim() === '') throw vErr(label + ' is required');
  if (value.length > (max || 4000)) throw vErr(label + ' exceeds ' + (max || 4000) + ' characters');
  return value.trim();
}

// ---------------------------------------------------------------------------
// Signals — with dedup and thresholding: one flaky test is never a
// candidate. dedup_key groups repeats; disposition starts NOTED and is
// promoted explicitly, never automatically to CANDIDATE by a single event.
// ---------------------------------------------------------------------------

function recordSignal(input, actor) {
  var source = requireIn(input.source, SIGNAL_SOURCES, 'source');
  var description = requireStr(input.description, 'description', 2000);
  var dedupKey = input.dedup_key ? requireStr(input.dedup_key, 'dedup_key', 200) : (source + ':' + description.slice(0, 80));
  var existing = listSignals().signals.filter(function (s) { return s.dedup_key === dedupKey; });
  var occurrences = existing.length ? existing[0].occurrences + 1 : 1;
  return store.appendRecord('evolution', {
    type: 'signal',
    source: source,
    description: description,
    dedup_key: dedupKey,
    occurrences: occurrences,
    disposition: 'NOTED',
    actor: String(actor || 'unknown')
  });
}

function setDisposition(signalId, disposition, rationale, actor) {
  var d = requireIn(disposition, DISPOSITIONS, 'disposition');
  var found = listSignals().signals.filter(function (s) { return s.id === signalId; })[0];
  if (!found) throw vErr('unknown signal: ' + signalId);
  // Thresholding: promoting a single occurrence straight to CANDIDATE
  // requires an explicit rationale — the record keeps the reviewer honest.
  if (d === 'CANDIDATE' && found.occurrences < 2 && !rationale) {
    throw vErr('a single-occurrence signal needs a rationale to become CANDIDATE');
  }
  return store.appendRecord('evolution', {
    type: 'signal.disposition',
    signal_id: signalId,
    disposition: d,
    rationale: rationale ? requireStr(rationale, 'rationale', 2000) : null,
    actor: String(actor || 'unknown')
  });
}

function listSignals(cap) {
  var res = store.readStream('evolution', cap || store.LINE_CAP_DEFAULT);
  if (!res.provisioned) return { provisioned: false, reason: res.reason, signals: [] };
  var byKey = {};
  var order = [];
  res.rows.forEach(function (r) {
    if (r.type === 'signal') {
      var prev = byKey[r.dedup_key];
      if (!prev) order.push(r.dedup_key);
      byKey[r.dedup_key] = {
        id: r.id, ts: r.ts, source: r.source, description: r.description,
        dedup_key: r.dedup_key, occurrences: r.occurrences || ((prev ? prev.occurrences : 0) + 1),
        disposition: prev ? prev.disposition : 'NOTED', actor: r.actor
      };
    } else if (r.type === 'signal.disposition') {
      Object.keys(byKey).forEach(function (k) {
        if (byKey[k].id === r.signal_id) byKey[k].disposition = r.disposition;
      });
    }
  });
  return {
    provisioned: true,
    signals: order.map(function (k) { return byKey[k]; }).reverse()
  };
}

// ---------------------------------------------------------------------------
// Selector — proposes, never approves. Preference order is structural:
// the first applicable verdict in KEEP→EXTEND→MERGE→REPLACE→DEPRECATE→
// CREATE wins, and Search First evidence pushes away from CREATE.
// ---------------------------------------------------------------------------

function selectorPropose(input) {
  var facts = {
    existing_capability: input.existing_capability === true,
    capability_healthy: input.capability_healthy !== false,
    overlap_with_other: input.overlap_with_other === true,
    external_solution_found: input.external_solution_found === true,
    capability_still_needed: input.capability_still_needed !== false
  };
  var verdict, rationale;
  if (facts.existing_capability && facts.capability_healthy && !input.gap) {
    verdict = 'KEEP'; rationale = 'An existing healthy capability covers the need.';
  } else if (facts.existing_capability && facts.capability_still_needed && input.gap) {
    verdict = 'EXTEND'; rationale = 'The capability exists but has a stated gap — extend it rather than create.';
  } else if (facts.existing_capability && facts.overlap_with_other) {
    verdict = 'MERGE'; rationale = 'Two capabilities overlap — merge before either grows further.';
  } else if (facts.external_solution_found && facts.capability_still_needed) {
    verdict = 'REPLACE'; rationale = 'Search First found a suitable existing solution — adopt it instead of maintaining our own.';
  } else if (facts.existing_capability && !facts.capability_still_needed) {
    verdict = 'DEPRECATE'; rationale = 'The capability no longer serves a need.';
  } else {
    verdict = 'CREATE'; rationale = 'No existing or external capability covers the need. CREATE requires Search First evidence that nothing suitable was found.';
  }
  return { verdict: verdict, rationale: rationale, facts: facts, preference_order: SELECTOR_VERDICTS };
}

// ---------------------------------------------------------------------------
// Events and stages
// ---------------------------------------------------------------------------

function createEvent(input, actor) {
  var title = requireStr(input.title, 'title', 300);
  var tier = requireIn(input.risk_tier, RISK_TIERS, 'risk_tier');
  var geneType = input.gene_type ? requireIn(input.gene_type, GENE_TYPES, 'gene_type') : null;
  var event = store.appendRecord('evolution', {
    type: 'event',
    title: title,
    risk_tier: tier,
    gene_type: geneType,
    trigger: input.trigger ? requireStr(input.trigger, 'trigger', 2000) : null,
    signal_id: input.signal_id || null,
    rollback_point: input.rollback_point || null,
    actor: String(actor || 'unknown')
  });
  store.appendRecord('evolution', {
    type: 'event.stage', event_id: event.id, stage: 'TRIGGER',
    data: { trigger: event.trigger }, evidence: [], actor: event.actor
  });
  if (event.signal_id) {
    store.appendRecord('evolution', {
      type: 'event.stage', event_id: event.id, stage: 'SIGNAL',
      data: { signal_id: event.signal_id }, evidence: [], actor: event.actor
    });
  }
  return event;
}

function addStage(eventId, input, actor, identityRole) {
  var stage = requireIn(input.stage, STAGES, 'stage');
  var event = getEvent(eventId);
  if (!event) throw vErr('unknown event: ' + eventId);
  if (event.terminal) throw vErr('event ' + eventId + ' already reached a terminal RESULT — a correction is a NEW event/version');

  var data = input.data && typeof input.data === 'object' ? input.data : {};
  var evidence = [];
  if (Array.isArray(input.evidence_texts)) {
    input.evidence_texts.slice(0, 10).forEach(function (t) { evidence.push(store.putEvidence(String(t))); });
  }

  if (stage === 'SELECTION') {
    data.verdict = requireIn(data.verdict, SELECTOR_VERDICTS, 'selection verdict');
    // CREATE without recorded Search First evidence is refused — BUILD LAST.
    if (data.verdict === 'CREATE' && evidence.length === 0 && !data.search_first_ref) {
      throw vErr('SELECTION verdict CREATE requires Search First evidence (evidence_texts or search_first_ref)');
    }
  }

  if (stage === 'REVIEW') {
    data.decision = requireIn(data.decision, REVIEW_DECISIONS, 'review decision');
    // THE approval boundary: a HIGH-risk evolution can only be APPROVED by
    // the owner role. The AI can propose at any tier; it can never approve
    // its own high-risk change. MEDIUM requires an authenticated identity
    // acknowledging explicitly.
    if (data.decision === 'APPROVED') {
      if (event.risk_tier === 'HIGH' && identityRole !== 'owner') {
        var e1 = new Error('HIGH-risk evolution approval requires the owner identity');
        e1.code = 'OTHMODE_REVIEW_FORBIDDEN';
        throw e1;
      }
      if (event.risk_tier === 'MEDIUM' && !identityRole) {
        var e2 = new Error('MEDIUM-risk approval requires an authenticated identity (explicit ACK)');
        e2.code = 'OTHMODE_REVIEW_FORBIDDEN';
        throw e2;
      }
    }
  }

  if (stage === 'VALIDATION') {
    data.result = requireIn(data.result, VALIDATION_RESULTS, 'validation result');
    var dims = data.dimensions && typeof data.dimensions === 'object' ? data.dimensions : {};
    Object.keys(dims).forEach(function (k) {
      if (VALIDATION_DIMENSIONS.indexOf(k) === -1) throw vErr('unknown validation dimension: ' + k);
      requireIn(dims[k], VALIDATION_RESULTS, 'dimension ' + k);
    });
    // VALIDATION only runs on an approved event: review gates validation
    // for MEDIUM/HIGH tiers (LOW records an AI review rationale instead).
    if (event.risk_tier !== 'LOW' && event.review_decision !== 'APPROVED') {
      throw vErr('VALIDATION requires an APPROVED review for ' + event.risk_tier + '-risk events');
    }
  }

  if (stage === 'RESULT') {
    data.outcome = requireStr(data.outcome, 'result outcome', 200);
  }

  return store.appendRecord('evolution', {
    type: 'event.stage', event_id: eventId, stage: stage,
    data: data, evidence: evidence, actor: String(actor || 'unknown')
  });
}

// Fold the append-only stream into event views.
function listEvents(cap) {
  var res = store.readStream('evolution', cap || store.LINE_CAP_DEFAULT);
  if (!res.provisioned) return { provisioned: false, reason: res.reason, events: [] };
  var byId = {};
  var order = [];
  res.rows.forEach(function (r) {
    if (r.type === 'event') {
      byId[r.id] = {
        id: r.id, ts: r.ts, title: r.title, risk_tier: r.risk_tier, gene_type: r.gene_type,
        trigger: r.trigger, signal_id: r.signal_id, rollback_point: r.rollback_point,
        actor: r.actor, stages: [], review_decision: null, validation_result: null,
        selection_verdict: null, terminal: false, outcome: null
      };
      order.push(r.id);
    } else if (r.type === 'event.stage' && byId[r.event_id]) {
      var ev = byId[r.event_id];
      ev.stages.push({ stage: r.stage, ts: r.ts, data: r.data || {}, evidence: r.evidence || [], actor: r.actor });
      if (r.stage === 'REVIEW') ev.review_decision = r.data && r.data.decision;
      if (r.stage === 'VALIDATION') ev.validation_result = r.data && r.data.result;
      if (r.stage === 'SELECTION') ev.selection_verdict = r.data && r.data.verdict;
      if (r.stage === 'RESULT') { ev.terminal = true; ev.outcome = r.data && r.data.outcome; }
      if (r.stage === 'ROLLBACK') ev.rolled_back = true;
    }
  });
  return { provisioned: true, events: order.map(function (id) { return byId[id]; }).reverse() };
}

function getEvent(id) {
  var all = listEvents();
  if (!all.provisioned) return null;
  return all.events.filter(function (e) { return e.id === id; })[0] || null;
}

// ---------------------------------------------------------------------------
// Genes and capsules — validated artifacts in Git, read here.
// GEP-compatible: gene.json/capsule.json carry id/type/version/status plus
// evidence and validation references; content lives in a sibling markdown.
// ---------------------------------------------------------------------------

function genesDir() { return resolve.repoPath('projects', 'othmode', 'evolution', 'genes'); }
function capsulesDir() { return resolve.repoPath('projects', 'othmode', 'evolution', 'capsules'); }

function listGenes() {
  return resolve.listDirs(genesDir()).map(function (id) {
    var meta = resolve.readJson(path.join(genesDir(), id, 'gene.json'));
    if (!meta.ok) return { id: id, valid: false, reason: meta.reason };
    var g = meta.data;
    return {
      id: g.id || id, valid: true, type: g.type || null, version: g.version || null,
      status: g.status || 'DRAFT', title: g.title || null,
      origin_event: g.origin_event || null, validation: g.validation || null
    };
  });
}

function geneDetail(id) {
  var safe = String(id).replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe || safe !== String(id)) return null;
  var meta = resolve.readJson(path.join(genesDir(), safe, 'gene.json'));
  if (!meta.ok) return null;
  var body = resolve.readText(path.join(genesDir(), safe, 'gene.md'));
  return { gene: meta.data, body: body.ok ? body.data : null };
}

function listCapsules() {
  return resolve.listDirs(capsulesDir()).map(function (id) {
    var meta = resolve.readJson(path.join(capsulesDir(), id, 'capsule.json'));
    if (!meta.ok) return { id: id, valid: false, reason: meta.reason };
    var c = meta.data;
    // The activation contract: a capsule is ACTIVE only with validation
    // PASS and review APPROVED. Anything else renders as what it is.
    var activatable = c.validation === 'PASS' && c.review === 'APPROVED';
    return {
      id: c.id || id, valid: true, version: c.version || null,
      genes: c.genes || [], validation: c.validation || null, review: c.review || null,
      status: activatable ? (c.status || 'ACTIVE') : 'INACTIVE',
      activatable: activatable, title: c.title || null
    };
  });
}

// ---------------------------------------------------------------------------
// Rollback view — every applied evolution with its rollback point.
// ---------------------------------------------------------------------------

function rollbackView() {
  var all = listEvents();
  if (!all.provisioned) return { provisioned: false, reason: all.reason, entries: [] };
  return {
    provisioned: true,
    entries: all.events.filter(function (e) { return e.rollback_point || e.rolled_back; }).map(function (e) {
      var rollbackStage = e.stages.filter(function (s) { return s.stage === 'ROLLBACK'; })[0] || null;
      return {
        event_id: e.id, title: e.title, rollback_point: e.rollback_point,
        outcome: e.outcome, rolled_back: !!e.rolled_back,
        rollback_detail: rollbackStage ? rollbackStage.data : null
      };
    })
  };
}

module.exports = {
  SIGNAL_SOURCES: SIGNAL_SOURCES,
  DISPOSITIONS: DISPOSITIONS,
  STAGES: STAGES,
  SELECTOR_VERDICTS: SELECTOR_VERDICTS,
  RISK_TIERS: RISK_TIERS,
  REVIEW_DECISIONS: REVIEW_DECISIONS,
  GENE_TYPES: GENE_TYPES,
  VALIDATION_DIMENSIONS: VALIDATION_DIMENSIONS,
  recordSignal: recordSignal,
  setDisposition: setDisposition,
  listSignals: listSignals,
  selectorPropose: selectorPropose,
  createEvent: createEvent,
  addStage: addStage,
  listEvents: listEvents,
  getEvent: getEvent,
  listGenes: listGenes,
  geneDetail: geneDetail,
  listCapsules: listCapsules,
  rollbackView: rollbackView
};
