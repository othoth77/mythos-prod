'use strict';
// =====================================================
// MYTHOS HADDAD — HAD-3: OTH MCP on Haddad (launcher + configuration layer)
// tests/mythos-haddad-mcp-test.js
//
// The server itself (projects/oth-mcp/server.js) is covered by
// tests/othk-6-mcp-server-test.js and is NOT re-tested here. This suite
// covers what HAD-3 adds around it, and nothing else:
//   * reuse, not duplication: the launcher runs projects/oth-mcp/server.js
//     and no second MCP server exists under projects/mythos-haddad;
//   * the launcher and setup carry no secret and no host-key bypass;
//   * the credential-by-reference path: the executor bearer read from the
//     executor's own env file reaches the upstream — and never the client;
//   * the real chain through the launcher: initialize → tools/list →
//     tools/call → a (fake, loopback) executor → correct result;
//   * fail-closed: no token file → UNCONFIGURED; wrong bearer → 401;
//     traversal-shaped ids rejected; malformed frame → parse error;
//   * lifecycle: stdin end → clean exit, repeated and concurrent clients.
// Offline and machine-independent: a fake executor on an ephemeral
// loopback port, a throwaway config dir, an invented token.
// =====================================================
var assert = require('assert');
var cp = require('child_process');
var fs = require('fs');
var http = require('http');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DIR = path.join(ROOT, 'projects', 'mythos-haddad');
var LAUNCHER = path.join(DIR, 'bin', 'haddad-mcp-stdio.sh');
var SETUP = path.join(DIR, 'bin', 'haddad-mcp-setup.sh');
var SERVER = path.join(ROOT, 'projects', 'oth-mcp', 'server.js');
var mcp = require(SERVER);

var pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); } }
function at(name, fn) { return fn().then(function () { pass++; console.log('ok - ' + name); }, function (e) { fail++; console.log('not ok - ' + name + '\n  ' + (e && e.stack || e)); }); }
function run(cmd, args, opts) { return cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 60000 }, opts || {})); }

var TOKEN = 'haddad-test-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-mcp-'));
var CFG = path.join(TMP, 'cfg'); fs.mkdirSync(CFG, { mode: 448 });
var EXEC_ENV = path.join(TMP, 'executor.env');
fs.writeFileSync(EXEC_ENV, '# executor\nMYTHOS_EXECUTOR_TOKEN=' + TOKEN + '\n', { mode: 384 });

// A loopback stand-in for the executor API: same auth contract as
// projects/mythos-ai-executor/server.js (bearer on every route but /health).
var seen = [];
function fakeExecutor() {
  return new Promise(function (resolve) {
    var srv = http.createServer(function (req, res) {
      seen.push({ url: req.url, auth: req.headers.authorization || null });
      var m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
      if (!m || m[1] !== TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"unauthorized"}'); }
      if (req.url === '/tasks') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ tasks: [{ id: 't-haddad-0001', status: 'COMPLETED' }] })); }
      if (req.url === '/tasks/t-haddad-0001/report') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ report: { summary: 'done on haddad' } })); }
      if (req.url === '/budget/mythos-haddad') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ project: 'mythos-haddad', configured: false, limit: 0 })); }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"not found"}');
    });
    srv.listen(0, '127.0.0.1', function () { resolve({ srv: srv, port: srv.address().port }); });
  });
}

function writeEnv(cfgDir, lines) { fs.writeFileSync(path.join(cfgDir, 'mcp.env'), lines.join('\n') + '\n', { mode: 384 }); }

// Drive the launcher as a raw client: newline-delimited JSON-RPC over
// stdio. stdin stays open until every id sent has been answered (a stdio
// server exits with its stdin), then it is closed and the exit awaited.
function client(frames, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var env = Object.assign({}, process.env, { HADDAD_MCP_CONFIG_DIR: opts.cfg || CFG });
    delete env.OTH_MCP_EXECUTOR_TOKEN; delete env.OTH_MCP_EXECUTOR_URL; delete env.OTH_MCP_EXECUTOR_TOKEN_FILE;
    var p = cp.spawn(LAUNCHER, [], { env: env, stdio: ['pipe', 'pipe', 'pipe'] });
    var out = '', err = '', ended = false;
    var expected = {}; frames.forEach(function (f) { if (f && typeof f === 'object' && f.id !== undefined) expected[f.id] = true; });
    var parseErrors = frames.filter(function (f) { return typeof f === 'string'; }).length;
    function answered() {
      var lines = out.split('\n').filter(Boolean), got = {}, perr = 0;
      lines.forEach(function (l) { try { var m = JSON.parse(l); if (m.id !== undefined && m.id !== null) got[m.id] = true; else if (m.error) perr++; } catch (e) { /* partial line */ } });
      return Object.keys(expected).every(function (id) { return got[id]; }) && perr >= parseErrors;
    }
    function endStdin() { if (!ended) { ended = true; clearTimeout(guard); try { p.stdin.end(); } catch (e) { /* gone */ } } }
    var guard = setTimeout(endStdin, 25000);
    p.stdout.on('data', function (d) { out += d; if (answered()) endStdin(); });
    p.stderr.on('data', function (d) { err += d; });
    p.on('close', function (code) {
      var parsed = out.split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return { unparseable: l }; } });
      var byId = {}; parsed.forEach(function (f) { if (f.id !== undefined) byId[f.id] = f; });
      resolve({ code: code, out: out, err: err, frames: parsed, byId: byId });
    });
    frames.forEach(function (f) { p.stdin.write((typeof f === 'string' ? f : JSON.stringify(f)) + '\n'); });
    if (!Object.keys(expected).length && !parseErrors) endStdin();
  });
}
var INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } };
var LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
function call(id, name, args) { return { jsonrpc: '2.0', id: id, method: 'tools/call', params: { name: name, arguments: args || {} } }; }
function text(frame) { return frame && frame.result && frame.result.content && frame.result.content[0] && frame.result.content[0].text || ''; }

// ---------------------------------------------------------------- static
t('launcher and setup exist, are executable and parse', function () {
  [LAUNCHER, SETUP].forEach(function (f) {
    assert.ok(fs.statSync(f).mode & 64, f + ' not executable');
    var r = run('bash', ['-n', f]); assert.strictEqual(r.status, 0, r.stderr);
  });
});

t('reuse, not duplication: the launcher runs projects/oth-mcp/server.js and no second MCP server exists under mythos-haddad', function () {
  var src = fs.readFileSync(LAUNCHER, 'utf8');
  assert.ok(/projects\/oth-mcp\/server\.js/.test(src), 'launcher does not reference the shared server');
  assert.ok(/exec node "\$SERVER"/.test(src), 'launcher does not exec the shared server');
  var walk = function (d, acc) { fs.readdirSync(d).forEach(function (f) { var p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p, acc); else acc.push(p); }); return acc; };
  walk(DIR, []).forEach(function (f) {
    if (!/\.js$/.test(f)) return;
    var s = fs.readFileSync(f, 'utf8');
    // A server answers these methods; a client (the probe, via the shared mcp-client) only sends them.
    assert.ok(!/method === '(initialize|tools\/list|tools\/call)'/.test(s), 'second MCP server implementation found: ' + f);
  });
});

t('no secret value, no host-key bypass, no sudo in the HAD-3 files', function () {
  [LAUNCHER, SETUP].forEach(function (f) {
    var s = fs.readFileSync(f, 'utf8');
    assert.ok(!/StrictHostKeyChecking\s*=?\s*no/.test(s), f + ' bypasses host key checking');
    assert.ok(!/^\s*sudo\b/m.test(s), f + ' uses sudo');
    assert.ok(!/(TOKEN|KEY|SECRET)=[A-Za-z0-9+\/]{20,}/.test(s), f + ' carries a literal credential');
  });
  // The generated mcp.env carries paths and URLs only — the bearer stays in the executor's file.
  var setup = fs.readFileSync(SETUP, 'utf8');
  var envBlock = /cat > "\$ENV_FILE" <<ENV([\s\S]*?)^ENV$/m.exec(setup);
  assert.ok(envBlock, 'setup does not write mcp.env via heredoc');
  assert.ok(!/OTH_MCP_EXECUTOR_TOKEN=/.test(envBlock[1]), 'mcp.env would carry the token value');
  assert.ok(/OTH_MCP_EXECUTOR_TOKEN_FILE=/.test(envBlock[1]), 'mcp.env does not reference the executor file');
});

t('the shared server is the VPS one: 8 read-only tools, GET is the only upstream verb', function () {
  assert.strictEqual(mcp.TOOLS.length, 8);
  var src = fs.readFileSync(SERVER, 'utf8');
  assert.ok(/method: 'GET'/.test(src));
  assert.ok(!/method: '(POST|PUT|PATCH|DELETE)'/.test(src));
  assert.strictEqual(mcp.PROTOCOL_VERSION, '2024-11-05');
});

t('the health check has an mcp check that is optional when uninstalled', function () {
  var s = fs.readFileSync(path.join(DIR, 'bin', 'haddad-health.js'), 'utf8');
  assert.ok(/check\('mcp'/.test(s));
  assert.ok(/haddad-mcp-setup\.sh/.test(s), 'uninstalled hint missing');
});

// --------------------------------------------------------------- dynamic
var exec_;
at('fake executor up', function () { return fakeExecutor().then(function (e) { exec_ = e; }); })
.then(function () {
  writeEnv(CFG, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + EXEC_ENV]);

  return at('real chain: initialize → tools/list → execution_status → fake executor → correct result, token never returned', function () {
    return client([INIT, LIST, call(3, 'execution_status'), call(4, 'execution_report', { task_id: 't-haddad-0001' }), call(5, 'budget_status', { project: 'mythos-haddad' })]).then(function (r) {
      assert.strictEqual(r.code, 0, 'exit ' + r.code + ' ' + r.err);
      assert.strictEqual(r.byId[1].result.serverInfo.name, 'oth-mcp');
      assert.strictEqual(r.byId[2].result.tools.length, 8);
      assert.ok(!r.byId[3].result.isError, text(r.byId[3]));
      assert.deepStrictEqual(JSON.parse(text(r.byId[3])), { tasks: [{ id: 't-haddad-0001', status: 'COMPLETED' }] });
      assert.deepStrictEqual(JSON.parse(text(r.byId[4])).report, { summary: 'done on haddad' });
      assert.strictEqual(JSON.parse(text(r.byId[5])).configured, false);
      assert.strictEqual(seen[seen.length - 1].auth, 'Bearer ' + TOKEN, 'bearer did not reach the upstream by reference');
      assert.ok(r.out.indexOf(TOKEN) === -1 && r.err.indexOf(TOKEN) === -1, 'token leaked to the client side');
    });
  });
})
.then(function () {
  return at('fail closed: no executor token file → UPSTREAM_UNCONFIGURED, nothing invented, no upstream call', function () {
    var cfg = path.join(TMP, 'cfg-notoken'); fs.mkdirSync(cfg);
    writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + path.join(TMP, 'absent.env')]);
    var before = seen.length;
    return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
      assert.ok(r.byId[3].result.isError);
      assert.ok(/^UPSTREAM_UNCONFIGURED: Mythos AI Executor/.test(text(r.byId[3])), text(r.byId[3]));
      assert.strictEqual(seen.length, before);
    });
  });
})
.then(function () {
  return at('unauthorized: a wrong bearer is refused by the upstream and reported as UPSTREAM_401', function () {
    var cfg = path.join(TMP, 'cfg-badtoken'); fs.mkdirSync(cfg);
    var bad = path.join(TMP, 'bad.env'); fs.writeFileSync(bad, 'MYTHOS_EXECUTOR_TOKEN=not-the-token\n', { mode: 384 });
    writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:' + exec_.port, 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + bad]);
    return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
      assert.ok(/^UPSTREAM_401/.test(text(r.byId[3])), text(r.byId[3]));
    });
  });
})
.then(function () {
  return at('invalid / malformed / traversal-shaped requests are rejected without reaching the upstream', function () {
    var before = seen.length;
    return client([INIT,
      '{not json',
      { jsonrpc: '2.0', id: 10, method: 'no/such/method' },
      call(11, 'no_such_tool'),
      call(12, 'execution_report', {}),
      call(13, 'execution_report', { task_id: '../../etc/passwd' }),
      call(14, 'budget_status', { project: '../secrets' }),
      call(15, 'execution_status', { task_id: 'x'.repeat(65) }),
    ]).then(function (r) {
      var parseErr = r.frames.filter(function (f) { return f.error && f.error.code === -32700; });
      assert.strictEqual(parseErr.length, 1, 'malformed frame not answered with -32700');
      assert.strictEqual(r.byId[10].error.code, -32601);
      assert.ok(/No such tool/.test(text(r.byId[11])));
      assert.ok(/TOOL_INPUT: task_id is required/.test(text(r.byId[12])));
      // The id is URL-encoded, so the executor route regex never matches it: 404 from the upstream, never a file.
      assert.ok(/UPSTREAM_404/.test(text(r.byId[13])), text(r.byId[13]));
      assert.ok(seen.filter(function (s) { return /passwd/.test(s.url); }).every(function (s) { return s.url.indexOf('..%2F') !== -1; }), 'traversal id sent unencoded');
      assert.ok(/TOOL_INPUT: project must match/.test(text(r.byId[14])));
      assert.ok(/TOOL_INPUT: task_id exceeds/.test(text(r.byId[15])));
      assert.ok(seen.length - before <= 1, 'more than the encoded 404 probe reached the upstream');
    });
  });
})
.then(function () {
  return at('timeout: an upstream that never answers is reported as UPSTREAM_TIMEOUT-class, not hung forever', function () {
    // The server's own 15 s bound applies; here the socket is refused, which is the fast variant of the same fail-closed path.
    var cfg = path.join(TMP, 'cfg-down'); fs.mkdirSync(cfg);
    writeEnv(cfg, ['OTH_MCP_EXECUTOR_URL=http://127.0.0.1:1', 'OTH_MCP_EXECUTOR_TOKEN_FILE=' + EXEC_ENV]);
    return client([INIT, call(3, 'execution_status')], { cfg: cfg }).then(function (r) {
      assert.ok(/^UPSTREAM_UNREACHABLE: Mythos AI Executor/.test(text(r.byId[3])), text(r.byId[3]));
    });
  });
})
.then(function () {
  return at('lifecycle: stdin end → exit 0; three concurrent clients each get their own answers', function () {
    return Promise.all([0, 1, 2].map(function (i) { return client([INIT, call(100 + i, 'execution_status')]); })).then(function (rs) {
      rs.forEach(function (r, i) {
        assert.strictEqual(r.code, 0);
        assert.ok(r.byId[100 + i] && !r.byId[100 + i].result.isError, 'client ' + i + ': ' + text(r.byId[100 + i]));
      });
    });
  });
})
.then(function () {
  return at('knowledge tools stay UNCONFIGURED on Haddad until HAD-1 (never a guess)', function () {
    return client([INIT, call(3, 'knowledge_search', { query: 'anything' })]).then(function (r) {
      assert.ok(/^UPSTREAM_UNCONFIGURED: OTH Knowledge/.test(text(r.byId[3])), text(r.byId[3]));
    });
  });
})
.then(function () {
  return at('setup script dry run into a throwaway home: launcher + mcp.env + executor.env, 8 tools verified, no secret in mcp.env', function () { return Promise.resolve().then(function () {
    var home = path.join(TMP, 'home'); fs.mkdirSync(home);
    var r = run('bash', [SETUP], { env: Object.assign({}, process.env, { HOME: home, HADDAD_MCP_REPO: ROOT }) });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    var launcher = path.join(home, '.local', 'bin', 'haddad-mcp-stdio.sh');
    assert.ok(fs.existsSync(launcher));
    assert.strictEqual(fs.statSync(launcher).mode & 511, 488, 'launcher not 0750');
    assert.ok(fs.readFileSync(launcher, 'utf8').indexOf('REPO="' + ROOT + '"') !== -1, '@REPO@ not substituted');
    var envFile = path.join(home, '.config', 'mythos-haddad', 'mcp.env');
    var execEnv = path.join(home, '.config', 'mythos-ai-executor', 'executor.env');
    [envFile, execEnv].forEach(function (f) { assert.strictEqual(fs.statSync(f).mode & 511, 384, f + ' not 0600'); });
    var env = fs.readFileSync(envFile, 'utf8');
    assert.ok(/^OTH_MCP_EXECUTOR_TOKEN_FILE=/m.test(env) && !/^OTH_MCP_EXECUTOR_TOKEN=/m.test(env));
    var tok = /^MYTHOS_EXECUTOR_TOKEN=([A-Za-z0-9]{40,48})$/m.exec(fs.readFileSync(execEnv, 'utf8'));
    assert.ok(tok, 'executor token not provisioned in the executor idiom');
    assert.ok(r.stdout.indexOf(tok[1]) === -1, 'setup printed the token');
    assert.ok(/OK — 8 tools listed/.test(r.stdout));
    assert.ok(/restart the worker/.test(r.stdout), 'new-token restart note missing');
    // Idempotent: a second run keeps the token.
    var r2 = run('bash', [SETUP], { env: Object.assign({}, process.env, { HOME: home, HADDAD_MCP_REPO: ROOT }) });
    assert.strictEqual(r2.status, 0, r2.stdout + r2.stderr);
    assert.strictEqual(/^MYTHOS_EXECUTOR_TOKEN=(.+)$/m.exec(fs.readFileSync(execEnv, 'utf8'))[1], tok[1], 'token rotated on re-run');
    assert.ok(/already provisioned/.test(r2.stdout));
  }); });
})
.then(function () {
  exec_.srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
