# Mythos AI Orchestrator — Master Architecture & Vision Record

**Stage:** MYTHOS-AI-ORCHESTRATOR-VISION-0 (Phase 0 — documentation only)
**Date:** 2026-08-16
**Status of this document:** Authoritative vision record. No runtime behavior
was changed by this stage.
**Baseline verified against:** commit `d120d7d` (local HEAD = last verified
remote HEAD at the time of writing).

---

## 0. Purpose and status vocabulary

This document permanently records the agreed vision for evolving Mythos from a
Claude automation tool into a general **AI Orchestration / Agent Runtime**
capable of managing complete project goals. It exists so that no architectural
decision or idea is lost between ChatGPT, Claude Code, n8n, future agents, and
future sessions.

Every capability in this document carries exactly one status:

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | Exists in this repository, validated, committed, and (unless stated otherwise) deployed. Verified against the repository, not against conversation memory. |
| **PLANNED** | Agreed direction with a roadmap phase, but no code exists. |
| **DESIGNED** | A committed design/specification document exists, but no (or almost no) implementation. |
| **CONCEPTUAL / FUTURE** | An agreed idea without a committed design; recorded so it is not lost. |

**Rule: a planned feature must never be described as implemented.** When this
document says IMPLEMENTED, the claim was checked against the repository at the
baseline commit above. Everything else in this document describes intent.

Related committed documents this record builds on (not duplicated here):

- `docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md` — the implemented executor (Phase 1 MVP).
- `projects/mythos-ai-executor/README.md` — executor operation.
- `docs/MYTHOS_ORCHESTRATOR_ARCHITECTURE.md` / `docs/MYTHOS_ORCHESTRATOR_RUNBOOK.md` — the implemented Claude→Codex delegation runtime.
- `docs/MODEL_ROUTING_ARCHITECTURE.md` — draft capability-class model routing (DESIGNED, no provider adapter implemented).
- `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` — context assembly architecture.
- `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md` — control center product spec (DESIGNED).
- `docs/AUTOMATION_APPROVAL_MATRIX.md`, `docs/AUTOMATION_GOVERNANCE.md` — the existing automation approval/level model.
- `AGENTS.md` — permanent repository rules, including §25 multi-agent orchestration.

---

## 1. Core vision

Mythos should evolve from a Claude automation tool into a general
**AI Orchestration / Agent Runtime** that manages complete project goals. The
owner should eventually give Mythos a high-level goal rather than manually
managing individual AI tools.

Conceptual flow (target architecture, not current behavior):

```text
User
  ↓
ChatGPT / Control Layer          ← architecture, review, decisions
  ↓
Mythos Orchestrator              ← persistent execution layer
  ↓
Project Memory + Project Data + Current State
  ↓
Mission Planner
  ↓
Task DAG / Dependency Engine
  ↓
Agent + Tool selection
  ↓
Parallel or sequential execution
  ↓
Validation
  ↓
Git / APIs / external systems
  ↓
Report
  ↓
Memory update
  ↓
Next decision / continuation
```

Two permanent role assignments:

- **ChatGPT (or any control-layer model) is the architecture / review /
  decision layer.** It decides *what* should happen and evaluates results.
- **Mythos Runtime is the persistent execution layer.** It survives sessions,
  reboots, and quota exhaustion; it owns state, queueing, retries, and
  reporting.

**Claude is an agent, not the entire architecture.** Today Claude Code is the
sole execution authority (IMPLEMENTED, see §2); in the target architecture it
is one registered agent among several, selected by capability.

---

## 2. Current implemented foundation (verified)

Everything in this section is **IMPLEMENTED** — verified against the
repository at baseline `d120d7d`.

### 2.1 Mythos AI Executor (`projects/mythos-ai-executor/`)

Stage MYTHOS-AI-EXECUTOR-0, deployed 2026-08-16. Replaces the manual loop
(ChatGPT decides → operator pastes into Claude Code → operator pastes results
back) with a persistent autonomous chain:

```text
ChatGPT → n8n "MYTHOS — Task Intake" (authenticated webhook)
        → executor HTTP API → persistent queue
        → daemon → claude -p --session-id/--resume (headless)
        → checkpoint / quota-pause / retry (automatic)
        → structured report → git commit/push (docs/AI_EXECUTION_REPORT.md)
        → ChatGPT reads GitHub (or "MYTHOS — Report" webhook) → next task
```

Implemented and deployed:

- **Persistent queue daemon** (`executor.js`) with 15-second tick; runtime
  state under `/home/ubuntu/mythos-ai-executor/tasks/<id>/` (0700/0600, atomic
  tmp+rename writes, JSONL event log per task) — never `/tmp`, never Git.
- **Internal HTTP API** (`server.js`): binds `127.0.0.1` and `172.18.0.1`
  only; bearer auth with constant-time comparison; scoped ufw rule
  `172.18.0.0/16 → :8130/tcp` for the n8n container.
- **systemd user service** for `ubuntu` with linger enabled —
  survives SSH disconnect and reboot; `NoNewPrivileges=true`.
- **n8n integration**: five MYTHOS-namespace workflows imported and active in
  the existing n8n 2.29.9 (Task Intake / Execute Task / Quota Watch / Report /
  Failure Handler); credential referenced by id only; the 3 pre-existing
  SSANGYONG workflows untouched.
- **Task intake validation**: schema validation, whitelisted field forwarding
  (never `working_directory`), refusal of unregistered projects/providers,
  disabled profiles, and any payload carrying a secret shape.
- **Claude Code headless execution**: `claude -p --output-format json` with
  **session persistence** — `--session-id` on first run, `--resume` after,
  pinned per task. A resume that finds the session gone recreates it exactly
  once (evented `session_recreated`) with checkpoint + previous report
  injected.
- **Quota lifecycle — quota exhaustion is a first-class state, never a
  failure**: usage-limit shapes classified against transient/blocked/fatal
  (precedence-ordered, mutation-tested); reset time parsed from the provider
  message (`…|epoch`, "resets 3am", ISO) or conservative 30m/1h/2h/4h backoff;
  task parks in `WAITING_FOR_QUOTA`; two independent idempotent resumers
  (daemon tick + n8n Quota Watch every 10 minutes) resume the **same** pinned
  session.
- **Failure taxonomy and retry handling**: transient → `WAITING_RETRY` with
  1m/4m/16m bounded backoff then FAILED; blocked → `BLOCKED` for owner action;
  RUNNING with a dead pid auto-recovered; a provider "success" without a
  `mythos_report` becomes `BLOCKED` — never silently green. Transition-table
  enforced state machine:
  `QUEUED → RUNNING → COMPLETED | FAILED | BLOCKED | WAITING_FOR_QUOTA |
  WAITING_RETRY | CANCELLED`.
- **Provider abstraction**: `claude-code` (executionAuthority: true — the sole
  execution authority), `openai-compat` (advisory-only via OmniRoute, no
  working directory, no tools — execution surface stripped at task creation),
  `mock` (tests only, unreachable in production).
- **Policy layer** (`lib/policy.js`): execution profiles map
  READ / PROJECT_WRITE / GIT / SERVICE / DEPLOY / ROOT classes onto exact
  Claude tool permissions. Sudo is disallowed in every profile; the `deploy`
  profile ships **disabled** (enabling is an owner code change, never a
  payload option); ROOT is never grantable.
- **Report generation and Git delivery**: structured `mythos_report`
  extracted, schema-validated, git-verified (a claimed commit that Git cannot
  corroborate is flagged), appended to `docs/AI_EXECUTION_REPORT.md`,
  committed and pushed by the executor itself.
- **Shared libraries, not duplicates**: reuses
  `projects/mythos-orchestrator/lib/{redact,schema,git}` — one redaction, one
  schema validator, one Git verifier in the repository.
- **Authentication and redaction** on everything persisted and logged.
- **Tests**: `tests/mythos-ai-executor-test.js` — **118/118 passed**, offline,
  mock-provider-driven, zero real AI quota consumed by the suite.
  REPOSITORY_VERIFIED: recorded in the committed `d120d7d` stage record; the
  suite was not re-run by this documentation stage (documentation-only change,
  `AGENTS.md` §8).
- **End-to-end proof, real chain, twice**: tasks `t-20260816181607-030ggb` and
  `t-20260816182039-r4zuoq` traversed n8n webhook → queue → daemon → headless
  Claude → report → executor-made commits `3c65455` / `fe989e0`, both on the
  remote.

### 2.2 Mythos Orchestrator (`projects/mythos-orchestrator/`)

Stage MYTHOS-MULTI-AGENT-ORCHESTRATOR-0 — **IMPLEMENTED**. Claude acts as
orchestrator and can delegate implementation work to a worker provider (today
Codex) in an isolated worktree and branch, with structured results
(`schemas/result.schema.json`), independent Git verification, and execution
levels 1 (auto) / 2 (Claude-controlled) / 3 (owner approval) enforced in
`router.js` / `runner.js`. Level 3 operations never execute automatically.
This is the repository's existing precedent for agent delegation, worktree
isolation, and policy levels — the future architecture generalizes it rather
than replacing it.

### 2.3 OmniRoute

OmniRoute 3.8.49 is **already installed and healthy** on the host (Docker,
`127.0.0.1:20128`, not publicly exposed). It is currently **advisory-only**:
the executor's `openai-compat` provider can route any OmniRoute-served model
(GPT / Gemini / DeepSeek / Qwen / …) for analysis, review, planning, or second
opinions, with no execution surface by construction. It was evaluated, not
installed, by the executor mission, and is NOT exposed further. Full routing
integration is Phase 4 (PLANNED).

### 2.4 Frozen and untouched

The SSANGYONG legacy site (`/var/www/ssangyong.autos`, legacy MariaDB) remains
**frozen and untouched** — permanently for that workstream, per the ratified
§22 option 3 decision recorded in `docs/AI_HANDOVER.md`. Nothing in this
vision, and no future phase, may modify it without an explicit owner order.

### 2.5 Known residual risks (recorded honestly, not hidden)

- **GitHub push authority currently depends on session SSH agents.** The
  GitHub key exists only inside agents created by interactive sessions; after
  a reboot the daemon's report pushes fail (recorded per task in `events.log`,
  commits preserved locally) until a session recreates an agent. A **dedicated
  deploy key is a future hardening step** awaiting owner decision.
- **Executor report commits currently share the main checkout** and can race a
  concurrently-working session; reports are additive single-file appends,
  which bounds but does not eliminate the risk.
- **Unknown quota message formats fall back to conservative backoff** — only
  currently-known usage-limit shapes are patterned; unknown future shapes
  degrade to conservative backoff, never to task loss, but resume timing may
  be later than optimal.
- The `deploy` execution profile is disabled; enabling SERVICE/DEPLOY
  authority is an owner decision in `lib/policy.js`.

---

## 3. Future architecture components

Each component below records purpose, why it is needed, relationships, and
status. Statuses use the §0 vocabulary; "precursor" names the implemented
thing the component generalizes, where one exists.

### A. Goal Engine — CONCEPTUAL / FUTURE

Accepts a high-level goal ("increase sales") and decomposes it into
objectives and missions (§19). Needed so the owner states outcomes, not task
lists. Feeds the Mission Planner (B); reads Project Memory (F) and metrics.

### B. Mission Planner — PLANNED (Phase 2)

Turns a mission into a concrete ordered plan: tasks, dependencies, agents,
tools, validation criteria. Needed because a single prompt cannot carry a
whole project. Produces the Task DAG (D); consults Agent Registry (J), Tool
Registry (K), Context Engine (H).

### C. Task Engine — PLANNED (Phase 2)

Executes planned tasks with durable state. Precursor (IMPLEMENTED): the
executor's persistent queue, state machine, and retry/backoff — task-level
only, no inter-task dependencies. The Task Engine generalizes it to
DAG-driven, multi-task execution.

### D. Dependency DAG — PLANNED (Phase 2)

Explicit dependency graph over tasks so independent work runs concurrently and
dependent work waits (§11). Needed to move beyond one-task-at-a-time
execution. Consumed by Durable Execution (E) and Parallel Execution (Q).

### E. Durable Execution — task-level IMPLEMENTED; mission-level PLANNED

Execution state must survive process restarts, reboots, quota pauses, and
session loss. The executor already provides this per task (persistent store,
session resume, dead-pid recovery). Mission/DAG-level durability — resuming a
half-completed plan — is Phase 2.

### F. Project Memory — PLANNED (Phase 2); see §4

Provider-independent memory of each project. Precursors: `docs/AI_HANDOVER.md`
(per-stage), `docs/history/DAILY_HISTORY.md`, stage records — human-readable,
not yet structured for machine retrieval.

### G. Project Data Layer — PLANNED (Phase 2); see §5

Uniform access to project-specific data sources (PostgreSQL, sheets, files,
APIs). Precursors: individual product databases (e.g. the deployed
`ssangyong_autos` catalog) accessed by product-specific code.

### H. Context Engine — DESIGNED (architecture committed), implementation PLANNED (Phase 2)

Retrieves only the context relevant to a task instead of dumping whole
projects into prompts. `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` and the
`mythos-context-assembler` agent-development skill define the approach;
`projects/meta/current-context.json` is a small implemented precursor for
repository state. Depends on Project Memory (F) and Project Data (G).

### I. Knowledge Graph — CONCEPTUAL / FUTURE

Typed relationships across projects, entities, decisions, and artifacts,
enabling queries memory files cannot answer. Builds on F and G; no design
document yet.

### J. Agent Registry — PLANNED (Phase 2); see §6

Catalog of agents (role, provider, capabilities, cost, constraints).
Precursor (IMPLEMENTED): the executor's provider registry (`claude-code`,
`openai-compat`, `mock`) and the orchestrator's codex adapter — registration
exists, capability metadata does not.

### K. Tool Registry — PLANNED (Phase 2); see §7

Catalog of tools with schemas, permissions, cost, and risk level. Precursor:
the automation track's connector catalogue (capability-scoped, least-privilege,
e.g. `backup_storage_readonly`) — the same philosophy, per-track rather than
runtime-wide.

### L. MCP Tool Layer — PLANNED (Phase 2+); see §8

Standardized tool/resource protocol where appropriate. **Mythos does not
currently depend on MCP.**

### M. Model / Provider Router — DESIGNED; MVP abstraction IMPLEMENTED

`docs/MODEL_ROUTING_ARCHITECTURE.md` (draft, explicitly "no provider adapter
is implemented") defines capability-class routing. The executor implements a
minimal binary form: execution → `claude-code`, advisory → `openai-compat`.
Full routing by capability/health/quota/cost/quality is Phase 4.

### N. Provider Health — MVP scope IMPLEMENTED; routing integration PLANNED (Phase 4)

The executor's `GET /health` covers store, Claude CLI, n8n, OmniRoute, and
queue depth. Health-driven provider selection does not exist yet.

### O. Quota / Budget Engine — quota IMPLEMENTED (Claude); budget PLANNED

Quota exhaustion handling is implemented and proven for Claude (§2.1).
Multi-provider quota tracking and monetary budget enforcement (per task,
mission, and day) are Phase 4/5.

### P. Fallback Engine — PLANNED (Phase 4); see §9

On quota exhaustion or provider failure, route suitable work to a fallback
provider instead of waiting, when policy permits. Today the implemented
behavior is wait-and-resume, which is correct but not optimal.

### Q. Parallel Agent Execution — PLANNED (Phase 3); see §10

Concurrent execution of independent DAG branches by multiple agents. Today
one major stage runs at a time (`AGENTS.md` §25.1).

### R. Isolated Git Worktrees — practice IMPLEMENTED; systematic enforcement PLANNED (Phase 3)

The orchestrator already creates an isolated worktree and branch per delegated
job. The future runtime makes this mandatory whenever simultaneous code
modification is possible: **never allow multiple agents to blindly modify the
same working tree.**

### S. Policy / Risk Engine — precursors IMPLEMENTED; general engine PLANNED (Phase 5); see §11

Precursors: executor execution profiles (sudo never grantable, deploy
disabled), orchestrator levels 1–3, and the automation track's
LEVEL_1..LEVEL_4 approval matrix with owner-ratified policies. The future
engine unifies these into one configurable policy layer for all agents and
tools.

### T. Secret Broker — PLANNED (Phase 5); see §12

Per-task credential injection with least privilege. Today: env files (0600)
outside Git, task envelopes never carry credentials, intake refuses secret
shapes, shared redaction on all persisted output — safe, but not brokered.

### U. Sandbox — PLANNED (Phase 5)

Stronger isolation for agent execution (filesystem/network scoping beyond
tool permissions). Today: rootless daemon, `NoNewPrivileges=true`, no sudo in
any profile, loopback-only services.

### V. Dry Run — convention IMPLEMENTED per-track; runtime feature PLANNED (Phase 5)

The repository's migration/automation stages already practice dry-run-first
(e.g. the SSANGYONG migration pipeline generated and validated SQL without a
database connection). The future runtime offers dry run as a first-class
execution mode for any mutating task.

### W. Independent Validator — PLANNED (Phase 3); see §13

A validation step separate from the producing agent. Precursors: report
schema validation, Git verification, and the orchestrator rule that Claude
verifies delegated results independently.

### X. Adversarial Reviewer — PLANNED (Phase 3); see §13

A reviewer that actively hunts for what is wrong rather than confirming what
is right.

### Y. Event Bus / Event Engine — PLANNED (Phase 6); see §14

Runtime-wide typed events driving reactive automation. Precursors: per-task
JSONL `events.log`, n8n webhooks, best-effort ntfy notifications.

### Z. Audit Log — executor scope IMPLEMENTED; runtime-wide PLANNED (Phase 5)

Every task already has an append-only JSONL event log with redaction. The
future audit log covers all components, agents, tool calls, and policy
decisions, queryably.

### AA. Artifact Manager — PLANNED

Tracked storage for non-Git outputs (images, reports, datasets, builds) with
provenance. Today artifacts either go into Git or into product-specific
storage.

### AB. Agent Reputation / Evaluation — CONCEPTUAL / FUTURE (Phase 7); see §17

Historical per-category quality tracking feeding agent selection.

### AC. Self-Improvement Engine — CONCEPTUAL, roadmapped (Phase 7); see §15

Controlled development missions executed by Mythos against its own
repository. Deliberately last: it presupposes validation, policy, worktree
isolation, and rollback.

### AD. Human Override — partial IMPLEMENTED; mission-level PLANNED

Implemented today: `BLOCKED` state for owner action, task cancellation,
level-3 owner approval that never auto-executes, disabled-by-code deploy
profile. The future runtime adds pause/abort/redirect at mission and goal
level. **Autonomous does not mean unrestricted** — the owner can always stop
the system.

### AE. Dashboard / Control Center — DESIGNED (Phase 8)

`docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md` exists; no implementation.
Mission/task/agent/provider monitoring, cost/quota/state visibility.

### AF. Disaster Recovery — partial precursors IMPLEMENTED; runtime DR PLANNED

The infrastructure track has an off-host backup gate and a gated
backup-operations orchestrator (see `docs/OFF_HOST_BACKUP_GATE.md`,
INF-BACKUP-AUTO-0 records). Runtime-state DR (rebuilding queue/memory/state on
a new host) is future work; a known blocker is that no off-host destination
beyond GitHub exists yet.

---

## 4. Project Memory — PLANNED

Mythos must have **provider-independent project memory**. Memory must not
belong exclusively to Claude, Gemini, GPT, or any other model: switching or
adding a provider must never lose or require rewriting project knowledge.

Conceptual structure:

```text
MYTHOS MEMORY
├── Projects
├── Architecture
├── Decisions
├── Constraints
├── Roadmap
├── Current State
├── Completed Work
├── Known Problems
├── Dependencies
├── Integrations
├── Lessons Learned
└── Execution History
```

Rules:

- **Secrets must NOT be stored as project memory.** Credentials live only in
  the Secret Broker / approved secret storage (§12).
- **PROJECT MEMORY ≠ CURRENT RUNTIME STATE.** Project memory is durable
  knowledge (decisions, architecture, lessons) that outlives any execution.
  Runtime state (queue contents, session ids, pids, retry counters,
  checkpoints) is operational, transient in meaning even when persisted, and
  owned by the execution engine. Runtime state is never authoritative about
  what a project *is*; memory is never consulted to decide whether a process
  is currently running.
- Memory updates are part of the mission lifecycle (§1 flow): results and
  decisions flow back into memory after validation, not during execution.

Current precursors (IMPLEMENTED, human-oriented): `docs/AI_HANDOVER.md`,
stage records, `docs/history/DAILY_HISTORY.md`, per-track roadmaps, and the
Claude-specific auto-memory — the last being exactly the provider-bound form
this component is designed to supersede.

---

## 5. Project Data — PLANNED

Mythos must reason over project-specific data sources, including:

PostgreSQL · Google Sheets · CSV · JSON · documents · PDFs · GitHub · APIs ·
scraped datasets · images · logs · project-specific files.

The Context Engine (H) retrieves **only relevant context** rather than dumping
an entire project into an agent prompt: scoped queries, permission-filtered,
sized to the task. This is both a cost rule (token efficiency is a permanent
principle, §18) and a correctness rule (irrelevant context degrades output).

---

## 6. Agents — Agent Registry PLANNED

Agents are registered roles bound to providers by capability. Example roles:

Coding Agent · Research Agent · Review Agent · Testing Agent · DevOps Agent ·
Scraping Agent · Marketing Agent · Database Agent · Documentation Agent ·
Image Agent · Video Agent.

Claude, Gemini, GPT, DeepSeek, Kimi, GLM, local models, etc. are
**providers/agents selected according to capabilities** — no specific provider
is permanently preferred. Provider preference is an empirical, revisable
routing decision (M, AB), never an architectural commitment.

Current state (IMPLEMENTED): Claude Code is the sole execution authority;
Codex is an implemented delegated worker; OmniRoute-served models are
advisory-only. These are the first three registry entries in all but name.

---

## 7. Tools — Tool Registry PLANNED

Example tool names:

```text
github.read          github.create_task    github.commit
database.query       database.schema
web.search           web.scrape
image.generate       image.validate
meta.create_post     meta.create_campaign
document.read        pdf.create
video.generate       email.send
```

Each future tool should ideally expose:

- name
- capability
- input schema
- output schema
- permissions
- cost
- latency
- availability
- risk level
- provider

Tool grants are least-privilege and policy-gated (S): an agent receives the
tools its task needs, not the whole registry. The automation track's connector
catalogue (exact-set capability checks, refusal of mutation-shaped methods on
read-only connectors) is the implemented precedent for this contract.

---

## 8. MCP — PLANNED

MCP (Model Context Protocol) is recorded as a **planned** standardized
tool/resource layer where appropriate, so external tools and resources can be
added without tightly coupling every agent to every integration.

**Mythos does not currently depend on MCP.** Adoption is per-integration and
pragmatic: MCP where it reduces coupling, direct adapters where MCP adds
nothing.

---

## 9. Quota and fallback — quota IMPLEMENTED, fallback PLANNED

Intended behavior:

```text
Claude quota exhausted
    ↓
WAITING_FOR_QUOTA
    ↓
fallback provider if suitable
OR
    ↓
automatic resume when quota becomes available
```

**Quota exhaustion must not automatically become task failure.** The first two
steps are implemented and proven (§2.1). The fallback branch is Phase 4:
provider selection should eventually consider capability, health, quota, cost,
latency, historical quality, and task type — not just availability.

---

## 10. Parallel execution — PLANNED (Phase 3)

Independent tasks can run concurrently; dependent tasks must wait:

```text
API ─────┐
Frontend ├──→ Integration → Tests → Deploy
Database ┘
```

Rules:

- The DAG (D) is the single source of ordering truth.
- Agents must use **isolated worktrees** when simultaneous code modification
  is required (R).
- **Never allow multiple agents to blindly modify the same working tree.**
- Merge/integration points are explicit DAG nodes with validation, not
  implicit hopes.

---

## 11. Policy Engine — PLANNED (Phase 5); precursors implemented

Mythos must eventually replace repetitive human approval prompts with
predefined policies. Example policy (illustrative — **the exact policy must
remain configurable**):

```text
LOW RISK (auto, minimal gating):
- read files
- tests
- analysis
- documentation

AUTO (policy-gated automatic):
- project code changes
- Git commits
- controlled deployment

CONTROLLED (explicit policy + evidence):
- production service changes
- database writes
- spending

DENY / HUMAN CONTROL (never automatic):
- destructive database operations
- credential exposure
- irreversible destructive infrastructure actions
```

**Autonomous does not mean unrestricted.** The policy engine is what makes
increased autonomy safe: every widening of automatic authority is an explicit,
owner-ratified policy change, never a side effect. The implemented precedents
(executor profiles; orchestrator levels 1–3 with level 3 never auto-executing;
the automation track's approval matrix with owner-ratified O-* decisions) all
already follow this shape.

---

## 12. Secret security — Secret Broker PLANNED (Phase 5)

- Agents receive **only the credentials required for the specific task**,
  ideally scoped and short-lived.
- Credentials are injected by the broker at execution, never stored in task
  envelopes, prompts, memory, reports, or Git.
- Never expose or print credentials; redaction stays mandatory on every
  persisted or logged surface.
- No real secrets appear in documentation — including this document.

Implemented today (safe baseline, not yet a broker): 0600 env files outside
the repository, credential-by-reference in n8n, intake refusal of
secret-shaped payloads, shared redaction library.

---

## 13. Validation — PLANNED (Phase 3)

Every important agent result should eventually pass validation independent of
the agent that produced it:

```text
Agent
 ↓
Validator
 ├── correctness
 ├── tests
 ├── security
 ├── completeness
 └── policy
 ↓
PASS / REJECT
```

**Adversarial Reviewer** (X): instead of asking only "is this correct?", the
reviewer actively searches for regressions, security issues, edge cases,
hidden assumptions, incomplete implementation, and deployment problems. The
repository's own history motivates this: several stage records document
defects found only when a later pass actively tried to break the earlier
claim (e.g. the SYA-SHOP-1b layout defects invisible to the passing suites).

---

## 14. Event-driven automation — PLANNED (Phase 6)

Future typed events include:

```text
TASK_CREATED   TASK_STARTED   TASK_COMPLETED   TASK_FAILED
QUOTA_EXHAUSTED   PROVIDER_UNAVAILABLE
TEST_FAILED   TEST_PASSED   COMMIT_CREATED
DEPLOY_STARTED   DEPLOY_COMPLETED   ROLLBACK
IMAGE_APPROVED   STOCK_CHANGED   SCRAPE_COMPLETED   CAMPAIGN_FINISHED
```

Mythos should eventually be **reactive, not only command-driven**: events
trigger policy-permitted responses (a failed deploy triggers rollback and
diagnosis; a stock change triggers a catalog update mission) without an owner
command per occurrence — always inside policy limits (§11).

---

## 15. Self-improvement — CONCEPTUAL, roadmapped (Phase 7)

One of the central decisions. **The first version should be intentionally
small.** Once the Auto MVP is stable, Mythos itself should be able to execute
controlled development missions against its own repository:

```text
Mission
 ↓
Read current architecture
 ↓
Read memory
 ↓
Plan change
 ↓
Create isolated worktree
 ↓
Implement
 ↓
Test
 ↓
Review
 ↓
Policy check
 ↓
Commit
 ↓
Push
 ↓
Update memory
 ↓
Report
```

Hard rules:

- **The system must NEVER blindly modify itself and immediately trust its own
  changes.**
- Every self-improvement cycle requires tests, validation (ideally by a
  different agent than the author), Git checkpointing, and rollback
  capability.
- Self-improvement runs in isolated worktrees, never in the live checkout of
  the running system.
- Policy (§11) applies with the strictest lane: the runtime modifying its own
  policy/security layers is DENY / HUMAN CONTROL.

---

## 16. Mission example — ARCHITECTURAL FUTURE EXAMPLE, not an implemented capability

User: *"Create a professional advertisement for this product with a $5/day
budget for one day."*

Future Mythos behavior:

1. Read product data.
2. Read project memory and branding.
3. Inspect existing product images.
4. Determine required tools.
5. Generate the advertising visual using the available image-generation tool.
6. Validate the visual.
7. Generate advertising copy.
8. Determine campaign configuration.
9. Apply the project's advertising policy.
10. Create/publish the campaign if policy permits.
11. Budget = $5/day.
12. Duration = one day.
13. Record campaign ID/result.
14. Monitor according to policy.
15. Report.
16. Store the relevant decision/outcome in project memory.

Note that steps 9–10 are policy-gated (spending is CONTROLLED at minimum) and
step 16 closes the memory loop. Nothing in this example exists today.

---

## 17. Goal-oriented operation — CONCEPTUAL / FUTURE

Mythos should eventually understand:

> "Increase sales."

rather than requiring:

> "Create post." "Create image." "Create campaign." "Check stock."

Decomposition chain owned by the Goal Engine (A):

```text
GOAL
 ↓
OBJECTIVES
 ↓
MISSIONS
 ↓
TASKS
 ↓
AGENTS
 ↓
TOOLS
 ↓
RESULTS
 ↓
METRICS
 ↓
NEXT DECISION
```

Metrics close the loop: results are measured against the goal, and the next
decision (continue, adjust, stop, escalate to the owner) is made from
measurements, not assumptions.

### Agent evaluation (AB) — CONCEPTUAL / FUTURE (Phase 7)

Track historical performance by task category — coding, debugging, research,
review, deployment, scraping, marketing, etc. Selection should eventually use
historical quality, not just provider name: the router (M) consults the
reputation store when choosing an agent for a task type.

### Self-healing — CONCEPTUAL / FUTURE (Phase 6)

```text
Service failure
 ↓
Health check
 ↓
Diagnosis
 ↓
Repair agent
 ↓
Test
 ↓
Restart/redeploy
 ↓
Verify
 ↓
Report
```

Must include **bounded retry loops and policy limits** — a self-healing loop
that cannot give up is an outage amplifier. Repair actions are policy-classed
like any other action; irreversible ones stay under human control.

---

## 18. Roadmap

High-level phases. **No phase beyond Phase 1 is implemented.** Phase 0 is this
document; Phase 1 is the deployed executor.

| Phase | Name | Contents | Status |
|---|---|---|---|
| **0** | Documentation / architecture baseline | This master vision record | **THIS STAGE** |
| **1** | Auto MVP | Executor · n8n · Claude · queue · quota/resume · reports · Git | **IMPLEMENTED** (MYTHOS-AI-EXECUTOR-0, verified §2) |
| **2** | Orchestration Core | Mission Planner · Task Engine · DAG · Agent Registry · Tool Registry · Project Memory · Context Engine | PLANNED |
| **3** | Multi-Agent | parallel execution · worktrees · validator · reviewer | PLANNED |
| **4** | Multi-Provider | Gemini · additional providers · health · quota · fallback · routing · OmniRoute integration | PLANNED |
| **5** | Security / Governance | policy · secrets · sandbox · dry run · audit · rollback | PLANNED |
| **6** | Goal / Event System | Goal Engine · Event Engine · reactive automation · self-healing | PLANNED |
| **7** | Self-Improvement | controlled self-development · evaluation · organizational memory | CONCEPTUAL |
| **8** | Control Center | dashboard · mission/task/agent/provider monitoring · cost/quota/state visibility | DESIGNED (spec only) |

Phases build on each other; in particular, Phase 7 (self-improvement) is
deliberately gated behind validation (3), governance (5), and events (6).

---

## 19. Permanent design principles

1. GitHub is the source of truth.
2. Persistent VPS worktree is required.
3. Never depend on files on the user's computer.
4. Never leave completed work only in `/tmp`.
5. Every completed stage must be committed and pushed.
6. `docs/AI_HANDOVER.md` must record commit, remote HEAD, tests, and next stage.
7. Minimize token consumption.
8. Reuse verified analysis.
9. Run targeted tests first.
10. Full suite only when required.
11. Stop at a real blocker.
12. Never expose credentials.
13. Autonomous execution must be policy-controlled.
14. Agents must not blindly share writable worktrees.
15. Provider-independent memory.
16. Provider-independent architecture.
17. Future tools must be pluggable.
18. Implemented and planned functionality must always be clearly separated.

These principles are permanent: they bind every future phase, every agent,
and every provider, including the self-improvement engine when it exists.
