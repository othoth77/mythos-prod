# Changelog

All notable changes to the Mythos Prod repository are recorded here, following the spirit of [Keep a Changelog](https://keepachangelog.com/). This file was created early in the repository's history but never populated until Stage MPI-0-FINALIZATION — earlier stage history is authoritative in `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, and `git log`, not reconstructed here retroactively (see `docs/PROJECT_HISTORY.md` for the narrative history and `docs/history/DAILY_HISTORY.md` for the verified daily ledger).

This file is updated going forward per `docs/AI_HANDOVER.md`'s stage-completion convention: when a stage lands with user-facing or architecturally significant change, not for every commit.

## [Unreleased]

### Added — OTH-K3 — knowledge trust model + private-store architecture + Track B readiness

- **`projects/oth-knowledge/lib/trust.js` + `config/trust-model.json`** — a strictly READ-ONLY knowledge trust model (zero store writes, test-pinned): authority tiers per source class (fail-closed registry closed both ways against the source-class registry), statement category from kind × tier × assertion class (model-output/imported content can never assess as an accepted fact, at any statement kind), explicit-`asOf` freshness (unknown-date stale fail-closed, `not-yet-true`, stale ≠ false), corroboration by (class, collection, content-anchor) independence (duplicates/derived/self/unresolved listed but never counted, `also_present_in` labelled separately), contradiction/supersession as of `decided_at`, sticky quarantine across both tag spellings, capture-aware version-at-asOf, and a closed non-truth-shaped summary enum with `not_a_truth_value: true`, a `basis[]`, and a full `trace`. Surfaced read-only via `knowledge-service.assessTrust` and the executor `READ_OPS` allowlist (with the executor-side `MYTHOS_KNOWLEDGE_ASOF` guard). Opus architecture review before implementation (APPROVE-WITH-CHANGES; all 13 changes implemented). Suite `tests/othk-3-trust-test.js`.
- **`docs/PRIVATE_STORE_ARCHITECTURE.md`** — the production private-store contract: location (never Git, never in-repo, never ephemeral), ownership/permissions, secret handling, integrity, backup/restore/DR, encryption, retention, migration. Provisioning and the live round trip are OWNER-BLOCKED.
- **`docs/OTH_TRACK_B_READINESS.md`** — per-source ingestion contracts (Takeout/Gemini/NotebookLM/Contacts): fixture validation COMPLETE, real-data validation OWNER-BLOCKED, unblock procedure enumerated. No real-data statistics fabricated.
- **`projects/oth-knowledge/ops/`** — operator scripts: `backup.sh`, `restore-verify.sh` (round-trip-verified locally), `deploy-vps.sh` (owner-channel, code-only).

### Fixed — OTH-K3 — independent security audit (PASS-WITH-FINDINGS), all CONFIRMED findings fixed

- Independent Opus adversarial audit; every CONFIRMED finding fixed with a regression test (architecture §10a): raw-byte secret gate (F1), trust ceiling on all statement kinds (F2), `asOf` ISO validation in the temporal path (F3), quarantine surfaced on all read ops + excluded from `latestVerified` (F4), linear HTML strip (F5, was single-file DoS), writer-path repository-containment with realpath (F6), widened forbidden-key matching + registry scan (F7), refusal-before-write ordering (F8), symlinked import-root refusal (F9), contacts header majority + digit-run rejection (F10), fail-closed restore with safe tar flags (F11), deploy-script argument validation (F12), `artifact_ref` shape validation (F13), `not-yet-true` never `supported` (F14), bounded query length (F15). A quarantine-tag-spelling defect in the existing executor `presentation` annotation was also found and fixed. Suites: othk-0 89/0, othk-1 30/0, othk-2 97/0, othk-2w 40/0, othk-3 61/0, executor 264/0, MOS-v2 gate green.

### Added — OTH-K2-W — executor-side knowledge-service wiring

- **`projects/mythos-ai-executor/lib/knowledge.js` + `config/knowledge.json`** — the AI Operating Layer's read-only consumption of OTH Knowledge, completing the integration stage `docs/OTH_KNOWLEDGE_INTEGRATION.md` §3 deferred from OTH-K2. Fail-closed config (unknown fields, endpoint/url/credential-shaped keys at any depth, relative or in-repository store roots each disable the whole layer); explicit read-operation allowlist so a write operation on the service surface never becomes reachable from the AI layer; `currentState` without an explicit `asOf` refused at the executor boundary; every search hit annotated with provenance plus `presentation` (`assertion_class`, `is_claim`/"claim — never present as fact", `quarantined`). Ships **disabled** with `store_root: null` until an operator provisions a persistent private store outside the repository.
- New suite `tests/othk-2w-executor-wiring-test.js` (39/0), run alongside the MOS-v2 regression gate, the executor suite, and othk-0/1/2 — all green; `projects/oth-knowledge/` itself unchanged.

### Changed — MOS-1.1 — release gate: contrast measured, a wrong claim corrected

- **Contrast measured, not disclaimed.** `projects/mythos-os-console/tools/contrast.js` computes WCAG 2.1 ratios over every pair the console renders, reading tokens from `mythos.css` and compositing translucent fills over their real backdrop. **26 of 26 rendered pairs meet AA; 12 meet AAA.** Now asserted by the suite, so it cannot regress. Recorded as **D-014**.
- **Three real contrast failures found and fixed as USAGE changes — no D-001 token was altered.** `--muted` measured 3.03–3.47:1 as body text; secondary text now uses `--mythos-text-secondary: #999`, recovered from `index.html:125` (and `#888` at `css/dashboard.css:75`), where the application already reaches for a lighter grey when a muted label must be read. The `is-planned` badge measured 3.21:1 on raw `--purple`; it now uses a lightened tint, the same derivation that produced `#8ff0b5` from `--green` and `#ff8c82` from `--danger`. The `is-inert` badge measured 2.80:1 and now uses the recovered `.invoice-payment-badge.pending` treatment. `--muted` stays declared verbatim.
- **Recorded and deliberately not fixed:** `--muted` is below AA as text throughout the live application (a `css/main.css` change needing its own stage), and `--border` at 1.17–1.34:1 is decorative — WCAG 1.4.11 governs boundaries required to identify or operate a control, and the console has no form control. The affordances 1.4.11 does govern pass at 7.38–8.45:1.
- **CORRECTION: `os.mythosprod.xyz` does have a DNS record.** MOS-1 reported that it did not, and named creating one as the blocking owner action. That claim was carried over from the sibling service's vhost comment and was never checked by resolving the name. The name resolves to `51.68.226.211`; two fabricated subdomains return NXDOMAIN from the same resolver, so it is a real record and not a wildcard. Corrected in the architecture doc (§10.0), the design-system follow-ups, and the vhost comment.
- **Browser verification committed and widened** — `projects/mythos-os-console/tools/visual-verify.js`, **499 checks across 6 viewports × 14 routes** (1440 / 1100 / 1024 / 768 / 390 / 320), clean. Adds explicit regression guards for all three MOS-1 defects (drawer opens and closes, zero inline style attributes anywhere, envelope timestamp renders), brand-fidelity assertions against values read from `css/main.css` at run time, in-browser contrast sampling with correct alpha compositing, proof that planned modules render no data surfaces, and proof that an unreachable plane never renders as an empty list.
- **New: `tools/host-preflight.sh`** — read-only, run on the VPS, checks all ten deployment preconditions against the host rather than against a document and refuses to pass if one is missing. It exists because of the DNS mistake above.
- **New: deployment runbook** with rollback, in `docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md` §10.2, plus §10.3 recording why this session cannot execute it (it runs in an ephemeral container, not the VPS, and the network policy refuses the production hosts outright).
- `tests/mos-1-console-test.js`: **286 → 322 assertions**, 0 failures.
- Still not deployed. Governance, SSANGYONG, `css/main.css` and `projects/command-center/` remain untouched.

### Added — MOS-1 — MYTHOS OS COMMAND CENTER

- New application `projects/mythos-os-console/` — the read-only operations console for Mythos OS, serving `os.mythosprod.xyz`. Architecture in `docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md`; the design audit and specification it was built from in `docs/MYTHOS_OS_DESIGN_SYSTEM.md`. Implements Phase 8 of `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md` (§AE, previously "DESIGNED — no implementation") and the first built surface of `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`.
- **No new visual identity.** The existing Mythos OS brand system (D-001) is extracted verbatim into `reference/web/mythos.css` under a `--mythos-*` namespace — twenty colour tokens, Playfair Display + Inter, the nav rail, button set, card surface, KPI, page header, section rule, pill and detail-row idioms. `css/main.css` is **not modified**. New decisions **D-012** (the extraction) and **D-013** (gold means the owner is being waited on) recorded in `docs/MYTHOS_DESIGN_DECISIONS.md`; everything new rather than recovered is tagged as such in the specification.
- No runtime dependency, no build step, no `package.json`. Node `http` plus vanilla front end, following `projects/idauto/reference/` and `projects/command-center/reference/`.
- **Read-only by construction, enforced in four independent places:** GET/HEAD only, refused before routing; no request-body reader exists in the server; the upstream client exposes GET only; all three asserted at source level by the suite. Approvals, cancellation and campaign control stay in the owner-operated CLI where `AGENTS.md` §25.3 put them — no governance control was modified.
- Fourteen modules registered (Command Center, Missions, Campaigns, Agents, Providers, Budget, Roadmap, Memory, Audit, Governance, Approvals, Secrets, Sandbox, Settings); **eight built, six planned**. A planned module is shown, dimmed and marked `SOON`, and renders a not-built surface naming the file or schema that would back it — never invented data.
- Adding a module is one registry entry plus one render function. The sidebar, router, page chrome and empty states follow automatically; `mythos.css` is not touched. The registry is served at `GET /api/modules`.
- Data is read live from the mythos-ai-executor API over loopback (`/tasks`, `/campaigns`, `/events`, `/budget/<project>`) and from its config registries on disk. The token is read server-side and never reaches the browser. The agent registry is projected through a ten-field allowlist rather than passed through, so a credential added to `agents.json` cannot become a public field.
- **An empty result and an unreadable one never look alike.** An unreachable control plane renders as "the current state is unknown", not as an empty list. Config-backed modules keep working when the HTTP plane is down.
- CSP is `script-src 'self'` / `object-src 'none'` with no inline script or style; `style-src` and `font-src` admit the two Google Fonts hosts so the console keeps the brand typefaces, with full local fallbacks. The exception is stated in the architecture doc and self-hosting is recorded as follow-up.
- Gaps the design audit named are closed **for this surface only**: a spacing scale (U-004 had none), a visible focus ring, reduced-motion handling, and a sidebar that collapses below 900px — `css/main.css` keeps its 310px sidebar fixed at every width. The live application is untouched; portfolio-wide reconciliation remains design-roadmap Stage 8.
- `tests/mos-1-console-test.js` — **286 assertions, 0 failures**, deterministic and offline. The D-001 colour values are read out of `css/main.css` at test time rather than retyped, so drift from the brand system fails the suite.
- **D-010 applied a second time.** Headless-browser verification across three viewports and nine routes found three defects that source review had not: the mobile nav drawer could not be opened (a cascade-order bug between the two stylesheets), two dead `style=""` attributes tripped the console's own CSP, and the "last read" timestamp read the wrong envelope field. Adoption as a standard (O-009) is recommended and remains an owner decision.
- **Not deployed.** `os.mythosprod.xyz` has no DNS record; creating one is a LEVEL_3 owner action. The vhost and systemd unit are committed as inert configuration.

### Fixed — MCC-1-VERIFY — ordre.mythosprod.xyz live, clipboard fallback corrected

- `ordre.mythosprod.xyz` is live over HTTPS. DNS resolves to `51.68.226.211` (confirmed authoritatively at OVH and via public resolvers); Let's Encrypt certificate issued with the approved `certbot --nginx` procedure after a passing dry run, valid to 2026-11-15, chain validates, `certbot.timer` armed for renewal; HTTP redirects to HTTPS.
- **Fixed:** `writeClipboard` in `projects/command-center/reference/web/app.js` fell back to the legacy `execCommand` path only when `navigator.clipboard` was absent. That API can be present and still reject (`NotAllowedError` on denied permission or an unfocused document), in which case the copy silently failed and no usage was recorded. The rejection is now caught and retried through the legacy path. Four assertions added; suite **506 passed, 0 failed**.
- Verified over public HTTPS: all static assets and API endpoints 200 with correct MIME types, usage counter increments and reaches the leaderboards, unauthenticated write refused 401, token session valid, notes created, credential-bearing note refused 422.
- Six neighbouring sites confirmed unaffected by the nginx reload.

### Added — MCC-1 — MYTHOS AI COMMAND CENTER

- New application `projects/command-center/` — a permanent, searchable command library for Mythos OS, Claude, Codex and AI agents, serving `ordre.mythosprod.xyz`. Architecture in `docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md`.
- Reuses the repository's existing API precedent rather than introducing a stack: node `http` + `pg`, no framework, no build step, vanilla front end, plain `node tests/<stage>-test.js`. New runtime dependency: `pg` only.
- Database `mythos_command_center`, schema `mcc`, role `mythos_command_center_owner`, in the existing `idauto-postgres` container — the verified host convention of one server, one database per product, own owner role. No cross-product query and no cross-schema foreign key; `search_path` pinned to `mcc`.
- 13 tables: commands, categories, projects, tags, command_tags, command_relations, command_versions, favorites, usage_events, notes, templates, workflows, workflow_commands. Version history and usage events are append-only.
- **No `DELETE` route exists anywhere.** Archiving is a reversible status change (`ACTIVE` / `ARCHIVED` / `DRAFT`) and archived commands remain searchable.
- **The application never executes a stored command** — no `child_process`, `exec`, `spawn`, `eval` or `Function` in any runtime file, asserted at source level by the test suite.
- Two-severity credential gate on every write: recognised key formats are refused with HTTP 422 and no override; ambiguous `password = …` assignments are warned and allowed. Findings never echo the matched text.
- Reads public, writes token-gated (SHA-256 digests compared with `timingSafeEqual`); `server.js` refuses to start without `MCC_ADMIN_TOKENS`.
- Search: generated weighted `tsvector` plus a generated accent-folded `search_text` column, so a French query without accents finds accented content and vice versa.
- V1 interface: dashboard (most used / favourites / recently used / recently added / recommended / categories / quick actions), search with seven filters, command detail, editor, notes, favourites, statistics with today/week/month/all-time leaderboards, JSON export, dark and light themes, and keyboard shortcuts (`/`, `c`, `f`, `n`, `Esc`).
- English and French complete; Arabic architecture-ready (per-locale `dir`, fallback chain, `name_ar` columns, logical CSS properties) and deliberately not shipped half-translated.
- Seeded with 24 commands, 26 categories, 6 projects, 35 relations, 3 workflows and 3 notes, each derived from in-repository canon with a checkable `source` field. The owner's original chat-session command texts are **not** in this repository and these are reconstructions to be replaced verbatim when supplied.
- `tests/mcc-1-command-center-test.js` — **502 assertions, 0 failures**, against a real database. The suite refuses to run unless the connected database name ends in `_test`.
- Deployed under user-scope systemd on `deploy`, behind a new nginx vhost, verified end-to-end through nginx and in a real browser. Neighbouring services unaffected by the reload.
- **Not complete:** `ordre.mythosprod.xyz` has no DNS record, so no TLS certificate exists and the public URL is unreachable. Creating the A record is an owner-approval action (AGENTS.md §25.3) and no OVH credential is configured on this host.
- V2–V6 (templates and workflow stepping, advanced analytics, AI recommendation, n8n integration, AI-generated commands) are documented and architecture-ready, not built.

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
