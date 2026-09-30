#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — HostOps client for FABLE sessions (HostOps v0.2)
// ops/hostops/hostops-client.js
//
// The supported way for an executor task (a headless Claude session running
// as deploy) or an operator to ask the HostOps boundary for something. It
// goes through the executor adapter (projects/mythos-ai-executor/lib/hostops.js)
// so the call gets the same catalog checks, attribution, task record
// (<task>/hostops.json + events.log) and audit_id join as POST /hostops/run —
// without needing the executor's bearer token. The ROOT helper remains the
// enforcement point; this client adds convenience, not authority.
//
//   node ops/hostops/hostops-client.js catalog
//   node ops/hostops/hostops-client.js config-get --key bridge.whatsapp.to
//   node ops/hostops/hostops-client.js config-set --key bridge.whatsapp.to --value +216XXXXXXXX \
//        --task-id <executor task id> --github-task gh-issue-477
//   node ops/hostops/hostops-client.js tool-run --tool bridge.notify-test --confirm yes --task-id <id>
//
// Every CONTROLLED operation needs --task-id / --github-task / --othmode-task.
// Output: the adapter's JSON result. Exit: 0 ok · 2 refused by policy ·
// 4 failed / unavailable · 64 usage.
// =====================================================
var path = require('path');
var hostops = require(path.join(__dirname, '..', '..', 'projects', 'mythos-ai-executor', 'lib', 'hostops'));

var ID_FLAGS = { 'task-id': 'task_id', 'github-task': 'github_task_id', 'othmode-task': 'othmode_task_id', 'requested-by': 'requested_by' };
var argv = process.argv.slice(2);
if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
  process.stdout.write(JSON.stringify(hostops.describe(), null, 2) + '\n');
  process.exit(argv.length ? 0 : 64);
}
var payload = { operation: argv[0], arguments: {} };
for (var i = 1; i < argv.length; i += 2) {
  var k = argv[i], v = argv[i + 1];
  if (!/^--[a-z][a-z-]{1,24}$/.test(String(k)) || typeof v !== 'string') {
    process.stderr.write('usage: hostops-client <operation> [--<arg> <value>]... [--task-id T] [--github-task G] [--othmode-task O]\n');
    process.exit(64);
  }
  var name = k.slice(2);
  if (ID_FLAGS[name]) payload[ID_FLAGS[name]] = v; else payload.arguments[name] = v;
}
hostops.invoke(payload).then(function (r) {
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.ok ? 0 : (r.http_status && r.http_status < 500 ? 2 : 4));
});
