'use strict';
// =====================================================
// MYTHOS — START GATES: predecessor dependencies the bridge proves itself
// projects/mythos-ai-executor/bridge/start-gates.js
//
// WHY. `depends_on` (task file) / `Depends on: #N` (Issue) is the bridge's one
// predecessor primitive, and it only understands tasks in THIS bridge's own
// control store. Some predecessors are not tasks here: work closed by another
// bridge instance (Haddad), merged by a director, or an owner step on the VPS
// (V3.2 residuals R1-R5 are all three). A predecessor that exists only as
// prose in an Issue ("do not start before ...") is invisible to the bridge,
// which then treats the task as unconditionally eligible — fail-OPEN.
//
// WHAT. A dependency id `gate-<name>` is resolved here instead of against the
// task store. `gates/gate-<name>.json` (code-reviewed, merged to main, read
// from the RUNTIME checkout — never from an Issue or the control branch)
// lists requirements; each requirement lists evidence the bridge checks
// mechanically, every time, read-only:
//
//   commit_on_main  { commit }            commit exists and is an ancestor of
//                                         <remote>/main in the shared checkout
//   file_on_main    { path, contains[] }  file exists on <remote>/main and holds
//                                         every string
//   probe           { probe, args }       gates/probes/<probe>.js run as a child
//                                         (bounded time); must exit 0 AND print
//                                         {"ok":true,...} as its last line
//
// A manifest may also name EXISTING task ids it gates (`applies_to`). A task
// file is an immutable snapshot (an Issue edit never changes it), so this is
// the only way to put a predecessor in front of an already-queued task
// without rewriting bridge state. The overlay can only ADD dependencies,
// never remove one, so it can only make a task wait longer.
//
// FAIL-CLOSED, everywhere: unknown gate, unreadable/invalid manifest, foreign
// project, `hold: true`, zero requirements, missing git ref, git error, probe
// timeout/crash/non-JSON/ok!==true — each means NOT satisfied, with a reason.
// A task can never satisfy a gate (ids starting `gate-` are refused as task
// ids by validateTask), so a gate cannot be forged through the task store.
//
// Results are memoised per tick (one context per tick).
// =====================================================
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var GATE_PREFIX = 'gate-';
var GATE_ID_RE = /^gate-[a-z0-9][a-z0-9-]{2,33}[a-z0-9]$/;
var PROBE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;
var SHA_RE = /^[0-9a-f]{7,40}$/;
var EVIDENCE_TYPES = ['commit_on_main', 'file_on_main', 'probe'];
var DEFAULT_PROBE_TIMEOUT_MS = 180000;
// Well under the bridge unit's TimeoutStartSec=600: a probe must never be the
// reason systemd kills a tick halfway through its control commit.
var MAX_PROBE_TIMEOUT_MS = 240000;

function isGateId(id) { return typeof id === 'string' && id.indexOf(GATE_PREFIX) === 0; }

function defaultDir() { return process.env.MYTHOS_BRIDGE_GATES_DIR || path.join(__dirname, 'gates'); }

function validateManifest(m, file) {
  var errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['manifest is not an object'];
  if (!GATE_ID_RE.test(String(m.gate || ''))) errors.push('gate id must match ' + GATE_ID_RE);
  if (file && m.gate + '.json' !== file) errors.push('file name must be <gate>.json (got ' + file + ')');
  if (typeof m.project !== 'string' || !m.project) errors.push('project is required');
  if (m.applies_to !== undefined && (!Array.isArray(m.applies_to) || m.applies_to.some(function (x) { return typeof x !== 'string' || !x; }))) errors.push('applies_to must be an array of task ids');
  if (m.hold !== undefined && typeof m.hold !== 'boolean') errors.push('hold must be a boolean');
  if (m.hold !== true) {
    if (!Array.isArray(m.requirements) || !m.requirements.length) errors.push('requirements must be a non-empty array (use hold: true for a gate that never opens)');
    (m.requirements || []).forEach(function (r, i) {
      if (!r || typeof r.id !== 'string' || !r.id) errors.push('requirement ' + i + ': id required');
      if (!r || !Array.isArray(r.evidence) || !r.evidence.length) { errors.push('requirement ' + (r && r.id || i) + ': evidence must be a non-empty array'); return; }
      r.evidence.forEach(function (e, j) {
        var where = 'requirement ' + r.id + ' evidence ' + j + ': ';
        if (!e || EVIDENCE_TYPES.indexOf(e.type) === -1) { errors.push(where + 'type must be one of ' + EVIDENCE_TYPES.join('|')); return; }
        if (e.type === 'commit_on_main' && !SHA_RE.test(String(e.commit || ''))) errors.push(where + 'commit must be a hex sha');
        if (e.type === 'file_on_main') {
          if (typeof e.path !== 'string' || !e.path || e.path.indexOf('..') !== -1 || e.path.charAt(0) === '/') errors.push(where + 'path must be a repository-relative path');
          if (!Array.isArray(e.contains) || !e.contains.length || e.contains.some(function (s) { return typeof s !== 'string' || !s; })) errors.push(where + 'contains must be a non-empty array of strings');
        }
        if (e.type === 'probe' && !PROBE_NAME_RE.test(String(e.probe || ''))) errors.push(where + 'probe name must match ' + PROBE_NAME_RE);
      });
    });
  }
  return errors;
}

// Every manifest in the directory. A file that does not parse cannot say what
// it gates; it is reported (and a dependency naming it stays unmet) but it
// cannot add itself to tasks it would have named.
function loadManifests(dir) {
  var out = { byId: {}, problems: [] };
  var files;
  try { files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort(); } catch (e) { return out; }
  files.forEach(function (f) {
    var m;
    try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { out.problems.push(f + ': ' + e.message); return; }
    var id = m && typeof m.gate === 'string' ? m.gate : f.replace(/\.json$/, '');
    if (out.byId[id]) {
      // Two files claiming one gate: neither may silently win (a weaker copy
      // could shadow the reviewed one) — the gate becomes invalid, i.e. unmet.
      out.byId[id].errors.push('gate id also declared by ' + f);
      out.problems.push(f + ': duplicate gate id ' + id + ' (also ' + out.byId[id].file + ')');
      return;
    }
    out.byId[id] = { manifest: m, file: f, errors: validateManifest(m, f) };
  });
  return out;
}

function gitOut(repo, args) {
  try {
    return { ok: true, out: cp.execFileSync('git', ['-C', repo].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, maxBuffer: 16 * 1024 * 1024 }) };
  } catch (e) {
    return { ok: false, error: String((e.stderr && e.stderr.toString()) || e.message).trim().split('\n')[0].slice(0, 200) };
  }
}

function defaultProbeRunner(script, args, timeoutMs) {
  var r = cp.spawnSync(process.execPath, [script, JSON.stringify(args || {})], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error ? r.error.message : null };
}

// One context per tick: manifests read once, each gate evaluated at most once.
function context(cfg, opts) {
  opts = opts || {};
  var dir = opts.dir || defaultDir();
  return {
    project: cfg.project,
    repo: cfg.repo,
    mainRef: opts.mainRef || ('refs/remotes/' + (cfg.remote || 'origin') + '/main'),
    dir: dir,
    manifests: loadManifests(dir),
    runProbe: opts.runProbe || defaultProbeRunner,
    // Nothing else in a tick fetches main into the shared checkout, so the
    // first git-evidenced check refreshes it once (bounded, read-only for the
    // working tree). A failed fetch is only noted: the existing ref is used,
    // and a commit that is not there yet simply stays unproven.
    fetchMain: opts.fetchMain !== false,
    fetched: null,
    memo: {}
  };
}

function refreshMain(ctx) {
  if (!ctx.fetchMain || ctx.fetched !== null) return;
  var m = /^refs\/remotes\/([^/]+)\/(.+)$/.exec(ctx.mainRef);
  ctx.fetched = m ? gitOut(ctx.repo, ['fetch', '--quiet', m[1], m[2]]) : { ok: false, error: 'main ref is not a remote-tracking ref' };
}

function checkEvidence(ctx, e) {
  if (e.type === 'commit_on_main' || e.type === 'file_on_main') refreshMain(ctx);
  if (e.type === 'commit_on_main') {
    var c = gitOut(ctx.repo, ['cat-file', '-e', e.commit + '^{commit}']);
    if (!c.ok) return 'commit ' + e.commit + ' not present in ' + ctx.repo;
    var a = gitOut(ctx.repo, ['merge-base', '--is-ancestor', e.commit, ctx.mainRef]);
    return a.ok ? null : 'commit ' + e.commit + ' is not on ' + ctx.mainRef;
  }
  if (e.type === 'file_on_main') {
    var f = gitOut(ctx.repo, ['show', ctx.mainRef + ':' + e.path]);
    if (!f.ok) return 'file ' + e.path + ' not on ' + ctx.mainRef;
    var missing = e.contains.filter(function (s) { return f.out.indexOf(s) === -1; });
    return missing.length ? 'file ' + e.path + ' lacks ' + JSON.stringify(missing[0].slice(0, 80)) : null;
  }
  if (e.type === 'probe') {
    var script = path.join(ctx.dir, 'probes', e.probe + '.js');
    if (!fs.existsSync(script)) return 'probe ' + e.probe + ' not installed';
    var t = Math.min(Number(e.timeout_ms) > 0 ? Number(e.timeout_ms) : DEFAULT_PROBE_TIMEOUT_MS, MAX_PROBE_TIMEOUT_MS);
    var r;
    try { r = ctx.runProbe(script, e.args || {}, t); } catch (err) { return 'probe ' + e.probe + ' could not run: ' + err.message; }
    if (!r || r.error || r.signal) return 'probe ' + e.probe + ' did not finish (' + ((r && (r.error || r.signal)) || 'no result') + ')';
    var last = String(r.stdout || '').trim().split('\n').pop();
    var j = null;
    try { j = JSON.parse(last); } catch (err) { j = null; }
    if (r.status !== 0 || !j || j.ok !== true) {
      var why = j && Array.isArray(j.checks) ? j.checks.filter(function (x) { return !x.ok; }).map(function (x) { return x.name + ': ' + x.detail; }).join('; ') : String(r.stderr || last || '').slice(0, 200);
      return 'probe ' + e.probe + ' failed (exit ' + r.status + '): ' + String(why).slice(0, 300);
    }
    return null;
  }
  return 'unknown evidence type';
}

// { satisfied, gate, reasons[], requirements[{id, satisfied, failures[]}] }
function evaluate(ctx, gateId) {
  if (ctx.memo[gateId]) return ctx.memo[gateId];
  var res = { satisfied: false, gate: gateId, reasons: [], requirements: [] };
  ctx.memo[gateId] = res;
  var entry = ctx.manifests.byId[gateId];
  if (!isGateId(gateId) || !GATE_ID_RE.test(gateId)) { res.reasons.push('not a gate id'); return res; }
  if (!entry) { res.reasons.push('no manifest for ' + gateId + ' in ' + ctx.dir); return res; }
  var m = entry.manifest;
  if (entry.errors.length) { res.reasons.push('invalid manifest: ' + entry.errors.join('; ')); return res; }
  if (m.project !== ctx.project) { res.reasons.push('gate belongs to project ' + m.project + ', this bridge serves ' + ctx.project); return res; }
  if (m.hold === true) { res.reasons.push('HOLD: ' + (m.release || 'held until an owner-reviewed change releases it')); return res; }
  m.requirements.forEach(function (req) {
    var failures = [];
    req.evidence.forEach(function (e) {
      var why;
      try { why = checkEvidence(ctx, e); } catch (err) { why = 'evidence check threw: ' + err.message; }
      if (why) failures.push(why);
    });
    res.requirements.push({ id: req.id, satisfied: failures.length === 0, failures: failures });
  });
  var unmet = res.requirements.filter(function (r) { return !r.satisfied; });
  unmet.forEach(function (r) { res.reasons.push(r.id + ': ' + r.failures[0]); });
  res.satisfied = res.requirements.length > 0 && unmet.length === 0;
  return res;
}

// Gates an owner-reviewed manifest puts in front of an existing task (add-only).
function overlayFor(ctx, taskId) {
  var out = [];
  Object.keys(ctx.manifests.byId).sort().forEach(function (id) {
    var m = ctx.manifests.byId[id].manifest;
    if (!m || m.project !== ctx.project || !Array.isArray(m.applies_to)) return;
    if (m.applies_to.indexOf(taskId) !== -1) out.push(id);
  });
  return out;
}

function effectiveDepends(ctx, task) {
  var deps = Array.isArray(task.depends_on) ? task.depends_on.slice() : [];
  if (ctx) overlayFor(ctx, task.task_id).forEach(function (g) { if (deps.indexOf(g) === -1) deps.push(g); });
  return deps;
}

module.exports = {
  GATE_PREFIX: GATE_PREFIX,
  isGateId: isGateId,
  validateManifest: validateManifest,
  loadManifests: loadManifests,
  context: context,
  evaluate: evaluate,
  overlayFor: overlayFor,
  effectiveDepends: effectiveDepends,
  defaultDir: defaultDir
};
