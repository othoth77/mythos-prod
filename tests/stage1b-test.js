'use strict';
// =====================================================
// MYTHOS OS — Stage 1B automated tests
// Covers: Events (on/off/once/emit/isolation)
//         Platform (register/lookup/lifecycle)
//
// Runs in Node.js 22+ (no browser globals needed).
// =====================================================

// ── Paste-in implementations (self-contained for Node) ────────────────

var Events = (function () {
  var _listeners = {};
  function on(eventName, handler) {
    if (typeof eventName !== 'string' || !eventName) return function () {};
    if (typeof handler !== 'function') return function () {};
    if (!_listeners[eventName]) _listeners[eventName] = [];
    _listeners[eventName].push(handler);
    return function () { off(eventName, handler); };
  }
  function off(eventName, handler) {
    if (!_listeners[eventName]) return;
    _listeners[eventName] = _listeners[eventName].filter(function (h) { return h !== handler; });
    if (_listeners[eventName].length === 0) delete _listeners[eventName];
  }
  function once(eventName, handler) {
    if (typeof handler !== 'function') return function () {};
    function wrapper(payload) { off(eventName, wrapper); handler(payload); }
    wrapper._original = handler;
    return on(eventName, wrapper);
  }
  function emit(eventName, payload) {
    if (typeof eventName !== 'string' || !eventName) return;
    var handlers = (_listeners[eventName] || []).slice();
    for (var i = 0; i < handlers.length; i++) {
      try { handlers[i](payload); }
      catch (e) { /* isolated */ }
    }
  }
  function _listenerCount(n) { return (_listeners[n] || []).length; }
  function _eventNames()     { return Object.keys(_listeners); }
  return { on: on, off: off, once: once, emit: emit,
           _listenerCount: _listenerCount, _eventNames: _eventNames };
})();

// Platform factory — creates a fresh instance per test group
// so lifecycle state doesn't bleed between tests
function makePlatform() {
  var _plugins   = {};
  var _bootOrder = [];
  var _phase     = 'init';
  var REQUIRED   = ['id', 'label', 'version', 'type'];
  var VALID_TYPES = { core: true, shared: true, business: true };

  function _validate(m) {
    if (!m || typeof m !== 'object') return 'manifest must be an object';
    for (var i = 0; i < REQUIRED.length; i++) {
      if (!m[REQUIRED[i]] && m[REQUIRED[i]] !== 0) return 'missing required field: "' + REQUIRED[i] + '"';
    }
    if (typeof m.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(m.id))
      return '"id" must be a lowercase kebab-case string';
    if (!VALID_TYPES[m.type]) return '"type" must be core | shared | business';
    if (typeof m.version !== 'string') return '"version" must be a string';
    return null;
  }
  function _safeCopy(m) {
    var c = {}, k = Object.keys(m);
    for (var i = 0; i < k.length; i++) c[k[i]] = m[k[i]];
    return c;
  }
  function registerPlugin(manifest) {
    var err = _validate(manifest);
    if (err) return false;
    if (_plugins[manifest.id]) return false;
    _plugins[manifest.id] = manifest;
    _bootOrder.push(manifest.id);
    Events.emit('mythos:plugin:registered', { id: manifest.id, label: manifest.label, type: manifest.type });
    return true;
  }
  function getPlugin(id)  { return _plugins[id] ? _safeCopy(_plugins[id]) : null; }
  function getPlugins()   { return _bootOrder.map(function (id) { return _safeCopy(_plugins[id]); }); }
  function hasPlugin(id)  { return Object.prototype.hasOwnProperty.call(_plugins, id); }
  function boot() {
    if (_phase !== 'init') return;
    _phase = 'booted';
    Events.emit('mythos:boot', { ts: new Date().toISOString() });
    for (var i = 0; i < _bootOrder.length; i++) {
      var id = _bootOrder[i], mf = _plugins[id];
      if (typeof mf.onBoot === 'function') { try { mf.onBoot(); } catch(e) {} }
      Events.emit('mythos:plugin:booted', { id: id });
    }
  }
  function ready() {
    if (_phase === 'ready') return;
    if (_phase === 'init') boot();
    _phase = 'ready';
    for (var i = 0; i < _bootOrder.length; i++) {
      var id = _bootOrder[i], mf = _plugins[id];
      if (typeof mf.onReady === 'function') { try { mf.onReady(); } catch(e) {} }
    }
    Events.emit('mythos:ready', { ts: new Date().toISOString(), plugins: _bootOrder.slice() });
  }
  function phase() { return _phase; }
  return { registerPlugin: registerPlugin, getPlugin: getPlugin, getPlugins: getPlugins,
           hasPlugin: hasPlugin, boot: boot, ready: ready, phase: phase };
}

// ── Test harness ──────────────────────────────────────────────────────
var pass = 0, fail = 0, results = [];
function check(label, cond) {
  if (cond) { pass++; results.push({ ok: true,  label: label });
              console.log('  PASS: ' + label); }
  else       { fail++; results.push({ ok: false, label: label });
              console.error('  FAIL: ' + label); }
}

// ══════════════════════════════════════════════════════════════════════
// EVENT BUS TESTS
// ══════════════════════════════════════════════════════════════════════
console.log('\n── Events ────────────────────────────────────────────────');

// [1] on + emit: handler receives payload
var got1;
Events.on('test:a', function (p) { got1 = p; });
Events.emit('test:a', { x: 1 });
check('emit delivers payload to handler', got1 && got1.x === 1);

// [2] Multiple handlers for same event, both called
var c2a = 0, c2b = 0;
Events.on('test:b', function () { c2a++; });
Events.on('test:b', function () { c2b++; });
Events.emit('test:b');
check('multiple handlers: both called', c2a === 1 && c2b === 1);

// [3] off: handler stops receiving after unsubscribe
var c3 = 0;
function h3() { c3++; }
Events.on('test:c', h3);
Events.emit('test:c');
Events.off('test:c', h3);
Events.emit('test:c');
check('off: handler stops after unsubscribe', c3 === 1);

// [4] off with unregistered handler is a no-op (no throw)
var threw4 = false;
try { Events.off('test:never', function(){}); } catch(e) { threw4 = true; }
check('off with unknown handler is a no-op', !threw4);

// [5] unsubscribe via returned function
var c5 = 0;
var unsub5 = Events.on('test:d', function() { c5++; });
Events.emit('test:d');
unsub5();
Events.emit('test:d');
check('on() returns working unsubscribe function', c5 === 1);

// [6] once: fires exactly once
var c6 = 0;
Events.once('test:e', function() { c6++; });
Events.emit('test:e');
Events.emit('test:e');
check('once: handler fires exactly once', c6 === 1);

// [7] once: listener removed after first emit (_listenerCount drops to 0)
Events.once('test:f', function() {});
Events.emit('test:f');
check('once: listener count is 0 after first emit',
  Events._listenerCount('test:f') === 0);

// [8] emit with no subscribers is a no-op (no throw)
var threw8 = false;
try { Events.emit('test:nobody', { data: 'x' }); } catch(e) { threw8 = true; }
check('emit with no subscribers does not throw', !threw8);

// [9] Handler error isolation: second handler still called when first throws
var c9 = 0;
Events.on('test:g', function() { throw new Error('boom'); });
Events.on('test:g', function() { c9++; });
Events.emit('test:g');
check('handler error isolation: subsequent handlers still run', c9 === 1);

// [10] Multiple errors isolated: all non-throwing handlers run
var c10 = 0;
Events.on('test:h', function() { throw new Error('e1'); });
Events.on('test:h', function() { throw new Error('e2'); });
Events.on('test:h', function() { c10++; });
Events.emit('test:h');
check('multiple handler errors all isolated, clean handler runs', c10 === 1);

// [11] emit payload is passed through unchanged
var got11;
Events.on('test:i', function(p) { got11 = p; });
var obj11 = { a: 1, b: [2, 3] };
Events.emit('test:i', obj11);
check('emit payload reference is preserved', got11 === obj11);

// [12] on with non-string event name: no throw, returns unsubscribe
var threw12 = false, unsub12;
try { unsub12 = Events.on(null, function(){}); } catch(e) { threw12 = true; }
check('on with null event name does not throw', !threw12);
check('on with null event name returns a function', typeof unsub12 === 'function');

// [13] on with non-function handler: no throw
var threw13 = false;
try { Events.on('test:j', 'not-a-function'); } catch(e) { threw13 = true; }
check('on with non-function handler does not throw', !threw13);

// ══════════════════════════════════════════════════════════════════════
// PLATFORM REGISTRY TESTS
// ══════════════════════════════════════════════════════════════════════
console.log('\n── Platform ──────────────────────────────────────────────');

var P = makePlatform();

var validManifest = {
  id:          'test-plugin',
  label:       'Test Plugin',
  version:     '1.0.0',
  type:        'business',
  storageKeys: ['mp_test'],
  routes:      [{ id: 'test', render: function(){} }]
};

// [14] Valid plugin registration returns true
check('registerPlugin: valid manifest returns true',
  P.registerPlugin(validManifest) === true);

// [15] Duplicate ID rejected
check('registerPlugin: duplicate ID returns false',
  P.registerPlugin(validManifest) === false);

// [16] hasPlugin: true for registered, false for unknown
check('hasPlugin: true after registration',  P.hasPlugin('test-plugin'));
check('hasPlugin: false for unknown plugin', !P.hasPlugin('nonexistent-xyz'));

// [17] getPlugin returns safe copy (not internal reference)
var copy = P.getPlugin('test-plugin');
check('getPlugin: returns an object',          copy !== null && typeof copy === 'object');
check('getPlugin: id matches',                 copy.id === 'test-plugin');
copy.id = 'mutated';
check('getPlugin: mutation of copy does not affect registry',
  P.getPlugin('test-plugin').id === 'test-plugin');

// [18] getPlugins: returns array of all registered plugins
var P2 = makePlatform();
P2.registerPlugin({ id: 'alpha', label: 'Alpha', version: '1', type: 'core' });
P2.registerPlugin({ id: 'beta',  label: 'Beta',  version: '1', type: 'shared' });
var all = P2.getPlugins();
check('getPlugins: returns correct count', all.length === 2);
check('getPlugins: preserves registration order', all[0].id === 'alpha' && all[1].id === 'beta');

// [19] getPlugin: returns null for unknown
check('getPlugin: returns null for unknown id', P.getPlugin('nope') === null);

// Manifest validation tests
console.log('\n── Manifest validation ───────────────────────────────────');

// [20] Missing required field
check('reject: missing "id"',
  makePlatform().registerPlugin({ label: 'X', version: '1', type: 'core' }) === false);

check('reject: missing "label"',
  makePlatform().registerPlugin({ id: 'x', version: '1', type: 'core' }) === false);

check('reject: missing "version"',
  makePlatform().registerPlugin({ id: 'x', label: 'X', type: 'core' }) === false);

check('reject: missing "type"',
  makePlatform().registerPlugin({ id: 'x', label: 'X', version: '1' }) === false);

// [21] Invalid type value
check('reject: invalid type "widget"',
  makePlatform().registerPlugin({ id: 'x', label: 'X', version: '1', type: 'widget' }) === false);

// [22] Invalid id format (uppercase)
check('reject: id with uppercase letters',
  makePlatform().registerPlugin({ id: 'MyPlugin', label: 'X', version: '1', type: 'core' }) === false);

// [23] Invalid id format (spaces)
check('reject: id with spaces',
  makePlatform().registerPlugin({ id: 'my plugin', label: 'X', version: '1', type: 'core' }) === false);

// [24] Valid kebab-case ids accepted
check('accept: id "prod-invoices"',
  makePlatform().registerPlugin({ id: 'prod-invoices', label: 'X', version: '1', type: 'business' }) === true);

check('accept: id "core1"',
  makePlatform().registerPlugin({ id: 'core1', label: 'X', version: '1', type: 'core' }) === true);

// [25] null manifest
check('reject: null manifest',
  makePlatform().registerPlugin(null) === false);

// [26] non-object manifest
check('reject: string manifest',
  makePlatform().registerPlugin('not-an-object') === false);

// ── Lifecycle tests ────────────────────────────────────────────────────
console.log('\n── Lifecycle ─────────────────────────────────────────────');

// [27] Initial phase is 'init'
var PL = makePlatform();
check('phase: initial value is "init"', PL.phase() === 'init');

// [28] After boot() phase is 'booted'
PL.boot();
check('phase: "booted" after boot()', PL.phase() === 'booted');

// [29] boot() is idempotent — second call is a no-op
PL.boot(); // should not throw or change phase
check('boot: idempotent — phase stays "booted" on second call', PL.phase() === 'booted');

// [30] After ready() phase is 'ready'
PL.ready();
check('phase: "ready" after ready()', PL.phase() === 'ready');

// [31] ready() is idempotent
PL.ready();
check('ready: idempotent — phase stays "ready" on second call', PL.phase() === 'ready');

// [32] onBoot hook called during boot()
var PB = makePlatform();
var bootCalled = false;
PB.registerPlugin({ id: 'b1', label: 'B1', version: '1', type: 'core',
                    onBoot: function() { bootCalled = true; } });
PB.boot();
check('onBoot hook called during boot()', bootCalled);

// [33] onReady hook called during ready()
var PR = makePlatform();
var readyCalled = false;
PR.registerPlugin({ id: 'r1', label: 'R1', version: '1', type: 'core',
                    onReady: function() { readyCalled = true; } });
PR.ready();  // calls boot() internally then ready()
check('onReady hook called during ready()', readyCalled);

// [34] onBoot error does not prevent other plugins from booting
var PE = makePlatform();
var secondBooted = false;
PE.registerPlugin({ id: 'err1', label: 'Err', version: '1', type: 'core',
                    onBoot: function() { throw new Error('boot failure'); } });
PE.registerPlugin({ id: 'ok1',  label: 'OK',  version: '1', type: 'shared',
                    onBoot: function() { secondBooted = true; } });
PE.boot();
check('onBoot error isolated: second plugin still boots', secondBooted);

// [35] Lifecycle events emitted in correct order
var PEv = makePlatform();
var lifecycle = [];
Events.on('mythos:boot',              function() { lifecycle.push('boot'); });
Events.on('mythos:plugin:registered', function(p) { lifecycle.push('registered:' + p.id); });
Events.on('mythos:plugin:booted',     function(p) { lifecycle.push('booted:' + p.id); });
Events.on('mythos:ready',             function() { lifecycle.push('ready'); });

PEv.registerPlugin({ id: 'p1', label: 'P1', version: '1', type: 'core' });
PEv.registerPlugin({ id: 'p2', label: 'P2', version: '1', type: 'shared' });
PEv.boot();
PEv.ready();

var expectedOrder = [
  'registered:p1', 'registered:p2',
  'boot',
  'booted:p1', 'booted:p2',
  'ready'
];
check('lifecycle events emitted in correct order',
  JSON.stringify(lifecycle) === JSON.stringify(expectedOrder));

// [36] ready() called before boot() triggers boot() first
var PRaw = makePlatform();
PRaw.registerPlugin({ id: 'raw1', label: 'Raw', version: '1', type: 'core' });
var rawPhaseOnReady;
PRaw.registerPlugin({
  id: 'raw2', label: 'Raw2', version: '1', type: 'core',
  onReady: function() { rawPhaseOnReady = PRaw.phase(); }
});
// skip PRaw.boot() — call ready() directly
PRaw.ready();
check('ready() without prior boot() still reaches "ready" phase', PRaw.phase() === 'ready');

// ── Summary ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
console.log(' MYTHOS OS Stage 1B tests — ' + pass + ' passed, ' + fail + ' failed');
console.log('══════════════════════════════════════════════════════════');
if (fail > 0) {
  results.filter(function(r) { return !r.ok; }).forEach(function(r) {
    console.error('  FAIL: ' + r.label);
  });
  process.exit(1);
}
