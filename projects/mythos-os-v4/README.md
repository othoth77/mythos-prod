# MYTHOS OS v4 — control plane

```
DOTS      General Manager      goals · priorities · policy · escalations      lib/dots.js      (deterministic code)
  │
FABLE 5.1 Executive Manager    turns one goal into a bounded plan             lib/executive.js + lib/engines.js
  │   ╲
  │    OPENAI  watchdog / failover   monitors FABLE, takes over, hands back   lib/watchdog.js
  │
JEV       Model Selection      free → local Qwen → paid; decides, never runs  lib/jev.js
  │
gateway                        timeout · retry · deadline · fallback          lib/gateway.js + lib/adapters.js
  │
HADDAD    Execution Layer      the step actually runs                         lib/haddad.js
```

Architecture, policy and acceptance evidence: [`docs/MYTHOS_OS_V4.md`](../../docs/MYTHOS_OS_V4.md).

## What is new here, and what is reused

New (nothing in the repository did this): DOTS, the watchdog's failover/recovery state machine, JEV, the
tiered gateway, the decision ledger, the health report.

Reused, required unmodified — v4 adds no second transport, key path or model list:

| v4 needs | existing component |
|---|---|
| free tier | `mythos-ai-executor/free-llm/selector.js` (A→B→C over the keyed free providers) |
| local tier | `mythos-haddad/lib/haddad-runtime.js` (the llama-server on the Haddad GPU) |
| paid Claude model ids | `mythos-ai-executor/config/model-policy.json` |
| OpenAI client, key file, on/off switch, role models | `mythos-orchestrator/providers/openai.js`, `config/openai.json` |
| quota / transient / blocked classification | `mythos-ai-executor/lib/quota.js` |
| secret gate and redaction | `mythos-orchestrator/lib/redact.js` |
| JSON Schema validation | `mythos-orchestrator/lib/schema.js` |
| repository work (read-only) | the executor daemon: `mythos-ai-executor enqueue` → `haddad-agent` |
| repository work (test / write) | the Supervisor: `scripts/mythos-supervise.js submit` + `watch` → Issue → Haddad bridge |

## Commands

```bash
node projects/mythos-os-v4/bin/mythos-os health            # one check per layer; --live calls real models
node projects/mythos-os-v4/bin/mythos-os goal submit --title "…" --objective "…" [--priority high] [--allow-write]
node projects/mythos-os-v4/bin/mythos-os goal run <goal-id>     # or: goal run-next
node projects/mythos-os-v4/bin/mythos-os trace <goal-id>        # every decision and result, in order
node projects/mythos-os-v4/bin/mythos-os escalation list
node projects/mythos-os-v4/bin/mythos-os escalation resolve <id> approve_write|retry|cancel
node projects/mythos-os-v4/bin/mythos-os jev status | jev reset | jev route --capability analysis
node projects/mythos-os-v4/bin/mythos-os ask --prompt "…"       # one answer through JEV + gateway
node projects/mythos-os-v4/bin/mythos-os watchdog status | tick | reset
node projects/mythos-os-v4/bin/mythos-os ledger verify
```

Exit codes: `0` ok · `1` usage / not found · `2` refused by DOTS · `3` goal not COMPLETED · `4` health FAIL · `5` internal.

## Configuration (no secrets — ever)

| file | owns |
|---|---|
| `config/dots-policy.json` | authority, goal limits, plan limits, forbidden operations, loop bounds, failover thresholds, paid budget, gateway and JEV timing, Haddad wiring |
| `config/jev-models.json` | the only models JEV may select, their tier, pools, capabilities and prompt size |

Both are validated on load and fail closed (`POLICY_INVALID`, `JEV_REGISTRY_INVALID`). Credentials stay where they
already live, outside Git: `~/.config/mythos-ai-executor/free-llm/<provider>.env`, `~/.config/mythos-haddad/runtime.key`,
`~/.config/mythos-orchestrator/openai.env`, and the Claude CLI's own login.

Environment: `MYTHOS_OS_HOME` (state, default `~/.local/state/mythos-os-v4`), `MYTHOS_OS_POLICY`, `MYTHOS_OS_JEV_MODELS`,
`MYTHOS_OS_EXECUTOR_ROOT` (the checkout whose executor CLI is called — set it to the live checkout when running from a
worktree), `MYTHOS_OS_EXECUTOR_ENV_FILE`, `MYTHOS_CLAUDE_BIN`.

## State

```
$MYTHOS_OS_HOME/
  goals/<goal-id>.json          one record per goal (0600)
  escalations/<id>.json         what the chain may not decide
  ledger/decisions.jsonl        append-only, hash-chained trace of every decision and result
  watchdog/state.json           who leads the executive, failures in the window, cooldown
  jev/health.json               per-model circuit state, quota waits, latency
  jev/spend.json                today's paid calls, per goal
```

## Scheduling

`systemd/mythos-os-watchdog.{service,timer}` run `mythos-os watchdog tick` every 5 minutes (a RUNNING goal whose runner
died is escalated, and a supervised task that runner left behind gets one Supervisor tick) and `systemd/mythos-os-health.{service,timer}` write a health report every 30 minutes. Install with
`bin/mythos-os-install.sh` **from the live checkout, after the branch is merged** — a unit must not point at a worktree.

## Tests

```bash
node tests/mythos-os-v4-core-test.js          # ledger, policy, Claude CLI, engines
node tests/mythos-os-v4-jev-gateway-test.js   # JEV, Free → Qwen → Paid, cooldown, recovery, budgets
node tests/mythos-os-v4-executive-test.js     # FABLE, OpenAI takeover, watchdog, plan review
node tests/mythos-os-v4-dots-test.js          # DOTS → FABLE → JEV → Haddad, authorisation, loop bounds, security
node tests/mythos-os-v4-runtime-test.js       # the real CLI and the health report
```

All offline: models answer from loopback HTTP servers through the real adapters, `claude` is an executable stand-in
that is really spawned, and OpenAI runs through the real provider with only its socket replaced.
