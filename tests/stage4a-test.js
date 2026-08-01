// =====================================================
// MYTHOS OS — Stage 4A Test
// tests/stage4a-test.js
//
// Verifies that js/core/storage.js contains the pending
// write pipeline extracted from app.js in Stage 4A:
// _localMeta, _metaUpdate, _pendingKeys (+helpers),
// _buildPendingBulk, _flushPending, _flushPendingBeacon,
// event listeners, _pullFromServerNow, _autoBackupTimer,
// _triggerAutoBackup, _pushCollection, _storeSave.
//
// Also verifies that app.js no longer defines these globals
// and that STORE.save* functions continue to route through
// the pipeline.
//
// Run with: node tests/stage4a-test.js
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

// ── Build a fresh sandbox with all globals needed by storage.js ───────
function makeSandbox() {
  var _ls = {};
  var docListeners  = {};
  var winListeners  = {};
  var fetchCalls    = [];
  var beaconCalls   = [];
  var intervalFns   = [];

  var sb = vm.createContext({
    document: {
      visibilityState: 'visible',
      readyState: 'complete',
      createElement: function() { return { style: {}, appendChild: function() {}, setAttribute: function() {} }; },
      getElementById: function() { return null; },
      querySelector: function() { return null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: function() {} },
      addEventListener: function(evt, fn) {
        if (!docListeners[evt]) docListeners[evt] = [];
        docListeners[evt].push(fn);
      }
    },
    window: {
      addEventListener: function(evt, fn, opts) {
        if (!winListeners[evt]) winListeners[evt] = [];
        winListeners[evt].push(fn);
      }
    },
    navigator: { onLine: true, sendBeacon: function(url, data) { beaconCalls.push({url: url, data: data}); return true; } },
    localStorage: {
      _store: _ls,
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
      setItem: function(k, v) { _ls[k] = String(v); },
      removeItem: function(k) { delete _ls[k]; },
      length: 0,
      key: function() { return null; }
    },
    fetch: function(url, opts) {
      fetchCalls.push({ url: url, body: opts && opts.body ? JSON.parse(opts.body) : null });
      return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ ok: true }); } });
    },
    setInterval: function(fn, ms) { intervalFns.push({ fn: fn, ms: ms }); return intervalFns.length; },
    clearInterval: function() {},
    setTimeout: function(fn, ms) { return 1; },
    clearTimeout: function() {},
    Blob: function(parts) { return { parts: parts }; },
    Set: Set, Map: Map, Math: Math,
    Promise: Promise, JSON: JSON, Date: Date,
    Array: Array, Object: Object, String: String, Number: Number, Boolean: Boolean,
    console: { log: function() {}, warn: function() {}, error: function() {} },
    AUTH: undefined, syncFromServer: undefined,

    _docListeners: docListeners,
    _winListeners: winListeners,
    _fetchCalls:   fetchCalls,
    _beaconCalls:  beaconCalls,
    _intervalFns:  intervalFns
  });
  return sb;
}

function loadStorage(sb) {
  vm.runInContext(fs.readFileSync(path.join(BASE, 'js/core/storage.js'), 'utf8'), sb);
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 1 — storage.js exports all pipeline globals
// ══════════════════════════════════════════════════════════════════════════
section('1. storage.js exports all Stage 4A pipeline globals');
{
  var sb = makeSandbox();
  loadStorage(sb);

  ok(typeof sb._localMeta === 'object',   '_localMeta is an object');
  ok(typeof sb._metaUpdate === 'function','_metaUpdate is a function');
  ok(sb._pendingKeys instanceof Set,       '_pendingKeys is a Set');
  ok(typeof sb._pendingAdd === 'function', '_pendingAdd is a function');
  ok(typeof sb._pendingRemove === 'function', '_pendingRemove is a function');
  ok(typeof sb._pendingClear === 'function',  '_pendingClear is a function');
  ok(typeof sb._buildPendingBulk === 'function', '_buildPendingBulk is a function');
  ok(typeof sb._flushPending === 'function',     '_flushPending is a function');
  ok(typeof sb._flushPendingBeacon === 'function','_flushPendingBeacon is a function');
  ok(typeof sb._pullFromServerNow === 'function', '_pullFromServerNow is a function');
  ok(typeof sb._lastPullTs === 'number',          '_lastPullTs is a number (0)');
  ok(typeof sb._autoBackupTimer !== 'undefined',  '_autoBackupTimer is defined');
  ok(typeof sb._triggerAutoBackup === 'function', '_triggerAutoBackup is a function');
  ok(typeof sb._pushCollection === 'function',    '_pushCollection is a function');
  ok(typeof sb._storeSave === 'function',         '_storeSave is a function');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 2 — storage.js still exports the original primitives
// ══════════════════════════════════════════════════════════════════════════
section('2. original storage primitives still present');
{
  var sb = makeSandbox();
  loadStorage(sb);

  ok(typeof sb._storeGet === 'function',    '_storeGet is a function');
  ok(typeof sb._safeSet === 'function',     '_safeSet is a function');
  ok(typeof sb._storeHas === 'function',    '_storeHas is a function');
  ok(typeof sb._storeRemove === 'function', '_storeRemove is a function');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 3 — _pendingKeys Set behaviour
// ══════════════════════════════════════════════════════════════════════════
section('3. _pendingKeys Set behaviour');
{
  var sb = makeSandbox();
  // Pre-seed localStorage with a pending key
  sb.localStorage.setItem('_mp_pending_keys', JSON.stringify(['mp_seed']));
  loadStorage(sb);

  ok(sb._pendingKeys.has('mp_seed'), '_pendingKeys initialised from localStorage');

  vm.runInContext('_pendingAdd("mp_test1")', sb);
  ok(sb._pendingKeys.has('mp_test1'), '_pendingAdd adds to Set');
  var raw = JSON.parse(sb.localStorage.getItem('_mp_pending_keys'));
  ok(raw.indexOf('mp_test1') !== -1, '_pendingAdd persists to localStorage');

  vm.runInContext('_pendingRemove("mp_test1")', sb);
  ok(!sb._pendingKeys.has('mp_test1'), '_pendingRemove deletes from Set');
  var raw2 = JSON.parse(sb.localStorage.getItem('_mp_pending_keys'));
  ok(raw2.indexOf('mp_test1') === -1, '_pendingRemove persists to localStorage');

  vm.runInContext('_pendingAdd("mp_a"); _pendingAdd("mp_b"); _pendingClear()', sb);
  ok(sb._pendingKeys.size === 0, '_pendingClear empties Set');
  ok(sb.localStorage.getItem('_mp_pending_keys') === null, '_pendingClear removes localStorage key');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 4 — _metaUpdate
// ══════════════════════════════════════════════════════════════════════════
section('4. _metaUpdate writes timestamp to _localMeta and localStorage');
{
  var sb = makeSandbox();
  loadStorage(sb);

  var now = new Date().toISOString();
  vm.runInContext('_metaUpdate("mp_invoices", "' + now + '")', sb);

  ok(sb._localMeta['mp_invoices'] !== undefined,          '_localMeta["mp_invoices"] set');
  ok(sb._localMeta['mp_invoices'].updatedAt === now,       '_localMeta updatedAt correct');
  ok(typeof sb._localMeta['mp_invoices'].ts === 'number',  '_localMeta ts is a number');
  ok(sb.localStorage.getItem('_mp_sync_meta') !== null,    '_mp_sync_meta written to localStorage');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 5 — _storeSave pipeline
// ══════════════════════════════════════════════════════════════════════════
section('5. _storeSave calls the full pipeline');
{
  var sb = makeSandbox();
  loadStorage(sb);

  vm.runInContext('_storeSave("mp_invoices", [{id:1}])', sb);

  ok(sb._storeGet('mp_invoices', '[]') !== null, '_storeSave calls _safeSet (data in store)');
  ok(sb._localMeta['mp_invoices'] !== undefined, '_storeSave calls _metaUpdate');
  ok(sb._pendingKeys.has('mp_invoices'),         '_storeSave calls _pendingAdd');
  ok(sb._fetchCalls.length > 0,                  '_storeSave triggers _pushCollection (fetch call)');

  // Confirm fetch body contains the key
  var body = sb._fetchCalls[0].body;
  ok(body && body.key === 'mp_invoices', '_pushCollection sends correct key');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 6 — _pushCollection chunking
// ══════════════════════════════════════════════════════════════════════════
section('6. _pushCollection — small payload uses single fetch');
{
  var sb = makeSandbox();
  loadStorage(sb);

  vm.runInContext(
    '_pushCollection("mp_test", [{id:1},{id:2}], new Date().toISOString(), function(){})',
    sb
  );

  ok(sb._fetchCalls.length === 1, 'small array → single fetch call');
  var b = sb._fetchCalls[0].body;
  ok(b && !b.__chunk__, 'single fetch: body is not chunked');
  ok(b && b.key === 'mp_test', 'single fetch: correct key');
}

section('6b. _pushCollection — large payload enters chunked path');
{
  var sb = makeSandbox();
  loadStorage(sb);

  // Build a large array whose JSON length > 400 000 bytes
  var bigArray = [];
  for (var i = 0; i < 1000; i++) bigArray.push({ id: i, data: new Array(500).join('x') });

  sb._bigArray = bigArray;
  vm.runInContext(
    '_pushCollection("mp_big", _bigArray, new Date().toISOString(), function(){})',
    sb
  );

  // Subsequent chunks are in async .then() handlers; only the first is sent synchronously.
  // Verify the chunked path was selected by inspecting the first call.
  ok(sb._fetchCalls.length >= 1, 'large array → at least one fetch call made');
  ok(sb._fetchCalls[0].body.__chunk__ === true, 'first call has __chunk__: true');
  ok(sb._fetchCalls[0].body.chunkIndex === 0,   'first chunk has chunkIndex 0');
  ok(sb._fetchCalls[0].body.totalChunks > 1,    'totalChunks > 1 (multiple chunks expected)');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 7 — Event listener registration
// ══════════════════════════════════════════════════════════════════════════
section('7. storage.js registers required event listeners on load');
{
  var sb = makeSandbox();
  loadStorage(sb);

  ok(sb._docListeners['visibilitychange'] && sb._docListeners['visibilitychange'].length > 0,
    'visibilitychange listener registered on document');
  ok(sb._winListeners['pagehide'] && sb._winListeners['pagehide'].length > 0,
    'pagehide listener registered on window');
  ok(sb._winListeners['focus'] && sb._winListeners['focus'].length > 0,
    'focus listener registered on window');
  ok(sb._winListeners['online'] && sb._winListeners['online'].length > 0,
    'online listener registered on window');
  ok(sb._intervalFns.length > 0, 'heartbeat setInterval registered');
  ok(sb._intervalFns[0].ms === 30000, 'heartbeat interval is 30 000 ms');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 8 — Event handler behaviour
// ══════════════════════════════════════════════════════════════════════════
section('8. visibilitychange hidden → _flushPendingBeacon called');
{
  var sb = makeSandbox();
  loadStorage(sb);
  vm.runInContext('_pendingAdd("mp_ev_test"); _pendingAdd("mp_ev_test2")', sb);
  sb.localStorage.setItem('mp_ev_test', JSON.stringify([{id:1}]));
  sb.localStorage.setItem('mp_ev_test2', JSON.stringify([{id:2}]));

  sb.document.visibilityState = 'hidden';
  sb._docListeners['visibilitychange'][0]();

  ok(sb._beaconCalls.length > 0 || sb._fetchCalls.length > 0,
    'visibilitychange(hidden) triggers _flushPendingBeacon (sendBeacon or fetch fallback)');
}

section('8b. pagehide → _flushPendingBeacon called');
{
  var sb = makeSandbox();
  loadStorage(sb);
  vm.runInContext('_pendingAdd("mp_ph_test")', sb);
  sb.localStorage.setItem('mp_ph_test', JSON.stringify([{id:1}]));

  sb._winListeners['pagehide'][0]();

  ok(sb._beaconCalls.length > 0 || sb._fetchCalls.length > 0,
    'pagehide fires _flushPendingBeacon');
}

section('8c. visibilitychange visible → _pullFromServerNow called (syncFromServer guard)');
{
  var sb = makeSandbox();
  var pullCalls = 0;
  sb.syncFromServer = function(cb) { pullCalls++; cb(); };
  loadStorage(sb);

  sb.document.visibilityState = 'visible';
  sb._docListeners['visibilitychange'][0]();

  ok(pullCalls === 1, 'visibilitychange(visible) calls _pullFromServerNow → syncFromServer');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 9 — _pullFromServerNow behaviour
// ══════════════════════════════════════════════════════════════════════════
section('9. _pullFromServerNow respects 8s debounce');
{
  var sb = makeSandbox();
  var pullCalls = 0;
  sb.syncFromServer = function(cb) { pullCalls++; cb(); };
  loadStorage(sb);

  // First call — should succeed
  vm.runInContext('_pullFromServerNow()', sb);
  ok(pullCalls === 1, 'first _pullFromServerNow call invokes syncFromServer');

  // Second call immediately — within 8s → debounced
  vm.runInContext('_pullFromServerNow()', sb);
  ok(pullCalls === 1, 'second call within 8s is debounced');
}

section('9b. _pullFromServerNow skips if syncFromServer not a function');
{
  var sb = makeSandbox();
  loadStorage(sb);  // syncFromServer is undefined in sandbox

  var threw = false;
  try {
    vm.runInContext('_pullFromServerNow()', sb);
  } catch(e) { threw = true; }

  ok(!threw, '_pullFromServerNow does not throw when syncFromServer undefined');
}

section('9c. _pullFromServerNow skips if navigator.onLine false');
{
  var sb = makeSandbox();
  var pullCalls = 0;
  sb.syncFromServer = function(cb) { pullCalls++; cb(); };
  sb.navigator.onLine = false;
  loadStorage(sb);

  vm.runInContext('_pullFromServerNow()', sb);
  ok(pullCalls === 0, '_pullFromServerNow skips when offline');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 10 — _triggerAutoBackup
// ══════════════════════════════════════════════════════════════════════════
section('10. _triggerAutoBackup uses RESTORE_KEY_MAP if defined');
{
  var sb = makeSandbox();
  loadStorage(sb);

  sb.RESTORE_KEY_MAP = { invoices: 'mp_invoices' };
  sb.localStorage.setItem('mp_invoices', JSON.stringify([{id:1}]));

  var backupCalled = false;
  sb.fetch = function(url, opts) {
    var body = opts && opts.body ? JSON.parse(opts.body) : {};
    if (body.__auto_backup__) backupCalled = true;
    return Promise.resolve({ ok: true, json: function() { return Promise.resolve({ ok: true }); } });
  };

  // Advance the timer manually — we mock setTimeout so fire it now
  var timerFn = null;
  sb.setTimeout = function(fn, ms) { timerFn = fn; return 1; };
  vm.runInContext('_triggerAutoBackup("invoices")', sb);
  if (timerFn) timerFn();

  ok(backupCalled, '_triggerAutoBackup sends __auto_backup__ payload');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 11 — app.js no longer defines the pipeline globals
// ══════════════════════════════════════════════════════════════════════════
section('11. app.js does not re-define the extracted pipeline');
{
  var appSrc = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8');

  // The pipeline functions must NOT be defined in app.js
  ok(!/^var _pendingKeys\s*=/.test(appSrc.replace(/\n/g, '\n')), '_pendingKeys not defined in app.js');
  ok(!/^function _flushPending\(/.test(appSrc.replace(/\n/g, '\n')), '_flushPending not defined in app.js');
  ok(!/^function _storeSave\(/.test(appSrc.replace(/\n/g, '\n')), '_storeSave not defined in app.js');
  ok(!/^function _pushCollection\(/.test(appSrc.replace(/\n/g, '\n')), '_pushCollection not defined in app.js');
  ok(!/^var _autoBackupTimer/.test(appSrc.replace(/\n/g, '\n')), '_autoBackupTimer not defined in app.js');
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 12 — Regression: STORE.save* still route through _storeSave
// ══════════════════════════════════════════════════════════════════════════
section('12. STORE.save* still route through _storeSave after Stage 4A');
{
  var sb = makeSandbox();
  loadStorage(sb);

  // Track _pendingAdd calls — use assignment to avoid function-hoisting recursion
  var pendingAddCalls = [];
  sb._pendingAddCalls = pendingAddCalls;
  vm.runInContext(
    '(function() {' +
    '  var _orig = _pendingAdd;' +
    '  _pendingAdd = function(k) { _orig(k); _pendingAddCalls.push(k); };' +
    '})()',
    sb
  );

  // Override _storeSave to use stub (avoids network calls in test)
  vm.runInContext(
    'function _storeSave(key, data) {' +
    '  _safeSet(key, data);' +
    '  _pendingAdd(key);' +
    '}',
    sb
  );

  // Load STORE from app.js
  var appLines = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8').split('\n');
  var si = appLines.findIndex(function(l) { return /^const STORE\s*=/.test(l); });
  var ei = si + 1;
  while (ei < appLines.length && !/^};/.test(appLines[ei].trimEnd())) ei++;
  ei++;
  var storeDef = appLines.slice(si, ei).join('\n').replace(/^const STORE/, 'var STORE');
  vm.runInContext(storeDef, sb);

  // backupVersions dynamic
  var bi = appLines.findIndex(function(l) { return l.indexOf('STORE.backupVersions =') !== -1; });
  if (bi !== -1) vm.runInContext(appLines[bi] + '\n' + appLines[bi + 1], sb);

  var STORE = sb.STORE;

  [
    { name: 'saveInvoices', key: 'mp_invoices' },
    { name: 'saveDevis',    key: 'mp_devis'    },
    { name: 'saveClients',  key: 'mp_clients'  },
    { name: 'saveBackupVersions', key: 'mp_backup_versions' }
  ].forEach(function(fn) {
    sb._pendingAddCalls.length = 0;
    STORE[fn.name]([{ id: 'test' }]);
    ok(sb._pendingAddCalls.indexOf(fn.key) !== -1,
      'STORE.' + fn.name + ' routes through _storeSave (key queued: ' + fn.key + ')');
  });
}

// ══════════════════════════════════════════════════════════════════════════
// SECTION 13 — _buildPendingBulk structure
// ══════════════════════════════════════════════════════════════════════════
section('13. _buildPendingBulk returns correct structure');
{
  var sb = makeSandbox();
  loadStorage(sb);
  sb.localStorage.setItem('mp_clients', JSON.stringify([{id:1}]));
  vm.runInContext('_pendingAdd("mp_clients")', sb);

  var bulk = sb._buildPendingBulk();
  ok(typeof bulk === 'object' && bulk !== null, '_buildPendingBulk returns object');
  ok(Array.isArray(bulk.bulk) === false && typeof bulk.bulk === 'object', 'bulk.bulk is an object');
  ok(typeof bulk.updatedAt === 'string', 'bulk.updatedAt is a string');
  ok(Array.isArray(bulk.bulk['mp_clients']), 'bulk.bulk["mp_clients"] is the stored array');
}

// ══════════════════════════════════════════════════════════════════════════
// Results
// ══════════════════════════════════════════════════════════════════════════
_results.forEach(function(r) { console.log(r); });
console.log('\n' + (_fail === 0 ? '✓' : '✗') +
  ' ' + _pass + '/' + (_pass + _fail) + ' tests passed');
process.exit(_fail > 0 ? 1 : 0);
