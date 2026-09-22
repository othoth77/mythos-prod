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
//   * run_command: argv only, and the process runs inside a bwrap namespace
//     where the workspace is the only writable mount, /usr is read-only,
//     /etc and $HOME do not exist and there is no network. The allow-list
//     (node, npm) and the argv rules narrow what is ASKED; the namespace is
//     what bounds what a running interpreter can DO — `node -e` was shown
//     escaping every check that was not a namespace. No sandbox, no command.
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

var reporting = require('../lib/report');
var policy = require('../lib/policy');
var adapter = require('../free-llm/adapter');
var work = require('../lib/work-validation');

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
// Repair rounds are NOT retries. A retry re-runs a task the executor
// already gave up on; a repair round hands this same attempt its own
// measured failures and lets it try again with them in hand. Three
// executions total — the first plus two repairs — then the task stops for a
// person. A loop whose bound an instruction could raise is not a bound.
var MAX_REPAIR_ROUNDS = 2;

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

// THE BOUNDARY. Everything above this line — the allow-list, the argv rules,
// the path containment — restricts what a command is ASKED to do. None of it
// restricts what a command DOES once it is running, and `node` is a general
// interpreter: `node -e` was demonstrated writing outside the workspace,
// spawning a shell as this user, and reaching the network, straight through
// every one of those checks.
//
// So the command runs inside a mount/network/pid namespace where the escape
// is not forbidden but ABSENT: the workspace is the only writable thing that
// exists, /usr is read-only, /etc and $HOME are not mounted at all, and there
// is no network. bwrap is already installed on this host and needs no
// privileges; nothing new is introduced.
//
// FAIL CLOSED: no sandbox, no commands. There is deliberately no path that
// runs a command unconfined because the sandbox was unavailable.
var SANDBOX_BIN = (function () {
  var candidates = ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap'];
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.statSync(candidates[i]).isFile()) return candidates[i]; } catch (e) { /* keep looking */ }
  }
  return null;
})();

// Top-level directories a language runtime needs, mounted READ-ONLY. /etc and
// /home are deliberately absent: that is what makes ~/.ssh, the runtime key
// and every system credential unreachable rather than merely forbidden.
function sandboxArgv(workspace, bin, argv) {
  var a = ['--ro-bind', '/usr', '/usr'];
  [['usr/bin', '/bin'], ['usr/lib', '/lib'], ['usr/lib64', '/lib64'], ['usr/sbin', '/sbin']].forEach(function (pair) {
    try { if (fs.existsSync('/' + pair[0])) a.push('--symlink', pair[0], pair[1]); } catch (e) { /* skip */ }
  });
  a = a.concat([
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    // The workspace at its REAL path, so a path the model read is the same
    // path the command sees, and it is the only writable mount in here.
    '--bind', workspace, workspace,
    // Everything bwrap had to invent to hold that bind — the empty parent
    // directories — becomes read-only, so a write above the workspace fails
    // with EROFS instead of quietly landing on a throwaway tmpfs and telling
    // the model it succeeded. /proc, /dev and /tmp are separate mounts and
    // keep their own modes (a runtime needs a writable temp dir).
    '--remount-ro', '/',
    '--chdir', workspace,
    // Namespaces: no network, no host pids, no host ipc. --new-session stops
    // terminal-injection tricks against the parent.
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--clearenv',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'HOME', workspace,
    '--setenv', 'LANG', 'C',
    '--setenv', 'NO_COLOR', '1',
    '--'
  ]);
  return a.concat([bin]).concat(argv);
}

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

// Scope rules, layered ON TOP of the sandbox rather than instead of it. The
// sandbox already makes these harmless; refusing them keeps the runner's
// behaviour legible — a task that asks to evaluate a string is not doing the
// thing this runner exists for, and saying so is better than letting it run
// confined and fail strangely.
var NODE_CODE_FLAGS = ['-e', '--eval', '-p', '--print', '--require', '-r',
  '--input-type', '-i', '--interactive', '--eval-file'];
var NPM_ALLOWED_VERBS = [['test'], ['run', 'test'], ['run-script', 'test']];

function scopeRefusal(program, argv) {
  if (program === 'node') {
    for (var i = 0; i < argv.length; i++) {
      var a = argv[i];
      if (a === '--') break;
      var flag = a.split('=')[0];
      if (NODE_CODE_FLAGS.indexOf(flag) !== -1) {
        return 'node ' + flag + ' evaluates code given as an argument; run a file inside the workspace instead';
      }
      if (a === '-') return 'node cannot take a program on stdin here';
    }
  }
  if (program === 'npm') {
    var ok = NPM_ALLOWED_VERBS.some(function (verb) {
      return verb.every(function (w, i) { return argv[i] === w; });
    });
    if (!ok) {
      return 'npm may only run the test script here (npm test / npm run test); install and arbitrary scripts are not available';
    }
  }
  return null;
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
  var scoped = scopeRefusal(program, argv);
  if (scoped) return { error: 'REFUSED: ' + scoped };
  // FAIL CLOSED. A command is only ever started inside the sandbox.
  if (!SANDBOX_BIN) {
    return { error: 'REFUSED: no sandbox available on this host, so no command runs' };
  }
  // argv array, absolute binary, no shell, inside the namespace. There is no
  // code path here that builds a command string, and none that starts a
  // process outside sandboxArgv().
  var r = cp.spawnSync(SANDBOX_BIN, sandboxArgv(ctx.workspace, bin, argv), {
    cwd: ctx.workspace,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_TOOL_OUTPUT_BYTES * 4,
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', LANG: 'C' }
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
  // Without a sandbox there is no safe way to start a process, so the tool is
  // not offered at all rather than offered and always refused.
  if (grant.commands.length && SANDBOX_BIN) {
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
  // Taken BEFORE the model is called even once, so "what changed" is
  // measured against the state the task actually started from.
  var before = work.snapshot(workspace);
  var repairRound = 0;
  var traceMarkAtRoundStart = 0;
  var validations = [];

  function finish(outcome) {
    outcome.duration_ms = Date.now() - started;
    outcome.tool_calls = toolCallCount;
    outcome.tool_trace = trace;
    outcome.validations = validations;
    outcome.repair_rounds = repairRound;
    return outcome;
  }

  // Runs the declared acceptance checks inside the same sandbox the worker
  // used, through the same tool — so the checks are subject to every
  // confinement the worker was, and no second execution path exists.
  function validatorRunCommand(program, args) {
    return toolRunCommand(ctx, { program: program, args: args });
  }

  // Stopping for a PERSON is not the same as crashing. The executor already
  // has a seam for this — a provider that ends cleanly with a report whose
  // status is `blocked` is classified as a human decision (lib/quota.js
  // classifyBlockedReport → HUMAN_APPROVAL) rather than a fatal error — so
  // this uses that instead of inventing a second way to say it. The
  // difference is what the Issue ends up saying: "needs a human, here is the
  // measured evidence" rather than a bare FAILED.
  // A rejection can quote an error that itself contains a code fence — the
  // "no fenced ```json block" diagnosis is the common one — and embedding
  // that verbatim would close the report's own fence early and corrupt it.
  // The report must survive its own contents.
  function fenceSafe(v) {
    return String(v === undefined || v === null ? '' : v).replace(/`{3,}/g, "'''");
  }

  function stopForHuman(text, verdict, why) {
    var rejections = ((verdict && verdict.rejections) || []).map(fenceSafe);
    var summary = why + (rejections.length ? ' — ' + rejections.join(' | ') : '');
    var blockedReport = {
      mythos_report: true,
      status: 'blocked',
      summary: fenceSafe(summary).slice(0, 1500),
      files_changed: verdict && verdict.evidence ? verdict.evidence.changed.created.concat(verdict.evidence.changed.modified) : [],
      tests: verdict && verdict.evidence ? (verdict.evidence.checks_run || []).map(function (c) {
        return fenceSafe(c.check + ': ' + (c.passed ? 'pass' : 'FAIL' + (c.exit_code === null ? '' : ' (exit ' + c.exit_code + ')')));
      }) : [],
      residual_risks: rejections.slice(0, 20),
      next_stage: 'a person decides: the evidence above is measured, not reported by the worker'
    };
    // What the attempt DID, turn by turn, so "12 turns" is readable as
    // "read, wrote, ran the test, ran it again…" by the person who decides.
    var traceLines = trace.map(function (e, i) {
      return (i + 1) + '. ' + e.tool + (e.target ? ' ' + fenceSafe(e.target) : '') + (e.refused ? ' → REFUSED: ' + fenceSafe(e.detail).slice(0, 80) : '');
    });
    var stdoutText = text + '\n\n## Tool trace (' + trace.length + ' calls, ' + (repairRound + 1) + ' execution(s))\n' +
      (traceLines.length ? traceLines.join('\n') : '(no tool call)') +
      '\n\n```json\n' + JSON.stringify(blockedReport, null, 2) + '\n```\n';
    return finish({
      exit_code: 0, signal: null, timed_out: false,
      stdout: stdoutText,
      stderr: '',
      // The executor extracts the structured report from parsed.result, not
      // from stdout (handleSuccess → extractReport(parsed.result)). A summary
      // here alone lands as NO_STRUCTURED_REPORT — measured live on
      // gh-issue-372 — so the same text goes to both.
      parsed: { is_error: false, result: stdoutText },
      validation: verdict ? { passed: false, attempts: repairRound + 1, rejections: rejections, evidence: verdict.evidence } : null,
      session_id: null, started_pid: null
    });
  }

  // Validation runs even when the loop ran out of turns. Otherwise the
  // report says "12 turns" and nothing about what the attempt actually DID —
  // and a run observed live had by then edited the test file to make it
  // pass, which is exactly the thing a person needs told.
  function validateNow(text) {
    var after = work.snapshot(workspace);
    var verdict = work.validateWork({
      report: reporting.extractReport(text).report,
      workspace: workspace, before: before, after: after,
      checks: task.required_tests || [],
      scope: task.constraints || [],
      requiredFiles: [],
      runCommand: validatorRunCommand
    });
    validations.push({ attempt: repairRound + 1, pass: verdict.pass, rejections: verdict.rejections, evidence: verdict.evidence });
    return verdict;
  }

  function settleOrRepair(text) {
    var parsedReport = reporting.extractReport(text);
    var after = work.snapshot(workspace);
    var verdict = work.validateWork({
      report: parsedReport.report,
      workspace: workspace,
      before: before,
      after: after,
      checks: task.required_tests || [],
      // Scope comes from what the task CONSTRAINED, never from its
      // acceptance criteria: the criteria name the files that must keep
      // working, and treating them as the permitted scope would mean "you
      // may only edit the test" — the precise opposite of the intent.
      scope: task.constraints || [],
      requiredFiles: [],
      runCommand: validatorRunCommand
    });
    // A report that could not be read is itself a rejection, named as such
    // rather than folded into "something went wrong".
    if (!parsedReport.report) {
      verdict.pass = false;
      verdict.rejections.unshift('report: ' + parsedReport.error);
    }
    validations.push({ attempt: repairRound + 1, pass: verdict.pass, rejections: verdict.rejections, evidence: verdict.evidence });

    if (verdict.pass) {
      return finish({
        exit_code: 0, signal: null, timed_out: false, stdout: text, stderr: '',
        parsed: { is_error: false, result: text },
        validation: { passed: true, attempts: repairRound + 1, evidence: verdict.evidence },
        session_id: null, started_pid: null
      });
    }

    if (repairRound >= MAX_REPAIR_ROUNDS) {
      // The budget is spent. This is a stop for a person, not a crash and
      // not another try.
      return stopForHuman(text, verdict,
        'validation still failing after ' + (repairRound + 1) + ' attempt(s); the repair budget is spent');
    }

    var callsThisRound = trace.length - traceMarkAtRoundStart;
    repairRound++;
    traceMarkAtRoundStart = trace.length;
    messages.push({ role: 'assistant', content: text });
    messages.push({ role: 'user', content: work.renderRepairNotes(verdict, repairRound, task.constraints || [], {
      tool_calls: callsThisRound,
      // The files the task constrained the worker to are the ones it must fix.
      files_named: work.declaredScope(task.constraints || [])
    }) });
    return step(0);
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
      // Measure what it did before saying why it stopped: "12 turns" is not
      // a finding, "it edited the check" is.
      var capVerdict = validateNow('');
      // Running out of turns is a REJECTED attempt, not a verdict on the
      // work: live (gh-issue-374) the worker had every check passing by the
      // validator's own run and had simply not written the report. So the
      // cap feeds the same bounded repair path as any other rejection — the
      // brief carries the measured state (checks passing → emit the report;
      // a check failing → fix it) — and only a spent budget stops for a
      // person. Three executions in total either way.
      if (repairRound >= MAX_REPAIR_ROUNDS) {
        return Promise.resolve(stopForHuman('', capVerdict,
          'stopped after ' + MAX_ITERATIONS + ' model turns without a final answer; the repair budget is spent'));
      }
      var callsThisRound = trace.length - traceMarkAtRoundStart;
      repairRound++;
      traceMarkAtRoundStart = trace.length;
      messages.push({ role: 'user', content: work.renderRepairNotes(capVerdict, repairRound, task.constraints || [], {
        tool_calls: callsThisRound,
        out_of_turns: MAX_ITERATIONS,
        files_named: work.declaredScope(task.constraints || [])
      }) });
      return step(0);
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
        // The model says it is done. That is a CLAIM, and the only thing
        // that decides whether the task is done is evidence: the acceptance
        // checks re-run here, and the workspace measured against the
        // snapshot taken before the attempt started. If the evidence
        // disagrees with the claim, the claim loses.
        var text = String(msg.content || '');
        return settleOrRepair(text);
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
        trace.push({ tool: name, refused: !!result.error, detail: result.error || null,
          target: parsedArgs && typeof parsedArgs === 'object'
            ? String(parsedArgs.path || (parsedArgs.program ? [parsedArgs.program].concat(parsedArgs.args || []).join(' ') : '')).slice(0, 80)
            : null });
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
  sandboxArgv: sandboxArgv,
  scopeRefusal: scopeRefusal,
  SANDBOX_BIN: SANDBOX_BIN,
  systemPrompt: systemPrompt,
  toolSchemas: toolSchemas,
  commandPermittedByProfile: commandPermittedByProfile,
  ALLOWED_PROGRAMS: ALLOWED_PROGRAMS,
  TOOL_IMPL: TOOL_IMPL,
  MAX_ITERATIONS: MAX_ITERATIONS,
  MAX_REPAIR_ROUNDS: MAX_REPAIR_ROUNDS,
  MAX_TOOL_CALLS: MAX_TOOL_CALLS,
  MAX_TOOL_OUTPUT_BYTES: MAX_TOOL_OUTPUT_BYTES
};
