// =====================================================
// MYTHOS OS — Stage 3C automated tests
// tests/stage3c-test.js
//
// Covers: notes.runtime.js — plugin registration,
// onBoot storage validation, onReady MythosSearch wiring,
// search handler, navigation, backward compatibility,
// and regressions.
//
// Run with: node tests/stage3c-test.js
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

// ── Sample documents ─────────────────────────────────────────────────────
var SAMPLE_DOCS_DAS = [
  { id: 'rdd_das_001', name: 'Lettre de présentation DAS', createdAt: '2026-07-01T10:00:00.000Z' },
  { id: 'rdd_das_002', name: 'Convention de spectacle',    createdAt: '2026-07-15T14:00:00.000Z' }
];
var SAMPLE_DOCS_AUTRES = [
  { id: 'rdd_aut_001', name: 'Compte rendu réunion',  createdAt: '2026-07-10T09:00:00.000Z' },
  { id: 'rdd_aut_002', name: 'Note de service',       createdAt: '2026-07-20T11:00:00.000Z' }
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
    // STORE mock: notes data lives directly in localStorage via _lsStore
    // (the search handler accesses localStorage directly, not via STORE)
    STORE: {
      _docsInitialized: false
    },
    showView:    function(v) { _showViewLog.push(v); },
    _showViewLog: _showViewLog,
    // stubs needed for other plugins that may co-exist
    getTaches:                 function() { return []; },
    tachesOpenModal:           function() {},
    renderTachePage:           function() {},
    renderTachesDashboard:     function() {},
    renderTachesInCalendrier:  function() {},
    renderCalendrier:          function() {},
    updateDashboardStats:      function() {},
    // Node globals
    console:              console,
    Promise:              Promise,
    JSON:                 JSON,
    Date:                 Date,
    Array:                Array,
    Object:               Object,
    String:               String,
    Math:                 Math,
    Error:                Error,
    setTimeout:           setTimeout,
    clearTimeout:         clearTimeout,
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

// Helper: load full stack + notes.runtime.js into a sandbox
function loadNotesRuntime(sb) {
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
  load(sb, 'js/plugins/notes.runtime.js');
}

// ── Run all tests (async IIFE) ───────────────────────────────────────────
(async function() {

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: Audit & structure
  // ══════════════════════════════════════════════════════════════════════
  section('1. Audit & structure');
  {
    var htmlRaw = fs.readFileSync(path.join(BASE, 'index.html'), 'utf8');

    ok(htmlRaw.indexOf('notes.runtime.js') !== -1,
       'notes.runtime.js present in index.html');
    ok(htmlRaw.indexOf('notes.plugin.js') === -1,
       'notes.plugin.js removed from index.html');

    var rtPath = path.join(BASE, 'js/plugins/notes.runtime.js');
    ok(fs.existsSync(rtPath), 'notes.runtime.js exists on disk');

    // loading order
    var posSDK     = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
    var posRuntime = htmlRaw.indexOf('src="js/plugins/notes.runtime.js');
    var posApp     = htmlRaw.indexOf('src="js/app.js');
    var posContacts = htmlRaw.indexOf('src="js/plugins/contacts.runtime.js');
    ok(posSDK !== -1 && posRuntime !== -1 && posSDK < posRuntime,
       'plugin-sdk loaded before notes.runtime');
    ok(posRuntime !== -1 && posApp !== -1 && posRuntime < posApp,
       'notes.runtime loaded before app.js');
    ok(posContacts !== -1 && posRuntime !== -1 && posContacts < posRuntime,
       'notes.runtime loaded after contacts.runtime');

    // key identifiers in file
    var rtSrc = fs.readFileSync(rtPath, 'utf8');
    ok(rtSrc.indexOf('_NOTES_RT_STATE') !== -1,         'file contains _NOTES_RT_STATE');
    ok(rtSrc.indexOf('mp_rddocs_das') !== -1,           'file contains storage key mp_rddocs_das');
    ok(rtSrc.indexOf('mp_rddocs_autres') !== -1,        'file contains storage key mp_rddocs_autres');
    ok(rtSrc.indexOf('redaction-das') !== -1,           'file contains route id redaction-das');
    ok(rtSrc.indexOf('redaction-autres') !== -1,        'file contains route id redaction-autres');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Plugin registration
  // ══════════════════════════════════════════════════════════════════════
  section('2. Plugin registration');
  {
    var sb = makeSandbox();
    loadNotesRuntime(sb);

    ok(sb.Platform.hasPlugin('notes'), 'Platform.hasPlugin(notes)');

    var m = sb.Platform.getPlugin('notes');
    ok(m && m.id === 'notes',          'manifest id = notes');
    ok(m && m.label === 'Rédaction',   'manifest label = Rédaction');
    ok(m && m.version === '1.0.0',     'manifest version = 1.0.0');
    ok(m && m.type === 'shared',       'manifest type = shared');
    ok(m && m.menu && m.menu.section === 'Général', 'menu.section = Général');
    ok(m && m.menu && m.menu.order === 6,            'menu.order = 6');
    ok(m && m.menu && m.menu.icon === 'notes',       'menu.icon = notes');

    ok(Array.isArray(m.routes) && m.routes.length === 2,
       '2 routes defined');
    ok(m.routes[0].id === 'redaction-das',    'route[0] id = redaction-das');
    ok(m.routes[1].id === 'redaction-autres', 'route[1] id = redaction-autres');

    ok(Array.isArray(m.storageKeys) &&
       m.storageKeys.indexOf('mp_rddocs_das') !== -1,
       'storageKeys contains mp_rddocs_das');
    ok(Array.isArray(m.storageKeys) &&
       m.storageKeys.indexOf('mp_rddocs_autres') !== -1,
       'storageKeys contains mp_rddocs_autres');

    ok(typeof m.onBoot === 'function',  'onBoot is a function');
    ok(typeof m.onReady === 'function', 'onReady is a function');

    ok(m.search && typeof m.search.handler === 'function',
       'search.handler is a function');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: onBoot storage validation
  // ══════════════════════════════════════════════════════════════════════
  section('3. onBoot storage validation');
  {
    function bootSandbox(lsPreset) {
      var sb = makeSandbox();
      for (var k in lsPreset) {
        if (Object.prototype.hasOwnProperty.call(lsPreset, k)) {
          sb.localStorage.setItem(k, lsPreset[k]);
        }
      }
      loadNotesRuntime(sb);
      sb.Platform.boot();
      return sb;
    }

    // valid non-empty array → preserved
    var sb1 = bootSandbox({ 'mp_rddocs_das': JSON.stringify(SAMPLE_DOCS_DAS) });
    var after1 = sb1.localStorage.getItem('mp_rddocs_das');
    ok(after1 === JSON.stringify(SAMPLE_DOCS_DAS),
       'valid non-empty array preserved after onBoot');

    // null (never set) → stays null
    var sb2 = bootSandbox({});
    var after2 = sb2.localStorage.getItem('mp_rddocs_das');
    ok(after2 === null,
       'never-set key remains null after onBoot');

    // malformed JSON → reset to []
    var sb3 = bootSandbox({ 'mp_rddocs_das': 'NOT_JSON{{{' });
    var after3 = sb3.localStorage.getItem('mp_rddocs_das');
    ok(after3 === '[]',
       'malformed JSON reset to [] after onBoot');

    // non-array JSON (object) → reset to []
    var sb4 = bootSandbox({ 'mp_rddocs_das': '{"key":"val"}' });
    var after4 = sb4.localStorage.getItem('mp_rddocs_das');
    ok(after4 === '[]',
       'non-array JSON (object) reset to [] after onBoot');

    // valid empty array [] → preserved
    var sb5 = bootSandbox({ 'mp_rddocs_das': '[]' });
    var after5 = sb5.localStorage.getItem('mp_rddocs_das');
    ok(after5 === '[]',
       'valid empty array preserved after onBoot');

    // no valid document is deleted on boot
    var sb6 = bootSandbox({ 'mp_rddocs_das': JSON.stringify([{ id:'x', name:'Test', createdAt:'2026-07-01T00:00:00.000Z' }]) });
    var after6 = JSON.parse(sb6.localStorage.getItem('mp_rddocs_das'));
    ok(Array.isArray(after6) && after6.length === 1 && after6[0].id === 'x',
       'no valid note deleted on boot');

    // autres key: malformed → reset to []
    var sb7 = bootSandbox({ 'mp_rddocs_autres': 'BAD_JSON' });
    var after7 = sb7.localStorage.getItem('mp_rddocs_autres');
    ok(after7 === '[]',
       'malformed autres key reset to [] after onBoot');

    // both keys validated independently
    var sb8 = bootSandbox({
      'mp_rddocs_das':    'INVALID',
      'mp_rddocs_autres': JSON.stringify(SAMPLE_DOCS_AUTRES)
    });
    var after8das    = sb8.localStorage.getItem('mp_rddocs_das');
    var after8autres = sb8.localStorage.getItem('mp_rddocs_autres');
    ok(after8das === '[]', 'das key reset independently');
    ok(after8autres === JSON.stringify(SAMPLE_DOCS_AUTRES), 'autres key preserved independently');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: onReady & idempotency
  // ══════════════════════════════════════════════════════════════════════
  section('4. onReady & idempotency');
  {
    var sb = makeSandbox();
    loadNotesRuntime(sb);

    ok(sb._NOTES_RT_STATE.initialized === false,
       'not initialized before Platform.ready()');

    sb.Platform.boot();
    sb.Platform.ready();

    ok(sb._NOTES_RT_STATE.initialized === true,
       'initialized after Platform.ready()');
    ok(sb.MythosSearch.hasProvider('notes'),
       'MythosSearch has notes provider after ready()');

    // Second call — idempotent, no duplicate provider
    sb.Platform.ready();
    ok(sb._NOTES_RT_STATE.initialized === true,
       'still initialized on second Platform.ready()');

    var providers = sb.MythosSearch.getProviders();
    var notesProviders = providers.filter(function(p) { return p.id === 'notes'; });
    ok(notesProviders.length === 1,
       'no duplicate provider on second ready()');

    // window.load fallback
    var sbFallback = makeSandbox();
    var _loadListeners = [];
    sbFallback.window.addEventListener = function(ev, fn) {
      if (ev === 'load') _loadListeners.push(fn);
    };
    loadNotesRuntime(sbFallback);

    ok(sbFallback._NOTES_RT_STATE.initialized === false,
       'fallback: not initialized before window.load fires');
    _loadListeners.forEach(function(fn) { fn(); });
    ok(sbFallback._NOTES_RT_STATE.initialized === true,
       'initialized via window.load fallback');

    // _notesInit() called twice does not crash
    var sbDbl = makeSandbox();
    loadNotesRuntime(sbDbl);
    sbDbl.Platform.boot();
    sbDbl.Platform.ready();
    var threw = false;
    try {
      sbDbl._notesInit();
      sbDbl._notesInit();
    } catch(e) { threw = true; }
    ok(!threw, '_notesInit() called twice does not crash');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Search provider
  // ══════════════════════════════════════════════════════════════════════
  section('5. Search provider');
  {
    // Load with pre-populated localStorage documents
    var sb = makeSandbox();
    sb.localStorage.setItem('mp_rddocs_das',    JSON.stringify(SAMPLE_DOCS_DAS));
    sb.localStorage.setItem('mp_rddocs_autres', JSON.stringify(SAMPLE_DOCS_AUTRES));
    loadNotesRuntime(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // search by name — DAS doc
    var r1 = await sb.MythosSearch.search('présentation');
    ok(r1.length >= 1 && r1.some(function(r) { return r.data.id === 'rdd_das_001'; }),
       'search by name "présentation" → DAS doc found');

    // search by name — Autres doc
    var r2 = await sb.MythosSearch.search('compte rendu');
    ok(r2.length >= 1 && r2.some(function(r) { return r.data.id === 'rdd_aut_001'; }),
       'search by name "compte rendu" → Autres doc found');

    // search across categories
    var r3 = await sb.MythosSearch.search('note');
    ok(r3.length >= 1, 'search "note" returns at least one result');

    // empty query → []
    var r4 = await sb.MythosSearch.search('');
    ok(r4.length === 0, 'empty query → []');

    // whitespace-only query → []
    var r4b = await sb.MythosSearch.search('   ');
    ok(r4b.length === 0, 'whitespace-only query → []');

    // no match → []
    var r5 = await sb.MythosSearch.search('zzznomatch999xyz');
    ok(r5.length === 0, 'no match → []');

    // normalized result schema
    var rNorm = await sb.MythosSearch.search('convention');
    ok(rNorm.length >= 1, 'normalized: "convention" returns result');
    var res = rNorm[0];
    ok(typeof res.id === 'string' && res.id.indexOf('note-') === 0,
       'id prefixed "note-"');
    ok(typeof res.title === 'string' && res.title.length > 0,
       'result has non-empty title');
    ok(typeof res.subtitle === 'string',
       'result has subtitle');
    ok(res.type === 'note',
       'result type = "note"');
    ok(res.data && typeof res.data.id === 'string',
       'result has data with id');

    // route is correct
    var rDas = await sb.MythosSearch.search('spectacle');
    ok(rDas.length >= 1 && rDas[0].route === 'redaction-das',
       'DAS doc result route = "redaction-das"');

    var rAutres = await sb.MythosSearch.search('service');
    ok(rAutres.length >= 1 && rAutres[0].route === 'redaction-autres',
       'Autres doc result route = "redaction-autres"');

    // malformed entries silently skipped
    var sbBad = makeSandbox();
    sbBad.localStorage.setItem('mp_rddocs_das', JSON.stringify([
      null,
      undefined,
      { id: 'valid001', name: 'Document Valide DAS', createdAt: '2026-07-01T00:00:00.000Z' }
    ]));
    loadNotesRuntime(sbBad);
    sbBad.Platform.boot();
    sbBad.Platform.ready();
    var rBadThrew = false, rBadResult;
    try { rBadResult = await sbBad.MythosSearch.search('valide'); } catch(e) { rBadThrew = true; }
    ok(!rBadThrew, 'malformed notes (null/undefined) in array silently skipped');
    ok(rBadResult && rBadResult.length === 1, 'only valid doc returned when array has nulls');

    // only 1 notes provider
    var allProviders = sb.MythosSearch.getProviders();
    var nProviders = allProviders.filter(function(p) { return p.id === 'notes'; });
    ok(nProviders.length === 1, 'only 1 notes provider in MythosSearch');

    // case-insensitive search
    var rCase1 = await sb.MythosSearch.search('PRÉSENTATION');
    var rCase2 = await sb.MythosSearch.search('présentation');
    ok(rCase1.length === rCase2.length && rCase1.length >= 1,
       'search is case-insensitive (uppercase matches lowercase)');

    // partial match
    var rPartial = await sb.MythosSearch.search('conv');
    ok(rPartial.length >= 1, 'partial match "conv" returns results');

    // search returns empty array for empty localStorage (no docs yet)
    var sbEmpty = makeSandbox();
    loadNotesRuntime(sbEmpty);
    sbEmpty.Platform.boot();
    sbEmpty.Platform.ready();
    var rEmpty = await sbEmpty.MythosSearch.search('anything');
    ok(Array.isArray(rEmpty) && rEmpty.length === 0,
       'search on empty notes returns []');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Navigation
  // ══════════════════════════════════════════════════════════════════════
  section('6. Navigation');
  {
    var sb = makeSandbox();
    loadNotesRuntime(sb);

    ok(typeof sb.showView === 'function',
       'showView still available as global');

    var threw1 = false;
    try { sb.showView('redaction-das'); } catch(e) { threw1 = true; }
    ok(!threw1, 'showView("redaction-das") callable without crash');

    var threw2 = false;
    try { sb.showView('redaction-autres'); } catch(e) { threw2 = true; }
    ok(!threw2, 'showView("redaction-autres") callable without crash');

    ok(sb.Shell && typeof sb.Shell.navigation === 'object',
       'Shell.navigation accessible');

    var m = sb.Platform.getPlugin('notes');
    ok(Array.isArray(m.routes) && m.routes.some(function(r) { return r.id === 'redaction-das'; }),
       'manifest routes contains redaction-das');
    ok(Array.isArray(m.routes) && m.routes.some(function(r) { return r.id === 'redaction-autres'; }),
       'manifest routes contains redaction-autres');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Backward compatibility
  // ══════════════════════════════════════════════════════════════════════
  section('7. Backward compatibility');
  {
    // Platform.boot()/ready() safe without notes.runtime
    {
      var sb = makeSandbox();
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try { sb.Platform.boot(); sb.Platform.ready(); } catch(e) { threw = true; }
      ok(!threw, 'Platform.boot()/ready() safe without notes.runtime');
    }

    // no crash when MythosSearch absent
    {
      var sb = makeSandbox({ MythosSearch: undefined });
      load(sb, 'js/core/events.js');
      load(sb, 'js/core/platform.js');
      load(sb, 'js/core/shell.js');
      load(sb, 'js/core/plugin-sdk.js');
      var threw = false;
      try {
        load(sb, 'js/plugins/notes.runtime.js');
        sb.Platform.boot();
        sb.Platform.ready();
      } catch(e) { threw = true; }
      ok(!threw, 'no crash when MythosSearch absent');
      ok(sb._NOTES_RT_STATE.initialized === true,
         'still initializes without MythosSearch');
    }

    // notes.runtime loads without Shell
    {
      var sbNoShell = makeSandbox();
      load(sbNoShell, 'js/core/events.js');
      load(sbNoShell, 'js/core/platform.js');
      // NO shell.js
      load(sbNoShell, 'js/core/services/search.js');
      load(sbNoShell, 'js/core/plugin-sdk.js');
      var threw = false;
      try { load(sbNoShell, 'js/plugins/notes.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'notes.runtime loads without Shell');
    }

    // notes.runtime loads without Platform
    {
      var sbNoPlatform = makeSandbox();
      load(sbNoPlatform, 'js/core/events.js');
      // NO platform.js — provide minimal Plugin stub
      load(sbNoPlatform, 'js/core/services/search.js');
      sbNoPlatform.Plugin = {
        create: function(manifest) {
          var builder = {
            _m: manifest,
            defineMenu:    function() { return this; },
            defineRoutes:  function() { return this; },
            defineStorage: function() { return this; },
            defineSearch:  function() { return this; },
            build:         function() { return this; }
          };
          return builder;
        }
      };
      var threw = false;
      try { load(sbNoPlatform, 'js/plugins/notes.runtime.js'); } catch(e) { threw = true; }
      ok(!threw, 'notes.runtime loads without Platform');
    }

    // onBoot recovers from malformed localStorage
    {
      var sbMalf = makeSandbox();
      sbMalf.localStorage.setItem('mp_rddocs_das',    'TOTALLY_MALFORMED');
      sbMalf.localStorage.setItem('mp_rddocs_autres', 'ALSO_MALFORMED');
      loadNotesRuntime(sbMalf);
      var threw = false;
      try { sbMalf.Platform.boot(); } catch(e) { threw = true; }
      ok(!threw, 'onBoot recovers from malformed localStorage without crash');
      ok(sbMalf.localStorage.getItem('mp_rddocs_das')    === '[]', 'das reset on malformed');
      ok(sbMalf.localStorage.getItem('mp_rddocs_autres') === '[]', 'autres reset on malformed');
    }

    // existing valid data not overwritten on boot
    {
      var sbGood = makeSandbox();
      sbGood.localStorage.setItem('mp_rddocs_das', JSON.stringify(SAMPLE_DOCS_DAS));
      loadNotesRuntime(sbGood);
      sbGood.Platform.boot();
      var afterGood = JSON.parse(sbGood.localStorage.getItem('mp_rddocs_das'));
      ok(Array.isArray(afterGood) && afterGood.length === SAMPLE_DOCS_DAS.length,
         'existing valid data not overwritten on boot');
    }

    // contacts plugin unaffected when notes is the only runtime loaded
    {
      var sbContacts = makeSandbox();
      load(sbContacts, 'js/core/events.js');
      load(sbContacts, 'js/core/platform.js');
      load(sbContacts, 'js/core/shell.js');
      load(sbContacts, 'js/core/services/search.js');
      load(sbContacts, 'js/core/services/calendar.js');
      load(sbContacts, 'js/core/services/widgets.js');
      load(sbContacts, 'js/core/services/notifications.js');
      load(sbContacts, 'js/core/services/dialogs.js');
      load(sbContacts, 'js/core/services/plugin-services.js');
      load(sbContacts, 'js/core/plugin-sdk.js');
      load(sbContacts, 'js/plugins/contacts.runtime.js');
      load(sbContacts, 'js/plugins/notes.runtime.js');
      sbContacts.Platform.boot();
      sbContacts.Platform.ready();
      ok(sbContacts.Platform.hasPlugin('contacts') && sbContacts.Platform.hasPlugin('notes'),
         'contacts plugin unaffected when notes runtime is also loaded');
    }

    // tasks plugin unaffected when notes is loaded
    {
      var sbTasks = makeSandbox();
      load(sbTasks, 'js/core/events.js');
      load(sbTasks, 'js/core/platform.js');
      load(sbTasks, 'js/core/shell.js');
      load(sbTasks, 'js/core/services/search.js');
      load(sbTasks, 'js/core/services/calendar.js');
      load(sbTasks, 'js/core/services/widgets.js');
      load(sbTasks, 'js/core/services/notifications.js');
      load(sbTasks, 'js/core/services/dialogs.js');
      load(sbTasks, 'js/core/services/plugin-services.js');
      load(sbTasks, 'js/core/plugin-sdk.js');
      load(sbTasks, 'js/plugins/tasks.runtime.js');
      load(sbTasks, 'js/plugins/notes.runtime.js');
      sbTasks.Platform.boot();
      sbTasks.Platform.ready();
      ok(sbTasks.Platform.hasPlugin('tasks') && sbTasks.Platform.hasPlugin('notes'),
         'tasks plugin unaffected when notes runtime is also loaded');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Regression (prior test suites)
  // ══════════════════════════════════════════════════════════════════════
  section('8. Regression');
  {
    var suites = [
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
        // Expect final line to contain "tests passed" and 0 failures
        var lines = out.trim().split('\n');
        var finalLine = lines[lines.length - 1];
        // Check for pattern like "✓ N/N tests passed" — no FAIL lines
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
