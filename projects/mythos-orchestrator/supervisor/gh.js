'use strict';
// =====================================================
// MYTHOS supervisor — GitHub transport (gh CLI)
// projects/mythos-orchestrator/supervisor/gh.js
//
// Every GitHub call goes through the host's authenticated `gh` CLI as the
// executor user, so no token is read, held or logged by this process.
//
// Transport guarantees (the same ones the OpenAI transport has):
//   * HARD total deadline per call — the child is killed at the deadline,
//     however much output is still trickling in;
//   * settle-once — exit, error and deadline race; the first wins, the
//     rest are ignored;
//   * a truncated or non-JSON answer is an explicit failure
//     (GH_MALFORMED), never an empty success;
//   * stdout is capped (GH_OUTPUT_TOO_LARGE).
// Results are always { ok:true, data } or { ok:false, error:{ code, status?, detail } }.
// =====================================================

var cp = require('child_process');
var redact = require('../lib/redact');

var MAX_OUTPUT = 8 * 1024 * 1024;

// Default runner: spawn gh with a hard deadline. Resolves, never rejects.
function spawnRunner(args, stdinText, timeoutMs) {
  return new Promise(function (resolve) {
    var settled = false;
    var out = [], err = [], size = 0;
    function done(v) { if (settled) return; settled = true; clearTimeout(timer); resolve(v); }
    var child;
    try {
      child = cp.spawn(process.env.MYTHOS_SUPERVISOR_GH_BIN || 'gh', args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    } catch (e) {
      return done({ code: null, stdout: '', stderr: '', error: 'GH_SPAWN' });
    }
    var timer = setTimeout(function () {
      try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
      done({ code: null, stdout: Buffer.concat(out).toString('utf8'), stderr: '', error: 'GH_TIMEOUT' });
    }, timeoutMs);
    child.stdout.on('data', function (d) {
      size += d.length;
      if (size > MAX_OUTPUT) {
        try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
        return done({ code: null, stdout: '', stderr: '', error: 'GH_OUTPUT_TOO_LARGE' });
      }
      out.push(d);
    });
    child.stderr.on('data', function (d) { if (err.length < 64) err.push(d); });
    child.on('error', function () { done({ code: null, stdout: '', stderr: '', error: 'GH_SPAWN' }); });
    child.on('close', function (code) {
      done({ code: code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), error: null });
    });
    child.stdin.on('error', function () { /* child exited early; close/timeout decide */ });
    child.stdin.end(stdinText || '');
  });
}

function httpStatusOf(stderr) {
  var m = /HTTP (\d{3})/.exec(String(stderr || ''));
  return m ? parseInt(m[1], 10) : null;
}

function create(opts) {
  opts = opts || {};
  var runner = opts.runner || spawnRunner;
  var timeoutMs = opts.timeoutMs || 45000;

  // One REST call. body (object) is sent as JSON on stdin.
  function api(method, pathName, body, extra) {
    extra = extra || {};
    var args = ['api', '-X', method, pathName];
    if (extra.raw) args.push('-H', 'Accept: application/vnd.github.raw+json');
    if (body !== undefined) args.push('--input', '-');
    return Promise.resolve(runner(args, body !== undefined ? JSON.stringify(body) : '', timeoutMs)).then(function (r) {
      r = r || {};
      if (r.error) return { ok: false, error: { code: r.error, status: null, detail: null } };
      if (r.code !== 0) {
        var status = httpStatusOf(r.stderr);
        return { ok: false, error: { code: status === 404 ? 'GH_NOT_FOUND' : 'GH_EXIT', status: status, detail: redact.redact(String(r.stderr || '').slice(0, 300)) } };
      }
      if (extra.raw) return { ok: true, data: r.stdout };
      if (!String(r.stdout).trim()) return { ok: true, data: null };
      try {
        return { ok: true, data: JSON.parse(r.stdout) };
      } catch (e) {
        return { ok: false, error: { code: 'GH_MALFORMED', status: null, detail: 'response is not complete JSON' } };
      }
    });
  }

  function repoPath(repo, rest) { return 'repos/' + repo + rest; }

  return {
    api: api,
    createIssue: function (repo, title, body, labels) {
      return api('POST', repoPath(repo, '/issues'), { title: title, body: body, labels: labels || [] });
    },
    getIssue: function (repo, n) { return api('GET', repoPath(repo, '/issues/' + n)); },
    listComments: function (repo, n) { return api('GET', repoPath(repo, '/issues/' + n + '/comments?per_page=100')); },
    comment: function (repo, n, body) { return api('POST', repoPath(repo, '/issues/' + n + '/comments'), { body: body }); },
    addLabels: function (repo, n, labels) { return api('POST', repoPath(repo, '/issues/' + n + '/labels'), { labels: labels }); },
    close: function (repo, n, reason) {
      return api('PATCH', repoPath(repo, '/issues/' + n), { state: 'closed', state_reason: reason || 'completed' });
    },
    recentTaskIssues: function (repo, label) {
      return api('GET', repoPath(repo, '/issues?labels=' + encodeURIComponent(label) + '&state=all&sort=created&direction=desc&per_page=50'));
    },
    controlFile: function (repo, branch, file) {
      return api('GET', repoPath(repo, '/contents/' + file + '?ref=' + encodeURIComponent(branch)), undefined, { raw: true });
    }
  };
}

module.exports = { create: create, spawnRunner: spawnRunner, httpStatusOf: httpStatusOf };
