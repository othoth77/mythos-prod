# Contacts Runtime Plugin

**File:** `js/plugins/contacts.runtime.js`  
**Stage:** 3B  
**Status:** Complete

---

## Purpose

`contacts.runtime.js` replaces `contacts.plugin.js` as the Contacts module entry point. It migrates the plugin bootstrap into the Platform lifecycle while leaving all contact business logic in `app.js`.

---

## What was migrated here (from contacts.plugin.js)

| Item | Now in |
|------|--------|
| `Platform.registerPlugin(...)` call | `contacts.runtime.js` (via Plugin SDK) |
| `onBoot` storage validation | `contacts.runtime.js` |
| `onReady` MythosSearch registration | `contacts.runtime.js` |
| Search handler function | `contacts.runtime.js` |
| window.load fallback guard | `contacts.runtime.js` |

## What stays in app.js

- All contact CRUD: `addRepertoireContactRow`, `updateRepertoireContactField`, `deleteRepertoireContact`, `deleteRepertoireImport`, `updateRepertoireImportLabel`
- All rendering: `renderRepertoireContactsPage`, `renderContactsDirectory`, `renderContactFiche`, `renderRepertoireImportsHistory`, `_rcRenderDuplicatesBanner`
- Import/export: `importPhoneContacts`, `startGoogleContactsImport`, `triggerContactsFileImport`, `handleContactsFileImport`, `exportContactsDirectoryCSV`
- Synchronization: `_markDeleted`, sync engine integration
- Business logic: `_rcMergeGroupInList`, `_rcDuplicateGroups`, `logContactHistory`, `setLastCallOutcome`, `_rcAfterContactsMutation`, `_rcContactStatus`
- State variables: `_rcFilterBatchId`, `_rcActiveTab`, `_rcDebouncedRenderRepertoire`, `_rcDebouncedRenderAnnuaire`
- STORE integration: `STORE.repertoireContacts`, `STORE.saveRepertoireContacts`, `STORE.repertoireImports`, `STORE.saveRepertoireImports`
- Navigation handler: `showView('gestion-contacts')` call in the hash-routing switch

---

## Loading order

```
js/core/plugin-sdk.js          ← Plugin builder
js/plugins/tasks.runtime.js    ← Tasks (sibling runtime plugin)
js/plugins/planning.plugin.js
js/plugins/contacts.runtime.js ← THIS FILE
js/plugins/notes.plugin.js
js/logger.js
js/auth.js
js/app.js                      ← All contact logic lives here
js/taches.js
```

**contacts.runtime.js must load after plugin-sdk.js and before app.js.**

---

## Plugin manifest fields

| Field | Value |
|-------|-------|
| `id` | `contacts` |
| `label` | `Contacts` |
| `version` | `1.0.0` |
| `type` | `shared` |
| `menu.section` | `Général` |
| `menu.order` | `5` |
| `routes[0].id` | `gestion-contacts` |
| `routes[0].label` | `Répertoire` |
| `routes[0].icon` | `👥` |
| `routes[1].id` | `contact-fiche` |
| `routes[1].label` | `Fiche contact` |
| `routes[1].icon` | `👤` |
| `storageKeys` | `mp_repertoire_contacts`, `mp_repertoire_imports` |

---

## onBoot behavior (storage validation)

Called by `Platform.boot()`. Validates both storage keys before any application code runs.

| Stored value | Action |
|-------------|--------|
| Key not present (null) | No action — STORE handles the default |
| Valid JSON array (empty `[]`) | No action — preserved as-is |
| Valid JSON array (non-empty) | No action — valid data never overwritten |
| Valid JSON non-array (object, string, number, null) | Reset to `'[]'` |
| Invalid / malformed JSON | Reset to `'[]'` |

Errors from `localStorage.getItem`/`setItem` (e.g., private browsing quota exceeded) are silently swallowed.

---

## onReady behavior

Called by `Platform.ready()`. Delegates to `_contactsInit()` which is guarded by `_CONTACTS_RT_STATE.initialized`.

1. Sets `_CONTACTS_RT_STATE.initialized = true`
2. If `MythosSearch` is available and no `contacts` provider is registered yet, registers one via `MythosSearch.registerProvider({ id:'contacts', ... })`

Safe to call multiple times — the idempotency guard prevents duplicate registrations.

---

## Search handler

**Function:** `_contactsSearchHandler(query)`

**Fields searched** (in order, case-insensitive substring match):
`nom`, `prenom`, `tel1`, `tel2`, `email`, `metier`, `domaine`, `note`, `tags[]`

**Late binding note:** `STORE` is accessed at call time, not at registration time. This means the search handler always reads the current in-memory contacts regardless of when it was registered. No circular dependency risk.

**Normalized result schema:**

```javascript
{
  id:       'contact-' + c.id,   // string, always prefixed
  title:    '[prenom] [nom]',    // falls back to tel1, then 'Contact'
  subtitle: c.metier || c.email || c.tel1 || '',
  type:     'contact',
  route:    'gestion-contacts',
  data:     c                    // original contact object
}
```

**Edge cases:**
- Empty or whitespace-only query → returns `[]` immediately
- Malformed entries in the contacts array (null, non-object) → silently skipped
- If `STORE` is not defined → returns `[]`
- If `STORE.repertoireContacts` is not a function → returns `[]`

---

## Initialization guard

`_CONTACTS_RT_STATE = { initialized: false }` is module-level. `_contactsInit()` checks and sets it before doing any work. This makes the following sequence safe without duplicates:

1. `contacts.runtime.js` loads → Plugin registered, `initialized = false`
2. `Platform.boot()` → `onBoot` runs (storage validation)
3. `Platform.ready()` → `onReady` → `_contactsInit()` → `initialized = true`, MythosSearch provider registered
4. `window.load` fires → `_contactsInit()` checks `initialized === true`, returns immediately

---

## PluginServices auto-wiring

`PluginServices` (loaded via `js/core/services/plugin-services.js`) intercepts every `Plugin.build()` call. When `manifest.search.handler` is defined, it forwards the handler to `MythosSearch.registerProvider()` automatically.

This means the search provider is registered **twice** if both `PluginServices` (at build time) and `_contactsInit()` (at ready time) are active. The `MythosSearch.hasProvider('contacts')` check in `_contactsInit()` prevents the duplicate:

```javascript
if (typeof MythosSearch !== 'undefined' && !MythosSearch.hasProvider('contacts')) {
  MythosSearch.registerProvider(...);
}
```

---

## Backward compatibility

| Scenario | Behavior |
|---------|----------|
| `MythosSearch` not loaded | `_contactsInit()` skips registration silently |
| `Shell` not loaded | Plugin registration succeeds (Shell is optional in plugin-sdk) |
| `Platform` not loaded | File loads without error if a minimal `Plugin` stub exists |
| `STORE` not defined at search time | `_contactsSearchHandler` returns `[]` |
| `Platform.boot()`/`ready()` not called | `window.load` fallback fires `_contactsInit()` |
| `contacts.runtime.js` absent | `Platform.boot()`/`ready()` work normally; contacts plugin simply not registered |
| Tasks plugin loaded without contacts | Tasks is unaffected; independent registration |

---

## Dependencies

| Dependency | Required | When accessed |
|-----------|----------|--------------|
| `Plugin` (`js/core/plugin-sdk.js`) | Yes | At file load time (plugin registration) |
| `Platform` (`js/core/platform.js`) | Yes | At `Plugin.build()` time |
| `Shell` (`js/core/shell.js`) | Optional | At `Plugin.build()` time |
| `MythosSearch` (`js/core/services/search.js`) | Optional | At `_contactsInit()` time |
| `STORE` (`js/app.js`) | Optional | At search call time (late binding) |
| `localStorage` | Optional | At `onBoot` time |
