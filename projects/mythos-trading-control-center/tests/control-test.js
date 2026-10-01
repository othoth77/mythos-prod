'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — configuration and mode control tests
// projects/mythos-trading-control-center/tests/control-test.js
//
// Every configuration mutation must: validate, authorize, persist, audit, and
// return a deterministic result — and record actor, timestamp, old value, new
// value, reason and the config fingerprint. This suite asserts each of those
// for each kind of mutation, and then the mode rules:
//
//   * the mode rises only for an OWNER presenting a complete approval record
//     bound to the running fingerprint and commit;
//   * an approval is single-use, across a restart too;
//   * a configuration change invalidates the approval and returns to BACKTEST.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');

var h = require('./helpers');

var S, owner, operator, viewer;

test.before(async function () {
  S = await h.startApp();
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
});

test.after(async function () { await S.close(); });

async function fingerprint() { return (await viewer.get('/api/config')).body.result.fingerprint; }
async function lastAudit(action) {
  var r = await viewer.get('/api/audit?limit=1' + (action ? '&action=' + action : ''));
  return r.body.result.items[0];
}

// ---------------------------------------------------------------------------
// configuration
// ---------------------------------------------------------------------------

test('a configuration change is validated, applied, persisted and audited with old and new values', async function () {
  var before = await fingerprint();
  var res = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 12 } }, reason: 'tighten the drawdown cap' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  var r = res.body.result;
  assert.equal(r.changed, true);
  assert.deepEqual(r.diff, [{ path: 'risk.maxDrawdownPct', oldValue: 20, newValue: 12 }]);
  assert.notEqual(r.fingerprint, before, 'the fingerprint must change with the configuration');
  assert.match(res.body.audit.hash, /^[0-9a-f]{64}$/);

  assert.equal((await viewer.get('/api/config')).body.result.config.risk.maxDrawdownPct, 12);

  var a = await lastAudit('config.update');
  assert.equal(a.outcome, 'ACCEPTED');
  assert.equal(a.actor.id, 'owner');
  assert.equal(a.actor.role, 'OWNER');
  assert.equal(a.reason, 'tighten the drawdown cap');
  assert.deepEqual(a.oldValue, { 'risk.maxDrawdownPct': 20 });
  assert.deepEqual(a.newValue, { 'risk.maxDrawdownPct': 12 });
  assert.equal(a.fingerprintBefore, before);
  assert.equal(a.fingerprintAfter, r.fingerprint);
  assert.match(a.commit, /^[0-9a-f]{40}$/);
  assert.ok(Date.parse(a.ts) > 0);
});

test('configuration history records actor, time, diff, reason and both fingerprints', async function () {
  var hist = (await viewer.get('/api/config/history')).body.result;
  assert.ok(hist.total >= 1);
  var e = hist.items[0];
  assert.equal(e.kind, 'CONFIG_UPDATE');
  assert.equal(e.actor.id, 'owner');
  assert.equal(e.reason, 'tighten the drawdown cap');
  assert.equal(e.diff[0].path, 'risk.maxDrawdownPct');
  assert.match(e.fingerprintBefore, /^[0-9a-f]{64}$/);
  assert.match(e.fingerprintAfter, /^[0-9a-f]{64}$/);
  assert.ok(e.revision >= 1);
});

test('a change needs a reason', async function () {
  var res = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 11 } } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  var short = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 11 } }, reason: 'x' });
  assert.equal(short.status, 400);
  assert.equal((await viewer.get('/api/config')).body.result.config.risk.maxDrawdownPct, 12);
});

test('the Trading Agent\'s own schema decides validity, and nothing is applied when it refuses', async function () {
  var before = await fingerprint();
  var res = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 500 } }, reason: 'out of range value' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'CONFIG_INVALID');
  assert.ok(res.body.error.problems.some(function (p) { return /maxDrawdownPct/.test(p.path); }));
  // Semantic rule from the agent: the daily limit may not exceed the drawdown cap.
  var sem = await owner.patch('/api/config', { changes: { risk: { maxDailyLossPct: 40 } }, reason: 'daily above drawdown', confirm: 'CONFIRM' });
  assert.equal(sem.status, 400);
  assert.equal(await fingerprint(), before);
  var a = await lastAudit('config.update');
  assert.equal(a.outcome, 'REFUSED');
  assert.equal(a.code, 'CONFIG_INVALID');
});

test('locked keys cannot be changed: mode, the one-trade invariant, the audit switch, the kill switch', async function () {
  var before = await fingerprint();
  var attempts = [
    { mode: 'PAPER' },
    { mode: 'LIVE' },
    { risk: { maxOpenTrades: 5 } },
    { risk: { emergencyStop: false } },
    { observability: { auditEveryCandidate: false } },
    { schemaVersion: 2 },
    { notes: { controlCenter: { enabledStrategies: [] } } },
    { jev: { model: 'none' } },
    { madeUp: true },
    { risk: { madeUp: 1 } }
  ];
  for (var i = 0; i < attempts.length; i++) {
    var res = await owner.patch('/api/config', { changes: attempts[i], reason: 'attempt a locked key', confirm: 'CONFIRM' });
    assert.equal(res.status, 400, JSON.stringify(attempts[i]) + ' → ' + res.status);
    assert.equal(res.body.error.code, 'CONFIG_CHANGE_NOT_ALLOWED', JSON.stringify(attempts[i]));
    assert.ok(res.body.error.problems.length > 0);
  }
  assert.equal(await fingerprint(), before);
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST');
});

test('a change that loosens a protection needs an explicit confirmation', async function () {
  var before = await fingerprint();
  var res = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 18 } }, reason: 'loosen the drawdown cap' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.deepEqual(res.body.error.loosened, [{ path: 'risk.maxDrawdownPct', oldValue: 12, newValue: 18 }]);
  assert.equal(await fingerprint(), before, 'nothing may be applied without the confirmation');

  var rec = await owner.patch('/api/config', { changes: { recovery: { enabled: true } }, reason: 'enable the recovery ladder' });
  assert.equal(rec.status, 409, 'enabling recovery is a loosening');

  var ok = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 18 } }, reason: 'loosen the drawdown cap', confirm: 'CONFIRM' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.result.loosened.map(function (l) { return l.path; }), ['risk.maxDrawdownPct']);
  var a = await lastAudit('config.update');
  assert.deepEqual(a.detail.loosened, ['risk.maxDrawdownPct']);
});

test('tightening a protection needs no confirmation', async function () {
  var res = await owner.patch('/api/config', { changes: { risk: { maxAccountRiskPerTradePct: 1 }, jev: { scoreThreshold: 75 } }, reason: 'tighten risk and Jev' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.loosened.length, 0);
});

test('a stale expected fingerprint is refused, so two operators cannot overwrite each other blindly', async function () {
  var stale = 'a'.repeat(64);
  var res = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 10 } }, reason: 'with a stale fingerprint', expectedFingerprint: stale });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'CONFIG_STALE');
  var fresh = await fingerprint();
  var ok = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 10 } }, reason: 'with the current fingerprint', expectedFingerprint: fresh });
  assert.equal(ok.status, 200);
});

test('a no-op change is reported as unchanged and does not bump the revision', async function () {
  var c = (await viewer.get('/api/config')).body.result;
  var res = await owner.patch('/api/config', { changes: { risk: { maxDrawdownPct: 10 } }, reason: 'same value again' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.changed, false);
  assert.equal(res.body.result.fingerprint, c.fingerprint);
  assert.equal((await viewer.get('/api/config')).body.result.revision, c.revision);
});

test('only an OWNER may change the configuration; the refusal is audited', async function () {
  var before = await fingerprint();
  for (var c of [operator, viewer]) {
    var res = await c.patch('/api/config', { changes: { risk: { maxDrawdownPct: 9 } }, reason: 'not the owner' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
  assert.equal(await fingerprint(), before);
  var a = await lastAudit('config.update');
  assert.equal(a.outcome, 'REFUSED');
  assert.equal(a.code, 'FORBIDDEN');
  assert.equal(a.actor.id, 'viewer');
});

test('assets (the universe) and per-asset sessions are configurable and validated by the agent', async function () {
  var res = await owner.patch('/api/config', {
    changes: { universe: ['EURUSD', 'XAUUSD'], schedule: { perAsset: { EURUSD: { startHourUtc: 7, endHourUtc: 16 }, XAUUSD: { enabled: false } } } },
    reason: 'restrict the universe and set sessions'
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  var c = (await viewer.get('/api/config')).body.result;
  assert.deepEqual(c.config.universe, ['EURUSD', 'XAUUSD']);
  var eur = c.assets.filter(function (a) { return a.symbol === 'EURUSD'; })[0];
  assert.equal(eur.inUniverse, true);
  assert.equal(eur.schedule.startHourUtc, 7);
  assert.equal(c.assets.filter(function (a) { return a.symbol === 'GBPUSD'; })[0].inUniverse, false);
  assert.equal(c.assets.filter(function (a) { return a.symbol === 'XAUUSD'; })[0].schedule.enabled, false);

  var bad = await owner.patch('/api/config', { changes: { universe: ['EURUSD', 'DOGEUSD'] }, reason: 'an asset that does not exist' });
  assert.equal(bad.status, 400);
  var badSched = await owner.patch('/api/config', { changes: { schedule: { perAsset: { NOPE: { enabled: true } } } }, reason: 'schedule for unknown asset' });
  assert.equal(badSched.status, 400);

  // The per-asset map replaces: an asset left out is removed.
  var rep = await owner.patch('/api/config', { changes: { schedule: { perAsset: { EURUSD: { startHourUtc: 8, endHourUtc: 17 } } } }, reason: 'replace the session map' });
  assert.equal(rep.status, 200);
  var c2 = (await viewer.get('/api/config')).body.result;
  assert.equal(c2.assets.filter(function (a) { return a.symbol === 'XAUUSD'; })[0].schedule.enabled, true);
});

test('strategies can be disabled and re-enabled, and the fingerprint follows the set', async function () {
  var before = await fingerprint();
  var res = await owner.post('/api/config/strategies', { enabled: ['trend-following', 'momentum', 'breakout'], reason: 'run three families only' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.result.enabled, ['trend-following', 'breakout', 'momentum'], 'registry order is canonical');
  assert.notEqual(res.body.result.fingerprint, before, 'the strategy set must be inside the fingerprint');
  var c = (await viewer.get('/api/config')).body.result;
  assert.equal(c.strategies.filter(function (s) { return s.enabled; }).length, 3);
  assert.deepEqual(c.config.notes.controlCenter.enabledStrategies, ['breakout', 'momentum', 'trend-following']);

  var a = await lastAudit('strategies.update');
  assert.equal(a.oldValue.length, 14);
  assert.equal(a.newValue.length, 3);

  assert.equal((await owner.post('/api/config/strategies', { enabled: ['nope'], reason: 'unknown strategy id' })).status, 400);
  assert.equal((await owner.post('/api/config/strategies', { enabled: [], reason: 'no strategy at all' })).status, 400);
  assert.equal((await operator.post('/api/config/strategies', { enabled: ['momentum'], reason: 'not the owner' })).status, 403);

  var all = c.strategies.map(function (s) { return s.strategyId; });
  var back = await owner.post('/api/config/strategies', { enabled: all, reason: 'restore all fourteen' });
  assert.equal(back.status, 200);
  assert.equal(back.body.result.enabled.length, 14);
});

// ---------------------------------------------------------------------------
// trading enable / disable
// ---------------------------------------------------------------------------

test('an operator may DISABLE trading; the kill switch is the Risk Engine\'s own', async function () {
  var res = await operator.post('/api/config/trading', { enabled: false, reason: 'operator stops trading' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.tradingEnabled, false);
  var c = (await viewer.get('/api/config')).body.result;
  assert.equal(c.config.risk.emergencyStop, true, 'disabled trading IS risk.emergencyStop');
  assert.equal((await viewer.get('/api/dashboard')).body.result.tradingStatus, 'DISABLED');
  var a = await lastAudit('trading.set');
  assert.deepEqual(a.oldValue, { tradingEnabled: true });
  assert.deepEqual(a.newValue, { tradingEnabled: false });
  assert.equal(a.actor.id, 'operator');
});

test('with trading disabled, a backtest produces candidates and no trade at all', async function () {
  var run = await h.runBacktest(owner, { symbols: ['EURUSD'], data: { kind: 'FIXTURE', bars: 900 }, verifyReproducible: false });
  assert.equal(run.status, 'COMPLETED', JSON.stringify(run.error));
  assert.equal(run.summary.headline.trades, 0, 'the Risk Engine must block every candidate while the emergency stop is set');
  var risk = (await viewer.get('/api/risk?run=' + run.runId)).body.result;
  assert.equal(risk.tradingEnabled, false);
});

test('enabling trading needs the OWNER and an explicit confirmation', async function () {
  var op = await operator.post('/api/config/trading', { enabled: true, reason: 'operator tries to enable', confirm: 'ENABLE' });
  assert.equal(op.status, 403);
  var noConfirm = await owner.post('/api/config/trading', { enabled: true, reason: 'owner without confirmation' });
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await viewer.get('/api/status')).body.result.tradingEnabled, false);
  var ok = await owner.post('/api/config/trading', { enabled: true, reason: 'owner re-enables trading', confirm: 'ENABLE' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result.tradingEnabled, true);
});

// ---------------------------------------------------------------------------
// mode
// ---------------------------------------------------------------------------

test('the mode route publishes exactly what an approval must contain', async function () {
  var m = (await viewer.get('/api/config/mode')).body.result;
  assert.equal(m.mode, 'BACKTEST');
  assert.equal(m.liveAvailable, false);
  assert.deepEqual(m.modesAvailable, ['BACKTEST', 'PAPER']);
  assert.equal(m.toPaper.requiredStatement, 'I approve the Mythos Trading Agent transition BACKTEST -> PAPER');
  assert.equal(m.toPaper.gates.length, 10);
  assert.equal(m.toPaper.configFingerprint, await fingerprint());
  assert.match(m.toPaper.commit, /^[0-9a-f]{40}$/);
});

test('PAPER is refused without an approval record', async function () {
  var res = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'no approval attached' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'APPROVAL_REQUIRED');
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST');
});

test('an operator cannot raise the mode even with a complete approval record', async function () {
  var approval = await h.paperApproval(owner);
  var res = await operator.post('/api/config/mode', { to: 'PAPER', reason: 'operator with a full record', approval: approval });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST');
  var a = await lastAudit('mode.set');
  assert.equal(a.outcome, 'REFUSED');
  assert.equal(a.actor.id, 'operator');
});

test('each defect in an approval record is refused by the Trading Agent itself', async function () {
  var good = await h.paperApproval(owner);
  var defects = {
    'wrong statement': { statement: 'I approve whatever this is, sure' },
    'no ownerApproval': { ownerApproval: false },
    'wrong fingerprint': { configFingerprint: 'b'.repeat(64) },
    'wrong commit': { commit: 'c'.repeat(40) },
    'a gate missing': { gatesPassed: good.gatesPassed.slice(1) },
    'evidence missing': { gateEvidence: {} },
    'evidence too short': { gateEvidence: Object.fromEntries(good.gatesPassed.map(function (g) { return [g, 'ok']; })) },
    'unknown gate claimed': { gatesPassed: good.gatesPassed.concat(['MADE_UP_GATE']) }
  };
  for (var name of Object.keys(defects)) {
    var approval = Object.assign({}, good, defects[name], { nonce: 'defect-' + Math.random().toString(36).slice(2, 12) });
    var res = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'defective approval: ' + name, approval: approval });
    assert.equal(res.status, 403, name + ' → ' + res.status + ' ' + JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'MODE_TRANSITION_REFUSED', name);
    assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST', name);
  }
});

test('the approving principal comes from the session; a payload cannot name one', async function () {
  var approval = await h.paperApproval(owner);
  approval.approvedBy = { kind: 'OWNER', id: 'owner:someone-else' };
  var res = await operator.post('/api/config/mode', { to: 'PAPER', reason: 'forged approver in the payload', approval: approval });
  assert.equal(res.status, 400, 'approvedBy is not an accepted field');
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('a dry run reports what is missing and changes nothing', async function () {
  var res = await owner.post('/api/config/mode/dry-run', { to: 'PAPER' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.ok, false);
  assert.ok(res.body.result.problems.length > 0);
  var good = await h.paperApproval(owner);
  var ok = await owner.post('/api/config/mode/dry-run', { to: 'PAPER', approval: good });
  assert.equal(ok.body.result.ok, true);
  var op = await operator.post('/api/config/mode/dry-run', { to: 'PAPER', approval: good });
  assert.equal(op.body.result.ok, false, 'a dry run for an operator must say it would be refused');
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST');
});

test('the owner reaches PAPER with a complete record, and the transition is recorded', async function () {
  var approval = await h.paperApproval(owner);
  var res = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'owner approves paper trading', approval: approval });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.mode, 'PAPER');
  assert.match(res.body.result.approvalId, /^approval-[0-9a-f]{24}$/);
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'PAPER');

  var a = await lastAudit('mode.set');
  assert.equal(a.outcome, 'ACCEPTED');
  assert.deepEqual(a.oldValue, { mode: 'BACKTEST' });
  assert.deepEqual(a.newValue, { mode: 'PAPER' });
  assert.equal(a.detail.direction, 'UPGRADE');
  assert.equal(a.detail.gatesPassed.length, 10);

  var ev = (await viewer.get('/api/config/mode')).body.result.events[0];
  assert.equal(ev.toMode, 'PAPER');
  assert.equal(ev.principalKind, 'OWNER');
  assert.equal(ev.principalId, 'owner:owner');
  assert.equal(ev.approvalId, res.body.result.approvalId);

  // Reused below: the exact record that was just accepted.
  test.usedApproval = approval;
});

test('an operator may lower the mode without any approval', async function () {
  var res = await operator.post('/api/config/mode', { to: 'BACKTEST', reason: 'operator reduces exposure' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.mode, 'BACKTEST');
  var a = await lastAudit('mode.set');
  assert.equal(a.detail.direction, 'DOWNGRADE');
  assert.equal(a.actor.id, 'operator');
});

test('an approval record is single-use: replaying the accepted one is refused', async function () {
  var res = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'replay the same record', approval: test.usedApproval });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'APPROVAL_ALREADY_USED');
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST');
});

test('a configuration change while in PAPER returns the platform to BACKTEST', async function () {
  await h.enterPaper(owner, 'owner approves paper again');
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'PAPER');
  var res = await owner.patch('/api/config', { changes: { jev: { scoreThreshold: 80 } }, reason: 'change the system under approval' });
  assert.equal(res.status, 200);
  assert.equal(res.body.result.modeReset, true);
  assert.equal(res.body.result.mode, 'BACKTEST');
  assert.equal((await viewer.get('/api/status')).body.result.mode, 'BACKTEST',
    'an approval of the previous configuration is not an approval of this one');
  var ev = (await viewer.get('/api/config/mode')).body.result.events[0];
  assert.equal(ev.direction, 'DOWNGRADE');
  assert.match(ev.reason, /configuration changed/);
});

test('an approval bound to the previous fingerprint no longer works', async function () {
  var stale = await h.paperApproval(owner);
  await owner.patch('/api/config', { changes: { jev: { scoreThreshold: 81 } }, reason: 'move the fingerprint on' });
  var res = await owner.post('/api/config/mode', { to: 'PAPER', reason: 'approval of the old fingerprint', approval: stale });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'MODE_TRANSITION_REFUSED');
  assert.match(res.body.error.message, /configFingerprint/);
});

// ---------------------------------------------------------------------------
// persistence across a restart
// ---------------------------------------------------------------------------

test('configuration survives a restart; the mode does not, and used approvals stay used', async function () {
  var dir = h.tempDir('tcc-restart-');
  var A = await h.startApp({ stateDir: dir });
  var o = await A.login('owner');
  await o.patch('/api/config', { changes: { risk: { maxDrawdownPct: 14 } }, reason: 'persist me across a restart' });
  await o.post('/api/config/strategies', { enabled: ['momentum', 'breakout'], reason: 'two families' });
  var approval = await h.paperApproval(o);
  var up = await o.post('/api/config/mode', { to: 'PAPER', reason: 'approve paper before the restart', approval: approval });
  assert.equal(up.status, 200);
  var fpBefore = (await o.get('/api/config')).body.result.fingerprint;
  var auditBefore = (await o.get('/api/audit/verify')).body.result;
  await A.app.close();

  var B = await h.startApp({ stateDir: dir });
  var o2 = await B.login('owner');
  var c = (await o2.get('/api/config')).body.result;
  assert.equal(c.config.risk.maxDrawdownPct, 14);
  assert.equal(c.strategies.filter(function (s) { return s.enabled; }).length, 2);
  assert.equal(c.fingerprint, fpBefore, 'the same configuration must have the same fingerprint after a restart');
  assert.equal(c.mode, 'BACKTEST', 'a restart must come up in BACKTEST, never in PAPER');

  var replay = await o2.post('/api/config/mode', { to: 'PAPER', reason: 'replay after restart', approval: approval });
  assert.equal(replay.status, 403);
  assert.equal(replay.body.error.code, 'APPROVAL_ALREADY_USED', 'single use must survive a restart');

  var hist = (await o2.get('/api/config/history')).body.result;
  assert.ok(hist.total >= 2, 'history must survive a restart');
  var verify = (await o2.get('/api/audit/verify')).body.result;
  assert.equal(verify.ok, true);
  assert.ok(verify.entries > auditBefore.entries, 'the chain continues after a restart');
  await B.app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a persisted configuration the agent rejects is not applied, and trading comes up disabled', async function () {
  var dir = h.tempDir('tcc-badstate-');
  fs.writeFileSync(dir + '/control.json', JSON.stringify({ revision: 3, overrides: { risk: { maxDrawdownPct: 9999 } }, enabledStrategies: ['momentum'] }));
  var A = await h.startApp({ stateDir: dir });
  var o = await A.login('owner');
  var c = (await o.get('/api/config')).body.result;
  assert.equal(c.config.risk.maxDrawdownPct, 20, 'the rejected value must not be in effect');
  assert.equal(c.tradingEnabled, false, 'an unusable persisted configuration must fail closed');
  assert.match(c.startupProblem, /rejected by the Trading Agent/);
  var sys = (await o.get('/api/system')).body.result;
  assert.ok(sys.events.some(function (e) { return e.kind === 'CONFIG_REJECTED_AT_START'; }));
  await A.app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a preview states the difference, what it loosens and what it resets — and changes nothing', async function () {
  var A = await h.startApp();
  try {
    var o = await A.login('owner');
    var op = await A.login('operator');
    var v = await A.login('viewer');
    var before = (await v.get('/api/config')).body.result;
    assert.equal((await v.post('/api/config/preview', { changes: { risk: { maxDrawdownPct: 25 } } })).status, 403, 'a preview reveals validation detail; it needs OPERATOR');
    var res = await op.post('/api/config/preview', { changes: { risk: { maxDrawdownPct: 25, maxConsecutiveLosses: 4 }, jev: { scoreThreshold: 75 } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    var p = res.body.result;
    assert.deepEqual(p.diff.map(function (d) { return [d.path, d.oldValue, d.newValue]; }).sort(),
      [['jev.scoreThreshold', 70, 75], ['risk.maxConsecutiveLosses', 5, 4], ['risk.maxDrawdownPct', 20, 25]]);
    assert.deepEqual(p.loosened.map(function (l) { return l.path; }), ['risk.maxDrawdownPct'], 'only the limit that got weaker is a loosening');
    assert.notEqual(p.fingerprintAfter, before.fingerprint);
    assert.equal(p.fingerprintBefore, before.fingerprint);
    // unchanged values are not a difference
    assert.deepEqual((await op.post('/api/config/preview', { changes: { risk: { maxDrawdownPct: 20 } } })).body.result.diff, []);
    // what the agent would reject is refused in the preview, with the agent's reason
    var bad = await op.post('/api/config/preview', { changes: { risk: { maxDrawdownPct: 9999 } } });
    assert.equal(bad.status, 400);
    var locked = await op.post('/api/config/preview', { changes: { mode: 'LIVE' } });
    assert.equal(locked.status, 400);
    assert.equal(locked.body.error.code, 'CONFIG_CHANGE_NOT_ALLOWED');
    assert.equal((await op.post('/api/config/preview', { changes: { risk: { maxDrawdownPct: 25 } }, apply: true })).status, 400);
    // nothing was applied, nothing was added to the history, and an accepted preview is not an audit entry
    var after = (await v.get('/api/config')).body.result;
    assert.equal(after.fingerprint, before.fingerprint);
    assert.equal(after.revision, before.revision);
    var audit = (await o.get('/api/audit?action=config.preview')).body.result.items;
    assert.ok(audit.length >= 2, 'the refused previews are audited');
    audit.forEach(function (e) { assert.notEqual(e.outcome, 'ACCEPTED', 'a read-only preview does not fill the log'); });
  } finally { await A.close(); }
});
