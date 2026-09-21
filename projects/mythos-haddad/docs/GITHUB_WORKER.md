# Mythos Haddad — HAD-3: GitHub worker (isolated bridge instance)

**Status: working end to end and verified on `haddad`, 2026-09-21.** A real GitHub Issue is
claimed, executed by the local Qwen, validated and reported back as `COMPLETED`, unattended.
Production VPS behaviour is unchanged and verified by its own full suite.

## What this is

The **existing** MYTHOS GitHub Bridge and the **existing** executor, running on `haddad` as
`othman` against a completely separate store, so GitHub Issues labelled `mythos:haddad` are picked
up, executed by the local Qwen, and reported back — unattended. No new bridge, queue, executor,
workflow engine or model catalog was written.

```
GitHub Issue  (label: mythos:haddad)
  ↓  existing bridge  — mythos-haddad-bridge.timer, one tick per minute
  ↓  claim: deterministic id gh-issue-N, fenced lock, 6 idempotency layers
  ↓  executor.createTask(provider: openai-compat)
  ↓  existing executor daemon — mythos-haddad-worker.service, 20 s tick
  ↓  providers/openai-compat.js → 127.0.0.1:8600 → Qwen2.5-7B-Instruct Q4_K_M
  ↓  existing retry / timeout / INTERRUPTED-recovery / state machine
  ↓  bridge writes the report: Issue comment + haddad:* status label
  → next task
```

## Isolation from the production VPS

Every separation below is configuration of the existing bridge, not a code change:

| | VPS (unchanged) | Haddad |
|---|---|---|
| Intake label | `task` | **`mythos:haddad`** |
| Status label prefix | `mythos:` | **`haddad:`** |
| Control branch | `mythos/control` | **`mythos/control-haddad`** (local only) |
| Executor home | `~deploy/mythos-ai-executor` | **`~/mythos-ai-executor-haddad`** |
| Provider | `claude-code` / `delegate` | **`openai-compat` → local Qwen** |
| User | `deploy` | `othman` |

**Verified:** the VPS filter (`label=task`) does not return the Haddad test issue, and the Haddad
filter returns only it. Neither instance can see the other's work.

### Why the status prefix is `haddad:` and not `mythos:`

This one is load-bearing and non-obvious. `setStatusLabel` adds the wanted status label and
**deletes every other label sharing the prefix**. With the default `mythos:` prefix and an intake
label of `mythos:haddad`, the first status update would delete `mythos:haddad` itself — and the
next tick reads a missing intake label as *"cancelled from the Issue side"* and kills the task.
Reproduced against the real logic before this was configured; `haddad:` keeps the two namespaces
disjoint, so the intake label survives and the VPS's `mythos:*` labels are never touched.

### Why the control branch stays local

The bridge never pushes — on the VPS a root relay delivers the control branch. Haddad has no such
relay, and `syncControl` treats *"branch not on origin yet"* as a normal, healthy state. The
GitHub-visible record is the Issue comments, which go over the API directly. The control branch is
the bridge's own crash-recovery journal and is correct as a local branch.

## The one code change

`bridge/github-bridge.js` provider selection, env-gated and allow-listed:

```js
var WORKER_PROVIDER_ALLOWED = ['openai-compat', 'free-llm-pool'];
…
: (WORKER_PROVIDER || (task.lane ? 'delegate' : 'claude-code'));
```

With `MYTHOS_BRIDGE_WORKER_PROVIDER` unset — the production case — this is **character-for-character
the previous behaviour**. Only advisory providers (no execution authority) are reachable, so a
mis-set variable can never hand a GitHub Issue shell access; an out-of-list value throws at load.
All 485 existing bridge tests pass unchanged.

`config/projects.json` gains one additive `mythos-haddad` entry (no existing entry modified).

## The invariant conflict, and the minimal change that resolved it

The first live run ended `BLOCKED` with `ACTION_PROFILE_MISMATCH`. Two existing guards contradicted
each other, and **both were right**:

| Guard | Says |
|---|---|
| `executor.js` (`createTask`) | An advisory provider gets **no** working directory and **no** execution profile — *"they reason, they do not act"* (mission §9). So `execution_profile` becomes `null` **because** the provider is safe. |
| `action-resolution.js:321-341`, asserted in **two** places — the bridge's `preflight()` and the executor's own `preflightBlocker()` | `investigate` requires `repo-read`; anything else, `null` included, is refused before a provider starts. |

### Why this was a real conflict and not a bug

An **execution profile is a tool grant**. `lib/policy.js` turns it into claude-code's
`--allowedTools` / `--disallowedTools` and nothing else — its own header says the profile layer
*"only shapes claude-code invocations"* and that *"advisory providers get no tools at all"*.
`providers/openai-compat.js` has no tools, no `tool_calls`, no `spawn`, no `child_process`: it
*"can only turn a prompt into text"*. Verified by inspection, not assumed.

So for such a provider `null` is **not a missing grant — it is the empty grant**, which is strictly
stronger than the `repo-read` the check demanded. The guard was requiring a *weaker* constraint
than the one already in force.

### The change (two call sites, ~8 lines each)

Both gates now skip the action↔profile check **only** when all of these hold, resolved from the
executor's own `PROVIDERS` map and never trusted from the task file:

1. the recorded `execution_profile` is exactly `null`, **and**
2. the provider is one the executor actually knows, **and**
3. that provider's `executionAuthority` is not `true`.

Anything else takes the unchanged path. `checkActionProfile` itself — the shared pure function the
VPS depends on — was **not** touched.

### What is still enforced (each with a negative test)

- an execution-authority provider with a `null` profile is **still refused** — the case the guard
  exists for;
- an **unknown** provider is never exempt (fail closed);
- any **non-null** profile is always checked, advisory or not;
- a wrong profile on an execution provider is still a mismatch;
- the exemption is unreachable from the task file alone (an empty `PROVIDERS` map exempts nothing);
- without the executor reference, nothing is exempted.

### What this does *not* do

It does **not** give Qwen execution authority. Qwen still cannot edit a file or run a command —
not because a flag forbids it but because **nothing in the `openai-compat` path can execute
anything**. Making `executionAuthority: true` would hand it a working directory and a profile that
no code reads: a weakened invariant for zero capability. Real local execution would need a
tool-execution loop that does not exist today; that remains a separate, deliberate decision.

**Haddad therefore runs read-only actions** — `investigate`, `review`, `test` — end to end,
unattended. `document` / `implement` expect a commit and would report a delivery problem.

## systemd (user units, `othman`, no root)

| Unit | Type | Cadence |
|---|---|---|
| `mythos-haddad-worker.service` | `simple`, `Restart=on-failure`, `RestartSec=15`, `MemoryMax=1G` | executor daemon, 20 s tick |
| `mythos-haddad-bridge.service` | `oneshot`, `TimeoutStartSec=600`, `MemoryMax=512M` | one bridge tick |
| `mythos-haddad-bridge.timer` | `OnBootSec=2min`, `OnUnitInactiveSec=1min` | re-arms only after a tick finishes, so ticks never overlap |

`Persistent=` is deliberately absent from the timer: the VPS timer carries a post-mortem showing
that with it set, a user-manager restart left the timer at `NextElapse=infinity` and polling
silently stopped. Lingering is already enabled for `othman`, so both survive logout and reboot.

## Setup and first task

```bash
# once: token with Issues read+write, 0600, never committed
umask 077; printf 'MYTHOS_GITHUB_ISSUES_TOKEN=%s\n' '<PAT>' > ~/.config/mythos-haddad/github-issues.env
bash projects/mythos-haddad/bin/haddad-worker-setup.sh
```

Send a task — open an Issue labelled **`mythos:haddad`** (and *not* `task`):

```markdown
## Objective
One paragraph: what must be true when this is done.

## Constraints
- Read-only. No file edits, no commits.

## Validation
1. …

Action: investigate      (investigate | review | test — read-only actions only, see below)
Priority: normal
Timeout: 600
```

**Read-only actions only.** Qwen is advisory: it cannot run a command, edit a file or commit.
`document`/`implement` expect a commit and would report a delivery problem.

## Operation

```bash
systemctl --user list-timers mythos-haddad-bridge.timer
journalctl --user -u mythos-haddad-bridge -n 40
journalctl --user -u mythos-haddad-worker -n 40
node projects/mythos-ai-executor/bin/mythos-github-bridge trail gh-issue-<N>   # full audit chain
```

Task states on the Issue: `haddad:queued` → `haddad:in-progress` → `haddad:completed` /
`haddad:failed` / `haddad:blocked`. Nothing is retried automatically after a terminal state; add
the `rerun` label to run again as a new attempt.

## Rollback

```bash
systemctl --user disable --now mythos-haddad-bridge.timer mythos-haddad-worker.service
rm -f ~/.config/systemd/user/mythos-haddad-{worker,bridge}.service ~/.config/systemd/user/mythos-haddad-bridge.timer
systemctl --user daemon-reload
rm -rf ~/mythos-ai-executor-haddad ~/.local/state/mythos-haddad/control
git worktree prune
```

Nothing on the VPS is affected by any of this.

## Verified on `haddad` (2026-09-21)

| Check | Result |
|---|---|
| Real GitHub task, end to end, unattended | Issue #335 → claimed by the timer with no manual tick → executor task `t-20260921102118-y0rvkw` → report comment + label, ~2 min |
| Intake label survives status updates | `mythos:haddad` still present after `haddad:in-progress` |
| VPS cannot see Haddad work | `label=task` filter does not return #335 |
| Haddad sees only its own | `label=mythos:haddad` returns only #335 |
| Duplicate execution prevented | a second tick created no second task (1 task dir) |
| Worker restart | `systemctl --user restart` → active, state intact |
| State persistence | task tree on disk survives restart |
| Existing tests | 515 passed, 0 failed across 8 suites (incl. all 485 bridge tests) |
| Terminal status | **COMPLETED** — Issue #338, real answer from Qwen, no blocker |
| Existing tests after the change | 924 passed, 0 failed across 10 suites, incl. the full 395-check executor suite and all 446 bridge checks |
