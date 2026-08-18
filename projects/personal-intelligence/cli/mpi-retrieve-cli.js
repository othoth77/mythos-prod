// =====================================================
// Mythos Personal Intelligence — MPI-3 Operator Retrieval CLI (Stage R2)
// projects/personal-intelligence/cli/mpi-retrieve-cli.js
//
// READ-ONLY composition root over the §10 retrieval adapter
// (persistence/retrieval.js). Wires: activation (real pg driver, env
// contract, no fallback) -> retrieval adapter -> formatted output, plus
// EXPLICIT-ONLY D3 content hydration via the content store.
//
// Read-only by construction: this module never requires the ingestion
// module, contains no INSERT/UPDATE/DELETE, and never calls putContent.
// The only write anywhere is to stdout. O-R1(b) is enforced by the adapter
// (includeStates containing 'tombstoned' is refused before any connection).
//
// §10 relevance inputs `intent` and `entities` are ACCEPTED and echoed in
// the output envelope, but do not influence ranking at this stage — the
// ranking strategy that consumes them is the Stage R3 assembler integration
// (the §10/§3 contract explicitly allows the strategy to evolve without
// changing callers). Stated here so no one mistakes echo for ranking.
//
// Usage:
//   mpi-retrieve-cli.js memory --user <id> --organisation <id> --limit <n>
//     [--domain <id>] [--project <ref>] [--intent <text>] [--entities a,b]
//     [--from <iso>] [--to <iso>] [--tags a,b] [--min-confidence LOW|MEDIUM|HIGH|EXPLICIT]
//     [--include-states active,superseded,disputed] [--no-require-provenance]
//     [--allowed-scopes session,user,organisation,domain,global]
//     [--hydrate <memoryRecordId> --content-config <env-file>]
//   mpi-retrieve-cli.js events --user <id> --organisation <id> --limit <n>
//     [--event-types MILESTONE,...] [--domain <id>] [--project <ref>]
//     [--from <iso>] [--to <iso>]
// =====================================================
'use strict';

const retrieval = require('../persistence/retrieval');
const activation = require('../persistence/activation');
const contentStore = require('../persistence/content-store');
const s3 = require('../../infrastructure/ops/adapters/s3-compatible.js');

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}
function argValue(argv, name) {
  const i = argv.indexOf('--' + name);
  return i < 0 ? null : argv[i + 1];
}
function hasArg(argv, name) {
  return argv.indexOf('--' + name) >= 0;
}
function listArg(argv, name) {
  const v = argValue(argv, name);
  return v === null ? undefined : v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// buildQuery(argv) — pure translation of argv into a §10 query object.
function buildQuery(argv) {
  const q = {
    userId: argValue(argv, 'user') || undefined,
    organisationId: argValue(argv, 'organisation') || undefined,
    permissions: {},
    limit: argValue(argv, 'limit') !== null ? Number(argValue(argv, 'limit')) : undefined
  };
  const allowedScopes = listArg(argv, 'allowed-scopes');
  if (allowedScopes !== undefined) q.permissions.allowedScopes = allowedScopes;
  const domain = argValue(argv, 'domain'); if (domain !== null) q.domainId = domain;
  const project = argValue(argv, 'project'); if (project !== null) q.projectRef = project;
  const intent = argValue(argv, 'intent'); if (intent !== null) q.intent = intent;
  const entities = listArg(argv, 'entities'); if (entities !== undefined) q.entities = entities;
  const from = argValue(argv, 'from'); const to = argValue(argv, 'to');
  if (from !== null || to !== null) {
    q.timeRange = {};
    if (from !== null) q.timeRange.from = from;
    if (to !== null) q.timeRange.to = to;
  }
  const tags = listArg(argv, 'tags'); if (tags !== undefined) q.tags = tags;
  const minConf = argValue(argv, 'min-confidence'); if (minConf !== null) q.minConfidence = minConf;
  const states = listArg(argv, 'include-states'); if (states !== undefined) q.includeStates = states;
  if (hasArg(argv, 'no-require-provenance')) q.requireProvenance = false;
  const eventTypes = listArg(argv, 'event-types'); if (eventTypes !== undefined) q.eventTypes = eventTypes;
  return q;
}

function formatItem(i) {
  return [
    i.memory_record_id,
    'type=' + i.memory_type,
    'state=' + i.state,
    'scope=' + i.scope,
    'conf_rank=' + (i.max_conf_rank === null || i.max_conf_rank === undefined ? 'none' : i.max_conf_rank),
    'observed=' + (i.observed_at || 'null'),
    'prov=' + (i.provenance ? i.provenance.length : 0),
    'tags=[' + (i.tags || []).join(',') + ']',
    'ref=' + (i.content_reference ? 'yes' : 'no'),
    '| ' + i.content_summary
  ].join(' ');
}

async function run(argv, deps) {
  const d = deps || {};
  const env = d.env || process.env;
  const out = d.out || function (line) { process.stdout.write(line + '\n'); };
  const cmd = argv[0];
  if (cmd !== 'memory' && cmd !== 'events') throw refusal('RETRIEVE_CLI_UNKNOWN_COMMAND');

  const q = buildQuery(argv);

  const activate = d.activate || activation.activate;
  const activated = await activate({ env: env, pg: d.pg || require('pg') });
  if (!activated.enabled) throw refusal('RETRIEVE_CLI_PERSISTENCE_DISABLED (MPI_PERSISTENCE_ENABLED is not true)');
  const client = activated.client;

  if (cmd === 'events') {
    const r = await retrieval.retrieveEvents(client, q);
    out('EVENTS returned=' + r.items.length + ' limit=' + q.limit);
    r.items.forEach(function (e) {
      out('  ' + e.memory_event_id + ' type=' + e.event_type + ' occurred=' + e.occurred_at +
        ' anchor=' + (e.memory_record_id || 'none') + ' | ' + e.event_summary);
    });
    out('DIAGNOSTICS ' + JSON.stringify(r.diagnostics));
    return { ok: true, result: r };
  }

  const r = await retrieval.retrieveMemory(client, q);
  out('MEMORY returned=' + r.items.length + ' limit=' + q.limit +
    (q.intent !== undefined ? ' intent(echo-only)=' + JSON.stringify(q.intent) : '') +
    (q.entities !== undefined ? ' entities(echo-only)=' + JSON.stringify(q.entities) : ''));
  r.items.forEach(function (i, idx) { out('  [' + idx + '] ' + formatItem(i)); });
  out('CONFLICTS ' + r.conflicts.length +
    (r.conflicts.length ? ' :: ' + r.conflicts.map(function (c) {
      return c.memory_conflict_id + '(' + c.memory_record_id_a + ' vs ' + c.memory_record_id_b + ', ' + c.resolution_state + ')';
    }).join(' ') : ''));
  out('DIAGNOSTICS ' + JSON.stringify(r.diagnostics));

  // EXPLICIT-ONLY D3 hydration of exactly one already-returned item.
  const hydrateId = argValue(argv, 'hydrate');
  if (hydrateId !== null) {
    const item = r.items.find(function (i) { return i.memory_record_id === hydrateId; });
    if (!item) throw refusal('RETRIEVE_CLI_HYDRATE_NOT_IN_RESULT');
    const configFile = argValue(argv, 'content-config');
    if (!configFile) throw refusal('RETRIEVE_CLI_CONTENT_CONFIG_REQUIRED');
    const store = d.store || contentStore.createFromConfig(s3.loadConfig(configFile), s3);
    const body = await retrieval.hydrateContent(store, item);
    out('HYDRATED ' + hydrateId + ' bytes=' + body.length + ' :: ' + body.toString());
  }
  return { ok: true, result: r };
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

module.exports = { run: run, buildQuery: buildQuery };
