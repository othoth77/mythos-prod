# Mythos — Project History System

**Stage:** MPI-0-FINALIZATION
**Date:** 2026-08-06

## Purpose

A permanent, GitHub-based historical record of Mythos development, distinct from and never substituting for conversation memory.

## Source Priority (mandatory)

1. `git log` on `main` — the factual event source (what actually happened, when).
2. `docs/AI_HANDOVER.md` — stage semantics (objective, scope, validation, safety confirmation per stage).
3. `docs/ROADMAP.md` — stage intentions and current status.
4. Pull Request metadata (title, merge commit, review state) — review/merge context.
5. `docs/CHANGELOG.md` — user-facing summary of notable changes.

**Conversation memory is never the sole source for a historical fact recorded here.** If a claim in this history cannot be traced to one of the five sources above, it does not belong here.

## Files in This Directory

- `DAILY_HISTORY.md` — the detailed, append-oriented daily ledger. One entry per verified development day, not one line per commit.

## Files Elsewhere in the History System

- `docs/PROJECT_HISTORY.md` — the high-level chronological narrative (eras/stages, not commits).
- `docs/PROJECT_STATUS.md` — the current "where are we now" snapshot.
- `docs/PROJECT_STATISTICS.md` — statistics derived from verifiable repository information.
- `projects/meta/project-ledger.json` — the machine-readable counterpart to all of the above.

## Backfill Rules

- Backfill only what is derivable from the five sources above.
- Do not invent missing days or fabricate activity for a date with no repository evidence.
- Where evidence conflicts (e.g. a worklog implies more activity than the commit log for the same date shows), record `HISTORICAL_CONFLICT` and name the competing sources — do not silently pick one.
- For stages whose exact date is genuinely uncertain even after checking all five sources, record `date_status: UNKNOWN` rather than guessing.

## Correction Policy

The ledger is append-oriented. A correction to a previously recorded day is itself a new, dated entry or an explicit amendment note — history is not silently rewritten. See `docs/history/DAILY_HISTORY.md` §"Corrections and Amendments".

## Maintenance

Owned by the `mythos-project-history` Agent Development Skill (`.claude/skills/mythos-project-history/SKILL.md`), triggered per verified development day — distinct from `mythos-doc-sync`, which is triggered per completed stage. See `docs/SKILLS_EVOLUTION.md` for why these are separate responsibilities.
