---
name: mythos-repo-guardian
description: Enforce this repository's AGENTS.md rules (source of truth, preflight discipline, scope control, security rules) before and during any change.
---

# mythos-repo-guardian

## What this skill does

Before any implementation task:
- confirms `git fetch origin`, clean worktree, local HEAD == origin/main (or the relevant base branch),
- confirms no unresolved merge/rebase,
- confirms the task's scope matches AGENTS.md §10 (Scope Control) — no opportunistic refactors, no unrelated file changes.

During the task, watches for violations of AGENTS.md §14-§17 (security, production/deployment, backup/restore, git rules) and stops at the first real blocker rather than working around it.

**This is the sole owner of git/worktree preflight in this repository.** `mythos-project-context` and `mythos-safe-change` delegate their preflight steps here rather than restating them — see `docs/SKILLS_EVOLUTION.md` §6.

## Stage Runner integration (DEVX-0)

`node scripts/mythos-stage.js status` and `node scripts/mythos-stage.js start <STAGE>` surface the same preflight facts this skill owns (dirty worktree, HEAD vs. `origin/main`, one-major-stage-rule state, dependency/blocker codes, PR state when `gh` is available) as a single machine-readable Stage Context. Treat its blocker codes (`DIRTY_WORKTREE`, `UNEXPECTED_MAIN_STATE`, `ANOTHER_MAJOR_STAGE_ACTIVE`, `DEPENDENCY_UNSATISFIED`, `UNKNOWN_STAGE`) as this skill's own preflight findings, not a separate authority — this skill remains the sole owner of what counts as a real blocker; the Stage Runner only automates the lookup.

## Governing documents

`AGENTS.md` (full document), `AGENTS.md` §24 (Agent Skills), `docs/DEVELOPMENT_WORKFLOW.md`.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.2.0 — see `docs/SKILLS_EVOLUTION.md`.
