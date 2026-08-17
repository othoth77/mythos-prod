# Mythos AI Executor — Architecture

Stage MYTHOS-AI-EXECUTOR-0. Companion to `projects/mythos-ai-executor/README.md`
(operation) and `docs/MYTHOS_ORCHESTRATOR_ARCHITECTURE.md` (the earlier
delegation runtime this system deliberately reuses rather than replaces).

## 1. What it replaces

The manual loop — ChatGPT decides → operator pastes into Claude Code →
Claude asks for approval → operator answers → operator pastes results back —
becomes:

```text
ChatGPT → n8n "MYTHOS — Task Intake" (authenticated webhook)
        → executor HTTP API → persistent queue
        → daemon → claude -p --session-id/--resume (headless)
        → checkpoint / quota-pause / retry (automatic)
        → structured report → git commit/push (docs/AI_EXECUTION_REPORT.md)
        → ChatGPT reads GitHub (or "MYTHOS — Report" webhook) → next task
```

## 2. Decisions taken against what actually exists (Phase 0 inventory)

| Found on host | Decision |
|---|---|
| n8n 2.29.9 in Docker (`/opt/n8n`, SQLite, loopback:5678, public via nginx `n8n.ssangyong.autos`, 3 SSANGYONG workflows) | Reuse it. Additive MYTHOS-namespace workflows; existing workflows untouched. Ratified permanently as the MVP instance strategy in `docs/MYTHOS_N8N_STRATEGY.md` (no second instance during the MVP; `n8n.mythosprod.xyz` recorded but not authorised). |
| OmniRoute 3.8.49 in Docker, healthy, `127.0.0.1:20128`, not publicly exposed | **Already installed — no installation performed.** Used as the optional OpenAI-compatible gateway for advisory models. Not exposed further. |
| `projects/mythos-orchestrator/` with proven `lib/{redact,schema,git}` and a file-based task store convention | Reuse the libs by `require`; follow the same runtime-state convention. **No second redaction/verification implementation, no Postgres schema added** (AGENTS.md §10: no schema changes unless required — file store satisfies every persistence requirement). |
| Claude Code 2.1.233 for user `ubuntu` (`--print`, `--output-format json`, `--session-id`, `--resume`, `--permission-mode`, tool allow/deny) | Headless execution as `ubuntu` via a systemd **user** service with linger; the daemon shares the CLI's credentials without touching them. |
| `ubuntu` has full sudo; docker socket root-only | The executor itself runs rootless with `NoNewPrivileges=true`; sudo is structurally unreachable from AI-spawned commands. |

## 3. Provider / model abstraction (mission §9)

```text
             task.provider
                  │
   ┌──────────────┴──────────────┐
   │ execution runtime            │ advisory (reasoning only)
   │ providers/claude-code.js     │ providers/openai-compat.js → OmniRoute
   │ executionAuthority: true     │ executionAuthority: false
   │ shell/tools per profile      │ text in, text out, no cwd, no tools
   └──────────────────────────────┘
```

Only `claude-code` ever receives a working directory. Advisory tasks route
any OmniRoute-served model (GPT/Gemini/DeepSeek/Qwen/…) for analysis,
review, planning or second opinions; the executor strips execution surface
from them at task creation, not at run time. Adding an execution-capable
coding agent (e.g. Codex) means writing one provider file with
`executionAuthority: true` and registering it — the codex adapter in
`projects/mythos-orchestrator/providers/codex.js` is the reference.

## 4. Quota lifecycle (mission §7, core requirement)

1. Failure text matches quota patterns → `WAITING_FOR_QUOTA` (never FAILED).
2. Reset time parsed when the provider states one (`…|<epoch>`, "resets 3am",
   ISO); resume scheduled at reset + 3-minute grace. Otherwise conservative
   backoff: 30m → 1h → 2h → 4h (capped).
3. Two independent resumers: the daemon tick (15s) and n8n Quota Watch
   (10 min) — both idempotent, both resume the **same** `claude_session_id`.
4. A resume that finds the session gone recreates it **once**, evented as
   `session_recreated`, with checkpoint + previous report injected as
   continuity; Git remains the arbiter of what was already done.

## 5. Failure taxonomy (mission §8)

| Class | Detection | Consequence |
|---|---|---|
| quota | usage-limit patterns | `WAITING_FOR_QUOTA`, auto-resume |
| transient | overloaded/5xx/network/timeout | `WAITING_RETRY`, backoff 1m/4m/16m, then FAILED |
| blocked | billing/auth/human-decision patterns | `BLOCKED`, owner action, state preserved |
| fatal | everything else | `FAILED`, logs + checkpoint preserved, explicit re-queue only |
| interrupted | RUNNING status + dead pid | immediate `WAITING_RETRY` on next tick |
| malformed report | provider "success" without `mythos_report` | `BLOCKED` for review — never silently green |

## 6. Command authorization (mission §14)

Profiles map the READ / PROJECT_WRITE / GIT / SERVICE / DEPLOY / ROOT classes
onto Claude tool permissions (`lib/policy.js`): `repo-read` (READ),
`repo-write` (READ+PROJECT_WRITE+GIT, `acceptEdits`), `autonomous`
(bypassPermissions inside the worktree, sudo still denied), `deploy`
(**disabled**; enabling is an owner code change). ROOT is never grantable —
every profile disallows `Bash(sudo:*)` and the service adds
`NoNewPrivileges=true` beneath all of it.

## 7. Trust boundaries

- The webhook payload is data. n8n forwards a whitelisted field set (never
  `working_directory`); the executor re-validates against the schema, refuses
  unregistered projects/providers/disabled profiles, and refuses any payload
  carrying a secret shape.
- n8n workflow JSON in Git references the credential by id only.
- The executor never assumes approval: production-mutating profiles are
  disabled, and instructions cannot enable them.
- GitHub is the source of truth: reports are committed and pushed by the
  executor; a claimed commit that Git cannot corroborate is flagged
  (`verifyGit`) exactly like the orchestrator's verifier.

## 8. Observability (mission §22)

Structured JSONL per task (`events.log`: ts, task_id, execution_id, project,
stage, provider, model, status, event), journal logs from the daemon,
`GET /health` covering store, Claude CLI, n8n, OmniRoute and queue depth,
and best-effort ntfy via the orchestrator's `notify.sh` (never control flow).
