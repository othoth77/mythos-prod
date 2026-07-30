// =====================================================
// MYTHOS OS — Search Service
// js/core/services/search.js
//
// Central registry for search providers. Plugins register
// handlers via PluginServices; consumers call search().
//
// Provider schema:
//   { id, label?, order?, disabled?, search: fn(query, ctx?) -> Array|Promise }
//
// Normalized result schema:
//   { id, providerId, type, title, subtitle, route, data, score }
//
// search() always returns Promise<NormalizedResult[]>.
// One failing provider never breaks other providers.
//
// Depends on: nothing
// Loaded: blocking, after shell.js, before plugin-services.js
// =====================================================

var MythosSearch = (function () {

  var _providers = {};
  var _order     = [];

  function _normalizeResult(raw, providerId) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      id:         (typeof raw.id === 'string' && raw.id)
                    ? raw.id
                    : (providerId + '-' + Math.random().toString(36).slice(2)),
      providerId: providerId,
      type:       typeof raw.type     === 'string' ? raw.type     : 'result',
      title:      typeof raw.title    === 'string' ? raw.title
                    : (typeof raw.label === 'string' ? raw.label  : ''),
      subtitle:   typeof raw.subtitle === 'string' ? raw.subtitle : '',
      route:      typeof raw.route    === 'string' ? raw.route    : null,
      data:       raw.data  !== undefined          ? raw.data     : null,
      score:      typeof raw.score    === 'number' ? raw.score    : 0
    };
  }

  function registerProvider(config) {
    if (!config || typeof config !== 'object') return false;
    if (typeof config.id !== 'string' || !config.id) return false;
    if (typeof config.search !== 'function') return false;
    if (Object.prototype.hasOwnProperty.call(_providers, config.id)) {
      console.warn('[MythosSearch] Provider "' + config.id + '" already registered - ignored.');
      return false;
    }
    _providers[config.id] = {
      id:       config.id,
      label:    typeof config.label === 'string' ? config.label : config.id,
      order:    typeof config.order === 'number' ? config.order : 99,
      disabled: !!config.disabled,
      search:   config.search
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

  function search(query, context) {
    var sorted = _order.slice().sort(function (a, b) {
      return _providers[a].order - _providers[b].order;
    });

    var promises = sorted.map(function (id) {
      var p = _providers[id];
      if (p.disabled) return Promise.resolve([]);
      try {
        var raw = p.search(query, context);
        var prom = (raw && typeof raw.then === 'function')
          ? raw : Promise.resolve(Array.isArray(raw) ? raw : []);
        return prom
          .then(function (results) {
            if (!Array.isArray(results)) return [];
            return results
              .map(function (r) { return _normalizeResult(r, id); })
              .filter(Boolean);
          })
          .catch(function (e) {
            console.error('[MythosSearch] Provider "' + id + '" async error:', e);
            return [];
          });
      } catch (e) {
        console.error('[MythosSearch] Provider "' + id + '" error:', e);
        return Promise.resolve([]);
      }
    });

    return Promise.all(promises).then(function (groups) {
      var out = [];
      for (var i = 0; i < groups.length; i++) {
        for (var j = 0; j < groups[i].length; j++) out.push(groups[i][j]);
      }
      return out;
    });
  }

  return {
    registerProvider:   registerProvider,
    unregisterProvider: unregisterProvider,
    hasProvider:        hasProvider,
    getProviders:       getProviders,
    search:             search
  };

})();
