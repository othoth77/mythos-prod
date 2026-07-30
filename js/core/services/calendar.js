// =====================================================
// MYTHOS OS — Calendar Service
// js/core/services/calendar.js
//
// Central registry for calendar event providers.
//
// Provider schema:
//   { id, label?, order?, getEvents: fn(range, ctx?) -> Array|Promise }
//
// range: { start?: ISO-string|Date, end?: ISO-string|Date }
//
// Normalized event schema:
//   { id, providerId, title, start, end, allDay, route, data }
//
// getEvents() always returns Promise<NormalizedEvent[]>, sorted by start.
// 'date' is accepted as an alias for 'start' in raw events.
// One failing provider never breaks other providers.
//
// Depends on: nothing
// Loaded: blocking, after search.js, before plugin-services.js
// =====================================================

var MythosCalendar = (function () {

  var _providers = {};
  var _order     = [];

  function _normalizeEvent(raw, providerId) {
    if (!raw || typeof raw !== 'object') return null;
    var start = raw.start || raw.date || null;
    return {
      id:         (typeof raw.id === 'string' && raw.id)
                    ? raw.id
                    : (providerId + '-' + Math.random().toString(36).slice(2)),
      providerId: providerId,
      title:      typeof raw.title === 'string' ? raw.title : '',
      start:      start,
      end:        raw.end  || null,
      allDay:     raw.allDay !== undefined ? !!raw.allDay : true,
      route:      typeof raw.route === 'string' ? raw.route : null,
      data:       raw.data !== undefined ? raw.data : null
    };
  }

  function registerProvider(config) {
    if (!config || typeof config !== 'object') return false;
    if (typeof config.id !== 'string' || !config.id) return false;
    if (typeof config.getEvents !== 'function') return false;
    if (Object.prototype.hasOwnProperty.call(_providers, config.id)) {
      console.warn('[MythosCalendar] Provider "' + config.id + '" already registered - ignored.');
      return false;
    }
    _providers[config.id] = {
      id:        config.id,
      label:     typeof config.label === 'string' ? config.label : config.id,
      order:     typeof config.order === 'number' ? config.order : 99,
      disabled:  !!config.disabled,
      getEvents: config.getEvents
    };
    _order.push(config.id);
    return true;
  }

  function unregisterProvider(id) {
    if (!Object.prototype.hasOwnProperty.call(_providers, id)) return false;
    delete _providers[id];
    _order = _order.filter(function (x) { return x !== id; });
    return true;
  }

  function hasProvider(id) {
    return Object.prototype.hasOwnProperty.call(_providers, id);
  }

  function getProviders() {
    return _order.map(function (id) {
      var p = _providers[id];
      return { id: p.id, label: p.label, order: p.order, disabled: p.disabled };
    });
  }

  function _validateRange(range) {
    return !!(range && typeof range === 'object' && (range.start || range.end));
  }

  function getEvents(range, context) {
    if (!_validateRange(range)) {
      return Promise.reject(new Error('[MythosCalendar] getEvents() requires a valid range object'));
    }

    var sorted = _order.slice().sort(function (a, b) {
      return _providers[a].order - _providers[b].order;
    });

    var promises = sorted.map(function (id) {
      var p = _providers[id];
      if (p.disabled) return Promise.resolve([]);
      try {
        var raw = p.getEvents(range, context);
        var prom = (raw && typeof raw.then === 'function')
          ? raw : Promise.resolve(Array.isArray(raw) ? raw : []);
        return prom
          .then(function (events) {
            if (!Array.isArray(events)) return [];
            return events
              .map(function (e) { return _normalizeEvent(e, id); })
              .filter(Boolean);
          })
          .catch(function (e) {
            console.error('[MythosCalendar] Provider "' + id + '" async error:', e);
            return [];
          });
      } catch (e) {
        console.error('[MythosCalendar] Provider "' + id + '" error:', e);
        return Promise.resolve([]);
      }
    });

    return Promise.all(promises).then(function (groups) {
      var out = [];
      for (var i = 0; i < groups.length; i++) {
        for (var j = 0; j < groups[i].length; j++) out.push(groups[i][j]);
      }
      out.sort(function (a, b) {
        var da = a.start ? new Date(a.start).getTime() : 0;
        var db = b.start ? new Date(b.start).getTime() : 0;
        return da - db;
      });
      return out;
    });
  }

  return {
    registerProvider:   registerProvider,
    unregisterProvider: unregisterProvider,
    hasProvider:        hasProvider,
    getProviders:       getProviders,
    getEvents:          getEvents
  };

})();
