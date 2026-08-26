---
name: session-handoff
description: OTHMODE session/handoff — durable, evidence-linked continuity between sessions via docs/AI_HANDOVER.md; the repository's proven handover discipline formalized as a skill (Search First verdict; Extend existing over external handoff projects).
---

# session-handoff

## What this skill does

Formalizes the handover discipline this repository has run in production for
months (Search First was applied: no external handoff project matched the
existing format's evidence-linked, git-verified record — verdict **Extend**;
see the Open Source Registry entry "Session Handoff pattern").

**Ending a session / completing a stage:**
- Write a new entry at the TOP of `docs/AI_HANDOVER.md`: stage name, status
  line, baseline SHA, what was verified FIRST-HAND vs what is claimed,
  exact operator/owner next steps, open blockers with evidence.
- Never overwrite previous entries — the file is an append-at-top ledger.
- The entry's claims must be re-derivable: SHAs, test counts, gate results.

**Starting a session:**
- `mythos-project-context` surfaces the newest entry; trust the repository
  over any conversation summary (CLAUDE.md rule).
- If OthMode is ON, also read `GET /api/othmode/mode` and the Dashboard's
  open items (health, open reviews) before choosing what to do.

## Boundaries

Handover entries record state; they never authorize work. Owner decisions are
quoted as questions, not assumed. Secrets never appear in a handover.

## Source

Classification: MYTHOS ORIGINAL (formalization of the live AI_HANDOVER discipline).
Version: 1.0.0 — see `docs/SKILLS_EVOLUTION.md`.
