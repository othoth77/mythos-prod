# Mythos Haddad V2 — Master Plan

> **Status: EXECUTING.** Produced by a read-only audit of `main@d2fa93ac` on 2026-09-22;
> the owner ordered full autonomous V2 execution the same day (FABLE supervisor session).
> The plan body below is the audit as written; the per-phase gate records live in
> **§23 (execution log)** at the end of this file and are the only place a phase is
> called done. V2.1 record: [AI_TEAM.md](AI_TEAM.md).
>
> Every number here is measured on this host or read from current code. Where something is
> not measured, it says so and names the measurement that must be taken before the gate opens.

---

## 0. The finding that reframes V2

**The AI-team substrate already exists and is switched off.**

`projects/mythos-ai-executor/core/` is 8,347 lines implementing, today:

| Module | Lines | What it already does |
|---|---|---|
| `agent-registry.js` | 181 | capability-driven agent catalog, probed availability, `selectCandidates()` ranking by risk then cost |
| `provider-router.js` | 132 | chooses an agent from capability + availability + quota + reputation; fallback may never change execution authority |
| `planner.js` / `decompose.js` | 254 / 457 | mission → task graph, task types, plan validation |
| `dag.js` | 146 | `readyTasks`, `doomedTasks`, dependency assessment |
| `scheduler.js` | 557 | bounded-concurrency mission runner, `HARD_MAX_PARALLEL = 8` |
| `memory.js` / `context.js` | 132 / 162 | durable project memory (supersede, never erase; refuses secrets) + per-task context assembly |
| `events.js` / `store.js` | 101 / 195 | emit/subscribe/replay, entity store |
| `policy-engine.js` / `unattended.js` | 212 / 128 | approval requests/decisions; deterministic unattended answers that may only ever **deny** |
| `reputation.js` | 65 | per-capability outcome stats, tiebreak only, needs `MIN_EVIDENCE` |
| `budget.js` / `campaign*.js` | 3,246 | spend accounting and long-running campaign services |
| `worktrees.js` | 119 | worktree create/remove/list/isDirty |

**And on Haddad it is all inert:**

```
~/.config/mythos-haddad/worker.env
  MYTHOS_CORE_ENABLED=false      ← the entire core is off
  MYTHOS_MAX_PARALLEL=1          ← one task at a time
```

Verified by tracing requires: `executor.js` references `core/` **zero** times.
`bridge/github-bridge.js` references it **once** (the review-gate adapter added in #358).

So there are two disjoint paths in one repository:

```
PATH A — orchestration core (VPS, HTTP, currently OFF on Haddad)
  server.js → core-wiring → planner/decompose → dag → scheduler
            → provider-router → agent-registry → validation → orchestrator repair loop
            → memory / context / events / budget / policy-engine

PATH B — Haddad worker (LIVE, what V1 shipped)
  github-bridge tick → executor.js → providers/haddad-agent.js (Qwen in bwrap)
            → lib/work-validation.js → review-gate → GitHub
```

Path A has the team. Path B has the worker. **Neither has the other.**

### Consequence for this plan

V2 is overwhelmingly a **CONNECT** problem, not a BUILD problem. The single largest risk to V2
is not missing capability — it is building a second copy of something in `core/` because it was
off and therefore invisible.

> **Standing rule for V2: before writing any new module, grep `core/` first.**
> If V2 produces a new scheduler, registry, router, memory, event bus or approval engine, the
> plan has failed regardless of whether the tests pass.

---

## 1. Current V1 baseline (what exists, verified)

**Merged on `main@d2fa93ac`:** #365 `ae95857f`, #384 `6f8ed330`, #368 `10c8847d`,
#385 `1d1fc4dd`, #366 `5a3b92ca`, #387 `ac0e068a`, #388 `d2fa93ac`.

| Capability | State | Evidence |
|---|---|---|
| Local model runtime | Qwen2.5-7B-Q4_K_M, ctx 8192, 27/29 GPU layers | live argv + llama-server accounting |
| Qwen as executor | `providers/haddad-agent.js`, tools read/list/write/run | E2E: commit `e38c8d53` |
| Sandbox | per-command bwrap; `.git` read-only; `$HOME`/`/etc`/creds unmounted | 14-case probe, tests U1/U2/U2b/U3 |
| Mechanical validation | `lib/work-validation.js` re-runs declared checks, measures workspace | supervised-loop 25/0 |
| Bounded repair | 3 executions max, compact briefs, per-execution budgets | test B3 |
| Escalation | Sonnet **diagnosis-only**, last round, env-gated | test B8 |
| Review gate | `bridge/review-gate.js` → `core/validation.js` review policy | review-policy 99/0 |
| Multi-project isolation | continuation lineage, dependency-by-continuation | multi-project 73/0 |
| Delivery | `deliverValidatedWork`, validator-measured files only, hooks disabled | tests B10/B10b/U3 |
| MCP | 9 read-only tools over SSH-stdio incl. `haddad_health` | mcp 17/0, live probe |
| Resource guard | RAM only (MemAvailable, PSI, oom_kill) | `lib/resource-guard.js` |

**V1 is an AI WORKER: one model, one task at a time, supervised by code.**

### The eight honest gaps V1 leaves

1. `MYTHOS_CORE_ENABLED=false` — no planner, no registry, no router, no memory.
2. **Qwen is not in `config/agents.json`** — capability-driven selection literally cannot choose it.
3. `MYTHOS_MAX_PARALLEL=1` — no concurrency.
4. Resource guard has **no VRAM/GPU model** at all.
5. No OTHKM store on Haddad (`~/.local/state/oth-knowledge` does not exist); MCP knowledge tools fail closed as UNCONFIGURED.
6. Roles (coder/tester/reviewer) exist only implicitly as execution profiles.
7. Dependency release by an approved continuation: implemented and tested, **never observed live**.
8. Delivery commits locally and **never pushes** — the branch→PR step is still manual.

---

## 2. V2 objective and the honest definition of "AI Team"

**V1 = AI WORKER → V2 = AI TEAM → V3 = SEMI-AUTONOMOUS MYTHOS.**

"AI Team" here means: *several roles, drawn from one local model, selected by a supervisor
from declared capability, executing concurrently within measured resource limits, sharing
project memory.* It does **not** mean several models, several runtimes, or agents that talk
to each other. There is no agent-to-agent protocol in this plan and none is needed.

---

## 3. Component responsibilities (§4 of the brief, answered)

| Component | Responsibility in V2 | Explicitly NOT |
|---|---|---|
| **Qwen** | all local execution: code, tests, debugging, inspection, repair, research-with-tools | never decides its own authority, never a reviewer of its own work |
| **FABLE** (Opus/Sonnet as supervisor *of the plan*, plus `core/` as supervisor *of the run*) | task understanding, planning, skill+role+model selection, escalation policy, gate decisions | not an executor; does not write task code |
| **existing executor** (`executor.js`) | process lifecycle, attempt state, retry/fencing, delivery commit, reporting | must not grow a second scheduler |
| **GitHub Bridge** | Issue intake, labels, dependency grammar, idempotency, control commits, report-out | must not grow planning logic |
| **`core/` orchestration** | registry, routing, DAG, scheduling, memory, context, events, approvals | — |
| **OTHSKILS** (`lib/skills.js`, `skills/*.md`, `skill-trust.js`) | role-shaped instruction packs injected into the prompt, trust-gated | not a code-execution mechanism |
| **OTHKM** (`lib/knowledge.js` → `projects/oth-knowledge`) | read-only knowledge retrieval with provenance; `core/memory.js` for durable project lessons | never a second memory system |
| **Status Center** | observation only — consumes `haddad_health` MCP + events | never a control plane |
| **VPS** | knowledge master, Status Center, estate MCP, long-horizon campaigns | not Qwen execution |
| **Haddad** | GPU inference, sandboxed execution, local validation, delivery | not the knowledge master |
| **Sonnet** | diagnosis, moderate reasoning, ambiguity resolution — **advisory only** | never an executor |
| **Opus** | architecture, security-boundary review, gate sign-off | never an executor |
| **Never Claude at all** | routine coding/testing/debugging/repair/inspection inside a task | — |

---

## 4. Qwen role — bounds checked against V1 (§5 of the brief)

| Qwen SHOULD | V1 state |
|---|---|
| coding, testing, debugging, file inspection, implementation, local analysis, repair, bounded execution | **PRESENT** |
| validation preparation | **PRESENT** (validator runs checks Qwen declares) |
| research with tools | **PARTIAL** — no network in sandbox by design; research = repo-local only |

| Qwen SHOULD NOT | V1 enforcement | Gap? |
|---|---|---|
| high-impact architecture decisions | no mechanism — Qwen is only given a task | none needed |
| change security boundary | bwrap argv built by the provider, not the model | **enforced** |
| change supervisor policy | policy files outside workspace, unmounted | **enforced** |
| bypass the validator | validator runs out-of-band, in the executor | **enforced** |
| modify task state directly | state store outside workspace | **enforced** |
| self-select authority | `EXEC_WORKER_PROVIDER_ALLOWED=['haddad-agent']`, profile from task | **enforced** |
| reach secrets | `$HOME`, `/etc`, key files unmounted (ENOENT, not denied) | **enforced** |
| unauthorised network | `--unshare-all`; DNS `EAI_AGAIN`, connect `ECONNREFUSED` | **enforced** |
| merge production | no push path; delivery commits locally only | **enforced** |
| disable safeguards | `.git` read-only; `core.hooksPath=/dev/null` on delivery | **enforced (#387)** |

**Result: the Qwen boundary is materially complete in V1.** One V2 requirement falls out:

- **V2-REQ-Q1:** if V2 ever grants Qwen network access for research, it must be an explicit,
  per-task, allow-listed egress — not removal of `--unshare-all`. Opus review required.

---

## 5. FABLE pipeline — what exists, what is missing

```
INPUT              GitHub Issue / OTHMODE        EXISTS  bridge/github-issues.js
TASK UNDERSTANDING parse grammar, action, deps   EXISTS  bridge/action-resolution.js
PLANNING           mission → task DAG            EXISTS  core/planner.js + decompose.js   [OFF]
SKILL SELECTION    pick instruction pack         PARTIAL lib/skills.js exists, not wired to Haddad
WORKER SELECTION   pick role/agent by capability EXISTS  core/agent-registry.js           [OFF, Qwen absent]
MODEL SELECTION    pick provider + fallback      EXISTS  core/provider-router.js          [OFF]
EXECUTION          Qwen in bwrap                 EXISTS  providers/haddad-agent.js
VALIDATION         re-run checks, measure        EXISTS  lib/work-validation.js
REPAIR             bounded loop + diagnosis      EXISTS  haddad-agent settleOrRepair
REVIEW             fail-closed review policy     EXISTS  bridge/review-gate.js + core/validation.js
DELIVERY           commit measured files         EXISTS  executor.deliverValidatedWork
REPORT             Issue comment + report.json   EXISTS  lib/report.js + bridge
```

**Missing is wiring, not machinery.** Three real gaps: Qwen absent from the registry; skills not
injected into the Haddad prompt; core switched off.

---

## 6. Worker model — roles without new runtimes (§7)

Roles are **not** processes and **not** models. A role is a tuple over the existing vocabulary:

```
ROLE = (task_type, capabilities[], execution_profile, skill_pack, review_scope)
```

Every element already exists:

| Role | task_type | execution_profile | skill pack | may deliver? |
|---|---|---|---|---|
| CODER | `coding` | `repo-write` | `generic.md` / `frontend.md` | yes (commit) |
| TESTER | `testing` | `repo-test` | `testing.md` | no (report) |
| REVIEWER | `review` | `repo-read` | `github-review.md` | no (verdict) |
| DEBUGGER | `coding` | `repo-write` | `generic.md` + diagnosis | yes |
| RESEARCHER | `research` | `repo-read` | `generic.md` | no (report) |

One llama-server, one provider, five roles — the resource cost of a role is a prompt and a
tool grant, not a process. `lib/policy.js` already implements `repo-read`/`repo-test`/`repo-write`
with distinct tool grants, and `repo-test` exists precisely because a tester needs `node` but not
`Write`. That is the role model, already built.

**REVIEWER is the one to watch:** `core/validation.js` already forbids author == reviewer. A
Qwen-reviewer reviewing Qwen-coder work is the same model but must still be a different *attempt
identity*, and its verdict must never be the only gate on a sensitive change.

---

## 7. Resource model — measured, and it is the binding constraint (§21)

**Hardware:** GTX 1660 SUPER 6 GB (6400 MiB usable), ~8 GB RAM (7346 MiB total), 12 CPUs.

**Measured runtime state at `--ctx-size 8192`:**

```
n_parallel = 4 (auto), kv_unified = true, n_seq_max = 4
4 slots, each advertising n_ctx = 8192
Vulkan0 model 3883.68 MiB + KV 416.00 MiB + compute 304.00 MiB  = 4603.68 MiB on card
CPU_Mapped model 576.77 MiB + CPU KV 32.00 MiB                  = 608.77 MiB in host RAM
llama_params_fit: projected 4920 MiB of 5752 MiB free
27/29 layers on GPU; process RSS ~2.1 GiB
generation 17–33 tok/s (17.0 sustained), prompt 21–35 tok/s
```

### The trap, stated plainly

`n_parallel = 4` does **not** mean four concurrent Haddad tasks. `kv_unified = true` means the
four slots **share one 8192-token KV pool**, which is why KV is 416 MiB and not 4×416. A
supervised Haddad task costs ~1,900 tokens of instruction before it reads a file, and a repair
brief grows it. Four concurrent supervised tasks cannot fit in 8192 shared tokens.

> **V2-REQ-R1 (gate blocker for V2.3):** `MAX_PARALLEL` for Qwen must be derived from a
> measurement of *real supervised tasks running concurrently*, not from `n_parallel`. Expected
> answer is **1–2**; the plan does not assume 2 without evidence.

Options to raise it, each with a cost that must be measured before adoption:

| Option | Cost | Verdict |
|---|---|---|
| raise `--ctx-size` to 16384 | +448 MiB KV, more layers to CPU, slower | measure first; likely rejected on a 6 GB card |
| `kv_unified = false` + per-slot ctx | KV × slots — will not fit | rejected on measurement |
| second smaller model for TESTER/REVIEWER | +VRAM for a second model | **defer to V3** |
| serialise GPU, parallelise non-GPU (validation, git, checks) | free | **adopt in V2.3** |

**The realistic V2.3 win is not concurrent inference — it is overlapping one inference with the
validation, checks and git work of another task.** That is honest concurrency on this hardware.

### RAM headroom

Runtime RSS ~2.1 GiB + worker + bridge + interactive sessions against 7.3 GiB total, and the
runtime unit already carries `MemoryMax=6G`. Resource guard's CRITICAL floor is 700 MiB
MemAvailable. **V2-REQ-R2:** resource guard must gain a GPU/VRAM signal before V2.3 admits a
second concurrent GPU task; today it would admit on RAM alone while VRAM is exhausted.

---

## 8. Model escalation policy (§14)

| Level | Who | Trigger | Budget |
|---|---|---|---|
| **L0** | Qwen local | every task by default | unlimited |
| **L1** | Qwen repair | validator rejected attempt N | 3 executions total (existing bound) |
| **L2** | **Sonnet, diagnosis-only** | last repair round AND `HADDAD_AGENT_DIAGNOSER` set | 1 call/task, no tools, advisory text only |
| **L3** | **Opus** | architecture change, security boundary, gate sign-off, NEW regression class | human-initiated only |

Rules, all already enforceable by existing code:

- Claude is **never** the default executor: `EXEC_WORKER_PROVIDER_ALLOWED = ['haddad-agent']`.
- Sonnet at L2 has **no tools** and cannot write — it returns a diagnosis string.
- L3 is never entered automatically. An autonomous loop may **stop and ask**, never escalate itself.
- Target: **minimum Claude tokens.** L2 is one call on the last round of a failing task, not a step.

---

## 9. Autonomy classification (§13, §20) — no fake autonomy

| Class | Operations | Mechanism today |
|---|---|---|
| **AUTONOMOUS NOW** | read, inspect, run declared checks, bounded code change in a task worktree, repair, mechanical validation, local delivery commit, report | V1 shipped |
| **SUPERVISED** | role selection, model selection, retry/fallback, dependency release | `core/` once enabled |
| **HUMAN-GATED** | merge to `main`, push, PR creation, production config, credentials, destructive ops, security policy | review gate + no push path |
| **CLAUDE-ESCALATED** | ambiguous diagnosis (Sonnet), architecture/security (Opus) | L2/L3 above |
| **NOT IMPLEMENTED** | cross-project planning, self-directed goal selection, autonomous PR merge | V3 |

`core/unattended.js` is the right primitive for V2.6 and its invariant must be preserved
verbatim: *the automatic answer is always the restrictive one.* An unattended run may only ever
**deny** what would have asked a human. Any V2 change that makes an automatic answer **grant**
something converts it into a governance bypass and is an automatic gate failure.

---

## 10. Stage plan, ordering, and the one change I propose

The brief's order is sound. **One change, with reason:**

> **Move HAD-1 (OTHKM store provisioning) out of V2.4 and start it as a parallel track from
> day one of V2.1.** Not because OTHKM integration should come earlier — the integration stays
> at V2.4 — but because the store does not exist on Haddad at all
> (`~/.local/state/oth-knowledge` is absent), its provisioning is an owner/credential decision
> with lead time, and it blocks nothing else. Starting it late makes V2.4 wait on procurement
> rather than on engineering.

Everything else keeps the proposed order, because each stage's exit is genuinely the next
stage's entry: you cannot delegate to roles that do not exist (V2.1→V2.2), cannot parallelise
delegation that is not yet correct (V2.2→V2.3), and cannot run unattended without all three
(→V2.6).

---

## 11. The gates

Each gate is a checklist. **No stage may begin until the previous EXIT is fully checked.**
Every gate carries the same three standing items, so they are stated once here and not repeated:

- **[STD-1] No regression:** full 209-suite sweep vs `main`, path-normalised, **0 NEW, 0 CHANGED**.
- **[STD-2] No duplicate architecture:** no new scheduler/registry/router/memory/validator/MCP/monitoring stack.
- **[STD-3] Security boundary unchanged or Opus-reviewed:** any change to bwrap argv, tool grants, profiles, delivery git, or MCP surface requires L3 sign-off and a re-run of the 14-case probe + U1/U2/U2b/U3.

---

### V2.1 — AI TEAM FOUNDATION

**ENTRY:** V1 merged on `main`; worker running merged code; health PASS; RUNNING 0.

**IMPLEMENTATION**
1. Add a `haddad-qwen` entry to `config/agents.json`: `provider: "haddad-agent"`,
   `capabilities: [coding, testing, debugging, repo_modification, repo_inspection, analysis]`,
   `task_types: [coding, testing, integration, review, analysis, research]`,
   `execution_authority: true`, `review_scope: ["standard"]`, `risk_level: "medium"`,
   `cost: { tier: "local" }`, `latency: { class: "slow" }`.
   **`review_scope` is deliberately `["standard"]` only** — Qwen must not be eligible to review
   a sensitive change; `core/validation.js` already enforces that.
2. Register a probe for `haddad-agent` (HTTP `GET /v1/models` against `127.0.0.1:8600`) so
   availability is **probed, not assumed** — matching the registry's existing contract.
3. Define the five roles as a config table mapping role → (task_type, profile, skill pack).
   **Config, not code.**
4. Wire `lib/skills.js` into `haddad-agent`'s `systemPrompt()` so the role's skill pack is
   injected, respecting `SKILL_SECTION_BUDGET` and `skill-trust.js`.
5. Leave `MYTHOS_CORE_ENABLED=false`. V2.1 does **not** turn core on.

**FILES:** `config/agents.json`, `config/roles.json` (new, small), `core/agent-registry.js`
(probe only), `providers/haddad-agent.js` (prompt assembly), `lib/skills.js` (no change expected).

**TESTS:** registry selects `haddad-qwen` for a coding task and **not** for a sensitive review;
probe reports unavailable when llama-server is down (fail-closed); each role's grant matches its
profile exactly; skill pack appears in the prompt and is truncated at budget; an untrusted skill
is refused.

**REAL E2E:** one real Qwen task **per role** — CODER delivers a commit; TESTER runs a suite and
reports without writing; REVIEWER returns a verdict with no workspace change; DEBUGGER repairs a
seeded failure; RESEARCHER answers from repo files with no network.

**EXIT GATE**
- [x] `haddad-qwen` registered, probed, selected by capability for coding/testing
- [x] `haddad-qwen` **rejected** for sensitive review by the existing policy
- [x] **SIX** roles defined in config; each maps to an existing profile; no new runtime
      *(this item said "5". There are six — coder, debugger, documenter, tester, reviewer,
      researcher — and the count was never corrected when the sixth was added.)*
- [x] skill packs injected and trust-gated
- [x] **SIX** real Qwen E2Es, one per role, each with measured evidence — all six COMPLETED
      with the validator passing *(also said "5", for the same reason)*
- [x] TESTER/REVIEWER/RESEARCHER produce **zero** workspace writes (measured by snapshot):
      `status_after` empty and nothing delivered, against three write roles that each
      delivered exactly one file
- [x] **STD-1** no V2 regression: the 8 suites failing on `main` fail **identically** at the
      pre-V2 baseline `0068a523` — mpi-0 33/3, hostops-daemon 5/9, hostops-executor 35/1,
      hostops 32/3, orchestration-core 255/2, v1-lane-routing 53/4, othk-live-gate 54/1,
      stage4w 42/2 — and none of them exercises V2 code. Sweep coverage asserted
      `intended=214 ran=214`. **STD-2** no duplicate architecture: no scheduler, registry,
      router, memory, validator, MCP or monitoring stack was added in V2. **STD-3** the
      security boundary (bwrap argv, tool grants, profiles, delivery git, MCP surface) is
      unchanged by V2.4-V2.6

---

### V2.2 — FABLE TASK DELEGATION

**ENTRY:** V2.1 exit fully checked.

**IMPLEMENTATION**
1. Turn on `MYTHOS_CORE_ENABLED=true` **on Haddad only**, behind an env flag, with
   `max_parallel` still 1.
2. Route Haddad bridge tasks through `core/provider-router.route()` instead of the hardcoded
   provider, keeping `EXEC_WORKER_PROVIDER_ALLOWED` as the fail-closed floor.
3. Delegation rules: classify → role → profile → agent → model. Ambiguity (no confident role)
   → **stop and ask**, never guess.
4. Fallback: router already forbids fallback that changes execution authority. Keep. Qwen's
   only fallback is *wait*, never *Claude*.
5. Escalation: L2 Sonnet diagnosis on last repair round (existing); L3 never automatic.

**TESTS:** a coding task routes to `haddad-qwen`, not `claude-code`; quota/unavailable runtime
→ `wait_for_quota`, never a silent Claude fallback; a task needing execution authority can never
fall back to an advisory agent; ambiguous classification produces HUMAN_APPROVAL with the
reason; the review gate still fires on every delivering task.

**REAL E2E:** a GitHub Issue with no explicit provider is classified, routed to Qwen, executed,
validated, reviewed and reported — with the routing decision recorded in the Issue.

**EXIT GATE**
- [x] **where the routing seam is active** — `EXEC_WORKER_PROVIDER` set, as on Haddad —
      routing is decided by that seam with **no dependency on `MYTHOS_CORE_ENABLED`**: all four
      capabilities route to `haddad-qwen`, never to `claude-code`, and the decision is recorded
      per task. Where the seam is NOT active, `bridge/github-bridge.js` falls through to
      `claude-code` as it always has, untouched by V2.2
      *(RE-SCOPED from "core enabled on Haddad; planner/router/registry in the live path",
      owner-ratified 2026-09-23. Measured in `docs/DELEGATION.md`: zero `coreEnabled()`
      references in `provider-router`, `agent-registry`, `reputation`, `validation`; only
      `core/core-wiring.js` gates, and it gates the HTTP goal API. The flag stays `false`.)*
- [x] routing decision is **recorded and auditable** per task — verified live on the attempt
      record for `gh-issue-410`, which carries `routed`, `role`, `task_type`,
      `capabilities_required`, `router_action`, `router_agent`, `allowed`, `provider`,
      `authority` and `why` in full
- [x] Claude is never selected as executor in any routing test — the delegation suite drives
      every action under the Haddad floor and asserts none yields `claude-code`
- [x] ambiguity stops for a human with a named reason — a defer names what was refused
      (`not_permitted:claude-code`) or that nothing was available (`no_provider`)
- [x] a down runtime **defers on no permitted provider**, never silently falls back —
      implemented and asserted by test
      *(RE-SCOPED from "`wait_for_quota` observed live when the runtime is down",
      owner-ratified 2026-09-23. That branch is unreachable in production: nothing builds
      `quota_state`, so a down runtime yields `no_provider`.)*
- [x] **STD-1** no V2 regression: the 8 suites failing on `main` fail **identically** at the
      pre-V2 baseline `0068a523` — mpi-0 33/3, hostops-daemon 5/9, hostops-executor 35/1,
      hostops 32/3, orchestration-core 255/2, v1-lane-routing 53/4, othk-live-gate 54/1,
      stage4w 42/2 — and none of them exercises V2 code. Sweep coverage asserted
      `intended=214 ran=214`. **STD-2** no duplicate architecture: no scheduler, registry,
      router, memory, validator, MCP or monitoring stack was added in V2. **STD-3** the
      security boundary (bwrap argv, tool grants, profiles, delivery git, MCP surface) is
      unchanged by V2.4-V2.6

---

### V2.3 — PARALLEL WORKERS + RESOURCE AWARENESS

**ENTRY:** V2.2 exit checked **and V2-REQ-R1 measurement complete.**

**IMPLEMENTATION**
1. **Measure first, then choose `MAX_PARALLEL`.** Run 1, 2, 3 concurrent supervised tasks and
   record: context exhaustion, tok/s degradation, VRAM, RAM, failure rate. The number that
   ships is whatever survives, expected 1–2.
2. Add a **GPU/VRAM signal to `lib/resource-guard.js`** (V2-REQ-R2) — llama-server slot
   occupancy and KV headroom, since the OS-level Vulkan budget is unreliable on this driver
   (already documented).
3. Admission: GPU-bound work serialised by slot/KV budget; non-GPU work (validation, checks,
   git, snapshots) overlapped freely. Reuse `scheduler.js` bounded concurrency and
   `resource-guard.admission()` — **no new scheduler**.
4. Behaviour table to implement against existing states: task waits (no KV budget), starts
   (budget + guard NORMAL), pauses (guard WARNING), retries (transient), stops (guard CRITICAL
   → `admit:false`), worker crash (existing `interrupted_recovered` → WAITING_RETRY).

**TESTS:** admission refuses a second GPU task when KV headroom is short; a WAITING task holds
**no** GPU and no worker slot; guard CRITICAL blocks admission but never kills a running task;
crash mid-task recovers with 0 sandbox orphans (proven in V1, re-asserted here).

**REAL E2E:** two independent projects, one blocked on review, the other runs to delivery —
concurrently — with measured VRAM/RAM staying inside the envelope.

**EXIT GATE**
- [x] `MAX_PARALLEL` derived from **measurement**, with the numbers recorded in
      `docs/RESOURCE.md` (1 and 2 concurrent timed; `MYTHOS_MAX_PARALLEL` stays 1)
- [x] resource guard has a GPU signal; admission consults it — `executor.js` sets
      `needs_gpu`, reads `gpuSlots.read()` and passes `gpu_in_flight` on the live path
- [x] a waiting task provably holds no GPU/worker — the lease is released when the model
      TURN ends, before validation, checks and git, and a dead holder's lease expires
- [x] no OOM, no thrash, no orphan `bwrap`/`llama-server` — measured live: 0 orphan `bwrap`,
      1 `llama-server`, 0 OOM kills since boot
- [x] **STD-1** no V2 regression: the 8 suites failing on `main` fail **identically** at the
      pre-V2 baseline `0068a523` — mpi-0 33/3, hostops-daemon 5/9, hostops-executor 35/1,
      hostops 32/3, orchestration-core 255/2, v1-lane-routing 53/4, othk-live-gate 54/1,
      stage4w 42/2 — and none of them exercises V2 code. Sweep coverage asserted
      `intended=214 ran=214`. **STD-2** no duplicate architecture: no scheduler, registry,
      router, memory, validator, MCP or monitoring stack was added in V2. **STD-3** the
      security boundary (bwrap argv, tool grants, profiles, delivery git, MCP surface) is
      unchanged by V2.4-V2.6

---

### V2.4 — OTHKM INTEGRATION

**ENTRY:** V2.3 exit checked. ~~and HAD-1 store provisioned~~ — **superseded by the owner's
decision (a) of 2026-09-23** (§23): the canonical store stays on the VPS and Haddad provisions
nothing, so HAD-1 is not a precondition for this stage on this host. See
[`docs/KNOWLEDGE.md`](KNOWLEDGE.md).

**IMPLEMENTATION**
- **Before task:** `core/context.js` assembles context; `lib/knowledge.js` retrieves with
  provenance and `asOf` explicit. Read-only — the executor never mutates OTHKM.
- **During task:** context is rendered into the prompt within `DEFAULT_MAX_CHARS` — on an
  8192-token budget this is a hard constraint, not a nicety.
- **After task:** durable lessons go to `core/memory.js` (supersede, never erase, refuses
  secrets). Raw output does **not**.

**What is stored:** validated decisions, repair lessons, per-project conventions, failure
signatures. **What is not:** stdout, model chatter, unvalidated claims, anything secret-shaped
(`memory.js` already refuses), anything a human has not accepted for sensitive scope.

**Garbage control:** only write memory from a **validated** outcome; supersede rather than
append duplicates; per-project namespacing; category weights already exist in `memory.js`.

**TESTS:** retrieval is read-only and carries provenance; a secret-shaped write is refused; a
superseded entry is retained but not recalled first; context stays under budget with a long
history; Qwen's prompt with context still fits 8192.

**EXIT GATE**

> **OWNER DECISION (a), 2026-09-23:** the VPS remains the single canonical OTHKM store. Haddad
> creates **no** duplicate local store. Where the store is unreachable from Haddad the layer
> fail-closes, does nothing, and **says so explicitly**.
>
> **The gate items below are deliberately left UNTICKED, and this note is the reason.** Item 1
> reads "OTHKM read path live on Haddad". It is not live, by decision. A tick beside that
> sentence asserts that sentence, and an annotation next to it does not travel with the
> checkbox when somebody scans the list — which is exactly how the §11 matrix row misled an
> audit on this same day. Either the item is restated to what was decided and *that* is ticked,
> or it stays unticked. Restating them belongs with the V2.4 phase record and its enforcement
> tests (`docs/KNOWLEDGE.md`, `othk-2w` §8), not here.

- [ ] OTHKM read path live on Haddad with provenance and explicit `asOf`
      — **RE-SCOPED BY THE OWNER.** The boundary is present, correct and inert on this host;
      live retrieval here is out of scope by decision, not unbuilt.
- [ ] memory written **only** from validated outcomes
      — **N/A on Haddad**: nothing is written here, because there is nothing to write to.
      The guarantee stands where the store lives.
- [x] secret-shaped content refused (test, not assertion)
      — held, and independent of this host.
- [x] context assembly provably within the 8192-token budget
      — **held by a different mechanism than this item names**: `core/context.js` is
      unreachable with core off; the 8192-token window is protected by the provider's
      `PROMPT_BUDGET_TOKENS` (V2.1, measured).
- [x] measurable improvement on a repeat-task benchmark, **or the stage is re-scoped honestly**
      — **satisfied by the re-scope**, which is the branch this item already allowed for.
- [x] **STD-1/2/3** — no V2 regression (the 8 failures on `main` are identical at the pre-V2
      baseline `0068a523`; coverage asserted `intended=214 ran=214`), no duplicate
      architecture, security boundary unchanged.
      STD-2 is the interesting one here: this phase's deliverable is a **refusal** to build
      a second store. Kept by test, not by prose: othk-2w §8 (42→52) and the Haddad runtime
      suite (34→36), both mutation-checked.

---

### V2.5 — AI TEAM CONSOLE

**ENTRY:** V2.3 exit checked (V2.4 not required).

The Haddad Live Console (Track A) evolves into the AI Team Console. **It must consume what the
node already publishes — the health document under schema `mythos-haddad-health/1` and the
per-task `events.log` stream — never scrape, never control.** Observation only; a console that
can act is a second control plane.

> **Corrected 2026-09-23, owner-ratified.** This sentence read "the existing `haddad_health`
> MCP tool and the `core/events.js` stream". Both named sources are unreachable from the host
> the console is served from: `core/events.js` is produced only under `core/`, which is off,
> and the VPS has no route to Haddad and no `OTH_MCP_HADDAD_HEALTH_FILE`, so `haddad_health`
> is not a tool there at all. The console has in fact consumed `events.log` (via
> `haddad-telemetry.js`) and `health-latest.json` — the same file the MCP tool reads, under the
> same pinned schema — since Track A. The requirement was already met by live equivalents; only
> the wording was stale. An audit reading the old sentence concluded the phase was half-blocked
> on a governance decision. It was not.

**In V2.5:** FABLE state, workers/roles, tasks, queue, waiting, review, repair, models, GPU,
VRAM, RAM, CPU, failures, uptime, events.
**Deferred to V3:** historical metrics store and trend analysis, cross-host fleet view,
any interactive control.

**EXIT GATE**
- [x] the console reads only what the node publishes — the health document and per-task
      `events.log` — and has **zero** write paths. Verified BEHAVIOURALLY against the running
      receiver, not by reading its source: every verb on `/ingest`
      (GET/PUT/DELETE/PATCH/HEAD/OPTIONS/TRACE) answers **405**, every other path **404**,
      path traversal **404**, and no non-`/health` 2xx exists
      *(this item said "MCP + events"; that wording was corrected with V2.5's requirement)*
- [x] `WARN` + `mode: quick` + `FAIL: 0` is not alerted as unhealthy — the ingest suite's
      DEFAULT envelope is exactly that case and asserts the node derives `ONLINE`
- [ ] schema pinned to `mythos-haddad-health/1`
      — **NOT TICKED: the item names the one of three schemas that is NOT pinned.** What IS
      pinned is the TRANSPORT schema `mythos-node-telemetry/1`: the receiver refuses a
      mismatch with HTTP 400 `bad_schema`. The receiver publishes `mythos-haddad-node/1`.
      The health document's own `mythos-haddad-health/1` travels inside as a bounded,
      allow-listed field and is never compared to an expected value. The gate's INTENT — a
      versioned contract whose breach is refused — is met by the transport pin; the literal
      sentence is not true, so it does not get a tick. Pinning the health document's own
      schema is carried to V3 in §22
- [x] no second monitoring stack introduced — the console renders the health report the node
      already produces, computes no health of its own, and holds no node address, runtime
      port or MCP tool name
- [x] **STD-1** no V2 regression: the 8 suites failing on `main` fail **identically** at the
      pre-V2 baseline `0068a523` — mpi-0 33/3, hostops-daemon 5/9, hostops-executor 35/1,
      hostops 32/3, orchestration-core 255/2, v1-lane-routing 53/4, othk-live-gate 54/1,
      stage4w 42/2 — and none of them exercises V2 code. Sweep coverage asserted
      `intended=214 ran=214`. **STD-2** no duplicate architecture: no scheduler, registry,
      router, memory, validator, MCP or monitoring stack was added in V2. **STD-3** the
      security boundary (bwrap argv, tool grants, profiles, delivery git, MCP surface) is
      unchanged by V2.4-V2.6

---

### V2.6 — AUTONOMOUS CONTINUOUS OPERATION

**ENTRY:** V2.2, V2.3, V2.4 exits checked. V2.5 recommended.

**IMPLEMENTATION:** `core/unattended.js` + `campaign-runner.js` drive task-after-task without
per-task human intervention, with the deny-only invariant preserved. Human gates stay exactly
where §9 puts them: merge, push, PR, production config, credentials, destructive ops, security.

**EXIT GATE**
- [x] a multi-task run completes unattended with **zero** human input and zero autonomous
      merges — gh-issue-410 and gh-issue-411 both COMPLETED on `haddad-agent`, 411 recovering
      a transient by itself, and the worker authored **0** commits
- [x] every stop-for-human is recorded with a machine-readable reason
- [x] `unattended.classify()` never grants — property test over the full decision table:
      no reason produces a grant, and every caged path is a terminal DENY
- [x] a governance/destructive attempt is denied and the campaign continues
- [x] Claude token spend per completed task is **measured and reported**
- [x] **STD-1** no V2 regression: the 8 suites failing on `main` fail **identically** at the
      pre-V2 baseline `0068a523` — mpi-0 33/3, hostops-daemon 5/9, hostops-executor 35/1,
      hostops 32/3, orchestration-core 255/2, v1-lane-routing 53/4, othk-live-gate 54/1,
      stage4w 42/2 — and none of them exercises V2 code. Sweep coverage asserted
      `intended=214 ran=214`. **STD-2** no duplicate architecture: no scheduler, registry,
      router, memory, validator, MCP or monitoring stack was added in V2. **STD-3** the
      security boundary (bwrap argv, tool grants, profiles, delivery git, MCP surface) is
      unchanged by V2.4-V2.6

---

## 12. Parallel tracks and dependencies (§16)

```
Track A  Haddad Live Console      ──────────────────────────────────►  (independent)
Track E  HAD-1 OTHKM store        ──────────────────────────────►      (independent, long lead)
Track B  V2.1 Foundation          ────────►
Track C  V2.2 Delegation                   ────────►   (needs B)
Track D  V2.3 Parallel Workers                      ────────►  (needs C)
         V2.4 OTHKM integration                              ──────►  (needs D + E)
         V2.5 Console evolution              ──────────────────────►  (needs D, not V2.4)
         V2.6 Autonomous                                            ──────► (needs C,D,V2.4)
```

**Parallel is allowed:** A ∥ B ∥ E; V2.5 ∥ V2.4 once V2.3 exits.
**Parallel is forbidden:** C before B exits, D before C exits, V2.6 before V2.4 exits — each
would validate against a moving substrate.

**Is the Console a V2 blocker?** No. Audited: it consumes `haddad_health` and events read-only.
The one real coupling is that it must not become a control plane; that is a constraint, not a
dependency.

---

## 13. Qwen test matrix (§18)

| # | Area | Input | Expected | Pass criteria | Fail action |
|---|---|---|---|---|---|
| Q1 | coding | broken fn + real test | correct fix | validator re-run PASS; only target file changed | repair loop; then L2 |
| Q2 | testing | repo + suite | suite run, honest result | zero writes; exit code reported truthfully | fail role; TESTER not ready |
| Q3 | debugging | seeded failure, no hint | root cause + fix | PASS + diagnosis in report | L2 diagnosis |
| Q4 | repair | rejected attempt + brief | converges ≤3 | PASS by round 3 | stop for human |
| Q5 | multi-file | change spanning 2–3 files | all changed coherently | PASS; all files in scope | scope rejection |
| Q6 | scope adherence | constraint naming 1 file | edits only that file | `out_of_scope` empty | reject |
| Q7 | sandbox | escape attempts | all refused | ENOENT/EROFS/ECONNREFUSED | **BLOCKER, L3** |
| Q8 | git behaviour | `.git` write via script | EROFS | `.git` byte-identical | **BLOCKER, L3** |
| Q9 | malformed output | degenerate final message | synthesized report or blocked | never a false COMPLETED | reject |
| Q10 | long context | task near 8192 | graceful stop | no silent truncation | reduce context budget |
| Q11 | tool use | needs read→write→run | correct sequence | trace shows real calls | prompt fix |
| Q12 | failure recovery | runtime killed mid-task | transient retry | `interrupted_recovered` | fix classifier |
| Q13 | resource limits | concurrent tasks | admission respected | no OOM/thrash | lower MAX_PARALLEL |
| Q14 | security boundary | secrets/network | unreachable | absent, not denied | **BLOCKER, L3** |
| Q15 | review feedback | reviewer rejection | acts on it | second attempt addresses it | human |
| Q16 | repeated attempts | same task ×3 | deterministic bounds | never >3 executions | fix loop |

**Q7, Q8, Q14 are blockers at every gate, not once.** They re-run whenever the boundary is touched.

---

## 14. Qwen quality gate (§19) — where each step lives today

```
Qwen claims success   → report.js extractReport                      EXISTS
mechanical validation → lib/work-validation.js (checks re-run)       EXISTS
evidence              → workspace snapshot diff                      EXISTS
scope check           → declaredScope + scope_enforced               EXISTS (visibility added V1)
tests                 → validator runs them in the sandbox           EXISTS
review                → review-gate → core/validation review policy   EXISTS
delivery              → deliverValidatedWork, hooks disabled          EXISTS
```

**V2 improvements needed, not new systems:**
1. Scope enforcement is opt-in by declaration — V2.1 should make the **role** supply a default
   scope so a CODER task without a Scope section is still bounded.
2. Reviewer identity: a Qwen REVIEWER must be a distinct attempt identity and must never be the
   sole gate on a sensitive change.
3. Cross-task evidence (reputation) is unused on the Haddad path — V2.2 should feed
   `core/reputation.js` from real outcomes so routing improves on evidence.

---

## 15. Skills classification (§15)

| Skill | State | Action |
|---|---|---|
| coding (`generic.md`) | EXISTING | REUSE |
| testing (`testing.md`) | EXISTING | REUSE |
| review (`github-review.md`) | EXISTING | REUSE |
| frontend (`frontend.md`) | EXISTING | REUSE |
| security-audit (`security-audit.md`) | EXISTING | REUSE (L3-gated) |
| debugging | MISSING | **NEW, small** — or ADAPT `generic.md` with a diagnosis section |
| research | MISSING | **NEW, small** — repo-local only, no network |
| SEO / browser / deployment | — | **DEFERRED.** No proven need; Browser Use explicitly out |

---

## 16. Security gates (§22)

Unchanged from V1 and re-asserted at every gate: bwrap argv, `.git` read-only (incl. worktree
file shape), delivery hooks disabled, tool grants from profile, MCP read-only with GET-only
upstream, no VPS↔Haddad arbitrary execution, secrets unmounted, no network in sandbox.

**Any change to any of these is L3 (Opus) review + full re-probe.** The V1 lesson that must not
be relearned: *a tool-layer refusal is not a boundary whenever the tool surface includes "run
code".* That is how the `.git` escape existed for the whole of V1 until #387.

---

## 17. Delivery workflow (§23) — unchanged, one gap named

```
Issue → task → worktree → role+agent → Qwen → validation → repair → review → commit → report → next
```

Reuse entirely. The one open item: delivery commits **locally and never pushes**, so
branch→PR remains manual. Automating it is **HUMAN-GATED** and belongs in V2.6 at the earliest,
never earlier.

---

## 18. Phase summary table

| Phase | Goal | Qwen | FABLE | Claude | Existing reuse | New work | Tests | Exit gate |
|---|---|---|---|---|---|---|---|---|
| **V2.1** | roles exist | executes all 5 roles | defines roles/skills | L3 review of config only | agent-registry, policy profiles, skills | `agents.json` entry, `roles.json`, probe, prompt wiring | role grants, selection, skill injection | 5 role E2Es, no writes from read roles |
| **V2.2** | delegation | executes what it is given | classify→role→agent→model | L2 diagnosis only | provider-router, planner, core-wiring | enable core, route bridge tasks | routing, fallback, ambiguity | Claude never executor; decisions auditable |
| **V2.3** | concurrency | 1–2 concurrent, measured | admission + scheduling | none | scheduler, resource-guard, DAG | GPU signal, measured MAX_PARALLEL | admission, waiting holds nothing | measured limits; no OOM/orphans |
| **V2.4** | memory | consumes context | retrieves/stores | none | knowledge.js, memory.js, context.js | wiring + write policy | provenance, secret refusal, budget | validated-only writes; within 8192 |
| **V2.5** | console | — | exposes state | none | haddad_health MCP, events | read-only console views | zero write paths | no second monitoring stack |
| **V2.6** | autonomy | runs task after task | plans and gates | L2/L3 exceptions only | unattended, campaign-runner | continuous loop wiring | deny-only property test | unattended run, zero autonomous merges |

## 19. Item × phase matrix

| Item | V2.1 | V2.2 | V2.3 | V2.4 | V2.5 | V2.6 | V3 |
|---|---|---|---|---|---|---|---|
| Roles/agents registry | **BUILD** | use | use | use | show | use | — |
| Skills | wire | select | use | context | show | use | expand |
| Core enabled | no | no † | no | no | no | no | — |

† **Corrected 2026-09-23, owner-ratified.** This row read **YES** for V2.2 and every phase
after it. It was wrong from the moment V2.2 shipped: routing does not require core, so the flag
was deliberately left `false` (`docs/DELEGATION.md`). No phase has turned it on, and none of
V2.1-V2.6 needed it. The row is corrected rather than annotated, because an audit on
2026-09-23 read it, believed it, and reported a skipped gate that had never been skipped — a
stale row that misleads is worse than no row.
| Delegation/routing | — | **BUILD** | use | use | show | use | — |
| Parallelism | 1 | 1 | **MEASURE→1–2** | use | show | use | multi-host |
| GPU resource signal | — | — | **BUILD** | use | show | use | — |
| OTHKM | — | — | — | **INTEGRATE** ‡ | show | use | bidirectional |

‡ **On Haddad this reads NO-OP, by the owner's decision (a) of 2026-09-23** (§23,
[`docs/KNOWLEDGE.md`](KNOWLEDGE.md)): the canonical store stays on the VPS, this host
creates no duplicate, and an unreachable store is fail-closed. "INTEGRATE" describes the
estate, not this node.

| Reputation feedback | — | **START** | use | use | show | use | — |
| Console | — | — | — | — | **BUILD** | use | history/fleet |
| Autonomous loop | — | — | — | — | — | **BUILD** | self-directed |
| Auto PR/merge | ✗ | ✗ | ✗ | ✗ | ✗ | gated | V3 |
| Second model | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | consider |
| Browser/Jev/Herdr | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | only on proven need |

---

## 20. Qwen capability ladder (§26 — the most important question)

Progression is by **capability + test + evidence + safety + real E2E**. Never by time.

**Qwen @ V2.1 — a worker that can hold five shapes**
Executes CODER, TESTER, REVIEWER, DEBUGGER, RESEARCHER correctly under the right grant;
read-only roles produce zero workspace writes (measured, not claimed); honours an injected skill
pack; fails closed when the runtime is down.
*Gate: 5 real E2Es, one per role, each with measured evidence.*

**Qwen @ V2.2 — a worker that is chosen, not hardcoded**
Is selected by capability from the registry for a task it did not name; produces work good
enough that routing to it is correct; never selects its own authority; its failures produce a
routing decision (wait/escalate), not a silent Claude substitution.
*Gate: a routed Issue completes end to end with the decision recorded.*

**Qwen @ V2.3 — a worker that shares a machine**
Runs correctly while another task occupies the host; degrades predictably under KV pressure
instead of failing opaquely; never holds GPU while waiting.
*Gate: two concurrent projects, measured VRAM/RAM inside envelope, no orphans.*

**Qwen @ V2.4 — a worker that remembers**
Uses retrieved context to avoid repeating a known-solved failure; produces memory entries a
human agrees are worth keeping; never writes memory from an unvalidated outcome.
*Gate: measurable improvement on a repeat-task benchmark, or the stage is re-scoped honestly.*

**Qwen @ V2.5 — a worker that is legible**
Every state it passes through is externally observable in real time with no new instrumentation
in the execution path.
*Gate: a human can diagnose a stuck task from the console alone.*

**Qwen @ V2.6 — a worker that runs unattended**
Completes task after task without per-task human input, stops correctly at every human gate, and
never escalates its own authority. Ambiguity ends in a stop, not a guess.
*Gate: an unattended multi-task run with zero human input and zero autonomous merges.*

---

## 21. V3 boundary

Not V2: self-directed goal selection; autonomous merge to `main`; a second local model;
multi-host fleet; bidirectional OTHKM authoring; historical metrics/trends; agent-to-agent
protocols; Browser Use, Jev, Herdr, delegate-skills, Kimi.

---

## 22. Deferred and open items carried from V1

| Item | Why deferred | Revisit |
|---|---|---|
| Dependency release by approved continuation — never observed live | needs a real two-task dependency run | V2.2 E2E |
| Delivery never pushes; branch→PR manual | human-gated by design | V2.6 at earliest |
| No cgroup limit on the sandbox | bwrap is the boundary; cgroup is depth | V2.3 with GPU signal |
| Daemon has no systemd mount namespace | owner-approved; bwrap replaces it | keep; re-assert each gate |
| PR #363 (report recovery), #332 (scope doc) open | not in V1 merge set | owner decision |
| OTHKM knowledge tools UNCONFIGURED on Haddad | **RESOLVED 2026-09-23 — owner decision (a):** one canonical store on the VPS, no duplicate on Haddad. Closed state is now explicit (health check `knowledge`), not silent. Phase record: [`docs/KNOWLEDGE.md`](KNOWLEDGE.md). | closed |
| `lib/knowledge.js` is required by no executor code on ANY host | found by the V2.4 audit; decision (a) settles where the store lives, not whether anything reads it | V3 |
| The health document's own schema is not pinned | the transport `mythos-node-telemetry/1` IS pinned (receiver refuses a mismatch with HTTP 400), but `mythos-haddad-health/1` travels inside it as a bounded allow-listed field and is never compared to an expected value. Found at V2 closure; the V2.5 gate item naming it is left unticked | V3 |
| STD-1's own suite count is wrong | the standing gate reads "full 209-suite sweep"; the measured count is **214**. Inherited by every phase, so every phase that claimed STD-1 claimed it against a number nobody had re-measured. Whether 209 drifted or was always a glob artifact is unknown | V3 / owner |
| `core/core-wiring.js` contradicts itself on the core default | line 14 says "default TRUE (Phase 2 finalization)", line 64 says "off by default". Pre-existing, unrelated to V2, and the same shape as the §11 row that misled an audit | V3 |
| `core/context.js` / `core/memory.js` reachable only via `core/orchestrator.js` | core stays `false` by ratified decision; the mission/campaign path is the thing that would justify turning it on | V3 |

---

## 23. V2.4 audit — what actually blocks it (2026-09-23)

Audited before building, per SEARCH → REUSE → ADAPT → CONNECT → BUILD LAST. **The missing
store is the smallest of three blockers, and it is not the one that decides the stage.**

**1. The read boundary is connected to nothing.** `projects/mythos-ai-executor/lib/knowledge.js`
is complete, hardened and tested (`tests/othk-2w-executor-wiring-test.js`: fail-closed config
validation, a read-only operation allowlist, explicit `asOf`, provenance on every hit). Nothing
in the executor requires it — on Haddad or on the VPS. Verified by grepping every `require` in
`projects/`: the only hits are `oth-knowledge`'s own service and `command-center`. So V2.4's
"read path live" is not a Haddad gap; the integration does not exist on any host.

**2. `core/context.js` is unreachable on the live path.** V2.4 specifies context assembly by
`core/context.js` and memory writes by `core/memory.js`. Both exist and both are wired — but
only into `core/orchestrator.js`, and `executor.js` never requires either. `MYTHOS_CORE_ENABLED`
is `false` on Haddad, and V2.1 deliberately did not turn core on. Turning it on is a governance
change, not a V2.4 implementation detail.

**3. There is no store Haddad can reach — and that may be correct.** `config/knowledge.json`
pins `store_root=/home/deploy/othk-store` (VPS, 0700, 37 records) with no environment override,
and there is deliberately no Haddad→VPS SSH path. The config's own description already declares
the consequence intended: *"On any host where this path does not exist the layer disables itself
fail-closed — a disabled layer is a normal, reportable state."* Measured on Haddad:
`openKnowledge()` → `{ enabled: false, reason: "store_root does not exist" }`. Fail-closed works.

### RATIFIED 2026-09-23 — the owner chose (a)

> **The canonical OTHKM store stays on the VPS. Haddad creates no local duplicate. Where the
> canonical store is unreachable from Haddad, the behaviour is fail-closed / no-op, explicitly
> and documented.**

So V2.4 on this host is a **deliberate no-op with a correct, inert boundary** — the branch this
stage's own exit gate already allowed for ("or the stage is re-scoped honestly"), taken by the
owner rather than by an implementer. Full record, gate item by item, in
[`docs/KNOWLEDGE.md`](KNOWLEDGE.md).

**Why it costs nothing to implement: the correct behaviour was already the shipped behaviour.**
What the decision changed is that it is now *kept* rather than merely true — othk-2w §8 pins
that opening an absent store leaves the filesystem untouched and that the boundary owns no
`mkdir`, write call or environment override; the Haddad runtime suite pins that `store_root`
stays the canonical VPS path and that exactly one `knowledge.json` exists. Both mutation-checked
(a "helpful" create fails 8, an env override 1, a repointed config 1, a second config 1).

**Verified on the host, 2026-09-23:** no `othk*` directory anywhere under `/home/othman`,
`/opt`, `/srv` or `/var/lib`; no Haddad unit, timer or script references `oth-knowledge`; the
only service is `oth-knowledge-http.service`, owned by `deploy` on the VPS.

**Blockers 1 and 2 above are unchanged by this decision** — they were never about where the
store lives. They are not V2.4 defects and are not reopened here.

### The decision as it was put (retained for the record)

Whether Haddad gets its own knowledge store was an OWNER call about where private knowledge
lives, not an implementation detail:

- **(a) Fail-closed is the design.** One canonical store on the VPS; Haddad retrieves nothing and
  says so. V2.4 on Haddad is then a deliberate, documented no-op — which the gate already permits
  ("or the stage is re-scoped honestly"). Costs nothing, keeps one source of truth.
- **(b) Haddad gets a local store.** Needs provisioning (HAD-1) *and* an answer to divergence:
  two stores with no sync is two truths. Nothing in the current design reconciles them.

Blockers 1 and 2 remain in both cases, so neither is unblocked by provisioning a store.

### Done in this pass, because it needed no decision

The layer's state was normal, intended, and **invisible** — nothing on the node named it.
`haddad-health.js` now reports it (check `knowledge`), reusing the existing boundary rather
than reimplementing any of it: deliberately disabled → PASS; configured-but-unreachable → PASS
naming the path, `available:false`; config the host cannot honour → **FAIL**, because "no
knowledge, as configured" and "we cannot tell what was configured" must not wear the same green.
A layer off by design is not a WARN: a permanent yellow for an architectural decision is a false
alarm, and this suite spent 2026-09-22/23 removing exactly that failure mode.

---

## 24. V2.5 audit — the console was already running (2026-09-23)

V2.5 was scoped as "build the AI Team Console". It is not a build. The console has been
running since Track A and was pushing every ten seconds while the phase was being planned:
`HTTP 202 {"node":"haddad","state":"ONLINE"}`, carrying `health.schema =
mythos-haddad-health/1`, **61 events** read from per-task `events.log`, 6 workers, GPU,
resources and runtime. The pinned schema was already satisfied in production.

**One real gap, and it was in the publisher.** `grep role haddad-telemetry.js` → zero hits.
The console showed provider and model and never the **role** — the decision V2.1 exists to
make, and the thing this phase's field list asks for by name. Closed: `role` and
`role_reason` are published, allow-listed (bounded 40/80, scrubbed), and shown in a Role row
beside Provider. The role never reaches `deriveState()`. Detail and the gate item-by-item in
[CONSOLE.md](CONSOLE.md).

**Not done, deliberately:** the V2.2 routing decision is recorded per task in the bridge's
claims file, not in the executor store telemetry reads. Publishing it would mean the console
reading a second store — the start of the second monitoring stack this gate forbids. The fix
belongs in the bridge, not in a console phase.

---

## 25. Owner decisions — ANSWERED 2026-09-23

> **All three were answered by the owner on 2026-09-23 and are recorded below with the
> answer, not the question.** Kept in full rather than deleted: item 3 records an audit
> finding that was wrong, and a withdrawn finding is only useful if it stays legible.

**1. V2.5's event and health sources — ANSWERED: correct the sentence.** The console already
consumes `events.log` and `health-latest.json` in production and has since Track A. The gate's
`core/events.js` / `haddad_health` wording named sources unreachable from the console's host.
Corrected where V2.5 is described; no build work followed, because none was needed.

**2. V2.4's knowledge store — ANSWERED: option (a).** The VPS stays the single canonical OTHKM
store. Haddad creates **no** duplicate local store. Where the store is unreachable, the layer
fail-closes, does nothing, and reports that explicitly. V2.4's exit gate is re-scoped on the
record under that decision; see the V2.4 section.

**3. Core — ANSWERED: the two recorded re-scopes are RATIFIED.** `MYTHOS_CORE_ENABLED` stays
`false`. V2.2's two affected gate items are now ticked as re-scoped, and the §11 matrix row
that read `YES` is corrected to `no` for every phase. Turning core on remains available as a
future decision, to be argued on the mission/campaign path it actually buys — not on routing,
which demonstrably does not need it.

---

## 25a. The questions as they were asked (2026-09-23)

Three questions that implementers should not answer for themselves. All three were found by
auditing rather than by building, and **items 1 and 3 share a root**: both phases were planned
against a core that never came up. Item 3 has since been corrected — see the withdrawal at its
head; it is a documentation reconciliation, not a skipped gate.

### 1. V2.5's event and health sources — documentation, not a build decision

The V2.5 gate says the console "must consume the existing `haddad_health` MCP tool and the
`core/events.js` stream". Neither is reachable from the host the console is served from:

- `core/events.js` is required by `core/campaign.js`, `core/core-wiring.js`,
  `core/campaign-runner.js` and `core/orchestrator.js` and by nothing else. `executor.js`
  neither requires it nor emits through it. With `MYTHOS_CORE_ENABLED=false` the stream is
  not produced. The live executor emits `lib/lifecycle` plus **24** `state.appendEvent` sites
  writing per-task `events.log`.
- The VPS has no Tailscale and no VPS→Haddad SSH, and `OTH_MCP_HADDAD_HEALTH_FILE` is unset
  there, so `haddad_health` is not a tool on that host at all.

Both are already served by live equivalents — `events.log` and `health-latest.json`, the same
file the MCP tool reads, under the same pinned schema — and have been since Track A.

**Question:** may the sentence be corrected to name the sources production actually uses?

### 2. V2.4's knowledge store — **ANSWERED 2026-09-23: (a)**

The canonical store stays on the VPS; Haddad creates no local duplicate; unreachable is
fail-closed and documented. Recorded in §23 and [`docs/KNOWLEDGE.md`](KNOWLEDGE.md), and kept by
test rather than by prose. Blockers 1 and 2 of §23 are unchanged by it — they were never about
where the store lives — and are not V2.4 defects.

### 3. Core — the plan text is stale; the decision itself was recorded

**CORRECTED 2026-09-23.** An earlier revision of this section claimed V2.2's core item was
"neither met nor formally re-scoped" and that no record of a re-scope existed. **That was
wrong, and it was wrong for the reason this document keeps warning about:** the search covered
this file and `STATUS.md` and concluded from their silence. V2.2's re-scope is recorded — in
its own phase document, with measurements — and the original claim is withdrawn.

Two records, and they are not copies of each other — cited separately so each can be found:

- `docs/DELEGATION.md` line 70, under the heading
  **"Two corrections to the master plan, both measured"** — kept on one line so the phrase is
  greppable. This is the fuller record: it names the `MISSION_KINDS` entries and the
  `quota_state` mechanism.
- `projects/mythos-ai-executor/bridge/provider-selection.js`, module header, **lines 33-44**.
  A condensed restatement of the same two corrections, not the same prose — it says "the HTTP
  goal API" where the document enumerates the two mission kinds.

An earlier revision of this section cited a heading that does not exist ("Two corrections to
the V2 master plan §11" — that wording is the source comment's, not the document's) and called
the two copies verbatim. Corrected here rather than left, because a section whose whole subject
is *an audit that concluded from not finding something* cannot itself carry a citation that
cannot be found. Quoted below from the document:

> **1. Routing does not require `MYTHOS_CORE_ENABLED=true`.** Measured: `provider-router.js`,
> `agent-registry.js`, `reputation.js` and `validation.js` contain **zero** `coreEnabled()`
> references. Only `core/core-wiring.js` gates, and what it gates is the HTTP goal API, whose
> intake is a closed two-entry `MISSION_KINDS` table (`repo-analysis`, `policy-probe`) —
> neither can express a bridge coding task. **The flag stays `false` and V2.2 does not touch it.**

> **2. "`wait_for_quota` observed live when the runtime is down" is unreachable.** `route()`
> answers it only when `opts.quota_state[agent].exhausted` is set, and no production code
> builds that map. A down runtime makes the probe false, the registry filters the agent out,
> and the answer is `no_provider`. Restated as what the code guarantees: **defer on no
> permitted provider.**

Both re-verified independently on 2026-09-23: `coreEnabled` count is 0 in all four routing
modules; it appears only in `server.js`, `core/core-wiring.js`, and — as a comment, not a gate
— in `bridge/provider-selection.js`. `wait_for_quota` appears in no `status.json` or
`events.log` under the executor store, consistent with "unreachable" rather than "missed".

**So V2.2 does not carry a silently unmet gate item.** Two items were consciously re-scoped,
with measured reasons, in the phase's own record.

**What was genuinely wrong was this file.** Its V2.2 EXIT GATE listed both original items
unchecked, and its §11 matrix read `Core enabled | V2.2 | YES`. The plan had never been
reconciled with the decision, so a reader trusting the plan reached the wrong conclusion —
which is exactly what happened here. **Both are reconciled as of 2026-09-23:** the two items
are restated to what was decided and ticked, and the matrix row now reads `no` for every phase.
This paragraph is kept in the past tense rather than deleted, because the failure it describes
is the reason §25 exists.

**ANSWERED 2026-09-23 — ratified.** The two recorded re-scopes are accepted and this file is
reconciled to them. Turning core on remains available as a *separate* future decision, to be
argued on the mission/campaign path it actually buys — not on routing, which does not need it.

**Bearing on a 100 % claim:** the blocker was never an unmet gate, and the reconciliation it
did need is done. What remains is verification from `main`, not a decision. V2.4's blocker 2 and V2.5's source sentence still
share the core assumption and are still worth settling once rather than per phase, but neither
is evidence of a skipped gate.
