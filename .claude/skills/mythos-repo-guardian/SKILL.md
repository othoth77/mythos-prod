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

## Governing documents

`AGENTS.md` (full document).

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
