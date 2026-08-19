// =====================================================
// OTH Knowledge — programmatic API facade
// projects/oth-knowledge/lib/api.js
// =====================================================
'use strict';

const store = require('./store.js');
const provenance = require('./provenance.js');
const ingest = require('./ingest.js');
const extract = require('./extract.js');
const conflict = require('./conflict.js');
const searchLib = require('./search.js');
const model = require('./model.js');
const ids = require('./ids.js');

// Opens a knowledge base handle bound to one store root + source-class registry.
function open(root, opts) {
  const s = store.openStore(root);
  const classes = provenance.loadSourceClasses(opts && opts.sourceClassConfig);
  let index = null;
  const kb = {
    store: s,
    classes,
    ingestArtifact(input) { index = null; return ingest.ingestArtifact(s, classes, input); },
    addEntity(x) { index = null; return extract.addEntity(s, x); },
    addFact(x) { index = null; return extract.addFact(s, classes, x); },
    addClaim(x) { index = null; return extract.addClaim(s, classes, x); },
    addObservation(x) { index = null; return extract.addObservation(s, classes, x); },
    addEvent(x) { index = null; return extract.addEvent(s, classes, x); },
    addRelationship(x) { index = null; return extract.addRelationship(s, x); },
    addEvidence(x) { index = null; return extract.addEvidence(s, x); },
    addDerived(x) { index = null; return extract.addDerived(s, classes, x); },
    registerConflict(a, b, note) { index = null; return conflict.registerConflict(s, a, b, note); },
    resolveConflict(relId, res) { index = null; return conflict.resolveConflict(s, relId, res); },
    listConflicts(f) { return conflict.listConflicts(s, f); },
    search(query, opts2) {
      if (!index) index = searchLib.buildIndex(s, { embedder: (opts && opts.embedder) || undefined });
      return searchLib.search(index, query, opts2);
    },
    exportRecords(o) { return s.exportRecords(o); },
    verify() { return s.verify(); },
    stats() { return s.stats(); },
  };
  return kb;
}

module.exports = { open, model, ids, store, provenance, ingest, extract, conflict, search: searchLib };
