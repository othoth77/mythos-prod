# MYTHOS SYSTEM INDEX

## Purpose

This document is the canonical **inventory and reuse index** for systems, engines, runtimes, architectures, registries, modules, protocols, infrastructure, and proven patterns already created across the MYTHOS / OTH ecosystem.

> **Before building anything new: discover what already exists, identify its canonical owner, verify its real status, and reuse / extend / connect it before creating a duplicate.**

This index is not itself runtime truth. It records verified findings and clearly marks findings that still require direct verification.

**Initial research snapshot:** 2026-08-30  
**Independent ecosystem audit incorporated:** 2026-08-30  
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

## Network gap discovered by independent audit — CLOSED 2026-08-30

**Status:** VERIFIED — gap closed, facade deployed and running

OTH Knowledge had internal APIs/services but no network facade suitable as the shared boundary for MCP clients. That gap is closed.

```text
projects/oth-knowledge/service/othk-http.js      the facade (read-only)
oth-knowledge-http.service                       systemd USER unit, user `deploy`
127.0.0.1:8150                                   loopback only — no public exposure
/home/deploy/othk-store                          the store it serves
```

Verified on the host 2026-08-30: `/health` reports `store_available: true` and `read_only: true`; an unauthenticated read answers **401**; `POST` answers **405** before routing, so a write path cannot be added by accident; a missing store is a **503**, never an invented empty answer. The facade serves `lib/knowledge-service.js` only — the provider-neutral read boundary — so ingestion and curation stay on `othk-cli`.

It has no access to `oth.db`, which is not on this host.

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
**Location reported:** `Desktop\oth-master\data\oth.db`

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

## Reconciliation 2026-08-30 — the two layers face opposite directions

**Status:** VERIFIED by reading both implementations

The rule above was written before `projects/oth-mcp/server.js` existed, and reads as though one layer should call the other. It should not. They govern different directions of traffic:

| | `projects/mythos-ai-executor/lib/mcp-capabilities.js` | `projects/oth-mcp/server.js` |
|---|---|---|
| Direction | **outbound** — MYTHOS as MCP *client* | **inbound** — MYTHOS as MCP *server* |
| Governs | which `server.tool` names a skill running under an execution profile may name | which of its own 7 read tools an external client may call |
| Holds | no network code, no client, no credentials — its own header says so | one `GET`, per-upstream token, no other verb |
| Registry today | `config/mcp-capabilities.json`: one server (`github`), `enabled: false`, no credential on the host | a closed `TOOLS` array; `tools/call` on an unlisted name returns `No such tool` |

Wiring `mcp-capabilities.js` into the server would not add a boundary — it decides nothing about inbound tools — and would couple a governed config-time registry to a process that must stay thin. **The separation is intentional; no wiring was performed.** `mcp-capabilities.js` remains the already-governed list for the future outbound client, exactly as its header states.

Both fail closed, independently and for their own direction:

- inbound — an unknown tool name is rejected, and version 1 exposes **no** write tool; verified against the running server with the official MCP Inspector, and by raw JSON-RPC that bypasses the client's own tool check.
- outbound — an invalid registry disables capability resolution entirely, and any `endpoint`/`url` key at any depth is rejected by its presence.

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

# 41. MCP DESIGN — UPDATED AFTER INDEPENDENT AUDIT

The future OTH MCP must be a **thin integration layer**, not a new platform.

Target:

```text
ChatGPT / Claude / other MCP client
              ↓
           OTH MCP
              ↓
 existing canonical services / registries
```

The independent audit materially reduces the required MCP scope:

- execution already has HTTP/REST paths
- ChatGPT→Claude patterns already exist
- n8n workflows already exist
- MCP capability authorization already exists
- OTHMODE registries already exist
- OTH Knowledge internal API already exists

## Smallest structural gap

A network-facing facade/adapter is still needed for knowledge/context systems that do not expose the required shared network boundary.

Likely pattern:

```text
OTH MCP
  ↓
existing MCP capability authorization
  ↓
thin HTTP/service adapter
  ↓
OTH Knowledge existing API/service
```

OTH Master may require a separate thin adapter according to its final canonical role.

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

**Status:** OPERATIONAL RISK / VERIFIED by audit

Audit snapshot reported:

- swap: **2.0 GB / 2.0 GB consumed (100%)**
- root filesystem: approximately **83% used**

This is an operational risk to production services and was not represented in the original system index.

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
6. Exact branch/repository/path and merge suitability of the 28-commit secure ERP backend.
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
