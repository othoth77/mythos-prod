// =====================================================
// MYTHOS OS — Stage 3D automated tests
// tests/stage3d-test.js
//
// Covers: planning.runtime.js — plugin registration,
// onBoot storage validation, onReady MythosSearch +
// MythosCalendar wiring, search handler, calendar
// provider, navigation, backward compatibility,
// and regressions.
//
// Run with: node tests/stage3d-test.js
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

// ── Sample planning (rappel) entries ─────────────────────────────────────
var SAMPLE_RAPPELS = [
  { id: 'rpl_001', titre: 'Réunion trimestrielle', dateDebut: '2026-08-01', periode: 'mois',
    details: 'Discussion bilan mensuel', type: 'Administratif', createdAt: '2026-07-01' },
  { id: 'rpl_002', titre: 'Livraison déclaration fiscale', dateDebut: '2026-08-15', periode: 'annee',
    details: 'Dépôt formulaire TVA', type: 'Fiscal', createdAt: '2026-07-01' },
  { id: 'rpl_003', titre: 'Clôture contrat', dateDebut: '2026-07-20', periode: 'unique',
    details: 'Fin de contrat prestataire', type: 'Contrat', createdAt: '2026-07-01' }
];

var SAMPLE_RAPPEL_TYPES = ['Fiscal', 'Administratif', 'Contrat', 'Relance client', 'Paie'];

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
    STORE: {},
    showView:     function(v) { _showViewLog.push(v); },
    _showViewLog: _showViewLog,
    // stubs needed by other plugins that may co-exist
    getTaches:                 function() { return []; },
    tachesOpenModal:           function() {},
    renderTachePage:           function() {},
    renderTachesDashboard:     function() {},
    renderTachesInCalendrier:  function() {},
    renderCalendrier:          function() {},
    updateDashboardStats:      function() {},
    getRappels:                function() { return []; },
    getNextRappelDate:         function(d) { return d; },
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
    setTimeout:            setTimeout,
    clearTimeout:          clearTimeout,
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

// Helper: load full stack + planning.runtime.js into a sandbox
function loadPlanningRuntime(sb) {
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

    ok(htmlRaw.indexOf('planning.runtime.js') !== -1,
       'planning.runtime.js present in index.html');
    ok(htmlRaw.indexOf('planning.plugin.js') === -1,
       'planning.plugin.js removed from index.html');

    var rtPath = path.join(BASE, 'js/plugins/planning.runtime.js');
    ok(fs.existsSync(rtPath), 'planning.runtime.js exists on disk');

    // Loading order checks
    var posSDK       = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
    var posRuntime   = htmlRaw.indexOf('src="js/plugins/planning.runtime.js');
    var posApp       = htmlRaw.indexOf('src="js/app.js');
    var posContacts  = htmlRaw.indexOf('src="js/plugins/contacts.runtime.js');
    var posTasks     = htmlRaw.indexOf('src="js/plugins/tasks.runtime.js');

    ok(posSDK !== -1 && posRuntime !== -1 && posSDK < posRuntime,
       'plugin-sdk loaded before planning.runtime');
    ok(posRuntime !== -1 && posApp !== -1 && posRuntime < posApp,
       'planning.runtime loaded before app.js');
    ok(posTasks !== -1 && posRuntime !== -1 && posTasks < posRuntime,
       'planning.runtime loaded after tasks.runtime');
    ok(posRuntime !== -1 && posContacts !== -1 && posRuntime < posContacts,
       'planning.runtime loaded before contacts.runtime');

    // Key identifiers in file
    var rtSrc = fs.readFileSync(rtPath, 'utf8');
    ok(rtSrc.indexOf('_PLANNING_RT_STATE') !== -1,  'file contains _PLANNING_RT_STATE');
    ok(rtSrc.indexOf('mp_rappels') !== -1,           'file contains storage key mp_rappels');
    ok(rtSrc.indexOf('mp_rappel_types') !== -1,      'file contains storage key mp_rappel_types');
    ok(rtSrc.indexOf('_planningSearchHandler') !== -1,  'file contains _planningSearchHandler');
    ok(rtSrc.indexOf('_planningCalendarProvider') !== -1, 'file contains _planningCalendarProvider');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Plugin registration
  // ══════════════════════════════════════════════════════════════════════
  section('2. Plugin registration');
  {
    var sb = makeSandbox();
    loadPlanningRuntime(sb);

    ok(sb.Platform.hasPlugin('planning'), 'Platform.hasPlugin(planning)');

    var m = sb.Platform.getPlugin('planning');
    ok(m && m.id === 'planning',        'manifest id = planning');
    ok(m && m.label === 'Planning',     'manifest label = Planning');
    ok(m && m.version === '1.0.0',      'manifest version = 1.0.0');
    ok(m && m.type === 'shared',        'manifest type = shared');

    ok(m && m.menu && m.menu.section === 'Général', 'menu.section = Général');
    ok(m && m.menu && m.menu.order === 4,           'menu.order = 4');
    ok(m && m.menu && m.menu.icon === 'planning',   'menu.icon = planning');

    // Routes: planning is modal-based, no dedicated full-page route
    ok(Array.isArray(m.routes) && m.routes.length === 0,
       'routes is an empty array (planning is modal-based)');

    ok(Array.isArray(m.storageKeys) &&
       m.storageKeys.indexOf('mp_rappels') !== -1,
       'storageKeys contains mp_rappels');
    ok(Array.isArray(m.storageKeys) &&
       m.storageKeys.indexOf('mp_rappel_types') !== -1,
       'storageKeys contains mp_rappel_types');

    ok(typeof m.onBoot === 'function',  'onBoot is a function');
    ok(typeof m.onReady === 'function', 'onReady is a function');

    ok(m.search && typeof m.search.handler === 'function',
       'search.handler is a function');
    ok(m.calendar && typeof m.calendar.provider === 'function',
       'calendar.provider is a function');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: Lifecycle
  // ══════════════════════════════════════════════════════════════════════
  section('3. Lifecycle');
  {
    var sb = makeSandbox();
    loadPlanningRuntime(sb);

    ok(sb._PLANNING_RT_STATE.initialized === false,
       'not initialized before Platform.ready()');

    sb.Platform.boot();
    sb.Platform.ready();

    ok(sb._PLANNING_RT_STATE.initialized === true,
       'initialized after Platform.ready()');
    ok(sb.MythosSearch.hasProvider('planning'),
       'MythosSearch has planning provider after ready()');
    ok(sb.MythosCalendar.hasProvider('planning'),
       'MythosCalendar has planning provider after ready()');

    // Second ready() call — idempotent
    sb.Platform.ready();
    ok(sb._PLANNING_RT_STATE.initialized === true,
       'still initialized on second Platform.ready()');

    var searchProviders = sb.MythosSearch.getProviders()
      .filter(function(p) { return p.id === 'planning'; });
    ok(searchProviders.length === 1,
       'no duplicate search provider on second ready()');

    var calProviders = sb.MythosCalendar.getProviders()
      .filter(function(p) { return p.id === 'planning'; });
    ok(calProviders.length === 1,
       'no duplicate calendar provider on second ready()');

    // window.load fallback
    var sbFallback = makeSandbox();
    var _loadListeners = [];
    sbFallback.window.addEventListener = function(ev, fn) {
      if (ev === 'load') _loadListeners.push(fn);
    };
    loadPlanningRuntime(sbFallback);

    ok(sbFallback._PLANNING_RT_STATE.initialized === false,
       'fallback: not initialized before window.load fires');
    _loadListeners.forEach(function(fn) { fn(); });
    ok(sbFallback._PLANNING_RT_STATE.initialized === true,
       'initialized via window.load fallback');

    // _planningInit() called twice does not crash
    var sbDbl = makeSandbox();
    loadPlanningRuntime(sbDbl);
    sbDbl.Platform.boot();
    sbDbl.Platform.ready();
    var threw = false;
    try {
      sbDbl._planningInit();
      sbDbl._planningInit();
    } catch(e) { threw = true; }
    ok(!threw, '_planningInit() called twice does not crash');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: Storage validation (onBoot)
  // ══════════════════════════════════════════════════════════════════════
  section('4. Storage validation (onBoot)');
  {
    function bootSandbox(lsPreset) {
      var sb = makeSandbox();
      for (var k in lsPreset) {
        if (Object.prototype.hasOwnProperty.call(lsPreset, k)) {
          sb.localStorage.setItem(k, lsPreset[k]);
        }
      }
      loadPlanningRuntime(sb);
      sb.Platform.boot();
      return sb;
    }

    // mp_rappels: null (never set) → stays null
    var sb1 = bootSandbox({});
    ok(sb1.localStorage.getItem('mp_rappels') === null,
       'mp_rappels: never-set key remains null after onBoot');

    // mp_rappels: valid array → preserved
    var sb2 = bootSandbox({ 'mp_rappels': JSON.stringify(SAMPLE_RAPPELS) });
    ok(sb2.localStorage.getItem('mp_rappels') === JSON.stringify(SAMPLE_RAPPELS),
       'mp_rappels: valid non-empty array preserved after onBoot');

    // mp_rappels: malformed JSON → reset to '[]'
    var sb3 = bootSandbox({ 'mp_rappels': 'NOT_JSON{{{' });
    ok(sb3.localStorage.getItem('mp_rappels') === '[]',
       'mp_rappels: malformed JSON reset to [] after onBoot');

    // mp_rappels: non-array JSON (object) → reset to '[]'
    var sb4 = bootSandbox({ 'mp_rappels': '{"key":"val"}' });
    ok(sb4.localStorage.getItem('mp_rappels') === '[]',
       'mp_rappels: non-array JSON (object) reset to [] after onBoot');

    // mp_rappels: valid empty array → preserved
    var sb5 = bootSandbox({ 'mp_rappels': '[]' });
    ok(sb5.localStorage.getItem('mp_rappels') === '[]',
       'mp_rappels: valid empty array preserved after onBoot');

    // no valid rappel deleted on boot
    var singleRappel = [{ id: 'rpl_x', titre: 'Test', dateDebut: '2026-08-01', periode: 'unique', details: '', type: '', createdAt: '2026-07-01' }];
    var sb6 = bootSandbox({ 'mp_rappels': JSON.stringify(singleRappel) });
    var after6 = JSON.parse(sb6.localStorage.getItem('mp_rappels'));
    ok(Array.isArray(after6) && after6.length === 1 && after6[0].id === 'rpl_x',
       'no valid rappel deleted on boot');

    // mp_rappel_types: malformed JSON → reset to '[]'
    var sb7 = bootSandbox({ 'mp_rappel_types': 'BAD_JSON' });
    ok(sb7.localStorage.getItem('mp_rappel_types') === '[]',
       'mp_rappel_types: malformed JSON reset to [] after onBoot');

    // mp_rappel_types: valid array → preserved
    var sb8 = bootSandbox({ 'mp_rappel_types': JSON.stringify(SAMPLE_RAPPEL_TYPES) });
    ok(sb8.localStorage.getItem('mp_rappel_types') === JSON.stringify(SAMPLE_RAPPEL_TYPES),
       'mp_rappel_types: valid array preserved after onBoot');

    // both keys validated independently
    var sb9 = bootSandbox({
      'mp_rappels':      'INVALID_JSON',
      'mp_rappel_types': JSON.stringify(SAMPLE_RAPPEL_TYPES)
    });
    ok(sb9.localStorage.getItem('mp_rappels') === '[]',
       'mp_rappels reset independently when invalid');
    ok(sb9.localStorage.getItem('mp_rappel_types') === JSON.stringify(SAMPLE_RAPPEL_TYPES),
       'mp_rappel_types preserved when mp_rappels is invalid');

    // second Platform.boot() call — idempotent (no crash, no data loss)
    var sbBoot2 = bootSandbox({ 'mp_rappels': JSON.stringify(SAMPLE_RAPPELS) });
    var threw2 = false;
    try { sbBoot2.Platform.boot(); } catch(e) { threw2 = true; }
    ok(!threw2, 'second Platform.boot() call does not crash');
    ok(sbBoot2.localStorage.getItem('mp_rappels') === JSON.stringify(SAMPLE_RAPPELS),
       'valid data still preserved after second boot');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Search provider
  // ══════════════════════════════════════════════════════════════════════
  section('5. Search provider');
  {
    var sb = makeSandbox();
    sb.localStorage.setItem('mp_rappels', JSON.stringify(SAMPLE_RAPPELS));
    loadPlanningRuntime(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // Search by titre
    var r1 = await sb.MythosSearch.search('réunion');
    ok(r1.length >= 1 && r1.some(function(r) { return r.data.id === 'rpl_001'; }),
       'search by titre "réunion" finds rpl_001');

    // Search by type
    var r2 = await sb.MythosSearch.search('fiscal');
    ok(r2.length >= 1 && r2.some(function(r) { return r.data.id === 'rpl_002'; }),
       'search by type "fiscal" finds rpl_002');

    // Search by details
    var r3 = await sb.MythosSearch.search('prestataire');
    ok(r3.length >= 1 && r3.some(function(r) { return r.data.id === 'rpl_003'; }),
       'search by details "prestataire" finds rpl_003');

    // Empty query → []
    var r4 = await sb.MythosSearch.search('');
    ok(r4.length === 0, 'empty query → []');

    // Whitespace-only query → []
    var r4b = await sb.MythosSearch.search('   ');
    ok(r4b.length === 0, 'whitespace-only query → []');

    // No match → []
    var r5 = await sb.MythosSearch.search('zzznomatch999xyz');
    ok(r5.length === 0, 'no match → []');

    // Normalized result schema
    var rNorm = await sb.MythosSearch.search('déclaration');
    ok(rNorm.length >= 1, 'normalized: "déclaration" returns result');
    var res = rNorm[0];
    ok(typeof res.id === 'string' && res.id.indexOf('plan-') === 0,
       'id prefixed "plan-"');
    ok(typeof res.title === 'string' && res.title.length > 0,
       'result has non-empty title');
    ok(typeof res.subtitle === 'string',
       'result has subtitle string');
    ok(res.type === 'planning',
       'result type = "planning"');
    ok(res.data && typeof res.data.id === 'string',
       'result has data with id');
    ok(res.route === null,
       'route is null (planning is modal-based)');

    // Case-insensitive
    var rUpper = await sb.MythosSearch.search('RÉUNION');
    var rLower = await sb.MythosSearch.search('réunion');
    ok(rUpper.length === rLower.length && rUpper.length >= 1,
       'search is case-insensitive');

    // Malformed entry silently skipped
    var sbBad = makeSandbox();
    sbBad.localStorage.setItem('mp_rappels', JSON.stringify([
      null,
      { id: 'rpl_valid', titre: 'Rappel valide', dateDebut: '2026-08-01', periode: 'mois', details: '', type: 'Test', createdAt: '2026-07-01' }
    ]));
    loadPlanningRuntime(sbBad);
    sbBad.Platform.boot();
    sbBad.Platform.ready();
    var rBadThrew = false, rBadResult;
    try { rBadResult = await sbBad.MythosSearch.search('valide'); } catch(e) { rBadThrew = true; }
    ok(!rBadThrew, 'malformed entry (null) in array silently skipped');
    ok(rBadResult && rBadResult.length === 1,
       'only valid entry returned when array has nulls');

    // Only 1 planning provider
    var allProviders = sb.MythosSearch.getProviders();
    var planProviders = allProviders.filter(function(p) { return p.id === 'planning'; });
    ok(planProviders.length === 1, 'only 1 planning provider in MythosSearch');

    // Search on empty storage → []
    var sbEmpty = makeSandbox();
    loadPlanningRuntime(sbEmpty);
    sbEmpty.Platform.boot();
    sbEmpty.Platform.ready();
    var rEmpty = await sbEmpty.MythosSearch.search('réunion');
    ok(Array.isArray(rEmpty) && rEmpty.length === 0,
       'search on empty storage returns []');

    // Partial match
    var rPartial = await sb.MythosSearch.search('contrat');
    ok(rPartial.length >= 1, 'partial match "contrat" returns results');

    // Provider id
    ok(allProviders.some(function(p) { return p.id === 'planning'; }),
       'search provider id is "planning"');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Calendar provider
  // ══════════════════════════════════════════════════════════════════════
  section('6. Calendar provider');
  {
    var sb = makeSandbox();
    sb.localStorage.setItem('mp_rappels', JSON.stringify(SAMPLE_RAPPELS));
    loadPlanningRuntime(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // Provider registered
    ok(sb.MythosCalendar.hasProvider('planning'),
       'planning provider registered with MythosCalendar');

    // getEvents returns Promise
    var eventsPromise = sb.MythosCalendar.getEvents({ start: '2026-07-01', end: '2026-12-31' });
    ok(eventsPromise && typeof eventsPromise.then === 'function',
       'MythosCalendar.getEvents() returns a Promise');

    var events = await eventsPromise;
    ok(Array.isArray(events), 'getEvents resolves to an Array');
    ok(events.length >= 1, 'events array is non-empty for date range covering sample data');

    // Event schema
    var ev = events[0];
    ok(ev && typeof ev.id === 'string',    'event has string id');
    ok(ev && typeof ev.title === 'string', 'event has string title');
    ok(ev && typeof ev.start === 'string' && ev.start.match(/^\d{4}-\d{2}-\d{2}$/),
       'event start is a YYYY-MM-DD string');
    ok(ev && ev.allDay === true,           'event allDay = true');
    ok(ev && ev.route === null,            'event route = null (modal-based)');
    ok(ev && typeof ev.data === 'object',  'event has data object');

    // Events sorted chronologically
    var starts = events.map(function(e) { return e.start; });
    var isSorted = starts.every(function(s, i) { return i === 0 || starts[i-1] <= s; });
    ok(isSorted, 'events sorted chronologically by start');

    // Range filtering — start filter
    var eventsAfter0815 = await sb.MythosCalendar.getEvents({ start: '2026-08-15', end: '2026-12-31' });
    ok(eventsAfter0815.every(function(e) { return e.start >= '2026-08-15'; }),
       'range start filter: no events before rangeStart');

    // Range filtering — end filter
    var eventsBefore0801 = await sb.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-08-01' });
    ok(eventsBefore0801.every(function(e) { return e.start <= '2026-08-01'; }),
       'range end filter: no events after rangeEnd');

    // Entry with null dateDebut skipped gracefully
    var sbNullDate = makeSandbox();
    sbNullDate.localStorage.setItem('mp_rappels', JSON.stringify([
      { id: 'rpl_nd', titre: 'Sans date', dateDebut: null, periode: 'mois', details: '', type: '', createdAt: '2026-07-01' },
      { id: 'rpl_ok', titre: 'Avec date', dateDebut: '2026-08-01', periode: 'mois', details: '', type: '', createdAt: '2026-07-01' }
    ]));
    loadPlanningRuntime(sbNullDate);
    sbNullDate.Platform.boot();
    sbNullDate.Platform.ready();
    var evND = await sbNullDate.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(evND.length === 1 && evND[0].data.id === 'rpl_ok',
       'entry with null dateDebut skipped gracefully');

    // Malformed entry skipped
    var sbMalEv = makeSandbox();
    sbMalEv.localStorage.setItem('mp_rappels', JSON.stringify([
      null,
      { id: 'rpl_good', titre: 'Bon rappel', dateDebut: '2026-08-01', periode: 'mois', details: '', type: '', createdAt: '2026-07-01' }
    ]));
    loadPlanningRuntime(sbMalEv);
    sbMalEv.Platform.boot();
    sbMalEv.Platform.ready();
    var evMal = await sbMalEv.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(evMal.length === 1 && evMal[0].data.id === 'rpl_good',
       'null entry skipped in calendar provider');

    // Empty storage → [] events
    var sbEmptyEv = makeSandbox();
    loadPlanningRuntime(sbEmptyEv);
    sbEmptyEv.Platform.boot();
    sbEmptyEv.Platform.ready();
    var evEmpty = await sbEmptyEv.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(Array.isArray(evEmpty) && evEmpty.length === 0,
       'empty storage returns [] calendar events');

    // Event id prefixed 'plan-' (after MythosCalendar normalization)
    ok(events.some(function(e) { return e.id.indexOf('plan-') === 0; }),
       'event ids are prefixed "plan-"');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Navigation
  // ══════════════════════════════════════════════════════════════════════
  section('7. Navigation');
  {
    var sb = makeSandbox();
    loadPlanningRuntime(sb);

    ok(typeof sb.showView === 'function',
       'showView still available as global');

    // No dedicated planning route — showView with any view should not crash
    var threw1 = false;
    try { sb.showView('dashboard'); } catch(e) { threw1 = true; }
    ok(!threw1, 'showView("dashboard") callable without crash after loading planning.runtime');

    // planning routes is empty (modal-based)
    var m = sb.Platform.getPlugin('planning');
    ok(Array.isArray(m.routes) && m.routes.length === 0,
       'manifest routes is [] (planning uses modal, no dedicated route)');

    ok(sb.Shell && typeof sb.Shell.navigation === 'object',
       'Shell.navigation accessible');

    // showView log works correctly
    sb.showView('any-view');
    ok(sb._showViewLog.indexOf('any-view') !== -1,
       'showView calls are recorded in _showViewLog');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Backward compatibility
  // ══════════════════════════════════════════════════════════════════════
  section('8. Backward compatibility');
  {
    // Platform.boot()/ready() safe without planning.runtime
    {
      var sb = makeSandbox();
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try { sb.Platform.boot(); sb.Platform.ready(); } catch(e) { threw = true; }
      ok(!threw, 'Platform.boot()/ready() safe without planning.runtime');
    }

    // No crash when MythosSearch absent
    {
      var sb = makeSandbox({ MythosSearch: undefined });
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try {
        load(sb, 'js/plugins/planning.runtime.js');
        sb.Platform.boot();
        sb.Platform.ready();
      } catch(e) { threw = true; }
      ok(!threw, 'no crash when MythosSearch absent');
      ok(sb._PLANNING_RT_STATE.initialized === true,
         'still initializes without MythosSearch');
    }

    // No crash when MythosCalendar absent
    {
      var sb = makeSandbox({ MythosCalendar: undefined });
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/services/search.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try {
        load(sb, 'js/plugins/planning.runtime.js');
        sb.Platform.boot();
        sb.Platform.ready();
      } catch(e) { threw = true; }
      ok(!threw, 'no crash when MythosCalendar absent');
      ok(sb._PLANNING_RT_STATE.initialized === true,
         'still initializes without MythosCalendar');
    }

    // Loads without Shell
    {
      var sbNoShell = makeSandbox();
      load(sbNoShell, 'js/core/events.js');
      load(sbNoShell, 'js/core/platform.js');
      // NO shell.js
      load(sbNoShell, 'js/core/services/search.js');
      load(sbNoShell, 'js/core/services/calendar.js');
      load(sbNoShell, 'js/core/plugin-sdk.js');
      var threw = false;
      try { load(sbNoShell, 'js/plugins/planning.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'planning.runtime loads without Shell');
    }

    // Loads without Platform
    {
      var sbNoPlatform = makeSandbox();
      load(sbNoPlatform, 'js/core/events.js');
      load(sbNoPlatform, 'js/core/services/search.js');
      load(sbNoPlatform, 'js/core/services/calendar.js');
      sbNoPlatform.Plugin = {
        create: function(manifest) {
          var builder = {
            _m: manifest,
            defineMenu:     function() { return this; },
            defineRoutes:   function() { return this; },
            defineStorage:  function() { return this; },
            defineSearch:   function() { return this; },
            defineCalendar: function() { return this; },
            build:          function() { return this; }
          };
          return builder;
        }
      };
      var threw = false;
      try { load(sbNoPlatform, 'js/plugins/planning.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'planning.runtime loads without Platform');
    }

    // onBoot recovers from malformed localStorage
    {
      var sbMalf = makeSandbox();
      sbMalf.localStorage.setItem('mp_rappels',      'TOTALLY_MALFORMED');
      sbMalf.localStorage.setItem('mp_rappel_types', 'ALSO_MALFORMED');
      loadPlanningRuntime(sbMalf);
      var threw = false;
      try { sbMalf.Platform.boot(); } catch(e) { threw = true; }
      ok(!threw, 'onBoot recovers from malformed localStorage without crash');
      ok(sbMalf.localStorage.getItem('mp_rappels')      === '[]', 'mp_rappels reset on malformed');
      ok(sbMalf.localStorage.getItem('mp_rappel_types') === '[]', 'mp_rappel_types reset on malformed');
    }

    // Existing valid data not overwritten
    {
      var sbGood = makeSandbox();
      sbGood.localStorage.setItem('mp_rappels', JSON.stringify(SAMPLE_RAPPELS));
      loadPlanningRuntime(sbGood);
      sbGood.Platform.boot();
      var afterGood = JSON.parse(sbGood.localStorage.getItem('mp_rappels'));
      ok(Array.isArray(afterGood) && afterGood.length === SAMPLE_RAPPELS.length,
         'existing valid data not overwritten on boot');
    }

    // Search on empty planning returns []
    {
      var sbEmptySearch = makeSandbox();
      loadPlanningRuntime(sbEmptySearch);
      sbEmptySearch.Platform.boot();
      sbEmptySearch.Platform.ready();
      var rEmptyS = await sbEmptySearch.MythosSearch.search('fiscal');
      ok(Array.isArray(rEmptyS) && rEmptyS.length === 0,
         'search on empty planning returns []');
    }

    // contacts/tasks/notes plugins unaffected when planning disabled
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
      load(sbOthers, 'js/plugins/tasks.runtime.js');
      load(sbOthers, 'js/plugins/contacts.runtime.js');
      load(sbOthers, 'js/plugins/notes.runtime.js');
      // Do NOT load planning.runtime
      sbOthers.Platform.boot();
      sbOthers.Platform.ready();
      ok(sbOthers.Platform.hasPlugin('tasks') && sbOthers.Platform.hasPlugin('contacts')
         && sbOthers.Platform.hasPlugin('notes') && !sbOthers.Platform.hasPlugin('planning'),
         'contacts/tasks/notes plugins unaffected when planning is not loaded');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 9: Regression (prior test suites)
  // ══════════════════════════════════════════════════════════════════════
  section('9. Regression');
  {
    var suites = [
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
