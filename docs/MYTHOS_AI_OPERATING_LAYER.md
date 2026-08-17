# Mythos AI Operating Layer — Master Specification

**Stage:** MAOL-0 (Phase 0 — specification only)
**Date:** 2026-08-17
**Status of this document:** Authoritative specification for the Mythos AI
Operating Layer. **No runtime behaviour is changed by this stage.**
**Baseline verified against:** commit `315ddde` on `main` (local HEAD at the
time of writing; the checkout is shared with a concurrently active session, so
later commits may exist by the time this is read).

---

## 0. How to read this document

### 0.1 What this document is

This is the **umbrella specification** for the Mythos AI Operating Layer
(**MAOL**) — the intelligence layer that lives *inside* Mythos OS and serves
its products and users. It records, in one place, every agreed component so no
architectural decision is lost between sessions, tools, providers, or agents.

### 0.2 What this document is NOT

It is **not** a replacement for any existing canonical document. Every
component below is either:

- **composed from** an already-canonical Mythos document (which remains the
  authority on its own subject), or
- **newly specified here** because no canonical document covered it.

Where this document and a canonical document appear to disagree, **the
canonical document wins** and this document is the one that must be corrected.
Section §A (traceability) names the owning document for every component.

**No previously ratified decision is overridden by this document.** §B lists
the standing agreements that this specification explicitly preserves, including
several that constrain what MAOL is allowed to do.

### 0.3 Naming — and one naming hazard, resolved

The canonical name of this layer is **Mythos AI Operating Layer**. It was
previously referred to informally as the *Mythos AI Orchestration Layer*; that
earlier name is retired to avoid the collision described next.

**The hazard:** `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` already exists
and describes the **Mythos AI Orchestrator** — a *different* artefact with a
confusingly similar name. The two are related but must never be merged:

| | Mythos AI Orchestrator (existing) | Mythos AI Operating Layer (this document) |
|---|---|---|
| Serves | Mythos **builders** — the owner, Claude, Codex, future agents | Mythos **products and their end users** |
| Purpose | Executes development missions against this repository and its infrastructure | Provides intelligence to customers inside Mythos OS products |
| Authority model | Execution authority over the repository and host | Product-scoped capabilities, tenant-isolated, Guard-gated |
| Canonical doc | `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` + `docs/MYTHOS_ORCHESTRATION_CORE.md` | this document |

**Relationship:** the Operating Layer *reuses the Orchestrator as one of its
execution substrates* — the mission/task/DAG/policy/validation machinery
already built in `projects/mythos-ai-executor/core/` — rather than building a
second one. The Orchestrator is not renamed, not deprecated, and not absorbed.

### 0.4 Status vocabulary

This document reuses, unchanged, the status vocabulary ratified in
`docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` §0:

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | Exists in this repository, validated, committed. Verified against the repository, not against conversation memory. |
| **DESIGNED** | A committed design/specification document exists; little or no implementation. |
| **PLANNED** | Agreed direction with a roadmap phase; no code exists. |
| **CONCEPTUAL / FUTURE** | An agreed idea without a committed design; recorded so it is not lost. |

**Rule: a planned capability must never be described as implemented.** Every
`IMPLEMENTED` claim below was checked against the repository at the baseline
commit. Everything else describes intent.

### 0.5 Documents this specification composes

| Document | Owns |
|---|---|
| `AGENTS.md` | Permanent repository rules; §24 skills boundary; §25 multi-agent orchestration |
| `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` | Layer hierarchy, profiles, precedence, Guard decision model |
| `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` | Strategic direction: "shared capabilities, isolated intelligence" |
| `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` | Context Assembler / Compiler, `ContextPackage` |
| `docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` | Memory model, lifecycle, provenance, vector-search deferral, owner decisions D1–D5 |
| `docs/MYTHOS_USER_MEMORY_POLICY.md` | Learning pipeline, scope promotion, memory controls |
| `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` | Request pipeline, response architecture, personal skill router |
| `docs/MYTHOS_AI_MULTI_TENANCY.md` | Tenant isolation — mandatory, permanent |
| `docs/MODEL_ROUTING_ARCHITECTURE.md` | Capability classes, provider adapters |
| `docs/MYTHOS_DOMAIN_PACKS.md` | Domain packs and capability contracts |
| `docs/SKILLS_ARCHITECTURE.md` / `SKILLS_SUPERPOSER.md` / `SKILLS_SECURITY.md` | Shared-skill composition, Superposer, skill security boundary |
| `docs/AUTOMATION_ARCHITECTURE.md` | Automation levels 1–4, run lifecycle, execution fields, connector model |
| `docs/AUTOMATION_APPROVAL_MATRIX.md` | Permanent `LEVEL_3` boundaries |
| `docs/AUTOMATION_GOVERNANCE.md` | Governance and amendment process |
| `docs/AUTOMATION_SECURITY_AND_SECRETS.md` | Secret handling |
| `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` | Builder-side orchestrator vision |
| `docs/MYTHOS_ORCHESTRATION_CORE.md` | Implemented Phase 2 orchestration core |
| `docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md` | Implemented Phase 1 executor + n8n chain |
| `docs/MYTHOS_BUDGET_LEDGER.md` | Cumulative spend ledger and scopes |
| `docs/MYTHOS_IDENTITY_ARCHITECTURE.md` | Identity, organisations, roles |
| `docs/AUTOMOTIVE_DATA_GOVERNANCE.md` | One-writer-per-noun, no cross-schema FK |

---

## 1. Vision

### 1.1 Statement

**Mythos AI is not only a chatbot.** A chatbot is one presentation surface. The
Operating Layer is the intelligence *substrate* beneath every Mythos product:
it is consulted by user conversations, by background workflows, by scheduled
jobs, by document pipelines, and by the products' own code.

**It is an intelligence operating layer inside Mythos OS.** In the same way an
operating system provides processes, memory, permissions, and devices to
applications, MAOL provides *context, memory, reasoning, capabilities,
approval, and audit* to Mythos products.

**It understands the ecosystem, not isolated requests.** Its scope of
understanding is:

```text
ECOSYSTEM   — Mythos OS, its products, and how they relate
PROJECTS    — what is being built or operated, its state and history
USERS       — who is asking, how they work, what they are permitted to do
DATA        — the records the products own, referenced not duplicated
WORKFLOWS   — how work actually flows in this organisation
DECISIONS   — what was decided, by whom, when, and why
```

**It evolves through structured improvement loops** (§15) — feedback, metrics,
better workflows, updated knowledge — under governance, never through
unreviewed self-modification.

### 1.2 Founding principle, inherited

> **"Shared capabilities, isolated intelligence."**
> — `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md`

One shared platform, never a copied chatbot or forked skill per customer,
personalised through layered context and isolated by tenant at the data layer.

### 1.3 What "evolve and improve its capabilities" means here

The first production version is deliberately **capable but not autonomous**. It
improves along four controlled axes:

1. **Learning** — bounded by the observation → candidate → established →
   explicit-rule pipeline, default scope `user`, never auto-promoted.
2. **Feedback** — captured as an explicit signal, evaluated, never applied
   silently to global behaviour.
3. **Memory** — grows in durable, provenance-tracked, supersedable records.
4. **Modular expansion** — new agents, skills, connectors, and domain packs
   are *added*, not grown; every addition is a reviewed repository change.

**A single user's behaviour must never silently modify global Mythos
behaviour** (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §2). This is
the sentence that separates "evolves" from "drifts".

### 1.4 Status

**DESIGNED.** Substantial parts of the substrate are IMPLEMENTED (see §A);
MAOL as a product-facing composed layer does not exist as a deployed runtime.

---

## 2. Core Architecture

```text
                    ┌─────────────────────────────────────────┐
   Mythos OS  ──────►            CONTEXT ENGINE (§8)          │
   products         │  who · org · project · permissions ·    │
   & users          │  history · objective                    │
                    └───────────────────┬─────────────────────┘
                                        ▼
                    ┌─────────────────────────────────────────┐
                    │              AI BRAIN (§3)              │
                    │  understand · reason · decide-support   │
                    └───────────────────┬─────────────────────┘
                                        ▼
        ┌───────────────┬───────────────┴──────────┬────────────────┐
        ▼               ▼                          ▼                ▼
   MEMORY (§4)    AGENTS (§5,§6)            SKILLS (§7)     KNOWLEDGE (§9,§10)
        │               │                          │                │
        └───────────────┴──────────┬───────────────┴────────────────┘
                                   ▼
                    ┌─────────────────────────────────────────┐
                    │           AI GATEWAY (§2.1)             │
                    │  capability → provider → model          │
                    └───────────────────┬─────────────────────┘
                                        ▼
                    ┌─────────────────────────────────────────┐
                    │   HUMAN APPROVAL (§12) · AUDIT (§13)    │
                    └───────────────────┬─────────────────────┘
                                        ▼
                 n8n ORCHESTRATION (§2.2) · CONNECTORS (§16)
                                        ▼
                              EXTERNAL SYSTEMS
```

Nothing reaches an external system without passing the approval and audit
band. That ordering is structural, not conventional.

### 2.1 AI Gateway

#### Purpose

A single provider-independent entry point for every model call made anywhere in
Mythos. No product code, skill, or agent ever addresses a vendor SDK directly.

#### Provider independence

**Provider independence is an architectural commitment, not a preference.**
Inherited verbatim from `docs/MODEL_ROUTING_ARCHITECTURE.md` §1:

> No user, organisation, or domain intelligence is ever stored only in a
> provider-specific prompt file.

The compiled `ContextPackage` (§8) and the application-level profiles remain
the source of truth. **Switching or adding a provider must never require
rewriting personal or organisation intelligence.**

#### Supported provider families

| Family | Role | Status |
|---|---|---|
| Anthropic (Claude) | Reasoning, coding, long-context document work | IMPLEMENTED as builder-side execution authority; product-side PLANNED |
| OpenAI (GPT) | Reasoning, structured extraction, vision | IMPLEMENTED advisory via OmniRoute; product-side PLANNED |
| Google (Gemini) | Long context, vision, multimodal | Registered **UNCONFIGURED** — reachable only as an OmniRoute-served model; no direct credential exists and none is invented |
| DeepSeek | Cost-efficient reasoning and coding | IMPLEMENTED advisory via OmniRoute |
| Local / self-hosted models | Privacy-constrained and offline-capable work | PLANNED |
| Any OpenAI-compatible gateway | Aggregation (OmniRoute, OpenRouter) | IMPLEMENTED (OmniRoute advisory; OpenRouter verified once in MPI-4) |

#### Model selection based on task

Routing is by **generic capability class**, never by vendor name in caller
code (`docs/MODEL_ROUTING_ARCHITECTURE.md` §2):

```text
FAST · REASONING · CODING · DOCUMENT · VISION · RESEARCH · STRUCTURED_EXTRACTION
```

MAOL adds three classes required by the product surface, and no others:

```text
CONVERSATION            — user-facing dialogue turns
CLASSIFICATION          — routing, labelling, triage
EMBEDDING               — vector representation (see §4.6 — deferred, gated)
```

#### Selection contract

```text
resolveModel(capabilityClass, constraints) → { provider, model, adapterConfig }
```

`constraints` carries, at minimum:

| Constraint | Effect |
|---|---|
| `dataClassification` | `CONFIDENTIAL` or stricter may forbid external providers entirely (§2.1 privacy rule) |
| `organisationId` | Organisation AI configuration may pin, allow, or forbid providers |
| `maxCostUnits` | Interacts with the budget ledger (`docs/MYTHOS_BUDGET_LEDGER.md`) |
| `maxLatencyMs` | Excludes slower tiers for interactive turns |
| `requiresExecutionAuthority` | **Hard filter.** An advisory provider can never be promoted to execution authority by selection |
| `residency` | Jurisdiction constraint where an organisation requires it |

#### Cost / performance / privacy optimisation

Three optimisation axes, applied in this order — **privacy is never traded for
cost or speed**:

1. **Privacy / classification** — eliminates ineligible providers. Not a
   ranking input; an eligibility filter.
2. **Capability adequacy** — among eligible providers, those that can actually
   do the task well (informed by reputation, §6.4).
3. **Cost and latency** — ranks what survives.

#### No vendor lock-in — the concrete tests

The architecture satisfies lock-in freedom only if all four hold:

1. Removing any single provider degrades quality or cost, never correctness.
2. No memory, profile, or knowledge record is stored in a provider-specific
   format.
3. Adding a provider is a configuration + adapter change, never a change to
   callers.
4. No prompt is the only place a business rule exists.

#### Health, quota, and fallback

Inherited from the implemented core (`docs/MYTHOS_ORCHESTRATION_CORE.md` §8):

- **Quota exhaustion is never generic failure.** It is a first-class state.
- Execution-authority work **waits** rather than silently switching authority.
- Advisory work may fall back to a **same-authority** alternate, evented as
  `PROVIDER_FALLBACK` with explicit from/to.
- Exhausted fallbacks degrade to waiting; resume returns to the primary.

#### Status

**DESIGNED**, with an IMPLEMENTED builder-side subset (`provider-router.js`,
`config/router.json`, `reputation.js`). No product-facing gateway service is
deployed.

### 2.2 n8n Integration Layer

#### Definition — and the boundary that matters most

**n8n is the orchestration engine. n8n is not the core brain.**

The rule is already enforced in implemented code and is restated here as
permanent (`docs/MYTHOS_ORCHESTRATION_CORE.md` §10):

> **n8n never becomes the orchestration state store.**

Mythos owns state, decisions, policy, memory, and audit. n8n moves work between
systems. If n8n disappears, Mythos loses automation reach — it must never lose
knowledge of what happened or what is in flight.

#### Responsibilities (n8n owns these)

| Responsibility | Detail |
|---|---|
| Workflow automation | Multi-step business processes across systems |
| Webhooks | Authenticated inbound entry points from Mythos and third parties |
| External integrations | Talking to SaaS APIs where a node already exists |
| Scheduled jobs | Cron-shaped recurring work |
| Event processing | Fan-out, filtering, routing of the event stream (§2.3) |
| AI workflow execution | Invoking MAOL capabilities as steps in a larger flow |

#### Responsibilities n8n never holds

- Authoritative state of a mission, task, approval, or memory record.
- Permission decisions (Guard, §12/§17).
- Policy levels or approval outcomes.
- Secret values — credentials are referenced by id, never embedded.
- The audit record of record (§13).

#### Implemented today

`docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md` records five MYTHOS-namespace
workflows active in n8n 2.29.9 (Task Intake, Execute Task, Quota Watch, Report,
Failure Handler), with credential-by-reference, whitelisted field forwarding,
and refusal of any payload carrying a secret shape. That is the builder-side
chain; the product-side event workflows of §2.3 do not exist yet.

**Note:** importing a workflow into n8n deactivates it — reactivation is an
explicit step, never assumed.

#### Status

**IMPLEMENTED** (builder chain) / **PLANNED** (product event workflows).

### 2.3 Event-Driven Architecture

#### The flow

```text
Mythos OS emits event
        ↓
   Event Bus (typed, durable)
        ↓
   n8n processes  ── filters, fans out, enriches, calls external systems
        ↓
   AI analyses    ── Context Engine → Brain → Skills/Agents
        ↓
   Result returns to Mythos  ── as a record, a recommendation,
                                an approval request, or an audit entry
```

The last arrow is the important one: **AI output re-enters Mythos as data
subject to the same ownership and permission rules as any other write.** It
never becomes a side-channel around the products' own write paths.

#### Business event catalogue (product-emitted)

| Event | Emitted when | Typical AI response |
|---|---|---|
| `CustomerCreated` | A customer record is created | Enrich, deduplicate, classify segment, prepare welcome sequence *(draft only)* |
| `InvoiceCreated` | An invoice is issued | Check against the order/estimate, summarise, flag anomalies |
| `DocumentUploaded` | A file enters the Knowledge Vault | OCR, classify, extract, link to entities (§10) |
| `ProjectUpdated` | A project's state changes | Update project memory, recompute risk/timeline signals |
| `PaymentReceived` | A payment is recorded | Reconcile against invoices, flag mismatch, update client state |
| `ProductionStarted` | A production run begins | Verify inputs, prepare monitoring, project completion |

The catalogue is **extensible and versioned**; adding an event is a reviewed
change, and no event type is inferred from a payload shape.

#### Runtime event catalogue (layer-emitted)

Already enumerated for the builder side (`docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md`
§14, `docs/MYTHOS_ORCHESTRATION_CORE.md` §10) and reused unchanged:

```text
TASK_CREATED   TASK_STARTED   TASK_COMPLETED   TASK_FAILED
QUOTA_EXHAUSTED   PROVIDER_UNAVAILABLE   PROVIDER_FALLBACK
APPROVAL_REQUESTED   APPROVAL_GRANTED   APPROVAL_DENIED
DECISION_MADE   MEMORY_WRITTEN   VALIDATION_REJECTED
```

#### Event envelope

Every event carries at least:

```text
event_id · event_type · event_version · occurred_at
organization_id · environment_id · actor_ref · actor_type
subject_type · subject_ref            (the entity it is about — a reference)
correlation_id · causation_id          (threads a chain of consequences)
idempotency_key                        (redelivery must not duplicate effects)
payload                                (references and classifications, not raw PII)
```

Rules, inherited from `docs/AUTOMATION_ARCHITECTURE.md` §4:

- **No PII inside identifiers.** `actor_ref` is opaque — never a name, email,
  or phone number.
- **No secret values anywhere in an event record.**
- **Redelivery must not duplicate side effects** — enforced by
  `idempotency_key`.
- Events are **append-only**; there is no update or delete path.
- A consumer that throws is recorded and isolated — never allowed to break the
  stream (implemented precedent: `events.js`).

#### Ordering honesty

Global ordering is **not** guaranteed. Per-subject causal ordering is achieved
via `causation_id` chains, and consumers must be idempotent. Any design that
silently assumes total ordering is wrong.

#### Status

**DESIGNED** (product events) / **IMPLEMENTED** (runtime event stream on the
builder side, JSONL durable, `replay(since)` recovery).

---

## 3. AI Brain

The Brain is the reasoning core. It is deliberately **small in authority and
large in understanding**: it interprets and proposes; it never decides what it
is permitted to do.

### 3.1 Context understanding

Consumes the `ContextPackage` produced by the Context Engine (§8) and nothing
else. **The Brain has no ambient access to the database, the filesystem, or a
tenant's records** — if a fact was not admitted into the package, the Brain
does not have it, and must say so rather than invent it.

Inherited rule (`docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §6):

> It must not infer unknown facts with false confidence.

Where required context cannot be resolved, the correct behaviour is to **ask or
degrade gracefully — never to fabricate a plausible-sounding fact.**

### 3.2 Reasoning layer

Five concerns kept separate, never merged into one undifferentiated "the model
does it all" step (`docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §3):

```text
UNDERSTANDING        — intent normalisation, entity resolution
PLANNING             — capability routing, superposition, plan construction
EXECUTION            — Guard-gated capability/tool invocation
RESPONSE GENERATION  — formatting, language, tone, detail level
LEARNING             — feedback signal capture
```

Reasoning depth is a routing decision: a `FAST` classification turn and a
`REASONING` financial analysis are different capability classes with different
cost and latency profiles (§2.1).

### 3.3 Decision support

MAOL produces **decision support, not decisions with consequences**. A
recommendation carries:

| Field | Meaning |
|---|---|
| `recommendation` | What the layer suggests |
| `rationale` | Why, in terms a human can check |
| `evidence` | References to the records/documents relied on |
| `confidence` | `LOW` · `MEDIUM` · `HIGH` · `EXPLICIT` — the existing vocabulary |
| `alternatives` | What else was considered and why it ranked lower |
| `unknowns` | What could not be resolved — stated, not hidden |
| `requiredApprovalLevel` | The automation level the action would need (§12) |

A recommendation whose `unknowns` are material must say so prominently. **A
confident-sounding answer built on missing context is the single most damaging
failure mode of this layer**, and the repository's own history motivates
naming it: several stage records document defects found only when a later pass
actively tried to break an earlier confident claim.

### 3.4 Knowledge interpretation

Turning stored knowledge (§9) into answers: retrieval, grounding, citation,
reconciliation of conflicting sources, and explicit statement of gaps. Every
substantive claim carries provenance back to a Vault item or product record.
**Ungrounded assertions are a defect, not a style choice.**

### 3.5 System awareness

The Brain knows *about itself and its environment*:

- Which capabilities exist, which are enabled for this organisation, and which
  are currently unavailable.
- Which providers are healthy and which are quota-exhausted.
- What its own permissions are in this context.
- What it did recently for this user/organisation, and what the outcome was.

Awareness is bounded: **system awareness never becomes system authority.** A
Brain that knows an action is possible still cannot perform it without Guard
and, where required, human approval.

### 3.6 Status

**DESIGNED.** The reasoning pipeline exists in draft (`MPI-4` runtime, offline
composition, one verified live free-provider request); no product Brain service
is deployed.

---

## 4. Memory System

### 4.1 Four tiers

| Tier | Holds | Lifetime | Carrier |
|---|---|---|---|
| **Short Term** | Current conversation, current task, this-turn instructions | Session | `SessionContext` |
| **Long Term** | User preferences, decisions, history, projects | Durable, supersedable | `pi_memory_records`, `pi_learned_preferences` |
| **Project** | Documents, timeline, previous actions | Project lifetime | Project memory categories + `pi_memory_events` |
| **Organizational** | Company knowledge, procedures, rules | Organisation lifetime | `OrganisationProfile` + org-scoped memory + Knowledge Vault (§9) |

### 4.2 Short Term Memory

Carries the working state of one conversation — **never an infinite
transcript** (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §9):

```text
SessionContext {
  sessionId · userId · organisationId · activeDomain
  currentIntent · currentEntities
  temporaryContext        // this-turn-only instructions
  recentActions · pendingApprovals · selectedSkillPlan
}
```

**A session-scoped instruction does not become a persistent preference by
itself.** "Just this once, answer in French" is `temporaryContext`, not a
learned rule.

### 4.3 Long Term Memory

Durable knowledge about the user and their work: preferences, decisions,
history, and projects. Governed by the learning pipeline:

```text
INTERACTION → OBSERVATION → CLASSIFICATION → CANDIDATE PATTERN
  → CONFIDENCE → CONFLICT CHECK → PERSIST / DISCARD → AUDIT
```

Confidence states:

```text
single observation          → SESSION_OBSERVATION (temporary)
repeated pattern            → CANDIDATE_PREFERENCE
repeated consistent pattern → ESTABLISHED_PREFERENCE
explicit user instruction   → EXPLICIT_USER_RULE (strongest)
```

**Default learned scope is `user`.** Promotion to `organisation`, `domain`, or
`global` requires explicit governance and is never automatic.

### 4.4 Project Memory

Documents, timeline, previous actions — plus the builder-side category model
already implemented (`memory.js`, 12 categories: identity, architecture,
decision, constraint, roadmap, known_issue, completed_work, dependency,
integration, lesson, execution_history, agent_outcome).

Two rules inherited from the implemented core:

- **Secrets are REFUSED, not silently redacted.** A credential never reaches
  deduplication, let alone storage.
- **Corrections supersede rather than erase.** Provenance is immutable;
  correcting a memory creates a new memory with a supersession link.

**PROJECT MEMORY ≠ CURRENT RUNTIME STATE.** Memory is durable knowledge that
outlives execution; runtime state (queues, sessions, retries) is operational.
Runtime state is never authoritative about what a project *is*; memory is never
consulted to decide whether a process is running.

### 4.5 Organizational Memory

Company knowledge, procedures, and rules — the organisation's way of working:
terminology overrides, workflows, service catalogue, document preferences,
communication rules, automation ceilings.

**Organisational memory is silent on any single user's preferences**, and a
user's preference never edits it. The two live in different layers precisely so
personalisation cannot leak into policy.

### 4.6 Vector database, semantic search, embeddings

**Target architecture:** a vector index over Vault content and memory records,
enabling semantic retrieval that lexical scoring cannot reach, with embeddings
produced through the AI Gateway's `EMBEDDING` capability class.

**Standing decision, preserved and NOT overridden by this document:**

> `pgvector` is **not** required for MPI-2 v1 and should **not** be installed
> in that stage.
> — `docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §13, *"Vector search —
> DEFERRED, decided"*

The reasoning stands: the retrieval contract is a *ranking interface*, so a
semantic implementation can replace lexical ranking **without changing any
caller's contract**; relational filtering plus native full-text search is
sufficient and **deterministic**, and determinism is a testable property that
embedding similarity is not.

**Therefore, in MAOL:**

- The `EMBEDDING` capability class and the vector-backed retrieval strategy are
  **specified** so the interface stays ready.
- They are **not activated**. Activation is a separately authorised stage with
  its own gate, triggered when relevance quality demonstrably limits retrieval
  on real data volumes.
- The schema must continue to avoid anything that would make adding a vector
  column later a migration problem.

**Status: PLANNED, explicitly gated.** Anyone reading §4.6 as authorisation to
install `pgvector` is reading it wrong.

### 4.7 Retrieval contract

Provider-neutral, unchanged from `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §3:

```text
retrieveRelevantMemory({ userId, organisationId, domainId, task, limit })
  → ranked, permission-filtered memory items
```

Ranking strategy is swappable (lexical today, semantic later). The contract is
not.

### 4.8 Memory lifecycle

```text
capture → normalize → classify → entity resolution → permission/privacy gate
  → deduplication → conflict detection → persistence
  → retrieval → reinforcement → supersession → deletion/tombstone
```

Binding ordering rules:

1. **The permission/privacy gate precedes relevance.** A `FORBIDDEN` item is
   never classified, ranked, or persisted.
2. **The sensitive-data gate precedes persistence.**
3. **Capture never writes directly** — a single observation is at most a
   `SESSION_OBSERVATION`.
4. **Deletion is a tombstone, never a silent row removal.**
5. **Reinforcement is not a duplicate write** — it increments evidence on the
   existing row.

### 4.9 Status

**IMPLEMENTED** for the builder-side project memory and the MPI-2 persistent
personal memory (`mythos_intelligence` schema, applied under owner
authorisation; content in object storage per ratified decision D3).
**PLANNED** for the product-facing organisational tier and vector retrieval.

---

## 5. Multi-Agent Architecture

### 5.1 What an agent is here

An agent is a **registered, permissioned role** — not a model, and not a
prompt. Models are selected for an agent's task by the Gateway (§2.1); the
agent survives a model change.

### 5.2 Agent definition contract

Every agent carries all six attributes. An agent missing any of them is not
registrable.

```text
Agent {
  identity      { agentId, name, role, description, version, owner }
  permissions   { capabilityGrants, dataScopes, automationCeiling,
                  executionAuthority: boolean }
  tools         [ toolId… ]        // least-privilege grant, never the registry
  memory        { readScopes, writeScopes, retentionPolicy }
  objectives    { purpose, successCriteria, boundaries, escalationRules }
  auditHistory  { invocations, outcomes, approvals, rejections, evaluations }
}
```

Two hard rules:

- **`executionAuthority` is never granted by selection.** An advisory agent
  cannot be promoted into an executing one by a router, a prompt, a
  configuration value, or a plan. Changing it is a reviewed code/policy change.
- **`automationCeiling` can only be lowered by context, never raised.** An
  organisation may cap an agent below its registered ceiling; nothing can lift
  it above.

### 5.3 The specialised agents

| Agent | Purpose | Typical capability classes | Automation ceiling (default) |
|---|---|---|---|
| **Mythos Assistant Agent** | General cross-product assistant; the default conversational surface; routes to specialists | `CONVERSATION`, `FAST`, `REASONING` | `LEVEL_2_RECOMMEND` |
| **Finance Agent** | Invoices, payments, reconciliation, budgets, financial summaries | `DOCUMENT`, `STRUCTURED_EXTRACTION`, `REASONING` | `LEVEL_2_RECOMMEND` — **every financial mutation is `LEVEL_3`, permanently** |
| **Production Agent** | Production runs, scheduling, capacity, materials, progress | `REASONING`, `STRUCTURED_EXTRACTION` | `LEVEL_2_RECOMMEND` |
| **CRM Agent** | Customers, contacts, pipeline, follow-ups, client history | `CONVERSATION`, `CLASSIFICATION` | `LEVEL_2_RECOMMEND` — outbound communication is `LEVEL_3` |
| **Marketing Agent** | Content, campaigns, segments, creative drafts, performance reads | `CONVERSATION`, `VISION`, `RESEARCH` | `LEVEL_2_RECOMMEND` — publication and spend are `LEVEL_3` |
| **Knowledge Agent** | Vault search, summarisation, procedure lookup, grounded answers | `RESEARCH`, `DOCUMENT`, `FAST` | `LEVEL_1_READ_ONLY` |
| **Research Agent** | External research, comparison, source trust, citation | `RESEARCH`, `REASONING` | `LEVEL_1_READ_ONLY` — governed by `docs/RESEARCH_SOURCE_TRUST_AND_CITATIONS.md` |
| **Administration Agent** | Users, roles, settings, org configuration, operational hygiene | `CLASSIFICATION`, `REASONING` | `LEVEL_2_RECOMMEND` — **privilege and Super Admin changes are permanent `LEVEL_3`** |

**No agent in this table ships with `executionAuthority: true`.** The first
production version proposes; humans dispose. Raising any ceiling is a separate,
owner-ratified decision per agent, per organisation.

### 5.4 Agent collaboration

Agents collaborate through the mission/task model, never by calling each other
ad hoc:

- A coordinating agent produces a plan; the plan is validated before dispatch.
- Independent work may run in parallel; dependent work waits on the DAG.
- **Validation is performed by an agent other than the author** — the
  adversarial reviewer pattern already implemented in `validation.js`.
- **Two agents never share a writable working surface.** For repository work
  this is an isolated git worktree; for product data it is the products' own
  write paths with resource locks.

### 5.5 Status

**DESIGNED.** The registry, capability-driven selection, probed availability,
and the authority hard-filter are **IMPLEMENTED builder-side**
(`agent-registry.js`). None of the eight product agents above exists as a
deployed runtime.

---

## 6. Agent Governance

Governance is what makes more agents safe rather than more dangerous.

### 6.1 Create agent

An agent is created by a reviewed change, never by a runtime call from a user
or a model. Creation requires: identity, purpose, capability grants, tool
grants, memory scopes, automation ceiling, escalation rules, and an owner.

**A model may propose an agent definition; it may never register one.**

### 6.2 Enable / disable agent

- Agents are **disabled by default** on creation.
- Enablement is per organisation, recorded, and reversible.
- **Disable is immediate and unconditional** — an in-flight invocation is
  cancelled or completed without side effects; a disabled agent cannot be
  re-enabled by any automated path.
- A "kill switch" that disables *all* agents for a tenant must exist and must
  be operable by a human without a model in the loop.

### 6.3 Monitor agent

Tracked continuously: invocation count, latency, cost, error rate, approval
request rate, approval rejection rate, validation rejection rate, tool-denial
rate, escalation rate, and unusual-pattern signals.

Two signals are treated as incidents, not metrics:

- **A rising tool-denial rate** — an agent repeatedly attempting what it is not
  permitted to do.
- **A rising validation-rejection rate** — output quality degrading, possibly
  from a provider or prompt change.

### 6.4 Evaluate performance

Per task category, using recorded outcomes:

```text
correctness · completeness · groundedness (citations resolve)
approval acceptance rate · rework rate · cost per accepted result
latency · human-reported satisfaction
```

Rules inherited from the implemented reputation model:

- Reputation is a **tiebreak only**, requiring at least 5 recorded outcomes.
- **Unknown rates are `null`, never invented.** A metric with no data says so.
- Reputation influences ranking; it **never** influences permissions.

### 6.5 Control permissions

Permission changes follow the automation-level discipline:

- Grants are least-privilege and explicit; there is no "all tools" grant.
- Widening a grant is an audited change referencing an approval policy.
- **An agent may never modify its own permissions**, propose a widening that
  auto-applies, or grant permissions to another agent.
- Organisation admins may narrow, never widen beyond the registered ceiling.

### 6.6 Prevent unauthorised actions

Defence in depth — an action must clear **all** layers:

```text
1. Capability enabled for this organisation?        → else DENY
2. Agent registered, enabled, and permitted?        → else DENY
3. Guard decision on user/role/resource?            → ALLOW | DENY |
                                                       REQUIRE_APPROVAL |
                                                       READ_ONLY | DRY_RUN_ONLY
4. Tool granted for this task, schema valid?        → else DENY
5. Automation level permitted for this action?      → else escalate to §12
6. Budget available (§2.1, budget ledger)?          → else DENY or escalate
7. Audit record written before the effect (§13)?    → else refuse
```

**Fail closed at every layer.** A composition referencing an unavailable
capability is evaluated as `DENY`, never silently skipped.

### 6.7 Status

**DESIGNED**, with implemented precedents: the policy engine's hard-floored
classes (`ROOT` and `DESTRUCTIVE` deny — *no configuration value can loosen
them*), probed availability, and the frozen engine that exposes no mutation
API.

---

## 7. AI Skills Library

### 7.1 Purpose

**Agents use skills instead of duplicated logic.** A skill is a reusable,
versioned, contract-defined capability that any permitted agent can invoke.
Without this, every agent re-implements invoice reading slightly differently
and every bug must be fixed eight times.

### 7.2 The boundary that must never be conflated

Restating `AGENTS.md` §24 and `docs/SKILLS_ARCHITECTURE.md` §1 because it is
the single easiest thing to get wrong:

| | Agent Development Skills | Runtime Mythos Capabilities |
|---|---|---|
| Location | `.claude/skills/<name>/SKILL.md` | Application-level contracts and services |
| Used by | Claude/Codex **while building Mythos** | **End users** inside Mythos products |
| Reachable from an end-user request | **Never** | Yes, Guard-gated |

**Every entry under `.claude/skills/` is an Agent Development Skill, without
exception.** The AI Skills Library specified in this section is the *runtime*
kind. A runtime capability is never implemented as a `.claude/skills/` entry
expecting a Claude Code session to execute it for an end user.

### 7.3 Skill contract

```text
Skill {
  skillId            // namespace.action, e.g. document.summarize
  version            // semantic, per docs/SKILLS_VERSIONING_POLICY.md
  capability         // the capability contract it implements
  inputSchema · outputSchema
  requiredContext    // what the Context Engine must supply
  permissions        // required grants
  policyClass        // READ | PROJECT_WRITE | EXTERNAL_API | MONEY_SPEND | …
  automationLevel    // the level its execution requires
  riskLevel · cost · latency · availability
  provider           // capability class, not a vendor
  observability      // what it emits for audit
}
```

### 7.4 Foundation skills

| Skill | Purpose | Policy class | Notes |
|---|---|---|---|
| `invoice.read` | Read an invoice: supplier, lines, totals, tax, dates | `READ` | Extraction only. **Never a financial mutation.** |
| `contract.analyze` | Analyse a contract: parties, obligations, dates, risks | `READ` | Output is advisory; **contractual acceptance is a permanent `LEVEL_3` boundary** |
| `document.summarize` | Summarise a document at a requested depth | `READ` | Must cite sections it relied on |
| `information.extract` | Extract structured fields against a schema | `READ` | Unmapped fields are reported, never guessed |
| `report.generate` | Generate a report from permitted data | `READ` | Every figure traceable to a source record |
| `knowledge.search` | Search the Knowledge Vault (§9) | `READ` | Permission-filtered before ranking |
| `data.compare` | Compare two datasets/records and explain differences | `READ` | States what it could not compare |
| `workflow.create` | Draft an n8n workflow from a described process (§11) | `PROJECT_WRITE` | **Draft only — never self-activates** |

Every foundation skill is `READ` except `workflow.create`. That is deliberate:
**the first production version reads, analyses, and drafts.**

### 7.5 Shared skills, layered configuration — never copies

Inherited verbatim from `docs/SKILLS_ARCHITECTURE.md` §2–§3. **Never**
physically copy a skill per user or per organisation. Compose:

```text
SHARED SKILL
  + ORGANISATION CONFIGURATION
  + USER PROFILE
  + RELEVANT MEMORY
  + PERMISSIONS
  + SESSION
```

Override order, by **configuration only, never source duplication**:

```text
GLOBAL DEFAULT → DOMAIN DEFAULT → ORGANISATION OVERRIDE
  → USER PREFERENCE → CURRENT TASK OVERRIDE
```

An improvement to a shared skill is immediately available to every tenant,
because there are no copies to propagate to.

### 7.6 Composition and gating

Skill **composition** is the Superposer's responsibility; whether a composed
plan may execute is **Guard's**. Neither is folded into the skill definition: a
skill declares what it does and requires; it does not decide whether it is
allowed to run right now.

### 7.7 Status

**DESIGNED.** Domain capability contracts exist (`docs/MYTHOS_DOMAIN_PACKS.md`);
no runtime skill registry is deployed. The builder-side tool registry
(`tool-registry.js`, schema-validated, least-privilege, sandbox-only mocks) is
IMPLEMENTED and is the structural precedent.

---

## 8. Context Engine

**The most critical component.** Everything the Brain believes comes from here.

### 8.1 The six questions, answered before every AI action

| Question | Resolved from | Failure mode if skipped |
|---|---|---|
| **Who is requesting?** | Authenticated identity | Impersonation; wrong personalisation |
| **Which organisation?** | Organisation scope | **Cross-tenant leakage** |
| **Which project?** | Project/entity scope | Wrong data, wrong history |
| **Current permissions?** | Role + Guard | Unauthorised action |
| **Previous history?** | Memory retrieval (§4) | Amnesia; repeated questions; contradictions |
| **Objective?** | Normalised intent | Confident answers to the wrong question |

**An AI action that cannot answer all six does not proceed.** There is no
"assume the usual" path.

### 8.2 Classification, before assembly

```text
REQUIRED    — the request cannot be handled correctly without this
USEFUL      — improves quality/personalisation but is not blocking
IRRELEVANT  — not related to the current task; excluded
FORBIDDEN   — excluded regardless of relevance, by permission or privacy rule
```

**`FORBIDDEN` items are never assembled, regardless of how `REQUIRED` they
might otherwise appear.** Permission filtering happens *before* relevance
ranking is allowed to matter. This ordering is deliberate and permanent:
**relevance never overrides a permission boundary.**

### 8.3 Assembly

```text
global rules
  + domain context
  + organisation context
  + role/permissions
  + relevant user preferences
  + relevant memory
  + current conversation/task
```

Admission is bounded by a hard budget (character/token). **The engine never
dumps a project, a repository, or a user's history into a prompt** — for five
first-class reasons: token cost, privacy, latency, response quality, and
avoidance of conflicting context. An assembler that includes everything "just
in case" fails all five.

### 8.4 Context Package

The provider-neutral output — the source of truth a provider adapter renders:

```text
ContextPackage {
  intent · requiredFacts · relevantPreferences
  organisationRules · domainInstructions · permissions
  selectedSkills · entities · outputRequirements
}
```

Each admitted item is tagged with **relevance, source, timestamp, and
confidence**, so the Brain can weigh it and the audit trail can explain it.

### 8.5 Entity resolution

Entities are **referenced, not embedded**:

```text
EntityReference { type · id · source · organisationScope · permissionScope }
```

Resolution is **lazy and scoped** — never a bulk pre-load. **An identifier
guessed, inferred, or hallucinated by a model must never grant access on its
own**; every reference is re-validated against actual scope and permission at
resolution time, not trusted because it appeared in a request.

### 8.6 Status

**IMPLEMENTED** (MPI-1 context runtime and the builder-side `context.js` with
relevance/source/timestamp/confidence tagging under a hard budget) /
**PLANNED** for the full product-facing knowledge-source breadth.

---

## 9. Knowledge Vault

### 9.1 Contents

Documents · contracts · reports · media · procedures · company knowledge.

### 9.2 Capabilities

| Capability | Definition |
|---|---|
| **Intelligent search** | Permission-filtered retrieval combining lexical, structured, and (when §4.6 is activated) semantic ranking |
| **Classification** | Type, sensitivity, owning entity, retention class, language |
| **Retrieval** | Returns the item *and* its provenance, so an answer can cite it |
| **Summarisation** | Depth-configurable, section-cited, never a silent paraphrase of unread content |

### 9.3 Vault item contract

```text
VaultItem {
  itemId · organisationId · ownerRef
  type · title · language
  contentReference          // pointer — content is NEVER embedded in the DB row
  classification            // PUBLIC | INTERNAL | CONFIDENTIAL | RESTRICTED
  retentionClass · legalHold
  entityLinks [ EntityReference… ]
  provenance { provider, sourceType, sourceReference, capturedAt, observedAt }
  versions [ … ]            // immutable; corrections supersede
  permissions               // inherited from owning entity + explicit grants
}
```

### 9.4 Storage topology — a ratified decision, preserved

Per ratified owner decision **D3** (`docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md`
§12.1): **content lives in object storage; PostgreSQL stores
`content_reference` only, never embedded content.** The backup topology is
therefore the database and the object store as a **consistent pair**.

Per ratified decision **D5**, MPI content/backup storage uses its **own**
Cloudflare R2 bucket — `mythos-offhost-backups` is exclusively for `idauto`,
`coolify`, and `darhijama_prod` and is **not reused**. Implementation of that
bucket remains pending, separately authorised work.

### 9.5 Ownership boundary

**The Vault does not become the owner of records another product owns.**
Following `docs/AUTOMOTIVE_DATA_GOVERNANCE.md`: one writer per noun, no
cross-schema foreign keys. Workshop invoices, vehicle identity, marketplace
listings, and product transactions stay with their owning products; the Vault
holds documents and `EntityReference` pointers to them.

### 9.6 Third-party personal data — a ratified constraint, preserved

Per ratified decisions **D1** and **D2**: third-party contacts stay **out of
`mythos_intelligence` entirely**; no third-party names, emails, or phone
numbers are imported or stored there, and MPI does **not** become the owner of
personal entities. The Vault must not be used as a route around this. Documents
naturally contain personal data — they are stored as *classified content with
retention and access rules*, never mined into a person directory.

### 9.7 Status

**PLANNED.** The content-addressed store (MPI D3) and the classification and
provenance models exist; no product-facing Vault service is deployed.

---

## 10. Document Intelligence

### 10.1 Supported inputs

| Format | Handling |
|---|---|
| **PDF** | Native text extraction; OCR fallback for scanned pages |
| **Images** | OCR + vision capability class for layout and content |
| **Audio** | Transcription, then the text pipeline; speaker/segment metadata retained |
| **Text** | Direct, with encoding and language detection |
| **Emails** | Headers, body, thread position, and attachments processed as children |
| **External documents** | Via connectors (§16), permission- and consent-checked at fetch time |

### 10.2 Pipeline

```text
INGEST → detect type, language, encoding
   ↓
CLASSIFY (sensitivity) → sensitive-data gate BEFORE any external model call
   ↓
OCR / TRANSCRIBE (only if needed)
   ↓
EXTRACT → structured fields against a schema
   ↓
CLASSIFY (business) → type, owning entity, retention class
   ↓
LINK → EntityReferences to product-owned records
   ↓
INDEX → Vault (§9), permission-scoped
   ↓
EVENT → DocumentUploaded / DocumentProcessed
```

**The sensitivity classification precedes any external model call.** A document
classified `RESTRICTED` is never sent to an external provider; it is processed
by a local model or not at all. This is the concrete reason local model support
(§2.1) is in the architecture rather than an afterthought.

### 10.3 Functions

- **OCR** — text from images and scans, with per-region confidence.
- **Extraction** — schema-driven fields. **Unmapped or low-confidence fields
  are reported as unknown, never guessed into a plausible value.**
- **Classification** — document type, business category, sensitivity,
  retention.
- **Linking to entities** — resolving a document to the client, vehicle,
  project, invoice, or order it concerns, subject to permission.

### 10.4 Confidence and human review

Every extracted field carries a confidence. Fields below the configured
threshold are **surfaced for human confirmation, not silently accepted**. A
document that would drive a financial or contractual action always routes
through §12 regardless of confidence.

### 10.5 Status

**PLANNED.** `document.prepare` and related capability contracts are defined in
the domain packs; no document intelligence runtime is deployed.

---

## 11. AI Workflow Builder

*Future capability. Specified now so it is built safely when it is built.*

### 11.1 What it does

| Function | Detail |
|---|---|
| **Detect repetitive tasks** | Observe recurring action sequences in the audit trail and event stream |
| **Suggest automation** | Propose a candidate automation with expected benefit and risk |
| **Generate workflows** | Produce a concrete n8n workflow definition as a **draft** |
| **Improve existing workflows** | Propose changes based on failure rates, latency, cost, and outcomes |

### 11.2 Worked example

> *"Every new invoice should be checked and summarised."*

```text
DETECT   users repeatedly run invoice.read + document.summarize
         after each InvoiceCreated event
SUGGEST  "Automate: on InvoiceCreated → invoice.read → document.summarize
          → notify. Estimated 40 runs/month. Policy class: READ.
          No mutation. Proposed level: LEVEL_2_RECOMMEND."
GENERATE draft n8n workflow, inactive, with declared level and connectors
REVIEW   human reviews the draft
APPROVE  explicit activation by an authorised human
MONITOR  success rate, latency, cost, user acceptance → §15
```

Note what the example does **not** do: it never proposes paying the invoice.
Checking and summarising are `READ`; payment is a permanent `LEVEL_3` boundary.

### 11.3 Hard rules

1. **A generated workflow never self-activates.** It is created inactive and
   requires explicit human activation.
2. **A generated workflow passes the same `GATE_CHECK` as a hand-written one.**
   Being AI-generated grants no exemption — and no workflow may claim an
   automation level inconsistent with the approval matrix.
3. **The builder may not grant itself or the workflow new connectors,
   credentials, or permissions.** It composes from what already exists and is
   already enabled.
4. **A workflow that would perform a permanent-`LEVEL_3` action can be drafted
   but never auto-approved**, no matter how routine it appears.
5. **Improvement proposals are proposals.** Modifying a live workflow follows
   the same review path as creating one.

### 11.4 Status

**CONCEPTUAL / FUTURE** (Phase 4). Recorded so the safety rules exist before
the capability does.

---

## 12. Human Approval Layer

**Mandatory safety layer.** This is the section that makes everything else
acceptable to run in a real business.

### 12.1 The chain

```text
AI Analysis
    ↓
Recommendation        (with rationale, evidence, confidence, unknowns)
    ↓
Human Approval        (explicit, authorised, non-inferred, recorded)
    ↓
Execution             (audited before and after; rollback path known)
```

**Approval is never inferred.** Silence is not approval. A previous approval of
a similar action is not approval. A user's general enthusiasm is not approval.

### 12.2 Required for

| Category | Examples |
|---|---|
| **Financial operations** | Sending or transferring money, issuing refunds, committing an invoice or estimate, any spend |
| **Deletion** | Deleting records, documents, backups; disabling backups |
| **Sensitive changes** | Permissions, roles, Super Admin access, security settings, production configuration, destructive migrations |
| **External communication** | Sending email, messages, or campaigns on the organisation's behalf; publishing content; contractual acceptance |

### 12.3 Mapping to the permanent automation levels

Inherited unchanged from `docs/AUTOMATION_ARCHITECTURE.md` §2:

```text
LEVEL_1_READ_ONLY        discover, inspect, export, snapshot, compare, report
                         — NO external mutation
LEVEL_2_RECOMMEND        analyse, plan, simulate, dry-run, compute impact,
                         generate rollback plans — NO external mutation
LEVEL_3_APPROVAL_REQUIRED prepare automatically, verify gates automatically,
                         require explicit authorised approval, execute only
                         after approval, verify, rollback where permitted
LEVEL_4_FULL_AUTOMATIC   approved low-risk operations only, with monitoring,
                         audit, bounded retries, and rollback or safe failure,
                         under a previously approved policy
```

**A workflow or agent may never silently promote itself to a higher level.**
Level changes require audited policy approval.

### 12.4 The permanent `LEVEL_3` boundaries — preserved in full

The 18 actions listed in `docs/AUTOMATION_APPROVAL_MATRIX.md` §2 **always
remain `LEVEL_3_APPROVAL_REQUIRED`** regardless of how mature MAOL becomes,
unless a future explicit governance amendment says otherwise: nameserver
changes; DNSSEC/DS-record changes; production DNS record deletion; production
destructive migration; production database deletion; production data overwrite;
deletion of backups; disabling backups; secret or credential exposure;
privilege escalation; changing Super Admin access; production firewall/network
changes; sending or transferring money; issuing refunds; contractual
acceptance; public publication of sensitive or regulated data; production
shutdown; irreversible external-provider actions.

**Nothing in this specification narrows that list.** §4 of that matrix applies:
the list is a **floor, not a ceiling** — any stage may add to it without a
governance amendment; removing from it requires one.

### 12.5 How approval works mechanically

- Approval is a **persisted state**, not a prompt loop — `WAITING_FOR_APPROVAL`
  plus an approval entity with a **mandatory human decider**.
- A granted approval releases **exactly one** dispatch.
- Approvals **expire**; an expired approval cannot be reused by a later run.
- **Self-approval is refused** where separation of duties is required.
- A **rejected run cannot execute**, and rejection is recorded with its reason.
- **Rollback is a separate audited execution**, never folded silently into the
  original run's result.

### 12.6 Status

**IMPLEMENTED** builder-side (persisted `WAITING_FOR_APPROVAL` state, mandatory
human decider, one-dispatch release) / **PLANNED** as a product-facing approval
inbox.

---

## 13. Audit and Trace System

### 13.1 What is recorded

Every AI action records, at minimum, the eight required elements:

```text
USER            who requested it (opaque reference)
AGENT           which agent acted, at which version
MODEL           which provider and model served it
PROMPT/CONTEXT  what context was assembled — by reference and digest
ACTION          what was attempted, with its policy class and level
RESULT          what happened, including failure and refusal
APPROVAL        the approval record, or explicitly none required
TIMESTAMP       when, in UTC
```

### 13.2 Full envelope

Extended with the fields the automation model already requires:

```text
audit_event_id · correlation_id · causation_id · idempotency_key
organization_id · environment_id · actor_ref · actor_type
agent_id · agent_version · skill_id · skill_version
provider · model · capability_class · routing_reason
context_package_ref · context_digest · context_item_count
policy_class · automation_level · guard_decision · guard_reason
approval_policy_id · approval_status · approved_by · approved_at
tool_calls[] · resource_refs[]
cost_units · token_usage · latency_ms
result_status · error_class · error_summary
rollback_plan_reference · rollback_execution_reference
created_at
```

### 13.3 Rules

1. **Append-only.** No update or delete path exists, and none may be added
   without a separate governance amendment.
2. **Written before the effect** for mutating actions. An action whose audit
   record cannot be written does not execute.
3. **Redacted by construction.** Secrets and personal data are redacted on
   every persisted and logged surface, using the shared redaction library —
   one redaction implementation in the repository, not several.
4. **No PII in identifiers.** `actor_ref` and `approved_by` are opaque.
5. **Context is referenced, not copied.** The full prompt is not duplicated
   into the audit row; a reference plus digest allows verification without
   creating a second uncontrolled copy of sensitive context.
6. **Traceable end to end.** `correlation_id` threads a user request through
   every event, task, model call, approval, and result derived from it.
7. **Refusals are audited too.** A `DENY` is as important a record as an
   execution — arguably more so.

### 13.4 Status

**IMPLEMENTED** builder-side (durable JSONL event stream, redaction on every
byte, correlation threading, `replay(since)` recovery; append-only
`aut_audit_events` and `pi_guard_decisions` designed) / **PLANNED** as a
queryable product-facing audit surface.

---

## 14. Digital Twin

*Future capability — the model that lets AI understand the environment rather
than isolated requests.*

### 14.1 What it represents

| Facet | Contents |
|---|---|
| **Company** | Structure, sites, roles, policies, calendars, capacity |
| **Projects** | State, phases, dependencies, milestones, risks, history |
| **Operations** | Workflows, throughput, bottlenecks, exceptions, SLAs |
| **Resources** | People (as roles and availability), equipment, materials, budget |
| **Users** | Roles, responsibilities, working patterns, permissions |

### 14.2 The defining property

Without a twin, every request is answered in isolation: *"summarise this
invoice."* With one, the layer can reason: *"this invoice is from a supplier on
the critical path of a project already two weeks late, and its amount exceeds
the remaining budget line."* Same document, entirely different usefulness.

### 14.3 Architectural rules

1. **The twin is derived, never authoritative.** It is a projection over
   product-owned records. Products remain the single writer for their own
   nouns; the twin never becomes a competing source of truth.
2. **It references, it does not duplicate.** Nodes are `EntityReference`s. No
   cross-schema foreign keys; no copied PII.
3. **It is tenant-scoped absolutely.** One organisation's twin is
   unreachable from another's, enforced at the data layer.
4. **Staleness is explicit.** Every projection carries the timestamp of the
   data it was built from. A twin that silently serves week-old state is worse
   than no twin.
5. **Permission is evaluated at read time**, on the underlying records — never
   inherited from the projection. A twin must not become a permission
   laundering route.

### 14.4 Relationship to the Knowledge Graph

The twin is the concrete, business-facing form of the Knowledge Graph recorded
as CONCEPTUAL in `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` §3.I. Typed
relationships across projects, entities, decisions, and artifacts are the
mechanism; the twin is the model built on it.

### 14.5 Status

**CONCEPTUAL / FUTURE** (Phase 5). No design document beyond this section; no
implementation.

---

## 15. Continuous Improvement Loop

### 15.1 The loop

```text
   ┌──────────────────────────────────────────────┐
   │                                              │
   ▼                                              │
ACTION  →  RESULT  →  FEEDBACK  →  EVALUATION  →  IMPROVEMENT
```

| Stage | What happens | Recorded as |
|---|---|---|
| **Action** | An agent invokes a skill under policy | Audit record (§13) |
| **Result** | Output produced, accepted, corrected, or rejected | Result + validation outcome |
| **Feedback** | Explicit human signal, or implicit (edit, rework, abandon) | Feedback record with source |
| **Evaluation** | Aggregation into metrics per skill, agent, and category | Evaluation record (§6.4) |
| **Improvement** | A proposed change: prompt, routing, workflow, knowledge, or configuration | **Proposal** — never an applied change |

### 15.2 The four improvement channels

1. **Feedback** — corrections and ratings, scoped and attributed.
2. **Metrics** — acceptance rate, rework rate, cost per accepted result,
   groundedness, latency.
3. **Better workflows** — automation proposals from §11.
4. **Updated knowledge** — new or superseded Vault items and memory records.

### 15.3 What this is NOT — stated as a permanent boundary

> **Do NOT create uncontrolled self-modifying AI.**

Concretely, all of the following are **forbidden**:

- The layer changing its own permissions, policy, or automation levels.
- The layer editing its own source, prompts, or skill definitions in
  production without review.
- Learned behaviour propagating to `organisation`, `domain`, or `global` scope
  automatically.
- A model's proposal being applied because the model was confident.
- Any improvement path that bypasses the audit trail.

### 15.4 Controlled evolution — how improvement actually lands

```text
PROPOSAL  (from feedback/metrics/detection, with evidence)
   ↓
IMPACT ANALYSIS  (what changes, for whom, what could regress)
   ↓
REVIEW  (human, and where applicable an agent other than the proposer)
   ↓
POLICY CHECK  (does it touch a safeguard surface? → strictest lane)
   ↓
APPROVAL  (explicit, per §12)
   ↓
STAGED APPLICATION  (reversible, monitored, with a rollback path)
   ↓
VERIFICATION  (did it actually improve the metric it claimed?)
   ↓
RECORD  (memory + audit + changelog)
```

### 15.5 The safeguard surface — refused at build time

The implemented self-improvement engine already enforces this and MAOL inherits
it (`docs/MYTHOS_ORCHESTRATION_CORE.md` §11): missions scoped at the safeguard
surface — **policy engine, validation, events, store, redaction, the
self-improvement engine itself, service units, credential-shaped paths, and
`.git/`** — are **refused at build time**, and the real diff is re-checked
after implementation, so an undeclared protected-path edit fails validation
whatever the mission declared.

For MAOL the safeguard surface additionally includes: Guard and the permission
model, tenant-isolation enforcement, the approval matrix and its policies, the
audit writer, agent registration and permission grants, and the connector
catalogue.

**The runtime modifying its own policy or security layers is
`DENY` / human control. Permanently.**

### 15.6 Status

**DESIGNED**, with an IMPLEMENTED and test-proven builder-side precedent
(`self-improve.js`, caged, worktree-isolated, reviewable-branch output, never
auto-merged into the live checkout).

---

## 16. External Connectors

### 16.1 Catalogue

| Connector | Purpose | Initial level |
|---|---|---|
| **Google Drive** | Document ingestion into the Vault | `LEVEL_1_READ_ONLY` |
| **Gmail** | Email ingestion, thread context | `LEVEL_1_READ_ONLY` — **sending is `LEVEL_3`** |
| **Calendar** | Scheduling context, availability | `LEVEL_1_READ_ONLY` — writing is `LEVEL_3` |
| **WhatsApp** | Customer communication channel | **`LEVEL_3` for anything outbound**, always |
| **Generic APIs** | Arbitrary authorised HTTP integrations | Per-connector, declared |
| **ERP** | Financial and operational system of record | `LEVEL_1_READ_ONLY` first; writes `LEVEL_3` |
| **E-commerce** | Orders, catalogue, stock, customers | `LEVEL_1_READ_ONLY` first; writes `LEVEL_3` |
| **Future integrations** | Added via the same contract, never ad hoc | Declared per connector |

### 16.2 Connector contract

Inherited from `docs/AUTOMATION_ARCHITECTURE.md` §5 — MAOL introduces **no
parallel connector system**. A knowledge-source connector is an `aut_connectors`
entry with `connector_type = 'knowledge_source'`, not a new registry.

Every connector declares: capabilities (**exact set**, not a prefix or
wildcard), `secret_reference` (**never a value**), scopes, rate limits,
timeouts, health metadata, rollback capability, and its automation level.

### 16.3 Rules

1. **Disabled by default.** Every connector ships disabled with no credential.
2. **Least privilege.** A read-only connector **refuses mutation-shaped
   methods** — enforced by an exact-set capability check that cannot be
   broadened at runtime.
3. **Credentials by reference only.** No connector definition, workflow, event,
   memory record, prompt, log, or audit row ever contains a secret value.
4. **Consent and authorisation are per organisation**, revocable, and recorded.
5. **Outbound communication is never `LEVEL_4`.** Messages to real people on a
   customer's behalf require human approval.
6. **No scraping in place of an authorised feed** — external data comes by
   authorised API or feed, following the ecosystem's existing integration
   contracts.

### 16.4 Status

**DESIGNED**, with IMPLEMENTED reference connectors on the infrastructure track
(OVH, Cloudflare, DNS, deploy, backup) — all read-only or gated shut, no live
credential, none deployed. **No business connector in §16.1 exists yet.**

---

## 17. Security Architecture

### 17.1 Permissions

The Guard decision model, unchanged
(`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11):

```text
ALLOW | DENY | REQUIRE_APPROVAL | READ_ONLY | DRY_RUN_ONLY
```

Evaluated over: user, role, organisation, domain, skill, action, resource,
automation level, and data classification.

**Learning and personalisation may never alter this decision upward.** A
learned preference can request a friendlier phrasing of a `DENY`; it can never
turn a `DENY` into an `ALLOW`. **AI learning must never grant permissions.**

### 17.2 Precedence — permanent

```text
1. System / security / legal constraints
2. Current authorised organisation policy
3. Current role / permissions
4. Current explicit user instruction (this message, this turn)
5. Explicit persistent user rule
6. Verified organisation workflow
7. Established user preference
8. Domain default
9. Generic Mythos default
```

**A user preference never bypasses permissions or security.** Personalisation
operates strictly downstream of everything above it in this list.

### 17.3 Data isolation and tenant isolation

**No cross-user or cross-organisation leakage, ever.** Enforcement order on
every read and write:

```text
1. User scope         — there is no "query all users" path
2. Organisation scope — every query carries the requesting organisationId
3. Permission scope   — Guard still applies within the correct scope
```

**Application/data-layer enforcement is mandatory — prompts are never the
isolation boundary.** A model instructed to "only use this organisation's data"
is not an isolation mechanism.

Forbidden outcomes, restated:

- One tenant's data becoming available to another without explicit
  authorisation.
- A user gaining access because the AI guessed a plausible identifier.
- A memory item written under one `organisationId` being retrievable under
  another.
- Automatic promotion of a `user`-scoped learned preference to
  `organisation`/`domain`/`global` scope.

Required tests for every implementation stage: **user isolation, organisation
isolation, and permission-guessing resistance.**

### 17.4 Agent restrictions

- Agents receive **only** the tools their task needs — never the registry.
- Agents cannot modify their own or another agent's permissions.
- Advisory agents can never gain execution authority through routing.
- `ROOT` and `DESTRUCTIVE` policy classes are **hard-floored deny in code** —
  no configuration value can loosen them, and the decision reason records when
  a hostile configuration was overridden.
- Unknown policy classes **deny**.
- Two agents never share a writable surface; isolation is structural.

### 17.5 Secret management

Inherited from `docs/AUTOMATION_SECURITY_AND_SECRETS.md`, unchanged:

- **No secret in any source file, prompt, memory record, event, log,
  documentation, fixture, commit message, or audit row.**
- Credentials are referenced by id; values live only in approved secret
  storage.
- Intake **refuses any payload carrying a secret shape** rather than redacting
  it.
- Redaction is applied to every persisted and logged surface, by one shared
  implementation.
- **Secret or credential exposure is a permanent `LEVEL_3` boundary.**
- Target state: per-task credential injection with least privilege and short
  lifetimes (Secret Broker) — **PLANNED**, not present.

### 17.6 Privacy

- **Data minimisation is structural**: profiles prefer references and IDs over
  embedded content.
- Personal identifiers in memory and context records are **opaque
  references**, not names, emails, or phone numbers.
- Sensitive classification is evaluated **before** any external model call
  (§10.2).
- Users have visible memory controls: what is remembered, at what scope, and
  the ability to remove it (deletion is a tombstone, never a silent removal).
- Third-party personal data stays out of `mythos_intelligence` per ratified
  decision D1(c).

### 17.7 Status

**DESIGNED** as a composed layer; the underlying rules are canonical and
several enforcement points (policy hard floors, scope helpers, redaction,
secret-shape refusal) are **IMPLEMENTED**.

---

## 18. Enterprise Readiness

| Dimension | Requirement | Status |
|---|---|---|
| **Multi-tenant** | Organisation-scoped everything, enforced at the data layer; per-tenant configuration, capability enablement, automation ceilings, and audit | Isolation model **DESIGNED/partly IMPLEMENTED**; product runtime **PLANNED** |
| **Multi-language** | Arabic, Tunisian Arabic, French, English, and mixed Arabic/French as first-class — including natural, imperfect, short, non-technical requests. Language affects understanding and output, never permissions | Intent normalisation **IMPLEMENTED** (MPI-0/MPI-4 reference); full coverage **PLANNED** |
| **API first** | Every capability reachable through a versioned, authenticated, rate-limited API; the UI is one client among several; no capability exists only inside a screen | **PLANNED** |
| **Plugin architecture** | Agents, skills, connectors, and domain packs are pluggable through declared contracts, versioned per `docs/SKILLS_VERSIONING_POLICY.md`; adding one is configuration + adapter, never a core change | Contracts **DESIGNED**; runtime **PLANNED** |
| **Marketplace** | Distribution of the above (§19) | **CONCEPTUAL / FUTURE** |
| **Compliance** | Append-only audit, data classification, retention and legal hold, right-to-erasure design, consent records, residency constraints, separation of duties, permanent approval boundaries | Audit and approval foundations **IMPLEMENTED/DESIGNED**; erasure policy and residency **PLANNED**; regulated-vertical work (e.g. healthcare) remains **explicitly deferred** pending legal review |

### 18.1 API surface shape

```text
POST /v1/ai/conversations/{id}/messages     conversational turn
POST /v1/ai/capabilities/{skillId}/invoke   direct capability invocation
GET  /v1/ai/context/preview                 what context WOULD be assembled
GET  /v1/ai/agents                          registry, scoped to the caller
POST /v1/ai/approvals/{id}/decide           human approval decision
GET  /v1/ai/audit                           queryable, permission-filtered
GET  /v1/ai/knowledge/search                Vault search
POST /v1/ai/documents                       document ingestion
GET  /v1/ai/feedback                        feedback capture and read
```

`GET /v1/ai/context/preview` is deliberately part of the public surface:
**a layer whose context assembly cannot be inspected cannot be trusted or
debugged.**

---

## 19. Future AI Marketplace

*CONCEPTUAL / FUTURE. Recorded so its safety model is designed before it is
built, not after.*

### 19.1 What is distributed

| Type | Description |
|---|---|
| **AI Agents** | Packaged agent definitions with identity, objectives, and declared permission requirements |
| **Skills** | Reusable capabilities against the §7.3 contract |
| **Connectors** | External integrations against the §16.2 contract |
| **Templates** | Workflow, document, and report templates |
| **Extensions** | Domain packs and vertical bundles |

### 19.2 Publication pipeline

```text
SUBMIT → static review (contract conformance, declared permissions, schemas)
       → security review (secret handling, data flows, external calls)
       → sandbox execution (synthetic tenant, no real data, no real credentials)
       → policy classification (levels, risk, permanent-boundary contact)
       → human approval
       → versioned publication
       → post-publication monitoring (failures, denials, incidents)
       → revocation path (immediate, tenant-wide)
```

### 19.3 Hard rules

1. **Nothing is installed with elevated permissions automatically.** A listing
   *declares* required permissions; an organisation admin *grants* them
   explicitly, per grant.
2. **Marketplace content is untrusted by default.** It runs under the same
   Guard, policy, tenant isolation, and audit as first-party content — never a
   privileged path.
3. **No marketplace item may raise an automation ceiling** or claim a level
   inconsistent with the approval matrix.
4. **Every item is versioned and revocable**, and revocation is immediate.
5. **No item may ship a credential**, request a raw secret, or route tenant
   data to an undeclared destination.
6. **A marketplace listing's text is untrusted input**, not instructions —
   descriptions never influence permission decisions.

### 19.4 Status

**CONCEPTUAL / FUTURE** (Phase 6+). No implementation, no design document
beyond this section.

---

## 20. Implementation Roadmap

Phases build on each other. **No phase beyond Phase 1 may start without an
explicit owner order**, and the one-major-stage-at-a-time rule
(`docs/ROADMAP.md`) continues to apply across all tracks.

| Phase | Name | Contents | Depends on | Status |
|---|---|---|---|---|
| **0** | Specification | This document (MAOL-0) | — | **THIS STAGE** |
| **1** | Foundation and AI Gateway | Provider-independent gateway; capability classes; adapters; health/quota/fallback; budget integration; audit skeleton; API skeleton | Phase 0 | PLANNED |
| **2** | Memory + Knowledge | Four memory tiers wired product-side; Context Engine at product breadth; Knowledge Vault; Document Intelligence | Phase 1 | PLANNED |
| **3** | Agents | Agent registry, the eight specialised agents, governance, skills library, human approval inbox | Phase 2 | PLANNED |
| **4** | Automation with n8n | Product event bus, business event catalogue, n8n product workflows, business connectors, AI Workflow Builder | Phase 3 | PLANNED |
| **5** | Digital Twin | Company/project/operations/resource/user projection; knowledge graph relationships | Phase 4 | CONCEPTUAL |
| **6** | Controlled self-improvement | Feedback loop, evaluation, proposal→review→approval→staged application, agent reputation | Phase 5 | CONCEPTUAL |

### 20.1 Entry and exit criteria

| Phase | Cannot start until | Is not complete until |
|---|---|---|
| **1** | Owner order; provider credentials decided | A capability class resolves to at least two different providers, a provider can be removed without code changes in callers, and every call is audited |
| **2** | Phase 1 exit; storage decisions D3/D5 implemented (R2 bucket, scoped credential, backup gate) | Context assembly is inspectable via API, tenant-isolation tests pass, and no content is embedded in database rows |
| **3** | Phase 2 exit; approval inbox usable by a human without a model in the loop | Every agent is disabled-by-default, the kill switch works, and no agent holds `executionAuthority` |
| **4** | Phase 3 exit; connector consent model live | No generated workflow can self-activate, and `GATE_CHECK` rejects level mismatches |
| **5** | Phase 4 exit | Twin staleness is explicit and permissions are evaluated at read time on underlying records |
| **6** | Phase 5 exit; audit queryable; rollback proven | Safeguard-surface changes are refused at build time and re-checked against the real diff |

### 20.2 Relationship to existing tracks

MAOL is an **umbrella**, not a competing track. It composes:

- **Personal Intelligence (MPI-\*)** — MPI-0…MPI-4 complete; MPI-5…MPI-10
  remain the ratified sequence and are the delivery vehicle for much of Phases
  2–3. MAOL does not renumber or supersede them.
- **Automation (AUT-\*, INF-\*)** — owns levels, approvals, connectors,
  governance. MAOL consumes them.
- **Orchestrator (Phases 1–8 of the master vision)** — owns the builder-side
  runtime. MAOL reuses its machinery.
- **Research Intelligence (RES-\*)** — the Research Agent's substrate.

**Nothing in this roadmap changes the currently authorised implementation
priority in `docs/ROADMAP.md`.**

---

## A. Traceability matrix

| § | Component | Owning canonical document | Status |
|---|---|---|---|
| 1 | Vision | `MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` | DESIGNED |
| 2.1 | AI Gateway | `MODEL_ROUTING_ARCHITECTURE.md`; `MYTHOS_ORCHESTRATION_CORE.md` §8 | DESIGNED / partly IMPLEMENTED |
| 2.2 | n8n layer | `MYTHOS_AI_EXECUTOR_ARCHITECTURE.md`; `MYTHOS_ORCHESTRATION_CORE.md` §10 | IMPLEMENTED (builder) / PLANNED (product) |
| 2.3 | Events | `AUTOMATION_ARCHITECTURE.md` §4; `MYTHOS_ORCHESTRATION_CORE.md` §10 | DESIGNED / IMPLEMENTED (runtime stream) |
| 3 | AI Brain | `MYTHOS_CHATBOT_ARCHITECTURE.md` | DESIGNED |
| 4 | Memory | `MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md`; `MYTHOS_USER_MEMORY_POLICY.md` | IMPLEMENTED (MPI-2) / PLANNED (org tier, vectors) |
| 4.6 | Vector search | `MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §13 | **PLANNED — DEFERRED by decision** |
| 5 | Multi-agent | `MYTHOS_ORCHESTRATION_CORE.md` §4 | DESIGNED / IMPLEMENTED (builder registry) |
| 6 | Agent governance | `AUTOMATION_GOVERNANCE.md`; `MYTHOS_ORCHESTRATION_CORE.md` §7 | DESIGNED |
| 7 | Skills library | `SKILLS_ARCHITECTURE.md`; `MYTHOS_DOMAIN_PACKS.md`; `AGENTS.md` §24 | DESIGNED |
| 8 | Context Engine | `MYTHOS_CONTEXT_ARCHITECTURE.md` | IMPLEMENTED (MPI-1) / PLANNED (breadth) |
| 9 | Knowledge Vault | `MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §12.1 (D3/D5) | PLANNED |
| 10 | Document Intelligence | `MYTHOS_DOMAIN_PACKS.md` (`document.prepare`) | PLANNED |
| 11 | Workflow Builder | `AUTOMATION_ARCHITECTURE.md` §3 (`GATE_CHECK`) | CONCEPTUAL / FUTURE |
| 12 | Human approval | `AUTOMATION_ARCHITECTURE.md` §2; `AUTOMATION_APPROVAL_MATRIX.md` | IMPLEMENTED (builder) / PLANNED (product) |
| 13 | Audit and trace | `AUTOMATION_ARCHITECTURE.md` §4; `MYTHOS_ORCHESTRATION_CORE.md` §10 | IMPLEMENTED (builder) / PLANNED (queryable) |
| 14 | Digital Twin | this document; `MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` §3.I | CONCEPTUAL / FUTURE |
| 15 | Improvement loop | `MYTHOS_USER_MEMORY_POLICY.md`; `MYTHOS_ORCHESTRATION_CORE.md` §11 | DESIGNED / IMPLEMENTED (builder cage) |
| 16 | Connectors | `AUTOMATION_ARCHITECTURE.md` §5; `AUTOMATION_SECURITY_AND_SECRETS.md` | DESIGNED |
| 17 | Security | `MYTHOS_AI_MULTI_TENANCY.md`; `MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11 | DESIGNED / partly IMPLEMENTED |
| 18 | Enterprise readiness | `MYTHOS_IDENTITY_ARCHITECTURE.md`; `SKILLS_VERSIONING_POLICY.md` | PLANNED |
| 19 | Marketplace | this document | CONCEPTUAL / FUTURE |
| 20 | Roadmap | `ROADMAP.md` (authoritative for priority) | — |

---

## B. Preserved agreements — this document overrides none of them

Recorded explicitly so no future reading of this specification can be used to
weaken a prior decision.

| # | Agreement | Source |
|---|---|---|
| B1 | **Vector search is DEFERRED by decision.** `pgvector` is not to be installed in MPI-2; activation is a separate authorised stage with its own gate | `MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md` §13 |
| B2 | **D1(c): third-party contacts stay out of `mythos_intelligence` entirely.** No third-party names, emails, or phone numbers | ibid. §12.1 |
| B3 | **D2: NO — MPI never becomes owner of personal entities.** `pi_entity_references` stays a pointer registry | ibid. §12.1 |
| B4 | **D3: memory content lives in object storage**; PostgreSQL stores `content_reference` only | ibid. §12.1 |
| B5 | **D5: MPI uses its own R2 bucket**; `mythos-offhost-backups` is not reused | ibid. §12.1 |
| B6 | **D4 remains OPEN** — whether `disputed` may auto-resolve by scope precedence | ibid. §12.1 |
| B7 | **The 18 permanent `LEVEL_3` boundaries** stand; the list is a floor, not a ceiling | `AUTOMATION_APPROVAL_MATRIX.md` §2, §4 |
| B8 | **`.claude/skills/` entries are Agent Development Skills only**, never reachable from an end-user request | `AGENTS.md` §24; `SKILLS_ARCHITECTURE.md` §1 |
| B9 | **Skill source must never silently rewrite itself**; a skill change is a reviewed repository change | `AGENTS.md` §24 |
| B10 | **Tenant isolation is enforced at the application/data layer; prompts are never the isolation boundary** | `MYTHOS_AI_MULTI_TENANCY.md` §1 |
| B11 | **AI learning must never grant permissions**; a learned preference never turns `DENY` into `ALLOW` | `MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §6, §11 |
| B12 | **Default learned scope is `user`**; promotion is never automatic | ibid. §8 |
| B13 | **A single user's behaviour must never silently modify global Mythos behaviour** | ibid. §2 |
| B14 | **Provider independence**: no personal or organisation intelligence stored only in a provider-specific prompt | `MODEL_ROUTING_ARCHITECTURE.md` §1 |
| B15 | **n8n never becomes the orchestration state store** | `MYTHOS_ORCHESTRATION_CORE.md` §10 |
| B16 | **`ROOT` and `DESTRUCTIVE` are hard-floored deny in code**; no configuration can loosen them | ibid. §7 |
| B17 | **Advisory agents are never promotable to execution authority**; nothing hard-codes Claude | ibid. §4 |
| B18 | **Gemini is registered UNCONFIGURED**; no credential is invented, and it is reachable only as an OmniRoute-served model | ibid. §4, §13 |
| B19 | **The safeguard surface is refused at build time**, and the real diff is re-checked afterwards | ibid. §11 |
| B20 | **Two writers never share a working tree**; isolation is structural | ibid. §6 |
| B21 | **Quota exhaustion is a first-class state, never a failure** | `MYTHOS_AI_EXECUTOR_ARCHITECTURE.md`; `MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` §9 |
| B22 | **One writer per noun; no cross-schema foreign keys**; MAOL duplicates no product-owned data | `AUTOMOTIVE_DATA_GOVERNANCE.md` |
| B23 | **The SSANGYONG legacy site stays frozen and untouched** | `AI_HANDOVER.md` §22 option 3 ratification |
| B24 | **GitHub is the source of truth**; a stage is not complete until committed, pushed, and verified remotely | `AGENTS.md` §2, §7 |
| B25 | **Healthcare and other regulated verticals remain deferred** pending legal review | `MYTHOS_DOMAIN_PACKS.md` §1 |
| B26 | **The one-major-implementation-stage-at-a-time rule** continues to bind every track | `ROADMAP.md` |
| B27 | **The 18 permanent design principles** of the orchestrator vision bind every future phase and provider | `MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` §19 |

---

## C. Open decisions this specification does not make

These require an owner decision before the phase that depends on them starts.
They are recorded, not resolved.

| # | Decision | Blocks |
|---|---|---|
| **O-MAOL-1** | Which providers are contracted for product use, and with what data-processing terms | Phase 1 |
| **O-MAOL-2** | Per-tenant AI budget model and who may raise a limit | Phase 1 |
| **O-MAOL-3** | Whether any tenant data may leave the jurisdiction, and which classifications are external-model-eligible | Phase 1–2 |
| **O-MAOL-4** | Local/self-hosted model provisioning for `RESTRICTED` content | Phase 2 |
| **O-MAOL-5** | Retention and right-to-erasure policy for Vault content and memory (interacts with the open MPI erasure/FK remediation) | Phase 2 |
| **O-MAOL-6** | Whether any agent will ever hold `executionAuthority` product-side, and under what governance | Phase 3 |
| **O-MAOL-7** | Which connectors are authorised first, with which scopes and consent flow | Phase 4 |
| **O-MAOL-8** | Whether the Marketplace is first-party-only at launch | Phase 6+ |
| **O-MAOL-9** | D4 (`disputed` auto-resolution) — still open from MPI-2 | Phase 2 |
| **O-MAOL-10** | Vector search activation trigger and its gate | §4.6 |

---

## D. Permanent design principles for this layer

In addition to the 18 principles of `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md`
§19, which bind MAOL unchanged:

1. Permission filtering precedes relevance ranking — always.
2. Isolation is enforced in the data layer, never in a prompt.
3. The layer proposes; humans dispose, wherever consequences are real.
4. Nothing is remembered that was not permitted to be seen.
5. No secret ever enters memory, context, prompt, event, log, or audit.
6. Every substantive claim is grounded and traceable to a source.
7. Unknowns are stated, never filled with plausible invention.
8. Capability is added by composition, never by copying.
9. Provider choice is empirical and revisable; provider dependence is not.
10. Every widening of automatic authority is an explicit, owner-ratified policy
    change — never a side effect.
11. Refusals are audited as carefully as executions.
12. Implemented and planned functionality are always clearly separated.

---

*End of specification. Corrections to this document are themselves reviewed
repository changes; where it conflicts with a canonical document named in §0.5,
the canonical document wins.*
