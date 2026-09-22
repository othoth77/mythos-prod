// =====================================================
// MYTHOS HADDAD — telemetry ingest + node-state suite
// tests/haddad-ingest-test.js
//
// Offline. Drives the REAL receiver over a real loopback socket with real
// Ed25519 signatures, and the real state machine with a controlled clock.
// No network, no fixtures pretending to be a node, nothing mocked that
// the production path would not do for itself.
//
// Covers: the sanitiser as an allow-list (a secret cannot be published),
// signature/registry/replay/skew/size refusals, fail-closed on a broken
// registry, every node state including the ones the owner named
// explicitly (runtime dead while the process lives -> DEGRADED; executing
// -> BUSY; missing heartbeat -> OFFLINE after the threshold), the
// published document's shape, history and transition records, and the
// browser's independent staleness override.
// =====================================================
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const BASE = path.join(REPO, 'projects', 'status-center', 'haddad');
const nodeState = require(path.join(BASE, 'lib', 'node-state.js'));
const ingest = require(path.join(BASE, 'bin', 'haddad-ingest.js'));

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; } else { failed++; console.error('[FAIL] ' + label); }
}
function eq(a, b, label) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.error('[FAIL] ' + label + '\n   got: ' + JSON.stringify(a) + '\n   want: ' + JSON.stringify(b));
  if (same) passed++; else failed++;
}
function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-' + tag + '-')); }

const TH = nodeState.DEFAULT_THRESHOLDS;

// ── a real node identity ───────────────────────────────────────────
function makeNode(id) {
  const kp = crypto.generateKeyPairSync('ed25519');
  return {
    id: id,
    priv: kp.privateKey,
    pubB64: crypto.createPublicKey(kp.privateKey).export({ format: 'der', type: 'spki' }).toString('base64')
  };
}

function envelope(over) {
  return Object.assign({
    schema: nodeState.SCHEMA,
    node: 'haddad',
    sent_at: new Date().toISOString(),
    seq: 1000,
    agent_version: '1.0.0',
    node_info: { hostname: 'haddad', os: 'Ubuntu 26.04.1 LTS', kernel: '7.0.0-31-generic', uptime_s: 3600 },
    health: { schema: 'mythos-haddad-health/1', generated_at: new Date().toISOString(), mode: 'quick', status: 'WARN', counts: { PASS: 15, WARN: 1, FAIL: 0 }, failing: [], warning: ['gpu_test'] },
    workers: [
      { id: 'executor', name: 'Executor worker', state: 'READY', detail: 'active' },
      { id: 'runtime', name: 'Qwen runtime', state: 'READY', detail: 'active' },
      { id: 'bridge', name: 'GitHub bridge', state: 'RUNNING', detail: 'active' }
    ],
    runtime: { state: 'READY', endpoint: 'http://127.0.0.1:8600/v1', model: 'qwen2.5-7b-instruct-q4_k_m', context: 8192, gpu_layers: 27, gpu_layers_total: 29, vram_model_mib: 4920 },
    gpu: { model: 'NVIDIA GeForce GTX 1660 SUPER', vram_total_mib: 6144, vram_used_mib: null, utilization_pct: null },
    resources: { cpus: 6, load1: 0.4, mem_used_mib: 3800, mem_total_mib: 7680, swap_used_mib: 210, swap_total_mib: 1024, disk_used_gb: 17, disk_total_gb: 98, disk_used_pct: 17.3 },
    current_task: null,
    task_counts: { COMPLETED: 4 },
    events: [],
    incidents: [],
    repo: { head: 'd2fa93ac', branch: 'main', dirty: false }
  }, over || {});
}

function post(port, node, body, headerOver) {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  const sig = crypto.sign(null, raw, node.priv);
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'Content-Length': raw.length,
    'X-Mythos-Node': node.id,
    'X-Mythos-Signature': sig.toString('base64')
  }, headerOver || {});
  return new Promise(function (resolve, reject) {
    const req = http.request({ host: '127.0.0.1', port: port, path: '/ingest', method: 'POST', headers: headers }, function (res) {
      let out = '';
      res.on('data', function (c) { out += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: out }); });
    });
    req.on('error', reject);
    req.end(raw);
  });
}
function get(port, p) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: p }, function (res) {
      let out = '';
      res.on('data', function (c) { out += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: out }); });
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────
console.log('§1 sanitise is an allow-list — a node cannot publish a secret');
{
  const dirty = envelope({
    api_key: 'sk-live-should-never-appear',
    runtime: { state: 'READY', api_key: 'secret', endpoint: 'http://127.0.0.1:8600/v1', authorization: 'Bearer abc' },
    gpu: { model: 'GTX 1660 SUPER', token: 'ghp_deadbeef' },
    node_info: { hostname: 'haddad', password: 'hunter2' },
    current_task: { task_id: 'gh-issue-379', bearer: 'nope', project: 'mythos-prod' }
  });
  const clean = nodeState.sanitize(dirty);
  const text = JSON.stringify(clean);
  ok(text.indexOf('sk-live-should-never-appear') === -1, 'a top-level secret is dropped');
  ok(text.indexOf('hunter2') === -1, 'a nested password is dropped');
  ok(text.indexOf('ghp_deadbeef') === -1, 'a nested token is dropped');
  ok(text.indexOf('Bearer abc') === -1, 'a nested authorization header is dropped');
  ok(clean.runtime.api_key === undefined, 'unknown runtime keys do not survive');
  ok(clean.current_task.bearer === undefined, 'unknown task keys do not survive');
  ok(clean.runtime.endpoint === 'http://127.0.0.1:8600/v1', 'allow-listed values do survive');
  ok(clean.current_task.project === 'mythos-prod', 'allow-listed task values do survive');

  // A field renamed to an allowed key still passes through the coercer.
  const typed = nodeState.sanitize(envelope({ resources: { mem_used_mib: 'not-a-number', load1: {} } }));
  eq(typed.resources.mem_used_mib, null, 'a non-numeric metric becomes null, never a string in a number slot');
  eq(typed.resources.load1, null, 'an object in a number slot becomes null');

  // Control characters cannot reach a terminal, a JSONL line, or the DOM.
  const nasty = nodeState.sanitize(envelope({ node_info: { hostname: 'had\u0000dad\u001b[31m\nevil' } }));
  ok(!/[\u0000-\u001f]/.test(nasty.node_info.hostname), 'control characters are stripped from strings');
}

console.log('§2 state derivation — precedence and the owner\'s named cases');
{
  const now = Date.parse('2026-09-22T12:00:00Z');
  function snap(over) {
    return Object.assign(nodeState.sanitize(envelope()), { received_at: new Date(now - 5000).toISOString() }, over || {});
  }
  eq(nodeState.deriveState(null, now).state, 'UNKNOWN', 'never reported -> UNKNOWN');
  eq(nodeState.deriveState({}, now).state, 'UNKNOWN', 'no received_at -> UNKNOWN');
  eq(nodeState.deriveState(snap(), now).state, 'ONLINE', 'fresh, healthy, idle -> ONLINE');

  // The owner's case: the process lives but the AI runtime is dead.
  const runtimeDead = snap({ workers: [{ id: 'runtime', name: 'Qwen runtime', state: 'STOPPED', detail: 'inactive' }] });
  eq(nodeState.deriveState(runtimeDead, now).state, 'DEGRADED', 'worker STOPPED -> DEGRADED, not ONLINE');
  ok(/runtime/.test(nodeState.deriveState(runtimeDead, now).reason), 'the reason names the stopped worker');

  const workerDegraded = snap({ workers: [{ id: 'runtime', name: 'Qwen runtime', state: 'DEGRADED', detail: 'no answer' }] });
  eq(nodeState.deriveState(workerDegraded, now).state, 'DEGRADED', 'worker DEGRADED -> DEGRADED');

  // The owner's case: online and executing.
  const busy = snap({ current_task: { task_id: 'gh-issue-379', effective: 'RUNNING' } });
  eq(nodeState.deriveState(busy, now).state, 'BUSY', 'a RUNNING task -> BUSY');

  const waiting = snap({ task_counts: { QUEUED: 2 } });
  eq(nodeState.deriveState(waiting, now).state, 'WAITING', 'queued work, nothing running -> WAITING');
  const retry = snap({ task_counts: { WAITING_RETRY: 1 } });
  eq(nodeState.deriveState(retry, now).state, 'WAITING', 'WAITING_RETRY counts as waiting');
  const quota = snap({ task_counts: { WAITING_FOR_QUOTA: 1 } });
  eq(nodeState.deriveState(quota, now).state, 'WAITING', 'WAITING_FOR_QUOTA counts as waiting');

  // A completed/failed task must not make the node look busy.
  const doneTask = snap({ current_task: { task_id: 'gh-issue-379', effective: 'COMPLETED' }, task_counts: { COMPLETED: 1 } });
  eq(nodeState.deriveState(doneTask, now).state, 'ONLINE', 'a COMPLETED task does not make the node BUSY');
  const failedTask = snap({ current_task: { task_id: 'x', effective: 'FAILED' }, task_counts: { FAILED: 1 } });
  eq(nodeState.deriveState(failedTask, now).state, 'ONLINE', 'a FAILED task alone does not degrade the node');
  const approval = snap({ current_task: { task_id: 'x', effective: 'COMPLETED', review: 'HUMAN APPROVAL REQUIRED' }, task_counts: { COMPLETED: 1 } });
  eq(nodeState.deriveState(approval, now).state, 'ONLINE', 'awaiting human approval is a task state, not a node fault');

  // A health FAIL beats a healthy-looking worker list.
  const unhealthy = snap({ health: { counts: { PASS: 10, WARN: 0, FAIL: 2 }, failing: ['gpu_test', 'ssh'] } });
  eq(nodeState.deriveState(unhealthy, now).state, 'DEGRADED', 'health FAIL -> DEGRADED');
  ok(/gpu_test/.test(nodeState.deriveState(unhealthy, now).reason), 'the reason names the failing checks');

  // The documented WARN+quick case must NOT degrade the node.
  const quickWarn = snap({ health: { counts: { PASS: 15, WARN: 1, FAIL: 0 }, failing: [], warning: ['gpu_test'] } });
  eq(nodeState.deriveState(quickWarn, now).state, 'ONLINE', 'WARN with zero FAIL stays ONLINE (the --quick GPU skip)');

  // Staleness beats everything, including a node that claimed to be fine.
  const late = snap({ received_at: new Date(now - TH.degraded_after_s * 1000 - 1000).toISOString() });
  eq(nodeState.deriveState(late, now).state, 'DEGRADED', 'a late heartbeat -> DEGRADED');
  const gone = snap({ received_at: new Date(now - TH.offline_after_s * 1000 - 1000).toISOString() });
  eq(nodeState.deriveState(gone, now).state, 'OFFLINE', 'a missing heartbeat -> OFFLINE');
  const goneBusy = snap({ received_at: new Date(now - 600000).toISOString(), current_task: { task_id: 'x', effective: 'RUNNING' } });
  eq(nodeState.deriveState(goneBusy, now).state, 'OFFLINE', 'OFFLINE outranks BUSY — a dead node is never shown working');

  // Exactly at the threshold is OFFLINE, not one second of ambiguity.
  const exact = snap({ received_at: new Date(now - TH.offline_after_s * 1000).toISOString() });
  eq(nodeState.deriveState(exact, now).state, 'OFFLINE', 'the offline threshold is inclusive');

  eq(nodeState.rank('OFFLINE') < nodeState.rank('ONLINE'), true, 'worst state sorts first');
}

console.log('§3 the receiver — signature, registry and replay');
{
  const out = tmpDir('ingest');
  const nodesFile = path.join(out, 'nodes.json');
  const good = makeNode('haddad');
  const stranger = makeNode('haddad');   // same id, different key
  fs.writeFileSync(nodesFile, JSON.stringify({
    nodes: [{ id: 'haddad', name: 'MYTHOS HADDAD', subtitle: 'AI COMPUTE NODE', enabled: true, public_key: good.pubB64 }]
  }));

  const server = ingest.createServer({ nodesFile: nodesFile, outDir: out });
  const done = new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', async function () {
      const port = server.address().port;
      try {
        let r = await get(port, '/health');
        eq(r.status, 200, '/health answers 200');
        ok(JSON.parse(r.body).ok === true, '/health reports ok');

        r = await get(port, '/ingest');
        eq(r.status, 405, 'GET /ingest is refused — the receiver has no read path for telemetry');
        r = await get(port, '/anything');
        eq(r.status, 404, 'no other route exists');

        r = await post(port, good, envelope({ seq: 1 }));
        eq(r.status, 202, 'a correctly signed envelope is accepted');
        eq(JSON.parse(r.body).state, 'ONLINE', 'the receiver answers with the derived state');

        r = await post(port, stranger, envelope({ seq: 2 }));
        eq(r.status, 401, 'a valid signature from the WRONG key is refused');

        r = await post(port, good, envelope({ seq: 2 }), { 'X-Mythos-Signature': 'bm90LWEtc2lnbmF0dXJl' });
        eq(r.status, 401, 'a malformed signature is refused');
        r = await post(port, good, envelope({ seq: 2 }), { 'X-Mythos-Signature': '' });
        eq(r.status, 401, 'an empty signature is refused');
        r = await post(port, good, envelope({ seq: 2 }), { 'X-Mythos-Node': 'nosuchnode' });
        eq(r.status, 401, 'an unregistered node id is refused');
        r = await post(port, good, envelope({ seq: 2 }), { 'X-Mythos-Node': '../../etc/passwd' });
        eq(r.status, 401, 'a traversal-shaped node id is refused before anything touches the filesystem');

        // The signature covers the body, so the body's node must match the header.
        r = await post(port, good, envelope({ seq: 2, node: 'someone-else' }));
        eq(r.status, 400, 'a body claiming a different node than the header is refused');

        r = await post(port, good, envelope({ seq: 1 }));
        eq(r.status, 409, 'a replayed sequence is refused');
        r = await post(port, good, envelope({ seq: 0 }));
        eq(r.status, 409, 'a lower sequence is refused');
        r = await post(port, good, envelope({ seq: 2 }));
        eq(r.status, 202, 'a higher sequence is accepted');

        r = await post(port, good, envelope({ seq: 3, sent_at: new Date(Date.now() - 3600000).toISOString() }));
        eq(r.status, 400, 'a stale clock is refused');
        r = await post(port, good, envelope({ seq: 3, sent_at: new Date(Date.now() + 3600000).toISOString() }));
        eq(r.status, 400, 'a future clock is refused');
        r = await post(port, good, envelope({ seq: 3, sent_at: 'not a date' }));
        eq(r.status, 400, 'an unparseable timestamp is refused');

        r = await post(port, good, envelope({ seq: 3, schema: 'something-else/9' }));
        eq(r.status, 400, 'a foreign schema is refused');
        r = await post(port, good, '{ this is not json');
        eq(r.status, 400, 'malformed JSON is refused');
        r = await post(port, good, envelope({ seq: null }));
        eq(r.status, 400, 'a missing sequence is refused');

        // Oversize: refused before the body is buffered.
        const huge = envelope({ seq: 4, events: [] });
        huge.events = Array.from({ length: 4000 }, function (_, i) {
          return { ts: new Date().toISOString(), event: 'pad', detail: 'x'.repeat(200), task_id: 't' + i };
        });
        r = await post(port, good, huge);
        eq(r.status, 413, 'an oversized body is refused');

        // Fail closed: a broken registry accepts nothing.
        fs.writeFileSync(nodesFile, '{ broken');
        r = await post(port, good, envelope({ seq: 5 }));
        eq(r.status, 503, 'an unreadable registry fails CLOSED');

        // Re-reading the registry means a disable takes effect with no restart.
        fs.writeFileSync(nodesFile, JSON.stringify({
          nodes: [{ id: 'haddad', enabled: false, public_key: good.pubB64 }]
        }));
        r = await post(port, good, envelope({ seq: 5 }));
        eq(r.status, 401, 'a disabled node is refused immediately, without a restart');

        fs.writeFileSync(nodesFile, JSON.stringify({
          nodes: [{ id: 'haddad', name: 'MYTHOS HADDAD', subtitle: 'AI COMPUTE NODE', enabled: true, public_key: good.pubB64 }]
        }));

        // An RSA key must not register: the receiver verifies ed25519 only.
        const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        fs.writeFileSync(path.join(out, 'rsa.json'), JSON.stringify({
          nodes: [{ id: 'haddad', enabled: true, public_key: rsa.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') }]
        }));
        eq(Object.keys(ingest.loadNodes(path.join(out, 'rsa.json'))).length, 0, 'a non-ed25519 key registers nothing');
        eq(Object.keys(ingest.loadNodes(path.join(out, 'nodes.json'))).length, 1, 'a valid ed25519 key registers');

        // ── the published document ────────────────────────────────
        r = await post(port, good, envelope({ seq: 10, current_task: { task_id: 'gh-issue-379', effective: 'RUNNING', project: 'mythos-prod' } }));
        eq(r.status, 202, 'a busy envelope is accepted');
        const doc = JSON.parse(fs.readFileSync(path.join(out, 'haddad-node.json'), 'utf8'));
        eq(doc.schema, nodeState.PUBLISHED_SCHEMA, 'the published schema is versioned');
        eq(doc.nodes.length, 1, 'one node is published');
        eq(doc.nodes[0].state, 'BUSY', 'the published state reflects the running task');
        eq(doc.nodes[0].node, 'haddad', 'the node id is published');
        eq(doc.nodes[0].display_name, 'MYTHOS HADDAD', 'the registry display name is used, not one the node chose');
        ok(typeof doc.nodes[0].received_at === 'string', 'the receipt time is published for the browser to re-derive from');
        ok(doc.thresholds && doc.thresholds.offline_after_s === TH.offline_after_s, 'thresholds are published so the browser applies the same rule');
        eq(doc.summary.BUSY, 1, 'the summary counts the node');
        ok(Array.isArray(doc.nodes), 'the document is fleet-shaped from version 1');

        // The display name is the VPS's, so a node cannot rename itself
        // into something misleading on the page.
        r = await post(port, good, envelope({ seq: 11 }));
        const doc2 = JSON.parse(fs.readFileSync(path.join(out, 'haddad-node.json'), 'utf8'));
        eq(doc2.nodes[0].display_name, 'MYTHOS HADDAD', 'the node cannot set its own display name');
        eq(doc2.nodes[0].state, 'ONLINE', 'the node returns to ONLINE when the task ends');

        // ── history + transitions ─────────────────────────────────
        const month = new Date().toISOString().slice(0, 7);
        const hist = fs.readFileSync(path.join(out, 'haddad-history', month + '.jsonl'), 'utf8').trim().split('\n');
        ok(hist.length >= 2, 'history rows are appended');
        ok(hist.length < 12, 'history is DOWNSAMPLED — far fewer rows than the beats just sent');
        ok(hist.every(function (l) { return ['state_change', 'interval'].indexOf(JSON.parse(l).reason) !== -1; }),
          'every history row says why it was kept');
        ok(hist.some(function (l) { return JSON.parse(l).reason === 'state_change'; }),
          'a state change is ALWAYS kept, whatever the interval says');
        const lastHist = JSON.parse(hist[hist.length - 1]);
        eq(lastHist.node, 'haddad', 'history rows identify the node');
        ok(typeof lastHist.seq === 'number', 'history rows carry the sequence');
        ok(fs.readFileSync(path.join(out, 'haddad-history', month + '.jsonl'), 'utf8').indexOf('hunter2') === -1,
          'no secret can reach the history file');

        const trans = fs.readFileSync(path.join(out, 'haddad-history', 'transitions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        ok(trans.some(function (t) { return t.from === 'ONLINE' && t.to === 'BUSY'; }), 'a state change is recorded once, when it happens');
        ok(trans.some(function (t) { return t.from === 'BUSY' && t.to === 'ONLINE'; }), 'the return transition is recorded too');
        ok(trans.every(function (t) { return typeof t.reason === 'string' && t.reason.length; }), 'every transition names its reason');

        // ── no secret survives the full round trip ────────────────
        r = await post(port, good, envelope({ seq: 20, api_key: 'sk-live-leak', runtime: { state: 'READY', token: 'ghp_leak' } }));
        eq(r.status, 202, 'an envelope carrying extra keys is still accepted');
        const published = fs.readFileSync(path.join(out, 'haddad-node.json'), 'utf8');
        ok(published.indexOf('sk-live-leak') === -1, 'the published snapshot carries no injected secret');
        ok(published.indexOf('ghp_leak') === -1, 'the published snapshot carries no injected token');
      } catch (e) {
        failed++; console.error('[FAIL] §3 threw: ' + e.stack);
      } finally {
        server.close(resolve);
      }
    });
  });
  module.exports = done.then(function () { report(out); });
}

console.log('§4 decay — a node that stops sending stops being ONLINE in the file');
{
  // The receiver republishes on a tick; publish() is the function that
  // tick calls, so driving it with a moved clock proves the same path.
  const out = tmpDir('decay');
  const store = {
    nodes: {
      haddad: Object.assign(nodeState.sanitize(envelope()), {
        node: 'haddad', received_at: new Date(Date.now() - 600000).toISOString(), state: 'ONLINE'
      })
    },
    seq: { haddad: 1 }
  };
  const doc = ingest.publish(store, out, Date.now());
  eq(doc.nodes[0].state, 'OFFLINE', 'a stored ONLINE decays to OFFLINE when the clock moves on');
  ok(/no heartbeat/.test(doc.nodes[0].state_reason), 'the decayed state explains itself');
}

console.log('§5 the browser applies the same rule independently');
{
  // assets/haddad.js must not simply render the stored state. Reading its
  // source is how this suite asserts a browser behaviour offline; the
  // real page is exercised in the E2E documented in docs/TELEMETRY.md.
  const src = fs.readFileSync(path.join(REPO, 'sites', 'status.mythosprod.xyz', 'assets', 'haddad.js'), 'utf8');
  ok(/function liveState/.test(src), 'the page derives a live state of its own');
  ok(/received_at/.test(src) && /offline_after_s/.test(src), 'it derives that state from the receipt time and the published threshold');
  ok(/doc\.thresholds/.test(src) || /doc &&\s*doc\.thresholds/.test(src), 'it prefers the thresholds the receiver published');

  // Security boundaries, same class the STC-1 suite asserts for app.js.
  // Comments are stripped first: this must assert what the code DOES, not
  // what its header says it avoids.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(code.indexOf('innerHTML') === -1, 'no innerHTML');
  ok(code.indexOf('outerHTML') === -1, 'no outerHTML');
  ok(code.indexOf('insertAdjacentHTML') === -1, 'no insertAdjacentHTML');
  ok(code.indexOf('document.write') === -1, 'no document.write');
  ok(!/\beval\s*\(/.test(code), 'no eval');
  ok(!/new\s+Function\s*\(/.test(code), 'no Function constructor');
  // The only absolute URLs the surface may contain: the SVG namespace (not
  // a request), and a GitHub issue link the reader clicks deliberately.
  const urls = (code.match(/https?:\/\/[^'"\s)]+/g) || []);
  const strayUrls = urls.filter(function (u) {
    return u.indexOf('http://www.w3.org/2000/svg') !== 0 &&
           u.indexOf('https://github.com/othoth77/mythos-prod/issues/') !== 0;
  });
  eq(strayUrls, [], 'the surface contains no external request target');
  ok(/fetch\(/.test(code) && (code.match(/fetch\(/g) || []).length === 1, 'exactly one fetch — the same-origin snapshot');
  ok(!/XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/.test(code),
    'no second transport: the page cannot talk to a node by any route');

  const consoleHtml = fs.readFileSync(path.join(REPO, 'sites', 'status.mythosprod.xyz', 'haddad', 'index.html'), 'utf8');
  ok(!/<script(?![^>]*\bsrc=)/.test(consoleHtml), 'the console page has no inline script (CSP script-src self)');
  ok(/assets\/haddad\.js/.test(consoleHtml), 'the console loads the shared surface');
  ok(/noindex/.test(consoleHtml), 'the console is not indexable');

  const css = fs.readFileSync(path.join(REPO, 'sites', 'status.mythosprod.xyz', 'assets', 'app.css'), 'utf8');
  ok(/\.kv-grid\s*\{[^}]*grid-template-columns:\s*1fr/.test(css), 'the console grid is single-column by default (mobile first, no sideways scroll)');
  ok(/@media \(min-width: 720px\)[^@]*\.kv-grid/.test(css), 'it widens at a tablet breakpoint');
  ok(/@media \(min-width: 1100px\)[^@]*\.kv-grid/.test(css), 'and again at a desktop breakpoint');
  ok(/\.na\s*\{/.test(css), 'N/A has its own de-emphasised style, so absence reads as absence');
  ok(!/#[0-9a-fA-F]{3,6}\b/.test(css.split('/* ── AI nodes')[1] || ''), 'the new styles use tokens only — no raw colour');
}

console.log('§6 the receiver cannot reach a node');
{
  const src = fs.readFileSync(path.join(BASE, 'bin', 'haddad-ingest.js'), 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  ok(!/child_process/.test(code), 'the receiver cannot spawn a process');
  ok(!/https?\.request|https?\.get|fetch\(/.test(code), 'the receiver never originates an outbound request');
  ok(!/\.connect\(/.test(code), 'the receiver opens no outbound socket');
  ok(/createServer/.test(code), 'it only listens');

  const unit = fs.readFileSync(path.join(BASE, 'systemd', 'mythos-haddad-ingest.service'), 'utf8');
  ok(/IPAddressDeny=any/.test(unit), 'the unit denies all addresses by default');
  ok(/IPAddressAllow=localhost/.test(unit), 'and allows only loopback');
  ok(/--host 127\.0\.0\.1/.test(unit), 'the receiver binds loopback only — nginx is the only way in');
  ok(/ProtectSystem=strict/.test(unit), 'the filesystem is read-only apart from its own output');
  ok(/ReadWritePaths=\/var\/www\/status\.mythosprod\.xyz\/data/.test(unit), 'it can write exactly one directory');
  ok(/User=mythos-ingest/.test(unit), 'it runs as its own unprivileged user, not www-data or deploy');
  ok(/NoNewPrivileges=true/.test(unit), 'it cannot gain privileges');
  ok(/MemoryMax=/.test(unit), 'it has an explicit memory ceiling (this host has been OOM-killed before)');
}

console.log('\u00a77b deregistering a node removes it from the page');
{
  // A disabled node must DISAPPEAR, not linger as a permanent OFFLINE row
  // that nobody can clear — but an unreadable registry must never blank
  // the surface, which would look exactly like every node going away.
  const out = tmpDir('dereg');
  const nodesFile = path.join(out, 'nodes.json');
  const n1 = makeNode('haddad');
  fs.writeFileSync(nodesFile, JSON.stringify({ nodes: [{ id: 'haddad', public_key: n1.pubB64 }] }));

  const store = {
    nodes: { haddad: Object.assign(nodeState.sanitize(envelope()), { node: 'haddad', received_at: new Date().toISOString() }) },
    seq: { haddad: 1 }, lastHistory: {}
  };
  const known = ingest.loadNodes(nodesFile);
  eq(ingest.publish(store, out, Date.now(), known).nodes.length, 1, 'a registered node is published');
  eq(ingest.publish(store, out, Date.now(), {}).nodes.length, 0, 'a DEREGISTERED node is removed from the document');
  eq(ingest.publish(store, out, Date.now(), null).nodes.length, 1,
    'an UNREADABLE registry publishes what is held — it never blanks the surface');

  const src = fs.readFileSync(path.join(BASE, 'bin', 'haddad-ingest.js'), 'utf8');
  ok(/bootKnown && !bootKnown\[n\.node\]/.test(src),
    'a node deregistered while the service was down does not come back on restart');
  fs.rmSync(out, { recursive: true, force: true });
}

console.log('§7 history is bounded — an unattended node cannot fill the disk');
{
  const th = nodeState.DEFAULT_THRESHOLDS;
  ok(th.history_interval_s >= 30, 'history is downsampled to at most one row per 30 s');
  ok(th.history_interval_s > th.heartbeat_s, 'the history interval is coarser than the heartbeat');
  ok(th.history_keep_months >= 1 && th.history_keep_months <= 24, 'a retention window is defined and sane');

  const src = fs.readFileSync(path.join(BASE, 'bin', 'haddad-ingest.js'), 'utf8');
  ok(/function sweepHistory/.test(src), 'old monthly files are swept');
  ok(/history_keep_months/.test(src), 'the sweep uses the declared retention window');
  ok(/transitions\.jsonl/.test(src) && !/unlink[^\n]*transitions/.test(src),
    'the transition record is never swept — it is the incident history and it does not grow');

  // A history row must stay small enough that the bound actually holds.
  const row = JSON.stringify({
    at: new Date().toISOString(), node: 'haddad', seq: 1758569330, state: 'ONLINE', reason: 'interval',
    health: { PASS: 15, WARN: 1, FAIL: 0 }, runtime_state: 'READY', gpu_vram_total_mib: 6144,
    mem_used_mib: 3800, load1: 0.42, task: 'gh-issue-379', task_counts: { COMPLETED: 12, FAILED: 2 }
  });
  const perMonth = row.length * (30 * 24 * 60 * 60 / th.history_interval_s) / 1048576;
  ok(perMonth < 40, 'one node costs under 40 MB of history a month (measured: ' + perMonth.toFixed(1) + ' MB)');
  console.log('   measured history cost: ' + row.length + ' B/row, ' + perMonth.toFixed(1) + ' MB per node per month');

  // A failed history append must not cost the beat that was published.
  ok(/history append failed/.test(src), 'a history write failure is logged, not fatal');
  ok(src.indexOf("return reject(res, 500, 'publish_failed')") !== -1, 'a SNAPSHOT write failure still is fatal');
}

function report(dir) {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  if (failed) process.exitCode = 1;
}
