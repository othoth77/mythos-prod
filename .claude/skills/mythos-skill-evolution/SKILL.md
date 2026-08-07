---
name: mythos-skill-evolution
description: Own skill-registry consistency, duplication/staleness detection across .claude/skills/, and the reviewed lifecycle a skill change must follow — skills must never self-modify without review.
---

# mythos-skill-evolution

## What this skill does

- Inspects `projects/personal-intelligence/config/agent-skills-registry.json` against the actual contents of `.claude/skills/` — every directory must have exactly one registry entry, and every registry entry must point to an existing directory.
- Identifies stale skill references: a doc or another skill citing a skill/component that has no manifest (e.g. the `mythos-context-compiler` reference found and corrected during the MPI-0-FINALIZATION audit).
- Identifies duplication: two skills whose stated responsibility genuinely overlaps without an explicit owner/delegator relationship recorded in `docs/SKILLS_EVOLUTION.md`.
- Compares skill coverage against the current roadmap (`docs/SKILLS_ROADMAP.md`, `docs/ROADMAP.md`) to flag a genuinely missing skill — but does not create one without review; it produces a candidate, never a unilateral change.
- Identifies missing safety/test requirements on a skill (e.g. a skill implying runtime reachability without the agent-development-layer clarification required by `docs/SKILLS_ARCHITECTURE.md` §1).
- Requires review before any skill modification is applied — this skill proposes candidate improvements; a human-reviewed, committed diff is what actually changes a skill.
- Updates source/version metadata in the registry only after an actual, reviewed change has landed — never speculatively.

## Lifecycle this skill enforces

```
INTERACTION / STAGE
  → SKILL USAGE SIGNAL
  → GAP / FAILURE / DUPLICATION OBSERVATION
  → CANDIDATE IMPROVEMENT
  → REVIEW
  → TEST
  → VERSIONED SKILL UPDATE
  → AUDIT
  → DOCUMENTATION
```

## Permanent safety rules (non-negotiable)

- Skill source must never silently rewrite itself.
- No production-user or end-user chatbot behaviour may directly edit `.claude/skills/`.
- No learned user preference (`docs/MYTHOS_USER_MEMORY_POLICY.md`) may alter a development skill, globally or per-user — user-scoped learning and dev-skill evolution are entirely different scopes.
- No AI session may self-promote a skill change without it being a reviewed, committed, auditable repository diff — identical discipline to any other change under `AGENTS.md` §7.
- Every skill version bump is recorded in the registry (`projects/personal-intelligence/config/agent-skills-registry.json`), never only in the SKILL.md body.

## Governing documents

`docs/SKILLS_EVOLUTION.md` (the durable audit record this skill maintains), `docs/SKILLS_VERSIONING_POLICY.md`, `docs/SKILLS_ARCHITECTURE.md`, `AGENTS.md` §24.

## Source

Classification: MYTHOS ORIGINAL — new in MPI-0-FINALIZATION. See `docs/SKILLS_SOURCES.md`.
Version: 1.0.0.
