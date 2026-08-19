// =====================================================
// OTH Knowledge — source classes and provenance policy
// projects/oth-knowledge/lib/provenance.js
//
// Loads the closed source-class registry and enforces per-class policy
// fail-closed. Sources are never merged across classes.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const model = require('./model.js');

const POLICIES = Object.freeze(['content', 'metadata-only']);
const DEFAULT_CONFIG = path.join(__dirname, '..', 'config', 'source-classes.json');

function fail(code, msg) { const e = new Error(code + ': ' + msg); e.code = code; return e; }

// Whole-registry fail-closed validation: one bad class invalidates the file.
function loadSourceClasses(configPath) {
  const p = configPath || DEFAULT_CONFIG;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { throw fail('OTHK_SOURCE_CONFIG', 'unreadable source-class registry: ' + e.message); }
  if (!parsed || parsed.format !== 'othk-source-classes' || !model.isPlainObject(parsed.classes)) {
    throw fail('OTHK_SOURCE_CONFIG', 'invalid source-class registry format');
  }
  const classes = Object.create(null);
  for (const name of Object.keys(parsed.classes)) {
    const cls = parsed.classes[name];
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) throw fail('OTHK_SOURCE_CONFIG', 'invalid class name: ' + name);
    if (!model.isPlainObject(cls) || typeof cls.title !== 'string' || !cls.title) {
      throw fail('OTHK_SOURCE_CONFIG', 'class ' + name + ' missing title');
    }
    if (POLICIES.indexOf(cls.policy) === -1) throw fail('OTHK_SOURCE_CONFIG', 'class ' + name + ' has invalid policy');
    classes[name] = { name, title: cls.title, policy: cls.policy, notes: typeof cls.notes === 'string' ? cls.notes : '' };
  }
  if (Object.keys(classes).length === 0) throw fail('OTHK_SOURCE_CONFIG', 'empty source-class registry');
  return classes;
}

function requireClass(classes, name) {
  const cls = classes[name];
  if (!cls) throw fail('OTHK_SOURCE_UNKNOWN', 'unregistered source class: ' + String(name).slice(0, 80));
  return cls;
}

// Builds a validated provenance object for a record.
function buildProvenance(classes, fields) {
  const cls = requireClass(classes, fields.source_class);
  const prov = {
    source_class: cls.name,
    source_collection: typeof fields.source_collection === 'string' && fields.source_collection ? fields.source_collection : 'default',
    source_reference: fields.source_reference,
    captured_at: fields.captured_at,
  };
  if (fields.observed_at) prov.observed_at = fields.observed_at;
  if (fields.confidence) prov.confidence = fields.confidence;
  if (fields.actor) prov.actor = String(fields.actor).slice(0, 200);
  if (fields.artifact_ref) prov.artifact_ref = fields.artifact_ref;
  // Reuse the model's provenance validation by round-tripping through a
  // minimal probe record shape.
  const probe = { kind: 'observation', id: 'observation-0000000000000000', statement: 'probe', observed_at: prov.observed_at || prov.captured_at, provenance: prov };
  try { model.validateRecord(probe); } catch (e) { throw fail('OTHK_PROVENANCE', e.message); }
  return prov;
}

module.exports = { POLICIES, DEFAULT_CONFIG, loadSourceClasses, requireClass, buildProvenance };
