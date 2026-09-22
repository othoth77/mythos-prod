# Mythos Review Policy — fail-closed independent review

**Status:** implemented in `projects/mythos-ai-executor/core/` · 2026-09-21
**Scope:** the Phase 2 orchestration core (missions, campaigns). The Phase 1 executor,
the GitHub Bridge and Mythos Haddad are **not** on this path and are unchanged.

## The finding

`core/validation.js` ran its adversarial review only when a `review_fn` was injected.
When none was — which is every production call site — `adversarialReview()` returned
`{ performed: false, verdict: 'no_review_function' }`, and the settlement read

```js
if (review.performed && review.verdict === 'reject') { /* reject */ }
```

so a review that never happened was indistinguishable from a review that passed. The
task settled `COMPLETED`. The failure was silent: nothing on the task, and nothing in the
event stream, said that the work had never been reviewed.

## What already existed (and was reused)

The system has **two** legitimate review mechanisms, and the fix is to make them add up
rather than leave a hole between them.

1. **The DAG review task.** `core/planner.js`, `core/campaign.js` and `core/self-improve.js`
   put a real `task_type: 'review'` task into every plan they build, routed to a reviewer
   agent like any other task. The campaign acceptance gate already refuses a mission whose
   review task did not complete (`core/campaign.js`).
2. **The in-process reviewer.** `adversarialReview()` driven by the injectable `review_fn`.

What was missing was never a reviewer — it was the **requirement**. Nothing tied "this task
changed the repository" to "this task was reviewed".

## The policy

**1. Who owes a review** — `validation.reviewRequirement(task, result)`, pure, decided from
data the task already carries:

| Condition | Owes a review |
|---|---|
| `task_type: 'review'` | **never** — re-reviewing a review is a category error, and metadata cannot override it |
| `metadata.review_required === true` | yes |
| `metadata.review_required === false` | no (recorded as `waived_by_task_metadata`) |
| `task_type` ∈ `coding`, `integration` | yes |
| `metadata.commit_required === true` | yes |
| the result claims a real commit | yes |
| anything else (analysis, research, reporting, inspection, planning…) | no |

Read-only work therefore behaves exactly as before. `documentation` owes a review only when
it actually commits.

**2. How the requirement is satisfied** — one of three, checked in this order:

- an in-process reviewer passed it; or
- **assurance**: a `review` task downstream of this one in the same mission still exists and
  can still run (`validation.reviewAssured`, reading `depends_on` and the existing DAG doom
  analysis); or
- the caller explicitly waived review (`opts.review === false`), which is recorded in the
  event stream as `review_source: 'waived_by_caller'` — allowed, never silent.

Assurance is deliberately **not** "the review already completed". The mission's review task
*depends on* the task being settled, so requiring completion here would deadlock every plan
the planner produces.

**3. Otherwise: park, do not fail.** The task moves `VALIDATING → REVIEW_REQUIRED` carrying
`review_block_reason`, `review_requirement`, `review_sensitive` and any refused candidates,
and a `REVIEW_REQUIRED` event is appended. The result is preserved and no repair attempt is
consumed: the execution was sound, only the review is missing.

Reason codes: `no_reviewer_available`, `no_review_function`,
`reviewer_not_trusted_for_sensitive`, `reviewer_equals_author_refused`.

**4. Who may review** — `review_scope` in `config/agents.json`, a privilege declaration that
fails closed:

- any review-capable agent may review **standard** work;
- only an agent that explicitly declares `"sensitive"` may review **sensitive** work —
  a result that changes the system: a commit, or a `PROJECT_WRITE`/`GIT`/`SERVICE`/`DEPLOY`/
  `ROOT`/`DESTRUCTIVE`/`MONEY_SPEND` class;
- an agent that declares nothing, declares a malformed value, or declares an unknown scope
  is **standard-only**. Unknown capability → fail closed.

Shipped: `claude-code`, `omniroute-advisory` and `gemini-advisor` are `["standard","sensitive"]`;
`free-llm-pool` is `["standard"]`. A small or free-tier model never becomes the reviewer of a
commit merely because it is the only one available.

**5. Claude is a fallback, not a dependency.** No special case was written for it. The
registry already ranks candidates `available → risk ascending → cost ascending`, and
`claude-code` is `risk: high`, so it is selected only when no other reviewer is available.

## State machine

```
VALIDATING → REVIEW_REQUIRED        (validation only)
REVIEW_REQUIRED → COMPLETED         (recorded passing verdict)
REVIEW_REQUIRED → RETRYING          (rejection → existing repair loop, findings attached)
REVIEW_REQUIRED → FAILED            (no attempts left, or an owner decision)
REVIEW_REQUIRED → CANCELLED
```

There is no edge from `RUNNING` into the state and none back out to `RUNNING`: an agent can
neither park itself nor re-execute itself out of its own gate. The executor compat view
reports it as `BLOCKED`.

The only exit is `validation.resolveReview(taskId, { verdict, reviewer, findings, decided_by })`.
Only an explicit `'pass'` passes; the author may not sign off their own task; a rejection
re-enters the existing repair loop with `validation_rejections` and the existing repair hint,
and fails the task when the attempt budget is spent. There is no timer and no "assume pass".

## Consequences

- A mission with a parked task becomes `WAITING`, never `FAILED`, and the parked task is
  never re-dispatched — `promoteReady` only promotes `QUEUED`/`WAITING_FOR_DEPENDENCY`.
- Budget is settled once, when the work ran (at `VALIDATING`); resolving a review later
  settles nothing further.
- Reputation is not recorded for a parked task: the agent neither succeeded nor failed.
- A campaign parks for the owner (`action_class: 'REVIEW'`) instead of ticking forever.
- **Operational risk, accepted:** an environment with no eligible reviewer will park every
  write task. That is visible, traceable and resolvable by decision — the alternative is
  accepting unreviewed work, which is what this change exists to stop.

## Provenance of the waiver

`metadata.review_required: false` is a privilege downgrade, so it must never arrive from
untrusted data. Two existing allow-lists already prevent it, and both are now covered by
tests: `POST /goals` rejects any unexpected field (`core-wiring.js` `GOAL_FIELDS`), and a
generated plan cannot set task metadata at all (`planner.js` `SPEC_TASK_FIELDS`).

## The GitHub bridge path (Mythos Haddad)

The bridge/executor path does not run through the orchestration core, so for a while this policy
did not apply to it at all: a Haddad task reached `COMPLETED` — the status that releases its
dependents — without the question of review ever being asked.

`bridge/review-gate.js` is the connection, and it is an adapter, not a second engine. It
translates a bridge task and its report into the shapes this module already reads and returns
**this module's** verdict:

| Bridge fact | Core shape | Consequence |
|---|---|---|
| `requested_action` delivers a `commit` (`implement`, `document`) | `task_type: 'coding'` | owes a review |
| `requested_action` delivers a `report` (`investigate`, `review`, `test`) | `task_type: 'analysis'` | owes none |
| execution profile is `repo-write` / `autonomous` / `deploy` | write policy classes | sensitive |
| the report claims a commit | `result.commit` | owes a review |
| `review_required: true` on the task (`Review: required` in the Issue) | `metadata.review_required` | owes a review |

The field can only **escalate**: there is no value of `review_required`, and no spelling in an
Issue, that waives a review the policy requires — a waiver arriving as data would be a privilege
downgrade written by whoever opened the Issue.

No automated reviewer is wired into that path, because whether one LLM may judge another's work
is still an open owner decision. A task that owes a review therefore stops for a **person**,
through the state the bridge already has for exactly that (`BLOCKED` + `human_approval`, shown on
the Issue as HUMAN APPROVAL). The owner approves by adding the `rerun` label; the continuing
attempt records which attempt it continues and why, and that record — `continues.reason ===
'review_required'` — is the approval. Continuing a *failed* attempt is continuity only and
approves nothing.

The gate is off unless `MYTHOS_BRIDGE_REVIEW_GATE` is set, and when it is off the core is never
even loaded, so the production VPS bridge is unchanged. When the policy module cannot be loaded
at all, the gate fails closed: the task stops rather than completing unreviewed.

Note that this consults the review *policy* — a pure decision function — and never starts the
orchestration core; that is why it works on Haddad, where `MYTHOS_CORE_ENABLED=false` keeps the
core's execution path deliberately switched off.

## What was deliberately NOT built

No queue, no daemon, no agent, no reviewer implementation, no HTTP endpoint, no async
`review_fn`. Wiring a real LLM judge into `review_fn` remains open and is a separate
decision: the seam is synchronous while every provider is asynchronous, which is why it was
never connected in the first place.

## Tests

`tests/mythos-review-policy-test.js` — 91 checks, deterministic and offline.
