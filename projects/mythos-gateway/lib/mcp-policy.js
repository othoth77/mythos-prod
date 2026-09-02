'use strict';
// =====================================================
// MYTHOS MCP permission matrix — the declared policy, evaluated
// projects/mythos-gateway/lib/mcp-policy.js
//
// NOT a fourth authorization engine. The enforcement points already
// exist: the OTH MCP tool set (no write tool), the executor policy engine
// (approvals as state), and ContextForge's per-client authentication.
// This module holds the matrix those points are verified against —
// subject × capability → decision — and answers one question: may THIS
// subject name THAT server.tool, and under which condition.
//
//   ALLOW       executable without further ceremony
//   CONTROLLED  executable only with a recorded, granted approval
//               (executor policy engine: requestApproval → decideApproval)
//   RESTRICTED  never available to an agent subject; a human subject may
//               hold it, and only as CONTROLLED
//   DENY        never
//
// A capability's own decision is a CEILING: a subject grant can only
// narrow it. `destructive` is DENY by hard floor and no configuration can
// raise it. Unclassified tools are DENIED — a tool that no rule names is
// a tool nobody decided about, and the safe reading of silence is no.
// =====================================================

var fs = require('fs');
var path = require('path');
var redact = require('../../mythos-orchestrator/lib/redact');

var DEFAULT_PERMISSIONS_PATH = path.join(__dirname, '..', 'registry', 'mcp-permissions.json');

// Ordered from most to least restrictive; the index is the rank.
var DECISIONS = ['DENY', 'RESTRICTED', 'CONTROLLED', 'ALLOW'];
var HARD_FLOOR = { destructive: 'DENY' };

var TOP_FIELDS = ['schema_version', 'note', 'decisions', 'default', 'capabilities', 'tool_classes', 'subjects'];
var CAP_FIELDS = ['decision', 'description'];
var RULE_FIELDS = ['server', 'tools', 'capability', 'note'];
var SUBJECT_FIELDS = ['description', 'human', 'grants'];
var CAP_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
var SUBJECT_NAME_RE = /^[a-z][a-z0-9-]{1,31}$/;
var SERVER_NAME_RE = /^([a-z0-9][a-z0-9-]{1,63}|\*)$/;

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function unknownFields(obj, allowed) {
  return Object.keys(obj).filter(function (k) { return allowed.indexOf(k) === -1; });
}
function rank(d) { return DECISIONS.indexOf(d); }
function narrower(a, b) { return rank(a) <= rank(b) ? a : b; }

// `*` is the only wildcard. Everything else in a pattern is literal.
function globToRegExp(glob) {
  var parts = String(glob).split('*').map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  return new RegExp('^' + parts.join('.*') + '$');
}

function validatePermissionsObject(raw, text) {
  var errors = [];
  if (typeof text === 'string') {
    var kinds = redact.findSecretKinds(text);
    if (kinds.length) return { valid: false, reason: 'secret-shaped content in permissions: ' + kinds.join(',') };
  }
  if (!isObj(raw)) return { valid: false, reason: 'permissions root is not an object' };
  unknownFields(raw, TOP_FIELDS).forEach(function (k) { errors.push('root: unknown field ' + k); });
  if (raw.schema_version !== '1.0.0') errors.push('root: schema_version must be 1.0.0');
  if (raw['default'] !== 'DENY') errors.push('root: default must be DENY — an unnamed grant is a denial');
  if (!isObj(raw.capabilities)) errors.push('capabilities must be an object');
  if (!Array.isArray(raw.tool_classes)) errors.push('tool_classes must be an array');
  if (!isObj(raw.subjects)) errors.push('subjects must be an object');
  if (errors.length) return { valid: false, reason: errors.join('; ') };

  var capabilities = {};
  Object.keys(raw.capabilities).forEach(function (name) {
    var c = raw.capabilities[name];
    if (!CAP_NAME_RE.test(name)) { errors.push('capabilities.' + name + ': invalid name'); return; }
    if (!isObj(c)) { errors.push('capabilities.' + name + ': not an object'); return; }
    unknownFields(c, CAP_FIELDS).forEach(function (k) { errors.push('capabilities.' + name + ': unknown field ' + k); });
    if (DECISIONS.indexOf(c.decision) === -1) { errors.push('capabilities.' + name + '.decision must be one of ' + DECISIONS.join('|')); return; }
    if (c.description !== undefined && typeof c.description !== 'string') errors.push('capabilities.' + name + '.description must be a string');
    capabilities[name] = { decision: c.decision, description: c.description || '' };
  });
  Object.keys(HARD_FLOOR).forEach(function (name) {
    if (!capabilities[name]) errors.push('capabilities.' + name + ' is required (hard floor ' + HARD_FLOOR[name] + ')');
    else if (capabilities[name].decision !== HARD_FLOOR[name]) errors.push('capabilities.' + name + ' is ' + HARD_FLOOR[name] + ' by hard floor and cannot be raised');
  });

  var rules = [];
  raw.tool_classes.forEach(function (r, i) {
    var w = 'tool_classes[' + i + ']';
    if (!isObj(r)) { errors.push(w + ': not an object'); return; }
    unknownFields(r, RULE_FIELDS).forEach(function (k) { errors.push(w + ': unknown field ' + k); });
    if (typeof r.server !== 'string' || !SERVER_NAME_RE.test(r.server)) errors.push(w + '.server must be a server name or *');
    if (!Array.isArray(r.tools) || !r.tools.length || !r.tools.every(function (t) { return typeof t === 'string' && t.length && t.length <= 64; })) errors.push(w + '.tools must be a non-empty array of tool globs');
    if (!capabilities[r.capability]) errors.push(w + '.capability names an undeclared capability ' + r.capability);
    if (r.note !== undefined && typeof r.note !== 'string') errors.push(w + '.note must be a string');
    if (errors.length) return;
    rules.push({ index: i, server: r.server, tools: r.tools.slice(), res: r.tools.map(globToRegExp), capability: r.capability });
  });

  var subjects = {};
  Object.keys(raw.subjects).forEach(function (name) {
    var s = raw.subjects[name];
    var w = 'subjects.' + name;
    if (!SUBJECT_NAME_RE.test(name)) { errors.push(w + ': invalid name'); return; }
    if (!isObj(s)) { errors.push(w + ': not an object'); return; }
    unknownFields(s, SUBJECT_FIELDS).forEach(function (k) { errors.push(w + ': unknown field ' + k); });
    if (s.human !== undefined && typeof s.human !== 'boolean') errors.push(w + '.human must be a boolean');
    if (!isObj(s.grants)) { errors.push(w + '.grants must be an object'); return; }
    var grants = {};
    Object.keys(s.grants).forEach(function (cap) {
      if (!capabilities[cap]) { errors.push(w + '.grants names an undeclared capability ' + cap); return; }
      if (DECISIONS.indexOf(s.grants[cap]) === -1) { errors.push(w + '.grants.' + cap + ' must be one of ' + DECISIONS.join('|')); return; }
      grants[cap] = s.grants[cap];
    });
    subjects[name] = { description: s.description || '', human: s.human === true, grants: grants };
  });

  if (errors.length) return { valid: false, reason: errors.join('; ') };
  return { valid: true, policy: { valid: true, 'default': 'DENY', capabilities: capabilities, rules: rules, subjects: subjects } };
}

function loadPermissions(permissionsPath) {
  permissionsPath = permissionsPath || process.env.MYTHOS_MCP_PERMISSIONS_FILE || DEFAULT_PERMISSIONS_PATH;
  var text;
  try { text = fs.readFileSync(permissionsPath, 'utf8'); }
  catch (e) { return { valid: false, policy: null, reason: 'permissions unreadable: ' + e.message, path: permissionsPath }; }
  var raw;
  try { raw = JSON.parse(text); }
  catch (e) { return { valid: false, policy: null, reason: 'permissions are not valid JSON: ' + e.message, path: permissionsPath }; }
  var r = validatePermissionsObject(raw, text);
  if (!r.valid) return { valid: false, policy: null, reason: r.reason, path: permissionsPath };
  return { valid: true, policy: r.policy, reason: null, path: permissionsPath };
}

// First matching rule wins — which is why `delete_*` is listed before the
// broad read globs in the shipped matrix.
function classify(policy, server, tool) {
  if (!policy || !policy.valid) return null;
  for (var i = 0; i < policy.rules.length; i++) {
    var r = policy.rules[i];
    if (r.server !== '*' && r.server !== server) continue;
    for (var j = 0; j < r.res.length; j++) {
      if (r.res[j].test(tool)) {
        return { capability: r.capability, ceiling: policy.capabilities[r.capability].decision, rule_index: r.index };
      }
    }
  }
  return null;
}

// The one question. Always answers; never throws on bad input.
function authorize(policy, req) {
  var subjectName = req && typeof req.subject === 'string' ? req.subject : null;
  var server = req && typeof req.server === 'string' ? req.server : null;
  var tool = req && typeof req.tool === 'string' ? req.tool : null;
  var base = { subject: subjectName, server: server, tool: tool, capability: null, ceiling: null, grant: null, requires_approval: false };

  function deny(reason) { return Object.assign({}, base, { decision: 'DENY', reason: reason }); }

  if (!policy || !policy.valid) return deny('permissions unavailable — fail closed');
  if (!subjectName || !server || !tool) return deny('subject, server and tool are required');
  var subject = policy.subjects[subjectName];
  if (!subject) return deny('unknown subject ' + subjectName);
  var cls = classify(policy, server, tool);
  if (!cls) return deny('unclassified tool ' + server + '.' + tool + ' — no rule names it');

  var ceiling = cls.ceiling;
  var grant = Object.prototype.hasOwnProperty.call(subject.grants, cls.capability) ? subject.grants[cls.capability] : policy['default'];
  var effective = narrower(ceiling, grant);
  var reason = 'capability ' + cls.capability + ' is ' + ceiling + ', subject grant is ' + grant;
  var out = Object.assign({}, base, { capability: cls.capability, ceiling: ceiling, grant: grant });

  if (effective === 'RESTRICTED') {
    if (subject.human) {
      effective = 'CONTROLLED';
      reason = 'restricted capability ' + cls.capability + ': human subject, approval required';
    } else {
      effective = 'DENY';
      reason = 'restricted capability ' + cls.capability + ': not available to an agent subject';
    }
  }
  out.decision = effective;
  out.requires_approval = effective === 'CONTROLLED';
  out.reason = reason;
  return out;
}

module.exports = {
  DECISIONS: DECISIONS,
  HARD_FLOOR: HARD_FLOOR,
  DEFAULT_PERMISSIONS_PATH: DEFAULT_PERMISSIONS_PATH,
  validatePermissionsObject: validatePermissionsObject,
  loadPermissions: loadPermissions,
  classify: classify,
  authorize: authorize,
  rank: rank,
  globToRegExp: globToRegExp
};
