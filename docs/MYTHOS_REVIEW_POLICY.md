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

### One project waits, the others continue

A stop is per task, never per host. The worker runs one task at a time (`MYTHOS_MAX_PARALLEL=1`
on Haddad — one model inference), but it *manages* many: dependencies are checked before a task
is claimed, so a task whose turn has not come has no executor record, no worktree and no GPU, and
a task stopped for a person has already finished executing. So project A can wait for a decision
for a day while B runs, C is queued and D finishes. Dependencies are per chain (`Depends on:` /
`يعتمد على`) and never global.

### Resuming is a new attempt that knows about the old one

It is **not** a checkpoint restore, and the difference matters:

- the continuation keeps its own single-use task id, records which attempt it continues, and
  receives that attempt's **report** in its prompt — summary, files, commits, checks, problems —
  with an instruction to verify it and spend the run only on what is missing;
- a task branch is named after the task id, so the continuation starts from a **fresh branch off
  `main`**. For a read-only task there is nothing to inherit. For a task that **commits**, the
  earlier commits stay on the earlier branch and the new attempt cannot see them — continuity
  there is guidance in a prompt, not restored state.

Editing the Issue before rerunning deliberately does **not** carry the approval forward: the next
attempt does different work, and work nobody has seen is not approved by a decision about work
they had. The content hash recorded on every attempt is what distinguishes the two cases.

### A dependency is satisfied by a trusted continuation

Dependencies name a task id, and ids are single-use — so the approved work completes under a
*different* id from the one a dependent was written against. A continuation therefore satisfies
the dependency it continues, but only when it is provably the same work carried forward. All
four must hold:

1. it **names** the dependency (`continues.task_id`);
2. it is a **later attempt of the same task** — same id stem, higher attempt number — so an
   unrelated task cannot claim to continue anything;
3. it really **completed**, a status only the bridge writes and only after an execution that
   passed every gate;
4. the **review is intact**: if the original owed a review, the continuation must carry an
   approved one, and a continuation that owes one itself must have it too.

Completion alone never releases a dependent whose work was supposed to be reviewed — that is the
point of the fourth condition. A chain of continuations carries satisfaction through, and one
unreviewed link breaks the whole chain. The walk is bounded, so a cycle cannot spin.

So `B depends_on A` waits while A is stopped for a person, waits while `A-r2` is running or has
failed, waits if something merely *claims* to continue A, waits if an edited rerun owes its own
review — and becomes eligible the moment a trusted, approved `A-r2` completes.

## Supervised execution on Haddad: what makes a pass a pass

The Haddad worker writes files and runs commands (`docs/` for the tool runner). Its own report
is **not** what decides whether the work is done. `lib/work-validation.js` produces the evidence
from three things the worker does not control:

- the **workspace**, snapshotted before the model is called and measured after, so what changed
  is observed rather than claimed;
- the **acceptance criteria**, re-run by the validator itself inside the same sandbox — a
  criterion that names a command (`node …`, `npm test`) is executed here, not believed;
- the **report**, checked for shape and for the failure it may be admitting.

The verdict comes from `core/validation.js` — the same validators that judge an
orchestration-core result — with this module supplying the injected `test_runner` they were
written to take. What it adds is the part those validators cannot know: which files the attempt
was allowed to touch, and whether a check's own file was edited or deleted to make it pass.

**Repair, bounded.** On rejection the worker receives its own measured failures in the format
the orchestrator already uses (`## REPAIR REQUIRED (attempt N)`): the failing check's real
output, what it actually changed, the rule that the cause is fixed rather than the check — and,
because a small model's commonest failure is to "fix" the file in prose and report success, the
brief names a round that made no tool call and ends with the next steps *as tool calls* in
order (`read_file`, `write_file` the complete file, `run_command` each failing check by name,
then report). Three executions in total; repair rounds are not retries and do not touch the
executor's retry budget. Each execution has its own turn budget (12) and tool-call budget (24),
and a repair round starts from a **compact** conversation — system, task, the rejected answer,
the brief — so context does not grow execution over execution (measured: a second execution
that replayed the first reached 6,400 of 8,192 tokens and the runtime dropped it). Every model
turn is bounded at 1,536 tokens. Running out of turns is a *rejected attempt* that re-enters
this path with the measured state (checks passing → "emit the report"; a check failing → fix
it), not a stop.

**Escalation, diagnosis only.** On the last repair round — the local model has by then failed
the task once and failed one measured repair — a stronger model may be asked for a diagnosis
and the exact corrected file, appended to the brief. It is handed the task, the measured
failures and the constrained files' current content; it has no tool, writes nothing, runs
nothing. The local model still does the work through `write_file` and the validator still
decides. Off unless the host names a diagnoser (`HADDAD_AGENT_DIAGNOSER`, a command line — on
Haddad: Sonnet through the Claude CLI with every tool disallowed); unset on the VPS, so nothing
changes there. Fail-open and recorded in the tool trace. Claude never becomes the executor.

**How it ends.** Validation passes → the task completes and the review gate applies as to any
completed task (an `implement` task owes a review and stops as `haddad:human-approval`).
Budget spent with a check still failing → the task stops for a person as `blocked`, which
`lib/quota.js` classifies as `HUMAN_APPROVAL`, with the measured rejections, the check outputs
and the per-call tool trace attached. Budget spent with **every declared check passing by the
validator's own run**, the work in scope, the check files intact and something changed — the
only rejections being about the worker's report — → the task completes with a report
**synthesized from the evidence** and marked so (`validation.report_synthesized`, a residual
risk naming it): the success is measured, not claimed. A failing check or an untouched
workspace is never synthesized into a pass.

**A pass is labelled honestly.** Criteria that can be run make a pass *mechanical*. Prose
criteria are legitimate and cannot be machine-checked, so such a task passes flagged
`mechanically_verified: false` rather than being dressed up as verified. A task that declared no
criteria is recorded as unverified, not failed — the omission is its author's, not the worker's.

**The sandbox under the daemon (owner decision, 2026-09-22).** `run_command` only ever runs
inside a bwrap namespace and fails closed without one. With
`kernel.apparmor_restrict_unprivileged_userns=1`, a service that has a private mount namespace
cannot create the user namespace bwrap needs — `ProtectSystem`, `ProtectHome`, `PrivateTmp`
**and `ReadWritePaths`** each do that (bisected with transient units and the provider's real
argv; `NoNewPrivileges` does not), and `--unshare-all` needs `AF_NETLINK` for loopback. The
worker unit therefore carries none of the four; the boundary sits around every command the model
runs, not around the daemon (`systemd/mythos-haddad-worker.service` says so; tool-runner test
U1 pins it). The daemon itself is no longer confined to its store by systemd.

**Proven live on Haddad (2026-09-22).** gh-issue-379: attempt 1 (12 tool calls) rejected by the
validator's own run of the second check → repair round 1 rejected → repair round 2 with the
Sonnet diagnosis → the local model wrote the diagnosed fix through `write_file` → both declared
checks pass by the validator's run (re-run by hand afterwards: 8/8 and 3/3) → completed with a
synthesized report → review gate → `haddad:human-approval` on the Issue. The runs before it are
the evidence for every other branch: gh-issue-373 (fake success — the fix pasted as prose, both
checks "claimed" passing, nothing written — caught), gh-issue-376 (three executions, the fix
rewritten nine times, "assume it is correct" caught, stopped as HUMAN_APPROVAL with the trace),
gh-issue-374 (all checks passing at the turn cap, report missing), gh-issue-375 (transient
retry then the pooled-socket failure), gh-issue-370/371 (the sandbox could not start under the
daemon — the task refused to pass unverified).

## What was deliberately NOT built

No queue, no daemon, no agent, no reviewer implementation, no HTTP endpoint, no async
`review_fn`. Wiring a real LLM judge into `review_fn` remains open and is a separate
decision: the seam is synchronous while every provider is asynchronous, which is why it was
never connected in the first place.

## Tests

`tests/mythos-review-policy-test.js` — 91 checks, deterministic and offline.
