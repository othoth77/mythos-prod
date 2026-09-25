'use strict';
// =====================================================
// START-GATE PROBE — V3.2 R1 (VPS OTHKM + checkout closeout), read-only
// projects/mythos-ai-executor/bridge/gates/probes/othk-v32-closeout.js
//
// Re-proves, from the live VPS state, what projects/oth-knowledge/ops/
// v32-vps-closeout.sh established — without writing anything the closeout
// owns. Usage (by bridge/start-gates.js): node othk-v32-closeout.js '<json args>'
//
//   store_valid          `othk-cli validate` on the canonical store exits 0
//   relationships        >= min_relationships live typed relationships, each
//                        with rel_type/from_id/to_id; no duplicate live ids;
//                        no two live relationships with the same
//                        (rel_type, from, to) under different ids
//   seed_ingestion       every record the COMMITTED seeds produce (seeded into
//   deterministic_ids    a throwaway store in the OS temp dir, removed after)
//                        is live in the canonical store, and every
//                        relationship has the identical id, type and
//                        endpoints — the closeout's idempotence/determinism
//   search_claim         the closeout's hybrid search returns `expect`
//   othk_http_health     the running oth-knowledge-http says ok + store_available
//   project_context      the running command center serves expect_tracks
//                        projects, with shared_platform_capabilities carried
//
// Prints one JSON line {ok, checks[]} last; exits 0 only when every check
// passes. Any error is a failed check (fail-closed); nothing is retried.
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var args = {};
try { args = JSON.parse(process.argv[2] || '{}'); } catch (e) { args = {}; }
var REPO = args.repo || process.env.MYTHOS_BRIDGE_REPO || '/home/deploy/projects/mythos-prod';
var STORE = args.store || process.env.OTHK_STORE || '/home/deploy/othk-store';
var CLI = path.join(REPO, args.cli || 'projects/oth-knowledge/cli/othk-cli.js');
var SEEDS = args.seeds_dir || 'projects/oth-knowledge/seeds';
var MIN_REL = Number(args.min_relationships || 40);
var EXPECT_TRACKS = Number(args.expect_tracks || 36);
var SEARCH = args.search || { query: 'Haddad EXECUTES a second project oth-knowledge', mode: 'hybrid', limit: 5, expect: 'second bridge instance' };
var HEALTH_URL = args.health_url || 'http://127.0.0.1:8150/health';
var PROJECTS_URL = args.projects_url || 'http://127.0.0.1:3021/api/othmode/projects';
var CAPS_PROJECT = args.capabilities_project || 'mythos-haddad';
var HTTP_TIMEOUT = Number(args.http_timeout_ms || 10000);

var checks = [];
function check(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: String(detail || '').slice(0, 300) }); }

function cli(storeRoot, argv) {
  var r = cp.spawnSync(process.execPath, [CLI, '--store', storeRoot].concat(argv), { encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, out: r.stdout || '', err: (r.stderr || '') + (r.error ? r.error.message : '') };
}

function getJson(url) {
  return new Promise(function (resolve) {
    var req = http.get(url, { timeout: HTTP_TIMEOUT }, function (res) {
      var s = '';
      res.on('data', function (d) { s += d; if (s.length > 4 * 1024 * 1024) req.destroy(); });
      res.on('end', function () { var j = null; try { j = JSON.parse(s); } catch (e) { j = null; } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { resolve({ status: 0, error: e.message }); });
  });
}

function relKey(r) { return [r.id, r.rel_type, r.from_id, r.to_id].join(' '); }

function storeChecks() {
  if (!fs.existsSync(STORE)) { check('store_valid', false, 'store ' + STORE + ' missing'); return; }
  var v = cli(STORE, ['validate']);
  check('store_valid', v.status === 0, v.status === 0 ? 'validate ok' : 'validate exit ' + v.status + ' ' + v.err.slice(0, 120));

  var storeLib = require(path.join(REPO, 'projects', 'oth-knowledge', 'lib', 'store.js'));
  var live = storeLib.openStore(STORE);
  var all = live.allRecords();
  var ids = all.map(function (r) { return r.id; });
  var rels = live.allRecords({ kind: 'relationship' });
  var typed = rels.filter(function (r) { return r.rel_type && r.from_id && r.to_id; });
  var triples = {};
  var dupTriples = 0;
  typed.forEach(function (r) { var k = r.rel_type + '|' + r.from_id + '|' + r.to_id; if (triples[k] && triples[k] !== r.id) dupTriples++; triples[k] = r.id; });
  var dupIds = ids.length - new Set(ids).size;
  check('relationships', typed.length === rels.length && rels.length >= MIN_REL && dupIds === 0 && dupTriples === 0,
    rels.length + ' live relationships (' + typed.length + ' typed, need >= ' + MIN_REL + '), duplicate ids ' + dupIds + ', duplicate triples ' + dupTriples);

  // Committed seeds only: an untracked file in seeds/ is not part of any closeout.
  var ls = cp.spawnSync('git', ['-C', REPO, 'ls-files', '--', SEEDS], { encoding: 'utf8' });
  var seedFiles = (ls.stdout || '').split('\n').filter(function (f) { return /\.json$/.test(f); });
  if (ls.status !== 0 || !seedFiles.length) { check('seed_ingestion', false, 'no committed seeds found under ' + SEEDS); check('deterministic_ids', false, 'not evaluated'); return; }
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'othk-gate-probe-'));
  try {
    for (var i = 0; i < seedFiles.length; i++) {
      var s = cli(tmp, ['seed', path.join(REPO, seedFiles[i])]);
      if (s.status !== 0) { check('seed_ingestion', false, 'fresh seeding of ' + seedFiles[i] + ' failed: ' + s.err.slice(0, 120)); check('deterministic_ids', false, 'not evaluated'); return; }
    }
    var fresh = storeLib.openStore(tmp);
    var liveIds = new Set(ids);
    var missing = fresh.allRecords().filter(function (r) { return !liveIds.has(r.id); });
    check('seed_ingestion', missing.length === 0, seedFiles.length + ' committed seeds, ' + fresh.allRecords().length + ' records, missing from canonical store: ' + missing.length + (missing.length ? ' (e.g. ' + missing[0].id + ')' : ''));
    var liveRel = {};
    rels.forEach(function (r) { liveRel[r.id] = relKey(r); });
    var freshRels = fresh.allRecords({ kind: 'relationship' });
    var drift = freshRels.filter(function (r) { return liveRel[r.id] !== relKey(r); });
    check('deterministic_ids', freshRels.length > 0 && drift.length === 0, freshRels.length + ' relationships re-derived from the seeds, ' + drift.length + ' differ from the canonical store');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  var q = cli(STORE, ['search', SEARCH.query, '--mode', SEARCH.mode || 'hybrid', '--limit', String(SEARCH.limit || 5)]);
  var found = q.status === 0 && q.out.toLowerCase().indexOf(String(SEARCH.expect).toLowerCase()) !== -1;
  check('search_claim', found, found ? '"' + SEARCH.expect + '" retrievable' : 'search exit ' + q.status + ', "' + SEARCH.expect + '" not in top ' + (SEARCH.limit || 5));
}

function main() {
  try { storeChecks(); } catch (e) { check('store', false, 'probe error: ' + e.message); }
  return getJson(HEALTH_URL).then(function (h) {
    var j = h.json || {};
    check('othk_http_health', h.status === 200 && j.status === 'ok' && j.store_available === true, 'HTTP ' + h.status + ' status=' + j.status + ' store_available=' + j.store_available + (h.error ? ' ' + h.error : ''));
    return getJson(PROJECTS_URL);
  }).then(function (p) {
    var j = p.json || {};
    var list = Array.isArray(j.projects) ? j.projects : [];
    var caps = list.filter(function (x) { return x && x.id === CAPS_PROJECT; })[0];
    var capN = caps && Array.isArray(caps.shared_platform_capabilities) ? caps.shared_platform_capabilities.length : 0;
    check('project_context', p.status === 200 && j.total === EXPECT_TRACKS && list.length === EXPECT_TRACKS && capN >= 1,
      'HTTP ' + p.status + ' total=' + j.total + ' served=' + list.length + ' (expect ' + EXPECT_TRACKS + '), ' + CAPS_PROJECT + ' capabilities=' + capN + (p.error ? ' ' + p.error : ''));
  }).then(function () {
    var ok = checks.length > 0 && checks.every(function (c) { return c.ok; });
    process.stdout.write(JSON.stringify({ ok: ok, probe: 'othk-v32-closeout', store: STORE, checks: checks }) + '\n');
    process.exit(ok ? 0 : 1);
  });
}

main().catch(function (e) {
  process.stdout.write(JSON.stringify({ ok: false, probe: 'othk-v32-closeout', checks: checks.concat([{ name: 'probe', ok: false, detail: e.message }]) }) + '\n');
  process.exit(1);
});
