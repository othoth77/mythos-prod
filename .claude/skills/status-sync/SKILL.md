---
name: status-sync
description: OTHMODE status sync — keep the Status Center the single execution truth; reconcile via its own review engine, read it from OTHMODE, and never create a second status writer.
---

# status-sync

## What this skill does

Applies the Memory-vs-Status separation (docs/othmode/OTHMODE_ARCHITECTURE.md
§5) whenever status is involved:

1. **The Status Center is the execution truth.** What was done, when, with
   what evidence, blockers and next action live in
   `projects/status-center/` + `sites/status.mythosprod.xyz/` — an
   append-only, evidence-verified record, owner-controlled in production.
2. **Updating status** = running ITS engine
   (`node projects/status-center/bin/review.js`, `--dry-run` first), or the
   owner editing its curated registry. Nothing else writes status. OTHMODE,
   the executor, this skill — all are readers.
3. **OTHMODE reads it** through `GET /api/othmode/status` (a read-only view
   labeled as such in the UI) and links out to the live surface.
4. **Knowledge vs status:** a durable decision or architectural fact goes to
   OTH Knowledge (operator CLI); an execution outcome goes to the Status
   Center; a session-continuity note goes to the handover. One fact, one
   home — duplication is the failure mode this skill exists to prevent.

## Boundaries

`status.mythosprod.xyz` is PROTECTED in mythos-deploy and stays outside every
automated path. This skill never proposes automating writes to it.

## Source

Classification: MYTHOS ORIGINAL (boundary formalization; OTHMODE Phase 2).
Version: 1.0.0 — see `docs/SKILLS_EVOLUTION.md`.
