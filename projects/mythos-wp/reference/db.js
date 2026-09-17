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
//   (V1 had a second, per-project catalogue pool; V2 reads the Kitchen over HTTP — kitchen.js.)
//
// Every query is parameterised. There is no string-building escape hatch:
// identifiers come from resources.js (a closed registry), values are $n.
// No credential value is ever logged, thrown or returned.
// =====================================================

var Pool = require('pg').Pool;

var REQUIRED_ENV = ['MYTHOS_WP_DB_HOST', 'MYTHOS_WP_DB_PORT', 'MYTHOS_WP_DB_USER', 'MYTHOS_WP_DB_PASSWORD', 'MYTHOS_WP_DB_NAME'];

var wpPool = null;

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
}

module.exports = {
  REQUIRED_ENV: REQUIRED_ENV,
  missingEnv: missingEnv,
  wp: wp,
  query: query,
  transaction: transaction,
  closeAll: closeAll
};
