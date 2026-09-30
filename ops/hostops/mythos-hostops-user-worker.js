#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — mythos-hostops user worker (HostOps v0.2)
// ops/hostops/mythos-hostops-user-worker.js
//   → installed as /usr/local/lib/mythos-hostops/user-worker.js (0755 root:root)
//
// The EXECUTION half of a deploy-scoped HostOps operation. The root helper
// (/usr/local/sbin/mythos-hostops) decides — catalog, tier, arguments, hard
// invariants, intent audit, backups, rollback — and then asks THIS program
// to touch deploy-owned state. It is never run as root:
//
//   root helper ──systemd-run --user (as deploy)──▶ this worker (uid deploy)
//
// so every file it writes and every `systemctl --user` it runs happens with
// exactly deploy's own privileges, inside deploy's own user manager, never
// with root's. That is the point: a root process writing into a directory
// that deploy controls is the classic symlink/TOCTOU escalation, and it is
// structurally impossible here because root never performs the write.
//
// Running this file directly as deploy grants nothing deploy does not
// already have; that is why it may be world-readable. It enforces a few
// mechanical rules of its own (refuses uid 0, refuses symlinks and
// non-regular targets, compare-and-swap writes, argv character net) as
// defence in depth — the POLICY lives in the helper.
//
// Protocol: one JSON object on stdin, one JSON object on stdout, exit 0
// whenever a JSON answer was written (ok true or false), 2 on bad input.
//   {action:'file-read',    path}
//   {action:'file-replace', path, content, expect_sha256}
//   {action:'systemctl',    args:[...]}              → /usr/bin/systemctl --user <args>
//   {action:'unit-env',     unit}                    → the unit's effective Environment=
//   {action:'run',          bin, argv:[...], env:{}} → /usr/bin/node <bin> <argv> (fixed env)
// =====================================================

var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var crypto = require('crypto');

var SYSTEMCTL = '/usr/bin/systemctl';
var NODE = '/usr/bin/node';
var MAX_INPUT = 256 * 1024;
var MAX_FILE = 64 * 1024;
var ARG_RE = /^[A-Za-z0-9@._=:,+\/-]{1,200}$/;
var ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,80}$/;

function answer(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); process.exit(0); }
function refuse(code, message) { answer({ ok: false, code: code, error: message }); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

if (typeof process.getuid === 'function' && process.getuid() === 0) {
  process.stdout.write(JSON.stringify({ ok: false, code: 'WORKER_ROOT_REFUSED', error: 'the user worker never runs as root' }) + '\n');
  process.exit(2);
}

function readStdin() {
  var chunks = [], total = 0, fd = 0, buf = Buffer.alloc(65536), n;
  for (;;) {
    try { n = fs.readSync(fd, buf, 0, buf.length, null); } catch (e) { if (e.code === 'EAGAIN') continue; if (e.code === 'EOF') break; throw e; }
    if (!n) break;
    total += n;
    if (total > MAX_INPUT) { process.stdout.write(JSON.stringify({ ok: false, code: 'WORKER_INPUT', error: 'request too large' }) + '\n'); process.exit(2); }
    chunks.push(Buffer.from(buf.slice(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

var req;
try { req = JSON.parse(readStdin()); } catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: 'WORKER_INPUT', error: 'request is not JSON' }) + '\n');
  process.exit(2);
}
if (!req || typeof req !== 'object' || typeof req.action !== 'string') {
  process.stdout.write(JSON.stringify({ ok: false, code: 'WORKER_INPUT', error: 'missing action' }) + '\n');
  process.exit(2);
}

function safePath(p) {
  return typeof p === 'string' && path.isAbsolute(p) && path.normalize(p) === p && p.indexOf('..') === -1 && p.length < 512;
}

// A regular, non-symlink file whose parent is a real directory (not a
// symlink either). Returns the lstat or refuses.
function checkTarget(p) {
  if (!safePath(p)) refuse('WORKER_PATH', 'path is not an absolute normalised path');
  var dir = path.dirname(p), dst;
  try { dst = fs.lstatSync(dir); } catch (e) { refuse('WORKER_PATH', 'parent directory missing'); }
  if (dst.isSymbolicLink() || !dst.isDirectory()) refuse('WORKER_PATH', 'parent is not a real directory');
  var st;
  try { st = fs.lstatSync(p); } catch (e) { return null; }
  if (st.isSymbolicLink()) refuse('WORKER_SYMLINK', 'target is a symlink; refusing to follow it');
  if (!st.isFile()) refuse('WORKER_PATH', 'target is not a regular file');
  if (st.size > MAX_FILE) refuse('WORKER_PATH', 'target is larger than the worker limit');
  return st;
}

function userEnv() {
  var uid = process.getuid();
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: process.env.HOME || '/home/deploy', LANG: 'C.UTF-8',
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || ('/run/user/' + uid),
    DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || ('unix:path=/run/user/' + uid + '/bus')
  };
}

// `systemctl show -p Environment --value` prints one line of space-separated
// KEY=VALUE words; a value containing spaces is double-quoted with C-style
// escapes. Parsed without eval, quote-aware.
function parseEnvLine(line) {
  var out = {}, i = 0, s = String(line || '').trim();
  while (i < s.length) {
    while (s[i] === ' ') i++;
    var word = '', quoted = false;
    while (i < s.length && (quoted || s[i] !== ' ')) {
      if (s[i] === '"') { quoted = !quoted; i++; continue; }
      if (s[i] === '\\' && i + 1 < s.length) { word += s[i + 1]; i += 2; continue; }
      word += s[i++];
    }
    var eq = word.indexOf('=');
    if (eq > 0 && ENV_NAME_RE.test(word.slice(0, eq))) out[word.slice(0, eq)] = word.slice(eq + 1);
  }
  return out;
}

// The helper sends `systemctl_bin` only in its dev/test mode (never when it
// runs under the daemon); it cannot widen anything — this process only ever
// holds the caller's own (deploy) privileges.
function systemctl(args, timeoutMs) {
  var bin = safePath(req.systemctl_bin) ? req.systemctl_bin : SYSTEMCTL;
  return cp.spawnSync(bin, ['--user'].concat(args), { encoding: 'utf8', timeout: timeoutMs || 30000, env: userEnv(), maxBuffer: 1024 * 1024 });
}

var A = {
  'file-read': function () {
    var st = checkTarget(req.path);
    if (!st) answer({ ok: true, exists: false, uid: process.getuid() });
    var content = fs.readFileSync(req.path, 'utf8');
    answer({ ok: true, exists: true, content: content, sha256: sha256(content), mode: st.mode & 511, owner_uid: st.uid, uid: process.getuid() });
  },

  // Compare-and-swap: the file must still hold exactly what the helper read
  // (expect_sha256), so a concurrent edit is never silently overwritten.
  // Written to a same-directory temp file (O_EXCL), fsync'd, renamed over.
  'file-replace': function () {
    if (typeof req.content !== 'string' || req.content.length > MAX_FILE) refuse('WORKER_INPUT', 'content missing or too large');
    if (!/^[0-9a-f]{64}$/.test(String(req.expect_sha256))) refuse('WORKER_INPUT', 'expect_sha256 missing');
    var st = checkTarget(req.path);
    if (!st) refuse('WORKER_PATH', 'target does not exist (the worker never creates files)');
    var current = fs.readFileSync(req.path, 'utf8');
    if (sha256(current) !== req.expect_sha256) refuse('WORKER_CONFLICT', 'target changed since it was read; nothing written');
    var tmp = path.join(path.dirname(req.path), '.hostops-' + crypto.randomBytes(6).toString('hex') + '.tmp');
    var fd = fs.openSync(tmp, 'wx', st.mode & 511);
    try {
      fs.writeSync(fd, req.content);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    try { fs.renameSync(tmp, req.path); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* gone */ } throw e; }
    answer({ ok: true, sha256: sha256(req.content), uid: process.getuid() });
  },

  'systemctl': function () {
    if (!Array.isArray(req.args) || !req.args.length || req.args.length > 8) refuse('WORKER_INPUT', 'args must be a short array');
    req.args.forEach(function (a) { if (typeof a !== 'string' || !ARG_RE.test(a)) refuse('WORKER_INPUT', 'systemctl argument fails the character net'); });
    var r = systemctl(req.args, req.timeout_ms);
    answer({ ok: !r.error, status: r.status, stdout: String(r.stdout || '').slice(0, 65536), stderr: String(r.stderr || '').slice(0, 4096), error: r.error ? r.error.message : null, uid: process.getuid() });
  },

  'unit-env': function () {
    if (typeof req.unit !== 'string' || !/^[a-z0-9@._-]{1,64}\.(service|timer)$/.test(req.unit)) refuse('WORKER_INPUT', 'invalid unit');
    var r = systemctl(['show', req.unit, '-p', 'Environment', '--value']);
    if (r.error || r.status !== 0) refuse('WORKER_EXEC', 'systemctl show failed: ' + String(r.stderr || (r.error && r.error.message) || '').slice(0, 200));
    answer({ ok: true, env: parseEnvLine(r.stdout), uid: process.getuid() });
  },

  'run': function () {
    if (!safePath(req.bin)) refuse('WORKER_INPUT', 'bin must be an absolute normalised path');
    if (!Array.isArray(req.argv) || req.argv.length > 8) refuse('WORKER_INPUT', 'argv must be a short array');
    req.argv.forEach(function (a) { if (typeof a !== 'string' || !ARG_RE.test(a)) refuse('WORKER_INPUT', 'argv fails the character net'); });
    var env = userEnv();
    Object.keys(req.env || {}).forEach(function (k) {
      if (ENV_NAME_RE.test(k) && typeof req.env[k] === 'string' && req.env[k].length < 1024) env[k] = req.env[k];
    });
    var r = cp.spawnSync(NODE, [req.bin].concat(req.argv), { encoding: 'utf8', timeout: req.timeout_ms || 30000, env: env, cwd: env.HOME, maxBuffer: 2 * 1024 * 1024 });
    answer({ ok: !r.error, status: r.status, signal: r.signal || null, stdout: String(r.stdout || '').slice(0, 262144), stderr: String(r.stderr || '').slice(0, 4096), error: r.error ? r.error.message : null, uid: process.getuid() });
  }
};

if (!A[req.action]) refuse('WORKER_UNKNOWN_ACTION', 'unknown action');
try { A[req.action](); } catch (e) { refuse('WORKER_EXEC', String((e && e.message) || e).slice(0, 300)); }

