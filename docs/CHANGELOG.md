# Changelog

All notable changes to the Mythos Prod repository are recorded here, following the spirit of [Keep a Changelog](https://keepachangelog.com/). This file was created early in the repository's history but never populated until Stage MPI-0-FINALIZATION — earlier stage history is authoritative in `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, and `git log`, not reconstructed here retroactively (see `docs/PROJECT_HISTORY.md` for the narrative history and `docs/history/DAILY_HISTORY.md` for the verified daily ledger).

This file is updated going forward per `docs/AI_HANDOVER.md`'s stage-completion convention: when a stage lands with user-facing or architecturally significant change, not for every commit.

## [Unreleased]

### Added — MYTHOS-REPO-MIGRATION-GATE — Future Repository Migration Directive

- Owner directive recorded for a **future** complete repository migration `othoth77/mythos-prod` → `othoth77/mythos-os` (`docs/MYTHOS_REPOSITORY_MIGRATION.md`). **No migration performed; not authorised.**
- Repository identity stated as a rule for the first time (`AGENTS.md` §2.1): `othoth77/mythos-prod`, branch `main`, is the sole source of truth until the migration gate closes. This closes the gap that allowed the repository's identity to be questioned in a prior session.
- Preservation list reconciled against the repository: two corrections recorded — `.ai/` does not exist (the AI collaboration infrastructure is `AGENTS.md`, `CLAUDE.md`, `.claude/skills/` with 20 skills, and `.opencode/`), and no CI/CD exists (`.github/` is absent; 105 test suites are run manually).
- Read-only coupling audit: 60 tracked files reference `mythos-prod`; absolute host paths inventoried; live host state that will not migrate with Git identified (push relay, executor service, n8n workflows, credentials, deployed databases).
- Two constraints recorded: history is testimony, not configuration (no bulk rewrite of historical records), and the repository's anonymous-`ls-remote` verification procedure breaks if the target is private and must be replaced before cutover.
- Ten-condition gate registered with honest status — one condition (target verified empty/decommissioned/ready) is **NOT SATISFIED and blocking**.

### Added — MAOL-0 — Mythos AI Operating Layer Master Specification

- Umbrella specification for the product-facing AI layer inside Mythos OS (`docs/MYTHOS_AI_OPERATING_LAYER.md`), covering all 20 agreed components: vision, AI Gateway, n8n integration layer, event-driven architecture, AI Brain, four-tier memory, eight specialised agents, agent governance, AI skills library, context engine, knowledge vault, document intelligence, AI workflow builder, human approval layer, audit and trace, digital twin, continuous improvement loop, external connectors, security architecture, enterprise readiness, marketplace, and a six-phase roadmap.
- Traceability matrix (§A) naming the owning canonical document and verified status (IMPLEMENTED/DESIGNED/PLANNED/CONCEPTUAL) for every component — the specification composes 23 existing documents rather than replacing any of them.
- Preserved-agreements register (§B): 27 prior decisions the specification explicitly does not override, including the ratified vector-search deferral, MPI owner decisions D1–D5, the 18 permanent `LEVEL_3` approval boundaries, the `.claude/skills/` Agent-Development-Skill boundary, and data-layer tenant isolation.
- Open-decision register (§C): 10 owner decisions (O-MAOL-1..10) recorded rather than resolved.
- Resolution of the naming collision with the existing Mythos AI Orchestrator: the Operating Layer serves products and end users; the Orchestrator serves builders; the former reuses the latter as an execution substrate, and neither is renamed or deprecated.
- Roadmap track registration (`docs/ROADMAP.md`) with stages MAOL-0..MAOL-6 and their entry gates.

Specification only — no runtime behaviour changed, nothing deployed, no owner decision made.

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
