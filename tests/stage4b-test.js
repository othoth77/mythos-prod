'use strict';
var vm   = require('vm');
var fs   = require('fs');
var path = require('path');

var BASE  = path.join(__dirname, '..');
var _pass = 0, _fail = 0;

function ok(cond, msg) {
  if (cond) { console.log('  PASS ' + msg); _pass++; }
  else       { console.error('  FAIL ' + msg); _fail++; }
}
function load(sb, rel) {
  vm.runInContext(fs.readFileSync(path.join(BASE, rel), 'utf8'), sb);
}

// ── Sandbox factory ───────────────────────────────────────────────────
function makeSandbox(fetchImpl) {
  var _ls = {};
  var fetchCalls = [];
  var _defaultFetch = function(url, opts) {
    fetchCalls.push({ url: url, opts: opts });
    return Promise.resolve({ json: function() { return Promise.resolve({ ok: false }); } });
  };
  var _fetch = fetchImpl || _defaultFetch;

  var domEl = function() {
    return { id: '', style: { cssText: '', opacity: '' }, innerHTML: '', appendChild: function() {} };
  };
  var docListeners = {};

  var sb = vm.createContext({
    document: {
      visibilityState: 'visible', readyState: 'complete',
      createElement: domEl,
      getElementById: function() { return null; },
      querySelector: function() { return null; },
      querySelectorAll: function() { return []; },
      body: { appendChild: function() {} },
      addEventListener: function(evt, fn) {
        if (!docListeners[evt]) docListeners[evt] = [];
        docListeners[evt].push(fn);
      }
    },
    window: { addEventListener: function() {} },
    navigator: {
      onLine: true,
      sendBeacon: function() { return true; }
    },
    localStorage: {
      getItem: function(k)    { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
      setItem: function(k, v) { _ls[k] = String(v); },
      removeItem: function(k) { delete _ls[k]; },
      get length()            { return Object.keys(_ls).length; },
      key: function(i)        { return Object.keys(_ls)[i] || null; }
    },
    fetch: _fetch,
    AbortController: (typeof AbortController !== 'undefined') ? AbortController
      : function() { this.signal = {}; this.abort = function() {}; },
    setInterval:  function() { return 1; },
    clearInterval: function() {},
    setTimeout:   function() { return 1; },
    clearTimeout: function() {},
    Blob: function(parts) { return { parts: parts }; },
    Set: Set, Map: Map, Math: Math, Promise: Promise,
    JSON: JSON, Date: Date, Array: Array, Object: Object,
    String: String, Number: Number, Boolean: Boolean,
    console: { log: function() {}, warn: function() {}, error: function() {} },
    _fetchCalls: fetchCalls,
    _docListeners: docListeners
  });
  return sb;
}

// Drain microtask queue (enough for a 2-level .then chain + rejection path)
async function flush() {
  for (var i = 0; i < 6; i++) await Promise.resolve();
}

// ── Tests ──────────────────────────────────────────────────────────────
async function main() {
  console.log('=== stage4b-test.js ===\n');

  // 1. sync.js exports all Stage 4B globals
  console.log('1. sync.js exports all Stage 4B globals');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    ok(typeof sb._mergeCollections  === 'function', '_mergeCollections is a function');
    ok(typeof sb._tombKey           === 'function', '_tombKey is a function');
    ok(typeof sb._getDeletedIds     === 'function', '_getDeletedIds is a function');
    ok(typeof sb._markDeleted       === 'function', '_markDeleted is a function');
    ok(typeof sb._filterTombstoned  === 'function', '_filterTombstoned is a function');
    ok(sb._syncIndicatorTimer       === null,        '_syncIndicatorTimer initialises to null');
    ok(typeof sb._showSyncIndicator === 'function', '_showSyncIndicator is a function');
    ok(typeof sb.syncFromServer     === 'function', 'syncFromServer is a function');
  }

  // 2. storage.js primitives and pipeline still present after loading sync.js
  console.log('\n2. storage.js primitives and pipeline still present');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    ok(typeof sb._storeGet   === 'function', '_storeGet still present');
    ok(typeof sb._safeSet    === 'function', '_safeSet still present');
    ok(typeof sb._storeSave  === 'function', '_storeSave still present');
    ok(typeof sb._pendingAdd === 'function', '_pendingAdd still present');
  }

  // 3. _mergeCollections behaviour
  console.log('\n3. _mergeCollections');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    var r;
    r = vm.runInContext('_mergeCollections([], [])', sb);
    ok(Array.isArray(r) && r.length === 0, 'both empty → []');

    r = vm.runInContext('_mergeCollections([], [{id:"s1",name:"srv"}])', sb);
    ok(r.length === 1 && r[0].id === 's1', 'local empty → returns server');

    r = vm.runInContext('_mergeCollections([{id:"l1",name:"loc"}], [])', sb);
    ok(r.length === 1 && r[0].id === 'l1', 'server empty → returns local');

    r = vm.runInContext(
      '_mergeCollections(' +
        '[{id:"shared",name:"old"},{id:"local1"}],' +
        '[{id:"shared",updatedAt:"2026-06-01",name:"new"},{id:"server1"}]' +
      ')', sb);
    var ids = r.map(function(x) { return x.id; }).sort();
    ok(ids.join(',') === 'local1,server1,shared', 'all IDs present in merge');
    var sh = r.find(function(x) { return x.id === 'shared'; });
    ok(sh && sh.name === 'new', 'more-recent server item wins');

    r = vm.runInContext('_mergeCollections(null, [{id:"1"}])', sb);
    ok(r && r.length === 1, 'null local treated as empty array');

    r = vm.runInContext('_mergeCollections([{id:"1"}], "not-array")', sb);
    ok(r && r.length === 1, 'non-array server treated as empty array');

    r = vm.runInContext(
      '_mergeCollections([{name:"no-id"}],[{name:"other-no-id"}])', sb);
    ok(r && r.length >= 1, 'items without id keyed by index (no crash)');
  }

  // 4. Tombstone helpers
  console.log('\n4. tombstone helpers');
  {
    var sb = makeSandbox();
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    ok(vm.runInContext('_tombKey("mp_rdvs")', sb) === 'mp_rdvs__deleted',
       '_tombKey appends __deleted');

    var ids = vm.runInContext('_getDeletedIds("mp_rdvs")', sb);
    ok(Array.isArray(ids) && ids.length === 0,
       '_getDeletedIds returns [] when nothing stored');

    vm.runInContext('_markDeleted("mp_rdvs", "42")', sb);
    ids = vm.runInContext('_getDeletedIds("mp_rdvs")', sb);
    ok(ids.length === 1 && ids[0] === '42',
       '_markDeleted adds ID to tombstone');

    vm.runInContext('_markDeleted("mp_rdvs", "42")', sb);
    ids = vm.runInContext('_getDeletedIds("mp_rdvs")', sb);
    ok(ids.length === 1,
       '_markDeleted is idempotent (same ID not added twice)');

    vm.runInContext('_markDeleted("mp_rdvs", "99")', sb);
    ids = vm.runInContext('_getDeletedIds("mp_rdvs")', sb);
    ok(ids.length === 2 && ids.indexOf('99') !== -1,
       '_markDeleted can store multiple different IDs');

    vm.runInContext('_markDeleted("mp_rdvs", null)', sb);
    ids = vm.runInContext('_getDeletedIds("mp_rdvs")', sb);
    ok(ids.length === 2, '_markDeleted skips null id');

    var stored = sb.localStorage.getItem('mp_rdvs__deleted');
    ok(stored !== null, '_markDeleted persists tombstone to localStorage');

    var items = vm.runInContext(
      '_filterTombstoned("mp_rdvs", [{id:"42",name:"del"},{id:"55",name:"keep"}])', sb);
    ok(items.length === 1 && items[0].id === '55',
       '_filterTombstoned removes tombstoned item');

    items = vm.runInContext(
      '_filterTombstoned("mp_rdvs", [{name:"no-id"},{id:"42"}])', sb);
    ok(items.length === 1 && items[0].name === 'no-id',
       '_filterTombstoned keeps items with no id');

    var r = vm.runInContext('_filterTombstoned("mp_rdvs", "not-array")', sb);
    ok(r === 'not-array',
       '_filterTombstoned returns non-array input unchanged');

    items = vm.runInContext(
      '_filterTombstoned("mp_other", [{id:"1"},{id:"2"}])', sb);
    ok(items.length === 2,
       '_filterTombstoned returns all items when no tombstones exist for key');
  }

  // 5. _showSyncIndicator
  console.log('\n5. _showSyncIndicator');
  {
    var sb = makeSandbox();
    var createdEl = null;
    sb.document.createElement = function() {
      createdEl = { id: '', style: { cssText: '', opacity: '' }, innerHTML: '', appendChild: function() {} };
      return createdEl;
    };
    var timerSet = false;
    sb.setTimeout = function(fn, ms) { timerSet = ms; return 42; };
    var clearedId = null;
    sb.clearTimeout = function(id) { clearedId = id; };

    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    vm.runInContext('_showSyncIndicator("Sync…", "#d4af37")', sb);
    ok(createdEl !== null, 'creates indicator element when not in DOM');
    ok(sb._syncIndicatorTimer === 42, '_syncIndicatorTimer set after first call');
    ok(timerSet === 2500, 'auto-hide timer set to 2500 ms');

    vm.runInContext('_showSyncIndicator("Done", "#22c55e")', sb);
    ok(clearedId === 42, 'clearTimeout called with previous timer id on second call');
  }

  // 6. syncFromServer — network failure → callback called
  console.log('\n6. syncFromServer — network failure');
  {
    var sb = makeSandbox(function() { return Promise.reject(new Error('net')); });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb._cbCalled = false;
    vm.runInContext('syncFromServer(function() { _cbCalled = true; }, true)', sb);
    await flush();
    ok(sb._cbCalled, 'callback called on network error');
  }

  // 7. syncFromServer — server ok:false → callback called
  console.log('\n7. syncFromServer — server ok:false');
  {
    var sb = makeSandbox(function() {
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: false }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb._cbCalled = false;
    vm.runInContext('syncFromServer(function() { _cbCalled = true; }, true)', sb);
    await flush();
    ok(sb._cbCalled, 'callback called when server returns ok:false');
  }

  // 8. syncFromServer — Step 1: server-only key → _safeSet
  console.log('\n8. syncFromServer — server-only key stored locally');
  {
    var serverData = { mp_clients: [{ id: '1', name: 'Alice' }] };
    var sb = makeSandbox(function(url) {
      return Promise.resolve({ json: function() {
        return Promise.resolve({ ok: true, data: serverData, meta: {} });
      }});
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb._cbCalled = false;
    vm.runInContext('syncFromServer(function() { _cbCalled = true; }, true)', sb);
    await flush();
    ok(sb._cbCalled, 'callback called after successful sync');
    var stored = JSON.parse(sb.localStorage.getItem('mp_clients') || 'null');
    ok(Array.isArray(stored) && stored.length === 1, 'server-only key written to localStorage');
    ok(stored[0].name === 'Alice', 'correct server data stored');
  }

  // 9. syncFromServer — Step 1: both have arrays → merged
  console.log('\n9. syncFromServer — array merge');
  {
    var serverData = { mp_clients: [{ id: 'sv1', name: 'Server' }] };
    var sb = makeSandbox(function(url) {
      if (url.indexOf('__all__') !== -1)
        return Promise.resolve({ json: function() {
          return Promise.resolve({ ok: true, data: serverData, meta: {} });
        }});
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: true }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb.localStorage.setItem('mp_clients', JSON.stringify([{ id: 'lc1', name: 'Local' }]));
    vm.runInContext('syncFromServer(function() {}, true)', sb);
    await flush();
    var merged = JSON.parse(sb.localStorage.getItem('mp_clients') || '[]');
    var ids = merged.map(function(x) { return x.id; }).sort();
    ok(ids.join(',') === 'lc1,sv1', 'arrays merged by ID (both items present)');
  }

  // 10. syncFromServer — Step 1: scalars, server newer → uses server
  console.log('\n10. syncFromServer — scalar, server newer');
  {
    var svTs = new Date('2026-07-01').toISOString();
    var serverData = { mp_settings: { theme: 'dark' } };
    var serverMeta = { mp_settings: { updatedAt: svTs } };
    var sb = makeSandbox(function(url) {
      if (url.indexOf('__all__') !== -1)
        return Promise.resolve({ json: function() {
          return Promise.resolve({ ok: true, data: serverData, meta: serverMeta });
        }});
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: true }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    // Set local with older timestamp
    sb.localStorage.setItem('mp_settings', JSON.stringify({ theme: 'light' }));
    // _localMeta for mp_settings has ts=0 (not set)
    vm.runInContext('syncFromServer(function() {}, true)', sb);
    await flush();
    var val = JSON.parse(sb.localStorage.getItem('mp_settings') || 'null');
    ok(val && val.theme === 'dark', 'server value used when server timestamp is newer');
  }

  // 11. syncFromServer — Step 2: local mp_* key not on server → uploaded
  console.log('\n11. syncFromServer — local key uploaded');
  {
    var pushedKeys = [];
    var sb = makeSandbox(function(url, opts) {
      if (url.indexOf('__all__') !== -1)
        return Promise.resolve({ json: function() {
          return Promise.resolve({ ok: true, data: {}, meta: {} });
        }});
      var body = {};
      try { body = JSON.parse(opts && opts.body || '{}'); } catch(e) {}
      if (body.key) pushedKeys.push(body.key);
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: true }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb.localStorage.setItem('mp_invoices', JSON.stringify([{ id: 'inv1' }]));
    vm.runInContext('syncFromServer(function() {}, true)', sb);
    await flush();
    ok(pushedKeys.indexOf('mp_invoices') !== -1, 'local-only mp_* key pushed to server');
  }

  // 12. syncFromServer — Step 4: _rdInvalidateCache called if defined
  console.log('\n12. syncFromServer — _rdInvalidateCache hook');
  {
    var sb = makeSandbox(function(url) {
      if (url.indexOf('__all__') !== -1)
        return Promise.resolve({ json: function() {
          return Promise.resolve({ ok: true, data: {}, meta: {} });
        }});
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: true }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb._rdInvalidateCalled = false;
    vm.runInContext('_rdInvalidateCache = function() { _rdInvalidateCalled = true; }', sb);
    vm.runInContext('syncFromServer(function() {}, true)', sb);
    await flush();
    ok(sb._rdInvalidateCalled, '_rdInvalidateCache called when defined');
  }

  // 13. syncFromServer — _rdInvalidateCache absent → no throw
  console.log('\n13. syncFromServer — absent _rdInvalidateCache is safe');
  {
    var sb = makeSandbox(function(url) {
      if (url.indexOf('__all__') !== -1)
        return Promise.resolve({ json: function() {
          return Promise.resolve({ ok: true, data: {}, meta: {} });
        }});
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: true }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    var threw = false;
    try { vm.runInContext('syncFromServer(function() {}, true)', sb); } catch(e) { threw = true; }
    await flush();
    ok(!threw, 'no throw when _rdInvalidateCache is undefined');
  }

  // 14. syncFromServer — silent=true skips _showSyncIndicator
  console.log('\n14. syncFromServer — silent=true');
  {
    var sb = makeSandbox(function() {
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: false }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb._indicatorCalls = 0;
    vm.runInContext(
      '(function(){ var orig=_showSyncIndicator; _showSyncIndicator=function(){ _indicatorCalls++; orig.apply(null,arguments); }; })()',
      sb
    );
    vm.runInContext('syncFromServer(function(){}, true)', sb);
    await flush();
    ok(sb._indicatorCalls === 0, 'silent=true → _showSyncIndicator not called');
  }

  // 15. syncFromServer — silent=false calls _showSyncIndicator
  console.log('\n15. syncFromServer — silent=false');
  {
    var sb = makeSandbox(function() {
      return Promise.resolve({ json: function() { return Promise.resolve({ ok: false }); } });
    });
    load(sb, 'js/core/storage.js');
    load(sb, 'js/core/sync.js');

    sb._indicatorCalls = 0;
    vm.runInContext(
      '(function(){ var orig=_showSyncIndicator; _showSyncIndicator=function(){ _indicatorCalls++; orig.apply(null,arguments); }; })()',
      sb
    );
    vm.runInContext('syncFromServer(function(){}, false)', sb);
    await flush();
    ok(sb._indicatorCalls >= 1, 'silent=false → _showSyncIndicator called');
  }

  // 16. app.js does not redefine the extracted sync globals
  console.log('\n16. app.js does not redefine extracted sync globals');
  {
    var appJs = fs.readFileSync(path.join(BASE, 'js/app.js'), 'utf8');
    ok(!/^function syncFromServer/m.test(appJs),
       'syncFromServer not defined in app.js');
    ok(!/^function _mergeCollections/m.test(appJs),
       '_mergeCollections not defined in app.js');
    ok(!/^function _markDeleted/m.test(appJs),
       '_markDeleted not defined in app.js');
    ok(!/^var _syncIndicatorTimer/m.test(appJs),
       '_syncIndicatorTimer not defined in app.js');
    ok(appJs.indexOf('js/core/sync.js') !== -1,
       'app.js contains reference comment pointing to sync.js');
  }

  // Print result
  var total = _pass + _fail;
  if (_fail === 0) console.log('\n✓ ' + _pass + '/' + total + ' tests passed');
  else             console.log('\n✗ ' + _pass + '/' + total + ' tests passed');
  process.exit(_fail > 0 ? 1 : 0);
}

main().catch(function(e) { console.error('FATAL:', e.message); process.exit(1); });
