# PROJECTS.md — Central Project Map

Every project in the othoth77 environment, linked to its real repository and paths.
All statements below were verified against the repository on 2026-08-18 (othoth77/mythos-prod @ `523d855`, branch `main`) unless explicitly marked `UNVERIFIED`.

**The primary workspace is a monorepo:** `othoth77/mythos-prod` contains the production web app at its root plus 16 sub-projects under `projects/`. Section 1 maps that monorepo; section 2 maps the other GitHub repositories; section 3 summarizes shared infrastructure.

## Contents

1. [Monorepo projects (othoth77/mythos-prod)](#1-monorepo-projects)
2. [Other GitHub repositories](#2-other-github-repositories)
3. [Shared infrastructure & deployment](#3-shared-infrastructure--deployment)

Monorepo project index:

- [Mythos OS (root web app)](#mythos-os-root-web-app) — `.`
- [Mythos Identity Core (mythos-core)](#mythos-identity-core-mythos-core) — `projects/mythos-core`
- [MYTHOS OS Command Center (mythos-os-console)](#mythos-os-command-center-mythos-os-console) — `projects/mythos-os-console`
- [Mythos AI Command Center (MCC-1)](#mythos-ai-command-center-mcc-1) — `projects/command-center`
- [Mythos Orchestrator](#mythos-orchestrator) — `projects/mythos-orchestrator`
- [Mythos AI Executor](#mythos-ai-executor) — `projects/mythos-ai-executor`
- [ID Auto (idauto.tn)](#id-auto-idautotn) — `projects/idauto`
- [Mythos Automotive (umbrella)](#mythos-automotive-umbrella) — `projects/automotive`
- [Mythos Atelier Network](#mythos-atelier-network) — `projects/atelier-network`
- [AutoValeur](#autovaleur) — `projects/autovaleur`
- [SsangYong Parts (SSANGYONG.AUTOS)](#ssangyong-parts-ssangyongautos) — `projects/ssangyong-autos`
- [Mythos Automation & Operations (mythos_automation)](#mythos-automation-operations-mythosautomation) — `projects/automation`
- [Infrastructure registries (Cloudflare domain inventory + Coolify environment registry)](#infrastructure-registries-cloudflare-domain-inventory-coolify-environment-registry) — `projects/infrastructure`
- [Cloudflare deployment tooling (deploy/)](#cloudflare-deployment-tooling-deploy) — `deploy`
- [DEVX — Mythos Development Acceleration](#devx-mythos-development-acceleration) — `projects/devx`
- [Mythos Personal Intelligence & Skills Platform (MPI)](#mythos-personal-intelligence-skills-platform-mpi) — `projects/personal-intelligence`
- [Mythos Research Intelligence (RES)](#mythos-research-intelligence-res) — `projects/research-intelligence`
- [Project Meta Registry (machine-readable portfolio state)](#project-meta-registry-machine-readable-portfolio-state) — `projects/meta`
- [Mythos Agent Development Skills (.claude/skills)](#mythos-agent-development-skills-claudeskills) — `.claude/skills`

---

## 1. Monorepo projects

All entries in this section: **Repository:** `othoth77/mythos-prod` (public), branch `main`, sole source of truth per `AGENTS.md` §2.1. Local path prefix on a dev clone: the repo root; on the VPS: `/home/deploy/projects/mythos-prod`.

### Mythos OS (root web app)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `.` (repo root)
- **Status:** PRODUCTION / MAINTENANCE. Runtime-plugin migration complete through Stage 4AG + RUNTIME-DUPLICATE-CLEANUP-0 (docs/ROADMAP.md lines 71-80: 'Mythos OS Runtime is complete... No further Mythos OS Runtime stage is currently authorized'). js/app.js monolith reduced from ~9,948 lines (docs/architecture.md, audited 2026-07-29) to 968 lines today (verified wc -l) via 33 Stage-4 extractions into js/shared/ and js/core/ (2026-08-01 to 2026-08-05). All 7 runtime plugins active on main (docs/module-map.md Stage 3H). Known deferred items: removePersonRow orphan in app.js, js/app-fresh.js dead file, ~210 lines of logs/sidebar/sync still in app.js. docs/architecture.md's file-size table is stale relative to the current tree.

**Main purpose:** Legacy production-management platform (branded 'Mythos Prod' / currently wearing 'Uthina Chess' event-manager branding in index.html, manifest.json, and the login screen). Single-page app managing invoices, devis (quotes), contracts, clients, collaborators, mission orders (OMs), rendez-vous, representations, accounting (bank/cash/expenses/purchases/suppliers/TVA/reports), contact directory with Google Contacts import, tasks, reminders (rappels), document drafting (redaction), inscriptions/call management, documentation and camera modules. Per docs/mythos-os-blueprint.md it is evolving into 'Mythos OS' — a browser-native business operating system where Mythos Prod is the first business app on a core-platform + runtime-plugin architecture.

**Technology / stack:** Pure PHP 8.x + vanilla JS SPA. Explicit constraint (docs/mythos-os-blueprint.md): no framework, no build step, no npm, no ES modules — classic <script> tags sharing one global scope. Server side: api.php flat-file JSON store (appdata/*.json is the source of truth), nginx or Apache (.htaccess for OVH). PWA manifest.json. Tests are plain Node.js scripts (Node 22+) with zero dependencies.

**Important folders:**

- `js/core` — Platform core layer, loaded before everything else: events.js (event bus), storage.js (localStorage helpers + _memCache quota fallback + the pending-write pipeline extracted from app.js in Stage 4A), sync.js (SYNC ENGINE v5 — merge-by-id, never replace), router.js, api.js (fetch wrappers), platform.js (plugin registry + lifecycle), shell.js (navigation/sidebar/widgets registries), plugin-sdk.js (Plugin.create() builder API).
- `js/core/services` — Stage 3A.5 runtime services, all self-contained IIFEs: search.js (MythosSearch), calendar.js (MythosCalendar), widgets.js, notifications.js, dialogs.js, plugin-services.js (bridges plugin manifests to the services).
- `js/plugins` — 7 active runtime plugins (production, dashboard, calendar, tasks, planning, contacts, notes — *.runtime.js, loaded from index.html) registered via the Plugin SDK; each does onBoot storage-key validation and onReady search/calendar provider registration while ALL business logic stays in legacy files. The parallel *.plugin.js files are the older metadata-only manifests that the runtime files replaced in index.html.
- `js/shared` — ~30 domain modules extracted from the app.js monolith during Stage 4A-4AG: invoices.js, devis.js, mission-orders.js, contracts.js, clients.js, collaborateurs.js, fournisseurs.js, accounting-* (8 files), contacts.js (58 KB), calendar.js, dashboard.js, backup.js, documentation.js, camera.js, inscriptions.js, spectacle-calculator.js, statistics-dashboard.js, modal-entity-helpers.js, etc. They load AFTER app.js and share its global scope.
- `css` — main.css (61 KB) + layout.css + professional.css + dashboard.css are the real stylesheets loaded by index.html; calendrier/facture/forms/print.css are ~100-byte stubs.
- `tests` — 119 zero-dependency test files. Convention: one self-contained Node script per stage/feature, run individually as `node tests/<name>-test.js`. Exception: tests/core-test.js is a browser-console test (its header: fetch('tests/core-test.js').then(r=>r.text()).then(t=>eval(t)) after page load).
- `scripts` — Repo governance tooling (Node built-ins only, offline): mythos-stage.js (stage runner: context/status/start/validate/close), mythos-orchestrate.js (delegation CLI wrapping projects/mythos-orchestrator, meaningful exit codes 0-6), project-intelligence.js (validates projects/meta/ ledger/statistics/registry; commands: validate/stats/history-check/ledger-check/summary), pc-audit.ps1.
- `data` — Contains only default-data.js, a one-line comment stub: default data is actually seeded from js/app.js via localStorage.
- `docs` — docs/architecture.md and docs/module-map.md are the authoritative (if partly stale) maps of this app; docs/mythos-os-blueprint.md (1,295 lines) is the platform vision; docs/AI_HANDOVER.md (12,730 lines) is the mandated current-state source of truth per CLAUDE.md.

**Important files:**

- `index.html` — 142 KB / 2,229 lines — the entire shell plus every page template and modal inline. Script order is load-bearing (lines 2174-2227): js/utils.js first; then core in fixed order events → storage → sync → router → api → platform → shell → services (search/calendar/widgets/notifications/dialogs/plugin-services) → plugin-sdk; then the 7 plugins/*.runtime.js; then logger.js → auth.js → app.js; then ~28 js/shared/* modules; js/taches.js LAST. js/rappels.js and js/redaction.js load with defer from <head> (lines 24-25) and depend on app.js globals. Cache busting via ?v=YYYYMMDD query strings edited by hand.
- `js/app.js` — The shrinking legacy monolith — now 968 lines / 37 KB (was ~9,948 lines / 510 KB per docs/architecture.md). Still owns: STORE accessor object over _storeGet/_storeSave, restore-guard migrations (mp_restored_from_* one-time flags — never delete), app initialization/bootstrapStableApp, demo-data seed, logs/sidebar/background-sync remnants. Header comments document where each extracted subsystem now lives.
- `js/core/storage.js` — _storeGet/_storeSave/_safeSet/_storeHas/_storeRemove + _memCache in-memory fallback (quota-exceeded writes are kept in memory so the session never loses data) + the pending-write pipeline: _pendingKeys persisted as _mp_pending_keys, _flushPending (fetch), _flushPendingBeacon (sendBeacon on pagehide/logout), _pushCollection (chunked POST if >800 items), _triggerAutoBackup.
- `js/core/sync.js` — SYNC ENGINE v5. Stated invariant in its header: merge arrays by id (id/_id, updatedAt/createdAt/date timestamps) — NEVER replace a collection wholesale; each device pushes what it has, the server accumulates. Also tombstone soft-delete helpers and syncFromServer (fires on login: GET api.php?key=__all__, merge, push local-only keys back).
- `js/core/plugin-sdk.js` — Plugin.create(base) → chainable PluginBuilder (defineMenu/defineRoutes/defineStorage/defineWidgets/definePermissions/defineSettings/defineSearch/defineCalendar/defineDashboard → build() registers with Platform + Shell). Validates id kebab-case, semver, type core|shared|business; calling a define twice throws.
- `js/auth.js` — AUTH singleton: single-user login comparing a Web-Crypto SHA-256 hash of the entered password against a hash constant hardcoded in this file (no secret value reproduced here); session is {ts} in localStorage key mp_auth_session, 8-hour validity, never synced; logout flushes pending writes via sendBeacon with a 6s guarantee then reloads. No server-side session check exists — api.php trusts all requests (blueprint §2.3 explicitly notes permissions are UI-only until api.php verifies a token). Note index.html line 44 carries the comment 'Authentification supprimée - localhost uniquement'.
- `api.php` — 14 KB REST API v3, 'source de vérité unique: le serveur'. Key-allowlist gate (ALLOWED_KEYS ~31 mp_* collections + dynamic mp_rdtpl_*/mp_rdent_*), one JSON file per collection in appdata/, meta.json per-collection {updatedAt,count}, LOCK_EX writes. GET: ?key=__all__ / ?key={collection} / ?action=meta|health|list_backups|cleanup(key-gated). POST: single save, __bulk__ (logout flush), __chunk__ assembly, __auto_backup__, __restore_backup__. CORS Access-Control-Allow-Origin: * with no auth.
- `upload.php` — Document/photo upload to documents/{cat}/: sanitizes cat and doc_id via regex, MIME allowlist (images/PDF/Office/CSV/plain), 10 MB max.
- `cleanup.php` — Disk cleanup (backup pruning: max 10 backups, 7-day age, always keep 3; 100 MB appdata alert). Runs unauthenticated from CLI cron; web access gated by a literal key constant defined in this file (value in source, not repeated here) — also reachable via api.php?action=cleanup.
- `google_auth.php` — Starts Google OAuth: reads git-ignored google_config.php (client_id/client_secret/redirect_uri — template at google_config.php.example), 302 to accounts.google.com with contacts.readonly scope.
- `google_callback.php` — OAuth code→token exchange, paginated People API fetch (1000/page), writes contacts server-side directly into appdata/mp_repertoire_contacts.json (bypasses localStorage quota), stores a one-time result under appdata/google_imports/{token}.json, redirects to index.html?googleImportToken=...
- `google_fetch_result.php` — One-time token endpoint: serves the pending import result once, deletes the file immediately after read (hex-sanitizes the token).
- `manifest.json` — PWA manifest — currently 'Gestionnaire d'événement' / Uthina Chess branding, standalone display, assets/icons/icon-192.png + icon-512.png.
- `.htaccess` — OVH Apache config: Options -Indexes, force-HTTPS rewrite, security headers (nosniff/SAMEORIGIN/XSS/Referrer-Policy), 30-day cache for static assets vs no-cache for HTML (which is why JS uses ?v= busting), deflate, DirectoryIndex index.html.
- `docs/architecture.md` — Authoritative architecture doc (audited 2026-07-29, pre-Stage-4 so file sizes are stale): data flow browser↔localStorage↔api.php↔appdata/*.json, script loading order, sync engine walkthrough, full localStorage key inventory (business keys synced; _mp_sync_meta/_mp_pending_keys internals; mp_auth_session/mp_activity_log never synced; migration-guard flags never deleted), api.php endpoint table, server file layout, Google OAuth flow, production path /var/www/uthinachess/0726/Prod/.
- `docs/module-map.md` — Per-module global symbols, localStorage dependencies, cross-module coupling matrix, storage-key ownership map per plugin (one owner per key), Shell/Plugin-SDK/services API reference, and the known duplicate-declaration table for app.js.
- `docs/mythos-os-blueprint.md` — Platform blueprint v1.0 (Stage 3A.5 era): vision (browser-native business OS for Tunisian/MENA SMEs), design philosophy (offline-first, own-your-data, no framework/no build, plugin-progressive), core services incl. planned future users.js/permissions.js RBAC, long-term roadmap.
- `tests/stage4a-test.js` — Representative of the test convention: header states 'Run with: node tests/stage4a-test.js'; uses only fs/path/vm built-ins to load and assert against the real source files.
- `AGENTS.md` — Repository working rules that CLAUDE.md makes mandatory: source-of-truth priority, preflight discipline, targeted-tests-first policy, stage lifecycle, security rules (never expose secrets, guard browser-only globals in non-browser tests).

**Related projects:**

- deploy/ (Cloudflare tunnel deployment docs — see separate record)
- projects/* subdirectories (mythos-os-console, command-center, idauto, personal-intelligence, mythos-orchestrator, etc. — separate product tracks in the same repo; the legacy app does not reference them at runtime)
- scripts/mythos-orchestrate.js requires projects/mythos-orchestrator/orchestrator.js

**Key documentation:** `docs/architecture.md`, `docs/module-map.md`, `docs/mythos-os-blueprint.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `docs/runtime-consolidation.md (referenced by module-map)`, `docs/runtime-services.md (referenced by module-map)`, `AGENTS.md`, `README.md`

**Important technical notes:** TESTS — no package.json, no runner: each file is invoked directly, e.g. `node tests/stage4a-test.js`, `node tests/stage1b-test.js` (header: 'Runs in Node.js 22+'), `node tests/mos-1-console-test.js` (header: 'Run with: node tests/mos-1-console-test.js'); tests/core-test.js alone runs in the browser console via fetch+eval after page load. Known harness gotcha (docs/AI_HANDOVER.md): several legacy stage3* browser-runtime suites have pre-existing subprocess failures ('_memCache is not defined' / 'document.addEventListener is not a function' DOM-harness pattern) — byte-identical at clean HEAD, do not treat as novel regressions. SCRIPT ORDER IS LOAD-BEARING: all scripts are classic tags in one global scope; a single global collision can silently discard an entire file — the documented stableLineCount incident (let in mission-orders.js vs var in invoices.js) threw a SyntaxError that silently killed all of invoices.js in production until RUNTIME-DUPLICATE-CLEANUP-0 (PR #9) fixed it. Never reorder index.html scripts; taches.js must stay after app.js; rappels.js hard-depends on escHtml from app.js. SYNC INVARIANTS: server is source of truth; collections merge by id+updatedAt (never replace); deletes use tombstones; writes debounce ~3s through _mp_pending_keys and flush via sendBeacon on pagehide (data-loss risk if beacon blocked); >800-item arrays push chunked; auto-backups capped at 10 in appdata/backups/. Two storage paths coexist (STORE v1 via _storeGet/_storeSave vs raw-localStorage fallbacks in taches/redaction) — keys stay consistent but raw writes bypass the sync queue. app.js sync-era code is marked CRITICAL in docs — do not modify without regression tests. Migration-guard localStorage flags mp_restored_from_1778961756472_v2/_v4 must never be deleted. Branding gotcha: constants MYTHOS_LOGO_SRC etc. at js/app.js:5-7 reference assets/logos/, but the running app wears Uthina Chess branding everywhere. French is the UI and comment language.

**Deployment / infrastructure:** No build step — deploy is file copy. Documented production path: /var/www/uthinachess/0726/Prod/ behind nginx + PHP 8.x (docs/architecture.md); .htaccess additionally targets OVH Apache shared hosting. Runtime state lives server-side in appdata/ (created by api.php with mkdir 0755) and documents/ (uploads) — both outside git. google_config.php must be created from google_config.php.example on the server and is git-ignored; Google OAuth redirect URI must match the deployed path. cleanup.php is intended for OVH cron. Cache busting is manual ?v= query-string editing in index.html since .htaccess sets 30-day caching on js/css. AGENTS.md forbids deploying from an uncommitted worktree and requires recorded smoke tests and rollback references.

---

**— Platform & AI operations —**

### Mythos Identity Core (mythos-core)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/mythos-core`
- **Status:** DRAFT / NOT DEPLOYED — stage MYTHOS-IDENTITY-CORE-0. database/identity-schema.sql states explicitly: 'STATUS: DRAFT — NOT DEPLOYED... does NOT provision a database... No Mythos database currently hosts these tables.' The contract module is complete and covered by tests/mythos-identity-core-0-contract-test.js.

**Main purpose:** Canonical platform identity layer for Mythos OS: users (usr_<uuidv7>), organizations (org_<uuidv7>), services (svc_<name>), memberships and the actor rule. Deliberately NOT a service — a contract plus a thin, dependency-free resolution library (docs/MYTHOS_IDENTITY_ARCHITECTURE.md §4), because zero deployed consumers exist. No PII and no credential columns anywhere; consuming products store the prefixed IDs as opaque VARCHAR(64) with no cross-schema FK.

**Technology / stack:** PostgreSQL DDL (draft, not executed) + a single framework-free Node.js contract module (Node crypto only, no third-party packages, no package.json).

**Important folders:**

- `projects/mythos-core/database` — identity-schema.sql — draft DDL for mythos_users / mythos_organizations (+ memberships), with CHECK constraints enforcing usr_/org_ UUIDv7 formats; explicitly not executed by any stage.
- `projects/mythos-core/reference` — identity-contract.js — the whole runtime surface of this project: UUIDv7 generation, anchored validators for usr_/org_/svc_ IDs, ORG_ROLES (owner/admin/member/readonly), PLATFORM_ROLE (mythos_super_admin), ACTOR_TYPES copied verbatim from the live idauto_audit_log CHECK constraint.

**Important files:**

- `projects/mythos-core/database/identity-schema.sql` — Draft identity schema; internal user_pk must never cross a product boundary — mythos_user_id is the only externally visible identity value; [NO PII] rule applied throughout.
- `projects/mythos-core/reference/identity-contract.js` — Deterministic, stateless contract module: uuidv7() (48-bit ms timestamp + version/variant bits), regex validators rejecting v4/wrong-variant UUIDs, role/actor vocabularies.
- `tests/mythos-identity-core-0-contract-test.js` — Contract test suite for this project (repo convention: plain node tests/<stage>-test.js, no test framework).

**Related projects:**

- projects/idauto (role/actor vocabularies adopted verbatim from its live CHECK constraints)
- projects/mythos-os-console
- projects/mythos-ai-executor

**Key documentation:** `docs/MYTHOS_IDENTITY_ARCHITECTURE.md (binding decision: §2 canonical identifier, §3 minimum model, §5 roles, §7 non-scope)`

**Important technical notes:** Do not confuse with projects/mythos-ai-executor/core/ (the Phase-2 'Orchestration Core' — a different thing entirely). Non-scope is deliberate and enumerated: no credential storage, no auth service, no profile data (profile/legal/tax data stays in product schemas, e.g. idauto_organizations.tax_id). Validate with: node tests/mythos-identity-core-0-contract-test.js. Nothing here may gain a server/router/IO without a new architecture decision.

---

### MYTHOS OS Command Center (mythos-os-console)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/mythos-os-console`
- **Status:** MOST RECENTLY ACTIVE TRACK — MOS stages. MOS-1 complete (read-only console, tests/mos-1-console-test.js; README cites 322 assertions, architecture doc's older figure is 286); MOS-1.1–1.7 hardening/deploy-automation passes; MOS-1.8 temporary client-side login gate (explicitly NOT the final auth architecture); MOS-2 mission queue / model selection / start execution (2026-08-18, PASS); MOS-2.1 full execution-lifecycle dashboard + cancel action and a logo-sizing visual-regression fix (2026-08-18, PASS). Per docs/AI_HANDOVER.md: code merged to main but NOT DEPLOYED / production process STALE — the live service predates MOS-2 and needs `systemctl --user restart mythos-os-console` as deploy; deployment is blocked by a deliberate deploy-user privilege boundary (MOS-1.6/1.7), an operator action outside any Claude session's authority. DNS os.mythosprod.xyz resolves to 51.68.226.211 (MOS-1's 'no DNS record' claim was wrong and is corrected on the record in the architecture doc §10.0).

**Main purpose:** Operator-facing console for Mythos OS at os.mythosprod.xyz — one screen answering 'what is the control plane doing right now', reading live from the mythos-ai-executor API and its config files, storing nothing. Started as strictly read-only (MOS-1); MOS-2/MOS-2.1 added the first deliberate, allowlisted operational exceptions (start a mission, watch its full lifecycle, cancel a task). Approvals stay OUT of the web by design — the decision surface remains the owner-operated CLI service/mythos-governance-approve.js. Not to be confused with projects/command-center (the command library at ordre.mythosprod.xyz — different product, nothing shared).

**Technology / stack:** Plain Node http server (reference/server.js, no framework, no dependencies, no package.json, no build step) + vanilla-JS front end (reference/web/: index.html shell, mythos.css design system, console.css composition with zero colour literals, modules.js registry, app.js router/renderers, login-gate.js/css from MOS-1.8). systemd user service on deploy + nginx reverse proxy + certbot. Listens 127.0.0.1:8140 (MOS_PORT/MOS_BIND), talks to the executor at 127.0.0.1:8130 with a bearer token that never reaches the browser.

**Important folders:**

- `projects/mythos-os-console/reference` — The deployable app: server.js (GET/HEAD only answered — 405 to everything else before routing, with MOS-2's named exceptions allowlisted; static whitelist; security headers; CSP with the recorded Google-Fonts exception) and upstream.js (the only code that talks to anything; GET-only client; AGENT_FIELDS / TASK_DETAIL_* field allowlists so unrecognised upstream fields are dropped, pid/claude_session_id/working_directory never reach the browser; 4 MB response ceiling).
- `projects/mythos-os-console/reference/web` — modules.js is the scalability contract (14 modules registered, 8 built at MOS-1; planned modules render an honest not-built surface naming their blocker); app.js has one render function per module; console.css must contain no colour literal (test-enforced); login-gate.{js,css} are the MOS-1.8 temporary gate.
- `projects/mythos-os-console/tools` — deploy.sh (executes the §10.2 runbook with hard gates: token read without echo, loopback smoke test, POST-must-405 before exposure, nginx -t before reload, neighbouring sites checked, refuses to run off the real host), host-preflight.sh (checks every deployment precondition against the host, not against a document — created after the DNS-claim failure), contrast.js (WCAG 2.1, 26/26 AA, asserted by the suite), visual-verify.js (D-010 headless-browser gate, 499 checks; needs playwright, exits 2 without it).
- `projects/mythos-os-console/deploy` — nginx-os.mythosprod.xyz.conf (vhost source of truth; certbot rewrites the installed 443 block) and mythos-os-console.user.service (systemd user unit for deploy; starts WITHOUT a token by design, reporting token_provisioned:false — no write surface means no exposure).

**Important files:**

- `projects/mythos-os-console/reference/server.js` — Read-only property enforced structurally: 405 before routing, no request-body reader in the file, static whitelist; MOS-2/2.1 exceptions (POST /api/missions/start, /api/missions/<id>/cancel, plus GET mission detail/report relays) are individually named and allowlisted.
- `projects/mythos-os-console/reference/upstream.js` — GET-only upstream client; console routes map to executor routes (/api/missions→/tasks, /api/campaigns→/campaigns, /api/events→/events with limit clamped to 500 BEFORE reaching the control plane, /api/budget→/budget/<project> per project from config/projects.json); config-backed routes read agents.json/router.json/roadmap-state.json directly from disk.
- `projects/mythos-os-console/reference/web/modules.js` — Adding a module = one registry entry + one render function in app.js; nothing else changes. Registered-but-planned modules (Memory, Governance, Approvals, Secrets, Sandbox, Settings) each name their concrete blocker.
- `tests/mos-1-console-test.js` — Deterministic offline suite with a stub control plane: design-system fidelity read live out of css/main.css (drift alarm), source-level read-only/XSS/no-exec assertions, module-registry contract, HTTP failure semantics, token never in any response body.
- `projects/mythos-os-console/tools/deploy.sh` — The gated deployment script; stops at the one root-needing step (writing the vhost into /etc/nginx) and prints the commands instead of pretending.

**Related projects:**

- projects/mythos-ai-executor (its only data source: HTTP API on 127.0.0.1:8130 + config/*.json read from disk)
- projects/command-center (the OTHER 'command center' — the command library at ordre.mythosprod.xyz; name collision, nothing shared)

**Key documentation:** `docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md`, `docs/MYTHOS_OS_DESIGN_SYSTEM.md`, `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`, `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md (Phase 8)`, `docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md`, `docs/AI_HANDOVER.md (MOS-1.x/MOS-2/MOS-2.1 entries)`

**Important technical notes:** Run: MOS_EXECUTOR_TOKEN=… node projects/mythos-os-console/reference/server.js. Verify: node tests/mos-1-console-test.js; node projects/mythos-os-console/tools/contrast.js; node projects/mythos-os-console/tools/visual-verify.js (needs playwright); bash projects/mythos-os-console/tools/host-preflight.sh (VPS only). Env: MOS_PORT=8140, MOS_BIND=127.0.0.1, MOS_EXECUTOR_URL=http://127.0.0.1:8130, MOS_EXECUTOR_TOKEN or MOS_EXECUTOR_TOKEN_FILE (EXPECTED at /home/deploy/deployments/mythos-os-console/.env, 0600, outside the worktree), MOS_EXECUTOR_CONFIG_DIR, MOS_UPSTREAM_TIMEOUT_MS=8000. Core interface rule: an empty result and an unreadable one must never look alike (200 vs 503 upstream_unreachable / 502 upstream_unauthorized / 502 upstream_error / 503 config_unreadable; failure responses carry no data field). Dark-and-gold Mythos OS design system only — no light mode (D-001); gold accent reserved for 'a decision is waiting'. GOTCHA: the live production process is stale (pre-MOS-2 route tables) while index.html is re-read from disk per request, so served markup can reference routes/files the process cannot serve — the complete fix is the service restart, an operator action. Never hand-write the nginx 443 block; certbot owns it.

---

### Mythos AI Command Center (MCC-1)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/command-center`
- **Status:** MCC-1 (V1 command library) complete and deployed per docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md §11 (unit installed for the deploy user, hardening directives bisected on the real host; DNS record ordre.mythosprod.xyz → 51.68.226.211 was listed as 'NOT YET CREATED (owner action)' in that doc). Test suite tests/mcc-1-command-center-test.js: 502 assertions against a real PostgreSQL connection; refuses to run unless the DB name ends in _test. V2–V6 deliberately unimplemented (templates/workflow stepping, analytics, AI recommendation, n8n integration, AI-generated commands — the last gated by a mandatory human-approval loop; autonomous modification of the production library is not permitted).

**Main purpose:** A searchable, permanent library of the commands used to build and operate Mythos (AI instructions for Claude/Codex, verification procedures, stage gates), served at ordre.mythosprod.xyz. Priority actions: find a command, copy it, add a note. It NEVER executes a stored command — no child_process/exec/spawn/eval/Function anywhere in the runtime, asserted at source level by the test suite. Distinct from 'Mythos Control Center' (the future automation operator console, spec-only in docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md) — the Command Center is a command LIBRARY. Reads are public; writes require a bearer token; two public write exceptions (usage recording and placeholder rendering) can only move counters or return text. Commands carry safety classes (SAFE/READ_ONLY/WRITE/PRODUCTION/DESTRUCTIVE) with a warning dialog before DESTRUCTIVE/PRODUCTION text reaches the clipboard. No DELETE route exists anywhere — archiving is a reversible status change; version history is append-only.

**Technology / stack:** Node.js built-in http (no framework) + PostgreSQL via pg (only runtime dependency, per package.json) — parameterized SQL only, search_path pinned to schema mcc; vanilla JS/CSS front end with no build step (reference/web/: index.html, app.css, app.js, i18n.js — EN/FR complete, Arabic architecture-ready); user-scope systemd unit + nginx reverse proxy + certbot; database mythos_command_center (schema mcc, 13 tables) on the shared PostgreSQL container idauto-postgres at 127.0.0.1:5432, owner role mythos_command_center_owner.

**Important folders:**

- `projects/command-center/reference` — All nine runtime files (server, api, db, auth, secrets, variables, versioning + web/)
- `projects/command-center/deploy` — Deployed systemd user unit and nginx vhost — the sources of truth for the host configuration
- `projects/command-center/seed` — Seed library (24 commands, 26 categories, 6 projects, 35 relations, 3 workflows, 3 notes) and idempotent loader
- `projects/command-center/database` — Schema mcc — 13 tables, idempotent, never drops

**Important files:**

- `projects/command-center/reference/server.js` — Process entry point; binds 127.0.0.1 only (port from MCC_PORT, default 3021); refuses to start if MCC_ADMIN_TOKENS unset or any MCC_DB_* var missing; graceful SIGTERM pool drain
- `projects/command-center/reference/api.js` — HTTP API + static host; full endpoint table in docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md §4; sort whitelist; 512KB body limit; error opacity
- `projects/command-center/reference/db.js` — pg pool; REQUIRED_ENV = MCC_DB_HOST/MCC_DB_PORT/MCC_DB_USER/MCC_DB_PASSWORD/MCC_DB_NAME; search_path pinned to mcc; no raw SQL escape hatch
- `projects/command-center/reference/auth.js` — Bearer-token write auth: MCC_ADMIN_TOKENS maps tokens to identities, compared as SHA-256 digests via crypto.timingSafeEqual
- `projects/command-center/reference/secrets.js` — Credential-pattern gate on every write: HIGH severity (PEM key, AWS key ID, GitHub/Anthropic/OpenAI/Slack/Google tokens, JWT, connection string with inline password) = refused outright HTTP 422 with no override; MEDIUM (credential-shaped assignment) = warning only; matched text never echoed back or logged
- `projects/command-center/reference/variables.js` — {{PLACEHOLDER}} discovery and single-pass substitution (unfilled placeholders left visible, never blanked)
- `projects/command-center/reference/versioning.js` — MAJOR.MINOR bumping; append-only pre-edit snapshots into mcc_command_versions
- `projects/command-center/database/schema.sql` — 13 mcc_* tables incl. mcc_commands, generated search_vector (tsvector, simple config) + search_text (IMMUTABLE translate-based accent folding — the character map must stay in lockstep with api.js), mcc_usage_events append-only truth behind the denormalised usage_count
- `projects/command-center/deploy/mythos-command-center.user.service` — Deployed user-scope systemd unit; EnvironmentFile=/home/deploy/deployments/mythos-command-center/.env (mode 0600, outside worktree, holds MCC_DB_* and MCC_ADMIN_TOKENS); documents why ProtectKernelTunables/ProtectClock/MemoryDenyWriteExecute had to be removed (user-manager capability drops fail with status=218/CAPABILITIES; MDWE crashes the V8 JIT under load) and notes ssangyong-storefront.service is inactive for the same reason
- `projects/command-center/deploy/nginx-ordre.mythosprod.xyz.conf` — vhost source of truth, installed at /etc/nginx/sites-available/ordre.mythosprod.xyz; certbot rewrites the installed 443 block
- `projects/command-center/seed/load.js` — Idempotent non-destructive seeder (existing slugs skipped; --force-update to overwrite); runs the same secret gate as the API
- `projects/command-center/seed/library.json` — Seed content, every command's source field names the AGENTS.md sections it derives from; owner's original chat-session command texts are NOT in the repo — seeds are reconstructions

**Related projects:**

- projects/idauto (HTTP/db/systemd precedent followed)
- projects/ssangyong-autos (db.js and systemd unit precedent)
- projects/automation (the separate future Mythos Control Center reads the aut_* model, not this app)

**Key documentation:** `docs/MYTHOS_COMMAND_CENTER_ARCHITECTURE.md`, `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`

**Important technical notes:** Real commands (from README/architecture): run locally — env MCC_DB_HOST=127.0.0.1 MCC_DB_PORT=5432 MCC_DB_USER=mythos_command_center_owner MCC_DB_PASSWORD=... MCC_DB_NAME=mythos_command_center MCC_ADMIN_TOKENS='{"your-token":"owner"}' node projects/command-center/reference/server.js; test — same env with MCC_DB_NAME=mythos_command_center_test node tests/mcc-1-command-center-test.js (suite truncates tables, hard-aborts unless DB name ends in _test); seed — node projects/command-center/seed/load.js; operate on host — sudo -u deploy XDG_RUNTIME_DIR=/run/user/$(id -u deploy) systemctl --user status mythos-command-center (XDG_RUNTIME_DIR is required or systemctl --user misleadingly fails to connect), same pattern with journalctl --user -u mythos-command-center -n 50. Secrets are EXPECTED via EnvironmentFile /home/deploy/deployments/mythos-command-center/.env (0600, outside the git worktree) — MCC_DB_* and MCC_ADMIN_TOKENS; never committed, never logged. Storing credential-formatted content in the library is refused (422), and an ever-pasted real value must be treated as leaked and rotated. XSS defence: no innerHTML anywhere, CSP default-src 'self' with no inline script/style; front end token stored in localStorage and sent only as Authorization: Bearer to this origin. Deployment chain: ordre.mythosprod.xyz → nginx → 127.0.0.1:3021 → node server.js under systemd --user (deploy, lingering enabled) → PostgreSQL container idauto-postgres.

---

### Mythos Orchestrator

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/mythos-orchestrator`
- **Status:** IMPLEMENTED — docs/MYTHOS_ORCHESTRATOR_ARCHITECTURE.md header says 'Status: implemented'; covered by tests/mythos-orchestrator-0-test.js; exercised end-to-end (the architecture doc records the first e2e run and the sandbox fix it forced). Superseded-but-reused: the later mythos-ai-executor deliberately requires its lib/{redact,schema,git} rather than reimplementing them.

**Main purpose:** Provider-neutral delegation runtime (stage MYTHOS-MULTI-AGENT-ORCHESTRATOR-0): Claude is the orchestrator (architecture, planning, review, verification); Codex is an implementation worker (coding, tests, refactors). Delegation transfers execution, never accountability — Claude writes a task.json envelope, the worker returns result.json, and Claude re-derives every claim from Git before anything is reported complete. Flow: Claude → task.json → provider → result.json → Git → Claude verifies → report.

**Technology / stack:** Plain Node.js, zero dependencies (no package.json — lib/schema.js is a dependency-free JSON-Schema validator that fails loudly on unimplemented keywords). Providers: codex (real `codex exec` adapter, verified against codex-cli 0.147.0, uses --output-schema) and claude (never spawns a process — judgement work stays in the orchestrating session, per AGENTS.md §9). File-based state, bash notify.sh for best-effort ntfy.

**Important folders:**

- `projects/mythos-orchestrator/lib` — Shared safety libraries reused across the repo: schema.js (dependency-free validator), git.js (preflight: real worktree, not /tmp, branch != main/master, clean tree, baseline == HEAD, no branch collision), store.js (state root /home/deploy/mythos-orchestrator, override MYTHOS_ORCHESTRATOR_HOME), redact.js (masks tokens/JWTs/keys/connection strings; secret-bearing tasks are refused before dispatch).
- `projects/mythos-orchestrator/providers` — The ONLY place provider-specific behaviour may live: codex.js (spawns codex exec; --add-dir grants the main repo's Git dir only when delivery requires commit/push; never danger-full-access) and claude.js (retains judgement work in-session). Adding a provider = one adapter file + one enum value.
- `projects/mythos-orchestrator/schemas` — task.schema.json (structural safety in the schema itself: slug task_id, no /tmp working_directory, branch never main/master, result_path a bare filename, credential patterns refused) and result.schema.json.

**Important files:**

- `projects/mythos-orchestrator/router.js` — Deterministic table-lookup routing, no classifier: CLAUDE_CLASSES (ARCHITECTURE, DESIGN, SECURITY_REVIEW, FINAL_REVIEW, PORTFOLIO_DECISION, AMBIGUOUS_REQUIREMENTS, CROSS_PROJECT_DECISION), CODEX_CLASSES (CODE_IMPLEMENTATION, REFACTOR, TEST_IMPLEMENTATION, BUG_FIX, STATIC_ANALYSIS, MIGRATION_IMPLEMENTATION, CLI_TOOLING, REPETITIVE_CODE_CHANGES), APPROVAL_CLASSES (HIGH_RISK_INFRA, PRODUCTION_DEPLOYMENT, AUTH, DNS_MUTATION, DESTRUCTIVE_DB, SECRET_ROTATION). Defines LEVELS {AUTO:1, CLAUDE_CONTROLLED:2, USER_APPROVAL:3}; commit/push raises Codex work to level 2; allow_production_mutation forces level 3; unknown/unroutable class fails closed to USER_APPROVAL_REQUIRED; claudeOverride can only move work toward Claude/approval, never downward.
- `projects/mythos-orchestrator/runner.js` — Runs one task end to end (validate → route → safety gate → Git preflight → launch → capture result). Second and third enforcement points for level 3: validateTask() pushes LEVEL_3_NOT_AUTOMATIC for execution_level===3 and PRODUCTION_MUTATION_FORBIDDEN for allow_production_mutation, plus EXECUTION_LEVEL_MISMATCH / PROVIDER_MISMATCH against the router's derivation, plus SECRET_IN_TASK scanning of objective/instructions/notes/constraints. Invariant: a missing/malformed result is NEVER success — provider exit 0 only means the CLI ran.
- `projects/mythos-orchestrator/verifier.js` — Turns worker claims into evidence: commits exist, baseline is ancestor, branch exists locally/on origin, remote head matches, files_changed matches the real diff, required tests present and passed, no prohibited path touched, no secret in the diff. completed = schema-valid result AND all checks pass; otherwise verification_failed.
- `projects/mythos-orchestrator/orchestrator.js` — Public API: delegate / status / inspect / cancelSafe / doctor / list — what scripts/mythos-orchestrate.js drives.
- `projects/mythos-orchestrator/schemas/result.schema.json` — Result contract, deliberately restricted to the codex `--output-schema` structured-output subset (every property required, additionalProperties:false, nullability via type unions, no pattern/minLength). Statuses: completed|blocked|failed|cancelled; blocked_reason enum incl. approval_required. Semantic checks belong to verifier.js, not this file.
- `scripts/mythos-orchestrate.js` — The CLI Claude drives: node scripts/mythos-orchestrate.js delegate <task.json> [--dry-run] [--skip-fetch] | validate <task.json> | route <task.json> | verify <task.json> <result.json> | status [<task-id>] | inspect <task-id> [--lines N] | cancel-safe <task-id> | doctor. Meaningful exit codes Claude branches on: 0 verified, 1 usage, 2 rejected (schema/secret/provider mismatch), 3 blocked by safety/Git gate, 4 provider ran but task failed, 5 user approval required, 6 verification against Git failed.
- `projects/mythos-orchestrator/templates/codex-task.md` — Prompt rendered for a delegated worker.
- `tests/mythos-orchestrator-0-test.js` — Suite covering the invariants (missing result never success, worktree isolation, level-3 never automatic, redaction, cooperative SIGTERM-only cancellation).

**Related projects:**

- projects/mythos-ai-executor (requires this project's lib/{redact,schema,git} and follows the same file-store convention; its codex reference adapter is providers/codex.js here)
- projects/meta (development-lanes.json mirrors the risk levels)

**Key documentation:** `docs/MYTHOS_ORCHESTRATOR_ARCHITECTURE.md`, `docs/MYTHOS_ORCHESTRATOR_RUNBOOK.md`, `docs/AUTOMATION_APPROVAL_MATRIX.md`

**Important technical notes:** Safety levels: 1 AUTO (reads/audits/tests/docs/isolated non-destructive implementation), 2 CLAUDE_CONTROLLED (commits, pushes, branch creation — commit/push is level 2 even on an isolated branch because it changes shared remote state), 3 USER_APPROVAL (prod deployment, DNS/firewall, destructive DB, data/backup deletion, credential rotation, auth config, repo permissions, Jellyfin, Docker membership, stopping unrelated services — never automatic). Level 3 is enforced in three independent places: router escalates it, runner.validateTask refuses it, and execute never dispatches it. Runtime state lives OUTSIDE Git at /home/deploy/mythos-orchestrator/tasks/<task-id>/ (task.json, prompt.md, stdout.log, stderr.log, result.json, status.json; owned by deploy, mode 600/700, never /tmp; override MYTHOS_ORCHESTRATOR_HOME — tests do, production should not); notify log at /home/deploy/mythos-orchestrator/logs/notify.log. Daily workflow (runbook): user says 'Continue Mythos.'; delegated branches are agent/<stage-lowercase>/<task-id-short>; worktrees under /home/deploy/projects/worktrees/. ntfy topic is a capability secret in ~/.config/mythos-orchestrator/notify.env (mode 600, never in Git; the 2026-08-12 leak was fixed by rotation, not history rewrite). Cancellation is SIGTERM-only; orphaned (pid gone, no result) is distinct from failed. Troubleshooting codes: BASELINE_MISMATCH, DIRTY_WORKTREE, BRANCH_COLLISION, MISSING_RESULT, INVALID_RESULT, PROVIDER_UNAVAILABLE.

---

### Mythos AI Executor

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/mythos-ai-executor`
- **Status:** DEPLOYED AND OPERATIONAL on the VPS. Phase 2 core is the default execution path (MYTHOS_CORE_ENABLED defaults true; only exact string 'false' rolls back to Phase 1, per docs/MYTHOS_ORCHESTRATION_CORE.md §13, corrected 2026-08-17). Evidence: executorBridge ran real-quota missions end to end incl. a real 429 resume (docs/MYTHOS_FIRST_MISSION_REPORT.md); production goals run through POST /goals; cumulative budget ledgers enforced (core/budget.js); real multi-provider advisory execution via OmniRoute; independent multi-model review (docs/MYTHOS_CORE_WIRING_REVIEW.md, 2026-08-16) found and fixed 4 real defects (commits 64c8e4c, 00026a5), adversarial reviewers (Gemini 3.6 Flash, GPT-4o) both answered bypass_possible: false. Honest limits: claude-code remains the only execution authority; Gemini has no direct execution path; every project's committed budget is 0 except the mock-only sandbox; nothing auto-merges to main.

**Main purpose:** Persistent autonomous execution system, in two layers. Phase 1 (executor.js/server.js/lib/): a task is dropped in via authenticated n8n webhook or CLI, run through headless Claude Code (`claude -p` with pinned --session-id/--resume), surviving interruption and quota exhaustion, validating claims against Git, publishing durable reports. Phase 2 (core/, MYTHOS-ORCH-CORE): a full orchestration core built ON the unchanged Phase 1 — goal → planner → mission/task DAG → policy gate → scheduler with worktree isolation → provider router → validation (6 validators + adversarial reviewer ≠ author) → repair loop → report/memory. The autonomous-loop stage (core/{campaign,campaign-runner,roadmap}.js) closes the loop: read the Master Vision roadmap, pick the next safe capability, plan, execute, test in the mission's own worktree, review, accept on evidence, update roadmap, propose the next mission.

**Technology / stack:** Plain Node.js, no package.json; reuses projects/mythos-orchestrator/lib/{redact,schema,git} by require (one redaction/verification implementation in the repo). Providers: providers/claude-code.js (the ONLY provider with execution authority, headless claude -p), providers/openai-compat.js (advisory-only via the OmniRoute gateway at 127.0.0.1:20128/v1 — text in/out, no cwd, no tools), providers/gemini.js (UNCONFIGURED — activates only if ~/.config/mythos-ai-executor/gemini.env provides a real credential; none invented), providers/mock.js (tests only). systemd user service (runs as ubuntu with linger, NoNewPrivileges=true), HTTP API on 127.0.0.1:8130 (+172.18.0.1 for the n8n Docker bridge), bearer token from ~/.config/mythos-ai-executor/executor.env. n8n 2.29.9 (existing Docker instance, MYTHOS-namespace workflows committed as JSON under n8n/).

**Important folders:**

- `projects/mythos-ai-executor/core` — Phase 2 Orchestration Core: orchestrator.js (submitGoal, executorBridge to Phase 1), planner.js + dag.js (templates, Kahn cycle detection, unknown-field refusal), scheduler.js (bounded concurrency cap 8, policy gate before every dispatch), worktrees.js (branch mythos/<mission>/<task> per write-capable task), policy-engine.js (classes READ..DESTRUCTIVE; HARD_FLOOR ROOT/DESTRUCTIVE deny — no config can loosen), provider-router.js + reputation.js (quota-aware routing, authority never changes on fallback), validation.js (6 validators + adversarial reviewer, author excluded), memory.js + context.js (12-category project memory, relevance-only context under a hard budget, secrets REFUSED), budget.js (cumulative REQUEST→MISSION→PROJECT/DAY ledgers), events.js (durable JSONL event stream), self-improve.js (caged self-development; protected-surface missions refused, real diff re-checked), campaign.js/campaign-runner.js/roadmap.js (the autonomous loop; campaign.js itself on the protected list), store.js/domain.js (transition-table-enforced states).
- `projects/mythos-ai-executor/lib` — Phase 1: state.js (persistent store + state machine, atomic writes), quota.js (quota/transient/blocked/fatal classification, reset-time parsing, 30m/1h/2h/4h backoff), policy.js (execution profiles → exact Claude tool permissions: repo-read, repo-write, autonomous, deploy [disabled]; Bash(sudo:*) denied in every profile), report.js (mythos_report extraction/validation/rendering).
- `projects/mythos-ai-executor/config` — Registries and policy: agents.json, router.json (advisory fallback lists; execution tasks always wait_for_quota), policy.json, budgets.json, projects.json, tools.json, roadmap-state.json (autonomous-loop progress, in Git — evidence-only updates {commit, tests}). Also read directly by the os-console.
- `projects/mythos-ai-executor/providers` — executionAuthority split: claude-code.js is the only execution runtime; openai-compat.js is advisory (OmniRoute); gemini.js exists architecturally but UNCONFIGURED; mock.js unreachable in production.
- `projects/mythos-ai-executor/n8n` — Committed MYTHOS workflows (credentials by id reference only): mythos-goal-intake, mythos-task-intake, mythos-execute-task, mythos-campaign-autopilot (continues campaigns every 10 min, branching only on continuable/needs_human computed by core/campaign-service.js — n8n never evaluates policy), mythos-quota-watch, mythos-failure-handler, mythos-report.
- `projects/mythos-ai-executor/service` — mythos-ai-executor.service (systemd user unit; ExecStart runs bin/mythos-ai-executor serve), mythos-git-push.{service,timer,sh}, mythos-governance-approve.js (the OWNER-OPERATED approval CLI — approvals deliberately never got a web surface), governance-verify.js.

**Important files:**

- `projects/mythos-ai-executor/executor.js` — Phase 1 core engine: create/run/resume tasks, scheduler tick (15s), health. Task lifecycle QUEUED → RUNNING → COMPLETED|FAILED|BLOCKED|WAITING_FOR_QUOTA|WAITING_RETRY|CANCELLED via transition table; quota exhaustion is never failure.
- `projects/mythos-ai-executor/server.js` — HTTP API — DEFAULT_PORT 8130, binds 127.0.0.1 + 172.18.0.1 (n8n Docker bridge); bearer auth on everything except /health. Endpoints incl. /tasks, /campaigns, /campaigns/<id>/continue, /goals, /events?after_seq=, /budget/<project>.
- `projects/mythos-ai-executor/bin/mythos-ai-executor` — CLI: enqueue / run / resume / status / report / list / health / serve.
- `projects/mythos-ai-executor/core/campaign.js` — Autonomous loop + governance cage (3 barriers: selection excludes governance capabilities; declared scope/objective parking with path normalisation; real git diff --name-only checked after implementation). resolveApproval() requires a human decider — nothing in the loop calls it.
- `projects/mythos-ai-executor/schemas/task.schema.json` — Task contract; carries no credentials, refuses /tmp.
- `tests/mythos-ai-executor-test.js` — Phase 1 suite.
- `tests/mythos-orchestration-core-test.js` — Phase 2 suite (offline, mock providers, zero real AI quota; acceptance tests A–S).
- `tests/mythos-autonomous-campaign-test.js` — Autonomous-loop suite (offline, mock agents, no real quota/money).
- `tests/mythos-core-wiring-test.js` — Regression tests for the 4 core-wiring defects (cancellation race, self-signal, supersession, daemon/core race).

**Related projects:**

- projects/mythos-orchestrator (libs reused by require; codex adapter is the reference for adding an execution-capable provider)
- projects/mythos-os-console (reads this executor's API and config files)
- projects/automation
- projects/personal-intelligence

**Key documentation:** `docs/MYTHOS_AI_EXECUTOR_ARCHITECTURE.md`, `docs/MYTHOS_ORCHESTRATION_CORE.md`, `docs/MYTHOS_AUTONOMOUS_LOOP.md`, `docs/MYTHOS_MVP_OPERATION.md`, `docs/MYTHOS_CORE_WIRING_REVIEW.md`, `docs/MYTHOS_AI_ORCHESTRATOR_MASTER_VISION.md`, `docs/MYTHOS_BUDGET_LEDGER.md`, `docs/MYTHOS_FIRST_MISSION_REPORT.md`, `docs/MYTHOS_N8N_STRATEGY.md`

**Important technical notes:** Runtime state (outside Git, never /tmp): Phase 1 tasks /home/ubuntu/mythos-ai-executor/tasks/<id>/; Phase 2 orchestration + campaigns /home/ubuntu/mythos-ai-executor/orchestration/ (+/campaigns/); mission worktrees /home/ubuntu/mythos-ai-executor/worktrees/<mission>/<task>/. NOTE: this runs as user ubuntu — distinct from the orchestrator's /home/deploy/mythos-orchestrator/ (user deploy). Operate per docs/MYTHOS_MVP_OPERATION.md: POST /campaigns with objective only (idempotent — a live campaign is returned with created:false; provider/profile/cwd are never accepted from callers); watch via GET /campaigns/<id> and /events?after_seq=; approvals only via node -e "require('./projects/mythos-ai-executor/core/campaign').resolveApproval(...)" with a human decided_by; stop via systemctl --user stop mythos-ai-executor (state is durable on disk). Executor COMPLETED maps to core VALIDATING — a result is a claim to verify, never a trusted completion. Mission commits land on mythos/<mission>/<task> branches, never auto-merged to main. Bearer token EXPECTED in ~/.config/mythos-ai-executor/executor.env (0600) — never print or commit. Known open item (documented): cost figures are runner-declared, reputation has little history, PROJECT all-time budget scope not exercised.

---

**— Automotive vertical —**

### ID Auto (idauto.tn)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/idauto`
- **Status:** REPOSITORY_VERIFIED, beyond FOUNDATION for infrastructure but not deployed as a service. Per docs/IDAUTO_ROADMAP.md + docs/AI_HANDOVER.md: IDA-0/IDA-1 complete (2026-08-05); IDA-2 'Phase B engineering complete with explicit exceptions' (2026-08-11 deep audit) — IDA-2A schema+plate validation, IDA-2B live PostgreSQL (22 tables applied, backup restore-tested), IDA-2C read-only API, IDA-2D write API + atomic audit, IDA-2E-PRE identity stub, IDA-2F object storage, IDA-2G admin UI, IDA-2H review UI all complete; full IDA-2E (real Mythos OS auth) BLOCKED — no real auth service exists in the codebase; IDA-2I rate limiting deferred into IDA-3. IDA-3 design gate decided 2026-08-12 (docs/IDA3_INGESTION_ARCHITECTURE.md, binding) and slices IDA-3A (ingestion schema — DB now 24 tables), IDA-3B (pure ingestion service), IDA-3C (rate limiting, owner decisions §14.1), IDA-3D (private admin-only ingest route), IDA-3E (admin review queue + legacy fact backfill, owner decision §14.2) all COMPLETE 2026-08-12 per AI_HANDOVER implementation records. IDA-3F off-host backup: tooling implemented and tested (35/35) but stage BLOCKED/DEFERRED by owner decision 2026-08-12 (Cloudflare R2 billing); IDA-3G/3H/3I gated behind it. PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO. Reference API/UIs are not deployed or publicly reachable. Note: docs/MYTHOS_PORTFOLIO_REGISTRY.md (2026-08-06) still says 'IDA-1 complete / IDA-2 next' — stale relative to AI_HANDOVER.

**Main purpose:** Progressively enriched, privacy-respecting vehicle-intelligence platform for Tunisia: canonical vehicle identity (vehicle_id), plates, observation-first capture (every capture creates an Observation; facts never silently overwritten), verified facts with evidence, review queue, future Fixpert Smart Gate ANPR (IDA-4). Non-negotiable privacy contract: no owner PII columns anywhere, no join path from plate to owner. Three access scopes: PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE.

**Technology / stack:** Node.js (no framework — built-in `http`), single runtime dependency `pg` ^8.13.1 (package.json '@mythos/idauto'); PostgreSQL 15 (live `idauto-postgres` docker container, postgres:15-alpine, 127.0.0.1:5432, mem-capped 384m); plain HTML/CSS/JS admin and review UIs (no build step); content-addressed local filesystem media store at /home/deploy/deployments/idauto-media (SHA-256 keys); provider-neutral SigV4 S3-compatible off-host backup tooling in ops/.

**Important folders:**

- `projects/idauto/reference` — The runtime: api.js (GET+POST API, admin-token gated, mythos_private read-exclusion), db.js (pg pool, parameterized only), writes.js (single withAudit() transaction helper — data+audit commit atomically), identity.js (IDA-2E-PRE operator-provisioned token→identity map), storage.js (content-addressed media store), plate-validator.js (config-driven 7 draft Tunisian plate formats), ingestion.js (IDA-3B pure submission service with trust routing), rate-limit.js (IDA-3C fixed-window PG counters, per-class limits), review-ui.js/review.html (IDA-2H + IDA-3E review queues), admin.html/admin-ui.js/admin.css (IDA-2G), IDENTITY_ADAPTER.md (identity contract spec: actor_ref must be usr_<uuidv7>)
- `projects/idauto/database` — schema.sql (22-table IDA-2 Phase A migration source, applied live in IDA-2B; no owner-PII column by contract), migrations/ida-3a-ingestion-schema.sql (adds idauto_submissions + idauto_rate_limit_counters + media.derived_from_media_id → live DB at 24 tables), seed-synthetic-test-data.sql (explicitly synthetic)
- `projects/idauto/ops` — media-ops.js (audit | backup | verify-backup | restore-dry-run | restore; no delete command by design; exit codes 0/1/2/3), offhost-backup.js (stage | manifest | verify-local | push | verify-remote | list | retention | restore-verify, [--dry-run]) and adapters/s3-compatible.js (SigV4 transport, R2-ready)

**Important files:**

- `projects/idauto/README.md` — Vision, privacy contract, three access scopes, observation-first model, plate-format table (all marked UNVERIFIED DRAFTS), Smart Gate scope (1 of 5 Fixpert cameras, MYTHOS_PRIVATE, legal approval required)
- `docs/IDAUTO_ROADMAP.md` — Authoritative per-slice IDA-2 record (2A..2I with what each shipped, the IDA-2E blocker finding, carried-forward exceptions) plus IDA-3..IDA-6 plans and the LEGAL-REVIEW-REQUIRED table
- `docs/IDA3_INGESTION_ARCHITECTURE.md` — Binding IDA-3 design: v1 submission boundary, trust model (no auto-accept for non-admin), net schema delta of 2 tables + 1 column, dedup classes ('collapse bytes, never claims'), anonymous = NULL actor_ref, rate-limit store decision (dedicated PG table, idauto_verifications rejected), threat model, EXIF-strip-only media rule (no decoding), staged-transaction atomicity, owner decisions §14.1 (rate-limited request writes audit only; idempotency resolved before limiter) and §14.2 (unreviewed community facts are mythos_private until reviewer accepts), rollout phases 3A–3I, decision gates (PUBLIC_ENDPOINT_READY_TO_IMPLEMENT = NO)
- `docs/IDAUTO_TEST_RUNBOOK.md` — Exact live-test procedure: run as `deploy` from repo root, source /home/deploy/deployments/idauto-postgres/.env, export IDAUTO_DB_* + IDAUTO_MEDIA_STORAGE_PATH, then `node tests/<suite>-test.js` per suite; six IDA-2 suites expected 195 passed (2A 44 · 2C 26 · 2D 39 · 2F 32 · 2G 17 · 2H 37); §5 explains env-failure vs real regression
- `docs/IDAUTO_STORAGE_RUNBOOK.md` — media-ops.js command reference and safety properties (restore refuses live store/repo/system paths, never overwrites differing bytes, no delete/prune), backup artifact format, restore order (media first, then DB)
- `projects/idauto/.env.example` — Env contract: IDAUTO_DB_HOST/PORT/USER/PASSWORD/NAME, IDAUTO_API_PORT (3001), IDAUTO_ADMIN_IDENTITIES JSON token→identity map (explicitly NOT real auth). Real credentials live outside the repo
- `docs/IDAUTO_ARCHITECTURE.md` — Architecture decisions, logical schema separation (mythos_core / idauto / atelier_network / fixpert), §4.1 mythos_auth contract (unimplemented — the IDA-2E blocker), data flows incl. Smart Gate
- `docs/OFF_HOST_BACKUP_GATE.md` — Operational runbook for off-host backups reusing the IDA-3F tooling ('no new tooling — not rclone, not aws'); header says PREPARED·BLOCKED but §6/gate table records GATE CLOSED 2026-08-14 (owner-declared, batch 20260814T161856Z) — AI_HANDOVER itself flags the stale header

**Related projects:**

- projects/automotive (umbrella Pillar A; ID Auto owns the canonical vehicle_id all pillars reference)
- projects/atelier-network (ATN work orders reference idauto vehicle_id; ATN-1 must register Fixpert before IDA-4 Smart Gate)
- projects/autovaleur (consumes identity/facts; shared access_scope naming)
- projects/ssangyong-autos (separate DB on the same PG host; explicitly 'shares nothing' with idauto; its reference API deliberately follows the projects/idauto/reference precedent)
- Fixpert (external pilot; fixpert schema documented but never created by this repo)

**Key documentation:** `docs/IDAUTO_PRODUCT_SPEC.md`, `docs/IDAUTO_CAPTURE_PIPELINE.md`, `docs/IDAUTO_FIXPERT_INTEGRATION.md`, `docs/IDAUTO_ARCHITECTURE.md`, `docs/IDAUTO_ROADMAP.md`, `docs/IDA3_INGESTION_ARCHITECTURE.md`, `docs/IDAUTO_STORAGE_RUNBOOK.md`, `docs/IDAUTO_TEST_RUNBOOK.md`, `docs/OFF_HOST_BACKUP_GATE.md`, `docs/MYTHOS_IDENTITY_ARCHITECTURE.md`, `docs/AI_HANDOVER.md`

**Important technical notes:** Verified test suites in tests/: ida-2a, ida-2c, ida-2d, ida-2f, ida-2g, ida-2h, ida-3a..ida-3e, ida-3f-offhost-backup, idauto-storage-ops — all run `node tests/<name>-test.js`; most need the live DB env and MUST run as user `deploy` (media dir is mode 750 deploy:deploy — an EACCES here is an environment problem, not a bug). Ops commands: `node projects/idauto/ops/media-ops.js audit|backup|verify-backup|restore-dry-run|restore` and `node projects/idauto/ops/offhost-backup.js stage|manifest|verify-local|push|verify-remote|list|retention|restore-verify [--dry-run]`. Key invariants: every mutation goes through writes.js withAudit() (audit row in the same transaction, fails closed without identity); non-admin reads always exclude access_scope='mythos_private'; unreviewed community facts are written mythos_private (owner decision §14.2); rate-limit bucket keys are SHA-256 (no raw IP in the counters table); live-test fixtures accumulate by design (per-run-unique fixtures required). Standing owner prohibition while IDA-3F is deferred: do not create an R2 bucket/credentials, activate billing, configure ~/.config/mythos/idauto-offhost.env, run remote push/restore, schedule backups, or start IDA-3G. External-repo relationship: no `othoth77/idauto` repository is referenced anywhere in this monorepo's docs or code (grep-verified) — any relationship between projects/idauto and a standalone othoth77/idauto GitHub repo is UNVERIFIED and not stated in repository documentation.

**Deployment / infrastructure:** Live infrastructure exists but no public service: idauto-postgres container (PG 15, 127.0.0.1:5432 only, mem_limit 384m) with 24 idauto_ tables and synthetic/seed data (~2637 rows at the 2026-08-16 measurement); media store at /home/deploy/deployments/idauto-media; PG backup restore-tested (AGENTS.md §16). The reference API (port 3001) and admin/review UIs are NOT deployed or publicly reachable — operator-token gated, run ad hoc. Public blockers on record: off-host backup (IDA-3F deferred), legal/consent review (IDA-3G), real auth (IDA-2E). Credentials at /home/deploy/deployments/idauto-postgres/.env (never commit/print).

---

### Mythos Automotive (umbrella)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/automotive`
- **Status:** FOUNDATION (REPOSITORY_VERIFIED). MAE-0 complete, amended by ATN-0 (2026-08-05) — evidence: README, docs/AUTOMOTIVE_ROADMAP.md, registry row 'MAE-0 complete, MAE-1 next (blocked on IDA-2)'. AI_HANDOVER.md (through 2026-08-15/16) confirms MAE-1 remains gated on IDA-2. No deployment, no real data.

**Main purpose:** Portfolio, governance and integration layer connecting the automotive products — not an application itself. Defines the vehicle-centric digital chain (ID Auto identity → AutoValeur valuation → AutoCheck inspection → repair → parts → workshop → revised valuation → AutoMarket sale) for the Tunisian market. Core four pillars: ID Auto, Atelier Network, Parts Network (ssangyong.autos), AutoValeur; Mythos OS is the platform beneath them. Owns cross-product rules: canonical vehicle_id belongs to ID Auto only, one writer per business noun, no product duplicates another's operational records.

**Technology / stack:** Documentation + draft artifacts only: draft PostgreSQL control-plane schema (31 tables, all `mythos_automotive_` prefix, schema `mythos_automotive`, 'DRAFT — NOT DEPLOYED') and automotive.example.json (ecosystem config, all feature flags false). No runtime code, no tests.

**Important folders:**

- `projects/automotive/config` — automotive.example.json — ecosystem-level config draft: products registry, access scopes, shared services, architecture decisions, vehicle taxonomy, canonical identifiers, all 11 ecosystem feature flags false
- `projects/automotive/database` — control-plane-schema.sql — 31-table draft (products, product_stages, stage_gates, architecture_decisions, integration_contracts, legal_requirements, risk_register, KPI definitions/snapshots, feature_flags, domain_events, service_providers, audit_events, …), the governance/registry data model

**Important files:**

- `projects/automotive/README.md` — Umbrella identity ('La chaîne automobile numérique'), vehicle-centric digital chain diagram, current product portfolio with stages, ownership-boundaries matrix, next-stage sequencing (IDA-2 → then ATN-1/AVA-1 parallel, MAE-1 after)
- `docs/AUTOMOTIVE_ROADMAP.md` — Operating principle 'one major implementation stage at a time', stage naming (MAE/ATN/IDA/AVA/PNW/AMK/FLT/AST), full cross-product dependency map
- `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md` — Per-pillar specification incl. Fixpert (external, no runtime code in repo) and Parts Network (ssangyong.autos described as external as of 2026-08-05 — predates the later in-repo projects/ssangyong-autos work); AutoValeur stores parts-price snapshots, never a synced catalogue copy
- `docs/AUTOMOTIVE_DATA_GOVERNANCE.md` — Master data-ownership matrix — each entity has exactly one owner; all other products hold references
- `docs/AUTOMOTIVE_RISK_REGISTER.md` — Portfolio risk register; e.g. R-T03 (access_scope naming divergence) was resolved by IDA-2A-CORRECTION-0

**Related projects:**

- projects/idauto (Pillar A — canonical vehicle_id)
- projects/atelier-network (Pillar B)
- projects/ssangyong-autos + external ssangyong.autos site (Pillar C, Parts Network)
- projects/autovaleur (Pillar D)
- Mythos OS core (auth/roles/audit/billing platform beneath the pillars)

**Key documentation:** `docs/AUTOMOTIVE_VISION.md`, `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md`, `docs/AUTOMOTIVE_ARCHITECTURE.md`, `docs/AUTOMOTIVE_INTEGRATION_CONTRACTS.md`, `docs/AUTOMOTIVE_DATA_GOVERNANCE.md`, `docs/AUTOMOTIVE_OPERATING_MODEL.md`, `docs/AUTOMOTIVE_KPI_MODEL.md`, `docs/AUTOMOTIVE_RISK_REGISTER.md`, `docs/AUTOMOTIVE_ROADMAP.md`, `docs/MYTHOS_PORTFOLIO_REGISTRY.md`

**Important technical notes:** All nine AUTOMOTIVE_*.md docs carry stage header 'ATN-0 … Amendment (amends MAE-0)', last updated 2026-08-05. KPI doc explicitly defines formulas only — no current values. Key permanent rules: only ID Auto creates/merges/retires vehicle fiches; asking price vs completed-sale price separated at ingestion (AD-A3); integration is service-consumption via defined contracts, never shared tables. The AUTOMOTIVE docs' 'Current stage: IDA-1 complete / IDA-2 next' rows are stale relative to docs/AI_HANDOVER.md (IDA-2B–2H and IDA-3A–3E have since completed).

**Deployment / infrastructure:** Nothing deployed for the umbrella (control plane is a draft; 'No PostgreSQL installed' for this product's schema). Per docs, MAE-1 (Shared Platform Spec) follows IDA-2 completion; MAE-2 Control Plane Alpha would be the first umbrella runtime.

---

### Mythos Atelier Network

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/atelier-network`
- **Status:** FOUNDATION (REPOSITORY_VERIFIED per docs/MYTHOS_PORTFOLIO_REGISTRY.md). ATN-0 complete 2026-08-05 (evidence: README, ATELIER_NETWORK_ROADMAP.md, schema.sql header). ATN-1 (Core API, Workshop Registry, first integration) is the next stage and is explicitly blocked on IDA-2 / the shared PostgreSQL cluster; AI_HANDOVER.md entries through 2026-08-15/16 still record 'ATN-1/AVA-1/MAE-1 gated on IDA-2'. No PostgreSQL objects created for this product, no workshop onboarded, no real data.

**Main purpose:** Generic multi-workshop platform of the Mythos Automotive ecosystem: workshop registry (organisations/workshops/sites), network membership and governance, service catalogue, inspection-provider accreditation, AutoCheck standard governance, integration connectors (NATIVE_MANAGED / EXTERNAL_CONNECTED / HYBRID), Smart Gate device registry, network audit events. Fixpert is the first workshop pilot (external system, integration mode TBD in ATN-1). Workshop operational data and customer PII stay with each workshop organisation; Smart Gate observations belong to ID Auto, not Atelier Network.

**Technology / stack:** Documentation + draft artifacts only: draft PostgreSQL schema (24 tables, all `atn_` prefix, schema `atelier_network`, explicitly 'DRAFT — NOT DEPLOYED') and a JSON config draft (all feature flags false). No runtime code, no package.json, no tests, no deployment.

**Important folders:**

- `projects/atelier-network/config` — atelier-network.example.json — ATN-0 config draft: product identity (key atelier_network, status FOUNDATION), 9 roles, workshop types, integration modes, AutoCheck + Smart Gate sections, all feature flags false
- `projects/atelier-network/database` — schema.sql — 24-table draft schema (atn_workshop_organizations … atn_audit_events), multi-tenant hierarchy org→workshop→site, no customer-PII columns (AD-ATN-2), cross-schema references without FKs (vehicle_id_ref to idauto)

**Important files:**

- `projects/atelier-network/README.md` — Product identity, core responsibilities table, workshop types, integration modes, multi-tenant hierarchy, AutoCheck branding rules, ATN-0 data-status (nothing deployed), next-stage gate (IDA-2 before ATN-1)
- `projects/atelier-network/database/schema.sql` — The full ATN-0 data model draft; header documents ownership boundaries (vehicle_id is idauto's, Smart Gate observations go to ID Auto) and 'NOT DEPLOYED' status
- `docs/ATELIER_NETWORK_ARCHITECTURE.md` — Architecture decisions AD-ATN-1..7: org-level tenant isolation, no global customer DB, vehicle identity via ID Auto only, one-writer-per-noun, plus integration contracts, 19 domain events, canonical identifiers
- `docs/ATELIER_NETWORK_ROADMAP.md` — ATN-0..ATN-5 stage plan with dependency map (IDA-2 → ATN-1 → ATN-2 → ATN-3 → ATN-4 → ATN-5; ATN-1 enables AVA-2) and LEGAL-REVIEW-REQUIRED table (R-L06 inspection-liability wording blocks ATN-1/ATN-2)
- `docs/AUTOCHECK_STANDARD.md` — AutoCheck v0.1-draft: provider-neutral inspection standard governed by Atelier Network — branding rules ('AutoCheck by Fixpert', never 'Expertise légale certifiée'), accreditation via atn_workshop_accreditations, 17 mandatory sections, ratings (PASS/PASS_WITH_NOTES/FAIL/INCOMPLETE), repair-estimate output consumed by AutoValeur, mandatory ID Auto vehicle_id linkage before report issue

**Related projects:**

- projects/automotive (umbrella; Atelier Network is Core Pillar B)
- projects/idauto (vehicle_id is the only vehicle identity; atn_work_orders.vehicle_id_ref → idauto; IDA-4 Fixpert Smart Gate pilot precedes ATN-4)
- projects/autovaleur (AVA-2 consumes the ATN repair-estimate API)
- Fixpert (external, OWNER_DIRECTION, no code in this repo — first EXTERNAL_CONNECTED pilot)

**Key documentation:** `docs/ATELIER_NETWORK_PRODUCT_SPEC.md`, `docs/ATELIER_NETWORK_ARCHITECTURE.md`, `docs/ATELIER_NETWORK_ROADMAP.md`, `docs/AUTOCHECK_STANDARD.md`, `docs/MYTHOS_PORTFOLIO_REGISTRY.md`, `docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md`

**Important technical notes:** Schema conventions to preserve when ATN-1 starts: all tables `atn_`-prefixed in schema `atelier_network`; no cross-schema FKs (application-layer integrity); opaque `customer_org_ref` instead of PII columns; NETWORK_SUPER_ADMIN access must be audit-logged in atn_audit_events. AutoCheck accreditation is per-organisation, not per-site. No test suite or runnable command exists for this project yet — ATN-1 plans '50+ automated tests'.

**Deployment / infrastructure:** Nothing deployed. No PostgreSQL objects, no service, no workshop, no inspection data; all feature flags false. Deployment requires explicit ATN-1 authorisation and (per README) IDA-2 must first provision and prove the shared PostgreSQL cluster; legal reviews (R-L06, onboarding agreement, DPA, ATN→AutoValeur data-sharing basis) are named pre-ATN-1 blockers.

---

### AutoValeur

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/autovaleur`
- **Status:** FOUNDATION (REPOSITORY_VERIFIED). AVA-0 complete 2026-08-05 (evidence: README, docs/AUTOVALEUR_ROADMAP.md, schema.sql header). AVA-1 (Public Calculator MVP) is next but requires IDA-2 complete plus legal review of the AVA-1-blocking items; AI_HANDOVER.md through 2026-08-15/16 records AVA-1 still gated on IDA-2. No valuation engine, no API, no data ingested.

**Main purpose:** Independent vehicle valuation and Tunisian used-car market-intelligence product. Three versions: Public (range + quick-sale price + confidence for anyone), Pro (professional purchase/resale prices, margins, bulk fleet valuation, API), Intelligence (MYTHOS_PRIVATE deal radar, acquisition pipeline, predicted-vs-realised margin — never a public tracking/profiling service). Every result is a range with ~17 supporting metrics, never a single number, always with model version and confidence.

**Technology / stack:** Documentation + draft artifacts only: draft PostgreSQL schema (18 tables, `autovaleur_` prefix, 'NOT INSTALLED OR DEPLOYED — AVA-0 draft') and autovaleur.example.json (v0.1.0-ava0-draft, all feature flags false). No runtime code, no tests.

**Important folders:**

- `projects/autovaleur/config` — autovaleur.example.json — product identity/tagline, product versions, valuation outputs and factors, comparable engine, liquidity/opportunity score, deal radar, integrations, model governance sections; all flags false
- `projects/autovaleur/database` — schema.sql — 18-table draft: model_versions/evaluations, source_catalogue, market_listings, listing_price_snapshots, valuations, valuation_inputs, comparables, condition_reports, repair_estimates(+lines), parts_quotes, liquidity/opportunity scores, deal_alerts, deal_pipeline, transactions, audit_events

**Important files:**

- `projects/autovaleur/README.md` — Product versions, 15-row valuation-output table, ecosystem integrations table (Mythos OS, ID Auto, Fixpert Atelier, ssangyong.autos, future marketplace), AVA-0 data-status, AVA-1 scope
- `docs/AUTOVALEUR_ROADMAP.md` — AVA-0..AVA-6 stage plan with prerequisites (AVA-1 needs IDA-2; AVA-2 needs ATN-1 repair-estimate API; AVA-3 authorised feeds not scraping; AVA-4 Deal Radar invariants: no auto purchase, no auto seller contact, human review mandatory) and 17-item LEGAL-REVIEW-REQUIRED table
- `docs/AUTOVALEUR_ARCHITECTURE.md` — Ownership boundaries (consumes ID Auto identity, ATN inspection data, external market data; owns valuations/comparables/scores/pipeline/model versions), AD-A1..A8, integration contracts, data flows for public valuation / repair estimate / Deal Radar
- `docs/AUTOVALEUR_PRODUCT_SPEC.md` — Full spec: comparable engine, liquidity score (7 factors/5 classes), opportunity score (8 dimensions), Deal Radar 10-step pipeline, model governance, 11 fraud-resistance protections, access/privacy scopes

**Related projects:**

- projects/idauto (vehicle identity + verified facts input; canonical access_scope naming shared — ID Auto renamed visibility_scope→access_scope to match AutoValeur, R-T03)
- projects/atelier-network (AVA-2 consumes ATN repair-estimate API; AutoCheck estimate feeds post-inspection valuation)
- projects/ssangyong-autos / ssangyong.autos (spare-parts price lookup planned in AVA-2, snapshot-at-quote-time rule)
- projects/automotive (umbrella Pillar D)

**Key documentation:** `docs/AUTOVALEUR_PRODUCT_SPEC.md`, `docs/AUTOVALEUR_ARCHITECTURE.md`, `docs/AUTOVALEUR_ROADMAP.md`, `docs/AUTOCHECK_STANDARD.md`, `docs/MYTHOS_PORTFOLIO_REGISTRY.md`

**Important technical notes:** Non-negotiables encoded in the spec: valuations are immutable snapshots with mandatory model_version; asking vs completed-sale prices always separated; mandatory public disclaimer 'Estimation uniquement, pas une expertise légale certifiée'; Intelligence tier is MYTHOS_PRIVATE and audit-logged. Schema is a design document — 'Do not execute against any database until AVA-1 with explicit authorisation'. No runnable commands or tests exist yet (AVA-1 will introduce them).

**Deployment / infrastructure:** Nothing deployed; PostgreSQL selected as target DBMS but not installed for this product. AVA-1 scope is deliberately narrow: manual entry form, transparent rule-based engine, synthetic/authorised dataset only, no scraping, no Deal Radar.

---

### SsangYong Parts (SSANGYONG.AUTOS)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/ssangyong-autos`
- **Status:** REPOSITORY_VERIFIED with a live (loopback-only) deployed database. Per README (2026-08-16) and docs/AI_HANDOVER.md stage records: Stage 3 schema design → Stage 4 offline migration dry-run → Stage 5 Phase 1+2 (dedicated DB + role provisioned) → Stage 5 Phase 3 CATALOG DEPLOYED 2026-08-16, owner-authorised (schema executed verbatim byte-identical to HEAD; import.sql committed; validation.sql 18/18 pass; 1519 rows live) → Stage 5 doc-debt closure → SYA-API-1 (read-only catalog API, 60/60 live tests) → SYA-SHOP-1 (owner ratified migration-plan §22 option 3: new storefront consumes the catalog natively, legacy site untouched/retired later; options 1 and 2 rejected) → SYA-SHOP-1b (headless-Chrome visual verification; three real layout defects found and fixed; storefront suite 41/41). Nothing publicly exposed: no nginx block, no service unit, loopback only. Note: docs/MYTHOS_PORTFOLIO_REGISTRY.md (2026-08-06) still lists SsangYong Parts as OWNER_DIRECTION / BLOCKED with 'no runtime code in this repository' — stale; the runtime code, deployed schema and live data postdate it (evidence: projects/ssangyong-autos/*, AI_HANDOVER stage entries).

**Main purpose:** Spare-parts catalog product for SsangYong vehicles (Parts Network pillar's first concrete in-repo system): a deployed PostgreSQL catalog of 346 canonical parts scraped from autopart.tn with vehicle fitment (17 models, 63 motorizations, 782 compatibility rows, 311 images), a GET-only catalog API (SYA-API-1), and a French, vehicle-first storefront (SYA-SHOP-1). Consultation only — ordering is deliberately not implemented (no order/customer/payment tables). Distinct from the legacy ssangyong.autos MariaDB website, which is frozen and untouched.

**Technology / stack:** Node.js (built-in `http`, no framework, no build step), single dependency `pg` ^8.13.1 ('@mythos/ssangyong-autos'); PostgreSQL 15.18, database `ssangyong_autos` at 127.0.0.1:5432 owned by dedicated non-superuser role `ssangyong_autos_owner`; plain HTML + one CSS + one JS storefront; stdlib-only Python migration generator (generate_import.py).

**Important folders:**

- `projects/ssangyong-autos/reference` — Runtime: db.js (read-only pg pool — every connection opens default_transaction_read_only=on so PostgreSQL itself refuses writes with SQLSTATE 25006), api.js (GET-only routes /api/health, /api/vehicle-models, /api/vehicle-models/:id/motorizations, /api/brands, /api/products, /api/products/:product_uid; also serves the storefront at /), shop.html + shop.css + shop-ui.js (vehicle-first browse: model → motorization → brand/search; state in query string; no innerHTML with catalog data; prices formatted from the exact NUMERIC(8,2) decimal string, never parseFloat)
- `projects/ssangyong-autos/database` — schema.sql (DEPLOYED 2026-08-16: 5 sya_ tables + 8 indexes in schema ssangyong_autos; BIGSERIAL PK paired with stable external product_uid 'autopart.tn:<fiche-id>'; no PII, no secret columns; sya_product_price_history documented but commented out/deferred)
- `projects/ssangyong-autos/database/migration` — Executed migration artifacts: input/*.csv (frozen Stage 2 dataset from Google Sheet snapshot), generate_import.py (deterministic, SHA-256-proven, never connects to a DB), import.sql (transaction-wrapped INSERTs + setval), validation.sql (18 read-only checks, all pass), README.md (full execution record)

**Important files:**

- `projects/ssangyong-autos/README.md` — The onboarding document: what exists today (deployed schema, 1519-row live catalog, API, storefront, zero public exposure), the critical 'two systems called ssangyong.autos' table (this Postgres project vs the frozen legacy MariaDB site at /var/www/ssangyong.autos), the ratified §22 option-3 decision and its consequences, API conventions (product_uid addressing, decimal-string prices, LIVE_STATUS = active+updated), run/test commands, and the deferred-not-built list
- `projects/ssangyong-autos/reference/api.js` — SYA-API-1 + storefront serving; LIVE_STATUS predicate defined once ('active','updated') so facets can never disagree with lists; binds 127.0.0.1:3011 (SSANGYONG_API_PORT overrides); no auth by design (public catalogue rows, no PII/secret columns)
- `tests/sya-api-1-readonly-catalog-api-test.js` — 60 live checks incl. the 25006 write refusal, Stage 5 Phase 3 row counts as baseline, injection-shaped input as literal text, and a source-level assertion that api.js opens no MySQL/MariaDB path (enforces the §21 legacy freeze in code)
- `tests/sya-shop-1-storefront-test.js` — Storefront suite (39 checks at SYA-SHOP-1, 41 after SYA-SHOP-1b added stylesheet-level regression guards, e.g. [hidden]{display:none !important}); proves from live data that https://autopart.tn is the single necessary-and-sufficient CSP image origin

**Related projects:**

- projects/automotive (Parts Network is umbrella Pillar C; AutoValeur AVA-2 plans ssangyong.autos parts-price lookup)
- projects/idauto (same PostgreSQL host but a separate database — README: 'shares nothing with it'; API/storefront deliberately follow the projects/idauto/reference no-framework convention)
- Legacy ssangyong.autos website at /var/www/ssangyong.autos, MySQL/MariaDB, not in any repository — frozen by migration plan §21, permanently for this workstream under ratified option 3

**Key documentation:** `projects/ssangyong-autos/README.md`, `projects/ssangyong-autos/database/migration/README.md`, `docs/AI_HANDOVER.md (SYA stage records: Stage 3/4/5, SYA-API-1, SYA-SHOP-1, SYA-SHOP-1b)`, `docs/OFFHOST_PROJECT_REGISTRY.md`, `docs/MYTHOS_PORTFOLIO_REGISTRY.md (stale for this track)`

**Important technical notes:** Run the API+storefront: `env SSANGYONG_DB_HOST=... SSANGYONG_DB_PORT=... SSANGYONG_DB_USER=... SSANGYONG_DB_PASSWORD=... SSANGYONG_DB_NAME=... node projects/ssangyong-autos/reference/api.js` (127.0.0.1:3011). Tests (both hit the live database over real HTTP — not offline): `node tests/sya-api-1-readonly-catalog-api-test.js` and `node tests/sya-shop-1-storefront-test.js`, same env; operational credentials at /home/deploy/deployments/ssangyong-autos-postgres/.env (mode 0600, outside the repo — never commit or print). Conventions that tests pin: address products by product_uid never the serial id; keep price_tnd as the decimal string; 'in the catalogue' means status IN ('active','updated') — filtering 'active' alone silently drops 2 sellable parts; never assign innerHTML with catalog data; CSP has exactly one remote origin (https://autopart.tn). External-repo relationship: docs/OFFHOST_PROJECT_REGISTRY.md documents `othoth77/ssangyong` as the PRIVATE off-host backup repository of the VPS project directory `projects/ssangyong` (196 files, 11.4 MB, 'none runnable') — a formerly empty public placeholder switched private and reused 2026-08-13; that is a different artifact from this monorepo directory, and the registry does not describe its contents further, so any closer relationship between othoth77/ssangyong and projects/ssangyong-autos is UNVERIFIED beyond what that registry row states. Also note: `MYTHOS_SSANGYONG_DATA_MIGRATION_AND_RESUME_PLAN.md` is cited by the README and AI_HANDOVER (its §21 freeze and §22 options are binding) but the file itself is NOT present in this repository checkout (find-verified).

**Deployment / infrastructure:** Database deployed and live (owner-authorised, 2026-08-16): PG 15.18, database ssangyong_autos, 5 tables + 8 indexes, 1519 rows, dedicated owner role, 0 objects in public schema. API/storefront NOT deployed: loopback-only, no nginx, no systemd unit, no TLS — a future deployment stage requires its own owner order, and under ratified option 3 only the storefront process needs exposing (the API shares its process/origin). Legacy-site retirement is explicitly 'later' and its own owner order. AI_HANDOVER also notes an untracked projects/ssangyong-autos/deploy/ directory existing only in the VPS working copy (preserved untouched by sessions; not present in this checkout).

---

**— Automation & infrastructure —**

### Mythos Automation & Operations (mythos_automation)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/automation`
- **Status:** Reference implementations only — nothing deployed, no live provider connection ever made, no OVH/Cloudflare/Coolify credential exists anywhere in the repo or host. Per docs/AUTOMATION_ROADMAP.md (as of 2026-08-16): AUT-0 (docs) done; INF-OVH-API-0 done (mocked connector, PR #7); INF-CF-AUTO-0 done (mocked connector, PR #8); AUT-CONNECTOR-SHARED-HELPERS-0 done (shared helper extraction); INF-DNS-AUTO-1 done 2026-08-15 (comparison engine, 85 tests); INF-DNS-AUTO-2 implemented+tested (97 tests) but operationally gated shut — 0 of 40 owner approval fields APPROVED_FOR_MIGRATION, both DNS write connectors enabled:false, all LEVEL_3 flags false, no credential; INF-DEPLOY-AUTO-0 implemented+tested (124 tests, O-DEPLOY-1/2/3 ratified, Dar Hijama staging target, no deployment executed, 4 operator-action blockers remain); INF-BACKUP-AUTO-0 implemented+tested (243 tests, O-BACKUP-1..6 ratified, operationally enabled for read-only backup_verify only — 0 backups created, 0 restores). INF-MONITOR-AUTO-0 / OPS-AUTO-0 / OPS-AUTO-1 planned, not started. NOTE: projects/automation/README.md is stale relative to the roadmap (still names INF-DNS-AUTO-1 as 'next, NOT STARTED').

**Main purpose:** Shared platform capability (product key mythos_automation) underlying the operator-facing 'Mythos Control Center': orchestrate repeatable workflows across the Mythos ecosystem — connectors to external providers, scheduling, prerequisite validation, approvals, execution, verification, rollback, audit, notifications. Governing principle 'Automation First' (docs/AUTOMATION_FIRST_PRINCIPLES.md): every safe/repeatable/measurable operation should eventually be automated, but automation never removes governance — high-risk actions are automated in preparation/validation only and require explicit human approval before APPLY. Four permanent automation levels: LEVEL_1_READ_ONLY, LEVEL_2_RECOMMEND (both: no external mutation), LEVEL_3_APPROVAL_REQUIRED, LEVEL_4_FULL_AUTOMATIC; a workflow may never self-promote its level. 13-step lifecycle DISCOVER→SNAPSHOT→ANALYSE→PLAN→DRY_RUN→GATE_CHECK→APPROVAL→APPLY→VERIFY→ROLLBACK→AUDIT→NOTIFY→CLOSE, with 17 named run statuses (terminal ones never transition). Permanent LEVEL_3 approval boundaries (docs/AUTOMATION_APPROVAL_MATRIX.md §2, 18 items) include nameserver changes, DNSSEC/DS changes, production DNS record deletion, destructive migrations, backup deletion/disabling, secret exposure remediation, privilege escalation, money transfer, production shutdown; each must have is_permanent_boundary=TRUE and allow_self_approval=FALSE.

**Technology / stack:** Plain Node.js reference modules ('use strict', CommonJS, no dependencies, no framework, no network/filesystem/credential access — provider clients are always injected by the caller); draft PostgreSQL schema (logical schema mythos_automation, 24 aut_* tables, NOT deployed); JSON configuration (all connectors/flags disabled except the O-BACKUP-6-ratified backup-read enablement); plain-node test suites in tests/.

**Important folders:**

- `projects/automation/reference` — All seven reference modules — the entire implemented Automation track code
- `projects/automation/config` — Draft configuration (feature flags, connector catalogue, approval rules) and the ratified INF-BACKUP-AUTO-0 approval policy
- `projects/automation/database` — Draft 24-table control-plane PostgreSQL schema (NOT deployed)

**Important files:**

- `projects/automation/reference/connector-readonly-helpers.js` — Shared provider-neutral safety helpers: assertReadOnlyClient (throws if an injected client exposes any mutation-shaped method, regex ^(create|update|set|write|delete|remove|patch|put|mutate|apply)) and buildSnapshotRecord (aut_snapshots shape, is_redacted always true)
- `projects/automation/reference/ovh-readonly-connector.js` — INF-OVH-API-0 mocked LEVEL_1_READ_ONLY OVH connector (domains, registrar metadata, DNS records, DNSSEC state; redacts registrant PII; refuses to run unless config.enabled===true)
- `projects/automation/reference/cloudflare-readonly-connector.js` — INF-CF-AUTO-0 mocked LEVEL_1_READ_ONLY Cloudflare connector (account/zone/settings inventory; redacts owner-identifying fields)
- `projects/automation/reference/dns-comparison-engine.js` — INF-DNS-AUTO-1: OVH vs public DNS vs Cloudflare comparison, email/DNSSEC safety analysis, migration+rollback plan generation; every plan step is LEVEL_3; entry_gate_open is structurally always false — software cannot open the INF-CF-2 gate
- `projects/automation/reference/dns-operations-executor.js` — INF-DNS-AUTO-2: guarded execution path for approved DNS operations — reads (never writes) the owner approval gate table (docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md six-value vocabulary, only APPROVED_FOR_MIGRATION authorises), one domain at a time, mandatory verification + automatic rollback as separate audited execution; no operation ever performed
- `projects/automation/reference/staging-deployment-executor.js` — INF-DEPLOY-AUTO-0: GitHub→Coolify STAGING-only executor for Dar Hijama (AUTHORISED_REPOSITORY='othoth77/notre-jour'); production structurally unreachable — ENVIRONMENT_KEY constant 'staging', two-source environment proof (declared registry record must be corroborated by Coolify's own metadata, disagreement = refusal), production tokens refused, secret-shaped field names refused
- `projects/automation/reference/backup-operations-orchestrator.js` — INF-BACKUP-AUTO-0: owns no backup logic — pure delegation to projects/idauto/ops/offhost-backup.js; backup_create/restore_test are LEVEL_4_FULL_AUTOMATIC per O-BACKUP-5, backup_verify/retention_report LEVEL_2; 13 destructive operations refused by name plus shape-based refusal; two-source isolation proof for restore tests
- `projects/automation/config/automation.example.json` — Draft config: automation levels, lifecycle, failure classes, approval rules (self_approval_allowed false), retry defaults, connector catalogue, feature_flags — everything false/disabled EXCEPT the O-BACKUP-6 enablement (backup_storage_readonly enabled with secret_reference_id 'secref-r2-backup'; level_2_recommend_runs and level_4_full_automatic_runs true; level_3_approval_required_runs false)
- `projects/automation/config/inf-backup-auto-0-approval-policy.json` — Committed O-BACKUP-5 approved policy: LEVEL_2 record for backup_verify/retention_report, LEVEL_4 record for backup_create/restore_test with monitoring/audit/bounded_retries(1)/rollback fields; permanent boundaries explicitly withheld
- `projects/automation/database/control-plane-schema.sql` — Draft 24-table schema (aut_environments, aut_connectors, aut_connector_capabilities, aut_secret_references, aut_runs, aut_run_steps, aut_approvals, aut_approval_policies, aut_snapshots, aut_dead_letters, aut_rollback_executions, aut_incidents, aut_audit_events, etc.) — no secret-value column anywhere by permanent rule; no cross-schema FKs; NOT deployed
- `projects/automation/README.md` — Project overview (stage AUT-CONNECTOR-SHARED-HELPERS-0 framing; partially stale vs docs/AUTOMATION_ROADMAP.md)

**Related projects:**

- projects/infrastructure
- projects/command-center (Mythos Control Center is the operator product for this platform)
- projects/idauto (offhost-backup.js is the wrapped backup mechanism)
- projects/meta

**Key documentation:** `docs/AUTOMATION_FIRST_PRINCIPLES.md`, `docs/AUTOMATION_ARCHITECTURE.md`, `docs/AUTOMATION_GOVERNANCE.md`, `docs/AUTOMATION_APPROVAL_MATRIX.md`, `docs/AUTOMATION_SECURITY_AND_SECRETS.md`, `docs/AUTOMATION_OPERATIONS_RUNBOOK.md`, `docs/AUTOMATION_ROADMAP.md`, `docs/MYTHOS_CONTROL_CENTER_PRODUCT_SPEC.md`, `docs/OFF_HOST_BACKUP_GATE.md`, `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`, `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`

**Important technical notes:** SECRETS (permanent policy, docs/AUTOMATION_SECURITY_AND_SECRETS.md): secret values may live ONLY in VPS environment variables, Coolify secret variables, an approved secret manager, short-lived tokens, or service accounts; never in Git, docs, config examples, logs, test output, DB plaintext columns, localStorage, client JS, or commit messages. Connectors reference a secret_reference_id only — aut_secret_references stores metadata (provider, purpose, environment, owner, rotation_policy, rotated_at, expires_at, status), never token/password/key values; exposed secrets must be rotated at source immediately. Actor fields (requested_by, approved_by, owner) are opaque references, never PII. Read and write connectors for the same provider are always distinct definitions (e.g. ovh_readonly vs ovh_dns_operator, cloudflare_readonly vs cloudflare_dns_operator, coolify_deployer). The only designated live credential is the owner-created file ~/.config/mythos/idauto-offhost.env (mode 0600, outside the repo) referenced as 'secref-r2-backup'. Tests: node tests/inf-ovh-api-0-connector-test.js, tests/inf-cf-auto-0-connector-test.js, tests/aut-connector-shared-helpers-0-test.js, tests/inf-dns-auto-1-comparison-test.js, tests/inf-dns-auto-2-operations-test.js, tests/inf-deploy-auto-0-staging-test.js, tests/inf-backup-auto-0-backup-test.js. Gotcha: 'implemented' in this track never means 'operational' — every module fails closed on multiple independent conditions (connector enabled flag, level feature flags, owner approval fields, credential-by-reference presence), and unblocking is always an owner action, not code.

---

### Infrastructure registries (Cloudflare domain inventory + Coolify environment registry)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/infrastructure`
- **Status:** INF-CF-1 complete (inventory of all 8 domains, observation 2026-08-06T00:02:54Z; audit PASS). INF-CF-2 (DNS migration) BLOCKED and not started, pending docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md — prerequisites include authoritative OVH zone exports per domain, reconciliation of every REVIEW_BEFORE_RECREATE/NEEDS_CONFIRMATION row, and explicit owner sign-off for the live production domain uthinachess.tn. INF-DEPLOY-AUTO-0 registry updated 2026-08-15 (O-DEPLOY-1 amendment): staging app bound but NOT deployable — no independent staging database credential exists yet (every required secret is ${VAR:?} unset, stack fails closed).

**Main purpose:** Committed, machine-readable, non-secret records of observed infrastructure identity. cloudflare/: the INF-CF-1 read-only inventory of the eight authorised Mythos-portfolio domains (agribee.tn, darhijama.tn, fixpert.tn, idauto.tn, mythosprod.xyz, notrejour.tn, ssangyong.autos, uthinachess.tn) built from PUBLIC sources only (public DNS via 1.1.1.1/DoH, RDAP for .xyz/.autos, ATI WHOIS for .tn, TLS inspection, crt.sh) — explicitly not a substitute for an authoritative OVH zone export; plus a git-ignored local intake directory for raw provider exports. coolify/: the INF-DEPLOY-AUTO-0 declaration of which Coolify environment is the authorised staging target (darhijama/staging, uuid nuzp80tn6vtmymwnm2tc4d6i, bound application mythos-dar-hijama-staging) and which must never be one (darhijama/production, notrejour/production); mirrors the undeployed aut_environments column shape. The target Cloudflare architecture (docs/CLOUDFLARE_ARCHITECTURE.md, INF-CF-0 proposal): Cloudflare as unified edge gateway (DNS, TLS, CDN, DDoS, WAF, rate limiting, Cloudflare Access) in front of an OVH VPS running Coolify (Mythos app services, product services, cloudflared Tunnel container, PostgreSQL, background jobs, R2 object storage); ingress via outbound-only Cloudflare Tunnel with no open inbound ports; admin hostnames (coolify.*, n8n.*, admin.*, watch.*) behind deny-by-default Cloudflare Access; SSL Flexible prohibited (Full strict only); R2 never the sole backup destination.

**Technology / stack:** JSON registries + Markdown READMEs only — no runtime code. Observations produced by read-only methods (public DNS/RDAP/WHOIS/TLS for Cloudflare inventory; a read-only SELECT of identity columns from the Coolify control-plane database for environments.json).

**Important folders:**

- `projects/infrastructure/cloudflare` — Domain inventory JSON, zone-review template, and the local-only authoritative-exports intake directory
- `projects/infrastructure/cloudflare/authoritative-exports` — Local intake only — deny-all .gitignore; raw registrar/DNS exports must never be committed (may contain verification tokens, DS values, personal registrant data); only README.md and .gitignore are tracked
- `projects/infrastructure/coolify` — Coolify environment identity registry (authorised staging target declaration)

**Important files:**

- `projects/infrastructure/cloudflare/domain-inventory.json` — Machine-readable inventory of the eight authorised domains (public-source observations, personal registrant data redacted, no secrets)
- `projects/infrastructure/cloudflare/README.md` — INF-CF-1 scope, public-source limitations, refresh procedure, prohibitions (no logins, no DNS changes, no credentials stored), INF-CF-2 prerequisites
- `projects/infrastructure/cloudflare/zone-review-template.json` — Template for per-zone review before recreation in Cloudflare
- `projects/infrastructure/coolify/environments.json` — Declares darhijama/staging (uuid nuzp80tn6vtmymwnm2tc4d6i, is_production:false, enabled:true, bound app mythos-dar-hijama-staging uuid dmgranxzp3ftkfumwqe4mihy, staging_database.secret_reference_id null → fails closed) vs darhijama/production and notrejour/production (never deployment targets); Coolify version 4.3.2 recorded
- `projects/infrastructure/coolify/README.md` — Explains the registry authorises nothing by itself — the staging-deployment-executor's two-source proof still applies; editing environment_key/is_production here cannot make production deployable

**Related projects:**

- projects/automation (connectors and executors consume these registries)
- projects/command-center

**Key documentation:** `docs/CLOUDFLARE_ARCHITECTURE.md`, `docs/CLOUDFLARE_DOMAIN_INVENTORY.md`, `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md`, `docs/CLOUDFLARE_AUTHORITATIVE_EXPORT_INTAKE.md`, `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`, `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`, `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`, `docs/OFFHOST_PROJECT_REGISTRY.md`, `docs/OFF_HOST_BACKUP_GATE.md`

**Important technical notes:** Documented infra facts: all 8 domains registered at OVH with OVH authoritative nameservers (ns1/dns1.tn.ovh.net for .tn; ns109/dns109.ovh.net for the gTLDs); 6 of 8 apexes resolve to the shared VPS IP 51.68.226.211 (agribee.tn → 51.91.236.255, idauto.tn → 213.186.33.5); DNSSEC already ENABLED on mythosprod.xyz and ssangyong.autos (DS-record cutover must be coordinated during any nameserver migration or validation breaks); no domain publishes DMARC or CAA; uthinachess.tn is the live production domain requiring separate migration authorisation; mythosprod.xyz web presence is broken (HTTP redirects to darhijama.tn, HTTPS cert mismatch); idauto.tn has no HTTPS listener; coolify.mythosprod.xyz is the only already-live admin hostname. Secrets: Cloudflare API/Tunnel tokens, R2 keys, Origin CA keys, TSIG keys must never be committed — Tunnel tokens live only in Coolify encrypted environment variables or an approved secret manager (docs/CLOUDFLARE_ARCHITECTURE.md §4.3/§4.10). Off-host backup context (docs/OFF_HOST_BACKUP_GATE.md): the actual backup implementation lives in projects/idauto/ops/offhost-backup.js + projects/idauto/ops/adapters/s3-compatible.js (SigV4, HTTPS-only, R2-ready; do NOT install rclone/aws/s3cmd); R2 config contract is ~/.config/mythos/idauto-offhost.env mode 0600 with keys ENDPOINT/REGION=auto/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY (owner-created, bucket-scoped, never in repo); backup gate CLOSED 2026-08-14 with batch 20260814T161856Z (3 sources: idauto-postgres/idauto 11MB pg_dump -Fc in-container, coolify-db/coolify 24MB, dar-hijama-production-mysql-1/darhijama_prod mysqldump --single-transaction; C1==C2 round-trip 3/3, isolated restores 3/3 in --network none tmpfs scratch containers); ETag must never be used as a checksum. docs/OFFHOST_PROJECT_REGISTRY.md: 14 non-Git VPS projects pushed to private othoth77/* repos (100% of 1,373 files / 129,175,505 bytes); mythos-prod and darhijama repos remain PUBLIC (open owner question); 18 sensitive files (RIB, CIN, live data backup) deliberately excluded from GitHub.

---

### Cloudflare deployment tooling (deploy/)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `deploy`
- **Status:** DOCUMENTATION ONLY — deploy/cloudflare/README.md states explicitly: 'INF-CF-0 is documentation only. No Cloudflare account has been configured, no DNS records changed, no Tunnel deployed, and no Access policies applied.' Later stages INF-CF-1..7 are defined in docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md; docs/ROADMAP.md records INF-CF-2 as blocked/not started.

**Main purpose:** Planned Cloudflare Zero Trust ingress layer for Mythos OS: a remotely managed Cloudflare Tunnel run by a cloudflared container inside Coolify on the OVH VPS, mapping public/private hostnames (app/api/watch/n8n/coolify/admin/files.mythosprod.xyz) to internal services, with deny-by-default Cloudflare Access on private hostnames and a 404 catch-all for unmatched routes.

**Technology / stack:** Documentation + env template only. Target stack: official cloudflare/cloudflared image (version-pinned, `tunnel run --token ...`), Coolify encrypted environment variables for all secrets.

**Important folders:**

- `deploy/cloudflare` — The entire contents of deploy/: README.md (tunnel model, container config, hostname routing table, Access policy requirements) and cloudflared.env.example.

**Important files:**

- `deploy/cloudflare/README.md` — Architecture and policy for the tunnel: remotely managed tunnel (no local config.yml, no inbound ports), pinned image version rule, hostname→access-level table, 404 default rule, and the rule that app-level auth remains mandatory behind Cloudflare Access.
- `deploy/cloudflare/cloudflared.env.example` — Placeholder-only env template: CLOUDFLARE_TUNNEL_TOKEN, CLOUDFLARE_TUNNEL_NAME, CLOUDFLARE_ACCOUNT_ID all empty. Real values live only in Coolify encrypted env vars or an approved secret manager; committed values must be rotated immediately.

**Related projects:**

- Mythos OS (root web app) — the application this ingress will front

**Key documentation:** `docs/CLOUDFLARE_ARCHITECTURE.md`, `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md`, `docs/CLOUDFLARE_DOMAIN_INVENTORY.md`, `docs/CLOUDFLARE_DNS_MIGRATION_MATRIX.md`, `docs/CLOUDFLARE_INF_CF2_ENTRY_CRITERIA.md`, `docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md`

**Important technical notes:** Secrets policy is the defining constraint: no real credentials anywhere in the repo (README and env.example both state rotation is mandatory if one is ever committed); even the non-secret Cloudflare Account ID is excluded by project policy. Cloudflare Access is defence-in-depth only — it never replaces application auth.

**Deployment / infrastructure:** Nothing here is deployable yet. When INF-CF-3 arrives, Coolify runs cloudflare/cloudflared:<pinned-version> with `tunnel run --token ${CLOUDFLARE_TUNNEL_TOKEN}` from encrypted env, restart policy Always, on a network reaching internal Coolify services. Owner approval gates apply (docs/CLOUDFLARE_OWNER_APPROVAL_GATE.md).

---

### DEVX — Mythos Development Acceleration

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/devx`
- **Status:** DEVX-0 (Development Acceleration MVP) done, merged via PR #6; DEVX-1 (Dependency/Impact Graph + Automated PR Review) done 2026-08-12 per docs/ROADMAP.md (test: tests/devx-1-idauto-test-impact-test.js). DEVX-2 (Verified Development Research Cache) is next — NOT STARTED, title only. DEVX-3 (Agent Orchestration Analytics) not started. Note: projects/devx/README.md still says 'DEVX-0' and doesn't mention DEVX-1 — ROADMAP.md is the more current record.

**Main purpose:** Named home for the DEVX product track: repository orchestration, stage automation and development-workflow acceleration (developer tooling ONLY — no product runtime code, never reachable by end-user Mythos chatbot instances). The directory itself is intentionally minimal (README.md only) because the actual tooling lives elsewhere by design: Stage Runner CLI in scripts/mythos-stage.js, deterministic validation in scripts/project-intelligence.js, governance metadata in projects/meta/ (current-context.json, known-baselines.json, test-impact-map.json, development-lanes.json, stage-templates.json, project-ledger.json), Agent Development Skills in .claude/skills/. DEVX-0 establishes the 'short command contract' (docs/DEVELOPMENT_WORKFLOW.md): a future stage begins from a short owner instruction like 'Start <STAGE> according to Mythos workflow' — authorisation and intent only; GitHub/Git state is the source of repository facts, and the Stage Runner derives risk lane, relevant skills/files, required tests, known baselines and blockers.

**Technology / stack:** Node.js CLI (scripts/mythos-stage.js — deterministic, offline-first, Node built-ins only; external calls limited to git and optionally gh, degrading gracefully without gh and never printing a token) + JSON metadata files in projects/meta/ + Markdown docs.

**Important folders:**

- `projects/devx` — The track's named home (README.md only, by design)
- `projects/meta` — The DEVX governance metadata the Stage Runner reads: current-context.json, known-baselines.json, test-impact-map.json, development-lanes.json, stage-templates.json, project-ledger.json, project-statistics.json, portfolio-registry.json

**Important files:**

- `projects/devx/README.md` — Explains what lives here vs elsewhere (the concern→location table) and the DEVX-0 stage identity
- `scripts/mythos-stage.js` — Stage Runner CLI — commands: context, status, start <STAGE> [--dry-run|--apply], validate <STAGE>, close <STAGE> [--dry-run|--apply]; never modifies Git history, never merges, never commits/pushes for HIGH_RISK stages, never bypasses the one-major-stage rule; detectGh() returns only booleans (installed/authenticated), never token output
- `scripts/project-intelligence.js` — Deterministic ledger/statistics/registry/history validation tool that mythos-stage.js shells out to rather than reimplementing (node scripts/project-intelligence.js validate)
- `projects/meta/test-impact-map.json` — Changed-file path prefix → track → minimum targeted tests → risk lane; first matching prefix wins per file, change sets take the union of tests and the highest-risk lane; unknown paths fall back to FULL_SUITE_REQUIRED at HIGH_RISK — never silence
- `projects/meta/known-baselines.json` — Independently verified pre-existing test failures (e.g. Stage 3D's 104/110 with six known _memCache-cascade failures) — a new regression must never become a baseline automatically; changes require a reviewed Git change
- `projects/meta/development-lanes.json` — FAST / STANDARD / HIGH_RISK lane definitions; HIGH_RISK can never silently downgrade and close --apply is refused for it (HIGH_RISK_POLICY_VIOLATION)
- `projects/meta/stage-templates.json` — Entry/closure checklists by stage type (DOCUMENTATION FAST, RUNTIME STANDARD, INFRASTRUCTURE HIGH_RISK, CONNECTOR STANDARD, DATABASE HIGH_RISK, SECURITY HIGH_RISK, RESEARCH FAST); each template must carry 9 required fields, validated by project-intelligence and tests/devx-0-development-acceleration-test.js
- `projects/meta/current-context.json` — Compact derived snapshot a future agent reads before scanning many documents; regenerated by node scripts/mythos-stage.js context

**Related projects:**

- projects/meta
- projects/automation (LEVEL_3 approval boundaries remain authoritative where they overlap development lanes)
- projects/personal-intelligence (agent-skills-registry.json is a context source)

**Key documentation:** `docs/DEVELOPMENT_ACCELERATION_ARCHITECTURE.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`, `docs/DEVELOPMENT_STAGE_TEMPLATES.md`, `docs/ROADMAP.md`, `AGENTS.md`

**Important technical notes:** Real commands: node scripts/mythos-stage.js context | status | start <STAGE> [--dry-run|--apply] | validate <STAGE> | close <STAGE> [--dry-run|--apply]; node scripts/project-intelligence.js validate; test suites node tests/devx-0-development-acceleration-test.js and node tests/devx-1-idauto-test-impact-test.js. Workflow contract (docs/DEVELOPMENT_WORKFLOW.md): preflight (clean worktree, HEAD==origin/main) → context → stage resolution against project-ledger.json (one-major-stage rule, dependencies) → governance gate → smallest coherent change → test selection via test-impact-map → doc sync → close → PR; machine-readable blocker codes stop the workflow rather than being guessed around: UNEXPECTED_MAIN_STATE, DIRTY_WORKTREE, UNKNOWN_STAGE, DEPENDENCY_UNSATISFIED, ANOTHER_MAJOR_STAGE_ACTIVE, OUT_OF_SCOPE_CHANGE, SECRET_DETECTED, NEW_TEST_REGRESSION, MISSING_APPROVAL, GITHUB_NOT_AUTHENTICATED, HIGH_RISK_POLICY_VIOLATION. Gotchas: --apply on start/close performs no direct Git mutation in this MVP (branch/commit/push remain explicit manual steps) — it only reports whether mutation would be allowed for the resolved risk lane; merge always requires explicit owner authorisation; no credential is ever read, stored or printed by any DEVX file.

---

**— Intelligence & meta —**

### Mythos Personal Intelligence & Skills Platform (MPI)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/personal-intelligence`
- **Status:** Track CLOSED at MPI-4/O-4-4 per docs/AI_HANDOVER.md: MPI-0/0-FINALIZATION (contracts + reference impl), MPI-1 (context runtime, completed 2026-08-12 per projects/meta/current-context.json), MPI-2A schema APPLIED TO PRODUCTION 2026-08-14 (idauto-postgres, 3 migrations, 16/16 assertions), MPI-2B–2G remediation of audit findings F8–F13, MPI-2H real owner-corpus ingestion (batches 2h-001..2h-004), MPI-3 retrieval R1–R3 (first real production retrieval), MPI-4 M4-1/M4-2 offline runtime + O-4-4 relevance router (65/65 + 41/41, full regression 721/0). O-4-1 ratified DEFER: memory never leaves the VPS, offline mock is the only wired provider (one verified OpenRouter free request under an amended order). Remaining items are owner decisions, not stages. NOTE: projects/personal-intelligence/README.md still describes MPI-0 only — stale relative to AI_HANDOVER and docs/MPI_*.md.

**Main purpose:** Application-level foundation for Mythos's shared per-user/per-organisation/per-profession AI personalisation (product key mythos_intelligence). Implements the layered contract set Global Intelligence -> Domain -> Organisation -> User -> Session -> Intent Architect -> Skill Router -> Superposer -> Guard -> Execution -> Learning (docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md). Includes a memory engine (pi_memory_records, learned preferences, provenance, audit) in a dedicated PostgreSQL schema `mythos_intelligence`, ingestion/retrieval CLIs, and an offline provider-neutral runtime.

**Technology / stack:** Node.js, dependency-free (built-ins only); PostgreSQL 15 with a separate logical schema `mythos_intelligence` (chosen over separate DB/SQLite in docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md §1); pg driver injected by caller (persistence/client.js never reads env/credentials itself); operator-run CLIs on the VPS, no deployed service.

**Important folders:**

- `projects/personal-intelligence/reference` — MPI-0 illustrative in-memory reference implementations of the contracts: scope.js (scope precedence), context-assembler.js (REQUIRED/USEFUL/IRRELEVANT/FORBIDDEN), learning-engine.js (observation->candidate->established->explicit rule), guard.js (ALLOW/DENY/REQUIRE_APPROVAL/READ_ONLY/DRY_RUN_ONLY), intent-router.js, entity-resolver.js, context-compiler.js. Not wired to production.
- `projects/personal-intelligence/persistence` — MPI-2/3 real persistence layer: client.js (injected pg driver), migrate.js (migration runner), repositories.js, lifecycles.js (reinforcement/supersession), ingestion.js (MPI-2H guarded ingestion boundary, flag defaults OFF), retrieval.js + context-runtime.js (MPI-3 R1/R3), content-store.js (D3 content by reference), activation.js, health.js, adapters.js; testing/psql-driver.js.
- `projects/personal-intelligence/runtime` — MPI-4 runtime: mpi-runtime.js (M4-2 offline composition request->identity bridge->R3->ContextPackage->adapter->provider), provider-adapter.js (M4-1 provider-neutral contract), mock-provider.js (only permitted provider under O-4-1 DEFER), openrouter-provider.js, relevance-router.js (O-4-4), identity-bridge.js, usage-ledger.js.
- `projects/personal-intelligence/cli` — Operator CLIs (VPS-local, not deployed): mpi-ingest-cli.js (MPI-2H owner-entered batches), mpi-retrieve-cli.js (MPI-3 R2), mpi-runtime-cli.js (M4-2 `ask` command, hard-wired offline mock provider).
- `projects/personal-intelligence/database` — control-plane-schema.sql (ratified 15-table draft schema, mythos_intelligence: pi_memory_records, pi_learned_preferences, pi_preference_audit, pi_entity_references, pi_knowledge_sources...), memory-engine-schema.sql, mpi-2a-remediation-proposal.sql.
- `projects/personal-intelligence/config` — agent-skills-registry.json (canonical registry of the 20 .claude/skills entries — see Agent Skills record) and personal-intelligence.example.json (draft config, no secrets).

**Important files:**

- `projects/personal-intelligence/README.md` — Layout and doc index, but stage/status section is stale (says MPI-0 only, 'not merged to main').
- `projects/personal-intelligence/database/control-plane-schema.sql` — The ratified schema that fixed the storage boundary, opaque-identifier discipline (no raw personal-data columns), supersession rule, and audit model; MPI-2 extended rather than replaced it.
- `projects/personal-intelligence/runtime/mpi-runtime.js` — The composed runtime — header documents the full pipeline and the O-4-1/O-4-4 constraints; no provider-selection surface, no credential handling.
- `projects/personal-intelligence/persistence/ingestion.js` — MPI-2H ingestion boundary implementing only the ratified-decision portion of docs/MPI_2H_INGESTION_SPECIFICATION.md; ingestion flag defaults OFF, REAL-class items need per-batch operator gate assertions (§24).

**Related projects:**

- projects/research-intelligence (MPI decides what to retrieve/for whom; RES decides how, via research.web capability)
- projects/meta (portfolio/ledger tracking of MPI stages)
- .claude/skills (agent-development counterparts; two skills deliberately share names with MPI runtime components)
- projects/idauto (shares the PostgreSQL instance — schema-level isolation, no cross-schema FKs; idauto data 'never migrates into MPI')

**Key documentation:** `docs/MYTHOS_PERSONAL_INTELLIGENCE_ARCHITECTURE.md`, `docs/MYTHOS_PERSONAL_INTELLIGENCE_VISION.md`, `docs/MYTHOS_MEMORY_ENGINE_ARCHITECTURE.md`, `docs/MYTHOS_USER_MEMORY_POLICY.md`, `docs/MYTHOS_CONTEXT_ARCHITECTURE.md`, `docs/MYTHOS_DOMAIN_PACKS.md`, `docs/MPI_2H_INGESTION_SPECIFICATION.md`, `docs/MPI_4_RUNTIME_SPECIFICATION.md`, `docs/MPI_MEMORY_INGESTION_ROADMAP.md`, `docs/MPI_PRODUCTION_READINESS.md`, `docs/MPI_CRITICAL_FINDINGS.md`, `docs/MPI_FINDINGS_REMEDIATION.md`, `docs/MPI_FORENSIC_AUDIT.md`, `docs/SKILLS_ROADMAP.md`, `docs/MODEL_ROUTING_ARCHITECTURE.md`

**Important technical notes:** Everything is decision-gated: docs/MPI_4_RUNTIME_SPECIFICATION.md is an ACTIVE decision ledger (O-4-1 DEFER = no external egress of memory; PROTECTED-memory egress forbidden until decided). docs/MPI_MEMORY_INGESTION_ROADMAP.md (2026-08-15) is PROPOSED-only: every ingestion batch needs its own §24(5) owner order + same-session backup; Git is source of truth, documents are never memory — MPI holds distilled facts/preferences/decisions by pointer (D2), never copies. docs/MPI_PRODUCTION_READINESS.md audit verdict CONDITIONAL with 3 defects (F8 concurrent reinforcement double-count, F9 unindexed append-only audit tables, F10 migration runner enforcing 1 of 3 closure gates) — all later remediated in MPI-2D/2E/2F per AI_HANDOVER and tests/mpi-2d..2f. Evidence levels are explicit: DESIGN VERIFIED vs SCRATCH VERIFIED vs PRODUCTION VERIFIED. Tests: 24 tests/mpi-*.js suites (mpi-0 through mpi-4, activation, d3-content-store, observability). Do not trust module-header comments blindly — MPI-DOC-SYNC-0 corrected stale 'never executed against production' headers in migrate.js/client.js after the 2026-08-14 production apply.

**Deployment / infrastructure:** Schema mythos_intelligence IS applied to the production PostgreSQL (idauto-postgres, PG 15.18, owner-authorised MPI-2A 2026-08-14; public schema verified byte-identical before/after). No service is deployed — all execution is operator-run local CLIs on the VPS. No provider API keys exist; egress is forbidden under O-4-1 DEFER. Backup gate MPI-2G passed; off-host backup destination does not exist yet (IDA-3F blocker in projects/meta/current-context.json).

---

### Mythos Research Intelligence (RES)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/research-intelligence`
- **Status:** RES-0 complete (Free-First Research Intelligence Foundation, 2026-08-07) — documentation only. RES-1 (Research Gateway Core + Official Source Fetcher) explicitly 'NOT AUTHORISED' per README and docs/RESEARCH_ROADMAP.md; AI_HANDOVER repeatedly confirms RES-1 not started. Roadmap defines RES-0..RES-6.

**Main purpose:** Free-first, provider-independent external research capability for the Mythos platform (product key mythos_research): retrieving fresh, citable external information via a Research Gateway with tiered source strategy (TIER 0 internal authoritative -> TIER 1 official source fetcher -> TIER 2 self-hosted SearXNG -> TIER 3 Brave/Tavily free quota -> TIER 4 optional Perplexity premium), plus source trust/freshness evaluation, citation normalisation, research cache, SSRF-gated URL fetching, and redaction before external requests. Research provider is explicitly separate from the reasoning model.

**Technology / stack:** None yet — documentation and example config only. No code, no databases, no provider accounts, no API keys, no SearXNG install; all config flags false/NOT_DEPLOYED.

**Important folders:**

- `projects/research-intelligence/config` — research.example.json and providers.example.json — draft configuration shapes for the future gateway and provider tiers (all disabled).

**Important files:**

- `projects/research-intelligence/README.md` — Authoritative summary: purpose, principles (free-first, provider-independent, source-aware, privacy-aware, auditable, cache-aware, security-gated, model-independent), architecture pipeline diagram, provider tier table, RES-0 data status, and the MPI relationship (MPI determines what/for whom; RES determines how — Skill Router routes research.web/research.official/research.deep into the Research Gateway).

**Related projects:**

- projects/personal-intelligence (upstream layer: Intent Architect + Skill Router feed the Research Gateway)
- projects/automation (deliberately separated: Automation owns deployment/health/provider monitoring; Research owns search/retrieval/source quality — 'do not mix them')

**Key documentation:** `docs/MYTHOS_RESEARCH_INTELLIGENCE_VISION.md`, `docs/MYTHOS_RESEARCH_INTELLIGENCE_ARCHITECTURE.md`, `docs/RESEARCH_PROVIDER_STRATEGY.md`, `docs/RESEARCH_SECURITY_AND_PRIVACY.md`, `docs/RESEARCH_SOURCE_TRUST_AND_CITATIONS.md`, `docs/RESEARCH_ROADMAP.md`

**Important technical notes:** docs/MYTHOS_RESEARCH_INTELLIGENCE_ARCHITECTURE.md contains interface contracts only (ResearchGateway accept/cancel/status, ResearchRequest, adapters) — 'No component is implemented.' Key invariant: research data is never treated as Mythos internal authoritative data. Its README notes it was written when MPI-0 was still PENDING MERGE (PR #4) — that MPI status is now historical.

**Deployment / infrastructure:** Nothing to deploy. Any RES-1+ implementation requires the RES-1 entry gate in docs/RESEARCH_ROADMAP.md to be satisfied first; no provider accounts or keys may be created before that.

---

### Project Meta Registry (machine-readable portfolio state)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `projects/meta`
- **Status:** ACTIVE and used, but snapshots lag the repo: portfolio-registry.json generated 2026-08-06/07 at commit d0a4cbb still says 'MPI-0 complete'; current-context.json generated 2026-08-12 says last_completed_stage MPI-1 — while AI_HANDOVER (2026-08-18) records MPI through O-4-4 closed. Treat AI_HANDOVER as fresher than these files.

**Main purpose:** Machine-readable source of truth for cross-portfolio project state, consumed by the DevX tooling (scripts/mythos-stage.js, scripts/project-intelligence.js) and the mythos-project-context skill: which tracks exist, what stage each is at, stage ledger with commit SHAs, statistics, risk lanes, stage templates, test impact mapping, and a one-file current-context snapshot for session start.

**Technology / stack:** Plain JSON files, validated by scripts/project-intelligence.js (Node, dependency-free). Regenerated via scripts (e.g. `node scripts/mythos-stage.js context` per the mythos-project-context skill).

**Important files:**

- `projects/meta/portfolio-registry.json` — 21 portfolio tracks across categories PLATFORM_CORE / AUTOMOTIVE / EDUCATION / INFRASTRUCTURE / FUTURE_VERTICAL etc. Each track: id, name, category, evidence_status (REPOSITORY_VERIFIED|OWNER_DIRECTION|FUTURE_CONCEPT), implementation_status (ACTIVE|FOUNDATION|PLANNED|BLOCKED|CONCEPT|UNKNOWN), current_stage/next_stage, repository_paths (globs allowed), domain_pack (education / automotive_workshop where applicable), dependencies, notes, last_verified_at.
- `projects/meta/current-context.json` — One-screen session-start snapshot: main_head, active_branch, active_stage, last_completed_stage, active/draft PRs, known_blockers (currently IDA-2E no identity service; IDA-3F no off-host backup destination), known_baselines, relevant_tracks (11), relevant_skills (20). The mythos-project-context skill prefers this file over a broad repo scan.
- `projects/meta/project-ledger.json` — Stage ledger: 11 tracks, 44 stages with status (DONE|DONE_PENDING_MERGE|IN_PROGRESS|PLANNED|BLOCKED) and SHA-validated starting_head/implementation_commit/merge_commit/handover_commit fields, plus PRs, tests, known_issues.
- `projects/meta/project-statistics.json` — 40 statistics entries with mandatory provenance fields (name, value, unit, scope, source, generated_at, source_commit) and an architecture_maturity_distinction block (architecture-defined vs reference-implemented vs runtime-implemented vs production-deployed vs externally-connected tracks).
- `projects/meta/development-lanes.json` — Risk lanes FAST / STANDARD / HIGH_RISK used by stage tooling.
- `projects/meta/stage-templates.json` — Seven stage templates: DOCUMENTATION_STAGE, RUNTIME_STAGE, INFRASTRUCTURE_STAGE, CONNECTOR_STAGE, DATABASE_STAGE, SECURITY_STAGE, RESEARCH_STAGE.
- `projects/meta/test-impact-map.json` — 34 path->test rules plus fallback (risk lane + targeted tests) — the data behind mythos-test-intelligence's targeted-test selection.
- `projects/meta/known-baselines.json` — Known failing-test baselines (1 entry).

**Related projects:**

- All 21 tracks it registers — notably mythos-personal-intelligence, id-auto, atelier-network, autovaleur, infrastructure-cloudflare, and the education/automotive_workshop domain-pack tracks
- .claude/skills (current-context.json lists the 20 skills; skills registry validated together with these files)

**Key documentation:** `docs/AI_HANDOVER.md`, `docs/history/DAILY_HISTORY.md`, `docs/DEVELOPMENT_WORKFLOW.md`, `docs/DEVELOPMENT_STAGE_TEMPLATES.md`, `docs/DEVELOPMENT_TEST_INTELLIGENCE.md`

**Important technical notes:** Validated by `node scripts/project-intelligence.js validate` (check-only, CI-suitable; other commands: stats, history-check, ledger-check, summary). validate checks: (1) skills registry <-> .claude/skills directory bijection, no duplicate skill_ids, every dir has SKILL.md, classification in {UPSTREAM_ORIGINAL, MYTHOS_WRAPPER, MYTHOS_ORIGINAL}, status in {ACTIVE, EXPERIMENTAL, DEPRECATED}, runtime_skill must be false for every skill, semver-format versions; (2) portfolio registry — unique track ids, valid evidence/implementation statuses, non-glob repository_paths must exist (warning); (3) ledger — unique track/stage keys, valid stage statuses, SHA-shaped commit fields; (4) statistics — required provenance fields present, and it FAILS on any misleading single global '100% complete' style statistic (explicitly forbidden); (5) docs/history/DAILY_HISTORY.md date sections unique and strictly ascending. The tool never modifies git, never auto-commits, never connects externally.

**Deployment / infrastructure:** Not deployed anywhere — repo-local JSON + Node script. Safe to run validate read-only; regeneration commands write these files and follow normal change discipline.

---

### Mythos Agent Development Skills (.claude/skills)

- **Repository:** `othoth77/mythos-prod`
- **Local path:** `.claude/skills`
- **Status:** ACTIVE — 20 skills, all classified MYTHOS_ORIGINAL (0 upstream, 0 wrappers per registry classification_counts and docs/SKILLS_SOURCES.md). 18 created in MPI-0; mythos-skill-evolution and mythos-project-history added in the MPI-0-FINALIZATION audit (docs/SKILLS_EVOLUTION.md), which bumped several to 1.0.1/1.1.0 (mythos-project-context now 1.2.0 in the registry); no skill has ever been DEPRECATED/MERGED/SPLIT.

**Main purpose:** 20 mythos-* Agent Skills (Claude Code convention .claude/skills/<name>/SKILL.md) used by Claude/Codex sessions while BUILDING AND OPERATING Mythos itself. docs/SKILLS_ARCHITECTURE.md §1 draws the load-bearing distinction: these Agent Development Skills are categorically NOT Runtime Mythos Capabilities (end-user chatbot capabilities like education.assessment.create or estimate.prepare from docs/MYTHOS_DOMAIN_PACKS.md). '.claude/skills/ alone is not the runtime architecture for thousands of Mythos users'; every entry under .claude/skills/ is an Agent Development Skill without exception, and no dev skill is reachable from an end-user request path (docs/SKILLS_SECURITY.md §3 boundary rule).

**Technology / stack:** Markdown SKILL.md manifests (name/description frontmatter + instruction body, some with a Version: line), governed by a JSON registry at projects/personal-intelligence/config/agent-skills-registry.json and validated by scripts/project-intelligence.js.

**Important folders:**

- `.claude/skills/mythos-repo-guardian` — Sole owner of git/worktree preflight and AGENTS.md rule enforcement; other skills (project-context, safe-change) explicitly delegate to it.
- `.claude/skills/mythos-project-context` — Session-start state surfacing; prefers projects/meta/current-context.json, integrates with `node scripts/mythos-stage.js start <STAGE>` (DEVX-0 short commands).
- `.claude/skills/mythos-skill-evolution` — Owns registry consistency, staleness/duplication detection, the reviewed skill-change lifecycle, and the permanent self-modification safety rules (skills never silently rewrite themselves; no runtime/user-learning may edit .claude/skills/; every version bump recorded in the registry).
- `.claude/skills/mythos-context-assembler` — Example of deliberate name-sharing with a runtime component: this is the agent-development-layer counterpart of the MPI-1 runtime Context Assembler, not the runtime itself (same for mythos-personal-learning vs the MPI-2 learning engine).
- `.claude/skills/mythos-doc-sync` — Per-stage-completion doc consistency (AI_HANDOVER/ROADMAP/CHANGELOG) — distinct trigger from mythos-project-history's per-development-day DAILY_HISTORY.md ledger.

**Important files:**

- `projects/personal-intelligence/config/agent-skills-registry.json` — CANONICAL metadata source (registry wins over SKILL.md Version: lines per docs/SKILLS_VERSIONING_POLICY.md §1). Per skill: skill_id, path, classification, purpose, category, status, introduced_stage, version (semver), last_reviewed_at, owner_scope ('agent-development'), dependencies, related_skills, security_level, allowed_context (repository-development-session), prohibited_context (end-user-chatbot-request, unreviewed-self-modification), runtime_skill (must be false), notes. total_skills 20, all MYTHOS_ORIGINAL.
- `scripts/project-intelligence.js` — Its validate command enforces the registry/disk bijection and per-skill invariants (see Meta record for the full check list) — including failing if any skill's runtime_skill is not false, which mechanically enforces the dev-skill vs runtime-capability boundary.

**Related projects:**

- projects/personal-intelligence (hosts the registry; runtime counterparts of two skill names; docs/SKILLS_ROADMAP.md ties skill inventory to MPI stages)
- projects/meta (validated together; current-context.json lists relevant_skills)

**Key documentation:** `docs/SKILLS_ARCHITECTURE.md`, `docs/SKILLS_SOURCES.md`, `docs/SKILLS_EVOLUTION.md`, `docs/SKILLS_VERSIONING_POLICY.md`, `docs/SKILLS_SECURITY.md`, `docs/SKILLS_SUPERPOSER.md`, `docs/SKILLS_ROADMAP.md`, `docs/MYTHOS_DOMAIN_PACKS.md`

**Important technical notes:** The 20 skills: project-context, intent-architect, skill-router, superposer, skill-guard, repo-guardian, safe-change, test-intelligence, change-impact, doc-sync, migration, error-doctor, smart-data-entry, document-intelligence, invoice-intelligence, client-360, context-assembler, personal-learning, skill-evolution, project-history (all mythos- prefixed). Runtime capabilities live instead in domain packs (docs/MYTHOS_DOMAIN_PACKS.md defines `education` — teacher.context, lesson.prepare, exercise.generate, assessment.prepare, answer_key.generate, content.adapt_difficulty, document.prepare, etc. — and `automotive_workshop` — estimate.prepare, invoice.prepare, etc.) as capability contracts with no runtime support yet; runtime skills are always shared + composed with layered config (global -> domain -> organisation -> user -> task), never copied per user. Skill changes follow mythos-skill-evolution's reviewed lifecycle: change + docs/SKILLS_EVOLUTION.md entry + registry version/last_reviewed_at update; semver semantics defined in docs/SKILLS_VERSIONING_POLICY.md §2.

**Deployment / infrastructure:** Nothing deployed — skills load into Claude Code sessions from the repo. Hard rule: no end-user or product runtime may execute or edit these; `node scripts/project-intelligence.js validate` should pass after any skill or registry change.

---

## 2. Other GitHub repositories

The othoth77 account held 22 repositories when this map was written (verified via the GitHub API, 2026-08-18). Below, each repo's relationship to the monorepo as documented **inside mythos-prod's own docs** (primary evidence: `docs/OFFHOST_PROJECT_REGISTRY.md`, `docs/MYTHOS_REPOSITORY_MIGRATION.md`, `docs/AUTOMATION_ROADMAP.md`). Repos marked `UNVERIFIED` exist on GitHub but are not described anywhere in mythos-prod — their contents were not inspected and nothing is claimed about them.

### `othoth77/mythos-os`

Future migration target for a complete repository migration from mythos-prod, explicitly NOT authorised. An owner directive (2026-08-17) states mythos-prod remains the sole source of truth until a formal complete migration (never a file-level copy/cherry-pick) is approved and validated. mythos-os is understood to be a populated PRIVATE repo holding a stale 2026-07-29 working copy (427 KB, matching PC copy 'C:\Users\Othman\Desktop\2607 bureau', 225 files); anonymous API access returns 404 and no credential for it exists on the VPS. Gate verdict: 'REPO_MIGRATION: BLOCKED — NOT AUTHORISED'; blocking precondition is verifying the target is empty/decommissioned/ready. No agent may treat it as source of truth, push to it, or reconfigure services toward it.

*Evidence:* docs/MYTHOS_REPOSITORY_MIGRATION.md §0–§3, §7; docs/ROADMAP.md lines 261, 269; docs/CHANGELOG.md line 65; docs/AI_HANDOVER.md lines 2158–2169, 6422

### `othoth77/idauto`

The repository exists on GitHub (public; last pushed 2026-08-18, confirmed via the GitHub API), but mythos-prod's documentation never references it — a repo-wide grep for 'othoth77/idauto' returned no matches. Inside mythos-prod, ID Auto exists as a product track (projects/idauto/, docs/IDAUTO_*.md), the domain idauto.tn, and the idauto-postgres container. Whether this standalone repo relates to that track (mirror, extract, or something else) is UNVERIFIED — inspect it before assuming.

*Evidence:* GitHub API listing (existence only). Relationship UNVERIFIED — not referenced in mythos-prod docs.

### `othoth77/fixpert`

Private off-host protection repo for the VPS directory projects/fixpert (13 files, 97,216 bytes, commit a2ccf83..., remote-verified). It was an empty public placeholder created 2026-07-29 that was switched to private and reused on owner authorisation. Separately, the Fixpert business/product is an EXTERNAL production workshop system whose runtime source code is NOT in mythos-prod — it is the first Atelier Network pilot and first Smart Gate (ANPR) integration; mythos-prod holds only integration contracts and the documented (not created) 'fixpert' schema boundary.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 27, 50; docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md §4/§4.1; docs/IDAUTO_FIXPERT_INTEGRATION.md §1, §6–§7; docs/CLOUDFLARE_DOMAIN_INVENTORY.md fixpert.tn risks

### `othoth77/ssangyong`

Private off-host protection repo for the VPS directory projects/ssangyong (196 files, 11,431,685 bytes, commit e347e76..., remote-verified). Was an empty public placeholder switched to private and reused. Separately, ssangyong.autos (SsangYong Parts storefront) is documented as an existing EXTERNAL commercial system whose source code is NOT in mythos-prod — the Parts Network pillar treats it as an external data source subject to LEGAL-REVIEW-REQUIRED before integration; its domain has DNSSEC already ENABLED at OVH (a flagged migration risk).

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 23, 49; docs/AUTOMOTIVE_PRODUCT_PORTFOLIO.md §5 (Parts Network note); docs/CLOUDFLARE_DOMAIN_INVENTORY.md §7 ssangyong.autos

### `othoth77/mythos-app`

Private off-host protection repo for VPS directory projects/mythos-app (8 files, 110,028 bytes, commit ecf563f..., remote-verified, no runnable tests). Also listed by design-recovery docs as a possible source of app-era design assets; a search of it was denied by the session classifier and it was not searched.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 29; docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md line 205; docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md lines 52, 144

### `othoth77/mythos-prod-unversioned-snapshot`

Private off-host protection repo holding the mythos-prod unversioned snapshot from VPS path projects/_snapshots (127 files, 1,136,364 bytes, commit e147657..., remote-verified). Design-recovery work later searched it exhaustively for logo/vector sources.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 24; docs/design-recovery/MYTHOS_ORIGINAL_LOGO_RECOVERY.md line 204; docs/design-recovery/PENDING_VECTOR_SOURCE_TASK.md line 143

### `othoth77/knowledgevault-kms`

Private off-host protection repo for VPS directory projects/knowledgevault-kms (753 files incl. generated .gitignore, 4,337,768 bytes, commit 25a2956..., remote-verified). Described as 752 distinct files — the largest single body of work outside mythos-prod; whether it is an ecosystem project, internal tooling, or archive is an undecided owner question (ECO-3).

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 21; docs/MYTHOS_PROJECT_DESIGN_MATRIX.md line 107; docs/MYTHOS_DESIGN_DECISIONS.md ECO-3 (line 942); docs/MYTHOS_DESIGN_RECOVERY.md lines 36, 58

### `othoth77/oth-master`

Not mentioned anywhere in this repository's documentation.

*Evidence:* UNVERIFIED — not referenced in mythos-prod docs (repo-wide grep for 'oth-master' returned no matches)

### `othoth77/classepro`

Private off-host protection repo for VPS directory projects/classepro (2 files, 470,300 bytes, commit a76e4ef..., remote-verified). One of the 14 non-Git projects given independent off-host protection in migration Phase 1.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 34

### `othoth77/agribee`

Private off-host protection repo for VPS directory projects/agribee (7 files, 1,225,790 bytes, commit 1443558..., remote-verified). The AgriBee product also has domain agribee.tn in the Cloudflare inventory (OVH DNS, distinct origin IP 51.91.236.255, no forced HTTPS).

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 30; docs/CLOUDFLARE_DOMAIN_INVENTORY.md §1 agribee.tn

### `othoth77/darhijama`

PUBLIC pre-existing Git-backed project at VPS path projects/darhijama, HEAD 0aea9267 — documented as the canonical NotreJour application on branch release/darhijama-1.0.3: the migrated PC copy matched it 550/550 files with zero differences, and it contains the same Laravel package notrejour/notre-jour as othoth77/notrejour. Its PUBLIC visibility is flagged as an inherited default, not a recorded decision. Open owner question: whether othoth77/notrejour is retired in its favour.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 70, 75–93; docs/AI_HANDOVER.md lines 6666, 6783, 6852

### `othoth77/uthina-chess`

Private off-host protection repo for VPS directory projects/uthina-chess (221 files, 102,652,256 bytes, commit c8c33ea..., remote-verified). Created by switching the empty public placeholder othoth77/uthinachess to private and renaming it to uthina-chess (GitHub keeps a redirect). Distinct from the uthinachess.tn domain, which hosts the live production Mythos OS application at /var/www/uthinachess/0726/Prod/.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 22, 46–48; docs/CLOUDFLARE_DOMAIN_INVENTORY.md §8 uthinachess.tn

### `othoth77/telegram-bot`

Mentioned only as one of the three repositories on the othoth77 account that remain PUBLIC (alongside mythos-prod and darhijama). No project directory, code, or integration relationship with mythos-prod is documented.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 93 ('telegram-bot is also public'); docs/AI_HANDOVER.md line 6578

### `othoth77/festival`

Private off-host protection repo for VPS directory projects/festival (4 files, 79,320 bytes, commit 853c4e5..., remote-verified). One of the 14 protected non-Git projects; contains Arabic-named festival HTML files per the registry's byte-counting note.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 32, 58–61

### `othoth77/chatrange`

Private off-host protection repo for VPS directory projects/chatrange (4 files, 6,460,074 bytes, commit f949d48..., remote-verified).

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 31

### `othoth77/karhmana`

Private off-host protection repo for VPS directory projects/karhmana (16 files, 525,892 bytes, commit cf0aea8..., remote-verified).

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 26

### `othoth77/notre-jour`

A third private NotreJour-related repository. Per ratified owner decision O-DEPLOY-1 amendment (2026-08-15), it is the authorised deployment source for the Dar Hijama production application running in Coolify (project 'darhijama', environment 'production', application 'dar-hijama', branch release/darhijama-1.0.3, build pack dockercompose); a staging Coolify application was also created from it via GitHub App 'mythosprod-deploy' using /docker-compose.staging.yml. The amendment explicitly notes mythos-prod is NOT the deployment source for Dar Hijama.

*Evidence:* docs/AUTOMATION_ROADMAP.md lines 120–125 (O-DEPLOY-1 amendment); docs/AI_HANDOVER.md lines 3787, 3835–3837; docs/OFFHOST_PROJECT_REGISTRY.md line 79

### `othoth77/notrejour`

Private, separate and ACTIVELY MAINTAINED NotreJour repository (VPS checkout projects/mythos/notrejour, local HEAD e8bf... stale — remote 52e7b2fd is 15 commits ahead). Explicitly corrected in AI_HANDOVER as 'NOT dormant'. Whether it is intentionally parallel to othoth77/darhijama (white-label per client) or an unintended fork is an open owner question; neither was archived, merged, or overwritten.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 71, 75–84; docs/AI_HANDOVER.md lines 6729, 6852

### `othoth77/oudhna-service`

Private off-host protection repo for VPS directory projects/oudhna-service (3 files, 66,269 bytes, commit d043c9f..., remote-verified). Noted in the registry's byte-accounting caveat: an early pass undercounted it at 276 bytes because of Git-quoted Arabic filenames.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md lines 33, 58–61

### `othoth77/darhijama-site`

Private off-host protection repo for VPS directory projects/darhijama-site (22 files, 493,191 bytes, commit 9b2e810..., remote-verified) — distinct from the public othoth77/darhijama Laravel application repo.

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 25

### `othoth77/nettoyage-photo-vps`

Private off-host protection repo for VPS directory projects/nettoyage-photo-vps (11 files, 93,683 bytes, commit 5a1fcd0..., remote-verified).

*Evidence:* docs/OFFHOST_PROJECT_REGISTRY.md line 28

---

## 3. Shared infrastructure & deployment

Documented model (all from repo docs; no secrets included). SOURCE OF TRUTH: othoth77/mythos-prod (public), branch main; VPS Git checkout at /home/deploy/projects/mythos-prod, embedded in operational tooling (docs/MYTHOS_REPOSITORY_MIGRATION.md §4.2). PRODUCTION APP: the live Mythos OS application is served from /var/www/uthinachess/0726/Prod/ at https://uthinachess.tn — Git is never initialized inside /var/www; deploys are rsync of source files only, excluding appdata/, documents/, google_config.php, ACCES.txt, data/restore-*.js (docs/production-safety.md). WORKTREES: AGENTS.md §4 mandates persistent stage worktrees, recommended pattern /srv/mythos/repository + /srv/mythos/worktrees/<stage-name> (e.g. /srv/mythos/worktrees/stage-4b); the orchestrator runbook additionally uses /home/deploy/projects/worktrees/<task-id> and the AI executor uses /home/ubuntu/mythos-ai-executor/worktrees/<mission>/<task>; some cloud session environments note /srv/mythos does not exist there. VPS/COOLIFY: an OVH VPS runs Docker with Coolify as the deployment control plane (coolify-db PostgreSQL 15, 66 tables, infrastructure-classified, must never host application data); idauto-postgres (postgres:15-alpine, 'idauto' DB, 24 tables/2,551 rows, 11 MB, production personal data); MySQL 8.4 darhijama_prod (39 tables) plus a staging twin; six transient Redis containers; n8n 2.29.9 in Docker with 5 MYTHOS + 3 SSANGYONG workflows (live host state, not in Git); disk was at 94% with 4.6 GB free (docs/MYTHOS_SUPABASE_MIGRATION_DESIGN.md §1, §4). Coolify runs the Dar Hijama production app from othoth77/notre-jour @ release/darhijama-1.0.3 (O-DEPLOY-1 amendment, docs/AUTOMATION_ROADMAP.md); coolify.mythosprod.xyz is the only live administrative hostname in public DNS. Host state outside Git also includes the root-installed push relay /usr/local/bin/mythos-git-push (systemd unit, hardcodes REPO=/home/deploy/projects/mythos-prod) and the mythos-ai-executor systemd user unit for 'ubuntu'. CLOUDFLARE: staged migration INF-CF-0 (architecture, done) through INF-CF-7 (monitoring/rollback/restore handover) per docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md — INF-CF-1 domain inventory complete, INF-CF-2 DNS migration, INF-CF-3 remotely managed Cloudflare Tunnel as a cloudflared container in Coolify (token only in Coolify encrypted env vars; deploy/cloudflare/cloudflared.env.example holds empty placeholders), INF-CF-4 Cloudflare Access deny-by-default for private hostnames (app auth remains mandatory behind it), INF-CF-5 TLS/WAF/rate limiting/DNSSEC (Full (strict) TLS only; Flexible prohibited), INF-CF-6 R2 and external backup integration. DOMAIN INVENTORY (docs/CLOUDFLARE_DOMAIN_INVENTORY.md, INF-CF-1): 8 domains (agribee.tn, darhijama.tn, fixpert.tn, idauto.tn, mythosprod.xyz, notrejour.tn, ssangyong.autos, uthinachess.tn), all registered at OVH with OVH authoritative DNS; six share origin IP 51.68.226.211; key findings — mythosprod.xyz (the umbrella infrastructure domain) has no working web presence (HTTP redirects to darhijama.tn, HTTPS cert mismatch); DNSSEC already ENABLED on mythosprod.xyz and ssangyong.autos requiring coordinated DS-record cutover; idauto.tn has no HTTPS listener at all; uthinachess.tn hosts the live production app and needs separate explicit migration sign-off; no domain publishes DMARC or CAA; all certs are Let's Encrypt; no domain was marked ready for nameserver migration. BACKUPS: the off-host backup gate (docs/OFF_HOST_BACKUP_GATE.md) CLOSED 2026-08-14 on one verified batch — in-container pg_dump -Fc of idauto and coolify plus mysqldump --single-transaction of darhijama_prod, SHA-256 round-trip (C1==C2 on fresh download), and isolated scratch-container restore tests (tmpfs, --network none, version-matched images) — uploaded via the repo's own provider-neutral S3-compatible tooling (projects/idauto/ops/offhost-backup.js + projects/idauto/ops/adapters/s3-compatible.js) to Cloudflare R2 bucket 'mythos-offhost-backups' with a bucket-scoped credential; the config is expected at ~/.config/mythos/idauto-offhost.env, mode 0600, created by the owner, never committed. Closure is explicitly one batch, not a schedule. Separately, docs/OFFHOST_PROJECT_REGISTRY.md records 100% off-host protection of the 14 non-Git VPS project directories in 14 private GitHub repos (1,373 project files), with databases and 18 sensitive VPS_TRANSFER files deliberately excluded from GitHub. SECRETS: per docs/AUTOMATION_SECURITY_AND_SECRETS.md, secret values may live only in VPS environment variables, Coolify encrypted secret variables, an approved secret manager, short-lived tokens, or service accounts; the database stores metadata-only secret references (aut_secret_references — never token/password/key values, a permanent schema rule); secrets are forbidden in Git, docs, logs, examples, and client-side storage, and any exposed secret must be rotated at source immediately. MIGRATION GATE: a future complete repository migration mythos-prod → mythos-os is recorded but BLOCKED — NOT AUTHORISED (docs/MYTHOS_REPOSITORY_MIGRATION.md).
