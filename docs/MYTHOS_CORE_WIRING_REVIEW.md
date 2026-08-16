# Mythos Core Wiring — independent multi-model review record

**Stage:** MYTHOS CORE WIRING · **Date:** 2026-08-16 · **Reviewed commit:** `60813d4`
**Reviewers:** independent models reached through the existing OmniRoute gateway
(`127.0.0.1:20128`, OmniRoute's own upstream credentials — **no provider
credential was created or invented for this review**). Fable 5 quota was
deliberately not spent on these reviews.

| Role | Model requested | Served by | Outcome |
|---|---|---|---|
| Architecture | `openrouter/google/gemini-3.6-flash` | google/gemini-3.6-flash | Responded; found the cancellation race (below) |
| Architecture (2nd) | `openrouter/qwen/qwen3.8-max` | — | **Failed**: "upstream returned an empty response" — recorded, not hidden |
| Adversarial | `openrouter/google/gemini-3.6-flash` | google/gemini-3.6-flash | `bypass_possible: false` |
| Adversarial (2nd) | `gpt-4o` | openai/gpt-4o | `bypass_possible: false` |

**Gemini note:** Gemini has no *direct* Mythos execution path — the
`gemini-advisor` agent still reports UNCONFIGURED because
`~/.config/mythos-ai-executor/gemini.env` does not exist and no credential was
invented. Gemini was reachable here only as a model *served through OmniRoute*,
which is a configured gateway path. Both facts are true simultaneously and are
recorded as such.

## Architecture review — the finding that mattered

The Gemini architecture reviewer traced a concrete failure sequence:

> `cancelExecutorTasksFor` checks `coreTask.metadata.executor_task_ids` …
> [it] is still `undefined` because `registerExecutorTask` is only attached to
> `.then()` of the `bridge(...)` promise, which only fires after `runTask`
> resolves … No Phase 1 task is found or cancelled.

**Verified against the repository, reproduced with a failing test, then fixed.**
This was a genuine race that defeated the stage's own purpose: a cancellation
arriving while a task was RUNNING would orphan the in-flight executor task —
precisely the resurrection bug the wiring exists to prevent.

Reproducing it surfaced two further real defects:

| # | Defect | Severity | Fix | Commit |
|---|---|---|---|---|
| 1 | Cancellation race — executor task registered only after the bridge promise resolved | CRITICAL (defeats the stage's purpose) | Register synchronously in `executorBridge`, before the run starts; `cancelExecutorTasksFor` takes a union re-read from the store | `64c8e4c` |
| 2 | Self-signal — a recorded pid equal to this process would `SIGTERM` the orchestrator itself | HIGH | Never signal self/parent; still cancel the task record | `64c8e4c` |
| 3 | Supersession — each attempt creates a new executor task; the prior one stayed non-terminal (e.g. `WAITING_FOR_QUOTA`) and the Phase 1 daemon would resume it behind the core | HIGH (duplicate work, wasted quota) | Retire prior executor tasks before each attempt; record the supersession | `64c8e4c` |
| 4 | Daemon/core race — the Phase 1 daemon dispatched bridge-created tasks, racing the core for the RUNNING transition | HIGH | Tasks with `requested_by='orchestration-core'` are skipped by daemon recovery, dispatch, retry and quota resume | `00026a5` |

Defects 2–4 were found while proving defect 1 — each has a regression test.

## Adversarial review — eight attack classes, both reviewers

Question posed: *"Can an agent, a provider, or an API caller bypass the Mythos
policy engine or gain authority it was not granted through the new Core
Wiring?"* Both independent reviewers answered **no**, each citing blocking code:

| Attack | Gemini 3.6 Flash | GPT-4o | Blocking code cited |
|---|---|---|---|
| Destructive operation reaching execution | BLOCKED | BLOCKED | `policy-engine.js` `HARD_FLOOR = { ROOT: 'deny', DESTRUCTIVE: 'deny' }` |
| Deploy without approval | BLOCKED | BLOCKED | `scheduler.js` dispatch → `require_approval` unless a GRANTED approval exists |
| Unbudgeted money spend | BLOCKED | BLOCKED | `checkPolicy` requires a numeric `amount_usd`; disabled → deny |
| Fallback granting execution authority | BLOCKED | BLOCKED | authority comes from registration; `executorBridge` derives the profile from `agentDef.execution_authority` |
| Approval bypass / replay | BLOCKED | BLOCKED | `decideApproval` requires `PENDING`, throws `APPROVAL_ALREADY_DECIDED` |
| Tool authorization escape | BLOCKED | BLOCKED | `grantTools` + grant-checked `invoke` |
| Feature flag defeat | BLOCKED | BLOCKED | `assertEnabled()` at every core-wiring entry point |
| Goal API as a command channel | BLOCKED | BLOCKED | `validateGoalPayload` field whitelist + static `MISSION_KINDS` |

No finding from either adversarial reviewer required a code change; no
speculative change was made on a reviewer's say-so. Nothing was modified during
the reviews themselves (read-only, as ordered).

## Live production evidence (post-fix)

- **Negative security test through `POST /goals`:** destructive request →
  **HTTP 400**, `GOAL_REJECTED: PLAN_POLICY_DENIED … DESTRUCTIVE → deny`.
  Refused at the plan gate; nothing persisted, nothing executed.
- **Real controlled mission through `POST /goals`** (goal `g-mswd0vw9-1a9c03`,
  mission `m-mswd0vwc-de2489`): 3/3 tasks COMPLETED on real Claude via the
  bridge, validation passed on each, report `rp-mswd51vn-64372c`, memory
  updated, events emitted (`GOAL_CREATED`, `MISSION_PLANNED`, `MISSION_STARTED`,
  `TASK_STARTED`×3, `VALIDATION_PASSED`×3, `TASK_COMPLETED`×3,
  `MISSION_COMPLETED`, `MEMORY_UPDATED`). **Zero orphaned executor tasks
  afterwards** — the lifecycle fixes hold in production.
- The mission's own finding: the policy engine has **no cumulative daily spend
  ledger** (`policy-engine.js` checks each request against `daily_limit_usd`
  individually), confirming the honest-status note in
  `docs/MYTHOS_ORCHESTRATION_CORE.md` §13. Recommended as the next spend-safety
  improvement — not implemented in this stage.
