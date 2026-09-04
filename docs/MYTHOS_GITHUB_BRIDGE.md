# MYTHOS GitHub control bridge — `mythos-control/1`

**Stage:** MYTHOS-GITHUB-BRIDGE-0 (2026-09-02)
**Code:** `projects/mythos-ai-executor/bridge/github-bridge.js`, CLI `projects/mythos-ai-executor/bin/mythos-github-bridge`
**Suite:** `tests/mythos-github-bridge-test.js` (offline, mock provider, throwaway origin — 97 checks)
**Channel:** branch `mythos/control` of `othoth77/mythos-prod`, directory `control/` (protocol copy in `control/README.md`)

GitHub is the shared source of truth and the task/report channel between an
external planner (ChatGPT, the owner) and the MYTHOS execution system:

```text
ChatGPT → GitHub (control/tasks/<id>.json) → bridge → OTHMODE Task record + executor queue
        → Claude headless (othmode contract, profile-bounded) → tests → commit on mythos/gh/<id>
        → bridge → GitHub (control/reports/<id>.json) → ChatGPT reads → next task
```

## 1. What already existed and is reused (nothing rebuilt)

| Component | Role in the bridge |
|---|---|
| `projects/mythos-ai-executor` (executor.js, lib/state.js, providers/claude-code.js) | The **only** executor. The bridge calls `executor.createTask()` exactly like `bin/mythos-ai-executor enqueue`; the daemon's own `tick()` runs the task. Nothing in the executor changed. |
| Executor task schema, profiles (`lib/policy.js`), MCP capability gate | Every GitHub task becomes a normal executor task: same schema validation, same profile → tool allowlist, same `sudo` denial, same MCP registry → matrix → approval chain. |
| `projects/mythos-orchestrator/lib/{schema,redact,git}` | Task/report schema validation, secret-shape refusal and redaction of everything written to the control branch. |
| OTHMODE (`projects/command-center/reference/othmode/tasks.js`) | Each claimed task opens an OTHMODE Task record (`RUNNING`) before execution; the executing session updates it (the instruction names the id); the bridge closes it with the terminal status if the session did not. |
| `CLAUDE.md` per-command activation | The executor instruction opens with the standalone `othmode` keyword, so the headless session runs under the OTHMODE control contract (search-first, preflight/postflight, task record). |
| `mythos-git-push` relay (root, governance-verified, fast-forward only) | The only path to GitHub. It already delivers `refs/heads/mythos/*`; the control branch and every task branch are `mythos/*`. The bridge never pushes. |
| Executor runtime store (`~deploy/mythos-ai-executor/`) | Executor state, plus `bridge/` (claims cache, lock, events) and `worktrees/gh/<id>` (per-task worktrees). |

## 2. What was added

- `bridge/github-bridge.js` — sync, validate, claim, track, report, index, recovery (one module, ~900 lines).
- `bridge/schemas/task.schema.json`, `bridge/schemas/report.schema.json` — the two contracts (copied to `control/schemas/` on the branch).
- `bridge/README.md` — the protocol as published to planners (`control/README.md`).
- `bin/mythos-github-bridge` — `init | tick | daemon | status | validate <file> | instruction <file>`.
- `bridge/systemd/mythos-github-bridge.{service,timer}` — user units for `deploy`, one tick every 1 minute.
- `tests/mythos-github-bridge-test.js`.

## 3. GitHub paths

| Path (branch `mythos/control`) | Writer | Content |
|---|---|---|
| `control/tasks/<task_id>.json` | planner creates (PENDING) / bridge updates status, `execution`, `history` | TASK |
| `control/reports/<task_id>.json` + `.md` | bridge only | REPORT (terminal states) |
| `control/state.json`, `control/STATE.md` | bridge only | index: `pending`, `active`, `awaiting_review`, per-task rows |
| `control/schemas/*.json`, `control/README.md` | bridge `init` | contracts + protocol |
| branch `mythos/gh/<task_id>` | executing session (commits), relay (delivery) | the work itself, based on `origin/main` at claim time; **never merged automatically** |

The control branch is an **orphan** branch: it carries only `control/`. Raw read
(private repo, authenticated): `GET https://api.github.com/repos/othoth77/mythos-prod/contents/control/state.json?ref=mythos/control` with `Accept: application/vnd.github.raw+json`.

## 4. TASK protocol

Required: `protocol` (`mythos-control/1`), `task_id`, `project`, `objective`, `scope[]`, `constraints[]`,
`priority` (`low|normal|high`), `requested_action`, `validation_requirements[]`, `status`, `created_at`, `created_by`.
Optional: `depends_on[]`, `timeout_seconds` (60–21600), `max_turns`, `notes`, `model`. Bridge-owned: `execution`, `history`.

`requested_action` is the only execution lever and it is closed:

| requested_action | executor profile | expected delivery |
|---|---|---|
| `investigate`, `review` | `repo-read` (no Write/Edit, no sudo) | report |
| `test` | `repo-test` | report |
| `document`, `implement` | `repo-write` (acceptEdits, git allowed, no sudo) | commit on `mythos/gh/<id>` |

`model` (optional, Issue #100) is the one other value a task may set, and it is a *choice among
server-side entries*, not a string that travels to the CLI:

| `Model:` in the task / Issue | runs on | notes |
|---|---|---|
| `Haiku`, `Sonnet`, `Opus`, `Fable 5` (also `claude-sonnet-5`, `Sonnet 5`, `opus`…) | exactly that model | honoured as written, never substituted |
| `Fable 5.1` | — | refused at intake: not offered by the installed Claude CLI; flip `enabled` in `config/model-policy.json` when it is |
| anything else | — | refused at intake with the accepted values |
| *absent* | `haiku` / `sonnet` / `opus` chosen by `lib/model-policy.js` | the scored signals and the resulting model are on the task record, in the `model_selected` event, and in the REPORT |

Fable is `auto_selectable: false`: no scoring path can reach it, so it runs only when a task names it.
The executor always passes `--model`, so the Claude CLI's own ambient default is never what runs.

Never selectable from GitHub: provider, working directory, tools, MCP servers, skills, credentials,
the `autonomous` or `deploy` profiles. A task naming any of them fails schema validation (`additionalProperties:false`).
A task carrying a secret shape is rejected and the rewritten file is redacted. `task_id` must be lowercase
`[a-z0-9-]`, 6–40 chars, equal to the file name, and must not contain `credential|secret|.env|.ssh|sudoers`.

## 5. REPORT protocol

`task_id`, `status` (`COMPLETED|FAILED|BLOCKED|CANCELLED`), `summary`, `files_changed[]`,
`commits[] {sha, subject, branch, on_origin}`, `tests[]`, `validation {git_verified, remote_head, report_problems[], required_checks[]}`,
`problems[]`, `risks[]`, `next_recommended_action`, `completed_at`,
`execution {executor_task_id, othmode_task_id, execution_profile, provider, model, claude_session_id, started_at, ended_at, retries, quota_waits, cost_usd, worktree, branch, base_commit}`,
`delivery {branch, commits_on_origin, confirmed_on_origin_at?, note}`.

`commits` come from `git log <base_commit>..HEAD` in the task worktree, `files_changed` from the git diff
union the agent's structured report, `tests`/`summary`/`risks`/`next` from the executor's `mythos_report`
block, `validation` from the executor's `verifyGit`. `on_origin` is measured (`merge-base --is-ancestor`
against `origin/<branch>` after a fetch); when the report is written before the relay ran it says `false`
and a later tick rewrites it to `true` with `confirmed_on_origin_at`.

## 6. State machine

```text
PENDING → CLAIMED → IN_PROGRESS → VALIDATING → COMPLETED | FAILED | BLOCKED
PENDING | CLAIMED | IN_PROGRESS  --creator sets CANCELLED-->  CANCELLED
```

| Control status | Executor status | Meaning |
|---|---|---|
| PENDING | — | written by the creator |
| CLAIMED | QUEUED | validated, OTHMODE record open, worktree + branch created, executor task queued |
| IN_PROGRESS | RUNNING, WAITING_FOR_QUOTA, WAITING_RETRY | executing (quota waits are not failures; `execution.executor_status` shows which) |
| VALIDATING | terminal | report being assembled; persisted only if report generation failed (retried) |
| COMPLETED / FAILED / BLOCKED | COMPLETED / FAILED / BLOCKED | terminal, report exists |
| CANCELLED | CANCELLED | creator withdrew it; executor task cancelled (SIGTERM if running), report written |

Terminal is final; a creator may only ever write `PENDING` (new) or `CANCELLED`. A file that claims any
other status without a bridge claim is a forged state → `FAILED` with a validation report. Every
transition is appended to `history[]`.

## 7. Duplicate prevention and idempotency

1. **GitHub claim** — the task file's `status: CLAIMED` + `execution.executor_task_id` is the record.
2. **Executor-store marker** — every bridge task has `stage: github:<task_id>` and `requested_by: github-bridge`; before creating, the bridge scans the store for that marker.
3. **Local claims cache** — `~deploy/mythos-ai-executor/bridge/claims.json`, written immediately after `createTask()` for the window before the claim commit.
4. **Process lock** — `bridge/bridge.lock` (pid), so a timer tick and a manual tick cannot interleave; the executor daemon has its own lock and starts at most one task per tick.
5. **Rejection memo** — invalid files get a report keyed by content hash; unchanged invalid files are not re-reported.

Exactly one bridge instance per repository (the `deploy` timer on the VPS). `execution.claimed_by` names it.

## 8. Recovery rules

| Situation | Behaviour |
|---|---|
| bridge dies after `createTask()` but before the claim commit | next tick finds the executor task by marker → re-claims (`recovered: true`), no second task |
| bridge dies after the claim commit, before the relay | the commit is a local ref; the relay pushes it on its next 5-minute tick |
| executor/VPS restart during execution | executor's own recovery (RUNNING with dead pid → WAITING_RETRY → resume the same Claude session); bridge keeps IN_PROGRESS |
| local control branch and origin diverged (planner pushed while the bridge had a local commit) | bridge rebases its own never-pushed commits onto origin; conflict → abort, no claims that tick, logged |
| claim exists on GitHub but the executor record is gone (store/host loss) | task → `BLOCKED` with a report saying it was **not** re-executed; a human creates a new task |
| report generation throws | task stays `VALIDATING` with `execution.validation_problem`; retried every tick |
| `git fetch` fails | tick proceeds on the local view (status sync only), no new claims |

Everything is re-derivable from GitHub + the executor store; `/tmp` is never used.

## 9. How Fable/Claude consumes tasks

The bridge tick (`deploy`, every 1 min) validates the task, opens OTHMODE record `OTH-…`, creates
`~deploy/mythos-ai-executor/worktrees/gh/<id>` on branch `mythos/gh/<id>` from `origin/main`, and calls
`executor.createTask({ stage:'github:<id>', instruction, execution_profile, working_directory, branch, expected_delivery, report_to_git:false, … })`.
The executor daemon starts it on its next 15-second tick: `claude -p --session-id … --permission-mode … --allowedTools …`
in that worktree, with the executor's prompt template around the bridge instruction. The instruction opens with
`othmode`, names the OTHMODE record, and forbids `git push`, merging to main, and touching `control/`.
The session ends with the mandatory `mythos_report` JSON block; the executor persists it; the bridge turns it into the REPORT.

## 10. How ChatGPT (or any planner) uses the channel

1. Read `control/state.json` → `pending`, `active`, `awaiting_review`.
2. Read `control/reports/<id>.json` for each task awaiting review.
3. Write `control/tasks/<new_id>.json` (status `PENDING`) on branch `mythos/control` — GitHub web UI
   ("Add file" with the branch selected), the REST contents API (`PUT /repos/othoth77/mythos-prod/contents/control/tasks/<id>.json` with `"branch":"mythos/control"`), or any GitHub write tool.
4. Wait ~1 min for the claim, ~5 more for the relay to show it on GitHub, then poll for the report.
5. To withdraw: set `status` to `CANCELLED` in the task file. Never edit other fields of a claimed task (the executor keeps the snapshot it was given; the bridge notes the drift once).

No MCP access is needed from ChatGPT: the channel is plain files on a branch.

## 11. Example (the live smoke test, 2026-09-02)

Task `control/tasks/gh-20260902-bridge-smoke-01.json` (`implement`, "create docs/GITHUB_BRIDGE_SMOKE.md … commit … do not push"):

| Step | Evidence |
|---|---|
| planner commit on origin | `20c611a` on `mythos/control` (pushed by the relay) |
| bridge detected from origin | tick: `sync: fast-forwarded`, `claim gh-20260902-bridge-smoke-01 → t-20260902180610-c9x5d6` (claim commit `3d1a18a`) |
| OTHMODE | `OTH-2026-00022` opened RUNNING by the bridge, closed COMPLETED by the session itself (no duplicate record) |
| execution | executor task RUNNING at 18:06:10 → COMPLETED 18:07:00, profile `repo-write`, worktree `…/worktrees/gh/gh-20260902-bridge-smoke-01` |
| commit | `8a748454b35b4327a51760e7ba5372848d7841d8` `smoke(github-bridge): gh-20260902-bridge-smoke-01` on `mythos/gh/gh-20260902-bridge-smoke-01`; tests: `git status --porcelain` empty, `node --check executor.js` OK |
| report | `control/reports/gh-20260902-bridge-smoke-01.json` (commit `955910a`), `git_verified: true`, then `delivery.commits_on_origin: true` confirmed 18:08:33 after the relay |
| duplicate prevention | second and third ticks: no claim; claims cache deleted, tick: no claim; exactly one executor task carries `github:gh-20260902-bridge-smoke-01` |

## 12. Operate

```bash
# as deploy — one tick / status / validate a task offline
node projects/mythos-ai-executor/bin/mythos-github-bridge tick
node projects/mythos-ai-executor/bin/mythos-github-bridge status
node projects/mythos-ai-executor/bin/mythos-github-bridge validate control/tasks/<id>.json

# timer (user units, installed 2026-09-02)
systemctl --user list-timers | grep github-bridge
journalctl --user -u mythos-github-bridge -n 50
tail ~/mythos-ai-executor/bridge/events.log
```

Until `main` carries the bridge, the unit runs the binary from the mission worktree through the drop-in
`~/.config/systemd/user/mythos-github-bridge.service.d/worktree.conf` (`MYTHOS_BRIDGE_BIN`). After the merge,
delete the drop-in and `systemctl --user daemon-reload`.

## 12a. Timer schedule for a oneshot service (2026-09-03, gh-issue-134)

`mythos-github-bridge.service` is `Type=oneshot`; `mythos-github-bridge.timer` must therefore re-arm from the
service's **inactive** edge and must not carry `Persistent=`:

```ini
[Timer]
OnBootSec=1min
OnUnitInactiveSec=1min
AccuracySec=15s
```

Root cause of the 2026-09-03 stall (`SubState=elapsed`, `NextElapseUSecMonotonic=infinity`, Issues #133/#134 not
claimed): the previous unit had `OnUnitActiveSec=1min` **and** `Persistent=true`. `Persistent=` only has meaning for
`OnCalendar=`, but it still makes systemd load the last-trigger stamp
(`~/.local/share/systemd/timers/stamp-mythos-github-bridge.timer`) when the timer starts. With a stamp present the
already-elapsed `OnBootSec` mark is treated as a fired one-time trigger and disabled, and in a freshly started user
manager (`user@1001.service` restarted 16:52:59 UTC) the service has never run, so the unit-relative base does not
exist either → no next elapse at all. Reproduced with transient probes on the host: stamp + `Persistent=true` →
elapsed/infinity, never runs; the same stamp without `Persistent=` → fires at once and re-arms every ~65 s.
Invariants: `tests/mythos-github-bridge-timer-test.js`.

Activation on the host (owner/operator step, as `deploy`, after `main` carries this change; no `user@1001` restart):

```bash
cp projects/mythos-ai-executor/bridge/systemd/mythos-github-bridge.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user restart mythos-github-bridge.timer
systemctl --user show mythos-github-bridge.timer -p SubState,NextElapseUSecMonotonic   # waiting / ~1min
```

## 12a2. F1 push guard vs. multi-valued pushurl (2026-09-03, gh-issue-136)

`remote.<r>.pushurl` is multi-valued and additive across config scopes. Since the delivery relay keeps a
repository-level `remote.origin.pushurl = git@github.com:…` on the shared checkout, a task worktree's worktree-scoped
`no_push://governance-relay-only` no longer hides it: `git push` would deliver to both, and the old guard's
`git remote get-url --push origin` (first entry only) reported the SSH url → `PUSH_GUARD_FAILED` on every claim of
`gh-issue-136`. `applyPushGuard` now: (1) requires the worktree scope to hold exactly the no-push url — any other
worktree-level value is refused, never repaired; (2) neutralises every inherited push url with a worktree-scoped
`url.no_push://governance-relay-only.insteadOf=<url>` rewrite (refused if that url is also the fetch url); (3) proves
the COMPLETE effective set via `git remote get-url --push --all` and that the fetch url is unchanged. The shared
checkout keeps its SSH pushurl untouched. Tests: `tests/mythos-bridge-push-guard-test.js`.

## 12b. Pre-merge review fixes (2026-09-02, F1–F3)

| Fix | What changed | Test |
|---|---|---|
| **F1 push guard** | `ensureTaskWorktree` → `applyPushGuard`: enables `extensions.worktreeConfig` on the repository once, then sets `remote.origin.pushurl = no_push://governance-relay-only` **in the task worktree's own config** (`git config --worktree`). Push from a task worktree fails at transport level; fetch/ls-remote use the real URL; the shared checkout and the control worktree keep their push URL (the relay reads refs and needs nothing from them). A guard, not a hard floor: `git -c remote.origin.pushurl=… push` or an explicit URL still needs the protected `lib/policy.js` change (owner approval) to be impossible. | push fails, nothing lands on origin, fetch works, main checkout unchanged |
| **F2 OTHMODE closure** | The instruction now forbids the session from setting a terminal status; `othmodeFinish` is the sole closer and writes `outcome`, `git`, `changes`, `validation` (with tests), `evidence`, `problems` (with risks) and `execution` sections from the Git-verified report. A record the session closed early is detected (append-only store refuses the update); the REPORT then carries `problems: ["othmode: … closed … by the executing session before the bridge verified …"]`, `execution.othmode_closed_by_bridge: false`, and the task history says `CLOSED PREMATURELY`. | closure sections present; premature closure detected |
| **F3 user guard** | `userGuard()` at `tick`, `init`, `daemon`: refuses unless the process user is the executor user (`deploy`; `MYTHOS_BRIDGE_USER` only for isolated fixtures) with `BRIDGE_WRONG_USER: …`. | tick returns the error, init throws |

The smoke record `OTH-2026-00022` predates F2 and is the case F2 detects: it was closed by the session with no sections; its evidence is on `control/reports/gh-20260902-bridge-smoke-01.json`.

## 12c. GitHub Issues intake (2026-09-02)

`bridge/github-issues.js` turns open Issues labelled `task` into `control/tasks/gh-issue-<n>.json` (PENDING, with a
`source` block — the only schema addition) and posts created/claimed/report comments from the control files. The
bridge is unchanged; `tick` runs the Issues phases only when `MYTHOS_ISSUES_ENABLED=1` (deploy drop-in with the
token file bound by reference). Spec, Issue format and security: `docs/MYTHOS_GITHUB_ISSUES.md`.

## 12d. Action resolution v2 — invariant, immutable attempts, fencing, trail (2026-09-03)

`bridge/action-resolution.js` is now the single owner of `PROFILE_BY_ACTION` (the bridge re-exports it) and of
the decision record. What changed in the bridge itself:

| Point | Behaviour |
|---|---|
| Claim preflight | before any worktree/OTHMODE/executor: `ACTION_PROFILE_MISMATCH` (a recovered executor record with another profile) and `MODEL_UNAVAILABLE` (explicit model the host cannot run) end the task BLOCKED with a structured report and **no executor task**; not retried automatically |
| `execution` block | adds `attempt_id`, `action_source`, `action_raw`, `expected_profile`, `model_key`, `model_requested`, `model_source`, `model`, `snapshot_sha256`, `fence`, `lease`, `runtime` |
| Executor task | receives `task_category` (= action), `action_source`, `action_raw`, `attempt_id`; `executor.createTask` asserts the invariant and seals `snapshot_sha256`; `runTask` re-checks snapshot, invariant and model availability before spawning the provider |
| Report | adds `attempt_id`, `resolution`, `blocker`, `runtime_identity`, `structured_report`; markdown shows Attempt / Action / Blocker / Runtime |
| Lock | JSON record with `fence` (monotonic, `bridge/fence.json`), heartbeat, stale takeover after `MYTHOS_BRIDGE_LOCK_STALE_MS` (15 min); `commitControl` refuses a fenced-out worker (`STALE_WORKER`); legacy bare-pid locks still respected |
| Runtime identity | measured from the module path (`git rev-parse --show-toplevel/HEAD`), on every tick, claim and report; `MYTHOS_BRIDGE_EXPECTED_HEAD` / `MYTHOS_BRIDGE_STRICT_RUNTIME=1` |
| CLI | `trail <task_id>`, `runtime`, `resolve <issue.json\|N\|->` |

Task-schema additions (creator-visible, all optional): `action_raw`, `action_source`, `model_raw`, `model_source`;
`source.attempt_id`, `source.idempotency_key`, `source.resolution`, `source.truncated`, `source.events`.
Limits raised with explicit accounting: objective 20 000, notes 16 000, list items 2 000 chars (executor
instruction 64 000). Deployment order: adapter and bridge ship together on `main`; an older bridge would reject the
new optional fields, so do not run a mixed pair.

Tests: `tests/bridge-action-resolution-test.js` (engine), plus new sections in the bridge, Issues and executor suites
(cases A–V of the mission: every Action form, precedence, rerun inheritance/override, `implement → repo-write`,
`ACTION_PROFILE_MISMATCH`, explicit Fable 5.1, `MODEL_UNAVAILABLE`, long objective/notes, duplicate event, duplicate
claim, stale worker, structured report on COMPLETED/BLOCKED/permission denial, runtime identity mismatch, E2E
`## Action: implement` + `## Model: Fable 5.1` → `requested_action=implement` → `repo-write` → `claude-fable-5-1` →
provider → report).

## 12e. Reliability round 2 — retry policy, runtime gate, lease expiry, inheritance rule (2026-09-03, gh-issue-118-r2)

Second pass over Issue #118 on top of 12d. Reference patterns only (Temporal retry policies, Hatchet leases,
Trigger.dev idempotency, Svix delivery classification); **no external runtime or dependency**.

**Retry policy (executor, `lib/quota.js`).** Every provider failure is classified ONCE into a category, and the
category — not the stderr text — decides what happens next. The decision is durable: `status.last_failure
{category, code, retryable, timed_out, classified_at}`, `status.retry_backoff {attempt, max_retries, base_ms,
delay_ms, jitter, max_ms}` (transient only), `status.transition_reason`, plus a `failure_classified` event and a
`reason` on every `transition` event in `events.log`. The bridge copies `last_failure` / `retry_backoff` /
`transition_reason` into the report's `execution` block.

| Category | Detected by | State | Code | Retry |
|---|---|---|---|---|
| `quota` | usage/session limit | `WAITING_FOR_QUOTA` | — | same session resumes after the window (`RESET_GRACE_MS` after the stated reset, else `QUOTA_BACKOFF_MS` steps) |
| `transient` | 429/5xx/overloaded/network/timeout | `WAITING_RETRY` | — | exponential backoff `60 s × 4^n` capped at 30 min, **additive jitter** (`[base, 1.5 × base]`), bounded by `task.max_retries` (default 3); then `FAILED PROVIDER_FAILED` |
| `permission` | `permission denied/required`, tool/command denied, `EACCES` | `BLOCKED` | `PERMISSION_DENIED` | **never automatic** — a human grants or the task is re-scoped, then `rerun` |
| `governance` | `denied by policy/governance`, `governance-protected`, `protected path`, relay refusal, `ACTION_PROFILE_MISMATCH` / `ATTEMPT_SNAPSHOT_MUTATED` / `GOVERNANCE_DENIED` | `BLOCKED` | `GOVERNANCE_DENIED` | **never automatic** — a decision (re-scope, or the owner changes the rule), then `rerun` |
| `human` | billing, credential, `/login` | `BLOCKED` | `PROVIDER_BLOCKED` | never automatic |
| `permanent` | everything else | `FAILED` | `PROVIDER_FAILED` | never automatic; inspect `stderr.log`, re-queue explicitly |

Precedence when a message matches several: quota > governance > permission > human > transient > permanent. A
blocked structured report (`status: "blocked"`) is coded the same way (`classifyBlockedReport`: governance text →
`GOVERNANCE_DENIED`, permission text → `PERMISSION_DENIED`, else `HUMAN_APPROVAL`). Preflight refusals
(`ACTION_PROFILE_MISMATCH`, `MODEL_UNAVAILABLE`, `ATTEMPT_SNAPSHOT_MUTATED`) are recorded as `governance` with
`transition_reason: "preflight invariant <code> — refused before any provider started; never retried automatically"`.
The whole policy is exported as data (`quota.RETRY_POLICY`) so the docs and the code cannot drift silently.

**Runtime gate (bridge, `runtimeGate(runtime, cfg)`).** Pure function of the measured runtime identity and the
configuration; its result is on every tick (`runtime` action: `claims_allowed`, `gate_mode`), in the bridge log
(`runtime_identity`, `claim_deferred`) and in `mythos-github-bridge runtime` (`gate` block).

| Runtime code | Default | `MYTHOS_BRIDGE_STRICT_RUNTIME=1` |
|---|---|---|
| `RUNTIME_IDENTITY_UNVERIFIED` (cannot resolve checkout/HEAD) | **no new claims** — unless `MYTHOS_BRIDGE_ALLOW_UNVERIFIED_RUNTIME=1`, which is itself recorded on the claim | no new claims |
| `RUNTIME_IDENTITY_MISMATCH` (`MYTHOS_BRIDGE_EXPECTED_HEAD` names another HEAD) | **no new claims** | no new claims |
| `RUNTIME_STALE_CHECKOUT` (behind `origin/main`, normal between a merge and the restart) | claims continue, recorded on each claim/report | no new claims |

A refusal is a deferral, never a terminal state: the task stays PENDING with `defer {reason: "runtime:<code>",
detail}` on the tick and is claimed by the first tick whose runtime verifies. Progress/report phases continue
regardless (an unverifiable bridge may still deliver reports of attempts it already owns).

**Lease expiry (bridge).** Every claim carries `execution.lease {owner, fence, acquired_at, expires_at}`
(`timeout_seconds` + `MYTHOS_BRIDGE_LEASE_GRACE_MS`). When a non-terminal attempt outlives it, the progress phase
records it ONCE — `lease.expired_noted_at`, `lease.expired_executor_status`, a `LEASE_EXPIRED: …` history note, a
`lease_expired` log line and tick action — and does **not** re-claim or re-run: the executor owns recovery of its
own run (`INTERRUPTED → WAITING_RETRY`, quota resume). No duplicate execution can be born from an overrun.

**Inheritance rule (engine).** A rerun inherits a *decision*, never a default: the `inherited_previous_attempt`
candidate is `eligible: false` (with `ignored_reason`, kept in `source.resolution.action_candidates` and in the
task notes) when the previous attempt's `action_source` was `default` or absent (pre-engine record, unknown
provenance). The rerun then takes the configured default again, marked `action_source: "default"` — it never
looks decided when nothing was ever decided. Explicit `Action:` / `action:<x>` label in the current Issue still win.

Tests added: executor suite (categories, precedence, backoff bounds/cap/injected jitter, `RETRY_POLICY`, durable
`last_failure`/`retry_backoff`/`transition_reason`, `failure_classified` event, governance text → BLOCKED
`GOVERNANCE_DENIED` with zero retries, permanent and exhausted paths), bridge suite (cases W: `runtimeGate` and
the tick's `runtime:RUNTIME_IDENTITY_MISMATCH` deferral + log; X: lease expiry observed once, no re-claim),
engine suite (defaulted / unknown-provenance previous attempts are not inherited; decided ones are), Issues suite
(rerun of a defaulted attempt is defaulted again with the reason recorded).

## 12f. WhatsApp notifications (2026-09-02, stage `gh-20260902-wa-bridge-notify-01`)

An optional notification sink bolted to the side of the bridge. **Disabled by default**; full documentation
in [`docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`](MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md).

| Aspect | Behaviour |
|---|---|
| Trigger | a terminal REPORT with status `COMPLETED`, `FAILED` or `BLOCKED`. `CANCELLED` and every non-terminal state notify nothing. |
| `HUMAN_APPROVAL` | the notification kind for the bridge's existing blocked-for-a-human condition (claim exists, executor record gone). It is a *notification* concept only — the control status stays `BLOCKED` and `mythos-control/1` is unchanged. |
| Execution semantics | untouched. `finishTask()` only appends a durable ledger entry (local, synchronous, no network); delivery happens in `flushNotifications()` **after** `tick()` has returned. A gateway outage leaves the TASK and REPORT byte-identical and produces no control commit. |
| Provider | behind an adapter (`bridge/notify/providers/evolution.js`). Migrating to WAHA or the official WhatsApp Business Cloud API is a new file plus one line in the `PROVIDERS` map — `github-bridge.js` does not change. |
| Idempotency | durable ledger keyed `<task_id>__<KIND>` under `$MYTHOS_BRIDGE_HOME/notify/ledger/`, `O_EXCL` lock per key. Duplicate polling, concurrent ticks, concurrent processes and restarts all yield at most one successful message per recipient. |
| Secrets | credential read at send time from a `0600` file; never in the ledger, logs, reports, messages or CLI output. Gateway must be on a private network unless explicitly overridden. |
| CLI | `notify-config`, `notify-status`, `notify-flush`, `notify-test --confirm` (the only real-message path, human-invoked only). |
| Tests | `tests/mythos-bridge-whatsapp-notify-test.js` — 116 checks against a local fake gateway; no real message. |

Not done in this stage: the provider itself is **not deployed** and the one real smoke test is **not performed**
(no provider on the host, no Docker access for `deploy`, swap fully consumed). Both are the first steps of the
separate deployment task.

## 13. Honest limits

- Latency: claim within ~1 min, visible on GitHub after the next relay tick (≤5 min); report likewise.
- One bridge per repository; a second host running a bridge against the same branch would race on claims (the relay's fast-forward rule turns that into a skipped push, never a corrupted branch).
- Task branches accumulate under `refs/heads/mythos/gh/`; pruning merged/abandoned branches and worktrees is a human housekeeping step (`git worktree remove`, branch delete) — the bridge never deletes.
- The control branch is public to anyone with repository access; the bridge redacts what it writes, but a planner who pastes a secret into a task has already put it in GitHub history (the task is rejected, and the rewritten file is redacted).
- The push guard is worktree-scoped configuration; a session that deliberately overrides it (`-c remote.origin.pushurl`, explicit URL) is stopped only by the protected policy layer — recommended owner change: disallow `Bash(git push:*)` in `repo-write`/`repo-test`.
- A `document`/`implement` task whose agent forgets to commit ends COMPLETED with `validation.report_problems: ["delivery expected a commit but the report claims none"]` — visible, not hidden.
- WhatsApp notifications (§12c) are configured but unproven end to end: no provider is deployed, so the real send has never happened. The provider choice itself is provisional — it was made without outbound network access and its upstream facts are marked `TO-VERIFY`.
