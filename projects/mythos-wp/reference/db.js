'use strict';
// =====================================================
// MYTHOS WP — database connections
// projects/mythos-wp/reference/db.js
//
// Two kinds of connection, deliberately separate:
//
//   wp        the panel's own database (mythos_wp: registry, commercial and
//             stock layers, knowledge, rules, handoffs, audit). One pool,
//             configured by MYTHOS_WP_DB_* exactly like the sibling services
//             (command-center MCC_DB_*, storefront SSANGYONG_DB_*).
//
//   catalogue one pool PER PROJECT, opened lazily from the URL held in the
//             environment variable NAMED by wp_projects.catalog_dsn_env
//             (e.g. MYTHOS_WP_CATALOG_SSANGYONG_AUTOS). The variable's VALUE
//             is a libpq URL and never leaves this module; the registry row
//             stores only the variable's name. search_path is pinned per
//             connection to the project's declared schema, so unqualified
//             sya_* names resolve to that project's catalogue and nothing
//             else. Unlike the storefront's read-only pool, this pool WRITES
//             — that is the panel's purpose — and every write goes through
//             crud.js, which audits it.
//
// Every query is parameterised. There is no string-building escape hatch:
// identifiers come from resources.js (a closed registry), values are $n.
// No credential value is ever logged, thrown or returned.
// =====================================================

var Pool = require('pg').Pool;

var REQUIRED_ENV = ['MYTHOS_WP_DB_HOST', 'MYTHOS_WP_DB_PORT', 'MYTHOS_WP_DB_USER', 'MYTHOS_WP_DB_PASSWORD', 'MYTHOS_WP_DB_NAME'];
var SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
var ENV_NAME_RE = /^[A-Z][A-Z0-9_]{2,62}$/;

var wpPool = null;
var catalogPools = Object.create(null); // env name -> Pool

function missingEnv() {
  return REQUIRED_ENV.filter(function (n) { return !process.env[n]; });
}

function wp() {
  if (wpPool) return wpPool;
  var missing = missingEnv();
  if (missing.length) throw new Error('db.js: missing required environment variable(s): ' + missing.join(', '));
  wpPool = new Pool({
    host: process.env.MYTHOS_WP_DB_HOST,
    port: parseInt(process.env.MYTHOS_WP_DB_PORT, 10),
    user: process.env.MYTHOS_WP_DB_USER,
    password: process.env.MYTHOS_WP_DB_PASSWORD,
    database: process.env.MYTHOS_WP_DB_NAME,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  wpPool.on('error', function () {});
  return wpPool;
}

// The catalogue pool for one project row. `project` is a wp_projects row
// (or an object with the same two fields). Throws a NAMED error, never the
// URL, when the variable is absent or malformed.
function catalog(project) {
  var envName = project && project.catalog_dsn_env;
  var schema = project && project.catalog_schema;
  if (!ENV_NAME_RE.test(String(envName || ''))) throw named('CATALOG_ENV_NAME_INVALID');
  if (!SCHEMA_RE.test(String(schema || ''))) throw named('CATALOG_SCHEMA_INVALID');
  var key = envName + '|' + schema;
  if (catalogPools[key]) return catalogPools[key];
  var url = process.env[envName];
  if (!url) throw named('CATALOG_NOT_CONFIGURED');
  var pool = new Pool({
    connectionString: url,
    options: '-c search_path=' + schema,
    max: 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  pool.on('error', function () {});
  catalogPools[key] = pool;
  return pool;
}

// True when the environment can open this project's catalogue (the name is
// configured); says nothing about reachability, which /api/health probes.
function catalogConfigured(project) {
  var envName = project && project.catalog_dsn_env;
  return ENV_NAME_RE.test(String(envName || '')) && !!process.env[envName];
}

function named(code) { var e = new Error(code); e.code = code; return e; }

function query(pool, text, params) { return pool.query(text, params || []); }

// Runs fn(client) inside one transaction on the given pool.
function transaction(pool, fn) {
  return pool.connect().then(function (client) {
    return client.query('BEGIN').then(function () { return fn(client); }).then(function (r) {
      return client.query('COMMIT').then(function () { client.release(); return r; });
    }, function (e) {
      return client.query('ROLLBACK').catch(function () {}).then(function () { client.release(); throw e; });
    });
  });
}

async function closeAll() {
  if (wpPool) { await wpPool.end(); wpPool = null; }
  var keys = Object.keys(catalogPools);
  for (var i = 0; i < keys.length; i++) { await catalogPools[keys[i]].end(); }
  catalogPools = Object.create(null);
}

module.exports = {
  REQUIRED_ENV: REQUIRED_ENV,
  SCHEMA_RE: SCHEMA_RE,
  ENV_NAME_RE: ENV_NAME_RE,
  missingEnv: missingEnv,
  wp: wp,
  catalog: catalog,
  catalogConfigured: catalogConfigured,
  query: query,
  transaction: transaction,
  closeAll: closeAll
};
