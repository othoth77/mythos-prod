'use strict';
// =====================================================
// Mythos AI Executor — execution policy layer
// projects/mythos-ai-executor/lib/policy.js
//
// Mission §14: commands are classed READ / PROJECT_WRITE / GIT / SERVICE /
// DEPLOY / ROOT. The executor enforces this not by parsing shell commands
// (unwinnable) but at the CAPABILITY level: each execution profile maps to
// an exact set of Claude Code tool permissions, and the profile is chosen
// by the EXECUTOR from task metadata — never by the task instruction text,
// which is data (mission §12).
//
// Two permanent rules, enforced here and asserted by tests:
//   * ROOT is never grantable: every profile disallows Bash(sudo:*).
//   * Only the claude-code provider (an execution runtime) ever receives
//     repository execution authority. Advisory providers get no tools at
//     all — that separation lives in providers/, this file only shapes
//     claude-code invocations.
// =====================================================

// Profile catalogue. `commandClasses` documents the §14 mapping; the
// enforced surface is allowedTools / disallowedTools / permissionMode /
// extraArgs, which become real CLI flags.
var PROFILES = {
  // READ: inspection only. No file writes, no git mutation.
  'repo-read': {
    commandClasses: ['READ'],
    permissionMode: null,
    allowedTools: [
      'Read', 'Grep', 'Glob',
      'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)',
      'Bash(git show:*)', 'Bash(git rev-parse:*)', 'Bash(git branch:*)',
      'Bash(git remote:*)', 'Bash(git fetch:*)',
      'Bash(ls:*)', 'Bash(rg:*)', 'Bash(wc:*)', 'Bash(node --version)',
      'Bash(curl -s http://127.0.0.1:*)'
    ],
    disallowedTools: ['Bash(sudo:*)', 'Write', 'Edit', 'NotebookEdit'],
    extraArgs: [],
    enabled: true
  },

  // PROJECT_WRITE + GIT: edit project files, run tests, commit and push.
  // Claude still confirms anything outside the allowlist against the
  // permission system, which denies in headless mode — so unexpected
  // capabilities fail closed instead of prompting.
  'repo-write': {
    commandClasses: ['READ', 'PROJECT_WRITE', 'GIT'],
    permissionMode: 'acceptEdits',
    allowedTools: [
      'Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit',
      'Bash(git:*)', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(npx:*)',
      'Bash(ls:*)', 'Bash(rg:*)', 'Bash(mkdir:*)', 'Bash(wc:*)',
      'Bash(diff:*)', 'Bash(cat:*)', 'Bash(curl -s http://127.0.0.1:*)'
    ],
    disallowedTools: ['Bash(sudo:*)'],
    extraArgs: [],
    enabled: true
  },

  // TEST EXECUTION: read the repository and RUN its test suites, nothing
  // more. A dedicated profile exists because 'repo-read' cannot execute
  // node at all — a test task under it can only report "NOT RUN", which
  // the acceptance gate then rightly refuses — while 'repo-write' would
  // hand a test runner needless write authority. Least privilege for the
  // one thing a testing task must do.
  'repo-test': {
    commandClasses: ['READ'],
    permissionMode: null,
    allowedTools: [
      'Read', 'Grep', 'Glob',
      'Bash(node:*)', 'Bash(npm test:*)', 'Bash(npm run test:*)',
      'Bash(git status:*)', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git rev-parse:*)',
      'Bash(ls:*)', 'Bash(rg:*)', 'Bash(wc:*)', 'Bash(cat:*)'
    ],
    disallowedTools: ['Bash(sudo:*)', 'Write', 'Edit', 'NotebookEdit',
      'Bash(git commit:*)', 'Bash(git push:*)'],
    extraArgs: [],
    enabled: true
  },

  // Full autonomous execution inside the worktree: the permission system is
  // bypassed, so the ONLY remaining guard is the disallow list — sudo stays
  // blocked, which keeps SERVICE/DEPLOY/ROOT classes out of reach. This is
  // the profile the mission's autonomous loop runs under, as a non-root user.
  'autonomous': {
    commandClasses: ['READ', 'PROJECT_WRITE', 'GIT'],
    permissionMode: 'bypassPermissions',
    allowedTools: [],
    disallowedTools: ['Bash(sudo:*)'],
    extraArgs: [],
    enabled: true
  },

  // SERVICE/DEPLOY: deliberately DISABLED. Enabling deployment authority is
  // an owner decision recorded in config, never a default. When enabled it
  // still only whitelists tightly scoped service commands, never open sudo.
  'deploy': {
    commandClasses: ['READ', 'PROJECT_WRITE', 'GIT', 'SERVICE', 'DEPLOY'],
    permissionMode: 'acceptEdits',
    allowedTools: [
      'Read', 'Grep', 'Glob', 'Write', 'Edit',
      'Bash(git:*)', 'Bash(node:*)', 'Bash(npm:*)',
      'Bash(sudo systemctl reload nginx)', 'Bash(sudo nginx -t)',
      'Bash(systemctl --user:*)'
    ],
    disallowedTools: ['Bash(sudo rm:*)', 'Bash(sudo su:*)', 'Bash(sudo -i:*)'],
    extraArgs: [],
    enabled: false
  }
};

var DEFAULT_PROFILE = 'repo-write';

function profileNames() { return Object.keys(PROFILES); }

function getProfile(name) {
  var p = PROFILES[name || DEFAULT_PROFILE];
  if (!p) throw new Error('UNKNOWN_PROFILE: ' + String(name));
  if (!p.enabled) throw new Error('PROFILE_DISABLED: ' + String(name) + ' requires an explicit owner decision to enable');
  return p;
}

// Renders a profile into claude CLI arguments. Pure, so tests can assert
// the exact argv without launching anything.
function claudeArgsForProfile(name) {
  var p = getProfile(name);
  var args = [];
  if (p.permissionMode) args.push('--permission-mode', p.permissionMode);
  if (p.allowedTools.length) args.push('--allowedTools', p.allowedTools.join(','));
  if (p.disallowedTools.length) args.push('--disallowedTools', p.disallowedTools.join(','));
  return args.concat(p.extraArgs);
}

// A SECOND renderer of the same profile, for a provider that executes tools
// in-process instead of handing flags to a CLI. claudeArgsForProfile above
// turns a profile into `--allowedTools`; this turns the identical fields into
// the tool grant an in-process runner may act on. One source of truth, two
// renderings — a separate permission dictionary is exactly what must not
// exist, because the two would drift and the drift would be silent.
//
// A Bash() entry is parsed the way the CLI reads it: `Bash(npm test:*)` is
// the program `npm` with the required argv prefix ['test'] and anything
// after; `Bash(node --version)` with no `:*` is that exact argv and nothing
// else. A disallowed Bash() entry subtracts, so `repo-test`'s
// `Bash(git commit:*)` denial survives this translation.
//
// This function GRANTS, it does not execute. A caller is expected to
// intersect the result with its own, narrower code ceiling: the grant says
// what the policy permits, never what the runner is willing to do.
function parseBashRule(entry) {
  var m = /^Bash\(([^)]+)\)$/.exec(entry);
  if (!m) return null;
  var body = m[1].trim();
  var prefixMatch = /:\*$/.test(body);
  var words = body.replace(/:\*$/, '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return { program: words[0], args: words.slice(1), prefix: prefixMatch };
}

function toolsForProfile(name) {
  var p = getProfile(name);
  var allowed = {}, denied = {};
  p.allowedTools.forEach(function (t) { allowed[t] = true; });
  p.disallowedTools.forEach(function (t) { denied[t] = true; });
  function granted(tool) { return allowed[tool] === true && denied[tool] !== true; }

  var deniedCommands = [];
  p.disallowedTools.forEach(function (t) {
    var r = parseBashRule(t);
    if (r) deniedCommands.push(r);
  });
  function isDenied(rule) {
    return deniedCommands.some(function (d) {
      if (d.program !== rule.program) return false;
      return d.args.every(function (a, i) { return rule.args[i] === a; });
    });
  }

  var commands = [];
  p.allowedTools.forEach(function (t) {
    var r = parseBashRule(t);
    if (r && !isDenied(r)) commands.push(r);
  });

  return {
    profile: name || DEFAULT_PROFILE,
    read_file: granted('Read'),
    list_files: granted('Glob') || granted('Grep'),
    // Reported for completeness so a caller can SEE the policy's answer.
    // No write tool exists in the V1a runner regardless of this flag — the
    // runner's own ceiling is lower than the policy's, deliberately.
    write_file: granted('Write') || granted('Edit'),
    commands: commands
  };
}

module.exports = {
  PROFILES: PROFILES,
  DEFAULT_PROFILE: DEFAULT_PROFILE,
  profileNames: profileNames,
  getProfile: getProfile,
  claudeArgsForProfile: claudeArgsForProfile,
  toolsForProfile: toolsForProfile,
  parseBashRule: parseBashRule
};
