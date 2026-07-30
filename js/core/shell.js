// =====================================================
// MYTHOS OS — Shell Foundation
// js/core/shell.js
//
// The Shell is the UI adapter layer of the platform.
// It provides a stable API for:
//   - sidebar section + item registry
//   - workspace title / subtitle state
//   - hash-based navigation adapter
//   - widget registry (dashboard zones)
//   - header element accessors
//
// IMPORTANT CONSTRAINTS:
//   ✗ Does NOT modify any existing DOM structure
//   ✗ Does NOT change showView() behaviour
//   ✗ Does NOT touch invoice, tasks, contacts, or
//     dashboard rendering logic
//   ✓ Only maintains in-memory registries
//   ✓ Adapts existing globals (showView, location.hash)
//   ✓ Emits platform events for future listeners
//
// Depends on: Events (js/core/events.js)
//             Platform (js/core/platform.js)  [optional at load time]
// Loaded:     blocking, after js/core/platform.js
//             and before plugin manifests
// =====================================================

var Shell = (function () {

  // ── Private state ─────────────────────────────────────────────────
  var _sections    = {};   // sectionId → { id, label, order }
  var _sectionOrder = [];
  var _items       = {};   // itemId → { id, section, route, label, icon, order }
  var _itemOrder   = [];
  var _widgets     = {};   // widgetId → { id, label, zone, render, order }
  var _widgetOrder = [];
  var _title       = '';
  var _subtitle    = '';

  // ── Shell.navigation ──────────────────────────────────────────────
  //
  // Adapter around the existing showView() + location.hash.
  // Shell.navigation.go() delegates to showView() when available,
  // falls back to setting location.hash directly (e.g., in tests
  // or before app.js loads).
  var navigation = {

    go: function (route) {
      if (typeof route !== 'string' || !route) return;
      if (typeof showView === 'function') {
        showView(route);
      } else {
        location.hash = route;
      }
      Events.emit('mythos:shell:navigate', { route: route });
    },

    current: function () {
      if (typeof location !== 'undefined' && location.hash) {
        var h = location.hash.replace(/^#/, '');
        return h || 'dashboard';
      }
      return 'dashboard';
    }

  };

  // ── Shell.workspace ───────────────────────────────────────────────
  //
  // Workspace title / subtitle state.
  // Does NOT touch any existing .page-header elements in the DOM —
  // each view manages its own header. The setTitle / setSubtitle APIs
  // store values in memory (for future dynamic workspace rendering)
  // and update document.title as a harmless side-effect.
  var workspace = {

    setTitle: function (title) {
      _title = (typeof title === 'string') ? title : '';
      if (typeof document !== 'undefined' && _title) {
        document.title = _title + ' — Mythos';
      }
      Events.emit('mythos:shell:title', { title: _title });
    },

    setSubtitle: function (text) {
      _subtitle = (typeof text === 'string') ? text : '';
      Events.emit('mythos:shell:subtitle', { subtitle: _subtitle });
    },

    // clear() is a no-op in the current SPA architecture.
    // Each view controls its own DOM. When views are extracted to
    // render() functions in the plugin manifests this becomes meaningful.
    clear: function () {
      Events.emit('mythos:shell:clear', {});
    },

    getTitle:    function () { return _title; },
    getSubtitle: function () { return _subtitle; }

  };

  // ── Shell.sidebar ─────────────────────────────────────────────────
  //
  // In-memory registry of sidebar sections and items.
  // Does NOT modify the existing #sidebar-nav DOM.
  // The registry describes the intended structure for future
  // dynamic sidebar rendering (Stage 3+).
  var sidebar = {

    // Register a section label.
    // id:    unique kebab-case key ('production', 'général')
    // label: display text shown in the sidebar
    // order: integer sort key (lower = higher in sidebar)
    registerSection: function (id, label, order) {
      if (typeof id !== 'string' || !id) return false;
      if (Object.prototype.hasOwnProperty.call(_sections, id)) return false;
      _sections[id] = {
        id:    id,
        label: typeof label === 'string' ? label : id,
        order: typeof order === 'number' ? order : 99
      };
      _sectionOrder.push(id);
      Events.emit('mythos:shell:section:registered', { id: id, label: _sections[id].label });
      return true;
    },

    // Register a sidebar navigation item.
    // manifest: { id, section, route, label, icon, order }
    //   id      — unique key (convention: 'pluginId:routeId')
    //   section — section id this item belongs to
    //   route   — view name passed to showView() / Shell.navigation.go()
    //   label   — display text
    //   icon    — emoji or icon string
    //   order   — integer sort key within its section
    registerItem: function (manifest) {
      if (!manifest || typeof manifest.id !== 'string' || !manifest.id) return false;
      if (!manifest.route) return false;
      if (Object.prototype.hasOwnProperty.call(_items, manifest.id)) return false;
      _items[manifest.id] = {
        id:      manifest.id,
        section: typeof manifest.section === 'string' ? manifest.section : 'général',
        route:   manifest.route,
        label:   typeof manifest.label   === 'string' ? manifest.label  : manifest.route,
        icon:    typeof manifest.icon    === 'string' ? manifest.icon   : '',
        order:   typeof manifest.order   === 'number' ? manifest.order  : 99
      };
      _itemOrder.push(manifest.id);
      Events.emit('mythos:shell:item:registered', {
        id: manifest.id, route: manifest.route, section: _items[manifest.id].section
      });
      return true;
    },

    getSections: function () {
      return _sectionOrder.map(function (k) { return _copy(_sections[k]); })
                          .sort(function (a, b) { return a.order - b.order; });
    },

    // Pass section id to filter; omit to get all items.
    getItems: function (section) {
      var list = _itemOrder.map(function (k) { return _copy(_items[k]); });
      if (typeof section === 'string') {
        list = list.filter(function (i) { return i.section === section; });
      }
      return list.sort(function (a, b) { return a.order - b.order; });
    },

    hasSection: function (id) { return Object.prototype.hasOwnProperty.call(_sections, id); },
    hasItem:    function (id) { return Object.prototype.hasOwnProperty.call(_items, id); }

  };

  // ── Shell.header ──────────────────────────────────────────────────
  //
  // Read-only accessors for existing DOM elements.
  // Does NOT create, move, or modify any element.
  var header = {
    getLogoEl:     function () { return _el('sidebar-logo'); },
    getSidebarEl:  function () { return _el('sidebar'); },
    getNavEl:      function () { return _el('sidebar-nav'); },
    getLogoutEl:   function () { return _el('global-logout-btn'); }
  };

  // ── Shell.widgets ─────────────────────────────────────────────────
  //
  // Registry for dashboard zone widgets (e.g., tasks widget, KPI tiles).
  // Widgets are descriptors; Shell does not render them.
  // Each business/shared module registers its own widget here so
  // the future dashboard manager knows what to render and where.
  var widgets = {

    // manifest: { id, label, zone, render, order }
    //   id     — unique key
    //   label  — display name
    //   zone   — target DOM zone id ('dashboard', 'dash-taches-zone', ...)
    //   render — function() called to refresh the widget (or null)
    //   order  — integer sort key within the zone
    register: function (manifest) {
      if (!manifest || typeof manifest.id !== 'string' || !manifest.id) return false;
      if (Object.prototype.hasOwnProperty.call(_widgets, manifest.id)) return false;
      _widgets[manifest.id] = {
        id:     manifest.id,
        label:  typeof manifest.label  === 'string'   ? manifest.label  : manifest.id,
        zone:   typeof manifest.zone   === 'string'   ? manifest.zone   : 'dashboard',
        render: typeof manifest.render === 'function' ? manifest.render : null,
        order:  typeof manifest.order  === 'number'   ? manifest.order  : 99
      };
      _widgetOrder.push(manifest.id);
      Events.emit('mythos:shell:widget:registered', {
        id: manifest.id, zone: _widgets[manifest.id].zone
      });
      return true;
    },

    // Pass zone id to filter; omit to get all widgets across all zones.
    getAll: function (zone) {
      var list = _widgetOrder.map(function (id) { return _copy(_widgets[id]); });
      if (typeof zone === 'string') {
        list = list.filter(function (w) { return w.zone === zone; });
      }
      return list.sort(function (a, b) { return a.order - b.order; });
    },

    hasWidget: function (id) { return Object.prototype.hasOwnProperty.call(_widgets, id); }

  };

  // ── Auto-register plugin menu items ───────────────────────────────
  //
  // When a plugin is registered with Platform, Shell automatically
  // reads its menu and routes and adds them to the sidebar registry.
  // This fires for plugins already registered AND for future ones
  // (since this listener is attached at shell.js load time, before
  //  the plugin manifests load).
  Events.on('mythos:plugin:registered', function (payload) {
    if (!payload || !payload.id) return;
    if (typeof Platform === 'undefined' || !Platform.getPlugin) return;
    var plugin = Platform.getPlugin(payload.id);
    if (!plugin || !plugin.menu) return;

    // Derive a stable section id from the menu section name
    var sectionLabel = plugin.menu.section || plugin.label || plugin.id;
    var sectionId    = sectionLabel.toLowerCase()
                                   .replace(/[àâä]/g, 'a')
                                   .replace(/[éèêë]/g, 'e')
                                   .replace(/\s+/g, '-')
                                   .replace(/[^a-z0-9-]/g, '');

    // Register section (idempotent — skipped if already exists)
    sidebar.registerSection(sectionId, sectionLabel, plugin.menu.order || 99);

    // Register one sidebar item per route
    if (Array.isArray(plugin.routes)) {
      plugin.routes.forEach(function (route, idx) {
        if (!route || !route.id) return;
        var itemId = plugin.id + ':' + route.id;
        sidebar.registerItem({
          id:      itemId,
          section: sectionId,
          route:   route.id,
          label:   route.label || route.id,
          icon:    route.icon  || '',
          order:   (plugin.menu.order || 0) * 100 + idx
        });
      });
    }
  });

  // ── Shell ready ───────────────────────────────────────────────────
  Events.on('mythos:ready', function () {
    Events.emit('mythos:shell:ready', {
      sections: sidebar.getSections().length,
      items:    sidebar.getItems().length,
      widgets:  widgets.getAll().length
    });
  });

  // ── Private helpers ───────────────────────────────────────────────
  function _el(id) {
    return (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById(id)
      : null;
  }

  function _copy(obj) {
    var c = {}, keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) c[keys[i]] = obj[keys[i]];
    return c;
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    sidebar:    sidebar,
    header:     header,
    workspace:  workspace,
    navigation: navigation,
    widgets:    widgets
  };

})();
