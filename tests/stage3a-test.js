// =====================================================
// MYTHOS OS — Stage 3A automated tests
// tests/stage3a-test.js
//
// Covers: tasks.runtime.js plugin registration,
// bootstrap initialization, search/calendar providers,
// patch idempotency, Platform lifecycle integration,
// plugin-disable simulation, legacy global compatibility.
//
// Run with: node tests/stage3a-test.js
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
function section(title) { _results.push('\n' + title); }

// ── Make fresh sandbox ────────────────────────────────────────────────
function makeSandbox(overrides) {
  var calCalledCount  = 0;
  var dashCalledCount = 0;
  var showCalledWith  = [];
  var tachePageCalls  = 0;
  var tacheDashCalls  = 0;
  var calInjectCalls  = 0;
  var modalCalls      = 0;

  var base = {
    document: {
      readyState: 'complete',
      title: '',
      createElement: function (tag) {
        var el = {
          _tag: tag, className: '', innerHTML: '', style: { cssText: '' },
          onclick: null, _attrs: {},
          setAttribute: function (k, v) { this._attrs[k] = v; },
          querySelector: function (sel) { return null; }
        };
        return el;
      },
      getElementById: function () { return null; },
      querySelector:  function (sel) {
        if (sel === '#view-calendrier .page-header > div') {
          return {
            firstChild: null,
            _children: [],
            querySelector: function (s) { return null; },
            insertBefore: function (el) { this._children.push(el); }
          };
        }
        return null;
      },
      querySelectorAll: function () { return []; },
      body: { appendChild: function () {} }
    },
    location:        { hash: '' },
    window:          { addEventListener: function () {} },
    localStorage: (function () {
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
    // Task globals (stubs for taches.js functions)
    getTaches: function () {
      return [
        { id: 't1', note: 'acheter du lait', dueDate: '2026-08-01', archived: false, type: 'simple' },
        { id: 't2', note: 'réunion client',  dueDate: '2026-08-10', archived: false, type: 'urgente' },
        { id: 't3', note: 'archive',         dueDate: '2026-07-01', archived: true,  type: 'simple' }
      ];
    },
    tachesOpenModal:          function () { modalCalls++; },
    renderTachePage:          function () { tachePageCalls++; },
    renderTachesDashboard:    function () { tacheDashCalls++; },
    renderTachesInCalendrier: function () { calInjectCalls++; },
    renderCalendrier:         function () { calCalledCount++; },
    updateDashboardStats:     function () { dashCalledCount++; },
    showView:                 function (v) { showCalledWith.push(v); },
    // Spy counters exposed for tests
    _spies: {
      get calCount()   { return calCalledCount; },
      get dashCount()  { return dashCalledCount; },
      get showLog()    { return showCalledWith; },
      get tachePage()  { return tachePageCalls; },
      get tacheDash()  { return tacheDashCalls; },
      get calInject()  { return calInjectCalls; },
      get modal()      { return modalCalls; }
    },
    // Node stubs
    console:            console,
    Promise:            Promise,
    JSON:               JSON,
    Date:               Date,
    Array:              Array,
    Object:             Object,
    String:             String,
    setTimeout:         setTimeout,
    clearTimeout:       clearTimeout,
    requestAnimationFrame: function (fn) { setTimeout(fn, 0); },
    encodeURIComponent: encodeURIComponent
  };

  Object.assign(base, overrides || {});
  return vm.createContext(base);
}

function load(sandbox, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sandbox);
}

// ── SECTION 1: Plugin registration ───────────────────────────────────
section('1. Plugin registration via Plugin SDK');

var sb = makeSandbox();
load(sb, 'js/core/events.js');
load(sb, 'js/core/storage.js');
load(sb, 'js/core/api.js');
load(sb, 'js/core/platform.js');
load(sb, 'js/core/shell.js');
load(sb, 'js/core/plugin-sdk.js');
load(sb, 'js/plugins/tasks.runtime.js');

var P = sb.Platform;
ok(P.hasPlugin('tasks'),                             'tasks plugin is registered');
var m = P.getPlugin('tasks');
ok(m && m.id      === 'tasks',                       'manifest.id correct');
ok(m && m.label   === 'Tâches',                      'manifest.label correct');
ok(m && m.version === '1.0.0',                       'manifest.version correct');
ok(m && m.type    === 'shared',                      'manifest.type correct');
ok(m && m.menu && m.menu.section === 'Général',      'manifest.menu.section correct');
ok(m && m.menu && m.menu.order   === 3,              'manifest.menu.order correct');
ok(m && m.routes && m.routes.length === 1,           'manifest.routes has 1 entry');
ok(m && m.routes && m.routes[0].id === 'tache',      'manifest.routes[0].id = "tache"');
ok(m && m.storageKeys && m.storageKeys[0] === 'mp_taches', 'manifest.storageKeys correct');
ok(m && typeof m.onBoot  === 'function',             'manifest.onBoot is a function');
ok(m && typeof m.onReady === 'function',             'manifest.onReady is a function');
ok(m && m.search  && typeof m.search.handler   === 'function', 'manifest.search.handler exists');
ok(m && m.calendar && typeof m.calendar.provider === 'function', 'manifest.calendar.provider exists');

// Shell sidebar auto-populated
var sections = sb.Shell.sidebar.getSections();
ok(sections.some(function (s) { return s.section === 'Général' || s.label === 'Général'; }),
   'Shell sidebar has "Général" section');

// ── SECTION 2: onBoot ─────────────────────────────────────────────────
section('2. onBoot lifecycle');

// Corrupt localStorage to verify onBoot cleanup
sb.localStorage.setItem('mp_taches', 'CORRUPT');
sb.Platform.boot();
ok(sb.localStorage.getItem('mp_taches') === '[]',   'onBoot resets corrupt mp_taches to []');

// Clean storage — boot again (should not re-corrupt)
sb.localStorage.setItem('mp_taches', '[]');
sb.Platform.boot();
ok(sb.localStorage.getItem('mp_taches') === '[]',   'onBoot preserves valid mp_taches []');

// Valid JSON array stays untouched
sb.localStorage.setItem('mp_taches', '[{"id":"x"}]');
sb.Platform.boot();
ok(sb.localStorage.getItem('mp_taches') === '[{"id":"x"}]', 'onBoot preserves valid task array');

// ── SECTION 3: Platform.ready() triggers initialization ───────────────
section('3. Platform.ready() → _tasksInit()');

ok(!sb._TASKS_RT_STATE.initialized,             '_TASKS_RT_STATE.initialized is false before ready()');

sb.Platform.ready();

ok(sb._TASKS_RT_STATE.initialized === true,      '_TASKS_RT_STATE.initialized is true after ready()');

// Dashboard widget rendered on init
ok(sb._spies.tacheDash >= 1,                    'renderTachesDashboard called during init');

// renderCalendrier is now patched
var calBefore = sb._spies.calCount;
var injectBefore = sb._spies.calInject;
sb.renderCalendrier();
ok(sb._spies.calCount   === calBefore  + 1,     'renderCalendrier incremented (original called)');
ok(sb._spies.calInject  === injectBefore + 1,   'renderTachesInCalendrier called via patch');

// updateDashboardStats is now patched
var dashBefore = sb._spies.dashCount;
var tacheDashBefore = sb._spies.tacheDash;
sb.updateDashboardStats();
ok(sb._spies.dashCount  === dashBefore + 1,     'updateDashboardStats incremented (original called)');
ok(sb._spies.tacheDash  >= tacheDashBefore + 1, 'renderTachesDashboard called via updateDashboardStats patch');

// showView is now patched
var tachePageBefore = sb._spies.tachePage;
sb.showView('dashboard');
ok(sb._spies.showLog.includes('dashboard'),     'showView("dashboard") recorded');
ok(sb._spies.tachePage === tachePageBefore,     'renderTachePage NOT called for non-tache view');

sb.showView('tache');
ok(sb._spies.tachePage === tachePageBefore + 1, 'renderTachePage called when showView("tache")');

// ── SECTION 4: Init idempotency ───────────────────────────────────────
section('4. Initialization idempotency');

var tacheDashBefore2 = sb._spies.tacheDash;
// Call onReady manually a second time
m.onReady();
ok(sb._TASKS_RT_STATE.initialized === true,      'Still initialized after second onReady()');
ok(sb._spies.tacheDash === tacheDashBefore2,     'renderTachesDashboard NOT called again (guard)');

// Patches are not doubled
var calBefore2 = sb._spies.calCount;
var inject2Before = sb._spies.calInject;
sb.renderCalendrier();
ok(sb._spies.calCount  === calBefore2  + 1,     'renderCalendrier called once (not doubled)');
ok(sb._spies.calInject === inject2Before + 1,   'renderTachesInCalendrier called once (not doubled)');

// ── SECTION 5: Search provider ────────────────────────────────────────
section('5. Search provider (manifest.search.handler)');

var searchFn = m.search.handler;

var results = searchFn('lait');
ok(results.length === 1,                         'Search "lait" returns 1 result');
ok(results[0].label.indexOf('acheter') !== -1,   'Search result label contains task note');
ok(results[0].route === 'tache',                 'Search result route is "tache"');

var noResults = searchFn('xyznotfound');
ok(noResults.length === 0,                       'Search returns [] for no match');

// Archived tasks excluded
var archiveSearch = searchFn('archive');
ok(archiveSearch.length === 0,                   'Archived tasks excluded from search');

// Empty query
var emptySearch = searchFn('');
ok(Array.isArray(emptySearch),                   'Empty query returns array');

// Handler safe when getTaches not available
var sbNoTaches = makeSandbox({ getTaches: undefined });
load(sbNoTaches, 'js/core/events.js');
load(sbNoTaches, 'js/core/storage.js');
load(sbNoTaches, 'js/core/api.js');
load(sbNoTaches, 'js/core/platform.js');
load(sbNoTaches, 'js/core/shell.js');
load(sbNoTaches, 'js/core/plugin-sdk.js');
load(sbNoTaches, 'js/plugins/tasks.runtime.js');
var mNoTaches = sbNoTaches.Platform.getPlugin('tasks');
var safeSearch = mNoTaches.search.handler('test');
ok(Array.isArray(safeSearch) && safeSearch.length === 0,
   'Search handler returns [] when getTaches not available');

// ── SECTION 6: Calendar provider ─────────────────────────────────────
section('6. Calendar provider (manifest.calendar.provider)');

var calFn = m.calendar.provider;

// Tasks in range
var r1 = calFn({ start: new Date('2026-08-01'), end: new Date('2026-08-31') });
ok(r1.length === 2,                              'Calendar provider returns 2 tasks in range');
ok(r1[0].type === 'task',                        'Calendar event type is "task"');
ok(r1[0].date === '2026-08-01' || r1[1].date === '2026-08-01',
   'Task with dueDate 2026-08-01 included');

// Tasks outside range
var r2 = calFn({ start: new Date('2026-09-01'), end: new Date('2026-09-30') });
ok(r2.length === 0,                              'Calendar provider returns [] for empty range');

// Archived tasks excluded
var r3 = calFn({ start: new Date('2026-07-01'), end: new Date('2026-07-31') });
ok(r3.length === 0,                              'Archived tasks excluded from calendar provider');

// Safe when getTaches not available
var safeCalendar = mNoTaches.calendar.provider({ start: new Date(), end: new Date() });
ok(Array.isArray(safeCalendar) && safeCalendar.length === 0,
   'Calendar provider returns [] when getTaches not available');

// ── SECTION 7: Plugin-disable simulation ─────────────────────────────
section('7. Plugin-disable simulation');

// Load everything EXCEPT tasks.runtime.js
var sbDisabled = makeSandbox();
load(sbDisabled, 'js/core/events.js');
load(sbDisabled, 'js/core/storage.js');
load(sbDisabled, 'js/core/api.js');
load(sbDisabled, 'js/core/platform.js');
load(sbDisabled, 'js/core/shell.js');
load(sbDisabled, 'js/core/plugin-sdk.js');
// tasks.runtime.js NOT loaded — simulating disabled plugin

ok(!sbDisabled.Platform.hasPlugin('tasks'),      'tasks NOT in Platform when runtime disabled');

// Platform.boot/ready still work without tasks
var bootOk = true, readyOk = true;
try { sbDisabled.Platform.boot(); }  catch(e) { bootOk = false; }
try { sbDisabled.Platform.ready(); } catch(e) { readyOk = false; }
ok(bootOk,  'Platform.boot() succeeds without tasks plugin');
ok(readyOk, 'Platform.ready() succeeds without tasks plugin');

// Sandbox globals still accessible (stub functions still exist)
ok(typeof sbDisabled.getTaches        === 'function', 'getTaches still available in globals');
ok(typeof sbDisabled.tachesOpenModal  === 'function', 'tachesOpenModal still available');
ok(typeof sbDisabled.renderTachePage  === 'function', 'renderTachePage still available');

// Init flag stays false (no bootstrap ran)
ok(!sbDisabled._TASKS_RT_STATE, '_TASKS_RT_STATE does not exist when runtime disabled');

// ── SECTION 8: index.html verification ───────────────────────────────
section('8. index.html loading order');

var htmlRaw = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');
ok(htmlRaw.indexOf('tasks.runtime.js') !== -1,   'index.html loads tasks.runtime.js');
ok(htmlRaw.indexOf('tasks.plugin.js')  === -1,   'index.html no longer loads tasks.plugin.js');

// Order: plugin-sdk before tasks.runtime before taches
var sdkPos     = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
var runtimePos = htmlRaw.indexOf('src="js/plugins/tasks.runtime.js');
var tachesPos  = htmlRaw.indexOf('src="js/taches.js');
ok(sdkPos     < runtimePos, 'plugin-sdk.js loaded before tasks.runtime.js');
ok(runtimePos < tachesPos,  'tasks.runtime.js loaded before taches.js');

// ── SECTION 9: taches.js init block removed ───────────────────────────
section('9. taches.js — initialization block removed');

var tachesSource = fs.readFileSync(path.join(BASE, 'js/taches.js'), 'utf8');
ok(tachesSource.indexOf('// ── INITIALISATION') === -1,
   'INITIALISATION section removed from taches.js');
ok(tachesSource.indexOf("window.addEventListener('load'") === -1,
   'window.addEventListener load removed from taches.js');
ok(tachesSource.indexOf('tachesManualSync') !== -1,
   'tachesManualSync still present in taches.js');
ok(tachesSource.indexOf('renderTachePage') !== -1,
   'renderTachePage still present in taches.js');
ok(tachesSource.indexOf('getTaches') !== -1,
   'getTaches still present in taches.js');

// Line count should be reduced (was 644, now ~591)
var lineCount = tachesSource.split('\n').length;
ok(lineCount < 635 && lineCount > 550,
   'taches.js line count reduced to ~591 (got ' + lineCount + ')');

// ── SECTION 10: Stage 2A-2D regression ───────────────────────────────
section('10. Stage 2A-2D regression');

load(sb, 'js/plugins/production.plugin.js');
load(sb, 'js/plugins/dashboard.plugin.js');
load(sb, 'js/plugins/planning.plugin.js');
load(sb, 'js/plugins/contacts.plugin.js');
load(sb, 'js/plugins/notes.plugin.js');
load(sb, 'js/plugins/calendar.plugin.js');

ok(sb.Platform.getPlugin('production') !== null, 'production plugin unaffected');
ok(sb.Platform.getPlugin('dashboard')  !== null, 'dashboard plugin unaffected');
ok(sb.Platform.getPlugin('planning')   !== null, 'planning plugin unaffected');
ok(sb.Platform.getPlugin('tasks')      !== null, 'tasks runtime plugin still registered');

var prod = sb.Platform.getPlugin('production');
ok(prod && prod.routes.length === 30,            'production retains 30 routes');

ok(typeof sb.Shell.sidebar === 'object',         'Shell.sidebar unaffected');
ok(typeof sb.Plugin.create === 'function',       'Plugin SDK unaffected');

// ── Results ───────────────────────────────────────────────────────────
_results.forEach(function (r) { console.log(r); });
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) { process.exit(1); }
