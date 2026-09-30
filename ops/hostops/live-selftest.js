#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — HostOps v0.2 LIVE self-test (real host, real systemd, real bridge)
// ops/hostops/live-selftest.js — run as root.
//
//   node ops/hostops/live-selftest.js --mode direct   # BEFORE install: this checkout's helper,
//                                                     # production code path (systemd-run --user,
//                                                     # privilege drop to deploy), repo catalog,
//                                                     # scratch ledger
//   node ops/hostops/live-selftest.js --mode socket   # AFTER install: the FABLE path — as deploy,
//                                                     # hostops-client → socket → daemon → installed
//                                                     # helper → real ledger
//
// It creates a scratch user unit `hostops-selftest.service` whose drop-in is a
// copy of the live bridge WhatsApp drop-in with a dummy recipient, drives the
// catalog's `selftest.whatsapp.to` key through the exact #477 flow (config-set
// → daemon-reload → verification with the REAL `mythos-github-bridge
// notify-config` → idempotency → rollback), exercises refusals, and removes the
// scratch unit. It NEVER changes the live bridge drop-in and NEVER sends a
// message (no notify-test).
// =====================================================
var cp = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var MODE = (process.argv.indexOf('--mode') !== -1 ? process.argv[process.argv.indexOf('--mode') + 1] : 'direct');
if (process.getuid() !== 0) { console.error('run as root'); process.exit(64); }
if (MODE !== 'direct' && MODE !== 'socket') { console.error('--mode direct|socket'); process.exit(64); }

var HERE = __dirname;
var UNIT_DIR = '/home/deploy/.config/systemd/user';
var UNIT = 'hostops-selftest.service';
var DDIR = path.join(UNIT_DIR, UNIT + '.d');
var DROPIN = path.join(DDIR, '20-whatsapp.conf');
var LIVE_DROPIN = path.join(UNIT_DIR, 'mythos-github-bridge.service.d', '20-whatsapp.conf');
var DUMMY = '21600000001', NEW = '21690001921';
var LEDGER = MODE === 'direct' ? fs.mkdtempSync(path.join(os.tmpdir(), 'hostops-live-')) : '/var/lib/mythos/hostops';
var TASK = 'selftest-' + Date.now().toString(36);
var pass = 0, fail = 0, notes = [];
function t(name, fn) { try { fn(); pass++; console.log('ok - ' + name); } catch (e) { fail++; console.log('not ok - ' + name + '\n  ' + String(e && e.message).split('\n').slice(0, 6).join('\n  ')); } }
function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function asDeploy(argv, input) {
  return cp.spawnSync('/usr/sbin/runuser', ['-u', 'deploy', '--'].concat(argv), { encoding: 'utf8', input: input, timeout: 120000,
    env: { PATH: '/usr/bin:/bin', HOME: '/home/deploy', XDG_RUNTIME_DIR: '/run/user/1001', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1001/bus' } });
}
function sh(argv) { var r = asDeploy(argv); if (r.status !== 0) throw new Error(argv.join(' ') + ': ' + r.stderr); return r; }

// ---- call the boundary the way this mode's caller would ----------------
function call(args) {
  var r;
  if (MODE === 'direct') {
    r = cp.spawnSync('/usr/bin/node', [path.join(HERE, 'mythos-hostops.js')].concat(args).concat(['--task-id', TASK]), {
      encoding: 'utf8', timeout: 120000,
      env: { PATH: '/usr/bin:/bin', MYTHOS_HOSTOPS_ALLOWLIST: path.join(HERE, '..', 'dagu-poc', 'hostops-allowlist.json'),
        MYTHOS_HOSTOPS_HOME: LEDGER, MYTHOS_HOSTOPS_WORKER: path.join(HERE, 'mythos-hostops-user-worker.js') } });
    var b = null; try { b = JSON.parse(r.stdout); } catch (e) { /* */ }
    return { code: r.status, body: b, raw: r.stdout + r.stderr, ok: !!(b && b.ok), err: b && b.error ? b.error.code : null, result: b && b.result };
  }
  var flags = args.slice(1);
  r = asDeploy(['/usr/bin/node', path.join(HERE, 'hostops-client.js'), args[0]].concat(flags).concat(['--task-id', TASK, '--requested-by', 'live-selftest']));
  var o = null; try { o = JSON.parse(r.stdout); } catch (e) { /* */ }
  return { code: r.status, body: o, raw: r.stdout + r.stderr, ok: !!(o && o.ok), err: o && !o.ok ? (o.hostops_code || o.code) : null, result: o && (o.result || null) };
}
function ledger() { try { return fs.readFileSync(path.join(LEDGER, 'audit.jsonl'), 'utf8').trim().split('\n').map(JSON.parse); } catch (e) { return []; } }

// ---- scratch unit: a replica of the live WhatsApp drop-in --------------
var live = fs.readFileSync(LIVE_DROPIN, 'utf8');
var liveSha = sha(live);
var replica = live.replace(/^Environment=MYTHOS_BRIDGE_WHATSAPP_TO=.*$/m, 'Environment=MYTHOS_BRIDGE_WHATSAPP_TO=' + DUMMY);
sh(['/usr/bin/mkdir', '-p', DDIR]);
asDeploy(['/usr/bin/tee', path.join(UNIT_DIR, UNIT)], '[Unit]\nDescription=HostOps live self-test scratch unit (removed by ops/hostops/live-selftest.js)\n[Service]\nType=oneshot\nExecStart=/bin/true\n');
asDeploy(['/usr/bin/tee', DROPIN], replica);
sh(['/usr/bin/systemctl', '--user', 'daemon-reload']);
console.log('# mode=' + MODE + ' task=' + TASK + ' ledger=' + LEDGER);

try {
  t('catalog is v0.2 and CONTROLLED is enabled', function () {
    var r = call(['catalog']);
    if (!r.ok) throw new Error(r.raw);
    if (MODE === 'direct' && !/^0\.2\./.test(r.result.schema_version)) throw new Error('schema ' + r.result.schema_version);
  });
  t('READ against the LIVE bridge: recipient is masked and in sync; real notify-config runs', function () {
    var g = call(['config-get', '--key', 'bridge.whatsapp.to']);
    if (!g.ok) throw new Error(g.raw);
    if (!/^216\*+\d{4}$/.test(g.result.file_value) || g.result.in_sync !== true) throw new Error(JSON.stringify(g.result));
    notes.push('live bridge recipient (masked): ' + g.result.file_value + ' in_sync=' + g.result.in_sync);
    var n = call(['tool-run', '--tool', 'bridge.notify-config']);
    if (!n.ok) throw new Error(n.raw);
    var out = n.result.output;
    notes.push('live notify-config: enabled=' + out.enabled + ' recipients_configured=' + out.recipients_configured + ' problems=' + JSON.stringify(out.problems) + ' masked=' + JSON.stringify(n.result.recipients_masked));
    if (JSON.stringify(n.body).indexOf(live.match(/MYTHOS_BRIDGE_WHATSAPP_TO=(\d+)/)[1]) !== -1) throw new Error('full live number leaked in the response');
  });
  t('#477 flow on the replica: +216… → digits-only, only that line changed, reload, REAL notify-config verification', function () {
    var r = call(['config-set', '--key', 'selftest.whatsapp.to', '--value', '+' + NEW]);
    if (!r.ok) throw new Error(r.raw);
    var res = r.result;
    if (res.outcome !== 'changed' || res.after !== '216****1921' || res.verification.effective_env !== true) throw new Error(JSON.stringify(res));
    var now = fs.readFileSync(DROPIN, 'utf8');
    if (now !== replica.replace('MYTHOS_BRIDGE_WHATSAPP_TO=' + DUMMY, 'MYTHOS_BRIDGE_WHATSAPP_TO=' + NEW)) throw new Error('drop-in differs beyond the TO line');
    if (fs.statSync(DROPIN).uid !== 1001) throw new Error('drop-in not owned by deploy after the write');
    var env = sh(['/usr/bin/systemctl', '--user', 'show', UNIT, '-p', 'Environment', '--value']).stdout;
    if (env.indexOf('MYTHOS_BRIDGE_WHATSAPP_TO=' + NEW) === -1) throw new Error('systemd does not carry the new value');
    notes.push('replica verification: ' + JSON.stringify(res.verification.tool));
    if (JSON.stringify(r.body).indexOf(NEW) !== -1) throw new Error('full number in the response');
  });
  t('idempotent second call is "unchanged"', function () {
    var r = call(['config-set', '--key', 'selftest.whatsapp.to', '--value', NEW]);
    if (!r.ok || r.result.outcome !== 'unchanged') throw new Error(r.raw);
  });
  t('rollback restores the replica byte-for-byte and systemd follows', function () {
    var list = call(['change-list', '--limit', '5']);
    var id = list.result.changes.filter(function (c) { return c.key === 'selftest.whatsapp.to' && !c.rolled_back_at; })[0].change_id;
    var r = call(['change-rollback', '--change', id]);
    if (!r.ok || r.result.outcome !== 'rolled_back') throw new Error(r.raw);
    if (sha(fs.readFileSync(DROPIN, 'utf8')) !== sha(replica)) throw new Error('bytes differ after rollback');
  });
  t('service-control start of the scratch oneshot runs through deploy\'s user manager', function () {
    var r = call(['service-control', '--unit', UNIT, '--action', 'start']);
    if (!r.ok || r.result.scope !== 'user') throw new Error(r.raw);
  });
  t('refusals: HIGHLY_SENSITIVE, OWNER, unknown, uncatalogued, protected, injection', function () {
    var cases = [
      [['host.secret.read'], /HIGHLY_SENSITIVE/], [['host.sudoers.change'], /HIGHLY_SENSITIVE/], [['host.user.create'], /HIGHLY_SENSITIVE/],
      [['file-write', '--path', '/home/deploy/deployments/x/y'], /OWNER/], [['rm-rf'], /UNKNOWN/],
      [['service-control', '--unit', 'mythos-ai-executor.service', '--action', 'restart'], /NOT_CATALOGUED|PROTECTED/],
      [['docker-restart', '--container', 'evolution-postgres'], /NOT_CATALOGUED|PROTECTED/],
      [['config-set', '--key', 'selftest.whatsapp.to', '--value', '21690001921;id'], /ARG_INVALID/]
    ];
    cases.forEach(function (c) { var r = call(c[0]); if (r.ok || !c[1].test(String(r.err) + ' ' + r.raw)) throw new Error(c[0][0] + ' → ' + r.raw.slice(0, 300)); });
  });
  t('audit: intent + result for every CONTROLLED call of this run, attributed, no full number', function () {
    var mine = ledger().filter(function (e) { return e.task && e.task.task_id === TASK; });
    var intents = mine.filter(function (e) { return e.phase === 'intent'; }).length;
    var results = mine.filter(function (e) { return e.phase === 'result' && e.tier === 'CONTROLLED'; }).length;
    if (intents < 3 || results < intents) throw new Error('intents=' + intents + ' results=' + results);
    if (JSON.stringify(mine).indexOf(NEW) !== -1) throw new Error('full number in the ledger');
    notes.push('ledger lines for this run: ' + mine.length + ' (intent ' + intents + ')');
  });
  t('the LIVE bridge drop-in was never touched', function () {
    if (sha(fs.readFileSync(LIVE_DROPIN, 'utf8')) !== liveSha) throw new Error('LIVE DROP-IN CHANGED');
  });
} finally {
  asDeploy(['/usr/bin/rm', '-rf', DDIR, path.join(UNIT_DIR, UNIT)]);
  asDeploy(['/usr/bin/systemctl', '--user', 'daemon-reload']);
  if (MODE === 'direct') fs.rmSync(LEDGER, { recursive: true, force: true });
}
notes.forEach(function (n) { console.log('# ' + n); });
console.log('\nhostops live self-test (' + MODE + '): ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
