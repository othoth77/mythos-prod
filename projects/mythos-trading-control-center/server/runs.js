'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — run registry
// projects/mythos-trading-control-center/server/runs.js
//
// One directory per run under <state>/runs/<runId>/:
//
//   run.json        identity and status — id, kind, who started it, when, the
//                   commit, the config hash, the data source, the outcome
//   result.json     the job's result (metrics, counts, health, charts inputs)
//   analysis.json   the Analysis Agent's report over the run's store
//   research.json   the Research Agent's observations, hypotheses, proposals
//   store/          the run's sealed append-only store, one JSONL per table
//
// Every run therefore answers "can this result be reproduced?" from its own
// directory: configuration, commit, dataset version, seed and digest are all
// recorded with it.
//
// ONE JOB AT A TIME. A run is a process, and this host is memory-constrained.
// A second request while one is running is refused with a clear code instead
// of being queued behind it — an operator who gets a refusal knows where they
// stand; one whose run is silently parked does not.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var RUNS_DIR = 'runs';
var JOB_SCRIPT = path.join(__dirname, 'jobs', 'run-job.js');

var Status = Object.freeze({
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  INTERRUPTED: 'INTERRUPTED'
});

function pad(n) { return n < 10 ? '0' + n : String(n); }

function stamp(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds());
}

/**
 * @param {object} spec
 * @param {object} spec.state
 * @param {string} spec.agentRoot
 * @param {string} spec.commit
 * @param {function} [spec.now]
 * @param {number} [spec.maxRuns=20] retained run directories
 * @param {number} [spec.timeoutMs=300000]
 * @param {number} [spec.maxOldSpaceMb=512]
 * @param {function} [spec.onFinished] (run) => void
 */
function create(spec) {
  var state = spec.state;
  var now = typeof spec.now === 'function' ? spec.now : function () { return Date.now(); };
  var maxRuns = spec.maxRuns || 20;
  var timeoutMs = spec.timeoutMs || 5 * 60 * 1000;
  var maxOldSpaceMb = spec.maxOldSpaceMb || 512;
  var onFinished = typeof spec.onFinished === 'function' ? spec.onFinished : function () {};

  var index = Object.create(null);    // runId → run.json contents
  var active = null;                  // { runId, child, timer }
  var cache = [];                     // LRU of { runId, tables } — at most 2

  state.subdir(RUNS_DIR);
  state.listDirs(RUNS_DIR).forEach(function (id) {
    var meta = readJSONFile(path.join(runDir(id), 'run.json'));
    if (!meta || meta.runId !== id) return;
    if (meta.status === Status.RUNNING) {
      // The process that owned this run is gone. Saying so is the only honest
      // status: it did not complete and it did not fail on its own terms.
      meta.status = Status.INTERRUPTED;
      meta.finishedAt = meta.finishedAt || null;
      meta.error = { code: 'INTERRUPTED', message: 'the Control Center stopped while this run was in progress' };
      writeMeta(meta);
    }
    index[id] = meta;
  });

  function runDir(id) { return path.join(state.dir, RUNS_DIR, id); }

  function readJSONFile(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
  }

  function writeMeta(meta) {
    var file = path.join(runDir(meta.runId), 'run.json');
    var tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function newId(prefix) {
    return prefix + '-' + stamp(now()) + '-' + crypto.randomBytes(3).toString('hex');
  }

  function prune() {
    var ids = Object.keys(index).sort(function (a, b) {
      return (index[a].createdAt || '') < (index[b].createdAt || '') ? -1 : 1;
    });
    var excess = ids.length - maxRuns;
    for (var i = 0; i < ids.length && excess > 0; i++) {
      var id = ids[i];
      if (active && active.runId === id) continue;
      if (index[id].pinned) continue;
      try { fs.rmSync(runDir(id), { recursive: true, force: true }); } catch (e) { continue; }
      delete index[id];
      cache = cache.filter(function (c) { return c.runId !== id; });
      excess--;
    }
  }

  /**
   * Starts a job in a child process.
   *
   * @param {object} q { kind, label, spec, actor, summarySpec }
   * @returns {object} the run's metadata (status RUNNING)
   */
  function start(q) {
    if (active) {
      var busy = new Error('a run is already in progress (' + active.runId + '); wait for it to finish');
      busy.code = 'JOB_ALREADY_RUNNING';
      busy.refusal = true;
      busy.activeRunId = active.runId;
      throw busy;
    }
    var prefix = q.kind === 'EXPERIMENT' ? 'ex' : 'bt';
    var runId = newId(prefix);
    var dir = state.subdir(RUNS_DIR, runId);
    var meta = {
      runId: runId,
      kind: q.kind,
      label: q.label,
      status: Status.RUNNING,
      stage: 'STARTING',
      createdAt: new Date(now()).toISOString(),
      startedAt: new Date(now()).toISOString(),
      finishedAt: null,
      durationMs: null,
      actor: q.actor ? { id: q.actor.id, role: q.actor.role } : null,
      commit: spec.commit || null,
      configHash: q.configHash || null,
      data: q.data || null,
      request: q.summarySpec || null,
      summary: null,
      error: null
    };
    writeMeta(meta);
    index[runId] = meta;

    var child = childProcess.fork(JOB_SCRIPT, [], {
      cwd: dir,
      // A deliberately empty environment: the job needs nothing from this
      // process's, and credentials that are not there cannot leak into a result.
      env: { NODE_ENV: 'production', TZ: 'UTC' },
      execArgv: ['--max-old-space-size=' + maxOldSpaceMb],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    });
    var stderr = '';
    child.stderr.on('data', function (d) { if (stderr.length < 4000) stderr += String(d); });

    var finished = false;
    function finish(status, patch) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      var t = now();
      meta.status = status;
      meta.stage = status;
      meta.finishedAt = new Date(t).toISOString();
      meta.durationMs = t - Date.parse(meta.startedAt);
      Object.keys(patch || {}).forEach(function (k) { meta[k] = patch[k]; });
      try { writeMeta(meta); } catch (e) { /* the directory may have been pruned */ }
      if (active && active.runId === runId) active = null;
      prune();
      try { onFinished(meta); } catch (e2) { /* a listener must not break the registry */ }
    }

    var timer = setTimeout(function () {
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      finish(Status.TIMEOUT, { error: { code: 'JOB_TIMEOUT', message: 'the run exceeded ' + Math.round(timeoutMs / 1000) + ' s and was stopped' } });
    }, timeoutMs);
    timer.unref();

    child.on('message', function (msg) {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'progress') {
        meta.stage = String(msg.detail || msg.stage || '').slice(0, 64);
      } else if (msg.type === 'done') {
        finish(Status.COMPLETED, { summary: msg.summary || null });
      } else if (msg.type === 'failed') {
        finish(Status.FAILED, { error: msg.error || { code: 'JOB_FAILED', message: 'the run failed' } });
      }
    });
    child.on('error', function (e) {
      finish(Status.FAILED, { error: { code: 'JOB_SPAWN_FAILED', message: String(e.message).slice(0, 500) } });
    });
    child.on('exit', function (code, signal) {
      // Normal completion already called finish(). Reaching here unfinished
      // means the process died without reporting — out of memory, most likely.
      // Deferred one beat so a 'done' message still in the IPC queue is
      // delivered first and is not misreported as a death.
      setTimeout(function () {
        finish(Status.FAILED, {
          error: {
            code: signal ? 'JOB_KILLED' : 'JOB_EXITED',
            message: 'the run process ended without a result (' + (signal || 'exit ' + code) + ')' +
              (stderr ? ': ' + stderr.slice(-600) : '')
          }
        });
      }, 150);
    });

    active = { runId: runId, child: child, timer: timer };
    child.send({
      kind: q.kind, runId: runId, label: q.label, runDir: dir,
      agentRoot: spec.agentRoot, commit: spec.commit || null, spec: q.spec
    });
    return meta;
  }

  /**
   * Registers a run produced INSIDE this process (a finished paper session),
   * so it appears in the same list and is read through the same code.
   */
  function register(meta) {
    index[meta.runId] = meta;
    writeMeta(meta);
    prune();
    return meta;
  }

  function newRunDir(prefix) {
    var runId = newId(prefix);
    return { runId: runId, dir: state.subdir(RUNS_DIR, runId) };
  }

  function get(runId) { return index[runId] || null; }

  function list(q) {
    var f = q || {};
    var rows = Object.keys(index).map(function (k) { return index[k]; }).filter(function (r) {
      if (f.kind && r.kind !== f.kind) return false;
      if (f.status && r.status !== f.status) return false;
      return true;
    }).sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    return rows;
  }

  function latest(kinds) {
    var rows = list().filter(function (r) {
      return r.status === Status.COMPLETED && (!kinds || kinds.indexOf(r.kind) !== -1);
    });
    return rows.length ? rows[0] : null;
  }

  function readDoc(runId, name) {
    if (!index[runId]) return null;
    return readJSONFile(path.join(runDir(runId), name));
  }

  /** The run's tables, read back from its sealed store. Cached, bounded. */
  function tables(runId, storeSubdir) {
    if (!index[runId]) return null;
    var key = runId + '|' + (storeSubdir || 'store');
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].key === key) {
        var hit = cache.splice(i, 1)[0];
        cache.push(hit);
        return hit.tables;
      }
    }
    var dir = path.join(runDir(runId), storeSubdir || 'store');
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) return null;
    var out = { manifest: readJSONFile(path.join(dir, 'manifest.json')), tables: {} };
    fs.readdirSync(dir).forEach(function (f) {
      if (!/^[a-z_]+\.jsonl$/.test(f)) return;
      var name = f.replace(/\.jsonl$/, '');
      var text = fs.readFileSync(path.join(dir, f), 'utf8');
      out.tables[name] = text.split('\n').filter(function (l) { return l.length > 0; })
        .map(function (l) { return JSON.parse(l); });
    });
    cache.push({ key: key, runId: runId, tables: out });
    while (cache.length > 2) cache.shift();
    return out;
  }

  function shutdown() {
    if (active) {
      try { active.child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    }
  }

  return {
    Status: Status,
    start: start,
    register: register,
    newRunDir: newRunDir,
    get: get,
    list: list,
    latest: latest,
    readDoc: readDoc,
    tables: tables,
    runDir: runDir,
    active: function () { return active ? index[active.runId] : null; },
    busy: function () { return !!active; },
    limits: function () { return { maxRuns: maxRuns, timeoutMs: timeoutMs, maxOldSpaceMb: maxOldSpaceMb }; },
    shutdown: shutdown
  };
}

module.exports = { create: create, Status: Status };
