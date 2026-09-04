# MYTHOS Execution Lifecycle

**Stage:** EXEC-LIFECYCLE-0 (2026-09-04)
**Code:** `projects/mythos-ai-executor/lib/lifecycle/` (model, registry, runtime-vps, runtime-pc, correlate, verify, cleanup, index), CLI `bin/mythos-lifecycle`, hook `ops/lifecycle/claude-lifecycle-hook.js`, PC agent `ops/lifecycle/mythos-pc-agent.js`
**Suite:** `tests/mythos-lifecycle-test.js` (254 checks, offline, no real signal)
**Related:** `docs/MYTHOS_SESSION_GUARD.md` §11, `docs/MYTHOS_GITHUB_BRIDGE.md`

The system that lets MYTHOS answer, at any moment and for any unit of work:

| Question | Answered by |
|---|---|
| **TASK** — what is happening to the work? | GitHub (control task / Issue / report) → `task_state` |
| **EXECUTION** — who is doing it, where, under which attempt? | executor / bridge / PC relay → `execution_state`, `location`, `agent` |
| **SESSION** — is the agent's conversation/process still alive? | Claude hooks + runtime observation → `session_state` |
| **GITHUB** — is there a report / commit / PR? | bridge REPORT_SUBMITTED, `github_issue`, `github_pr`, `report_ref` |

and links the four reliably: **GitHub Issue → control task → execution_id → agent → session_id → PID**.

---

## 1. The problem it solves

Before this stage MYTHOS had three disconnected truths:

* the **executor** knew `task_id`, `execution_id`, `claude_session_id` and a `pid` for its own headless `claude -p` runs — and nothing else;
* the **bridge** knew the GitHub Issue, the control task and when the REPORT was written — and mapped executor status straight onto task status;
* the **Session Guard** (gh-issue-144) saw processes: every `ccd-cli` under root was "a session", classified active/idle/orphaned from CPU ticks, RSS and transcript mtime.

Nothing linked a Desktop Remote session to the task it worked on, nothing knew whether a session had finished its turn, and a GitHub report said nothing about whether the session that produced it was still open. Measured on this VPS on 2026-09-04 (read-only, `mythos-lifecycle host`):

| Class | Sessions | Notes |
|---|---|---|
| IDLE (transcript ended with `end_turn`, no execution linked) | 14 | oldest turn ended 2026-09-01, 2.5 GiB resident |
| ACTIVE (turn in progress) | 1 | the session doing this work |
| UNKNOWN (executor daemon + helpers, no session binding) | 3 | correctly not "active" |

and the existing guard's ledger showed **every one of the 14 vetoed as `recent_activity`**: an idle `ccd-cli` keeps burning CPU ticks (~2.5 %), so a CPU-based idle clock never clears. "Process exists" was being read as "session works". That is the false equivalence this stage removes.

---

## 2. The model — three vocabularies, not one

`lib/lifecycle/model.js` is pure (no I/O, no clock of its own).

```text
TASK        QUEUED → RUNNING → REPORT_SUBMITTED → VERIFICATION → COMPLETED | FAILED | BLOCKED | CANCELLED
EXECUTION   CREATED → DISPATCHED → RUNNING → REPORTING → VERIFYING → FINISHED | FAILED | UNKNOWN
SESSION     CREATED → RUNNING ⇄ IDLE → COMPLETED → CLOSING → CLOSED     (+ ORPHANED, UNKNOWN)
CLOSE PHASE OBSERVE → ELIGIBLE → GRACE → CLOSE_REQUESTED → VERIFYING → CLOSED   (failure → HUMAN_REVIEW)
```

The rule the reducer enforces: **a REPORT is evidence about the task, never a command about the session.**

```text
REPORT_SUBMITTED
  → task REPORT_SUBMITTED → VERIFICATION
  → execution VERIFYING
  → session: unchanged
  → verify.js LOOKS at the session
      closed  → task COMPLETED, execution FINISHED, session CLOSED   ("COMPLETED + SESSION_CLOSED")
      open    → task COMPLETED, execution VERIFYING, session IDLE/…  ("COMPLETED + SESSION_OPEN"), re-check with backoff
      unknown → treated as open (fail-closed), re-check
```

An execution is FINISHED only when the task has its GitHub outcome **and** the session is closed. Either alone is not enough.

### Events

| Event | Producer | Effect |
|---|---|---|
| `EXECUTION_CREATED`, `EXECUTION_DISPATCHED` | executor (`runTaskCore`) | new attempt record; inherits the task's GitHub link |
| `SESSION_STARTED` | executor `onSpawn`; Claude hook `SessionStart`; PC relay | binds session_id + pid + proc_start; task/execution/session → RUNNING |
| `SESSION_ACTIVITY`, `SESSION_IDLE` | hooks `UserPromptSubmit`/`Stop`/`Notification`; PC relay | activity clock; RUNNING ⇄ IDLE |
| `TASK_COMPLETED` | executor success; hook `TaskCompleted`; PC relay | agent says done → execution REPORTING (task unchanged) |
| `REPORT_SUBMITTED` | bridge `finishTask` (control report); executor for non-bridge tasks | task → VERIFICATION, execution → VERIFYING |
| `EXECUTION_VERIFIED` | `verify.js` only | records the observation; settles or re-schedules |
| `SESSION_END` | executor child exit (`process_gone:true`); hook `SessionEnd` (`process_gone:false`); PC relay | CLOSING, or CLOSED with proof |
| `SESSION_CLOSED`, `PROCESS_GONE` | runtime observation, cleanup, PC agent | CLOSED; PROCESS_GONE before any report → execution UNKNOWN |
| `SESSION_CLOSE_REQUESTED`, `SESSION_CLOSE_FAILED` | `cleanup.js` only | CLOSING / HUMAN_REVIEW |
| `SESSION_ORPHANED`, `SESSION_UNKNOWN`, `EXECUTION_FAILED`, `HEARTBEAT` | runtime / executor / PC relay | as named |

`RELAY_EVENTS` (what a PC agent may send): STARTED, TASK_STARTED, ACTIVITY, IDLE, TASK_COMPLETED, SESSION_END, SESSION_CLOSED, PROCESS_GONE, HEARTBEAT. A relay can **never** request or confirm a close, or assert a verification — those are decisions, not observations.

---

## 3. The registry (durable state)

`lib/lifecycle/registry.js` — plain JSON under `MYTHOS_LIFECYCLE_HOME` (default `<executor home>/lifecycle` = `/home/deploy/mythos-ai-executor/lifecycle`):

```text
executions/<execution_id>.json   execution_id, task_id, github_issue, github_pr, correlation_id (control task id),
                                 agent, provider, location (VPS|PC), host, session_id, pid, proc_start, cwd,
                                 started_at, last_activity_at, task_state, execution_state, session_state,
                                 report_status, report_submitted_at, session_closed_at, session_open_after_report,
                                 last_event, close_reason, verification{attempts,next_check_at,attention}
sessions/<session_id>.json       every session ever heard of — linked or not — with state, close_phase, pid, proc_start,
                                 host, location, last_activity_at, last_heartbeat_at, end/close reasons
tasks/<task_id>.json             the TASK's GitHub link (written by the bridge at claim), inherited by every attempt
inbox/*.json                     spooled events (hooks, CLI, relay) — consumed
outbox/PC/*.json                 requests for the PC agent (register_execution, close_request) — consumed there
quarantine/                      unreadable inputs, kept for a human
ledger.jsonl                     append-only: every accepted event, every transition, every veto/refusal
seen.json                        bounded ring of accepted event ids (replay protection)
cleanup.enabled                  the enforcement marker (rm = rollback)
policy.json                      optional overrides of cleanup policy (the only place force_kill_enabled can be set)
```

Writes are tmp+rename; a torn record is quarantined and treated as absent; stale `.tmp-*` files are swept; a corrupt `seen.json` resets rather than crashes. Events without any correlation key, with path-shaped ids, or with unknown types are rejected and ledgered. Correlation: `execution_id` directly, else `task_id → latest execution`, else `session_id → linked execution`; an unlinkable event still updates the session record (an unlinked session is **UNKNOWN**, never ACTIVE). Duplicate event ids are dropped; semantic repeats (a second `TaskCompleted`, a second `SessionEnd`) are absorbed by the reducer with no transition.

Agent-agnostic: `agent` and `provider` are free strings from the executor's provider id; nothing keys on "claude" except the two Claude signal readers in the VPS runtime.

---

## 4. Agent Runtimes (VPS and PC, same contract)

```text
register_execution(exec)   get_session(ref)   get_session_state(ref)   get_last_activity(ref)
request_close(ref, opts, killFn)   verify_closed(ref)
```

### VPS runtime — `runtime-vps.js`

Reads real, local signals; never guesses from `ps`:

1. `/proc/<pid>` — existence, **start ticks** (identity), argv class via `session-guard.classify`, uid.
2. `~/.claude/sessions/<pid>.json` — Claude Code's own per-process registry: `{ pid, sessionId, procStart, cwd, startedAt, entrypoint }`. `procStart` equals the kernel start ticks, so a recycled PID is rejected, and a pid that now carries a *different* session id marks the requested session CLOSED.
3. `~/.claude/projects/<slug>/<sessionId>.jsonl` — the transcript tail (96 KiB, main line only, sidechains ignored): last `assistant` record with `stop_reason: end_turn` → **idle**; `tool_use` or a trailing `user` record → **running**. This is the idle/running truth ACP calls a `state_update`; here it is read.
4. The executor's `status.json` (pid + `claude_session_id`) for `claude -p`.

State: `CLOSED` (pid gone or recycled) · `ORPHANED` (remote session reparented) · `RUNNING`/`IDLE` (transcript) · `UNKNOWN` (alive but unreadable, or no binding). `request_close` sends **SIGTERM only**, only with `authorized:true`, only after identity re-verification, only for `remote-session` kind; SIGKILL requires `policy.force_kill_enabled` **and** `force_confirmed`. A process owned by another account (root's Desktop Remote sessions seen from deploy) is **delegated**: the registry's `CLOSE_REQUESTED` phase is the request and the root Session Guard applies the signal (§7).

**Privilege bridge.** `/root/.claude` is root-only. The root guard runner calls `snapshot()` and writes `/var/lib/mythos/lifecycle/host-sessions.json` (ids, pids, identity ticks, turn state, timestamps — no argv, no content; `root:deploy 0640`). A non-root reader binds through it; a snapshot older than 10 min yields **UNKNOWN**, never a state.

### PC runtime — `runtime-pc.js` + `ops/lifecycle/mythos-pc-agent.js`

The VPS never inspects a Windows/macOS process table. On the PC:

* the same hook script runs with `MYTHOS_LIFECYCLE_LOCATION=PC` and spools events locally;
* the **PC agent** relays the spool to `POST /lifecycle/events` (bearer + HMAC-SHA256 over `timestamp.body`, ±10 min window), in order, with exponential backoff — the spool is the durable state, so a disconnect loses nothing;
* it sends `HEARTBEAT` for every open session, watches the PID after `SessionEnd` and sends `PROCESS_GONE` when it is really gone (the only closure proof the VPS accepts for a PC session);
* it polls its outbox (`GET /lifecycle/outbox/PC`, `POST …/ack`) for `register_execution` and `close_request`. A close request is honoured **only** if the agent's own config says `allow_close:true`, only for a PID it registered from its own hook events, only with the platform's graceful signal (SIGTERM / `taskkill` without `/F`); a force request additionally needs `allow_force:true`. Nothing else is ever executed.

On the VPS side, relayed state is believed only while the heartbeat is fresh (5 min): **relay lost = UNKNOWN, not CLOSED.** `verify_closed` is inconclusive (`null`) until the agent confirms.

---

## 5. Post-completion verification (`verify.js`)

Runs inside the executor daemon's step (self-throttled to once per minute) and from `mythos-lifecycle tick|verify`. For every execution in VERIFYING whose `next_check_at` is due:

1. observe the session through its location's runtime (or trust a closure already **proven** on record — a headless child's exit, a PC agent's PROCESS_GONE);
2. note whether the same session is also bound to another *active* execution (`shared_active`);
3. emit `EXECUTION_VERIFIED { session_open, session_state, next_check_at }` with event id `verify:<execution_id>:<attempt>` — replaying a tick cannot double-count;
4. backoff 1 m → 2 m → 5 m → 15 m → 30 m → hourly (bounded, never a busy loop); after 24 checks the record is flagged `verification.attention` for a human — not closed, not failed, not forgotten.

`mythos-lifecycle status` lists every `completed_session_open` execution with its next check.

---

## 6. Cleanup policy (`cleanup.js`)

A session is **eligible** only when all of the following hold on the same tick:

```text
linked to ≥1 execution          AND   no execution bound to it is active (CREATED/DISPATCHED/RUNNING/REPORTING)
its execution has its report    AND   the runtime observes IDLE / COMPLETED / ORPHANED (not RUNNING, not UNKNOWN)
no activity for idle_seconds    AND   session age ≥ min_session_age_seconds     AND   not an executor-owned `claude -p`
```

Phases advance at most one step per tick, each written to the ledger with its reason:

```text
OBSERVE → ELIGIBLE → GRACE ──(grace elapsed, enforcement on)──▶ CLOSE_REQUESTED → VERIFYING → CLOSED
   ▲          │         │                                             │ still present after close_verify_timeout
   └──────────┴─────────┘  any activity / new execution / doubt        └─ retry ≤ max_close_attempts, then HUMAN_REVIEW
```

Defaults: `idle_seconds 1800`, `grace_seconds 600`, `min_session_age_seconds 900`, `close_verify_timeout_seconds 300`, `max_close_attempts 2`, `max_closes_per_run 2`, `force_kill_enabled false`, `enabled false`.

* **Dry-run by default.** Without `<registry>/cleanup.enabled` (or `MYTHOS_LIFECYCLE_CLEANUP=on`) phases stop at GRACE and the veto reads `dry_run, would: request_close`.
* **Races.** Activity during GRACE → back to OBSERVE, no signal. ESRCH/recycled-pid at signal time → recorded as closure, not failure. Any other signal failure → HUMAN_REVIEW, never retried automatically.
* **Force kill** is `mythos-lifecycle force-close <session_id> --confirm --reason …` and refuses unless `policy.json` has `force_kill_enabled:true`, the enforcement marker exists, the session is in HUMAN_REVIEW, no execution is active, and `--confirm` is given. Every refusal and every use is ledgered with the operator.
* **Root-owned sessions** are delegated to the Session Guard (§7); the deploy-side cleanup never attempts a signal it cannot send.

---

## 7. Relationship to the Session Guard

The guard (`lib/session-guard.js`, root unit every 5 min) remains the **only** component that signals processes. It now consults the lifecycle:

| Input | Effect in `plan()` |
|---|---|
| registry `sessions/` + `executions/` (`cfg.lifecycle_registry`) | fence `lifecycle_execution_active` (bound to an active execution → never signalled, whatever the ceiling or the pressure); fence `lifecycle_human_review`; new rule 2b `lifecycle_close_requested` (SIGTERM, required inactivity 0, every other fence still applies) |
| host snapshot (`cfg.lifecycle_snapshot`, produced by the runner just before the plan) | `effectiveIdleSeconds = max(cpu/rss/mtime clock, transcript-turn clock)` — only for `turn === 'idle'` with verified identity, only while the snapshot is fresh. `idle_timeout` evidence names `idle_source: transcript_turn` |

Without a registry or a snapshot the guard behaves exactly as before (277/277 of its own suite unchanged). Live dry run on this host (scratch state, observe mode, 2026-09-04 08:11 UTC): 14 sessions gained a `turn_idle_seconds` between 2 586 s and 177 309 s, three were planned for SIGTERM under the 1 h idle rule (blast radius 3), the running session got `turn_idle: null`, and nothing was applied.

---

## 8. Correlation on the host (`correlate.js`, `mythos-lifecycle host`)

For every `remote-session` / `executor` process and every relayed PC session: `PID ↔ proc_start ↔ session_id ↔ execution_id ↔ task_id ↔ GitHub Issue ↔ correlation_id` (a cwd under `worktrees/gh/<id>` also yields the control task id).

| Class | Meaning |
|---|---|
| ACTIVE | bound; turn in progress |
| WAITING | bound; execution still open; agent handed the turn back |
| COMPLETED | bound; execution has its GitHub outcome — the session outlived the task |
| IDLE | bound; no execution; turn ended |
| ORPHANED | reparented; nothing can reconnect |
| UNKNOWN | cannot be bound to a session id, or turn unreadable |

**A `ccd-cli` process by itself is UNKNOWN.** Only evidence promotes it.

---

## 9. Crash recovery (`index.recover`, every tick)

| Situation | Outcome |
|---|---|
| execution RUNNING/REPORTING, pid gone, no report | `PROCESS_GONE` → execution **UNKNOWN**, task unchanged (never silently FAILED); surfaced in `status().executions.unknown` |
| pid gone but the executor's `status.json` already says COMPLETED/FAILED/BLOCKED | caught up: `TASK_COMPLETED` + `SESSION_CLOSED`; the report event follows from the executor/bridge |
| an older UNKNOWN attempt and a newer execution of the same task (executor resume / recreate) | old attempt → FAILED with `superseded_by`; new one carries on (same Claude session id is fine) |
| session ended before the report | session CLOSED, task RUNNING; the later `REPORT_SUBMITTED` still settles to FINISHED |
| bridge / executor / PC agent restart | state is on disk; replayed events are duplicates; verification attempts are not inflated |
| VPS reboot | every pid is gone → recovered as above on the first tick |

---

## 10. Security

* **A GitHub report is evidence, never a privileged command.** Neither the bridge nor the Issues adapter can emit a close; `REPORT_SUBMITTED` moves the task and schedules a *look*.
* **Only two components signal**: the root Session Guard (fences, identity re-verification, blast radius) and `runtime-vps.request_close` (SIGTERM, `authorized` + identity + kind + policy). No HTTP route closes anything; `mythos-lifecycle emit` refuses system events.
* **PID/session ids from events are never a control handle.** A pid is signalled only after `/proc` start-ticks match the recorded identity and the class is `remote-session`; ids are pattern-validated; path-shaped values are refused.
* **Relay ingest** requires bearer + HMAC + fresh timestamp, is opt-in (no secret → 403), accepts only `RELAY_EVENTS`, forces `location: PC` and stamps `source: http-relay`, drops duplicate event ids.
* **PC agent**: acts only under its own local `allow_close` / `allow_force`, only on PIDs it learned from its own hooks, never executes anything else; secrets are read from 0600 files, never argv or logs.
* **Force kill**: off by default; policy file + marker + HUMAN_REVIEW + `--confirm`; audited.
* **No secrets in the registry**: bounded string fields only; evidence maps are flat and clipped; hook payloads are reduced to ids, pid, cwd, reason.

---

## 11. Observability

`ledger.jsonl` carries every accepted event (`kind: event`), every transition (`kind: transition` with `execution_id, session_id, task_id, event, field, previous_state, new_state, at, reason, source`), every duplicate, rejection, attention flag, force-close use or refusal, and outbox ack.

```bash
node projects/mythos-ai-executor/bin/mythos-lifecycle status          # counts, enforcement, policy, completed+open, attention, unknown, host view
node projects/mythos-ai-executor/bin/mythos-lifecycle host            # every agent process/session classified with its links
node projects/mythos-ai-executor/bin/mythos-lifecycle explain <id>    # "why is this session still open?" / "why was it closed?"
node projects/mythos-ai-executor/bin/mythos-lifecycle ledger --id <id>
node projects/mythos-ai-executor/bin/mythos-lifecycle cleanup plan    # what cleanup WOULD do, and every veto
```

HTTP (executor API, bearer): `GET /lifecycle`, `GET /lifecycle/host`, `GET /lifecycle/{executions|sessions|tasks}/<id>`.

---

## 12. Performance

No daemon of its own. The deploy-side tick piggybacks on the executor's step, self-throttles to ≥ 60 s, reads a handful of small JSON files, verifies ≤ 10 executions and requests ≤ 2 closes per run, prunes hourly, and follows an exponential backoff per execution. The root runner adds one transcript-tail read (≤ 96 KiB) per Claude session every 5 min inside its existing `MemoryMax=192M / CPUQuota=25%` unit. No session is ever started to inspect another.

---

## 13. Deployment (owner actions; nothing is installed by this stage)

```bash
# 1. hooks + registry directories (VPS: root and deploy accounts)
sudo bash ops/lifecycle/install-lifecycle-hooks.sh
# 2. updated Session Guard runner (+ runtime-vps.js sibling, /var/lib/mythos/lifecycle, unit ReadWritePaths)
sudo bash ops/session-guard/install-session-guard.sh
# 3. executor daemon picks up lib/lifecycle on its next restart (systemctl --user restart mythos-ai-executor, as deploy)
# 4. optional PC agent: copy ops/lifecycle/{claude-lifecycle-hook.js,mythos-pc-agent.js} to the PC, write ~/.mythos-pc-agent/config.json,
#    provision MYTHOS_LIFECYCLE_RELAY_SECRET_FILE on the VPS (~deploy/.config/mythos-ai-executor/lifecycle-relay.secret, 0600)
#    and the same secret on the PC; reach the API over an SSH tunnel to 127.0.0.1:8130
# 5. observe for a few days:  mythos-lifecycle status / host / cleanup plan ; journalctl -u mythos-session-guard
# 6. enable cleanup (deploy side):  touch /home/deploy/mythos-ai-executor/lifecycle/cleanup.enabled
#    enable the guard (root side, already documented): touch /var/lib/mythos-session-guard/session-guard.enabled
```

**Rollback:** `rm …/cleanup.enabled` (cleanup back to dry-run) · `MYTHOS_LIFECYCLE_CLEANUP=off` · `node /usr/local/lib/mythos-lifecycle/unwire.js` or `MYTHOS_LIFECYCLE_HOOK=off` (hooks) · the guard's own marker/timer switches · reverting the commit leaves the executor and bridge behaviour byte-for-byte as before (every lifecycle call is best-effort and outside the task state machine).

---

## 14. Limitations

* Hooks are not installed yet; until they are, Desktop Remote sessions are correlated only through Claude's own `sessions/<pid>.json` + transcripts (host view, snapshot), and are never linked to an execution unless a dispatcher sets `MYTHOS_EXECUTION_ID` or the cwd is a bridge worktree.
* PC runtime is implemented and tested against the relay contract, but no PC agent is deployed; the outbox/ack round trip is proven offline only.
* The Issues adapter's comment on the Issue is not a separate `REPORT_SUBMITTED`; the control report on `mythos/control` is the report of record.
* `TaskCompleted` hook semantics on the Desktop Remote build are inferred from the binary's strings and the public hook docs; the hook script tolerates absence.
* A PC session with a stale heartbeat stays UNKNOWN forever rather than being closed — by design; it surfaces under `sessions.by_state.UNKNOWN`.

---

## 15. References (studied, not copied)

* **Agent Client Protocol** — session/new|load|list|resume|close, `state_update` running/idle/requires_action, stop reasons (end_turn, cancelled, max_tokens…), "background activity MAY continue while the Agent reports idle". Lesson applied: idle ≠ finished; stop reasons are recorded; foreground idle is a transcript observation here.
* **Hydra-ACP** — live/cold vs busy vs awaitingInput axes, `agentPid` "diagnostic only, never signal it", activity-based idle with a whitelist of recordable events, crash-loop breaker, tombstones, signed one-shot completion webhooks. Lessons applied: PID is identity+diagnostic and only the owning guard signals; heartbeats/attach never count as activity; closure needs proof; superseded attempts are reconciled, not trusted.
* **Codex app-server** — thread status `notLoaded|idle|active|systemError`, unload after 30 min without subscribers. **Claude Code hooks** — SessionStart/Stop/SubagentStop/TaskCompleted/Notification/SessionEnd payloads (`session_id`, `transcript_path`, `cwd`, `reason`).
