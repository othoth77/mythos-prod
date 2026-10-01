'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — frontend rules
// projects/mythos-trading-control-center/tests/web-test.js
//
// What the interface IS, checked at source level — the things a browser test
// cannot see because they are about what must be ABSENT:
//
//   · the design tokens and fonts are the approved ones, byte for byte
//   · no colour, radius or looping animation is invented outside the tokens
//   · the pages are compatible with the strict Content-Security-Policy
//   · nothing builds HTML from a string, evaluates code, or stores a secret
//   · every application route has a page and a navigation entry
//   · the production build is complete, fingerprinted and deterministic
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var h = require('./helpers');
var serverMod = require(path.join(h.ROOT, 'server', 'server'));
var buildMod = require(path.join(h.ROOT, 'bin', 'build'));

var WEB = path.join(h.ROOT, 'web');
var REPO = path.join(h.ROOT, '..', '..');

function read(rel) { return fs.readFileSync(path.join(WEB, rel), 'utf8'); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function list(dir, re) {
  var out = [];
  (function walk(d, prefix) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      if (e.isDirectory()) return walk(path.join(d, e.name), prefix + e.name + '/');
      if (!re || re.test(e.name)) out.push(prefix + e.name);
    });
  })(dir, '');
  return out.sort();
}
/** Source with comments removed, so prose may mention what code may not do. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
}

var JS = list(path.join(WEB, 'assets', 'js'), /\.js$/).map(function (f) { return 'assets/js/' + f; });
var CSS = ['assets/base.css', 'assets/components.css', 'assets/app.css', 'assets/login.css'];
var HTML = ['index.html', 'login.html'];

// ---------------------------------------------------------------------------
// the design reference
// ---------------------------------------------------------------------------

test('the design tokens are the canonical file, byte for byte', function () {
  assert.equal(sha(path.join(WEB, 'assets', 'tokens.css')), sha(path.join(REPO, 'assets', 'brand', 'tokens', 'tokens.css')),
    'web/assets/tokens.css has drifted from assets/brand/tokens/tokens.css');
});

test('the fonts are the approved self-hosted files, byte for byte', function () {
  var fonts = list(path.join(WEB, 'assets', 'fonts'), /\.woff2$/);
  assert.deepEqual(fonts, ['archivo-expanded-600-latin.woff2', 'ibm-plex-mono-400-latin.woff2',
    'ibm-plex-sans-400-latin.woff2', 'ibm-plex-sans-500-latin.woff2', 'ibm-plex-sans-600-latin.woff2']);
  fonts.forEach(function (f) {
    assert.equal(sha(path.join(WEB, 'assets', 'fonts', f)), sha(path.join(REPO, 'assets', 'brand', 'fonts', f)), f);
  });
  var css = read('assets/fonts.css');
  fonts.forEach(function (f) { assert.ok(css.indexOf('fonts/' + f) !== -1, f + ' is not declared in fonts.css'); });
});

test('the Mythos mark is the adopted vector, not a redrawn one', function () {
  var master = fs.readFileSync(path.join(REPO, 'assets', 'brand', 'master', 'mythos-symbol-m.svg'), 'utf8');
  var d = /<path[^>]* d="([^"]+)"/.exec(master)[1];
  HTML.forEach(function (f) { assert.ok(read(f).indexOf(d) !== -1, f + ' does not carry the master path'); });
  assert.equal(sha(path.join(WEB, 'assets', 'favicon.svg')), sha(path.join(REPO, 'assets', 'brand', 'master', 'mythos-favicon.svg')));
});

test('no stylesheet invents a colour: every colour is a token', function () {
  CSS.forEach(function (f) {
    var text = code(read(f));
    assert.equal((text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length, 0, f + ' contains a hex colour literal');
    assert.ok(!/\b(hsl|hsla|rgb)\(/.test(text), f + ' contains a colour function');
    var rgba = text.match(/rgba\([^)]*\)/g) || [];
    if (f === 'assets/base.css') assert.deepEqual(rgba, ['rgba(11, 11, 10, 0.62)'], 'the scrim is the only derived colour, defined once');
    else assert.deepEqual(rgba, [], f + ' contains an rgba() literal');
  });
});

test('every radius is a design-system radius; a pill only for dots and badges', function () {
  CSS.forEach(function (f) {
    (code(read(f)).match(/border-radius:\s*[^;}]+/g) || []).forEach(function (decl) {
      assert.ok(/border-radius:\s*(var\(--mythos-radius-(none|control|card|overlay|pill)\)|0|50%)$/.test(decl.trim()), f + ': ' + decl);
    });
  });
});

test('nothing loops: there is no spinner and no infinite animation (MOTION-1)', function () {
  CSS.forEach(function (f) {
    var text = code(read(f));
    assert.ok(!/infinite/.test(text), f + ' has a looping animation');
    assert.ok(!/@keyframes\s+(spin|rotate|pulse|shimmer)/.test(text), f + ' defines a spinner or shimmer');
  });
});

test('focus is never removed without a replacement, and reduced motion is honoured', function () {
  var base = read('assets/base.css');
  assert.match(base, /:focus-visible\s*\{\s*outline: 2px solid var\(--mythos-focus-ring\)/);
  assert.match(base, /prefers-reduced-motion: reduce/);
  var comp = read('assets/components.css');
  assert.match(comp, /\.btn::after \{[^}]*inset: -2px 0/, 'the 40px button must extend its hit area to 44px (A-022)');
  assert.match(comp, /\.btn-compact::after \{[^}]*inset: -4px 0/, 'the 36px button must extend its hit area to 44px (A-022)');
  assert.match(comp, /forced-colors: active/);
});

test('links are never gold and badges carry a second, non-colour channel', function () {
  assert.match(read('assets/base.css'), /a \{ color: var\(--mythos-link\)/);
  var comp = read('assets/components.css');
  assert.match(comp, /\.badge::before/);
  assert.match(comp, /\.badge\.is-danger::before \{ border-radius: 0; \}/);
});

// ---------------------------------------------------------------------------
// CSP compatibility
// ---------------------------------------------------------------------------

test('the pages carry no inline script, inline style, or inline event handler', function () {
  HTML.forEach(function (f) {
    var text = read(f);
    assert.ok(!/<style[\s>]/i.test(text), f + ' has a <style> element');
    assert.ok(!/\sstyle\s*=/i.test(text), f + ' has an inline style attribute');
    assert.ok(!/\son[a-z]+\s*=/i.test(text), f + ' has an inline event handler');
    (text.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || []).forEach(function (tag) {
      assert.match(tag, /<script src="\/assets\/js\/[a-z/.-]+\.js"( defer)?><\/script>/, f + ' has an inline or foreign script: ' + tag.slice(0, 80));
    });
    assert.ok(!/javascript:/i.test(text));
  });
});

test('the pages load nothing from another origin', function () {
  HTML.concat(CSS, ['assets/fonts.css']).forEach(function (f) {
    var urls = read(f).match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s'")]*/gi) || [];
    urls = urls.filter(function (u) { return !/^https?:\/\/www\.w3\.org\//.test(u); });
    assert.deepEqual(urls, [], f + ' references an external URL');
  });
});

test('every script and stylesheet a page references exists', function () {
  HTML.forEach(function (f) {
    var refs = (read(f).match(/(?:href|src)="\/(assets\/[^"]+)"/g) || []).map(function (m) { return /"\/([^"]+)"/.exec(m)[1]; });
    assert.ok(refs.length >= 5);
    refs.forEach(function (r) { assert.ok(fs.existsSync(path.join(WEB, r)), f + ' references missing ' + r); });
  });
});

// ---------------------------------------------------------------------------
// script hygiene
// ---------------------------------------------------------------------------

test('no script builds HTML from a string or evaluates code', function () {
  var sinks = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|srcdoc)\b|\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/;
  JS.forEach(function (f) {
    var text = code(read(f));
    var m = sinks.exec(text);
    assert.equal(m, null, f + ' uses a string-to-code or string-to-HTML sink: ' + (m && m[0]));
    assert.ok(!/setAttribute\(\s*['"]style['"]/.test(text), f + ' sets an inline style attribute (blocked by the CSP)');
    assert.ok(!/setAttribute\(\s*['"]on[a-z]+['"]/.test(text), f + ' sets an inline event handler');
  });
});

test('the browser stores nothing but the theme preference', function () {
  JS.forEach(function (f) {
    var text = code(read(f));
    assert.ok(!/sessionStorage|indexedDB|document\.cookie/.test(text), f + ' touches session storage, IndexedDB or cookies');
    (text.match(/localStorage\.(?:setItem|getItem|removeItem)\(\s*['"]([^'"]+)['"]/g) || []).forEach(function (call) {
      assert.match(call, /['"]tcc\.theme['"]/, f + ' stores something other than the theme: ' + call);
    });
    if (/localStorage/.test(text)) assert.ok(/theme\.js$|app\.js$/.test(f), f + ' has no reason to use localStorage');
  });
});

test('every request goes to this origin\'s API through the one client', function () {
  JS.forEach(function (f) {
    var text = code(read(f));
    (text.match(/fetch\(\s*[^,)]+/g) || []).forEach(function (call) {
      assert.ok(/fetch\(\s*(path|'\/api\/auth\/login')/.test(call), f + ' calls fetch outside the API client: ' + call);
    });
    assert.ok(!/XMLHttpRequest|sendBeacon|importScripts/.test(text), f);
    (text.match(/new EventSource\(\s*([^)]+)\)/g) || []).forEach(function (call) {
      assert.match(call, /'\/api\/paper\/stream'/, f + ' opens an event stream somewhere unexpected: ' + call);
    });
    assert.ok(!/['"`]https?:\/\//.test(text.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')), f + ' contains an absolute URL');
  });
});

test('no script names a LIVE mode target', function () {
  JS.forEach(function (f) {
    var text = code(read(f));
    assert.ok(!/to:\s*['"]LIVE['"]/.test(text), f + ' can ask for LIVE');
    assert.ok(!/['"]LIVE['"]\s*[,\]]/.test(text) || /KINDS|NOT/.test(text), f + ' lists LIVE as a selectable value');
  });
});

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

test('every application route has a page and a navigation entry', function () {
  var all = JS.map(function (f) { return read(f); }).join('\n');
  var nav = /var NAV = \[([\s\S]*?)\];/.exec(read('assets/js/app.js'))[1];
  serverMod.APP_ROUTES.filter(function (r) { return r !== '/'; }).forEach(function (route) {
    var registered = new RegExp("TCC\\.page\\(\\s*'" + route + "'").test(all) || new RegExp("\\['" + route + "',").test(all);
    assert.ok(registered, 'no page is registered for ' + route);
    assert.ok(nav.indexOf("'" + route + "'") !== -1, route + ' is not in the navigation');
  });
  var inNav = nav.match(/'\/[a-z]+'/g).map(function (s) { return s.replace(/'/g, ''); });
  assert.equal(inNav.length, 16);
  inNav.forEach(function (r) { assert.ok(serverMod.APP_ROUTES.indexOf(r) !== -1, r + ' is in the navigation but the server does not serve it'); });
});

test('the shell states that LIVE is unavailable, as text, on every page', function () {
  var shell = read('index.html');
  assert.match(shell, /LIVE execution: not available/);
  assert.match(shell, /BACKTEST and PAPER only/);
  assert.match(read('login.html'), /BACKTEST and PAPER only/);
});

test('the shell has the landmarks and labels assistive technology needs', function () {
  var shell = read('index.html');
  assert.match(shell, /<html lang="en">/);
  assert.match(shell, /<main [^>]*id="view"/);
  assert.match(shell, /<nav [^>]*aria-label=/);
  assert.match(shell, /Skip to content/);
  assert.match(shell, /aria-live="polite"/);
  assert.match(shell, /name="viewport" content="width=device-width, initial-scale=1"/);
  var login = read('login.html');
  assert.match(login, /<label for="user">/);
  assert.match(login, /<label for="password">/);
  assert.match(login, /autocomplete="current-password"/);
});

// ---------------------------------------------------------------------------
// the production build
// ---------------------------------------------------------------------------

test('the build fingerprints every asset and leaves no dangling reference', function () {
  var out = h.tempDir('tcc-dist-');
  var m = buildMod.build({ out: out, commit: 'abcdef1' });
  assert.equal(m.built, true);
  assert.equal(m.commit, 'abcdef1');
  Object.keys(m.assets).forEach(function (k) {
    assert.match(m.assets[k], /\.[0-9a-f]{12}\.(css|js|woff2|svg)$/, k);
    assert.ok(fs.existsSync(path.join(out, m.assets[k])), m.assets[k] + ' was not written');
  });
  HTML.forEach(function (f) {
    var text = fs.readFileSync(path.join(out, f), 'utf8');
    var refs = (text.match(/(?:href|src)="\/(assets\/[^"]+)"/g) || []).map(function (x) { return /"\/([^"]+)"/.exec(x)[1]; });
    refs.forEach(function (r) {
      assert.match(r, /\.[0-9a-f]{12}\./, f + ' references an unfingerprinted asset ' + r);
      assert.ok(fs.existsSync(path.join(out, r)), f + ' references missing ' + r);
    });
  });
  var fontsCss = fs.readFileSync(path.join(out, m.assets['assets/fonts.css']), 'utf8');
  (fontsCss.match(/url\('([^']+)'\)/g) || []).forEach(function (u) {
    var rel = /url\('([^']+)'\)/.exec(u)[1];
    assert.ok(fs.existsSync(path.join(out, 'assets', rel)), 'fonts.css references missing ' + rel);
  });
  fs.rmSync(out, { recursive: true, force: true });
});

test('the build is deterministic', function () {
  var a = h.tempDir('tcc-dist-a-');
  var b = h.tempDir('tcc-dist-b-');
  var ma = buildMod.build({ out: a, commit: 'abcdef1' });
  var mb = buildMod.build({ out: b, commit: 'abcdef1' });
  assert.deepEqual(ma, mb);
  list(a).forEach(function (f) { assert.equal(sha(path.join(a, f)), sha(path.join(b, f)), f); });
  fs.rmSync(a, { recursive: true, force: true });
  fs.rmSync(b, { recursive: true, force: true });
});

test('a script that does not parse fails the build', function () {
  var src = h.tempDir('tcc-src-');
  fs.cpSync(WEB, src, { recursive: true });
  fs.writeFileSync(path.join(src, 'assets', 'js', 'core.js'), 'function ( {');
  assert.throws(function () { buildMod.build({ src: src, out: h.tempDir('tcc-out-') }); }, /does not parse/);
  fs.rmSync(src, { recursive: true, force: true });
});

test('a built site is served with immutable assets and an uncached shell', async function () {
  var out = h.tempDir('tcc-dist-serve-');
  var m = buildMod.build({ out: out, commit: 'abcdef1' });
  var S = await h.startApp({ webDir: out });
  var owner = await S.login('owner');
  var core = await owner.get('/' + m.assets['assets/js/core.js']);
  assert.equal(core.status, 200);
  assert.match(core.headers['cache-control'], /immutable/);
  assert.match(core.headers['content-type'], /javascript/);
  var shell = await owner.get('/dashboard');
  assert.equal(shell.status, 200);
  assert.equal(shell.headers['cache-control'], 'no-store');
  assert.ok(shell.text.indexOf(m.assets['assets/js/app.js']) !== -1);
  assert.equal((await owner.get('/build.json')).status, 404, 'the manifest is not a public document');
  var sys = (await owner.get('/api/system')).body.result;
  assert.equal(sys.deployment.webBuild.built, true);
  assert.equal(sys.deployment.webBuild.commit, 'abcdef1');

  // An unauthenticated browser can render the login page completely…
  var anon = S.client();
  var login = await anon.get('/login');
  var refs = (login.text.match(/(?:href|src)="\/(assets\/[^"]+)"/g) || []).map(function (x) { return /"(\/[^"]+)"/.exec(x)[1]; });
  for (var i = 0; i < refs.length; i++) assert.equal((await anon.get(refs[i])).status, 200, refs[i] + ' must be public');
  var font = Object.keys(m.assets).filter(function (k) { return /woff2$/.test(k); })[0];
  assert.equal((await anon.get('/' + m.assets[font])).status, 200, 'the login page\'s fonts must be public');
  // …and nothing of the application.
  assert.equal((await anon.get('/' + m.assets['assets/js/app.js'])).status, 401);
  assert.equal((await anon.get('/' + m.assets['assets/js/core.js'])).status, 401);
  assert.equal((await anon.get('/' + m.assets['assets/app.css'])).status, 401);
  await S.close();
  fs.rmSync(out, { recursive: true, force: true });
});

test('the unbuilt web directory is served the same way, uncached', async function () {
  var S = await h.startApp({ webDir: WEB });
  var owner = await S.login('owner');
  var core = await owner.get('/assets/js/core.js');
  assert.equal(core.status, 200);
  assert.equal(core.headers['cache-control'], 'no-cache');
  assert.ok(core.headers.etag);
  var again = await owner.get('/assets/js/core.js', { 'If-None-Match': core.headers.etag });
  assert.equal(again.status, 304);
  await S.close();
});
