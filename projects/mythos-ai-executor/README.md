# Mythos AI Executor

Persistent autonomous execution system: ChatGPT (or the owner) drops a task
into n8n; the executor runs it through Claude Code headlessly, survives
interruption and quota exhaustion, resumes the same session automatically,
validates against Git, and publishes a durable report — no copy/paste loop.

```text
ChatGPT decision → n8n webhook (authenticated) → task queue (persistent)
      → mythos-ai-executor daemon → claude -p (pinned session id)
      → validate → checkpoint → report → git commit/push
      → docs/AI_EXECUTION_REPORT.md → ChatGPT reads → next task
```

## Layout

| Path | Role |
|---|---|
| `executor.js` | Core engine: create/run/resume tasks, scheduler tick, health |
| `server.js` | Internal HTTP API for n8n (loopback + Docker bridge only, bearer auth) |
| `bin/mythos-ai-executor` | CLI: enqueue / run / resume / status / report / list / health / serve |
| `lib/state.js` | Persistent store + state machine (atomic writes, evented transitions) |
| `lib/quota.js` | Quota / transient / blocked / fatal classification, reset-time parsing, backoff |
| `lib/policy.js` | Execution profiles → exact Claude tool permissions; sudo never grantable |
| `lib/report.js` | `mythos_report` extraction + validation + markdown rendering |
| `providers/claude-code.js` | The ONLY provider with execution authority (headless `claude -p`) |
| `providers/openai-compat.js` | Advisory-only provider via OmniRoute (`127.0.0.1:20128/v1`) |
| `providers/mock.js` | Test fixture provider; unreachable in production |
| `n8n/*.json` | The five MYTHOS workflows (no secrets; credential by id reference) |
| `service/` + `deploy/install.sh` | systemd user service + idempotent installer |
| `schemas/task.schema.json` | Task contract; carries no credentials, refuses `/tmp` |
| `templates/task-prompt.md` | Prompt contract incl. checkpoint continuity + report block |

Shared code is **reused from `projects/mythos-orchestrator/lib/`** (redact,
schema, git) — one redaction and one Git-verification implementation in the
repository, not two.

## Runtime state (outside Git, never /tmp)

```text
/home/ubuntu/mythos-ai-executor/tasks/<task-id>/
    task.json  status.json  checkpoint.json  prompt.md
    stdout.log stderr.log   report.json  report.md  events.log
```

## Task lifecycle

`QUEUED → RUNNING → COMPLETED | FAILED | BLOCKED | WAITING_FOR_QUOTA |
WAITING_RETRY | CANCELLED`, enforced by a transition table. Quota
exhaustion is **never** a failure: the task parks in `WAITING_FOR_QUOTA`
with the detected reset time (or conservative 30m/1h/2h/4h backoff), and
both the daemon and the n8n Quota Watch resume the **same Claude session**
(`--resume <session-id>`) when the window reopens. Transient failures retry
with bounded backoff (1m/4m/16m, then FAILED). A dead executor is recovered
on the next tick: RUNNING with a dead pid becomes an immediate resume.

## Security model

- Bearer token in `~/.config/mythos-ai-executor/executor.env` (0600); the
  same token authenticates n8n webhooks (header-auth credential imported by
  id, never committed).
- API binds `127.0.0.1` and the n8n Docker gateway `172.18.0.1` only; ufw
  admits only the n8n subnet to port 8130.
- The systemd unit sets `NoNewPrivileges=true`: nothing the executor spawns
  can ever sudo, regardless of profile bugs.
- Task envelopes are refused if they contain a secret shape; all persisted
  output passes the shared redaction.
- The `deploy` profile exists but is **disabled**; enabling it is an owner
  decision in `lib/policy.js`, not a task-payload option.

## Operate

```bash
# health
curl -s http://127.0.0.1:8130/health

# queue a task from the VPS
projects/mythos-ai-executor/bin/mythos-ai-executor enqueue task.json

# queue a task through n8n (from anywhere, with the token)
curl -X POST https://n8n.ssangyong.autos/webhook/mythos/task \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"project":"mythos-prod","stage":"X","instruction":"...","execution_profile":"repo-read"}'

# watch
bin/mythos-ai-executor list
bin/mythos-ai-executor status <task-id>
bin/mythos-ai-executor report <task-id>
journalctl --user -u mythos-ai-executor -f
```

Tests: `node tests/mythos-ai-executor-test.js` (offline, mock provider, no
real quota consumed).
