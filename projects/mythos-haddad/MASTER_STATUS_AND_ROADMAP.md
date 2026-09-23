# MYTHOS HADDAD — MASTER STATUS & ROADMAP

> **Single entry point for the current state, architecture, decisions, roadmap, and next work.**
>
> Read this file first before working on Mythos Haddad.
>
> **Current main:** `d79de7f57ffb30c0d084beaa4f271a36d9be5d59`
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

### V2.1 — what it turned out to be

The audit that opened V2 found the answer before the work started: **the AI
team substrate already exists and was switched off.** `core/agent-registry.js`
already catalogs agents by capability with probed availability;
`core/provider-router.js` already chooses one and already refuses a fallback
that would change execution authority; `core/validation.js` already refuses a
reviewer that is the author, and already gates who may review a *sensitive*
change; `lib/policy.js` already maps the three execution profiles to exact
tool grants; `bridge/action-resolution.js` already maps the closed action set
to those profiles. None of that was built again.

So V2.1 is a **CONNECT** stage. What it added, in full: one entry in
`config/agents.json` (`haddad-qwen`), a `config/roles.json` table of six
roles, and `lib/roles.js` to validate and resolve it. What it wired: the
registry now probes the local runtime; the executor derives a role from the
action and selects the skill pack through it; the Haddad runner renders the
role's brief under its tool grant; `report.json` keeps what the provider
**measured** beside what the model **claimed**.

Roles are `(action, task_type, capabilities_required, skill_category, brief)`.
The execution profile is **derived** from the action, never stored on the
role — a role that names a profile is refused by the validator in
`lib/roles.js`, because a second action→profile table is exactly the drift
this stage exists to avoid.

Detail, evidence and every finding from the live runs:
[docs/AI_TEAM.md](docs/AI_TEAM.md).

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

**Implementation:** DONE / VERIFIED and merged as PR #390 (`af486687`).

Live at:

`https://status.mythosprod.xyz/haddad/`

and exposed as an **MYTHOS AI nodes** card on the Status Center front page.

### Architecture

Haddad does **not** have a VPS→Haddad inbound path. Continuous telemetry therefore uses:

```
Haddad telemetry agent
   ↓ HTTPS POST
Public HTTPS / nginx
   ↓
loopback ingest receiver
   ↓
signature verification + allow-list
   ↓
derived Haddad state
   ↓
Status Center
```

The agent signs each payload with an Ed25519 private key generated on Haddad. The private key never leaves Haddad; the VPS stores the public key.

Haddad opens no inbound port for telemetry.

Haddad MCP remains the interface for interactive sessions; telemetry is the interface for continuous observation.

### Verified capabilities

- real signed telemetry
- real public HTTPS ingest
- online/degraded/offline state
- heartbeat decay
- recovery
- state transition recording
- browser-side stale/frozen-file override
- deregistration removal
- truthful N/A metrics
- no fake zero values
- bounded history
- no-secret allow-list
- real task visibility
- GPU/runtime information where a real source exists

The production E2E proved:

- real agent → real public POST → HTTP 202
- stopped beats → DEGRADED at 36s → OFFLINE at 51s
- resumed beats → recovery in under one second
- stopped receiver → browser recomputed OFFLINE from frozen data
- deregistered node → removed from page

### Measured overhead

- approximately 0.32 CPU-seconds per beat
- approximately 68 MB peak for a short beat process
- approximately 2.4 KB per beat on the wire
- approximately 3.2% of one CPU core during the measured beat
- bounded history approximately 11.9 MB/node/month

### Setup-safety fix — `HADDAD_MCP_REPO` (2026-09-22, after #390)

PR #390 fixed `HADDAD_MCP_REPO` in the telemetry **agent** but not in the telemetry
**setup script** — and the setup script is the half that matters, because it is what
substitutes a path into the unit's `ExecStart`. An operator with that variable exported
(it is routinely exported while re-pointing the MCP launcher) would have installed a
telemetry unit pinned to whatever tree the MCP work was using. A unit pinned to a linked
worktree dies silently the day the worktree is removed: the timer keeps firing and every
beat fails to start.

Closed mechanically, not by convention:

- neither the agent nor the setup script reads `HADDAD_MCP_REPO`; both use
  `HADDAD_TELEMETRY_REPO`, defaulting to the tree they were run from
- the setup **refuses** a linked git worktree as a deployment target unless
  `HADDAD_TELEMETRY_REPO` is set deliberately (`.git` as a file vs a directory — an exact
  test, not a heuristic)
- it validates and dry-runs **the agent the unit will execute**, not the copy beside the
  script, so "collection OK" describes what will actually run
- after generating the units it greps the result for that path and fails if absent
- `ExecStart pinned to <path>` is printed, so the pinned path is visible without
  `systemctl cat`

Proven by running the real installer with a decoy `HADDAD_MCP_REPO` exported into a
throwaway HOME: the decoy appears nowhere in the generated unit, `ExecStart` resolves to
the production checkout, and nothing was written to the real `~/.config/mythos-haddad/`
or `~/.config/systemd/user/`.

### Tests / regression

- `haddad-ingest`: 130/0
- `haddad-telemetry`: **139/2** — 11 new assertions in §11 (`HADDAD_MCP_REPO` cannot
  redirect the installed unit; the installer is *run* with a decoy rather than
  source-grepped; linked worktree refused; key mode 0600; no secret in the config).
  The 2 failures are **ENVIRONMENTAL and pre-existing**: §2 asserts GPU-absence wording
  on a host with no such GPU, and Haddad has an NVIDIA/nouveau GPU. Identical 2 failures
  on clean `main` (128/2 before this change).
- STC-1: 81/0 after fixing the pre-existing failure
- monitor-coverage: 40/0
- gateway-boundary: 37/0
- mcp-ecosystem: 168/0
- guardian: 597/0

### Telemetry ACTIVATED (2026-09-22, owner-approved)

**Haddad is beating.** `mythos-haddad-telemetry.timer` is `enabled`/`active` (10 s heartbeat).
The public key generated on Haddad is registered on the VPS and verified loadable by the
receiver itself, not merely written to a file. Sequence run: primary checkout (`dfcf3c91`, not
a worktree) → setup script → public key sent to the VPS session over cross-session message →
registered → timer enabled locally.

**End-to-end, verified against the real public artifact
(`https://status.mythosprod.xyz/data/haddad-node.json`), not a local dry-run:**

| Check | Result |
|---|---|
| Setup on the real host | PASS — key `0600`, config carries no secret, `ExecStart` pinned to `/home/othman/projects/mythos-prod` |
| Key registration | PASS — confirmed independently by the VPS session (loadable by the receiver, unsigned POSTs still 401) |
| Timer | ACTIVE — `enabled`/`active`, beats every 10 s (`journalctl` shows 10 consecutive `HTTP 202` beats before this was even written) |
| Real heartbeat | PASS — `sent_at` **20:21:41.141Z → 20:22:05.129Z** (24 s, >2 intervals), `seq` **1790108501 → 1790108525**, both fetched directly from the public JSON, not the agent's own log |
| Console state | **ONLINE** (`summary.ONLINE: 1`, `state: "ONLINE"`, `age_s: 0`), page `HTTP 200` at `/haddad/` |
| Secret exposure | PASS — full byte-scan of the actual public payload: no API key, private key, PEM body, SSH credential, bearer token, or `.env`/key file path. One false-positive substring (`tokens_per_s`, value `null`) |
| Task view (the earlier `HADDAD_MCP_REPO`-adjacent fix) | PASS on the real host: `task_counts {"BLOCKED":16,"COMPLETED":25,"FAILED":5}` = 46, `current_task.task_id` = a real, in-flight task id |
| Public-page authentication | **untouched**, as instructed — still open, still public |

**Two NEW real defects found during this activation, reported to the VPS session, NOT fixed
here** (Live Console code is out of scope for an activation task; both are cosmetic — the
heartbeat, state, task view and security boundary are correct without them):

1. `runtime.gpu_layers` / `runtime.vram_model_mib` publish `null` instead of `27`/`29`/`3884`.
   Root cause isolated exactly: the agent reads the last 600 journal lines to find the
   load-time facts, but the runtime has been up since `2026-09-22 15:43:17` and the
   offload/buffer-size lines are now **6,094 lines past** a 600-line tail (40,473 total lines
   in the unit's full journal). Confirmed the fix direction: scoping to `--since` the unit's
   own `ActiveEnterTimestamp` instead of a fixed line count drops the read to 6,238 lines with
   the target block at the very start — sufficient on its own, no regex changes needed.
2. `gpu.model` publishes `null` instead of the device name. `out.model = gpuCheck.data.device
   || …` (line 268) assigns the whole device **object**
   (`{name, vendor_id, device_id, type, vulkan_api}`) rather than `device.name` — a type bug,
   not a missing value. The receiver appears to defensively drop the malformed object before
   publishing rather than exposing it raw, which contained the bug but means the model name is
   silently absent from the page.

Sent to the VPS session with exact journal excerpts, line counts, and a recommendation on the
open `vram_model_mib` question (publish `3884` — the `Vulkan0 model buffer size` line alone,
matching the field's own name — not `4920`, which is `llama_params_fit_impl`'s upfront total
device-memory projection, a different quantity).

### Live Console remaining gates

**DONE / VERIFIED:** receiver, ingest, console/card, signed telemetry, offline detection, recovery, stale-file override, refusals, secret allow-list, measured cost, bounded history, tests, regression, merge and deployment, **live activation, real end-to-end heartbeat**.

**DEFERRED:**
- historical charts
- notifications
- rolling `tokens_per_s` source
- fleet scheduling

**RESOLVED same day (PR #392 `574e09a9`).** `runtime.gpu_layers`/`vram_model_mib` and
`gpu.model`/`gpu.driver` all publish real values now — re-verified directly against the live
public payload after a plain `git pull` on the primary checkout (no restart, no
re-registration; the timer picked up the fix on its next beat): `27 / 29`, `3884`,
`NVIDIA GeForce GTX 1660 SUPER (NVK TU116)`, `Vulkan 1.4.335 / nouveau`. A new
`runtime.vram_projected_mib` (`4920`) field was added alongside `vram_model_mib`, labelled as
an estimate rather than folded into the measured figure. Full account, including why both
defects were invisible from reading the code, in `docs/TELEMETRY.md` §10b.

**OWNER GATES:**
1. ~~Haddad is not currently beating~~ **RESOLVED — Haddad is beating, activated 2026-09-22.**
2. The console page is currently public. TLS/noindex/robots controls exist, but the page is not authenticated. Because it exposes structured task identity/event information, authentication/privacy is an owner decision. **Still deliberately not decided.**
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
- Live Console telemetry is implemented but Haddad heartbeat is intentionally not enabled until explicit owner approval
- Live Console authentication/privacy remains an owner decision
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

Last consolidated: 2026-09-22. Live Console PR #390 and production verification incorporated.
