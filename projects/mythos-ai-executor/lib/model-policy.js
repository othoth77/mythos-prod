'use strict';
// =====================================================
// Mythos AI Executor — Claude model selection policy (Issue #100)
// projects/mythos-ai-executor/lib/model-policy.js
//
// ONE place decides which Claude model an execution runs on. Two rules,
// in this order:
//
//   1. EXPLICIT WINS. A task that names a model (`Model: Opus`) gets that
//      model, or is refused with a message naming the accepted values. A
//      named model is NEVER quietly replaced by another one.
//   2. ABSENT MEANS CHOSEN, NEVER INHERITED. A task that names nothing is
//      scored against a deterministic signal table and lands on haiku,
//      sonnet or opus. `--model` is then ALWAYS passed, so the Claude CLI's
//      own ambient default (today: the fable family) can never become the
//      executor's default by omission.
//
// Fable runs only on explicit request: every fable entry in the catalog is
// auto_selectable:false, so no scoring path can ever reach it.
//
// SECURITY. A task file (and therefore a GitHub Issue, and therefore an
// untrusted body of text) may CHOOSE a catalog key; it can never SUPPLY a
// model string. The only values that reach the `--model` argv position are
// the `model` fields of config/model-policy.json, each re-validated here
// against MODEL_RE (no whitespace, no leading '-', so a catalog entry can
// never smuggle a second CLI flag). Model choice carries no authority: the
// execution profile, tools, MCP capabilities and working directory are
// decided elsewhere and are unaffected by which model runs.
//
// FAIL SAFE, NOT FAIL DARK. lib/skills.js disables itself when its registry
// is malformed, because a mission runs fine with no skill. This layer must
// NOT do that: "no policy" would mean "no --model" would mean "whatever the
// CLI defaults to" — precisely the behaviour Issue #100 removes. An
// unreadable or invalid config therefore falls back to the BUILT_IN policy
// below (loudly, on stderr), and selection keeps working.
// =====================================================

var fs = require('fs');
var path = require('path');

var DEFAULT_POLICY_PATH = path.join(__dirname, '..', 'config', 'model-policy.json');

// A model string is passed straight to `claude --model <value>`. Anything
// that could be read as another argument, or that carries whitespace, is
// refused at load time — the catalog is configuration, not free text.
var MODEL_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
var KEY_RE = /^[a-z0-9][a-z0-9.-]{0,39}$/;
var TIERS = ['fast', 'balanced', 'deep'];
var REASON_MAX = 300;

// The policy that applies when config/model-policy.json cannot be trusted.
// Deliberately identical in shape to the file, and deliberately conservative:
// the balanced tier for everything, fable unreachable.
var BUILT_IN = {
  version: 'built-in',
  catalog: {
    haiku: {
      model: 'claude-haiku-4-5', tier: 'fast', display_name: 'Haiku 4.5',
      aliases: ['haiku'], auto_selectable: true, enabled: true
    },
    sonnet: {
      model: 'claude-sonnet-5', tier: 'balanced', display_name: 'Sonnet 5',
      aliases: ['sonnet'], auto_selectable: true, enabled: true
    },
    opus: {
      model: 'claude-opus-5', tier: 'deep', display_name: 'Opus 5',
      aliases: ['opus'], auto_selectable: true, enabled: true
    },
    'fable-5': {
      model: 'claude-fable-5', tier: 'special', display_name: 'Fable 5',
      aliases: ['fable', 'fable 5'], auto_selectable: false, enabled: true
    }
  },
  auto: {
    tiers: { fast: 'haiku', balanced: 'sonnet', deep: 'opus' },
    thresholds: { fast_max_score: 1, deep_min_score: 7 },
    signals: {
      execution_profile: { 'repo-read': 0, 'repo-test': 1, 'repo-write': 2, autonomous: 3, deploy: 3 },
      task_category: { investigate: 0, review: 0, test: 1, document: 1, implement: 3 },
      priority: { low: -1, normal: 0, high: 1 },
      instruction_length: [{ min_chars: 12000, score: 2 }, { min_chars: 6000, score: 1 }],
      complexity_terms: { per_hit: 1, max: 3, terms: [] },
      simplicity_terms: { per_hit: -1, max: -2, terms: [] },
      constraints_count: { min: 6, score: 1 },
      required_tests_count: { min: 3, score: 1 }
    }
  }
};

// --- Validation (pure) -----------------------------------------------------

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function isIntMap(v) {
  return isPlainObject(v) && Object.keys(v).every(function (k) {
    return typeof v[k] === 'number' && isFinite(v[k]) && Math.floor(v[k]) === v[k];
  });
}

function validateTermGroup(name, g, errors) {
  if (!isPlainObject(g)) { errors.push(name + ': not an object'); return; }
  if (typeof g.per_hit !== 'number' || Math.floor(g.per_hit) !== g.per_hit) { errors.push(name + '.per_hit must be an integer'); return; }
  if (typeof g.max !== 'number' || Math.floor(g.max) !== g.max) { errors.push(name + '.max must be an integer'); return; }
  if (!Array.isArray(g.terms) || !g.terms.every(function (t) { return typeof t === 'string' && t.length > 1 && t === t.toLowerCase(); })) {
    errors.push(name + '.terms must be an array of lowercase strings (plain substrings, never regexes)');
  }
}

function validateCountRule(name, r, errors) {
  if (!isPlainObject(r) || typeof r.min !== 'number' || typeof r.score !== 'number') {
    errors.push(name + ' must be { min, score }');
  }
}

// Validates the parsed contents of model-policy.json. Exported so tests can
// feed fixtures directly. Never throws.
function validatePolicyObject(raw) {
  var errors = [];
  if (!isPlainObject(raw)) return { valid: false, reason: 'policy root is not an object' };
  if (!isPlainObject(raw.catalog) || !Object.keys(raw.catalog).length) {
    return { valid: false, reason: 'catalog is missing or empty' };
  }
  var seenAlias = Object.create(null);
  Object.keys(raw.catalog).forEach(function (key) {
    var e = raw.catalog[key];
    if (!KEY_RE.test(key)) { errors.push('catalog key "' + key.slice(0, 20) + '" is not a lowercase slug'); return; }
    if (!isPlainObject(e)) { errors.push(key + ': not an object'); return; }
    if (typeof e.model !== 'string' || !MODEL_RE.test(e.model)) {
      errors.push(key + '.model must be a bare model id (no spaces, no leading "-")'); return;
    }
    if (typeof e.tier !== 'string' || !e.tier) { errors.push(key + '.tier must be a string'); return; }
    if (typeof e.enabled !== 'boolean') { errors.push(key + '.enabled must be a boolean'); return; }
    if (typeof e.auto_selectable !== 'boolean') { errors.push(key + '.auto_selectable must be a boolean'); return; }
    if (!Array.isArray(e.aliases) || !e.aliases.every(function (a) { return typeof a === 'string' && a.trim(); })) {
      errors.push(key + '.aliases must be an array of non-empty strings'); return;
    }
    // An alias resolving to two different models would make selection depend
    // on JSON key order — a policy nobody wrote down.
    [key].concat(e.aliases).forEach(function (a) {
      var n = normalizeRequest(a);
      if (!n) return;
      if (seenAlias[n] && seenAlias[n] !== key) errors.push('alias "' + n + '" is claimed by both ' + seenAlias[n] + ' and ' + key);
      else seenAlias[n] = key;
    });
  });
  if (errors.length) return { valid: false, reason: errors.join('; ') };

  var auto = raw.auto;
  if (!isPlainObject(auto)) return { valid: false, reason: 'auto block is missing' };
  if (!isPlainObject(auto.tiers)) return { valid: false, reason: 'auto.tiers is missing' };
  TIERS.forEach(function (t) {
    var key = auto.tiers[t];
    var entry = key && raw.catalog[key];
    if (!entry) { errors.push('auto.tiers.' + t + ' names unknown catalog key "' + String(key).slice(0, 20) + '"'); return; }
    if (!entry.enabled) errors.push('auto.tiers.' + t + ' names disabled model ' + key);
    if (!entry.auto_selectable) errors.push('auto.tiers.' + t + ' names ' + key + ', which is not auto_selectable');
  });
  if (!isPlainObject(auto.thresholds) ||
      typeof auto.thresholds.fast_max_score !== 'number' ||
      typeof auto.thresholds.deep_min_score !== 'number' ||
      auto.thresholds.fast_max_score >= auto.thresholds.deep_min_score) {
    errors.push('auto.thresholds must be { fast_max_score, deep_min_score } with fast_max_score < deep_min_score');
  }
  var s = auto.signals;
  if (!isPlainObject(s)) errors.push('auto.signals is missing');
  else {
    if (!isIntMap(s.execution_profile)) errors.push('auto.signals.execution_profile must map profile → integer');
    if (!isIntMap(s.task_category)) errors.push('auto.signals.task_category must map category → integer');
    if (!isIntMap(s.priority)) errors.push('auto.signals.priority must map priority → integer');
    if (!Array.isArray(s.instruction_length) ||
        !s.instruction_length.every(function (r) { return isPlainObject(r) && typeof r.min_chars === 'number' && typeof r.score === 'number'; })) {
      errors.push('auto.signals.instruction_length must be an array of { min_chars, score }');
    }
    validateTermGroup('auto.signals.complexity_terms', s.complexity_terms, errors);
    validateTermGroup('auto.signals.simplicity_terms', s.simplicity_terms, errors);
    validateCountRule('auto.signals.constraints_count', s.constraints_count, errors);
    validateCountRule('auto.signals.required_tests_count', s.required_tests_count, errors);
  }
  if (errors.length) return { valid: false, reason: errors.join('; ') };
  return { valid: true, policy: raw };
}

// --- Loading (I/O) ---------------------------------------------------------

// Never throws. An unreadable or invalid file yields the BUILT_IN policy
// (see the header: this layer must never go dark).
function loadPolicy(policyPath) {
  policyPath = policyPath || DEFAULT_POLICY_PATH;
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (e) {
    console.error('[mythos-ai-executor] model policy: falling back to the built-in policy — ' +
      'config unreadable or not valid JSON: ' + e.message);
    return { policy: BUILT_IN, source: 'built_in', reason: 'config_unreadable: ' + e.message };
  }
  var check = validatePolicyObject(raw);
  if (!check.valid) {
    console.error('[mythos-ai-executor] model policy: falling back to the built-in policy — ' + check.reason);
    return { policy: BUILT_IN, source: 'built_in', reason: 'config_invalid: ' + check.reason };
  }
  return { policy: raw, source: 'config', reason: null };
}

var DEFAULT_LOADED = loadPolicy();

function activePolicy(policy) {
  return policy || DEFAULT_LOADED.policy;
}

// --- Explicit selection ----------------------------------------------------

// "  Claude_Opus 5 " → "claude opus 5". Punctuation that only ever separates
// words is folded to a single space so `fable-5.1`, `fable 5.1` and
// `Fable_5.1` are the same request; the version dot is kept, because 5 and
// 5.1 are different models.
function normalizeRequest(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .slice(0, 100)
    .toLowerCase()
    .replace(/[`'"*]/g, '')
    .replace(/^model\s*[:=]\s*/, '')
    .replace(/[_/,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasIndex(policy) {
  var idx = Object.create(null);
  Object.keys(policy.catalog).forEach(function (key) {
    var entry = policy.catalog[key];
    [key, entry.model].concat(entry.aliases || []).forEach(function (a) {
      var n = normalizeRequest(a);
      if (n && !idx[n]) idx[n] = key;
    });
    // `fable-5` and `fable 5.1` also answer to their dashed model ids.
    var dashed = normalizeRequest(String(entry.model).replace(/-/g, ' '));
    if (dashed && !idx[dashed]) idx[dashed] = key;
  });
  return idx;
}

// Human-facing list of what a task may write in `Model:`.
function allowedLabels(policy) {
  policy = activePolicy(policy);
  return Object.keys(policy.catalog)
    .filter(function (k) { return policy.catalog[k].enabled; })
    .map(function (k) { return policy.catalog[k].display_name || k; });
}

// Resolves ONE explicitly requested model. Returns
// { ok:true, key, model, entry } or { ok:false, error, allowed }.
function resolveExplicit(requested, policy) {
  policy = activePolicy(policy);
  var norm = normalizeRequest(requested);
  if (!norm) return { ok: false, error: 'model request is empty', allowed: allowedLabels(policy) };
  var key = aliasIndex(policy)[norm];
  if (!key) {
    return {
      ok: false,
      error: 'unknown model "' + norm + '" — accepted values: ' + allowedLabels(policy).join(', '),
      allowed: allowedLabels(policy)
    };
  }
  var entry = policy.catalog[key];
  if (!entry.enabled) {
    return {
      ok: false,
      // Never substitute a neighbouring model for a disabled one: the task
      // asked for something specific and must be told it is unavailable.
      error: 'model "' + (entry.display_name || key) + '" is not available on this host (' +
        (entry.disabled_reason || 'disabled in config/model-policy.json') + ')',
      allowed: allowedLabels(policy)
    };
  }
  if (!MODEL_RE.test(entry.model)) {
    return { ok: false, error: 'catalog entry ' + key + ' carries an unusable model id', allowed: allowedLabels(policy) };
  }
  return { ok: true, key: key, model: entry.model, entry: entry };
}

// --- Automatic selection ---------------------------------------------------

function matchedTerms(text, group) {
  var hits = [];
  (group.terms || []).forEach(function (t) {
    if (hits.length < 12 && text.indexOf(t) !== -1) hits.push(t);
  });
  return hits;
}

function clamp(value, limit) {
  return limit >= 0 ? Math.min(value, limit) : Math.max(value, limit);
}

// Scores a task. Pure, deterministic, and fully explained by the returned
// `signals` array — every non-zero contribution is named.
function scoreTask(input, policy) {
  policy = activePolicy(policy);
  var s = policy.auto.signals;
  var signals = [];
  var total = 0;
  function add(name, score) {
    if (!score) return;
    total += score;
    signals.push({ signal: name, score: score });
  }

  var profile = input.execution_profile || null;
  if (profile && Object.prototype.hasOwnProperty.call(s.execution_profile, profile)) {
    add('execution_profile:' + profile, s.execution_profile[profile]);
  }
  var category = input.task_category || null;
  if (category && Object.prototype.hasOwnProperty.call(s.task_category, category)) {
    add('task_category:' + category, s.task_category[category]);
  }
  var priority = input.priority || 'normal';
  if (Object.prototype.hasOwnProperty.call(s.priority, priority)) {
    add('priority:' + priority, s.priority[priority]);
  }

  var text = String(input.instruction || '').toLowerCase();
  var lengthRule = (s.instruction_length || []).slice().sort(function (a, b) { return b.min_chars - a.min_chars; })
    .filter(function (r) { return text.length >= r.min_chars; })[0];
  if (lengthRule) add('instruction_length>=' + lengthRule.min_chars, lengthRule.score);

  var complex = matchedTerms(text, s.complexity_terms);
  if (complex.length) {
    add('complexity_terms(' + complex.slice(0, 5).join(',') + ')',
      clamp(complex.length * s.complexity_terms.per_hit, s.complexity_terms.max));
  }
  var simple = matchedTerms(text, s.simplicity_terms);
  if (simple.length) {
    add('simplicity_terms(' + simple.slice(0, 5).join(',') + ')',
      clamp(simple.length * s.simplicity_terms.per_hit, s.simplicity_terms.max));
  }

  var constraints = Array.isArray(input.constraints) ? input.constraints.length : 0;
  if (constraints >= s.constraints_count.min) add('constraints>=' + s.constraints_count.min, s.constraints_count.score);
  var tests = Array.isArray(input.required_tests) ? input.required_tests.length : 0;
  if (tests >= s.required_tests_count.min) add('required_tests>=' + s.required_tests_count.min, s.required_tests_count.score);

  return { score: total, signals: signals, complexity_hits: complex, simplicity_hits: simple };
}

// score → tier → catalog key. Never returns a fable model: the tiers map is
// validated to name auto_selectable entries only.
function autoSelect(input, policy) {
  policy = activePolicy(policy);
  var scored = scoreTask(input, policy);
  var th = policy.auto.thresholds;
  var tier = scored.score <= th.fast_max_score ? 'fast'
    : (scored.score >= th.deep_min_score ? 'deep' : 'balanced');
  var key = policy.auto.tiers[tier];
  var entry = policy.catalog[key];
  return {
    ok: true, key: key, model: entry.model, tier: tier,
    score: scored.score, signals: scored.signals
  };
}

// --- The one entry point ---------------------------------------------------

// input: { requested, execution_profile, task_category, priority,
//          instruction, constraints, required_tests }
// → { ok:true, model, key, mode:'explicit'|'auto', reason, score, signals }
// → { ok:false, error, allowed, requested }
function selectModel(input, policy) {
  input = input || {};
  policy = activePolicy(policy);
  var requested = input.requested;
  if (requested !== null && requested !== undefined && String(requested).trim() !== '') {
    var explicit = resolveExplicit(requested, policy);
    if (!explicit.ok) {
      return { ok: false, error: explicit.error, allowed: explicit.allowed, requested: String(requested).slice(0, 100) };
    }
    return {
      ok: true, model: explicit.model, key: explicit.key, mode: 'explicit',
      reason: ('explicit:' + explicit.key + ' (requested "' + normalizeRequest(requested) + '")').slice(0, REASON_MAX),
      score: null, signals: [], requested: String(requested).slice(0, 100)
    };
  }
  var auto = autoSelect(input, policy);
  var detail = auto.signals.map(function (x) { return x.signal + (x.score > 0 ? '+' : '') + x.score; }).join(' ');
  return {
    ok: true, model: auto.model, key: auto.key, mode: 'auto',
    reason: ('auto:' + auto.tier + '→' + auto.key + ' score=' + auto.score +
      (detail ? ' [' + detail + ']' : ' [no signals]')).slice(0, REASON_MAX),
    score: auto.score, signals: auto.signals, requested: null
  };
}

module.exports = {
  DEFAULT_POLICY_PATH: DEFAULT_POLICY_PATH,
  MODEL_RE: MODEL_RE,
  BUILT_IN: BUILT_IN,
  DEFAULT_LOADED: DEFAULT_LOADED,
  validatePolicyObject: validatePolicyObject,
  loadPolicy: loadPolicy,
  normalizeRequest: normalizeRequest,
  allowedLabels: allowedLabels,
  resolveExplicit: resolveExplicit,
  scoreTask: scoreTask,
  autoSelect: autoSelect,
  selectModel: selectModel
};
