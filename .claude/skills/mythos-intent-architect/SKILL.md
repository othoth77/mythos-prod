---
name: mythos-intent-architect
description: Normalise natural, imperfect, short, non-technical requests — in Arabic, Tunisian Arabic, French, English, or mixed Arabic/French — into a structured intent representation appropriate to the current context (repository-development task or Mythos product-domain task).
---

# mythos-intent-architect

## What this skill does

- Detects language family (Arabic script, Tunisian Arabic in Latin script, French, English, or mixed) without requiring the user to specify it.
- For repository-development requests, produces a scoped implementation task.
- For Mythos product/domain requests (see `docs/MYTHOS_DOMAIN_PACKS.md`), produces a domain-appropriate task representation — never a software-engineering task by default.
- Never infers unknown facts with false confidence; where required context cannot be resolved, it asks or degrades gracefully instead of fabricating a plausible-sounding answer.

## Governing documents

`docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §6, `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` §3-§4.

Reference implementation (illustrative, not production): `projects/personal-intelligence/reference/intent-router.js`.

**Layer note:** this is the one skill in this repository that legitimately spans both the agent-development layer (helping build the repository) and the product-domain-intent layer (understanding what a Mythos end user is asking for) — see `docs/SKILLS_ARCHITECTURE.md` §1. It remains an Agent Development Skill; it is not itself reachable by an end-user request.

## Source

Classification: MYTHOS ORIGINAL — see `docs/SKILLS_SOURCES.md`.
Version: 1.0.1 — see `docs/SKILLS_EVOLUTION.md`.
