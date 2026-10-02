'use strict';
// =====================================================
// MYTHOS OS v4 — the executive layer and the OpenAI watchdog
// tests/mythos-os-v4-executive-test.js
//
// FABLE runs as a REAL spawned process (the `claude` stand-in) through
// lib/claude-cli.js; OpenAI runs through the REAL orchestrator provider
// with only its socket replaced.
//
//   X  FABLE leads: its directive is used, OpenAI is not called
//   F  FABLE failure → OpenAI takes over the SAME call (timeout, CLI error,
//      quota, malformed, wrong identity, missing binary)
//   W  the watchdog: failures inside the window open a sticky TAKEOVER
//      (FABLE is not even called), the cooldown ends in a PROBE, a good
//      probe RECOVERS, a bad probe extends the cooldown (capped), old
//      failures age out of the window
//   N  no single point of failure: OpenAI down too → the deterministic last
//      resort (read-only), or HOLD for a goal approved to write
//   M  fail closed: a directive that is not exactly the schema is a failed
//      call for whichever engine produced it
//   R  the watchdog's plan review: the reviewer is never the author
//
// Offline and deterministic. Run with: node tests/mythos-os-v4-executive-test.js
// =====================================================

var fs = require('fs');
var path = require('path');

var h = require('./support/mythos-os-v4-harness');
var dirs = h.setup('exec');
var t = h.counter('mythos-os-v4 executive/watchdog tests');

var engines = require(path.join(h.V4, 'lib', 'engines'));
var watchdogLib = require(path.join(h.V4, 'lib', 'watchdog'));
var executiveLib = require(path.join(h.V4, 'lib', 'executive'));
var ledger = require(path.join(h.V4, 'lib', 'ledger'));

var FABLE = 'claude-fable-5-1';
var claude = h.fakeClaude(dirs);
var now = h.clock();
var openai = { reply: null, calls: [] };

function section(name) { console.log('\n# ' + name); }

var GOAL = { title: 'Explain the cache', objective: 'Explain how the cache works.', priority: 'normal', write_approved: false };
var PLAN = h.directive('execute', { steps: [h.step('s1', 'answer', 'analyze', 'Explain how the cache works.')] });
var OPENAI_PLAN = h.directive('execute', { rationale: 'openai plan', steps: [h.step('s1', 'answer', 'research', 'Research the cache.')] });

function openaiBody(obj) {
  return { status: 200, body: JSON.stringify({ status: 'completed', model: 'gpt-fixture-2026', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(obj) }] }] }) };
}

function build(policyOverrides, opts) {
  opts = opts || {};
  var policy = h.policy(Object.assign({ executive: { timeout_seconds: 2 } }, policyOverrides || {}));
  if (policyOverrides && policyOverrides.executive) policy.executive = Object.assign({}, h.policy().executive, { timeout_seconds: 2 }, policyOverrides.executive);
  var keyFile = path.join(dirs.root, 'openai.env');
  fs.writeFileSync(keyFile, 'OPENAI_API_KEY=fixture-openai-key\n', { mode: 0o600 });
  var set = {
    fable: engines.createFable({ bin: opts.noClaude ? path.join(dirs.bin, 'absent') : claude.bin, model: FABLE }),
    openai: engines.createOpenAI({
      config: { enabled: opts.openaiOff ? false : true, base_url: 'https://api.openai.invalid/v1', roles: { supervise_plan: { model: 'gpt-fixture', reasoning: 'low', max_output_tokens: 500 }, supervise_review: { model: 'gpt-fixture', reasoning: 'low', max_output_tokens: 500 } } },
      keyFile: keyFile,
      transport: function (spec) { openai.calls.push(spec); return Promise.resolve(openai.reply || openaiBody(OPENAI_PLAN)); }
    })
  };
  var watchdog = watchdogLib.create({ policy: policy, ledger: ledger, engines: set, now: now });
  watchdog.reset();
  var hostName = opts.host === undefined ? 'haddad' : opts.host;
  var host = hostName ? { name: hostName, profile: policy.haddad.hosts[hostName], source: 'explicit' } : { name: null, profile: null, reason: 'fixture: no profile' };
  var executive = executiveLib.create({ policy: policy, watchdog: watchdog, engines: set, ledger: ledger, now: now, host: host });
  return { policy: policy, watchdog: watchdog, executive: executive, engines: set };
}

function reset() {
  claude.script({ by_model: {}, default: { result: JSON.stringify(PLAN) } });
  claude.reset();
  openai.reply = null; openai.calls = [];
}
function state(extra) { return Object.assign({ cycle: 1, steps_executed: 0, history: [], refusals: [] }, extra || {}); }
function ctx() { return { goal_id: 'goal-fixture', trace_id: 'trace-fixture', deadline_at: now() + 600000 }; }
function fableCalls() { return claude.calls().filter(function (c) { return c.model === FABLE; }).length; }

var s;
Promise.resolve().then(function () {
  section('X — FABLE leads');
  reset(); s = build();
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (p) {
  t.ok(p.ok && p.engine === 'fable' && p.failover === false && p.directive.steps[0].id === 's1', 'FABLE plans; its directive is the one returned');
  t.ok(openai.calls.length === 0, 'OpenAI is not called while FABLE answers');
  var call = claude.calls()[0];
  var input = call.stdin;
  t.ok(call.model === FABLE && input.indexOf('"objective":"Explain how the cache works."') !== -1 && input.indexOf('"write_approved":false') !== -1, 'FABLE 5.1 receives the goal as data');
  var sys = call.argv[call.argv.indexOf('--system-prompt') + 1];
  t.ok(/DOTS, the general manager/.test(sys) && /untrusted data/.test(sys) && /Never plan a merge to main/.test(sys), 'the system prompt states the chain of authority and the limits');
  t.ok(sys.indexOf(s.policy.haddad.hosts.haddad.work_guidance) !== -1 && /local Qwen 7B worker/.test(sys) && sys.indexOf('A work step gets at least ' + s.policy.plan.min_work_timeout_seconds + ' seconds') !== -1,
    'the executive is told THIS host\'s unit of work (Haddad: the local Qwen worker) and the minimum time a work step gets');
  var rec = ledger.query({ type: 'EXECUTIVE_CALL' }).pop();
  t.ok(rec.actor === 'fable' && rec.detail.ok === true && rec.detail.model === FABLE && rec.detail.decision === 'execute', 'the call is on the ledger with the measured model');
  t.eq(s.watchdog.status().mode, 'fable', 'the watchdog reports FABLE leading');

  // The guidance follows the host profile.
  reset(); s = build(null, { host: 'vps' });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function () {
  var call = claude.calls()[0];
  var sys = call.argv[call.argv.indexOf('--system-prompt') + 1];
  t.ok(/Claude Code on the VPS executor/.test(sys) && !/Qwen 7B/.test(sys), 'on the VPS profile the executive is told about the Claude Code executor instead');
  reset(); s = build(null, { host: null });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function () {
  var call = claude.calls()[0];
  var sys = call.argv[call.argv.indexOf('--system-prompt') + 1];
  t.ok(/no executor profile: do not plan work steps/.test(sys), 'on a host with no profile the executive is told not to plan work steps');

  section('F — FABLE failure → OpenAI takeover of the same call');
  var failures = [
    [{ hang: true }, 'TIMEOUT', 'a FABLE timeout'],
    [{ error: 'boom: internal failure' }, 'CLI_ERROR', 'a FABLE CLI error'],
    [{ error: "You've hit your usage limit · resets 9:20pm (UTC)" }, 'QUOTA', 'FABLE out of quota'],
    [{ result: 'Here is my plan: do it.' }, 'MALFORMED', 'FABLE answering prose'],
    [{ result: JSON.stringify(PLAN), served_by: ['claude-sonnet-5'] }, 'IDENTITY_MISMATCH', 'another model answering as FABLE'],
    [{ result: JSON.stringify({ decision: 'execute', steps: [] }) }, 'MALFORMED', 'a FABLE directive missing required fields']
  ];
  return failures.reduce(function (p, f) {
    return p.then(function () {
      reset(); s = build();
      claude.script({ default: f[0] });
      return s.executive.plan(GOAL, state(), ctx()).then(function (out) {
        var fa = out.attempts.filter(function (a) { return a.engine === 'fable'; })[0];
        t.ok(out.ok && out.engine === 'openai' && out.failover === true && out.directive.rationale === 'openai plan' && fa && fa.code === f[1],
          f[2] + ' (' + f[1] + ') → OpenAI takes over the same call');
      });
    });
  }, Promise.resolve());
}).then(function () {
  var rec = ledger.query({ type: 'EXECUTIVE_FAILOVER' }).pop();
  t.ok(rec.actor === 'watchdog' && rec.detail.acting === 'openai' && rec.detail.attempts.length === 2, 'the takeover is on the ledger, with both attempts');
  var sent = openai.calls[0];
  t.ok(sent.body.model === 'gpt-fixture' && sent.body.text.format.strict === true && JSON.parse(sent.body.input).goal.objective === GOAL.objective, 'OpenAI receives the same goal under the same strict directive schema');

  reset(); s = build(null, { noClaude: true });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (out) {
  t.ok(out.ok && out.engine === 'openai' && out.attempts[0].code === 'UNAVAILABLE' && ledger.query({ type: 'EXECUTIVE_UNAVAILABLE' }).length >= 1, 'FABLE not installed on the host → OpenAI plans, and the unavailability is recorded');

  section('W — watchdog: sticky takeover, cooldown, probe, recovery');
  reset(); s = build({ failover: { failure_threshold: 2, window_seconds: 900, cooldown_seconds: 300, cooldown_max_seconds: 1000, cooldown_factor: 2 } });
  claude.script({ default: { error: 'boom' } });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function () {
  t.ok(s.watchdog.status().mode === 'fable' && s.watchdog.status().failures_in_window === 1, 'one failure: FABLE still leads (below the threshold)');
  return s.executive.plan(GOAL, state(), ctx());
}).then(function () {
  var st = s.watchdog.status();
  t.ok(st.mode === 'openai' && st.leading === 'openai' && st.takeovers === 1 && st.cooldown_until !== null, 'second failure inside the window: OPENAI_TAKEOVER, OpenAI leads');
  t.ok(ledger.query({ type: 'OPENAI_TAKEOVER' }).length >= 1, 'the takeover is on the ledger');
  var before = fableCalls();
  return s.executive.plan(GOAL, state(), ctx()).then(function (out) {
    t.ok(out.ok && out.engine === 'openai' && fableCalls() === before, 'during the cooldown FABLE is NOT called at all — OpenAI answers directly');
    t.eq(out.attempts.map(function (a) { return a.engine; }), ['openai'], 'the only attempt of that call is OpenAI');

    // OpenAI fails during the takeover: FABLE is still the last chance.
    openai.reply = { status: 503, body: '{}' };
    claude.script({ default: { result: JSON.stringify(PLAN) } });
    return s.executive.plan(GOAL, state(), ctx());
  }).then(function (out) {
    t.ok(out.ok && out.engine === 'fable' && out.attempts[0].engine === 'openai' && out.attempts[0].code === 'TRANSIENT', 'takeover + OpenAI failing: FABLE is tried as the last chance (OpenAI is not a single point of failure either)');
    t.ok(s.watchdog.status().mode === 'fable', 'and FABLE answering ends the takeover');
  });
}).then(function () {
  // Probe after cooldown: failure extends, success recovers.
  reset(); s = build({ failover: { failure_threshold: 2, window_seconds: 900, cooldown_seconds: 300, cooldown_max_seconds: 1000, cooldown_factor: 2 } });
  claude.script({ default: { error: 'boom' } });
  return s.executive.plan(GOAL, state(), ctx()).then(function () { return s.executive.plan(GOAL, state(), ctx()); });
}).then(function () {
  t.ok(s.watchdog.status().mode === 'openai' && s.watchdog.status().probe_due === false, 'takeover active, probe not yet due');
  now.advance(301);
  t.ok(s.watchdog.status().probe_due === true && s.watchdog.executiveOrder().order[0] === 'fable', 'after the cooldown the next call probes FABLE first');
  var before = fableCalls();
  return s.executive.plan(GOAL, state(), ctx()).then(function (out) {
    var st = s.watchdog.status();
    t.ok(fableCalls() === before + 1 && out.ok && out.engine === 'openai' && st.mode === 'openai', 'a failed probe: FABLE was called once, OpenAI still serves, the takeover continues');
    var ext = ledger.query({ type: 'TAKEOVER_EXTENDED' }).pop();
    t.ok(ext && ext.detail.cooldown_seconds === 600, 'the failed probe doubles the cooldown (300 → 600)');
    now.advance(601);
    return s.executive.plan(GOAL, state(), ctx());
  }).then(function () {
    var ext = ledger.query({ type: 'TAKEOVER_EXTENDED' }).pop();
    t.ok(ext.detail.cooldown_seconds === 1000, 'the cooldown is capped at cooldown_max_seconds (1000, not 1200)');
    now.advance(1001);
    claude.script({ default: { result: JSON.stringify(PLAN) } });
    var calls = openai.calls.length;
    return s.executive.plan(GOAL, state(), ctx()).then(function (out) {
      var st = s.watchdog.status();
      t.ok(out.ok && out.engine === 'fable' && out.probe === true && out.failover === false && openai.calls.length === calls, 'RECOVERY: the probe succeeds — FABLE plans again and OpenAI is not called');
      t.ok(st.mode === 'fable' && st.failures_in_window === 0 && st.cooldown_until === null && st.takeover_at === null, 'the watchdog state is back to FABLE leading, failures cleared');
      t.ok(ledger.query({ type: 'FABLE_RECOVERED' }).length >= 2, 'the recovery is on the ledger');
    });
  });
}).then(function () {
  // Failures age out of the window.
  reset(); s = build({ failover: { failure_threshold: 2, window_seconds: 60, cooldown_seconds: 300, cooldown_max_seconds: 1000, cooldown_factor: 2 } });
  claude.script({ default: { error: 'boom' } });
  return s.executive.plan(GOAL, state(), ctx()).then(function () {
    now.advance(120);
    return s.executive.plan(GOAL, state(), ctx());
  }).then(function () {
    t.ok(s.watchdog.status().mode === 'fable' && s.watchdog.status().failures_in_window === 1, 'two failures further apart than the window do NOT trigger a takeover');
  });
}).then(function () {
  // A refused directive counts as an executive failure.
  reset(); s = build({ failover: { failure_threshold: 2, window_seconds: 900, cooldown_seconds: 300, cooldown_max_seconds: 1000, cooldown_factor: 2 } });
  s.executive.reportRefusal('fable', 'REFUSED_BY_DOTS', ctx());
  s.executive.reportRefusal('fable', 'REFUSED_BY_DOTS', ctx());
  t.ok(s.watchdog.status().mode === 'openai', 'two directives refused by DOTS count as FABLE failures and trigger the takeover');
  t.ok(s.executive.reportRefusal('direct', 'X', ctx()) === null, 'the deterministic last resort has no health to record');

  // State file corrupted → safe default.
  fs.writeFileSync(watchdogLib.stateFile(), '{not json');
  t.ok(s.watchdog.status().mode === 'fable', 'an unreadable watchdog state reads as "FABLE leads" (the authority of record)');

  section('N — no single point of failure');
  reset(); s = build();
  claude.script({ default: { error: 'boom' } });
  openai.reply = { status: 503, body: '{}' };
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (out) {
  t.ok(out.ok && out.engine === 'direct' && out.directive.decision === 'execute' && out.directive.steps.length === 1, 'FABLE and OpenAI both down: DOTS\'s deterministic last resort plans ONE step');
  var st = out.directive.steps[0];
  t.ok(st.kind === 'answer' && s.policy.plan.answer_actions.indexOf(st.action) !== -1 && st.instruction.indexOf(GOAL.objective) !== -1, 'that step is a read-only answer carrying the objective');
  t.eq(out.attempts.map(function (a) { return a.engine + ':' + a.code; }), ['fable:CLI_ERROR', 'openai:TRANSIENT'], 'both failed engines are in the attempt trail');
  t.ok(ledger.query({ type: 'EXECUTIVE_DIRECT' }).length >= 1, 'direct mode is on the ledger as such');
  return s.executive.plan(GOAL, state({ cycle: 2, history: [{ cycle: 1, step_id: 'd1', ok: true, output: 'the cache works like this' }] }), ctx());
}).then(function (out) {
  t.ok(out.engine === 'direct' && out.directive.decision === 'complete' && out.directive.final_answer === 'the cache works like this', 'direct mode, second cycle: the successful result becomes the answer');
  return s.executive.plan(GOAL, state({ cycle: 2, history: [{ cycle: 1, step_id: 'd1', ok: false, reason: 'ALL_MODELS_FAILED' }] }), ctx());
}).then(function (out) {
  t.ok(out.engine === 'direct' && out.directive.decision === 'escalate', 'direct mode with a failed step escalates instead of retrying forever');
  return s.executive.plan(Object.assign({}, GOAL, { write_approved: true }), state(), ctx());
}).then(function (out) {
  t.ok(!out.ok && out.reason === 'NO_EXECUTIVE', 'a goal approved to WRITE is never planned by the last resort: no executive → NO_EXECUTIVE');
  reset(); s = build({ authority: { general_manager: 'dots', executive_primary: 'fable', executive_failover: 'openai', executive_last_resort: 'none' } });
  claude.script({ default: { error: 'boom' } });
  openai.reply = { status: 503, body: '{}' };
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (out) {
  t.ok(!out.ok && out.reason === 'NO_EXECUTIVE' && out.attempts.length === 2, 'last resort switched off by policy: NO_EXECUTIVE, with the attempts');

  reset(); s = build(null, { openaiOff: true });
  claude.script({ default: { error: 'boom' } });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (out) {
  t.ok(out.ok && out.engine === 'direct' && openai.calls.length === 0, 'OpenAI switched off in its config: it is never called, the last resort serves');

  reset(); s = build();
  claude.script({ default: { hang: true } });
  return s.executive.plan(GOAL, state(), { goal_id: 'g', trace_id: 't', deadline_at: now() + 500 });
}).then(function (out) {
  t.ok(!out.ok && out.reason === 'DEADLINE' && claude.calls().length === 0, 'a goal already at its deadline is not sent to any engine');

  section('M — fail closed on the directive');
  var bad = [
    [Object.assign({}, PLAN, { priority: 'critical' }), 'an extra top-level field (trying to raise priority)'],
    [Object.assign({}, PLAN, { decision: 'approve' }), 'a decision outside the enum'],
    [h.directive('execute', { steps: [Object.assign(h.step('s1', 'answer', 'analyze'), { model: 'gpt-x' })] }), 'a step naming its own model (that is JEV\'s decision)'],
    [h.directive('execute', { steps: [h.step('s1', 'shell', 'analyze')] }), 'a step kind outside the enum'],
    [h.directive('execute', { steps: [h.step('s1', 'work', 'deploy')] }), 'an action outside the enum'],
    [h.directive('execute', { steps: [Object.assign(h.step('s1', 'answer', 'analyze'), { timeout_seconds: '60' })] }), 'a mistyped timeout']
  ];
  return bad.reduce(function (p, b) {
    return p.then(function () {
      reset(); s = build();
      openai.reply = openaiBody(b[0]);
      claude.script({ default: { result: JSON.stringify(b[0]) } });
      return s.executive.plan(GOAL, state(), ctx()).then(function (out) {
        t.ok(out.engine === 'direct' && out.attempts.length === 2 && out.attempts.every(function (a) { return a.code === 'MALFORMED'; }),
          b[1] + ' is MALFORMED for FABLE and for OpenAI alike');
      });
    });
  }, Promise.resolve());
}).then(function () {
  reset(); s = build({ executive: { attempts_per_engine: 2 } });
  claude.script({ by_model: (function () { var m = {}; m[FABLE] = [{ result: 'prose' }, { result: JSON.stringify(PLAN) }]; return m; })() });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (out) {
  t.ok(out.ok && out.engine === 'fable' && out.attempts.length === 2 && out.attempts[0].code === 'MALFORMED' && out.attempts[1].ok, 'attempts_per_engine 2: one malformed answer is retried on FABLE before any failover');
  reset(); s = build({ executive: { attempts_per_engine: 3 } });
  claude.script({ default: { error: "You've hit your usage limit" } });
  return s.executive.plan(GOAL, state(), ctx());
}).then(function (out) {
  t.ok(out.attempts.filter(function (a) { return a.engine === 'fable'; }).length === 1, 'a quota failure is never retried on the same engine, whatever attempts_per_engine says');

  section('R — plan review by the other engine');
  reset(); s = build();
  var writePlan = h.directive('execute', { steps: [h.step('s1', 'work', 'implement', 'Add a README section.')] });
  openai.reply = openaiBody({ verdict: 'approve', reasons: ['serves the goal'] });
  return s.watchdog.review(GOAL, writePlan, ctx(), 'fable').then(function (v) {
    t.ok(v.ok && v.verdict === 'approve' && v.reviewer === 'openai', 'a FABLE plan is reviewed by OpenAI');
    var sent = openai.calls.pop();
    t.ok(sent.body.text.format.schema.properties.verdict.enum.join() === 'approve,reject' && JSON.parse(sent.body.input).plan.steps[0].action === 'implement', 'the review request carries the plan under the strict review schema');
    openai.reply = openaiBody({ verdict: 'reject', reasons: ['exceeds the goal'] });
    return s.watchdog.review(GOAL, writePlan, ctx(), 'fable');
  }).then(function (v) {
    t.ok(v.ok && v.verdict === 'reject' && v.reasons[0] === 'exceeds the goal', 'a rejection comes back with its reasons');
    openai.reply = openaiBody({ verdict: 'maybe', reasons: [] });
    return s.watchdog.review(GOAL, writePlan, ctx(), 'fable');
  }).then(function (v) {
    t.ok(!v.ok && v.code === 'REVIEW_MALFORMED', 'a verdict outside the schema is NO verdict (fail closed)');
    openai.reply = { status: 503, body: '{}' };
    return s.watchdog.review(GOAL, writePlan, ctx(), 'fable');
  }).then(function (v) {
    t.ok(!v.ok && v.code === 'REVIEW_FAILED', 'a failed review call is reported as failed, never as an approval');
    claude.script({ default: { result: JSON.stringify({ verdict: 'approve', reasons: [] }) } });
    openai.calls = [];
    return s.watchdog.review(GOAL, writePlan, ctx(), 'openai');
  }).then(function (v) {
    t.ok(v.ok && v.reviewer === 'fable' && openai.calls.length === 0 && fableCalls() === 1, 'an OpenAI plan is reviewed by FABLE — nobody reviews their own plan');
    return s.watchdog.review(GOAL, writePlan, ctx(), 'direct');
  }).then(function (v) {
    t.ok(!v.ok && v.code === 'REVIEW_UNAVAILABLE', 'a plan from the deterministic last resort has no reviewer');
    t.ok(ledger.query({ type: 'PLAN_REVIEW' }).length >= 6, 'every review outcome is on the ledger');
  });
}).then(function () {
  t.ok(ledger.verify().ok, 'the ledger chain is intact after every scenario');
  t.ok(fs.readFileSync(ledger.ledgerFile(), 'utf8').indexOf('fixture-openai-key') === -1, 'the OpenAI key never reached the ledger');
  t.finish(dirs);
}, t.crash(dirs));
