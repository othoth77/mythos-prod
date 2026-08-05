# Mythos OS — Roadmap

**Last updated:** 2026-08-05 UTC (AVA-0 added)

---

## Completed Stages

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

---

## In Progress

*None. Stage 3D is next.*

---

## Upcoming Stages (in dependency order)

### Stage 3D — Planning Runtime
**Depends on:** None (can run any time)  
**Deliverable:** `js/plugins/planning.runtime.js`  
**Replaces:** `js/plugins/planning.plugin.js`  
**Test file:** `tests/stage3d-test.js`  
**What it provides:** onBoot: validate `mp_rappels`/`mp_rappel_types`. onReady: register MythosCalendar + MythosSearch providers.

### Stage 3E — Calendar Runtime
**Depends on:** 3B, 3C, 3D (wiring all providers)  
**Deliverable:** `js/plugins/calendar.runtime.js`  
**Replaces:** `js/plugins/calendar.plugin.js`  
**Test file:** `tests/stage3e-test.js`

### Stage 3F — Dashboard Runtime
**Depends on:** 3B–3E (consumes all providers)  
**Deliverable:** `js/plugins/dashboard.runtime.js`  
**Replaces:** `js/plugins/dashboard.plugin.js`  
**Test file:** `tests/stage3f-test.js`

### Stage 3G — Production Runtime
**Depends on:** 3B–3F (all services established)  
**Deliverable:** `js/plugins/production.runtime.js`  
**Replaces:** `js/plugins/production.plugin.js`  
**Test file:** `tests/stage3g-test.js`  
**Risk:** HIGH — production plugin has 30 routes and 19 storage keys.

---

## Future Stages (post-3G)

### Stage 4 — Shared Module Extraction
Move generic modules out of app.js into `js/shared/`:
1. `shared/tasks.js` — rename from taches.js
2. `shared/planning.js` — rename from rappels.js
3. `shared/notes.js` — rename from redaction.js
4. `shared/contacts.js` — extract from app.js lines 3071–4413
5. `shared/calendar.js` — extract from app.js lines 8600–8841
6. `shared/dashboard.js` — extract from app.js lines 700–975

**Known blocked items (requires dedicated stage):**
- `stableLineCount` collision: `mission-orders.js:28` (`let stableLineCount`) prevents `invoices.js` from loading. Fix requires removing the `let` declaration, then deleting `editInvoice`, `deleteInvoice`, `populateInvoiceList` from `app.js`.

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

1. **Mythos OS:** Stage 3D (next) → 3E → 3F → 3G (runtime plugins)
2. **ID Auto (parallel track):** IDA-2 — PostgreSQL Core, API and Manual Capture MVP
3. **AutoValeur (parallel track):** AVA-1 — Public Calculator MVP (after IDA-2 provides PostgreSQL cluster)

---

## ID Auto — Separate Product Track

ID Auto (`idauto.tn`) is a vehicle plate lookup and vehicle intelligence platform for Tunisia. It is a product within the Mythos ecosystem, sharing this repository under `projects/idauto/` and `docs/IDAUTO_*.md`.

See `docs/IDAUTO_ROADMAP.md` for the full ID Auto stage plan.

| Stage | Description | Status |
|-------|-------------|--------|
| IDA-0 | Foundation — schema, config, architecture, privacy contract | ✓ Done (2026-08-05) |
| IDA-1 | Product vision, capture, access and data governance specification | ✓ Done (2026-08-05) |
| IDA-2 | PostgreSQL Core, API and Manual Capture MVP | Planned |
| IDA-3 | Public Smart Scanner and Carte Grise Workflow | Planned |
| IDA-4 | Fixpert Smart Gate and Atelier Integration | Planned |
| IDA-5 | Professional Partner Network | Planned |
| IDA-6 | National Enrichment and Public/Professional Launch | Future |

**Key decisions from IDA-1:**
- ID Auto is a Mythos ecosystem product (integrated, not isolated)
- PostgreSQL is the selected target DBMS (not yet installed)
- Observation-first data model
- Three access scopes: PUBLIC, PROFESSIONAL, MYTHOS_PRIVATE
- Smart Gate events are always MYTHOS_PRIVATE
- Plate format rules are unverified drafts pending official source confirmation
- Fixpert workshop operations (clients, invoices, payments) belong to Fixpert; ID Auto provides the vehicle identity layer

---

## AutoValeur — Separate Product Track

AutoValeur is an independent vehicle valuation and Tunisian used-car market intelligence product inside the Mythos ecosystem. It is a product within the Mythos ecosystem, sharing this repository under `projects/autovaleur/` and `docs/AUTOVALEUR_*.md`.

See `docs/AUTOVALEUR_ROADMAP.md` for the full AutoValeur stage plan.

| Stage | Description | Status |
|-------|-------------|--------|
| AVA-0 | Foundation and Ecosystem Roadmap | ✓ Done (2026-08-05) |
| AVA-1 | Public Calculator MVP | Planned |
| AVA-2 | Professional Tier and Fixpert Integration | Planned |
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
