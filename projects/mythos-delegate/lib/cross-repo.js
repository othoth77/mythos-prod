'use strict';
// =====================================================
// MYTHOS V2 — cross-repository delegation lane
// projects/mythos-delegate/lib/cross-repo.js
//
// gh-issue-474. The bridge could only ever execute inside a worktree of
// its OWN checkout (`othoth77/mythos-prod`): `ensureTaskWorktree` resolves
// `git worktree add` against `cfg.repo`, and the orchestrator schema pins
// `repository` to a single-value enum. A task whose work belongs in a
// DIFFERENT repository therefore had nowhere to run — the blocker
// gh-issue-473 reported for SPY V2.
//
// This module is that missing lane, and nothing else. It answers four
// questions and refuses when it cannot:
//
//   1. IS THIS TARGET AUTHORIZED?  config/targets.json is a closed
//      allowlist. There is no wildcard, no pattern, no environment
//      override, and the control repository is refused as a target by
//      construction. An unknown target is TARGET_REPOSITORY_UNAUTHORIZED.
//   2. WHERE DOES IT RUN?  The workspace path is a pure function of
//      (workspaces_root, repository, task_id) — the same inputs always
//      yield the same directory, and the directory is proven to be inside
//      the workspaces root and OUTSIDE this repository. Control-repo files
//      and target-repo files can never share a tree.
//   3. IS THAT DIRECTORY REALLY THAT REPOSITORY?  A path is a claim. The
//      lane reads the checkout's own `origin` and its toplevel and refuses
//      unless both agree with the authorized target — so a workspace that
//      is actually mythos-prod (or anything else) is TARGET_IDENTITY_
//      MISMATCH rather than a run that writes SPY code into the wrong repo.
//   4. MAY THIS ATTEMPT DO WHAT IT ASKS?  requested_action → execution
//      profile comes from bridge/action-resolution.js, the one existing
//      source of truth, so `investigate/repo-read` can never carry a
//      commit delivery and `implement` can never be run as a read-only
//      attempt. That mismatch is exactly what produced gh-issue-473.
//
// FAIL CLOSED, in the discipline of lib/delegate.js beside it: an unknown
// config field, a credential-shaped key at any depth, a remote carrying
// userinfo, a workspaces root inside this repository, or a registry that
// does not parse disables the whole lane rather than trusting the parts
// that happened to load.
//
// WHAT THIS MODULE MUST NEVER DO:
//   - widen authority: a target grants a WORKSPACE, never a profile, a
//     model, a tool or a permission;
//   - push, merge, open a PR, or write anything into the control
//     repository;
//   - carry a credential. The host's own Git identity authenticates, and
//     while a target's `push_enabled` is false the lane actively installs
//     a no-push guard on the workspace remote.
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var DEFAULT_TARGETS_PATH = path.join(__dirname, '..', 'config', 'targets.json');
var REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// The action → execution-profile map has exactly one home. Requiring it
// here rather than restating it is the whole point: a second copy is how
// `investigate/repo-read` and "implement this" drifted apart in the first
// place. action-resolution.js is a pure leaf (it requires only crypto),
// so there is no cycle.
var engine = require(path.join(REPO_ROOT, 'projects', 'mythos-ai-executor', 'bridge', 'action-resolution.js'));

// Blocker codes this lane raises. All of them are decisions, never
// transient conditions: retrying cannot authorize a repository, cannot
// change an action's profile, and cannot make a wrong checkout right.
var CODES = {
  TARGET_REGISTRY_UNAVAILABLE: 'TARGET_REGISTRY_UNAVAILABLE',
  TARGET_REPOSITORY_MISSING: 'TARGET_REPOSITORY_MISSING',
  TARGET_REPOSITORY_UNAUTHORIZED: 'TARGET_REPOSITORY_UNAUTHORIZED',
  TARGET_ACTION_NOT_ALLOWED: 'TARGET_ACTION_NOT_ALLOWED',
  TARGET_DELIVERY_NOT_AUTHORIZED: 'TARGET_DELIVERY_NOT_AUTHORIZED',
  TARGET_WORKSPACE_UNAVAILABLE: 'TARGET_WORKSPACE_UNAVAILABLE',
  TARGET_IDENTITY_MISMATCH: 'TARGET_IDENTITY_MISMATCH',
  TARGET_CONTRACT_INVALID: 'TARGET_CONTRACT_INVALID'
};

var ALLOWED_REGISTRY_FIELDS = ['schema', 'workspaces_root', 'control_repository', 'targets', 'description'];
var ALLOWED_TARGET_FIELDS = ['remote', 'default_branch', 'branch_prefix', 'allowed_actions',
  'push_enabled', 'authorized_by', 'authorized_at', 'description'];

// Same tripwire as lib/delegate.js: this is a local wiring allowlist, and
// anything endpoint- or credential-shaped in it is the accident the check
// exists to catch. `remote` is deliberately not "…_url": the value is
// validated separately and must carry no userinfo.
var FORBIDDEN_KEY_SUBSTRINGS = ['token', 'secret', 'password', 'passwd', 'credential',
  'api_key', 'apikey', 'private_key', 'access_key', 'webhook', 'endpoint', 'url', 'host', 'port'];

var REGISTRY_SCHEMA = 'mythos.delegate.targets.v1';
var TASK_SCHEMA = 'mythos.delegate.task.v1';

function rErr(msg) { var e = new Error(msg); e.code = 'MYTHOS_CROSSREPO_CONFIG'; return e; }
function iErr(msg, code) { var e = new Error(msg); e.code = code || 'MYTHOS_CROSSREPO_INPUT'; return e; }

function refuse(code, reason, extra) {
  var out = { ok: false, code: code, reason: reason, retryable: false };
  if (extra) Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) out[k] = extra[k]; });
  return out;
}

function hasForbiddenKey(value) {
  if (value === null || typeof value !== 'object') return null;
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) {
    var lower = String(keys[i]).toLowerCase();
    for (var j = 0; j < FORBIDDEN_KEY_SUBSTRINGS.length; j++) {
      if (lower.indexOf(FORBIDDEN_KEY_SUBSTRINGS[j]) !== -1) return keys[i];
    }
    var nested = hasForbiddenKey(value[keys[i]]);
    if (nested) return nested;
  }
  return null;
}

// --- Repository identity -----------------------------------------------------------
//
// "othoth77/spy" is the identity. Every other spelling — the SSH remote,
// the HTTPS remote, a trailing .git, a trailing slash — is a spelling OF
// that identity and must normalise to it, because the comparison that
// decides whether a checkout is the authorized target has to be an exact
// one. Anything this function cannot parse is not a repository reference.

var SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseRepoRef(value) {
  if (typeof value !== 'string') return null;
  var v = value.trim();
  if (!v) return null;
  // A remote that carries userinfo (https://user:token@host/…) is a
  // credential in a config file, which is refused outright rather than
  // parsed and quietly used.
  if (/^[a-z+]+:\/\/[^/]*@/i.test(v) && !/^ssh:\/\/git@/i.test(v)) return null;
  var m;
  if ((m = /^git@[^:]+:(.+)$/.exec(v))) v = m[1];
  else if ((m = /^ssh:\/\/git@[^/]+\/(.+)$/i.exec(v))) v = m[1];
  else if ((m = /^https?:\/\/[^/]+\/(.+)$/i.exec(v))) v = m[1];
  // Trailing slashes first: `…/spy.git/` must reduce to `…/spy`, and a
  // `.git` suffix that is still hidden behind a slash would survive.
  v = v.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!SLUG_RE.test(v)) return null;
  return v;
}

// GitHub owner/repo names are case-insensitive; the comparison therefore
// is too, while the registry's own spelling stays canonical in reports.
function sameRepo(a, b) {
  var x = parseRepoRef(a), y = parseRepoRef(b);
  return !!x && !!y && x.toLowerCase() === y.toLowerCase();
}

// --- Registry ----------------------------------------------------------------------

function validateRegistryObject(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw rErr('targets registry must be a JSON object');
  }
  var forbidden = hasForbiddenKey(raw);
  if (forbidden) throw rErr('targets registry carries a credential- or endpoint-shaped key: ' + forbidden);
  Object.keys(raw).forEach(function (k) {
    if (ALLOWED_REGISTRY_FIELDS.indexOf(k) === -1) throw rErr('unknown targets registry field: ' + k);
  });
  if (raw.schema !== REGISTRY_SCHEMA) throw rErr('targets registry schema must be ' + REGISTRY_SCHEMA);
  if (typeof raw.workspaces_root !== 'string' || !raw.workspaces_root.trim()) {
    throw rErr('workspaces_root is required');
  }
  var workspacesRoot = path.resolve(raw.workspaces_root);
  if (!path.isAbsolute(raw.workspaces_root)) throw rErr('workspaces_root must be an absolute path');
  // The whole point of the lane: target-repo files never share a tree with
  // control-repo files, so they can never reach a control-repo commit.
  if (workspacesRoot === REPO_ROOT || workspacesRoot.indexOf(REPO_ROOT + path.sep) === 0) {
    throw rErr('workspaces_root must live outside this repository');
  }
  var control = parseRepoRef(raw.control_repository);
  if (!control) throw rErr('control_repository must be a repository reference such as owner/repo');

  if (raw.targets === null || typeof raw.targets !== 'object' || Array.isArray(raw.targets)) {
    throw rErr('targets must be an object keyed by owner/repo');
  }
  var targets = {};
  Object.keys(raw.targets).forEach(function (key) {
    var slug = parseRepoRef(key);
    if (!slug || slug !== key) throw rErr('target key must be a canonical owner/repo slug: ' + key);
    if (sameRepo(slug, control)) {
      throw rErr('the control repository (' + control + ') can never be a delegation target');
    }
    var t = raw.targets[key];
    if (t === null || typeof t !== 'object' || Array.isArray(t)) throw rErr('target ' + key + ' must be an object');
    Object.keys(t).forEach(function (f) {
      if (ALLOWED_TARGET_FIELDS.indexOf(f) === -1) throw rErr('unknown field on target ' + key + ': ' + f);
    });
    var remoteSlug = parseRepoRef(t.remote);
    if (!remoteSlug) throw rErr('target ' + key + ' has no usable remote (or the remote carries userinfo)');
    if (remoteSlug.toLowerCase() !== slug.toLowerCase()) {
      throw rErr('target ' + key + ' declares a remote for a DIFFERENT repository (' + remoteSlug + ')');
    }
    if (typeof t.default_branch !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(t.default_branch)) {
      throw rErr('target ' + key + ' needs an explicit default_branch (never assumed to be "main")');
    }
    if (typeof t.branch_prefix !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]*\/$/.test(t.branch_prefix)) {
      throw rErr('target ' + key + ' needs a branch_prefix ending in "/"');
    }
    if (!Array.isArray(t.allowed_actions) || !t.allowed_actions.length) {
      throw rErr('target ' + key + ' needs a non-empty allowed_actions list');
    }
    t.allowed_actions.forEach(function (a) {
      if (engine.ACTIONS.indexOf(a) === -1) throw rErr('target ' + key + ' allows unknown action: ' + a);
    });
    if (typeof t.push_enabled !== 'boolean') {
      throw rErr('target ' + key + ' must state push_enabled explicitly (fail closed: false)');
    }
    targets[slug] = {
      repository: slug,
      remote: String(t.remote).trim(),
      default_branch: t.default_branch,
      branch_prefix: t.branch_prefix,
      allowed_actions: t.allowed_actions.slice(),
      push_enabled: t.push_enabled === true,
      authorized_by: t.authorized_by || null,
      authorized_at: t.authorized_at || null,
      description: t.description || null
    };
  });
  if (!Object.keys(targets).length) throw rErr('targets registry authorizes no repository');

  return {
    schema: REGISTRY_SCHEMA,
    workspacesRoot: workspacesRoot,
    controlRepository: control,
    targets: targets
  };
}

// Never throws for an absent or unusable registry: "no cross-repository
// delegation on this host" is a normal, reportable state and the ordinary
// single-repository path must not depend on it.
function loadTargets(registryPath) {
  var p = registryPath || DEFAULT_TARGETS_PATH;
  var raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { available: false, reason: 'targets registry unreadable or malformed: ' + p, registryPath: p };
  }
  var reg;
  try { reg = validateRegistryObject(raw); }
  catch (e) { return { available: false, reason: e.message, registryPath: p }; }
  reg.available = true;
  reg.registryPath = p;
  return reg;
}

function listTargets(registry) {
  if (!registry || !registry.available) return [];
  return Object.keys(registry.targets).sort();
}

// --- Authorization -------------------------------------------------------------------
//
// One decision, taken before a workspace exists, before an OTHMODE record
// exists, before any provider starts. Returns { ok:true, target, … } or a
// refusal carrying the blocker code the bridge reports.

function authorize(registry, request) {
  var req = request || {};
  if (!registry || !registry.available) {
    return refuse(CODES.TARGET_REGISTRY_UNAVAILABLE,
      'the cross-repository delegation lane is not usable on this host: ' +
      ((registry && registry.reason) || 'no targets registry'));
  }
  var raw = req.repository;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return refuse(CODES.TARGET_REPOSITORY_MISSING,
      'a cross-repository delegation names no target repository; it is refused rather than defaulted to the control repository');
  }
  var slug = parseRepoRef(raw);
  if (!slug) {
    return refuse(CODES.TARGET_REPOSITORY_UNAUTHORIZED,
      'target repository "' + String(raw).slice(0, 80) + '" is not a repository reference (expected owner/repo)',
      { requested_repository: String(raw).slice(0, 120) });
  }
  if (sameRepo(slug, registry.controlRepository)) {
    return refuse(CODES.TARGET_REPOSITORY_UNAUTHORIZED,
      'the control repository (' + registry.controlRepository + ') is never a delegation target — work in it runs through the bridge\'s own worktree path',
      { requested_repository: slug });
  }
  var key = Object.keys(registry.targets).filter(function (k) { return sameRepo(k, slug); })[0];
  if (!key) {
    return refuse(CODES.TARGET_REPOSITORY_UNAUTHORIZED,
      'target repository "' + slug + '" is not in the closed allowlist (' +
      listTargets(registry).join(', ') + ') — it is refused, never approved implicitly',
      { requested_repository: slug, authorized_repositories: listTargets(registry) });
  }
  var target = registry.targets[key];

  var action = req.requested_action;
  if (target.allowed_actions.indexOf(action) === -1) {
    return refuse(CODES.TARGET_ACTION_NOT_ALLOWED,
      'requested_action "' + String(action).slice(0, 30) + '" is not authorized for ' + target.repository +
      ' (allowed: ' + target.allowed_actions.join(', ') + ')',
      { repository: target.repository, requested_action: action || null });
  }

  // The ONE source of truth for action → profile. A cross-repository task
  // that says `investigate` can never carry `repo-write`, and one that
  // says `implement` can never be run as `repo-read` — gh-issue-473.
  var expected = engine.profileFor(action);
  if (req.execution_profile !== undefined && req.execution_profile !== null) {
    var check = engine.checkActionProfile(action, req.execution_profile);
    if (!check.ok) {
      return refuse(engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH, check.reason, {
        repository: target.repository, requested_action: action,
        expected_profile: check.expected_profile, actual_profile: check.actual_profile
      });
    }
  }

  // Delivery. A push into the target repository is an authority the lane
  // does not have while `push_enabled` is false, and it is refused here
  // rather than discovered by a relay that would not deliver it anyway.
  var delivery = req.delivery || {};
  if (delivery.push_required === true && !target.push_enabled) {
    return refuse(CODES.TARGET_DELIVERY_NOT_AUTHORIZED,
      'delivery to ' + target.repository + ' requires a push, which is not authorized for this target. ' +
      'The attempt commits in its own workspace; delivery to GitHub is the owner step recorded in ' +
      'docs/MYTHOS_CROSS_REPO_DELEGATION.md. Set push_enabled on the target to change that.',
      { repository: target.repository });
  }

  return {
    ok: true,
    code: null,
    reason: null,
    repository: target.repository,
    target: target,
    execution_profile: expected,
    expected_delivery: engine.deliveryFor(action),
    push_enabled: target.push_enabled
  };
}

// --- Deterministic workspace ---------------------------------------------------------
//
// Pure. The same (root, repository, task id) always name the same
// directory, on every host and on every tick, so a re-claim after a crash
// finds the work that already exists instead of starting a second copy
// somewhere else.

function safeSegment(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[^A-Za-z0-9._-]/g, '_');
}

function workspacePath(registry, repository, taskId) {
  if (!registry || !registry.available) throw iErr('targets registry unavailable', CODES.TARGET_REGISTRY_UNAVAILABLE);
  var slug = parseRepoRef(repository);
  if (!slug) throw iErr('repository is required', CODES.TARGET_REPOSITORY_MISSING);
  var id = safeSegment(taskId);
  if (!id || id === '.' || id === '..' || /^_+$/.test(id)) throw iErr('a task id is required to name a workspace');
  var parts = slug.split('/');
  var dir = path.join(registry.workspacesRoot, safeSegment(parts[0]) + '__' + safeSegment(parts[1]), id);
  var resolved = path.resolve(dir);
  // Belt and braces after sanitisation: prove containment rather than
  // trust it, and prove the result never lands in the control repository.
  if (resolved.indexOf(registry.workspacesRoot + path.sep) !== 0) {
    throw iErr('workspace path escaped the workspaces root: ' + resolved, CODES.TARGET_WORKSPACE_UNAVAILABLE);
  }
  if (resolved === REPO_ROOT || resolved.indexOf(REPO_ROOT + path.sep) === 0) {
    throw iErr('workspace path would land inside the control repository: ' + resolved, CODES.TARGET_WORKSPACE_UNAVAILABLE);
  }
  return resolved;
}

function branchFor(target, taskId) {
  return target.branch_prefix + safeSegment(taskId);
}

// --- Git ------------------------------------------------------------------------------
//
// Injectable so the suite drives real local repositories without a
// network, and so no test can be fooled by a stubbed identity check.

function defaultGit(cwd, args, opts) {
  var o = opts || {};
  var r = cp.spawnSync('git', args, {
    cwd: cwd, encoding: 'utf8', timeout: o.timeout || 120000,
    maxBuffer: 16 * 1024 * 1024,
    env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' })
  });
  return {
    ok: r.status === 0,
    out: String(r.stdout || '').trim(),
    error: String(r.stderr || '').trim() || (r.error ? r.error.message : '')
  };
}

// A path is a claim; this is the proof. Both the toplevel AND the origin
// remote must agree with the authorized target, and neither may be the
// control repository.
function readWorkspaceIdentity(dir, git) {
  var g = git || defaultGit;
  if (!fs.existsSync(dir)) return { ok: false, reason: 'workspace does not exist: ' + dir };
  var top = g(dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { ok: false, reason: 'not a git checkout: ' + dir + (top.error ? ' (' + top.error + ')' : '') };
  var remote = g(dir, ['remote', 'get-url', 'origin']);
  if (!remote.ok || !remote.out) return { ok: false, reason: 'workspace has no origin remote: ' + dir };
  var head = g(dir, ['rev-parse', 'HEAD']);
  var branch = g(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    ok: true,
    toplevel: path.resolve(top.out),
    remote: remote.out,
    repository: parseRepoRef(remote.out),
    head: head.ok ? head.out : null,
    branch: branch.ok ? branch.out : null
  };
}

function verifyWorkspaceIdentity(registry, dir, expectedRepository, git) {
  var id = readWorkspaceIdentity(dir, git);
  if (!id.ok) {
    return refuse(CODES.TARGET_WORKSPACE_UNAVAILABLE, id.reason, { workspace: dir });
  }
  if (id.toplevel === REPO_ROOT || id.toplevel.indexOf(REPO_ROOT + path.sep) === 0) {
    return refuse(CODES.TARGET_IDENTITY_MISMATCH,
      'the workspace resolves into the control repository checkout (' + id.toplevel + ') — refused before any file is written',
      { workspace: dir, toplevel: id.toplevel });
  }
  if (registry && registry.available && id.repository && sameRepo(id.repository, registry.controlRepository)) {
    return refuse(CODES.TARGET_IDENTITY_MISMATCH,
      'the workspace at ' + dir + ' is the CONTROL repository (' + id.repository + '), not the delegation target',
      { workspace: dir, actual_repository: id.repository });
  }
  if (!id.repository || !sameRepo(id.repository, expectedRepository)) {
    return refuse(CODES.TARGET_IDENTITY_MISMATCH,
      'the workspace at ' + dir + ' is ' + (id.repository || 'an unidentifiable repository (' + id.remote + ')') +
      ', not the authorized target ' + parseRepoRef(expectedRepository),
      { workspace: dir, actual_repository: id.repository || null, expected_repository: parseRepoRef(expectedRepository) });
  }
  if (path.resolve(dir) !== id.toplevel) {
    return refuse(CODES.TARGET_IDENTITY_MISMATCH,
      'the workspace ' + dir + ' is a subdirectory of the checkout at ' + id.toplevel + ' — an ambiguous workspace is refused',
      { workspace: dir, toplevel: id.toplevel });
  }
  return { ok: true, code: null, reason: null, identity: id };
}

// While a target's push_enabled is false, a `git push` from its workspace
// must not be able to reach GitHub — the same guarantee bridge/github-
// bridge.js gives a task worktree, expressed for a standalone clone:
// repository-scoped pushurl plus an insteadOf rewrite that neutralises any
// inherited value, proven afterwards on the COMPLETE effective push set.
var NO_PUSH_URL = 'no_push://owner-authorization-required';

function applyWorkspacePushGuard(dir, git) {
  var g = git || defaultGit;
  var key = 'remote.origin.pushurl';
  var fetchUrl = g(dir, ['remote', 'get-url', 'origin']);
  if (!fetchUrl.ok || !fetchUrl.out) {
    throw iErr('PUSH_GUARD_FAILED: cannot read the workspace fetch url', CODES.TARGET_WORKSPACE_UNAVAILABLE);
  }
  g(dir, ['config', '--local', '--unset-all', key]);
  var set = g(dir, ['config', '--local', key, NO_PUSH_URL]);
  if (!set.ok) throw iErr('PUSH_GUARD_FAILED: ' + set.error, CODES.TARGET_WORKSPACE_UNAVAILABLE);
  var aliasKey = 'url.' + NO_PUSH_URL + '.insteadOf';
  g(dir, ['config', '--local', '--unset-all', aliasKey]);
  var all = g(dir, ['config', '--show-origin', '--get-all', key]);
  var inherited = [];
  (all.ok ? all.out.split('\n') : []).forEach(function (line) {
    var i = line.indexOf('\t');
    if (i < 0) return;
    var value = line.slice(i + 1).trim();
    if (!value || value === NO_PUSH_URL) return;
    if (inherited.indexOf(value) < 0) inherited.push(value);
  });
  inherited.forEach(function (u) {
    if (u === fetchUrl.out) {
      throw iErr('PUSH_GUARD_FAILED: inherited push url equals the fetch url (' + u + ')', CODES.TARGET_WORKSPACE_UNAVAILABLE);
    }
    var add = g(dir, ['config', '--local', '--add', aliasKey, u]);
    if (!add.ok) throw iErr('PUSH_GUARD_FAILED: cannot neutralise ' + u + ': ' + add.error, CODES.TARGET_WORKSPACE_UNAVAILABLE);
  });
  var eff = g(dir, ['remote', 'get-url', '--push', '--all', 'origin']);
  var urls = eff.ok ? eff.out.split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [];
  var bad = urls.filter(function (u) { return u !== NO_PUSH_URL; });
  if (!urls.length || bad.length) {
    throw iErr('PUSH_GUARD_FAILED: effective push url(s) ' + JSON.stringify(urls) +
      ' (expected only ' + NO_PUSH_URL + ')', CODES.TARGET_WORKSPACE_UNAVAILABLE);
  }
  var after = g(dir, ['remote', 'get-url', 'origin']);
  if (!after.ok || after.out !== fetchUrl.out) {
    throw iErr('PUSH_GUARD_FAILED: the guard changed the fetch url', CODES.TARGET_WORKSPACE_UNAVAILABLE);
  }
  return { ok: true, push_urls: urls, neutralised: inherited, fetch_url: fetchUrl.out };
}

// Resolves — and, when allowed, creates — the workspace for one attempt.
//
//   opts.repository    required — an authorized target
//   opts.taskId        required — names the workspace and the branch
//   opts.requested_action  required — decides the profile and the delivery
//   opts.allowClone    clone the target when the workspace is absent.
//                      Without it an absent workspace is reported with the
//                      exact command that creates it, never guessed at.
//   opts.git           injectable git runner (tests)
//
// Returns { ok:true, workspace, branch, base_commit, … } or a refusal.
function ensureWorkspace(registry, opts) {
  var o = opts || {};
  var g = o.git || defaultGit;
  var auth = authorize(registry, {
    repository: o.repository,
    requested_action: o.requested_action,
    execution_profile: o.execution_profile,
    delivery: o.delivery
  });
  if (!auth.ok) return auth;
  var target = auth.target;

  var dir;
  try { dir = workspacePath(registry, target.repository, o.taskId); }
  catch (e) { return refuse(e.code || CODES.TARGET_WORKSPACE_UNAVAILABLE, e.message); }
  var branch = branchFor(target, o.taskId);
  var cloneCmd = 'git clone --origin origin ' + target.remote + ' ' + dir;
  var existed = fs.existsSync(dir);

  if (!existed) {
    if (!o.allowClone) {
      return refuse(CODES.TARGET_WORKSPACE_UNAVAILABLE,
        'no checkout of ' + target.repository + ' exists at ' + dir + '. The lane does not clone implicitly; ' +
        'create it with: ' + cloneCmd,
        { repository: target.repository, workspace: dir, clone_command: cloneCmd });
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
    var clone = g(path.dirname(dir), ['clone', '--origin', 'origin', target.remote, dir], { timeout: 600000 });
    if (!clone.ok) {
      return refuse(CODES.TARGET_WORKSPACE_UNAVAILABLE,
        'could not clone ' + target.repository + ' into ' + dir + ': ' + (clone.error || 'git clone failed'),
        { repository: target.repository, workspace: dir, clone_command: cloneCmd });
    }
  }

  // Identity BEFORE anything is written, every time — including on reuse,
  // because a workspace that was right yesterday is only a claim today.
  var verified = verifyWorkspaceIdentity(registry, dir, target.repository, g);
  if (!verified.ok) return verified;

  var guard = null;
  if (!target.push_enabled) {
    try { guard = applyWorkspacePushGuard(dir, g); }
    catch (e) { return refuse(e.code || CODES.TARGET_WORKSPACE_UNAVAILABLE, e.message, { workspace: dir }); }
  }

  // Best effort: an offline host still runs against what it already has.
  g(dir, ['fetch', '--quiet', 'origin', target.default_branch], { timeout: 300000 });
  var base = g(dir, ['rev-parse', '--verify', '--quiet', 'origin/' + target.default_branch]);
  if (!base.ok || !base.out) base = g(dir, ['rev-parse', '--verify', '--quiet', target.default_branch]);
  if (!base.ok || !base.out) base = g(dir, ['rev-parse', 'HEAD']);
  if (!base.ok || !base.out) {
    return refuse(CODES.TARGET_WORKSPACE_UNAVAILABLE,
      'cannot resolve a base commit in ' + dir + ' (tried origin/' + target.default_branch + ', ' + target.default_branch + ', HEAD)',
      { workspace: dir });
  }

  var reusedBranch = g(dir, ['rev-parse', '--verify', '--quiet', 'refs/heads/' + branch]).ok;
  var co = reusedBranch
    ? g(dir, ['checkout', branch])
    : g(dir, ['checkout', '-b', branch, base.out]);
  if (!co.ok) {
    return refuse(CODES.TARGET_WORKSPACE_UNAVAILABLE,
      'cannot check out ' + branch + ' in ' + dir + ': ' + co.error, { workspace: dir, branch: branch });
  }
  var baseCommit = reusedBranch
    ? (g(dir, ['merge-base', branch, base.out]).out || base.out)
    : base.out;

  return {
    ok: true, code: null, reason: null,
    repository: target.repository,
    remote: target.remote,
    workspace: dir,
    branch: branch,
    base_commit: baseCommit,
    default_branch: target.default_branch,
    reused: existed,
    cloned: !existed,
    push_enabled: target.push_enabled,
    push_guard: guard,
    execution_profile: auth.execution_profile,
    expected_delivery: auth.expected_delivery,
    identity: verified.identity
  };
}

// --- Delegated task contract ----------------------------------------------------------
//
// `mythos.delegate.task.v1`. gh-issue-473 happened because the payload a
// delegated run received did not carry, in one inspectable place, WHAT
// repository the work belonged to and WHAT class of work it was; the
// objective said "implement" while the attempt ran as `investigate` with
// a `repo-read` profile. Every field below exists so that pairing is
// stated once and checked once.

var REQUIRED_TASK_FIELDS = ['schema', 'task_id', 'target_repository', 'target_branch', 'workspace',
  'requested_action', 'execution_profile', 'delivery', 'acceptance_criteria', 'test_requirements'];
var ALLOWED_TASK_FIELDS = REQUIRED_TASK_FIELDS.concat(['created_at', 'source', 'objective', 'constraints',
  'deployment', 'lane', 'base_commit', 'default_branch', 'remote', 'timeout_seconds']);

function strList(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }) : []; }

function buildDelegatedTask(registry, input) {
  var i = input || {};
  var resolved = i.workspace_record || null;
  var action = i.requested_action;
  var auth = authorize(registry, {
    repository: i.target_repository, requested_action: action,
    execution_profile: i.execution_profile, delivery: i.delivery
  });
  if (!auth.ok) throw iErr(auth.reason, auth.code);
  var target = auth.target;
  var profile = auth.execution_profile;
  var writes = profile === 'repo-write';
  return {
    schema: TASK_SCHEMA,
    task_id: String(i.task_id || ''),
    created_at: i.created_at || new Date().toISOString(),
    source: i.source || null,
    target_repository: target.repository,
    remote: target.remote,
    default_branch: target.default_branch,
    target_branch: (resolved && resolved.branch) || i.target_branch || branchFor(target, i.task_id),
    workspace: (resolved && resolved.workspace) || i.workspace || workspacePath(registry, target.repository, i.task_id),
    base_commit: (resolved && resolved.base_commit) || i.base_commit || null,
    requested_action: action,
    execution_profile: profile,
    delivery: {
      commit_required: writes,
      push_required: false,
      report_required: true
    },
    objective: i.objective || null,
    constraints: strList(i.constraints),
    acceptance_criteria: strList(i.acceptance_criteria),
    test_requirements: strList(i.test_requirements),
    deployment: i.deployment || null,
    lane: i.lane || null,
    timeout_seconds: typeof i.timeout_seconds === 'number' ? i.timeout_seconds : null
  };
}

function validateDelegatedTask(registry, task) {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    return refuse(CODES.TARGET_CONTRACT_INVALID, 'a delegated task must be an object');
  }
  if (task.schema !== TASK_SCHEMA) {
    return refuse(CODES.TARGET_CONTRACT_INVALID, 'delegated task schema must be ' + TASK_SCHEMA);
  }
  var unknown = Object.keys(task).filter(function (k) { return ALLOWED_TASK_FIELDS.indexOf(k) === -1; });
  if (unknown.length) {
    return refuse(CODES.TARGET_CONTRACT_INVALID, 'unknown delegated task field(s): ' + unknown.join(', '));
  }
  var missing = REQUIRED_TASK_FIELDS.filter(function (k) {
    return task[k] === undefined || task[k] === null || task[k] === '';
  });
  if (missing.length) {
    return refuse(CODES.TARGET_CONTRACT_INVALID, 'delegated task is missing: ' + missing.join(', '));
  }

  var auth = authorize(registry, {
    repository: task.target_repository,
    requested_action: task.requested_action,
    execution_profile: task.execution_profile,
    delivery: task.delivery
  });
  if (!auth.ok) return auth;
  var target = auth.target;

  // The workspace is not free-form: it must be the one the deterministic
  // function names for this (target, task id). Anything else is ambiguous
  // routing, which is precisely what must never reach an implementer.
  var expectedWorkspace;
  try { expectedWorkspace = workspacePath(registry, target.repository, task.task_id); }
  catch (e) { return refuse(e.code || CODES.TARGET_WORKSPACE_UNAVAILABLE, e.message); }
  if (path.resolve(String(task.workspace)) !== expectedWorkspace) {
    return refuse(CODES.TARGET_WORKSPACE_UNAVAILABLE,
      'delegated workspace ' + task.workspace + ' is not the deterministic workspace for ' +
      target.repository + '/' + task.task_id + ' (' + expectedWorkspace + ') — ambiguous routing is refused',
      { workspace: task.workspace, expected_workspace: expectedWorkspace });
  }
  if (String(task.target_branch).indexOf(target.branch_prefix) !== 0) {
    return refuse(CODES.TARGET_CONTRACT_INVALID,
      'target_branch "' + task.target_branch + '" does not carry this target\'s branch prefix "' + target.branch_prefix + '"');
  }
  if (/^(main|master)$/.test(String(task.target_branch))) {
    return refuse(CODES.TARGET_CONTRACT_INVALID, 'a delegated task never runs on the target\'s default branch');
  }

  var d = task.delivery;
  if (d === null || typeof d !== 'object' || Array.isArray(d)) {
    return refuse(CODES.TARGET_CONTRACT_INVALID, 'delivery must be an object');
  }
  var writes = task.execution_profile === 'repo-write';
  // The gh-issue-473 invariant, both ways round.
  if (!writes && d.commit_required === true) {
    return refuse(engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH,
      'requested_action=' + task.requested_action + ' resolves to execution_profile=' + task.execution_profile +
      ', which cannot produce a commit, yet this task requires one — refused before any implementer started',
      { requested_action: task.requested_action, execution_profile: task.execution_profile });
  }
  if (writes && d.commit_required !== true) {
    return refuse(engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH,
      'requested_action=' + task.requested_action + ' is an implementation action but this task requires no commit — ' +
      'an implementation that delivers nothing is the gh-issue-473 mismatch, refused',
      { requested_action: task.requested_action, execution_profile: task.execution_profile });
  }
  if (d.push_required === true && !target.push_enabled) {
    return refuse(CODES.TARGET_DELIVERY_NOT_AUTHORIZED,
      'this task requires a push to ' + target.repository + ', which is not authorized for that target');
  }
  if (writes && !strList(task.acceptance_criteria).length) {
    return refuse(CODES.TARGET_CONTRACT_INVALID,
      'an implementation task must carry at least one acceptance criterion');
  }
  if (writes && !strList(task.test_requirements).length) {
    return refuse(CODES.TARGET_CONTRACT_INVALID,
      'an implementation task must carry at least one test requirement');
  }
  return { ok: true, code: null, reason: null, repository: target.repository, target: target, task: task };
}

// --- GitHub authorization ---------------------------------------------------------------
//
// What the delegate needs from GitHub for a given target, and which part of
// it a human still has to grant. Never a credential — it names capabilities
// and the identity mechanism, and reads no secret to do so.
function authorizationPlan(registry, repository) {
  var auth = authorize(registry, { repository: repository, requested_action: 'investigate' });
  if (!auth.ok) return auth;
  var t = auth.target;
  return {
    ok: true,
    repository: t.repository,
    remote: t.remote,
    identity: 'the host\'s own Git identity (SSH agent/key of the executor user). No token, key or password is read, stored or passed by this lane.',
    capabilities: [
      { capability: 'read / clone', granted: true, how: 'the host Git identity already resolves ' + t.remote + ' (verify with: git ls-remote --heads ' + t.remote + ')' },
      { capability: 'create a branch locally', granted: true, how: 'inside the delegated workspace only, always prefixed ' + t.branch_prefix },
      { capability: 'commit locally', granted: true, how: 'inside the delegated workspace only, on the prefixed branch' },
      { capability: 'push', granted: t.push_enabled, how: t.push_enabled
        ? 'authorized for this target'
        : 'NOT granted. The governance relay delivers refs/heads/mythos/* of the control repository only. While push_enabled is false the lane installs a no-push guard on the workspace remote.' },
      { capability: 'create / update a pull request', granted: false, how: 'never performed by this lane, for any target' }
    ],
    // The ONE external dependency. Everything else in this lane works
    // today with no human in the loop.
    owner_step: t.push_enabled ? null : {
      required: true,
      what: 'delivery of a delegated branch from ' + t.repository + ' to GitHub',
      who: 'the repository owner, on the host, as themselves',
      how: 'review the branch in the workspace (git -C <workspace> log --stat ' + t.default_branch + '..' +
        t.branch_prefix + '<task-id>) and push it with the owner\'s own identity, or set push_enabled:true ' +
        'on this target in projects/mythos-delegate/config/targets.json once a delivery path for it is agreed.',
      why: 'the governance relay is scoped to the control repository, so no automated path delivers this target; ' +
        'the lane refuses rather than inventing one.'
    }
  };
}

module.exports = {
  DEFAULT_TARGETS_PATH: DEFAULT_TARGETS_PATH,
  REGISTRY_SCHEMA: REGISTRY_SCHEMA,
  TASK_SCHEMA: TASK_SCHEMA,
  CODES: CODES,
  NO_PUSH_URL: NO_PUSH_URL,
  parseRepoRef: parseRepoRef,
  sameRepo: sameRepo,
  validateRegistryObject: validateRegistryObject,
  loadTargets: loadTargets,
  listTargets: listTargets,
  authorize: authorize,
  workspacePath: workspacePath,
  branchFor: branchFor,
  readWorkspaceIdentity: readWorkspaceIdentity,
  verifyWorkspaceIdentity: verifyWorkspaceIdentity,
  applyWorkspacePushGuard: applyWorkspacePushGuard,
  ensureWorkspace: ensureWorkspace,
  buildDelegatedTask: buildDelegatedTask,
  validateDelegatedTask: validateDelegatedTask,
  authorizationPlan: authorizationPlan
};
