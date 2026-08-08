# Mythos Personal Intelligence — Skills and Rollout Roadmap

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Documentation only. No stage after MPI-0 has started.
**Date:** 2026-08-06

---

## 1. Stage Sequence

| Stage | Description | Status |
|---|---|---|
| MPI-0 | Personal Intelligence Foundation — architecture, contracts, scope model, context model, memory policy, user/org/domain separation, agent skills, reference implementation, tests | ✓ Current documentation stage |
| MPI-1 | Context Assembler + Context Compiler (runtime implementation) | Planned |
| MPI-2 | Personal Learning & Memory Engine (runtime implementation, persistent) | Planned |
| MPI-3 | Runtime Skill Router + Superposer | Planned |
| MPI-4 | Personal Chatbot Runtime | Planned |
| MPI-5 | Education Domain Pilot | Planned |
| MPI-6 | Automotive Workshop Pilot | Planned |
| MPI-7 | Organisation AI Admin | Planned |
| MPI-8 | User AI Preferences & Memory Controls | Planned |
| MPI-9 | Multi-model Provider Routing | Planned |
| MPI-10 | Analytics, Feedback and Optimisation | Planned |

**No stage beyond MPI-0 has started.** Marking a stage complete before it is actually implemented and validated is prohibited — this roadmap records intended sequence and scope only.

---

## 2. Stage Detail

### MPI-0 — Personal Intelligence Foundation (current)

Architecture (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`), scope/precedence model, context model (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`), memory policy (`docs/MYTHOS_USER_MEMORY_POLICY.md`), multi-tenancy requirements (`docs/MYTHOS_AI_MULTI_TENANCY.md`), chatbot pipeline (`docs/MYTHOS_CHATBOT_ARCHITECTURE.md`), skills architecture/security/sources (`docs/SKILLS_ARCHITECTURE.md`, `docs/SKILLS_SECURITY.md`, `docs/SKILLS_SOURCES.md`), model routing (`docs/MODEL_ROUTING_ARCHITECTURE.md`), an illustrative in-memory reference implementation (`projects/personal-intelligence/reference/`), a draft undeployed schema (`projects/personal-intelligence/database/control-plane-schema.sql`), 18 agent-development skill manifests (`.claude/skills/`), and test fixtures (`tests/mpi-0-personal-intelligence-test.js`).

### MPI-1 — Context Assembler + Context Compiler

Replace the illustrative in-memory reference (`projects/personal-intelligence/reference/context-assembler.js`) with a real, persistence-backed implementation of `mythos-context-assembler` and `mythos-context-compiler` (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md`).

### MPI-2 — Personal Learning & Memory Engine

Persistence-backed implementation of the learning pipeline (`docs/MYTHOS_USER_MEMORY_POLICY.md` §2), replacing `projects/personal-intelligence/reference/learning-engine.js`. Requires the `mythos_intelligence` schema (`projects/personal-intelligence/database/control-plane-schema.sql`) to actually be provisioned — subject to the same one-major-stage and database-authorisation discipline as every other product's implementation stage.

### MPI-3 — Runtime Skill Router + Superposer

Runtime implementation of `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §5 and `docs/SKILLS_SUPERPOSER.md`, composing real domain-pack capabilities once at least one exists (see MPI-5/MPI-6).

### MPI-4 — Personal Chatbot Runtime

End-to-end runtime implementation of the pipeline in `docs/MYTHOS_CHATBOT_ARCHITECTURE.md` §1, for the first time reachable by an authenticated Mythos user.

### MPI-5 — Education Domain Pilot

Implements the `education` domain pack capability contracts (`docs/MYTHOS_DOMAIN_PACKS.md` §2) for a pilot organisation, validating one-teacher/many-teachers personalisation with real data.

### MPI-6 — Automotive Workshop Pilot

Implements the `automotive_workshop` domain pack capability contracts (`docs/MYTHOS_DOMAIN_PACKS.md` §3), integrated with existing ID Auto/Atelier Network data, for a pilot workshop organisation.

### MPI-7 — Organisation AI Admin

Administrative controls: enabled domain pack, enabled/disabled skills, organisation terminology, AI policies, allowed data sources, automation levels, approval rules, default chatbot configuration, knowledge sources. A normal user must not modify organisation-wide policy without the appropriate admin permission.

### MPI-8 — User AI Preferences & Memory Controls

A future AI settings page where a user can inspect/manage: languages, response preferences, remembered working preferences, enabled AI capabilities, personal memory on/off where applicable, delete/correct preferences, view organisation-provided rules that cannot be changed, and view AI activity/history where appropriate. Internal system/security prompts are never exposed here.

### MPI-9 — Multi-model Provider Routing

Real provider adapters (Claude, Codex, future providers) consuming the `ContextPackage` contract (`docs/MYTHOS_CONTEXT_ARCHITECTURE.md` §5) — see `docs/MODEL_ROUTING_ARCHITECTURE.md`.

### MPI-10 — Analytics, Feedback and Optimisation

Feedback-loop analytics (`docs/MYTHOS_USER_MEMORY_POLICY.md` §8) informing domain-pack and platform improvement, without ever auto-promoting user-scoped learning to wider scope (`docs/MYTHOS_USER_MEMORY_POLICY.md` §3).

---

## 3. Agent Development Skills Inventory

The 20 `.claude/skills/` manifests (18 from MPI-0, 2 added in MPI-0-FINALIZATION), each with a primary owning responsibility. Where two skills' natural scope could otherwise overlap, one is the explicit owner and the other explicitly delegates — see `docs/SKILLS_EVOLUTION.md` for the full overlap audit that produced this boundary set; it is not the case that no two skills ever touch a related concern, only that each concern now has exactly one owner:

| Skill | Scope | Delegates to (where applicable) |
|---|---|---|
| `mythos-project-context` | Surfaces current repository/stage state before any task begins, including PROJECT_STATUS.md/DAILY_HISTORY.md/PROJECT_STATISTICS.md. | — |
| `mythos-intent-architect` | Normalises natural-language (multilingual) requests into structured intent, for both dev and product contexts. | — |
| `mythos-skill-router` | Ranks candidate capabilities using domain/role/org/permission context. | — |
| `mythos-superposer` | Composes an ordered plan from ranked capabilities. | — |
| `mythos-skill-guard` | Owns the permission/automation-level ALLOW/DENY/REQUIRE_APPROVAL/READ_ONLY/DRY_RUN_ONLY decision before execution. | — |
| `mythos-repo-guardian` | Sole owner of git/worktree preflight and AGENTS.md rule enforcement. | (owner; `mythos-project-context` and `mythos-safe-change` defer to it for preflight) |
| `mythos-safe-change` | Owns stage-execution lifecycle discipline (scope definition, commit/push discipline). | `mythos-repo-guardian` (preflight), `mythos-test-intelligence` (test-scope selection) |
| `mythos-test-intelligence` | Sole owner of test-scope selection for a given change. | — |
| `mythos-change-impact` | Owns pre-change MAD-1/3/4 product/schema-boundary checks. | `mythos-migration` (actual migration authoring once a schema change is approved) |
| `mythos-doc-sync` | Keeps AI_HANDOVER.md/ROADMAP.md/CHANGELOG.md/PROJECT_STATE.md consistent with actual validated implementation, at stage completion. | `mythos-project-history` (daily ledger — different trigger, see below) |
| `mythos-migration` | Owns PostgreSQL migration/schema-convention authoring. | — |
| `mythos-error-doctor` | Diagnoses recurring, previously-documented repository failure patterns, including the named baseline-failing test suites. | — |
| `mythos-smart-data-entry` | Assists structured data entry consistent with Mythos product data shapes. | — |
| `mythos-document-intelligence` | Owns document-output formatting/preparation. | (owner; `mythos-invoice-intelligence` defers to it for document formatting) |
| `mythos-invoice-intelligence` | Assists invoice/estimate handling across Mythos products. | `mythos-document-intelligence` (document formatting) |
| `mythos-client-360` | Composes a permission-respecting cross-product client view. | — |
| `mythos-context-assembler` | (New MPI-0, agent-development layer) Implements context selection/classification for personal intelligence design work — distinct from the identically-named MPI-1 runtime component it will guide the implementation of. | — |
| `mythos-personal-learning` | (New MPI-0, agent-development layer) Implements the learning-pipeline classification/confidence model for design work — distinct from the identically-named MPI-2 runtime component. | — |
| `mythos-skill-evolution` | (New MPI-0-FINALIZATION) Owns skill-registry consistency, duplication/staleness detection, and reviewed skill-change lifecycle. | — |
| `mythos-project-history` | (New MPI-0-FINALIZATION) Owns the verified daily historical ledger — triggered per development day, not per stage completion like `mythos-doc-sync`. | — |

---

## 4. Status

Documentation only. No stage after MPI-0 has been implemented or deployed.
