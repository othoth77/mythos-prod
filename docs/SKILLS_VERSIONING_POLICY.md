# Mythos — Skills Versioning Policy

**Stage:** MPI-0-FINALIZATION
**Status:** Permanent policy.
**Date:** 2026-08-06

---

## 1. Where Versions Live

Every Mythos Original Agent Skill has a version. The **registry** (`projects/personal-intelligence/config/agent-skills-registry.json`) is the canonical place for this and other extended metadata (status, category, dependencies, related skills). A `SKILL.md` body may also carry a `Version:` line for at-a-glance human reading, but if the two ever disagree, **the registry wins**.

Native Agent Skill frontmatter (`name`, `description`) is not modified incompatibly merely to carry version metadata — the registry exists precisely so version tracking does not require touching the frontmatter contract.

## 2. Semantic Versioning for Skills

- **MAJOR** — a breaking change to the skill's responsibility or contract (e.g. it now covers a fundamentally different concern, or a caller relying on its previous scope would get a wrong result).
- **MINOR** — a new capability or expanded supported scope, without breaking existing usage (e.g. `mythos-project-context` now also loads `docs/PROJECT_STATUS.md` — existing callers still get everything they got before, plus more).
- **PATCH** — a clarification, reference fix, typo correction, or safety tightening that does not change the skill's responsibility (e.g. correcting a stale doc reference, adding a delegation note that makes an existing implicit boundary explicit).

## 3. Initial Versions

Every skill that existed at MPI-0 and was **not** materially changed during the MPI-0-FINALIZATION audit starts at **`1.0.0`** — this is the honest starting point, not a claim that these skills were versioned before this stage (they were not).

## 4. Versions Assigned in MPI-0-FINALIZATION

See `docs/SKILLS_EVOLUTION.md` §3 for the full per-skill table. Summary of the version-bump reasoning:

- Skills whose governing documentation was corrected (a stale claim, a wrong file count, a false "no overlap" statement) without changing the skill's own responsibility → **PATCH**.
- Skills that gained an explicit delegation boundary or an expanded scope (e.g. `mythos-doc-sync` now also covers `docs/PROJECT_STATE.md`) → **MINOR**.
- The two new skills (`mythos-skill-evolution`, `mythos-project-history`) → **`1.0.0`**, as genuinely new.
- No skill received a MAJOR bump in this stage — no skill's core responsibility changed, only clarifications and scope extensions.

## 5. What a Version Change Requires

1. A genuine, reviewed change to the skill (per `mythos-skill-evolution`'s lifecycle) — never a version bump without a corresponding content change.
2. An entry in `docs/SKILLS_EVOLUTION.md` recording old version, new version, and reason.
3. An update to the skill's registry entry (`last_reviewed_at`, `version`).
4. If the skill's `SKILL.md` carries a `Version:` line, it is updated to match.

## 6. Status

Permanent policy. Applies to every future skill change, not only this stage's.
