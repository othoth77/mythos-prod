# Mythos autonomous development loop

**Stage:** MYTHOS AUTONOMOUS DEVELOPMENT LOOP (first self-developing version)
**Code:** `projects/mythos-ai-executor/core/{campaign,campaign-runner,roadmap}.js`
**Suite:** `tests/mythos-autonomous-campaign-test.js` (offline, mock agents, no real
quota, no real money)

The purpose of this stage was **not** to finish Mythos. It was to build the
smallest loop capable of finishing Mythos safely, so the loop itself becomes the
mechanism for the remaining roadmap.

## The loop

```text
Goal → Campaign → read the Master Vision roadmap
     → select the next highest-value SAFE capability
     → plan a mission DAG → agents/tools → policy + budget
     → execute in an ISOLATED git worktree (parallel where independent)
     → tests → independent adversarial review → bounded repair
     → evidence-based acceptance → commit
     → Memory → roadmap update → propose the NEXT mission → repeat
```

Every step is durable. A campaign survives restarts, quota pauses and approval
waits, and resumes from its checkpoint rather than restarting.

## Roadmap selection (`roadmap.js`)

The committed Master Vision is the authoritative roadmap: 32 capabilities are
parsed from the real document with their `IMPLEMENTED / PARTIAL / DESIGNED /
PLANNED / CONCEPTUAL` status. Remaining work is scored by **readiness** (how far
along it already is) minus a penalty for the **delivery phase the document
itself names** — a value signal the roadmap provides, not an implementer's
preference.

A capability is **not** autonomously selectable when it is already implemented,
merely conceptual (a human design decision comes first), or **governance**.
Progress is recorded only with `{ commit, tests }` evidence; the roadmap can
never be marked done by assertion.

## The governance cage

The system may improve adapters, integrations, docs, tests, providers and
tools. It may **never** modify policy authority, budget enforcement, approval
requirements, secret handling, Git delivery security, audit/event integrity,
destructive-operation limits or the emergency rollback.

Three independent barriers, because one is not enough:

1. **Selection** — governance capabilities are never chosen (8 of the real
   roadmap's capabilities are excluded on this basis).
2. **Declared scope + objective** — a mission scoped at a protected path is
   parked for approval, and so is one whose *objective* proposes weakening a
   boundary even when its scope looks innocent. Paths are normalised first, so
   `core/../core/policy-engine.js` cannot slip past a substring check.
3. **The real diff** — after implementation, `git diff --name-only` is checked
   against the protected surface. A governance edit hidden in the actual change
   fails acceptance and escalates; it is never auto-repaired.

`core/campaign.js` is itself on the protected list.

## Acceptance is evidence, not assertion

A mission is COMPLETED only when every task completed, a commit exists **and
Git confirms it**, real test results were reported, the independent review
completed, and the real diff touches no protected path. An agent saying "done"
is not enough — a fabricated commit hash is refused.

## Failure handling

Ten kinds, none collapsing into a generic FAILED: `TRANSIENT` retries,
`QUOTA` pauses the campaign, `POLICY` / `BUDGET` / `AUTH` escalate to approval,
`CODE` / `TEST` / `REVIEW` repair (bounded by `max_repair_cycles`, then
escalate), `INFRASTRUCTURE` / `UNKNOWN` block. Classification reads the **real
task errors**, not the acceptance summary — otherwise a pending task named
"review" would make an outage look like a review failure.

## What the first real campaign taught us

The first live run selected capability R itself, ran inspect (Claude) and
research (OmniRoute) in parallel, and implemented it in an isolated worktree —
then **burned its repair budget and escalated to approval**. The work was not
the problem: the adversarial reviewer was being pointed at the mission's own
`review` task, grading a reviewer's findings against an implementation contract.
No unit test caught it because the mock reviewer always passed. Fixed, with a
regression test, and the suite gained a second mock agent — validation refuses
to let an author review its own work, so a single-agent registry had silently
left the review channel unavailable.

That is the loop behaving correctly under a real defect: it stopped, preserved
state, and asked for a human rather than forcing a result.

## Independent review

Gemini 3.6 Flash, GPT-4o and DeepSeek Chat (via OmniRoute; no Fable 5 quota)
audited the loop for runaway loops, self-modification, policy/budget bypass,
repeated missions, infinite repair, Git corruption, context/memory poisoning and
provider escalation. GPT-4o: cage not escapable, no runaway. DeepSeek claimed the
cage *was* escapable; investigation upheld a **different** mechanism than the one
described (non-normalised paths, now fixed) and rejected the rest with tests.
Gemini found a genuine **memory-poisoning** vector: agent-written text entered
long-term memory at confidence 1.0 where it could later steer mission selection.
Agent text is now flattened, stripped of instruction markup, hard-capped,
labelled agent-reported and stored at 0.8 confidence, and commits are only
recorded when they match a real SHA shape.

## Human role

The human supplies a high-level goal and decides the things a machine must not
decide alone: approvals, credentials, budget increases, governance changes,
destructive operations and genuine blockers. Everything between — planning, agent
selection, execution, review, repair, testing, Git, memory, next mission — is the
loop's job.

## Honest limits

- Governance detection uses committed path lists plus keyword matching on
  objectives; it is deliberately broad (false positives are acceptable, false
  negatives are not) and a capability whose *title* merely contains a governance
  word is excluded even if benign.
- The loop produces a **reviewable branch commit**; merging to `main` remains a
  human decision. Nothing auto-merges.
- Development missions spend provider quota, not money: every project's
  committed budget is 0 except the mock-only sandbox.
- Selection ranks by document status and phase. It does not model dependencies
  between capabilities, so a chosen item may still turn out to need another
  first — the mission then reports that rather than guessing.
