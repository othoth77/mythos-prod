# Mythos OS — Runtime Architecture Consolidation

**Stage:** 3H  
**Date:** 2026-07-30  
**Status:** Complete — All 7 runtime plugins migrated and documented.

---

## Runtime Architecture Overview

Mythos OS Runtime Architecture is the layer between the Plugin SDK and the application code in `app.js`. It defines how business and shared plugins self-register, validate their storage, expose search and calendar providers, and integrate with the platform lifecycle — all without modifying `app.js` or any core file.

The runtime architecture was built progressively across Stages 3A–3G and consolidated here in Stage 3H.

---

## 4-Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — CORE SERVICES                                            │
│                                                                     │
│  js/core/events.js          — lightweight pub/sub bus               │
│  js/core/platform.js        — plugin registry + lifecycle           │
│  js/core/shell.js           — sidebar, widgets, navigation adapter  │
│  js/core/services/search.js      — MythosSearch provider registry   │
│  js/core/services/calendar.js    — MythosCalendar provider registry │
│  js/core/services/widgets.js     — MythosWidgets registry           │
│  js/core/services/notifications.js — MythosNotifications            │
│  js/core/services/dialogs.js     — MythosDialogs                    │
│  js/core/services/plugin-services.js — PluginServices auto-wirer    │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ provides foundation for
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — PLUGIN SDK                                               │
│                                                                     │
│  js/core/plugin-sdk.js                                              │
│    Plugin.create(base)                                              │
│      .defineMenu(cfg)    .defineRoutes(routes)                      │
│      .defineStorage(keys) .defineWidgets(widgets)                   │
│      .defineSearch(cfg)  .defineCalendar(cfg)                       │
│      .defineDashboard(cfg) .definePermissions(cfg)                  │
│      .defineSettings(settings)                                      │
│      .build()  → Platform.registerPlugin(manifest)                  │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ used by
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — RUNTIME PLUGINS                                          │
│                                                                     │
│  js/plugins/production.runtime.js  (business) — 486 lines          │
│  js/plugins/dashboard.runtime.js   (shared)   — 123 lines          │
│  js/plugins/calendar.runtime.js    (shared)   — 115 lines          │
│  js/plugins/tasks.runtime.js       (shared)   — 231 lines          │
│  js/plugins/planning.runtime.js    (shared)   — 227 lines          │
│  js/plugins/contacts.runtime.js    (shared)   — 133 lines          │
│  js/plugins/notes.runtime.js       (shared)   — 163 lines          │
│                                                                     │
│  Total: 1 478 lines across 7 runtime plugins                        │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ bootstraps
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 4 — APPLICATION CODE                                         │
│                                                                     │
│  js/app.js   — STORE object, CRUD, rendering, sync engine,         │
│                showView(), dashboard stats, calendar render         │
│  js/auth.js  — AUTH singleton                                       │
│  js/logger.js — LOGGER singleton                                    │
│  js/taches.js — task CRUD, rendering, storage helpers              │
│  (rappels.js merged into app.js or standalone)                      │
│  (redaction.js merged into app.js or standalone)                    │
│  index.html  — SPA shell, script loading order                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Plugin Graph

| Plugin | File | Type | MythosSearch | MythosCalendar | MythosWidgets |
|--------|------|------|:------------:|:--------------:|:-------------:|
| production | production.runtime.js | business | id=production (8 collections) | id=production (rdvs+reprs) | — |
| dashboard | dashboard.runtime.js | shared | — | — (consumer) | — (scaffolded) |
| calendar | calendar.runtime.js | shared | — | — (consumer) | — |
| tasks | tasks.runtime.js | shared | id=tasks | id=tasks | — |
| planning | planning.runtime.js | shared | id=planning | id=planning | — |
| contacts | contacts.runtime.js | shared | id=contacts | — | — |
| notes | notes.runtime.js | shared | id=notes | — | — |

**Total MythosSearch providers:** 5 (production, tasks, planning, contacts, notes)  
**Total MythosCalendar providers:** 3 (production, tasks, planning)  
**Total MythosWidgets registrations:** 0 (no explicit registrations at this stage; scaffolding in dashboard.runtime.js)

---

## Startup Sequence

```
1.  Browser parses index.html <script> tags (blocking, in order)

2.  js/core/events.js loaded           → Events global available
3.  js/core/platform.js loaded         → Platform global available
4.  js/core/shell.js loaded            → Shell global + sidebar listener wired
5.  js/core/services/search.js loaded  → MythosSearch global available
6.  js/core/services/calendar.js loaded → MythosCalendar global available
7.  js/core/services/widgets.js loaded → MythosWidgets global available
8.  js/core/services/notifications.js  → MythosNotifications available
9.  js/core/services/dialogs.js        → MythosDialogs available
10. js/core/services/plugin-services.js → PluginServices listener attached
        Events.on('mythos:plugin:registered') → auto-wires search/calendar/widgets
11. js/core/plugin-sdk.js loaded       → Plugin.create() builder available

12. js/plugins/production.runtime.js loaded
        → defines _PRODUCTION_RT_STATE, _productionSearchHandler,
          _productionCalendarProvider, _productionInit
        → Plugin.create({...}).defineSearch().defineCalendar().build()
           → Platform.registerPlugin(manifest)
              → Events.emit('mythos:plugin:registered')
                 → PluginServices._consume(manifest)
                    → MythosSearch.registerProvider('production') [if not yet registered]
                    → MythosCalendar.registerProvider('production') [if not yet registered]
        → window.addEventListener('load', fallback guard)

13. js/plugins/dashboard.runtime.js loaded
        → Plugin.create({...}).build()
           → Platform.registerPlugin(manifest)
        → window.addEventListener('load', fallback guard)

14. js/plugins/calendar.runtime.js loaded  (same pattern)
15. js/plugins/tasks.runtime.js loaded     (+ MythosSearch + MythosCalendar via SDK + PluginServices)
16. js/plugins/planning.runtime.js loaded  (+ MythosSearch + MythosCalendar via SDK + PluginServices)
17. js/plugins/contacts.runtime.js loaded  (+ MythosSearch via SDK + PluginServices)
18. js/plugins/notes.runtime.js loaded     (+ MythosSearch via SDK + PluginServices)

19. js/logger.js loaded
20. js/auth.js loaded
21. js/app.js loaded
        → STORE object defined with all collection accessors
        → syncFromServer(callback) called on DOMContentLoaded

22. DOMContentLoaded fires (via auth.js AUTH.init())
        → AUTH.init() → validates session
        → syncFromServer(callback)
              → pulls latest data from server into localStorage
              → callback():
                    → Platform.boot()
                          → phase: 'init' → 'booted'
                          → Events.emit('mythos:boot')
                          → For each plugin: plugin.onBoot()
                              production.onBoot() — validates 20 storage keys
                              dashboard.onBoot()  — no-op
                              calendar.onBoot()   — no-op
                              tasks.onBoot()      — validates mp_taches
                              planning.onBoot()   — validates mp_rappels, mp_rappel_types
                              contacts.onBoot()   — validates mp_repertoire_contacts, mp_repertoire_imports
                              notes.onBoot()      — validates mp_rddocs_das, mp_rddocs_autres
                    → Platform.ready()
                          → phase: 'booted' → 'ready'
                          → For each plugin: plugin.onReady()
                              production.onReady() → _productionInit()
                                   → MythosSearch.registerProvider('production') [if absent]
                                   → MythosCalendar.registerProvider('production') [if absent]
                              dashboard.onReady()  → _dashboardInit() [sets initialized=true]
                              calendar.onReady()   → _calendarInit()  [sets initialized=true]
                              tasks.onReady()      → _tasksInit()
                                   → patches renderCalendrier, updateDashboardStats, showView
                                   → MythosSearch.registerProvider('tasks') [if absent]
                                   → MythosCalendar.registerProvider('tasks') [if absent]
                              planning.onReady()   → _planningInit()
                                   → MythosSearch.registerProvider('planning') [if absent]
                                   → MythosCalendar.registerProvider('planning') [if absent]
                              contacts.onReady()   → _contactsInit()
                                   → MythosSearch.registerProvider('contacts') [if absent]
                              notes.onReady()      → _notesInit()
                                   → MythosSearch.registerProvider('notes') [if absent]
                          → Events.emit('mythos:ready', { plugins: [...] })
                    → showView(initial) — navigate to initial view
```

---

## Provider Registry

### MythosSearch Providers (5 total)

| Provider ID | Label | Order | Plugin | Collections Searched |
|-------------|-------|------:|--------|---------------------|
| production | Production | 10 | production.runtime.js | invoices, clients, devis, contracts, rdvs, oms, representations, collabs |
| tasks | Taches | 3 | tasks.runtime.js | mp_taches (note field, via getTaches()) |
| planning | Planning | 7 | planning.runtime.js | mp_rappels (titre, type, details) |
| contacts | Contacts | 5 | contacts.runtime.js | mp_repertoire_contacts (nom, prenom, tel1, tel2, email, metier, domaine, note, tags) |
| notes | Notes | 7 | notes.runtime.js | mp_rddocs_das, mp_rddocs_autres (name field) |

### MythosCalendar Providers (3 total)

| Provider ID | Label | Order | Plugin | Data Sources |
|-------------|-------|------:|--------|-------------|
| production | Production | 10 | production.runtime.js | mp_rdvs (RDVs), mp_representations (shows) |
| tasks | Taches | 3 | tasks.runtime.js | mp_taches (dueDate field, via getTaches()) |
| planning | Planning | 5 | planning.runtime.js | mp_rappels (dateDebut field) |

---

## Ownership Map (localStorage)

| Key | Owner | Validated in onBoot |
|-----|-------|:-------------------:|
| mp_invoices | production | yes |
| mp_devis | production | yes |
| mp_contracts | production | yes |
| mp_rdvs | production | yes |
| mp_rendez_vous | production | yes |
| mp_representations | production | yes |
| mp_oms | production | yes |
| mp_clients | production | yes |
| mp_collabs | production | yes |
| mp_natures | production | yes |
| mp_bank_entries | production | yes |
| mp_cash_entries | production | yes |
| mp_expenses | production | yes |
| mp_expense_categories | production | yes |
| mp_suppliers | production | yes |
| mp_purchases | production | yes |
| mp_vehicules | production | yes |
| mp_documents | production | yes |
| mp_validated_inscriptions | production | yes |
| mp_appels | production | yes |
| mp_taches | tasks | yes |
| mp_rappels | planning | yes |
| mp_rappel_types | planning | yes |
| mp_repertoire_contacts | contacts | yes |
| mp_repertoire_imports | contacts | yes |
| mp_rddocs_das | notes | yes |
| mp_rddocs_autres | notes | yes |

**Total localStorage keys owned by runtime plugins: 27**

**Sync internals (not plugin-owned):**
- `_mp_sync_meta` — sync engine (app.js)
- `_mp_pending_keys` — sync engine (app.js)
- `mp_auth_session` — auth.js
- `mp_activity_log` — logger.js

---

## Legacy Dependencies

The following functions and objects remain in `js/app.js` and are intentionally NOT migrated in Stage 3H. This is by design — Stage 3H is consolidation and documentation only.

### STORE object (app.js line 486)

```javascript
const STORE = {
  invoices, saveInvoices, devis, saveDevis, contracts, saveContracts,
  clients, saveClients, oms, saveOms, collabs, saveCollabs,
  natures, saveNatures, bankEntries, saveBankEntries,
  cashEntries, saveCashEntries, suppliers, saveSuppliers,
  purchases, savePurchases, expenses, saveExpenses,
  expenseCategories, saveExpenseCategories, rendezVous, saveRendezVous,
  rdvs, saveRdvs, representations, saveRepresentations,
  documents, saveDocuments, vehicules, saveVehicules,
  repertoireContacts, saveRepertoireContacts,
  repertoireImports, saveRepertoireImports,
  appels, saveAppels, validatedInscriptions, saveValidatedInscriptions
}
```

**Why it stays:** All 7 runtime plugins are late-bound to STORE via `typeof STORE === 'undefined'` guards. STORE is read at call time (not at registration time). Migrating STORE requires extracting _storeGet/_storeSave into a separate core module, which is a Stage 4 concern.

### showView() (app.js line 2865)

The central SPA routing function. Every view switch goes through `showView(viewName)`. The tasks.runtime.js patches it via monkey-patching to inject task page rendering. Migrating `showView()` to `Shell.navigation.go()` requires a router extraction (Stage 4).

### Dashboard rendering (app.js lines 627–975)

- `updateDashboardStats()` — KPI aggregation + DOM writes
- `updateDashboardOperational()` — operational section renderer
- `loadDashboardInscriptionsCount()` — external Google Sheets fetch

These stay in app.js because they directly manipulate dashboard DOM elements defined in index.html templates. The tasks.runtime.js patches `updateDashboardStats()` to append the task widget.

### Calendar rendering (app.js line 8399)

- `renderCalendrier()` — main calendar render, reads STORE.rdvs() and getRappels() directly

The calendar.runtime.js registers the plugin but defers the actual render to app.js. A future stage will replace `renderCalendrier()` with `MythosCalendar.getEvents(range)` aggregation.

### Data accessors (app.js)

- `getRappels()` / `saveRappelsList()` — planning data access
- `getTaches()` / `saveTaches()` — task data access (in taches.js)
- `getNextRappelDate()` — recurrence calculation

These are used as late-bound globals by planning.runtime.js and tasks.runtime.js.

### Sync engine (app.js)

- `syncFromServer(callback, silent)` — full bidirectional merge
- `_buildPendingBulk()`, `_flushPending()`, `_flushPendingBeacon()` — sync mechanics

---

## Remaining app.js Responsibilities

1. **STORE object** — all localStorage accessor wrappers (28 accessors)
2. **Sync engine** — `syncFromServer`, queue management, heartbeat, beacon
3. **showView()** — SPA routing, sidebar highlighting, view transitions
4. **Dashboard stats** — `updateDashboardStats()`, `updateDashboardOperational()`, `loadDashboardInscriptionsCount()`
5. **Calendar rendering** — `renderCalendrier()`, `setCalFilter()`, `_calRenderItem()`
6. **All CRUD functions** — invoices, devis, contracts, clients, rdvs, oms, representations, collabs, accounting, contacts, notes
7. **Print/export functions** — invoice print, OM print, CSV export
8. **Business logic** — `getInvoiceTotal()`, `normalizeRdv()`, `getRdvAmount()`, reconciliation
9. **Bootstrap** — `bootstrapStableApp()`, `initializeDemoData()`, `restoreBackup20260516Once()`
10. **Platform lifecycle calls** — `Platform.boot()` and `Platform.ready()` (called once in syncFromServer callback)

---

## Dead Code Findings (Report Only — Do NOT Remove)

The following observations were made during the Stage 3H audit. None have been removed.

1. **Legacy plugin.js files on disk:** All 7 original plugin.js files remain on disk in `js/plugins/` (`tasks.plugin.js`, `contacts.plugin.js`, `notes.plugin.js`, `planning.plugin.js`, `calendar.plugin.js`, `dashboard.plugin.js`, `production.plugin.js`). They are NOT referenced in `index.html` (only the `.runtime.js` variants are loaded). They are dead code on disk but harmless. Removal is deferred to a cleanup stage.

2. **Double provider registration path in tasks.runtime.js:** `_tasksInit()` (lines 106–135) registers MythosSearch and MythosCalendar providers directly, which duplicates what PluginServices already does via the `defineSearch`/`defineCalendar` manifest fields. The `hasProvider()` guard prevents actual duplication at runtime. This is by design (fallback for partial migration scenarios).

3. **`renderCalendrier` defined in app.js — tasks.runtime.js also references it:** The `_tasksInit()` function patches the global `renderCalendrier` by wrapping it. If `renderCalendrier` is not yet defined when `_tasksInit()` runs (due to load order), the patch silently skips. This is safe but could be simplified once app.js is further extracted.

---

## Future Migration Plan (Stage 4+)

> These are notes only. No implementation in Stage 3H.

| Stage | Goal |
|-------|------|
| 4A | Extract STORE + _storeGet/_storeSave into `js/core/storage.js` |
| 4B | Extract sync engine into `js/core/sync.js` |
| 4C | Extract `showView()` into `js/core/router.js`; replace `Shell.navigation.go()` |
| 4D | Extract `renderCalendrier()` into calendar.runtime.js; replace direct `STORE.rdvs()` calls with `MythosCalendar.getEvents()` |
| 4E | Extract `updateDashboardStats()` and `updateDashboardOperational()` into dashboard.runtime.js; use `MythosWidgets` for widget registration |
| 4F | Migrate all CRUD functions into their respective runtime plugins |
| 5  | app.js becomes ~200 lines: bootstrap only |

---

## Compatibility Matrix

| Plugin | MythosSearch absent | MythosCalendar absent | STORE absent |
|--------|:------------------:|:--------------------:|:------------:|
| production | no provider (silent) | no provider (silent) | returns [] from handler |
| tasks | no provider (silent) | no provider (silent) | returns [] via getTaches guard |
| planning | no provider (silent) | no provider (silent) | reads localStorage directly |
| contacts | no provider (silent) | N/A | returns [] via STORE guard |
| notes | no provider (silent) | N/A | reads localStorage directly |
| calendar | N/A (consumer) | getEvents still called via app.js | N/A |
| dashboard | N/A (consumer) | N/A (consumer) | stats rendering fails silently |

All service registrations are guarded with `typeof MythosSearch !== 'undefined'` and `!MythosSearch.hasProvider(id)` checks. All STORE accesses are guarded with `typeof STORE === 'undefined'` checks. No crash occurs when any service or global is absent.

---

## Runtime Metrics

| Metric | Count |
|--------|------:|
| Total runtime plugins | 7 |
| Total MythosSearch providers | 5 |
| Total MythosCalendar providers | 3 |
| Total MythosWidgets registrations | 0 |
| Total localStorage keys owned by runtime plugins | 27 |
| Total routes declared in plugin manifests | 37 |
| Remaining app.js responsibility categories | 10 |
| Total lines in runtime plugins | 1 478 |
