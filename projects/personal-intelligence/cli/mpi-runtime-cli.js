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
const openrouter = require('../runtime/openrouter-provider');
const ledgerModule = require('../runtime/usage-ledger');

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

// statusBlock(out, live, ledger) — the O-4-1 usage indicator. The count is
// an ESTIMATED LOCAL COUNT and is always labelled as such (spec §2.2:
// OpenRouter exposes no exact free-remaining counter).
function statusBlock(out, statusWord, ledgerStatus) {
  out('PROVIDER_STATUS');
  out('  Provider: OpenRouter');
  out('  Model: ' + openrouter.SELECTED_MODEL);
  out('  Status: ' + statusWord);
  out('  Estimated local usage: ' + ledgerStatus.usedEstimated + ' / ' + ledgerStatus.limit);
  out('  Estimated remaining: ' + ledgerStatus.remainingEstimated);
  out('  Reset: ' + ledgerStatus.reset);
  out('  Note: ' + ledgerStatus.counterNote);
}

async function run(argv, deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const out = d.out || function (line) { process.stdout.write(line + '\n'); };
  const cmd = argv[0];
  if (cmd !== 'ask' && cmd !== 'ask-live' && cmd !== 'status') throw refusal('RUNTIME_CLI_UNKNOWN_COMMAND');
  assertKnownArgs(argv.slice(1));

  const ledger = d.ledger || ledgerModule.createLedger();

  if (cmd === 'status') {
    // Read-only: no request, no activation, no key required.
    statusBlock(out, 'FREE', ledger.status(openrouter.PROVIDER_NAME, openrouter.SELECTED_MODEL));
    return { ok: true, status: ledger.status(openrouter.PROVIDER_NAME, openrouter.SELECTED_MODEL) };
  }

  // Quota gate FIRST: at the free ceiling ask-live refuses before activation,
  // before any database connection, before any send.
  if (cmd === 'ask-live') {
    ledger.assertQuota(openrouter.PROVIDER_NAME, openrouter.SELECTED_MODEL);
  }

  const activate = d.activate || activation.activate;
  const activated = await activate({ env: env, pg: d.pg || require('../../idauto/node_modules/pg') });
  if (!activated.enabled) throw refusal('RUNTIME_CLI_PERSISTENCE_DISABLED (MPI_PERSISTENCE_ENABLED is not true)');

  // Provider selection is COMMAND-shaped, never argument-shaped:
  //   ask      -> offline mock (zero egress, unchanged M4-2 behaviour)
  //   ask-live -> the O-4-1-ratified OpenRouter free provider, wrapped in the
  //               counting ledger; the ONLY egress path.
  let provider;
  if (cmd === 'ask-live') {
    const inner = d.liveProvider || openrouter.createOpenRouterProvider();
    provider = {
      name: inner.name,
      complete: async function (request) {
        ledger.recordSent(inner.name, openrouter.SELECTED_MODEL);
        try {
          const r = await inner.complete(request);
          ledger.recordResult(inner.name, openrouter.SELECTED_MODEL, true, r.meta && r.meta.requestId);
          return r;
        } catch (e) {
          ledger.recordResult(inner.name, openrouter.SELECTED_MODEL, false);
          throw e;
        }
      }
    };
  } else {
    provider = createMockProvider();
  }
  const runtime = createRuntime({ client: activated.client, provider: provider });

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
  if (cmd === 'ask-live') {
    const st = ledger.status(openrouter.PROVIDER_NAME, openrouter.SELECTED_MODEL);
    let word = 'FREE';
    if (!result.response.ok) {
      const msg = result.response.message || result.response.kind || '';
      if (/FREE_MODEL_UNAVAILABLE/.test(msg)) word = 'FREE MODEL UNAVAILABLE';
      else if (/FREE_RATE_LIMITED/.test(msg)) word = 'FREE RATE LIMITED';
      else word = 'PROVIDER FAILURE';
    }
    if (st.remainingEstimated === 0) word = 'FREE LIMIT REACHED';
    statusBlock(out, word, st);
  }
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
