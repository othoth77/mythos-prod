# MYTHOS AUTOPILOT — eliminating repetitive manual operations

**Stage:** AUTOPILOT-0 · **Date:** 2026-09-04 · **Branch:** `mythos/autopilot-20260904` over `4ffb8d2` (`origin/main`)
**Principle:** any operation that recurs by hand and can be done safely, deterministically and fail-closed becomes automation
inside MYTHOS; human approval stays only for high-risk or irreversible decisions. *Othman manages exceptions and decisions,
not repetitive operations.*

This document is the audit (§1), the reference-pattern study (§2), the automation matrix (§3), the boundary (§4), the
implementation (§5–§12) and the operating manual (§13). It maps every capability onto the four levels already defined in
`docs/AUTOMATION_ARCHITECTURE.md` §2 (LEVEL_1 READ_ONLY … LEVEL_4 FULL_AUTOMATIC) and the lifecycle of §3
(DISCOVER → … → GATE_CHECK → APPROVAL → APPLY → VERIFY → AUDIT); it does not invent a parallel scale. The permanent
boundaries of `docs/AUTOMATION_APPROVAL_MATRIX.md` §2 are a floor here, never relaxed.

> Dated note: the four AUT-0 documents (2026-08-06) still say "no automation runs yet". Nine timers run today
> (`mythos-git-push`, `mythos-session-guard`, `mythos-status-monitor`, six backup/restore timers, plus the deploy-user
> `mythos-github-bridge.timer`). This document is the first one to reconcile that statement with the host.

---

## 1. Manual operations inventory (measured, not assumed)

Method: four read-only audits of `origin/main` at `4ffb8d2` (delivery path, executor/bridge lifecycle, tests/status/evidence/
worktrees, guards/hostops/policy), plus host measurements. Evidence is `path:line` in the repository or a live measurement.

| # | Operation | Evidence that it recurs by hand | Existing automation |
|---|---|---|---|
| M1 | **Fast-forward the shared checkout `main` to `origin/main` after every GitHub merge** | `git reflog show main`: **12 hand fast-forwards in 48 h** (2026-09-02 22:19 → 2026-09-04 10:11, "merge origin/main: Fast-forward" / "pull --ff-only"). `docs/AI_HANDOVER.md:307` ("on the shared checkout, operator shell"), `:309` ("2 behind … the relay reports it every tick"). The relay `service/mythos-git-push.sh:64,74,77` is **push-only**: it fetches to compute ancestry and never merges. | None. `ops/vps-admin/mythos-deploy:155` can ff but is root, manual, nginx-scoped, on no timer. |
| M2 | **Restart `mythos-ai-executor` after a merge** so the daemon loads the code it ExecStarts from | `AI_HANDOVER.md:64,109,194,248,271`; `MYTHOS_HOSTOPS_INTERFACE.md:159,264,285,319`; `CHANGELOG.md:121`. Measured: executor pid 688556 started 2026-09-03 16:52:59 while `main` was `85cbf90`; checkout is `4ffb8d2` — **the running daemon is 7 fast-forwards behind the disk** and nothing reported it. | None. No CLI verb, no route, no unit hook. `hostops-allowlist.json:29,32` lists the executor as never-restartable. |
| M3 | **Detect drift between GitHub / disk / running executor / bridge** | `scripts/production-sync-audit.sh:8-11,128` — read-only, text output, on no timer; covers checkout-vs-origin and a start-time heuristic for two services. The bridge has `runtimeIdentity()` (`bridge/github-bridge.js:199-243`) for **itself** only. The executor's `/health` carries no code identity (`executor.js:1330-1359`). | Partial, unscheduled, unsurfaced. |
| M4 | **Re-run root installers** so `/usr/local` copies match merged code (relay, verifier, session guard, hostops) | `MYTHOS_SESSION_GUARD.md:274`; `AI_HANDOVER.md:62,109,191`; `mythos-git-push.sh:23-26`. | Installers idempotent, invocation human. |
| M5 | **daemon-reload / timer (re)activation after unit edits** | `mythos-governance-harden.sh:99-100`; `install-session-guard.sh:78-79`; the 2026-09-03 bridge-timer stall (`bridge/systemd/mythos-github-bridge.timer:10-16`). | Folded into installers only. |
| M6 | **Enable-marker flips (observe → enforce)** | `AI_HANDOVER.md:65-66,134`; `MYTHOS_SESSION_GUARD.md:283-284`. | By design manual; nothing lists which markers are still unset. |
| M7 | **`sudo mythos-governance-approve` per protected commit** | `service/mythos-governance-approve.js:25-27,89-92,133`. | Verification automatic; granting root+human by design. |
| M8 | **Approval-record group repair (`chgrp mythos-gov`)** | `mythos-governance-approve.js:52-60`; now converged by `:198-203` and `mythos-governance-harden.sh:87-91`. | Closed upstream. |
| M9 | **Task reconciliation / stuck detection** | `status.daemon_pid` is written (`executor.js:601`) and **never read**; the only executor-side recovery is INTERRUPTED→WAITING_RETRY (`executor.js:1027-1037`); bridge lease expiry is note-only (`github-bridge.js:1566-1577`); no age-based staleness; corrupt `status.json` reads as `{}` (`lib/state.js:127-131`). | Partial. |
| M10 | **Worktree / branch cleanup** | `MYTHOS_GITHUB_BRIDGE.md:366` ("the bridge never deletes"). Measured: **85 worktrees, 50 task branches, none ever removed**; only `git worktree remove` in the tree is dead code (`core/worktrees.js:87`). | None. |
| M11 | **Choosing and running tests** | No root `package.json`, no runner, no `tests/README`; `projects/meta/test-impact-map.json` (2026-08-08) has **zero rules** for the executor, bridge, issues, governance, lifecycle, guards, hostops, status-center, othmode, whatsapp, `ops/` — every real change hits `HIGH_RISK / FULL_SUITE_REQUIRED`; ~90/153 suites test source **text**, invisible to a require-graph. `tests/erp-acceptance-test.js:35-36` has no production-DB guard in the JS. | Map exists, empty for the core; no generator. |
| M12 | **Evidence / handover** | `docs/AI_HANDOVER.md` is 100 % hand-typed (Branch / base / worktree / per-suite counts / Installed / Next stage) although every field exists structurally in `control/reports/*.json`, `gitfacts.js`, `bridge/buildReport()`. | Per-task evidence excellent; nothing aggregates or re-derives. |
| M13 | **Repeated status / VPS checks** | Status Center monitor: 22 probes, **no** SHA, deployment, drift, task or worktree probe (`monitor.js:273-282`); OTHMODE `GET /api/othmode/status` mirrors it. Owners and agents re-measure by hand each session (`AGENTS.md` §5 preflight). | Probe framework exists; no operational-state feed. |
| M14 | PR creation / merge | `DEVELOPMENT_WORKFLOW.md:29`; `gh` not installed on the host. | Human by design (kept). |
| M15 | Static-site / webroot rsync | `DEPLOYMENT_READINESS.md:49`; `production-sync-audit.sh:118`. | Manual; out of scope here (privileged deploy). |

---

## 2. Reference patterns studied (Search First)

No project below was added as a dependency. Patterns only.

| Project | Studied | Adopted | Rejected / not applicable | Why |
|---|---|---|---|---|
| **GitHub Actions** | `concurrency` groups (`queue: single` by default, `cancel-in-progress`), environments + deployment protection rules (required reviewers, wait timer, branch restrictions, admin-bypass switch), deployment history | Per-operation concurrency group semantics → `lock.js` (second caller skips, no queue); "required reviewer bound to one deployment" → restart approval bound to one SHA, one use; deployment history → `restart/requests/<sha>.json` with full `history[]` | `cancel-in-progress` (a reconciler never cancels a running mutation); GitHub Environments themselves (host has no `gh`, the VPS runner is read-only by design, `.github/` is governance-protected) | The house already runs delivery on the host; the semantics transfer, the service does not. |
| **Renovate** | continuous discovery → lookup → "is a branch/PR already there?" before creating → policy gating (automerge, schedules, stability days) | Idempotent discovery: sync is NOOP when synchronized, restart request keyed by SHA returns the existing record, worktree plan re-verified before every removal; "stability" → `min_age` on worktrees (24 h) | Automatic PR generation (merge stays human, `DEVELOPMENT_WORKFLOW.md:29`) | Renovate's core lesson is dedupe-before-act; adopted verbatim. |
| **systemd** | `Restart=on-failure` vs `always`, `RestartSec`, `StartLimitBurst`, `WatchdogSec` + `sd_notify WATCHDOG=1`, `Type=notify`, timer stamps | Oneshot-per-tick service (fresh process = current code, like the bridge); no `Persistent=` on relative timers (the 2026-09-03 stall); restart verification = wait for health **and** identity, single attempt, then stop (the "start limit" idea applied to governed restarts) | `WatchdogSec` for the executor: requires editing `service/mythos-ai-executor.service` (governance-protected path) and Node has no native unix-dgram for `sd_notify`; recorded as **recommended next** (§14) with an approval | The hung-but-alive daemon remains undetected by systemd; the autopilot detects it via `/health` instead. |
| **Temporal** | retry policy fields (initial interval, backoff coefficient, max interval, max attempts, non-retryable errors); determinism: retry activities, never whole workflows | Non-retryable classification: a FAILED restart is terminal for that approval (never auto-retried); every autopilot step is a pure `inspect → plan → apply` with the mutation isolated in one function | Durable workflow engine | The existing `quota.classifyOutcome` + `WAITING_RETRY` backoff already implement the activity-retry model; nothing rebuilt. |
| **Hatchet** | concurrency keys, `GROUP_ROUND_ROBIN`, `CANCEL_NEWEST`, fairness | `CANCEL_NEWEST` semantics for the tick lock (protect in-progress work, drop the newcomer) | Fair queues | A reconciler has one consumer. |
| **Trigger.dev** | `wait.forToken()` human-in-the-loop, token timeout (10 min default), idempotency keys on retry | Approval = a durable token completed out-of-band (file record), with expiry (24 h) and consumption (`consumed_at`/`consumed_by`), so a retry never re-approves | Public completion URLs | The house approval model (`lib/mcp-invoke.js:79-94`) already has `action_class` + `consumed_at` + max-age; the restart approval mirrors it. |
| **Svix** | retry schedule (immediate, 5 s, 5 m, 30 m, 2 h, 5 h, 10 h, 10 h), only 2xx = success, `message.attempt.exhausted`, endpoint auto-disable after persistent failure, manual replay | Failure classification into "provider-level vs message-level" is already in the WhatsApp breaker (WA-PROVIDER-1); the watchdog's `first_seen/count` stamps are the "attempt exhausted" signal without re-notifying each tick | Dead-letter queue as a store | Notification ledger `(task_id, kind)` already exists; not duplicated. |
| **BullMQ** | `attempts`, exponential backoff with jitter, delayed jobs, **stalled jobs** (lock duration, renewal, `stalledInterval`, `maxStalledCount`), a worker that disappears → job back to waiting or failed | Stalled-job detection → watchdog `ORPHANED_RUNNING` (child alive, owning daemon gone) and `STUCK_RUNNING` (past `timeout + grace`); `maxStalledCount=1` → one restart attempt per approval | Automatic requeue of an orphaned RUNNING task — the provider child is still alive and a second run would collide in the same worktree; that is an **APPROVAL** finding, not an AUTO requeue | The executor's `INTERRUPTED → WAITING_RETRY` already covers the "child gone" case; the gap was the "daemon gone" case, now detected. |

No external runtime dependency was necessary. Node built-ins and `git` only.

---

## 3. Automation Matrix

Modes: **AUTO** = safe + deterministic + reversible, runs without a human (LEVEL_4 by owner-created marker; LEVEL_1/2 —
observe & plan — always). **APPROVAL** = prepared and verified automatically, APPLY waits for a recorded human decision
(LEVEL_3). **MANUAL** = stays with the owner.

| Operation | Current manual step | Automation possible | Risk | Mode | Evidence / implementation |
|---|---|---|---|---|---|
| Fetch `origin/main` | every preflight | yes | none | **AUTO** | `git-reconcile.inspect()` every tick |
| Fast-forward the shared checkout | M1, 12×/48 h | yes, ff-only under 6 conditions | low: checkout = deploy; a ff changes files under a running daemon exactly as the manual ff did; the result is made explicit as `EXECUTOR_RESTART_REQUIRED` | **AUTO** (marker `sync.enabled`; dry-run + ledger without it) | `git-reconcile.plan/apply`; tests: clean sync, already synchronized, multi-commit ff, dirty, divergent, wrong branch, ahead, in-progress, wrong remote, fetch failure, target moved, fenced |
| Merge / rebase / reset / clean / stash / force / conflict resolution | — | no | destructive | **MANUAL** | not implemented anywhere, not behind any flag |
| Drift detection (SOURCE/CODE/BRIDGE/EXECUTOR) | M3 | yes | none (read-only) | **AUTO** | `drift.detect()`; executor `code_identity` in `/health`; reflog inference for a pre-stage executor |
| Executor restart | M2 | yes, governed | medium: kills in-flight work if unchecked; the unit is on `protected_units_never_restartable` | **APPROVAL** (per-SHA human approval; owner may create `restart.auto.enabled` = LEVEL_4 by policy) | `restart.js`: request → approval → 4 pre-checks (reason still true, resource guard not CRITICAL/unknown, no RUNNING task, approval valid) → `systemctl --user restart` → health → identity; one attempt per approval; FAILED stops |
| Health checks | every session | yes | none | **AUTO** | `/health` polled by drift + restart verification |
| Task watchdog (stuck, orphaned, overdue, no report, corrupt, lease expired, daemon down) | M9 | detection yes; recovery only where a legal transition exists | recovery of an orphaned RUNNING task could double-run a worktree | **AUTO** detect + stamp; transitions **APPROVAL** (`ORPHANED_RUNNING`, `STUCK_RUNNING`, `LEASE_EXPIRED`) / `INTERRUPTED` already AUTO in `executor.tick()` | `watchdog.js`; no change to `lib/state.js` (protected) |
| Worktree / branch cleanup | M10, 85 worktrees | yes for bridge task worktrees that are merged + on origin + clean + unused + no unique commits + >24 h | low: `worktree remove` and `branch -d` refuse dirty/unmerged by themselves; remote branches never touched | **AUTO** (marker `worktrees.enabled`, ≤5 per run, re-verified per item); non-task worktrees **APPROVAL** (`OWNERSHIP_AMBIGUOUS`); dirty **MANUAL** | `worktrees.js`; live plan: 27 AUTO / 67 APPROVAL / 16 KEEP |
| Test selection + execution | M11 | yes | none | **AUTO** (targeted); FULL forced on sensitive paths, always available | `test-impact.js` generates the map from the suites (require + text-path literals), excludes DB/docker/sudo/known-failing suites, STOPs on first failure, JSON artifact |
| Evidence / handover facts | M12 | yes | none | **AUTO** | `evidence.js` (git + artifact + drift → JSON/markdown, `NOT_VERIFIED` never invented) |
| Unified operational state → Status Center | M13 | yes | none | **AUTO** | `status.js` → `state.json`, `GET /autopilot`, monitor probe `autopilot-state` |
| Audit generation | M12 | yes | none | **AUTO** | `ledger.jsonl` (state changes, decisions once per change, every action) |
| Root installer re-run (`/usr/local` copies) | M4 | detection possible; execution needs root | privilege boundary | **APPROVAL** (detection is next-stage work, §14) | not implemented: the autopilot runs as deploy and must not hold root |
| daemon-reload / timer activation | M5 | partially (deploy user units) | low for user units, privileged for system units | **APPROVAL** | `install-autopilot.sh` only for its own timer |
| Enable-marker flips | M6 | reporting yes; flipping no | policy decision | **APPROVAL** | `CLEANUP` section of the unified state reports every marker |
| Governance approvals | M7 | no | security boundary | **MANUAL** (root + human) | unchanged |
| PR creation / merge | M14 | no | human merge decision | **MANUAL** | unchanged |
| Production config / secrets / Resource Guard thresholds / WhatsApp / Model policy | — | no | out of scope by rule | **MANUAL** | untouched |
| Force push, reset, `git clean`, destructive cleanup, `user@1001` restart, docker, nginx | — | no | irreversible | **MANUAL** | untouched |

---

## 4. Self-healing boundary

```
AUTO       fetch · ff-only sync (marker) · drift detection · health checks · watchdog detection + stamps
           · targeted/full test runs · evidence + state + ledger generation · safe task-worktree removal (marker)
APPROVAL   executor restart (per-SHA approval or owner policy marker) · orphaned/stuck task recovery
           · non-task worktree/branch deletion · root installer re-runs · enabling any capability (marker)
MANUAL     merge/rebase/reset/clean/stash/force · conflict resolution · governance approvals · PR merge
           · security boundary changes · production config · destructive or privileged host operations
```

"Self-healing" never means kill, reset or force. Every AUTO capability has a kill switch (`MYTHOS_AUTOPILOT=off`,
`MYTHOS_AUTOPILOT_{SYNC,WORKTREES,RESTART}=off`) and a marker whose removal is an instant rollback.

---

## 5. MYTHOS Safe Reconciler (git)

`projects/mythos-ai-executor/lib/autopilot/git-reconcile.js`

```
GitHub main → detect drift (fetch) → inspect local state → policy gate → reconcile (ff-only) → verify → audit
```

AUTO only when **all** hold: expected repository and remote URL · branch `main` · no in-progress git operation
(`MERGE_HEAD`, `rebase-*`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`) · tracked tree clean (untracked files are
not overwritten by a ff and do not block) · fetch succeeded · HEAD and `origin/main` resolve to full SHAs · HEAD is an
ancestor of `origin/main`. Otherwise `BLOCKED` with a code (`DIRTY_CHECKOUT`, `DIVERGED`, `LOCAL_AHEAD`, `WRONG_BRANCH`,
`GIT_OPERATION_IN_PROGRESS`, `WRONG_REPOSITORY`, `FETCH_FAILED`, `TARGET_UNVERIFIED`) and `human_approval: true`.
The target is re-verified immediately before `git merge --ff-only <sha>` (`TARGET_MOVED` otherwise), the lock is
re-checked (`FENCED_OUT`), and HEAD is verified equal to the target afterwards (`POST_SYNC_VERIFY_FAILED`).
Run twice: `FAST_FORWARD` then `ALREADY_SYNCHRONIZED`; no duplicate commit is possible.

## 6. Runtime drift detection

`lib/autopilot/drift.js`. Four identities: SOURCE (`origin/main` after fetch), CODE (checkout HEAD), BRIDGE (fresh process
per tick ⇒ disk identity), EXECUTOR (`GET /health` → `code_identity.head`, measured once at daemon start from the
module's own location — `executor.js` `CODE_IDENTITY`). An executor older than this stage has no such field; its identity
is then **inferred** from the `main` reflog entry in force at the process start time (`/proc/<pid>/stat` + `btime`) and
labelled `reflog_inference`. Verdicts: `CURRENT`, `CODE_BEHIND_SOURCE`, `CODE_AHEAD`, `CODE_DIVERGED`,
`EXECUTOR_RESTART_REQUIRED`, `EXECUTOR_UNVERIFIED` (fail-closed: never CURRENT, never restartable), `SOURCE_UNVERIFIED`.

Live on 2026-09-04 10:35 UTC: SOURCE `4ffb8d2` = CODE `4ffb8d2` = BRIDGE; EXECUTOR `85cbf90` (reflog inference, pid
688556, started 2026-09-03 16:52:59) ⇒ **`EXECUTOR_RESTART_REQUIRED`**, next action APPROVAL.

## 7. Governed restart

`lib/autopilot/restart.js`. A separate capability, never part of sync.

1. `request()` — durable record `restart/requests/<expected_sha>.json`, idempotent, supersedes older open requests.
2. `approve(sha, --by <human>, --reason)` — refuses automated identities (`claude|agent|automation|bot|system|n8n|mythos|autopilot`),
   short reasons, and SHAs without a recorded request. Record `restart/approvals/<sha>.json`, 24 h validity, single use.
3. `apply()` pre-checks (first reason wins, all ledgered): reason still `EXECUTOR_RESTART_REQUIRED` for this SHA · Resource Guard
   not `CRITICAL`, not stale/unknown (read from `resource-guard.json` with a 5-minute bound, never recomputed) · no RUNNING task ·
   approval valid. The approval is consumed **before** the signal.
4. `systemctl --user restart mythos-ai-executor.service` (deploy user unit; no root, no sudo, no hostops change needed).
5. Poll `/health` until `ok` **and** `code_identity.head === expected` (90 s). `HEALTH_TIMEOUT`,
   `IDENTITY_MISMATCH_AFTER_RESTART`, `RESTART_COMMAND_FAILED` ⇒ `FAILED`, evidence recorded, **no further attempt** — a second
   restart needs a second approval.
6. Owner policy: `restart.auto.enabled` lets the tick approve its own request as `policy:restart.auto`; every other veto still
   applies. Off by default (LEVEL_3 → LEVEL_4 is an owner decision per `AUTOMATION_GOVERNANCE.md` §4).

The hostops allowlist (`ops/dagu-poc/hostops-allowlist.json`) still lists the executor under `protected_units_never_restartable`.
That list governs the **root** hostops boundary; this restart never crosses a privilege boundary (deploy restarts a deploy
user unit). Amending the allowlist is not needed and was not done.

## 8. Worktree / branch reconciler

`lib/autopilot/worktrees.js`. Classification per worktree: task worktree? (under the bridge's task root, branch `mythos/gh/*`),
merged (head ∈ `origin/main`), on origin, unique commits (`head ^origin/main ^origin/<branch>`), clean, active task (bridge
claim → executor status non-terminal), in use (cwd of a live process), age. Decisions: `AUTO SAFE_MERGED_UNUSED` · `KEEP`
(`PRIMARY_CHECKOUT`, `TASK_ACTIVE`, `IN_USE`, `TOO_RECENT`, `LOCKED`) · `APPROVAL` (`NOT_MERGED`, `NOT_ON_ORIGIN`,
`UNIQUE_COMMITS`, `OWNERSHIP_AMBIGUOUS`, `DETACHED`, `PATH_MISSING`) · `MANUAL` (`DIRTY_OR_UNREADABLE`). Branches without a
worktree: `AUTO SAFE_MERGED_DELIVERED` only in the `mythos/gh/` namespace with zero unique commits. Apply: ≤5 per run, each
re-classified immediately before `git worktree remove` (no `--force`) and `git branch -d` (never `-D`); remote branches
are never deleted; every removal is ledgered with its evidence.

Live plan (2026-09-04): 27 AUTO (all bridge task worktrees whose work is merged, e.g. `gh-issue-100…118`, several with zero
commits), 67 APPROVAL (21 `OWNERSHIP_AMBIGUOUS` mission worktrees, 18 `NOT_MERGED`, 2 `NOT_ON_ORIGIN`, 2 `DETACHED`),
16 KEEP. Nothing removed (marker absent).

## 9. Task watchdog

`lib/autopilot/watchdog.js`. Findings with modes: `ORPHANED_RUNNING` (APPROVAL) · `INTERRUPTED` (AUTO, recovered by the
executor's own tick) · `STUCK_RUNNING` (APPROVAL) · `RETRY_OVERDUE` / `QUOTA_OVERDUE` / `QUEUED_STALE` /
`TERMINAL_NO_REPORT` (AUTO-reported) · `CORRUPT_STATUS` (MANUAL) · `LEASE_EXPIRED` (APPROVAL) · `DAEMON_DOWN` (APPROVAL).
Persistent `first_seen/count` stamps per (task, finding) in `<task>/autopilot-watchdog.json`: a finding is fresh once,
counted per tick, and removed when it clears — at-most-once notification without a new store. It reuses the executor's
state machine through read-only access and `lib/state.js` is untouched (protected path). Live: 64 tasks scanned, 0 findings.

## 10. Change-aware testing

`lib/autopilot/test-impact.js` + `mythos-autopilot tests [--run] [--full] [--base <ref>] [--out <json>]`. The map is generated
from the 153 suites (require targets + path literals + `path.join(BASE, 'projects', …)` sequences); suites needing a
database / docker / sudo, the two known-failing suites and `mos-e2e-lifecycle-test.js` (refuses to run where the production
checkout exists — container only) are excluded with the reason; sensitive paths (protected list
mirror, `executor.js`, `server.js`, `bridge/github-bridge.js`, `ops/session-guard/`, `ops/hostops/`, `.github/`) force FULL.
Runner: sequential, STOP on first failure, counts parsed, JSON artifact consumed by the evidence collector.

## 11. Evidence collector

`lib/autopilot/evidence.js` + `mythos-autopilot evidence [--tests <json>] [--md]`: branch, HEAD, base (merge-base with
`origin/main`), remote HEAD, commits, files, tree clean, on-origin, merged, test results (from the artifact), runtime identity
(from drift), deployment state, next action. Missing sources are listed under `not_verified`.

## 12. Unified operational state

`lib/autopilot/status.js` → `~deploy/mythos-ai-executor/autopilot/state.json`, `GET /autopilot` (executor, bearer), probe
`autopilot-state` in `projects/status-center/monitor/probes.json` (LIVE = CURRENT, DEGRADED = DRIFTED or stuck tasks,
DOWN = BLOCKED, NOT_MONITORED = no fresh state).

```
SOURCE {ref, sha, fetch_ok}          CODE {sha, branch, clean, relation, ahead, behind}
RUNTIME {executor_sha, executor_source, bridge_sha, drift}
BRIDGE {state, last_tick_at, fence}  EXECUTOR {state: HEALTHY|RESTART_REQUIRED|UNHEALTHY|DOWN|UNVERIFIED, pid, restart}
TASKS {state: HEALTHY|ATTENTION|STUCK, counts, findings}
WORKTREES {state: HEALTHY|STALE, auto_removable, summary}
RESOURCE {level, stale}              LIFECYCLE {registry_present, cleanup}
CLEANUP {git_sync, worktrees, restart_auto, autopilot}   DEPLOYMENT {state: CURRENT|DRIFTED|BLOCKED, next_action}
```

## 13. Idempotency, locking, audit, rollback

* **Idempotency** — sync NOOP when synchronized; restart request per SHA; approval single-use; worktree plan re-verified per
  item; watchdog stamps; ledger records a state change once (`fingerprint`) and a repeated decision once (`last-<key>`).
* **Lock / concurrency** — `lock.js`: one O_EXCL lock per operation with pid/host/heartbeat and a monotonic fence
  (`locks/fence.json`), stale takeover only when the holder is dead or silent for 15 min; a timer tick, a manual CLI run and
  any future webhook of the same operation cannot overlap — the newcomer skips (`already_running`) and does not queue.
  The bridge's own lock/fence and the executor's `daemon.lock` are not shared and not modified.
* **Audit** — `autopilot/ledger.jsonl` (append-only, 0600) + per-operation records; every restart decision and veto; every
  worktree removal with evidence; the unified state.
* **Rollback / disable** — remove a marker (instant), env kill switches, `systemctl --user disable --now mythos-autopilot.timer`.
  No state written by the autopilot is read by the executor's control flow except `GET /autopilot` (display only).

## 14. Remaining manual operations and recommended next automation

Remaining by design: governance approvals (root, human), PR review/merge, enabling any capability (marker), root installer
re-runs, privileged host operations (docker/nginx/`user@1001`), production configuration, static-site rsync.

Recommended next, in order:
1. **Installed-copy drift** (`/usr/local/{bin,lib,sbin}/mythos-*` vs checkout by sha256) as a read-only section of the unified
   state — closes M4's blind spot without any privilege (files are world-readable where the design permits).
2. **Executor watchdog** (`WatchdogSec=` + `WATCHDOG=1` via `systemd-notify`) — needs a governance-approved edit of
   `service/mythos-ai-executor.service`; the hung-but-alive daemon is the one failure the autopilot still cannot repair
   without a restart approval.
3. **Approval `action_class`** in `mythos-governance-approve.js` so restart approvals and hostops WRITE approvals share the signed
   root store ("one approval model, two enforcement points").
4. **Watchdog recovery transitions** for `ORPHANED_RUNNING` once the lifecycle registry (EXEC-LIFECYCLE-0) proves the provider
   session gone — the transition is legal today (`RUNNING → WAITING_RETRY`), the evidence is not.
5. **Handover generation** from `evidence.js` + `control/reports/*.json` into a validated `AI_HANDOVER.md` block.

## 15. Operating manual

```
# observe (no marker): every 2 min, measure + plan + report
bash ops/autopilot/install-autopilot.sh              # as deploy
mythos-autopilot status | drift | watchdog | worktrees | ledger

# enable AUTO fast-forward of the shared checkout
touch ~/mythos-ai-executor/autopilot/sync.enabled     # rollback: rm

# governed restart after a merge
mythos-autopilot restart status
mythos-autopilot restart approve <sha> --by "Othman Haddad" --reason "merged PR #NNN"
# next tick: pre-checks → restart → health → identity → HEALTHY (or FAILED, stop)

# enable AUTO removal of safe task worktrees
touch ~/mythos-ai-executor/autopilot/worktrees.enabled

# change-aware tests + evidence
mythos-autopilot tests --run --out /tmp/t.json && mythos-autopilot evidence --tests /tmp/t.json --md
```
