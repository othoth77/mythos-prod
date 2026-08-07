---
name: mythos-context-assembler
description: Select only the relevant context (REQUIRED/USEFUL/IRRELEVANT/FORBIDDEN) for a given user, organisation, and task, and assemble it into a minimal, permission-filtered context set — never a full history dump.
---

# mythos-context-assembler

## What this skill does

Implements `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §2: classifies every candidate context item, excludes `FORBIDDEN` items before relevance is ever considered, and assembles global rules + domain context + organisation context + role/permissions + relevant user preferences + relevant memory + current conversation/task into a minimal set.

**Never implements or calls a `loadAllUserMemory()`-shaped operation.**

## Reference implementation

`projects/personal-intelligence/reference/context-assembler.js` (illustrative, in-memory, not production).

## Governing documents

`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`, `docs/MYTHOS_USER_MEMORY_POLICY.md` §5.

**Naming note:** this skill deliberately shares a name with the future MPI-1 *runtime* component of the same name. This skill is the agent-development-layer design/implementation-guidance counterpart — it is not the runtime component itself, and is never directly reachable from an end-user request. See `docs/SKILLS_ARCHITECTURE.md` §1.

## Source

Classification: MYTHOS ORIGINAL — new in MPI-0. See `docs/SKILLS_SOURCES.md`.
Version: 1.0.1 — see `docs/SKILLS_EVOLUTION.md`.
