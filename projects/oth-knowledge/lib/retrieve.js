// =====================================================
// OTH Knowledge — constrained retrieval (Phase 6 / 12 / 13)
// projects/oth-knowledge/lib/retrieve.js
//
// A thin composition over search.js that applies OTHKM's truth
// constraints to hybrid retrieval, without changing the well-tested
// search primitives:
//   - namespace isolation            (search filter)
//   - tombstones excluded            (store.allRecords already drops them)
//   - supersession / conflict-losers excluded at asOf
//   - bi-temporal validity: valid AND known at asOf
//   - trust-aware ranking: a low-trust (e.g. model-output) statement never
//     outranks strong authoritative evidence on semantic similarity alone
//   - optional recency decay (ranking only — never a reason to forget)
//
// Retrieval only. Nothing here writes or mutates truth.
// =====================================================
'use strict';

const path = require('path');
const search = require('./search.js');
const temporal = require('./temporal.js');

// Authority tiers, best→worst (mirrors trust.js TIERS). Weight is a gentle
// multiplier in (0,1]; it re-orders near-ties by authority but does not let
// authority alone invent relevance.
const TIER_ORDER = ['first-party', 'operator', 'repository-verified', 'imported', 'metadata-only', 'model-output'];
function tierWeight(tier) {
  const i = TIER_ORDER.indexOf(tier);
  if (i === -1) return 0.30; // unknown/untrusted → low, fail-closed
  return (TIER_ORDER.length - i) / TIER_ORDER.length; // first-party=1.0 … model-output≈0.17
}

// Build a source_class → tier map from the trust model config.
function loadTierMap(trustModel) {
  const classes = (trustModel && trustModel.classes) || {};
  const map = {};
  for (const name of Object.keys(classes)) map[name] = classes[name].tier;
  return map;
}
function defaultTrustModel() {
  try { return require(path.join(__dirname, '..', 'config', 'trust-model.json')); }
  catch (e) { return { classes: {} }; }
}

function recTier(rec, tierMap) {
  const sc = rec && rec.provenance && rec.provenance.source_class;
  return (sc && tierMap[sc]) || null;
}

// Recency decay in (0,1]: 1.0 at asOf, halving every halfLifeDays. Uses
// truth time; missing time → neutral 1.0 (never penalise unknown-date into
// oblivion). Ranking only.
function recencyWeight(rec, asOf, halfLifeDays) {
  if (!halfLifeDays) return 1;
  const t = temporal.truthTimeOf(rec);
  if (!t) return 1;
  const ageDays = (Date.parse(asOf) - Date.parse(t)) / 86400000;
  if (!(ageDays > 0)) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

// retrieve(store, query, opts)
//   opts: { mode, limit, namespace, filters, asOf, trustAware, halfLifeDays,
//           embedder, includeSuperseded }
// Returns hits (search shape) with an added `.baseScore`, `.trustWeight`,
// `.recencyWeight`, `.tier`, and the final blended `.score`.
function retrieve(store, query, opts) {
  const o = opts || {};
  const index = search.buildIndex(store, { embedder: o.embedder });
  const filters = Object.assign({}, o.filters || {});
  if (o.namespace) filters.namespace = o.namespace;

  const over = Math.max((o.limit || 10) * 4, 40); // over-fetch, then constrain + rerank
  let hits = search.search(index, query, { mode: o.mode || 'hybrid', filters, limit: over });

  const asOf = o.asOf || null;
  const losers = asOf ? temporal.losingIds(store, asOf) : temporal.losingIds(store);
  const tierMap = loadTierMap(o.trustModel || defaultTrustModel());

  const out = [];
  for (const h of hits) {
    const rec = store.getRecord(h.id);
    if (!rec) continue; // tombstoned between build and read
    if (!o.includeSuperseded && losers.has(rec.id)) continue; // conflict loser at asOf
    if (asOf && temporal.STATEMENT_KINDS.indexOf(rec.kind) !== -1 && !temporal.validAndKnownAt(store, rec, asOf)) continue;
    const tier = recTier(rec, tierMap);
    const tw = o.trustAware ? tierWeight(tier) : 1;
    const rw = recencyWeight(rec, asOf || new Date().toISOString(), o.halfLifeDays);
    const base = h.score;
    out.push(Object.assign({}, h, {
      baseScore: base, tier: tier || 'untrusted', trustWeight: tw, recencyWeight: rw,
      score: base * tw * rw,
    }));
  }
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return out.slice(0, o.limit || 10);
}

module.exports = { retrieve, tierWeight, TIER_ORDER, loadTierMap, recencyWeight };
