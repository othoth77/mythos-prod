'use strict';
// =====================================================
// MYTHOS Guardian — disk domain and SAFE cleanup
// ops/guardian/lib/disk.js
//
// Thresholds: < warning NORMAL, ≥ warning WARNING (report only), ≥ high
// HIGH (allowlisted cleanup), ≥ critical CRITICAL, ≥ emergency EMERGENCY.
//
// CLEANUP IS DEFINED IN CODE, NOT CONFIG. Every target id, path, command
// argv and removal rule lives in TARGETS below; config.json can only enable
// an id and tune its min_level / min_age_days. Config cannot introduce a
// new path or a new command. On top of that, every path candidate must:
//   1. resolve inside ALLOWED_ROOTS with no symlink component (realpath ==
//      path) and not be a symlink itself
//   2. be owned by the expected uid
//   3. not be in use (no /proc/*/exe, cwd, fd or maps entry inside it)
//   4. not contain or be a mount point
//   5. not sit under PROTECTED_PREFIXES (production, repos, deployments)
//   6. not match PROTECTED_NAME_RE anywhere in its tree (backups, dumps,
//      .git, .env, keys, credentials) — trees too large to scan fully are
//      skipped unless the target's content is known opaque (npm cache …)
//   7. have its size recorded   8. carry a reason
//   9. be removed               10. have its result recorded
// =====================================================

var path = require('path');
var levels = require('./levels');

var ALLOWED_ROOTS = [
  '/root/.npm',
  '/opt/mythos-gh-runner',
  '/root/.vscode-server/cli/servers',
  '/tmp/claude-0',
  '/root/.claude/remote/ccd-cli'
];

var PROTECTED_PREFIXES = [
  '/etc', '/usr', '/boot', '/bin', '/sbin', '/lib', '/lib64', '/srv',
  '/var/lib/docker', '/var/lib/containerd', '/var/lib/postgresql', '/var/lib/mysql',
  '/var/backups', '/var/www', '/var/lib/mythos', '/var/lib/mythos-session-guard', '/var/lib/mythos-guardian',
  '/home/deploy/projects', '/home/deploy/deployments', '/home/deploy/worktrees',
  '/home/deploy/mythos-backups', '/home/deploy/backups', '/root/backups',
  '/root/.ssh', '/home/deploy/.ssh', '/root/.config', '/root/.claude/projects',
  '/opt/mythos-gh-runner/_work', '/opt/mythos-gh-runner/.credentials', '/opt/mythos-gh-runner/.runner'
];

var PROTECTED_NAME_RE = /(^|\/)(\.git|\.env[^/]*|\.ssh|\.credentials[^/]*|\.runner|id_(rsa|ed25519|ecdsa)[^/]*|[^/]*\.(pem|key|p12|pfx|kdbx)|[^/]*credential[^/]*|[^/]*secret[^/]*|[^/]*backup[^/]*|[^/]*\.(sql|dump)(\.gz|\.zst)?)$/i;

var TARGETS = {
  'npm-cache-root': {
    kind: 'path', path: '/root/.npm/_cacache', owner_uid: 0, min_level: 'HIGH', opaque: true,
    reason: 'npm content cache: regenerated on demand, never referenced by a running service'
  },
  'runner-diag-old': {
    kind: 'children', root: '/opt/mythos-gh-runner/_diag', owner_user: 'mythos-runner', name_re: /^[A-Za-z_]+_\d{8}-\d{6}-utc\.log$/,
    files_only: true, min_age_days: 14, min_level: 'HIGH',
    reason: 'GitHub runner diagnostic logs older than the retention window'
  },
  'runner-old-versions': {
    kind: 'versions', root: '/opt/mythos-gh-runner', owner_user: 'mythos-runner', name_re: /^(bin|externals)\.\d+\.\d+\.\d+$/,
    keep_symlink_targets: ['bin', 'externals'], min_level: 'HIGH', opaque: true,
    reason: 'superseded GitHub runner version not referenced by the bin/externals symlinks'
  },
  'vscode-server-old': {
    kind: 'versions', root: '/root/.vscode-server/cli/servers', owner_uid: 0, name_re: /^Stable-[0-9a-f]{40}$/,
    keep_newest: 1, min_level: 'HIGH', opaque: true,
    reason: 'VS Code server build older than the newest installed one and not in use'
  },
  'ccd-cli-old-versions': {
    kind: 'versions', root: '/root/.claude/remote/ccd-cli', owner_uid: 0, name_re: /^\d+\.\d+\.\d+$/,
    keep_newest: 1, min_level: 'CRITICAL', opaque: true, semver: true,
    reason: 'Claude Desktop Remote CLI version no running session executes'
  },
  'claude-scratch-old': {
    kind: 'children', root: '/tmp/claude-0/-root', owner_uid: 0, name_re: /^[0-9a-f-]{36}$/,
    dirs_only: true, min_age_days: 7, min_level: 'CRITICAL',
    reason: 'agent session scratchpad untouched for the retention window'
  },
  'docker-build-cache': {
    kind: 'command', argv: ['docker', 'builder', 'prune', '-f', '--filter', 'until=168h'], marker: 'docker-cleanup',
    min_level: 'HIGH', reason: 'Docker build cache older than 7 days (no active build uses it)'
  },
  'docker-dangling-images': {
    kind: 'command', argv: ['docker', 'image', 'prune', '-f', '--filter', 'until=168h'], marker: 'docker-cleanup',
    min_level: 'CRITICAL', reason: 'dangling (untagged, unreferenced by any container) images older than 7 days; never -a'
  },
  'journal-vacuum': {
    kind: 'command', argv: ['journalctl', '--vacuum-size=300M'], marker: 'disk-emergency',
    min_level: 'EMERGENCY', reason: 'shrink the journal below its 500M cap to protect filesystem availability (OOM evidence captured first)'
  }
};

function thresholdLevel(pct, t) {
  if (typeof pct !== 'number') return 'NORMAL';
  if (pct >= t.emergency_pct) return 'EMERGENCY';
  if (pct >= t.critical_pct) return 'CRITICAL';
  if (pct >= t.high_pct) return 'HIGH';
  if (pct >= t.warning_pct) return 'WARNING';
  return 'NORMAL';
}

function collect(cfg, io) {
  var s = io.statfs(cfg.path || '/');
  var m = { path: cfg.path || '/', readable: !!s };
  if (s) {
    var total = s.blocks * s.bsize;
    var avail = s.bavail * s.bsize;
    var used = (s.blocks - s.bfree) * s.bsize;
    m.used_pct = total > 0 ? Math.round(1000 * used / (used + avail)) / 10 : null;
    m.free_gb = Math.round(avail / 1073741824 * 10) / 10;
    m.inode_used_pct = s.files > 0 ? Math.round(1000 * (s.files - s.ffree) / s.files) / 10 : null;
  }
  return m;
}

function classify(m, cfg, prev, ctx) {
  var findings = [];
  if (!m.readable) {
    return { raw: 'NORMAL', immediate: false, findings: [{ severity: 'WARNING', kind: 'disk_unreadable', trigger: 'statfs failed on ' + m.path }], plan: [], stateOut: prev || {}, summary: m };
  }
  var t = cfg.thresholds;
  var raw = levels.max(thresholdLevel(m.used_pct, t), thresholdLevel(m.inode_used_pct, cfg.inode_thresholds || t));
  if (levels.rank(raw) >= levels.rank('WARNING')) {
    findings.push({
      severity: raw, kind: 'disk_pressure',
      trigger: 'filesystem ' + m.path + ' ' + m.used_pct + ' % used, ' + m.free_gb + ' GB free, inodes ' + m.inode_used_pct + ' %',
      evidence: m
    });
  }
  return {
    raw: raw,
    immediate: raw === 'EMERGENCY',
    findings: findings,
    plan: [],
    stateOut: prev || {},
    summary: m
  };
}

// --- cleanup verification ------------------------------------------------

function uidOf(io, user) {
  var passwd = io.readFile('/etc/passwd') || '';
  var line = passwd.split('\n').filter(function (l) { return l.split(':')[0] === user; })[0];
  return line ? parseInt(line.split(':')[2], 10) : null;
}

function under(p, prefix) {
  return p === prefix || p.indexOf(prefix + '/') === 0;
}

// Paths any process is using, gathered once per cleanup pass.
function inUseIndex(io, procList) {
  var paths = [];
  (procList || []).forEach(function (pr) {
    var dir = path.join(io.procRoot, String(pr.pid));
    ['exe', 'cwd', 'root'].forEach(function (l) { var t = io.readlink(path.join(dir, l)); if (t && t !== '/') paths.push(t.replace(/ \(deleted\)$/, '')); });
    var fds = io.readdir(path.join(dir, 'fd')) || [];
    for (var i = 0; i < fds.length && i < 4096; i++) {
      var t = io.readlink(path.join(dir, 'fd', fds[i]));
      if (t && t[0] === '/') paths.push(t.replace(/ \(deleted\)$/, ''));
    }
    var maps = io.readFile(path.join(dir, 'maps'));
    if (maps) {
      maps.split('\n').forEach(function (line) {
        var idx = line.indexOf(' /');
        if (idx >= 0) paths.push(line.slice(idx + 1).replace(/ \(deleted\)$/, '').trim());
      });
    }
  });
  return paths;
}

function mountPoints(io) {
  var text = io.readFile(path.join(io.procRoot, 'self', 'mountinfo')) || '';
  return text.split('\n').map(function (l) { return l.split(' ')[4]; }).filter(Boolean);
}

// Bounded tree walk: size + protected-name scan. Never follows symlinks.
function walk(io, root, limits) {
  var res = { bytes: 0, entries: 0, truncated: false, protected_hit: null, newest_mtime_ms: 0 };
  var stack = [root];
  var deadline = Date.now() + (limits.time_ms || 3000);
  while (stack.length) {
    if (res.entries >= limits.max_entries || Date.now() > deadline) { res.truncated = true; break; }
    var p = stack.pop();
    var st = io.lstat(p);
    if (!st) continue;
    res.entries += 1;
    res.bytes += st.size || 0;
    if (st.mtimeMs > res.newest_mtime_ms) res.newest_mtime_ms = st.mtimeMs;
    if (p !== root && PROTECTED_NAME_RE.test(path.basename(p)) && !res.protected_hit) res.protected_hit = p;
    if (st.isDirectory && st.isDirectory()) {
      var kids = io.readdir(p) || [];
      for (var i = 0; i < kids.length; i++) stack.push(path.join(p, kids[i]));
    }
  }
  return res;
}

function verifyPath(io, target, p, env) {
  var checks = [];
  function add(name, ok, detail) { checks.push({ step: name, ok: !!ok, detail: detail || null }); return !!ok; }
  var norm = path.normalize(p);
  var allowed = ALLOWED_ROOTS.some(function (r) { return under(norm, r) && norm !== r; });
  var real = io.realpath(norm);
  var st = io.lstat(norm);
  var pathOk = add('1_path', allowed && norm === p && real === norm && st && !(st.isSymbolicLink && st.isSymbolicLink()),
    !allowed ? 'outside allowed roots' : (real !== norm ? 'symlink in path or missing' : null));
  var expectUid = target.owner_uid !== undefined ? target.owner_uid : uidOf(io, target.owner_user);
  add('2_owner', st && expectUid !== null && st.uid === expectUid, st ? 'uid ' + st.uid + ' expected ' + expectUid : 'missing');
  var busy = pathOk ? env.inUse.filter(function (u) { return under(u, norm); }) : ['unverified'];
  add('3_not_in_use', busy.length === 0, busy.length ? busy.slice(0, 3).join(', ') : null);
  var mounts = env.mounts.filter(function (mp) { return under(mp, norm) || (under(norm, mp) && mp !== '/' && ALLOWED_ROOTS.indexOf(mp) < 0 && mp !== '/tmp'); });
  add('4_not_mounted', env.mounts.filter(function (mp) { return under(mp, norm); }).length === 0, mounts.length ? mounts.join(', ') : null);
  var prot = PROTECTED_PREFIXES.filter(function (pp) { return under(norm, pp); });
  add('5_not_production', prot.length === 0, prot.join(', ') || null);
  var w = pathOk ? walk(io, norm, { max_entries: target.opaque ? 400000 : 20000, time_ms: target.opaque ? 8000 : 3000 }) : { truncated: true, protected_hit: null, bytes: 0, newest_mtime_ms: 0 };
  var nameHit = PROTECTED_NAME_RE.test(path.basename(norm)) ? norm : w.protected_hit;
  var scanOk = !nameHit && (!w.truncated || target.opaque);
  add('6_not_backup_or_secret', scanOk, nameHit ? 'protected name: ' + nameHit : (w.truncated && !target.opaque ? 'tree too large to verify' : null));
  if (target.min_age_days) {
    var ageDays = (env.nowMs - w.newest_mtime_ms) / 86400000;
    add('age', ageDays >= target.min_age_days, 'newest entry ' + Math.floor(ageDays) + ' d old, need ' + target.min_age_days);
  }
  return { path: norm, ok: checks.every(function (c) { return c.ok; }), checks: checks, size_bytes: w.bytes, size_truncated: !!w.truncated };
}

function semverCmp(a, b) {
  var x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (var i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] - y[i]; }
  return 0;
}

function candidates(io, id, target, env) {
  if (target.kind === 'path') return io.exists(target.path) ? [target.path] : [];
  var kids = (io.readdir(target.root) || []).filter(function (n) { return target.name_re.test(n); });
  if (target.kind === 'children') {
    return kids.map(function (n) { return path.join(target.root, n); }).filter(function (p) {
      var st = io.lstat(p);
      if (!st) return false;
      if (target.files_only && !(st.isFile && st.isFile())) return false;
      // A file's own mtime is its newest entry: too-young files are not candidates at all.
      if (target.files_only && target.min_age_days && env && env.nowMs - st.mtimeMs < target.min_age_days * 86400000) return false;
      if (target.dirs_only && !(st.isDirectory && st.isDirectory())) return false;
      return true;
    });
  }
  if (target.kind === 'versions') {
    var keep = {};
    (target.keep_symlink_targets || []).forEach(function (l) {
      var t = io.readlink(path.join(target.root, l));
      if (t) keep[path.basename(t)] = true;
    });
    if (target.keep_symlink_targets && Object.keys(keep).length < target.keep_symlink_targets.length) return [];  // cannot prove which is live
    var sorted = kids.slice();
    if (target.semver) sorted.sort(semverCmp);
    else sorted.sort(function (a, b) { return (io.lstat(path.join(target.root, a)) || {}).mtimeMs - (io.lstat(path.join(target.root, b)) || {}).mtimeMs; });
    sorted.slice(-(target.keep_newest || 0)).forEach(function (n) { if (target.keep_newest) keep[n] = true; });
    return sorted.filter(function (n) { return !keep[n]; }).map(function (n) { return path.join(target.root, n); });
  }
  return [];
}

// Plans cleanup for a CONFIRMED disk level. Pure w.r.t. mutation: it only
// reads. Returns plan items; guardian.js decides whether each may run.
function planCleanup(io, cfg, confirmedLevel, prevState, env) {
  var plan = [];
  var enabled = cfg.cleanup || {};
  Object.keys(TARGETS).forEach(function (id) {
    var tune = enabled[id];
    if (!tune || tune.enabled !== true) return;
    var target = Object.assign({}, TARGETS[id]);
    if (levels.isLevel(tune.min_level) && levels.rank(tune.min_level) >= levels.rank(TARGETS[id].min_level)) target.min_level = tune.min_level;
    if (typeof tune.min_age_days === 'number' && tune.min_age_days >= (TARGETS[id].min_age_days || 0)) target.min_age_days = tune.min_age_days;
    if (levels.rank(confirmedLevel) < levels.rank(target.min_level)) return;
    var item = {
      id: 'disk:' + id, domain: 'disk', target_id: id, reason: target.reason, min_level: target.min_level,
      marker: target.marker || 'disk-cleanup', cooldown_minutes: tune.cooldown_minutes || cfg.cleanup_cooldown_minutes || 360
    };
    if (target.kind === 'command') {
      item.kind = 'command';
      item.argv = target.argv.slice();
      plan.push(item);
      return;
    }
    item.kind = 'remove-paths';
    item.paths = candidates(io, id, target, env).map(function (p) { return verifyPath(io, target, p, env); });
    item.removable = item.paths.filter(function (v) { return v.ok; });
    item.protected = item.paths.filter(function (v) { return !v.ok; });
    item.expected_reclaim_bytes = item.removable.reduce(function (a, v) { return a + v.size_bytes; }, 0);
    if (item.paths.length) plan.push(item);
  });
  return plan;
}

function verificationEnv(io, procList, nowMs) {
  return { inUse: inUseIndex(io, procList), mounts: mountPoints(io), nowMs: nowMs };
}

module.exports = {
  TARGETS: TARGETS,
  ALLOWED_ROOTS: ALLOWED_ROOTS,
  PROTECTED_PREFIXES: PROTECTED_PREFIXES,
  PROTECTED_NAME_RE: PROTECTED_NAME_RE,
  thresholdLevel: thresholdLevel,
  collect: collect,
  classify: classify,
  planCleanup: planCleanup,
  verifyPath: verifyPath,
  verificationEnv: verificationEnv,
  candidates: candidates
};
