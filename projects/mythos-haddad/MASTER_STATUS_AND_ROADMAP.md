# MYTHOS HADDAD — MASTER STATUS & ROADMAP

> **Single entry point for the current state, architecture, decisions, roadmap, and next work.**
>
> Read this file first before working on Mythos Haddad.
>
> **Current main:** `d2fa93ac`
>
> **Core rule:** SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST.

---

## 1. CURRENT STATE — QUICK READ

### V1

**V1 is implemented and merged on main.**

Main capabilities:

- Local Qwen 2.5 7B Q4_K_M runtime on Haddad
- FABLE supervised execution loop
- GitHub task intake/Bridge
- multi-project isolation
- review gate
- bounded repair loop
- mechanical validation
- sandboxed tools including `write_file`
- delivery with git safety protections
- crash/retry/recovery mechanisms
- Haddad MCP over SSH-stdio
- resource/health monitoring
- 8192 context runtime
- real GitHub → Bridge → Qwen → validation → delivery E2E
- security probing and sandbox escape prevention

### Current hardware/runtime

- GPU: NVIDIA GTX 1660 SUPER, 6 GB
- Local model: Qwen2.5-7B-Instruct Q4_K_M
- Runtime: llama.cpp / Vulkan
- API: `127.0.0.1:8600`
- Context: 8192
- GPU layers: 27/29 with current 8192 configuration
- Typical observed inference: roughly 17–33 tok/s
- Qwen is the current practical local executor

### Current architecture

```
Internet
   ↓
VPS / Mythos
   ↓ secure connection / MCP
Haddad
   ├── FABLE / Worker
   ├── Qwen
   ├── Executor
   ├── GitHub Bridge
   ├── Validation / Repair / Review
   ├── Sandbox
   ├── MCP
   └── GPU / Runtime
```

---

# 2. ROLES

## FABLE

**Supervisor / orchestration authority.**

FABLE decides:

- what the task requires
- whether research is necessary
- what execution path to take
- whether validation passed
- whether repair/escalation is needed
- whether a task can advance

FABLE remains the final execution authority.

## Jev — FUTURE DECISION LAYER

Jev is **not an executor**.

Jev will eventually make three decisions:

### Jev #1 — Researcher selection

```
FABLE
 ↓
Jev
 ↓
choose from research_models[]
 ↓
Researcher
```

Jev determines the type/complexity of research and selects the most suitable available research model.

### Jev #2 — Research assessment

```
Research results
 ↓
Jev
 ↓
assessment_models[]
 ↓
structured assessment
 ↓
FABLE
```

Jev evaluates candidates against concrete requirements.

### Jev #3 — Executor selection

```
FABLE execution decision
 ↓
Jev
 ↓
execution_models[]
 ↓
best executor
 ↓
execution
```

Today this normally means Qwen. Later it can select among many models/agents.

---

# 3. JEV MODEL POOLS

The three pools must remain separate:

```
jev:
  research_models: [...]
  assessment_models: [...]
  execution_models: [...]
```

Example only:

```
research_models:
  - sonnet
  - opus

assessment_models:
  - sonnet
  - opus

execution_models:
  - qwen
  - sonnet
  - opus
  - future-model-x
```

The real lists must contain only models that are:

- installed or connected
- authorized
- healthy
- available for the role

Each model should expose structured metadata:

- capabilities / roles
- local vs API
- cost
- VRAM/RAM requirements
- speed / latency
- context capacity
- tool support
- coding/reasoning/research/architecture strengths
- hardware compatibility
- availability/health
- safety/permission constraints

Adding a model should mean registering it and placing it in the appropriate pools — **not rewriting FABLE or Jev**.

---

# 4. COMPLETE TARGET FLOW

```
                    FABLE
                      │
                      ▼
                 JEV #1
          choose researcher/strategy
                      │
                      ▼
              RESEARCH MODEL
                      │
                search/evidence
                      │
                      ▼
                 JEV #2
          assess + score candidates
                      │
                      ▼
                    FABLE
             execution decision
                      │
                      ▼
                 JEV #3
              choose executor
                      │
                      ▼
           Qwen / Sonnet / Opus /
              future model
                      │
                      ▼
              Execute in sandbox
                      │
                      ▼
          Mechanical validation
                      │
              ┌───────┴───────┐
              │               │
             PASS            FAIL
              │               │
              ▼               ▼
           Review          Repair loop
              │               │
              └───────┬───────┘
                      ▼
                  Delivery
                      │
                    Report
```

---

# 5. RESEARCH POLICY

For substantial work:

**SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST**

Research is not a generic popularity ranking.

Candidates should be evaluated against the actual task:

- repository/project
- license
- maintenance/activity
- architecture
- dependencies
- Mythos/Haddad compatibility
- security implications
- expected reuse percentage
- adaptation effort
- integration cost
- risks
- hardware fit
- free/open status where relevant

FABLE receives the assessment and makes the execution decision.

---

# 6. MODEL ESCALATION

### Simple task

```
Qwen directly
```

### Reuse/integration research

```
Jev → research_models[]
```

Usually Sonnet when sufficient.

### Architecture/security/complex integration

Use a higher-capability researcher/assessor when required, potentially Opus.

### Execution

```
Jev → execution_models[]
```

Today: Qwen.

Future: multiple local/API/specialist models.

### Goal

Minimize Claude token usage while selecting the right capability for each stage.

---

# 7. V2 ROADMAP

## V2.1 — AI Team Foundation

Create the model/agent capability foundation:

- worker roles
- capability registry
- model registry
- FABLE delegation contracts
- clear boundaries between supervisor, researcher, reviewer and executor
- prepare interfaces for future Jev

**Gate:** capabilities + tests + real E2E.

## V2.2 — FABLE Task Delegation

FABLE should be able to:

- decompose work
- delegate subtasks
- choose execution paths
- coordinate workers
- collect results
- retry/repair
- escalate when necessary

**Gate:** multi-step real task with independent subtasks.

## V2.3 — Parallel Workers + Resource Awareness

Enable:

- parallel independent tasks
- resource-aware scheduling
- GPU/VRAM/RAM awareness
- no resource overcommit
- waiting tasks not holding execution slots

**Gate:** concurrent real workloads with resource pressure.

## V2.4 — OTHKM Integration

Connect the existing knowledge/memory systems.

Reuse existing OTHKM.

Do not build a second memory system.

**Gate:** real task retrieves and uses persistent knowledge correctly.

## V2.5 — AI Team Console

Expand the Live Console at:

`status.mythosprod.xyz`

Show:

- FABLE
- workers
- models
- current tasks
- phases
- validation
- review
- GPU
- VRAM
- CPU/RAM/swap/disk
- runtime
- incidents
- activity stream
- historical metrics where existing persistence supports them

Read-only observability first.

Reuse existing VPS MCP + Haddad MCP + health/event infrastructure.

## V2.6 — Autonomous Continuous Operation

Target:

```
Task
 ↓
Research if needed
 ↓
Decision
 ↓
Model selection
 ↓
Execution
 ↓
Validation
 ↓
Repair
 ↓
Review
 ↓
Delivery
 ↓
Next task
```

The worker should continue without requiring Claude for routine work.

Claude becomes escalation/supervision capacity rather than a permanent execution dependency.

**Gate:** long-running unattended operation with recovery and no unsafe bypass.

---

# 8. QWEN CAPABILITY LADDER

Do not promote Qwen because it says it succeeded.

Every level requires evidence:

- actual tool calls
- actual file changes
- scope checks
- mechanical validation
- tests
- review
- delivery evidence
- correct report

Known Qwen limitation demonstrated during V1:

- can invent APIs or modify tests instead of implementing the requested fix
- therefore mechanical validation and scope enforcement are mandatory
- Qwen is not the sole authority for security/architecture/high-risk decisions

---

# 9. CURRENT SAFETY MODEL

The execution boundary is layered:

1. FABLE/task policy
2. executor state machine
3. task/worktree isolation
4. Haddad agent tool policy
5. bubblewrap sandbox
6. workspace-only writes
7. no network from sandbox
8. no host credentials
9. mechanical validation
10. scope checks
11. delivery git hardening
12. review gate

A real sandbox escape through git hooks was discovered after merge and closed.

The model must never be trusted merely because it reports success.

---

# 10. MCP

Haddad MCP V1 is implemented.

Current concept:

```
VPS services
   ↕
VPS MCP / Gateway

Haddad services
   ↕
Haddad MCP
```

Haddad MCP uses SSH-stdio.

No public Haddad MCP listener was added.

Existing MCP infrastructure must be reused.

HAD-1 knowledge integration remains future work.

---

# 11. LIVE CONSOLE

The Live Console is a parallel workstream.

Target:

`status.mythosprod.xyz`

Concept:

```
Status Center
 ↓
VPS Status API
 ↓
VPS MCP / Gateway
 ↓
Haddad MCP
 ↓
Haddad
```

It should expose real observability, not fake production data.

Important signals:

- online/degraded/busy/waiting/offline
- current task
- model
- phase
- attempt
- validation/review
- GPU/VRAM
- runtime
- worker
- bridge
- resource guard
- task counts
- incidents
- heartbeat
- recovery

No arbitrary shell/restart/config actions in the initial console.

---

# 12. WHAT ALREADY EXISTS — DO NOT REBUILD

Reuse existing Mythos components.

Do **not** create duplicate:

- task queue
- scheduler
- DAG engine
- executor
- provider system
- validation system
- review system
- retry system
- state machine
- fencing/idempotency
- GitHub Bridge
- MCP
- knowledge/memory system
- compaction system
- model registry
- monitoring stack
- delivery/worktree system
- resource/OOM/session system
- health system
- GPU tooling
- delegation infrastructure

Use:

**SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST**

---

# 13. CURRENT DEFERRED ITEMS / RISKS

These are not reasons to restart V1; they are the remaining hardening/roadmap items:

- resource guard is not fully wired into every Haddad execution decision
- production worktree cleanup must remain controlled to prevent long-run disk growth
- health should verify worker/bridge/resource guard, not only basic services
- reboot recovery should be exercised
- DeviceLost/socket-hangup classifier has code/tests; additional long-run live evidence is still useful
- no sandbox cgroup CPU/memory limit yet
- systemd confinement was relaxed so unprivileged bwrap can work; bwrap remains the primary model boundary
- approved continuation dependency-release E2E was tested but not fully witnessed live in the final proof
- OTHKM knowledge tools are not yet configured on Haddad
- Haddad→VPS SSH execution path is intentionally not established
- Jev is not installed/integrated yet
- additional local models are not installed merely for quantity

These should be handled by explicit gates, not by duplicating infrastructure.

---

# 14. FUTURE MODEL DISCOVERY

When the model library expands, use:

```
DISCOVER
   ↓
VERIFY
   ↓
BENCHMARK
   ↓
SECURITY REVIEW
   ↓
ACCEPT / REJECT
```

Evaluate:

- free vs paid API
- open weights/source
- license
- VRAM/RAM
- speed
- CUDA/Vulkan/CPU compatibility
- context
- coding/reasoning quality
- GGUF/llama.cpp support
- quantization
- commercial-use constraints
- maintenance/activity
- benchmark on Haddad

Do not install models just because they are popular.

Jev can later help choose which research strategy/model to use for this discovery.

---

# 15. JEV BOUNDARIES

Jev must remain a decision layer.

It must have:

- no direct execution authority
- no arbitrary shell access
- no direct repository mutation
- no bypass of FABLE safety gates
- structured outputs
- confidence/decision information
- fallback when unavailable
- fallback when low-confidence
- timeout handling
- hard restriction to configured model pools

Jev cannot select a model outside the authorized pool for the current stage.

---

# 16. CURRENT PRIORITY ORDER

When V2 execution begins:

1. Read this file.
2. Audit current main and reuse map.
3. Complete/verify Live Console in parallel.
4. Produce/verify the V2 master execution plan.
5. V2.1 → Gate
6. V2.2 → Gate
7. V2.3 → Gate
8. V2.4 → Gate
9. V2.5 → Gate
10. V2.6 → Gate
11. Jev integration only through an explicit gate when ready.
12. Expand model library only after discovery/benchmark/security gates.

No phase advances because of elapsed time.

---

# 17. ONE-PAGE MENTAL MODEL

```
                    MYTHOS
                       │
                     FABLE
                       │
          ┌────────────┼────────────┐
          │            │            │
       Research     Decision     Execution
          │            │            │
         JEV          FABLE         JEV
          │                         │
    research_models[]         execution_models[]
          │                         │
      Researcher                 Worker
          │                         │
         JEV                        │
     assessment_models[]            │
          │                         │
          └──────────→ FABLE ←──────┘
                       │
                Validation/Review
                       │
                    Delivery
                       │
                    GitHub
                       │
               Status / Console
```

### The fundamental division

**FABLE = manages and decides**

**Jev = selects and evaluates**

**Models = perform specialized work**

**Qwen = current local hands**

**Haddad = local compute**

**GitHub = durable task/history layer**

**MCP = communication boundary**

**Validation = truth**

**Status Center = observability**

**SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST = engineering rule**

---

## 18. SOURCE OF TRUTH

For future agents:

**Read this file first.**

Then, when implementation details are needed, read:

- `projects/mythos-haddad/STATUS.md`
- `projects/mythos-haddad/ARCHITECTURE_REUSE_STATUS.md`
- `projects/mythos-haddad/docs/`
- relevant implementation/tests
- GitHub issues/PRs referenced by the current task

This document is the **high-level navigation and architecture source**, while STATUS and implementation docs remain the detailed operational sources.

Last consolidated: 2026-09-22.
