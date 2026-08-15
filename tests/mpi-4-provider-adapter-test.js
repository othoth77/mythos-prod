// =====================================================
// MPI-4 M4-1 — Provider adapter contract + offline mock suite
// tests/mpi-4-provider-adapter-test.js
//
// FULLY OFFLINE. The chain under test:
//   request -> identity/scope -> R3 (real modules over a fake client)
//   -> AssemblyResult -> compile() -> ContextPackage -> provider adapter
//   -> deterministic mock response.
// The capability linking of memory items is performed BY THE TEST as an
// explicit stand-in for the unbuilt skill/intent router — labelled as such,
// not hidden. No network, no database, no R2, no credentials.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const R = path.join(BASE, 'projects/personal-intelligence/runtime');
const runtime = require(path.join(P, 'context-runtime'));
const assembler = require(path.join(BASE, 'projects/personal-intelligence/reference/context-assembler'));
const compiler = require(path.join(BASE, 'projects/personal-intelligence/reference/context-compiler'));
const { createProviderAdapter, buildCompletionRequest } = require(path.join(R, 'provider-adapter'));
const { createMockProvider } = require(path.join(R, 'mock-provider'));

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
async function expectRefusal(fn, re, label) {
  try { await fn(); ok(false, label + ' (expected refusal, but it succeeded)'); }
  catch (e) { ok(e.refused === true && re.test(e.message), label + (re.test(e.message) ? '' : ' [got: ' + e.message + ']')); }
}

function row(id, over) {
  return Object.assign({
    memory_record_id: id, user_id: 'u.invalid', organisation_id: 'o.invalid',
    domain_id: null, session_id: null, scope: 'user', memory_type: 'DECISION',
    content_summary: 'summary ' + id, state: 'active', evidence_count: 1,
    observed_at: '2026-08-10T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z', content_reference: null,
    provenance: [{ memory_record_id: id, source_reference: 'src_' + id, provider: 'mythos', source_type: 'note', confidence: 'EXPLICIT' }],
    tags: []
  }, over || {});
}
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
const baseQ = { userId: 'u.invalid', organisationId: 'o.invalid', permissions: {}, limit: 10 };
const TASK = { capabilityId: 'cap.report' };

// Test-side stand-in for the unbuilt skill/intent router: link ranked
// memories to the task capability so the assembler admits them.
function linkToCapability(items) {
  return items.map(function (m) {
    return {
      key: m.memoryRecordId, value: m.contentSummary,
      requiredForCapability: TASK.capabilityId,
      permissionScope: m.scope,
      provenance: { reference: m.provenance.reference }
    };
  });
}

async function fullChain(rows, q, opts) {
  const o = opts || {};
  const client = fakeClient(rows);
  const ranked = await runtime.retrieveRelevantMemory(client, q); // R3, real modules
  const memory = linkToCapability(ranked.items);
  const assembly = assembler.assemble({ task: TASK, memory: memory, permissions: q.permissions });
  const pkg = compiler.compile(assembly, o.compileOptions);
  const adapter = createProviderAdapter(o.provider || createMockProvider());
  const response = await adapter.complete(pkg, o.userMessage || 'test message .invalid');
  return { ranked: ranked, assembly: assembly, pkg: pkg, response: response };
}

(async function main() {
  console.log('\nM4-1 — full offline chain');

  const chain1 = await fullChain([row('m1'), row('m2')], baseQ);
  ok(chain1.response.ok === true && /^MOCK-OFFLINE /.test(chain1.response.text) && /facts=2/.test(chain1.response.text),
    '1 request -> R3 -> AssemblyResult -> ContextPackage -> adapter -> mock response');
  const chain2 = await fullChain([row('m1'), row('m2')], baseQ);
  ok(chain1.response.text === chain2.response.text,
    '2 deterministic: identical chain input, byte-identical mock output');
  const chain3 = await fullChain([row('m1')], baseQ);
  ok(chain3.response.text !== chain1.response.text, '3 different input, different deterministic output');
  ok(chain1.pkg.requiredFacts.every(function (i) { return i.provenance && /^src_/.test(i.provenance.reference); }),
    '4 provenance preserved into the ContextPackage');

  const chainPerm = await fullChain([row('m1'), row('m2', { scope: 'organisation' })],
    Object.assign({}, baseQ, { permissions: { allowedScopes: ['user'] } }));
  ok(chainPerm.pkg.requiredFacts.length === 1 && chainPerm.pkg.requiredFacts[0].key === 'm1',
    '5 permission filtering holds through assembly and compilation');

  await expectRefusal(function () { return fullChain([], Object.assign({}, baseQ, { includeStates: ['active', 'tombstoned'] })); },
    /TOMBSTONED_INVISIBLE/, '6 O-R1(b) tombstone refusal fires before any package exists');
  await expectRefusal(function () { return fullChain([], Object.assign({}, baseQ, { userId: undefined })); },
    /USER_REQUIRED/, '7 missing identity/scope refused at the retrieval boundary');
  await expectRefusal(function () { return fullChain([], Object.assign({}, baseQ, { limit: undefined })); },
    /LIMIT_REQUIRED/, '8 bounded context: limit is required, no exhaustive load exists');

  const chainTrim = await fullChain([row('m1'), row('m2'), row('m3')], baseQ, { compileOptions: { maxItems: 1 } });
  ok(chainTrim.pkg.requiredFacts.length === 1 && chainTrim.pkg._diagnostics.trimmed.length === 2,
    '9 bounded context: compiler maxItems trims with recorded reasons');

  const chainEmpty = await fullChain([], baseQ);
  ok(chainEmpty.response.ok === true && /facts=0/.test(chainEmpty.response.text),
    '10 empty context: deterministic response over an empty, valid package');

  console.log('\nM4-1 — conflicts are surfaced, never resolved');

  const conflicted = assembler.assemble({
    task: TASK,
    memory: [
      { key: 'fact.x', value: 'A', requiredForCapability: TASK.capabilityId, provenance: { reference: 'src_a' } },
      { key: 'fact.x', value: 'B', requiredForCapability: TASK.capabilityId, provenance: { reference: 'src_b' } }
    ],
    permissions: {}
  });
  const pkgC = compiler.compile(conflicted);
  const adapterC = createProviderAdapter(createMockProvider());
  const resC = await adapterC.complete(pkgC, 'msg .invalid');
  ok(resC.ok === true && resC.unresolvedConflicts === 1 && resC.conflicts.length === 1 &&
     pkgC.requiredFacts.length === 2,
    '11 conflicting values both travel; adapter surfaces unresolvedConflicts=1, resolves nothing');

  console.log('\nM4-1 — adapter contract');

  await expectRefusal(function () { return Promise.resolve(createProviderAdapter({})); },
    /PROVIDER_CONTRACT_INVALID/, '12 provider without name/complete refused');
  await expectRefusal(function () {
    return Promise.resolve(buildCompletionRequest({ intent: null }, 'x'));
  }, /INVALID_CONTEXT_PACKAGE/, '13 malformed ContextPackage refused before any provider sees it');
  await expectRefusal(function () {
    const bad = JSON.parse(JSON.stringify(chain1.pkg));
    bad.requiredFacts[0].api_key = 'planted.invalid';
    return Promise.resolve(buildCompletionRequest(bad, 'x'));
  }, /Sensitive field/, '14 sensitive-named field refused at the boundary (value never crosses)');
  await expectRefusal(function () {
    const bad = JSON.parse(JSON.stringify(chain1.pkg));
    bad.requiredFacts[0].messages = [];
    return Promise.resolve(buildCompletionRequest(bad, 'x'));
  }, /Provider-specific field/, '15 provider-specific field refused (neutrality enforced)');
  await expectRefusal(function () { return createProviderAdapter(createMockProvider()).complete(chain1.pkg, ''); },
    /USER_MESSAGE_REQUIRED/, '16 empty user message refused');

  const failing = await fullChain([row('m1')], baseQ, { provider: createMockProvider({ failWith: 'simulated outage .invalid' }) });
  ok(failing.response.ok === false && failing.response.kind === 'PROVIDER_FAILURE',
    '17 provider failure is fail-closed: ok=false, no fabricated completion');
  const malformed = await fullChain([row('m1')], baseQ, { provider: createMockProvider({ malformed: true }) });
  ok(malformed.response.ok === false && malformed.response.kind === 'PROVIDER_MALFORMED_RESPONSE',
    '18 malformed provider response rejected');

  console.log('\nM4-1 — structural isolation');

  const srcA = fs.readFileSync(path.join(R, 'provider-adapter.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n');
  const srcM = fs.readFileSync(path.join(R, 'mock-provider.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n');
  const both = srcA + srcM;
  ok(!/require\(['"](https?|net|tls|dns|dgram|child_process|fs)['"]\)/.test(both) && !/fetch\(|XMLHttpRequest|WebSocket/.test(both),
    '19 no network or process capability exists in the runtime modules');
  ok(!/require\([^)]*(client|repositories|lifecycles|ingestion|migrate)['"]?\)/.test(both) &&
     !/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM)\b/i.test(both),
    '20 no PostgreSQL linkage or SQL exists — zero database capability');
  ok(!/require\([^)]*(content-store|s3-compatible)/.test(both) && !/putContent|getContent/.test(both),
    '21 no content-store/R2 linkage exists — zero object-storage capability');

  console.log('\nM4-1 provider adapter: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
