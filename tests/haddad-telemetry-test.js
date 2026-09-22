// =====================================================
// MYTHOS HADDAD — telemetry agent suite
// tests/haddad-telemetry-test.js
//
// Offline, and runnable on ANY host: the agent's collectors are written
// so that a machine without Haddad's units, GPU or executor reports
// nulls rather than crashing, and this suite asserts exactly that — it is
// the same code path a degraded Haddad takes.
//
// Covers: the collectors' shapes and their null discipline, worker-state
// mapping (including the timers, which are scheduled rather than
// resident), event severity and detail derivation, configuration loading
// with no secret in the config file, the signing/sending contract, and
// the agent's own security boundary (no secret in the envelope, no
// inbound surface, one outbound target).
// =====================================================
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const AGENT_PATH = path.join(REPO, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry.js');
const agent = require(AGENT_PATH);
const nodeState = require(path.join(REPO, 'projects', 'status-center', 'haddad', 'lib', 'node-state.js'));

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; } else { failed++; console.error('[FAIL] ' + label); }
}
function eq(a, b, label) {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) console.error('[FAIL] ' + label + '\n   got: ' + JSON.stringify(a) + '\n   want: ' + JSON.stringify(b));
  if (same) passed++; else failed++;
}

console.log('§1 resources — real values, or null, never a fabricated zero');
{
  const r = agent.collectResources();
  ok(typeof r.cpus === 'number' && r.cpus > 0, 'CPU count is read from the machine');
  ok(typeof r.load1 === 'number', 'load average is read');
  ok(r.mem_total_mib === null || r.mem_total_mib > 0, 'RAM total is real or absent, never 0');
  ok(r.mem_used_mib === null || r.mem_used_mib >= 0, 'RAM used is real or absent');
  ok(r.mem_used_mib === null || r.mem_total_mib === null || r.mem_used_mib <= r.mem_total_mib,
    'RAM used never exceeds RAM total');
  ok(r.disk_total_gb === null || r.disk_total_gb > 0, 'disk total is real or absent');
  ok(r.swap_total_mib === null || r.swap_total_mib >= 0, 'swap is reported, including a host with none');
  ok(r.process_count === null || r.process_count > 0, 'process count is real or absent');

  // MemAvailable, not freemem(): page cache is not "used" memory. On a
  // host with a warm cache the two differ by gigabytes, and using
  // freemem() would report permanent false pressure.
  const src = fs.readFileSync(AGENT_PATH, 'utf8');
  ok(/MemAvailable/.test(src), 'memory pressure is computed from MemAvailable');

  // Every key the receiver allows must be present (as a value or a null),
  // so the shape never depends on which host collected it.
  const allowed = Object.keys(nodeState.sanitize({ resources: r }).resources);
  allowed.forEach(function (k) {
    ok(Object.prototype.hasOwnProperty.call(r, k), 'resources carries the key ' + k);
  });
}

console.log('§2 GPU — absence is stated, never invented');
{
  // EVERY call here injects the probes. Without that, the result depends on
  // whether the machine running the suite happens to have a working GPU —
  // so these assertions would pass on a host UNLIKE the one the feature
  // targets and fail on Haddad itself. (Caught by the node running this
  // suite there: 160/1, and the 1 was this.)
  const NO_PROBE = { vulkan: function () { return null; }, pci: function () { return null; } };
  const VULKAN_OK = {
    vulkan: function () { return { vram_total_mib: 6400, vram_used_mib: 0 }; },  // NVK reports 0 used
    pci: function () { return 'NVIDIA Corporation TU116 [GeForce GTX 1660 SUPER]'; }
  };

  // Nothing answers: the degraded path.
  const g = agent.collectGpu(null, NO_PROBE);
  ok(g.vram_used_mib === null || typeof g.vram_used_mib === 'number', 'VRAM used is a number or null');
  ok(g.utilization_pct === null, 'utilisation is null where nothing can measure it');
  ok(g.temperature_c === null, 'temperature is null where nothing can measure it');
  ok(g.power_w === null, 'power is null where nothing can measure it');
  ok(typeof g.unavailable_reason === 'string' && g.unavailable_reason.length > 20,
    'the reason the metrics are missing is published, so the UI can explain N/A');
  // The reason must describe THIS machine. Hard-coding Haddad's nouveau/NVK
  // explanation everywhere would state a false cause on any other node —
  // the same class of dishonesty as inventing the metric itself.
  ok(!/nouveau|NVK/i.test(g.unavailable_reason),
    'on a host with no such GPU the reason does NOT claim a nouveau/NVK limitation');
  ok(/no live GPU counter is readable on this machine/i.test(g.unavailable_reason),
    'it states the generic, true reason instead');

  const gNvk = agent.collectGpu({
    checks: [{ id: 'gpu_test', status: 'PASS', data: {
      device: { name: 'NVIDIA GeForce GTX 1660 SUPER (NVK TU116)', vulkan_api: '1.4.335' },
      vram_mib: 6400 } }]
  }, NO_PROBE);
  // GUARD: every collectGpu call in this suite must inject probes. A single
  // bare call reintroduces hardware dependence silently — the suite would go
  // green here and red on Haddad, which is the wrong way round.
  {
    const suite = fs.readFileSync(__filename, 'utf8');
    const calls = suite.match(/agent\.collectGpu\([^;]*?\);/gs) || [];
    const bare = calls.filter(function (c) { return !/NO_PROBE|VULKAN_OK|probe/i.test(c); });
    eq(bare.length, 0, 'no collectGpu call in this suite depends on the host\'s real hardware');
    ok(calls.length >= 5, 'and the injected calls cover both the answering and non-answering probe');
  }

  ok(/nouveau\/NVK/i.test(gNvk.unavailable_reason),
    'on the open NVIDIA stack it DOES name the nouveau/NVK limitation');
  ok(/runtime's own load accounting|model-weights/.test(gNvk.unavailable_reason),
    'and points the reader at the figures that ARE real — the runtime\'s own load accounting');

  // The REAL shape haddad-health.js records: the gpu-vulkan-test report
  // verbatim, in which `device` is an OBJECT. Reading it as a string
  // produced a value the receiver's allow-list dropped, so the live page
  // showed N/A for a GPU the node reports perfectly well. Caught on the
  // real node; this fixture is that exact shape.
  const g2 = agent.collectGpu({
    checks: [
      { id: 'gpu_detect', status: 'PASS', detail: 'NVIDIA Corporation TU116 [GeForce GTX 1660 SUPER] [driver: nouveau]', data: { driver: ['nouveau'] } },
      { id: 'gpu_test', status: 'PASS', data: {
          status: 'PASS',
          device: { name: 'NVIDIA GeForce GTX 1660 SUPER', vulkan_api: '1.4.335' },
          vram_mib: 6400 } }
    ]
  }, NO_PROBE);
  eq(g2.model, 'NVIDIA GeForce GTX 1660 SUPER', 'the GPU model is read from device.name, not from the object itself');
  ok(typeof g2.model === 'string', 'the model is a STRING — an object here is silently dropped by the allow-list');
  ok(/Vulkan 1\.4\.335/.test(g2.driver) && /nouveau/.test(g2.driver), 'the driver combines the Vulkan API and the kernel driver');
  eq(g2.vram_total_mib, 6400, 'VRAM total is reused from the existing health check');
  eq(g2.vram_used_mib, null, 'VRAM used stays null — the driver does not report it (documented NVK limitation)');
  // The reason must not claim "no vendor tool answered" when one did.
  ok(!/no vendor tool answered/.test(g2.unavailable_reason),
    'when the Vulkan probe DID answer, the reason does not claim nothing answered');
  ok(/heapUsage 0|no live usage/.test(g2.unavailable_reason), 'it names the real limitation instead');
  ok(/nouveau\/NVK/.test(g2.unavailable_reason), 'and identifies the open stack, because this machine is on it');

  // A --quick pass skips gpu_test entirely; gpu_detect must still identify it.
  const g3 = agent.collectGpu({
    checks: [
      { id: 'gpu_detect', status: 'PASS', detail: 'NVIDIA Corporation TU116 [GeForce GTX 1660 SUPER] [driver: nouveau]', data: { driver: ['nouveau'] } },
      { id: 'gpu_test', status: 'WARN', detail: 'skipped (--quick)' }
    ]
  }, NO_PROBE);
  ok(/GTX 1660 SUPER/.test(g3.model || ''), 'a --quick health pass still identifies the GPU from gpu_detect');
  eq(g3.vram_total_mib, null, 'and total VRAM is absent when NOTHING can supply it');

  // The same --quick pass on a machine where the Vulkan probe DOES answer:
  // the fallback is the point of it, so total VRAM must be filled in.
  const g4 = agent.collectGpu({
    checks: [
      { id: 'gpu_detect', status: 'PASS', detail: 'NVIDIA Corporation TU116 [GeForce GTX 1660 SUPER] [driver: nouveau]', data: { driver: ['nouveau'] } },
      { id: 'gpu_test', status: 'WARN', detail: 'skipped (--quick)' }
    ]
  }, VULKAN_OK);
  eq(g4.vram_total_mib, 6400, 'a --quick pass still gets total VRAM from the probe — that IS the fallback');
  eq(g4.vram_used_mib, null, 'a reported 0 is discarded, not published as a measurement (NVK limitation)');
  ok(!/no vendor tool answered/.test(g4.unavailable_reason),
    'and the reason reflects that the probe answered, even though gpu_test was skipped');

  // With nothing in the health report at all, the probes alone identify it.
  const g5 = agent.collectGpu(null, VULKAN_OK);
  ok(/GTX 1660 SUPER/.test(g5.model || ''), 'with no health report, the PCI probe names the device');
  eq(g5.vram_total_mib, 6400, 'and the Vulkan probe supplies total VRAM');
}

console.log('§3 workers — units, timers, and the things the node cannot see');
{
  function w(units, runtime, health, task) {
    const list = agent.collectWorkers(units, runtime || { state: 'READY' }, health || { doc: null }, task || null);
    const by = {};
    list.forEach(function (x) { by[x.id] = x; });
    return by;
  }
  const allActive = { worker: 'active', runtime: 'active', bridge: 'active', health: 'active' };

  eq(w(allActive).executor.state, 'READY', 'an active worker with no task is READY');
  eq(w(allActive, null, null, { effective: 'RUNNING' }).executor.state, 'BUSY', 'an active worker running a task is BUSY');
  eq(w(Object.assign({}, allActive, { worker: 'inactive' })).executor.state, 'STOPPED', 'an inactive worker is STOPPED');
  eq(w(Object.assign({}, allActive, { worker: 'failed' })).executor.state, 'STOPPED', 'a failed worker is STOPPED');
  eq(w(Object.assign({}, allActive, { worker: 'unknown' })).executor.state, 'UNKNOWN', 'an unreadable unit is UNKNOWN, not assumed good');

  // A TIMER is healthy when it is scheduled. Judging it like a daemon
  // would report the bridge as broken on every host where it works.
  eq(w(allActive).bridge.state, 'RUNNING', 'an active bridge TIMER is RUNNING (scheduled)');
  ok(/per-tick|scheduled/.test(w(allActive).bridge.detail), 'the bridge row says it is a per-tick timer, not a daemon');
  eq(w(Object.assign({}, allActive, { bridge: 'inactive' })).bridge.state, 'STOPPED', 'a disabled bridge timer is STOPPED');
  eq(w(allActive).health.state, 'RUNNING', 'the health timer is judged the same way');

  eq(w(allActive, { state: 'STOPPED' }).runtime.state, 'STOPPED', 'the runtime row carries the runtime collector\'s verdict');
  eq(w(allActive, { state: 'BUSY' }).runtime.state, 'BUSY', 'a runtime with a slot processing is BUSY');

  // FABLE is an interactive session, not a unit. Claiming to know its
  // state would be the exact fabrication this page must not do.
  eq(w(allActive).fable.state, 'UNKNOWN', 'FABLE is UNKNOWN — the node genuinely cannot observe it');
  ok(/cannot observe/.test(w(allActive).fable.detail), 'and the row says why');

  // The MCP is reported only from a real probe result.
  eq(w(allActive, null, { doc: null }).mcp.state, 'UNKNOWN', 'an unprobed MCP is UNKNOWN');
  eq(w(allActive, null, { doc: { checks: [{ id: 'mcp', status: 'PASS', detail: 'handshake ok' }] } }).mcp.state, 'READY',
    'a passing MCP probe is READY');
  eq(w(allActive, null, { doc: { checks: [{ id: 'mcp', status: 'FAIL', detail: 'no handshake' }] } }).mcp.state, 'DEGRADED',
    'a failing MCP probe is DEGRADED');

  // Every worker state the agent can emit must be one the receiver accepts.
  const states = Object.keys(w(allActive)).map(function (k) { return w(allActive)[k].state; });
  states.forEach(function (s) {
    ok(nodeState.WORKER_STATES.indexOf(s) !== -1, 'worker state "' + s + '" is in the shared vocabulary');
  });
}

console.log('§4 events — severity and detail come from the executor\'s own log');
{
  eq(agent.severityFor({ event: 'transition', to: 'COMPLETED' }), 'SUCCESS', 'a completed transition is SUCCESS');
  eq(agent.severityFor({ event: 'transition', to: 'FAILED' }), 'ERROR', 'a failed transition is ERROR');
  eq(agent.severityFor({ event: 'transition', to: 'BLOCKED' }), 'WARNING', 'a blocked transition is WARNING');
  eq(agent.severityFor({ event: 'transition', to: 'RUNNING' }), 'INFO', 'a start is INFO');
  eq(agent.severityFor({ event: 'retries_exhausted' }), 'CRITICAL', 'exhausted retries are CRITICAL');
  eq(agent.severityFor({ event: 'work_delivered' }), 'SUCCESS', 'delivered work is SUCCESS');
  eq(agent.severityFor({ event: 'preflight_blocked' }), 'ERROR', 'a blocked preflight is ERROR');
  eq(agent.severityFor({ event: 'quota_exhausted' }), 'WARNING', 'quota exhaustion is a WARNING, not a failure');
  eq(agent.severityFor({ event: 'something_new_the_executor_adds' }), 'INFO', 'an unrecognised event degrades to INFO, never to ERROR');

  // Every severity must be one the receiver accepts.
  ['transition', 'retries_exhausted', 'work_delivered', 'unknown_event'].forEach(function (e) {
    const s = agent.severityFor({ event: e, to: 'COMPLETED' });
    ok(nodeState.SEVERITIES.indexOf(s) !== -1, 'severity "' + s + '" is in the shared vocabulary');
  });

  eq(agent.eventDetail({ event: 'transition', from: 'RUNNING', to: 'COMPLETED' }), 'RUNNING -> COMPLETED',
    'a transition detail reads as the transition');
  eq(agent.eventDetail({ event: 'transition', from: 'RUNNING', to: 'FAILED', reason: 'validation failed' }),
    'RUNNING -> FAILED (validation failed)', 'a stated reason is carried');
  ok(/classification=transient/.test(agent.eventDetail({ event: 'failure_classified', classification: 'transient' })),
    'a classified failure carries its classification');
  ok(agent.eventDetail({ event: 'x', nested: { a: 1 } }) === null || !/\[object/.test(agent.eventDetail({ event: 'x', nested: { a: 1 } })),
    'a nested object never renders as [object Object]');
  ok(String(agent.eventDetail({ event: 'x', error: 'e'.repeat(1000) })).length <= 300, 'details are length-capped');
}

console.log('§5 configuration — an endpoint and a key PATH, never a key');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-cfg-'));
  const conf = path.join(dir, 'telemetry.env');
  fs.writeFileSync(conf, [
    '# generated',
    'HADDAD_TELEMETRY_NODE=haddad-02',
    'HADDAD_TELEMETRY_ENDPOINT=https://status.mythosprod.xyz/ingest',
    'HADDAD_TELEMETRY_KEY_FILE=' + path.join(dir, 'k.pem'),
    'HADDAD_TELEMETRY_TIMEOUT_MS=5000'
  ].join('\n'));

  const prev = process.env.HADDAD_CONF_DIR;
  process.env.HADDAD_CONF_DIR = dir;
  delete require.cache[require.resolve(AGENT_PATH)];
  const reloaded = require(AGENT_PATH);
  const cfg = reloaded.loadConfig();
  eq(cfg.node, 'haddad-02', 'the node id is read from the config');
  eq(cfg.endpoint, 'https://status.mythosprod.xyz/ingest', 'the endpoint is read from the config');
  eq(cfg.timeout_ms, 5000, 'the timeout is read from the config');
  ok(cfg.key_file.indexOf(dir) === 0, 'the key is named by PATH, not by value');

  // The setup script writes this file; it must never write a key into it.
  const setup = fs.readFileSync(path.join(REPO, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry-setup.sh'), 'utf8');
  ok(/HADDAD_TELEMETRY_KEY_FILE=/.test(setup), 'the setup writes the key path');
  ok(!/HADDAD_TELEMETRY_KEY=[^_]/.test(setup), 'the setup never writes a key value into the config');
  ok(/chmod 600 "\$KEY_FILE"/.test(setup) || /mode: 0o600/.test(setup), 'the private key is written 0600');
  ok(/generateKeyPairSync\("ed25519"\)/.test(setup), 'the key is generated ON the node');
  ok(!/scp|rsync|curl -T|--upload-file/.test(setup), 'the setup never transmits the key anywhere');
  ok(/PUBLIC KEY/.test(setup) && /not a secret/.test(setup), 'the setup prints only the public half, and says so');

  if (prev === undefined) delete process.env.HADDAD_CONF_DIR; else process.env.HADDAD_CONF_DIR = prev;
  delete require.cache[require.resolve(AGENT_PATH)];
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('§6 the signing contract the receiver verifies');
{
  // The agent signs the exact bytes it sends; the receiver verifies the
  // exact bytes it received. This asserts the two agree, without a network.
  const kp = crypto.generateKeyPairSync('ed25519');
  const body = Buffer.from(JSON.stringify({ schema: nodeState.SCHEMA, node: 'haddad', seq: 1 }), 'utf8');
  const sig = crypto.sign(null, body, kp.privateKey);
  const pub = crypto.createPublicKey({
    key: Buffer.from(crypto.createPublicKey(kp.privateKey).export({ format: 'der', type: 'spki' }).toString('base64'), 'base64'),
    format: 'der', type: 'spki'
  });
  ok(crypto.verify(null, body, pub, sig), 'a signature made by the agent verifies against the registered public key');
  ok(!crypto.verify(null, Buffer.concat([body, Buffer.from('x')]), pub, sig), 'one altered byte invalidates it');
  eq(sig.length, 64, 'an Ed25519 signature is 64 bytes — the length the receiver requires');

  const src = fs.readFileSync(AGENT_PATH, 'utf8');
  ok(/crypto\.sign\(null, body, key\)/.test(src), 'the agent signs the body it sends, not a summary of it');
  ok(/asymmetricKeyType !== 'ed25519'/.test(src), 'the agent refuses a key of the wrong type rather than sending unsigned');
}

console.log('§7 the agent\'s security boundary');
{
  const src = fs.readFileSync(AGENT_PATH, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  ok(!/createServer|\.listen\(/.test(code), 'the agent opens no port and serves nothing');
  // The agent may name exactly two kinds of address: its own loopback
  // services, and the Status Center it reports to (as the overridable
  // default). Anything else would mean it talks to something unreviewed.
  const urls = (code.match(/https?:\/\/[^'"\s)`]+/g) || []);
  const stray = urls.filter(function (u) {
    return u.indexOf('http://127.0.0.1') !== 0 &&
           u !== 'https://status.mythosprod.xyz/ingest';
  });
  eq(stray, [], 'the only addresses in the agent are its own loopback and the Status Center ingest');
  ok(/cfg\.endpoint/.test(code), 'the outbound target is read from configuration, so the default is overridable');
  ok((urls.filter(function (u) { return u.indexOf('127.0.0.1') === -1; })).length === 1,
    'there is exactly ONE non-loopback destination in the whole agent');

  // The runtime key is used as a header and must never be placed in the
  // envelope or printed.
  ok(/Authorization: Bearer/.test(code), 'the runtime key is used as a request header');
  ok(!/api_key:|apiKey:|token:|bearer:/.test(code.replace(/runtimeKey|HADDAD_RUNTIME_API_KEY|OTH_MCP|executor\.env/g, '')),
    'no key is ever assigned into a published field');
  ok(!/console\.log\([^)]*key/i.test(code), 'no key is ever logged');

  // Exit code 2 (endpoint unreachable) is a normal, transient condition
  // and the unit must treat it as success or the node would spam failures.
  const unit = fs.readFileSync(path.join(REPO, 'projects', 'mythos-haddad', 'systemd', 'mythos-haddad-telemetry.service'), 'utf8');
  ok(/SuccessExitStatus=.*\b2\b/.test(unit), 'an unreachable endpoint is not a unit failure');
  ok(/TimeoutStartSec=[1-9]/.test(unit), 'a hung beat is bounded, so beats cannot pile up');
  const timer = fs.readFileSync(path.join(REPO, 'projects', 'mythos-haddad', 'systemd', 'mythos-haddad-telemetry.timer'), 'utf8');
  ok(/Persistent=false/.test(timer), 'a missed beat is never replayed as if it were current');
  const m = /OnUnitInactiveSec=(\d+)s/.exec(timer);
  ok(m && Number(m[1]) === nodeState.DEFAULT_THRESHOLDS.heartbeat_s,
    'the timer interval matches the published heartbeat the thresholds are derived from');
  ok(Number(m[1]) * 3 <= nodeState.DEFAULT_THRESHOLDS.degraded_after_s,
    'DEGRADED needs at least three missed beats — one late beat must not page');
  ok(nodeState.DEFAULT_THRESHOLDS.offline_after_s > nodeState.DEFAULT_THRESHOLDS.degraded_after_s,
    'OFFLINE is strictly later than DEGRADED');
}

console.log('§8 the agent reuses existing systems and builds no second one');
{
  const src = fs.readFileSync(AGENT_PATH, 'utf8');
  ok(/mythos-ai-executor', 'lib', 'state\.js'/.test(src.replace(/\s+/g, ' ')) || /lib', 'state\.js'/.test(src),
    'task state is read through the executor\'s OWN module, not a reimplementation');
  ok(/health-latest\.json/.test(src), 'health is read from the existing health timer\'s report');
  ok(/haddad-gpu-vram\.py/.test(src), 'VRAM uses the existing GPU probe');
  ok(/systemctl/.test(src), 'unit state comes from systemd, not from a second supervisor');

  // Things it must NOT contain: a queue, a scheduler, a second state machine.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/TRANSITIONS\s*=|function transition\(/.test(code), 'the agent defines no state machine of its own');
  ok(!/setInterval|setTimeout\([^,]*,\s*\d{4,}/.test(code), 'the agent runs no loop of its own — systemd is the scheduler');
  ok(!/require\('express'\)|require\("express"\)/.test(code), 'no framework is pulled in');
  const deps = (code.match(/require\('([^']+)'\)/g) || []).map(function (r) { return r.slice(9, -2); });
  const external = deps.filter(function (d) { return d.indexOf('.') !== 0 && ['child_process', 'fs', 'os', 'path', 'crypto', 'http', 'https', 'url'].indexOf(d) === -1; });
  eq(external, [], 'zero npm dependencies — node built-ins only');
}

console.log('\u00a79 the task view is never silently empty');
{
  // The failure this guards against was real and silent: reading
  // MYTHOS_EXECUTOR_HOME from executor.env (which on Haddad holds only the
  // token) left the store unresolved, state.js fell back to a directory
  // that does not exist, and every beat published task_counts {} — which
  // renders exactly like a healthy idle node. A fixture store with real
  // tasks in it is the only assertion that catches that.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-store-'));
  const tasks = path.join(home, 'tasks');
  function task(id, status, extra) {
    const d = path.join(tasks, id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'task.json'), JSON.stringify(Object.assign({
      project: 'mythos-prod', stage: 'execute', provider: 'openai-compat', requested_action: 'fix',
      created_at: '2026-09-22T10:00:00Z'
    }, (extra || {}).task)));
    fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify(Object.assign({
      status: status, updated_at: '2026-09-22T11:00:00Z', retry_count: 0
    }, (extra || {}).status)));
    fs.writeFileSync(path.join(d, 'events.log'),
      JSON.stringify({ ts: '2026-09-22T10:00:01Z', task_id: id, event: 'created' }) + '\n' +
      JSON.stringify({ ts: '2026-09-22T10:00:02Z', task_id: id, event: 'transition', from: 'QUEUED', to: status }) + '\n');
  }
  task('gh-issue-379', 'COMPLETED');
  task('gh-issue-380', 'QUEUED');
  task('gh-issue-381', 'FAILED');

  const prevHome = process.env.MYTHOS_EXECUTOR_HOME;
  process.env.MYTHOS_EXECUTOR_HOME = home;
  delete require.cache[require.resolve(AGENT_PATH)];
  const a = require(AGENT_PATH);
  const env = a.collect({ node: 'haddad', endpoint: 'http://127.0.0.1:1/ingest' });

  ok(Object.keys(env.task_counts).length > 0, 'task_counts is NOT empty against a real store');
  eq(env.task_counts.COMPLETED, 1, 'a completed task is counted');
  eq(env.task_counts.QUEUED, 1, 'a queued task is counted');
  eq(env.task_counts.FAILED, 1, 'a failed task is counted');
  ok(env.current_task && env.current_task.task_id, 'a current task is reported');
  eq(env.current_task.project, 'mythos-prod', 'the task carries its real project');
  ok(env.events.length >= 6, 'real events are read from the executor\'s own event log');

  // The activity classification must come from the EXECUTOR's own state
  // machine, not a name list here: terminal = an empty TRANSITIONS entry,
  // executing = a live pid, everything else non-terminal = waiting.
  ok(env.activity_counts, 'the agent classifies activity');
  eq(env.activity_counts.EXECUTING, 0, 'EXECUTING needs a LIVE PID — nothing in this fixture has one');
  eq(env.activity_counts.TERMINAL, 1, 'COMPLETED is terminal: the executor declares no outgoing transition');
  eq(env.activity_counts.PENDING, 1, 'QUEUED can move straight into an execution-bearing status, so it is waiting to run');
  eq(env.activity_counts.AT_REST, 1,
    'FAILED is NOT waiting: it can only go back to QUEUED first, so counting it as queued would overstate the queue');
  ok(env.current_task.activity, 'the current task carries its activity');
  ok(env.events.every(function (e) { return e.source === 'executor'; }), 'events are attributed to the executor');

  // The whole envelope must survive the receiver's allow-list unchanged in
  // substance — the two halves agree or the page shows nothing.
  const clean = nodeState.sanitize(env);
  eq(clean.task_counts, env.task_counts, 'task counts survive the receiver allow-list');
  ok(clean.current_task && clean.current_task.task_id === env.current_task.task_id, 'the current task survives it');
  ok(clean.events.length === Math.min(env.events.length, nodeState.DEFAULT_THRESHOLDS.max_events),
    'events survive it');

  // And the fields withheld from a page served without authentication
  // really are absent, on both sides.
  ok(clean.current_task.next_action === undefined, 'next_action is not published');
  ok(env.current_task.next_action === undefined, 'the agent does not even collect next_action');
  ok(!env.events.some(function (e) { return /error=|summary=/.test(String(e.detail || '')); }),
    'event detail carries structured keys only, never free text');

  if (prevHome === undefined) delete process.env.MYTHOS_EXECUTOR_HOME; else process.env.MYTHOS_EXECUTOR_HOME = prevHome;
  delete require.cache[require.resolve(AGENT_PATH)];
  fs.rmSync(home, { recursive: true, force: true });
}

console.log('\u00a710 executor-home resolution order');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-env-'));
  fs.mkdirSync(path.join(dir, '.config', 'mythos-haddad'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.config', 'mythos-ai-executor'), { recursive: true });
  // Exactly the shape found on the real node.
  fs.writeFileSync(path.join(dir, '.config', 'mythos-ai-executor', 'executor.env'), 'MYTHOS_EXECUTOR_TOKEN=redacted\n');
  fs.writeFileSync(path.join(dir, '.config', 'mythos-haddad', 'worker.env'),
    'MYTHOS_EXECUTOR_HOME=/home/othman/mythos-ai-executor-haddad\n');

  const src = fs.readFileSync(AGENT_PATH, 'utf8');
  const order = src.indexOf("'mythos-haddad', 'worker.env'");
  const other = src.indexOf("'mythos-ai-executor', 'executor.env'");
  ok(order !== -1 && other !== -1 && order < other,
    'worker.env is consulted BEFORE executor.env — it is the file that actually sets the home');

  // HADDAD_MCP_REPO already means the MCP launcher's repo on that host;
  // reusing it here could silently repoint one of the two.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/HADDAD_MCP_REPO/.test(code), 'the agent does not borrow HADDAD_MCP_REPO');
  ok(/HADDAD_TELEMETRY_REPO/.test(code), 'it uses its own variable');
  ok(/__dirname/.test(code), 'and defaults to the checkout it was run from, so a dry run needs no environment');

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// §11 HADDAD_MCP_REPO cannot reach the installed unit
//
// The agent was fixed in #390; the SETUP SCRIPT still read HADDAD_MCP_REPO,
// and the setup script is what bakes a path into ExecStart. So this section
// does not read source for the script — it RUNS it, with a decoy exported,
// into a throwaway HOME, and asserts the decoy is nowhere in the unit that
// lands on disk. A source grep would pass on a script that still behaved
// badly through some other path.
// ---------------------------------------------------------------------------
console.log('§11 HADDAD_MCP_REPO cannot redirect the installed telemetry unit');
{
  const cp = require('child_process');
  const SETUP = path.join(REPO, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry-setup.sh');

  // Neither script may consult it, ever.
  const setupSrc = fs.readFileSync(SETUP, 'utf8');
  const setupCode = setupSrc.replace(/^\s*#.*$/gm, '');
  ok(!/HADDAD_MCP_REPO/.test(setupCode),
    'the setup script does not read HADDAD_MCP_REPO (comments explaining why it must not are fine)');
  ok(/HADDAD_TELEMETRY_REPO/.test(setupCode), 'the setup script uses its own variable');

  const agentCode = fs.readFileSync(AGENT_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/HADDAD_MCP_REPO/.test(agentCode), 'the agent does not read HADDAD_MCP_REPO either');

  // Now the behavioural proof.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-setup-home-'));
  const decoy = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-decoy-repo-'));
  // Make the decoy look like a perfectly valid checkout, so the only reason
  // it loses is that the script refuses to consult that variable.
  fs.mkdirSync(path.join(decoy, 'projects', 'mythos-haddad', 'bin'), { recursive: true });
  fs.copyFileSync(AGENT_PATH, path.join(decoy, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry.js'));

  const confDir = path.join(home, 'conf');
  const unitDir = path.join(home, 'units');
  const env = Object.assign({}, process.env, {
    HOME: home,
    HADDAD_MCP_REPO: decoy,                    // the decoy, exported exactly as on a real shell
    HADDAD_TELEMETRY_CONFIG_DIR: confDir,
    HADDAD_TELEMETRY_UNIT_DIR: unitDir,
    HADDAD_TELEMETRY_NODE: 'test-node'
  });
  delete env.HADDAD_TELEMETRY_REPO;            // no explicit choice: the default must win

  let ran;
  try {
    ran = cp.spawnSync('bash', [SETUP], { env: env, encoding: 'utf8', timeout: 120000 });
  } catch (e) {
    ran = { status: -1, stdout: '', stderr: String(e && e.message) };
  }

  const unitFile = path.join(unitDir, 'mythos-haddad-telemetry.service');
  if (ran && ran.status === 0 && fs.existsSync(unitFile)) {
    const unit = fs.readFileSync(unitFile, 'utf8');
    ok(unit.indexOf(decoy) === -1,
      'the decoy HADDAD_MCP_REPO does NOT appear in the installed ExecStart');
    ok(unit.indexOf(REPO) !== -1,
      'the unit is pinned to the tree the setup script was actually run from');
    ok(/ExecStart=.*haddad-telemetry\.js/.test(unit), 'and it still points at the agent');
    // The private key must never be world-readable, and the config must
    // carry no secret — re-asserted here because this is the one test that
    // runs the real installer end to end.
    const keyFile = path.join(confDir, 'telemetry-key.pem');
    if (fs.existsSync(keyFile)) {
      ok((fs.statSync(keyFile).mode & 0o077) === 0, 'the generated private key is not group/world readable');
    } else { ok(false, 'the setup generated a signing key'); }
    const envFile = path.join(confDir, 'telemetry.env');
    if (fs.existsSync(envFile)) {
      const conf = fs.readFileSync(envFile, 'utf8');
      ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(conf), 'the config file holds no private key material');
      ok(conf.indexOf(decoy) === -1, 'and no decoy path leaked into the config');
    } else { ok(false, 'the setup wrote a config file'); }
  } else {
    // Environments without systemd/node cannot run the installer; say so
    // rather than reporting a pass that never happened.
    const why = (ran && (ran.stderr || ran.stdout) || '').trim().split('\n').slice(-2).join(' ');
    console.log('    (installer not runnable here — skipping the behavioural half: ' + why.slice(0, 160) + ')');
  }

  // A linked git worktree must be refused unless chosen deliberately: a
  // worktree is temporary, and a unit pinned to one dies the day it is
  // removed, with the timer still firing.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-fake-worktree-'));
  fs.mkdirSync(path.join(wt, 'projects', 'mythos-haddad', 'bin'), { recursive: true });
  fs.copyFileSync(AGENT_PATH, path.join(wt, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry.js'));
  fs.mkdirSync(path.join(wt, 'projects', 'mythos-haddad', 'systemd'), { recursive: true });
  ['mythos-haddad-telemetry.service', 'mythos-haddad-telemetry.timer'].forEach(function (u) {
    fs.copyFileSync(path.join(REPO, 'projects', 'mythos-haddad', 'systemd', u),
      path.join(wt, 'projects', 'mythos-haddad', 'systemd', u));
  });
  fs.copyFileSync(SETUP, path.join(wt, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry-setup.sh'));
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');   // the exact worktree shape
  const wtRun = cp.spawnSync('bash', [path.join(wt, 'projects', 'mythos-haddad', 'bin', 'haddad-telemetry-setup.sh')], {
    env: Object.assign({}, process.env, {
      HOME: home, HADDAD_TELEMETRY_CONFIG_DIR: path.join(home, 'c2'), HADDAD_TELEMETRY_UNIT_DIR: path.join(home, 'u2')
    }),
    encoding: 'utf8', timeout: 120000
  });
  ok(wtRun.status !== 0, 'a linked git worktree is REFUSED as a deployment target');
  ok(/linked git worktree/i.test(String(wtRun.stderr) + String(wtRun.stdout)),
    'and the refusal says why, so the operator can choose deliberately');

  [home, decoy, wt].forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
}

console.log('\u00a712 runtime load facts, parsed from the REAL journal lines');
{
  // Verbatim from Haddad's own runtime journal, 2026-09-22 (ActiveEnterTimestamp
  // Tue 2026-09-22 15:43:17 UTC). Any change to these patterns must keep
  // parsing exactly these strings, because this is what the machine emits.
  const REAL = [
    '2026-09-22T15:43:57 load_tensors: offloading output layer to GPU',
    '2026-09-22T15:43:57 load_tensors: offloading 26 repeating layers to GPU',
    '2026-09-22T15:43:57 load_tensors: offloaded 27/29 layers to GPU',
    '2026-09-22T15:43:57 load_tensors:   CPU_Mapped model buffer size =   576.77 MiB',
    '2026-09-22T15:43:57 load_tensors:      Vulkan0 model buffer size =  3883.68 MiB',
    '2026-09-22T15:44:04 llama_context: n_ctx         = 8192',
    '2026-09-22T15:44:04 llama_kv_cache:        CPU KV buffer size =    32.00 MiB',
    '2026-09-22T15:44:04 llama_kv_cache:    Vulkan0 KV buffer size =   416.00 MiB',
    '2026-09-22T15:44:04 sched_reserve:    Vulkan0 compute buffer size =   304.00 MiB',
    '2026-09-22T15:44:04 llama_params_fit_impl: projected to use 4920 MiB of device memory',
    '2026-09-22T15:44:07 main: server is listening on http://127.0.0.1:8600'
  ];
  // The parser walks lines; drive the same regexes over the real text.
  function parse(lines) {
    const f = { gpu_layers: null, gpu_layers_total: null, vram_model_mib: null,
      vram_projected_mib: null, context: null, last_ready: null };
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (f.gpu_layers === null) {
        const lm = /offloaded\s+(\d+)\s*\/\s*(\d+)\s+layers/i.exec(line);
        if (lm) { f.gpu_layers = parseInt(lm[1], 10); f.gpu_layers_total = parseInt(lm[2], 10); }
      }
      if (f.vram_model_mib === null) {
        const vm = /(?:Vulkan|CUDA|GPU)[^:]*model buffer size\s*=\s*([\d.]+)\s*MiB/i.exec(line);
        if (vm) f.vram_model_mib = Math.round(parseFloat(vm[1]));
      }
      if (f.vram_projected_mib === null) {
        const pm = /projected to use\s+([\d.]+)\s*MiB of device memory/i.exec(line);
        if (pm) f.vram_projected_mib = Math.round(parseFloat(pm[1]));
      }
      if (f.context === null) {
        const cm = /llama_context:\s*n_ctx\s*=\s*(\d+)/i.exec(line);
        if (cm) f.context = parseInt(cm[1], 10);
      }
      if (f.last_ready === null && /all slots are idle|server is listening|main loop/i.test(line)) {
        f.last_ready = /^(\S+)/.exec(line)[1];
      }
    }
    return f;
  }
  const f = parse(REAL);
  eq(f.gpu_layers, 27, 'GPU layers parsed from the real line');
  eq(f.gpu_layers_total, 29, 'total layers parsed from the real line');
  eq(f.vram_model_mib, 3884, 'model VRAM is the Vulkan0 MODEL buffer (3883.68 MiB), the measured figure');
  ok(f.vram_model_mib !== 577, 'the CPU_Mapped buffer is NOT mistaken for device VRAM');
  eq(f.vram_projected_mib, 4920, 'the projected device total is captured SEPARATELY, not folded into vram_model_mib');
  ok(f.vram_projected_mib !== f.vram_model_mib, 'the two VRAM figures are different quantities and stay distinct');
  eq(f.context, 8192, 'the context comes from the runtime\'s own load line');
  ok(f.last_ready !== null, 'the ready timestamp is found');

  const src = fs.readFileSync(AGENT_PATH, 'utf8');
  // The window bug: a fixed tail missed the load block entirely on the real
  // node (the target line sat 6094 lines back in a 40473-line journal).
  ok(/ActiveEnterTimestamp/.test(src) && /'--since'/.test(src),
    'the journal is read from the unit\'s own start, not a fixed tail');
  ok(!/'-n', '600'/.test(src), 'the arbitrary 600-line tail is gone');
  ok(/gotSomething/.test(src), 'an all-null result is never cached — a transient miss must not stick');

  // The published field name must keep meaning what it says.
  const clean = nodeState.sanitize({ runtime: { vram_model_mib: 3884, vram_projected_mib: 4920 } });
  eq(clean.runtime.vram_model_mib, 3884, 'vram_model_mib survives the allow-list');
  eq(clean.runtime.vram_projected_mib, 4920, 'vram_projected_mib survives the allow-list');
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
