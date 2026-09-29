#!/usr/bin/env node
// =====================================================
// MYTHOS Browser MCP — runtime smoke (run ON the browser host)
// projects/mythos-browser-mcp/bin/browser-smoke.js [url] [--click <selector>] [--full] [--require-backend obscura|playwright]
//
// Direct check of the runtime beneath the MCP server: adapter status
// (which backend would serve, why the other would not), then navigate,
// extract and screenshot through the adapter, printing a JSON verdict per
// step. Reads OBSCURA_CDP_TOKEN from the environment (source the 0600 env
// file first); prints no secret. Exit 0 only when every step passed.
//
// --full adds the runtime gate the owner's order of 2026-09-29 names, each
// measured rather than inferred: the CDP endpoint refuses no token AND a wrong
// token and accepts the right one; Playwright (MYTHOS_PLAYWRIGHT_MODULE)
// connects to Obscura over CDP with the bearer, creates a page, navigates,
// reads the DOM, screenshots, clicks `--click <selector>` (default `a`) and
// disconnects; and afterwards no page is left open on the runtime. The click
// is a HOST-SIDE runtime check of the engine only: no task can reach it — the
// governed tool surface is read-only (owner decision 2026-09-29).
// --require-backend fails the run when a step was served by any other backend
// (so a silent fallback cannot pass a primary-path check, and vice versa).
// =====================================================
'use strict';
var path = require('path');
var http = require('http');
var adapterLib = require(path.join(__dirname, '..', 'lib', 'browser-adapter'));

var argv = process.argv.slice(2);
function flag(name) { var i = argv.indexOf(name); if (i === -1) return null; var v = argv[i + 1]; argv.splice(i, 2); return v; }
var full = argv.indexOf('--full') !== -1; if (full) argv.splice(argv.indexOf('--full'), 1);
var clickSel = flag('--click') || 'a';
var requireBackend = flag('--require-backend');
var url = argv[0] || 'https://example.com/';
var cdpUrl = process.env.OBSCURA_CDP_URL || 'http://127.0.0.1:9222';
var token = process.env.OBSCURA_CDP_TOKEN || '';

var a = adapterLib.createAdapter({ env: process.env });
var verdict = { url: url, adapter_version: adapterLib.VERSION, steps: [], status: 'PASS' };
function step(name, fn) {
  var t0 = Date.now();
  return Promise.resolve().then(fn).then(function (r) {
    var entry = { step: name, ok: true, ms: Date.now() - t0, result: r };
    if (requireBackend && r && r.backend && r.backend !== requireBackend) { entry.ok = false; entry.error = 'served by ' + r.backend + ', required ' + requireBackend; verdict.status = 'FAIL'; }
    verdict.steps.push(entry);
  }, function (e) {
    verdict.status = 'FAIL';
    verdict.steps.push({ step: name, ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 400), attempts: e && e.attempts || undefined });
  });
}
function check(cond, msg) { if (!cond) throw new Error(msg); }

function versionStatus(auth) {
  return new Promise(function (resolve) {
    var u = new URL('/json/version', cdpUrl);
    var headers = auth ? { Authorization: 'Bearer ' + auth } : {};
    var req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: headers, timeout: 5000 }, function (res) { res.resume(); resolve(res.statusCode); });
    req.on('timeout', function () { req.destroy(); resolve(null); });
    req.on('error', function () { resolve(null); });
    req.end();
  });
}
function listPages() {
  return new Promise(function (resolve) {
    var u = new URL('/json/list', cdpUrl);
    var req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { Authorization: 'Bearer ' + token }, timeout: 5000 }, function (res) {
      var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', function () { req.destroy(); resolve(null); });
    req.on('error', function () { resolve(null); });
    req.end();
  });
}

var pagesBefore = null;
var chain = Promise.resolve();
if (full) {
  chain = chain.then(function () { return listPages().then(function (p) { pagesBefore = Array.isArray(p) ? p.length : null; }); })
    .then(function () {
      return step('auth', function () {
        return Promise.all([versionStatus(null), versionStatus('invalid-' + Date.now()), versionStatus(token)]).then(function (s) {
          var r = { no_token: s[0], wrong_token: s[1], valid_token: s[2] };
          check(s[0] === 401 || s[0] === 403, 'no-token request answered ' + s[0]);
          check(s[1] === 401 || s[1] === 403, 'wrong-token request answered ' + s[1]);
          check(s[2] === 200, 'valid-token request answered ' + s[2]);
          return r;
        });
      });
    })
    .then(function () {
      return step('playwright_over_cdp', function () {
        var pw = require(process.env.MYTHOS_PLAYWRIGHT_MODULE || 'playwright-core');
        var browser, r = {};
        return pw.chromium.connectOverCDP(cdpUrl, { headers: { Authorization: 'Bearer ' + token }, timeout: 20000 }).then(function (b) {
          browser = b; r.connected = true; r.version = b.version();
          var ctx = b.contexts()[0];
          return (ctx ? Promise.resolve(ctx) : b.newContext());
        }).then(function (ctx) { return ctx.newPage(); }).then(function (page) {
          return page.goto(url, { waitUntil: 'load', timeout: 30000 }).then(function (resp) {
            r.http_status = resp ? resp.status() : null; r.url = page.url();
            return page.title();
          }).then(function (title) {
            r.title = title;
            return page.evaluate(function () { return (document.body && document.body.innerText || '').slice(0, 120); });
          }).then(function (text) {
            r.dom_text = text; check(text.length > 0, 'empty DOM text');
            return page.screenshot();
          }).then(function (buf) {
            r.screenshot_bytes = buf.length; check(buf.length > 1000, 'screenshot too small');
            return Promise.all([page.waitForEvent('framenavigated', { timeout: 15000 }).catch(function () {}), page.click(clickSel, { timeout: 10000 })]);
          }).then(function () {
            return page.waitForLoadState('load', { timeout: 15000 }).catch(function () {});
          }).then(function () {
            r.after_click_url = page.url(); r.url_changed = r.after_click_url !== r.url;
            check(r.url_changed, 'the click did not change the URL');
            return page.close();
          });
        }).then(function () { return browser.close(); }).then(function () { r.closed = true; return r; }, function (e) {
          if (browser) browser.close().catch(function () {});
          throw e;
        });
      });
    });
}
chain.then(function () { return step('status', function () { return a.status(); }); })
  .then(function () { return step('navigate', function () { return a.navigate({ url: url }); }); })
  .then(function () { return step('extract', function () { return a.extract({ url: url, max_chars: 400 }).then(function (r) { r.text = r.text.slice(0, 200); return r; }); }); })
  .then(function () { return step('screenshot', function () { return a.screenshot({ url: url }); }); })
  .then(function () {
    if (!full) return;
    return step('no_leaked_pages', function () {
      return new Promise(function (res) { setTimeout(res, 500); }).then(listPages).then(function (p) {
        var after = Array.isArray(p) ? p.length : null;
        check(after !== null, '/json/list unreadable');
        check(pagesBefore === null || after <= pagesBefore, 'pages open before ' + pagesBefore + ', after ' + after);
        return { pages_before: pagesBefore, pages_after: after };
      });
    });
  })
  .then(function () {
    var out = JSON.stringify(verdict, null, 2);
    if (token) out = out.split(token).join('<redacted>');
    console.log(out);
    process.exit(verdict.status === 'PASS' ? 0 : 1);
  });
