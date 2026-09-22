#!/usr/bin/env node
'use strict';

// =====================================================
// MYTHOS HADDAD — telemetry ingest receiver
// projects/status-center/haddad/bin/haddad-ingest.js
//
// The ONE connector this feature adds. Everything else it touches already
// existed: the Status Center docroot, its nginx vhost, its TLS, its
// no-cache /data/ rule, and the node's own health/executor/runtime data.
//
// WHY A RECEIVER AND NOT A PROBE. The Status Center's STC-2 monitor polls
// its targets. It cannot poll Haddad: there is no VPS -> Haddad route (no
// Tailscale on the VPS) and no VPS -> Haddad SSH credential — registering
// one is a pending owner decision (projects/mythos-haddad/STATUS.md).
// Haddad -> VPS HTTPS does work. So the node PUSHES and the VPS receives.
// That is also the safer direction: Haddad opens no port, publishes no
// endpoint, and needs no inbound rule.
//
// TRUST. Each node signs its body with an Ed25519 key it generated on
// itself and never transmits. The VPS holds only public keys, so there is
// no shared secret to leak, rotate or copy between machines. Replay is
// refused by a strictly increasing sequence number per node; a stale
// clock is refused by a bounded skew.
//
// AUTHORITY. Read-only by construction: the only verbs are GET /health
// and POST /ingest. There is no route that reaches Haddad, runs a
// command, or changes anything on the node. Output is three files in one
// directory and nothing else.
//
// Usage:
//   haddad-ingest.js --nodes <nodes.json> --out <dir> [--port 8190] [--host 127.0.0.1]
// Exit codes: 0 clean shutdown, 1 usage/environment.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var crypto = require('crypto');

var st = require('../lib/node-state.js');

var INGEST_VERSION = '1.0.0';
var TH = st.DEFAULT_THRESHOLDS;

function argv(name, dflt) {
  var i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function nowIso() { return new Date().toISOString(); }

// Logging goes to stdout for the journal. It never prints a body, a key,
// a header or a signature — only the decision and the reason.
function log(level, msg, fields) {
  var line = { ts: nowIso(), level: level, msg: msg };
  Object.keys(fields || {}).forEach(function (k) { line[k] = fields[k]; });
  process.stdout.write(JSON.stringify(line) + '\n');
}

// ── node registry ──────────────────────────────────────────────────
// { "nodes": [ { "id": "haddad", "name": "...", "public_key": "<base64 SPKI>",
//                "subtitle": "AI COMPUTE NODE", "enabled": true } ] }
//
// Re-read on every request (cheap, one small file) so registering a new
// node or rotating a key needs no restart — and so a node that is removed
// stops being accepted immediately.
function loadNodes(file) {
  var doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  var map = {};
  (doc.nodes || []).forEach(function (n) {
    if (!n || n.enabled === false) return;
    if (!st.NODE_ID_RE.test(String(n.id || ''))) return;
    if (typeof n.public_key !== 'string' || !n.public_key) return;
    var key;
    try {
      key = crypto.createPublicKey({
        key: Buffer.from(n.public_key, 'base64'),
        format: 'der',
        type: 'spki'
      });
    } catch (e) { return; }           // an unusable key registers nothing
    if (key.asymmetricKeyType !== 'ed25519') return;
    map[n.id] = {
      id: n.id,
      name: String(n.name || n.id).slice(0, 80),
      subtitle: String(n.subtitle || '').slice(0, 60),
      key: key
    };
  });
  return map;
}

// ── persistence (the STC-2 idiom: atomic snapshot + append-only history) ──
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content, { mode: 0o644 });
  fs.renameSync(tmp, file);
}
function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o644 });
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// ── the published document ─────────────────────────────────────────
// Shaped as a FLEET from the first version (an array of nodes, not a
// single object) so adding haddad-02 later is registration, not a schema
// migration. No scheduler, no routing, no second node is implemented here.
// `known` is the set of currently registered node ids, or null when the
// registry could not be read. A node that has been deregistered must
// DISAPPEAR from the page, not linger as a permanent OFFLINE row — but a
// registry that is temporarily unreadable must never blank the surface,
// so null means "publish everything held".
function publish(store, outDir, now, known) {
  var nodes = Object.keys(store.nodes).filter(function (id) {
    return !known || known[id];
  }).sort().map(function (id) {
    var snap = store.nodes[id];
    var d = st.deriveState(snap, now, TH);
    var out = JSON.parse(JSON.stringify(snap));
    out.state = d.state;
    out.state_reason = d.reason;
    out.age_s = d.age_s;
    return out;
  }).sort(function (a, b) { return st.rank(a.state) - st.rank(b.state); });

  var summary = {};
  st.STATES.forEach(function (s) { summary[s] = 0; });
  nodes.forEach(function (n) { summary[n.state]++; });

  var doc = {
    schema: st.PUBLISHED_SCHEMA,
    ingest_version: INGEST_VERSION,
    generated_at: new Date(now).toISOString(),
    host: os.hostname(),
    // The browser MUST re-derive staleness from these numbers: this file
    // keeps its last value if the receiver itself dies, and a frozen
    // ONLINE would be a lie. assets/haddad.js does exactly that.
    thresholds: {
      heartbeat_s: TH.heartbeat_s,
      degraded_after_s: TH.degraded_after_s,
      offline_after_s: TH.offline_after_s
    },
    note: 'pushed by each node\'s telemetry agent over HTTPS; the VPS never connects to a node. ' +
      'A stale generated_at means this receiver is down — recompute state from last_seen, never trust the stored state.',
    summary: summary,
    nodes: nodes
  };
  atomicWrite(path.join(outDir, 'haddad-node.json'), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}

// State transitions are recorded once, when they happen, exactly like the
// STC-2 alerts file. This is what the console's incident list reads.
function recordTransition(outDir, id, from, to, reason, at) {
  appendJsonl(path.join(outDir, 'haddad-history', 'transitions.jsonl'),
    { at: at, node: id, from: from, to: to, reason: reason });
}

// Retention. Monthly history files older than history_keep_months are
// removed, so an unattended node cannot fill a disk that has been under
// pressure before. transitions.jsonl is never swept: it is one line per
// real state change, it is the incident record, and it does not grow.
var lastSweep = 0;
function sweepHistory(outDir, now) {
  if (now - lastSweep < 3600000) return;          // at most hourly
  lastSweep = now;
  var dir = path.join(outDir, 'haddad-history');
  var cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - TH.history_keep_months);
  var oldest = cutoff.toISOString().slice(0, 7);
  var names;
  try { names = fs.readdirSync(dir); } catch (e) { return; }
  names.forEach(function (name) {
    var m = /^(\d{4}-\d{2})\.jsonl$/.exec(name);
    if (!m || m[1] >= oldest) return;
    try {
      fs.unlinkSync(path.join(dir, name));
      log('info', 'history month retired', { file: name, keep_months: TH.history_keep_months });
    } catch (e) { log('error', 'history sweep failed', { file: name, reason: String(e.message).slice(0, 120) }); }
  });
}

// ── the server ─────────────────────────────────────────────────────
function createServer(opts) {
  var nodesFile = opts.nodesFile;
  var outDir = opts.outDir;
  var clock = opts.clock || Date.now;
  // In-memory current state per node, rebuilt from the published file on
  // start so a restart does not make every node briefly UNKNOWN.
  var store = { nodes: {}, seq: {}, lastHistory: {} };
  var boot = readJson(path.join(outDir, 'haddad-node.json'));
  var bootKnown = null;
  try { bootKnown = loadNodes(nodesFile); } catch (e) { bootKnown = null; }
  if (boot && Array.isArray(boot.nodes)) {
    boot.nodes.forEach(function (n) {
      if (!n || !st.NODE_ID_RE.test(String(n.node || ''))) return;
      // A node deregistered while this service was down does not come back.
      if (bootKnown && !bootKnown[n.node]) return;
      store.nodes[n.node] = n;
      if (typeof n.seq === 'number') store.seq[n.node] = n.seq;
      // The replay guard must not be relaxed by a restart: keep the
      // sequence AND the receipt time the published document recorded.
    });
  }

  function reject(res, code, reason) {
    // The body never explains more than the class of refusal: an attacker
    // learns nothing about which node ids or keys exist.
    var body = JSON.stringify({ error: reason }) + '\n';
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }

  var server = http.createServer(function (req, res) {
    var url = String(req.url || '').split('?')[0];

    if (req.method === 'GET' && url === '/health') {
      var now = clock();
      var body = JSON.stringify({
        ok: true,
        ingest_version: INGEST_VERSION,
        generated_at: new Date(now).toISOString(),
        nodes: Object.keys(store.nodes).length
      }) + '\n';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }

    if (url !== '/ingest') return reject(res, 404, 'not_found');
    // Read-only service: no other verb exists, and nothing here can ever
    // reach back to a node.
    if (req.method !== 'POST') return reject(res, 405, 'method_not_allowed');

    var declared = parseInt(req.headers['content-length'] || '0', 10);
    if (isFinite(declared) && declared > TH.max_body_bytes) {
      return reject(res, 413, 'too_large');
    }

    var chunks = [];
    var size = 0;
    var aborted = false;
    req.on('data', function (d) {
      if (aborted) return;
      size += d.length;
      if (size > TH.max_body_bytes) {
        aborted = true;
        reject(res, 413, 'too_large');
        req.destroy();
        return;
      }
      chunks.push(d);
    });
    req.on('error', function () { aborted = true; });
    req.on('end', function () {
      if (aborted) return;
      var raw = Buffer.concat(chunks);
      var now = clock();

      var nodeId = String(req.headers['x-mythos-node'] || '');
      var sigB64 = String(req.headers['x-mythos-signature'] || '');
      if (!st.NODE_ID_RE.test(nodeId)) {
        log('warn', 'ingest refused', { reason: 'bad_node_header' });
        return reject(res, 401, 'unauthorized');
      }

      var registry;
      try { registry = loadNodes(nodesFile); }
      catch (e) {
        // Fail CLOSED: an unreadable registry must not accept anything.
        log('error', 'node registry unreadable', { reason: String(e.message).slice(0, 120) });
        return reject(res, 503, 'registry_unavailable');
      }
      var node = registry[nodeId];
      if (!node) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'unknown_node' });
        return reject(res, 401, 'unauthorized');
      }

      var sig;
      try { sig = Buffer.from(sigB64, 'base64'); } catch (e) { sig = null; }
      // Ed25519 signatures are exactly 64 bytes; Buffer.from ignores junk
      // silently, so the length check is what makes a malformed header fail.
      if (!sig || sig.length !== 64 || !crypto.verify(null, raw, node.key, sig)) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'bad_signature' });
        return reject(res, 401, 'unauthorized');
      }

      var payload;
      try { payload = JSON.parse(raw.toString('utf8')); }
      catch (e) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'bad_json' });
        return reject(res, 400, 'bad_json');
      }
      if (!payload || payload.schema !== st.SCHEMA) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'bad_schema' });
        return reject(res, 400, 'bad_schema');
      }
      // The signature covers the whole body, so the node id inside it must
      // match the one claimed in the header — otherwise a node could
      // publish under another node's name with its own valid signature.
      if (payload.node !== nodeId) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'node_mismatch' });
        return reject(res, 400, 'node_mismatch');
      }

      var sentAt = Date.parse(payload.sent_at);
      if (!isFinite(sentAt) || Math.abs(now - sentAt) > TH.max_skew_s * 1000) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'clock_skew' });
        return reject(res, 400, 'clock_skew');
      }
      var seq = payload.seq;
      if (typeof seq !== 'number' || !isFinite(seq) || seq < 0) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'bad_seq' });
        return reject(res, 400, 'bad_seq');
      }
      // Replay guard. A genuine agent restart resets its counter, which is
      // why the guard also accepts a lower seq once the previous snapshot
      // is older than the offline threshold — a replayed envelope inside
      // that window is refused, and outside it the clock-skew check has
      // already refused anything old enough to matter.
      var prevSeq = store.seq[nodeId];
      var prev = store.nodes[nodeId];
      var prevAge = prev && prev.received_at ? (now - Date.parse(prev.received_at)) / 1000 : Infinity;
      if (prevSeq !== undefined && seq <= prevSeq && prevAge < TH.offline_after_s) {
        log('warn', 'ingest refused', { node: nodeId, reason: 'replay', seq: seq });
        return reject(res, 409, 'replay');
      }

      // Allow-list. Nothing outside node-state.js's named fields survives.
      var clean = st.sanitize(payload);
      clean.node = nodeId;
      clean.display_name = node.name;
      clean.subtitle = node.subtitle || null;
      clean.received_at = new Date(now).toISOString();
      clean.received_bytes = raw.length;

      var prevState = prev && prev.state ? prev.state : null;
      store.nodes[nodeId] = clean;
      store.seq[nodeId] = seq;

      var doc;
      try {
        doc = publish(store, outDir, now, registry);
      } catch (e) {
        log('error', 'publish failed', { node: nodeId, reason: String(e.message).slice(0, 160) });
        return reject(res, 500, 'publish_failed');
      }

      var newState = (doc.nodes.filter(function (n) { return n.node === nodeId; })[0] || {});
      // Carry the derived state back onto the stored snapshot. publish()
      // works on a copy, so without this the store would never hold a
      // state and no transition could ever be detected.
      if (newState.state) store.nodes[nodeId].state = newState.state;

      var stateChanged = !!(prevState && newState.state && prevState !== newState.state);
      if (stateChanged) {
        recordTransition(outDir, nodeId, prevState, newState.state, newState.state_reason, clean.received_at);
        log('info', 'node state changed', { node: nodeId, from: prevState, to: newState.state });
      }

      // Downsampled history: every state change, otherwise at most one row
      // per history_interval_s. See node-state.js for why.
      var lastAt = store.lastHistory[nodeId] || 0;
      if (stateChanged || now - lastAt >= TH.history_interval_s * 1000) {
        store.lastHistory[nodeId] = now;
        try {
          appendJsonl(path.join(outDir, 'haddad-history', new Date(now).toISOString().slice(0, 7) + '.jsonl'), {
            at: clean.received_at,
            node: nodeId,
            seq: seq,
            state: newState.state,
            reason: stateChanged ? 'state_change' : 'interval',
            health: clean.health ? clean.health.counts : null,
            runtime_state: clean.runtime ? clean.runtime.state : null,
            gpu_vram_total_mib: clean.gpu ? clean.gpu.vram_total_mib : null,
            mem_used_mib: clean.resources ? clean.resources.mem_used_mib : null,
            load1: clean.resources ? clean.resources.load1 : null,
            task: clean.current_task ? clean.current_task.task_id : null,
            task_counts: clean.task_counts || null
          });
        } catch (e) {
          // History is evidence, not the service: losing a row must not
          // cost the beat that is already published.
          log('error', 'history append failed', { node: nodeId, reason: String(e.message).slice(0, 160) });
        }
      }

      var okBody = JSON.stringify({ ok: true, node: nodeId, seq: seq, state: newState.state }) + '\n';
      res.writeHead(202, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(okBody) });
      res.end(okBody);
    });
  });

  // Republish on a slow tick so a node that stops sending decays to
  // OFFLINE in the file too, not only in the browser. One write every
  // 15 s of a file under 64 KiB — the same order of work as STC-2's
  // five-minute snapshot, and it costs Haddad nothing.
  var tick = setInterval(function () {
    try {
      var now = clock();
      var known = null;
      try { known = loadNodes(nodesFile); } catch (e) { known = null; }
      Object.keys(store.nodes).forEach(function (id) {
        if (known && !known[id]) {
          delete store.nodes[id]; delete store.seq[id]; delete store.lastHistory[id];
          log('info', 'node deregistered — removed from the published surface', { node: id });
        }
      });
      var doc = publish(store, outDir, now, known);
      // Decay is a real transition too: record it once, so the console's
      // incident view shows a node going away, not just being away.
      doc.nodes.forEach(function (n) {
        var held = store.nodes[n.node];
        if (!held) return;
        if (held.state && n.state && held.state !== n.state) {
          recordTransition(outDir, n.node, held.state, n.state, n.state_reason, new Date(now).toISOString());
          log('info', 'node state changed', { node: n.node, from: held.state, to: n.state });
        }
        held.state = n.state;
      });
      sweepHistory(outDir, now);
    } catch (e) { log('error', 'decay publish failed', { reason: String(e.message).slice(0, 160) }); }
  }, 15000);
  if (tick.unref) tick.unref();

  server.on('close', function () { clearInterval(tick); });
  server.store = store;
  server.publishNow = function () {
    var known = null;
    try { known = loadNodes(nodesFile); } catch (e) { known = null; }
    return publish(store, outDir, clock(), known);
  };
  return server;
}

function main() {
  var nodesFile = argv('nodes', path.join(__dirname, '..', 'nodes.json'));
  var outDir = argv('out', '/var/www/status.mythosprod.xyz/data');
  var port = parseInt(argv('port', '8190'), 10);
  var host = argv('host', '127.0.0.1');

  try { loadNodes(nodesFile); }
  catch (e) {
    process.stderr.write('ERROR: cannot read node registry ' + nodesFile + ': ' + e.message + '\n');
    process.exitCode = 1;
    return;
  }
  try { fs.mkdirSync(outDir, { recursive: true }); fs.accessSync(outDir, fs.constants.W_OK); }
  catch (e) {
    process.stderr.write('ERROR: output directory not writable: ' + outDir + ': ' + e.message + '\n');
    process.exitCode = 1;
    return;
  }

  var server = createServer({ nodesFile: nodesFile, outDir: outDir });
  server.listen(port, host, function () {
    log('info', 'haddad ingest listening', { host: host, port: port, out: outDir, nodes_file: nodesFile });
    // Publish immediately so the file exists (and every known node decays
    // honestly) even before the first envelope of this process arrives.
    try { server.publishNow(); } catch (e) { /* the tick will retry */ }
  });
  ['SIGTERM', 'SIGINT'].forEach(function (s) {
    process.on(s, function () { server.close(function () { process.exit(0); }); });
  });
}

if (require.main === module) main();

module.exports = {
  createServer: createServer,
  loadNodes: loadNodes,
  publish: publish,
  INGEST_VERSION: INGEST_VERSION
};
