# Mythos OS — Runtime Services

**Stage:** 3A.5
**Status:** Complete
**Files:** `js/core/services/`

Runtime services provide shared infrastructure that plugins and application modules can use without coupling directly to each other. They are loaded as blocking `<script>` tags after `shell.js` and before `plugin-sdk.js`.

---

## Loading Order

```
js/core/shell.js
js/core/services/search.js
js/core/services/calendar.js
js/core/services/widgets.js
js/core/services/notifications.js
js/core/services/dialogs.js
js/core/services/plugin-services.js   ← bridges manifests to services
js/core/plugin-sdk.js
js/plugins/*.plugin.js
js/plugins/*.runtime.js
application scripts (app.js, taches.js, ...)
```

---

## 1. Search Service — `MythosSearch`

Central registry for text search providers. Consumers call `search()` and receive normalised results from all registered providers.

### API

```javascript
MythosSearch.registerProvider(config)   // → boolean
MythosSearch.unregisterProvider(id)     // → boolean
MythosSearch.hasProvider(id)            // → boolean
MythosSearch.getProviders()             // → ProviderMeta[]
MythosSearch.search(query, context?)    // → Promise<NormalizedResult[]>
```

### Provider Schema

```javascript
{
  id:       'tasks',           // required, unique
  label:    'Taches',          // optional, display name
  order:    10,                // optional, ascending sort (default 99)
  disabled: false,             // optional, skipped when true
  search:   function(query, context) { return []; }  // required, sync or Promise
}
```

### Normalized Result Schema

```javascript
{
  id:         string,          // generated if not provided by raw result
  providerId: string,
  type:       string,          // default 'result'
  title:      string,          // falls back to raw.label if raw.title absent
  subtitle:   string,          // default ''
  route:      string | null,
  data:       any | null,
  score:      number           // default 0
}
```

### Error Isolation

One throwing or rejecting provider does not affect others. Errors are logged via `console.error`.

---

## 2. Calendar Service — `MythosCalendar`

Central registry for calendar event providers.

### API

```javascript
MythosCalendar.registerProvider(config) // → boolean
MythosCalendar.unregisterProvider(id)   // → boolean
MythosCalendar.hasProvider(id)          // → boolean
MythosCalendar.getProviders()           // → ProviderMeta[]
MythosCalendar.getEvents(range, ctx?)   // → Promise<NormalizedEvent[]>
```

### Provider Schema

```javascript
{
  id:        'tasks',
  label:     'Taches',
  order:     10,
  getEvents: function(range, context) { return []; }  // sync or Promise
}
```

### Range Object

```javascript
{ start: '2026-08-01', end: '2026-08-31' }  // ISO strings or Date objects
```

`getEvents()` rejects if range is null, missing, or has neither `start` nor `end`.

### Normalized Event Schema

```javascript
{
  id:         string,
  providerId: string,
  title:      string,
  start:      string | null,  // raw.date accepted as alias for raw.start
  end:        string | null,
  allDay:     boolean,        // default true
  route:      string | null,
  data:       any | null
}
```

Events are sorted chronologically by `start`.

### Calendar Aggregation Architecture (Stage 3E)

`MythosCalendar` is **consumed** by `calendar.runtime.js` and **fed** by provider plugins:

| Plugin | Role | Provider id |
|--------|------|-------------|
| `production.runtime.js` | Producer — registers RDVs (`mp_rdvs`) and Représentations (`mp_representations`) with `date` | `'production'` |
| `tasks.runtime.js` | Producer — registers tasks with `dueDate` | `'tasks'` |
| `planning.runtime.js` | Producer — registers rappels with `dateDebut` | `'planning'` |
| `calendar.runtime.js` | Consumer only — does not register a provider | — |

`renderCalendrier()` (in `app.js`) currently reads `STORE.rdvs()` and `getRappels()` directly.
A future stage will replace those calls with `MythosCalendar.getEvents(range)` so all providers
are consumed uniformly. Calendar is the aggregation layer; it does not own any data.

---

## 3. Widgets Service — `MythosWidgets`

Registry for renderable dashboard widgets. Compatible with `Shell.widgets` — registrations are mirrored.

### API

```javascript
MythosWidgets.register(config)   // → boolean
MythosWidgets.unregister(id)     // → boolean
MythosWidgets.has(id)            // → boolean
MythosWidgets.getAll(zone?)      // → WidgetMeta[]   (render fn excluded)
MythosWidgets.render(id, ctx?)   // → any | null
```

### Widget Schema

```javascript
{
  id:     'tasks-widget',   // required
  label:  'Tasks',          // optional
  zone:   'dashboard',      // optional, default 'dashboard'
  order:  10,               // optional, default 99
  render: function(context) { return '<div>...</div>'; }  // optional
}
```

`getAll()` returns metadata copies — the `render` function is not exposed.
`render()` isolates errors; returns `null` on failure or missing render fn.
Shell.widgets compatibility: widgets registered via `MythosWidgets` are automatically forwarded to `Shell.widgets.register()` when Shell is available.

---

## 4. Notifications Service — `MythosNotifications`

Self-contained toast and in-memory history. No dependency on module-local `_tchToast` or `_rdToast`.

### API

```javascript
MythosNotifications.notify(config)           // → NotificationEntry | null
MythosNotifications.info(message, options?)  // → NotificationEntry
MythosNotifications.success(message, opts?)  // → NotificationEntry
MythosNotifications.warning(message, opts?)  // → NotificationEntry
MythosNotifications.error(message, opts?)    // → NotificationEntry
MythosNotifications.getHistory()             // → NotificationEntry[]  (newest first)
MythosNotifications.clearHistory()           // → void
```

### Notification Schema

```javascript
{
  id:        string,          // auto-generated
  type:      'info' | 'success' | 'warning' | 'error',
  message:   string,
  title:     string | null,
  timestamp: ISO string,
  duration:  number,          // milliseconds, default 3000
  source:    string | null,
  data:      any | null
}
```

History is capped at 100 entries (newest first).
`mythos:notification` event is emitted via Events bus for each notification.
DOM toast is created when `document.body` is available; absent `document` is safe.

---

## 5. Dialogs Service — `MythosDialogs`

Promise-based wrappers for browser dialogs. Falls back to native `window.alert/confirm/prompt`.

### API

```javascript
MythosDialogs.alert(message, options?)                   // → Promise<undefined>
MythosDialogs.confirm(message, options?)                 // → Promise<boolean>
MythosDialogs.prompt(message, defaultValue?, options?)   // → Promise<string | null>
```

All methods return Promises for `async/await` compatibility.
When `window` is absent (SSR, tests), `confirm` resolves `false` and `prompt` resolves `null`.

---

## 6. Plugin Services Bridge — `PluginServices`

Automatically connects plugin manifests to runtime services when a plugin calls `build()`.

### Wiring Map

| Manifest field | Service registration |
|---|---|
| `manifest.search.handler` | `MythosSearch.registerProvider()` |
| `manifest.calendar.provider` | `MythosCalendar.registerProvider()` |
| `manifest.widgets[]` | `MythosWidgets.register()` for each |

### How It Works

1. `plugin-services.js` listens on `Events('mythos:plugin:registered')`
2. Each time `Plugin.build()` calls `Platform.registerPlugin()`, the event fires
3. `PluginServices` reads the full manifest from `Platform.getPlugin(id)`
4. Absent services (globals not defined) cause no errors
5. Each plugin is consumed at most once (guarded by `_consumed` map)
6. Duplicate providers are protected by `hasProvider()` / `has()` guards

### Compatibility Fallback

`tasks.runtime.js` also registers directly with `MythosSearch` and `MythosCalendar` inside `_tasksInit()` — only if `plugin-services.js` has not already registered them (`!hasProvider('tasks')` guard). This ensures Tasks works in partial-migration scenarios.

`production.runtime.js` (Stage 3G) follows the same pattern: `_productionInit()` registers with `MythosSearch` (provider `'production'`, order 10, 8 collections) and `MythosCalendar` (provider `'production'`, order 10, RDVs + Représentations). Both are guarded by `hasProvider()`.

### Registered Search Providers (Stage 3G complete)

| Provider id | Plugin file | Collections searched |
|-------------|-------------|---------------------|
| `'production'` | `production.runtime.js` | invoices, clients, devis, contracts, rdvs, oms, representations, collabs |
| `'tasks'` | `tasks.runtime.js` | mp_taches (note text) |
| `'planning'` | `planning.runtime.js` | mp_rappels (titre, type, details) |
| `'contacts'` | `contacts.runtime.js` | mp_repertoire_contacts (nom, prenom, tel1, tel2, email, metier, domaine, note) |
| `'notes'` | `notes.runtime.js` | mp_rddocs_das, mp_rddocs_autres (titre, contenu, tags) |

### Registered Calendar Providers (Stage 3G complete)

| Provider id | Plugin file | Date source |
|-------------|-------------|-------------|
| `'production'` | `production.runtime.js` | `mp_rdvs[].date`, `mp_representations[].date` |
| `'tasks'` | `tasks.runtime.js` | `mp_taches[].dueDate` |
| `'planning'` | `planning.runtime.js` | `mp_rappels[].dateDebut` |

---

## Plugin Integration Example

```javascript
Plugin.create({
  id: 'notes', label: 'Notes', version: '1.0.0', type: 'business'
})
.defineSearch({
  handler: function(query) {
    // returned results are auto-normalized and bridged to MythosSearch
    return getNotes().filter(n => n.text.includes(query))
      .map(n => ({ title: n.title, route: 'notes', data: n }));
  }
})
.defineCalendar({
  provider: function(range) {
    return getNoteDueDates(range)
      .map(n => ({ id: 'note-' + n.id, title: n.title, date: n.dueDate }));
  }
})
.defineWidgets([
  { id: 'notes-widget', label: 'Recent Notes', zone: 'dashboard', order: 20,
    render: function() { return renderNotesWidget(); } }
])
.build();
// After build(): MythosSearch, MythosCalendar, and MythosWidgets are all
// automatically registered via PluginServices — no additional code needed.
```

---

## Error Isolation Summary

| Service | Error behavior |
|---|---|
| `MythosSearch.search()` | Per-provider try/catch + `.catch()` — other providers continue |
| `MythosCalendar.getEvents()` | Same |
| `MythosWidgets.render()` | try/catch — returns null, logs error |
| `MythosNotifications` | toast absent when no `document.body` — no crash |
| `MythosDialogs` | native fallbacks when custom modals absent |
| `PluginServices` | each missing service checked with `typeof` guard |

---

## Backward Compatibility

- `Shell.widgets` is not replaced — `MythosWidgets` forwards registrations to it
- Plugins that call `Platform.registerPlugin()` directly (without the SDK) are not affected
- `tasks.runtime.js` works without any of the runtime services
- `app.js` works without `PluginServices` loaded
- `contacts.runtime.js` (Stage 3B) degrades gracefully without `MythosSearch` (skips provider registration) or without `Shell` (plugin registration still succeeds)
- `notes.runtime.js` (Stage 3C) degrades gracefully without `MythosSearch` (skips provider registration) or without `Shell` (plugin registration still succeeds); `redaction.js` CRUD and rendering are entirely unaffected
- `planning.runtime.js` (Stage 3D) degrades gracefully without `MythosSearch` or `MythosCalendar` (skips provider registrations) or without `Shell`; `rappels.js` CRUD, rendering, and recurrence logic are entirely unaffected
- `dashboard.runtime.js` (Stage 3F) does not register any search or calendar providers — Dashboard is a pure aggregation consumer. `MythosWidgets` usage is scaffolded for a future stage; `_dashboardInit()` is a no-op when `MythosWidgets` is absent. Widget registrations, when added in a future stage, will call `MythosWidgets.register()` inside `_dashboardInit()` and will be automatically forwarded to `Shell.widgets` by the `MythosWidgets` service (see `js/core/services/widgets.js`). Dashboard business logic (`updateDashboardStats`, `updateDashboardOperational`, `loadDashboardInscriptionsCount`) stays in `app.js` and is never called from the runtime plugin.
