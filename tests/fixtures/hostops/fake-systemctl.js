#!/usr/bin/env node
'use strict';
// Test double for /usr/bin/systemctl used by tests/mythos-hostops-controlled-test.js.
// Invoked through a generated wrapper: fake-systemctl.js <stateDir> [--user] <args...>
// Models exactly what HostOps v0.2 relies on:
//   daemon-reload                      snapshot every <unit>.d/*.conf Environment= line (last wins)
//   show <unit> -p Environment --value print the SNAPSHOT (so a missing reload is observable)
//   show <unit> --property=A,B [...]   print unit state (unknown unit → LoadState=not-found)
//   start|stop|restart <unit>          update ActiveState, log the call
// Fault injection: <stateDir>/fail-reload makes daemon-reload exit 1.
var fs = require('fs');
var path = require('path');

var stateDir = process.argv[2];
var args = process.argv.slice(3);
var scope = 'system';
if (args[0] === '--user') { scope = 'user'; args = args.slice(1); }
args = args.filter(function (a) { return a !== '--no-pager'; });

var cfg = JSON.parse(fs.readFileSync(path.join(stateDir, 'config.json'), 'utf8'));
var stFile = path.join(stateDir, 'state.json');
var st; try { st = JSON.parse(fs.readFileSync(stFile, 'utf8')); } catch (e) { st = { units: {}, env: {} }; }
function save() { fs.writeFileSync(stFile, JSON.stringify(st, null, 2)); }
fs.appendFileSync(path.join(stateDir, 'calls.log'), JSON.stringify({ uid: process.getuid(), scope: scope, args: args }) + '\n');

var cmd = args[0];
if (cmd === 'daemon-reload') {
  if (fs.existsSync(path.join(stateDir, 'fail-reload'))) { process.stderr.write('Failed to reload daemon: injected\n'); process.exit(1); }
  st.env = {};
  fs.readdirSync(cfg.unitDir).forEach(function (d) {
    var m = /^(.+\.service)\.d$/.exec(d);
    if (!m) return;
    var env = {};
    fs.readdirSync(path.join(cfg.unitDir, d)).filter(function (f) { return /\.conf$/.test(f); }).sort().forEach(function (f) {
      fs.readFileSync(path.join(cfg.unitDir, d, f), 'utf8').split('\n').forEach(function (l) {
        var mm = /^Environment=([A-Z0-9_]+)=(\S*)\s*$/.exec(l);
        if (mm) env[mm[1]] = mm[2].replace(/%h/g, require('os').homedir());   // systemd expands %h at load, like here
      });
    });
    st.env[m[1]] = env;
  });
  save();
  process.exit(0);
}
if (cmd === 'show') {
  var unit = args[1];
  if (args.indexOf('Environment') !== -1 && args.indexOf('--value') !== -1) {
    var e = st.env[unit] || {};
    process.stdout.write(Object.keys(e).map(function (k) { return k + '=' + e[k]; }).join(' ') + '\n');
    process.exit(0);
  }
  var propArg = args.filter(function (a) { return a.indexOf('--property=') === 0; })[0] || '--property=ActiveState';
  var u = st.units[unit] || { LoadState: 'not-found', ActiveState: 'inactive', SubState: 'dead', Result: 'success' };
  propArg.slice('--property='.length).split(',').forEach(function (p) { process.stdout.write(p + '=' + (u[p] === undefined ? '' : u[p]) + '\n'); });
  process.exit(0);
}
if (cmd === 'start' || cmd === 'stop' || cmd === 'restart') {
  var name = args[1];
  var unitRec = st.units[name];
  if (!unitRec) { process.stderr.write('Unit ' + name + ' not found.\n'); process.exit(5); }
  if (cmd === 'stop') { unitRec.ActiveState = 'inactive'; unitRec.SubState = 'dead'; }
  else if (unitRec.Type === 'oneshot') { unitRec.ActiveState = 'inactive'; unitRec.SubState = 'dead'; unitRec.Result = unitRec.FailNext ? 'exit-code' : 'success'; }
  else { unitRec.ActiveState = 'active'; unitRec.SubState = 'running'; }
  save();
  process.exit(0);
}
process.stderr.write('fake-systemctl: unsupported ' + args.join(' ') + '\n');
process.exit(1);
