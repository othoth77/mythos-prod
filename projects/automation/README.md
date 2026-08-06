# Mythos Automation & Operations

**Product key:** `mythos_automation`
**Operator product:** Mythos Control Center
**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Documentation, architecture, configuration and draft schema only. Not deployed. Not connected to any external provider.

## What This Is

Mythos Automation & Operations is the shared platform capability that will, in future stages, orchestrate repeatable workflows across the Mythos ecosystem: connecting authorised external providers, scheduling operations, validating prerequisites, requesting and recording approvals, executing approved actions, verifying results, triggering rollback, preserving audit history, notifying operators, and exposing operational health to **Mythos Control Center** — the operator-facing console for Mythos products, infrastructure, connectors, automation runs, approvals, incidents, backups, deployments, and service health.

This directory (`projects/automation/`) holds the draft foundation for that capability. Nothing here is deployed, executed, or connected to a live provider.

## Governing Principle: Automation First

> Every safe, repeatable and measurable operation should eventually be automated. Automation must not remove governance. High-risk actions remain automated in preparation and validation, but require explicit human approval before execution.

See `docs/AUTOMATION_FIRST_PRINCIPLES.md` for the full statement of this principle and how it applies across the Mythos ecosystem.

## Repository Layout

```
projects/automation/
├── README.md                          — this file
├── config/
│   └── automation.example.json        — draft configuration (all flags false, no secrets)
└── database/
    └── control-plane-schema.sql       — draft PostgreSQL schema (24 tables, NOT DEPLOYED)
```

## Related Documentation

| Document | Covers |
|---|---|
| `docs/AUTOMATION_FIRST_PRINCIPLES.md` | The Automation First principle, Mythos Control Center and Mythos Automation & Operations naming/positioning |
| `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md` | The operator-facing product: modules, users, scope |
| `docs/AUTOMATION_ARCHITECTURE.md` | Automation levels, lifecycle, required execution fields, connector model, failure/retry/rollback, observability |
| `docs/AUTOMATION_GOVERNANCE.md` | Operating rules, sequencing, one-major-stage rule as applied to Automation |
| `docs/AUTOMATION_APPROVAL_MATRIX.md` | Permanent LEVEL_3 approval boundaries and routine LEVEL_4-eligible examples |
| `docs/AUTOMATION_SECURITY_AND_SECRETS.md` | The permanent Mythos secrets policy |
| `docs/AUTOMATION_OPERATIONS_RUNBOOK.md` | How operators are expected to interact with runs, approvals and incidents once the platform exists |
| `docs/AUTOMATION_ROADMAP.md` | The AUT-*/INF-*-AUTO-*/OPS-AUTO-* stage sequence |

## Status of This Stage (AUT-0)

- Documentation, architecture, configuration, and draft SQL only.
- No OVH connector implemented. No OVH or Cloudflare credentials requested or created. No login to any provider performed.
- No DNS or nameserver change. No DNSSEC operation.
- No database installed, migrated, or executed. `database/control-plane-schema.sql` is a draft specification only.
- No runtime JS/HTML/PHP/CSS changed.
- No credential or secret value stored anywhere in this directory or its configuration.
- INF-CF-2 remains blocked and not started (see `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`).
- Stage 3E remains the next Mythos OS runtime stage; IDA-2 remains the next authorised Automotive implementation stage.

## Next Stage

**INF-OVH-API-0 — OVH Read-Only Connector** is the next Automation implementation stage (not started by this stage). See `docs/AUTOMATION_ROADMAP.md` for the full sequence and prerequisites.
