'use strict';
// =====================================================
// MYTHOS Browser MCP — BrowserAdapter
// projects/mythos-browser-mcp/lib/browser-adapter.js
//
// POLICY (owner architecture 2026-09-27, not reopenable here):
//   primary  = obscura     (CDP on 127.0.0.1:9222, OBSCURA_CDP_TOKEN)
//   fallback = playwright  (when the primary cannot open a session, OR the
//                           operation fails or times out on it — 1.1.0)
//
// The adapter is the one place that decides WHICH backend served a call and
// says so in every result (`backend`, plus `fallback_reason` when the primary
// was passed over). A fallback that cannot launch is reported as BLOCKED with
// the exact reason, never as a silent PASS. Every public operation is
// preceded by the URL policy (lib/url-policy.js): a refused URL reaches no
// backend at all.
//
// WHAT FALLS BACK (1.1.0, owner order 2026-09-29: "a temporary Obscura
// failure must not terminate a browser task Playwright can execute"): every
// failure of an ATTEMPT — open, the operation itself, or the attempt deadline
// (MYTHOS_BROWSER_ATTEMPT_TIMEOUT_MS) — moves to the next backend, except the
// one no engine can change: a URL the policy refuses, before any engine or
// inside one (class `policy`). When every attempt fails, the error is classified by what the
// attempts measured: BROWSER_NO_BACKEND (no engine could open), NAVIGATE_FAILED
// (the engines opened and the SITE failed), BROWSER_TIMEOUT, or
// BROWSER_BACKEND_FAILED — with every attempt's stage and reason attached.
// =====================================================
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var urlPolicy = require('./url-policy');
var obscuraLib = require('./obscura-backend');
var playwrightLib = require('./playwright-backend');

var VERSION = '1.1.0';
var ORDER = ['obscura', 'playwright'];
var MAX_INLINE_IMAGE_BYTES = 64 * 1024;
var ATTEMPT_TIMEOUT_MS = 40000;   // one backend: open + the operation; two attempts fit the executor's 100 s browser invoke

function codedError(code, message, extra) {
  var e = new Error(code + ': ' + message);
  e.code = code;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

// A backend reports a site-level failure in its own words: Chromium as
// net::ERR_*, Obscura as a CDP error "Network error: … error sending request".
var TARGET_FAILURE = /NAVIGATE_FAILED|net::ERR_|Network error|HTTP_STATUS/;

// classify(err) -> 'policy' | 'target' | 'timeout' | 'backend'
function classify(err) {
  var code = err && err.code;
  var msg = String(err && err.message || err);
  if (code === 'URL_POLICY') return 'policy';
  if (code === 'BROWSER_TIMEOUT') return 'timeout';
  if (TARGET_FAILURE.test(msg)) return 'target';
  return 'backend';
}

function backendFactory(name, cfg) {
  if (name === 'obscura') return obscuraLib.create(cfg);
  if (name === 'playwright') return playwrightLib.create(cfg);
  throw new Error('BROWSER_CONFIG: unknown backend ' + name);
}

function artifactsDir(env) {
  var d = env.MYTHOS_BROWSER_ARTIFACTS || path.join(env.HOME || '/tmp', '.local', 'state', 'mythos-browser', 'artifacts');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

// createAdapter({ env, backends?: { obscura, playwright } (injectable for tests), order? })
function createAdapter(cfg) {
  cfg = cfg || {};
  var env = cfg.env || process.env;
  var order = Array.isArray(cfg.order) && cfg.order.length ? cfg.order.slice() : ORDER.slice();
  var instances = {};
  function backend(name) {
    if (!instances[name]) instances[name] = (cfg.backends && cfg.backends[name]) || backendFactory(name, { env: env });
    return instances[name];
  }

  // status() -> which backend would serve, and why the others would not — no session is opened
  function status() {
    var primary = backend(order[0]);
    var fb = order[1] ? backend(order[1]) : null;
    return Promise.resolve(primary.probe ? primary.probe() : { ok: true }).then(function (p) {
      var out = { adapter_version: VERSION, policy: { primary: order[0], fallback: order[1] || null }, primary: { name: order[0], endpoint: primary.endpoint || null, ok: !!p.ok, detail: p.ok ? (p.product || 'reachable') : (p.code + ': ' + p.reason) }, fallback: null };
      if (fb) {
        var a = fb.availability ? fb.availability() : { available: true };
        out.fallback = { name: order[1], status: a.available ? 'AVAILABLE' : 'BLOCKED', detail: a.available ? (a.module_id + (a.version ? ' ' + a.version : '')) : a.reason };
      }
      return out;
    });
  }

  // openSession() -> { backend, session, fallback_reason, attempts:[{backend, ok, reason}] }
  // Kept for status/diagnostics callers: tries each backend's open() only.
  function openSession() {
    var attempts = [];
    var idx = 0;
    function tryNext() {
      if (idx >= order.length) {
        throw codedError('BROWSER_NO_BACKEND', attempts.map(function (a) { return a.backend + ' — ' + a.reason; }).join('; '), { attempts: attempts });
      }
      var name = order[idx++];
      var b = backend(name);
      return b.open().then(function (session) {
        attempts.push({ backend: name, ok: true, stage: 'open', reason: null });
        var fallback_reason = attempts.length > 1 ? attempts[0].backend + ' unavailable: ' + attempts[0].reason : null;
        return { backend: name, impl: b, session: session, attempts: attempts, fallback_reason: fallback_reason };
      }, function (err) {
        attempts.push({ backend: name, ok: false, stage: 'open', class: 'backend', reason: String(err && err.message || err).slice(0, 400) });
        return tryNext();
      });
    }
    return tryNext();
  }

  var attemptTimeout = Number(cfg.attemptTimeoutMs || env.MYTHOS_BROWSER_ATTEMPT_TIMEOUT_MS) || ATTEMPT_TIMEOUT_MS;

  // One backend, one bounded attempt: open, run fn, close — the page is closed
  // on every path, including a deadline that fires while the engine is still
  // working (the late session is closed when it arrives).
  function attempt(name, fn) {
    var b = backend(name);
    var session = null, stage = 'open', expired = false, timer = null;
    var work = Promise.resolve().then(function () { return b.open(); }).then(function (s) {
      session = s;
      if (expired) { b.close(s).catch(function () {}); throw codedError('BROWSER_TIMEOUT', 'late session discarded'); }
      stage = 'operation';
      return fn({ backend: name, impl: b, session: s });
    }).then(function (out) {
      return b.close(session).then(function () { return out; }, function () { return out; });
    }, function (err) {
      var closing = session && !expired ? b.close(session).catch(function () {}) : Promise.resolve();
      return closing.then(function () { err.stage = err.stage || stage; throw err; });
    });
    var deadline = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        expired = true;
        if (session) b.close(session).catch(function () {});
        reject(codedError('BROWSER_TIMEOUT', name + ' did not finish within ' + attemptTimeout + ' ms (stage ' + stage + ')', { stage: stage }));
      }, attemptTimeout);
    });
    work.catch(function () { /* settled by the race; a late rejection is not unhandled */ });
    return Promise.race([work, deadline]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  // Runs fn on the primary, then on each fallback until one succeeds or a
  // failure no engine can change (policy) stops the chain.
  function withFallback(fn) {
    var attempts = [];
    var idx = 0;
    function tryNext() {
      if (idx >= order.length) throw finalError(attempts);
      var name = order[idx++];
      return attempt(name, function (s) {
        s.attempts = attempts;
        s.fallback_reason = attempts.length ? attempts[0].backend + (attempts[0].stage === 'open' ? ' unavailable: ' : ' failed (' + attempts[0].stage + '): ') + attempts[0].reason : null;
        return fn(s);
      }).then(function (out) {
        attempts.push({ backend: name, ok: true, stage: 'done', reason: null });
        return out;
      }, function (err) {
        var cls = classify(err);
        attempts.push({ backend: name, ok: false, stage: err.stage || 'operation', class: cls, reason: String(err && err.message || err).slice(0, 400) });
        if (cls === 'policy') { err.attempts = attempts; throw err; }
        return tryNext();
      });
    }
    return tryNext();
  }

  function finalError(attempts) {
    var detail = attempts.map(function (a) { return a.backend + ' [' + a.stage + '] — ' + a.reason; }).join('; ');
    var opened = attempts.filter(function (a) { return a.stage !== 'open'; });
    var last = attempts[attempts.length - 1] || {};
    var code = !opened.length ? 'BROWSER_NO_BACKEND'
      : last.class === 'target' || opened.every(function (a) { return a.class === 'target'; }) ? 'NAVIGATE_FAILED'
      : last.class === 'timeout' ? 'BROWSER_TIMEOUT'
      : 'BROWSER_BACKEND_FAILED';
    return codedError(code, detail, { attempts: attempts });
  }

  function checkedUrl(url) {
    var v = urlPolicy.check(url, env);
    if (!v.ok) { var e = new Error(v.code + ': ' + v.reason); e.code = 'URL_POLICY'; e.policy = v; throw e; }
    return v.url;
  }

  function meta(s, nav) {
    return { backend: s.backend, fallback_reason: s.fallback_reason, attempts: s.attempts, final_url: nav.final_url, title: nav.title, ready_state: nav.ready_state || null, http_status: nav.http_status === undefined ? null : nav.http_status };
  }

  function navigate(args) {
    args = args || {};
    var url;
    try { url = checkedUrl(args.url); } catch (e) { return Promise.reject(e); }
    return withFallback(function (s) {
      return s.impl.navigate(s.session, url).then(function (nav) { var m = meta(s, nav); m.requested_url = url; return m; });
    });
  }

  function extract(args) {
    args = args || {};
    var url;
    try { url = checkedUrl(args.url); } catch (e) { return Promise.reject(e); }
    return withFallback(function (s) {
      return s.impl.navigate(s.session, url).then(function (nav) {
        return s.impl.extract(s.session, { selector: args.selector, mode: args.mode, max_chars: args.max_chars }).then(function (x) {
          var m = meta(s, nav); m.requested_url = url;
          m.found = !!x.found; m.text = x.found ? x.text : ''; m.chars = x.chars || 0; m.truncated = !!x.truncated;
          if (typeof args.selector === 'string') m.selector = args.selector.slice(0, 256);
          return m;
        });
      });
    });
  }

  function screenshot(args) {
    args = args || {};
    var url;
    try { url = checkedUrl(args.url); } catch (e) { return Promise.reject(e); }
    var format = args.format === 'jpeg' ? 'jpeg' : 'png';
    return withFallback(function (s) {
      return s.impl.navigate(s.session, url).then(function (nav) {
        return s.impl.screenshot(s.session, { format: format }).then(function (shot) {
          var m = meta(s, nav); m.requested_url = url;
          var buf = shot.buffer;
          var sha = crypto.createHash('sha256').update(buf).digest('hex');
          var dir = artifactsDir(env);
          var file = path.join(dir, 'shot-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + sha.slice(0, 8) + '.' + format);
          fs.writeFileSync(file, buf, { mode: 0o600 });
          m.format = format; m.bytes = buf.length; m.sha256 = sha; m.path = file;
          if (args.inline === true && buf.length <= MAX_INLINE_IMAGE_BYTES) m.base64 = buf.toString('base64');
          return m;
        });
      });
    });
  }

  return { VERSION: VERSION, order: order, status: status, openSession: openSession, navigate: navigate, extract: extract, screenshot: screenshot };
}

module.exports = { createAdapter: createAdapter, classify: classify, VERSION: VERSION, ORDER: ORDER, ATTEMPT_TIMEOUT_MS: ATTEMPT_TIMEOUT_MS };
