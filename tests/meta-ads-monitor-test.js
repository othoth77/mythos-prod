'use strict';
// =====================================================
// Facebook Ads Monitor — offline tests
// tests/meta-ads-monitor-test.js
//
// Proves the monitor is READ-ONLY by construction (GET-only client, read
// path allowlist, verb-override and token-in-URL parameters refused, no
// write export, no non-GET method anywhere in the code), plus config
// safety, retries/timeouts, findings, report sections, snapshot diffing,
// retention, duplicate-run lock and secret scanning. No network: every
// HTTP call is injected; state lives in a temp dir removed at the end.
//
// Run with: node tests/meta-ads-monitor-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..', 'projects', 'meta-ads-monitor');
var graph = require(path.join(ROOT, 'lib', 'graph.js'));
var config = require(path.join(ROOT, 'lib', 'config.js'));
var collect = require(path.join(ROOT, 'lib', 'collect.js'));
var diff = require(path.join(ROOT, 'lib', 'diff.js'));
var store = require(path.join(ROOT, 'lib', 'store.js'));
var BIN = path.join(ROOT, 'bin', 'meta-ads-monitor.js');
var FIX1 = path.join(__dirname, 'fixtures', 'meta-ads-monitor-day1.json');
var FIX2 = path.join(__dirname, 'fixtures', 'meta-ads-monitor-day2.json');

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ads-monitor-test-'));
var pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; } else { fail++; console.log('FAIL ' + name); } }
async function rejects(fn, code, name) {
  try { await fn(); ok(false, name + ' (did not throw)'); } catch (e) { ok(!code || e.code === code, name + ' (got ' + e.code + ')'); }
}
var TOKEN = 'EAAtesttoken' + 'X'.repeat(30);

function fakeFetch(responses, calls) {
  var i = 0;
  return async function (url, init) {
    calls.push({ url: url, init: init });
    var r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, text: async function () { return JSON.stringify(r.body); } };
  };
}

function runBin(args, env) {
  return cp.spawnSync(process.execPath, [BIN].concat(args), {
    encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, process.env, env)
  });
}

(async function main() {
  // ---------- 1. READ-ONLY by construction ----------
  var exported = Object.keys(graph.createClient({ token: 't', fetch: async function () {} }));
  ok(exported.sort().join(',') === 'cancel,get,getAll,requestCount', 'client exports only get/getAll/cancel/requestCount (no write function)');
  ['me/adaccounts', 'act_1', 'act_1/campaigns', 'act_1/adsets', 'act_1/ads', 'act_1/insights'].forEach(function (p) {
    ok(graph.isAllowedPath(p), 'allowlisted read path ' + p);
  });
  ['act_1/campaigns/extra', 'act_1/adcreatives', '123', 'act_1/customaudiences', 'me', 'act_x/ads', '../act_1', 'act_1/ads?x'].forEach(function (p) {
    ok(!graph.isAllowedPath(p), 'non-allowlisted path refused ' + p);
  });
  var calls = [];
  var c = graph.createClient({ token: TOKEN, fetch: fakeFetch([{ status: 200, body: { data: [] } }], calls), sleep: async function () {} });
  await rejects(function () { return c.get('act_1/campaigns', { method: 'POST' }); }, 'META_PARAM_REFUSED', 'method=POST override refused');
  await rejects(function () { return c.get('act_1/campaigns', { _method: 'DELETE' }); }, 'META_PARAM_REFUSED', '_method override refused');
  await rejects(function () { return c.get('act_1/campaigns', { access_token: 'x' }); }, 'META_PARAM_REFUSED', 'access_token param refused');
  await rejects(function () { return c.get('act_1/copies', {}); }, 'META_PATH_REFUSED', 'write-shaped path refused');
  ok(calls.length === 0, 'refused requests never reach the network');
  await c.get('act_1/campaigns', { fields: 'id,name' });
  ok(calls.length === 1 && calls[0].init.method === 'GET', 'request method is GET');
  ok(calls[0].init.redirect === 'error', 'redirects refused (no server-chosen destination)');
  ok(calls[0].url.indexOf(TOKEN) === -1 && !/access_token/.test(calls[0].url), 'token never in URL');
  ok(calls[0].init.headers.Authorization === 'Bearer ' + TOKEN, 'token sent in Authorization header');

  // static scan: no non-GET method or write verb anywhere in the monitor's code
  var codeFiles = ['lib/graph.js', 'lib/collect.js', 'lib/diff.js', 'lib/report.js', 'lib/store.js', 'lib/config.js', 'bin/meta-ads-monitor.js'];
  codeFiles.forEach(function (f) {
    var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    ok(!/method\s*:\s*['"](?!GET)/i.test(src), f + ': no non-GET method literal');
    ok(!/['"](POST|PUT|PATCH|DELETE)['"]/.test(src), f + ': no write HTTP verb literal');
    ok(!/require\(['"](https?|net|tls)['"]\)/.test(src) || f === 'lib/graph.js', f + ': no second network path');
  });

  // ---------- 2. retry / timeout / errors ----------
  calls = [];
  var slept = [];
  var c2 = graph.createClient({ token: TOKEN, fetch: fakeFetch([{ status: 500, body: { error: { message: 'boom' } } }, { status: 200, body: { data: [1] } }], calls),
    sleep: async function (ms) { slept.push(ms); } });
  var r = await c2.get('act_1/ads', {});
  ok(r.data[0] === 1 && calls.length === 2 && slept.length === 1, 'transient 500 retried then succeeded');
  calls = [];
  var c3 = graph.createClient({ token: TOKEN, fetch: fakeFetch([{ status: 400, body: { error: { code: 100, message: 'bad ' + TOKEN } } }], calls), sleep: async function () {} });
  try { await c3.get('act_1/ads', {}); ok(false, 'permanent error throws'); } catch (e) {
    ok(e.code === 'META_API_ERROR' && calls.length === 1, 'permanent 400 not retried');
    ok(e.message.indexOf(TOKEN) === -1, 'token redacted from error message');
  }
  calls = [];
  var c4 = graph.createClient({ token: TOKEN, retries: 2, fetch: fakeFetch([{ status: 400, body: { error: { code: 17, message: 'rate' } } }], calls), sleep: async function () {} });
  await rejects(function () { return c4.get('act_1/ads', {}); }, 'META_TRANSIENT', 'rate limit (code 17) retried then surfaced');
  ok(calls.length === 3, 'retry count bounded (1 + 2 retries)');
  var c5 = graph.createClient({ token: TOKEN, retries: 0, timeoutMs: 50, sleep: async function () {},
    fetch: function (url, init) { return new Promise(function (_, rej) { init.signal.addEventListener('abort', function () { var e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); }); } });
  try { await c5.get('act_1/ads', {}); ok(false, 'timeout throws'); } catch (e) { ok(e.code === 'META_NETWORK' && /timed out/.test(e.message), 'request timeout enforced'); }
  calls = [];
  var c6 = graph.createClient({ token: TOKEN, sleep: async function () {}, fetch: fakeFetch([
    { status: 200, body: { data: [1, 2], paging: { cursors: { after: 'A' }, next: 'https://graph.facebook.com/x?access_token=' + TOKEN } } },
    { status: 200, body: { data: [3], paging: { cursors: { after: 'B' } } } }], calls) });
  var all = await c6.getAll('act_1/campaigns', {});
  ok(all.length === 3 && calls.length === 2, 'cursor pagination collected every page');
  ok(calls[1].url.indexOf('after=A') !== -1 && calls[1].url.indexOf(TOKEN) === -1, 'server-supplied next URL never followed');

  calls = [];
  var c7 = graph.createClient({ token: TOKEN, sleep: async function () {}, fetch: fakeFetch([
    { status: 200, body: { data: [1], paging: { cursors: { after: 'A' }, next: 'x' } } }], calls) });
  await rejects(function () { return c7.getAll('act_1/ads', {}, 3); }, 'META_TRUNCATED', 'page limit reached → error, never silent partial data');
  ok(calls.length === 3, 'truncation stops at maxPages');
  calls = [];
  var c8 = graph.createClient({ token: TOKEN, sleep: async function () {}, fetch: fakeFetch([{ status: 200, body: { data: [] } }], calls) });
  c8.cancel();
  await rejects(function () { return c8.get('act_1/ads', {}); }, 'META_CANCELLED', 'after deadline cancel no further request');
  ok(calls.length === 0, 'cancelled client makes no request');

  // ---------- 3. config / secrets ----------
  process.env.META_ADS_MONITOR_SECRET_FILE = path.join(TMP, 'absent.env');
  ok(config.load().state === 'NOT_CONFIGURED', 'absent secret file → NOT_CONFIGURED');
  var sf = path.join(TMP, 'meta.env');
  fs.writeFileSync(sf, 'META_ADS_READ_TOKEN=' + TOKEN + '\nMETA_ADS_ACCOUNT_IDS=act_111, 222\n', { mode: 0o644 });
  fs.chmodSync(sf, 0o644);
  process.env.META_ADS_MONITOR_SECRET_FILE = sf;
  ok(config.load().state === 'CONFIG_INSECURE', 'world-readable secret file refused');
  fs.chmodSync(sf, 0o600);
  var cfg = config.load();
  ok(cfg.state === 'CONFIGURED' && cfg.token === TOKEN && cfg.accountIds.join(',') === '111,222', 'valid secret file loaded, act_ prefix stripped');
  fs.writeFileSync(sf, 'META_ADS_READ_TOKEN=x\nMETA_ADS_ACCOUNT_IDS=abc\n', { mode: 0o600 });
  ok(config.load().state === 'CONFIG_INVALID', 'non-numeric account id refused');
  delete process.env.META_ADS_MONITOR_SECRET_FILE;

  // ---------- 4. collect + findings ----------
  ok(collect.minorToMajor('750', 'USD') === 7.5 && collect.minorToMajor('750', 'JPY') === 750 && collect.minorToMajor(null, 'USD') === null, 'minor→major currency units');
  function fixtureClient(file) {
    var map = JSON.parse(fs.readFileSync(file, 'utf8'));
    return graph.createClient({ token: TOKEN, sleep: async function () {}, fetch: async function (url) {
      var u = new URL(url); var p = u.pathname.replace(/^\/v\d+\.\d\//, ''); var keep = [];
      u.searchParams.forEach(function (v, k) { if (['fields', 'limit', 'after'].indexOf(k) === -1) keep.push(k + '=' + v); });
      var key = p + (keep.length ? '?' + keep.sort().join('&') : '');
      return { ok: true, status: 200, text: async function () { return JSON.stringify(map[key] || { data: [] }); } };
    } });
  }
  var s1 = await collect.collect(fixtureClient(FIX1), { now: new Date('2026-09-17T06:40:00Z') });
  var s2 = await collect.collect(fixtureClient(FIX2), { now: new Date('2026-09-18T06:40:00Z') });
  var a2 = s2.accounts[0];
  ok(a2.id === '111' && a2.currency === 'USD' && a2.amount_spent === 185 && a2.spend_cap === 200, 'account normalised (minor units → USD)');
  ok(a2.campaigns.length === 3 && a2.campaigns[0].daily_budget === 7.5, 'campaign budgets normalised');
  ok(JSON.stringify(s2).indexOf(TOKEN) === -1, 'snapshot carries no token');
  var fnd = diff.analyse(s2, s1).accounts[0];
  var kinds = fnd.changes.map(function (x) { return x.type + ':' + x.id + ':' + x.kind; });
  ok(kinds.indexOf('campaign:901:daily_budget') !== -1, 'budget change detected');
  ok(kinds.indexOf('campaign:902:status') !== -1 && kinds.indexOf('campaign:902:effective_status') !== -1, 'status change detected');
  ok(kinds.indexOf('campaign:903:new') !== -1, 'new campaign detected');
  ok(kinds.indexOf('campaign:901:daily_spend') !== -1, 'significant daily spend jump detected (4.2 → 9.9)');
  ok(fnd.delivery.some(function (d) { return d.id === '903'; }), 'active campaign with no delivery flagged');
  ok(fnd.delivery.some(function (d) { return d.id === '702' && /policy/.test(d.text); }), 'disapproved ad flagged with Meta reason');
  ok(fnd.review.some(function (x) { return x.id === '901' && /التكرار/.test(x.text); }), 'high 7-day frequency → review');
  ok(fnd.review.some(function (x) { return x.id === '902' && /بدون أي نتيجة/.test(x.text); }), 'spend with no reported results → review');
  ok(fnd.attention.some(function (x) { return x.kind === 'spend_cap'; }), 'spend cap ≥ 90 % → attention');
  ok(fnd.spend.yesterday === 12.4 && fnd.spend.last_7d === 46, 'spend totals summed only from returned insights');
  // one unreadable configured account does not hide the others
  var isoCalls = [];
  var isoClient = graph.createClient({ token: TOKEN, sleep: async function () {}, retries: 0, fetch: async function (url) {
    isoCalls.push(url);
    if (/\/act_222\?/.test(url)) return { ok: false, status: 400, text: async function () { return JSON.stringify({ error: { code: 200, message: 'no access' } }); } };
    return { ok: true, status: 200, text: async function () { return JSON.stringify(/\/act_111\?/.test(url) ? { id: 'act_111', account_id: '111', name: 'Good', currency: 'USD', account_status: 1 } : { data: [] }); } };
  } });
  var iso = await collect.collect(isoClient, { accountIds: ['222', '111'] });
  ok(iso.accounts.length === 2 && iso.accounts[0].errors[0].section === 'account' && iso.accounts[1].name === 'Good', 'unreadable account isolated, healthy account still collected');
  ok(require(path.join(ROOT, 'lib', 'report.js')).render({ date: 'd', findings: diff.analyse(iso, null) }).indexOf('account') !== -1, 'report lists the unreadable account section');
  // spend falling to zero (Meta omits the row) is a significant change
  var zero = JSON.parse(JSON.stringify(s2)); zero.accounts[0].insights.yesterday = zero.accounts[0].insights.yesterday.filter(function (r) { return r.campaign_id !== '901'; });
  var zk = diff.analyse(zero, s2).accounts[0].changes.filter(function (x) { return x.kind === 'daily_spend' && x.id === '901'; });
  ok(zk.length === 1 && zk[0].after === 0 && zk[0].before === 9.9 && zk[0].name === 'WhatsApp Leads', 'spend drop to zero detected');
  var first = diff.analyse(s1, null);
  ok(first.compared === false && first.accounts[0].changes.length === 0, 'first run: no invented changes');
  var partial = JSON.parse(JSON.stringify(s2)); partial.accounts[0].insights.yesterday = null;
  ok(diff.analyse(partial, s1).accounts[0].spend.yesterday === null, 'missing insights → unknown, not zero');

  // ---------- 5. end to end (offline fixtures, real CLI) ----------
  var state = path.join(TMP, 'state');
  var env = { META_ADS_MONITOR_STATE_DIR: state, META_ADS_MONITOR_SECRET_FILE: path.join(TMP, 'none.env') };
  var guard = runBin(['run', '--fixture', FIX1], { META_ADS_MONITOR_STATE_DIR: '' });
  ok(guard.status === 1 && /FIXTURE_NEEDS_STATE_DIR/.test(guard.stdout), '--fixture refused without an explicit test state dir');
  var nc = runBin(['run', '--now', '2026-09-16T06:40:00Z'], env);
  ok(nc.status === 0 && /NOT_CONFIGURED/.test(nc.stdout) && /no Meta request made/.test(nc.stdout), 'not configured → exit 0, setup report, no request');
  ok(fs.readFileSync(path.join(state, 'reports', '2026-09-16.md'), 'utf8').indexOf('META_ADS_READ_TOKEN') !== -1, 'setup report names the exact variable');
  var r1 = runBin(['run', '--fixture', FIX1, '--now', '2026-09-17T06:40:00Z'], env);
  ok(r1.status === 0 && /OK: 1 account/.test(r1.stdout), 'fixture run day 1 OK');
  var r2 = runBin(['run', '--fixture', FIX2, '--now', '2026-09-18T06:40:00Z'], env);
  ok(r2.status === 0, 'fixture run day 2 OK');
  var rep = fs.readFileSync(path.join(state, 'reports', '2026-09-18.md'), 'utf8');
  ['### ما يعمل', '### ما تغيّر منذ الفحص السابق', '### ما يحتاج انتباهك', '### الإنفاق والميزانية', '### مشاكل العرض', '### حملات تحتاج مراجعة', '### أهم التغييرات'].forEach(function (h) {
    ok(rep.indexOf(h) !== -1, 'report section ' + h);
  });
  ok(/7\.5 USD/.test(rep) && /5 USD/.test(rep), 'report shows budget change in account currency');
  ok(rep.indexOf('READ-ONLY by design') !== -1, 'report states READ-ONLY by design');
  var st = JSON.parse(fs.readFileSync(path.join(state, 'status.json'), 'utf8'));
  ok(st.state === 'OK' && st.read_only === true && st.consecutive_failures === 0, 'status.json OK');
  ok(fs.readdirSync(path.join(state, 'snapshots')).length === 2, 'two snapshots kept for comparison');
  var modes = fs.readdirSync(path.join(state, 'snapshots')).map(function (f) { return fs.statSync(path.join(state, 'snapshots', f)).mode & 0o777; });
  ok(modes.every(function (m) { return m === 0o600; }) && (fs.statSync(state).mode & 0o777) === 0o700, 'state files 0600 / dir 0700');
  var everything = '';
  ['snapshots', 'reports'].forEach(function (d) { fs.readdirSync(path.join(state, d)).forEach(function (f) { everything += fs.readFileSync(path.join(state, d, f), 'utf8'); }); });
  everything += fs.readFileSync(path.join(state, 'status.json'), 'utf8') + r1.stdout + r2.stdout;
  ok(!/EAA[A-Za-z0-9]{20,}/.test(everything) && everything.indexOf('fixture-token-not-a-secret') === -1, 'no token in reports, snapshots, status or logs');

  // corrupt newest snapshot → skipped, previous one used
  fs.writeFileSync(path.join(state, 'snapshots', '2026-09-18T07-00-00Z.json'), '{not json', { mode: 0o600 });
  var r3 = runBin(['run', '--fixture', FIX2, '--now', '2026-09-18T08:00:00Z'], env);
  ok(r3.status === 0 && /skipped unreadable previous snapshot/.test(r3.stdout), 'corrupt snapshot skipped, run recovers');

  // ---------- 6. lock / retention / secret scan ----------
  var lockRoot = path.join(TMP, 'lock'); store.ensureDirs(lockRoot);
  var rel = store.acquireLock(lockRoot, new Date());
  ok(typeof rel === 'function' && store.acquireLock(lockRoot, new Date()) === null, 'second concurrent run refused');
  var busy = runBin(['run', '--fixture', FIX1], { META_ADS_MONITOR_STATE_DIR: lockRoot });
  ok(busy.status === 75 && /duplicate-run protection/.test(busy.stdout), 'CLI exits 75 while locked');
  rel();
  fs.writeFileSync(path.join(lockRoot, 'run.lock'), JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
  var rel2 = store.acquireLock(lockRoot, new Date());
  ok(typeof rel2 === 'function', 'stale lock (dead pid) reclaimed'); rel2();

  var retRoot = path.join(TMP, 'ret'); store.ensureDirs(retRoot);
  var now = new Date('2026-12-31T00:00:00Z');
  for (var i = 0; i < 130; i++) {
    var f = path.join(retRoot, 'reports', '2026-' + String(1 + Math.floor(i / 28)).padStart(2, '0') + '-' + String(1 + i % 28).padStart(2, '0') + '.md');
    fs.writeFileSync(f, 'x'); var t = new Date(now.getTime() - (130 - i) * 3600000); fs.utimesSync(f, t, t);
  }
  var old = path.join(retRoot, 'snapshots', '2026-01-01T00-00-00Z.json');
  fs.writeFileSync(old, '{}'); var ot = new Date('2026-01-01T00:00:00Z'); fs.utimesSync(old, ot, ot);
  fs.writeFileSync(path.join(retRoot, 'snapshots', 'x.json.tmp-123'), 'partial');
  var removed = store.applyRetention(retRoot, now);
  ok(fs.readdirSync(path.join(retRoot, 'reports')).length === store.RETENTION.reports.maxFiles, 'reports capped at maxFiles');
  ok(removed.snapshots.indexOf('2026-01-01T00-00-00Z.json') !== -1, 'snapshots older than maxAgeDays pruned');
  ok(!fs.existsSync(path.join(retRoot, 'snapshots', 'x.json.tmp-123')), 'interrupted tmp files cleaned');

  ok(store.secretScan('hello ' + TOKEN, null) !== null && store.secretScan('x', 'secret-value') === null && store.secretScan('a secret-value', 'secret-value') === 'token value', 'secret scan catches token patterns and the live token');
  try { store.writeReport(retRoot, 'leak ' + TOKEN, null, now); ok(false, 'secret write refused'); } catch (e) { ok(e.code === 'SECRET_SCAN', 'writing a secret-bearing report is refused'); }

  // ---------- 7. systemd units ----------
  var svc = fs.readFileSync(path.join(ROOT, 'systemd', 'meta-ads-monitor.service'), 'utf8');
  var tmr = fs.readFileSync(path.join(ROOT, 'systemd', 'meta-ads-monitor.timer'), 'utf8');
  ok(/^User=deploy$/m.test(svc) && /^Type=oneshot$/m.test(svc), 'service: oneshot as deploy');
  ok(/^TimeoutStartSec=/m.test(svc) && /^SuccessExitStatus=75$/m.test(svc) && /^MemoryMax=/m.test(svc), 'service: timeout, lock exit, memory cap');
  ok(/^ProtectSystem=strict$/m.test(svc) && /^NoNewPrivileges=yes$/m.test(svc) && /^ReadWritePaths=\/home\/deploy\/\.local\/state\/meta-ads-monitor$/m.test(svc), 'service: sandboxed, writes only its state dir');
  ok(/^OnCalendar=\*-\*-\* \d\d:\d\d:00 UTC$/m.test(tmr) && /^Persistent=true$/m.test(tmr), 'timer: daily, catches up after downtime');

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('meta-ads-monitor-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); fs.rmSync(TMP, { recursive: true, force: true }); process.exit(1); });
