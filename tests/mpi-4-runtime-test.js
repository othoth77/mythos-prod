// =====================================================
// MPI-4 M4-2 — Runtime composition suite (fully offline)
// tests/mpi-4-runtime-test.js
//
// The complete offline pipeline under test, real modules over a fake client:
//   request -> identity bridge -> R3 -> AssemblyResult -> ContextPackage
//   -> M4-1 adapter -> offline mock -> response.
// No network, no database, no R2, no credentials, no ingestion.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const P = path.join(BASE, 'projects/personal-intelligence/persistence');
const R = path.join(BASE, 'projects/personal-intelligence/runtime');
const { createRuntime } = require(path.join(R, 'mpi-runtime'));
const { createMockProvider } = require(path.join(R, 'mock-provider'));
const { resolveScope, OWNER_SCOPES } = require(path.join(R, 'identity-bridge'));

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
    memory_record_id: id, user_id: 'usr_othman', organisation_id: 'org_mythos',
    domain_id: null, session_id: null, scope: 'user', memory_type: 'DECISION',
    content_summary: 'summary ' + id + ' .invalid', state: 'active', evidence_count: 1,
    observed_at: '2026-08-10T00:00:00Z', created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z', content_reference: null,
    provenance: [{ memory_record_id: id, source_reference: 'src_' + id, provider: 'mythos', source_type: 'note', confidence: 'EXPLICIT' }],
    tags: []
  }, over || {});
}
function fakeClient(rows) {
  const statements = [];
  return {
    statements: statements,
    withTransaction: async function (fn) {
      return fn({ query: async function (sql) {
        statements.push(sql);
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
const OWNER = { userId: 'usr_othman', organisationId: 'org_mythos' };
function rt(rows, provider) {
  return createRuntime({ client: fakeClient(rows), provider: provider || createMockProvider() });
}
const baseReq = { scope: OWNER, message: 'what governs memory? .invalid', limit: 10 };

(async function main() {
  console.log('\nM4-2 — identity bridge (fail-closed, explicit only)');

  ok(resolveScope(OWNER).userId === 'usr_othman', '1 valid owner scope resolves');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ organisationId: 'org_mythos' })); },
    /IDENTITY_USER_REQUIRED/, '2 missing user_id refused');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ userId: 'usr_othman' })); },
    /IDENTITY_ORGANISATION_REQUIRED/, '3 missing organisation_id refused');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ userId: 'usr_intruder.invalid', organisationId: 'org_mythos' })); },
    /IDENTITY_SCOPE_NOT_DECLARED/, '4 undeclared scope refused — only the owner-ratified mapping resolves');
  ok(OWNER_SCOPES.length === 1, '5 exactly one owner-declared scope exists; no session/IP/hostname inference path exists');

  console.log('\nM4-2 — runtime pipeline');

  await expectRefusal(function () { return rt([]).ask({ scope: OWNER, message: '   ', limit: 5 }); },
    /RUNTIME_MESSAGE_REQUIRED/, '6 empty request refused');
  const r1 = await rt([row('m1'), row('m2')]).ask(baseReq);
  ok(r1.response.ok === true && /^MOCK-OFFLINE /.test(r1.response.text),
    '7 normal request -> deterministic mock response through the full chain');
  const r2 = await rt([row('m1'), row('m2')]).ask(baseReq);
  ok(r1.response.text === r2.response.text, '8 repeated identical request, byte-identical result');
  ok(/facts=2/.test(r1.response.text), '9 both memories entered the package (interim USEFUL linking; memory source maps to requiredFacts)');
  ok(r1.diagnostics.package && Array.isArray(r1.diagnostics.package.trimmed),
    '10 package diagnostics travel (trim reasons surface)');
  ok(/interim O-4-4/.test(r1.diagnostics.linkingRule),
    '11 the interim linking rule is disclosed in every response, never silent');

  await expectRefusal(function () { return rt([]).ask({ scope: OWNER, message: 'x', limit: undefined }); },
    /LIMIT_REQUIRED/, '12 bounded context: limit required, no exhaustive load exists');
  const rTrim = await rt([row('m1'), row('m2'), row('m3')]).ask(Object.assign({}, baseReq, { maxItems: 1 }));
  ok(/facts=1/.test(rTrim.response.text) && rTrim.diagnostics.package.trimmed.length === 2,
    '13 compiler bounding flows through with recorded trim reasons');

  await expectRefusal(function () { return rt([]).ask(Object.assign({}, baseReq, { includeStates: ['active', 'tombstoned'] })); },
    /TOMBSTONED_INVISIBLE/, '14 O-R1(b): tombstoned request refused through the runtime');

  const rPerm = await rt([row('m1'), row('m2', { scope: 'organisation' })])
    .ask(Object.assign({}, baseReq, { permissions: { allowedScopes: ['user'] } }));
  ok(/facts=1/.test(rPerm.response.text), '15 permission filtering holds end-to-end (excluded scope never reaches the package)');

  const withRef = row('m1', { content_reference: 'mpi-content://sha256/' + 'a'.repeat(64) });
  const rRef = await rt([withRef]).ask(baseReq);
  ok(rRef.response.ok && !/mpi-content:\/\/sha256/.test(rRef.response.text),
    '16 D3: content reference present in records but no content body exists anywhere in the response');

  const rEmpty = await rt([]).ask(baseReq);
  ok(rEmpty.response.ok === true && /facts=0/.test(rEmpty.response.text),
    '17 empty memory result: valid empty package, deterministic response');

  const rFail = await rt([row('m1')], createMockProvider({ failWith: 'simulated .invalid' })).ask(baseReq);
  ok(rFail.response.ok === false && rFail.response.kind === 'PROVIDER_FAILURE',
    '18 provider failure fail-closed through the runtime');

  console.log('\nM4-2 — conflicts and provenance');

  const rConfl = await rt([
    row('mF', { state: 'disputed' }), row('mG', { state: 'disputed' })
  ]).ask(Object.assign({}, baseReq, { includeStates: ['active', 'disputed'] }));
  ok(rConfl.response.ok === true && Array.isArray(rConfl.diagnostics.conflicts),
    '19 disputed memories flow only on explicit request; conflicts surface in diagnostics, nothing auto-resolves');
  ok(r1.diagnostics.retrieval.retrieval.requireProvenance === true,
    '20 provenance requirement active by default through the runtime');

  console.log('\nM4-2 — no-egress enforcement (structural)');

  const files = ['mpi-runtime.js', 'identity-bridge.js', 'provider-adapter.js', 'mock-provider.js']
    .map(function (f) { return fs.readFileSync(path.join(R, f), 'utf8'); })
    .concat([fs.readFileSync(path.join(BASE, 'projects/personal-intelligence/cli/mpi-runtime-cli.js'), 'utf8')])
    .join('\n').replace(/\/\/[^\n]*\n/g, '\n');
  ok(!/require\(['"](https?|net|tls|dns|dgram|child_process)['"]\)/.test(files) &&
     !/fetch\(|XMLHttpRequest|WebSocket|axios|undici/.test(files),
    '21 no HTTP/HTTPS/DNS/network capability in any runtime module or the CLI');
  ok(!/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/.test(files) && /createMockProvider\(\)/.test(files) &&
     !/--provider|providerName|PROVIDER_URL|baseURL/.test(files),
    '22 no credential env read, no endpoint config, no provider-selection surface — the CLI hard-wires the offline mock');
  ok(!/require\([^)]*(ingestion|content-store|s3-compatible)/.test(files) &&
     !/\b(INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM)\b/i.test(files) && !/putContent|getContent|hydrate/.test(files),
    '23 no ingestion path, no SQL writes, no content-store/R2 linkage anywhere in the runtime surface');

  console.log('\nO-4-2 — hosting boundary and CLI hardening');

  const cli = require(path.join(BASE, 'projects/personal-intelligence/cli/mpi-runtime-cli.js'));
  function cliDeps(rows) {
    const client = fakeClient(rows);
    const lines = [];
    return { lines: lines, out: function (l) { lines.push(l); },
      activate: async function () { return { enabled: true, client: client }; } };
  }
  const cliBase = ['ask', '--user', 'usr_othman', '--organisation', 'org_mythos', '--limit', '5', '--message', 'q .invalid'];

  await expectRefusal(function () { return cli.run(cliBase.concat(['--provider', 'openai']), cliDeps([])); },
    /UNKNOWN_ARGUMENT/, '24 provider cannot be supplied — unknown argument refused, not ignored');
  await expectRefusal(function () { return cli.run(cliBase.concat(['--provider-url', 'https://x.invalid']), cliDeps([])); },
    /UNKNOWN_ARGUMENT/, '25 provider URL cannot be supplied');
  await expectRefusal(function () { return cli.run(cliBase.concat(['--api-key', 'k.invalid']), cliDeps([])); },
    /UNKNOWN_ARGUMENT/, '26 provider credential cannot be supplied — O-4-1 DEFER not bypassable via argv');
  await expectRefusal(function () { return cli.run(['ask', '--organisation', 'org_mythos', '--limit', '5', '--message', 'q'], cliDeps([])); },
    /IDENTITY_USER_REQUIRED/, '27 CLI without explicit identity refuses (nothing inferred)');

  const dOk = cliDeps([row('m1')]);
  const rOk = await cli.run(cliBase, dOk);
  ok(rOk.ok === true &&
     dOk.lines.some(function (l) { return /^MEMORIES_USED 1$/.test(l); }) &&
     dOk.lines.some(function (l) { return /m1 <- src_m1/.test(l); }) &&
     dOk.lines.some(function (l) { return /^HYDRATION none/.test(l); }),
    '28 operator output: memories used with provenance references, hydration status — no summaries, no content');

  const cliSrc = fs.readFileSync(path.join(BASE, 'projects/personal-intelligence/cli/mpi-runtime-cli.js'), 'utf8')
    .replace(/\/\/[^\n]*\n/g, '\n');
  const runtimeSrc = fs.readFileSync(path.join(R, 'mpi-runtime.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n');
  ok(!/\.listen\(|createServer|http2|express|fastify/.test(cliSrc + runtimeSrc),
    '29 no listening port / server surface exists — non-daemon by construction');
  ok(!/coolify|supabase/i.test(cliSrc + runtimeSrc),
    '30 no Coolify or Supabase dependency exists in the runtime surface');
  ok(!/setInterval|cron|systemd|schedule/i.test(cliSrc + runtimeSrc),
    '31 no scheduling primitive exists — on-demand only');

  console.log('\nO-4-3 — identity bridge ratified behaviour');

  await expectRefusal(function () { return Promise.resolve(resolveScope({ userId: 'usr_othman', organisationId: 'org_other.invalid' })); },
    /IDENTITY_SCOPE_NOT_DECLARED/, '32 mismatched user/organisation pair refused');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ userId: 'usr_othman', organisationId: '' })); },
    /IDENTITY_ORGANISATION_REQUIRED/, '33 empty organisation refused');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ hostname: 'vps.invalid', ip: '10.0.0.1', session: 's.invalid' })); },
    /IDENTITY_USER_REQUIRED|IDENTITY_SCOPE_UNKNOWN_FIELDS/, '34 metadata-only identity object refused — hostname/IP/session are not identity sources');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ userId: 'usr_othman', organisationId: 'org_mythos', hostname: 'vps.invalid' })); },
    /IDENTITY_SCOPE_UNKNOWN_FIELDS/, '35 metadata riding alongside a valid pair refused whole (strict scope object)');
  await expectRefusal(function () { return Promise.resolve(resolveScope({ userId: 'usr_othman', organisationId: 'org_mythos', email: 'x@y.invalid' })); },
    /IDENTITY_SCOPE_UNKNOWN_FIELDS/, '36 email is not an identity source');

  // Environment variables can never supply identity: env carries identity-ish
  // values, argv carries none -> the CLI refuses at the bridge.
  const dEnv = cliDeps([]);
  dEnv.env = { MPI_PERSISTENCE_ENABLED: 'true', MPI_IDENTITY: 'usr_othman', USER_ID: 'usr_othman' };
  await expectRefusal(function () {
    return cli.run(['ask', '--organisation', 'org_mythos', '--limit', '5', '--message', 'q'], dEnv);
  }, /IDENTITY_USER_REQUIRED/, '37 environment variables cannot supply identity — argv-explicit only');

  const dDom = cliDeps([row('m1', { domain_id: 'dom_x.invalid' })]);
  const rDom = await cli.run(cliBase.concat(['--domain', 'dom_x.invalid']), dDom);
  ok(rDom.ok === true && dDom.lines.some(function (l) { return /"domainId":true/.test(l); }),
    '38 explicit domain passes through the existing retrieval contract (validated filter, no inference)');
  const dNoDom = cliDeps([row('m1')]);
  await cli.run(cliBase, dNoDom);
  ok(dNoDom.lines.some(function (l) { return /"domainId":false/.test(l); }),
    '39 omitted domain stays absent — no default invented from identity');

  const rNoPerm = await rt([row('m1'), row('m2')]).ask(Object.assign({}, baseReq, { permissions: { allowedScopes: [] } }));
  ok(/facts=0/.test(rNoPerm.response.text),
    '40 operator identity grants nothing: empty allowedScopes excludes all memory — identity is not a policy bypass');

  const bridgeSrc = fs.readFileSync(path.join(R, 'identity-bridge.js'), 'utf8').replace(/\/\/[^\n]*\n/g, '\n');
  ok(!/process\.env|require\(['"](os|fs|net|http|child_process)['"]\)|hostname\(|INSERT INTO/.test(bridgeSrc),
    '41 bridge has zero inference/creation capability — no env, os, fs, network, or SQL access exists');

  console.log('\nM4-2 runtime: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
})().catch(function (e) {
  console.error('SUITE ABORTED: ' + (e && e.message));
  process.exit(1);
});
