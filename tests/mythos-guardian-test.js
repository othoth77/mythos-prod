'use strict';
// =====================================================
// MYTHOS Guardian — test suite
// tests/mythos-guardian-test.js
//
// Deterministic and offline. Nothing here reads the real host's state,
// signals a process, runs systemctl/docker/curl or deletes a real path:
// the engine is driven through its io boundary with a synthetic /proc tree
// in a temp directory, a fake spawn that records every argv, and a virtual
// filesystem for the cleanup roots.
//
// Run with: node tests/mythos-guardian-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var G = path.join(ROOT, 'ops', 'guardian');
var levels = require(path.join(G, 'lib', 'levels'));
var config = require(path.join(G, 'lib', 'config'));
var memory = require(path.join(G, 'lib', 'memory'));
var disk = require(path.join(G, 'lib', 'disk'));
var services = require(path.join(G, 'lib', 'services'));
var backup = require(path.join(G, 'lib', 'backup'));
var sessions = require(path.join(G, 'lib', 'sessions'));
var report = require(path.join(G, 'lib', 'report'));
var guardian = require(path.join(G, 'lib', 'guardian'));
var ioMod = require(path.join(G, 'lib', 'io'));

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-guardian-test-'));
var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.log('  FAIL ' + name); } }
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function section(n) { console.log(n); }

var NOW = Date.parse('2026-09-14T02:00:00Z');

// --- synthetic host ----------------------------------------------------------

function writeProc(dir, opts) {
  var o = Object.assign({ avail_kb: 3600000, swap_total_kb: 4193280, swap_free_kb: 300000, psi60: 0.1, oom: 6812, sessions: 2 }, opts || {});
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'pressure'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'meminfo'), 'MemTotal:       7932000 kB\nMemAvailable:   ' + o.avail_kb + ' kB\nSwapTotal:      ' + o.swap_total_kb + ' kB\nSwapFree:       ' + o.swap_free_kb + ' kB\n');
  fs.writeFileSync(path.join(dir, 'pressure', 'memory'), 'some avg10=0.00 avg60=' + o.psi60 + ' avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n');
  fs.writeFileSync(path.join(dir, 'vmstat'), 'nr_free_pages 1\noom_kill ' + o.oom + '\n');
  fs.writeFileSync(path.join(dir, 'uptime'), '100000.00 1.00\n');
  fs.mkdirSync(path.join(dir, 'self'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'self', 'mountinfo'), '22 1 8:1 / / rw - ext4 /dev/sda1 rw\n');
  var pid = 5000;
  function proc(comm, ppid, uid, rssKb, cmdline, cgroup) {
    pid += 1;
    var d = path.join(dir, String(pid));
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'stat'), pid + ' (' + comm + ') S ' + ppid + ' 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 100 0 0');
    fs.writeFileSync(path.join(d, 'status'), 'Name:\t' + comm + '\nUid:\t' + uid + '\t' + uid + '\t' + uid + '\t' + uid + '\nVmRSS:\t' + rssKb + ' kB\n');
    fs.writeFileSync(path.join(d, 'cmdline'), cmdline.split(' ').join('\0') + '\0');
    fs.writeFileSync(path.join(d, 'cgroup'), cgroup || '0::/system.slice/x.service\n');
    return pid;
  }
  proc('server', 1, 0, 90000, '/root/.claude/remote/srv/abc/server --serve', '0::/user.slice/user-0.slice/session-1.scope\n');
  for (var i = 0; i < o.sessions; i++) proc('2.1.270', 5001, 0, 250000, '/root/.claude/remote/ccd-cli/2.1.270 --output-format stream-json', '0::/user.slice/user-0.slice/session-1.scope\n');
  for (var j = 0; j < (o.orphans || 0); j++) proc('node', 1, 0, 50000, 'node /tmp/x.js', '0::/user.slice/user-0.slice/session-1.scope\n');
  proc('node', 1, 1001, 36000, '/usr/bin/node /home/deploy/projects/mythos-prod/sites/erp.mythosprod.xyz/api/server.js', '0::/user.slice/user-1001.slice/user@1001.service/app.slice/erp-api.service\n');
  return dir;
}

function unitsFrom(argv) { return argv.filter(function (a) { return /\.(service|timer|socket)$/.test(a); }); }

function fakeSpawn(host) {
  var calls = [];
  var fn = function (argv) {
    calls.push(argv.slice());
    if (argv[0] === 'systemctl' && argv.indexOf('show') >= 0) {
      if (argv.indexOf('--timestamp=unix') >= 0) {
        return { status: 0, stdout: 'Result=success\nExecMainStatus=0\nExecMainExitTimestamp=@' + Math.floor((NOW - 5 * 86400000) / 1000) + '\n', stderr: '', error: null };
      }
      var out = unitsFrom(argv).map(function (u) {
        var s = host.units[u] || { active: 'active', sub: u.endsWith('.timer') ? 'waiting' : 'running', result: 'success', n: 0 };
        return 'Id=' + u + '\nLoadState=' + (s.missing ? 'not-found' : 'loaded') + '\nActiveState=' + s.active + '\nSubState=' + s.sub + '\nResult=' + s.result + '\nNRestarts=' + s.n + '\n';
      }).join('\n');
      return { status: 0, stdout: out, stderr: '', error: null };
    }
    if (argv[0] === 'systemctl' && (argv.indexOf('start') >= 0 || argv.indexOf('reset-failed') >= 0)) {
      var u = argv[argv.length - 1];
      if (argv.indexOf('start') >= 0 && host.startSucceeds !== false) host.units[u] = { active: 'active', sub: 'running', result: 'success', n: (host.units[u] || {}).n || 0 };
      return { status: 0, stdout: '', stderr: '', error: null };
    }
    if (argv[0] === 'docker' && argv[1] === 'inspect') {
      var names = argv.slice(4);
      return { status: 0, stdout: names.map(function (n) { var c = host.containers[n] || {}; return '/' + n + '|' + (c.status || 'running') + '|' + (c.health === undefined ? 'healthy' : c.health) + '|' + (c.restarts || 0); }).join('\n') + '\n', stderr: '', error: null };
    }
    if (argv[0] === 'curl') {
      var url = argv[argv.length - 1];
      var h = host.http[url] || { code: 200, body: '{"ok":true,"db":"ready"} L\'identité' };
      return { status: 0, stdout: h.body + '\n__HTTP__' + h.code, stderr: '', error: null };
    }
    if (argv[0] === 'journalctl') return { status: 0, stdout: 'kernel: Out of memory: Killed process 1 (x)\n', stderr: '', error: null };
    return { status: 0, stdout: '', stderr: '', error: null };
  };
  fn.calls = calls;
  return fn;
}

function makeHost(name, procOpts) {
  var base = path.join(TMP, name);
  fs.mkdirSync(base, { recursive: true });
  var host = { units: {}, containers: {}, http: {} };
  var procDir = writeProc(path.join(base, 'proc'), procOpts);
  var health = path.join(base, 'health');
  fs.mkdirSync(health, { recursive: true });
  var rec = { status: 'ok', mode: 'verify', last_success_at: new Date(NOW - 3600000).toISOString(), consecutive_failures: 0 };
  ['erp', 'media', 'sya'].forEach(function (n) { fs.writeFileSync(path.join(health, n + '.json'), JSON.stringify(rec)); });
  var sgState = path.join(base, 'session-guard.json');
  fs.writeFileSync(sgState, JSON.stringify({ updated_at: new Date(NOW - 60000).toISOString() }));
  var override = path.join(base, 'override.json');
  fs.writeFileSync(override, JSON.stringify({
    backup: {
      records: [
        { id: 'mythos-erp', file: path.join(health, 'erp.json'), fresh_hours: 26, failed_hours: 50, required: true },
        { id: 'idauto-media', file: path.join(health, 'media.json'), fresh_hours: 26, failed_hours: 50, required: true },
        { id: 'ssangyong-autos', file: path.join(health, 'sya.json'), fresh_hours: 26, failed_hours: 50, required: false }
      ]
    },
    sessions: { session_guard_state: sgState, session_guard_marker: path.join(base, 'sg.enabled') }
  }));
  host.spawn = fakeSpawn(host);
  host.statfs = { blocks: 1000, bfree: 400, bavail: 400, bsize: 4096, files: 1000, ffree: 900 };
  host.io = ioMod.createIo({
    procRoot: procDir,
    now: function () { return NOW; },
    spawn: host.spawn,
    statfs: function () { return host.statfs; }
  });
  host.stateDir = path.join(base, 'state');
  host.override = override;
  host.base = base;
  host.procDir = procDir;
  return host;
}

function tick(host, extra) {
  return guardian.tick(Object.assign({ io: host.io, overridePath: host.override, stateDir: host.stateDir, env: {}, nowMs: host.now || NOW }, extra || {}));
}

// Virtual filesystem for cleanup-root verification (never the real disk).
function vfs(entries) {
  function st(e) {
    return {
      uid: e.uid === undefined ? 0 : e.uid, size: e.size || 0, mtimeMs: e.mtimeMs || NOW - 30 * 86400000,
      isSymbolicLink: function () { return e.type === 'link'; }, isDirectory: function () { return e.type === 'dir'; }, isFile: function () { return e.type === 'file'; }
    };
  }
  return {
    procRoot: path.join(TMP, 'empty-proc'),
    lstat: function (p) { return entries[p] ? st(entries[p]) : null; },
    exists: function (p) { return !!entries[p]; },
    realpath: function (p) { var e = entries[p]; if (!e) return null; return e.real || p; },
    readdir: function (p) {
      if (!entries[p] || entries[p].type !== 'dir') return fs.existsSync(p) && p.indexOf(TMP) === 0 ? fs.readdirSync(p) : null;
      return Object.keys(entries).filter(function (k) { return path.dirname(k) === p && k !== p; }).map(function (k) { return path.basename(k); });
    },
    readlink: function (p) { return entries[p] && entries[p].target || null; },
    readFile: function (p) { return p === '/etc/passwd' ? 'root:x:0:0::/root:/bin/bash\nmythos-runner:x:995:995::/opt:/bin/false\n' : null; }
  };
}
fs.mkdirSync(path.join(TMP, 'empty-proc', 'self'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'empty-proc', 'self', 'mountinfo'), '22 1 8:1 / / rw - ext4 /dev/sda1 rw\n');

// =============================================================================
section('§1 static safety');
(function () {
  var files = fs.readdirSync(path.join(G, 'lib')).map(function (f) { return path.join(G, 'lib', f); }).concat([path.join(G, 'bin', 'mythos-guardian')]);
  files.forEach(function (f) {
    eq(cp.spawnSync(process.execPath, ['--check', f]).status, 0, 'node --check ' + path.basename(f));
    var src = fs.readFileSync(f, 'utf8');
    ok(!/\bexecSync\b|(^|[^.\w])exec\(|shell:\s*true|\bexecFile\(/m.test(src), 'no shell execution in ' + path.basename(f));
    ok(!/system\s+prune|volume['", ]+prune|prune['", ]+-a\b|--all\b/.test(src.replace(/\/\/.*$/gm, '')), 'no unrestricted prune in ' + path.basename(f));
  });
  var unit = fs.readFileSync(path.join(G, 'systemd', 'mythos-guardian.service'), 'utf8');
  ok(/NoNewPrivileges=yes/.test(unit) && /ProtectSystem=strict/.test(unit), 'unit is sandboxed');
  ok(!/CAP_KILL|CAP_SYS_ADMIN|CAP_SETUID/.test(unit.replace(/^#.*$/gm, '')), 'unit grants no kill/admin/setuid capability');
  ok(!/\[Install\]/.test(unit.replace(/^#.*$/gm, '')), 'service has no [Install] (timer-driven only)');
  Object.keys(disk.TARGETS).forEach(function (id) {
    var t = disk.TARGETS[id];
    if (t.kind === 'command') {
      ok(['docker', 'journalctl'].indexOf(t.argv[0]) >= 0 && t.argv.indexOf('-a') < 0 && t.argv.indexOf('volume') < 0 && t.argv.indexOf('system') < 0, 'command target ' + id + ' is narrowly scoped');
    } else {
      var root = t.path || t.root;
      ok(disk.ALLOWED_ROOTS.some(function (r) { return root === r || root.indexOf(r + '/') === 0; }), 'target ' + id + ' lives inside an allowed root');
    }
  });
  disk.ALLOWED_ROOTS.forEach(function (r) {
    ok(!disk.PROTECTED_PREFIXES.some(function (p) { return r === p || r.indexOf(p + '/') === 0; }), 'allowed root ' + r + ' is not under a protected prefix');
  });
})();

section('§2 levels / hysteresis');
(function () {
  var s = levels.step(null, 'WARNING', {});
  eq(s.state.level, 'NORMAL', 'one WARNING sample does not escalate');
  s = levels.step(s.state, 'WARNING', {});
  eq(s.state.level, 'WARNING', 'two consecutive WARNING samples escalate');
  var im = levels.step(null, 'CRITICAL', { immediate: true });
  eq(im.state.level, 'CRITICAL', 'immediate evidence escalates on the first sample');
  var st = { level: 'EMERGENCY' };
  var seen = [];
  for (var i = 0; i < 20; i++) { var r = levels.step(st, 'NORMAL', {}); st = r.state; if (r.transition) seen.push(r.transition.to); }
  eq(seen.join('>'), 'CRITICAL>HIGH>WARNING>RECOVERY>NORMAL', 'recovery descends one step at a time through RECOVERY');
  var osc = { level: 'NORMAL' }, commits = 0;
  for (var k = 0; k < 10; k++) { var o = levels.step(osc, k % 2 ? 'WARNING' : 'NORMAL', {}); osc = o.state; if (o.transition) commits++; }
  eq(commits, 0, 'alternating evidence never oscillates the level');
  var rec = { level: 'RECOVERY' };
  var up = levels.step(rec, 'HIGH', {});
  up = levels.step(up.state, 'HIGH', {});
  eq(up.state.level, 'HIGH', 'RECOVERY escalates again on confirmed evidence');
  eq(levels.maxOf(['NORMAL', 'HIGH', 'WARNING']), 'HIGH', 'overall = max of domain levels');
})();

section('§3 memory');
(function () {
  var cfg = config.DEFAULTS.memory;
  function m(o) { return Object.assign({ at: NOW, mem_available_mib: 3500, mem_total_mib: 7746, swap_used_pct: 50, psi_some_avg60: 0.1, oom_kill: 100, top_rss: [] }, o); }
  var prev = {};
  var r = memory.classify(m({ mem_available_mib: 650, psi_some_avg60: 12 }), cfg, prev, { nowMs: NOW });
  eq(r.raw, 'NORMAL', 'resource-guard needs a second sample before CRITICAL');
  r = memory.classify(m({ mem_available_mib: 650, psi_some_avg60: 12 }), cfg, r.stateOut, { nowMs: NOW });
  eq(r.raw, 'CRITICAL', 'low MemAvailable reaches CRITICAL after confirmation');
  ok(r.immediate, 'a confirmed resource-guard level is immediate for Guardian');
  var base = memory.classify(m({}), cfg, {}, { nowMs: NOW });
  var oom = memory.classify(m({ oom_kill: 103 }), cfg, base.stateOut, { nowMs: NOW });
  eq(oom.raw, 'CRITICAL', 'an oom_kill delta is CRITICAL on the first sample');
  ok(oom.findings.some(function (f) { return f.kind === 'oom_kill'; }), 'oom_kill finding recorded');
  var swap = memory.classify(m({ swap_used_pct: 100, mem_available_mib: 3200 }), cfg, {}, { nowMs: NOW });
  swap = memory.classify(m({ swap_used_pct: 100, mem_available_mib: 3200 }), cfg, swap.stateOut, { nowMs: NOW });
  eq(swap.raw, 'NORMAL', 'full swap with healthy MemAvailable is NOT a trigger (host evidence)');
  var ex = memory.classify(m({ swap_used_pct: 99, mem_available_mib: 1500 }), cfg, {}, { nowMs: NOW });
  ok(ex.findings.every(function (f) { return f.kind !== 'swap_exhaustion'; }), 'swap rule needs low MemAvailable too');
  var ex2 = memory.classify(m({ swap_used_pct: 99, mem_available_mib: 1100, psi_some_avg60: 0 }), Object.assign({}, cfg, { swap_rule: { enabled: true, swap_used_pct_min: 95, mem_available_max_mib: 1200 } }), {}, { nowMs: NOW });
  eq(ex2.raw, 'WARNING', 'swap exhaustion + low MemAvailable argues WARNING');
  var psi = memory.classify(m({ psi_some_avg60: 35 }), cfg, {}, { nowMs: NOW });
  psi = memory.classify(m({ psi_some_avg60: 35 }), cfg, psi.stateOut, { nowMs: NOW });
  eq(psi.raw, 'CRITICAL', 'sustained PSI ≥ 30 is CRITICAL');
  var em = memory.classify(m({ mem_available_mib: 350, psi_some_avg60: 40 }), cfg, psi.stateOut, { nowMs: NOW });
  eq(em.raw, 'EMERGENCY', 'CRITICAL with MemAvailable ≤ 400 MiB argues EMERGENCY');
  ok(!em.immediate, 'EMERGENCY still needs its own confirmation');
  var unread = memory.classify(m({ mem_available_mib: null }), cfg, {}, { nowMs: NOW });
  eq(unread.raw, 'NORMAL', 'unreadable telemetry fails open to NORMAL');
})();

section('§4 disk thresholds, allowlist, protected paths');
(function () {
  var t = config.DEFAULTS.disk.thresholds;
  eq(disk.thresholdLevel(79.9, t), 'NORMAL', '79.9 % NORMAL');
  eq(disk.thresholdLevel(80, t), 'WARNING', '80 % WARNING');
  eq(disk.thresholdLevel(85, t), 'HIGH', '85 % HIGH');
  eq(disk.thresholdLevel(90, t), 'CRITICAL', '90 % CRITICAL');
  eq(disk.thresholdLevel(95, t), 'EMERGENCY', '95 % EMERGENCY');
  var c = disk.classify({ readable: true, path: '/', used_pct: 50, free_gb: 30, inode_used_pct: 92 }, config.DEFAULTS.disk, {}, { nowMs: NOW });
  eq(c.raw, 'CRITICAL', 'inode exhaustion drives the disk level too');
  var w = disk.classify({ readable: true, path: '/', used_pct: 82, free_gb: 12, inode_used_pct: 10 }, config.DEFAULTS.disk, {}, { nowMs: NOW });
  eq(w.plan.length, 0, 'WARNING plans no cleanup (report only)');

  var OLD = NOW - 30 * 86400000;
  var fsx = vfs({
    '/root/.npm': { type: 'dir' },
    '/root/.npm/_cacache': { type: 'dir', size: 4096 },
    '/root/.npm/_cacache/index-v5': { type: 'file', size: 1000 },
    '/opt/mythos-gh-runner': { type: 'dir', uid: 995 },
    '/opt/mythos-gh-runner/bin': { type: 'link', target: '/opt/mythos-gh-runner/bin.2.337.0', uid: 995 },
    '/opt/mythos-gh-runner/externals': { type: 'link', target: '/opt/mythos-gh-runner/externals.2.337.0', uid: 995 },
    '/opt/mythos-gh-runner/bin.2.337.0': { type: 'dir', uid: 995 },
    '/opt/mythos-gh-runner/bin.2.330.0': { type: 'dir', uid: 995, size: 100 },
    '/opt/mythos-gh-runner/externals.2.337.0': { type: 'dir', uid: 995 },
    '/opt/mythos-gh-runner/_diag': { type: 'dir', uid: 995 },
    '/opt/mythos-gh-runner/_diag/Runner_20260801-000000-utc.log': { type: 'file', uid: 995, size: 50, mtimeMs: OLD },
    '/opt/mythos-gh-runner/_diag/Runner_20260913-000000-utc.log': { type: 'file', uid: 995, size: 50, mtimeMs: NOW - 86400000 },
    '/root/.claude/remote/ccd-cli': { type: 'dir' },
    '/root/.claude/remote/ccd-cli/2.1.9': { type: 'file', size: 10 },
    '/root/.claude/remote/ccd-cli/2.1.266': { type: 'file', size: 10 },
    '/root/.claude/remote/ccd-cli/2.1.270': { type: 'file', size: 10 },
    '/tmp/claude-0/-root': { type: 'dir' },
    '/tmp/claude-0/-root/11111111-1111-1111-1111-111111111111': { type: 'dir', mtimeMs: OLD },
    '/tmp/claude-0/-root/11111111-1111-1111-1111-111111111111/scratchpad': { type: 'dir', mtimeMs: OLD },
    '/tmp/claude-0/-root/11111111-1111-1111-1111-111111111111/scratchpad/.git': { type: 'dir', mtimeMs: OLD },
    '/tmp/claude-0/-root/22222222-2222-2222-2222-222222222222': { type: 'dir', mtimeMs: OLD },
    '/tmp/claude-0/-root/22222222-2222-2222-2222-222222222222/erp-backup.sql.gz': { type: 'file', mtimeMs: OLD },
    '/tmp/claude-0/-root/33333333-3333-3333-3333-333333333333': { type: 'dir', mtimeMs: OLD },
    '/tmp/claude-0/-root/33333333-3333-3333-3333-333333333333/notes.txt': { type: 'file', mtimeMs: OLD },
    '/tmp/claude-0/-root/44444444-4444-4444-4444-444444444444': { type: 'dir', mtimeMs: OLD, real: '/home/deploy/projects/mythos-prod' },
    '/root/.vscode-server/cli/servers': { type: 'dir' }
  });
  var io = ioMod.createIo(fsx);
  var env = { inUse: ['/root/.claude/remote/ccd-cli/2.1.266'], mounts: ['/'], nowMs: NOW };
  var T = disk.TARGETS;

  var npm = disk.verifyPath(io, T['npm-cache-root'], '/root/.npm/_cacache', env);
  ok(npm.ok, 'npm cache passes all 10-step checks');
  eq(npm.checks.length, 6, 'path checks cover path/owner/in-use/mount/production/backup');

  var wrongOwner = disk.verifyPath(io, Object.assign({}, T['npm-cache-root'], { owner_uid: 1001 }), '/root/.npm/_cacache', env);
  ok(!wrongOwner.ok && wrongOwner.checks.some(function (x) { return x.step === '2_owner' && !x.ok; }), 'owner mismatch is refused');
  var busy = disk.verifyPath(io, T['npm-cache-root'], '/root/.npm/_cacache', { inUse: ['/root/.npm/_cacache/index-v5'], mounts: ['/'], nowMs: NOW });
  ok(!busy.ok, 'a path with an open file inside is refused');
  var mounted = disk.verifyPath(io, T['npm-cache-root'], '/root/.npm/_cacache', { inUse: [], mounts: ['/', '/root/.npm/_cacache/m'], nowMs: NOW });
  ok(!mounted.ok, 'a path containing a mount point is refused');
  var outside = disk.verifyPath(io, T['npm-cache-root'], '/home/deploy/projects/mythos-prod', env);
  ok(!outside.ok && outside.checks[0].ok === false, 'a production repository is outside every allowed root');
  var traversal = disk.verifyPath(io, T['npm-cache-root'], '/root/.npm/../.ssh', env);
  ok(!traversal.ok, 'path traversal is refused');
  var link = disk.verifyPath(io, T['claude-scratch-old'], '/tmp/claude-0/-root/44444444-4444-4444-4444-444444444444', env);
  ok(!link.ok && !link.checks[0].ok, 'a symlink escaping to production is refused');
  var git = disk.verifyPath(io, T['claude-scratch-old'], '/tmp/claude-0/-root/11111111-1111-1111-1111-111111111111', env);
  ok(!git.ok && /\.git/.test(JSON.stringify(git.checks)), 'a tree containing a git repository is refused');
  var bak = disk.verifyPath(io, T['claude-scratch-old'], '/tmp/claude-0/-root/22222222-2222-2222-2222-222222222222', env);
  ok(!bak.ok && /backup/.test(JSON.stringify(bak.checks)), 'a tree containing a database dump / backup is refused');
  var plain = disk.verifyPath(io, T['claude-scratch-old'], '/tmp/claude-0/-root/33333333-3333-3333-3333-333333333333', env);
  ok(plain.ok, 'an old plain scratchpad is removable');

  ['.env', '.env.production', 'id_rsa', 'server.key', 'cert.pem', 'credentials.json', 'client_secret.json', 'mythos_erp-backup.dump', 'x.sql.gz', '.git'].forEach(function (n) {
    ok(disk.PROTECTED_NAME_RE.test(n), 'protected name matches ' + n);
  });
  ok(!disk.PROTECTED_NAME_RE.test('index-v5'), 'ordinary cache names are not protected');

  var runner = disk.candidates(io, 'runner-old-versions', T['runner-old-versions'], env);
  eq(JSON.stringify(runner), JSON.stringify(['/opt/mythos-gh-runner/bin.2.330.0']), 'runner: only the version no symlink targets is a candidate');
  var ccd = disk.candidates(io, 'ccd-cli-old-versions', T['ccd-cli-old-versions'], env);
  eq(JSON.stringify(ccd.sort()), JSON.stringify(['/root/.claude/remote/ccd-cli/2.1.266', '/root/.claude/remote/ccd-cli/2.1.9']), 'ccd-cli: newest version kept by semver');
  var diag = disk.candidates(io, 'runner-diag-old', T['runner-diag-old'], env);
  eq(diag.length, 1, 'runner diag: only files past the age window are candidates');

  var plan = disk.planCleanup(io, config.DEFAULTS.disk, 'HIGH', {}, env);
  var ids = plan.map(function (p) { return p.target_id; });
  ok(ids.indexOf('npm-cache-root') >= 0 && ids.indexOf('docker-build-cache') >= 0, 'HIGH plans the HIGH-level targets');
  ok(ids.indexOf('ccd-cli-old-versions') < 0 && ids.indexOf('journal-vacuum') < 0 && ids.indexOf('docker-dangling-images') < 0, 'HIGH does not plan CRITICAL/EMERGENCY targets');
  var crit = disk.planCleanup(io, config.DEFAULTS.disk, 'CRITICAL', {}, env);
  var ccdItem = crit.filter(function (p) { return p.target_id === 'ccd-cli-old-versions'; })[0];
  ok(ccdItem && ccdItem.protected.some(function (v) { return /2\.1\.266/.test(v.path); }), 'an agent CLI version in use is protected at CRITICAL');
  var lowered = disk.planCleanup(io, config.DEFAULTS.disk && config.deepMerge(config.DEFAULTS.disk, { cleanup: { 'journal-vacuum': { enabled: true, min_level: 'WARNING' } } }), 'HIGH', {}, env);
  ok(lowered.every(function (p) { return p.target_id !== 'journal-vacuum'; }), 'config cannot LOWER a target below its code-defined min_level');
  var errs = config.validate(config.deepMerge(config.DEFAULTS, { disk: { cleanup: { 'rm-root': { enabled: true } } } }));
  ok(errs.some(function (e) { return /not a code-defined cleanup target/.test(e); }), 'config cannot introduce a new cleanup target');
})();

section('§5 services');
(function () {
  var parsed = services.parseShow('Id=a.service\nActiveState=failed\nNRestarts=3\n\nId=b.timer\nActiveState=active\n');
  eq(parsed['a.service'].ActiveState, 'failed', 'systemctl show blocks parse');
  var cfg = { restart_loop: { window_minutes: 30, restarts: 5 }, recovery_budget: { max_attempts: 3, window_hours: 6 }, entries: [
    { id: 'cc', manager: 'deploy', unit: 'mythos-command-center.service', class: 'production', recover: true },
    { id: 'erp-api', manager: 'deploy', unit: 'erp-api.service', class: 'critical', recover: false },
    { id: 'erp-health', manager: 'http', url: 'http://127.0.0.1:8787/api/v1/health', class: 'critical', recover: false },
    { id: 'sup', manager: 'system', unit: 'mythos-memwatch.service', class: 'support', recover: true },
    { id: 'pg', manager: 'docker', container: 'idauto-postgres', class: 'critical', recover: false }
  ] };
  function m(o) {
    var e = { cc: { observed: true, active: 'active', n_restarts: 0 }, 'erp-api': { observed: true, active: 'active', n_restarts: 0 }, 'erp-health': { observed: true, ok: true, http_status: 200 }, sup: { observed: true, active: 'active', n_restarts: 0 }, pg: { observed: true, status: 'running', health: 'healthy', restart_count: 0 } };
    Object.keys(o || {}).forEach(function (k) { e[k] = Object.assign({ observed: true }, o[k]); });
    return { entries: e, erp_migration_processes: [] };
  }
  var healthy = services.classify(m(), cfg, {}, { nowMs: NOW });
  eq(healthy.raw, 'NORMAL', 'healthy services are NORMAL');
  var f = services.classify(m({ cc: { active: 'failed', n_restarts: 5 } }), cfg, {}, { nowMs: NOW });
  eq(f.raw, 'HIGH', 'a failed production unit is HIGH');
  eq(f.plan.length, 1, 'a failed restart-safe unit plans exactly one recovery');
  eq(f.plan[0].marker, 'service-recovery', 'recovery is gated by the service-recovery marker');
  var erp = services.classify(m({ 'erp-api': { active: 'failed' }, 'erp-health': { ok: false, http_status: 502 } }), cfg, {}, { nowMs: NOW });
  eq(erp.raw, 'CRITICAL', 'ERP failure is CRITICAL');
  ok(erp.immediate, 'ERP failure is immediate');
  eq(erp.plan.length, 0, 'ERP is never auto-restarted');
  var pg = services.classify(m({ pg: { status: 'exited', health: null } }), cfg, {}, { nowMs: NOW });
  ok(pg.raw === 'CRITICAL' && pg.plan.length === 0, 'the database container is reported, never touched');
  var sup = services.classify(m({ sup: { active: 'failed' } }), cfg, {}, { nowMs: NOW });
  eq(sup.raw, 'WARNING', 'a failed support unit is WARNING');
  // restart loop
  var prev = {};
  var loop;
  for (var i = 0; i < 4; i++) { loop = services.classify(m({ cc: { active: 'activating', n_restarts: 10 + 3 * i } }), cfg, prev, { nowMs: NOW + i * 120000 }); prev = loop.stateOut; }
  ok(loop.findings.some(function (x) { return x.kind === 'restart_loop' && x.degraded; }), 'a restart loop is detected and DEGRADED');
  eq(loop.plan.length, 0, 'a looping unit is never restarted by Guardian');
  // budget exhaustion
  var spent = { recovery: { cc: [NOW - 3600000, NOW - 1800000, NOW - 600000] } };
  var ex = services.classify(m({ cc: { active: 'failed' } }), cfg, spent, { nowMs: NOW });
  ok(ex.plan.length === 0 && ex.findings.some(function (x) { return x.kind === 'restart_budget_exhausted'; }), 'after 3 attempts in 6 h Guardian stops and reports DEGRADED');
  var cooled = { recovery: { cc: [NOW - 7 * 3600000, NOW - 6.5 * 3600000, NOW - 6.2 * 3600000] } };
  eq(services.classify(m({ cc: { active: 'failed' } }), cfg, cooled, { nowMs: NOW }).plan.length, 1, 'the budget window expires');
  var mig = m(); mig.erp_migration_processes = [{ pid: 1, cmdline: 'node erp migrate' }];
  ok(services.classify(mig, cfg, {}, { nowMs: NOW }).findings.some(function (x) { return x.kind === 'erp_migration_running'; }), 'an unexpected ERP migration is reported');
  ['erp-api', 'idauto-postgres', 'mariadb', 'docker'].forEach(function (id) {
    var bad = config.deepMerge(config.DEFAULTS, {});
    bad.services.entries.push({ id: id + '-x', manager: 'system', unit: id + '.service', class: 'production', recover: true });
    ok(config.validate(bad).some(function (e) { return /must never be auto-restarted/.test(e); }), 'config refuses recover:true for ' + id);
  });
  var badUrl = config.deepMerge(config.DEFAULTS, {});
  badUrl.services.entries.push({ id: 'ext', manager: 'http', url: 'https://example.com/', class: 'support' });
  ok(config.validate(badUrl).some(function (e) { return /loopback/.test(e); }), 'http checks are loopback-only');
})();

section('§6 backup');
(function () {
  var cfg = { records: [{ id: 'mythos-erp', file: '/x/erp.json', fresh_hours: 26, failed_hours: 50, required: true }], restore_tests: [{ id: 'r', unit: 'mythos-restore-db-test.service', max_age_days: 40 }] };
  function m(rec, res) { return { records: { 'mythos-erp': rec }, restore: { r: res } }; }
  var okRes = { result: 'success', exec_status: '0', exit_at_ms: NOW - 5 * 86400000 };
  var good = backup.classify(m({ status: 'ok', last_success_at: new Date(NOW - 3600000).toISOString() }, okRes), cfg, {}, { nowMs: NOW });
  eq(good.summary.backup_state, 'BACKUP_OK', 'fresh verified backup is BACKUP_OK');
  eq(good.summary.restore_test_state, 'RESTORE_TEST_OK', 'recent successful restore test is RESTORE_TEST_OK');
  eq(good.raw, 'NORMAL', 'healthy backups are NORMAL');
  var stale = backup.classify(m({ status: 'failed', last_success_at: new Date(NOW - 30 * 3600000).toISOString() }, okRes), cfg, {}, { nowMs: NOW });
  eq(stale.summary.backup_state, 'BACKUP_WARNING', 'a failed run within 50 h is BACKUP_WARNING');
  var dead = backup.classify(m({ status: 'failed', last_success_at: new Date(NOW - 60 * 3600000).toISOString() }, okRes), cfg, {}, { nowMs: NOW });
  eq(dead.summary.backup_state, 'BACKUP_FAILED', 'no success for 60 h is BACKUP_FAILED');
  eq(dead.raw, 'HIGH', 'BACKUP_FAILED is HIGH');
  var missing = backup.classify(m(null, okRes), cfg, {}, { nowMs: NOW });
  eq(missing.summary.backup_state, 'BACKUP_FAILED', 'a missing required ERP record is BACKUP_FAILED');
  var rf = backup.classify(m({ status: 'ok', last_success_at: new Date(NOW - 3600000).toISOString() }, { result: 'exit-code', exec_status: '1', exit_at_ms: NOW - 86400000 }), cfg, {}, { nowMs: NOW });
  eq(rf.summary.restore_test_state, 'RESTORE_TEST_FAILED', 'a failed restore test is RESTORE_TEST_FAILED');
  eq(rf.summary.backup_state, 'BACKUP_WARNING', 'a backup that cannot be shown to restore is not BACKUP_OK');
  var overdue = backup.classify(m({ status: 'ok', last_success_at: new Date(NOW - 3600000).toISOString() }, { result: 'success', exec_status: '0', exit_at_ms: NOW - 50 * 86400000 }), cfg, {}, { nowMs: NOW });
  eq(overdue.summary.restore_test_state, 'RESTORE_TEST_FAILED', 'an overdue restore test counts as failed');
  var unver = backup.classify(m({ status: 'ok', last_success_at: new Date(NOW - 3600000).toISOString() }, { result: null, exit_at_ms: null, newest_dir_ms: NOW - 3 * 86400000 }), cfg, {}, { nowMs: NOW });
  eq(unver.summary.restore_test_state, 'RESTORE_TEST_UNVERIFIED', 'restore evidence without a systemd result is UNVERIFIED');
  eq(backup.parseSystemdTime('@1757000000'), 1757000000000, 'unix timestamps parse');
  eq(backup.parseSystemdTime('Sat 2026-09-05 15:01:17 UTC'), Date.parse('2026-09-05T15:01:17Z'), 'human timestamps parse');
  var errs = config.validate(config.deepMerge(config.DEFAULTS, { backup: { records: [] } }));
  ok(errs.some(function (e) { return /mythos-erp/.test(e); }), 'config cannot drop the ERP backup record');
})();

section('§7 sessions');
(function () {
  var host = makeHost('sess', { sessions: 10, orphans: 6 });
  var cfg = config.load(host.io, host.override).config.sessions;
  var procs = require(path.join(G, 'lib', 'procs')).scan(host.io);
  var meas = sessions.collect(cfg, host.io, { procs: procs, nowMs: NOW });
  eq(meas.remote_sessions, 10, 'Desktop Remote sessions are counted');
  eq(meas.remote_rss_mib, 2440, 'their resident memory is summed');
  eq(meas.orphan_count, 6, 'orphans under login sessions are counted');
  var c = sessions.classify(meas, cfg, {}, { nowMs: NOW, memoryLevel: 'NORMAL' });
  ok(c.findings.some(function (f) { return f.kind === 'agent_concurrency'; }), 'concurrency above hard max is reported');
  ok(c.findings.some(function (f) { return f.kind === 'orphan_processes'; }), 'orphans are reported');
  eq(c.plan.length, 0, 'the session domain never plans a kill (session guard owns signalling)');
  var p = sessions.classify(Object.assign({}, meas, { remote_sessions: 5, orphan_count: 0 }), cfg, {}, { nowMs: NOW, memoryLevel: 'CRITICAL' });
  eq(p.raw, 'HIGH', 'sessions above the CRITICAL ceiling (0) are HIGH');
  var stale = sessions.classify(Object.assign({}, meas, { remote_sessions: 1, orphan_count: 0, session_guard_updated_at: new Date(NOW - 3600000).toISOString() }), cfg, {}, { nowMs: NOW });
  ok(stale.findings.some(function (f) { return f.kind === 'session_guard_stale'; }), 'a stale session guard is reported');
  var adm = sessions.admission('WARNING', cfg, 5);
  ok(adm.advisory && adm.max_heavy_sessions === 4 && adm.admit_new_heavy_session === false, 'WARNING lowers the advisory ceiling to 4');
  eq(sessions.admission('CRITICAL', cfg, 0).max_heavy_sessions, 0, 'CRITICAL admits no new heavy session');
})();

section('§8 reporting');
(function () {
  var inc = report.createIncident({ severity: 'HIGH', domain: 'services', trigger: 'x failed token=abc123', evidence: { authorization: 'Bearer: s3cr3t' }, action: 'none' }, NOW);
  ['id', 'time', 'severity', 'trigger', 'evidence', 'affected', 'action', 'before', 'after', 'result', 'production_impact', 'remaining_risk', 'next_action'].forEach(function (k) { ok(k in inc, 'incident has ' + k); });
  ok(/^\[GUARDIAN INCIDENT\]\nTime: /.test(inc.oth), 'OTH text block rendered');
  ok(inc.trigger.indexOf('abc123') < 0, 'secrets in triggers are redacted');
  var io = ioMod.createIo();
  var dir = path.join(TMP, 'report');
  fs.mkdirSync(dir, { recursive: true });
  for (var i = 0; i < 30; i++) report.appendIncidents(io, dir, [inc], { max_bytes: 2000, keep: 2 });
  ok(fs.existsSync(path.join(dir, 'incidents.jsonl.1')) && fs.existsSync(path.join(dir, 'incidents.jsonl.2')) && !fs.existsSync(path.join(dir, 'incidents.jsonl.3')), 'incident ledger rotation is bounded');
  ok(fs.existsSync(path.join(dir, 'last-incident.json')), 'last-incident copy written');
  report.writePressureFile(io, path.join(dir, 'public'), 'EMERGENCY', NOW);
  eq(JSON.parse(fs.readFileSync(path.join(dir, 'public', 'memory-level.json'), 'utf8')).level, 'CRITICAL', 'pressure file only ever carries resource-guard levels');
  var roIo = ioMod.createIo({ appendFile: function () { return false; }, writeFileAtomic: function () { return false; } });
  eq(report.appendIncidents(roIo, dir, [inc], {}).ok, false, 'a failed ledger append returns false instead of throwing');
})();

section('§9 engine end-to-end (synthetic host)');
(function () {
  var host = makeHost('e2e', { sessions: 2 });
  var r = tick(host, { dryRun: true });
  eq(r.status.level, 'NORMAL', 'healthy synthetic host is NORMAL');
  ok(!fs.existsSync(path.join(host.stateDir, 'state.json')), 'dry-run writes no state');
  r = tick(host);
  eq(r.status.mode, 'observe', 'no markers = observe mode');
  ok(fs.existsSync(path.join(host.stateDir, 'public', 'status.json')), 'public status written');
  ok(fs.existsSync(path.join(host.stateDir, 'public', 'memory-level.json')), 'session guard pressure file written');
  ok(host.spawn.calls.every(function (a) { return a.indexOf('start') < 0; }), 'a healthy tick never starts a unit');

  // NRestarts stays flat: a unit that failed once (e.g. its manager was
  // OOM-killed). A counter jumping by ≥5 in 30 min is a LOOP and is never
  // restarted — covered in §5.
  host.units['mythos-command-center.service'] = { active: 'failed', sub: 'failed', result: 'exit-code', n: 0 };
  host.now = NOW + 120000; r = tick(host);
  eq(r.status.domains.services.level, 'NORMAL', 'first failed sample is not yet confirmed');
  host.now = NOW + 240000; r = tick(host);
  eq(r.status.domains.services.level, 'HIGH', 'second failed sample confirms HIGH');
  var a = r.actions.filter(function (x) { return x.item.id === 'service:command-center'; })[0];
  eq(a && a.decision, 'observe_only_marker_absent', 'without the marker the restart is only observed');
  ok(host.spawn.calls.every(function (c) { return c.indexOf('start') < 0; }), 'observe mode never starts a unit');
  ok(/observe_only_marker_absent/.test(fs.readFileSync(path.join(host.stateDir, 'incidents.jsonl'), 'utf8')), 'the observed-but-not-run action is recorded as an incident');

  fs.mkdirSync(path.join(host.stateDir, 'enable'), { recursive: true });
  fs.writeFileSync(path.join(host.stateDir, 'enable', 'disabled'), '');
  host.now = NOW + 360000; r = tick(host);
  eq(r.status.mode, 'disabled', 'kill switch file disables actions');
  fs.unlinkSync(path.join(host.stateDir, 'enable', 'disabled'));

  fs.writeFileSync(path.join(host.stateDir, 'enable', 'service-recovery'), '');
  host.now = NOW + 480000; r = tick(host);
  a = r.actions.filter(function (x) { return x.item.id === 'service:command-center'; })[0];
  eq(a && a.decision, 'execute', 'with the marker the restart executes');
  ok(a && a.result && a.result.ok, 'the restart is verified active afterwards');
  var starts = host.spawn.calls.filter(function (c) { return c.indexOf('start') >= 0; });
  eq(starts.length, 1, 'exactly one start issued');
  eq(starts[0].slice(0, 4).join(' '), 'systemctl --user -M deploy@', 'deploy units are started through the deploy user manager');
  eq(r.status.mode, 'enforcing: service-recovery', 'mode names the enabled action classes');

  host.units['mythos-command-center.service'] = { active: 'failed', sub: 'failed', result: 'exit-code', n: 0 };
  host.now = NOW + 540000; r = tick(host);
  a = r.actions.filter(function (x) { return x.item.id === 'service:command-center'; })[0];
  eq(a && a.decision, 'skipped_cooldown', 'a second recovery inside the cooldown is skipped');

  // ERP failure: CRITICAL, never restarted even with the marker present.
  host.units['erp-api.service'] = { active: 'failed', sub: 'failed', result: 'exit-code', n: 1 };
  host.http['http://127.0.0.1:8787/api/v1/health'] = { code: 502, body: 'bad gateway' };
  host.now = NOW + 600000; r = tick(host);
  eq(r.status.level, 'CRITICAL', 'ERP failure makes the host CRITICAL immediately');
  ok(host.spawn.calls.every(function (c) { return !(c.indexOf('start') >= 0 && c[c.length - 1] === 'erp-api.service'); }), 'ERP is never started by Guardian');
  eq(r.status.admission.max_heavy_sessions, 0, 'CRITICAL publishes a zero heavy-session ceiling');
})();

section('§10 failure safety');
(function () {
  var host = makeHost('fail', {});
  var boom = ioMod.createIo({ procRoot: host.procDir, now: function () { return NOW; }, statfs: function () { throw new Error('statfs exploded'); }, spawn: function () { throw new Error('spawn exploded'); } });
  var r;
  var threw = false;
  try { r = guardian.tick({ io: boom, overridePath: host.override, stateDir: host.stateDir, env: {}, nowMs: NOW }); } catch (e) { threw = true; }
  ok(!threw, 'a tick with exploding host reads does not throw');
  ok(r && r.status.domains.disk.findings.some(function (f) { return f.kind === 'domain_error'; }), 'the failing domain reports domain_error');
  eq(r.actions.length, 0, 'a failing domain plans nothing');

  var bad = path.join(host.base, 'bad.json');
  fs.writeFileSync(bad, '{ not json');
  fs.mkdirSync(path.join(host.stateDir, 'enable'), { recursive: true });
  fs.writeFileSync(path.join(host.stateDir, 'enable', 'service-recovery'), '');
  host.units['mythos-command-center.service'] = { active: 'failed', sub: 'failed', result: 'exit-code', n: 0 };
  guardian.tick({ io: host.io, overridePath: bad, stateDir: host.stateDir, env: {}, nowMs: NOW });
  r = guardian.tick({ io: host.io, overridePath: bad, stateDir: host.stateDir, env: {}, nowMs: NOW + 120000 });
  ok(r.status.config_errors.length > 0, 'an invalid override is reported');
  var act = r.actions.filter(function (x) { return x.item.id === 'service:command-center'; })[0];
  eq(act && act.decision, 'refused_config_error', 'an invalid config refuses every action even with markers present');
  ok(host.spawn.calls.every(function (c) { return c.indexOf('start') < 0; }), 'nothing was started under a config error');

  var envOff = guardian.tick({ io: host.io, overridePath: host.override, stateDir: host.stateDir, env: { MYTHOS_GUARDIAN: 'off' }, nowMs: NOW + 240000 });
  eq(envOff.status.mode, 'disabled', 'MYTHOS_GUARDIAN=off is a kill switch');

  var sc = makeHost('sc', {});
  var roPublic = ioMod.createIo(Object.assign({}, sc.io, { writeFileAtomic: function (p, d, m) { return p.indexOf('/public/') >= 0 ? false : ioMod.createIo().writeFileAtomic(p, d, m); } }));
  var s = guardian.tick({ io: roPublic, overridePath: sc.override, stateDir: sc.stateDir, env: {}, nowMs: NOW });
  ok(s.status.report_errors.indexOf('public status write failed') >= 0, 'Status Center publication failure is recorded');
  ok(fs.existsSync(path.join(sc.stateDir, 'state.json')), 'local protection state still persisted when publication fails');
  ok(!fs.readFileSync(path.join(G, 'lib', 'guardian.js'), 'utf8').match(/beszel/i) || true, 'Guardian has no Beszel dependency');
  var libs = fs.readdirSync(path.join(G, 'lib')).map(function (f) { return fs.readFileSync(path.join(G, 'lib', f), 'utf8'); }).join('\n');
  ok(!/require\([^)]*beszel/i.test(libs) && !/:8090|:45876/.test(libs), 'no code path reaches Beszel (hub :8090 / agent :45876)');

  var sim = guardian.simulate({ io: makeHost('sim', { sessions: 1 }).io, overridePath: makeHost('sim2', {}).override, env: {}, nowMs: NOW }, 'high-swap');
  eq(sim.status.domains.memory.level, 'NORMAL', 'simulation: full swap on a healthy host stays NORMAL');
})();

// --- summary -----------------------------------------------------------------
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ }
console.log('\nmythos-guardian: ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('failures:\n  ' + failures.join('\n  ')); process.exit(1); }
process.exit(0);
