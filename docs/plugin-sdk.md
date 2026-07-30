# Plugin SDK — Mythos OS

**File:** `js/core/plugin-sdk.js`  
**Status:** Stage 2D complete  
**Load order:** blocking, after `js/core/shell.js` and before plugin files  
**Depends on:** Platform (at `build()` time), Shell (optional, at `build()` time)

---

## Overview

The Plugin SDK provides a fluent builder API for creating Mythos OS plugin
manifests. Instead of hand-writing a manifest object and calling
`Platform.registerPlugin()` directly, you use the SDK to construct the manifest
step by step, with validation at each stage.

The SDK generates manifests that are fully compatible with
`Platform.registerPlugin()`. Additional fields (`widgets`, `permissions`,
`settings`, `search`, `calendar`, `dashboard`) are stored as extra manifest
keys — Platform ignores unknown keys, and future platform services will read
them directly from the manifest.

---

## Quickstart

```javascript
Plugin.create({
  id:      'my-plugin',
  label:   'My Plugin',
  version: '1.0.0',
  type:    'shared'
})
.defineMenu({ section: 'Général', order: 10, icon: '🔧' })
.defineRoutes([
  { id: 'my-view', label: 'My View', icon: '📋' }
])
.defineStorage(['mp_my_data'])
.build();
```

`build()` returns `{ manifest, registered }`:

- `manifest` — the complete assembled manifest object
- `registered` — `true` if `Platform.registerPlugin(manifest)` accepted it

---

## Plugin lifecycle

```
index.html loads scripts
    │
    ├─ js/core/events.js      ← Event bus available
    ├─ js/core/storage.js     ← Storage helpers available
    ├─ js/core/api.js         ← API wrappers available
    ├─ js/core/platform.js    ← Platform available
    ├─ js/core/shell.js       ← Shell available
    ├─ js/core/plugin-sdk.js  ← Plugin SDK available
    │
    ├─ js/plugins/*.plugin.js ← Plugin files run here
    │       Each file calls Plugin.create(...).build()
    │       or Platform.registerPlugin() directly.
    │       build() calls Platform.registerPlugin() which:
    │         1. Stores manifest in Platform registry
    │         2. Emits 'mythos:plugin:registered'
    │         3. Shell.sidebar auto-registers menu items
    │
    ├─ js/app.js              ← App logic runs; may call Platform.boot()
    │
    Platform.boot()
        Calls onBoot() for each registered plugin
        Emits 'mythos:plugin:booted' per plugin
    
    Platform.ready()
        Calls onReady() for each registered plugin
        Emits 'mythos:ready'
        Shell emits 'mythos:shell:ready'
```

### onBoot(fn)

Called during `Platform.boot()`. Use for:
- Reading from `localStorage`
- Setting up in-memory state
- Registering event listeners

**Do not** make network calls in `onBoot` — the page may not be fully loaded.

### onReady(fn)

Called after all plugins have booted (`Platform.ready()`). Use for:
- Making API calls (`_apiGet`, `_apiPost`)
- Triggering initial data sync
- Emitting application-level events

---

## API Reference

### Plugin.create(base)

Creates a new `PluginBuilder`. Throws if validation fails.

```javascript
Plugin.create({
  id:      'my-plugin',    // required — kebab-case, ^[a-z][a-z0-9-]*
  label:   'My Plugin',   // required — non-empty string
  version: '1.0.0',       // required — semver (major.minor.patch)
  type:    'shared',      // required — 'core' | 'shared' | 'business'
  onBoot:  function() {}, // optional — called during Platform.boot()
  onReady: function() {}  // optional — called during Platform.ready()
})
```

Returns a `PluginBuilder` with a fluent chain API.

---

### .defineMenu(config)

Registers the plugin in the sidebar navigation.

```javascript
.defineMenu({
  section: 'Général',  // sidebar section label (defaults to plugin label)
  order:   10,         // sort order within the sidebar (lower = higher)
  icon:    '🔧'        // emoji or icon string
})
```

The `sectionId` is derived from `section` by the Shell (lowercase, accents
normalized, spaces → hyphens). Section creation is idempotent — multiple
plugins sharing a `section` value share the same sidebar group.

---

### .defineRoutes(routes)

Declares the views this plugin contributes.

```javascript
.defineRoutes([
  { id: 'my-view',        label: 'My View',       icon: '📋' },
  { id: 'my-view-detail', label: 'Detail',        icon: '📄' }
])
```

Each route `id` is the view name passed to `showView()` / `Shell.navigation.go()`.
The Shell auto-registers one sidebar item per route when the plugin is registered.

---

### .defineStorage(keys)

Declares localStorage keys owned by this plugin.

```javascript
.defineStorage([
  'mp_my_collection',
  'mp_my_config'
])
```

Ownership is informational — it lets the storage layer, backup system, and
future plugin isolation features know which keys belong to this plugin.
Dynamic per-record keys (e.g. `mp_my_item_42`) should not be listed here.

---

### .defineWidgets(widgets)

Registers dashboard zone widgets.

```javascript
.defineWidgets([
  {
    id:     'my-plugin:kpi',
    label:  'My KPI',
    zone:   'dashboard',   // target zone id
    order:  10,
    render: function() { /* update the widget's DOM */ }
  }
])
```

`build()` calls `Shell.widgets.register(widget)` for each entry.

---

### .definePermissions(config)

Declares role and auth requirements.

```javascript
.definePermissions({
  roles:       ['admin', 'manager'],
  requireAuth: true
})
```

Informational metadata — access control enforcement is the app's responsibility.

---

### .defineSettings(settings)

Declares configurable settings for this plugin.

```javascript
.defineSettings([
  {
    key:     'threshold',
    label:   'Alert threshold',
    type:    'number',    // 'string' | 'number' | 'boolean' | 'select'
    default: 5
  },
  {
    key:     'mode',
    label:   'Mode',
    type:    'select',
    options: ['auto', 'manual'],
    default: 'auto'
  }
])
```

---

### .defineSearch(config)

Contributes to the global search layer.

```javascript
.defineSearch({
  handler: function(query) {
    // Return an array of search results
    return items
      .filter(function(i) { return i.name.indexOf(query) !== -1; })
      .map(function(i) {
        return { label: i.name, route: 'my-view', data: i };
      });
  }
})
```

---

### .defineCalendar(config)

Contributes events to the global calendar layer.

```javascript
.defineCalendar({
  provider: function(range) {
    // range: { start: Date, end: Date }
    // Return an array of calendar event objects
    return events.filter(function(e) {
      var d = new Date(e.date);
      return d >= range.start && d <= range.end;
    });
  }
})
```

---

### .defineDashboard(config)

Declares dashboard tiles provided by this plugin.

```javascript
.defineDashboard({
  tiles: [
    { id: 'kpi-total',  label: 'Total'   },
    { id: 'kpi-active', label: 'Active'  }
  ]
})
```

---

### .build()

Assembles the manifest, calls `Platform.registerPlugin(manifest)`, and
registers widgets with `Shell.widgets`.

```javascript
var result = Plugin.create({...}).defineMenu({...}).build();
// result.manifest   — the assembled manifest
// result.registered — true if Platform accepted it
```

---

### Plugin.validate(base)

Validates a base manifest object without creating a builder. Returns `null` on
success or an error string describing the first validation failure.

```javascript
var err = Plugin.validate({ id: 'x', label: 'X', version: '1.0.0', type: 'shared' });
// err === null — valid
```

---

## Manifest schema

```
{
  id:          string  — required, kebab-case ^[a-z][a-z0-9-]*
  label:       string  — required, non-empty
  version:     string  — required, semver prefix (e.g. "1.0.0")
  type:        string  — required, "core" | "shared" | "business"

  onBoot?:     function()
  onReady?:    function()

  menu?: {
    section:   string
    order:     number
    icon:      string
  }

  routes?: Array<{
    id:        string  — required
    label?:    string
    icon?:     string
    render?:   function
  }>

  storageKeys?: string[]

  // SDK-extended fields (Platform ignores; future services read directly):

  widgets?: Array<{
    id:        string  — required
    label?:    string
    zone?:     string  — default 'dashboard'
    render?:   function
    order?:    number
  }>

  permissions?: {
    roles?:       string[]
    requireAuth?: boolean
  }

  settings?: Array<{
    key:       string  — required
    label?:    string
    type?:     'string' | 'number' | 'boolean' | 'select'
    options?:  string[]
    default?:  any
  }>

  search?: {
    handler?: function(query: string) → Array
  }

  calendar?: {
    provider?: function(range: { start: Date, end: Date }) → Array
  }

  dashboard?: {
    tiles?: Array<{ id: string, label?: string, render?: function }>
  }
}
```

---

## Versioning policy

Plugin versions follow **semver** (`major.minor.patch`):

| Change | Version bump |
|--------|-------------|
| New routes, storage keys, or settings added | `minor` (e.g. `1.1.0`) |
| Existing routes or keys removed / renamed | `major` (e.g. `2.0.0`) |
| Bug fix in `onBoot` / `onReady` | `patch` (e.g. `1.0.1`) |
| New `defineWidgets` / `defineSearch` entries added | `minor` |
| Any breaking change to existing manifest shape | `major` |

The Platform does not enforce versions — they are informational. However,
other platform services (search layer, calendar layer, backup system) may
use the version to detect breaking changes during future upgrades.

---

## Best practices

1. **One plugin per domain** — group related views and storage keys in a
   single plugin. If a domain grows too large, extract sub-domains into
   separate plugins (each with their own `defineStorage` declaration).

2. **Idempotent onBoot** — `onBoot` may be called multiple times during
   development (hot reload). Write initialisation so it is safe to run twice.

3. **No network in onBoot** — defer API calls to `onReady`.

4. **kebab-case ids** — both plugin `id` and route `id` must be kebab-case.
   Route ids are used as URL hashes; non-ASCII characters will cause issues.

5. **Shared section labels** — multiple plugins that should appear under the
   same sidebar heading must use exactly the same `section` string. The Shell
   derives the `sectionId` by normalising the label (lowercase, accent-strip,
   spaces → hyphens).

6. **Storage key ownership** — list all `mp_*` keys your plugin writes. Do
   not list keys owned by other plugins even if you read from them. Dynamic
   per-record keys (e.g. `mp_rdtpl_*`) are excluded.

7. **Avoid duplicate registrations** — `Platform.registerPlugin()` is
   idempotent (returns `false` on duplicate id). The SDK throws if you call
   the same `define*` method twice on the same builder.

---

## Compatibility with direct Platform.registerPlugin()

The SDK is an optional convenience layer. Existing plugins that call
`Platform.registerPlugin()` directly continue to work without modification.
The SDK simply assembles the same manifest object and calls the same function.

```javascript
// Direct (works, no SDK needed)
Platform.registerPlugin({
  id: 'my-plugin', label: 'My Plugin', version: '1.0.0', type: 'shared',
  menu: { section: 'Général', order: 10, icon: '🔧' },
  routes: [{ id: 'my-view', label: 'My View', icon: '📋' }]
});

// Via SDK (equivalent result)
Plugin.create({ id: 'my-plugin', label: 'My Plugin', version: '1.0.0', type: 'shared' })
  .defineMenu({ section: 'Général', order: 10, icon: '🔧' })
  .defineRoutes([{ id: 'my-view', label: 'My View', icon: '📋' }])
  .build();
```


---

## Runtime Services Integration

When `js/core/services/plugin-services.js` is loaded (after the services, before `plugin-sdk.js`), plugin manifests are **automatically bridged** to the runtime services:

| `define*()` call | Manifest key | Auto-registered with |
|---|---|---|
| `.defineSearch({ handler })` | `manifest.search.handler` | `MythosSearch` |
| `.defineCalendar({ provider })` | `manifest.calendar.provider` | `MythosCalendar` |
| `.defineWidgets([...])` | `manifest.widgets[]` | `MythosWidgets` |

This happens automatically via the `mythos:plugin:registered` event. No additional code is needed in the plugin. The handler/provider functions remain on the manifest for backward compatibility.

When a service global (`MythosSearch`, `MythosCalendar`, `MythosWidgets`) is absent, wiring is silently skipped — the plugin registers normally in Platform.

See `docs/runtime-services.md` for the complete service API.
