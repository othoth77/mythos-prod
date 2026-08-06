# Mythos Automation & Operations — Operations Runbook

**Stage:** AUT-0 — Automation-First Master Foundation
**Status:** Forward-looking runbook. Describes how operators will interact with the platform once it exists — no run has ever executed.
**Date:** 2026-08-06

---

## 1. Purpose

This runbook describes, in advance of any implementation, how a human operator is expected to interact with Mythos Automation & Operations through Mythos Control Center once both exist. It is written now so that every future implementation stage builds toward the same operator experience, rather than each stage inventing its own ad hoc conventions.

**Nothing in this document is currently operable.** No connector is enabled, no automation definition exists in a live database, and Mythos Control Center has no UI.

---

## 2. Reading a Run

Once runs exist, an operator reviewing one in Mythos Control Center should be able to answer, from the `aut_runs` record and its associated `aut_run_steps`, `aut_snapshots`, `aut_execution_plans`, `aut_approvals`, and `aut_audit_events` rows, without needing to ask anyone:

- What automation, at what version, ran this?
- At what automation level, and was it a dry run?
- What environment and (if applicable) organisation did it target?
- What triggered it, and who (or what system) requested it?
- What did it plan to do, before it did anything? (`plan_reference`)
- Did it require approval, and if so, who approved it, when, and was that a permitted approver under separation-of-duties rules?
- What actually happened at each lifecycle step, and when?
- If it failed, what failure class, and is that a class that retries?
- If it rolled back, is that rollback itself recorded as its own audited execution?
- Is there an open incident linked to this run?

If any of these questions cannot be answered from the recorded data, that is a defect in the implementing stage, not an acceptable gap.

---

## 3. Responding to an `AWAITING_APPROVAL` Run

1. Open the run in Mythos Control Center → Approvals.
2. Review the plan (`plan_reference`) and simulated impact — never approve from the action's name alone.
3. Confirm the requester is not also the approver, when the governing `aut_approval_policies` row requires separation of duties (see `docs/AUTOMATION_APPROVAL_MATRIX.md`).
4. Approve or reject. A rejection is final for that run — a new run must be created to retry, it cannot be re-submitted for approval.
5. If approving a permanent-boundary action (`docs/AUTOMATION_APPROVAL_MATRIX.md` §2 — e.g. a nameserver change), confirm the domain-specific prerequisites in the relevant entry-criteria document (e.g. `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` for DNS) are independently satisfied — the automation platform's own gate check is necessary but not sufficient for domains with their own dedicated entry gate.

---

## 4. Responding to a Dead Letter

1. Open Mythos Control Center → Incidents (a dead letter that isn't already linked to one should be triaged and linked).
2. Review `error_summary` and `failure_class` on the `aut_dead_letters` row.
3. If `failure_class` is `SECURITY` or `DATA_INTEGRITY`, treat as high-priority regardless of any other signal — these never retried automatically by design.
4. Decide: retry manually (new run, same idempotency scope), discard (mark `DISCARDED` with a reason), or escalate.
5. Never silently clear a dead letter without a recorded resolution — the `status` transition itself is an auditable event.

---

## 5. Responding to a Rollback Failure

A failed rollback (`aut_rollback_executions.status = 'FAILED'`) always creates a `CRITICAL` incident (`docs/AUTOMATION_ARCHITECTURE.md` §6). Treat this as the highest-priority incident class:

1. Do not attempt an automated second rollback without manual review — a rollback that failed once has invalidated the assumption that the rollback plan's prerequisites still hold.
2. Manually verify actual current state of the affected resource before deciding the next step.
3. Prefer the specific rollback-safety language already established for the resource type in question (e.g. `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` for DNS/Tunnel/Access resources) over improvising a faster fix under pressure.

---

## 6. Reading Health and Drift Signals

Once `INF-MONITOR-AUTO-0` exists (`docs/AUTOMATION_ROADMAP.md`), Mythos Control Center → Infrastructure Health will surface `aut_health_checks` rows for connector reachability, SSL expiry, and DNS drift. Until then, health information continues to come from the existing manual/public-source processes documented in `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` and `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`.

---

## 7. What This Runbook Does Not Cover

- It does not describe how to configure a connector, approval policy, or schedule — that is implementation-stage-specific documentation, to be written when `INF-OVH-API-0` or later stages actually exist.
- It does not grant any operator any capability today — every action described here assumes a fully implemented platform that does not yet exist.
- It does not authorise any operator to bypass the approval matrix under any circumstance, including incident pressure — see `docs/AUTOMATION_APPROVAL_MATRIX.md` and the Cloudflare rollback-safety precedent it generalises.

---

## 8. Status

Forward-looking documentation only. No run, approval, dead letter, incident, or rollback has ever occurred on this platform.
