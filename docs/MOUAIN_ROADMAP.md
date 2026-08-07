# Mouain — Roadmap

**Stage:** MOU-0 Foundation and Vision Registration
**Last updated:** 2026-08-07
**Repository:** othoth77/mythos-prod

---

## Important Notice

Mouain is a **FUTURE STRATEGIC PROJECT**. Implementation has NOT started.

No MOU stage is authorised to begin implementation. All stages beyond MOU-0 are planned, not scheduled. Readiness gates must be satisfied before any implementation stage is authorised.

---

## 1. Operating Principles

### 1.1 Stage Naming Convention

Mouain stages are prefixed `MOU-N`:

- `MOU-0` — Foundation and Vision Registration
- `MOU-1` — Discovery Phase (teacher collaboration)
- `MOU-2` — Architecture and Platform Setup
- `MOU-3` — Teacher OS MVP
- `MOU-4` — Skills and Agents MVP
- `MOU-5` — Student and Parent Layers
- `MOU-6` — Institution OS

Stage 0 is always a documentation and specification stage. No runtime code, no database migrations, no live data.

### 1.2 One Major Stage at a Time

Only one major Mouain implementation stage is active at a time unless explicitly authorised. Documentation stages (MOU-0, MOU-1) are not implementation.

### 1.3 Mythos Ecosystem Rule

The existing Mythos ecosystem one-major-stage rule applies. Mouain implementation must not run concurrently with a major Mythos OS or Mythos Automotive implementation stage unless explicitly authorised.

---

## 2. Readiness Gates (Activation Criteria)

Mouain implementation (MOU-1 forward) is activated ONLY when ALL of the following gates are satisfied:

### GATE-1: Mythos Platform Foundation

The Mythos platform foundation is sufficiently stable to support a new product domain without destabilizing existing work.

**Minimum condition:** Mythos OS core stage (Stage 3G) is complete. The production management platform is no longer in active foundational refactoring.

**Rationale:** Mouain shares repository infrastructure, documentation methodology, and deployment patterns. It should not be built on a moving platform.

### GATE-2: Reusable AI / Skill Infrastructure

A prototype of reusable AI infrastructure or Skill architecture exists that Mouain can build on rather than invent from scratch.

**Minimum condition:** At least one reusable AI pattern or Skill prototype has been validated in the Mythos ecosystem.

**Rationale:** Mouain requires AI infrastructure. Building it from scratch for Mouain alone would duplicate effort. A reusable foundation should exist first.

### GATE-3: Identity and Domain Decisions

Mouain's identity, domain, and platform boundaries are sufficiently established.

**Minimum condition:**
- Product name confirmed (Mouain — مُعين)
- Domain registered or reserved (e.g., mouain.tn or equivalent)
- Platform classification confirmed (separate product within Mythos ecosystem)
- Brand identity documented

### GATE-4: Founding Pedagogical Council Formed

An initial Founding Pedagogical Council is formed with real educators.

**Minimum condition:**
- At least 3-5 educators from different disciplines and levels
- Initial scope and working method agreed
- First pedagogical sessions planned
- Charter ratified (see `docs/MOUAIN_FOUNDING_PEDAGOGICAL_COUNCIL.md`)

**Rationale:** Mouain's core principle is "built with educators." Implementation must not begin without educator partnership.

### GATE-5: First Curriculum Scope Selected

A specific Tunisian curriculum scope is selected as the MVP target.

**Minimum condition:**
- Specific educational stage and grade(s) selected
- Specific subject(s) selected
- Official curriculum documents acquired and verified
- Initial curriculum structure mapping begun

**Rationale:** Mouain is curriculum-aware. Without a specific curriculum to target, the MVP has no pedagogical anchor.

### GATE-6: Discovery Phase Completed

The teacher Discovery Phase (MOU-1) is complete with validated findings.

**Minimum condition:**
- Real teachers have been observed and interviewed
- Highest-cost repetitive tasks documented
- Actual workflows mapped (not assumed)
- Differences between subjects and levels documented
- Assessment practices understood
- Required documents catalogued
- AI boundaries confirmed with teachers
- Privacy requirements collected from real contexts
- First high-value workflow identified

### GATE-7: MVP Scope Validated

The MVP scope is frozen based on Discovery findings and Pedagogical Council input.

**Minimum condition:**
- MVP workflow defined end-to-end
- Explicit exclusions documented
- Pedagogical Council has reviewed and approved MVP scope
- Technology feasibility assessed (not committed)

### GATE-8: Privacy / Data Model Reviewed

The proposed data model and privacy architecture have been reviewed.

**Minimum condition:**
- Data minimization principles applied to MVP scope
- Student data handling reviewed
- Consent mechanisms designed (not implemented)
- Legal review initiated for applicable jurisdictions

---

## 3. Stage Plan

| Stage | Description | Status | Dependencies |
|-------|-------------|--------|-------------|
| MOU-0 | Foundation and Vision Registration | ✓ Done (2026-08-07) | — |
| MOU-1 | Discovery Phase — teacher collaboration, workflow validation, MVP scope | Planned | GATE-1 through GATE-5 satisfied |
| MOU-2 | Architecture and Platform Setup — technology stack, data model, deployment | Planned | MOU-1 complete, GATE-6 and GATE-7 satisfied |
| MOU-3 | Teacher OS MVP — teacher workspace, curriculum-aware planning, AI assistance | Planned | MOU-2 complete, GATE-8 satisfied |
| MOU-4 | Skills and Agents MVP — modular skills, specialized agents, personalization | Planned | MOU-3 complete |
| MOU-5 | Student and Parent Layers — classroom, assignments, parent portal | Planned | MOU-4 complete |
| MOU-6 | Institution OS — school administration, analytics, B2B layer | Planned | MOU-5 complete |

---

## 4. Stage Details

### MOU-0 — Foundation and Vision Registration ✓

**Status:** Complete (2026-08-07)

**Deliverables:**
- `projects/mouain/README.md` — project overview and positioning
- `docs/MOUAIN_VISION.md` — full vision and design principles
- `docs/MOUAIN_ARCHITECTURE.md` — architectural directions and constraints
- `docs/MOUAIN_ROADMAP.md` — this file
- `docs/MOUAIN_PEDAGOGY.md` — pedagogical model
- `docs/MOUAIN_FOUNDING_PEDAGOGICAL_COUNCIL.md` — council charter
- `docs/ROADMAP.md` updated — Mouain added as future strategic project
- `docs/AI_HANDOVER.md` updated — MOU-0 registration recorded

**No implementation.** No code. No deployment. No data.

---

### MOU-1 — Discovery Phase (Planned, NOT Authorised)

**Prerequisites:** GATE-1 through GATE-5 satisfied

**Objective:** Work with real educators to understand actual pedagogical workflows before designing any system.

**Scope:**
- Recruit 5-10 teachers from different disciplines and levels
- Observe real lesson preparation, assessment, and classroom workflows
- Document actual (not assumed) teacher tasks and pain points
- Map differences between subjects and educational levels
- Understand curriculum structure from teacher perspective
- Catalogue document types, assessment types, and correction practices
- Identify highest-cost repetitive tasks suitable for AI assistance
- Define AI boundaries with teacher input
- Collect privacy and consent requirements from real contexts
- Select first MVP workflow

**Deliverables:**
- Teacher workflow documentation (per subject/level)
- Task cost analysis (time, repetition, cognitive load)
- Curriculum structure analysis (Tunisian context)
- Document and assessment catalogue
- AI boundary specification
- Privacy requirements summary
- MVP scope recommendation
- Discovery phase report

**Explicitly NOT in scope:**
- Writing code
- Building prototypes
- Designing UI
- Any implementation

**Duration:** Not estimated. Depends on teacher availability and depth of discovery.

---

### MOU-2 — Architecture and Platform Setup (Planned)

**Prerequisites:** MOU-1 complete, GATE-6 and GATE-7 satisfied

**Objective:** Define the implementation architecture based on Discovery findings.

**Scope:**
- Select technology stack (backend, frontend, AI platform)
- Design data model for MVP scope
- Design API and integration contracts
- Set up deployment infrastructure
- Define security and privacy implementation
- Create development environment
- Draft implementation architecture document

**Deliverables:**
- Technology stack decision
- Data model (PostgreSQL schema draft)
- API specification
- Deployment configuration
- Security implementation plan
- Development environment

---

### MOU-3 — Teacher OS MVP (Planned)

**Prerequisites:** MOU-2 complete, GATE-8 satisfied

**Objective:** Deliver the first working Teacher OS.

**Scope:**
- Teacher workspace (classes, subjects, planning)
- Curriculum-aware lesson planning with AI assistance
- Exercise generation (curriculum-aligned)
- Assessment builder (competency-linked)
- Document generation (lesson plans, worksheets)
- Basic correction workflows
- Teacher personalization (preferences, style)
- Core Mouain Skills (Lesson Planning, Exercise Generation, Assessment Builder)
- Offline capability for core workflows

**Explicitly NOT in MVP:**
- Student accounts
- Parent portal
- Institution management
- Educational marketplace
- Advanced AI agents (beyond teacher assistant)
- Multi-country curriculum support

---

### MOU-4 — Skills and Agents MVP (Planned)

**Prerequisites:** MOU-3 complete

**Objective:** Expand the Skill architecture and introduce specialized educational AI agents.

**Scope:**
- Additional Mouain Skills (Correction Assistant, Rubric Builder, Curriculum Mapping, etc.)
- Teacher Agent and Curriculum Agent
- Enhanced personalization
- Skill specialization by subject and level

---

### MOU-5 — Student and Parent Layers (Planned)

**Prerequisites:** MOU-4 complete

**Objective:** Introduce student and parent interfaces.

**Scope:**
- Mouain Classroom (student assignments, resources, progress)
- Parent portal (controlled progress view)
- Teacher-student-parent communication framework

---

### MOU-6 — Institution OS (Planned)

**Prerequisites:** MOU-5 complete

**Objective:** Introduce institutional management layer.

**Scope:**
- School/institution administration
- Teacher management across institution
- Curriculum alignment tracking
- Educational analytics
- B2B features

---

## 5. Dependency Map

```
GATE-1: Mythos Platform Stable
GATE-2: AI/Skill Infrastructure Prototype
GATE-3: Identity/Domain Decisions
GATE-4: Founding Pedagogical Council
GATE-5: First Curriculum Scope
        │
        ▼
    [MOU-1: Discovery Phase]
        │
        ▼
    GATE-6: Discovery Complete
    GATE-7: MVP Scope Validated
        │
        ▼
    [MOU-2: Architecture Setup]
        │
        ▼
    GATE-8: Privacy/Data Model Reviewed
        │
        ▼
    [MOU-3: Teacher OS MVP]
        │
        ▼
    [MOU-4: Skills and Agents]
        │
        ▼
    [MOU-5: Student/Parent Layers]
        │
        ▼
    [MOU-6: Institution OS]
```

---

## 6. Current State Summary

| Item | Status |
|------|--------|
| MOU-0 Foundation | ✓ Complete (docs only) |
| GATE-1 (Mythos stability) | ◇ Pending — Stage 3G not started |
| GATE-2 (AI infrastructure) | ◇ Pending — no AI prototype exists |
| GATE-3 (Identity/domain) | ◇ Partial — name established, domain not registered |
| GATE-4 (Pedagogical Council) | ◇ Pending — council not formed |
| GATE-5 (Curriculum scope) | ◇ Pending — not selected |
| MOU-1 (Discovery) | ◇ NOT AUTHORISED |
| MOU-2 through MOU-6 | ◇ NOT AUTHORISED |

---

## 7. Relationship to Current Mythos Priorities

Mouain is a **separate strategic project** that does not alter or block the current priority order:

1. Mythos OS: Stage 3E → 3F → 3G (runtime plugins)
2. ID Auto: IDA-2 (PostgreSQL Core, API, Manual Capture MVP)
3. Atelier Network: ATN-1 (Workshop Registry)
4. AutoValeur: AVA-1 (Public Calculator MVP)

Mouain work begins only when:
- Its readiness gates are independently satisfied
- No active Mythos OS or Automotive implementation stage is in progress
- Explicit authorisation is received