---
name: mythos-test-intelligence
description: Select and reason about the right test scope for a given change in this repository — targeted tests first, full suite only when justified.
---

# mythos-test-intelligence

## What this skill does

Applies AGENTS.md §8 (Validation Policy): runs targeted tests covering the changed module, direct callers, and known regression risks before considering the full suite. Runs the full suite only when finalising a significant architectural stage, when shared core behaviour changed, when targeted tests reveal broader regression risk, or when explicitly requested.

Aware of this repository's `tests/stageXX-test.js` naming and harness convention (custom `ok()`/`section()` runner, no external test framework dependency).

## Test selection (DEVX-0)

**Use `projects/meta/test-impact-map.json` to select targeted tests instead of re-deriving scope from scratch.** Map each changed file's path to its `targeted_tests` and `risk_lane`; a change touching multiple prefixes takes the union of tests and the highest matched risk lane. An unmapped path falls back to the map's `fallback` entry (full suite required) rather than assuming a narrow blast radius. `node scripts/mythos-stage.js close <STAGE>` runs this derivation automatically from the changed-file diff against `origin/main`.

**Use `projects/meta/known-baselines.json` before treating a failure as a regression.** If the failure count matches a recorded baseline exactly, classify it `KNOWN_BASELINE_FAILURE` and verify via an isolated `git worktree` comparison against the base commit rather than assuming — delegate the actual pattern-matching diagnosis to `mythos-error-doctor`.

## Governing documents

`AGENTS.md` §8, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.1.0 — see `docs/SKILLS_EVOLUTION.md`.
