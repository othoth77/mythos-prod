// =====================================================
// MYTHOS OS — Stage 2D automated tests
// tests/stage2d-test.js
//
// Covers: Plugin SDK — Plugin.create(), all define*()
// methods, build(), validation, duplicate detection,
// Platform compatibility, Shell.widgets integration,
// lifecycle hooks, and Stage 2A-2C regression.
//
// Run with: node tests/stage2d-test.js
// =====================================================
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var BASE  = path.resolve(__dirname, '..');
var _pass = 0, _fail = 0, _results = [];

function ok(cond, label) {
  if (cond) { _pass++; _results.push('  PASS ' + label); }
  else       { _fail++; _results.push('  FAIL ' + label); }
}
function throws(fn, substr, label) {
  try { fn(); _fail++; _results.push('  FAIL ' + label + ' (no error thrown)'); }
  catch (e) {
    var msg = (e && e.message) || '';
    if (!substr || msg.indexOf(substr) !== -1) { _pass++; _results.push('  PASS ' + label); }
    else { _fail++; _results.push('  FAIL ' + label + ' (wrong error: ' + msg + ')'); }
  }
}
function section(title) { _results.push('\n' + title); }

// ── Shared sandbox ────────────────────────────────────────────────────
var sandbox = vm.createContext({
  document:         { title: '', getElementById: function () { return null; } },
  location:         { hash: '#dashboard' },
  showView:         function (v) { return v; },
  AbortController:  function () { this.signal = {}; this.abort = function () {}; },
  localStorage:     (function () {
    var _s = {};
    return {
      getItem:    function (k) { return Object.prototype.hasOwnProperty.call(_s, k) ? _s[k] : null; },
      setItem:    function (k, v) { _s[k] = String(v); },
      removeItem: function (k) { delete _s[k]; }
    };
  })(),
  fetch: function () {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  },
  console:         console,
  Promise:         Promise,
  JSON:            JSON,
  Date:            Date,
  Array:           Array,
  Object:          Object,
  setTimeout:      setTimeout,
  clearTimeout:    clearTimeout,
  encodeURIComponent: encodeURIComponent
});

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sandbox);
}

load('js/core/events.js');
load('js/core/storage.js');
load('js/core/api.js');
load('js/core/platform.js');
load('js/core/shell.js');
load('js/core/plugin-sdk.js');

var Plugin   = sandbox.Plugin;
var Platform = sandbox.Platform;
var Shell    = sandbox.Shell;
var Events   = sandbox.Events;

// ── SECTION 1: Plugin.create — validation ─────────────────────────────
section('1. Plugin.create() — validation');

throws(function () { Plugin.create(null);        }, 'must be a plain object', 'create(null) throws');
throws(function () { Plugin.create('string');    }, 'must be a plain object', 'create(string) throws');
throws(function () { Plugin.create({});          }, '"id" is required',        'create({}) throws — missing id');
throws(function () { Plugin.create({ id: 'x', label: 'X', version: '1.0.0' }); },
  '"type" is required', 'create without type throws');
throws(function () {
  Plugin.create({ id: 'MyPlugin', label: 'X', version: '1.0.0', type: 'shared' });
}, '"id" must be kebab-case', 'uppercase id throws');
throws(function () {
  Plugin.create({ id: 'my plugin', label: 'X', version: '1.0.0', type: 'shared' });
}, '"id" must be kebab-case', 'id with space throws');
throws(function () {
  Plugin.create({ id: 'my-plugin', label: '', version: '1.0.0', type: 'shared' });
}, '"label" must be a non-empty string', 'empty label throws');
throws(function () {
  Plugin.create({ id: 'my-plugin', label: 'X', version: 'v1', type: 'shared' });
}, '"version" must follow semver', 'bad version throws');
throws(function () {
  Plugin.create({ id: 'my-plugin', label: 'X', version: '1.0.0', type: 'frontend' });
}, '"type" must be', 'invalid type throws');
throws(function () {
  Plugin.create({ id: 'my-plugin', label: 'X', version: '1.0.0', type: 'Core' });
}, '"type" must be', 'capitalized type throws');
throws(function () {
  Plugin.create({ id: 'my-plugin', label: 'X', version: '1.0.0', type: 'shared', onBoot: 'nope' });
}, '"onBoot" must be a function', 'string onBoot throws');
throws(function () {
  Plugin.create({ id: 'my-plugin', label: 'X', version: '1.0.0', type: 'shared', onReady: 42 });
}, '"onReady" must be a function', 'non-function onReady throws');

// Valid create
var _b = Plugin.create({ id: 'test-plugin', label: 'Test Plugin', version: '1.0.0', type: 'shared' });
ok(_b !== null && typeof _b === 'object', 'create() returns a builder object');
ok(typeof _b.defineMenu     === 'function', 'builder has defineMenu()');
ok(typeof _b.defineRoutes   === 'function', 'builder has defineRoutes()');
ok(typeof _b.defineStorage  === 'function', 'builder has defineStorage()');
ok(typeof _b.defineWidgets  === 'function', 'builder has defineWidgets()');
ok(typeof _b.definePermissions === 'function', 'builder has definePermissions()');
ok(typeof _b.defineSettings === 'function', 'builder has defineSettings()');
ok(typeof _b.defineSearch   === 'function', 'builder has defineSearch()');
ok(typeof _b.defineCalendar === 'function', 'builder has defineCalendar()');
ok(typeof _b.defineDashboard === 'function', 'builder has defineDashboard()');
ok(typeof _b.build          === 'function', 'builder has build()');

// ── SECTION 2: defineMenu ─────────────────────────────────────────────
section('2. defineMenu()');

var _bMenu = Plugin.create({ id: 'p-menu', label: 'P Menu', version: '1.0.0', type: 'shared' });

throws(function () { _bMenu.defineMenu(null);   }, 'config must be a plain object', 'defineMenu(null) throws');
throws(function () { _bMenu.defineMenu('str');  }, 'config must be a plain object', 'defineMenu(string) throws');

var _rMenu = Plugin.create({ id: 'p-menu2', label: 'P Menu2', version: '1.0.0', type: 'shared' })
  .defineMenu({ section: 'Général', order: 5, icon: '📋' })
  .build();
ok(_rMenu.manifest.menu.section === 'Général', 'menu.section correct');
ok(_rMenu.manifest.menu.order   === 5,         'menu.order correct');
ok(_rMenu.manifest.menu.icon    === '📋',      'menu.icon correct');

// defaults
var _rMenuDef = Plugin.create({ id: 'p-menu3', label: 'My Label', version: '1.0.0', type: 'shared' })
  .defineMenu({})
  .build();
ok(_rMenuDef.manifest.menu.section === 'My Label', 'menu.section defaults to label');
ok(_rMenuDef.manifest.menu.order   === 99,          'menu.order defaults to 99');

// duplicate
var _bMenuDup = Plugin.create({ id: 'p-menu-dup', label: 'X', version: '1.0.0', type: 'shared' })
  .defineMenu({ section: 'A' });
throws(function () { _bMenuDup.defineMenu({ section: 'B' }); },
  '"defineMenu" already defined', 'duplicate defineMenu throws');

// ── SECTION 3: defineRoutes ───────────────────────────────────────────
section('3. defineRoutes()');

throws(function () {
  Plugin.create({ id: 'p-r', label: 'X', version: '1.0.0', type: 'shared' })
    .defineRoutes('not-array').build();
}, 'must be an array', 'defineRoutes(string) throws');

throws(function () {
  Plugin.create({ id: 'p-r2', label: 'X', version: '1.0.0', type: 'shared' })
    .defineRoutes([{ label: 'No Id' }]).build();
}, 'missing required "id"', 'route without id throws');

var _rRoutes = Plugin.create({ id: 'p-routes', label: 'X', version: '1.0.0', type: 'shared' })
  .defineRoutes([
    { id: 'view-a', label: 'View A', icon: '🔵' },
    { id: 'view-b', label: 'View B', icon: '🔴' }
  ])
  .build();
ok(_rRoutes.manifest.routes.length === 2, 'routes has 2 items');
ok(_rRoutes.manifest.routes[0].id === 'view-a', 'routes[0].id correct');
ok(_rRoutes.manifest.routes[1].id === 'view-b', 'routes[1].id correct');

// Empty routes array is valid
var _rEmpty = Plugin.create({ id: 'p-r-empty', label: 'X', version: '1.0.0', type: 'shared' })
  .defineRoutes([]).build();
ok(Array.isArray(_rEmpty.manifest.routes) && _rEmpty.manifest.routes.length === 0,
   'empty defineRoutes([]) is valid');

// Safe copy — mutation of source does not affect manifest
var _src = [{ id: 'route-x', label: 'X' }];
var _rCopy = Plugin.create({ id: 'p-copy', label: 'X', version: '1.0.0', type: 'shared' })
  .defineRoutes(_src).build();
_src[0].id = 'MUTATED';
ok(_rCopy.manifest.routes[0].id === 'route-x', 'defineRoutes safe-copies route objects');

// Duplicate
var _bRoutesDup = Plugin.create({ id: 'p-rd', label: 'X', version: '1.0.0', type: 'shared' })
  .defineRoutes([{ id: 'v' }]);
throws(function () { _bRoutesDup.defineRoutes([{ id: 'v2' }]); },
  '"defineRoutes" already defined', 'duplicate defineRoutes throws');

// ── SECTION 4: defineStorage ──────────────────────────────────────────
section('4. defineStorage()');

throws(function () {
  Plugin.create({ id: 'p-s', label: 'X', version: '1.0.0', type: 'shared' })
    .defineStorage('not-array').build();
}, 'must be an array', 'defineStorage(string) throws');

throws(function () {
  Plugin.create({ id: 'p-s2', label: 'X', version: '1.0.0', type: 'shared' })
    .defineStorage([123]).build();
}, 'must be a non-empty string', 'non-string key throws');

var _rStorage = Plugin.create({ id: 'p-storage', label: 'X', version: '1.0.0', type: 'shared' })
  .defineStorage(['mp_data', 'mp_cache']).build();
ok(Array.isArray(_rStorage.manifest.storageKeys), 'storageKeys is array');
ok(_rStorage.manifest.storageKeys.length === 2,   'storageKeys has 2 entries');
ok(_rStorage.manifest.storageKeys[0] === 'mp_data', 'storageKeys[0] correct');

var _bStorDup = Plugin.create({ id: 'p-sd', label: 'X', version: '1.0.0', type: 'shared' })
  .defineStorage(['mp_a']);
throws(function () { _bStorDup.defineStorage(['mp_b']); },
  '"defineStorage" already defined', 'duplicate defineStorage throws');

// ── SECTION 5: defineWidgets ──────────────────────────────────────────
section('5. defineWidgets()');

throws(function () {
  Plugin.create({ id: 'p-w', label: 'X', version: '1.0.0', type: 'shared' })
    .defineWidgets('nope').build();
}, 'must be an array', 'defineWidgets(string) throws');

throws(function () {
  Plugin.create({ id: 'p-w2', label: 'X', version: '1.0.0', type: 'shared' })
    .defineWidgets([{ label: 'No Id' }]).build();
}, 'missing required "id"', 'widget without id throws');

var _rWidgets = Plugin.create({ id: 'p-widgets', label: 'X', version: '1.0.0', type: 'shared' })
  .defineWidgets([
    { id: 'w-kpi', label: 'KPI', zone: 'dashboard', order: 1 }
  ]).build();
ok(Array.isArray(_rWidgets.manifest.widgets), 'widgets in manifest');
ok(_rWidgets.manifest.widgets[0].id === 'w-kpi', 'widget id correct');

var _bWDup = Plugin.create({ id: 'p-wd', label: 'X', version: '1.0.0', type: 'shared' })
  .defineWidgets([{ id: 'w1' }]);
throws(function () { _bWDup.defineWidgets([{ id: 'w2' }]); },
  '"defineWidgets" already defined', 'duplicate defineWidgets throws');

// ── SECTION 6: definePermissions ─────────────────────────────────────
section('6. definePermissions()');

throws(function () {
  Plugin.create({ id: 'p-perm', label: 'X', version: '1.0.0', type: 'business' })
    .definePermissions(null).build();
}, 'config must be a plain object', 'definePermissions(null) throws');

var _rPerms = Plugin.create({ id: 'p-perms', label: 'X', version: '1.0.0', type: 'business' })
  .definePermissions({ roles: ['admin'], requireAuth: true }).build();
ok(_rPerms.manifest.permissions.requireAuth === true,        'permissions.requireAuth correct');
ok(Array.isArray(_rPerms.manifest.permissions.roles),        'permissions.roles is array');
ok(_rPerms.manifest.permissions.roles[0] === 'admin',        'permissions.roles[0] correct');

var _bPermDup = Plugin.create({ id: 'p-pd', label: 'X', version: '1.0.0', type: 'shared' })
  .definePermissions({ roles: [] });
throws(function () { _bPermDup.definePermissions({ roles: [] }); },
  '"definePermissions" already defined', 'duplicate definePermissions throws');

// ── SECTION 7: defineSettings ─────────────────────────────────────────
section('7. defineSettings()');

throws(function () {
  Plugin.create({ id: 'p-set', label: 'X', version: '1.0.0', type: 'shared' })
    .defineSettings('not-array').build();
}, 'must be an array', 'defineSettings(string) throws');

throws(function () {
  Plugin.create({ id: 'p-set2', label: 'X', version: '1.0.0', type: 'shared' })
    .defineSettings([{ label: 'No Key' }]).build();
}, 'missing required "key"', 'setting without key throws');

var _rSettings = Plugin.create({ id: 'p-settings', label: 'X', version: '1.0.0', type: 'shared' })
  .defineSettings([
    { key: 'threshold', label: 'Threshold', type: 'number', default: 5 }
  ]).build();
ok(Array.isArray(_rSettings.manifest.settings),            'settings in manifest');
ok(_rSettings.manifest.settings[0].key === 'threshold',    'settings[0].key correct');
ok(_rSettings.manifest.settings[0].default === 5,          'settings[0].default correct');

var _bSetDup = Plugin.create({ id: 'p-setd', label: 'X', version: '1.0.0', type: 'shared' })
  .defineSettings([{ key: 's1' }]);
throws(function () { _bSetDup.defineSettings([{ key: 's2' }]); },
  '"defineSettings" already defined', 'duplicate defineSettings throws');

// ── SECTION 8: defineSearch ───────────────────────────────────────────
section('8. defineSearch()');

throws(function () {
  Plugin.create({ id: 'p-srch', label: 'X', version: '1.0.0', type: 'shared' })
    .defineSearch('nope').build();
}, 'config must be a plain object', 'defineSearch(string) throws');

throws(function () {
  Plugin.create({ id: 'p-srch2', label: 'X', version: '1.0.0', type: 'shared' })
    .defineSearch({ handler: 'not-a-function' }).build();
}, '"handler" must be a function', 'defineSearch with non-function handler throws');

var _handler = function (q) { return []; };
var _rSearch = Plugin.create({ id: 'p-search', label: 'X', version: '1.0.0', type: 'shared' })
  .defineSearch({ handler: _handler }).build();
ok(_rSearch.manifest.search.handler === _handler, 'search.handler preserved in manifest');

var _bSrchDup = Plugin.create({ id: 'p-sd2', label: 'X', version: '1.0.0', type: 'shared' })
  .defineSearch({ handler: function () {} });
throws(function () { _bSrchDup.defineSearch({ handler: function () {} }); },
  '"defineSearch" already defined', 'duplicate defineSearch throws');

// ── SECTION 9: defineCalendar ─────────────────────────────────────────
section('9. defineCalendar()');

throws(function () {
  Plugin.create({ id: 'p-cal', label: 'X', version: '1.0.0', type: 'shared' })
    .defineCalendar(null).build();
}, 'config must be a plain object', 'defineCalendar(null) throws');

throws(function () {
  Plugin.create({ id: 'p-cal2', label: 'X', version: '1.0.0', type: 'shared' })
    .defineCalendar({ provider: 'not-fn' }).build();
}, '"provider" must be a function', 'defineCalendar with non-function provider throws');

var _provider = function (r) { return []; };
var _rCal = Plugin.create({ id: 'p-calendar', label: 'X', version: '1.0.0', type: 'shared' })
  .defineCalendar({ provider: _provider }).build();
ok(_rCal.manifest.calendar.provider === _provider, 'calendar.provider preserved in manifest');

var _bCalDup = Plugin.create({ id: 'p-cd', label: 'X', version: '1.0.0', type: 'shared' })
  .defineCalendar({ provider: function () {} });
throws(function () { _bCalDup.defineCalendar({ provider: function () {} }); },
  '"defineCalendar" already defined', 'duplicate defineCalendar throws');

// ── SECTION 10: defineDashboard ───────────────────────────────────────
section('10. defineDashboard()');

throws(function () {
  Plugin.create({ id: 'p-dash', label: 'X', version: '1.0.0', type: 'business' })
    .defineDashboard('nope').build();
}, 'config must be a plain object', 'defineDashboard(string) throws');

var _rDash = Plugin.create({ id: 'p-dashboard', label: 'X', version: '1.0.0', type: 'business' })
  .defineDashboard({ tiles: [{ id: 'kpi-1', label: 'KPI 1' }] }).build();
ok(_rDash.manifest.dashboard !== undefined,                  'dashboard in manifest');
ok(Array.isArray(_rDash.manifest.dashboard.tiles),           'dashboard.tiles is array');
ok(_rDash.manifest.dashboard.tiles[0].id === 'kpi-1',       'dashboard.tiles[0].id correct');

var _bDashDup = Plugin.create({ id: 'p-dd', label: 'X', version: '1.0.0', type: 'business' })
  .defineDashboard({ tiles: [] });
throws(function () { _bDashDup.defineDashboard({ tiles: [] }); },
  '"defineDashboard" already defined', 'duplicate defineDashboard throws');

// ── SECTION 11: build() and Platform compatibility ────────────────────
section('11. build() — Platform compatibility');

// build() without Platform returns registered:false
var _sandboxNP = vm.createContext({ console: console, Object: Object, Array: Array, JSON: JSON });
vm.runInContext(fs.readFileSync(path.join(BASE, 'js/core/plugin-sdk.js'), 'utf8'), _sandboxNP);
var _bNP = _sandboxNP.Plugin.create({ id: 'np', label: 'NP', version: '1.0.0', type: 'shared' }).build();
ok(_bNP.registered === false, 'build() without Platform returns registered:false');

// build() with Platform calls registerPlugin
var _rPlat = Plugin.create({ id: 'p-plat', label: 'P Plat', version: '1.0.0', type: 'shared' })
  .defineMenu({ section: 'Test', order: 99 })
  .defineRoutes([{ id: 'plat-view', label: 'View' }])
  .defineStorage(['mp_plat_data'])
  .build();
ok(_rPlat.registered === true,                              'build() returns registered:true');
ok(Platform.hasPlugin('p-plat'),                            'Platform.hasPlugin after build');

var _got = Platform.getPlugin('p-plat');
ok(_got && _got.id === 'p-plat',                            'Platform.getPlugin returns correct manifest');
ok(_got && _got.menu.section === 'Test',                    'Platform manifest has correct menu.section');
ok(_got && _got.routes.length === 1,                        'Platform manifest has 1 route');
ok(_got && _got.storageKeys[0] === 'mp_plat_data',          'Platform manifest has storageKey');

// build() returns { manifest, registered }
ok(_rPlat.manifest && typeof _rPlat.manifest === 'object',  'build() returns manifest');
ok(Object.prototype.hasOwnProperty.call(_rPlat, 'registered'), 'build() result has registered key');

// Safe copy — mutating the returned manifest does NOT affect Platform
_rPlat.manifest.id = 'HACKED';
var _gotAfter = Platform.getPlugin('p-plat');
ok(_gotAfter && _gotAfter.id === 'p-plat', 'Platform manifest is isolated from returned manifest');

// ── SECTION 12: Shell.widgets integration ────────────────────────────
section('12. Shell.widgets integration');

var _wFn = function () { return 'rendered'; };
var _rW = Plugin.create({ id: 'p-wshell', label: 'X', version: '1.0.0', type: 'shared' })
  .defineWidgets([{ id: 'wshell-kpi', label: 'KPI', zone: 'dashboard', order: 5, render: _wFn }])
  .build();
ok(Shell.widgets.hasWidget('wshell-kpi'),               'widget registered with Shell after build');
var _wAll = Shell.widgets.getAll('dashboard');
var _found = _wAll.filter(function (w) { return w.id === 'wshell-kpi'; })[0];
ok(_found && _found.zone === 'dashboard',               'Shell widget has correct zone');
ok(_found && _found.render === _wFn,                    'Shell widget render fn preserved');

// ── SECTION 13: Lifecycle hooks ───────────────────────────────────────
section('13. Lifecycle hooks (onBoot / onReady)');

var _booted = false, _readied = false;
var _rLife = Plugin.create({
  id:      'p-lifecycle',
  label:   'Lifecycle',
  version: '1.0.0',
  type:    'shared',
  onBoot:  function () { _booted = true; },
  onReady: function () { _readied = true; }
}).build();
ok(typeof _rLife.manifest.onBoot  === 'function', 'onBoot function in manifest');
ok(typeof _rLife.manifest.onReady === 'function', 'onReady function in manifest');

// Platform.boot() should call them
Platform.boot();
ok(_booted,  'onBoot called after Platform.boot()');
Platform.ready();
ok(_readied, 'onReady called after Platform.ready()');

// Plugin with no lifecycle hooks has no onBoot/onReady keys
var _rNoLife = Plugin.create({ id: 'p-nolife', label: 'X', version: '1.0.0', type: 'shared' }).build();
ok(!Object.prototype.hasOwnProperty.call(_rNoLife.manifest, 'onBoot'),
   'no onBoot key when not defined');
ok(!Object.prototype.hasOwnProperty.call(_rNoLife.manifest, 'onReady'),
   'no onReady key when not defined');

// ── SECTION 14: Plugin.validate() ────────────────────────────────────
section('14. Plugin.validate()');

ok(Plugin.validate(null) !== null,  'validate(null) returns error string');
ok(Plugin.validate({ id: 'good', label: 'Good', version: '1.0.0', type: 'core' }) === null,
   'validate(valid manifest) returns null');
ok(typeof Plugin.validate({ id: 'bad id' }) === 'string', 'validate returns string for bad id');

// ── SECTION 15: Example files exist ──────────────────────────────────
section('15. Example files');

ok(fs.existsSync(path.join(BASE, 'examples/plugin-example.js')),
   'examples/plugin-example.js exists');
ok(fs.existsSync(path.join(BASE, 'examples/shared-plugin-example.js')),
   'examples/shared-plugin-example.js exists');
ok(fs.existsSync(path.join(BASE, 'examples/business-plugin-example.js')),
   'examples/business-plugin-example.js exists');
ok(fs.existsSync(path.join(BASE, 'docs/plugin-sdk.md')),
   'docs/plugin-sdk.md exists');

// ── SECTION 16: Stage 2A-2C regression ───────────────────────────────
section('16. Stage 2A-2C regression');

// Load existing plugin manifests (they use direct Platform.registerPlugin)
load('js/plugins/production.plugin.js');
load('js/plugins/dashboard.plugin.js');
load('js/plugins/tasks.plugin.js');
load('js/plugins/planning.plugin.js');
load('js/plugins/contacts.plugin.js');
load('js/plugins/notes.plugin.js');
load('js/plugins/calendar.plugin.js');

ok(Platform.getPlugin('production') !== null, 'production plugin unaffected');
ok(Platform.getPlugin('dashboard')  !== null, 'dashboard plugin unaffected');
ok(Platform.getPlugin('tasks')      !== null, 'tasks plugin unaffected');
ok(Platform.getPlugin('planning')   !== null, 'planning plugin unaffected');
ok(Platform.getPlugin('contacts')   !== null, 'contacts plugin unaffected');
ok(Platform.getPlugin('notes')      !== null, 'notes plugin unaffected');
ok(Platform.getPlugin('calendar')   !== null, 'calendar plugin unaffected');

var _prod = Platform.getPlugin('production');
ok(_prod && _prod.routes && _prod.routes.length === 30,     'production retains 30 routes');

var _sections = Shell.sidebar.getSections();
ok(_sections.length >= 1, 'Shell sidebar still has sections');
ok(typeof Shell.navigation.go === 'function',               'Shell.navigation unaffected');

// ── Results ───────────────────────────────────────────────────────────
_results.forEach(function (r) { console.log(r); });
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) { process.exit(1); }
