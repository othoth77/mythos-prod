// =====================================================
// MYTHOS OS — Stage 4E Test
// tests/stage4e-test.js
//
// Verifies that dashboard rendering globals extracted
// into js/shared/dashboard.js behave identically to
// the original app.js implementation.
//
// Run with: node tests/stage4e-test.js
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

// ── DOM element factory ───────────────────────────────────────────────
function makeEl(id) {
  return {
    id: id,
    innerHTML: '',
    textContent: '',
    style: { width: '' },
    classList: {
      _classes: [],
      add:    function(c) { if (this._classes.indexOf(c) === -1) this._classes.push(c); },
      remove: function(c) { var i = this._classes.indexOf(c); if (i !== -1) this._classes.splice(i, 1); },
      contains: function(c) { return this._classes.indexOf(c) !== -1; }
    }
  };
}

// ── Sandbox factory ───────────────────────────────────────────────────
function makeSandbox(overrides) {
  var els = {};
  var noop = function() {};

  function getEl(id) { return els[id] || null; }
  function ensureEl(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }

  // Pre-create dashboard DOM elements
  [
    'dashboard-date-display',
    'dashboard-invoices', 'dashboard-amount',
    'dashboard-paid-count', 'dashboard-paid-amount',
    'dashboard-unpaid-count', 'dashboard-unpaid-amount',
    'dashboard-clients', 'dashboard-contracts-count',
    'dashboard-oms', 'dashboard-rdv-count',
    'dashboard-bank-balance',
    'dashboard-recovery-pct', 'dashboard-recovery-paid-label', 'dashboard-recovery-unpaid-label',
    'dashboard-recovery-bar',
    'dashboard-recent-invoices',
    'dashboard-upcoming-rdvs',
    'db-today-content', 'db-todo-content', 'db-money-content', 'db-production-content'
  ].forEach(ensureEl);

  var _ls = {};
  var today = new Date().toISOString().slice(0, 10);

  var sb = {
    document: {
      getElementById: function(id) { return getEl(id) || null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: noop },
      addEventListener: noop
    },
    window: { addEventListener: noop, innerWidth: 1280 },
    location: { hash: '' },
    _els: els,
    console: { log: noop, warn: noop, error: noop },

    // Stubs from utils.js
    todayStr:     function() { return today; },
    normalizeRdv: function(r) { return r; },
    escapeHtml:   function(s) { return String(s || ''); },
    formatDate:   function(s) { return String(s || ''); },
    fmtMoney:     function(v) { return String(v); },
    getInvoiceTotal: function(inv) { return Number(inv.ttc || inv.totalTTC || 0); },
    num:          function(v) { return Number(v || 0); },

    // localStorage stub
    localStorage: {
      getItem:    function(k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
      setItem:    function(k, v) { _ls[k] = String(v); },
      removeItem: function(k) { delete _ls[k]; }
    },

    // setTimeout stub (used in recovery bar animation)
    setTimeout: function(fn) { /* no-op in tests */ },

    // Default STORE stub — empty collections
    STORE: {
      invoices:     function() { return []; },
      clients:      function() { return []; },
      oms:          function() { return []; },
      contracts:    function() { return []; },
      bankEntries:  function() { return []; },
      rdvs:         function() { return []; },
      expenses:     function() { return []; },
      cashEntries:  function() { return []; },
      representations: function() { return []; },
      documents:    function() { return []; },
      collabs:      function() { return [];}
    },

    // JS globals
    Array: Array, Object: Object, String: String, Number: Number,
    Boolean: Boolean, Math: Math, JSON: JSON, Date: Date,
    Set: Set, Map: Map, Promise: Promise,
    Infinity: Infinity, undefined: undefined
  };

  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sb);
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: Global presence after loading shared/dashboard.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/dashboard.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/dashboard.js');

ok(typeof sb1.updateDashboardStats === 'function',      'updateDashboardStats is a function');
ok(typeof sb1.updateDashboardOperational === 'function','updateDashboardOperational is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: updateDashboardStats — no-data path
// ═════════════════════════════════════════════════════════════════════
section('2. updateDashboardStats — no-data path');

var sb2 = makeSandbox();
load(sb2, 'js/shared/dashboard.js');

var threw2 = false;
try { vm.runInContext('updateDashboardStats()', sb2); } catch(e) { threw2 = true; console.log('  ERROR: ' + e.message); }
ok(!threw2, 'updateDashboardStats() with empty STORE does not throw');

// KPI elements receive values
ok(String(sb2._els['dashboard-invoices'].textContent) === '0',
  'dashboard-invoices shows 0 with no invoices');
ok(String(sb2._els['dashboard-clients'].textContent) === '0',
  'dashboard-clients shows 0 with no clients');
ok(String(sb2._els['dashboard-oms'].textContent) === '0',
  'dashboard-oms shows 0 with no OMs');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: updateDashboardStats — with invoice data
// ═════════════════════════════════════════════════════════════════════
section('3. updateDashboardStats — with invoice data');

var sb3 = makeSandbox({
  STORE: {
    invoices:     function() { return [
      { id: 'i1', num: 'F001', date: '2026-01-10', clientName: 'Client A', ttc: 500, status: 'paid' },
      { id: 'i2', num: 'F002', date: '2026-01-15', clientName: 'Client B', ttc: 300, status: 'unpaid' }
    ]; },
    clients:      function() { return [{ id: 'c1' }, { id: 'c2' }]; },
    oms:          function() { return []; },
    contracts:    function() { return []; },
    bankEntries:  function() { return [{ date: '2026-01-20', balance: 12345 }]; },
    rdvs:         function() { return []; },
    expenses:     function() { return []; },
    cashEntries:  function() { return []; },
    representations: function() { return []; },
    documents:    function() { return []; },
    collabs:      function() { return []; }
  }
});
load(sb3, 'js/shared/dashboard.js');

var threw3 = false;
try { vm.runInContext('updateDashboardStats()', sb3); } catch(e) { threw3 = true; console.log('  ERROR 3: ' + e.message); }
ok(!threw3, 'updateDashboardStats() with invoices does not throw');

ok(String(sb3._els['dashboard-invoices'].textContent) === '2',
  'dashboard-invoices shows 2');
ok(String(sb3._els['dashboard-paid-count'].textContent) === '1',
  'dashboard-paid-count shows 1');
ok(String(sb3._els['dashboard-unpaid-count'].textContent) === '1',
  'dashboard-unpaid-count shows 1');
ok(String(sb3._els['dashboard-clients'].textContent) === '2',
  'dashboard-clients shows 2');
ok(sb3._els['dashboard-bank-balance'].textContent !== '',
  'dashboard-bank-balance set with bank data');

// Recent invoices section
ok(sb3._els['dashboard-recent-invoices'].innerHTML.indexOf('Client A') !== -1 ||
   sb3._els['dashboard-recent-invoices'].innerHTML.indexOf('Client B') !== -1,
  'dashboard-recent-invoices renders client names');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: updateDashboardStats — bank balance absent
// ═════════════════════════════════════════════════════════════════════
section('4. updateDashboardStats — no bank entries');

var sb4 = makeSandbox();
load(sb4, 'js/shared/dashboard.js');
vm.runInContext('updateDashboardStats()', sb4);

ok(sb4._els['dashboard-bank-balance'].textContent === '—',
  'dashboard-bank-balance shows "—" with no bank entries');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: updateDashboardStats — recovery bar
// ═════════════════════════════════════════════════════════════════════
section('5. updateDashboardStats — recovery bar');

var sb5 = makeSandbox({
  STORE: {
    invoices:     function() { return [
      { id: 'i1', ttc: 200, status: 'paid' },
      { id: 'i2', ttc: 200, status: 'paid' },
      { id: 'i3', ttc: 200, status: 'unpaid' }
    ]; },
    clients:      function() { return []; },
    oms:          function() { return []; },
    contracts:    function() { return []; },
    bankEntries:  function() { return []; },
    rdvs:         function() { return []; },
    expenses:     function() { return []; },
    cashEntries:  function() { return []; },
    representations: function() { return []; },
    documents:    function() { return []; },
    collabs:      function() { return []; }
  }
});
load(sb5, 'js/shared/dashboard.js');
vm.runInContext('updateDashboardStats()', sb5);
ok(sb5._els['dashboard-recovery-pct'].textContent === '67%',
  'recovery bar shows 67% (2/3 paid)');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: updateDashboardStats — upcoming RDVs
// ═════════════════════════════════════════════════════════════════════
section('6. updateDashboardStats — upcoming RDVs');

var sb6 = makeSandbox({
  STORE: {
    invoices: function() { return []; },
    clients:  function() { return []; },
    oms:      function() { return []; },
    contracts: function() { return []; },
    bankEntries: function() { return []; },
    rdvs: function() { return [
      { id: 'r1', date: '2099-12-31', nature: 'Concert', lieu: 'Tunis', client: 'TestClient', heure: '20:00' }
    ]; },
    expenses:     function() { return []; },
    cashEntries:  function() { return []; },
    representations: function() { return []; },
    documents:    function() { return []; },
    collabs:      function() { return []; }
  }
});
load(sb6, 'js/shared/dashboard.js');
vm.runInContext('updateDashboardStats()', sb6);
var rdvHtml = sb6._els['dashboard-upcoming-rdvs'].innerHTML;
ok(rdvHtml.indexOf('Tunis') !== -1, 'upcoming RDVs renders lieu');
ok(rdvHtml.indexOf('Concert') !== -1, 'upcoming RDVs renders nature');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: updateDashboardOperational — no-data path
// ═════════════════════════════════════════════════════════════════════
section('7. updateDashboardOperational — no-data path');

var sb7 = makeSandbox();
load(sb7, 'js/shared/dashboard.js');

var threw7 = false;
try { vm.runInContext('updateDashboardOperational()', sb7); } catch(e) { threw7 = true; console.log('  ERROR 7: ' + e.message); }
ok(!threw7, 'updateDashboardOperational() with empty STORE does not throw');

// db-today-content rendered
ok(typeof sb7._els['db-today-content'].innerHTML === 'string',
  'db-today-content innerHTML set');
// db-todo-content rendered
ok(typeof sb7._els['db-todo-content'].innerHTML === 'string',
  'db-todo-content innerHTML set');
// db-money-content rendered
ok(typeof sb7._els['db-money-content'].innerHTML === 'string',
  'db-money-content innerHTML set');
// db-production-content rendered
ok(typeof sb7._els['db-production-content'].innerHTML === 'string',
  'db-production-content innerHTML set');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: updateDashboardOperational — unpaid invoice alert
// ═════════════════════════════════════════════════════════════════════
section('8. updateDashboardOperational — unpaid invoice alert');

var sb8 = makeSandbox({
  STORE: {
    invoices: function() { return [{ id: 'i1', ttc: 100, status: 'unpaid', date: '2026-01-01' }]; },
    rdvs:     function() { return []; },
    oms:      function() { return []; },
    contracts: function() { return []; },
    expenses: function() { return []; },
    cashEntries: function() { return []; },
    bankEntries: function() { return []; },
    representations: function() { return []; },
    documents: function() { return []; },
    collabs:   function() { return []; }
  }
});
load(sb8, 'js/shared/dashboard.js');
vm.runInContext('updateDashboardOperational()', sb8);
var todoHtml = sb8._els['db-todo-content'].innerHTML;
ok(todoHtml.indexOf('facture') !== -1, 'todo section shows unpaid invoice alert');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: updateDashboardOperational — calls updateDashboardStats chain
// ═════════════════════════════════════════════════════════════════════
section('9. updateDashboardStats calls updateDashboardOperational');

var sb9 = makeSandbox();
load(sb9, 'js/shared/dashboard.js');
var opCalled = false;
vm.runInContext('var _orig = updateDashboardOperational; updateDashboardOperational = function(){ opCalled = true; _orig(); };', sb9);
sb9.opCalled = false;
vm.runInContext('updateDashboardStats()', sb9);
ok(vm.runInContext('opCalled', sb9), 'updateDashboardStats calls updateDashboardOperational');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: Regression — storage+sync+router+calendar+dashboard chain
// ═════════════════════════════════════════════════════════════════════
section('10. Regression — all shared modules coexist');

(function() {
  var sb10 = makeSandbox({
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
    setTimeout: function() { return 1; }, clearTimeout: function() {},
    encodeURIComponent: encodeURIComponent,
    Uint8Array: Uint8Array,
    Option: function(text, value) { this.text = text; this.value = value; }
  });

  load(sb10, 'js/core/storage.js');
  load(sb10, 'js/core/sync.js');
  load(sb10, 'js/core/router.js');
  load(sb10, 'js/shared/calendar.js');
  load(sb10, 'js/shared/dashboard.js');

  ok(typeof sb10.showView === 'function',                'showView still a function after dashboard load');
  ok(typeof sb10.renderCalendrier === 'function',        'renderCalendrier still a function after dashboard load');
  ok(typeof sb10.updateDashboardStats === 'function',    'updateDashboardStats a function after full chain load');
  ok(typeof sb10.updateDashboardOperational === 'function', 'updateDashboardOperational a function after full chain load');
  ok(typeof sb10._storeSave === 'function',              '_storeSave still present');
  ok(sb10.currentPage === 'dashboard',                   'currentPage is "dashboard" after chain load');
  ok(sb10.calFilterMode === 'upcoming',                  'calFilterMode is "upcoming" after chain load');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
