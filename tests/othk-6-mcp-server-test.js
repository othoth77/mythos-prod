// =====================================================
// OTH-K6 — OTH MCP server suite
// tests/othk-6-mcp-server-test.js
//
// Drives projects/oth-mcp/server.js as a real MCP client would: a child
// process, JSON-RPC 2.0 over stdio, newline-delimited. Covers the
// handshake, tool discovery, a real end-to-end tools/call against a live
// OTH Knowledge facade, bounded inputs, and the failure modes.
//
// Offline: a throwaway store, a loopback facade on an ephemeral port, a
// token this suite invents. No production system is contacted — every
// upstream the test does not stand up is deliberately left unconfigured so
// the "unavailable" path is exercised too.
//
// THE LOAD-BEARING TEST is "W": the server exposes no write. Not a tool
// that writes, not a code path that could. OTH MCP is the controlled read
// interface; execution, curation and evolution keep their own gates.
// =====================================================
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BASE = path.join(__dirname, '..');
const OTHK = path.join(BASE, 'projects', 'oth-knowledge');
const MCP_SERVER = path.join(BASE, 'projects', 'oth-mcp', 'server.js');

const storeLib = require(path.join(OTHK, 'lib/store.js'));
const provenanceLib = require(path.join(OTHK, 'lib/provenance.js'));
const extract = require(path.join(OTHK, 'lib/extract.js'));
const facade = require(path.join(OTHK, 'service/othk-http.js'));
const mcp = require(MCP_SERVER);

let passed = 0, failed = 0;
function ok(v, label) {
  if (v) { passed++; console.log('  PASS ' + label); }
  else { failed++; console.log('  FAIL ' + label); }
}
function tmpRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'othk6-')); }

const TOKEN = 'k6-token-' + 'z'.repeat(24);
const CLASSES = provenanceLib.loadSourceClasses();
const CAP = '2026-08-30T00:00:00Z';

function seededStore() {
  const root = tmpRoot();
  const s = storeLib.openStore(root);
  const prov = {
    source_class: 'manual', source_collection: 'k6', source_reference: 'manual/k6/1',
    captured_at: CAP, observed_at: '2026-01-01T00:00:00Z',
  };
  const e = extract.addEntity(s, { entity_type: 'host', name: 'mcp-fixture-host' });
  const c = extract.addClaim(s, CLASSES, {
    statement: 'the fixture host is reachable only on loopback',
    asserted_by: 'fixture', prov, entity_ids: [e.id],
  });
  extract.addEvidence(s, { supports_id: c.id, evidence_ids: [e.id], note: 'k6 fixture' });
  return { root, claimId: c.id };
}

// ------------------------------------------------------------- MCP client

function startClient(env) {
  const child = spawn(process.execPath, [MCP_SERVER], {
    env: Object.assign({}, process.env, env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const pending = new Map();
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });

  return {
    child,
    stderr: () => stderr,
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ timeout: true }); } }, 20000);
      });
    },
    notify(method) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); },
    raw(text) { child.stdin.write(text + '\n'); },
    stop() { child.stdin.end(); child.kill(); },
  };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async function run() {
  const seeded = seededStore();
  const kb = await listen(facade.createServer({ storeRoot: seeded.root, token: TOKEN }));
  const kbUrl = 'http://127.0.0.1:' + kb.address().port;

  // Knowledge is configured; every other upstream is deliberately NOT, so
  // the unavailable path is exercised against a real absence.
  const client = startClient({
    OTH_MCP_KNOWLEDGE_URL: kbUrl,
    OTH_MCP_KNOWLEDGE_TOKEN: TOKEN,
    OTH_MCP_OTHMODE_TOKEN: '',
    OTH_MCP_EXECUTOR_TOKEN: '',
  });

  console.log('\nA. MCP handshake');
  {
    const init = await client.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'othk-6-test', version: '1.0.0' },
    });
    ok(init.result && init.result.protocolVersion === mcp.PROTOCOL_VERSION, 'A1: initialize returns a protocol version');
    ok(init.result && init.result.serverInfo.name === 'oth-mcp', 'A2: serverInfo identifies the server');
    ok(init.result && init.result.capabilities && init.result.capabilities.tools !== undefined, 'A3: declares the tools capability');
    ok(/claim/i.test(init.result.instructions || ''), 'A4: instructions state the claim-not-fact rule to the client');
    client.notify('notifications/initialized');

    const pong = await client.call('ping', {});
    ok(pong.result !== undefined, 'A5: ping answers');
  }

  console.log('\nB. tool discovery');
  let toolNames = [];
  {
    const list = await client.call('tools/list', {});
    ok(list.result && Array.isArray(list.result.tools), 'B1: tools/list returns a tool array');
    toolNames = (list.result.tools || []).map((t) => t.name);
    ok(toolNames.length === mcp.TOOLS.length, 'B2: every registered tool is advertised (' + toolNames.length + ')');
    ok(toolNames.length <= 10, 'B3: the tool set stays small — ' + toolNames.length + ' tools');
    ok((list.result.tools || []).every((t) => t.inputSchema && t.inputSchema.type === 'object'),
      'B4: every tool declares an object input schema');
    ok((list.result.tools || []).every((t) => /\[owner: .+\]/.test(t.description)),
      'B5: every tool names the system that owns its data');
  }

  console.log('\nW. THE LOAD-BEARING TEST — the server exposes no write');
  {
    const writeish = toolNames.filter((n) => /create|write|update|delete|ingest|promote|establish|dispatch|approve|run_/i.test(n));
    ok(writeish.length === 0, 'W1: no tool name implies a write (' + (writeish.join(',') || 'none') + ')');

    const src = fs.readFileSync(MCP_SERVER, 'utf8');
    ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(src), 'W2: no mutating HTTP verb appears in the server source');
    ok(/method: 'GET'/.test(src), 'W3: the only upstream verb is GET');

    // Every tool must resolve to a declared upstream owner.
    ok(mcp.TOOLS.every((t) => typeof t.owner === 'string' && t.owner.length > 0),
      'W4: every tool declares an owner');

    // Reading must not change the store.
    const before = storeLib.openStore(seeded.root).stats();
    await client.call('tools/call', { name: 'knowledge_search', arguments: { query: 'loopback' } });
    const after = storeLib.openStore(seeded.root).stats();
    ok(before.records === after.records, 'W5: a tools/call changes no knowledge records');
  }

  console.log('\nC. end-to-end read through a real facade');
  {
    const search = await client.call('tools/call', { name: 'knowledge_search', arguments: { query: 'loopback' } });
    const text = search.result && search.result.content && search.result.content[0].text;
    ok(search.result && !search.result.isError, 'C1: knowledge_search succeeds end to end');
    ok(text && JSON.parse(text).hits !== undefined, 'C2: the payload carries real hits from the facade');

    const get = await client.call('tools/call', { name: 'knowledge_get', arguments: { id: seeded.claimId } });
    const got = get.result && JSON.parse(get.result.content[0].text);
    ok(got && got.record && got.record.id === seeded.claimId, 'C3: knowledge_get retrieves the record');
    ok(got && got.record.kind === 'claim', 'C4: a claim is returned as a claim, never as a fact');

    const prov = await client.call('tools/call', { name: 'knowledge_get', arguments: { id: seeded.claimId, include: 'provenance' } });
    ok(prov.result && !prov.result.isError, 'C5: knowledge_get include=provenance resolves');

    const ev = await client.call('tools/call', { name: 'knowledge_get', arguments: { id: seeded.claimId, include: 'evidence' } });
    ok(ev.result && !ev.result.isError, 'C6: knowledge_get include=evidence resolves');
  }

  console.log('\nD. bounded input and explicit refusals');
  {
    const noQ = await client.call('tools/call', { name: 'knowledge_search', arguments: {} });
    ok(noQ.result && noQ.result.isError && /required/i.test(noQ.result.content[0].text), 'D1: a missing required argument is an explicit error');

    const longQ = await client.call('tools/call', { name: 'knowledge_search', arguments: { query: 'x'.repeat(900) } });
    ok(longQ.result && longQ.result.isError, 'D2: an oversized query is refused');

    const badInc = await client.call('tools/call', { name: 'knowledge_get', arguments: { id: seeded.claimId, include: 'everything' } });
    ok(badInc.result && badInc.result.isError, 'D3: an unaccepted include value is refused');

    const badKind = await client.call('tools/call', { name: 'capability_registry', arguments: { kind: 'secrets' } });
    ok(badKind.result && badKind.result.isError, 'D4: an unaccepted registry kind is refused');

    const noTool = await client.call('tools/call', { name: 'definitely_not_a_tool', arguments: {} });
    ok(noTool.result && noTool.result.isError, 'D5: an unknown tool is an error, not a crash');

    const badMethod = await client.call('nonexistent/method', {});
    ok(badMethod.error && badMethod.error.code === -32601, 'D6: an unknown JSON-RPC method returns -32601');

    client.raw('{not json');
    const stillAlive = await client.call('ping', {});
    ok(stillAlive.result !== undefined, 'D7: malformed input does not kill the server');
  }

  console.log('\nE. unavailable upstreams fail closed and name the owner');
  {
    const proj = await client.call('tools/call', { name: 'project_context', arguments: {} });
    ok(proj.result && proj.result.isError, 'E1: an unconfigured upstream is an explicit error');
    ok(/UNCONFIGURED|UNREACHABLE/.test(proj.result.content[0].text), 'E2: the error names the failure mode');
    ok(/OTHMODE/i.test(proj.result.content[0].text), 'E3: the error names the owning system');

    const exec = await client.call('tools/call', { name: 'execution_status', arguments: {} });
    ok(exec.result && exec.result.isError && /Executor/i.test(exec.result.content[0].text),
      'E4: executor tools fail closed and name the executor');

    // A failing upstream must never be answered with an invented result.
    ok(!/\"tasks\"\s*:/.test(exec.result.content[0].text), 'E5: no invented payload is returned on failure');
  }

  console.log('\nF. secret hygiene');
  {
    const list = await client.call('tools/list', {});
    const blob = JSON.stringify(list.result);
    ok(blob.indexOf(TOKEN) === -1, 'F1: tool listings never contain an upstream token');

    const search = await client.call('tools/call', { name: 'knowledge_search', arguments: { query: 'loopback' } });
    ok(JSON.stringify(search.result).indexOf(TOKEN) === -1, 'F2: tool results never contain an upstream token');
    ok(client.stderr().indexOf(TOKEN) === -1, 'F3: nothing logs the token to stderr');
  }

  client.stop();
  await new Promise((r) => kb.close(r));

  console.log('');
  console.log('othk-6: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
