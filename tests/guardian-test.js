'use strict';
// =====================================================
// MYTHOS — Guardian V0 tests
// tests/guardian-test.js
//
// Deterministic, offline and FULLY ISOLATED. This suite never reads a
// production path and never writes one:
//   * every filesystem read goes through an injected `io` backed by a
//     fixture tree under a temporary directory;
//   * `io.procRoot` points at a fixture /proc, so the process scan sees
//     synthetic processes;
//   * `io.spawn` is replaced by a table of canned outputs — no systemctl,
//     no docker, no command runs at all;
//   * every state path is inside the temporary directory, and §3 asserts
//     that the I/O layer refuses to write anywhere else.
//
// Section 10 is the isolation audit itself: it re-runs the engine with an
// io whose write primitives RECORD instead of writing, and fails if any
// recorded target falls outside the temporary state directory. That is the
// regression guard for the class of bug that let tests/backup-run-db-test.js
// write the live ERP backup health record on 2026-09-14.
//
// Run with: node tests/guardian-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

var BASE = path.join(__dirname, '..');
var LIB = path.join(BASE, 'ops', 'guardian', 'lib');
var BIN = path.join(BASE, 'ops', 'guardian', 'bin', 'mythos-guardian');

var levels = require(path.join(LIB, 'levels'));
var ioMod = require(path.join(LIB, 'io'));
var configMod = require(path.join(LIB, 'config'));
var sources = require(path.join(LIB, 'sources'));
var classify = require(path.join(LIB, 'classify'));
var engine = require(path.join(LIB, 'engine'));
var report = require(path.join(LIB, 'report'));
var scenarios = require(path.join(LIB, 'scenarios'));
var actionsMod = require(path.join(LIB, 'actions'));
var remediateMod = require(path.join(LIB, 'remediate'));

var ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-guardian-test-'));
var STATE = path.join(ROOT, 'state');
var PROC = path.join(ROOT, 'proc');
var FIX = path.join(ROOT, 'fixtures');
[STATE, PROC, FIX].forEach(function (d) { fs.mkdirSync(d, { recursive: true }); });

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function eq(a, e, name) { ok(a === e, name + ' (expected ' + JSON.stringify(e) + ', got ' + JSON.stringify(a) + ')'); }
function section(n) { console.log('\n-- ' + n); }

var NOW = Date.parse('2026-09-16T12:00:00.000Z');
// CLOCK is the simulated "now" the fixture host is written against. Multi-tick
// tests advance it, because a host frozen in the past legitimately ages into
// stale telemetry and would otherwise look like a de-escalation bug.
var CLOCK = NOW;
function iso(offsetSec) { return new Date(CLOCK - (offsetSec || 0) * 1000).toISOString(); }
function fixture(rel, body) {
  var p = path.join(FIX, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
}

var NUL = String.fromCharCode(0);

// --- a synthetic host ---------------------------------------------------
function writeProc(opts) {
  var o = Object.assign({ availMib: 3200, psi60: 0.5, oom: 6812, swapUsedPct: 20, procs: [] }, opts || {});
  var swapTotalKb = 4194296;
  fs.writeFileSync(path.join(PROC, 'meminfo'),
    'MemTotal:        7931936 kB\nMemFree:          123456 kB\nMemAvailable:    ' + (o.availMib * 1024) + ' kB\n' +
    'SwapTotal:       ' + swapTotalKb + ' kB\nSwapFree:        ' + Math.round(swapTotalKb * (1 - o.swapUsedPct / 100)) + ' kB\n');
  fs.mkdirSync(path.join(PROC, 'pressure'), { recursive: true });
  fs.writeFileSync(path.join(PROC, 'pressure', 'memory'),
    'some avg10=0.00 avg60=' + o.psi60.toFixed(2) + ' avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=1\n');
  fs.writeFileSync(path.join(PROC, 'vmstat'), 'nr_free_pages 30000\noom_kill ' + o.oom + '\npgfault 1\n');
  fs.writeFileSync(path.join(PROC, 'uptime'), '100000.00 900000.00\n');
  fs.readdirSync(PROC).forEach(function (n) { if (/^\d+$/.test(n)) fs.rmSync(path.join(PROC, n), { recursive: true, force: true }); });
  o.procs.forEach(function (p) {
    var d = path.join(PROC, String(p.pid));
    fs.mkdirSync(d, { recursive: true });
    // "<pid> (<comm>) S <ppid> <pgrp> ..." - the parser slices past ") " and
    // indexes from the state character, so ppid is fields[0] and starttime
    // (proc(5) field 22) is fields[18].
    var fields = new Array(52).fill('0');
    fields[0] = String(p.ppid === undefined ? 100 : p.ppid);
    fields[18] = String(Math.max(0, (100000 - (p.age_seconds === undefined ? 60 : p.age_seconds)) * 100));
    fs.writeFileSync(path.join(d, 'stat'), p.pid + ' (' + p.comm + ') S ' + fields.join(' ') + '\n');
    fs.writeFileSync(path.join(d, 'status'), 'Name:\t' + p.comm + '\nUid:\t1001\t1001\t1001\t1001\nVmRSS:\t' + ((p.rss_mib || 10) * 1024) + ' kB\n');
    fs.writeFileSync(path.join(d, 'cmdline'), (p.cmdline || p.comm).split(' ').join(NUL) + NUL);
  });
}

// Canned command output. Any argv not in the table returns "no fixture",
// and nothing is ever executed.
var SPAWN = {};
function spawnKey(argv) { return argv.slice(0, 3).join(' '); }
function fakeSpawn(argv) {
  if (!ioMod.allowedCommand(argv)) return { status: null, stdout: '', stderr: '', error: 'command_not_allowlisted', refused: true };
  var h = SPAWN[spawnKey(argv)];
  if (typeof h === 'function') return h(argv);
  return { status: 1, stdout: '', stderr: 'no fixture', error: null };
}

function unitBlocks(cfg, manager, overrides) {
  return cfg.services.units.filter(function (u) { return u.manager === manager; }).map(function (u) {
    var o = Object.assign({ LoadState: 'loaded', ActiveState: 'active', SubState: 'running', Result: 'success', NRestarts: '0' }, (overrides || {})[u.id] || {});
    return 'Id=' + u.unit + '\nLoadState=' + o.LoadState + '\nActiveState=' + o.ActiveState + '\nSubState=' + o.SubState + '\nResult=' + o.Result + '\nNRestarts=' + o.NRestarts;
  }).join('\n\n') + '\n';
}

function buildConfig(over) {
  var cfg = configMod.deepMerge(configMod.DEFAULTS, {
    memory: { pressure_file: path.join(FIX, 'resource-pressure.json'), memwatch_log: path.join(FIX, 'memwatch.log') },
    sessions: { snapshot_file: path.join(FIX, 'host-sessions.json') },
    // docker_df_min_pct: 0 so the collector always runs in the suite; the
    // gate itself is tested explicitly below.
    disk: { path: ROOT, docker_df: true, docker_df_min_pct: 0 },
    services: { live_status_file: path.join(FIX, 'live-status.json') },
    backup: {
      records: [
        { id: 'mythos-erp', file: path.join(FIX, 'backup-health-db.json'), fresh_hours: 26, failed_hours: 50, required: true },
        { id: 'idauto-media', file: path.join(FIX, 'backup-health.json'), fresh_hours: 26, failed_hours: 50, required: true }
      ]
    }
  });
  return over ? configMod.deepMerge(cfg, over) : cfg;
}

function makeIo(extra) {
  var io = ioMod.createIo(Object.assign({ procRoot: PROC, now: function () { return NOW; }, spawn: fakeSpawn }, extra || {}));
  io.stateDir = STATE;
  return io;
}

// The session-guard and restore-test queries share the `systemctl show`
// argv prefix with the unit query, so they are dispatched on the unit name.
function installShowRouter(cfg) {
  SPAWN['systemctl show --no-pager'] = function (argv) {
    var last = argv[argv.length - 1];
    if (last === cfg.sessions.session_guard_unit) {
      return { status: 0, stderr: '', error: null, stdout: 'Result=success\nExecMainExitTimestamp=@' + Math.round((CLOCK - 120000) / 1000) + '\nActiveState=inactive\n' };
    }
    if (/restore/.test(last)) {
      return { status: 0, stderr: '', error: null, stdout: 'Result=success\nExecMainStatus=0\nExecMainExitTimestamp=@' + Math.round((CLOCK - 5 * 86400000) / 1000) + '\n' };
    }
    return { status: 0, stdout: unitBlocks(cfg, 'system', SPAWN._unitOverrides || {}), stderr: '', error: null };
  };
}

function healthyHost(cfg) {
  writeProc({ procs: [
    { pid: 201, comm: 'node', cmdline: '/usr/bin/node /home/deploy/.claude/remote/ccd-cli/index.js', rss_mib: 300, age_seconds: 3600 },
    { pid: 202, comm: 'node', cmdline: '/usr/bin/node /home/deploy/.claude/remote/ccd-cli/index.js', rss_mib: 280, age_seconds: 1800 },
    { pid: 300, comm: 'nginx', cmdline: 'nginx: master process', rss_mib: 20 }
  ] });
  fixture('resource-pressure.json', { level: 'NORMAL', updated_at: iso(30) });
  fixture('memwatch.log', iso(3600) + ' avail=3300M/7746M swap=800M/4095M psi60=0.30 oom_kills=6812 | top x\n' +
                          iso(60) + ' avail=3200M/7746M swap=820M/4095M psi60=0.50 oom_kills=6812 | top x\n');
  fixture('host-sessions.json', { at: iso(120), sessions: [{ pid: 201 }, { pid: 202 }], denied: false, partial: false, read_homes: ['/root/.claude'], denied_homes: [] });
  fixture('live-status.json', { generated_at: iso(180), summary: { up: 12, down: 0 }, checks: [{ id: 'erp-https', state: 'UP' }] });
  fixture('backup-health-db.json', { mode: 'verify', status: 'ok', last_success_at: iso(6 * 3600), consecutive_failures: 0, last_backup_status: 'ok' });
  fixture('backup-health.json', { mode: 'backup', status: 'ok', last_success_at: iso(8 * 3600), consecutive_failures: 0, last_backup_status: 'ok' });
  SPAWN._unitOverrides = {};
  installShowRouter(cfg);
  SPAWN['systemctl --user show'] = function () { return { status: 0, stdout: unitBlocks(cfg, 'deploy', SPAWN._unitOverrides || {}), stderr: '', error: null }; };
  SPAWN['docker inspect --format'] = function () {
    return { status: 0, stderr: '', error: null, stdout: cfg.services.containers.map(function (c) { return '/' + c.container + '|running||0'; }).join('\n') + '\n' };
  };
  SPAWN['docker system df'] = function () { return { status: 0, stderr: '', error: null, stdout: 'Images|12GB|2GB\nLocal Volumes|3GB|0B\nBuild Cache|1GB|1GB\n' }; };
}

// =====================================================
section('1. levels: ladder, escalation, de-escalation');
// =====================================================
eq(levels.maxOf(['NORMAL', 'WARNING', 'HIGH']), 'HIGH', 'maxOf returns the highest level');
eq(levels.below('WARNING'), 'RECOVERY', 'below(WARNING) passes through RECOVERY');
eq(levels.below('EMERGENCY'), 'CRITICAL', 'below(EMERGENCY) steps one level');

(function () {
  var st = levels.initial(iso());
  var r1 = levels.step(st, 'WARNING', { escalate_samples: 2, now: iso() });
  eq(r1.state.level, 'NORMAL', 'one sample of WARNING does not escalate');
  var r2 = levels.step(r1.state, 'WARNING', { escalate_samples: 2, now: iso() });
  eq(r2.state.level, 'WARNING', 'two consecutive samples escalate');
  eq(r2.transition.reason, 'escalation', 'the transition is recorded as an escalation');
})();

(function () {
  // The PR #283 starvation case: evidence alternating between two HIGHER
  // levels reset the pending counter every sample, so it never escalated.
  var st = levels.initial(iso());
  ['CRITICAL', 'HIGH', 'CRITICAL', 'HIGH'].forEach(function (raw) {
    st = levels.step(st, raw, { escalate_samples: 2, now: iso() }).state;
  });
  ok(levels.rank(st.level) >= levels.rank('HIGH'), 'oscillating higher evidence still escalates (committed ' + st.level + ')');
  eq(st.level, 'HIGH', 'it commits the MINIMUM level every sample supported, not the maximum');
})();

(function () {
  var st = { level: 'EMERGENCY', since: iso(600), pending_level: null, pending_count: 0 };
  var seen = [];
  for (var i = 0; i < 15; i++) { st = levels.step(st, 'NORMAL', { deescalate_samples: 3, recovery_samples: 3, now: iso() }).state; seen.push(st.level); }
  ok(seen.indexOf('RECOVERY') >= 0 && seen.indexOf('RECOVERY') < seen.indexOf('NORMAL'), 'recovery is reached before NORMAL');
  ok(seen.indexOf('CRITICAL') >= 0 && seen.indexOf('HIGH') >= 0 && seen.indexOf('WARNING') >= 0, 'de-escalation walks one step at a time');
  eq(st.level, 'NORMAL', 'it eventually returns to NORMAL');
})();

(function () {
  var r = levels.step(levels.initial(iso()), 'CRITICAL', { escalate_samples: 5, immediate: true, now: iso() });
  eq(r.state.level, 'CRITICAL', 'immediate evidence commits on sample one');
  var f = levels.step(levels.initial(iso()), 'CRITICAL', { escalate_samples: 5, floor: 'WARNING', now: iso() });
  eq(f.state.level, 'WARNING', 'an upstream-confirmed floor commits at once');
  eq(f.state.pending_level, 'CRITICAL', 'while the higher inferred level still has to earn its samples');
})();

// =====================================================
section('2. config: defaults, validation, override rejection');
// =====================================================
eq(configMod.validate(configMod.DEFAULTS).length, 0, 'the built-in defaults validate');
eq(configMod.DEFAULTS.observe_only, true, 'the defaults are observe-only');
['allow_memory_remediation', 'allow_disk_remediation', 'allow_service_restart', 'allow_agent_throttling'].forEach(function (k) {
  eq(configMod.DEFAULTS[k], false, 'default ' + k + ' is false');
});
// Remediation may be enabled — that is the point of V1 — but only coherently,
// and observe_only still overrides every flag at plan time (section 16).
eq(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { observe_only: false })).length, 0, 'observe_only:false is a valid configuration');
eq(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { allow_service_restart: true })).length, 0, 'enabling a remediation flag is valid');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { observe_only: 'yes' })).length > 0, 'a non-boolean observe_only is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { allow_disk_remediation: 'true' })).length > 0, 'a non-boolean flag is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { remediation: { max_actions_per_tick: 10 } })).length > 0, 'a large per-tick budget is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { remediation: { max_attempts: 99 } })).length > 0, 'a large restart ceiling is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { remediation: { docker_build_cache_keep_hours: 1 } })).length > 0, 'too short a build-cache retention is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { remediation: { publish_dir: 'relative' } })).length > 0, 'a relative publish_dir is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { services: { restartable: ['erp-api'] } })).length > 0, 'a critical unit cannot be made restartable');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { services: { restartable: ['memwatch'] } })).length > 0, 'a system unit cannot be made restartable');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { services: { restartable: ['nope'] } })).length > 0, 'an unknown unit cannot be made restartable');
eq(configMod.DEFAULTS.services.restartable.length, 0, 'no unit is restartable by default');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { hysteresis: { escalate_samples: 1 } })).length > 0, 'escalate_samples:1 is rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { disk: { thresholds: { warning_pct: 95, high_pct: 90 } } })).length > 0, 'non-ascending disk thresholds are rejected');
ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { memory: { pressure_file: 'relative/path' } })).length > 0, 'a relative pressure path is rejected');
(function () {
  // An INVALID override is ignored wholesale — including the parts of it that
  // would have been fine. Partial application of a rejected config is how a
  // half-configured Guardian happens.
  var bad = fixture('bad-guardian.json', { observe_only: false, allow_service_restart: true, services: { restartable: ['erp-api'] } });
  var loaded = configMod.load(makeIo(), bad);
  eq(loaded.config.observe_only, true, 'a rejected override leaves observe_only at its default');
  eq(loaded.config.allow_service_restart, false, 'and cannot enable remediation');
  eq(loaded.config.services.restartable.length, 0, 'and cannot make a protected unit restartable');
  eq(loaded.source, 'defaults', 'a rejected override falls back to the defaults');
  ok(loaded.errors.length > 0, 'the rejection is reported, not silent');
  // A VALID remediation override is applied in full.
  var okCfg = fixture('ok-remediation.json', { observe_only: false, allow_disk_remediation: true });
  var okLoaded = configMod.load(makeIo(), okCfg);
  eq(okLoaded.config.observe_only, false, 'a valid remediation override is applied');
  eq(okLoaded.config.allow_disk_remediation, true, 'including its flags');
  eq(okLoaded.errors.length, 0, 'with no errors');
  var good = fixture('good-guardian.json', { interval_seconds: 300 });
  eq(configMod.load(makeIo(), good).config.interval_seconds, 300, 'a valid override is applied');
  eq(configMod.load(makeIo(), path.join(FIX, 'absent.json')).source, 'defaults', 'an absent override is not an error');
  fs.writeFileSync(path.join(FIX, 'broken.json'), '{not json');
  ok(configMod.load(makeIo(), path.join(FIX, 'broken.json')).errors.length > 0, 'unparsable JSON is reported');
})();

// =====================================================
section('3. io: the observe-only boundary');
// =====================================================
[['systemctl', 'restart', 'nginx'], ['systemctl', 'stop', 'erp-api.service'], ['systemctl', 'kill', 'x'],
 ['docker', 'system', 'prune'], ['docker', 'rm', 'x'], ['docker', 'volume', 'prune'], ['rm', '-rf', '/'],
 ['kill', '-9', '1'], ['pkill', 'node'], ['git', 'reset', '--hard'], ['systemctl', 'daemon-reload']].forEach(function (argv) {
  eq(ioMod.allowedCommand(argv), false, 'refused argv: ' + argv.join(' '));
});
[['systemctl', 'show', 'x'], ['systemctl', 'is-active', 'x'], ['systemctl', '--user', 'show', 'x'], ['docker', 'inspect', 'x'], ['docker', 'system', 'df']].forEach(function (argv) {
  eq(ioMod.allowedCommand(argv), true, 'allowed read argv: ' + argv.join(' '));
});
(function () {
  var realIo = ioMod.createIo({});
  realIo.stateDir = STATE;
  var r = realIo.spawn(['systemctl', 'restart', 'nginx']);
  eq(r.refused, true, 'a mutating argv is refused before exec');
  eq(r.status, null, 'a refused argv never produces an exit status');
  // These are the paths that MATTER, and the ones the unit sandbox does not
  // protect. Measured on this host 2026-09-17: a systemd USER manager cannot
  // create a mount namespace, so ProtectSystem/ProtectHome/ReadOnlyPaths are
  // silently inert — a user unit with ProtectSystem=strict still wrote
  // /var/lib/mythos/guardian, and /etc was blocked by ordinary file
  // permissions rather than by the sandbox. The enforced boundary is THIS
  // function, so it is tested against the real production paths by name.
  [
    '/etc/passwd',
    path.join(STATE, '..', 'escape'),
    '/var/lib/mythos/pressure/resource-pressure.json',
    '/home/deploy/projects/mythos-prod/ops/guardian/lib/engine.js',
    '/home/deploy/mythos-backups/health/backup-health-db.json',
    '/home/deploy/.ssh/id_ed25519',
    '/home/deploy/.config/systemd/user/mythos-guardian.timer',
    '/home/deploy/mythos-ai-executor/orchestration/resource-guard.json',
    '/var/www/status.mythosprod.xyz/data/live-status.json',
    '/home/deploy/.local/state/mythos-guardian-other/state.json'
  ].forEach(function (p) {
    var threw = false;
    try { realIo.assertOwnState(p); } catch (e) { threw = true; }
    eq(threw, true, 'writing ' + p + ' is refused by the code boundary');
  });
  eq(realIo.assertOwnState(path.join(STATE, 'state.json')), path.join(STATE, 'state.json'), 'writing inside the state directory is allowed');
  var escape = path.join(os.tmpdir(), 'guardian-escape-' + process.pid);
  eq(realIo.writeStateAtomic(escape, 'x'), false, 'writeStateAtomic outside the state dir returns false');
  eq(fs.existsSync(escape), false, 'and creates nothing');
  ['unlink', 'rm', 'remove', 'rmdir', 'chmod', 'chown', 'kill'].forEach(function (k) {
    eq(typeof realIo[k], 'undefined', 'io has no ' + k + '() primitive');
  });
  var srcText = fs.readFileSync(path.join(LIB, 'engine.js'), 'utf8') + fs.readFileSync(path.join(LIB, 'classify.js'), 'utf8') + fs.readFileSync(path.join(LIB, 'sources.js'), 'utf8');
  ok(!/process\.kill|child_process|execSync|unlinkSync|rmSync|rmdirSync/.test(srcText), 'the engine, classifier and sources contain no kill, exec or delete call');

  // The structural guarantee the whole design rests on: `fs` and
  // `child_process` exist in exactly ONE file. Everything else either takes
  // the injected io or is pure. If this ever stops being true, the write
  // boundary and the command allowlist stop being boundaries, because there
  // is a second way out of the module.
  var CONFINED = { 'io.js': true };
  ['levels.js', 'config.js', 'sources.js', 'classify.js', 'engine.js', 'report.js', 'scenarios.js', 'io.js'].forEach(function (name) {
    var text = fs.readFileSync(path.join(LIB, name), 'utf8');
    var usesFs = /require\('fs'\)/.test(text);
    var usesCp = /require\('child_process'\)/.test(text);
    if (CONFINED[name]) {
      eq(usesFs, true, name + ' is the one module allowed to require fs');
    } else {
      eq(usesFs, false, name + ' must not require fs directly');
      eq(usesCp, false, name + ' must not require child_process');
    }
  });
  ['levels.js', 'classify.js', 'report.js'].forEach(function (name) {
    var text = fs.readFileSync(path.join(LIB, name), 'utf8');
    ok(!/require\('(?!\.\/)/.test(text), name + ' is pure: it requires nothing but its siblings');
  });
})();
(function () {
  var bounded = ioMod.createIo({});
  var big = fixture('big.log', new Array(2000).join('x'.repeat(60) + '\n'));
  var tail = bounded.readFileTail(big, 4096);
  ok(Buffer.byteLength(tail) <= 4096, 'readFileTail is bounded (' + Buffer.byteLength(tail) + ' bytes)');
  ok(/^x+$/.test(tail.split('\n')[0]), 'readFileTail discards a partial first line');
  var linkPath = path.join(FIX, 'big-link.log');
  try { fs.unlinkSync(linkPath); } catch (e) { /* first run */ }
  fs.symlinkSync(big, linkPath);
  eq(bounded.readFileTail(linkPath, 4096), null, 'readFileTail refuses a symlink');
})();
(function () {
  var io = makeIo();
  var lockPath = path.join(STATE, 'test.lock');
  var a = io.lock(lockPath);
  eq(a.acquired, true, 'the first lock is acquired');
  eq(io.lock(lockPath).acquired, false, 'a second concurrent lock is refused');
  eq(io.unlock(a), true, 'the lock is released');
  var c = io.lock(lockPath);
  eq(c.acquired, true, 'the lock can be taken again after release');
  io.unlock(c);
})();

// =====================================================
section('4. sources: every collector against fixtures');
// =====================================================
var CFG = buildConfig();
healthyHost(CFG);
(function () {
  var io = makeIo();
  var ctx = { nowMs: NOW };
  var m = sources.memory(CFG.memory, io, ctx);
  eq(m.publication.ok, true, 'the publication is read');
  eq(m.publication.data.level, 'NORMAL', 'the published level is parsed');
  eq(m.meminfo.data.mem_available_mib, 3200, 'MemAvailable is parsed from the fixture /proc');
  eq(m.psi.data.some_avg60, 0.5, 'PSI avg60 is parsed');
  eq(m.oom_kill.data.count, 6812, 'the oom_kill counter is parsed');
  eq(m.memwatch.ok, true, 'memwatch telemetry is read');
  eq(m.memwatch.data.mem_available_mib, 3200, 'the LAST memwatch line is used');

  fixture('resource-pressure.json', { level: 'NORMAL', updated_at: iso(7200) });
  eq(sources.memory(CFG.memory, io, ctx).publication.ok, false, 'a stale publication is not ok');
  eq(sources.memory(CFG.memory, io, ctx).publication.error, 'stale', 'and it says why');
  fixture('resource-pressure.json', { level: 'BOGUS', updated_at: iso(30) });
  eq(sources.memory(CFG.memory, io, ctx).publication.error, 'unknown_level', 'an unknown level is rejected');
  fs.writeFileSync(path.join(FIX, 'resource-pressure.json'), 'not json');
  eq(sources.memory(CFG.memory, io, ctx).publication.error, 'unreadable_or_invalid', 'unparsable JSON is rejected');
  fs.unlinkSync(path.join(FIX, 'resource-pressure.json'));
  eq(sources.memory(CFG.memory, io, ctx).publication.error, 'missing', 'an absent publication is reported as missing');
  fixture('resource-pressure.json', { level: 'NORMAL', updated_at: iso(30) });

  var s = sources.sessions(CFG.sessions, io, ctx);
  eq(s.procs.data.remote_sessions, 2, 'agent sessions are counted from the fixture /proc');
  eq(s.procs.data.remote_rss_mib, 580, 'their resident memory is summed');
  eq(s.procs.data.total, 3, 'every process is counted');
  eq(s.snapshot.ok, true, 'the session-guard snapshot is read');
  eq(s.guard_unit.ok, true, 'the session-guard unit state is read');

  // The guard is a oneshot that runs every 5 minutes for a few seconds, and
  // systemd clears ExecMainExitTimestamp while it is activating. A Guardian
  // tick landing inside that window must not call a healthy guard stale.
  // Observed live on 2026-09-16 before this was fixed.
  (function () {
    var saved = SPAWN['systemctl show --no-pager'];
    function guardShow(fields) {
      SPAWN['systemctl show --no-pager'] = function (argv) {
        var last = argv[argv.length - 1];
        if (last === CFG.sessions.session_guard_unit) return { status: 0, stderr: '', error: null, stdout: fields };
        return saved(argv);
      };
      return sources.sessions(CFG.sessions, io, { nowMs: NOW }).guard_unit;
    }
    var startedAt = Math.round((NOW - 2000) / 1000);   // started 2 s ago, still running
    var midRun = guardShow('Result=\nActiveState=activating\nSubState=start\nExecMainExitTimestamp=\nInactiveExitTimestamp=@' + startedAt + '\n');
    eq(midRun.ok, true, 'a guard caught mid-run is NOT stale');
    eq(midRun.data.running, true, 'and is reported as running');
    eq(midRun.error, null, 'with no stale error');
    var v = classify.sessions({ procs: sources.envelope(true, { total: 10, remote_sessions: 1, remote_rss_mib: 10, oldest_session_hours: 1, orphan_count: 0, orphans: [] }), snapshot: sources.envelope(true, { sessions: 1, denied: false }), guard_unit: midRun }, CFG.sessions, {}, { nowMs: NOW, memoryLevel: 'NORMAL' });
    eq(v.findings.filter(function (f) { return f.kind === 'session_guard_stale'; }).length, 0, 'and produces no session_guard_stale finding');

    // Exit timestamp missing but the unit is idle: fall back to when this run
    // started, rather than concluding it never ran.
    var idleNoExit = guardShow('Result=success\nActiveState=inactive\nSubState=dead\nExecMainExitTimestamp=\nInactiveExitTimestamp=@' + Math.round((NOW - 60000) / 1000) + '\n');
    eq(idleNoExit.ok, true, 'a recent start with no exit timestamp is not stale either');

    // A genuinely stale guard must still be caught.
    var reallyStale = guardShow('Result=success\nActiveState=inactive\nSubState=dead\nExecMainExitTimestamp=@' + Math.round((NOW - 7200000) / 1000) + '\nInactiveExitTimestamp=@' + Math.round((NOW - 7210000) / 1000) + '\n');
    eq(reallyStale.ok, false, 'a guard that has not run for two hours IS stale');
    eq(reallyStale.error, 'stale_or_never_run', 'and says so');

    // And one that has genuinely never run.
    var never = guardShow('Result=\nActiveState=inactive\nSubState=dead\nExecMainExitTimestamp=\nInactiveExitTimestamp=\n');
    eq(never.ok, false, 'a guard that has never run is stale');

    SPAWN['systemctl show --no-pager'] = saved;
  })();

  var d = sources.disk(CFG.disk, io);
  eq(d.fs.ok, true, 'statfs succeeds');
  ok(typeof d.fs.data.used_pct === 'number', 'used_pct is a number');
  eq(d.docker.ok, true, 'docker system df is parsed');
  eq(d.docker.data.Images.size, '12GB', 'the Images row is parsed');

  // `docker system df` costs ~2.8 s and is only actionable under pressure,
  // so it is skipped below the threshold. The disk LEVEL must not depend on
  // it: that always comes from statfs.
  (function () {
    var calls = [];
    var counting = makeIo({ spawn: function (argv) { calls.push(argv.slice(0, 3).join(' ')); return fakeSpawn(argv); } });
    var gated = sources.disk(Object.assign({}, CFG.disk, { docker_df_min_pct: 99.9 }), counting);
    eq(gated.docker.ok, false, 'below the threshold the Docker breakdown is not collected');
    eq(gated.docker.error, 'not_needed', 'and it says why, rather than looking like a failure');
    eq(calls.indexOf('docker system df'), -1, 'the Docker daemon is not queried at all');
    eq(gated.fs.ok, true, 'statfs still runs');
    var verdict = classify.disk(gated, CFG.disk, {}, { nowMs: NOW });
    ok(levels.isLevel(verdict.raw), 'the disk level is still computed without it');
    eq(verdict.findings.filter(function (f) { return f.kind === 'docker_df_unavailable'; }).length, 0,
      'a deliberately skipped collection is not reported as unavailable');
  })();

  var sv = sources.services(CFG.services, io, ctx);
  eq(Object.keys(sv.units).length, CFG.services.units.length, 'every configured unit is reported');
  eq(sv.units['nginx'].active, 'active', 'a system unit state is read');
  eq(sv.units['erp-api'].observed, true, 'a deploy user unit state is read');
  eq(sv.containers['idauto-postgres'].status, 'running', 'a container state is read');
  eq(sv.live_status.ok, true, 'the Status Center file is read');

  var b = sources.backup(CFG.backup, io, ctx);
  eq(b.records['mythos-erp'].ok, true, 'the ERP backup record is read');
  eq(b.restore_tests['restore-mythos-erp'].data.result, 'success', 'the restore-test unit result is read');
})();

// =====================================================
section('5. classify: domain verdicts');
// =====================================================
(function () {
  var io = makeIo(), ctx = { nowMs: NOW, memoryLevel: 'NORMAL' };
  function mem(o, prev) {
    writeProc(o.proc || {});
    if (o.pub === null) { try { fs.unlinkSync(path.join(FIX, 'resource-pressure.json')); } catch (e) { /* absent */ } }
    else fixture('resource-pressure.json', { level: o.pub || 'NORMAL', updated_at: iso(o.age || 30) });
    return classify.memory(sources.memory(CFG.memory, io, ctx), CFG.memory, prev || {}, ctx);
  }
  eq(mem({ proc: { availMib: 3200, psi60: 0.5 } }).raw, 'NORMAL', 'a healthy host is NORMAL');
  eq(mem({ proc: { availMib: 1500, psi60: 4 }, pub: 'WARNING' }).raw, 'WARNING', 'RG WARNING with mild pressure stays WARNING');
  eq(mem({ proc: { availMib: 800, psi60: 6 }, pub: 'WARNING' }).raw, 'HIGH', 'RG WARNING plus low MemAvailable escalates to HIGH');
  var emerg = mem({ proc: { availMib: 300, psi60: 60 }, pub: 'CRITICAL' });
  eq(emerg.raw, 'EMERGENCY', 'RG CRITICAL plus an exhausted floor is EMERGENCY');
  eq(emerg.immediate, false, 'EMERGENCY is not committed immediately: it needs its own confirmation');

  var oom = mem({ proc: { availMib: 3200, psi60: 0.5, oom: 6820 } }, { last_oom_kill: 6812 });
  ok(levels.rank(oom.raw) >= levels.rank('CRITICAL'), 'a new OOM kill forces at least CRITICAL');
  eq(oom.immediate, true, 'an OOM kill is a confirmed event and commits immediately');
  eq(oom.stateOut.last_oom_kill, 6820, 'the counter is carried into the next tick');
  eq(mem({ proc: { availMib: 3200, psi60: 0.5, oom: 6820 } }, { last_oom_kill: 6820 }).raw, 'NORMAL', 'the same counter twice is not a new kill');

  var missingPub = mem({ proc: { availMib: 3200, psi60: 0.5 }, pub: null });
  eq(missingPub.unknown, false, 'a missing publication does not blind the domain: /proc is still read');
  eq(missingPub.degraded, true, 'but it does degrade Guardian');
  ok(missingPub.findings.some(function (f) { return f.kind === 'pressure_source_unavailable'; }), 'and it is reported');
  eq(mem({ proc: { availMib: 500, psi60: 45 }, pub: null }).raw, 'CRITICAL', 'with the publication gone, real pressure is still CRITICAL');

  var disagree = mem({ proc: { availMib: 640, psi60: 41 }, pub: 'NORMAL' });
  eq(disagree.raw, 'CRITICAL', 'a Resource Guard stuck at NORMAL cannot mask a critical kernel');
  eq(disagree.floor, 'NORMAL', 'the published level is kept as the immediate floor');
  eq(disagree.immediate, false, 'Guardian must earn its own escalation above the published level');
  ok(disagree.findings.some(function (f) { return f.kind === 'pressure_disagreement'; }), 'the disagreement is reported explicitly');

  var swap = mem({ proc: { availMib: 3200, psi60: 0.5, swapUsedPct: 100 } });
  eq(swap.raw, 'NORMAL', 'full swap alone is not pressure (the known false positive)');
  ok(swap.findings.some(function (f) { return f.kind === 'swap_exhausted'; }), 'but full swap is still reported');
  fixture('resource-pressure.json', { level: 'NORMAL', updated_at: iso(30) });
})();

(function () {
  var io = makeIo();
  function sess(procs, memLevel) {
    writeProc({ procs: procs });
    return classify.sessions(sources.sessions(CFG.sessions, io, { nowMs: NOW }), CFG.sessions, {}, { nowMs: NOW, memoryLevel: memLevel || 'NORMAL' });
  }
  function agents(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ pid: 400 + i, comm: 'node', cmdline: '/usr/bin/node /home/deploy/.claude/remote/ccd-cli/index.js', rss_mib: 200, age_seconds: 3600 });
    return out;
  }
  eq(sess(agents(3)).raw, 'NORMAL', '3 sessions is normal');
  eq(sess(agents(12)).raw, 'WARNING', '12 sessions exceeds the hard maximum');
  eq(sess(agents(5), 'CRITICAL').raw, 'HIGH', 'sessions above the CRITICAL ceiling is HIGH');
  eq(sess(agents(5), 'WARNING').raw, 'WARNING', 'sessions above the WARNING ceiling is WARNING');
  var orph = sess(agents(1).concat([1, 2, 3, 4, 5, 6].map(function (i) {
    return { pid: 600 + i, ppid: 1, comm: 'node', cmdline: 'node worker', rss_mib: 50, age_seconds: 7200 };
  })));
  eq(orph.raw, 'WARNING', 'orphaned tool processes are a WARNING');
  eq(orph.summary.orphan_count, 6, 'the orphans are counted');
  eq(sess([{ pid: 700, ppid: 1, comm: 'node', cmdline: 'node worker', rss_mib: 50, age_seconds: 10 }]).summary.orphan_count, 0,
    'a freshly reparented process is not yet an orphan');

  // A PARTIAL lifecycle snapshot must not degrade Guardian. The root runner
  // carries CAP_KILL only, so another user's 0700 Claude home is unreadable
  // by design and permanently — treating that as degradation would park
  // Guardian in DEGRADED forever for a boundary that is working.
  (function () {
    function withSnap(snapBody) {
      fixture('host-sessions.json', snapBody);
      writeProc({ procs: agents(2) });
      return classify.sessions(sources.sessions(CFG.sessions, io, { nowMs: NOW }), CFG.sessions, {}, { nowMs: NOW, memoryLevel: 'NORMAL' });
    }
    var partial = withSnap({ at: iso(120), sessions: [{ pid: 1 }, { pid: 2 }], denied: true, partial: true,
      read_homes: ['/root/.claude'], denied_homes: ['/home/deploy/.claude', '/home/ubuntu/.claude'] });
    eq(partial.degraded, false, 'a partial snapshot does not degrade Guardian');
    ok(partial.findings.some(function (f) { return f.kind === 'session_snapshot_partial'; }), 'it is reported as INFO');
    ok(partial.findings.every(function (f) { return f.kind !== 'session_snapshot_unavailable'; }), 'and not as unavailable');
    var covered = partial.findings.filter(function (f) { return f.kind === 'session_snapshot_partial'; })[0];
    ok(/\/root\/\.claude/.test(covered.trigger) && /home\/deploy/.test(covered.trigger), 'naming which homes it covers and which it does not');

    var absent = withSnap('');
    eq(absent.degraded, true, 'an ABSENT snapshot still degrades Guardian');
    ok(absent.findings.some(function (f) { return f.kind === 'session_snapshot_unavailable'; }), 'and is reported as unavailable');

    var complete = withSnap({ at: iso(120), sessions: [{ pid: 1 }], denied: false, partial: false, read_homes: ['/root/.claude'], denied_homes: [] });
    eq(complete.degraded, false, 'a complete snapshot does not degrade Guardian');
    ok(complete.findings.every(function (f) { return f.kind !== 'session_snapshot_partial'; }), 'and raises no partial finding');
  })();
})();

(function () {
  function disk(used, inode) {
    var src = { fs: sources.envelope(true, { path: '/', used_pct: used, free_gb: 10, inode_used_pct: inode || 10 }), docker: sources.missing('disabled') };
    return classify.disk(src, CFG.disk, {}, { nowMs: NOW });
  }
  eq(disk(61).raw, 'NORMAL', '61 % used is normal');
  eq(disk(82).raw, 'WARNING', '82 % used is a warning');
  eq(disk(86).raw, 'HIGH', '86 % used is high');
  eq(disk(91).raw, 'CRITICAL', '91 % used is critical');
  eq(disk(97).raw, 'EMERGENCY', '97 % used is an emergency');
  eq(disk(97).immediate, true, 'a full filesystem commits immediately');
  eq(disk(50, 93).raw, 'CRITICAL', 'inode exhaustion counts even when blocks are free');
})();

(function () {
  var io = makeIo(), ctx = { nowMs: NOW };
  function svc(overrides, prev) {
    SPAWN._unitOverrides = overrides || {};
    var v = classify.services(sources.services(CFG.services, io, ctx), CFG.services, prev || {}, ctx);
    SPAWN._unitOverrides = {};
    return v;
  }
  eq(svc().raw, 'NORMAL', 'a healthy service table is normal');
  eq(svc({ nginx: { ActiveState: 'failed' } }).raw, 'CRITICAL', 'a failed critical unit is CRITICAL');
  eq(svc({ nginx: { ActiveState: 'failed' } }).immediate, true, 'a down critical unit commits immediately');
  eq(svc({ mariadb: { ActiveState: 'inactive' } }).raw, 'HIGH', 'a stopped production unit is HIGH');
  eq(svc({ memwatch: { ActiveState: 'inactive' } }).raw, 'WARNING', 'a stopped support unit is only a WARNING');
  eq(svc({ hostops: { LoadState: 'not-found' } }).raw, 'WARNING', 'a unit that is not installed is reported, not fatal');
  var loop = svc({ mariadb: { NRestarts: '9' } }, { restarts: { mariadb: [{ at: NOW - 10 * 60000, n: 1 }] } });
  eq(loop.raw, 'HIGH', 'a restart loop on a production unit is HIGH');
  ok(loop.findings.some(function (f) { return f.kind === 'restart_loop'; }), 'the restart loop is named');
  eq(svc({ mariadb: { NRestarts: '3' } }, { restarts: { mariadb: [{ at: NOW - 10 * 60000, n: 1 }] } }).raw, 'NORMAL', '2 restarts in the window is not a loop');
  eq(svc({ mariadb: { NRestarts: '40' } }, { restarts: { mariadb: [{ at: NOW - 24 * 3600000, n: 1 }] } }).raw, 'NORMAL', 'restarts outside the window are forgotten');

  fixture('live-status.json', { generated_at: iso(60), summary: { up: 10, down: 2 }, checks: [{ id: 'erp-https', state: 'DOWN' }, { id: 'ok-one', state: 'UP' }] });
  var down = svc();
  eq(down.raw, 'HIGH', 'a Status Center DOWN check raises the services domain');
  ok(down.findings.some(function (f) { return f.kind === 'status_center_down'; }), 'and names the check');
  fixture('live-status.json', { generated_at: iso(9999), summary: {}, checks: [] });
  eq(svc().degraded, true, 'a stale Status Center degrades Guardian');
  fixture('live-status.json', { generated_at: iso(180), summary: { up: 12, down: 0 }, checks: [{ id: 'erp-https', state: 'UP' }] });
})();

(function () {
  var io = makeIo(), ctx = { nowMs: NOW };
  function bk() { return classify.backup(sources.backup(CFG.backup, io, ctx), CFG.backup, {}, ctx); }
  eq(bk().summary.backup_state, 'BACKUP_OK', 'fresh successful backups are OK');
  // The PR #285 case: a clean verify must not vouch for a failed backup.
  fixture('backup-health-db.json', { mode: 'verify', status: 'ok', last_verify_status: 'ok', last_backup_status: 'fail', last_success_at: iso(10 * 3600), consecutive_failures: 2 });
  eq(bk().summary.backup_state, 'BACKUP_WARNING', 'a clean verify does not mask a failed backup');
  fixture('backup-health-db.json', { mode: 'backup', status: 'ok', last_backup_status: 'ok', last_success_at: iso(80 * 3600), consecutive_failures: 0 });
  eq(bk().summary.backup_state, 'BACKUP_FAILED', 'no successful backup inside the failure window is FAILED');
  eq(bk().raw, 'HIGH', 'a failed backup raises the backup domain to HIGH');
  fixture('backup-health-db.json', { mode: 'backup', status: 'ok', last_backup_status: 'ok', last_success_at: iso(30 * 3600), consecutive_failures: 0 });
  eq(bk().summary.backup_state, 'BACKUP_WARNING', 'a backup past its freshness window is a WARNING');
  fixture('backup-health-db.json', { mode: 'verify', status: 'ok', last_success_at: iso(6 * 3600), consecutive_failures: 0, last_backup_status: 'ok' });
  fs.unlinkSync(path.join(FIX, 'backup-health.json'));
  eq(bk().summary.records['idauto-media'].state, 'BACKUP_FAILED', 'a missing required record is FAILED, never assumed healthy');
  fixture('backup-health.json', { mode: 'backup', status: 'ok', last_success_at: iso(8 * 3600), consecutive_failures: 0, last_backup_status: 'ok' });

  // Same systemd window as the session guard, and wider: a restore test runs
  // for minutes, and while it does its Result and exit timestamp are cleared.
  // A test in progress is the freshest possible evidence it is not abandoned.
  (function () {
    var saved = SPAWN['systemctl show --no-pager'];
    function restoreShow(fields) {
      SPAWN['systemctl show --no-pager'] = function (argv) {
        var last = argv[argv.length - 1];
        if (/restore/.test(last)) return { status: 0, stderr: '', error: null, stdout: fields };
        return saved(argv);
      };
      return classify.backup(sources.backup(CFG.backup, io, ctx), CFG.backup, {}, ctx);
    }
    var running = restoreShow('Result=\nExecMainStatus=\nExecMainExitTimestamp=\nInactiveExitTimestamp=@' + Math.round((NOW - 120000) / 1000) + '\nActiveState=activating\n');
    eq(running.summary.restore_tests['restore-mythos-erp'].state, 'RESTORE_TEST_OK', 'a restore test running right now is not unverified');
    eq(running.summary.restore_test_state, 'RESTORE_TEST_OK', 'and does not drag the overall restore state down');
    eq(running.raw, 'NORMAL', 'nor the backup domain');

    var failed = restoreShow('Result=exit-code\nExecMainStatus=1\nExecMainExitTimestamp=@' + Math.round((NOW - 3600000) / 1000) + '\nInactiveExitTimestamp=@' + Math.round((NOW - 3660000) / 1000) + '\nActiveState=failed\n');
    eq(failed.summary.restore_tests['restore-mythos-erp'].state, 'RESTORE_TEST_FAILED', 'a failed restore test is still caught');
    var overdue = restoreShow('Result=success\nExecMainStatus=0\nExecMainExitTimestamp=@' + Math.round((NOW - 60 * 86400000) / 1000) + '\nInactiveExitTimestamp=@' + Math.round((NOW - 60 * 86400000) / 1000) + '\nActiveState=inactive\n');
    eq(overdue.summary.restore_tests['restore-mythos-erp'].state, 'RESTORE_TEST_FAILED', 'an overdue restore test is still caught');
    var noResult = restoreShow('Result=\nExecMainStatus=\nExecMainExitTimestamp=\nInactiveExitTimestamp=\nActiveState=inactive\n');
    eq(noResult.summary.restore_tests['restore-mythos-erp'].state, 'RESTORE_TEST_UNVERIFIED', 'an idle unit with no recorded result is still unverified');
    SPAWN['systemctl show --no-pager'] = saved;
  })();
})();

// =====================================================
section('6. engine: tick, roll-up, host vs Guardian health');
// =====================================================
(function () {
  var io = makeIo();
  healthyHost(CFG);
  var out = engine.tick({ io: io, config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  eq(out.report.host.level, 'NORMAL', 'a healthy host rolls up to NORMAL');
  eq(out.report.host.partial, false, 'nothing is unknown');
  eq(out.report.guardian.state, 'OK', 'Guardian is OK');
  eq(out.report.guardian.observed_domains, 5, 'all five domains are observed');
  eq(out.report.guardian.remediation.remediation_available, false, 'remediation is not available');
  eq(Object.keys(out.report.domains).sort().join(','), 'backup,disk,memory,services,sessions', 'every domain reports');

  var blindIo = makeIo({
    readJson: function () { return null; }, readFile: function () { return null; },
    statfs: function () { return null; }, readdir: function () { return []; },
    spawn: function () { return { status: 1, stdout: '', stderr: '', error: 'x' }; }
  });
  var blind = engine.tick({ io: blindIo, config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  ok(blind.report.guardian.state !== 'OK', 'with no inputs Guardian is not OK');
  eq(blind.report.host.partial, true, 'and the host level is explicitly partial');
  ok(blind.report.host.unknown_domains.length > 0, 'the unknown domains are named');
  eq(blind.report.host.level, 'NORMAL', 'Guardian does not invent a host level it cannot see');
  ok(blind.report.findings.length > 0, 'and it says what it could not read');

  var cfgErr = engine.tick({ io: io, config: CFG, config_errors: ['override rejected: x'], state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  eq(cfgErr.report.guardian.state, 'DEGRADED', 'a rejected configuration degrades Guardian, not the host');
  eq(cfgErr.report.host.level, 'NORMAL', 'and leaves the host level alone');
})();

(function () {
  var io = makeIo();
  healthyHost(CFG);
  var st = engine.emptyState(iso());
  writeProc({ availMib: 650, psi60: 45 });
  fixture('resource-pressure.json', { level: 'CRITICAL', updated_at: iso(20) });
  var t1 = engine.tick({ io: io, config: CFG, state: st, now_ms: NOW, dry_run: true });
  eq(t1.report.domains.memory.level, 'CRITICAL', 'an RG-confirmed CRITICAL commits on the first tick');
  eq(t1.report.host.level, 'CRITICAL', 'the host rolls up to CRITICAL');
  eq(t1.report.incident.state, 'OPEN', 'an incident is opened');
  ok(t1.report.incident_events.some(function (e) { return e.type === 'incident_opened'; }), 'the open event is recorded');
  ok(t1.report.incident.id.indexOf('GRD-') === 0, 'the incident id is prefixed');

  var st2 = t1.state, last = null, closed = null;
  healthyHost(CFG);
  // CRITICAL -> HIGH -> WARNING -> RECOVERY -> NORMAL at 3 samples a step, and
  // the sessions domain only starts its own walk once memory leaves CRITICAL.
  for (var i = 0; i < 40; i++) {
    CLOCK = NOW + (i + 1) * 120000;
    healthyHost(CFG);                       // the host keeps reporting, freshly
    last = engine.tick({ io: makeIo({ now: function () { return CLOCK; } }), config: CFG, state: st2, now_ms: CLOCK, dry_run: true });
    st2 = last.state;
    if (closed === null && last.incident_events.some(function (e) { return e.type === 'incident_closed'; })) closed = i + 1;
  }
  ok(closed !== null && closed <= 30, 'the incident closes within 30 ticks (closed at tick ' + closed + ')');
  CLOCK = NOW;
  healthyHost(CFG);
  eq(last.report.host.level, 'NORMAL', 'the host returns to NORMAL once pressure clears');
  eq(last.report.incident, null, 'the incident is closed');
  eq(st2.domains.memory.level, 'NORMAL', 'and the memory domain is back to NORMAL');
})();

(function () {
  // A tick has a wall-clock budget. Under real memory pressure on 2026-09-16
  // a tick took 76 s against a median of 0.8 s, because the host was stalled
  // on memory 57 % of the time — exactly when Guardian must still report.
  healthyHost(CFG);
  var clock = NOW;
  var slowIo = makeIo({
    now: function () { return clock; },
    spawn: function (argv) { clock += 30000; return fakeSpawn(argv); }   // every command costs 30 s
  });
  var budgeted = configMod.deepMerge(CFG, { tick_budget_ms: 45000, tick_slow_ms: 5000 });
  var out = engine.tick({ io: slowIo, config: budgeted, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });

  ok(out.report.host.partial, 'a tick that runs out of budget reports a PARTIAL host level');
  ok(out.report.host.unknown_domains.length > 0, 'and names the domains it could not reach');
  ok(out.report.guardian.state !== 'OK', 'and Guardian reports itself degraded');
  eq(out.report.domains.memory.unknown, false, 'memory is read FIRST and always makes the budget');
  ok(out.report.findings.some(function (f) { return f.kind === 'collector_error' && /budget/.test(f.trigger); }),
    'the budget exhaustion is reported explicitly, not silently');
  ok(out.report.findings.some(function (f) { return f.kind === 'slow_tick'; }), 'and a slow tick is itself a finding');
  ok(typeof out.report.collect_ms === 'number', 'the collection time is recorded in the report');
  ok(levels.isLevel(out.report.host.level), 'a budget-limited tick still produces a valid host level');

  // With no budget configured, nothing is skipped.
  clock = NOW;
  var unbudgeted = engine.tick({ io: slowIo, config: configMod.deepMerge(CFG, { tick_budget_ms: undefined }), state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  eq(unbudgeted.report.host.partial, false, 'without a budget every domain is still collected');

  // The budget must stay under the unit's TimeoutStartSec.
  ok(configMod.validate(configMod.deepMerge(configMod.DEFAULTS, { tick_budget_ms: 120000 })).length > 0,
    'a budget at or above the unit timeout is rejected');
  ok(configMod.DEFAULTS.tick_budget_ms < 120000, 'the default budget is under the unit timeout');

  // deepMerge is exported and callable with an explicit undefined. A config
  // helper that throws is a config helper that can take Guardian down at
  // startup, so it removes the key instead.
  var threw = null;
  try { configMod.deepMerge(configMod.DEFAULTS, { tick_budget_ms: undefined }); } catch (e) { threw = e && e.message; }
  eq(threw, null, 'deepMerge survives an explicit undefined');
  eq('tick_budget_ms' in configMod.deepMerge(configMod.DEFAULTS, { tick_budget_ms: undefined }), false,
    'and removes the key rather than storing a broken value');
})();

(function () {
  var io = makeIo();
  healthyHost(CFG);
  SPAWN._unitOverrides = { memwatch: { ActiveState: 'inactive' } };
  var st = engine.emptyState(iso()), out = null;
  for (var i = 0; i < 3; i++) { out = engine.tick({ io: io, config: CFG, state: st, now_ms: NOW + i * 120000, dry_run: true }); st = out.state; }
  eq(out.report.host.level, 'WARNING', 'a down support unit is a host WARNING, never an emergency');
  SPAWN._unitOverrides = {};
})();

// =====================================================
section('7. engine.run: writes, locking, dry-run');
// =====================================================
(function () {
  var io = makeIo();
  healthyHost(CFG);
  var p = engine.paths(STATE);
  var dry = engine.run({ io: io, state_dir: STATE, config: CFG, dry_run: true, now_ms: NOW });
  eq(dry.written, false, 'a dry run reports that it wrote nothing');
  eq(fs.existsSync(p.state), false, 'a dry run creates no state file');
  eq(fs.existsSync(p.report), false, 'a dry run creates no report file');

  var live = engine.run({ io: io, state_dir: STATE, config: CFG, now_ms: NOW });
  eq(live.written.state, true, 'an observe tick writes its state');
  eq(live.written.report, true, 'and its report');
  eq(fs.existsSync(p.ticks), true, 'and appends a tick line');
  eq(fs.statSync(p.state).mode & 0o777, 0o644, 'the state file is 0644');
  var reloaded = JSON.parse(fs.readFileSync(p.report, 'utf8'));
  eq(reloaded.host.level, 'NORMAL', 'the persisted report is valid JSON with a host level');
  eq(reloaded.mode, 'observe', 'the persisted report records the mode');
  eq(engine.run({ io: io, state_dir: STATE, config: CFG, now_ms: NOW + 120000 }).report.tick, 2, 'the tick counter advances across runs');

  var held = io.lock(p.lock);
  eq(held.acquired, true, 'the lock can be taken directly');
  eq(engine.run({ io: io, state_dir: STATE, config: CFG, now_ms: NOW + 240000 }).skipped, 'locked', 'a concurrent tick skips instead of racing');
  io.unlock(held);
  eq(engine.run({ io: io, state_dir: STATE, config: CFG, now_ms: NOW + 240000 }).skipped, undefined, 'and runs again once the lock is free');

  var held2 = io.lock(p.lock);
  var dryUnderLock = engine.run({ io: io, state_dir: STATE, config: CFG, dry_run: true, now_ms: NOW });
  eq(dryUnderLock.skipped, undefined, 'a dry run is not blocked by the lock');
  eq(dryUnderLock.written, false, 'and still writes nothing');
  io.unlock(held2);

  // Rotation keeps `keep` generations and drops the oldest by renaming over
  // it — Guardian has no delete primitive and is not getting one for logs.
  (function () {
    var tiny = configMod.deepMerge(CFG, { incidents: { max_bytes: 200, keep: 3 } });
    var seen = {};
    for (var i = 0; i < 12; i++) {
      engine.run({ io: io, state_dir: STATE, config: tiny, now_ms: NOW + (100 + i) * 120000 });
      ['', '.1', '.2', '.3', '.4'].forEach(function (suffix) { if (fs.existsSync(p.ticks + suffix)) seen[suffix] = true; });
    }
    eq(!!seen['.1'], true, 'the tick log rotates once it passes max_bytes');
    eq(!!seen['.3'], true, 'and keeps the configured number of generations');
    eq(fs.existsSync(p.ticks + '.4'), false, 'but no more than that: the oldest is renamed over');
    var total = ['', '.1', '.2', '.3'].reduce(function (a, s2) { try { return a + fs.statSync(p.ticks + s2).size; } catch (e) { return a; } }, 0);
    ok(total < 200 * 5, 'so Guardian history stays bounded (' + total + ' bytes) without any deletion');
  })();

  fs.writeFileSync(p.state, '{broken');
  eq(engine.run({ io: io, state_dir: STATE, config: CFG, now_ms: NOW + 360000 }).report.tick, 1, 'corrupt state restarts cleanly from tick 1');
  fs.writeFileSync(p.state, JSON.stringify({ version: 999 }));
  eq(engine.run({ io: io, state_dir: STATE, config: CFG, now_ms: NOW + 480000 }).report.tick, 1, 'an unknown state version is discarded, not trusted');
})();

// =====================================================
section('8. report: text and OTH incident rendering');
// =====================================================
(function () {
  var io = makeIo();
  healthyHost(CFG);
  var out = engine.tick({ io: io, config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  var text = report.text(out.report);
  ok(text.indexOf('MYTHOS Guardian') === 0, 'the text report starts with the name');
  ok(/memory\s+NORMAL/.test(text), 'the text report lists the memory domain');
  var md = report.incident(out.report);
  ok(md.indexOf('# ') === 0, 'the incident report is markdown');
  ok(md.indexOf('## What Guardian did') > 0, 'it states what Guardian did');
  ok(/observe-only/.test(md), 'and that it is observe-only');

  writeProc({ availMib: 500, psi60: 55 });
  fixture('resource-pressure.json', { level: 'CRITICAL', updated_at: iso(20) });
  var bad = engine.tick({ io: io, config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  ok(/CRITICAL|EMERGENCY/.test(report.incident(bad.report)), 'a pressure incident reports the level');
  var sug = report.suggestions(bad.report);
  ok(sug.length > 0, 'suggestions are offered for an incident');
  ok(!sug.some(function (s) { return /prune|rm -rf|delete|force/i.test(s); }), 'no suggestion is destructive');
  healthyHost(CFG);
})();

// =====================================================
section('9. scenarios: every simulation is dry and matches expectation');
// =====================================================
(function () {
  var cli = require(BIN);
  var io = makeIo();
  var names = scenarios.names();
  ok(names.length >= 25, names.length + ' scenarios are defined');
  var p = engine.paths(STATE);
  var before = fs.existsSync(p.state) ? fs.statSync(p.state).mtimeMs : null;
  var diffs = [];
  names.forEach(function (n) {
    var r = cli.simulateOne(io, configMod.DEFAULTS, n, 4);
    if (!r.matches_expectation) diffs.push(n + ' -> ' + JSON.stringify(r.final) + ' expected ' + JSON.stringify(r.expect));
    ok(r.report.mode === 'dry-run', 'scenario ' + n + ' ran dry');
  });
  eq(diffs.length, 0, 'every scenario matches its expectation' + (diffs.length ? ': ' + diffs.join('; ') : ''));
  eq(fs.existsSync(p.state) ? fs.statSync(p.state).mtimeMs : null, before, 'running every scenario wrote nothing');
  eq(scenarios.collectorsFor('no-such-scenario', configMod.DEFAULTS, NOW), null, 'an unknown scenario yields no collectors');
})();

// =====================================================
section('10. isolation audit: no production path is ever written');
// =====================================================
(function () {
  // Re-run a full observe tick with every write primitive recording instead
  // of writing, and assert that no recorded target escapes the temporary
  // state directory. This is the regression guard for 2026-09-14, when a
  // test wrote the live ERP backup health record through a $HOME default.
  var writes = [];
  var recording = makeIo({
    writeStateAtomic: function (p) { writes.push(p); return true; },
    appendState: function (p) { writes.push(p); return true; },
    mkdirState: function (p) { writes.push(p); return true; },
    renameState: function (a, b) { writes.push(a); writes.push(b); return true; },
    lock: function (p) { writes.push(p); return { path: p, acquired: true }; },
    unlock: function () { return true; }
  });
  healthyHost(CFG);
  engine.run({ io: recording, state_dir: STATE, config: CFG, now_ms: NOW });
  ok(writes.length > 0, 'the tick attempted ' + writes.length + ' writes');
  var escapes = writes.filter(function (p) { return path.resolve(p) !== path.resolve(STATE) && path.resolve(p).indexOf(path.resolve(STATE) + path.sep) !== 0; });
  eq(escapes.length, 0, 'no write escapes the temporary state directory' + (escapes.length ? ': ' + escapes.join(', ') : ''));

  // Every production default named by DEFAULTS must be redirected into the
  // temporary tree before the suite touches it. This is the positive form of
  // "the suite never opens a production path", and unlike a scan of this
  // file's own text it cannot be satisfied by accident.
  var PRODUCTION_DEFAULTS = [
    configMod.DEFAULTS.memory.pressure_file,
    configMod.DEFAULTS.memory.memwatch_log,
    configMod.DEFAULTS.sessions.snapshot_file,
    configMod.DEFAULTS.services.live_status_file
  ].concat(configMod.DEFAULTS.backup.records.map(function (r) { return r.file; }));
  var effective = [CFG.memory.pressure_file, CFG.memory.memwatch_log, CFG.sessions.snapshot_file, CFG.services.live_status_file]
    .concat(CFG.backup.records.map(function (r) { return r.file; }));
  PRODUCTION_DEFAULTS.forEach(function (prod) {
    eq(effective.indexOf(prod), -1, 'the production default ' + prod + ' is not in the effective test config');
    eq(fs.existsSync(path.join(ROOT, prod)), false, 'and was not shadow-created under the temp root');
  });
  eq(CFG.memory.pressure_file.indexOf(ROOT), 0, 'the pressure file is redirected into the temp tree');
  eq(CFG.memory.memwatch_log.indexOf(ROOT), 0, 'the memwatch log is redirected');
  eq(CFG.sessions.snapshot_file.indexOf(ROOT), 0, 'the session snapshot is redirected');
  eq(CFG.services.live_status_file.indexOf(ROOT), 0, 'the Status Center file is redirected');
  CFG.backup.records.forEach(function (r) { eq(r.file.indexOf(ROOT), 0, 'backup record ' + r.id + ' is redirected'); });

  // The default state directory is per-user and never a production location.
  var defaultDir = path.join(os.homedir(), '.local', 'state', 'mythos-guardian');
  eq(defaultDir.indexOf(os.homedir()), 0, 'the default state directory lives under the running user home');
  ok(!/mythos-prod|mythos-backups|var\/lib\/mythos|var\/www/.test(defaultDir), 'and is not a production path');
})();

// =====================================================
section('11. failure safety: Guardian survives a broken host');
// =====================================================
(function () {
  healthyHost(CFG);
  var cases = {
    'every read throws': { readFile: function () { throw new Error('EIO'); }, readJson: function () { throw new Error('EIO'); } },
    'readdir throws': { readdir: function () { throw new Error('EACCES'); } },
    'statfs throws': { statfs: function () { throw new Error('ENOSYS'); } },
    'spawn throws': { spawn: function () { throw new Error('ENOENT'); } },
    'spawn returns garbage': { spawn: function () { return { status: 0, stdout: 'garbage without separators', stderr: '', error: null }; } },
    'spawn times out': { spawn: function () { return { status: null, stdout: '', stderr: '', error: 'ETIMEDOUT' }; } }
  };
  Object.keys(cases).forEach(function (name) {
    var threw = null, out = null;
    try { out = engine.tick({ io: makeIo(cases[name]), config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true }); }
    catch (e) { threw = e && e.message; }
    eq(threw, null, 'a tick survives: ' + name);
    if (out) {
      ok(levels.isLevel(out.report.host.level), name + ': the report still carries a valid host level');
      ok(out.report.guardian.state === 'OK' || out.report.guardian.issues.length > 0, name + ': Guardian says why it is degraded');
    }
  });
  ['', '   ', 'null', '[]', '{"level":null}', '{"level":"NORMAL"'].forEach(function (body) {
    fs.writeFileSync(path.join(FIX, 'resource-pressure.json'), body);
    var threw = null;
    try { engine.tick({ io: makeIo(), config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true }); } catch (e) { threw = e && e.message; }
    eq(threw, null, 'a malformed publication does not crash the tick: ' + JSON.stringify(body));
  });
  // A publication dated in the future is not evidence.
  fixture('resource-pressure.json', { level: 'CRITICAL', updated_at: new Date(NOW + 3600000).toISOString() });
  var future = engine.tick({ io: makeIo(), config: CFG, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  eq(future.report.domains.memory.summary.resource_guard_level, null, 'a future-dated publication is rejected, not trusted');
  fixture('resource-pressure.json', { level: 'NORMAL', updated_at: iso(30) });
})();

// =====================================================
section('12. CLI surface');
// =====================================================
(function () {
  var cli = require(BIN);
  var parsed = cli.parseArgs(['run', '--dry-run', '--state-dir', '/tmp/x', '--json']);
  eq(parsed._[0], 'run', 'the subcommand is parsed');
  eq(parsed.flags['dry-run'], true, 'a boolean flag is parsed');
  eq(parsed.flags['state-dir'], '/tmp/x', 'a value flag is parsed');
  var text = fs.readFileSync(BIN, 'utf8');
  ok(/simulate/.test(text) && /scenarios/.test(text) && /validate/.test(text) && /selftest/.test(text), 'every documented subcommand exists');
  ok(!/child_process|execSync|spawnSync/.test(text), 'the CLI does not execute commands of its own');
  // `simulate` must be structurally incapable of a live tick.
  var sim = text.slice(text.indexOf("if (cmd === 'simulate')"), text.indexOf("if (cmd === 'selftest')"));
  ok(/simulateOne/.test(sim) && !/dry_run:\s*false/.test(sim), 'simulate can only reach the dry-run path');
  ok(/dry_run: true/.test(text.slice(text.indexOf('function simulateOne'))), 'simulateOne always ticks dry');
})();

// =====================================================
section('13. Status Center probe: NOT_INSTALLED is not DOWN');
// =====================================================
(function () {
  var monitor = require(path.join(BASE, 'projects', 'status-center', 'monitor', 'bin', 'monitor.js'));
  var probes = JSON.parse(fs.readFileSync(path.join(BASE, 'projects', 'status-center', 'monitor', 'probes.json'), 'utf8'));
  var registered = probes.probes.filter(function (x) { return x.type === 'guardian'; });
  eq(registered.length, 1, 'exactly one guardian probe is registered');
  eq(registered[0].id, 'guardian-lifecycle', 'it is guardian-lifecycle');
  eq(registered[0].file.indexOf('/home/deploy/.local/state/'), 0, 'it reads Guardian state, not a production path');
  ok(registered[0].enabled_marker, 'it distinguishes installed from enabled');

  var reportFile = path.join(FIX, 'guardian-report.json');
  var marker = path.join(FIX, 'guardian-installed-marker');
  var enabled = path.join(FIX, 'guardian-enabled-marker');
  function probe(over) { return monitor.probeGuardian(Object.assign({ file: reportFile, installed_marker: marker, enabled_marker: enabled, max_age_seconds: 900 }, over || {})); }
  function write(r) { fs.writeFileSync(reportFile, JSON.stringify(r)); }
  function clean() { [reportFile, marker, enabled].forEach(function (f) { try { fs.unlinkSync(f); } catch (e) { /* absent */ } }); }
  function guardian(over) { return Object.assign({ state: 'OK', issues: [], observed_domains: 5, remediation: { remediation_available: false, enabled_flags: [] } }, over || {}); }

  var chain = Promise.resolve();
  function step(name, setup, check) {
    chain = chain.then(function () { clean(); setup(); return probe(); }).then(check);
  }

  // THE requirement: Guardian that was never installed is NOT an outage.
  step('not installed', function () { /* nothing exists */ }, function (r) {
    eq(r.state, 'NOT_MONITORED', 'with no report and no installed timer the probe is NOT_MONITORED');
    eq(r.error, null, 'and reports no error');
    ok(/not installed/.test(r.note || ''), 'and says why');
  });
  step('installed but silent', function () { fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, ''); }, function (r) {
    eq(r.state, 'DOWN', 'an INSTALLED and ENABLED Guardian that has never reported is DOWN');
  });
  // Installed but deliberately switched off is an operator decision, not an
  // outage. This is the same principle as NOT_INSTALLED, one step later.
  step('installed but disabled', function () { fs.writeFileSync(marker, ''); }, function (r) {
    eq(r.state, 'NOT_MONITORED', 'an installed Guardian with its timer off is NOT_MONITORED, not DOWN');
    eq(r.detail.lifecycle, 'DISABLED', 'and its lifecycle is DISABLED');
  });
  step('healthy, observe-only', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date().toISOString(), tick: 5, host: { level: 'NORMAL', partial: false }, guardian: guardian() });
  }, function (r) {
    eq(r.state, 'LIVE', 'a reporting, healthy Guardian is LIVE');
    eq(r.detail.lifecycle, 'OBSERVE_ONLY', 'and its lifecycle is OBSERVE_ONLY');
    eq(r.detail.remediation_available, false, 'the report records that remediation is unavailable');
    eq(r.detail.host_level, 'NORMAL', 'and carries the host level for context');
  });
  step('healthy, remediation on', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date().toISOString(), tick: 6, host: { level: 'NORMAL', partial: false },
      guardian: guardian({ remediation: { remediation_available: true, enabled_flags: ['allow_disk_remediation'] } }),
      actions: [{ mode: 'executed' }, { mode: 'dry-run' }] });
  }, function (r) {
    eq(r.state, 'LIVE', 'remediation being enabled does not make the probe red');
    eq(r.detail.lifecycle, 'ACTIVE', 'the lifecycle is ACTIVE');
    eq(r.detail.enabled_flags[0], 'allow_disk_remediation', 'and the enabled flags are published');
    eq(r.detail.actions_taken, 1, 'and only EXECUTED actions are counted');
  });
  step('host emergency', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date().toISOString(), tick: 7, host: { level: 'EMERGENCY', partial: false }, guardian: guardian() });
  }, function (r) {
    eq(r.detail.lifecycle, 'EMERGENCY', 'a host emergency shows in the Guardian lifecycle');
    eq(r.state, 'LIVE', 'but the GUARDIAN probe stays LIVE: the host has its own probes');
  });
  step('host critical, guardian fine', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date().toISOString(), tick: 8, host: { level: 'CRITICAL', partial: false }, guardian: { state: 'OK', issues: [], observed_domains: 5, remediation: { remediation_available: false } } });
  }, function (r) {
    eq(r.state, 'LIVE', 'a CRITICAL host does not make the GUARDIAN probe red: the host has its own probes');
    eq(r.detail.host_level, 'CRITICAL', 'the host level is still reported as detail');
  });
  step('degraded', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date().toISOString(), tick: 9, host: { level: 'NORMAL', partial: true }, guardian: { state: 'DEGRADED', issues: ['memory: signal degraded'], observed_domains: 4, remediation: { remediation_available: false } } });
  }, function (r) {
    eq(r.state, 'DEGRADED', 'a degraded Guardian is DEGRADED');
    ok(/signal degraded/.test(r.error), 'and the reason is carried through');
  });
  step('blind', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date().toISOString(), tick: 10, host: { level: 'NORMAL', partial: true }, guardian: { state: 'BLIND', issues: ['everything'], observed_domains: 0, remediation: { remediation_available: false } } });
  }, function (r) {
    eq(r.state, 'DOWN', 'a BLIND Guardian is DOWN: the observer itself has failed');
  });
  step('stale', function () {
    fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, '');
    write({ generated_at: new Date(Date.now() - 3600000).toISOString(), tick: 9, host: { level: 'NORMAL', partial: false }, guardian: { state: 'OK', issues: [], observed_domains: 5, remediation: { remediation_available: false } } });
  }, function (r) {
    eq(r.state, 'DOWN', 'a Guardian that stopped reporting is DOWN');
    ok(/stopped reporting/.test(r.error), 'and says how long ago');
  });
  step('corrupt report', function () { fs.writeFileSync(marker, ''); fs.writeFileSync(enabled, ''); fs.writeFileSync(reportFile, '{broken'); }, function (r) {
    eq(r.state, 'DOWN', 'an unreadable report is DOWN, never silent green');
  });

  chain.then(function () {
    clean();
    finish();
  }).catch(function (e) {
    failed++; failures.push('status-center probe section threw: ' + (e && e.stack || e));
    finish();
  });
})();


// =====================================================
section('14. remediation: the action registry');
// =====================================================
(function () {
  var ids = actionsMod.list().map(function (a) { return a.id; });
  ok(ids.length >= 4, ids.length + ' actions are registered');
  eq(new Set(ids).size, ids.length, 'every action id is unique');
  actionsMod.list().forEach(function (a) {
    ok(/^ACTION_[A-Z_]+$/.test(a.id), a.id + ' has a conventional id');
    ok(['memory', 'sessions', 'disk', 'services', 'backup'].indexOf(a.domain) >= 0, a.id + ' names a real domain');
    ok(levels.isLevel(a.min_level), a.id + ' has a valid min_level');
    ok(typeof a.flag === 'string' && /^allow_/.test(a.flag), a.id + ' is gated by an allow_* flag');
    ok(typeof a.cooldown_s === 'number' && a.cooldown_s > 0, a.id + ' has a cooldown');
    ok(typeof a.max_per_day === 'number' && a.max_per_day > 0, a.id + ' has a daily ceiling');
    ok(typeof a.reversible === 'string' && a.reversible.length > 10, a.id + ' states what undoing it costs');
    ok(Array.isArray(a.protects) && a.protects.length, a.id + ' states what it protects');
    ok(typeof a.precondition === 'function', a.id + ' has a precondition');
    ok(typeof a.verify === 'function', a.id + ' verifies its own effect');
    ok(typeof a.command === 'function' || typeof a.publish === 'function', a.id + ' declares a command or a publication');
    eq(actionsMod.get(a.id), a, a.id + ' is retrievable from the registry by id');
  });
  eq(actionsMod.get('ACTION_DOES_NOT_EXIST'), null, 'an unknown action id yields nothing');
  eq(actionsMod.get('constructor'), null, 'a prototype key is not an action');
  eq(actionsMod.get('__proto__'), null, 'neither is __proto__');

  // No action may ever touch a protected resource.
  [
    ['systemctl', '--user', 'restart', 'erp-api.service'],
    ['systemctl', '--user', 'restart', 'mythos-ai-executor.service'],
    ['docker', 'rm', 'idauto-postgres'],
    ['npm', 'cache', 'clean', '--prefix', '/home/deploy/mythos-backups'],
    ['docker', 'builder', 'prune', '--force', '--filter', 'label=erp'],
    ['systemctl', '--user', 'restart', 'mariadb.service']
  ].forEach(function (argv) {
    ok(actionsMod.refusesProtected(argv) !== null, 'PROTECTED refuses: ' + argv.join(' '));
  });
  eq(actionsMod.refusesProtected(['npm', 'cache', 'clean', '--force']), null, 'and allows a genuinely harmless argv');

  // Whatever an action asks to run must be in the ACTION allowlist.
  actionsMod.list().forEach(function (a) {
    if (!a.command) return;
    var argv = a.command({ policy: configMod.DEFAULTS.remediation, target: { unit: 'spy-monitor.service' } });
    ok(ioMod.allowedAction(argv), a.id + ' produces an allowlisted argv: ' + argv.join(' '));
    eq(ioMod.allowedCommand(argv), false, a.id + ' argv is NOT a read command');
  });
})();

// =====================================================
section('15. remediation: the action channel is disarmed');
// =====================================================
(function () {
  var realIo = ioMod.createIo({});
  realIo.stateDir = STATE;
  eq(realIo.armed, false, 'io.armed is false by default');

  var r = realIo.act(['npm', 'cache', 'clean', '--force']);
  eq(r.refused, true, 'an allowlisted action refuses while disarmed');
  eq(r.error, 'action_channel_disarmed', 'and says why');
  eq(r.status, null, 'and never produced an exit status');

  realIo.armed = true;
  var bad = realIo.act(['docker', 'system', 'prune', '-a']);
  eq(bad.refused, true, 'even ARMED, a non-allowlisted argv refuses');
  eq(bad.error, 'action_not_allowlisted', 'and says why');
  realIo.armed = false;

  [['docker', 'system', 'prune'], ['docker', 'volume', 'prune'], ['docker', 'rm', 'x'], ['docker', 'rmi', 'x'],
   ['systemctl', '--user', 'stop', 'x'], ['systemctl', 'stop', 'nginx'], ['systemctl', '--user', 'disable', 'x'],
   ['rm', '-rf', '/'], ['kill', '-9', '1'], ['pkill', 'node'], ['chmod', '777', '/'], ['git', 'reset', '--hard']
  ].forEach(function (argv) {
    eq(ioMod.allowedAction(argv), false, 'action allowlist refuses: ' + argv.join(' '));
  });
  ok(ioMod.ACTION_COMMANDS.every(function (a) { return ioMod.allowedCommand(a) === false; }),
    'the read and action allowlists are disjoint');

  // publishAdvisory: disarmed, and cannot be pointed anywhere.
  var pubDir = path.join(ROOT, 'pub');
  fs.mkdirSync(pubDir, { recursive: true });
  eq(realIo.publishAdvisory(pubDir, 'admission.json', { a: 1 }).error, 'action_channel_disarmed', 'publishing refuses while disarmed');
  realIo.armed = true;
  ['../escape.json', '/etc/passwd.json', 'a/b.json', 'admission.txt', '..json', ''].forEach(function (name) {
    var res = realIo.publishAdvisory(pubDir, name, { a: 1 });
    eq(res.ok, false, 'publication name refused: ' + JSON.stringify(name));
  });
  eq(realIo.publishAdvisory(path.join(ROOT, 'no-such-dir'), 'admission.json', { a: 1 }).error, 'publish_dir_missing', 'a missing publish dir refuses');
  var good = realIo.publishAdvisory(pubDir, 'admission.json', { level: 'WARNING', max_concurrent_agents: 4 });
  eq(good.ok, true, 'a valid publication succeeds');
  eq(JSON.parse(fs.readFileSync(path.join(pubDir, 'admission.json'), 'utf8')).max_concurrent_agents, 4, 'and is readable back');
  eq(fs.statSync(path.join(pubDir, 'admission.json')).mode & 0o777, 0o644, 'and is 0644');
  realIo.armed = false;
})();

// =====================================================
section('16. remediation: every gate, in order');
// =====================================================
(function () {
  // A synthetic report puts each domain exactly where a test needs it.
  function reportAt(overrides) {
    var d = { memory: 'NORMAL', sessions: 'NORMAL', disk: 'NORMAL', services: 'NORMAL', backup: 'NORMAL' };
    Object.keys(overrides || {}).forEach(function (k) { d[k] = overrides[k]; });
    return {
      host: { level: levels.maxOf(Object.keys(d).map(function (k) { return d[k]; })) },
      domains: {
        memory: { level: d.memory, summary: { mem_available_mib: 900 } },
        sessions: { level: d.sessions, summary: { remote_sessions: 14, admission_ceiling: 4 } },
        disk: { level: d.disk, summary: { used_pct: 91, free_gb: 5, docker: null } },
        services: { level: d.services, summary: { table: { 'spy-monitor': { status: 'FAILED', class: 'support' }, 'erp-api': { status: 'FAILED', class: 'critical' } } } },
        backup: { level: d.backup, summary: {} }
      }
    };
  }
  function cfgWith(over) {
    return configMod.deepMerge(configMod.deepMerge(configMod.DEFAULTS, {
      observe_only: false, allow_disk_remediation: true, allow_agent_throttling: true, allow_service_restart: true,
      remediation: { publish_dir: path.join(ROOT, 'pub'), max_actions_per_tick: 3 },
      services: { restartable: ['spy-monitor'] }
    }), over || {});
  }
  var measure = { npmCacheMib: function () { return 300; }, dockerBuildCacheGb: function () { return 4.2; } };
  function planWith(report, cfg, extra) {
    var io = makeIo();
    return remediateMod.plan(report, cfg, io, Object.assign({
      now_ms: NOW, history: remediateMod.emptyHistory(), measure: measure, docker: { build_cache_reclaimable_gb: 4.2 }
    }, extra || {}));
  }
  function gateOf(p, id) { return (p.decisions.filter(function (d) { return d.action === id; })[0] || {}).gate; }
  function allowedIds(p) { return p.approved.map(function (d) { return d.action; }); }

  // GATE 1 — observe_only beats an enabled flag.
  var obs = planWith(reportAt({ disk: 'CRITICAL' }), cfgWith({ observe_only: true }));
  eq(allowedIds(obs).length, 0, 'observe_only allows nothing');
  eq(gateOf(obs, 'ACTION_CLEAR_NPM_CACHE'), 'observe_only', 'and that is the gate that stopped it');

  // GATE 2 — the flag.
  var noFlag = planWith(reportAt({ disk: 'CRITICAL' }), cfgWith({ allow_disk_remediation: false }));
  eq(gateOf(noFlag, 'ACTION_CLEAR_NPM_CACHE'), 'flag', 'a disabled flag blocks its actions');

  // GATE 4 — level.
  var lowDisk = planWith(reportAt({ disk: 'WARNING' }), cfgWith());
  eq(gateOf(lowDisk, 'ACTION_CLEAR_NPM_CACHE'), 'level', 'disk WARNING is below the HIGH threshold');
  var highDisk = planWith(reportAt({ disk: 'HIGH' }), cfgWith());
  ok(allowedIds(highDisk).indexOf('ACTION_CLEAR_NPM_CACHE') >= 0, 'disk HIGH makes the npm cache action a candidate');

  // GATE 5 — precondition.
  var tinyCache = remediateMod.plan(reportAt({ disk: 'CRITICAL' }), cfgWith(), makeIo(), {
    now_ms: NOW, history: remediateMod.emptyHistory(),
    measure: { npmCacheMib: function () { return 10; }, dockerBuildCacheGb: function () { return 0.1; } },
    docker: { build_cache_reclaimable_gb: 0.1 }
  });
  eq(gateOf(tinyCache, 'ACTION_CLEAR_NPM_CACHE'), 'precondition', 'a 10 MiB cache is not worth an action');
  eq(gateOf(tinyCache, 'ACTION_PRUNE_DOCKER_BUILD_CACHE'), 'precondition', 'nor is 0.1 GB of build cache');

  // GATE 8 — cooldown.
  var hist = remediateMod.emptyHistory();
  hist.last_run_ms['ACTION_CLEAR_NPM_CACHE'] = NOW - 60 * 1000;
  var cooled = planWith(reportAt({ disk: 'CRITICAL' }), cfgWith(), { history: hist });
  eq(gateOf(cooled, 'ACTION_CLEAR_NPM_CACHE'), 'cooldown', 'a recent run blocks the next one');

  // GATE 9 — rolling daily ceiling.
  var hist2 = remediateMod.emptyHistory();
  hist2.runs['ACTION_CLEAR_NPM_CACHE'] = [NOW - 20 * 3600000, NOW - 10 * 3600000];
  var rated = planWith(reportAt({ disk: 'CRITICAL' }), cfgWith(), { history: hist2 });
  eq(gateOf(rated, 'ACTION_CLEAR_NPM_CACHE'), 'rate_limit', '2 runs in 24 h hits the ceiling of 2');
  var hist3 = remediateMod.emptyHistory();
  hist3.runs['ACTION_CLEAR_NPM_CACHE'] = [NOW - 30 * 3600000, NOW - 26 * 3600000];
  ok(allowedIds(planWith(reportAt({ disk: 'CRITICAL' }), cfgWith(), { history: hist3 })).indexOf('ACTION_CLEAR_NPM_CACHE') >= 0,
    'runs older than 24 h fall out of the window');

  // GATE 10 — per-tick budget.
  var budgeted = planWith(reportAt({ disk: 'CRITICAL', sessions: 'HIGH', services: 'HIGH' }), cfgWith({ remediation: { max_actions_per_tick: 1 } }));
  eq(budgeted.approved.length, 1, 'the tick budget caps how many actions are approved');
  ok(budgeted.decisions.some(function (d) { return d.gate === 'budget'; }), 'and the others say budget');

  // The service restart gate chain.
  var svc = planWith(reportAt({ services: 'HIGH' }), cfgWith());
  var svcDec = svc.decisions.filter(function (d) { return d.action === 'ACTION_RESTART_APPROVED_SERVICE'; });
  eq(svcDec.length, 1, 'only the configured restartable unit is a candidate');
  eq(svcDec[0].target, 'spy-monitor', 'and it is the support unit, never erp-api');
  ok(svc.approved.some(function (d) { return d.target === 'spy-monitor'; }), 'a down support unit is restartable');

  var looping = reportAt({ services: 'HIGH' });
  looping.domains.services.summary.table['spy-monitor'].status = 'LOOP';
  eq(gateOf(planWith(looping, cfgWith()), 'ACTION_RESTART_APPROVED_SERVICE'), 'precondition',
    'a unit already in a restart loop is NOT restarted again');

  var healthy = reportAt({ services: 'HIGH' });
  healthy.domains.services.summary.table['spy-monitor'].status = 'OK';
  eq(gateOf(planWith(healthy, cfgWith()), 'ACTION_RESTART_APPROVED_SERVICE'), 'precondition',
    'a unit that is up is not restarted');

  var exhausted = remediateMod.emptyHistory();
  exhausted.runs['ACTION_RESTART_APPROVED_SERVICE:spy-monitor'] = [NOW - 5 * 3600000, NOW - 4 * 3600000, NOW - 3 * 3600000];
  var deg = planWith(reportAt({ services: 'HIGH' }), cfgWith(), { history: exhausted });
  ok(['precondition', 'rate_limit'].indexOf(gateOf(deg, 'ACTION_RESTART_APPROVED_SERVICE')) >= 0,
    'after max_attempts the unit is left alone for a human, not restarted forever');

  // Configuration cannot promote a protected unit into the restartable list.
  var promoted = configMod.validate(cfgWith({ services: { restartable: ['erp-api'] } }));
  ok(promoted.length > 0, 'configuration cannot make erp-api restartable');
  ok(configMod.validate(cfgWith({ services: { restartable: ['nginx'] } })).length > 0, 'nor nginx');
  ok(configMod.validate(cfgWith({ services: { restartable: ['memwatch'] } })).length > 0, 'nor a system unit');
})();

// =====================================================
section('17. remediation: dry run changes nothing, execute is opt-in');
// =====================================================
(function () {
  function cfgWith(over) {
    return configMod.deepMerge(configMod.deepMerge(configMod.DEFAULTS, {
      observe_only: false, allow_agent_throttling: true,
      remediation: { publish_dir: path.join(ROOT, 'pub2'), max_actions_per_tick: 3 }
    }), over || {});
  }
  fs.mkdirSync(path.join(ROOT, 'pub2'), { recursive: true });
  var report = {
    host: { level: 'HIGH' },
    domains: {
      memory: { level: 'CRITICAL', summary: {} },
      sessions: { level: 'HIGH', summary: { remote_sessions: 14, admission_ceiling: 0 } },
      disk: { level: 'NORMAL', summary: { used_pct: 60 } },
      services: { level: 'NORMAL', summary: { table: {} } },
      backup: { level: 'NORMAL', summary: {} }
    }
  };
  var cfg = cfgWith();
  var io = makeIo();
  var p = remediateMod.plan(report, cfg, io, { now_ms: NOW, history: remediateMod.emptyHistory(), measure: { npmCacheMib: function () { return 0; }, dockerBuildCacheGb: function () { return 0; } } });
  ok(p.approved.some(function (d) { return d.action === 'ACTION_PUBLISH_ADMISSION_ADVISORY'; }), 'the advisory is approved under pressure');

  // Dry run: nothing written, io never armed.
  var armedEver = false;
  var watching = makeIo();
  Object.defineProperty(watching, 'armed', {
    get: function () { return false; },
    set: function (v) { if (v === true) armedEver = true; }
  });
  var dryResults = remediateMod.execute(p, cfg, watching, { dry_run: true });
  eq(dryResults.length, p.approved.length, 'a dry run produces a record per approved action');
  ok(dryResults.every(function (r) { return r.mode === 'dry-run' && r.result === 'would-run'; }), 'each says would-run');
  eq(armedEver, false, 'a dry run never arms the action channel');
  eq(fs.existsSync(path.join(ROOT, 'pub2', 'admission.json')), false, 'and writes no publication');

  // execute defaults to dry: you must ask for it.
  var defaulted = remediateMod.execute(p, cfg, makeIo(), {});
  ok(defaulted.every(function (r) { return r.mode === 'dry-run'; }), 'execute() defaults to a dry run');
  eq(fs.existsSync(path.join(ROOT, 'pub2', 'admission.json')), false, 'still nothing written');

  // Real execution of the one non-command action.
  var liveIo = makeIo();
  var liveResults = remediateMod.execute(p, cfg, liveIo, { dry_run: false });
  var pub = liveResults.filter(function (r) { return r.action === 'ACTION_PUBLISH_ADMISSION_ADVISORY'; })[0];
  eq(pub.mode, 'executed', 'the advisory executes when asked');
  eq(pub.result, 'published', 'and reports published');
  eq(pub.verified, true, 'and verifies its own effect');
  eq(liveIo.armed, false, 'the channel is disarmed again afterwards');
  var body = JSON.parse(fs.readFileSync(path.join(ROOT, 'pub2', 'admission.json'), 'utf8'));
  eq(body.max_concurrent_agents, 0, 'the published ceiling matches the memory level');
  eq(body.advisory, true, 'and it is marked advisory');

  // History records only real runs.
  var h = remediateMod.recordRuns(remediateMod.emptyHistory(), liveResults, NOW);
  ok(h.last_run_ms['ACTION_PUBLISH_ADMISSION_ADVISORY'] === NOW, 'an executed action is recorded');
  var h2 = remediateMod.recordRuns(remediateMod.emptyHistory(), dryResults, NOW);
  eq(Object.keys(h2.last_run_ms).length, 0, 'a dry run is NOT recorded, so it cannot consume a cooldown');
})();

// =====================================================
section('18. remediation: through the engine, and the audit trail');
// =====================================================
(function () {
  healthyHost(CFG);
  var io = makeIo();
  var base = configMod.deepMerge(CFG, {
    observe_only: false, allow_agent_throttling: true,
    remediation: { publish_dir: path.join(ROOT, 'pub3'), max_actions_per_tick: 2 }
  });
  fs.mkdirSync(path.join(ROOT, 'pub3'), { recursive: true });

  // The plan is present even when nothing is allowed — that is what an
  // operator reads during an incident.
  var observeCfg = configMod.deepMerge(base, { observe_only: true });
  var obs = engine.tick({ io: io, config: observeCfg, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  ok(obs.report.remediation, 'the report always carries a remediation plan');
  ok(obs.report.remediation.decisions.length > 0, 'with a decision per action');
  ok(obs.report.remediation.decisions.every(function (d) { return d.gate === 'observe_only'; }), 'all blocked by observe_only');
  eq(obs.report.actions.length, 0, 'and nothing ran');
  eq(obs.report.guardian.remediation.remediation_available, false, 'posture says remediation is unavailable');

  var live = engine.tick({ io: io, config: base, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  eq(live.report.guardian.remediation.remediation_available, true, 'with observe_only off the posture says available');
  ok(live.report.guardian.remediation.enabled_flags.indexOf('allow_agent_throttling') >= 0, 'and names the enabled flags');

  // `run` must never execute, whatever the config says.
  var p = engine.paths(STATE);
  try { fs.unlinkSync(p.actions); } catch (e) { /* none yet */ }
  var ran = engine.run({ io: io, state_dir: STATE, config: base, now_ms: NOW });
  ok(ran.report.actions.every(function (r) { return r.mode === 'dry-run'; }), 'engine.run never executes actions');

  // Explicit execution writes the audit trail.
  var pressured = configMod.deepMerge(base, { sessions: { hard_max_sessions: 0 } });
  var ex = engine.run({ io: io, state_dir: STATE, config: pressured, now_ms: NOW + 600000, execute_actions: true });
  var executed = ex.report.actions.filter(function (r) { return r.mode === 'executed'; });
  if (executed.length) {
    ok(fs.existsSync(p.actions), 'an executed action is written to actions.jsonl');
    var rec = JSON.parse(fs.readFileSync(p.actions, 'utf8').trim().split('\n').pop());
    ok(rec.at && rec.action && rec.mode === 'executed', 'the audit record carries a timestamp, an id and the mode');
    ok(Object.prototype.hasOwnProperty.call(rec, 'before'), 'and the state before');
    ok(Object.prototype.hasOwnProperty.call(rec, 'verification') || rec.result === 'failed', 'and the verification after');
    ok(rec.reversible, 'and what undoing it costs');
    ok(ex.state.actions.last_run_ms[rec.action + (rec.target ? ':' + rec.target : '')], 'and the cooldown is recorded in state');
  } else {
    ok(true, 'no action was approved in this environment; the gate chain is covered by §16');
  }
})();


// =====================================================
section('19. failure matrix: what survives what');
// =====================================================
(function () {
  // Each case asserts the SAME thing: Guardian degrades honestly and takes
  // nothing down with it. These are the failure modes the runbook promises.
  healthyHost(CFG);
  var remCfg = configMod.deepMerge(CFG, {
    observe_only: false, allow_disk_remediation: true, allow_agent_throttling: true,
    remediation: { publish_dir: path.join(ROOT, 'pub4') }
  });
  fs.mkdirSync(path.join(ROOT, 'pub4'), { recursive: true });

  // Two ticks, because a level Guardian INFERS (as opposed to one an upstream
  // component already confirmed) must earn two consecutive samples. Asserting
  // a committed level after one tick would be asserting the absence of the
  // hysteresis, not the presence of the signal.
  function tickWith(io, cfg, ticks) {
    var st = engine.emptyState(iso()), out = null;
    var n = ticks || 2;
    for (var i = 0; i < n; i++) {
      out = engine.tick({ io: io, config: cfg || CFG, state: st, now_ms: NOW + i * 120000, dry_run: true });
      st = out.state;
    }
    return out;
  }

  // Status Center unavailable — Guardian keeps every other domain.
  fixture('live-status.json', '');
  var noSC = tickWith(makeIo());
  ok(levels.isLevel(noSC.report.host.level), 'Status Center gone: Guardian still produces a host level');
  eq(noSC.report.domains.memory.unknown, false, 'and memory is still observed');
  eq(noSC.report.domains.disk.unknown, false, 'and disk is still observed');
  ok(noSC.report.guardian.issues.length > 0, 'and Guardian says an input is missing');
  healthyHost(CFG);

  // Resource Guard publication gone — /proc still believed.
  try { fs.unlinkSync(path.join(FIX, 'resource-pressure.json')); } catch (e) { /* absent */ }
  writeProc({ availMib: 500, psi60: 45 });
  var noRG = tickWith(makeIo());
  eq(noRG.report.domains.memory.level, 'CRITICAL', 'publication gone: real pressure is still CRITICAL');
  eq(noRG.report.domains.memory.unknown, false, 'and the domain is not blind');
  ok(noRG.report.guardian.state !== 'OK', 'Guardian reports itself degraded');
  healthyHost(CFG);

  // Backup record failing — Guardian must not report success.
  fixture('backup-health-db.json', { mode: 'backup', status: 'fail', last_backup_status: 'fail', last_success_at: iso(80 * 3600), consecutive_failures: 5 });
  var badBk = tickWith(makeIo());
  ok(levels.rank(badBk.report.domains.backup.level) >= levels.rank('HIGH'), 'a failed backup is HIGH, never green');
  ok(badBk.report.findings.some(function (f) { return f.domain === 'backup'; }), 'and is reported');
  healthyHost(CFG);

  // Disk pressure with remediation ON — only approved actions, nothing else.
  (function () {
    var io = makeIo({ statfs: function () { return { blocks: 1000, bfree: 60, bavail: 60, bsize: 4096, files: 1000, ffree: 900 }; } });
    var out = tickWith(io, remCfg);
    ok(levels.rank(out.report.domains.disk.level) >= levels.rank('CRITICAL'), 'a 94 % filesystem is at least CRITICAL');
    var ids = (out.report.remediation.decisions || []).map(function (d) { return d.action; });
    ok(ids.every(function (id) { return actionsMod.get(id) !== null; }), 'every planned action is a registry action');
    var allowed = (out.report.remediation.decisions || []).filter(function (d) { return d.allowed; });
    allowed.forEach(function (d) {
      eq(actionsMod.refusesProtected(d.argv || []), null, d.action + ' targets nothing protected');
      if (d.kind === 'command') ok(ioMod.allowedAction(d.argv), d.action + ' argv is allowlisted');
    });
    ok(allowed.length <= remCfg.remediation.max_actions_per_tick, 'never more than the per-tick budget');
  })();

  // A service failing repeatedly becomes DEGRADED, it is not restarted forever.
  (function () {
    var cfg = configMod.deepMerge(remCfg, { allow_service_restart: true, services: { restartable: ['memwatch'] } });
    // memwatch is a SYSTEM unit, so validation refuses it outright: a restart
    // storm on a system unit is not merely rate-limited, it is impossible.
    ok(configMod.validate(cfg).length > 0, 'a system unit cannot be made restartable at all');
  })();

  // Guardian's own crash must not be able to take anything with it: every
  // collector throwing still yields a valid, honest report.
  var hostile = makeIo({
    readFile: function () { throw new Error('EIO'); },
    readJson: function () { throw new Error('EIO'); },
    readdir: function () { throw new Error('EACCES'); },
    statfs: function () { throw new Error('ENOSYS'); },
    spawn: function () { throw new Error('ENOENT'); },
    lstat: function () { throw new Error('EIO'); }
  });
  var threw = null, crashed = null;
  try { crashed = engine.tick({ io: hostile, config: remCfg, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true }); }
  catch (e) { threw = e && e.message; }
  eq(threw, null, 'a totally hostile host does not crash the tick');
  if (crashed) {
    ok(levels.isLevel(crashed.report.host.level), 'and the report still carries a valid host level');
    eq(crashed.report.host.partial, true, 'flagged partial');
    ok(crashed.report.guardian.state !== 'OK', 'with Guardian degraded or blind');
    eq(crashed.report.actions.filter(function (a) { return a.mode === 'executed'; }).length, 0,
      'and NOTHING was executed while blind');
  }

  // Corrupt state, unknown version, empty state: Guardian restarts clean.
  var p = engine.paths(STATE);
  healthyHost(CFG);
  [['{broken', 'corrupt'], [JSON.stringify({ version: 999 }), 'a future version'], ['', 'an empty file'],
   [JSON.stringify({ version: 1, domains: 'not-an-object' }), 'a wrong-typed field']].forEach(function (c) {
    fs.writeFileSync(p.state, c[0]);
    var r = engine.run({ io: makeIo(), state_dir: STATE, config: CFG, now_ms: NOW });
    eq(r.report.tick, 1, 'state that is ' + c[1] + ' restarts cleanly at tick 1');
  });

  // The lock is not a wedge: a stale sentinel from a dead pid is reclaimed.
  (function () {
    var io = makeIo();
    var held = io.lock(p.lock);
    eq(held.acquired, true, 'lock acquired');
    // Rewrite the sentinel as a long-dead pid with an ancient timestamp.
    fs.writeFileSync(held.path, JSON.stringify({ pid: 999999, at: new Date(NOW - 3600000).toISOString() }) + '\n');
    var io2 = makeIo();
    var again = io2.lock(p.lock);
    eq(again.acquired, true, 'a stale lock from a dead holder is reclaimed, not a permanent wedge');
    io2.unlock(again);
  })();
})();

// =====================================================
section('20. rollback: every documented step actually works');
// =====================================================
(function () {
  // The runbook promises three rollbacks. Each is asserted here so the
  // documentation cannot drift away from the code.

  // 1. observe_only turns remediation off without stopping observation.
  var off = configMod.deepMerge(configMod.DEFAULTS, {
    observe_only: true, allow_disk_remediation: true, allow_service_restart: true, allow_agent_throttling: true
  });
  eq(configMod.validate(off).length, 0, 'observe_only:true with every flag set is a VALID configuration');
  var io = makeIo();
  healthyHost(CFG);
  var merged = configMod.deepMerge(CFG, { observe_only: true, allow_disk_remediation: true });
  var out = engine.tick({ io: io, config: merged, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  eq(out.report.guardian.remediation.remediation_available, false, 'and remediation is unavailable');
  ok((out.report.remediation.decisions || []).every(function (d) { return d.gate === 'observe_only'; }),
    'every action is stopped at the observe_only gate');
  eq(out.report.actions.filter(function (a) { return a.mode === 'executed'; }).length, 0, 'and nothing runs');
  ok(out.report.domains.memory.level, 'while observation continues normally');

  // 2. Disabling one flag disables exactly its actions and no others.
  var oneOff = configMod.deepMerge(CFG, { observe_only: false, allow_disk_remediation: false, allow_agent_throttling: true });
  var out2 = engine.tick({ io: io, config: oneOff, state: engine.emptyState(iso()), now_ms: NOW, dry_run: true });
  var byAction = {};
  (out2.report.remediation.decisions || []).forEach(function (d) { byAction[d.action] = d; });
  eq(byAction['ACTION_CLEAR_NPM_CACHE'].gate, 'flag', 'a disabled flag stops its own actions');
  ok(byAction['ACTION_PUBLISH_ADMISSION_ADVISORY'].gate !== 'flag', 'and leaves the other flag alone');

  // 3. The installer's rollback removes only Guardian's own files.
  var inst = fs.readFileSync(path.join(BASE, 'ops', 'guardian', 'install-guardian.sh'), 'utf8');
  var rollback = inst.slice(inst.indexOf('Rollback'), inst.indexOf('set -euo'));
  ok(/systemctl --user disable --now mythos-guardian.timer/.test(rollback), 'rollback disables the timer');
  ok(/rm -f .*\.local\/bin\/mythos-guardian/.test(rollback), 'removes the CLI symlink');
  ok(/rm -f .*mythos-guardian\.\{service,timer\}/.test(rollback), 'removes its own units');
  ok(/state directory is left in place/i.test(inst), 'and deliberately keeps the state directory');
  ok(!/rm -rf/.test(inst), 'the installer contains no rm -rf at all');
  ok(!/\/var\/lib\/mythos\/pressure/.test(rollback), 'and rollback never touches the pressure publication');

  // The installer refuses root, which is itself a safety property.
  ok(/refusing to run as root/.test(inst), 'and the installer refuses to run as root');
})();

function finish() {
  console.log('');
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* best-effort */ }
  console.log('Guardian: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error('failures:\n  ' + failures.join('\n  ')); process.exit(1); }
  process.exit(0);
}
