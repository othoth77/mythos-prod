# Mythos autonomous campaign — report

Campaign `c-msxnck3a-00282b`, project `mythos-prod`.
Objective: develop the remaining capabilities of the Master Vision safely,
with the system choosing its own work.

This report covers the campaign from its first mission through the
continuation run of 2026-08-17. It is a **status report, not a closing
report** — the campaign is `READY` and resumable from the same checkpoint.

## What the campaign actually did

| Capability | Mission | Commit | Repair cycles | Independently re-verified tests |
|---|---|---|---|---|
| R — (first live mission) | `m-msxnck4k-c73a6c` | `6811c49b3961` | 2 | **not re-verified — see below** |
| AF — Disaster recovery gap report | `m-msxr3282-cb6324` | `f433746` | 0 | 19/19 (new suite) + 125/125 + 257/257 |
| E — Durable execution | `m-msxrvyy1-34c260` | `bccfcbb` | 0 | 127/127 (+2 fsync) + 257/257 |
| M — Model / provider router | `m-msxsbzza-ffeb1e` | `f3e0580` + `f773494` | 0 | 130/130 (+5 router) + 257/257 |
| N — Provider health → selection | `m-msxsr86o-721696` | `beef996` | 0 | 264/264 (+7 health) + 127/127 |
| H — Context engine surfaces the portfolio ledger | `m-msxu28zj-87213f` | `2ad7a10` | 0 | 263/263 (+6) |

Each capability was selected by the loop from the roadmap, planned into a
six-task DAG, implemented in an isolated worktree, tested, adversarially
reviewed, validated and committed — with no human choosing the work. Five of
the six were accepted at zero repair cycles.

**Capability R is recorded `IN_PROGRESS`, not implemented.** It was accepted
under the earlier, looser gate on tests that were reported but never run. When
the gate was tightened the roadmap entry was honestly downgraded rather than
left overstated.

**Branch isolation holds.** All five delivered commits are 1–2 commits ahead
of `main` and none is an ancestor of `main`. The loop produces reviewable branches;
merging remains an owner decision and nothing auto-merged.

## Two governance defects found in this continuation

Both were in the evidence/governance layer, both were invisible to the
existing suites, and both are now regression-tested (`0f39e22`).

### 1. The acceptance gate was reading tests from the wrong tree

`scheduler.js` created an isolated worktree only for write-capable task types
(`coding`, `integration`, `documentation`). Every successor — `test`,
`review`, `report` — fell back to `opts.repo_path`, **the live main
checkout**. So the testing agent ran main's already-green suite and reported
PASS while the mission's change sat unexecuted on its branch, and the
adversarial reviewer read code the mission had never touched.

For an evidence-based gate this is the worst possible failure: the evidence is
green by construction and describes a tree nobody changed. Capability M made
it visible — its implement task measured 130/130 inside its worktree while the
test task reported main's 125/125 for the same mission.

Fixed at the cause (successors inherit the nearest upstream worktree by
walking `depends_on`; the scheduler records the tree it assigns) and guarded
at acceptance (`acceptMission` refuses a mission whose tests ran in a
different tree, or in no recorded tree).

Notably, the *agents were never dishonest*: each implement task reported its
own worktree results exactly, and re-running all four missions in their own
worktrees at their recorded commits reproduced every number precisely. What
was wrong was the pipeline's attribution, not the reporting.

**Proven live on the next mission.** Capability H ran through the corrected
pipeline: `implement`, `test`, `review` and `report` all executed in the one
tree `m-msxu28zj-87213f/tk-msxu28zk-09d478`, and the test task reported the
same commit (`2ad7a10`) and the same result (263/263) as the implement task
instead of main's 257/257. Re-running that worktree independently reproduced
263/263. Under the old behaviour those two numbers could not have agreed.

### 2. The governance cage did not cover the files that grant authority

`SELF_PROTECTED_PATHS` protected `core/policy-engine.js` but not
**`lib/policy.js`** — where every tool grant, the permanent `Bash(sudo:*)`
bans and the disabled `deploy` profile actually live. An unapproved
self-improvement could have rewritten the grants without touching a protected
file. Six more were added for the same reason: `tool-registry.js` (tool
authority), `lib/state.js` (Phase 1 checkpoint/audit integrity, twin of the
already-protected `core/store.js`), `campaign-runner.js` (`campaign.js` holds
`governanceGate` and `acceptMission`; the runner is what *calls* them),
`roadmap.js` (acceptance evidence and mission selection), and
`agent-registry.js` + `provider-router.js` (only the provider *configs* were
caged, never the code enforcing them).

Found because missions E and N legitimately edited `lib/state.js` and
`agent-registry.js` while both sat outside the cage. Both edits were hardening
and neither weakened anything — which is exactly why the gap would otherwise
have gone unnoticed. Protection means a mission parks for owner approval, not
that a file is frozen, so a wide list costs nothing.

## Governance behaviour observed

- A mission proposing to weaken the policy engine parked
  `WAITING_FOR_APPROVAL` with **zero agent invocations** — the cage refuses
  before spending anything.
- The durable event stream records 365 `DECISION_MADE`, 87 `TASK_STARTED`,
  55 `TASK_COMPLETED`, 30 `VALIDATION_FAILED`, 24 `REVIEW_REJECTED`,
  22 `TASK_RETRYING`, 3 `APPROVAL_REQUESTED`, 3 `BUDGET_DENIED`. The review
  and validation channels genuinely reject work; they do not rubber-stamp.
- Project memory holds 31 entries, each mission recorded with its commit and
  its tests explicitly labelled *agent-reported* — provenance is never
  laundered into fact.

## Test state

| Suite | Result |
|---|---|
| `mythos-autonomous-campaign` | 137/137 (was 118) |
| `mythos-orchestration-core` | 257/257 |
| `mythos-ai-executor` | 125/125 |
| `mythos-core-wiring` | 86/86 |
| `mythos-budget-ledger` | 121/121 |
| `mythos-reservation-lease` | 72/72 |

The 19 new campaign assertions cover both fixes: normalised and
non-normalised forms of all seven newly caged paths, that the test and review
tasks run in the implementation worktree, that no task is handed the live
checkout, and that perfectly passing tests are **refused** when they ran
outside the mission worktree. The production fix is what makes the existing
loop test pass — the mock was not loosened to accommodate it.

Pre-existing and unrelated failures, none caused by this work — **no failing
suite references any module changed here** (`core/scheduler.js`,
`core/campaign.js`, `core/campaign-runner.js`, `core/self-improve.js`),
checked mechanically:

- `tests/core-test.js` — `_memCache is not defined`, last touched 2026-07-29,
  three weeks before this campaign, by an unrelated stage.
- The legacy `stage1c-part1`, `stage2d`, `stage3a`, `stage3a5`, `stage3b`,
  `stage3c` and `stage3d` suites — the documented `KNOWN_BASELINE_FAILURE`
  set in `projects/meta/known-baselines.json`.
- `stage3e`, `stage3f`, `stage3g` and `stage3h` also fail and are **not** in
  that file. They are still not caused by this work: all four fail identically
  when run at `7560f68`, the commit before these changes. They are
  undocumented pre-existing failures, and either the suites or the baseline
  file should be reconciled — out of scope here, but four failures sitting
  outside the recorded baseline is how a real regression eventually hides.
- `sya-api-1-readonly-catalog-api` and `sya-shop-1-storefront` — env-blocked
  on the deploy-owned database credential this session correctly cannot read.

Of the 26 suites an output-matching sweep flagged, **13 actually pass** when
judged by exit code; every `stage4*` suite is in that group.
- `ida-*`, `mcc-1` and `sya-*` — env-blocked without their databases.

A caution for future sweeps: pass/fail must be read from the **exit code**,
not by grepping output for "0 failed". Several legacy suites print neither
phrase and were wrongly counted as failures by a text-matching sweep, and
`mythos-orchestrator-0-test.js` needs well over 90 seconds — it passes when
given time and only looked broken under a short timeout.

## Safety constraints

No commit references `projects/ssangyong-autos/`; `/var/www/ssangyong.autos`
is untouched; this session has no Docker access, so the three frozen SSANGYONG
n8n workflows could not have been altered. No force-push, no history rewrite,
no amended pushed commit. No real money, advertising spend, publishing or
irreversible external action. Delivery went through the persistent relay and
was verified against the remote.

## Where it stands

The campaign is `READY` with six completed missions and none blocked. It
stopped only because the driver's `max_steps` budget ran out — `READY` with no
`current_mission` means "will select next", not "finished". Resuming it
continues from the same persisted checkpoint.

Open for the owner: review and merge decision on the five mission branches,
and whether capability R should be re-attempted now that tests genuinely run
against mission code.
