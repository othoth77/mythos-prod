# Mythos OS — Production Runtime Plugin

**Stage:** 3G  
**Status:** Complete  
**File:** `js/plugins/production.runtime.js`  
**Replaces:** `js/plugins/production.plugin.js`

---

## Purpose

`production.runtime.js` is the **primary business data plugin** for the Mythos OS platform. It owns all core business collections (invoices, clients, RDVs, contracts, OMs, accounting, etc.) and exposes them to the platform through two first-class providers:

- **MythosSearch** — full-text search across 8 Production collections
- **MythosCalendar** — dated event source for RDVs and Représentations

The plugin owns no rendering logic. All CRUD, rendering, sync engine, business logic, and print functions remain in `app.js` unchanged.

---

## What Was Migrated vs What Stays in app.js

| Concern | Migrated to runtime.js | Stays in app.js |
|---------|----------------------|-----------------|
| Plugin registration (id, label, version, type, menu, routes, storageKeys) | Yes | — |
| onBoot: localStorage validation for all 20 owned keys | Yes | — |
| onReady: MythosSearch + MythosCalendar provider registration | Yes | — |
| window.load fallback guard | Yes | — |
| `_productionSearchHandler` (late-bound search across 8 collections) | Yes | — |
| `_productionCalendarProvider` (late-bound events from mp_rdvs + mp_representations) | Yes | — |
| All CRUD functions (saveInvoice, saveClient, rdvSave, omSave, …) | — | Yes |
| All rendering (renderInvoiceList, renderClientsList, rdvList, …) | — | Yes |
| Business logic (getInvoiceTotal, normalizeRdv, getRdvAmount, …) | — | Yes |
| `updateDashboardStats()` / `updateDashboardOperational()` | — | Yes |
| `loadDashboardInscriptionsCount()` | — | Yes |
| Sync engine (syncFromServer, _buildPendingBulk, sendBeacon, …) | — | Yes |
| `STORE` object and all its accessors | — | Yes |
| Print / export functions | — | Yes |

---

## Loading Order

```
js/core/plugin-sdk.js
js/plugins/production.runtime.js    ← first plugin (data owner)
js/plugins/dashboard.runtime.js
js/plugins/calendar.runtime.js
js/plugins/tasks.runtime.js
js/plugins/planning.runtime.js
js/plugins/contacts.runtime.js
js/plugins/notes.runtime.js
js/logger.js
js/auth.js
js/app.js                           ← STORE, updateDashboardStats, all CRUD
js/taches.js
```

`production.runtime.js` is loaded **before** `app.js` so that the plugin is registered in Platform before `app.js` calls `Platform.ready()`. `STORE` (accessed at call time) is available when search/calendar providers are invoked after boot.

---

## Manifest Fields

| Field | Value |
|-------|-------|
| `id` | `'production'` |
| `label` | `'Production'` |
| `version` | `'1.0.0'` |
| `type` | `'business'` |
| `menu.section` | `'Production'` |
| `menu.order` | `10` |
| `menu.icon` | `'production'` |
| Routes | 30 (dashboard → parametres; see below) |
| Storage keys | 20 (mp_invoices … mp_appels; see onBoot table) |
| `search.handler` | `_productionSearchHandler` |
| `calendar.provider` | `_productionCalendarProvider` |

### Routes (30 total)

| Route ID | Label |
|----------|-------|
| `dashboard` | Tableau de bord |
| `list` | Factures |
| `new` | Nouvelle facture |
| `devis` | Devis |
| `devis-form` | Nouveau devis |
| `contracts` | Contrats |
| `contract-form` | Nouveau contrat |
| `rendez-vous` | Rendez-vous |
| `representations` | Représentations |
| `om-list` | Ordres de mission |
| `om-new` | Nouvel OM |
| `clients` | Clients |
| `collaborateurs` | Collaborateurs |
| `natures` | Natures de prestation |
| `fournisseurs` | Fournisseurs |
| `comptabilite` | Comptabilité |
| `compta-bank` | Extrait bancaire |
| `compta-cash` | Caisse |
| `compta-expenses` | Dépenses |
| `compta-purchases` | Factures achats |
| `compta-suppliers` | Fournisseurs compta |
| `compta-categories` | Catégories dépenses |
| `compta-reconciliation` | Réconciliation |
| `statistique` | Statistiques |
| `calculateur-spectacle` | Calculateur spectacle |
| `inscriptions` | Inscriptions |
| `appel` | Suivi des appels |
| `conformite` | Liste conforme |
| `sauvegarde` | Sauvegarde |
| `parametres` | Paramètres |

---

## onBoot — Storage Validation

Runs once during `Platform.boot()`. Validates all 20 owned localStorage keys.

**Rule:** if the stored value is malformed JSON or a non-array → reset to `'[]'`. If the key was never set (`null`) → leave untouched (STORE handles the default). Valid arrays (including `[]`) are never overwritten.

| Storage key | Collection |
|-------------|-----------|
| `mp_invoices` | Factures |
| `mp_devis` | Devis |
| `mp_contracts` | Contrats |
| `mp_rdvs` | Rendez-vous (principal) |
| `mp_rendez_vous` | Rendez-vous (legacy alias) |
| `mp_representations` | Représentations |
| `mp_oms` | Ordres de mission |
| `mp_clients` | Clients |
| `mp_collabs` | Collaborateurs |
| `mp_natures` | Natures de prestation |
| `mp_bank_entries` | Relevés bancaires |
| `mp_cash_entries` | Caisse |
| `mp_expenses` | Dépenses |
| `mp_expense_categories` | Catégories de dépenses |
| `mp_suppliers` | Fournisseurs |
| `mp_purchases` | Factures achats |
| `mp_vehicules` | Véhicules |
| `mp_documents` | Documents archivés |
| `mp_validated_inscriptions` | Inscriptions validées |
| `mp_appels` | Suivi des appels |

---

## onReady — Provider Registration

Runs once during `Platform.ready()` via `_productionInit()`. Guarded by `_PRODUCTION_RT_STATE.initialized` — safe to call multiple times.

1. Registers `_productionSearchHandler` with `MythosSearch` as provider `'production'` (order 10).
2. Registers `_productionCalendarProvider` with `MythosCalendar` as provider `'production'` (order 10).

Both registrations are guarded by `hasProvider()` to prevent duplicate registration.

---

## Search Provider

**Provider id:** `'production'`  
**Order:** `10`  
**Handler:** `_productionSearchHandler(query)`

Late-bound: `STORE` is accessed at call time, not at registration time. Returns `[]` for empty query.

### Searched Collections

| Collection | Storage key | Fields searched | Result route |
|-----------|-------------|-----------------|-------------|
| Invoices | `mp_invoices` | `clientName`, `num` | `'list'` |
| Clients | `mp_clients` | `name`, `contact`, `tel`, `email` | `'clients'` |
| Devis | `mp_devis` | `clientName`, `num` | `'devis'` |
| Contracts | `mp_contracts` | `clientName`, `ref` | `'contracts'` |
| RDVs | `mp_rdvs` | `nature`, `client`, `lieu`, `notes` | `'rendez-vous'` |
| OMs | `mp_oms` | `destination`, `chauffeur`, `num` | `'om-list'` |
| Representations | `mp_representations` | `spectacle`, `clientName` | `'representations'` |
| Collabs | `mp_collabs` | `nom`, `role` | `'collaborateurs'` |

### Result Normalization

```javascript
{
  id:       'prod-' + entry.id,   // prefix 'prod-'
  title:    string,               // main human label
  subtitle: string,               // secondary info (ref, date, role…)
  type:     'production',
  route:    string,               // see table above
  data:     entry                 // original object
}
```

Malformed entries (null, non-object, missing id) are skipped silently.  
Search is case-insensitive.

---

## Calendar Provider

**Provider id:** `'production'`  
**Order:** `10`  
**Provider:** `_productionCalendarProvider(range)`

Returns a `Promise<NormalizedEvent[]>`. Late-bound: `STORE` is accessed at call time.

### Event Sources

| Source | Storage key | Date field | Event route |
|--------|-------------|------------|------------|
| RDVs | `mp_rdvs` | `rdv.date` | `'rendez-vous'` |
| Représentations | `mp_representations` | `rep.date` | `'representations'` |

### Event Schema

```javascript
{
  id:     'prod-rdv-' + rdv.id,           // or 'prod-rep-' + rep.id
  title:  rdv.nature + ' — ' + rdv.client, // human label
  start:  'YYYY-MM-DD',                    // from date field
  end:    null,
  allDay: true,
  route:  'rendez-vous',                   // or 'representations'
  data:   entry
}
```

### Range Handling

- Entries whose `date` does not match `YYYY-MM-DD` are skipped.
- Range filtering: `start <= event.date <= end` (ISO string comparison).
- Events are sorted chronologically by `start` (ascending).
- Entries with missing `date`, non-string `date`, or invalid format are skipped gracefully.

---

## Dashboard Integration

Dashboard statistics **stay in `app.js`** and are triggered by `showView('dashboard')`:

```javascript
// app.js — showView()
if (view === 'dashboard') {
  updateDashboardStats();
  loadDashboardInscriptionsCount();
}
```

`updateDashboardStats()` reads from `STORE` directly:
- `STORE.invoices()` — KPI totals, recent invoices widget
- `STORE.clients()` — client count KPI
- `STORE.oms()` — OM count KPI
- `STORE.contracts()` — contract count KPI
- `STORE.bankEntries()` — last bank balance
- `STORE.rdvs().map(normalizeRdv)` — upcoming RDVs widget

The Production runtime plugin does not intercept or modify `updateDashboardStats()`. All dashboard wiring is unchanged.

---

## Idempotency

`_productionInit()` is guarded by `_PRODUCTION_RT_STATE.initialized`. Calling it twice (e.g., from both `Platform.ready()` and the `window.load` fallback) is safe and will not register duplicate providers.

---

## PluginServices Auto-Wiring

`js/core/services/plugin-services.js` listens for `mythos:plugin:registered` events and automatically calls `MythosSearch.registerProvider()` and `MythosCalendar.registerProvider()` using `manifest.search.handler` and `manifest.calendar.provider` respectively. The `hasProvider()` guard in `_productionInit()` prevents any duplication if both paths run.

---

## Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| `production.runtime.js` absent | Platform boots normally; production plugin not registered |
| `MythosSearch` absent | `_productionInit()` skips search registration silently |
| `MythosCalendar` absent | `_productionInit()` skips calendar registration silently |
| `Shell` absent | No crash; navigation functions remain on `window.showView` |
| `Platform` absent | File loads silently (Plugin.create() is a no-op without Platform) |
| `STORE` absent at search/calendar call time | Returns `[]` / `Promise.resolve([])` |
| onBoot with malformed JSON | Resets to `'[]'` per key; never crashes |
| Valid data in storage | Never overwritten by onBoot |

---

## Dependencies

| Dependency | Status | Notes |
|-----------|--------|-------|
| `js/core/plugin-sdk.js` | Required | Provides `Plugin.create()` |
| `js/app.js` — `STORE` | Accessed at call time | Not required at file load |
| `js/core/services/search.js` — `MythosSearch` | Optional | Guarded with `typeof` |
| `js/core/services/calendar.js` — `MythosCalendar` | Optional | Guarded with `typeof` |
| `js/core/shell.js` — `Shell` | Optional | Navigation fallback to `window.showView` |
