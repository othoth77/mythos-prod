# Worklog — MCP Deployment and Real-Client Validation

**Date:** 2026-08-30
**Time:** 23:27 – 23:52 UTC (single continuous execution)
**Agent:** Claude Opus 5 (Claude Code, interactive session, on the VPS as root)
**Task:** Reconcile the existing MCP architecture, deploy what already exists, and validate it with a real MCP client.
**Mission constraint:** not a rebuild. Reuse, do not duplicate. Security hardening explicitly deferred.

---

## 1. Starting state

| | |
|---|---|
| Host | `vps-4722f0a9.vps.ovh.net` (51.68.226.211, OVH) — the session was already **on** the VPS; no SSH hop |
| Repository | `othoth77/mythos-prod`, worktree `/home/deploy/oth-mcp` |
| HEAD | `0c5eb9a` — detached at `origin/vps/oth-mcp-20260830` |
| Working tree | clean |
| `main` worktree | `/home/deploy/projects/mythos-prod` at `90d9ffe`, 3 unrelated modified files (untouched by this execution) |
| Concurrent sessions | none — `journalctl -u ssh --since -10min` showed no `Accepted`, `who` empty |

Latest prior record read: `docs/worklogs/2026-08-30-1940-ecosystem-audit-and-extraction-mvp.md`.

**Documentation drift found at the pre-execution check:** the mission named `docs/MYTHOS_FINAL_SYSTEM_AUDIT.md`. **That file does not exist in the repository.** `docs/MYTHOS_SYSTEM_INDEX.md` (1142 lines) does, and was used as the baseline. Recorded here rather than silently substituted.

## 2. Previous work reused

Everything deployed and tested in this execution already existed. **No component was rebuilt, and no duplicate was created.**

| Reused | Provenance |
|---|---|
| `projects/oth-mcp/server.js` | commit `0b6b1d2`, fixed by `0c5eb9a` |
| `projects/oth-knowledge/service/othk-http.js` | commit `0b6b1d2` |
| `oth-knowledge-http.service` | already installed and running since 20:15 UTC |
| `projects/oth-knowledge/lib/knowledge-service.js` | the pre-existing read boundary |
| `projects/mythos-ai-executor/lib/mcp-capabilities.js` | left untouched — see §4 |
| `projects/status-center/` (RECON) | left untouched, exercised read-only |
| `tests/othk-5`, `othk-6` | the existing suites, one host-dependence fixed |
| `/home/deploy/deployments/<service>/.env` pattern | copied for the MCP's runtime config |

## 3. MCP architecture as verified on the host

```
MCP client (Claude / ChatGPT / Inspector)
        │  JSON-RPC 2.0 over stdio, carried by SSH
        ▼
  oth-mcp/server.js          holds no data, no state, no authority; one GET verb exists in the file
        │
        ├── OTH Knowledge  127.0.0.1:8150   bearer token, read-only facade   → /home/deploy/othk-store
        ├── OTHMODE        127.0.0.1:3021   read model, auth:false by its own route table
        ├── AI Executor    127.0.0.1:8130   bearer token
        └── Status Center  https://status.mythosprod.xyz   published, public by design
```

Every upstream binds loopback except Status Center, which is already published. **No new public port was opened.**

## 4. Capability / authorization reconciliation — the boundary question

The mission asked whether MCP tool exposure and `lib/mcp-capabilities.js` need wiring. **They do not. The separation is intentional, and both were left unchanged.** They govern opposite directions of traffic:

| | `mythos-ai-executor/lib/mcp-capabilities.js` | `oth-mcp/server.js` |
|---|---|---|
| Direction | **outbound** — MYTHOS as MCP *client* | **inbound** — MYTHOS as MCP *server* |
| Decides | which `server.tool` a skill under an execution profile may name | which of its own 7 read tools a client may call |
| Holds | no network code, no client, no credentials (its own header says so) | one `GET`, per-upstream token, no other verb |
| Registry today | `config/mcp-capabilities.json`: one server, `github`, `enabled: false`, no credential on this host | a closed `TOOLS` array |

Wiring them would add no boundary — the registry decides nothing about inbound tools — and would couple a config-time governance layer to a process whose value is that it stays thin. `docs/MYTHOS_SYSTEM_INDEX.md` §11 previously read as though one should call the other; it was written before the server existed. The index has been corrected with this finding.

Both fail closed, independently, for their own direction. Verified, not assumed:
- inbound — an unlisted tool name returns `No such tool`; version 1 exposes **no** write tool.
- outbound — an invalid registry disables resolution entirely; any `endpoint`/`url` key at any depth is rejected by its presence.

## 5. OTH Knowledge facade — verified, not changed

| Check | Result |
|---|---|
| Unit | `oth-knowledge-http.service`, systemd **user** unit, user `deploy`, active since 20:15 UTC |
| Binding | `127.0.0.1:8150` — confirmed in `ss -tlnp`; **not** publicly exposed |
| Health | `{"status":"ok","store_available":true,"read_only":true}` |
| Authentication | unauthenticated `GET /stats` → **401** |
| Read-only | `POST /search` → **405**, refused before routing |
| Canonical source | `OTHK_STORE_ROOT=/home/deploy/othk-store` (38 records) |
| `oth.db` | **not present on this host at all** (`find /home /root -name oth.db` → nothing). Nothing was moved. |
| Secrets | `.env` is 0600, `deploy`-owned, outside the worktree; nothing committed |

## 6. Deployment performed

The MCP speaks stdio and every upstream is loopback, so the client runs it **over SSH** — the existing secure architecture, no new surface. `deploy` already had four authorized keys; **no authentication, firewall, port or SSH policy was changed.**

One gap blocked it: `ssh host command` runs a **non-interactive** shell, so `~/.bashrc` returns before exporting anything and the per-upstream tokens would never reach the process — every credentialed tool would have reported its upstream unavailable. Closed with the runtime-config pattern the repository already uses for `oth-knowledge-http`:

```
/home/deploy/deployments/oth-mcp/.env               0600 deploy — the four upstream URLs + 2 tokens
/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh   0750 deploy — sources them, execs the server
```

Tokens were **reused** from the services that already own them (`OTHK_HTTP_TOKEN`, `MYTHOS_EXECUTOR_TOKEN`). None were created, rotated or committed. Both files live outside the git worktree.

A second defect was found and fixed in documentation: `README.md` told clients to run `/home/deploy/projects/mythos-prod/projects/oth-mcp/server.js`. **That path does not exist** — that worktree tracks `main`, which does not carry `projects/oth-mcp`. A client following the README would have received `Cannot find module`. The README now records the real deployed paths.

Validated before enabling: configuration, file permissions, service user, launcher failure behaviour (exit 78 with a named reason on a missing env file or server), and that no credential is committed or echoed.

## 7. Real MCP client results

Client: **`@modelcontextprotocol/inspector` 2.4.0**, the official SDK-based client — genuinely independent of this repository's dependency-free implementation. Installed **outside** the repository (`/home/deploy/tmp-mcp-validation-20260830`, removed afterwards); no dependency was added to `mythos-prod`. "The server starts" was never treated as sufficient.

Handshake, `tools/list` and `tools/call` all succeeded over the deployed launcher. **All 7 declared tools returned live data from their owning system:**

| Tool | Result | Source proven |
|---|---|---|
| `knowledge_search` | hits with provenance | OTH Knowledge facade |
| `knowledge_get` | record + provenance chain | OTH Knowledge facade |
| `project_context` | 21 projects | OTHMODE |
| `capability_registry` | 31 skills | OTHMODE |
| `execution_status` | task list | AI Executor |
| `execution_report` | completed task report | AI Executor |
| `system_health` | 19 LIVE / 1 DEGRADED / 0 DOWN | Status Center |

### Authorization and write-boundary tests

| Test | Expected | Actual |
|---|---|---|
| `tools/call knowledge_write` | DENIED | `No such tool: knowledge_write` |
| `tools/call knowledge_ingest` | DENIED | `No such tool` |
| `tools/call execution_create` (dispatch attempt) | DENIED | `No such tool` |
| Raw JSON-RPC unknown tool, bypassing the client's own tool check | DENIED | `isError: true`, `No such tool` |
| `resources/write` (unknown method) | DENIED | JSON-RPC `-32601 Method not found` |
| Path traversal in `include` (`../../etc/passwd`) | DENIED | `TOOL_INPUT: include must be provenance, evidence or history` |
| `capability_registry kind=secrets` | DENIED | `TOOL_INPUT: kind must be skills, tools or providers` |
| Missing required argument | DENIED | `TOOL_INPUT: id is required` |
| `POST` to the facade (write below the MCP) | DENIED | HTTP **405** |
| Unauthenticated read of the facade | DENIED | HTTP **401** |
| Token leakage in `initialize` / `tools/list` / `tools/call` / stderr | none | neither token appears anywhere in client-visible output |

**No production data was created or modified during validation.** Every call was a read; the two write-shaped attempts were rejected before reaching an upstream.

## 8. End-to-end verification

```
RECON → OTH Knowledge → HTTP facade → MCP → real MCP client
```

`knowledge_get observation-b7c4949a883a48a9` was fetched twice: once through the MCP client, once directly against the facade, bypassing the MCP. The payloads are **semantically identical** (`MCP payload == facade payload: True`), and the record id is present in `/home/deploy/othk-store/records.jsonl`. The MCP therefore returns the canonical layer's answer rather than one of its own.

Confirmed by reading the implementations:
- **MCP is not a second source of truth** — it has no store, no cache, and one `GET` verb.
- **RECON does not write knowledge** — `projects/status-center/` contains no reference to `oth-knowledge`, `knowledge-service`, `othk` or port 8150 in any code path; the only matches are historical PR titles in `data/pr-ledger.json`.
- **Extraction is separate from MCP** — `server.js` references no extractor, and `scripts/othdb-extract.js`, `scripts/othdb-select.js` and `lib/importers/conversation.js` reference no MCP. Extraction was left in its existing state; no archive extraction was started, and `claude-code` was not used as an advisory provider.

## 9. RECON

The existing Status Center engine (`projects/status-center/bin/review.js`, `lib/engine.js`) was verified and **not rebuilt**. The `mythos-status-monitor.timer` feeder is live (last run 23:29:43 UTC, exit 0).

A review was run **`--dry-run` only**. A non-dry review appends an immutable snapshot into `sites/status.mythosprod.xyz/` — the live status site — which is production data, and the mission forbids modifying production data unexpectedly. Findings:

```
Review:     REVIEW-2026-08-30-001    Projects: 23    Tracks: 15
Blockers:   0 blocked, 4 owner-action
Evidence:   99 items (67 verified here, 32 recorded, 0 NOT verified)
Changes:    +0 added, 0 completed, 0 regressed, 0 changed
(dry run — nothing written)
```

Noted: the engine reports `origin/main` at `30c7774`, while the local `main` worktree sits at `90d9ffe`. Unrelated to this mission; recorded, not acted on.

## 10. Files changed

| Path | Change | Why |
|---|---|---|
| `tests/othk-6-mcp-server-test.js` | pin the OTHMODE/executor URLs to the discard port in the test env | see §11 — the suite asserted fail-closed behaviour against a *live* upstream |
| `projects/oth-mcp/README.md` | correct the client config to the deployed launcher; record the real paths | the documented path does not exist |
| `docs/MYTHOS_SYSTEM_INDEX.md` | facade network gap marked **CLOSED**; §11 reconciled with the opposite-directions finding | verified facts only |

Not committed, by design (outside the worktree, contains a credential):
`/home/deploy/deployments/oth-mcp/.env`, `/home/deploy/deployments/oth-mcp/oth-mcp-stdio.sh`.

**No production code was modified.** `server.js`, `othk-http.js`, `mcp-capabilities.js`, every `lib/` module, every service unit and every probe are byte-identical to `0c5eb9a`.

## 11. Tests

```
TOTAL                122 suites
PASSED                99
FAILED                23
PRE-EXISTING          23
NEW REGRESSIONS        0
```

Knowledge / facade / MCP path, all green:

```
othk-0-knowledge-core            89 passed, 0 failed
othk-1-search                    30 passed, 0 failed
othk-2-importers                 97 passed, 0 failed
othk-2w-executor-wiring          42 passed, 0 failed
othk-3-trust                     63 passed, 0 failed
othk-4-conversation-extraction   90 passed, 0 failed
othk-5-http-facade               44 passed, 0 failed
othk-6-mcp-server                36 passed, 0 failed   (33/3 before the fix below)
```

### The one test that was failing, and why it was not a code defect

`othk-6` §E failed 3 assertions on this host. Section E asserts that an unavailable upstream fails closed and names its owner. It cleared `OTH_MCP_OTHMODE_TOKEN` but left `OTH_MCP_OTHMODE_URL` at its default `127.0.0.1:3021`. Commit `0c5eb9a` correctly made OTHMODE `requiresToken: false` — so clearing the token no longer makes it unavailable, and on the deployment host, where OTHMODE is actually running, the call answered **200**. The suite was asserting fail-closed behaviour against a live upstream.

Proven environment-specific before touching anything: with `OTH_MCP_OTHMODE_URL=http://127.0.0.1:9`, the unmodified suite passed **36/36**. The fix pins the URLs to the discard port so "unavailable" means the same thing on a laptop and on this host. Test-only; no production behaviour changed.

### Proof the other 23 failures are pre-existing

Not asserted — reproduced. A throwaway worktree was created at the rollback commit `0c5eb9a`, all 23 suites were run there, **all 23 failed identically**, and the worktree was removed. Causes, none related to this mission:

- **10 suites** — `Cannot find module` (`pg` and others). This worktree has no `node_modules`; neither does `/home/deploy/projects/mythos-prod`.
- **9 suites** — the `stage1c` / `stage2d` / `stage3a` DOM-dependent chain and the regression suites that shell out to it.
- **1 suite** — `mos-e2e-lifecycle`: a deliberate self-protecting refusal ("would touch that repository. Run this suite only in an isolated container"). Correct behaviour, honoured.
- **3 suites** — genuine assertion failures unrelated to MCP (`mpi-0-finalization-governance` 33/3, `stage4w` 42/2, and the `core`/`mcc-1`/`sya-*` module-path group).

None of the 23 reference any file this execution changed.

## 12. Security observations — DEFERRED, no hardening performed

No port was closed, no firewall, SSH, CORS, TLS, Coolify or Docker policy touched, no credential rotated, no authentication changed, no security infrastructure created. Documented only, for the dedicated security mission:

1. The HIGH findings from the 2026-08-30 19:40 worklog §13 remain **open and unremediated** — the unauthenticated write surface behind a server-level deny, the privileged remote-desktop surface on a public port, and host memory pressure. Deliberately not touched.
2. `mythos-git-push.service`, `mythos-backup-capture-db.service` and `mythos-backup-db-verify.service` are in a **failed** state. Backup integrity is a standing risk; observed, not fixed.
3. The MCP's security posture rests on **host access**: anyone who can `ssh deploy@` can run the launcher and read knowledge, OTHMODE and executor state. That is the same boundary the facade and OTHMODE already rely on, and it is the intended design — recorded so it is a decision on the record rather than an assumption.
4. `OTH_MCP_OTHMODE_URL` reaches a route table serving `auth:false`. Verified accurate, and correct for a loopback read model; noted so a future public exposure of :3021 is understood to change the MCP's effective boundary too.

## 13. Rollback point

| | |
|---|---|
| Commit | `0c5eb9a27f12aa4102be2cb1859ac5ca13160e8b` |
| Ref | `origin/vps/oth-mcp-20260830` |
| Tree at that commit | clean |

To roll back completely: `git checkout 0c5eb9a` in `/home/deploy/oth-mcp`, then `rm -rf /home/deploy/deployments/oth-mcp`. Nothing else was touched — no service was restarted, stopped or installed, no database read or written, no file deleted, no history rewritten, no force-push.

## 14. Final state

**MCP: DEPLOYED + REAL CLIENT VERIFIED.**

Deployed as it already existed, over the existing SSH/stdio transport, with no new public surface and no code rewritten. All 7 tools exercised against live upstreams by an independent MCP client; every write and unknown-operation attempt denied; no secret leaked.

Not claimed: "production ready" in the wider sense. The transport depends on host SSH access, the open HIGH security findings from the prior audit are untouched by design, and three backup-related units are failing.

## 15. Unresolved items

1. `docs/MYTHOS_FINAL_SYSTEM_AUDIT.md` is referenced by the mission but does not exist. Either it was never committed or the name is wrong.
2. `projects/oth-mcp` exists only on `vps/oth-mcp-20260830`, not on `main`. Until it is merged, the deployed path is worktree-dependent — recorded in the README, but a merge decision is the owner's.
3. Three `mythos-backup-*` / `mythos-git-push` units are failing (§12.2).
4. The prior audit's open HIGH findings remain open (§12.1).
5. `origin/main` (`30c7774`) is ahead of the local `main` worktree (`90d9ffe`).
6. `mpi-0-finalization-governance` (3) and `stage4w` (2) have genuine, unrelated assertion failures.

## 16. Next action

Owner decision on merging `vps/oth-mcp-20260830` into `main`, then the deferred **security hardening mission**, which should take §12 as its input.
