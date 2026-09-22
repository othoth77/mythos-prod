# Mythos Haddad — HAD-3: OTH MCP on Haddad

**Stage:** HAD-3 (Haddad MCP) · **Date:** 2026-09-22 · **Branch:** `mythos-haddad/had-3-mcp`
**Method:** the VPS MCP was audited from its source (byte-identical on `main`), its live behaviour
(the gateway-federated tools this repository's Claude sessions already use), and its recorded
deployment (`projects/oth-mcp/README.md`, `docs/MYTHOS_MCP_ECOSYSTEM.md`). Haddad was inspected
directly. Nothing below is inferred from documentation alone; what could not be verified says so.

---

## 1. What the VPS runs (audit)

| Item | Finding |
|---|---|
| Component | **OTH MCP** — the controlled *read* interface over existing MYTHOS systems |
| Source | `projects/oth-mcp/server.js`, 389 lines, **zero dependencies** (`http`, `https`, `url` only), sha256 `96a1c0df…9ce52` on `main` `d2129640` |
| Deployed | `/home/deploy/oth-mcp/projects/oth-mcp/server.js` (worktree), launcher `/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh` (0750), env `/home/deploy/deployments/oth-mcp/.env` (0600, never committed) — per `projects/oth-mcp/README.md`, "Deployed paths (verified 2026-08-30)" |
| Runs as | `deploy`, **no systemd unit**: one process per client, spawned on that client's stdio |
| Transport | newline-delimited JSON-RPC 2.0 over **stdio**; clients reach it with `ssh deploy@host …/oth-mcp-stdio.sh`. A second path exists for the gateway only: `mythos-mcp-http.service` (`projects/mythos-gateway/mcp-http-bridge.js`, Streamable HTTP on `127.0.0.1:8160` + `10.0.60.1:8160`, bearer) federated by ContextForge (`:4444`, public `/gateway/`) |
| Protocol | `PROTOCOL_VERSION = '2024-11-05'`; methods `initialize`, `notifications/initialized`, `notifications/cancelled`, `ping`, `tools/list`, `tools/call`. No resources, no prompts, no sessions, no OAuth |
| SDK | none, by a measured decision (91 packages / 24 MB declined; README "Why no `@modelcontextprotocol/sdk`") |
| Tools (8, all read-only) | `knowledge_search`, `knowledge_get` → OTH Knowledge `:8150` (bearer) · `project_context`, `capability_registry` → OTHMODE `:3021` (`auth:false` reads) · `execution_status`, `execution_report`, `budget_status` → AI Executor `:8130` (bearer) · `system_health` → Status Center (public HTTPS) |
| Write boundary | `upstreamGet` is the **only** upstream function; `method: 'GET'` is the only verb in the file — asserted by `tests/othk-6-mcp-server-test.js` §W |
| Auth / secrets | none of its own; per-upstream bearer from the environment (`OTH_MCP_*_TOKEN`), never logged, never returned. An upstream without a token answers `UPSTREAM_UNCONFIGURED` naming the owner |
| Bounds | 15 s upstream timeout, 512 KiB response cap, every input length-capped, `project` restricted to `[a-z0-9][a-z0-9-]{1,63}` (traversal unrepresentable), ids URL-encoded |
| Who connects | ContextForge (via the bridge) — that is how this repository's Claude sessions get the `mythos-mcp-*` tools; SSH-stdio clients per the README recipe. No on-host agent config consumes it directly |
| Tests | `tests/othk-6-mcp-server-test.js` (58 assertions, offline, drives the server as a real stdio client) |
| Live on 2026-09-22 | `system_health` through the gateway: `generated_at 2026-09-22T09:06:57Z`, 27 LIVE / 0 DOWN incl. `mcp-gateway-loopback`, `mcp-bridge-loopback`; `capability_registry providers` answered; `execution_status` for a Haddad task id → `UPSTREAM_404` from the **VPS** executor (the two executors are isolated, as designed) |
| Not verified from Haddad | byte identity of the deployed VPS copy (no SSH from Haddad to the VPS exists, and none was created); the recorded identity is from `docs/MYTHOS_MCP_ECOSYSTEM.md` §1.1 and the live tool descriptions match the source exactly |

**Legacy behaviour:** none that affects Haddad. The server does not use protocol-level sessions
(they never existed on stdio), so the 2026-07-28 spec's stateless core changes nothing here. It
still *declares* `2024-11-05`; version negotiation lets a client accept or disconnect, and the
real client used for E2E (Claude Code 2.1.278) accepted it. Bumping the declared version is a
shared-source change with no functional need and is deliberately **not** made in this stage.

## 2. Classification — what Haddad needs

| Class | Item | Why |
|---|---|---|
| **ESSENTIAL** | `execution_status`, `execution_report`, `budget_status` | Haddad runs its **own** executor (`mythos-haddad-worker.service`, `127.0.0.1:8130`, store `~/mythos-ai-executor-haddad`). Its tasks — the Qwen worker's real work — were readable by nothing but the local HTTP API. This is the Haddad-specific truth the MCP surfaces |
| **ESSENTIAL** | the server pattern itself, the stdio transport, the SSH launcher, the offline test | this is the house pattern `docs/MYTHOS_HADDAD_V1_SCOPE.md` HAD-3 names, and it is what a remote Claude session needs to talk to Haddad at all |
| **OPTIONAL (reused, not duplicated)** | `project_context`, `capability_registry` | there is no OTHMODE on Haddad and building one is forbidden (`SYSTEM_INDEX` §41). The tools are pointed at OTHMODE's **public** read model (`https://othmode.mythosprod.xyz`, `auth:false` by its own route table — the same class of read the VPS server performs on loopback). Same data a VPS client gets; kept so the tool set answers instead of erroring |
| **OPTIONAL (as-is)** | `system_health` | public Status Center, server default, works from anywhere |
| **DEFERRED, fail-closed** | `knowledge_search`, `knowledge_get` | no OTHKM store on Haddad until HAD-1. Left **unconfigured**: the tools answer `UPSTREAM_UNCONFIGURED: OTH Knowledge …`, never a guess. Not built here (scope rule: no new memory system) |
| **VPS-ONLY** | `mythos-mcp-http` bridge, ContextForge gateway, nginx `/gateway/` + TLS, `github-mcp-rw`, `github-mcp` (ro), `context7`, the OOM drop-ins, the registry-check timer | they exist to federate the VPS server to *remote HTTP* clients. Haddad's design rule is "no new port" (V1 scope §3): its clients come over SSH they already have. None transferred |
| **UNSAFE to copy** | `/home/deploy/deployments/oth-mcp/.env` and every VPS token; `/home/deploy/…` paths; the `deploy` user assumption | credentials are per-host by design; nothing copied. Haddad's config is generated on Haddad |
| **DUPLICATE (not rebuilt)** | an MCP client, a health monitor, a queue, an executor, a knowledge engine | `projects/mythos-gateway/lib/mcp-client.js` is reused for the probe; `haddad-health.js` gained one check; the executor is the existing one |

## 3. Architecture decision: **B — same source, configuration adapted**

Not A: a verbatim copy of the deployment would carry `deploy` paths, the VPS `.env` and the
VPS upstream map (`:8150`, `:3021` — neither exists on Haddad).
Not C: there is no sub-part to extract — every tool is a routed `GET`; the value is the whole file.
Not D: Haddad had **no** MCP (no `mcpServers` in `~/.claude.json`, no `.mcp.json`, no server
under `projects/mythos-haddad/`, nothing listening but `:8600` and `:8130`).
Not E: the executor tools are the only way to read Haddad's task truth without the bearer.

So: **`projects/oth-mcp/server.js` is not copied at all** — the launcher runs it from the
checkout Haddad already has (`~/projects/mythos-prod`, the same checkout the worker unit runs
from). What is Haddad-specific is configuration, and only that:

```
remote Claude / Mythos component
   │  ssh othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh     (tailnet only, port 22 they already use)
   ▼
haddad-mcp-stdio.sh            sources ~/.config/mythos-haddad/mcp.env (0600, NO secret)
   │                           reads the executor bearer BY REFERENCE from the executor's own
   │                           ~/.config/mythos-ai-executor/executor.env (0600), exports, execs
   ▼
projects/oth-mcp/server.js     UNCHANGED (sha256 96a1c0df…)  — stdio JSON-RPC, 8 tools
   ├─ execution_* / budget_status ─▶ 127.0.0.1:8130  Haddad executor (bearer)     ESSENTIAL
   ├─ project_context / capability_registry ─▶ https://othmode.mythosprod.xyz     public read
   ├─ system_health ─▶ https://status.mythosprod.xyz                              public read
   └─ knowledge_* ─▶ UNCONFIGURED (HAD-1)                                         fail-closed
```

## 4. Files

| File | Role |
|---|---|
| `bin/haddad-mcp-stdio.sh` | launcher template (Haddad twin of the VPS `oth-mcp-stdio.sh`); installed to `~/.local/bin/` with `@REPO@` filled |
| `bin/haddad-mcp-setup.sh` | idempotent, no root: writes `mcp.env`, provisions the executor bearer **only if absent** with the executor's own idiom (`projects/mythos-ai-executor/deploy/install.sh` step 1), installs the launcher, verifies a real `initialize` + `tools/list` |
| `bin/haddad-mcp-probe.js` | drives the installed launcher through the **existing** `projects/mythos-gateway/lib/mcp-client.js` (stdio): initialize → tools/list → one real `tools/call`; one JSON report. Used by the health check and the setup; not a client implementation |
| `bin/haddad-health.js` | new check `mcp` (WARN when not installed, like `ai_runtime`; PASS only when `execution_status` really answered from the executor) |
| `tests/mythos-haddad-mcp-test.js` | 14 checks, offline (§7) |

**Not added:** a systemd unit (stdio servers are spawned by SSH, exactly as on the VPS), a
port, a firewall rule, a second server file, a client config in git.

## 5. Configuration

`~/.config/mythos-haddad/mcp.env` (generated, 0600, contains **no** secret):

```
OTH_MCP_EXECUTOR_URL=http://127.0.0.1:8130
OTH_MCP_EXECUTOR_TOKEN_FILE=/home/othman/.config/mythos-ai-executor/executor.env
OTH_MCP_OTHMODE_URL=https://othmode.mythosprod.xyz
```

Overrides at setup time: `HADDAD_MCP_REPO`, `HADDAD_MCP_OTHMODE_URL`, `HADDAD_MCP_EXECUTOR_URL`,
`HADDAD_MCP_CONFIG_DIR`, `HADDAD_MCP_BIN_DIR`. Timeouts and size caps are the server's own
(15 s, 512 KiB). Logging: a stdio server writes nothing; the SSH session is in `journalctl -u ssh`
and every executor read is a normal request in `journalctl --user -u mythos-haddad-worker`.

**The one side effect on Haddad:** `~/.config/mythos-ai-executor/executor.env` now exists.
Before this stage the Haddad executor had **no bearer provisioned**, so every authenticated route
refused (`WARNING: no MYTHOS_EXECUTOR_TOKEN provisioned` in its journal) and nothing could read
its tasks over HTTP. The file is the executor's own, in the executor's own format and location;
the executor reads it at start, so the worker was restarted once (queue: 4 BLOCKED / 22 COMPLETED,
nothing RUNNING; same counts after).

## 6. Security

| Item | Verified |
|---|---|
| Exposure | no listener added (`ss -ltn` unchanged: `:8600` and `:8130` loopback, `:22`). The MCP is reachable only by an account that can already SSH to `haddad` as `othman` over the tailnet — it grants **no** new access |
| Privilege | runs as `othman`, no sudo anywhere (asserted by the test), no root file touched |
| Command execution | the launcher `exec`s exactly one file, `projects/oth-mcp/server.js`; the server spawns nothing |
| Filesystem | the server reads no file; the launcher reads two 0600 files it owns. `execution_report` ids are URL-encoded and the executor route regex is `[a-z0-9-]{8,64}` — `../../etc/passwd` becomes `..%2F..%2Fetc%2Fpasswd` → `UPSTREAM_404`, never a path; `budget_status` refuses anything outside `[a-z0-9][a-z0-9-]{1,63}` (tested). Symlink escape: no path is ever composed from input |
| Credentials | bearer held by reference; **never** in `mcp.env`, git, output or logs. Live check: all 8 tools' full output (163 KB) grepped for the executor bearer, the runtime key and the GitHub token → **0 / 0 / 0** |
| Authorization | unchanged model: a wrong bearer is refused by the executor and surfaces as `UPSTREAM_401`; an absent one as `UPSTREAM_UNCONFIGURED` with no upstream call made (tested) |
| Write boundary | untouched: `server.js` unchanged; the test asserts `GET` is the only verb |
| Public reads | `project_context`/`capability_registry` go to OTHMODE's public, `auth:false`, redacted read model — the same surface any browser gets; no token is sent because none is configured |
| Resource use | one server process per client: RSS ≈ 4 MiB, exits with its stdin — 0 lingering processes after client kill and after SSH client kill (verified with an exact process match) |

## 7. Tests

| Suite | Result |
|---|---|
| `tests/mythos-haddad-mcp-test.js` (new) | **14 / 0** — reuse assertion (launcher runs the shared server, no second server under `mythos-haddad`), no secret / no host-key bypass / no sudo, shared server is the VPS one (8 tools, GET-only, `2024-11-05`), health check present; then against a fake loopback executor: full chain with bearer-by-reference (bearer reaches the upstream, never the client), UNCONFIGURED with no upstream call, `UPSTREAM_401`, malformed frame → `-32700`, unknown method → `-32601`, unknown tool, missing/oversized/traversal inputs, unreachable upstream, three concurrent clients, knowledge fail-closed, setup dry-run into a throwaway `$HOME` (files, modes 0750/0600, token idiom, idempotent, token never printed) |
| `tests/othk-6-mcp-server-test.js` (existing, reused) | **58 / 0** on Haddad — the server itself, unchanged |
| Haddad regression | v0 8/0 · runtime 9/0 · fable-worker 15/0 · advisory-profile 14/0 · multi-project 73/0 |
| `bin/haddad-health.js --quick` | `mcp` **PASS** — "oth-mcp 1.0.0 (protocol 2024-11-05) over stdio, 8 tools, execution_status answered from the Haddad executor" |

## 8. Real E2E (2026-09-22, Haddad)

1. **Real MCP client, real transport.** Claude Code 2.1.278 (`claude -p --mcp-config … --strict-mcp-config`, server command `ssh -o BatchMode=yes othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh`, tools allow-listed to `mcp__haddad__execution_status`) asked to call `execution_status` answered:
   `TASKS=26 FIRST=t-20260921102118-y0rvkw STATUS=BLOCKED`
   Cross-checked directly against the executor (`GET /tasks` with the bearer): 26 tasks, first `t-20260921102118-y0rvkw`, `BLOCKED`. **Correct.**
2. **Every tool group over SSH-stdio via the Tailscale address** (probe through `mcp-client.js`): `execution_report` → `{report, markdown}` of a real Haddad task; `budget_status mythos-haddad` → the executor's ledger; `project_context` → OTHMODE portfolio; `system_health` → Status Center snapshot; `knowledge_search` → `UPSTREAM_UNCONFIGURED: OTH Knowledge …` (expected). Three concurrent SSH clients each answered.
3. **Isolation cross-check:** the same task id asked of the **VPS** MCP (through the gateway) → `UPSTREAM_404` — the VPS executor does not know Haddad's tasks and vice versa.

## 9. VPS non-regression

Nothing on the VPS was touched (no access from Haddad exists; none was created). After the work:
`system_health` through the gateway `generated_at 2026-09-22T09:06:57Z`, 27 LIVE / 0 DOWN;
`capability_registry` and `execution_status` answered through the full VPS chain
(ContextForge → bridge → oth-mcp → upstreams).

## 10. Operate

```bash
# install / re-verify (idempotent)
HADDAD_MCP_REPO=$HOME/projects/mythos-prod bash projects/mythos-haddad/bin/haddad-mcp-setup.sh
# probe as a client (one real tool call)
node projects/mythos-haddad/bin/haddad-mcp-probe.js --call budget_status '{"project":"mythos-haddad"}'
# health
node projects/mythos-haddad/bin/haddad-health.js --quick
# a remote client (Claude Code) — no token in the config
claude mcp add haddad -- ssh othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh
```

Rollback: `rm ~/.local/bin/haddad-mcp-stdio.sh ~/.config/mythos-haddad/mcp.env`. The executor
bearer file may stay (it only lets a bearer holder read the executor over loopback).

## 11. Open / next

- **Haddad-native tools** (`haddad_health`, `haddad_gpu`, `haddad_runtime`, `haddad_knowledge_search` from the V1 scope) are **not** in this stage: the instruction was to reuse the VPS function with minimal change, and adding tools means changing the shared `server.js` or adding a second server — an owner decision. The state they would expose is already readable by SSH (`health-latest.json`).
- `knowledge_*` stay unconfigured until HAD-1 delivers a local store.
- The scheduled health timer runs from `~/projects/mythos-prod`; the `mcp` check appears in `health-latest.json` once that checkout carries this branch (merged, or checked out).
- Still pending from V0: the Windows client's SSH key + `PasswordAuthentication no` — the MCP inherits whatever SSH policy Haddad has.
