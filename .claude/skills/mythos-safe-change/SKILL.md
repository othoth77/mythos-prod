---
name: mythos-safe-change
description: Enforce the repository's stage-execution lifecycle discipline for implementation work — smallest coherent change, targeted validation, documented commit, verified push.
---

# mythos-safe-change

## What this skill does

Applies AGENTS.md §7 (Stage Execution Lifecycle) and §8 (Validation Policy) to any implementation task:

1. Verify the previous stage on the remote base branch.
2. Define exact file and behaviour scope before editing.
3. Implement the smallest coherent change.
4. Run targeted syntax/static checks and targeted tests before any broader ones.
5. Review the final diff and staged file list before committing.
6. Commit with a focused message; push; verify remote HEAD.
7. Update `docs/AI_HANDOVER.md` in a separate commit after validation, never before.

## Governing documents

`AGENTS.md` §7-§8, §22 (Prohibited behavior).

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
