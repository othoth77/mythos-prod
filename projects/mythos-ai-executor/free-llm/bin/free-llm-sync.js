#!/usr/bin/env node
'use strict';
// Refreshes projects/mythos-ai-executor/free-llm/catalog.json from the
// live free-llm-api-resources README and prints what changed. Run this
// on demand (or from whatever scheduler the owner chooses — no timer is
// installed by this stage, matching the deployment-is-a-separate-task
// rule for every other owner-gated scheduler in this repo).
//
// Usage: node bin/free-llm-sync.js [--dry-run]

var sync = require('../sync');

var dryRun = process.argv.indexOf('--dry-run') !== -1;

sync.syncCatalog().then(function (result) {
  var d = result.diff;
  console.log('providers: ' + result.catalog.provider_count + '  models: ' + result.catalog.model_count);
  console.log('new providers: ' + (d.new_providers.join(', ') || 'none'));
  console.log('removed providers: ' + (d.removed_providers.join(', ') || 'none'));
  if (d.changed_providers.length) {
    d.changed_providers.forEach(function (c) {
      console.log('changed: ' + c.id +
        (c.new_models.length ? '  +models=' + c.new_models.join(',') : '') +
        (c.removed_models.length ? '  -models=' + c.removed_models.join(',') : '') +
        (c.limits_changed ? '  limits_changed' : ''));
    });
  } else {
    console.log('changed providers: none');
  }
  if (dryRun) {
    console.log('--dry-run: catalog.json not written');
    return;
  }
  sync.writeCatalog(result.catalog);
  console.log('wrote ' + sync.CATALOG_PATH);
}).catch(function (err) {
  console.error('FREE_LLM_SYNC_FAILED: ' + err.message);
  process.exitCode = 1;
});
