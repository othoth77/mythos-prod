---
name: mythos-error-doctor
description: Diagnose recurring, previously-documented failure patterns in this repository (e.g. the _memCache core failure cascading into Stage 1-3 subprocess regressions) before treating a new failure as novel.
---

# mythos-error-doctor

## What this skill does

Before deep-diving a test or runtime failure, checks whether it matches a pattern already documented as pre-existing/known in this repository's stage handovers (e.g. the `_memCache` core failure referenced throughout `docs/AI_HANDOVER.md`'s Stage 3D/3C entries). If it matches, reports it as a known, unrelated, pre-existing issue rather than attempting an unscoped fix. If it does not match, diagnoses fresh but stays within the current task's scope (`AGENTS.md` §10).

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
