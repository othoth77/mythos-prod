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

module.exports = {
  PROFILES: PROFILES,
  DEFAULT_PROFILE: DEFAULT_PROFILE,
  profileNames: profileNames,
  getProfile: getProfile,
  claudeArgsForProfile: claudeArgsForProfile
};
