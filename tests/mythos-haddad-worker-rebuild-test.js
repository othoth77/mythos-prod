'use strict';
// =====================================================
// MYTHOS HADDAD — the worker rebuild reproduces production
// tests/mythos-haddad-worker-rebuild-test.js
//
// bin/haddad-worker-setup.sh is the documented rebuild path for the Haddad
// worker, and it rewrites ~/.config/mythos-haddad/worker.env on every run.
// Until 2026-09-29 it wrote the V0 advisory worker
// (MYTHOS_BRIDGE_WORKER_PROVIDER=openai-compat) and none of the production
// lines that were later added by hand (the haddad-agent execution provider,
// the review gate, the model pin, the Claude diagnosers): a re-run would
// have silently downgraded the running worker. This suite renders the env
// block exactly as the script writes it and asserts the production shape;
// on Haddad (a live worker.env exists) it also asserts the rendered file
// equals the live one, key by key.
//
// Offline, no systemd, no GitHub. Run: node tests/mythos-haddad-worker-rebuild-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var BASE = path.join(__dirname, '..');
var SCRIPT = path.join(BASE, 'projects', 'mythos-haddad', 'bin', 'haddad-worker-setup.sh');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

// Render step 5/6 (ENV_FILE= … the closing ENV marker) with fixture paths.
var src = fs.readFileSync(SCRIPT, 'utf8');
var start = src.indexOf('ENV_FILE="$CONFIG_DIR/worker.env"');
var end = src.indexOf('\nENV\n', start);
ok(start !== -1 && end !== -1, 'the env block is found in the setup script');
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'haddad-rebuild-'));
var block = 'set -eu\nCONFIG_DIR=' + tmp + '\nSTATE_DIR=' + tmp + '/state\nREPO=/home/othman/projects/mythos-prod\n' +
  'CONTROL_DIR=/home/othman/.local/state/mythos-haddad/control\nCONTROL_BRANCH=mythos/control-haddad\n' +
  'EXEC_HOME=/home/othman/mythos-ai-executor-haddad\nADVISORY_ENV=/home/othman/.config/mythos-haddad/advisory.env\n' +
  src.slice(start, end) + '\nENV\n';
var rendered = cp.spawnSync('bash', ['-c', block], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: '/home/othman' } });
ok(rendered.status === 0, 'the env block renders under bash -eu (' + (rendered.stderr || '').trim().slice(0, 120) + ')');

function parseEnv(text) {
  var out = {};
  text.split('\n').forEach(function (line) {
    if (!line || line.charAt(0) === '#') return;
    var i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  });
  return out;
}
var envPath = path.join(tmp, 'worker.env');
var env = parseEnv(fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '');

console.log('\n§1 the rendered worker.env is the production worker, not the V0 advisory one');
ok(env.MYTHOS_BRIDGE_EXEC_PROVIDER === 'haddad-agent', 'routes to the haddad-agent execution provider');
ok(!('MYTHOS_BRIDGE_WORKER_PROVIDER' in env), 'the advisory worker variable is absent (both set = BRIDGE_PROVIDER_CONFLICT)');
ok(env.MYTHOS_BRIDGE_REVIEW_GATE === '1', 'the bridge-side review gate is on');
ok(/\.gguf$/.test(env.HADDAD_AGENT_MODEL || '') && env.HADDAD_AGENT_MODEL === env.MYTHOS_ADVISORY_MODEL,
  'the agent model is pinned, and is the model the runtime serves');
['HADDAD_AGENT_DIAGNOSER', 'HADDAD_AGENT_DIAGNOSER_DEEP'].forEach(function (k) {
  var v = env[k] || '';
  ok(/^claude -p --model \S+ --max-turns 1 --disallowedTools /.test(v) &&
     ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'Agent'].every(function (t) { return v.split(' ').pop().split(',').indexOf(t) !== -1; }),
    k + ' is a single-turn, tool-less Claude diagnosis');
});
ok(env.MYTHOS_EXECUTOR_BIND === '127.0.0.1', 'the executor binds loopback only');
ok(env.MYTHOS_MAX_PARALLEL === '1' && env.MYTHOS_CORE_ENABLED === 'false', 'one task at a time, core off');
ok(!Object.keys(env).some(function (k) { return /TOKEN|SECRET|PASSWORD|API_KEY/.test(k); }), 'no secret-bearing variable in the file');

console.log('\n§2 the bridge accepts the rendered configuration');
var bridgeEnv = { PATH: process.env.PATH, HOME: tmp, MYTHOS_EXECUTOR_HOME: path.join(tmp, 'exec') };
Object.keys(env).forEach(function (k) { if (/^MYTHOS_BRIDGE_(EXEC|WORKER)_PROVIDER$/.test(k)) bridgeEnv[k] = env[k]; });
var load = cp.spawnSync(process.execPath, ['-e', 'require(' + JSON.stringify(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'github-bridge.js')) + ');console.log("LOADED")'],
  { encoding: 'utf8', env: bridgeEnv, timeout: 30000 });
ok(/LOADED/.test(load.stdout) && !/BRIDGE_PROVIDER_CONFLICT|NOT_ALLOWED/.test(load.stderr), 'github-bridge.js loads with the rendered provider variables');

console.log('\n§3 a re-run keeps the previous file for the operator to diff');
ok(/\[ -f "\$ENV_FILE" \] && cp -p "\$ENV_FILE" "\$ENV_FILE\.prev"/.test(src), 'the previous worker.env is preserved as worker.env.prev');

console.log('\n§4 on Haddad: the rebuild equals the live worker.env');
var live = path.join(os.homedir(), '.config', 'mythos-haddad', 'worker.env');
if (fs.existsSync(live) && os.homedir() === '/home/othman') {
  var liveEnv = parseEnv(fs.readFileSync(live, 'utf8'));
  var keys = Object.keys(liveEnv).concat(Object.keys(env)).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
  var diff = keys.filter(function (k) { return liveEnv[k] !== env[k]; });
  ok(diff.length === 0, 'every key and value matches the running worker' + (diff.length ? ' — differs: ' + diff.join(', ') : ''));
} else {
  console.log('  (no live worker.env on this host — the production comparison runs on Haddad only)');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
