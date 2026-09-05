#!/usr/bin/env node
'use strict';

/* Migration runner.
 *
 * Applies the SQL files in order, once each, recording a checksum so a file
 * that changed after being applied is detected rather than silently skipped.
 *
 * Refuses to run against production unless ERP_ALLOW_PRODUCTION is set: during
 * Stage 4 the only legitimate target is a development or throwaway database,
 * and an accidental `psql -f` into idauto is exactly the mistake worth making
 * impossible.
 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var FILES = ['schema.sql', 'schema-auth.sql', 'schema-tenant.sql', '0004-prospects.sql', '0005-accounting.sql'];
var DB_DIR = path.resolve(__dirname, '..', '..', 'db');

function checksum(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function load() {
  return FILES.map(function (name) {
    var full = path.join(DB_DIR, name);
    var sql = fs.readFileSync(full, 'utf8');
    return { version: name, sql: sql, checksum: checksum(sql) };
  });
}

/* client: anything with .query(). Injected so this is testable without pg. */
async function migrate(client, opts) {
  var o = opts || {};
  var applied = [];
  var skipped = [];

  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY,' +
    ' applied_at timestamptz NOT NULL DEFAULT now(), checksum text NOT NULL)');

  var known = await client.query('SELECT version, checksum FROM schema_migrations');
  var seen = {};
  (known.rows || []).forEach(function (r) { seen[r.version] = r.checksum; });

  var migrations = o.migrations || load();
  for (var i = 0; i < migrations.length; i++) {
    var m = migrations[i];
    if (seen[m.version]) {
      if (seen[m.version] !== m.checksum) {
        throw new Error('migration ' + m.version + ' changed after being applied' +
          ' (recorded ' + seen[m.version].slice(0, 12) + ', now ' + m.checksum.slice(0, 12) + ').' +
          ' Write a new migration instead of editing an applied one.');
      }
      skipped.push(m.version);
      continue;
    }
    if (o.dryRun) { applied.push(m.version); continue; }
    await client.query(m.sql);
    await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1,$2)',
      [m.version, m.checksum]);
    applied.push(m.version);
  }
  return { applied: applied, skipped: skipped, dryRun: !!o.dryRun };
}

async function main() {
  var conn = process.env.ERP_DATABASE_URL;
  if (!conn) { console.error('REFUSED: ERP_DATABASE_URL is not set.'); process.exit(3); }

  if (/idauto|mythos_command_center|ssangyong/.test(conn) && !process.env.ERP_ALLOW_PRODUCTION) {
    console.error('REFUSED: that connection string points at an existing production database.');
    console.error('The ERP migrates into its own database. Set ERP_ALLOW_PRODUCTION=1 only if you truly mean it.');
    process.exit(3);
  }

  var pg;
  try { pg = require('pg'); } catch (e) {
    console.error('REFUSED: the pg driver is not installed. Run npm install first.');
    process.exit(3);
  }

  var client = new pg.Client({ connectionString: conn });
  await client.connect();
  try {
    var result = await migrate(client, { dryRun: process.argv.indexOf('--dry-run') >= 0 });
    console.log((result.dryRun ? 'WOULD APPLY: ' : 'APPLIED: ') + (result.applied.join(', ') || 'nothing'));
    if (result.skipped.length) console.log('ALREADY APPLIED: ' + result.skipped.join(', '));
  } catch (e) {
    console.error('FAILED: ' + e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) main();

module.exports = { migrate: migrate, load: load, checksum: checksum, FILES: FILES };
