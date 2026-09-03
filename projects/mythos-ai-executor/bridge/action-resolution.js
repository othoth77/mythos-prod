'use strict';
// =====================================================
// MYTHOS Action Resolution Engine
// projects/mythos-ai-executor/bridge/action-resolution.js
//
// THE single source of truth for three decisions that used to be scattered
// across the Issues adapter, the bridge and the executor, and that drifted
// apart exactly where it hurt (gh-issue-111 / 114 / 117 / 118):
//
//   1. requested_action  — what the Issue / task asked for, and WHERE that
//                          answer came from (action_source) and what was
//                          literally written (action_raw);
//   2. execution_profile — the closed server-side mapping action → profile,
//                          enforced as an invariant (ACTION_PROFILE_MISMATCH)
//                          that stops a task BEFORE any provider starts;
//   3. model             — the explicit model request, kept explicit: an
//                          unavailable model is a BLOCKED MODEL_UNAVAILABLE
//                          decision, never a silent substitution.
//
// Precedence (explicit current ALWAYS wins):
//
//   explicit `Action` in the CURRENT Issue body
//     > `action:<x>` label on the Issue
//       > requested_action inherited from the previous attempt (rerun only)
//         > configured default (first attempt only)
//
// Every recognised way of writing a scalar field is parsed by ONE function,
// extractFields(), which the adapter uses instead of reaching into
// `sections.<key>[0]` (the exact access pattern that returned "" for
// `## Action\n\n**implement**` and never saw `## Action: implement` at all):
//
//   Action: implement            - Action: implement         1. Action: implement
//   **Action:** implement        **Action**: implement       ## Action: implement
//   ## Action                    | Action | implement |      action: implement
//   (blank lines)                                            ACTION: IMPLEMENT
//   implement
//
// Nothing here performs I/O, touches Git, or knows about GitHub. Pure
// functions only, so the same code is exercised by the adapter, the bridge,
// the executor and the tests.
// =====================================================

var crypto = require('crypto');

var ACTIONS = ['investigate', 'review', 'test', 'document', 'implement'];

// requested_action → execution profile. Server-side and closed: a task can
// never name a profile, and `autonomous` / `deploy` are not reachable from
// GitHub at all (deploy is disabled in lib/policy.js regardless).
var PROFILE_BY_ACTION = {
  investigate: 'repo-read',
  review: 'repo-read',
  test: 'repo-test',
  document: 'repo-write',
  implement: 'repo-write'
};
var DELIVERY_BY_ACTION = {
  investigate: 'report', review: 'report', test: 'report', document: 'commit', implement: 'commit'
};

var ACTION_SYNONYMS = {
  investigate: 'investigate', investigation: 'investigate', analyse: 'investigate', analyze: 'investigate', analysis: 'investigate', research: 'investigate', 'تحقيق': 'investigate', 'بحث': 'investigate',
  review: 'review', 'مراجعة': 'review',
  test: 'test', testing: 'test', tests: 'test', 'اختبار': 'test',
  document: 'document', docs: 'document', documentation: 'document', 'توثيق': 'document',
  implement: 'implement', implementation: 'implement', build: 'implement', fix: 'implement', 'تنفيذ': 'implement'
};

// Field names an Issue may use for each scalar (lower-case, whitespace-folded).
var FIELD_ALIASES = {
  action: ['action', 'requested action', 'requested_action', 'requested-action', 'الإجراء', 'نوع المهمة'],
  model: ['model', 'claude model', 'النموذج', 'نموذج'],
  priority: ['priority', 'الأولوية'],
  depends_on: ['depends on', 'depends_on', 'depends-on', 'dependencies', 'يعتمد على', 'الاعتماديات'],
  timeout: ['timeout', 'timeout seconds', 'timeout_seconds', 'المهلة'],
  max_turns: ['max turns', 'max_turns', 'max-turns']
};
var FIELD_KEYS = Object.keys(FIELD_ALIASES);

var ACTION_SOURCES = ['explicit_current_issue', 'action_label', 'inherited_previous_attempt', 'default', 'task_file'];
var MODEL_SOURCES = ['explicit_current_issue', 'model_label', 'inherited_previous_attempt', 'task_file', 'none'];

// Blocker codes the bridge and executor raise BEFORE a provider starts, or
// classify a finished run into. None of these is retried automatically:
// retrying cannot change an action, a profile, a policy or a permission.
var BLOCKER_CODES = {
  ACTION_PROFILE_MISMATCH: 'ACTION_PROFILE_MISMATCH',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  ATTEMPT_SNAPSHOT_MUTATED: 'ATTEMPT_SNAPSHOT_MUTATED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  GOVERNANCE_DENIED: 'GOVERNANCE_DENIED',
  HUMAN_APPROVAL: 'HUMAN_APPROVAL',
  RUNTIME_IDENTITY_UNVERIFIED: 'RUNTIME_IDENTITY_UNVERIFIED',
  STALE_WORKER: 'STALE_WORKER',
  NO_STRUCTURED_REPORT: 'NO_STRUCTURED_REPORT',
  PROVIDER_BLOCKED: 'PROVIDER_BLOCKED',
  PROVIDER_FAILED: 'PROVIDER_FAILED'
};
var NON_RETRYABLE = [
  BLOCKER_CODES.ACTION_PROFILE_MISMATCH, BLOCKER_CODES.MODEL_UNAVAILABLE, BLOCKER_CODES.ATTEMPT_SNAPSHOT_MUTATED,
  BLOCKER_CODES.PERMISSION_DENIED, BLOCKER_CODES.GOVERNANCE_DENIED, BLOCKER_CODES.HUMAN_APPROVAL,
  BLOCKER_CODES.STALE_WORKER, BLOCKER_CODES.PROVIDER_BLOCKED
];

function isRetryable(code) { return NON_RETRYABLE.indexOf(String(code || '')) === -1; }

// --- Text helpers ------------------------------------------------------------------

function foldKey(s) {
  return String(s || '')
    .replace(/[`'"]/g, '')
    .replace(/^[#*_\s]+|[*_:\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// "**implement**" / "`implement`" / "implement." / "IMPLEMENT" → "implement"
function cleanValue(s) {
  return String(s || '')
    .replace(/[`*_"']/g, '')
    .replace(/^\s*[-*+•]\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;,،]+$/g, '')
    .trim();
}

function fieldFor(name) {
  var k = foldKey(name);
  if (!k) return null;
  for (var i = 0; i < FIELD_KEYS.length; i++) {
    if (FIELD_ALIASES[FIELD_KEYS[i]].indexOf(k) !== -1) return FIELD_KEYS[i];
  }
  return null;
}

// --- Field extraction (one parser for every accepted form) --------------------------

var BULLET_RE = /^\s{0,3}(?:[-*+•]|\d+[.)])\s+/;
var HEADING_RE = /^\s{0,3}#{1,6}\s*(.+?)\s*#*\s*$/;
var BOLD_RE = /^\s{0,3}\*\*([^*]+?)\*\*\s*:?\s*(.*)$/;
var KV_RE = /^\s{0,3}([^\s:|][^:|]{0,40}?)\s*[:：]\s*(.*)$/;
var TABLE_RE = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/;
var FENCE_RE = /^\s{0,3}(```|~~~)/;
var TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// Returns { <field>: [ { raw, form, line } ... ] } for every scalar field
// found in the body, in document order. `raw` is the literal value as
// written (trimmed of markdown emphasis), never normalised — the decision
// layer normalises and records both.
function extractFields(body) {
  var out = {};
  var lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  var inFence = false;
  var pendingHeading = null; // { field, line } — `## Action` waiting for its value

  function push(field, raw, form, lineNo) {
    var v = cleanValue(raw);
    if (!v) return false;
    out[field] = out[field] || [];
    out[field].push({ raw: v, form: form, line: lineNo });
    return true;
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var n = i + 1;
    if (FENCE_RE.test(line)) { inFence = !inFence; pendingHeading = null; continue; }
    if (inFence) continue;
    var trimmed = line.trim();

    // A scalar heading (`## Action`) takes the FIRST non-blank line that
    // follows, across any number of blank lines. Any other heading or a
    // recognised field line closes the wait.
    if (pendingHeading) {
      if (!trimmed) continue;
      var h0 = HEADING_RE.exec(line);
      if (h0) { pendingHeading = null; /* fall through: the heading is handled below */ }
      else if (TABLE_SEP_RE.test(line)) { continue; }
      else {
        var tv = TABLE_RE.exec(line);
        var kv0 = KV_RE.exec(line.replace(BULLET_RE, ''));
        var asKey = kv0 && fieldFor(kv0[1]);
        if (asKey && asKey !== pendingHeading.field) { pendingHeading = null; /* fall through */ }
        else {
          var value = tv ? (fieldFor(tv[1]) === pendingHeading.field ? tv[2] : tv[1]) : (asKey ? kv0[2] : line);
          push(pendingHeading.field, value, 'heading_block', n);
          pendingHeading = null;
          continue;
        }
      }
    }

    var h = HEADING_RE.exec(line);
    if (h) {
      var text = h[1];
      var colon = KV_RE.exec(text);
      if (colon && fieldFor(colon[1])) {
        // `## Action: implement`
        if (!push(fieldFor(colon[1]), colon[2], 'heading_inline', n)) pendingHeading = { field: fieldFor(colon[1]), line: n };
        continue;
      }
      var hf = fieldFor(text);
      if (hf) { pendingHeading = { field: hf, line: n }; continue; }
      continue;
    }

    var t = TABLE_RE.exec(line);
    if (t) {
      if (TABLE_SEP_RE.test(line)) continue;
      var tf = fieldFor(t[1]);
      if (tf) push(tf, t[2], 'table', n);
      continue;
    }

    var stripped = line.replace(BULLET_RE, '');
    var bulleted = stripped !== line;
    var b = BOLD_RE.exec(stripped);
    if (b && fieldFor(b[1])) {
      if (!push(fieldFor(b[1]), b[2], bulleted ? 'bullet_bold' : 'bold', n)) pendingHeading = { field: fieldFor(b[1]), line: n };
      continue;
    }
    var kv = KV_RE.exec(stripped);
    if (kv && fieldFor(kv[1])) {
      if (!push(fieldFor(kv[1]), kv[2], bulleted ? 'bullet' : 'inline', n)) pendingHeading = { field: fieldFor(kv[1]), line: n };
      continue;
    }
  }
  return out;
}

function firstField(fields, key) {
  var list = fields && fields[key];
  return list && list.length ? list[0] : null;
}

// --- Action ------------------------------------------------------------------------

function normalizeAction(raw) {
  var k = foldKey(cleanValue(raw));
  if (!k) return null;
  if (ACTION_SYNONYMS[k]) return ACTION_SYNONYMS[k];
  // "implement (repo-write)" / "implement — write" → first word
  var first = k.split(/[\s(—–-]+/)[0];
  return ACTION_SYNONYMS[first] || null;
}

function labelValue(labels, prefix) {
  var re = new RegExp('^' + prefix + ':(.+)$', 'i');
  var hits = (labels || []).map(function (l) {
    var name = typeof l === 'string' ? l : (l && l.name);
    var m = re.exec(String(name || ''));
    return m ? m[1].trim() : null;
  }).filter(Boolean);
  return hits.length ? hits[0] : null;
}

// input: { body?, fields?, labels?, previous?, defaultAction? }
// → { requested_action, action_raw, action_source, candidates, conflict, error }
// Never throws. `error` is set when the winning value is not a known action
// (the caller rejects the Issue with that message); `requested_action` is
// then null. `previous` is the previous attempt's task object on a rerun;
// it is consulted ONLY when the current body and labels state nothing.
function resolveAction(input) {
  input = input || {};
  var fields = input.fields || extractFields(input.body);
  var candidates = [];
  (fields.action || []).forEach(function (f) {
    candidates.push({ source: 'explicit_current_issue', raw: f.raw, action: normalizeAction(f.raw), form: f.form, line: f.line });
  });
  var fromLabel = labelValue(input.labels, 'action');
  if (fromLabel) candidates.push({ source: 'action_label', raw: fromLabel, action: normalizeAction(fromLabel) });
  var prev = input.previous && typeof input.previous === 'object' ? input.previous : null;
  if (prev && prev.requested_action && PROFILE_BY_ACTION[prev.requested_action]) {
    // Only a DECIDED action is inheritable. A previous attempt that fell back
    // to the default never decided anything: carrying it forward as
    // "inherited" would dress a non-decision up as one (and pin a rerun to a
    // stale default if the configured default ever changes). A record with
    // no action_source at all (pre-engine parser, which defaulted silently)
    // is of unknown provenance and is not inherited either. Both are listed
    // for the audit trail but can never win.
    var prevSource = prev.action_source || null;
    var prevDecided = !!prevSource && prevSource !== 'default';
    candidates.push({ source: 'inherited_previous_attempt', raw: prev.requested_action, action: prev.requested_action, from: prev.task_id || null,
      previous_source: prevSource, eligible: prevDecided,
      ignored_reason: prevDecided ? null : 'previous attempt ' + (prev.task_id || '') + (prevSource ? ' was defaulted, not decided — a default is not inherited' : ' records no action_source (pre-engine parser) — unknown provenance is not inherited') });
  }
  var def = input.defaultAction || 'investigate';
  candidates.push({ source: 'default', raw: def, action: normalizeAction(def) || def });

  var winner = candidates.filter(function (c) { return c.eligible !== false; })[0];
  var out = {
    requested_action: winner.action || null,
    action_raw: winner.raw,
    action_source: winner.source,
    candidates: candidates,
    conflict: null,
    error: null
  };
  // A conflict is a DIFFERENT source that would have decided otherwise; a
  // second statement in the same body is not (the first one simply wins).
  var others = candidates.filter(function (c) { return c !== winner && c.eligible !== false && c.source !== winner.source && c.source !== 'default' && c.action && c.action !== winner.action; });
  if (others.length) {
    out.conflict = others.map(function (c) { return c.source + '=' + c.action; }).join(', ');
  }
  if (!out.requested_action) {
    out.error = 'Action "' + String(winner.raw).slice(0, 30) + '" (from ' + winner.source + ') is not one of ' + ACTIONS.join(', ');
  }
  return out;
}

// --- Action → profile invariant --------------------------------------------------------

function profileFor(action) { return PROFILE_BY_ACTION[action] || null; }
function deliveryFor(action) { return DELIVERY_BY_ACTION[action] || 'report'; }

// { ok:true, expected_profile } or { ok:false, code, expected_profile, actual_profile, requested_action, reason }
function checkActionProfile(action, profile) {
  var expected = profileFor(action);
  if (!expected) {
    return { ok: false, code: BLOCKER_CODES.ACTION_PROFILE_MISMATCH, requested_action: action || null, expected_profile: null, actual_profile: profile || null,
      reason: 'requested_action "' + String(action).slice(0, 30) + '" has no execution profile (known: ' + ACTIONS.join(', ') + ')' };
  }
  if (profile !== expected) {
    return { ok: false, code: BLOCKER_CODES.ACTION_PROFILE_MISMATCH, requested_action: action, expected_profile: expected, actual_profile: profile || null,
      reason: 'requested_action=' + action + ' requires execution_profile=' + expected + ' but the attempt carries ' + (profile || 'none') + ' — refused before any provider started' };
  }
  return { ok: true, code: null, requested_action: action, expected_profile: expected, actual_profile: profile, reason: null };
}

function assertActionProfile(action, profile, ctx) {
  var c = checkActionProfile(action, profile);
  if (c.ok) return c;
  var e = new Error(c.code + ': ' + c.reason + (ctx && ctx.task_id ? ' (task ' + ctx.task_id + (ctx.attempt_id ? ', attempt ' + ctx.attempt_id : '') + ')' : ''));
  e.code = c.code;
  e.details = Object.assign({}, c, ctx || {});
  throw e;
}

// --- Model -------------------------------------------------------------------------

// input: { body?, fields?, labels?, previous?, policy (lib/model-policy) }
// → { model_key, model_raw, model_source, available, model_id, error, available_models, reason, candidates }
//   model_key   : catalog key the request resolves to (also when disabled), or null when nothing was named
//   available   : true when that key is enabled on this host; false → the bridge blocks MODEL_UNAVAILABLE
//   error       : set ONLY when the name is unknown to the catalog (a typo class — rejected at intake)
function resolveModel(input) {
  input = input || {};
  var policy = input.policy;
  var fields = input.fields || extractFields(input.body);
  var candidates = [];
  (fields.model || []).forEach(function (f) { candidates.push({ source: 'explicit_current_issue', raw: f.raw, form: f.form, line: f.line }); });
  var fromLabel = labelValue(input.labels, 'model');
  if (fromLabel) candidates.push({ source: 'model_label', raw: fromLabel });
  var prev = input.previous && typeof input.previous === 'object' ? input.previous : null;
  if (prev && prev.model) candidates.push({ source: 'inherited_previous_attempt', raw: prev.model, from: prev.task_id || null });

  var out = { model_key: null, model_raw: null, model_source: 'none', available: null, model_id: null, error: null, available_models: [], reason: 'no model named — the executor scores the task', candidates: candidates };
  if (!candidates.length) return out;
  var winner = candidates[0];
  out.model_raw = winner.raw;
  out.model_source = winner.source;
  if (!policy || typeof policy.lookupKey !== 'function') {
    out.error = 'model policy unavailable';
    return out;
  }
  var hit = policy.lookupKey(winner.raw);
  out.available_models = policy.availableLabels ? policy.availableLabels() : (policy.allowedLabels ? policy.allowedLabels() : []);
  if (!hit) {
    out.error = 'Model: unknown model "' + String(winner.raw).slice(0, 40) + '" — accepted values: ' + out.available_models.join(', ');
    out.reason = out.error;
    return out;
  }
  out.model_key = hit.key;
  out.model_id = hit.model;
  out.available = hit.enabled === true;
  out.reason = out.available
    ? 'explicit:' + hit.key + ' (requested "' + winner.raw + '" via ' + winner.source + ')'
    : 'model "' + (hit.display_name || hit.key) + '" is not available on this host (' + (hit.disabled_reason || 'disabled in config/model-policy.json') + ') — requested explicitly, never substituted';
  return out;
}

// --- Attempt snapshot (immutability) ---------------------------------------------------

var SNAPSHOT_FIELDS = ['task_id', 'attempt_id', 'requested_action', 'action_raw', 'action_source', 'execution_profile', 'model', 'model_key',
  'objective', 'instruction', 'scope', 'constraints', 'validation_requirements', 'required_tests', 'notes', 'working_directory', 'branch'];

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    var o = {};
    Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = canonical(v[k]); });
    return o;
  }
  return v === undefined ? null : v;
}

function attemptSnapshot(obj) {
  var copy = {};
  SNAPSHOT_FIELDS.forEach(function (k) { if (obj && obj[k] !== undefined && obj[k] !== null) copy[k] = obj[k]; });
  return crypto.createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
}

function checkSnapshot(obj, expected) {
  var now = attemptSnapshot(obj);
  if (!expected) return { ok: true, sha256: now, reason: 'no snapshot recorded' };
  if (now === expected) return { ok: true, sha256: now, reason: null };
  return { ok: false, code: BLOCKER_CODES.ATTEMPT_SNAPSHOT_MUTATED, sha256: now, expected: expected,
    reason: 'the attempt\'s immutable fields (action/profile/model/inputs) changed after the decision was recorded — refused before any provider started' };
}

// --- Blocker record ---------------------------------------------------------------------

function blocker(code, details) {
  details = details || {};
  var b = { code: code, retryable: isRetryable(code), at: new Date().toISOString() };
  Object.keys(details).forEach(function (k) { if (details[k] !== undefined) b[k] = details[k]; });
  if (!b.reason) b.reason = code;
  return b;
}

function idempotencyKey(parts) {
  return crypto.createHash('sha256').update(parts.map(function (p) { return String(p == null ? '' : p); }).join('')).digest('hex');
}

module.exports = {
  ACTIONS: ACTIONS,
  PROFILE_BY_ACTION: PROFILE_BY_ACTION,
  DELIVERY_BY_ACTION: DELIVERY_BY_ACTION,
  ACTION_SYNONYMS: ACTION_SYNONYMS,
  FIELD_ALIASES: FIELD_ALIASES,
  ACTION_SOURCES: ACTION_SOURCES,
  MODEL_SOURCES: MODEL_SOURCES,
  BLOCKER_CODES: BLOCKER_CODES,
  NON_RETRYABLE: NON_RETRYABLE,
  SNAPSHOT_FIELDS: SNAPSHOT_FIELDS,
  isRetryable: isRetryable,
  foldKey: foldKey,
  cleanValue: cleanValue,
  fieldFor: fieldFor,
  extractFields: extractFields,
  firstField: firstField,
  normalizeAction: normalizeAction,
  labelValue: labelValue,
  resolveAction: resolveAction,
  profileFor: profileFor,
  deliveryFor: deliveryFor,
  checkActionProfile: checkActionProfile,
  assertActionProfile: assertActionProfile,
  resolveModel: resolveModel,
  attemptSnapshot: attemptSnapshot,
  checkSnapshot: checkSnapshot,
  blocker: blocker,
  idempotencyKey: idempotencyKey
};
