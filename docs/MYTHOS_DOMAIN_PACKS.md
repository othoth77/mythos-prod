# Mythos — Domain Packs

**Stage:** MPI-0 — Personal Intelligence Foundation
**Status:** Draft capability contracts / roadmap items. No domain runtime is implemented in this stage unless it already existed.
**Date:** 2026-08-06

---

## 1. What a Domain Pack Is

A **Domain Pack** is a reusable, shared definition of professional intelligence for one vertical — the shared skills, terminology baseline, and default workflows a profession needs, expressed as the `DomainProfile` contract in `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §3. A domain pack is written once and reused by every organisation and user in that profession; organisation and user layers customise it without forking it.

Example domain ids: `education`, `automotive_workshop`, `production`, `accounting`, `administration`, `vehicle_intelligence`, `event_management`. (`healthcare` is explicitly deferred — only if legally appropriate in a future stage; not defined here.)

This stage defines two domain packs in capability-contract form: **`education`** and **`automotive_workshop`**. Neither is a complete product. Both validate the personalisation architecture, not a finished vertical.

---

## 2. Domain Pack: Education (Foundation)

**Domain id:** `education`

### Baseline knowledge

Courses, lessons, exercises, homework, assessments, grading, students, classes, schedules, educational documents.

### Capability contracts (roadmap items — no runtime support yet)

| Capability | Purpose |
|---|---|
| `teacher.context` | Resolve the requesting teacher's active classes, subjects, and recent relevant material. |
| `lesson.prepare` | Prepare lesson content for a class/subject. |
| `exercise.generate` | Generate exercises matching a topic and difficulty. |
| `assessment.prepare` | Prepare a homework/assessment, optionally patterned on a prior one. |
| `answer_key.generate` | Generate an answer key for a prepared assessment/exercise set. |
| `content.adapt_difficulty` | Adjust generated content up or down in difficulty. |
| `student_group.context` | Resolve a class/group's relevant, permission-scoped context. |
| `curriculum.context` | Resolve applicable curriculum/programme constraints. |
| `document.prepare` | Produce a formatted document from prepared content. |
| `schedule.context` | Resolve the teacher's relevant schedule/timing context. |

### Personalisation example

Teacher A (mathematics) and Teacher B (French literature) both invoke `assessment.prepare` from the same shared `education` domain pack. Teacher A's request — "اعمللي devoir كيف المرة الي فاتت اما اسهل" (make me a homework like last time's but easier) — resolves through Teacher A's own recent-assessment history, class context, and `content.adapt_difficulty = easier`, entirely independent of Teacher B's classes, preferences, or organisation.

---

## 3. Domain Pack: Automotive Workshop (Foundation)

**Domain id:** `automotive_workshop`

### Baseline knowledge

Vehicles, clients, diagnostics, work orders, parts, estimates, repairs, appointments, maintenance history, invoices.

**This domain pack integrates with, and does not duplicate, the existing ID Auto and Atelier Network architecture** (`docs/IDAUTO_ARCHITECTURE.md`, `docs/ATELIER_NETWORK_ARCHITECTURE.md`). Vehicle identity remains owned exclusively by ID Auto (`vehicle_id`); workshop operational data remains owned by each workshop organisation via Atelier Network, exactly as those documents already establish. This domain pack is a personalisation and capability-routing layer on top of that existing data model, not a replacement for it.

### Capability contracts (roadmap items — no runtime support yet)

| Capability | Purpose |
|---|---|
| `workshop.context` | Resolve the requesting user's active workshop organisation and role there. |
| `vehicle.lookup` | Resolve a vehicle by plate/identifier via ID Auto, subject to permission. |
| `vehicle.checkin` | Resolve/record a vehicle's current check-in state at this workshop. |
| `client.resolve` | Resolve the client associated with a vehicle/work order, scoped to this workshop organisation. |
| `diagnostic.summary` | Summarise diagnostic findings for a vehicle. |
| `estimate.prepare` | Prepare a repair estimate — a financial-mutation-adjacent capability; see approval note below. |
| `workorder.manage` | Create/update a work order. |
| `parts.lookup` | Resolve parts availability/pricing relevant to a repair. |
| `maintenance.history` | Resolve a vehicle's maintenance history, subject to permission. |
| `invoice.prepare` | Prepare an invoice from an approved estimate/work order. |
| `appointment.manage` | Manage scheduling for a workshop. |
| `customer.followup` | Prepare customer follow-up communication. |

### Approval note

`estimate.prepare` and `invoice.prepare` touch financial output. Per `docs/AUTOMATION_APPROVAL_MATRIX.md` §2 and `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §11 (Guard), preparing a draft estimate is not itself a permanent-boundary action, but any step that would commit, send, or financially mutate a record on the workshop's behalf remains `LEVEL_3_APPROVAL_REQUIRED` and passes through Guard exactly like any other Mythos automation — personalisation never shortcuts this.

### Personalisation example

Workshop A and Workshop B both invoke `estimate.prepare` from the same shared `automotive_workshop` domain pack. "حضّرلي devis للكوراندو الي دخلت صباح" (prepare an estimate for the Korando that came in this morning) resolves, subject to permission, to Workshop A's own current check-in, client, and pricing policy — never Workshop B's.

---

## 4. Domain Pack Contract Summary

```
DomainProfile {
  domainId
  capabilities        // the capability ids listed above, per domain
  skills               // shared skill identifiers implementing those capabilities (future)
  terminology
  requiredContext
  optionalContext
  defaultWorkflows
  policyReferences
}
```

See `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` §3 for the full contract definition.

---

## 5. Status

Capability-contract definitions and roadmap items only. No capability listed above has a runtime implementation in this stage. See `docs/SKILLS_ROADMAP.md` §"MPI-5 Education Domain Pilot" and §"MPI-6 Automotive Workshop Pilot" for when these become implementation targets — neither is started by MPI-0.
