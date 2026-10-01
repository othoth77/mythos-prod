'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — whole-surface integration and LIVE audit
// projects/mythos-trading-control-center/tests/integration-test.js
//
// The other suites each prove a part. This one asks the questions that are
// only meaningful about the WHOLE, after every part exists:
//
//   · does the interface call only routes that exist, and is every route
//     reachable from a test?
//   · after the platform has done everything it can do — backtest, experiment,
//     paper, demo, tests — is there ANY trade that got past Jev, past the Risk
//     Engine, past the recovery cap or past the one-trade rule?
//   · can any mutation route be made to carry a mode, a size or an adapter?
//   · did the server process open a connection to anywhere but its own
//     clients? did running the platform change one byte of the Trading Agent?
//   · is the mode still BACKTEST, and LIVE still unreachable, at the end?
//
// THE CRITICAL LIVE AUDIT of the mission is the second half of this file plus
// tests/live-lock-test.js. If one of these fails, a LIVE protection changed:
// stop, and fix or revert before anything else.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var crypto = require('crypto');
var fs = require('fs');
var net = require('net');
var path = require('path');

var h = require('./helpers');
var serverMod = require('../server/server');

var S, owner, operator, viewer, stateDir;
var runs = {};           // name → runId of every kind of run the platform can make
var agentBefore;
var connections = [];    // every outbound connect() made in THIS process
var originalConnect = net.Socket.prototype.connect;

function treeDigest(dir) {
  var hash = crypto.createHash('sha256');
  var count = 0;
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p); return; }
      hash.update(path.relative(dir, p) + '\0');
      hash.update(fs.readFileSync(p));
      count++;
    });
  })(dir);
  return { digest: hash.digest('hex'), files: count };
}

function webFiles() {
  var out = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name)) out.push(p);
    });
  })(path.join(h.ROOT, 'web', 'assets', 'js'));
  return out;
}

async function get(c, p) {
  var r = await c.get(p);
  assert.equal(r.status, 200, p + ' → ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body.result;
}
async function waitJob(runId) {
  return h.waitFor(async function () {
    var r = await viewer.get('/api/jobs/' + runId);
    return r.body.result.run.status !== 'RUNNING' ? r.body.result.run : null;
  }, 180000, 150);
}

test.before(async function () {
  // Record every connection this process opens, from before the server exists.
  net.Socket.prototype.connect = function () {
    var a = arguments[0];
    if (Array.isArray(a)) a = a[0];
    connections.push(a && typeof a === 'object' ? { host: a.host || a.path || 'localhost', port: a.port } : { host: String(arguments[1] || 'localhost'), port: a });
    return originalConnect.apply(this, arguments);
  };
  stateDir = h.tempDir('tcc-integration-state-');
  S = await h.startApp({ stateDir: stateDir });
  agentBefore = treeDigest(S.app.platform.agentRoot);
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
});

test.after(async function () {
  net.Socket.prototype.connect = originalConnect;
  await S.close();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

// ===========================================================================
// the interface and the API agree
// ===========================================================================

test('INTEGRATION: every API path the interface names is a route that exists', function () {
  var patterns = S.app.routes.map(function (r) { return r.path; })
    .concat(['/api/auth/login', '/api/auth/logout', '/api/auth/session', '/api/paper/stream']);
  var seen = {};
  webFiles().forEach(function (f) {
    var text = fs.readFileSync(f, 'utf8');
    (text.match(/'\/api\/[A-Za-z0-9/_-]*'/g) || []).forEach(function (lit) {
      var p = lit.slice(1, -1);
      seen[p] = true;
      var ok = patterns.some(function (pattern) {
        if (pattern === p) return true;
        // a literal ending in "/" is a prefix completed at run time: '/api/decisions/' + id
        if (p.charAt(p.length - 1) === '/') return pattern.indexOf(p) === 0 || pattern.replace(/:[A-Za-z]+/g, '').indexOf(p) === 0;
        return false;
      });
      assert.ok(ok, path.relative(h.ROOT, f) + ' calls ' + p + ', which is not a route');
    });
  });
  assert.ok(Object.keys(seen).length >= 35, 'only ' + Object.keys(seen).length + ' API paths were found in the interface');
  // and no read route is left without a page that uses it
  S.app.routes.filter(function (r) { return r.method === 'GET' && r.path.indexOf(':') === -1 && r.path !== '/api/health'; }).forEach(function (r) {
    assert.ok(seen[r.path] || seen[r.path + '/'], 'no page of the interface reads ' + r.path);
  });
});

test('INTEGRATION: the sixteen application routes each have a page and a navigation entry, and nothing else does', function () {
  var registered = {};
  webFiles().forEach(function (f) {
    (fs.readFileSync(f, 'utf8').match(/TCC\.page\('\/[a-z]+'/g) || []).forEach(function (m) { registered[m.slice(10, -1)] = path.basename(f); });
  });
  var app = fs.readFileSync(path.join(h.ROOT, 'web', 'assets', 'js', 'app.js'), 'utf8');
  var routes = serverMod.APP_ROUTES.filter(function (r) { return r !== '/'; });
  assert.equal(routes.length, 16);
  routes.forEach(function (r) {
    assert.ok(registered[r], 'no page is registered for ' + r);
    assert.ok(app.indexOf("'" + r + "'") !== -1, r + ' is not in the navigation');
  });
  assert.deepEqual(Object.keys(registered).sort(), routes.slice().sort(), 'a page is registered for a route the server does not serve');
  var index = fs.readFileSync(path.join(h.ROOT, 'web', 'index.html'), 'utf8');
  Object.keys(registered).forEach(function (r) { assert.ok(index.indexOf(registered[r]) !== -1, registered[r] + ' is not loaded by index.html'); });
  assert.equal(fs.existsSync(path.join(h.ROOT, 'web', 'assets', 'js', 'pages', 'pending.js')), false, 'the placeholder for unbuilt routes still exists');
});

test('INTEGRATION: every route of the API is exercised by a suite', function () {
  var tests = fs.readdirSync(__dirname).filter(function (f) { return /-test\.js$/.test(f) && f !== 'integration-test.js'; })
    .map(function (f) { return fs.readFileSync(path.join(__dirname, f), 'utf8'); }).join('\n');
  var untested = S.app.routes.filter(function (r) {
    var literal = r.path.replace(/:[A-Za-z]+.*$/, '');      // up to the first parameter
    var tail = r.path.indexOf(':') === -1 ? null : r.path.replace(/^.*:[A-Za-z]+/, '');
    if (tests.indexOf(literal) === -1) return true;
    return !!tail && tail.length > 1 && tests.indexOf(tail) === -1;
  }).map(function (r) { return r.method + ' ' + r.path; });
  assert.deepEqual(untested, [], 'routes no suite touches');
});

// ===========================================================================
// the platform does everything it can do
// ===========================================================================

test('SETUP: configure, backtest, experiment, challenger, PAPER approval, paper session, DEMO session', async function () {
  var cfg = await owner.patch('/api/config', { changes: { universe: ['EURUSD', 'XAUUSD'], account: { initialCapital: 5000 },
    jev: { scoreThreshold: 45, minConfidence: 0.15 }, risk: { maxPositionSizeLots: 0.05 }, recovery: { enabled: true, maxRecoveryLevel: 3 },
    cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 } }, reason: 'integration setup', confirm: 'CONFIRM' });
  assert.equal(cfg.status, 200, JSON.stringify(cfg.body));
  var bt = await h.runBacktest(operator, { data: { kind: 'FIXTURE', bars: 3000 } });
  assert.equal(bt.status, 'COMPLETED', JSON.stringify(bt.error));
  runs.backtest = bt.runId;
  var report = (await get(viewer, '/api/research?run=' + bt.runId)).report;
  assert.ok(report.proposals.length > 0, 'the run yields a proposal to test');
  var proposal = report.proposals[0];
  var ex = await operator.post('/api/research/experiments', { runId: bt.runId, proposalId: proposal.proposalId });
  assert.equal(ex.status, 202, JSON.stringify(ex.body));
  var exRun = await waitJob(ex.body.result.run.runId);
  assert.equal(exRun.status, 'COMPLETED', JSON.stringify(exRun.error));
  runs.experiment = exRun.runId;
  var chal = await operator.post('/api/research/challengers', { runId: bt.runId, proposalId: proposal.proposalId });
  assert.equal(chal.status, 200, JSON.stringify(chal.body));
  await h.enterPaper(owner);
  assert.equal((await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD', 'XAUUSD'], bars: 1500 } })).status, 200);
  while (S.app.platform.paper.step()) { /* to the end of the feed */ }
  runs.paper = (await get(viewer, '/api/paper')).session.sessionId;
  assert.equal((await owner.post('/api/paper/reset', { confirm: 'RESET' })).status, 200);
  assert.equal((await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 1500 },
    demo: { challengerRecordId: chal.body.result.recordId } })).status, 200);
  while (S.app.platform.paper.step()) { /* to the end of the feed */ }
  runs.demo = (await get(viewer, '/api/paper')).session.sessionId;
  assert.equal((await owner.post('/api/paper/reset', { confirm: 'RESET' })).status, 200);
});

// ===========================================================================
// THE CRITICAL LIVE AUDIT — no bypass, in any store the platform produced
// ===========================================================================

function storesOf(name) {
  var id = runs[name];
  var out = [{ label: name, t: S.app.platform.runs.tables(id, 'store').tables }];
  if (name === 'demo') out.push({ label: 'demo challenger arm', t: S.app.platform.runs.tables(id, 'store-challenger').tables });
  return out;
}

test('LIVE AUDIT: no trade in any store bypassed Jev, the Risk Engine, the recovery cap or the one-trade rule', function () {
  var cap = 0.05;
  var totals = { stores: 0, trades: 0, clamps: 0, blocks: 0, jevRejects: 0 };
  ['backtest', 'paper', 'demo'].forEach(function (name) {
    storesOf(name).forEach(function (s) {
      var t = s.t;
      totals.stores++;
      var jev = {};
      (t.jev_decisions || []).forEach(function (j) { jev[j.candidateId] = j; if (j.decision === 'REJECT') totals.jevRejects++; });
      var risk = {};
      (t.risk_assessments || []).forEach(function (r) {
        risk[r.candidateId] = r;
        if (r.verdict === 'CLAMP') totals.clamps++;
        if (r.verdict === 'BLOCK') totals.blocks++;
        assert.ok(r.approvedLots <= r.requestedLots + 1e-9, s.label + ': the Risk Engine approved more than was requested');
        assert.ok(r.approvedLots <= cap + 1e-9, s.label + ': approved above the position cap');
        if (r.verdict === 'BLOCK') assert.equal(r.approvedLots, 0, s.label + ': a BLOCK carries a size');
      });
      var decisions = {};
      (t.decisions || []).forEach(function (d) { if (d.candidateId) decisions[d.candidateId] = d; });
      assert.ok((t.trades || []).length > 0, s.label + ' produced no trade; the audit would be vacuous');
      (t.trades || []).forEach(function (tr) {
        totals.trades++;
        var where = s.label + ' trade ' + tr.tradeId;
        var j = jev[tr.candidateId];
        var r = risk[tr.candidateId];
        assert.ok(j, where + ' has no Jev verdict: Jev was bypassed');
        assert.equal(j.decision, 'ENTER', where + ' executed against a Jev REJECT');
        assert.ok(j.score >= 45 && j.confidence >= 0.15, where + ' is under the configured Jev threshold');
        assert.ok(r, where + ' has no risk assessment: the Risk Engine was bypassed');
        assert.notEqual(r.verdict, 'BLOCK', where + ' executed against a Risk Engine BLOCK');
        assert.equal(tr.lots, r.approvedLots, where + ' ran at a size the Risk Engine did not approve');
        assert.ok(tr.lots <= cap + 1e-9, where + ' is above the position cap');
        assert.ok(tr.recoveryLevel <= 3, where + ' is above the recovery cap');
        assert.equal(decisions[tr.candidateId].decision, 'ENTER', where + ' has no ENTER decision on record');
        assert.equal(tr.paper, name === 'backtest' ? tr.paper : true, where + ' is not marked as paper');
      });
      // one position at a time
      var events = [];
      (t.positions || []).forEach(function (p) { events.push({ ts: p.status === 'OPEN' ? p.entryTs : p.exitTs, d: p.status === 'OPEN' ? 1 : -1 }); });
      events.sort(function (a, b) { return a.ts - b.ts || a.d - b.d; });
      var open = 0;
      events.forEach(function (e) { open += e.d; assert.ok(open <= 1, s.label + ': more than one position open at once'); });
      (t.recovery_states || []).forEach(function (st) { assert.ok(st.level <= 3, s.label + ': a recovery state above the cap'); });
      // no stored row of any table claims a venue, an order id or a live mode
      Object.keys(t).forEach(function (table) {
        var text = JSON.stringify(t[table]);
        assert.doesNotMatch(text, /"mode":"LIVE"|"venueOrderId"|"brokerOrderId"|"live":true/, s.label + '.' + table + ' carries a live marker');
      });
    });
  });
  assert.equal(totals.stores, 4);
  assert.ok(totals.trades > 100, 'the audit covered only ' + totals.trades + ' trades');
  assert.ok(totals.clamps > 0 && totals.blocks > 0 && totals.jevRejects > 0,
    'the clamp, block and Jev-reject paths must all have been exercised: ' + JSON.stringify(totals));
});

test('LIVE AUDIT: no mutation route accepts a mode, a size, an adapter or a venue — as the OWNER, with a valid session', async function () {
  var before = await get(viewer, '/api/status');
  var smuggled = { mode: 'LIVE', live: true, lots: 5, size: 5, positionSize: 5, approvedLots: 5, adapter: 'live', broker: 'x', venue: 'x',
    apiKey: 'k', leverage: 500, riskEngine: false, bypassRisk: true, bypassJev: true, skipApproval: true, force: true };
  var mutations = S.app.routes.filter(function (r) { return r.method !== 'GET'; });
  assert.ok(mutations.length >= 20);
  var tried = 0;
  for (var r of mutations) {
    var url = r.path.replace(':recordId', 'chal-0001').replace(':runId', runs.backtest);
    for (var key of Object.keys(smuggled)) {
      var body = {};
      body[key] = smuggled[key];
      var res = await owner.request(r.method, url, body);
      tried++;
      assert.ok(res.status >= 400 && res.status < 500, r.method + ' ' + r.path + ' accepted {' + key + '} → ' + res.status);
      if (res.status === 400) assert.ok(JSON.stringify(res.body).indexOf('LIVE_NOT_AVAILABLE') !== -1 || /VALIDATION_FAILED|CONFIRMATION|CONFIG/.test(res.body.error.code), r.path + ' ' + key);
    }
  }
  assert.ok(tried >= 300);
  var after = await get(viewer, '/api/status');
  assert.equal(after.mode, before.mode);
  assert.equal(after.configFingerprint, before.configFingerprint, 'a refused request changed the configuration');
  assert.equal(after.tradingEnabled, before.tradingEnabled);
  assert.equal(after.liveExecution.available, false);
});

test('LIVE AUDIT: the owner approval is bound to this configuration and this commit, and to nothing else', async function () {
  assert.equal((await operator.post('/api/config/mode', { to: 'BACKTEST', reason: 'lower the mode for the approval audit' })).status, 200);
  var good = await h.paperApproval(owner);
  var cases = [
    ['a different configuration fingerprint', { configFingerprint: 'a'.repeat(64) }],
    ['a different commit', { commit: 'b'.repeat(40) }],
    ['no owner approval flag', { ownerApproval: false }],
    ['a statement for another transition', { statement: 'I approve the Mythos Trading Agent transition PAPER -> LIVE' }],
    ['a missing gate', { gatesPassed: good.gatesPassed.slice(1) }],
    ['gate evidence too short to be evidence', { gateEvidence: Object.keys(good.gateEvidence).reduce(function (a, k) { a[k] = 'ok'; return a; }, {}) }]
  ];
  for (var c of cases) {
    var res = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'approval audit: ' + c[0], approval: Object.assign({}, good, c[1]) });
    assert.equal(res.status, 403, c[0] + ' was accepted: ' + JSON.stringify(res.body));
    assert.equal((await get(viewer, '/api/status')).mode, 'BACKTEST', c[0]);
  }
  // an operator holding a perfect record still cannot use it
  assert.equal((await operator.post('/api/config/mode', { to: 'PAPER', reason: 'operator with the owner\'s record', approval: good })).status, 403);
  // the configuration changes after the record was written: the record no longer fits
  await owner.patch('/api/config', { changes: { jev: { scoreThreshold: 46 } }, reason: 'change the configuration under the approval' });
  var stale = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'a record written for the previous configuration', approval: good });
  assert.equal(stale.status, 403);
  assert.equal((await get(viewer, '/api/status')).mode, 'BACKTEST');
});

test('LIVE AUDIT: research, the testing center and the paper room hold no path to the running rules', async function () {
  var before = await get(viewer, '/api/status');
  var reg = (await get(viewer, '/api/research')).registry;
  assert.equal(reg.authority, 'PROPOSAL_ONLY');
  assert.equal(reg.runningConfigHash, before.configFingerprint);
  // every research and testing mutation, used as intended, leaves the running configuration alone
  await owner.post('/api/research/champion/seed', { basis: 'The running configuration, seeded for the audit.' });
  await operator.post('/api/research/challengers/' + reg.challengers[0].recordId + '/evidence', { experimentRunId: runs.experiment });
  await owner.post('/api/research/challengers/' + reg.challengers[0].recordId + '/promote', { basis: 'Promote it for the audit, if the gate allows.', confirm: 'PROMOTE' });
  await operator.post('/api/research/challengers/' + reg.challengers[0].recordId + '/reject', { reason: 'rejected for the audit' });
  var after = await get(viewer, '/api/status');
  assert.equal(after.configFingerprint, before.configFingerprint, 'a research action changed the running configuration');
  assert.equal(after.mode, before.mode);
  assert.equal(after.tradingEnabled, before.tradingEnabled);
  // the paper adapter is the only execution the platform has, and it says what it is
  var paper = await get(viewer, '/api/paper');
  assert.equal(paper.placesRealOrders, false);
  assert.equal(paper.feedKind, 'REPLAY');
});

test('LIVE AUDIT: this process connected to nothing but its own clients, and the agent has no network client', function () {
  assert.ok(connections.length > 50, 'the hook recorded only ' + connections.length + ' connections');
  var foreign = connections.filter(function (c) { return !(/^(127\.0\.0\.1|localhost|::1)$/.test(String(c.host)) && Number(c.port) === S.port); });
  assert.deepEqual(foreign, [], 'the server process opened a connection to somewhere else');
  var agent = S.app.platform.agent;
  var check = agent.health.create({ config: S.app.platform.control.config() }).noNetworkClient();
  assert.equal(check.status, 'OK', check.detail);
});

test('LIVE AUDIT: running the platform changed no byte of the Trading Agent', function () {
  var after = treeDigest(S.app.platform.agentRoot);
  assert.equal(after.files, agentBefore.files, 'a file was added to or removed from the Trading Agent');
  assert.equal(after.digest, agentBefore.digest, 'a file of the Trading Agent was modified while the platform ran');
});

test('LIVE AUDIT: at the end the lock holds — BACKTEST after a restart, LIVE refused, health not FAIL, chain intact', async function () {
  await h.enterPaper(owner);
  assert.equal((await get(viewer, '/api/status')).mode, 'PAPER');
  await S.close();
  S = await h.startApp({ stateDir: stateDir });
  owner = await S.login('owner');
  viewer = await S.login('viewer');
  var st = await get(viewer, '/api/status');
  assert.equal(st.mode, 'BACKTEST', 'a restart must never come up above BACKTEST');
  assert.deepEqual(st.modesAvailable, ['BACKTEST', 'PAPER']);
  assert.equal(st.liveExecution.available, false);
  var live = await owner.post('/api/config/mode', { to: 'LIVE', reason: 'final audit: ask for live', approval: await h.paperApproval(owner) });
  assert.equal(live.status, 403);
  assert.equal(live.body.error.code, 'LIVE_NOT_AVAILABLE');
  var sys = await get(viewer, '/api/system');
  assert.notEqual(sys.health.status, 'FAIL');
  assert.equal(sys.health.counts.fail, 0);
  var refusal = sys.health.staticChecks.filter(function (c) { return c.check === 'LIVE_EXECUTION_REFUSED'; })[0];
  assert.equal(refusal.status, 'OK', refusal.detail);
  assert.deepEqual(sys.liveExecution, { available: false, adapter: 'live-refusing-stub', refusalVerified: true });
  assert.equal(sys.audit.integrityAtStart.ok, true);
  assert.equal((await get(viewer, '/api/audit/verify')).ok, true);
});
