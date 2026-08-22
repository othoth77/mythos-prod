'use strict';

// tests/backup-hardening-test.js — pins the security properties of the
// root-side backup capture step (ops/backup/mythos-backup-capture.sh) and its
// installer.
//
// These properties were added because the capture step runs as root while
// every input it reads lives under an unprivileged account. Each one is
// cheap to lose in a later edit and expensive to lose in production, so each
// is asserted here rather than left to review.
//
// Scope and honesty about it: the capture script refuses to run as non-root
// by design, so this suite does NOT execute the full pipeline. It (a) runs
// the pure emitters for real, (b) exercises the installer's validation block
// against real fixtures, and (c) asserts structurally that the guards are
// present and that the patterns they replaced have not come back. Where a
// case needs root to construct (a root-owned fixture), it is skipped and
// named rather than faked.

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var OPS = path.join(ROOT, 'ops', 'backup');
var CAPTURE = path.join(OPS, 'mythos-backup-capture.sh');
var INSTALL = path.join(OPS, 'install.sh');

var capture = fs.readFileSync(CAPTURE, 'utf8');
var install = fs.readFileSync(INSTALL, 'utf8');

var passed = 0, failed = 0, skipped = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function skip(name, why) { skipped++; console.log('  SKIP ' + name + ' — ' + why); }

function bash(script) {
  return cp.spawnSync('bash', ['-c', script], { encoding: 'utf8', timeout: 60000 });
}

// ---------------------------------------------------------------------------
console.log('§1 both scripts are syntactically valid');

['mythos-backup-capture.sh', 'install.sh'].forEach(function (f) {
  var r = cp.spawnSync('bash', ['-n', path.join(OPS, f)], { encoding: 'utf8' });
  check('bash -n clean: ' + f, r.status === 0, r.stderr);
});

// ---------------------------------------------------------------------------
console.log('§2 the config is data, never code (B1)');

// The regression this guards: `. "$CONFIG_FILE"` executed a deploy-writable
// file as root, which is a root shell for whoever can write that file.
check('config is never sourced with `.`',
  !/^\s*\.\s+"\$CONFIG_FILE"/m.test(capture));
check('config is never sourced with `source`',
  !/^\s*source\s+"\$CONFIG_FILE"/m.test(capture));
check('config is parsed as KEY=VALUE instead', /CONFIG_KEYS=/.test(capture));
check('unrecognised keys are refused', /unrecognised key/.test(capture));
check('values are charset-checked', /unacceptable characters/.test(capture));
check('config ownership is checked', /config must be owned by root or/.test(capture));
check('config symlinks are refused', /config must not be a symlink/.test(capture));
check('config write-permissions are checked', /config must not be group\/world-writable/.test(capture));

// ---------------------------------------------------------------------------
console.log('§3 root never runs a path or binary the config chose freely');

check('paths are allowlisted', /ALLOWED_ROOTS=/.test(capture));
check('allowlist is enforced by a function', /require_safe_path/.test(capture));
// Asserting the function merely EXISTS is not enough: dropping the call for a
// single path leaves the helper in place and the grep still green. Mutation
// testing caught exactly that — removing the ARCHIVE check, which gates the
// root-owned staging area, went unnoticed. Each config-supplied path is
// therefore pinned to its own call site.
['MYTHOS_BACKUP_DB_ARCHIVE', 'MYTHOS_BACKUP_MEDIA_SOURCE',
 'MYTHOS_BACKUP_MEDIA_DIR', 'MYTHOS_BACKUP_DB_DIR'].forEach(function (v) {
  check('allowlist is applied to ' + v,
    new RegExp('require_safe_path\\s+"' + v + '"').test(capture));
});
check('traversal is refused', /without '\.' or '\.\.'/.test(capture));
check('the docker CLI is resolved, not named by config',
  /command -v docker/.test(capture) && !/MYTHOS_BACKUP_DOCKER/.test(capture));
check('the resolved docker binary must be root-owned',
  /docker CLI must be owned by root/.test(capture));
check('the container name is shape-checked', /unacceptable container name/.test(capture));

// ---------------------------------------------------------------------------
console.log('§4 staging cannot be pre-seeded or redirected (N1)');

check('staging lives under the root-only archive',
  /STAGE_PARENT="\$ARCHIVE\/\.capture-staging"/.test(capture));
check('staging name is unpredictable (mktemp -d)',
  /mktemp -d "\$STAGE_PARENT\/set\./.test(capture));
check('the old pid-derived name is gone',
  !/SET_TMP="\$SET_DIR\.tmp\.\$\$"/.test(capture));
check('the archive must be root-owned before staging inside it',
  /archive must be owned by root/.test(capture));
check('the staging path is symlink-checked before install -d follows it',
  /staging parent must not be a symlink/.test(capture));
check('publication refuses a symlinked hand-off',
  /hand-off path is a symlink/.test(capture));
check('rotation uses mv -T so it replaces instead of nesting',
  /mv -T -- "\$SET_DIR" "\$SET_DIR\.prev"/.test(capture));
check('same-filesystem is asserted so the publish stays atomic',
  /different filesystems/.test(capture));

// ---------------------------------------------------------------------------
console.log('§5 manifest JSON is emitted, not concatenated (N3)');

check('a JSON string escaper exists', /json_str\(\)/.test(capture));
check('a JSON number guard exists', /json_int\(\)/.test(capture));
check('the escaper handles backslash and quote',
  /s="\$\{s\/\/\\\\\\\\\/\\\\\\\\\\\\\\\\\}"/.test(capture) || /json_str/.test(capture));
check('operator-supplied path goes through the escaper',
  /"storage_path": \$\(json_str "\$SRC"\)/.test(capture));
check('hostname goes through the escaper',
  /json_str "\$\(hostname\)"/.test(capture));
check('counts go through the number guard',
  /"file_count": \$\(json_int "\$OBJ_COUNT"\)/.test(capture));
check('the generated manifest is parse-checked before publication',
  /is not valid JSON/.test(capture));

// The escaper is pure, so run it for real.
var jsonProbe = cp.spawnSync('bash', ['-c',
  'set -uo pipefail; fail(){ exit 9; }; ' +
  'eval "$(sed -n \'/^json_str() {/,/^}/p;/^json_int() {/,/^}/p\' "$0")"; json_str "$1"',
  CAPTURE, 'probe'], { encoding: 'utf8' });
function escapeRoundTrip(value) {
  var r = cp.spawnSync('bash', ['-c',
    'set -uo pipefail; fail(){ exit 9; }; ' +
    'eval "$(sed -n \'/^json_str() {/,/^}/p;/^json_int() {/,/^}/p\' "$0")"; json_str "$1"',
    CAPTURE, value], { encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, why: 'emitter exited ' + r.status };
  try {
    var parsed = JSON.parse('{"v":' + r.stdout.trim() + '}');
    return { ok: parsed.v === value, why: JSON.stringify(parsed.v) };
  } catch (e) { return { ok: false, why: 'unparseable: ' + e.message }; }
}

check('emitter is runnable and emits a JSON string literal',
  jsonProbe.status === 0 && jsonProbe.stdout.trim() === '"probe"',
  'status=' + jsonProbe.status + ' out=' + JSON.stringify(jsonProbe.stdout));
[
  ['plain path', '/home/deploy/media'],
  ['double quote', 'a"b'],
  ['backslash', 'a\\b'],
  ['quote + backslash', '\\"'],
  ['JSON injection attempt', '","evil":"pwned'],
  ['braces', '{[]}'],
  ['tab', 'a\tb'],
  ['unicode', 'مسار/عربي']
].forEach(function (c) {
  var r = escapeRoundTrip(c[1]);
  check('escaped value round-trips through JSON.parse: ' + c[0], r.ok, r.why);
});

var injected = cp.spawnSync('bash', ['-c',
  'set -uo pipefail; fail(){ exit 9; }; ' +
  'eval "$(sed -n \'/^json_str() {/,/^}/p\' "$0")"; json_str "$1"',
  CAPTURE, '","evil":"pwned'], { encoding: 'utf8' });
var doc = JSON.parse('{"storage_path":' + injected.stdout.trim() + '}');
check('an injection attempt cannot create a second key', Object.keys(doc).length === 1,
  Object.keys(doc).join(','));

['x1', '', '1; rm -rf /'].forEach(function (bad) {
  var r = cp.spawnSync('bash', ['-c',
    'set -uo pipefail; fail(){ exit 9; }; ' +
    'eval "$(sed -n \'/^json_int() {/,/^}/p\' "$0")"; json_int "$1"',
    CAPTURE, bad], { encoding: 'utf8' });
  check('json_int fails closed on non-numeric input: ' + JSON.stringify(bad), r.status === 9);
});

// ---------------------------------------------------------------------------
console.log('§6 installer validates owner AND mode (N2)');

check('installer checks ownership, not only mode', /must be owned by \$OWNER_USER/.test(install));
check('installer checks group', /must have group \$OWNER_USER/.test(install));
check('installer still checks mode 0600', /must be mode 0600/.test(install));
check('installer refuses symlinked config or credential', /must not be a symlink/.test(install));
check('installer checks the containing directory too',
  /must not be group\/world-writable/.test(install));
check('the capture source may not be a symlink',
  /\$CAPTURE_SRC must not be a symlink/.test(install));

// Run the installer's validation block against real fixtures.
var work = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-backup-hardening-'));
function gate(dir) {
  return cp.spawnSync('bash', ['-c',
    'set -uo pipefail; CONFIG="$1"; CRED="$2"; OWNER_USER=' + JSON.stringify(process.env.USER || 'deploy') + '; ' +
    'eval "$(sed -n \'/^for f in "\\$CONFIG" "\\$CRED"; do$/,/^done$/p\' "$0")"; ' +
    'eval "$(sed -n \'/^for d in "\\$(dirname "\\$CONFIG")" "\\$(dirname "\\$CRED")"; do$/,/^done$/p\' "$0")"; ' +
    'echo VALIDATION_PASSED',
    INSTALL, path.join(dir, 'cfg.env'), path.join(dir, 'cred.env')],
    { encoding: 'utf8' });
}
function fixture(name, mode, dirMode) {
  var d = path.join(work, name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'cfg.env'), 'X=1\n', { mode: mode });
  fs.writeFileSync(path.join(d, 'cred.env'), 'Y=1\n', { mode: mode });
  fs.chmodSync(path.join(d, 'cfg.env'), mode);
  fs.chmodSync(path.join(d, 'cred.env'), mode);
  fs.chmodSync(d, dirMode);
  return d;
}

var good = fixture('good', 0o600, 0o700);
check('correct fixture (0600 in a 0700 dir) is accepted',
  /VALIDATION_PASSED/.test(gate(good).stdout || ''), (gate(good).stderr || '').trim());

var mode644 = fixture('mode644', 0o644, 0o700);
check('a 0644 config is refused', /must be mode 0600/.test(gate(mode644).stderr || ''));

var groupw = fixture('groupw', 0o660, 0o700);
check('a group-writable credential is refused', /must be mode 0600/.test(gate(groupw).stderr || ''));

var openDir = fixture('opendir', 0o600, 0o777);
check('a world-writable directory is refused',
  /must not be group\/world-writable/.test(gate(openDir).stderr || ''));

var linkDir = path.join(work, 'linked');
fs.mkdirSync(linkDir, { recursive: true });
fs.writeFileSync(path.join(linkDir, 'real.env'), 'X=1\n', { mode: 0o600 });
fs.symlinkSync(path.join(linkDir, 'real.env'), path.join(linkDir, 'cfg.env'));
fs.writeFileSync(path.join(linkDir, 'cred.env'), 'Y=1\n', { mode: 0o600 });
fs.chmodSync(linkDir, 0o700);
check('a symlinked config is refused', /must not be a symlink/.test(gate(linkDir).stderr || ''));

skip('wrong-owner fixture', 'constructing a root-owned file requires root; the ownership branch is asserted structurally above');

fs.rmSync(work, { recursive: true, force: true });

// ---------------------------------------------------------------------------
console.log('§7 the capture step stays inside its boundary');

check('it never reads the off-host credential file',
  !/idauto-offhost\.env/.test(capture));
check('it never uploads', !/(curl|wget|aws |s3:)/.test(capture));
check('database credentials are expanded inside the container, not on a command line',
  /sh -c 'pg_dump -U "\$POSTGRES_USER"/.test(capture));
check('no credential value pattern is embedded',
  !/AKIA[0-9A-Z]{16}/.test(capture) && !/SECRET_ACCESS_KEY\s*=\s*\S/.test(capture));
check('it refuses to run as non-root', /must run as root/.test(capture));
check('the dump is validated before it is trusted', /pg_restore --list/.test(capture));
check('no dump is ever deleted, only retired', /cannot retire previous dump/.test(capture));

console.log('\nbackup-hardening: ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exitCode = failed ? 1 : 0;
