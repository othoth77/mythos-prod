#!/usr/bin/env node
// =====================================================
// OTH Knowledge — read-only HTTP facade
// projects/oth-knowledge/service/othk-http.js
//
// THE one structural gap every audit named: OTH Knowledge had a CLI and an
// in-process JS API, so nothing on the network could read it. Every other
// node in the ecosystem already speaks HTTP. This closes that, and nothing
// else.
//
// It is a facade, not an engine. It owns no data, creates no store, and has
// no write path of any kind:
//
//   * It serves ONLY lib/knowledge-service.js, which is already the
//     provider-neutral read boundary ("Write operations are deliberately
//     absent from this surface"). Ingestion and curation stay on othk-cli,
//     exactly as config/knowledge.json requires.
//   * Every route is GET. POST/PUT/PATCH/DELETE are refused with 405 before
//     any handler runs, so a write cannot be added by accident later.
//   * It binds 127.0.0.1 by default. Public exposure is an nginx decision,
//     not this file's.
//   * A missing store is a reportable 503, never an attempt to create one —
//     the same fail-closed posture as OTHMODE's memory bridge.
//
// Auth mirrors the executor (projects/mythos-ai-executor/server.js): a bearer
// token from the environment, /health open so a probe needs no credential,
// everything else 401. The token is never logged and never echoed.
// =====================================================
'use strict';

var fs = require('fs');
var http = require('http');
var crypto = require('crypto');
var path = require('path');

var serviceLib = require(path.join(__dirname, '..', 'lib', 'knowledge-service.js'));

var VERSION = 'othk-http/1.0.0';
var MAX_QUERY_CHARS = 500;
var MAX_ID_CHARS = 128;
var MAX_LIMIT = 50;
var DEFAULT_LIMIT = 20;
var SEARCH_MODES = ['lexical', 'hybrid', 'vector', 'exact'];
var RECORD_KINDS = ['source', 'artifact', 'document', 'chunk', 'entity', 'fact',
  'claim', 'observation', 'event', 'relationship', 'evidence', 'derived'];

// ---------------------------------------------------------------- helpers

function send(res, status, body) {
  var payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Constant-time comparison so a token cannot be recovered by timing.
function tokenMatches(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  var a = Buffer.from(presented, 'utf8');
  var b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function bearer(req) {
  var h = req.headers.authorization || '';
  var m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1].trim() : null;
}

function str(v, max, label) {
  if (typeof v !== 'string' || !v.trim()) throw badInput(label + ' required');
  if (v.length > max) throw badInput(label + ' exceeds ' + max + ' characters');
  return v.trim();
}

function badInput(msg) { var e = new Error(msg); e.code = 'OTHK_HTTP_INPUT'; return e; }

function limitOf(q) {
  var n = parseInt(q.get('limit') || String(DEFAULT_LIMIT), 10);
  if (!Number.isInteger(n) || n < 1) n = DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

// ------------------------------------------------------------ the service

// Opened lazily and kept, so an absent store is reported rather than fatal
// at boot and a later provisioning is picked up without a restart.
function serviceHolder(storeRoot) {
  var svc = null;
  var reason = null;
  return function get() {
    if (svc) return { ok: true, svc: svc };
    // openStore() is lazy: it succeeds on a path that does not exist and
    // hands back an empty store. Serving that would answer "0 records"
    // where the truthful answer is "there is no store here" — an invented
    // answer, which is exactly what this facade must never give. OTHMODE's
    // memory bridge guards the same way before opening the same service.
    if (!fs.existsSync(storeRoot)) {
      // existsSync is false for EACCES as well as ENOENT. Both stay
      // fail-closed here, but they are different operator problems — a
      // missing directory is provisioned, an unreadable one is a permission
      // fix — so the reason must not claim the store is absent when it is
      // merely inaccessible to this service's user.
      var why = 'does not exist on this host';
      try { fs.accessSync(storeRoot, fs.constants.F_OK); }
      catch (e) {
        if (e.code && e.code !== 'ENOENT') {
          why = 'exists but is not accessible to this service (' + e.code + ')';
        }
      }
      reason = 'store root ' + storeRoot + ' ' + why
        + ' (fail-closed; provisioning is an operator step, never this service\'s)';
      return { ok: false, reason: reason };
    }
    try {
      svc = serviceLib.openService(storeRoot);
      reason = null;
      return { ok: true, svc: svc };
    } catch (e) {
      reason = (e.code || 'OTHK_SERVICE') + ': ' + (e.message || 'service refused to open');
      return { ok: false, reason: reason };
    }
  };
}

// ------------------------------------------------------------------ routes

function buildRoutes(getService) {
  return [
    { path: /^\/stats$/, handler: function (svc) { return svc.stats(); } },

    { path: /^\/search$/, handler: function (svc, q) {
      var query = str(q.get('q'), MAX_QUERY_CHARS, 'q');
      var opts = { limit: limitOf(q) };
      var mode = q.get('mode');
      if (mode) {
        if (SEARCH_MODES.indexOf(mode) === -1) throw badInput('mode must be one of: ' + SEARCH_MODES.join('|'));
        opts.mode = mode;
      }
      var kind = q.get('kind');
      if (kind) {
        if (RECORD_KINDS.indexOf(kind) === -1) throw badInput('kind must be one of: ' + RECORD_KINDS.join('|'));
        opts.filters = { kind: kind };
      }
      return { query: query, options: opts, hits: svc.search(query, opts) };
    } },

    { path: /^\/records\/([^/]+)$/, handler: function (svc, q, m) {
      return svc.retrieve(str(decodeURIComponent(m[1]), MAX_ID_CHARS, 'record id'));
    } },

    { path: /^\/records\/([^/]+)\/provenance$/, handler: function (svc, q, m) {
      return svc.lookupProvenance(str(decodeURIComponent(m[1]), MAX_ID_CHARS, 'record id'));
    } },

    { path: /^\/records\/([^/]+)\/evidence$/, handler: function (svc, q, m) {
      return svc.lookupEvidence(str(decodeURIComponent(m[1]), MAX_ID_CHARS, 'record id'));
    } },

    { path: /^\/records\/([^/]+)\/history$/, handler: function (svc, q, m) {
      return svc.lookupHistory(str(decodeURIComponent(m[1]), MAX_ID_CHARS, 'record id'));
    } },

    { path: /^\/records\/([^/]+)\/trust$/, handler: function (svc, q, m) {
      var asOf = q.get('asOf');
      if (!asOf) throw badInput('asOf required — trust is always assessed at an explicit time');
      return svc.assessTrust(str(decodeURIComponent(m[1]), MAX_ID_CHARS, 'record id'), { asOf: asOf });
    } },

    { path: /^\/entities$/, handler: function (svc, q) {
      return svc.lookupEntity(str(q.get('name'), MAX_QUERY_CHARS, 'name'));
    } },

    { path: /^\/contradictions$/, handler: function (svc, q) {
      var o = {};
      if (q.get('state')) o.state = str(q.get('state'), 64, 'state');
      if (q.get('entity_id')) o.entity_id = str(q.get('entity_id'), MAX_ID_CHARS, 'entity_id');
      return svc.findContradictions(o);
    } },

    { path: /^\/current-state$/, handler: function (svc, q) {
      var asOf = q.get('asOf');
      if (!asOf) throw badInput('asOf required — current state is always relative to an explicit time');
      var o = { asOf: asOf };
      if (q.get('tag')) o.tag = str(q.get('tag'), 64, 'tag');
      return svc.currentState(o);
    } },

    { path: /^\/audit$/, handler: function (svc) { return svc.audit(); } },
  ];
}

// ------------------------------------------------------------------ server

function createServer(opts) {
  opts = opts || {};
  var storeRoot = opts.storeRoot || process.env.OTHK_STORE_ROOT;
  var token = opts.token || process.env.OTHK_HTTP_TOKEN;
  if (!storeRoot) throw new Error('OTHK_STORE_ROOT required');
  if (!token) throw new Error('OTHK_HTTP_TOKEN required — the facade refuses to serve without one');

  var getService = serviceHolder(storeRoot);
  var routes = buildRoutes(getService);

  return http.createServer(function (req, res) {
    var url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch (e) { return send(res, 400, { error: 'bad request' }); }
    var pathname = url.pathname;

    // Read-only by construction: refuse every mutating verb before routing,
    // so no future handler can quietly become a write path.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, { error: 'method not allowed', detail: 'this facade is read-only; ingestion and curation are othk-cli operations' });
    }

    // /health is open so a probe needs no credential — same rule as the
    // executor. It reports whether the store opened; it never opens one.
    if (pathname === '/health') {
      var h = getService();
      return send(res, 200, {
        application: 'oth-knowledge-http',
        version: VERSION,
        status: h.ok ? 'ok' : 'degraded',
        store_available: h.ok,
        reason: h.ok ? null : h.reason,
        read_only: true,
      });
    }

    if (!tokenMatches(bearer(req), token)) {
      return send(res, 401, { error: 'unauthorized' });
    }

    var svcState = getService();
    if (!svcState.ok) {
      return send(res, 503, { error: 'knowledge store unavailable', reason: svcState.reason });
    }

    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].path.exec(pathname);
      if (!m) continue;
      try {
        return send(res, 200, routes[i].handler(svcState.svc, url.searchParams, m));
      } catch (e) {
        var code = e.code || 'OTHK_HTTP_ERROR';
        var status = code === 'OTHK_HTTP_INPUT' ? 400 : 500;
        // Message only — never a record body, never the token.
        return send(res, status, { error: code, detail: String(e.message || '').slice(0, 300) });
      }
    }
    return send(res, 404, { error: 'no such route' });
  });
}

function main() {
  var port = parseInt(process.env.OTHK_HTTP_PORT || '8150', 10);
  var host = process.env.OTHK_HTTP_HOST || '127.0.0.1';
  var server = createServer({});
  server.listen(port, host, function () {
    // Never log the token or the store contents.
    console.log(VERSION + ' listening on ' + host + ':' + port + ' (read-only)');
  });
}

if (require.main === module) main();
module.exports = { createServer, VERSION, MAX_QUERY_CHARS, MAX_LIMIT, RECORD_KINDS, SEARCH_MODES };
