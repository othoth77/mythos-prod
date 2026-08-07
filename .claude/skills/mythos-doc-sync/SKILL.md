---
name: mythos-doc-sync
description: Keep docs/AI_HANDOVER.md, docs/ROADMAP.md, and docs/CHANGELOG.md consistent with actual validated implementation — never mark a stage complete that wasn't.
---

# mythos-doc-sync

## What this skill does

After an implementation is validated, committed, and pushed:
- updates `docs/AI_HANDOVER.md` with objective, starting/final HEAD, implementation commit, files changed, validation results, and the exact next stage — in a separate commit from the implementation, per repository convention,
- updates `docs/ROADMAP.md` status for the stage that actually completed, without altering unrelated stage history,
- avoids self-referential "final commit" hashes (a commit can never correctly describe its own future hash) — see the pattern already established across this repository's INF-CF-* stage handovers.

**Never marks a future or unstarted stage as complete.**

## Governing documents

`AGENTS.md` §18 (Documentation requirements), `docs/AI_HANDOVER.md` (existing entries as style precedent).

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
