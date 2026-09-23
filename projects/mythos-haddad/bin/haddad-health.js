#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS HADDAD — V0 health check
// projects/mythos-haddad/bin/haddad-health.js
//
// Verifies every V0 acceptance item on the machine itself and writes one
// JSON report per run. Zero npm dependencies, no root, read-only: it never
// changes configuration.
//
//   haddad-health.js            human summary, full run, report logged
//   haddad-health.js --json     JSON report on stdout
//   haddad-health.js --quick    skip the slow checks (GPU test, network)
//   haddad-health.js --no-log   do not write the report to the log dir
//
// Exit code: 0 = no FAIL (WARN allowed), 1 = at least one FAIL.
// =====================================================
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');

var ARGS = process.argv.slice(2);
var QUICK = ARGS.indexOf('--quick') !== -1;
var AS_JSON = ARGS.indexOf('--json') !== -1;
var NO_LOG = ARGS.indexOf('--no-log') !== -1;

var HOME = os.homedir();
var STATE_DIR = process.env.HADDAD_STATE_DIR || path.join(HOME, '.local', 'state', 'mythos-haddad');
var DATA_DIR = process.env.HADDAD_DATA_DIR || path.join(HOME, '.local', 'share', 'mythos-haddad');
var LOG_DIR = path.join(STATE_DIR, 'logs');
var KEEP_REPORTS = 200;
var MIN_NODE_MAJOR = 20;
var SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8'];

var checks = [];

// A timed-out or signalled child returns status null and an EMPTY stderr, so
// every caller that reports `r.err` rendered a bare "FAIL <check>: " with no
// reason. That is how the 2026-09-22 22:12 report — taken while the machine
// had 294 MiB free and load 18 — came to state "npm MISSING" and "claude is
// not on PATH" about a machine where both were installed and on PATH: the
// children were killed at the 30 s deadline, not absent. A check that cannot
// run must say so; it must never be read as a check that ran and found the
// thing missing. The status is unchanged (still a FAIL) — only the reason is
// now truthful.
function sh(cmd, args, opts) {
  var o = Object.assign({ encoding: 'utf8', timeout: 30000 }, opts || {});
  var r = cp.spawnSync(cmd, args || [], o);
  var err = (r.stderr || '').trim();
  var timedOut = !!(r.error && r.error.code === 'ETIMEDOUT') || (r.status === null && r.signal === 'SIGTERM');
  if (timedOut && !err) err = cmd + ' did not finish within ' + Math.round(o.timeout / 1000) + 's (killed; the host may be under memory or CPU pressure)';
  else if (r.error && !err) err = String(r.error.message || r.error.code);
  return { ok: !r.error && r.status === 0, code: r.status, out: (r.stdout || '').trim(), err: err,
    missing: !!(r.error && r.error.code === 'ENOENT'), timed_out: timedOut };
}
function firstLine(s) { return String(s || '').split('\n')[0]; }
function add(id, status, detail, data) { checks.push({ id: id, status: status, detail: detail, data: data || undefined }); }
function check(id, fn) {
  try { fn(); } catch (e) { add(id, 'FAIL', 'check crashed: ' + (e && e.message)); }
}

// ---------- system ----------
check('os', function () {
  var rel = {};
  fs.readFileSync('/etc/os-release', 'utf8').split('\n').forEach(function (l) {
    var m = /^([A-Z_]+)=(.*)$/.exec(l); if (m) rel[m[1]] = m[2].replace(/^"|"$/g, '');
  });
  add('os', rel.ID === 'ubuntu' ? 'PASS' : 'WARN', rel.PRETTY_NAME + ', kernel ' + os.release(), { id: rel.ID, version: rel.VERSION_ID, kernel: os.release() });
});

check('resources', function () {
  var usedPct = parseInt(sh('df', ['--output=pcent', '/']).out.split('\n').pop(), 10);
  if (isNaN(usedPct)) return add('resources', 'FAIL', 'could not read disk usage of /');
  var memFreeMiB = Math.round(os.freemem() / 1048576), memTotalMiB = Math.round(os.totalmem() / 1048576);
  var load1 = os.loadavg()[0], cpus = os.cpus().length;
  var bad = usedPct >= 95, warn = usedPct >= 85 || load1 > cpus * 2;
  add('resources', bad ? 'FAIL' : warn ? 'WARN' : 'PASS',
    'disk / ' + usedPct + '% used, RAM ' + memFreeMiB + '/' + memTotalMiB + ' MiB free, load ' + load1.toFixed(2) + ' on ' + cpus + ' CPUs',
    { disk_used_pct: usedPct, mem_free_mib: memFreeMiB, mem_total_mib: memTotalMiB, load1: load1, cpus: cpus, uptime_s: Math.round(os.uptime()) });
});

check('systemd', function () {
  var r = sh('systemctl', ['--failed', '--no-legend', '--plain']);
  var failed = r.out ? r.out.split('\n').map(function (l) { return l.trim().split(/\s+/)[0]; }) : [];
  add('systemd', failed.length ? 'WARN' : 'PASS', failed.length ? 'failed units: ' + failed.join(', ') : 'no failed units', { failed: failed });
});

// ---------- SSH ----------
check('ssh', function () {
  var active = sh('systemctl', ['is-active', 'ssh']).out === 'active' || sh('systemctl', ['is-active', 'ssh.socket']).out === 'active';
  var listening = /:22\s/.test(sh('ss', ['-tln']).out);
  if (!active || !listening) return add('ssh', 'FAIL', 'sshd active=' + active + ' listening on :22=' + listening);
  var login = sh('ssh', SSH_OPTS.concat([os.hostname(), 'true']));
  add('ssh', login.ok ? 'PASS' : 'FAIL', login.ok ? 'sshd active on :22, key login to ' + os.hostname() + ' works' : 'sshd is up but login failed: ' + firstLine(login.err));
});

// ---------- Tailscale + remote access ----------
check('tailscale', function () {
  var r = sh('tailscale', ['status', '--json']);
  if (r.missing) return add('tailscale', 'FAIL', 'tailscale is not installed');
  if (!r.ok) return add('tailscale', 'FAIL', firstLine(r.err || r.out));
  var st = JSON.parse(r.out), self = st.Self || {}, ip = (self.TailscaleIPs || [])[0];
  var peers = Object.keys(st.Peer || {}).map(function (k) { return st.Peer[k]; });
  var online = peers.filter(function (p) { return p.Online; }).map(function (p) { return p.HostName; });
  var up = st.BackendState === 'Running' && self.Online && !!ip;
  add('tailscale', up ? 'PASS' : 'FAIL', up ? 'running, ' + ip + ', ' + peers.length + ' peer(s), online: ' + (online.join(', ') || 'none') : 'backend ' + st.BackendState + ', online=' + self.Online,
    { ip: ip, backend: st.BackendState, peers: peers.length, peers_online: online });

  if (!up) return add('remote_access', 'FAIL', 'Tailscale is down, the machine is not reachable remotely');
  var viaTs = sh('ssh', SSH_OPTS.concat([os.userInfo().username + '@' + ip, 'true']));
  if (!viaTs.ok) return add('remote_access', 'FAIL', 'SSH over the Tailscale address failed: ' + firstLine(viaTs.err));
  // Evidence of a real remote peer: last accepted login from another tailnet address (needs journal read access).
  var j = sh('journalctl', ['-u', 'ssh', '--since', '-30d', '--no-pager', '-o', 'short-iso', '-g', 'Accepted']);
  var last = (j.out || '').split('\n').filter(function (l) { var m = / from (100\.\d+\.\d+\.\d+) /.exec(l); return m && m[1] !== ip; }).pop();
  add('remote_access', 'PASS', 'ssh ' + os.userInfo().username + '@' + ip + ' works' + (last ? '; last remote login ' + last.split(' ')[0] + ' from ' + / from (\S+)/.exec(last)[1] : '; no remote peer login seen in the last 30 days'),
    { command: 'ssh ' + os.userInfo().username + '@' + ip, last_remote_login: last ? last.split(' ')[0] : null });
});

// ---------- toolchain ----------
check('git', function () {
  var v = sh('git', ['--version']);
  if (!v.ok) return add('git', 'FAIL', 'git is not installed');
  if (QUICK) return add('git', 'PASS', v.out);
  var repo = path.resolve(__dirname, '..', '..', '..');
  var remote = sh('git', ['-C', repo, 'ls-remote', '--heads', 'origin', 'main'], { timeout: 20000 });
  add('git', remote.ok ? 'PASS' : 'WARN', v.out + (remote.ok ? ', origin reachable (main ' + remote.out.slice(0, 8) + ')' : ', origin NOT reachable: ' + firstLine(remote.err)));
});

check('node', function () {
  var major = parseInt(process.versions.node, 10), npm = sh('npm', ['--version']);
  var ok = major >= MIN_NODE_MAJOR && npm.ok;
  // MISSING is a claim about the machine; say it only when npm really was not
  // found. A timeout is a claim about this run.
  var npmState = npm.ok ? npm.out : npm.timed_out ? 'NOT MEASURED (' + npm.err + ')' : 'MISSING';
  add('node', ok ? 'PASS' : 'FAIL', 'node v' + process.versions.node + ', npm ' + npmState + (major < MIN_NODE_MAJOR ? ' (need node >= ' + MIN_NODE_MAJOR + ')' : ''));
});

check('claude_code', function () {
  var v = sh('claude', ['--version']);
  if (!v.ok) return add('claude_code', 'FAIL', v.timed_out ? 'claude --version ' + v.err : 'claude is not on PATH (run bin/haddad-setup.sh)');
  var a = sh('claude', ['auth', 'status'], { cwd: HOME });
  var loggedIn = false;
  try { loggedIn = JSON.parse(a.out).loggedIn === true; } catch (e) { loggedIn = /"loggedIn":\s*true/.test(a.out); }
  // Identity fields (email, org) are deliberately not copied into the report.
  add('claude_code', loggedIn ? 'PASS' : 'FAIL', firstLine(v.out) + (loggedIn ? ', authenticated' : ', NOT authenticated (run: claude auth login)'));
});

// ---------- GPU + AI runtime foundation ----------
check('gpu', function () {
  var pci = sh('lspci').out.split('\n').filter(function (l) { return /VGA|3D controller|Display controller/.test(l); });
  if (!pci.length) return add('gpu_detect', 'FAIL', 'no GPU on the PCI bus');
  var driver = ['nvidia', 'nouveau', 'amdgpu', 'i915', 'xe'].filter(function (m) { return fs.existsSync('/sys/module/' + m); });
  add('gpu_detect', 'PASS', pci.map(function (l) { return l.replace(/^\S+\s+/, ''); }).join('; ') + ' [driver: ' + (driver.join(',') || 'none') + ']', { driver: driver });

  if (QUICK) return add('gpu_test', 'WARN', 'skipped (--quick)');
  var t = sh('python3', [path.join(__dirname, 'gpu-vulkan-test.py')], { timeout: 120000 });
  var rep = null; try { rep = JSON.parse(t.out); } catch (e) { /* reported below */ }
  if (!rep) return add('gpu_test', 'FAIL', 'GPU test produced no report: ' + firstLine(t.err || t.out));
  add('gpu_test', rep.status === 'PASS' ? 'PASS' : 'FAIL',
    rep.status === 'PASS' ? rep.device.name + ', Vulkan ' + rep.device.vulkan_api + ', ' + rep.vram_mib + ' MiB VRAM, fill ' + rep.fill.mib_per_s + ' MiB/s, roundtrip ' + rep.roundtrip.mib_per_s + ' MiB/s' : (rep.error || 'data verification failed'),
    rep);
});

check('runtime', function () {
  var missing = [];
  var py = sh('python3', ['--version']); if (!py.ok) missing.push('python3');
  var vk = sh('sh', ['-c', 'ldconfig -p | grep -q libvulkan.so.1']); if (!vk.ok) missing.push('libvulkan1');
  var render = fs.readdirSync('/dev/dri').filter(function (f) { return /^renderD/.test(f); });
  var renderOk = render.some(function (f) { try { fs.accessSync('/dev/dri/' + f, fs.constants.R_OK | fs.constants.W_OK); return true; } catch (e) { return false; } });
  if (!renderOk) missing.push('read/write access to /dev/dri/renderD*');
  ['models', 'runtime'].forEach(function (d) { if (!fs.existsSync(path.join(DATA_DIR, d))) missing.push(path.join(DATA_DIR, d)); });
  add('runtime', missing.length ? 'FAIL' : 'PASS', missing.length ? 'missing: ' + missing.join(', ') : py.out + ', Vulkan loader, GPU render node and ' + DATA_DIR + '/{models,runtime} ready');
});

// ---------- HAD-2: local AI runtime (llama-server, optional) ----------
// Three distinguishable states, not two. This model takes MINUTES to become
// answerable, and the health timer's OnBootSec=3min lands inside that
// window. Both boots of 2026-09-22 were timed on this host:
//   GPU boot  — active 22:40:46, "main: model loaded" 22:42:54 = 128 s
//   CPU boot  — active 22:14:53, "main: model loaded" 22:18:21 = 208 s
//               (that instance logged "ggml_vulkan: No devices found" and
//               ran entirely on CPU; the budget must cover it, because a
//               degraded boot is exactly when a false FAIL is most costly)
// Reporting the model's own "Loading model" 503 as FAIL made a correct
// boot look like a runtime failure; suppressing it would hide a real one.
// So the loading window is a readiness state (WARN), and it is bounded by
// the unit's OWN declared startup budget — TimeoutStartSec, read back from
// systemd — not by a second constant invented here. Past that budget a
// runtime that still will not answer is a FAIL, exactly as before.
check('ai_runtime', function () {
  var unitFile = path.join(HOME, '.config', 'systemd', 'user', 'mythos-haddad-runtime.service');
  if (!fs.existsSync(unitFile)) return add('ai_runtime', 'WARN', 'not installed (optional, HAD-2: run bin/haddad-runtime-setup.sh)');

  var active = sh('systemctl', ['--user', 'is-active', 'mythos-haddad-runtime.service']).out;
  if (active !== 'active') return add('ai_runtime', 'FAIL', 'unit installed but not active (' + active + '): journalctl --user -u mythos-haddad-runtime');

  // How long this unit has been active, and how long it is allowed to take
  // to come up. Both are systemd's own properties of this same unit — the
  // telemetry agent already windows its journal reads on ActiveEnterTimestamp
  // (bin/haddad-telemetry.js, runtimeLoadFacts), so this reads the pair the
  // same way rather than adding a timer, a retry loop or a state file.
  // InvocationID identifies THIS start of the unit. It is asked for in the
  // same call as the other two and handed to runtimeLoadFacts below, which
  // uses it to read exactly this instance's journal: the timestamp window it
  // otherwise falls back on carries 60 s of slack, and a restart inside that
  // slack would let the PREVIOUS instance's offload line vouch for a new
  // CPU-only one — the very false PASS this check exists to prevent.
  var show = sh('systemctl', ['--user', 'show', 'mythos-haddad-runtime.service',
    '-p', 'ActiveEnterTimestamp', '-p', 'TimeoutStartUSec', '-p', 'InvocationID', '-p', 'ExecStart']);
  var props = {};
  show.out.split('\n').forEach(function (l) { var m = /^([A-Za-z]+)=(.*)$/.exec(l); if (m) props[m[1]] = m[2]; });
  var activeSinceMs = Date.parse(props.ActiveEnterTimestamp || '');
  var activeForS = isFinite(activeSinceMs) ? Math.round((Date.now() - activeSinceMs) / 1000) : null;
  // TimeoutStartUSec prints as systemd time ("10min", "2min 30s", "infinity").
  var budgetS = null;
  if (props.TimeoutStartUSec && props.TimeoutStartUSec !== 'infinity') {
    budgetS = 0;
    String(props.TimeoutStartUSec).replace(/(\d+)(min|ms|us|s|h)/g, function (_, n, u) {
      var mul = { h: 3600, min: 60, s: 1, ms: 0.001, us: 0.000001 }[u];
      budgetS += parseInt(n, 10) * mul; return '';
    });
    budgetS = Math.round(budgetS) || null;
  }
  // Whether THIS unit is supposed to use a GPU at all, taken from its own argv
  // rather than assumed, so the offload assertion below holds a host to the
  // configuration it actually declares instead of to a policy this check
  // invented. Same principle as the startup budget above: the unit is the
  // source of truth about itself.
  //
  // ONLY AN EXPLICIT OPT-OUT COUNTS. `--n-gpu-layers 0` is an operator saying
  // "CPU on purpose", and failing that host would be wrong. Everything else —
  // a flag with any other value, NO flag at all, or an unreadable ExecStart —
  // means the assertion stays armed. That asymmetry is deliberate: reading a
  // missing flag as "CPU intended" would mean this unit could silently lose
  // its GPU assertion by losing a line, which is the same class of quiet
  // regression the assertion exists to catch. A false FAIL is loud and
  // explicable; a silently disabled check is neither.
  var ngl = /--n-gpu-layers[= ]+(\S+)/.exec(props.ExecStart || '');
  var gpuIntended = !(ngl && /^(0|off|none)$/i.test(ngl[1]));

  // Only a runtime that is genuinely inside its declared startup window may
  // report a non-failure without answering. Unknown timestamp or unknown
  // budget means no grace at all — an unreadable clock must never buy one.
  var starting = activeForS !== null && budgetS !== null && activeForS < budgetS;
  var elapsed = 'active ' + (activeForS === null ? '?' : activeForS) + 's of ' + (budgetS === null ? '?' : budgetS) + 's startup budget';
  function notReady(why) {
    return add('ai_runtime', starting ? 'WARN' : 'FAIL',
      (starting ? 'STARTING — ' : 'active but ') + why + ' (' + elapsed + ')',
      { ready: false, starting: starting, active_for_s: activeForS, startup_budget_s: budgetS });
  }

  var keyFile = path.join(HOME, '.config', 'mythos-haddad', 'runtime.key');
  var key = '';
  try { key = fs.readFileSync(keyFile, 'utf8').trim(); } catch (e) { return add('ai_runtime', 'FAIL', 'unit active but ' + keyFile + ' is unreadable'); }

  // -w '%{http_code}' rather than -f: the model's loading reply is a 503 with
  // a body that says WHICH state it is in, and -f would throw that body away.
  var curlArgs = ['-s', '-m', '10', '-w', '\n%{http_code}', '-H', 'Authorization: Bearer ' + key, 'http://127.0.0.1:8600/v1/models'];
  var r = sh('curl', curlArgs, { timeout: 15000 });
  if (!r.ok) return notReady('/v1/models did not answer: ' + firstLine(r.err || r.out));
  var lines = r.out.split('\n');
  var code = parseInt(lines.pop(), 10);
  var body = lines.join('\n');
  var parsed = null; try { parsed = JSON.parse(body); } catch (e) { /* reported below */ }

  // State 2: the server is up and answering, and its answer is "not yet".
  if (code === 503 || (parsed && parsed.error)) {
    var msg = (parsed && parsed.error && parsed.error.message) || firstLine(body) || ('HTTP ' + code);
    return notReady('the model is not loaded yet: ' + msg);
  }
  if (code !== 200) return notReady('/v1/models returned HTTP ' + code + ': ' + firstLine(body));
  var modelId = parsed && parsed.data && parsed.data[0] && parsed.data[0].id;
  if (!modelId) return notReady('/v1/models returned no model: ' + firstLine(body));

  // State 3: loaded. Nothing below this line is reachable while loading, so
  // a PASS here still means exactly what it meant before — the model answers.
  //
  // ...and that it answers FROM THE GPU. Answering was never enough: on
  // 2026-09-22 the runtime came up with "ggml_vulkan: No devices found",
  // served entirely from CPU, and this check passed 16/16 twice against it
  // (22:21:43 and 22:24:46). gpu_test probes the card in its own process, so
  // it saw a healthy GPU the runtime was not using — two checks that were
  // each true and together said something false.
  //
  // The evidence is llama-server's own load accounting, and it is read
  // through bin/haddad-telemetry.js's EXISTING parser rather than a second
  // one written here: same regexes, same ActiveEnterTimestamp window, same
  // cache keyed on the unit's start. No GPU probe of our own, no nvidia-smi,
  // no Vulkan call — this check adds no GPU mechanism, it reads the one the
  // runtime already prints.
  //
  // haddad-gpu-vram.py (VK_EXT_memory_budget) is NOT used here: verified on
  // this host to report 0 MiB used even with ~4.4 GB genuinely resident on
  // the GPU (NVK does not track heapUsage yet) — showing it would be a
  // confidently wrong number, worse than no number. See docs/AI_RUNTIME.md,
  // Measurements, for how VRAM was actually measured (the runtime's own
  // memory-fit log line, cross-checked against low process RSS).
  var facts = {};
  try { facts = require('./haddad-telemetry.js').runtimeLoadFacts(props.ActiveEnterTimestamp || null, props.InvocationID || null) || {}; }
  catch (e) { facts = { unreadable: e && e.message }; }
  var layers = facts.gpu_layers, total = facts.gpu_layers_total;
  var base = 'llama-server active, model "' + modelId + '" loaded, http://127.0.0.1:8600/v1 answers';
  var data = { model: modelId, ready: true, starting: false, active_for_s: activeForS, startup_budget_s: budgetS,
    gpu_layers: layers === undefined ? null : layers, gpu_layers_total: total === undefined ? null : total,
    no_devices: facts.no_devices === undefined ? null : facts.no_devices, gpu_source: facts.source || null };

  data.gpu_intended = gpuIntended;
  // A unit that never asked for the GPU is not failing by not using it.
  if (!gpuIntended) {
    return add('ai_runtime', 'PASS', base + ', CPU-only by configuration (--n-gpu-layers ' + ngl[1] + ')', data);
  }
  // A runtime that found no device, or offloaded nothing, is a REAL failure:
  // it is serving from CPU on a machine bought for the card, at a fraction of
  // the speed, and the whole point of this node is that it does not.
  if (facts.no_devices === true || layers === 0) {
    return add('ai_runtime', 'FAIL', base + ', but it is running ON CPU — ' +
      (facts.no_devices === true ? 'the runtime found no GPU device' : 'it offloaded 0 layers') +
      '. Restart the runtime once /dev/dri/renderD128 is available: systemctl --user restart mythos-haddad-runtime',
      data);
  }
  // Unproven is not the same as proven bad, and it is not the same as proven
  // good either. Saying PASS here is exactly the false PASS this check exists
  // to stop, so an unreadable journal is a WARN that says so.
  if (typeof layers !== 'number' || layers <= 0) {
    return add('ai_runtime', 'WARN', base + ', but GPU offload is NOT VERIFIED: no load accounting for this ' +
      'instance in the journal' + (facts.unreadable ? ' (' + facts.unreadable + ')' : ''), data);
  }
  add('ai_runtime', 'PASS', base + ', ' + layers + '/' + (total || '?') + ' layers on the GPU', data);
});

// ---------- HAD-3: executor daemon (the GitHub worker, optional) ----------
check('worker', function () {
  var unitFile = path.join(HOME, '.config', 'systemd', 'user', 'mythos-haddad-worker.service');
  if (!fs.existsSync(unitFile)) return add('worker', 'WARN', 'not installed (optional, HAD-3: run bin/haddad-worker-setup.sh)');
  var active = sh('systemctl', ['--user', 'is-active', 'mythos-haddad-worker.service']).out;
  if (active !== 'active') return add('worker', 'FAIL', 'unit installed but not active (' + active + '): journalctl --user -u mythos-haddad-worker');
  // /health is the executor's one unauthenticated route (loopback). Its
  // `ok` folds in VPS-only probes (n8n, omniroute) that do not exist here,
  // so the facts read are the store, the queue and the code identity.
  var r = sh('curl', ['-s', '-m', '10', 'http://127.0.0.1:8130/health'], { timeout: 15000 });
  var h = null; try { h = JSON.parse(r.out); } catch (e) { /* reported below */ }
  if (!h || !h.checks) return add('worker', 'FAIL', 'active but 127.0.0.1:8130/health did not answer: ' + firstLine(r.err || r.out));
  var queue = h.checks.queue || {};
  var ci = h.code_identity || {};
  var bearer = fs.existsSync(path.join(HOME, '.config', 'mythos-ai-executor', 'executor.env'));
  var detail = 'executor daemon active on 127.0.0.1:8130, store ' + (h.checks.store_writable ? 'writable' : 'NOT writable') + ', queue ' +
    (Object.keys(queue).map(function (k) { return k + '=' + queue[k]; }).join(' ') || 'empty') + ', code ' + (ci.branch || '?') + '@' + String(ci.head || '').slice(0, 8) +
    (bearer ? '' : ', NO bearer provisioned (authenticated routes refuse; run bin/haddad-mcp-setup.sh)');
  add('worker', h.checks.store_writable && bearer ? 'PASS' : 'WARN', detail, { queue: queue, branch: ci.branch, head: ci.head, pid: ci.pid, bearer_provisioned: bearer });
});

// ---------- HAD-3: OTH MCP over SSH-stdio (optional) ----------
check('mcp', function () {
  var launcher = path.join(HOME, '.local', 'bin', 'haddad-mcp-stdio.sh');
  if (!fs.existsSync(launcher)) return add('mcp', 'WARN', 'not installed (optional, HAD-3: run bin/haddad-mcp-setup.sh)');

  // Drive the installed launcher exactly as a client does, through the
  // existing MYTHOS MCP client: initialize, tools/list, then ONE real read
  // (execution_status) through the Haddad executor. No daemon, no port.
  var r = sh('node', [path.join(__dirname, 'haddad-mcp-probe.js'), launcher], { timeout: 45000 });
  var rep = null; try { rep = JSON.parse(r.out); } catch (e) { /* reported below */ }
  if (!rep) return add('mcp', 'FAIL', 'probe produced no report: ' + firstLine(r.err || r.out));
  if (!rep.ok) return add('mcp', 'FAIL', 'launcher did not complete the MCP handshake: ' + (rep.error || 'unknown'), rep);
  // 8 shared tools, plus haddad_health when mcp.env names the health report.
  var expected = fs.existsSync(path.join(HOME, '.config', 'mythos-haddad', 'mcp.env')) &&
    /^OTH_MCP_HADDAD_HEALTH_FILE=/m.test(fs.readFileSync(path.join(HOME, '.config', 'mythos-haddad', 'mcp.env'), 'utf8')) ? 9 : 8;
  if (rep.tools.length !== expected) return add('mcp', 'FAIL', 'expected ' + expected + ' tools, got ' + rep.tools.length + ' (' + rep.tools.join(',') + ')', rep);
  // The MCP is stdio-only. The VPS bridge/gateway ports must not appear here.
  var listeners = sh('ss', ['-ltnH']).out.split('\n').map(function (l) { return (l.split(/\s+/)[3] || '').replace(/^.*:/, ''); }).filter(Boolean);
  var unexpected = listeners.filter(function (port) { return port === '8160' || port === '4444'; });
  if (unexpected.length) return add('mcp', 'FAIL', 'unexpected MCP listener on port ' + unexpected.join(',') + ' — the Haddad MCP is stdio-only by design', rep);
  rep.listeners = listeners;
  if (!rep.call.ok) {
    // The MCP is up; the executor chain behind execution_status is not. The
    // error names the owner (UPSTREAM_401 = bearer not loaded: restart the worker).
    return add('mcp', 'WARN', rep.server + ' over stdio, ' + rep.tools.length + ' tools, but execution_status failed: ' + firstLine(rep.call.error || '').slice(0, 120), rep);
  }
  add('mcp', 'PASS', rep.server + ' (protocol ' + rep.protocol + ') over stdio, ' + rep.tools.length + ' tools, execution_status answered from the Haddad executor, no listener', rep);
});

check('logs', function () {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.accessSync(LOG_DIR, fs.constants.W_OK);
  var timer = sh('systemctl', ['--user', 'is-active', 'mythos-haddad-health.timer']).out;
  add('logs', timer === 'active' ? 'PASS' : 'WARN', LOG_DIR + ' writable, scheduled health timer ' + (timer === 'active' ? 'active' : 'NOT active (run bin/haddad-setup.sh)'));
});

// ---------- report ----------
var counts = { PASS: 0, WARN: 0, FAIL: 0 };
checks.forEach(function (c) { counts[c.status]++; });
var report = {
  schema: 'mythos-haddad-health/1',
  host: os.hostname(),
  generated_at: new Date().toISOString(),
  mode: QUICK ? 'quick' : 'full',
  status: counts.FAIL ? 'FAIL' : counts.WARN ? 'WARN' : 'PASS',
  counts: counts,
  checks: checks
};

if (!NO_LOG) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    var file = path.join(LOG_DIR, 'health-' + report.generated_at.replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(STATE_DIR, 'health-latest.json'), JSON.stringify(report, null, 2) + '\n');
    fs.appendFileSync(path.join(LOG_DIR, 'health.log'), report.generated_at + ' ' + report.status + ' ' + report.mode + ' pass=' + counts.PASS + ' warn=' + counts.WARN + ' fail=' + counts.FAIL +
      checks.filter(function (c) { return c.status !== 'PASS'; }).map(function (c) { return ' [' + c.status + ' ' + c.id + ']'; }).join('') + '\n');
    fs.readdirSync(LOG_DIR).filter(function (f) { return /^health-.*\.json$/.test(f); }).sort().slice(0, -KEEP_REPORTS)
      .forEach(function (f) { fs.unlinkSync(path.join(LOG_DIR, f)); });
  } catch (e) { console.error('could not write health log: ' + e.message); }
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('MYTHOS HADDAD health — ' + report.host + ' — ' + report.generated_at + ' (' + report.mode + ')');
  checks.forEach(function (c) { console.log('  ' + (c.status + ' ').slice(0, 4) + ' ' + (c.id + '              ').slice(0, 14) + ' ' + c.detail); });
  console.log('RESULT: ' + report.status + '  (pass ' + counts.PASS + ', warn ' + counts.WARN + ', fail ' + counts.FAIL + ')');
}
process.exit(counts.FAIL ? 1 : 0);
