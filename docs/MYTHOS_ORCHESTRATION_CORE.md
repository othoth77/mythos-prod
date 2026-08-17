# Mythos Orchestration Core — Phase 2 technical reference

**Stage:** MYTHOS-ORCH-CORE (Phase 2 of `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md`).
**Code:** `projects/mythos-ai-executor/core/` — built incrementally ON the Phase 1
executor (`docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md`), which is unchanged and stays
deployed. **Suite:** `tests/mythos-orchestration-core-test.js` (offline, mock
providers, zero real AI quota), including the §34 acceptance tests A–S and the
§18 sandbox campaign integration test.

## 1. Execution flow

```text
USER GOAL → submitGoal (orchestrator.js)
  → planner.js       goal → mission → task spec (template or external/LLM spec;
                     unknown fields/types/classes REFUSED; plans inspectable)
  → policy gate      planner.validatePlan × policy-engine.js
  → persistPlan      mission + tasks in core/store.js (VALIDATED, inspectable)
  → advanceMission
      → scheduler.js     DAG-driven dispatch, bounded parallelism, worktrees
      → provider-router  capability/health/quota/reputation routing
      → context.js       relevant-only context assembly per task
      → tool-registry    least-privilege grants, schema-checked invocation
      → agent runner     injectable; executorBridge → Phase 1 executor
      → validation.js    6 validators + adversarial reviewer ≠ author
      → repair loop      VALIDATING → RETRYING (findings) → bounded by attempts
  → finalizeMission   report entity → memory entry → goal closure →
                      DECISION_MADE event → next decision
```

## 2. Domain model and state machines (`domain.js`, `store.js`)

Entities: goal, mission, task, execution, event, report, decision,
memory_entry, approval, artifact — stable prefixed ids, correlation id
threading a goal through everything derived from it, parent links, timestamps.

Task states: `QUEUED PLANNING READY RUNNING WAITING_FOR_DEPENDENCY
WAITING_FOR_QUOTA WAITING_FOR_APPROVAL RETRYING VALIDATING COMPLETED FAILED
CANCELLED`, transition-table enforced at the store chokepoint. The Phase 1
executor's states are untouched; `TASK_STATE_COMPAT` maps both ways, and an
executor `COMPLETED` maps to core `VALIDATING` — an executor result is a claim
to verify, never a trusted completion.

Persistence: `~/mythos-ai-executor/orchestration/` (never /tmp, never Git),
atomic tmp+rename writes, shared redaction on every byte, duplicate-id refusal,
and a durable JSONL event stream tolerant of torn tail lines. Restart recovery
is re-reading the store — proven by fresh-process tests.

## 3. Memory and context (`memory.js`, `context.js`)

Provider-independent project memory: 12 categories (identity, architecture,
decision, constraint, roadmap, known_issue, completed_work, dependency,
integration, lesson, execution_history, agent_outcome), each entry carrying
source, confidence, tags. Secrets are REFUSED (not silently redacted);
corrections supersede rather than erase; projects are strictly isolated.
Recall is deterministic lexical scoring with category weights and a relevance
floor — an irrelevant query returns nothing.

The context engine assembles ONLY relevant context per task: live repo facts,
weighted memory hits, related prior tasks — every item tagged
relevance/source/timestamp/confidence, admitted under a hard character budget.
It never dumps a repository into a prompt.

## 4. Agents and tools (`agent-registry.js`, `tool-registry.js`)

Agents advertise capabilities and task types; availability is PROBED
(injectable; a crashing probe = unavailable, never a crash). Selection is
capability-driven with hard authority filters — an advisory agent can never be
promoted to execution authority by selection, and nothing hard-codes Claude.
Registered today: `claude-code` (sole execution authority), `omniroute-advisory`
(OpenAI-compatible gateway, advisory), `gemini-advisor` (**UNCONFIGURED** —
`providers/gemini.js` exists architecturally and activates only when
`~/.config/mythos-ai-executor/gemini.env` provides a real credential; a Gemini
Plus subscription is not an API credential and none is invented).

Tools are `namespace.action` records with registration-validated input/output
schemas, policy class, risk, and provider. Grants are least-privilege through a
policy callback; invocation is grant- and schema-checked; declarative tools
refuse execution; mock tools (`image.generate`, `meta.create_campaign`, …) are
sandbox-only by construction — `database.destroy` exists solely to prove the
DESTRUCTIVE deny path and will never receive an adapter.

## 5. Planner and DAG (`planner.js`, `dag.js`)

Deterministic templates decompose a goal (inspect → analyze → design →
implement[×components] → integrate → test → review → report). Externally
produced (LLM) specs pass the same gate: schema, unknown-field refusal, policy
validation (with declared `budget_usd` flowing into MONEY_SPEND checks), and
dependency validation. Plans are inspectable (`explainPlan`) and persist only
when valid. The DAG is pure functions: Kahn cycle detection, ready-set
computation, ALL-parents merge gating, transitive failure propagation naming
the blocking ancestor; recovery is recomputation over persisted statuses.

## 6. Scheduler and worktrees (`scheduler.js`, `worktrees.js`)

Bounded concurrency (hard cap 8; per-mission `max_parallel_agents`), policy
gate before every dispatch, and isolation: every write-capable task gets its
own git worktree on branch `mythos/<mission>/<task>` — two writers can never
share a tree, the live checkout is never touched, dirty trees are never
destroyed without force, and branches always survive as the rollback path.
Approval is a persisted state (`WAITING_FOR_APPROVAL` + approval entity with a
mandatory human decider), never a prompt loop; a granted approval releases
exactly one dispatch.

## 7. Policy (`policy-engine.js`, `config/policy.json`)

Classes: `READ PROJECT_WRITE GIT SERVICE DEPLOY ROOT EXTERNAL_API MONEY_SPEND
DESTRUCTIVE`. Defaults: READ/PROJECT_WRITE/GIT allow; SERVICE/DEPLOY/
EXTERNAL_API require approval; ROOT/DESTRUCTIVE deny — **hard-floored in code:
no configuration value can loosen them**, and the decision reason says when a
hostile config was overridden. Spending is configuration-only: disabled →
deny; within `daily_limit_usd` → allow; above → approval; undeclared amount →
deny. The engine is frozen and exposes no mutation API. Unknown classes deny.

## 8. Routing and fallback (`provider-router.js`, `config/router.json`, `reputation.js`)

Routing considers capability, task type, availability, quota state, risk/cost
ranking, and reputation (tiebreak only, ≥5 recorded outcomes; unknown rates are
null, never invented). Quota exhaustion is never generic failure:
execution-authority tasks always `wait_for_quota` (fallback denied by config —
authority never silently changes); advisory task types listed in
`config/router.json` may fall back to a SAME-authority alternate, evented
`PROVIDER_FALLBACK` with from/to; exhausted fallbacks degrade to waiting;
resume returns to the primary.

## 9. Validation (`validation.js`)

Six independent validators — schema, completeness (fields + files), security
(secret shapes), git (claimed commits must exist), tests (injectable runner),
policy (actions used ⊆ classes granted) — plus an adversarial reviewer chosen
from the registry with the author excluded, briefed to find what is wrong.
Rejections feed a bounded repair loop (`VALIDATING → RETRYING` with recorded
findings → re-dispatch) ending in COMPLETED or FAILED at the attempt budget.

## 10. Events (`events.js`)

Typed durable events (enum-enforced) on the JSONL stream as source of truth;
in-process subscribers are isolated (a throwing handler is recorded, never
propagated); `replay(since)` is recovery. n8n integration is a fire-and-forget
webhook ADAPTER (`MYTHOS_EVENTS_WEBHOOK`, off by default) — n8n never becomes
the orchestration state store.

## 11. Controlled self-improvement (`self-improve.js`)

Mythos can build a development mission against its own repository —
implement → test → adversarial review → report — but caged: missions scoped at
the safeguard surface (policy engine, validation, events, store, redaction,
self-improve itself, service units, credential-shaped paths, `.git/`) are
refused at build time, and `checkWorktreeSafety` re-checks the REAL diff after
implementation, so an undeclared protected-path edit fails validation whatever
the mission declared. Work happens in isolated worktrees; the result is a
reviewable branch commit, never an auto-merge into the live checkout. Proven in
TEST S on a throwaway repository.

## 12. Phase 1 bridge (`orchestrator.executorBridge`)

Core tasks can dispatch through the UNCHANGED Phase 1 executor (headless
Claude sessions, quota lifecycle, retries, redaction). Executor quota surfaces
as core `WAITING_FOR_QUOTA`; an executor success returns as a result for core
validation. The deployed daemon and n8n workflows are untouched by Phase 2 —
nothing loads the core until it is explicitly invoked.

## 13. Honest status

*Corrected 2026-08-17 (Phase 2 finalization). The previous text understated
current capability — a production audit mission found the staleness itself and
recommended this correction.*

**Now true, with evidence:**

- **The core is the default execution path.** `MYTHOS_CORE_ENABLED` defaults
  **true**; only the exact string `false` rolls back to Phase 1, via the
  service's `EnvironmentFile` — no code change. Both directions are tested and
  were exercised on the deployed service.
- **The executorBridge has run real-quota missions end to end**, including one
  that hit a real 429 and resumed (see `docs/MYTHOS_FIRST_MISSION_REPORT.md`),
  and production goals now run through `POST /goals` with no feature flag.
- **Cumulative spend ledgers exist and are enforced** across
  REQUEST → MISSION → PROJECT/DAY → POLICY, atomically under real concurrency
  (`core/budget.js`, `docs/MYTHOS_BUDGET_LEDGER.md`).
- **Real multi-provider execution happens** for advisory work: the router has
  selected OmniRoute-served models (gpt-4o-mini) for live analysis tasks, and
  independent review runs on Gemini 3.6 Flash / GPT-4o / DeepSeek.

**Still NOT true, stated plainly:** Gemini has no *direct* Mythos execution path
(`gemini-advisor` reports UNCONFIGURED; no credential invented — it is reachable
only as a model served through OmniRoute); `claude-code` remains the only agent
with repository execution authority; reputation has little production history;
cost is runner-declared, so `known` means "the runner reported a figure", not
independently verified billing; `MISSION`/`REQUEST` budget scopes are enforced
but `PROJECT` all-time and monetary currencies beyond a single unit are not
exercised; and no mission has performed a real paid external action, because
every project's committed budget is 0 except the mock-only sandbox. Enabling any
of these requires its own stage and, where spending or deployment is involved, an
owner decision.
