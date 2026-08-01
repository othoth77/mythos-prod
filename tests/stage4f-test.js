// =====================================================
// MYTHOS OS — Stage 4F Test
// tests/stage4f-test.js
//
// Verifies that Natures CRUD globals extracted into
// js/shared/natures.js behave identically to the
// original app.js implementation.
//
// Run with: node tests/stage4f-test.js
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
    value: '',
    style: { display: '' },
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

  // Pre-create DOM elements used by natures functions
  [
    'natures-list',
    'nature-edit-id', 'nature-nom', 'nature-desc', 'nature-icon',
    'nature-modal'
  ].forEach(ensureEl);

  var _confirmsAccepted = true;

  var sb = {
    document: {
      getElementById: function(id) { return getEl(id) || null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: noop },
      addEventListener: noop
    },
    window: { addEventListener: noop },
    location: { hash: '' },
    _els: els,
    console: { log: noop, warn: noop, error: noop },

    // confirm stub — returns true by default
    confirm: function() { return _confirmsAccepted; },
    _setConfirm: function(val) { _confirmsAccepted = val; },

    // Utility stubs (from utils.js)
    esc:        function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); },
    escapeHtml: function(s) { return String(s == null ? '' : s); },
    money:      function(v) { return parseFloat(v || 0).toFixed(3); },
    formatDate: function(s) { return String(s || ''); },

    // showView stub (from router.js)
    showView: noop,

    // Default STORE stub
    STORE: {
      natures:         function() { return []; },
      saveNatures:     function(data) { this._natures = data; },
      _natures:        [],
      representations: function() { return []; },
      invoices:        function() { return []; }
    },

    // JS globals
    Array: Array, Object: Object, String: String, Number: Number,
    Boolean: Boolean, Math: Math, JSON: JSON, Date: Date,
    Set: Set, Map: Map, Promise: Promise,
    Infinity: Infinity, undefined: undefined, parseFloat: parseFloat
  };

  Object.assign(sb, overrides || {});
  return vm.createContext(sb);
}

function load(sb, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sb);
}

// ═════════════════════════════════════════════════════════════════════
// SECTION 1: Global presence after loading shared/natures.js
// ═════════════════════════════════════════════════════════════════════
section('1. Globals exported by js/shared/natures.js');

var sb1 = makeSandbox();
load(sb1, 'js/shared/natures.js');

ok(typeof sb1.renderNatures === 'function',      'renderNatures is a function');
ok(typeof sb1.showNatureDetail === 'function',   'showNatureDetail is a function');
ok(typeof sb1.openNatureModal === 'function',    'openNatureModal is a function');
ok(typeof sb1.closeNatureModal === 'function',   'closeNatureModal is a function');
ok(typeof sb1.saveNature === 'function',         'saveNature is a function');
ok(typeof sb1.deleteNature === 'function',       'deleteNature is a function');

// ═════════════════════════════════════════════════════════════════════
// SECTION 2: renderNatures — empty STORE
// ═════════════════════════════════════════════════════════════════════
section('2. renderNatures — empty STORE');

var sb2 = makeSandbox();
load(sb2, 'js/shared/natures.js');

var threw2 = false;
try { vm.runInContext('renderNatures()', sb2); } catch(e) { threw2 = true; console.log('  ERROR: ' + e.message); }
ok(!threw2, 'renderNatures() with empty natures does not throw');
ok(sb2._els['natures-list'].innerHTML.indexOf('Aucune') !== -1,
  'renderNatures() shows empty-state message when no natures');

// ═════════════════════════════════════════════════════════════════════
// SECTION 3: renderNatures — with natures data
// ═════════════════════════════════════════════════════════════════════
section('3. renderNatures — with natures data');

var sb3 = makeSandbox({
  STORE: {
    natures:         function() { return [{ id: 'n1', nom: 'Concert', desc: 'Un concert', icon: '🎵' }]; },
    saveNatures:     function(data) { this._natures = data; },
    _natures:        [],
    representations: function() { return []; },
    invoices:        function() { return []; }
  }
});
load(sb3, 'js/shared/natures.js');

var threw3 = false;
try { vm.runInContext('renderNatures()', sb3); } catch(e) { threw3 = true; console.log('  ERROR 3: ' + e.message); }
ok(!threw3, 'renderNatures() with natures does not throw');
ok(sb3._els['natures-list'].innerHTML.indexOf('Concert') !== -1,
  'renderNatures() renders nature name');
ok(sb3._els['natures-list'].innerHTML.indexOf('table') !== -1,
  'renderNatures() renders a table');

// ═════════════════════════════════════════════════════════════════════
// SECTION 4: openNatureModal — new
// ═════════════════════════════════════════════════════════════════════
section('4. openNatureModal — new nature (empty id)');

var sb4 = makeSandbox();
load(sb4, 'js/shared/natures.js');
vm.runInContext("openNatureModal('')", sb4);
ok(sb4._els['nature-modal'].style.display === 'flex',
  'openNatureModal() sets modal display to flex');
ok(sb4._els['nature-edit-id'].value === '',
  'openNatureModal() clears id field');

// ═════════════════════════════════════════════════════════════════════
// SECTION 5: openNatureModal — existing nature
// ═════════════════════════════════════════════════════════════════════
section('5. openNatureModal — edit existing nature');

var sb5 = makeSandbox({
  STORE: {
    natures: function() { return [{ id: 'n1', nom: 'Opéra', desc: 'Opéra lyrique', icon: '🎭' }]; },
    saveNatures: function(data) { this._natures = data; },
    _natures: [],
    representations: function() { return []; },
    invoices: function() { return []; }
  }
});
load(sb5, 'js/shared/natures.js');
vm.runInContext("openNatureModal('n1')", sb5);
ok(sb5._els['nature-edit-id'].value === 'n1',  'openNatureModal populates id field');
ok(sb5._els['nature-nom'].value === 'Opéra',   'openNatureModal populates nom field');
ok(sb5._els['nature-icon'].value === '🎭',     'openNatureModal populates icon field');

// ═════════════════════════════════════════════════════════════════════
// SECTION 6: closeNatureModal
// ═════════════════════════════════════════════════════════════════════
section('6. closeNatureModal');

var sb6 = makeSandbox();
load(sb6, 'js/shared/natures.js');
vm.runInContext("openNatureModal('')", sb6);
ok(sb6._els['nature-modal'].style.display === 'flex', 'modal is open after openNatureModal');
vm.runInContext('closeNatureModal()', sb6);
ok(sb6._els['nature-modal'].style.display === 'none', 'closeNatureModal() sets display to none');

// ═════════════════════════════════════════════════════════════════════
// SECTION 7: saveNature — create new
// ═════════════════════════════════════════════════════════════════════
section('7. saveNature — create new');

var saved7 = [];
var sb7 = makeSandbox({
  STORE: {
    natures: function() { return saved7.slice(); },
    saveNatures: function(data) { saved7 = data; },
    representations: function() { return []; },
    invoices: function() { return []; }
  }
});
load(sb7, 'js/shared/natures.js');

// Set form fields
sb7._els['nature-edit-id'].value = '';
sb7._els['nature-nom'].value = 'Jazz';
sb7._els['nature-desc'].value = 'Concert de jazz';
sb7._els['nature-icon'].value = '🎷';

var threw7 = false;
try { vm.runInContext('saveNature()', sb7); } catch(e) { threw7 = true; console.log('  ERROR 7: ' + e.message); }
ok(!threw7, 'saveNature() does not throw');
ok(saved7.length === 1, 'saveNature() adds one nature to store');
ok(saved7[0].nom === 'Jazz', 'saveNature() saves nom correctly');
ok(saved7[0].icon === '🎷', 'saveNature() saves icon correctly');
ok(typeof saved7[0].id === 'string' && saved7[0].id.length > 0,
  'saveNature() generates an id');

// ═════════════════════════════════════════════════════════════════════
// SECTION 8: saveNature — update existing
// ═════════════════════════════════════════════════════════════════════
section('8. saveNature — update existing');

var saved8 = [{ id: 'n1', nom: 'Rock', desc: '', icon: '🎸' }];
var sb8 = makeSandbox({
  STORE: {
    natures: function() { return saved8.slice(); },
    saveNatures: function(data) { saved8 = data; },
    representations: function() { return []; },
    invoices: function() { return []; }
  }
});
load(sb8, 'js/shared/natures.js');

sb8._els['nature-edit-id'].value = 'n1';
sb8._els['nature-nom'].value = 'Rock Classique';
sb8._els['nature-desc'].value = 'Rock des années 70';
sb8._els['nature-icon'].value = '🎸';

vm.runInContext('saveNature()', sb8);
ok(saved8.length === 1, 'saveNature() update does not add a duplicate');
ok(saved8[0].nom === 'Rock Classique', 'saveNature() updates nom');

// ═════════════════════════════════════════════════════════════════════
// SECTION 9: deleteNature — confirmed
// ═════════════════════════════════════════════════════════════════════
section('9. deleteNature — confirmed');

var saved9 = [
  { id: 'n1', nom: 'Pop', desc: '', icon: '🎤' },
  { id: 'n2', nom: 'Jazz', desc: '', icon: '🎷' }
];
var sb9 = makeSandbox({
  STORE: {
    natures: function() { return saved9.slice(); },
    saveNatures: function(data) { saved9 = data; },
    representations: function() { return []; },
    invoices: function() { return []; }
  }
});
load(sb9, 'js/shared/natures.js');

var threw9 = false;
try { vm.runInContext("deleteNature('n1')", sb9); } catch(e) { threw9 = true; console.log('  ERROR 9: ' + e.message); }
ok(!threw9, 'deleteNature() confirmed does not throw');
ok(saved9.length === 1, 'deleteNature() removes one nature');
ok(saved9[0].id === 'n2', 'deleteNature() removes the correct nature');

// ═════════════════════════════════════════════════════════════════════
// SECTION 10: deleteNature — cancelled
// ═════════════════════════════════════════════════════════════════════
section('10. deleteNature — cancelled');

var saved10 = [{ id: 'n1', nom: 'Pop', desc: '', icon: '🎤' }];
var sb10 = makeSandbox({
  confirm: function() { return false; },
  STORE: {
    natures: function() { return saved10.slice(); },
    saveNatures: function(data) { saved10 = data; },
    representations: function() { return []; },
    invoices: function() { return []; }
  }
});
load(sb10, 'js/shared/natures.js');
vm.runInContext("deleteNature('n1')", sb10);
ok(saved10.length === 1, 'deleteNature() cancelled leaves store unchanged');

// ═════════════════════════════════════════════════════════════════════
// SECTION 11: showNatureDetail — no-data path
// ═════════════════════════════════════════════════════════════════════
section('11. showNatureDetail — unknown id');

var sb11 = makeSandbox();
load(sb11, 'js/shared/natures.js');
var threw11 = false;
try { vm.runInContext("showNatureDetail('unknown')", sb11); } catch(e) { threw11 = true; console.log('  ERROR 11: ' + e.message); }
ok(!threw11, 'showNatureDetail() with unknown id does not throw (early return)');

// ═════════════════════════════════════════════════════════════════════
// SECTION 12: Regression — storage+sync+router+calendar+dashboard+natures chain
// ═════════════════════════════════════════════════════════════════════
section('12. Regression — all shared modules coexist');

(function() {
  var sb12 = makeSandbox({
    fetch: function() { return Promise.resolve({ ok: true, json: function() { return Promise.resolve({}); } }); },
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
    Option: function(text, value) { this.text = text; this.value = value; },
    normalizeRdv: function(r) { return r; },
    todayStr: function() { return new Date().toISOString().slice(0,10); },
    fmtMoney: function(v) { return String(v); },
    getInvoiceTotal: function() { return 0; },
    num: function(v) { return Number(v || 0); }
  });

  load(sb12, 'js/core/storage.js');
  load(sb12, 'js/core/sync.js');
  load(sb12, 'js/core/router.js');
  load(sb12, 'js/shared/calendar.js');
  load(sb12, 'js/shared/dashboard.js');
  load(sb12, 'js/shared/natures.js');

  ok(typeof sb12.showView === 'function',        'showView still a function after natures load');
  ok(typeof sb12.renderCalendrier === 'function','renderCalendrier still present');
  ok(typeof sb12.updateDashboardStats === 'function', 'updateDashboardStats still present');
  ok(typeof sb12.renderNatures === 'function',   'renderNatures a function after full chain load');
  ok(typeof sb12.saveNature === 'function',      'saveNature a function after full chain load');
  ok(typeof sb12._storeSave === 'function',      '_storeSave still present');
  ok(sb12.currentPage === 'dashboard',           'currentPage is "dashboard" after chain load');
})();

// ═════════════════════════════════════════════════════════════════════
// Results
// ═════════════════════════════════════════════════════════════════════
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
if (_fail > 0) process.exit(1);
