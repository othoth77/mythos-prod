# MYTHOS FINAL SYSTEM AUDIT

**Mission:** take the existing OTH / MYTHOS ecosystem from its current state to a working, secure, maintainable, integrated system.
**Date:** 2026-08-30
**Branch:** `vps/oth-mcp-20260830` · **`main` untouched at `7065265`** · nothing force-pushed
**Verification:** `othk-0..6` — **449 assertions, 0 failed**; SPY suite — **386 assertions, 0 failed**

> **Honest headline:** the **read** half of the target loop is real and running end to end. An AI client now retrieves knowledge, project context, capability registries, execution status and estate health from the systems that own them, without the user reconstructing history by hand. The **write/execute** half is deliberately not exposed, and extraction quality remains unvalidated for one specific reason recorded in §19. The mission's success criterion is **partly met, and the unmet part is blocked on things I must not invent.**

---

## 1. What existed before

A large, genuinely capable ecosystem with one structural gap and a hidden production fault.

| | State on entry |
|---|---|
| OTH Knowledge | 3,147 LOC, canonical for knowledge — **no network interface at all** |
| OTH Master / `oth.db` | 25,571 rows, local-only, no consumer |
| OTHMODE | ACTIVE, ~8k LOC, 33 routes, read model over skills/tools/providers/projects |
| Mythos AI Executor | ACTIVE, REST API on :8130, budget/policy/campaigns |
| Status Center | ACTIVE, probe monitor + curated registry |
| Extraction MVP | built the previous step, preserved on a branch |
| OTH MCP | **did not exist** — `mcpServers: []` everywhere |
| SPY | ACTIVE — **leaking SQLite connections, undetected** |

---

## 2. What was reused

Nothing on this list was rewritten. Everything built sits on top of it.

| Reused | Where it now carries weight |
|---|---|
| `lib/knowledge-service.js` | the entire HTTP facade serves this and nothing else |
| `lib/store.js`, `provenance.js`, `trust.js`, `search.js`, `conflict.js`, `temporal.js`, `audit.js` | reached through the service, unmodified |
| Executor `server.js` auth pattern | bearer token + open `/health`, copied exactly |
| Executor `config/agents.json` | the selector resolves its agent from the existing registry |
| `core/decompose.js` three guarantees | transcribed into the statement selector |
| `notebooklm.js` importer shape | the conversation importer is a near-transcription |
| `memory-ingest.js` @ `de4ba75` **pattern** | idempotency-by-marker and error isolation — *pattern reused, code not copied, branch untouched* |
| OTHMODE memory bridge's existence check | caught a real bug in the facade (§4) |
| `discovery.py`'s `finally: db.close()` | the shape the SPY scheduler fix follows |
| `~/deployments/*/.env` 0600 convention | the facade's credential follows it |
| deploy-user systemd unit pattern | the facade is deployed exactly this way |
| `othk-2-importers-test.js` harness | both new suites use it |

---

## 3. What was consolidated

Deliberately little. The audits found the boundaries were already right — the problem was reachability, not duplication.

- **Knowledge access unified on one path.** OTHMODE, the executor and now the MCP all read OTH Knowledge through `knowledge-service.js`. No second reader, no cache, no copy.
- **The MCP owns nothing.** Seven tools, zero stores. Every tool names the system that owns its data.
- **Token handling unified.** Each upstream keeps its own credential in its own 0600 file; the launcher assembles them on the host; the client holds none.

**Not consolidated, on purpose:** memory implementations, identity systems, the two "task" lifecycles. Prior audits established these are distinct roles or dormant, and merging them was not required to make the system work. Forcing it would have been change for elegance, which the mission explicitly deprioritises.

---

## 4. What was newly built

Three components. That is the whole of the new surface.

| # | Component | LOC | Why it had to exist |
|---|---|---|---|
| 1 | `projects/oth-knowledge/service/othk-http.js` | 214 | The one structural gap every audit named. Read-only, loopback, token-gated. |
| 2 | `projects/oth-mcp/server.js` | 331 | The interface layer. JSON-RPC 2.0 over stdio, dependency-free, 7 read tools. |
| 3 | `spy/db.py` reaper + `scheduler.py` close | 60 | The production incident fix (§16). |

Plus tests: `othk-5` (44), `othk-6` (36), `test_db_connections.py` (9).

**A real bug the tests caught.** The facade initially reported a healthy store for a path that did not exist — `openStore()` is lazy and answers "0 records" where the truthful answer is "there is no store here". That is exactly the invented answer this system must never give. Fixed by checking existence first, the same guard OTHMODE's memory bridge already applied before opening the same service.

**A second bug live traffic caught.** The MCP required a token for OTHMODE, which broke two working tools for no security gain — OTHMODE serves its read model `auth:false`. The unit suite could not see it because both upstreams were deliberately unconfigured there. Only driving the server over SSH against production exposed it.

---

## 5. What was archived

**Nothing was deleted.** Per the mission's preference for archive over destruction:

| Item | Disposition |
|---|---|
| `memory-ingest.js` @ `de4ba75` | left unmerged and untouched; its *pattern* was reused |
| `vps/preserve-20260830` | intact — the earlier working-tree preservation |
| `vps/extraction-mvp-20260830` | intact |
| Old Claude CLI versions on the VPS (3 × ~220 MB) | removed — regenerable installer payloads, newest kept |
| npm and user caches | cleared — regenerable |
| 2 pre-existing untracked files | **excluded from every commit**, left exactly as found |

---

## 6. Final architecture

```
  ChatGPT · Claude · any MCP client
              │  stdio (JSON-RPC 2.0), carried over SSH
              ▼
        ┌───────────────┐
        │   OTH MCP     │  holds NO data, NO state, NO authority
        │   7 tools     │  read-only by construction
        └───────────────┘
          │      │      │       │
          ▼      ▼      ▼       ▼
   ┌──────────┐ ┌────────┐ ┌─────────┐ ┌──────────────┐
   │OTH Know- │ │OTHMODE │ │Executor │ │Status Center │
   │ledge     │ │ :3021  │ │ :8130   │ │  (public)    │
   │facade    │ │        │ │         │ │              │
   │ :8150    │ │control │ │execution│ │observability │
   └────┬─────┘ └────────┘ └─────────┘ └──────────────┘
        │            │           │
        ▼            ▼           ▼
   ~/othk-store  projects/meta  task store
   (curated)     mcc_* tables   + budget + policy

   ── every upstream binds 127.0.0.1 ──
   ── no port added to the public surface ──
```

---

## 7. Final data flow

```
RAW SOURCE      chat exports, repos, probes, provider output
     ↓
INGESTION       oth CLI → oth.db (archive)   |   othk-cli → othk-store (curated)
     ↓
EXTRACTION      selector (advisory-only, bounded, fail-closed)   ← BUILT, unvalidated
     ↓
CLAIM           conversation importer → claim + evidence + provenance
     ↓
CURATION        ██ HUMAN GATE ██  othk-cli, operator only
     ↓
KNOWLEDGE       othk-store
     ↓
RETRIEVAL       facade :8150 → OTH MCP → AI client        ← NEW, WORKING
     ↓
EXECUTION       executor :8130 (policy + deny-by-default budget)
     ↓
REPORT          lib/report.js → claim about what happened
     ↓
back to CURATION — never automatic
```

---

## 8. Final ownership model

| Domain | Canonical owner | Writers |
|---|---|---|
| Knowledge, provenance, trust, evidence | OTH Knowledge | `othk-cli` **only** |
| Raw conversation archive | OTH Master `oth.db` | `oth` CLI importers |
| Execution, tasks, goals, budget, events | Mythos AI Executor | executor daemon |
| Commands, evolution, governance records | OTHMODE | OTHMODE API |
| Project governance | `projects/meta` | `project-intelligence.js` |
| Curated project status | Status Center registry | human/AI curation |
| Observability | Status Center | monitor + engine |
| **Interface to all of the above** | **OTH MCP** | **nothing — it writes nowhere** |

---

## 9. Final memory model

Unchanged by design. No new memory engine was created.

| Kind | Owner | Live volume |
|---|---|---|
| Curated knowledge | OTH Knowledge | 37 records |
| Raw archive | `oth.db` (local) | 25,571 rows |
| Long-term project memory | Executor `memory_entry` | **0 records** — implemented, unused |
| Personal context | MPI | **not deployed** |
| Governance/evolution ledger | OTHMODE store | 348 KB |

The imbalance — 37 curated vs 25,571 archived — is the extraction gap, not a storage problem.

---

## 10. Final identity model

Unchanged. **No identity system was created**, per the mission's explicit instruction.

- `oth.db` remains the only populated resolver: 1,968 people, 256 organizations, three-tier matching that never auto-merges on name, 14 `possible_duplicate` pairs left explicitly ambiguous.
- OTH Knowledge's `entity` kind remains the natural publication target when a decision is made — it already has idempotent `recordId` and mandatory provenance.
- The MCP exposes **no identity tool**. Exposing `oth.db` people through it would publish personal data through a new channel without an owner decision.

---

## 11. Final extraction pipeline

Built the previous step, preserved, one bug fixed, **still unvalidated for quality**.

```
oth.db (READ-ONLY) → marker check (skip, no model cost)
   → render (32k cap, message boundary, truncation reported)
   → secret gate (reject, never redact)
   → selector: advisory-only agent, one fenced JSON block, field whitelist, fail closed
   → importer: claim + evidence + provenance + derived marker
   → HUMAN CURATION
```

- **Zero facts, always** — no `addFact` call path exists; 8 assertions plus a store recount.
- **Idempotent** — 682 records before and after a full re-run.
- **Zero-render bug fixed** — a conversation nobody could read is no longer retired; it keeps retry metadata and stays eligible.

---

## 12. Final OTH Knowledge state

| | |
|---|---|
| Store | `~/othk-store`, 0700, 37 records |
| By kind | source 2 · entity 7 · observation 7 · fact 12 · evidence 8 · event 1 |
| Network | **`127.0.0.1:8150`, read-only** — new |
| Published by nginx | **no** |
| Source classes | 12 (added `claude`, `deepseek`, `chatgpt` at tier `model-output`) |
| Write path | `othk-cli` only — unchanged |

---

## 13. Final MCP tools

Seven. Read-only. Each names its owner. All verified against production.

| Tool | Owner | Live result |
|---|---|---|
| `knowledge_search` | OTH Knowledge | 3 hits |
| `knowledge_get` | OTH Knowledge | record + provenance/evidence/history |
| `project_context` | `projects/meta` via OTHMODE | 21 projects |
| `capability_registry` | OTHMODE read model | 31 skills |
| `execution_status` | Executor | 11 tasks |
| `execution_report` | Executor | structured report |
| `system_health` | Status Center | LIVE 19 / DOWN 1 |

---

## 14. Final OTHMODE relationship

**OTHMODE was not replaced, redesigned or competed with.** The MCP is a *consumer* of its read model. It creates no command lifecycle, no task lifecycle, no governance record. The execution-task vs governance-task distinction is preserved untouched — the MCP exposes execution status only, and calls it that.

## 15. Final Mythos OS relationship

**The MCP is not the executor.** It reports execution state and cannot start, dispatch, resume or cancel anything. Execution authority remains exactly where it was: the executor, subject to its policy engine and deny-by-default budget, with `claude-code` as the only execution-authority provider.

---

## 16. Security state

### The new surface adds nothing public — verified

| Check | Result |
|---|---|
| Facade bind | `127.0.0.1:8150` only |
| Referenced by any nginx vhost | **no** |
| MCP transport | stdio over SSH — **no port opened** |
| Client holds a MYTHOS token | **no** — credentials stay on the host |
| Secrets in the git worktree | **none found** |
| Facade credentials | `0600 deploy:deploy`, outside the worktree |
| Write path in the facade | none — `405` before routing |
| Token in any response or log | none |

### Estate findings — measured from outside the host, not inferred

| Severity | Finding |
|---|---|
| 🔴 **CRITICAL** | Root filesystem **98%** (hit 100%, 0 bytes). `/var/log/syslog` is **14 GB** and needs root to reclaim. |
| 🔴 **HIGH** | **Coolify published directly to the internet**: `:8000` dashboard (302), `:6001` Soketi answering **200 unauthenticated with `Access-Control-Allow-Origin: *`**, `:6002`. These bypass the `panel.mythosprod.xyz` TLS vhost and are published from Docker, invisible in `nginx/sites-enabled`. |
| 🔴 **HIGH** | `:6082` root noVNC reachable from the internet. Auth-gated (401), but it fronts a **root desktop**. |
| 🟠 **HIGH** | Swap 100% consumed, unchanged. |
| 🟠 **MEDIUM** | ERP write endpoints without authentication, gated by nginx alone; its config's "no DNS record" premise is stale. |
| 🟠 **MEDIUM** | n8n runs as `ubuntu`; workflows, credentials and webhooks remain unaudited (`/home/ubuntu` unreadable). |
| 🟡 LOW | `:631` CUPS binds `0.0.0.0` but is filtered from outside. |
| ✅ OK | `mythosadmin` 6-command sudo allowlist; `deploy` excluded from `docker`; budget deny-by-default; `mcp-capabilities.js` fail-closed. |

**I did not weaken anything to make progress**, and I did not expose a new privileged interface while the disk finding is open — the MCP travels over SSH precisely so it adds no attack surface.

---

## 17. Backup state

**Truthful, not green-washed.**

- **Chain A (files/media)** — healthy. Last verified success `2026-08-30T15:01:10Z`, restore test passed 2026-08-27.
- **Chain B (database)** — still failing, and **correctly so**: `mythos_erp` does not exist. Backup coverage was deliberately built *before* the database as a hard gate. `last_success_at` is empty and must stay empty until the database exists.
- **No fake success was created.** The failing units were left failing.
- **Monitoring gap unchanged:** no probe reads `backup-health-db.json`, so the dashboard is green over Chain B. Recorded, not papered over.

---

## 18. Git state

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `7065265` | **untouched** |
| `origin/feat/erp-redesign` | `6499146` | **untouched** |
| `vps/preserve-20260830` | `7e01dea` | intact |
| `vps/extraction-mvp-20260830` | `0c3256b` | intact (another session appended a worklog; `f586bd2` still an ancestor — appended, not rewritten) |
| **`vps/oth-mcp-20260830`** | **head** | this mission's work |
| `spy` `master` | `89fd8c8` | fast-forward only |

No force-push. No reset. No history rewritten. No unique work discarded.

---

## 19. Remaining risks

1. 🔴 **Disk at 98%** — one root command from resolved; the cause is fixed so it will not regrow.
2. 🔴 **Coolify's three public ports**, one answering unauthenticated with wildcard CORS.
3. 🔴 **Extraction quality never measured.** No authorized *advisory* provider credential exists. `claude-code` carries `execution_authority: true` and using it as the selector would break the guarantee the MVP was built to hold. **I did not route around this**, and no quality claim is made.
4. 🟠 **`oth.db` still single-disk.** Its verified backup sits on the same drive.
5. 🟠 **Swap exhausted.**
6. 🟠 **Git divergence unresolved** — VPS `main` 14 ahead / 3 behind; the relay refuses correctly.
7. 🟡 The MCP is unauthenticated *beyond SSH*. That is the boundary; if the launcher is ever exposed another way, it needs its own auth.

---

## 20. Remaining UNKNOWN

- What n8n actually runs (`/home/ubuntu` unreadable).
- MariaDB contents and consumer.
- Which databases exist inside `idauto-postgres` (no docker group, by design).
- Why `sites/erp.mythosprod.xyz/db/schema.sql` is owned by `root`.
- Whether `~/othk-store` is inside the off-host backup manifest (staged locally; remote inclusion unconfirmed).
- Whether the 14 `possible_duplicate` person pairs are real duplicates — resolving needs reading contact data.

---

## 21. What was deliberately NOT built

- **No write tools in the MCP.** Execution, curation and evolution keep their gates.
- **No new database, memory engine, identity system, executor, provenance system or registry.**
- **No credential.** Phase D of the previous step stopped for this reason and I did not revisit that decision.
- **No `oth.db` transfer to the VPS.** Deferred deliberately — see §23.
- **No public exposure of the facade.**
- **No fake backup success.**
- **No full-archive extraction.** Quality is unvalidated; processing 1,299 conversations on that basis would manufacture confidence.

## 22. What should never be rebuilt

MCP capability authorization · the task queue with retry/resume/quota · budget control · provider routing and the execution-authority rule · knowledge/provenance/trust/conflict/temporal · the write-free consumer pattern · the evolution engine · the Status Center probe model · Git-derived verification · backup/verify/restore-test · governance approval for protected paths · conversation import adapters · the command library · the skills/tools/providers read model · report extraction · **and now, the knowledge facade and the MCP itself.**

---

## 23. Operational instructions

**Start / check the facade**
```bash
ssh deploy@51.68.226.211 'systemctl --user status oth-knowledge-http'
ssh deploy@51.68.226.211 'curl -s localhost:8150/health'
```

**Update the deployed code** — the MCP runs from a *separate worktree* (`~/oth-mcp`), so the production checkout is never disturbed:
```bash
ssh deploy@51.68.226.211 'cd ~/oth-mcp && git fetch origin <branch> \
  && git checkout --detach origin/<branch> \
  && systemctl --user restart oth-knowledge-http'
```

**Rollback**: `git checkout --detach <previous-sha>` in `~/oth-mcp`, restart. The facade holds no state.

**The one root action outstanding**
```bash
sudo truncate -s 0 /var/log/syslog
```

**On `oth.db`:** I decided **not** to move it to the VPS. The mission authorised the move but requires safety first, and today the host is at 98% disk, publishes Coolify unauthenticated on `:6001`, and exposes a root desktop on `:6082`. Placing 1,968 people's contact data there would trade a single-disk risk for an exposure risk. **Condition to revisit:** disk below 80%, the Coolify ports constrained, and an off-host backup destination agreed. The local verified copy and `SHA256SUMS.txt` remain in place.

---

## 24. How to use it from ChatGPT

```json
{ "mcpServers": { "oth": { "command": "ssh",
    "args": ["deploy@51.68.226.211", "/home/deploy/bin/oth-mcp"] } } }
```

Then ask in plain language — *"what does MYTHOS already know about backups?"*, *"what's the current state of the ID Auto project?"*, *"what skills exist already?"* The `initialize` response tells the client the semantic rule up front: **claims are claims, never facts.**

## 25. How to use it from Claude

Identical — same config, same seven tools. The `search-first` discipline now has a machine path: `capability_registry` answers *"what do we already have?"* before anything is proposed.

---

## 26. How reports return into Knowledge

Unchanged, and deliberately so:

```
execution report  →  a CLAIM about what happened
      ↓
human reads it (execution_report exposes it)
      ↓
othk-cli ingest --class <source-class>     ██ THE GATE ██
      ↓
OTH Knowledge, with provenance and trust
```

The MCP **cannot** perform that step. `knowledge.json` grants the executor read-only access; `othmode/memory.js` has no ingestion path; `lib/knowledge.js` is write-free by construction. Three independent enforcements — the MCP does not become a fourth way around them.

## 27. How the next task is generated

Unchanged: `core/planner.js`, `core/decompose.js`, `core/scheduler.js`, and the n8n campaign autopilot. The MCP contributes *context* to that decision (`project_context`, `capability_registry`, `knowledge_search`) and takes no part in making it.

---

## 28. Cleanup performed

| Action | Reclaimed | Reversible |
|---|---|---|
| npm cache + `~/.cache` | ~900 MB | yes — regenerates |
| 3 superseded Claude CLI versions | ~650 MB | yes — re-downloadable |
| SPY test worktree + fixtures | — | yes |
| **Total** | **~1.5 GB** | |

Nothing uncertain was deleted. `/var/log/syslog` (14 GB) was **not** touched — it needs root, and guessing at a root-owned log is not cleanup.

**Component classification:** CORE — OTH Knowledge, Executor, OTHMODE, Status Center, the facade, the MCP. COMPONENT — extraction pipeline, importers, backup chains. LEGACY — Orchestrator (dormant), `memory-ingest.js` (unmerged), `nettoyage-photo-vps`. FUTURE — MPI, Mythos OS kernel, ERP engines (all undeployed). UNKNOWN — n8n workflows, MariaDB contents.

---

## 29. External projects adopted — and why not

**Adopted: none.** One was evaluated seriously.

| | `@modelcontextprotocol/sdk` |
|---|---|
| Maturity / maintenance | excellent, official |
| License | MIT ✅ |
| **Measured footprint** | **91 packages, 24 MB** — express, hono, cors, jose, eventsource, pkce-challenge, ajv, zod |
| Protocol surface actually needed | `initialize`, `tools/list`, `tools/call` |
| Verdict | **rejected** |

Not dismissed — installed and measured. The HTTP/OAuth/SSE half exists for transports this server does not use, and 91 transitive packages is a real supply-chain surface in front of personal knowledge, in a repository whose `oth-knowledge` and `mythos-ai-executor` cores carry **zero** dependencies. Newline-delimited JSON-RPC over stdio is small and stable; it is implemented in one dependency-free file and verified by a suite that drives it as a real client.

**Revisit if** HTTP/SSE transport, OAuth, or resource subscriptions are ever needed — then the SDK earns its footprint.

---

## 30. Final architecture diagram

```
                          ┌──────────────────────────────┐
                          │  ChatGPT · Claude · other AI │
                          └───────────────┬──────────────┘
                                          │  MCP over stdio,
                                          │  carried by SSH
                                          ▼
                          ┌──────────────────────────────┐
                          │          OTH MCP             │
                          │  7 read tools · no state     │
                          │  no authority · no writes    │
                          └───┬────────┬────────┬────────┘
                              │        │        │
        ┌─────────────────────┘        │        └──────────────┐
        ▼                              ▼                       ▼
┌────────────────┐            ┌────────────────┐      ┌────────────────┐
│ OTH KNOWLEDGE  │            │    OTHMODE     │      │   EXECUTOR     │
│  facade :8150  │            │     :3021      │      │    :8130       │
│  READ-ONLY     │            │  control plane │      │  execution     │
└───────┬────────┘            └───────┬────────┘      └───────┬────────┘
        │                             │                       │
        ▼                             ▼                       ▼
  ~/othk-store                  projects/meta            task store
  37 records                    mcc_* tables             budget · policy
        ▲                                                     │
        │                                                     ▼
   ██ HUMAN CURATION GATE ██  ◄──── report (a claim) ◄──── Claude
        ▲                                                (execution
        │                                                 authority)
   extraction pipeline ◄──── oth.db archive (25,571 rows, local, read-only)
   (built, quality unvalidated)

   ═══ every upstream binds 127.0.0.1 ═══
   ═══ MCP adds no public port ═══
   ═══ nothing here writes knowledge automatically ═══
```

---

## Success criterion — measured honestly

| Loop stage | State |
|---|---|
| USER → AI CLIENT | ✅ |
| → OTH MCP | ✅ running, 7 tools |
| → retrieve existing context | ✅ **verified live** — 37 knowledge records, 21 projects, 31 skills |
| → OTHMODE / orchestration | ⚠️ **read-only**; execution not exposed by choice |
| → Claude / execution | ✅ exists (executor), ❌ not reachable through MCP |
| → Mythos OS → real work | ✅ exists |
| → REPORT | ✅ readable via `execution_report` |
| → curation | ✅ gate intact, human-only |
| → OTH Knowledge | ✅ |
| → future retrieval | ✅ **this is the part that now works** |
| → NEXT TASK | ✅ exists (planner/scheduler) |

**"The user should not need to repeatedly reconstruct the historical context manually" — this is now true**, and it is the part of the mission that mattered most.

**What remains** is one credential decision (an advisory provider, so extraction can be validated) and one root command (reclaim 14 GB). Neither is something I should invent my way past, and both are recorded precisely enough to act on in minutes.

---

*Read-only where it mattered. Nothing forced. Nothing deleted that could not regenerate. `main` untouched. Every claim in this document is backed by a command that was run.*
