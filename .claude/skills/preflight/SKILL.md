---
name: preflight
description: OTHMODE preflight — before starting any task, surface repository state, OthMode flag, health and current context in one pass; delegates the git preflight to mythos-project-context and rule enforcement to mythos-repo-guardian.
---

# preflight

## What this skill does

The OTHMODE-approved consolidation of the preflight checks that already exist
in this repository (Selector verdict: **EXTEND**, not create — see
`docs/SKILLS_EVOLUTION.md`). Before starting any task:

1. **Repository state** — delegate to `mythos-project-context` (branch, HEAD,
   origin distance, AI_HANDOVER summary). Do not restate its checks here.
2. **Rules** — delegate to `mythos-repo-guardian` (AGENTS.md enforcement).
3. **OthMode flag** — read `GET /api/othmode/mode` (or, off-host, treat the
   flag as OFF). If ON, the OTHMODE conventions apply to this session:
   consult the command library before inventing commands, consult Memory
   (`/api/othmode/memory/search`) before re-deriving known facts, apply
   `search-first` before building anything new, and record signals/outcomes
   through the evolution endpoints when something notable happens.
4. **Health** — read `GET /api/othmode/health` (or the monitor's
   live-status.json directly on the host). A FAILED/BLOCKED component that
   the task depends on is surfaced BEFORE work starts, not discovered midway.
5. **Deployment preflight** — for deploy-adjacent tasks, the existing
   `sudo mythos-deploy preflight <target>` remains the authoritative check.

## Boundaries

Preflight reads; it never fixes. Anything it finds wrong becomes the task's
first reported fact, or a recovery record — never a silent repair.

## Source

Classification: MYTHOS ORIGINAL (consolidation of existing checks; OTHMODE Phase 2).
Version: 1.0.0 — see `docs/SKILLS_EVOLUTION.md`.
