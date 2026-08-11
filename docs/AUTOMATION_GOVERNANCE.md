# Mythos Automation & Operations — Governance

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Governance document only. No automation runs yet.
**Date:** 2026-08-06

---

## 1. Purpose

This document defines how the Automation track fits into, and is bound by, existing Mythos ecosystem governance (`docs/ROADMAP.md`, `AGENTS.md`) — it does not create a separate or parallel governance regime.

---

## 2. Sequencing and the One-Major-Stage Rule

The Automation track is a **separate product track**, exactly like Mythos OS runtime, ID Auto, Atelier Network, AutoValeur, and Infrastructure/Cloudflare. It follows the same sequencing discipline documented in `docs/ROADMAP.md`:

- Only one major implementation stage may be active at a time across the whole repository, unless the user gives explicit parallel authorisation.
- **AUT-0 is documentation only** — it does not count as, and does not authorise, a major implementation stage.
- **INF-OVH-API-0 is the next Automation implementation stage** once explicitly authorised — it is not started by AUT-0.
- The Automation track does not change the currently authorised implementation-stage priority. As of AUT-0:
  - **Stage 3E** remains the next Mythos OS runtime stage.
  - **IDA-2** is IN PROGRESS — Phase A (schema + plate validation, no live database) complete 2026-08-10; Phase B not started, requires separate authorization.
  - **INF-CF-2** remains blocked and not started, pending the entry criteria in `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`.
  - **ATN-1** and **AVA-1** remain sequential after IDA-2, not started.

Introducing the Automation track does not reorder any of the above. It is documented as an additional, parallel-eligible-only-with-explicit-authorisation track, not as a replacement priority.

---

## 3. Relationship to Existing Architecture Rules

The Automation track inherits, rather than redefines, the Mythos-wide architecture rules already established for other products:

- **Product-schema alignment (MAD-1):** `mythos_automation` is its own PostgreSQL logical schema, exactly as `idauto`, `autovaleur`, `mythos_automotive`, and `atelier_network` are their own schemas.
- **One writer per noun (MAD-3):** only Mythos Automation & Operations writes to `aut_*` tables.
- **No cross-schema foreign keys (MAD-4):** every cross-schema reference in `projects/automation/database/control-plane-schema.sql` is an opaque reference column with a comment, never a real foreign key constraint.
- **Provenance travels with data (MAD-7):** external resource references (`resource_external_id`, `resource_external_source`) always carry their source, never a bare value.

---

## 4. Governance of Automation Level Changes

An automation definition's level is not self-determined. Raising an automation's level (e.g. from `LEVEL_3_APPROVAL_REQUIRED` to `LEVEL_4_FULL_AUTOMATIC`) is itself a governed action:

1. It requires a new `aut_approval_policies` entry or an explicit amendment to an existing one.
2. It requires a recorded, non-self approval — the same separation-of-duties rule that governs any other `LEVEL_3` action.
3. It is recorded permanently in `aut_audit_events` as a distinct event type (`automation_level_changed`), never inferred from a version bump alone.
4. It must be preceded by a track record at the lower level sufficient to justify the change — this document does not define a numeric threshold; that is left to the approval policy itself, reviewed case by case.

A workflow that attempts to execute above its currently approved level is a `VALIDATION` or `AUTHORIZATION` class failure (see `docs/AUTOMATION_ARCHITECTURE.md` §6) and must be blocked at `GATE_CHECK`, not silently permitted.

---

## 5. Governance of the Permanent Approval Boundaries

The list of actions in `docs/AUTOMATION_APPROVAL_MATRIX.md` §"Permanent LEVEL_3 Boundaries" is **permanent** — it remains `LEVEL_3_APPROVAL_REQUIRED` unless a future, explicit governance amendment changes it. No automation stage, connector, or configuration change may unilaterally remove an item from that list. Any future amendment to that list must:

- be a standalone, explicit governance decision (not a side effect of an unrelated implementation stage),
- be recorded in `docs/AI_HANDOVER.md` and `docs/AUTOMATION_APPROVAL_MATRIX.md` together,
- preserve the audit trail of the prior boundary (never silently edit history — add a dated amendment note).

---

## 6. Governance of Secrets

Secret handling in the Automation track follows the permanent policy in `docs/AUTOMATION_SECURITY_AND_SECRETS.md`. That policy is not scoped to AUT-0 — it is the permanent rule for every future Automation stage, connector, and workflow. No later stage may relax it without an explicit, standalone governance amendment to that document.

---

## 7. Documentation Requirements for Future Automation Stages

Every future Automation implementation stage (`INF-OVH-API-0` onward, see `docs/AUTOMATION_ROADMAP.md`) must, on completion:

- update `docs/AI_HANDOVER.md` with objective, commit hashes, files changed, and validation results, following the same pattern established for every prior stage in this repository,
- update `docs/AUTOMATION_ROADMAP.md` status for that stage only — never mark a later stage started or complete as a side effect,
- preserve this document's sequencing rules (§2) without exception,
- never claim a connector is "operational," a database is "deployed," or a provider login has occurred unless it verifiably has — see `docs/AUTOMATION_OPERATIONS_RUNBOOK.md` for the operator-facing verification discipline this implies.

---

## 8. Status

Governance document only. This stage (AUT-0) has not started any implementation, has not modified any runtime file, and has not begun `INF-OVH-API-0`, Stage 3E, IDA-2, ATN-1, or AVA-1.
