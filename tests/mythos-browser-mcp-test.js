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
t('server.js: exactly four tools (three reads + click), no evaluate/type/raw CDP, additionalProperties false', function () {
  assert.deepStrictEqual(server.TOOLS.map(function (x) { return x.name; }), ['navigate', 'extract', 'screenshot', 'click']);
  server.TOOLS.forEach(function (x) {
    assert.strictEqual(x.inputSchema.additionalProperties, false);
    assert.deepStrictEqual(x.inputSchema.required, x.name === 'click' ? ['url', 'selector'] : ['url']);
  });
  var click = server.TOOLS.filter(function (x) { return x.name === 'click'; })[0];
  assert.deepStrictEqual(Object.keys(click.inputSchema.properties).sort(), ['extract_selector', 'max_chars', 'selector', 'url'], 'click takes a selector, never text to type or a script');
  var src = fs.readFileSync(path.join(MCP, 'server.js'), 'utf8');
  assert.ok(!/evaluate|type_text|fill|press|cdp_send|Runtime\./.test(src.replace(/\/\/.*$/gm, '')), 'no scripting or typing surface in the server');
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
    assert.strictEqual(by[2].result.tools.length, 4);
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
// ---------------------------------------------------------------- F. the launcher (token file + non-secret fallback file)
var LAUNCHER = path.join(MCP, 'bin', 'mythos-browser-mcp.sh');
function launcherRun(setup) {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-launch-'));
  var repo = path.join(home, 'repo');
  fs.mkdirSync(path.join(repo, 'projects', 'mythos-browser-mcp'), { recursive: true });
  // The "server" prints the environment it was exec'd with — that is the whole assertion surface.
  fs.writeFileSync(path.join(repo, 'projects', 'mythos-browser-mcp', 'server.js'),
    "process.stdout.write(JSON.stringify({ tok: process.env.OBSCURA_CDP_TOKEN || null, url: process.env.OBSCURA_CDP_URL || null, pw: process.env.MYTHOS_PLAYWRIGHT_MODULE || null, ld: process.env.LD_LIBRARY_PATH || null, priv: process.env.OBSCURA_ALLOW_PRIVATE_NETWORK || null, art: process.env.MYTHOS_BROWSER_ARTIFACTS || null }));\n");
  fs.mkdirSync(path.join(home, '.config', 'obscura'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'mythos-browser'), { recursive: true });
  var s = setup(home) || {};
  var env = Object.assign({ PATH: process.env.PATH, HOME: home, MYTHOS_BROWSER_MCP_REPO: repo, OBSCURA_ALLOW_PRIVATE_NETWORK: '1' }, s.env || {});
  var r = cp.spawnSync('/usr/bin/env', ['bash', LAUNCHER], { env: env, encoding: 'utf8', timeout: 20000 });
  try { fs.rmSync(home, { recursive: true, force: true }); } catch (e) {}
  var body = null; try { body = JSON.parse(r.stdout); } catch (e) { body = null; }
  return { status: r.status, stderr: r.stderr || '', body: body };
}
t('launcher: the fallback env file reaches the server, the token file is loaded, private-network is unset, endpoint defaults to loopback', function () {
  var r = launcherRun(function (home) {
    fs.writeFileSync(path.join(home, '.config', 'obscura', 'cdp.env'), 'OBSCURA_CDP_TOKEN=' + TOKEN + '\n', { mode: 384 });
    fs.writeFileSync(path.join(home, '.config', 'mythos-browser', 'env'), 'MYTHOS_PLAYWRIGHT_MODULE=/opt/pw/node_modules/playwright-core\nLD_LIBRARY_PATH=/opt/pw/lib\n');
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.body, { tok: TOKEN, url: 'http://127.0.0.1:9222', pw: '/opt/pw/node_modules/playwright-core', ld: '/opt/pw/lib', priv: null, art: r.body && r.body.art });
  assert.ok(/\/\.local\/state\/mythos-browser\/artifacts$/.test(r.body.art), r.body.art);
});
t('launcher: a fallback file that tries to set OBSCURA_* is refused (exit 78) and the server never runs', function () {
  var r = launcherRun(function (home) {
    fs.writeFileSync(path.join(home, '.config', 'obscura', 'cdp.env'), 'OBSCURA_CDP_TOKEN=' + TOKEN + '\n', { mode: 384 });
    fs.writeFileSync(path.join(home, '.config', 'mythos-browser', 'env'), 'OBSCURA_CDP_URL=http://10.0.0.5:9222\n');
  });
  assert.strictEqual(r.status, 78, r.stderr); assert.strictEqual(r.body, null); assert.ok(/may not set OBSCURA_/.test(r.stderr), r.stderr);
});
t('launcher: a world-readable token file is refused (exit 78); no fallback file at all is fine', function () {
  var r = launcherRun(function (home) { fs.writeFileSync(path.join(home, '.config', 'obscura', 'cdp.env'), 'OBSCURA_CDP_TOKEN=' + TOKEN + '\n', { mode: 420 }); });
  assert.strictEqual(r.status, 78, r.stderr); assert.ok(/mode is 644/.test(r.stderr), r.stderr);
  var r2 = launcherRun(function (home) { fs.writeFileSync(path.join(home, '.config', 'obscura', 'cdp.env'), 'OBSCURA_CDP_TOKEN=' + TOKEN + '\n', { mode: 384 }); });
  assert.strictEqual(r2.status, 0, r2.stderr); assert.strictEqual(r2.body.pw, null); assert.strictEqual(r2.body.tok, TOKEN);
});

// ---------------------------------------------------------------- G. 1.1.0 — fallback on ANY engine failure, deadlines, classification, click
function stubBackend(name, behaviour, calls) {
  return {
    name: name,
    probe: function () { return Promise.resolve({ ok: true }); },
    availability: function () { return { available: true, module_id: 'stub' }; },
    open: function () { calls.push(name + ':open'); return behaviour.open ? behaviour.open() : Promise.resolve({ n: name }); },
    navigate: function (s, url) { calls.push(name + ':navigate'); return behaviour.navigate ? behaviour.navigate(url) : Promise.resolve({ final_url: url, title: name + ' page' }); },
    extract: function () { calls.push(name + ':extract'); return behaviour.extract ? behaviour.extract() : Promise.resolve({ found: true, text: 'from ' + name, chars: 9 }); },
    screenshot: function () { return Promise.resolve({ format: 'png', buffer: Buffer.from('x') }); },
    click: function () { calls.push(name + ':click'); return behaviour.click ? behaviour.click() : Promise.resolve({ method: 'stub' }); },
    pageState: function () { return Promise.resolve(behaviour.state || { final_url: 'https://example.com/next', title: 'Next' }); },
    close: function () { calls.push(name + ':close'); return Promise.resolve(); }
  };
}
function err(code, msg) { var e = new Error(code + ': ' + msg); e.code = code; return e; }

t('fallback: the primary OPENS but the operation fails (engine error) -> the same call is served by the fallback, both pages closed', function () {
  var calls = [];
  var a = adapterLib.createAdapter({ env: envBase, backends: {
    obscura: stubBackend('obscura', { extract: function () { return Promise.reject(new Error('CDP_CLOSED: socket hang up (Runtime.evaluate)')); } }, calls),
    playwright: stubBackend('playwright', {}, calls) } });
  return a.extract({ url: 'https://example.com/' }).then(function (r) {
    assert.strictEqual(r.backend, 'playwright'); assert.strictEqual(r.text, 'from playwright');
    assert.ok(/^obscura failed \(operation\): CDP_CLOSED/.test(r.fallback_reason), r.fallback_reason);
    assert.deepStrictEqual(calls, ['obscura:open', 'obscura:navigate', 'obscura:extract', 'obscura:close', 'playwright:open', 'playwright:navigate', 'playwright:extract', 'playwright:close']);
    assert.deepStrictEqual(r.attempts.map(function (x) { return [x.backend, x.ok, x.stage]; }), [['obscura', false, 'operation'], ['playwright', true, 'done']]);
  });
});
t('fallback: the primary HANGS -> the attempt deadline fires, its page is closed, the fallback serves the call', function () {
  var calls = [];
  var a = adapterLib.createAdapter({ env: envBase, attemptTimeoutMs: 200, backends: {
    obscura: stubBackend('obscura', { navigate: function () { return new Promise(function () {}); } }, calls),
    playwright: stubBackend('playwright', {}, calls) } });
  var t0 = Date.now();
  return a.navigate({ url: 'https://example.com/' }).then(function (r) {
    assert.strictEqual(r.backend, 'playwright'); assert.ok(Date.now() - t0 < 2000);
    assert.strictEqual(r.attempts[0].class, 'timeout'); assert.ok(/BROWSER_TIMEOUT/.test(r.fallback_reason), r.fallback_reason);
    assert.ok(calls.indexOf('obscura:close') !== -1, 'the hung page was closed');
  });
});
t('no fallback for what no engine can change: a selector that matches nothing is class input, tried ONCE', function () {
  var calls = [];
  var a = adapterLib.createAdapter({ env: envBase, backends: {
    obscura: stubBackend('obscura', { click: function () { return Promise.reject(err('CLICK_TARGET_NOT_FOUND', 'no element matches the selector')); } }, calls),
    playwright: stubBackend('playwright', {}, calls) } });
  return a.click({ url: 'https://example.com/', selector: '#nope' }).then(function () { throw new Error('must fail'); }, function (e) {
    assert.strictEqual(e.code, 'CLICK_TARGET_NOT_FOUND'); assert.strictEqual(adapterLib.classify(e), 'input');
    assert.ok(calls.every(function (c) { return c.indexOf('playwright') !== 0; }), 'the fallback never ran: ' + calls.join(','));
  });
});
t('classification when every engine fails: all open-failures -> BROWSER_NO_BACKEND; site failures -> NAVIGATE_FAILED; hangs -> BROWSER_TIMEOUT', function () {
  var down = function () { return Promise.reject(new Error('OBSCURA_UNREACHABLE: connect ECONNREFUSED')); };
  var siteDown = function () { return Promise.reject(err('NAVIGATE_FAILED', 'net::ERR_NAME_NOT_RESOLVED')); };
  var hang = function () { return new Promise(function () {}); };
  var mk = function (o, p, extra) { return adapterLib.createAdapter(Object.assign({ env: envBase, backends: { obscura: stubBackend('obscura', o, []), playwright: stubBackend('playwright', p, []) } }, extra || {})); };
  return mk({ open: down }, { open: down }).navigate({ url: 'https://example.com/' }).then(function () { throw new Error('x'); }, function (e) {
    assert.strictEqual(e.code, 'BROWSER_NO_BACKEND'); assert.strictEqual(e.attempts.length, 2);
    return mk({ navigate: siteDown }, { navigate: siteDown }).navigate({ url: 'https://example.com/' });
  }).then(function () { throw new Error('x'); }, function (e) {
    if (e.message === 'x') throw e;
    assert.strictEqual(e.code, 'NAVIGATE_FAILED'); assert.strictEqual(adapterLib.classify(e), 'target');
    return mk({ navigate: hang }, { navigate: hang }, { attemptTimeoutMs: 100 }).navigate({ url: 'https://example.com/' });
  }).then(function () { throw new Error('x'); }, function (e) {
    if (e.message === 'x') throw e;
    assert.strictEqual(e.code, 'BROWSER_TIMEOUT'); assert.deepStrictEqual(e.attempts.map(function (x) { return x.class; }), ['timeout', 'timeout']);
  });
});
t('Obscura error mapping: a network CDP error is NAVIGATE_FAILED; the engine\'s private-address refusal is URL_POLICY and is NEVER retried on the fallback', function () {
  var n = obscuraLib.navigationError(new Error('CDP_ERROR: Network error: Network error: https://x.invalid/: error sending request for url (Page.navigate)'));
  assert.strictEqual(n.code, 'NAVIGATE_FAILED');
  var p = obscuraLib.navigationError(new Error('CDP_ERROR: Network error: Network error: Access to private/internal IP address 10.0.0.5 is not allowed (Page.navigate)'));
  assert.strictEqual(p.code, 'URL_POLICY'); assert.strictEqual(adapterLib.classify(p), 'policy');
  var calls = [];
  var a = adapterLib.createAdapter({ env: envBase, backends: { obscura: stubBackend('obscura', { navigate: function () { return Promise.reject(p); } }, calls), playwright: stubBackend('playwright', {}, calls) } });
  return a.navigate({ url: 'https://rebind.example.com/' }).then(function () { throw new Error('must refuse'); }, function (e) {
    assert.strictEqual(e.code, 'URL_POLICY'); assert.ok(calls.every(function (c) { return c.indexOf('playwright') !== 0; }), calls.join(','));
  });
});
t('click over the fake Obscura: navigate, DOM click, the navigation it starts completes, landing text read', function () {
  var s3;
  return fake.start({ token: TOKEN, pages: {
    'https://example.com/': { title: 'Example Domain', text: 'Example', href: 'https://example.com/', links: { a: 'https://www.iana.org/help/example-domains', '#evil': 'http://127.0.0.1:8130/tasks' } },
    'https://www.iana.org/help/example-domains': { title: 'Example Domains', text: 'Example Domains', href: 'https://www.iana.org/help/example-domains' },
    'http://127.0.0.1:8130/tasks': { title: 'internal', text: 'SECRET TASK LIST', href: 'http://127.0.0.1:8130/tasks' } } }).then(function (srv3) {
    s3 = srv3;
    var a = adapterLib.createAdapter({ env: Object.assign({}, envBase, { OBSCURA_CDP_URL: srv3.url, OBSCURA_CDP_TOKEN: TOKEN }) });
    return a.click({ url: 'https://example.com/', selector: 'a', extract_selector: 'h1' }).then(function (r) {
      assert.strictEqual(r.backend, 'obscura'); assert.strictEqual(r.click_method, 'dom-click');
      assert.strictEqual(r.url_before, 'https://example.com/'); assert.strictEqual(r.final_url, 'https://www.iana.org/help/example-domains');
      assert.strictEqual(r.url_changed, true); assert.strictEqual(r.title, 'Example Domains'); assert.strictEqual(r.text, 'Example Domains');
      return a.click({ url: 'https://example.com/', selector: '#evil' });
    }).then(function () { throw new Error('must refuse the landing'); }, function (e) {
      assert.strictEqual(e.code, 'URL_POLICY_AFTER_CLICK', e.message); assert.strictEqual(adapterLib.classify(e), 'policy');
      assert.strictEqual(String(e.message).indexOf('SECRET'), -1, 'nothing from the refused page comes back');
      return a.click({ url: 'https://example.com/', selector: '' });
    }).then(function () { throw new Error('must refuse'); }, function (e) {
      assert.strictEqual(e.code, 'ARGS_INVALID');
    }).then(function () { return s3.close(); }, function (e) { return s3.close().then(function () { throw e; }); });
  });
});
t('the fake Obscura DROPS the socket mid-navigate -> the call falls to the fallback, which reports honestly (served or BLOCKED)', function () {
  var s4;
  return fake.start({ token: TOKEN, failMethods: { 'Page.navigate': 'drop' } }).then(function (srv4) {
    s4 = srv4;
    var calls = [];
    var a = adapterLib.createAdapter({ env: Object.assign({}, envBase, { OBSCURA_CDP_URL: srv4.url, OBSCURA_CDP_TOKEN: TOKEN }), backends: { playwright: stubBackend('playwright', {}, calls) } });
    return a.navigate({ url: 'https://example.com/' }).then(function (r) {
      assert.strictEqual(r.backend, 'playwright'); assert.ok(/obscura failed \(operation\): CDP_CLOSED/.test(r.fallback_reason), r.fallback_reason);
    }).then(function () { return s4.close(); }, function (e) { return s4.close().then(function () { throw e; }); });
  });
});
t('server.js tool error is machine-readable: code, class and every attempt with its stage', function () {
  var saved = { u: process.env.OBSCURA_CDP_URL, t: process.env.OBSCURA_CDP_TOKEN, m: process.env.MYTHOS_PLAYWRIGHT_MODULE };
  process.env.OBSCURA_CDP_URL = 'http://127.0.0.1:9'; process.env.OBSCURA_CDP_TOKEN = TOKEN; process.env.MYTHOS_PLAYWRIGHT_MODULE = '/nonexistent/playwright-core';
  function restore() { ['OBSCURA_CDP_URL', 'OBSCURA_CDP_TOKEN', 'MYTHOS_PLAYWRIGHT_MODULE'].forEach(function (k, i) { var v = [saved.u, saved.t, saved.m][i]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }); }
  return server.callTool('navigate', { url: 'http://10.0.0.1/' }).then(function (r) {
    var body = JSON.parse(r.content[0].text);
    assert.strictEqual(r.isError, true); assert.strictEqual(body.code, 'URL_POLICY'); assert.strictEqual(body.class, 'policy');
    return server.callTool('navigate', { url: 'https://example.com/' });
  }).then(function (r) {
    var body = JSON.parse(r.content[0].text);
    if (body.ok) { assert.strictEqual(body.backend, 'playwright'); return; }   // a host where playwright-core resolves from the repo
    assert.strictEqual(body.code, 'BROWSER_NO_BACKEND'); assert.strictEqual(body.class, 'backend');
    assert.deepStrictEqual(body.attempts.map(function (a) { return [a.backend, a.ok, a.stage]; }), [['obscura', false, 'open'], ['playwright', false, 'open']]);
    assert.strictEqual(r.content[0].text.indexOf(TOKEN), -1, 'the token never appears in an error');
  }).then(restore, function (e) { restore(); throw e; });
});
t('Playwright fallback guard: literal private targets, resolved-private hosts and deny-listed hosts are refused; data: and public hosts pass', function () {
  var dns = require('dns');
  var real = dns.promises.lookup;
  dns.promises.lookup = function (host) {
    if (host === 'rebind.example.net') return Promise.resolve([{ address: '93.184.215.14', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    if (host === 'v6.example.net') return Promise.resolve([{ address: 'fd00::5', family: 6 }]);
    return Promise.resolve([{ address: '93.184.215.14', family: 4 }]);
  };
  var cache = {};
  var cases = [['https://example.com/a.css', null], ['http://127.0.0.1:8600/', 'URL_PRIVATE_ADDRESS'], ['http://[::1]/', 'URL_PRIVATE_ADDRESS'],
    ['https://rebind.example.net/', 'URL_PRIVATE_ADDRESS_RESOLVED'], ['https://v6.example.net/', 'URL_PRIVATE_ADDRESS_RESOLVED'], ['data:text/html,hi', null], ['file:///etc/passwd', 'URL_SCHEME'],
    ['https://cdn.other.org/x.js', null]];
  return Promise.all(cases.map(function (c) { return playwrightLib.requestAllowed(c[0], { MYTHOS_BROWSER_ALLOWED_HOSTS: 'example.com' }, cache); })).then(function (got) {
    cases.forEach(function (c, i) { assert.strictEqual(got[i], c[1], c[0] + ' -> ' + got[i]); });
    return playwrightLib.requestAllowed('https://bad.example.org/', { MYTHOS_BROWSER_DENIED_HOSTS: '.example.org' }, {});
  }).then(function (d) { assert.strictEqual(d, 'URL_DENIED_HOST'); })
    .then(function () { dns.promises.lookup = real; }, function (e) { dns.promises.lookup = real; throw e; });
});

t('page-text: text mode drops script/style/noscript/template/svg and normalizes whitespace (the Obscura innerText == textContent quirk)', function () {
  var pageText = require(path.join(MCP, 'lib', 'page-text'));
  function node(tag, text, kids) {
    var n = { tagName: tag.toUpperCase(), parentNode: null, kids: kids || [], own: text || '' };
    n.kids.forEach(function (k) { k.parentNode = n; });
    n.removeChild = function (k) { n.kids.splice(n.kids.indexOf(k), 1); k.parentNode = null; };
    Object.defineProperty(n, 'textContent', { get: function () { return n.own + n.kids.map(function (k) { return k.textContent; }).join(''); } });
    n.querySelectorAll = function (sel) { var want = sel.split(','), out = []; (function walk(x) { x.kids.forEach(function (k) { if (want.indexOf(k.tagName.toLowerCase()) !== -1) out.push(k); walk(k); }); })(n); return out; };
    n.cloneNode = function () { return node(tag, n.own, n.kids.map(function (k) { return k.cloneNode(true); })); };
    n.outerHTML = '<' + tag + '>';
    return n;
  }
  var body = node('body', '', [node('style', 'body{padding:2em}'), node('p', '\n\t\t  Example   Domain\n\n\n\n\t'), node('script', 'var x=1;'), node('p', 'More  text  ')]);
  global.document = { body: body, title: 'T', querySelector: function () { return null; } };
  global.location = { href: 'https://example.com/' };
  try {
    var r = pageText.extractInPage(pageText.args({}));
    assert.strictEqual(r.text, 'Example Domain\n\nMore text');
    assert.strictEqual(r.found, true); assert.strictEqual(r.chars, r.text.length);
    assert.strictEqual(body.kids.length, 4, 'the live element is untouched — only the clone is pruned');
    assert.strictEqual(pageText.extractInPage(pageText.args({ selector: '#none' })).found, false);
    assert.ok(/^JSON\.stringify\(\(function extractInPage/.test(pageText.expression({ selector: 'h1' })));
  } finally { delete global.document; delete global.location; }
});

t('fake CDP server stops', function () { return srv.close(); });

queue.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  try { fs.rmSync(ART, { recursive: true, force: true }); } catch (e) {}
  process.exit(fail ? 1 : 0);
});
