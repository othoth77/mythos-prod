#!/usr/bin/env node
'use strict';
// =====================================================
// Mythos — Orchestrator CLI
// scripts/mythos-orchestrate.js
//
// The command boundary Claude drives when delegating work.
//
//   node scripts/mythos-orchestrate.js delegate <task.json> [--dry-run] [--skip-fetch]
//   node scripts/mythos-orchestrate.js validate <task.json>
//   node scripts/mythos-orchestrate.js route    <task.json>
//   node scripts/mythos-orchestrate.js verify   <task.json> <result.json>
//   node scripts/mythos-orchestrate.js status   [<task-id>]
//   node scripts/mythos-orchestrate.js inspect  <task-id> [--lines N]
//   node scripts/mythos-orchestrate.js cancel-safe <task-id>
//   node scripts/mythos-orchestrate.js doctor
//
// Exit codes are meaningful, because Claude branches on them:
//   0  success / verified
//   1  usage or input error
//   2  task rejected (schema, secret, provider mismatch)
//   3  blocked by a safety or Git preflight gate
//   4  provider ran but the task failed
//   5  user approval required — never auto-executed
//   6  verification against Git failed
// =====================================================

var fs = require('fs');
var path = require('path');

var BASE = path.join(__dirname, '..');
var orchestrator = require(path.join(BASE, 'projects', 'mythos-orchestrator', 'orchestrator.js'));

var EXIT = {
  OK: 0, USAGE: 1, REJECTED: 2, BLOCKED: 3,
  FAILED: 4, APPROVAL: 5, VERIFICATION: 6
};

function printJSON(obj) { console.log(JSON.stringify(obj, null, 2)); }

function readTaskFile(p) {
  if (!p) { console.error('Missing task file argument.'); process.exit(EXIT.USAGE); }
  var full = path.resolve(p);
  if (!fs.existsSync(full)) { console.error('Task file not found: ' + full); process.exit(EXIT.USAGE); }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (e) {
    console.error('Task file is not valid JSON: ' + e.message);
    process.exit(EXIT.USAGE);
  }
}

function statusToExit(outcome) {
  switch (outcome.status) {
    case 'completed': return outcome.verified ? EXIT.OK : EXIT.VERIFICATION;
    case 'verification_failed': return EXIT.VERIFICATION;
    case 'user_approval_required': return EXIT.APPROVAL;
    case 'rejected': return EXIT.REJECTED;
    case 'blocked': return EXIT.BLOCKED;
    case 'retained': return EXIT.OK;
    case 'dry-run': return EXIT.OK;
    default: return EXIT.FAILED;
  }
}

function cmdDelegate(argv, opts) {
  var task = readTaskFile(argv[1]);
  var outcome = orchestrator.delegate(task, opts);
  printJSON(outcome);
  process.exit(statusToExit(outcome));
}

function cmdValidate(argv) {
  var task = readTaskFile(argv[1]);
  var v = orchestrator.runner.validateTask(task);
  printJSON({ task_id: task.task_id, valid: v.valid, errors: v.errors });
  process.exit(v.valid ? EXIT.OK : EXIT.REJECTED);
}

function cmdRoute(argv) {
  var task = readTaskFile(argv[1]);
  var routed = orchestrator.router.routeTask(task);
  printJSON(routed);
  process.exit(routed.decision === 'USER_APPROVAL_REQUIRED' ? EXIT.APPROVAL : EXIT.OK);
}

function cmdVerify(argv, opts) {
  var task = readTaskFile(argv[1]);
  var result = readTaskFile(argv[2]);
  var ver = orchestrator.verifier.verify(task, result, opts);
  printJSON(ver);
  process.exit(ver.verified ? EXIT.OK : EXIT.VERIFICATION);
}

function cmdStatus(argv) {
  if (argv[1]) { printJSON(orchestrator.status(argv[1])); } else { printJSON(orchestrator.list()); }
  process.exit(EXIT.OK);
}

function cmdInspect(argv, opts) {
  if (!argv[1]) { console.error('Missing task id.'); process.exit(EXIT.USAGE); }
  printJSON(orchestrator.inspect(argv[1], { lines: opts.lines }));
  process.exit(EXIT.OK);
}

function cmdCancel(argv) {
  if (!argv[1]) { console.error('Missing task id.'); process.exit(EXIT.USAGE); }
  var res = orchestrator.cancelSafe(argv[1]);
  printJSON(res);
  process.exit(res.cancelled ? EXIT.OK : EXIT.FAILED);
}

function usage() {
  console.log([
    'Mythos Orchestrator',
    '',
    'Usage:',
    '  node scripts/mythos-orchestrate.js delegate <task.json> [--dry-run] [--skip-fetch]',
    '  node scripts/mythos-orchestrate.js validate <task.json>',
    '  node scripts/mythos-orchestrate.js route    <task.json>',
    '  node scripts/mythos-orchestrate.js verify   <task.json> <result.json>',
    '  node scripts/mythos-orchestrate.js status   [<task-id>]',
    '  node scripts/mythos-orchestrate.js inspect  <task-id> [--lines N]',
    '  node scripts/mythos-orchestrate.js cancel-safe <task-id>',
    '  node scripts/mythos-orchestrate.js doctor',
    '',
    'Exit codes: 0 verified · 1 usage · 2 rejected · 3 blocked · 4 failed · 5 approval required · 6 verification failed'
  ].join('\n'));
}

module.exports = { EXIT: EXIT, statusToExit: statusToExit };

if (require.main === module) {
  var argv = process.argv.slice(2).filter(function (a) { return true; });
  var flags = process.argv.slice(2);
  var opts = {
    dryRun: flags.indexOf('--dry-run') !== -1,
    skipFetch: flags.indexOf('--skip-fetch') !== -1,
    lines: (function () {
      var i = flags.indexOf('--lines');
      return i !== -1 && flags[i + 1] ? parseInt(flags[i + 1], 10) : 40;
    })()
  };
  var positional = flags.filter(function (a, i) {
    if (a.indexOf('--') === 0) return false;
    return !(flags[i - 1] === '--lines');
  });

  switch (positional[0]) {
    case 'delegate': cmdDelegate(positional, opts); break;
    case 'validate': cmdValidate(positional); break;
    case 'route': cmdRoute(positional); break;
    case 'verify': cmdVerify(positional, opts); break;
    case 'status': cmdStatus(positional); break;
    case 'inspect': cmdInspect(positional, opts); break;
    case 'cancel-safe': cmdCancel(positional); break;
    case 'doctor': printJSON(orchestrator.doctor()); process.exit(EXIT.OK); break;
    default:
      usage();
      process.exit(positional[0] ? EXIT.USAGE : EXIT.OK);
  }
}
