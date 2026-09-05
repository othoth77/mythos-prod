// =====================================================
// OTH Knowledge — promotion gate (Phase 8)
// projects/oth-knowledge/lib/promotion-gate.js
//
// The one boundary between proposed memory and durable truth:
//     AI proposes → GATE decides → OTHKM.
// A candidate becomes durable only if it passes EVERY check:
//   - provenance present (source_class/source_reference/captured_at)
//   - source class is registered (unknown class → fail closed)
//   - secret/PII shapes absent (reuses the ingest secret gate)
//   - namespace valid
//   - temporal sanity (valid_from <= valid_to; ISO timestamps)
//   - statement present and bounded
// The gate NEVER upgrades trust: a model-output candidate stays
// model-output. It NEVER writes on its own; writing is done by the
// controlled applyDecisions path in extract-decision.js, which calls
// this gate first. Pure validation here — deterministic, no LLM.
// =====================================================
'use strict';

const model = require('./model.js');
const ingest = require('./ingest.js');
const namespace = require('./namespace.js');

const KINDS = ['fact', 'claim', 'observation', 'event'];
const MAX_STATEMENT = 4000;

// classes: from provenance.loadSourceClasses(); trustModel: config JSON.
function gate(candidate, opts) {
  const o = opts || {};
  const reasons = [];
  const c = candidate || {};

  if (!model.isPlainObject(c)) return { ok: false, reasons: ['candidate must be an object'] };
  if (KINDS.indexOf(c.kind) === -1) reasons.push('kind must be one of ' + KINDS.join('/'));

  const text = c.statement || c.title || '';
  if (typeof text !== 'string' || !text.trim()) reasons.push('statement/title required');
  else if (text.length > MAX_STATEMENT) reasons.push('statement exceeds ' + MAX_STATEMENT + ' chars');

  // provenance
  const p = c.provenance;
  if (!model.isPlainObject(p)) reasons.push('provenance object required');
  else {
    for (const f of ['source_class', 'source_reference', 'captured_at']) {
      if (typeof p[f] !== 'string' || !p[f]) reasons.push('provenance.' + f + ' required');
    }
    if (p.captured_at && !model.isIsoTimestamp(p.captured_at)) reasons.push('provenance.captured_at invalid');
    // source class must be registered (fail-closed on unknown provenance)
    if (o.classes && p.source_class && !o.classes[p.source_class]) reasons.push('unregistered source_class: ' + p.source_class);
  }

  // secret / PII gate (reuse the ingest detector on the candidate text)
  const secretHits = ingest.detectSecretShapes(text + '\n' + JSON.stringify(c.metadata || {}));
  if (secretHits.length) reasons.push('credential/secret-shaped content refused: ' + secretHits.join(','));

  // namespace
  if (c.namespace !== undefined && !namespace.isValidNamespace(c.namespace)) reasons.push('invalid namespace');

  // temporal sanity
  for (const f of ['valid_from', 'valid_to']) {
    if (c[f] !== undefined && c[f] !== null && !model.isIsoTimestamp(c[f])) reasons.push(f + ' invalid timestamp');
  }
  if (c.valid_from && c.valid_to && Date.parse(c.valid_to) < Date.parse(c.valid_from)) reasons.push('valid_to precedes valid_from');

  // trust tier (for the record, never a rejection reason on its own)
  const tier = (o.trustModel && o.trustModel.classes && p && o.trustModel.classes[p.source_class])
    ? o.trustModel.classes[p.source_class].tier : null;

  return { ok: reasons.length === 0, reasons, tier: tier || 'untrusted' };
}

module.exports = { gate, KINDS, MAX_STATEMENT };
