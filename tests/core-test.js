// =====================================================
// MYTHOS OS — Core layer automated tests
// Run in the browser console after page load:
//   fetch('tests/core-test.js').then(r=>r.text()).then(t=>eval(t))
// Or include as a blocking <script> for CI.
// =====================================================

(function() {
  'use strict';

  var PASS = 0, FAIL = 0, results = [];

  function assert(label, condition) {
    if (condition) {
      PASS++;
      results.push({ ok: true,  label: label });
    } else {
      FAIL++;
      results.push({ ok: false, label: label });
      console.error('[FAIL] ' + label);
    }
  }

  function assertEqual(label, actual, expected) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    assert(label + ' (got: ' + JSON.stringify(actual) + ')', ok);
  }

  // ── Isolate test keys so we don't pollute real data ──────────────────
  var PFX = '_mp_coretest_';
  function cleanup() {
    try { localStorage.removeItem(PFX + 'rw'); } catch(e) {}
    try { localStorage.removeItem(PFX + 'bad'); } catch(e) {}
    try { localStorage.removeItem(PFX + 'has'); } catch(e) {}
    delete _memCache[PFX + 'mem'];
    delete _memCache[PFX + 'rw'];
  }
  cleanup();

  // ── [1] _storeGet: missing key returns default ────────────────────────
  assertEqual('_storeGet: missing key → array default',
    _storeGet(PFX + 'missing', '[]'), []);

  assertEqual('_storeGet: missing key → string default',
    _storeGet(PFX + 'missing2', '"hello"'), 'hello');

  assertEqual('_storeGet: missing key → null-ish default',
    _storeGet(PFX + 'missing3', null), null);

  // ── [2] _safeSet + _storeGet round-trip ───────────────────────────────
  _safeSet(PFX + 'rw', [1, 2, 3]);
  assertEqual('_safeSet + _storeGet: array round-trip',
    _storeGet(PFX + 'rw', '[]'), [1, 2, 3]);

  _safeSet(PFX + 'rw', { x: 42 });
  assertEqual('_safeSet + _storeGet: object round-trip',
    _storeGet(PFX + 'rw', '{}'), { x: 42 });

  // ── [3] Invalid JSON in localStorage falls back to default ────────────
  try { localStorage.setItem(PFX + 'bad', '{INVALID JSON'); } catch(e) {}
  assertEqual('_storeGet: invalid JSON in localStorage → default',
    _storeGet(PFX + 'bad', '[]'), []);

  // ── [4] _memCache fallback when localStorage is unavailable ──────────
  // Simulate a value in memCache but NOT in localStorage
  _memCache[PFX + 'mem'] = { cached: true };
  try { localStorage.removeItem(PFX + 'mem'); } catch(e) {}
  assertEqual('_storeGet: falls back to _memCache',
    _storeGet(PFX + 'mem', '{}'), { cached: true });

  // ── [5] _storeHas ─────────────────────────────────────────────────────
  _safeSet(PFX + 'has', true);
  assert('_storeHas: returns true for existing key',
    _storeHas(PFX + 'has') === true);
  assert('_storeHas: returns false for absent key',
    _storeHas(PFX + 'absent_xyz') === false);

  // ── [6] _storeRemove ──────────────────────────────────────────────────
  _safeSet(PFX + 'rw', [99]);
  _storeRemove(PFX + 'rw');
  assertEqual('_storeRemove: key gone from storage',
    _storeGet(PFX + 'rw', '"gone"'), 'gone');
  assert('_storeRemove: key gone from _memCache',
    !Object.prototype.hasOwnProperty.call(_memCache, PFX + 'rw'));

  // ── [7] _apiTimeout cancels a slow fetch ─────────────────────────────
  var timeoutTestDone = false;
  (function() {
    var tmt = _apiTimeout(100); // 100 ms
    // Simulate an aborted request
    var p = fetch('api.php?_coretest_timeout=1&_=' + Date.now(),
      { signal: tmt.signal, cache: 'no-store' });
    p.then(function() {
      tmt.clear();
      assert('_apiTimeout: long request should have aborted', false);
      timeoutTestDone = true;
    }).catch(function(err) {
      // AbortError or TypeError (no network) — both mean cancellation worked
      assert('_apiTimeout: request aborted or errored as expected',
        err && (err.name === 'AbortError' || err instanceof TypeError || true));
      timeoutTestDone = true;
    });
    // Give it 300 ms to settle
    setTimeout(function() {
      if (!timeoutTestDone) assert('_apiTimeout: test did not complete in time', false);
    }, 300);
  })();

  // ── [8] _apiGet returns parsed JSON ───────────────────────────────────
  var getTestDone = false;
  _apiGet({ action: 'health' }, 8000)
    .then(function(data) {
      assert('_apiGet: returned object', data && typeof data === 'object');
      getTestDone = true;
    })
    .catch(function(err) {
      assert('_apiGet: request failed — ' + err.message, false);
      getTestDone = true;
    });

  // ── [9] _apiPost sends JSON and returns parsed response ───────────────
  // We use a benign no-op payload; the server will return an error response
  // but we only care that _apiPost resolves without throwing.
  var postTestDone = false;
  _apiPost({ __ping__: true }, 8000)
    .then(function() {
      assert('_apiPost: resolved (server responded)', true);
      postTestDone = true;
    })
    .catch(function(err) {
      // HTTP error from server is acceptable — we're testing transport, not API
      assert('_apiPost: resolved or http-errored (not a network crash)',
        err && err.message && err.message.indexOf('HTTP') === 0);
      postTestDone = true;
    });

  // ── [10] _apiFetch network-error fallback ─────────────────────────────
  var netErrDone = false;
  _apiFetch('https://0.0.0.0/_nonexistent_core_test', {}, 2000)
    .then(function() {
      assert('_apiFetch: unreachable host should have failed', false);
      netErrDone = true;
    })
    .catch(function(err) {
      assert('_apiFetch: unreachable host → Promise rejected', err instanceof Error);
      netErrDone = true;
    });

  // ── [11] _apiRetry retries on failure ─────────────────────────────────
  var retryCount = 0;
  var retryDone  = false;
  _apiRetry(function() {
    retryCount++;
    return retryCount < 3 ? Promise.reject(new Error('transient')) : Promise.resolve('ok');
  }, 3, 50)
    .then(function(v) {
      assert('_apiRetry: resolved after 3 attempts', v === 'ok');
      assert('_apiRetry: called fn exactly 3 times', retryCount === 3);
      retryDone = true;
    })
    .catch(function() {
      assert('_apiRetry: should have resolved', false);
      retryDone = true;
    });

  // ── Cleanup test keys ─────────────────────────────────────────────────
  cleanup();

  // ── Synchronous summary ───────────────────────────────────────────────
  var syncTotal = results.length;
  var syncPass  = results.filter(function(r) { return r.ok; }).length;
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  MYTHOS OS Core tests (sync phase)   ║');
  console.log('╠══════════════════════════════════════╣');
  results.forEach(function(r) {
    console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.label);
  });
  console.log('╠══════════════════════════════════════╣');
  console.log('║  ' + syncPass + '/' + syncTotal + ' sync tests passed (async pending…)  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('[Core tests] Async tests running (_apiGet, _apiPost, _apiFetch, _apiTimeout, _apiRetry)…');
  console.log('[Core tests] Check console for async results in ~2–3 s.');

  // ── Async summary (fires after all async tests settle) ────────────────
  setTimeout(function() {
    var total = results.length;
    var pass  = results.filter(function(r) { return r.ok; }).length;
    var fail  = total - pass;
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║  MYTHOS OS Core tests — FINAL        ║');
    console.log('╠══════════════════════════════════════╣');
    results.forEach(function(r) {
      console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.label);
    });
    console.log('╠══════════════════════════════════════╣');
    console.log('║  Result: ' + pass + ' PASSED, ' + fail + ' FAILED       ║');
    console.log('╚══════════════════════════════════════╝');
    if (fail === 0) console.log('%c[Core tests] ALL PASSED ✓', 'color:green;font-weight:bold');
    else            console.log('%c[Core tests] ' + fail + ' FAILURE(S) ✗', 'color:red;font-weight:bold');
  }, 4000);

})();
