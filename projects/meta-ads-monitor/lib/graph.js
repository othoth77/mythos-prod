'use strict';
// =====================================================
// Facebook Ads Monitor — read-only Meta Graph API client
// projects/meta-ads-monitor/lib/graph.js
//
// READ-ONLY BY DESIGN. This module is the monitor's only network path and
// it can only ever issue HTTP GET:
//   - the method is a constant, never a parameter;
//   - the request path must match a fixed allowlist of read endpoints;
//   - query parameters that Graph treats as a verb override (`method`,
//     `_method`) or that would move the token into the URL
//     (`access_token`) are refused before any request is made;
//   - the token travels in the Authorization header only, so it never
//     appears in a URL, a paging link we follow, a log line or an error.
// There is deliberately no post()/delete()/request() export.
// =====================================================

var DEFAULT_VERSION = 'v24.0';
var DEFAULT_BASE = 'https://graph.facebook.com';

var ALLOWED_PATHS = Object.freeze([
  /^me\/adaccounts$/,
  /^act_\d{1,20}$/,
  /^act_\d{1,20}\/(campaigns|adsets|ads|insights)$/
]);

var FORBIDDEN_PARAMS = Object.freeze(['method', '_method', 'access_token', 'appsecret_proof', 'batch']);

// Graph error codes Meta documents as transient or throttling.
var TRANSIENT_CODES = Object.freeze([1, 2, 4, 17, 32, 341, 613, 80000, 80004]);
var BACKOFF_MS = Object.freeze([2000, 10000, 30000]);

function isAllowedPath(p) {
  return typeof p === 'string' && ALLOWED_PATHS.some(function (re) { return re.test(p); });
}

function monitorError(code, message, extra) {
  var e = new Error(message);
  e.code = code;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

function redact(text, token) {
  var s = String(text === undefined || text === null ? '' : text);
  if (token) s = s.split(token).join('<redacted>');
  return s.replace(/EAA[A-Za-z0-9]{20,}/g, '<redacted>');
}

function defaultSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// createClient({ token, version?, baseUrl?, fetch?, timeoutMs?, retries?, sleep? })
function createClient(opts) {
  opts = opts || {};
  var token = opts.token;
  if (typeof token !== 'string' || !token) throw monitorError('META_NO_TOKEN', 'no read token configured');
  var version = opts.version || DEFAULT_VERSION;
  if (!/^v\d{1,3}\.\d$/.test(version)) throw monitorError('META_BAD_VERSION', 'invalid Graph API version');
  var base = (opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  var fetchImpl = opts.fetch || (typeof fetch === 'function' ? fetch : null);
  if (!fetchImpl) throw monitorError('META_NO_FETCH', 'no fetch implementation available');
  var timeoutMs = opts.timeoutMs || 30000;
  var retries = typeof opts.retries === 'number' ? opts.retries : 3;
  var sleep = opts.sleep || defaultSleep;
  var requests = 0;

  function buildUrl(p, params) {
    if (!isAllowedPath(p)) throw monitorError('META_PATH_REFUSED', 'read-only allowlist refused path: ' + String(p).slice(0, 80));
    var qs = [];
    Object.keys(params || {}).sort().forEach(function (k) {
      if (FORBIDDEN_PARAMS.indexOf(k.toLowerCase()) !== -1) throw monitorError('META_PARAM_REFUSED', 'read-only client refused parameter: ' + k);
      var v = params[k];
      if (v === undefined || v === null) return;
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    });
    return base + '/' + version + '/' + p + (qs.length ? '?' + qs.join('&') : '');
  }

  async function get(p, params) {
    var url = buildUrl(p, params);
    var lastErr = null;
    for (var attempt = 0; attempt <= retries; attempt++) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs) : null;
      var res, body, transient = false;
      try {
        requests++;
        res = await fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
          signal: controller ? controller.signal : undefined
        });
        var text = await res.text();
        try { body = text ? JSON.parse(text) : {}; } catch (e) { body = null; }
        if (res.ok && body && !body.error) return body;
        var ge = body && body.error ? body.error : {};
        transient = res.status >= 500 || res.status === 429 || ge.is_transient === true ||
          TRANSIENT_CODES.indexOf(Number(ge.code)) !== -1;
        lastErr = monitorError(transient ? 'META_TRANSIENT' : 'META_API_ERROR',
          redact('Graph API ' + res.status + (ge.code ? ' code ' + ge.code : '') + (ge.message ? ': ' + ge.message : ''), token),
          { status: res.status, graphCode: ge.code || null, transient: transient });
      } catch (e) {
        if (e && (e.code === 'META_PATH_REFUSED' || e.code === 'META_PARAM_REFUSED')) throw e;
        transient = true;
        lastErr = monitorError('META_NETWORK', redact((e && e.name === 'AbortError') ? 'request timed out after ' + timeoutMs + ' ms' : 'network error: ' + (e && e.message), token),
          { transient: true });
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!transient || attempt === retries) break;
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
    throw lastErr;
  }

  // Cursor pagination without ever following a server-supplied URL.
  async function getAll(p, params, maxPages) {
    var out = [];
    var after = null;
    var pages = 0;
    maxPages = maxPages || 20;
    do {
      var q = Object.assign({}, params || {});
      if (after) q.after = after;
      var body = await get(p, q);
      (Array.isArray(body.data) ? body.data : []).forEach(function (row) { out.push(row); });
      var paging = body.paging || {};
      after = paging.next && paging.cursors && paging.cursors.after ? paging.cursors.after : null;
      pages++;
    } while (after && pages < maxPages);
    return out;
  }

  return Object.freeze({
    get: get,
    getAll: getAll,
    requestCount: function () { return requests; }
  });
}

module.exports = {
  DEFAULT_VERSION: DEFAULT_VERSION,
  ALLOWED_PATHS: ALLOWED_PATHS,
  FORBIDDEN_PARAMS: FORBIDDEN_PARAMS,
  isAllowedPath: isAllowedPath,
  redact: redact,
  createClient: createClient
};
