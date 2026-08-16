# Mythos Automotive — Unified Roadmap

**Last updated:** 2026-08-08 UTC (ATN-0 — Atelier Network Foundation added; MAE-0 complete; INF-CF-0 — Cloudflare Foundation added; INF-CF-1 — domain inventory complete; INF-CF-2-PREP — authoritative export intake and owner approval gate complete; AUT-0 — Automation-First Master Foundation added; MPI-0 — Personal Intelligence Foundation, plus MPI-0-FINALIZATION — Skills Evolution, Project Intelligence, Portfolio Registry, merged to `main` via PR #4, merge commit `8632a99dfb94ff101811a8d0aa47ea5418c3cb19`; RES-0 — Research Intelligence free-first foundation added, merged to `main` via PR #5; DEVX-0 — Development Acceleration MVP added, merged to `main` via PR #6; INF-OVH-API-0 — OVH Read-Only Connector (reference implementation) added, merged to `main` via PR #7; RES-0 finalised and merged via PR #5; INF-CF-AUTO-0 — Cloudflare Read-Only Connector (reference implementation) added, merged to `main` via PR #8, merge commit `82fd2f97165495fb112bbdff828a1ce4a6884334`; AUT-CONNECTOR-SHARED-HELPERS-0 — Shared Read-Only Connector Foundation Cleanup added)

---

## Mythos Automotive Ecosystem Overview

Mythos Automotive is the umbrella portfolio brand — "La chaîne automobile numérique". It groups four core pillars: ID Auto (FOUNDATION), Atelier Network (FOUNDATION — first pilot: Fixpert), Parts Network, and AutoValeur (FOUNDATION). Mythos OS Core is the platform beneath. Future products include AutoMarket Verified, Fleet Pro, and Fixpert Assistance.

See `docs/AUTOMOTIVE_VISION.md` for the full product vision and `docs/AUTOMOTIVE_ROADMAP.md` for the complete dependency map and stage table.

### Operating rule: One Major Implementation Stage at a Time

Only one major implementation stage may be active at a time unless explicitly authorised. A major implementation stage means: building new runtime code, deploying new services, executing database migrations, or connecting live data sources.

Documentation stages may run in parallel across product tracks. **IDA-2 is IN PROGRESS** (Phase A — schema + plate validation, no live database — complete 2026-08-10; Phase B — PostgreSQL deployment + API — not started, requires separate authorization; see `docs/IDAUTO_ROADMAP.md`).

### Ecosystem Stage Plan (MAE-*)

| Stage | Description | Status |
|-------|-------------|--------|
| MAE-0 | Ecosystem Master Foundation — vision, architecture, governance, roadmap, control-plane schema | ✓ Done (2026-08-05) |
| ATN-0 | Atelier Network Foundation — multi-workshop platform spec, AutoCheck Standard, ecosystem consistency amendment | ✓ Done (2026-08-05) |
| MAE-1 | Shared Platform Spec — unified rate limiting, audit envelope, vehicle taxonomy API, canonical ID protocol | Not started (blocked on IDA-2) |
| MAE-2 | Control Plane Alpha — product health dashboard, legal requirements tracker, KPI registry | Not started (blocked on MAE-1, IDA-3) |
| MAE-3 | Ecosystem Audit Stream — cross-product event pipeline, dead-letter, anomaly detection | Not started (blocked on MAE-2) |
| MAE-4 | Legal Requirements Resolution — ongoing parallel workstream (requires legal counsel) | Ongoing |

### Dependency Map

```
Mythos OS (3D-3G)
    └── [AUTH, BILLING, ROLES] ──► IDA-2 ──► IDA-3 ──► IDA-4 (requires ATN-1)
                                       │
                                       └──► AVA-1 ──► ATN-1 ──► AVA-2 ──► AVA-3 ──► AVA-4
                                       │
                                       └──► MAE-1 ──► MAE-2 ──► MAE-3

AutoMarket: requires IDA-3 + AVA-1 + ATN-1 + Legal clearance
Fleet Pro:  requires IDA-2 + ATN-1 + Legal clearance
```

---

## Mythos OS — Core Platform Stages

---

### Completed Stages

| Stage | Description | Status |
|-------|-------------|--------|
| 0 | Architecture documentation | ✓ Done |
| 1A | Core: storage.js + api.js | ✓ Done |
| 1B | Core: events.js + platform.js | ✓ Done |
| 1C-P1 | API layer: fetch() audit | ✓ Done |
| 2A | Plugin: production plugin | ✓ Done |
| 2B | Plugin: 6 shared plugins | ✓ Done |
| 2C | Shell: sidebar/workspace/nav | ✓ Done |
| 2D | Plugin SDK: fluent builder | ✓ Done |
| 3A | Tasks Runtime | ✓ Done |
| 3A.5 | Runtime Services | ✓ Done |
| 3B | Contacts Runtime | ✓ Done |
| 3C | Notes Runtime | ✓ Done |
| 3D | Planning Runtime — onBoot validation, MythosSearch + MythosCalendar providers | ✓ Done (2026-07-30) |
| 3E | Calendar Runtime — `js/plugins/calendar.runtime.js` | ✓ Done (2026-07-30, commit `0194937`) |
| 3F | Dashboard Runtime — `js/plugins/dashboard.runtime.js` | ✓ Done (2026-07-30, commit `d10081e`) |
| 3G | Production Runtime — `js/plugins/production.runtime.js` (30 routes, 19 storage keys) | ✓ Done (2026-07-30, commit `e2f1953`, 125/125 tests per commit message) |
| 3H | Runtime architecture consolidation | ✓ Done (2026-07-30, commit `511805a`) |
| 4A–4AG | Shared Module Extraction — 33 sub-stages moving domains out of `js/app.js` into `js/shared/`/`js/core/` (storage, sync, router, calendar/dashboard rendering, tasks/notes/contacts/clients/collaborateurs/fournisseurs/representations/contracts/mission-orders/invoices/RDVs/devis/bank+cash entries/purchases/expenses/financial reports/accounting/modal helpers/statistics/camera/documentation/backup-export-restore/spectacle calculator/inscriptions-appels/invoice+OM duplicate cleanup) | ✓ Done (2026-08-01 to 2026-08-05, commits `09b808e`..`ebe42f9`; full per-stage detail in `docs/AI_HANDOVER.md`) |
| RUNTIME-DUPLICATE-CLEANUP-0 | Canonical Runtime Function Ownership + Stage 4Z repair — resolved the `stableLineCount` collision, removed `editInvoice`/`deleteInvoice` duplicates from `app.js` | ✓ Done (2026-08-08, merged PR #9, commit `9f5813d5`) |

> **Correction (MYTHOS-STAGE-RECONCILIATION-0, 2026-08-10):** this table, the "In Progress"/"Upcoming Stages" sections below, and the "Current Priority" section had stated "Stage 3E is next" since this document's creation. That was stale from the start — Stages 3E through 4AG plus RUNTIME-DUPLICATE-CLEANUP-0 were already committed to `main` (2026-07-30 through 2026-08-08) without this document ever being updated to reflect it, even though `docs/AI_HANDOVER.md` independently and correctly recorded each of these stages in full at the time. See the CHECKPOINT-RECOVERY-0 and MYTHOS-STAGE-RECONCILIATION-0 entries in `docs/AI_HANDOVER.md` for the full evidence trail (git commit ancestry, file-tree verification). This correction updates only the stage-position claim; it does not re-litigate or re-verify the underlying implementation work itself.

---

### In Progress

*None. Mythos OS Runtime is complete through Stage 4AG + RUNTIME-DUPLICATE-CLEANUP-0 (see table above). No further Mythos OS Runtime stage is currently authorized or in progress.*

---

### Remaining Known Open Items (Mythos OS Runtime, not currently scheduled)

Per `docs/AI_HANDOVER.md`'s Stage 4AG entry, these were explicitly deferred rather than resolved — none are authorized as a "next stage":
- `js/app-fresh.js` — unreferenced dead file (confirmed still present), candidate for a separate deletion stage.
- `removePersonRow` in `app.js` — orphaned (its callers were deleted in Stage 4AG); needs a caller audit before removal.
- Invoice `addLine()` UI stub bug (alerts "Fonctionnalité en développement") — pre-existing, not yet fixed.
- "Logs + Sidebar + Sync" (~210 lines of `app.js`) — lower-risk, unextracted.
- `STORE` + utilities, app initialization, demo data initialization — explicitly marked high-risk, deliberately not attempted.

---

### Future Stages (originally planned post-3G, largely superseded by the actual 4A–4AG execution above)

### Stage 5 — Production Module Extraction
Move production-specific domains out of app.js into `js/prod/`:
1. `prod/clients.js`, `prod/collaborators.js` (simple CRUD)
2. `prod/equipment.js` (vehicles)
3. `prod/mission-orders.js`
4. `prod/invoices.js`
5. `prod/accounting.js` (largest, extract last)

**Note:** most of these domains were, in practice, already extracted as part of the actual 4A–4AG sequence above (e.g. `js/shared/clients.js`, `js/shared/collaborateurs.js`, `js/shared/mission-orders.js`, `js/shared/invoices.js`, `js/shared/contracts.js` all exist). Whether a distinct "Stage 5" is still meaningful, or whether the remaining open items above are better scoped as their own small stages, has not been decided — not evaluated as part of this reconciliation (would require re-deriving actual `js/app.js` remaining line count/content, out of scope here).

### Stage 6 — Directory Reorganisation
Rename files to match target hierarchy. Update all `<script src>` tags.

---

### Stage 5 — Production Module Extraction
Move production-specific domains out of app.js into `js/prod/`:
1. `prod/clients.js`, `prod/collaborators.js` (simple CRUD)
2. `prod/equipment.js` (vehicles)
3. `prod/mission-orders.js`
4. `prod/invoices.js`
5. `prod/accounting.js` (largest, extract last)

### Stage 6 — Directory Reorganisation
Rename files to match target hierarchy. Update all `<script src>` tags.

---

## Current Priority

1. **Mythos OS:** Complete through Stage 4AG + RUNTIME-DUPLICATE-CLEANUP-0 (corrected 2026-08-10, see note above) — no further Mythos OS Runtime stage is currently authorized; remaining known open items are listed above and are not scheduled.
2. **ID Auto:** IDA-2 complete except IDA-2E (real auth, BLOCKED — no Mythos identity service exists to integrate with). IDA-3 design gate and IDA-3A–IDA-3E are complete: ingestion schema, pure ingestion service, PostgreSQL rate limiting, private admin-only ingest route, and admin review with the community-fact visibility gate. **IDA-3F (off-host backup) is BLOCKED / DEFERRED by owner decision** pending Cloudflare R2 billing, and IDA-3G/3H/3I are gated behind it. `PUBLIC_ENDPOINT_READY_TO_IMPLEMENT` = NO
3. **Atelier Network:** ATN-1 — Workshop Registry + First Integration (after IDA-2)
4. **AutoValeur:** AVA-1 — Public Calculator MVP (after IDA-2 provides PostgreSQL cluster)
5. **Ecosystem (parallel — docs only):** MAE-0 + ATN-0 complete; MAE-1 not started (blocked on IDA-2)
6. **Automation:** AUT-0 complete; INF-OVH-API-0, INF-CF-AUTO-0 and **INF-DNS-AUTO-1 (complete 2026-08-15)** are all mocked reference implementations (no live credential, not deployed, not connected to a live provider, no DNS record/zone/nameserver touched); AUT-CONNECTOR-SHARED-HELPERS-0 (code-quality cleanup, no behaviour change) complete; **INF-DNS-AUTO-2 (2026-08-15) is implemented and tested but operationally gated shut — no DNS operation has been performed**, blocked by five independent conditions (0/40 owner approvals, both DNS write connectors disabled, all LEVEL_3 feature flags false, no provider credential, no populated secret store); unblocking it is an owner action. **INF-DEPLOY-AUTO-0 (2026-08-15): contract ratified by owner decisions O-DEPLOY-1/2/3 (staging only), implemented and tested, but no deployment executed** — six independent blockers, chief among them that no Coolify resource on the host declared `environmentName=staging` at the time (the `mythos-staging-*` images ran on an application Coolify labels `production`); production is structurally unreachable from the executor and no production release policy is authorised. *Updated same day:* the operator created a real `darhijama/staging` environment, and the **O-DEPLOY-1 amendment** ratified the Dar Hijama application as the track's target (`othoth77/notre-jour`, prod branch `release/darhijama-1.0.3`); the staging application `mythos-dar-hijama-staging` now exists there (never deployed, fails closed without independent staging secrets — production DB and credentials refused by code gate). **INF-BACKUP-AUTO-0 (2026-08-16): contract ratified by owner decisions O-BACKUP-1..4 and completed by O-BACKUP-5 (level designation), implemented and tested, but no backup created and no restore performed.** The orchestrator wraps the pre-existing off-host backup tooling rather than rebuilding it (the runbook forbids a parallel mechanism, and the reuse contract is enforced in code), adds a three-layer operation allowlist, a two-source isolation proof for restore targets, an exact-set connector check that cannot be broadened, and documentation-only evidence recording. **O-BACKUP-5 resolved the LEVEL_2 external-mutation contradiction**: `backup_create` and `restore_test` are LEVEL_4_FULL_AUTOMATIC under the committed approved policy (`projects/automation/config/inf-backup-auto-0-approval-policy.json`), no LEVEL_2 operation may ever mutate, and the `backup_create` APPLY path is wired as pure delegation to the off-host tooling. 243 tests, 34/34 + 8/8 mutations caught. Three owner/operator blockers remain: connector disabled without a `secret_reference_id`, both level feature flags false, and no designated credential reference. **INF-MONITOR-AUTO-0 is next in sequence and will need its own owner decisions, its scope being one deferred line.** Does not change items 1–4 above. **Neither INF-DNS-AUTO-1 nor INF-DNS-AUTO-2 unblocks INF-CF-2** — per-domain entry criteria and owner approval remain the owner's.
7. **Personal Intelligence:** MPI-0 through MPI-4 complete (MPI-2/3/4 completed 2026-08-14/15 — see the MPI stage table below and `docs/AI_HANDOVER.md` for the full per-record evidence; O-4-4 closed the MPI-4 track). The runtime is operator-run and on-demand only; `MPI_PERSISTENCE_ENABLED` is set nowhere in production. Every remaining Personal Intelligence item is an owner decision, not a ratified stage: corpus routing verification, the multi-user bridge, D4, and a `SkillPlan` composer. Does not change items 1–4 above. *(This item previously read "MPI-2 … is the next Personal Intelligence stage — NOT STARTED" — stale from 2026-08-14; corrected 2026-08-16 by MPI-DOC-SYNC-0.)*
8. **Research Intelligence (docs only, merged to `main` via PR #5):** RES-0 complete; RES-1 is the next Research Intelligence implementation stage — NOT STARTED, NOT AUTHORISED, does not change items 1–4 above
9. **Development Acceleration (developer tooling only):** DEVX-0 and DEVX-1 complete; DEVX-2 (Verified Development Research Cache) is the next Development Acceleration stage — NOT STARTED and not yet specified beyond a title, does not change items 1–4 above

**One-major-stage rule in force:** Only one major implementation stage may be active at a time unless the user gives explicit parallel authorisation. IDA-2 must not begin while Stage 3G is active. ATN-1 and AVA-1 cannot run in parallel without explicit user authorisation — they are sequential after IDA-2. The Automation track (INF-OVH-API-0 onward), the Personal Intelligence track (MPI-1 onward), the Research Intelligence track (RES-1 onward), and the Development Acceleration track (DEVX-1 onward) are likewise sequential and do not run in parallel with any of the above, or with each other, without explicit user authorisation.

---

## Infrastructure and Cloudflare — Separate Track

This track defines the Cloudflare edge security foundation for all Mythos-hosted services. All INF-CF stages are sequential; each must be validated, committed, and pushed before the next begins.

**INF-CF stages do not change the currently authorised implementation-stage priority.** The next authorised implementation stage remains IDA-2. INF-CF-0 is documentation only.

| Stage | Description | Status |
|---|---|---|
| INF-CF-0 | Cloudflare Foundation — architecture, deployment checklist, env template, deploy docs | ✓ Done (2026-08-05) |
| INF-CF-1 | Cloudflare account and domain inventory — public read-only inventory of the 8 authorised domains | ✓ Done (2026-08-06) |
| INF-CF-2 | DNS migration and verification | Planned — not started. Entry gate (per domain): authoritative registrar/DNS-provider control-panel exports, owner review of the INF-CF-1 risk findings, domain-specific owner approval recorded in `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`, full record-by-record comparison against the INF-CF-1 inventory, and DNSSEC/email verification. See `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` for the complete criteria. An INF-CF-2-PREP readiness package (authoritative export intake process, owner approval gate, entry criteria) has been prepared — this is preparation only, not a numbered infrastructure stage in its own right, and does not itself unblock INF-CF-2. |
| INF-CF-3 | Remotely managed Tunnel in Coolify | Planned |
| INF-CF-4 | Cloudflare Access for private hostnames | Planned |
| INF-CF-5 | TLS, WAF, rate limiting and DNSSEC hardening | Planned |
| INF-CF-6 | R2 and external backup integration | Planned |
| INF-CF-7 | Monitoring, rollback test, restore test and operational handover | Planned |

See `docs/CLOUDFLARE_ARCHITECTURE.md` for the approved architecture and `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` for per-stage prerequisites, actions, validation, rollback, secrets handling, and completion criteria. See `docs/CLOUDFLARE_DOMAIN_INVENTORY.md` and `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md` for the INF-CF-1 public domain inventory of the 8 authorised Mythos-portfolio domains (`agribee.tn`, `darhijama.tn`, `fixpert.tn`, `idauto.tn`, `mythosprod.xyz`, `notrejour.tn`, `ssangyong.autos`, `uthinachess.tn`). See `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`, `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`, and `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md` for the INF-CF-2-PREP readiness package that must be satisfied, per domain, before INF-CF-2 may begin.

---

## Automation — Separate Product Track

Mythos Automation & Operations (`mythos_automation`) is the shared platform capability behind **Mythos Control Center**, the operator-facing console for Mythos products, infrastructure, connectors, automation runs, approvals, incidents, backups, deployments, and service health. Governing principle: **Automation First** — every safe, repeatable and measurable operation should eventually be automated, automation must not remove governance, and high-risk actions remain automated in preparation and validation but require explicit human approval before execution.

**The Automation track does not change the currently authorised implementation-stage priority.** *(Historical note, as originally written: this line said "Stage 3E remains the next Mythos OS runtime stage" — corrected 2026-08-10 by MYTHOS-STAGE-RECONCILIATION-0; Mythos OS Runtime was in fact already complete through Stage 4AG by the time this Automation-track entry was written. See the correction note under "Mythos OS — Core Platform Stages" above.)* IDA-2 remains the next authorised Automotive implementation stage; INF-CF-2 remains blocked and not started. AUT-0 is documentation only.

| Stage | Description | Status |
|---|---|---|
| AUT-0 | Automation-First Master Foundation — principles, Mythos Control Center spec, architecture, governance, approval matrix, security/secrets policy, operations runbook, draft control-plane schema | ✓ Done (2026-08-06) |
| INF-OVH-API-0 | OVH Read-Only Connector — list authorised domains, registrar metadata, DNS records, DNSSEC state, redacted snapshots; no writes | ✓ Done (reference implementation only — no live credential, not deployed) |
| INF-CF-AUTO-0 | Cloudflare Read-Only Connector — account/zone/settings inventory; no writes | ✓ Done (reference implementation only — no live credential, not deployed) |
| INF-DNS-AUTO-1 | DNS Snapshot, Comparison and Drift Detection — OVH vs public DNS vs Cloudflare, email/DNSSEC safety, migration/rollback plans | ✓ Done (2026-08-15) — reference implementation + 85 tests; comparison and analysis only, no live credential, no network call, no DNS change |
| INF-DNS-AUTO-2 | Approved DNS Operations — LEVEL_3 only, one domain at a time, explicit owner approval, automatic verify/rollback | ◐ Implemented + tested (2026-08-15), 97 tests — **no DNS operation performed; gated shut pending owner approval** |
| INF-DEPLOY-AUTO-0 | GitHub to Coolify Delivery Foundation | ◐ Contract ratified (O-DEPLOY-1/2/3) and **amended 2026-08-15: the track is the DAR HIJAMA application** (`othoth77/notre-jour`; prod branch `release/darhijama-1.0.3`). Staging application `mythos-dar-hijama-staging` created in `darhijama/staging` (never deployed, auto-deploy manual-only); database isolation gated in code (production DB + credential inheritance refused; missing staging DB fails closed). 124 tests, 9/9 boundary mutations caught — **no deployment executed.** Remaining blockers are operator actions (independent staging secrets incl. database, connector + LEVEL_3 flags, Coolify credential by reference). |
| INF-BACKUP-AUTO-0 | Automated Backup and Restore Verification | ◐ Contract ratified 2026-08-16 by owner decisions **O-BACKUP-1..4 + O-BACKUP-5** (levels: `backup_create`/`restore_test` LEVEL_4 under the committed policy; no LEVEL_2 mutation, permanently); implemented and tested (`backup-operations-orchestrator.js` + 243 tests, 34/34 + 8/8 mutations caught), `backup_create` wired as pure delegation — **no backup created, no restore performed.** Wraps the existing `projects/idauto/ops/offhost-backup.js`; a parallel mechanism is refused in code. Gated shut by three remaining owner/operator conditions: connector `enabled:false` without a `secret_reference_id`, `level_2_recommend_runs`/`level_4_full_automatic_runs` both false, no designated credential reference. |
| INF-MONITOR-AUTO-0 | Infrastructure, DNS, SSL and Service Monitoring | Planned |
| OPS-AUTO-0 | Business Workflow Automation | Planned |
| OPS-AUTO-1 | Notifications, Relances and Scheduled Reports | Planned |

See `docs/AUTOMATION_FIRST_PRINCIPLES.md`, `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`, `docs/AUTOMATION_ARCHITECTURE.md`, `docs/AUTOMATION_GOVERNANCE.md`, `docs/AUTOMATION_APPROVAL_MATRIX.md`, `docs/AUTOMATION_SECURITY_AND_SECRETS.md`, `docs/AUTOMATION_OPERATIONS_RUNBOOK.md`, and `docs/AUTOMATION_ROADMAP.md` for the full AUT-0 foundation and the complete future stage sequence.

---

## Research Intelligence — Platform Capability Track

Mythos Research Intelligence is the free-first, provider-independent external research capability for the Mythos platform. It enables AI agents and users to retrieve fresh, citable external information safely — without coupling the platform to any single search provider.

**Research Intelligence implementation has NOT started.** No RES stage beyond RES-0 is authorised. Two RES-1 entry-gate conditions are now satisfied (see table below); the remaining conditions must still be verified fresh at RES-1 start time, not assumed from this record.

See `docs/MYTHOS_RESEARCH_INTELLIGENCE_VISION.md` for the full vision and `docs/RESEARCH_ROADMAP.md` for the complete stage plan and entry gates.

| Stage | Description | Status |
|-------|-------------|--------|
| RES-0 | Free-First Research Intelligence Foundation — vision, architecture, provider strategy, security, trust model, roadmap, config templates | ✓ Done and merged (2026-08-08, PR #5) |
| RES-1 | Research Gateway Core + Official Source Fetcher | Planned — NOT AUTHORISED |
| RES-2 | Private SearXNG Deployment + Adapter | Planned — NOT AUTHORISED |
| RES-3 | Source Trust + Citation + Research Cache | Planned — NOT AUTHORISED |
| RES-4 | Optional Free-Quota Provider Adapters (Brave, Tavily) | Planned — NOT AUTHORISED |
| RES-5 | Deep Research Orchestration + Optional Premium Provider | Planned — NOT AUTHORISED |
| RES-6 | Research Monitoring, Analytics and Optimisation | Planned — NOT AUTHORISED |

### RES-1 Entry Gate

Research Intelligence runtime implementation (RES-1) is activated only when ALL gates are satisfied:

| Gate | Description | Status |
|------|-------------|--------|
| MPI-0 merged | Personal Intelligence PR #4 merged to `main` | ✓ SATISFIED — merged 2026-08-07, merge commit `8632a99dfb94ff101811a8d0aa47ea5418c3cb19` |
| Platform clean | Current `main` has no conflicting unmerged work | OK |
| INF-OVH-API-0 | OVH Read-Only Connector complete OR owner re-prioritises | ✓ SATISFIED — complete as reference implementation, merged 2026-08-08, merge commit `79fdb122edd2dc3246fc7781247265e3fab93adf` |
| No active stage | No other major implementation stage in progress | Must verify at RES-1 time |
| Owner authorisation | Explicit owner approval for RES-1 | PENDING |
| VPS capacity | Resource check completed | Must verify at RES-1 time |
| Security review | Security model reviewed | Must verify at RES-1 time |
| Provider re-verify | Official provider docs re-verified (pricing, APIs, terms) | Must verify at RES-1 time |

### Dependency Position

Research Intelligence is a platform capability. It does NOT:
- Block any current Mythos OS stage (3E, 3F, 3G)
- Block any Mythos Automotive stage (IDA-2, ATN-1, AVA-1)
- Depend on Mythos OS production code
- Require any provider account or API key

### Architecture

Free-first provider order: cache → internal authoritative data → official sources → self-hosted SearXNG → free-quota APIs (Brave, Tavily) → optional premium (Perplexity). Research provider ≠ Reasoning model. `research.web` is the capability; providers are implementation details behind the Research Gateway.

---

## Personal Intelligence — Separate Product Track

Mythos Personal Intelligence & Skills Platform (`mythos_intelligence`) is the shared, per-user, per-organisation, per-profession AI personalisation architecture behind every Mythos chatbot instance. Strategic principle: **"Shared capabilities, isolated intelligence."** One shared platform — never a copied chatbot per customer — personalised through layered context (Global Intelligence → Domain → Organisation → User → Session), controlled memory/learning, and permission-gated skill execution.

**Developed on branch `feat/mythos-personal-intelligence`, merged to `main` via PR #4 (merge commit `8632a99dfb94ff101811a8d0aa47ea5418c3cb19`, 2026-08-07).** The Personal Intelligence track does not change the currently authorised implementation-stage priority. *(Historical note, as originally written: this line said "Stage 3E remains the next Mythos OS runtime stage" — corrected 2026-08-10 by MYTHOS-STAGE-RECONCILIATION-0; Mythos OS Runtime was in fact already complete through Stage 4AG by 2026-08-07. See the correction note under "Mythos OS — Core Platform Stages" above.)* IDA-2 remains the next authorised Automotive implementation stage; INF-CF-2 remains blocked; INF-OVH-API-0 and INF-CF-AUTO-0 are both complete as reference implementations (no live credential, not deployed) and INF-DNS-AUTO-1 is now the next Automation implementation stage, NOT STARTED. MPI-0 and MPI-0-FINALIZATION are documentation, contracts, an illustrative reference implementation, project-intelligence governance tooling, and tests only — no production runtime, no database deployed, no external provider access.

| Stage | Description | Status |
|---|---|---|
| MPI-0 | Personal Intelligence Foundation — architecture, contracts, scope/precedence model, memory policy, agent skills, draft schema, reference implementation, tests | ✓ Done and merged (2026-08-07, PR #4, merge commit `8632a99dfb94ff101811a8d0aa47ea5418c3cb19`) |
| MPI-0-FINALIZATION | Skills evolution audit, project history/statistics/portfolio-registry governance, deterministic offline tooling | ✓ Done and merged (2026-08-07, PR #4, merge commit `8632a99dfb94ff101811a8d0aa47ea5418c3cb19`) |
| MPI-1 | Context Assembler + Context Compiler (runtime) | ✓ Done (2026-08-12) |
| MPI-2 | Personal Learning & Memory Engine (runtime, persistent) | ✓ Done (2026-08-14/15) — `mythos_intelligence` schema production-applied to `idauto-postgres` under owner authorisation (MPI-2A APPLY); D3 content store; guarded MPI-2H ingestion with the real owner corpus ingested (batches 2h-001..2h-004, incl. record-anchored events); MPI-2G backup/restore gate PASS. D4 remains the sole open MPI-2 owner decision (non-blocking). *(This row previously read "Planned" — stale from 2026-08-14; corrected 2026-08-16 by MPI-DOC-SYNC-0.)* |
| MPI-3 | Runtime Skill Router + Superposer | ✓ Done (2026-08-15) — delivered as R1 (§10 retrieval adapter), R2 (read-only operator retrieval CLI; first real production retrieval verified, 36/36 deterministic with provenance) and R3 (context runtime over the real adapter); the memory→capability relevance router landed under O-4-4. The multi-capability `SkillPlan`/Superposer composer was deliberately NOT built and remains a future owner decision. *(Previously "Planned" — corrected 2026-08-16 by MPI-DOC-SYNC-0.)* |
| MPI-4 | Personal Chatbot Runtime | ✓ Done (2026-08-15) — M4-1 provider adapter contract + offline mock, M4-2 offline runtime composition, O-4-1 OpenRouter free provider (one real free request verified 2026-08-15), O-4-2 CLI hardening, O-4-3 identity bridge, O-4-4 real relevance router closing the track per `docs/MPI_4_RUNTIME_SPECIFICATION.md`. Routing against the real 36-memory corpus is recorded as not yet operator-verified; every remaining Personal Intelligence item is an owner decision, not a ratified stage. *(Previously "Planned" — corrected 2026-08-16 by MPI-DOC-SYNC-0.)* |
| MPI-5 | Education Domain Pilot | Planned |
| MPI-6 | Automotive Workshop Pilot | Planned |
| MPI-7 | Organisation AI Admin | Planned |
| MPI-8 | User AI Preferences & Memory Controls | Planned |
| MPI-9 | Multi-model Provider Routing | Planned |
| MPI-10 | Analytics, Feedback and Optimisation | Planned |

See `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md` for the strategic direction, `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md` for the full contract set, `docs/MYTHOS_USER_MEMORY_POLICY.md`, `docs/MYTHOS_CONTEXT_ARCHITECTURE.md`, `docs/MYTHOS_DOMAIN_PACKS.md`, `docs/MYTHOS_AI_MULTI_TENANCY.md`, `docs/MYTHOS_CHATBOT_ARCHITECTURE.md`, `docs/SKILLS_ARCHITECTURE.md`, `docs/SKILLS_SUPERPOSER.md`, `docs/SKILLS_SECURITY.md`, `docs/SKILLS_SOURCES.md`, `docs/SKILLS_ROADMAP.md`, and `docs/MODEL_ROUTING_ARCHITECTURE.md` for the full MPI-0 foundation.

---

## ID Auto — Separate Product Track

ID Auto (`idauto.tn`) is a vehicle plate lookup and vehicle intelligence platform for Tunisia. It is a product within the Mythos ecosystem, sharing this repository under `projects/idauto/` and `docs/IDAUTO_*.md`.

See `docs/IDAUTO_ROADMAP.md` for the full ID Auto stage plan.

| Stage | Description | Status |
|-------|-------------|--------|
| IDA-0 | Foundation — schema, config, architecture, privacy contract | ✓ Done (2026-08-05) |
| IDA-1 | Product vision, capture, access and data governance specification | ✓ Done (2026-08-05) |
| IDA-2 | PostgreSQL Core, API and Manual Capture MVP | IN PROGRESS — Phase A complete 2026-08-10 (schema + plate validation, no live database); Phase B not started |
| IDA-3 | Public Smart Scanner and Carte Grise Workflow | Planned |
| IDA-4 | Fixpert Smart Gate and Atelier Integration (requires ATN-1) | Planned |
| IDA-5 | Professional Partner Network | Planned |
| IDA-6 | National Enrichment and Public/Professional Launch | Future |

**Key decisions from IDA-1:**
- ID Auto is a Mythos ecosystem product (integrated, not isolated)
- PostgreSQL is the selected target DBMS (not yet installed)
- Observation-first data model
- Three access scopes: PUBLIC, PROFESSIONAL, MYTHOS_PRIVATE
- Smart Gate events are always MYTHOS_PRIVATE
- Plate format rules are unverified drafts pending official source confirmation
- Workshop operations (clients, invoices, payments) belong to each workshop organisation; Fixpert is the first pilot on the Atelier Network; ID Auto provides the vehicle identity layer

---

## Atelier Network — Separate Product Track

Atelier Network is the generic multi-workshop platform within the Mythos ecosystem. Fixpert is the first workshop pilot. See `docs/ATELIER_NETWORK_ROADMAP.md` for the full stage plan.

| Stage | Description | Status |
|-------|-------------|--------|
| ATN-0 | Atelier Network Foundation — multi-workshop platform spec, AutoCheck Standard, ecosystem consistency amendment | ✓ Done (2026-08-05) |
| ATN-1 | Workshop Registry + First Integration — workshop onboarding, Fixpert connector (EXTERNAL_CONNECTED) | Planned (after IDA-2) |
| ATN-2 | AutoCheck Standard MVP — accreditation, reports, ID Auto vehicle linkage | Planned (after ATN-1) |
| ATN-3 | Smart Gate Generalisation — multi-workshop Smart Gate registry (requires IDA-4) | Planned |
| ATN-4 | Multi-Workshop Network — fleet and assistance prerequisites | Future |
| ATN-5 | Network Maturity — analytics, API marketplace, partner tiers | Future |

---

## AutoValeur — Separate Product Track

AutoValeur is an independent vehicle valuation and Tunisian used-car market intelligence product inside the Mythos ecosystem. It is a product within the Mythos ecosystem, sharing this repository under `projects/autovaleur/` and `docs/AUTOVALEUR_*.md`.

See `docs/AUTOVALEUR_ROADMAP.md` for the full AutoValeur stage plan.

| Stage | Description | Status |
|-------|-------------|--------|
| AVA-0 | Foundation and Ecosystem Roadmap | ✓ Done (2026-08-05) |
| AVA-1 | Public Calculator MVP | Planned |
| AVA-2 | Professional Tier and Atelier Network Integration | Planned |
| AVA-3 | Market Data Foundation | Planned |
| AVA-4 | Deal Radar MVP | Planned |
| AVA-5 | Marketplace Integration and Completed Sales | Future |
| AVA-6 | Model Maturity and Ecosystem Expansion | Future |

**Key decisions from AVA-0:**
- AutoValeur is a distinct product domain (not part of Fixpert or ID Auto)
- Valuation results are always a range — never a single number
- Valuation records are immutable snapshots (never overwritten)
- Model version is mandatory on every result record
- Asking price and completed sale price are always stored in separate fields
- Deal Radar and acquisition pipeline are always MYTHOS_PRIVATE
- No real market data ingested until AVA-3 (legal review required)
- PostgreSQL target DBMS: 18-table `autovaleur` schema drafted (not deployed)
- All feature flags: false in AVA-0

---

## Development Acceleration — Separate Product Track

Mythos Development Acceleration (`projects/devx/`, `scripts/mythos-stage.js`) is developer tooling and repository orchestration only — it lets a future stage begin from a short owner instruction ("Start `<STAGE>` according to Mythos workflow") instead of a long prompt, by deriving execution context from GitHub/Git evidence. It implements no product runtime, touches no database, and performs no deployment.

**Developed on branch `feat/devx-0-development-acceleration`.**

| Stage | Description | Status |
|---|---|---|
| DEVX-0 | Development Acceleration MVP — current-context snapshot, known-baseline registry, test-impact map, development lanes, stage templates, Stage Runner CLI, short-command workflow contract | ✓ Done |
| DEVX-1 | Dependency/Impact Graph + Automated PR Review | ✓ Done (2026-08-12) |
| DEVX-2 | Verified Development Research Cache | Future — NOT STARTED |
| DEVX-3 | Agent Orchestration Analytics | Future — NOT STARTED |

See `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md` for the full design, `docs/DEVELOPMENT_WORKFLOW.md` for the short-command contract, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md` for test-selection policy, and `docs/DEVELOPMENT_STAGE_TEMPLATES.md` for the stage-type templates.
