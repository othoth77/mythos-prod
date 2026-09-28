'use strict';
// =====================================================
// MYTHOS Browser MCP — adapter policy, backends, URL gate, stdio protocol
// tests/mythos-browser-mcp-test.js
//
// Offline and deterministic: the Obscura endpoint is tests/support/fake-cdp-server.js
// (bearer-protected HTTP + a real RFC 6455 WebSocket), so the REAL backend,
// REAL adapter and REAL server.js run end to end without a browser on the
// host. Playwright is expected to be ABSENT here: the fallback must report
// BLOCKED with the exact reason, never a phantom PASS.
// =====================================================
var assert = require('assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var ROOT = path.join(__dirname, '..');
var MCP = path.join(ROOT, 'projects', 'mythos-browser-mcp');
var fake = require('./support/fake-cdp-server');
var urlPolicy = require(path.join(MCP, 'lib', 'url-policy'));
var adapterLib = require(path.join(MCP, 'lib', 'browser-adapter'));
var obscuraLib = require(path.join(MCP, 'lib', 'obscura-backend'));
var playwrightLib = require(path.join(MCP, 'lib', 'playwright-backend'));
var server = require(path.join(MCP, 'server'));

var pass = 0, fail = 0, queue = [];
function t(name, fn) { queue.push(function () { return Promise.resolve().then(fn).then(function () { pass++; console.log('ok - ' + name); }, function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }); }); }
var TOKEN = 'a'.repeat(40);
var ART = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-art-'));
var envBase = { HOME: os.homedir(), MYTHOS_BROWSER_ARTIFACTS: ART };

// ---------------------------------------------------------------- A. URL policy
t('URL policy: only public http(s) without credentials passes', function () {
  assert.ok(urlPolicy.check('https://example.com/x?y=1', {}).ok);
  assert.ok(urlPolicy.check('http://example.org', {}).ok);
  ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@example.com', 'https://localhost/', 'https://foo.localhost/',
   'http://127.0.0.1:9222/json', 'http://10.0.60.1/', 'http://169.254.169.254/latest', 'http://100.78.7.10/', 'http://192.168.1.1/', 'http://172.16.0.1/',
   'http://[::1]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'http://haddad/', 'http://printer.local/', 'http://x.internal/', '', 'not a url'
  ].forEach(function (u) { var r = urlPolicy.check(u, {}); assert.strictEqual(r.ok, false, u + ' must be refused'); assert.ok(r.code && r.reason, u + ' names a code+reason'); });
});
t('URL policy: allow-list narrows, deny-list wins, suffix rules match subdomains', function () {
  var env = { MYTHOS_BROWSER_ALLOWED_HOSTS: 'example.com,.zoom.us' };
  assert.ok(urlPolicy.check('https://example.com/', env).ok);
  assert.ok(urlPolicy.check('https://us02web.zoom.us/j/1', env).ok);
  assert.strictEqual(urlPolicy.check('https://www.example.com/', env).code, 'URL_NOT_ALLOWED');
  assert.strictEqual(urlPolicy.check('https://evil.com/', env).code, 'URL_NOT_ALLOWED');
  var env2 = { MYTHOS_BROWSER_DENIED_HOSTS: '.example.com', MYTHOS_BROWSER_ALLOWED_HOSTS: '.example.com' };
  assert.strictEqual(urlPolicy.check('https://a.example.com/', env2).code, 'URL_DENIED_HOST');
});

// ---------------------------------------------------------------- B. Obscura backend over the fake CDP
var srv;
t('fake CDP server starts (bearer-protected)', function () { return fake.start({ token: TOKEN, pages: { 'https://example.com/': { title: 'Example Domain', text: 'Example Domain\nThis domain is for use in illustrative examples.', href: 'https://example.com/' } } }).then(function (s) { srv = s; }); });
t('ObscuraBackend refuses a non-loopback CDP endpoint', function () {
  assert.throws(function () { obscuraLib.create({ env: { OBSCURA_CDP_URL: 'http://10.0.0.5:9222', OBSCURA_CDP_TOKEN: TOKEN } }); }, /must be loopback/);
});
t('ObscuraBackend: unauthenticated probe is refused, authenticated probe passes and never returns the token', function () {
  var b = obscuraLib.create({ env: { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: TOKEN } });
  return b.probeUnauthenticated().then(function (r) { assert.strictEqual(r.status, 401); return b.probe(); }).then(function (p) {
    assert.strictEqual(p.ok, true); assert.strictEqual(p.product, 'FakeObscura/0.2.3');
    assert.strictEqual(JSON.stringify(p).indexOf(TOKEN), -1, 'token never in the probe result');
  });
});
t('ObscuraBackend: wrong token -> OBSCURA_UNAUTHORIZED; no server -> OBSCURA_UNREACHABLE', function () {
  var bad = obscuraLib.create({ env: { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: 'b'.repeat(40) } });
  var none = obscuraLib.create({ env: { OBSCURA_CDP_URL: 'http://127.0.0.1:9', OBSCURA_CDP_TOKEN: TOKEN } });
  return bad.probe().then(function (p) { assert.strictEqual(p.code, 'OBSCURA_UNAUTHORIZED'); return none.probe(); }).then(function (p) { assert.strictEqual(p.code, 'OBSCURA_UNREACHABLE'); });
});
t('ObscuraBackend: open -> navigate -> extract -> screenshot -> close over a real WebSocket, page closed afterwards', function () {
  var b = obscuraLib.create({ env: { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: TOKEN } });
  var s;
  var from = srv.seen.length;
  return b.open().then(function (sess) { s = sess; assert.strictEqual(s.mode, 'page-ws'); return b.navigate(s, 'https://example.com/'); })
    .then(function (nav) { assert.strictEqual(nav.title, 'Example Domain'); assert.strictEqual(nav.final_url, 'https://example.com/'); return b.extract(s, { selector: 'h1' }); })
    .then(function (x) { assert.strictEqual(x.found, true); assert.strictEqual(x.text, 'Example Domain'); return b.extract(s, { max_chars: 300 }); })
    .then(function (x) { assert.ok(/illustrative/.test(x.text)); return b.screenshot(s, {}); })
    .then(function (shot) { assert.strictEqual(shot.format, 'png'); assert.strictEqual(shot.buffer.slice(1, 4).toString(), 'PNG'); return b.close(s); })
    .then(function () {
      var mine = srv.seen.slice(from);
      assert.ok(mine.some(function (e) { return e.closed; }), 'the page was closed');
      assert.ok(mine.filter(function (e) { return e.auth; }).every(function (e) { return e.auth === 'bearer'; }), 'every HTTP/WS request carried the bearer');
      var methods = srv.seen.map(function (e) { return e.method; }).filter(Boolean);
      assert.ok(methods.indexOf('Page.navigate') !== -1 && methods.indexOf('Page.captureScreenshot') !== -1);
    });
});
t('ObscuraBackend: Target-domain path when /json/new is absent', function () {
  var s2;
  return fake.start({ token: TOKEN, mode: 'target' }).then(function (srv2) {
    s2 = srv2;
    var b = obscuraLib.create({ env: { OBSCURA_CDP_URL: srv2.url, OBSCURA_CDP_TOKEN: TOKEN } });
    var sess;
    return b.open().then(function (x) { sess = x; assert.strictEqual(sess.mode, 'target-flat'); assert.ok(sess.sessionId); return b.navigate(sess, 'https://example.org/'); })
      .then(function (nav) { assert.strictEqual(nav.final_url, 'https://example.org/'); return b.close(sess); })
      .then(function () { assert.ok(s2.seen.some(function (e) { return e.method === 'Target.closeTarget'; })); return s2.close(); });
  });
});

// ---------------------------------------------------------------- C. Playwright fallback is honest
t('PlaywrightBackend reports BLOCKED with the exact reason when the module is absent (never a phantom PASS)', function () {
  var b = playwrightLib.create({ env: {} });
  var a = b.availability();
  if (a.available) { console.log('  (playwright IS installed on this host: ' + a.module_id + ')'); return; }
  assert.strictEqual(a.available, false); assert.ok(/MODULE_NOT_FOUND/.test(a.reason), a.reason);
  return b.open().then(function () { throw new Error('must not open'); }, function (e) { assert.strictEqual(e.code, 'PLAYWRIGHT_UNAVAILABLE'); });
});

// ---------------------------------------------------------------- D. adapter policy
t('BrowserAdapter: policy is primary=obscura, fallback=playwright; status() says who would serve and why', function () {
  assert.deepStrictEqual(adapterLib.ORDER, ['obscura', 'playwright']);
  var a = adapterLib.createAdapter({ env: Object.assign({}, envBase, { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: TOKEN }) });
  return a.status().then(function (st) {
    assert.deepStrictEqual(st.policy, { primary: 'obscura', fallback: 'playwright' });
    assert.strictEqual(st.primary.ok, true);
    assert.ok(st.fallback.status === 'BLOCKED' || st.fallback.status === 'AVAILABLE');
    if (st.fallback.status === 'BLOCKED') assert.ok(/MODULE_NOT_FOUND|not resolvable/.test(st.fallback.detail));
  });
});
t('BrowserAdapter: refused URL reaches no backend at all', function () {
  var a = adapterLib.createAdapter({ env: Object.assign({}, envBase, { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: TOKEN }) });
  var before = srv.seen.length;
  return a.navigate({ url: 'http://127.0.0.1:8130/tasks' }).then(function () { throw new Error('must refuse'); }, function (e) {
    assert.strictEqual(e.code, 'URL_POLICY'); assert.strictEqual(srv.seen.length, before, 'no request was made');
  });
});
t('BrowserAdapter: navigate/extract/screenshot through the primary, result names the backend, screenshot lands as a 0600 file', function () {
  var a = adapterLib.createAdapter({ env: Object.assign({}, envBase, { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: TOKEN }) });
  return a.navigate({ url: 'https://example.com' }).then(function (r) {
    assert.strictEqual(r.backend, 'obscura'); assert.strictEqual(r.fallback_reason, null); assert.strictEqual(r.title, 'Example Domain');
    return a.extract({ url: 'https://example.com/', selector: 'h1' });
  }).then(function (r) { assert.strictEqual(r.text, 'Example Domain'); assert.strictEqual(r.backend, 'obscura'); return a.screenshot({ url: 'https://example.com/', inline: true }); })
    .then(function (r) {
      assert.strictEqual(r.format, 'png'); assert.ok(r.bytes > 0); assert.ok(fs.existsSync(r.path));
      assert.strictEqual((fs.statSync(r.path).mode & 0o777), 0o600); assert.ok(r.base64 && Buffer.from(r.base64, 'base64').length === r.bytes);
      assert.strictEqual(r.path.indexOf(ART), 0, 'artifact under the configured directory');
    });
});
t('BrowserAdapter: primary down -> fallback attempted -> fallback BLOCKED is reported with both reasons (no silent PASS)', function () {
  var a = adapterLib.createAdapter({ env: Object.assign({}, envBase, { OBSCURA_CDP_URL: 'http://127.0.0.1:9', OBSCURA_CDP_TOKEN: TOKEN }) });
  return a.navigate({ url: 'https://example.com/' }).then(function (r) {
    // only reachable when playwright + chromium ARE installed on this host
    assert.strictEqual(r.backend, 'playwright'); assert.ok(/obscura unavailable/.test(r.fallback_reason));
  }, function (e) {
    assert.strictEqual(e.code, 'BROWSER_NO_BACKEND');
    assert.strictEqual(e.attempts.length, 2); assert.strictEqual(e.attempts[0].backend, 'obscura'); assert.strictEqual(e.attempts[1].backend, 'playwright');
    assert.ok(/OBSCURA_UNREACHABLE/.test(e.attempts[0].reason)); assert.ok(/PLAYWRIGHT_(UNAVAILABLE|LAUNCH_FAILED)/.test(e.attempts[1].reason));
  });
});
t('BrowserAdapter: fallback is used when the primary cannot open (injected backends)', function () {
  var calls = [];
  var fakePrimary = { name: 'obscura', probe: function () { return Promise.resolve({ ok: false, code: 'X', reason: 'down' }); }, open: function () { calls.push('obscura'); return Promise.reject(new Error('OBSCURA_UNREACHABLE: down')); }, close: function () { return Promise.resolve(); } };
  var fakeFallback = { name: 'playwright', availability: function () { return { available: true, module_id: 'fake' }; }, open: function () { calls.push('playwright'); return Promise.resolve({}); },
    navigate: function () { return Promise.resolve({ final_url: 'https://example.com/', title: 'T' }); }, close: function () { calls.push('close'); return Promise.resolve(); } };
  var a = adapterLib.createAdapter({ env: envBase, backends: { obscura: fakePrimary, playwright: fakeFallback } });
  return a.navigate({ url: 'https://example.com/' }).then(function (r) {
    assert.strictEqual(r.backend, 'playwright'); assert.ok(/obscura unavailable/.test(r.fallback_reason)); assert.deepStrictEqual(calls, ['obscura', 'playwright', 'close']);
  });
});

// ---------------------------------------------------------------- E. the stdio server
t('server.js: exactly three tools, no evaluate/click/type/raw CDP, additionalProperties false', function () {
  assert.deepStrictEqual(server.TOOLS.map(function (x) { return x.name; }), ['navigate', 'extract', 'screenshot']);
  server.TOOLS.forEach(function (x) { assert.strictEqual(x.inputSchema.additionalProperties, false); assert.deepStrictEqual(x.inputSchema.required, ['url']); });
  var src = fs.readFileSync(path.join(MCP, 'server.js'), 'utf8');
  assert.ok(!/evaluate|click|type_text|cdp_send|Runtime\./.test(src.replace(/\/\/.*$/gm, '')), 'no scripting surface in the server');
});
t('server.js over stdio: initialize, tools/list, refused URL is a tool error, real navigate through the fake Obscura, token never leaks', function () {
  var env = Object.assign({}, process.env, envBase, { OBSCURA_CDP_URL: srv.url, OBSCURA_CDP_TOKEN: TOKEN });
  var child = cp.spawn(process.execPath, [path.join(MCP, 'server.js')], { env: env, stdio: ['pipe', 'pipe', 'pipe'] });
  var out = '';
  child.stdout.on('data', function (d) { out += d; });
  var reqs = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'navigate', arguments: { url: 'http://169.254.169.254/' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'extract', arguments: { url: 'https://example.com/', selector: 'h1' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'screenshot', arguments: { url: 'https://example.com/', evil: 1 } } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'screenshot', arguments: { url: 'https://example.com/' } } },
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'evaluate', arguments: { url: 'https://example.com/' } } }
  ];
  child.stdin.write(reqs.map(function (r) { return JSON.stringify(r); }).join('\n') + '\n');
  child.stdin.end();
  return new Promise(function (resolve, reject) { child.on('exit', resolve); child.on('error', reject); }).then(function () {
    var lines = out.trim().split('\n').map(function (l) { return JSON.parse(l); });
    var by = {}; lines.forEach(function (l) { by[l.id] = l; });
    assert.strictEqual(by[1].result.serverInfo.name, 'mythos-browser-mcp');
    assert.strictEqual(by[2].result.tools.length, 3);
    var r3 = JSON.parse(by[3].result.content[0].text); assert.strictEqual(by[3].result.isError, true); assert.strictEqual(r3.code, 'URL_POLICY');
    var r4 = JSON.parse(by[4].result.content[0].text); assert.strictEqual(r4.ok, true); assert.strictEqual(r4.text, 'Example Domain'); assert.strictEqual(r4.backend, 'obscura');
    var r5 = JSON.parse(by[5].result.content[0].text); assert.strictEqual(r5.code, 'ARGS_UNKNOWN');
    var r6 = JSON.parse(by[6].result.content[0].text); assert.strictEqual(r6.ok, true); assert.ok(r6.sha256 && r6.path);
    var r7 = JSON.parse(by[7].result.content[0].text); assert.strictEqual(r7.code, 'TOOL_UNKNOWN');
    assert.strictEqual(out.indexOf(TOKEN), -1, 'token never on stdout');
  });
});
t('redaction: an error message carrying the token or a token-shaped string is scrubbed', function () {
  process.env.OBSCURA_CDP_TOKEN = TOKEN;
  try { assert.strictEqual(server.redactText('failed with ' + TOKEN + ' and deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'), 'failed with <redacted> and <redacted>'); }
  finally { delete process.env.OBSCURA_CDP_TOKEN; }
});
t('fake CDP server stops', function () { return srv.close(); });

queue.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(ART, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
});
