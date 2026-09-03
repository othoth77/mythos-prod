// =====================================================
// MYTHOS STATUS CENTER — canonical data model
// projects/status-center/lib/model.js
//
// Fixed vocabularies, stable-ID rules and validation for the
// machine-readable status model consumed by the review engine and by
// sites/status.mythosprod.xyz. READ-ONLY with respect to the rest of
// the repository: nothing in this module writes anywhere.
// =====================================================
'use strict';

// Fixed status vocabulary — the ONLY allowed status values (§6 of the order).
const STATUS = Object.freeze([
  'DONE',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'OWNER_ACTION',
  'NOT_STARTED',
  'DEFERRED',
  'SUPERSEDED',
  'NOT_VERIFIED'
]);

// Maturity ladder — architecture never implies implementation, etc. (§0.10).
const MATURITY = Object.freeze([
  'IDEA',
  'ARCHITECTURE_DEFINED',
  'REFERENCE_IMPLEMENTED',
  'RUNTIME_IMPLEMENTED',
  'TESTED',
  'INTEGRATED',
  'DEPLOYED',
  'EXTERNALLY_CONNECTED',
  'PRODUCTION_VERIFIED'
]);

// Evidence types (§7).
const EVIDENCE_TYPE = Object.freeze([
  'repository', 'commit', 'pr', 'issue', 'file', 'test', 'ci',
  'deployment', 'dns', 'vps', 'operator-report', 'external', 'document'
]);

// Document reconciliation classes (§8).
const DOC_CLASS = Object.freeze([
  'CURRENT', 'HISTORICAL', 'SUPERSEDED', 'CONFLICTING', 'UNVERIFIED'
]);

// Repository/project discovery classes (§32).
const DISCOVERY_CLASS = Object.freeze([
  'ACTIVE', 'FOUNDATION', 'OWNER_DIRECTION', 'FUTURE_CONCEPT',
  'ARCHIVED', 'UNKNOWN', 'NEW_DISCOVERY'
]);

// Priorities for blockers / next actions.
const PRIORITY = Object.freeze(['P0', 'P1', 'P2', 'P3']);

// How a displayed number was obtained (§11 of the first order):
// a number must never look measured when it is not.
const FIGURE_BASIS = Object.freeze([
  'ACTUAL', 'CALCULATED', 'ESTIMATED', 'NOT_AVAILABLE', 'NOT_CALCULABLE'
]);

const ID_RULES = Object.freeze({
  project: /^PROJECT-[A-Z0-9-]+$/,
  track: /^TRACK-[A-Z0-9-]+$/,
  stage: /^STAGE-[A-Z0-9-]+$/,
  milestone: /^MS-\d{4}-\d{2}-\d{2}-[A-Z0-9-]+$/,
  blocker: /^BLOCKER-[A-Z0-9-]+$/,
  ownerAction: /^ACTION-[A-Z0-9-]+$/,
  nextAction: /^NEXT-[A-Z0-9-]+$/,
  evidence: /^EV-[A-Z0-9-]+$/,
  review: /^REVIEW-\d{4}-\d{2}-\d{2}-\d{3}$/,
  repository: /^REPO-[A-Z0-9-]+$/
});

function isStatus(v) { return STATUS.indexOf(v) !== -1; }
function isMaturity(v) { return MATURITY.indexOf(v) !== -1; }
function isPriority(v) { return PRIORITY.indexOf(v) !== -1; }
function isFigureBasis(v) { return FIGURE_BASIS.indexOf(v) !== -1; }
function isDocClass(v) { return DOC_CLASS.indexOf(v) !== -1; }
function isDiscoveryClass(v) { return DISCOVERY_CLASS.indexOf(v) !== -1; }
function isEvidenceType(v) { return EVIDENCE_TYPE.indexOf(v) !== -1; }

function idKind(id) {
  const kinds = Object.keys(ID_RULES);
  for (let i = 0; i < kinds.length; i++) {
    if (ID_RULES[kinds[i]].test(id)) return kinds[i];
  }
  return null;
}

// A percentage in the model is either a number 0..100 with a basis that
// explains it, or the literal string 'NOT_CALCULABLE'. Never invented.
function validPercent(p) {
  if (p === 'NOT_CALCULABLE') return true;
  return typeof p === 'number' && p >= 0 && p <= 100;
}

// ---------------------------------------------------------------------
// Registry validation. The registry is the curated, evidence-based
// inventory (projects, tracks, blockers, owner actions, milestones,
// do-not-reopen). The engine refuses to run on an invalid registry —
// fail closed, never render fabricated state.
// ---------------------------------------------------------------------
function validateRegistry(reg) {
  const errors = [];
  const seen = Object.create(null);

  function need(cond, msg) { if (!cond) errors.push(msg); }
  function uniqueId(id, where) {
    if (seen[id]) errors.push('duplicate id ' + id + ' (' + where + ')');
    seen[id] = true;
  }

  need(reg && typeof reg === 'object', 'registry is not an object');
  if (!reg || typeof reg !== 'object') return errors;

  function arr(v) { return Array.isArray(v) ? v : []; }

  need(Array.isArray(reg.projects), 'registry.projects missing');
  need(Array.isArray(reg.tracks), 'registry.tracks missing');
  need(Array.isArray(reg.blockers), 'registry.blockers missing');
  need(Array.isArray(reg.owner_actions), 'registry.owner_actions missing');
  need(Array.isArray(reg.next_actions), 'registry.next_actions missing');
  need(Array.isArray(reg.milestones), 'registry.milestones missing');
  need(Array.isArray(reg.evidence), 'registry.evidence missing');
  need(Array.isArray(reg.repositories), 'registry.repositories missing');
  need(Array.isArray(reg.do_not_reopen), 'registry.do_not_reopen missing');
  need(Array.isArray(reg.documents), 'registry.documents missing');

  const evidenceIds = Object.create(null);
  arr(reg.evidence).forEach(function (ev, i) {
    need(ID_RULES.evidence.test(ev.id || ''), 'evidence[' + i + '] bad id: ' + ev.id);
    uniqueId(ev.id, 'evidence');
    evidenceIds[ev.id] = true;
    need(isEvidenceType(ev.type), 'evidence ' + ev.id + ' bad type: ' + ev.type);
    need(typeof ev.reference === 'string' && ev.reference.length > 0,
      'evidence ' + ev.id + ' missing reference');
  });

  function checkEvidenceRefs(item, where) {
    const refs = item.evidence || [];
    refs.forEach(function (ref) {
      if (!evidenceIds[ref]) errors.push(where + ' references unknown evidence ' + ref);
    });
  }

  arr(reg.repositories).forEach(function (r, i) {
    need(ID_RULES.repository.test(r.id || ''), 'repositories[' + i + '] bad id: ' + r.id);
    uniqueId(r.id, 'repositories');
    need(isDiscoveryClass(r.classification), 'repo ' + r.id + ' bad classification: ' + r.classification);
    need(typeof r.full_name === 'string' && r.full_name.indexOf('/') > 0,
      'repo ' + r.id + ' bad full_name');
  });

  arr(reg.projects).forEach(function (p, i) {
    need(ID_RULES.project.test(p.id || ''), 'projects[' + i + '] bad id: ' + p.id);
    uniqueId(p.id, 'projects');
    need(isStatus(p.status), 'project ' + p.id + ' bad status: ' + p.status);
    need(isMaturity(p.maturity), 'project ' + p.id + ' bad maturity: ' + p.maturity);
    need(typeof p.name === 'string' && p.name.length > 0, 'project ' + p.id + ' missing name');
    need(typeof p.purpose === 'string' && p.purpose.length > 0, 'project ' + p.id + ' missing purpose');
    if (p.directories !== undefined) {
      need(Array.isArray(p.directories) && p.directories.every(function (d) {
        return typeof d === 'string' && /^projects\//.test(d);
      }), 'project ' + p.id + ' bad directories (must be an array of "projects/..." paths)');
    }
    checkEvidenceRefs(p, 'project ' + p.id);
    (p.dimensions ? Object.keys(p.dimensions) : []).forEach(function (k) {
      const d = p.dimensions[k];
      need(validPercent(d.percent) || d.percent === undefined,
        'project ' + p.id + ' dimension ' + k + ' bad percent');
      if (d.percent !== undefined && d.percent !== 'NOT_CALCULABLE') {
        need(isFigureBasis(d.basis) && d.basis !== 'NOT_AVAILABLE',
          'project ' + p.id + ' dimension ' + k + ' numeric percent requires basis');
      }
      if (d.status !== undefined) {
        need(isStatus(d.status), 'project ' + p.id + ' dimension ' + k + ' bad status');
      }
    });
  });

  arr(reg.tracks).forEach(function (t, i) {
    need(ID_RULES.track.test(t.id || ''), 'tracks[' + i + '] bad id: ' + t.id);
    uniqueId(t.id, 'tracks');
    (t.stages || []).forEach(function (s) {
      need(typeof s.id === 'string' && s.id.length > 0, 'track ' + t.id + ' stage missing id');
      need(isStatus(s.status), 'track ' + t.id + ' stage ' + s.id + ' bad status: ' + s.status);
      checkEvidenceRefs(s, 'stage ' + s.id);
    });
  });

  arr(reg.blockers).forEach(function (b, i) {
    need(ID_RULES.blocker.test(b.id || ''), 'blockers[' + i + '] bad id: ' + b.id);
    uniqueId(b.id, 'blockers');
    need(isStatus(b.status), 'blocker ' + b.id + ' bad status: ' + b.status);
    need(isPriority(b.priority), 'blocker ' + b.id + ' bad priority: ' + b.priority);
    need(typeof b.owner === 'string' && b.owner.length > 0, 'blocker ' + b.id + ' missing owner');
    need(typeof b.unblock === 'string' && b.unblock.length > 0,
      'blocker ' + b.id + ' missing unblock procedure');
    checkEvidenceRefs(b, 'blocker ' + b.id);
  });

  arr(reg.owner_actions).forEach(function (a, i) {
    need(ID_RULES.ownerAction.test(a.id || ''), 'owner_actions[' + i + '] bad id: ' + a.id);
    uniqueId(a.id, 'owner_actions');
    need(isStatus(a.status), 'owner action ' + a.id + ' bad status: ' + a.status);
    need(typeof a.what === 'string' && a.what.length > 0, 'owner action ' + a.id + ' missing what');
    need(typeof a.why === 'string' && a.why.length > 0, 'owner action ' + a.id + ' missing why');
  });

  arr(reg.next_actions).forEach(function (a, i) {
    need(ID_RULES.nextAction.test(a.id || ''), 'next_actions[' + i + '] bad id: ' + a.id);
    uniqueId(a.id, 'next_actions');
    need(isPriority(a.priority), 'next action ' + a.id + ' bad priority: ' + a.priority);
  });

  arr(reg.milestones).forEach(function (m, i) {
    need(ID_RULES.milestone.test(m.id || ''), 'milestones[' + i + '] bad id: ' + m.id);
    uniqueId(m.id, 'milestones');
    need(/^\d{4}-\d{2}-\d{2}$/.test(m.date || ''), 'milestone ' + m.id + ' bad date: ' + m.date);
    need(typeof m.title === 'string' && m.title.length > 0, 'milestone ' + m.id + ' missing title');
    checkEvidenceRefs(m, 'milestone ' + m.id);
  });

  arr(reg.documents).forEach(function (d, i) {
    need(typeof d.path === 'string' && d.path.length > 0, 'documents[' + i + '] missing path');
    need(isDocClass(d.classification), 'document ' + d.path + ' bad classification: ' + d.classification);
  });

  arr(reg.do_not_reopen).forEach(function (d, i) {
    need(typeof d.item === 'string' && d.item.length > 0, 'do_not_reopen[' + i + '] missing item');
    checkEvidenceRefs(d, 'do_not_reopen[' + i + ']');
  });

  return errors;
}

module.exports = {
  STATUS: STATUS,
  MATURITY: MATURITY,
  EVIDENCE_TYPE: EVIDENCE_TYPE,
  DOC_CLASS: DOC_CLASS,
  DISCOVERY_CLASS: DISCOVERY_CLASS,
  PRIORITY: PRIORITY,
  FIGURE_BASIS: FIGURE_BASIS,
  ID_RULES: ID_RULES,
  isStatus: isStatus,
  isMaturity: isMaturity,
  isPriority: isPriority,
  isFigureBasis: isFigureBasis,
  isDocClass: isDocClass,
  isDiscoveryClass: isDiscoveryClass,
  isEvidenceType: isEvidenceType,
  idKind: idKind,
  validPercent: validPercent,
  validateRegistry: validateRegistry
};
