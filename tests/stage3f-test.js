// =====================================================
// MYTHOS OS — Stage 3F automated tests
// tests/stage3f-test.js
//
// Covers: dashboard.runtime.js — plugin registration,
// onBoot (no-op, no own storage), onReady lifecycle,
// aggregation consumer pattern, widget registration,
// navigation, backward compatibility, and regressions.
//
// Run with: node tests/stage3f-test.js
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
    dueDate: '2026-08-20', archived: false, complete: false, updatedAt: '2026-07-01' }
];

var SAMPLE_RAPPELS = [
  { id: 'rpl_001', titre: 'Réunion trimestrielle', dateDebut: '2026-08-01', periode: 'mois',
    details: 'Discussion bilan mensuel', type: 'Administratif', createdAt: '2026-07-01' }
];

var SAMPLE_CONTACTS = [
  { id: 'ct_001', nom: 'Ben Ali', prenom: 'Riadh', tel1: '+21620000001', updatedAt: '2026-07-01' }
];

// ── Sandbox factory ──────────────────────────────────────────────────────
function makeSandbox(overrides) {
  var _lsStore = {};
  var _showViewLog = [];

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
      invoices:              function() { return []; },
      clients:               function() { return []; },
      oms:                   function() { return []; },
      contracts:             function() { return []; },
      bankEntries:           function() { return []; },
      rdvs:                  function() { return []; },
      expenses:              function() { return []; },
      cashEntries:           function() { return []; },
      representations:       function() { return []; },
      documents:             function() { return []; },
      validatedInscriptions: function() { return []; },
      repertoireContacts:    function() { return SAMPLE_CONTACTS; }
    },
    showView: function(v) { _showViewLog.push(v); },
    _showViewLog: _showViewLog,
    // stubs needed by tasks.runtime.js
    getTaches:                function() { return SAMPLE_TACHES; },
    tachesOpenModal:          function() {},
    renderTachePage:          function() {},
    renderTachesDashboard:    function() {},
    renderTachesInCalendrier: function() {},
    updateDashboardStats:     function() {},
    // stubs needed by planning.runtime.js
    getRappels:               function() { return SAMPLE_RAPPELS; },
    getNextRappelDate:        function(d) { return d; },
    openRappelsListModal:     function() {},
    // stubs needed by contacts.runtime.js
    renderRepertoireContactsPage:    function() {},
    renderRepertoireImportsHistory:  function() {},
    _rcRenderDuplicatesBanner:       function() {},
    _rcFilterBatchId:                null,
    // stubs needed by notes.runtime.js
    _rdRender:               function() {},
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

// Helper: load full service stack + dashboard.runtime.js only
function loadDashboardRuntime(sb) {
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
  load(sb, 'js/plugins/dashboard.runtime.js');
}

// Helper: load full stack including all runtime plugins
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
  load(sb, 'js/plugins/dashboard.runtime.js');
  load(sb, 'js/plugins/calendar.runtime.js');
  load(sb, 'js/plugins/tasks.runtime.js');
  load(sb, 'js/plugins/planning.runtime.js');
  load(sb, 'js/plugins/contacts.runtime.js');
  load(sb, 'js/plugins/notes.runtime.js');
}

// ── Run all tests (async IIFE) ───────────────────────────────────────────
(async function() {

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: Architecture & structure
  // ══════════════════════════════════════════════════════════════════════
  section('1. Architecture & structure');
  {
    var htmlRaw = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

    ok(htmlRaw.indexOf('dashboard.runtime.js') !== -1,
       'dashboard.runtime.js present in index.html');
    ok(htmlRaw.indexOf('dashboard.plugin.js') === -1,
       'dashboard.plugin.js removed from index.html');

    var rtPath = path.join(BASE, 'js/plugins/dashboard.runtime.js');
    ok(fs.existsSync(rtPath), 'dashboard.runtime.js exists on disk');

    // Loading order checks
    var posSDK       = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
    var posRuntime   = htmlRaw.indexOf('src="js/plugins/dashboard.runtime.js');
    var posCalendar  = htmlRaw.indexOf('src="js/plugins/calendar.runtime.js');
    var posTasks     = htmlRaw.indexOf('src="js/plugins/tasks.runtime.js');
    var posApp       = htmlRaw.indexOf('src="js/app.js');

    ok(posSDK !== -1 && posRuntime !== -1 && posSDK < posRuntime,
       'plugin-sdk loaded before dashboard.runtime');
    ok(posRuntime !== -1 && posCalendar !== -1 && posRuntime < posCalendar,
       'dashboard.runtime loaded before calendar.runtime');
    ok(posRuntime !== -1 && posTasks !== -1 && posRuntime < posTasks,
       'dashboard.runtime loaded before tasks.runtime');
    ok(posRuntime !== -1 && posApp !== -1 && posRuntime < posApp,
       'dashboard.runtime loaded before app.js');

    // Key identifiers in file
    var rtSrc = fs.readFileSync(rtPath, 'utf8');
    ok(rtSrc.indexOf('_DASHBOARD_RT_STATE') !== -1,
       'file contains _DASHBOARD_RT_STATE');
    ok(rtSrc.indexOf('.defineSearch(') === -1,
       'file does not call .defineSearch() — Dashboard has no own data');
    ok(rtSrc.indexOf('.defineCalendar(') === -1,
       'file does not call .defineCalendar() — Dashboard is consumer, not producer');
    ok(rtSrc.indexOf('_dashboardInit') !== -1,
       'file contains _dashboardInit');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Plugin registration
  // ══════════════════════════════════════════════════════════════════════
  section('2. Plugin registration');
  {
    var sb = makeSandbox();
    loadDashboardRuntime(sb);

    ok(sb.Platform.hasPlugin('dashboard'), 'Platform.hasPlugin(dashboard)');

    var m = sb.Platform.getPlugin('dashboard');
    ok(m && m.id === 'dashboard',     'manifest id = dashboard');
    ok(m && m.label === 'Dashboard',  'manifest label = Dashboard');
    ok(m && m.version === '1.0.0',    'manifest version = 1.0.0');
    ok(m && m.type === 'shared',      'manifest type = shared');

    // Routes
    ok(Array.isArray(m.routes) && m.routes.length >= 1,
       'manifest has at least 1 route');
    ok(m.routes.some(function(r) { return r.id === 'dashboard'; }),
       'routes includes id "dashboard"');

    // Storage: empty (Dashboard owns no keys)
    ok(Array.isArray(m.storageKeys) && m.storageKeys.length === 0,
       'storageKeys is empty array (Dashboard owns no storage)');

    ok(typeof m.onBoot === 'function',  'onBoot is a function');
    ok(typeof m.onReady === 'function', 'onReady is a function');

    // No search provider (Dashboard has no own data)
    ok(!m.search || !m.search.handler,
       'no search.handler on manifest (Dashboard is consumer, not data owner)');

    // No calendar provider (Dashboard does not produce calendar events)
    ok(!m.calendar || !m.calendar.provider,
       'no calendar.provider on manifest (Dashboard is consumer)');

    // Menu fields
    ok(m.menu && m.menu.section === 'Général', 'menu.section = Général');
    ok(m.menu && m.menu.order === 1,           'menu.order = 1');
    ok(m.menu && m.menu.icon === 'dashboard',  'menu.icon = dashboard');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: Lifecycle
  // ══════════════════════════════════════════════════════════════════════
  section('3. Lifecycle');
  {
    // Not initialized before Platform.ready()
    var sb = makeSandbox();
    loadDashboardRuntime(sb);
    ok(sb._DASHBOARD_RT_STATE.initialized === false,
       'not initialized before Platform.ready()');

    sb.Platform.boot();
    ok(sb._DASHBOARD_RT_STATE.initialized === false,
       'not initialized after boot() but before ready()');

    sb.Platform.ready();
    ok(sb._DASHBOARD_RT_STATE.initialized === true,
       'initialized after Platform.ready()');

    // Second ready() call — idempotent
    sb.Platform.ready();
    ok(sb._DASHBOARD_RT_STATE.initialized === true,
       'still initialized on second Platform.ready()');

    // window.load fallback
    var sbFallback = makeSandbox();
    var _loadListeners = [];
    sbFallback.window.addEventListener = function(ev, fn) {
      if (ev === 'load') _loadListeners.push(fn);
    };
    loadDashboardRuntime(sbFallback);
    ok(sbFallback._DASHBOARD_RT_STATE.initialized === false,
       'fallback: not initialized before window.load fires');
    _loadListeners.forEach(function(fn) { fn(); });
    ok(sbFallback._DASHBOARD_RT_STATE.initialized === true,
       'initialized via window.load fallback');

    // _dashboardInit() called twice does not crash
    var sbDbl = makeSandbox();
    loadDashboardRuntime(sbDbl);
    sbDbl.Platform.boot();
    sbDbl.Platform.ready();
    var dblThrew = false;
    try { sbDbl._dashboardInit(); sbDbl._dashboardInit(); } catch(e) { dblThrew = true; }
    ok(!dblThrew, '_dashboardInit() called twice does not crash');

    // _DASHBOARD_RT_STATE.initialized = true after init
    ok(sbDbl._DASHBOARD_RT_STATE.initialized === true,
       '_DASHBOARD_RT_STATE.initialized = true after init');

    // Platform.boot() safe before ready()
    var sbBoot = makeSandbox();
    loadDashboardRuntime(sbBoot);
    var bThrew = false;
    try { sbBoot.Platform.boot(); } catch(e) { bThrew = true; }
    ok(!bThrew, 'Platform.boot() safe before ready()');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: Storage validation (onBoot — Dashboard has no own storage)
  // ══════════════════════════════════════════════════════════════════════
  section('4. Storage validation (onBoot)');
  {
    // Dashboard has no own storage keys — onBoot must not crash
    // regardless of what is in localStorage.

    // Test 1: empty localStorage — no crash
    var sb1 = makeSandbox();
    loadDashboardRuntime(sb1);
    var t1Threw = false;
    try { sb1.Platform.boot(); } catch(e) { t1Threw = true; }
    ok(!t1Threw, 'onBoot does not crash with empty localStorage');

    // Test 2: malformed mp_invoices (production data) present — no crash, no reset
    var sb2 = makeSandbox();
    loadDashboardRuntime(sb2);
    sb2.localStorage.setItem('mp_invoices', 'NOT_JSON!!!');
    var t2Threw = false;
    try { sb2.Platform.boot(); } catch(e) { t2Threw = true; }
    ok(!t2Threw, 'onBoot does not crash with malformed mp_invoices');
    ok(sb2.localStorage.getItem('mp_invoices') === 'NOT_JSON!!!',
       'onBoot does not touch mp_invoices (owned by production plugin)');

    // Test 3: malformed mp_taches (tasks data) present — no crash, no reset
    var sb3 = makeSandbox();
    loadDashboardRuntime(sb3);
    sb3.localStorage.setItem('mp_taches', 'MALFORMED');
    var t3Threw = false;
    try { sb3.Platform.boot(); } catch(e) { t3Threw = true; }
    ok(!t3Threw, 'onBoot does not crash with malformed mp_taches');
    ok(sb3.localStorage.getItem('mp_taches') === 'MALFORMED',
       'onBoot does not touch mp_taches (owned by tasks plugin)');

    // Test 4: valid data in other plugins' keys — preserved after boot
    var sb4 = makeSandbox();
    loadDashboardRuntime(sb4);
    var sampleData = JSON.stringify([{ id: 'inv_001', num: 'F001', status: 'paid' }]);
    sb4.localStorage.setItem('mp_invoices', sampleData);
    sb4.Platform.boot();
    ok(sb4.localStorage.getItem('mp_invoices') === sampleData,
       'onBoot preserves valid mp_invoices data');

    // Test 5: no valid data deleted after ready()
    var sb5 = makeSandbox();
    loadDashboardRuntime(sb5);
    sb5.localStorage.setItem('mp_rdvs', JSON.stringify([{ id: 'rdv_001' }]));
    sb5.Platform.boot();
    sb5.Platform.ready();
    ok(sb5.localStorage.getItem('mp_rdvs') !== null,
       'onReady/init does not delete mp_rdvs data');

    // Test 6: arbitrary key not touched by dashboard
    var sb6 = makeSandbox();
    loadDashboardRuntime(sb6);
    sb6.localStorage.setItem('mp_bank_entries', JSON.stringify([{ id: 'be_001' }]));
    sb6.Platform.boot();
    ok(sb6.localStorage.getItem('mp_bank_entries') !== null,
       'onBoot does not touch mp_bank_entries (not owned by Dashboard)');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Widget registration
  // ══════════════════════════════════════════════════════════════════════
  section('5. Widget registration');
  {
    // MythosWidgets available in full sandbox
    var sb = makeSandbox();
    loadDashboardRuntime(sb);
    ok(typeof sb.MythosWidgets !== 'undefined' && sb.MythosWidgets !== null,
       'MythosWidgets available in full sandbox');

    // _dashboardInit() does not crash when MythosWidgets is present
    var sb2 = makeSandbox();
    loadDashboardRuntime(sb2);
    var widgetThrew = false;
    try {
      sb2.Platform.boot();
      sb2.Platform.ready();
    } catch(e) { widgetThrew = true; }
    ok(!widgetThrew, '_dashboardInit() does not throw when MythosWidgets present');

    // Current stage: no widgets registered — MythosWidgets.register() not called
    // for invalid/undefined args (guard test)
    var sb3 = makeSandbox();
    var invalidRegisterCalled = false;
    loadDashboardRuntime(sb3);
    var origRegister = sb3.MythosWidgets.register.bind(sb3.MythosWidgets);
    // patch to detect if register was called with invalid args
    sb3.MythosWidgets.register = function(w) {
      if (!w || typeof w.id !== 'string' || !w.id) { invalidRegisterCalled = true; }
      return origRegister(w);
    };
    sb3.Platform.boot();
    sb3.Platform.ready();
    ok(!invalidRegisterCalled,
       '_dashboardInit() does not call MythosWidgets.register() with invalid args');

    // No duplicate registration on second _dashboardInit() call
    var sb4 = makeSandbox();
    loadDashboardRuntime(sb4);
    var registerCount = 0;
    var origReg4 = sb4.MythosWidgets.register.bind(sb4.MythosWidgets);
    sb4.MythosWidgets.register = function(w) { registerCount++; return origReg4(w); };
    sb4.Platform.boot();
    sb4.Platform.ready();
    var countAfterFirst = registerCount;
    sb4._dashboardInit(); // second call (guard should prevent re-registration)
    ok(registerCount === countAfterFirst,
       'second _dashboardInit() does not re-register widgets');

    // Shell.widgets compatibility — MythosWidgets forwards to Shell.widgets
    var sb5 = makeSandbox();
    loadDashboardRuntime(sb5);
    ok(typeof sb5.Shell !== 'undefined' && sb5.Shell.widgets,
       'Shell.widgets accessible after loading');
    ok(typeof sb5.Shell.widgets.getAll === 'function',
       'Shell.widgets.getAll() is a function');

    // No crash when MythosWidgets absent
    var sb6 = makeSandbox({ MythosWidgets: undefined });
    load(sb6, 'js/core/events.js');
    load(sb6, 'js/core/platform.js');
    load(sb6, 'js/core/shell.js');
    load(sb6, 'js/core/plugin-sdk.js');
    var noWidgetThrew = false;
    try {
      load(sb6, 'js/plugins/dashboard.runtime.js');
      sb6.Platform.boot();
      sb6.Platform.ready();
    } catch(e) { noWidgetThrew = true; }
    ok(!noWidgetThrew, '_dashboardInit() does not throw when MythosWidgets absent');

    // Widget zone check: MythosWidgets.getAll('dashboard') returns array (may be empty)
    var sb7 = makeSandbox();
    loadDashboardRuntime(sb7);
    sb7.Platform.boot();
    sb7.Platform.ready();
    var dashWidgets = sb7.MythosWidgets.getAll('dashboard');
    ok(Array.isArray(dashWidgets),
       'MythosWidgets.getAll("dashboard") returns an array');

    // _dashboardInit safe when all services absent
    var sb8 = makeSandbox({ MythosWidgets: undefined, MythosSearch: undefined, Shell: undefined, Platform: undefined });
    load(sb8, 'js/core/events.js');
    load(sb8, 'js/core/platform.js');
    load(sb8, 'js/core/plugin-sdk.js');
    var allAbsentThrew = false;
    try {
      load(sb8, 'js/plugins/dashboard.runtime.js');
      sb8._dashboardInit();
      sb8._dashboardInit(); // second call
    } catch(e) { allAbsentThrew = true; }
    ok(!allAbsentThrew, '_dashboardInit() safe when MythosWidgets/Shell/Search absent');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Aggregation consumer
  // ══════════════════════════════════════════════════════════════════════
  section('6. Aggregation consumer');
  {
    // Dashboard plugin registered in Platform
    var sb = makeSandbox();
    loadFullStack(sb);
    ok(sb.Platform.hasPlugin('dashboard'), 'Dashboard plugin registered in Platform');

    // tasks.runtime + dashboard.runtime co-exist without conflict
    ok(sb.Platform.hasPlugin('tasks') && sb.Platform.hasPlugin('dashboard'),
       'tasks.runtime + dashboard.runtime co-exist');

    // planning.runtime + dashboard.runtime co-exist
    ok(sb.Platform.hasPlugin('planning') && sb.Platform.hasPlugin('dashboard'),
       'planning.runtime + dashboard.runtime co-exist');

    // contacts.runtime + dashboard.runtime co-exist
    ok(sb.Platform.hasPlugin('contacts') && sb.Platform.hasPlugin('dashboard'),
       'contacts.runtime + dashboard.runtime co-exist');

    // MythosSearch has no 'dashboard' provider (Dashboard is consumer)
    var sbSearch = makeSandbox();
    loadDashboardRuntime(sbSearch);
    sbSearch.Platform.boot();
    sbSearch.Platform.ready();
    ok(!sbSearch.MythosSearch.hasProvider('dashboard'),
       'MythosSearch has no "dashboard" provider (Dashboard is consumer)');

    // MythosCalendar has no 'dashboard' provider
    ok(!sbSearch.MythosCalendar.hasProvider('dashboard'),
       'MythosCalendar has no "dashboard" provider');

    // Dashboard does not interfere with other providers
    var sbFull = makeSandbox();
    loadFullStack(sbFull);
    sbFull.Platform.boot();
    sbFull.Platform.ready();
    ok(sbFull.MythosSearch.hasProvider('tasks'),
       'tasks search provider unaffected by dashboard.runtime');
    ok(sbFull.MythosCalendar.hasProvider('tasks'),
       'tasks calendar provider unaffected by dashboard.runtime');

    // All prior runtime plugins still registered
    ok(sbFull.Platform.hasPlugin('calendar'),  'calendar plugin still registered');
    ok(sbFull.Platform.hasPlugin('notes'),     'notes plugin still registered');
    ok(sbFull.Platform.hasPlugin('planning'),  'planning plugin still registered');
    ok(sbFull.Platform.hasPlugin('contacts'),  'contacts plugin still registered');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Navigation
  // ══════════════════════════════════════════════════════════════════════
  section('7. Navigation');
  {
    var sb = makeSandbox();
    loadDashboardRuntime(sb);

    // showView still available as global
    ok(typeof sb.showView === 'function', 'showView() still available as global');

    // All dashboard routes callable via showView
    var svThrew = false;
    try { sb.showView('dashboard'); } catch(e) { svThrew = true; }
    ok(!svThrew, 'showView("dashboard") does not throw');

    // Manifest routes match discovered routes
    var m = sb.Platform.getPlugin('dashboard');
    ok(Array.isArray(m.routes) && m.routes.some(function(r) { return r.id === 'dashboard'; }),
       'manifest route "dashboard" matches discovered route');

    // Shell.navigation accessible
    ok(typeof sb.Shell !== 'undefined' && sb.Shell.navigation,
       'Shell.navigation accessible');
    ok(typeof sb.Shell.navigation.go === 'function',
       'Shell.navigation.go() is a function');

    // Legacy showView calls work after init
    sb.Platform.boot();
    sb.Platform.ready();
    var svAfterInit = false;
    try { sb.showView('dashboard'); svAfterInit = true; } catch(e) {}
    ok(svAfterInit, 'showView("dashboard") works after _dashboardInit()');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Backward compatibility
  // ══════════════════════════════════════════════════════════════════════
  section('8. Backward compatibility');
  {
    // Platform.boot()/ready() safe without dashboard.runtime
    var sbNoDash = makeSandbox();
    load(sbNoDash, 'js/core/events.js');
    load(sbNoDash, 'js/core/platform.js');
    load(sbNoDash, 'js/core/shell.js');
    load(sbNoDash, 'js/core/services/search.js');
    load(sbNoDash, 'js/core/services/calendar.js');
    load(sbNoDash, 'js/core/services/widgets.js');
    load(sbNoDash, 'js/core/services/notifications.js');
    load(sbNoDash, 'js/core/services/dialogs.js');
    load(sbNoDash, 'js/core/services/plugin-services.js');
    load(sbNoDash, 'js/core/plugin-sdk.js');
    var noDashThrew = false;
    try { sbNoDash.Platform.boot(); sbNoDash.Platform.ready(); } catch(e) { noDashThrew = true; }
    ok(!noDashThrew, 'Platform.boot()/ready() safe without dashboard.runtime');

    // no crash when MythosWidgets absent
    var sbNoW = makeSandbox();
    load(sbNoW, 'js/core/events.js');
    load(sbNoW, 'js/core/platform.js');
    load(sbNoW, 'js/core/shell.js');
    load(sbNoW, 'js/core/plugin-sdk.js');
    var noWThrew = false;
    try {
      load(sbNoW, 'js/plugins/dashboard.runtime.js');
      sbNoW.Platform.boot();
      sbNoW.Platform.ready();
    } catch(e) { noWThrew = true; }
    ok(!noWThrew, 'no crash when MythosWidgets absent');

    // no crash when MythosSearch absent
    var sbNoS = makeSandbox();
    load(sbNoS, 'js/core/events.js');
    load(sbNoS, 'js/core/platform.js');
    load(sbNoS, 'js/core/shell.js');
    load(sbNoS, 'js/core/plugin-sdk.js');
    var noSThrew = false;
    try {
      load(sbNoS, 'js/plugins/dashboard.runtime.js');
      sbNoS.Platform.boot();
      sbNoS.Platform.ready();
    } catch(e) { noSThrew = true; }
    ok(!noSThrew, 'no crash when MythosSearch absent');

    // no crash when Shell absent
    var sbNoShell = makeSandbox();
    load(sbNoShell, 'js/core/events.js');
    load(sbNoShell, 'js/core/platform.js');
    load(sbNoShell, 'js/core/plugin-sdk.js');
    var noShellThrew = false;
    try {
      load(sbNoShell, 'js/plugins/dashboard.runtime.js');
      sbNoShell.Platform.boot();
      sbNoShell.Platform.ready();
    } catch(e) { noShellThrew = true; }
    ok(!noShellThrew, 'no crash when Shell absent');

    // no crash when Platform absent (file loads gracefully)
    var sbNoPlatform = makeSandbox();
    var noPlatformThrew = false;
    try {
      // only load plugin-sdk stub — no Platform
      load(sbNoPlatform, 'js/core/events.js');
      load(sbNoPlatform, 'js/core/plugin-sdk.js');
      load(sbNoPlatform, 'js/plugins/dashboard.runtime.js');
    } catch(e) { noPlatformThrew = true; }
    ok(!noPlatformThrew, 'no crash when Platform absent');

    // onBoot recovers gracefully (no-op — Dashboard has no own storage)
    var sbBoot = makeSandbox();
    loadDashboardRuntime(sbBoot);
    sbBoot.localStorage.setItem('mp_invoices', '!!!INVALID!!!');
    var bootThrew = false;
    try { sbBoot.Platform.boot(); } catch(e) { bootThrew = true; }
    ok(!bootThrew, 'onBoot is safe with malformed localStorage (no-op for Dashboard)');

    // tasks/contacts/notes/planning/calendar plugins unaffected when dashboard runtime loads
    var sbAll = makeSandbox();
    loadFullStack(sbAll);
    sbAll.Platform.boot();
    sbAll.Platform.ready();
    ok(sbAll.Platform.hasPlugin('tasks'),     'tasks plugin unaffected by dashboard.runtime');
    ok(sbAll.Platform.hasPlugin('contacts'),  'contacts plugin unaffected by dashboard.runtime');
    ok(sbAll.Platform.hasPlugin('notes'),     'notes plugin unaffected by dashboard.runtime');
    ok(sbAll.Platform.hasPlugin('planning'),  'planning plugin unaffected by dashboard.runtime');
    ok(sbAll.Platform.hasPlugin('calendar'),  'calendar plugin unaffected by dashboard.runtime');

    // _dashboardInit() safe when STORE absent
    var sbNoStore = makeSandbox();
    delete sbNoStore.STORE;
    loadDashboardRuntime(sbNoStore);
    var noStoreThrew = false;
    try { sbNoStore.Platform.boot(); sbNoStore.Platform.ready(); } catch(e) { noStoreThrew = true; }
    ok(!noStoreThrew, '_dashboardInit() safe when STORE absent');

    // no crash when updateDashboardStats/getTaches undefined (graceful degradation)
    var sbNoFns = makeSandbox();
    delete sbNoFns.updateDashboardStats;
    delete sbNoFns.getTaches;
    loadDashboardRuntime(sbNoFns);
    var noFnsThrew = false;
    try { sbNoFns.Platform.boot(); sbNoFns.Platform.ready(); } catch(e) { noFnsThrew = true; }
    ok(!noFnsThrew, 'no crash when updateDashboardStats/getTaches undefined');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 9: Regression (prior test suites)
  // ══════════════════════════════════════════════════════════════════════
  section('9. Regression');
  {
    var suites = [
      'tests/stage3e-test.js',
      'tests/stage3d-test.js',
      'tests/stage3c-test.js',
      'tests/stage3b-test.js',
      'tests/stage3a5-test.js',
      'tests/stage3a-test.js',
      'tests/stage2d-test.js',
      'tests/stage1c-part1-test.js'
    ];

    suites.forEach(function(suite) {
      var suiteFile = path.join(BASE, suite);
      if (!fs.existsSync(suiteFile)) {
        ok(false, suite + ' — file not found');
        return;
      }
      try {
        var result = cp.execSync(
          'node "' + suiteFile + '"',
          { cwd: BASE, timeout: 60000, encoding: 'utf8' }
        );
        // Look for the final summary line "✓ N/N tests passed"
        var match = result.match(/✓\s+(\d+)\/(\d+)\s+tests?\s+passed/);
        if (match && match[1] === match[2]) {
          ok(true, suite + ' — ' + match[1] + '/' + match[2] + ' tests passed');
        } else if (match) {
          ok(false, suite + ' — ' + match[1] + '/' + match[2] + ' tests passed (failures)');
        } else {
          // Check for FAIL lines
          var failCount = (result.match(/\bFAIL\b/g) || []).length;
          if (failCount === 0) {
            ok(true, suite + ' — completed (no failures detected)');
          } else {
            ok(false, suite + ' — ' + failCount + ' FAIL(s) detected');
          }
        }
      } catch(e) {
        ok(false, suite + ' — threw: ' + (e.message || String(e)).split('\n')[0]);
      }
    });
  }

  // ── Final report ─────────────────────────────────────────────────────────
  _results.forEach(function(r) { console.log(r); });
  var total = _pass + _fail;
  if (_fail === 0) {
    console.log('\n✓ ' + _pass + '/' + total + ' tests passed');
  } else {
    console.log('\n✗ ' + _fail + ' failure(s) — ' + _pass + '/' + total + ' tests passed');
    process.exit(1);
  }

})();
