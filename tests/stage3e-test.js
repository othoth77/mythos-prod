// =====================================================
// MYTHOS OS — Stage 3E automated tests
// tests/stage3e-test.js
//
// Covers: calendar.runtime.js — plugin registration,
// onBoot (no-op, no own storage), onReady lifecycle,
// provider aggregation via MythosCalendar, navigation,
// backward compatibility, and regressions.
//
// Run with: node tests/stage3e-test.js
// =====================================================
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');
var cp   = require('child_process');

var BASE  = path.resolve(__dirname, '..');
var _pass = 0, _fail = 0, _results = [];

function ok(cond, label) {
  if (cond) { _pass++; _results.push('  PASS ' + label); }
  else       { _fail++; _results.push('  FAIL ' + label); }
}
function section(title) { _results.push('\n' + title); }

// ── Sample data ───────────────────────────────────────────────────────────
var SAMPLE_TACHES = [
  { id: 'tch_001', note: 'Préparer présentation budget', type: 'urgente',
    dueDate: '2026-08-05', archived: false, complete: false, updatedAt: '2026-07-01' },
  { id: 'tch_002', note: 'Contacter client Aziz', type: 'importante',
    dueDate: '2026-08-20', archived: false, complete: false, updatedAt: '2026-07-01' },
  { id: 'tch_003', note: 'Archivée', type: 'simple',
    dueDate: '2026-08-10', archived: true, complete: false, updatedAt: '2026-07-01' }
];

var SAMPLE_RAPPELS = [
  { id: 'rpl_001', titre: 'Réunion trimestrielle', dateDebut: '2026-08-01', periode: 'mois',
    details: 'Discussion bilan mensuel', type: 'Administratif', createdAt: '2026-07-01' },
  { id: 'rpl_002', titre: 'Déclaration fiscale', dateDebut: '2026-08-15', periode: 'annee',
    details: 'Dépôt formulaire TVA', type: 'Fiscal', createdAt: '2026-07-01' }
];

// ── Sandbox factory ──────────────────────────────────────────────────────
function makeSandbox(overrides) {
  var _lsStore = {};
  var _showViewLog = [];
  var _renderCalLog = [];

  var base = {
    document: {
      readyState: 'complete',
      createElement: function(tag) {
        return {
          _tag: tag, className: '', innerHTML: '', textContent: '',
          style: { cssText: '' }, _attrs: {}, onclick: null,
          setAttribute: function(k, v) { this._attrs[k] = v; },
          querySelector: function() { return null; }
        };
      },
      getElementById:   function() { return null; },
      querySelector:    function() { return null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: function() {} }
    },
    window: {
      addEventListener: function() {},
      alert:   function() {},
      confirm: function() { return true; },
      prompt:  function(m, d) { return d || null; }
    },
    location: { hash: '' },
    localStorage: {
      _store: _lsStore,
      getItem:    function(k) { return Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null; },
      setItem:    function(k, v) { _lsStore[k] = String(v); },
      removeItem: function(k) { delete _lsStore[k]; }
    },
    fetch: function() {
      return Promise.resolve({ ok: true, json: function() { return Promise.resolve({}); } });
    },
    STORE: {
      rdvs: function() { return []; }
    },
    showView: function(v) { _showViewLog.push(v); },
    _showViewLog: _showViewLog,
    _renderCalLog: _renderCalLog,
    // stubs needed by tasks.runtime.js
    getTaches:                 function() { return SAMPLE_TACHES; },
    tachesOpenModal:           function() {},
    renderTachePage:           function() {},
    renderTachesDashboard:     function() {},
    renderTachesInCalendrier:  function() {},
    renderCalendrier:          function() { _renderCalLog.push('called'); },
    updateDashboardStats:      function() {},
    // stubs needed by planning.runtime.js
    getRappels:                function() { return SAMPLE_RAPPELS; },
    getNextRappelDate:         function(d) { return d; },
    openRappelsListModal:      function() {},
    // Node globals
    console:               console,
    Promise:               Promise,
    JSON:                  JSON,
    Date:                  Date,
    Array:                 Array,
    Object:                Object,
    String:                String,
    Math:                  Math,
    RegExp:                RegExp,
    Error:                 Error,
    Boolean:               Boolean,
    Number:                Number,
    parseInt:              parseInt,
    parseFloat:            parseFloat,
    isNaN:                 isNaN,
    isFinite:              isFinite,
    undefined:             undefined,
    setTimeout:            setTimeout,
    clearTimeout:          clearTimeout,
    setInterval:           setInterval,
    clearInterval:         clearInterval,
    requestAnimationFrame: function(fn) { setTimeout(fn, 0); }
  };
  Object.assign(base, overrides || {});
  return vm.createContext(base);
}

// Load a file into sandbox
function load(ctx, rel) {
  var src = fs.readFileSync(path.join(BASE, rel), 'utf8');
  vm.runInContext(src, ctx);
}

// Helper: load full service stack + calendar.runtime.js
function loadCalendarRuntime(sb) {
  load(sb, 'js/core/events.js');
  load(sb, 'js/core/platform.js');
  load(sb, 'js/core/shell.js');
  load(sb, 'js/core/services/search.js');
  load(sb, 'js/core/services/calendar.js');
  load(sb, 'js/core/services/widgets.js');
  load(sb, 'js/core/services/notifications.js');
  load(sb, 'js/core/services/dialogs.js');
  load(sb, 'js/core/services/plugin-services.js');
  load(sb, 'js/core/plugin-sdk.js');
  load(sb, 'js/plugins/calendar.runtime.js');
}

// Helper: load full stack including tasks + planning providers
function loadFullStack(sb) {
  load(sb, 'js/core/events.js');
  load(sb, 'js/core/platform.js');
  load(sb, 'js/core/shell.js');
  load(sb, 'js/core/services/search.js');
  load(sb, 'js/core/services/calendar.js');
  load(sb, 'js/core/services/widgets.js');
  load(sb, 'js/core/services/notifications.js');
  load(sb, 'js/core/services/dialogs.js');
  load(sb, 'js/core/services/plugin-services.js');
  load(sb, 'js/core/plugin-sdk.js');
  load(sb, 'js/plugins/calendar.runtime.js');
  load(sb, 'js/plugins/tasks.runtime.js');
  load(sb, 'js/plugins/planning.runtime.js');
}

// ── Run all tests (async IIFE) ───────────────────────────────────────────
(async function() {

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: Architecture & structure
  // ══════════════════════════════════════════════════════════════════════
  section('1. Architecture & structure');
  {
    var htmlRaw = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

    ok(htmlRaw.indexOf('calendar.runtime.js') !== -1,
       'calendar.runtime.js present in index.html');
    ok(htmlRaw.indexOf('calendar.plugin.js') === -1,
       'calendar.plugin.js removed from index.html');

    var rtPath = path.join(BASE, 'js/plugins/calendar.runtime.js');
    ok(fs.existsSync(rtPath), 'calendar.runtime.js exists on disk');

    // Loading order checks
    var posSDK      = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
    var posRuntime  = htmlRaw.indexOf('src="js/plugins/calendar.runtime.js');
    var posTasks    = htmlRaw.indexOf('src="js/plugins/tasks.runtime.js');
    var posApp      = htmlRaw.indexOf('src="js/app.js');

    ok(posSDK !== -1 && posRuntime !== -1 && posSDK < posRuntime,
       'plugin-sdk loaded before calendar.runtime');
    ok(posRuntime !== -1 && posTasks !== -1 && posRuntime < posTasks,
       'calendar.runtime loaded before tasks.runtime');
    ok(posRuntime !== -1 && posApp !== -1 && posRuntime < posApp,
       'calendar.runtime loaded before app.js');

    // Key identifiers in file
    var rtSrc = fs.readFileSync(rtPath, 'utf8');
    ok(rtSrc.indexOf('_CALENDAR_RT_STATE') !== -1, 'file contains _CALENDAR_RT_STATE');
    ok(rtSrc.indexOf("'calendrier'") !== -1 || rtSrc.indexOf('"calendrier"') !== -1,
       'file contains route id "calendrier"');
    ok(rtSrc.indexOf('_calendarInit') !== -1, 'file contains _calendarInit');

    // Calendar is consumer: no defineSearch, no defineCalendar
    ok(rtSrc.indexOf('.defineSearch(') === -1,
       'file does not call .defineSearch() — Calendar has no own data');
    ok(rtSrc.indexOf('.defineCalendar(') === -1,
       'file does not call .defineCalendar() — Calendar is consumer, not producer');

    // No forced render at init
    // Check _calendarInit does not call renderCalendrier directly
    // (we verify this in lifecycle section too)
    ok(rtSrc.indexOf('.defineStorage([])') !== -1 || rtSrc.indexOf(".defineStorage([])") !== -1,
       'file calls defineStorage([]) — calendar owns no storage');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Plugin registration
  // ══════════════════════════════════════════════════════════════════════
  section('2. Plugin registration');
  {
    var sb = makeSandbox();
    loadCalendarRuntime(sb);

    ok(sb.Platform.hasPlugin('calendar'), 'Platform.hasPlugin(calendar)');

    var m = sb.Platform.getPlugin('calendar');
    ok(m && m.id === 'calendar',         'manifest id = calendar');
    ok(m && m.label === 'Calendrier',    'manifest label = Calendrier');
    ok(m && m.version === '1.0.0',       'manifest version = 1.0.0');
    ok(m && m.type === 'shared',         'manifest type = shared');

    // Routes
    ok(Array.isArray(m.routes) && m.routes.length >= 1,
       'manifest has at least 1 route');
    ok(m.routes.some(function(r) { return r.id === 'calendrier'; }),
       'routes includes id "calendrier"');

    // Storage: empty (Calendar owns no keys)
    ok(Array.isArray(m.storageKeys) && m.storageKeys.length === 0,
       'storageKeys is empty array (Calendar owns no storage)');

    ok(typeof m.onBoot === 'function',  'onBoot is a function');
    ok(typeof m.onReady === 'function', 'onReady is a function');

    // No search provider (Calendar has no own data)
    ok(!m.search || !m.search.handler,
       'no search.handler on manifest (Calendar is consumer, not data owner)');

    // No calendar provider (Calendar is the consumer)
    ok(!m.calendar || !m.calendar.provider,
       'no calendar.provider on manifest (Calendar is the consumer)');

    // Menu
    ok(m.menu && m.menu.section === 'Général', 'menu.section = Général');
    ok(m.menu && m.menu.order === 2,           'menu.order = 2');
    ok(m.menu && m.menu.icon === 'calendar',   'menu.icon = calendar');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: Lifecycle
  // ══════════════════════════════════════════════════════════════════════
  section('3. Lifecycle');
  {
    // Not initialized before Platform.ready()
    var sb = makeSandbox();
    loadCalendarRuntime(sb);
    ok(sb._CALENDAR_RT_STATE.initialized === false,
       'not initialized before Platform.ready()');

    sb.Platform.boot();
    ok(sb._CALENDAR_RT_STATE.initialized === false,
       'not initialized after boot() but before ready()');

    sb.Platform.ready();
    ok(sb._CALENDAR_RT_STATE.initialized === true,
       'initialized after Platform.ready()');

    // Second ready() call — idempotent
    sb.Platform.ready();
    ok(sb._CALENDAR_RT_STATE.initialized === true,
       'still initialized on second Platform.ready()');

    // Platform.boot() safe before ready()
    var sbBoot = makeSandbox();
    loadCalendarRuntime(sbBoot);
    var bThrew = false;
    try { sbBoot.Platform.boot(); } catch(e) { bThrew = true; }
    ok(!bThrew, 'Platform.boot() safe before ready()');

    // window.load fallback
    var sbFallback = makeSandbox();
    var _loadListeners = [];
    sbFallback.window.addEventListener = function(ev, fn) {
      if (ev === 'load') _loadListeners.push(fn);
    };
    loadCalendarRuntime(sbFallback);
    ok(sbFallback._CALENDAR_RT_STATE.initialized === false,
       'fallback: not initialized before window.load fires');
    _loadListeners.forEach(function(fn) { fn(); });
    ok(sbFallback._CALENDAR_RT_STATE.initialized === true,
       'initialized via window.load fallback');

    // _calendarInit() called twice does not crash
    var sbDbl = makeSandbox();
    loadCalendarRuntime(sbDbl);
    sbDbl.Platform.boot();
    sbDbl.Platform.ready();
    var dblThrew = false;
    try { sbDbl._calendarInit(); sbDbl._calendarInit(); } catch(e) { dblThrew = true; }
    ok(!dblThrew, '_calendarInit() called twice does not crash');

    // _CALENDAR_RT_STATE.initialized = true after init
    ok(sbDbl._CALENDAR_RT_STATE.initialized === true,
       '_CALENDAR_RT_STATE.initialized = true after init');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: Storage validation (onBoot — Calendar has no own storage)
  // ══════════════════════════════════════════════════════════════════════
  section('4. Storage validation (onBoot)');
  {
    // Calendar has no own storage keys — onBoot must not crash
    // regardless of what is in localStorage.

    // Test 1: empty localStorage — no crash
    var sb1 = makeSandbox();
    loadCalendarRuntime(sb1);
    var t1Threw = false;
    try { sb1.Platform.boot(); } catch(e) { t1Threw = true; }
    ok(!t1Threw, 'onBoot does not crash with empty localStorage');

    // Test 2: malformed mp_rdvs (production data) present — no crash, no reset
    var sb2 = makeSandbox();
    loadCalendarRuntime(sb2);
    sb2.localStorage.setItem('mp_rdvs', 'NOT_JSON!!!');
    var t2Threw = false;
    try { sb2.Platform.boot(); } catch(e) { t2Threw = true; }
    ok(!t2Threw, 'onBoot does not crash with malformed mp_rdvs');
    ok(sb2.localStorage.getItem('mp_rdvs') === 'NOT_JSON!!!',
       'onBoot does not touch mp_rdvs (owned by production plugin)');

    // Test 3: malformed mp_rappels (planning data) present — no crash, no reset
    var sb3 = makeSandbox();
    loadCalendarRuntime(sb3);
    sb3.localStorage.setItem('mp_rappels', 'MALFORMED');
    var t3Threw = false;
    try { sb3.Platform.boot(); } catch(e) { t3Threw = true; }
    ok(!t3Threw, 'onBoot does not crash with malformed mp_rappels');
    ok(sb3.localStorage.getItem('mp_rappels') === 'MALFORMED',
       'onBoot does not touch mp_rappels (owned by planning plugin)');

    // Test 4: valid mp_rdvs preserved after boot
    var sb4 = makeSandbox();
    loadCalendarRuntime(sb4);
    var validRdvs = JSON.stringify([{ id: 'rdv_001', date: '2026-08-01' }]);
    sb4.localStorage.setItem('mp_rdvs', validRdvs);
    sb4.Platform.boot();
    ok(sb4.localStorage.getItem('mp_rdvs') === validRdvs,
       'valid mp_rdvs preserved after onBoot (Calendar does not own it)');

    // Test 5: valid mp_taches preserved after boot
    var sb5 = makeSandbox();
    loadCalendarRuntime(sb5);
    var validTaches = JSON.stringify([{ id: 'tch_001', note: 'test', dueDate: '2026-08-05' }]);
    sb5.localStorage.setItem('mp_taches', validTaches);
    sb5.Platform.boot();
    ok(sb5.localStorage.getItem('mp_taches') === validTaches,
       'valid mp_taches preserved after onBoot (Calendar does not own it)');

    // Test 6: multiple malformed keys — boot safe, leaves all untouched
    var sb6 = makeSandbox();
    loadCalendarRuntime(sb6);
    sb6.localStorage.setItem('mp_rdvs',    'BAD1');
    sb6.localStorage.setItem('mp_taches',  'BAD2');
    sb6.localStorage.setItem('mp_rappels', 'BAD3');
    var t6Threw = false;
    try { sb6.Platform.boot(); } catch(e) { t6Threw = true; }
    ok(!t6Threw, 'onBoot safe when multiple malformed keys present');
    ok(sb6.localStorage.getItem('mp_rdvs')    === 'BAD1' &&
       sb6.localStorage.getItem('mp_taches')  === 'BAD2' &&
       sb6.localStorage.getItem('mp_rappels') === 'BAD3',
       'onBoot leaves all non-owned keys untouched');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Provider aggregation via MythosCalendar
  // ══════════════════════════════════════════════════════════════════════
  section('5. Provider aggregation (MythosCalendar)');
  {
    var sb = makeSandbox();
    sb.localStorage.setItem('mp_taches',  JSON.stringify(SAMPLE_TACHES));
    sb.localStorage.setItem('mp_rappels', JSON.stringify(SAMPLE_RAPPELS));
    loadFullStack(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // MythosCalendar available
    ok(typeof sb.MythosCalendar !== 'undefined' && typeof sb.MythosCalendar.getEvents === 'function',
       'MythosCalendar is available in full sandbox');

    // tasks provider registered
    ok(sb.MythosCalendar.hasProvider('tasks'),
       'tasks provider registered (by tasks.runtime.js)');

    // planning provider registered
    ok(sb.MythosCalendar.hasProvider('planning'),
       'planning provider registered (by planning.runtime.js)');

    // getEvents returns a Promise
    var range = { start: '2026-08-01', end: '2026-09-30' };
    var evPromise = sb.MythosCalendar.getEvents(range);
    ok(evPromise && typeof evPromise.then === 'function',
       'MythosCalendar.getEvents(range) returns a Promise');

    var allEvents = await evPromise;
    ok(Array.isArray(allEvents), 'getEvents resolves to an array');

    // events from tasks provider included (non-archived, with dueDate in range)
    var taskEvents = allEvents.filter(function(e) { return e.providerId === 'tasks'; });
    ok(taskEvents.length >= 1,
       'events from tasks provider included');

    // events from planning provider included
    var planEvents = allEvents.filter(function(e) { return e.providerId === 'planning'; });
    ok(planEvents.length >= 1,
       'events from planning provider included');

    // all events have required fields
    ok(allEvents.every(function(e) {
         return typeof e.id === 'string' &&
                typeof e.title === 'string' &&
                (typeof e.start === 'string' || e.start === null) &&
                typeof e.allDay !== 'undefined' &&
                typeof e.providerId === 'string';
       }),
       'all events have id, title, start, allDay, providerId');

    // archived tasks NOT included
    var archivedInEvents = taskEvents.filter(function(e) {
      return e.data && e.data.id === 'tch_003';
    });
    ok(archivedInEvents.length === 0,
       'archived tasks excluded from calendar events');

    // events sorted chronologically (start ascending)
    var starts = allEvents.map(function(e) { return e.start || ''; }).filter(Boolean);
    var sorted = starts.slice().sort();
    ok(JSON.stringify(starts) === JSON.stringify(sorted),
       'events sorted chronologically by start date');

    // missing provider does not crash calendar init
    var sbMissing = makeSandbox();
    loadCalendarRuntime(sbMissing);
    // Only calendar loaded — tasks/planning providers absent
    sbMissing.Platform.boot();
    var missingThrew = false;
    try { sbMissing.Platform.ready(); } catch(e) { missingThrew = true; }
    ok(!missingThrew,
       'missing providers do not crash calendar init (calendar init is no-op)');

    // provider returning [] is handled
    var sbEmpty = makeSandbox();
    sbEmpty.getTaches  = function() { return []; };
    sbEmpty.getRappels = function() { return []; };
    loadFullStack(sbEmpty);
    sbEmpty.Platform.boot();
    sbEmpty.Platform.ready();
    var emptyEvs = await sbEmpty.MythosCalendar.getEvents(range);
    ok(Array.isArray(emptyEvs),
       'provider returning [] handled — getEvents still resolves to array');

    // provider throwing does not crash getEvents
    var sbThrow = makeSandbox();
    loadCalendarRuntime(sbThrow);
    load(sbThrow, 'js/core/events.js') || true;
    // Register a throwing provider directly
    var sbThrow2 = makeSandbox();
    loadFullStack(sbThrow2);
    sbThrow2.Platform.boot();
    sbThrow2.Platform.ready();
    // Override the tasks provider to throw
    sbThrow2.MythosCalendar.unregisterProvider('tasks');
    sbThrow2.MythosCalendar.registerProvider({
      id:        'tasks',
      label:     'Broken Tasks',
      order:     3,
      getEvents: function() { throw new Error('simulated provider error'); }
    });
    var throwEvs, throwThrew = false;
    try { throwEvs = await sbThrow2.MythosCalendar.getEvents(range); } catch(e) { throwThrew = true; }
    // Whether it returns partial results or empty array — it must not crash the call chain
    ok(!throwThrew || (Array.isArray(throwEvs)),
       'provider throwing does not crash getEvents chain');

    // range filtering works: events outside range excluded
    var narrowRange = { start: '2026-08-01', end: '2026-08-10' };
    var narrowEvs = await sb.MythosCalendar.getEvents(narrowRange);
    // tch_002 has dueDate 2026-08-20 — outside narrow range — should be excluded
    var outsideRange = narrowEvs.filter(function(e) {
      return e.data && e.data.id === 'tch_002';
    });
    ok(outsideRange.length === 0,
       'range filtering works: events outside range excluded');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Navigation
  // ══════════════════════════════════════════════════════════════════════
  section('6. Navigation');
  {
    var sb = makeSandbox();
    loadCalendarRuntime(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // showView still available as global
    ok(typeof sb.showView === 'function',
       'showView still available as global after loading calendar.runtime');

    // showView('calendrier') callable without crash
    var navThrew = false;
    try { sb.showView('calendrier'); } catch(e) { navThrew = true; }
    ok(!navThrew, 'showView("calendrier") callable without crash');
    ok(sb._showViewLog.indexOf('calendrier') !== -1,
       'showView("calendrier") call is recorded');

    // manifest routes match discovered route
    var m = sb.Platform.getPlugin('calendar');
    ok(m && Array.isArray(m.routes) && m.routes.some(function(r) { return r.id === 'calendrier'; }),
       'manifest routes contain "calendrier"');

    // Shell.navigation accessible
    ok(sb.Shell && typeof sb.Shell.navigation === 'object',
       'Shell.navigation accessible');

    // Other showView calls not broken by loading calendar.runtime
    var otherThrew = false;
    try { sb.showView('dashboard'); sb.showView('tache'); } catch(e) { otherThrew = true; }
    ok(!otherThrew, 'other showView calls not broken by loading calendar.runtime');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Backward compatibility
  // ══════════════════════════════════════════════════════════════════════
  section('7. Backward compatibility');
  {
    // Platform.boot()/ready() safe without calendar.runtime
    {
      var sb = makeSandbox();
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try { sb.Platform.boot(); sb.Platform.ready(); } catch(e) { threw = true; }
      ok(!threw, 'Platform.boot()/ready() safe without calendar.runtime');
    }

    // No crash when MythosCalendar absent
    {
      var sb = makeSandbox({ MythosCalendar: undefined });
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try {
        load(sb, 'js/plugins/calendar.runtime.js');
        sb.Platform.boot();
        sb.Platform.ready();
      } catch(e) { threw = true; }
      ok(!threw, 'no crash when MythosCalendar absent');
      ok(sb._CALENDAR_RT_STATE.initialized === true,
         'still initializes without MythosCalendar');
    }

    // No crash when Shell absent
    {
      var sbNoShell = makeSandbox();
      load(sbNoShell, 'js/core/events.js');
      load(sbNoShell, 'js/core/platform.js');
      // NO shell.js
      load(sbNoShell, 'js/core/plugin-sdk.js');
      var threw = false;
      try { load(sbNoShell, 'js/plugins/calendar.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'calendar.runtime loads without Shell');
    }

    // No crash when Platform absent
    {
      var sbNoPlat = makeSandbox();
      sbNoPlat.Plugin = {
        create: function(manifest) {
          var builder = {
            defineMenu:     function() { return this; },
            defineRoutes:   function() { return this; },
            defineStorage:  function() { return this; },
            defineSearch:   function() { return this; },
            defineCalendar: function() { return this; },
            build:          function() { return {}; }
          };
          return builder;
        }
      };
      var threw = false;
      try { load(sbNoPlat, 'js/plugins/calendar.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'calendar.runtime loads without Platform');
    }

    // onBoot safe with malformed localStorage
    {
      var sbMalf = makeSandbox();
      sbMalf.localStorage.setItem('mp_rdvs',    'MALFORMED_DATA');
      sbMalf.localStorage.setItem('mp_taches',  '{not_valid_json');
      sbMalf.localStorage.setItem('mp_rappels', 'bad_data');
      loadCalendarRuntime(sbMalf);
      var threw = false;
      try { sbMalf.Platform.boot(); } catch(e) { threw = true; }
      ok(!threw, 'onBoot recovers from malformed localStorage without crash');
    }

    // tasks plugin unaffected when calendar disabled
    {
      var sbNoCalendar = makeSandbox();
      load(sbNoCalendar, 'js/core/events.js');
      load(sbNoCalendar, 'js/core/platform.js');
      load(sbNoCalendar, 'js/core/shell.js');
      load(sbNoCalendar, 'js/core/services/search.js');
      load(sbNoCalendar, 'js/core/services/calendar.js');
      load(sbNoCalendar, 'js/core/services/widgets.js');
      load(sbNoCalendar, 'js/core/services/notifications.js');
      load(sbNoCalendar, 'js/core/services/dialogs.js');
      load(sbNoCalendar, 'js/core/services/plugin-services.js');
      load(sbNoCalendar, 'js/core/plugin-sdk.js');
      load(sbNoCalendar, 'js/plugins/tasks.runtime.js');
      load(sbNoCalendar, 'js/plugins/planning.runtime.js');
      // Do NOT load calendar.runtime
      sbNoCalendar.Platform.boot();
      sbNoCalendar.Platform.ready();
      ok(sbNoCalendar.Platform.hasPlugin('tasks') && sbNoCalendar.Platform.hasPlugin('planning')
         && !sbNoCalendar.Platform.hasPlugin('calendar'),
         'tasks/planning plugins unaffected when calendar is not loaded');
    }

    // _calendarInit() safe when MythosCalendar absent
    {
      var sbNoCal = makeSandbox({ MythosCalendar: undefined });
      load(sbNoCal, 'js/core/events.js');
      load(sbNoCal, 'js/core/platform.js');
      load(sbNoCal, 'js/core/shell.js');
      load(sbNoCal, 'js/core/plugin-sdk.js');
      load(sbNoCal, 'js/plugins/calendar.runtime.js');
      var threw = false;
      try { sbNoCal._calendarInit(); } catch(e) { threw = true; }
      ok(!threw, '_calendarInit() safe when MythosCalendar absent');
    }

    // renderCalendrier still present as global (stays in app.js)
    {
      var sbRender = makeSandbox();
      loadCalendarRuntime(sbRender);
      sbRender.Platform.boot();
      sbRender.Platform.ready();
      ok(typeof sbRender.renderCalendrier === 'function',
         'renderCalendrier still present as global (stays in app.js scope)');
    }

    // calendar init does NOT call renderCalendrier() directly
    {
      var sbNoRender = makeSandbox();
      var renderCalled = false;
      sbNoRender.renderCalendrier = function() { renderCalled = true; };
      loadCalendarRuntime(sbNoRender);
      sbNoRender.Platform.boot();
      sbNoRender.Platform.ready();
      ok(!renderCalled,
         'calendar init does not call renderCalendrier() directly (no forced render at init)');
    }

    // notes/contacts plugins unaffected when calendar changes
    {
      var sbOthers = makeSandbox();
      load(sbOthers, 'js/core/events.js');
      load(sbOthers, 'js/core/platform.js');
      load(sbOthers, 'js/core/shell.js');
      load(sbOthers, 'js/core/services/search.js');
      load(sbOthers, 'js/core/services/calendar.js');
      load(sbOthers, 'js/core/services/widgets.js');
      load(sbOthers, 'js/core/services/notifications.js');
      load(sbOthers, 'js/core/services/dialogs.js');
      load(sbOthers, 'js/core/services/plugin-services.js');
      load(sbOthers, 'js/core/plugin-sdk.js');
      load(sbOthers, 'js/plugins/calendar.runtime.js');
      load(sbOthers, 'js/plugins/contacts.runtime.js');
      load(sbOthers, 'js/plugins/notes.runtime.js');
      sbOthers.Platform.boot();
      sbOthers.Platform.ready();
      ok(sbOthers.Platform.hasPlugin('contacts') && sbOthers.Platform.hasPlugin('notes'),
         'contacts/notes plugins unaffected when calendar.runtime loaded');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Regression (prior test suites)
  // ══════════════════════════════════════════════════════════════════════
  section('8. Regression');
  {
    var suites = [
      'tests/stage3d-test.js',
      'tests/stage3c-test.js',
      'tests/stage3b-test.js',
      'tests/stage3a5-test.js',
      'tests/stage3a-test.js',
      'tests/stage2d-test.js',
      'tests/stage1c-part1-test.js'
    ];
    suites.forEach(function(suite) {
      var suitePath = path.join(BASE, suite);
      if (!fs.existsSync(suitePath)) {
        ok(false, suite + ' — FILE NOT FOUND');
        return;
      }
      try {
        var out = cp.execSync('node ' + JSON.stringify(suitePath), {
          cwd: BASE,
          timeout: 60000,
          encoding: 'utf8'
        });
        var lines = out.trim().split('\n');
        var finalLine = lines[lines.length - 1];
        var failLines = lines.filter(function(l) { return l.indexOf('FAIL') !== -1; });
        var passed = failLines.length === 0 && finalLine.indexOf('tests passed') !== -1;
        ok(passed, suite + ' all tests passed [' + finalLine.trim() + ']');
      } catch(e) {
        var msg = e.stdout ? e.stdout.trim().split('\n').pop() : String(e).slice(0, 120);
        ok(false, suite + ' FAILED — ' + msg);
      }
    });
  }

  // ── Final report ─────────────────────────────────────────────────────
  _results.forEach(function(r) { console.log(r); });
  var total = _pass + _fail;
  console.log('\n' + (_fail === 0 ? '✓' : '✗') + ' ' + _pass + '/' + total + ' tests passed');
  if (_fail > 0) process.exit(1);

})().catch(function(e) { console.error(e); process.exit(1); });
