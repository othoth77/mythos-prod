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
| **DEFERRED, fail-closed** | `knowledge_search`, `knowledge_get` | no OTHKM store on Haddad, permanently: owner decision (a) of 2026-09-23 keeps one canonical store on the VPS and creates no duplicate here. Left **unconfigured**: the tools answer `UPSTREAM_UNCONFIGURED: OTH Knowledge …`, never a guess. Not built here (scope rule: no new memory system) |
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
| `bin/haddad-mcp-probe.js` | drives the installed launcher through the **existing** `projects/mythos-gateway/lib/mcp-client.js` (stdio): initialize → tools/list → one real `tools/call`; one JSON report. Used by the health check and the setup; not a client implementation. **HAD-3b:** `--http <url>` drives the same client's streamable-http transport against the bridge; the bearer is read by reference from `mcp-http.env` inside the process, never from argv |
| `bin/haddad-health.js` | new checks `worker` (unit active, `/health` answers, store writable, queue counts, code identity, bearer provisioned) and `mcp` (real handshake through the installed launcher via the probe; expected tool count 8/9 from `mcp.env`; PASS only when `execution_status` really answered; **FAIL if 4444 ever listens here, or 8160 listens without this user's `mythos-haddad-mcp-http` unit owning it, or 8160 is bound anywhere but `127.0.0.1`**; with the unit installed (HAD-3b, §12) the check also measures the bridge: env file 0600 with exactly one variable, unit active, unauthenticated `tools/list` → 401, HTTP handshake lists the same tools as stdio, Tailscale Serve URL reported as found). Both WARN when not installed, like `ai_runtime` |
| `tests/mythos-haddad-mcp-test.js` | 17 checks, offline (§7); **22** since HAD-3b (§12) |
| `systemd/mythos-haddad-mcp-http.service`, `bin/haddad-mcp-http-setup.sh` | **HAD-3b (§12):** user unit running the **unchanged** VPS bridge `projects/mythos-gateway/mcp-http-bridge.js` on `127.0.0.1:8160` in front of the installed launcher; idempotent setup (bearer, unit, verification, optional Tailscale Serve) |

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
| health `mcp` FAIL "unexpected MCP listener" | 4444, or 8160 without `~/.config/systemd/user/mythos-haddad-mcp-http.service` installed — not part of this design; find it with `ss -ltnp`. With the unit installed, 8160 must be `127.0.0.1:8160` only (§12) |
| health `mcp` FAIL "mcp-http.env … carries something other than MYTHOS_MCP_HTTP_TOKEN" | someone added a variable that could override the unit's loopback bind → `bash bin/haddad-mcp-http-setup.sh` refuses too; remove the extra line |
| `MCP_UNAUTHORIZED: server answered 401` from `--http` | bearer absent or stale on the client side; the value lives only in `~/.config/mythos-haddad/mcp-http.env` — `--rotate` invalidates every client |
| client hangs on connect | SSH itself: `ssh -o BatchMode=yes othman@100.78.7.10 true` must succeed with a key |

## 11. Deferred (not blockers for V1) and limits

- **`knowledge_search` / `knowledge_get`** stay `UPSTREAM_UNCONFIGURED` **by design, not
  pending work.** Owner decision (a), 2026-09-23: one canonical OTHKM store on the VPS, no
  duplicate on Haddad. Health does not fail on it — and since 2026-09-23 it does not stay
  silent about it either: check `knowledge` reports the closed state and names the unreachable
  store path every run.
- **Estate registry entry for Haddad** (`projects/mythos-gateway/registry/mcp-registry.json`): the VPS registry check would have to spawn `ssh othman@haddad`, which needs a VPS→Haddad credential that does not exist — owner decision. Until then Haddad's MCP is discovered by its own health check, not by the VPS.
- **Launcher checkout:** the installed launcher runs `server.js` from the checkout given at setup. On Haddad it currently points at the worktree of this branch (`~/projects/worktrees/mythos-haddad-mcp`) because `~/projects/mythos-prod` is the running worker's checkout on another branch and must not be switched. After merge: `HADDAD_MCP_REPO=$HOME/projects/mythos-prod bash …/haddad-mcp-setup.sh` (idempotent) re-points it. The scheduled health timer likewise shows `worker`/`mcp` once that checkout carries this branch.
- **Protocol version** stays `2024-11-05`: stdio has no sessions, the server implements exactly the three stable methods, and the real client accepted it. A bump would touch the VPS server for no functional gain.
- Still pending from V0: the Windows client's SSH key + `PasswordAuthentication no` — the MCP inherits Haddad's SSH policy and adds no access of its own.
- Out of scope by instruction and untouched: Qwen supervisor / repair loops, Sonnet/Opus escalation, delegate-skills, browser use. Nothing here blocks them: the MCP is an interface; execution authority stays in the executor/worker policy.

## 12. HAD-3b — the same MCP over HTTPS (2026-09-23)

**Ask:** a stable HTTPS MCP endpoint for authorised clients, without a second server. **Branch:**
`mythos-haddad/mcp-http-exposure`. Measured before anything changed:

| # | Found |
|---|---|
| 1 | Server/process: `projects/oth-mcp/server.js` via `~/.local/bin/haddad-mcp-stdio.sh`, one process per SSH client, no daemon; health `mcp` PASS |
| 2 | Transport: newline JSON-RPC 2.0 over stdio, `2024-11-05`, stateless (the dispatch keeps no session) |
| 3 | Port: none. Listeners on the host: `:22`, `127.0.0.1:8600` (llama-server), `127.0.0.1:8130` (executor, bearer), tailscaled |
| 4 | TLS / reverse proxy on Haddad: **none** (no caddy, nginx, certbot, socat; no `/etc/letsencrypt`). Tailscale 1.102.4 present: MagicDNS on, node `haddad.tail23f990.ts.net`, **Serve unconfigured, `CertDomains: null` (HTTPS certificates not enabled for the tailnet), no Funnel capability, `othman` not the tailscale operator** (`tailscale serve`/`cert` need root; no non-interactive sudo). `mythosprod.xyz` terminates TLS on the VPS nginx; the VPS is **not** on the tailnet and has no route to Haddad, so a `*.mythosprod.xyz` URL for Haddad is not something the current infrastructure can carry |
| 5 | Auth: SSH as `othman` over the tailnet; the server has no auth of its own; executor bearer by reference; GET-only. The repository already holds a bearer-gated Streamable-HTTP transport for exactly this server — `projects/mythos-gateway/mcp-http-bridge.js`, `mythos-mcp-http.service` on the VPS, `gateway-boundary` 37/0 |
| 6 | Missing: (a) that bridge is deployed only on the VPS, as a system unit with `/home/deploy` paths — nothing on Haddad speaks HTTP MCP; (b) Haddad's only TLS terminator, Tailscale Serve, is gated on two owner actions |

**Decision — REUSE, CONNECT, build nothing:** run the VPS bridge **byte-identical** as a Haddad
user unit on `127.0.0.1:8160`, relaying to the installed stdio launcher (so HTTP serves exactly
what SSH serves, from the same `server.js`, with the same upstream credentials by reference), and
put Tailscale Serve in front of `/mcp` for TLS + tailnet reach. The bridge adds one credential of
its own — a bearer — because an HTTP listener has no SSH identity to lean on. No Funnel: public
exposure is a different security model from "whoever could already `ssh othman@haddad`".

**Exposure, layer by layer (none widens Haddad's surface):**

| Layer | Fact |
|---|---|
| bind | `127.0.0.1:8160` pinned in the unit; the health check FAILs any other 8160 bind; `mcp-http.env` may hold only `MYTHOS_MCP_HTTP_TOKEN` (setup and health both refuse otherwise) so `EnvironmentFile=` cannot widen it |
| auth | `Authorization: Bearer` on every `/mcp` request, constant-time compare, 401 without/with a wrong one; the bearer lives in `~/.config/mythos-haddad/mcp-http.env` (0600), never printed, never in git |
| surface | bridge: `/mcp` (POST/DELETE; GET → 405) and `/health` (liveness, reveals nothing); everything else 404. Serve mounts **only** `/mcp`; `/health` stays loopback |
| tls | Tailscale Serve → `https://haddad.tail23f990.ts.net/mcp`, certificate issued by Tailscale, reachable only by tailnet members |
| authority | none added: the child is the read-only server; write boundary unchanged (`othk-6` §W) |

**Operate**

```bash
# install (needs HAD-3's stdio MCP first), enable, verify over HTTP from a separate process
HADDAD_MCP_REPO=$HOME/projects/mythos-prod bash projects/mythos-haddad/bin/haddad-mcp-http-setup.sh --enable
# publish /mcp through Tailscale Serve and verify over HTTPS (exit 2 + PENDING while the owner actions are outstanding)
HADDAD_MCP_REPO=$HOME/projects/mythos-prod bash projects/mythos-haddad/bin/haddad-mcp-http-setup.sh --enable --serve
# probe the bridge as a client (bearer by reference)
node projects/mythos-haddad/bin/haddad-mcp-probe.js --http http://127.0.0.1:8160/mcp --call haddad_health '{"check":"ai_runtime"}'
# a remote client (tailnet member) — the bearer is read from the file, never typed into a config in git
claude mcp add --transport http haddad-http https://haddad.tail23f990.ts.net/mcp \
  --header "Authorization: Bearer $(ssh othman@100.78.7.10 sed -n 's/^MYTHOS_MCP_HTTP_TOKEN=//p' .config/mythos-haddad/mcp-http.env)"
```

**Owner actions the script never attempts (once, then `--serve` completes on its own):**

1. Tailscale admin console → DNS → **Enable HTTPS Certificates** (today `CertDomains: null`).
2. On Haddad: `sudo tailscale set --operator=othman`.

Rollback: `systemctl --user disable --now mythos-haddad-mcp-http.service`; `tailscale serve
--https=443 --set-path=/mcp off`; remove the unit and `mcp-http.env`. The stdio path is untouched
throughout.

**Verified in this stage (worktree, unchanged bridge on an ephemeral port in front of the installed
launcher, all from a separate process):** `/health` 200 · unauthenticated and wrong-bearer
`tools/list` → 401 · unknown path → 404 · `GET /mcp` → 405 · handshake `oth-mcp 1.0.0` /
`2024-11-05` · **9 tools, identical to the stdio list** · `execution_status` answered from the
Haddad executor (48 tasks) · `haddad_health {check: gpu_test}` answered · exactly one
`server.js` child under the bridge · 0 occurrences of the bearer in any output. Tests: this suite
17 → **22 / 0** (unit pins loopback, setup has no sudo/no Funnel/serves `/mcp` only, probe reads
the bearer by reference, health measures 401 + bind + list equality; live bridge on an ephemeral
port; setup dry run in a throwaway `$HOME` incl. a widened env file refused and both PENDING
paths of `--serve` with stubbed `systemctl`/`tailscale`) · `gateway-boundary` 37/0 · `othk-6`
58/0 · `mcp-ecosystem` 168/0 · telemetry 168/0 · runtime 36/0 · ingest 154/0 · v0 8/0.
**Live on Haddad (2026-09-23 15:13 UTC, unit from the worktree, every check from a separate
process):** bound `127.0.0.1:8160` only (`100.78.7.10:8160` refused) · no/wrong bearer and
`GET /mcp` → 401 · `/admin`, `/tasks` → 404 · 9 tools = stdio list · `execution_status`,
`haddad_health`, `budget_status`, `system_health` answered through the bridge · bearer in 0
journal lines · worker, GPU (`Vulkan0`, 27/29 layers) and telemetry (202 ONLINE) unchanged ·
this branch's health **PASS 17/17**. `--serve` → PENDING (`CertDomains: null`). The scheduled
timer, running **main's pre-stage** health, then FAILed on the listener exactly as designed, so
the unit is **installed but disabled** until the live checkout carries this stage — the finish
order is in `docs/AI_HANDOVER.md` (HAD-3b entry).

**Limits, stated:** the URL is under the tailnet's MagicDNS domain, not `mythosprod.xyz` —
carrying it there would need the VPS on the tailnet or a Haddad→VPS tunnel, both new credentials
and an owner decision. Serve's identity headers (`Tailscale-User-Login`) are not used for
authorisation; the bearer is. One bearer, not per-client tokens — rotation (`--rotate`)
invalidates every client at once; per-client credentials are the gateway's job (ecosystem doc #3)
and out of scope here. The ecosystem/estate registry is unchanged (deferred owner decision, §11).

### 12.1 Fix: HTTPS `/mcp` answered 404 (2026-09-23)

**Root cause:** `tailscale serve --set-path=/mcp <target>` **strips the mount point** before
proxying. The setup script used the bare target `http://127.0.0.1:8160`, so
`https://haddad.tail23f990.ts.net/mcp` arrived at the bridge as `/`, which the bridge answers
`404 {"error":"not found"}`. The 404 body was the **bridge's** JSON, not Tailscale's `404 page not
found`, which is what proved the request reached the right process on the wrong path. The
loopback bridge was healthy throughout (`/mcp` → 401). The health check had the same
assumption inverted: it recognised only the bare target as "HTTPS configured", so on a correct
mapping it reported "no HTTPS".

**Fix:** target `http://127.0.0.1:8160/mcp` in the setup script. Health now recognises only that
target and **FAILs** a bare one, naming the fix. Tests pin the target. Mutation-checked: the old
target restored in the script → 2 test failures; the old mapping restored in live Serve → health
`mcp` FAIL. No architecture change: same bridge, same Serve mount, one path segment.

**Verified after the fix (tailnet client, separate processes):** certificate
`CN=haddad.tail23f990.ts.net`, Let's Encrypt, valid to 2026-12-22, strict curl verify OK ·
no/wrong bearer and unauthenticated `GET /mcp` → 401 with `WWW-Authenticate: Bearer` from the
bridge · `/`, `/admin`, `/mcpx`, `/health` over HTTPS → 404 (only `/mcp` mounted) · HTTPS
handshake `oth-mcp 1.0.0` / `2024-11-05`, **9 tools = stdio list**, `execution_status`,
`haddad_health`, `budget_status`, `system_health` answered · loopback `/health` 200 · Serve
tailnet-only, no Funnel · `server.js`, the stdio launcher and the bridge byte-identical to
`c8b1b149` · health **PASS 17/17**.

## 13. HAD-3c — the same endpoint at `https://mythosprod.xyz/mcphaddad` (2026-09-23)

**Ask:** expose the §12 endpoint through the VPS domain without touching `https://mythosprod.xyz/mcp`
and without a second server, bridge, router or auth layer.

**Audit (measured on the VPS, 2026-09-23):**

| # | Found |
|---|---|
| 1 | `/mcp` = `location = /mcp` + `location ^~ /mcp/` in `snippets/mythos-mcp-auth.conf` (mcp-auth-proxy :8180, OAuth/Dex). `/mcphaddad` matches neither; today it falls to the Hub (`404`) |
| 2 | VPS → Haddad: **no route.** No `tailscale`/`tailscaled`, no tailnet interface, `haddad.tail23f990.ts.net` does not resolve, `100.78.7.10:443` times out; no SSH key or `known_hosts` entry for Haddad in root/deploy/ubuntu |
| 3 | The only existing Haddad↔VPS channel is Haddad's **outbound** signed push to `/ingest` (status console). It is one-way by design and cannot carry an MCP request/response without building a relay — rejected |
| 4 | `https://haddad.tail23f990.ts.net/mcp` is served by Tailscale Serve (tailnet-only). So the target in the required architecture is reachable **only by a tailnet member**: the VPS must join the tailnet |

**Decision — CONNECT, build nothing:** the VPS joins the existing tailnet as a **tagged, ACL-restricted
node** (reaches `haddad:443` and nothing else; `--shields-up` so no tailnet node can reach the VPS),
and nginx relays one exact path to the existing Serve endpoint:

```
Claude / MCP client ─TLS(mythosprod.xyz, LE)─▶ VPS nginx  location = /mcphaddad
   ─TLS(verified for haddad.tail23f990.ts.net) over the tailnet─▶ 100.78.7.10:443 Tailscale Serve /mcp
   ─▶ 127.0.0.1:8160 mcp-http-bridge.js (bearer check) ─▶ haddad-mcp-stdio.sh ─▶ oth-mcp server.js
```

- `nginx/mythos-mcp-haddad.conf` — one `location = /mcphaddad`, included after the `/mcp` snippet. Upstream is the
  node's tailnet **IP** with `proxy_ssl_name`/`Host` = the node name and `proxy_ssl_verify on`, so the config never
  depends on MagicDNS on the VPS (`--accept-dns=false`) and loads even with tailscaled down (the route then answers
  502; `/mcp` is unaffected).
- **Authentication is unchanged end-to-end:** nginx forwards the client's `Authorization` header untouched; the Haddad
  bridge alone answers 401. The VPS never holds the Haddad bearer. The test suite fails if the snippet mentions
  `Authorization`, `auth_request`, a resolver, or a second location.
- `bin/haddad-mcp-vps-route.sh` (root, on the VPS): refuses unless the VPS already gets **401 from the bridge over
  strict TLS** and Funnel is off; installs the snippet + one include line (backup first), `nginx -t` (restores the
  vhost on failure), reload, then checks `/mcp` → 401 unchanged and `/mcphaddad` → 401. `--check` changes nothing;
  `--remove` takes the route out. It never runs `tailscale up`, Serve or Funnel.

Pre-verified without a tailnet (scratch nginx, loopback): `/mcp`, `/mcp/` → 401 from mcp-auth-proxy (unchanged);
`/mcphaddad` → nginx dials `https://100.78.7.10:443/mcp` (times out: no route yet); `/mcphaddad/x`, `/mcphaddadx`
→ not routed. Full live config copy passes `nginx -t`.

**Owner actions (the only ones; nothing below has been attempted by an agent):**

1. Tailscale admin → Access controls: add a tag and a grant that lets it reach Haddad's 443 only, e.g.
   ```jsonc
   "tagOwners": { "tag:mythos-vps": ["autogroup:admin"] },
   "hosts":     { "haddad": "100.78.7.10" },
   "grants":    [ { "src": ["tag:mythos-vps"], "dst": ["haddad"], "ip": ["tcp:443"] } ]
   ```
   If the policy still has the default allow-all rule (`src: ["*"]`), narrow it (e.g. `src: ["autogroup:member"]`)
   or the tagged VPS inherits reach to every node.
2. Tailscale admin → Settings → Keys → generate an auth key: **one-off, not reusable, not ephemeral, pre-approved,
   tag `tag:mythos-vps`**.
3. On the VPS as root (the key goes nowhere else — not into chat, git or a file):
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   tailscale up --auth-key='tskey-auth-…' --hostname=mythos-vps --accept-dns=false --accept-routes=false --shields-up
   ```
Then (agent or owner): `sudo bash projects/mythos-haddad/bin/haddad-mcp-vps-route.sh` from a checkout carrying this
stage, and the external verification from a separate host, bearer by reference — e.g. on Haddad:
`node projects/mythos-haddad/bin/haddad-mcp-probe.js --http https://mythosprod.xyz/mcphaddad --call haddad_health '{"check":"ai_runtime"}'`.

**Rollback:** `haddad-mcp-vps-route.sh --remove`; `tailscale down` (or remove the node in the admin console);
`apt remove tailscale`. Haddad is untouched throughout.

**Limit, stated — Claude Web:** the bridge's credential is a static bearer. A client that can send a header (Claude
Code `--header`, the probe, the Agent SDK) works as-is. Claude Web custom connectors authenticate with OAuth: on a 401
they discover `/.well-known/oauth-protected-resource…`, which on this origin belongs to the `/mcp` OAuth bridge, and
would present *that* token to Haddad (→ 401). Making `/mcphaddad` OAuth-capable means either the existing mcp-auth-proxy
learning a second upstream or a second proxy instance — the latter is a duplicate auth subsystem and out of scope;
both are an owner decision.
