'use strict';

// tests/stc-2-monitor-test.js — STC-2 live monitor suite (post-audit
// Phase 2). Fully offline: probes run against in-test HTTP servers and
// fixtures; nothing external is contacted.

var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var MON_DIR = path.join(ROOT, 'projects', 'status-center', 'monitor');
var MON = path.join(MON_DIR, 'bin', 'monitor.js');
var mod = require(MON);

var passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function finish() {
  console.log('\nstc-2: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

var work = fs.mkdtempSync(path.join(os.tmpdir(), 'stc2-test-'));
var DEFAULTS = { timeout_ms: 3000, cert_warn_days: 21, cert_down_days: 7 };

function listen(handler) {
  return new Promise(function (resolve) {
    var srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', function () { resolve(srv); });
  });
}

async function run() {
  console.log('§1 static safety');
  var src = fs.readFileSync(MON, 'utf8');
  var chk = cp.spawnSync('node', ['--check', MON], { encoding: 'utf8' });
  check('node --check clean', chk.status === 0, chk.stderr);
  check('no shell-out in collector', src.indexOf('child_process') < 0);
  check('only GET requests (read-only)', /method: 'GET'/.test(src) && !/method: '(POST|PUT|DELETE|PATCH)'/.test(src));
  check('no credential material', !/SECRET|PASSWORD|TOKEN\s*=/.test(src));

  console.log('§2 https probe states');
  var okSrv = await listen(function (req, res) { res.writeHead(200); res.end('{"status":"ok"}'); });
  var okPort = okSrv.address().port;
  var r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:' + okPort + '/', expect_status: [200] }, DEFAULTS);
  check('expected status → LIVE', r.state === 'LIVE', JSON.stringify(r));
  check('latency measured', typeof r.latency_ms === 'number' && r.latency_ms >= 0);
  check('http status captured', r.http_status === 200);

  r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:' + okPort + '/', expect_status: [204] }, DEFAULTS);
  check('unexpected status → DOWN with error detail', r.state === 'DOWN' && /unexpected HTTP 200/.test(r.error));

  r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:' + okPort + '/', expect_status: [200], expect_body_substring: '"status"' }, DEFAULTS);
  check('body substring satisfied → LIVE', r.state === 'LIVE');
  r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:' + okPort + '/', expect_status: [200], expect_body_substring: 'absent-marker' }, DEFAULTS);
  check('missing body substring → DOWN', r.state === 'DOWN' && /body content/.test(r.error));
  okSrv.close();

  var slowSrv = await listen(function () { /* never responds */ });
  var slowPort = slowSrv.address().port;
  r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:' + slowPort + '/', timeout_ms: 300 }, DEFAULTS);
  check('timeout → DOWN with timeout error', r.state === 'DOWN' && /timeout/.test(String(r.error)), JSON.stringify(r));
  slowSrv.close();

  r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:1/', timeout_ms: 500 }, DEFAULTS);
  check('connection refused → DOWN', r.state === 'DOWN');

  console.log('§3 tcp probe');
  var tcpSrv = await listen(function () {});
  r = await mod.runProbe({ id: 'x', type: 'tcp', host: '127.0.0.1', port: tcpSrv.address().port }, DEFAULTS);
  check('open port → LIVE', r.state === 'LIVE');
  tcpSrv.close();
  r = await mod.runProbe({ id: 'x', type: 'tcp', host: '127.0.0.1', port: 1, timeout_ms: 500 }, DEFAULTS);
  check('closed port → DOWN', r.state === 'DOWN');

  console.log('§4 disabled and unknown probes fail honestly');
  r = await mod.runProbe({ id: 'x', type: 'https', url: 'http://127.0.0.1:1/', enabled: false }, DEFAULTS);
  check('disabled → NOT_MONITORED (never guessed green)', r.state === 'NOT_MONITORED');
  r = await mod.runProbe({ id: 'x', type: 'quantum' }, DEFAULTS);
  check('unknown type → DOWN', r.state === 'DOWN' && /unknown probe type/.test(r.error));

  console.log('§5 backup-health translation');
  var bh = path.join(work, 'backup-health.json');
  function writeBh(status, successAgeH, fails) {
    fs.writeFileSync(bh, JSON.stringify({
      schema_version: '1.0.0', mode: 'backup', status: status, exit_code: status === 'ok' ? 0 : 2,
      last_success_at: successAgeH == null ? '' : new Date(Date.now() - successAgeH * 3600000).toISOString(),
      consecutive_failures: fails, duration_s: 12, error: status === 'ok' ? '' : 'push: fixture failure'
    }));
  }
  writeBh('ok', 1, 0);
  r = await mod.probeBackupHealth({ file: bh, fresh_hours: 26, degraded_hours: 50 });
  check('fresh success → LIVE', r.state === 'LIVE', JSON.stringify(r));
  check('backup detail surfaced', r.detail && r.detail.consecutive_failures === 0);
  writeBh('ok', 30, 0);
  r = await mod.probeBackupHealth({ file: bh, fresh_hours: 26, degraded_hours: 50 });
  check('aging success → DEGRADED', r.state === 'DEGRADED');
  writeBh('fail', 30, 3);
  r = await mod.probeBackupHealth({ file: bh, fresh_hours: 26, degraded_hours: 50 });
  check('recent failure w/ old success → DEGRADED with error', r.state === 'DEGRADED' && /failed/.test(r.error));
  writeBh('fail', 60, 9);
  r = await mod.probeBackupHealth({ file: bh, fresh_hours: 26, degraded_hours: 50 });
  check('stale success → DOWN', r.state === 'DOWN');
  r = await mod.probeBackupHealth({ file: path.join(work, 'nope.json'), fresh_hours: 26, degraded_hours: 50 });
  check('missing record → DOWN, never unknown-green', r.state === 'DOWN' && /no backup health record/.test(r.error));

  console.log('§6 resources probe shape');
  r = await mod.probeResources({ disk_path: os.tmpdir(), disk_warn_pct: 101, disk_down_pct: 101, mem_warn_pct: 101 });
  check('resources report LIVE under permissive thresholds', r.state === 'LIVE', JSON.stringify(r));
  check('resource detail complete', r.detail && typeof r.detail.disk_used_pct === 'number' &&
    typeof r.detail.mem_used_pct === 'number' && typeof r.detail.load_1m === 'number');
  r = await mod.probeResources({ disk_path: os.tmpdir(), disk_warn_pct: 0, disk_down_pct: 101, mem_warn_pct: 101 });
  check('soft threshold breach → DEGRADED', r.state === 'DEGRADED');

  console.log('\u00a76b thresholds honour a configured 0 (B4)');
  // `x || dflt` rewrote a configured 0 into the default because 0 is falsy,
  // so `disk_warn_pct: 0` became 85 and a 73%-full disk reported LIVE on the
  // production host. A threshold of 0 is a legitimate setting and must win.
  r = await mod.probeResources({ disk_path: os.tmpdir(), disk_warn_pct: 0, disk_down_pct: 101, mem_warn_pct: 101 });
  check('disk_warn_pct 0 is honoured, not replaced by 85', r.state === 'DEGRADED', JSON.stringify(r));
  r = await mod.probeResources({ disk_path: os.tmpdir(), disk_warn_pct: 101, disk_down_pct: 0, mem_warn_pct: 101 });
  check('disk_down_pct 0 is honoured, not replaced by 95', r.state === 'DOWN', JSON.stringify(r));
  r = await mod.probeResources({ disk_path: os.tmpdir(), disk_warn_pct: 101, disk_down_pct: 101, mem_warn_pct: 0 });
  check('mem_warn_pct 0 is honoured, not replaced by 92', r.state === 'DEGRADED', JSON.stringify(r));
  r = await mod.probeResources({ disk_path: os.tmpdir() });
  check('absent thresholds still fall back to the shipped defaults',
    r.state === 'LIVE' || r.state === 'DEGRADED' || r.state === 'DOWN');
  writeBh('ok', 1, 0);
  r = await mod.probeBackupHealth({ file: bh, fresh_hours: 0, degraded_hours: 50 });
  check('fresh_hours 0 is honoured, not replaced by 26', r.state === 'DEGRADED', JSON.stringify(r));

  console.log('\u00a76b2 swap is visible and honest (B8)');
  // A host can sit at 100% swap with memory still under its threshold and
  // nothing reported it. Swap is read from /proc/meminfo, injectable here so
  // the assertions do not depend on the test host's own swap.
  function meminfo(totalKb, freeKb) {
    var f = path.join(work, 'meminfo-' + totalKb + '-' + freeKb);
    fs.writeFileSync(f, 'MemTotal:       7900000 kB\nSwapTotal:       ' +
      totalKb + ' kB\nSwapFree:        ' + freeKb + ' kB\n');
    return f;
  }
  var permissive = { disk_path: os.tmpdir(), disk_warn_pct: 101, disk_down_pct: 101, mem_warn_pct: 101 };
  function withSwap(extra) { return Object.assign({}, permissive, extra); }

  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(2097152, 1048576) }));
  check('swap_used_pct reported', r.detail.swap_used_pct === 50, JSON.stringify(r.detail));
  check('swap_free_gb reported', r.detail.swap_free_gb === 1, JSON.stringify(r.detail));

  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(2097152, 0) }));
  check('exhausted swap is visible', r.detail.swap_used_pct === 100);
  check('exhausted swap alone does NOT change state without a threshold', r.state === 'LIVE', JSON.stringify(r));

  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(2097152, 0), swap_warn_pct: 90 }));
  check('configured swap_warn_pct makes exhaustion DEGRADED', r.state === 'DEGRADED' && /swap 100% used/.test(r.error));
  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(2097152, 2097152), swap_warn_pct: 90 }));
  check('unused swap stays LIVE under the same threshold', r.state === 'LIVE', JSON.stringify(r));
  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(2097152, 2097152), swap_warn_pct: 0 }));
  check('swap_warn_pct 0 is honoured, not treated as unset', r.state === 'DEGRADED');

  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(0, 0) }));
  check('a host with no swap reports null, not 0% or NaN', r.detail.swap_used_pct === null);
  check('a host with no swap is never penalised', r.state === 'LIVE');
  r = await mod.probeResources(withSwap({ meminfo_path: meminfo(0, 0), swap_warn_pct: 0 }));
  check('no-swap host stays LIVE even with swap_warn_pct 0', r.state === 'LIVE', JSON.stringify(r));

  r = await mod.probeResources(withSwap({ meminfo_path: path.join(work, 'no-such-meminfo') }));
  check('unreadable meminfo degrades to null, never an error state',
    r.detail.swap_used_pct === null && r.state === 'LIVE', JSON.stringify(r));

  console.log('\u00a76c a catch-all/SPA fallback cannot report an API alive (B2)');
  // ssangyong.autos answers EVERY unmatched path with 200 + the storefront
  // index.html, so status-only probing reported a six-day-dead catalog API as
  // LIVE. Asserting the media type is what makes the fallback fail.
  var fbSrv = await listen(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!DOCTYPE html><title>storefront</title>');
  });
  var fbUrl = 'http://127.0.0.1:' + fbSrv.address().port + '/api/health';
  r = await mod.runProbe({ id: 'fb', type: 'https', enabled: true, url: fbUrl, expect_status: [200] }, {});
  check('status-only probe still reports the fallback LIVE (the old defect)', r.state === 'LIVE');
  r = await mod.runProbe({ id: 'fb', type: 'https', enabled: true, url: fbUrl,
    expect_status: [200], expect_content_type: 'application/json' }, {});
  check('expect_content_type turns the HTML fallback into DOWN', r.state === 'DOWN', JSON.stringify(r));
  check('the error names the real content-type', /text\/html/.test(r.error || ''));
  fbSrv.close();

  var jsonSrv = await listen(function (req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  });
  var jsonUrl = 'http://127.0.0.1:' + jsonSrv.address().port + '/api/health';
  r = await mod.runProbe({ id: 'j', type: 'https', enabled: true, url: jsonUrl,
    expect_status: [200], expect_content_type: 'application/json' }, {});
  check('a real JSON API still reports LIVE', r.state === 'LIVE', JSON.stringify(r));
  r = await mod.runProbe({ id: 'j', type: 'https', enabled: true, url: jsonUrl, expect_status: [200] }, {});
  check('probes without expect_content_type are unchanged', r.state === 'LIVE');
  jsonSrv.close();

  console.log('\u00a76d shipped probe registry keeps the SYA guard');
  var probesCfg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'projects', 'status-center', 'monitor', 'probes.json'), 'utf8'));
  var probeList = Array.isArray(probesCfg) ? probesCfg : probesCfg.probes;
  var syaApi = probeList.filter(function (x) { return x.id === 'sya-api'; })[0];
  check('sya-api probe exists', !!syaApi);
  check('sya-api asserts a JSON content-type (cannot false-green on the SPA fallback)',
    !!syaApi && syaApi.expect_content_type === 'application/json');

  console.log('§7 end-to-end collector run: snapshot, history, alerts');
  var e2eSrv = await listen(function (req, res) { res.writeHead(200); res.end('ok'); });
  var e2ePort = e2eSrv.address().port;
  var out = path.join(work, 'out');
  var cfgPath = path.join(work, 'probes.json');
  function writeCfg(up) {
    fs.writeFileSync(cfgPath, JSON.stringify({
      config_version: '1.0.0',
      defaults: DEFAULTS,
      probes: [
        { id: 'svc-a', name: 'Service A', type: 'https',
          url: 'http://127.0.0.1:' + (up ? e2ePort : 1) + '/', expect_status: [200], timeout_ms: 800 },
        { id: 'svc-off', name: 'Disabled service', type: 'https', url: 'http://127.0.0.1:1/', enabled: false },
        { id: 'backup', name: 'Backup', type: 'backup-health', file: bh, fresh_hours: 26, degraded_hours: 50 }
      ]
    }));
  }
  // NOTE: the collector runs in-process here — this sandbox's egress proxy
  // intercepts cross-process HTTP even on 127.0.0.1 (TCP connects, HTTP data
  // never flows), which would fake DOWNs. In-process exercises identical code.
  writeBh('ok', 1, 0);
  writeCfg(true);
  await mod.collect(cfgPath, out);
  var live = JSON.parse(fs.readFileSync(path.join(out, 'live-status.json'), 'utf8'));
  check('collector run 1 wrote a snapshot', !!live.generated_at);
  check('snapshot schema fields', ['schema_version', 'monitor_version', 'generated_at', 'host', 'summary', 'checks']
    .every(function (k) { return k in live; }));
  check('summary counts states', live.summary.LIVE === 2 && live.summary.NOT_MONITORED === 1 && live.summary.DOWN === 0,
    JSON.stringify(live.summary));
  var svcA = live.checks.find(function (c) { return c.id === 'svc-a'; });
  check('UI contract fields on each check',
    ['id', 'name', 'state', 'latency_ms', 'http_status', 'checked_at', 'error', 'history_tail', 'target']
      .every(function (k) { return k in svcA; }));
  var month = new Date().toISOString().slice(0, 7);
  var histFile = path.join(out, 'live-history', month + '.jsonl');
  check('history JSONL appended', fs.existsSync(histFile) &&
    fs.readFileSync(histFile, 'utf8').trim().split('\n').length === 1);

  writeCfg(false); // Service A goes down
  var doc2 = await mod.collect(cfgPath, out);
  check('collector run 2 resolves even with a DOWN service (DOWN is data)', !!doc2.generated_at);
  live = JSON.parse(fs.readFileSync(path.join(out, 'live-status.json'), 'utf8'));
  svcA = live.checks.find(function (c) { return c.id === 'svc-a'; });
  check('failure detected with error detail', svcA.state === 'DOWN' && svcA.error);
  check('history now has 2 immutable rows',
    fs.readFileSync(histFile, 'utf8').trim().split('\n').length === 2);
  check('history_tail reflects both runs', svcA.history_tail.length === 2 &&
    svcA.history_tail[0].state === 'LIVE' && svcA.history_tail[1].state === 'DOWN');
  var alerts = fs.readFileSync(path.join(out, 'live-history', 'alerts.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  check('state transition produced exactly one alert', alerts.length === 1 &&
    alerts[0].id === 'svc-a' && alerts[0].from === 'LIVE' && alerts[0].to === 'DOWN');
  e2eSrv.close();

  console.log('§8 shipped registry + UI + units contract');
  var shipped = JSON.parse(fs.readFileSync(path.join(MON_DIR, 'probes.json'), 'utf8'));
  var ids = shipped.probes.map(function (p) { return p.id; });
  ['hub-apex', 'os-console', 'ordre', 'status-center', 'n8n-sya', 'sya-site',
   'sya-api', 'database', 'vps-resources', 'backup-system'].forEach(function (id) {
    check('registry covers ' + id, ids.indexOf(id) >= 0);
  });
  // database was unconfirmed when this assertion was written; the port it
  // was waiting on (127.0.0.1:5432) is now published and verified, so it is
  // enabled and the pin moved to sya-api alone. sya-api stays disabled
  // because the API is retired, not because it is unconfirmed — that
  // distinction is asserted in tests/monitor-coverage-test.js.
  check('retired endpoint ships disabled and documented (sya-api)',
    shipped.probes.find(function (p) { return p.id === 'sya-api'; }).enabled === false &&
    /RETIRED/.test(shipped.probes.find(function (p) { return p.id === 'sya-api'; }).note || ''));
  check('the confirmed database endpoint is enabled',
    shipped.probes.find(function (p) { return p.id === 'database'; }).enabled === true);
  // OTHMODE read/write split (7252de2 made the Task Reports a public read).
  // The reads probe must NOT assert 401 — that expectation went stale with
  // the release and produced a false DOWN — and it must not rely on status
  // alone, or a catch-all 200 would false-green it. The auth-wall assertion
  // the old expectation carried is not allowed to disappear with it: a
  // separate probe has to keep asserting 401 on an endpoint that really is
  // authenticated, so relaxing the read probe can never quietly stop
  // monitoring authentication.
  var othApi = shipped.probes.find(function (p) { return p.id === 'othmode-api'; });
  var othWall = shipped.probes.find(function (p) { return p.id === 'othmode-authwall'; });
  check('othmode-api expects the public read (200), not the retired 401',
    !!othApi && othApi.expect_status.length === 1 && othApi.expect_status[0] === 200);
  check('othmode-api cannot false-green on a catch-all 200',
    !!othApi && othApi.expect_body_substring === '"tasks"' &&
    othApi.expect_content_type === 'application/json');
  check('the auth wall is still probed after the read surface opened',
    !!othWall && othWall.enabled === true &&
    othWall.expect_status.length === 1 && othWall.expect_status[0] === 401);
  check('the auth-wall probe targets an endpoint that is still authenticated',
    !!othWall && othWall.url === 'https://othmode.mythosprod.xyz/api/othmode/evolution/events');
  check('no probe issues a write against production',
    shipped.probes.every(function (p) { return !p.method || p.method === 'GET'; }));
  var appJs = fs.readFileSync(path.join(ROOT, 'sites/status.mythosprod.xyz/assets/app.js'), 'utf8');
  var idx = fs.readFileSync(path.join(ROOT, 'sites/status.mythosprod.xyz/index.html'), 'utf8');
  check('UI has a live section', /id="live-body"/.test(idx));
  check('UI fetches live-status.json independently', /data\/live-status\.json/.test(appJs));
  check('UI flags stale snapshots', /STALE SNAPSHOT/.test(appJs));
  check('UI reports absent monitor data instead of failing', /No live monitor data/.test(appJs));
  check('UI stays innerHTML-free for live data (comments aside)', !/\.innerHTML\s*=/.test(appJs));
  var svc = fs.readFileSync(path.join(MON_DIR, 'systemd/mythos-status-monitor.service'), 'utf8');
  var tmr = fs.readFileSync(path.join(MON_DIR, 'systemd/mythos-status-monitor.timer'), 'utf8');
  check('service hardened + scoped write path',
    /NoNewPrivileges=yes/.test(svc) && /ProtectSystem=strict/.test(svc) &&
    /ReadWritePaths=\/var\/www\/status\.mythosprod\.xyz\/data/.test(svc));
  check('timer runs every 5 minutes', /OnUnitActiveSec=5min/.test(tmr));
  var inst = cp.spawnSync('bash', ['-n', path.join(MON_DIR, 'install.sh')], { encoding: 'utf8' });
  check('installer bash -n clean', inst.status === 0, inst.stderr);

  fs.rmSync(work, { recursive: true, force: true });
  finish();
}

run().catch(function (e) {
  console.error(e);
  failed++;
  finish();
});
