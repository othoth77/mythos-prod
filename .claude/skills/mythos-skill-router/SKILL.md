---
name: mythos-skill-router
description: Rank candidate Mythos capabilities for a normalised intent using domain, user role, organisation, enabled capabilities, permissions, and recent workflow patterns — never keyword matching alone.
---

# mythos-skill-router

## What this skill does

Given a normalised intent (`mythos-intent-architect`) and an assembled context package (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`), ranks the candidate domain capabilities (`docs/MYTHOS_DOMAIN_PACKS.md`) that could satisfy it, using:

- current domain
- user role (reference only — never re-derives permission logic, see `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §6)
- organisation
- enabled capabilities for that organisation
- permissions
- user workflow patterns
- recent task context

Routing from keyword matching alone is explicitly insufficient and must never be the sole mechanism.

## Governing documents

`docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §5.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
