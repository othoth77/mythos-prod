'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — headless browser driver for tests
// projects/mythos-trading-control-center/tests/browser.js
//
// A minimal Chrome DevTools Protocol client: enough to load the real
// interface in a real browser, click what an operator clicks, and read what
// they would read. No dependency — Node's built-in WebSocket speaks to the
// browser's debugging port.
//
// The browser is found through TCC_CHROME, or one of a short list of known
// locations. When none exists the browser suite SKIPS — visibly, as skipped —
// rather than passing without having looked at anything.
//
// It talks only to the loopback debugging port of a browser it started itself,
// with a throwaway profile directory that is removed afterwards.
// =====================================================

var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var CANDIDATES = [
  process.env.TCC_CHROME,
  '/home/deploy/wpv2-ui-test/headless-shell/chrome-headless-shell',
  '/usr/local/bin/chrome-headless-shell',
  '/opt/chrome-headless-shell/chrome-headless-shell'
];

function findChrome() {
  for (var i = 0; i < CANDIDATES.length; i++) {
    var c = CANDIDATES[i];
    if (!c) continue;
    try { fs.accessSync(c, fs.constants.X_OK); return c; } catch (e) { /* try the next */ }
  }
  return null;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/**
 * Starts a headless browser. Returns { newPage(), close() }.
 */
async function launch(opts) {
  var o = opts || {};
  var bin = o.chrome || findChrome();
  if (!bin) throw new Error('no headless browser available (set TCC_CHROME)');
  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tcc-chrome-'));
  var child = childProcess.spawn(bin, [
    '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--disable-dev-shm-usage', '--disable-background-networking', '--disable-component-update',
    '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'], env: { HOME: profile, PATH: process.env.PATH || '/usr/bin:/bin', TMPDIR: os.tmpdir() } });

  var wsUrl = await new Promise(function (resolve, reject) {
    var buf = '';
    var timer = setTimeout(function () { reject(new Error('the browser did not report a debugging port: ' + buf.slice(-300))); }, 20000);
    child.stderr.on('data', function (d) {
      buf += String(d);
      var m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on('exit', function (code) { clearTimeout(timer); reject(new Error('the browser exited (' + code + '): ' + buf.slice(-300))); });
  });

  var ws = new WebSocket(wsUrl);
  await new Promise(function (resolve, reject) {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', function () { reject(new Error('could not connect to the browser debugging port')); });
  });

  var seq = 0;
  var pending = new Map();
  var listeners = [];
  ws.addEventListener('message', function (ev) {
    var msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      var p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message + ' (' + p.method + ')'));
      else p.resolve(msg.result);
      return;
    }
    listeners.forEach(function (fn) { fn(msg); });
  });

  function send(method, params, sessionId) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      pending.set(id, { resolve: resolve, reject: reject, method: method });
      var msg = { id: id, method: method, params: params || {} };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });
  }

  async function newPage(viewport) {
    var target = await send('Target.createTarget', { url: 'about:blank' });
    var attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    var sid = attached.sessionId;
    var errors = [];
    var loadWaiters = [];
    listeners.push(function (msg) {
      if (msg.sessionId !== sid) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        var d = msg.params.exceptionDetails;
        errors.push('exception: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push('log: ' + msg.params.entry.text + (msg.params.entry.url ? ' @ ' + msg.params.entry.url : ''));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console: ' + msg.params.args.map(function (a) { return a.value || a.description || ''; }).join(' '));
      } else if (msg.method === 'Page.loadEventFired') {
        loadWaiters.splice(0).forEach(function (fn) { fn(); });
      }
    });
    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Log.enable', {}, sid);
    var vp = viewport || { width: 1440, height: 900 };
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false }, sid);

    async function evaluate(expression) {
      var res = await send('Runtime.evaluate', { expression: expression, awaitPromise: true, returnByValue: true }, sid);
      if (res.exceptionDetails) {
        throw new Error('page evaluation failed: ' + (res.exceptionDetails.exception && res.exceptionDetails.exception.description
          ? res.exceptionDetails.exception.description.split('\n')[0] : res.exceptionDetails.text));
      }
      return res.result.value;
    }

    var page = {
      errors: errors,
      goto: async function (url) {
        var loaded = new Promise(function (resolve) { loadWaiters.push(resolve); });
        await send('Page.navigate', { url: url }, sid);
        await Promise.race([loaded, sleep(15000)]);
      },
      eval: evaluate,
      /** Waits until `expression` is truthy in the page; returns its value. */
      waitFor: async function (expression, timeoutMs, what) {
        var deadline = Date.now() + (timeoutMs || 15000);
        for (;;) {
          var v = null;
          try { v = await evaluate(expression); } catch (e) { v = null; }   // a navigation in flight
          if (v) return v;
          if (Date.now() > deadline) throw new Error('timed out waiting for ' + (what || expression) + (errors.length ? ' — page errors: ' + errors.join(' | ') : ''));
          await sleep(80);
        }
      },
      text: function (selector) {
        return evaluate('(function(){var n=document.querySelector(' + JSON.stringify(selector) + ');return n?n.textContent:null;})()');
      },
      count: function (selector) { return evaluate('document.querySelectorAll(' + JSON.stringify(selector) + ').length'); },
      exists: function (selector) { return evaluate('!!document.querySelector(' + JSON.stringify(selector) + ')'); },
      click: async function (selector) {
        var ok = await evaluate('(function(){var n=document.querySelector(' + JSON.stringify(selector) + ');if(!n)return false;n.click();return true;})()');
        if (!ok) throw new Error('nothing to click at ' + selector);
      },
      /** Clicks the first element of `selector` whose text contains `text`. */
      clickText: async function (selector, text) {
        var ok = await evaluate('(function(){var ns=document.querySelectorAll(' + JSON.stringify(selector) + ');for(var i=0;i<ns.length;i++){' +
          'if(ns[i].textContent.indexOf(' + JSON.stringify(text) + ')!==-1&&!ns[i].disabled){ns[i].click();return true;}}return false;})()');
        if (!ok) throw new Error('nothing to click matching ' + selector + ' with text "' + text + '"');
      },
      /** Sets a field's value the way typing does: value, then input and change events. */
      fill: async function (selector, value) {
        var ok = await evaluate('(function(){var n=document.querySelector(' + JSON.stringify(selector) + ');if(!n)return false;n.focus();' +
          'var proto=n.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:(n.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype);' +
          'Object.getOwnPropertyDescriptor(proto,"value").set.call(n,' + JSON.stringify(String(value)) + ');' +
          'n.dispatchEvent(new Event("input",{bubbles:true}));n.dispatchEvent(new Event("change",{bubbles:true}));return true;})()');
        if (!ok) throw new Error('nothing to fill at ' + selector);
      },
      setViewport: function (w, h) {
        return send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, sid);
      },
      screenshot: async function (file) {
        var res = await send('Page.captureScreenshot', { format: 'png' }, sid);
        fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
        return file;
      },
      cookies: async function () { return (await send('Network.getAllCookies', {}, sid)).cookies; },
      close: function () { return send('Target.closeTarget', { targetId: target.targetId }).catch(function () {}); }
    };
    return page;
  }

  async function close() {
    try { ws.close(); } catch (e) { /* closing anyway */ }
    try { child.kill('SIGKILL'); } catch (e2) { /* already gone */ }
    await sleep(150);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e3) { /* best effort */ }
  }

  return { newPage: newPage, close: close, bin: bin };
}

module.exports = { launch: launch, findChrome: findChrome, sleep: sleep };
