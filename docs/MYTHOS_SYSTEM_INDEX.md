# MYTHOS SYSTEM INDEX

## Purpose

This document is the canonical **inventory and reuse index** for systems, engines, runtimes, architectures, registries, modules, protocols, infrastructure, and proven patterns already created across the MYTHOS / OTH ecosystem.

> **Before building anything new: discover what already exists, identify its canonical owner, verify its real status, and reuse / extend / connect it before creating a duplicate.**

This index is not itself runtime truth. It records verified findings and clearly marks findings that still require direct verification.

**Initial research snapshot:** 2026-08-30  
**Independent ecosystem audit incorporated:** 2026-08-30  
**Execution mission incorporated:** 2026-08-30 — OTH MCP and the OTH Knowledge read-only facade built, tested and running (§41); SPY connection-leak incident diagnosed and fixed (§44).  
**Primary repository:** `othoth77/mythos-prod`  
**Default branch:** `main`

---

# 1. EVIDENCE AND STATUS RULES

## Evidence classes

- **VERIFIED** — directly confirmed from code, runtime, database, service, tests, logs, or infrastructure.
- **PARTIALLY VERIFIED** — meaningful evidence exists, but part of the claim still needs direct confirmation.
- **DESIGNED** — architecture/specification exists; runtime implementation is not established.
- **INFERRED** — conclusion derived from evidence but not directly proven.
- **UNVERIFIED** — known/referenced but not directly accessible or confirmed.

## Implementation status

| Status | Meaning |
|---|---|
| ACTIVE | Running operational implementation |
| IMPLEMENTED | Code exists and is usable/tested |
| FOUNDATION | Partial implementation / platform foundation |
| DESIGNED | Architecture/spec exists; runtime incomplete |
| CONCEPT | Idea/specification only |
| EXTERNAL | Canonical implementation is another repository/system |
| LEGACY | Existing implementation retained as a reuse source |
| UNKNOWN | Not sufficiently verified |

Never promote `DESIGNED`, `INFERRED`, `UNVERIFIED`, or `UNKNOWN` without direct evidence.

---

# 2. SOURCE-OF-TRUTH PRIORITY

When sources disagree, use this order:

```text
1. Current runtime behavior
2. Current source code
3. Current production verification
4. Current database/service state
5. Current tests
6. Current registries / ledgers
7. Latest audit / handover
8. Current architecture documents
9. Older documentation
10. Historical conversations / design notes
```

A README, blueprint, registry snapshot, or old audit must never override newer runtime evidence.

---

# 3. CURRENT SYSTEM MAP

```text
                         HUMAN
                           │
                           ▼
                       OTHMODE
          control / discovery / history /
          governance / evolution / visibility
                           │
       ┌───────────────────┼────────────────────┐
       ▼                   ▼                    ▼
 OTH Knowledge        Project Meta        Status Center
 evidence/knowledge   governance          execution truth
       │
       ▼
 Context / Evidence
       │
       ▼
 Personal Intelligence / future AI Gateway
       │
       ├──────── Advisory Providers
       │
       └──────── Execution Providers
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
    Orchestrator         AI Executor
 delegation/verify     persistent execution
                              │
                              ▼
                           Claude
                              │
                              ▼
                       Project Repositories
                              │
                              ▼
                           Report
                              │
                              ▼
                       Curation / Evidence
                              │
                              ▼
                       OTH Knowledge
```

Supporting platform:

```text
Mythos OS Kernel
├── Identity
├── Tenancy
├── Universal Entity Model
├── Relationships
├── Files
├── Modules
└── Permissions
```

External workflow/integration boundary:

```text
n8n / HTTP / webhooks
```

Personal archive/context boundary:

```text
OTH Master
```

---

# 4. OTHMODE — CONTROL PLANE

**Status:** ACTIVE / production  
**Evidence:** VERIFIED  
**Production:** `othmode.mythosprod.xyz`

OTHMODE is the main operational control surface over existing MYTHOS engines. It was adapted from Command Center rather than rewritten.

Existing capabilities include:

- Commands / Saved Commands
- Skills / Tools / Providers / Projects
- Health / Status
- Command History
- Memory read bridge
- Search First
- Evolution Memory
- Genes / Capsules / Signals
- Selector / Review / Validation
- Git / Rollback
- Security
- multilingual / RTL / responsive UI

Canonical rule: **OTHMODE controls and exposes; it must not silently duplicate underlying engines.**

Evidence paths:

- `docs/othmode/OTHMODE_100_PERCENT_AUDIT.md`
- `docs/othmode/OTHMODE_FINAL_REPORT.md`
- `projects/command-center/reference/othmode/`

---

# 5. OTH KNOWLEDGE — STRUCTURED KNOWLEDGE / EVIDENCE

**Status:** IMPLEMENTED  
**Evidence:** VERIFIED  
**Location:** `projects/oth-knowledge/`

Core model includes:

```text
source / artifact / document / chunk / entity
fact / claim / observation / event / relationship
evidence / derived
```

Capabilities include:

- content-addressed artifacts
- append-only storage
- exact / BM25 / vector-interface / hybrid search
- provenance and evidence
- trust assessment
- contradiction detection
- temporal state / history
- versioning / conflicts
- validation / export / CLI
- Google Takeout importer
- Gemini importer
- NotebookLM importer
- Google Contacts metadata-only importer

Critical semantic rule:

```text
AI output != fact
worker report = claim until verified/curated
```

Existing boundary:

- `projects/oth-knowledge/lib/knowledge-service.js`
- `projects/oth-knowledge/lib/api.js`
- OTHMODE read-first bridge: `projects/command-center/reference/othmode/memory.js`

## Network boundary — gap CLOSED; facade DEPLOYED, MCP server not

**Status:** facade ACTIVE · MCP server IMPLEMENTED, NOT DEPLOYED · **Evidence:** VERIFIED on the host 2026-08-30 21:20 UTC

The gap the independent audit named — internal APIs and a CLI, but nothing on the network — is closed in code:

- `projects/oth-knowledge/service/othk-http.js` — read-only HTTP facade over `lib/knowledge-service.js`, the boundary that already has no mutator. GET only; every other method is refused before routing. Binds loopback; bearer token required, `/health` open so a probe needs no credential. A missing store is a reportable 503, never an attempt to create one.
- `projects/oth-mcp/server.js` — the MCP interface layer over that facade and the existing OTHMODE and executor APIs.

Tested: `tests/othk-5-http-facade-test.js` (44) and `tests/othk-6-mcp-server-test.js` (36).

### Runtime state, verified on the host

| | |
|---|---|
| Facade | **DEPLOYED** — `oth-knowledge-http.service`, a `deploy`-user unit running `~/oth-mcp/projects/oth-knowledge/service/othk-http.js` |
| Bind | `127.0.0.1:8150` **only** — confirmed by `ss` and by an external probe that cannot reach it |
| Exposure | **none** — referenced by no nginx vhost; port 8150 is unreachable from the internet |
| Auth | enforced — `/health` answers 200 without a token by design, `/stats` answers 401 |
| MCP server | **NOT DEPLOYED** — no unit, no unit file, no process |
| Capability entry | `config/mcp-capabilities.json` `oth-knowledge` ships `enabled: false` |

Public exposure remains an owner decision. The facade is loopback-only and must stay behind an authenticated boundary; nothing about the MCP work has opened a network surface.

Ingestion and curation remain on `othk-cli`. The facade declares **no write tool**, which is what keeps a model-authored statement from becoming curated knowledge without a human.

---

# 6. OTH MASTER — PERSONAL CONTEXT / ARCHIVE

**Status:** EXISTING SYSTEM / separate role  
**Repository:** `othoth77/oth-master`

Existing concepts:

- conversations
- memories
- projects
- sources
- sync
- CLI
- context export
- provider interoperability
- personal archive

Working boundary:

```text
OTH Master
= personal context / conversation continuity / archive

OTH Knowledge
= structured knowledge / evidence / provenance / temporal knowledge

Mythos OS
= platform identity / entities / tenancy / files / modules
```

Do not create another memory store until this boundary is fully consolidated.

---

# 7. CRITICAL DISCOVERY — REAL `oth.db`

**Status:** CRITICAL / VERIFIED by independent local-machine audit  
**Location reported:** `Desktop\\oth-master\\data\\oth.db`

Independent audit discovered a real local OTH database approximately **29.8 MB** containing approximately:

- 1,306 conversations
- 7,733 messages
- 1,968 people
- 256 organizations

The audit reports verified imports from Claude, DeepSeek, and Google Contacts.

The same audit reported that the VPS canonical store observed during the audit was only about **21 KB**.

## Consequence

The real accumulated personal/context data exists, but the canonical deployment/data-placement decision is unresolved.

## Risk

The audit reported this database as local-only, without a confirmed off-host backup, on a disk approximately 92% full and planned for decommission.

**Do not migrate, overwrite, or merge this database automatically. Preserve first; reconcile second.**

---

# 8. MYTHOS OS — PLATFORM KERNEL

**Status:** ACTIVE DEVELOPMENT / implemented foundation  
**Repository:** `othoth77/mythos-os`

Implemented foundation includes:

- Identity
- Tenancy
- Universal Entity Model
- Entity relationships
- Files / attachments
- Module Kernel foundation
- Permissions foundation

Do not create independent identity systems inside domain modules when UEM can own identity.

Existing module concepts include:

- `ModuleManifest`
- `ManifestReader`
- `ManifestRegistry`
- `ModuleKernel`
- `ModuleDependencyValidator`
- Nwidart integration

Files foundation includes:

- Attachment
- FileStore
- AttachmentPolicy
- entity ownership
- tenant isolation

---

# 9. MYTHOS PERSONAL INTELLIGENCE — MPI

**Previous classification:** FOUNDATION / design/reference implementation  
**Updated classification:** PARTIALLY IMPLEMENTED; production scope still requires verification  
**Evidence:** independent audit + existing repository evidence

The independent audit found more implementation than the previous index recorded:

- two PostgreSQL schemas
- three CLIs
- existing personal-intelligence code/reference implementations

Architecture includes:

```text
Global Intelligence
→ Domain
→ Organization
→ User
→ Session
→ Intent
→ Skill Router
→ Context / Superposer
→ Guard
→ Execution
→ Learning
```

Do not describe MPI as merely design-only anymore. Also do not describe the entire MPI vision as production until each runtime path is verified.

---

# 10. AI EXECUTION — MYTHOS AI EXECUTOR

**Status:** IMPLEMENTED / production-oriented runtime  
**Evidence:** VERIFIED

Location: `projects/mythos-ai-executor/`

Responsibilities:

- persistent task queue
- Claude Code headless execution
- provider selection
- skills/tools policy
- quota handling
- retry / resume
- `WAITING_FOR_QUOTA`
- task reports
- checkpoints
- Git integration
- validation
- n8n boundary
- REST/HTTP execution surface reported by independent audit

Canonical registries:

- `config/agents.json`
- `config/router.json`
- `config/skills.json`
- `config/tools.json`
- `config/mcp-capabilities.json`

Do not build another execution engine or provider/tool/skill registry for MCP.

---

# 11. MCP AUTHORIZATION CAPABILITY ALREADY EXISTS

**Status:** IMPLEMENTED  
**Evidence:** VERIFIED by independent audit

The audit identified an existing fail-closed MCP authorization/capability layer:

```text
lib/mcp-capabilities.js
```

The exact repository-relative location must remain tied to the audited implementation when integrating.

Purpose: prevent a future MCP client from inventing a second authorization model.

Canonical rule:

```text
OTH MCP must reuse existing capability authorization.
It must not introduce a parallel permissions system.
```

---

# 12. MYTHOS ORCHESTRATOR — DELEGATION / VERIFICATION

**Status:** IMPLEMENTED  
**Evidence:** VERIFIED

Responsibilities:

- delegation
- worker execution
- provider abstraction
- result collection
- Git integration
- verification
- redaction
- reporting

Key principle:

```text
worker report = claim
Git / authoritative verification = evidence
```

Do not duplicate this verifier in OTH MCP or another orchestration layer.

---

# 13. CHATGPT → CLAUDE LOOP ALREADY EXISTS

**Status:** EXISTING IN MULTIPLE FORMS  
**Evidence:** VERIFIED by independent audit

The independent audit found the intended architect/builder loop already represented twice:

## Path A — Mythos OS `.ai/`

```text
Architect = ChatGPT
Builder   = Claude
```

## Path B — HTTP / automation path

```text
Client
↓
Executor REST API
↓
n8n workflows
↓
MOS Console relay / execution path
↓
Claude / executor
```

The audit reported **7 n8n workflows** participating in the existing automation environment.

Consequence: the future OTH MCP should connect to this capability, not rebuild ChatGPT→Claude orchestration from zero.

---

# 14. OTHMODE REGISTRIES — UNIFIED READ MODEL

`projects/command-center/reference/othmode/registries.js` already aggregates authoritative registries.

Skills:

```text
.claude/skills/
+ executor/config/skills.json
```

Tools:

```text
executor/config/tools.json
+ mcp capabilities
```

Providers:

```text
executor/config/agents.json
+ executor/config/router.json
```

Projects:

```text
projects/meta/
```

Do not create a new MCP registry.

---

# 15. PROJECT INTELLIGENCE

**Status:** IMPLEMENTED tooling

Canonical components include:

- `projects/meta/portfolio-registry.json`
- `projects/meta/project-ledger.json`
- `projects/meta/project-statistics.json`
- `projects/meta/current-context.json`
- `projects/meta/development-lanes.json`
- `projects/meta/known-baselines.json`
- `projects/meta/stage-templates.json`
- `projects/meta/test-impact-map.json`
- `scripts/project-intelligence.js`
- `scripts/mythos-stage.js`

Capabilities include project inventory, stages, dependencies, baselines, test impact, lanes, validation, portfolio state, and current context.

---

# 16. STATUS CENTER

**Status:** EXISTING / execution truth

Status Center remains the live execution/health authority where integrated.

Do not make OTHMODE, OTH Knowledge, or OTH MCP a competing execution-status database.

## Reconciliation engine — this IS the ecosystem's recon layer

**Status:** IMPLEMENTED · **Evidence:** VERIFIED

`projects/status-center/lib/engine.js` already performs full reconciliation, and it owns nothing — it reads. `runReview()` combines verifiable git facts, the curated evidence registry, the PR ledger and document reconciliation, then compares against the previous immutable snapshot:

- `verifyEvidence()` — evidence collection and verification
- `reconcileDocuments()` — verifies each classified document exists and surfaces conflicts
- `discoverRepositories()` — compares the account snapshot against the curated registry; anything present but unclassified becomes `NEW_DISCOVERY`. **Nothing is silently classified.**
- `compareReviews()` — change detection across immutable, append-only snapshots

Vocabularies it owns: `DISCOVERY_CLASS` (ACTIVE · FOUNDATION · OWNER_DIRECTION · FUTURE_CONCEPT · ARCHIVED · UNKNOWN · NEW_DISCOVERY) and a nine-rung `MATURITY` ladder from IDEA to PRODUCTION_VERIFIED.

**Canonical rule: do not build a separate reconnaissance or reconciliation component.** A "MYTHOS RECON" would duplicate this engine. Extend it, or feed it.

## Discovery feeder

**Status:** IMPLEMENTED · `scripts/status-snapshot.js`

`data/repo-snapshot.json` is the input `discoverRepositories()` compares against. Until 2026-08-30 nothing wrote it — the file asked to be refreshed by hand and had gone stale, so `NEW_DISCOVERY` could not fire. `scripts/status-snapshot.js` writes that one file from the authorized `gh` session, in the schema the engine already reads, and does nothing else. It is not a source of truth: the registry remains the curated layer, and a discovered repository still requires human classification.

---

# 17. EVOLUTION SYSTEM

**Status:** IMPLEMENTED inside OTHMODE

Includes:

- Evolution Store
- Signals
- Selector
- Review
- Validation
- Evolution Events
- Genes
- Capsules
- Git rollback records
- append-only evidence

Do not create a second evolution engine.

---

# 18. HANDOFF / CONTINUITY

**Status:** ARCHITECTURE + existing operational discipline

Existing handoff concepts include goal, context version, state summary, decisions, open decisions, next steps, blockers, artifacts, confidence, and budget.

Reuse the existing handoff model rather than inventing an incompatible MCP handoff format.

---

# 19. CONTEXT RECONSTRUCTION

**Status:** ARCHITECTURE / reference design

Designed to reconstruct context from authoritative sources including Entity, Published Memory, Decision Registry, Timeline, Goals, Procedures, Lessons, Relationships, Last Handoff, Preferences, and Tenancy.

It must consume canonical stores rather than create another context database.

---

# 20. AI GATEWAY

**Status:** DESIGNED / partially represented by current executor/provider infrastructure

Architecture includes provider routing, model registry, prompt versioning, cost tracking, sensitivity, fallback, caching, HITL, and permission levels.

Current execution authority remains with existing executor/provider infrastructure until explicit migration.

---

# 21. PROMPT VERSIONING — IMPORTANT LOST IMPLEMENTATION

**Status:** PREVIOUSLY EXECUTED / CODE CURRENTLY NOT RECOVERED  
**Evidence:** VERIFIED by independent audit

The audit found evidence that prompt versioning had actually run, but the implementation was never committed and was no longer present on the inspected disk.

Classification:

```text
Capability existed operationally
Implementation source currently missing
Documentation/index previously understated this history
```

Action class: **INVESTIGATE / RECOVER IF POSSIBLE**, not blindly rebuild.

---

# 22. AI WORKFORCE

**Status:** DESIGNED

Specialized roles include management, research, developer, architect, marketing, finance, legal, knowledge, production, logistics, and reviewer concepts.

Do not claim every worker exists as a production service.

---

# 23. AI CONSTITUTION

**Status:** DESIGNED / policy architecture

Principles include:

- Memory belongs to MYTHOS
- Truth is earned
- HITL
- data sensitivity
- tenancy
- budget controls
- least privilege
- attribution
- separation of duties
- record the reason
- continuity
- defer when uncertain

---

# 24. AI BUDGET MANAGER

**Previous classification:** DESIGNED  
**Updated classification:** IMPLEMENTED COMPONENT / runtime integration verified by independent audit

The independent audit found approximately **1,008 LOC** and live `/budget` endpoints.

Existing capabilities/design cover:

- daily / weekly / monthly budget
- project / worker / role budgets
- rolling windows
- projected spend
- remaining headroom
- cost estimation
- caching / batching
- model right-sizing

This component must no longer be treated as design-only. Exact production ownership and deployment state should still be checked before making it the global canonical budget authority.

---

# 25. MYTHOS PROD — EXISTING BUSINESS RUNTIME

**Status:** MATURE LEGACY / proven domain implementation

Existing business areas include invoices, quotes, contracts, clients, collaborators, mission orders, appointments, representations, accounting, bank, cash, expenses, purchases, suppliers, TVA, reports, contacts, Google Contacts, tasks, reminders, document drafting, registration, calls, documentation, camera, statistics, calendar, and dashboard.

Runtime/platform patterns include plugin architecture, storage, sync, router, API, platform shell, Plugin SDK, search, calendar, widgets, notifications, dialogs, and dashboard.

Mine/reuse this domain implementation before rebuilding equivalent Mythos OS modules.

---

# 26. SECURE ERP BACKEND — UNMERGED BRANCH DISCOVERY

**Status:** HIGH-VALUE FORGOTTEN ASSET / VERIFIED by independent audit

The independent audit discovered a secure ERP backend on an **unmerged branch approximately 28 commits ahead**.

Reported capabilities include:

- authentication
- RBAC
- audit
- tests
- runbook
- rollback procedures

This is a critical reuse candidate.

Rule: **do not rebuild equivalent ERP backend functionality until this branch has been reviewed and classified for merge/reuse/migration.**

---

# 27. MYTHOS PROD SYNC ENGINE

**Status:** PROVEN IMPLEMENTATION

Patterns include merge-by-ID, incremental updates, tombstones, pending writes, crash recovery, backup, and server aggregation.

```text
merge by id
never replace a collection wholesale
```

---

# 28. MYTHOS PROD PLUGIN SDK

**Status:** PROVEN IMPLEMENTATION

Prior art includes menus, routes, storage, widgets, permissions, settings, search, calendar, and dashboard definitions.

Reuse as prior art for Mythos OS modules.

---

# 29. NOTRE JOUR

**Status:** EXISTING modular product architecture  
**Repository:** `othoth77/notrejour`

Reusable patterns include controllers, services, repositories, policies, events, shared contracts, feature flags, modular domains, media, invitations, orders, timeline, notifications, API, and AI modules.

---

# 30. DATA COLLECTION FOUNDATION / SSANGYONG

**Status:** DESIGN + proven implementation patterns

Capabilities/patterns include source registry, project registry, collection engine, raw snapshots, parsing, validation, normalization, provenance, deduplication, change detection, retry, rate limiting, scheduling, and monitoring.

Core rule:

> One engine, many configurations and adapters.

---

# 31. SPY

**Status:** IMPLEMENTED V1

Reusable patterns include SQLite, FastAPI, scheduler, runner, collection engines, observations/events, hashing, idempotency, retry, rate limiting, concurrency protection, crash recovery, and partial-run protection.

---

# 32. ID AUTO

**Status:** ACTIVE external canonical repository  
**Repository:** `othoth77/idauto`

Reusable model:

```text
identity
+ evidence
+ issuer
+ confidence
+ verification
+ immutable event
+ provenance
+ audit
```

Do not duplicate vehicle identity/evidence infrastructure in dependent automotive projects.

---

# 33. AUTOMOTIVE PLATFORM

Tracks or has designed Mythos Automotive, ID Auto, Atelier Network, Fixpert pilot, AutoCheck Standard, Parts Network, SsangYong Parts, AutoValeur, and automotive domain intelligence.

Generic platforms must remain distinct from individual pilots/products.

---

# 34. RESEARCH INTELLIGENCE

**Status:** DESIGNED / foundation

Architecture includes Intent Architect, Skill Router, Research Gateway, official sources, SearXNG, external providers, trust/freshness, citation normalization, cache, and context compilation.

Reuse this design before creating another research engine.

---

# 35. AUTOMATION / N8N / OPERATIONS

**Status:** FOUNDATION + EXISTING ACTIVE WORKFLOWS

Architecture includes provider connectors, read-only safety, snapshots, approval, execution, verification, rollback, audit, and health.

Independent audit additionally found **7 n8n workflows** participating in the current ChatGPT/Claude/executor ecosystem.

n8n is an integration/workflow boundary, not the canonical owner of execution truth.

---

# 36. MYTHOS OS CONSOLE

**Status:** EXISTING console implementation / architecture source

Capabilities include authentication boundary, upstream adapter, module registry, router, rendering, design system, accessibility/contrast validation, visual verification, and deployment preflight.

Its design system influenced OTHMODE.

---

# 37. KNOWLEDGEVAULT / MASTER BLUEPRINT ARCHIVE

**Repository:** `othoth77/knowledgevault-kms`

Contains architecture history for Mythos OS, AI, Daily Operating System, Data Collection, Platform Kernel/Structure, implementation plans, Event Bus, Module Registry, backup/restore, and security.

Treat as design/history, not automatic runtime truth.

---

# 38. DAILY OPERATING SYSTEM DESIGN

Existing behavior design includes morning briefing, open threads, priorities, pending decisions, calendar, capture-once, voice notes, meetings, invoice/contract context, research, photos, daily/weekly/monthly review, decision reasons, and cross-project learning.

---

# 39. DOMAIN PROJECTS

The wider ecosystem includes or has included AgriBee, Oudhna Services, Uthina Chess, Dar Hijama, ClassePro/Prof Manager, Festival, SsangYong Parts, Fixpert, Notre Jour, ID Auto, and other pilots/products.

Extract reusable patterns without promoting every domain product to a platform primitive.

---

# 40. DUPLICATION WATCHLIST

## Memory / context

```text
OTH Master
OTH Knowledge
MPI
Mythos Intelligence designs
```

## Projects

```text
OTH Master projects
projects/meta
OTH Knowledge project docs
Mythos OS project entities
OTHMODE project read model
```

## Execution

```text
Mythos Orchestrator
Mythos AI Executor
OTHMODE task/control
future AI Gateway
```

## Skills

```text
.claude/skills
executor skills registry
OTHMODE unified read model
MPI skill architecture
```

## Providers

```text
executor agents/router
OTHMODE provider read model
future AI Gateway
```

## Files

```text
Mythos OS FileStore
OTH Knowledge artifacts
OTH Master / Vault concepts
```

Resolve boundaries; do not add another store by default.

---

# 41. OTH MCP — BUILT AND RUNNING (was: design)

**Status:** ACTIVE / read-only
**Evidence:** VERIFIED — driven over SSH against production on 2026-08-30

The structural gap this section previously described as "still needed" has been closed. Both components exist, are tested, and are running.

## 41.1 OTH Knowledge read-only HTTP facade

**Location:** `projects/oth-knowledge/service/othk-http.js`
**Runtime:** `oth-knowledge-http.service` (deploy user unit), `127.0.0.1:8150`, **not published by any nginx vhost**
**Status:** ACTIVE · **Evidence:** VERIFIED — 37 records served from `~/othk-store`

The one thing every audit named: OTH Knowledge had a CLI and an in-process JS API, so nothing on the network could read it. It now serves `lib/knowledge-service.js` — which was already the provider-neutral read boundary — over HTTP.

- Every route is GET. `POST/PUT/PATCH/DELETE` are refused **405 before routing**, so a write cannot be added by accident.
- Bearer token, constant-time comparison; `/health` open so a probe needs no credential.
- A missing store is a reported **503**, never an attempt to create one. `openStore()` is lazy and would otherwise answer "0 records" where the truthful answer is "there is no store here" — the same guard OTHMODE's memory bridge applies before opening the same service.

Routes: `/health` `/stats` `/search` `/records/:id` `/records/:id/{provenance,evidence,history,trust}` `/entities` `/contradictions` `/current-state` `/audit`

## 41.2 OTH MCP server

**Location:** `projects/oth-mcp/server.js` · **README:** `projects/oth-mcp/README.md`
**Transport:** JSON-RPC 2.0 over stdio, **dependency-free**
**Status:** ACTIVE / READ-ONLY · **Evidence:** VERIFIED end to end

Seven tools, each naming the system that owns its data:

| Tool | Owner | Verified live |
|---|---|---|
| `knowledge_search` | OTH Knowledge | 3 hits from the real store |
| `knowledge_get` | OTH Knowledge | record + provenance / evidence / history |
| `project_context` | `projects/meta` via OTHMODE | 21 projects |
| `capability_registry` | OTHMODE read model | 31 skills |
| `execution_status` | Mythos AI Executor | 11 tasks |
| `execution_report` | Mythos AI Executor | structured task report |
| `system_health` | Status Center | LIVE 19 / DOWN 1 |

**Transport decision — no new public port.** Every upstream binds loopback, and MCP speaks stdio, so the client runs the server **over SSH**:

```json
{ "mcpServers": { "oth": { "command": "ssh",
    "args": ["deploy@51.68.226.211", "/home/deploy/bin/oth-mcp"] } } }
```

The launcher reads each upstream's own credential from a 0600 file on the host. **The client never holds a MYTHOS token**, and no port was added to the public surface.

**Dependency decision, measured:** `@modelcontextprotocol/sdk` installs **91 packages / 24 MB** (express, hono, cors, jose, OAuth/SSE) to provide, for a stdio server, the same three methods this file implements. Not proportionate in front of personal knowledge, in a repository whose `oth-knowledge` and `mythos-ai-executor` cores carry no dependencies. Revisit if HTTP/SSE transport, OAuth or resource subscriptions are ever needed. Recorded with evidence in the README.

**Write boundary:** version 1 is read-only *by construction* — the only upstream verb in the source is `GET`. Execution, curation and evolution keep their existing gates (executor policy + deny-by-default budget, `othk-cli` curation, OTHMODE owner-only HIGH-risk approval). A write increment must route **through** those gates, never around them.

**Tests:** `tests/othk-5-http-facade-test.js` (44) · `tests/othk-6-mcp-server-test.js` (36, drives the server over stdio as a real client).

## MCP must NOT create

- another memory database
- another project database
- another task engine
- another skills registry
- another provider registry
- another authorization system
- another evolution engine
- another identity system
- another provenance system
- another execution engine

---

# 42. REPORT → KNOWLEDGE BOUNDARY

**Status:** DELIBERATELY GATED

The desired loop is not:

```text
Claude report → blindly write permanent memory
```

Use:

```text
Claude
↓
Report
↓
claim / proposal
↓
curation / verification gate
↓
OTH Knowledge
↓
next context / next task
```

This preserves the existing evidence/trust model and prevents AI output from silently becoming canonical fact.

---

# 43. TARGET CROSS-AI LOOP

The integration target is:

```text
ChatGPT
↓
OTH MCP
↓
OTH Knowledge / OTH Master context
↓
OTHMODE
↓
AI Executor / Orchestrator
↓
Claude
↓
Mythos OS / target project
↓
Report
↓
Curation / Verification
↓
OTH Knowledge
↓
Next Task
```

Most nodes already exist. The work is primarily **integration and boundary consolidation**, not greenfield construction.

---

# 44. INFRASTRUCTURE FINDINGS FROM INDEPENDENT AUDIT

## VPS resource pressure

**Status:** OPERATIONAL RISK / VERIFIED

- swap: **2.0 GB / 2.0 GB consumed (100%)** — unchanged
- root filesystem: **98% used** (was 83%; reached **100%, 0 bytes free** on 2026-08-30)

## 2026-08-30 disk-full incident — cause found and fixed

**Status:** CAUSE FIXED · **residual cleanup needs root** · **Evidence:** VERIFIED

The host reached 100% disk. `/var/log/syslog` alone was **14 GB**, grown in a single day (the previous day's rotated file is 132 MB).

Cause chain, verified end to end:

1. SPY (`spy.service`) kept one SQLite connection per thread and registered every connection it ever handed out, draining the registry only at shutdown.
2. `scheduler._tick()` builds a **fresh `ThreadPoolExecutor` on every tick**, and Starlette runs SPY's 31 sync endpoints on anyio's own worker threads. Those threads end constantly, each leaving a connection open — two file descriptors, the database and its WAL.
3. Measured on the live process: **508 handles to `spy.db` + 508 to `spy.db-wal` = 1,016 of a 1,024 limit.**
4. At the limit, asyncio's `_accept_connection` caught `EMFILE`, logged a full traceback and retried immediately — several times per millisecond.
5. That filled the disk, which then stopped `mythos-status-monitor`, `sysstat-collect`, the root-side backup capture and the GitHub delivery relay.

**Fixed** in `othoth77/spy` (`master` @ `89fd8c8`): `db.py` records the owning thread and reaps connections whose thread has ended; `scheduler.py` closes in a `finally` around each source run, mirroring `discovery.py`. Deployed and verified — the process now holds **12** file descriptors where it held 1,024. `tests/test_db_connections.py` adds 9 assertions; the SPY suite is **386 passed, 0 failed**.

**Still requires root:** `/var/log/syslog` is 14 GB and owned `syslog:adm`. `deploy` cannot truncate it and it is outside the `mythosadmin` sudo allowlist. Safe one-liner for the owner:

```bash
sudo truncate -s 0 /var/log/syslog
```

rsyslog keeps the same inode and continues writing. That reclaims ~14 GB of a 72 GB disk. The leak that produced it is closed, so it will not regrow.

## External attack surface — measured from outside the host

**Status:** HIGH / VERIFIED by external connection test on 2026-08-30

| Port | Reachable from the internet | What it is |
|---|---|---|
| 22, 80, 443 | ✅ open | SSH, nginx — expected |
| **8000** | ✅ open | **Coolify dashboard, direct** — bypasses the `panel.mythosprod.xyz` TLS vhost |
| **6001** | ✅ open | **Soketi (Coolify realtime), answers 200 unauthenticated with `Access-Control-Allow-Origin: *`** |
| **6002** | ✅ open | Coolify websocket/terminal companion |
| **6082** | ✅ open | root noVNC — auth-gated (401), but a **root desktop** on the public internet |
| 631 | filtered | CUPS — listening on `0.0.0.0` but not reachable |

The Coolify stack publishes 8000/6001/6002 on all interfaces from Docker, which is why they do not appear in `nginx/sites-enabled` and why `deploy` cannot see the owning processes. Constraining them is a root/Docker action.

**The new components add nothing here:** the OTH Knowledge facade binds `127.0.0.1:8150` and is referenced by no nginx site, and OTH MCP travels over SSH — **no port was added to the public surface.**

## Local machine risk

Audit snapshot reported the disk holding the real `oth.db` at approximately **92% full**.

These are runtime facts from the audit snapshot, not permanent architectural properties. Recheck before remediation.

---

# 45. FORGOTTEN / UNDER-DOCUMENTED ASSETS

Current high-value discoveries that were absent or understated in the previous index:

| Asset | Audit status | Importance | Reuse action |
|---|---|---:|---|
| Real 29.8 MB `oth.db` | VERIFIED | CRITICAL | Preserve / back up / reconcile |
| MCP capability authorization | VERIFIED | CRITICAL | REUSE |
| Existing ChatGPT→Claude `.ai/` loop | VERIFIED | HIGH | REUSE / CONNECT |
| Executor REST/HTTP path | VERIFIED | HIGH | REUSE / CONNECT |
| 7 n8n workflows | VERIFIED | HIGH | AUDIT / REUSE |
| AI Budget Manager runtime | VERIFIED | HIGH | REUSE / consolidate ownership |
| MPI PostgreSQL schemas + CLIs | VERIFIED | HIGH | RECLASSIFY / REUSE |
| Prompt versioning historical implementation | VERIFIED history | MEDIUM/HIGH | INVESTIGATE / recover |
| Secure ERP backend unmerged branch | VERIFIED | CRITICAL | REVIEW BEFORE REBUILD |

---

# 46. THINGS THAT MUST NOT BE REBUILT WITHOUT REVIEW

```text
OTHMODE control plane
OTH Knowledge engine
OTH Master archive/context system
MCP capability authorization
Project Meta registry
Project Intelligence / stage tooling
Skills registry
Tools registry
Provider registry
AI Executor
Mythos Orchestrator
Task/report history
Evolution system
Trust/provenance/conflict/temporal knowledge
Mythos OS identity/entity/files/module kernel
Mythos Prod business modules
Mythos Prod sync/plugin patterns
SPY monitoring/event patterns
ID Auto evidence/event/trust patterns
existing n8n execution workflows
secure ERP backend branch
AI Budget Manager
```

---

# 47. OPEN VERIFICATION ITEMS

The following must remain explicit until directly reconciled:

1. Exact canonical relationship between local `oth.db`, OTH Master, OTH Knowledge, and the small VPS store.
2. Backup state and recovery plan for the real local `oth.db`.
3. Exact deployment/ownership status of AI Budget Manager.
4. Exact scope and production readiness of MPI schemas/CLIs.
5. Recovery possibility for lost prompt-versioning source.
6. Exact branch/repository/path and merge suitability of the secure ERP backend.
7. Exact inventory and purpose of the 7 n8n workflows.
8. Exact network boundary required for OTH Knowledge and OTH Master.
9. Current VPS disk/swap state after the audit snapshot.
10. Any local-only or VPS-only assets not yet represented in GitHub.

Unverified does not mean nonexistent.

---

# 48. MAINTENANCE CONTRACT

Update this index whenever a major capability is implemented, moved, deprecated, made canonical, replaced, discovered, or connected.

Every major capability should eventually declare:

```text
Capability
Canonical owner
Repository
Exact path
Runtime location
Status
Evidence class
Source of truth
Read interface
Write owner
Execution authority
Approval boundary
Existing implementation reused
Tests / evidence
Backup / recovery owner where relevant
```

Any future ecosystem audit should compare **GitHub + local machine + VPS/runtime + domains/services**, not GitHub alone.

---

# 49. FINAL PRINCIPLE

```text
DO NOT ASK FIRST:
"What should we build?"

ASK:
"What do we actually have today?"

THEN:
Search → Verify → Reuse → Extend → Connect → Build Last
```

The current ecosystem already contains substantial implementations, runtime services, databases, registries, execution engines, knowledge infrastructure, security boundaries, business modules, data collection patterns, AI workflows, and operational tooling.

The primary engineering objective is now **preservation, integration, consolidation, canonical ownership, and reuse** — not uncontrolled parallel rebuilding.

---

# 50. PRE-EXECUTION RECONCILIATION PROTOCOL

**Status:** CANONICAL OPERATING RULE

Before any major implementation, the executor must first determine what already exists and reconcile it against the requested objective.

Required discovery surfaces:

```text
GitHub
Local machine
VPS / runtime
Branches
Commits
Worklogs
MYTHOS_SYSTEM_INDEX
Existing code
Existing APIs
Existing databases
Existing MCP foundation
Existing Skills
Existing security controls
Registries / ledgers
Deployment state
```

Required classification:

```text
EXISTS
IN PROGRESS
IMPLEMENTED BUT NOT DEPLOYED
DUPLICATE
CONFLICT
LEGACY
REUSABLE
MISSING
UNKNOWN
```

Required decision vocabulary:

```text
REUSE
EXTEND
CONSOLIDATE
RECOVER
ADAPT
ARCHIVE
BUILD
```

The default is **not BUILD**. Building is the last option after evidence shows that reuse, extension, consolidation, recovery, or adaptation cannot satisfy the requirement.

This protocol exists specifically to prevent duplicate MCPs, memories, identity systems, executors, task systems, registries, APIs, and other competing sources of truth.

---

# 51. PROGRESSIVE MYTHOS RECON

**Status:** CANONICAL DESIGN DECISION

MYTHOS RECON must not perform a full deep audit on every task. It must use progressive depth to minimize token consumption, latency, and unnecessary access.

```text
Task
 ↓
QUICK RECON
 ↓
Relevant index / latest worklog / current status / recent Git state
 ↓
Is there evidence of overlap, conflict, historical work, security impact,
or an unknown boundary?
 ├── NO  → proceed with the normal execution path
 └── YES → TARGETED RECON
               ↓
          relevant files / branches / commits / APIs / runtime
               ↓
          unresolved architecture or security issue?
           ├── NO  → execute
           └── YES → DEEP RECON
```

## Token-efficiency rules

- Prefer metadata, registries, indexes, Git graphs, hashes, status, and manifests before reading large source bodies.
- Narrow the search surface from the task's affected components before opening unrelated repositories or runtime areas.
- Use LLM reasoning on the evidence set, not on indiscriminately collected raw data.
- Escalate from Quick → Targeted → Deep only when evidence justifies it.
- Cache or reuse verified inventory where safe; detect drift instead of rebuilding the inventory from zero.

MYTHOS RECON is an integration/reconciliation layer. It is not a new source of truth, memory database, identity system, execution engine, or authorization system.

---

# 52. CANONICAL ECOSYSTEM REGISTRY — PLANNED FOUNDATION FOR RECON

**Status:** PLANNED / to be derived from verified existing sources

Before implementing a standalone registry, inspect all existing registries and ledgers and consolidate where possible.

The intended machine-readable index should make these dimensions discoverable without requiring a full repository reread:

```text
PROJECTS
COMPONENTS
SERVICES
APIs
DATABASES
SKILLS
MCP CAPABILITIES
PROVIDERS
REPOSITORIES
BRANCHES
RUNTIME LOCATIONS
OWNERSHIP
SOURCE OF TRUTH
READ INTERFACE
WRITE OWNER
EXECUTION AUTHORITY
SECURITY BOUNDARY
DEPENDENCIES
DEPLOYMENT STATUS
HISTORICAL IMPLEMENTATIONS
LEGACY / REPLACEMENT RELATIONSHIPS
```

The registry must be derived from evidence and must not become a competing source of truth.

The preferred evolution is:

```text
Existing registries / ledgers
        ↓
Canonical reconciled inventory
        ↓
Automated refresh / drift detection
        ↓
MYTHOS RECON
```

Do not create multiple parallel registries merely to support RECON.

---

# 53. RECON + MCP IMPLEMENTATION RULE

MYTHOS RECON must be established before broad OTH MCP expansion when the implementation task requires architectural discovery.

The target relationship is:

```text
ChatGPT / MCP Client
        ↓
OTH MCP
        ↓
Existing governed capabilities
        ↓
MYTHOS RECON when discovery is required
        ↓
Canonical services / OTH Knowledge / OTH Master / OTHMODE / Executor
```

OTH MCP must remain thin and must reuse the existing fail-closed MCP authorization foundation.

MYTHOS RECON must improve visibility and decision quality without acquiring ownership of the systems it inspects.

---

# 54. DOCUMENTATION CONTINUITY RULE

This index is the canonical **current-state memory for architecture and reuse**, not a chronological diary.

Use:

```text
MYTHOS_SYSTEM_INDEX.md
= current verified architecture + ownership + reusable prior art + open boundaries

docs/worklogs/
= chronological execution history for major executions
```

When a new architectural decision supersedes an old one, update this index rather than creating another permanent architecture document unless a separate artifact is genuinely required.

When a major execution occurs, record its execution history in `docs/worklogs/` and update this index only for durable current-state changes.

Never maintain a permanent duplicate report archive on the local PC.

---

# 55. OPERATING RULE — RECON BEFORE BUILD

For every future major task:

```text
REQUEST
  ↓
QUICK RECON
  ↓
IDENTIFY AFFECTED COMPONENTS
  ↓
CHECK CANONICAL OWNER
  ↓
CHECK EXISTING IMPLEMENTATIONS
  ↓
CHECK HISTORICAL / UNMERGED WORK
  ↓
CHECK DUPLICATES / CONFLICTS
  ↓
CHECK SECURITY / AUTHORITY BOUNDARIES
  ↓
DECIDE
  ├── REUSE
  ├── EXTEND
  ├── CONSOLIDATE
  ├── RECOVER
  ├── ADAPT
  ├── ARCHIVE
  └── BUILD LAST
  ↓
IMPLEMENT
  ↓
TEST
  ↓
SECURITY REVIEW
  ↓
UPDATE INDEX
  ↓
GITHUB WORKLOG
```

This rule is part of the canonical MYTHOS operating model and should be preserved across future execution agents and sessions.

---

# 56. SECURITY HARDENING — DEFERRED BY OWNER DECISION

**Status:** CANONICAL OPERATING DECISION · recorded 2026-08-30 · **must survive future executions**

Security hardening is **deliberately deferred** to a dedicated future mission. It is not backlog and not an oversight: the owner decided that the ecosystem's security posture is to be addressed as one comprehensive audit-and-harden operation, not as scattered single-port fixes made opportunistically during unrelated work.

## Standing rules until that mission begins

1. Do not expose a new public service merely for convenience.
2. Do not weaken authentication or authorization.
3. Do not move sensitive personal data to the VPS merely to simplify integration.
4. Do not disable fail-closed security controls.
5. Do not make opportunistic security changes during unrelated work.
6. Record newly discovered security risks here and in the execution worklog — **leave remediation to the dedicated mission**, unless immediate action is required to prevent active damage.

A future execution that "helpfully" fixes one of the items below is violating this decision, not improving the system.

## Known risk register — RISKS, not work items

Recorded so they are not rediscovered as if new. None is scheduled; none is to be remediated outside the dedicated mission.

| # | Risk | Evidence | Class |
|---|---|---|---|
| S-1 | Coolify management surface reachable from the internet on port 8000 over **plain HTTP**, serving a login redirect — management credentials would cross the network unencrypted | external probe → `302` to `/login`, `Server: nginx` | HIGH |
| S-2 | Root desktop reachable on port 6082. Authentication is enforced (`401` over TLS), but the surface is a root desktop | external probe → `401` | HIGH |
| S-3 | Ports 6001 (`200`) and 6002 (`404`) bound to `0.0.0.0` and publicly reachable; owning services **not identified** from the `deploy` channel | `ss -tlnp`, external probe | MEDIUM — needs identification before classification |
| S-4 | n8n has **no verified off-host backup** — no n8n directory exists under the backup root | `ls ~/mythos-backups` | MEDIUM |
| S-5 | Legacy ERP docroot gated at the server while its own config asserts a stale "no DNS record" premise | vhost comments vs live resolution | MEDIUM |
| S-6 | Existing backup-chain failures **must remain fail-closed** — the database chain correctly refuses on an unprovisioned target. Do not create the database, relax the preflight, or fake a green status to silence it | `backup-health-db.json` `last_success_at: ""` | CONTROL TO PRESERVE |

**Verified as correctly closed and to be kept that way:** OTH Knowledge facade (`8150`) and AI Executor (`8130`) are loopback-only and unreachable externally; the MCP capability registry rejects `endpoint`/`url` keys by construction; knowledge writes remain on the operator CLI; `mythosadmin` holds a six-command sudo allowlist; `deploy` is excluded from the docker group.

## Shape of the future mission

```text
FULL SECURITY RECON → THREAT MODEL → EXPOSURE INVENTORY →
AUTHORIZATION REVIEW → NETWORK REVIEW → DATA/SECRET REVIEW →
BACKUP/RECOVERY REVIEW → HARDENING → PENETRATION-STYLE VALIDATION →
REGRESSION TEST → FINAL SECURITY AUDIT → GITHUB EXECUTION REPORT
```

Scope covers the OS, SSH, users and privileges, root access, firewall, exposed ports, Coolify, nginx/TLS, authentication, CORS, public management interfaces, Docker and container isolation, MCP exposure, the OTH Knowledge facade, OTHMODE, Mythos OS, databases, backups, R2/off-host storage, secrets and environment variables, API keys, GitHub repositories/permissions/Actions, dependency and supply-chain risk, log leakage, filesystem permissions, network segmentation, monitoring and alerting, recovery and disaster-recovery procedures, credential rotation, and least-privilege boundaries.

**No new security subsystem is to be created.** The mission consolidates and hardens the controls MYTHOS already has, under the same principle as everything else: SEARCH FIRST → RECONCILE → REUSE → HARDEN EXISTING → BUILD ONLY IF ACTUALLY MISSING.
