# Mythos Haddad — HAD-3: OTH MCP on Haddad

**Stage:** HAD-3 (Haddad MCP) · **Date:** 2026-09-22 (completed the same day, second pass) · **Branch:** `mythos-haddad/had-3-mcp` · **PR:** #366
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
| **ESSENTIAL (V1 scope)** | `haddad_health` — Haddad's own state: health, GPU, AI runtime + pinned model, worker, MCP | the stated purpose of HAD-3 in `docs/MYTHOS_HADDAD_V1_SCOPE.md` ("read Haddad's state — health, GPU, runtime"). The data already existed (`health-latest.json`, written by the health timer); the tool is a bounded read of that one file, registered **only** where `OTH_MCP_HADDAD_HEALTH_FILE` is set. `haddad_gpu` / `haddad_runtime` from the scope are its `check: gpu_test` / `check: ai_runtime` views — one tool, not three |
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

So: **`projects/oth-mcp/server.js` is not copied at all** — the launcher runs it from a
checkout on Haddad. What is Haddad-specific is configuration, plus **one** host-conditional
tool inside the shared server (66 lines, env-gated, see §4a):

```
remote Claude / Mythos component
   │  ssh othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh     (tailnet only, port 22 they already use)
   ▼
haddad-mcp-stdio.sh            sources ~/.config/mythos-haddad/mcp.env (0600, NO secret)
   │                           reads the executor bearer BY REFERENCE from the executor's own
   │                           ~/.config/mythos-ai-executor/executor.env (0600), exports, execs
   ▼
projects/oth-mcp/server.js     SHARED — stdio JSON-RPC, 8 tools everywhere + haddad_health where configured
   ├─ execution_* / budget_status ─▶ 127.0.0.1:8130  Haddad executor (bearer)     ESSENTIAL
   ├─ project_context / capability_registry ─▶ https://othmode.mythosprod.xyz     public read
   ├─ system_health ─▶ https://status.mythosprod.xyz                              public read
   ├─ haddad_health ─▶ ~/.local/state/mythos-haddad/health-latest.json (fixed at launch)   local read
   └─ knowledge_* ─▶ UNCONFIGURED (HAD-1)                                         fail-closed
```

## 4. Files

| File | Role |
|---|---|
| `projects/oth-mcp/server.js` | **+66 lines, shared:** `haddad_health`, registered only when `OTH_MCP_HADDAD_HEALTH_FILE` is set; one bounded `readFileSync` of that launch-time path; `stale` flag (> 2 h); optional `check` filter (`[a-z_]{2,32}`); absent → `UPSTREAM_UNREACHABLE`, corrupt → `UPSTREAM_BAD_JSON`, unknown check → `TOOL_INPUT` listing the known ids. No write syscall (asserted). VPS: variable unset → exactly the 8 tools it had; `othk-6` 58/0, `mcp-ecosystem` 168/0, `gateway-boundary` 37/0 unchanged |
| `bin/haddad-mcp-stdio.sh` | launcher template (Haddad twin of the VPS `oth-mcp-stdio.sh`); installed to `~/.local/bin/` with `@REPO@` filled |
| `bin/haddad-mcp-setup.sh` | idempotent, no root: writes `mcp.env`, provisions the executor bearer **only if absent** with the executor's own idiom (`projects/mythos-ai-executor/deploy/install.sh` step 1), installs the launcher, verifies a real `initialize` + `tools/list` |
| `bin/haddad-mcp-probe.js` | drives the installed launcher through the **existing** `projects/mythos-gateway/lib/mcp-client.js` (stdio): initialize → tools/list → one real `tools/call`; one JSON report. Used by the health check and the setup; not a client implementation |
| `bin/haddad-health.js` | new checks `worker` (unit active, `/health` answers, store writable, queue counts, code identity, bearer provisioned) and `mcp` (real handshake through the installed launcher via the probe; expected tool count 8/9 from `mcp.env`; PASS only when `execution_status` really answered; **FAIL if the VPS bridge/gateway ports 8160/4444 ever listen here** — the Haddad MCP is stdio-only). Both WARN when not installed, like `ai_runtime` |
| `tests/mythos-haddad-mcp-test.js` | 17 checks, offline (§7) |

**Not added:** a systemd unit (stdio servers are spawned by SSH, exactly as on the VPS), a
port, a firewall rule, a second server file, a client config in git.

## 5. Configuration

`~/.config/mythos-haddad/mcp.env` (generated, 0600, contains **no** secret):

```
OTH_MCP_EXECUTOR_URL=http://127.0.0.1:8130
OTH_MCP_EXECUTOR_TOKEN_FILE=/home/othman/.config/mythos-ai-executor/executor.env
OTH_MCP_OTHMODE_URL=https://othmode.mythosprod.xyz
OTH_MCP_HADDAD_HEALTH_FILE=/home/othman/.local/state/mythos-haddad/health-latest.json
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
| Credentials | bearer held by reference; **never** in `mcp.env`, git, output or logs. Live check: all 9 tools' full output (148 KB) grepped for the executor bearer, the runtime key, the GitHub token and the advisory key → **0 / 0 / 0 / 0**; a canary variable placed in the launcher environment never reaches a client (tested) |
| Authorization | unchanged model: a wrong bearer is refused by the executor and surfaces as `UPSTREAM_401`; an absent one as `UPSTREAM_UNCONFIGURED` with no upstream call made (tested) |
| Write boundary | intact: `GET` is still the only upstream verb and no write syscall exists in `server.js` (asserted by `othk-6` §W and by the Haddad suite); `haddad_health` reads one file whose path is fixed at launch — a request cannot name a file, and the path never appears in an error |
| Public reads | `project_context`/`capability_registry` go to OTHMODE's public, `auth:false`, redacted read model — the same surface any browser gets; no token is sent because none is configured |
| Resource use | one server process per client: RSS ≈ 4 MiB, exits with its stdin — 0 lingering processes after client kill and after SSH client kill (verified with an exact process match) |

## 7. Tests

| Suite | Result |
|---|---|
| `tests/mythos-haddad-mcp-test.js` (new) | **17 / 0** — reuse assertion (launcher runs the shared server, no second server under `mythos-haddad`), no secret / no host-key bypass / no sudo, shared server is the VPS one (8 tools, GET-only, `2024-11-05`), health check present; then against a fake loopback executor: full chain with bearer-by-reference (bearer reaches the upstream, never the client), UNCONFIGURED with no upstream call, `UPSTREAM_401`, malformed frame → `-32700`, unknown method → `-32601`, unknown tool, missing/oversized/traversal inputs, unreachable upstream, three concurrent clients, `haddad_health` (whole / one check / stale / bad id / absent / corrupt / unconfigured ⇒ tool absent), a real 15 s `UPSTREAM_TIMEOUT` against an executor that accepts and never answers, environment-canary leak check, knowledge fail-closed, setup dry-run into a throwaway `$HOME` (files, modes 0750/0600, token idiom, idempotent, token never printed) |
| `tests/othk-6-mcp-server-test.js` (existing, reused) | **58 / 0** on Haddad — the shared server, still 8 tools and no write |
| `tests/mcp-ecosystem-test.js`, `tests/gateway-boundary-test.js` (existing) | **168 / 0**, **37 / 0** — registry, bridge and `TOOLS.length === 8` assumptions of the VPS estate hold |
| Haddad regression | v0 8/0 · runtime 9/0 · fable-worker 15/0 · advisory-profile 14/0 · multi-project 73/0 |
| `bin/haddad-health.js` (full) | **16 / 0 / 0** — `worker` PASS (daemon active, store writable, queue BLOCKED=4 COMPLETED=22, code identity), `mcp` PASS ("9 tools, execution_status answered from the Haddad executor, no listener") |

## 8. Real E2E (2026-09-22, Haddad)

1. **Real MCP client, real transport, three tool classes in one session.** Claude Code 2.1.278 (`claude -p --mcp-config … --strict-mcp-config`, server command `ssh -o BatchMode=yes othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh`) asked to call `execution_status`, `haddad_health {check: ai_runtime}` and `system_health` answered:
   `TASKS=26 MODEL=qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf HOST=vps-4722f0a9 LIVE=26`
   Cross-checked: `GET /tasks` on the executor → 26 tasks; the runtime's `/v1/models` → that model id; the Status Center snapshot at that minute → `LIVE: 26, DEGRADED: 1` (`vps-resources`, swap 90 % — a VPS condition, see §9). **Every value correct.** (First pass, same day: `TASKS=26 FIRST=t-20260921102118-y0rvkw STATUS=BLOCKED`, identical to the executor.)
2. **Every tool over SSH-stdio via the Tailscale address** (`mcp-client.js`): `execution_report` → a real Haddad task's `{report, markdown}`; `budget_status mythos-haddad` → the executor's ledger; `project_context` → OTHMODE portfolio; `capability_registry` → tools view; `system_health` → estate snapshot; `haddad_health` whole → 16 checks, `stale:false`, `age 1s`; `check: gpu_test` → "GTX 1660 SUPER (NVK), Vulkan 1.4.335, 6400 MiB VRAM, fill 3456.9 MiB/s"; `check: ai_runtime` → the pinned model; `check: worker` → queue + code identity; `knowledge_search` → `UPSTREAM_UNCONFIGURED` (expected).
3. **Reliability, live:** executor restarted while probing → the next call answered from the new daemon (bearer persists in its file, 26 tasks); server process `SIGKILL`ed mid-call → client got `MCP_TRANSPORT_CLOSED`, 0 servers left; SSH client killed mid-session → 0 servers left after 1.5 s; three concurrent SSH clients → each answered; listeners after everything: `:22`, `127.0.0.1:8600`, `127.0.0.1:8130` only.
4. **Isolation cross-check:** the same Haddad task id asked of the **VPS** MCP (through the gateway) → `UPSTREAM_404`.

## 9. VPS non-regression

Nothing on the VPS was touched (no access from Haddad exists; none was created). Through the
gateway after the work: `generated_at 2026-09-22T10:15:16Z`, **26 LIVE / 1 DEGRADED / 0 DOWN** —
the degraded probe is `vps-resources` (disk 77 %, swap 90 %), the VPS's known memory pressure
(`docs/MYTHOS_MCP_ECOSYSTEM.md` §1.3), unrelated to this work; `mcp-bridge-loopback` and
`mcp-gateway-loopback` LIVE; `capability_registry` and `execution_status` answered through the
full VPS chain; OTHMODE `/api/othmode/mcp` and `/projects` → 200. The VPS server keeps 8 tools:
`OTH_MCP_HADDAD_HEALTH_FILE` is unset there, and the estate registry / registry check / ecosystem
suite still expect and get 8. No DNS, port, TLS or proxy change anywhere.

**How the two MCPs relate.** They do not talk to each other. Both are the same server file,
each reached by its own client path: the VPS one via ContextForge (HTTPS `/gateway/`, per-client
JWT — this is how Claude sessions get `mythos-mcp-*`), Haddad's via SSH-stdio over the tailnet.
A client that wants both configures both. Registering Haddad as a peer in the VPS estate
registry would require a VPS→Haddad SSH credential that does not exist — an owner decision,
deferred (§11).

## 10. Operate

```bash
# install / re-verify (idempotent)
HADDAD_MCP_REPO=$HOME/projects/mythos-prod bash projects/mythos-haddad/bin/haddad-mcp-setup.sh
# probe as a client (one real tool call)
node projects/mythos-haddad/bin/haddad-mcp-probe.js --call budget_status '{"project":"mythos-haddad"}'
node projects/mythos-haddad/bin/haddad-mcp-probe.js --call haddad_health '{"check":"ai_runtime"}'
# health
node projects/mythos-haddad/bin/haddad-health.js --quick
# a remote client (Claude Code) — no token in the config
claude mcp add haddad -- ssh othman@100.78.7.10 /home/othman/.local/bin/haddad-mcp-stdio.sh
```

Rollback: `rm ~/.local/bin/haddad-mcp-stdio.sh ~/.config/mythos-haddad/mcp.env`. The executor
bearer file may stay (it only lets a bearer holder read the executor over loopback).

### Troubleshooting

| Symptom | Cause → action |
|---|---|
| `UPSTREAM_401: Mythos AI Executor answered 401` | the executor started before its bearer file existed → `systemctl --user restart mythos-haddad-worker.service` when nothing is RUNNING |
| `UPSTREAM_UNCONFIGURED: Mythos AI Executor …` | `mcp.env` missing or `OTH_MCP_EXECUTOR_TOKEN_FILE` unreadable → re-run `haddad-mcp-setup.sh` |
| `UPSTREAM_UNREACHABLE: Mythos AI Executor …` | worker not active → `journalctl --user -u mythos-haddad-worker` |
| `UPSTREAM_UNREACHABLE: Mythos Haddad health report is not present` | the health timer has not written yet → `node bin/haddad-health.js` |
| `haddad_health` says `stale: true` | timer stopped → `systemctl --user list-timers mythos-haddad-health.timer` |
| `tools/list` shows 8, not 9 | the launcher's `REPO` checkout predates this stage, or `mcp.env` lacks `OTH_MCP_HADDAD_HEALTH_FILE` → re-run setup with `HADDAD_MCP_REPO=<checkout carrying this branch>` |
| health `mcp` FAIL "unexpected MCP listener" | something bound 8160/4444 on Haddad — not part of this design; find it with `ss -ltnp` |
| client hangs on connect | SSH itself: `ssh -o BatchMode=yes othman@100.78.7.10 true` must succeed with a key |

## 11. Deferred (not blockers for V1) and limits

- **`knowledge_search` / `knowledge_get`** stay `UPSTREAM_UNCONFIGURED` until HAD-1 delivers a local OTHKM store. Not a V1-MCP requirement; health does not fail on it.
- **Estate registry entry for Haddad** (`projects/mythos-gateway/registry/mcp-registry.json`): the VPS registry check would have to spawn `ssh othman@haddad`, which needs a VPS→Haddad credential that does not exist — owner decision. Until then Haddad's MCP is discovered by its own health check, not by the VPS.
- **Launcher checkout:** the installed launcher runs `server.js` from the checkout given at setup. On Haddad it currently points at the worktree of this branch (`~/projects/worktrees/mythos-haddad-mcp`) because `~/projects/mythos-prod` is the running worker's checkout on another branch and must not be switched. After merge: `HADDAD_MCP_REPO=$HOME/projects/mythos-prod bash …/haddad-mcp-setup.sh` (idempotent) re-points it. The scheduled health timer likewise shows `worker`/`mcp` once that checkout carries this branch.
- **Protocol version** stays `2024-11-05`: stdio has no sessions, the server implements exactly the three stable methods, and the real client accepted it. A bump would touch the VPS server for no functional gain.
- Still pending from V0: the Windows client's SSH key + `PasswordAuthentication no` — the MCP inherits Haddad's SSH policy and adds no access of its own.
- Out of scope by instruction and untouched: Qwen supervisor / repair loops, Sonnet/Opus escalation, delegate-skills, browser use. Nothing here blocks them: the MCP is an interface; execution authority stays in the executor/worker policy.
