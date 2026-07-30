// =====================================================
// MYTHOS OS — Plugin SDK
// js/core/plugin-sdk.js
//
// Fluent builder for creating Platform-compatible plugin
// manifests without hand-writing them.
//
// Usage (basic):
//   Plugin.create({
//     id: 'my-plugin', label: 'My Plugin',
//     version: '1.0.0', type: 'business'
//   })
//   .defineMenu({ section: 'My Section', order: 5 })
//   .defineRoutes([{ id: 'my-view', label: 'My View', icon: '📋' }])
//   .defineStorage(['mp_my_data'])
//   .build();
//
// build() returns { manifest, registered }
//   manifest   — complete assembled manifest object
//   registered — true if Platform.registerPlugin() accepted it
//
// SDK extensions (widgets, permissions, settings, search,
// calendar, dashboard) are stored as extra keys on the
// manifest. Platform ignores unknown keys; they are
// available for future consumers (Shell, search layer, etc.).
//
// Depends on: Platform (js/core/platform.js) [at build() time]
//             Shell    (js/core/shell.js)     [at build() time, optional]
// Loaded:     blocking, after js/core/shell.js and before plugin files
// =====================================================

var Plugin = (function () {

  // ── Validation constraints ────────────────────────────────────────
  var _REQUIRED   = ['id', 'label', 'version', 'type'];
  var _VALID_TYPES = { core: true, shared: true, business: true };
  var _ID_RE      = /^[a-z][a-z0-9-]*$/;
  var _VER_RE     = /^\d+\.\d+\.\d+/;      // semver prefix

  // ── Private helpers ───────────────────────────────────────────────
  function _copyShallow(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var c = {}, keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) { c[keys[i]] = obj[keys[i]]; }
    return c;
  }

  function _sdkErr(method, msg) {
    throw new Error('[Plugin SDK] ' + (method ? method + '(): ' : '') + msg);
  }

  // ── Validation ────────────────────────────────────────────────────
  function _validate(base) {
    if (!base || typeof base !== 'object') return 'manifest must be a plain object';
    for (var i = 0; i < _REQUIRED.length; i++) {
      var k = _REQUIRED[i];
      if (base[k] === undefined || base[k] === null)
        return '"' + k + '" is required';
    }
    if (typeof base.id !== 'string' || !_ID_RE.test(base.id))
      return '"id" must be kebab-case (^[a-z][a-z0-9-]*)';
    if (typeof base.label !== 'string' || !base.label.trim())
      return '"label" must be a non-empty string';
    if (!_VALID_TYPES[base.type])
      return '"type" must be "core", "shared", or "business"';
    if (typeof base.version !== 'string' || !_VER_RE.test(base.version))
      return '"version" must follow semver format (e.g. "1.0.0")';
    if (base.onBoot  !== undefined && typeof base.onBoot  !== 'function')
      return '"onBoot" must be a function';
    if (base.onReady !== undefined && typeof base.onReady !== 'function')
      return '"onReady" must be a function';
    return null;
  }

  // ── PluginBuilder ────────────────────────────────────────────────
  function PluginBuilder(base) {
    this._id      = base.id;
    this._label   = base.label;
    this._version = base.version;
    this._type    = base.type;
    this._onBoot  = typeof base.onBoot  === 'function' ? base.onBoot  : null;
    this._onReady = typeof base.onReady === 'function' ? base.onReady : null;

    // Optional sections
    this._menu        = null;
    this._routes      = null;
    this._storageKeys = null;
    this._widgets     = null;
    this._permissions = null;
    this._settings    = null;
    this._search      = null;
    this._calendar    = null;
    this._dashboard   = null;

    // Duplicate-definition guard
    this._called = {};
  }

  function _once(builder, name) {
    if (builder._called[name]) {
      _sdkErr(null, '"' + name + '" already defined for plugin "' + builder._id + '"');
    }
    builder._called[name] = true;
  }

  // ── defineMenu(config) ───────────────────────────────────────────
  // config: { section?, order?, icon? }
  PluginBuilder.prototype.defineMenu = function (config) {
    if (!config || typeof config !== 'object') {
      _sdkErr('defineMenu', 'config must be a plain object');
    }
    _once(this, 'defineMenu');
    this._menu = {
      section: typeof config.section === 'string' && config.section
                 ? config.section : this._label,
      order: typeof config.order === 'number' ? config.order : 99,
      icon:  typeof config.icon  === 'string' ? config.icon  : ''
    };
    return this;
  };

  // ── defineRoutes(routes) ─────────────────────────────────────────
  // routes: Array<{ id, label?, icon?, render? }>
  PluginBuilder.prototype.defineRoutes = function (routes) {
    if (!Array.isArray(routes)) {
      _sdkErr('defineRoutes', 'argument must be an array');
    }
    _once(this, 'defineRoutes');
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (!r || typeof r !== 'object') {
        _sdkErr('defineRoutes', 'item [' + i + '] must be an object');
      }
      if (typeof r.id !== 'string' || !r.id) {
        _sdkErr('defineRoutes', 'item [' + i + '] is missing required "id"');
      }
    }
    this._routes = routes.map(_copyShallow);
    return this;
  };

  // ── defineStorage(keys) ──────────────────────────────────────────
  // keys: string[]  — localStorage key names owned by this plugin
  PluginBuilder.prototype.defineStorage = function (keys) {
    if (!Array.isArray(keys)) {
      _sdkErr('defineStorage', 'argument must be an array');
    }
    _once(this, 'defineStorage');
    for (var i = 0; i < keys.length; i++) {
      if (typeof keys[i] !== 'string' || !keys[i]) {
        _sdkErr('defineStorage', 'key [' + i + '] must be a non-empty string');
      }
    }
    this._storageKeys = keys.slice();
    return this;
  };

  // ── defineWidgets(widgets) ───────────────────────────────────────
  // widgets: Array<{ id, label?, zone?, render?, order? }>
  PluginBuilder.prototype.defineWidgets = function (widgets) {
    if (!Array.isArray(widgets)) {
      _sdkErr('defineWidgets', 'argument must be an array');
    }
    _once(this, 'defineWidgets');
    for (var i = 0; i < widgets.length; i++) {
      var w = widgets[i];
      if (!w || typeof w !== 'object') {
        _sdkErr('defineWidgets', 'item [' + i + '] must be an object');
      }
      if (typeof w.id !== 'string' || !w.id) {
        _sdkErr('defineWidgets', 'item [' + i + '] is missing required "id"');
      }
    }
    this._widgets = widgets.map(_copyShallow);
    return this;
  };

  // ── definePermissions(config) ────────────────────────────────────
  // config: { roles?: string[], requireAuth?: boolean }
  PluginBuilder.prototype.definePermissions = function (config) {
    if (!config || typeof config !== 'object') {
      _sdkErr('definePermissions', 'config must be a plain object');
    }
    _once(this, 'definePermissions');
    this._permissions = _copyShallow(config);
    return this;
  };

  // ── defineSettings(settings) ─────────────────────────────────────
  // settings: Array<{ key, label?, type?, default? }>
  PluginBuilder.prototype.defineSettings = function (settings) {
    if (!Array.isArray(settings)) {
      _sdkErr('defineSettings', 'argument must be an array');
    }
    _once(this, 'defineSettings');
    for (var i = 0; i < settings.length; i++) {
      var s = settings[i];
      if (!s || typeof s !== 'object') {
        _sdkErr('defineSettings', 'item [' + i + '] must be an object');
      }
      if (typeof s.key !== 'string' || !s.key) {
        _sdkErr('defineSettings', 'item [' + i + '] is missing required "key"');
      }
    }
    this._settings = settings.map(_copyShallow);
    return this;
  };

  // ── defineSearch(config) ─────────────────────────────────────────
  // config: { handler?: function(query:string) → Array }
  PluginBuilder.prototype.defineSearch = function (config) {
    if (!config || typeof config !== 'object') {
      _sdkErr('defineSearch', 'config must be a plain object');
    }
    _once(this, 'defineSearch');
    if (config.handler !== undefined && typeof config.handler !== 'function') {
      _sdkErr('defineSearch', '"handler" must be a function');
    }
    this._search = _copyShallow(config);
    return this;
  };

  // ── defineCalendar(config) ───────────────────────────────────────
  // config: { provider?: function(range:{start,end}) → Array }
  PluginBuilder.prototype.defineCalendar = function (config) {
    if (!config || typeof config !== 'object') {
      _sdkErr('defineCalendar', 'config must be a plain object');
    }
    _once(this, 'defineCalendar');
    if (config.provider !== undefined && typeof config.provider !== 'function') {
      _sdkErr('defineCalendar', '"provider" must be a function');
    }
    this._calendar = _copyShallow(config);
    return this;
  };

  // ── defineDashboard(config) ──────────────────────────────────────
  // config: { tiles?: Array<{ id, label?, render? }> }
  PluginBuilder.prototype.defineDashboard = function (config) {
    if (!config || typeof config !== 'object') {
      _sdkErr('defineDashboard', 'config must be a plain object');
    }
    _once(this, 'defineDashboard');
    this._dashboard = _copyShallow(config);
    return this;
  };

  // ── build() ──────────────────────────────────────────────────────
  // Assembles the manifest and registers with Platform + Shell.
  // Returns { manifest, registered }.
  PluginBuilder.prototype.build = function () {
    var manifest = {};

    // Required base fields
    manifest.id      = this._id;
    manifest.label   = this._label;
    manifest.version = this._version;
    manifest.type    = this._type;

    // Lifecycle hooks
    if (this._onBoot)  manifest.onBoot  = this._onBoot;
    if (this._onReady) manifest.onReady = this._onReady;

    // Platform-standard optional fields
    if (this._menu)        manifest.menu        = _copyShallow(this._menu);
    if (this._routes)      manifest.routes      = this._routes.map(_copyShallow);
    if (this._storageKeys) manifest.storageKeys = this._storageKeys.slice();

    // SDK-extended fields (Platform ignores unknown keys)
    if (this._widgets)     manifest.widgets     = this._widgets.map(_copyShallow);
    if (this._permissions) manifest.permissions = _copyShallow(this._permissions);
    if (this._settings)    manifest.settings    = this._settings.map(_copyShallow);
    if (this._search)      manifest.search      = _copyShallow(this._search);
    if (this._calendar)    manifest.calendar    = _copyShallow(this._calendar);
    if (this._dashboard)   manifest.dashboard   = _copyShallow(this._dashboard);

    // Register with Platform if available
    var registered = false;
    if (typeof Platform !== 'undefined' &&
        typeof Platform.registerPlugin === 'function') {
      registered = Platform.registerPlugin(manifest) !== false;
    }

    // Register widgets with Shell.widgets if available
    if (this._widgets &&
        typeof Shell !== 'undefined' &&
        Shell.widgets && typeof Shell.widgets.register === 'function') {
      var ws = this._widgets;
      for (var i = 0; i < ws.length; i++) {
        Shell.widgets.register(ws[i]);
      }
    }

    return { manifest: _copyShallow(manifest), registered: registered };
  };

  // ── Public API ────────────────────────────────────────────────────
  return {
    create: function (base) {
      var err = _validate(base);
      if (err) { _sdkErr('create', err); }
      return new PluginBuilder(base);
    },
    validate: _validate
  };

})();
