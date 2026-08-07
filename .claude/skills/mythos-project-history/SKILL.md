---
name: mythos-project-history
description: Derive verified daily development activity from Git/stage records and maintain docs/history/DAILY_HISTORY.md — triggered per development day, distinct from mythos-doc-sync's per-stage-completion trigger. Never fabricates missing historical work.
---

# mythos-project-history

## What this skill does

- Derives activity for the current day from `git log` (the factual event source), `docs/AI_HANDOVER.md` (stage semantics), `docs/ROADMAP.md` (stage status), and Pull Request metadata — never from conversation memory alone.
- Appends or updates the current day's entry in `docs/history/DAILY_HISTORY.md`, following the structure: starting state, stages active/completed, commits, PRs, major files/modules added, architecture decisions, tests run/results, known pre-existing failures, bugs found/fixed, deployment actions, external-provider actions, security/safety changes, documentation changes, blockers, end-of-day remote HEAD, next recorded action.
- **Never fabricates missing historical work.** Where no repository evidence exists for a date, that date is either omitted or recorded with an explicit "no commits recorded" note (see `docs/history/DAILY_HISTORY.md`'s 2026-08-03 entry for the pattern).
- Preserves corrections as dated amendments (`## Amendment — <date> — corrects <original date> entry`), never by silently editing a previously recorded day's facts.
- Where two sources conflict (e.g. a worklog implies more activity than the commit log shows for the same date), records `HISTORICAL_CONFLICT` and names the competing sources rather than picking one silently.
- Triggers `mythos-doc-sync`'s downstream ledger/statistics regeneration (`projects/meta/project-ledger.json`, `docs/PROJECT_STATISTICS.md`) when a day's entry changes the picture those derive from — but does not itself own AI_HANDOVER/ROADMAP/CHANGELOG content.
- Distinguishes **facts** (what happened, evidenced) from **planned work** (what is recorded as next/planned in ROADMAP) — a daily entry never states a planned stage as if it were completed.

## Why this is a separate skill from `mythos-doc-sync`

`mythos-doc-sync` is triggered per completed stage and, empirically, was discharged reliably across roughly fifteen stages while the daily chronological ledger (`docs/worklogs/`, `docs/PROJECT_STATE.md`) went unmaintained for the same period — proving the two have different triggers and different, differently-visible failure modes. See `docs/SKILLS_EVOLUTION.md` §4 for the full evidence.

## Governing documents

`docs/history/README.md`, `docs/history/DAILY_HISTORY.md`, `docs/PROJECT_HISTORY.md`.

## Source

Classification: MYTHOS ORIGINAL — new in MPI-0-FINALIZATION. See `docs/SKILLS_SOURCES.md`.
Version: 1.0.0.
