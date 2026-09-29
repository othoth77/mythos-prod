'use strict';
// =====================================================
// MYTHOS Browser MCP — PlaywrightBackend (FALLBACK)
// projects/mythos-browser-mcp/lib/playwright-backend.js
//
// Used when the primary (Obscura) cannot open a session, or when an operation
// fails or times out on it (BrowserAdapter 1.1.0). Playwright is
// NOT a project dependency: the module is resolved from MYTHOS_PLAYWRIGHT_MODULE,
// then `playwright`, then `playwright-core`, from this process's resolution
// paths. When the module or a launchable Chromium is absent the backend
// reports BLOCKED with the exact reason — it never claims a launch it did
// not make.
//
// OUTBOUND GUARD (1.1.0). Obscura refuses private fetches inside the engine;
// Chromium does not. Since the fallback now also serves operations the
// primary FAILED (not only ones it could not open), every request this
// Chromium makes — top-level, redirect, click target, subresource — passes
// the same URL policy first, and its host is resolved and refused when any
// address it resolves to is private/loopback/link-local. The allow-list is
// not applied to subresources (a page's CDN is not the page); the deny-list is.
// =====================================================
var dns = require('dns');
var net = require('net');
var urlPolicy = require('./url-policy');
var pageText = require('./page-text');

var NAV_TIMEOUT_MS = 30000;
var CLICK_SETTLE_MS = 1500;

// requestAllowed(url, env, cache) -> Promise<null | reason>
function requestAllowed(url, env, cache) {
  if (/^(data|blob|about):/i.test(url)) return Promise.resolve(null);
  var subEnv = { MYTHOS_BROWSER_DENIED_HOSTS: env.MYTHOS_BROWSER_DENIED_HOSTS || '' };
  var v = urlPolicy.check(url, subEnv);
  if (!v.ok) return Promise.resolve(v.code);
  if (net.isIP(v.host.replace(/^\[|\]$/g, ''))) return Promise.resolve(null);   // a literal was already judged
  if (cache[v.host] !== undefined) return Promise.resolve(cache[v.host]);
  return dns.promises.lookup(v.host, { all: true }).then(function (addrs) {
    var bad = addrs.some(function (a) { return a.family === 6 ? urlPolicy._ipv6Private(a.address) : urlPolicy._ipv4Private(a.address); });
    return (cache[v.host] = bad ? 'URL_PRIVATE_ADDRESS_RESOLVED' : null);
  }, function () { return (cache[v.host] = null); });   // unresolvable: Chromium will fail it on its own
}

function resolveModule(env) {
  var candidates = [];
  if (env.MYTHOS_PLAYWRIGHT_MODULE) candidates.push(env.MYTHOS_PLAYWRIGHT_MODULE);
  candidates.push('playwright', 'playwright-core');
  var errors = [];
  for (var i = 0; i < candidates.length; i++) {
    try { var m = require(candidates[i]); if (m && m.chromium) return { module: m, id: candidates[i] }; errors.push(candidates[i] + ': no chromium export'); }
    catch (e) { errors.push(candidates[i] + ': ' + String(e && e.code === 'MODULE_NOT_FOUND' ? 'MODULE_NOT_FOUND' : e.message).slice(0, 120)); }
  }
  return { module: null, reason: errors.join('; ') };
}

function create(cfg) {
  cfg = cfg || {};
  var env = cfg.env || process.env;
  var navTimeout = cfg.navTimeoutMs || NAV_TIMEOUT_MS;

  function availability() {
    var r = resolveModule(env);
    if (!r.module) return { available: false, reason: 'playwright module not resolvable (' + r.reason + ')' };
    return { available: true, module_id: r.id, version: r.module._version || null };
  }

  function open() {
    var r = resolveModule(env);
    if (!r.module) { var e = new Error('PLAYWRIGHT_UNAVAILABLE: ' + r.reason); e.code = 'PLAYWRIGHT_UNAVAILABLE'; return Promise.reject(e); }
    var session = { backend: 'playwright', browser: null, page: null, context: null, module_id: r.id };
    return r.module.chromium.launch({ headless: true, timeout: 30000 }).then(function (b) {
      session.browser = b;
      return b.newContext({ viewport: { width: 1280, height: 800 } });
    }).then(function (ctx) {
      session.context = ctx;
      session.blocked = [];
      var cache = Object.create(null);
      return ctx.route('**/*', function (route) {
        var u = route.request().url();
        return requestAllowed(u, env, cache).then(function (why) {
          if (!why) return route.continue();
          session.blocked.push({ code: why, url: u.slice(0, 200) });
          return route.abort('blockedbyclient');
        });
      }).then(function () { return ctx.newPage(); });
    })
      .then(function (p) { session.page = p; return session; })
      .catch(function (err) {
        // The exact host reason (missing shared libraries, executable not found) is the deliverable here.
        var e = new Error('PLAYWRIGHT_LAUNCH_FAILED: ' + String(err && err.message || err).split('\n').slice(0, 6).join(' | ').slice(0, 600));
        e.code = 'PLAYWRIGHT_LAUNCH_FAILED';
        return close(session).then(function () { throw e; });
      });
  }

  function navigate(session, url) {
    return session.page.goto(url, { waitUntil: 'load', timeout: navTimeout }).then(function (resp) {
      return session.page.title().then(function (title) {
        return { final_url: session.page.url(), title: title || '', http_status: resp ? resp.status() : null, ready_state: 'complete' };
      });
    }).catch(function (err) {
      var top = session.blocked && session.blocked.filter(function (x) { return x.url === String(url).slice(0, 200); })[0];
      if (top) { var p = new Error('URL_POLICY: the fallback guard refused ' + top.code); p.code = 'URL_POLICY'; throw p; }
      var e = new Error('NAVIGATE_FAILED: ' + String(err && err.message || err).slice(0, 300)); e.code = 'NAVIGATE_FAILED'; throw e;
    });
  }

  function pageState(session) {
    return session.page.title().then(function (title) {
      return { final_url: session.page.url(), title: title || '', ready_state: 'complete' };
    });
  }

  // click(session, { selector }) — a real mouse click (Playwright scrolls the
  // element into view and waits for it to be actionable), then any main-frame
  // navigation it starts is allowed to reach `load`.
  function click(session, opts) {
    opts = opts || {};
    var page = session.page;
    var settle = Math.max(0, Math.min(Number(opts.settleMs) || CLICK_SETTLE_MS, 10000));
    return page.$(opts.selector).then(function (el) {
      if (!el) { var e = new Error('CLICK_TARGET_NOT_FOUND: no element matches the selector'); e.code = 'CLICK_TARGET_NOT_FOUND'; throw e; }
      var nav = page.waitForEvent('framenavigated', { predicate: function (f) { return f === page.mainFrame(); }, timeout: settle + 5000 }).then(function () { return true; }, function () { return false; });
      return el.click({ timeout: 10000 }).then(function () {
        return Promise.race([nav, new Promise(function (res) { setTimeout(function () { res(false); }, settle); })]);
      }).then(function (navigated) {
        if (!navigated) return { method: 'mouse', navigated: false };
        return page.waitForLoadState('load', { timeout: navTimeout }).catch(function () {}).then(function () { return { method: 'mouse', navigated: true }; });
      });
    });
  }

  function extract(session, opts) {
    return session.page.evaluate(pageText.extractInPage, pageText.args(opts));
  }

  function screenshot(session, opts) {
    opts = opts || {};
    var format = opts.format === 'jpeg' ? 'jpeg' : 'png';
    return session.page.screenshot({ type: format, fullPage: false }).then(function (buf) { return { format: format, buffer: buf }; });
  }

  function evaluate(session, expression) { return session.page.evaluate(expression); }

  function close(session) {
    if (!session) return Promise.resolve();
    var p = Promise.resolve();
    if (session.context) p = p.then(function () { return session.context.close(); }).catch(function () {});
    if (session.browser) p = p.then(function () { return session.browser.close(); }).catch(function () {});
    return p.then(function () { session.page = null; session.context = null; session.browser = null; });
  }

  return { name: 'playwright', availability: availability, open: open, navigate: navigate, pageState: pageState, click: click, extract: extract, screenshot: screenshot, evaluate: evaluate, close: close };
}

module.exports = { create: create, resolveModule: resolveModule, requestAllowed: requestAllowed };
