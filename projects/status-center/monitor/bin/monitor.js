'use strict';

// =====================================================
// MYTHOS STATUS CENTER — STC-2 live monitor collector
// projects/status-center/monitor/bin/monitor.js
//
// Turns the Status Center from a curated record into real monitoring:
// executes the probe registry (monitor/probes.json), computes LIVE /
// DEGRADED / DOWN / NOT_MONITORED states with latency, HTTP status,
// TLS-certificate days remaining and error detail, appends immutable
// JSONL history, records state-transition alerts, and atomically writes
// data/live-status.json for the site UI.
//
// SECURITY: read-only against every target (GET / TCP connect / local
// stat only); no credentials; no shell-out; writes only inside --out.
// A probe that cannot run is DOWN or NOT_MONITORED — never silent green.
//
// Usage: node monitor.js [--config <probes.json>] [--out <dir>] [--once]
// Exit codes: 0 ran and wrote output (whatever the states), 1 usage/env.
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var https = require('https');
var http = require('http');
var net = require('net');
var url = require('url');

var MONITOR_VERSION = '1.0.0';

function argv(name, dflt) {
  var i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function nowIso() { return new Date().toISOString(); }
function redact(s) {
  return String(s == null ? '' : s).replace(
    /(access[_ -]?key|secret|token|signature|credential|password)(\s*[=:]\s*)[^\s&,"]+/gi,
    '$1$2[REDACTED]'
  ).slice(0, 400);
}

// ── probe runners ──────────────────────────────────────────────────
function probeHttps(p, defaults) {
  return new Promise(function (resolve) {
    var started = Date.now();
    var parsed;
    try { parsed = new url.URL(p.url); } catch (e) {
      return resolve({ state: 'DOWN', error: 'invalid url: ' + p.url });
    }
    var mod = parsed.protocol === 'http:' ? http : https;
    var timeout = p.timeout_ms || defaults.timeout_ms || 10000;
    var req = mod.request(parsed, { method: 'GET' }, function (res) {
      var chunks = [];
      var certDays = null;
      var sock = res.socket;
      if (sock && typeof sock.getPeerCertificate === 'function') {
        try {
          var cert = sock.getPeerCertificate();
          if (cert && cert.valid_to) {
            certDays = Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86400000);
          }
        } catch (e) { /* certificate detail is best-effort */ }
      }
      res.on('data', function (c) { if (chunks.join('').length < 4096) chunks.push(c); });
      res.on('end', function () {
        var latency = Date.now() - started;
        var body = Buffer.concat(chunks.map(Buffer.from)).toString('utf8').slice(0, 4096);
        var expected = (p.expect_status || [200]).indexOf(res.statusCode) >= 0;
        var bodyOk = !p.expect_body_substring || body.indexOf(p.expect_body_substring) >= 0;
        var out = { latency_ms: latency, http_status: res.statusCode, cert_days_remaining: certDays };
        if (!expected) {
          out.state = 'DOWN';
          out.error = 'unexpected HTTP ' + res.statusCode + ' (expected ' + (p.expect_status || [200]).join('/') + ')';
        } else if (!bodyOk) {
          out.state = 'DOWN';
          out.error = 'expected body content missing: ' + p.expect_body_substring;
        } else if (certDays != null && certDays <= (defaults.cert_down_days || 7)) {
          out.state = 'DOWN';
          out.error = 'TLS certificate expires in ' + certDays + ' day(s)';
        } else if (certDays != null && certDays <= (defaults.cert_warn_days || 21)) {
          out.state = 'DEGRADED';
          out.error = 'TLS certificate expires in ' + certDays + ' day(s)';
        } else {
          out.state = 'LIVE';
        }
        resolve(out);
      });
    });
    req.setTimeout(timeout, function () {
      req.destroy(new Error('timeout after ' + timeout + 'ms'));
    });
    req.on('error', function (e) {
      resolve({ state: 'DOWN', latency_ms: Date.now() - started, error: redact(e.message) });
    });
    req.end();
  });
}

function probeTcp(p, defaults) {
  return new Promise(function (resolve) {
    var started = Date.now();
    var timeout = p.timeout_ms || defaults.timeout_ms || 10000;
    var sock = net.connect({ host: p.host, port: p.port });
    var done = false;
    function finish(state, err) {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ state: state, latency_ms: Date.now() - started, error: err || null });
    }
    sock.setTimeout(timeout, function () { finish('DOWN', 'tcp timeout after ' + timeout + 'ms'); });
    sock.on('connect', function () { finish('LIVE'); });
    sock.on('error', function (e) { finish('DOWN', redact(e.message)); });
  });
}

function probeResources(p) {
  // Local, read-only: statfs for disk, os.freemem for memory, loadavg.
  try {
    var out = { state: 'LIVE', detail: {} };
    var problems = [];
    var warns = [];
    var sfs = fs.statfsSync(p.disk_path || '/');
    var totalB = sfs.blocks * sfs.bsize;
    var freeB = sfs.bavail * sfs.bsize;
    var diskPct = totalB > 0 ? Math.round(100 * (1 - freeB / totalB)) : null;
    out.detail.disk_used_pct = diskPct;
    out.detail.disk_free_gb = Math.round(freeB / 1073741824 * 10) / 10;
    var memPct = Math.round(100 * (1 - os.freemem() / os.totalmem()));
    out.detail.mem_used_pct = memPct;
    out.detail.load_1m = Math.round(os.loadavg()[0] * 100) / 100;
    out.detail.cpus = os.cpus().length;
    // `||` would swallow an explicit 0: a threshold deliberately set to 0
    // means "always breach", and silently substituting the default turns a
    // configured alarm into silence. Only an absent threshold takes the default.
    var thr = function (v, dflt) { return typeof v === 'number' && isFinite(v) ? v : dflt; };
    if (diskPct != null && diskPct >= thr(p.disk_down_pct, 95)) problems.push('disk ' + diskPct + '% used');
    else if (diskPct != null && diskPct >= thr(p.disk_warn_pct, 85)) warns.push('disk ' + diskPct + '% used');
    if (memPct >= thr(p.mem_warn_pct, 92)) warns.push('memory ' + memPct + '% used');
    if (problems.length) { out.state = 'DOWN'; out.error = problems.join('; '); }
    else if (warns.length) { out.state = 'DEGRADED'; out.error = warns.join('; '); }
    return Promise.resolve(out);
  } catch (e) {
    return Promise.resolve({ state: 'DOWN', error: 'resource probe failed: ' + redact(e.message) });
  }
}

function probeBackupHealth(p) {
  // Consumes ops/backup health records. Missing record = DOWN by design.
  try {
    if (!fs.existsSync(p.file)) {
      return Promise.resolve({ state: 'DOWN', error: 'no backup health record at ' + p.file });
    }
    var h = JSON.parse(fs.readFileSync(p.file, 'utf8'));
    var lastSuccess = Date.parse(h.last_success_at || '');
    var ageH = isNaN(lastSuccess) ? Infinity : (Date.now() - lastSuccess) / 3600000;
    var out = {
      detail: {
        last_mode: h.mode,
        last_status: h.status,
        last_success_at: h.last_success_at || null,
        consecutive_failures: h.consecutive_failures,
        last_duration_s: h.duration_s
      }
    };
    if (ageH <= (p.fresh_hours || 26) && h.status === 'ok') out.state = 'LIVE';
    else if (ageH <= (p.degraded_hours || 50)) {
      out.state = 'DEGRADED';
      out.error = h.status === 'ok'
        ? 'last success ' + Math.round(ageH) + 'h ago'
        : 'last run failed (' + redact(h.error) + '); last success ' + Math.round(ageH) + 'h ago';
    } else {
      out.state = 'DOWN';
      out.error = isFinite(ageH)
        ? 'no successful backup for ' + Math.round(ageH) + 'h'
        : 'no successful backup ever recorded';
    }
    return Promise.resolve(out);
  } catch (e) {
    return Promise.resolve({ state: 'DOWN', error: 'unreadable health record: ' + redact(e.message) });
  }
}

function runProbe(p, defaults) {
  if (p.enabled === false) {
    return Promise.resolve({ state: 'NOT_MONITORED', error: null, note: p.note || null });
  }
  var exec;
  if (p.type === 'https') exec = probeHttps(p, defaults);
  else if (p.type === 'tcp') exec = probeTcp(p, defaults);
  else if (p.type === 'resources') exec = probeResources(p);
  else if (p.type === 'backup-health') exec = probeBackupHealth(p);
  else exec = Promise.resolve({ state: 'DOWN', error: 'unknown probe type: ' + p.type });
  return exec.then(function (r) {
    if (['LIVE', 'DEGRADED', 'DOWN', 'NOT_MONITORED'].indexOf(r.state) < 0) {
      r = { state: 'DOWN', error: 'probe returned invalid state' };
    }
    return r;
  }, function (e) {
    // A rejected probe is a DOWN result, never a crashed collector.
    return { state: 'DOWN', error: redact(e && e.message) };
  });
}

// ── persistence ────────────────────────────────────────────────────
function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function readPrevious(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function historyTail(histFile, id, cap) {
  // Last `cap` states for this check id from the current month's history.
  try {
    var lines = fs.readFileSync(histFile, 'utf8').trim().split('\n');
    var out = [];
    for (var i = lines.length - 1; i >= 0 && out.length < cap; i--) {
      try {
        var row = JSON.parse(lines[i]);
        var c = (row.checks || []).find(function (x) { return x.id === id; });
        if (c) out.unshift({ at: row.generated_at, state: c.state, latency_ms: c.latency_ms == null ? null : c.latency_ms });
      } catch (e) { /* skip torn line */ }
    }
    return out;
  } catch (e) { return []; }
}

function collect(configPath, outDir) {
  var cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  var defaults = cfg.defaults || {};
  var liveFile = path.join(outDir, 'live-status.json');
  var month = nowIso().slice(0, 7);
  var histFile = path.join(outDir, 'live-history', month + '.jsonl');
  var alertFile = path.join(outDir, 'live-history', 'alerts.jsonl');
  var previous = readPrevious(liveFile);

  return Promise.all((cfg.probes || []).map(function (p) {
    var at = nowIso();
    return runProbe(p, defaults).then(function (r) {
      return {
        id: p.id, name: p.name, type: p.type,
        target: p.url || (p.host ? p.host + ':' + p.port : p.file || p.disk_path || 'local'),
        state: r.state,
        latency_ms: r.latency_ms == null ? null : r.latency_ms,
        http_status: r.http_status == null ? null : r.http_status,
        cert_days_remaining: r.cert_days_remaining == null ? null : r.cert_days_remaining,
        checked_at: at,
        error: r.error || null,
        detail: r.detail || null,
        note: p.note || null
      };
    });
  })).then(function (checks) {
    // History first (immutable, append-only), then the live document.
    appendJsonl(histFile, {
      generated_at: nowIso(),
      checks: checks.map(function (c) {
        return { id: c.id, state: c.state, latency_ms: c.latency_ms, http_status: c.http_status };
      })
    });
    // State-transition alerts (failure detection): any check whose state
    // differs from the previously published state is recorded.
    if (previous && previous.checks) {
      checks.forEach(function (c) {
        var prev = previous.checks.find(function (x) { return x.id === c.id; });
        if (prev && prev.state !== c.state) {
          appendJsonl(alertFile, {
            at: c.checked_at, id: c.id, name: c.name,
            from: prev.state, to: c.state, error: c.error
          });
        }
      });
    }
    var summary = { LIVE: 0, DEGRADED: 0, DOWN: 0, NOT_MONITORED: 0 };
    checks.forEach(function (c) {
      summary[c.state]++;
      c.history_tail = historyTail(histFile, c.id, 12);
    });
    var doc = {
      schema_version: '1.0.0',
      monitor_version: MONITOR_VERSION,
      generated_at: nowIso(),
      host: os.hostname(),
      interval_note: 'written by the mythos-status-monitor timer; a stale generated_at means the monitor itself is down',
      summary: summary,
      checks: checks
    };
    atomicWrite(liveFile, JSON.stringify(doc, null, 2) + '\n');
    return doc;
  });
}

function main() {
  var configPath = argv('config', path.join(__dirname, '..', 'probes.json'));
  var outDir = argv('out', path.resolve(__dirname, '../../../../sites/status.mythosprod.xyz/data'));
  var run;
  try { run = collect(configPath, outDir); }
  catch (e) {
    process.stderr.write('ERROR: cannot read probe config ' + configPath + ': ' + e.message + '\n');
    process.exitCode = 1;
    return;
  }
  run.then(function (doc) {
    process.stdout.write('live-status written: ' + path.join(outDir, 'live-status.json') + ' — ' +
      doc.checks.map(function (c) { return c.id + '=' + c.state; }).join(' ') + '\n');
  }).catch(function (e) {
    process.stderr.write('ERROR: monitor run failed: ' + redact(e && e.message) + '\n');
    process.exitCode = 1;
  });
}

if (require.main === module) main();

module.exports = {
  collect: collect,
  runProbe: runProbe,
  probeBackupHealth: probeBackupHealth,
  probeResources: probeResources,
  historyTail: historyTail,
  MONITOR_VERSION: MONITOR_VERSION
};
