# MYTHOS MCP Ecosystem — inventory, gap analysis and target architecture

**Stage:** `MCP-ECOSYSTEM-1` · **Date:** 2026-09-01 · **Branch:** `mythos/mcp-ecosystem-20260901`
**Baseline:** local `main` `b7ea66a` + `mythos/vault-architecture-20260901` + `feat/mythos-gateway` (`d287b97`)
**Method:** every row below was verified on the production host (`vps-4722f0a9`) by direct
inspection — process table, listening sockets, container inspection with secrets redacted,
systemd state, a real MCP handshake through each transport. Nothing is inferred from
documentation alone. Items that could not be verified are marked **NOT VERIFIED**.

This document is the PHASE 1 / PHASE 2 record of the MCP completion order. It does not
replace `MYTHOS_SYSTEM_INDEX.md` §41–§43 (the MCP design constraints) or
`MYTHOS_VAULT_ARCHITECTURE.md` (the credential contract); it applies them.

---

## 1. Inventory — what exists, where it runs, how it is reached

```
ChatGPT / Claude (remote)         Claude Code sessions (on-host)      OTHMODE-activated commands
        │ HTTPS (NOT OPEN)                 │ ssh deploy@host …stdio.sh          │ CLAUDE.md contract
        ▼                                  │                                    ▼
nginx /gateway/  (404 — not reloaded)      │                            OTHMODE :3021  (read model:
        │                                  │                            skills · tools · providers ·
        ▼                                  │                            projects · tasks · evolution)
ContextForge :4444  (loopback, healthy)    │                                    ▲
   registry: 1 peer, 8 tools, 0 servers,   │                                    │ GET /api/othmode/*
   0 tokens, metrics only                  │                                    │
        │ 10.0.60.1:8160 (bearer)          │                                    │
        ▼                                  ▼                                    │
mythos-mcp-http bridge ──spawn──▶ OTH MCP server.js (stdio, 8 read-only tools) ─┤
   systemd, deploy, 256 MB                 │                                    │
                                           ├──▶ OTH Knowledge :8150 (bearer)    │
                                           ├──▶ AI Executor   :8130 (bearer) ───┘ (mcp-capabilities: outbound governance)
                                           └──▶ Status Center (public JSON)

github-mcp-rw   10.0.60.3:8082  (compose, no port, no credential, NOT registered in ContextForge)
github-mcp      127.0.0.1:8082  (hand-run 2026-08-24, --read-only, no credential in env, NO consumer found)
context7        127.0.0.1:8083  (hand-run 2026-08-24, NO consumer found)
```

### 1.1 Component table

| # | Component | Purpose | Location (source → deployed) | Transport | Auth | Secrets source | Consumers | Health (live) | Tests | Class |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **OTH MCP server** | Inbound read interface: 8 tools over Knowledge / OTHMODE / Executor / Status Center | `projects/oth-mcp/server.js` → `/home/deploy/oth-mcp/…` (worktree on `vps/extraction-advisory-wiring-20260831`; byte-identical copy on local `main`) | stdio JSON-RPC, launched by `deployments/oth-mcp/oth-mcp-stdio.sh` | none of its own; per-upstream bearer from `deployments/oth-mcp/.env` (0600) | env file outside git | bridge (#2), SSH clients | ONLINE — `tools/list` 8, `system_health`/`budget_status`/`capability_registry` answered live | `othk-6` (52) | **COMPLETE** (v1, read-only by design) |
| 2 | **MCP HTTP bridge** `mythos-mcp-http.service` | Streamable-HTTP transport for #1 so ContextForge can federate it | `projects/mythos-gateway/mcp-http-bridge.js` → `deployments/mythos-gateway/` (identical) | HTTP `127.0.0.1:8160` + `10.0.60.1:8160` | bearer (`MYTHOS_MCP_HTTP_TOKEN`, held only by ContextForge) | `mcp-http.env` 0600 | ContextForge | ONLINE — `/health` 200, 401 without token | `gateway-boundary` (37) | **COMPLETE** |
| 3 | **MYTHOS Gateway** (ContextForge 1.0.9) | Federation, per-client auth, registry, audit for remote clients | `projects/mythos-gateway/docker-compose.yml` → `deployments/mythos-gateway/` | HTTP `127.0.0.1:4444`, nginx `/gateway/` | JWT / platform admin; `AUTH_REQUIRED=true`; admin UI+API off | `contextforge.env` 0600, SQLite `data/mcp.db` | none yet (0 tokens) | ONLINE on loopback; **public 404** (nginx not reloaded) | `gateway-boundary` | **PARTIAL** — built, not opened; 0 virtual servers, 0 client tokens |
| 4 | **GitHub MCP (write-capable)** `mythos-github-mcp-rw` | Official server for GitHub actions via the gateway | compose service in #3 | HTTP on gateway net only | per-request bearer (none bound) | ContextForge encrypted store (empty) | none | container up; **not registered** as a ContextForge peer; **no credential** | — | **PARTIAL** — owner decision (credential) |
| 5 | **GitHub MCP (read-only)** `mythos-github-mcp` | Unknown — hand-started 2026-08-24, no compose project | none in repo | `127.0.0.1:8082` | per-request bearer; `GITHUB_READ_ONLY` only | none in env | **none found** in repo, `.claude.json`, codex config | answers 401 | — | **OBSOLETE candidate** — NOT VERIFIED that nothing external uses it |
| 6 | **context7** `mythos-context7` | Docs MCP (`mcp/context7`), hand-started 2026-08-24 | none in repo | `127.0.0.1:8083` | none | none | **none found** | up 8 d | — | **OBSOLETE candidate** — same caveat |
| 7 | **Executor MCP capability registry** | Outbound governance: which `server.tool` a skill under a profile may name | `projects/mythos-ai-executor/config/mcp-capabilities.json` + `lib/mcp-capabilities.js` | none (config-time) | n/a | none by design (`endpoint`/`url` keys rejected) | `executor.js` (task resolution), OTHMODE `registries.tools()` | valid registry, `github` `enabled:false` | executor suite (M-12 assertions) | **COMPLETE** as governance; **MISSING** client — "a real MCP client remains explicitly future" (M-12) |
| 8 | **OTHMODE unified read model** | Human/agent discovery of skills, tools, providers, projects | `projects/command-center/reference/othmode/registries.js` → `mythos-command-center.service` (from `main`) | HTTP `127.0.0.1:3021`, public `othmode.mythosprod.xyz` | reads `auth:false`; writes bearer (`MCC_ADMIN_TOKENS`) | `deployments/mythos-command-center/.env` | OTH MCP `capability_registry` / `project_context`, UI, agents | ONLINE | `othmode-2` (94) | **BROKEN for MCP** — `tools()` misreads `mcp-capabilities.json` (emits `mcp:servers`, empty capabilities; `github` never listed) — verified live |
| 9 | **MYTHOS Vault** | Central credential layer | `docs/MYTHOS_VAULT_ARCHITECTURE.md` (branch `mythos/vault-architecture-20260901`) | — | — | — | — | — | — | **DESIGNED only**; §10 step 1 (metadata inventory) is the sanctioned next step, no backend chosen |
| 10 | **MCP health monitoring** | Status of #1–#4 in the estate monitor | `projects/status-center/monitor/probes.json` | — | — | — | Status Center, `system_health` tool | **no probe** for 8160 / 4444 / oth-mcp chain | `stc-*` | **MISSING** |
| 11 | **MCP audit** | Who called which tool with what result | ContextForge metrics (`/metrics`: 6 tool executions, no actor); executor `events.log` per task (`mcp_capabilities_resolved`) | — | — | — | — | partial | — | **PARTIAL** — no actor-attributed record for gateway calls; nothing for stdio/SSH calls |
| 12 | **Explicit permission matrix** | ALLOW / CONTROLLED / RESTRICTED / DENY per capability and subject | does not exist as data | — | — | — | — | — | — | **MISSING** (enforced implicitly: OTH MCP has no write tool; executor policy engine; ContextForge auth) |
| 13 | **Estate-level MCP registry** | One place naming every MCP server, transport, auth requirement, tools, enabled state, consumers, health probe | does not exist (ContextForge knows #1 only; `mcp-capabilities.json` knows `github` only; OTHMODE folds both badly) | — | — | — | — | — | — | **MISSING** |

### 1.2 Client configurations found

| Where | MCP servers configured |
|---|---|
| `/root/.claude.json` | none |
| `/home/deploy/.claude.json` | none |
| `/home/deploy/.codex/config.toml` | none |
| any `.mcp.json` in repo/worktrees/home | none |

No on-host agent is configured to consume any MCP server. The only documented client
configuration is the SSH stdio recipe in `projects/oth-mcp/README.md`.

### 1.3 Production incident found during discovery (not MCP code)

At 22:16:42 UTC the kernel OOM killer selected the **deploy user manager**
(`user@1001.service`, `OOMScoreAdjust=100`) and systemd SIGKILLed every deploy production
service under it, including all three OTH MCP upstreams. The manager has `Restart=no`, so
nothing restarted. Recovered at 23:05 with `systemctl start user@1001.service`; all eight
services active, upstreams answering. The prevention (an `OOMScoreAdjust=0` drop-in on the
manager, mirroring the 2026-09-01 service drop-ins) was refused by the agent permission
layer and is recorded as an owner action in `ops/oom/`. Root cause of the pressure is
unchanged: 18 root agent sessions holding ~3.5 GB in one session scope, swap 100 % used.

---

## 2. Gap analysis — what completion requires

| Gap | Evidence | Resolution in this stage | Why not something else |
|---|---|---|---|
| No estate-level MCP registry | #13 | `projects/mythos-gateway/registry/mcp-registry.json` — metadata-only, references credentials by Vault `cred_…` id, never a value or endpoint secret; validated by `lib/mcp-registry.js` (fail-closed like `lib/mcp-capabilities.js`) | ContextForge's own registry is the inbound *runtime* registry and stays authoritative for what it serves; `mcp-capabilities.json` stays the outbound *governance* registry. The estate registry indexes both — it does not replace either (`SYSTEM_INDEX` §41: "must NOT create another … registry" applies to skills/providers; an MCP *server* index did not exist anywhere) |
| Registration ≠ availability | Phase 3 rule | `bin/mcp-registry-check`: probes each server (health, real `initialize`/`tools/list`), compares declared tools with discovered tools, emits ONLINE / DEGRADED / OFFLINE / UNAUTHORIZED / ERROR per server and a snapshot file OTHMODE can read | a snapshot is the same pattern the Status Center monitor uses (one measured source, never a second asserter) |
| OTHMODE cannot discover MCP capabilities | #8, verified live | fix `registries.tools()` to read the real `{servers:{…}}` shape and to fold the estate registry + status snapshot; every tool row carries `registered / available / healthy / authorized / executable` | this is the existing unified read model; fixing it is the non-duplicative path to Phase 6 |
| No explicit permission matrix | #12 | `registry/mcp-permissions.json` (subjects × capabilities → ALLOW / CONTROLLED / RESTRICTED / DENY) evaluated by `lib/mcp-policy.js`; consulted by the registry check (drift: a tool exposed that the policy denies fails the check) and by the executor's governed MCP invoke | the *enforcement points* stay where they are (OTH MCP tool set, executor policy engine, ContextForge auth); the matrix is the declared policy those points are verified against — not a fourth engine |
| No MCP client anywhere in MYTHOS | #7, M-12 "explicitly future" | `projects/mythos-ai-executor/lib/mcp-client.js` (dependency-free stdio + Streamable-HTTP JSON-RPC client) and `lib/mcp-invoke.js` (governed invoke: capability resolution → permission → call → verification → audit); exposed as `POST /mcp/invoke` on the existing executor API (bearer) | the Executor is the execution engine; OTHMODE must not become one (`SYSTEM_INDEX` §40/§41). Endpoints and credentials come from the executor's runtime env, never from repo config (the `endpoint`/`url` rejection in `mcp-capabilities.js` is kept) |
| Vault not started | #9 | `projects/mythos-vault/credential-inventory.json` (§10 step 1, metadata only) + `bin/vault-inventory-check` (existence / owner / mode drift, never reads a value) | the ADR names this the only step allowed without a new owner decision |
| MCP not monitored | #10 | probes for the bridge and the gateway added to `probes.json`; registry check exposes the chain status | reuse STC-2, do not build a second monitor |
| No actor-attributed audit | #11 | `mcp-invoke` writes an append-only `mcp-audit.jsonl` (timestamp, actor, agent, tool, action, target, authorization result, execution result, error) through the executor's `redact` layer; ContextForge metrics remain the gateway-side record | secrets never recorded — the redact layer plus a test that greps the audit fixture for token shapes |
| Gateway not public / no client credential / no GitHub credential | #3, #4 | **unchanged — owner decisions** (see §5) | recorded, not worked around |
| Orphan containers | #5, #6 | **reported, not removed** | removing a running container that might have an off-host consumer is destructive; owner confirms |

---

## 3. Target architecture (adapted to what exists)

```
OthMode-activated command / remote agent
        │
        ▼
┌─ MYTHOS MCP Gateway ──────────────────────────────────────────────────────────┐
│  ContextForge (federation · per-client auth · runtime registry · metrics)     │
│  + estate registry  registry/mcp-registry.json      (what exists, declared)   │
│  + permission matrix registry/mcp-permissions.json  (what is allowed)         │
│  + registry check    bin/mcp-registry-check         (what is actually up)     │
└──────────────────────────────┬────────────────────────────────────────────────┘
                               │
     ┌─────────────────────────┼──────────────────────────┐
     ▼                         ▼                          ▼
 OTH MCP (read, stdio)   github-mcp-rw (write-capable)   future peers
     │                         │
     ▼                         ▼
 Knowledge · OTHMODE · Executor · Status      GitHub API
                               ▲
 MYTHOS Vault (reference model: cred_… ids in every registry; values only in 0600 env files
 today; brokered resolution when a backend is chosen)

 Executor (the only execution engine):
   task → skill selection → mcp-capabilities (outbound registry) → mcp-policy (matrix)
        → mcp-client (stdio | streamable-http) → result verification → events + mcp-audit
```

Read the arrows as **authority**: a call that skips a layer is an unauthorized call.

### Five states every tool can be in

| State | Meaning | Source of truth |
|---|---|---|
| registered | named in `mcp-registry.json` (or ContextForge / `mcp-capabilities.json`) | registry files |
| available | its server answered `initialize` + `tools/list` and the tool was in the list | `mcp-registry-check` snapshot |
| healthy | server status ONLINE (not DEGRADED / OFFLINE / UNAUTHORIZED / ERROR) | snapshot |
| authorized | the permission matrix answers ALLOW (or CONTROLLED with an approval path) for the subject | `mcp-policy` |
| executable | all four above, plus a credential reference that resolves for the subject | `mcp-invoke` |

---

## 4. Constraints honoured

- No component rebuilt. `server.js`, the bridge, the compose topology, `mcp-capabilities.js`
  and the ContextForge deployment are unchanged in behaviour.
- No second memory, project, task, skills, provider, authorization, evolution, identity,
  provenance or execution engine (`SYSTEM_INDEX` §41).
- The OTH MCP write boundary is untouched: it still exposes no write tool.
- No secret value in the repository; registries carry `cred_…` references only, and a test
  asserts it.
- Governance delivery: `mythos/*` branch through the root relay; `main` remains blocked on
  `f5e503a` (owner approval).

## 5. Owner decisions — recorded, not taken

1. Bind a **dedicated GitHub machine credential** to the gateway (Vault `cred_github_gateway`
   placeholder in the inventory, status `absent`).
2. Issue **per-client gateway credentials** (`chatgpt`, `claude`) via ContextForge `/tokens`.
3. **Reload nginx** — the moment `/gateway/` becomes reachable from the internet.
4. Apply the **user-manager OOM drop-in** (`ops/oom/`) and reduce agent-session sprawl.
5. Approve `f5e503a` so `main` can be delivered (`mythos-governance-approve`).
6. Confirm whether `mythos-github-mcp` (read-only, 8082) and `mythos-context7` (8083) have
   any consumer; if not, retire them.

---

## 6. Implementation record (MCP-ECOSYSTEM-1, 2026-09-02)

### 6.1 What was built (all on `mythos/mcp-ecosystem-20260901`)

| Phase | Component | Files | Notes |
|---|---|---|---|
| 3 Registry | estate MCP registry + fail-closed loader | `projects/mythos-gateway/registry/mcp-registry.json`, `lib/mcp-registry.js` | 6 servers; credentials by `cred_…` reference only; unknown field / value-in-a-secret-key / embedded URL credential / secret-shaped string ⇒ whole registry invalid |
| 3 Availability | registry check + snapshot | `bin/mcp-registry-check`, `bin/mcp-registry-check.sh`, `systemd/mythos-mcp-registry-check.{service,timer}` | real handshake per transport; five statuses; declared-vs-discovered drift; policy + credential findings; `--server` merges; snapshot at `deployments/mythos-gateway/mcp-registry-status.json` |
| 4 Authorization | permission matrix + evaluator | `registry/mcp-permissions.json`, `lib/mcp-policy.js` | 11 capabilities, 12 tool-class rules, 6 subjects; ceiling ∧ grant; `destructive` hard floor; `RESTRICTED` ⇒ DENY for agents, CONTROLLED for humans; unclassified ⇒ DENY |
| 5 Vault | credential inventory (§10 step 1) + stat-only check | `projects/mythos-vault/credential-inventory.json`, `lib/inventory.js`, `bin/vault-inventory-check` | 20 references, 1 exclusion (governance key); the module opens only the inventory and `/etc/passwd`, never a listed file |
| 6 Discovery | OTHMODE read model fixed and extended | `command-center/reference/othmode/registries.js`, `routes.js` | reads the real `{servers:{…}}` shape (the `mcp:servers` defect is gone); folds the estate registry + snapshot; five states per tool; new `GET /api/othmode/mcp` (public, redacted: kind, never path/URL/credential) |
| 7/8 Execution | MCP client + governed invoke + executor route | `projects/mythos-gateway/lib/mcp-client.js`, `projects/mythos-ai-executor/lib/mcp-invoke.js`, `server.js` (`POST /mcp/invoke`, `GET /mcp/registry`) | subject fixed to `executor`; closed field set; CONTROLLED needs a GRANTED, human-decided, <24 h, unconsumed approval with `action_class mcp:<capability>` — consumed on use; capability-governed servers require a task whose `mcp_capabilities` name the tool; credential resolved by reference from the executor's own environment and dropped once the transport holds it |
| 9 Audit | append-only MCP audit log | `mcp-invoke.js` → `<executor home>/orchestration/mcp-audit.jsonl` (0600) via the redact layer; task-bound calls also get an `mcp_invoke` event | timestamp · actor · agent · subject · server · tool · action (capability) · target (transport kind) · authorization {decision, capability, reason, approved_by} · execution {ok, status, latency} · error |
| 9 Health | monitor probes | `status-center/monitor/probes.json` (+2) | bridge and gateway at their loopback origins; federation state is the check's job |
| — | owner actions | `ops/oom/` | user-manager OOM drop-in + README (the permission layer refused the `/etc` write) |
| 10 Tests | offline suite | `tests/mcp-ecosystem-test.js` | 167 assertions, §A–§J |

### 6.2 Verification — real, on the host, 2026-09-02 00:14–00:26 UTC

| Check | Result |
|---|---|
| `tests/mcp-ecosystem-test.js` (deploy, fixtures) | **167 passed, 0 failed** |
| `tests/gateway-boundary-test.js` | 37 / 0 (unchanged bridge) |
| `tests/othk-6-mcp-server-test.js` | 58 / 0 (unchanged server) |
| `tests/mythos-ai-executor-test.js` | 264 / 0 (server.js gained two routes, nothing else moved) |
| `tests/othmode-2-platform-test.js` | 141 / 0 (`tools()` rewritten, existing assertions intact) |
| `bin/mcp-registry-check` against production | **OK** — oth-mcp ONLINE 8/8 (stdio, 749 ms) · mythos-mcp-http ONLINE 8/8 (bearer) · contextforge ONLINE (8 federated tools, peer `mythos-mcp` reachable; finding: client token absent) · github-mcp-rw UNAUTHORIZED (disabled, 401 — correct) · github-mcp-readonly UNAUTHORIZED (disabled) · context7 ONLINE 2/2 (disabled). Snapshot 0640, no secret shape |
| `bin/vault-inventory-check` as deploy / as root | 20 checked, 0 drift; 3 unknowable from `deploy` (root/ubuntu-owned files), 0 unknowable as root |
| ContextForge real MCP handshake (`/mcp`, admin JWT) | initialize ✓ · tools/list 8 ✓ · `mythos-mcp-system-health` real Status Center data ✓ · unknown tool `isError` ✓ · unauthenticated 401 ✓ |
| governed invoke against production (as deploy) | 1 `oth-mcp.system_health` OK 404 ms · 2 `oth-mcp.capability_registry` OK · 3 `mythos-mcp-http.knowledge_search` OK 875 ms (bearer by reference) · 4 `mythos-mcp-http.budget_status` OK · 5 `github-mcp-rw.get_me` → `MCP_SERVER_DISABLED` 409 · 6 `contextforge.system_health` → `MCP_CREDENTIAL_UNAVAILABLE` 503 (no client token issued) · 7 `oth-mcp.knowledge_write` → `MCP_TOOL_UNREGISTERED` 404 · 8 `context7.get-library-docs` → disabled 409 · 9 secret-shaped argument → `MCP_INPUT` 400 · 10 bridge without credential → `MCP_CREDENTIAL_UNAVAILABLE` |
| audit log after the above | 10 entries, 0600 deploy, `findSecretKinds` = none, every denial recorded with its authorization result |
| OTHMODE read model (worktree, live snapshot) | `mcp:github` rendered with 3 tools `enabled:false`; `oth-mcp.*` registered/available/healthy/authorized/executable = true; public view contains no path, URL or launcher |
| existing services after the work | user@1001 active, 3021/8130/8150/3001/8160/4444 listening; the stdio SSH path unchanged |

### 6.3 Security review (PHASE 11)

| Item | Finding |
|---|---|
| credential leakage | none: registries and inventory carry references only, validated by loaders that refuse values and secret shapes; snapshot, audit log, OTHMODE view and executor description scanned clean; the client never logs; the invoke drops its token after the transport holds it; the bridge token was never printed during verification (sourced inside `deploy` shells only) |
| privilege escalation | subject is fixed server-side (`executor`); a caller cannot name a subject (`UNEXPECTED_FIELD`); the admin credential can never act as a client identity (registry validator); `RESTRICTED` is unreachable by agent subjects; `destructive` cannot be raised |
| excessive permissions | executor: `github.merge`, `vault.read`, `infrastructure`, `destructive` DENY; chatgpt: reads only, issues CONTROLLED; anonymous: nothing; OTHMODE computes but never executes |
| unauthenticated endpoints | new: `GET /api/othmode/mcp` (public read, redacted — same class as the existing registries); bridge `/health` and gateway `/health` liveness (pre-existing, unauthenticated by design). `/mcp/invoke` and `/mcp/registry` are bearer-gated |
| filesystem / SSH / Docker / DB access | none added; the check unit is `ProtectSystem=strict`, `ProtectHome=read-only` with one writable dir; the inventory check is stat-only; no container, socket, or database touched |
| command execution | the stdio client spawns only the launcher path declared in a validated registry (absolute path, `/bin/bash <launcher>`); the check runs as `deploy` |
| exposed ports | none added; `ss -ltn` unchanged (8160 loopback + gateway net, 4444 loopback) |
| token exposure / logs | audit + events pass through `redact.redactValue`; arguments carrying a secret shape are refused (`MCP_INPUT`) before any call and never written |
| `.env` files | all 0600 `deploy` (inventory check); none read by any new code — the launchers export names, the executor reads its own environment |
| git history | branch diff vs `main` scanned: 0 literal tokens; the single `url-basic-auth` hit is the deliberate negative fixture in the test |
| **open (owner)** | github-mcp-rw has no credential (kept disabled); no gateway client token issued (gateway calls fail closed); nginx not reloaded (gateway not public); two orphan containers (github-mcp-readonly, context7) still running unregistered-by-anyone — reported, not removed; Coolify findings from MISSION-FINAL unchanged |

### 6.4 Deployment status — precise

| Component | State |
|---|---|
| `deployments/mythos-gateway/mcp-registry-check.sh` | **INSTALLED** (identical to the repo copy) |
| `deployments/mythos-gateway/mcp-registry-status.json` | **WRITTEN** by a real run at 00:24 UTC; refreshed only when the check runs |
| `mythos-mcp-registry-check.timer` | **NOT INSTALLED** — root write under `/etc/systemd` refused; owner action (README) |
| `ops/oom` user-manager drop-in | **NOT INSTALLED** — same refusal; production went down twice during this session for exactly this reason and was restarted by hand both times |
| executor `POST /mcp/invoke` | **NOT LIVE** — the daemon runs from `main`; verified by direct invocation of the same module as `deploy` |
| OTHMODE `tools()` fix + `/api/othmode/mcp` | **NOT LIVE** — same reason (`main`); verified in the worktree against the live snapshot |
| monitor probes | **NOT LIVE** — `main`, and `probes.json` on `main`'s working tree is itself uncommitted production truth (idauto probes) that must be reconciled first |
| everything pre-existing | unchanged and re-verified |
| gateway exposure | **PUBLIC since ~06:36 UTC 2026-09-02** — nginx restarted outside this session and applied the existing `/gateway/` block; measured: health 200, every other path 401 without credential, admin 404, 0 client tokens (nothing invokable from outside) |
| GitHub delivery | **DENIED by governance, not bypassed** — commit `d9e5c541e732` (`credential-inventory.json` matches `/credential/i`) and `d287b974a91d` (`contextforge.env.example` matches `/\.env(\.|$)/i`) need `mythos-governance-approve`; commands in `docs/AI_HANDOVER.md`. Remote HEAD `main` = `f4d5eb9`, branch absent from origin |

### 6.5 NOT VERIFIED

- That nothing off-host consumes `mythos-github-mcp` (8082) or `mythos-context7` (8083). No consumer exists on the host or in the repository; an external client is unknowable from here.
- The github-mcp-rw tool set under a real credential (none exists) — the matrix classifies its documented tool names; discovery will confirm the day a credential is bound.
- The timer's behaviour under the systemd confinement — written to the bridge unit's proven pattern, not yet run under systemd.
- `describeRegistry()` and the OTHMODE view in the *deployed* processes — both verified from the worktree only.
