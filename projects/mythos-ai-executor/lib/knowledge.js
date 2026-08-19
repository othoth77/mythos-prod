'use strict';
// =====================================================
// Mythos AI Executor — OTH Knowledge read-only consumer (OTH-K2-W)
// projects/mythos-ai-executor/lib/knowledge.js
//
// The AI Operating Layer CONSUMES knowledge; it never owns, hosts, or
// mutates the knowledge database. This module is the executor side of
// the boundary contract in docs/OTH_KNOWLEDGE_INTEGRATION.md: it loads
// a config-declared store root, opens the provider-neutral
// knowledge-service, and exposes ONLY an allowlisted read surface with
// the four consuming-side rules enforced here (not merely assumed of
// callers):
//   1. asOf is an explicit input — never defaulted to "now" here.
//   2. Every hit carries provenance plus a presentation annotation.
//   3. A claim is never presented as a fact (is_claim is stamped on
//      every hit so no downstream renderer has to know record kinds).
//   4. Quarantined items are flagged on every hit.
//
// FAIL CLOSED, same discipline as lib/skills.js and
// lib/mcp-capabilities.js: a malformed config (unknown field, an
// endpoint/url/credential-shaped key anywhere, enabled without a valid
// store root, a store root inside this repository) disables the whole
// knowledge layer rather than trusting the parts that parse. Missions
// never depend on this layer existing — a disabled layer is a normal,
// reportable state, not an error.
//
// NO NETWORK CODE, NO CREDENTIALS, NO WRITES. The only require beyond
// fs/path is the oth-knowledge service module, which is itself
// provider-neutral and write-free by construction.
// =====================================================

var fs = require('fs');
var path = require('path');

var DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'knowledge.json');
var SERVICE_PATH = path.join(__dirname, '..', '..', 'oth-knowledge', 'lib', 'knowledge-service.js');
// The repository root: a knowledge store inside it would end up in Git
// history sooner or later, which rule 3 of AGENTS.md §3 forbids.
var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

var ALLOWED_CONFIG_FIELDS = ['enabled', 'store_root', 'description'];
// Rejected by presence anywhere in the document, at any depth: this is a
// local-path wiring config, and anything endpoint- or credential-shaped
// appearing in it is exactly the accident this check exists to catch.
var FORBIDDEN_KEY_RE = /^(endpoint|url|key|token|secret|password|credential|api_key|apikey|auth)$/i;

// The ONLY operations the executor may reach. Built as an explicit
// allowlist so that even if the underlying service ever grew a write
// operation, it would not become reachable from the AI layer without a
// deliberate change here.
var READ_OPS = [
  'search', 'retrieve', 'lookupEntity', 'lookupEvidence', 'lookupHistory',
  'lookupProvenance', 'findContradictions', 'currentState', 'audit', 'stats',
  'assessTrust'
];

function scanForbiddenKeys(obj, where, errors) {
  if (!obj || typeof obj !== 'object') return;
  Object.keys(obj).forEach(function (k) {
    if (FORBIDDEN_KEY_RE.test(k)) {
      errors.push(where + '.' + k + ': endpoint/credential-shaped keys are rejected by design');
    }
    scanForbiddenKeys(obj[k], where + '.' + k, errors);
  });
}

// Pure validation of a parsed config object. Returns
// { valid, enabled, store_root, reason }. Any defect → valid:false,
// enabled:false — the whole layer, never a partial read of the file.
function validateConfigObject(raw) {
  function invalid(reason) { return { valid: false, enabled: false, store_root: null, reason: reason }; }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('config root is not an object');

  var errors = [];
  scanForbiddenKeys(raw, 'root', errors);
  if (errors.length) return invalid(errors.join('; '));

  var unknown = Object.keys(raw).filter(function (k) { return ALLOWED_CONFIG_FIELDS.indexOf(k) === -1; });
  if (unknown.length) return invalid('unknown field(s): ' + unknown.join(','));
  if (typeof raw.enabled !== 'boolean') return invalid('enabled must be a boolean');
  if (typeof raw.description !== 'string' || !raw.description.trim()) return invalid('description must be a non-empty string');
  if (raw.store_root !== null && typeof raw.store_root !== 'string') return invalid('store_root must be null or a string');

  if (raw.enabled) {
    if (typeof raw.store_root !== 'string' || !raw.store_root.trim()) return invalid('enabled requires store_root');
    if (!path.isAbsolute(raw.store_root)) return invalid('store_root must be an absolute path');
    if (raw.store_root.indexOf('\u0000') !== -1) return invalid('store_root contains NUL');
    var resolved = path.resolve(raw.store_root);
    if (resolved === REPO_ROOT || resolved.indexOf(REPO_ROOT + path.sep) === 0) {
      return invalid('store_root is inside the repository — the knowledge store must never live in Git');
    }
  }

  return { valid: true, enabled: raw.enabled, store_root: raw.enabled ? path.resolve(raw.store_root) : null, reason: null };
}

function loadConfig(configPath) {
  var p = configPath || DEFAULT_CONFIG_PATH;
  var text;
  try { text = fs.readFileSync(p, 'utf8'); }
  catch (e) { return { valid: false, enabled: false, store_root: null, reason: 'config unreadable: ' + e.message }; }
  var raw;
  try { raw = JSON.parse(text); }
  catch (e2) { return { valid: false, enabled: false, store_root: null, reason: 'config is not valid JSON: ' + e2.message }; }
  return validateConfigObject(raw);
}

// Presentation annotation for one hit/record: kind- and tag-derived
// flags the consuming layer must respect (integration doc §3 rules 3–4).
function presentationOf(service, id) {
  var rec = null;
  try { var r = service.retrieve(id); rec = r && r.record; } catch (e) { rec = null; }
  var prov = null;
  try { prov = service.lookupProvenance(id); } catch (e2) { prov = null; }
  var tags = (rec && Array.isArray(rec.tags)) ? rec.tags : [];
  var isClaim = !!(rec && rec.kind === 'claim');
  return {
    assertion_class: (prov && prov.lineage && prov.lineage.assertion_class) || null,
    is_claim: isClaim,
    statement_class: isClaim ? 'claim — never present as fact' : 'statement',
    // Both tag spellings: audit.js quarantines with 'quarantined'; the
    // ingest secret-refusal path tags 'quarantine'. Either must flag.
    quarantined: tags.indexOf('quarantined') !== -1 || tags.indexOf('quarantine') !== -1,
  };
}

// Opens the read-only knowledge facade. Returns:
//   { enabled: false, reason }                     — layer off (normal state)
//   { enabled: true, store_root, ops }             — allowlisted read surface
// Never throws for a disabled/malformed layer; throws only for caller
// programming errors on an enabled surface (e.g. currentState without asOf).
function openKnowledge(opts) {
  var o = opts || {};
  var cfg = o.config ? validateConfigObject(o.config) : loadConfig(o.configPath);
  if (!cfg.valid) return { enabled: false, reason: cfg.reason };
  if (!cfg.enabled) return { enabled: false, reason: 'knowledge layer disabled by config' };

  var stat;
  try { stat = fs.statSync(cfg.store_root); }
  catch (e) { return { enabled: false, reason: 'store_root does not exist: ' + cfg.store_root }; }
  if (!stat.isDirectory()) return { enabled: false, reason: 'store_root is not a directory: ' + cfg.store_root };

  var serviceLib;
  try { serviceLib = require(o.servicePath || SERVICE_PATH); }
  catch (e2) { return { enabled: false, reason: 'knowledge-service unavailable: ' + e2.message }; }

  var service;
  try { service = serviceLib.openService(cfg.store_root); }
  catch (e3) { return { enabled: false, reason: 'store open failed: ' + e3.message }; }

  var ops = {};
  READ_OPS.forEach(function (name) {
    if (typeof service[name] !== 'function') return; // absent op stays absent
    ops[name] = function () { return service[name].apply(service, arguments); };
  });

  // Rule 1: asOf is an explicit input. Refused here as well as in the
  // service, so the executor-side contract holds even against a future
  // service that softened it.
  var innerCurrentState = ops.currentState;
  ops.currentState = function (q) {
    if (!q || !q.asOf) {
      var err = new Error('MYTHOS_KNOWLEDGE_ASOF: asOf is required — the AI layer never defaults to "now"');
      err.code = 'MYTHOS_KNOWLEDGE_ASOF';
      throw err;
    }
    return innerCurrentState(q);
  };

  // Same rule-1 guard for assessTrust: trust is a point-in-time
  // judgement and the AI layer never defaults it to "now", even against
  // a future service that softened its own check.
  if (ops.assessTrust) {
    var innerAssessTrust = ops.assessTrust;
    ops.assessTrust = function (id, q) {
      if (!q || !q.asOf) {
        var e2 = new Error('MYTHOS_KNOWLEDGE_ASOF: asOf is required — the AI layer never defaults to "now"');
        e2.code = 'MYTHOS_KNOWLEDGE_ASOF';
        throw e2;
      }
      return innerAssessTrust(id, q);
    };
  }

  // Rules 2–4: every hit is annotated. search() output keeps the
  // service's provenance field and gains a presentation block.
  var innerSearch = ops.search;
  ops.search = function (query, so) {
    return innerSearch(query, so).map(function (h) {
      return Object.assign({}, h, { presentation: presentationOf(service, h.id) });
    });
  };

  Object.freeze(ops);
  return { enabled: true, store_root: cfg.store_root, ops: ops };
}

module.exports = {
  DEFAULT_CONFIG_PATH: DEFAULT_CONFIG_PATH,
  READ_OPS: READ_OPS,
  loadConfig: loadConfig,
  validateConfigObject: validateConfigObject,
  openKnowledge: openKnowledge,
};
