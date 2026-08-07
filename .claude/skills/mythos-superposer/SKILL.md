---
name: mythos-superposer
description: Compose an ordered plan from ranked shared skills based on assembled context, for both repository-development tasks and end-user Mythos product requests.
---

# mythos-superposer

## What this skill does

Takes the ranked candidates from `mythos-skill-router` and composes an ordered `SkillPlan` (`docs/SKILLS_SUPERPOSER.md` §2). Only composes capabilities actually available in the runtime — a composition referencing an unimplemented capability fails closed, it never silently substitutes or fabricates a result.

## Worked examples

See `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §4 (teacher and workshop composition examples).

## Governing documents

`docs/SKILLS_SUPERPOSER.md`.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
