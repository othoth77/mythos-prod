# Calendar Runtime Plugin — `js/plugins/calendar.runtime.js`

**Stage:** 3E  
**Status:** Complete  
**Replaces:** `js/plugins/calendar.plugin.js`  
**Date:** 2026-07-30

---

## Purpose

`calendar.runtime.js` is the **aggregation consumer layer** for the Calendar application. It is not a data owner. Calendar reads from MythosCalendar providers registered by other plugins; it does not register a provider of its own.

Key design principle:

> Calendar renders. Providers own data.

---

## What Migrated vs What Stays in app.js

| Concern | Migrated to calendar.runtime.js | Stays in app.js |
|---------|--------------------------------|-----------------|
| Plugin registration | Yes — via `Plugin.create().build()` | ~~Platform.registerPlugin()~~ replaced |
| Manifest (id, label, routes, menu) | Yes | — |
| Lifecycle guard (`_CALENDAR_RT_STATE`) | Yes | — |
| `onBoot` | Yes (no-op — calendar has no own storage) | — |
| `onReady` | Yes — calls `_calendarInit()` | — |
| `renderCalendrier()` | NO — stays in app.js | Yes |
| `setCalFilter()` | NO | Yes |
| `_calDateLabel()` / `_calDateSeparator()` | NO | Yes |
| `_calRenderItem()` | NO | Yes |
| `calFilterMode` state variable | NO | Yes |
| RDV CRUD functions | NO | Yes |
| Navigation hook (showView triggers renderCalendrier) | NO — already in app.js | Yes |

---

## Loading Order

`calendar.runtime.js` must be loaded **before** `tasks.runtime.js` and `planning.runtime.js`, which register MythosCalendar providers. It must be loaded **after** `js/core/plugin-sdk.js`.

```
js/core/plugin-sdk.js          ← must exist before
js/plugins/calendar.runtime.js ← loads here (consumers come after)
js/plugins/tasks.runtime.js    ← registers provider id 'tasks'
js/plugins/planning.runtime.js ← registers provider id 'planning'
js/plugins/contacts.runtime.js
js/plugins/notes.runtime.js
js/app.js                      ← renderCalendrier() defined here
js/taches.js
```

Calendar is loaded first among the runtime plugins so that any future logic in `_calendarInit()` can safely assume tasks and planning have registered their providers by the time `Platform.ready()` fires.

---

## Plugin Manifest Fields

| Field | Value |
|-------|-------|
| `id` | `'calendar'` |
| `label` | `'Calendrier'` |
| `version` | `'1.0.0'` |
| `type` | `'shared'` |
| `menu.section` | `'Général'` |
| `menu.order` | `2` |
| `menu.icon` | `'calendar'` |
| `routes` | `[{ id: 'calendrier', label: 'Calendrier', icon: '📅' }]` |
| `storageKeys` | `[]` (empty — Calendar owns no storage) |
| `search` | absent — Calendar is consumer, not data owner |
| `calendar` | absent — Calendar is consumer, not provider |

---

## onBoot Storage Validation

Calendar owns **no storage keys**. The `onBoot` handler is a documented no-op.

| Key | Owner | Calendar onBoot behavior |
|-----|-------|--------------------------|
| `mp_rdvs` | production plugin | not touched — left to production |
| `mp_taches` | tasks plugin | not touched — left to tasks |
| `mp_rappels` | planning plugin | not touched — left to planning |
| `mp_repertoire_contacts` | contacts plugin | not touched |

This is intentional: each plugin validates only its own storage during `onBoot`. Calendar reading these keys happens at render time via `renderCalendrier()` and `STORE.rdvs()`.

---

## onReady Behavior

```javascript
onReady: function () {
  _calendarInit();
}
```

`_calendarInit()`:
1. Checks the `_CALENDAR_RT_STATE.initialized` guard — returns immediately on second call.
2. Sets `_CALENDAR_RT_STATE.initialized = true`.
3. No additional side effects — navigation hook and rendering are already wired in `app.js`.

`renderCalendrier()` is **not called** at initialization time. It is triggered lazily by `showView('calendrier')`.

---

## Provider Architecture

Calendar is the **consumer** of MythosCalendar. Other plugins are the **producers**.

```
tasks.runtime.js    → MythosCalendar.registerProvider('tasks')
                      getEvents: filter mp_taches by dueDate and range
                      
planning.runtime.js → MythosCalendar.registerProvider('planning')
                      getEvents: filter mp_rappels by dateDebut and range

calendar.runtime.js → onReady() → _calendarInit() (consumer only)
                      sets initialized flag; does NOT register a provider

renderCalendrier()  → [app.js, currently reads STORE.rdvs() + getRappels() directly]
                    → [future stage: MythosCalendar.getEvents(range) → aggregated events]
```

---

## Aggregation Flow (Current State)

```
User navigates to 'calendrier'
    ↓
showView('calendrier')  [app.js]
    ↓
if (view === 'calendrier') renderCalendrier();  [app.js line 2895]
    ↓
renderCalendrier()  [app.js line 8399]
    ├── STORE.rdvs()       → reads mp_rdvs directly (production data)
    └── getRappels()       → reads mp_rappels directly (planning data)
    ↓
Renders list grouped by date with filter modes
```

**Future stage** (3E.5 or later) will replace direct `STORE.rdvs()` + `getRappels()` calls with `MythosCalendar.getEvents(range)`, which will aggregate all providers uniformly:

```
renderCalendrier()  [future]
    └── MythosCalendar.getEvents(range)
            ├── provider 'tasks'   → tasks with dueDate in range
            ├── provider 'planning' → rappels with dateDebut in range
            └── [future providers]
```

---

## Initialization Guard / Idempotency

```javascript
var _CALENDAR_RT_STATE = { initialized: false };

function _calendarInit() {
  if (_CALENDAR_RT_STATE.initialized) return;  // guard
  _CALENDAR_RT_STATE.initialized = true;
  // ... init logic ...
}
```

`_calendarInit()` is safe to call any number of times. The second and subsequent calls return immediately. This prevents double-initialization whether triggered from `onReady()` or the `window.load` fallback.

---

## Backward Compatibility Table

| Scenario | Behavior |
|----------|----------|
| `calendar.plugin.js` removed | Replaced by `calendar.runtime.js` — same manifest |
| `MythosCalendar` absent at load time | No crash — `_calendarInit()` is a no-op |
| `Shell` absent at load time | No crash — `calendar.runtime.js` does not call Shell |
| `Platform` absent at load time | No crash — `build()` guards with `typeof Platform` |
| `renderCalendrier` absent at init time | No crash — not called at init time |
| Other plugins loaded without calendar | tasks, planning, contacts, notes unaffected |
| `Platform.ready()` called twice | `_calendarInit()` guard prevents double-init |
| `window.load` fires before `Platform.ready()` | Fallback fires `_calendarInit()` safely |

---

## Dependencies Table

| Dependency | Required | Notes |
|------------|----------|-------|
| `js/core/plugin-sdk.js` | Yes | Must load before this file |
| `js/core/platform.js` | Soft | Guarded with `typeof Platform` |
| `js/core/shell.js` | No | Not used by calendar.runtime.js |
| `MythosCalendar` | No | Consumed by renderCalendrier(), not by this file |
| `renderCalendrier()` | No | Stays in app.js; not called at init time |
| `tasks.runtime.js` | No | Registers 'tasks' provider independently |
| `planning.runtime.js` | No | Registers 'planning' provider independently |

---

## Ownership Boundaries

| Component | Owner | Consumers |
|-----------|-------|-----------|
| `mp_rdvs` data | production plugin | calendar (read), dashboard (read) |
| `mp_taches` data | tasks plugin | calendar (read via MythosCalendar), dashboard |
| `mp_rappels` data | planning plugin | calendar (read via MythosCalendar) |
| Calendar rendering | app.js (`renderCalendrier`) | showView navigation |
| Calendar manifest | calendar.runtime.js | Platform registry |
| MythosCalendar providers | tasks.runtime.js, planning.runtime.js | calendar.runtime.js (consumer) |

---

## Future Integration Note

The full migration of Calendar to use `MythosCalendar.getEvents(range)` is deferred to a future stage (3E.5 or 3F). That stage will:

1. Refactor `renderCalendrier()` to call `await MythosCalendar.getEvents(range)` instead of reading `STORE.rdvs()` and `getRappels()` directly.
2. Add a contacts birthday provider (if desired).
3. Move `renderCalendrier()` to a dedicated `js/plugins/calendar.js` module.

This stage (3E) only migrates the bootstrap registration. No rendering logic is changed.
