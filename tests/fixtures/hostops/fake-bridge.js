#!/usr/bin/env node
'use strict';
// Test double for bin/mythos-github-bridge, used as a HostOps catalog tool by
// tests/mythos-hostops-controlled-test.js. Reads ONLY its environment, like
// the real notify-* commands. Deliberately echoes the raw recipient list in
// `debug_to` so the suite can prove HostOps masks it before returning.
// The number 21600000000 is "rejected by the gateway" to drive the
// automatic-rollback path.
var to = String(process.env.MYTHOS_BRIDGE_WHATSAPP_TO || '').split(',').filter(Boolean);
var cmd = process.argv[2];
function out(o) { process.stdout.write(JSON.stringify(o, null, 2) + '\n'); }
if (cmd === 'notify-config') {
  var problems = [];
  if (!to.length) problems.push('MYTHOS_BRIDGE_WHATSAPP_TO is not set');
  if (to.indexOf('21600000000') !== -1) problems.push('gateway rejects recipient');
  out({ enabled: process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED === '1', recipients_configured: to.length, debug_to: to.join(','),
    credential_file_passed: !!process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE, raw_key_passed: !!process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY, problems: problems });
} else if (cmd === 'notify-test' && process.argv[3] === '--confirm') {
  out({ ok: true, sent: to.length, attempted: to.length, results: to.map(function (x) { return { ok: true, to: x }; }) });
} else if (cmd === 'whoami') {
  out({ uid: process.getuid(), gid: process.getgid(), groups: process.getgroups() });
} else {
  process.stderr.write('fake-bridge: unsupported\n');
  process.exit(1);
}
