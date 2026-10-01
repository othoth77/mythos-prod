'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — LIVE lock tests
// projects/mythos-trading-control-center/tests/live-lock-test.js
//
// THE CRITICAL AUDIT. This project puts a network-facing surface in front of a
// trading agent that was built with no network at all. This suite exists to
// prove that doing so opened NO path to live execution:
//
//   no broker client · no real-money execution · no hidden execution path
//   no frontend bypass · no API bypass · no Risk Engine bypass
//   no owner-approval bypass · no config-fingerprint bypass · no commit-binding bypass
//
// It checks three ways, because each catches what the others cannot:
//
//   SOURCE   what the code CONTAINS — greps this project and pins the hashes
//            of the agent's safety-critical files, so "the frozen safety model
//            is unchanged" is a comparison, not a recollection.
//   STATIC   what the route table CAN EXPRESS.
//   DYNAMIC  what actually HAPPENS when every plausible bypass is attempted
//            over HTTP against a running server.
//
// If a hash below changes, that is not a test to update casually: it means a
// LIVE protection changed. Stop, and review that change on its own.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');

var h = require('./helpers');
var agentBoundary = require(path.join(h.ROOT, 'server', 'agent'));

var AGENT_ROOT = agentBoundary.DEFAULT_AGENT_ROOT;
var REPO_ROOT = path.join(h.ROOT, '..', '..');
var BASE_COMMIT = '82b1ce0ca2d2a0a70427d6d64156453824a81c74';

/**
 * SHA-256 of the Trading Agent's safety-critical files at the commit this
 * project was built on (mythos/trading-platform@82b1ce0c).
 */
var FROZEN = {
  'src/execution/live-adapter.js': '5dda1a5ecfaceadc68e92ffbbb5286942a4b0ac01d7a48a1bb5523543f398b62',
  'src/mode/mode-controller.js': 'e454e9f8f3575340471ea1d947d4a2d48ff64933707d7ea5a6a7d2161a25630c',
  'src/mode/gates.js': 'a70a0cdc92d06e7662334e127bb4aeb5817c8a046f01e474a9b3c3bcba015efc',
  'src/config/schema.js': '96d3e1621d644d7cb3918c2fcebc9b544fa4f2cb70ae6ea897a35f1b393876a9',
  'src/risk/engine.js': '19c52fd4d9409239861213e0b3a12eaa18e47a884d91b19884825d569d975f7e',
  'src/recovery/engine.js': 'dc9ccc9522ae6e9fec817d4b12154b8c74ae82d8333e205deee5b8e521878b75',
  'src/jev/gate.js': '2c556217ed3f597d0ab7fe113395858ddaaa8c0f9d3f09ba7e412aaef6925c79',
  'src/execution/paper-adapter.js': 'ede0c1ca0e3f949b0b1af05a88f332dfb13d0f63004531fe5c2dc5b9d82038af',
  'src/paper/session.js': '54b95e3266ceb038abc2018070348a91ff8f93c06d13ca19af995f02e383748c',
  'src/agents/trading-agent.js': '2c912b4449ed2042fbb0af1da4b2f083b275adb9a31f59cef18beb6f7d3cf2ac',
  'src/champion/registry.js': 'ec05858bbe09a550b7099141b912950f0a4d6d3c7bf343c8c7ec61dc6e863ebc',
  'src/account/one-trade-controller.js': '815069a4768690f4f893e45c33a919db2c13a82dcd589f1368bcd587b13bc838',
  'src/observability/health.js': 'bb7482fc35ae08829ae6a957ae0ae02d72dd20083dc6b35b6769cf4ab1d794a4',
  'config/default.json': '6aa85b1401e9b28976e40e77aa2e8e7cafbff04e1a9a3d1c8a97dbe4920a58a2'
};

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function jsFiles(dir) {
  var out = [];
  (function walk(d) {
    var entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    entries.forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); return; }
      if (/\.(js|html)$/.test(e.name)) out.push(p);
    });
  })(dir);
  return out;
}

var S, owner, operator, viewer;

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
});

test.after(async function () { await S.close(); });

async function mode() { return (await viewer.get('/api/status')).body.result.mode; }

// ===========================================================================
// SOURCE
// ===========================================================================

test('SOURCE: the Trading Agent\'s safety-critical files are byte-identical to the frozen baseline', function () {
  Object.keys(FROZEN).forEach(function (rel) {
    assert.equal(sha(path.join(AGENT_ROOT, rel)), FROZEN[rel],
      rel + ' differs from the frozen baseline. A LIVE protection may have changed: stop and review it.');
  });
});

test('SOURCE: nothing under the Trading Agent differs from the base commit', function (t) {
  var res = childProcess.spawnSync('git', ['-C', REPO_ROOT, 'diff', '--stat', BASE_COMMIT, '--', 'projects/mythos-trading-agent'],
    { encoding: 'utf8', timeout: 20000 });
  if (res.status !== 0) {
    // A release directory has no git metadata. The hash pin above still holds;
    // this broader comparison is reported as skipped rather than as passed.
    t.skip('not a git checkout (' + String(res.stderr || res.error).trim().slice(0, 80) + ')');
    return;
  }
  assert.equal(res.stdout.trim(), '', 'the Trading Agent was modified:\n' + res.stdout);
  var untracked = childProcess.spawnSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--', 'projects/mythos-trading-agent'],
    { encoding: 'utf8', timeout: 20000 });
  assert.equal(untracked.stdout.trim(), '', 'untracked or modified files under the Trading Agent:\n' + untracked.stdout);
});

test('SOURCE: this project never imports, names or constructs the live adapter', function () {
  var files = jsFiles(path.join(h.ROOT, 'server')).concat(jsFiles(path.join(h.ROOT, 'web'))).concat(jsFiles(path.join(h.ROOT, 'bin')));
  assert.ok(files.length > 8);
  // Assembled so this test file does not contain the literal it searches for.
  var needle = new RegExp(['live', 'adapter'].join('[-_/]?'), 'i');
  var requireNeedle = new RegExp('execution/' + 'live');
  files.forEach(function (f) {
    var text = fs.readFileSync(f, 'utf8');
    text.split('\n').forEach(function (line, i) {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;         // prose may mention it; code may not
      assert.ok(!requireNeedle.test(line), path.relative(h.ROOT, f) + ':' + (i + 1) + ' references the live execution module');
      if (needle.test(line)) {
        assert.ok(/refus|stub|adapter:\s*'live-refusing-stub'|statement|detail|note|message/i.test(line),
          path.relative(h.ROOT, f) + ':' + (i + 1) + ' mentions the live adapter outside a refusal statement: ' + line.trim());
      }
    });
  });
});

test('SOURCE: the server contains no outbound network client — it listens, it never calls out', function () {
  var files = jsFiles(path.join(h.ROOT, 'server')).concat(jsFiles(path.join(h.ROOT, 'bin')));
  var forbidden = new RegExp([
    'require\\(\\s*[\'"](?:node:)?(?:https|net|tls|dgram|dns|http2)[\'"]\\s*\\)',
    'http\\.(?:request|get)\\s*\\(',
    '\\bfetch\\s*\\(',
    'Web' + 'Socket',
    'XMLHttp' + 'Request',
    '\\.connect\\s*\\(\\s*\\{?\\s*(?:host|port)'
  ].join('|'));
  var offenders = [];
  files.forEach(function (f) {
    if (forbidden.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(h.ROOT, f));
  });
  assert.deepEqual(offenders, [], 'outbound network capability found in: ' + offenders.join(', '));
  // And the only module that may require `http` at all is the server itself.
  var usesHttp = files.filter(function (f) { return /require\(\s*['"](?:node:)?http['"]\s*\)/.test(fs.readFileSync(f, 'utf8')); })
    .map(function (f) { return path.relative(h.ROOT, f); });
  assert.deepEqual(usesHttp, ['server/server.js']);
});

test('SOURCE: the run job starts with an empty environment and no credentials', function () {
  var text = fs.readFileSync(path.join(h.ROOT, 'server', 'runs.js'), 'utf8');
  assert.match(text, /env: \{ NODE_ENV: 'production', TZ: 'UTC' \}/, 'the job must not inherit this process\'s environment');
  var job = fs.readFileSync(path.join(h.ROOT, 'server', 'jobs', 'run-job.js'), 'utf8');
  assert.ok(job.indexOf('process.env') === -1, 'the run job must not read the environment');
});

test('SOURCE: the browser code talks only to this origin\'s API', function (t) {
  var files = jsFiles(path.join(h.ROOT, 'web'));
  if (files.length === 0) { t.skip('no web directory yet'); return; }
  files.forEach(function (f) {
    var text = fs.readFileSync(f, 'utf8');
    var urls = text.match(/https?:\/\/[^\s'"`)<>]+/g) || [];
    urls.forEach(function (u) {
      assert.ok(/^https?:\/\/(www\.w3\.org|trading\.mythosprod\.xyz)/.test(u),
        path.relative(h.ROOT, f) + ' references an external URL: ' + u);
    });
    assert.ok(!new RegExp('Web' + 'Socket').test(text), path.relative(h.ROOT, f) + ' opens a socket');
    var fetches = text.match(/fetch\(\s*([^,)]+)/g) || [];
    fetches.forEach(function (call) {
      assert.ok(!/https?:/.test(call), path.relative(h.ROOT, f) + ' fetches an absolute URL: ' + call);
    });
  });
});

test('SOURCE: the agent\'s own safety checks pass through this project\'s boundary', function () {
  var agent = agentBoundary.load();
  var cfg = agent.buildConfig({}, agent.strategyIds());
  var health = agent.health.create({ config: cfg });
  var refused = health.liveExecutionRefused();
  assert.equal(refused.status, 'OK', refused.detail);
  var net = health.noNetworkClient();
  assert.equal(net.status, 'OK', net.detail);
  assert.equal(agent.gates.isUnsatisfiable('LIVE_ADAPTER_IMPLEMENTED'), true);
  assert.throws(function () { agent.mode.create({ mode: 'LIVE' }); }, /cannot be constructed in LIVE/);
  assert.throws(function () { agent.config.load({ mode: 'LIVE' }); }, /configuration invalid/);
});

// ===========================================================================
// STATIC
// ===========================================================================

test('STATIC: no route names execution, an order, a broker or LIVE', function () {
  S.app.routes.forEach(function (r) {
    assert.ok(!/live|order|execut|broker|venue|fill/i.test(r.path), r.path);
    if (r.audit) assert.ok(!/live|order|execut|broker/i.test(r.audit), r.audit);
  });
});

test('STATIC: the status route states, in words, that LIVE does not exist', async function () {
  var s = (await viewer.get('/api/status')).body.result;
  assert.equal(s.liveExecution.available, false);
  assert.match(s.liveExecution.statement, /does not exist in this build/);
  assert.deepEqual(s.modesAvailable, ['BACKTEST', 'PAPER']);
});

// ===========================================================================
// DYNAMIC — every bypass, attempted
// ===========================================================================

test('DYNAMIC: asking for LIVE is refused by name, for every role, and audited', async function () {
  for (var c of [owner, operator]) {
    var res = await c.post('/api/config/mode', { to: 'LIVE', reason: 'attempt to select LIVE' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'LIVE_NOT_AVAILABLE');
    assert.equal(await mode(), 'BACKTEST');
  }
  var entry = S.app.audit.list({ action: 'mode.set', limit: 1 }).items[0];
  assert.equal(entry.outcome, 'REFUSED');
  assert.equal(entry.code, 'LIVE_NOT_AVAILABLE');
  assert.equal((await viewer.post('/api/config/mode', { to: 'LIVE', reason: 'viewer attempts LIVE' })).status, 403);
});

test('DYNAMIC: a complete, well-formed PAPER→LIVE approval record is still refused', async function () {
  await h.enterPaper(owner, 'enter paper to attempt paper to live');
  assert.equal(await mode(), 'PAPER');
  var agent = agentBoundary.load();
  var required = agent.gates.REQUIRED['PAPER->LIVE'];
  var evidence = {};
  required.forEach(function (g) { evidence[g] = 'claimed evidence for ' + g + ' (it cannot be true)'; });
  var cfg = (await viewer.get('/api/config')).body.result;
  var res = await owner.post('/api/config/mode', {
    to: 'LIVE', reason: 'owner presents a full paper to live record',
    approval: {
      ownerApproval: true,
      statement: 'I approve the Mythos Trading Agent transition PAPER -> LIVE',
      configFingerprint: cfg.fingerprint, commit: cfg.commit,
      gatesPassed: required.slice(), gateEvidence: evidence, nonce: 'live-attempt-0001'
    }
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'LIVE_NOT_AVAILABLE',
    'the Control Center must refuse LIVE before the approval record is even considered');
  assert.equal(await mode(), 'PAPER');
  var dry = await owner.post('/api/config/mode/dry-run', { to: 'LIVE' });
  assert.equal(dry.body.result.ok, false);
  await operator.post('/api/config/mode', { to: 'BACKTEST', reason: 'back to backtest after the attempt' });
});

test('DYNAMIC: spelling variants and smuggled fields do not select LIVE either', async function () {
  for (var to of ['live', 'Live', ' LIVE', 'LIVE ', 'LIVE\n', 'L1VE', 'PAPER,LIVE', '']) {
    var res = await owner.post('/api/config/mode', { to: to, reason: 'variant spelling of the target' });
    assert.ok(res.status === 400 || res.status === 403, JSON.stringify(to) + ' → ' + res.status);
    assert.equal(await mode(), 'BACKTEST', JSON.stringify(to));
  }
  var arr = await owner.post('/api/config/mode', { to: ['LIVE'], reason: 'an array as the target' });
  assert.equal(arr.status, 400);
  var smuggle = await owner.post('/api/config/mode', { to: 'BACKTEST', mode: 'LIVE', live: true, reason: 'extra fields' });
  assert.equal(smuggle.status, 400);
  assert.equal(await mode(), 'BACKTEST');
});

test('DYNAMIC: the configuration route cannot set the mode, to LIVE or to anything', async function () {
  for (var changes of [{ mode: 'LIVE' }, { mode: 'PAPER' }, { execution: { live: true } }, { live: true }]) {
    var res = await owner.patch('/api/config', { changes: changes, reason: 'mode through the config route', confirm: 'CONFIRM' });
    assert.equal(res.status, 400, JSON.stringify(changes));
    assert.equal(res.body.error.code, 'CONFIG_CHANGE_NOT_ALLOWED');
  }
  assert.equal(await mode(), 'BACKTEST');
  assert.equal((await viewer.get('/api/config')).body.result.config.mode, 'BACKTEST');
});

test('DYNAMIC: a backtest or paper request cannot carry a mode, a size or an adapter', async function () {
  for (var body of [{ mode: 'LIVE' }, { lots: 1 }, { adapter: 'live' }, { risk: { maxOpenTrades: 3 } },
    { risk: { emergencyStop: false } }, { config: { mode: 'LIVE' } }, { approvedLots: 5 }]) {
    var bt = await owner.post('/api/backtest', body);
    assert.equal(bt.status, 400, 'backtest ' + JSON.stringify(body) + ' → ' + bt.status);
    var pp = await owner.post('/api/paper/start', body);
    assert.equal(pp.status, 400, 'paper ' + JSON.stringify(body) + ' → ' + pp.status);
  }
});

test('DYNAMIC: a paper session cannot start outside PAPER mode — the owner approval cannot be skipped', async function () {
  assert.equal(await mode(), 'BACKTEST');
  for (var c of [owner, operator]) {
    var res = await c.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 600 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PAPER_MODE_REQUIRED');
  }
  assert.equal((await viewer.get('/api/paper')).body.result.state, 'IDLE');
});

test('DYNAMIC: PAPER is refused when the approval cannot be bound to a commit', async function () {
  var A = await h.startApp({ commit: false });
  var o = await A.login('owner');
  var sys = (await o.get('/api/system')).body.result;
  assert.equal(sys.commitKnown, false);
  var req = (await o.get('/api/config/mode')).body.result.toPaper;
  var evidence = {};
  req.gates.forEach(function (g) { evidence[g.gate] = 'evidence for ' + g.gate + ' in a build with no commit'; });
  var res = await o.post('/api/config/mode', {
    to: 'PAPER', reason: 'approve paper with no commit to bind to',
    approval: { ownerApproval: true, statement: req.requiredStatement, configFingerprint: req.configFingerprint,
      commit: 'abcdef1', gatesPassed: req.gates.map(function (g) { return g.gate; }), gateEvidence: evidence, nonce: 'no-commit-0001' }
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'COMMIT_UNKNOWN');
  assert.equal((await o.get('/api/status')).body.result.mode, 'BACKTEST');
  await A.close();
});

test('DYNAMIC: the mode is raised by the agent\'s controller alone — the platform holds no other switch', function () {
  var control = S.app.platform.control;
  assert.equal(typeof control.setMode, 'function');
  ['forceMode', 'setModeUnsafe', 'enterLive', 'live', 'setLive', 'overrideMode'].forEach(function (name) {
    assert.equal(control[name], undefined, 'control.' + name + ' must not exist');
    assert.equal(S.app.platform[name], undefined, 'platform.' + name + ' must not exist');
  });
  // The controller object is the agent's, and it refuses an AGENT or OPERATOR upgrade itself.
  var mc = control.modeController();
  assert.throws(function () { mc.transition({ to: 'PAPER', principal: { kind: 'OPERATOR', id: 'operator:x' }, approval: {} }); },
    /only an OWNER principal/);
  assert.throws(function () { mc.transition({ to: 'LIVE', principal: { kind: 'AGENT', id: 'agent:x' } }); }, /only an OWNER principal/);
});

test('DYNAMIC: even the internal control function refuses LIVE for an OWNER', function () {
  var control = S.app.platform.control;
  assert.throws(function () { control.setMode({ to: 'LIVE', reason: 'direct call' }, { id: 'owner', role: 'OWNER' }); },
    function (e) { return e.code === 'LIVE_NOT_AVAILABLE'; });
  assert.throws(function () { S.app.platform.setMode({ to: 'LIVE', reason: 'direct call' }, { id: 'owner', role: 'OWNER' }); },
    function (e) { return e.code === 'LIVE_NOT_AVAILABLE'; });
  assert.equal(control.mode(), 'BACKTEST');
});

test('DYNAMIC: a paper session, once legitimately started, sends no order and marks every record as paper', async function () {
  var cfgBefore = (await viewer.get('/api/config')).body.result;
  await owner.patch('/api/config', { changes: { account: { initialCapital: 5000 }, jev: { scoreThreshold: 45, minConfidence: 0.15 },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } }, reason: 'make the paper account large enough to trade', confirm: 'CONFIRM' });
  await h.enterPaper(owner, 'owner approves paper for the live lock test');
  var start = await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 700 } });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.equal(start.body.result.placesRealOrders, false);
  assert.equal(start.body.result.feedKind, 'REPLAY');
  while (S.app.platform.paper.step()) { /* run the whole replay */ }
  var view = (await viewer.get('/api/paper')).body.result;
  assert.equal(view.state, 'STOPPED');
  var runId = view.session.sessionId;

  var trades = (await viewer.get('/api/trades?run=' + runId + '&limit=500')).body.result.data.items;
  assert.ok(trades.length > 0, 'the session should have traded');
  trades.forEach(function (t) {
    assert.equal(t.paper, true, 'every paper trade must be marked paper');
    assert.equal(t.lots, t.approvedLots, 'every paper trade ran at the Risk Engine\'s approved size');
  });
  var tables = S.app.platform.runs.tables(runId, 'store').tables;
  assert.ok(tables.orders.every(function (o) { return o.paper === true; }));
  assert.equal(tables.backtests[0].mode, 'PAPER');
  assert.equal(await mode(), 'PAPER', 'a finished paper session leaves the mode at PAPER, never above');
  assert.notEqual(cfgBefore.fingerprint, (await viewer.get('/api/config')).body.result.fingerprint);
});

test('DYNAMIC: lowering the mode stops an active paper session before the mode changes', async function () {
  await owner.post('/api/paper/reset', { confirm: 'RESET' });
  var start = await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 700 } });
  assert.equal(start.status, 200);
  for (var i = 0; i < 300; i++) S.app.platform.paper.step();
  var down = await operator.post('/api/config/mode', { to: 'BACKTEST', reason: 'reduce exposure with a session running' });
  assert.equal(down.status, 200);
  assert.equal(down.body.result.paperSessionStopped, true);
  assert.equal(await mode(), 'BACKTEST');
  var view = (await viewer.get('/api/paper')).body.result;
  assert.equal(view.state, 'STOPPED');
  assert.equal(view.session.stopReason, 'MODE_DOWNGRADE');
  assert.equal(S.app.platform.paper.step(), false, 'a stopped session cannot be advanced');
  await owner.post('/api/paper/reset', { confirm: 'RESET' });
});

test('DYNAMIC: after every attempt above, the mode is BACKTEST, health is not FAIL, and the chain is intact', async function () {
  assert.equal(await mode(), 'BACKTEST');
  var sys = (await viewer.get('/api/system')).body.result;
  var safe = sys.health.staticChecks.filter(function (c) { return c.check === 'MODE_IS_SAFE'; })[0];
  assert.equal(safe.status, 'OK');
  var refused = sys.health.staticChecks.filter(function (c) { return c.check === 'LIVE_EXECUTION_REFUSED'; })[0];
  assert.equal(refused.status, 'OK');
  assert.equal(sys.liveExecution.refusalVerified, true);
  assert.equal((await viewer.get('/api/audit/verify')).body.result.ok, true);
  var modeEvents = (await viewer.get('/api/config/mode')).body.result.events;
  assert.ok(modeEvents.every(function (e) { return e.toMode !== 'LIVE'; }), 'no mode event may ever name LIVE as a destination');
  var refusals = S.app.audit.list({ action: 'mode.set', outcome: 'REFUSED', limit: 200 }).items;
  assert.ok(refusals.filter(function (e) { return e.code === 'LIVE_NOT_AVAILABLE'; }).length >= 3);
});
