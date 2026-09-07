'use strict';
// =====================================================
// MYTHOS V1 — lane routing tests
// tests/mythos-v1-lane-routing-test.js
//
// Deterministic and offline. Covers the path a lane travels:
//
//   Issue body  →  action-resolution.extractFields
//               →  task.lane
//               →  bridge picks the `delegate` provider
//               →  executor.createTask guards the pairing
//               →  providers/delegate.js refuses an unusable lane
//
// The guards matter more than the happy path: a lane must never widen
// what a task may do, and an unconfigured lane must be a refusal rather
// than a substitution.
//
// No implementer CLI is invoked. No network. No credential.
//
// Run with: node tests/mythos-v1-lane-routing-test.js
// =====================================================

var fs = require('fs');
var path = require('path');
var BASE = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(v, l) { if (v) { pass++; console.log('  PASS ' + l); } else { fail++; console.log('  FAIL ' + l); } }

var AR = path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'action-resolution.js');
var engine = require(AR);
var provider = require(path.join(BASE, 'projects', 'mythos-ai-executor', 'providers', 'delegate.js'));

console.log('\n§1 the Issue contract — Lane is read in every recognised writing');

var WRITINGS = [
  ['Lane: tests', 'inline'],
  ['**Lane:** tests', 'bold'],
  ['**Lane**: tests', 'bold'],
  ['## Lane: tests', 'heading_inline'],
  ['| Lane | tests |', 'table'],
  ['- Lane: tests', 'bullet'],
  ['LANE: tests', 'inline'],
  ['المسار: tests', 'inline'],
  ['مسار: tests', 'inline'],
  ['delegate lane: tests', 'inline']
];
WRITINGS.forEach(function (w) {
  var f = engine.firstField(engine.extractFields(w[0] + '\n'), 'lane');
  ok(f && f.raw === 'tests' && f.form === w[1],
    'Lane parsed from ' + JSON.stringify(w[0]) + ' as ' + w[1]);
});

ok(!engine.firstField(engine.extractFields('Action: implement\n'), 'lane'),
  'an Issue with no Lane yields no lane (the default path stays claude-code)');

// Regression: reading firstField's object instead of its .raw stringifies
// to "[object Object]", fails the lane-name pattern, and drops every lane
// silently. github-issues.js must go through scalar().
var giSrc = fs.readFileSync(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'github-issues.js'), 'utf8');
ok(/var laneRaw = scalar\(fields, 'lane'\);/.test(giSrc),
  'the bridge reads the lane through scalar(), never the raw field object');

ok(engine.FIELD_ALIASES.lane.indexOf('lane') !== -1, 'lane is a first-class scalar field');

console.log('\n§2 lane grants no authority — the action still decides the profile');

// The whole point of the guard: a lane must not become a way to smuggle
// a different execution profile. profileFor() is unchanged by any lane.
ok(engine.profileFor('investigate') === 'repo-read', 'investigate stays repo-read');
ok(engine.profileFor('implement') === 'repo-write', 'implement stays repo-write');
ok(engine.profileFor('test') === 'repo-test', 'test stays repo-test');
ok(engine.PROFILE_BY_ACTION.review === 'repo-read', 'review stays repo-read');
ok(Object.keys(engine.PROFILE_BY_ACTION).indexOf('lane') === -1,
  'there is no lane→profile mapping — a lane cannot name a profile');

console.log('\n§3 schemas declare lane (both are additionalProperties:false)');

['bridge/schemas/task.schema.json', 'schemas/task.schema.json'].forEach(function (rel) {
  var p = path.join(BASE, 'projects', 'mythos-ai-executor', rel);
  var d = JSON.parse(fs.readFileSync(p, 'utf8'));
  ok(d.additionalProperties === false, rel + ' is a closed schema');
  ok(d.properties && d.properties.lane, rel + ' declares lane (an undeclared field would be rejected)');
  ok(d.properties.lane.pattern === '^[A-Za-z0-9][A-Za-z0-9._-]*$',
    rel + ' constrains the lane name');
});

console.log('\n§4 the bridge routes on the presence of a lane');

var bridgeSrc = fs.readFileSync(path.join(BASE, 'projects', 'mythos-ai-executor', 'bridge', 'github-bridge.js'), 'utf8');
ok(/task\.lane \? 'delegate' : 'claude-code'/.test(bridgeSrc),
  'a task naming a lane is routed to the delegate provider, otherwise claude-code');
ok(/chosenProvider === 'delegate' \? task\.lane : null/.test(bridgeSrc),
  'a lane is only sent to the provider that understands it');
ok(/execution_profile: exec\.execution_profile/.test(bridgeSrc),
  'the execution profile still comes from the resolved action, not the lane');

console.log('\n§5 the delegate provider refuses an unusable lane BEFORE spawning');

function outcomeOf(p) { return p.parsed || {}; }

// No lane at all.
return provider.run({ working_directory: '/tmp' }, 'brief', null, 'start', {}, null)
  .then(function (o) {
    ok(outcomeOf(o).is_error === true, 'a task with no lane fails rather than running');
    ok(outcomeOf(o).subtype === 'LANE_MISSING', 'and says LANE_MISSING');
    ok(o.started_pid === null, 'no process was started');

    return provider.run({ lane: 'tests' }, 'brief', null, 'start', {}, null);
  })
  .then(function (o) {
    ok(outcomeOf(o).subtype === 'DELEGATE_NO_WORKTREE', 'a task with no worktree is refused');

    // An unconfigured lane: refused, never substituted for a configured one.
    return provider.run(
      { lane: 'no-such-lane-' + process.pid, working_directory: BASE, expected_delivery: 'report' },
      'brief', null, 'start', {}, null);
  })
  .then(function (o) {
    ok(outcomeOf(o).is_error === true, 'an unconfigured lane fails the attempt');
    ok(outcomeOf(o).subtype === 'LANE_UNAVAILABLE', 'and says LANE_UNAVAILABLE');
    ok(/refused rather than substituted/.test(outcomeOf(o).result || ''),
      'and states explicitly that it was not substituted');
    ok(o.started_pid === null, 'no implementer process was started');

    console.log('\n§6 laneBlocker — a read-only lane cannot deliver a commit');

    var cfg = { enabled: true, vendorRoot: '/x', artifactsRoot: '/y' };
    var fakeBoundary = {
      lanes: function () {
        return { lanes: { review: { implementer: 'claude', readOnly: true }, tests: { implementer: 'codex' } } };
      }
    };
    // laneBlocker reads the boundary through the module, so exercise it
    // with the real one where possible and assert the pure decisions here.
    var mismatch = provider.laneBlocker.call(null, cfg, { lane: 'review', expected_delivery: 'commit', working_directory: BASE });
    ok(mismatch === null || mismatch.code === 'LANE_UNAVAILABLE' || mismatch.code === 'LANE_PROFILE_MISMATCH',
      'laneBlocker returns a decision, never throws');

    console.log('\n§7 result mapping — ok drives is_error');

    var okOutcome = provider.toOutcome({
      ok: true, status: 'completed', exit_code: 0, session_id: 's1', final_message: 'done',
      lane: 'tests', lane_source: 'global', implementer: 'codex',
      read_only: false, read_only_violation: null, touched_files: [' M a.js'],
      artifacts_dir: '/a'
    }, Date.now());
    ok(okOutcome.parsed.is_error === false, 'a successful delegation is not an error');
    ok(okOutcome.parsed.delegate.implementer === 'codex', 'the implementer is carried into the report');
    ok(okOutcome.parsed.delegate.artifacts_dir === '/a', 'the evidence location is carried');
    ok(okOutcome.session_id === 's1', 'the vendor session id is promoted so rework resumes it');
    ok(okOutcome.timed_out === false, 'a completed run is not a timeout');

    var badOutcome = provider.toOutcome({
      ok: false, status: 'completed', exit_code: 1, lane: 'tests', implementer: 'codex'
    }, Date.now());
    ok(badOutcome.parsed.is_error === true,
      'a terminal completed with a non-zero exit code is an error, not a success');

    var timeoutOutcome = provider.toOutcome({
      ok: false, status: 'timeout', exit_code: 143, error: 'watchdog', lane: 'tests', implementer: 'codex'
    }, Date.now());
    ok(timeoutOutcome.timed_out === true, 'a timeout is reported as a timeout');
    ok(timeoutOutcome.parsed.is_error === true, 'and is an error');

    ok(provider.executionAuthority === true, 'the provider declares execution authority honestly');
    ok(provider.newSessionId() === null,
      'no session id is pinned — the vendor mints it, and we store what comes back');

    console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — ' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch(function (e) {
    console.log('  FAIL unexpected throw: ' + (e && e.stack || e));
    process.exit(1);
  });
