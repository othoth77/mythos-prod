'use strict';
// =====================================================
// MYTHOS supervisor E2E T6 TARGET — MUST FAIL. Do not "fix" this file.
// tests/mythos-t6-loop-target.js
//
// Purpose: the live E2E T6 proves LOOP PROTECTION — a supervised `test` task
// whose target can never pass must end BLOCKED through the supervisor's
// recovery/loop limits, finitely, without any recovery completing it by
// running a different passing suite (the T6 acceptance pins this file with
// check:tests_pass_for:tests/mythos-t6-loop-target.js).
//
// Why it fails deterministically: check 3 asserts a CONTRADICTORY invariant
// on a pure function — the same input must equal two different values. No
// implementation of loopTargetValue() can satisfy it; only editing this test
// could, and T6 recoveries are `test` actions (read-only, no Write/Edit, never
// more privileged than the root), so no recovery can legitimately repair it.
// A local edit in one recovery worktree is never committed or merged, so the
// next run from the repository fails again.
//
// Plain Node, no dependency, no network, no environment, no files, no clock.
// Output: "mythos-t6-loop-target: 2 passed, 1 failed" and exit 1, every run.
// Run with: node tests/mythos-t6-loop-target.js
// =====================================================

function loopTargetValue(n) {
  var sum = 0;
  for (var i = 1; i <= n; i++) sum += i;
  return sum;
}

var passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
}

check('1 loopTargetValue(10) is a number', typeof loopTargetValue(10) === 'number');
check('2 loopTargetValue is deterministic', loopTargetValue(10) === loopTargetValue(10));
// The immutable contradiction: one input, two required values.
var v = loopTargetValue(10);
check('3 E2E T6 contradiction: loopTargetValue(10) === 55 AND === 56 (unsatisfiable by design)', v === 55 && v === 56);

console.log('\nmythos-t6-loop-target: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
