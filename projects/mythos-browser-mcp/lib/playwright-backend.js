'use strict';
// =====================================================
// MYTHOS Browser MCP — PlaywrightBackend (FALLBACK)
// projects/mythos-browser-mcp/lib/playwright-backend.js
//
// Used only when the primary (Obscura) cannot open a session. Playwright is
// NOT a project dependency: the module is resolved from MYTHOS_PLAYWRIGHT_MODULE,
// then `playwright`, then `playwright-core`, from this process's resolution
// paths. When the module or a launchable Chromium is absent the backend
// reports BLOCKED with the exact reason — it never claims a launch it did
// not make.
// =====================================================
var NAV_TIMEOUT_MS = 30000;

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
    }).then(function (ctx) { session.context = ctx; return ctx.newPage(); })
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
    }).catch(function (err) { var e = new Error('NAVIGATE_FAILED: ' + String(err && err.message || err).slice(0, 300)); e.code = 'NAVIGATE_FAILED'; throw e; });
  }

  function extract(session, opts) {
    opts = opts || {};
    var selector = typeof opts.selector === 'string' && opts.selector.length <= 256 ? opts.selector : null;
    var mode = opts.mode === 'html' ? 'html' : 'text';
    var max = Math.max(256, Math.min(Number(opts.max_chars) || 20000, 200000));
    return session.page.evaluate(function (a) {
      var el = a.selector ? document.querySelector(a.selector) : (document.body || document.documentElement);
      if (!el) return { found: false };
      var s = (a.mode === 'html' ? el.outerHTML : (el.innerText !== undefined ? el.innerText : el.textContent)) || '';
      return { found: true, chars: s.length, text: s.slice(0, a.max), truncated: s.length > a.max, title: document.title, href: location.href };
    }, { selector: selector, mode: mode, max: max });
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

  return { name: 'playwright', availability: availability, open: open, navigate: navigate, extract: extract, screenshot: screenshot, evaluate: evaluate, close: close };
}

module.exports = { create: create, resolveModule: resolveModule };
