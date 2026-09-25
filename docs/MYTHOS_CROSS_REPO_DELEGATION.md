# Cross-repository delegation — the `othoth77/spy` lane

Stage: **gh-issue-474** (2026-09-25). Removes the blocker reported by
gh-issue-473.

## The problem this lane exists for

The MYTHOS GitHub bridge could only ever execute inside a worktree of its own
checkout:

- `bridge/github-bridge.js` → `ensureTaskWorktree()` runs `git worktree add`
  against `cfg.repo`, which is the `othoth77/mythos-prod` checkout;
- `projects/mythos-orchestrator/schemas/task.schema.json` pins `repository` to
  the single-value enum `["othoth77/mythos-prod"]` and `project` to
  `["mythos-prod"]`;
- `projects/mythos-delegate` is repository-path agnostic, but nothing resolved a
  path for any repository other than the control one, and no checkout of
  `othoth77/spy` existed on the host.

So a task whose work belonged in a different repository had nowhere to run.
gh-issue-473 is what that looks like from the outside: an objective that says
"implement" executed as an `investigate` / `repo-read` attempt that could not
have delivered anything.

## What was built

One module, one closed allowlist, one optional field on a control task.

```text
control/tasks/<id>.json        target_repository: "othoth77/spy"   (optional)
        │
bridge/github-bridge.js        preflight()        → authorization, before anything exists
        │                      resolveWorkspace() → the ONE place a workspace is decided
        ▼
projects/mythos-delegate/lib/cross-repo.js
        │  allowlist → deterministic path → identity proof → push guard
        ▼
/home/deploy/mythos-ai-executor/delegate-workspaces/othoth77__spy/<task-id>
        on branch mythos/spy/<task-id>
```

| File | Role |
| --- | --- |
| `projects/mythos-delegate/config/targets.json` | the CLOSED allowlist of authorized targets |
| `projects/mythos-delegate/lib/cross-repo.js` | the lane: authorize, resolve, verify, contract |
| `projects/mythos-delegate/bin/mythos-delegate` | `targets`, `authorization`, `workspace`, `contract` |
| `bridge/schemas/task.schema.json` | the optional `target_repository` field |
| `bridge/github-bridge.js` | consults the lane only for a task that names a target |
| `bridge/action-resolution.js` | the `TARGET_*` blocker codes; `target_repository` in the attempt snapshot |
| `tests/mythos-delegate-cross-repo-test.js` | 133 offline assertions |

### 1. The target is explicit, and the allowlist is closed

`config/targets.json` lists `othoth77/spy` by name. There is no wildcard, no
pattern, no environment variable that adds a repository. A target that is not
spelled out there is `TARGET_REPOSITORY_UNAUTHORIZED`, and the refusal happens
in `preflight()` — before a workspace, before the OTHMODE record, before a
provider. The control repository is refused as a target by construction: the
registry will not even load if it is listed, and `authorize()` refuses it again
at request time.

`target_repository` on a control task is the same kind of choice as `model`
(Issue #100) and `lane` (MYTHOS V1): it selects an entry in a server-side
catalog and **grants no authority whatsoever**. The execution profile still
comes from `requested_action`, the workspace path is computed server-side and
can never be supplied, and an unknown value is a refusal, never a substitution.

### 2. The workspace is deterministic, and it is isolated

```text
<workspaces_root>/<owner>__<repo>/<task-id>
```

A pure function of the registry root, the repository and the task id, so the
same attempt always lands in the same directory and a re-claim after a crash
finds the work that is already there. `workspaces_root` is validated to be an
absolute path **outside this repository** — target-repository files and
control-repository files can never share a tree, so target code can never reach
a control commit. Task ids are sanitised and the result is proven to be
contained in the root, so no traversal escapes it.

### 3. The identity is proven, never assumed

A path is a claim. Before anything is written — on a fresh clone *and* on every
reuse — the lane reads the checkout's own `origin` remote and its toplevel and
refuses unless both agree with the authorized target. A workspace that is
actually the control repository, a third repository, a non-checkout, or a
subdirectory of a checkout is `TARGET_IDENTITY_MISMATCH` and nothing runs.

`othoth77/spy`'s default branch is **`master`**, not `main`. The registry states
it; the lane never assumes.

### 4. The contract distinguishes `implement` from `investigate`

`mythos.delegate.task.v1` (`buildDelegatedTask` / `validateDelegatedTask`)
carries, in one inspectable place: target repository, target branch, workspace,
requested action, execution profile, task id, delivery, acceptance criteria,
test requirements, deployment requirements and lane.

The action → profile map is **imported** from `bridge/action-resolution.js`,
the one existing source of truth — restating it is how the two drifted apart in
the first place. Both directions of the gh-issue-473 mismatch are refused:

- a `repo-read` payload that requires a commit → `ACTION_PROFILE_MISMATCH`;
- an `implement` payload that requires no commit → `ACTION_PROFILE_MISMATCH`
  ("an implementation that delivers nothing");
- an implementation payload with no acceptance criterion or no test requirement
  → `TARGET_CONTRACT_INVALID`;
- a workspace that is not the deterministic one → `TARGET_WORKSPACE_UNAVAILABLE`
  (ambiguous routing);
- a branch without the target's prefix, or the target's default branch →
  `TARGET_CONTRACT_INVALID`.

### 5. Blocker codes

All are non-retryable: retrying cannot authorize a repository, cannot make a
wrong checkout right, and cannot grant a delivery nobody authorized.

| Code | Meaning |
| --- | --- |
| `TARGET_REGISTRY_UNAVAILABLE` | the lane is not usable on this host |
| `TARGET_REPOSITORY_MISSING` | a cross-repo task named no target — never defaulted to the control repo |
| `TARGET_REPOSITORY_UNAUTHORIZED` | not on the allowlist, unparseable, or the control repository |
| `TARGET_ACTION_NOT_ALLOWED` | the action is not authorized for that target |
| `TARGET_DELIVERY_NOT_AUTHORIZED` | a push was required that the target does not authorize |
| `TARGET_WORKSPACE_UNAVAILABLE` | no checkout, no base commit, or ambiguous routing |
| `TARGET_IDENTITY_MISMATCH` | the directory is not the repository it claims to be |
| `TARGET_CONTRACT_INVALID` | the `mythos.delegate.task.v1` payload is not usable |

## GitHub authorization — what is granted, and the one owner step

No credential is hard-coded, read, stored or passed anywhere in this lane. The
host's own Git identity (the executor user's SSH key/agent) authenticates.

```bash
node projects/mythos-delegate/bin/mythos-delegate authorization --repository othoth77/spy
```

| Capability | Granted today | How |
| --- | --- | --- |
| read / clone | **yes**, verified | `git ls-remote --heads git@github.com:othoth77/spy.git` resolves from this host |
| create a branch | **yes** | inside the delegated workspace only, always prefixed `mythos/spy/` |
| commit | **yes** | inside the delegated workspace only, on the prefixed branch |
| push | **no** | see below |
| create / update a PR | **no** | never performed by this lane, for any target |

### The one external dependency

`push_enabled` is `false` for `othoth77/spy`, and that is the **only** part of
this work that a human still has to resolve. The reason is structural, not a
missing credential: the governance relay (`mythos-git-push.timer`, root-owned,
fast-forward only) delivers `refs/heads/mythos/*` of the **control** repository.
Nothing delivers another repository, and this lane will not invent a delivery
path — extending the relay is a governance change, made deliberately and by the
owner, never as a side effect of a task.

While `push_enabled` is false the lane actively installs a **no-push guard** on
the workspace remote (repository-scoped `remote.origin.pushurl` =
`no_push://owner-authorization-required`, plus an `insteadOf` rewrite that
neutralises any inherited value, proven afterwards on the complete effective
push set). An instructed or accidental `git push` from a delegated workspace
therefore cannot reach GitHub, while `fetch` keeps working.

**Owner step, when a delegated branch is ready to land:**

1. Review it in the workspace:
   `git -C /home/deploy/mythos-ai-executor/delegate-workspaces/othoth77__spy/<task-id> log --stat master..mythos/spy/<task-id>`
2. Either push that branch with the owner's own identity, **or** set
   `push_enabled: true` on the target in `projects/mythos-delegate/config/targets.json`
   once a delivery path for `othoth77/spy` has been agreed.

Everything else — authorization, workspace resolution, identity proof, branch
creation, commits, the payload contract, the tests — works today with no human
in the loop.

## Operating it

```bash
# which repositories are authorized, and on what terms
node projects/mythos-delegate/bin/mythos-delegate targets

# what GitHub access is needed, and the one owner-only step
node projects/mythos-delegate/bin/mythos-delegate authorization --repository othoth77/spy

# resolve (and, with --clone, create) the deterministic workspace
node projects/mythos-delegate/bin/mythos-delegate workspace \
  --repository othoth77/spy --task spy-v2-master-1 --action implement --clone

# build and validate the delegated payload
node projects/mythos-delegate/bin/mythos-delegate contract \
  --repository othoth77/spy --task spy-v2-master-1 --action implement \
  --accept "…" --test "…"

node tests/mythos-delegate-cross-repo-test.js     # 133 assertions, offline
```

Host configuration (never task-selectable):

| Variable | Effect |
| --- | --- |
| `MYTHOS_DELEGATE_TARGETS` | which allowlist file is in force (the allowlist stays closed) |
| `MYTHOS_DELEGATE_ALLOW_CLONE=1` | let the bridge clone an absent workspace itself; without it an absent workspace is reported with the exact `git clone` command |

## Using the lane for SPY V2 Master Task #1

Create the GitHub Issue/control task as usual, with `Action: implement`, and
give the task file `"target_repository": "othoth77/spy"`. The bridge then:

1. authorizes the target in `preflight()` — an unauthorized one never starts;
2. resolves `/home/deploy/mythos-ai-executor/delegate-workspaces/othoth77__spy/<task-id>`,
   proves it is `othoth77/spy`, and checks out `mythos/spy/<task-id>`;
3. records `target_repository` in the attempt record **and** in the immutable
   attempt snapshot, so a later edit of the control file can be noticed;
4. passes that workspace to the executor as `working_directory`, so the provider
   runs there and nowhere else;
5. tells the worker, in its own prompt, that this is a cross-repository
   delegation: work only in that workspace, never touch the control repository,
   never push, commit on the prefixed branch.

The delivery of the resulting branch is the owner step above.

## What this lane must never become

- An unrestricted arbitrary-repository executor. The allowlist is closed and
  each entry is a deliberate decision with `authorized_by` / `authorized_at`.
- A way to widen authority. A target grants a **workspace**. It never grants a
  profile, a model, a tool or a permission.
- A second delivery path. It does not push, merge, or open pull requests.
- A place for a credential.
