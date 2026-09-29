'use strict';
// =====================================================
// MYTHOS Browser MCP — ObscuraBackend (PRIMARY)
// projects/mythos-browser-mcp/lib/obscura-backend.js
//
// Talks Chrome DevTools Protocol to the Obscura runtime serving on
// 127.0.0.1:9222 (owner architecture, 2026-09-27). Authentication is the
// runtime's bearer token, read from OBSCURA_CDP_TOKEN in THIS process's
// environment only: it is sent as an Authorization header (and, when the
// runtime hands back a WebSocket URL that already carries it, used as
// given), never returned, never logged, never placed in a result.
//
// Session model: one page per adapter session — /json/new (or Target.createTarget
// when the legacy endpoint is absent), a per-page WebSocket, Page + Runtime
// domains, then /json/close (or Target.closeTarget). Nothing is left open:
// a backend session that fails half-way still closes its page.
// =====================================================
var http = require('http');
var https = require('https');
var { URL } = require('url');
var cdp = require('./cdp-client');
var pageText = require('./page-text');

var DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
var NAV_TIMEOUT_MS = 30000;
var CALL_TIMEOUT_MS = 30000;
var CLICK_SETTLE_MS = 1500;
var CLICK_ACTION_MS = 5000;

// Obscura answers a failed fetch as a CDP ERROR on Page.navigate ("Network
// error: … error sending request", measured 2026-09-29), not as errorText.
// Two different things hide in that shape, and they must not be confused:
//   * the engine's own SSRF refusal ("Access to private/internal IP address")
//     — a hostname that RESOLVED to a private address. That is a POLICY
//     verdict: it must never be retried on another engine, which is exactly
//     what the fallback would otherwise do;
//   * any other network failure — a site failure, NAVIGATE_FAILED.
function navigationError(err) {
  var msg = String(err && err.message || err);
  if (/private\/internal IP address|private network/i.test(msg)) {
    var p = new Error('URL_POLICY: the runtime refused a private or internal address (' + msg.replace(/^CDP_ERROR: /, '').slice(0, 200) + ')');
    p.code = 'URL_POLICY'; return p;
  }
  if (/^CDP_ERROR: .*Network error/.test(msg)) {
    var n = new Error('NAVIGATE_FAILED: ' + msg.replace(/^CDP_ERROR: /, '').slice(0, 300)); n.code = 'NAVIGATE_FAILED'; return n;
  }
  return err;
}

function redactUrl(u) {
  try { var x = new URL(u); x.search = ''; x.username = ''; x.password = ''; return x.toString(); } catch (e) { return '<url>'; }
}

function httpJson(method, base, pathname, token, timeoutMs) {
  return new Promise(function (resolve, reject) {
    var u = new URL(pathname, base);
    var mod = u.protocol === 'https:' ? https : http;
    var headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = mod.request({ method: method, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, headers: headers, timeout: timeoutMs || 10000 }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); if (Buffer.concat(chunks).length > 1024 * 1024) res.destroy(); });
      res.on('end', function () {
        var body = Buffer.concat(chunks).toString('utf8');
        var json = null; try { json = JSON.parse(body); } catch (e) { /* not json */ }
        resolve({ status: res.statusCode, json: json, text: body.slice(0, 400) });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { reject(new Error('OBSCURA_UNREACHABLE: ' + e.message)); });
    req.end();
  });
}

function create(cfg) {
  cfg = cfg || {};
  var env = cfg.env || process.env;
  var base = cfg.cdpUrl || env.OBSCURA_CDP_URL || DEFAULT_CDP_URL;
  var token = cfg.token !== undefined ? cfg.token : (env.OBSCURA_CDP_TOKEN || null);
  var navTimeout = cfg.navTimeoutMs || NAV_TIMEOUT_MS;
  var headers = token ? { Authorization: 'Bearer ' + token } : {};

  var baseUrl;
  try { baseUrl = new URL(base); } catch (e) { throw new Error('OBSCURA_CONFIG: OBSCURA_CDP_URL is not a URL'); }
  if (baseUrl.hostname !== '127.0.0.1' && baseUrl.hostname !== 'localhost' && baseUrl.hostname !== '::1' && !cfg.allowRemoteCdp) {
    throw new Error('OBSCURA_CONFIG: the CDP endpoint must be loopback (got ' + baseUrl.hostname + ')');
  }

  // probe() -> { ok, product, version, protocol, auth: 'required'|'none'|'unknown' } — never the token
  function probe() {
    return httpJson('GET', base, '/json/version', token, 5000).then(function (r) {
      if (r.status === 401 || r.status === 403) return { ok: false, code: 'OBSCURA_UNAUTHORIZED', reason: 'CDP endpoint refused the token (HTTP ' + r.status + ')' + (token ? '' : ' — OBSCURA_CDP_TOKEN is not set') };
      if (r.status !== 200 || !r.json) return { ok: false, code: 'OBSCURA_BAD_VERSION', reason: 'GET /json/version answered HTTP ' + r.status };
      return { ok: true, product: r.json.Browser || r.json.product || null, version: r.json['Protocol-Version'] || null, user_agent: r.json['User-Agent'] || null, ws: !!r.json.webSocketDebuggerUrl };
    }).catch(function (e) { return { ok: false, code: 'OBSCURA_UNREACHABLE', reason: String(e.message).replace(/^OBSCURA_UNREACHABLE: /, '') }; });
  }

  // An unauthenticated probe, for the security verification: must NOT be 200.
  function probeUnauthenticated() {
    return httpJson('GET', base, '/json/version', null, 5000).then(function (r) { return { status: r.status }; })
      .catch(function (e) { return { status: null, reason: e.message }; });
  }

  function wsUrlFor(pageWs) {
    // The runtime may answer with ws://host:port/... — keep it, but pin the host
    // to the configured loopback endpoint so a rewritten URL cannot redirect us.
    var u = new URL(pageWs);
    u.hostname = baseUrl.hostname; u.port = baseUrl.port || u.port;
    return u.toString();
  }

  function open() {
    var session = { backend: 'obscura', pageId: null, client: null, mode: null, sessionId: null };
    return probe().then(function (p) {
      if (!p.ok) { var e = new Error(p.code + ': ' + p.reason); e.code = p.code; throw e; }
      session.product = p.product;
      // Legacy page endpoint first (widest compatibility), Target domain second.
      return httpJson('PUT', base, '/json/new?about:blank', token, 10000).then(function (r) {
        if (r.status === 200 && r.json && r.json.webSocketDebuggerUrl) return { page: r.json };
        return httpJson('GET', base, '/json/new?about:blank', token, 10000).then(function (r2) {
          if (r2.status === 200 && r2.json && r2.json.webSocketDebuggerUrl) return { page: r2.json };
          return { page: null, status: r.status + '/' + r2.status };
        });
      });
    }).then(function (r) {
      if (r.page) {
        session.mode = 'page-ws'; session.pageId = r.page.id;
        return cdp.connect(wsUrlFor(r.page.webSocketDebuggerUrl), { headers: headers, callTimeoutMs: CALL_TIMEOUT_MS }).then(function (c) { session.client = c; });
      }
      // Target-domain path over the browser endpoint
      return httpJson('GET', base, '/json/version', token, 5000).then(function (v) {
        if (!v.json || !v.json.webSocketDebuggerUrl) { var e = new Error('OBSCURA_NO_PAGE: /json/new answered ' + r.status + ' and no browser WebSocket is advertised'); e.code = 'OBSCURA_NO_PAGE'; throw e; }
        return cdp.connect(wsUrlFor(v.json.webSocketDebuggerUrl), { headers: headers, callTimeoutMs: CALL_TIMEOUT_MS });
      }).then(function (c) {
        session.client = c; session.mode = 'target-flat';
        return c.send('Target.createTarget', { url: 'about:blank' });
      }).then(function (t) {
        session.pageId = t.targetId;
        return session.client.send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      }).then(function (a) { session.sessionId = a.sessionId; });
    }).then(function () {
      var c = session.client, sid = session.sessionId;
      return c.send('Page.enable', {}, sid).then(function () { return c.send('Runtime.enable', {}, sid); }).catch(function () { /* some engines enable implicitly */ });
    }).then(function () { return session; }, function (e) {
      return close(session).then(function () { throw e; });
    });
  }

  function evaluate(session, expression) {
    return session.client.send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true }, session.sessionId).then(function (r) {
      if (r.exceptionDetails) throw new Error('CDP_EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'evaluation threw'));
      return r.result ? r.result.value : undefined;
    });
  }

  function navigate(session, url) {
    var c = session.client, sid = session.sessionId;
    var loaded = c.waitFor('Page.loadEventFired', navTimeout, function (p, s) { return !sid || s === sid || s === undefined; });
    return c.send('Page.navigate', { url: url }, sid, navTimeout).then(function (r) {
      if (r.errorText) { var e = new Error('NAVIGATE_FAILED: ' + r.errorText); e.code = 'NAVIGATE_FAILED'; throw e; }
      return loaded;
    }, function (err) {
      throw navigationError(err);
    }).then(function (fired) {
      if (fired) return;
      // Fall back to polling readyState — an engine may not emit the event.
      var until = Date.now() + Math.min(navTimeout, 10000);
      function poll() {
        return evaluate(session, 'document.readyState').then(function (s) {
          if (s === 'complete' || s === 'interactive' || Date.now() > until) return;
          return new Promise(function (res) { setTimeout(res, 250); }).then(poll);
        });
      }
      return poll();
    }).then(function () {
      return evaluate(session, 'JSON.stringify({href: location.href, title: document.title, readyState: document.readyState})');
    }).then(function (s) { var o = JSON.parse(s || '{}'); return { final_url: o.href || url, title: o.title || '', ready_state: o.readyState || null }; });
  }

  // Where the page is now (after a click, a redirect, a script) — no navigation.
  function pageState(session) {
    return evaluate(session, 'JSON.stringify({href: location.href, title: document.title, readyState: document.readyState})').then(function (s) {
      var o = JSON.parse(s || '{}'); return { final_url: o.href || '', title: o.title || '', ready_state: o.readyState || null };
    });
  }

  // click(session, { selector, settleMs }) — a DOM click on the first match.
  // Measured on Obscura 0.2.3 (2026-09-29): an anchor's click() runs the
  // navigation it starts to completion before Runtime.evaluate answers, and the
  // lifecycle events arrive together afterwards; a script-scheduled navigation
  // can start later, so a bounded settle window listens for it.
  function click(session, opts) {
    opts = opts || {};
    var c = session.client, sid = session.sessionId;
    var settle = Math.max(0, Math.min(Number(opts.settleMs) || CLICK_SETTLE_MS, 10000));
    var navigated = false;
    var offNav = c.on('Page.frameNavigated', function (p, s) { if (!sid || s === sid || s === undefined) navigated = true; });
    var loaded = c.waitFor('Page.loadEventFired', settle + CLICK_ACTION_MS, function (p, s) { return !sid || s === sid || s === undefined; });
    var expr = '(function(){var e=document.querySelector(' + JSON.stringify(opts.selector) + ');' +
      'if(!e) return JSON.stringify({found:false});' +
      'if(e.scrollIntoView) e.scrollIntoView({block:"center"});' +
      'e.click(); return JSON.stringify({found:true,tag:String(e.tagName||"").toLowerCase()});})()';
    return c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid, CLICK_ACTION_MS + navTimeout).then(function (r) {
      if (r.exceptionDetails) throw new Error('CDP_EVAL: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text || 'click threw'));
      var o = JSON.parse((r.result && r.result.value) || '{"found":false}');
      if (!o.found) { var e = new Error('CLICK_TARGET_NOT_FOUND: no element matches the selector'); e.code = 'CLICK_TARGET_NOT_FOUND'; throw e; }
      // Either the navigation already completed inside the evaluate (the event
      // is queued), or it starts within the settle window, or there is none.
      return Promise.race([loaded, new Promise(function (res) { setTimeout(function () { res(null); }, settle); })]).then(function (fired) {
        if (fired || !navigated) return fired;
        return c.waitFor('Page.loadEventFired', navTimeout);
      }).then(function () { return { method: 'dom-click', tag: o.tag, navigated: navigated }; });
    }, function (err) {
      throw navigationError(err);
    }).then(function (out) { offNav(); return out; }, function (err) { offNav(); throw err; });
  }

  function extract(session, opts) {
    return evaluate(session, pageText.expression(opts)).then(function (s) { return JSON.parse(s || '{"found":false}'); });
  }

  function screenshot(session, opts) {
    opts = opts || {};
    var format = opts.format === 'jpeg' ? 'jpeg' : 'png';
    var params = { format: format, captureBeyondViewport: false };
    if (format === 'jpeg') params.quality = 80;
    return session.client.send('Page.captureScreenshot', params, session.sessionId, 60000).then(function (r) {
      if (!r || !r.data) throw new Error('SCREENSHOT_EMPTY: the engine returned no image data');
      return { format: format, buffer: Buffer.from(r.data, 'base64') };
    });
  }

  function close(session) {
    if (!session) return Promise.resolve();
    var done = Promise.resolve();
    if (session.client && !session.client.isClosed()) {
      if (session.mode === 'target-flat' && session.pageId) done = session.client.send('Target.closeTarget', { targetId: session.pageId }, null, 5000).catch(function () { /* best effort */ });
      done = done.then(function () { try { session.client.close(); } catch (e) { /* closing */ } });
    }
    if (session.mode === 'page-ws' && session.pageId) {
      done = done.then(function () { return httpJson('GET', base, '/json/close/' + encodeURIComponent(session.pageId), token, 5000).catch(function () { /* best effort */ }); });
    }
    return done.then(function () { session.client = null; });
  }

  return {
    name: 'obscura',
    endpoint: redactUrl(base),
    probe: probe,
    probeUnauthenticated: probeUnauthenticated,
    open: open, navigate: navigate, pageState: pageState, click: click, extract: extract, screenshot: screenshot, evaluate: evaluate, close: close
  };
}

module.exports = { create: create, navigationError: navigationError, DEFAULT_CDP_URL: DEFAULT_CDP_URL };
