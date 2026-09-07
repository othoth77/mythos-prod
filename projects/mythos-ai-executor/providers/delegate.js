'use strict';
// =====================================================
// Mythos AI Executor — delegation execution provider
// projects/mythos-ai-executor/providers/delegate.js
//
// The SECOND provider with repository execution authority. It does not
// run a model itself: it hands one bounded task to the delegation
// boundary (projects/mythos-delegate), which resolves the task's lane
// through delegate-skills and runs that lane's implementer CLI — claude,
// codex or opencode — inside the task's own worktree.
//
// Why a provider and not a bridge change: the bridge deliberately never
// runs a provider, and `executor.runTask` stays the only execution path.
// A lane is the same KIND of choice as `model` (Issue #100): it selects
// an entry in a server-side catalog, an unavailable one is a refusal
// rather than a substitution, and it grants NO authority — the execution
// profile still comes from requested_action, server-side.
//
// AUTHORITY NOTE. This provider inherits the task's worktree, so it can
// write exactly where claude-code could. What it must never do is let a
// lane WIDEN what the task was allowed to do. Two guards enforce that,
// and both refuse before anything is spawned:
//
//   LANE_UNAVAILABLE      — the task named a lane that is not configured
//                           on this host. Never substituted.
//   LANE_PROFILE_MISMATCH — a read-only lane was given a task whose
//                           delivery is a commit. A read-only lane cannot
//                           produce a commit, so the run would burn a full
//                           implementer session and report "nothing
//                           changed"; that is a refusal, not a result.
//
// The reverse case — a write-capable lane on a read-only task — is NOT a
// mismatch here: the executor's own profile still bounds the task, and
// the relay's own permission profile applies on top.
//
// NO CREDENTIAL. The implementer CLIs authenticate themselves.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var PROVIDER_ID = 'delegate';

// The boundary module lives beside the executor inside this repository.
var BOUNDARY_PATH = path.join(__dirname, '..', '..', 'mythos-delegate', 'lib', 'delegate.js');

var delegate = null;
function boundary() {
  if (!delegate) delegate = require(BOUNDARY_PATH);
  return delegate;
}

function loadCfg() { return boundary().loadConfig(); }

// Cheap by contract. The executor probes providers at startup, so this
// must not shell out: full CLI discovery probes every implementer on the
// host and took over two minutes here — long enough to look like a hung
// daemon, and it timed out to null, which reads as "unavailable" for a
// layer that is perfectly available. Discovery belongs in the operator
// CLI (`mythos-delegate discover`), never in a provider probe.
function version() {
  var cfg = loadCfg();
  if (!cfg.enabled) return null;
  var pin = null;
  try {
    var head = fs.readFileSync(path.join(cfg.vendorRoot, '.git', 'HEAD'), 'utf8').trim();
    if (head.indexOf('ref:') === 0) {
      head = fs.readFileSync(path.join(cfg.vendorRoot, '.git', head.slice(4).trim()), 'utf8').trim();
    }
    pin = head.slice(0, 7);
  } catch (e) { pin = null; }
  return 'delegate-skills' + (pin ? '@' + pin : '') + ' (' + cfg.vendorRoot + ')';
}

function available() { return loadCfg().enabled === true; }

// Sessions are minted by the implementer CLI through the vendor relay,
// not by us. Returning null keeps the executor from pinning an id the
// vendor would ignore; the vendor's session id comes back on the outcome
// and the executor stores it, so rework resumes the SAME conversation.
function newSessionId() { return null; }

function fail(code, message) {
  return {
    exit_code: 1, signal: null, timed_out: false, duration_ms: 0,
    stdout: '', stderr: code + ': ' + message,
    parsed: { is_error: true, subtype: code, result: message },
    session_id: null, started_pid: null
  };
}

// Refuses a lane the host does not have, and a read-only lane asked to
// deliver a commit. Returns null when the pairing is runnable.
function laneBlocker(cfg, task) {
  var b = boundary();
  var map;
  try { map = b.lanes(cfg, task.working_directory); }
  catch (e) { return { code: 'LANE_UNAVAILABLE', reason: 'lane map unreadable: ' + e.message }; }

  var lane = map && map.lanes ? map.lanes[task.lane] : null;
  if (!lane) {
    var known = map && map.lanes ? Object.keys(map.lanes) : [];
    return {
      code: 'LANE_UNAVAILABLE',
      reason: 'lane "' + task.lane + '" is not configured on this host' +
        (known.length ? ' (configured: ' + known.join(', ') + ')' : ' (no lanes configured)') +
        ' — refused rather than substituted'
    };
  }
  if (lane.readOnly === true && task.expected_delivery === 'commit') {
    return {
      code: 'LANE_PROFILE_MISMATCH',
      reason: 'lane "' + task.lane + '" is read-only but this task\'s delivery is "commit"; ' +
        'a read-only lane cannot produce one. Name a write-capable lane, or use an action ' +
        'whose delivery is a report.'
    };
  }
  return null;
}

// Maps mythos.delegate.result.v1 onto the outcome shape every provider
// returns. `parsed.is_error === false` is what the executor reads as
// success, so it is derived from `ok` — a terminal `completed` with a
// non-zero exit code is NOT success, exactly as the boundary decides.
function toOutcome(result, startedMs) {
  var timedOut = result.status === 'timeout';
  var summary = result.final_message ||
    (result.error ? String(result.error) : null) ||
    ('delegation ' + result.status);
  return {
    exit_code: typeof result.exit_code === 'number' ? result.exit_code : 1,
    signal: null,
    timed_out: timedOut,
    duration_ms: Date.now() - startedMs,
    stdout: result.relay_stdout || '',
    stderr: result.relay_stderr || '',
    parsed: {
      is_error: result.ok !== true,
      subtype: result.result_subtype || result.status,
      result: summary,
      session_id: result.session_id || null,
      // Carried so the executor's report and any reviewer see WHAT ran and
      // WHERE the evidence is, without re-reading vendor internals.
      delegate: {
        lane: result.lane,
        lane_source: result.lane_source,
        implementer: result.implementer,
        status: result.status,
        read_only: result.read_only,
        read_only_violation: result.read_only_violation,
        touched_files: result.touched_files,
        artifacts_dir: result.artifacts_dir
      }
    },
    session_id: result.session_id || null,
    started_pid: result.relay_pid || null
  };
}

// The executor's provider contract. `prompt` is the full task instruction
// the executor already built — it becomes the implementer's brief.
function run(task, prompt, sessionId, mode, opts, onSpawn) {
  var startedMs = Date.now();
  var cfg = loadCfg();
  if (!cfg.enabled) {
    return Promise.resolve(fail('DELEGATE_UNAVAILABLE',
      'the delegation layer is disabled on this host: ' + cfg.reason));
  }
  if (!task.lane) {
    return Promise.resolve(fail('LANE_MISSING',
      'the delegate provider requires a lane; this task named none'));
  }
  if (!task.working_directory) {
    return Promise.resolve(fail('DELEGATE_NO_WORKTREE',
      'the delegate provider requires the task working directory'));
  }

  var blocker = laneBlocker(cfg, task);
  if (blocker) return Promise.resolve(fail(blocker.code, blocker.reason));

  // The brief goes beside the run's own artifacts, never into the repo.
  var briefPath;
  try {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-delegate-brief-'));
    briefPath = path.join(dir, 'brief.txt');
    fs.writeFileSync(briefPath, prompt, { mode: 0o600 });
  } catch (e) {
    return Promise.resolve(fail('DELEGATE_BRIEF_WRITE', e.message));
  }

  return boundary().dispatchAsync(cfg, {
    lane: task.lane,
    repo: task.working_directory,
    brief: briefPath,
    taskId: task.task_id || task.id || null,
    sessionId: mode === 'resume' ? sessionId : null,
    timeout: task.timeout_seconds ? Math.ceil(task.timeout_seconds / 60) + 'm' : null
  }, onSpawn).then(function (result) {
    try { fs.unlinkSync(briefPath); fs.rmdirSync(path.dirname(briefPath)); } catch (e) { /* best effort */ }
    return toOutcome(result, startedMs);
  }, function (err) {
    try { fs.unlinkSync(briefPath); fs.rmdirSync(path.dirname(briefPath)); } catch (e) { /* best effort */ }
    return fail('DELEGATE_DISPATCH_ERROR', (err && err.message) || String(err));
  });
}

// The vendor mints and owns sessions; a resume against an id it no longer
// knows surfaces as a failed run with the vendor's own error text.
function isMissingSession(outcome) {
  var text = (outcome.stderr || '') + '\n' + (outcome.stdout || '') + '\n' +
    ((outcome.parsed && outcome.parsed.result) || '');
  return /no conversation found|session.{0,40}not found|could not resume|unknown session/i.test(text);
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  BOUNDARY_PATH: BOUNDARY_PATH,
  version: version,
  available: available,
  newSessionId: newSessionId,
  laneBlocker: laneBlocker,
  toOutcome: toOutcome,
  run: run,
  isMissingSession: isMissingSession,
  executionAuthority: true   // runs an implementer CLI inside the task worktree
};
