# MYTHOS Execution Architecture — one engine, one governor, one scheduler

Stage **EXEC-ARCH-0** · 2026-09-04 · branch `mythos/execution-architecture-20260904` over `5b995e9` (`origin/main`).
Mission: resolve the non-mergeable PR #158 (`feat(autopilot)`, branch `mythos/autopilot-20260904`, `2dc2fff`)
at the root — SEARCH → REUSE → ADAPT → TEST → BUILD ONLY WHAT IS MISSING — and leave MYTHOS with **one**
execution architecture instead of several competing ones.

*Provenance note (2026-09-04, GitHub issue #160): this file was carried, unchanged in sections 1–6, from the
`mythos/execution-architecture-20260904` branch (PR #159, not yet merged to `main` at the time of this edit)
so that §7 below could be added. Section 7 is the only new content in this copy.*

## 1. Why PR #158 is not mergeable (measured)

| Fact | Evidence |
|---|---|
| GitHub `mergeable: false`, `mergeable_state: dirty` | `GET /repos/othoth77/mythos-prod/pulls/158` (2026-09-04 13:5x UTC) |
| Textual conflicts in exactly two files | `git merge-tree --write-tree main mythos/autopilot-20260904` → `docs/AI_HANDOVER.md`, `docs/CHANGELOG.md` |
| Cause | #158 (base `4ffb8d2`) and PR #154 (SKILL-TRUST-0, merged as `5b995e9`) both prepend their stage entry at the top of the same two documents. No code conflict exists. |
| What the conflict hides | #158 is 2,902 lines / 23 files that add a **fourth** recurring-operations mechanism (a bespoke reconciler with its own lock/fence, ledger, approval store, watchdog, test-impact generator, evidence collector, status feed and an **eleventh** timer) beside the ten timers already running, the merged EXEC-LIFECYCLE-0 registry, and the Dagu host-ops layer DAGU-HOSTOPS-0 already recommended. |

Fixing the two conflict hunks would merge the duplication. That is why this stage does not rebase #158.

## 2. Search First — what exists in MYTHOS (read before building)

| Capability | Where it already lives (main `5b995e9`) |
|---|---|
| Agent execution engine | `projects/mythos-ai-executor/providers/claude-code.js` — Claude Code headless (`claude -p`, `--permission-mode`, allow/deny tools, `--session-id/--resume`, `--model`); the ONLY provider with `executionAuthority` |
| Task lifecycle, retries, quota, interrupted recovery | `executor.js` + `lib/quota.js` + `lib/state.js` (protected) — WAITING_RETRY / WAITING_FOR_QUOTA / BLOCKED / FAILED, two idempotent resumers |
| Worktree per task, branch `mythos/gh/<id>` | `bridge/github-bridge.js` (GitHub Issues/control files → OTHMODE Task → executor) |
| Session / execution / task correlation, safe session cleanup | `lib/lifecycle/*` + root Session Guard (EXEC-LIFECYCLE-0, merged) |
| Governance: protected paths, signed approvals, relay | `service/governance-verify.js`, `mythos-governance-approve`, `mythos-git-push.timer` (root, ff-only, `refs/heads/mythos/*`) |
| Trust: skills, MCP | `lib/skill-trust.js` + `projects/command-center/reference/othmode/trust/*` (SKILL-TRUST-0, merged) · `lib/mcp-invoke.js` |
| Resource admission | `lib/resource-guard.js` + `bin/mythos-resource-guard` |
| Root host operations boundary | `lib/hostops.js` → `/usr/local/sbin/mythos-hostops-daemon` (READ verbs live; allowlist `ops/dagu-poc/hostops-allowlist.json`) |
| Host-ops orchestration (retry, approval gate, run history, queue) | **Dagu 2.16.2** — PoC passed 11/11 (`docs/MYTHOS_DAGU_HOST_OPERATIONS.md` §13 RECOMMEND), binary at `/home/deploy/dagu-poc/bin`, not yet a service |
| Status | `projects/status-center` monitor (22 probes) + OTHMODE `/api/othmode/status` |

## 3. Search First — open source engines evaluated (live-verified 2026-09-04)

| Engine | License / version | Verdict | Decisive facts |
|---|---|---|---|
| **Claude Code headless** (integrated) | Anthropic CLI 2.1.251 | **SELECT** | already the engine; uses the subscription credentials on the host (no API key); exposes permission modes, tool allow-lists, MCP client, skills — the exact surface Skill Trust and MCP governance are built on; no Docker; no extra RAM |
| OpenHands 1.16 | MIT | REJECT | needs Docker + several GiB (host: 725 MiB available, swap 4095/4095, guard WARNING→CRITICAL during this stage); API-key only; **headless = always-approve, `--llm-approve` unavailable** — approval would sit outside the loop; a second execution architecture |
| mini-SWE-agent v2 | MIT | REJECT | ~100-line research harness: bash-only, LiteLLM API key, no session resume, no MCP, no skills, no permission modes — OTHMODE's policy surface would have to be rebuilt around it |
| SWE-agent 1.x | MIT | REJECT | superseded upstream by mini-swe-agent; same objections, heavier |
| Goose | Apache-2.0 | REJECT | MCP-native but API-key only and a parallel runtime with its own extension trust model |

Registry: `projects/command-center/data/open-source-registry.json` (six records added, incl. Dagu SELECT). No dependency installed.

## 4. Decision

```
GitHub (Issue / control task / PR)
  ↓
MYTHOS Bridge  (bridge/github-bridge.js, deploy timer, every 2 min)
  ↓
OTHMODE        (Trust · Policy · Approval · Skill Trust · MCP Trust · audit)   ← governance authority, unchanged
  ↓
Claude Code headless  (providers/claude-code.js)                               ← THE execution engine, unchanged
  ↓
worktree + branch mythos/gh/<id> → tests → report → relay (ff-only) → PR → HUMAN merge → main
  ↓
Recurring host maintenance = Dagu DAGs pinned in ops/dagu/maintenance/       ← THE scheduler (replaces #158)
  (guard → ff-only sync · drift · governed restart with human approval · worktree GC)
```

* **REUSE**: Claude Code, executor, bridge, lifecycle, governance relay, Resource Guard, Dagu (queue, retry,
  approval gate, run history, cron).
* **ADAPT** from #158: the executor's self-reported `code_identity` in `GET /health` (27 lines, the one
  measurement that turns "is the daemon stale?" from a reflog guess into a fact) and the *rules* of its
  reconcilers (six ff-only conditions, worktree safety conditions, approval-before-restart) — re-expressed as
  three shell tools of 60–110 lines each.
* **BUILD** only: `ops/dagu/bin/{mythos-git-sync,mythos-drift-check,mythos-worktree-gc}`, four DAG files,
  `tests/dagu-maintenance-test.js`.
* **REMOVED / not carried**: `lib/autopilot/*` (lock/fence, ledger, restart request/approval store, watchdog,
  test-impact generator, evidence collector, unified status), `bin/mythos-autopilot`, the `mythos-autopilot`
  timer/service, `GET /autopilot*` routes, the Status Center `autopilot-state` probe, `docs/MYTHOS_AUTOPILOT.md`.
  Watchdog findings are the lifecycle registry's job (EXEC-LIFECYCLE-0 `verify.js` / `recover()`); the
  test-impact generator and handover generator are deferred until a measured need exists (YAGNI).

## 5. Security boundaries (unchanged or tighter)

* Dagu runs as **deploy** under a user unit (`NoNewPrivileges=true`, `MemoryMax=256M`), loopback only,
  `write_dags: false` — it cannot author DAGs, cannot reach root, cannot reach the Docker socket.
* The maintenance DAGs contain no `sudo`, `docker`, `--force`, `reset`, `clean`, `rebase`, `stash`, `rm -rf`,
  `branch -D`, `push` (test-enforced). Mutations are `git merge --ff-only` and `git worktree remove` + `git branch -d`,
  both dry-run until an owner marker exists.
* The executor restart requires: guard not CRITICAL · zero RUNNING tasks · drift gate says
  `EXECUTOR_RESTART_REQUIRED` · a human approval with `approval_ref` on the paused step. Never on a timer.
* OTHMODE, Skill Trust, MCP governance, the governance relay, protected paths, the hostops allowlist and
  `lib/state.js` are untouched. `executor.js` is not a protected path.

## 6. Known limitations

* Dagu is not yet installed as a service — until the owner step in `ops/dagu/README.md`, nothing runs on a
  schedule (the DAGs were executed by hand from the PoC binary in this stage).
* `mythos-worktree-gc` detects "in use" by readable `/proc/*/cwd` only; root-owned processes are invisible to
  deploy, so the 24 h minimum age and the merged+clean conditions carry the rest.
* Installed-copy drift (`/usr/local/{bin,lib,sbin}/mythos-*` vs checkout) is still not measured (#158 §14.1).

## 7. Simple explanation — non-technical

Every system named above, in one line each — for the project owner, not for engineers. The technical
role (already described above) never changes; this is the same system, described plainly.

| System | Technical role | Plain-language explanation |
|---|---|---|
| GitHub | Source of truth for code, Issues, and control tasks | The official project notebook — where the project's real history and decisions are kept. |
| Bridge | `bridge/github-bridge.js`, polls GitHub and dispatches tasks | The messenger — receives the task and passes it through the approved path. |
| OTHMODE | Governance authority: trust, policy, approval, audit | The guard/manager — checks the task and makes sure it follows the project rules. |
| Claude Code | `providers/claude-code.js`, the only provider with execution authority | The worker — performs the approved work. |
| Worktree | Isolated checkout at `mythos/gh/<id>`, one per task | A temporary workshop — a separate safe place where one task is worked on without disturbing the main project. |
| PR | Pull request opened from the task's branch | The review request — shows what was changed and asks for human review. |
| Human Merge | Owner decision to merge a PR into `main` | The final human decision — only the owner decides what becomes part of main. |
| Dagu | Scheduler for recurring host maintenance DAGs | The scheduler/organizer — handles safe repetitive maintenance at scheduled times. |
| Resource Guard | `lib/resource-guard.js`, admission gate before work runs | The resource/energy guard — prevents the system from consuming more resources than allowed. |
| Drift Check | `ops/dagu/bin/mythos-drift-check`, read-only | The matching meter — checks whether what is running matches what the project says should be running. |
| Git Sync | `ops/dagu/bin/mythos-git-sync`, ff-only | Synchronization — brings the project copy up to date safely without replacing work destructively. |
| Worktree GC | `ops/dagu/bin/mythos-worktree-gc`, merged+clean+unused+≥24h only | The cleanup worker — identifies old temporary workshops that are safe to remove, subject to the project's safety rules. |
| Executor Restart | Paused Dagu step, requires a human `approval_ref`, never scheduled | Restarting the worker — used when new code needs the running worker to reload; this remains a separate human-approved action. No automatic restart exists anywhere in this architecture. |
| Skill Trust | Scan/policy/attestation gate over `.claude/skills/` and executor skills | Tool trust check — verifies that an automation skill is allowed to perform the requested kind of work. |
| MCP Trust | Same policy vocabulary, applied to connected MCP servers | External-door trust check — verifies that connected external tools/services are trusted before they are used. |
| Lifecycle | `lib/lifecycle/*`, correlates task/execution/session state | The task life record — keeps track of where a task is in its journey from start to completion. |
| Status Center | `projects/status-center`, 22 probes + `/api/othmode/status` | The dashboard — gives the owner a simple view of what is happening and the current state of the project. |
