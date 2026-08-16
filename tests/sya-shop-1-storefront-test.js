'use strict';
// =====================================================
// MYTHOS — SSANGYONG.AUTOS Stage SYA-SHOP-1 tests
// tests/sya-shop-1-storefront-test.js
//
// The storefront ratified as migration-plan §22 option 3. Like the SYA-API-1
// suite this is deliberately NOT offline: it serves the real assets from the
// real server and drives the real UI code against the live catalog.
//
// There is no browser here, so section 4 runs shop-ui.js inside a small DOM
// harness (~1 screen of code, at the bottom of this file) that implements only
// what the file actually touches. That is enough to prove the parts a static
// read cannot: that the UI calls the right endpoints, builds one card per
// returned product, formats the exact decimal price into French currency, and
// degrades correctly on a 404. It is NOT a browser and does not claim to be —
// layout, CSS and real event dispatch are out of its reach and are stated as
// untested rather than implied.
//
// Requires the same environment as the SYA-API-1 suite:
//   SSANGYONG_DB_HOST, SSANGYONG_DB_PORT, SSANGYONG_DB_USER,
//   SSANGYONG_DB_PASSWORD, SSANGYONG_DB_NAME
//
// Run with:
//   env SSANGYONG_DB_HOST=... ... node tests/sya-shop-1-storefront-test.js
// =====================================================

var http = require('http');
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var BASE = path.join(__dirname, '..');
var REF = path.join(BASE, 'projects', 'ssangyong-autos', 'reference');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var api = require(path.join(REF, 'api.js'));
var db = require(path.join(REF, 'db.js'));

var server, port, origin;

function request(method, requestPath) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ hostname: '127.0.0.1', port: port, path: requestPath, method: method }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, raw: body }); });
    });
    req.on('error', reject);
    req.end();
  });
}
function get(p) { return request('GET', p); }

(async function main() {
  var missing = db.REQUIRED_ENV.filter(function (n) { return !process.env[n]; });
  if (missing.length) {
    console.log('FATAL: missing required environment variable(s): ' + missing.join(', '));
    process.exit(1);
  }

  server = api.createServer();
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  port = server.address().port;
  origin = 'http://127.0.0.1:' + port;

  var html = fs.readFileSync(path.join(REF, 'shop.html'), 'utf8');
  var uiSrc = fs.readFileSync(path.join(REF, 'shop-ui.js'), 'utf8');

  console.log('\n1. Asset serving');
  var page = await get('/');
  ok(page.status === 200, 'GET / -> 200 (the storefront is served by the same process as the API)');
  ok(/text\/html/.test(page.headers['content-type']), 'GET / is served as HTML');
  ok(page.raw.indexOf('<title>SsangYong Parts') !== -1, 'Served HTML is the storefront shell');
  var css = await get('/shop.css');
  var js = await get('/shop-ui.js');
  ok(css.status === 200 && /text\/css/.test(css.headers['content-type']), 'GET /shop.css -> 200 text/css');
  ok(js.status === 200 && /javascript/.test(js.headers['content-type']), 'GET /shop-ui.js -> 200 javascript');
  ok((await get('/index.html')).status === 200, 'GET /index.html serves the same shell');

  var postRoot = await request('POST', '/');
  ok(postRoot.status === 405 && (postRoot.headers['allow'] || '').indexOf('GET') !== -1,
     'POST / -> 405 with Allow: GET — the storefront is as read-only as the API');

  console.log('\n2. Security headers on the storefront');
  ok(page.headers['x-content-type-options'] === 'nosniff', 'nosniff is set');
  ok(/frame-ancestors \'none\'/.test(page.headers['content-security-policy']), 'CSP forbids framing');
  ok(/script-src \'self\'/.test(page.headers['content-security-policy']), "CSP allows only same-origin scripts (no inline)");
  ok(/form-action \'none\'/.test(page.headers['content-security-policy']), 'CSP forbids form submission anywhere');
  ok(!/unsafe-inline|unsafe-eval/.test(page.headers['content-security-policy']), "CSP uses neither 'unsafe-inline' nor 'unsafe-eval'");

  // The CSP names exactly one remote origin. Prove from the live data that it
  // is both necessary and sufficient — if a future scrape introduces a second
  // image host, this fails instead of silently showing broken images.
  var hosts = await db.query("SELECT DISTINCT substring(image_url from '^https://[^/]+') AS host FROM sya_product_images");
  ok(hosts.rows.length === 1 && hosts.rows[0].host === 'https://autopart.tn',
     'Every live image URL is on https://autopart.tn — the single origin the CSP img-src allows');
  ok(api.SHOP_CSP.indexOf('img-src \'self\' https://autopart.tn') !== -1, 'CSP img-src names that origin and no other');

  console.log('\n3. HTML/JS contract — every element the UI drives exists in the shell');
  var idsInHtml = {};
  (html.match(/id="([^"]+)"/g) || []).forEach(function (m) { idsInHtml[m.slice(4, -1)] = true; });
  var idsUsed = (uiSrc.match(/getElementById\('([^']+)'\)/g) || []).map(function (m) { return m.slice("getElementById('".length, -2); });
  var uniqueUsed = idsUsed.filter(function (v, i) { return idsUsed.indexOf(v) === i; });
  var absent = uniqueUsed.filter(function (id) { return !idsInHtml[id]; });
  ok(uniqueUsed.length >= 20, 'The UI drives ' + uniqueUsed.length + ' distinct elements (sanity: the scan found them)');
  ok(absent.length === 0, 'Every getElementById target exists in shop.html' + (absent.length ? ' — missing: ' + absent.join(', ') : ''));

  // Regression guard for a real bug found by headless-browser review: the UI
  // hides views with the `hidden` property, but an author rule setting
  // `display` (.layout is grid, .paging is flex) beats the UA's
  // `[hidden] { display: none }`, leaving the catalogue and paging on screen
  // underneath a product page. The DOM harness in section 4 cannot catch this
  // — it sees the property set correctly and has no CSS cascade — so the
  // stylesheet is asserted directly instead.
  var cssSrc = fs.readFileSync(path.join(REF, 'shop.css'), 'utf8');
  ok(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(cssSrc),
     'shop.css forces [hidden] { display: none !important } so a display-setting class cannot defeat hiding a view');
  var displayClasses = (cssSrc.match(/^\.([\w-]+)[^{]*\{[^}]*display:/gm) || []).length;
  ok(displayClasses >= 2, 'Sanity: the stylesheet does set display on classes (' + displayClasses + '), so that guard is load-bearing');

  ok(!/ on[a-z]+\s*=\s*"/.test(html), 'shop.html contains no inline event handler attribute (required by the CSP)');
  ok(!/<script(?![^>]*\bsrc=)/.test(html), 'shop.html contains no inline <script> block (required by the CSP)');
  ok(/<html lang="fr">/.test(html), 'The document declares lang="fr" — the storefront is French');

  console.log('\n4. Live UI behaviour — shop-ui.js driven against the real catalog');
  var dom = makeDom(html, origin);
  vm.runInNewContext(uiSrc, dom.context, { filename: 'shop-ui.js' });
  await dom.settle();

  ok(dom.byId('state-message').textContent === '', 'After first render the status line is cleared (no error state)');
  ok(dom.byId('product-grid').children.length === 24,
     'The default catalogue renders one card per returned product (24 = the storefront page size)');
  ok(/346 pièces/.test(dom.byId('results-count').textContent),
     'Result count reports the full live catalog (346), including the 2 "updated" rows');
  ok(/pièces référencées/.test(dom.byId('footer-counts').textContent), 'Footer reports live counts from /api/health');
  // The harness starts every element empty, so this counts only what the UI
  // appended — the static "Tous les modèles" option from shop.html is not here.
  ok(dom.byId('filter-model').children.length === 17, 'Model filter is populated with all 17 live vehicle models');
  ok(dom.byId('filter-brands').children.length >= 1, 'Brand facet is populated');

  var firstCard = dom.byId('product-grid').children[0];
  var priceText = dom.textOf(firstCard, 'price');
  ok(/^[\d ]+,\d{2} DT$/.test(priceText),
     'Card price is formatted French-style from the exact decimal string, e.g. "' + priceText + '"');

  // Prove the formatted price is the database value and not a rounded float.
  var apiPage = JSON.parse((await get('/api/products?limit=24&offset=0')).raw);
  var expected = apiPage.products[0].price_tnd;
  ok(priceText.replace(/ /g, '').replace(',', '.').replace(' DT', '').replace('DT', '') === expected,
     'Displayed price is byte-identical to the NUMERIC(8,2) value (' + expected + ') — no float rounding');

  console.log('\n5. Live UI behaviour — product page');
  var uid = apiPage.products[0].product_uid;
  var productDom = makeDom(html, origin, '?p=' + encodeURIComponent(uid));
  vm.runInNewContext(uiSrc, productDom.context, { filename: 'shop-ui.js' });
  await productDom.settle();

  ok(productDom.byId('view-product').hidden === false, 'A ?p=<product_uid> URL renders the product view');
  ok(productDom.byId('product-title').textContent.length > 0, 'Product title is rendered');
  ok(productDom.byId('product-ref').textContent === apiPage.products[0].canonical_reference,
     'Rendered reference matches the API');
  ok(productDom.byId('product-fitment').children.length >= 1,
     'Vehicle compatibility table has at least one fitment row');
  ok(productDom.byId('product-specs').children.length >= 2,
     'Technical characteristics are rendered as term/definition pairs');
  ok(productDom.context.document.title.indexOf('SsangYong Parts') !== -1,
     'Document title is updated for the product page');

  var missingDom = makeDom(html, origin, '?p=' + encodeURIComponent('autopart.tn:0'));
  vm.runInNewContext(uiSrc, missingDom.context, { filename: 'shop-ui.js' });
  await missingDom.settle();
  ok(/n'existe pas|n’existe pas/.test(missingDom.byId('state-message').textContent),
     'An unknown product_uid shows a specific French message, not a raw HTTP error');
  ok(missingDom.byId('view-product').hidden === true, 'The product view stays hidden when the product does not exist');

  console.log('\n6. Source-level guarantees');
  var code = uiSrc.replace(/^\s*\/\/.*$/gm, '');
  ok(!/innerHTML/.test(code),
     'shop-ui.js never assigns innerHTML — scraped catalog text cannot become markup');
  ok(!/mysql|mariadb|catalog\.php|\/var\/www/i.test(code),
     'The storefront reaches no legacy system (migration plan §21 freeze, §22 option 3 as ratified)');
  ok(!/https?:\/\//.test(code.replace(/fetch\(path/, '')),
     'Every fetch is a same-origin relative path — no third-party endpoint is contacted');
  ok(!/localStorage|sessionStorage|document\.cookie/.test(code),
     'The storefront stores nothing in the browser — no cookie, no web storage');

  await new Promise(function (r) { server.close(r); });
  await db.closePool();

  console.log('\nStage SYA-SHOP-1 (storefront): ' + pass + ' passed, ' + fail + ' failed');
  console.log('NOT covered here (no browser): CSS layout, real event dispatch, image loading.');
  process.exit(fail ? 1 : 0);
})().catch(function (err) {
  console.log('FATAL: ' + err.stack);
  process.exit(1);
});

// ===========================================================================
// Minimal DOM harness
//
// Implements only what shop-ui.js touches. Element identity comes from the
// real shop.html (ids scraped from it), so a renamed or deleted element makes
// section 4 fail rather than quietly pass against an invented document.
// ===========================================================================
function makeDom(html, origin, search) {
  var pending = 0;

  function Element(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.attributes = {};
    this._text = '';
    this.className = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this._listeners = {};
    var self = this;
    this.classList = {
      toggle: function (name, on) {
        var set = self.className.split(/\s+/).filter(Boolean).filter(function (c) { return c !== name; });
        if (on) set.push(name);
        self.className = set.join(' ');
      }
    };
  }
  Object.defineProperty(Element.prototype, 'textContent', {
    get: function () {
      if (this.children.length === 0) return this._text;
      return this.children.map(function (c) { return c.textContent; }).join('');
    },
    set: function (v) { this._text = String(v); this.children = []; }
  });
  Object.defineProperty(Element.prototype, 'firstChild', {
    get: function () { return this.children.length ? this.children[0] : null; }
  });
  Element.prototype.appendChild = function (child) { this.children.push(child); return child; };
  Element.prototype.removeChild = function (child) {
    var i = this.children.indexOf(child);
    if (i !== -1) this.children.splice(i, 1);
    return child;
  };
  Element.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
  Element.prototype.getAttribute = function (k) { return k in this.attributes ? this.attributes[k] : null; };
  Element.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
  Element.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  Element.prototype.querySelectorAll = function (selector) {
    var want = String(selector).toUpperCase();
    var found = [];
    (function walk(n) {
      n.children.forEach(function (c) {
        if (c.tagName === want) found.push(c);
        walk(c);
      });
    })(this);
    return found;
  };

  var byId = {};
  (html.match(/id="([^"]+)"/g) || []).forEach(function (m) {
    var id = m.slice(4, -1);
    var e = new Element('div');
    e.id = id;
    byId[id] = e;
  });

  var document = {
    title: '',
    getElementById: function (id) { return byId[id] || null; },
    createElement: function (tag) { return new Element(tag); }
  };

  var location = { pathname: '/', search: search || '' };
  var window = {
    location: location,
    addEventListener: function () {},
    URLSearchParams: URLSearchParams
  };
  var history = {
    pushState: function (s, t, url) { applyUrl(url); },
    replaceState: function (s, t, url) { applyUrl(url); }
  };
  function applyUrl(url) {
    var i = String(url).indexOf('?');
    location.pathname = i === -1 ? String(url) : String(url).slice(0, i);
    location.search = i === -1 ? '' : String(url).slice(i);
  }

  // Count in-flight fetches so settle() can wait for the render chain rather
  // than sleeping for an arbitrary interval.
  function countedFetch(path, init) {
    pending++;
    return fetch(origin + path, init).finally(function () { pending--; });
  }

  var context = vm.createContext({
    document: document,
    window: window,
    history: history,
    location: location,
    fetch: countedFetch,
    URLSearchParams: URLSearchParams,
    console: console,
    Promise: Promise,
    Object: Object,
    Array: Array,
    Number: Number,
    String: String,
    Date: Date,
    Math: Math,
    JSON: JSON,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    setTimeout: setTimeout
  });

  return {
    context: context,
    byId: function (id) { return byId[id]; },
    // Depth-first search for the first descendant carrying a class.
    textOf: function (root, className) {
      var hit = null;
      (function walk(n) {
        if (hit) return;
        n.children.forEach(function (c) {
          if (hit) return;
          if (String(c.className).split(/\s+/).indexOf(className) !== -1) { hit = c; return; }
          walk(c);
        });
      })(root);
      return hit ? hit.textContent : null;
    },
    settle: async function () {
      // Drain the fetch chain: each resolved request may queue the next.
      for (var i = 0; i < 60; i++) {
        await new Promise(function (r) { setTimeout(r, 20); });
        if (pending === 0 && i > 2) return;
      }
    }
  };
}
