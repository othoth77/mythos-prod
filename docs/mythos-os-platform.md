# Mythos OS — Platform Architecture

**Status:** Stage 3A.5 complete — Runtime Services foundation (js/core/services/)  
**Date:** 2026-07-29  
**Context:** Mythos Prod is being reconceived as one module inside a larger platform. This document defines what the platform looks like, how modules relate, and how to migrate the existing codebase toward this structure.

---

## Vision

Mythos OS is a single-origin web platform that hosts multiple business applications sharing a common foundation: authentication, data storage, synchronisation, contacts, calendar, and notifications. Each application (called a **module**) contributes its own domain logic while consuming platform services through a defined interface.

The platform runs entirely in the browser (SPA) with a PHP backend for persistence. No build step, no npm, no framework. The constraint of the current codebase is preserved by design.

---

## Layer diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        index.html                           │
│            (shell: routing, script loading, templates)      │
└────────────┬────────────────────────────────────────────────┘
             │ loads
             ▼
┌─────────────────────────────────────────────────────────────┐
│                         CORE                                │
│  js/core/storage.js   — sync engine, localStorage cache     │
│  js/core/api.js       — HTTP transport to api.php           │
│  js/core/auth.js      — session, login, logout              │
│  js/core/router.js    — section routing, navigation          │
│  js/core/logger.js    — activity log ring buffer             │
│  js/core/events.js    — lightweight pub/sub bus              │
└──────────────┬──────────────────────────────────────────────┘
               │ depends on
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    SHARED MODULES                            │
│  js/shared/contacts.js      — contact directory, history     │
│  js/shared/calendar.js      — date grid, rdv display         │
│  js/shared/tasks.js         — task list (was taches.js)      │
│  js/shared/planning.js      — reminders (was rappels.js)     │
│  js/shared/files.js         — document storage, upload.php   │
│  js/shared/notes.js         — free-form docs (was redaction) │
│  js/shared/notifications.js — toasts, push placeholders      │
│  js/shared/dashboard.js     — stats, KPIs, activity feed     │
│  js/shared/settings.js      — user preferences, config UI    │
└──────────────┬───────────────────────────────────────────────┘
               │ domain modules compose shared modules
               ▼
┌──────────────────────────────────────────────────────────────┐
│               PRODUCTION MODULE (Mythos Prod)                │
│  js/prod/invoices.js        — factures, devis                │
│  js/prod/mission-orders.js  — ordres de mission              │
│  js/prod/productions.js     — spectacles, représentations    │
│  js/prod/clients.js         — client CRUD                    │
│  js/prod/collaborators.js   — collab CRUD                    │
│  js/prod/accounting.js      — expenses, bank, cash, purchases│
│  js/prod/equipment.js       — vehicles, gear                  │
└──────────────────────────────────────────────────────────────┘
               +
┌──────────────────────────────────────────────────────────────┐
│             FUTURE MODULES (not yet built)                   │
│  js/hr/           — HR, payroll, leave                       │
│  js/projects/     — project boards, milestones               │
│  js/crm/          — full pipeline CRM beyond contacts        │
│  js/reports/      — analytics, export, charts                │
└──────────────────────────────────────────────────────────────┘
```

---

## Core

The core is loaded first on every page. It provides the services all other modules depend on. No module may bypass the core; all localStorage reads/writes go through `core/storage.js`, all HTTP calls go through `core/api.js`.

### core/storage.js

Extracted from the current sync engine (app.js lines 63–507). Owns:

- `_localMeta` — per-collection timestamps
- `_memCache` — in-memory fallback when localStorage is full
- `_pendingKeys` — persistent dirty-key queue
- `_storeGet(key, def)` — read from cache or localStorage
- `_storeSave(key, data)` — write local + queue + push
- `_safeSet(key, value)` — safe localStorage write with quota guard
- `_mergeCollections(local, server)` — merge by id + updatedAt
- `_tombKey`, `_getDeletedIds`, `_markDeleted`, `_filterTombstoned` — soft-delete

**Contract:** every data write in the platform calls `_storeSave`. No module writes to localStorage directly.

### core/api.js

Owns all HTTP transport. Extracted from app.js:

- `_buildPendingBulk()` — assemble queue payload
- `_pushCollection(key, value, updatedAt, onDone)` — chunked POST to api.php
- `_flushPending()` — drain queue via fetch
- `_flushPendingBeacon()` — drain queue via sendBeacon (pagehide/logout)
- `_triggerAutoBackup(label)` — debounced backup POST
- `_pullFromServerNow()` — GET `?key=__all__` anti-burst pull
- `syncFromServer(callback, silent)` — full bidirectional merge
- `_showSyncIndicator(msg, color)` — sync status toast
- Window event listeners: `visibilitychange`, `pagehide`, `focus`, `online`
- Background heartbeat: `_bgSyncInterval`, `_startBackgroundSync`

**Contract:** no module calls `fetch('api.php', ...)` directly. All HTTP goes through api.js.

### core/auth.js

Already extracted (current `js/auth.js`). Will move to `js/core/auth.js` as part of reorganisation.

- `AUTH` singleton
- Login, session validity, logout, loading screens
- On login: calls `syncFromServer` → `bootstrapStableApp`

### core/router.js

Currently embedded inside app.js (navigation functions, `showSection`, sidebar highlighting). Will be extracted to own cross-module routing state without knowing about any specific section.

### core/logger.js

Already extracted (current `js/logger.js`). Moves to `js/core/logger.js`.

### core/events.js

Does not exist yet. A minimal pub/sub bus so modules can react to each other without direct function calls.

```javascript
// planned API
Platform.events.on('contact:saved', handler);
Platform.events.emit('contact:saved', { id: '...' });
```

This eliminates the current pattern where `syncFromServer` hardcodes calls to `updateDashboardStats`, `renderTachesDashboard`, etc.

---

## Shared modules

Shared modules implement features that are useful across multiple platform applications. They read/write only through `core/storage.js`. They emit events via `core/events.js` instead of calling other modules directly.

### shared/contacts.js

Source: app.js lines 3071–4413.  
Keys: `mp_repertoire_contacts`, `mp_repertoire_imports`, `mp_appels`.  
Features: contact CRUD, call log, history, Google import, CSV export.  
Used by: Prod (clients linked to contacts), future CRM module.

### shared/calendar.js

Source: app.js lines 8600–8841.  
Features: monthly/weekly grid, event display from any collection.  
Consumes: any module can register events by emitting `calendar:event` on the event bus.

### shared/tasks.js

Source: current `js/taches.js`.  
Keys: `mp_taches`.  
Features: task CRUD, types (simple/importante/urgente), completion tracking.

### shared/planning.js

Source: current `js/rappels.js`.  
Keys: `mp_rappels`, `mp_rappel_types`.  
Features: recurring reminders, next-date calculation.

### shared/files.js

Source: `upload.php` integration + `mp_documents`.  
Features: file upload/download, metadata storage, document list rendering.

### shared/notes.js

Source: current `js/redaction.js`.  
Keys: `mp_rddocs_{cat}`, `mp_rdtpl_{docId}`, `mp_rdent_{docId}`.  
Features: category-based document editor, template/entry split, legacy migration.

### shared/notifications.js

Source: toast logic currently scattered across taches.js, accounting sections, etc.  
Unifies `_tchToast`, `_showSyncIndicator`, and ad-hoc alert calls into one API.

### shared/dashboard.js

Source: app.js lines 700–975.  
Features: KPI cards, recent activity feed, stats aggregated from any registered module.  
Modules register their KPIs by pushing to `Platform.dashboard.register(...)`.

### shared/settings.js

Source: scattered preferences in app.js.  
Features: app-level config UI, stored in `mp_settings`.

---

## Production module (Mythos Prod)

The production module is the first platform application. It uses all shared modules and adds its own domain logic. It does not contain any generic code — contacts, calendar, tasks, and notes are shared.

### prod/invoices.js

Source: app.js lines 4413–4965.  
Keys: `mp_invoices`, `mp_devis`.  
Features: invoice/quote CRUD, line items, print (PDF via browser), stamp SVG, TVA calculation.  
Depends on: `shared/contacts.js` (client lookup), `prod/clients.js`.

### prod/mission-orders.js

Source: app.js lines 4966–5296.  
Keys: `mp_oms`.  
Features: OM creation, multi-society support (Mythos / SDT / Kacem), person list, print.  
Depends on: `prod/collaborators.js`, `prod/clients.js`, `shared/contacts.js`.

### prod/productions.js

Source: app.js lines 1016–2340 (representations, rdvs v1 sections).  
Keys: `mp_rdvs`, `mp_representations`.  
Features: show management, venue, cast, financial tracking per show.  
Depends on: `shared/calendar.js`, `shared/contacts.js`.

### prod/clients.js

Source: app.js lines 5297–5402.  
Keys: `mp_clients`.  
Features: client CRUD.  
Note: distinct from shared contacts — clients are legal entities (companies) with MF number, TVA status, etc.

### prod/collaborators.js

Source: app.js lines 5403–5502.  
Keys: `mp_collabs`, `mp_natures`.  
Features: collab CRUD, nature-of-service taxonomy.

### prod/accounting.js

Source: app.js lines 5741–8382.  
Keys: `mp_bank_entries`, `mp_cash_entries`, `mp_expenses`, `mp_expense_categories`, `mp_suppliers`, `mp_purchases`.  
Features: bank reconciliation, cash register, expense tracking, purchase invoices, supplier CRUD.

### prod/equipment.js

Source: vehicle data within OM sections and accounting.  
Keys: `mp_vehicules`.  
Features: vehicle registry, assignment to OM missions.

---

## Future modules

These are not planned for the current sprint. The platform architecture must not preclude them.

| Module | Purpose |
|--------|---------|
| `js/hr/` | Employee records, payroll, leave management |
| `js/projects/` | Project boards, milestone tracking, time logging |
| `js/crm/` | Full sales pipeline extending shared/contacts |
| `js/reports/` | Exportable analytics, charts, multi-period comparisons |
| `js/inscriptions/` | Venue inscription management (already partially in app.js) |
| `js/multi-user/` | User management, role assignment, per-user data scoping |

---

## Module interface contract

Every platform module must follow this structure to be composable:

```javascript
// Required: self-contained IIFE or object, no leaking internals
const MyModule = (function() {

  // 1. Storage keys this module owns
  const KEYS = { items: 'mp_mymodule_items' };

  // 2. Read/write only through core/storage.js
  function getItems()       { return _storeGet(KEYS.items, '[]'); }
  function saveItems(list)  { _storeSave(KEYS.items, list); }

  // 3. Emit events instead of calling other modules directly
  function onItemSaved(item) {
    Platform.events.emit('mymodule:saved', item);
  }

  // 4. Register with dashboard if contributing KPIs
  function registerKpis() {
    Platform.dashboard.register('mymodule', function() {
      return [{ icon: '📦', label: 'Items', value: getItems().length }];
    });
  }

  // 5. Public API — only what other modules or index.html need
  return { getItems, saveItems, registerKpis };

})();
```

This contract is aspirational for new code. Existing extracted modules (`taches.js`, `rappels.js`, `redaction.js`) will be adapted progressively.

---

## Server side (api.php)

No changes planned to api.php. The flat JSON model scales adequately for the current data volume. The platform architecture does not require a relational database.

If a future module needs per-user data isolation, api.php must be extended to:
1. Accept a session token in the request header
2. Route reads/writes to per-user subdirectories (`appdata/{userId}/`)

That is a Phase 5+ concern.

---

## Migration strategy

### Stage 0 — Documentation (current)

Define the target architecture before touching code. This document.

### Stage 1 — Core extraction ✓ (Stage 1A complete)

**1A (done):** `js/core/storage.js` — `_memCache`, `_storeGet`, `_safeSet`, `_storeHas`, `_storeRemove`. `js/core/api.js` — `_apiFetch`, `_apiGet`, `_apiPost`, `_apiTimeout`, `_apiParseJson`, `_apiRetry`. app.js: 9725 → 9703 lines.

**1B (done):** `js/core/events.js` — Events pub/sub (on/off/once/emit, handler isolation). `js/core/platform.js` — Platform registry (registerPlugin, getPlugin, getPlugins, hasPlugin, boot, ready, lifecycle events). 45/45 tests pass.

**2A (done):** `js/plugins/production.plugin.js` — Production plugin registered with 30 routes, 19 storageKeys, empty lifecycle hooks. 42/42 tests pass.

**2B (done):** 6 shared plugins registered (dashboard, calendar, tasks, planning, contacts, notes). 105/105 tests pass.

**2C (done):** `js/core/shell.js` — Shell layer: sidebar registry, workspace state, navigation adapter, widget registry, header accessors. Auto-registers plugin menu items via Events. 83/83 tests pass.

**1C Part 1 (done):** Full fetch() audit across app.js, taches.js, rappels.js, redaction.js, auth.js. 23 calls found — all fall into protected categories (sync engine, backup/restore, upload/download, Google, auth beacon). Zero calls migrated. Inventory document: `docs/fetch-inventory.md`. taches.js, rappels.js, redaction.js have zero fetch() calls.

**2D (done):** `js/core/plugin-sdk.js` — Plugin SDK with fluent builder API. Plugin.create() + 9 define*() methods + build(). 110/110 tests pass.

**3A (done):** `js/plugins/tasks.runtime.js` — Tasks bootstrap migrated from `taches.js` to Platform lifecycle. Plugin registered via SDK. Search + calendar providers added. Platform.boot()/ready() wired into bootstrapStableApp.

**3A.5 (done):** Runtime Services foundation. 5 services + plugin-services bridge. MythosSearch, MythosCalendar, MythosWidgets, MythosNotifications, MythosDialogs. 152/152 tests pass.

**3B (done):** Contacts runtime plugin. `contacts.runtime.js` replaces `contacts.plugin.js`. onBoot storage validation, onReady MythosSearch provider. All contacts logic stays in app.js.

**3C (done):** Notes runtime plugin. `notes.runtime.js` replaces `notes.plugin.js`. onBoot storage validation for `mp_rddocs_das` and `mp_rddocs_autres`, onReady MythosSearch provider registered with order 7. All notes/redaction logic stays in `redaction.js` and `app.js`.

**3D (done):** Planning runtime plugin. `planning.runtime.js` replaces `planning.plugin.js`. onBoot storage validation for `mp_rappels` and `mp_rappel_types`, onReady MythosSearch provider (order 7) and MythosCalendar provider (order 5) registered. Calendar events use `dateDebut` as start date, allDay true. Planning has no dedicated route (modal-based). All rappel CRUD, rendering, and recurrence logic stays in `rappels.js` and `app.js`.

**1C Part 2 (next):** Revisit after Stage 3 extracts business-module code. Migration candidates will be isolated in plugin `onReady` handlers where context is cleaner.

Loading order after Stage 1:
```html
<script src="js/utils.js"></script>
<script src="js/core/storage.js"></script>
<script src="js/core/api.js"></script>
<script src="js/core/logger.js"></script>
<script src="js/core/auth.js"></script>
<script src="js/app.js"></script>        <!-- still holds business code -->
<script src="js/taches.js"></script>
```

### Stage 2 — Shared module extraction

Move generic modules out of app.js one at a time:

1. `shared/tasks.js` — rename taches.js, adjust paths
2. `shared/planning.js` — rename rappels.js, adjust paths
3. `shared/notes.js` — rename redaction.js, adjust paths
4. `shared/contacts.js` — extract from app.js lines 3071–4413
5. `shared/calendar.js` — extract from app.js lines 8600–8841
6. `shared/dashboard.js` — extract from app.js lines 700–975

Each extraction is one commit. Smoke-test after each.

### Stage 3 — Production module extraction

Move production-specific domains out of app.js:

1. `prod/clients.js`, `prod/collaborators.js` — simple CRUD, few cross-refs
2. `prod/equipment.js` — minimal
3. `prod/mission-orders.js`
4. `prod/invoices.js`
5. `prod/accounting.js` — largest, extract last

### Stage 4 — Directory reorganisation

Rename files to match the new hierarchy:

```
js/
  core/
    storage.js
    api.js
    auth.js
    router.js
    logger.js
    events.js
  shared/
    contacts.js
    calendar.js
    tasks.js
    planning.js
    files.js
    notes.js
    notifications.js
    dashboard.js
    settings.js
  prod/
    invoices.js
    mission-orders.js
    productions.js
    clients.js
    collaborators.js
    accounting.js
    equipment.js
  utils.js
  app.js          ← bootstrap only (~200 lines)
```

Update all `<script src>` tags in index.html.

### Stage 5 — Platform API surface

Define the `Platform` global object that modules use to register themselves:

```javascript
// js/core/platform.js (new file)
const Platform = {
  events:    { on, off, emit },
  dashboard: { register },
  router:    { navigate, onNavigate },
};
```

Modules stop calling each other by function name. All cross-module communication goes through `Platform.events`.

### Stage 6 — Second platform app (future)

When a second Mythos OS application is built (HR, projects, etc.), it will:

1. Include `js/core/*.js` and `js/shared/*.js` via the same `index.html` shell
2. Add its own `js/{appname}/*.js` domain modules
3. Register its KPIs with `Platform.dashboard.register`
4. Share contacts, calendar, tasks, notes with Mythos Prod automatically

At this point Mythos Prod becomes one of many apps on the platform rather than the entire platform.

---

## What does NOT change

- `api.php` — server-side logic is untouched throughout all stages
- `google_callback.php`, `google_auth.php`, `google_fetch_result.php` — unchanged
- `appdata/` — file layout unchanged; localStorage keys unchanged
- CSS — no changes to styling
- HTML structure in index.html — templates stay in place; only `<script src>` tags change
- Application behaviour — every stage is a pure refactor with no user-visible changes

---

## Constraints (permanent)

- No TypeScript
- No bundler (webpack, vite, rollup)
- No framework (Vue, React, Svelte)
- No npm
- No ES modules (`import`/`export`) — vanilla `<script>` tags only
- Backward compatibility with existing localStorage data is mandatory
- `google_config.php`, `ACCES.txt`, `appdata/`, `documents/` are never committed
- Production at `/var/www/uthinachess/0726/Prod/` is never touched directly
