# Mythos Control Center — Product Specification

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Product specification only. No UI or runtime code is built in this stage.
**Date:** 2026-08-06

---

## 1. Product Identity

**Official name:** Mythos Control Center

**Positioning:** The central operational console for Mythos products, infrastructure, connectors, automation runs, approvals, incidents, backups, deployments, and service health.

Mythos Control Center is where a human operator goes to understand the current state of the entire Mythos ecosystem and to make the decisions that Mythos Automation & Operations (the underlying platform capability, `docs/AUTOMATION_ARCHITECTURE.md`) cannot make for itself — principally, approvals for `LEVEL_3_APPROVAL_REQUIRED` actions.

## 2. Relationship to Mythos Automation & Operations

Mythos Control Center is the operator-facing product. Mythos Automation & Operations (`mythos_automation`) is the underlying platform capability it is built on. See `docs/AUTOMATION_FIRST_PRINCIPLES.md` §4 for the full distinction. Every module below reads from and, where the module involves a decision, writes to the `mythos_automation` data model drafted in `projects/automation/database/control-plane-schema.sql`.

## 3. Users

- **Mythos Super Admin** — full visibility across all products, environments, and organisations; the only role that can approve the permanent LEVEL_3 boundary actions listed in `docs/AUTOMATION_APPROVAL_MATRIX.md`, subject to separation-of-duties rules.
- **Product operators** — scoped visibility and approval authority limited to their product's environments and connectors.
- **Read-only observers** — visibility into runs, incidents, and health without approval authority (e.g. for audit or reporting purposes).

Role and permission modelling for these users is deferred to a future implementation stage; this document establishes only that such roles exist and that approval authority is scoped, not universal.

## 4. Modules

Mythos Control Center is organised into the following modules. Each is a future UI surface backed by the `mythos_automation` data model — none is built in this stage.

| Module | Purpose |
|---|---|
| **Portfolio Overview** | Cross-product summary: which products exist, their stage, their environments, and their overall health at a glance. |
| **Products and Services** | Registry of Mythos products and the services each one runs, cross-referenced with `mythos_automotive_products` and equivalent registries in other product schemas (read-only cross-reference, no cross-schema FK). |
| **Environments** | The `aut_environments` registry — production, staging, sandbox — with risk classification. |
| **Connectors** | The `aut_connectors` and `aut_connector_capabilities` registries: which external providers are connected, at what permission level, and their health. |
| **Automations** | The `aut_automation_definitions` and `aut_automation_versions` registries: what workflows exist, their automation level, and their version history. |
| **Schedules** | The `aut_schedules` registry: recurring and one-off triggers. |
| **Runs** | The `aut_runs`, `aut_run_steps`, and `aut_run_resources` registries: live and historical execution of every automation, with full lifecycle visibility (`DISCOVER` → `CLOSE`). |
| **Approvals** | The `aut_approvals` registry: pending and historical approval decisions, with separation-of-duties enforcement visible to the operator. |
| **Deployments** | Future surface for GitHub → Coolify delivery status (see `INF-DEPLOY-AUTO-0` in `docs/AUTOMATION_ROADMAP.md`). |
| **Domains and DNS** | Future surface consuming the INF-CF domain inventory, migration matrix, and (once INF-DNS-AUTO-1 exists) live drift detection between OVH, public DNS, and Cloudflare. |
| **Infrastructure Health** | The `aut_health_checks` registry: connector reachability, SSL expiry, DNS drift, service health. |
| **Databases** | Future surface for PostgreSQL connector-derived visibility (read-only by default, per the connector split in `docs/AUTOMATION_ARCHITECTURE.md`). |
| **Backups and Restore Tests** | Future surface for `INF-BACKUP-AUTO-0` — backup generation status, integrity checks, and restore-test results. |
| **Security** | Future surface summarising connector security classifications, capability grants, and open security-relevant incidents. |
| **Secrets Metadata** | The `aut_secret_references` registry — metadata only, never a secret value (see `docs/AUTOMATION_SECURITY_AND_SECRETS.md`). |
| **Incidents** | The `aut_incidents` registry: open, acknowledged, and resolved incidents, linked to their originating dead letter, rollback failure, or health check. |
| **Audit** | The `aut_audit_events` append-only trail — the permanent, unmodifiable record of every decision and state transition the platform has made or proposed. |
| **Costs** | Future surface for infrastructure/provider cost visibility — not modelled in the AUT-0 draft schema; deferred to a future stage. |
| **Notifications** | The `aut_notifications` registry: delivered and pending operator notifications, with deduplication. |
| **Reports** | Future surface for scheduled and on-demand reporting (see `OPS-AUTO-1` in `docs/AUTOMATION_ROADMAP.md`). |
| **Settings** | Future surface for approval-policy configuration, retry/timeout defaults, and notification routing — editing the values currently drafted as static configuration in `projects/automation/config/automation.example.json`. |

## 5. What Mythos Control Center Is Not

- It is not itself an automation engine — it displays and gates decisions for Mythos Automation & Operations, it does not execute workflows directly.
- It does not bypass the approval matrix — every `LEVEL_3_APPROVAL_REQUIRED` action still requires the recorded, non-self, non-expired approval defined in `docs/AUTOMATION_APPROVAL_MATRIX.md`, regardless of who is viewing the console.
- It does not store or display secret values — only `aut_secret_references` metadata.
- It is not built in this stage. This document is a specification only.

## 6. Status

Product specification only. No UI, no runtime code, no deployment. See `docs/AUTOMATION_ROADMAP.md` for when Mythos Control Center's modules become implementation targets — no target stage is scheduled by AUT-0.
