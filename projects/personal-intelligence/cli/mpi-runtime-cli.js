// =====================================================
// Mythos Personal Intelligence — MPI-4 M4-2 Operator Runtime CLI (OFFLINE)
// projects/personal-intelligence/cli/mpi-runtime-cli.js
//
// Operator-run local entry point on the VPS, analogous to the existing
// operator CLIs. NOT deployed, NOT a service, NOT scheduled, ingestion OFF.
// Under ratified O-4-1 DEFER this composition root hard-wires the OFFLINE
// MOCK provider — there is no flag, argument, or environment variable that
// can select any other provider. Read-only with respect to MPI.
//
// Usage:
//   mpi-runtime-cli.js ask --user <id> --organisation <id> --limit <n>
//     --message <text> [--task <capabilityId>] [--domain <id>] [--tags a,b]
//     [--min-confidence X] [--max-items n] [--approx-budget chars]
// =====================================================
'use strict';

const activation = require('../persistence/activation');
const { createRuntime } = require('../runtime/mpi-runtime');
const { createMockProvider } = require('../runtime/mock-provider');

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

// O-4-2 hardening: STRICT argument whitelist. Any unknown --flag is a
// refusal, not a silent no-op — so a provider, endpoint, or key can never
// be smuggled in as an ignored argument. Extending this list is a code
// change reviewed like any other, never a runtime affordance.
const KNOWN_ARGS = ['user', 'organisation', 'limit', 'message', 'task', 'domain',
  'tags', 'min-confidence', 'max-items', 'approx-budget'];
function assertKnownArgs(argv) {
  argv.forEach(function (a) {
    if (/^--/.test(a) && KNOWN_ARGS.indexOf(a.slice(2)) === -1) {
      throw refusal('RUNTIME_CLI_UNKNOWN_ARGUMENT: ' + a + ' (strict whitelist; no provider/endpoint/credential argument exists)');
    }
  });
}

function argValue(argv, name) {
  const i = argv.indexOf('--' + name);
  return i < 0 ? null : argv[i + 1];
}
function listArg(argv, name) {
  const v = argValue(argv, name);
  return v === null ? undefined : v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

async function run(argv, deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const out = d.out || function (line) { process.stdout.write(line + '\n'); };
  if (argv[0] !== 'ask') throw refusal('RUNTIME_CLI_UNKNOWN_COMMAND');
  assertKnownArgs(argv.slice(1));

  const activate = d.activate || activation.activate;
  const activated = await activate({ env: env, pg: d.pg || require('../../idauto/node_modules/pg') });
  if (!activated.enabled) throw refusal('RUNTIME_CLI_PERSISTENCE_DISABLED (MPI_PERSISTENCE_ENABLED is not true)');

  // O-4-1 DEFER: the offline mock is the ONLY provider this root can build.
  const runtime = createRuntime({ client: activated.client, provider: createMockProvider() });

  const request = {
    scope: {
      userId: argValue(argv, 'user') || undefined,
      organisationId: argValue(argv, 'organisation') || undefined
    },
    message: argValue(argv, 'message') || undefined,
    limit: argValue(argv, 'limit') !== null ? Number(argValue(argv, 'limit')) : undefined
  };
  const task = argValue(argv, 'task'); if (task !== null) request.task = { capabilityId: task };
  const domain = argValue(argv, 'domain'); if (domain !== null) request.domainId = domain;
  const tags = listArg(argv, 'tags'); if (tags !== undefined) request.tags = tags;
  const minConf = argValue(argv, 'min-confidence'); if (minConf !== null) request.minConfidence = minConf;
  const maxItems = argValue(argv, 'max-items'); if (maxItems !== null) request.maxItems = Number(maxItems);
  const budget = argValue(argv, 'approx-budget'); if (budget !== null) request.approxBudget = Number(budget);

  const result = await runtime.ask(request);
  out('PROVIDER ' + result.response.provider + ' ok=' + result.response.ok);
  if (result.response.ok) {
    out('RESPONSE ' + result.response.text);
    out('UNRESOLVED_CONFLICTS ' + result.response.unresolvedConflicts);
  } else {
    out('FAILURE kind=' + result.response.kind);
  }
  // Operator visibility (O-4-2 Phase 6): WHICH memories informed the
  // response — ids and provenance references only, never summaries or
  // content bodies (those stay behind the already-authorized local read
  // paths, e.g. mpi-retrieve-cli with explicit --hydrate).
  const used = result.diagnostics.memoriesUsed || [];
  out('MEMORIES_USED ' + used.length);
  used.forEach(function (m) { out('  ' + m.id + ' <- ' + m.reference); });
  out('HYDRATION none (this runtime has no content-hydration path)');
  out('DIAGNOSTICS ' + JSON.stringify(result.diagnostics));
  return { ok: true, result: result };
}

async function main() {
  try {
    await run(process.argv.slice(2));
    process.exitCode = 0;
  } catch (e) {
    process.stderr.write('REFUSED: ' + (e && e.message || 'unknown failure') + '\n');
    process.exitCode = e && e.refused ? 3 : 1;
  }
}

if (require.main === module) main();

module.exports = { run: run };
