---
name: mythos-superposer
description: Compose an ordered plan from ranked shared skills based on assembled context, for both repository-development tasks and end-user Mythos product requests.
---

# mythos-superposer

## What this skill does

Takes the ranked candidates from `mythos-skill-router` and composes an ordered `SkillPlan` (`docs/SKILLS_SUPERPOSER.md` §2). Only composes capabilities actually available in the runtime — a composition referencing an unimplemented capability fails closed, it never silently substitutes or fabricates a result.

## Worked examples

See `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §4 (teacher and workshop composition examples).

## Development-workflow composition (DEVX-0)

For a repository development task, "composing a plan" means ordering the Agent Development Skills `mythos-skill-router` ranked from a Stage Context into the sequence `docs/DEVELOPMENT_WORKFLOW.md` §"What according to Mythos workflow means in practice" already defines (preflight → context → stage resolution → governance gate → implementation → test selection → documentation → closure). This still fails closed: a Stage Context blocker (e.g. `DEPENDENCY_UNSATISFIED`) stops composition rather than silently skipping a step.

## Governing documents

`docs/SKILLS_SUPERPOSER.md`, `docs/DEVELOPMENT_WORKFLOW.md`.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.1.0 — see `docs/SKILLS_EVOLUTION.md` (governing doc corrected: `docs/SKILLS_SUPERPOSER.md` previously claimed a composition stub existed in `intent-router.js`; it does not — that reference has been removed).
