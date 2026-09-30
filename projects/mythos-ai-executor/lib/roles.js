'use strict';
// =====================================================
// Mythos AI Executor — AI-team roles (MYTHOS HADDAD V2.1)
// projects/mythos-ai-executor/lib/roles.js
//
// A ROLE is a tuple over vocabulary that already exists, held in
// config/roles.json:
//
//   role = (action, task_type, capabilities_required, skill_category, brief)
//
// It is NOT a runtime, a process, a model, a permission dictionary or a
// second skill system. Everything a role points at is owned elsewhere:
//   * the ACTION is the closed bridge set (investigate/review/test/document/
//     implement) — bridge/action-resolution.js maps it to the execution
//     profile and the delivery, and that mapping is deliberately NOT
//     restated here (a second action→profile table would drift);
//   * the SKILL CATEGORY names an entry of the existing, trust-attested
//     runtime skill registry (lib/skills.js), so the prompt section a role
//     injects is a pack the ledger already ACCEPTed — no new skill file;
//   * the CAPABILITIES are the ones core/agent-registry.js selects agents
//     by, so a role is exactly "what an agent must advertise to take it";
//   * the TASK TYPE is the core planner/router vocabulary (V2.2 routes on it).
//
// Resolution is deterministic and server-side: the action decides, and
// nothing an Issue or an API caller writes can name a role (executor.js
// derives it after the envelope validates). Fail closed: a malformed table
// darkens the WHOLE role layer — resolveRole answers { role: null } with the
// reason and the executor behaves exactly as before V2.1.
// =====================================================

var fs = require('fs');
var path = require('path');

var engine = require('../bridge/action-resolution');

var DEFAULT_TABLE_PATH = path.join(__dirname, '..', 'config', 'roles.json');

var ROLE_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
var SLUG_RE = /^[a-z][a-z0-9_-]{1,40}$/;
var REQUIRED = ['action', 'task_type', 'capabilities_required', 'skill_category', 'brief'];
var OPTIONAL = ['match'];
var MAX_BRIEF = 240;
var MAX_MATCH = 120;

function validateRole(id, def, errors) {
  if (!ROLE_ID_RE.test(id)) { errors.push(String(id).slice(0, 40) + ': invalid role id'); return; }
  if (!def || typeof def !== 'object' || Array.isArray(def)) { errors.push(id + ': not an object'); return; }
  var keys = Object.keys(def);
  var unknown = keys.filter(function (k) { return REQUIRED.indexOf(k) === -1 && OPTIONAL.indexOf(k) === -1; });
  if (unknown.length) { errors.push(id + ': unknown field(s) ' + unknown.join(',')); return; }
  var missing = REQUIRED.filter(function (k) { return !Object.prototype.hasOwnProperty.call(def, k); });
  if (missing.length) { errors.push(id + ': missing field(s) ' + missing.join(',')); return; }
  if (typeof def.action !== 'string' || engine.profileFor(def.action) === null) {
    errors.push(id + ': action must be one of the closed bridge actions'); return;
  }
  if (typeof def.task_type !== 'string' || !SLUG_RE.test(def.task_type)) { errors.push(id + ': task_type must be a slug'); return; }
  if (!Array.isArray(def.capabilities_required) || !def.capabilities_required.length ||
      !def.capabilities_required.every(function (c) { return typeof c === 'string' && SLUG_RE.test(c); })) {
    errors.push(id + ': capabilities_required must be a non-empty array of slugs'); return;
  }
  if (typeof def.skill_category !== 'string' || !SLUG_RE.test(def.skill_category)) { errors.push(id + ': skill_category must be a slug'); return; }
  // The brief is ONE line of bounded prose. It is rendered into a system
  // prompt, so it may not carry a code fence, a heading or a newline that
  // could open a structural section of its own.
  if (typeof def.brief !== 'string' || !def.brief.trim() || def.brief.length > MAX_BRIEF ||
      /[\r\n`#{}<>]/.test(def.brief)) {
    errors.push(id + ': brief must be one line, <= ' + MAX_BRIEF + ' chars, without newlines, backticks, #, braces or angle brackets'); return;
  }
  if (Object.prototype.hasOwnProperty.call(def, 'match')) {
    if (typeof def.match !== 'string' || !def.match || def.match.length > MAX_MATCH) { errors.push(id + ': match must be a non-empty string <= ' + MAX_MATCH + ' chars'); return; }
    try { new RegExp(def.match, 'i'); } catch (e) { errors.push(id + ': match is not a valid regular expression'); return; }
  }
}

// Validates a parsed table. Exported so tests feed fixtures without disk.
// Returns { valid, roles, reason }. Invariant beyond per-role shape: every
// action that appears has EXACTLY ONE default (no `match`) role, so
// resolution can never depend on JSON key order.
function validateTableObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, reason: 'table root is not an object' };
  if (!raw.roles || typeof raw.roles !== 'object' || Array.isArray(raw.roles)) return { valid: false, reason: 'table has no roles object' };
  var errors = [];
  var ids = Object.keys(raw.roles);
  if (!ids.length) return { valid: false, reason: 'no roles defined' };
  ids.forEach(function (id) { validateRole(id, raw.roles[id], errors); });
  if (errors.length) return { valid: false, reason: errors.join('; ') };
  var defaults = Object.create(null);
  ids.forEach(function (id) {
    var d = raw.roles[id];
    if (d.match) return;
    if (defaults[d.action]) errors.push('action "' + d.action + '" has two default roles: ' + defaults[d.action] + ' and ' + id);
    else defaults[d.action] = id;
  });
  ids.forEach(function (id) {
    var d = raw.roles[id];
    if (d.match && !defaults[d.action]) errors.push('role ' + id + ' matches on action "' + d.action + '" which has no default role');
  });
  if (errors.length) return { valid: false, reason: errors.join('; ') };
  var roles = Object.create(null);
  ids.forEach(function (id) { roles[id] = Object.assign({ id: id }, raw.roles[id]); });
  return { valid: true, roles: roles, order: ids, reason: null };
}

function loadTable(tablePath) {
  tablePath = tablePath || DEFAULT_TABLE_PATH;
  var raw;
  try { raw = JSON.parse(fs.readFileSync(tablePath, 'utf8')); }
  catch (e) {
    var why = 'roles table unreadable or not valid JSON: ' + e.message;
    console.error('[mythos-ai-executor] role layer disabled: ' + why);
    return { valid: false, roles: {}, order: [], reason: why };
  }
  var v = validateTableObject(raw);
  if (!v.valid) {
    console.error('[mythos-ai-executor] role layer disabled: ' + v.reason);
    return { valid: false, roles: {}, order: [], reason: v.reason };
  }
  return v;
}

var DEFAULT_TABLE = loadTable();

// Deterministic resolution. input: { action, instruction }. Returns
// { role, reason }. The action decides; among the roles for that action the
// `match` roles are tried in file order against the instruction text, and
// the default role is the answer when none matches. A category that is not
// a bridge action (an API caller's free-form task_category) has no role.
function resolveRole(input, table) {
  table = table || DEFAULT_TABLE;
  input = input || {};
  if (!table.valid) return { role: null, reason: 'roles_invalid: ' + table.reason };
  var action = input.action;
  if (!action || engine.profileFor(action) === null) return { role: null, reason: 'no_role_for_category:' + String(action || '').slice(0, 40) };
  var text = String(input.instruction || '');
  var fallback = null;
  for (var i = 0; i < table.order.length; i++) {
    var r = table.roles[table.order[i]];
    if (r.action !== action) continue;
    if (r.match) {
      if (new RegExp(r.match, 'i').test(text)) return { role: r, reason: 'action:' + action + '+match:' + r.id };
    } else if (!fallback) {
      fallback = r;
    }
  }
  if (fallback) return { role: fallback, reason: 'action:' + action };
  return { role: null, reason: 'no_role_for_action:' + action };
}

function getRole(id, table) {
  table = table || DEFAULT_TABLE;
  if (!table.valid || !id) return null;
  return table.roles[id] || null;
}

// The profile a role runs under is the ACTION's profile — derived, never
// stored on the role. Exposed so a test can assert the two never diverge.
function profileForRole(role) { return role ? engine.profileFor(role.action) : null; }
function deliveryForRole(role) { return role ? engine.deliveryFor(role.action) : null; }

function listForApi(table) {
  table = table || DEFAULT_TABLE;
  if (!table.valid) return [];
  return table.order.map(function (id) {
    var r = table.roles[id];
    return { id: id, action: r.action, execution_profile: profileForRole(r), delivery: deliveryForRole(r),
      task_type: r.task_type, capabilities_required: r.capabilities_required.slice(),
      skill_category: r.skill_category, match: r.match || null };
  });
}

module.exports = {
  DEFAULT_TABLE_PATH: DEFAULT_TABLE_PATH,
  DEFAULT_TABLE: DEFAULT_TABLE,
  MAX_BRIEF: MAX_BRIEF,
  validateTableObject: validateTableObject,
  loadTable: loadTable,
  resolveRole: resolveRole,
  getRole: getRole,
  profileForRole: profileForRole,
  deliveryForRole: deliveryForRole,
  listForApi: listForApi
};
