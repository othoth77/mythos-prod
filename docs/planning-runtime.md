# Planning Runtime Plugin — `js/plugins/planning.runtime.js`

**Stage:** 3D  
**Replaces:** `js/plugins/planning.plugin.js`  
**Status:** Complete — 110/110 tests pass

---

## Purpose

`planning.runtime.js` migrates the Planning / Rappels module's bootstrap logic
from a bare `Platform.registerPlugin()` call into the Plugin SDK lifecycle.
It adds MythosSearch and MythosCalendar providers so rappels are searchable and
appear on the unified calendar.

**All Planning business logic stays in `rappels.js` and `app.js`.** Nothing was
extracted from those files.

---

## What Migrated vs. Retained

### Migrated (now in `planning.runtime.js`)

| Concern | Details |
|---|---|
| Plugin registration | `Plugin.create().defineMenu().defineRoutes([]).defineStorage().defineSearch().defineCalendar().build()` |
| onBoot storage validation | `mp_rappels` and `mp_rappel_types` — recover malformed JSON, never delete valid data |
| onReady initialization | `_planningInit()` — idempotent, registers MythosSearch + MythosCalendar providers |
| Search handler | `_planningSearchHandler()` — late-bound, reads `mp_rappels` at call time |
| Calendar provider | `_planningCalendarProvider()` — late-bound, reads `mp_rappels` at call time |
| window.load fallback | Guards against Platform.ready() never being called |

### Retained in `rappels.js` / `app.js`

| Concern | Location |
|---|---|
| All CRUD | `getRappels`, `saveRappelsList`, `saveRappel`, `deleteRappel` — `rappels.js` |
| All rendering | `renderRappelsTable`, `openRappelsModal`, `closeRappelsModal`, `openRappelsListModal`, `closeRappelsListModal` — `rappels.js` |
| Recurrence logic | `getNextRappelDate`, `periodeLabel`, `getRappelsForRdv` — `rappels.js` |
| Rappel types management | `getRappelTypes`, `saveRappelTypes`, `addRappelTypeIfNew` — `rappels.js` |
| Badge logic | `updateRappelsBadge` — `rappels.js` |
| DOM modal creation | `DOMContentLoaded` handler — `rappels.js` |
| Calendar rendering integration | `filteredRappels` building, `renderCalendrier()` call — `app.js` |

---

## Loading Order

```
js/core/plugin-sdk.js
js/plugins/tasks.runtime.js
js/plugins/planning.runtime.js      ← here
js/plugins/contacts.runtime.js
js/plugins/notes.runtime.js
js/logger.js
js/auth.js
js/app.js
js/taches.js
```

`rappels.js` is loaded separately (deferred, before the plugin scripts block).

---

## Plugin Manifest Fields

| Field | Value |
|---|---|
| `id` | `'planning'` |
| `label` | `'Planning'` |
| `version` | `'1.0.0'` |
| `type` | `'shared'` |
| `menu.section` | `'Général'` |
| `menu.order` | `4` |
| `menu.icon` | `'planning'` |
| `routes` | `[]` (empty — planning is modal-based) |
| `storageKeys` | `['mp_rappels', 'mp_rappel_types']` |
| `search.handler` | `_planningSearchHandler` |
| `calendar.provider` | `_planningCalendarProvider` |

---

## onBoot Storage Validation

Called by `Platform.boot()`. Validates both storage keys before any module accesses them.

| Key | null (never set) | Valid array | Invalid JSON | Non-array JSON |
|---|---|---|---|---|
| `mp_rappels` | left null | preserved | reset to `'[]'` | reset to `'[]'` |
| `mp_rappel_types` | left null | preserved | reset to `'[]'` | reset to `'[]'` |

**Safety guarantee:** valid data is never deleted or overwritten.  
**Fallback:** if `localStorage` is unavailable, the `try/catch` block silently skips the key.

---

## onReady Behavior

`_planningInit()` is called from `onReady`. It is guarded by `_PLANNING_RT_STATE.initialized`
and is idempotent — safe to call multiple times.

Steps:
1. Check `_PLANNING_RT_STATE.initialized` — return immediately if already done.
2. Set `_PLANNING_RT_STATE.initialized = true`.
3. If `MythosSearch` is defined and has no `'planning'` provider, register one.
4. If `MythosCalendar` is defined and has no `'planning'` provider, register one.

---

## Search Handler

**Function:** `_planningSearchHandler(query)`

| Property | Value |
|---|---|
| Provider id | `'planning'` |
| Provider label | `'Planning'` |
| Provider order | `7` |
| Data source | `localStorage.getItem('mp_rappels')` at call time |
| Searchable fields | `titre`, `type`, `details` |
| Match logic | case-insensitive substring |
| Empty query | returns `[]` immediately |
| Malformed entries | silently skipped via try/catch |

**Result normalization:**

```javascript
{
  id:       'plan-' + r.id,
  title:    r.titre || 'Rappel',
  subtitle: r.type || r.details.slice(0, 60),
  type:     'planning',
  route:    null,            // planning is modal-based; no full-page route
  data:     r               // full rappel object
}
```

**Late binding:** `localStorage` is read at search call time, not at registration time.
This means the search handler always reflects the current state of rappels even if they
were added after the plugin was registered.

---

## Calendar Provider

**Function:** `_planningCalendarProvider(range)`

| Property | Value |
|---|---|
| Provider id | `'planning'` |
| Provider label | `'Planning'` |
| Provider order | `5` |
| Data source | `localStorage.getItem('mp_rappels')` at call time |
| Date field | `dateDebut` (YYYY-MM-DD) |
| `allDay` | always `true` |
| `route` | `null` (no dedicated route) |
| Range filtering | `range.start` and `range.end` sliced to YYYY-MM-DD |
| Null/missing `dateDebut` | entry skipped gracefully |
| Invalid date format | entry skipped (must match `/^\d{4}-\d{2}-\d{2}$/`) |
| Sort | chronological by `start` (ascending) |
| Empty storage | returns `[]` |

**Event structure emitted:**

```javascript
{
  id:     'plan-' + r.id,
  title:  r.titre || 'Rappel',
  start:  r.dateDebut.slice(0, 10),   // YYYY-MM-DD
  end:    null,
  allDay: true,
  route:  null,
  data:   r                           // full rappel object
}
```

MythosCalendar normalizes the event further (adding `providerId`, defaulting `end` to null).
The service itself sorts events across all providers chronologically.

**Late binding:** identical rationale to the search handler.

---

## Initialization Guard / Idempotency

```javascript
var _PLANNING_RT_STATE = { initialized: false };

function _planningInit() {
  if (_PLANNING_RT_STATE.initialized) return;
  _PLANNING_RT_STATE.initialized = true;
  // ... register providers
}
```

| Scenario | Outcome |
|---|---|
| `Platform.ready()` called once | `_planningInit()` runs, providers registered |
| `Platform.ready()` called again | `_planningInit()` returns immediately (guard) |
| `window.load` fires before `Platform.ready()` | `_planningInit()` runs once via fallback |
| `window.load` fires after `Platform.ready()` | guard blocks second run |
| `MythosSearch.hasProvider('planning')` check | prevents duplicate even if guard fails |

---

## PluginServices Auto-Wiring

`PluginServices` (loaded before plugin-sdk.js) listens for `'mythos:plugin:registered'`
and calls `_consume(manifest)` when the planning plugin registers. It reads
`manifest.search.handler` and `manifest.calendar.provider` and registers them with
`MythosSearch` and `MythosCalendar` respectively.

The `hasProvider()` guard in `_planningInit()` prevents double-registration if both
`PluginServices` and `onReady` attempt to register the same provider.

---

## Backward Compatibility

| Scenario | Behavior |
|---|---|
| `MythosSearch` absent at init time | `typeof` check skips registration; still initializes |
| `MythosCalendar` absent at init time | `typeof` check skips registration; still initializes |
| `Shell` absent | plugin registration still succeeds (Shell is optional in SDK) |
| `Platform` absent | Plugin stub accepted; no crash |
| `localStorage` throws | `try/catch` in onBoot and search/calendar handlers silently skips |
| `rappels.js` not loaded | search/calendar return `[]` (no CRUD functions called) |
| `app.js` not loaded | no effect on this file |

---

## Dependencies

| Dependency | Role | Required? |
|---|---|---|
| `js/core/plugin-sdk.js` | `Plugin.create()` | Yes |
| `js/core/services/search.js` | `MythosSearch.registerProvider()` | Optional |
| `js/core/services/calendar.js` | `MythosCalendar.registerProvider()` | Optional |
| `js/core/services/plugin-services.js` | auto-wires manifest → services | Optional |
| `localStorage` | reading `mp_rappels` at search/calendar call time | Optional |
| `js/rappels.js` | provides CRUD, rendering, recurrence (not called here) | Runtime only |

---

## Future Relationship Note

When Planning is eventually extracted into `js/shared/planning.js` (Stage 3 full
extraction), the calendar provider can be enhanced to compute the recurrence next
date (`getNextRappelDate`) and emit multiple events per rappel. The current provider
emits one event per rappel using `dateDebut` as-is, which is intentionally minimal.

The planning plugin may eventually integrate with contacts (linking rappels to contacts
via `rdvId`) and production (triggering reminders for production milestones). Those
integrations will be added as separate providers or event listeners, not by modifying
this file's search/calendar handlers.
