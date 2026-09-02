'use strict';
// =====================================================
// MYTHOS Vault — credential inventory (MYTHOS_VAULT_ARCHITECTURE §10 step 1)
// projects/mythos-vault/lib/inventory.js
//
// METADATA ONLY. This module knows that a credential EXISTS, who owns it,
// where it lives, what mode it should carry, which environment variable
// NAME carries it into a consumer, and what its lifecycle status is. It
// never reads a value: the only files it opens are the inventory itself
// and /etc/passwd (to name a uid). A check that could print a secret by
// accident is not a check anyone can run safely.
//
// NO BACKEND, NO BROKER (§11 — owner decisions not taken). The one
// "resolution" offered is name-level: valueFromEnv() returns
// process.env[<name>] for a reference, which is exactly what a consumer
// already running in the right account could read for itself. It hands
// back what the account already holds; it opens nothing to get it.
//
// The governance signing key is deliberately NOT an entry (§3): a
// credential layer must never be able to authorise its own modification.
// =====================================================

var fs = require('fs');
var path = require('path');
var os = require('os');
var redact = require('../../mythos-orchestrator/lib/redact');

var DEFAULT_INVENTORY_PATH = path.join(__dirname, '..', 'credential-inventory.json');
var CRED_REF_RE = /^cred_[a-z0-9][a-z0-9_-]{2,62}$/;
var STATUSES = ['active', 'expiring', 'expired', 'revoked', 'compromised', 'absent'];
var ENVIRONMENTS = ['production', 'staging', 'development'];
var POSIX_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
var ENV_VAR_RE = /^[A-Z][A-Z0-9_]{2,63}$/;
var MODE_RE = /^0[0-7]{3}$/;
var ISO_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

var TOP_FIELDS = ['schema_version', 'note', 'excluded', 'credentials'];
var ENTRY_FIELDS = ['id', 'provider', 'purpose', 'environment', 'owner', 'location', 'expected_mode', 'expected_owner',
  'env_var', 'consumers', 'status', 'created_at', 'rotated_at', 'expires_at', 'rotation_policy', 'copies_of', 'note'];
var EXCLUDED_FIELDS = ['location', 'reason'];
// A key that could only ever hold a value has no business in this file.
var FORBIDDEN_KEY_RE = /^(value|secret|secret_value|token_value|password|plaintext|key_material|private_key)$/i;

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function unknownFields(obj, allowed) {
  return Object.keys(obj).filter(function (k) { return allowed.indexOf(k) === -1; });
}
function scanForbidden(obj, where, errors) {
  if (!obj || typeof obj !== 'object') return;
  Object.keys(obj).forEach(function (k) {
    if (!Array.isArray(obj) && FORBIDDEN_KEY_RE.test(k)) errors.push(where + '.' + k + ': a value-bearing key is forbidden in the inventory by permanent schema rule');
    scanForbidden(obj[k], where + '.' + k, errors);
  });
}
function nullOr(v, pred) { return v === null || v === undefined || pred(v); }

function validateInventoryObject(raw, text) {
  var errors = [];
  if (typeof text === 'string') {
    var kinds = redact.findSecretKinds(text);
    if (kinds.length) return { valid: false, reason: 'secret-shaped content in inventory: ' + kinds.join(',') };
  }
  if (!isObj(raw)) return { valid: false, reason: 'inventory root is not an object' };
  unknownFields(raw, TOP_FIELDS).forEach(function (k) { errors.push('root: unknown field ' + k); });
  if (raw.schema_version !== '1.0.0') errors.push('root: schema_version must be 1.0.0');
  if (!Array.isArray(raw.credentials)) errors.push('credentials must be an array');
  scanForbidden(raw, 'root', errors);
  if (errors.length) return { valid: false, reason: errors.join('; ') };

  if (raw.excluded !== undefined) {
    if (!Array.isArray(raw.excluded)) errors.push('excluded must be an array');
    else raw.excluded.forEach(function (x, i) {
      if (!isObj(x)) { errors.push('excluded[' + i + ']: not an object'); return; }
      unknownFields(x, EXCLUDED_FIELDS).forEach(function (k) { errors.push('excluded[' + i + ']: unknown field ' + k); });
      if (typeof x.location !== 'string' || !path.isAbsolute(x.location)) errors.push('excluded[' + i + '].location must be an absolute path');
      if (typeof x.reason !== 'string' || !x.reason.trim()) errors.push('excluded[' + i + '].reason must be a non-empty string');
    });
  }

  var byId = {};
  raw.credentials.forEach(function (c, i) {
    var w = 'credentials[' + i + ']';
    if (!isObj(c)) { errors.push(w + ': not an object'); return; }
    unknownFields(c, ENTRY_FIELDS).forEach(function (k) { errors.push(w + ': unknown field ' + k); });
    if (typeof c.id !== 'string' || !CRED_REF_RE.test(c.id)) { errors.push(w + '.id must match cred_…'); return; }
    w = 'credentials.' + c.id;
    if (byId[c.id]) errors.push(w + ': duplicate id');
    if (typeof c.provider !== 'string' || !c.provider.trim()) errors.push(w + '.provider must be a non-empty string');
    if (typeof c.purpose !== 'string' || !c.purpose.trim()) errors.push(w + '.purpose must be a non-empty string');
    if (ENVIRONMENTS.indexOf(c.environment) === -1) errors.push(w + '.environment must be one of ' + ENVIRONMENTS.join('|'));
    if (typeof c.owner !== 'string' || !POSIX_RE.test(c.owner)) errors.push(w + '.owner must be a POSIX account name');
    if (!nullOr(c.location, function (v) { return typeof v === 'string' && path.isAbsolute(v); })) errors.push(w + '.location must be an absolute path or null');
    if (!nullOr(c.expected_mode, function (v) { return typeof v === 'string' && MODE_RE.test(v); })) errors.push(w + '.expected_mode must be like 0600 or null');
    if (!nullOr(c.expected_owner, function (v) { return typeof v === 'string' && POSIX_RE.test(v); })) errors.push(w + '.expected_owner must be a POSIX account name or null');
    if (!nullOr(c.env_var, function (v) { return typeof v === 'string' && ENV_VAR_RE.test(v); })) errors.push(w + '.env_var must be an environment variable NAME or null');
    if (!Array.isArray(c.consumers) || !c.consumers.every(function (x) { return typeof x === 'string'; })) errors.push(w + '.consumers must be an array of strings');
    if (STATUSES.indexOf(c.status) === -1) errors.push(w + '.status must be one of ' + STATUSES.join('|'));
    ['created_at', 'rotated_at', 'expires_at'].forEach(function (k) {
      if (!nullOr(c[k], function (v) { return typeof v === 'string' && ISO_RE.test(v); })) errors.push(w + '.' + k + ' must be an ISO date or null');
    });
    if (typeof c.rotation_policy !== 'string' || !c.rotation_policy.trim()) errors.push(w + '.rotation_policy must be a non-empty string');
    if (c.copies_of !== undefined && (!Array.isArray(c.copies_of) || !c.copies_of.every(function (x) { return typeof x === 'string' && CRED_REF_RE.test(x); }))) errors.push(w + '.copies_of must be an array of cred_ references');
    if (c.note !== undefined && typeof c.note !== 'string') errors.push(w + '.note must be a string');
    if (c.status === 'absent' && c.location !== null && c.location !== undefined) errors.push(w + ': an absent credential has no location');
    if (c.status !== 'absent' && (c.location === null || c.location === undefined)) errors.push(w + ': a present credential must record its location');
    byId[c.id] = c;
  });
  Object.keys(byId).forEach(function (id) {
    (byId[id].copies_of || []).forEach(function (ref) { if (!byId[ref]) errors.push('credentials.' + id + '.copies_of names an unknown reference ' + ref); });
  });
  if (errors.length) return { valid: false, reason: errors.join('; ') };
  return { valid: true, credentials: byId, list: raw.credentials.slice(), excluded: raw.excluded || [] };
}

function loadInventory(inventoryPath) {
  inventoryPath = inventoryPath || process.env.MYTHOS_VAULT_INVENTORY_FILE || DEFAULT_INVENTORY_PATH;
  var text;
  try { text = fs.readFileSync(inventoryPath, 'utf8'); }
  catch (e) { return { valid: false, credentials: {}, list: [], reason: 'inventory unreadable: ' + e.message, path: inventoryPath }; }
  var raw;
  try { raw = JSON.parse(text); }
  catch (e) { return { valid: false, credentials: {}, list: [], reason: 'inventory is not valid JSON: ' + e.message, path: inventoryPath }; }
  var r = validateInventoryObject(raw, text);
  if (!r.valid) return { valid: false, credentials: {}, list: [], reason: r.reason, path: inventoryPath };
  return { valid: true, credentials: r.credentials, list: r.list, excluded: r.excluded, reason: null, path: inventoryPath };
}

// Name-level resolution: which environment variable carries this reference.
function envVarFor(inventory, ref) {
  if (!inventory || !inventory.valid) return null;
  var c = inventory.credentials[ref];
  return c && c.env_var ? c.env_var : null;
}

// Value-level resolution FROM THE CALLER'S OWN ENVIRONMENT. Nothing is
// opened; if the account running this process was not given the variable,
// the answer is null and the caller reports UNAUTHORIZED. The value is
// returned to the caller and to nobody else — never logged here.
function valueFromEnv(inventory, ref, env) {
  var name = envVarFor(inventory, ref);
  if (!name) return null;
  var v = (env || process.env)[name];
  return typeof v === 'string' && v.length ? v : null;
}

// --------------------------------------------------------------- checking

var _passwd = null;
function uidToName(uid) {
  if (_passwd === null) {
    _passwd = {};
    try {
      fs.readFileSync('/etc/passwd', 'utf8').split('\n').forEach(function (line) {
        var p = line.split(':');
        if (p.length > 2) _passwd[p[2]] = p[0];
      });
    } catch (e) { /* unknown uids stay numeric */ }
  }
  return _passwd[String(uid)] || String(uid);
}

// stat only. exists is a tri-state: true, false, or null when this account
// may not look (EACCES) — the OTHMODE credential_presence rule: never
// report "absent" for merely-unreadable.
function checkEntry(entry) {
  var out = { id: entry.id, status: entry.status, location: entry.location || null, exists: null,
    owner_actual: null, mode_actual: null, drift: [], ok: true };
  if (!entry.location) {
    out.exists = false;
    if (entry.status !== 'absent') { out.drift.push('no location recorded for a present credential'); out.ok = false; }
    return out;
  }
  var st;
  try { st = fs.statSync(entry.location); }
  catch (e) {
    if (e.code === 'ENOENT') {
      out.exists = false;
      if (entry.status !== 'absent') { out.drift.push('file missing'); out.ok = false; }
    } else if (e.code === 'EACCES' || e.code === 'EPERM') {
      out.exists = null;
      out.drift.push('unknowable from this account (' + e.code + ')');
    } else {
      out.exists = null;
      out.drift.push('stat failed: ' + e.code);
      out.ok = false;
    }
    return out;
  }
  out.exists = true;
  if (entry.status === 'absent') { out.drift.push('recorded absent but a file exists'); out.ok = false; }
  var mode = st.mode & 0o777;
  out.mode_actual = '0' + mode.toString(8).padStart(3, '0');
  out.owner_actual = uidToName(st.uid);
  if (entry.expected_mode) {
    var expected = parseInt(entry.expected_mode, 8);
    if ((mode & ~expected) !== 0) { out.drift.push('mode ' + out.mode_actual + ' is wider than expected ' + entry.expected_mode); out.ok = false; }
  }
  if (entry.expected_owner && out.owner_actual !== entry.expected_owner) {
    out.drift.push('owner ' + out.owner_actual + ' differs from expected ' + entry.expected_owner);
    out.ok = false;
  }
  if (entry.expires_at && new Date(entry.expires_at).getTime() < Date.now()) {
    out.drift.push('past expires_at ' + entry.expires_at);
    out.ok = false;
  }
  return out;
}

function checkInventory(inventory) {
  var results = inventory.list.map(checkEntry);
  var summary = { checked: results.length, ok: 0, drift: 0, absent: 0, unknowable: 0 };
  results.forEach(function (r) {
    if (r.exists === null) summary.unknowable++;
    if (r.exists === false) summary.absent++;
    if (r.ok) summary.ok++; else summary.drift++;
  });
  return {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    checked_as: (function () { try { return os.userInfo().username; } catch (e) { return null; } })(),
    inventory: inventory.path,
    results: results,
    summary: summary,
    ok: summary.drift === 0
  };
}

module.exports = {
  DEFAULT_INVENTORY_PATH: DEFAULT_INVENTORY_PATH,
  CRED_REF_RE: CRED_REF_RE,
  STATUSES: STATUSES,
  validateInventoryObject: validateInventoryObject,
  loadInventory: loadInventory,
  envVarFor: envVarFor,
  valueFromEnv: valueFromEnv,
  checkEntry: checkEntry,
  checkInventory: checkInventory
};
