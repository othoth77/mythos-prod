# Mythos — Skills Architecture

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft architecture. `.claude/skills/` created in this stage for agent-development skills only.
**Date:** 2026-08-06

---

## 1. Two Distinct Kinds of "Skill" — Do Not Conflate

### Agent Development Skills

Native Agent Skills (Claude Code convention: `.claude/skills/<name>/SKILL.md`) used by Claude/Codex **while building and operating Mythos itself** — repository-development intelligence, not end-user product features. See §3 for the list created/preserved in this stage.

### Runtime Mythos Capabilities

Capabilities used by **end-user chatbots inside Mythos products** — `education.assessment.create`, `estimate.prepare`, and the rest of the domain-pack capability contracts in `docs/MYTHOS_DOMAIN_PACKS.md`.

**`.claude/skills/` alone is not the runtime architecture for thousands of Mythos users.** Agent Skills help *build and operate* Mythos; runtime user intelligence must be represented in application-level data/contracts/services suitable for multi-user, multi-tenant execution — see `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` and `projects/personal-intelligence/`. A runtime capability is never implemented solely as a `.claude/skills/` entry expecting a Claude Code session to execute it on behalf of an end user.

**Every entry under `.claude/skills/` is an Agent Development Skill, without exception.** Several manifests are worded around a Mythos capability domain (e.g. `mythos-client-360`, `mythos-invoice-intelligence`, `mythos-document-intelligence`, `mythos-smart-data-entry`) — this describes what subject-matter judgement the skill brings to a Claude/Codex session while *building* that capability, not a claim that the skill is itself reachable from an end-user chatbot request. Two manifests, `mythos-context-assembler` and `mythos-personal-learning`, deliberately share a name with the future MPI-1/MPI-2 *runtime* components they exist to help design and build — the skill is the agent-development-layer counterpart, not the runtime component itself; see `docs/SKILLS_ROADMAP.md` §3 for the explicit note on both. `docs/SKILLS_SECURITY.md` §3 states the boundary rule this naming must never be read to weaken: no Agent Development Skill is directly reachable from an end-user request path.

---

## 2. Shared Skills vs. Per-User Configuration

**Never** physically copy a skill per user:

```
BAD:
users/
  user1/teacher-skill-copy
  user2/teacher-skill-copy
  user3/teacher-skill-copy
```

**Always** compose a shared skill with layered context:

```
GOOD:
SHARED DOMAIN SKILL
  + ORGANISATION CONFIGURATION
  + USER PROFILE
  + RELEVANT MEMORY
  + PERMISSIONS
  + SESSION
```

`education.assessment.create` is shared. Teacher A adds preferences, class context, and organisation rules at invocation time; Teacher B uses the identical core skill with different context. An improvement to the shared skill is immediately available to every teacher — it never needs to be propagated across copies, because there are no copies.

---

## 3. Skill Overrides (Layered Configuration)

```
GLOBAL DEFAULT
  ↓
DOMAIN DEFAULT
  ↓
ORGANISATION OVERRIDE
  ↓
USER PREFERENCE
  ↓
CURRENT TASK OVERRIDE
```

Each layer may override the one above it through **configuration**, never through source-code duplication. `OrganisationProfile.customSkillConfiguration` (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §4) and `PersonalAIProfile.skillPreferences` (§5) are the configuration surfaces for the two customer-facing override layers; `CURRENT TASK OVERRIDE` is the session-scoped, this-turn-only instruction from `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §7 precedence item 4.

---

## 4. Agent Development Skills Created/Preserved in MPI-0

See `.claude/skills/` and `docs/SKILLS_SOURCES.md` for the classification (upstream original / Mythos wrapper / Mythos original) of each. Full list, purpose, and current status: `docs/SKILLS_ROADMAP.md` §"Agent Development Skills Inventory".

---

## 5. Relationship to Superposer and Guard

Skill composition (which shared skills a request needs) is the Superposer's responsibility (`docs/SKILLS_SUPERPOSER.md`); whether a composed plan is permitted to execute is the Guard's responsibility (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11, `docs/SKILLS_SECURITY.md`). Neither responsibility is ever folded into the skill definition itself — a skill declares what it does and what it requires; it does not decide whether it is allowed to run for a given user right now.

---

## 6. Status

Draft architecture. `.claude/skills/` contains agent-development skill manifests only. No runtime capability router exists in production. See `docs/SKILLS_ROADMAP.md` for the staged path to a runtime Skill Router and Superposer (MPI-3).
