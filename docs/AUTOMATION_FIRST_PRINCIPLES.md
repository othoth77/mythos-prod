# Mythos — Automation First Principles

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Documentation only. No connector, deployment, or database exists yet.
**Date:** 2026-08-06

---

## 1. The Group Principle: Automation First

> **Every safe, repeatable and measurable operation should eventually be automated. Automation must not remove governance. High-risk actions remain automated in preparation and validation, but require explicit human approval before execution.**

This is a permanent, group-wide principle across the entire Mythos ecosystem — not scoped to any single product. It applies equally to Mythos OS, ID Auto, Atelier Network, AutoValeur, and the infrastructure/Cloudflare track, and to every future product added to the portfolio.

### What "Automation First" means in practice

- If an operation is **safe** (does not risk data loss, service disruption, financial loss, legal exposure, or irreversible external effects), **repeatable** (the same steps recur across time, environments, or domains), and **measurable** (success/failure can be verified automatically), it is a candidate for automation — eventually, not necessarily immediately.
- Automation is a target state, not a mandate to automate everything at once. Stages are introduced deliberately, in dependency order, each validated before the next begins (see `docs/AUTOMATION_ROADMAP.md`).
- **Automation must not remove governance.** Every automated workflow still passes through the same approval, audit, and rollback discipline a careful human operator would apply — the goal is to make that discipline consistent and enforced, not to bypass it.
- **High-risk actions remain automated in preparation and validation, but require explicit human approval before execution.** Discovery, snapshotting, analysis, planning, dry-run simulation, and gate-checking can all be fully automated even for the highest-risk operations. Only the actual `APPLY` step of a high-risk action waits on a recorded, non-inferred human decision. See `docs/AUTOMATION_APPROVAL_MATRIX.md` for the permanent list of actions that always require this.

### What Automation First does not mean

- It does not mean removing human judgement from consequential decisions.
- It does not mean an automation workflow may promote itself to a higher trust level without an audited policy change (see `docs/AUTOMATION_ARCHITECTURE.md` §"Automation Levels").
- It does not mean secrets, credentials, or destructive capability are ever embedded directly in a workflow definition — see `docs/AUTOMATION_SECURITY_AND_SECRETS.md`.
- It does not mean this stage (AUT-0) authorises any actual automation to run. AUT-0 is documentation, architecture, configuration, and draft schema only.

---

## 2. Mythos Control Center

**Official name:** Mythos Control Center

**Positioning:** The central operational console for Mythos products, infrastructure, connectors, automation runs, approvals, incidents, backups, deployments, and service health.

Mythos Control Center is the **operator-facing product** — the thing a human operator opens to see what's running, what needs approval, what's healthy, and what needs attention. It is specified in `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`. This stage defines its module list and purpose only; no UI or runtime code is built.

---

## 3. Mythos Automation & Operations

**Technical capability name:** Mythos Automation & Operations
**Product key:** `mythos_automation`

**Purpose:** the underlying platform capability that:

- orchestrates repeatable workflows,
- connects authorised external providers,
- schedules operations,
- validates prerequisites,
- requests approvals,
- executes approved actions,
- verifies results,
- triggers rollback,
- preserves audit history,
- notifies operators,
- exposes operational health to Mythos Control Center.

Mythos Automation & Operations is the **platform capability** — the engine. It is specified in `docs/AUTOMATION_ARCHITECTURE.md`, `docs/AUTOMATION_GOVERNANCE.md`, `docs/AUTOMATION_APPROVAL_MATRIX.md`, `docs/AUTOMATION_SECURITY_AND_SECRETS.md`, and drafted (not deployed) in `projects/automation/`.

---

## 4. The Distinction Between the Two

| | Mythos Control Center | Mythos Automation & Operations |
|---|---|---|
| **What it is** | Operator-facing product (a console) | Platform capability (an engine) |
| **Who interacts with it directly** | Human operators | Automation definitions, connectors, schedules |
| **What it shows** | Portfolio, connectors, runs, approvals, incidents, backups, deployments, health | N/A — it does the work the console displays |
| **Governing document** | `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md` | `docs/AUTOMATION_ARCHITECTURE.md` |
| **Product key** | (operator product, no separate schema — consumes `mythos_automation` data) | `mythos_automation` |

Mythos Control Center is never described as itself performing automation — it is the window into what Mythos Automation & Operations does, and the place approvals and policy decisions are recorded by a human.

---

## 5. Relationship to Existing Mythos Governance

Automation First does not supersede or relax any existing governance rule in this repository:

- The **one-major-stage rule** (`docs/ROADMAP.md`) still applies — Automation stages are sequenced like any other product track and do not grant themselves parallel authorisation.
- The **product-schema alignment** rule (MAD-1, `docs/AUTOMOTIVE_ARCHITECTURE.md`) applies to `mythos_automation` exactly as it does to `idauto`, `autovaleur`, `mythos_automotive`, and `atelier_network` — no cross-schema foreign keys, one writer per noun.
- The **no-cross-schema-FK** and **provenance-travels-with-data** rules apply identically to `aut_*` tables.
- The Cloudflare-specific rollback-safety language already established in `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` (restricted, time-bounded fallbacks; no casual TLS downgrade; no unconditional Access removal on administrative hostnames) is the concrete precedent this stage generalises into the platform-wide approval and rollback model.

---

## 6. Status of This Document

This document establishes naming and positioning only. No automation runs. No connector exists. No database is deployed. See `docs/AUTOMATION_ROADMAP.md` for what happens next, and `docs/AI_HANDOVER.md` for the current verified repository state.
