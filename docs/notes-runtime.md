# Mythos OS — Notes Runtime Plugin

**File:** `js/plugins/notes.runtime.js`  
**Stage:** 3C  
**Status:** Complete  
**Replaces:** `js/plugins/notes.plugin.js`

---

## Purpose

`notes.runtime.js` migrates the bootstrap lifecycle of the Notes / Rédaction plugin from a bare `Platform.registerPlugin()` call into the Plugin SDK builder pattern, adding:

- **onBoot** storage validation for both static notes storage keys
- **onReady** MythosSearch provider registration
- **window.load fallback** guard to initialize even if Platform lifecycle is skipped

All document editing logic (CRUD, rendering, template/entry management, print, legacy migration) remains in `js/redaction.js` and `js/app.js`. This file only owns bootstrap and search.

---

## What was migrated vs what stays

| Concern | Location |
|---------|----------|
| Plugin registration (id, label, version, type) | notes.runtime.js (was notes.plugin.js) |
| onBoot: storage validation | **notes.runtime.js** (new) |
| onReady: MythosSearch provider | **notes.runtime.js** (new) |
| window.load fallback | **notes.runtime.js** (new) |
| Document list CRUD (`_rdGetDocs`, `_rdSaveDocs`) | redaction.js (unchanged) |
| Rendering (`_rdRender`, `renderRedactionPage`, `renderRedactionDocList`) | redaction.js (unchanged) |
| Template/entry management (`_rdGetTemplate`, `_rdSaveTemplate`, `_rdGetEntries`, `_rdSaveEntries`) | redaction.js (unchanged) |
| Editor open/close (`openRedactionDoc`, `closeRedactionDoc`) | redaction.js (unchanged) |
| Document create/delete (`newRedactionDoc`, `deleteRedactionDoc`) | redaction.js (unchanged) |
| Print/export logic | redaction.js (unchanged) |
| Legacy migration (`mp_rdtpl_{cat}`, `mp_rdent_{cat}` → `mp_rddocs_{cat}`) | redaction.js (unchanged) |
| In-memory cache (`_rdDB`, `_rdCurrentDoc`) | redaction.js (unchanged) |
| Storage helpers (`_rdRead`, `_rdWrite`, `_rdInvalidateCache`) | redaction.js (unchanged) |
| View triggers (`showView('redaction-das')` → `_rdRender('das')`) | app.js (unchanged) |

---

## Loading order

```
js/core/services/search.js          ← MythosSearch (optional)
js/core/plugin-sdk.js               ← Plugin SDK (required)
js/plugins/contacts.runtime.js      ← loaded before notes
js/plugins/notes.runtime.js         ← THIS FILE
js/logger.js                        ← loaded after
js/app.js                           ← loaded after (contains showView triggers)
js/redaction.js (defer)             ← loaded after DOM ready (CRUD + rendering)
```

---

## Plugin manifest fields

| Field | Value |
|-------|-------|
| `id` | `'notes'` |
| `label` | `'Rédaction'` |
| `version` | `'1.0.0'` |
| `type` | `'shared'` |
| `menu.section` | `'Général'` |
| `menu.order` | `6` |
| `menu.icon` | `'notes'` |

---

## Routes

| ID | Label | Icon |
|----|-------|------|
| `redaction-das` | Rédaction DAS | 📝 |
| `redaction-autres` | Rédaction Autres | 📝 |

---

## onBoot behavior

Called by `Platform.boot()` before `onReady`. Validates static storage keys only. Dynamic per-document keys (`mp_rdtpl_*`, `mp_rdent_*`) are owned by `redaction.js` and are not touched here.

| Storage key | Rule |
|-------------|------|
| `mp_rddocs_das` | If set and malformed JSON → reset to `'[]'`. If set and not an array → reset to `'[]'`. If set and valid array → preserved unchanged. If null (never set) → left null (redaction.js creates it on first access). |
| `mp_rddocs_autres` | Same rules as above. |

**Safety invariant:** A non-empty valid array is never overwritten. Data loss is impossible through this path.

---

## onReady behavior

Called by `Platform.ready()` after all plugins have booted. Delegates to `_notesInit()`.

1. Checks `_NOTES_RT_STATE.initialized` — exits if already run.
2. Sets `_NOTES_RT_STATE.initialized = true`.
3. If `MythosSearch` is defined and does not yet have a `'notes'` provider: registers `_notesSearchHandler`.

---

## Search handler

**Function:** `_notesSearchHandler(query)`

**Late binding:** `localStorage` is accessed at call time, not at registration time. `redaction.js` may not be loaded yet when `notes.runtime.js` executes.

**Fields searched:**

| Field | Source | Notes |
|-------|--------|-------|
| `name` | `mp_rddocs_das[]`, `mp_rddocs_autres[]` | Only statically available field on the document list object |

Template fields (`mp_rdtpl_*`) and entry values (`mp_rdent_*`) are per-document dynamic keys that would require one `localStorage.getItem` per document. They are intentionally excluded to keep search O(n_docs) rather than O(n_docs × n_fields).

**Categories searched:** `das` (key `mp_rddocs_das`) and `autres` (key `mp_rddocs_autres`).

**Normalized result schema:**

```javascript
{
  id:       'note-' + doc.id,    // prefixed unique identifier
  title:    doc.name || 'Document',
  subtitle: 'DAS' | 'Autres',   // category label
  type:     'note',
  route:    'redaction-das' | 'redaction-autres',
  data:     doc                  // original document object from localStorage
}
```

**Error isolation:** Malformed array entries (null, undefined, non-objects) are skipped via try/catch per entry. A broken category silently continues to the next.

---

## Initialization guard / idempotency

`_NOTES_RT_STATE = { initialized: false }` is the single source of truth.

- `_notesInit()` is a no-op if `initialized === true`.
- Safe to call from both `onReady` and `window.load` fallback.
- Safe to call multiple times from tests.
- `Platform.ready()` itself guards against double-calls.

---

## PluginServices auto-wiring

When `plugin-services.js` is loaded and listens for `mythos:plugin:registered`:

1. `Plugin.build()` calls `Platform.registerPlugin(manifest)`.
2. `Platform` emits `mythos:plugin:registered`.
3. `PluginServices` reads `manifest.search.handler` and calls `MythosSearch.registerProvider()`.
4. `MythosSearch.hasProvider('notes')` guard in `_notesInit()` prevents duplicate registration.

Result: `MythosSearch` has exactly one `'notes'` provider regardless of whether wiring happens via `PluginServices` (at `build()` time) or directly in `_notesInit()` (at `onReady` time).

---

## Backward compatibility

| Scenario | Behavior |
|----------|----------|
| `MythosSearch` not loaded | `typeof MythosSearch !== 'undefined'` guard prevents crash; plugin still registers and initializes |
| `Shell` not loaded | Plugin SDK's `.build()` guards `Shell.widgets.register()` — no crash |
| `Platform` not loaded | Plugin stub required; `notes.runtime.js` itself does not crash (guarded with `typeof Platform`) |
| `redaction.js` not loaded | onBoot and onReady work normally; search returns [] for missing keys |
| `localStorage` unavailable | Outer try/catch in onBoot absorbs the error |
| Malformed JSON in storage | Inner try/catch resets the key to `'[]'` |
| `Platform.ready()` never called | `window.load` fallback fires `_notesInit()` instead |
| `contacts.runtime.js` also loaded | Independent — no shared state |
| `tasks.runtime.js` also loaded | Independent — no shared state |

---

## Dependencies

| Dependency | Required | Used for |
|------------|----------|----------|
| `js/core/plugin-sdk.js` | Required | `Plugin.create()` / `.build()` |
| `js/core/platform.js` | Optional | `Platform.registerPlugin()`, `Platform.boot()`, `Platform.ready()` |
| `js/core/shell.js` | Optional | Shell widget registration (via SDK) |
| `js/core/services/search.js` | Optional | `MythosSearch.registerProvider()` |
| `js/core/services/plugin-services.js` | Optional | Auto-wires manifest.search.handler |
| `localStorage` | Runtime | Read in `_notesSearchHandler` at call time |
| `js/redaction.js` | Runtime (defer) | CRUD and rendering — loaded after DOM ready |

---

## Future relationships (intent only — not implemented)

| Integration | Intent |
|-------------|--------|
| **Contacts** | Future: notes attached to a contact (`linkedTo: { type: 'contact', id }`) via `Platform.files` or a dedicated note-link API |
| **Projects** | Future: project notes as a doc category alongside `das` and `autres` |
| **Documents** (`js/shared/files.js`) | Future: file attachments on redaction docs |
| **MCP / AI assistant** | Future: AI drafts a redaction document given a prompt; `ai.php` proxy generates the template fields |
| **AI search** | Future: search entry values (`mp_rdent_*`) in addition to doc names for richer results |
