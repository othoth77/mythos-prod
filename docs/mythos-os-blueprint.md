# Mythos OS — Platform Blueprint

**Version:** 1.0  
**Date:** 2026-07-30  
**Status:** Stage 3A.5 complete — Runtime Services foundation  
**Constraint:** Pure PHP + Vanilla JS. No framework. No build step. No npm. No ES modules.

---

## Table of Contents

1. [Platform Vision](#1-platform-vision)
2. [Core Services](#2-core-services)
3. [Shared Applications](#3-shared-applications)
4. [Business Applications](#4-business-applications)
5. [Plugin Architecture](#5-plugin-architecture)
6. [Data Architecture](#6-data-architecture)
7. [UI Architecture](#7-ui-architecture)
8. [Long-Term Roadmap](#8-long-term-roadmap)
9. [Directory Tree](#9-directory-tree)

---

## 1. Platform Vision

### What is Mythos OS?

Mythos OS is a **browser-native business operating system** for small and medium enterprises in Tunisia and the MENA region. It runs entirely as a single-page application served by a lightweight PHP backend. No installation. No native app. No dependency on external cloud services.

The platform hosts multiple business applications — production management, accounting, CRM, HR, project tracking — inside a unified shell with shared services: one login, one contact directory, one calendar, one notification center, one set of settings.

### Design philosophy

**Offline first.** Every read is served from localStorage. Every write is queued and synced to the server when connectivity is available. The application must be fully usable with no internet connection for an indefinite period.

**Own your data.** All data lives in `appdata/*.json` on a server the operator controls. No third-party data processors. No telemetry. No analytics that leave the origin.

**No framework, no build step.** The platform runs on plain `<script>` tags, vanilla JS globals, and PHP file I/O. This is a deliberate choice: zero toolchain, zero dependencies, deployable on any shared hosting with PHP 7.4+.

**Progressive.** New applications are added by dropping a JS file and registering a plugin manifest. No recompilation. No deployment of the shell. The shell discovers and loads plugins at startup.

**Composable.** Every shared module exposes a documented API surface. Business applications consume shared modules rather than reimplementing contacts, calendar, tasks, or notifications.

### Current state (Mythos Prod)

Mythos Prod is the first business application on the platform. It manages productions, invoices, mission orders, clients, collaborators, and accounting for Mythos Production SARL and its affiliated companies.

The 9 725-line `js/app.js` monolith is being progressively extracted into the platform architecture defined in this document. At no point is production behaviour modified. Each extraction is independently deployable and reversible.

### Target state

```
Mythos OS
├── Core services (auth, storage, sync, events, notifications, settings, log)
├── Shared apps (dashboard, contacts, calendar, tasks, planning, files, notes, search, reports)
└── Business apps
    ├── Mythos Prod (invoices, OMs, productions, accounting)
    ├── [future] CRM
    ├── [future] Inventory
    ├── [future] Transport
    ├── [future] HR
    └── [future] Projects
```

---

## 2. Core Services

Core services are loaded first on every page, before any shared or business application. No application may bypass a core service. All core services are stateless singletons (no classes, no constructors) — plain objects and globals, consistent with the no-framework constraint.

### 2.1 Authentication — `js/core/auth.js`

**Current status:** Extracted (existing `js/auth.js`), to be moved to `js/core/auth.js`.

**Responsibilities:**
- Session lifecycle: create, validate (8 h expiry), destroy
- Password hashing via Web Crypto SHA-256 (no plain-text passwords in memory)
- Login UI: render login screen, loading screen, logout spinner
- Bootstrap gate: after successful login + sync, calls `bootstrapStableApp()`

**Public API:**
```javascript
AUTH.init()                     // Called on DOMContentLoaded; gates app start
AUTH.handleLogin()              // Validates credentials, runs sync, boots app
AUTH.logout()                   // Flushes pending data via sendBeacon, reloads page
AUTH.isSessionValid()           // Returns boolean; used by sync anti-burst guard
AUTH.showLoadingScreen(msg)     // Show spinner with message
AUTH.hideLoadingScreen()        // Hide spinner
AUTH.updateLoadingMessage(msg)  // Update spinner text mid-operation
```

**Storage key:** `mp_auth_session` — `{ ts: <timestamp> }` — never synced to server.

**Multi-user extension (future):** When user accounts are added, `mp_auth_session` will carry `{ ts, userId, role, displayName }`. The login flow will POST credentials to a new `auth.php` endpoint rather than comparing to a hardcoded hash.

---

### 2.2 Users — `js/core/users.js` *(future)*

**Current status:** Not yet built. Single-user platform (one hardcoded credential in `api.php`).

**Planned responsibilities:**
- User record CRUD (admin only)
- `mp_users` collection: `{ id, username, displayName, role, passwordHash, createdAt }`
- Role definitions: `admin`, `manager`, `staff`, `readonly`
- Current-user accessor: `Users.current()` — returns the logged-in user object
- User picker UI (shared modal for assigning users to tasks, documents, clients)

**Dependency chain:** Users depends on Auth. Permissions depends on Users.

---

### 2.3 Permissions — `js/core/permissions.js` *(future)*

**Current status:** Not yet built. All authenticated users have full access to all data.

**Planned model:** Role-based access control (RBAC) with collection-level granularity.

```javascript
// Permission matrix (stored in mp_permissions)
{
  admin:    { read: '*', write: '*', delete: '*' },
  manager:  { read: '*', write: '*', delete: 'own' },
  staff:    { read: ['mp_invoices','mp_rdvs','mp_clients'], write: 'own', delete: false },
  readonly: { read: '*', write: false, delete: false }
}
```

**Public API:**
```javascript
Permissions.can(action, resource)        // 'read'/'write'/'delete', collection key
Permissions.assertCan(action, resource)  // throws if not allowed
Permissions.filterForRole(list, key)     // filter a list to items the user may see
```

**Server-side enforcement:** `api.php` must be extended to verify a session token on every request before permissions are meaningful. Until then, permissions are UI-only guards.

---

### 2.4 Storage — `js/core/storage.js`

**Current status:** Stage 1A complete. Provides the localStorage layer.

**Functions:**
```javascript
_storeGet(key, def)    // Read from localStorage or _memCache; JSON-parsed
_safeSet(key, value)   // Write to localStorage + _memCache; quota-safe
_storeHas(key)         // Existence check
_storeRemove(key)      // Remove from both stores
var _memCache          // In-memory fallback; survives a localStorage quota breach
```

**Contract:** Every data read and write in the platform goes through `_storeGet` / `_safeSet`. No module calls `localStorage.getItem` / `localStorage.setItem` directly.

**Migration guard:** `_storeGet` returns the parsed default value if the stored value is invalid JSON, so schema migrations that change a field's type never crash the application.

---

### 2.5 API — `js/core/api.js`

**Current status:** Stage 1A complete. Provides thin HTTP transport helpers.

**Functions:**
```javascript
_apiFetch(url, options, timeoutMs)  // timeout-aware fetch wrapper
_apiTimeout(ms)                     // AbortController helper; returns {signal, clear}
_apiParseJson(response)             // HTTP-error-aware JSON parser
_apiGet(params, timeoutMs)          // GET api.php?key=... → Promise<Object>
_apiPost(body, timeoutMs)           // POST api.php JSON body → Promise<Object>
_apiRetry(fn, maxAttempts, delayMs) // exponential-backoff combinator
var _API_ENDPOINT                   // 'api.php' — overridable for multi-tenant
```

**Stage 1B (next):** Migrate existing raw `fetch('api.php', ...)` calls in app.js (`_flushPending`, `_pushCollection`, `_triggerAutoBackup`, `syncFromServer`) to call through `_apiPost` / `_apiGet`.

**Future:** When multi-tenant or multi-origin support is needed, `_API_ENDPOINT` becomes a per-tenant configuration value loaded from a `config.json` at startup.

---

### 2.6 Event Bus — `js/core/events.js` *(planned)*

**Current status:** Implemented (Stage 1B, `js/core/events.js`). Cross-module communication currently still happens via direct function calls with `typeof` guards in app.js; migration to Events will happen per-module during shared-app extraction (Stage 3) (`if (typeof updateDashboardStats === 'function') updateDashboardStats()`).

**Problem solved:** The sync engine (`syncFromServer`) currently hardcodes calls to UI functions in specific business modules. Adding a new module that needs to react to sync requires editing `syncFromServer`. The event bus decouples this.

**Design:** Minimal pub/sub — no classes, no Promises, synchronous dispatch.

```javascript
// js/core/events.js
var Platform = Platform || {};
Platform.events = (function() {
  var _listeners = {};

  return {
    on: function(event, handler) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(handler);
    },
    off: function(event, handler) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function(h) { return h !== handler; });
    },
    emit: function(event, data) {
      (_listeners[event] || []).forEach(function(h) {
        try { h(data); } catch(e) { console.error('[Events] Error in handler for "' + event + '":', e); }
      });
    },
    once: function(event, handler) {
      function wrapper(data) { Platform.events.off(event, wrapper); handler(data); }
      Platform.events.on(event, wrapper);
    }
  };
})();
```

**Standard events:**

| Event | Emitter | Payload |
|-------|---------|---------|
| `sync:start` | api.js | `{ silent: bool }` |
| `sync:complete` | api.js | `{ keysUpdated: [] }` |
| `sync:error` | api.js | `{ error: Error }` |
| `auth:login` | auth.js | `{ userId }` |
| `auth:logout` | auth.js | — |
| `contact:saved` | contacts.js | `{ id, contact }` |
| `contact:deleted` | contacts.js | `{ id }` |
| `task:saved` | tasks.js | `{ id, task }` |
| `task:completed` | tasks.js | `{ id }` |
| `calendar:event:saved` | calendar.js | `{ id, event }` |
| `notification:show` | notifications.js | `{ msg, type, duration }` |
| `settings:changed` | settings.js | `{ key, value }` |
| `plugin:registered` | platform.js | `{ pluginId }` |

---

### 2.7 Notifications — `js/core/notifications.js` *(planned)*

**Current status:** Toast/notification logic is scattered across taches.js (`_tchToast`), the sync engine (`_showSyncIndicator`), and ad-hoc inline alerts in accounting sections.

**Goal:** One notification system for the entire platform.

```javascript
Platform.notify.toast(msg, type, durationMs)  // 'info'|'success'|'warning'|'error'
Platform.notify.sync(msg, color)              // sync dot (bottom-right indicator)
Platform.notify.badge(moduleId, count)        // sidebar badge (future)
Platform.notify.push(title, body)             // browser Notification API (future, with permission)
```

**Visual spec:**
- Sync indicator: fixed bottom-right dot — current `_showSyncIndicator` implementation, unified here
- Toast: animated pill above the sync dot; stacks up to 3; auto-dismiss in 3 s
- Badge: red circle on sidebar icon, driven by count from each module

---

### 2.8 Settings — `js/core/settings.js` *(planned)*

**Current status:** User preferences are stored ad-hoc in individual localStorage keys with no central registry.

**Design:**

```javascript
// All settings live in mp_settings: { key: value, ... }
Platform.settings.get(key, default)   // read a setting
Platform.settings.set(key, value)     // write a setting + emit 'settings:changed'
Platform.settings.getAll()            // full settings object
```

**Built-in setting keys:**

| Key | Default | Description |
|-----|---------|-------------|
| `theme` | `dark` | `dark` or `light` |
| `language` | `fr` | `fr`, `ar`, `en` |
| `dateFormat` | `dd/mm/yyyy` | display date format |
| `currency` | `TND` | display currency |
| `fiscalYearStart` | `01-01` | MM-DD for accounting periods |
| `defaultSociete` | `mythos` | default company for new invoices |
| `sidebarCollapsed` | `false` | sidebar collapsed state |
| `notificationsEnabled` | `true` | show toasts |
| `autoBackupEnabled` | `true` | trigger server backup on save |
| `syncIntervalSeconds` | `30` | background sync heartbeat |

Business applications register their own setting keys via `Platform.settings.register(key, default, label)`.

---

### 2.9 Logging — `js/core/logger.js`

**Current status:** Extracted (`js/logger.js`), to be moved to `js/core/logger.js`.

**LOGGER singleton:** Ring buffer capped at 200 entries in `mp_activity_log`. Never synced to server (local audit trail only).

```javascript
LOGGER.log(action, details)  // append entry
LOGGER.getLogs()             // return all entries
LOGGER.clearLogs()           // wipe ring buffer
LOGGER.exportLogs()          // download as JSON file
```

**Future:** When multi-user is enabled, each log entry will carry `userId` and entries will be synced to a `mp_audit_log` collection on the server for admin review.

---

## 3. Shared Applications

Shared applications are platform features available to every business app. They read/write through `js/core/storage.js`, communicate through `Platform.events`, and register their menu items with the platform shell.

A shared application does not contain any business-specific logic. It provides a general-purpose feature that any future Mythos OS application can use.

---

### 3.1 Dashboard — `js/shared/dashboard.js`

**Source:** app.js lines 700–975 (to be extracted in Stage 2).

**Responsibilities:**
- Aggregate KPI cards from all registered modules
- Recent activity feed (from `mp_activity_log` + per-module recent items)
- Quick-action shortcuts to most-used features

**Module KPI registration:**
```javascript
// Each module calls this after loading
Platform.dashboard.register('prod-invoices', function() {
  var invoices = _storeGet('mp_invoices', '[]');
  return [
    { icon: '🧾', label: 'Factures', value: invoices.length, color: '#d4af37' },
    { icon: '💰', label: 'CA mois', value: fmtMoney(calcMonthRevenue(invoices)), color: '#22c55e' }
  ];
});
```

**Shell:** The dashboard page calls `Platform.dashboard.renderAll()` which iterates registered modules and renders each block. Modules not loaded simply do not appear.

---

### 3.2 Calendar — `js/shared/calendar.js`

**Source:** app.js lines 8600–8841.

**Responsibilities:**
- Month and week grid rendering
- Event display from any registered source
- Date navigation, today-jump, mini-calendar widget

**Event source registration:**
```javascript
Platform.calendar.registerSource('prod-rdvs', function(fromDate, toDate) {
  return _storeGet('mp_rdvs', '[]').filter(function(e) {
    return e.date >= fromDate && e.date <= toDate;
  }).map(function(e) {
    return { id: e.id, date: e.date, title: e.titre, color: '#d4af37', source: 'prod-rdvs' };
  });
});
```

Any module (tasks, reminders, HR absences, project milestones) registers its own source. The calendar renders all sources in a unified grid.

---

### 3.3 Contacts — `js/shared/contacts.js`

**Source:** app.js lines 3071–4413.

**Storage keys:** `mp_repertoire_contacts`, `mp_repertoire_imports`, `mp_appels`.

**Responsibilities:**
- Contact CRUD (create, read, update, delete with tombstoning)
- Contact history (call log, interaction timeline)
- Google Contacts import (OAuth flow via `google_auth.php`)
- CSV export / print directory
- Call log: `mp_appels` — date, contact, outcome, duration, note
- Contact picker modal (shared across all modules that need to link a contact)

**Contact picker API:**
```javascript
// Any module can open a contact picker and receive the selected contact
Platform.contacts.pick(function(contact) {
  // contact: { id, nom, prenom, tel1, email, ... }
  myForm.clientName.value = contact.nom + ' ' + contact.prenom;
  myForm.clientPhone.value = contact.tel1;
});
```

---

### 3.4 Tasks — `js/shared/tasks.js`

**Source:** current `js/taches.js` (rename + adapt to platform events).

**Storage key:** `mp_taches`.

**Responsibilities:**
- Task CRUD: titre, type (simple / importante / urgente), dateEcheance, complete, note
- Due-date tracking, overdue highlighting
- Dashboard badge: count of overdue tasks
- Sidebar reminder dot

**Platform integration:**
```javascript
// Tasks emits events other modules can react to
Platform.events.emit('task:completed', { id: task.id, task: task });
```

---

### 3.5 Planning — `js/shared/planning.js`

**Source:** current `js/rappels.js` (rename + adapt).

**Storage keys:** `mp_rappels`, `mp_rappel_types`.

**Responsibilities:**
- Recurring reminders: titre, type, dateDebut, période, nextDate
- Next-date calculation (daily, weekly, monthly, yearly)
- Overdue reminder alerts on login
- Reminder type taxonomy (user-editable categories)

---

### 3.6 Files — `js/shared/files.js`

**Source:** integration with `upload.php` + `mp_documents`.

**Storage key:** `mp_documents`.

**Responsibilities:**
- File upload (via `upload.php`) — PDF, images, Word docs
- File metadata storage: `{ id, name, mime, size, uploadedAt, linkedTo: {type, id}, url }`
- File browser UI: list, preview (inline for images/PDFs), download
- File attachment: any module can attach files to its records via `linkedTo`

**File attachment API:**
```javascript
Platform.files.attach(entityType, entityId, function(file) {
  // Called with { id, name, url } after upload completes
});
Platform.files.listFor(entityType, entityId)  // → array of file metadata
```

---

### 3.7 Notes — `js/shared/notes.js`

**Source:** current `js/redaction.js` (rename + adapt).

**Storage keys:** `mp_rddocs_{cat}`, `mp_rdtpl_{docId}`, `mp_rdent_{docId}`.

**Responsibilities:**
- Category-based document editor (template + filled-in entry)
- Rich text via `contenteditable` (no external editor)
- Document list per category with search
- Legacy migration: detects old `mp_rdtpl_*` / `mp_rdent_*` keys and upgrades

**Note attachment API:**
```javascript
Platform.notes.openFor(entityType, entityId)  // open notes panel linked to an entity
```

---

### 3.8 Search — `js/shared/search.js` *(planned)*

**Current status:** Not yet built. Each module has its own search input.

**Design:** Global search bar (keyboard shortcut: `/` or `Ctrl+K`) that queries all registered modules in parallel and returns unified results.

**Source registration:**
```javascript
Platform.search.registerSource('contacts', function(query) {
  var q = query.toLowerCase();
  return _storeGet('mp_repertoire_contacts', '[]')
    .filter(function(c) {
      return (c.nom + ' ' + c.prenom + ' ' + c.tel1).toLowerCase().includes(q);
    })
    .slice(0, 5)
    .map(function(c) {
      return {
        label: c.nom + ' ' + c.prenom,
        sub:   c.tel1,
        icon:  '👤',
        action: function() { Platform.router.navigate('contacts', { id: c.id }); }
      };
    });
});
```

Results are displayed in a floating panel. Pressing Enter navigates to the first result. Escape closes.

---

### 3.9 Reports — `js/shared/reports.js` *(planned)*

**Current status:** Not yet built. Report generation is embedded in individual modules (accounting exports, invoice print, etc.).

**Design:** A unified report runner that any module can register reports with.

```javascript
Platform.reports.register('prod-revenue-by-month', {
  label:      'Chiffre d\'affaires par mois',
  module:     'prod-invoices',
  params:     [{ name: 'year', type: 'number', default: new Date().getFullYear() }],
  generate:   function(params) { /* returns { headers: [], rows: [], summary: {} } */ }
});
```

The Reports app renders a picker, a parameter form, and the result as a printable table or CSV export. No charting library — plain HTML tables only (consistent with no-npm constraint). SVG charts may be added later using the existing `getStampSVG` pattern.

---

## 4. Business Applications

Business applications contain domain-specific logic. They consume shared modules and core services but contribute no generic functionality back to the platform. Each business app lives in its own directory under `js/{appname}/`.

---

### 4.1 Production — `js/prod/`

**Current application:** Mythos Prod (the first and currently only Mythos OS application).

**Modules:**

| Module | File | Description |
|--------|------|-------------|
| Invoices & Devis | `js/prod/invoices.js` | Sales invoices, quotes, TVA calculation, print |
| Mission Orders | `js/prod/mission-orders.js` | OM, multi-society, person list, print |
| Productions | `js/prod/productions.js` | Shows, representations, venues, ticketing |
| Clients | `js/prod/clients.js` | Legal entity client CRUD (distinct from shared contacts) |
| Collaborators | `js/prod/collaborators.js` | Collab CRUD, nature-of-service taxonomy |
| Accounting | `js/prod/accounting.js` | Bank, cash, expenses, purchase invoices, suppliers |
| Equipment | `js/prod/equipment.js` | Vehicles, gear assignment to missions |

**Storage keys owned by Production:**
`mp_invoices`, `mp_devis`, `mp_contracts`, `mp_clients`, `mp_oms`, `mp_collabs`, `mp_natures`, `mp_rdvs`, `mp_representations`, `mp_bank_entries`, `mp_cash_entries`, `mp_expenses`, `mp_expense_categories`, `mp_suppliers`, `mp_purchases`, `mp_vehicules`, `mp_validated_inscriptions`

---

### 4.2 CRM — `js/crm/` *(future)*

Full customer relationship management pipeline beyond the contact directory.

**Planned modules:**
- Pipeline (kanban board: prospect → qualified → proposal → negotiation → won/lost)
- Deals: linked to contacts, with amount, probability, close date, owner
- Activities: calls, meetings, emails, tasks linked to deals and contacts
- Reports: conversion rate, pipeline value, win/loss analysis

**Dependency:** consumes `shared/contacts.js` for contact records. Owns `mp_crm_deals`, `mp_crm_activities`.

---

### 4.3 Inventory — `js/inventory/` *(future)*

Stock management for physical goods (aluminium profiles, stage equipment, etc.).

**Planned modules:**
- Products: catalogue with SKU, unit, category, supplier link
- Stock movements: in / out / adjustment with reason
- Low-stock alerts (registers with Platform.notify on stock below threshold)
- Purchase order generation (links to prod/accounting.js for purchase invoices)

---

### 4.4 Transport — `js/transport/` *(future)*

Vehicle fleet and logistics management.

**Planned modules:**
- Vehicle registry (extends prod/equipment.js vehicles)
- Trip log: driver, departure/arrival, km, fuel consumption
- Maintenance schedule: service intervals, next service date (registers with shared/planning.js)
- Driver assignment: linked to HR module employees

---

### 4.5 HR — `js/hr/` *(future)*

Human resources management.

**Planned modules:**
- Employees: personal record, contract type, start date, salary
- Absences: leave requests, approval workflow, remaining days
- Payroll: monthly pay slips (calculation only, no bank transfer)
- Org chart: hierarchy display from employee records

**Dependency:** consumes `shared/calendar.js` for absence display. Consumes `shared/contacts.js` for employee contact data.

---

### 4.6 Accounting — `js/accounting/` *(future)*

Standalone accounting module decoupled from Mythos Prod. The current `js/prod/accounting.js` is Production-specific. A future standalone accounting module serves the full double-entry accounting need.

**Planned modules:**
- Chart of accounts (plan comptable Tunisien)
- Journal entries (debit/credit pairs)
- Trial balance, balance sheet, income statement
- VAT declaration export (DGI format)
- Bank reconciliation (extended from the current bank-entries module)

---

### 4.7 Projects — `js/projects/` *(future)*

Project and task management beyond the simple task list.

**Planned modules:**
- Projects: name, client, start/end dates, budget, status
- Milestones: linked to projects, dates, deliverables
- Gantt view: SVG-rendered timeline (no library)
- Time tracking: hours logged per task per user
- Budget vs actual: pulls invoice data from prod/accounting.js

---

## 5. Plugin Architecture

### 5.1 What is a plugin?

A plugin is a self-contained business application that can be added to Mythos OS without modifying the platform shell. It consists of:
- One or more JS files in `js/{plugin-id}/`
- A **manifest object** that registers the plugin with the platform
- Optional PHP backend files in the root (for server-side data handling)
- Optional CSS file at `css/{plugin-id}.css`

### 5.2 Plugin manifest

Each plugin registers itself by calling `Platform.registerPlugin(manifest)` at the end of its main JS file:

```javascript
// js/crm/crm.js — last lines
Platform.registerPlugin({
  id:          'crm',
  version:     '1.0.0',
  label:       'CRM',
  icon:        '🤝',
  color:       '#7c3aed',
  description: 'Pipeline commercial et gestion des opportunités',

  // Sidebar menu entry
  menu: {
    section:  'apps',        // 'apps' | 'shared' | 'admin'
    order:    20,            // position within section (lower = higher)
    badge:    function() {   // optional: returns count for red badge
      return _storeGet('mp_crm_deals', '[]').filter(function(d) {
        return d.status === 'proposal';
      }).length;
    }
  },

  // Sections this plugin adds to the navigation
  routes: [
    { id: 'crm-pipeline',    label: 'Pipeline',    icon: '📊', render: renderCrmPipeline },
    { id: 'crm-deals',       label: 'Opportunités', icon: '💼', render: renderCrmDeals },
    { id: 'crm-activities',  label: 'Activités',   icon: '📞', render: renderCrmActivities },
    { id: 'crm-reports',     label: 'Rapports',    icon: '📈', render: renderCrmReports }
  ],

  // Settings this plugin registers
  settings: [
    { key: 'crm.defaultPipeline', label: 'Pipeline par défaut', type: 'select',
      options: ['standard', 'express', 'partenariat'], default: 'standard' },
    { key: 'crm.currency',        label: 'Devise devis', type: 'text', default: 'TND' }
  ],

  // Dashboard KPI block (optional)
  dashboard: function() {
    var deals = _storeGet('mp_crm_deals', '[]');
    return [
      { icon: '💼', label: 'Opportunités actives', value: deals.filter(function(d) { return d.status !== 'won' && d.status !== 'lost'; }).length, color: '#7c3aed' }
    ];
  },

  // Calendar event sources (optional)
  calendarSources: ['crm-activities'],

  // Search sources (optional)
  searchSources: ['crm-deals', 'crm-contacts'],

  // Storage keys this plugin owns (for backup/restore awareness)
  storageKeys: ['mp_crm_deals', 'mp_crm_activities', 'mp_crm_pipeline'],

  // Called after the platform shell is ready
  onBoot: function() {
    _crmInitialize();
  }
});
```

### 5.3 Platform registry

The platform shell maintains a registry of all loaded plugins:

```javascript
// js/core/platform.js
var Platform = Platform || {};
Platform._plugins = {};

Platform.registerPlugin = function(manifest) {
  if (!manifest.id || !manifest.routes) {
    console.error('[Platform] Invalid plugin manifest:', manifest.id);
    return;
  }
  Platform._plugins[manifest.id] = manifest;

  // Register routes with router
  manifest.routes.forEach(function(route) {
    Platform.router.register(route.id, route.render);
  });

  // Register menu entry
  if (manifest.menu) {
    Platform.sidebar.addItem(manifest.id, manifest);
  }

  // Register dashboard KPIs
  if (manifest.dashboard) {
    Platform.dashboard.register(manifest.id, manifest.dashboard);
  }

  // Register calendar sources
  (manifest.calendarSources || []).forEach(function(srcId) {
    if (typeof window['_calSource_' + srcId] === 'function') {
      Platform.calendar.registerSource(srcId, window['_calSource_' + srcId]);
    }
  });

  // Register settings
  (manifest.settings || []).forEach(function(s) {
    Platform.settings.register(s.key, s.default, s.label);
  });

  Platform.events.emit('plugin:registered', { pluginId: manifest.id });
  console.log('[Platform] Plugin registered:', manifest.id, manifest.version);
};
```

### 5.4 How to add a new plugin

1. Create `js/{plugin-id}/` directory
2. Write the business logic files
3. Create the manifest and call `Platform.registerPlugin(...)` at the end of the main file
4. Add `<script src="js/{plugin-id}/{plugin-id}.js?v=..."></script>` in `index.html` after all platform scripts
5. If server-side storage is needed, add the plugin's storage keys to `ALLOWED_KEYS` in `api.php`

No other platform files are modified. The shell discovers the plugin at next page load.

### 5.5 Permissions for plugins

Each plugin declares which storage keys it owns in `storageKeys`. The Permissions service uses this declaration to enforce access control:

- An `admin` can access any plugin's data
- A `manager` can read all plugins and write to their assigned plugins
- A `staff` user can only access the plugins listed in their role profile

Plugin permissions are set in `Platform.settings.get('permissions.plugins.{pluginId}')`.

---

## 6. Data Architecture

### 6.1 localStorage — the local cache

localStorage is the **primary read path** for the application. Every data access goes through `_storeGet` which reads from the in-memory `_memCache` or `localStorage`. There is no blocking I/O on any user interaction.

**Key naming convention:**

| Prefix | Owner | Example |
|--------|-------|---------|
| `mp_` | Business data (synced) | `mp_invoices` |
| `_mp_` | Sync internals (not synced) | `_mp_sync_meta`, `_mp_pending_keys` |
| `mp_auth_` | Auth (not synced) | `mp_auth_session` |

Business data keys always start with `mp_`. The sync engine treats any `mp_*` key as syncable (with a short exclusion list for auth and logs). New plugins follow this convention.

**Quota management:** The browser allows ~5–10 MB per origin. The contact directory can grow large after Google imports. `_safeSet` absorbs quota errors — the write falls back to `_memCache` and the data is safe for the current session. On next login, `syncFromServer` restores the full dataset from the server.

### 6.2 Server-side storage — `appdata/*.json`

The server is the **source of truth**. Each collection is stored as a JSON array in `appdata/{key}.json`. Metadata (timestamp, count) is in `appdata/meta.json`.

`api.php` provides:
- GET `?key=__all__` — all collections + metadata
- GET `?key={collection}` — single collection
- POST `{key, value, updatedAt}` — save single collection
- POST `{__bulk__, updatedAt}` — bulk save (logout flush)
- POST `{__chunk__, key, ...}` — chunked upload for large arrays (>400 KB)
- POST `{__auto_backup__}` — create backup snapshot
- POST `{__restore_backup__: file}` — restore from backup

**Security (current):** `api.php` requires no authentication token. Access is implicitly protected by:
- nginx: `appdata/` is not web-accessible directly (serves through PHP only)
- The application itself is password-protected (auth.js)
- The VPS is not publicly indexed

**Security (planned for multi-user):** `api.php` will require a `X-Mythos-Session: {token}` header on every request. Invalid tokens return HTTP 401. Session tokens are issued on login and stored server-side in `appdata/_sessions/{token}.json` with a TTL.

### 6.3 Sync engine (current — `js/app.js` lines 63–507)

The sync engine runs the bidirectional synchronization between localStorage and the server. It is the most critical subsystem of the platform. Stage 1B will migrate its raw `fetch` calls to `_apiPost`/`_apiGet`. Later stages will extract it into `js/core/sync.js`.

**Write path:**
```
User action → _storeSave(key, data)
    → _safeSet(key, data)          (local write, immediate)
    → _metaUpdate(key, now)        (timestamp)
    → _pendingAdd(key)             (queue for server)
    → _pushCollection(key, ...)    (async server push)
        → on success: _pendingRemove(key)
        → on failure: key stays in queue → retried by heartbeat
    → _triggerAutoBackup(key)      (debounced 5-minute backup)
```

**Read path:**
```
Any module → _storeGet(key, default)
    → localStorage.getItem(key)    (synchronous, no network)
    → JSON.parse(raw)
    → return parsed value
```

**Sync on login:**
```
AUTH.handleLogin()
    → syncFromServer(callback)
        → GET api.php?key=__all__
        → for each collection: merge local + server by ID + updatedAt
        → apply tombstones (deleted IDs filtered from merged result)
        → push local-only collections to server
        → callback() → bootstrapStableApp()
```

**Background sync:** `_startBackgroundSync()` sets a 30-second interval that calls `_flushPending()` if the queue is non-empty. Window events trigger immediate syncs: `focus`, `visibilitychange → visible`, `online`.

### 6.4 Offline mode

The application is fully functional offline:
- All reads serve from localStorage
- All writes succeed locally and are queued in `_pendingKeys`
- `_flushPending()` exits silently if `navigator.onLine === false`
- On `online` event, the queue is drained immediately
- On logout/pagehide, `_flushPendingBeacon()` uses `sendBeacon` — the one HTTP call guaranteed to fire even when the page is closing

**Data loss risk:** `sendBeacon` can be blocked by some browsers in low-battery mode or aggressive power management. The queue survives page reloads (persisted in `_mp_pending_keys`) so the data is safe until the next successful sync.

### 6.5 Future database support

The flat JSON file model works at the current data volume (hundreds to low thousands of records per collection). It will need to be replaced when:
- Any collection exceeds ~10 000 records (contact directory after large Google imports)
- Multi-user concurrent writes require conflict resolution at the record level
- Reporting needs cross-collection aggregation beyond what JavaScript can do client-side

**Migration path (when needed):**
1. Replace `api.php` flat-file reads/writes with `PDO` calls to SQLite (zero infrastructure change — SQLite is a file)
2. Add a migration script `migrate.php` that imports `appdata/*.json` into SQLite tables
3. The client-side sync engine is unchanged — it still POSTs JSON, `api.php` now writes to SQLite instead of files
4. Move to PostgreSQL or MySQL only if SQLite cannot handle the load (unlikely below 100 concurrent users)

---

## 7. UI Architecture

### 7.1 Navigation model

Mythos OS uses a **hash-based single-page routing** model. The URL hash (`#section-id`) determines which section is visible. The router is managed by `Platform.router`.

```
https://uthinachess.tn/0726/Prod/#gestion-contacts
                                   ↑
                               section ID
```

**Route registration:**
```javascript
Platform.router.register('gestion-contacts', renderContactsPage);
Platform.router.register('factures',          renderInvoicesPage);
```

**Navigation:**
```javascript
Platform.router.navigate('gestion-contacts');           // change section
Platform.router.navigate('gestion-contacts', { id: 42 }); // with state
Platform.router.onNavigate(function(sectionId, state) { // listen
  // fired before the new section renders
});
```

The router reads `location.hash` on load, registers a `hashchange` listener, and calls the registered render function. If no route matches, it renders the dashboard.

### 7.2 Sidebar

The sidebar is the primary navigation surface. It is rendered by `Platform.sidebar` from the registered plugin manifests.

**Structure:**
```
┌──────────────────────────┐
│  [LOGO] Mythos OS        │  ← platform header
├──────────────────────────┤
│  ▪ Dashboard             │  ← always present
│  ▪ Calendar              │  ← shared apps section
│  ▪ Contacts              │
│  ▪ Tasks           [3]   │  ← badge = overdue count
│  ▪ Planning              │
│  ▪ Files                 │
│  ▪ Notes                 │
├──────────────────────────┤
│  ── PRODUCTION ──        │  ← plugin section header
│  ▪ Tableau de bord       │
│  ▪ Factures              │
│  ▪ Devis                 │
│  ▪ Ordres de Mission     │
│  ▪ Clients               │
│  ▪ Collaborateurs        │
│  ▪ Comptabilité          │
│  ▪ Répertoire            │
├──────────────────────────┤
│  ── CRM ──               │  ← second plugin (future)
│  ▪ Pipeline        [5]   │
│  ▪ Opportunités          │
│  ▪ Activités             │
├──────────────────────────┤
│  ⚙ Paramètres            │  ← admin section (always last)
│  🔍 Recherche            │
│  📊 Rapports             │
│  🚪 Déconnexion          │
└──────────────────────────┘
```

**Responsive behaviour:**
- Desktop (≥1024 px): sidebar always visible, 220 px fixed width
- Tablet (768–1023 px): sidebar collapses to icon-only (40 px), expand on hover
- Mobile (<768 px): sidebar hidden, accessible via hamburger button; overlays content

**Collapse state:** persisted in `Platform.settings.get('sidebarCollapsed')`.

### 7.3 Workspace

The workspace is the content area to the right of the sidebar. It is a single `<div id="main-content">` whose innerHTML is replaced on every navigation.

**Workspace regions:**

```
┌─────────────────────────────────────────────────┐
│  [Page header: title + action buttons]          │  ← 56 px, sticky
├─────────────────────────────────────────────────┤
│                                                 │
│  [Page content — scrollable]                    │
│                                                 │
│  Rendered by the route's render function.       │
│  No shared structure beyond the header bar.     │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Page header API:**
```javascript
Platform.workspace.setHeader({
  title:   'Factures',
  actions: [
    { label: 'Nouvelle facture', icon: '+', onClick: openNewInvoiceModal },
    { label: 'Exporter',        icon: '↓', onClick: exportInvoices }
  ]
});
```

### 7.4 Widgets

Widgets are reusable UI components. They are plain JavaScript functions that return HTML strings or mutate a DOM element. No component framework.

**Current widgets (to be formalized):**
- `_statKpi(icon, label, value, color)` → stat card HTML string (in utils.js)
- `_statMini(label, count, sub)` → mini stat card HTML string (in utils.js)
- `_showSyncIndicator(msg, color)` → bottom-right sync dot (in app.js, to move to notifications.js)

**Planned widget library (`js/shared/widgets.js`):**

| Widget | Function | Description |
|--------|----------|-------------|
| Stat card | `Platform.widgets.statCard(opts)` | KPI display tile |
| Data table | `Platform.widgets.dataTable(opts)` | Sortable, filterable table |
| Search bar | `Platform.widgets.searchBar(opts)` | Input with debounce |
| Modal | `Platform.widgets.modal(opts)` | Overlay dialog |
| Confirm dialog | `Platform.widgets.confirm(msg, cb)` | Yes/No dialog |
| Toast | `Platform.widgets.toast(msg, type)` | Notification pill |
| Date picker | `Platform.widgets.datePicker(opts)` | Calendar date input |
| Badge | `Platform.widgets.badge(count)` | Sidebar count dot |
| Empty state | `Platform.widgets.emptyState(opts)` | No-data placeholder |
| Skeleton | `Platform.widgets.skeleton(lines)` | Loading placeholder |

### 7.5 Responsive behaviour

**Breakpoints:**

| Breakpoint | Width | Sidebar | Layout |
|-----------|-------|---------|--------|
| Mobile | < 768 px | hidden (hamburger) | single column |
| Tablet | 768–1023 px | icon-only (40 px) | single column |
| Desktop | ≥ 1024 px | full (220 px) | sidebar + content |

**Implementation:** CSS media queries only. No JS for responsive layout (avoids flash of wrong layout). The sidebar uses `transform: translateX` for mobile slide-in.

**Print:** All print-targeted pages (`@media print`) hide the sidebar, the header bar, and the sync indicator. Print layouts are tested in Chrome print preview.

---

## 8. Long-Term Roadmap

### 8.1 Multi-user (Priority 1)

**When:** When a second person needs to log in with their own credentials.

**Changes required:**
1. `api.php`: add session-token validation on every request (`X-Mythos-Session` header)
2. `auth.php` (new): validate credentials from `appdata/_users/{id}.json`, issue tokens
3. `js/core/users.js` (new): user management UI, role assignment
4. `js/core/permissions.js` (new): role-based access enforcement in UI
5. Per-user data scoping: decide whether data is shared (recommended) or per-user isolated
6. `mp_activity_log`: add `userId` field, sync to server for admin audit

**Architecture decision — shared vs. isolated data:**  
Recommendation: **shared data, per-user audit trail**. All users see all collections. Each write carries a `createdBy` / `updatedBy` field. Permissions restrict what each role can modify, not what they can read (unless the business requires data siloing).

### 8.2 SaaS multi-tenant (Priority 2)

**When:** The platform is offered to multiple client companies.

**Changes required:**
1. Each tenant gets its own subdirectory: `appdata/{tenantId}/`
2. `api.php`: route all reads/writes through `tenantId` derived from the session token
3. `_API_ENDPOINT` in `js/core/api.js` becomes tenant-specific: `/{tenantId}/api.php`
4. The auth flow issues tokens scoped to a tenant
5. Billing and provisioning (out of scope for Mythos OS — external concern)

**Data isolation:** strict per-tenant. No cross-tenant data queries. Each tenant's `appdata/` directory is owned by a separate OS user on the VPS.

### 8.3 Mobile app (Priority 3)

**When:** Users need to work on smartphones in the field (drivers, collaborators on location).

**Option A — Progressive Web App (PWA):**  
Add a `manifest.json` and a service worker to cache the SPA and its assets. The service worker intercepts `api.php` calls and queues them in IndexedDB when offline. On reconnect, it replays the queue. This requires no native code.  
Estimated effort: 2–3 days. **Recommended first step.**

**Option B — Native wrapper (Capacitor):**  
Wrap the existing SPA in a Capacitor shell for Android (iOS is a lower priority for the Tunisian market). Provides access to native features: camera (already partially implemented), contacts sync, push notifications.  
Estimated effort: 1–2 weeks.

**Option C — Dedicated mobile app:**  
A separate, simplified app (React Native or Flutter) that talks to the same `api.php` backend. High effort, not recommended until the user base justifies it.

### 8.4 AI assistant (Priority 4)

**When:** Users want to generate documents, summarise data, or query their records in natural language.

**Design:** A sidebar panel "Assistant Mythos" powered by the Anthropic API. The assistant has access to a sandboxed view of the user's data (counts, recent items, summaries — not raw PII unless the user explicitly shares).

**Features planned:**
- "Génère une facture pour [client] pour [prestation]" → pre-fills invoice form
- "Résume l'activité de ce mois" → generates a text summary from stats
- "Quels clients n'ont pas payé depuis 3 mois ?" → queries `mp_invoices` and returns a list
- "Rédige un courrier de relance pour [client]" → generates a letter for Notes

**Privacy requirement:** Raw client data (names, amounts, contacts) must not leave the user's browser without explicit consent per request. The assistant may send aggregate stats or anonymised prompts, but PII requires user approval per call.

**Implementation:** A new `js/shared/assistant.js` module that calls a server-side proxy `ai.php`. The proxy adds the Anthropic API key (never exposed to the client) and forwards the sanitised prompt.

### 8.5 Public API (Priority 5)

**When:** Third-party integrations are needed (accounting software, bank feeds, e-invoicing mandates).

**Design:** A REST API layer on top of `api.php` that exposes collections as authenticated endpoints.

```
GET  /v1/invoices              → mp_invoices[]
GET  /v1/invoices/{id}         → single invoice
POST /v1/invoices              → create invoice
PUT  /v1/invoices/{id}         → update invoice
DEL  /v1/invoices/{id}         → soft-delete (tombstone)

GET  /v1/contacts              → mp_repertoire_contacts[]
POST /v1/sync/push             → same as current api.php __bulk__
GET  /v1/sync/pull             → same as current api.php ?key=__all__
```

Authentication: API keys issued per integration, stored in `appdata/_api_keys.json`. Keys carry a scope (read-only, write, admin).

**Tunisian e-invoicing:** When the Direction Générale des Impôts mandates electronic invoicing (expected within 2–4 years), the public API will expose a `/v1/e-invoice/submit` endpoint that converts invoices to the required XML/JSON format and submits to the DGI gateway.

---

## 9. Directory Tree

The following is the target directory structure for the finished Mythos OS platform. This represents the end-state after all migration stages are complete. The current repository is at Stage 1A.

```
mythos-prod/                          ← git root (workspace)
│
├── index.html                        ← SPA shell; all page templates inline
│
├── js/
│   │
│   ├── core/                         ← Platform foundation (loads first)
│   │   ├── storage.js                ✓ Stage 1A — _memCache, _storeGet, _safeSet
│   │   ├── api.js                    ✓ Stage 1A — _apiFetch, _apiGet, _apiPost, _apiRetry
│   │   ├── auth.js                   ← Stage 2 — move js/auth.js here
│   │   ├── logger.js                 ← Stage 2 — move js/logger.js here
│   │   ├── events.js                 ← Stage 2 — new pub/sub bus
│   │   ├── platform.js               ← Stage 2 — Platform global, registerPlugin
│   │   ├── router.js                 ← Stage 3 — navigation extracted from app.js
│   │   ├── sync.js                   ← Stage 3 — sync engine extracted from app.js
│   │   ├── notifications.js          ← Stage 4 — unified toast/badge/sync-dot
│   │   ├── settings.js               ← Stage 4 — Platform.settings
│   │   ├── permissions.js            ← Stage 5 — RBAC (requires multi-user)
│   │   └── users.js                  ← Stage 5 — user management (requires multi-user)
│   │
│   ├── shared/                       ← Shared applications
│   │   ├── dashboard.js              ← Stage 3 — extracted from app.js lines 700–975
│   │   ├── contacts.js               ← Stage 3 — extracted from app.js lines 3071–4413
│   │   ├── calendar.js               ← Stage 3 — extracted from app.js lines 8600–8841
│   │   ├── tasks.js                  ← Stage 3 — renamed from js/taches.js
│   │   ├── planning.js               ← Stage 3 — renamed from js/rappels.js
│   │   ├── notes.js                  ← Stage 3 — renamed from js/redaction.js
│   │   ├── files.js                  ← Stage 4 — new (upload.php integration)
│   │   ├── search.js                 ← Stage 4 — new global search
│   │   ├── reports.js                ← Stage 4 — new report runner
│   │   └── widgets.js                ← Stage 4 — formalized widget library
│   │
│   ├── prod/                         ← Mythos Prod business application
│   │   ├── invoices.js               ← Stage 4 — extracted from app.js lines 4413–4965
│   │   ├── mission-orders.js         ← Stage 4 — extracted from app.js lines 4966–5296
│   │   ├── productions.js            ← Stage 4 — extracted from app.js lines 1016–2340
│   │   ├── clients.js                ← Stage 4 — extracted from app.js lines 5297–5402
│   │   ├── collaborators.js          ← Stage 4 — extracted from app.js lines 5403–5502
│   │   ├── accounting.js             ← Stage 4 — extracted from app.js lines 5741–8382
│   │   ├── equipment.js              ← Stage 4 — extracted from vehicle/OM sections
│   │   └── prod.js                   ← Stage 4 — plugin manifest + bootstrapStableApp
│   │
│   ├── crm/                          ← CRM application (future)
│   │   ├── pipeline.js
│   │   ├── deals.js
│   │   ├── activities.js
│   │   └── crm.js                    ← plugin manifest
│   │
│   ├── hr/                           ← HR application (future)
│   │   ├── employees.js
│   │   ├── absences.js
│   │   ├── payroll.js
│   │   └── hr.js                     ← plugin manifest
│   │
│   ├── inventory/                    ← Inventory application (future)
│   │   ├── products.js
│   │   ├── movements.js
│   │   └── inventory.js              ← plugin manifest
│   │
│   ├── transport/                    ← Transport application (future)
│   │   ├── trips.js
│   │   ├── maintenance.js
│   │   └── transport.js              ← plugin manifest
│   │
│   ├── projects/                     ← Projects application (future)
│   │   ├── projects.js
│   │   ├── milestones.js
│   │   ├── timetracking.js
│   │   └── projects-plugin.js        ← plugin manifest
│   │
│   ├── utils.js                      ✓ Stage 1 — pure helpers (no DOM, no storage)
│   └── app.js                        ← shrinks each stage; ~200 lines after Stage 6
│
├── css/
│   ├── app.css                       ← main stylesheet (unchanged)
│   └── {plugin-id}.css               ← per-plugin overrides (future)
│
├── tests/
│   ├── core-test.js                  ✓ Stage 1A — browser + Node test runner
│   ├── storage-test.js               ← Stage 2
│   ├── sync-test.js                  ← Stage 3
│   ├── contacts-test.js              ← Stage 3
│   ├── prod-invoices-test.js         ← Stage 4
│   └── smoke.js                      ← Stage 6 — full integration smoke test
│
├── docs/
│   ├── mythos-os-blueprint.md        ← THIS FILE — platform definition
│   ├── mythos-os-platform.md         ← migration stages + layer diagram
│   ├── architecture.md               ← current app.js architecture (historical)
│   ├── module-map.md                 ← current module dependency map (historical)
│   ├── refactoring-plan.md           ← original extraction plan (superseded)
│   └── production-safety.md          ← deployment + safety rules
│
├── api.php                           ← server REST API (flat JSON read/write)
├── auth.php                          ← future: multi-user authentication endpoint
├── ai.php                            ← future: Anthropic API proxy
├── upload.php                        ← file upload handler
├── google_auth.php                   ← Google OAuth initiation
├── google_callback.php               ← Google OAuth callback + contact import
├── google_fetch_result.php           ← one-time import result endpoint
├── cleanup.php                       ← manual data cleanup (key-gated)
│
├── assets/
│   └── logos/                        ← company logos for print
│
├── appdata/                          ← GITIGNORED — live client data
│   ├── mp_invoices.json
│   ├── mp_clients.json
│   ├── ... (one file per collection)
│   ├── meta.json
│   ├── backups/
│   └── google_imports/
│
├── documents/                        ← GITIGNORED — uploaded files
│
├── .gitignore
├── google_config.php                 ← GITIGNORED — OAuth credentials
├── ACCES.txt                         ← GITIGNORED — access PIN
├── google_config.php.example         ← committed — credential template
└── README.md
```

### Script loading order (target — after all stages complete)

```html
<!-- In <head> with defer — fire after DOM parsed -->
<script src="js/core/events.js?v=..."></script>        <!-- pub/sub, no DOM deps -->

<!-- In <body> — blocking, in dependency order -->
<script src="js/utils.js?v=..."></script>               <!-- pure helpers -->
<script src="js/core/storage.js?v=..."></script>        <!-- _storeGet, _safeSet -->
<script src="js/core/api.js?v=..."></script>            <!-- _apiFetch, _apiPost -->
<script src="js/core/sync.js?v=..."></script>           <!-- _storeSave, syncFromServer -->
<script src="js/core/logger.js?v=..."></script>         <!-- LOGGER -->
<script src="js/core/platform.js?v=..."></script>       <!-- Platform global -->
<script src="js/core/settings.js?v=..."></script>       <!-- Platform.settings -->
<script src="js/core/notifications.js?v=..."></script>  <!-- Platform.notify -->
<script src="js/core/router.js?v=..."></script>         <!-- Platform.router -->
<script src="js/core/auth.js?v=..."></script>           <!-- AUTH singleton -->

<!-- Shared applications -->
<script src="js/shared/widgets.js?v=..."></script>
<script src="js/shared/dashboard.js?v=..."></script>
<script src="js/shared/contacts.js?v=..."></script>
<script src="js/shared/calendar.js?v=..."></script>
<script src="js/shared/tasks.js?v=..."></script>
<script src="js/shared/planning.js?v=..."></script>
<script src="js/shared/notes.js?v=..."></script>
<script src="js/shared/files.js?v=..."></script>
<script src="js/shared/search.js?v=..."></script>
<script src="js/shared/reports.js?v=..."></script>

<!-- Business applications (plugins) -->
<script src="js/prod/invoices.js?v=..."></script>
<script src="js/prod/mission-orders.js?v=..."></script>
<script src="js/prod/productions.js?v=..."></script>
<script src="js/prod/clients.js?v=..."></script>
<script src="js/prod/collaborators.js?v=..."></script>
<script src="js/prod/accounting.js?v=..."></script>
<script src="js/prod/equipment.js?v=..."></script>
<script src="js/prod/prod.js?v=..."></script>           <!-- manifest + bootstrapStableApp -->

<!-- Future plugins added here, no other file changes -->
<!-- <script src="js/crm/crm.js?v=..."></script> -->

<!-- Transition file — removed in Stage 6 -->
<script src="js/app.js?v=..."></script>                 <!-- ~200 lines after Stage 6 -->
```

---

## Appendix: Stage-by-stage migration summary

| Stage | What changes | app.js size | Status |
|-------|-------------|-------------|--------|
| 0 | Docs only | 9 948 | ✓ Complete |
| 1 (Phase 1) | utils.js extracted | 9 725 | ✓ Complete |
| 1A | core/storage.js + core/api.js foundations | 9 703 | ✓ Complete |
| 1B | core/events.js + core/platform.js | 9 703 | ✓ Complete |
| 2A | js/plugins/production.plugin.js | 9 703 | ✓ Complete |
| 2B | 6 shared plugins (dashboard, calendar, tasks, planning, contacts, notes) | 9 703 | ✓ Complete |
| 2C | js/core/shell.js — Shell foundation (sidebar, workspace, navigation, widgets) | 9 703 | ✓ Complete |
| 2D | js/core/plugin-sdk.js — Plugin SDK (fluent builder, 9 define* methods) | 9 703 | ✓ Complete |
| 3A | js/plugins/tasks.runtime.js — Tasks bootstrap migrated, lifecycle wired | 9 650 | ✓ Complete |
| 3A.5 | js/core/services/ — 5 runtime services + PluginServices bridge | 9 703 | ✓ Complete |
| 3B | js/plugins/contacts.runtime.js — Contacts bootstrap migrated, onBoot storage validation, onReady MythosSearch provider | 9 703 | ✓ Complete |
| 3C | js/plugins/notes.runtime.js — Notes bootstrap migrated, onBoot storage validation for mp_rddocs_das + mp_rddocs_autres, onReady MythosSearch provider | 9 703 | ✓ Complete |
| 3D | js/plugins/planning.runtime.js — Planning bootstrap migrated, onBoot storage validation for mp_rappels + mp_rappel_types, onReady MythosSearch + MythosCalendar providers. No dedicated route (modal-based). | 9 703 | ✓ Complete |
| 1B | Migrate raw fetch calls to _apiPost/_apiGet | ~9 650 | Next |
| 2 | core/ complete (events, platform, auth, logger, sync) | ~9 100 | Planned |
| 3 | Shared apps extracted (contacts, calendar, tasks, planning, notes, dashboard) | ~6 000 | Planned |
| 4 | Business apps extracted (invoices, OMs, accounting, etc.) | ~1 500 | Planned |
| 5 | Multi-user + permissions | ~1 500 | Future |
| 6 | app.js = bootstrap only | ~200 | Future |
| 7 | SaaS, mobile PWA, AI assistant, public API | — | Long-term |
