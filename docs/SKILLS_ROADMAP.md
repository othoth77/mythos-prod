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

The 18 `.claude/skills/` manifests created/preserved in MPI-0, each scoped to a distinct concern (no overlap):

| Skill | Scope |
|---|---|
| `mythos-project-context` | Surfaces current repository/stage state before any task begins. |
| `mythos-intent-architect` | Normalises natural-language (multilingual) requests into structured intent, for both dev and product contexts. |
| `mythos-skill-router` | Ranks candidate capabilities using domain/role/org/permission context. |
| `mythos-superposer` | Composes an ordered plan from ranked capabilities. |
| `mythos-skill-guard` | Evaluates permission/automation-level decisions before execution. |
| `mythos-repo-guardian` | Enforces AGENTS.md repository rules during any change. |
| `mythos-safe-change` | Enforces the stage-execution/scope-control discipline for implementation work. |
| `mythos-test-intelligence` | Selects and reasons about the right test scope for a change. |
| `mythos-change-impact` | Maps a proposed change against product/schema boundaries before it's made. |
| `mythos-doc-sync` | Keeps AI_HANDOVER.md/ROADMAP.md/CHANGELOG.md consistent with actual implementation. |
| `mythos-migration` | Plans PostgreSQL migrations consistent with existing schema conventions. |
| `mythos-error-doctor` | Diagnoses recurring, previously-documented repository failure patterns. |
| `mythos-smart-data-entry` | Assists structured data entry consistent with Mythos product data shapes. |
| `mythos-document-intelligence` | Assists document preparation/handling consistent with Mythos conventions. |
| `mythos-invoice-intelligence` | Assists invoice/estimate handling across Mythos products. |
| `mythos-client-360` | Composes a permission-respecting cross-product client view. |
| `mythos-context-assembler` | (New MPI-0) Implements context selection/classification for personal intelligence. |
| `mythos-personal-learning` | (New MPI-0) Implements the learning-pipeline classification/confidence model. |

No redundant skill was created where functionality already belonged in an existing one.

---

## 4. Status

Documentation only. No stage after MPI-0 has been implemented or deployed.
