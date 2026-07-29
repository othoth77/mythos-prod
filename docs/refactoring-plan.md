# Mythos Prod — Refactoring Plan

**Last updated:** 2026-07-29  
**Constraint:** No frameworks. No build step. No module system (no `import`/`export`). Vanilla JS only.

---

## Goals

1. Break `app.js` (9 948 lines, 510 KB) into focused, maintainable files.
2. Eliminate duplicate function declarations.
3. Standardize the storage API (currently two incompatible implementations).
4. Make each module independently readable and testable.
5. Never break production. Each phase must be independently deployable.

## Non-goals for this plan

- No TypeScript.
- No bundler (webpack, vite, rollup).
- No framework (Vue, React, Svelte).
- No test framework (jest, etc.) — manual testing only until Phase 7.
- No changes to `api.php` server logic.
- No changes to CSS or HTML structure.

---

## Phase 0 — Preparation (before any extraction)

**Objective:** Establish a safety baseline. Nothing moves.

### Tasks

0.1 **Audit duplicate functions** — locate all re-declarations and document which callers reference the early stubs vs. the active ones. Do not delete yet.  
Reference: `addLine` (lines 1919, 4485), `editInvoice` (1078, 4599), `deleteInvoice` (1094, 4626), `setOmDateQuick` (1923, 5085), `addOmPerson` (1905, 5102), `cancelOM` (1988, 5202).

0.2 **Inventory all inline `onclick` attributes in index.html** — map every `onclick="funcName(...)"` to its definition. This reveals which functions are DOM-coupled and cannot be renamed or moved without updating HTML.

0.3 **Document the STORE v1/v2 split** — list every call site of `STORE.rdvs()` (v2, raw localStorage) vs. `_storeGet('mp_rdvs', ...)` (v1, cache-backed). Unify choice before Phase 3.

0.4 **Create a manual smoke-test checklist** covering: login, save an invoice, save a quote, add a client, add a task, add a reminder, write a document (redaction), save OM, check dashboard stats, logout (data must persist after reload).

**Exit criteria:** All duplicate functions documented, all onclick callers mapped, smoke-test checklist written.

---

## Phase 1 — Utilities

**Objective:** Extract all pure functions (no DOM, no localStorage, no API calls) into `js/utils.js`.

### Functions to extract from app.js

| Function | Current line | Notes |
|----------|-------------|-------|
| `todayStr()` | 614 | Pure |
| `money(val)` | 621 | Pure |
| `escapeHtml(text)` | 625 | Pure |
| `formatDate(dateStr)` | 636 | Pure |
| `formatDateLong(dateStr)` | 642 | Pure |
| `esc(text)` | 2388 | Second HTML-escape — merge with `escapeHtml` |
| `num(value)` | 2392 | Pure |
| `fmtMoney(value)` | 2396 | Pure |
| `paymentModeLabel(mode)` | 2400 | Pure |
| `dateInputValue(offsetDays)` | 2443 | Pure |
| `calendarDateCard(dateStr)` | 2449 | Pure |
| `isDateInCurrentWeek(dateStr)` | 2460 | Pure |
| `cleanPrintText(text)` | 5219 | Pure |
| `sanitizeInput(str, maxLen)` | 8385 | Pure |
| `numberToFrenchWords(num)` | 4842 | Pure |
| `_statKpi(icon, label, value, color)` | 8243 | Pure HTML builder |
| `_statMini(label, count, sub)` | 8251 | Pure HTML builder |

### Escape function consolidation

Currently three variants exist:
- `escapeHtml(text)` — app.js:625, DOM-based escape via `document.createElement`
- `esc(text)` — app.js:2388, regex-based escape
- `_escHtmlInsc(v)` — app.js:2530, same as `esc`
- `escHtml(t)` — defined inside rappels.js for internal use

In `utils.js`, define one canonical `escHtml(text)` using the regex approach (no DOM dependency — safer for extraction). Then alias `escapeHtml = escHtml` and `esc = escHtml` in app.js where the old names are called.

### Procedure

1. Write the function bodies into `js/utils.js`.
2. In `app.js`, replace each function body with a one-line comment: `// moved to js/utils.js`.
3. Load `js/utils.js` before `js/app.js` in index.html.
4. Run smoke-test checklist.

**Risk:** LOW — pure functions, no side effects.

---

## Phase 2 — API service

**Objective:** Extract all direct `fetch('api.php', ...)` and `sendBeacon` calls into `js/api-service.js`.

### Functions to extract

All from the sync engine (app.js lines 63–507) — BUT these functions are deeply entangled. Do NOT move the sync engine wholesale. Instead, create a thin API wrapper that the sync engine calls.

New file `js/api-service.js`:

```javascript
const ApiService = {
  baseUrl: 'api.php',

  // GET a single collection or special action
  async get(keyOrAction) { ... },

  // GET all collections
  async getAll() { ... },

  // POST a single collection save
  async save(key, value, updatedAt) { ... },

  // POST bulk save
  async bulk(data, updatedAt) { ... },

  // POST auto backup
  async autoBackup(data, label) { ... },

  // Beacon-based bulk (for pagehide/logout)
  beacon(data, updatedAt) { ... },
};
```

The existing `_pushCollection`, `_flushPending`, `_flushPendingBeacon`, `syncFromServer` keep their names and logic — they just call `ApiService.*` instead of raw `fetch`.

**Risk:** MEDIUM — the sync engine handles error states, chunking, and timing. Change one call at a time, test after each change.

### Procedure

1. Write `ApiService` object with all methods.
2. Replace one `fetch('api.php', ...)` call in app.js with `ApiService.save(...)`.
3. Test that collection save still works.
4. Repeat for each call site.
5. Load `js/api-service.js` before `js/app.js`.

---

## Phase 3 — Storage service

**Objective:** Unify the two storage APIs (`_storeGet`/`_storeSave` vs. STORE v2 raw localStorage lambdas) and move the result into `js/storage.js`.

### Current problem

STORE v2 (app.js:2341–2361) bypasses the sync queue:
```javascript
rdvs: () => JSON.parse(localStorage.getItem('mp_rdvs') || '[]'),
saveRdvs: d => localStorage.setItem('mp_rdvs', JSON.stringify(d)),
```

This means writes via STORE v2 do NOT get queued for server sync. Data saved this way may be lost if the user closes the tab before the next manual sync.

### Target design

Replace STORE v2 with a proxy that calls `_storeSave`:
```javascript
const Store = {
  get(key, fallback = []) { return _storeGet(key, JSON.stringify(fallback)); },
  set(key, value)         { _storeSave(key, value); },
  // Named accessors (read)
  invoices()     { return Store.get('mp_invoices'); },
  // Named mutators (write — go through sync queue)
  saveInvoices(d){ Store.set('mp_invoices', d); },
  // ... all 30+ collections
};
```

Then update all STORE v2 call sites (`STORE.rdvs()`, `STORE.saveRdvs(d)`, etc.) to use the new unified Store.

### Procedure

1. Write `js/storage.js` with the unified `Store` object.
2. Load before `js/app.js`.
3. Replace STORE v2 call sites one module at a time (accounting section first — most isolated).
4. Remove STORE v2 block from app.js.
5. Verify that every write goes through the sync queue.

**Risk:** HIGH — any Store.set call that silently stops hitting `_storeSave` will break server sync. Test each collection individually after migrating its call sites.

---

## Phase 4 — UI helpers

**Objective:** Extract DOM-manipulation helpers that are used across many modules.

Target file: `js/ui-helpers.js`

### Candidates

| Function | Notes |
|----------|-------|
| `_showSyncIndicator(msg, color)` | Sync toast — currently in sync engine |
| `closeModalFromOutsideClick(event)` | Generic modal dismiss |
| `printModal(previewId)` | Generic print helper |
| `_tchToast(msg, type)` | Already in taches.js — generalize |
| `fillModalFields(prefix, item, fields)` | Generic modal populate |
| `saveModalEntity(...)` | Generic modal save |
| `renderEntityPage(...)` | Generic list renderer |

### Note on `_showSyncIndicator`

This function is inside the sync engine (app.js:372). Moving it to `ui-helpers.js` requires the sync engine to call `UIHelpers.showSyncIndicator(...)`. This is safe only after Phase 2 (API service) is done and the sync engine is already calling through wrappers.

**Risk:** MEDIUM — UI helpers touch the DOM but have no business logic. Regression risk is visual only.

---

## Phase 5 — Business modules

**Objective:** Move each business domain from app.js into its stub file.

Extract one domain at a time. Do not extract two domains in the same commit.

### Extraction order (safest to riskiest)

| Order | Domain | Target file | app.js lines | Notes |
|-------|--------|------------|-------------|-------|
| 1 | Fournisseurs | `js/fournisseurs.js` | 5569–5740 | Few cross-refs |
| 2 | Natures | `js/natures.js` | 5502–5568 | Simple CRUD |
| 3 | Collaborateurs | `js/collaborateurs.js` | 5403–5502 | Simple CRUD |
| 4 | Clients | `js/clients.js` | 5297–5402 | Referenced by invoices |
| 5 | Calendar | `js/calendrier.js` | 8600–8841 | Self-contained |
| 6 | Spectacle calculator | `js/calculateur.js` (new) | 9040–9168 | Fully isolated |
| 7 | Documentation module | `js/documentation.js` (new) | 9168–9660 | Self-contained |
| 8 | Camera module | `js/camera.js` (new) | 9660–9948 | Self-contained |
| 9 | Ordres de Mission | `js/ordres-mission.js` | 4966–5296 | Refs clients, natures |
| 10 | Invoices + Devis | `js/factures.js` | 4413–4965 | Complex |
| 11 | Accounting | `js/comptabilite.js` (new) | 5741–8382 | Largest section |
| 12 | Dashboard | `js/dashboard.js` | 700–975 | Refs all collections |
| 13 | Contact directory | `js/contacts.js` (new) | 3071–4413 | Complex + history |
| 14 | Inscriptions | `js/inscriptions.js` (new) | 2528–2870 | Google Sheet coupling |

### Extraction procedure (per domain)

1. Identify all functions belonging to the domain (use section map in architecture.md).
2. Identify all global variables the domain reads (other than `_storeGet`/Store).
3. Create the target file with just the functions.
4. In app.js, replace the function bodies with stub redirects or remove after verifying all HTML callers.
5. Add `<script src="js/{domain}.js"></script>` to index.html before `js/app.js`.
6. Run smoke-test checklist.
7. Commit the single-domain extraction.

**Risk:** HIGH for domains with many HTML `onclick` callers. Always audit index.html before extraction.

---

## Phase 6 — Split app.js

**Objective:** app.js should contain only the sync engine and bootstrap sequence. Everything else has been extracted.

After Phase 5, app.js should contain:
- Lines 1–62: Constants (SOCIETES, DEVIS_SOCIETES, logo paths)
- Lines 63–507: Sync engine
- Lines 508–611: Store (now thin, calls Phase 3 storage.js)
- Lines 612–699: Utility stubs (calls Phase 1 utils.js)
- Lines 2341–2527: bootstrapStableApp + navigation

Target size after Phase 6: ~600 lines.

---

## Phase 7 — Tests and cleanup

**Objective:** Add basic automated verification and remove all dead code.

### Tasks

7.1 **Remove early duplicate function stubs** (addLine, editInvoice, etc.) — safe only after verifying no HTML `onclick` references them.

7.2 **Remove STORE v2 completely** — replaced in Phase 3.

7.3 **Remove one-time migration guards** — `restoreBackup20260516Once` and `forceRestoreBackup20260516` can be removed after confirming production localStorage no longer has the old keys. Coordinate with production administrator.

7.4 **Add integration smoke tests** — write a `tests/smoke.js` that runs in browser console and verifies: auth, save/load each collection, sync indicator appears, backup creates file.

7.5 **Add jshint/eslint configuration** — `js/.eslintrc.json` targeting ES2020, browser globals, no-unused-vars.

7.6 **Review `app-fresh.js`** — this 348-line experimental rewrite is unused. Evaluate whether it contains ideas worth merging, then either incorporate or delete it.

---

## Summary table

| Phase | Files touched | Risk | Behavior change |
|-------|--------------|------|----------------|
| 0 | none (analysis only) | None | None |
| 1 | utils.js, app.js | Low | None |
| 2 | api-service.js, app.js | Medium | None |
| 3 | storage.js, app.js | High | None (if done correctly) |
| 4 | ui-helpers.js, app.js | Medium | None |
| 5 | 14 domain files, app.js | High | None |
| 6 | app.js (now thin) | Low | None |
| 7 | all (cleanup) | Low | None |

---

## Recommended first extraction

**Start with Phase 1 — `utils.js` — `escHtml`/`todayStr`/`money` group.**

Reasons:
- Pure functions: zero DOM, zero localStorage, zero network.
- No HTML onclick callers — only called from JS.
- Immediately reduces the global namespace by ~15 functions.
- Sets the pattern for all subsequent extractions.
- Fully reversible: if something breaks, put the functions back in app.js and remove the script tag.
