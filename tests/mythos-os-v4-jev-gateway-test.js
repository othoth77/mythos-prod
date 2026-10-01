'use strict';
// =====================================================
// MYTHOS OS v4 — JEV (model selection) and the gateway (fallback)
// tests/mythos-os-v4-jev-gateway-test.js
//
// The REAL adapters run against real loopback HTTP servers and a real
// spawned `claude` stand-in — the free pool through free-llm/selector.js,
// Qwen through haddad-runtime.js, paid Claude through lib/claude-cli.js,
// paid OpenAI through the orchestrator provider (its socket replaced).
//
//   J  JEV: free → local → paid; hard pool restriction; capability, size
//      and authority filters; every rejection has a reason; a decision
//      layer only (it exposes nothing that executes)
//   F  Free → Qwen → Paid fallback, tier by tier, with the cause recorded
//   H  provider failure handling: quota is a wait, not a failure; repeated
//      failures open a cooldown; the cooldown ends in a probe; success
//      recovers; an invalid key cools down long
//   T  timeout · retry · deadline · attempt cap: every wait is bounded
//   M  malformed output fails closed (empty, oversized, validator-refused)
//   B  the paid tier obeys DOTS: off switch, per-goal and per-day budgets
//   S  no single point of failure: JEV's own registry unreadable → the
//      gateway still answers through the policy's static fallback
//
// Offline (loopback only) and deterministic.
// Run with: node tests/mythos-os-v4-jev-gateway-test.js
// =====================================================

var fs = require('fs');
var path = require('path');

var h = require('./support/mythos-os-v4-harness');
var dirs = h.setup('jev');
var t = h.counter('mythos-os-v4 jev/gateway tests');

var adaptersLib = require(path.join(h.V4, 'lib', 'adapters'));
var jevLib = require(path.join(h.V4, 'lib', 'jev'));
var gatewayLib = require(path.join(h.V4, 'lib', 'gateway'));
var ledger = require(path.join(h.V4, 'lib', 'ledger'));
var engines = require(path.join(h.V4, 'lib', 'engines'));
var index = require(path.join(h.V4, 'lib', 'index'));

var SONNET = adaptersLib.claudeModelId({ claude_policy_key: 'sonnet' });
var claude = h.fakeClaude(dirs);
var now = h.clock();

function section(name) { console.log('\n# ' + name); }

// One free provider server per id, a Qwen server, an OpenAI transport.
var freeCtl = { alpha: { mode: 'ok' }, beta: { mode: 'ok' } };
function freeBehaviour(id) {
  return function (req) {
    var c = freeCtl[id];
    if (req.url !== '/v1/chat/completions') return null;
    if (c.mode === 'ok') return h.chatAnswer(c.text === undefined ? 'free ' + id + ' answer' : c.text, id + '/chat-fixture');
    if (c.mode === 'quota') return { status: 429, json: { error: { message: 'Rate limit reached for requests' } } };
    if (c.mode === 'down') return { status: 503, json: { error: { message: 'Service Unavailable' } } };
    if (c.mode === 'badkey') return { status: 401, json: { error: { message: 'Invalid API Key' } } };
    if (c.mode === 'empty') return { status: 200, json: { model: 'x', choices: [] } };
    if (c.mode === 'hang') return { hang: true };
    return null;
  };
}
var qwenCtl = {};
var openaiCtl = { reply: null, calls: 0 };

var servers = {};
var sys = {};

function build(policyOverrides, opts) {
  opts = opts || {};
  var free = h.freeLlmFixture(dirs, [{ id: 'alpha', url: servers.alpha.url }, { id: 'beta', url: servers.beta.url }]);
  var keyFile = path.join(dirs.root, 'openai.env');
  fs.writeFileSync(keyFile, 'OPENAI_API_KEY=fixture-openai-key\n', { mode: 0o600 });
  var openaiEngine = engines.createOpenAI({
    config: { enabled: true, base_url: 'https://api.openai.invalid/v1', roles: { plan: { model: 'gpt-fixture', reasoning: 'low', max_output_tokens: 500 } } },
    keyFile: opts.noOpenAIKey ? path.join(dirs.root, 'absent.env') : keyFile,
    transport: function () {
      openaiCtl.calls++;
      if (openaiCtl.reply) return Promise.resolve(openaiCtl.reply);
      return Promise.resolve({ status: 200, body: JSON.stringify({ status: 'completed', model: 'gpt-fixture-2026', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ answer: 'openai answer' }) }] }] }) });
    }
  });
  var adapters = {
    'free-llm-pool': adaptersLib.freeLlmPool(free),
    'haddad-qwen': adaptersLib.haddadQwen({ baseUrl: servers.qwen.url + '/v1', apiKey: 'fixture-runtime-key', probeTimeoutMs: 800 }),
    'claude-cli': adaptersLib.claudeCliAdapter({ bin: claude.bin }),
    'openai-responses': adaptersLib.openaiResponses({ engine: openaiEngine })
  };
  var policy = h.policy(Object.assign({ gateway: { attempt_timeout_seconds: 2, retry_base_ms: 20, retry_max_ms: 40 }, jev: { availability_ttl_seconds: 1 } }, policyOverrides || {}));
  if (policyOverrides && policyOverrides.gateway) policy.gateway = Object.assign({}, h.policy().gateway, { attempt_timeout_seconds: 2, retry_base_ms: 20, retry_max_ms: 40 }, policyOverrides.gateway);
  if (policyOverrides && policyOverrides.jev) policy.jev = Object.assign({}, h.policy().jev, { availability_ttl_seconds: 1 }, policyOverrides.jev);
  var jev = jevLib.create({ policy: policy, adapters: adapters, ledger: ledger, now: now, registry: opts.registry });
  jev.resetHealth();
  try { fs.unlinkSync(path.join(dirs.osHome, 'jev', 'spend.json')); } catch (e) { /* none */ }
  try { fs.unlinkSync(free.healthPath); } catch (e) { /* none */ }
  var gateway = gatewayLib.create({ policy: policy, jev: jev, adapters: adapters, ledger: ledger, now: now });
  return { policy: policy, jev: jev, gateway: gateway, adapters: adapters };
}

function reset() {
  freeCtl.alpha = { mode: 'ok' }; freeCtl.beta = { mode: 'ok' };
  Object.keys(qwenCtl).forEach(function (k) { delete qwenCtl[k]; });
  openaiCtl.reply = null; openaiCtl.calls = 0;
  claude.script({ by_model: {}, default: { result: 'claude answer' } });
  claude.reset();
}

function ask(s, extra) {
  return s.gateway.complete(Object.assign({ pool: 'execution', capability: 'analysis', prompt: 'What is 2+2?', timeout_seconds: 30, goal_id: 'goal-fixture', trace_id: 'trace-fixture', step_id: 's1' }, extra || {}));
}
function tiers(r) { return r.attempts.map(function (a) { return a.tier + ':' + (a.ok ? 'ok' : a.code); }); }

Promise.all([h.startServer(freeBehaviour('alpha')), h.startServer(freeBehaviour('beta')), h.startServer(h.qwenBehaviour(qwenCtl))]).then(function (list) {
  servers.alpha = list[0]; servers.beta = list[1]; servers.qwen = list[2];
  reset();

  section('J — JEV decisions');
  sys = build();
  return sys.jev.refresh();
}).then(function () {
  var d = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 100 });
  t.eq(d.candidates.map(function (c) { return c.model + ':' + c.tier; }), ['free-llm-pool:free', 'qwen-local:local', 'claude-sonnet:paid', 'openai-advisor:paid'],
    'order is free → local (Qwen) → paid');
  t.ok(d.ok && d.confidence === 'high' && /^jev-/.test(d.decision_id), 'a decision carries an id and its confidence');
  t.ok(ledger.query({ type: 'ROUTE_DECISION' }).some(function (r) { return r.detail.decision_id === d.decision_id; }), 'every decision is written to the ledger');

  t.ok(Object.keys(sys.jev).every(function (k) { return ['route', 'report', 'refresh', 'status', 'model', 'chargePaid', 'paidGate', 'resetHealth', 'registry'].indexOf(k) !== -1; }),
    'JEV exposes decisions and bookkeeping only — nothing that calls a model or runs a command');

  var bad = sys.jev.route({ pool: 'secret-pool', capability: 'analysis', kind: 'answer', prompt_chars: 1 });
  t.ok(!bad.ok && bad.reason === 'BAD_REQUEST' && bad.candidates.length === 0, 'a pool that is not configured gets no route at all');
  var noKind = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'shell', prompt_chars: 1 });
  t.ok(!noKind.ok && noKind.reason === 'BAD_REQUEST', 'an unknown kind of task is refused');

  var coding = sys.jev.route({ pool: 'execution', capability: 'coding', kind: 'answer', prompt_chars: 100 });
  t.ok(coding.candidates.map(function (c) { return c.model; }).indexOf('free-llm-pool') === -1 &&
    coding.rejected.some(function (r) { return r.model === 'free-llm-pool' && r.reason === 'CAPABILITY_MISSING'; }), 'a model without the capability is rejected, with the reason');

  var big = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 20000 });
  t.ok(big.rejected.some(function (r) { return r.model === 'qwen-local' && r.reason === 'PROMPT_TOO_LARGE'; }) && big.candidates[0].model === 'free-llm-pool',
    'a prompt Qwen cannot hold skips Qwen, not the task');

  var work = sys.jev.route({ pool: 'execution', capability: 'repo_work', kind: 'work', prompt_chars: 100 });
  t.eq(work.candidates.map(function (c) { return c.model + ' via ' + c.work_provider; }), ['qwen-local via haddad-agent'], 'repository work routes only to a model with execution authority');
  t.ok(work.rejected.every(function (r) { return r.model !== 'qwen-local'; }) && work.confidence === 'low', 'a single-candidate route says its confidence is low');

  // Pool restriction with a custom registry.
  var reg = h.registry();
  reg.models['claude-sonnet'].pools = ['assessment'];
  reg.models['openai-advisor'].enabled = false;
  var s2 = build(null, { registry: reg });
  var research = s2.jev.route({ pool: 'research', capability: 'research', kind: 'answer', prompt_chars: 10 });
  t.ok(research.rejected.some(function (r) { return r.model === 'claude-sonnet' && r.reason === 'NOT_IN_POOL'; }) &&
    research.rejected.some(function (r) { return r.model === 'openai-advisor' && r.reason === 'DISABLED'; }), 'a model outside the requested pool, or disabled, is never a candidate');

  // A model that CLAIMS the repo_work capability but holds no execution
  // authority is still never offered repository work.
  var regCap = h.registry();
  regCap.models['claude-sonnet'].capabilities.push('repo_work');
  regCap.models['free-llm-pool'].capabilities.push('repo_work');
  var s3 = build(null, { registry: regCap });
  var w3 = s3.jev.route({ pool: 'execution', capability: 'repo_work', kind: 'work', prompt_chars: 10 });
  t.ok(w3.candidates.length === 1 && w3.candidates[0].model === 'qwen-local' &&
    w3.rejected.filter(function (r) { return r.reason === 'NO_EXECUTION_AUTHORITY'; }).map(function (r) { return r.model; }).sort().join() === 'claude-sonnet,free-llm-pool',
  'advertising a capability does not confer authority: only a registered execution-authority model gets repository work');

  var regBad = h.registry();
  regBad.models['qwen-local'].tier = 'premium';
  var threw = '';
  try { jevLib.create({ policy: h.policy(), adapters: {}, ledger: ledger, registry: regBad }); } catch (e) { threw = e.message; }
  t.ok(/^JEV_REGISTRY_INVALID/.test(threw), 'an invalid registry stops JEV (it never guesses a tier)');
  var regAuth = h.registry();
  regAuth.models['free-llm-pool'].work_provider = 'haddad-agent';
  threw = '';
  try { jevLib.loadRegistry({ registry: regAuth }); } catch (e2) { threw = e2.message; }
  t.ok(/work_provider requires execution_authority/.test(threw), 'a registry cannot give an advisory model a work provider');

  section('F — Free → Qwen → Paid');
  reset(); sys = build();
  return ask(sys);
}).then(function (r) {
  t.ok(r.ok && r.tier === 'free' && r.model === 'free-llm-pool' && r.fallback_used === false && /^(alpha|beta)\//.test(r.served_by), 'healthy system: a FREE provider serves, no fallback');
  t.ok(servers.alpha.calls.concat(servers.beta.calls).some(function (c) { return c.auth === 'Bearer fixture-alpha' || c.auth === 'Bearer fixture-beta'; }), 'the free call really went over HTTP with that provider\'s own key');
  t.ok(servers.qwen.calls.filter(function (c) { return c.url === '/v1/chat/completions'; }).length === 0 && claude.calls().length === 0, 'neither Qwen nor a paid model was called');

  reset(); sys = build();
  freeCtl.alpha.mode = 'down';
  return ask(sys);
}).then(function (r) {
  t.ok(r.ok && r.tier === 'free' && /^beta\//.test(r.served_by), 'one free provider down: the OTHER free provider serves (still free tier)');

  reset(); sys = build();
  freeCtl.alpha.mode = 'quota'; freeCtl.beta.mode = 'quota';
  return ask(sys);
}).then(function (r) {
  t.ok(r.ok && r.tier === 'local' && r.model === 'qwen-local' && r.fallback_used === true && r.text === 'qwen says hello', 'every free provider out of quota: QWEN serves (free → local)');
  t.ok(r.attempts.length === 2 && tiers(r)[0].indexOf('free:') === 0 && r.attempts[0].ok === false && tiers(r)[1] === 'local:ok', 'the attempt trail shows free failing first, then local answering');
  t.ok(r.attempts[0].tier === 'free' && r.attempts[0].category === 'quota', 'the free failure is classified as quota, not as a generic error');
  t.ok(claude.calls().length === 0, 'no paid model was called while Qwen could answer');
  var st = sys.jev.status();
  t.ok(st.models['free-llm-pool'].quota_until !== null && st.models['free-llm-pool'].state === 'closed', 'quota sets a wait on the free pool and does NOT count as a failure');
  var d = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 10 });
  t.ok(d.rejected.some(function (x) { return x.model === 'free-llm-pool' && /^QUOTA_UNTIL/.test(x.reason); }) && d.candidates[0].model === 'qwen-local', 'while the quota wait lasts, JEV routes straight to Qwen');
  t.ok(ledger.query({ type: 'MODEL_QUOTA_WAIT' }).length >= 1, 'the quota wait is on the ledger');

  reset(); sys = build();
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 500; qwenCtl.message = 'Internal Server Error';
  return ask(sys);
}).then(function (r) {
  t.ok(r.ok && r.tier === 'paid' && r.model === 'claude-sonnet' && r.served_by === SONNET && r.text === 'claude answer', 'free and Qwen both failing: PAID Claude serves (free → local → paid)');
  var seq = r.attempts.map(function (a) { return a.tier; }).filter(function (x, i, a) { return a.indexOf(x) === i; });
  t.eq(seq, ['free', 'local', 'paid'], 'the tiers were tried in order: free, local, paid');
  var call = claude.calls()[0];
  t.ok(call.model === SONNET && call.argv[call.argv.indexOf('--tools') + 1] === '', 'the paid Claude call names the catalog model and has no tools');
  t.ok(sys.jev.status().spend.calls === 1 && sys.jev.status().spend.by_goal['goal-fixture'] === 1, 'the paid call was charged to the goal and the day');

  reset(); sys = build();
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 500;
  claude.script({ default: { error: 'API Error: 529 overloaded' } });
  return ask(sys);
}).then(function (r) {
  t.ok(r.ok && r.model === 'openai-advisor' && r.text === 'openai answer' && r.tier === 'paid', 'paid Claude failing too: the second paid provider (OpenAI) serves');

  reset(); sys = build();
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 500;
  claude.script({ default: { error: 'API Error: 529 overloaded' } });
  openaiCtl.reply = { status: 503, body: '{}' };
  return ask(sys);
}).then(function (r) {
  t.ok(!r.ok && r.reason === 'ALL_MODELS_FAILED' && r.text === null, 'everything down: the task FAILS with ALL_MODELS_FAILED — no invented answer');
  t.ok(r.attempts.length <= sys.policy.gateway.max_attempts_total, 'the total number of attempts stayed under the cap (' + r.attempts.length + ')');
  var last = ledger.query({ type: 'ANSWER_RESULT' }).pop();
  t.ok(last.detail.ok === false && last.detail.attempts.length === r.attempts.length, 'the failed answer and every attempt are on the ledger');

  section('H — failure handling, cooldown, recovery');
  reset(); sys = build({ jev: { failure_threshold: 2, cooldown_seconds: 60, cooldown_factor: 2, cooldown_max_seconds: 600 }, gateway: { max_retries_per_model: 0 } });
  freeCtl.alpha.mode = 'quota'; freeCtl.beta.mode = 'quota';
  qwenCtl.status = 500; qwenCtl.message = 'Internal Server Error';
  return ask(sys).then(function () { now.advance(2); return ask(sys); });
}).then(function (r) {
  var q = sys.jev.status().models['qwen-local'];
  t.ok(q.state === 'open' && q.consecutive_failures === 2 && q.cooldown_seconds === 60, 'two Qwen failures open its circuit with the configured cooldown');
  t.ok(ledger.query({ type: 'MODEL_COOLDOWN' }).some(function (x) { return x.detail.model === 'qwen-local'; }), 'the cooldown is on the ledger');
  var before = servers.qwen.calls.filter(function (c) { return c.url === '/v1/chat/completions'; }).length;
  return ask(sys).then(function (r2) {
    var after = servers.qwen.calls.filter(function (c) { return c.url === '/v1/chat/completions'; }).length;
    t.ok(after === before && r2.ok && r2.tier === 'paid', 'during the cooldown Qwen is not called at all; paid serves');
    var d = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 10 });
    t.ok(d.rejected.some(function (x) { return x.model === 'qwen-local' && /^COOLDOWN_UNTIL/.test(x.reason); }), 'the rejection names the cooldown');

    var cooling = sys.jev.status().models['qwen-local'];
    t.ok(cooling.effective_state === 'open' && cooling.selectable === false, 'status: a cooling model is reported open and not selectable');

    // Cooldown over, Qwen still broken: the probe fails and the cooldown doubles.
    now.advance(61);
    var halfOpen = sys.jev.status().models['qwen-local'];
    t.ok(halfOpen.state === 'open' && halfOpen.effective_state === 'half_open' && halfOpen.selectable === true, 'status: once the cooldown has passed the same model is half-open and selectable again (what route() would do)');
    return ask(sys);
  }).then(function () {
    var q2 = sys.jev.status().models['qwen-local'];
    t.ok(q2.state === 'open' && q2.cooldown_seconds === 120, 'a failed probe re-opens the circuit with the cooldown doubled');
    // Cooldown over again, Qwen repaired: the probe succeeds and it recovers.
    now.advance(121);
    delete qwenCtl.status; delete qwenCtl.message;
    return sys.jev.refresh().then(function () {
      var d2 = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 10 });
      var cand = d2.candidates.filter(function (c) { return c.model === 'qwen-local'; })[0];
      t.ok(cand && cand.probing === true && cand.health === 'half_open', 'after the cooldown Qwen is offered again as a half-open probe');
      return ask(sys);
    });
  }).then(function (r3) {
    var q3 = sys.jev.status().models['qwen-local'];
    t.ok(r3.ok && r3.model === 'qwen-local' && q3.state === 'closed' && q3.consecutive_failures === 0 && q3.cooldown_until === null, 'RECOVERY: the probe succeeds, Qwen serves and its circuit closes');
    t.ok(ledger.query({ type: 'MODEL_RECOVERED' }).some(function (x) { return x.detail.model === 'qwen-local'; }), 'the recovery is on the ledger');
    // The free quota wait has also expired by now (default 900 s > elapsed?): prove recovery of the free tier explicitly.
    now.advance(900);
    freeCtl.alpha.mode = 'ok'; freeCtl.beta.mode = 'ok';
    return ask(sys);
  }).then(function (r4) {
    t.ok(r4.ok && r4.tier === 'free' && sys.jev.status().models['free-llm-pool'].quota_until === null, 'RECOVERY: once the quota wait passes, the FREE tier serves again and the wait is cleared');
  });
}).then(function () {
  // An invalid key is not retried soon.
  reset(); sys = build({ gateway: { max_retries_per_model: 1 } });
  freeCtl.alpha.mode = 'badkey'; freeCtl.beta.mode = 'badkey';
  return ask(sys);
}).then(function (r) {
  var f = sys.jev.status().models['free-llm-pool'];
  t.ok(r.ok && r.tier === 'local' && r.attempts[0].category === 'blocked' && r.attempts.filter(function (a) { return a.tier === 'free'; }).length === 1,
    'rejected credentials are BLOCKED: not retried, straight to the next tier');
  t.ok(f.state === 'open' && f.cooldown_seconds === sys.policy.jev.blocked_cooldown_seconds, 'a blocked provider cools down for the long (blocked) period at once');

  // Qwen runtime genuinely down (connection refused) — found by the probe, before any task is sent.
  reset();
  return servers.qwen.close().then(function () {
    sys = build();
    freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down';
    return ask(sys);
  });
}).then(function (r) {
  t.ok(r.ok && r.tier === 'paid' && r.attempts.every(function (a) { return a.tier !== 'local'; }), 'Qwen runtime unreachable: the live probe removes it from the route, paid serves');
  var d = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 10 });
  t.ok(d.rejected.some(function (x) { return x.model === 'qwen-local' && /^UNAVAILABLE: runtime unreachable/.test(x.reason); }), 'the rejection says the runtime is unreachable');
  var w = sys.jev.route({ pool: 'execution', capability: 'repo_work', kind: 'work', prompt_chars: 10 });
  t.ok(!w.ok && w.reason === 'NO_ROUTE' && w.confidence === 'none', 'with Qwen down there is NO route for repository work — it is never handed to a model without authority');
  return h.startServer(h.qwenBehaviour(qwenCtl)).then(function (s) { servers.qwen = s; });
}).then(function () {
  section('T — timeout, retry, deadline');
  reset(); sys = build({ gateway: { attempt_timeout_seconds: 1, max_retries_per_model: 0 } });
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.hang = true;
  var started = Date.now();
  return ask(sys).then(function (r) {
    var took = Date.now() - started;
    var q = r.attempts.filter(function (a) { return a.tier === 'local'; })[0];
    t.ok(r.ok && r.tier === 'paid' && q && q.timed_out === true && q.category === 'transient', 'a hanging Qwen is cut off at the attempt timeout and the next tier serves');
    t.ok(took < 8000, 'the whole call stayed bounded (' + took + ' ms for a 1 s attempt timeout)');
  });
}).then(function () {
  reset(); sys = build({ gateway: { max_retries_per_model: 1 } });
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down';
  var n = 0;
  servers.qwen.behaviour = function (req) {
    if (req.url === '/v1/chat/completions') { n++; if (n === 1) return { status: 503, json: { error: { message: 'Service Unavailable' } } }; }
    return h.qwenBehaviour({})(req);
  };
  return ask(sys).then(function (r) {
    var local = r.attempts.filter(function (a) { return a.tier === 'local'; });
    t.ok(r.ok && r.model === 'qwen-local' && local.length === 2 && local[0].category === 'transient' && local[1].ok, 'RETRY: a transient Qwen failure is retried once on the same model and succeeds');
    t.ok(sys.jev.status().models['qwen-local'].state === 'closed', 'a retried-then-successful model is healthy');
    servers.qwen.behaviour = h.qwenBehaviour(qwenCtl);
  });
}).then(function () {
  reset(); sys = build({ gateway: { max_retries_per_model: 3, max_attempts_total: 3 } });
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 503; qwenCtl.message = 'Service Unavailable';
  claude.script({ default: { error: 'API Error: 529 overloaded' } });
  openaiCtl.reply = { status: 503, body: '{}' };
  return ask(sys).then(function (r) {
    t.ok(!r.ok && r.reason === 'ATTEMPT_LIMIT' && r.attempts.length === 3, 'ATTEMPT CAP: retries can never push a call past max_attempts_total');
  });
}).then(function () {
  reset(); sys = build({ gateway: { attempt_timeout_seconds: 2, max_retries_per_model: 0 } });
  freeCtl.alpha.mode = 'hang'; freeCtl.beta.mode = 'hang'; qwenCtl.hang = true;
  var started = Date.now();
  return ask(sys, { timeout_seconds: undefined, deadline_at: now() + 3000 }).then(function (r) {
    t.ok(!r.ok && r.reason === 'DEADLINE' && Date.now() - started < 9000, 'DEADLINE: the task deadline ends the walk even when candidates remain');
    t.ok(claude.calls().length === 0, 'no model is started after the deadline');
  });
}).then(function () {
  return ask(sys, { prompt: '   ' }).then(function (r) {
    t.ok(!r.ok && r.reason === 'BAD_REQUEST' && r.attempts.length === 0, 'an empty prompt is refused before any model is asked');
  });
}).then(function () {
  section('M — malformed output fails closed');
  reset(); sys = build({ gateway: { max_retries_per_model: 1 } });
  freeCtl.alpha.mode = 'empty'; freeCtl.beta.mode = 'empty'; qwenCtl.text = '   \n ';
  return ask(sys);
}).then(function (r) {
  var local = r.attempts.filter(function (a) { return a.tier === 'local'; });
  t.ok(r.ok && r.tier === 'paid', 'a free answer with no content and a blank Qwen answer are both failures; paid serves');
  t.ok(local.length === 1 && local[0].code === 'MALFORMED_OUTPUT' && local[0].category === 'malformed', 'a blank answer is MALFORMED_OUTPUT and is not retried on the same model');

  reset(); sys = build();
  freeCtl.alpha.text = 'not a number'; freeCtl.beta.text = 'not a number'; qwenCtl.text = '42';
  return ask(sys, { validate: function (text) { return /^\d+$/.test(text) ? null : 'answer is not a number'; } });
}).then(function (r) {
  t.ok(r.ok && r.model === 'qwen-local' && r.text === '42' && r.attempts[0].code === 'MALFORMED_OUTPUT' && r.attempts[0].detail === 'answer is not a number',
    'an answer the caller\'s validator refuses is a failure of that model; the next model is asked');

  reset(); sys = build({ gateway: { max_output_chars: 50 } });
  freeCtl.alpha.text = new Array(200).join('x'); freeCtl.beta.text = new Array(200).join('x');
  return ask(sys);
}).then(function (r) {
  t.ok(r.ok && r.model === 'qwen-local' && r.attempts[0].code === 'MALFORMED_OUTPUT', 'an oversized answer is refused rather than truncated');

  reset(); sys = build();
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 500;
  claude.script({ default: { result: 'claude answer', served_by: ['claude-haiku-4-5'] } });
  return ask(sys);
}).then(function (r) {
  var c = r.attempts.filter(function (a) { return a.model === 'claude-sonnet'; })[0];
  t.ok(c && c.code === 'IDENTITY_MISMATCH' && r.model === 'openai-advisor', 'a paid answer served by a different model than the one asked for is refused (identity is measured)');

  section('B — the paid tier obeys DOTS');
  reset(); sys = build({ models: { tier_order: ['free', 'local', 'paid'], paid: { allowed: false, max_calls_per_goal: 4, max_calls_per_day: 40 }, static_fallback_model: 'qwen-local' } });
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 500;
  return ask(sys);
}).then(function (r) {
  t.ok(!r.ok && r.reason === 'ALL_MODELS_FAILED' && claude.calls().length === 0 && openaiCtl.calls === 0, 'paid switched off by DOTS: no paid model is called even when everything else failed');
  var d = sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 10 });
  t.ok(d.rejected.filter(function (x) { return x.reason === 'PAID_NOT_PERMITTED'; }).length === 2, 'both paid models are rejected as PAID_NOT_PERMITTED');

  reset(); sys = build({ models: { tier_order: ['free', 'local', 'paid'], paid: { allowed: true, max_calls_per_goal: 1, max_calls_per_day: 2 }, static_fallback_model: 'qwen-local' }, jev: { failure_threshold: 99 } });
  freeCtl.alpha.mode = 'down'; freeCtl.beta.mode = 'down'; qwenCtl.status = 500;
  return ask(sys).then(function (a) {
    t.ok(a.ok && a.tier === 'paid', 'budget: the first paid call for the goal is granted');
    return ask(sys);
  }).then(function (b) {
    t.ok(!b.ok && claude.calls().length === 1, 'budget: the goal\'s second paid call is refused (max_calls_per_goal 1)');
    t.ok(sys.jev.route({ pool: 'execution', capability: 'analysis', kind: 'answer', prompt_chars: 10, goal_id: 'goal-fixture' }).rejected.some(function (x) { return x.reason === 'PAID_GOAL_BUDGET_EXHAUSTED'; }), 'the rejection is PAID_GOAL_BUDGET_EXHAUSTED');
    return ask(sys, { goal_id: 'goal-other' });
  }).then(function (c) {
    t.ok(c.ok && c.tier === 'paid', 'budget: another goal still has its own allowance');
    return ask(sys, { goal_id: 'goal-third' });
  }).then(function (d) {
    t.ok(!d.ok && sys.jev.paidGate('goal-third') === 'PAID_DAILY_BUDGET_EXHAUSTED', 'budget: the daily cap (2) stops every goal');
    now.advance(86400);
    t.ok(sys.jev.paidGate('goal-third') === null, 'budget: the daily counter starts over the next day');
  });
}).then(function () {
  section('S — no single point of failure');
  reset();
  // JEV cannot load: the gateway is built by the production wiring with a broken registry.
  var broken = h.registry();
  delete broken.models['qwen-local'].tier;
  var system = index.build({
    policy: h.policy({ gateway: { attempt_timeout_seconds: 2, max_retries_per_model: 0 } }), registry: broken, now: now,
    adapters: { 'haddad-qwen': adaptersLib.haddadQwen({ baseUrl: servers.qwen.url + '/v1', apiKey: 'fixture-runtime-key' }) },
    engines: { fable: h.scriptedEngine('fable', [{ fail: 'CLI_ERROR' }]), openai: h.scriptedEngine('openai', [{ fail: 'CLI_ERROR' }]) }
  });
  t.ok(system.jev === null && /^JEV_REGISTRY_INVALID/.test(system.jevError), 'a broken registry leaves JEV down, and says why');
  return system.gateway.complete({ pool: 'execution', capability: 'analysis', prompt: 'ping', timeout_seconds: 20 }).then(function (r) {
    t.ok(r.ok && r.model === 'qwen-local' && r.text === 'qwen says hello', 'JEV down: the gateway still answers through the policy\'s static fallback (Qwen)');
    t.ok(ledger.query({ type: 'JEV_UNAVAILABLE_STATIC_FALLBACK' }).length === 1, 'the static fallback is recorded as such — never mistaken for a JEV decision');
    return system.haddad.execute({ id: 'w1', kind: 'work', action: 'investigate', instruction: 'look', acceptance: [], timeout_seconds: 60 }, { goal_id: 'g', trace_id: 't' });
  }).then(function (w) {
    t.ok(!w.ok && w.reason === 'NO_EXECUTION_MODEL', 'JEV down: repository work fails closed (no static fallback grants execution authority)');
  });
}).then(function () {
  t.ok(ledger.verify().ok, 'the ledger chain is intact after every scenario');
  return Promise.all([servers.alpha.close(), servers.beta.close(), servers.qwen.close()]);
}).then(function () { t.finish(dirs); }, t.crash(dirs));
