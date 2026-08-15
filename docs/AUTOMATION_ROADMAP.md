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

Deployment pipeline foundation — subject to the approval-matrix constraints (production deployment requires a separately approved release policy, per `docs/AUTOMATION_APPROVAL_MATRIX.md` §3).

*(History: this section previously deferred its own scope, and a 2026-08-15 contract-recovery attempt correctly stopped before implementation rather than inventing it. The three owner decisions below close that gap. The prior "NOT EXECUTABLE" note is superseded by §"Owner decisions" — the deferral text is retained above only as the stage's original framing.)*

#### Owner decisions (ratified 2026-08-15)

**O-DEPLOY-1 — SCOPE.** INF-DEPLOY-AUTO-0 is the deployment-pipeline foundation for **STAGING ONLY**.

- GitHub repository: **the existing Mythos repository only**. *(Superseded on this point by the O-DEPLOY-1 amendment below — the repository line was too narrow; every other element of this decision stands.)*
- Deployment target: **the Mythos staging environment only**.
- Deployment platform: **the existing Coolify staging deployment only**.
- Purpose: a controlled, auditable, repeatable GitHub → Coolify **staging** pipeline.
- No production deployment · no production DNS · no production infrastructure mutation · no automatic production promotion · no production credentials · no production secrets · no deployment to unrelated repositories or applications.

**O-DEPLOY-1 — AMENDMENT (ratified 2026-08-15): DAR HIJAMA IS THE DEPLOYMENT TARGET.** The original scope line "GitHub repository: the existing Mythos repository only" was incorrect/too narrow: it conflicted with the actual Dar Hijama deployment already running in Coolify (project `darhijama`, environment `production`, application `dar-hijama`, repository `othoth77/notre-jour`, branch `release/darhijama-1.0.3`, build pack dockercompose). The owner ratifies:

1. **O-DEPLOY-1 is specifically the deployment foundation for the DAR HIJAMA application.**
2. Authorised repository for this deployment track: **`othoth77/notre-jour`**. The Mythos OS repository remains `othoth77/mythos-prod`; its identity is unchanged and it is **not** the deployment source for Dar Hijama. This amendment is not permission to deploy Mythos OS itself.
3. Production source: branch **`release/darhijama-1.0.3`** on `othoth77/notre-jour` (the existing production application `dar-hijama`).
4. Staging source: the **same repository** `othoth77/notre-jour`, using the source reference already defined by the repository's committed deployment contract — `ops/staging/coolify-provision.sh` (committed on the deployed release line) defines the staging application as `mythos-dar-hijama-staging`, compose file `/docker-compose.staging.yml`, environment `staging`, branch default **`main`** (`STAGING_GIT_BRANCH:-main`), auto-deploy disabled, `instant_deploy: false`. No branch name was invented; deployments themselves pin immutable commit SHAs via the repository's `Staging deployment` workflow.
5. Staging is a **separate Coolify Environment** (`darhijama/staging`, uuid `nuzp80tn6vtmymwnm2tc4d6i`) and a **separate Coolify Application/Resource** with a staging-specific identity — never a rename or reuse of production.
6. The production resource `dar-hijama` is **immutable from this stage**.
7. The staging database must be **separate**: the repository's `docker-compose.staging.yml` provisions its own project-scoped `mysql:8.4` service (database `mythos_staging`, no published port, named volume). Staging **must not** use `dar-hijama-production-mysql-1`.
8. **Production database credentials are forbidden in staging.** No production-to-staging secret clone; every staging secret is generated independently (`.env.staging.example` is the non-secret reference); required secrets are declared `${VAR:?}` so the stack fails closed while any is unset.
9. Production deployment remains forbidden (O-DEPLOY-2 unchanged).
10. DNS changes remain forbidden.
11. Production promotion remains forbidden.
12. Staging deployment remains behind the existing deployment approval/security gates (LEVEL_3, connector enablement, credential-by-reference — O-DEPLOY-3 unchanged).
13. No credential values are stored in Git.
14. Credentials are referenced only through the approved mechanism (`secret_reference_id`; values never handled by this repository).

The stage must provide: deployment plan · preflight validation · approval boundary · deployment execution against staging only · deployment verification · rollback mechanism · audit record · fail-closed behaviour.

**O-DEPLOY-2 — RELEASE POLICY.** The staging-only interpretation is ratified. **No production release policy is authorised by this decision.** Therefore: the stage must not deploy production; no production promotion mechanism may be created; no production approval workflow may be implied; the production release policy remains **OPEN** for a future owner decision; and any attempt to target production must **refuse before mutation**. This is a foundation/staging stage, not a production release stage.

**O-DEPLOY-3 — CONNECTOR SPLIT.**

| Connector | Ratified scope |
|---|---|
| `github_repository` | source-control read / commit / branch / remote operations only · existing authorised GitHub identity · **no new SSH keys · no force push · no history rewrite** |
| `coolify_deployer` | **staging deployment operations only** · existing Coolify installation · staging target only · explicit application/environment scope · **no production deployment capability in this stage** · no credential creation · credentials **by reference only** · **fail closed if the target cannot be proven to be staging** |

No production deployment capability is enabled. No generic "deploy anywhere" connector is created. No connector permission is broadened.

#### Formal contract

| Element | Definition |
|---|---|
| **Automation level** | `LEVEL_3_APPROVAL_REQUIRED` for the deployment operation itself; plan/preflight/dry-run are `LEVEL_2_RECOMMEND`. Never `LEVEL_4` — no approved release policy exists (O-DEPLOY-2). |
| **Inputs** | a deployment request (repository, git ref, target application id, environment id) · a declared `aut_environments` record · the platform-reported environment for that application · connector catalogue + feature flags · an approval record and its policy · a rollback reference (the currently-deployed revision) |
| **Outputs** | a deterministic deployment plan · a preflight result · a secret-free operation envelope · a verification result · a rollback record when verification fails · append-only audit events |
| **Entry criteria** | a declared staging environment record (`environment_key='staging'`, `is_production=false`, `enabled=true`) **whose environment is corroborated by the platform's own metadata** · `coolify_deployer` enabled with a staging-scoped capability and a credential reference · the LEVEL_3 feature flags on · a valid non-self approval · a rollback target captured |
| **Staging target proof** | **Two independent sources must agree**: the declared environment record AND the platform-reported environment name. Disagreement is a refusal, never a resolution. **An image tag, container name, or any other string is explicitly NOT evidence of environment** — this rule exists because the running Coolify application whose images are tagged `mythos-staging-*` is labelled `environmentName=production` by Coolify itself. |
| **Approval rules** | one approval per deployment run, `APPROVE` only, never self-approved, requester ≠ approver, not expired, bound to its own run, policy enabled and covering `LEVEL_3_APPROVAL_REQUIRED` |
| **Rollback** | redeploy the captured previous revision through the same connector; a rollback that cannot name the revision it restores to is refused at plan time; rollback is a separate audited execution; a failed rollback raises a `CRITICAL` incident |
| **Verification** | mandatory and immediate after apply; failure triggers the defined rollback automatically |
| **Audit** | append-only `aut_audit_events` records, opaque actor references, no PII, no secret values |
| **Prohibited operations** | any production target · any environment other than the declared staging one · any repository other than the authorised Dar Hijama repository `othoth77/notre-jour` (per the O-DEPLOY-1 amendment; previously "the Mythos repository") · any use of `dar-hijama-production-mysql-1` or production database credentials in staging · force push · history rewrite · credential creation · arbitrary command execution · path traversal in refs or paths · environment-variable smuggling · enabling a connector · promoting staging to production |
| **Completion criteria** | executor implemented and fail-closed · every boundary proven by test including mutation checks on the staging/production guard · targeted suites green · full regression once · **a staging deployment executed only if every entry criterion is provably satisfied**; if it is not, the stage completes as implementation + tests with the exact blocker recorded |

#### Implementation status (2026-08-15)

Implemented as `projects/automation/reference/staging-deployment-executor.js` + `tests/inf-deploy-auto-0-staging-test.js`. **No deployment has been executed.**

*Initial state (2026-08-15):* the staging target could not be proven — no Coolify resource declared `environmentName=staging`, and the application running `mythos-staging-*:local` images was labelled `production`. Under this contract that contradiction is a refusal, not a judgement call.

*Updated state (2026-08-15, operator checkpoint):* the operator created a **real, independent** Coolify Environment `darhijama/staging` (uuid `nuzp80tn6vtmymwnm2tc4d6i`) rather than relabelling the production one — verified read-only from Coolify's own control plane. Its identity is now declared in the non-secret registry `projects/infrastructure/coolify/environments.json`, which mirrors the `aut_environments` column shape (that schema being an undeployed draft) and follows the `domain-inventory.json` precedent; `environmentFromRegistry()` resolves it through the unchanged staging gate.

**Deployment remains blocked on four operator actions:** (1) `darhijama/staging` contains **0 applications**, so no deployment target exists and creating a Coolify resource is outside this stage's scope; (2) `coolify_deployer` is `enabled:false` and the catalogue grants only the environment-agnostic `deployment.trigger`, not the required `deployment.trigger.staging`; (3) `connector_coolify_deployer_live` and `level_3_approval_required_runs` are both false — the latter is a global gate that also governs INF-DNS-AUTO-2; (4) no Coolify credential exists in an approved secret store, and none was fabricated. See `docs/AI_HANDOVER.md` for the full record.

*Updated state (2026-08-15, O-DEPLOY-1 amendment executed):* the deployment track is now formally the **Dar Hijama application** (`othoth77/notre-jour`; production branch `release/darhijama-1.0.3`; the Mythos repository's identity is unchanged and it is refused as a source for this track). The staging application **`mythos-dar-hijama-staging`** (uuid `dmgranxzp3ftkfumwqe4mihy`) was created via the authenticated Coolify UI inside `darhijama/staging` — a separate resource from production, branch `release/darhijama-1.0.3` (the only committed ref carrying `/docker-compose.staging.yml`; the committed provisioning default `main` was refused fail-closed by Coolify: compose file not found), build pack dockercompose, auto-deploy **manual-only**, **never deployed**. Blocker (1) above is resolved; the registry binds the application (`bound_application_id`). Database isolation is enforced in code: the executor's new `assertStagingDatabase` gate refuses `dar-hijama-production-mysql-1`, refuses production credential inheritance, and refuses deployment while no independent staging database credential exists — the compose-defined stack database (`mythos_staging` on the project-scoped `mysql` service) currently has **no provisioned secrets** (`${VAR:?}` unset, fails closed), which joins blockers (2)–(4) as the remaining operator actions. Suite 124/124 with 9/9 boundary mutations caught. **No deployment executed; production untouched; no credential created or read.**

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
