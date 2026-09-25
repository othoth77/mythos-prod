'use strict';
// =====================================================
// MYTHOS V2 — cross-repository delegation lane tests
// tests/mythos-delegate-cross-repo-test.js
//
// gh-issue-474. Deterministic and OFFLINE: the suite builds real local
// Git repositories in a temp directory and points a temp registry at
// them, so identity verification, the push guard and branch creation are
// exercised against actual `git`, never a stub — a stubbed identity check
// would pass exactly the case this lane exists to refuse.
//
// No network. No credential. Nothing outside os.tmpdir() is written.
//
// Covered, in the order the mission listed them:
//   §1  registry validation (fail closed)
//   §2  repository identity parsing
//   §3  authorization — authorized othoth77/spy, everything else refused
//   §4  deterministic workspace + isolation from the control repository
//   §5  real workspace resolution, identity proof and push guard
//   §6  implementation vs repo-read profile enforcement (gh-issue-473)
//   §7  the mythos.delegate.task.v1 payload contract
//   §8  failure and recovery behaviour
//   §9  the existing single-repository path is unchanged
//
// Run with: node tests/mythos-delegate-cross-repo-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function eq(a, b, l) { ok(a === b, l + (a === b ? '' : ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')')); }
function refused(r, code, l) {
  ok(r && r.ok === false && r.code === code,
    l + (r && r.ok === false && r.code === code ? '' : ' (got ' + JSON.stringify(r && (r.code || r.ok)) + ')'));
}
function throws(fn, re, l) {
  try { fn(); ok(false, l + ' (expected a throw)'); }
  catch (e) { ok(re.test(e.message), l + (re.test(e.message) ? '' : ' (got: ' + e.message + ')')); }
}

var crossRepo = require(path.join(BASE, 'projects', 'mythos-delegate', 'lib', 'cross-repo.js'));
var engine = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'action-resolution.js'));

// --- Test fixtures -------------------------------------------------------------------

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-crossrepo-'));
var GIT_ENV = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: 'mythos-test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'mythos-test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1', HOME: TMP, GIT_TERMINAL_PROMPT: '0',
  // The fixtures carry the REAL github.com remote, because that is what
  // the identity check reads. Making SSH impossible keeps the suite
  // genuinely offline — and exercises the lane's offline fallback, where
  // a fetch that cannot run still leaves a usable base commit.
  GIT_SSH_COMMAND: '/bin/false'
});
function git(cwd, args) {
  var r = cp.spawnSync('git', args, { cwd: cwd, encoding: 'utf8', env: GIT_ENV });
  return { ok: r.status === 0, out: String(r.stdout || '').trim(), error: String(r.stderr || '').trim() };
}
// The lane's own git runner, bound to the hermetic test environment so no
// developer's ~/.gitconfig can change a result.
function testGit(cwd, args) { return git(cwd, args); }

var SPY_REMOTE = 'git@github.com:othoth77/spy.git';
var CONTROL_REMOTE = 'git@github.com:othoth77/mythos-prod.git';

// A seed repository standing in for the target on GitHub. Its default
// branch is `master`, exactly like othoth77/spy — the lane must read that
// from the registry rather than assuming `main`.
function seedRepo(dir, branch) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '--quiet', '--initial-branch=' + branch]);
  fs.writeFileSync(path.join(dir, 'README.md'), '# seed\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '--quiet', '-m', 'seed']);
  return git(dir, ['rev-parse', 'HEAD']).out;
}
var SPY_SEED = path.join(TMP, 'seed-spy');
var SPY_SEED_HEAD = seedRepo(SPY_SEED, 'master');
var CONTROL_SEED = path.join(TMP, 'seed-control');
seedRepo(CONTROL_SEED, 'main');

var WORKSPACES = path.join(TMP, 'workspaces');
var REGISTRY_FILE = path.join(TMP, 'targets.json');
var REGISTRY_DOC = {
  schema: 'mythos.delegate.targets.v1',
  workspaces_root: WORKSPACES,
  control_repository: 'othoth77/mythos-prod',
  targets: {
    'othoth77/spy': {
      remote: SPY_REMOTE,
      default_branch: 'master',
      branch_prefix: 'mythos/spy/',
      allowed_actions: ['investigate', 'review', 'test', 'document', 'implement'],
      push_enabled: false
    }
  }
};
fs.writeFileSync(REGISTRY_FILE, JSON.stringify(REGISTRY_DOC));
var reg = crossRepo.loadTargets(REGISTRY_FILE);

// Clones the seed into the deterministic workspace and rewrites origin to
// the real remote — byte for byte what a production clone of the target
// looks like from the identity check's point of view.
function materialise(taskId, remote, seed) {
  var dir = crossRepo.workspacePath(reg, 'othoth77/spy', taskId);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  var c = git(path.dirname(dir), ['clone', '--quiet', '--origin', 'origin', seed || SPY_SEED, dir]);
  if (!c.ok) throw new Error('fixture clone failed: ' + c.error);
  git(dir, ['remote', 'set-url', 'origin', remote || SPY_REMOTE]);
  return dir;
}

function cleanup() { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

// =====================================================================================
console.log('\n§1 registry validation — fail closed');

var prod = crossRepo.loadTargets();
ok(prod.available === true, 'the shipped registry validates: ' + (prod.reason || 'ok'));
ok(crossRepo.listTargets(prod).indexOf('othoth77/spy') !== -1,
  'othoth77/spy is an explicitly authorized target in the shipped registry');
eq(prod.controlRepository, 'othoth77/mythos-prod', 'the shipped registry names the control repository');
eq(prod.targets['othoth77/spy'].default_branch, 'master',
  'the shipped target declares master as its default branch (never assumed to be main)');
eq(prod.targets['othoth77/spy'].push_enabled, false,
  'push to the shipped target is not authorized (fail closed)');

ok(reg.available === true, 'the test registry validates');
function badRegistry(patch, re, label) {
  throws(function () { crossRepo.validateRegistryObject(Object.assign({}, REGISTRY_DOC, patch)); }, re, label);
}
badRegistry({ extra: 1 }, /unknown targets registry field/, 'an unknown registry field is refused (closed field set)');
badRegistry({ schema: 'other' }, /schema must be/, 'a foreign schema is refused');
badRegistry({ api_key: 'k' }, /credential- or endpoint-shaped key/, 'a credential-shaped key is refused');
badRegistry({ targets: { 'othoth77/spy': Object.assign({}, REGISTRY_DOC.targets['othoth77/spy'], { secret_token: 'x' }) } },
  /credential- or endpoint-shaped key/, 'a credential-shaped key is refused at depth');
badRegistry({ workspaces_root: path.join(BASE, 'workspaces') },
  /outside this repository/, 'a workspaces_root inside the control repository is refused');
badRegistry({ workspaces_root: 'relative/path' }, /absolute path/, 'a relative workspaces_root is refused');
badRegistry({ targets: { 'othoth77/mythos-prod': REGISTRY_DOC.targets['othoth77/spy'] } },
  /control repository .* can never be a delegation target/, 'the control repository cannot be listed as a target');
badRegistry({ targets: { 'othoth77/spy': Object.assign({}, REGISTRY_DOC.targets['othoth77/spy'], { remote: 'git@github.com:othoth77/other.git' }) } },
  /remote for a DIFFERENT repository/, 'a target whose remote names another repository is refused');
badRegistry({ targets: { 'othoth77/spy': Object.assign({}, REGISTRY_DOC.targets['othoth77/spy'], { push_enabled: undefined }) } },
  /must state push_enabled explicitly/, 'a target that omits push_enabled is refused');
badRegistry({ targets: { 'othoth77/spy': Object.assign({}, REGISTRY_DOC.targets['othoth77/spy'], { default_branch: undefined }) } },
  /explicit default_branch/, 'a target that omits default_branch is refused');
badRegistry({ targets: { 'othoth77/spy': Object.assign({}, REGISTRY_DOC.targets['othoth77/spy'], { branch_prefix: 'spy' }) } },
  /branch_prefix ending in/, 'a branch_prefix that is not a prefix is refused');
badRegistry({ targets: { 'othoth77/spy': Object.assign({}, REGISTRY_DOC.targets['othoth77/spy'], { allowed_actions: ['deploy'] }) } },
  /unknown action/, 'a target allowing an unknown action is refused');
badRegistry({ targets: {} }, /authorizes no repository/, 'an empty target set is refused');

var missing = crossRepo.loadTargets(path.join(TMP, 'does-not-exist.json'));
ok(missing.available === false, 'an absent registry disables the lane rather than throwing');
refused(crossRepo.authorize(missing, { repository: 'othoth77/spy', requested_action: 'implement' }),
  crossRepo.CODES.TARGET_REGISTRY_UNAVAILABLE, 'with no registry, every delegation is refused');

// =====================================================================================
console.log('\n§2 repository identity');

eq(crossRepo.parseRepoRef('othoth77/spy'), 'othoth77/spy', 'a bare slug parses');
eq(crossRepo.parseRepoRef(SPY_REMOTE), 'othoth77/spy', 'an SSH remote parses');
eq(crossRepo.parseRepoRef('https://github.com/othoth77/spy'), 'othoth77/spy', 'an HTTPS remote parses');
eq(crossRepo.parseRepoRef('https://github.com/othoth77/spy.git/'), 'othoth77/spy', 'a trailing .git and slash are stripped');
eq(crossRepo.parseRepoRef('ssh://git@github.com/othoth77/spy.git'), 'othoth77/spy', 'an ssh:// remote parses');
eq(crossRepo.parseRepoRef('https://user:t0ken@github.com/othoth77/spy.git'), null,
  'a remote carrying userinfo is not a repository reference — a credential in a remote is refused, never used');
eq(crossRepo.parseRepoRef('othoth77'), null, 'an owner alone is not a repository reference');
eq(crossRepo.parseRepoRef('a/b/c'), null, 'a three-segment path is not a repository reference');
eq(crossRepo.parseRepoRef(''), null, 'the empty string is not a repository reference');
eq(crossRepo.parseRepoRef(null), null, 'null is not a repository reference');
ok(crossRepo.sameRepo('OthOth77/Spy', SPY_REMOTE), 'repository comparison is case-insensitive, as GitHub is');
ok(!crossRepo.sameRepo('othoth77/spy', 'othoth77/spyglass'), 'a prefix is not the same repository');

// =====================================================================================
console.log('\n§3 authorization');

var authorized = crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'implement', execution_profile: 'repo-write' });
ok(authorized.ok === true, 'othoth77/spy + implement is authorized');
eq(authorized.repository, 'othoth77/spy', 'the canonical repository spelling comes back');
eq(authorized.execution_profile, 'repo-write', 'implement resolves to repo-write');
eq(authorized.expected_delivery, 'commit', 'implement expects a commit delivery');
ok(crossRepo.authorize(reg, { repository: SPY_REMOTE, requested_action: 'implement' }).ok === true,
  'the target may be named by its remote as well as its slug');

refused(crossRepo.authorize(reg, { requested_action: 'implement' }),
  crossRepo.CODES.TARGET_REPOSITORY_MISSING, 'a missing target repository is refused, never defaulted');
refused(crossRepo.authorize(reg, { repository: '', requested_action: 'implement' }),
  crossRepo.CODES.TARGET_REPOSITORY_MISSING, 'an empty target repository is refused');
refused(crossRepo.authorize(reg, { repository: 'othoth77/somewhere-else', requested_action: 'implement' }),
  crossRepo.CODES.TARGET_REPOSITORY_UNAUTHORIZED, 'an unauthorized repository is refused');
refused(crossRepo.authorize(reg, { repository: 'othoth77/mythos-prod', requested_action: 'implement' }),
  crossRepo.CODES.TARGET_REPOSITORY_UNAUTHORIZED, 'the control repository is never a delegation target');
refused(crossRepo.authorize(reg, { repository: 'not a repo', requested_action: 'implement' }),
  crossRepo.CODES.TARGET_REPOSITORY_UNAUTHORIZED, 'an unparseable target is refused');
refused(crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'deploy' }),
  crossRepo.CODES.TARGET_ACTION_NOT_ALLOWED, 'an action the target does not allow is refused');
refused(crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'implement', delivery: { push_required: true } }),
  crossRepo.CODES.TARGET_DELIVERY_NOT_AUTHORIZED, 'a push into a target with push_enabled:false is refused');

var plan = crossRepo.authorizationPlan(reg, 'othoth77/spy');
ok(plan.ok === true, 'an authorization plan is produced for the authorized target');
ok(plan.capabilities.filter(function (c) { return c.capability === 'read / clone'; })[0].granted === true,
  'read/clone is reported as already granted by the host Git identity');
ok(plan.capabilities.filter(function (c) { return /push/.test(c.capability); })[0].granted === false,
  'push is reported as NOT granted while push_enabled is false');
ok(plan.owner_step && plan.owner_step.required === true,
  'the one owner-only step is isolated and named');
// Credential SHAPES, not the words: the plan legitimately explains that it
// reads no token, and a word-match would fail on its own prose.
ok(!/gh[pousr]_[A-Za-z0-9]{20,}|ssh-(rsa|ed25519|dss) |-----BEGIN|:\/\/[^/@\s]*:[^/@\s]*@/.test(JSON.stringify(plan)),
  'the authorization plan carries no credential material');

// =====================================================================================
console.log('\n§4 deterministic workspace and isolation');

var wsA = crossRepo.workspacePath(reg, 'othoth77/spy', 'gh-issue-474');
var wsB = crossRepo.workspacePath(reg, SPY_REMOTE, 'gh-issue-474');
eq(wsA, wsB, 'the workspace path is the same however the repository is spelled');
eq(wsA, path.join(WORKSPACES, 'othoth77__spy', 'gh-issue-474'), 'the workspace path is a pure function of root, repository and task id');
ok(wsA.indexOf(WORKSPACES + path.sep) === 0, 'the workspace lives under the configured workspaces root');
ok(wsA.indexOf(BASE + path.sep) !== 0, 'the workspace is OUTSIDE the control repository — target files can never reach a control commit');
ok(crossRepo.workspacePath(reg, 'othoth77/spy', '../../../etc/passwd').indexOf(WORKSPACES + path.sep) === 0,
  'a traversing task id cannot escape the workspaces root');
throws(function () { crossRepo.workspacePath(reg, 'othoth77/spy', ''); }, /task id is required/, 'a workspace needs a task id');
throws(function () { crossRepo.workspacePath(reg, '', 'x'); }, /repository is required/, 'a workspace needs a repository');
eq(crossRepo.branchFor(reg.targets['othoth77/spy'], 'gh-issue-474'), 'mythos/spy/gh-issue-474',
  'the delegated branch always carries the target\'s prefix');

// =====================================================================================
console.log('\n§5 real workspace resolution, identity proof and push guard');

var absent = crossRepo.ensureWorkspace(reg, { repository: 'othoth77/spy', taskId: 'gh-issue-474', requested_action: 'implement', git: testGit });
refused(absent, crossRepo.CODES.TARGET_WORKSPACE_UNAVAILABLE, 'an absent workspace is refused, not guessed at');
ok(/git clone /.test(absent.clone_command || ''), 'the refusal carries the exact command that creates the workspace');
eq(absent.workspace, wsA, 'the refusal names the deterministic workspace it expected');

materialise('gh-issue-474');
var resolved = crossRepo.ensureWorkspace(reg, { repository: 'othoth77/spy', taskId: 'gh-issue-474', requested_action: 'implement', git: testGit });
ok(resolved.ok === true, 'a real checkout of the target resolves: ' + (resolved.reason || 'ok'));
eq(resolved.repository, 'othoth77/spy', 'the resolved workspace reports the target repository');
eq(resolved.workspace, wsA, 'the resolved workspace is the deterministic one');
eq(resolved.branch, 'mythos/spy/gh-issue-474', 'the attempt runs on a prefixed branch');
eq(resolved.base_commit, SPY_SEED_HEAD, 'the base commit is the target default branch head');
eq(resolved.execution_profile, 'repo-write', 'the resolution carries the profile the action maps to');
eq(git(wsA, ['rev-parse', '--abbrev-ref', 'HEAD']).out, 'mythos/spy/gh-issue-474', 'the branch is actually checked out');
ok(!fs.existsSync(path.join(wsA, 'AGENTS.md')), 'the workspace holds target-repository files only — no control-repository tree');

var pushUrls = git(wsA, ['remote', 'get-url', '--push', '--all', 'origin']).out.split('\n');
eq(pushUrls.length, 1, 'the workspace has exactly one effective push url');
eq(pushUrls[0], crossRepo.NO_PUSH_URL, 'that push url is the no-push guard — an instructed push cannot reach GitHub');
eq(git(wsA, ['remote', 'get-url', 'origin']).out, SPY_REMOTE, 'the guard leaves fetch working');

// =====================================================================================
console.log('\n§6 implementation vs repo-read enforcement (the gh-issue-473 mismatch)');

refused(crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'implement', execution_profile: 'repo-read' }),
  engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH,
  'an implement task carrying repo-read is refused — the exact gh-issue-473 mismatch');
refused(crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'investigate', execution_profile: 'repo-write' }),
  engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH,
  'an investigate task carrying repo-write is refused');
eq(crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'investigate' }).execution_profile, 'repo-read',
  'investigate still resolves to repo-read');
eq(crossRepo.authorize(reg, { repository: 'othoth77/spy', requested_action: 'test' }).execution_profile, 'repo-test',
  'test still resolves to repo-test');
ok(engine.NON_RETRYABLE.indexOf(engine.BLOCKER_CODES.TARGET_REPOSITORY_UNAUTHORIZED) !== -1,
  'an unauthorized repository is not retried — retrying cannot authorize one');
ok(engine.NON_RETRYABLE.indexOf(engine.BLOCKER_CODES.TARGET_IDENTITY_MISMATCH) !== -1,
  'an identity mismatch is not retried');

// =====================================================================================
console.log('\n§7 the mythos.delegate.task.v1 payload contract');

var built = crossRepo.buildDelegatedTask(reg, {
  task_id: 'gh-issue-474', target_repository: 'othoth77/spy', requested_action: 'implement',
  objective: 'enable cross-repo delegation', acceptance_criteria: ['a lane exists'], test_requirements: ['node tests/mythos-delegate-cross-repo-test.js'],
  workspace_record: resolved
});
eq(built.schema, 'mythos.delegate.task.v1', 'the payload states its schema');
eq(built.target_repository, 'othoth77/spy', 'the payload carries the target repository');
eq(built.target_branch, 'mythos/spy/gh-issue-474', 'the payload carries the target branch');
eq(built.workspace, wsA, 'the payload carries the target workspace');
eq(built.execution_profile, 'repo-write', 'the payload carries the execution profile');
eq(built.delivery.commit_required, true, 'an implement payload requires a commit');
eq(built.delivery.push_required, false, 'no payload requires a push while push_enabled is false');
eq(built.base_commit, SPY_SEED_HEAD, 'the payload carries the base commit it was resolved against');
ok(crossRepo.validateDelegatedTask(reg, built).ok === true, 'the built payload validates');

['task_id', 'target_repository', 'target_branch', 'workspace', 'requested_action', 'execution_profile', 'delivery', 'acceptance_criteria', 'test_requirements'].forEach(function (field) {
  var broken = JSON.parse(JSON.stringify(built));
  delete broken[field];
  var v = crossRepo.validateDelegatedTask(reg, broken);
  ok(v.ok === false, 'a payload missing ' + field + ' is refused');
});

var unknownField = JSON.parse(JSON.stringify(built)); unknownField.provider = 'claude';
refused(crossRepo.validateDelegatedTask(reg, unknownField), crossRepo.CODES.TARGET_CONTRACT_INVALID,
  'a payload carrying an unknown field is refused — it may not smuggle a provider');

var elsewhere = JSON.parse(JSON.stringify(built)); elsewhere.workspace = path.join(TMP, 'somewhere-else');
refused(crossRepo.validateDelegatedTask(reg, elsewhere), crossRepo.CODES.TARGET_WORKSPACE_UNAVAILABLE,
  'a payload naming a workspace other than the deterministic one is refused (ambiguous routing)');

var intoRepo = JSON.parse(JSON.stringify(built)); intoRepo.workspace = path.join(BASE, 'projects');
refused(crossRepo.validateDelegatedTask(reg, intoRepo), crossRepo.CODES.TARGET_WORKSPACE_UNAVAILABLE,
  'a payload pointing into the control repository is refused');

var wrongPrefix = JSON.parse(JSON.stringify(built)); wrongPrefix.target_branch = 'feature/x';
refused(crossRepo.validateDelegatedTask(reg, wrongPrefix), crossRepo.CODES.TARGET_CONTRACT_INVALID,
  'a payload whose branch lacks the target prefix is refused');

var onDefault = JSON.parse(JSON.stringify(built)); onDefault.target_branch = 'master';
refused(crossRepo.validateDelegatedTask(reg, onDefault), crossRepo.CODES.TARGET_CONTRACT_INVALID,
  'a payload that would run on the target default branch is refused');

var readOnlyCommit = JSON.parse(JSON.stringify(built));
readOnlyCommit.requested_action = 'investigate'; readOnlyCommit.execution_profile = 'repo-read';
refused(crossRepo.validateDelegatedTask(reg, readOnlyCommit), engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH,
  'a repo-read payload that requires a commit is refused');

var writeNoCommit = JSON.parse(JSON.stringify(built)); writeNoCommit.delivery = { commit_required: false, push_required: false, report_required: true };
refused(crossRepo.validateDelegatedTask(reg, writeNoCommit), engine.BLOCKER_CODES.ACTION_PROFILE_MISMATCH,
  'an implement payload that delivers nothing is refused — an implementation must deliver');

var wantsPush = JSON.parse(JSON.stringify(built)); wantsPush.delivery.push_required = true;
refused(crossRepo.validateDelegatedTask(reg, wantsPush), crossRepo.CODES.TARGET_DELIVERY_NOT_AUTHORIZED,
  'a payload that requires an unauthorized push is refused');

var noCriteria = JSON.parse(JSON.stringify(built)); noCriteria.acceptance_criteria = [];
refused(crossRepo.validateDelegatedTask(reg, noCriteria), crossRepo.CODES.TARGET_CONTRACT_INVALID,
  'an implementation payload with no acceptance criterion is refused');
var noTests = JSON.parse(JSON.stringify(built)); noTests.test_requirements = [];
refused(crossRepo.validateDelegatedTask(reg, noTests), crossRepo.CODES.TARGET_CONTRACT_INVALID,
  'an implementation payload with no test requirement is refused');

var foreign = JSON.parse(JSON.stringify(built)); foreign.target_repository = 'othoth77/somewhere-else';
refused(crossRepo.validateDelegatedTask(reg, foreign), crossRepo.CODES.TARGET_REPOSITORY_UNAUTHORIZED,
  'a payload naming an unauthorized repository is refused at validation too');

var readOnlyTask = crossRepo.buildDelegatedTask(reg, {
  task_id: 'gh-issue-474', target_repository: 'othoth77/spy', requested_action: 'investigate', workspace_record: resolved
});
eq(readOnlyTask.execution_profile, 'repo-read', 'an investigate payload is repo-read');
eq(readOnlyTask.delivery.commit_required, false, 'an investigate payload requires no commit');
ok(crossRepo.validateDelegatedTask(reg, readOnlyTask).ok === true, 'a read-only payload validates with no acceptance criteria');

// =====================================================================================
console.log('\n§8 failure and recovery');

// Recovery: a second resolution of the same task finds the SAME workspace
// and the SAME branch, and keeps the work already committed there.
fs.writeFileSync(path.join(wsA, 'work.txt'), 'delegated work\n');
git(wsA, ['add', '-A']);
git(wsA, ['commit', '--quiet', '-m', 'delegated work']);
var committed = git(wsA, ['rev-parse', 'HEAD']).out;
var again = crossRepo.ensureWorkspace(reg, { repository: 'othoth77/spy', taskId: 'gh-issue-474', requested_action: 'implement', git: testGit });
ok(again.ok === true, 're-resolving an existing workspace succeeds');
eq(again.reused, true, 'the existing workspace is reused, never duplicated');
eq(again.workspace, wsA, 'recovery lands on the same deterministic workspace');
eq(git(wsA, ['rev-parse', 'HEAD']).out, committed, 'the work already committed there is untouched');
eq(again.base_commit, SPY_SEED_HEAD, 'recovery still reports the base the branch forked from');

// A workspace that is NOT the target — the case that would have written
// SPY code into mythos-prod — is refused on every resolution, including a
// reuse of a directory that was correct a moment ago.
var impostor = materialise('identity-flip', CONTROL_REMOTE, CONTROL_SEED);
refused(crossRepo.ensureWorkspace(reg, { repository: 'othoth77/spy', taskId: 'identity-flip', requested_action: 'implement', git: testGit }),
  crossRepo.CODES.TARGET_IDENTITY_MISMATCH,
  'a workspace that is actually the CONTROL repository is refused before anything is written');
ok(fs.existsSync(impostor), 'the refusal does not delete the directory it refused — a human inspects it');

var flipped = materialise('wrong-remote', 'git@github.com:othoth77/telegram-bot.git');
refused(crossRepo.ensureWorkspace(reg, { repository: 'othoth77/spy', taskId: 'wrong-remote', requested_action: 'implement', git: testGit }),
  crossRepo.CODES.TARGET_IDENTITY_MISMATCH,
  'a workspace whose origin is a third repository is refused');
ok(flipped.length > 0, 'the third-repository fixture existed');

var notGit = crossRepo.workspacePath(reg, 'othoth77/spy', 'not-a-checkout');
fs.mkdirSync(notGit, { recursive: true });
refused(crossRepo.ensureWorkspace(reg, { repository: 'othoth77/spy', taskId: 'not-a-checkout', requested_action: 'implement', git: testGit }),
  crossRepo.CODES.TARGET_WORKSPACE_UNAVAILABLE, 'a directory that is not a git checkout is refused');

var sub = path.join(wsA, 'nested');
fs.mkdirSync(sub, { recursive: true });
refused(crossRepo.verifyWorkspaceIdentity(reg, sub, 'othoth77/spy', testGit),
  crossRepo.CODES.TARGET_IDENTITY_MISMATCH, 'a subdirectory of the checkout is an ambiguous workspace and is refused');

// =====================================================================================
console.log('\n§9 the single-repository path is unchanged');

var orchestratorSchema = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'mythos-orchestrator', 'schemas', 'task.schema.json'), 'utf8'));
eq(JSON.stringify(orchestratorSchema.properties.repository.enum), JSON.stringify(['othoth77/mythos-prod']),
  'the orchestrator is still pinned to othoth77/mythos-prod — existing behaviour preserved, not widened');
eq(JSON.stringify(orchestratorSchema.properties.project.enum), JSON.stringify(['mythos-prod']),
  'the orchestrator project enum is unchanged');

var preSnapshot = {
  task_id: 'gh-issue-400', attempt_id: 'gh-issue-400#1', requested_action: 'implement', action_source: 'explicit_current_issue',
  execution_profile: 'repo-write', objective: 'x', scope: ['a'], constraints: [], validation_requirements: ['t']
};
eq(engine.attemptSnapshot(preSnapshot),
  engine.attemptSnapshot(Object.assign({}, preSnapshot, { target_repository: null })),
  'adding target_repository to the snapshot leaves every pre-474 hash unchanged');
ok(engine.attemptSnapshot(preSnapshot) !== engine.attemptSnapshot(Object.assign({}, preSnapshot, { target_repository: 'othoth77/spy' })),
  'a cross-repository attempt has its own immutable snapshot — a later edit of the target can be noticed');

var bridge = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'github-bridge.js'));
var bridgeTaskSchema = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'schemas', 'task.schema.json'), 'utf8'));
ok(bridgeTaskSchema.required.indexOf('target_repository') === -1,
  'target_repository is OPTIONAL on a control task — every existing task file stays valid');
ok(!!bridgeTaskSchema.properties.target_repository, 'the control task schema knows target_repository');

var plainTask = { task_id: 'gh-issue-400', requested_action: 'implement', objective: 'x' };
var brokenCfg = { targetsPath: path.join(TMP, 'nope.json') };
eq(bridge.preflight(brokenCfg, plainTask, null, null), null,
  'a task with no target_repository is unaffected even when the lane is unusable');
var crossTask = { task_id: 'gh-issue-474', requested_action: 'implement', target_repository: 'othoth77/spy' };
eq((bridge.preflight(brokenCfg, crossTask, null, null) || {}).code, 'TARGET_REGISTRY_UNAVAILABLE',
  'a cross-repository task on a host without the lane is BLOCKED, never run against the control repository');
var badTarget = { task_id: 'gh-issue-474', requested_action: 'implement', target_repository: 'othoth77/somewhere-else' };
eq((bridge.preflight({ targetsPath: REGISTRY_FILE }, badTarget, null, null) || {}).code, 'TARGET_REPOSITORY_UNAUTHORIZED',
  'an unauthorized target is BLOCKED in preflight — before a workspace, an OTHMODE record or a provider exists');
eq(bridge.preflight({ targetsPath: REGISTRY_FILE }, { task_id: 'gh-issue-474', requested_action: 'implement', target_repository: 'othoth77/spy' }, null, null), null,
  'an authorized target passes preflight');
eq(bridge.config().targetsPath, null,
  'the bridge reads the shipped registry by default — no environment override is in force');
ok(typeof bridge.resolveWorkspace === 'function', 'the bridge exposes the one place an attempt\'s workspace is decided');

// =====================================================================================
console.log('\n§10 an Issue can ASK for a target, and never grant one');

var issues = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'github-issues.js'));

var ISSUE_CFG = issues.config();
function taskFromIssue(body) {
  var c = issues.issueToTask(ISSUE_CFG, {
    number: 9474, title: 'TASK: cross-repo', body: body, user: { login: 'othoth77' },
    labels: [{ name: 'task' }], state: 'open', html_url: 'https://example.invalid/9474'
  }, 1);
  ok(c.errors.length === 0, 'the fixture Issue converts cleanly (' + c.errors.join('; ') + ')');
  return c;
}
var fromIssue = taskFromIssue('Action: implement\nTarget repository: othoth77/spy\n\n## Objective\n\nrun SPY V2 master task 1 in the delegated repository.\n');
eq(fromIssue.task.target_repository, 'othoth77/spy', 'an Issue may name the target repository');
eq(fromIssue.task.requested_action, 'implement', 'the action still comes from the action engine');

var backticked = taskFromIssue('Action: implement\nTarget repository: `othoth77/spy`\n\n## Objective\n\nrun SPY V2 master task 1 in the delegated repository.\n');
eq(backticked.task.target_repository, 'othoth77/spy', 'a backticked target repository is read as written');

var noTarget = taskFromIssue('Action: implement\n\n## Objective\n\nordinary control-repository work, no delegation at all.\n');
eq(noTarget.task.target_repository, undefined, 'an Issue that names no target produces an ordinary single-repository task');

var junk = taskFromIssue('Action: implement\nTarget repository: not a repo at all\n\n## Objective\n\nrun SPY V2 master task 1 in the delegated repository.\n');
eq(junk.task.target_repository, undefined, 'an unparseable target is dropped, never guessed at');
ok(/target repository: ignored/.test(junk.task.notes || ''), 'and the drop is recorded in the notes rather than being silent');

// The decisive property: naming a repository in an Issue asks for it. The
// server still decides, and an unauthorized one never runs.
var asksForForbidden = taskFromIssue('Action: implement\nTarget repository: othoth77/telegram-bot\n\n## Objective\n\ntry to reach a repository nobody authorized.\n');
eq(asksForForbidden.task.target_repository, 'othoth77/telegram-bot', 'an Issue may ask for any repository');
eq((bridge.preflight({ targetsPath: REGISTRY_FILE }, asksForForbidden.task, null, null) || {}).code,
  'TARGET_REPOSITORY_UNAUTHORIZED', '…and the bridge refuses it — asking is not granting');

// =====================================================================================
cleanup();
console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
