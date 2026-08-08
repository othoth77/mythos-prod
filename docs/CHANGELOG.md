# Changelog

All notable changes to the Mythos Prod repository are recorded here, following the spirit of [Keep a Changelog](https://keepachangelog.com/). This file was created early in the repository's history but never populated until Stage MPI-0-FINALIZATION — earlier stage history is authoritative in `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, and `git log`, not reconstructed here retroactively (see `docs/PROJECT_HISTORY.md` for the narrative history and `docs/history/DAILY_HISTORY.md` for the verified daily ledger).

This file is updated going forward per `docs/AI_HANDOVER.md`'s stage-completion convention: when a stage lands with user-facing or architecturally significant change, not for every commit.

## [Unreleased]

### Added — MPI-0 — Mythos Personal Intelligence & Skills Platform Foundation

- Strategic architecture direction: shared, per-user/per-organisation/per-profession AI personalisation platform (`docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md`).
- Full layered contract set: Global Intelligence → Domain → Organisation → User → Session → Intent → Skill Router → Superposer → Guard → Specialised Skills → Model/Agent/Tool → Validation → Learning Signals (`docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`).
- Memory policy, context architecture, multi-tenancy requirements, chatbot pipeline, model routing, and two domain-pack capability contracts (`education`, `automotive_workshop`).
- 18 Agent Development Skill manifests under `.claude/skills/`.
- Illustrative in-memory reference implementation (`projects/personal-intelligence/reference/`) and a 15-table draft (undeployed) PostgreSQL schema.
- 47-test suite (`tests/mpi-0-personal-intelligence-test.js`).

### Added — MPI-0-FINALIZATION — Skills Evolution, Project Intelligence, Portfolio Registry

- Skills evolution audit and versioning policy (`docs/SKILLS_EVOLUTION.md`, `docs/SKILLS_VERSIONING_POLICY.md`); machine-readable skill registry (`projects/personal-intelligence/config/agent-skills-registry.json`).
- Two new Agent Development Skills: `mythos-skill-evolution` and `mythos-project-history`.
- Mythos portfolio registry distinguishing repository-verified state from owner-direction and future-concept tracks (`docs/MYTHOS_PORTFOLIO_REGISTRY.md`, `projects/meta/portfolio-registry.json`).
- GitHub-based project history system: `docs/PROJECT_HISTORY.md`, `docs/history/DAILY_HISTORY.md`, `docs/PROJECT_STATUS.md`, `docs/PROJECT_STATISTICS.md`, `projects/meta/project-ledger.json`, `projects/meta/project-statistics.json`.
- Deterministic offline history/statistics/registry validation tool (`scripts/project-intelligence.js`).
- Reference-implementation fixes: `guard.js` permanent-boundary id documentation and `dataClassification` handling; `scope.js` identifier-guessing loophole (session/domain scope no longer matches on two absent ids).
- Additional tests for scope isolation, registry consistency, and statistics-formula validation.

### Added — DEVX-0 — Mythos Development Acceleration MVP

- Stage Runner CLI (`scripts/mythos-stage.js`): `context`/`status`/`start`/`validate`/`close`, deterministic and offline-first, reuses `scripts/project-intelligence.js` rather than duplicating it.
- Current-context snapshot (`projects/meta/current-context.json`), known-baseline registry (`projects/meta/known-baselines.json`), test-impact map (`projects/meta/test-impact-map.json`), development lanes FAST/STANDARD/HIGH_RISK (`projects/meta/development-lanes.json`), and 7 reusable stage templates (`projects/meta/stage-templates.json`).
- Short-command workflow contract: `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md`, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`, `docs/DEVELOPMENT_STAGE_TEMPLATES.md`.
- 7 existing Agent Development Skills extended to consume the above — no new skill created.
- 45-test suite (`tests/devx-0-development-acceleration-test.js`).

### Added — RES-0 — Mythos Research Intelligence free-first foundation

- Free-first, provider-independent research-source architecture (documentation only). PR #5 open Draft — RES-1 not authorised.

### Added — INF-OVH-API-0 — OVH Read-Only Connector (reference implementation)

- `projects/automation/reference/ovh-readonly-connector.js`: LEVEL_1_READ_ONLY connector orchestration (list authorised domains, collect registrar metadata, collect DNS records, collect DNSSEC state, redacted snapshots). Structurally read-only (rejects any injected client exposing a mutation-shaped method); refuses to run unless explicitly enabled. No live OVH credential exists anywhere; no live network call made; not deployed.
- 26-test suite (`tests/inf-ovh-api-0-connector-test.js`), every provider response mocked.
- `projects/meta/project-ledger.json` and `projects/meta/test-impact-map.json` updated accordingly.

### Added — INF-CF-AUTO-0 — Cloudflare Read-Only Connector (reference implementation)

- `projects/automation/reference/cloudflare-readonly-connector.js`: LEVEL_1_READ_ONLY connector orchestration (account and zone inventory, current settings inventory). Structurally read-only; refuses to run unless explicitly enabled; redacts account-owner-identifying fields. No live Cloudflare credential exists anywhere; no live network call made; not deployed.
- 26-test suite (`tests/inf-cf-auto-0-connector-test.js`), every provider response mocked.
- Known, deliberately deferred cleanup item: `buildSnapshotRecord`/`assertReadOnlyClient` duplicate their `ovh-readonly-connector.js` counterparts — extraction into a shared module was explicitly deferred, not performed.

### Fixed — RUNTIME-DUPLICATE-CLEANUP-0 — Canonical runtime function ownership

- Fixed a real production bug: a stray, unused `let stableLineCount = 0;` in `js/shared/mission-orders.js` collided with `js/shared/invoices.js`'s genuinely-used `var stableLineCount`, throwing a SyntaxError that silently discarded the entire `invoices.js` script at runtime. Invoice editing was silently running on a stale, degraded `js/app.js` fallback (missing TVA/timbre/status/payment-mode/line restoration; "add line" was a dead stub).
- Removed the dead `stableLineCount` declaration from `mission-orders.js`; `invoices.js` now loads and its `editInvoice`/`deleteInvoice` are the sole, canonical implementation.
- Removed the now-superseded `editInvoice`/`deleteInvoice` duplicates from `js/app.js`.
- Confirmed `addOmPerson`/`cancelOM` mission-order ownership was already correctly canonical in `mission-orders.js` (Stage 4AG) — no change needed there.
- Corrected `tests/stage4z-test.js` and `tests/stage4ag-test.js`, which had hard-coded the pre-fix "blocked" state as a required assertion.
- Added `tests/runtime-duplicate-cleanup-0-test.js` (24 tests), including a same-shared-global-scope load test — the only kind of check that actually catches this class of cross-file redeclaration collision.

### Changed — AUT-CONNECTOR-SHARED-HELPERS-0 — Shared read-only connector foundation cleanup

- Extracted `projects/automation/reference/connector-readonly-helpers.js` — a small, provider-neutral module owning mutation-method detection (`assertReadOnlyClient`) and snapshot-record construction (`buildSnapshotRecord`), resolving the deferred duplication between `ovh-readonly-connector.js` and `cloudflare-readonly-connector.js` noted in their respective stage entries.
- Both connectors now delegate to the shared module with their own error prefix; public `module.exports` contracts unchanged. Provider-specific redaction (`redactRegistrantFields` / `redactOwnerFields`) and collection orchestration intentionally remain separate, not generalised.
- Added `tests/aut-connector-shared-helpers-0-test.js` (40 tests). OVH and Cloudflare connector suites unchanged at 26/26 each.
