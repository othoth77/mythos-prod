'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — research and champion / challenger tests
// projects/mythos-trading-control-center/tests/research-test.js
//
// The whole research path, through the API, against the real agent:
//
//   proposal → experiment → challenger → evidence → gate → (refused) promotion
//
// and the three properties the mission states for it:
//
//   · RESEARCH PROPOSES ONLY. Nothing in this path changes the running
//     configuration, the mode or the trading switch — asserted after every
//     step, not once at the end.
//   · EVIDENCE COMES FROM RECORDED RUNS. It cannot be typed in, and evidence
//     about a different configuration is refused.
//   · THE GATE DECIDES. On this synthetic data the challenger does not earn a
//     promotion, and the owner's confirmation cannot overrule that.
//
// The one test that exercises an ACCEPTED promotion says, in its name, that
// it puts passing evidence into the registry by hand to do so.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var path = require('path');

var h = require('./helpers');

var S, owner, operator, viewer;
var stateDir;
var sourceRun, report, experimentRun, otherExperimentRun, challengerId, demoRunId;
var before;

var SETUP = {
  universe: ['EURUSD'],
  account: { initialCapital: 5000 },
  jev: { scoreThreshold: 45, minConfidence: 0.15 },
  cost: { slippageModel: 'fixed', fixedSlippagePips: 0.3 }
};

async function status() { return (await viewer.get('/api/status')).body.result; }
async function registry() { return (await viewer.get('/api/research')).body.result.registry; }
async function waitJob(runId) {
  return h.waitFor(async function () {
    var r = await viewer.get('/api/jobs/' + runId);
    return r.body.result.run.status !== 'RUNNING' ? r.body.result.run : null;
  }, 180000, 150);
}
/** The running configuration, the mode and the trading switch are what they were. */
async function assertNothingChanged(where) {
  var now = await status();
  assert.equal(now.configFingerprint, before.configFingerprint, where + ': the running configuration changed');
  assert.equal(now.tradingEnabled, before.tradingEnabled, where + ': the trading switch changed');
  assert.equal(now.mode, before.mode, where + ': the mode changed');
}

test.before(async function () {
  stateDir = h.tempDir('tcc-research-state-');
  S = await h.startApp({ stateDir: stateDir });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
  var res = await owner.patch('/api/config', { changes: SETUP, reason: 'research test setup', confirm: 'CONFIRM' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  sourceRun = await h.runBacktest(owner, { data: { kind: 'FIXTURE', bars: 3000 }, verifyReproducible: false });
  assert.equal(sourceRun.status, 'COMPLETED', JSON.stringify(sourceRun.error));
  report = (await viewer.get('/api/research?run=' + sourceRun.runId)).body.result.report;
  before = await status();
});

test.after(async function () {
  await S.close();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
});

function proposalWhere(fn) { return report.proposals.filter(fn)[0]; }
var disableProposal = function () { return proposalWhere(function (p) { return p.override.strategy && p.override.strategy.disable; }); };
var limitProposal = function () { return proposalWhere(function (p) { return !p.override.strategy; }); };

// ---------------------------------------------------------------------------
// the report
// ---------------------------------------------------------------------------

test('the Research Agent report carries observations with samples, and every hypothesis its falsification', async function () {
  assert.equal(report.agent, 'RESEARCH_AGENT');
  assert.equal(report.authority, 'PROPOSAL_ONLY');
  assert.ok(report.observations.length >= 3, 'this run yields observations to test with');
  report.observations.forEach(function (o) { assert.equal(typeof o.sampleSize, 'number', o.kind + ' has no sample size'); });
  assert.equal(report.hypotheses.length, report.proposals.length);
  report.hypotheses.forEach(function (hyp) {
    assert.ok(hyp.falsification.length >= 20, hyp.hypothesisId + ' has no falsification criterion');
    assert.equal(hyp.authority, 'PROPOSAL_ONLY');
    assert.equal(hyp.baselineConfigHash, before.configFingerprint);
  });
  assert.ok(disableProposal() && limitProposal(), 'both kinds of proposal are present: ' + JSON.stringify(report.proposals.map(function (p) { return p.override; })));
});

// ---------------------------------------------------------------------------
// what a proposal may and may not carry
// ---------------------------------------------------------------------------

test('a proposal can only REMOVE strategies; it cannot add one, empty the set, or reach the mode', function () {
  var agent = S.app.platform.agent;
  var all = agent.strategyIds();
  var out = agent.applyProposal({}, all, { strategy: { disable: ['momentum'] }, jev: { minConfidence: 0.3 } });
  assert.equal(out.enabled.length, all.length - 1);
  assert.equal(out.enabled.indexOf('momentum'), -1);
  assert.deepEqual(out.overrides, { jev: { minConfidence: 0.3 } }, 'the strategy key is consumed; the rest is merged untouched');
  assert.throws(function () { agent.applyProposal({}, all, { strategy: { enable: ['momentum'] } }); }, /only strategy change a proposal may carry/);
  assert.throws(function () { agent.applyProposal({}, all, { strategy: { disable: ['momentum'], enable: ['x'] } }); }, /only strategy change/);
  assert.throws(function () { agent.applyProposal({}, all, { strategy: { disable: ['no-such-strategy'] } }); }, /unknown strategy/);
  assert.throws(function () { agent.applyProposal({}, ['momentum'], { strategy: { disable: ['momentum'] } }); }, /no strategy enabled/);
  // a strategy that is already off stays off: the proposal cannot re-enable by omission
  assert.deepEqual(agent.applyProposal({}, ['breakout', 'momentum'], { strategy: { disable: ['momentum'] } }).enabled, ['breakout']);
  // whatever else an override carries goes through the agent's own loader
  var live = agent.applyProposal({}, all, { mode: 'LIVE' });
  assert.throws(function () { agent.buildConfig(live.overrides, live.enabled); }, /mode|LIVE|invalid/i);
  var size = agent.applyProposal({}, all, { execution: { lots: 5 } });
  assert.throws(function () { agent.buildConfig(size.overrides, size.enabled); }, /not a known configuration key|invalid/i);
});

// ---------------------------------------------------------------------------
// experiments
// ---------------------------------------------------------------------------

test('a viewer cannot start an experiment, and an unknown proposal or run is refused by name', async function () {
  var p = disableProposal();
  assert.equal((await viewer.post('/api/research/experiments', { runId: sourceRun.runId, proposalId: p.proposalId })).status, 403);
  var unknown = await operator.post('/api/research/experiments', { runId: sourceRun.runId, proposalId: 'prop-9999' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'PROPOSAL_NOT_FOUND');
  var norun = await operator.post('/api/research/experiments', { runId: 'bt-20200101000000-aaaaaa', proposalId: p.proposalId });
  assert.equal(norun.status, 404);
  assert.equal((await operator.post('/api/research/experiments', { runId: sourceRun.runId, proposalId: p.proposalId, override: { risk: {} } })).status, 400,
    'an override cannot be supplied by the caller');
});

test('an experiment runs a strategy-disabling proposal: both sides, in and out of sample, walk-forward, stress, verdict', async function () {
  var p = disableProposal();
  var started = await operator.post('/api/research/experiments', { runId: sourceRun.runId, proposalId: p.proposalId });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.ok(started.body.audit.seq > 0, 'starting an experiment is audited');
  var second = await operator.post('/api/research/experiments', { runId: sourceRun.runId, proposalId: p.proposalId });
  assert.equal(second.status, 409, 'one job at a time');
  experimentRun = await waitJob(started.body.result.run.runId);
  assert.equal(experimentRun.status, 'COMPLETED', JSON.stringify(experimentRun.error));

  var view = (await viewer.get('/api/research')).body.result;
  var item = view.experiments.filter(function (x) { return x.run.runId === experimentRun.runId; })[0];
  var res = item.result;
  assert.equal(res.baselineConfigHash, before.configFingerprint, 'the baseline is the running configuration');
  assert.notEqual(res.variantConfigHash, res.baselineConfigHash);
  var disabled = p.override.strategy.disable[0];
  assert.ok(res.baselineEnabledStrategies.indexOf(disabled) !== -1);
  assert.equal(res.variantEnabledStrategies.indexOf(disabled), -1, 'the variant ran without the disabled strategy');
  assert.equal(res.variantEnabledStrategies.length, res.baselineEnabledStrategies.length - 1);
  assert.equal(res.data.label, 'SYNTHETIC');
  assert.ok(res.segments.inSample.toTs <= res.segments.outOfSample.fromTs, 'the out-of-sample segment follows the in-sample one');
  // the comparison is never return alone
  ['baseline', 'variant'].forEach(function (side) {
    ['inSample', 'outOfSample'].forEach(function (seg) {
      ['expectancy', 'maxDrawdownPct', 'maxConsecutiveLosses', 'profitFactor', 'winRate', 'tradeCount', 'totalCosts', 'netPnl', 'maxRecoveryLevel'].forEach(function (k) {
        assert.ok(k in res[side][seg], side + '.' + seg + ' has no ' + k);
      });
    });
  });
  assert.ok(res.variant.walkForward && res.variant.walkForward.folds >= 2, 'walk-forward ran');
  assert.ok(res.stress.scenariosRun >= 5);
  var withMetrics = res.stress.scenarios.filter(function (s) { return s.metrics; });
  assert.ok(withMetrics.length >= 3);
  withMetrics.forEach(function (s) { assert.equal(typeof s.metrics.trades, 'number', s.scenario + ' has no trade count'); });
  assert.ok(['APPROVE_AS_CHALLENGER', 'REJECT', 'INCONCLUSIVE'].indexOf(res.comparison.verdict) !== -1);
  assert.equal(res.comparison.authority, 'PROPOSAL_ONLY');
  assert.equal(res.comparison.blockers.length === 0, res.comparison.verdict === 'APPROVE_AS_CHALLENGER');
  if (res.comparison.verdict === 'REJECT') assert.equal(res.comparison.falsified, res.proposal.hypothesis.falsification);
  assert.deepEqual(experimentRun.summary.blockers, res.comparison.blockers.map(function (b) { return b.code; }));
  await assertNothingChanged('after an experiment');
});

test('a limit-changing proposal is tested too, and the variant differs only by that override', async function () {
  var p = limitProposal();
  var started = await operator.post('/api/research/experiments', { runId: sourceRun.runId, proposalId: p.proposalId });
  assert.equal(started.status, 202, JSON.stringify(started.body));
  otherExperimentRun = await waitJob(started.body.result.run.runId);
  assert.equal(otherExperimentRun.status, 'COMPLETED', JSON.stringify(otherExperimentRun.error));
  var res = (await viewer.get('/api/research')).body.result.experiments.filter(function (x) { return x.run.runId === otherExperimentRun.runId; })[0].result;
  assert.deepEqual(res.variantEnabledStrategies, res.baselineEnabledStrategies);
  assert.deepEqual(res.proposal.override, p.override);
  await assertNothingChanged('after the second experiment');
});

// ---------------------------------------------------------------------------
// challengers and evidence
// ---------------------------------------------------------------------------

test('a challenger is registered from a stored proposal only, by an operator, once', async function () {
  var p = disableProposal();
  assert.equal((await viewer.post('/api/research/challengers', { runId: sourceRun.runId, proposalId: p.proposalId })).status, 403);
  for (var body of [{ configHash: 'a'.repeat(64) }, { runId: sourceRun.runId, proposalId: p.proposalId, override: { risk: { maxDrawdownPct: 90 } } },
    { runId: sourceRun.runId, proposalId: p.proposalId, configHash: 'a'.repeat(64) }]) {
    assert.equal((await operator.post('/api/research/challengers', body)).status, 400, 'a free-typed challenger was accepted: ' + JSON.stringify(body));
  }
  var res = await operator.post('/api/research/challengers', { runId: sourceRun.runId, proposalId: p.proposalId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  challengerId = res.body.result.recordId;
  assert.equal(res.body.result.state, 'CHALLENGER');
  var ex = (await viewer.get('/api/research')).body.result.experiments.filter(function (x) { return x.run.runId === experimentRun.runId; })[0].result;
  assert.equal(res.body.result.configHash, ex.variantConfigHash, 'the challenger IS the configuration the experiment tested');
  var again = await operator.post('/api/research/challengers', { runId: sourceRun.runId, proposalId: p.proposalId });
  assert.equal(again.status, 403);
  assert.equal(again.body.error.code, 'PROMOTION_REFUSED');
  var reg = await registry();
  var c = reg.challengers.filter(function (x) { return x.recordId === challengerId; })[0];
  assert.deepEqual(c.override, p.override);
  assert.equal(c.gate.promotable, false);
  assert.deepEqual(c.gate.evidenceMissing.slice().sort(), reg.requiredEvidence.slice().sort(), 'a new challenger has no evidence at all');
  await assertNothingChanged('after registering a challenger');
});

test('evidence is attached from the experiment that tested THIS configuration, and from nothing else', async function () {
  var url = '/api/research/challengers/' + challengerId + '/evidence';
  assert.equal((await viewer.post(url, { experimentRunId: experimentRun.runId })).status, 403);
  assert.equal((await operator.post(url, {})).status, 400);
  assert.equal((await operator.post(url, { experimentRunId: experimentRun.runId, demoRunId: experimentRun.runId })).status, 400);
  assert.equal((await operator.post(url, { experimentRunId: experimentRun.runId, passed: true })).status, 400, 'a verdict cannot be typed in');
  assert.equal((await operator.post(url, { kind: 'STRESS_SUITE', passed: true, segment: 'x' })).status, 400);
  var wrong = await operator.post(url, { experimentRunId: otherExperimentRun.runId });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error.code, 'EVIDENCE_CONFIG_MISMATCH');
  var notExp = await operator.post(url, { experimentRunId: sourceRun.runId });
  assert.equal(notExp.body.error.code, 'WRONG_RUN_KIND');
  assert.equal((await operator.post('/api/research/challengers/chal-9999/evidence', { experimentRunId: experimentRun.runId })).status, 404);
  assert.equal((await registry()).challengers[0].evidence.length, 0, 'a refused attachment attaches nothing');

  var ok = await operator.post(url, { experimentRunId: experimentRun.runId });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  var kinds = ok.body.result.attached.map(function (e) { return e.kind; });
  assert.deepEqual(kinds, ['BACKTEST', 'OUT_OF_SAMPLE', 'WALK_FORWARD', 'STRESS_SUITE', 'MONTE_CARLO', 'COST_MODEL_APPLIED',
    'DRAWDOWN_WITHIN_LIMIT', 'LOSING_STREAK_WITHIN_LIMIT', 'CHAMPION_COMPARISON']);

  var view = (await viewer.get('/api/research')).body.result;
  var c = view.registry.challengers.filter(function (x) { return x.recordId === challengerId; })[0];
  var res = view.experiments.filter(function (x) { return x.run.runId === experimentRun.runId; })[0].result;
  var by = {};
  c.evidence.forEach(function (e) {
    by[e.kind] = e;
    assert.equal(typeof e.passed, 'boolean');
    assert.equal(e.source.run, experimentRun.runId);
    assert.equal(e.source.dataLabel, 'SYNTHETIC');
    assert.ok(e.kind === 'CHAMPION_COMPARISON' || e.detail.rule.length > 10, e.kind + ' does not state the rule it was judged by');
  });
  // each verdict is the recorded numbers under the stated rule — recomputed here
  var vOut = res.variant.outOfSample;
  assert.equal(by.OUT_OF_SAMPLE.passed, vOut.tradeCount >= view.registry.rules.minOutOfSampleTrades && vOut.expectancy > 0);
  assert.equal(by.STRESS_SUITE.passed, res.stress.survived === true);
  assert.equal(by.BACKTEST.passed, res.variant.inSample.tradeCount > 0);
  assert.deepEqual(by.OUT_OF_SAMPLE.metrics, vOut);
  assert.equal(c.gate.distinctSegments.length, 2);
  assert.deepEqual(c.gate.evidenceMissing, ['DEMO_COMPARISON']);
  assert.deepEqual(c.gate.unsatisfiableInCurrentMode, ['DEMO_COMPARISON'], 'the gate says what BACKTEST mode cannot provide');
  await assertNothingChanged('after attaching evidence');
});

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

test('promotion is refused by the gate — to an operator by role, to the owner by the evidence', async function () {
  var url = '/api/research/challengers/' + challengerId + '/promote';
  var basis = 'The owner would like this challenger promoted regardless.';
  assert.equal((await operator.post(url, { basis: basis, confirm: 'PROMOTE' })).status, 403);
  assert.equal((await operator.post(url, { basis: basis, confirm: 'PROMOTE' })).body.error.code, 'FORBIDDEN');
  var unconfirmed = await owner.post(url, { basis: basis });
  assert.equal(unconfirmed.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal((await owner.post(url, { basis: 'too short', confirm: 'PROMOTE' })).status, 400);
  assert.equal((await owner.post(url, { basis: basis, confirm: 'PROMOTE', force: true })).status, 400, 'there is no force flag');
  var refused = await owner.post(url, { basis: basis, confirm: 'PROMOTE' });
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, 'PROMOTION_REFUSED');
  var reg = await registry();
  assert.equal(reg.champion, null, 'a refused promotion installs nothing');
  assert.equal(reg.challengers.filter(function (x) { return x.recordId === challengerId; })[0].state, 'CHALLENGER');
  var audit = (await owner.get('/api/audit?limit=5')).body.result.items;
  assert.ok(audit.some(function (e) { return e.action === 'research.champion.promote' && e.outcome === 'REFUSED'; }), 'the refusal is in the audit log');
  await assertNothingChanged('after a refused promotion');
});

test('the champion is seeded by the owner only, with a basis, once — and it is recorded as SEEDED', async function () {
  var basis = 'The running configuration, as the reference to compare against.';
  assert.equal((await operator.post('/api/research/champion/seed', { basis: basis })).status, 403);
  assert.equal((await owner.post('/api/research/champion/seed', { basis: 'short' })).status, 400);
  assert.equal((await owner.post('/api/research/champion/seed', { basis: basis, configHash: 'b'.repeat(64) })).status, 400, 'the hash is never the caller\'s to choose');
  var res = await owner.post('/api/research/champion/seed', { basis: basis, runId: sourceRun.runId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  var reg = await registry();
  assert.equal(reg.champion.origin, 'SEEDED');
  assert.equal(reg.champion.configHash, before.configFingerprint);
  assert.equal(reg.champion.isRunningConfig, true);
  assert.equal(reg.champion.basis, basis);
  assert.equal(reg.champion.metrics.trades, sourceRun.summary.headline.trades, 'the metrics are the named run\'s, not typed in');
  assert.equal(reg.champion.previousChampionConfigHash, null);
  var again = await owner.post('/api/research/champion/seed', { basis: basis });
  assert.equal(again.status, 403);
  var rollback = await owner.post('/api/research/champion/rollback', { reason: 'nothing to roll back to', confirm: 'ROLLBACK' });
  assert.equal(rollback.status, 403, 'a seeded champion has no predecessor');
  assert.equal((await owner.post('/api/research/champion/rollback', { reason: 'nothing to roll back to' })).body.error.code, 'CONFIRMATION_REQUIRED');
  await assertNothingChanged('after seeding the champion');
});

// ---------------------------------------------------------------------------
// DEMO: champion against challenger on the same feed
// ---------------------------------------------------------------------------

test('a DEMO session runs the challenger beside the champion, and its comparison becomes evidence', async function () {
  await h.enterPaper(owner);
  var started = await operator.post('/api/paper/start', { data: { kind: 'FIXTURE', symbols: ['EURUSD'], bars: 1500 }, demo: { challengerRecordId: challengerId } });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.result.session.kind, 'DEMO');
  while (S.app.platform.paper.step()) { /* to the end of the feed */ }
  var v = (await viewer.get('/api/paper')).body.result;
  assert.equal(v.state, 'STOPPED');
  assert.deepEqual(v.session.arms.map(function (a) { return a.label; }), ['champion', 'challenger']);
  assert.notEqual(v.session.arms[0].configHash, v.session.arms[1].configHash);
  demoRunId = v.session.sessionId;
  await owner.post('/api/paper/reset', { confirm: 'RESET' });

  var url = '/api/research/challengers/' + challengerId + '/evidence';
  assert.equal((await operator.post(url, { demoRunId: sourceRun.runId })).body.error.code, 'WRONG_RUN_KIND');
  var res = await operator.post(url, { demoRunId: demoRunId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.attached[0].kind, 'DEMO_COMPARISON');
  var c = (await registry()).challengers.filter(function (x) { return x.recordId === challengerId; })[0];
  var demo = c.evidence.filter(function (e) { return e.kind === 'DEMO_COMPARISON'; })[0];
  assert.equal(demo.source.dataLabel, 'PAPER');
  assert.equal(demo.segment, 'paper:' + demoRunId);
  var cmp = demo.metrics;
  assert.equal(demo.passed, cmp.netPnlDelta > 0 && cmp.drawdownDeltaPct <= 0 && cmp.streakDelta <= 0, 'passed is the stated rule over the recorded deltas');
  assert.deepEqual(c.gate.evidenceMissing, [], 'every kind of evidence is now present');
  assert.equal(c.gate.distinctSegments.length, 3);
  // ...and the gate still refuses, because present is not the same as passing
  assert.equal(c.gate.promotable, false);
  assert.ok(c.gate.blockers.some(function (b) { return b.code === 'FAILED_EVIDENCE'; }));
  var refused = await owner.post('/api/research/challengers/' + challengerId + '/promote', { basis: 'All ten kinds are attached; promote it now.', confirm: 'PROMOTE' });
  assert.equal(refused.status, 403);
  assert.equal((await registry()).champion.configHash, before.configFingerprint, 'the champion is unchanged');
  var now = await status();
  assert.equal(now.configFingerprint, before.configFingerprint, 'a demo session does not change the running configuration');
});

// ---------------------------------------------------------------------------
// the journal
// ---------------------------------------------------------------------------

test('the registry survives a restart by replaying its journal through the same gate', async function () {
  var beforeRestart = await registry();
  await S.close();
  S = await h.startApp({ stateDir: stateDir });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
  var after = await registry();
  assert.deepEqual(after.replayProblems, []);
  assert.deepEqual(after.champion, beforeRestart.champion);
  assert.equal(after.challengers.length, beforeRestart.challengers.length);
  var a = after.challengers[0];
  var b = beforeRestart.challengers[0];
  assert.equal(a.recordId, b.recordId);
  assert.equal(a.configHash, b.configHash);
  assert.deepEqual(a.evidence, b.evidence, 'every evidence item is back, with its original timestamp');
  assert.equal((await status()).mode, 'BACKTEST', 'a restart is always BACKTEST');
  // the demo evidence was produced in PAPER; replayed under BACKTEST the gate now says so
  assert.ok(a.gate.blockers.some(function (x) { return x.code === 'EVIDENCE_IMPOSSIBLE_IN_CURRENT_MODE'; }) || !a.gate.promotable);
});

test('a journal line written by hand cannot make a champion: replay runs the gate and reports the line', async function () {
  await S.close();
  var journal = path.join(stateDir, 'research-journal.jsonl');
  var lines = fs.readFileSync(journal, 'utf8').trim().split('\n').length;
  fs.appendFileSync(journal, JSON.stringify({ at: Date.now(), mode: 'PAPER', op: 'PROMOTE',
    args: { recordId: challengerId, principal: { kind: 'OWNER', id: 'owner:forged' }, basis: 'forged promotion line appended to the journal' } }) + '\n');
  fs.appendFileSync(journal, JSON.stringify({ at: Date.now(), mode: 'PAPER', op: 'DROP_EVERYTHING', args: {} }) + '\n');
  S = await h.startApp({ stateDir: stateDir });
  owner = await S.login('owner');
  operator = await S.login('operator');
  viewer = await S.login('viewer');
  var reg = await registry();
  assert.equal(reg.champion.configHash, before.configFingerprint, 'the forged promotion did not take effect');
  assert.equal(reg.champion.origin, 'SEEDED');
  assert.equal(reg.replayProblems.length, 2);
  assert.equal(reg.replayProblems[0].line, lines + 1);
  assert.equal(reg.replayProblems[0].op, 'PROMOTE');
  assert.match(reg.replayProblems[1].message, /unknown journal operation/);
  assert.equal(reg.challengers.filter(function (x) { return x.recordId === challengerId; })[0].state, 'CHALLENGER');
});

// ---------------------------------------------------------------------------
// rejection
// ---------------------------------------------------------------------------

test('a challenger is rejected with a reason, keeps its evidence, and can take no more', async function () {
  var url = '/api/research/challengers/' + challengerId + '/reject';
  assert.equal((await viewer.post(url, { reason: 'viewer rejects it' })).status, 403);
  assert.equal((await operator.post(url, {})).status, 400);
  var res = await operator.post(url, { reason: 'out-of-sample expectancy did not improve' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.result.state, 'REJECTED');
  var c = (await registry()).challengers.filter(function (x) { return x.recordId === challengerId; })[0];
  assert.equal(c.state, 'REJECTED');
  assert.equal(c.rejectedReason, 'out-of-sample expectancy did not improve');
  assert.equal(c.evidence.length, 10, 'the evidence is kept');
  assert.equal(c.gate, null);
  var more = await operator.post('/api/research/challengers/' + challengerId + '/evidence', { experimentRunId: experimentRun.runId });
  assert.equal(more.status, 403);
  var promote = await owner.post('/api/research/challengers/' + challengerId + '/promote', { basis: 'promote the rejected challenger anyway', confirm: 'PROMOTE' });
  assert.equal(promote.status, 403);
  assert.equal((await operator.post('/api/paper/start', { demo: { challengerRecordId: challengerId } })).status >= 400, true, 'a rejected challenger cannot be run as a demo arm');
});

// ---------------------------------------------------------------------------
// the accepted path — exercised with evidence put into the registry BY THIS TEST
// ---------------------------------------------------------------------------

test('WITH PASSING EVIDENCE INSERTED BY THE TEST: promote and roll back change the record only, never the running configuration', async function () {
  // No configuration earns a promotion on the synthetic fixture, so the
  // accepted path is exercised by handing the registry passing evidence
  // directly. That bypass exists only inside this process: it is not journalled,
  // and the last assertion shows a restart does not honour it.
  var p = limitProposal();
  var reg0 = await operator.post('/api/research/challengers', { runId: sourceRun.runId, proposalId: p.proposalId });
  assert.equal(reg0.status, 200, JSON.stringify(reg0.body));
  var id = reg0.body.result.recordId;
  var hash = reg0.body.result.configHash;
  await h.enterPaper(owner);
  var registryObj = S.app.platform.research.registry();
  (await registry()).requiredEvidence.forEach(function (kind, i) {
    registryObj.attachEvidence(id, { kind: kind, configHash: hash, segment: i % 2 ? 'segment-a' : 'segment-b', passed: true,
      metrics: kind === 'CHAMPION_COMPARISON' ? { outOfSampleTrades: 80, expectancyDelta: 0.5, drawdownDeltaPct: -0.1, streakDelta: -1 } : null });
  });
  var c = (await registry()).challengers.filter(function (x) { return x.recordId === id; })[0];
  assert.equal(c.gate.promotable, true, JSON.stringify(c.gate.blockers));

  var fpBefore = (await status()).configFingerprint;
  assert.equal((await operator.post('/api/research/challengers/' + id + '/promote', { basis: 'operator tries the promotable challenger', confirm: 'PROMOTE' })).status, 403);
  var res = await owner.post('/api/research/challengers/' + id + '/promote', { basis: 'Every gate passed in this test fixture.', confirm: 'PROMOTE' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.result.note, /RUNNING configuration did not/);
  var reg = await registry();
  assert.equal(reg.champion.configHash, hash);
  assert.equal(reg.champion.origin, 'PROMOTED');
  assert.equal(reg.champion.isRunningConfig, false, 'promotion did not apply the configuration');
  assert.equal(reg.champion.previousChampionConfigHash, before.configFingerprint);
  assert.equal(reg.runningConfigHash, fpBefore);
  var st = await status();
  assert.equal(st.configFingerprint, fpBefore, 'the running configuration is untouched by a promotion');
  assert.equal(st.mode, 'PAPER', 'and so is the mode');

  var back = await owner.post('/api/research/champion/rollback', { reason: 'restore the seeded champion', confirm: 'ROLLBACK' });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  reg = await registry();
  assert.equal(reg.champion.configHash, before.configFingerprint);
  assert.equal(reg.champion.origin, 'ROLLBACK');
  assert.equal((await status()).configFingerprint, fpBefore);
  var actions = (await owner.get('/api/audit?limit=10')).body.result.items.map(function (e) { return e.action + ':' + e.outcome; });
  assert.ok(actions.indexOf('research.champion.promote:ACCEPTED') !== -1 && actions.indexOf('research.champion.rollback:ACCEPTED') !== -1, actions.join(' '));

  // The hand-inserted evidence was never journalled, so a restart replays the
  // PROMOTE through the gate without it — and refuses it.
  await S.close();
  S = await h.startApp({ stateDir: stateDir });
  viewer = await S.login('viewer');
  var after = await registry();
  assert.equal(after.champion.configHash, before.configFingerprint);
  assert.equal(after.champion.origin, 'SEEDED', 'the promotion did not survive: its evidence was not in the journal');
  assert.ok(after.replayProblems.some(function (x) { return x.op === 'PROMOTE'; }));
});
