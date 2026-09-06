// =====================================================
// OTH Knowledge — temporal knowledge
// projects/oth-knowledge/lib/temporal.js
//
// Distinguishes TRUTH TIME (when something was true/observed/occurred)
// from INGEST TIME (when we captured or wrote it). The newest ingestion
// timestamp is never treated as the truth timestamp. Classifies records
// as current / historical / superseded / planned / unknown-date relative
// to an explicit reference date, and answers "what was known at T" /
// "what changed between A and B" / "latest verified fact".
// =====================================================
'use strict';

const conflict = require('./conflict.js');

const STATEMENT_KINDS = ['fact', 'claim', 'observation', 'event'];

// asOf must be a real ISO timestamp, not merely truthy: a non-date value
// makes every Date.parse(asOf) comparison NaN-false, which silently
// skips the capture-aware version selection AND the planned/future
// cutoff, returning not-yet-true statements as "current" (F3).
function requireAsOf(asOf) {
  if (!require('./model.js').isIsoTimestamp(asOf)) {
    throw new Error('OTHK_TEMPORAL_INPUT: asOf must be a valid ISO timestamp');
  }
}

// Truth time: the record's own semantics — never store write time.
// valid_from is the lowest-priority fallback so an explicit event-time
// validity interval participates without overriding observed_at/occurred_at.
function truthTimeOf(rec) {
  return rec.observed_at || rec.occurred_at ||
    (rec.provenance && rec.provenance.observed_at) || rec.valid_from || null;
}

// Ingest time: when the knowledge entered the system.
function ingestTimeOf(rec, envelope) {
  return (rec.provenance && rec.provenance.captured_at) || (envelope && envelope.written_at) || null;
}

// Records superseded by an explicit conflict resolution (losing side).
// With asOf: only resolutions decided by that date count — in a
// point-in-time view, a fact later overturned WAS the knowledge then.
function losingIds(store, asOf) {
  const losers = new Set();
  for (const rel of conflict.listConflicts(store, { state: 'resolved' })) {
    const res = rel.metadata && rel.metadata.resolution;
    const winner = res && res.winner_id;
    if (!winner) continue;
    // In a point-in-time view, a resolution not yet decided (or with no
    // decided_at on record) has not happened: the loser was still live.
    if (asOf && (!res.decided_at || Date.parse(res.decided_at) > Date.parse(asOf))) continue;
    if (winner === rel.from_id) losers.add(rel.to_id);
    else if (winner === rel.to_id) losers.add(rel.from_id);
  }
  return losers;
}

// Classification relative to asOf (ISO string, required — no wall clock).
//   superseded   — older version exists, or losing side of a resolved conflict
//   planned      — truth time after asOf
//   current      — latest version, truth time known and <= asOf, not superseded
//   unknown-date — no truth time (explicitly distinguished, never guessed)
function classify(store, rec, opts) {
  const asOf = opts && opts.asOf;
  requireAsOf(asOf);
  const versions = store.getVersions(rec.id);
  const latest = versions[versions.length - 1];
  if (latest && latest.record !== rec && JSON.stringify(latest.record) !== JSON.stringify(rec)) return 'superseded';
  if (losingIds(store, asOf).has(rec.id)) return 'superseded';
  const t = truthTimeOf(rec);
  if (!t) return 'unknown-date';
  if (Date.parse(t) > Date.parse(asOf)) return 'planned';
  return 'current';
}

// Truth-time reconstruction at a date: statements whose truth time is
// <= asOf, excluding losing sides of conflicts RESOLVED by then. This
// is "what was true at T" (facts learned later about T still belong),
// not an epistemic snapshot of what had been captured by T. Version
// selection IS capture-aware: for a multi-version record, the version
// returned is the newest one captured on or before asOf, so later
// corrections never leak into a point-in-time view; if every version
// was captured after asOf, the earliest is used (the closest surviving
// representation of the original statement about that time).
function knownAt(store, asOf) {
  requireAsOf(asOf);
  const losers = losingIds(store, asOf);
  const out = [];
  for (const latest of store.allRecords()) {
    if (STATEMENT_KINDS.indexOf(latest.kind) === -1) continue;
    if (losers.has(latest.id)) continue;
    const versions = store.getVersions(latest.id).filter((v) => !v.deleted);
    if (!versions.length) continue;
    let chosen = null;
    for (const v of versions) {
      const cap = v.record.provenance && v.record.provenance.captured_at;
      if (cap && Date.parse(cap) <= Date.parse(asOf)) chosen = v; // versions are in order → ends newest qualifying
    }
    const rec = (chosen || versions[0]).record;
    const t = truthTimeOf(rec);
    if (!t || Date.parse(t) > Date.parse(asOf)) continue;
    out.push(rec);
  }
  out.sort((a, b) => Date.parse(truthTimeOf(a)) - Date.parse(truthTimeOf(b)) || (a.id < b.id ? -1 : 1));
  return out;
}

// What changed in a truth-time or ingest-time window — both reported
// explicitly so the two time axes are never conflated.
function whatChanged(store, opts) {
  const after = opts && opts.after, before = opts && opts.before;
  requireAsOf(after); requireAsOf(before);
  const truth = [], ingested = [], newVersions = [];
  for (const rec of store.allRecords()) {
    if (STATEMENT_KINDS.indexOf(rec.kind) === -1) continue;
    const t = truthTimeOf(rec);
    if (t && Date.parse(t) >= Date.parse(after) && Date.parse(t) <= Date.parse(before)) truth.push(rec.id);
    const versions = store.getVersions(rec.id);
    const it = ingestTimeOf(rec, versions[versions.length - 1]);
    if (it && Date.parse(it) >= Date.parse(after) && Date.parse(it) <= Date.parse(before)) ingested.push(rec.id);
    if (versions.length > 1) newVersions.push({ id: rec.id, versions: versions.length });
  }
  return { truth_time_changes: truth.sort(), ingest_time_changes: ingested.sort(), multi_version_records: newVersions };
}

// Latest verified fact(s): highest truth time among live facts with
// EXPLICIT/HIGH confidence, optionally filtered by tag.
// A record is quarantined if any quarantine tag is present, in either
// spelling ('quarantined' from the audit path, 'quarantine' from the
// ingest secret-refusal path). A quarantined record must never be
// presented as verified.
const QUARANTINE_TAGS = ['quarantined', 'quarantine'];
function isQuarantined(rec) {
  return Array.isArray(rec.tags) && QUARANTINE_TAGS.some((t) => rec.tags.indexOf(t) !== -1);
}

// Latest verified fact(s). When asOf is given, "verified" is judged at
// that point in time: only truth times <= asOf count, and only conflict
// resolutions decided by then supersede a fact (full asOf discipline, so
// this field never leaks post-asOf resolution state into a point-in-time
// view). Without asOf it reports the live latest-verified set.
function latestVerified(store, opts) {
  const tag = opts && opts.tag;
  const asOf = opts && opts.asOf;
  if (asOf) requireAsOf(asOf);
  const facts = store.allRecords({
    kind: 'fact',
    where: (r) => ['EXPLICIT', 'HIGH'].indexOf(r.confidence) !== -1 &&
      !isQuarantined(r) && // never surface a quarantined record as verified (F4)
      (!tag || (Array.isArray(r.tags) && r.tags.indexOf(tag) !== -1)) &&
      !!truthTimeOf(r) && (!asOf || Date.parse(truthTimeOf(r)) <= Date.parse(asOf)),
  });
  const losers = losingIds(store, asOf);
  const live = facts.filter((f) => !losers.has(f.id));
  live.sort((a, b) => Date.parse(truthTimeOf(b)) - Date.parse(truthTimeOf(a)) || (a.id < b.id ? -1 : 1));
  return live;
}

// ---- bi-temporal helpers (Phase 4) ---------------------------------------
//
// Two independent time axes, both preserved, neither ever overwritten:
//   VALID (event) time  — valid_from / valid_to on the record
//   TRANSACTION time    — written_at on the envelope (append-only), and the
//                         DERIVED expired_at = written_at of the version that
//                         superseded/tombstoned this one (null = still live).
// This is Graphiti's bi-temporal model expressed over OTHKM's append-only
// log: nothing is deleted; "expired" is simply the existence of a later
// version. No new storage — expired_at is computed, never stored.

// Transaction-time expiry of a specific record id: when a later version
// (or tombstone) was written. null if this id is still the live head.
function expiredAt(store, id) {
  const versions = store.getVersions(id);
  if (versions.length < 2) {
    // one version, and if it is a live head it never expired
    return versions.length && versions[0].deleted ? versions[0].written_at : null;
  }
  const head = versions[versions.length - 1];
  // the head's own write time is when the previous version expired; the
  // head itself is live unless it is a tombstone.
  return head.written_at || null;
}

// Event-time validity window of a record (nulls = open-ended).
function validInterval(rec) {
  return { from: rec.valid_from || truthTimeOf(rec) || null, to: rec.valid_to || null };
}

// Is a record valid-at-T in EVENT time (ignores transaction time)?
// Open-ended bounds are permissive. asOf required (no wall clock).
function validAt(rec, asOf) {
  requireAsOf(asOf);
  const iv = validInterval(rec);
  const t = Date.parse(asOf);
  if (iv.from && Date.parse(iv.from) > t) return false;   // not yet valid
  if (iv.to && Date.parse(iv.to) <= t) return false;      // no longer valid (half-open [from,to))
  return true;
}

// Full bi-temporal "as-of" test for a live head record: valid in event
// time at asOf AND already known (captured) by asOf AND not superseded by
// a resolution decided on/before asOf. This is the query the plan asks
// for — "what was valid at a specific point in time" — combining BOTH
// axes rather than only one.
function validAndKnownAt(store, rec, asOf) {
  requireAsOf(asOf);
  if (!validAt(rec, asOf)) return false;
  const cap = rec.provenance && rec.provenance.captured_at;
  if (cap && Date.parse(cap) > Date.parse(asOf)) return false; // not yet known
  if (losingIds(store, asOf).has(rec.id)) return false;        // superseded by then
  return true;
}

// The Graphiti "invalidate, don't delete" default: when `winner`
// supersedes `loser`, the loser stops being true when the winner starts.
// PURE — returns the suggested valid_to for the loser (a new superseding
// version the promotion gate would write); it never mutates the store.
function suggestValidTo(winner, loser) {
  const wStart = winner.valid_from || truthTimeOf(winner) || null;
  if (!wStart) return null;
  // never move a valid_to earlier than the loser's own start
  const lStart = loser.valid_from || truthTimeOf(loser) || null;
  if (lStart && Date.parse(wStart) < Date.parse(lStart)) return null;
  return wStart;
}

module.exports = {
  STATEMENT_KINDS, QUARANTINE_TAGS, isQuarantined, truthTimeOf, ingestTimeOf, losingIds,
  classify, knownAt, whatChanged, latestVerified,
  expiredAt, validInterval, validAt, validAndKnownAt, suggestValidTo,
};
