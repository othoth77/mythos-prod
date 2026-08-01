// =====================================================
// MYTHOS OS — Phase 1A Regression Test
// tests/stage1a-sync-bypass-regression-test.js
//
// Verifies that STORE.save* functions route through
// _storeSave (sync engine) and NOT localStorage.setItem
// directly. This regresses the Object.assign overwrite
// at app.js:2272-2287 that was removed in Phase 1A.
//
// Run with: node tests/stage1a-sync-bypass-regression-test.js
// =====================================================
'use strict';

var fs   = require('fs');
var path = require('path');
var vm   = require('vm');

var BASE  = path.resolve(__dirname, '..');
var _pass = 0, _fail = 0, _results = [];

function ok(cond, label) {
  if (cond) { _pass++; _results.push('  PASS ' + label); }
  else       { _fail++; _results.push('  FAIL ' + label); }
}
function section(title) { _results.push('\n' + title); }

// ── Make fresh sandbox ────────────────────────────────────────────────
function makeSandbox(overrides) {
  var _ls   = {};
  var _lsSpy = { sets: [], gets: [], removes: [] };
  var _pendingAdded = [];

  var base = {
    document: {
      readyState: 'complete',
      title: '',
      visibilityState: 'visible',
      createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function() {} }; },
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      body: { appendChild: function () {} },
      addEventListener: function () {}
    },
    window: { addEventListener: function () {} },
    location: { hash: '' },
    navigator: { onLine: true, sendBeacon: function () { return true; } },
    localStorage: {
      getItem: function (k) { _lsSpy.gets.push(k); return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
      setItem: function (k, v) { _lsSpy.sets.push(k); _ls[k] = String(v); },
      removeItem: function (k) { _lsSpy.removes.push(k); delete _ls[k]; }
    },
    fetch: function () {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ ok: true }); } });
    },
    // Sync engine spies (may be overwritten by storage.js after Stage 4A)
    _pendingAdd: function (key) { _pendingAdded.push(key); },
    _metaUpdate: function (key, ts) {},
    _triggerAutoBackup: function (label) {},

    _lsSpy:        _lsSpy,
    _pendingAdded: _pendingAdded,

    // Node stubs
    console:   { log: function () {}, warn: function () {}, error: function () {} },
    Promise:   Promise,
    JSON:      JSON,
    Date:      Date,
    Array:     Array,
    Object:    Object,
    String:    String,
    Set:       Set,
    Map:       Map,
    Math:      Math,
    Number:    Number,
    Boolean:   Boolean,
    setTimeout:    setTimeout,
    clearTimeout:  clearTimeout,
    setInterval:   function() { return 1; },
    clearInterval: function() {},
    Blob:          function() { return {}; },
    encodeURIComponent: encodeURIComponent,
    Uint8Array: Uint8Array
  };

  Object.assign(base, overrides || {});
  return vm.createContext(base);
}

function load(sandbox, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sandbox);
}

// ── Utility: read STORE block from app.js (dynamic — tolerates line shifts) ──
function loadAppJsSTORE(sandbox) {
  var appJs = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8').split('\n');

  // Find STORE definition dynamically (line number shifts after Stage 4A extraction)
  var storeStart = appJs.findIndex(function(l) { return /^const STORE\s*=/.test(l); });
  if (storeStart === -1) throw new Error('STORE definition not found in app.js');
  var storeEnd = storeStart + 1;
  while (storeEnd < appJs.length && !/^};/.test(appJs[storeEnd].trimEnd())) storeEnd++;
  storeEnd++; // include the closing };

  var storeDef = appJs.slice(storeStart, storeEnd).join('\n').replace(/^const STORE/, 'var STORE');
  vm.runInContext(storeDef, sandbox);

  // Find backupVersions property assignment dynamically
  var bkvIdx = appJs.findIndex(function(l) { return l.indexOf('STORE.backupVersions =') !== -1; });
  if (bkvIdx !== -1) {
    var fixLines = appJs[bkvIdx] + '\n' + appJs[bkvIdx + 1];
    vm.runInContext(fixLines, sandbox);
  }
}

// ── SECTION 1: _storeSave routing ─────────────────────────────────────
section('1. _storeSave routing — no direct localStorage.setItem');

var sb = makeSandbox();

// Load storage.js — after Stage 4A this includes the pending write pipeline
load(sb, 'js/core/storage.js');

// Re-install _pendingAdd spy after Stage 4A (storage.js overwrites the initial spy).
// Use assignment (not declaration) to avoid function-hoisting capturing the new fn.
vm.runInContext(
  '(function() {' +
  '  var _orig = _pendingAdd;' +
  '  _pendingAdded = [];' +
  '  _pendingAdd = function(key) { _orig(key); _pendingAdded.push(key); };' +
  '})()',
  sb
);

// Redefine _storeSave as a controlled stub so tests remain isolated from
// server-side effects (_pushCollection, beacon). Routes through the spy _pendingAdd.
vm.runInContext(
  'function _storeSave(key, data) {' +
  '  _safeSet(key, data);' +
  '  _metaUpdate(key, new Date().toISOString());' +
  '  _pendingAdd(key);' +
  '  _triggerAutoBackup(key.replace("mp_", ""));' +
  '}',
  sb
);

// Load STORE + backupVersions fix from actual app.js
loadAppJsSTORE(sb);

var STORE = sb.STORE;

// Reset spies before each test
function resetSpies() {
  sb._lsSpy.sets = [];
  sb._lsSpy.gets = [];
  sb._lsSpy.removes = [];
  sb._pendingAdded.length = 0;
}

// ── Verify all save* functions route through _storeSave ───────────────
var saveFunctions = [
  { name: 'saveInvoices',     key: 'mp_invoices',       testData: [{ id: 'inv1' }] },
  { name: 'saveDevis',        key: 'mp_devis',          testData: [{ id: 'dev1' }] },
  { name: 'saveContracts',    key: 'mp_contracts',      testData: [{ id: 'ctr1' }] },
  { name: 'saveClients',      key: 'mp_clients',        testData: [{ id: 'cli1' }] },
  { name: 'saveOms',          key: 'mp_oms',            testData: [{ id: 'om1' }]  },
  { name: 'saveCollabs',      key: 'mp_collabs',        testData: [{ id: 'col1' }] },
  { name: 'saveNatures',      key: 'mp_natures',        testData: [{ id: 'nat1' }] },
  { name: 'saveBankEntries',  key: 'mp_bank_entries',   testData: [{ id: 'bnk1' }] },
  { name: 'saveCashEntries',  key: 'mp_cash_entries',   testData: [{ id: 'csh1' }] },
  { name: 'saveSuppliers',    key: 'mp_suppliers',      testData: [{ id: 'sup1' }] },
  { name: 'savePurchases',    key: 'mp_purchases',      testData: [{ id: 'pur1' }] },
  { name: 'saveExpenses',     key: 'mp_expenses',       testData: [{ id: 'exp1' }] },
  { name: 'saveExpenseCategories', key: 'mp_expense_categories', testData: [{ id: 'ec1' }] },
  { name: 'saveRendezVous',   key: 'mp_rendez_vous',    testData: [{ id: 'rdv1' }] },
  { name: 'saveRdvs',         key: 'mp_rdvs',           testData: [{ id: 'rdvs1' }] },
  { name: 'saveRepresentations', key: 'mp_representations', testData: [{ id: 'rep1' }] },
  { name: 'saveDocuments',    key: 'mp_documents',      testData: [{ id: 'doc1' }] },
  { name: 'saveVehicules',    key: 'mp_vehicules',      testData: [{ id: 'veh1' }] },
  { name: 'saveRepertoireContacts',  key: 'mp_repertoire_contacts',  testData: [{ id: 'con1' }] },
  { name: 'saveRepertoireImports',   key: 'mp_repertoire_imports',   testData: [{ id: 'imp1' }] },
  { name: 'saveAppels',       key: 'mp_appels',        testData: [{ id: 'app1' }] },
  { name: 'saveValidatedInscriptions', key: 'mp_validated_inscriptions', testData: [{ id: 'val1' }] },
  { name: 'saveBackupVersions', key: 'mp_backup_versions', testData: [{ id: 'bkp1' }] }
];

saveFunctions.forEach(function (fn) {
  resetSpies();

  var beforePending = sb._pendingAdded.length;
  STORE[fn.name](fn.testData);

  ok(sb._pendingAdded.length === beforePending + 1,
    'STORE.' + fn.name + ' calls _pendingAdd (via _storeSave)');

  ok(sb._pendingAdded.indexOf(fn.key) !== -1,
    'STORE.' + fn.name + ' queues "' + fn.key + '" for sync');
});

// ── Verify _storeSave is not bypassed (no direct localStorage.setItem) ─
// We can't distinguish _safeSet's setItem from a direct setItem in this
// sandbox since _safeSet calls localStorage.setItem too. Instead verify
// that _pendingAdd was called — that proves _storeSave was invoked.

// ── SECTION 2: backupVersions is present ──────────────────────────────
section('2. backupVersions reader and writer');

resetSpies();
var bkp = STORE.backupVersions();
ok(Array.isArray(bkp), 'STORE.backupVersions returns an array (backupVersions reader works)');

resetSpies();
STORE.saveBackupVersions([{ id: 'b2' }]);
ok(sb._pendingAdded.indexOf('mp_backup_versions') !== -1,
  'STORE.saveBackupVersions queues mp_backup_versions for sync');

// ── SECTION 3: Regression — overwritten functions no longer exist ─────
section('3. Regression — no residual _storeSave bypass');

// Verify save functions are functions (not undefined)
saveFunctions.forEach(function (fn) {
  ok(typeof STORE[fn.name] === 'function', 'STORE.' + fn.name + ' is a function');
});

// The real regression: call _storeSave, verify it works
// (if the overwrite were still present, _pendingAdd would not be called)
resetSpies();
STORE.saveSuppliers([{ id: 's-update' }]);
ok(sb._pendingAdded.indexOf('mp_suppliers') !== -1,
  'REGRESSION CHECK: STORE.saveSuppliers syncs through _storeSave');

resetSpies();
STORE.savePurchases([{ id: 'p-update' }]);
ok(sb._pendingAdded.indexOf('mp_purchases') !== -1,
  'REGRESSION CHECK: STORE.savePurchases syncs through _storeSave');

resetSpies();
STORE.saveExpenses([{ id: 'e-update' }]);
ok(sb._pendingAdded.indexOf('mp_expenses') !== -1,
  'REGRESSION CHECK: STORE.saveExpenses syncs through _storeSave');

resetSpies();
STORE.saveBankEntries([{ id: 'b-update' }]);
ok(sb._pendingAdded.indexOf('mp_bank_entries') !== -1,
  'REGRESSION CHECK: STORE.saveBankEntries syncs through _storeSave');

resetSpies();
STORE.saveRepresentations([{ id: 'r-update' }]);
ok(sb._pendingAdded.indexOf('mp_representations') !== -1,
  'REGRESSION CHECK: STORE.saveRepresentations syncs through _storeSave');

resetSpies();
STORE.saveRdvs([{ id: 'rd-update' }]);
ok(sb._pendingAdded.indexOf('mp_rdvs') !== -1,
  'REGRESSION CHECK: STORE.saveRdvs syncs through _storeSave');

// ── Results ───────────────────────────────────────────────────────────
_results.forEach(function (r) { console.log(r); });
console.log('\n' + (_fail === 0 ? '\u2713' : '\u2717') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
process.exit(_fail > 0 ? 1 : 0);
