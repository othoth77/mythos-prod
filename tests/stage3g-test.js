// =====================================================
// MYTHOS OS — Stage 3G automated tests
// tests/stage3g-test.js
//
// Covers: production.runtime.js — plugin registration,
// onBoot storage validation (20 keys), onReady lifecycle,
// search provider (8 collections), calendar provider (rdvs +
// representations), navigation, backward compatibility,
// and regressions vs all prior suites.
//
// Run with: node tests/stage3g-test.js
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
  { id: 'inv-001', num: 'FAC-2026/001', clientName: 'Théâtre National', date: '2026-07-01', status: 'paid', totalTTC: 3500 },
  { id: 'inv-002', num: 'FAC-2026/002', clientName: 'Anarca Productions', date: '2026-07-15', status: 'unpaid', totalTTC: 2800 }
];

var SAMPLE_CLIENTS = [
  { id: 'cl-001', name: 'Théâtre National', contact: 'Sami Ben Amor', tel: '+21621000001', email: 'contact@theatrenational.tn' },
  { id: 'cl-002', name: 'Anarca Productions', contact: 'Leila Sfar', tel: '+21625000002', email: 'leila@anarca.tn' }
];

var SAMPLE_DEVIS = [
  { id: 'dv-001', num: 'DEV-2026/001', clientName: 'Théâtre National', date: '2026-06-20', statut: 'envoyé' }
];

var SAMPLE_CONTRACTS = [
  { id: 'ct-001', ref: 'CTR-001', clientName: 'Anarca Productions', date: '2026-06-15', status: 'signed' }
];

var SAMPLE_RDVS = [
  { id: 'rdv-001', nature: 'Réunion de préproduction', client: 'Théâtre National',
    lieu: 'Salle de conférence Tunis', date: '2026-08-10', heure: '10:00', status: 'planned' },
  { id: 'rdv-002', nature: 'Présentation spectacle', client: 'Anarca Productions',
    lieu: 'Scène nationale Sfax', date: '2026-09-05', heure: '15:00', status: 'confirmed' }
];

var SAMPLE_OMS = [
  { id: 'om-001', num: 'OM-001', destination: 'Sousse', chauffeur: 'Othman Haddad', date: '2026-07-20' },
  { id: 'om-002', num: 'OM-002', destination: 'Sfax', chauffeur: 'Ahmed Ben Ali', date: '2026-07-25' }
];

var SAMPLE_REPRESENTATIONS = [
  { id: 'rep-001', spectacle: 'Gala Mythos 2026', clientName: 'Théâtre National', date: '2026-08-20', fee: 5000 },
  { id: 'rep-002', spectacle: 'Festival Sousse', clientName: 'Anarca Productions', date: '2026-09-15', fee: 3200 }
];

var SAMPLE_COLLABS = [
  { id: 'col-001', nom: 'Othman Haddad', role: 'Chauffeur', contact: '+21698999660' },
  { id: 'col-002', nom: 'Sonia Mrad', role: 'Régisseur', contact: '+21622000003' }
];

var SAMPLE_TACHES = [
  { id: 'tch_001', note: 'Préparer présentation budget', dueDate: '2026-08-05', archived: false }
];
var SAMPLE_RAPPELS = [
  { id: 'rpl_001', titre: 'Réunion trimestrielle', dateDebut: '2026-08-01', periode: 'mois',
    details: 'Bilan mensuel', type: 'Administratif', createdAt: '2026-07-01' }
];
var SAMPLE_CONTACTS = [
  { id: 'ct_rep_001', nom: 'Ben Ali', prenom: 'Riadh', tel1: '+21620000001' }
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
      invoices:           function() { return SAMPLE_INVOICES; },
      saveInvoices:       function(d) {},
      devis:              function() { return SAMPLE_DEVIS; },
      saveDevis:          function(d) {},
      contracts:          function() { return SAMPLE_CONTRACTS; },
      saveContracts:      function(d) {},
      clients:            function() { return SAMPLE_CLIENTS; },
      saveClients:        function(d) {},
      oms:                function() { return SAMPLE_OMS; },
      saveOms:            function(d) {},
      collabs:            function() { return SAMPLE_COLLABS; },
      saveCollabs:        function(d) {},
      natures:            function() { return []; },
      saveNatures:        function(d) {},
      bankEntries:        function() { return []; },
      saveBankEntries:    function(d) {},
      cashEntries:        function() { return []; },
      saveCashEntries:    function(d) {},
      suppliers:          function() { return []; },
      saveSuppliers:      function(d) {},
      purchases:          function() { return []; },
      savePurchases:      function(d) {},
      expenses:           function() { return []; },
      saveExpenses:       function(d) {},
      expenseCategories:  function() { return []; },
      saveExpenseCategories: function(d) {},
      rdvs:               function() { return SAMPLE_RDVS; },
      saveRdvs:           function(d) {},
      rendezVous:         function() { return []; },
      saveRendezVous:     function(d) {},
      representations:    function() { return SAMPLE_REPRESENTATIONS; },
      saveRepresentations: function(d) {},
      documents:          function() { return []; },
      saveDocuments:      function(d) {},
      vehicules:          function() { return []; },
      saveVehicules:      function(d) {},
      repertoireContacts: function() { return SAMPLE_CONTACTS; },
      saveRepertoireContacts: function(d) {},
      repertoireImports:  function() { return []; },
      saveRepertoireImports: function(d) {},
      appels:             function() { return []; },
      saveAppels:         function(d) {},
      validatedInscriptions: function() { return []; },
      saveValidatedInscriptions: function(d) {}
    },
    showView: function(v) { _showViewLog.push(v); },
    _showViewLog: _showViewLog,
    // stubs for tasks.runtime.js
    getTaches:                function() { return SAMPLE_TACHES; },
    tachesOpenModal:          function() {},
    renderTachePage:          function() {},
    renderTachesDashboard:    function() {},
    renderTachesInCalendrier: function() {},
    updateDashboardStats:     function() {},
    // stubs for planning.runtime.js
    getRappels:               function() { return SAMPLE_RAPPELS; },
    getNextRappelDate:        function(d) { return d; },
    openRappelsListModal:     function() {},
    // stubs for contacts.runtime.js
    renderRepertoireContactsPage:   function() {},
    renderRepertoireImportsHistory: function() {},
    _rcRenderDuplicatesBanner:      function() {},
    _rcFilterBatchId:               null,
    // stubs for notes.runtime.js
    _rdRender: function() {},
    // stubs for dashboard.runtime.js
    renderCalendrier:         function() {},
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

// Load full service stack + production.runtime.js
function loadProductionRuntime(sb) {
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
}

// Load full stack including all runtime plugins
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
  load(sb, 'js/plugins/production.runtime.js');
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

    ok(htmlRaw.indexOf('production.runtime.js') !== -1,
       'production.runtime.js present in index.html');
    ok(htmlRaw.indexOf('production.plugin.js') === -1,
       'production.plugin.js removed from index.html');

    var rtPath = path.join(BASE, 'js/plugins/production.runtime.js');
    ok(fs.existsSync(rtPath), 'production.runtime.js exists on disk');

    // Loading order checks
    var posSDK        = htmlRaw.indexOf('src="js/core/plugin-sdk.js');
    var posProdRT     = htmlRaw.indexOf('src="js/plugins/production.runtime.js');
    var posDashRT     = htmlRaw.indexOf('src="js/plugins/dashboard.runtime.js');
    var posAppJS      = htmlRaw.indexOf('src="js/app.js');

    ok(posSDK !== -1 && posProdRT !== -1 && posSDK < posProdRT,
       'plugin-sdk loaded before production.runtime');
    ok(posProdRT !== -1 && posDashRT !== -1 && posProdRT < posDashRT,
       'production.runtime loaded before dashboard.runtime');
    ok(posProdRT !== -1 && posAppJS !== -1 && posProdRT < posAppJS,
       'production.runtime loaded before app.js');

    // Key identifiers in file
    var rtSrc = fs.readFileSync(rtPath, 'utf8');
    ok(rtSrc.indexOf('_PRODUCTION_RT_STATE') !== -1,
       'file contains _PRODUCTION_RT_STATE');

    // All 20 storage keys referenced in file
    var storageKeysExpected = [
      'mp_invoices', 'mp_devis', 'mp_contracts', 'mp_rdvs', 'mp_rendez_vous',
      'mp_representations', 'mp_oms', 'mp_clients', 'mp_collabs', 'mp_natures',
      'mp_bank_entries', 'mp_cash_entries', 'mp_expenses', 'mp_expense_categories',
      'mp_suppliers', 'mp_purchases', 'mp_vehicules', 'mp_documents',
      'mp_validated_inscriptions', 'mp_appels'
    ];
    var allKeysPresent = storageKeysExpected.every(function(k) { return rtSrc.indexOf(k) !== -1; });
    ok(allKeysPresent, 'all 20 storage keys referenced in production.runtime.js');

    // All core routes present
    var routesExpected = ['rendez-vous', 'representations', 'om-list', 'clients',
                          'collaborateurs', 'comptabilite', 'compta-bank', 'compta-cash',
                          'sauvegarde', 'parametres'];
    var allRoutesPresent = routesExpected.every(function(r) { return rtSrc.indexOf(r) !== -1; });
    ok(allRoutesPresent, 'all core routes present in production.runtime.js');

    ok(rtSrc.indexOf('.defineSearch(') !== -1, 'file calls .defineSearch()');
    ok(rtSrc.indexOf('.defineCalendar(') !== -1, 'file calls .defineCalendar()');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2: Plugin registration
  // ══════════════════════════════════════════════════════════════════════
  section('2. Plugin registration');
  {
    var sb = makeSandbox();
    loadProductionRuntime(sb);

    ok(sb.Platform.hasPlugin('production'), 'Platform.hasPlugin(production)');

    var m = sb.Platform.getPlugin('production');
    ok(m && m.id === 'production',    'manifest id = production');
    ok(m && m.label === 'Production', 'manifest label = Production');
    ok(m && m.version === '1.0.0',    'manifest version = 1.0.0');
    ok(m && m.type === 'business',    'manifest type = business');

    // Routes: 30 routes
    ok(Array.isArray(m.routes) && m.routes.length === 30,
       'manifest has exactly 30 routes');
    ok(m.routes.some(function(r) { return r.id === 'rendez-vous'; }),
       'routes includes rendez-vous');
    ok(m.routes.some(function(r) { return r.id === 'clients'; }),
       'routes includes clients');
    ok(m.routes.some(function(r) { return r.id === 'comptabilite'; }),
       'routes includes comptabilite');
    ok(m.routes.some(function(r) { return r.id === 'om-list'; }),
       'routes includes om-list');
    ok(m.routes.some(function(r) { return r.id === 'sauvegarde'; }),
       'routes includes sauvegarde');

    // Storage keys: 20
    ok(Array.isArray(m.storageKeys) && m.storageKeys.length === 20,
       'storageKeys has 20 keys');
    ok(m.storageKeys.indexOf('mp_invoices') !== -1, 'storageKeys includes mp_invoices');
    ok(m.storageKeys.indexOf('mp_rdvs') !== -1,     'storageKeys includes mp_rdvs');
    ok(m.storageKeys.indexOf('mp_rendez_vous') !== -1, 'storageKeys includes mp_rendez_vous');
    ok(m.storageKeys.indexOf('mp_appels') !== -1,   'storageKeys includes mp_appels');

    ok(typeof m.onBoot === 'function',  'onBoot is a function');
    ok(typeof m.onReady === 'function', 'onReady is a function');

    ok(m.search && typeof m.search.handler === 'function',
       'search.handler is a function on manifest');
    ok(m.calendar && typeof m.calendar.provider === 'function',
       'calendar.provider is a function on manifest');

    ok(m.menu && m.menu.section === 'Production', 'menu.section = Production');
    ok(m.menu && m.menu.order === 10,             'menu.order = 10');
    ok(m.menu && m.menu.icon === 'production',    'menu.icon = production');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 3: Lifecycle
  // ══════════════════════════════════════════════════════════════════════
  section('3. Lifecycle');
  {
    var sb = makeSandbox();
    loadProductionRuntime(sb);
    ok(sb._PRODUCTION_RT_STATE.initialized === false,
       'not initialized before Platform.ready()');

    sb.Platform.boot();
    ok(sb._PRODUCTION_RT_STATE.initialized === false,
       'not initialized after boot() but before ready()');

    sb.Platform.ready();
    ok(sb._PRODUCTION_RT_STATE.initialized === true,
       'initialized after Platform.ready()');

    ok(sb.MythosSearch.hasProvider('production'),
       'MythosSearch has production provider after ready()');
    ok(sb.MythosCalendar.hasProvider('production'),
       'MythosCalendar has production provider after ready()');

    // Second ready() — idempotent (no duplicate providers)
    sb.Platform.ready();
    ok(sb._PRODUCTION_RT_STATE.initialized === true,
       'still initialized on second Platform.ready()');
    ok(sb.MythosSearch.getProviders().filter(function(p){ return p.id === 'production'; }).length === 1,
       'no duplicate search provider on second ready()');

    // window.load fallback
    var sbFallback = makeSandbox();
    var _loadListeners = [];
    sbFallback.window.addEventListener = function(ev, fn) {
      if (ev === 'load') _loadListeners.push(fn);
    };
    loadProductionRuntime(sbFallback);
    ok(sbFallback._PRODUCTION_RT_STATE.initialized === false,
       'fallback: not initialized before window.load');
    _loadListeners.forEach(function(fn) { fn(); });
    ok(sbFallback._PRODUCTION_RT_STATE.initialized === true,
       'initialized via window.load fallback');

    // _productionInit() twice does not crash
    var sbDbl = makeSandbox();
    loadProductionRuntime(sbDbl);
    sbDbl.Platform.boot();
    sbDbl.Platform.ready();
    var dblThrew = false;
    try { sbDbl._productionInit(); sbDbl._productionInit(); } catch(e) { dblThrew = true; }
    ok(!dblThrew, '_productionInit() called twice does not crash');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4: Storage validation (onBoot)
  // ══════════════════════════════════════════════════════════════════════
  section('4. Storage validation (onBoot)');
  {
    var PROD_KEYS = [
      'mp_invoices', 'mp_devis', 'mp_contracts', 'mp_rdvs', 'mp_rendez_vous',
      'mp_representations', 'mp_oms', 'mp_clients', 'mp_collabs', 'mp_natures',
      'mp_bank_entries', 'mp_cash_entries', 'mp_expenses', 'mp_expense_categories',
      'mp_suppliers', 'mp_purchases', 'mp_vehicules', 'mp_documents',
      'mp_validated_inscriptions', 'mp_appels'
    ];

    // Test: null stays null for each key
    var sbNull = makeSandbox();
    loadProductionRuntime(sbNull);
    sbNull.Platform.boot();
    var nullPasses = PROD_KEYS.every(function(k) { return sbNull.localStorage.getItem(k) === null; });
    ok(nullPasses, 'null stays null for all 20 keys after onBoot');

    // Test: valid array preserved
    var sbValid = makeSandbox();
    loadProductionRuntime(sbValid);
    var validData = JSON.stringify([{ id: 'x-001', name: 'Test' }]);
    PROD_KEYS.forEach(function(k) { sbValid.localStorage.setItem(k, validData); });
    sbValid.Platform.boot();
    var validPasses = PROD_KEYS.every(function(k) { return sbValid.localStorage.getItem(k) === validData; });
    ok(validPasses, 'valid arrays preserved for all 20 keys after onBoot');

    // Test: malformed JSON → '[]'
    var sbMalformed = makeSandbox();
    loadProductionRuntime(sbMalformed);
    PROD_KEYS.forEach(function(k) { sbMalformed.localStorage.setItem(k, 'NOT_JSON!!!'); });
    sbMalformed.Platform.boot();
    var malformedPasses = PROD_KEYS.every(function(k) { return sbMalformed.localStorage.getItem(k) === '[]'; });
    ok(malformedPasses, 'malformed JSON → [] for all 20 keys after onBoot');

    // Test: non-array (object) → '[]'
    var sbObj = makeSandbox();
    loadProductionRuntime(sbObj);
    PROD_KEYS.forEach(function(k) { sbObj.localStorage.setItem(k, '{"not":"array"}'); });
    sbObj.Platform.boot();
    var objPasses = PROD_KEYS.every(function(k) { return sbObj.localStorage.getItem(k) === '[]'; });
    ok(objPasses, 'non-array JSON object → [] for all 20 keys after onBoot');

    // Test: empty array [] preserved
    var sbEmpty = makeSandbox();
    loadProductionRuntime(sbEmpty);
    PROD_KEYS.forEach(function(k) { sbEmpty.localStorage.setItem(k, '[]'); });
    sbEmpty.Platform.boot();
    var emptyPasses = PROD_KEYS.every(function(k) { return sbEmpty.localStorage.getItem(k) === '[]'; });
    ok(emptyPasses, 'empty array [] preserved for all 20 keys after onBoot');

    // Test: valid data not deleted (spot checks)
    var sbSpot = makeSandbox();
    loadProductionRuntime(sbSpot);
    var invData = JSON.stringify(SAMPLE_INVOICES);
    var rdvData = JSON.stringify(SAMPLE_RDVS);
    sbSpot.localStorage.setItem('mp_invoices', invData);
    sbSpot.localStorage.setItem('mp_rdvs', rdvData);
    sbSpot.Platform.boot();
    ok(sbSpot.localStorage.getItem('mp_invoices') === invData,
       'valid mp_invoices data not deleted');
    ok(sbSpot.localStorage.getItem('mp_rdvs') === rdvData,
       'valid mp_rdvs data not deleted');

    // Test: non-owned keys not touched
    var sbOther = makeSandbox();
    loadProductionRuntime(sbOther);
    sbOther.localStorage.setItem('mp_taches', '!!!INVALID!!!');
    sbOther.localStorage.setItem('mp_rappels', '{"bad":true}');
    sbOther.Platform.boot();
    ok(sbOther.localStorage.getItem('mp_taches') === '!!!INVALID!!!',
       'non-owned mp_taches not touched by production onBoot');
    ok(sbOther.localStorage.getItem('mp_rappels') === '{"bad":true}',
       'non-owned mp_rappels not touched by production onBoot');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 5: Search provider
  // ══════════════════════════════════════════════════════════════════════
  section('5. Search provider');
  {
    var sb = makeSandbox();
    loadProductionRuntime(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    ok(sb.MythosSearch.hasProvider('production'),
       'MythosSearch has "production" provider');
    ok(sb.MythosSearch.getProviders().filter(function(p){ return p.id === 'production'; }).length === 1,
       'only 1 production search provider registered');

    // Search by invoice clientName
    var res1 = sb._productionSearchHandler('Théâtre');
    ok(res1.length > 0, 'search "Théâtre" returns results (invoice + client)');
    ok(res1.some(function(r) { return r.route === 'list'; }),
       'invoice result has route "list"');

    // Search by client name
    var res2 = sb._productionSearchHandler('Anarca');
    ok(res2.length > 0, 'search "Anarca" returns results');
    ok(res2.some(function(r) { return r.route === 'clients'; }),
       'client result has route "clients"');

    // Search by RDV nature
    var res3 = sb._productionSearchHandler('préproduction');
    ok(res3.length > 0, 'search by rdv nature returns results');
    ok(res3.some(function(r) { return r.route === 'rendez-vous'; }),
       'rdv result has route "rendez-vous"');

    // Search by OM destination
    var res4 = sb._productionSearchHandler('Sousse');
    ok(res4.length > 0, 'search by om destination returns results');
    ok(res4.some(function(r) { return r.route === 'om-list'; }),
       'om result has route "om-list"');

    // Search by representation spectacle
    var res5 = sb._productionSearchHandler('Gala');
    ok(res5.length > 0, 'search by representation spectacle returns results');
    ok(res5.some(function(r) { return r.route === 'representations'; }),
       'representation result has route "representations"');

    // Search by collab nom
    var res6 = sb._productionSearchHandler('Sonia');
    ok(res6.length > 0, 'search by collab nom returns results');
    ok(res6.some(function(r) { return r.route === 'collaborateurs'; }),
       'collab result has route "collaborateurs"');

    // Normalized schema validation
    var res7 = sb._productionSearchHandler('Théâtre');
    var firstInv = res7.find(function(r) { return r.route === 'list'; });
    ok(firstInv && firstInv.id && firstInv.id.indexOf('prod-') === 0,
       'result id starts with "prod-"');
    ok(firstInv && firstInv.type === 'production', 'result type = "production"');
    ok(firstInv && typeof firstInv.title === 'string', 'result has title (string)');
    ok(firstInv && typeof firstInv.subtitle === 'string', 'result has subtitle (string)');
    ok(firstInv && 'route' in firstInv, 'result has route field');
    ok(firstInv && 'data' in firstInv, 'result has data field');

    // Empty query → []
    var resEmpty = sb._productionSearchHandler('');
    ok(Array.isArray(resEmpty) && resEmpty.length === 0, 'empty query returns []');

    // No match → []
    var resNone = sb._productionSearchHandler('xyzxyzxyz_no_match_at_all');
    ok(Array.isArray(resNone) && resNone.length === 0, 'no match returns []');

    // Case-insensitive
    var resUpper = sb._productionSearchHandler('ANARCA');
    ok(resUpper.length > 0, 'search is case-insensitive (ANARCA matches anarca)');

    // Malformed entry skipped
    var sbMal = makeSandbox();
    sbMal.STORE = {
      invoices: function() { return [null, undefined, { id: 'inv-ok', clientName: 'Théâtre' }, 'bad']; },
      devis: function() { return []; }, contracts: function() { return []; },
      clients: function() { return []; }, rdvs: function() { return []; },
      oms: function() { return []; }, representations: function() { return []; },
      collabs: function() { return []; }
    };
    loadProductionRuntime(sbMal);
    sbMal.Platform.boot(); sbMal.Platform.ready();
    var resMal = sbMal._productionSearchHandler('Théâtre');
    ok(Array.isArray(resMal), 'malformed entries do not crash search handler');

    // Empty STORE arrays → []
    var sbNoData = makeSandbox();
    sbNoData.STORE = {
      invoices: function() { return []; }, devis: function() { return []; },
      contracts: function() { return []; }, clients: function() { return []; },
      rdvs: function() { return []; }, oms: function() { return []; },
      representations: function() { return []; }, collabs: function() { return []; }
    };
    loadProductionRuntime(sbNoData);
    sbNoData.Platform.boot(); sbNoData.Platform.ready();
    var resNoData = sbNoData._productionSearchHandler('test');
    ok(Array.isArray(resNoData) && resNoData.length === 0,
       'empty storage collections return [] from search');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6: Calendar provider
  // ══════════════════════════════════════════════════════════════════════
  section('6. Calendar provider');
  {
    var sb = makeSandbox();
    loadProductionRuntime(sb);
    sb.Platform.boot();
    sb.Platform.ready();

    ok(sb.MythosCalendar.hasProvider('production'),
       'MythosCalendar has "production" provider');

    // getEvents returns a Promise
    var calResult = sb._productionCalendarProvider({ start: '2026-01-01', end: '2026-12-31' });
    ok(calResult && typeof calResult.then === 'function',
       '_productionCalendarProvider returns a Promise');

    var events = await calResult;
    ok(Array.isArray(events), 'calendar provider resolves to an array');
    ok(events.length > 0, 'events array is non-empty (rdvs + representations in range)');

    // Events have required fields
    var ev = events[0];
    ok(ev && typeof ev.id === 'string', 'event has id (string)');
    ok(ev && typeof ev.title === 'string', 'event has title (string)');
    ok(ev && typeof ev.start === 'string', 'event has start (string)');
    ok(ev && ev.allDay === true, 'event has allDay = true');
    ok(ev && ('route' in ev), 'event has route field');
    ok(ev && ('data' in ev), 'event has data field');

    // Events sorted chronologically
    var sorted = events.slice().sort(function(a, b) { return a.start < b.start ? -1 : 1; });
    var sortedOk = events.every(function(e, i) { return e.start === sorted[i].start; });
    ok(sortedOk, 'events sorted chronologically by start');

    // Range start filter: events before 2026-09-01 only
    var rangeStart = await sb._productionCalendarProvider({ start: '2026-01-01', end: '2026-08-31' });
    ok(rangeStart.every(function(e) { return e.start <= '2026-08-31'; }),
       'range end filter: events at or before 2026-08-31');

    // Range end filter: events after 2026-09-01 only
    var rangeEnd = await sb._productionCalendarProvider({ start: '2026-09-01', end: '2026-12-31' });
    ok(rangeEnd.every(function(e) { return e.start >= '2026-09-01'; }),
       'range start filter: events at or after 2026-09-01');

    // Invalid dates skipped
    var sbInvDate = makeSandbox();
    sbInvDate.STORE = {
      rdvs: function() { return [
        { id: 'rdv-bad', nature: 'Bad', date: 'not-a-date' },
        { id: 'rdv-no-date', nature: 'No date' },
        { id: 'rdv-ok', nature: 'Good RDV', date: '2026-08-10', client: 'X' }
      ]; },
      representations: function() { return []; }
    };
    loadProductionRuntime(sbInvDate);
    sbInvDate.Platform.boot(); sbInvDate.Platform.ready();
    var evBad = await sbInvDate._productionCalendarProvider({});
    ok(evBad.length === 1 && evBad[0].start === '2026-08-10',
       'invalid dates skipped; valid date included');

    // Malformed entries skipped
    var sbMalCal = makeSandbox();
    sbMalCal.STORE = {
      rdvs: function() { return [null, undefined, 'bad', { id: 'rdv-ok', nature: 'Good', date: '2026-08-20' }]; },
      representations: function() { return []; }
    };
    loadProductionRuntime(sbMalCal);
    sbMalCal.Platform.boot(); sbMalCal.Platform.ready();
    var evMal = await sbMalCal._productionCalendarProvider({});
    ok(Array.isArray(evMal) && evMal.length === 1, 'malformed entries skipped in calendar');

    // Empty storage → []
    var sbNoCal = makeSandbox();
    sbNoCal.STORE = {
      rdvs: function() { return []; },
      representations: function() { return []; }
    };
    loadProductionRuntime(sbNoCal);
    sbNoCal.Platform.boot(); sbNoCal.Platform.ready();
    var evEmpty = await sbNoCal._productionCalendarProvider({});
    ok(Array.isArray(evEmpty) && evEmpty.length === 0, 'empty storage → empty events array');

    // rdv event route is 'rendez-vous'
    var rdvEvents = events.filter(function(e) { return e.route === 'rendez-vous'; });
    ok(rdvEvents.length > 0, 'rdv events have route "rendez-vous"');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 7: Navigation
  // ══════════════════════════════════════════════════════════════════════
  section('7. Navigation');
  {
    var sb = makeSandbox();
    loadProductionRuntime(sb);

    ok(typeof sb.showView === 'function', 'showView() available as global');

    // All production routes callable via showView without crash
    var routes = ['dashboard', 'list', 'rendez-vous', 'om-list', 'clients',
                  'collaborateurs', 'comptabilite', 'compta-bank', 'sauvegarde', 'parametres'];
    var svThrew = false;
    try { routes.forEach(function(r) { sb.showView(r); }); } catch(e) { svThrew = true; }
    ok(!svThrew, 'all production routes callable via showView without crash');

    // Manifest routes match expected IDs
    var m = sb.Platform.getPlugin('production');
    ok(m.routes.some(function(r) { return r.id === 'rendez-vous'; }),
       'manifest route "rendez-vous" present');
    ok(m.routes.some(function(r) { return r.id === 'om-list'; }),
       'manifest route "om-list" present');
    ok(m.routes.some(function(r) { return r.id === 'comptabilite'; }),
       'manifest route "comptabilite" present');

    // Shell.navigation accessible
    ok(typeof sb.Shell !== 'undefined' && sb.Shell.navigation,
       'Shell.navigation accessible');
    ok(typeof sb.Shell.navigation.go === 'function',
       'Shell.navigation.go() is a function');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8: Backward compatibility
  // ══════════════════════════════════════════════════════════════════════
  section('8. Backward compatibility');
  {
    // Platform boots safely without production.runtime
    var sbNoProd = makeSandbox();
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
    var noProdThrew = false;
    try { sbNoProd.Platform.boot(); sbNoProd.Platform.ready(); } catch(e) { noProdThrew = true; }
    ok(!noProdThrew, 'Platform.boot()/ready() safe without production.runtime');

    // No crash when MythosSearch absent
    var sbNoSearch = makeSandbox();
    load(sbNoSearch, 'js/core/events.js');
    load(sbNoSearch, 'js/core/platform.js');
    load(sbNoSearch, 'js/core/shell.js');
    load(sbNoSearch, 'js/core/plugin-sdk.js');
    var noSearchThrew = false;
    try {
      load(sbNoSearch, 'js/plugins/production.runtime.js');
      sbNoSearch.Platform.boot(); sbNoSearch.Platform.ready();
    } catch(e) { noSearchThrew = true; }
    ok(!noSearchThrew, 'no crash when MythosSearch absent');

    // No crash when MythosCalendar absent
    var sbNoCal = makeSandbox();
    load(sbNoCal, 'js/core/events.js');
    load(sbNoCal, 'js/core/platform.js');
    load(sbNoCal, 'js/core/shell.js');
    load(sbNoCal, 'js/core/plugin-sdk.js');
    var noCalThrew = false;
    try {
      load(sbNoCal, 'js/plugins/production.runtime.js');
      sbNoCal.Platform.boot(); sbNoCal.Platform.ready();
    } catch(e) { noCalThrew = true; }
    ok(!noCalThrew, 'no crash when MythosCalendar absent');

    // No crash when Shell absent
    var sbNoShell = makeSandbox();
    load(sbNoShell, 'js/core/events.js');
    load(sbNoShell, 'js/core/platform.js');
    load(sbNoShell, 'js/core/plugin-sdk.js');
    var noShellThrew = false;
    try {
      load(sbNoShell, 'js/plugins/production.runtime.js');
      sbNoShell.Platform.boot(); sbNoShell.Platform.ready();
    } catch(e) { noShellThrew = true; }
    ok(!noShellThrew, 'no crash when Shell absent');

    // No crash when Platform absent
    var sbNoPlatform = makeSandbox();
    var noPlatformThrew = false;
    try {
      load(sbNoPlatform, 'js/core/events.js');
      load(sbNoPlatform, 'js/core/plugin-sdk.js');
      load(sbNoPlatform, 'js/plugins/production.runtime.js');
    } catch(e) { noPlatformThrew = true; }
    ok(!noPlatformThrew, 'no crash when Platform absent');

    // onBoot recovers malformed values
    var sbMalBoot = makeSandbox();
    loadProductionRuntime(sbMalBoot);
    sbMalBoot.localStorage.setItem('mp_invoices', 'CORRUPTED');
    var malBootThrew = false;
    try { sbMalBoot.Platform.boot(); } catch(e) { malBootThrew = true; }
    ok(!malBootThrew, 'onBoot recovers malformed storage without crash');
    ok(sbMalBoot.localStorage.getItem('mp_invoices') === '[]',
       'onBoot resets malformed mp_invoices to []');

    // search empty query → []
    var sbSE = makeSandbox();
    loadProductionRuntime(sbSE);
    sbSE.Platform.boot(); sbSE.Platform.ready();
    ok(Array.isArray(sbSE._productionSearchHandler('')) && sbSE._productionSearchHandler('').length === 0,
       'search empty query → []');

    // valid data not overwritten by boot
    var sbNoOvr = makeSandbox();
    loadProductionRuntime(sbNoOvr);
    var validInv = JSON.stringify(SAMPLE_INVOICES);
    sbNoOvr.localStorage.setItem('mp_invoices', validInv);
    sbNoOvr.Platform.boot();
    ok(sbNoOvr.localStorage.getItem('mp_invoices') === validInv,
       'valid data not overwritten by onBoot');

    // Other plugins unaffected when production is the only plugin
    var sbFull = makeSandbox();
    loadFullStack(sbFull);
    sbFull.Platform.boot(); sbFull.Platform.ready();
    ok(sbFull.Platform.hasPlugin('tasks'),    'tasks plugin unaffected by production.runtime');
    ok(sbFull.Platform.hasPlugin('planning'), 'planning plugin unaffected by production.runtime');
    ok(sbFull.Platform.hasPlugin('contacts'), 'contacts plugin unaffected by production.runtime');
    ok(sbFull.Platform.hasPlugin('notes'),    'notes plugin unaffected by production.runtime');

    // _productionInit safe when services absent
    var sbNoSvcs = makeSandbox({ MythosSearch: undefined, MythosCalendar: undefined, Shell: undefined });
    load(sbNoSvcs, 'js/core/events.js');
    load(sbNoSvcs, 'js/core/platform.js');
    load(sbNoSvcs, 'js/core/plugin-sdk.js');
    var noSvcsThrew = false;
    try {
      load(sbNoSvcs, 'js/plugins/production.runtime.js');
      sbNoSvcs._productionInit();
      sbNoSvcs._productionInit(); // second call
    } catch(e) { noSvcsThrew = true; }
    ok(!noSvcsThrew, '_productionInit() safe when all services absent');
  }

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 9: Regression (prior test suites)
  // ══════════════════════════════════════════════════════════════════════
  section('9. Regression');
  {
    var suites = [
      'tests/stage3f-test.js',
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
          { cwd: BASE, timeout: 120000, encoding: 'utf8' }
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
