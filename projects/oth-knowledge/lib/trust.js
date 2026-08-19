// =====================================================
// OTH Knowledge — knowledge trust model (OTH-K3)
// projects/oth-knowledge/lib/trust.js
//
// READ-ONLY derivation over the existing store: assessments are
// computed, never persisted (zero appendRecord calls — the store file
// is byte-identical after any assessment, test-pinned). Confidence is
// never turned into truth: every report carries not_a_truth_value:true,
// a closed non-truth-shaped summary enum, and a trace pointing every
// derived component at the record ids it came from.
//
// asOf is an explicit input everywhere (no wall-clock reads). The
// version assessed is the one selected by the same capture-aware rule
// as temporal.knownAt: the newest version captured on or before asOf,
// else the earliest surviving version — later corrections never leak
// into a point-in-time assessment. Conflict state is likewise derived
// as of asOf from resolution.decided_at, mirroring temporal.losingIds,
// never from the live resolution_state.
//
// Quarantine is sticky: once any version at or before asOf carries a
// quarantine tag ('quarantined' from audit.js, or 'quarantine' from the
// ingest secret-refusal path), the record assesses as quarantined even
// if a later version dropped the tag.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const model = require('./model.js');
const temporal = require('./temporal.js');
const auditLib = require('./audit.js');

const DEFAULT_CONFIG = path.join(__dirname, '..', 'config', 'trust-model.json');

const TIERS = Object.freeze([
  'first-party', 'operator', 'repository-verified', 'imported', 'metadata-only', 'model-output',
]);
// Tiers whose statements never assess as accepted facts: model output
// and bulk imports assert; they do not establish.
const NON_AUTHORITATIVE_TIERS = Object.freeze(['imported', 'metadata-only', 'model-output']);

const STATEMENT_CATEGORIES = Object.freeze([
  'quarantined-assertion', 'user-provided-claim', 'imported-claim',
  'accepted-fact', 'observation', 'event', 'derived',
]);

// Closed, deliberately non-truth-shaped summary vocabulary. 'supported'
// is the ceiling — there is no 'verified', 'confirmed' or 'true' here,
// and no numeric score that could be averaged into a probability.
const SUMMARIES = Object.freeze([
  'quarantined', 'superseded', 'contested', 'unverified-assertion',
  'weakly-supported', 'stale', 'supported',
]);

const ASSESSABLE_KINDS = Object.freeze(['fact', 'claim', 'observation', 'event', 'derived']);
const QUARANTINE_TAGS = ['quarantined', 'quarantine']; // audit.js vs ingest.js secret-refusal spelling

// Substring (not anchored) so composite spellings match too (F7).
const FORBIDDEN_KEY_RE = /(endpoint|url|uri|host|hostname|webhook|key|token|secret|password|passphrase|credential|cookie|session|auth|bearer)/i;
const MAX_STALE_DAYS = 3650;

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function scanForbiddenKeys(obj, where, errors) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_KEY_RE.test(k)) errors.push(where + '.' + k + ': endpoint/credential-shaped keys are rejected by design');
    scanForbiddenKeys(obj[k], where + '.' + k, errors);
  }
}

// Whole-file fail-closed load, closed BOTH WAYS against the source-class
// registry: every registered source class needs a tier, and no entry may
// name an unregistered class. One defect refuses the whole model.
function isObjectMap(v) { // plain or null-prototype object (loadSourceClasses returns the latter)
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function loadTrustModel(configPath, sourceClasses) {
  if (!isObjectMap(sourceClasses) || Object.keys(sourceClasses).length === 0) {
    throw fail('OTHK_TRUST_CONFIG', 'loadTrustModel requires the loaded source-class registry');
  }
  const p = configPath || DEFAULT_CONFIG;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw fail('OTHK_TRUST_CONFIG', 'unreadable trust model: ' + e.message); }
  if (!model.isPlainObject(parsed) || parsed.format !== 'othk-trust-model' || !model.isPlainObject(parsed.classes)) {
    throw fail('OTHK_TRUST_CONFIG', 'invalid trust-model format');
  }
  const errors = [];
  scanForbiddenKeys(parsed, 'root', errors);
  if (errors.length) throw fail('OTHK_TRUST_CONFIG', errors.join('; '));

  const out = Object.create(null);
  for (const name of Object.keys(parsed.classes)) {
    if (!sourceClasses[name]) throw fail('OTHK_TRUST_CONFIG', 'trust model names unregistered source class: ' + name);
    const c = parsed.classes[name];
    if (!model.isPlainObject(c) || TIERS.indexOf(c.tier) === -1) {
      throw fail('OTHK_TRUST_CONFIG', 'class ' + name + ' has invalid tier (must be ' + TIERS.join('/') + ')');
    }
    if (!Number.isInteger(c.stale_after_days) || c.stale_after_days < 1 || c.stale_after_days > MAX_STALE_DAYS) {
      throw fail('OTHK_TRUST_CONFIG', 'class ' + name + ' stale_after_days must be an integer 1..' + MAX_STALE_DAYS);
    }
    out[name] = { tier: c.tier, stale_after_days: c.stale_after_days };
  }
  for (const name of Object.keys(sourceClasses)) {
    if (!out[name]) throw fail('OTHK_TRUST_CONFIG', 'registered source class has no trust tier: ' + name);
  }
  return out;
}

// Version selected by asOf — same rule as temporal.knownAt: newest
// version captured on or before asOf; if every version was captured
// after asOf, the earliest surviving one.
function versionAt(versions, asOf) {
  const live = versions.filter((v) => !v.deleted);
  if (!live.length) return null;
  let chosen = null;
  for (const v of live) {
    const cap = v.record.provenance && v.record.provenance.captured_at;
    if (cap && Date.parse(cap) <= Date.parse(asOf)) chosen = v; // in version order → ends newest qualifying
  }
  return chosen || live[0];
}

// Sticky quarantine over version history ≤ asOf (versions without a
// capture time are included — fail closed, never assumed post-asOf).
function quarantinedAt(versions, asOf) {
  for (const v of versions) {
    const cap = v.record.provenance && v.record.provenance.captured_at;
    if (cap && Date.parse(cap) > Date.parse(asOf)) continue;
    const tags = Array.isArray(v.record.tags) ? v.record.tags : [];
    if (QUARANTINE_TAGS.some((t) => tags.indexOf(t) !== -1)) return true;
  }
  return false;
}

// Conflict view as of asOf, derived from decided_at — never the live
// resolution_state (a conflict resolved after asOf was open at asOf).
function conflictsAt(store, id, asOf) {
  const rels = store.allRecords({
    kind: 'relationship',
    where: (r) => r.rel_type === 'conflicts_with' && (r.from_id === id || r.to_id === id),
  });
  const open = [], losing = [], winning = [], resolvedOther = [];
  for (const rel of rels) {
    const other = rel.from_id === id ? rel.to_id : rel.from_id;
    const res = rel.metadata && rel.metadata.resolution;
    const decidedByAsOf = res && res.decided_at && Date.parse(res.decided_at) <= Date.parse(asOf);
    const entry = { conflict_id: rel.id, other_id: other };
    if (!decidedByAsOf) { open.push(entry); continue; }
    if (res.winner_id === id) winning.push(entry);
    else if (res.winner_id === other) losing.push(entry);
    else resolvedOther.push(entry); // coexisting / no winner recorded
  }
  return { open, losing, winning, resolved_other: resolvedOther };
}

// Content anchor of a record: the identity used for corroboration
// independence. chunk → document → artifact → content_ref; statement
// kinds fall back to provenance.artifact_ref, then their own
// (class, collection, source_reference).
function contentAnchorOf(store, rec) {
  let r = rec;
  if (r.kind === 'chunk') r = store.getRecord(r.document_id) || r;
  if (r.kind === 'document') r = store.getRecord(r.artifact_id) || r;
  if (r.kind === 'artifact') return r.content_ref;
  const prov = r.provenance;
  if (prov && prov.artifact_ref) return prov.artifact_ref;
  if (prov) return 'ref:' + prov.source_reference;
  return 'record:' + r.id;
}

function sourceIdentityOf(store, rec) {
  let holder = rec;
  if (rec.kind === 'chunk') {
    const doc = store.getRecord(rec.document_id);
    holder = doc ? (store.getRecord(doc.artifact_id) || doc) : rec;
  } else if (rec.kind === 'document') {
    holder = store.getRecord(rec.artifact_id) || rec;
  }
  const prov = holder.provenance || rec.provenance;
  if (!prov) return null;
  return {
    key: prov.source_class + '|' + (prov.source_collection || 'default') + '|' + contentAnchorOf(store, rec),
    source_class: prov.source_class,
    source_collection: prov.source_collection || 'default',
  };
}

// Corroboration: independent evidence = distinct (source_class,
// source_collection, content anchor) identities among resolvable,
// non-derived evidence records, excluding the assessed record's own
// identity. derived evidence recurses into derived_from for listing but
// NEVER counts as corroboration (a derivation is not a new source).
// also_present_in relationships are reported separately, labelled,
// never silently folded into the count.
function corroborationOf(store, rec) {
  const links = store.allRecords({ kind: 'evidence', where: (r) => r.supports_id === rec.id });
  const own = sourceIdentityOf(store, rec);
  const seen = new Map(); // key → first evidence id
  const detail = [], unresolved = [], derivedEvidence = [], duplicates = [];

  const consider = (eid, viaDerived) => {
    const er = store.getRecord(eid);
    if (!er) { unresolved.push(eid); return; }
    if (er.kind === 'derived') {
      derivedEvidence.push({ id: eid, derived_from: er.derived_from });
      (er.derived_from || []).forEach((d) => consider(d, true));
      return;
    }
    const ident = sourceIdentityOf(store, er);
    if (!ident) { unresolved.push(eid); return; }
    const entry = { id: eid, source_class: ident.source_class, source_collection: ident.source_collection, via_derived: !!viaDerived };
    detail.push(entry);
    if (viaDerived) return;                       // derivation inputs are listed, not counted
    if (own && ident.key === own.key) { entry.self = true; return; } // self-corroboration excluded
    if (seen.has(ident.key)) { duplicates.push(eid); entry.duplicate_of = seen.get(ident.key); return; }
    seen.set(ident.key, eid);
  };
  for (const l of links) for (const eid of l.evidence_ids) consider(eid, false);

  // Same bytes seen in other sources: the artifact keeps only its first
  // attribution, so these are enumerated from also_present_in.
  const anchor = contentAnchorOf(store, rec);
  const additional = [];
  if (typeof anchor === 'string' && anchor.indexOf('othk://') === 0) {
    for (const rel of store.allRecords({ kind: 'relationship', where: (r) => r.rel_type === 'also_present_in' })) {
      const art = store.getRecord(rel.from_id);
      if (art && art.content_ref === anchor) {
        additional.push({ relationship_id: rel.id, source_id: rel.to_id, source_reference: rel.metadata && rel.metadata.source_reference });
      }
    }
  }

  return {
    independent_sources: seen.size,
    evidence_detail: detail,
    duplicate_evidence: duplicates,
    derived_evidence: derivedEvidence,
    unresolved_evidence: unresolved,
    additional_sources: additional, // labelled, not counted
    evidence_link_ids: links.map((l) => l.id),
  };
}

function provenanceStrengthOf(store, rec) {
  const prov = rec.provenance;
  if (!prov) return { level: 'MISSING', checks: { provenance: false } };
  const ids = require('./ids.js');
  const sourceId = ids.recordId('source', prov.source_class + '/' + (prov.source_collection || 'default'));
  const checks = {
    provenance: true,
    source_record: !!store.getRecord(sourceId),
    captured_at: !!prov.captured_at,
    artifact_bytes: prov.artifact_ref ? store.hasObject(prov.artifact_ref) : null,
    assertion_class: auditLib.assertionClassOf(rec),
  };
  let level;
  if (!checks.source_record || !checks.captured_at || checks.artifact_bytes === false) level = 'WEAK';
  else if (checks.artifact_bytes === true && checks.assertion_class) level = 'STRONG';
  else level = 'ADEQUATE';
  return { level, checks, source_id: checks.source_record ? sourceId : null };
}

function statementCategoryOf(rec, tier, quarantined) {
  if (quarantined) return 'quarantined-assertion';
  const assertion = auditLib.assertionClassOf(rec);
  if (rec.kind === 'claim') {
    return (tier === 'first-party' || tier === 'operator') ? 'user-provided-claim' : 'imported-claim';
  }
  // Non-authoritative tier or unknown tier — bulk import / model output /
  // metadata-only — asserts, it does not establish; and an INFERRED/DERIVED
  // assertion class is not first-hand. This gate applies to EVERY
  // statement kind, not just `fact` (F2): an attacker-supplied Takeout or
  // Gemini `event` must never assess as an established statement either.
  const nonAuthoritative = tier === null || NON_AUTHORITATIVE_TIERS.indexOf(tier) !== -1
    || assertion === 'INFERRED' || assertion === 'DERIVED';
  if (rec.kind === 'fact') return nonAuthoritative ? 'imported-claim' : 'accepted-fact';
  if (rec.kind === 'observation') return nonAuthoritative ? 'imported-claim' : 'observation';
  if (rec.kind === 'event') return nonAuthoritative ? 'imported-claim' : 'event';
  return 'derived';
}

// The single assessment entry point.
// trustModel: result of loadTrustModel. Returns a trust report; throws
// typed errors for missing asOf, unknown/deleted ids, non-statement
// kinds. Every derived value is traceable via `trace`.
function assessTrust(store, trustModel, id, opts) {
  const asOf = opts && opts.asOf;
  if (!asOf || !model.isIsoTimestamp(asOf)) throw fail('OTHK_TRUST_INPUT', 'asOf (valid ISO timestamp) required — trust is never assessed against the wall clock');
  if (!isObjectMap(trustModel) || Object.keys(trustModel).length === 0) throw fail('OTHK_TRUST_CONFIG', 'loaded trust model required');
  const versions = store.getVersions(id);
  if (!versions.length) throw fail('OTHK_TRUST_UNKNOWN', 'no record ' + String(id).slice(0, 80));
  // Fail closed on deletion: a record whose latest version is a
  // tombstone is never assessed, at any asOf — an explicit deletion is
  // not a point-in-time question this layer answers.
  if (versions[versions.length - 1].deleted) throw fail('OTHK_TRUST_DELETED', 'record is tombstoned: ' + String(id).slice(0, 80));
  const chosen = versionAt(versions, asOf);
  if (!chosen) throw fail('OTHK_TRUST_DELETED', 'record is tombstoned: ' + String(id).slice(0, 80));
  const rec = chosen.record;
  if (ASSESSABLE_KINDS.indexOf(rec.kind) === -1) {
    throw fail('OTHK_TRUST_KIND', 'trust is assessed on statement kinds (' + ASSESSABLE_KINDS.join('/') + '), not ' + rec.kind);
  }

  const quarantined = quarantinedAt(versions, asOf);
  const prov = rec.provenance || null;
  const cfg = prov ? trustModel[prov.source_class] : undefined;
  // Fail closed: missing provenance or an unregistered class (possible
  // only in a store written outside the validated paths) → untrusted.
  const tier = cfg ? cfg.tier : null;
  const authority = {
    source_class: prov ? prov.source_class : null,
    tier: tier || 'untrusted',
  };

  // Freshness relative to asOf only. unknown-date is stale fail-closed;
  // truth time after asOf is 'not-yet-true', never a negative age.
  const t = temporal.truthTimeOf(rec);
  let freshness;
  if (!t) freshness = { truth_time: null, status: 'unknown-date', age_days: null, stale: true };
  else if (Date.parse(t) > Date.parse(asOf)) freshness = { truth_time: t, status: 'not-yet-true', age_days: null, stale: false };
  else {
    const age = Math.floor((Date.parse(asOf) - Date.parse(t)) / 86400000);
    const horizon = cfg ? cfg.stale_after_days : 0; // no tier → horizon 0 → always stale (fail closed)
    freshness = { truth_time: t, status: 'dated', age_days: age, stale: age > horizon };
  }

  const conflicts = conflictsAt(store, id, asOf);
  const corroboration = corroborationOf(store, rec);
  const strength = provenanceStrengthOf(store, rec);
  const category = statementCategoryOf(rec, tier, quarantined);

  // Summary: weakest-link with non-overridable ceilings. Corroboration
  // and absence-of-conflict can only fail to lower — nothing here raises
  // a label past its category ceiling, and stale ≠ false.
  const basis = [];
  let summary;
  if (quarantined) { summary = 'quarantined'; basis.push('quarantine tag in version history at asOf'); }
  else if (conflicts.losing.length) { summary = 'superseded'; basis.push('losing side of conflict(s) resolved by asOf: ' + conflicts.losing.map((c) => c.conflict_id).join(',')); }
  else if (conflicts.open.length) { summary = 'contested'; basis.push('open contradiction(s) at asOf: ' + conflicts.open.map((c) => c.conflict_id).join(',')); }
  else if (category === 'user-provided-claim' || category === 'imported-claim' || category === 'derived') {
    summary = 'unverified-assertion'; basis.push('statement category ' + category + ' — asserted, not established');
  } else if (strength.level === 'MISSING' || strength.level === 'WEAK' || authority.tier === 'untrusted') {
    summary = 'weakly-supported'; basis.push('provenance strength ' + strength.level + ', authority ' + authority.tier);
  } else if (freshness.status === 'not-yet-true') {
    // Truth time is after asOf: the statement is not yet true, so it is
    // not a supported current statement (F14). Never 'supported'.
    summary = 'unverified-assertion'; basis.push('truth time ' + freshness.truth_time + ' is after asOf — not yet true');
  } else if (freshness.stale) {
    summary = 'stale'; basis.push('truth time ' + (freshness.truth_time || 'unknown') + ' beyond the ' + (cfg ? cfg.stale_after_days : 0) + '-day horizon (stale, not false)');
  } else {
    summary = 'supported'; basis.push('provenance ' + strength.level + ', authority tier ' + authority.tier + ', within freshness horizon');
  }

  return {
    id, as_of: asOf,
    version_assessed: chosen.version,
    kind: rec.kind,
    statement_category: category,
    authority,
    freshness,
    corroboration,
    contradictions: conflicts,
    provenance_strength: strength,
    trust_summary: summary,
    not_a_truth_value: true, // 'supported' is an epistemic label, never a truth verdict
    basis,
    trace: {
      source_id: strength.source_id || null,
      config_tier: tier,
      evidence_link_ids: corroboration.evidence_link_ids,
      conflict_ids: conflicts.open.concat(conflicts.losing, conflicts.winning, conflicts.resolved_other).map((c) => c.conflict_id),
      versions_considered: versions.map((v) => v.version),
    },
  };
}

module.exports = {
  DEFAULT_CONFIG, TIERS, NON_AUTHORITATIVE_TIERS, STATEMENT_CATEGORIES, SUMMARIES,
  ASSESSABLE_KINDS, QUARANTINE_TAGS,
  loadTrustModel, assessTrust,
  // exported for targeted tests
  versionAt, quarantinedAt, conflictsAt, corroborationOf,
};
