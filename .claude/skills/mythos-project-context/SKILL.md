---
name: mythos-project-context
description: Surface the current Mythos repository state (branch, HEAD, active stage, AI_HANDOVER.md summary, ROADMAP.md priorities) before starting any task in this repository.
---

# mythos-project-context

Use this skill at the start of any non-trivial task in this repository.

## What to do

1. Run `git fetch origin`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/main`.
2. Read `docs/AI_HANDOVER.md` (top section) for the most recently completed stage and its verified state.
3. Read the relevant section of `docs/ROADMAP.md` for the product track the task touches.
4. Confirm the task does not conflict with the one-major-stage rule or an already-active implementation stage.
5. Report the current authorised stage for each relevant product track before proceeding.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
