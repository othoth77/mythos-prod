# Dashboard Runtime Plugin

**Stage:** 3F  
**File:** `js/plugins/dashboard.runtime.js`  
**Replaces:** `js/plugins/dashboard.plugin.js`  
**Status:** Complete

---

## Purpose

`dashboard.runtime.js` registers the Dashboard shared application via the Plugin SDK. Dashboard is a **pure aggregation consumer**: it reads KPIs and operational data from other plugins' storage but owns no data of its own.

This migration moves only the plugin bootstrap (registration + lifecycle wiring). All rendering logic stays in `app.js` and is triggered by `showView('dashboard')` exactly as before.

---

## What migrated vs what stays in app.js

| Concern | Migrated to `dashboard.runtime.js` | Stays in `app.js` |
|---------|-----------------------------------|--------------------|
| Plugin registration | `Plugin.create().defineMenu()...build()` | — |
| Lifecycle guard | `_DASHBOARD_RT_STATE`, `_dashboardInit()` | — |
| onBoot / onReady hooks | yes | — |
| window.load fallback | yes | — |
| KPI aggregation | — | `updateDashboardStats()` |
| Operational section | — | `updateDashboardOperational()` |
| Inscriptions fetch | — | `loadDashboardInscriptionsCount()` |
| renderTachesDashboard | — | called from `taches.js` / `tasks.runtime.js` |
| `showView('dashboard')` trigger | — | `if (view === 'dashboard') { updateDashboardStats(); ... }` |

---

## Loading order

```
js/core/plugin-sdk.js
js/plugins/production.plugin.js
js/plugins/dashboard.runtime.js    ← Stage 3F (this file)
js/plugins/calendar.runtime.js
js/plugins/tasks.runtime.js
js/plugins/planning.runtime.js
js/plugins/contacts.runtime.js
js/plugins/notes.runtime.js
js/logger.js
js/auth.js
js/app.js
js/taches.js
```

---

## Plugin manifest fields

| Field | Value |
|-------|-------|
| `id` | `'dashboard'` |
| `label` | `'Dashboard'` |
| `version` | `'1.0.0'` |
| `type` | `'shared'` |
| `menu.section` | `'Général'` |
| `menu.order` | `1` |
| `menu.icon` | `'dashboard'` |
| `routes[0].id` | `'dashboard'` |
| `routes[0].label` | `'Tableau de bord'` |
| `routes[0].icon` | `'🏠'` |
| `storageKeys` | `[]` (empty — Dashboard owns no storage) |
| `search` | not declared — Dashboard is a consumer |
| `calendar` | not declared — Dashboard is a consumer |

---

## onBoot storage validation

Dashboard owns no storage keys. `onBoot` is a **no-op**.

Storage ownership of data that Dashboard reads:

| Storage key | Owner plugin | Role in Dashboard |
|-------------|-------------|-------------------|
| `mp_invoices` | production | KPI: factures count, totals |
| `mp_clients` | production | KPI: clients count |
| `mp_oms` | production | KPI: missions count |
| `mp_contracts` | production | KPI: contrats count |
| `mp_rdvs` | production | upcoming RDVs panel |
| `mp_bank_entries` | production | bank balance KPI |
| `mp_cash_entries` | production | cash section |
| `mp_expenses` | production | expenses section |
| `mp_representations` | production | productions section |
| `mp_documents` | production | documents section |
| `mp_validated_inscriptions` | production | inscriptions count |
| `mp_taches` | tasks | tasks zone via `renderTachesDashboard()` |

Each of those plugins validates their own storage in their own `onBoot`. Dashboard does not touch any key that is not its own.

---

## onReady behavior

`onReady` calls `_dashboardInit()` exactly once (idempotent guard):

1. Checks `_DASHBOARD_RT_STATE.initialized` — returns immediately if already set.
2. Sets `_DASHBOARD_RT_STATE.initialized = true`.
3. Does **not** call `renderDashboard()` or `updateDashboardStats()` — those are triggered by `showView('dashboard')` in `app.js`.
4. Does **not** register any MythosWidgets at this stage. A future stage may wrap dashboard zones in `MythosWidgets.register()` calls here.

---

## Widget registration pattern

No widgets are registered with MythosWidgets at Stage 3F. The dashboard DOM zones are written to directly by:

- `updateDashboardStats()` — writes to `#dashboard-invoices`, `#dashboard-amount`, etc.
- `updateDashboardOperational()` — writes to `#db-today-content`, `#db-month-content`, etc.
- `renderTachesDashboard()` — injects into `#dash-taches-zone` (managed by `tasks.runtime.js`)
- `loadDashboardInscriptionsCount()` — writes to `#dashboard-inscriptions-count`

Future stage: wrap each zone in a `MythosWidgets.register({ id: 'dashboard-kpis', zone: 'dashboard', render: fn })` call inside `_dashboardInit()`.

---

## Aggregation flow

```
tasks.runtime.js    → owns mp_taches, provides renderTachesDashboard()
planning.runtime.js → owns mp_rappels / mp_rappel_types
production.plugin.js → owns mp_invoices / mp_rdvs / mp_clients / ... (via STORE)
                         |
                         ▼
dashboard.runtime.js → registers plugin; onReady sets initialized flag
                         |
                         ▼ (triggered by showView('dashboard') in app.js)
updateDashboardStats()         → reads STORE.invoices/clients/oms/...
updateDashboardOperational()   → reads STORE.rdvs/oms/representations/...
loadDashboardInscriptionsCount() → fetch() to INSCRIPTIONS_SCRIPT_URL
renderTachesDashboard()        → reads getTaches() (mp_taches)
```

Dashboard **never writes** to any storage key. It is a read-only consumer.

---

## Initialization guard / idempotency

```javascript
var _DASHBOARD_RT_STATE = { initialized: false };

function _dashboardInit() {
  if (_DASHBOARD_RT_STATE.initialized) return;  // guard
  _DASHBOARD_RT_STATE.initialized = true;
  // ... init logic (currently no-op)
}
```

`_dashboardInit()` can be called any number of times. Only the first call takes effect. This prevents double-initialization when both `onReady` and the `window.load` fallback fire.

---

## Backward compatibility

| Scenario | Behavior |
|----------|----------|
| `dashboard.plugin.js` removed from index.html | Replaced by `dashboard.runtime.js` — identical manifest |
| `Platform.boot()` / `Platform.ready()` not called | `window.load` fallback calls `_dashboardInit()` |
| `MythosWidgets` absent | `_dashboardInit()` is a no-op — no crash |
| `MythosSearch` absent | Not used by Dashboard — no crash |
| `Shell` absent | Not used by Dashboard — no crash |
| `Platform` absent | Plugin SDK skips `registerPlugin()` silently |
| `updateDashboardStats` undefined | Not called by `_dashboardInit()` — no crash |
| `getTaches` undefined | Not called by `_dashboardInit()` — no crash |
| `STORE` absent | Not read by `_dashboardInit()` — no crash |
| Other plugins disabled | Dashboard does not depend on any specific plugin being loaded |

---

## Dependencies

| Dependency | Required at | Notes |
|------------|------------|-------|
| `Plugin` (plugin-sdk.js) | load time | Must be present before this file |
| `Platform` | load time | registerPlugin() called at build() |
| `Shell` | optional | Shell.widgets mirror available if Shell loaded |
| `MythosWidgets` | optional | Not used at this stage |
| `MythosSearch` | optional | Not used (Dashboard is search consumer) |
| `updateDashboardStats()` | at showView() time | Defined in app.js, loaded after |
| `STORE` | at showView() time | Read by updateDashboardStats() in app.js |
| `getTaches()` | at showView() time | Defined in taches.js for renderTachesDashboard |

---

## Future integration note

When `app.js` business logic is further extracted:

1. `updateDashboardStats()` may be wrapped in a `MythosWidgets.register({ id: 'dashboard-kpis', zone: 'dashboard', render: fn })` call inside `_dashboardInit()`.
2. `renderTachesDashboard()` may be moved from `tasks.runtime.js` into a widget registered here under `id: 'dashboard-tasks'`.
3. MythosSearch consumers will query for results from other providers without Dashboard declaring its own search source.
