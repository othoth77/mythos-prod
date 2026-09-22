'use strict';
// =====================================================
// Mythos AI Executor — Haddad local tool runner (V1a: READ/TEST ONLY)
// projects/mythos-ai-executor/providers/haddad-agent.js
//
// The first provider in this repository that executes a tool call itself.
// Every other execution path builds argv and hands it to a CLI that owns its
// own sandbox (claude-code, delegate). This one runs an OpenAI tool-calling
// loop against the local llama-server and performs the calls in-process,
// which means the confinement has to live here, in code, rather than in a
// flag another program is trusted to honour.
//
// TOOLS: read_file, list_files, run_command and — only when the task's own
// execution profile grants Write/Edit — write_file. `repo-read` and
// `repo-test` grant neither, so an investigate or test task never sees a
// write tool offered; the capability follows the profile the ACTION already
// resolved to, and no instruction inside a task can add one.
//
// The runner's ceiling stays lower than the policy's everywhere it matters:
// the profile permits git, ls, cat and more, and this file will start none
// of them (ALLOWED_PROGRAMS below), so there is no path to commit, push or
// merge from inside a tool call.
//
// The grant comes from lib/policy.js `toolsForProfile` — the same profile
// fields `claudeArgsForProfile` renders into CLI flags. No second permission
// dictionary exists, so `repo-read` cannot acquire a write tool by drifting.
//
// CONFINEMENT, all of it enforced here and all fail-closed:
//   * task.working_directory must exist, be absolute, and realpath to itself;
//     absent or unresolvable => refuse before the model is ever called.
//   * every path argument: resolved against the workspace, realpath'd, and
//     required to sit inside it. Traversal, absolute escapes and symlinks
//     pointing out all fail the same containment test, because the test is
//     on the RESOLVED path, not the string.
//   * run_command: argv only. No shell, no string command, no interpolation.
//     The program must be in this file's own ALLOWED_PROGRAMS map (absolute
//     paths, resolved once at load) AND permitted by the profile. sh, bash
//     and sudo are not in the map and cannot be added by configuration.
//   * bounded: tool calls, iterations, output bytes, and the task's own
//     timeout, whichever ends first.
//
// executionAuthority is TRUE, and for the first time honestly so: there is a
// real tool surface for the profile to constrain. The advisory providers
// keep theirs at false and carry no tools at all.
// =====================================================

var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var policy = require('../lib/policy');
var adapter = require('../free-llm/adapter');

var PROVIDER_ID = 'haddad-agent';

var DEFAULT_BASE_URL = process.env.HADDAD_AGENT_BASE_URL || 'http://127.0.0.1:8600/v1';
var DEFAULT_KEY_FILE = process.env.HADDAD_AGENT_KEY_FILE ||
  path.join(os.homedir(), '.config', 'mythos-haddad', 'runtime.key');
// Opt-in marker. Absent => available() is false => the executor never routes
// here. This is what keeps the provider inert on the VPS, where the file does
// not exist and the local runtime is not listening either.
var ENABLE_MARKER = process.env.HADDAD_AGENT_ENABLE_FILE ||
  path.join(os.homedir(), '.config', 'mythos-haddad', 'agent.enabled');

// Bounds. Constants, not tunables: a limit an instruction could raise is not
// a limit. The task's own timeout_seconds still applies on top and whichever
// expires first stops the loop.
var MAX_ITERATIONS = 12;
var MAX_TOOL_CALLS = 24;
var MAX_TOOL_OUTPUT_BYTES = 16 * 1024;
var MAX_READ_BYTES = 64 * 1024;
var MAX_LIST_ENTRIES = 400;
var COMMAND_TIMEOUT_MS = 120000;
var DEFAULT_TASK_TIMEOUT_S = 900;

// THE CODE CEILING. The profile may permit git, ls, rg, cat and more; this
// runner will execute none of them. Two programs, resolved to absolute paths
// once at load so PATH cannot be used to substitute a different binary later.
// sh/bash/sudo are absent by construction — there is no configuration that
// adds an entry to this map.
var ALLOWED_PROGRAMS = (function () {
  var wanted = ['node', 'npm'];
  var dirs = ['/usr/bin', '/bin', '/usr/local/bin'];
  var out = {};
  wanted.forEach(function (name) {
    for (var i = 0; i < dirs.length; i++) {
      var p = path.join(dirs[i], name);
      try {
        if (fs.statSync(p).isFile()) { out[name] = p; return; }
      } catch (e) { /* keep looking */ }
    }
  });
  return out;
})();

function readKey(file) {
  try {
    var t = fs.readFileSync(file || DEFAULT_KEY_FILE, 'utf8').trim();
    return t || null;
  } catch (e) { return null; }
}

function version() { return PROVIDER_ID + '/1a'; }

// Cheap by contract — the executor probes providers at startup. No network,
// no spawn: three stat-like checks. Absent marker or absent key => false,
// which is the VPS case and the un-set-up case alike.
function available(opts) {
  opts = opts || {};
  try {
    if (!fs.existsSync(opts.enableFile || ENABLE_MARKER)) return false;
  } catch (e) { return false; }
  if (!readKey(opts.keyFile)) return false;
  return Object.keys(ALLOWED_PROGRAMS).length > 0;
}

// ---------------------------------------------------------------- workspace

// The single containment primitive. Everything a tool touches goes through
// this. It resolves first and tests the RESOLVED path, so `../` chains and
// symlinks that point outside are the same failure, not two special cases.
function resolveInside(workspace, candidate) {
  if (typeof candidate !== 'string' || !candidate.length) {
    return { ok: false, reason: 'path must be a non-empty string' };
  }
  if (candidate.indexOf('\0') !== -1) {
    return { ok: false, reason: 'path contains a null byte' };
  }
  var abs = path.resolve(workspace, candidate);
  var realWorkspace;
  try { realWorkspace = fs.realpathSync(workspace); } catch (e) {
    return { ok: false, reason: 'workspace is not resolvable' };
  }
  // Resolve the deepest existing ancestor, so a not-yet-existing path is
  // still judged on where it would really land rather than on its spelling.
  var probe = abs, tail = [];
  for (;;) {
    try { probe = fs.realpathSync(probe); break; } catch (e) {
      var parent = path.dirname(probe);
      if (parent === probe) return { ok: false, reason: 'path is not resolvable' };
      tail.unshift(path.basename(probe));
      probe = parent;
    }
  }
  var real = tail.length ? path.join(probe, tail.join(path.sep)) : probe;
  if (real !== realWorkspace && real.indexOf(realWorkspace + path.sep) !== 0) {
    return { ok: false, reason: 'path resolves outside the task workspace' };
  }
  return { ok: true, path: real };
}

// ------------------------------------------------------------------- tools

function toolReadFile(ctx, args) {
  var r = resolveInside(ctx.workspace, args && args.path);
  if (!r.ok) return { error: 'REFUSED: ' + r.reason };
  if (underGitDir(ctx.workspace, r.path)) return { error: 'REFUSED: .git is not readable by this runner' };
  var st;
  try { st = fs.lstatSync(r.path); } catch (e) { return { error: 'REFUSED: no such file' }; }
  if (st.isSymbolicLink()) return { error: 'REFUSED: symbolic links are not read' };
  if (!st.isFile()) return { error: 'REFUSED: not a regular file' };
  if (st.size > MAX_READ_BYTES) return { error: 'REFUSED: file larger than ' + MAX_READ_BYTES + ' bytes' };
  try {
    return { content: fs.readFileSync(r.path, 'utf8') };
  } catch (e) { return { error: 'REFUSED: unreadable' }; }
}

// A WRITER needs one containment the readers never did. `resolveInside`
// keeps every path inside the workspace — but the workspace is a git
// worktree, and `.git` inside it is not ordinary content: a file written to
// `.git/hooks/` runs as a program the next time anything invokes git there,
// and `.git/config` can point the repository at another remote or turn on a
// hook path. The bridge and the delivery relay DO run git in these trees, so
// a write under `.git` is code execution under someone else's authority,
// laundered through a path that is technically "inside the workspace".
//
// This is refused for reads too, so the runner never even shows a model the
// material it would need to craft such a write.
function underGitDir(workspace, real) {
  var rel = path.relative(workspace, real);
  if (!rel) return false;
  return rel.split(path.sep).indexOf('.git') !== -1;
}

var MAX_WRITE_BYTES = 256 * 1024;

function toolWriteFile(ctx, args) {
  var r = resolveInside(ctx.workspace, args && args.path);
  if (!r.ok) return { error: 'REFUSED: ' + r.reason };
  if (underGitDir(ctx.workspace, r.path)) {
    return { error: 'REFUSED: .git is not writable — a hook or config written there would execute outside this task' };
  }
  var content = args && args.content;
  if (typeof content !== 'string') return { error: 'REFUSED: content must be a string' };
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
    return { error: 'REFUSED: content larger than ' + MAX_WRITE_BYTES + ' bytes' };
  }
  // An existing target must be an ordinary file. Writing THROUGH a symlink
  // would follow it wherever it points, which is the one thing resolveInside
  // cannot see for a link created after its check.
  var existing = null;
  try { existing = fs.lstatSync(r.path); } catch (e) { /* new file */ }
  if (existing) {
    if (existing.isSymbolicLink()) return { error: 'REFUSED: will not write through a symbolic link' };
    if (!existing.isFile()) return { error: 'REFUSED: target exists and is not a regular file' };
  }
  // The parent must already exist inside the workspace. Creating directory
  // trees is not part of editing a project, and every directory this runner
  // does not create is one it cannot be tricked into creating elsewhere.
  var parent = path.dirname(r.path);
  var pstat;
  try { pstat = fs.lstatSync(parent); } catch (e) { return { error: 'REFUSED: parent directory does not exist' }; }
  if (pstat.isSymbolicLink() || !pstat.isDirectory()) {
    return { error: 'REFUSED: parent is not a real directory inside the workspace' };
  }
  try {
    fs.writeFileSync(r.path, content, { encoding: 'utf8', mode: 0o644 });
  } catch (e) {
    return { error: 'REFUSED: write failed: ' + String(e.message).slice(0, 120) };
  }
  return { written: path.relative(ctx.workspace, r.path), bytes: Buffer.byteLength(content, 'utf8'),
    created: !existing };
}

function toolListFiles(ctx, args) {
  var target = (args && args.path) ? args.path : '.';
  var r = resolveInside(ctx.workspace, target);
  if (!r.ok) return { error: 'REFUSED: ' + r.reason };
  var st;
  try { st = fs.statSync(r.path); } catch (e) { return { error: 'REFUSED: no such directory' }; }
  if (!st.isDirectory()) return { error: 'REFUSED: not a directory' };
  var names;
  try { names = fs.readdirSync(r.path, { withFileTypes: true }); } catch (e) { return { error: 'REFUSED: unreadable' }; }
  var out = names.slice(0, MAX_LIST_ENTRIES).map(function (d) {
    return d.isDirectory() ? d.name + '/' : d.name;
  });
  return { entries: out, truncated: names.length > MAX_LIST_ENTRIES };
}

// Does the profile permit this exact argv? `prefix` rules match a leading
// argv slice; non-prefix rules must match the whole argv.
function commandPermittedByProfile(grant, program, argv) {
  return grant.commands.some(function (rule) {
    if (rule.program !== program) return false;
    if (rule.prefix) {
      return rule.args.every(function (a, i) { return argv[i] === a; });
    }
    return rule.args.length === argv.length &&
      rule.args.every(function (a, i) { return argv[i] === a; });
  });
}

function toolRunCommand(ctx, args) {
  var program = args && args.program;
  var argv = (args && args.args) || [];
  if (typeof program !== 'string') return { error: 'REFUSED: program must be a string' };
  if (!Array.isArray(argv)) return { error: 'REFUSED: args must be an array' };
  if (argv.length > 16) return { error: 'REFUSED: too many arguments' };
  for (var i = 0; i < argv.length; i++) {
    if (typeof argv[i] !== 'string') return { error: 'REFUSED: every argument must be a string' };
    if (argv[i].indexOf('\0') !== -1) return { error: 'REFUSED: argument contains a null byte' };
    if (argv[i].length > 256) return { error: 'REFUSED: argument too long' };
  }
  // Code ceiling first, profile second. Either refusal is final.
  var bin = ALLOWED_PROGRAMS[program];
  if (!bin) return { error: 'REFUSED: "' + program + '" is not an executable this runner will start' };
  if (!commandPermittedByProfile(ctx.grant, program, argv)) {
    return { error: 'REFUSED: the ' + ctx.grant.profile + ' profile does not permit ' + program + ' with those arguments' };
  }
  // argv array, absolute binary, no shell. There is no code path here that
  // builds a command string, so there is nothing for an argument to escape
  // out of.
  var r = cp.spawnSync(bin, argv, {
    cwd: ctx.workspace,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_TOOL_OUTPUT_BYTES * 4,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: ctx.workspace, LANG: 'C', NO_COLOR: '1' }
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { error: 'REFUSED: command timed out' };
  if (r.error) return { error: 'REFUSED: ' + String(r.error.message).slice(0, 200) };
  return {
    exit_code: r.status,
    stdout: String(r.stdout || '').slice(0, MAX_TOOL_OUTPUT_BYTES),
    stderr: String(r.stderr || '').slice(0, 2000)
  };
}

var TOOL_IMPL = {
  read_file: toolReadFile,
  list_files: toolListFiles,
  write_file: toolWriteFile,
  run_command: toolRunCommand
};

// The schemas handed to the model, built from the grant so a profile that
// permits no commands never even sees run_command offered.
function toolSchemas(grant) {
  var out = [];
  if (grant.read_file) {
    out.push({ type: 'function', function: { name: 'read_file',
      description: 'Read a UTF-8 text file inside the task workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'path relative to the workspace' } }, required: ['path'] } } });
    out.push({ type: 'function', function: { name: 'list_files',
      description: 'List directory entries inside the task workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'directory relative to the workspace, default "."' } }, required: [] } } });
  }
  // Offered ONLY when the profile itself grants Write/Edit. `repo-read` and
  // `repo-test` grant neither, so an investigate or test task cannot be
  // talked into writing: the tool is not in the model's vocabulary at all.
  if (grant.write_file) {
    out.push({ type: 'function', function: { name: 'write_file',
      description: 'Create or replace a UTF-8 text file inside the task workspace. The whole file content must be given; there is no partial edit.',
      parameters: { type: 'object', properties: {
        path: { type: 'string', description: 'path relative to the workspace' },
        content: { type: 'string', description: 'the complete new file content' }
      }, required: ['path', 'content'] } } });
  }
  if (grant.commands.length) {
    var hint = grant.commands
      .filter(function (c) { return ALLOWED_PROGRAMS[c.program]; })
      .map(function (c) { return c.program + (c.args.length ? ' ' + c.args.join(' ') : '') + (c.prefix ? ' …' : ''); });
    if (hint.length) {
      out.push({ type: 'function', function: { name: 'run_command',
        description: 'Run one allowed read-only command in the workspace. Permitted: ' + hint.join(' | ') + '. No shell.',
        parameters: { type: 'object', properties: {
          program: { type: 'string', description: 'executable name, e.g. node' },
          args: { type: 'array', items: { type: 'string' }, description: 'argument vector' }
        }, required: ['program'] } } });
    }
  }
  return out;
}

// Built from the grant, so the prompt never describes a capability the run
// does not have — and never denies one it does. A model told it cannot write
// and then handed a write tool is being set up to disobey one of the two.
function systemPrompt(grant, schemas) {
  var names = schemas.map(function (s) { return s.function.name; });
  var lines = [
    'You are a local worker for Mythos OS running on the Haddad machine. '
      + 'Your tools over a single task workspace are: ' + names.join(', ') + '. '
      + 'Everything outside that workspace is refused, and a refused tool call is final — adapt rather than retrying it.'
  ];
  if (grant.write_file) {
    lines.push('write_file replaces a whole file: read it first, then send the complete new content. '
      + 'Change only what the task asks for. Never weaken or delete a test to make it pass, and never '
      + 'touch .git. You cannot commit, push or merge — leaving correct files in the workspace IS the deliverable.');
  } else {
    lines.push('You cannot write, edit or delete anything.');
  }
  lines.push('Use the tools to establish facts rather than assuming them. '
    + 'End your final message with a fenced json block containing '
    + '{"mythos_report": true, "status": "completed", "summary": "..."}.');
  return lines.join(' ');
}

function fail(code, message) {
  return {
    exit_code: 1, signal: null, timed_out: false, duration_ms: 0,
    stdout: '', stderr: code + ': ' + message,
    parsed: { is_error: true, subtype: code, result: message },
    session_id: null, started_pid: null
  };
}

// run(task, prompt, sessionId, mode, opts) -> Promise<outcome>. Resolves a
// failure rather than rejecting, exactly like every other provider.
function run(task, prompt, _sessionId, _mode, opts) {
  opts = opts || {};
  var started = Date.now();

  var workspace = task && task.working_directory;
  if (!workspace || !path.isAbsolute(workspace)) {
    return Promise.resolve(fail('HADDAD_AGENT_NO_WORKSPACE',
      'the task carries no absolute working_directory; a tool runner without a workspace has nothing it is allowed to touch'));
  }
  try {
    if (!fs.statSync(workspace).isDirectory()) throw new Error('not a directory');
  } catch (e) {
    return Promise.resolve(fail('HADDAD_AGENT_NO_WORKSPACE', 'working_directory does not exist or is not a directory'));
  }

  var grant;
  try {
    grant = policy.toolsForProfile(task.execution_profile);
  } catch (e) {
    return Promise.resolve(fail('HADDAD_AGENT_PROFILE_INVALID', String(e.message).slice(0, 200)));
  }
  var schemas = toolSchemas(grant);
  if (!schemas.length) {
    return Promise.resolve(fail('HADDAD_AGENT_NO_TOOLS',
      'the ' + grant.profile + ' profile grants no tool this runner implements'));
  }

  var apiKey = opts.apiKey || readKey(opts.keyFile);
  if (!apiKey) return Promise.resolve(fail('HADDAD_AGENT_UNCONFIGURED', 'no local runtime key'));
  var baseUrl = opts.baseUrl || DEFAULT_BASE_URL;
  var model = opts.model || task.model || process.env.HADDAD_AGENT_MODEL;
  if (!model) return Promise.resolve(fail('HADDAD_AGENT_UNCONFIGURED', 'no model configured'));

  var deadline = started + (Number(task.timeout_seconds) || DEFAULT_TASK_TIMEOUT_S) * 1000;
  var ctx = { workspace: workspace, grant: grant };
  var messages = [
    { role: 'system', content: systemPrompt(grant, schemas) },
    { role: 'user', content: String(prompt) }
  ];
  var toolCallCount = 0;
  var trace = [];

  function finish(outcome) {
    outcome.duration_ms = Date.now() - started;
    outcome.tool_calls = toolCallCount;
    outcome.tool_trace = trace;
    return outcome;
  }

  function step(iteration) {
    if (Date.now() > deadline) {
      return Promise.resolve(finish({
        exit_code: 1, signal: null, timed_out: true, stdout: '', stderr: 'HADDAD_AGENT_TIMEOUT: task deadline reached',
        parsed: { is_error: true, subtype: 'HADDAD_AGENT_TIMEOUT', result: 'task deadline reached' },
        session_id: null, started_pid: null
      }));
    }
    if (iteration >= MAX_ITERATIONS) {
      return Promise.resolve(finish({
        exit_code: 1, signal: null, timed_out: false, stdout: '',
        stderr: 'HADDAD_AGENT_MAX_ITERATIONS: stopped after ' + MAX_ITERATIONS + ' model turns',
        parsed: { is_error: true, subtype: 'HADDAD_AGENT_MAX_ITERATIONS', result: 'iteration budget spent' },
        session_id: null, started_pid: null
      }));
    }

    return adapter.chatCompletion(
      { baseUrl: baseUrl, apiKey: apiKey, model: model, providerId: PROVIDER_ID },
      messages,
      { timeoutMs: Math.max(1000, Math.min(deadline - Date.now(), 300000)), tools: schemas, transport: opts.transport }
    ).then(function (res) {
      if (!res || !res.message) {
        return finish({
          exit_code: 1, signal: null, timed_out: !!(res && res.timed_out), stdout: '',
          stderr: 'HADDAD_AGENT_RUNTIME: ' + String((res && res.stderr) || 'no message from the runtime').slice(0, 300),
          parsed: { is_error: true, subtype: 'HADDAD_AGENT_RUNTIME', result: 'local runtime did not answer' },
          session_id: null, started_pid: null
        });
      }
      var msg = res.message;
      var calls = msg.tool_calls || [];
      if (!calls.length) {
        var text = String(msg.content || '');
        return finish({
          exit_code: 0, signal: null, timed_out: false, stdout: text, stderr: '',
          parsed: { is_error: false, result: text },
          session_id: null, started_pid: null
        });
      }

      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
      for (var i = 0; i < calls.length; i++) {
        var c = calls[i];
        toolCallCount++;
        var name = c.function && c.function.name;
        var result;
        if (toolCallCount > MAX_TOOL_CALLS) {
          result = { error: 'REFUSED: tool-call budget of ' + MAX_TOOL_CALLS + ' is spent' };
        } else {
          var parsedArgs = {};
          try { parsedArgs = JSON.parse((c.function && c.function.arguments) || '{}'); } catch (e) { parsedArgs = null; }
          var impl = TOOL_IMPL[name];
          // Fail closed on anything unrecognised: an unknown tool, a tool the
          // grant did not offer, or arguments that are not an object.
          if (!impl) result = { error: 'REFUSED: unknown tool "' + String(name).slice(0, 40) + '"' };
          else if (!schemas.some(function (s) { return s.function.name === name; })) result = { error: 'REFUSED: tool not granted by the ' + grant.profile + ' profile' };
          else if (!parsedArgs || typeof parsedArgs !== 'object') result = { error: 'REFUSED: arguments are not a JSON object' };
          else result = impl(ctx, parsedArgs);
        }
        trace.push({ tool: name, refused: !!result.error, detail: result.error || null });
        var payload = JSON.stringify(result);
        if (payload.length > MAX_TOOL_OUTPUT_BYTES) {
          payload = JSON.stringify({ error: 'REFUSED: result exceeded ' + MAX_TOOL_OUTPUT_BYTES + ' bytes' });
        }
        messages.push({ role: 'tool', tool_call_id: c.id, content: payload });
      }
      return step(iteration + 1);
    });
  }

  return step(0).catch(function (e) {
    return finish(fail('HADDAD_AGENT_ERROR', String(e && e.message).slice(0, 200)));
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  version: version,
  available: available,
  run: run,
  executionAuthority: true,
  // Exported for the invariant tests: these are the security surfaces, and a
  // test that cannot reach them cannot guard them.
  resolveInside: resolveInside,
  underGitDir: underGitDir,
  systemPrompt: systemPrompt,
  toolSchemas: toolSchemas,
  commandPermittedByProfile: commandPermittedByProfile,
  ALLOWED_PROGRAMS: ALLOWED_PROGRAMS,
  TOOL_IMPL: TOOL_IMPL,
  MAX_ITERATIONS: MAX_ITERATIONS,
  MAX_TOOL_CALLS: MAX_TOOL_CALLS,
  MAX_TOOL_OUTPUT_BYTES: MAX_TOOL_OUTPUT_BYTES
};
