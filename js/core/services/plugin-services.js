// =====================================================
// MYTHOS OS — Plugin Services Integration
// js/core/services/plugin-services.js
//
// Bridges plugin manifests to runtime services.
// Listens to 'mythos:plugin:registered' and wires:
//   manifest.search.handler    -> MythosSearch.registerProvider()
//   manifest.calendar.provider -> MythosCalendar.registerProvider()
//   manifest.widgets[]         -> MythosWidgets.register()
//
// Services that are absent cause no errors.
// Each plugin is consumed at most once (guarded by _consumed).
//
// Depends on: Events, Platform, MythosSearch, MythosCalendar, MythosWidgets
// Loaded: blocking, after all services, before plugin-sdk.js
// =====================================================

var PluginServices = (function () {

  var _consumed = {};

  function _consume(manifest) {
    if (!manifest || !manifest.id) return;
    if (_consumed[manifest.id]) return;
    _consumed[manifest.id] = true;

    if (manifest.search &&
        typeof manifest.search.handler === 'function' &&
        typeof MythosSearch !== 'undefined' &&
        !MythosSearch.hasProvider(manifest.id)) {
      MythosSearch.registerProvider({
        id:     manifest.id,
        label:  manifest.label,
        order:  manifest.menu && typeof manifest.menu.order === 'number'
                  ? manifest.menu.order : 99,
        search: manifest.search.handler
      });
    }

    if (manifest.calendar &&
        typeof manifest.calendar.provider === 'function' &&
        typeof MythosCalendar !== 'undefined' &&
        !MythosCalendar.hasProvider(manifest.id)) {
      MythosCalendar.registerProvider({
        id:        manifest.id,
        label:     manifest.label,
        order:     manifest.menu && typeof manifest.menu.order === 'number'
                     ? manifest.menu.order : 99,
        getEvents: manifest.calendar.provider
      });
    }

    if (manifest.widgets && Array.isArray(manifest.widgets) &&
        typeof MythosWidgets !== 'undefined') {
      for (var i = 0; i < manifest.widgets.length; i++) {
        var w = manifest.widgets[i];
        if (w && w.id && !MythosWidgets.has(w.id)) {
          MythosWidgets.register(w);
        }
      }
    }
  }

  if (typeof Events !== 'undefined' && typeof Events.on === 'function') {
    Events.on('mythos:plugin:registered', function (data) {
      if (typeof Platform !== 'undefined' &&
          typeof Platform.getPlugin === 'function') {
        var manifest = Platform.getPlugin(data.id);
        if (manifest) _consume(manifest);
      }
    });
  }

  return { consume: _consume };

})();
