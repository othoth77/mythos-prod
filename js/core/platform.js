// =====================================================
// MYTHOS OS — Platform Registry  (js/core/platform.js)
// Plugin registration, lifecycle, and discovery.
// Depends on: js/core/events.js
// Loaded after: utils.js, events.js, storage.js, api.js
//
// Lifecycle:
//   Platform.boot()   — call once after all scripts load
//   Platform.ready()  — call after first sync completes
//
// Events emitted:
//   mythos:boot                { ts }
//   mythos:plugin:registered   { id, label, type }
//   mythos:plugin:booted       { id }
//   mythos:ready               { ts, plugins: [id, ...] }
// =====================================================

var Platform = (function () {

  // ── Private state ─────────────────────────────────────────────────────
  var _plugins   = {};          // id → manifest
  var _bootOrder = [];          // insertion order
  var _phase     = 'init';      // 'init' | 'booted' | 'ready'

  // ── Required manifest fields ──────────────────────────────────────────
  var REQUIRED = ['id', 'label', 'version', 'type'];
  var VALID_TYPES = { core: true, shared: true, business: true };

  // ── Validate a manifest before accepting it ───────────────────────────
  function _validate(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      return 'manifest must be an object';
    }
    for (var i = 0; i < REQUIRED.length; i++) {
      var field = REQUIRED[i];
      if (!manifest[field] && manifest[field] !== 0) {
        return 'missing required field: "' + field + '"';
      }
    }
    if (typeof manifest.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
      return '"id" must be a lowercase kebab-case string (e.g. "prod-invoices")';
    }
    if (!VALID_TYPES[manifest.type]) {
      return '"type" must be one of: core, shared, business (got "' + manifest.type + '")';
    }
    if (typeof manifest.version !== 'string') {
      return '"version" must be a string (e.g. "1.0.0")';
    }
    return null; // valid
  }

  // ── Return a safe copy of a manifest (strip internal-only props) ──────
  function _safeCopy(manifest) {
    var copy = {};
    var keys = Object.keys(manifest);
    for (var i = 0; i < keys.length; i++) {
      copy[keys[i]] = manifest[keys[i]];
    }
    return copy;
  }

  // ── registerPlugin(manifest) ──────────────────────────────────────────
  // Validates the manifest, records it, and emits mythos:plugin:registered.
  // Returns true on success, false on failure (logs reason).
  function registerPlugin(manifest) {
    var err = _validate(manifest);
    if (err) {
      console.error('[Platform] registerPlugin() rejected "' + (manifest && manifest.id) + '": ' + err);
      return false;
    }
    if (_plugins[manifest.id]) {
      console.error('[Platform] Duplicate plugin ID: "' + manifest.id + '" — ignoring second registration.');
      return false;
    }

    _plugins[manifest.id] = manifest;
    _bootOrder.push(manifest.id);

    Events.emit('mythos:plugin:registered', {
      id:    manifest.id,
      label: manifest.label,
      type:  manifest.type
    });

    console.log('[Platform] Plugin registered: ' + manifest.id + ' v' + manifest.version
      + ' (' + manifest.type + ')');
    return true;
  }

  // ── getPlugin(id) ─────────────────────────────────────────────────────
  // Returns a safe copy of the manifest, or null if not found.
  function getPlugin(id) {
    return _plugins[id] ? _safeCopy(_plugins[id]) : null;
  }

  // ── getPlugins() ──────────────────────────────────────────────────────
  // Returns safe copies of all manifests in registration order.
  function getPlugins() {
    return _bootOrder.map(function (id) { return _safeCopy(_plugins[id]); });
  }

  // ── hasPlugin(id) ─────────────────────────────────────────────────────
  function hasPlugin(id) {
    return Object.prototype.hasOwnProperty.call(_plugins, id);
  }

  // ── boot() ────────────────────────────────────────────────────────────
  // Called once after all <script> tags have executed.
  // Runs each plugin's onBoot() hook (errors isolated per plugin).
  // Idempotent: calling boot() more than once is a no-op after the first call.
  function boot() {
    if (_phase !== 'init') {
      console.warn('[Platform] boot() called after phase "' + _phase + '" — ignored.');
      return;
    }
    _phase = 'booted';
    Events.emit('mythos:boot', { ts: new Date().toISOString() });

    for (var i = 0; i < _bootOrder.length; i++) {
      var id  = _bootOrder[i];
      var mf  = _plugins[id];
      if (typeof mf.onBoot === 'function') {
        try {
          mf.onBoot();
        } catch (e) {
          console.error('[Platform] Error in onBoot() of plugin "' + id + '":', e);
        }
      }
      Events.emit('mythos:plugin:booted', { id: id });
    }

    console.log('[Platform] boot() complete — ' + _bootOrder.length + ' plugin(s).');
  }

  // ── ready() ───────────────────────────────────────────────────────────
  // Called after the first successful sync and app bootstrap.
  // Runs each plugin's onReady() hook.
  // Idempotent: calling ready() more than once is a no-op after the first call.
  function ready() {
    if (_phase === 'ready') {
      console.warn('[Platform] ready() called more than once — ignored.');
      return;
    }
    if (_phase === 'init') {
      // boot() was skipped — run it now so lifecycle stays consistent
      boot();
    }
    _phase = 'ready';

    for (var i = 0; i < _bootOrder.length; i++) {
      var id  = _bootOrder[i];
      var mf  = _plugins[id];
      if (typeof mf.onReady === 'function') {
        try {
          mf.onReady();
        } catch (e) {
          console.error('[Platform] Error in onReady() of plugin "' + id + '":', e);
        }
      }
    }

    Events.emit('mythos:ready', {
      ts:      new Date().toISOString(),
      plugins: _bootOrder.slice()
    });

    console.log('[Platform] ready() — platform fully initialised.');
  }

  // ── phase() ───────────────────────────────────────────────────────────
  // Returns the current lifecycle phase: 'init' | 'booted' | 'ready'.
  function phase() { return _phase; }

  // ── Public surface ────────────────────────────────────────────────────
  return {
    registerPlugin: registerPlugin,
    getPlugin:      getPlugin,
    getPlugins:     getPlugins,
    hasPlugin:      hasPlugin,
    boot:           boot,
    ready:          ready,
    phase:          phase
  };

})();
