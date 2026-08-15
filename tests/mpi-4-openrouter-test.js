// =====================================================
// O-4-1 — OpenRouter free provider + usage ledger suite (FULLY OFFLINE)
// tests/mpi-4-openrouter-test.js
//
// Every case runs against an injected mock transport and temp key/ledger
// files — no Internet, no real key, no database, no R2. The real network
// path is exercised exactly once, by the separately-authorized Phase 14
// production test, never by this suite.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = path.join(__dirname, '..');
const R = path.join(BASE, 'projects/personal-intelligence/runtime');
const orp = require(path.join(R, 'openrouter-provider'));
const ledgerModule = require(path.join(R, 'usage-ledger'));
const { createProviderAdapter } = require(path.join(R, 'provider-adapter'));
const assembler = require(path.join(BASE, 'projects/personal-intelligence/reference/context-assembler'));
const compiler = require(path.join(BASE, 'projects/personal-intelligence/reference/context-compiler'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectRefusal(fn, re, label) {
  try { await fn(); ok(false, label + ' (expected refusal, but it succeeded)'); }
  catch (e) { ok(e.refused === true && re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpi-orp-'));
const KEY_VALUE = 'sk-or-planted-test-key.invalid';
const keyFile = path.join(tmp, 'openrouter.env');
fs.writeFileSync(keyFile, 'OPENROUTER_API_KEY=' + KEY_VALUE + '\n', { mode: 0o600 });

function pkgFixture() {
  const assembly = assembler.assemble({
    task: { capabilityId: 'cap.x' },
    memory: [
      { key: 'mem:t1', value: 'summary one .invalid', requiredForCapability: 'cap.x',
        contentReference: 'mpi-content://sha256/' + 'a'.repeat(64), provenance: { reference: 'src_t1' } },
      { key: 'mem:t2', value: 'summary two .invalid', requiredForCapability: 'cap.x', provenance: { reference: 'src_t2' } }
    ],
    permissions: { allowedScopes: ['user'] }
  });
  return compiler.compile(assembly);
}

function goodResponse(over) {
  return Object.assign({
    status: 200,
    body: JSON.stringify({
      id: 'gen-test-1', model: orp.SELECTED_MODEL,
      choices: [{ message: { role: 'assistant', content: 'mocked completion .invalid' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    })
  }, over || {});
}

function capturingTransport(response) {
  const calls = [];
  const fn = async function (options, body) {
    calls.push({ options: options, body: body });
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response() : response;
  };
  fn.calls = calls;
  return fn;
}

(async function main() {
  console.log('\nO-4-1 — free-only structure');

  ok(orp.SELECTED_MODEL === 'nvidia/nemotron-3-ultra-550b-a55b:free' && /:free$/.test(orp.SELECTED_MODEL),
    '1 the ratified :free slug is a constant');
  const factoryKeys = Object.keys(orp.createOpenRouterProvider({ keyFile: keyFile, transport: capturingTransport(goodResponse()) }));
  ok(factoryKeys.indexOf('name') !== -1 && factoryKeys.indexOf('complete') !== -1,
    '2 provider satisfies the M4-1 contract — no second abstraction');
  const src = fs.readFileSync(path.join(R, 'openrouter-provider.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n');
  ok(!/:online|:nitro|:floor/.test(src),
    '3 :online/:nitro/:floor do not exist anywhere in the provider source');
  ok(!/model\s*[:=]\s*(o\.|opts|request|process\.env)/.test(src),
    '4 no model override path exists — the model cannot come from options, requests, or env');

  const t1 = capturingTransport(goodResponse());
  const p1 = orp.createOpenRouterProvider({ keyFile: keyFile, transport: t1 });
  const adapter = createProviderAdapter(p1);
  const res1 = await adapter.complete(pkgFixture(), 'question .invalid');
  ok(res1.ok === true && res1.text === 'mocked completion .invalid', '5 completion flows through the M4-1 adapter');

  const sentBody = JSON.parse(t1.calls[0].body);
  ok(sentBody.model === orp.SELECTED_MODEL, '6 request pins exactly the ratified model');
  ok(sentBody.provider && sentBody.provider.allow_fallbacks === false &&
     sentBody.provider.max_price && sentBody.provider.max_price.prompt === 0 && sentBody.provider.max_price.completion === 0,
    '7 allow_fallbacks:false + max_price 0/0 on every request — paid routing structurally excluded');

  console.log('\nO-4-1 — egress minimization (what actually crosses)');

  const raw = t1.calls[0].body;
  ok(raw.indexOf('summary one .invalid') !== -1 && raw.indexOf('question .invalid') !== -1,
    '8 summaries and the user message cross — that is the authorized egress');
  ok(raw.indexOf('mem:t1') === -1 && raw.indexOf('src_t1') === -1,
    '9 item keys and provenance references are STRIPPED before egress');
  ok(raw.indexOf('sha256') === -1 && raw.indexOf('mpi-content') === -1,
    '10 content_reference strings are STRIPPED — no content pointers cross');
  ok(raw.indexOf('allowedScopes') === -1 && raw.indexOf('_diagnostics') === -1,
    '11 permissions object and diagnostics are STRIPPED');
  ok(raw.indexOf(KEY_VALUE) === -1 && t1.calls[0].options.headers.Authorization === 'Bearer ' + KEY_VALUE,
    '12 the key travels ONLY in the Authorization header, never in the body');

  console.log('\nO-4-1 — key handling');

  await expectRefusal(function () {
    return orp.createOpenRouterProvider({ keyFile: path.join(tmp, 'absent.env'), transport: capturingTransport(goodResponse()) })
      .complete({ contextPackage: pkgFixture(), userMessage: 'x', constraints: {}, conflicts: [] });
  }, /OPENROUTER_KEY_MISSING/, '13 missing key file fails closed before any send');
  const badMode = path.join(tmp, 'badmode.env');
  fs.writeFileSync(badMode, 'OPENROUTER_API_KEY=x.invalid\n', { mode: 0o644 });
  await expectRefusal(function () {
    return orp.createOpenRouterProvider({ keyFile: badMode, transport: capturingTransport(goodResponse()) })
      .complete({ contextPackage: pkgFixture(), userMessage: 'x', constraints: {}, conflicts: [] });
  }, /KEY_FILE_MODE/, '14 world-readable key file refused');
  let keyLeak = false;
  try {
    await orp.createOpenRouterProvider({ keyFile: keyFile, transport: capturingTransport({ status: 401, body: '{}' }) })
      .complete({ contextPackage: pkgFixture(), userMessage: 'x', constraints: {}, conflicts: [] });
  } catch (e) { keyLeak = e.message.indexOf(KEY_VALUE) !== -1; ok(/KEY_REJECTED/.test(e.message) && !keyLeak, '15 invalid key fails closed, message value-free'); }

  console.log('\nO-4-1 — failure semantics (never a silent substitution)');

  await expectRefusal(function () {
    return orp.createOpenRouterProvider({ keyFile: keyFile, transport: capturingTransport({ status: 404, body: '{}' }) })
      .complete({ contextPackage: pkgFixture(), userMessage: 'x', constraints: {}, conflicts: [] });
  }, /FREE_MODEL_UNAVAILABLE/, '16 model gone -> FREE_MODEL_UNAVAILABLE');
  await expectRefusal(function () {
    return orp.createOpenRouterProvider({ keyFile: keyFile, transport: capturingTransport({ status: 429, body: '{}' }) })
      .complete({ contextPackage: pkgFixture(), userMessage: 'x', constraints: {}, conflicts: [] });
  }, /FREE_RATE_LIMITED/, '17 provider 429 -> FREE_RATE_LIMITED');
  await expectRefusal(function () {
    return orp.createOpenRouterProvider({ keyFile: keyFile,
      transport: capturingTransport(goodResponse({ body: JSON.stringify({ id: 'g', model: 'deepseek/deepseek-chat', choices: [{ message: { content: 'x' } }] }) })) })
      .complete({ contextPackage: pkgFixture(), userMessage: 'x', constraints: {}, conflicts: [] });
  }, /FREE_MODEL_POLICY_VIOLATION/, '18 a response from any other model is refused — no silent substitution');
  const netFail = await createProviderAdapter(orp.createOpenRouterProvider({ keyFile: keyFile, transport: capturingTransport(new Error('provider unavailable')) }))
    .complete(pkgFixture(), 'x');
  ok(netFail.ok === false && netFail.kind === 'PROVIDER_FAILURE', '19 network failure fails cleanly through the M4-1 adapter');
  ok(src.indexOf('retry') === -1 && !/for\s*\(|while\s*\(/.test(src.replace(/forEach/g, '')),
    '20 no retry loop exists — one attempt per request, ever');

  console.log('\nO-4-1 — usage ledger (honest estimated counter)');

  let clock = new Date('2026-08-15T10:00:00Z');
  const ledger = ledgerModule.createLedger({ file: path.join(tmp, 'usage.json'), now: function () { return clock; } });
  const s0 = ledger.status('openrouter-free', orp.SELECTED_MODEL);
  ok(s0.usedEstimated === 0 && s0.remainingEstimated === 50 && s0.counterType === 'ESTIMATED_LOCAL',
    '21 initial state 0/50, labelled ESTIMATED_LOCAL');
  ledger.recordSent('openrouter-free', orp.SELECTED_MODEL);
  ledger.recordResult('openrouter-free', orp.SELECTED_MODEL, true, 'gen-1');
  const s1 = ledger.status('openrouter-free', orp.SELECTED_MODEL);
  ok(s1.usedEstimated === 1 && s1.remainingEstimated === 49 && s1.succeeded === 1,
    '22 one success: used 1, remaining 49');
  ledger.recordSent('openrouter-free', orp.SELECTED_MODEL);
  ledger.recordResult('openrouter-free', orp.SELECTED_MODEL, false);
  const s2 = ledger.status('openrouter-free', orp.SELECTED_MODEL);
  ok(s2.usedEstimated === 2 && s2.succeeded === 1 && s2.failed === 1,
    '23 a failed attempt counts as sent (it reached the provider) but never as a success');
  for (let i = 0; i < 48; i++) ledger.recordSent('openrouter-free', orp.SELECTED_MODEL);
  const s3 = ledger.status('openrouter-free', orp.SELECTED_MODEL);
  ok(s3.usedEstimated === 50 && s3.remainingEstimated === 0, '24 quota reached: 50/50, remaining 0');
  await expectRefusal(function () { return Promise.resolve(ledger.assertQuota('openrouter-free', orp.SELECTED_MODEL)); },
    /FREE_LIMIT_REACHED/, '25 assertQuota fails closed at the ceiling — nothing more is sent');
  ledger.recordSent('openrouter-free', orp.SELECTED_MODEL); // over-record must not go negative
  const s4 = ledger.status('openrouter-free', orp.SELECTED_MODEL);
  ok(s4.remainingEstimated === 0 && s4.remainingEstimated >= 0 && s4.usedEstimated === 51,
    '26 remaining never negative, never above the limit');
  clock = new Date('2026-08-16T00:00:01Z');
  const s5 = ledger.status('openrouter-free', orp.SELECTED_MODEL);
  ok(s5.usedEstimated === 0 && s5.remainingEstimated === 50 && /UTC day/.test(s5.reset),
    '27 UTC-day rollover resets the estimate (documented reset boundary)');

  console.log('\nO-4-1 — ledger stores metadata only');

  const ledgerRaw = fs.readFileSync(path.join(tmp, 'usage.json'), 'utf8');
  ok(ledgerRaw.indexOf('summary one') === -1 && ledgerRaw.indexOf(KEY_VALUE) === -1 &&
     ledgerRaw.indexOf('question') === -1 && ledgerRaw.indexOf('mocked completion') === -1,
    '28 ledger contains no prompts, packages, memory, responses, or keys');

  console.log('\nO-4-1 — CLI integration (offline, injected)');

  const cli = require(path.join(BASE, 'projects/personal-intelligence/cli/mpi-runtime-cli.js'));
  function fakeClient(rows) {
    return {
      withTransaction: async function (fn) {
        return fn({ query: async function (sql) {
          if (/FROM pi_memory_records m/.test(sql)) return { rows: rows };
          if (/FROM pi_memory_provenance WHERE memory_record_id = ANY/.test(sql)) {
            const out = []; rows.forEach(function (r) { (r.provenance || []).forEach(function (p) { out.push(p); }); });
            return { rows: out };
          }
          return { rows: [] };
        } });
      },
      emit: function () {}
    };
  }
  const rowFx = { memory_record_id: 'mA', user_id: 'usr_othman', organisation_id: 'org_mythos', domain_id: null,
    session_id: null, scope: 'user', memory_type: 'DECISION', content_summary: 'cli summary .invalid', state: 'active',
    evidence_count: 1, observed_at: '2026-08-10T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z', content_reference: null,
    provenance: [{ memory_record_id: 'mA', source_reference: 'src_mA', provider: 'mythos', source_type: 'note', confidence: 'EXPLICIT' }], tags: [] };

  const liveT = capturingTransport(goodResponse());
  const cliLedger = ledgerModule.createLedger({ file: path.join(tmp, 'cli-usage.json') });
  const lines = [];
  const dLive = {
    out: function (l) { lines.push(l); },
    activate: async function () { return { enabled: true, client: fakeClient([rowFx]) }; },
    liveProvider: orp.createOpenRouterProvider({ keyFile: keyFile, transport: liveT }),
    ledger: cliLedger
  };
  const rLive = await cli.run(['ask-live', '--user', 'usr_othman', '--organisation', 'org_mythos', '--limit', '5', '--message', 'live q .invalid'], dLive);
  ok(rLive.ok === true && lines.some(function (l) { return /Status: FREE$/.test(l); }) &&
     lines.some(function (l) { return /Estimated local usage: 1 \/ 50/.test(l); }) &&
     lines.some(function (l) { return /Estimated remaining: 49/.test(l); }),
    '29 ask-live: counter increments and the UI block labels the estimate honestly');
  ok(!lines.some(function (l) { return l.indexOf(KEY_VALUE) !== -1; }), '30 no key in any UI line');
  const stLines = [];
  await cli.run(['status'], { out: function (l) { stLines.push(l); }, ledger: cliLedger });
  ok(stLines.some(function (l) { return /Provider: OpenRouter/.test(l); }) &&
     stLines.some(function (l) { return /Estimated local usage: 1 \/ 50/.test(l); }),
    '31 status command reports without any request or activation');

  const fullLedger = ledgerModule.createLedger({ file: path.join(tmp, 'full.json') });
  for (let i = 0; i < 50; i++) fullLedger.recordSent('openrouter-free', orp.SELECTED_MODEL);
  await expectRefusal(function () {
    return cli.run(['ask-live', '--user', 'usr_othman', '--organisation', 'org_mythos', '--limit', '5', '--message', 'q'],
      { out: function () {}, activate: async function () { throw new Error('must not activate'); }, ledger: fullLedger });
  }, /FREE_LIMIT_REACHED/, '32 at the ceiling ask-live refuses BEFORE activation or any send — no paid fallback exists');

  ok(!/coolify|supabase/i.test(src + fs.readFileSync(path.join(R, 'usage-ledger.js'), 'utf8')),
    '33 no Coolify/Supabase dependency in provider or ledger');
  const provLedgerSrc = (src + fs.readFileSync(path.join(R, 'usage-ledger.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n'));
  ok(!/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM)\b/i.test(provLedgerSrc) &&
     !/require\([^)]*(client|repositories|ingestion|content-store|s3-compatible)/.test(provLedgerSrc),
    '34 no PostgreSQL/R2/ingestion linkage in provider or ledger');
  ok(res1.unresolvedConflicts === 0 && Array.isArray(res1.conflicts),
    '35 conflicts still surface unresolved through the adapter on the live path');

  console.log('\nO-4-1 openrouter: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
