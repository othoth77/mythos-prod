// =====================================================
// MYTHOS OS — Core API Layer
// Generic HTTP transport helpers.
// No sync queue logic. No business data. No collection names.
// These are foundations; existing fetch calls in app.js are
// unchanged until Stage 1B migrates them to use these helpers.
// =====================================================

// ── Default API endpoint ───────────────────────────────────────────────
var _API_ENDPOINT = 'api.php';

// ── AbortController timeout ───────────────────────────────────────────
// Returns { signal, clear } — call clear() on success to cancel the timer.
function _apiTimeout(ms) {
  if (typeof AbortController === 'undefined') return { signal: undefined, clear: function() {} };
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, ms);
  return {
    signal: ctrl.signal,
    clear:  function() { clearTimeout(timer); }
  };
}

// ── Generic timeout-aware fetch ────────────────────────────────────────
// Wraps native fetch with an AbortController timeout.
// Returns a Promise<Response> — callers handle JSON parsing themselves
// or use _apiFetchJson below.
// timeoutMs defaults to 20 000 (20 s).
function _apiFetch(url, options, timeoutMs) {
  var ms  = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : 20000;
  var tmt = _apiTimeout(ms);
  var opts = Object.assign({}, options || {});
  if (tmt.signal) opts.signal = tmt.signal;
  return fetch(url, opts).then(function(r) {
    tmt.clear();
    return r;
  }, function(err) {
    tmt.clear();
    return Promise.reject(err);
  });
}

// ── JSON response parser ───────────────────────────────────────────────
// Parses the JSON body of a Response; rejects if status >= 400
// or if the body is not valid JSON.
function _apiParseJson(response) {
  if (!response.ok) {
    return Promise.reject(new Error('HTTP ' + response.status + ' ' + response.statusText));
  }
  return response.json();
}

// ── Generic JSON GET to api.php ────────────────────────────────────────
// params: object of query-string key/value pairs (e.g. { key: '__all__' })
// Returns a Promise<Object> (the parsed JSON body).
function _apiGet(params, timeoutMs) {
  var qs = '';
  if (params && typeof params === 'object') {
    var pairs = Object.keys(params).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    });
    if (pairs.length) qs = '?' + pairs.join('&') + '&_=' + Date.now();
    else qs = '?_=' + Date.now();
  } else {
    qs = '?_=' + Date.now();
  }
  return _apiFetch(_API_ENDPOINT + qs, { cache: 'no-store' }, timeoutMs)
    .then(_apiParseJson);
}

// ── Generic JSON POST to api.php ──────────────────────────────────────
// body: any JSON-serialisable object.
// Returns a Promise<Object> (the parsed JSON body).
function _apiPost(body, timeoutMs) {
  return _apiFetch(_API_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  }, timeoutMs).then(_apiParseJson);
}

// ── Retry helper ──────────────────────────────────────────────────────
// Retries fn() up to maxAttempts times with exponential backoff.
// fn must return a Promise. No business logic — generic combinator.
function _apiRetry(fn, maxAttempts, baseDelayMs) {
  var attempts = typeof maxAttempts === 'number' ? maxAttempts : 2;
  var delay    = typeof baseDelayMs  === 'number' ? baseDelayMs  : 500;
  function attempt(n) {
    return fn().catch(function(err) {
      if (n >= attempts) return Promise.reject(err);
      return new Promise(function(resolve) {
        setTimeout(function() { resolve(attempt(n + 1)); }, delay * n);
      });
    });
  }
  return attempt(1);
}
