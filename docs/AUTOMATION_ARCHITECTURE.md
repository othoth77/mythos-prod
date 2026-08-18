# Mythos Automation & Operations — Architecture

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Draft architecture. No connector, deployment, or database exists yet.
**Date:** 2026-08-06

---

## 1. Scope

This document defines the architecture of Mythos Automation & Operations (`mythos_automation`), the platform capability underlying Mythos Control Center. It covers automation levels, the standard lifecycle, required execution fields, the connector model, failure/retry/rollback rules, and observability. It does not implement any of this — see `projects/automation/database/control-plane-schema.sql` for the draft (undeployed) data model and `docs/AUTOMATION_ROADMAP.md` for the implementation sequence.

---

## 2. Automation Levels

Four permanent automation levels. **A workflow may never silently promote itself to a higher level — automation level changes require audited policy approval**, recorded as an `aut_audit_events` row referencing the `aut_approval_policies` change.

### LEVEL_1_READ_ONLY

- discover, inspect, export, snapshot, compare, report.
- **No external mutation.**

### LEVEL_2_RECOMMEND

- analyse, create plans, simulate, dry-run, calculate impact, generate rollback plans.
- **No external mutation.**

### LEVEL_3_APPROVAL_REQUIRED

- prepare the action automatically,
- verify all gates automatically,
- require explicit authorised approval,
- execute only after approval,
- verify automatically,
- rollback automatically when the approved policy permits.

### LEVEL_4_FULL_AUTOMATIC

- execute without per-run human approval,
- permitted only for approved low-risk operations,
- must have monitoring, audit, bounded retries, and rollback or safe failure,
- requires a previously approved policy.

See `docs/AUTOMATION_APPROVAL_MATRIX.md` for the permanent list of actions that remain `LEVEL_3_APPROVAL_REQUIRED` regardless of how mature the surrounding automation becomes, and the routine examples that may eventually reach `LEVEL_4_FULL_AUTOMATIC`.

---

## 3. Standard Automation Lifecycle

Every automation run — regardless of automation level — passes through the same named lifecycle. A `LEVEL_1_READ_ONLY` run simply terminates early (there is no `APPLY`); it does not skip the steps that precede it.

```
DISCOVER → SNAPSHOT → ANALYSE → PLAN → DRY_RUN → GATE_CHECK → APPROVAL
   → APPLY → VERIFY → ROLLBACK (when required) → AUDIT → NOTIFY → CLOSE
```

Each stage produces an explicit status, recorded on `aut_run_steps`. `ROLLBACK` only executes when policy permits and only when the prerequisites captured at `PLAN` time still hold — see §6.

### Run Statuses

| Status | Terminal? | Meaning |
|---|---|---|
| `QUEUED` | No | Run created, not yet started |
| `DISCOVERING` | No | `DISCOVER` step in progress |
| `SNAPSHOTTING` | No | `SNAPSHOT` step in progress |
| `ANALYSING` | No | `ANALYSE` step in progress |
| `PLANNED` | No | `PLAN` step complete |
| `DRY_RUN_COMPLETE` | No | `DRY_RUN` step complete |
| `BLOCKED` | No | `GATE_CHECK` failed; run cannot proceed without intervention |
| `AWAITING_APPROVAL` | No | Waiting on a `LEVEL_3_APPROVAL_REQUIRED` decision |
| `APPROVED` | No | Approval recorded; ready for `APPLY` |
| `REJECTED` | **Yes** | Approval explicitly denied; run cannot execute |
| `APPLYING` | No | `APPLY` step in progress |
| `VERIFYING` | No | `VERIFY` step in progress |
| `SUCCEEDED` | **Yes** | `VERIFY` confirmed success; run complete |
| `FAILED` | **Yes** | `APPLY` or `VERIFY` failed and no rollback was applicable/possible |
| `ROLLING_BACK` | No | `ROLLBACK` step in progress |
| `ROLLED_BACK` | **Yes** | `ROLLBACK` completed successfully |
| `MANUAL_INTERVENTION_REQUIRED` | **Yes** | Automated recovery exhausted; a human must act (see §7 dead-letter handling) |
| `CANCELLED` | **Yes** | Run cancelled before completion, by policy or operator action |

Terminal statuses never transition further. A new run — with its own `run_id` — is required for any subsequent attempt.

---

## 4. Required Execution Fields

Every automation run must support the following fields (drafted as columns on `aut_runs` and related tables in `projects/automation/database/control-plane-schema.sql`):

`automation_id`, `automation_version`, `run_id`, `environment_id`, `organization_id` (where applicable), `connector_id`, `trigger_type`, `requested_by`, `approval_policy_id`, `automation_level`, `dry_run`, `correlation_id`, `idempotency_key`, `resource_lock_key`, `audit_event_id`, `snapshot_reference`, `plan_reference`, `approval_status`, `approved_by`, `approved_at`, `rollback_plan_reference`, `rollback_execution_reference`, `started_at`, `completed_at`, `timeout_at`, `retry_count`, `max_retries`, `result_status`, `error_class`, `error_summary`, `incident_id`, `source`, `created_at`, `updated_at`.

### Rules

- No PII inside identifiers — `requested_by`, `approved_by`, and similar fields are opaque references, never names, emails, or phone numbers.
- No secret values anywhere in a run record.
- Retries must not duplicate side effects — enforced via `idempotency_key` and the `aut_idempotency_keys` table.
- Idempotency must be enforced for every mutating operation.
- Resource locks (`aut_resource_locks`) prevent conflicting simultaneous operations on the same external resource.
- Audit records (`aut_audit_events`) are append-only — no update or delete path exists or may be added without a separate governance amendment.
- Approvals cannot be self-approved when separation of duties is required (`docs/AUTOMATION_APPROVAL_MATRIX.md`).
- An expired approval cannot be reused by any later run.
- A rejected run cannot execute.
- Rollback is a separate, audited execution (`aut_rollback_executions`) — never silently folded into the original run's result.

---

## 5. Connector Model

Connectors are the platform's boundary to external providers. See `projects/automation/config/automation.example.json` §`connector_catalogue` for the current (all-disabled) placeholder catalogue, and `projects/automation/database/control-plane-schema.sql` tables `aut_connectors` / `aut_connector_capabilities` for the draft data model.

### Infrastructure connectors (future)

OVHcloud, Cloudflare, GitHub, Coolify, VPS / host agent, PostgreSQL, object storage, backup storage, monitoring provider.

### Business and communication connectors (future)

n8n, email, WhatsApp, SMS, payment provider, document storage, product APIs.

### Required fields per connector definition

`connector_id`, `provider`, `connector_type`, `environment`, `organisation scope`, `supported capabilities`, `granted permissions`, `authentication method`, `secret_reference` only (never a value), `rate limits`, `timeout`, `retry policy`, `health status`, `last successful check`, `legal classification`, `security classification`, `enabled flag`, `owner`, `rollback capability`, `audit policy`.

### Rules

- **Credentials are never stored in Git.** Every connector references a `secret_reference_id`; the value lives in an approved secret manager, Coolify encrypted environment variables, or VPS environment variables — see `docs/AUTOMATION_SECURITY_AND_SECRETS.md`.
- **Least privilege is documented and enforced structurally.** Read and write permissions are never combined automatically — each capability (`aut_connector_capabilities`) is its own row with its own grant, its own automation-level ceiling, and its own approval-policy reference.
- Example future connector split (illustrative, none enabled today): `ovh_readonly`, `ovh_dns_operator`, `cloudflare_readonly`, `cloudflare_dns_operator`, `github_repository`, `coolify_deployer`. A read connector and a write connector for the same provider are always distinct connector definitions, never one connector with both permissions.

### Tool Registry precursor (roadmap capability K)

`docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` §7 names this connector catalogue as the implemented precedent for the future runtime-wide Tool Registry (capability K, still PLANNED). Each connector entry now also carries `risk_level` (mechanically derived from `permission` — `READ_ONLY`→`LOW`, `WRITE_SCOPED`→`HIGH` — never hand-set) and `cost_class` (`UNMEASURED_NO_LIVE_CALLS` for every connector today, since none has ever made a live call). Per-capability input/output schemas live in `projects/automation/reference/tool-registry-catalogue.js` rather than duplicated per connector, since a capability's shape does not depend on which connector exposes it. That module composes the JSON catalogue with the schema map into a Tool-Registry-shaped view and fails closed on any entry missing a field or violating the risk/permission mapping — it never enables a connector, grants a capability, or changes a permission.

---

## 6. Failure, Retry and Rollback

### Failure Classes

`TRANSIENT`, `RATE_LIMITED`, `AUTHENTICATION`, `AUTHORIZATION`, `VALIDATION`, `CONFLICT`, `EXTERNAL_PROVIDER`, `TIMEOUT`, `SECURITY`, `DATA_INTEGRITY`, `MANUAL_INTERVENTION`.

### Rules

- Retries are allowed only for safe, classified failures: `TRANSIENT`, `RATE_LIMITED`, `TIMEOUT`, `EXTERNAL_PROVIDER`. See `retryable_failure_classes` in `projects/automation/config/automation.example.json`.
- Retries use exponential backoff with a maximum delay (`max_delay_seconds`) — never unbounded.
- A maximum retry count (`max_retries`) is always required; there is no such thing as an infinite-retry policy in this architecture.
- Mutating retries require idempotency — a retried mutating operation must present the same `idempotency_key` as its original attempt.
- Failed operations enter a dead-letter queue (`aut_dead_letters`) after retry exhaustion — they are never silently dropped.
- `SECURITY` and `DATA_INTEGRITY` failures **do not retry automatically** — they go straight to `MANUAL_INTERVENTION_REQUIRED` and raise an incident.
- Rollback starts only when the governing policy permits it **and** the prerequisites captured at `PLAN` time remain valid — a rollback is not attempted blindly against a state that has since changed.
- Rollback failure creates a critical incident (`aut_incidents`, severity `CRITICAL`) — a failed rollback is never treated as a routine failure.
- Every partial success is recorded explicitly (`result_status = 'PARTIAL_SUCCESS'` on `aut_runs`) — never collapsed into a simple success/failure binary.

---

## 7. Observability and Notifications

### Tracked signals

Structured logs, metrics, traces, health checks, run timelines, provider latency, provider error rate, retry counts, dead-letter count, approval waiting time, success rate, rollback rate, backup status, restore-test status, deployment status, DNS drift status, SSL expiry status, infrastructure capacity status.

### Notification priorities

`INFO`, `WARNING`, `HIGH`, `CRITICAL`.

### Rules

- Successful routine operations may be summarised rather than individually notified.
- Failures requiring action notify immediately.
- Repeated identical alerts must be deduplicated (`dedupe_key` on `aut_notifications`).
- Alerts must link to `run_id` and `incident_id` so an operator can always trace an alert back to its source.
- Secrets and personal data must be redacted from every notification body.

---

## 8. Status

Draft architecture only. No table in `projects/automation/database/control-plane-schema.sql` has been created. No connector in the catalogue is enabled. No workflow executes. See `docs/AUTOMATION_ROADMAP.md` for the implementation sequence, starting with `INF-OVH-API-0` (read-only only).
