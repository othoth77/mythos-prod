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
- `bridge/systemd/mythos-github-bridge.{service,timer}` — user units for `deploy`, one tick every 2 minutes.
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

The bridge tick (`deploy`, every 2 min) validates the task, opens OTHMODE record `OTH-…`, creates
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
4. Wait ~2 min for the claim, ~5 more for the relay to show it on GitHub, then poll for the report.
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

## 13. Honest limits

- Latency: claim within ~2 min, visible on GitHub after the next relay tick (≤5 min); report likewise.
- One bridge per repository; a second host running a bridge against the same branch would race on claims (the relay's fast-forward rule turns that into a skipped push, never a corrupted branch).
- Task branches accumulate under `refs/heads/mythos/gh/`; pruning merged/abandoned branches and worktrees is a human housekeeping step (`git worktree remove`, branch delete) — the bridge never deletes.
- The control branch is public to anyone with repository access; the bridge redacts what it writes, but a planner who pastes a secret into a task has already put it in GitHub history (the task is rejected, and the rewritten file is redacted).
- The push guard is worktree-scoped configuration; a session that deliberately overrides it (`-c remote.origin.pushurl`, explicit URL) is stopped only by the protected policy layer — recommended owner change: disallow `Bash(git push:*)` in `repo-write`/`repo-test`.
- A `document`/`implement` task whose agent forgets to commit ends COMPLETED with `validation.report_problems: ["delivery expected a commit but the report claims none"]` — visible, not hidden.
