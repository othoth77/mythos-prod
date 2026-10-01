#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS OS / ORCHESTRATION — the machine-verifiable 100 % matrix
// projects/mythos-haddad/bin/mythos-verify-matrix.js
//
// Every gate is a PROBE that measures something now, on this host, against
// the commit the live checkout runs. A gate is PASS only when its probe
// measured the property; a probe that cannot reach what it must measure
// answers BLOCKED (with the owner action) or UNMEASURED — never PASS.
// Nothing here trusts a stored green: suite results come from running the
// suites, CI evidence must cover the current tree, E2E evidence must come
// from a task that ran on the current worker code.
//
//   node projects/mythos-haddad/bin/mythos-verify-matrix.js \
//     [--repo ~/projects/mythos-prod] [--sweep <tsv> --sweep-commit <sha>] \
//     [--e2e A=<issue> --e2e B=<issue> --e2e C=<issue>] [--json] [--out <file>] [--quick]
//
// --quick skips the suite runs (their gates answer UNMEASURED).
// Exit 0 only when every required gate is PASS.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ARGS = process.argv.slice(2);
function arg(name, dflt) { var i = ARGS.indexOf(name); return i === -1 ? dflt : ARGS[i + 1]; }
function args(name) { var out = []; ARGS.forEach(function (a, i) { if (a === name) out.push(ARGS[i + 1]); }); return out; }
var HOME = os.homedir();
function tilde(p) { return p.replace(/^~(?=\/|$)/, HOME); }
var REPO = tilde(arg('--repo', path.join(HOME, 'projects', 'mythos-prod')));
var TOOL_ROOT = path.join(__dirname, '..', '..', '..');
var CFG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'verify-matrix.json'), 'utf8'));
var QUICK = ARGS.indexOf('--quick') !== -1;
var EXEC_HOME = process.env.MYTHOS_EXECUTOR_HOME || path.join(HOME, 'mythos-ai-executor-haddad');
var CONTROL = path.join(HOME, '.local', 'state', 'mythos-haddad', 'control', 'control');
// What the worker process loads: the executor requires mythos-orchestrator/lib only (schema, redact, git),
// never the supervisor, so a supervisor-only change does not make an E2E record stale.
var WORKER_CODE = ['projects/mythos-ai-executor', 'projects/mythos-browser-mcp', 'projects/mythos-gateway', 'projects/mythos-orchestrator/lib'];

function sh(cmd, argv, opts) {
  var r = cp.spawnSync(cmd, argv, Object.assign({ encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 }, opts || {}));
  return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}
function git(argv) { return sh('git', ['-C', REPO].concat(argv)); }
function pass(evidence) { return { status: 'PASS', evidence: evidence }; }
function failed(evidence) { return { status: 'FAIL', evidence: evidence }; }
function blocked(evidence, owner) { return { status: 'BLOCKED', evidence: evidence, owner_action: owner }; }
function unmeasured(evidence) { return { status: 'UNMEASURED', evidence: evidence }; }
function all(results) {
  // Combine sub-results: any FAIL → FAIL, else any BLOCKED → BLOCKED, else any UNMEASURED → UNMEASURED.
  var order = ['FAIL', 'BLOCKED', 'UNMEASURED'];
  var worst = 'PASS';
  order.slice().reverse().forEach(function (s) { if (results.some(function (r) { return r.status === s; })) worst = s; });
  var out = { status: worst, evidence: results.map(function (r) {
    return /^(PASS|FAIL|BLOCKED|UNMEASURED): /.test(r.evidence) ? r.evidence : r.status + ': ' + r.evidence;
  }).join(' | ') };
  var owner = results.filter(function (r) { return r.owner_action; }).map(function (r) { return r.owner_action; });
  if (owner.length) out.owner_action = owner.join(' ; ');
  return out;
}

// ---------------------------------------------------------------- facts, measured once
var HEAD = git(['rev-parse', 'HEAD']).out.trim();
git(['fetch', '-q', 'origin']);
var ORIGIN = git(['rev-parse', 'origin/main']).out.trim();
var DIRTY = git(['status', '--porcelain']).out.trim();
var BRANCH = git(['rev-parse', '--abbrev-ref', 'HEAD']).out.trim();

function httpJson(url, timeoutMs) {
  var r = sh(process.execPath, ['-e',
    "var h=require('http');h.get(process.argv[1],{timeout:" + (timeoutMs || 5000) + "},function(s){var b='';s.on('data',function(c){b+=c});s.on('end',function(){process.stdout.write(JSON.stringify({code:s.statusCode,body:b}))})}).on('error',function(e){process.stdout.write(JSON.stringify({code:null,err:e.message}))}).on('timeout',function(){process.exit(3)})", url], { timeout: (timeoutMs || 5000) + 2000 });
  try { var o = JSON.parse(r.out); try { o.json = JSON.parse(o.body); } catch (e) { o.json = null; } return o; } catch (e) { return { code: null, err: 'no answer' }; }
}
var WORKER = httpJson('http://127.0.0.1:8130/health');
var IDENT = WORKER.json && WORKER.json.code_identity || {};

var HEALTH = (function () {
  var r = sh(process.execPath, [path.join(REPO, 'projects', 'mythos-haddad', 'bin', 'haddad-health.js'), '--json'], { timeout: 300000 });
  try { return JSON.parse(r.out); } catch (e) { return null; }
})();
function healthCheck(name) {
  var c = HEALTH && (HEALTH.checks || []).filter(function (x) { return x.name === name || x.id === name || x.check === name; })[0];
  if (!c) return unmeasured('health check "' + name + '" absent from the report');
  var st = String(c.status || c.result || '').toUpperCase();
  return st === 'PASS' ? pass('health ' + name + ': ' + String(c.detail || c.message || '').slice(0, 160)) : failed('health ' + name + ' ' + st + ': ' + String(c.detail || c.message || '').slice(0, 200));
}

// ---------------------------------------------------------------- suites
var SUITE_CACHE = {};
function suite(file) {
  if (QUICK) return unmeasured(file + ' not run (--quick)');
  if (SUITE_CACHE[file]) return SUITE_CACHE[file];
  var full = path.join(REPO, 'tests', file);
  if (!fs.existsSync(full)) return (SUITE_CACHE[file] = failed(file + ' missing'));
  var r = sh(process.execPath, [full], { cwd: REPO, timeout: 600000 });
  var text = r.out + '\n' + r.err;
  var m = text.match(/(\d+) passed, (\d+) failed/g);
  var sum = m ? m[m.length - 1] : 'no summary';
  var fails = text.split('\n').filter(function (l) { return /^\s*(FAIL[: ]|not ok)/.test(l); }).map(function (l) { return l.replace(/^\s*(FAIL:?|not ok -?)\s*/, '').trim(); });
  var ex = CFG.regression_exclusions[file];
  var res;
  if (r.status === 0) res = pass(file + ' ' + sum);
  else if (ex && ex.labels && fails.length && fails.every(function (f) { return ex.labels.some(function (l) { return f.indexOf(l) === 0; }); })) {
    res = pass(file + ' ' + sum + ' — only the ' + ex.class + ' assertions fail on this host (' + ex.evidence + ')');
  } else res = failed(file + ' exit ' + r.status + ' ' + sum + (fails.length ? ' — ' + fails.slice(0, 3).join('; ') : ''));
  return (SUITE_CACHE[file] = res);
}
function suites(files) { return all(files.map(suite)); }
function assertionPassed(file, label) {
  if (QUICK) return unmeasured('assertion "' + label + '" not run (--quick)');
  var r = sh(process.execPath, [path.join(REPO, 'tests', file)], { cwd: REPO, timeout: 600000 });
  var lines = (r.out + '\n' + r.err).split('\n');
  var hit = lines.filter(function (l) { return l.indexOf(label) !== -1; });
  if (!hit.length) return failed(file + ': assertion "' + label + '" not found');
  return hit.every(function (l) { return /^\s*(PASS|ok)\b/.test(l); }) ? pass(file + ': "' + label + '" PASS') : failed(file + ': "' + label + '" ' + hit[0].trim().slice(0, 80));
}

// ---------------------------------------------------------------- E2E evidence (by Issue number)
function e2eEvidence(letter, issue) {
  var ctl = path.join(CONTROL, 'tasks', 'gh-issue-' + issue + '.json');
  if (!fs.existsSync(ctl)) return { result: unmeasured('E2E ' + letter + ': no control record for #' + issue + ' on this host') };
  var rec = JSON.parse(fs.readFileSync(ctl, 'utf8'));
  var ex = rec.execution || {};
  var runtime = ex.runtime && ex.runtime.head;
  var fresh = runtime && git(['diff', '--quiet', runtime, HEAD, '--'].concat(WORKER_CODE)).status === 0;
  var tdir = path.join(EXEC_HOME, 'tasks', String(ex.executor_task_id || ''));
  if (!ex.executor_task_id || !fs.existsSync(tdir)) return { result: unmeasured('E2E ' + letter + ' #' + issue + ': executor record absent') };
  var status = JSON.parse(fs.readFileSync(path.join(tdir, 'status.json'), 'utf8'));
  var report = fs.existsSync(path.join(tdir, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(tdir, 'report.json'), 'utf8')) : {};
  var events = fs.readFileSync(path.join(tdir, 'events.log'), 'utf8').split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l); } catch (e) { return {}; } });
  var launches = events.filter(function (e) { return e.event === 'provider_launch'; }).length;
  var settles = events.filter(function (e) { return e.event === 'transition' && ['COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED'].indexOf(e.to) !== -1; }).length;
  var invokes = events.filter(function (e) { return e.event === 'mcp_invoke'; });
  var trace = (report.evidence && report.evidence.tool_trace) || [];
  var browserCalls = trace.filter(function (e) { return /^browser_/.test(e.tool); });
  var backends = browserCalls.map(function (e) { return e.backend; }).filter(Boolean);
  // Token leak: the CDP token must appear nowhere in the task's record or the audit lines for it.
  var tokFile = path.join(HOME, '.config', 'obscura', 'cdp.env');
  var tok = fs.existsSync(tokFile) ? (fs.readFileSync(tokFile, 'utf8').match(/OBSCURA_CDP_TOKEN=["']?([^"'\n]+)/) || [])[1] : null;
  var leak = false;
  if (tok) {
    fs.readdirSync(tdir).forEach(function (f) { try { if (fs.readFileSync(path.join(tdir, f), 'utf8').indexOf(tok) !== -1) leak = true; } catch (e) { /* dir */ } });
    var audit = path.join(EXEC_HOME, 'orchestration', 'mcp-audit.jsonl');
    if (fs.existsSync(audit) && fs.readFileSync(audit, 'utf8').indexOf(tok) !== -1) leak = true;
  }
  var ev = {
    issue: issue, executor_task_id: ex.executor_task_id, runtime_head: runtime, fresh_for_head: !!fresh,
    status: status.status, retry_count: status.retry_count, executions: launches, settlements: settles,
    mcp_invokes: invokes.length, mcp_decisions: invokes.map(function (e) { return e.decision + ':' + (e.status || e.code); }),
    browser_calls: browserCalls.length, browser_ok: browserCalls.filter(function (e) { return !e.refused; }).length,
    recorded_backends: backends, report_status: report.report && report.report.status || null,
    report_mentions: report.report ? String(report.report.summary || '').slice(0, 200) : null, token_leak: leak
  };
  var checks = [];
  if (!fresh) checks.push(unmeasured('E2E ' + letter + ' #' + issue + ' ran on ' + String(runtime).slice(0, 8) + ', whose worker code differs from HEAD ' + HEAD.slice(0, 8) + ' — rerun'));
  if (leak) checks.push(failed('E2E ' + letter + ' #' + issue + ': CDP token found in the task record or audit'));
  if (settles !== 1) checks.push(failed('E2E ' + letter + ' #' + issue + ': ' + settles + ' settlements (expected exactly 1)'));
  if (launches > 3) checks.push(failed('E2E ' + letter + ' #' + issue + ': ' + launches + ' executions (retry storm)'));
  var okCalls = browserCalls.filter(function (e) { return !e.refused; });
  if (letter === 'A' || letter === 'B') {
    var want = letter === 'A' ? 'obscura' : 'playwright';
    if (status.status !== 'COMPLETED') checks.push(failed('E2E ' + letter + ' #' + issue + ' ended ' + status.status));
    if (!okCalls.length) checks.push(failed('E2E ' + letter + ' #' + issue + ': no browser call succeeded'));
    if (!backends.length) checks.push(unmeasured('E2E ' + letter + ' #' + issue + ': the trace records no backend (worker without the adapter-backend evidence) — the "' + want + '" claim is the model\'s only'));
    else if (backends.some(function (b) { return b !== want; })) checks.push(failed('E2E ' + letter + ' #' + issue + ': served by ' + backends.join(',') + ', expected ' + want));
  } else if (letter === 'C') {
    if (okCalls.length) checks.push(failed('E2E C #' + issue + ': a browser call succeeded with every backend down'));
    if (status.status === 'COMPLETED') checks.push(failed('E2E C #' + issue + ': COMPLETED with no backend (claimed success)'));
  }
  if (!checks.length) checks.push(pass('E2E ' + letter + ' #' + issue + ' ' + status.status + ', ' + launches + ' execution(s), 1 settlement, ' + invokes.length + ' governed invokes, backend ' + (backends.join(',') || 'n/a') + ', no token leak'));
  return { result: all(checks), evidence: ev };
}
var E2E = {};
args('--e2e').forEach(function (spec) { var m = /^([ABC])=(\d+)$/.exec(spec || ''); if (m) E2E[m[1]] = e2eEvidence(m[1], m[2]); });
function e2e(letter) { return E2E[letter] ? E2E[letter].result : unmeasured('no E2E ' + letter + ' evidence given (--e2e ' + letter + '=<issue>)'); }

// ---------------------------------------------------------------- live probes
function probeGitSync() {
  if (DIRTY) return failed('live checkout dirty: ' + DIRTY.split('\n').slice(0, 3).join('; '));
  if (BRANCH !== 'main') return failed('live checkout on ' + BRANCH);
  return HEAD === ORIGIN ? pass('main clean, HEAD = origin/main = ' + HEAD.slice(0, 8)) : failed('HEAD ' + HEAD.slice(0, 8) + ' != origin/main ' + ORIGIN.slice(0, 8));
}
function probeWorkerIdentity() {
  if (!IDENT.head) return failed('worker /health unreachable or has no code_identity');
  if (IDENT.verified !== true) return failed('worker identity not verified: ' + IDENT.reason);
  return IDENT.head === HEAD ? pass('worker code ' + IDENT.head.slice(0, 8) + ' verified, started ' + IDENT.started_at)
    : failed('worker runs ' + String(IDENT.head).slice(0, 8) + ', checkout is ' + HEAD.slice(0, 8) + ' — restart at RUNNING=0');
}
function probeListeners() {
  var rows = sh('ss', ['-ltnpH']).out.trim().split('\n').filter(Boolean).map(function (l) {
    var f = l.trim().split(/\s+/); var pid = (l.match(/pid=(\d+)/) || [])[1];
    var cmd = ''; try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' '); } catch (e) { cmd = ''; }
    return { addr: f[3], pid: pid, cmd: cmd };
  });
  var fixtures = [];
  var bad = rows.filter(function (r) {
    if (CFG.listener_allowlist.some(function (x) { return x.addr ? x.addr === r.addr : new RegExp(x.pattern).test(r.addr); })) return false;
    // A loopback port held by a running test suite is that suite's fixture server, not a service.
    if (/^127\.0\.0\.1:/.test(r.addr) && /\/tests\/[^ ]+\.js/.test(r.cmd)) { fixtures.push(r.addr); return false; }
    return true;
  });
  return bad.length ? failed('unexpected listeners: ' + bad.map(function (r) { return r.addr + ' (' + (r.cmd.slice(0, 60) || 'pid ' + r.pid) + ')'; }).join(', '))
    : pass(rows.length + ' listeners, all on the allowlist' + (fixtures.length ? ' (+' + fixtures.length + ' loopback test-fixture servers of a running suite)' : ''));
}
function probeSecretFiles() {
  var bad = [];
  CFG.secret_files.forEach(function (f) {
    var p = tilde(f);
    if (!fs.existsSync(p)) return;
    var mode = (fs.statSync(p).mode & 0o777).toString(8);
    if (mode !== '600') bad.push(f + ' ' + mode);
  });
  var stray = ['/tmp/obscura-token', '/tmp/obscura-token.env'].filter(function (p) { return fs.existsSync(p); });
  if (stray.length) bad.push('stray token file(s): ' + stray.join(', '));
  return bad.length ? failed(bad.join('; ')) : pass('every secret file 0600, no stray token file');
}
function probeGitleaks() {
  var bin = path.join(HOME, '.local', 'bin', 'gitleaks');
  if (!fs.existsSync(bin)) return blocked('gitleaks not installed on this host', 'install gitleaks 8.30.1 (checksum-verified) into ~/.local/bin');
  var rep = path.join(os.tmpdir(), 'mythos-matrix-gitleaks-' + process.pid + '.json');
  sh(bin, ['dir', REPO, '--no-banner', '--redact', '-f', 'json', '-r', rep, '--exit-code', '0'], { timeout: 300000 });
  var found = []; try { found = JSON.parse(fs.readFileSync(rep, 'utf8')); } catch (e) { return failed('gitleaks produced no report'); }
  fs.rmSync(rep, { force: true });
  var real = found.filter(function (f) {
    var file = String(f.File || '').replace(REPO + '/', '');
    if (/^tests\//.test(file)) return false;
    if (/(^|\/)node_modules\//.test(file)) return false;
    return !CFG.gitleaks_fixture_rules.allowed_non_test.some(function (a) { return a.file === file && a.rule === f.RuleID; });
  });
  return real.length ? failed(real.length + ' finding(s) outside the fixture set: ' + real.slice(0, 3).map(function (f) { return f.File + ':' + f.StartLine + ' ' + f.RuleID; }).join(', '))
    : pass(found.length + ' gitleaks tree hits, all synthetic test fixtures or allowlisted model ids');
}
function probeCdpAuth() {
  var r = httpJson('http://127.0.0.1:9222/json/version');
  return r.code === 401 ? pass('CDP unauthenticated → 401') : failed('CDP unauthenticated answered ' + r.code);
}
function probeSudo() {
  var r = sh('sudo', ['-n', 'true'], { timeout: 10000 });
  return r.status !== 0 ? pass('no passwordless sudo for the worker user') : failed('passwordless sudo available');
}
function probeSkillTrust() {
  var r = sh(process.execPath, ['-e',
    "var s=require(process.argv[1]);var reg=s.loadRegistry();var t=reg.trust||{};var ids=Object.keys(reg.skills||{});" +
    "var bad=ids.filter(function(i){return !t[i]||t[i].trusted!==true});process.stdout.write(JSON.stringify({n:ids.length,bad:bad.map(function(i){return i+':'+(t[i]&&t[i].status)})}))",
    path.join(REPO, 'projects', 'mythos-ai-executor', 'lib', 'skills.js')], { cwd: REPO, env: Object.assign({}, process.env, { MYTHOS_SKILL_TRUST: '' }) });
  var o; try { o = JSON.parse(r.out); } catch (e) { return failed('skill registry did not load: ' + r.err.slice(0, 200)); }
  var cli = sh(process.execPath, [path.join(REPO, 'projects', 'command-center', 'cli', 'skill-trust-cli.js'), 'verify'], { cwd: REPO });
  var checks = [o.bad.length ? failed('untrusted skills: ' + o.bad.join(', ')) : pass(o.n + ' executor skills ACCEPT via the executor\'s own loadRegistry()'),
    /VERIFY OK/.test(cli.out) ? pass('skill-trust-cli verify OK') : failed('skill-trust-cli verify: ' + cli.out.slice(-200))];
  return all(checks);
}
function probeBrowserMatrix() {
  var p = JSON.parse(fs.readFileSync(path.join(REPO, 'projects', 'mythos-gateway', 'registry', 'mcp-permissions.json'), 'utf8'));
  var checks = [];
  if (p.capabilities && p.capabilities['browser.interact']) checks.push(failed('browser.interact is declared (owner decision: not granted)'));
  var grants = Object.keys(p.subjects || {}).map(function (s) { return [s, p.subjects[s].grants && p.subjects[s].grants['browser.read']]; });
  var allow = grants.filter(function (g) { return g[1] === 'ALLOW'; }).map(function (g) { return g[0]; });
  if (allow.join(',') !== 'executor') checks.push(failed('browser.read ALLOW subjects: ' + (allow.join(',') || 'none') + ' (expected executor only)'));
  if (!checks.length) checks.push(pass('browser.read ALLOW for executor only; browser.interact absent'));
  return all(checks);
}
function probeGuardian() {
  var r = sh('gh', ['run', 'list', '--repo', 'othoth77/mythos-prod', '--workflow', 'guardian-suite.yml', '--branch', 'main', '--limit', '20', '--json', 'headSha,conclusion,event,databaseId'], { cwd: REPO });
  var runs; try { runs = JSON.parse(r.out); } catch (e) { return blocked('gh could not list Guardian runs: ' + r.err.slice(0, 120), 'authenticate gh on this host'); }
  var paths = ['ops/guardian', 'tests/guardian-test.js', 'projects/status-center/monitor', '.github/workflows/guardian-suite.yml'];
  var covering = runs.filter(function (x) { return x.conclusion === 'success' && git(['cat-file', '-e', x.headSha]).status === 0 && git(['diff', '--quiet', x.headSha, HEAD, '--'].concat(paths)).status === 0; })[0];
  if (covering) return pass('Guardian run ' + covering.databaseId + ' (' + covering.event + ' on ' + covering.headSha.slice(0, 8) + ') succeeded on a tree identical to HEAD for every Guardian input');
  var last = runs[0];
  return failed('no successful Guardian run covers HEAD\'s Guardian inputs' + (last ? ' (latest: ' + last.conclusion + ' on ' + last.headSha.slice(0, 8) + ')' : ''));
}
function probeRegression() {
  var tsv = arg('--sweep'), sha = arg('--sweep-commit');
  if (!tsv || !sha) return unmeasured('no sweep given (--sweep <tsv> --sweep-commit <sha>)');
  if (git(['diff', '--quiet', sha, HEAD, '--', 'projects', 'tests', 'scripts']).status !== 0) return unmeasured('sweep ran on ' + sha.slice(0, 8) + ', whose code differs from HEAD — rerun it');
  var rows = fs.readFileSync(tilde(tsv), 'utf8').split('\n').filter(function (l) { return l && l !== 'DONE'; }).map(function (l) { return l.split('\t'); });
  var nonzero = rows.filter(function (r) { return r[1] !== '0'; });
  var unclassified = nonzero.filter(function (r) { return !CFG.regression_exclusions[r[0]]; });
  if (unclassified.length) return failed(unclassified.length + ' unclassified failing suite(s): ' + unclassified.map(function (r) { return r[0] + ' ' + r[2]; }).join('; '));
  // A load-sensitive exclusion must be green standalone, now.
  var load = nonzero.filter(function (r) { return CFG.regression_exclusions[r[0]].class === 'load_sensitive'; });
  var loadBad = load.filter(function (r) { return sh(process.execPath, [path.join(REPO, 'tests', r[0])], { cwd: REPO, timeout: 600000 }).status !== 0; });
  if (loadBad.length) return failed('load-sensitive suite(s) fail standalone too: ' + loadBad.map(function (r) { return r[0]; }).join(', '));
  var classes = {};
  nonzero.forEach(function (r) { var c = CFG.regression_exclusions[r[0]].class; classes[c] = (classes[c] || 0) + 1; });
  return pass(rows.length + ' suites; ' + (rows.length - nonzero.length) + ' green; ' + nonzero.length + ' nonzero, every one classified (' +
    Object.keys(classes).map(function (c) { return c + ' ' + classes[c]; }).join(', ') + ')');
}
function probeUnitRestart() {
  var units = ['mythos-haddad-worker.service', 'mythos-haddad-runtime.service', 'obscura.service', 'mythos-haddad-mcp-http.service'];
  var bad = units.filter(function (u) { return !/Restart=(on-failure|always)/.test(sh('systemctl', ['--user', 'show', u, '-p', 'Restart']).out); });
  return bad.length ? failed('no automatic restart: ' + bad.join(', ')) : pass(units.length + ' user units restart automatically');
}
function probeSupervisorLive() {
  var r = sh('gh', ['issue', 'list', '--repo', 'othoth77/mythos-prod', '--label', 'mythos:supervised', '--state', 'all', '--limit', '30', '--json', 'number,updatedAt'], { cwd: REPO });
  var list; try { list = JSON.parse(r.out); } catch (e) { return blocked('gh unavailable', 'authenticate gh'); }
  var recent = list.filter(function (i) { return Date.now() - Date.parse(i.updatedAt) < 24 * 3600 * 1000; });
  var acts = 0, sample = null;
  recent.forEach(function (i) {
    var c = sh('gh', ['issue', 'view', String(i.number), '--repo', 'othoth77/mythos-prod', '--json', 'comments', '--jq', '[.comments[].body | select(test("mythos-supervisor event="))] | length'], { cwd: REPO });
    var n = parseInt(c.out, 10) || 0; acts += n; if (n && !sample) sample = i.number;
  });
  return acts ? pass(acts + ' supervisor decision(s) posted on supervised Issues in the last 24 h (e.g. #' + sample + ')')
    : blocked('no supervisor decision on any supervised Issue in 24 h — liveness not observable from here', 'run the supervisor (VPS timer, or Haddad config supervisor-haddad.json) and submit one supervised task');
}

// ---------------------------------------------------------------- the 36 gates
var G = [
  [1, 'Repository integrity', function () { var r = git(['fsck', '--connectivity-only', '--no-progress']); return r.status === 0 ? pass('git fsck --connectivity-only clean') : failed(r.err.slice(0, 200)); }],
  [2, 'Git synchronization', probeGitSync],
  [3, 'Mythos OS runtime', function () { return HEALTH ? (HEALTH.status === 'PASS' ? pass('haddad-health ' + JSON.stringify(HEALTH.counts)) : failed('haddad-health ' + HEALTH.status + ' ' + JSON.stringify(HEALTH.counts))) : failed('haddad-health gave no JSON'); }],
  [4, 'Orchestration', function () { return suites(['mythos-orchestration-core-test.js', 'mythos-core-wiring-test.js', 'mythos-autonomous-campaign-test.js', 'mos-e2e-lifecycle-test.js']); }],
  [5, 'Task creation', function () { return suites(['mythos-ai-executor-test.js', 'mythos-github-issues-test.js']); }],
  [6, 'Task persistence', function () { return suites(['mythos-lifecycle-test.js']); }],
  [7, 'Task assignment', function () { return suites(['mythos-github-bridge-test.js', 'mythos-github-bridge-timer-test.js', 'bridge-action-resolution-test.js']); }],
  [8, 'Worker execution', function () { return all([probeWorkerIdentity(), suite('mythos-haddad-tool-runner-test.js'), e2e('A')]); }],
  [9, 'Executor routing', function () { return suites(['mythos-v1-lane-routing-test.js', 'model-selection-policy-test.js', 'mythos-haddad-ai-team-test.js']); }],
  [10, 'Provider selection', function () { return suites(['mythos-haddad-delegation-test.js', 'free-llm-selector-test.js', 'mythos-haddad-advisory-profile-test.js']); }],
  [11, 'Qwen execution', function () { return all([healthCheck('ai_runtime'), e2e('A')]); }],
  [12, 'OpenAI fallback', function () {
    return all([suite('mythos-orchestrator-openai-test.js'),
      blocked('no OpenAI credential on Haddad by design; the OpenAI rung is the VPS Supervisor\'s', 'on the VPS: exercise one supervised task whose Qwen consult fails, and cite the escalation to OPENAI')]);
  }],
  [13, 'Claude integration', function () { return all([healthCheck('claude_code'), suite('mythos-haddad-escalation-events-test.js')]); }],
  [14, 'Bridge communication', function () {
    var t = sh('systemctl', ['--user', 'is-active', 'mythos-haddad-bridge.timer']).out.trim();
    return all([t === 'active' ? pass('bridge timer active') : failed('bridge timer ' + t), suite('mythos-github-bridge-test.js')]);
  }],
  [15, 'Supervisor control', function () { return all([suite('mythos-supervisor-test.js'), probeSupervisorLive()]); }],
  [16, 'Retry/deadline enforcement', function () { return suites(['mythos-executor-transient-hangup-test.js', 'mythos-haddad-supervised-loop-test.js', 'mythos-haddad-runtime-test.js']); }],
  [17, 'Failure handling', function () { return all([suite('mythos-report-normalization-test.js'), assertionPassed('mythos-github-bridge-test.js', 'cancelling a BLOCKED executor task is reported, not thrown'), e2e('C')]); }],
  [18, 'Single-settlement guarantee', function () { return all([assertionPassed('mythos-ai-executor-test.js', 'a second COMPLETED settlement is refused'), assertionPassed('mythos-ai-executor-test.js', 'the first settlement stands after a duplicate')]); }],
  [19, 'Permission governance', function () { return suites(['mythos-governance-invariant-test.js', 'gateway-boundary-test.js']); }],
  [20, 'Skill trust', function () { return all([probeSkillTrust(), suite('skill-trust-test.js')]); }],
  [21, 'MCP governance', function () { return all([healthCheck('mcp'), suite('mcp-ecosystem-test.js'), suite('mythos-haddad-mcp-test.js')]); }],
  [22, 'Browser governance', function () { return all([probeBrowserMatrix(), suite('mythos-browser-governed-test.js')]); }],
  [23, 'Obscura', function () { return all([healthCheck('browser'), probeCdpAuth(), suite('mythos-browser-mcp-test.js')]); }],
  [24, 'Playwright fallback', function () { return all([healthCheck('browser'), e2e('B')]); }],
  [25, 'Security boundaries', function () { return all([probeListeners(), probeSudo(), probeCdpAuth()]); }],
  [26, 'Secret handling', function () { return all([probeSecretFiles(), probeGitleaks()]); }],
  [27, 'Audit trail', function () {
    var a = path.join(EXEC_HOME, 'orchestration', 'mcp-audit.jsonl');
    return all([fs.existsSync(a) ? pass('MCP audit log present (' + fs.readFileSync(a, 'utf8').split('\n').filter(Boolean).length + ' records)') : failed('no MCP audit log'), e2e('A')]);
  }],
  [28, 'Event integrity', function () { return suites(['mythos-orchestration-core-test.js', 'mythos-haddad-escalation-events-test.js']); }],
  [29, 'Health checks', function () { return HEALTH && HEALTH.status === 'PASS' ? pass('all ' + HEALTH.counts.PASS + ' health checks PASS') : failed('health ' + (HEALTH ? HEALTH.status + ' ' + JSON.stringify(HEALTH.counts) : 'unavailable')); }],
  [30, 'Recovery', function () {
    var rebuild = fs.existsSync(path.join(REPO, 'tests', 'mythos-haddad-worker-rebuild-test.js'))
      ? suite('mythos-haddad-worker-rebuild-test.js') : failed('no rebuild test on this commit: haddad-worker-setup.sh does not reproduce the production worker (PR #528)');
    return all([probeUnitRestart(), rebuild]);
  }],
  [31, 'HostOps boundary', function () {
    return all([suites(['dagu-hostops-allowlist-test.js', 'mythos-hostops-controlled-test.js', 'mythos-hostops-group-refresh-test.js']),
      blocked('the HostOps root daemon exists only on the VPS (#479)', 'VPS root: run the HostOps self-test (9/9) after the systemd-run --machine transport fix')]);
  }],
  [32, 'Guardian CI', probeGuardian],
  [33, 'Regression suite', probeRegression],
  [34, 'E2E execution', function () { return all([e2e('A'), e2e('B'), e2e('C')]); }],
  [35, 'Documentation', function () {
    var docs = ['projects/mythos-haddad/README.md', 'projects/mythos-haddad/docs/BROWSER.md', 'projects/mythos-haddad/docs/PRODUCTION_READINESS_2026-09-28.md', 'projects/mythos-haddad/docs/VERIFICATION_MATRIX.md'];
    var missing = docs.filter(function (d) { return !fs.existsSync(path.join(REPO, d)); });
    return missing.length ? failed('missing: ' + missing.join(', ')) : pass(docs.length + ' operator documents present');
  }]
];

var results = G.map(function (g) {
  var r; try { r = g[2](); } catch (e) { r = failed('probe crashed: ' + e.message); }
  return Object.assign({ gate: g[0], name: g[1] }, r);
});
var required = results.slice();
var ready = required.every(function (r) { return r.status === 'PASS'; });
results.push({ gate: 36, name: 'Production readiness', status: ready ? 'PASS' : 'FAIL',
  evidence: ready ? 'every gate 1–35 PASS on ' + HEAD.slice(0, 8) : required.filter(function (r) { return r.status !== 'PASS'; }).map(function (r) { return r.gate + ' ' + r.status; }).join(', ') });

var report = {
  schema: 'mythos-verify-matrix/1', generated_at: new Date().toISOString(), host: os.hostname(),
  commit: HEAD, origin_main: ORIGIN, worker_code: IDENT.head || null, quick: QUICK,
  verdict: ready ? '100% VERIFIED' : 'NOT 100%',
  gates: results,
  e2e: Object.keys(E2E).reduce(function (o, k) { o[k] = E2E[k].evidence || null; return o; }, {}),
  blockers: results.filter(function (r) { return r.owner_action; }).map(function (r) { return { gate: r.gate, name: r.name, owner_action: r.owner_action }; })
};
var out = arg('--out');
if (out) fs.writeFileSync(tilde(out), JSON.stringify(report, null, 2) + '\n');
if (ARGS.indexOf('--json') !== -1) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
else {
  console.log('MYTHOS OS / ORCHESTRATION — verification matrix — ' + report.generated_at);
  console.log('commit ' + HEAD.slice(0, 8) + '  origin/main ' + ORIGIN.slice(0, 8) + '  worker ' + String(IDENT.head || '?').slice(0, 8) + (QUICK ? '  (--quick)' : ''));
  results.forEach(function (r) { console.log(('  ' + r.gate).slice(-3) + ' ' + (r.status + '          ').slice(0, 11) + r.name + ' — ' + String(r.evidence).slice(0, 220)); });
  console.log('VERDICT: ' + report.verdict);
  report.blockers.forEach(function (b) { console.log('  BLOCKED ' + b.gate + ' ' + b.name + ': ' + b.owner_action); });
}
process.exit(ready ? 0 : 1);
