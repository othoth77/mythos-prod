---
name: mythos-test-intelligence
description: Select and reason about the right test scope for a given change in this repository — targeted tests first, full suite only when justified.
---

# mythos-test-intelligence

## What this skill does

Applies AGENTS.md §8 (Validation Policy): runs targeted tests covering the changed module, direct callers, and known regression risks before considering the full suite. Runs the full suite only when finalising a significant architectural stage, when shared core behaviour changed, when targeted tests reveal broader regression risk, or when explicitly requested.

Aware of this repository's `tests/stageXX-test.js` naming and harness convention (custom `ok()`/`section()` runner, no external test framework dependency).

## Governing documents

`AGENTS.md` §8.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
