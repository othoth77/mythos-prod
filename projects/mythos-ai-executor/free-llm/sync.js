'use strict';
// =====================================================
// Mythos AI Executor — Free LLM Resources: catalog sync
// projects/mythos-ai-executor/free-llm/sync.js
//
// fetch (injectable, offline-testable) -> parse (parser.js) -> overlay
// official-overrides.json (point 6: official provider docs outrank the
// README wherever both exist) -> diff against the previously committed
// catalog.json -> write. Mirrors the fetch/normalize/idempotent-store
// shape of bridge/github-issues.js, and the "append-only evidence, the
// registry is curated" split of status-center's review.js — here the
// analogue is: catalog.json is the committed snapshot (like
// repo-snapshot.json), this script is what regenerates it, and nothing
// about health/selection lives in this file.
//
// No API key is read or required here — discovery never needs a
// credential, only registry.js's health checks and adapter.js's calls
// do (point 10: keys stay in the existing secrets convention, never in
// this repo, never sourced from the upstream list).
// =====================================================

var https = require('https');
var fs = require('fs');
var path = require('path');

var parser = require('./parser');

var SOURCE_REPO = process.env.MYTHOS_FREE_LLM_SOURCE_REPO || 'raullenchai/free-llm-api-resources';
var SOURCE_BRANCH = process.env.MYTHOS_FREE_LLM_SOURCE_BRANCH || 'main';
var README_URL = 'https://raw.githubusercontent.com/' + SOURCE_REPO + '/' + SOURCE_BRANCH + '/README.md';
var CATALOG_PATH = path.join(__dirname, 'catalog.json');
var OVERRIDES_PATH = path.join(__dirname, 'official-overrides.json');

function defaultFetch(url) {
  return new Promise(function (resolve, reject) {
    var req = https.get(url, { timeout: 15000 }, function (res) {
      if (res.statusCode >= 400) {
        res.resume();
        reject(new Error('FREE_LLM_SYNC_FETCH_FAILED: HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      var body = '';
      res.on('data', function (d) { body += d; });
      res.on('end', function () { resolve(body); });
    });
    req.on('timeout', function () { req.destroy(new Error('FREE_LLM_SYNC_TIMEOUT: ' + url)); });
    req.on('error', reject);
  });
}

function loadJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function indexById(list) {
  var m = {};
  (list || []).forEach(function (item) { m[item.id] = item; });
  return m;
}

function applyOverrides(entries, overrides) {
  var table = (overrides && overrides.providers) || {};
  return entries.map(function (p) {
    var o = table[p.id];
    return Object.assign({}, p, {
      official: o ? { docs_url: o.docs_url || null, privacy_url: o.privacy_url || null, terms_url: o.terms_url || null } : null
    });
  });
}

function modelKey(m) { return m.api_model_id || m.name; }

// diffCatalog(prevList, nextList) -> what changed since the last
// committed snapshot: new services, services that disappeared, and per
// service which models newly appeared/disappeared or whose limit text
// changed (point 4).
function diffCatalog(prevList, nextList) {
  var prevIdx = indexById(prevList);
  var nextIdx = indexById(nextList);
  var newProviders = Object.keys(nextIdx).filter(function (id) { return !prevIdx[id]; });
  var removedProviders = Object.keys(prevIdx).filter(function (id) { return !nextIdx[id]; });
  var changedProviders = [];

  Object.keys(nextIdx).forEach(function (id) {
    if (!prevIdx[id]) return;
    var before = prevIdx[id];
    var after = nextIdx[id];
    var beforeModelIds = {};
    (before.models || []).forEach(function (m) { beforeModelIds[modelKey(m)] = true; });
    var afterModelIds = {};
    (after.models || []).forEach(function (m) { afterModelIds[modelKey(m)] = true; });
    var newModels = Object.keys(afterModelIds).filter(function (k) { return !beforeModelIds[k]; });
    var removedModels = Object.keys(beforeModelIds).filter(function (k) { return !afterModelIds[k]; });
    var limitsChanged = (before.limits_text || null) !== (after.limits_text || null);
    if (newModels.length || removedModels.length || limitsChanged) {
      changedProviders.push({
        id: id, new_models: newModels, removed_models: removedModels, limits_changed: limitsChanged
      });
    }
  });

  return { new_providers: newProviders, removed_providers: removedProviders, changed_providers: changedProviders };
}

// syncCatalog(opts) -> Promise<{ catalog, diff }>. opts.fetch,
// opts.now, opts.overrides and opts.previousCatalog are all injectable
// so the whole pipeline runs offline in tests, same discipline as
// providers/openai-compat.js's transport injection.
function syncCatalog(opts) {
  opts = opts || {};
  var fetchFn = opts.fetch || defaultFetch;
  var nowIso = (opts.now ? opts.now() : new Date()).toISOString();
  var overrides = opts.overrides || loadJsonSafe(OVERRIDES_PATH, { providers: {} });
  var previous = opts.previousCatalog !== undefined
    ? opts.previousCatalog
    : loadJsonSafe(opts.catalogPath || CATALOG_PATH, null);
  var previousList = (previous && previous.providers) || [];
  var prevIdx = indexById(previousList);

  return Promise.resolve(fetchFn(README_URL)).then(function (markdown) {
    var parsed = parser.parseCatalog(markdown);
    var flat = parsed.free.concat(parsed.trial);
    var withOverrides = applyOverrides(flat, overrides);
    var withTimestamps = withOverrides.map(function (p) {
      var before = prevIdx[p.id];
      return Object.assign({}, p, {
        first_seen: before ? before.first_seen : nowIso,
        last_seen: nowIso
      });
    });
    var diff = diffCatalog(previousList, withTimestamps);
    var catalog = {
      catalog_version: 1,
      source: { repo: SOURCE_REPO, branch: SOURCE_BRANCH, readme_url: README_URL },
      generated_at: nowIso,
      provider_count: withTimestamps.length,
      model_count: withTimestamps.reduce(function (n, p) { return n + (p.models || []).length; }, 0),
      providers: withTimestamps
    };
    return { catalog: catalog, diff: diff };
  });
}

function writeCatalog(catalog, catalogPath) {
  var file = catalogPath || CATALOG_PATH;
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = {
  syncCatalog: syncCatalog,
  writeCatalog: writeCatalog,
  diffCatalog: diffCatalog,
  applyOverrides: applyOverrides,
  defaultFetch: defaultFetch,
  README_URL: README_URL,
  CATALOG_PATH: CATALOG_PATH,
  OVERRIDES_PATH: OVERRIDES_PATH
};
