# Mythos Automation & Operations — Roadmap

**Stage:** INF-CF-AUTO-0 — Cloudflare Read-Only Connector (reference implementation)
**Status:** INF-OVH-API-0 and INF-CF-AUTO-0 both complete as mocked, in-memory reference implementations only — no live OVH or Cloudflare credential exists anywhere in this repository or on the deployment host, and no live network call has ever been made by either connector.
**Date:** 2026-08-08 (originally 2026-08-06 for AUT-0)

---

## 1. Automation Track Overview

This is the stage sequence for Mythos Automation & Operations (`mythos_automation`) and the Mythos Control Center operator product. It is a separate product track, governed by `docs/AUTOMATION_GOVERNANCE.md`, and subject to the same one-major-stage rule as every other track in `docs/ROADMAP.md`.

| Stage | Description | Status |
|---|---|---|
| AUT-0 | Automation-First Master Foundation — principles, Mythos Control Center spec, architecture, governance, approval matrix, security/secrets policy, operations runbook, draft control-plane schema | ✓ Current documentation stage |
| INF-OVH-API-0 | OVH Read-Only Connector | ✓ Done — mocked reference implementation + 26-test suite, on `feat/inf-ovh-api-0-readonly-connector`. **No live OVH credential exists; not deployed; not connected to a live provider.** |
| INF-CF-AUTO-0 | Cloudflare Read-Only Connector | ✓ Done — mocked reference implementation + 26-test suite, on `feat/inf-cf-auto-0-readonly-connector`. **No live Cloudflare credential exists; not deployed; not connected to a live provider.** |
| INF-DNS-AUTO-1 | DNS Snapshot, Comparison and Drift Detection | ✓ Done (2026-08-15) — mocked reference implementation + 85-test suite (`projects/automation/reference/dns-comparison-engine.js`, `tests/inf-dns-auto-1-comparison-test.js`). **No live OVH or Cloudflare credential exists; no network call; not deployed; no DNS record, zone or nameserver touched.** Comparison and analysis only — this stage does not perform, schedule or pre-authorise migration, and does not unblock INF-CF-2. |
| INF-DNS-AUTO-2 | Approved DNS Operations | ◐ Implemented and tested (2026-08-15) — `projects/automation/reference/dns-operations-executor.js` + 97-test suite. **NO DNS OPERATION HAS BEEN PERFORMED.** Execution is blocked by five independent conditions, each sufficient alone: 0 of 40 owner approval fields are `APPROVED_FOR_MIGRATION`; both DNS write connectors are `enabled: false`; every LEVEL_3 feature flag is false; no OVH/Cloudflare credential exists; no populated secret store exists. The stage is **operationally gated shut pending owner action**. |
| INF-DEPLOY-AUTO-0 | GitHub to Coolify Delivery Foundation | Planned — **not executable yet: no contract exists.** Scope is explicitly deferred below, no automation level is designated, the release policy its constraint depends on does not exist, and its connectors are disabled placeholders with no capability contract. Defining these is an **owner decision** (contract-recovery record: `docs/AI_HANDOVER.md`, 2026-08-15). |
| INF-BACKUP-AUTO-0 | Automated Backup and Restore Verification | Planned |
| INF-MONITOR-AUTO-0 | Infrastructure, DNS, SSL and Service Monitoring | Planned |
| OPS-AUTO-0 | Business Workflow Automation | Planned |
| OPS-AUTO-1 | Notifications, Relances and Scheduled Reports | Planned |

**INF-OVH-API-0 is the first stage beyond AUT-0 to be implemented — as a reference implementation only, matching the pattern established by every other foundation stage in this repository (documentation, draft schema, mocked/in-memory reference code, tests with mocked provider responses; never a live external connection).** No stage from INF-CF-AUTO-0 onward has started. This roadmap records the intended sequence and each stage's scope; it does not authorise or begin any of the remaining ones.

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

### INF-CF-AUTO-0 — Cloudflare Read-Only Connector — COMPLETE (reference implementation)

`LEVEL_1_READ_ONLY` only. Scope:

- account and zone inventory,
- current settings inventory,
- **no writes.**

Implemented as `projects/automation/reference/cloudflare-readonly-connector.js` — structurally read-only (rejects any injected client exposing a mutation-shaped method), refuses to run unless explicitly enabled, and redacts account-owner-identifying fields before any snapshot record is produced. No live Cloudflare credential exists anywhere; no live network call made. Mirrors `ovh-readonly-connector.js`'s structure with its own (deliberately duplicated, not shared) `buildSnapshotRecord`/`assertReadOnlyClient` — extracting a shared helper module was considered and explicitly deferred, not performed in this stage.

### INF-DNS-AUTO-1 — DNS Snapshot, Comparison and Drift Detection

`LEVEL_1_READ_ONLY` / `LEVEL_2_RECOMMEND`. Scope:

- OVH vs public DNS vs Cloudflare comparison,
- email safety analysis,
- DNSSEC safety analysis,
- migration and rollback plan generation.

This is where the record-by-record comparison required by `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` criterion 8 becomes automatable — the comparison itself, not the resulting migration.

**Implemented (2026-08-15) as `projects/automation/reference/dns-comparison-engine.js`** — same posture as the two connectors above: in-memory, offline, injected inputs, no live credential, no network call, not deployed. What it does:

- **Comparison** across OVH / public DNS / Cloudflare with normalisation (trailing dot, case, whitespace are formatting, not drift), `MATCH` / `VALUE_MISMATCH` / `MISSING_IN_SOURCE` verdicts, `NOT_COMPARABLE` for NS/SOA (a provider-assigned difference is not drift), and `SOURCE_ABSENT` for a source that was never supplied — an unbuilt Cloudflare zone never reads as "every record is missing".
- **Email safety**: MX / SPF (absent, multiple, soft/hardfail) / DKIM (`UNKNOWN` is reported as unknown, never as absent) / DMARC, plus a `CRITICAL` finding when a mail-bearing record is classified `PROXIED` — mail records must stay `DNS_ONLY`.
- **DNSSEC safety**: criterion 5 (state verified; `UNKNOWN` is `HIGH`, never defaulted to disabled) and criterion 6 (DS sequencing required whenever DNSSEC is enabled and a nameserver change is planned).
- **Migration and rollback plan generation** (`LEVEL_2_RECOMMEND`): DS removal is sequenced **before** the nameserver cutover and DS re-publication **after** it, per `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`. Every step declares `LEVEL_3_APPROVAL_REQUIRED`, `allow_self_approval: false`, and — for nameserver / DNSSEC-DS / record-deletion steps — `is_permanent_boundary: true` (`docs/AUTOMATION_APPROVAL_MATRIX.md` §2 items 1–3). Rollback is never `is_automatic_eligible`, names the concrete pre-migration value it restores to (or is honestly marked unrestorable), and refuses to emit a prohibited step kind (TLS downgrade, unproxying an administrative hostname, Access removal, unconditional port reopening).
- **`GATE_CHECK`** that rejects any plan claiming to authorise its own execution, any step whose automation level is inconsistent with the approval matrix, and any unrecognised step kind (fail closed).
- **Entry-criteria reporting** for criteria 8 and 9 only. Every criterion requiring owner action, authoritative-provider evidence, or an origin-side fix is permanently `REQUIRES_OWNER_ACTION`, and `entry_gate_open` is structurally always `false` — **software cannot open the INF-CF-2 gate.**

**Not in this stage:** any execution, scheduling, or approval; any live provider client; any change to a DNS record, zone, or nameserver; any deployment. Those belong to INF-DNS-AUTO-2 and to INF-CF-2's own entry criteria.

### INF-DNS-AUTO-2 — Approved DNS Operations

`LEVEL_3_APPROVAL_REQUIRED` only. Scope:

- one domain at a time,
- explicit owner approval (per `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`),
- automatic verification and rollback.

This stage is where INF-CF-2 itself becomes executable — but only after its own entry criteria are separately satisfied. Introducing `INF-DNS-AUTO-2` does not itself unblock INF-CF-2.

**Implemented (2026-08-15) as `projects/automation/reference/dns-operations-executor.js` — the guarded execution path, with NO operation performed.** It consumes an INF-DNS-AUTO-1 plan and its rollback plan and either refuses or performs exactly one authorised operation:

- **Owner approval, per domain AND per action** — the committed `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md` table is parsed and treated as the authority. Only `APPROVED_FOR_MIGRATION` authorises execution; `APPROVED_FOR_PREPARATION` explicitly does not; `DEFERRED` blocks exactly as `NOT_REQUESTED`; a value outside the six-value vocabulary is refused rather than coerced. Nameserver approval never implies DNSSEC approval. **The executor reads this gate and has no code path that writes it** — per the gate document, changing a value "is not a task an automated stage may perform on its own judgement".
- **Approval record and policy** (`aut_approvals` / `aut_approval_policies`): decision must be `APPROVE`; `is_self_approval` false; requester and approver must differ; expired approvals unusable; an approval is bound to its run and cannot be carried to another; the policy must cover `LEVEL_3_APPROVAL_REQUIRED`, be enabled, declare `is_permanent_boundary`, forbid self-approval, and carry a recognised separation-of-duties key; `required_approval_count` is satisfied only by **distinct** approvers.
- **Connector boundary**: write connectors only, drawn from the real catalogue (so a mock can never reach the write path), enabled, live feature flag on, global LEVEL_3 runs on, provider matched, capability granted, credential present **by reference only** — and least privilege enforced structurally, so an injected client exposing any undeclared method is refused as a scope escape.
- **Scope**: one domain at a time, one step per operation, anchored suffix matching so a lookalike host cannot pass, blocked steps refused, and the INF-DNS-AUTO-1 `GATE_CHECK` re-run before anything else.
- **Preconditions**: current state is compared against the snapshot the plan was built from (reusing the INF-DNS-AUTO-1 comparison); any drift refuses rather than reconciles.
- **Dry run**: builds the envelope through the same function the real path uses, so a dry run can never describe a different operation than would execute, and performs no mutation.
- **Automatic verification and rollback**: verification is mandatory and immediate; on failure the approved rollback step — and only that step — executes as a separate audited execution; a failed rollback raises a `CRITICAL` incident rather than a routine failure.
- **Audit and idempotency**: append-only audit events with no PII and no secrets, deterministic idempotency keys scoped per run, and resource lock keys derived from the target.

**Nothing was executed.** See `docs/AI_HANDOVER.md` for the five-blocker preflight record and the exact owner action required.

### INF-DEPLOY-AUTO-0 — GitHub to Coolify Delivery Foundation

Deployment pipeline foundation — scope to be defined in that stage's own planning, subject to the same approval-matrix constraints (production deployment requires a separately approved release policy, per `docs/AUTOMATION_APPROVAL_MATRIX.md` §3).

**Status (contract recovery, 2026-08-15): NOT EXECUTABLE — this section is the stage's entire authoritative text, and it defers its own scope.** An execution order for this stage was attempted and correctly stopped before implementation rather than inventing it. Three owner decisions are required before any implementation can begin:

1. **Define the scope here**, to the specificity its predecessors already have: automation level (`LEVEL_1`…`LEVEL_4`), trigger model, target repository / Coolify application / environment, what a "delivery" operation actually is, verification and rollback semantics, and prohibited operations.
2. **Author and approve the release policy** that `docs/AUTOMATION_APPROVAL_MATRIX.md` §3 requires — production deployment is not `LEVEL_4`-eligible without it. No such policy exists anywhere in this repository today. If the intent is staging-only, state that explicitly instead.
3. **Decide the connector split** for `github_repository` and `coolify_deployer` (capabilities, permission ceiling, approval-policy reference) per §5 of `docs/AUTOMATION_ARCHITECTURE.md`. Both are `enabled: false` placeholders today with no capability contract, and `docs/MYTHOS_PORTFOLIO_REGISTRY.md` classifies the Coolify/GitHub connector track as `OWNER_DIRECTION` — "live connector deployment not yet scheduled".

Nothing in this stage has been started, implemented, or deployed. The same treatment applies to `INF-BACKUP-AUTO-0`, `INF-MONITOR-AUTO-0` and `OPS-AUTO-0` below, whose scopes are likewise one line and undefined.

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
- **INF-OVH-API-0, INF-CF-AUTO-0 and INF-DNS-AUTO-1 are all complete as reference implementations** — read-only connector orchestration, comparison/analysis/plan-generation logic and tests only, no live OVH or Cloudflare credential, no live network call, not deployed. **INF-DNS-AUTO-2 is implemented and tested but operationally gated shut**: its executor exists and every gate is proven by test, yet no DNS operation can run while 0 of 40 owner approval fields are `APPROVED_FOR_MIGRATION`, both DNS write connectors are disabled, every LEVEL_3 feature flag is false, and no provider credential exists. Unblocking it is an **owner action**, not an engineering task. **INF-DEPLOY-AUTO-0 is the next Automation stage in sequence but is NOT currently executable** — contract recovery on 2026-08-15 established that it has no authoritative contract (scope deferred, no automation level, no release policy, connectors are placeholders). No stage in this track can proceed until an owner defines it; see its section above.
- **INF-CF-2 remains blocked** until authoritative data and approvals exist, per `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`. Nothing in the Automation track changes this.
- **Mythos OS Runtime is complete through Stage 4AG + RUNTIME-DUPLICATE-CLEANUP-0** (corrected 2026-08-10, `MYTHOS-STAGE-RECONCILIATION-0` — this line originally said "Stage 3E remains the next Mythos OS runtime stage," stale since Stage 3E had already been complete since 2026-07-30; see `docs/ROADMAP.md`). No further Mythos OS Runtime stage is currently authorised.
- **IDA-2 is IN PROGRESS** — Phase A (schema + plate validation, no live database) complete 2026-08-10; Phase B not started, requires separate authorization.
- **Only one major implementation stage at a time**, unless explicitly authorised otherwise (`docs/ROADMAP.md` "One-major-stage rule").

No stage in this document may be marked started by a later stage's documentation alone — each stage records its own start and completion in `docs/AI_HANDOVER.md` when it actually begins.

---

## 4. Status

INF-OVH-API-0 and INF-CF-AUTO-0 are both complete as mocked reference implementations (`projects/automation/reference/ovh-readonly-connector.js` + `tests/inf-ovh-api-0-connector-test.js`; `projects/automation/reference/cloudflare-readonly-connector.js` + `tests/inf-cf-auto-0-connector-test.js`) — both structurally read-only (a client exposing any mutation-shaped method is rejected before any collection runs), both refuse to run unless explicitly enabled, and both redact identifying PII before any snapshot record is produced. **INF-DNS-AUTO-1 is likewise complete as a reference implementation** (`projects/automation/reference/dns-comparison-engine.js` + `tests/inf-dns-auto-1-comparison-test.js`, 85 tests) — it consumes data it is given, holds any injected client to the same structural read-only rule, and `require`s nothing but the shared connector helper, so it has no filesystem, network, database or credential capability at all. **INF-DNS-AUTO-2 is implemented and fully tested** (`projects/automation/reference/dns-operations-executor.js` + `tests/inf-dns-auto-2-operations-test.js`, 97 tests, 25/25 mutation-tested guards) **and has performed no operation.** No live OVH or Cloudflare credential has been created, requested, or stored anywhere. No live network call has been made. **No DNS record, zone, or nameserver has been created, changed, or deleted.** No stage from INF-DEPLOY-AUTO-0 onward has been started, implemented, or deployed.
