---
name: postflight
description: OTHMODE postflight — after completing any task, verify claims against Git/tests, sync documentation, record history/evolution outcomes, and leave an honest handover; delegates doc sync to mythos-doc-sync and change discipline to mythos-safe-change.
---

# postflight

## What this skill does

The OTHMODE-approved closing pass after any substantive task (Selector
verdict: **EXTEND** over `mythos-safe-change` + `mythos-doc-sync`, which own
their parts):

1. **Verify before claiming** — every "done" is re-derived from Git and test
   output (`mythos-safe-change` discipline; the orchestrator's verifier is
   the model: a report is only a claim).
2. **Regression floor** — targeted suites per the `targeted-test-scope` gene;
   report exact counts; 0 new failures.
3. **Doc sync** — delegate to `mythos-doc-sync` (AI_HANDOVER / CHANGELOG /
   ROADMAP consistency; never mark a stage complete that wasn't).
4. **History** — the work's execution record lives where it ran (executor /
   orchestrator state, mcc usage events); confirm it is visible in
   `GET /api/othmode/history` when on-host.
5. **Evolution recording** — if OthMode is ON and the task surfaced a
   repeated failure, a repeated success worth codifying, or a tool/skill
   gap: record a signal (`POST /api/othmode/evolution/signals` or the
   operator CLI). Not every task produces a signal; most produce none.
6. **Status truth** — outcomes that belong in the Status Center are recorded
   there by its own review process (`status-sync`), never duplicated.

## Boundaries

Postflight never rewrites history, never amends published commits, and never
upgrades a PARTIAL result to done for tidiness. An honest PARTIAL with a
reason beats a false PASS.

## Source

Classification: MYTHOS ORIGINAL (consolidation of existing checks; OTHMODE Phase 2).
Version: 1.0.0 — see `docs/SKILLS_EVOLUTION.md`.
