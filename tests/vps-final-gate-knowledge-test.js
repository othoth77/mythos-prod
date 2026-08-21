'use strict';

// tests/vps-final-gate-knowledge-test.js — governance regression for the
// VPS Final Gate knowledge-configuration step.
//
// The gate used to `require()` a path that does not exist
// (projects/oth-knowledge/config/knowledge.json) and swallow the resulting
// error with `|| echo`, so the step reported "not present/parseable" and
// passed while verifying nothing. This suite pins the corrected behaviour:
// the gate reads the ACTIVE executor config and asserts its activated
// values, failing closed when they do not hold.
//
// Offline: static assertions over the workflow plus one execution of the
// gate's own assertion logic against the real config file.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var WF = path.join(ROOT, '.github', 'workflows', 'vps-final-gate.yml');
var ACTIVE_CONFIG = 'projects/mythos-ai-executor/config/knowledge.json';
var DEAD_CONFIG = 'projects/oth-knowledge/config/knowledge.json';
var EXPECTED_STORE_ROOT = '/home/deploy/othk-store';

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

var wf = fs.readFileSync(WF, 'utf8');
var step = (wf.split('- name: Knowledge configuration state')[1] || '').split('\n      - name:')[0];

console.log('§1 the gate verifies the active configuration path');
check('knowledge step exists', step.length > 0);
check('gate no longer references the non-existent oth-knowledge config',
  wf.indexOf(DEAD_CONFIG) < 0);
check('the dead path really is absent from the repository',
  !fs.existsSync(path.join(ROOT, DEAD_CONFIG)));
check('gate reads the active executor config', step.indexOf(ACTIVE_CONFIG) >= 0);
check('the active config really exists', fs.existsSync(path.join(ROOT, ACTIVE_CONFIG)));

console.log('§2 the gate asserts, it does not merely report');
check('asserts enabled === true', /enabled !== true/.test(step));
check('asserts the canonical store_root',
  step.indexOf(EXPECTED_STORE_ROOT) >= 0 && /store_root !== EXPECTED_STORE_ROOT/.test(step));
check('failure exits non-zero', /process\.exit\(1\)/.test(step));
check('parse/read failure is fail-closed, not swallowed',
  /cannot read\/parse/.test(step) && !/\|\|\s*echo/.test(step));
check('step is no longer labelled report-only', !/report only/.test(step));

console.log('§3 the assertion actually passes against the shipped config');
var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, ACTIVE_CONFIG), 'utf8'));
check('config enabled === true', cfg.enabled === true, JSON.stringify(cfg.enabled));
check('config store_root === ' + EXPECTED_STORE_ROOT,
  cfg.store_root === EXPECTED_STORE_ROOT, JSON.stringify(cfg.store_root));

// Extract the gate's own node program and run it verbatim, so this suite
// fails if the workflow's logic and this expectation ever diverge.
var prog = step.slice(step.indexOf("node -e '") + "node -e '".length);
prog = prog.slice(0, prog.indexOf("\n          '"));
var run = cp.spawnSync('node', ['-e', prog], { cwd: ROOT, encoding: 'utf8' });
check('gate program exits 0 on the shipped config', run.status === 0,
  (run.stderr || '') + (run.stdout || ''));
check('gate program reports the verified values',
  /PASS: .*enabled=true store_root=/.test(run.stdout || ''), run.stdout);

console.log('§4 fail-closed behaviour on a bad configuration');
var tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gate-knowledge-'));
[
  { name: 'disabled config fails', body: { enabled: false, store_root: EXPECTED_STORE_ROOT } },
  { name: 'wrong store_root fails', body: { enabled: true, store_root: '/tmp/elsewhere' } },
  { name: 'missing keys fail', body: {} }
].forEach(function (c) {
  var dir = path.join(tmp, 'projects', 'mythos-ai-executor', 'config');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'knowledge.json'), JSON.stringify(c.body));
  var r = cp.spawnSync('node', ['-e', prog], { cwd: tmp, encoding: 'utf8' });
  check(c.name, r.status === 1 && /FAIL:/.test(r.stderr || ''), 'exit ' + r.status);
});
fs.rmSync(path.join(tmp, 'projects', 'mythos-ai-executor', 'config', 'knowledge.json'));
var missing = cp.spawnSync('node', ['-e', prog], { cwd: tmp, encoding: 'utf8' });
check('absent config fails closed', missing.status === 1 && /cannot read\/parse/.test(missing.stderr || ''));
fs.rmSync(tmp, { recursive: true, force: true });

console.log('§5 the rest of the gate is untouched');
check('docker-group finding step preserved', /deploy is in the docker group/.test(wf));
check('governance invariant suite still run',
  /node tests\/mythos-governance-invariant-test\.js/.test(wf));
check('E2E host-refusal contract preserved',
  /expected host refusal is the PASS condition/.test(wf));
check('workflow remains manually dispatched', /workflow_dispatch/.test(wf));

console.log('\nvps-final-gate-knowledge: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
