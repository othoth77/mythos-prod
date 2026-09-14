#!/usr/bin/env node
'use strict';
// Prints the full free-LLM service registry: one line per {service,
// model} pair with every field requested for the registry (name, model,
// service type, free/free-tier/trial, limits, status, last check,
// latency, url, requirements, data policy). `--json` prints the same
// rows as JSON for scripting/MCP surfacing.
//
// Usage: node bin/free-llm-status.js [--json] [--wired-only]

var registry = require('../registry');

var asJson = process.argv.indexOf('--json') !== -1;
var wiredOnly = process.argv.indexOf('--wired-only') !== -1;

var rows = registry.listEntries();
if (wiredOnly) rows = rows.filter(function (r) { return r.wired; });

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('provider'.padEnd(28) + 'model'.padEnd(46) + 'access'.padEnd(11) + 'status'.padEnd(18) + 'requirements');
  rows.forEach(function (r) {
    var line = (r.provider_id || '').padEnd(28) +
      (r.model_id || r.model_name || '').padEnd(46) +
      (r.access_type || '').padEnd(11) +
      (r.health.status || '').padEnd(18) +
      (r.requirements || []).join(',');
    console.log(line);
  });
  console.log('\n' + rows.length + ' service/model rows (' + rows.filter(function (r) { return r.wired; }).length + ' wired for live selection).');
}
