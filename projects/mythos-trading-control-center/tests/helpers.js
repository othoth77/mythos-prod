'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — test helpers
// projects/mythos-trading-control-center/tests/helpers.js
//
// Every suite starts a REAL server on an ephemeral loopback port with a
// throwaway state directory, and talks to it over HTTP. Nothing is mocked: the
// Trading Agent behind the API is the real one, so a passing test is a
// statement about the system and not about a stand-in.
//
// The state directory is always a mkdtemp() path. No suite here can write to a
// production default, by construction.
// =====================================================

var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var serverMod = require(path.join(ROOT, 'server', 'server'));
var authMod = require(path.join(ROOT, 'server', 'auth'));

var PASSWORDS = {
  owner: 'owner-password-for-tests',
  operator: 'operator-password-for-tests',
  viewer: 'viewer-password-for-tests'
};

// scrypt is deliberately slow; build the three records once per process.
var USERS = null;
function users() {
  if (!USERS) {
    USERS = [
      authMod.makeUser('owner', 'OWNER', PASSWORDS.owner),
      authMod.makeUser('operator', 'OPERATOR', PASSWORDS.operator),
      authMod.makeUser('viewer', 'VIEWER', PASSWORDS.viewer)
    ];
  }
  return USERS;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'tcc-test-'));
}

/**
 * Starts a server. Returns { app, base, port, stateDir, close(), client() }.
 */
async function startApp(opts) {
  var o = opts || {};
  var stateDir = o.stateDir || tempDir('tcc-test-state-');
  var app = serverMod.create(Object.assign({
    stateDir: stateDir,
    users: users(),
    log: null,
    auditSink: null,
    paperAutoTick: false,
    // Generous by default so suites are not rate limited by accident; the
    // suites that test the limiter pass their own.
    rateBuckets: {
      read: { limit: 100000, windowMs: 60000 }, write: { limit: 100000, windowMs: 60000 },
      heavy: { limit: 100000, windowMs: 60000 }, login: { limit: 100000, windowMs: 60000 }
    }
  }, o));
  var addr = await app.listen(0, '127.0.0.1');
  var base = 'http://127.0.0.1:' + addr.port;
  return {
    app: app,
    base: base,
    port: addr.port,
    stateDir: stateDir,
    client: function () { return client(addr.port); },
    login: async function (role) {
      var c = client(addr.port);
      var res = await c.login(role, PASSWORDS[role]);
      if (res.status !== 200) throw new Error('login as ' + role + ' failed: ' + res.status + ' ' + JSON.stringify(res.body));
      return c;
    },
    close: async function () {
      await app.close();
      if (!o.stateDir) { try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
    }
  };
}

/** A minimal cookie-aware JSON client. */
function client(port) {
  var cookie = null;
  var csrf = null;

  function request(method, pathName, body, extraHeaders, rawBody) {
    return new Promise(function (resolve, reject) {
      var headers = Object.assign({}, extraHeaders || {});
      var payload = null;
      if (rawBody !== undefined) {
        payload = Buffer.from(rawBody);
      } else if (body !== undefined && body !== null) {
        payload = Buffer.from(JSON.stringify(body));
        if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
      }
      if (payload) headers['Content-Length'] = payload.length;
      if (cookie && headers.Cookie === undefined) headers.Cookie = cookie;
      if (headers.Cookie === null) delete headers.Cookie;
      if (csrf && method !== 'GET' && method !== 'HEAD' && headers['X-TCC-CSRF'] === undefined) headers['X-TCC-CSRF'] = csrf;
      if (headers['X-TCC-CSRF'] === null) delete headers['X-TCC-CSRF'];
      // agent: false — one connection per request. A pooled keep-alive socket can
      // be closed by the server (keepAliveTimeout) while a test blocks the event
      // loop driving a session, and reusing it then fails with ECONNRESET.
      var req = http.request({ host: '127.0.0.1', port: port, method: method, path: pathName, headers: headers, agent: false }, function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf8');
          var parsed = null;
          try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, text: text });
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  var api = {
    request: request,
    get: function (p, headers) { return request('GET', p, null, headers); },
    post: function (p, body, headers) { return request('POST', p, body === undefined ? {} : body, headers); },
    patch: function (p, body, headers) { return request('PATCH', p, body === undefined ? {} : body, headers); },
    login: async function (user, password) {
      var res = await request('POST', '/api/auth/login', { user: user, password: password });
      if (res.status === 200) {
        var set = res.headers['set-cookie'];
        cookie = set && set[0] ? set[0].split(';')[0] : null;
        csrf = res.body.result.csrf;
      }
      return res;
    },
    logout: function () { return request('POST', '/api/auth/logout', {}); },
    cookie: function () { return cookie; },
    csrf: function () { return csrf; },
    setCookie: function (c) { cookie = c; },
    setCsrf: function (t) { csrf = t; }
  };
  return api;
}

async function waitFor(fn, timeoutMs, intervalMs) {
  var deadline = Date.now() + (timeoutMs || 60000);
  for (;;) {
    var v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('waitFor: timed out after ' + (timeoutMs || 60000) + ' ms');
    await new Promise(function (r) { setTimeout(r, intervalMs || 100); });
  }
}

/** Starts a backtest through the API and waits for it to finish. */
async function runBacktest(c, body) {
  var res = await c.post('/api/backtest', body || {});
  if (res.status !== 202) throw new Error('backtest did not start: ' + res.status + ' ' + JSON.stringify(res.body));
  var runId = res.body.result.run.runId;
  var done = await waitFor(async function () {
    var r = await c.get('/api/jobs/' + runId);
    return r.body.result.run.status !== 'RUNNING' ? r.body.result.run : null;
  }, 120000, 150);
  return done;
}

/** A small, fast backtest: one fixture symbol, fixed slippage so runs compare exactly. */
var FAST_BACKTEST = {
  symbols: ['EURUSD'],
  initialCapital: 5000,
  data: { kind: 'FIXTURE', bars: 1200 },
  jev: { scoreThreshold: 45, minConfidence: 0.15 },
  cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 }
};

/**
 * A complete owner-approval submission for BACKTEST → PAPER, built from the
 * requirements the API itself publishes. That the gate is passable when it
 * should be is part of what these suites prove.
 */
async function paperApproval(c, over) {
  var mode = await c.get('/api/config/mode');
  var req = mode.body.result.toPaper;
  var evidence = {};
  req.gates.forEach(function (g) { evidence[g.gate] = 'evidence for ' + g.gate + ': see docs/VALIDATION_GATES.md'; });
  return Object.assign({
    ownerApproval: true,
    statement: req.requiredStatement,
    configFingerprint: req.configFingerprint,
    commit: req.commit,
    gatesPassed: req.gates.map(function (g) { return g.gate; }),
    gateEvidence: evidence,
    nonce: 'nonce-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
  }, over || {});
}

/** Moves the platform into PAPER as the owner. */
async function enterPaper(ownerClient, reason) {
  var approval = await paperApproval(ownerClient);
  var res = await ownerClient.post('/api/config/mode', { to: 'PAPER', reason: reason || 'owner approves paper for the test', approval: approval });
  if (res.status !== 200) throw new Error('could not enter PAPER: ' + res.status + ' ' + JSON.stringify(res.body));
  return res;
}

module.exports = {
  ROOT: ROOT,
  PASSWORDS: PASSWORDS,
  users: users,
  tempDir: tempDir,
  startApp: startApp,
  client: client,
  waitFor: waitFor,
  runBacktest: runBacktest,
  FAST_BACKTEST: FAST_BACKTEST,
  paperApproval: paperApproval,
  enterPaper: enterPaper
};
