#!/usr/bin/env node
// =====================================================
// othk-7 — the advisory transport: budget-governed selection
// tests/othk-7-advisory-transport-test.js
//
// Drives scripts/othdb-select.js's provider path with an INJECTED provider
// and an INJECTED budget. Nothing here reaches the network, and no real
// money is reachable from this file: the point is to prove the ORDER
// (reserve -> call -> settle) and every fail-closed branch around it.
// =====================================================
'use strict';

const path = require('path');
const selector = require(path.join(__dirname, '..', 'scripts', 'othdb-select.js'));

let passed = 0, failed = 0;
function ok(cond, label) { if (cond) { passed++; console.log('  PASS ' + label); } else { failed++; console.log('  FAIL ' + label); } }
async function expectError(fn, re, label) {
  try { await fn(); failed++; console.log('  FAIL ' + label + ' (no error thrown)'); }
  catch (e) { ok(re.test(String(e.code) + ':' + String(e.message)), label); }
}

const CONV = { title: 'T', messages: [
  { position: 0, role: 'user', content: 'The workshop opened in 2019 in Tunis.' },
  { position: 1, role: 'assistant', content: 'Noted.' },
] };
const GOOD = '```json\n{"statements":[{"statement":"The workshop opened in 2019 in Tunis.","role_source":"user","message_position":0}]}\n```';

// --- fakes -----------------------------------------------------------------
function fakeBudget(decision) {
  const calls = [];
  return {
    calls,
    reserve(r) { calls.push(['reserve', r]); return decision || { decision: 'allow', reservation_id: r.reservation_id }; },
    settle(r) { calls.push(['settle', r]); return { ok: true }; },
    release(r) { calls.push(['release', r]); return { ok: true }; },
  };
}
function fakeProvider(outcome, onRun) {
  return {
    run(task, prompt, _s, _m, opts) {
      if (onRun) onRun(task, prompt, opts);
      if (outcome instanceof Error) return Promise.reject(outcome);
      return Promise.resolve(outcome);
    },
  };
}
const okOutcome = { exit_code: 0, parsed: { is_error: false, result: GOOD }, usage: { total_tokens: 120 }, duration_ms: 42 };
const base = { transport: 'provider', reservationId: 'test-conv-1', costEstimateUsd: 0.02, budgetProject: 'unit-test' };

(async function run() {

console.log('\nA. the happy path is ordered reserve -> call -> settle');
{
  const b = fakeBudget();
  const order = [];
  const p = fakeProvider(okOutcome, () => order.push('call'));
  const orig = b.reserve, origS = b.settle;
  b.reserve = (r) => { order.push('reserve'); return orig(r); };
  b.settle = (r) => { order.push('settle'); return origS(r); };

  const res = await selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b, provider: p }));
  ok(order.join('>') === 'reserve>call>settle', 'A1: exact order is reserve > call > settle');
  ok(res.statements.length === 1, 'A2: the selection parsed');
  ok(res.selector.transport === 'provider', 'A3: transport recorded as provider');
  ok(res.spend && res.spend.settled === true, 'A4: the spend is reported as settled');
  ok(res.spend.usage && res.spend.usage.total_tokens === 120, 'A5: gateway usage is carried through, not invented');
}

console.log('\nB. the model and the framing are the intended ones');
{
  let seenTask = null, seenOpts = null;
  const p = fakeProvider(okOutcome, (t, _pr, o) => { seenTask = t; seenOpts = o; });
  await selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: fakeBudget(), provider: p }));
  ok(seenTask.model === 'openrouter/deepseek/deepseek-v4-pro', 'B1: DeepSeek V4 Pro is the default model');
  ok(seenTask.model === selector.DEFAULT_ADVISORY_MODEL, 'B2: the default is the exported constant');
  ok(seenOpts.systemPrompt === selector.SELECTOR_SYSTEM_PROMPT, 'B3: the selector overrides the executor report framing');
  ok(!/mythos_report/.test(seenOpts.systemPrompt), 'B4: no second fenced block is requested — the contract stays one block');
}

console.log('\nC. budget denial stops the call BEFORE the network');
{
  const b = fakeBudget({ decision: 'deny', reason: 'project "x" has no configured spending budget (limit 0 USD)' });
  let called = false;
  const p = fakeProvider(okOutcome, () => { called = true; });
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b, provider: p })),
    /SELECTOR_BUDGET_DENIED/, 'C1: a denied budget is a typed refusal');
  ok(called === false, 'C2: the provider was NEVER called');
  ok(b.calls.filter((c) => c[0] === 'settle').length === 0, 'C3: nothing was settled');
  ok(b.calls.filter((c) => c[0] === 'release').length === 0, 'C4: nothing to release — no reservation was created');
}

console.log('\nD. an unknown cost is never treated as zero');
{
  const prev = process.env.MYTHOS_SELECTOR_COST_ESTIMATE_USD;
  delete process.env.MYTHOS_SELECTOR_COST_ESTIMATE_USD;
  let called = false;
  const opts = Object.assign({}, base, { budget: fakeBudget(), provider: fakeProvider(okOutcome, () => { called = true; }) });
  delete opts.costEstimateUsd;
  await expectError(() => selector.selectStatementsAsync(CONV, opts), /SELECTOR_BUDGET_REFUSED/,
    'D1: a missing cost estimate is refused');
  ok(called === false, 'D2: no call was made without a stated cost');
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    costEstimateUsd: -1, budget: fakeBudget(), provider: fakeProvider(okOutcome) })), /SELECTOR_BUDGET_REFUSED/,
    'D3: a negative estimate is refused');
  if (prev !== undefined) process.env.MYTHOS_SELECTOR_COST_ESTIMATE_USD = prev;
}

console.log('\nE. a retry can never be billed twice');
{
  const opts = Object.assign({}, base, { budget: fakeBudget(), provider: fakeProvider(okOutcome) });
  delete opts.reservationId;
  await expectError(() => selector.selectStatementsAsync(CONV, opts), /SELECTOR_BUDGET_REFUSED/,
    'E1: a missing reservation id is refused');
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    reservationId: 'bad id with spaces/and\\slashes', budget: fakeBudget(), provider: fakeProvider(okOutcome) })),
    /SELECTOR_BUDGET_REFUSED/, 'E2: an unsafe reservation id is refused');
  const b = fakeBudget();
  await selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b, provider: fakeProvider(okOutcome) }));
  ok(b.calls[0][1].reservation_id === 'test-conv-1' && b.calls[1][1].reservation_id === 'test-conv-1',
    'E3: reserve and settle name the SAME reservation id');
}

console.log('\nF. a call that did not complete returns the hold');
{
  const b = fakeBudget();
  const p = fakeProvider({ exit_code: 1, parsed: { is_error: true, result: 'HTTP 502: bad gateway' }, stderr: 'HTTP 502' });
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b, provider: p })),
    /SELECTOR_UNAVAILABLE/, 'F1: a failed provider call fails closed');
  ok(b.calls.some((c) => c[0] === 'release'), 'F2: the reservation was RELEASED, not left dangling');
  ok(!b.calls.some((c) => c[0] === 'settle'), 'F3: a call that never billed is never settled');

  const b2 = fakeBudget();
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    budget: b2, provider: fakeProvider(new Error('socket exploded')) })), /SELECTOR_UNAVAILABLE/,
    'F4: a throwing adapter fails closed');
  ok(b2.calls.some((c) => c[0] === 'release'), 'F5: the hold is returned when the adapter throws');
}

console.log('\nG. a completed call is settled even when its text is unusable');
{
  const b = fakeBudget();
  const p = fakeProvider({ exit_code: 0, parsed: { is_error: false, result: 'no fenced block here at all' } });
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b, provider: p })),
    /SELECTOR_OUTPUT_INVALID/, 'G1: malformed model output is still refused');
  ok(b.calls.some((c) => c[0] === 'settle'), 'G2: the money left before the text could be judged — SETTLED, not released');
  ok(!b.calls.some((c) => c[0] === 'release'), 'G3: a billed call is never released');
}

console.log('\nH. every pre-existing guarantee still applies on the async path');
{
  const b = fakeBudget();
  let called = false;
  const p = fakeProvider(okOutcome, () => { called = true; });
  await expectError(() => selector.selectStatementsAsync(
    { title: 'T', messages: [{ position: 0, role: 'user', content: 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }] },
    Object.assign({}, base, { budget: b, provider: p })), /SECRET/,
    'H1: secret-shaped INPUT refused before any transport call');
  ok(called === false, 'H2: no provider call and no reservation for secret-bearing input');
  ok(b.calls.length === 0, 'H3: the budget was never even asked');

  const b2 = fakeBudget();
  const leak = '```json\n{"statements":[{"statement":"key ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789","role_source":"user","message_position":0}]}\n```';
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    budget: b2, provider: fakeProvider({ exit_code: 0, parsed: { is_error: false, result: leak } }) })), /SECRET/,
    'H4: secret-shaped OUTPUT refused');
  ok(b2.calls.some((c) => c[0] === 'settle'), 'H5: that call still billed, so it is still settled');

  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    agent: 'claude-code', budget: fakeBudget(), provider: fakeProvider(okOutcome) })), /SELECTOR_REFUSED/,
    'H6: an execution-authority agent is REFUSED on the async path too');
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    agent: 'nope', budget: fakeBudget(), provider: fakeProvider(okOutcome) })), /SELECTOR_UNAVAILABLE/,
    'H7: an unknown agent fails closed');

  const extra = '```json\n{"statements":[{"statement":"x","role_source":"user","message_position":0,"confidence":"HIGH"}]}\n```';
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, {
    budget: fakeBudget(), provider: fakeProvider({ exit_code: 0, parsed: { is_error: false, result: extra } }) })),
    /SELECTOR_REFUSED/, 'H8: the model still cannot name confidence — it cannot widen its own trust');
}

console.log('\nK. settle requires EVIDENCE of a completion (regression, 2026-08-31)');
{
  // Exactly the shape the gateway returned while its egress leg refused
  // connections: status below 400, no error flag, no usage, no text.
  const b = fakeBudget();
  const phantom = { exit_code: 0, parsed: { is_error: false, result: '' }, usage: null, duration_ms: 12000 };
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b, provider: fakeProvider(phantom) })),
    /SELECTOR_NO_COMPLETION/, 'K1: a reply with no usage and no text is NOT a completion');
  ok(b.calls.some((c) => c[0] === 'release'), 'K2: the reservation is RELEASED — a phantom call costs nothing');
  ok(!b.calls.some((c) => c[0] === 'settle'), 'K3: nothing is settled, so the ledger keeps telling the truth');

  const b2 = fakeBudget();
  const whitespace = { exit_code: 0, parsed: { is_error: false, result: '   \n  ' }, usage: null };
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b2, provider: fakeProvider(whitespace) })),
    /SELECTOR_NO_COMPLETION/, 'K4: whitespace-only text is not evidence either');
  ok(b2.calls.some((c) => c[0] === 'release'), 'K5: released');

  // Usage alone is enough evidence that tokens were billed, even if the text
  // is then unusable: the money left, so it must be settled.
  const b3 = fakeBudget();
  const billedButJunk = { exit_code: 0, parsed: { is_error: false, result: 'prose, no fenced block' }, usage: { total_tokens: 88 } };
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b3, provider: fakeProvider(billedButJunk) })),
    /SELECTOR_OUTPUT_INVALID/, 'K6: billed-but-unusable output is still refused');
  ok(b3.calls.some((c) => c[0] === 'settle'), 'K7: and still SETTLED — tokens were consumed');

  const b4 = fakeBudget();
  const usageOnly = { exit_code: 0, parsed: { is_error: false, result: '' }, usage: { total_tokens: 5 } };
  await expectError(() => selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b4, provider: fakeProvider(usageOnly) })),
    /SELECTOR_OUTPUT_INVALID/, 'K8: reported usage with empty text counts as billed');
  ok(b4.calls.some((c) => c[0] === 'settle'), 'K9: settled on usage evidence alone');

  const b5 = fakeBudget();
  const res = await selector.selectStatementsAsync(CONV, Object.assign({}, base, { budget: b5, provider: fakeProvider(okOutcome) }));
  ok(res.spend.usage_tokens === 120, 'K10: usage_tokens is reported from the gateway, never invented');
}

console.log('\nI. the synchronous path never spends');
{
  const prev = process.env.MYTHOS_SELECTOR_SCRIPT;
  delete process.env.MYTHOS_SELECTOR_SCRIPT;
  let threw = null;
  try { selector.selectStatements(CONV, { transport: 'provider' }); } catch (e) { threw = e; }
  ok(threw && threw.code === 'SELECTOR_UNAVAILABLE', 'I1: the sync entry point refuses the provider, on every host');
  ok(threw && /selectStatementsAsync/.test(threw.message), 'I2: and it names the governed path instead');
  if (prev !== undefined) process.env.MYTHOS_SELECTOR_SCRIPT = prev;
}

console.log('\nJ. the real modules resolve — the wiring points at what exists');
{
  const provider = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'providers', 'openai-compat.js'));
  const budget = require(path.join(__dirname, '..', 'projects', 'mythos-ai-executor', 'core', 'budget.js'));
  ok(provider.executionAuthority === false, 'J1: the real adapter is permanently advisory-only');
  ok(typeof provider.run === 'function' && typeof budget.reserve === 'function'
     && typeof budget.settle === 'function' && typeof budget.release === 'function',
     'J2: the real reserve/settle/release contract exists');
  ok(provider.DEFAULT_SYSTEM_PROMPT.indexOf('mythos_report') !== -1,
     'J3: the executor default framing is unchanged for every other caller');
  ok(selector.DEFAULT_BUDGET_PROJECT === 'mythos-prod', 'J4: extraction budgets under mythos-prod by default');
}

console.log('');
console.log('othk-7: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
})();
