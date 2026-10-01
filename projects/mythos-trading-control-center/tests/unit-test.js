'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — unit tests
// projects/mythos-trading-control-center/tests/unit-test.js
//
// The modules under server/, each on its own: validation, rate limiting, the
// audit chain, authentication, the state directory, the read models and the
// TAP parser. No HTTP here — the suites that start a server are separate.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var h = require('./helpers');
var SERVER = path.join(h.ROOT, 'server');
var v = require(path.join(SERVER, 'validate'));
var rateMod = require(path.join(SERVER, 'ratelimit'));
var auditMod = require(path.join(SERVER, 'audit'));
var authMod = require(path.join(SERVER, 'auth'));
var stateMod = require(path.join(SERVER, 'state'));
var views = require(path.join(SERVER, 'views'));
var testingMod = require(path.join(SERVER, 'testing'));
var controlMod = require(path.join(SERVER, 'control'));

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

test('validation rejects unknown keys rather than ignoring them', function () {
  var spec = v.obj({ a: v.int(0, 10) });
  assert.equal(v.check(spec, { a: 3 }).ok, true);
  var res = v.check(spec, { a: 3, b: 1 });
  assert.equal(res.ok, false);
  assert.match(res.problems[0].message, /not a known field/);
});

test('validation reports every problem at once', function () {
  var spec = v.obj({ a: v.int(0, 10), s: v.str({ minLength: 3 }), flag: v.bool() });
  var res = v.check(spec, { a: 99, s: 'x', flag: 'yes' });
  assert.equal(res.problems.length, 3);
});

test('validation enforces ranges, integers, enums, patterns and array uniqueness', function () {
  assert.equal(v.check(v.num(0, 1), 1.5).ok, false);
  assert.equal(v.check(v.int(0, 10), 2.5).ok, false);
  assert.equal(v.check(v.num(0, 1), NaN).ok, false);
  assert.equal(v.check(v.num(0, 1), Infinity).ok, false);
  assert.equal(v.check(v.str({ values: ['A', 'B'] }), 'C').ok, false);
  assert.equal(v.check(v.str({ pattern: /^[a-z]+$/ }), 'aB').ok, false);
  assert.equal(v.check(v.arr(v.str(), { unique: true }), ['a', 'a']).ok, false);
  assert.equal(v.check(v.arr(v.str(), { maxItems: 1 }), ['a', 'b']).ok, false);
});

test('validation treats null as invalid unless a field says nullable', function () {
  assert.equal(v.check(v.obj({ a: v.int(0, 1) }), { a: null }).ok, false);
  assert.equal(v.check(v.obj({ a: v.opt(v.int(0, 1)) }), {}).ok, true);
});

test('query validation converts types and refuses repeated parameters', function () {
  var spec = v.obj({ limit: v.opt(v.int(1, 500)), flag: v.opt(v.bool()), name: v.opt(v.str()) });
  var ok = v.query(spec, { limit: '20', flag: 'true', name: 'x' });
  assert.deepEqual(ok.value, { limit: 20, flag: true, name: 'x' });
  assert.equal(v.query(spec, { limit: 'abc' }).ok, false);
  assert.equal(v.query(spec, { limit: ['1', '2'] }).ok, false, 'a repeated parameter must be refused, not resolved');
  assert.equal(v.query(spec, { other: '1' }).ok, false);
  assert.equal(v.query(spec, { limit: '9999' }).ok, false);
});

// ---------------------------------------------------------------------------
// rate limiting
// ---------------------------------------------------------------------------

test('the rate limiter allows up to the limit and then refuses with a retry time', function () {
  var t = 1000;
  var rl = rateMod.create({ buckets: { write: { limit: 3, windowMs: 1000 } }, now: function () { return t; } });
  assert.equal(rl.hit('write', 'u').allowed, true);
  assert.equal(rl.hit('write', 'u').allowed, true);
  assert.equal(rl.hit('write', 'u').allowed, true);
  var refused = rl.hit('write', 'u');
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds >= 1);
  assert.equal(rl.hit('write', 'other').allowed, true, 'one key must not exhaust another');
  t += 1001;
  assert.equal(rl.hit('write', 'u').allowed, true, 'a new window resets the count');
});

test('the rate limiter store is bounded', function () {
  var rl = rateMod.create({ buckets: { read: { limit: 1, windowMs: 60000 } } });
  for (var i = 0; i < 6000; i++) rl.hit('read', 'k' + i);
  assert.ok(rl.size() <= 4097, 'the counter map grew to ' + rl.size());
});

// ---------------------------------------------------------------------------
// audit chain
// ---------------------------------------------------------------------------

function freshAudit() {
  var state = stateMod.create({});
  return { state: state, audit: auditMod.create({ state: state, sink: null }) };
}

test('the audit chain links every entry to the previous one and verifies', function () {
  var a = freshAudit();
  var e1 = a.audit.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'config.update', outcome: 'ACCEPTED', reason: 'first' });
  var e2 = a.audit.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'trading.set', outcome: 'ACCEPTED', reason: 'second' });
  assert.equal(e1.seq, 1);
  assert.equal(e1.prevHash, auditMod.GENESIS);
  assert.equal(e2.prevHash, e1.hash);
  assert.equal(a.audit.verify().ok, true);
  a.state.close();
});

test('editing, deleting or reordering an audit entry is detected', function () {
  var a = freshAudit();
  for (var i = 0; i < 4; i++) a.audit.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'config.update', outcome: 'ACCEPTED', newValue: { n: i } });
  var file = a.state.file(auditMod.FILE);
  var lines = fs.readFileSync(file, 'utf8').trim().split('\n');

  // edit
  var edited = lines.slice();
  var row = JSON.parse(edited[1]);
  row.newValue = { n: 999 };
  edited[1] = JSON.stringify(row);
  fs.writeFileSync(file, edited.join('\n') + '\n');
  var r1 = a.audit.verify();
  assert.equal(r1.ok, false);
  assert.equal(r1.brokenAtSeq, 2);

  // delete
  fs.writeFileSync(file, [lines[0], lines[2], lines[3]].join('\n') + '\n');
  assert.equal(a.audit.verify().ok, false);

  // reorder
  fs.writeFileSync(file, [lines[1], lines[0], lines[2], lines[3]].join('\n') + '\n');
  assert.equal(a.audit.verify().ok, false);

  // restore
  fs.writeFileSync(file, lines.join('\n') + '\n');
  assert.equal(a.audit.verify().ok, true);
  a.state.close();
});

test('the audit chain continues correctly across a restart', function () {
  var dir = h.tempDir('tcc-audit-');
  var s1 = stateMod.create({ dir: dir });
  var a1 = auditMod.create({ state: s1, sink: null });
  a1.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'config.update', outcome: 'ACCEPTED' });
  var head = a1.head();
  var s2 = stateMod.create({ dir: dir });
  var a2 = auditMod.create({ state: s2, sink: null });
  assert.equal(a2.loadedIntegrity().ok, true);
  var e = a2.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'trading.set', outcome: 'ACCEPTED' });
  assert.equal(e.seq, 2);
  assert.equal(e.prevHash, head.hash);
  assert.equal(a2.verify().ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the audit log never stores a secret-shaped value or a full session id', function () {
  var a = freshAudit();
  var sid = 'a'.repeat(64);
  var e = a.audit.record({
    actor: { id: 'owner', role: 'OWNER', sessionId: sid },
    action: 'config.update', outcome: 'ACCEPTED',
    newValue: { password: 'hunter2', nested: { apiKey: 'k', token: 't', fine: 1 }, csrf: 'x', Authorization: 'Bearer z' }
  });
  var text = JSON.stringify(e);
  assert.ok(text.indexOf('hunter2') === -1);
  assert.ok(text.indexOf('Bearer z') === -1);
  assert.ok(text.indexOf(sid) === -1, 'the full session id must not be stored');
  assert.equal(e.actor.session, 'aaaaaaaa');
  assert.equal(e.newValue.password, '[REDACTED]');
  assert.equal(e.newValue.nested.apiKey, '[REDACTED]');
  assert.equal(e.newValue.nested.fine, 1);
  a.state.close();
});

test('an oversized audit value is replaced by its hash, not stored', function () {
  var a = freshAudit();
  var big = [];
  for (var i = 0; i < 400; i++) big.push({ index: i, text: 'x'.repeat(60) });
  var e = a.audit.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'config.update', outcome: 'ACCEPTED', newValue: big });
  assert.equal(e.newValue.truncated, true);
  assert.match(e.newValue.sha256, /^[0-9a-f]{64}$/);
  a.state.close();
});

test('audit list filters by action, actor and outcome, newest first', function () {
  var a = freshAudit();
  a.audit.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'config.update', outcome: 'ACCEPTED' });
  a.audit.record({ actor: { id: 'operator', role: 'OPERATOR' }, action: 'config.update', outcome: 'REFUSED', code: 'FORBIDDEN' });
  a.audit.record({ actor: { id: 'owner', role: 'OWNER' }, action: 'paper.start', outcome: 'ACCEPTED' });
  assert.equal(a.audit.list({ action: 'config' }).total, 2);
  assert.equal(a.audit.list({ actor: 'operator' }).total, 1);
  assert.equal(a.audit.list({ outcome: 'REFUSED' }).items[0].code, 'FORBIDDEN');
  assert.equal(a.audit.list({}).items[0].action, 'paper.start');
  a.state.close();
});

// ---------------------------------------------------------------------------
// authentication
// ---------------------------------------------------------------------------

test('passwords are stored as scrypt hashes, never in clear', function () {
  var u = authMod.makeUser('alice', 'OPERATOR', 'a-long-enough-password');
  assert.equal(u.algo, 'scrypt');
  assert.ok(JSON.stringify(u).indexOf('a-long-enough-password') === -1);
  assert.match(u.hash, /^[0-9a-f]{128}$/);
  assert.throws(function () { authMod.makeUser('alice', 'OPERATOR', 'short'); }, /at least 12/);
  assert.throws(function () { authMod.makeUser('Alice!', 'OPERATOR', 'a-long-enough-password'); });
  assert.throws(function () { authMod.makeUser('alice', 'ADMIN', 'a-long-enough-password'); });
});

test('credentials verify only for the right user and password', function () {
  var auth = authMod.create({ users: h.users() });
  assert.deepEqual(auth.verifyCredentials('owner', h.PASSWORDS.owner).user, { id: 'owner', role: 'OWNER' });
  assert.equal(auth.verifyCredentials('owner', 'wrong').ok, false);
  assert.equal(auth.verifyCredentials('nobody', h.PASSWORDS.owner).ok, false);
  assert.equal(auth.verifyCredentials('owner', '').ok, false);
  assert.equal(auth.verifyCredentials('owner', undefined).ok, false);
  assert.equal(auth.verifyCredentials(null, h.PASSWORDS.owner).ok, false);
});

test('a users file with group or other permissions is refused', function () {
  var dir = h.tempDir('tcc-users-');
  var file = path.join(dir, 'users.json');
  fs.writeFileSync(file, JSON.stringify({ users: h.users() }), { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  var loose = authMod.create({ usersFile: file });
  assert.equal(loose.userState().provisioned, false);
  assert.equal(loose.userState().reason, 'insecure_mode');
  assert.equal(loose.verifyCredentials('owner', h.PASSWORDS.owner).ok, false);
  fs.chmodSync(file, 0o600);
  var tight = authMod.create({ usersFile: file });
  assert.equal(tight.userState().provisioned, true);
  assert.equal(tight.verifyCredentials('owner', h.PASSWORDS.owner).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a missing, malformed or empty users file means nobody can sign in', function () {
  assert.equal(authMod.create({}).userState().reason, 'unconfigured');
  assert.equal(authMod.create({ usersFile: '/nonexistent/users.json' }).userState().reason, 'unreadable');
  var dir = h.tempDir('tcc-users-');
  var file = path.join(dir, 'users.json');
  fs.writeFileSync(file, '{not json', { mode: 0o600 });
  assert.equal(authMod.create({ usersFile: file }).userState().reason, 'malformed');
  fs.writeFileSync(file, JSON.stringify({ users: [{ id: 'x', role: 'OWNER', hash: 'plain' }] }), { mode: 0o600 });
  assert.equal(authMod.create({ usersFile: file }).userState().reason, 'no_valid_users');
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeReq(cookie) { return { headers: { cookie: cookie }, socket: { remoteAddress: '127.0.0.1' } }; }

test('a session expires absolutely and when idle, and carries a CSRF token', function () {
  var t = 1000000;
  var auth = authMod.create({ users: h.users(), now: function () { return t; }, absoluteTtlMs: 10000, idleTtlMs: 4000 });
  var s = auth.createSession({ id: 'owner', role: 'OWNER' }, '127.0.0.1');
  assert.match(s.id, /^[0-9a-f]{64}$/);
  assert.match(s.csrf, /^[0-9a-f]{64}$/);
  var req = fakeReq(authMod.SESSION_COOKIE + '=' + s.id);
  assert.equal(auth.sessionFor(req).userId, 'owner');
  t += 3000;
  assert.ok(auth.sessionFor(req), 'activity inside the idle window keeps the session');
  t += 3000;
  assert.ok(auth.sessionFor(req));
  t += 5000;   // past the absolute limit even though it was active
  assert.equal(auth.sessionFor(req), null);

  var s2 = auth.createSession({ id: 'owner', role: 'OWNER' }, '127.0.0.1');
  var req2 = fakeReq(authMod.SESSION_COOKIE + '=' + s2.id);
  t += 4500;   // idle too long
  assert.equal(auth.sessionFor(req2), null);
});

test('the session cookie is httpOnly, SameSite=Strict and Secure', function () {
  var auth = authMod.create({ users: h.users() });
  var c = auth.sessionCookie('a'.repeat(64));
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Strict/);
  assert.match(c, /Secure/);
  assert.match(c, /Path=\//);
  assert.match(auth.clearedCookie(), /Max-Age=0/);
});

test('a malformed session cookie resolves to no session', function () {
  var auth = authMod.create({ users: h.users() });
  assert.equal(auth.sessionFor(fakeReq(authMod.SESSION_COOKIE + '=not-hex')), null);
  assert.equal(auth.sessionFor(fakeReq(authMod.SESSION_COOKIE + '=' + 'b'.repeat(64))), null);
  assert.equal(auth.sessionFor(fakeReq('')), null);
});

test('the CSRF comparison accepts only the exact token', function () {
  var auth = authMod.create({ users: h.users() });
  var s = auth.createSession({ id: 'owner', role: 'OWNER' });
  assert.equal(auth.csrfMatches(s, s.csrf), true);
  assert.equal(auth.csrfMatches(s, s.csrf.slice(0, 63) + '0') && s.csrf[63] !== '0', false);
  assert.equal(auth.csrfMatches(s, ''), false);
  assert.equal(auth.csrfMatches(s, undefined), false);
  assert.equal(auth.csrfMatches(null, s.csrf), false);
});

test('a user removed from the users list loses a live session immediately', function () {
  var list = h.users().slice();
  var auth = authMod.create({ users: list });
  var s = auth.createSession({ id: 'viewer', role: 'VIEWER' });
  var req = fakeReq(authMod.SESSION_COOKIE + '=' + s.id);
  assert.ok(auth.sessionFor(req));
  for (var i = list.length - 1; i >= 0; i--) if (list[i].id === 'viewer') list.splice(i, 1);
  assert.equal(auth.sessionFor(req), null);
});

test('sign-in is throttled per client and per user name', function () {
  var t = 5000;
  var auth = authMod.create({ users: h.users(), now: function () { return t; } });
  for (var i = 0; i < authMod.LOGIN_MAX_FAILURES; i++) {
    assert.equal(auth.loginAllowed('10.0.0.1', 'owner'), true);
    auth.recordLoginFailure('10.0.0.1', 'owner');
  }
  assert.equal(auth.loginAllowed('10.0.0.1', 'owner'), false);
  assert.equal(auth.loginAllowed('10.0.0.2', 'owner'), false, 'a different client must not get fresh guesses at the same name');
  assert.equal(auth.loginAllowed('10.0.0.1', 'viewer'), false, 'the same client must not get fresh guesses at another name');
  assert.equal(auth.loginAllowed('10.0.0.3', 'viewer'), true);
  t += 16 * 60 * 1000;
  assert.equal(auth.loginAllowed('10.0.0.1', 'owner'), true, 'the window rolls off');
});

test('role comparison is ordered VIEWER < OPERATOR < OWNER and unknown roles get nothing', function () {
  assert.equal(authMod.roleAtLeast('OWNER', 'OPERATOR'), true);
  assert.equal(authMod.roleAtLeast('OPERATOR', 'OWNER'), false);
  assert.equal(authMod.roleAtLeast('VIEWER', 'VIEWER'), true);
  assert.equal(authMod.roleAtLeast('ADMIN', 'VIEWER'), false);
  assert.equal(authMod.roleAtLeast(undefined, 'VIEWER'), false);
  assert.equal(authMod.roleAtLeast('OWNER', 'SUPER'), false);
});

// ---------------------------------------------------------------------------
// state directory
// ---------------------------------------------------------------------------

test('the state directory refuses names that could leave it', function () {
  var s = stateMod.create({});
  assert.throws(function () { s.file('../escape'); });
  assert.throws(function () { s.file('a/b'); });
  assert.throws(function () { s.file('..'); });
  assert.throws(function () { s.subdir('runs', '../x'); });
  assert.throws(function () { s.readJSON('/etc/passwd', null); });
  s.close();
});

test('an ephemeral state directory is removed on close; a persistent one is kept', function () {
  var s = stateMod.create({});
  assert.equal(s.persistent, false);
  var dir = s.dir;
  s.writeJSON('x.json', { a: 1 });
  s.close();
  assert.equal(fs.existsSync(dir), false);

  var p = h.tempDir('tcc-persist-');
  var s2 = stateMod.create({ dir: p });
  s2.writeJSON('x.json', { a: 1 });
  s2.close();
  assert.equal(fs.existsSync(path.join(p, 'x.json')), true);
  assert.equal((fs.statSync(path.join(p, 'x.json')).mode & 0o077), 0, 'state files must be 0600');
  fs.rmSync(p, { recursive: true, force: true });
});

test('a corrupt state document is an error, not a silent default', function () {
  var s = stateMod.create({});
  fs.writeFileSync(s.file('bad.json'), '{oops');
  assert.throws(function () { s.readJSON('bad.json', {}); }, /not valid JSON/);
  assert.deepEqual(s.readJSON('absent.json', { d: 1 }), { d: 1 });
  s.close();
});

// ---------------------------------------------------------------------------
// read models
// ---------------------------------------------------------------------------

test('Jev band boundaries are 70-79, 80-89, 90-94, 95-100', function () {
  assert.equal(views.bandOf(69.99), 'BELOW_70');
  assert.equal(views.bandOf(70), '70-79');
  assert.equal(views.bandOf(79.99), '70-79');
  assert.equal(views.bandOf(80), '80-89');
  assert.equal(views.bandOf(89.5), '80-89');
  assert.equal(views.bandOf(90), '90-94');
  assert.equal(views.bandOf(94.9), '90-94');
  assert.equal(views.bandOf(95), '95-100');
  assert.equal(views.bandOf(100), '95-100');
  assert.equal(views.bandOf(null), null);
  assert.deepEqual(views.JEV_BANDS.map(function (b) { return b.key; }), ['70-79', '80-89', '90-94', '95-100']);
});

function tinyTables(extra) {
  var t = Object.assign({
    market_data_meta: [{ symbol: 'EURUSD', timeframe: 'M15', barCount: 10, firstBarTs: 1, lastBarTs: 10, datasetVersion: 'd1', sourceKind: 'fixture' }],
    strategies: [{ strategyId: 'momentum', family: 'MOMENTUM', name: 'm', version: 1, preferredRegimes: ['TREND'] }],
    strategy_versions: [{ strategyId: 'momentum', version: 1, paramsHash: 'ph', params: { a: 1 } }],
    regimes: [{ ts: 5, symbol: 'EURUSD', timeframe: 'M15', regime: 'TREND', direction: 'LONG', confidence: 0.6, features: {}, scores: {}, held: false }],
    candidates: [
      { candidateId: 'c1', ts: 5, symbol: 'EURUSD', strategyId: 'momentum', direction: 'LONG', entry: 1.1, stopLoss: 1.09, takeProfit: 1.12, regime: 'TREND', reasonCodes: ['SIG'] },
      { candidateId: 'c2', ts: 5, symbol: 'EURUSD', strategyId: 'momentum', direction: 'SHORT', entry: 1.1, stopLoss: 1.11, takeProfit: 1.08, regime: 'TREND', reasonCodes: ['SIG'] }
    ],
    cost_assessments: [
      { candidateId: 'c1', ts: 5, symbol: 'EURUSD', passed: true, phase: 'PRE_TRADE', totalCostMoney: 0.2, reasonCodes: [] },
      { candidateId: 'c2', ts: 5, symbol: 'EURUSD', passed: true, phase: 'PRE_TRADE', totalCostMoney: 0.2, reasonCodes: [] }
    ],
    jev_decisions: [
      { candidateId: 'c1', ts: 5, score: 82, confidence: 0.7, decision: 'ENTER', reasonCodes: ['OK'], riskFlags: [], band: '80-89', threshold: 70, minConfidence: 0.4, model: 'h' },
      { candidateId: 'c2', ts: 5, score: 40, confidence: 0.7, decision: 'REJECT', reasonCodes: ['BELOW_SCORE_THRESHOLD'], riskFlags: [], band: null, threshold: 70, minConfidence: 0.4, model: 'h' }
    ],
    risk_assessments: [
      { candidateId: 'c1', ts: 5, verdict: 'CLAMP', requestedLots: 0.09, approvedLots: 0.01, reasonCodes: ['MAX_POSITION_SIZE'], limitsChecked: [{ limit: 'MAX_POSITION_SIZE_LOTS', observed: 0.09, limitValue: 0.01, binding: true }], accountEquity: 100 }
    ],
    recovery_states: [],
    decisions: [
      { _seq: 1, ts: 5, symbol: 'EURUSD', decision: 'NO_TRADE', stage: 'JEV', candidateId: 'c2', reasonCodes: ['BELOW_SCORE_THRESHOLD'] },
      { _seq: 2, ts: 5, symbol: 'EURUSD', decision: 'ENTER', stage: 'EXECUTION', candidateId: 'c1', reasonCodes: ['OK'] }
    ],
    orders: [{ orderId: 'o1', candidateId: 'c1', ts: 5, symbol: 'EURUSD', type: 'MARKET', direction: 'LONG', lots: 0.01, requestedPrice: 1.1, status: 'FILLED', filledPrice: 1.1 }],
    positions: [{ positionId: 'p1', orderId: 'o1', candidateId: 'c1', symbol: 'EURUSD', direction: 'LONG', lots: 0.01, entryTs: 6, entryPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12, status: 'OPEN' }],
    trades: [{ tradeId: 't1', positionId: 'p1', candidateId: 'c1', symbol: 'EURUSD', strategyId: 'momentum', direction: 'LONG', entryTs: 6, exitTs: 9, entryPrice: 1.1, exitPrice: 1.12, lots: 0.01, grossPnl: 2, costsMoney: 0.2, netPnl: 1.8, outcome: 'WIN', exitReason: 'TAKE_PROFIT', regime: 'TREND', jevScore: 82, recoveryLevel: 0, barsHeld: 3, equityAfter: 101.8, riskMoney: 1 }],
    equity_curve: [{ ts: 1, equity: 100, balance: 100, openRisk: 0, drawdownPct: 0 }, { ts: 9, equity: 101.8, balance: 101.8, openRisk: 0, drawdownPct: 0 }],
    system_events: []
  }, extra || {});
  return views.fromTables(t);
}

test('a decision chain lists the eleven stages in the mission order', function () {
  var chain = views.chain(tinyTables(), 'c1', null);
  assert.deepEqual(chain.stages.map(function (s) { return s.stage; }), views.CHAIN_STAGES);
  assert.deepEqual(views.CHAIN_STAGES, ['MARKET', 'REGIME', 'STRATEGY', 'CANDIDATE', 'JEV', 'COST', 'RISK_ENGINE', 'RECOVERY', 'EXECUTION', 'RESULT', 'ANALYSIS']);
});

test('a chain shows stored values and marks what is not stored instead of inventing it', function () {
  var chain = views.chain(tinyTables(), 'c1', null);
  var by = {};
  chain.stages.forEach(function (s) { by[s.stage] = s; });
  assert.equal(by.RISK_ENGINE.status, 'RECORDED');
  assert.equal(by.RISK_ENGINE.record.requestedLots, 0.09);
  assert.equal(by.RISK_ENGINE.record.approvedLots, 0.01);
  assert.deepEqual(by.RISK_ENGINE.record.bindingLimits, ['MAX_POSITION_SIZE_LOTS']);
  assert.equal(by.RESULT.record.rMultiple, 1.8);
  assert.equal(by.RECOVERY.status, 'NOT_RECORDED', 'no recovery row exists, so none may be shown');
  assert.equal(by.ANALYSIS.status, 'NOT_RECORDED', 'no analysis report was supplied');
  assert.equal(by.ANALYSIS.record, null);
});

test('a rejected candidate\'s chain stops where the pipeline stopped, with the recorded reason', function () {
  var chain = views.chain(tinyTables(), 'c2', null);
  var by = {};
  chain.stages.forEach(function (s) { by[s.stage] = s; });
  assert.equal(chain.stoppedAt, 'JEV');
  assert.deepEqual(chain.reasonCodes, ['BELOW_SCORE_THRESHOLD']);
  assert.equal(by.JEV.status, 'RECORDED');
  assert.equal(by.RISK_ENGINE.status, 'NOT_REACHED');
  assert.equal(by.EXECUTION.status, 'NOT_REACHED');
  assert.equal(by.RESULT.status, 'NOT_REACHED');
  assert.match(by.RISK_ENGINE.note, /stopped at JEV/);
});

test('a chain for an unknown candidate is null, not an empty shell', function () {
  assert.equal(views.chain(tinyTables(), 'nope', null), null);
});

test('a missing regime row is NOT_RECORDED and the candidate\'s own label is shown as such', function () {
  var chain = views.chain(tinyTables({ regimes: [] }), 'c1', null);
  var regime = chain.stages[1];
  assert.equal(regime.status, 'NOT_RECORDED');
  assert.equal(regime.record.regimeOnCandidate, 'TREND');
});

test('candidate rows carry the recorded rejection reason', function () {
  var res = views.candidates(tinyTables(), {});
  assert.equal(res.total, 2);
  assert.equal(res.rejected, 1);
  assert.equal(res.entered, 1);
  var rejected = res.items.filter(function (c) { return c.decision === 'NO_TRADE'; })[0];
  assert.equal(rejected.stage, 'JEV');
  assert.deepEqual(rejected.reasonCodes, ['BELOW_SCORE_THRESHOLD']);
  assert.equal(views.candidates(tinyTables(), { decision: 'ENTER' }).total, 1);
  assert.equal(views.candidates(tinyTables(), { direction: 'SHORT' }).total, 1);
});

test('a candidate with no decision row says so instead of guessing', function () {
  var res = views.candidates(tinyTables({ decisions: [] }), {});
  assert.equal(res.withoutRecordedDecision, 2);
  assert.equal(res.items[0].decision, null);
  assert.equal(res.items[0].decisionRecorded, false);
});

test('the trade view keeps requested and approved size separate', function () {
  var tr = views.trades(tinyTables(), {}).items[0];
  assert.equal(tr.requestedLots, 0.09);
  assert.equal(tr.approvedLots, 0.01);
  assert.equal(tr.lots, 0.01);
  assert.equal(tr.riskVerdict, 'CLAMP');
  assert.equal(tr.jevBand, '80-89');
  assert.equal(tr.rMultiple, 1.8);
});

test('group statistics always carry a sample size and an insufficiency flag', function () {
  var s = views.tradeStats([{ outcome: 'WIN', netPnl: 2, costsMoney: 0.1 }, { outcome: 'LOSS', netPnl: -1, costsMoney: 0.1 }], 20);
  assert.equal(s.sampleSize, 2);
  assert.equal(s.sufficient, false);
  assert.equal(s.profitFactor, 2);
  var empty = views.tradeStats([], 20);
  assert.equal(empty.sampleSize, 0);
  assert.equal(empty.winRate, null, 'an empty group has no win rate, not a zero one');
  assert.equal(empty.expectancy, null);
});

test('the Jev summary maps ENTER/REJECT to ALLOW/BLOCK and fills all four bands', function () {
  var js = views.jevSummary(tinyTables(), 20);
  assert.equal(js.allowed, 1);
  assert.equal(js.blocked, 1);
  assert.deepEqual(js.vocabulary, { ENTER: 'ALLOW', REJECT: 'BLOCK' });
  assert.deepEqual(js.bands.map(function (b) { return b.band; }), ['70-79', '80-89', '90-94', '95-100', 'BELOW_70']);
  var b80 = js.bands[1];
  assert.equal(b80.considered, 1);
  assert.equal(b80.trades.sampleSize, 1);
  assert.equal(b80.trades.sufficient, false);
});

test('downsampling keeps the last sample exactly', function () {
  var rows = [];
  for (var i = 0; i < 1003; i++) rows.push({ ts: i });
  var out = views.downsample(rows, 100);
  assert.ok(out.length <= 102);
  assert.equal(out[out.length - 1].ts, 1002);
  assert.equal(out[0].ts, 0);
});

// ---------------------------------------------------------------------------
// TAP parsing
// ---------------------------------------------------------------------------

test('the TAP parser counts passed, failed and skipped tests separately', function () {
  var tap = [
    'TAP version 13',
    '# printed by the file',
    '# Subtest: a passes',
    'ok 1 - a passes',
    '  ---',
    '  duration_ms: 1.5',
    '  ...',
    '# Subtest: b fails',
    'not ok 2 - b fails',
    '  ---',
    '  duration_ms: 2.25',
    '  error: boom',
    '  ...',
    'ok 3 - c is skipped # SKIP no browser',
    '  ---',
    '  duration_ms: 0.1',
    '  ...',
    '# tests 3',
    '# pass 1',
    '# fail 1',
    '# skipped 1'
  ].join('\n');
  var p = testingMod.parseTap(tap);
  assert.equal(p.tests.length, 3);
  assert.equal(p.tests[0].status, 'passed');
  assert.equal(p.tests[0].durationMs, 1.5);
  assert.equal(p.tests[1].status, 'failed');
  assert.match(p.tests[1].failure, /boom/);
  assert.equal(p.tests[2].status, 'skipped');
  assert.equal(p.tests[2].skipReason, 'no browser');
  assert.equal(p.summary.fail, 1);
  assert.equal(p.output, 'printed by the file', 'what the file printed is kept; headers and totals are not output');
});

test('test discovery finds quoted test names, including escaped quotes', function () {
  var dir = h.tempDir('tcc-discover-');
  var file = path.join(dir, 'x-test.js');
  fs.writeFileSync(file, "test('plain name', function () {});\n  test(\"double\", f);\ntest('it\\'s escaped', f);\n// test('commented out', f)\n");
  var names = testingMod.discoverTests(file);
  assert.ok(names.indexOf('plain name') !== -1);
  assert.ok(names.indexOf('double') !== -1);
  assert.ok(names.indexOf("it's escaped") !== -1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every testing category the mission names exists', function () {
  assert.deepEqual(testingMod.CATEGORY_ORDER,
    ['unit', 'integration', 'property', 'backtest', 'paper', 'risk', 'recovery', 'jev', 'regression', 'e2e', 'security']);
  testingMod.CATEGORY_ORDER.forEach(function (id) { assert.ok(testingMod.CATEGORIES[id], id); });
});

// ---------------------------------------------------------------------------
// the configuration allowlist
// ---------------------------------------------------------------------------

test('the editable allowlist never includes mode, the one-trade invariant or the audit switch', function () {
  ['mode', 'schemaVersion', 'risk.maxOpenTrades', 'risk.emergencyStop', 'observability.auditEveryCandidate', 'notes']
    .forEach(function (k) {
      assert.equal(controlMod.EDITABLE[k], undefined, k + ' must not be editable');
      assert.ok(controlMod.LOCKED[k], k + ' must be named as locked, with a reason');
    });
});
