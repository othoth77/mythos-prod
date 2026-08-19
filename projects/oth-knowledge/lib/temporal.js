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

// Truth time: the record's own semantics — never store write time.
function truthTimeOf(rec) {
  return rec.observed_at || rec.occurred_at ||
    (rec.provenance && rec.provenance.observed_at) || null;
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
    if (asOf && res.decided_at && Date.parse(res.decided_at) > Date.parse(asOf)) continue;
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
  if (!asOf) throw new Error('OTHK_TEMPORAL_INPUT: asOf reference date required');
  const versions = store.getVersions(rec.id);
  const latest = versions[versions.length - 1];
  if (latest && latest.record !== rec && JSON.stringify(latest.record) !== JSON.stringify(rec)) return 'superseded';
  if (losingIds(store).has(rec.id)) return 'superseded';
  const t = truthTimeOf(rec);
  if (!t) return 'unknown-date';
  if (Date.parse(t) > Date.parse(asOf)) return 'planned';
  return 'current';
}

// Knowledge as known at a date: statements whose truth time <= asOf,
// excluding losing sides of conflicts resolved by then. Versions matter:
// uses the latest version whose provenance capture is <= asOf when
// available, else the earliest version (honest: we cannot un-know).
function knownAt(store, asOf) {
  if (!asOf) throw new Error('OTHK_TEMPORAL_INPUT: asOf required');
  const losers = losingIds(store, asOf);
  const out = [];
  for (const rec of store.allRecords()) {
    if (STATEMENT_KINDS.indexOf(rec.kind) === -1) continue;
    const t = truthTimeOf(rec);
    if (!t || Date.parse(t) > Date.parse(asOf)) continue;
    if (losers.has(rec.id)) continue;
    out.push(rec);
  }
  out.sort((a, b) => Date.parse(truthTimeOf(a)) - Date.parse(truthTimeOf(b)) || (a.id < b.id ? -1 : 1));
  return out;
}

// What changed in a truth-time or ingest-time window — both reported
// explicitly so the two time axes are never conflated.
function whatChanged(store, opts) {
  const after = opts && opts.after, before = opts && opts.before;
  if (!after || !before) throw new Error('OTHK_TEMPORAL_INPUT: after and before required');
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
function latestVerified(store, opts) {
  const tag = opts && opts.tag;
  const facts = store.allRecords({
    kind: 'fact',
    where: (r) => ['EXPLICIT', 'HIGH'].indexOf(r.confidence) !== -1 &&
      (!tag || (Array.isArray(r.tags) && r.tags.indexOf(tag) !== -1)) && !!truthTimeOf(r),
  });
  const losers = losingIds(store);
  const live = facts.filter((f) => !losers.has(f.id));
  live.sort((a, b) => Date.parse(truthTimeOf(b)) - Date.parse(truthTimeOf(a)) || (a.id < b.id ? -1 : 1));
  return live;
}

module.exports = { STATEMENT_KINDS, truthTimeOf, ingestTimeOf, losingIds, classify, knownAt, whatChanged, latestVerified };
