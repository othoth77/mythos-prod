// =====================================================
// MYTHOS OS — Stage 4D Test
// tests/stage4d-test.js
//
// Verifies that calendar rendering globals extracted
// into js/shared/calendar.js behave identically to
// the original app.js implementation.
//
// Run with: node tests/stage4d-test.js
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
  var classes = [];
  return {
    id: id, _classes: classes,
    classList: {
      add:    function(c) { if (classes.indexOf(c) === -1) classes.push(c); },
      remove: function(c) { var i = classes.indexOf(c); if (i !== -1) classes.splice(i, 1); },
      contains: function(c) { return classes.indexOf(c) !== -1; }
    },
    innerHTML: '',
    options: { length: 0 },
    appendChild: function() {},
    value: ''
  };
}

// ── Sandbox factory ───────────────────────────────────────────────────
function makeSandbox(overrides) {
  var els = {};
  var noop = function() {};

  function getEl(id) { return els[id] || null; }
  function ensureEl(id) { if (!els[id]) els[id] = makeEl(id); return els[id]; }

  // Pre-create DOM elements the calendar functions query
  ['cal-rdv-list', 'cal-search', 'cal-type-filter', 'cal-collab-filter', 'cal-status-filter'].forEach(ensureEl);

  var loc = { hash: '' };
  var today = new Date().toISOString().slice(0, 10);

  var sb = {
    document: {
      getElementById: function(id) { return getEl(id); },
      querySelectorAll: function(sel) {
        if (sel === '.btn-group button') return [];
        if (sel === '.view') return [];
        if (sel === '.nav-btn') return [];
        return [];
      },
      body: { appendChild: noop },
      addEventListener: noop
    },
    window: { addEventListener: noop, innerWidth: 1280, open: function() { return { document: { write: noop, close: noop }, location: {} }; } },
    location: loc,
    _els: els,
    _loc: loc,
    console: { log: noop, warn: noop, error: noop },

    // Stubs from utils.js
    todayStr:            function() { return today; },
    normalizeRdv:        function(r) { return r; },
    isDateInCurrentWeek: function()  { return false; },
    isRdvPaid:           function()  { return false; },
    getRdvAmount:        function()  { return 0; },
    escapeHtml:          function(s) { return String(s || ''); },
    formatDate:          function(s) { return String(s || ''); },
    fmtMoney:            function(v) { return String(v) + ' TND'; },
    calendarDateCard:    function(d) { return { day: (d||'').slice(8,10)||'01', month: (d||'').slice(5,7)||'01', jour: 'Lun' }; },

    // Stubs from rappels.js
    getRappels:          function() { return []; },
    getNextRappelDate:   function(dateDebut) { return dateDebut; },
    getRappelsForRdv:    function() { return []; },
    periodeLabel:        function(p) { return String(p || ''); },
    openRappelsListModal: noop,

    // Stubs from app.js
    rdvOpenForm: noop,
    rdvEdit:     noop,
    rdvDelete:   noop,

    // STORE stub
    STORE: { rdvs: function() { return []; } },

    // DOM constructors
    Option: function(text, value) { this.text = text; this.value = value; },

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
// SECTION 1: Global presence after loading shared/calendar.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/calendar.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/calendar.js');

ok(typeof sb1.calFilterMode !== 'undefined',   'calFilterMode is defined');
ok(typeof sb1.openRdvModal === 'function',      'openRdvModal is a function');
ok(typeof sb1.setCalFilter === 'function',      'setCalFilter is a function');
ok(typeof sb1._calDateLabel === 'function',     '_calDateLabel is a function');
ok(typeof sb1._calDateSeparator === 'function', '_calDateSeparator is a function');
ok(typeof sb1.renderCalendrier === 'function',  'renderCalendrier is a function');
ok(typeof sb1._calRenderItem === 'function',    '_calRenderItem is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: Initial state
// ═════════════════════════════════════════════════════════════════════
section('2. Initial state');

ok(sb1.calFilterMode === 'upcoming', 'calFilterMode initial value is "upcoming"');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: setCalFilter
// ═════════════════════════════════════════════════════════════════════
section('3. setCalFilter');

var sb3 = makeSandbox();
var renderCalledCount = 0;
sb3.renderCalendrier = function() { renderCalledCount++; };
load(sb3, 'js/shared/calendar.js');
// override the one just loaded
vm.runInContext('var _origRender = renderCalendrier; renderCalendrier = function(){ _origRender(); };', sb3);
sb3.renderCalendrier = function() { renderCalledCount++; };

vm.runInContext("setCalFilter('today', null)", sb3);
ok(sb3.calFilterMode === 'today', 'setCalFilter("today") sets calFilterMode to "today"');

vm.runInContext("setCalFilter('past', null)", sb3);
ok(sb3.calFilterMode === 'past', 'setCalFilter("past") sets calFilterMode to "past"');

vm.runInContext("setCalFilter('upcoming', null)", sb3);
ok(sb3.calFilterMode === 'upcoming', 'setCalFilter("upcoming") resets calFilterMode to "upcoming"');

// setCalFilter calls renderCalendrier
var sb3b = makeSandbox();
load(sb3b, 'js/shared/calendar.js');
var renderCalled3b = false;
vm.runInContext('renderCalendrier = function(){ renderCalled3b = true; }; renderCalled3b = false;', sb3b);
sb3b.renderCalled3b = false;
vm.runInContext("setCalFilter('month', null)", sb3b);
ok(vm.runInContext('renderCalled3b', sb3b) === true, 'setCalFilter calls renderCalendrier');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: _calDateLabel
// ═════════════════════════════════════════════════════════════════════
section('4. _calDateLabel');

var sb4 = makeSandbox();
load(sb4, 'js/shared/calendar.js');
var today4 = vm.runInContext('todayStr()', sb4);

ok(typeof vm.runInContext('_calDateLabel("' + today4 + '", "' + today4 + '")', sb4) === 'string',
  '_calDateLabel returns a string');
var todayLabel = vm.runInContext('_calDateLabel("' + today4 + '", "' + today4 + '")', sb4);
ok(todayLabel.indexOf("AUJOURD'HUI") !== -1 || todayLabel.indexOf('AUJOURD') !== -1,
  '_calDateLabel for today contains AUJOURD\'HUI');

var pastDate = '2020-01-15';
var pastLabel = vm.runInContext('_calDateLabel("' + pastDate + '", "' + today4 + '")', sb4);
ok(typeof pastLabel === 'string' && pastLabel.length > 0,
  '_calDateLabel for past date returns non-empty string');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: _calDateSeparator
// ═════════════════════════════════════════════════════════════════════
section('5. _calDateSeparator');

var sb5 = makeSandbox();
load(sb5, 'js/shared/calendar.js');
var today5 = vm.runInContext('todayStr()', sb5);
var sep = vm.runInContext('_calDateSeparator("' + today5 + '", "' + today5 + '")', sb5);
ok(typeof sep === 'string' && sep.indexOf('<div') !== -1, '_calDateSeparator returns HTML div');
ok(sep.indexOf('d4af37') !== -1, '_calDateSeparator uses gold color for today');

var futureSep = vm.runInContext('_calDateSeparator("2099-12-31", "' + today5 + '")', sb5);
ok(typeof futureSep === 'string' && futureSep.indexOf('<div') !== -1,
  '_calDateSeparator returns HTML for future date');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: renderCalendrier — no-data path
// ═════════════════════════════════════════════════════════════════════
section('6. renderCalendrier — no-data path');

var sb6 = makeSandbox();
load(sb6, 'js/shared/calendar.js');

// No rdvs → empty state message
var threw6 = false;
try { vm.runInContext('renderCalendrier()', sb6); } catch(e) { threw6 = true; console.log('  ERROR: ' + e.message); }
ok(!threw6, 'renderCalendrier() with empty STORE.rdvs does not throw');

var listEl = sb6._els['cal-rdv-list'];
ok(listEl && listEl.innerHTML.indexOf('Aucun') !== -1,
  'renderCalendrier() with no items shows empty-state message');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: renderCalendrier — with rdvs
// ═════════════════════════════════════════════════════════════════════
section('7. renderCalendrier — with rdvs');

var sb7 = makeSandbox({
  STORE: {
    rdvs: function() {
      return [
        { id: 'r1', date: '2099-12-31', nature: 'Concert', lieu: 'Tunis', client: 'Test', heure: '20:00', montant: 500, status: '' }
      ];
    }
  }
});
load(sb7, 'js/shared/calendar.js');
vm.runInContext("calFilterMode = 'upcoming'", sb7);

var threw7 = false;
try { vm.runInContext('renderCalendrier()', sb7); } catch(e) { threw7 = true; console.log('  ERROR 7: ' + e.message); }
ok(!threw7, 'renderCalendrier() with rdvs does not throw');
var listEl7 = sb7._els['cal-rdv-list'];
ok(listEl7 && listEl7.innerHTML.indexOf('Tunis') !== -1,
  'renderCalendrier() renders lieu of rdv card');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: _calRenderItem
// ═════════════════════════════════════════════════════════════════════
section('8. _calRenderItem');

var sb8 = makeSandbox();
load(sb8, 'js/shared/calendar.js');
var today8 = vm.runInContext('todayStr()', sb8);

// RDV card
vm.runInContext('var _testItem = { _type: "rdv", _isRappel: false, date: "2099-12-31", rdv: { id: "r1", date: "2099-12-31", nature: "Concert", lieu: "Salle A", client: "Client1", heure: "20:00" } };', sb8);
var html8rdv = vm.runInContext('_calRenderItem(_testItem, "' + today8 + '")', sb8);
ok(typeof html8rdv === 'string' && html8rdv.indexOf('<div') !== -1,
  '_calRenderItem returns HTML for rdv card');
ok(html8rdv.indexOf('Salle A') !== -1,
  '_calRenderItem rdv card includes lieu');
ok(html8rdv.indexOf('Concert') !== -1,
  '_calRenderItem rdv card includes nature');

// Rappel card
vm.runInContext('var _testRappel = { _type: "rappel", _isRappel: true, date: "2099-12-31", rappel: { id: "rp1", titre: "Mon Rappel", type: "Mensuel", periode: "monthly", details: "" } };', sb8);
var html8rap = vm.runInContext('_calRenderItem(_testRappel, "' + today8 + '")', sb8);
ok(typeof html8rap === 'string' && html8rap.indexOf('<div') !== -1,
  '_calRenderItem returns HTML for rappel card');
ok(html8rap.indexOf('Mon Rappel') !== -1,
  '_calRenderItem rappel card includes titre');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: openRdvModal
// ═════════════════════════════════════════════════════════════════════
section('9. openRdvModal');

var sb9 = makeSandbox();
var rdvOpenCalled = false;
sb9.rdvOpenForm = function() { rdvOpenCalled = true; };
load(sb9, 'js/shared/calendar.js');
sb9.rdvOpenForm = function() { rdvOpenCalled = true; };
vm.runInContext('openRdvModal()', sb9);
ok(rdvOpenCalled, 'openRdvModal() delegates to rdvOpenForm()');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: Regression — storage+sync+router+calendar chain
// ═════════════════════════════════════════════════════════════════════
section('10. Regression — routing globals + calendar globals coexist');

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
    Uint8Array: Uint8Array
  });

  load(sb10, 'js/core/storage.js');
  load(sb10, 'js/core/sync.js');
  load(sb10, 'js/core/router.js');
  load(sb10, 'js/shared/calendar.js');

  ok(typeof sb10.showView === 'function', 'showView still a function after calendar load');
  ok(typeof sb10.renderCalendrier === 'function', 'renderCalendrier a function after full chain load');
  ok(sb10.calFilterMode === 'upcoming', 'calFilterMode is "upcoming" after chain load');
  ok(typeof sb10._storeSave === 'function', '_storeSave still present');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
