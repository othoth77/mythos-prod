'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — control-plane client
   projects/mythos-os-console/reference/upstream.js

   The only place the console talks to anything. Two sources:

     1. The mythos-ai-executor HTTP API over loopback, bearer-token
        authenticated. The token is read from the environment or an
        EnvironmentFile and NEVER leaves this process — the browser is
        given data, never a credential.

     2. Executor configuration files on disk, read-only. These are the
        agent, provider and roadmap registries; they have no HTTP
        surface, so the console reads the files the executor itself
        reads. Nothing is written back.

   Every method resolves to a value or rejects with an Error carrying a
   `code`. Callers turn a rejection into an honest failure state; none
   of them substitutes an empty result for an unreadable one.
   ===================================================== */

var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var url = require('url');

var DEFAULT_TARGET = process.env.MOS_EXECUTOR_URL || 'http://127.0.0.1:8130';
var TIMEOUT_MS = parseInt(process.env.MOS_UPSTREAM_TIMEOUT_MS || '8000', 10);
var MAX_BODY = 4 * 1024 * 1024;

// Config lives with the executor. The console does not keep a copy —
// a second copy is a second truth, and the audit found four of those
// already in this portfolio.
var CONFIG_DIR = process.env.MOS_EXECUTOR_CONFIG_DIR ||
  path.join(__dirname, '..', '..', 'mythos-ai-executor', 'config');

function fail(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

function loadToken() {
  if (process.env.MOS_EXECUTOR_TOKEN) return process.env.MOS_EXECUTOR_TOKEN.trim();
  var file = process.env.MOS_EXECUTOR_TOKEN_FILE;
  if (!file) return null;
  try {
    var m = /^MYTHOS_EXECUTOR_TOKEN=(.+)$/m.exec(fs.readFileSync(file, 'utf8'));
    return m ? m[1].trim() : null;
  } catch (e) {
    return null;
  }
}

/* GET one path from the executor.
   `anonymous` is for /health, which the executor serves without a
   token — it is the one probe that still works when the console has no
   credential, and it is what tells the operator that. */
function get(pathname, opts) {
  opts = opts || {};
  var target = url.parse((opts.target || DEFAULT_TARGET) + pathname);
  var token = opts.token !== undefined ? opts.token : loadToken();

  if (!opts.anonymous && !token) {
    return Promise.reject(fail('upstream_unauthorized',
      'No control-plane token is provisioned for this console (MOS_EXECUTOR_TOKEN / MOS_EXECUTOR_TOKEN_FILE).'));
  }

  var transport = target.protocol === 'https:' ? https : http;
  var headers = { Accept: 'application/json' };
  if (token && !opts.anonymous) headers.Authorization = 'Bearer ' + token;

  return new Promise(function (resolve, reject) {
    var req = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      method: 'GET',
      headers: headers,
      timeout: TIMEOUT_MS
    }, function (res) {
      var size = 0;
      var chunks = [];
      res.on('data', function (d) {
        size += d.length;
        if (size > MAX_BODY) { req.destroy(); reject(fail('upstream_too_large', 'Response exceeded 4 MB.')); return; }
        chunks.push(d);
      });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var body;
        try { body = JSON.parse(text || '{}'); }
        catch (e) { reject(fail('upstream_bad_json', 'Control plane returned a non-JSON body.')); return; }

        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(fail('upstream_unauthorized', 'The control plane refused the console token.'));
          return;
        }
        if (res.statusCode >= 400) {
          // The executor's own error text is already redacted at its
          // boundary; it is still not passed through verbatim, because
          // a status code is what the operator needs and a driver
          // message is what leaks.
          reject(fail('upstream_error', 'Control plane responded ' + res.statusCode + ' for ' + pathname + '.'));
          return;
        }
        resolve(body);
      });
    });

    req.on('timeout', function () {
      req.destroy();
      reject(fail('upstream_unreachable', 'Control plane did not respond within ' + TIMEOUT_MS + ' ms.'));
    });
    req.on('error', function () {
      // Deliberately not the syscall message: it names paths and ports.
      reject(fail('upstream_unreachable', 'Control plane at ' + (opts.target || DEFAULT_TARGET) + ' is not answering.'));
    });
    req.end();
  });
}

/* POST one JSON body to the executor. Same auth, same timeout, same
   error shapes as get() -- the only difference is the verb and that a
   body is sent. This is a server-to-server call over an already
   bearer-token-authenticated channel; it has nothing to do with, and
   does not relax, server.js's guarantee that the CONSOLE (what the
   browser talks to) never reads a request body except through the one
   narrow relay route that exists for exactly this purpose. */
function post(pathname, payload) {
  var target = url.parse(DEFAULT_TARGET + pathname);
  var token = loadToken();
  if (!token) {
    return Promise.reject(fail('upstream_unauthorized',
      'No control-plane token is provisioned for this console (MOS_EXECUTOR_TOKEN / MOS_EXECUTOR_TOKEN_FILE).'));
  }
  var body = JSON.stringify(payload || {});
  var headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    Authorization: 'Bearer ' + token
  };

  return new Promise(function (resolve, reject) {
    var req = http.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.path,
      method: 'POST',
      headers: headers,
      timeout: TIMEOUT_MS
    }, function (res) {
      var size = 0;
      var chunks = [];
      res.on('data', function (d) {
        size += d.length;
        if (size > MAX_BODY) { req.destroy(); reject(fail('upstream_too_large', 'Response exceeded 4 MB.')); return; }
        chunks.push(d);
      });
      res.on('end', function () {
        var text = Buffer.concat(chunks).toString('utf8');
        var out;
        try { out = JSON.parse(text || '{}'); }
        catch (e) { reject(fail('upstream_bad_json', 'Control plane returned a non-JSON body.')); return; }

        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(fail('upstream_unauthorized', 'The control plane refused the console token.'));
          return;
        }
        if (res.statusCode >= 400) {
          var err = fail('upstream_error', 'Control plane responded ' + res.statusCode + ' for ' + pathname + '.');
          err.status = res.statusCode;
          err.detail = out && out.error;
          reject(err);
          return;
        }
        resolve(out);
      });
    });

    req.on('timeout', function () {
      req.destroy();
      reject(fail('upstream_unreachable', 'Control plane did not respond within ' + TIMEOUT_MS + ' ms.'));
    });
    req.on('error', function () {
      reject(fail('upstream_unreachable', 'Control plane at ' + DEFAULT_TARGET + ' is not answering.'));
    });
    req.write(body);
    req.end();
  });
}

function readConfig(name) {
  var file = path.join(CONFIG_DIR, name);
  return new Promise(function (resolve, reject) {
    fs.readFile(file, 'utf8', function (err, text) {
      if (err) { reject(fail('config_unreadable', 'Cannot read executor config ' + name + '.')); return; }
      try { resolve(JSON.parse(text)); }
      catch (e) { reject(fail('config_invalid', 'Executor config ' + name + ' is not valid JSON.')); }
    });
  });
}

/* Agent view. The registry file is NOT passed through: only the fields
   listed here are ever served. agents.json is operator-edited, so a
   credential added to it one day must not become a public field the
   day after. An unrecognised field is dropped silently — the console
   showing less than the file holds is the safe direction, and the
   allowlist is asserted by tests/mos-1-console-test.js.

   `note` is included deliberately. It carries operator context such as
   "unavailable until <ENV_VAR> is provided", which names an environment
   variable rather than a value — the same distinction MCC-1's secret
   gate draws between a credential and documentation of one. */
var AGENT_FIELDS = ['provider', 'capabilities', 'task_types', 'model',
                    'execution_authority', 'risk_level', 'cost', 'latency',
                    'enabled', 'note'];

function agentsView(agents) {
  var out = {};
  Object.keys(agents || {}).forEach(function (id) {
    var src = agents[id] || {};
    var row = {};
    AGENT_FIELDS.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(src, f)) row[f] = src[f];
    });
    out[id] = row;
  });
  return out;
}

/* Provider view. Derived from the agent registry rather than stored
   separately, so it cannot drift from what actually runs. No key,
   endpoint or credential field is read — only identity and authority. */
function providersFrom(agents) {
  var by = {};
  Object.keys(agents || {}).forEach(function (id) {
    var a = agents[id] || {};
    var p = a.provider || 'unknown';
    if (!by[p]) by[p] = { provider: p, agents: [], execution_authority: false, enabled: 0 };
    by[p].agents.push(id);
    if (a.execution_authority) by[p].execution_authority = true;
    if (a.enabled !== false) by[p].enabled++;
  });
  return Object.keys(by).sort().map(function (k) { return by[k]; });
}

/* Budget has no list endpoint — it is GET /budget/<project>. The
   project list comes from the executor's own projects.json, so the
   console shows exactly the projects the executor knows about. A
   project whose ledger cannot be read is reported as unreadable in
   place, not dropped from the list. */
function budgetAll() {
  return readConfig('projects.json').then(function (projects) {
    var names = Object.keys(projects || {});
    return Promise.all(names.map(function (name) {
      return get('/budget/' + encodeURIComponent(name))
        .then(function (b) {
          return {
            project: name,
            currency: b.currency, limit: b.limit, reserved: b.reserved,
            spent: b.spent, remaining: b.remaining,
            configured: b.configured, scope: b.scope, period_key: b.period_key,
            stale_reservations: b.stale_reservations
          };
        })
        .catch(function (e) { return { project: name, error: e.message }; });
    }));
  });
}

function health() {
  return get('/health', { anonymous: true })
    .then(function (h) {
      return { ok: !!h.ok, reachable: true, target: DEFAULT_TARGET, detail: h };
    })
    .catch(function (e) {
      return { ok: false, reachable: e.code !== 'upstream_unreachable', target: DEFAULT_TARGET, error: e.code };
    });
}

module.exports = {
  get: get,
  post: post,
  health: health,
  readConfig: readConfig,
  agentsView: agentsView,
  AGENT_FIELDS: AGENT_FIELDS,
  providersFrom: providersFrom,
  budgetAll: budgetAll,
  loadToken: loadToken,
  configDir: function () { return CONFIG_DIR; },
  target: function () { return DEFAULT_TARGET; }
};
