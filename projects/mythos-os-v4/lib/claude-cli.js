'use strict';
// =====================================================
// MYTHOS OS v4 — one bounded, tool-less Claude CLI call
// projects/mythos-os-v4/lib/claude-cli.js
//
// Used twice: FABLE 5.1 as the executive (engines/fable.js) and a paid
// Claude model as JEV's last tier (adapters.js). In both the model may only
// ANSWER: `--tools ""` removes every tool, no MCP server, no settings, no
// session is kept, and the process runs in an empty directory so it never
// reads a repository's CLAUDE.md. `--model` is always passed — the CLI's
// ambient default is never what runs (the executor's Issue #100 rule).
//
// The model that answered is MEASURED from the result's `modelUsage`, never
// taken from the request (live E2E #542: a label is not an identity).
// run() always resolves; the hard deadline kills the process.
// =====================================================

var cp = require('child_process');
var fs = require('fs');

var store = require('./store');
var quota = require('../../mythos-ai-executor/lib/quota');

var DEFAULT_BIN = process.env.MYTHOS_CLAUDE_BIN || 'claude';
var MAX_STDOUT = 4 * 1024 * 1024;
// The child needs HOME (its login) and PATH; nothing else of ours.
var ENV_ALLOW = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR'];

function buildArgs(spec) {
  var args = ['-p', '--output-format', 'json', '--model', spec.model,
    '--tools', '', '--no-session-persistence', '--strict-mcp-config',
    '--disable-slash-commands', '--setting-sources', ''];
  if (spec.system) args.push('--system-prompt', spec.system);
  return args;
}

function childEnv() {
  var env = {};
  ENV_ALLOW.forEach(function (k) { if (process.env[k] !== undefined) env[k] = process.env[k]; });
  return env;
}

function neutralCwd() { return store.ensureDir(store.file('claude-cwd')); }

function fail(code, detail, started, extra) {
  return Object.assign({
    ok: false, text: null, models_measured: [], timed_out: code === 'TIMEOUT',
    error: { code: code, detail: detail === undefined ? null : String(detail).slice(0, 500) },
    duration_ms: Date.now() - started, cost_usd: null
  }, extra || {});
}

// interpret(stdout, exitCode) -> the outcome of one finished call. Pure.
function interpret(stdout, exitCode, started) {
  var obj = null;
  try { obj = JSON.parse(stdout); } catch (e) { obj = null; }
  if (!obj || typeof obj !== 'object') {
    return fail(exitCode === 0 ? 'MALFORMED_CLI_OUTPUT' : 'CLI_ERROR', 'exit ' + exitCode + ', stdout is not a JSON result', started);
  }
  var models = obj.modelUsage && typeof obj.modelUsage === 'object' ? Object.keys(obj.modelUsage) : [];
  var text = typeof obj.result === 'string' ? obj.result : '';
  if (obj.is_error !== false || exitCode !== 0) {
    var category = quota.categorize(text);
    var code = category === 'quota' ? 'QUOTA' : (category === 'transient' ? 'TRANSIENT' : (category === 'permanent' ? 'CLI_ERROR' : 'BLOCKED'));
    return fail(code, text || ('exit ' + exitCode), started, {
      models_measured: models, resume_at: category === 'quota' ? quota.parseResetTime(text, Date.now()) : null
    });
  }
  return {
    ok: true, text: text, models_measured: models, timed_out: false, error: null,
    duration_ms: Date.now() - started,
    cost_usd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : null
  };
}

// run({ model, system, prompt, timeoutMs }, { bin, spawn }) -> Promise<outcome>
//   outcome { ok, text, models_measured[], timed_out, error:{code,detail}|null, duration_ms, cost_usd }
function run(spec, opts) {
  opts = opts || {};
  var started = Date.now();
  if (!spec || typeof spec.model !== 'string' || !spec.model) return Promise.resolve(fail('MISCONFIGURED', 'model is required', started));
  if (typeof spec.prompt !== 'string' || !spec.prompt) return Promise.resolve(fail('MISCONFIGURED', 'prompt is required', started));
  var spawn = opts.spawn || cp.spawn;
  var timeoutMs = Math.max(1000, spec.timeoutMs || 120000);

  return new Promise(function (resolve) {
    var settled = false;
    var child;
    var out = [];
    var size = 0;
    var timer = null;
    function done(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    }
    try {
      child = spawn(opts.bin || DEFAULT_BIN, buildArgs(spec), {
        cwd: opts.cwd || neutralCwd(), env: opts.env || childEnv(), stdio: ['pipe', 'pipe', 'ignore']
      });
    } catch (e) {
      return done(fail('UNAVAILABLE', e && e.code, started));
    }
    timer = setTimeout(function () {
      try { child.kill('SIGTERM'); } catch (e) { /* gone */ }
      setTimeout(function () { try { child.kill('SIGKILL'); } catch (e2) { /* gone */ } }, 3000).unref();
      done(fail('TIMEOUT', 'no answer within ' + timeoutMs + 'ms', started));
    }, timeoutMs);
    child.on('error', function (e) {
      done(fail(e && e.code === 'ENOENT' ? 'UNAVAILABLE' : 'CLI_ERROR', e && e.code, started));
    });
    child.stdout.on('data', function (d) {
      size += d.length;
      if (size > MAX_STDOUT) {
        try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
        return done(fail('MALFORMED_CLI_OUTPUT', 'stdout exceeded the size cap', started));
      }
      out.push(d);
    });
    child.on('close', function (code) {
      done(interpret(Buffer.concat(out).toString('utf8'), code, started));
    });
    child.stdin.on('error', function () { /* the child closed early; close reports it */ });
    child.stdin.end(spec.prompt);
  });
}

// available(bin) -> boolean. Presence of the binary only: a login or quota
// problem is found by the first real call and classified there.
function available(bin) {
  var target = bin || DEFAULT_BIN;
  if (target.indexOf('/') !== -1) {
    try { fs.accessSync(target, fs.constants.X_OK); return true; } catch (e) { return false; }
  }
  return (process.env.PATH || '').split(':').some(function (dir) {
    try { fs.accessSync(dir + '/' + target, fs.constants.X_OK); return true; } catch (e) { return false; }
  });
}

module.exports = {
  run: run,
  interpret: interpret,
  buildArgs: buildArgs,
  available: available,
  DEFAULT_BIN: DEFAULT_BIN
};
