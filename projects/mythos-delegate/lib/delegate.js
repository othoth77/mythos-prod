'use strict';
// =====================================================
// MYTHOS V1 — delegation boundary over delegate-skills
// projects/mythos-delegate/lib/delegate.js
//
// MYTHOS does not implement delegation. `amElnagdy/delegate-skills`
// (MIT) is the delegation layer: it owns lane resolution, the
// implementer CLI invocation contract, the permission profiles and the
// `delegate-relay.result.v1` artifact. This module is the MYTHOS side of
// that boundary and does exactly four things:
//
//   1. loads a config-declared vendor root (fail closed),
//   2. resolves a lane through the VENDOR's lane.mjs — never by reading
//      the lane file itself, so project-config trust and the untrusted
//      fail-closed path stay the vendor's decision, not ours,
//   3. invokes the vendor relay for that lane's implementer with an
//      explicit --out-dir under the executor store, and
//   4. normalises `delegate-relay.result.v1` into
//      `mythos.delegate.result.v1` for MYTHOS callers.
//
// FAIL CLOSED, same discipline as mythos-ai-executor/lib/knowledge.js:
// an unknown config field, an endpoint/url/credential-shaped key at any
// depth, `enabled` without a usable vendor root, or a vendor root inside
// this repository disables the whole layer rather than trusting the
// parts that parse.
//
// WHAT THIS MODULE MUST NEVER DO:
//   - write lane configuration (delegate-setup owns that, behind its own
//     explicit user-approval gate),
//   - commit, push, or land anything (the orchestrator lands; the relay
//     itself never commits),
//   - invent a model / effort / variant identifier,
//   - carry a credential. The implementer CLIs authenticate themselves.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config', 'delegate.json');
var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

var ALLOWED_CONFIG_FIELDS = [
  'enabled', 'vendor_root', 'artifacts_root', 'default_timeout', 'description'
];

// Rejected by presence anywhere in the document, at any depth. This is a
// local-path wiring config; anything endpoint- or credential-shaped in it
// is exactly the accident this check exists to catch.
var FORBIDDEN_KEY_SUBSTRINGS = [
  'token', 'secret', 'password', 'passwd', 'credential', 'api_key', 'apikey',
  'private_key', 'access_key', 'webhook', 'endpoint', 'url', 'host', 'port'
];

// Implementer key -> vendor skill directory. Mirrors the vendor registry
// (skills/delegate-setup/references/schema.md). A lane naming an
// implementer absent from this map is refused rather than guessed.
var IMPLEMENTER_SKILL = {
  claude: 'claude-delegate',
  codex: 'codex-delegate',
  opencode: 'opencode-delegate',
  cline: 'cline-delegate',
  cursor: 'cursor-delegate',
  aider: 'aider-delegate',
  copilot: 'copilot-delegate',
  grok: 'grok-delegate',
  kimi: 'kimi-delegate',
  qoder: 'qoder-delegate',
  vibe: 'vibe-delegate',
  warp: 'warp-delegate',
  zcode: 'zcode-delegate',
  agy: 'agy-delegate',
  omp: 'omp-delegate',
  commandcode: 'commandcode-delegate'
};

// Terminal statuses the vendor contract can report. `*_unavailable` is
// per-implementer (claude_unavailable, codex_unavailable, …) so it is
// matched by suffix rather than enumerated.
var TERMINAL_STATUSES = ['completed', 'failed', 'timeout', 'aborted'];

function cErr(msg) { var e = new Error(msg); e.code = 'MYTHOS_DELEGATE_CONFIG'; return e; }
function dErr(msg) { var e = new Error(msg); e.code = 'MYTHOS_DELEGATE_INPUT'; return e; }

function hasForbiddenKey(value) {
  if (value === null || typeof value !== 'object') return null;
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) {
    var lower = String(keys[i]).toLowerCase();
    for (var j = 0; j < FORBIDDEN_KEY_SUBSTRINGS.length; j++) {
      if (lower.indexOf(FORBIDDEN_KEY_SUBSTRINGS[j]) !== -1) return keys[i];
    }
    var nested = hasForbiddenKey(value[keys[i]]);
    if (nested) return nested;
  }
  return null;
}

// Validates a parsed config object. Returns a normalised config, or
// throws. Never returns a partially-trusted config.
function validateConfigObject(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw cErr('delegate config must be a JSON object');
  }
  var forbidden = hasForbiddenKey(raw);
  if (forbidden) {
    throw cErr('delegate config carries a credential- or endpoint-shaped key: ' + forbidden);
  }
  var keys = Object.keys(raw);
  for (var i = 0; i < keys.length; i++) {
    if (ALLOWED_CONFIG_FIELDS.indexOf(keys[i]) === -1) {
      throw cErr('unknown delegate config field: ' + keys[i]);
    }
  }
  if (typeof raw.enabled !== 'boolean') throw cErr('enabled must be a boolean');
  if (!raw.enabled) {
    return { enabled: false, vendorRoot: null, artifactsRoot: null, defaultTimeout: null };
  }
  if (typeof raw.vendor_root !== 'string' || raw.vendor_root.trim() === '') {
    throw cErr('vendor_root is required when enabled');
  }
  var vendorRoot = path.resolve(raw.vendor_root);
  // A vendor tree inside this repository would end up in Git history
  // sooner or later; the vendor is installed beside the repo, not in it.
  if (vendorRoot === REPO_ROOT || vendorRoot.indexOf(REPO_ROOT + path.sep) === 0) {
    throw cErr('vendor_root must live outside this repository');
  }
  if (typeof raw.artifacts_root !== 'string' || raw.artifacts_root.trim() === '') {
    throw cErr('artifacts_root is required when enabled');
  }
  var artifactsRoot = path.resolve(raw.artifacts_root);
  if (artifactsRoot === REPO_ROOT || artifactsRoot.indexOf(REPO_ROOT + path.sep) === 0) {
    throw cErr('artifacts_root must live outside this repository');
  }
  if (raw.default_timeout !== undefined && typeof raw.default_timeout !== 'string') {
    throw cErr('default_timeout must be a duration string such as "45m"');
  }
  return {
    enabled: true,
    vendorRoot: vendorRoot,
    artifactsRoot: artifactsRoot,
    defaultTimeout: raw.default_timeout || null
  };
}

// Loads the layer. A layer that cannot be trusted reports itself
// disabled with a reason; it never throws at the caller for an absent
// vendor tree, because "no delegation available on this host" is a
// normal, reportable state and missions must not depend on it.
function loadConfig(configPath) {
  var p = configPath || DEFAULT_CONFIG_PATH;
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { enabled: false, reason: 'config unreadable or malformed: ' + p, configPath: p };
  }
  var cfg;
  try {
    cfg = validateConfigObject(raw);
  } catch (e) {
    return { enabled: false, reason: e.message, configPath: p };
  }
  if (!cfg.enabled) {
    return { enabled: false, reason: 'disabled by config', configPath: p };
  }
  if (!fs.existsSync(path.join(cfg.vendorRoot, 'skills', 'delegate-setup', 'scripts', 'lane.mjs'))) {
    return {
      enabled: false,
      reason: 'delegate-skills not installed at ' + cfg.vendorRoot,
      configPath: p
    };
  }
  cfg.configPath = p;
  return cfg;
}

// The vendor scripts are spawned with an EXPLICIT cwd. Inheriting
// process.cwd() is not safe here: the executor and the operator run as
// different users, and spawning into a directory the child user cannot
// enter fails with status null and an empty stderr — a silent, very
// confusing failure. Falling back to the vendor root guarantees a
// directory the child can always read.
function describeFailure(r) {
  if (r.error) return 'could not run: ' + r.error.message;
  var text = (r.stderr || '').trim() || (r.stdout || '').trim();
  return 'exit ' + r.status + (text ? ': ' + text : ' (no output)');
}

function runNode(scriptPath, args, opts) {
  var o = opts || {};
  var res = cp.spawnSync(process.execPath, [scriptPath].concat(args), {
    cwd: o.cwd || path.dirname(scriptPath),
    encoding: 'utf8',
    timeout: o.timeoutMs || 0,
    maxBuffer: 32 * 1024 * 1024,
    env: o.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return {
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    error: res.error || null
  };
}

// Vendor discovery: which implementer CLIs exist on THIS host, and are
// they authenticated. Capability only — never task fit.
function discover(cfg) {
  if (!cfg.enabled) throw dErr('delegation layer disabled: ' + cfg.reason);
  var script = path.join(cfg.vendorRoot, 'skills', 'delegate-setup', 'scripts', 'discover.mjs');
  var r = runNode(script, [], { timeoutMs: 120000 });
  if (r.status !== 0) throw dErr('discover failed — ' + describeFailure(r));
  try { return JSON.parse(r.stdout); } catch (e) { throw dErr('discover returned unparseable JSON'); }
}

// The effective lane map, as the vendor computes it for `cwd`.
function lanes(cfg, cwd) {
  if (!cfg.enabled) throw dErr('delegation layer disabled: ' + cfg.reason);
  var script = path.join(cfg.vendorRoot, 'skills', 'delegate-setup', 'scripts', 'config.mjs');
  var target = cwd || process.cwd();
  var r = runNode(script, ['load', '--cwd', target], { cwd: target, timeoutMs: 60000 });
  if (r.status !== 0) throw dErr('lane load failed — ' + describeFailure(r));
  try { return JSON.parse(r.stdout); } catch (e) { throw dErr('lane load returned unparseable JSON'); }
}

// Resolves one lane through the vendor. We deliberately do NOT read the
// lane file ourselves: project-config trust (the approval-hash fail-closed
// path) is the vendor's decision and must stay there.
function resolveLane(cfg, laneName, cwd, implementer) {
  if (!cfg.enabled) throw dErr('delegation layer disabled: ' + cfg.reason);
  if (!laneName) throw dErr('lane name is required');
  var script = path.join(cfg.vendorRoot, 'skills', 'delegate-setup', 'scripts', 'lane.mjs');
  var args = ['resolve', '--cwd', cwd, '--lane', laneName];
  if (implementer) args = args.concat(['--implementer', implementer]);
  var r = runNode(script, args, { cwd: cwd, timeoutMs: 60000 });
  if (r.status !== 0) {
    throw dErr('lane "' + laneName + '" did not resolve — ' + describeFailure(r));
  }
  try { return JSON.parse(r.stdout); } catch (e) { throw dErr('lane resolve returned unparseable JSON'); }
}

// Which implementer a lane names, without resolving relay-native dials.
function laneImplementer(cfg, laneName, cwd) {
  var map = lanes(cfg, cwd);
  var lane = map && map.lanes ? map.lanes[laneName] : null;
  if (!lane) throw dErr('lane "' + laneName + '" is not configured — run delegate-setup');
  if (!lane.implementer) throw dErr('lane "' + laneName + '" has no implementer');
  return lane.implementer;
}

function relayPathFor(cfg, implementer) {
  var skill = IMPLEMENTER_SKILL[implementer];
  if (!skill) throw dErr('unknown implementer "' + implementer + '" — not in the vendor registry');
  var p = path.join(cfg.vendorRoot, 'skills', skill, 'scripts', 'relay.mjs');
  if (!fs.existsSync(p)) throw dErr('vendor relay missing for implementer "' + implementer + '": ' + p);
  return p;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
}

function isTerminal(status) {
  if (!status) return false;
  var s = String(status);
  return TERMINAL_STATUSES.indexOf(s) !== -1 || /_unavailable$/.test(s);
}

// Normalises the vendor artifact into the MYTHOS result contract.
// Everything MYTHOS callers need is promoted to the top level; the raw
// vendor result is preserved verbatim under `vendor` so nothing is lost
// and no MYTHOS caller has to re-parse vendor internals.
function normalizeResult(raw, context) {
  var ctx = context || {};
  var vendorSchema = raw && raw.schema ? String(raw.schema) : null;
  // Strict, BEFORE coercion. String(raw.status) would accept anything
  // that stringifies to a terminal word — ['completed'] among them — and
  // a malformed or drifted result.json is exactly where that shape comes
  // from. A status that is not literally a string is not a vendor report.
  var status = raw && typeof raw.status === 'string' && raw.status ? raw.status : 'unknown';
  return {
    schema: 'mythos.delegate.result.v1',
    vendor_schema: vendorSchema,
    lane: (raw && raw.lane) || ctx.lane || null,
    lane_source: (raw && raw.laneSource) || null,
    implementer: (raw && raw.tool) || ctx.implementer || null,
    repo: ctx.repo || null,
    status: status,
    terminal: isTerminal(status),
    // A delegation is successful only when the relay reported a terminal
    // `completed` AND the process exited zero. Either alone is a claim.
    ok: status === 'completed' && raw && raw.exitCode === 0,
    exit_code: raw && typeof raw.exitCode === 'number' ? raw.exitCode : null,
    session_id: (raw && raw.sessionId) || null,
    result_subtype: (raw && raw.resultSubtype) || null,
    final_message: (raw && raw.finalMessage) || null,
    // null means git could not report; [] means git reported a clean tree.
    // This is the whole final tree, not attribution — callers must review.
    touched_files: raw && Object.prototype.hasOwnProperty.call(raw, 'touchedFiles')
      ? raw.touchedFiles : null,
    // The vendor is the authority on whether the run was actually
    // read-only: a lane's `readOnly` dial enables it without any flag
    // from us, so trusting only our own request would report a
    // safety-relevant field as false on exactly the runs that were
    // restricted. Fall back to the request only when the vendor is silent.
    read_only: raw && typeof raw.readOnly === 'boolean' ? raw.readOnly : ctx.readOnly === true,
    read_only_violation: raw && Object.prototype.hasOwnProperty.call(raw, 'readOnlyViolation')
      ? raw.readOnlyViolation : null,
    // Promoted so a caller can act on a failure without re-parsing vendor
    // internals. `timeout` is the deadline that was in force, not a status.
    timeout: (raw && raw.timeout) || null,
    error: (raw && raw.error) || null,
    stderr_tail: raw && Array.isArray(raw.stderrTail) && raw.stderrTail.length
      ? raw.stderrTail : null,
    artifacts_dir: ctx.outDir || null,
    started_at: ctx.startedAt || null,
    finished_at: new Date().toISOString(),
    vendor: raw || null
  };
}

// Dispatch one bounded task to the lane's implementer.
//
//   opts.lane      required — a configured lane name
//   opts.repo      required — the target repository working directory
//   opts.brief     required — path to the brief file (stdin for the CLI)
//   opts.readOnly  optional — review/diagnosis only, no write path
//   opts.timeout   optional — relay watchdog deadline, e.g. "45m"
//   opts.taskId    optional — MYTHOS task id, used to name the artifact dir
//
// Returns a mythos.delegate.result.v1 object. It does NOT throw on a
// failed delegation — a failure is a result, not an exception. It throws
// only when the request itself is unusable (bad lane, missing brief).
function dispatch(cfg, opts) {
  if (!cfg.enabled) throw dErr('delegation layer disabled: ' + cfg.reason);
  var o = opts || {};
  if (!o.lane) throw dErr('lane is required');
  if (!o.repo) throw dErr('repo is required');
  if (!o.brief) throw dErr('brief path is required');
  var repo = path.resolve(o.repo);
  if (!fs.existsSync(repo)) throw dErr('repo directory does not exist: ' + repo);
  var brief = path.resolve(o.brief);
  if (!fs.existsSync(brief)) throw dErr('brief file does not exist: ' + brief);
  if (fs.statSync(brief).size === 0) throw dErr('brief file is empty: ' + brief);

  var implementer = laneImplementer(cfg, o.lane, repo);
  var relay = relayPathFor(cfg, implementer);

  var outDir = path.join(
    cfg.artifactsRoot,
    (o.taskId ? String(o.taskId).replace(/[^A-Za-z0-9._-]/g, '_') : 'adhoc') + '-' + stamp()
  );
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

  var args = ['--brief', brief, '--cd', repo, '--lane', o.lane, '--out-dir', outDir];
  if (o.readOnly) args.push('--read-only');
  var timeout = o.timeout || cfg.defaultTimeout;
  if (timeout) args = args.concat(['--timeout', timeout]);

  var startedAt = new Date().toISOString();
  var run = runNode(relay, args, { cwd: repo });

  var resultPath = path.join(outDir, 'result.json');
  var rawResult = null;
  if (fs.existsSync(resultPath)) {
    try { rawResult = JSON.parse(fs.readFileSync(resultPath, 'utf8')); } catch (e) { rawResult = null; }
  }

  // A usage error exits 2 BEFORE result.json is written. Synthesise a
  // result rather than returning nothing, so every dispatch produces one
  // persistent, inspectable record — the same guarantee OTHMODE tasks give.
  if (!rawResult) {
    rawResult = {
      schema: 'delegate-relay.result.v1',
      tool: implementer,
      status: run.status === 2 ? 'failed' : 'failed',
      exitCode: run.status === null ? -1 : run.status,
      finalMessage: null,
      error: (run.stderr || run.stdout || '').trim().slice(-4000) ||
        (run.error ? String(run.error.message) : 'relay produced no result.json'),
      touchedFiles: null,
      synthesised_by_mythos: true
    };
  }

  return normalizeResult(rawResult, {
    lane: o.lane,
    implementer: implementer,
    repo: repo,
    readOnly: o.readOnly === true,
    outDir: outDir,
    startedAt: startedAt
  });
}

module.exports = {
  DEFAULT_CONFIG_PATH: DEFAULT_CONFIG_PATH,
  IMPLEMENTER_SKILL: IMPLEMENTER_SKILL,
  TERMINAL_STATUSES: TERMINAL_STATUSES,
  validateConfigObject: validateConfigObject,
  loadConfig: loadConfig,
  discover: discover,
  lanes: lanes,
  resolveLane: resolveLane,
  laneImplementer: laneImplementer,
  relayPathFor: relayPathFor,
  normalizeResult: normalizeResult,
  isTerminal: isTerminal,
  dispatch: dispatch
};
