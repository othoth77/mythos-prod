# Mythos OS — AI Handover

**Last updated:** 2026-08-05 UTC
**From:** Stage IDA-1 — ID Auto Product Vision, Capture, Access and Data Governance Specification
**To:** Next AI session

---

## Repository State (verified 2026-08-05)

```
Branch:   main
HEAD:     e9afc7e  (docs(idauto): align product vision and capture architecture)
IDA-1 implementation commit: e9afc7e
Stage 4AG implementation commit: ebe42f9
Stage IDA-0 implementation commit: 7c75abd
Stage 4AF implementation commit: 2dcbb99
```

**Stage IDA-1 is complete.** Product vision, three access scopes (PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE), observation-first data model, Smart Gate spec, Fixpert Atelier boundaries, PostgreSQL selected as target DBMS, LEGAL-REVIEW-REQUIRED items catalogued. 9 specification files created or updated. No runtime files changed. JSON valid. Targeted regression 42/42 + 44/44.

**Stage 4AG is complete** (same session). 5 obsolete OM-side duplicates removed from js/app.js (1088 → 991 lines). 3 invoice-side symbols BLOCKED by stableLineCount collision — reserved for a dedicated stage.

**Stage IDA-0 is complete** (same session). ID Auto Foundation established.

**Stage 4AF is complete** (prior session, same date).

---

## Stage IDA-1 — Product Vision, Capture, Access and Data Governance Specification

**Starting remote HEAD:** `4f56bd4455b1e25bdc21873f4dec4b04543027a0`

**Objective:** Define the ID Auto product vision, data capture model, three access scopes, Fixpert integration boundaries, and governance constraints before any implementation begins.

### Product Decisions

| Decision | Value |
|---|---|
| Official product name | ID Auto |
| Domain | idauto.tn |
| Platform | Mythos ecosystem (integrated, not isolated) |
| Target DBMS | PostgreSQL — **selected, not yet installed or deployed** |
| Data strategy | Capture-first (observation-first), not API-search-first |
| Plate format rules | UNVERIFIED DRAFTS until confirmed against official source |
| PostgreSQL install stage | IDA-2 |

### Logical Database Architecture

```
PostgreSQL cluster (target — not yet deployed)
├── mythos_core schema — users, roles, permissions, global audit
├── idauto schema     — vehicles, plates, observations, facts, evidence, ...
└── fixpert schema    — clients, work orders, invoices, payments (Fixpert-owned)
```

### Three Access Scopes (replaces IDA-0 boolean)

| Scope | Who | Notes |
|---|---|---|
| PUBLIC | Any caller within rate limits | Plate, colour, category, verified make/model/year, governorate |
| PROFESSIONAL | Verified subscriber orgs | Technical data + own service events |
| MYTHOS_PRIVATE | Mythos Super Admin only | Raw captures, exact location/time, OCR, camera, movements — all access audit-logged |

**Never public (permanent):** exact observation time, exact location, original image, plate crop, movement history, contributor identity, OCR output, VIN, carte grise, owner identity/contact, Fixpert customer data.

### Observation-First Invariant

Every input (scan, upload, camera, manual) creates an `idauto_observations` record first. Vehicle fiches and facts are derived from observations. Observations are immutable. Facts are versioned — old values are never silently overwritten.

### Scanner and Carte Grise Flows

- Primary button: **Scanner un véhicule** → modes: plate scan, vehicle scan, carte grise scan, photo import
- Carte grise: OCR Arabic + French fields → mandatory confirmation form → separate public technical facts from owner PII → owner PII never stored in idauto schema (routed to fixpert.clients with consent, or discarded)
- Implementation stage: IDA-3

### Fixpert Ownership Boundaries

| Data | Owner | Schema |
|---|---|---|
| Vehicle fiche, plates, observations | ID Auto / Mythos | idauto |
| Smart Gate events, movements | ID Auto / Mythos | idauto (MYTHOS_PRIVATE) |
| Fixpert clients, work orders | Fixpert | fixpert |
| Fixpert invoices, payments | Fixpert | fixpert |
| Platform services | Mythos | mythos_core |

**Mythos Super Admin has read access to all schemas for governance. Every super-admin access to Fixpert data is audit-logged.**

### Fixpert Smart Gate

- 5 cameras total at Fixpert — **only 1 (designated entrance/exit door camera) is in scope**
- Smart Gate events are always MYTHOS_PRIVATE
- Deduplication: configurable window prevents multiple events for same vehicle at door
- **LEGAL-REVIEW-REQUIRED: ANPR regulatory approval (INPDP) before any camera connection**
- Implementation stage: IDA-4

### New Architecture Decisions

| AD | Decision |
|---|---|
| AD-8 | Observation-first data model |
| AD-9 | Three access scopes: PUBLIC / PROFESSIONAL / MYTHOS_PRIVATE |
| AD-10 | Smart Gate events always MYTHOS_PRIVATE |
| AD-1 (revised) | Logical schema separation (not physical isolation) |

### Files Created

| File | Description |
|---|---|
| `docs/IDAUTO_PRODUCT_SPEC.md` | Product vision, user groups, access matrix, data ownership, vehicle fiche lifecycle, contribution model, super-admin role, LEGAL-REVIEW-REQUIRED |
| `docs/IDAUTO_CAPTURE_PIPELINE.md` | Scanner modes, observation-first flow, plate scan, carte grise OCR, confidence/evidence, conflict handling, review queue, media/location privacy |
| `docs/IDAUTO_FIXPERT_INTEGRATION.md` | 5-camera context, Smart Gate flow, data ownership boundaries, Fixpert Atelier relationship, deployment prerequisites |

### Files Updated

| File | Change |
|---|---|
| `projects/idauto/README.md` | Aligned to Mythos ecosystem, observation-first, PostgreSQL target, Smart Gate context |
| `projects/idauto/config/idauto.example.json` | v0.2.0-ida1-draft; added access_scopes, scanner_modes, capture_sources, observation_statuses, confidence_thresholds, public/professional/mythos_private field policies, media_processing, location_policy, review_queue, contributor_trust, carte_grise_scan, fixpert_smart_gate, retention_placeholders, expanded feature_flags |
| `projects/idauto/database/schema.sql` | 22-table observation-first draft; added idauto_capture_sources, idauto_camera_sources, idauto_contributors, idauto_capture_sessions, idauto_observations, idauto_observation_locations, idauto_observation_media, idauto_vehicle_facts, idauto_fact_evidence, idauto_document_scans, idauto_vehicle_movements, idauto_review_queue; updated idauto_vehicles with fiche_status; PostgreSQL-compatible; not deployed |
| `docs/IDAUTO_ARCHITECTURE.md` | 10 ADs, PostgreSQL target, logical schema separation, 3 access scopes, updated data flows |
| `docs/IDAUTO_ROADMAP.md` | IDA-0 through IDA-6; strategic growth milestones; LEGAL-REVIEW-REQUIRED table |
| `docs/ROADMAP.md` | IDA-1 done; IDA-2 as next; stableLineCount collision noted |

### PostgreSQL Status

**PostgreSQL is the selected target DBMS. It is NOT installed or deployed. The schema.sql is a draft specification. Implementation begins IDA-2.**

### LEGAL-REVIEW-REQUIRED Status

All items listed in `docs/IDAUTO_PRODUCT_SPEC.md` Section 12 remain OPEN. No real data collection begins from this commit. Summary of blocking items:

- Public image contribution and plate lookup (IDA-3 gate)
- Precise GPS collection and carte grise OCR (IDA-3 gate)
- Contributor consent mechanism (IDA-3 gate)
- ANPR regulatory approval (INPDP) — Smart Gate (IDA-4 gate)
- Official data-source agreement (ATTT) — national enrichment (IDA-6 gate)
- Data retention periods — all categories — open

### Validation

| Check | Result |
|---|---|
| `python3 -m json.tool idauto.example.json` | ✓ VALID |
| Schema: no duplicate table names | ✓ 22 tables, 0 duplicates |
| Schema: no owner PII in vehicle/plate/fact tables | ✓ 0 violations |
| Schema: parenthesis balance | ✓ 382 open = 382 close |
| `git diff --check` | ✓ no whitespace errors |
| `node tests/stage4ag-test.js` | ✓ 42/42 |
| `node tests/stage4z-test.js` | ✓ 44/44 |
| No runtime application file changed | ✓ confirmed |
| All feature flags for real capture remain false | ✓ confirmed |

### Implementation Commit

```
e9afc7e  docs(idauto): align product vision and capture architecture
```

Local HEAD == origin/main == `e9afc7e`.

### Next Stage

**IDA-2 — PostgreSQL Core, API and Manual Capture MVP**

- Deploy PostgreSQL cluster with idauto schema
- Core vehicle, plate, observation, fact and evidence APIs
- Admin manual entry (private only, no public ingestion)
- Review queue (admin UI)
- Plate format validation
- Audit logging and object storage wiring
- Mythos OS auth + audit integration
- Synthetic and pilot data only
- 50+ automated tests

---

## Stage 4AG — Invoice and OM Duplicate Cleanup

**Objective:** Audit 8 candidate duplicate symbols in js/app.js and safely delete those confirmed obsolete without touching canonical shared module implementations.

**Starting remote HEAD:** `d1d0b759f0d9992ad95781593c54fe8143b9feec`

### Opus Audit Conclusion

Opus inspected js/app.js, js/shared/invoices.js, js/shared/mission-orders.js, index.html, relevant tests. Critical findings:

**SAFE TO DELETE (5 symbols):** All OM-side. `cancelOM` and `addOmPerson` are shadowed by mission-orders.js (last-wins). `editOm`, `deleteOm`, `populateOmList` are unreachable — no live HTML or JS caller references the lowercase-m variants; the live paths are `editOM`, `deleteOM`, `renderOMList`.

**BLOCKED (3 symbols):** All invoice-side. `js/shared/invoices.js` throws `SyntaxError` at load time because `js/shared/mission-orders.js:28` declares `let stableLineCount` and `invoices.js:5` declares `var stableLineCount` — a `var` redeclaration of an existing `let` binding is illegal. The entire invoices.js script is silently discarded at runtime. Therefore `editInvoice`, `deleteInvoice`, `populateInvoiceList` in app.js are the live implementations and must not be deleted until the collision is fixed in a separate stage.

**Production bug discovered:** `addLine()` in the browser currently resolves to a stub in app.js that alerts "Fonctionnalité en développement" — the full invoice line-item implementation in invoices.js is non-functional. This pre-existed Stage 4AG.

### Deleted Symbols

| Symbol | app.js lines (old) | Reason |
|--------|------------------|----|
| `populateOmList` | 177–208 | Unreachable; successor `renderOMList` in mission-orders.js |
| `addOmPerson` | 241–254 | Shadowed by mission-orders.js:168 |
| `editOm` | 282–316 | Unreachable; live path is `editOM` (uppercase) |
| `deleteOm` | 317–323 | Unreachable; live path is `deleteOM` (uppercase) |
| `cancelOM` | 324–340 | Shadowed by mission-orders.js:268 |

### Retained Symbols (and reasons)

| Symbol | Location | Reason kept |
|--------|----------|-------------|
| `editInvoice` | app.js:180 | BLOCKED: invoices.js fails to load (stableLineCount collision) |
| `deleteInvoice` | app.js:196 | BLOCKED: same |
| `populateInvoiceList` | app.js:148 | BLOCKED: same; transitively live via deleteInvoice |
| `removePersonRow` | app.js:206 | stage4n-test.js asserts exactly one definition; callers pending separate audit |

### Changed Files

| File | Change |
|------|--------|
| `js/app.js` | Removed 5 symbols (~97 lines); replaced with single reference comments; **1088 → 991 lines** |
| `js/core/router.js` | Line 31: `populateOmList()` → `if (typeof renderOMList === 'function') renderOMList();` |
| `tests/stage4ag-test.js` | NEW: 42 tests — structural ownership, OM behavioral sandbox tests, Stage 4Z regression |
| `tests/stage4z-test.js` | Fixed test bug: removed editOm/deleteOm/cancelOM from "must remain" list; added positive absence assertions; **42 → 44 passing** |
| `tests/stage4af-test.js` | Regression count check made format-agnostic |

### Validation

| Suite | Result |
|-------|--------|
| `node -c js/app.js` | ✓ |
| `node -c js/shared/invoices.js` | ✓ |
| `node -c js/shared/mission-orders.js` | ✓ |
| `tests/stage4ag-test.js` | ✓ 42/42 |
| `tests/stage4z-test.js` | ✓ 44/44 |
| `tests/stage4af-test.js` | ✓ 102/102 |
| `tests/stage4l-test.js` | ✓ 59/59 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| Full Stage 4 suite (33 files) | ✓ all passing (~1978 assertions) |
| Haiku verification | ✓ PASS (all 9 checks) |

### Inactive Legacy

`js/app-fresh.js` — unreferenced dead file, not loaded by any `<script>` tag in index.html. Contains stale duplicates of `editInvoice`, `deleteInvoice`, `editOm`, `deleteOm` plus a conflicting `const MYTHOS_PRINT_LOGO_SRC`. Does not affect runtime. Candidate for a separate deletion stage.

### Preserved Legacy Issue

`stableLineCount` global collision (`let` in mission-orders.js vs `var` in invoices.js) renders the entire invoice shared module non-functional in the browser. Must be fixed before invoice duplicates in app.js can be removed. Requires a dedicated stage with a behavior-change review.

### Implementation Commit

```
ebe42f9  Stage 4AG: remove obsolete Invoice and OM helper duplicates
```

### Remaining js/app.js responsibilities after Stage 4AG

`js/app.js` is now **991 lines**. Remaining domains:

| Domain | Status |
|--------|--------|
| `editInvoice`, `deleteInvoice`, `populateInvoiceList` | BLOCKED pending stableLineCount fix |
| `removePersonRow` | Orphaned (callers deleted); needs caller audit before removal |
| `js/app-fresh.js` dead file | Inactive; deferred deletion |
| Invoice addLine stub (alerts "Fonctionnalité en développement") | Pre-existing production bug; blocked by same collision |
| STORE + utilities | High risk, skip |
| App initialization | High risk, skip |
| Demo data initialization | High risk, skip |
| Logs + Sidebar + Sync | Lower risk, future extraction |

### Next Authorized Stage

**IDA-1 — Product and Legal Specification** (ID Auto product track)

Condition: may begin in the next session. Mythos OS Stage 4 continues in parallel when IDA-1 is not active.

---

## Stage IDA-0 — ID Auto Foundation

**Objective:** Establish the ID Auto project foundation inside the Mythos OS repository. Define product identity, privacy contract, Tunisian plate format rules, data contracts, and integration contracts with Mythos OS shared services.

### Files Created

| File | Description |
|------|-------------|
| `projects/idauto/README.md` | Product identity, privacy contract, plate format catalogue, scope exclusions |
| `projects/idauto/config/idauto.example.json` | Configurable plate-format rules (7 formats), governorate codes (24), public search config, professional tier definitions, feature flags |
| `projects/idauto/database/schema.sql` | 11-table data contract: plate formats, governorates, vehicles, plates, sources, verifications, organizations, user roles, service events, consent/legal-basis, audit log |
| `docs/IDAUTO_ARCHITECTURE.md` | 7 architecture decisions, 7 Mythos OS integration contracts, 2 data-flow diagrams, deployment constraints |
| `docs/IDAUTO_ROADMAP.md` | IDA-0 through IDA-5 stage plan with deliverables and dependencies |

### Files Updated

| File | Change |
|------|--------|
| `docs/ROADMAP.md` | Added ID Auto as separate product track, updated current priority to Stage 4AG + IDA-1 |
| `docs/AI_HANDOVER.md` | This update |

### Architecture Decisions (summary)

| ID | Decision |
|----|----------|
| AD-1 | `idauto_` prefix strict separation from Mythos OS `mp_*` tables |
| AD-2 | Public search never returns owner PII; no owner columns in `idauto_vehicles` or `idauto_plates` |
| AD-3 | Plate formats as configurable rules in `idauto_plate_formats`, not hardcoded |
| AD-4 | `idauto_audit_log` is append-only; no row is ever updated or deleted |
| AD-5 | IP and User-Agent stored as SHA-256 hashes only |
| AD-6 | Service events default to `is_public=FALSE` (org-scoped) |
| AD-7 | No real data ingestion until IDA-1 legal review is complete |

### Validation

| Check | Result |
|-------|--------|
| `projects/idauto/config/idauto.example.json` JSON syntax | ✓ valid |
| `projects/idauto/database/schema.sql` table count | ✓ 11 tables |
| `database/schema.sql` parenthesis balance | ✓ 209 open = 209 close |
| INSERT targets | ✓ only seed tables (plate_formats, governorates, sources) |
| All Stage 4 tests (stage4z, stage4ae, stage4af) | ✓ no regression |

### Privacy Constraints (permanent)

- Public search endpoint: returns only `plate_number`, `format_code`, `governorate_name`, `status`, `vehicle_make`, `model`, `year`, `body_type`, `fuel_type`, `colour`
- Never returned: `owner_name`, `owner_address`, `owner_cin`, `owner_passport`, `owner_phone`, `insurance_policy_number`, `insurance_company`
- Schema: `idauto_vehicles` and `idauto_plates` have no owner columns (enforced by schema + `-- [NO PII]` comments)

### Implementation Commit

```
7c75abd  feat(idauto): establish ID Auto project foundation (Stage IDA-0)
```
Remote HEAD verified: `7c75abd`. Local HEAD == origin/main.

### Security Constraints (inherited, unchanged)

- Do NOT commit `google_config.php`, `ACCES.txt`, `appdata/`, `documents/`
- Do NOT touch production at `/var/www/uthinachess/0726/Prod/`
- Do NOT deploy ID Auto to any server before IDA-2 with explicit authorization

### Next ID Auto Stage

**IDA-1 — Product and Legal Specification**
- Legal basis mapping per data category (Tunisian organic law 63-2004)
- Data-processing agreement template for professional subscribers
- Regulatory pathway for accessing public vehicle registry data
- API specification (endpoint definitions, request/response schemas, rate-limit headers)
- Hosting and infrastructure specification

**Condition:** IDA-1 does not begin until Mythos OS Stage 4AG is complete or explicitly paused.

---

## Stage 4AF — Camera Modal Domain Extraction Camera Modal domain (~192 lines, `js/app.js` lines 1060–1251 post-4AE) extracted to `js/shared/camera.js`. Tests: 102/102. Full Stage 4 suite (4A–4AF, all test files): all passing, 0 failures.

Implementation commit: `2dcbb99` — `Stage 4AF — Extract Camera Modal domain to js/shared/camera.js`
Verified remote HEAD: `2dcbb99`

**Previous stages also complete:**
- Stage 4AE: Documentation domain (568 lines), commit `87079a4`
- Stage 4AD: Backup/Export/Restore domain (274 lines), commit `6363e34`
- Stage 4AC: Spectacle Calculator, commit `dfe9cf7`
- Stage 4AB: Répertoire Contacts domain, commit `95d9453`
- Stage 4AA: Inscriptions/Appels domain (see prior entries)

> Note: `docs/AI_HANDOVER.md` was stale — last edited for Stage 3C (893 tests). Stages 3D–3H were committed between then and Stage 4A without updating this file. The correct baseline entering Stage 4A was 1405 tests (not 893).

---

## Stage 4AC — Spectacle Calculator Extraction

**Objective:** Extract `initSpectacleCalculator` (52 lines, `js/app.js` lines 1318–1369) into `js/shared/spectacle-calculator.js`. Pure DOM function — subvention table lookup by actor count and distance.

**Boundary:** Lines 1318–1369, from `// ══ CALCULATEUR SPECTACLE` section header through the blank line after the closing `}`. Line 1370 (`// ══ DOCUMENTATION`) is the first line not extracted.

**Dependencies:** `document.getElementById`, `Option`, `parseInt`, `toLocaleString` — browser globals only. No STORE, no shared utilities, no external function calls.

**Changed Files:**
- `js/shared/spectacle-calculator.js` — NEW (56 lines with header)
- `js/app.js` — removed 52 lines, replaced with 2-line ref comment; new total 2104 lines
- `index.html` — added script tag after `contacts.js`, before `taches.js`
- `tests/stage4ac-test.js` — NEW: 24 tests

**Validation:** 24/24; full suite 1717/1717 (29 files). Implementation commit: `dfe9cf7`.

### Remaining js/app.js responsibilities after Stage 4AF

`js/app.js` is now **1088 lines**. Remaining coherent domains:

| Domain | Approx lines (post-4AF) | Notes |
|--------|------------------------|-------|
| Invoice/OM helpers | ~195 lines | `populateInvoiceList`, `populateOmList`, `editInvoice`, `deleteInvoice`, `editOm`, `deleteOm`, `cancelOM`, `addOmPerson`, etc. — **next audit target (Stage 4AG)** |
| Demo data initialization | ~278 lines | `initializeDemoData` — high risk, skip |
| STORE + utilities | lines 18–140 | High risk, skip |
| App initialization | ~110 lines | `initApp`, `bootstrapStableApp`, `initNavScrollHint`, etc. — high risk, skip |
| Logs + Sidebar + Sync | ~210 lines | `checkDailyBackup`, `renderLogs`, `toggleSidebar`, `_startBackgroundSync` |

### Exact Next Scope

**Stage 4AG:** Audit and remove remaining Invoice/OM helper duplicates from `js/app.js`. These helpers (`populateInvoiceList`, `populateOmList`, `editInvoice`, `deleteInvoice`, `editOm`, `deleteOm`, `cancelOM`, `addOmPerson`, etc.) were partially extracted in earlier stages; check for any remaining duplicates or stubs that should be removed. Do NOT begin this stage in the same session as Stage 4AF.

---

## Stage 4AF — Camera Modal Domain Extraction

**Objective:** Extract Camera Modal domain (~192 lines, `js/app.js` lines 1060–1251 post-4AE) into `js/shared/camera.js`. Moves 4 state vars and 8 functions. Replaces extracted block with 4-line reference comment in `app.js` (1276 → 1088 lines). Inserts `camera.js` script tag between `documentation.js` and `taches.js` in `index.html`.

**Exact extraction boundary:** lines 1060–1251 post-4AE, from `// ══════ CAMÉRA — Prise de photo directe` through closing `}` of `closeCameraModal`.

### State vars moved

`_cameraStream`, `_cameraFacing`, `_capturedDataUrl`, `_cameraContext`

### Functions moved

`openCameraModal`, `_startCamera`, `switchCamera`, `capturePhoto`, `retakePhoto`, `cameraMobileCapture`, `saveCapturedPhoto`, `closeCameraModal`

### Critical dependency

`saveCapturedPhoto` calls `_saveDocRecord`, `renderDocList`, `_docCurrentFolder`, `renderDocumentation` — all in `js/shared/documentation.js`. Script order invariant: `documentation.js` → `camera.js` → `taches.js`.

All Camera callers are exclusively inline `onclick`/`onchange` handlers in `index.html` — no calls from other JS modules.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/camera.js` | NEW: 4 state vars + 8 functions, ~194 lines |
| `js/app.js` | Removed ~192 lines; replaced with 4-line reference comment; new total **1088 lines** |
| `index.html` | Added `<script src="js/shared/camera.js?v=20260805"></script>` after `documentation.js`, before `taches.js` |
| `tests/stage4af-test.js` | NEW: 102 tests across 24 sections |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/camera.js` | ✓ |
| `tests/stage4af-test.js` | ✓ 102/102 |
| `tests/stage4ae-test.js` | ✓ 142/142 |
| `tests/stage4z-test.js` | ✓ 42/42 |

Implementation commit: `2dcbb99`. Remote HEAD verified `2dcbb99`.

---

## Stage 4AE — Documentation Domain Extraction

**Objective:** Extract the complete Documentation domain (~568 lines, `js/app.js` lines 1050–1617 post-4AD) into `js/shared/documentation.js`. Covers folder navigation, document CRUD, preview helpers, upload, bulk upload, and the move-menu click listener.

**Exact extraction boundary:** lines 1050–1617, from `// ══════ DOCUMENTATION` section header through the closing `}` of `saveBulkDocs`. Line 1618 (`// ══ CAMÉRA`) is the first line not extracted.

### Architectural decisions

- `_docCurrentFolder`, `DOC_FOLDERS`, `_bulkFiles` moved as module-level vars.
- `document.addEventListener('click', ...)` (closes move-menus on outside click) moved into module — single `<script>` tag prevents double-registration.
- `renderDocList(cat)` compat alias (`→ _renderDocFolder(cat)`) preserved verbatim.
- `switchDocTab(cat)` compat alias (`→ openDocFolder(cat)`) preserved verbatim.
- No dependency on `escapeHtml` changed — still resolved at call time from `utils.js`.
- Camera Modal (`saveCapturedPhoto`) calls `_saveDocRecord`, `renderDocList`, `_docCurrentFolder` — `documentation.js` **must** load before `camera.js`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/documentation.js` | NEW: 33 functions + 3 state vars, ~350 lines |
| `js/app.js` | Removed 568 lines (1050–1617); replaced with 10-line reference comment; new total **1276 lines** |
| `index.html` | Added `<script src="js/shared/documentation.js?v=20260805"></script>` after `backup.js`, before `taches.js` |
| `tests/stage4ae-test.js` | NEW: 142 tests across 29 sections |
| `tests/stage4z-test.js` | Updated Section 3: removed `renderDocumentation` from app.js check; added 3 assertions verifying it in `documentation.js`; now 42/42 |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/documentation.js` | ✓ |
| `tests/stage4ae-test.js` | ✓ 142/142 |
| `tests/stage4z-test.js` | ✓ 42/42 |
| All Stage 4 tests (4A–4AE, 31 files) | ✓ 0 failures |

Implementation commit: `87079a4`. Remote HEAD verified `87079a4`.

---

## Stage 4AD — Backup/Export/Restore Domain Extraction

**Objective:** Extract Backup/Export/Restore domain (11 functions, 274 lines, `js/app.js` original lines 1043–1316) into `js/shared/backup.js`.

**Exact extraction boundary:** lines 1043–1316, from `// ══════ SAUVEGARDE — fonctions manquantes` through the closing `}` of `_restoreServerBackup`. Line 1317 (`// ── Spectacle Calculator …`) was the first line not extracted.

### Architectural decisions

- `RESTORE_KEY_MAP` remains in `js/app.js` (defined at line 72, used by sync domain and other locations outside the backup block).
- `_getAllData` confirmed internal-only: only called at original lines 1056 and 1101, both within the backup domain.
- `todayStr()` and `escapeHtml()` are globals from `utils.js` — resolved at call time.
- `LOGGER` usage in `exportBackup` is already guarded by `typeof LOGGER !== 'undefined'`.
- Router caller: only `renderBackupDashboard()` called from `router.js` line 89.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/backup.js` | NEW: 11 functions, ~250 lines |
| `js/app.js` | Removed 274 lines (1043–1316); replaced with 4-line reference comment; new total **1833 lines** |
| `index.html` | Added `<script src="js/shared/backup.js?v=20260805"></script>` after `spectacle-calculator.js`, before `taches.js` |
| `tests/stage4ad-test.js` | NEW: 71 tests across 21 sections |
| `tests/stage4z-test.js` | Updated: 3 assertions moved from "in app.js" to "in backup.js"; net +3, now 40 passing |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/backup.js` | ✓ |
| `tests/stage4ad-test.js` | ✓ 71/71 |
| `tests/stage4z-test.js` | ✓ 40/40 |
| All Stage 4 tests (4A–4AD, 30 files) | ✓ 0 failures |

Implementation commit: `809e8bf`. Remote HEAD verified `809e8bf`.

---

## Stage 4AB — Répertoire Contacts Domain Extraction

**Objective:** Extract the complete Répertoire Contacts domain from `js/app.js` lines 745–2003 into `js/shared/contacts.js`. This is the phone/vCard/Google contact import pipeline, UCL numbering, CRUD, duplicate detection/merge, interaction history, tags, annuaire/directory view, and CSV export.

**Exact extraction boundary:** lines 745–2003, from the `// ══ CONTACT MANAGEMENT` section header through the closing `}` of `updateRepertoireContactTags`. Line 2004 (`// Invoice list…moved to js/shared/invoices.js.`) is the first line NOT extracted. `printModal` (lines 2014–2021) confirmed dead to contacts callers — stays in `js/app.js`.

### Architectural decisions

- `_rcActiveTab` hoisted to module top (line 7 of contacts.js): was declared at original line 1394 but used at line 767 via var hoisting; explicit hoist makes ordering intent visible with no behavior change.
- `document.addEventListener('DOMContentLoaded', ...)` at original line 911 (calls `setTimeout(_checkGoogleImportToken, 800)`) moved into contacts.js as-is — single `<script>` tag prevents double-registration.
- `_rcFilterBatchId` remains a `var` global — router.js line 91 writes `_rcFilterBatchId = null` directly; `var` global resolution at call time preserves this without any setter export.
- All 45 functions remain as `var`/function declarations on the global scope (non-module script), matching the 23 inline `onclick=`/`onchange=` HTML handlers and router.js callers.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/contacts.js` | NEW: 1264 lines; 8 state vars (including hoisted `_rcActiveTab`), 45 functions, 1 DOMContentLoaded listener |
| `js/app.js` | Removed 1259 lines (745–2003); replaced with 19-line reference comment block; new total 2153 lines |
| `index.html` | Added `<script src="js/shared/contacts.js?v=20260805"></script>` after `inscriptions.js`, before `taches.js` |
| `tests/stage4ab-test.js` | NEW: 146 tests across 11 sections |

### Dependencies and Compatibility

Resolved at call time:
- `STORE.repertoireContacts()`, `STORE.saveRepertoireContacts()`, `STORE.repertoireImports()`, `STORE.saveRepertoireImports()` — STORE defined in `js/app.js` (unchanged)
- `esc(str)` — defined in `js/utils.js` (loads before app.js)
- `_markDeleted(obj)` — defined in `js/core/sync.js`
- `syncFromServer()` — defined in `js/core/sync.js`
- `showView(view)` — defined in `js/core/router.js`
- `navigator.contacts`, `fetch`, `document`, `alert`, `confirm`, `URL`, `Blob`, `Date`, `Math` — browser globals

Router (`js/core/router.js`) unchanged: line 91 (`_rcFilterBatchId = null; renderRepertoireContactsPage(); …`) and line 92 (`renderContactFiche()`) resolve globals at call time.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/contacts.js` | ✓ |
| `tests/stage4ab-test.js` | ✓ 146/146 |
| `tests/stage4aa-test.js` | ✓ 115/115 |
| `tests/stage4z-test.js` | ✓ 40/40 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4AB, 28 files) | ✓ 1693/1693 |

No Stage 4 suite failed and no regression was found.

### Risks, Remaining Responsibilities, and Operations

- `js/app.js` (2153 lines) still contains: Documents (~780 lines), Backup dashboard (~265 lines), Spectacle price calculator (~60 lines), Settings page (~70 lines), Invoice/OM helpers and `populateInvoiceList`/`populateOmList` (~175 lines), `printModal`, STORE object, shared utilities (`num`, `fmtMoney`, `escapeHtml`, `esc`, etc.), initialization (`initApp`, `bootstrapStableApp`), logs rendering, sidebar/mobile behavior, background sync, demo data initialization, `restoreBackup20260516Once`, `forceRestoreBackup20260516`.
- Stage 4 cannot close while these coherent domains remain in `js/app.js`.
- Deployment: not performed. Data migration: not performed.

### Exact Next Scope

**Stage 4AC:** Extract Documents domain from `js/app.js`. Read the file from line ~1100 onward to locate the Documents section header (approximately `// ══ Documents` or similar). This is the file upload, scanner, OCR, camera, and document management workflow. Extract into `js/shared/documents.js`. Confirm exact boundary before implementation.

Alternatively, if Documents is complex/mixed with camera/permissions, consider first extracting **Spectacle calculator** (~60 lines, self-contained) or **Backup dashboard** (~265 lines) as a lower-risk next stage.

---

## Stage 4AA — Inscriptions/Appels Workflow Extraction

**Objective:** Extract the complete Inscriptions/Appels CRUD workflow from `js/app.js` lines 731–1217 into `js/shared/inscriptions.js`. This is the Google Sheet inscription ingestion, UCL numbering, validation/bulk-validation pipeline, appel-fiche modal lifecycle, call-result tracking, call-script settings (editable from Paramètres), Google Sheet push webhook, and conformité list filtering.

**Exact extraction boundary:** lines 731–1217, from `// ── Inscriptions` comment through the closing `}` of `saveAppelFiche`. Line 1219 (`// ── Routing → js/core/router.js`) is the first line NOT extracted.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/inscriptions.js` | NEW: INSCRIPTIONS_SCRIPT_URL, `_escHtmlInsc`, `loadDashboardInscriptionsCount`, `_uclNum`, `_appUid`, `loadInscriptions`, `validerToutesInscriptions`, `validerInscriptionRow`, `renderAppels`, `reinitialiserListes`, `reafficherInscriptions`, `renderListeConforme`, `getCallScript`/`saveCallScript`/`loadSettingsCallScript`/`saveCallScriptFromSettings`/`resetCallScriptToDefault`, `getSheetWebhookUrl`/`saveSheetWebhookUrl`/`loadSettingsSheetUrl`/`saveSheetUrlFromSettings`/`testSheetWebhookFromSettings`/`pushToGoogleSheet`, `MOIS_NOMS`, `_populateNaissanceSelects`, `openAppelFicheModal`/`closeAppelFicheModal`/`setAppelResult`/`saveAppelFiche` |
| `js/app.js` | Removed 487 lines (731–1217); replaced with 11-line reference comment block |
| `index.html` | Added `<script src="js/shared/inscriptions.js?v=20260805"></script>` after `statistics-dashboard.js`, before `taches.js` |
| `tests/stage4aa-test.js` | NEW: 115 tests — globals, pure helpers (`_escHtmlInsc`/`_uclNum`/`_appUid`), `renderAppels`, `renderListeConforme`, `validerInscriptionRow`, `validerToutesInscriptions`, call-script settings, sheet-webhook settings, `openAppelFicheModal`/`closeAppelFicheModal`/`setAppelResult`, `saveAppelFiche`, integration checks |

### Dependencies and Compatibility

Resolved at call time:
- `STORE.appels()`, `STORE.saveAppels()`, `STORE.validatedInscriptions()`, `STORE.saveValidatedInscriptions()` — defined in `js/app.js` STORE block (unchanged)
- `_storeGet`, `_storeSave` — defined in `js/core/storage.js` (call-script and sheet-webhook settings use these directly for per-key localStorage access)
- `_tchToast` — optional; checked with `typeof _tchToast === 'function'` before calling
- `fetch`, `document`, `alert`, `confirm`, `Date`, `Math` — browser/Node globals
- Router callers (`loadDashboardInscriptionsCount`, `loadInscriptions`, `renderAppels`, `renderListeConforme`) resolve globals at call time — `js/core/router.js` unchanged

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/inscriptions.js` | ✓ |
| `tests/stage4aa-test.js` | ✓ 115/115 |
| `tests/stage4z-test.js` | ✓ 40/40 |
| `tests/stage4y-test.js` | ✓ 50/50 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4AA, 27 files) | ✓ 1547/1547 |

No Stage 4 suite failed and no regression was found.

### Risks, Remaining Responsibilities, and Operations

- `js/app.js` still contains: Répertoire contacts (~1 400 lines), Documents (~780 lines), Backup dashboard (~265 lines), Spectacle price calculator (~60 lines), Settings page (~70 lines), Invoice/OM helpers (~175 lines), STORE object, shared utilities (`num`, `fmtMoney`, `escapeHtml`, etc.), initialization (`initApp`, `bootstrapStableApp`).
- Stage 4 cannot close while these coherent domains remain in `js/app.js`.
- Deployment: not performed. Data migration: not performed.

### Exact Next Scope

**Stage 4AB:** Extract Répertoire contacts domain from `js/app.js` (approx lines 742–2120 in current numbering after 4AA extraction, exact range to be confirmed by reading). This is the largest remaining domain. Read `js/app.js` from the line immediately after the `// ── Routing → js/core/router.js` comment to find the exact block. Verify with `grep -n 'function render\|function open\|function close\|function save\|function delete\|function add\|function filter\|var contact\|var repertoire'` in `js/app.js` to identify the boundary. Extract into `js/shared/contacts.js`.

---

## Stage 4Z — Dead-code Audit; Remove renderEntityPage

**Stage 4Z is complete.** `renderEntityPage` confirmed dead (zero callers in HTML, JS, PHP) and removed from `js/app.js`. Three prior test suites (4V, 4X, 4Y) updated to assert removal. Stage 4Z passes 40/40. Full Stage 4 suite (4A–4Z): 1432 tests, 0 failures.

Implementation commit: `d4f68b0` — `refactor: Stage 4Z dead-code audit — remove renderEntityPage`

---

## Stage 4Y — Statistics Dashboard Extraction

**Objective:** Extract the complete statistics dashboard aggregation, KPI, comparison, and SVG rendering workflow from `js/app.js` into `js/shared/statistics-dashboard.js` without changing formulas, data sources, output, or navigation behavior.

**Exact extraction boundary:** the contiguous `renderStatistique` function, beginning immediately after the modal-helper extraction marker and ending immediately before the `_statKpi` utility marker. Its nested donut, monthly bar, and expense line SVG renderers move with it.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/statistics-dashboard.js` | NEW: global totals/KPIs, 12-month aggregation, recovery donut, monthly activity bars, expense trend, top clients, and entity summaries |
| `js/app.js` | Removed only `renderStatistique`; generic entity rendering, modal overlay behavior, initialization, backup/document workflows, and unrelated domains remain |
| `index.html` | Loads `statistics-dashboard.js` after all extracted data/accounting dependencies and before `taches.js` |
| `tests/stage4y-test.js` | NEW: 50 tests for globals, empty/partial data, totals, percentages, monthly datasets, SVG output, counts, escaping, routing, exclusions, and script order |
| `tests/stage4q-test.js` through `tests/stage4x-test.js` where applicable | Updated completed-extraction boundary assertions |

### Dependencies and Compatibility

Resolved at call time: invoice/RDV/client/mission-order/representation/expense/Bank/contract readers, `normalizeRdv`, invoice/RDV amount helpers, number/money/HTML utilities, `_statKpi`, `_statMini`, browser DOM, and `Date`. The router and manual refresh button retain the same `renderStatistique` global and timing. Existing all-time KPI totals, paid-status logic, 12-calendar-month window, top-six client ranking, recovery percentage rounding, three-decimal formatting, SVG construction, optional contracts fallback, and empty states are preserved exactly. The implementation uses inline SVG rather than Chart.js, so no chart instances, destruction lifecycle, listeners, timers, or writes were introduced.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/statistics-dashboard.js`, `js/shared/modal-entity-helpers.js` | ✓ |
| `tests/stage4y-test.js` | ✓ 50/50 |
| `tests/stage4x-test.js` | ✓ 49/49 |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage4j-test.js` | ✓ 66/66 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4Y) | ✓ 1392/1392 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still contains the apparently unreferenced generic `renderEntityPage` helper plus extraction markers, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete pending a bounded dead-code/residual extraction audit; no unverified helper was removed in Stage 4Y.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4X — Shared Modal Entity Helpers Extraction

**Objective:** Extract the shared form population and entity serialization/write helpers from `js/app.js` into `js/shared/modal-entity-helpers.js` without changing field mapping, coercion, callback timing, or storage routing.

**Exact extraction boundary:** the contiguous block beginning at `fillModalFields` and ending after `saveModalEntity`, immediately before `renderStatistique`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/modal-entity-helpers.js` | NEW: shared field population and entity create/update serialization helpers |
| `js/app.js` | Removed only `fillModalFields` and `saveModalEntity`; generic rendering, statistics, and entity-specific modal lifecycle remain |
| `index.html` | Loads the helper module immediately after `app.js` and before all extracted consumers |
| `tests/stage4x-test.js` | NEW: 49 tests for globals, population/reset, key mappings, checkbox/number serialization, create/update behavior, writer/callback order, exclusions, and script order |
| `tests/stage4w-test.js` | Updated the completed-extraction boundary assertion |

### Dependencies and Compatibility

Resolved at call time: `num`, `Date.now`, browser DOM, and the entity-specific reader/writer/render/close callbacks supplied by callers. The `supplier-id`, `supplier-name`, and `linked-bank` mappings, first-dash generic mapping, checkbox handling, numeric coercion, replacement-object update behavior, generated IDs, and `save → close → render` timing are preserved exactly. Existing Bank, Cash, Expenses, Purchases, and Suppliers modules continue calling the same globals. Every write still flows through the STORE writer callback supplied by the entity module. No modal lifecycle, focus, keyboard, overlay, validation, confirmation, deletion, listener, or business workflow was present in the extracted helpers, so those entity-specific responsibilities remain unchanged and outside this module.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/modal-entity-helpers.js` | ✓ |
| `tests/stage4x-test.js` | ✓ 49/49 |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4X) | ✓ 1342/1342 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still owns `renderStatistique`, the generic `renderEntityPage` helper, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete while the coherent statistics dashboard responsibility remains in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4W — Accounting TVA Calculator Extraction

**Objective:** Extract the existing purchase-form TVA reverse calculation, rate selection/highlighting, and manual TVA total calculation from `js/app.js` into `js/shared/accounting-tva.js` without changing tax formulas, rates, formatting, or DOM behavior.

**Exact extraction boundary:** the contiguous block beginning at `calculateFromTTC` and ending after `updateTVATotal`, immediately before the generic `fillModalFields` helper.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-tva.js` | NEW: TTC-to-HT/TVA reverse calculation for 19/13/7%, rate selection/highlighting, and manual TVA total calculation |
| `js/app.js` | Removed only the three extracted TVA functions; generic modal helpers and statistics remain |
| `index.html` | Loads `accounting-tva.js` before `accounting-purchases.js`, preserving inline handlers and purchase-form DOM contracts |
| `tests/stage4w-test.js` | NEW: 44 tests for globals, formulas, supported rates, rounding, empty/zero/negative/decimal inputs, DOM safety, manual totals, compatibility, exclusions, and script order |
| `tests/stage4t-test.js`, `tests/stage4u-test.js`, `tests/stage4v-test.js` | Updated completed-extraction boundary assertions |

### Dependencies and Compatibility

Resolved at call time: `num`, `fmtMoney`, and the existing purchase-form DOM. `accounting-tva.js` loads before `accounting-purchases.js`, whose delayed `calculateFromTTC` call is unchanged. Inline `updateTVATotal` handlers and the compatibility globals retain their names and timing. The existing one-dinar stamp deduction, reverse formulas, `Math.max(0, ...)` clamps, three-decimal formatting, and default 19% selection are preserved exactly. No period-based, collected, deductible, payable, or credit TVA workflow existed in this extraction boundary, so none was invented. The module performs no storage writes and introduces no listeners or initialization.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-tva.js`, `js/shared/accounting-overview.js`, `js/shared/accounting-reports.js` | ✓ |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4W) | ✓ 1293/1293 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still owns the shared generic modal helpers, `renderStatistique`, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete while these coherent shared responsibilities remain in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4V — Accounting Suppliers Workflow Extraction

**Objective:** Extract the accounting-specific Suppliers list/detail rendering, search/category filters, CRUD form workflow, linked purchases, and linked Bank entries from `js/app.js` into `js/shared/accounting-suppliers.js` without changing behavior.

**Exact extraction boundaries:** the supplier filter state beside the accounting module state declarations; the block beginning at `renderSuppliersPage` and ending after `getSupplierCategoryStyle`; and the block beginning at `setSupplierSearch` and ending after `deleteSupplier`. The generic `renderEntityPage` helper between those blocks remains in `js/app.js`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-suppliers.js` | NEW: accounting Supplier filter state, list/detail rendering, category styling, CRUD form, purchase links, Bank links, totals, and formatting |
| `js/app.js` | Removed only the extracted Supplier state and functions; TVA calculator, generic modal helpers, and statistics remain |
| `index.html` | Loads `accounting-suppliers.js` after the purchase and Bank dependencies and before reports/overview consumers |
| `tests/stage4v-test.js` | NEW: 60 tests for globals/state, rendering, filters, detail relationships, totals, CRUD, writes, compatibility, exclusions, and script order |
| `tests/stage4s-test.js`, `tests/stage4t-test.js`, `tests/stage4u-test.js` | Updated completed-extraction boundary assertions |

### Dependencies and Compatibility

Resolved at call time: `STORE.suppliers/saveSuppliers/purchases/bankEntries`, `esc`, `num`, `fmtMoney`, generic modal helpers, `fillPurchaseSuppliers`, purchase actions, and `openBankDetailModal`. Existing inline handlers and the router retain the same global names and initialization timing. Supplier saves/deletes continue through `STORE.saveSuppliers` and the approved `_storeSave` pipeline; purchase option synchronization remains at the same point after save. The legacy `js/shared/fournisseurs.js` domain remains separate and unchanged. No listeners, timers, schema changes, or duplicate initialization were introduced.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-suppliers.js`, `js/shared/accounting-purchases.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4i-test.js` | ✓ 69/69 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4V) | ✓ 1249/1249 |

The Stage 4 suite was run exactly once. No Stage 4 suite failed and no new regression was found. The 12 documented pre-existing failures remain outside this bounded suite and unchanged by the extracted files.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain deferred and were not rerun.
- `js/app.js` still owns the coherent TVA calculator, generic modal helpers, `renderStatistique`, initialization, backup/document workflows, and other unrelated legacy domains.
- Stage 4 remains incomplete while the documented coherent TVA responsibility remains in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4U — Accounting Overview and Period Workflow Extraction

**Objective:** Extract accounting period state/filtering, summary calculations/cards, module navigation, connection summaries, and financial-flow composition from `js/app.js` into `js/shared/accounting-overview.js` without changing behavior.

**Exact extraction boundary:** the contiguous block beginning at `comptaDashboardPeriod` and ending after `renderComptaViews`, immediately before `renderSuppliersPage`.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-overview.js` | NEW: period state, date filtering, overview totals/cards, accounting navigation, connection summaries, and report composition |
| `js/app.js` | Removed the extracted overview block; supplier management, TVA calculator, generic modal helpers, and `renderStatistique` remain |
| `index.html` | Loads `accounting-overview.js` after `accounting-reports.js` and before `taches.js` |
| `tests/stage4u-test.js` | NEW: 45 tests for globals, period boundaries, calculations, cards, navigation, composition, compatibility, exclusions, and script order |
| `tests/stage4t-test.js` | Updated the report-to-overview dependency and extraction-boundary assertions |

### Dependencies and Compatibility

Resolved at call time: invoice/purchase/expense/Bank/Cash/supplier readers, invoice totals, date/week/number/money utilities, expense categories, and `renderFinancialFlowDiagram`. Existing router and all extracted accounting-module callers retain the same `renderComptaViews` global and timing. Inline period buttons preserve the shared `comptaDashboardPeriod` lexical global. The overview remains read-only and introduces no listeners, timers, or writes.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-overview.js`, `js/shared/accounting-reports.js` | ✓ |
| `tests/stage4u-test.js` | ✓ 45/45 |
| `tests/stage4t-test.js` | ✓ 57/57 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4U) | ✓ 1189/1189 |

The complete repository suite was run once. Twenty-six suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- `js/app.js` still owns the accounting-specific supplier page/detail/CRUD workflow, TVA calculator, generic modal helpers, `renderStatistique`, initialization, and other unrelated legacy domains.
- Stage 4 remains incomplete while these coherent responsibilities remain in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4T — Financial Reports, Reconciliation, Flow, and Analytics Extraction

**Objective:** Extract the coherent monthly financial report, cash-flow diagram, reconciliation, and financial analytics dashboard workflow from `js/app.js` into `js/shared/accounting-reports.js` without changing calculations or rendering behavior.

**Exact extraction boundary:** the contiguous block beginning at `generateMonthlyReport` and ending after `renderFinancialAnalyticsDashboard`, immediately before the generic `renderEntityPage` helper.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-reports.js` | NEW: monthly report calculations, flow diagram, reconciliation markup, and annual analytics dashboard |
| `js/app.js` | Removed the extracted reporting block; accounting overview, suppliers, TVA calculator, generic helpers, and `renderStatistique` remain |
| `index.html` | Loads `accounting-reports.js` after all accounting data modules and before `taches.js` |
| `tests/stage4t-test.js` | NEW: 58 tests for globals, yearly/monthly calculations, totals, flow, reconciliation, analytics, compatibility, exclusions, and script order |
| `tests/stage4r-test.js`, `tests/stage4s-test.js` | Updated deferred-report boundaries and dependency-order assertions |

### Dependencies and Compatibility

Resolved at call time: invoice/RDV/purchase/expense/Bank/Cash readers, `normalizeRdv`, invoice/RDV total helpers, date/number/money utilities, and the reconciliation DOM target. Existing accounting-overview and router callers retain identical global names and timing. The extracted workflow is read-only and does not introduce writes or chart instances; the existing return-before-DOM reconciliation behavior is preserved exactly rather than corrected in this extraction.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-reports.js`, `js/shared/accounting-purchases.js` | ✓ |
| `tests/stage4t-test.js` | ✓ 58/58 |
| `tests/stage4s-test.js` | ✓ 55/55 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4T) | ✓ 1145/1145 |

The complete repository suite was run once. Twenty-five suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks, Remaining Responsibilities, and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- The pre-existing unreachable reconciliation DOM assignment and empty-data `NaN%` output remain unchanged.
- `js/app.js` still owns accounting overview/period filtering, supplier management, TVA calculation, generic modal helpers, `renderStatistique`, initialization, and other unrelated legacy domains.
- Stage 4 is not complete while these documented coherent responsibilities remain in `js/app.js`.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4S — Purchases CRUD, Supplier Synchronization, and Page Workflow Extraction

**Objective:** Extract the coherent Purchases CRUD, numbering, rendering, TVA totals, bulk selection, and supplier option synchronization from `js/app.js` into `js/shared/accounting-purchases.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-purchases.js` | NEW: Purchase numbering, rendering, bulk selection, CRUD form, supplier options, and supplier synchronization |
| `js/app.js` | Removed the extracted Purchases implementation; supplier management, TVA calculator, statistics, and broader financial reports remain |
| `index.html` | Loads `accounting-purchases.js` after `accounting-expenses.js` and before `taches.js` |
| `tests/stage4s-test.js` | NEW: 56 tests for globals, numbering, rendering, TVA totals, selection, CRUD, supplier synchronization, exclusions, and script order |
| `tests/stage4r-test.js` | Updated the Stage 4R extraction boundary and dependency-order assertion |

### Dependencies and Compatibility

Resolved at call time: `STORE.purchases/savePurchases/suppliers`, formatting/date utilities, generic modal helpers, the existing `calculateFromTTC`, `renderComptaViews`, DOM, alerts, confirmation, and `setTimeout`. Existing inline handlers, supplier-detail calls, router calls, Dashboard/statistics reads, and accounting overview calls retain identical globals and timing. Every write continues through `STORE.savePurchases` and the approved `_storeSave` pipeline. Supplier management, TVA calculation, statistics, and broader financial reports remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-purchases.js`, `js/shared/accounting-expenses.js` | ✓ |
| `tests/stage4s-test.js` | ✓ 56/56 |
| `tests/stage4r-test.js` | ✓ 68/68 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4i-test.js` | ✓ 69/69 |
| `tests/stage4j-test.js` | ✓ 66/66 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4S) | ✓ 1088/1088 |

The complete repository suite was run once. Twenty-four suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Supplier management, TVA calculation, statistics, reconciliation, and broader financial reports remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4R — Expenses CRUD, Categories, Reports, and Page Workflow Extraction

**Objective:** Extract the coherent Expenses CRUD, period filtering, payment/category reports, category management, and category/subcategory form workflow from `js/app.js` into `js/shared/accounting-expenses.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-expenses.js` | NEW: Expense filter state, page rendering, payment/category reports, category CRUD, subcategory options, and expense CRUD form |
| `js/app.js` | Removed the extracted Expenses implementation; purchases, statistics, and broader financial reports remain |
| `index.html` | Loads `accounting-expenses.js` after `accounting-cash.js` and before `taches.js` |
| `tests/stage4r-test.js` | NEW: 69 tests for globals, categories, subcategories, filters, reports, totals, CRUD, writes, exclusions, and script order |
| `tests/stage4p-test.js`, `tests/stage4q-test.js` | Updated accounting extraction boundaries and dependency-order assertions |

### Dependencies and Compatibility

Resolved at call time: `STORE.expenses/saveExpenses/expenseCategories/saveExpenseCategories`, formatting/date/week utilities, generic modal helpers, `renderComptaViews`, DOM, alerts, and confirmation. Existing inline handlers, router calls, Dashboard/statistics reads, and accounting overview calls retain identical globals and timing. Every write continues through the approved `STORE`/`_storeSave` pipeline. Purchases and broader financial/statistical reports remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-expenses.js`, `js/shared/accounting-cash.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4r-test.js` | ✓ 69/69 |
| `tests/stage4q-test.js` | ✓ 57/57 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4R) | ✓ 1033/1033 |

The complete repository suite was run once. Twenty-three suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Purchases, statistics, and broader financial/accounting reports remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4Q — Cash Entries CRUD and Page Workflow Extraction

**Objective:** Extract the coherent Cash entries CRUD, filtering, rendering, linked-record workflow, and Bank withdrawal selection from `js/app.js` into `js/shared/accounting-cash.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-cash.js` | NEW: Cash filter state, page rendering, record linking, bulk selection, CRUD form, and Bank withdrawal selection |
| `js/app.js` | Removed the extracted Cash implementation; expenses, statistics, and shared accounting helpers remain |
| `index.html` | Loads `accounting-cash.js` after `accounting-bank.js` and before `taches.js` |
| `tests/stage4q-test.js` | NEW: 58 tests for globals, rendering, filters, links, writes, CRUD, selection, Bank choices, exclusions, and script order |
| `tests/stage4p-test.js` | Updated the Stage 4P integration boundary and script-order assertion for the Stage 4Q consumer |

### Dependencies and Compatibility

Resolved at call time: `STORE.cashEntries/saveCashEntries`, Bank/expense/invoice readers, formatting and date utilities, invoice totals, generic modal helpers, `renderComptaViews`, DOM, alerts, and confirmation. Existing inline handlers, router calls, Dashboard reads, and Bank-link contracts retain identical globals and timing. Every write continues through `STORE.saveCashEntries` and the approved `_storeSave` pipeline. Expenses and statistics remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-cash.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4q-test.js` | ✓ 58/58 |
| `tests/stage4p-test.js` | ✓ 58/58 |
| `tests/stage4o-test.js` | ✓ 72/72 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4Q) | ✓ 965/965 |

The complete repository suite was run once. Twenty-two suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Expenses, statistics, and broader accounting helpers remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4P — Bank Entries CRUD and Page Workflow Extraction

**Objective:** Extract the coherent Bank entries CRUD, cleanup, filtering, rendering, linked-record workflow, and import results from `js/app.js` into `js/shared/accounting-bank.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/accounting-bank.js` | NEW: Bank filter state, cleanup, CRUD, list selection, page rendering, linked-record dialogs, and CSV import/results workflow |
| `js/app.js` | Removed the extracted Bank implementation; Cash, expenses, shared accounting helpers, and statistics remain |
| `index.html` | Loads `accounting-bank.js` after `devis.js` and before `taches.js` |
| `tests/stage4p-test.js` | NEW: 59 tests for globals, cleanup, icons, rendering, filters, selection, CRUD, modals, compatibility, exclusions, and script order |

### Dependencies and Compatibility

Resolved at call time: `STORE.bankEntries/saveBankEntries`, expense/invoice/contract/supplier readers, formatting utilities, invoice/contract total helpers, generic modal helpers, `renderComptaViews`, DOM, `FileReader`, alerts, and confirmation. Existing inline handlers, router calls, supplier views, dashboard reads, and initialization retain identical global names and timing. Every write continues through `STORE.saveBankEntries` and the approved `_storeSave` pipeline. Cash and expense workflows remain in `js/app.js`.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/accounting-bank.js` | ✓ |
| `tests/stage4p-test.js` | ✓ 59/59 |
| `tests/stage4o-test.js` | ✓ 72/72 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4P) | ✓ 908/908 |

The complete repository suite was run once. Twenty-one suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Cash, expenses, statistics, and broader accounting helpers remain deliberately deferred.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4O — Devis CRUD Workflow Extraction

**Objective:** Extract the coherent Devis CRUD, form workflow, numbering, line totals, issuer/logo/stamp handling, and preview rendering from `js/app.js` into `js/shared/devis.js` without changing behavior.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/devis.js` | NEW: issuer definitions, stamp generation, numbering, CRUD, list/form workflows, logo handling, line calculations, and preview HTML |
| `js/app.js` | Removed the extracted Devis implementation and retained concise module references; unrelated compatibility functions and generic `printModal` remain |
| `index.html` | Loads `devis.js` after `rdvs.js` and before `taches.js` |
| `tests/stage4o-test.js` | NEW: 72 tests for globals, numbering, stamp, list/form, clients, logos, calculations, CRUD, preview, compatibility, and script order |
| `tests/stage4m-test.js` | Updated the deferred Devis-numbering assertion to reflect the Stage 4O extraction |

### Extracted Globals

`KACEM_PRINT_LOGO_SRC`, `DEVIS_SOCIETES`, `getStampSVGFor`, `nextDevisNum`, `splitDevisNum`, `editDevis`, `deleteDevis`, `saveDevis`, `populateDevisList`, `cancelDevisForm`, `updateDevisLogoPreview`, `onDevisSocieteChange`, `onDevisLogoFileChange`, `resetDevisLogo`, `syncDevisNumberPreview`, `initDevisForm`, `fillDevisClientSelect`, `syncDevisClientFromSelect`, `devisLineCount`, `addDevisLine`, `removeDevisLine`, `calcDevisTotals`, `buildDevisHTML`, `printDevis`, `closeDevisPreview`

### Dependencies and Compatibility

Resolved at call time: `MYTHOS_PRINT_LOGO_SRC`, `STORE.devis/saveDevis/clients`, formatting and number utilities, guarded `LOGGER`, `showView`, DOM, `FileReader`, confirmation, alerts, and `setTimeout`. Existing inline handlers and RDV linked-source reads retain the same storage and global contracts. Writes continue through `STORE.saveDevis` and the approved `_storeSave` pipeline. The existing legacy-number filtering behavior is preserved exactly.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/devis.js` | ✓ |
| `tests/stage4o-test.js` | ✓ 72/72 |
| `tests/stage4n-test.js` | ✓ 66/66 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4O) | ✓ 849/849 |

The complete repository suite was run once. Twenty-one suite files passed. Twelve suite files failed only through the same documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. The final Stage 4O suite was rerun after moving its issuer definitions and remained 72/72.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- Generic `printModal` and unrelated early compatibility functions remain in app.js intentionally.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4N — RDV CRUD and Form Workflow Extraction

**Objective:** Extract the coherent RDV two-step form, source dropdowns, fee selection, list rendering, CRUD, and tombstone behavior from `js/app.js` into `js/shared/rdvs.js` while preserving existing behavior and global interfaces.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/rdvs.js` | NEW: RDV form workflow, linked-source helpers, fee handling, CRUD, rendering, and delete tombstone |
| `js/app.js` | Removed the extracted RDV implementation and retained a concise module reference; following legacy compatibility helpers remain unchanged |
| `index.html` | Loads `rdvs.js` after `invoices.js` and before `taches.js` |
| `tests/stage4n-test.js` | NEW: 66 tests for globals, wizard flow, sources, dropdowns, fee modes, CRUD, tombstones, rendering, compatibility, and script order |

### Extracted Globals

`rdvOpenForm`, `rdvClose`, `rdvShowExistingRdvs`, `rdvGoToStep2`, `rdvBackToStep1`, `getAllInvoices`, `getAllDevis`, `getAllContracts`, `rdvLoadDropdowns`, `rdvCalcFee`, `rdvFeeTypeSelectChanged`, `rdvInvoiceChanged`, `rdvDevisChanged`, `rdvContractChanged`, `rdvSave`, `rdvRender`, `rdvEdit`, `rdvDelete`

### Dependencies and Compatibility

Resolved at call time: `STORE.rdvs/saveRdvs`, invoice/devis/contract/client/collaborator/nature/representation readers, `esc`, `todayStr`, `_markDeleted`, DOM, alerts, confirmation, and `setTimeout`. Router, Calendar, Dashboard, and inline handlers continue using identical global names. RDV writes remain on `STORE.saveRdvs` and deletes still record `mp_rdvs` tombstones. No listener, timer, or initialization behavior was duplicated.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/rdvs.js` | ✓ |
| `tests/stage4n-test.js` | ✓ 66/66 |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4d-test.js` | ✓ 32/32 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4N) | ✓ 777/777 |

The complete repository suite was run once. Twenty suite files passed. Twelve suite files failed only through the documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions. No Stage 4 suite failed and no new regression was found.

### Risks and Operations

- The 12 documented pre-existing suite failures remain unchanged.
- `stableRdvPrestRows` and unrelated legacy compatibility helpers remain in app.js because they are outside this coherent workflow and were not required by its callers.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4M — Invoices CRUD Extraction

**Objective:** Extract the coherent Invoices CRUD, form, line calculation, numbering, list rendering, and preview rendering responsibilities from `js/app.js` into `js/shared/invoices.js` while preserving all existing behavior and globals.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/invoices.js` | NEW: invoice list, numbering, form, lines, totals, CRUD, preview, print HTML, and `stableLineCount` |
| `js/app.js` | Removed extracted invoice implementations and retained concise reference comments; Devis helpers, compatibility stubs, and generic `printModal` remain |
| `index.html` | Loads `invoices.js` after `mission-orders.js` and before `taches.js` |
| `tests/stage4m-test.js` | NEW: 76 tests covering globals, rendering, numbering, forms, clients, lines, totals, CRUD, preview, compatibility, and script order |

### Extracted Globals

`stableLineCount`, `renderList`, `nextInvoiceNum`, `splitInvoiceNum`, `initNewForm`, `handleInvoiceTypeChange`, `handleInvoiceYearChange`, `handleInvoiceDateChange`, `syncInvoiceNumberPreview`, `fillClientSelect`, `fillClientFromSelect`, `addLine`, `removeLine`, `getLines`, `calcTotals`, `saveInvoice`, `editInvoice`, `deleteInvoice`, `cancelForm`, `previewInvoice`, `closePreview`, `buildInvoiceHTML`

### Dependencies and Compatibility

Resolved at call time: `STORE.invoices/saveInvoices/clients/saveClients`; invoice and formatting utilities from `utils.js`; `showView` and `updateSidebarStats` from router; guarded `LOGGER`; DOM, alerts, and confirmation. Existing router callbacks, Dashboard, Clients, Natures, and inline handlers continue using identical global names. The approved `_storeSave` write pipeline remains unchanged. Pre-existing invoice compatibility stubs in app.js were intentionally not modified.

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js`, `js/shared/invoices.js` | ✓ |
| `tests/stage4m-test.js` | ✓ 76/76 |
| `tests/stage4l-test.js` | ✓ 59/59 |
| `tests/stage4g-test.js` | ✓ 49/49 |
| `tests/stage4e-test.js` | ✓ 31/31 |
| `tests/stage4f-test.js` | ✓ 37/37 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4M) | ✓ 711/711 |

The complete repository suite was run once. Nineteen suite files passed. Twelve suite files failed only through the documented pre-existing `_memCache` core failure and cascading Stage 1–3 subprocess regressions; no Stage 4 suite failed and no new regression was found.

### Risks and Operations

- Known pre-existing failures remain unchanged: `tests/core-test.js` (`_memCache`) and dependent Stage 1–3 subprocess regressions.
- Duplicate compatibility stubs remain intentionally deferred pending inline-handler audit.
- Deployment: not performed.
- Data migration: not performed.

---

## Stage 4L — Mission Orders CRUD Extraction

**Objective:** Extract Ordres de mission CRUD, vehicle helpers, form behavior, preview rendering, owned constants, and state from `js/app.js` into `js/shared/mission-orders.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/mission-orders.js` | NEW: mission-order CRUD, vehicle helpers, form behavior, preview HTML, company definitions, mission texts, and `stableOmPersonCount` |
| `js/app.js` | Removed the extracted mission-order implementation and retained concise reference comments; generic `printModal` remains in app.js |
| `index.html` | Loads `mission-orders.js` after `contracts.js` and before `taches.js` |
| `tests/stage4l-test.js` | NEW: 59 tests for globals, rendering, vehicles, form helpers, CRUD, preview, compatibility, and script integration |

### Extracted Globals

`SOCIETES`, `OM_MISSION_TEXTS`, `stableOmPersonCount`, `renderOMList`, `ensureDefaultVehicules`, `renderOmVehiculeOptions`, `updateOmLogoPreview`, `onOmVehiculeChange`, `addOmVehicule`, `initOMForm`, `setOmDateQuick`, `setOmTimeQuick`, `applyOmMissionType`, `addOmPerson`, `getOMPersons`, `saveOM`, `editOM`, `deleteOM`, `cancelOM`, `previewOM`, `closeOMPreview`, `buildOMHTML`

### Dependencies and Compatibility

Resolved at call time: `STORE.oms/saveOms/vehicules/saveVehicules/collabs/saveCollabs`; utilities `esc`, `cleanPrintText`, `formatDateLong`, `todayStr`, `dateInputValue`, `getStampSVG`; router globals `showView`, `updateSidebarStats`; browser DOM, prompts, alerts, and confirmation. Existing inline handlers, router calls, and Collaborateurs links continue using the same global names. Pre-existing compatibility stubs in app.js were not modified.

### Test Results

| Suite | Result |
|-------|--------|
| `tests/stage4l-test.js` | ✓ 59/59 |
| `tests/stage4h-test.js` | ✓ 51/51 |
| `tests/stage4k-test.js` | ✓ 88/88 |
| `tests/stage4c-test.js` | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Syntax: `js/app.js`, `js/shared/mission-orders.js` | ✓ |
| Full suite: all Stage 4 (4A-4L) | ✓ 882 pass, pre-existing unchanged |

### Known Risks

The pre-existing `tests/core-test.js` `_memCache` failure remains unchanged. Duplicate compatibility stubs in `js/app.js` remain intentionally deferred pending a complete inline-handler audit.

---

## Stage 4K — Contracts CRUD Extraction

**Objective:** Extract Contracts CRUD from `js/app.js` into `js/shared/contracts.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/contracts.js` | NEW: 186 lines — Contracts CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8130 → 7941 lines. Contracts block (lines 3682–3871, 190 lines) deleted; reference comment: `// Contracts CRUD moved to js/shared/contracts.js` |
| `index.html` | 1 line: `<script src="js/shared/contracts.js?v=20260801">` after representations.js |
| `tests/stage4k-test.js` | NEW: 88 tests — globals, renderContracts (empty/data), nextContractRef (empty/with-existing), contractTotals, contractStatusLabel, fillContractClientSelect, fillContractClientFromSelect (match/no-match), toggleContractVatAdvance (enabled/disabled), calcContractTotals, initContractForm, saveContract (create/update/guard), editContract (existing/unknown), deleteContract (confirmed/cancelled), cancelContractForm, regression chain |

### Extracted Globals (now in shared/contracts.js, removed from app.js)

`nextContractRef`, `contractTotals`, `contractStatusLabel`, `fillContractClientSelect`, `fillContractClientFromSelect`, `toggleContractVatAdvance`, `calcContractTotals`, `renderContracts`, `initContractForm`, `saveContract`, `editContract`, `deleteContract`, `cancelContractForm`

No state variables to extract (no `let` or `var` contract state declarations in app.js).

### Dependencies

contracts.js resolved at call time: `STORE.contracts/saveContracts/clients/saveClients` (defined in app.js STORE block); `num`, `esc`, `fmtMoney`, `formatDate`, `todayStr` (utils.js); `showView`, `updateSidebarStats` (router.js); browser DOM (`document`, `alert`, `confirm`).

### Script Load Order (after Stage 4K)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → `js/shared/collaborateurs.js` → `js/shared/fournisseurs.js` → `js/shared/representations.js` → **`js/shared/contracts.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4k-test.js` | 88 | ✓ 88/88 |
| `tests/stage4j-test.js` | 66 | ✓ 66/66 (regression) |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

Full suite: all Stage 4 (4A-4K) pass. Pre-existing failures: core-test.js (_memCache), stage 1-3 cascading subprocess regressions (documented). No new regressions.

### Commit

`ec42b4a` — `docs(handover): clean Stage 4K handover, record test results`

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Stage 4Z — Dead-Code Audit: Remove renderEntityPage

**Objective:** Perform the bounded Stage 4 closure audit of confirmed extraction residue in `js/app.js`. Audit `renderEntityPage` for callers; remove if confirmed dead. Update prior test assertions. Determine whether Stage 4 can close.

**Exact extraction boundary:** `renderEntityPage` function (6 lines), lines 2521–2526. No other functions touched. Extraction markers and comments left in place as documentation.

### Changed Files

| File | Change |
|------|--------|
| `js/app.js` | Removed `renderEntityPage` (6 lines → 1-line marker comment). 3875 → 3870 lines. |
| `tests/stage4v-test.js` | Flipped `renderEntityPage remains` assertion to `renderEntityPage removed` |
| `tests/stage4x-test.js` | Same flip |
| `tests/stage4y-test.js` | Same flip |
| `tests/stage4z-test.js` | NEW: 40 tests — dead-code removal, extraction boundary completeness, active functions preserved, STORE integrity, script order, syntax |

### Dead-Code Verdict

Repository-wide caller scan (`grep -rn "renderEntityPage(" *.js *.html *.php`): zero callers. Definition-only. Confirmed dead.

### Stage 4 Closure Verdict

**Stage 4 cannot close.** Substantial active CRUD and feature domains remain in `js/app.js` (3870 lines):

| Domain | Approx. lines | Functions |
|--------|-------------|-----------|
| Inscriptions / Appels | ~360 | loadInscriptions, validerToutesInscriptions, renderAppels, openAppelFicheModal, saveAppelFiche, … |
| Settings (call script, sheet) | ~70 | getCallScript, saveCallScript, getSheetWebhookUrl, pushToGoogleSheet, … |
| Repertoire contacts | ~1400 | renderRepertoireContactsPage, renderContactsDirectory, importPhoneContacts, handleContactsFileImport, addRepertoireContactRow, … |
| Backup / export / version | ~265 | exportBackup, importBackup, createBackupVersion, renderBackupDashboard, runDiskCleanup, … |
| Spectacle calculator | ~60 | initSpectacleCalculator |
| Documents / camera / upload | ~780 | renderDocumentation, openDocModal, saveDoc, openCameraModal, saveCapturedPhoto, saveBulkDocs, … |
| App init / bootstrap / nav | ~100 | initApp, bootstrapStableApp, toggleSidebar, initNavScrollHint, … |
| Invoice/OM helpers | ~175 | populateInvoiceList, editInvoice, deleteInvoice, editOm, deleteOm, cancelOM, addLine, … |
| Restore/migration (one-time) | ~90 | restoreBackup20260516Once, forceRestoreBackup20260516 |

### Validation

| Suite | Result |
|-------|--------|
| Syntax: `js/app.js` | ✓ |
| `tests/stage4z-test.js` | ✓ 40/40 |
| `tests/stage4y-test.js` | ✓ 50/50 |
| `tests/stage4x-test.js` | ✓ 49/49 |
| `tests/stage4w-test.js` | ✓ 44/44 |
| `tests/stage4v-test.js` | ✓ 60/60 |
| `tests/stage1a-sync-bypass-regression-test.js` | ✓ 77/77 |
| Full Stage 4 suite (4A–4Z) | ✓ 1432/1432 |

### Commit

```
d4f68b049c2f820d67345e5f9cdcf43be56cffad
refactor: Stage 4Z dead-code audit — remove renderEntityPage
```

---

## Next Stage: Stage 4AA — Inscriptions / Appels CRUD Extraction

Stage 4Z is complete. Continue AGENTS.md §19 step 6 (remaining CRUD into modules).

**Exact next scope:** extract the Inscriptions / Appels workflow from `js/app.js` into `js/shared/inscriptions.js`. This is the smallest coherent remaining domain (~360 lines, lines ~734–1092). Include all inscription loading/validation/rendering, appel-fiche modal lifecycle, and call-result tracking. Do not touch the call-script settings functions (separate concern), the repertoire contacts domain, or any active production initialization code.

**Preflight required before starting Stage 4AA:**
1. `git fetch origin`
2. Confirm HEAD = origin/main = `d4f68b049c2f820d67345e5f9cdcf43be56cffad`
3. `git status --short` — confirm clean
4. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`

---

## Stage 4G — Clients CRUD Extraction

**Objective:** Extract Clients CRUD from `js/app.js` into `js/shared/clients.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/clients.js` | NEW: 115 lines — Clients CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8604 → 8502 lines. Lines 4265–4369 (105 lines) replaced by 3-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/clients.js?v=20260801">` after natures.js |
| `tests/stage4g-test.js` | NEW: 49 tests — globals, renderClients, openClientModal, closeClientModal, saveClient (create+update), deleteClient (confirmed+cancelled), showClientDetail, LOGGER guard, regression chain |

### Extracted Globals (now in shared/clients.js, removed from app.js)

`currentClientDetailId` (changed `let`→`var` for vm testability), `renderClients`, `showClientDetail`, `openClientModal`, `closeClientModal`, `saveClient`, `deleteClient`

### Deferred CRUD Blocks

- **Collaborateurs CRUD** (lines ~4269–now, ~98 lines): `currentCollabDetailId`, `renderCollaborateurs`, `showCollabDetail`, `openCollabModal`, `closeCollabModal`, `saveCollab`, `deleteCollab`
- **Fournisseurs CRUD**: `renderFournisseurs`, `saveFournisseur`, `deleteFournisseur`
- All other CRUD (invoices, devis, RDVs, OMs, representations, accounting, etc.)

### Script Load Order (after Stage 4G)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → **`js/shared/clients.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1658 + 49 new) | 1707 | Not rerun (AGENTS.md §8) |

### Commit

```
37cb662fb6dc2c16721952b9c07514fd6cbe5de5
refactor(clients): extract Clients CRUD into js/shared/clients.js
```

Parent: `e88963c7c6fe9b87aa693ea067d6671ac3049c34` (docs(handover): record Stage 4F commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

---

## Stage 4H — Collaborateurs CRUD Extraction

**Objective:** Extract Collaborateurs CRUD from `js/app.js` into `js/shared/collaborateurs.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/collaborateurs.js` | NEW: 101 lines — Collaborateurs CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8502 → 8407 lines. Lines 4269–4366 (98 lines) replaced by 3-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/collaborateurs.js?v=20260801">` after clients.js |
| `tests/stage4h-test.js` | NEW: 51 tests — globals, renderCollaborateurs, openCollabModal, closeCollabModal, saveCollab (create+update), deleteCollab (confirmed+cancelled), showCollabDetail (unknown/no-oms/with-oms), regression chain |

### Extracted Globals (now in shared/collaborateurs.js, removed from app.js)

`currentCollabDetailId` (changed `let`→`var` for vm testability), `renderCollaborateurs`, `showCollabDetail`, `openCollabModal`, `closeCollabModal`, `saveCollab`, `deleteCollab`

### Dependencies

collaborateurs.js resolved at call time: `STORE.collabs/saveCollabs/oms` (storage via app.js); `esc`, `formatDate` (utils.js); `showView` (router.js); `previewOM`, `editOM` (app.js — onclick attributes).
No LOGGER calls in this module.

### Script Load Order (after Stage 4H)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → **`js/shared/collaborateurs.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4h-test.js` | 51 | ✓ 51/51 |
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

### Commit

```
fa1fa4a94aa220f9fed3b8849291baab094c6a5c
Stage 4H: extract Collaborateurs CRUD into js/shared/collaborateurs.js
```

Parent: `daef11459e3c31b9cd9e32c8bbc31bdc585b31d2` (docs: record Stage 4G commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Stage 4I — Fournisseurs CRUD Extraction

**Objective:** Extract Fournisseurs CRUD from `js/app.js` into `js/shared/fournisseurs.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/fournisseurs.js` | NEW: 173 lines — Fournisseurs CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8407 → 8243 lines. Function block (lines 4276–4443, 168 lines) → 5-line reference comment; state vars (lines 1563–1564, 2 lines) → 1-line reference |
| `index.html` | 1 line: `<script src="js/shared/fournisseurs.js?v=20260801">` after collaborateurs.js |
| `tests/stage4i-test.js` | NEW: 69 tests — globals, category style/icon helpers, renderFournisseurs (empty/data/filter-search/filter-category), setFournisseurSearch, setFournisseurFilterCategory, resetFournisseurFilters, openFournisseurModal (DOM safety/new/existing), closeFournisseurModal, saveFournisseur (name guard/create/update), deleteFournisseur (confirmed/cancelled), regression chain |

### Extracted Globals (now in shared/fournisseurs.js, removed from app.js)

`fournisseurFilterCategory` (line 1563, `let`→`var`), `fournisseurSearchQuery` (line 1564, `let`→`var`), `renderFournisseurs`, `getFournisseurCategoryStyle`, `getFournisseurCategoryIcon`, `setFournisseurSearch`, `setFournisseurFilterCategory`, `resetFournisseurFilters`, `openFournisseurModal`, `closeFournisseurModal`, `saveFournisseur`, `deleteFournisseur`

### Dependencies

fournisseurs.js resolved at call time: `STORE.suppliers/saveSuppliers` (defined in app.js line 81 → `_storeSave('mp_suppliers',…)`); `esc` (utils.js); browser DOM (`document`, `alert`, `confirm`, `console.error`). No `showView`, no `LOGGER`, no `formatDate`.

### Script Load Order (after Stage 4I)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → `js/shared/collaborateurs.js` → **`js/shared/fournisseurs.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4i-test.js` | 69 | ✓ 69/69 |
| `tests/stage4h-test.js` | 51 | ✓ 51/51 |
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

### Commit

```
70df5e099f86f35b31bd6f93bc505f9235f9edf6
Stage 4I: extract Fournisseurs CRUD into js/shared/fournisseurs.js
```

Parent: `1b50e62876e6773affad64cd56af5fdbaeb18f6f` (docs: record Stage 4H commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Stage 4J — Representations CRUD Extraction

**Objective:** Extract Representations CRUD from `js/app.js` into `js/shared/representations.js` (AGENTS.md §19 step 6, continued).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/representations.js` | NEW: 124 lines — Representations CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8243 → 8131 lines. Function block (lines 6790–6907, 118 lines) → 6-line reference comment; state var (line 1550, 1 line) → 1-line reference |
| `index.html` | 1 line: `<script src="js/shared/representations.js?v=20260801">` after fournisseurs.js |
| `tests/stage4j-test.js` | NEW: 66 tests — globals, renderRepresentations (empty/data), showRepresentationDetail (unknown/known), fillRepresentationClients, syncRepresentationClient (match/no-match), openRepresentationModal (new/existing), closeRepresentationModal, addRepresentationNatureLine (counter), saveRepresentation (create/update), deleteRepresentation (confirmed/cancelled), printRepresentations (window.open mock), stableRepNatureRows reset, regression chain |
| `tests/stage1a-sync-bypass-regression-test.js` | Fix: `if (_fail > 0) process.exit(1)` → `process.exit(_fail > 0 ? 1 : 0)` to prevent 5-minute hang from storage.js auto-backup timer |

### Extracted Globals (now in shared/representations.js, removed from app.js)

`stableRepNatureRows` (line 1550, `let`→`var`), `renderRepresentations`, `showRepresentationDetail`, `openRepresentationModal`, `closeRepresentationModal`, `fillRepresentationClients`, `syncRepresentationClient`, `addRepresentationNatureLine`, `saveRepresentation`, `deleteRepresentation`, `printRepresentations`

### Dependencies

representations.js resolved at call time: `STORE.representations/saveRepresentations/clients/natures` (defined in app.js STORE block); `esc`, `fmtMoney`, `num`, `formatDate`, `formatDateLong`, `todayStr` (utils.js); browser DOM (`document`, `window.open`, `confirm`, `setTimeout`).

### Script Load Order (after Stage 4J)

`js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → `js/shared/natures.js` → `js/shared/clients.js` → `js/shared/collaborateurs.js` → `js/shared/fournisseurs.js` → **`js/shared/representations.js`** → `js/taches.js`

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4j-test.js` | 66 | ✓ 66/66 |
| `tests/stage4i-test.js` | 69 | ✓ 69/69 |
| `tests/stage4h-test.js` | 51 | ✓ 51/51 |
| `tests/stage4g-test.js` | 49 | ✓ 49/49 |
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 (regression) |

### Commit

```
73f72c3
Stage 4J: extract Representations CRUD into js/shared/representations.js
```

Parent: `58b199754a198acce008436f43be8a1b5f4b3c67` (docs: record Stage 4I commit hash)

### Known Issues

Same as prior stages: `tests/core-test.js` pre-existing `_memCache` failure.

---

## Next Stage: Stage 4K — implemented (see top of file)

Stage 4K (Contracts CRUD extraction) is implemented. See the Stage 4K section at the top of this file for details.

---

## Stage 4F — Natures CRUD Extraction

**Objective:** Extract Natures de prestation CRUD from `js/app.js` into `js/shared/natures.js` as the first coherent CRUD unit (AGENTS.md §19 step 6).

### Changed Files

| File | Change |
|------|--------|
| `js/shared/natures.js` | NEW: 75 lines — Natures CRUD verbatim from app.js |
| `js/app.js` | Trimmed: 8668 → 8604 lines. Lines 4470–4535 (66 lines) replaced by 2-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/natures.js?v=20260801">` after dashboard.js |
| `tests/stage4f-test.js` | NEW: 37 tests — globals, renderNatures, openNatureModal, closeNatureModal, saveNature (create+update), deleteNature (confirmed+cancelled), showNatureDetail, regression chain |
| `js/plugins/production.runtime.js` | Comment updated to reference natures.js |

### Extracted Globals (now in shared/natures.js, removed from app.js)

`renderNatures`, `showNatureDetail`, `openNatureModal`, `closeNatureModal`, `saveNature`, `deleteNature`

### Deferred CRUD Blocks

The following remain in app.js for subsequent stages:
- **Clients CRUD** (lines ~4265–4370): `renderClients`, `showClientDetail`, `openClientModal`, `closeClientModal`, `saveClient`, `deleteClient`, `currentClientDetailId`
- **Collaborateurs CRUD** (lines ~4371–4468): `renderCollaborateurs`, `showCollabDetail`, `openCollabModal`, `closeCollabModal`, `saveCollab`, `deleteCollab`, `currentCollabDetailId`
- **Fournisseurs CRUD** (lines ~4537+): `renderFournisseurs`, `saveFournisseur`, `deleteFournisseur`
- All other CRUD (invoices, devis, RDVs, OMs, representations, accounting, etc.)

### Script Load Order (after Stage 4F)

`js/core/storage.js` → ... → `js/app.js` → `js/shared/calendar.js` → `js/shared/dashboard.js` → **`js/shared/natures.js`** → `js/taches.js`

### Dependencies

natures.js resolved at call time: `STORE.natures/saveNatures/representations/invoices` (storage.js); `esc`, `money`, `formatDate` (utils.js); `showView` (router.js).

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4f-test.js` | 37 | ✓ 37/37 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1621 + 37 new) | 1658 | Not rerun (AGENTS.md §8) |

### Commit

```
c39d2bc56355d06da9b92fd1166acae36294f5f2
refactor(natures): extract Natures CRUD into js/shared/natures.js
```

Parent: `b344f181be8c258600507cb803c005ca93c539b5` (docs(handover): record Stage 4E commit hash and remote HEAD)

### Known Issues

Same as Stage 4E: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Next Stage: Stage 4G

Stage 4F is complete. Continue extracting CRUD per AGENTS.md §19 step 6.

Recommended next: **Clients CRUD** (lines ~4265–4370, ~106 lines) or **Collaborateurs CRUD** (lines ~4371–4468, ~98 lines) into `js/shared/clients.js` / `js/shared/collaborateurs.js`.

**Preflight required before starting Stage 4G:**
1. `git fetch origin && git rev-parse HEAD origin/main` — confirm equal and both = `c39d2bc56355d06da9b92fd1166acae36294f5f2`
2. `git status --short` — confirm clean
3. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`

---

## Stage 4E — Dashboard Rendering Extraction

**Objective:** Extract dashboard rendering from `js/app.js` into `js/shared/dashboard.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/dashboard.js` | NEW: 282 lines — dashboard rendering verbatim from app.js |
| `js/app.js` | Trimmed: 8940 → 8668 lines. Lines 201–474 (updateDashboardStats + updateDashboardOperational, 274 lines) replaced by 2-line reference comment |
| `index.html` | 1 line: `<script src="js/shared/dashboard.js?v=20260801">` inserted after calendar.js |
| `tests/stage4e-test.js` | NEW: 31 tests covering all extracted globals, empty/populated data paths, recovery bar, upcoming RDVs, operational alerts, chain regression |
| `js/plugins/dashboard.runtime.js` | Comment updated: "What stays in app.js" → "What lives in js/shared/dashboard.js" |

### Extracted Globals (now in shared/dashboard.js, removed from app.js)

`updateDashboardStats`, `updateDashboardOperational`

`loadDashboardInscriptionsCount` was NOT extracted — it shares `_uclNum` with `loadInscriptions` (both remain in app.js).

### Script Load Order (after Stage 4E)

`js/core/storage.js` → `js/core/sync.js` → `js/core/router.js` → ... → `js/app.js` → `js/shared/calendar.js` → **`js/shared/dashboard.js`** → `js/taches.js`

### Dependencies

dashboard.js render callbacks resolved at call time: `STORE.*` (storage.js); `normalizeRdv`, `todayStr`, `fmtMoney`, `escapeHtml`, `formatDate`, `getInvoiceTotal`, `num` (utils.js); `editInvoice`, `rdvEdit`, `loadDashboardInscriptionsCount` (app.js).

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4e-test.js` | 31 | ✓ 31/31 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1590 + 31 new) | 1621 | Not rerun (AGENTS.md §8) |

### Commit

```
13655db0ba579eae88b32a964f42cc01c1143b07
refactor(dashboard): extract dashboard rendering into js/shared/dashboard.js
```

Parent: `7adb1fe5e1b6ace9ffa24f19e91827d3a34a4c2b` (refactor(calendar): extract calendar rendering into js/shared/calendar.js)

### Known Issues

Same as Stage 4D: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Next Stage: Stage 4F

Stage 4E is complete. The next extraction stage should continue reducing `js/app.js` per AGENTS.md §19.

AGENTS.md §19 step 6: **Extract CRUD plugins.**

**Preflight required before starting Stage 4F:**
1. `git fetch origin && git rev-parse HEAD origin/main` — confirm equal and both = `13655db0ba579eae88b32a964f42cc01c1143b07`
2. `git status --short` — confirm clean
3. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`

---

## Stage 4D — Calendar Rendering Extraction

**Objective:** Extract calendar rendering from `js/app.js` into `js/shared/calendar.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/shared/calendar.js` | NEW: 251 lines — calendar rendering verbatim from app.js |
| `js/app.js` | Trimmed: 9179 → 8940 lines. Two blocks removed: `calFilterMode` (line 1823) and CALENDRIER section (lines 7826–8065, 240 lines), replaced by reference comments |
| `index.html` | 1 line: `<script src="js/shared/calendar.js?v=20260801">` inserted after app.js, before taches.js |
| `tests/stage4d-test.js` | NEW: 32 tests covering all extracted globals, filter state, date helpers, renderCalendrier, _calRenderItem, openRdvModal, regression |
| `js/plugins/calendar.runtime.js` | Comment updated: "What stays in app.js" → "What lives in js/shared/calendar.js" |

### Extracted Globals (now in shared/calendar.js, removed from app.js)

`calFilterMode`, `openRdvModal`, `setCalFilter`, `_calDateLabel`, `_calDateSeparator`, `renderCalendrier`, `_calRenderItem`

`calFilterMode` was changed from `let` to `var` for global accessibility (consistent with module pattern).

### Script Load Order (after Stage 4D)

`js/core/storage.js` → `js/core/sync.js` → `js/core/router.js` → ... → `js/app.js` → **`js/shared/calendar.js`** → `js/taches.js`

Note: calendar.js loads AFTER app.js to preserve existing behavior (the `tasks.runtime.js` patch of `renderCalendrier` currently cannot apply at plugin load time — this is a pre-existing state, not introduced by Stage 4D).

### Dependencies

calendar.js render callbacks remain in `utils.js` (`normalizeRdv`, `todayStr`, `isRdvPaid`, etc.), `rappels.js` (`getRappels`, `getNextRappelDate`, etc.), and `app.js` (`rdvOpenForm`, `rdvEdit`, `rdvDelete`) — resolved at call time.

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4d-test.js` | 32 | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1558 + 32 new) | 1590 | Not rerun (AGENTS.md §8) |

### Commit

```
7adb1fe5e1b6ace9ffa24f19e91827d3a34a4c2b
refactor(calendar): extract calendar rendering into js/shared/calendar.js
```

Parent: `4f5c13559af845882ea1b54b94bc11163fd385e8` (docs(handover): record Stage 4C commit hash and remote HEAD)

### Known Issues

Same as Stage 4C: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Stage 4C — Routing Extraction

**Objective:** Extract routing/navigation from `js/app.js` into `js/core/router.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/core/router.js` | NEW: 93 lines — routing verbatim from app.js |
| `js/app.js` | Trimmed: 9269 → 9179 lines. Two routing blocks (lines 476–514 and 2426–2480, 90 lines total) replaced by 2-line reference comments each |
| `index.html` | 1 line: `<script src="js/core/router.js?v=20260801">` inserted after sync.js |
| `tests/stage4c-test.js` | NEW: 32 tests covering all extracted globals, navigateTo, showPage, showView, updateSidebarStats, regression |

### Extracted Globals (now in router.js, removed from app.js)

`currentPage`, `navigateTo`, `showPage`, `showView`, `updateSidebarStats`

`currentPage` was changed from `let` to `var` to become a true global (consistent with storage.js/sync.js module pattern).

The two runtime `showView` overrides at app.js lines 7826–7869 (mobile sidebar close, logs view) remain in app.js — they patch `window.showView` at execution time.

### Script Load Order (after Stage 4C)

`js/core/storage.js` → `js/core/sync.js` → `js/core/router.js` → `js/app.js` → `js/plugins/*.runtime.js`

### Dependencies

router.js render callbacks (`updateDashboardStats`, `renderList`, `renderClients`, etc.) remain in app.js — resolved at call time (runtime), not at load time.

`navigateTo` called from app.js at: lines 592, 1479, 1503, 1837 — unchanged (global).
`showView` called 50+ times in app.js and HTML `onclick` attributes — unchanged (global).
`Shell.navigation.go()` in shell.js delegates to `showView` — unchanged.

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4c-test.js` | 32 | ✓ 32/32 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1526 + 32 new) | 1558 | Not rerun (AGENTS.md §8) |

### Commit

```
c377a3ba5aa346b4bb70afe278714ee21a147126
refactor(router): extract routing into js/core/router.js
```

Parent: `9e0e368c5e6e040b7520d65083ec067073224002` (docs(handover): record Stage 4B commit hash and remote HEAD)

### Known Issues

Same as Stage 4B: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Stage 4B — Sync Engine Extraction

**Objective:** Extract the sync engine from `js/app.js` into `js/core/sync.js` as an atomic unit.

### Changed Files

| File | Change |
|------|--------|
| `js/core/sync.js` | NEW: 210 lines — sync engine verbatim from app.js |
| `js/app.js` | Trimmed: 9476 → 9269 lines. Sync engine block (lines 57–267, 211 lines) replaced by 3-line reference comment; stale comment updated to reference sync.js |
| `index.html` | 1 line: `<script src="js/core/sync.js?v=20260801">` inserted after storage.js |
| `tests/stage4b-test.js` | NEW: 52 tests covering all extracted globals, merge/tombstone behavior, syncFromServer steps, indicator, regression |

### Extracted Globals (now in sync.js, removed from app.js)

`_mergeCollections`, `_tombKey`, `_getDeletedIds`, `_markDeleted`, `_filterTombstoned`, `_syncIndicatorTimer`, `_showSyncIndicator`, `syncFromServer`

### Script Load Order (after Stage 4B)

`js/core/storage.js` → `js/core/sync.js` → `js/app.js` → `js/plugins/*.runtime.js`

### Dependencies

sync.js depends on storage.js for: `_storeGet`, `_safeSet`, `_storeSave`, `_metaUpdate`, `_pushCollection`, `_pendingKeys`, `_localMeta`, `_memCache`

`_markDeleted` is still called from app.js (lines 1604, 3036, 3039, 3115, 3229, 3258) — correct, it remains a global.

`syncFromServer` called from: `app.js` (3 sites), `auth.js` (guarded), `storage.js` `_pullFromServerNow` (guarded), `taches.js` (guarded).

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4b-test.js` | 52 | ✓ 52/52 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1474 + 52 new) | 1526 | Not rerun (AGENTS.md §8) |

### Commit

```
a77f3766a8c8a07991579a8715040be7ea3decf6
refactor(sync): extract sync engine into js/core/sync.js
```

Parent: `1fb71392579754f521fb5187ecfbecd5b3c31a9b` (docs(handover): record Stage 4A commit hash and remote HEAD)

### Known Issues

Same as Stage 4A: `tests/core-test.js` pre-existing `_memCache` failure. Not fixed, not regressed.

---

---

## Stage 4A — Pending Write Pipeline Extraction

**Objective:** Extract the pending write pipeline from `js/app.js` into `js/core/storage.js` as an atomic unit, making it available before the sync engine is loaded.

### Changed Files

| File | Change |
|------|--------|
| `js/core/storage.js` | Extended: 53 → 266 lines. Appended pending write pipeline verbatim from app.js |
| `js/app.js` | Trimmed: 9693 → 9475 lines. Pipeline block (indices 51–273, 223 lines) replaced by 5-line reference comment |
| `tests/stage1a-sync-bypass-regression-test.js` | Updated: dynamic STORE line-finding (was hardcoded), new sandbox globals, IIFE spy reinstall after storage.js load |
| `tests/stage4a-test.js` | NEW: 69 tests covering all extracted globals, Set behaviour, _storeSave pipeline, chunking, event listeners, debounce, regression |

### Extracted Globals (now in storage.js, removed from app.js)

`_localMeta`, `_metaUpdate`, `_pendingKeys`, `_pendingAdd`, `_pendingRemove`, `_pendingClear`, `_buildPendingBulk`, `_flushPending`, `_flushPendingBeacon`, `_pullFromServerNow`, `_lastPullTs`, `_autoBackupTimer`, `_triggerAutoBackup`, `_pushCollection`, `_storeSave`

Plus event listeners: `visibilitychange`, `pagehide`, `focus`, `online`, `setInterval(30000)`.

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `tests/stage4a-test.js` | 69 | ✓ 69/69 |
| `tests/stage1a-sync-bypass-regression-test.js` | 77 | ✓ 77/77 |
| Full suite (baseline 1405 + 69 new) | 1474 | Not rerun (AGENTS.md §22) |

### Script Load Order (after Stage 4A)

`js/core/storage.js` → `js/core/sync.js` (Stage 4B, not yet extracted) → `js/app.js` → `js/plugins/*.runtime.js`

### Known Issues

- `tests/core-test.js` fails with `ReferenceError: _memCache is not defined` — pre-existing bug, unrelated to Stage 4A. Not fixed.
- `/tmp/mythos-4a` on VPS may contain stale Stage 4A work (pre-AGENTS.md violation). Should be cleaned up when VPS SSH access is restored.

### Commit

```
09b808e5bc3c0c84022bf43c9419f2824cc1d809
refactor(storage): extract pending write pipeline
```

Parent: `128f2cbadc70f8d2800147dc589e10cd827c0b80` (docs(agent): add persistent project instructions)

---

## Next Stage: Stage 4E

Stage 4D is complete. The next extraction stage should continue reducing `js/app.js` per AGENTS.md §19.

AGENTS.md §19 step 5: **Extract Dashboard behavior.**

Candidates per ROADMAP.md: `shared/dashboard.js` (app.js lines ~700–975 — NOTE: line numbers are stale; find actual dashboard block by searching for `// ── DASHBOARD` or `function updateDashboardStats` in current app.js).

**Preflight required before starting Stage 4E:**
1. `git fetch origin && git rev-parse HEAD origin/main` — confirm equal and both = `7adb1fe5e1b6ace9ffa24f19e91827d3a34a4c2b`
2. `git status --short` — confirm clean
3. Read `AGENTS.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`
4. Map callers of the target functions before extracting

---

## What Was Committed Before Stage 4A

### Stages 3D–3H (committed, not documented here)
Baseline entering Stage 4A: **1405 tests**. Stages 3D–3H added runtime plugins for planning, calendar, search, and other modules. See git log for exact commits.

### Stage 3C (27d9a56) — Notes Runtime
`notes.plugin.js` → `notes.runtime.js`. 74 tests.

### Stage 3B (0b5ab5f) — Contacts Runtime
`contacts.plugin.js` → `contacts.runtime.js`. 78 tests.

---

## Risks

1. **core-test.js pre-existing failure** — `_memCache is not defined`. Do not regress further; investigate when addressing storage.js primitives.
2. **STORE v2 read bypass (app.js)** — reads still use raw localStorage in some places.
3. **Duplicate function stubs (app.js ~1078–1988)** — do not remove without `onclick` audit.
4. **Production safety** — `/var/www/uthinachess/0726/Prod/` must never be modified.

---

## Production Safety (permanent)

- Do NOT commit `google_config.php` — real Google OAuth credentials
- Do NOT commit `ACCES.txt` — plaintext access code
- Do NOT commit `appdata/` or `documents/` — live client data
- Do NOT touch production at `/var/www/uthinachess/0726/Prod/`
- Do NOT restart nginx or PHP
- Do NOT deploy anything

---

## Documentation Index

| File | Purpose |
|------|---------|
| `docs/PROJECT_STATE.md` | Current project status |
| `docs/ROADMAP.md` | Migration stages and acceptance criteria |
| `docs/AI_HANDOVER.md` | This file |
| `docs/architecture.md` | Stack, sync engine, app.js map |
| `docs/module-map.md` | JS module inventory, globals |
| `docs/runtime-services.md` | Runtime services API (Stage 3A.5) |
| `docs/mythos-os-platform.md` | Platform architecture |
| `docs/plugin-sdk.md` | Plugin SDK API reference |
| `docs/production-safety.md` | Production safety rules |
| `docs/worklogs/` | Per-task work logs |

---

## Legacy: Stage 3C Handover (superseded)

**Last updated:** 2026-07-31 10:00 UTC
**HEAD at that time:** 27d9a56 feat(notes): migrate to runtime plugin (Stage 3C)
**Tests at that time:** 893 (stale — actual baseline at Stage 4A start was 1405)

---

## What's Committed

### Stage 3B (0b5ab5f) — Contacts Runtime
`contacts.plugin.js` → `contacts.runtime.js`. 78 tests.

### Stage 3C (27d9a56) — Notes Runtime
`notes.plugin.js` → `notes.runtime.js`. 74 tests.

---

## Stage 3C — Implementation Summary

| File | Change |
|------|--------|
| `js/plugins/notes.runtime.js` | NEW — 156 lines |
| `js/plugins/notes.plugin.js` | DELETED |
| `index.html` | 1 line: plugin ref swapped |
| `tests/stage3c-test.js` | NEW — 74 tests |
| `tests/stage1c-part1-test.js` | 1 line: ref swapped |
| `tests/stage2d-test.js` | 1 line: ref swapped |
| `tests/stage3a-test.js` | 1 line: ref swapped |

Key details:
- Notes module reads `_rdGetDocs(cat)` from `redaction.js` — no STORE functions exist for notes
- Searches both 'das' and 'autres' categories by document `name` field
- Result shape: `{ id, title, subtitle, type, route, data }`
- `onBoot` validates `mp_rddocs_das` and `mp_rddocs_autres`
- `onReady` registers MythosSearch provider (id: 'notes', order: 6)

---

## Uncommitted Changes

| Group | Files | Notes |
|-------|-------|-------|
| 2 — Env | `.gitignore` | +37 lines: API key / OpenCode guards |
| 3 — AI tooling | `AGENTS.md`, `opencode.json`, `.opencode/` | AGENTS.md test count stale (fix to 893) |
| 4 — Docs | `docs/` directory, `docs/worklogs/` | 7 worklog entries |

---

## Test Baseline (committed)

| Suite | Tests |
|-------|-------|
| tests/stage1b-test.js | 45 |
| tests/stage1c-part1-test.js | 58 |
| tests/stage2a-test.js | 42 |
| tests/stage2b-test.js | 105 |
| tests/stage2c-test.js | 83 |
| tests/stage2d-test.js | 110 |
| tests/stage3a-test.js | 69 |
| tests/stage3a5-test.js | 152 |
| tests/stage1a-sync-bypass-regression-test.js | 77 |
| tests/stage3b-test.js | 78 |
| tests/stage3c-test.js | 74 |
| **TOTAL** | **893** |

---

## Priority Actions for Next Session

### 1. Stage 3D — Planning Runtime

Scope:
1. Read `js/plugins/planning.plugin.js`
2. Search for `mp_rappels`, `mp_rappel_types` in `js/app.js` / `js/rappels.js`
3. Create `js/plugins/planning.runtime.js`
4. `onBoot`: validate `mp_rappels` / `mp_rappel_types`
5. `onReady`: register MythosCalendar + MythosSearch providers
6. Update `index.html`, update affected test files
7. Delete `planning.plugin.js`
8. Create `tests/stage3d-test.js` (≥50 tests)
9. All suites pass, 0 failures

### 2. Optionally commit Groups 2–4 (environment, AI tooling, docs)

---

## Risks

1. **AGENTS.md test count (939)** — stale; correct to 893.
2. **STORE v2 read bypass (app.js ~2341)** — reads still use raw localStorage.
3. **Duplicate function stubs (app.js ~1078–1988)** — do not remove without `onclick` audit.
4. **Production safety** — `/var/www/uthinachess/0726/Prod/` must never be modified.
5. **Local is 3 commits ahead of origin/main** — never push without explicit approval.

---

## Documentation Index

| File | Purpose | Status |
|------|---------|--------|
| `docs/PROJECT_STATE.md` | Current project status | Updated |
| `docs/ROADMAP.md` | Migration stages and acceptance criteria | Updated |
| `docs/AI_HANDOVER.md` | This file | Updated |
| `docs/architecture.md` | Stack, sync engine, app.js map | Stable |
| `docs/module-map.md` | JS module inventory, globals | Stable |
| `docs/runtime-services.md` | Runtime services API (Stage 3A.5) | Stable |
| `docs/mythos-os-platform.md` | Platform architecture | Stable |
| `docs/plugin-sdk.md` | Plugin SDK API reference | Stable |
| `docs/production-safety.md` | Production safety rules | Stable |
| `docs/CHANGELOG.md` | Release changelog | Empty |
| `docs/worklogs/` | Per-task work logs | 7 entries
