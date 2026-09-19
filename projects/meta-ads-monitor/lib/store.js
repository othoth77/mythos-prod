'use strict';
// =====================================================
// Facebook Ads Monitor — runtime state (outside Git)
// projects/meta-ads-monitor/lib/store.js
//
//   <state>/snapshots/YYYY-MM-DDTHH-MM-SSZ.json   previous-run memory (no secrets)
//   <state>/reports/YYYY-MM-DD.md                 the daily report
//   <state>/status.json                           last run outcome (for health checks)
//   <state>/run.lock                              duplicate-run protection
// All writes are atomic (tmp + rename) and private (0600 files, 0700 dirs).
// Every payload passes secretScan() before it touches disk.
// =====================================================

var fs = require('fs');
var path = require('path');

var RETENTION = Object.freeze({
  snapshots: { maxAgeDays: 60, maxFiles: 200 },   // hourly runs → ~8 days; Ads Mythos keeps long history
  reports: { maxAgeDays: 90, maxFiles: 120 }
});

var LOCK_STALE_MS = 2 * 60 * 60 * 1000;
var SECRET_PATTERNS = [/EAA[A-Za-z0-9]{20,}/, /access_token=/i, /Bearer\s+[A-Za-z0-9._-]{20,}/];

function ensureDirs(root) {
  [root, path.join(root, 'snapshots'), path.join(root, 'reports')].forEach(function (d) {
    fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  });
}

function secretScan(text, token) {
  var s = String(text);
  if (token && s.indexOf(token) !== -1) return 'token value';
  for (var i = 0; i < SECRET_PATTERNS.length; i++) if (SECRET_PATTERNS[i].test(s)) return 'pattern ' + SECRET_PATTERNS[i];
  return null;
}

function atomicWrite(file, text, token) {
  var hit = secretScan(text, token);
  if (hit) { var e = new Error('refused to write ' + path.basename(file) + ': secret-like content (' + hit + ')'); e.code = 'SECRET_SCAN'; throw e; }
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function stamp(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-'); }

function listSorted(dir, re) {
  try { return fs.readdirSync(dir).filter(function (f) { return re.test(f); }).sort(); } catch (e) { return []; }
}

// Newest parseable snapshot; a corrupt file is skipped (and reported), never fatal.
function latestSnapshot(root) {
  var dir = path.join(root, 'snapshots');
  var files = listSorted(dir, /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/);
  var skipped = [];
  for (var i = files.length - 1; i >= 0; i--) {
    try {
      var j = JSON.parse(fs.readFileSync(path.join(dir, files[i]), 'utf8'));
      if (j && j.schema === 'meta-ads-monitor.snapshot.v1' && Array.isArray(j.accounts)) return { snapshot: j, file: files[i], skipped: skipped };
      skipped.push(files[i]);
    } catch (e) { skipped.push(files[i]); }
  }
  return { snapshot: null, file: null, skipped: skipped };
}

function writeSnapshot(root, snap, token, now) {
  var f = path.join(root, 'snapshots', stamp(now) + '.json');
  atomicWrite(f, JSON.stringify(snap, null, 1) + '\n', token);
  return f;
}

function writeReport(root, md, token, now) {
  var f = path.join(root, 'reports', now.toISOString().slice(0, 10) + '.md');
  atomicWrite(f, md, token);
  return f;
}

function readStatus(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8')); } catch (e) { return null; }
}

function writeStatus(root, st) { atomicWrite(path.join(root, 'status.json'), JSON.stringify(st, null, 1) + '\n'); }

function prune(dir, policy, now, re) {
  var files = listSorted(dir, re);
  var removed = [];
  var cutoff = now.getTime() - policy.maxAgeDays * 86400000;
  files.forEach(function (f, i) {
    var p = path.join(dir, f);
    var tooMany = files.length - i > policy.maxFiles;
    var tooOld = false;
    try { tooOld = fs.statSync(p).mtimeMs < cutoff; } catch (e) { return; }
    if (tooMany || tooOld) { try { fs.unlinkSync(p); removed.push(f); } catch (e) { /* next run retries */ } }
  });
  // leftover tmp files from an interrupted write
  listSorted(dir, /\.tmp-\d+$/).forEach(function (f) { try { fs.unlinkSync(path.join(dir, f)); removed.push(f); } catch (e) { /* ignore */ } });
  return removed;
}

function applyRetention(root, now) {
  return {
    snapshots: prune(path.join(root, 'snapshots'), RETENTION.snapshots, now, /\.json$/),
    reports: prune(path.join(root, 'reports'), RETENTION.reports, now, /\.md$/)
  };
}

function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

// acquireLock(root) → release() | null when another live run holds it.
function acquireLock(root, now) {
  var file = path.join(root, 'run.lock');
  for (var attempt = 0; attempt < 2; attempt++) {
    try {
      var fd = fs.openSync(file, 'wx', 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now.toISOString() }));
      fs.closeSync(fd);
      return function release() { try { fs.unlinkSync(file); } catch (e) { /* already gone */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      var holder = null;
      try { holder = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (x) { /* unreadable = stale */ }
      var stale = !holder || !pidAlive(holder.pid) || (now.getTime() - Date.parse(holder.at) > LOCK_STALE_MS);
      if (!stale) return null;
      // Reclaim by atomic rename: of two racing reclaimers only one rename
      // succeeds, so a fresh lock created meanwhile is never deleted.
      var grave = file + '.stale-' + process.pid;
      try { fs.renameSync(file, grave); } catch (x) { return null; }
      var moved = null;
      try { moved = JSON.parse(fs.readFileSync(grave, 'utf8')); } catch (x) { /* unreadable = was stale */ }
      if (moved && holder && moved.pid !== holder.pid) {
        try { fs.renameSync(grave, file); } catch (x) { /* ignore */ }
        return null;
      }
      try { fs.unlinkSync(grave); } catch (x) { /* ignore */ }
    }
  }
  return null;
}

module.exports = {
  RETENTION: RETENTION, ensureDirs: ensureDirs, secretScan: secretScan, latestSnapshot: latestSnapshot,
  writeSnapshot: writeSnapshot, writeReport: writeReport, readStatus: readStatus, writeStatus: writeStatus,
  applyRetention: applyRetention, acquireLock: acquireLock
};
