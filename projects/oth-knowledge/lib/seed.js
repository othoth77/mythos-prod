// =====================================================
// OTH Knowledge — structured seed loader
// projects/oth-knowledge/lib/seed.js
//
// Loads a reviewed, committed seed file (entities/facts/observations/
// events + evidence links) into a store, idempotently. Seeds are the
// authorised path for owner-reported structured knowledge such as the
// infrastructure verification record.
// =====================================================
'use strict';

const fs = require('fs');
const extract = require('./extract.js');
const ingestLib = require('./ingest.js');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

function loadSeed(store, classes, seedPath) {
  let seed;
  try { seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')); }
  catch (e) { throw fail('OTHK_SEED_INPUT', 'unreadable seed: ' + e.message); }
  if (!seed || seed.format !== 'othk-seed' || typeof seed.source_class !== 'string' || typeof seed.captured_at !== 'string') {
    throw fail('OTHK_SEED_INPUT', 'invalid seed format (need format=othk-seed, source_class, captured_at)');
  }
  // Secret gate applies to seeds exactly as to artifacts.
  const hits = ingestLib.detectSecretShapes(JSON.stringify(seed));
  if (hits.length) throw fail('OTHK_SEED_SECRET', 'credential-shaped content refused: ' + hits.join(', '));

  ingestLib.ensureSource(store, classes, seed.source_class, seed.source_collection);
  const baseProv = (item) => ({
    source_class: seed.source_class,
    source_collection: seed.source_collection,
    source_reference: seed.source_reference || (seed.source_class + '/' + (seed.source_collection || 'default')),
    captured_at: seed.captured_at,
    observed_at: item.observed_at || seed.observed_at,
    confidence: item.confidence || seed.confidence,
    actor: seed.actor,
  });

  const byKey = new Map();
  const created = { entities: 0, facts: 0, claims: 0, observations: 0, events: 0, evidence: 0 };
  const keep = (key, rec) => {
    if (key) {
      if (byKey.has(key)) throw fail('OTHK_SEED_INPUT', 'duplicate seed key ' + key);
      byKey.set(key, rec);
    }
    return rec;
  };
  const entityIds = (item) => (item.entities || []).map((k) => {
    const rec = byKey.get(k);
    if (!rec || rec.kind !== 'entity') throw fail('OTHK_SEED_INPUT', 'unknown entity key ' + k);
    return rec.id;
  });

  for (const e of seed.entities || []) {
    keep(e.key, extract.addEntity(store, { entity_type: e.entity_type, name: e.name, metadata: e.metadata }));
    created.entities++;
  }
  for (const o of seed.observations || []) {
    keep(o.key, extract.addObservation(store, classes, {
      statement: o.statement, observed_at: o.observed_at || seed.observed_at || seed.captured_at,
      prov: baseProv(o), entity_ids: entityIds(o), tags: o.tags, metadata: o.metadata,
    }));
    created.observations++;
  }
  // Claims are loaded before facts so a fact may cite one as evidence.
  // `claim` is already in the model's closed KINDS enum and already has a
  // constructor in extract.js — this loop only gives the authorised curated
  // path access to it. Repository-derived documentation belongs here rather
  // than under `facts`: a fact from a repository-verified source assesses as
  // `accepted-fact`, whereas a claim assesses as `imported-claim`, which is
  // what "a claim is never presented as a fact" requires.
  for (const c of seed.claims || []) {
    if (typeof c.asserted_by !== 'string' || !c.asserted_by) {
      throw fail('OTHK_SEED_INPUT', 'claim requires asserted_by' + (c.key ? ' (key ' + c.key + ')' : ''));
    }
    keep(c.key, extract.addClaim(store, classes, {
      statement: c.statement, asserted_by: c.asserted_by,
      prov: baseProv(c), entity_ids: entityIds(c), tags: c.tags, metadata: c.metadata,
    }));
    created.claims++;
  }
  for (const f of seed.facts || []) {
    const fact = keep(f.key, extract.addFact(store, classes, {
      statement: f.statement, confidence: f.confidence || seed.confidence || 'HIGH',
      prov: baseProv(f), entity_ids: entityIds(f), tags: f.tags, metadata: f.metadata,
    }));
    created.facts++;
    if (Array.isArray(f.evidence_keys) && f.evidence_keys.length) {
      const evidenceIds = f.evidence_keys.map((k) => {
        const rec = byKey.get(k);
        if (!rec) throw fail('OTHK_SEED_INPUT', 'unknown evidence key ' + k);
        return rec.id;
      });
      extract.addEvidence(store, { supports_id: fact.id, evidence_ids: evidenceIds, note: f.evidence_note });
      created.evidence++;
    }
  }
  for (const ev of seed.events || []) {
    keep(ev.key, extract.addEvent(store, classes, {
      title: ev.title, occurred_at: ev.occurred_at,
      prov: baseProv(ev), entity_ids: entityIds(ev), tags: ev.tags, metadata: ev.metadata,
    }));
    created.events++;
  }
  // Typed relationships between records this seed already loaded (V3.2):
  // `{ from, to, rel_type, asserted_by?, metadata? }` with seed keys. The
  // model's `relationship` kind and extract.addRelationship() existed; only
  // this path to them was missing, so "A uses B" could be written as prose
  // but never walked by graph.js. A relationship carries no provenance field
  // of its own, so the seed's reference (and who asserted it) travels in its
  // metadata — traceable like every other seeded record. Loaded last, so it
  // may join any two records above; an unknown key is refused.
  created.relationships = 0;
  for (const r of seed.relationships || []) {
    const from = byKey.get(r.from), to = byKey.get(r.to);
    if (!from || !to) throw fail('OTHK_SEED_INPUT', 'relationship references an unknown seed key: ' + (!from ? r.from : r.to));
    if (typeof r.rel_type !== 'string' || !/^[a-z][a-z_]{1,39}$/.test(r.rel_type)) {
      throw fail('OTHK_SEED_INPUT', 'relationship rel_type must be a lowercase identifier: ' + String(r.rel_type).slice(0, 40));
    }
    extract.addRelationship(store, {
      rel_type: r.rel_type, from_id: from.id, to_id: to.id,
      metadata: Object.assign({}, r.metadata || {}, {
        source_class: seed.source_class,
        source_reference: seed.source_reference || (seed.source_class + '/' + (seed.source_collection || 'default')),
        asserted_by: typeof r.asserted_by === 'string' && r.asserted_by ? r.asserted_by : null,
        captured_at: seed.captured_at,
      }),
    });
    created.relationships++;
  }
  return created;
}

module.exports = { loadSeed };
