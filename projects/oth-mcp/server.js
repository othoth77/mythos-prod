#!/usr/bin/env node
// =====================================================
// OTH MCP — controlled read interface over existing MYTHOS capabilities
// projects/oth-mcp/server.js
//
// WHAT THIS IS NOT: not a database, not a memory engine, not an identity
// system, not an executor, not a replacement for OTHMODE or Mythos OS, not
// a second knowledge engine. It stores nothing. Every tool resolves to a
// system that already owns the data, over an interface that already exists.
//
// If a tool here cannot name the system it routes to, it does not belong.
//
// TRANSPORT: JSON-RPC 2.0 over stdio, newline-delimited. Dependency-free
// by deliberate choice: the official TypeScript SDK installs 91 packages
// and 24 MB (express, hono, cors, jose, OAuth/SSE) to serve, for a stdio
// server, exactly three methods — initialize, tools/list, tools/call. That
// footprint is not justified in front of personal knowledge, in a repository
// whose oth-knowledge and executor cores carry no dependencies at all. The
// decision and its evidence are recorded in projects/oth-mcp/README.md.
//
// AUTHORIZATION: this process holds no authority of its own. Each upstream
// is reached with ITS OWN token, read from the environment, never logged and
// never returned to the client. An upstream that is not configured is
// reported as unavailable — the tool never degrades into a guess.
//
// WRITE BOUNDARY: version 1 is READ-ONLY. There is no tool that writes, and
// no code path that could. Execution, curation and evolution all have
// existing gates (executor policy + budget, othk-cli curation, OTHMODE
// owner-only HIGH-risk approval); exposing them is a later, separate
// increment that must route through those gates rather than around them.
// =====================================================
'use strict';

var http = require('http');
var https = require('https');
var { URL } = require('url');

var SERVER_NAME = 'oth-mcp';
var SERVER_VERSION = '1.0.0';
var PROTOCOL_VERSION = '2024-11-05';
var UPSTREAM_TIMEOUT_MS = 15000;
var MAX_RESPONSE_BYTES = 512 * 1024;

// ------------------------------------------------------------- upstreams

// Every upstream names the system that OWNS the data. Nothing here is a
// copy: the MCP holds no cache and no store.
var UPSTREAMS = {
  knowledge: {
    owner: 'OTH Knowledge',
    base: process.env.OTH_MCP_KNOWLEDGE_URL || 'http://127.0.0.1:8150',
    token: process.env.OTH_MCP_KNOWLEDGE_TOKEN || null,
    note: 'read-only facade over lib/knowledge-service.js; curation stays on othk-cli',
  },
  othmode: {
    owner: 'OTHMODE (Command Center)',
    base: process.env.OTH_MCP_OTHMODE_URL || 'http://127.0.0.1:3021',
    token: process.env.OTH_MCP_OTHMODE_TOKEN || null,
    // OTHMODE's read model (projects, skills, tools, providers, health,
    // status, history) is served with auth:false by its own route table —
    // verified against the running service. Demanding a token here would
    // add no security and would only break a working public read; the real
    // boundary for these routes is host access. A token IS sent when one is
    // configured, so an authenticated route works the day it is exposed.
    requiresToken: false,
    note: 'control plane read model: projects, skills, tools, providers, health, history',
  },
  executor: {
    owner: 'Mythos AI Executor',
    base: process.env.OTH_MCP_EXECUTOR_URL || 'http://127.0.0.1:8130',
    token: process.env.OTH_MCP_EXECUTOR_TOKEN || null,
    note: 'execution truth: tasks, goals, campaigns, budget, events',
  },
  status: {
    owner: 'Status Center',
    base: process.env.OTH_MCP_STATUS_URL || 'https://status.mythosprod.xyz',
    token: null,
    requiresToken: false, // published health data, public by design
    note: 'observability: probes, health, review snapshots',
  },
};

function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }

// One GET, bounded, with the upstream's own credential. No other verb
// exists in this file — a write cannot be added by accident.
function upstreamGet(key, pathAndQuery) {
  return new Promise(function (resolve, reject) {
    var up = UPSTREAMS[key];
    if (!up) return reject(fail('UPSTREAM_UNKNOWN', 'unknown upstream: ' + key));
    if (up.requiresToken !== false && !up.token) {
      return reject(fail('UPSTREAM_UNCONFIGURED',
        up.owner + ' has no token configured on this host; set OTH_MCP_' + key.toUpperCase() + '_TOKEN'));
    }
    var url;
    try { url = new URL(pathAndQuery, up.base); }
    catch (e) { return reject(fail('UPSTREAM_URL', 'bad upstream path')); }

    var mod = url.protocol === 'https:' ? https : http;
    var headers = { Accept: 'application/json' };
    if (up.token) headers.Authorization = 'Bearer ' + up.token;

    var req = mod.request(
      { method: 'GET', hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search, headers: headers, timeout: UPSTREAM_TIMEOUT_MS },
      function (res) {
        var chunks = []; var size = 0; var tooBig = false;
        res.on('data', function (c) {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) { tooBig = true; res.destroy(); return; }
          chunks.push(c);
        });
        res.on('end', function () {
          if (tooBig) return reject(fail('UPSTREAM_TOO_LARGE', up.owner + ' response exceeded ' + MAX_RESPONSE_BYTES + ' bytes'));
          var body = Buffer.concat(chunks).toString('utf8');
          var json = null;
          try { json = JSON.parse(body); } catch (e) { /* reported below */ }
          if (res.statusCode >= 400) {
            return reject(fail('UPSTREAM_' + res.statusCode,
              up.owner + ' answered ' + res.statusCode + (json && json.error ? ': ' + json.error : '')));
          }
          if (json === null) return reject(fail('UPSTREAM_BAD_JSON', up.owner + ' did not return JSON'));
          resolve(json);
        });
      }
    );
    req.on('timeout', function () { req.destroy(); reject(fail('UPSTREAM_TIMEOUT', up.owner + ' did not answer within ' + UPSTREAM_TIMEOUT_MS + 'ms')); });
    req.on('error', function () { reject(fail('UPSTREAM_UNREACHABLE', up.owner + ' is unreachable from this host')); });
    req.end();
  });
}

function q(params, name, opts) {
  opts = opts || {};
  var v = params && params[name];
  if (v === undefined || v === null || v === '') {
    if (opts.required) throw fail('TOOL_INPUT', name + ' is required');
    return null;
  }
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') throw fail('TOOL_INPUT', name + ' must be a string');
  if (opts.max && v.length > opts.max) throw fail('TOOL_INPUT', name + ' exceeds ' + opts.max + ' characters');
  return v;
}

// ----------------------------------------------------------------- tools

// Deliberately few. Each names its owner, its data source, and its
// read/write class. Nothing here duplicates an API that already exists —
// each is a routed call to one.
var TOOLS = [
  {
    name: 'knowledge_search',
    owner: 'OTH Knowledge',
    description:
      'Search curated MYTHOS knowledge (facts, claims, observations, entities, events) with provenance. '
      + 'Returns CLAIMS as claims — a claim is asserted, not established. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for.' },
        kind: { type: 'string', description: 'Optional record kind filter: fact, claim, observation, entity, event, evidence, derived, source, artifact, document, chunk, relationship.' },
        limit: { type: 'integer', description: 'Maximum hits (1-50, default 20).' },
      },
      required: ['query'],
    },
    run: function (p) {
      var s = new URLSearchParams();
      s.set('q', q(p, 'query', { required: true, max: 500 }));
      if (q(p, 'kind')) s.set('kind', q(p, 'kind', { max: 40 }));
      if (q(p, 'limit')) s.set('limit', q(p, 'limit', { max: 8 }));
      return upstreamGet('knowledge', '/search?' + s.toString());
    },
  },
  {
    name: 'knowledge_get',
    owner: 'OTH Knowledge',
    description:
      'Retrieve one knowledge record by id, with its provenance and evidence chain, so a statement can be '
      + 'traced back to the source it came from. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Record id, e.g. claim-0af535e2ff61f3a6.' },
        include: { type: 'string', description: 'Optional: "provenance", "evidence", or "history". Omit for the record itself.' },
      },
      required: ['id'],
    },
    run: function (p) {
      var id = encodeURIComponent(q(p, 'id', { required: true, max: 128 }));
      var inc = q(p, 'include', { max: 20 });
      var allowed = { provenance: 1, evidence: 1, history: 1 };
      if (inc && !allowed[inc]) throw fail('TOOL_INPUT', 'include must be provenance, evidence or history');
      return upstreamGet('knowledge', '/records/' + id + (inc ? '/' + inc : ''));
    },
  },
  {
    name: 'project_context',
    owner: 'projects/meta via OTHMODE',
    description:
      'The MYTHOS project portfolio: identity, status, current stage and dependencies, as governed by '
      + 'projects/meta and served by OTHMODE. Use this instead of reconstructing project history by hand. Read-only.',
    inputSchema: { type: 'object', properties: {} },
    run: function () { return upstreamGet('othmode', '/api/othmode/projects'); },
  },
  {
    name: 'capability_registry',
    owner: 'OTHMODE unified read model',
    description:
      'What this ecosystem can already do: registered skills, tools and providers, from the single read model '
      + 'over .claude/skills, the executor config and the MCP capability registry. Consult before proposing to build anything. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', description: 'skills | tools | providers (default: skills).' } },
    },
    run: function (p) {
      var kind = q(p, 'kind', { max: 20 }) || 'skills';
      var allowed = { skills: 1, tools: 1, providers: 1 };
      if (!allowed[kind]) throw fail('TOOL_INPUT', 'kind must be skills, tools or providers');
      return upstreamGet('othmode', '/api/othmode/' + kind);
    },
  },
  {
    name: 'execution_status',
    owner: 'Mythos AI Executor',
    description:
      'Status of execution work: list recent tasks, or one task by id. This is execution truth from the '
      + 'executor itself, not a summary. Read-only — creating or dispatching work is NOT exposed by this server.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'Optional task id. Omit to list.' } },
    },
    run: function (p) {
      var id = q(p, 'task_id', { max: 64 });
      return upstreamGet('executor', id ? '/tasks/' + encodeURIComponent(id) : '/tasks');
    },
  },
  {
    name: 'execution_report',
    owner: 'Mythos AI Executor',
    description:
      'The structured report a completed task produced. A worker report is a CLAIM about what happened; it '
      + 'becomes knowledge only through curation, never automatically. Read-only.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string', description: 'The task id.' } },
      required: ['task_id'],
    },
    run: function (p) {
      return upstreamGet('executor', '/tasks/' + encodeURIComponent(q(p, 'task_id', { required: true, max: 64 })) + '/report');
    },
  },
  {
    name: 'budget_status',
    owner: 'Mythos AI Executor',
    description:
      'The governed spend position of one project: limit, reserved, spent and remaining, or its settled '
      + 'history, or its open reservations. Budget is the gate every paid AI action must pass, and this is '
      + 'the executor\'s OWN ledger read back \u2014 not a second tally. `configured: false` means the project has '
      + 'no grant and every spend request for it is DENIED; a zero limit is a real answer, never a missing one. '
      + 'The reading is scoped to the ledger the answering executor owns, so it is that executor\'s truth and '
      + 'not necessarily every account\'s. Read-only \u2014 limits change only by a reviewed commit to '
      + 'config/budgets.json, which this server cannot make.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project id, e.g. oth-extraction.' },
        view: { type: 'string', description: 'Optional: "history" (settled entries) or "reservations" (open holds). Omit for the current position.' },
      },
      required: ['project'],
    },
    run: function (p) {
      var project = q(p, 'project', { required: true, max: 64 });
      // The executor's own project grammar, mirrored rather than loosened, so a
      // name this server accepts is exactly a name that route accepts. It also
      // makes traversal unrepresentable: no dot and no slash can appear.
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(project)) {
        throw fail('TOOL_INPUT', 'project must match [a-z0-9][a-z0-9-]{1,63}');
      }
      var view = q(p, 'view', { max: 20 });
      var allowed = { history: 1, reservations: 1 };
      if (view && !allowed[view]) throw fail('TOOL_INPUT', 'view must be history or reservations');
      return upstreamGet('executor', '/budget/' + project + (view ? '/' + view : ''));
    },
  },
  {
    name: 'system_health',
    owner: 'Status Center',
    description:
      'Live health of the MYTHOS estate: which services are up, resource pressure, backup health. '
      + 'Observability, not a control surface. Read-only.',
    inputSchema: { type: 'object', properties: {} },
    run: function () { return upstreamGet('status', '/data/live-status.json'); },
  },
];

var TOOL_BY_NAME = {};
TOOLS.forEach(function (t) { TOOL_BY_NAME[t.name] = t; });

// ------------------------------------------------------------- JSON-RPC

function writeMessage(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function result(id, value) { writeMessage({ jsonrpc: '2.0', id: id, result: value }); }
function rpcError(id, code, message) { writeMessage({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }); }

function toolResult(payload) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function handle(msg) {
  var id = msg.id;
  var method = msg.method;

  if (method === 'initialize') {
    return result(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        'OTH MCP exposes existing MYTHOS systems read-only. Knowledge search returns CLAIMS as claims — '
        + 'a claim is asserted, never established. Execution reports are claims about what happened. '
        + 'Nothing here writes: curation, execution and evolution keep their own gates.',
    });
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return; // no response

  if (method === 'ping') return result(id, {});

  if (method === 'tools/list') {
    return result(id, {
      tools: TOOLS.map(function (t) {
        return { name: t.name, description: t.description + ' [owner: ' + t.owner + ']', inputSchema: t.inputSchema };
      }),
    });
  }

  if (method === 'tools/call') {
    var name = msg.params && msg.params.name;
    var tool = TOOL_BY_NAME[name];
    if (!tool) return result(id, toolError('No such tool: ' + String(name).slice(0, 60)));
    try {
      var payload = await tool.run(msg.params.arguments || {});
      return result(id, toolResult(payload));
    } catch (e) {
      // The failure mode is always explicit and always names the owner.
      // A tool never invents an answer when its upstream is unavailable.
      return result(id, toolError((e.code || 'TOOL_ERROR') + ': ' + String(e.message || 'failed').slice(0, 400)));
    }
  }

  if (id !== undefined && id !== null) rpcError(id, -32601, 'Method not found: ' + String(method).slice(0, 60));
}

function main() {
  var buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (chunk) {
    buf += chunk;
    var nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      var line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      var msg;
      try { msg = JSON.parse(line); }
      catch (e) { rpcError(null, -32700, 'Parse error'); continue; }
      Promise.resolve(handle(msg)).catch(function (e) {
        if (msg && msg.id !== undefined) rpcError(msg.id, -32603, 'Internal error: ' + String(e.message || '').slice(0, 200));
      });
    }
  });
  process.stdin.on('end', function () { process.exit(0); });
}

if (require.main === module) main();
module.exports = { TOOLS, TOOL_BY_NAME, UPSTREAMS, handle, SERVER_NAME, SERVER_VERSION, PROTOCOL_VERSION };
