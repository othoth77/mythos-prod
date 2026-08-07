---
name: mythos-error-doctor
description: Diagnose recurring, previously-documented failure patterns in this repository (e.g. the _memCache core failure cascading into Stage 1-3 subprocess regressions) before treating a new failure as novel.
---

# mythos-error-doctor

## What this skill does

Before deep-diving a test or runtime failure, checks whether it matches a pattern already documented as pre-existing/known in this repository's stage handovers (e.g. the `_memCache` core failure referenced throughout `docs/AI_HANDOVER.md`'s Stage 3D/3C entries). If it matches, reports it as a known, unrelated, pre-existing issue rather than attempting an unscoped fix. If it does not match, diagnoses fresh but stays within the current task's scope (`AGENTS.md` §10).

### Known baseline-failing suites (lookup, not recollection)

As of Stage MPI-0-FINALIZATION, these six suites fail identically on `origin/main` and on every unrelated feature branch checked against it, via the `_memCache` core failure cascading into subprocess regressions:

- `tests/stage3c-test.js` (partial — subset of assertions fail)
- `tests/stage3b-test.js` (partial)
- `tests/stage3a5-test.js` (partial)
- `tests/stage3a-test.js` (subprocess error)
- `tests/stage2d-test.js` (subprocess error)
- `tests/stage1c-part1-test.js` (subprocess error)

`tests/stage3d-test.js` §9 runs all six as child processes and scores each as a single pass/fail — a failure inside any of the six surfaces as one of stage3d's own reported failures by design (see `tests/stage3d-test.js` lines ~727-759). A new stage introducing changes outside `js/`, `css/`, `.php`, or `index.html` that still shows exactly these six failures (104/110) is exhibiting `KNOWN_BASELINE_FAILURE`, not a regression — verify with a base-commit worktree comparison (`git worktree add`) rather than assuming, per `docs/AI_HANDOVER.md`'s MPI-0-FINALIZATION entry for the verification method.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.1.0 — see `docs/SKILLS_EVOLUTION.md`.
