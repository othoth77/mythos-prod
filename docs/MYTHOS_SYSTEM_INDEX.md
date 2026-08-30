# MYTHOS SYSTEM INDEX

## Purpose

This document is the canonical **inventory and reuse index** for the systems, engines, architectures, registries, modules, protocols, and proven patterns already created across the MYTHOS ecosystem.

Its purpose is simple:

> **Before building anything new, find what already exists, identify its owner, determine whether it is implemented or only designed, and reuse/extend/connect it before creating a duplicate.**

This is an inventory, not a replacement for the implementation documents or source code.

**Research snapshot:** 2026-08-30
**Primary repository:** `othoth77/mythos-prod`
**Default branch:** `main`

---

# 1. SYSTEM MAP

```text
HUMAN
  │
  ▼
OTHMODE
  │  control / discovery / history / governance / evolution
  │
  ├── OTH Knowledge
  │     evidence / claims / facts / provenance / trust / temporal knowledge
  │
  ├── Project Meta
  │     portfolio / ledger / current context / stages / baselines
  │
  ├── Status Center
  │     execution truth / health / recovery
  │
  ├── AI Executor
  │     persistent autonomous execution / resume / provider routing
  │
  ├── Orchestrator
  │     delegation / verification / worker orchestration
  │
  └── Mythos OS
        kernel / identity / tenancy / entities / relationships / files / modules

Supporting layers:

MPI / Personal Intelligence
  context / skills / guard / intent / learning / domain intelligence

OTH Master
  personal context / archive / conversations / projects / interoperability

Data Intelligence
  collection / monitoring / change detection / events / evidence

Domain systems
  Mythos Prod / Notre Jour / ID Auto / SsangYong / SPY / AgriBee / etc.
```

---

# 2. CANONICAL RULES

## 2.1 One owner per capability

A capability must have one canonical writer/owner. Other systems should consume it through an interface, read model, or adapter.

## 2.2 Read before write

Control surfaces such as OTHMODE should expose existing authoritative stores rather than create parallel stores.

## 2.3 Search First

The repository already contains the `search-first` skill and policy:

`SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST`

Required search order:

1. Current repository
2. Existing MYTHOS components/tools/skills
3. Anthropic Skills
4. MCP ecosystem
5. GitHub / open source
6. PyPI / npm
7. n8n ecosystem
8. Existing APIs/templates

Verdicts:

- Adopt
- Extend
- Compose
- Connect
- Build

`Build` requires evidence that a suitable existing solution does not exist.

Source: `.claude/skills/search-first/SKILL.md`

---

# 3. CONTROL PLANE — OTHMODE

**Status:** ACTIVE / production

**Production:** `othmode.mythosprod.xyz`

OTHMODE is the main operational control surface over existing MYTHOS engines. It was adapted from the existing Command Center rather than rewritten.

## Existing capabilities

- Commands
- Saved Commands
- Skills
- Tools
- Providers
- Projects
- Health
- Status
- Command History
- Memory
- Search First
- Evolution Memory
- Genes
- Capsules
- Evolution Events
- Signals
- Selector
- Review
- Validation
- Git/Rollback
- Security
- Arabic / French / English
- RTL
- Responsive UI

## Important architecture rule

OTHMODE is primarily a **control/read/governance surface**. It must not become a second implementation of the underlying engines.

## Evidence

- `docs/othmode/OTHMODE_100_PERCENT_AUDIT.md`
- `docs/othmode/OTHMODE_FINAL_REPORT.md`
- `projects/command-center/reference/othmode/`

---

# 4. KNOWLEDGE — OTH KNOWLEDGE

**Status:** IMPLEMENTED

**Location:** `projects/oth-knowledge/`

This is the structured knowledge/evidence layer.

## Core model

```text
source
artifact
 document
chunk
entity
fact
claim
observation
event
relationship
evidence
derived
```

## Capabilities

- Content-addressed artifacts
- Append-only storage
- Exact search
- Lexical/BM25 search
- Vector interface
- Hybrid search
- Provenance
- Evidence references
- Trust assessment
- Contradiction detection
- Temporal state
- History lookup
- Versioning
- Conflict handling
- Validation
- Export
- CLI

## Important semantic rule

AI output is not automatically a fact. Imported conversations and generated material retain their source/provenance and can be represented as claims/observations.

## Importers already implemented

- Google Takeout
- Gemini export
- NotebookLM notes
- Google Contacts metadata-only importer

Google Contacts is deliberately fail-closed and metadata-only; contact names, phone numbers, emails and addresses are not persisted by that importer.

## Canonical boundary

OTHMODE already exposes OTH Knowledge through a read-first memory bridge. Do not create a second memory store inside OTHMODE.

## Evidence

- `projects/oth-knowledge/README.md`
- `projects/oth-knowledge/lib/knowledge-service.js`
- `projects/oth-knowledge/lib/importers/`
- `projects/command-center/reference/othmode/memory.js`

---

# 5. PERSONAL CONTEXT — OTH MASTER

**Status:** EXISTING SYSTEM / SEPARATE ROLE

Repository: `othoth77/oth-master`

OTH Master was designed as a provider-agnostic personal context/archive layer.

## Existing concepts

- Conversations
- Memories
- Projects
- Sources
- Sync
- CLI
- Interoperability
- Context export
- Personal archive

## Architectural boundary

OTH Master and OTH Knowledge must not silently become duplicate stores.

Working distinction:

```text
OTH Master
= personal context / archive / conversation continuity

OTH Knowledge
= structured knowledge / evidence / provenance / temporal knowledge

Mythos OS
= platform entities / tenancy / files / modules
```

The exact integration contract remains an architectural consolidation item and must be decided before adding another memory implementation.

---

# 6. MYTHOS OS — PLATFORM KERNEL

**Status:** ACTIVE DEVELOPMENT / implemented foundation

Repository: `othoth77/mythos-os`

## Implemented kernel areas

- Identity
- Tenancy
- Universal Entity Model
- Entity relationships
- Files / attachments
- Module kernel foundation
- Permissions foundation

## UEM

The Entity spine is designed around shared entity identity and concrete entity types.

Examples of future/possible entity types include:

- Person
- Company
- Vehicle
- Project
- Conversation
- Decision
- Other domain entities

Do not create independent identity systems inside domain modules when the entity kernel can own the identity.

## Module Kernel

Existing concepts include:

- ModuleManifest
- ManifestReader
- ManifestRegistry
- ModuleKernel
- ModuleDependencyValidator
- Nwidart module integration

## Files

Existing abstraction includes:

- Attachment
- FileStore
- AttachmentPolicy
- entity ownership
- tenant isolation
- policy enforcement

## Evidence

- `mythos-os` repository
- `projects/mythos-core/`
- `projects/mythos-core/contracts/`

---

# 7. MYTHOS PERSONAL INTELLIGENCE — MPI

**Status:** FOUNDATION / architecture + reference implementation; not equivalent to full production runtime

Location in `mythos-prod`: `projects/personal-intelligence/`

## Designed capabilities

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

Existing/reference concepts include:

- Context assembler
- Scope
- Intent routing
- Skills
- Guards
- Learning
- Domain packs

## Important rule

MPI is a source of architecture and reference implementation. Do not claim an MPI feature is production merely because its design/spec exists.

---

# 8. AI EXECUTION — MYTHOS AI EXECUTOR

**Status:** IMPLEMENTED / production-oriented runtime

Location: `projects/mythos-ai-executor/`

## Responsibilities

- Persistent task queue
- Claude Code headless execution
- Provider selection
- Skill/tool policy
- Quota handling
- Retry
- Resume
- Waiting for quota
- Task reporting
- Checkpoints
- Git integration
- Validation
- n8n boundary

## Critical behavior

Quota is represented as a waiting state rather than automatically turning a recoverable quota condition into a permanent failure.

## Registry sources

- `config/agents.json`
- `config/router.json`
- `config/skills.json`
- `config/tools.json`
- `config/mcp-capabilities.json`

Do not create another provider, skill, or tool registry without an explicit architectural decision.

---

# 9. DELEGATION / VERIFICATION — MYTHOS ORCHESTRATOR

**Status:** IMPLEMENTED / existing runtime

Location: `projects/mythos-orchestrator/`

## Responsibilities

- Delegation
- Worker execution
- Provider abstraction
- Result collection
- Git integration
- Verification
- Redaction
- Reporting

## Key principle

Worker reports are not final truth. Verification re-derives relevant state from authoritative evidence such as Git.

This gives the ecosystem a useful distinction:

```text
worker report = claim
verification = evidence
```

Do not duplicate this verifier inside another orchestration layer.

---

# 10. OTHMODE REGISTRIES — UNIFIED READ MODEL

`projects/command-center/reference/othmode/registries.js` already aggregates the authoritative registries.

## Skills

```text
.claude/skills/
+
projects/mythos-ai-executor/config/skills.json
```

## Tools

```text
projects/mythos-ai-executor/config/tools.json
+
config/mcp-capabilities.json
```

## Providers

```text
projects/mythos-ai-executor/config/agents.json
+
config/router.json
```

## Projects

```text
projects/meta/
```

The purpose is to present one read model without creating a third store.

---

# 11. PROJECT INTELLIGENCE

**Status:** IMPLEMENTED tooling

Existing components include:

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

## Capabilities

- Project inventory
- Current stage
- Stage lifecycle
- Dependencies
- Baselines
- Test impact
- Development lanes
- Ledger validation
- Portfolio status
- Current context

## Important rule

`projects/meta` is the current project-governance registry for the MYTHOS repository. Do not create another project registry merely to support a new interface.

---

# 12. STATUS CENTER

**Status:** EXISTING / execution truth

Status Center is the authoritative source for live execution state and health information where integrated.

OTHMODE reads from it and explicitly treats it as execution truth.

Do not turn OTHMODE, Knowledge, or a future MCP into a competing execution-status database.

---

# 13. EVOLUTION SYSTEM

**Status:** IMPLEMENTED inside OTHMODE

Existing components include:

- Evolution Store
- Signals
- Selector
- Review
- Validation
- Evolution Events
- Genes
- Capsules
- Git rollback records
- Append-only evidence

## Rules

- KEEP-first preference
- Search First evidence influences selection
- HIGH-risk approval is owner-only
- AI cannot approve its own high-risk change
- Validation is gated by review
- Terminal evolution results are immutable
- Rollback is recorded as an event

Do not build a separate evolution engine for another AI interface.

---

# 14. HANDOFF / CONTINUITY

**Status:** ARCHITECTURE + in-repo discipline

Existing handoff concepts include:

- Goal
- Context version
- State summary
- Decisions
- Open decisions
- Next steps
- Blockers
- Artifacts
- Confidence
- Budget

The handoff pattern is intended to allow work to move between AI workers and humans without copying entire memories or conversations.

Existing source of discipline:

- `session-handoff` / AI handover documentation
- Mythos OS Agent Handoff architecture

Do not invent a second incompatible handoff format.

---

# 15. CONTEXT RECONSTRUCTION

**Status:** ARCHITECTURE / reference design

The existing design reconstructs working context from authoritative sources such as:

- Entity
- Published Memory
- Decision Registry
- Timeline
- Goals
- Procedures
- Lessons
- Relationships
- Last Handoff
- Preferences
- Tenancy

This is a design foundation for future Personal Intelligence / AI Gateway work.

It should consume canonical stores rather than create a duplicate context database.

---

# 16. AI GATEWAY

**Status:** DESIGNED / not equivalent to a complete production runtime

Existing architecture covers:

- Provider routing
- Model registry
- Prompt versioning
- Cost tracking
- Sensitivity gate
- Fallback
- Caching
- Human-in-the-loop
- Permission levels

Decision levels include concepts such as:

- Autonomous
- Approval required
- Suggestion only
- Forbidden

The existing AI Gateway design should be treated as the target platform abstraction, while current provider execution remains in the existing executor/provider registry until migration is explicitly implemented.

---

# 17. AI WORKFORCE

**Status:** DESIGNED

Existing architecture defines specialized AI roles such as:

- CEO / management
- Research
- Developer
- Architect
- Marketing
- Finance
- Legal
- Knowledge
- Production
- Logistics
- Reviewer

It also defines worker identity, competencies, performance, quality, cost, speed, rework, success rate, and confidence calibration.

This is architecture, not a claim that every worker exists as a production service.

---

# 18. AI CONSTITUTION

**Status:** DESIGNED / policy architecture

Existing principles include:

- Memory belongs to MYTHOS
- Truth is earned
- Human-in-the-loop
- Data sensitivity
- Tenancy
- Budget controls
- Least privilege
- Attribution
- Separation of duties
- Record the reason
- Continuity
- Defer when uncertain

Enforcement is intended through platform boundaries such as AI Gateway, service accounts, budget management and audit.

---

# 19. AI BUDGET MANAGER

**Status:** DESIGNED

Existing architecture covers:

- Daily budget
- Weekly budget
- Monthly budget
- Project budget
- Worker/role budget
- Rolling windows
- Projected spend
- Remaining headroom
- Cost estimation
- Caching
- Batching
- Model right-sizing

Do not confuse this design with an already-deployed budget runtime.

---

# 20. MYTHOS PROD — EXISTING BUSINESS RUNTIME

**Status:** EXISTING / mature legacy production system

The legacy Mythos Prod runtime contains proven business modules and infrastructure patterns.

## Existing business areas include

- Invoices
- Quotes / Devis
- Contracts
- Clients
- Collaborators
- Mission orders
- Appointments
- Representations
- Accounting
- Bank
- Cash
- Expenses
- Purchases
- Suppliers
- TVA
- Reports
- Contacts
- Google Contacts
- Tasks
- Reminders
- Document drafting
- Inscription
- Call management
- Documentation
- Camera
- Statistics
- Calendar
- Dashboard

## Runtime/platform patterns

- Plugin architecture
- Storage
- Sync
- Router
- API
- Platform shell
- Plugin SDK
- Search
- Calendar
- Widgets
- Notifications
- Dialogs
- Dashboard

This is a source of **proven domain implementation** and must be mined/reused before rebuilding equivalent business functionality in Mythos OS.

---

# 21. MYTHOS PROD — SYNC ENGINE

**Status:** PROVEN IMPLEMENTATION

Existing sync patterns include:

- Merge by ID
- Incremental updates
- Tombstones
- Pending writes
- Crash recovery
- Backup
- Server aggregation

Important rule:

```text
merge by id
never replace a collection wholesale
```

This is reusable architecture for future local-first modules.

---

# 22. MYTHOS PROD — PLUGIN SDK

**Status:** PROVEN IMPLEMENTATION

Existing SDK concepts include:

- Menu definitions
- Routes
- Storage
- Widgets
- Permissions
- Settings
- Search
- Calendar
- Dashboard

It provides prior art for the Mythos OS module system.

---

# 23. NOTRE JOUR

Repository: `othoth77/notrejour`

**Status:** EXISTING modular product architecture

Existing module concepts include:

- AI
- Admin
- API
- Guestbook
- Invitations
- Landing
- Media
- Notifications
- Orders
- RSVP
- Singles
- Templates
- Timeline

Architecture patterns include:

- Controllers
- Services
- Repositories
- Eloquent
- Policies
- Events
- Shared contracts
- Feature flags

This repository is a source of reusable modular-product architecture and domain patterns.

---

# 24. DATA COLLECTION FOUNDATION

## SsangYong collection

**Status:** DESIGN + proven implementation patterns

Existing concepts include:

- Source registry
- Project registry
- Collection engine
- Raw snapshots
- Parsing
- Validation
- Normalization
- Provenance
- Deduplication
- Change detection
- Retry
- Rate limiting
- Scheduling
- Monitoring

Core principle:

> One engine, many configurations and adapters.

Do not build a separate scraper framework for every source.

---

# 25. SPY — COMPETITOR / SOURCE INTELLIGENCE

**Status:** IMPLEMENTED V1

Existing flow:

```text
Competitors
→ Sources
→ Monitoring
→ Collection
→ Change detection
→ Events
→ Today
→ Insights
```

Existing proven patterns include:

- SQLite
- FastAPI
- Scheduler
- Runner
- Collection engines
- Observation/event model
- Hashing
- Idempotency
- Retry
- Rate limiting
- Concurrency protection
- Crash recovery
- Partial-run protection

This is reusable prior art for monitoring and data intelligence.

---

# 26. ID AUTO

Repository: `othoth77/idauto`

**Status:** ACTIVE external canonical repository

Existing concepts include:

- Vehicle identity
- Digital vehicle passport
- Evidence
- Trust ladder
- Issuer
- Verification
- Audit
- Content-addressed media
- Community ingestion
- Rate limiting
- Review queues
- Backup/restore
- Immutable events
- Provenance
- Confidence
- Supersession

The ID Auto identity contract is consumed by Mythos Core through pinned protocol artifacts.

Reusable patterns:

```text
identity
+ evidence
+ issuer
+ confidence
+ verification
+ event
+ audit
```

These patterns are broader than automotive and should be reused where appropriate.

---

# 27. AUTOMOTIVE PLATFORM

Existing architecture tracks:

- Mythos Automotive umbrella
- ID Auto
- Atelier Network
- Fixpert pilot
- AutoCheck Standard
- Parts Network
- SsangYong Parts
- AutoValeur
- Automotive Workshop domain pack

Important distinction:

- Generic platforms are not the same as individual pilots.
- A domain concept is not automatically a deployed product.
- External repositories must remain canonical where the registry says so.

---

# 28. AUTO VALEUR

**Status:** FOUNDATION

Existing stages include the foundation and the planned public calculator MVP.

Dependency: ID Auto.

Do not duplicate vehicle identity/evidence infrastructure here.

---

# 29. ATELIER NETWORK

**Status:** FOUNDATION / architecture

Generic multi-workshop platform.

Fixpert is documented as a pilot designation, not the platform itself.

Dependency includes ID Auto.

---

# 30. RESEARCH INTELLIGENCE

**Status:** DESIGNED / foundation, not full production runtime

Existing architecture includes:

```text
Intent Architect
→ Skill Router
→ Research Web
→ Research Gateway
→ Official Sources
→ SearXNG
→ external search providers
→ Trust / Freshness
→ Citation Normalizer
→ Cache
→ Context Compiler
```

The design should be reused when implementing research capabilities instead of starting another research engine.

---

# 31. AUTOMATION & OPERATIONS

**Status:** FOUNDATION / partial implementation

Existing architecture includes:

- Provider connectors
- Read-only safety
- Snapshots
- Approval
- Execution
- Verification
- Rollback
- Audit
- Health

Existing connector foundation includes Cloudflare and OVH patterns.

n8n remains an integration/workflow boundary, not the owner of MYTHOS execution truth.

---

# 32. MYTHOS OS CONSOLE

Repository area: `projects/mythos-os-console/`

**Status:** EXISTING console implementation / architecture source

Existing capabilities include:

- Authentication boundary
- Upstream adapter
- Module registry
- Router
- Render functions
- Design system
- Accessibility/contrast validation
- Visual verification
- Deployment preflight

The console design system was reused by OTHMODE rather than creating an unrelated visual system.

---

# 33. KNOWLEDGEVAULT / MASTER BLUEPRINT ARCHIVE

Repository: `othoth77/knowledgevault-kms`

This repository contains important architecture history and master designs for:

- Mythos OS
- AI architecture
- Daily Operating System
- Data Collection Foundation
- Platform Kernel
- Platform Structure
- Implementation Master Plan
- Event Bus
- Module Registry
- Backup/restore
- Security

It is a **design/history source**, not automatically the current runtime truth.

When conflicts exist, prefer current code, current registries, current tests, and the latest audits.

---

# 34. DAILY OPERATING SYSTEM DESIGN

Existing design principles include:

- Morning briefing
- Open threads
- Priorities
- Pending decisions
- Calendar
- Capture once
- Voice notes
- Meetings
- Invoice/contract context
- Research
- Photos
- Daily review
- Weekly review
- Monthly review
- Decision reasons
- Cross-project learning

This describes desired operating behavior and should inform future product integration.

---

# 35. DOMAIN / BUSINESS PROJECTS OUTSIDE THE CORE

The wider ecosystem also contains or has contained projects such as:

- AgriBee / النحلة الفلاحة
- Oudhna Services
- Uthina Chess
- Dar Hijama
- ClassePro / Prof Manager
- Festival
- SsangYong Parts
- Fixpert
- Notre Jour
- ID Auto

These should be treated as domain products or pilots, not automatically promoted to platform primitives.

When a reusable capability is discovered inside one of them, extract the pattern rather than duplicating the whole product.

---

# 36. CURRENT STATUS LEGEND

Use these labels when extending this index:

| Status | Meaning |
|---|---|
| ACTIVE | Running/operational implementation |
| IMPLEMENTED | Code exists and is usable/tested, but may not be the primary production surface |
| FOUNDATION | Partial implementation / platform foundation |
| DESIGNED | Architecture/spec exists; runtime is not complete |
| CONCEPT | Idea/specification only |
| EXTERNAL | Canonical implementation lives in another repository |
| LEGACY | Existing implementation retained as a reuse source |
| UNKNOWN | Not sufficiently verified |

Never upgrade `DESIGNED`, `CONCEPT`, or `UNKNOWN` to `ACTIVE` without direct evidence.

---

# 37. DUPLICATION WATCHLIST

These are the areas where duplicate systems are most likely to appear.

## Memory

```text
OTH Master
OTH Knowledge
MPI
Mythos Intelligence
```

Resolve boundaries before adding another memory database.

## Projects

```text
OTH Master projects
projects/meta
OTH Knowledge project documentation
Mythos OS project entities
OTHMODE project read model
```

Use the correct layer; do not create another registry.

## Execution

```text
Mythos Orchestrator
Mythos AI Executor
OTHMODE task/control layer
future Mythos AI Gateway
```

Keep delegation, execution, control and provider abstraction separate.

## Skills

```text
.claude/skills
executor/config/skills.json
OTHMODE unified read model
MPI skill architecture
```

Do not create another authoritative skills store.

## Providers

```text
executor agents.json
executor router.json
OTHMODE providers read model
future AI Gateway
```

Do not create a third provider registry.

## Files

```text
Mythos OS FileStore
OTH Knowledge artifacts
OTH Master / Vault concepts
```

Separate binary ownership from knowledge artifacts and personal archive semantics.

---

# 38. MCP DESIGN RULE

Any future OTH MCP should be a **thin integration layer**, not a new platform.

Expected pattern:

```text
AI Client
  ↓
OTH MCP
  ↓
canonical existing service/registry
```

Potential read operations include:

- project context
- project status
- project registry
- search memory
- memory/provenance
- history
- skills
- tools
- providers
- capabilities
- task status
- handoff

Potential write operations must route to the existing owner of that capability and respect the existing security/approval model.

The MCP must not create:

- another memory database
- another project database
- another task engine
- another skills registry
- another provider registry
- another evolution engine
- another identity system
- another provenance system

---

# 39. SOURCE-OF-TRUTH PRIORITY

When documents disagree, use this order:

```text
1. Current runtime behavior
2. Current source code
3. Current production verification
4. Current tests
5. Current registries / ledgers
6. Latest audit / handover
7. Current architecture documents
8. Older documentation
9. Historical conversation/design notes
```

Historical designs remain valuable for reuse, but they do not override current implementation evidence.

---

# 40. VERIFICATION GAPS

Some historical/referenced files could not be retrieved directly during the 2026-08-30 index research. They must not be treated as verified current content until checked from a complete clone or corrected repository path.

Examples encountered:

- older README variants
- some architecture review files
- some repository paths referenced by other documents

The existence of a reference is recorded here, but its current implementation status must remain unverified until directly checked.

---

# 41. MAINTENANCE RULE

This index should be updated whenever a new major capability is:

- implemented
- moved
- deprecated
- made canonical
- replaced
- connected to another system

Every new project or major module should declare:

```text
Capability
Owner
Repository
Exact path
Status
Source of truth
Read interface
Write owner
Existing implementation reused
Why new code is necessary (if any)
Tests/evidence
```

---

# 42. FINAL PRINCIPLE

```text
DO NOT ASK:
"What should we build?"

ASK FIRST:
"What do we already have that solves this?"

THEN:
Adopt → Extend → Compose → Connect → Build
```

The MYTHOS ecosystem already contains substantial implementations, reference architectures, domain modules, registries, execution engines, knowledge infrastructure, security boundaries, data collection patterns, and operational tooling.

The primary engineering objective is therefore **integration, consolidation and reuse**, not uncontrolled parallel rebuilding.
