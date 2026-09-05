'use strict';
// =====================================================
// MYTHOS WP — SQL migrations (additive, on top of database/schema.sql)
// projects/mythos-wp/reference/migrate.js
//
// Files: database/migrations/<version>.up.sql and <version>.down.sql.
// Ledger: wp_schema_migrations (created by the first up file). Every up/down
// runs inside ONE transaction, so a failing statement leaves the database as
// it was. No SQL is built from input: the version comes from the file list.
//
//   migrate.status(pool)                 → { applied: [...], pending: [...] }
//   migrate.up(pool)                     → applies every pending version, in order
//   migrate.down(pool, version)          → rolls back exactly that version (must be applied)
// =====================================================
var fs = require('fs');
var path = require('path');
var DIR = path.join(__dirname, '..', 'database', 'migrations');
var VERSION_RE = /^(\d{4}_[a-z0-9_]+)\.(up|down)\.sql$/;

function versions() {
  var seen = Object.create(null);
  fs.readdirSync(DIR).forEach(function (f) { var m = VERSION_RE.exec(f); if (m) seen[m[1]] = true; });
  return Object.keys(seen).sort();
}
function read(version, dir) {
  var f = path.join(DIR, version + '.' + dir + '.sql');
  if (!fs.existsSync(f)) throw new Error('migration file missing: ' + version + '.' + dir + '.sql');
  return fs.readFileSync(f, 'utf8');
}
function applied(pool) {
  return pool.query("SELECT to_regclass('wp_schema_migrations') AS t").then(function (r) {
    if (!r.rows[0].t) return [];
    return pool.query('SELECT version FROM wp_schema_migrations ORDER BY version').then(function (x) { return x.rows.map(function (row) { return row.version; }); });
  });
}
function status(pool) {
  var all = versions();
  return applied(pool).then(function (done) {
    return { applied: done, pending: all.filter(function (v) { return done.indexOf(v) === -1; }) };
  });
}
function runInTx(pool, sql) {
  return pool.connect().then(function (client) {
    return client.query('BEGIN').then(function () { return client.query(sql); })
      .then(function () { return client.query('COMMIT'); })
      .catch(function (e) { return client.query('ROLLBACK').then(function () { throw e; }, function () { throw e; }); })
      .then(function (v) { client.release(); return v; }, function (e) { client.release(); throw e; });
  });
}
function up(pool) {
  return status(pool).then(function (s) {
    var chain = Promise.resolve([]);
    s.pending.forEach(function (v) {
      chain = chain.then(function (done) { return runInTx(pool, read(v, 'up')).then(function () { done.push(v); return done; }); });
    });
    return chain.then(function (done) { return { applied: done }; });
  });
}
function down(pool, version) {
  if (versions().indexOf(version) === -1) return Promise.reject(new Error('unknown migration version'));
  return applied(pool).then(function (done) {
    if (done.indexOf(version) === -1) throw new Error('migration not applied: ' + version);
    return runInTx(pool, read(version, 'down')).then(function () { return { rolled_back: version }; });
  });
}
module.exports = { DIR: DIR, versions: versions, status: status, up: up, down: down };
