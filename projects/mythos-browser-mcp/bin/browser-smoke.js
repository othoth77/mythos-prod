#!/usr/bin/env node
// =====================================================
// MYTHOS Browser MCP — runtime smoke (run ON the browser host)
// projects/mythos-browser-mcp/bin/browser-smoke.js [url]
//
// Direct check of the runtime beneath the MCP server: adapter status
// (which backend would serve, why the other would not), then navigate,
// extract and screenshot through the adapter, printing a JSON verdict per
// step. Reads OBSCURA_CDP_TOKEN from the environment (source the 0600 env
// file first); prints no secret. Exit 0 only when every step passed.
// =====================================================
'use strict';
var path = require('path');
var adapterLib = require(path.join(__dirname, '..', 'lib', 'browser-adapter'));
var url = process.argv[2] || 'https://example.com/';
var a = adapterLib.createAdapter({ env: process.env });
var verdict = { url: url, steps: [], status: 'PASS' };
function step(name, fn) {
  var t0 = Date.now();
  return Promise.resolve().then(fn).then(function (r) { verdict.steps.push({ step: name, ok: true, ms: Date.now() - t0, result: r }); },
    function (e) { verdict.status = 'FAIL'; verdict.steps.push({ step: name, ok: false, ms: Date.now() - t0, error: String(e && e.message || e).slice(0, 400), attempts: e && e.attempts || undefined }); });
}
step('status', function () { return a.status(); })
  .then(function () { return step('navigate', function () { return a.navigate({ url: url }); }); })
  .then(function () { return step('extract', function () { return a.extract({ url: url, max_chars: 400 }).then(function (r) { r.text = r.text.slice(0, 200); return r; }); }); })
  .then(function () { return step('screenshot', function () { return a.screenshot({ url: url }); }); })
  .then(function () {
    var out = JSON.stringify(verdict, null, 2);
    var tok = process.env.OBSCURA_CDP_TOKEN; if (tok) out = out.split(tok).join('<redacted>');
    console.log(out);
    process.exit(verdict.status === 'PASS' ? 0 : 1);
  });
