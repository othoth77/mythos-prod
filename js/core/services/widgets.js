// =====================================================
// MYTHOS OS — Widgets Service
// js/core/services/widgets.js
//
// Central registry for dashboard zone widgets.
// Compatible with Shell.widgets — registrations are
// mirrored there when Shell is available.
//
// Widget schema:
//   { id, label?, zone?, order?, render?: fn(context?) }
//
// getAll() returns metadata copies (render fn excluded).
// render() calls the widget fn and isolates errors.
//
// Depends on: Shell (optional)
// Loaded: blocking, after calendar.js, before plugin-services.js
// =====================================================

var MythosWidgets = (function () {

  var _widgets = {};
  var _order   = [];

  function register(config) {
    if (!config || typeof config !== 'object') return false;
    if (typeof config.id !== 'string' || !config.id) return false;
    if (Object.prototype.hasOwnProperty.call(_widgets, config.id)) {
      console.warn('[MythosWidgets] Widget "' + config.id + '" already registered - ignored.');
      return false;
    }
    _widgets[config.id] = {
      id:     config.id,
      label:  typeof config.label  === 'string'   ? config.label  : config.id,
      zone:   typeof config.zone   === 'string'   ? config.zone   : 'dashboard',
      order:  typeof config.order  === 'number'   ? config.order  : 99,
      render: typeof config.render === 'function' ? config.render : null
    };
    _order.push(config.id);

    if (typeof Shell !== 'undefined' &&
        Shell.widgets &&
        typeof Shell.widgets.register  === 'function' &&
        typeof Shell.widgets.hasWidget === 'function' &&
        !Shell.widgets.hasWidget(config.id)) {
      Shell.widgets.register(config);
    }
    return true;
  }

  function unregister(id) {
    if (!Object.prototype.hasOwnProperty.call(_widgets, id)) return false;
    delete _widgets[id];
    _order = _order.filter(function (x) { return x !== id; });
    return true;
  }

  function has(id) {
    return Object.prototype.hasOwnProperty.call(_widgets, id);
  }

  function getAll(zone) {
    var list = _order.map(function (id) {
      var w = _widgets[id];
      return { id: w.id, label: w.label, zone: w.zone, order: w.order };
    });
    if (typeof zone === 'string') {
      list = list.filter(function (w) { return w.zone === zone; });
    }
    return list.sort(function (a, b) { return a.order - b.order; });
  }

  function render(id, context) {
    var w = _widgets[id];
    if (!w || typeof w.render !== 'function') return null;
    try {
      return w.render(context !== undefined ? context : {});
    } catch (e) {
      console.error('[MythosWidgets] render() error for "' + id + '":', e);
      return null;
    }
  }

  return {
    register:   register,
    unregister: unregister,
    has:        has,
    getAll:     getAll,
    render:     render
  };

})();
