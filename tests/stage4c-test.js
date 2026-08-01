// =====================================================
// MYTHOS OS — Stage 4C Test
// tests/stage4c-test.js
//
// Verifies that routing globals extracted into
// js/core/router.js behave identically to the
// original app.js implementation.
//
// Run with: node tests/stage4c-test.js
// =====================================================
'use strict';

var vm   = require('vm');
var fs   = require('fs');
var path = require('path');

var BASE  = path.join(__dirname, '..');
var _pass = 0, _fail = 0;

function ok(cond, label) {
  if (cond) { _pass++; console.log('  PASS ' + label); }
  else       { _fail++; console.log('  FAIL ' + label); }
}
function section(title) { console.log('\n' + title); }

// ── Render function stubs (all views' callbacks) ─────────────────────
function renderStubs() {
  var noop = function() {};
  return {
    updateDashboardStats: noop,
    loadDashboardInscriptionsCount: noop,
    loadInscriptions: noop,
    renderAppels: noop,
    renderListeConforme: noop,
    loadSettingsCallScript: noop,
    loadSettingsSheetUrl: noop,
    renderList: noop,
    initNewForm: noop,
    populateDevisList: noop,
    initDevisForm: noop,
    renderContracts: noop,
    initContractForm: noop,
    renderOMList: noop,
    initOMForm: noop,
    rdvRender: noop,
    renderRepresentations: noop,
    renderClients: noop,
    renderCollaborateurs: noop,
    renderNatures: noop,
    renderFournisseurs: noop,
    renderCalendrier: noop,
    renderComptaViews: noop,
    renderSuppliersPage: noop,
    renderPurchasesPage: noop,
    renderExpensesPage: noop,
    renderBankPage: noop,
    renderCashPage: noop,
    renderExpenseCategoryManager: noop,
    renderReconciliationPage: noop,
    renderStatistique: noop,
    initSpectacleCalculator: noop,
    renderBackupDashboard: noop,
    renderDocumentation: noop,
    renderRepertoireContactsPage: noop,
    renderRepertoireImportsHistory: noop,
    _rcRenderDuplicatesBanner: noop,
    renderContactFiche: noop,
    populateInvoiceList: noop,
    populateOmList: noop
  };
}

// ── DOM element factory ───────────────────────────────────────────────
function makeEl(id) {
  var classes = [];
  return {
    id: id,
    _classes: classes,
    classList: {
      add: function(c) { if (classes.indexOf(c) === -1) classes.push(c); },
      remove: function(c) {
        var i = classes.indexOf(c);
        if (i !== -1) classes.splice(i, 1);
      },
      contains: function(c) { return classes.indexOf(c) !== -1; }
    }
  };
}

// ── Sandbox factory ───────────────────────────────────────────────────
function makeSandbox(overrides) {
  var views = [
    'dashboard', 'list', 'new', 'devis', 'devis-form',
    'contracts', 'contract-form', 'om-list', 'om-new',
    'clients', 'collaborateurs', 'natures', 'fournisseurs',
    'calendrier', 'inscriptions', 'appel', 'conformite',
    'parametres', 'rendez-vous', 'representations',
    'statistique', 'calculateur-spectacle', 'sauvegarde',
    'documentation', 'gestion-contacts', 'contact-fiche',
    'redaction-das', 'redaction-autres', 'comptabilite',
    'compta-suppliers', 'compta-purchases', 'compta-expenses',
    'compta-bank', 'compta-cash', 'compta-categories',
    'compta-reconciliation', 'logs'
  ];
  var navItems = [
    'dashboard', 'list', 'devis', 'contracts', 'om-list',
    'clients', 'collaborateurs', 'natures', 'fournisseurs',
    'calendrier', 'inscriptions', 'appel', 'conformite',
    'parametres', 'rendez-vous', 'representations',
    'statistique', 'calculateur-spectacle', 'sauvegarde',
    'documentation', 'gestion-contacts', 'contact-fiche',
    'redaction-das', 'redaction-autres', 'comptabilite',
    'logs'
  ];

  var viewEls = {};
  views.forEach(function(v) { viewEls['view-' + v] = makeEl('view-' + v); });
  var navEls = {};
  navItems.forEach(function(n) { navEls['nav-' + n] = makeEl('nav-' + n); });
  // compta nav
  navEls['nav-comptabilite'] = makeEl('nav-comptabilite');

  var allNavBtns = Object.values(navEls);

  var loc = { hash: '' };

  var sb = {
    document: {
      getElementById: function(id) {
        if (viewEls[id]) return viewEls[id];
        if (navEls[id]) return navEls[id];
        return null;
      },
      querySelectorAll: function(sel) {
        if (sel === '.view') return Object.values(viewEls);
        if (sel === '.nav-btn') return allNavBtns;
        return [];
      },
      body: { appendChild: function() {} },
      addEventListener: function() {}
    },
    window: { addEventListener: function() {}, innerWidth: 1280 },
    location: loc,
    _viewEls: viewEls,
    _navEls: navEls,
    // Required by showPage
    _loc: loc,
    console: { log: function() {}, warn: function() {}, error: function() {} },
    Array: Array, Object: Object, String: String, Number: Number,
    Boolean: Boolean, Math: Math, JSON: JSON, Date: Date,
    Set: Set, Map: Map, Promise: Promise
  };

  // Inject render stubs
  Object.assign(sb, renderStubs());
  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sb);
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: Global presence after loading router.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/core/router.js');

var sb1 = makeSandbox();
load(sb1, 'js/core/router.js');

ok(typeof sb1.currentPage !== 'undefined',   'currentPage is defined');
ok(typeof sb1.navigateTo === 'function',      'navigateTo is a function');
ok(typeof sb1.showPage === 'function',        'showPage is a function');
ok(typeof sb1.showView === 'function',        'showView is a function');
ok(typeof sb1.updateSidebarStats === 'function', 'updateSidebarStats is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: Initial state
// ═════════════════════════════════════════════════════════════════════
section('2. Initial state');

ok(sb1.currentPage === 'dashboard',           'currentPage initial value is "dashboard"');
(function() {
  var threw = false;
  try { sb1.updateSidebarStats(); } catch(e) { threw = true; }
  ok(!threw, 'updateSidebarStats() is a safe no-op');
})();

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: navigateTo
// ═════════════════════════════════════════════════════════════════════
section('3. navigateTo');

var sb3 = makeSandbox();
load(sb3, 'js/core/router.js');

vm.runInContext('navigateTo("invoices")', sb3);
ok(sb3.currentPage === 'invoices', 'navigateTo("invoices") sets currentPage to "invoices"');

vm.runInContext('navigateTo("dashboard")', sb3);
ok(sb3.currentPage === 'dashboard', 'navigateTo("dashboard") sets currentPage to "dashboard"');

ok(sb3._viewEls['view-dashboard'].classList.contains('active'),
  'navigateTo("dashboard") activates view-dashboard');

// navigateTo('oms') → showPage('oms') → view-om-list active
vm.runInContext('navigateTo("oms")', sb3);
ok(sb3._viewEls['view-om-list'].classList.contains('active'),
  'navigateTo("oms") activates view-om-list');
ok(!sb3._viewEls['view-dashboard'].classList.contains('active'),
  'navigateTo("oms") deactivates view-dashboard');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: showView
// ═════════════════════════════════════════════════════════════════════
section('4. showView');

var sb4 = makeSandbox();
load(sb4, 'js/core/router.js');

// 4a: activates view and sets hash
vm.runInContext('showView("list")', sb4);
ok(sb4._viewEls['view-list'].classList.contains('active'),
  'showView("list") activates view-list');
ok(sb4.location.hash === 'list',
  'showView("list") sets location.hash to "list"');

// 4b: removes active from other views first
vm.runInContext('showView("clients")', sb4);
ok(!sb4._viewEls['view-list'].classList.contains('active'),
  'showView("clients") removes active from previously active view');
ok(sb4._viewEls['view-clients'].classList.contains('active'),
  'showView("clients") activates view-clients');

// 4c: unknown view falls back to dashboard
vm.runInContext('showView("nonexistent-view")', sb4);
ok(sb4.location.hash === 'dashboard',
  'showView("nonexistent-view") falls back to dashboard hash');
ok(sb4._viewEls['view-dashboard'].classList.contains('active'),
  'showView("nonexistent-view") activates view-dashboard');

// 4d: activates correct nav-btn
var sb4d = makeSandbox();
load(sb4d, 'js/core/router.js');
vm.runInContext('showView("calendrier")', sb4d);
ok(sb4d._navEls['nav-calendrier'].classList.contains('active'),
  'showView("calendrier") activates nav-calendrier');

// 4e: compta- views use nav-comptabilite
var sb4e = makeSandbox();
load(sb4e, 'js/core/router.js');
vm.runInContext('showView("compta-bank")', sb4e);
ok(sb4e._navEls['nav-comptabilite'].classList.contains('active'),
  'showView("compta-bank") activates nav-comptabilite (not nav-compta-bank)');
ok(sb4e.location.hash === 'compta-bank',
  'showView("compta-bank") sets hash to "compta-bank"');

// 4f: dashboard triggers render stubs without throwing
var sb4f = makeSandbox();
var dashboardCalled = false;
sb4f.updateDashboardStats = function() { dashboardCalled = true; };
load(sb4f, 'js/core/router.js');
var threw4f = false;
try { vm.runInContext('showView("dashboard")', sb4f); } catch(e) { threw4f = true; }
ok(!threw4f, 'showView("dashboard") does not throw');
ok(dashboardCalled, 'showView("dashboard") calls updateDashboardStats');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: showPage — view mapping
// ═════════════════════════════════════════════════════════════════════
section('5. showPage — view mapping');

var sb5 = makeSandbox();
load(sb5, 'js/core/router.js');

var cases = [
  ['dashboard', 'view-dashboard'],
  ['invoices',  'view-list'],
  ['oms',       'view-om-list'],
  ['clients',   'view-clients'],
  ['calendar',  'view-calendrier']
];
cases.forEach(function(c) {
  vm.runInContext('showPage(' + JSON.stringify(c[0]) + ')', sb5);
  ok(sb5._viewEls[c[1]].classList.contains('active'),
    'showPage("' + c[0] + '") activates ' + c[1]);
});

// default case falls back to view-dashboard
vm.runInContext('showPage("unknown-legacy-page")', sb5);
ok(sb5._viewEls['view-dashboard'].classList.contains('active'),
  'showPage("unknown-legacy-page") falls back to view-dashboard');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: app.js regression — router globals still work after STORE
// ═════════════════════════════════════════════════════════════════════
section('6. app.js regression — routing globals accessible after STORE load');

(function() {
  var sb6 = makeSandbox({
    fetch: function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ ok: true }); } }); },
    navigator: { onLine: true, sendBeacon: function() { return true; } },
    localStorage: (function() {
      var _ls = {};
      return {
        getItem: function(k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
        setItem: function(k, v) { _ls[k] = String(v); },
        removeItem: function(k) { delete _ls[k]; },
        length: 0, key: function() { return null; }
      };
    })(),
    Blob: function() { return {}; },
    AbortController: typeof AbortController !== 'undefined' ? AbortController
      : function() { this.signal = {}; this.abort = function() {}; },
    setInterval: function() { return 1; }, clearInterval: function() {},
    setTimeout: function(fn) { return 1; }, clearTimeout: function() {},
    encodeURIComponent: encodeURIComponent,
    Uint8Array: Uint8Array
  });
  // Load storage, sync, then router
  load(sb6, 'js/core/storage.js');
  load(sb6, 'js/core/sync.js');
  load(sb6, 'js/core/router.js');

  ok(typeof sb6.showView === 'function',
    'showView still a function after storage+sync+router load');
  ok(typeof sb6.navigateTo === 'function',
    'navigateTo still a function after storage+sync+router load');
  ok(sb6.currentPage === 'dashboard',
    'currentPage still "dashboard" after storage+sync+router load');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
