'use strict';

// tests/mythos-github-bridge-timer-test.js — schedule invariants of the
// GitHub bridge systemd user units (gh-issue-134). Offline and static: the
// bridge service is Type=oneshot, so the timer must re-arm from the unit's
// INACTIVE edge and must not carry Persistent= (which loads the last-trigger
// stamp and disables the already-elapsed OnBootSec mark on a fresh user
// manager → SubState=elapsed, NextElapse=infinity, polling stops).
// Optionally runs `systemd-analyze verify` when the binary is present.

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var UNIT_DIR = path.join(ROOT, 'projects', 'mythos-ai-executor', 'bridge', 'systemd');
var TIMER = path.join(UNIT_DIR, 'mythos-github-bridge.timer');
var SERVICE = path.join(UNIT_DIR, 'mythos-github-bridge.service');

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// Minimal unit-file parser: { SectionName: { Key: [values...] } }
function parseUnit(file) {
  var out = {}, section = null;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (raw) {
    var line = raw.trim();
    if (!line || line[0] === '#' || line[0] === ';') return;
    var m = /^\[(.+)\]$/.exec(line);
    if (m) { section = m[1]; out[section] = out[section] || {}; return; }
    var eq = line.indexOf('=');
    if (eq < 0 || !section) return;
    var k = line.slice(0, eq).trim(), v = line.slice(eq + 1).trim();
    (out[section][k] = out[section][k] || []).push(v);
  });
  return out;
}

console.log('§1 service shape');
var svc = parseUnit(SERVICE);
check('service parses with a [Service] section', !!svc.Service);
check('service is Type=oneshot', svc.Service && String(svc.Service.Type) === 'oneshot');
check('service has no RemainAfterExit (ActiveEnter never persists)',
  !(svc.Service && svc.Service.RemainAfterExit));

console.log('§2 timer schedule');
var tmr = parseUnit(TIMER);
var T = tmr.Timer || {};
check('timer parses with a [Timer] section', !!tmr.Timer);
check('OnBootSec=1min', String(T.OnBootSec) === '1min');
check('OnUnitInactiveSec=1min (re-arm from the oneshot INACTIVE edge)',
  String(T.OnUnitInactiveSec) === '1min');
check('no OnUnitActiveSec (ACTIVE edge is unreliable for oneshot)', !T.OnUnitActiveSec);
check('no OnActiveSec (would chain on the timer, not the service)', !T.OnActiveSec);
check('AccuracySec=15s', String(T.AccuracySec) === '15s');
check('Persistent is not set (stamp load disables the elapsed OnBootSec mark)', !T.Persistent);
check('no OnCalendar (monotonic chain, not wall-clock)', !T.OnCalendar);
check('timer triggers the bridge service by name (no Unit= override)', !T.Unit);
check('WantedBy=timers.target', tmr.Install && String(tmr.Install.WantedBy) === 'timers.target');
check('every [Timer] key is single-valued', Object.keys(T).every(function (k) { return T[k].length === 1; }));

console.log('§3 systemd-analyze verify (optional)');
var work = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-timer-test-'));
try {
  fs.copyFileSync(TIMER, path.join(work, 'mythos-github-bridge.timer'));
  fs.copyFileSync(SERVICE, path.join(work, 'mythos-github-bridge.service'));
  var r = cp.spawnSync('systemd-analyze', ['verify', '--man=no',
    path.join(work, 'mythos-github-bridge.timer')], { encoding: 'utf8', timeout: 20000 });
  if (r.error && r.error.code === 'ENOENT') {
    console.log('  SKIP systemd-analyze not installed');
  } else {
    var out = (r.stdout || '') + (r.stderr || '');
    check('systemd-analyze verify exits 0', r.status === 0, out.trim().split('\n').slice(0, 3).join(' | '));
    check('systemd-analyze reports no unknown/invalid Timer keys', !/Unknown key|Failed to parse|invalid/i.test(out), out.trim());
  }
} finally {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

console.log('\nbridge-timer: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
