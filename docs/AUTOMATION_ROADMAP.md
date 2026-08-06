# Mythos Automation & Operations — Roadmap

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Documentation only. No stage after AUT-0 has started.
**Date:** 2026-08-06

---

## 1. Automation Track Overview

This is the stage sequence for Mythos Automation & Operations (`mythos_automation`) and the Mythos Control Center operator product. It is a separate product track, governed by `docs/AUTOMATION_GOVERNANCE.md`, and subject to the same one-major-stage rule as every other track in `docs/ROADMAP.md`.

| Stage | Description | Status |
|---|---|---|
| AUT-0 | Automation-First Master Foundation — principles, Mythos Control Center spec, architecture, governance, approval matrix, security/secrets policy, operations runbook, draft control-plane schema | ✓ Current documentation stage |
| INF-OVH-API-0 | OVH Read-Only Connector | Planned — next Automation implementation stage |
| INF-CF-AUTO-0 | Cloudflare Read-Only Connector | Planned |
| INF-DNS-AUTO-1 | DNS Snapshot, Comparison and Drift Detection | Planned |
| INF-DNS-AUTO-2 | Approved DNS Operations | Planned |
| INF-DEPLOY-AUTO-0 | GitHub to Coolify Delivery Foundation | Planned |
| INF-BACKUP-AUTO-0 | Automated Backup and Restore Verification | Planned |
| INF-MONITOR-AUTO-0 | Infrastructure, DNS, SSL and Service Monitoring | Planned |
| OPS-AUTO-0 | Business Workflow Automation | Planned |
| OPS-AUTO-1 | Notifications, Relances and Scheduled Reports | Planned |

**No stage beyond AUT-0 has started.** This roadmap records the intended sequence and each stage's scope; it does not authorise or begin any of them.

---

## 2. Stage Detail

### AUT-0 — Automation-First Master Foundation (current)

Documentation, architecture, configuration, and draft SQL only. Establishes the Automation First principle, Mythos Control Center product spec, Mythos Automation & Operations architecture, governance, permanent approval boundaries, secrets policy, operations runbook, and a 24-table draft (undeployed) PostgreSQL schema.

### INF-OVH-API-0 — OVH Read-Only Connector

`LEVEL_1_READ_ONLY` only. Scope:

- list authorised domains (the same eight domains from `docs/CLOUDFLARE_DOMAIN_INVENTORY.md`, unless the owner extends the list),
- collect registrar metadata,
- collect authoritative DNS records,
- collect DNSSEC state,
- generate redacted structured snapshots,
- **no writes.**

This is the natural successor to the manual process defined in `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md` — it automates the *collection* of authoritative evidence, not any decision or write action.

### INF-CF-AUTO-0 — Cloudflare Read-Only Connector

`LEVEL_1_READ_ONLY` only. Scope:

- account and zone inventory,
- current settings inventory,
- **no writes.**

### INF-DNS-AUTO-1 — DNS Snapshot, Comparison and Drift Detection

`LEVEL_1_READ_ONLY` / `LEVEL_2_RECOMMEND`. Scope:

- OVH vs public DNS vs Cloudflare comparison,
- email safety analysis,
- DNSSEC safety analysis,
- migration and rollback plan generation.

This is where the record-by-record comparison required by `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` criterion 8 becomes automatable — the comparison itself, not the resulting migration.

### INF-DNS-AUTO-2 — Approved DNS Operations

`LEVEL_3_APPROVAL_REQUIRED` only. Scope:

- one domain at a time,
- explicit owner approval (per `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`),
- automatic verification and rollback.

This stage is where INF-CF-2 itself becomes executable — but only after its own entry criteria are separately satisfied. Introducing `INF-DNS-AUTO-2` does not itself unblock INF-CF-2.

### INF-DEPLOY-AUTO-0 — GitHub to Coolify Delivery Foundation

Deployment pipeline foundation — scope to be defined in that stage's own planning, subject to the same approval-matrix constraints (production deployment requires a separately approved release policy, per `docs/AUTOMATION_APPROVAL_MATRIX.md` §3).

### INF-BACKUP-AUTO-0 — Automated Backup and Restore Verification

Backup generation and restore-test automation — restore tests in isolated environments are `LEVEL_4`-eligible per the approval matrix; production restore and backup deletion remain `LEVEL_3` permanent boundaries.

### INF-MONITOR-AUTO-0 — Infrastructure, DNS, SSL and Service Monitoring

Health-check and drift-detection automation feeding Mythos Control Center's Infrastructure Health module.

### OPS-AUTO-0 — Business Workflow Automation

Business-process automation (order/workflow automation across Mythos products) — scope to be defined in that stage's own planning.

### OPS-AUTO-1 — Notifications, Relances and Scheduled Reports

Operator and customer-facing notification/report automation, built on the `aut_notifications` model.

---

## 3. Permanent Sequencing Rules

- **AUT-0 is documentation only.**
- **INF-OVH-API-0 is the next Automation implementation stage** — it has not started.
- **INF-CF-2 remains blocked** until authoritative data and approvals exist, per `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`. Nothing in the Automation track changes this.
- **Stage 3E remains the next Mythos OS runtime stage.**
- **IDA-2 remains the next authorised Automotive implementation stage.**
- **Only one major implementation stage at a time**, unless explicitly authorised otherwise (`docs/ROADMAP.md` "One-major-stage rule").

No stage in this document may be marked started by a later stage's documentation alone — each stage records its own start and completion in `docs/AI_HANDOVER.md` when it actually begins.

---

## 4. Status

Documentation only. No stage after AUT-0 has been started, implemented, or deployed.
