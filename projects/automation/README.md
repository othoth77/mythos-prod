# Mythos Automation & Operations

**Product key:** `mythos_automation`
**Operator product:** Mythos Control Center
**Stage:** INF-OVH-API-0 — OVH Read-Only Connector (reference implementation)
**Status:** Documentation, architecture, configuration, draft schema, and one mocked/in-memory reference connector implementation. Not deployed. Not connected to any external provider — no live OVH credential exists anywhere in this repository or on the deployment host.

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
├── database/
│   └── control-plane-schema.sql       — draft PostgreSQL schema (24 tables, NOT DEPLOYED)
└── reference/
    └── ovh-readonly-connector.js      — INF-OVH-API-0 mocked reference implementation (LEVEL_1_READ_ONLY only, no live credential, no live network call)
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

## Status of This Stage (INF-OVH-API-0)

- `reference/ovh-readonly-connector.js` implements the LEVEL_1_READ_ONLY scope (list authorised domains, collect registrar metadata, collect authoritative DNS records, collect DNSSEC state, generate redacted structured snapshots) as a mocked, in-memory reference implementation — it never constructs a real OVH API client and never makes a live network call itself; a real client (built in a later stage, reading credentials only from an approved secret store per `docs/AUTOMATION_SECURITY_AND_SECRETS.md`) would be injected by the caller.
- **Structurally read-only**: any injected client exposing a method whose name looks like a mutation (`create*`/`update*`/`set*`/`write*`/`delete*`/`remove*`/`patch*`/`put*`/`mutate*`/`apply*`) is rejected before any collection runs — this is enforced in code, not only by convention.
- **Refuses to run unless explicitly enabled** (`config.enabled === true`) and refuses to run with an empty authorised-domain list.
- Registrant (owner) contact fields are redacted before any snapshot record is produced; registrar, nameservers, dates, and DNSSEC state are retained, mirroring the INF-CF-1 redaction policy in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md`.
- No OVH or Cloudflare credentials requested, created, or stored anywhere. No login to any provider performed. No live network call made by this stage.
- No DNS or nameserver change. No DNSSEC operation performed against a live domain.
- No database installed, migrated, or executed. `database/control-plane-schema.sql` remains a draft specification only; this connector's snapshot-record shape matches its `aut_snapshots` table but nothing is written to any database.
- No runtime JS/HTML/PHP/CSS changed.
- INF-CF-2 remains blocked and not started (see `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`).
- Stage 3E remains the next Mythos OS runtime stage; IDA-2 remains the next authorised Automotive implementation stage.

## Next Stage

**INF-CF-AUTO-0 — Cloudflare Read-Only Connector** is the next Automation implementation stage (not started by this stage). See `docs/AUTOMATION_ROADMAP.md` for the full sequence and prerequisites.
