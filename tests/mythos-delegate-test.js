'use strict';
// =====================================================
// MYTHOS V1 — delegation boundary tests
// tests/mythos-delegate-test.js
//
// Deterministic and offline. Verifies the MYTHOS side of the
// delegate-skills boundary: fail-closed config validation, the vendor
// registry mapping, and the mythos.delegate.result.v1 normalisation —
// including the two contract subtleties that matter operationally:
// `touchedFiles: null` (git could not report) is NOT the same as `[]`
// (clean tree), and a terminal `completed` with a non-zero exit code is
// NOT a success.
//
// No implementer CLI is invoked. No network. No credential.
//
// Run with: node tests/mythos-delegate-test.js
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }
function throws(fn, codeOrRe, l) {
  try { fn(); ok(false, l + ' (expected a throw)'); }
  catch (e) {
    var m = codeOrRe instanceof RegExp ? codeOrRe.test(e.message) : e.code === codeOrRe;
    ok(m, l + (m ? '' : ' (got: ' + e.code + ' / ' + e.message + ')'));
  }
}

var delegate = require(path.join(BASE, 'projects', 'mythos-delegate', 'lib', 'delegate.js'));

console.log('\n§1 config validation — fail closed');

var good = {
  enabled: true,
  vendor_root: '/home/deploy/delegate-skills',
  artifacts_root: '/home/deploy/mythos-ai-executor/delegate',
  default_timeout: '45m',
  description: 'x'
};
var v = delegate.validateConfigObject(good);
ok(v.enabled === true, 'a well-formed config validates');
ok(v.vendorRoot === '/home/deploy/delegate-skills', 'vendor_root is resolved');
ok(v.defaultTimeout === '45m', 'default_timeout is carried');

ok(delegate.validateConfigObject({ enabled: false }).enabled === false,
  'enabled:false needs no other field');

throws(function () { delegate.validateConfigObject(null); },
  'MYTHOS_DELEGATE_CONFIG', 'null is refused');
throws(function () { delegate.validateConfigObject([]); },
  'MYTHOS_DELEGATE_CONFIG', 'an array is refused');
throws(function () { delegate.validateConfigObject({ enabled: 'yes' }); },
  'MYTHOS_DELEGATE_CONFIG', 'a non-boolean enabled is refused');
throws(function () { delegate.validateConfigObject({ enabled: true, vendor_root: '/x', artifacts_root: '/y', extra: 1 }); },
  /unknown delegate config field/, 'an unknown field is refused (closed field set)');
throws(function () { delegate.validateConfigObject({ enabled: true, artifacts_root: '/y' }); },
  /vendor_root is required/, 'enabled without vendor_root is refused');
throws(function () { delegate.validateConfigObject({ enabled: true, vendor_root: '/x' }); },
  /artifacts_root is required/, 'enabled without artifacts_root is refused');

// The credential/endpoint tripwire, at depth.
throws(function () {
  delegate.validateConfigObject({ enabled: true, vendor_root: '/x', artifacts_root: '/y', api_key: 'k' });
}, /credential- or endpoint-shaped key/, 'a top-level api_key is refused');
throws(function () {
  delegate.validateConfigObject({ enabled: true, vendor_root: '/x', artifacts_root: '/y', description: 'd', nested: { deep: { webhook_url: 'https://x' } } });
}, /credential- or endpoint-shaped key/, 'a nested webhook_url is refused at depth');
throws(function () {
  delegate.validateConfigObject({ enabled: true, vendor_root: '/x', artifacts_root: '/y', token: 't' });
}, /credential- or endpoint-shaped key/, 'a token field is refused');

// A vendor or artifact tree inside the repository would reach Git history.
throws(function () {
  delegate.validateConfigObject({ enabled: true, vendor_root: path.join(BASE, 'vendor'), artifacts_root: '/y' });
}, /outside this repository/, 'vendor_root inside the repo is refused');
throws(function () {
  delegate.validateConfigObject({ enabled: true, vendor_root: '/x', artifacts_root: path.join(BASE, 'artifacts') });
}, /outside this repository/, 'artifacts_root inside the repo is refused');

console.log('\n§2 loadConfig never throws — a disabled layer is a normal state');

var missing = delegate.loadConfig(path.join(os.tmpdir(), 'mythos-delegate-absent-' + process.pid + '.json'));
ok(missing.enabled === false, 'an absent config disables the layer');
ok(/unreadable or malformed/.test(missing.reason), 'and reports why');

var badPath = path.join(os.tmpdir(), 'mythos-delegate-bad-' + process.pid + '.json');
fs.writeFileSync(badPath, '{ not json');
var bad = delegate.loadConfig(badPath);
ok(bad.enabled === false, 'malformed JSON disables the layer rather than throwing');
fs.unlinkSync(badPath);

var absentVendor = path.join(os.tmpdir(), 'mythos-delegate-nov-' + process.pid + '.json');
fs.writeFileSync(absentVendor, JSON.stringify({
  enabled: true,
  vendor_root: path.join(os.tmpdir(), 'no-such-vendor-' + process.pid),
  artifacts_root: path.join(os.tmpdir(), 'a-' + process.pid)
}));
var nov = delegate.loadConfig(absentVendor);
ok(nov.enabled === false, 'an uninstalled vendor tree disables the layer');
ok(/not installed/.test(nov.reason), 'and says so plainly');
fs.unlinkSync(absentVendor);

console.log('\n§3 vendor registry — no guessing');

ok(delegate.IMPLEMENTER_SKILL.claude === 'claude-delegate', 'claude maps to claude-delegate');
ok(delegate.IMPLEMENTER_SKILL.codex === 'codex-delegate', 'codex maps to codex-delegate');
ok(delegate.IMPLEMENTER_SKILL.opencode === 'opencode-delegate', 'opencode maps to opencode-delegate');
throws(function () {
  delegate.relayPathFor({ enabled: true, vendorRoot: '/x' }, 'not-a-real-implementer');
}, /unknown implementer/, 'an unregistered implementer is refused, never guessed');

console.log('\n§4 result normalisation — mythos.delegate.result.v1');

var completed = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'codex', status: 'completed', exitCode: 0,
  sessionId: 's-1', resultSubtype: 'success', finalMessage: 'done',
  touchedFiles: [' M app/x.js']
}, { lane: 'tests', implementer: 'codex', repo: '/r', outDir: '/o', startedAt: 'T0' });

ok(completed.schema === 'mythos.delegate.result.v1', 'result carries the MYTHOS schema');
ok(completed.vendor_schema === 'delegate-relay.result.v1', 'the vendor schema is preserved');
ok(completed.ok === true, 'completed + exit 0 is a success');
ok(completed.terminal === true, 'completed is terminal');
ok(completed.lane === 'tests' && completed.implementer === 'codex', 'lane and implementer are carried');
ok(completed.session_id === 's-1', 'sessionId is promoted for rework/resume');
ok(completed.vendor && completed.vendor.resultSubtype === 'success', 'the raw vendor result is preserved verbatim');
ok(Array.isArray(completed.touched_files) && completed.touched_files.length === 1, 'touchedFiles is carried');

// A terminal `completed` whose process exited non-zero is NOT a success.
var completedNonZero = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'completed', exitCode: 1
}, {});
ok(completedNonZero.ok === false, 'completed with a non-zero exit code is NOT a success');
ok(completedNonZero.terminal === true, 'but it is still terminal');

// null vs [] — the distinction the vendor contract makes explicit.
var gitBlind = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'completed', exitCode: 0, touchedFiles: null
}, {});
ok(gitBlind.touched_files === null, 'touchedFiles null (git could not report) is preserved as null');
var cleanTree = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'completed', exitCode: 0, touchedFiles: []
}, {});
ok(Array.isArray(cleanTree.touched_files) && cleanTree.touched_files.length === 0,
  'touchedFiles [] (clean tree) stays an empty array, never collapsed to null');

var failed = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'failed', exitCode: 1
}, {});
ok(failed.ok === false && failed.terminal === true, 'failed is terminal and not ok');

var unavailable = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'claude_unavailable', exitCode: 127
}, {});
ok(unavailable.terminal === true, 'a per-implementer *_unavailable status is recognised as terminal');
ok(unavailable.ok === false, 'and is not a success');

ok(delegate.isTerminal('timeout') === true, 'timeout is terminal');
ok(delegate.isTerminal('aborted') === true, 'aborted is terminal');
ok(delegate.isTerminal('codex_unavailable') === true, 'codex_unavailable is terminal');
ok(delegate.isTerminal('running') === false, 'a non-terminal status is not terminal');
ok(delegate.isTerminal(null) === false, 'a missing status is not terminal');

var readOnly = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'completed', exitCode: 0,
  readOnlyViolation: false
}, { readOnly: true });
ok(readOnly.read_only === true, 'a read-only dispatch is marked');
ok(readOnly.read_only_violation === false, 'readOnlyViolation false is carried (coverage complete, no change)');
var roUnknown = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'completed', exitCode: 0,
  readOnlyViolation: null
}, { readOnly: true });
ok(roUnknown.read_only_violation === null, 'readOnlyViolation null (incomplete coverage) stays null, not false');

console.log('\n§4b read-only authority — the vendor decides, not our request');

// Regression: a lane's `readOnly` dial enables read-only WITHOUT any flag
// from us. Reporting our own request here marked a genuinely restricted
// run as read_only:false — a safety-relevant field, wrong in the one
// direction that matters. Observed live on 2026-09-06 (lane `review`,
// vendor permissionMode `plan`, toolSurface Read/Glob/Grep).
var laneReadOnly = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'timeout', exitCode: 143,
  readOnly: true, readOnlyViolation: false, permissionMode: 'plan',
  lane: 'review', laneSource: 'global', timeout: '20m',
  error: 'claude did not finish within --timeout 20m; killed by the relay watchdog'
}, { lane: 'review', implementer: 'claude', readOnly: false });

ok(laneReadOnly.read_only === true,
  'a lane-enabled read-only run reports read_only:true even when we passed no flag');
ok(laneReadOnly.lane === 'review' && laneReadOnly.lane_source === 'global',
  'the vendor-resolved lane and its source are carried');
ok(laneReadOnly.status === 'timeout' && laneReadOnly.terminal === true && laneReadOnly.ok === false,
  'a watchdog timeout is terminal and is NOT a success');
ok(laneReadOnly.timeout === '20m', 'the deadline in force is promoted');
ok(/watchdog/.test(laneReadOnly.error || ''), 'the vendor error is promoted for failure recovery');

var noVendorReadOnly = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'codex', status: 'completed', exitCode: 0
}, { readOnly: true });
ok(noVendorReadOnly.read_only === true,
  'when the vendor is silent about readOnly, our own request is used as the fallback');

var writeRun = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'codex', status: 'completed', exitCode: 0, readOnly: false
}, { readOnly: true });
ok(writeRun.read_only === false,
  'the vendor overrides our request in BOTH directions — a write run is never reported read-only');

var noTail = delegate.normalizeResult({
  schema: 'delegate-relay.result.v1', tool: 'claude', status: 'failed', exitCode: 1, stderrTail: []
}, {});
ok(noTail.stderr_tail === null, 'an empty stderrTail is reported as null, not an empty array');

console.log('\n§4c status is read strictly, never coerced');

// Found by the delegated review on 2026-09-07 (lane `review`, session
// 3eea4947): `String(raw.status)` accepted any value that stringifies to
// a terminal word. dispatch() feeds normalizeResult straight from
// JSON.parse of the relay's result.json, so a malformed, truncated or
// schema-drifted file could turn ['completed'] into ok:true.
var coerced = delegate.normalizeResult({ status: ['completed'], exitCode: 0 }, {});
ok(coerced.ok === false, 'a non-string status that stringifies to "completed" is NOT a success');
ok(coerced.status === 'unknown', 'and is reported as unknown rather than coerced');
ok(coerced.terminal === false, 'and is not treated as terminal');

var objStatus = delegate.normalizeResult(
  { status: { toString: function () { return 'completed'; } }, exitCode: 0 }, {});
ok(objStatus.ok === false, 'an object with a matching toString is refused too');

ok(delegate.normalizeResult({ status: 'completed', exitCode: '0' }, {}).ok === false,
  'a string exit code is not zero — the exit check stays strict');
ok(delegate.normalizeResult({ status: 'completed' }, {}).ok === false,
  'a missing exit code is not a success');
ok(delegate.normalizeResult({ status: 'completed', exitCode: 0 }, {}).ok === true,
  'the genuine shape still succeeds');

console.log('\n§5 dispatch input guards');

var cfg = { enabled: true, vendorRoot: '/x', artifactsRoot: '/y' };
throws(function () { delegate.dispatch(cfg, {}); }, /lane is required/, 'dispatch needs a lane');
throws(function () { delegate.dispatch(cfg, { lane: 'a' }); }, /repo is required/, 'dispatch needs a repo');
throws(function () { delegate.dispatch(cfg, { lane: 'a', repo: '/tmp' }); }, /brief path is required/, 'dispatch needs a brief');
throws(function () { delegate.dispatch(cfg, { lane: 'a', repo: path.join(os.tmpdir(), 'no-such-repo-' + process.pid), brief: '/x' }); },
  /repo directory does not exist/, 'a missing repo is refused before any spawn');
throws(function () { delegate.dispatch({ enabled: false, reason: 'off' }, { lane: 'a', repo: '/tmp', brief: '/x' }); },
  /delegation layer disabled/, 'a disabled layer refuses to dispatch');

var emptyBrief = path.join(os.tmpdir(), 'mythos-empty-brief-' + process.pid + '.txt');
fs.writeFileSync(emptyBrief, '');
throws(function () { delegate.dispatch(cfg, { lane: 'a', repo: os.tmpdir(), brief: emptyBrief }); },
  /brief file is empty/, 'an empty brief is refused (an implementer with no brief is never dispatched)');
fs.unlinkSync(emptyBrief);

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
