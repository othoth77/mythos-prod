'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — deployment artifact tests
// projects/mythos-trading-control-center/tests/deploy-test.js
//
// The unit, the vhost, the release script and the smoke test are code that
// runs once, on a production host, where a mistake is expensive. So they are
// tested here, before they get there:
//
//   · the unit and the vhost agree with each other and with the server, bind
//     loopback, and carry no secret;
//   · the release script cannot be pointed at nginx, certificates or root;
//   · the smoke test PASSES against a production-shaped instance — built
//     interface, public origin configured, signed-in checks included;
//   · and it FAILS against an instance that is not production-shaped. A smoke
//     test that cannot fail verifies nothing.
// =====================================================

var test = require('node:test');
var assert = require('node:assert/strict');
var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');

var h = require('./helpers');
var buildMod = require('../bin/build');

var DEPLOY = path.join(h.ROOT, 'deploy');
var unit = fs.readFileSync(path.join(DEPLOY, 'mythos-trading-control-center.user.service'), 'utf8');
var vhost = fs.readFileSync(path.join(DEPLOY, 'nginx-trading.mythosprod.xyz.conf'), 'utf8');
var release = fs.readFileSync(path.join(DEPLOY, 'release.sh'), 'utf8');
var smoke = fs.readFileSync(path.join(DEPLOY, 'smoke.sh'), 'utf8');

/** A file with its comment lines removed: what the file DOES, not what it says. */
function code(text) { return text.split('\n').filter(function (l) { return !/^\s*#/.test(l); }).join('\n'); }
function have(cmd) { return childProcess.spawnSync('sh', ['-c', 'command -v ' + cmd], { encoding: 'utf8' }).status === 0; }

function runSmoke(base, env, commit) {
  return new Promise(function (resolve) {
    var args = [path.join(DEPLOY, 'smoke.sh'), base];
    if (commit) args.push(commit);
    var child = childProcess.spawn('bash', args, { env: Object.assign({ PATH: process.env.PATH, HOME: process.env.HOME || '/tmp' }, env || {}) });
    var out = '';
    child.stdout.on('data', function (d) { out += d; });
    child.stderr.on('data', function (d) { out += d; });
    child.on('close', function (status) { resolve({ status: status, out: out }); });
  });
}

// ---------------------------------------------------------------------------
// static
// ---------------------------------------------------------------------------

test('the unit runs the server from the release, on loopback, in production mode, with state outside the release', function () {
  var u = code(unit);
  assert.match(u, /^ExecStart=\/usr\/bin\/node \/home\/deploy\/deployments\/mythos-trading-control-center\/current\/projects\/mythos-trading-control-center\/server\/server\.js$/m);
  assert.match(u, /^Environment=NODE_ENV=production$/m);
  assert.match(u, /^Environment=TCC_BIND=127\.0\.0\.1$/m, 'the service must listen on loopback only');
  assert.match(u, /^Environment=TCC_PORT=8210$/m);
  assert.match(u, /^Environment=TCC_PUBLIC_ORIGIN=https:\/\/trading\.mythosprod\.xyz$/m);
  assert.match(u, /^Environment=TCC_TRUST_PROXY=1$/m);
  var state = /^Environment=TCC_STATE_DIR=(.+)$/m.exec(u)[1];
  var users = /^Environment=TCC_USERS_FILE=(.+)$/m.exec(u)[1];
  [state, users].forEach(function (p) {
    assert.ok(p.indexOf('/current') === -1 && p.indexOf('/releases') === -1, p + ' is inside a release; a rollback would lose it');
  });
  assert.match(u, new RegExp('^ReadWritePaths=' + state.replace(/[/.]/g, '\\$&') + '$', 'm'), 'the state directory is the only writable path');
  assert.match(u, /^ProtectSystem=strict$/m);
  assert.match(u, /^NoNewPrivileges=yes$/m);
  assert.match(u, /^MemoryMax=\d+M$/m, 'the host is memory-constrained; the unit must be capped');
  assert.doesNotMatch(u, /^User=|^Group=/m, 'a user unit must not name a user');
  // no secret is a unit value: the unit names files, never contents
  u.split('\n').filter(function (l) { return /^Environment=/.test(l); }).forEach(function (l) {
    assert.doesNotMatch(l, /PASSWORD|SECRET|TOKEN|KEY=/i, 'the unit carries a secret-shaped variable: ' + l);
  });
  assert.doesNotMatch(u, /LIVE|BROKER|VENUE|API_KEY/i);
});

test('the vhost proxies this name to that port and to nothing else, and leaves TLS to certbot', function () {
  var v = code(vhost);
  assert.match(v, /server_name trading\.mythosprod\.xyz;/);
  var targets = v.match(/proxy_pass\s+[^;]+;/g);
  assert.ok(targets.length >= 2);
  targets.forEach(function (t) { assert.equal(t.replace(/\s+/g, ' '), 'proxy_pass http://127.0.0.1:8210;'); });
  assert.equal(/TCC_PORT=(\d+)/.exec(unit)[1], '8210', 'the unit and the vhost must name the same port');
  assert.match(v, /location = \/api\/paper\/stream \{[^}]*proxy_buffering off;/, 'the event stream must not be buffered');
  assert.match(v, /proxy_set_header X-Real-IP \$remote_addr;/, 'the sign-in throttle and the audit log need the client address');
  assert.match(v, /client_max_body_size 64k;/);
  assert.doesNotMatch(v, /listen\s+443|ssl_certificate/, 'the 443 block belongs to certbot');
  assert.doesNotMatch(v, /root\s+\/|alias\s+\/|autoindex/, 'the vhost serves no file from disk');
  assert.doesNotMatch(v, /Access-Control-Allow/i, 'no CORS at the proxy either');
  assert.equal((v.match(/server\s*\{/g) || []).length, 1);
});

test('the release script gates on both suites and the audited agent, and cannot reach nginx, certificates or root', function (t) {
  var r = code(release);
  assert.match(r, /set -euo pipefail/);
  assert.match(r, /is not on origin\/\$BRANCH/, 'only a pushed commit is released');
  var liveLock = fs.readFileSync(path.join(__dirname, 'live-lock-test.js'), 'utf8');
  var base = /AGENT_BASE="([0-9a-f]+)"/.exec(release)[1];
  assert.ok(liveLock.indexOf("'" + base) !== -1 || liveLock.indexOf('"' + base) !== -1, 'the release script and the LIVE lock test pin different agent commits');
  assert.match(r, /mythos-trading-agent" && HOME="\$\(mktemp -d\)" npm test/, 'the agent suite runs from the release, with a throwaway HOME');
  assert.match(r, /cd "\$APP" && HOME="\$\(mktemp -d\)"[^\n]*npm test/, 'the Control Center suite runs from the release, with a throwaway HOME');
  var gate = r.indexOf('npm test');
  var move = r.indexOf('ln -sfn "releases/$FULL"');
  assert.ok(gate !== -1 && move > gate, 'the symlink must move only after the suites');
  assert.match(r, /SMOKE TEST FAILED — rolling back/);
  assert.doesNotMatch(r, /\bsudo\b|\bnginx\b|\bcertbot\b|\/etc\/|systemctl (?!--user)/, 'the release script must not touch root-owned configuration');
  assert.doesNotMatch(r, /users\.json|rm -rf "\$ROOT\/state"|rm -rf \$ROOT/, 'the release script must not touch users or state');
  assert.doesNotMatch(r, /git (push|reset|checkout|merge|commit)/, 'the release script must not change the repository');
  assert.match(r, /run as the deploy user, not root/);
  if (!have('bash')) { t.skip('no bash to check the syntax with'); return; }
  ['release.sh', 'smoke.sh'].forEach(function (f) {
    var res = childProcess.spawnSync('bash', ['-n', path.join(DEPLOY, f)], { encoding: 'utf8' });
    assert.equal(res.status, 0, f + ': ' + res.stderr);
    assert.ok(fs.statSync(path.join(DEPLOY, f)).mode & 0o100, f + ' is not executable');
  });
});

test('the smoke test is read-only: it signs in, reads, asks for LIVE (to see it refused) and signs out', function () {
  var s = code(smoke);
  var posts = s.split('\n').filter(function (l) { return /-X POST/.test(l); });
  posts.forEach(function (l) {
    assert.ok(/\/api\/auth\/login|\/api\/auth\/logout|\/api\/config\/mode|\/api\/backtest/.test(l), 'an unexpected POST: ' + l.trim());
    if (/\/api\/config\/mode/.test(l)) assert.match(l, /"to":"LIVE"/, 'the only mode the smoke test may ask for is the one that must be refused');
    if (/\/api\/backtest/.test(l)) assert.doesNotMatch(l, /Cookie/, 'the backtest probe must be anonymous');
  });
  assert.doesNotMatch(s, /-X (PATCH|PUT|DELETE)/);
  assert.doesNotMatch(s, /TCC_SMOKE_PASSWORD=|echo .*PASSWORD/, 'the password comes from a file and is never echoed');
});

// ---------------------------------------------------------------------------
// dynamic — the smoke test against real instances
// ---------------------------------------------------------------------------

test('SMOKE: passes against a production-shaped instance, signed-in checks included', async function (t) {
  if (!have('curl') || !have('bash')) { t.skip('curl and bash are needed to run the smoke test'); return; }
  var dist = h.tempDir('tcc-deploy-dist-');
  var commit = 'abcdef0123456789abcdef0123456789abcdef01';
  buildMod.build({ out: dist, commit: commit });
  var pw = path.join(h.tempDir('tcc-deploy-pw-'), 'pw');
  fs.writeFileSync(pw, h.PASSWORDS.owner + '\n', { mode: 0o600 });
  var A = await h.startApp({ webDir: dist, commit: commit, publicOrigin: 'https://trading.mythosprod.xyz', trustProxy: true });
  try {
    var anon = await runSmoke(A.base);
    assert.equal(anon.status, 0, anon.out);
    assert.match(anon.out, /SMOKE: PASS/);
    assert.match(anon.out, /SKIP {2}signed-in checks/);
    assert.match(anon.out, /SKIP {2}TLS checks/, 'TLS is not checked over loopback, and the output says so');
    assert.doesNotMatch(anon.out, /^FAIL/m);

    var signed = await runSmoke(A.base, { TCC_SMOKE_USER: 'owner', TCC_SMOKE_PASSWORD_FILE: pw, TCC_SMOKE_ORIGIN: 'https://trading.mythosprod.xyz' }, commit);
    assert.equal(signed.status, 0, signed.out);
    for (var line of ['the session cookie is HttpOnly', 'the session cookie is Secure', 'the session cookie is SameSite=Strict', 'the mode is BACKTEST',
      'the only modes are BACKTEST and PAPER', 'LIVE execution is reported not available', 'the running commit is ' + commit,
      'asking for LIVE with a session is refused (403)', 'the audit chain verifies', 'the live adapter\'s refusal is verified by a health check',
      'the server reports a built interface', 'the session is gone after sign-out', 'the interface is the fingerprinted production build',
      'GET /dashboard with the session is 200']) {
      assert.ok(signed.out.indexOf('PASS  ' + line) !== -1, 'the smoke test did not report: ' + line + '\n' + signed.out);
    }
    assert.match(signed.out, /PASS {2}login page: no secret in the page or its \d+ assets/);
    var shell = /PASS {2}application shell: no secret in the page or its (\d+) assets/.exec(signed.out);
    assert.ok(shell && Number(shell[1]) >= 15, 'the whole application shell was not scanned: ' + (shell ? shell[1] : 'no line'));
    assert.equal(signed.out.indexOf(h.PASSWORDS.owner), -1, 'the smoke test printed the password');
    // the smoke test changed nothing
    var owner = await A.login('owner');
    var st = (await owner.get('/api/status')).body.result;
    assert.equal(st.mode, 'BACKTEST');
    var actions = (await owner.get('/api/audit?limit=50')).body.result.items.map(function (e) { return e.action + ':' + e.outcome; });
    actions.forEach(function (a) { assert.match(a, /^auth\.|^mode\.set:REFUSED$|^backtest\.start:REFUSED$/, 'the smoke test left an unexpected audit entry: ' + a); });
    // the wrong origin is refused, as it would be from another site
    var wrong = await runSmoke(A.base, { TCC_SMOKE_USER: 'owner', TCC_SMOKE_PASSWORD_FILE: pw, TCC_SMOKE_ORIGIN: 'https://evil.example' });
    assert.equal(wrong.status, 1, 'a sign-in from a foreign origin must not pass the smoke test');
  } finally {
    await A.close();
    fs.rmSync(dist, { recursive: true, force: true });
    fs.rmSync(path.dirname(pw), { recursive: true, force: true });
  }
});

test('SMOKE: fails against an instance serving unbuilt sources, against the wrong commit, and against nothing', async function (t) {
  if (!have('curl') || !have('bash')) { t.skip('curl and bash are needed to run the smoke test'); return; }
  var pw = path.join(h.tempDir('tcc-deploy-pw-'), 'pw');
  fs.writeFileSync(pw, h.PASSWORDS.owner + '\n', { mode: 0o600 });
  var A = await h.startApp();       // the unbuilt web/ directory, as in development
  try {
    var dev = await runSmoke(A.base);
    assert.equal(dev.status, 1, dev.out);
    assert.match(dev.out, /FAIL {2}the login page references unfingerprinted scripts/);
    assert.match(dev.out, /SMOKE: FAIL/);
    var wrongCommit = await runSmoke(A.base, { TCC_SMOKE_USER: 'owner', TCC_SMOKE_PASSWORD_FILE: pw }, 'ffffffffffffffffffffffffffffffffffffffff');
    assert.equal(wrongCommit.status, 1);
    assert.match(wrongCommit.out, /FAIL {2}the running commit is not ffffffff/);
    assert.match(wrongCommit.out, /FAIL {2}the server reports it is serving unbuilt sources/);
  } finally { await A.close(); fs.rmSync(path.dirname(pw), { recursive: true, force: true }); }
  // a secret planted in a built asset is found
  var dist = h.tempDir('tcc-deploy-dist-');
  buildMod.build({ out: dist, commit: 'abcdef0' });
  var jsDir = path.join(dist, 'assets', 'js');
  var login = fs.readdirSync(jsDir).filter(function (f) { return /^login\./.test(f); })[0];
  fs.appendFileSync(path.join(jsDir, login), '\nvar leaked = { apiKey: "' + 'A1b2C3d4E5f6G7h8I9j0K1l2' + '" };\n');
  var B = await h.startApp({ webDir: dist });
  try {
    var leak = await runSmoke(B.base);
    assert.equal(leak.status, 1, leak.out);
    assert.match(leak.out, /FAIL {2}login page: a secret-shaped string in 1 file/);
  } finally { await B.close(); fs.rmSync(dist, { recursive: true, force: true }); }
  var down = await runSmoke('http://127.0.0.1:1');
  assert.equal(down.status, 1, 'a dead port must not pass');
  assert.equal((await runSmoke('')).status, 2, 'no URL is a usage error');
});
