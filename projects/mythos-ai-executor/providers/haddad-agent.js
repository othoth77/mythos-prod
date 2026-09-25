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
var roles = require('../lib/roles');
var gpuSlots = require('../lib/gpu-slots');
var adapter = require('../free-llm/adapter');
var work = require('../lib/work-validation');
var modelPolicy = require('../lib/model-policy');

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
// V3.1 ESCALATION, second tier. When the last standard repair round carried
// a STANDARD-tier diagnosis (Sonnet) and validation still failed, ONE more
// round may run with the DEEP-tier diagnoser (Opus) — the owner's chain
// Qwen → Sonnet → Opus → Qwen executes. It exists only when the host names
// a deep diagnoser (HADDAD_AGENT_DIAGNOSER_DEEP); otherwise the loop is the
// three-execution loop it always was. A task whose signals already scored
// `deep` (lib/model-policy.js) gets the deep diagnoser on the standard last
// round and no extra round: Opus is asked at most once per task either way.
var MAX_DEEP_ROUNDS = 1;
// V3.1 STRUCTURED REPORT. When the model's final message carries no readable
// report, one CONSTRAINED turn asks for the report as a JSON document whose
// shape the runtime enforces (llama-server: response_format json_schema →
// grammar at the sampler). The schema mirrors lib/report.js's contract; the
// parser and the validator still decide, so this narrows what the model can
// emit and vouches for nothing. At most one such turn per execution.
var REPORT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'mythos_report',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        mythos_report: { type: 'boolean', 'const': true },
        status: { type: 'string', 'enum': ['completed', 'failed', 'blocked'] },
        summary: { type: 'string' },
        files_changed: { type: 'array', items: { type: 'string' } },
        tests: { type: 'array', items: { type: 'string' } },
        commit: { type: ['string', 'null'] },
        residual_risks: { type: 'array', items: { type: 'string' } }
      },
      required: ['mythos_report', 'status', 'summary', 'files_changed', 'tests', 'commit', 'residual_risks'],
      additionalProperties: false
    }
  }
};
var MAX_REPORT_TURNS_PER_EXECUTION = 1;
// One model turn is a tool call or a short answer plus a report; a file of
// the size the runner accepts plus a report fits comfortably. Measured live
// (gh-issue-375): an unbounded turn ran to ~3,800 tokens and past the
// request timeout, losing the whole execution to a transient retry.
var MAX_TOKENS_PER_TURN = 1536;
// THE CONTEXT WINDOW, and the budget derived from it (V2.1, measured live:
// a RESEARCHER task that read one 9 KB file and listed two directories sent
// a 9,710-token request into an 8,192-token runtime and the whole attempt
// failed PROVIDER_FAILED — no tool result had been too large on its own;
// they simply accumulated). The window is a property of the runtime
// deployment (`--ctx-size` in the runtime unit), so the host names it and
// the default is that unit's value. Everything else is derived: a request
// must leave MAX_TOKENS_PER_TURN for the answer, plus a margin for the
// tokenizer's disagreement with the estimate below.
var CONTEXT_WINDOW_TOKENS = (function () {
  var raw = parseInt(process.env.HADDAD_AGENT_CONTEXT_TOKENS, 10);
  return isNaN(raw) || raw < 2048 ? 8192 : raw;
})();
var CONTEXT_MARGIN_TOKENS = 384;
var PROMPT_BUDGET_TOKENS = CONTEXT_WINDOW_TOKENS - MAX_TOKENS_PER_TURN - CONTEXT_MARGIN_TOKENS;
// Chars per token, deliberately BELOW what this model actually does, so the
// estimate errs toward refusing a request that would have fit rather than
// sending one that cannot. Measured against the live runtime on 2026-09-22
// (Qwen2.5-7B-Q4_K_M, real material): an executor task prompt 3.75, a JS
// source file 3.86, a tool-result JSON 3.25 — JSON is the dense case because
// of its escapes, and it is also the bulk of a long conversation. The
// runtime's own `usage.prompt_tokens` re-anchors the estimate after every
// answer, so this ratio only has to cover what was appended since.
var CHARS_PER_TOKEN = 3;
// A single tool result may not consume more than a third of the budget: a
// 16 KB read is ~5k tokens, most of an 8k window, and the model then cannot
// read a second file at all. Bounded by the window, not by a constant an
// instruction could argue with.
var MAX_TOOL_PAYLOAD_TOKENS = Math.floor(PROMPT_BUDGET_TOKENS / 3);
var MAX_TOOL_PAYLOAD_CHARS = Math.min(MAX_TOOL_OUTPUT_BYTES, MAX_TOOL_PAYLOAD_TOKENS * CHARS_PER_TOKEN);
var ELIDED_TOOL_STUB = JSON.stringify({ elided: 'this earlier tool result was removed to fit the context window; call the tool again if you still need it' });
var ELIDED_ARGS = JSON.stringify({ elided: true });

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
    // ...except .git, which is mounted back READ-ONLY on top of it.
    //
    // read_file/write_file already refuse .git, but that is a rule at the
    // TOOL layer and the runner's whole purpose is to run the model's own
    // code. Measured, not theorised: a script written to an ordinary path
    // and started with the permitted `node <file>` appended
    // `core.hooksPath = ../evil-hooks` to .git/config; the validator never
    // saw it (.git is in work-validation's IGNORED_DIRS, so the diff was
    // empty) and the attempt could still pass. The executor then commits in
    // that workspace OUTSIDE this sandbox, and `--no-verify` does not stop a
    // post-commit hook — verified: it ran. That is arbitrary code as the
    // host user, with the network and $HOME the sandbox exists to deny.
    //
    // So the boundary, not the rule, is what says no: inside here .git is
    // EROFS to every process, whatever it was told to run. -try because a
    // workspace legitimately may not be a repository at all.
    '--ro-bind-try', path.join(workspace, '.git'), path.join(workspace, '.git'),
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

// The registry's probe (V2.1). available() is the cheap, stat-only contract
// the executor uses at startup; the AGENT REGISTRY needs the stronger
// answer "would a task routed here run right now?", which on this host
// means the local llama-server is answering. Its /health endpoint is public
// (no key on the wire, nothing to leak) and answered by a resolved curl in a
// bounded subprocess — the registry's health check is synchronous by
// contract, exactly like claude-code's `claude --version` probe. Absent
// marker or key short-circuits before any request; absent curl is
// unavailable, never assumed up.
var CURL_BIN = (function () {
  var candidates = ['/usr/bin/curl', '/bin/curl', '/usr/local/bin/curl'];
  for (var i = 0; i < candidates.length; i++) {
    try { if (fs.statSync(candidates[i]).isFile()) return candidates[i]; } catch (e) { /* keep looking */ }
  }
  return null;
})();

function healthUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/health';
}

function runtimeAnswers(opts) {
  opts = opts || {};
  if (typeof opts.fetch === 'function') return opts.fetch(healthUrl(opts.baseUrl)) === 200; // test injection
  if (!CURL_BIN) return false;
  var r = cp.spawnSync(CURL_BIN, ['-s', '-m', '2', '-o', '/dev/null', '-w', '%{http_code}', healthUrl(opts.baseUrl)],
    { encoding: 'utf8', timeout: 4000, env: { PATH: '/usr/bin:/bin' } });
  return r.status === 0 && String(r.stdout || '').trim() === '200';
}

function probe(opts) {
  opts = opts || {};
  if (!available(opts)) return false;
  return runtimeAnswers(opts);
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
  // A path that ends in a separator names a DIRECTORY, and this runner
  // creates none. `path.resolve` drops the trailing separator, so `lib/`
  // resolved to `<ws>/lib` and was written as a zero-byte regular FILE —
  // measured live (coder run t-20260922210225): every later write under
  // `lib/` then failed with "parent is not a real directory", and the stray
  // file was an out-of-scope change that cost the task its delivery. Refuse
  // it, and say what to send instead.
  if (args && typeof args.path === 'string' && /[\/\\]\s*$/.test(args.path)) {
    return { error: 'REFUSED: "' + String(args.path).slice(0, 80) + '" names a directory; this runner writes files and creates no directories — give the full path of the file itself' };
  }
  var r = resolveInside(ctx.workspace, args && args.path);
  if (!r.ok) return { error: 'REFUSED: ' + r.reason };
  if (underGitDir(ctx.workspace, r.path)) {
    return { error: 'REFUSED: .git is not writable — a hook or config written there would execute outside this task' };
  }
  // The task's DECLARED file scope, answered HERE so the model learns at the
  // write instead of from a rejected attempt three executions later.
  //
  // This is FEEDBACK, not a boundary, and the difference is load-bearing:
  // the validator still measures the whole workspace afterwards and still
  // decides, which is what catches a write made by a script the model ran
  // rather than by this tool (tests C1/C5 drive exactly that path). It uses
  // work-validation's own `withinScope`, so the two cannot disagree about
  // what "in scope" means, and it says nothing when the task declared no
  // file scope — a prose-only constraint declares none, and then nothing is
  // refused that was not refused before.
  //
  // Evidence, three independent live runs of round 2: the documenter wrote
  // correct content to the right file AND a stray `NOTES.md` at the
  // workspace root (t-20260922212316); the debugger wrote its fix to a root
  // `pct.js` so the real one was never fixed (t-20260922213017); round 1's
  // coder created a file called `lib` (t-20260922210225). Each produced
  // correct-or-near-correct work and lost it to a sibling the model was told
  // about only at the end.
  if (ctx.scope && ctx.scope.length) {
    var rel = path.relative(ctx.workspace, r.path);
    if (!work.withinScope(rel, ctx.scope)) {
      return { error: 'REFUSED: "' + rel + '" is outside the scope this task declared (' + ctx.scope.join(', ') +
        '). The validator rejects the whole attempt for a file like this — write the file the task named, at the path it named.' };
    }
  }
  // V3.2: the project's own write scope, refused at the tool with the same
  // matcher the validator uses (feedback; the validator still decides).
  if (ctx.projectScope && ctx.projectScope.length) {
    var prel = path.relative(ctx.workspace, r.path);
    if (!work.withinScope(prel, ctx.projectScope)) {
      return { error: 'REFUSED: "' + prel + '" is outside this project (it may only write under ' + ctx.projectScope.join(', ') + ')' };
    }
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
// `role` (V2.1) is the resolved config/roles.json entry, or null. Its brief
// is one bounded line of role-shaped instruction; it names no tool the grant
// did not offer and can never widen the grant — the grant is rendered first
// and the brief is appended under it.
function systemPrompt(grant, schemas, role, delivery) {
  var names = schemas.map(function (s) { return s.function.name; });
  var lines = [
    'You are a local worker for Mythos OS running on the Haddad machine. '
      + 'Your tools over a single task workspace are: ' + names.join(', ') + '. '
      + 'Everything outside that workspace is refused, and a refused tool call is final — adapt rather than retrying it.'
  ];
  if (role && typeof role.brief === 'string' && role.brief.trim()) lines.push(role.brief.trim());
  // The task's DELIVERY, stated as the fact it is — the same kind of
  // statement as the tool list above, derived from the task rather than
  // asked of the model. Measured live (tester run t-20260922230229): a
  // report-delivery task reported commit `7a186fc1a7b0` and two changed
  // files, having written nothing. The validator refused all three attempts
  // over it and the model never withdrew the claim, because nothing had told
  // it that a commit was not a thing this task could produce.
  if (delivery === 'report') {
    lines.push('This task delivers a REPORT, not a commit: there is no commit to make and none to mention. '
      + 'Never put a commit hash or a changed-file list in your report — saying you changed something you did not is the one failure this system always catches.');
  }
  if (grant.write_file) {
    lines.push('write_file replaces a whole file: read it first, then send the complete new content. '
      + 'Change only what the task asks for. Never weaken or delete a test to make it pass, and never '
      + 'touch .git. You cannot commit, push or merge — leaving correct files in the workspace IS the deliverable.');
  } else {
    lines.push('You cannot write, edit or delete anything.');
  }
  lines.push('Use the tools to establish facts rather than assuming them. '
    + 'End your final message with a fenced json block containing '
    + '{"mythos_report": true, "status": "completed", "summary": "..."}. '
    // Measured live (debugger run t-20260922210645): the model wrote a
    // CORRECT fix, then wrote its report to `.mythos_report.json` instead of
    // saying it — an out-of-scope file, so the validated work was refused
    // delivery over a misunderstood channel. The report is a message, and
    // saying so costs nothing.
    + 'The report goes in that message, as text you write to me: never create a report file, '
    + 'and never count writing one as reporting.');
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
// V3.1: which diagnoser tier a task's escalation should reach first. No new
// table: the decision is lib/model-policy.js's own — an explicit `Model:` on
// the task wins (a task that names opus gets the deep tier), otherwise the
// deterministic signal score that already decides haiku/sonnet/opus for the
// VPS executor decides standard/deep here. `deep` means the task carries the
// architecture/security/complexity signals the owner reserved Opus for.
// Pure and exported: the tests drive it directly and the trace records it.
function escalationTier(task) {
  task = task || {};
  var choice;
  try {
    choice = modelPolicy.selectModel({
      requested: task.model || null,
      execution_profile: task.execution_profile || null,
      task_category: task.task_category || null,
      priority: task.priority || 'normal',
      instruction: task.instruction || '',
      constraints: task.constraints || [],
      required_tests: task.required_tests || []
    });
  } catch (e) {
    return { tier: 'standard', reason: 'policy_error:' + String(e && e.message).slice(0, 80) };
  }
  if (!choice || !choice.ok) {
    // A named model this host does not know is not a reason to escalate
    // further: the standard tier, and the reason recorded.
    return { tier: 'standard', reason: 'unresolved:' + String(choice && choice.error).slice(0, 80) };
  }
  var deep = choice.key === 'opus';
  return { tier: deep ? 'deep' : 'standard', reason: choice.reason, key: choice.key, mode: choice.mode, score: choice.score };
}

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
  var ctx = { workspace: workspace, grant: grant, scope: work.declaredScope(task.constraints || []), projectScope: Array.isArray(task.project_write_scope) ? task.project_write_scope : [] };
  var messages = [
    { role: 'system', content: systemPrompt(grant, schemas, roles.getRole(task.role), task.expected_delivery) },
    { role: 'user', content: String(prompt) }
  ];
  var toolCallCount = 0;
  // An identical call that returns an identical result tells the model
  // nothing new, and a small model will repeat one until its turns are gone
  // — measured live (coder run t-20260922210225: `node greet.test.js` run
  // six times in a row, green every time, then the turn cap). Saying so is
  // not a new permission and changes no result; it is the same thing the
  // runner already does when a budget is spent.
  var lastPayloadByCall = Object.create(null);
  // Context accounting (see CONTEXT_WINDOW_TOKENS). `anchor` is the last
  // prompt size the runtime itself reported and the conversation length it
  // corresponded to; the estimate for the next request is that measurement
  // plus the estimated cost of what was appended since.
  var anchor = { tokens: 0, chars: 0 };
  var toolSchemaChars = JSON.stringify(schemas).length;
  function conversationChars() {
    var n = 0;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      n += (typeof m.content === 'string' ? m.content.length : 0) + 16;
      if (m.tool_calls) n += JSON.stringify(m.tool_calls).length;
    }
    return n;
  }
  function estimatePromptTokens() {
    var chars = conversationChars();
    var delta = chars - anchor.chars;
    var base = anchor.tokens || Math.ceil(toolSchemaChars / CHARS_PER_TOKEN);
    return Math.max(0, base + Math.ceil(delta / CHARS_PER_TOKEN));
  }
  // An elidable EXCHANGE is an assistant message carrying tool_calls plus the
  // tool messages that answer it. Both halves go together, and both halves
  // matter: a tool message is only valid while its assistant message still
  // declares the same tool_call_id, and the ARGUMENTS of a write_file call
  // carry a whole file — measured live (gh tester run t-20260922205205), an
  // attempt whose tool results were all already elided still sat at ~6,700
  // tokens because twelve assistant turns had never been touched. Eliding
  // results alone is not compaction.
  function isElidedExchange(m) {
    return !!(m.tool_calls && m.tool_calls.length &&
      m.tool_calls.every(function (c) { return c.function && c.function.arguments === ELIDED_ARGS; }));
  }
  function elideExchangeAt(i) {
    var m = messages[i];
    messages[i] = {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.tool_calls.map(function (c) {
        return { id: c.id, type: c.type || 'function',
          function: { name: (c.function && c.function.name) || 'unknown', arguments: ELIDED_ARGS } };
      })
    };
    for (var j = i + 1; j < messages.length && messages[j].role === 'tool'; j++) {
      messages[j] = { role: 'tool', tool_call_id: messages[j].tool_call_id, content: ELIDED_TOOL_STUB };
    }
  }
  // Drops the OLDEST exchange first. The system prompt, the task and the MOST
  // RECENT exchange are never touched — eliding what the model just asked for
  // would make it ask again forever, and the per-call payload cap already
  // bounds that one result. Returns false when nothing else can go and the
  // request still does not fit; the caller then stops with a named code
  // instead of sending a request the runtime is known to refuse.
  function fitContext() {
    var elided = 0;
    while (estimatePromptTokens() > PROMPT_BUDGET_TOKENS) {
      var newest = -1;
      for (var k = messages.length - 1; k >= 2; k--) {
        if (messages[k].role === 'assistant' && messages[k].tool_calls) { newest = k; break; }
      }
      var victim = -1;
      for (var i = 2; i < messages.length; i++) {
        if (i === newest) break;
        if (messages[i].role === 'assistant' && messages[i].tool_calls && !isElidedExchange(messages[i])) { victim = i; break; }
      }
      if (victim === -1) break;
      elideExchangeAt(victim);
      elided++;
    }
    // Eliding replaces an exchange with a stub, and a stub is not free: with
    // every exchange already elided the floor is still system + task + N
    // stubs + the newest exchange, and N grows with the run. Measured live
    // (tester t-20260922230756): eleven elided exchanges left ~6,371 tokens
    // against a 6,272 budget and the attempt died 99 tokens over. So once
    // there is nothing left to elide, the oldest elided exchanges are
    // DROPPED outright — assistant turn and its results together, which
    // keeps the sequence valid — until the request fits or only the system
    // prompt, the task and the newest exchange remain. That floor is fixed;
    // the previous one was not.
    var dropped = 0;
    while (estimatePromptTokens() > PROMPT_BUDGET_TOKENS) {
      var newestDrop = -1;
      for (var d = messages.length - 1; d >= 2; d--) {
        if (messages[d].role === 'assistant' && messages[d].tool_calls) { newestDrop = d; break; }
      }
      var target = -1;
      for (var j = 2; j < messages.length; j++) {
        if (j === newestDrop) break;
        if (messages[j].role === 'assistant' && messages[j].tool_calls && isElidedExchange(messages[j])) { target = j; break; }
      }
      if (target === -1) break;
      var end = target + 1;
      while (end < messages.length && messages[end].role === 'tool') end++;
      messages.splice(target, end - target);
      dropped++;
    }
    if (elided || dropped) {
      trace.push({ tool: 'context_compaction', refused: false, target: null,
        detail: 'elided ' + elided + ' exchange(s)' + (dropped ? ', dropped ' + dropped + ' already-elided' : '') +
          '; estimate now ~' + estimatePromptTokens() + ' of ' + PROMPT_BUDGET_TOKENS + ' prompt tokens' });
    }
    return estimatePromptTokens() <= PROMPT_BUDGET_TOKENS;
  }
  var roundToolCalls = 0;
  var trace = [];

  // A repair round starts from a COMPACT conversation: system, the task, the
  // rejected answer (bounded) and the brief. The previous round's tool
  // chatter is dropped on purpose — the brief carries the measured state
  // and the worker re-reads what it needs — because with a local context
  // window the turns otherwise accumulate past it: live (gh-issue-375) a
  // second execution reached 6,400 of 8,192 tokens and the runtime dropped
  // the request. Bounded context per execution is what makes three
  // executions possible at all.
  // V3.1 constrained report turn — per-execution state (see settle below).
  var reportTurnsThisRound = 0;
  var reportTurnPending = null;   // the final message text awaiting its report
  function compactForRepair(lastText, brief) {
    roundToolCalls = 0;
    reportTurnsThisRound = 0;
    reportTurnPending = null;
    messages = [messages[0], messages[1]];
    if (lastText && String(lastText).trim()) messages.push({ role: 'assistant', content: String(lastText).slice(0, 2000) });
    messages.push({ role: 'user', content: brief });
  }

  // ESCALATION, diagnosis only. On the LAST repair round — the local model
  // has by then failed the task once and failed one measured repair — a
  // stronger model may be asked for a diagnosis and precise repair
  // instructions, which are appended to the brief. It is given the task,
  // the measured failures and the constrained files' current content; it
  // is given NO tool, writes nothing and runs nothing — the local model
  // still does the work and the validator still decides. Off unless the
  // host names a diagnoser (HADDAD_AGENT_DIAGNOSER, a command line; or
  // opts.diagnose in tests). Bounded, and fail-open: no diagnosis means the
  // mechanical brief goes alone, exactly as before.
  // Which tier this task's FIRST diagnosis goes to (V3.1). Decided once from
  // the task's own signals, recorded in the trace with the reason, never
  // raised by anything the model says.
  var tierChoice = escalationTier(task);
  var deepRoundsUsed = 0;
  var lastDiagnosisTier = null;
  function diagnoserFor(tier) {
    if (tier === 'deep') return opts.diagnoseDeep || diagnoserFromEnv('HADDAD_AGENT_DIAGNOSER_DEEP');
    return opts.diagnose || diagnoserFromEnv('HADDAD_AGENT_DIAGNOSER');
  }
  function diagnosisFor(verdict, brief, tier) {
    var diagnose = diagnoserFor(tier);
    var used = tier;
    if (!diagnose && tier === 'deep') {
      // No deep diagnoser on this host: the standard one, and the record
      // says the deep tier was asked for and not available — fail-open
      // toward the behaviour that existed before, never toward silence.
      diagnose = diagnoserFor('standard');
      used = 'standard';
    }
    if (!diagnose) return null;
    trace.push({ tool: 'escalation', refused: false, target: null,
      detail: 'tier requested ' + tier + ', used ' + used + ' (' + String(tierChoice.reason || '').slice(0, 120) + ')' });
    lastDiagnosisTier = used;
    var files = work.declaredScope(task.constraints || []).slice(0, 4).map(function (rel) {
      var content = '';
      try { content = fs.readFileSync(path.join(workspace, rel), 'utf8').slice(0, 8000); } catch (e) { content = '(unreadable)'; }
      return '--- ' + rel + ' ---\n' + content;
    }).join('\n');
    var ask = [
      'You are the DIAGNOSER for a supervised coding loop. A small local model (Qwen 7B) is fixing a file and has failed twice; independent validation measured the failures below.',
      'Give a short diagnosis (why the current file fails those checks) and PRECISE repair instructions the small model can follow with write_file: the exact final content of the file, complete, inside one ```javascript block, plus at most five lines of explanation. Do not run anything; do not ask questions.',
      '', '## Task', String(prompt).slice(0, 3000),
      '', '## Measured failures', brief.slice(0, 4000),
      '', '## Current content of the constrained files', files || '(none declared)'
    ].join('\n');
    var out = null;
    try { out = diagnose(ask); } catch (e) { out = null; }
    if (!out || !String(out).trim()) return null;
    return String(out).slice(0, 6000);
  }
  function diagnoserFromEnv(varName) {
    var cmdline = process.env[varName || 'HADDAD_AGENT_DIAGNOSER'];
    if (!cmdline) return null;
    var argv = cmdline.split(/\s+/).filter(Boolean);
    return function (ask) {
      // Its cwd is an empty scratch directory, so a file-reading tool the
      // diagnoser might have finds nothing; the ask carries what it needs.
      var scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-diag-'));
      try {
        var r = cp.spawnSync(argv[0], argv.slice(1), { input: ask, encoding: 'utf8', timeout: 180000, cwd: scratch, maxBuffer: 1024 * 1024 });
        trace.push({ tool: 'diagnose', refused: r.status !== 0, detail: r.status === 0 ? null : 'diagnoser exit ' + r.status + ': ' + String(r.stderr || '').slice(0, 120), target: argv[0] });
        return r.status === 0 ? r.stdout : null;
      } finally {
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { /* best effort */ }
      }
    };
  }
  function withDiagnosis(verdict, brief) {
    if (repairRound < MAX_REPAIR_ROUNDS) return brief;   // not the last round: the local model gets another measured try first
    // The last standard round takes the task's own tier; a deep round (past
    // MAX_REPAIR_ROUNDS) is, by construction, the deep tier.
    var tier = repairRound > MAX_REPAIR_ROUNDS ? 'deep' : tierChoice.tier;
    var d = diagnosisFor(verdict, brief, tier);
    if (!d) return brief;
    return brief + '\n\n### Diagnosis (escalated' + (tier === 'deep' ? ', deep tier' : '') + ' — follow it exactly, as tool calls)\n' + d;
  }
  // V3.1: may the loop take one more round with the DEEP diagnoser? Only
  // when the round that just failed carried a STANDARD diagnosis, a deep
  // diagnoser is actually configured, and none has been spent yet.
  function deepRoundAvailable() {
    return repairRound >= MAX_REPAIR_ROUNDS && deepRoundsUsed < MAX_DEEP_ROUNDS &&
      lastDiagnosisTier === 'standard' && !!diagnoserFor('deep');
  }
  // Taken BEFORE the model is called even once, so "what changed" is
  // measured against the state the task actually started from. When the
  // executor carries the ATTEMPT's baseline (V3.2) that is the start state —
  // a retried execution must not treat its predecessor's writes as given.
  var carried = opts.baseline && opts.baseline.files && typeof opts.baseline.files === 'object' &&
    (!opts.baseline.working_directory || opts.baseline.working_directory === workspace);
  var before = carried ? { files: opts.baseline.files, truncated: !!opts.baseline.truncated, at: opts.baseline.at || null } : work.snapshot(workspace);
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

  // When the budget is spent, one outcome is not a failure: every declared
  // check passes BY THE VALIDATOR'S OWN RUN, the work is in scope and the
  // check files are intact, and the only rejections are about the worker's
  // report (missing or unreadable). The success is then measured, not
  // claimed — the opposite of a fake pass — and stopping it "for a person"
  // would report verified work as unfinished (gh-issue-374, gh-issue-378:
  // the fix on disk, both checks passing, the model's last message
  // degenerate). The report is synthesized from the evidence and says so;
  // the review gate still applies to it like to any completed task.
  function verifiedWithoutReport(verdict) {
    if (!verdict || verdict.pass) return false;
    var ev = verdict.evidence || {};
    if (!ev.mechanically_verified) return false;
    var ran = ev.checks_run || [];
    if (!ran.length || !ran.every(function (c) { return c.passed; })) return false;
    var ch = ev.changed || {};
    if (!((ch.created || []).length + (ch.modified || []).length)) return false;
    return (verdict.rejections || []).every(function (r) { return /^(report|schema):/.test(String(r)); });
  }
  function finishVerified(text, verdict) {
    var ev = verdict.evidence;
    var report = {
      mythos_report: true,
      status: 'completed',
      summary: 'Every declared check passes by independent validation; the worker emitted no readable report, so this one is synthesized from the measured evidence.',
      files_changed: ev.changed.created.concat(ev.changed.modified),
      tests: ev.checks_run.map(function (c) { return fenceSafe(c.check + ': pass'); }),
      residual_risks: ['report synthesized by the validator — the worker\'s own final message was not a report'],
      next_stage: 'review'
    };
    var stdoutText = text + '\n\n## Tool trace (' + trace.length + ' calls, ' + (repairRound + 1) + ' execution(s))\n' +
      trace.map(function (e, i) { return (i + 1) + '. ' + e.tool + (e.target ? ' ' + fenceSafe(e.target) : '') + (e.refused ? ' → REFUSED' : ''); }).join('\n') +
      '\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n';
    return finish({
      exit_code: 0, signal: null, timed_out: false, stdout: stdoutText, stderr: '',
      parsed: { is_error: false, result: stdoutText },
      validation: { passed: true, attempts: repairRound + 1, evidence: ev, report_synthesized: true },
      session_id: null, started_pid: null
    });
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
      projectScope: task.project_write_scope || [],
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
      projectScope: task.project_write_scope || [],
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
      if (verifiedWithoutReport(verdict)) return finishVerified(text, verdict);
      if (!deepRoundAvailable()) {
        // The budget is spent. This is a stop for a person, not a crash and
        // not another try.
        return stopForHuman(text, verdict,
          'validation still failing after ' + (repairRound + 1) + ' attempt(s); the repair budget is spent');
      }
      deepRoundsUsed++;
    }

    var callsThisRound = trace.length - traceMarkAtRoundStart;
    repairRound++;
    traceMarkAtRoundStart = trace.length;
    compactForRepair(text, withDiagnosis(verdict, work.renderRepairNotes(verdict, repairRound, task.constraints || [], {
      tool_calls: callsThisRound,
      // The files the task constrained the worker to are the ones it must fix.
      files_named: work.declaredScope(task.constraints || [])
    })));
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
        if (verifiedWithoutReport(capVerdict)) return Promise.resolve(finishVerified('', capVerdict));
        if (!deepRoundAvailable()) {
          return Promise.resolve(stopForHuman('', capVerdict,
            'stopped after ' + MAX_ITERATIONS + ' model turns without a final answer; the repair budget is spent'));
        }
        deepRoundsUsed++;
      }
      var callsThisRound = trace.length - traceMarkAtRoundStart;
      repairRound++;
      traceMarkAtRoundStart = trace.length;
      compactForRepair('', withDiagnosis(capVerdict, work.renderRepairNotes(capVerdict, repairRound, task.constraints || [], {
        tool_calls: callsThisRound,
        out_of_turns: MAX_ITERATIONS,
        files_named: work.declaredScope(task.constraints || [])
      })));
      return step(0);
    }

    if (!fitContext()) {
      // Say WHICH of the two it is: a task whose own prompt cannot fit is an
      // authoring problem, a conversation that outgrew what compaction may
      // drop is a run that grew. They need different answers from a reader.
      var why = messages.length > 2
        ? 'the conversation still needs ~' + estimatePromptTokens() + ' prompt tokens after compacting every earlier exchange'
        : 'the task prompt alone needs ~' + estimatePromptTokens() + ' prompt tokens';
      return Promise.resolve(finish({
        exit_code: 1, signal: null, timed_out: false, stdout: '',
        stderr: 'HADDAD_AGENT_CONTEXT_EXHAUSTED: ' + why + ', over the ' + PROMPT_BUDGET_TOKENS +
          ' available of this runtime\'s ' + CONTEXT_WINDOW_TOKENS + '-token window (the answer keeps ' + MAX_TOKENS_PER_TURN + ')',
        parsed: { is_error: true, subtype: 'HADDAD_AGENT_CONTEXT_EXHAUSTED', result: why },
        session_id: null, started_pid: null
      }));
    }
    // THE GPU LEASE (V2.3 scheduler half). Held around THIS TURN only, not
    // around the task. Everything after the turn — validation, the declared
    // checks in their sandbox, the workspace snapshot, the delivery commit —
    // is CPU and git work that has no business holding the card, and holding
    // it there is what made "one task at a time" and "one inference at a
    // time" the same sentence.
    //
    // Released in BOTH settlements below, and carried by a TTL so a provider
    // that dies mid-turn cannot wedge the GPU shut for the life of the
    // daemon. A lease that leaks is worse than no lease.
    var leaseId = (task && task.task_id) || ('haddad-' + process.pid + '-' + started);
    // WAIT for the card rather than assume it. A plain acquire() only
    // recorded who was on the GPU and stopped nobody — measured live, two
    // admitted tasks both entered a turn and the observed maximum was 2
    // concurrent leases. Admission gates a task once, at its start; nothing
    // then coordinates the turns it takes minutes later, so the serialising
    // has to happen here, at the turn.
    //
    // Bounded by this task's own deadline, so waiting can never outlast the
    // work it is waiting for.
    return gpuSlots.acquireWhenFree(leaseId, { deadline: deadline, capacity: opts.gpuCapacity })
      .then(function (lease) {
        if (!lease.acquired) {
          return finish({
            exit_code: 1, signal: null, timed_out: false, stdout: '',
            stderr: 'HADDAD_AGENT_GPU_BUSY: the local runtime was occupied by another task for this task\'s whole deadline (' + lease.reason + ')',
            parsed: { is_error: true, subtype: 'HADDAD_AGENT_GPU_BUSY', result: 'the GPU was busy for this task\'s whole deadline' },
            session_id: null, started_pid: null
          });
        }
        if (lease.waited_ms > 0) {
          trace.push({ tool: 'gpu_wait', refused: false, target: null,
            detail: 'waited ' + lease.waited_ms + ' ms for the runtime to be free' });
        }
        return turn();
      });

    function turn() {
    // A constrained REPORT turn offers no tool and pins the answer to the
    // report schema; every other turn is exactly what it was.
    var constrained = reportTurnPending !== null;
    var turnOpts = { timeoutMs: Math.max(1000, Math.min(deadline - Date.now(), 300000)), transport: opts.transport, maxTokens: MAX_TOKENS_PER_TURN };
    if (constrained) turnOpts.responseFormat = REPORT_RESPONSE_FORMAT;
    else turnOpts.tools = schemas;
    return adapter.chatCompletion(
      { baseUrl: baseUrl, apiKey: apiKey, model: model, providerId: PROVIDER_ID },
      messages,
      turnOpts
    ).then(function (res) {
      gpuSlots.release(leaseId);
      if (constrained) {
        // Whatever came back, the pending text is settled now: with the
        // constrained answer appended as the fenced report when there is
        // one, alone when the runtime gave nothing. The parser decides.
        var pendingText = reportTurnPending;
        reportTurnPending = null;
        var reportText = res && res.message && typeof res.message.content === 'string' ? res.message.content.trim() : '';
        trace.push({ tool: 'report_turn', refused: !reportText, target: null,
          detail: reportText ? 'constrained json_schema report turn answered (' + reportText.length + ' chars)' : 'constrained report turn returned no content' });
        // The two messages the report turn added are dropped again: a
        // repair round compacts anyway, and a settled execution is over.
        messages.splice(messages.length - 2, 2);
        return settleOrRepair(reportText ? pendingText + '\n\n```json\n' + reportText + '\n```\n' : pendingText);
      }
      if (res && res.usage && Number(res.usage.prompt_tokens) > 0) {
        anchor = { tokens: Number(res.usage.prompt_tokens), chars: conversationChars() };
      }
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
        // V3.1: a final message without a readable report costs ONE
        // constrained turn before it costs a repair round. The model gets
        // its own message back and is asked for the report only, with the
        // runtime holding it to the schema. Bounded per execution; off when
        // the caller says so (opts.structuredReport === false) or when the
        // turn budget is already spent.
        if (!reporting.extractReport(text).report && opts.structuredReport !== false &&
            reportTurnsThisRound < MAX_REPORT_TURNS_PER_EXECUTION && iteration + 1 < MAX_ITERATIONS) {
          reportTurnsThisRound++;
          reportTurnPending = text;
          messages.push({ role: 'assistant', content: text });
          messages.push({ role: 'user', content: 'Your final message carried no structured report. Emit the report now as ONE JSON object and nothing else: {"mythos_report": true, "status": "completed"|"failed"|"blocked", "summary": "...", "files_changed": [...], "tests": [...], "commit": null, "residual_risks": [...]}. Describe only what you actually did.' });
          return step(iteration + 1);
        }
        return settleOrRepair(text);
      }

      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
      for (var i = 0; i < calls.length; i++) {
        var c = calls[i];
        toolCallCount++;
        roundToolCalls++;
        var name = c.function && c.function.name;
        var result;
        // The budget is PER EXECUTION, like the turn budget: a repair round
        // that inherits a spent budget can only be refused (gh-issue-376,
        // live: round three made four calls, all refused). Bounded either
        // way — three executions of at most MAX_TOOL_CALLS each.
        if (roundToolCalls > MAX_TOOL_CALLS) {
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
        if (payload.length > MAX_TOOL_PAYLOAD_CHARS && typeof result.content === 'string') {
          // A file that fits the byte ceiling but not the context budget is
          // handed over TRUNCATED and says so, rather than refused outright
          // (the model can still work with the head of a long file) or sent
          // whole (which would starve the rest of the conversation).
          // Measured on the JSON the model receives (escapes count), not on
          // the raw text, so the cap holds for a file full of newlines too.
          var keep = Math.max(0, MAX_TOOL_PAYLOAD_CHARS - 160);
          var total = Buffer.byteLength(result.content, 'utf8');
          do {
            payload = JSON.stringify({ content: result.content.slice(0, keep), truncated: true,
              total_bytes: total, note: 'truncated to fit the context window' });
            keep = Math.floor(keep * 0.9);
          } while (payload.length > MAX_TOOL_PAYLOAD_CHARS && keep > 0);
        } else if (payload.length > MAX_TOOL_OUTPUT_BYTES) {
          payload = JSON.stringify({ error: 'REFUSED: result exceeded ' + MAX_TOOL_OUTPUT_BYTES + ' bytes' });
        } else if (payload.length > MAX_TOOL_PAYLOAD_CHARS) {
          payload = JSON.stringify({ error: 'REFUSED: result exceeds the per-call context budget of ' + MAX_TOOL_PAYLOAD_CHARS + ' chars' });
        }
        var fingerprint = String(name) + ':' + ((c.function && c.function.arguments) || '');
        if (lastPayloadByCall[fingerprint] === payload) {
          payload = payload.slice(0, -1) + ',"note":"identical to your previous call, and nothing has changed since — do not repeat it; act on this result or write your final report"}';
        } else {
          lastPayloadByCall[fingerprint] = payload;
        }
        messages.push({ role: 'tool', tool_call_id: c.id, content: payload });
      }
      return step(iteration + 1);
    });
    }
  }

  return step(0).catch(function (e) {
    // The turn threw. Release rather than wait for the TTL: a failure is not
    // a reason to hold the card.
    gpuSlots.release((task && task.task_id) || null);
    return finish(fail('HADDAD_AGENT_ERROR', String(e && e.message).slice(0, 200)));
  });
}

module.exports = {
  PROVIDER_ID: PROVIDER_ID,
  version: version,
  available: available,
  probe: probe,
  healthUrl: healthUrl,
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
  MAX_DEEP_ROUNDS: MAX_DEEP_ROUNDS,
  MAX_REPORT_TURNS_PER_EXECUTION: MAX_REPORT_TURNS_PER_EXECUTION,
  REPORT_RESPONSE_FORMAT: REPORT_RESPONSE_FORMAT,
  escalationTier: escalationTier,
  MAX_TOKENS_PER_TURN: MAX_TOKENS_PER_TURN,
  MAX_TOOL_CALLS: MAX_TOOL_CALLS,
  MAX_TOOL_OUTPUT_BYTES: MAX_TOOL_OUTPUT_BYTES,
  CONTEXT_WINDOW_TOKENS: CONTEXT_WINDOW_TOKENS,
  PROMPT_BUDGET_TOKENS: PROMPT_BUDGET_TOKENS,
  MAX_TOOL_PAYLOAD_CHARS: MAX_TOOL_PAYLOAD_CHARS,
  ELIDED_TOOL_STUB: ELIDED_TOOL_STUB,
  ELIDED_ARGS: ELIDED_ARGS
};
