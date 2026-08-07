# Mythos — Skills Sources

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Source classification record for every `.claude/skills/` entry.
**Date:** 2026-08-06

---

## 1. Policy

When a suitable, maintained, upstream Agent Skill exists for a given concern, Mythos prefers reusing it intact — inspecting the authoritative source, code/scripts, permissions, and licence, recording source and version, and adding a thin Mythos wrapper only for Mythos-specific context. When no appropriate upstream skill exists, Mythos authors an original skill. Every `.claude/skills/` entry is classified below as exactly one of:

- **UPSTREAM ORIGINAL** — reused intact from a maintained upstream source, unmodified.
- **MYTHOS WRAPPER** — a thin Mythos-context wrapper around an upstream original.
- **MYTHOS ORIGINAL** — authored for Mythos; no suitable upstream was found.

---

## 2. Classification

All skills listed below were evaluated for a suitable upstream equivalent during MPI-0. None of these concerns — Mythos's own repository governance conventions, its layered personal-intelligence architecture, or its specific development workflow — has a directly reusable, maintained public Agent Skill upstream; each is Mythos-specific by nature (repository conventions, product domain, or Mythos's own layered-context design). All are therefore classified **MYTHOS ORIGINAL**. This record should be revisited whenever a new candidate upstream skill is identified — reclassifying a MYTHOS ORIGINAL to MYTHOS WRAPPER later, if a suitable upstream is found, is an explicit, auditable change to this document, not a silent one.

| Skill | Classification | Notes |
|---|---|---|
| `mythos-project-context` | MYTHOS ORIGINAL | Repository-specific: surfaces AGENTS.md/AI_HANDOVER.md/ROADMAP.md state. |
| `mythos-intent-architect` | MYTHOS ORIGINAL | Mythos-specific multilingual (AR/Tunisian AR/FR/EN/mixed) intent normalisation for both dev and product requests. |
| `mythos-skill-router` | MYTHOS ORIGINAL | Routes using Mythos's domain/org/role/permission model — not a generic keyword router. |
| `mythos-superposer` | MYTHOS ORIGINAL | Composes Mythos domain-pack capabilities specifically. |
| `mythos-skill-guard` | MYTHOS ORIGINAL | Implements Mythos's own automation-level and approval-boundary model. |
| `mythos-repo-guardian` | MYTHOS ORIGINAL | Enforces this repository's AGENTS.md rules. |
| `mythos-safe-change` | MYTHOS ORIGINAL | Encodes this repository's stage-execution and scope-control discipline. |
| `mythos-test-intelligence` | MYTHOS ORIGINAL | Aware of this repository's `tests/stageXX-test.js` conventions. |
| `mythos-change-impact` | MYTHOS ORIGINAL | Maps changes against this repository's product/schema boundaries. |
| `mythos-doc-sync` | MYTHOS ORIGINAL | Keeps AI_HANDOVER.md/ROADMAP.md in sync per this repository's documented convention. |
| `mythos-migration` | MYTHOS ORIGINAL | Plans PostgreSQL migrations per this repository's schema/no-cross-FK rules. |
| `mythos-error-doctor` | MYTHOS ORIGINAL | Diagnoses this repository's known recurring issues (e.g. `_memCache` core failure pattern). |
| `mythos-smart-data-entry` | MYTHOS ORIGINAL | Understands Mythos's product data shapes. |
| `mythos-document-intelligence` | MYTHOS ORIGINAL | Understands Mythos document/workflow conventions. |
| `mythos-invoice-intelligence` | MYTHOS ORIGINAL | Understands Mythos invoice/estimate domain shapes across products. |
| `mythos-client-360` | MYTHOS ORIGINAL | Composes a client view across Mythos products, respecting per-product ownership boundaries. |
| `mythos-context-assembler` | MYTHOS ORIGINAL | New in MPI-0 — implements `docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §2. |
| `mythos-personal-learning` | MYTHOS ORIGINAL | New in MPI-0 — implements `docs/MYTHOS_USER_MEMORY_POLICY.md` §2. |

---

## 3. Reuse Note

No new external dependency was introduced to produce any skill in this list (`docs/AUTOMATION_ARCHITECTURE.md`/repository convention: avoid unnecessary new dependencies). Each `SKILL.md` is a self-contained instruction manifest per the native Agent Skills convention.

---

## 4. Status

All 18 skills listed (16 preserved/created per the task's required list plus 2 new: `mythos-context-assembler`, `mythos-personal-learning`) exist as `.claude/skills/<name>/SKILL.md` manifests as of MPI-0. None duplicates another's functionality — see `docs/SKILLS_ROADMAP.md` §"Agent Development Skills Inventory" for each skill's specific scope boundary.
