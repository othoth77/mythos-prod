'use strict';
// =====================================================
// MYTHOS Browser MCP — BrowserAdapter
// projects/mythos-browser-mcp/lib/browser-adapter.js
//
// POLICY (owner architecture 2026-09-27, not reopenable here):
//   primary  = obscura     (CDP on 127.0.0.1:9222, OBSCURA_CDP_TOKEN)
//   fallback = playwright  (only if the primary cannot OPEN a session)
//
// The adapter is the one place that decides WHICH backend served a call and
// says so in every result (`backend`, plus `fallback_reason` when the primary
// was passed over). A fallback that cannot launch is reported as BLOCKED with
// the exact reason, never as a silent PASS. Every public operation is
// preceded by the URL policy (lib/url-policy.js): a refused URL reaches no
// backend at all.
// =====================================================
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var urlPolicy = require('./url-policy');
var obscuraLib = require('./obscura-backend');
var playwrightLib = require('./playwright-backend');

var VERSION = '1.0.0';
var ORDER = ['obscura', 'playwright'];
var MAX_INLINE_IMAGE_BYTES = 64 * 1024;

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
  function openSession() {
    var attempts = [];
    var idx = 0;
    function tryNext() {
      if (idx >= order.length) {
        var e = new Error('BROWSER_NO_BACKEND: ' + attempts.map(function (a) { return a.backend + ' — ' + a.reason; }).join('; '));
        e.code = 'BROWSER_NO_BACKEND'; e.attempts = attempts; throw e;
      }
      var name = order[idx++];
      var b = backend(name);
      return b.open().then(function (session) {
        attempts.push({ backend: name, ok: true, reason: null });
        var fallback_reason = attempts.length > 1 ? attempts[0].backend + ' unavailable: ' + attempts[0].reason : null;
        return { backend: name, impl: b, session: session, attempts: attempts, fallback_reason: fallback_reason };
      }, function (err) {
        attempts.push({ backend: name, ok: false, reason: String(err && err.message || err).slice(0, 400) });
        return tryNext();
      });
    }
    return tryNext();
  }

  function withSession(fn) {
    return openSession().then(function (s) {
      return Promise.resolve().then(function () { return fn(s); }).then(function (out) {
        return s.impl.close(s.session).then(function () { return out; });
      }, function (err) {
        return s.impl.close(s.session).catch(function () {}).then(function () { throw err; });
      });
    });
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
    return withSession(function (s) {
      return s.impl.navigate(s.session, url).then(function (nav) { var m = meta(s, nav); m.requested_url = url; return m; });
    });
  }

  function extract(args) {
    args = args || {};
    var url;
    try { url = checkedUrl(args.url); } catch (e) { return Promise.reject(e); }
    return withSession(function (s) {
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
    return withSession(function (s) {
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

module.exports = { createAdapter: createAdapter, VERSION: VERSION, ORDER: ORDER };
