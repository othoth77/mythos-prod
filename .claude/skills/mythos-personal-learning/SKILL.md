---
name: mythos-personal-learning
description: Run the controlled personal-learning pipeline (observation -> candidate -> established -> explicit rule) for a single user, with scope defaulting to user, never auto-promoting to organisation/domain/global without explicit governance.
---

# mythos-personal-learning

## What this skill does

Implements `docs/MYTHOS_USER_MEMORY_POLICY.md` §2-§4: classifies an interaction observation, tracks evidence count and confidence, checks for conflicts with existing preferences (a newer explicit rule supersedes an older established preference), and persists or discards accordingly — always audited.

**Default learned scope is `user`.** Promotion to a wider scope requires explicit governance/authorisation and is never performed automatically by this skill.

## Reference implementation

`projects/personal-intelligence/reference/learning-engine.js` (illustrative, in-memory, not production).

## Governing documents

`docs/MYTHOS_USER_MEMORY_POLICY.md`.

**Naming note:** this skill deliberately shares a name with the future MPI-2 *runtime* component of the same name. This skill is the agent-development-layer counterpart, not the runtime component. See `docs/SKILLS_ARCHITECTURE.md` §1.

## Source

Classification: MYTHOS ORIGINAL — new in MPI-0. See `docs/SKILLS_SOURCES.md`.
Version: 1.0.1 — see `docs/SKILLS_EVOLUTION.md`.
