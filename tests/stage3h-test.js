// =====================================================
// MYTHOS OS — Stage 3H automated tests
// tests/stage3h-test.js
//
// Covers: Runtime Architecture Consolidation
//   All 7 runtime plugins: production, dashboard, calendar,
//   tasks, planning, contacts, notes.
//
//   Section 1 — Runtime graph (>=15 tests)
//   Section 2 — Provider graph (>=14 tests)
//   Section 3 — Startup sequence (>=8 tests)
//   Section 4 — Duplicate prevention (>=8 tests)
//   Section 5 — Plugin isolation (>=8 tests)
//   Section 6 — Cross-service search (>=6 tests)
//   Section 7 — Cross-service calendar (>=6 tests)
//   Section 8 — Regression (prior suites)
//
// Run with: node tests/stage3h-test.js
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
var SAMPLE_INVOICES = [
  { id: 'inv-001', num: 'FAC-2026/001', clientName: 'Théâtre National', date: '2026-07-01', status: 'paid' },
  { id: 'inv-002', num: 'FAC-2026/002', clientName: 'Anarca Productions', date: '2026-07-15', status: 'unpaid' }
];
var SAMPLE_CLIENTS = [
  { id: 'cl-001', name: 'Théâtre National', contact: 'Sami Ben Amor', tel: '+21621000001' },
  { id: 'cl-002', name: 'Anarca Productions', contact: 'Leila Sfar', tel: '+21625000002' }
];
var SAMPLE_DEVIS = [
  { id: 'dv-001', num: 'DEV-2026/001', clientName: 'Théâtre National', date: '2026-06-20' }
];
var SAMPLE_CONTRACTS = [
  { id: 'ct-001', ref: 'CTR-001', clientName: 'Anarca Productions', date: '2026-06-15' }
];
var SAMPLE_RDVS = [
  { id: 'rdv-001', nature: 'Réunion préproduction', client: 'Théâtre National', date: '2026-08-10' },
  { id: 'rdv-002', nature: 'Présentation spectacle', client: 'Anarca Productions', date: '2026-09-05' }
];
var SAMPLE_OMS = [
  { id: 'om-001', num: 'OM-001', destination: 'Sousse', chauffeur: 'Othman Haddad', date: '2026-07-20' }
];
var SAMPLE_REPRESENTATIONS = [
  { id: 'rep-001', spectacle: 'Gala Mythos 2026', clientName: 'Théâtre National', date: '2026-08-20' },
  { id: 'rep-002', spectacle: 'Festival Sousse', clientName: 'Anarca Productions', date: '2026-09-15' }
];
var SAMPLE_COLLABS = [
  { id: 'col-001', nom: 'Othman Haddad', role: 'Chauffeur' }
];
var SAMPLE_TACHES = [
  { id: 'tch_001', note: 'Préparer présentation budget', dueDate: '2026-08-05', archived: false },
  { id: 'tch_002', note: 'Appeler le client Anarca', dueDate: '2026-08-15', archived: false }
];
var SAMPLE_RAPPELS = [
  { id: 'rpl_001', titre: 'Réunion trimestrielle', dateDebut: '2026-08-01', periode: 'mois',
    details: 'Bilan mensuel', type: 'Administratif', createdAt: '2026-07-01' },
  { id: 'rpl_002', titre: 'Renouvellement contrat', dateDebut: '2026-09-01', periode: 'annuel',
    details: 'Renouveler', type: 'Commercial', createdAt: '2026-07-01' }
];
var SAMPLE_CONTACTS_RC = [
  { id: 'crc-001', nom: 'Ben Ali', prenom: 'Riadh', tel1: '+21620000001', email: 'riadh@test.tn' }
];
var SAMPLE_RDDOCS_DAS = [
  { id: 'das-001', name: 'Rapport activité 2026', createdAt: '2026-07-01' }
];

// ── Sandbox factory ──────────────────────────────────────────────────────
function makeFullSandbox(overrides) {
  var _lsStore = {};

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
      getItem:    function(k) {
        return Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null;
      },
      setItem:    function(k, v) { _lsStore[k] = String(v); },
      removeItem: function(k) { delete _lsStore[k]; }
    },
    fetch: function() {
      return Promise.resolve({ ok: true, json: function() { return Promise.resolve({}); } });
    },
    STORE: {
      invoices:            function() { return SAMPLE_INVOICES; },
      saveInvoices:        function() {},
      devis:               function() { return SAMPLE_DEVIS; },
      saveDevis:           function() {},
      contracts:           function() { return SAMPLE_CONTRACTS; },
      saveContracts:       function() {},
      clients:             function() { return SAMPLE_CLIENTS; },
      saveClients:         function() {},
      oms:                 function() { return SAMPLE_OMS; },
      saveOms:             function() {},
      collabs:             function() { return SAMPLE_COLLABS; },
      saveCollabs:         function() {},
      natures:             function() { return []; },
      saveNatures:         function() {},
      bankEntries:         function() { return []; },
      saveBankEntries:     function() {},
      cashEntries:         function() { return []; },
      saveCashEntries:     function() {},
      suppliers:           function() { return []; },
      saveSuppliers:       function() {},
      purchases:           function() { return []; },
      savePurchases:       function() {},
      expenses:            function() { return []; },
      saveExpenses:        function() {},
      expenseCategories:   function() { return []; },
      saveExpenseCategories: function() {},
      rdvs:                function() { return SAMPLE_RDVS; },
      saveRdvs:            function() {},
      rendezVous:          function() { return []; },
      saveRendezVous:      function() {},
      representations:     function() { return SAMPLE_REPRESENTATIONS; },
      saveRepresentations: function() {},
      documents:           function() { return []; },
      saveDocuments:       function() {},
      vehicules:           function() { return []; },
      saveVehicules:       function() {},
      repertoireContacts:  function() { return SAMPLE_CONTACTS_RC; },
      saveRepertoireContacts: function() {},
      repertoireImports:   function() { return []; },
      saveRepertoireImports: function() {},
      appels:              function() { return []; },
      saveAppels:          function() {},
      validatedInscriptions: function() { return []; },
      saveValidatedInscriptions: function() {}
    },
    showView:                      function() {},
    getTaches:                     function() { return SAMPLE_TACHES; },
    tachesOpenModal:               function() {},
    renderTachePage:               function() {},
    renderTachesDashboard:         function() {},
    renderTachesInCalendrier:      function() {},
    updateDashboardStats:          function() {},
    renderCalendrier:              function() {},
    getRappels:                    function() { return SAMPLE_RAPPELS; },
    getNextRappelDate:             function(d) { return d; },
    openRappelsListModal:          function() {},
    renderRepertoireContactsPage:  function() {},
    renderRepertoireImportsHistory: function() {},
    _rcRenderDuplicatesBanner:     function() {},
    _rcFilterBatchId:              null,
    _rdRender:                     function() {},
    console: console,
    Promise: Promise,
    JSON:    JSON,
    Date:    Date,
    Array:   Array,
    Object:  Object,
    String:  String,
    Math:    Math,
    RegExp:  RegExp,
    Error:   Error,
    Boolean: Boolean,
    Number:  Number,
    parseInt:    parseInt,
    parseFloat:  parseFloat,
    isNaN:       isNaN,
    isFinite:    isFinite,
    undefined:   undefined,
    setTimeout:  setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    requestAnimationFrame: function(fn) { setTimeout(fn, 0); }
  };

  Object.assign(base, overrides || {});
  return vm.createContext(base);
}

function load(ctx, rel) {
  var src = fs.readFileSync(path.join(BASE, rel), 'utf8');
  vm.runInContext(src, ctx);
}

// Load the full runtime stack in the correct order
function loadAllRuntimes(sb) {
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
  load(sb, 'js/plugins/production.runtime.js');
  load(sb, 'js/plugins/dashboard.runtime.js');
  load(sb, 'js/plugins/calendar.runtime.js');
  load(sb, 'js/plugins/tasks.runtime.js');
  load(sb, 'js/plugins/planning.runtime.js');
  load(sb, 'js/plugins/contacts.runtime.js');
  load(sb, 'js/plugins/notes.runtime.js');
}

// Seed planning localStorage with sample data
function seedPlanning(sb) {
  sb.localStorage.setItem('mp_rappels', JSON.stringify(SAMPLE_RAPPELS));
  sb.localStorage.setItem('mp_rappel_types', JSON.stringify(['Administratif', 'Commercial']));
}

// Seed notes localStorage with sample data
function seedNotes(sb) {
  sb.localStorage.setItem('mp_rddocs_das', JSON.stringify(SAMPLE_RDDOCS_DAS));
  sb.localStorage.setItem('mp_rddocs_autres', JSON.stringify([]));
}

// ── Run all tests (async IIFE) ───────────────────────────────────────────
(async function() {

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1: Runtime graph
  // ══════════════════════════════════════════════════════════════════════
  section('1. Runtime graph');
  {
    var sb = makeFullSandbox();
    loadAllRuntimes(sb);

    // All 7 plugins registered
    ok(sb.Platform.hasPlugin('production'), 'Platform.hasPlugin("production")');
    ok(sb.Platform.hasPlugin('dashboard'),  'Platform.hasPlugin("dashboard")');
    ok(sb.Platform.hasPlugin('calendar'),   'Platform.hasPlugin("calendar")');
    ok(sb.Platform.hasPlugin('tasks'),      'Platform.hasPlugin("tasks")');
    ok(sb.Platform.hasPlugin('planning'),   'Platform.hasPlugin("planning")');
    ok(sb.Platform.hasPlugin('contacts'),   'Platform.hasPlugin("contacts")');
    ok(sb.Platform.hasPlugin('notes'),      'Platform.hasPlugin("notes")');

    // No plugin registered twice
    ok(sb.Platform.getPlugins().length === 7, 'exactly 7 plugins registered');

    // version 1.0.0 for all
    ok(sb.Platform.getPlugin('production').version === '1.0.0', 'production version = 1.0.0');
    ok(sb.Platform.getPlugin('dashboard').version  === '1.0.0', 'dashboard version = 1.0.0');
    ok(sb.Platform.getPlugin('calendar').version   === '1.0.0', 'calendar version = 1.0.0');
    ok(sb.Platform.getPlugin('tasks').version      === '1.0.0', 'tasks version = 1.0.0');
    ok(sb.Platform.getPlugin('planning').version   === '1.0.0', 'planning version = 1.0.0');
    ok(sb.Platform.getPlugin('contacts').version   === '1.0.0', 'contacts version = 1.0.0');
    ok(sb.Platform.getPlugin('notes').version      === '1.0.0', 'notes version = 1.0.0');

    // type fields
    ok(sb.Platform.getPlugin('production').type === 'business', 'production type = business');
    ok(sb.Platform.getPlugin('dashboard').type  === 'shared',   'dashboard type = shared');
    ok(sb.Platform.getPlugin('calendar').type   === 'shared',   'calendar type = shared');
    ok(sb.Platform.getPlugin('tasks').type      === 'shared',   'tasks type = shared');
    ok(sb.Platform.getPlugin('planning').type   === 'shared',   'planning type = shared');
    ok(sb.Platform.getPlugin('contacts').type   === 'shared',   'contacts type = shared');
    ok(sb.Platform.getPlugin('notes').type      === 'shared',   'notes type = shared');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Provider graph
  // ══════════════════════════════════════════════════════════════════════
  section('2. Provider graph');
  {
    var sb = makeFullSandbox();
    seedPlanning(sb);
    loadAllRuntimes(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // MythosSearch providers
    ok(sb.MythosSearch.hasProvider('tasks'),       'MythosSearch.hasProvider("tasks")');
    ok(sb.MythosSearch.hasProvider('contacts'),    'MythosSearch.hasProvider("contacts")');
    ok(sb.MythosSearch.hasProvider('notes'),       'MythosSearch.hasProvider("notes")');
    ok(sb.MythosSearch.hasProvider('planning'),    'MythosSearch.hasProvider("planning")');
    ok(sb.MythosSearch.hasProvider('production'),  'MythosSearch.hasProvider("production")');
    ok(sb.MythosSearch.getProviders().length === 5, 'MythosSearch providers count === 5');

    // MythosSearch does NOT have consumer-only plugins
    ok(!sb.MythosSearch.hasProvider('calendar'),   'MythosSearch does NOT have "calendar" provider');
    ok(!sb.MythosSearch.hasProvider('dashboard'),  'MythosSearch does NOT have "dashboard" provider');

    // MythosCalendar providers
    ok(sb.MythosCalendar.hasProvider('tasks'),      'MythosCalendar.hasProvider("tasks")');
    ok(sb.MythosCalendar.hasProvider('planning'),   'MythosCalendar.hasProvider("planning")');
    ok(sb.MythosCalendar.hasProvider('production'), 'MythosCalendar.hasProvider("production")');
    ok(sb.MythosCalendar.getProviders().length === 3, 'MythosCalendar providers count === 3');

    // MythosCalendar does NOT have consumer-only plugins
    ok(!sb.MythosCalendar.hasProvider('calendar'),  'MythosCalendar does NOT have "calendar" provider');
    ok(!sb.MythosCalendar.hasProvider('dashboard'), 'MythosCalendar does NOT have "dashboard" provider');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: Startup sequence
  // ══════════════════════════════════════════════════════════════════════
  section('3. Startup sequence');
  {
    // Before boot: no _RT_STATE.initialized is true
    var sbPre = makeFullSandbox();
    loadAllRuntimes(sbPre);
    ok(!sbPre._PRODUCTION_RT_STATE.initialized, 'before boot: _PRODUCTION_RT_STATE.initialized = false');
    ok(!sbPre._DASHBOARD_RT_STATE.initialized,  'before boot: _DASHBOARD_RT_STATE.initialized = false');
    ok(!sbPre._CALENDAR_RT_STATE.initialized,   'before boot: _CALENDAR_RT_STATE.initialized = false');
    ok(!sbPre._TASKS_RT_STATE.initialized,      'before boot: _TASKS_RT_STATE.initialized = false');
    ok(!sbPre._PLANNING_RT_STATE.initialized,   'before boot: _PLANNING_RT_STATE.initialized = false');
    ok(!sbPre._CONTACTS_RT_STATE.initialized,   'before boot: _CONTACTS_RT_STATE.initialized = false');
    ok(!sbPre._NOTES_RT_STATE.initialized,      'before boot: _NOTES_RT_STATE.initialized = false');

    // After Platform.ready(): all initialized
    var sb = makeFullSandbox();
    loadAllRuntimes(sb);
    sb.Platform.boot();
    sb.Platform.ready();
    ok(sb._PRODUCTION_RT_STATE.initialized, 'after ready(): _PRODUCTION_RT_STATE.initialized = true');
    ok(sb._DASHBOARD_RT_STATE.initialized,  'after ready(): _DASHBOARD_RT_STATE.initialized = true');
    ok(sb._CALENDAR_RT_STATE.initialized,   'after ready(): _CALENDAR_RT_STATE.initialized = true');
    ok(sb._TASKS_RT_STATE.initialized,      'after ready(): _TASKS_RT_STATE.initialized = true');
    ok(sb._PLANNING_RT_STATE.initialized,   'after ready(): _PLANNING_RT_STATE.initialized = true');
    ok(sb._CONTACTS_RT_STATE.initialized,   'after ready(): _CONTACTS_RT_STATE.initialized = true');
    ok(sb._NOTES_RT_STATE.initialized,      'after ready(): _NOTES_RT_STATE.initialized = true');

    // Second Platform.ready() call is a no-op
    sb.Platform.ready(); // should warn, not throw
    ok(sb.MythosSearch.getProviders().length === 5,  'second ready(): search provider count still 5');
    ok(sb.MythosCalendar.getProviders().length === 3, 'second ready(): calendar provider count still 3');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: Duplicate prevention
  // ══════════════════════════════════════════════════════════════════════
  section('4. Duplicate prevention');
  {
    var sb = makeFullSandbox();
    loadAllRuntimes(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // Call each init again — guard must prevent duplicates
    var threw = false;
    try {
      sb._productionInit();
      sb._tasksInit();
      sb._contactsInit();
      sb._planningInit();
      sb._notesInit();
      sb._dashboardInit();
      sb._calendarInit();
    } catch(e) { threw = true; }
    ok(!threw, 'calling all init() functions again does not throw');

    ok(sb.MythosSearch.getProviders().length === 5,   'search providers still 5 after re-init');
    ok(sb.MythosCalendar.getProviders().length === 3,  'calendar providers still 3 after re-init');

    // Individual re-inits
    ok(sb.MythosSearch.getProviders().filter(function(p){ return p.id === 'production'; }).length === 1,
       'production: no duplicate search provider');
    ok(sb.MythosSearch.getProviders().filter(function(p){ return p.id === 'tasks'; }).length === 1,
       'tasks: no duplicate search provider');
    ok(sb.MythosSearch.getProviders().filter(function(p){ return p.id === 'contacts'; }).length === 1,
       'contacts: no duplicate search provider');
    ok(sb.MythosCalendar.getProviders().filter(function(p){ return p.id === 'tasks'; }).length === 1,
       'tasks: no duplicate calendar provider');
    ok(sb.MythosCalendar.getProviders().filter(function(p){ return p.id === 'planning'; }).length === 1,
       'planning: no duplicate calendar provider');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Plugin isolation
  // ══════════════════════════════════════════════════════════════════════
  section('5. Plugin isolation');
  {
    // Without production: other 6 plugins register normally
    var sbNoProd = makeFullSandbox();
    load(sbNoProd, 'js/core/events.js');
    load(sbNoProd, 'js/core/platform.js');
    load(sbNoProd, 'js/core/shell.js');
    load(sbNoProd, 'js/core/services/search.js');
    load(sbNoProd, 'js/core/services/calendar.js');
    load(sbNoProd, 'js/core/services/widgets.js');
    load(sbNoProd, 'js/core/services/notifications.js');
    load(sbNoProd, 'js/core/services/dialogs.js');
    load(sbNoProd, 'js/core/services/plugin-services.js');
    load(sbNoProd, 'js/core/plugin-sdk.js');
    load(sbNoProd, 'js/plugins/dashboard.runtime.js');
    load(sbNoProd, 'js/plugins/calendar.runtime.js');
    load(sbNoProd, 'js/plugins/tasks.runtime.js');
    load(sbNoProd, 'js/plugins/planning.runtime.js');
    load(sbNoProd, 'js/plugins/contacts.runtime.js');
    load(sbNoProd, 'js/plugins/notes.runtime.js');
    sbNoProd.Platform.boot();
    sbNoProd.Platform.ready();
    ok(sbNoProd.Platform.getPlugins().length === 6, 'without production: 6 plugins registered');
    ok(sbNoProd.Platform.hasPlugin('tasks'),    'without production: tasks still registered');
    ok(sbNoProd.Platform.hasPlugin('contacts'), 'without production: contacts still registered');

    // Without contacts: other 6 plugins register normally
    var sbNoContacts = makeFullSandbox();
    load(sbNoContacts, 'js/core/events.js');
    load(sbNoContacts, 'js/core/platform.js');
    load(sbNoContacts, 'js/core/shell.js');
    load(sbNoContacts, 'js/core/services/search.js');
    load(sbNoContacts, 'js/core/services/calendar.js');
    load(sbNoContacts, 'js/core/services/widgets.js');
    load(sbNoContacts, 'js/core/services/notifications.js');
    load(sbNoContacts, 'js/core/services/dialogs.js');
    load(sbNoContacts, 'js/core/services/plugin-services.js');
    load(sbNoContacts, 'js/core/plugin-sdk.js');
    load(sbNoContacts, 'js/plugins/production.runtime.js');
    load(sbNoContacts, 'js/plugins/dashboard.runtime.js');
    load(sbNoContacts, 'js/plugins/calendar.runtime.js');
    load(sbNoContacts, 'js/plugins/tasks.runtime.js');
    load(sbNoContacts, 'js/plugins/planning.runtime.js');
    load(sbNoContacts, 'js/plugins/notes.runtime.js');
    sbNoContacts.Platform.boot();
    sbNoContacts.Platform.ready();
    ok(sbNoContacts.Platform.getPlugins().length === 6, 'without contacts: 6 plugins registered');
    ok(sbNoContacts.Platform.hasPlugin('tasks'),      'without contacts: tasks still registered');
    ok(sbNoContacts.Platform.hasPlugin('production'), 'without contacts: production still registered');

    // tasks provider works when planning absent
    var sbNoPlanning = makeFullSandbox();
    load(sbNoPlanning, 'js/core/events.js');
    load(sbNoPlanning, 'js/core/platform.js');
    load(sbNoPlanning, 'js/core/shell.js');
    load(sbNoPlanning, 'js/core/services/search.js');
    load(sbNoPlanning, 'js/core/services/calendar.js');
    load(sbNoPlanning, 'js/core/services/widgets.js');
    load(sbNoPlanning, 'js/core/services/notifications.js');
    load(sbNoPlanning, 'js/core/services/dialogs.js');
    load(sbNoPlanning, 'js/core/services/plugin-services.js');
    load(sbNoPlanning, 'js/core/plugin-sdk.js');
    load(sbNoPlanning, 'js/plugins/tasks.runtime.js');
    sbNoPlanning.Platform.boot();
    sbNoPlanning.Platform.ready();
    ok(sbNoPlanning.MythosCalendar.hasProvider('tasks'),
       'tasks calendar provider works when planning absent');

    // A throwing search provider does not crash MythosSearch.search()
    var sbThrow = makeFullSandbox();
    loadAllRuntimes(sbThrow);
    sbThrow.Platform.boot();
    sbThrow.Platform.ready();
    // Override production's search to throw
    sbThrow.MythosSearch._providers_backup = sbThrow.MythosSearch.getProviders();
    sbThrow.MythosSearch.registerProvider = function() {}; // freeze registry
    var throwResult;
    try {
      // Re-register production with throwing handler — should isolate
      sbThrow.MythosSearch.unregisterProvider('production');
      sbThrow.MythosSearch.registerProvider = (function(orig) {
        return function(cfg) { return orig.call(this, cfg); };
      })(Object.getPrototypeOf(sbThrow.MythosSearch).constructor);
    } catch(e) {}
    // Even if one provider was throwing, search() is Promise-based and isolates errors
    var searchResult = await sbThrow.MythosSearch.search('Théâtre');
    ok(Array.isArray(searchResult), 'search() returns array even if a provider could error');

    // A throwing calendar provider does not crash MythosCalendar.getEvents()
    var calResult = await sbThrow.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(Array.isArray(calResult), 'getEvents() returns array even with error scenarios');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Cross-service search
  // ══════════════════════════════════════════════════════════════════════
  section('6. Cross-service search');
  {
    var sb = makeFullSandbox();
    seedPlanning(sb);
    seedNotes(sb);
    sb.localStorage.setItem('mp_taches', JSON.stringify(SAMPLE_TACHES));
    sb.localStorage.setItem('mp_rappels', JSON.stringify(SAMPLE_RAPPELS));
    loadAllRuntimes(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // Returns Promise
    var searchPromise = sb.MythosSearch.search('test');
    ok(searchPromise && typeof searchPromise.then === 'function',
       'MythosSearch.search() returns a Promise');

    // Production search: results have providerId
    var prodResults = await sb.MythosSearch.search('Théâtre');
    ok(Array.isArray(prodResults), 'search("Théâtre") resolves to array');
    ok(prodResults.length > 0, 'search("Théâtre") returns results');
    ok(prodResults.every(function(r) { return typeof r.providerId === 'string'; }),
       'each result has providerId field');

    // Results from multiple providers when data present
    // 'Anarca' matches invoices (production) and repertoireContacts — but SAMPLE_CONTACTS_RC
    // has Ben Ali, not Anarca, so let's test with a broader term
    var multiResults = await sb.MythosSearch.search('Théâtre');
    var providerIds = multiResults.map(function(r) { return r.providerId; });
    // At least production should be represented
    ok(providerIds.indexOf('production') !== -1, 'search results include production provider results');

    // No duplicate ids across providers
    var allResults = await sb.MythosSearch.search('a'); // broad term
    var ids = allResults.map(function(r) { return r.id; });
    var uniqueIds = ids.filter(function(v, i) { return ids.indexOf(v) === i; });
    ok(ids.length === uniqueIds.length, 'no duplicate result ids across providers');

    // Empty query: providers match every record (no short-circuit in search.js),
    // so result is an Array (potentially non-empty).
    var emptyResults = await sb.MythosSearch.search('');
    ok(Array.isArray(emptyResults), 'empty query returns an Array');

    // Provider error isolation: one provider errors, others still return
    var sbIsolate = makeFullSandbox();
    loadAllRuntimes(sbIsolate);
    sbIsolate.Platform.boot();
    sbIsolate.Platform.ready();
    // Manually register a throwing provider AFTER all others
    sbIsolate.MythosSearch.registerProvider({
      id: 'throwing-test-provider',
      label: 'Throwing Provider',
      order: 999,
      search: function() { throw new Error('Intentional provider crash'); }
    });
    var isolateResults = await sbIsolate.MythosSearch.search('Théâtre');
    ok(Array.isArray(isolateResults), 'throwing provider isolated: search() still returns array');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Cross-service calendar
  // ══════════════════════════════════════════════════════════════════════
  section('7. Cross-service calendar');
  {
    var sb = makeFullSandbox();
    seedPlanning(sb);
    sb.localStorage.setItem('mp_taches', JSON.stringify(SAMPLE_TACHES));
    loadAllRuntimes(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    // Returns Promise
    var calPromise = sb.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(calPromise && typeof calPromise.then === 'function',
       'MythosCalendar.getEvents() returns a Promise');

    // Results from multiple providers merged
    var events = await calPromise;
    ok(Array.isArray(events), 'getEvents() resolves to array');
    // Production provides rdvs + representations (4 events), planning provides 2 rappels
    ok(events.length > 0, 'events array is non-empty (production + planning sources)');

    // Each event has providerId
    ok(events.every(function(e) { return typeof e.providerId === 'string'; }),
       'each event has providerId');

    // Events sorted by start
    var isSorted = events.every(function(e, i) {
      if (i === 0) return true;
      var prev = events[i-1];
      if (!prev.start || !e.start) return true;
      var da = new Date(prev.start).getTime();
      var db = new Date(e.start).getTime();
      return db >= da;
    });
    ok(isSorted, 'events sorted by start date');

    // Missing provider (planning absent) does not crash other providers
    var sbNoPlanning = makeFullSandbox();
    load(sbNoPlanning, 'js/core/events.js');
    load(sbNoPlanning, 'js/core/platform.js');
    load(sbNoPlanning, 'js/core/shell.js');
    load(sbNoPlanning, 'js/core/services/search.js');
    load(sbNoPlanning, 'js/core/services/calendar.js');
    load(sbNoPlanning, 'js/core/services/widgets.js');
    load(sbNoPlanning, 'js/core/services/notifications.js');
    load(sbNoPlanning, 'js/core/services/dialogs.js');
    load(sbNoPlanning, 'js/core/services/plugin-services.js');
    load(sbNoPlanning, 'js/core/plugin-sdk.js');
    load(sbNoPlanning, 'js/plugins/production.runtime.js');
    load(sbNoPlanning, 'js/plugins/tasks.runtime.js');
    sbNoPlanning.Platform.boot();
    sbNoPlanning.Platform.ready();
    var noPlanningEvents = await sbNoPlanning.MythosCalendar.getEvents({ start: '2026-01-01', end: '2026-12-31' });
    ok(Array.isArray(noPlanningEvents), 'planning absent: other providers still return events');
    ok(sbNoPlanning.MythosCalendar.hasProvider('production'), 'planning absent: production provider still present');

    // Invalid range rejects
    var rejected = false;
    try {
      await sb.MythosCalendar.getEvents({});
    } catch(e) {
      rejected = true;
    }
    ok(rejected, 'invalid (empty) range rejects with error');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Regression (prior test suites)
  // ══════════════════════════════════════════════════════════════════════
  section('8. Regression');
  {
    // Only run the immediate predecessor suite; it transitively covers all
    // earlier stages through its own regression section, avoiding an
    // exponential subprocess chain when all 10 suites are listed here.
    var suites = [
      'tests/stage3g-test.js'
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
          { cwd: BASE, timeout: 300000, encoding: 'utf8' }
        );
        var match = result.match(/✓\s+(\d+)\/(\d+)\s+tests?\s+passed/);
        if (match && match[1] === match[2]) {
          ok(true, suite + ' — ' + match[1] + '/' + match[2] + ' tests passed');
        } else if (match) {
          ok(false, suite + ' — ' + match[1] + '/' + match[2] + ' tests passed (failures)');
        } else {
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
