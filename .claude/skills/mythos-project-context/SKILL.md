---
name: mythos-project-context
description: Surface the current Mythos repository state (branch, HEAD, active stage, AI_HANDOVER.md summary, ROADMAP.md priorities) before starting any task in this repository.
---

# mythos-project-context

Use this skill at the start of any non-trivial task in this repository.

## What to do

1. Delegate git/worktree preflight (`git fetch origin`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse origin/main`) to `mythos-repo-guardian` — do not restate it here.
2. **Prefer `projects/meta/current-context.json`** (regenerate first via `node scripts/mythos-stage.js context` if it looks stale) over a broad repository scan — it already surfaces `main_head`, `active_branch`, `active_stage`, `last_completed_stage`, `next_owner_priority`, `active_prs`/`draft_prs`, `known_blockers`, `known_baselines`, `relevant_tracks`, and `relevant_skills` in one small file.
3. Read `docs/AI_HANDOVER.md` (top section) for the most recently completed stage and its verified state.
4. Read the relevant section of `docs/ROADMAP.md` for the product track the task touches.
5. Read `docs/PROJECT_STATUS.md` for the current cross-track snapshot, the latest entry in `docs/history/DAILY_HISTORY.md` for recent activity, and `docs/PROJECT_STATISTICS.md` if the task needs current counts.
6. Confirm the task does not conflict with the one-major-stage rule or an already-active implementation stage.
7. Report the current authorised stage for each relevant product track before proceeding.

## Short-command integration (DEVX-0)

When the owner names a stage (e.g. "Start INF-OVH-API-0 according to Mythos workflow"), run `node scripts/mythos-stage.js start <STAGE>` and use its returned Stage Context (risk lane, relevant skills, relevant files, required tests, known baselines, blockers) instead of re-deriving that information by hand. See `docs/DEVELOPMENT_WORKFLOW.md`.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.2.0 — see `docs/SKILLS_EVOLUTION.md`.
