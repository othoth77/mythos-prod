#!/usr/bin/env node
'use strict';

/* Interactive first-super-admin bootstrap (A8).
 *
 * There is no default password and no seeded account, because a seeded default
 * admin is how systems are compromised on day one. This script refuses to run
 * unattended: the password is typed at a TTY, never passed as an argument
 * (argv is visible in `ps`), never read from an environment variable, and
 * never written to disk or into audit detail.
 *
 * It also refuses to create a second super_admin. After the first, accounts are
 * created through the authenticated API under users.manage, where it is audited.
 *
 * Tenant association (Phase 4 fix, 2026-09-05): roles are tenant-scoped
 * (user_roles.tenant_id NOT NULL) and permissions only resolve through an
 * active tenant_memberships row (user_effective_permissions). The original
 * version inserted a tenant-less role, which the schema refuses, and created no
 * membership, so the account could never have logged into a tenant. The
 * bootstrap now asks for the tenant key (default: mythos), requires that tenant
 * to exist and be active, and writes membership + role + audit in one transaction.
 */

var readline = require('readline');
var passwords = require('../lib/password');
var auth = require('../lib/auth');

function ask(question) {
  return new Promise(function (resolve) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, function (answer) { rl.close(); resolve(String(answer)); });
  });
}

/* Read without echoing. The terminal is put in raw mode so the password never
   appears on screen, in scrollback, or in a screen recording. */
function askSecret(question) {
  return new Promise(function (resolve, reject) {
    var stdin = process.stdin;
    var chars = [];
    var wasRaw = stdin.isRaw;
    // Raw mode BEFORE the prompt is printed: the terminal must already be
    // non-echoing when the first keystroke can possibly arrive, otherwise a
    // fast typist (or a paste) lands in cooked mode and is echoed.
    try { stdin.setRawMode(true); } catch (e) { return reject(new Error('cannot disable echo on this terminal')); }
    process.stdout.write(question);
    stdin.resume();
    stdin.setEncoding('utf8');
    function done(value) {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(!!wasRaw); } catch (e) { /* restoring is best-effort */ }
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    }
    function onData(ch) {
      for (var i = 0; i < ch.length; i++) {
        var c = ch[i];
        if (c === '\r' || c === '\n') return done(chars.join(''));
        if (c === '') { process.stdout.write('\n'); process.exit(130); }   // Ctrl-C
        if (c === '' || c === '\b') { chars.pop(); continue; }             // backspace
        chars.push(c);
      }
    }
    stdin.on('data', onData);
  });
}

function refuse(msg) {
  console.error('REFUSED: ' + msg);
  process.exit(3);
}

async function main() {
  if (!process.stdin.isTTY) {
    refuse('stdin is not a TTY. This account is created interactively — never scripted, never seeded.');
  }

  var pg;
  try {
    pg = require('pg');
  } catch (e) {
    refuse('the pg driver is not installed. Run npm install in sites/erp.mythosprod.xyz/api first.');
  }

  var conn = process.env.ERP_DATABASE_URL;
  if (!conn) {
    refuse('ERP_DATABASE_URL is not set. It is expected to come from a 0600 file sourced at run time, not from shell history.');
  }

  var client = new pg.Client({ connectionString: conn });
  await client.connect();

  try {
    var existing = await client.query(
      "SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'super_admin'");
    if (existing.rows[0].n > 0) {
      refuse('a super_admin already exists. Create further accounts through the authenticated API, where it is audited.');
    }

    var tenantKey = (await ask('Tenant key [mythos]: ')).trim().toLowerCase() || 'mythos';
    var tenantRow = await client.query(
      "SELECT id FROM tenants WHERE key = $1 AND status = 'active' AND deleted_at IS NULL", [tenantKey]);
    if (!tenantRow.rows.length) refuse('tenant "' + tenantKey + '" does not exist or is not active. Create it first.');
    var tenantId = tenantRow.rows[0].id;

    var email = (await ask('Super admin email: ')).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) refuse('that is not a valid email address.');

    var name = (await ask('Display name: ')).trim();
    if (!name) refuse('a display name is required.');

    var pw = await askSecret('Password (minimum 12 characters, not echoed): ');
    var strength = auth.validatePasswordStrength(pw);
    if (!strength.ok) refuse(strength.error);

    var confirm = await askSecret('Confirm password: ');
    if (pw !== confirm) refuse('the passwords did not match.');

    var hash = await passwords.hash(pw);
    pw = null; confirm = null;

    await client.query('BEGIN');
    var inserted = await client.query(
      'INSERT INTO users (email, display_name, password_hash, password_algo, password_changed_at)' +
      ' VALUES ($1,$2,$3,$4, now()) RETURNING id',
      [email, name, hash, passwords.ALGO]);
    var userId = inserted.rows[0].id;

    await client.query(
      'INSERT INTO tenant_memberships (user_id, tenant_id, status, is_default) VALUES ($1,$2,\'active\',true)',
      [userId, tenantId]);

    var role = await client.query(
      "INSERT INTO user_roles (user_id, tenant_id, role_id) SELECT $1, $2, id FROM roles WHERE key = 'super_admin'" +
      ' RETURNING role_id', [userId, tenantId]);
    if (!role.rows.length) throw new Error('role super_admin is missing from the roles table');

    // Three facts, three audit rows, all in the bootstrap transaction and all
    // carrying the tenant so audit.read inside that tenant shows them.
    var auditSql =
      'INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, outcome, detail, tenant_id)' +
      " VALUES ($1,$2,$3,$4,$5,'ok',$6::jsonb,$7)";
    await client.query(auditSql, [userId, email, 'user.created', 'users', userId,
      JSON.stringify({ bootstrap: true, role: 'super_admin', tenant: tenantKey }), tenantId]);
    await client.query(auditSql, [userId, email, 'membership.granted', 'tenant_memberships', userId,
      JSON.stringify({ bootstrap: true, tenant: tenantKey, is_default: true }), tenantId]);
    await client.query(auditSql, [userId, email, 'role.assigned', 'user_roles', userId,
      JSON.stringify({ bootstrap: true, role: 'super_admin', tenant: tenantKey }), tenantId]);

    await client.query('COMMIT');

    console.log('');
    console.log('Created super_admin ' + email + ' (' + userId + ') in tenant ' + tenantKey + ' (' + tenantId + ').');
    console.log('The password was not stored, logged, echoed, or placed in the audit detail.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* nothing to roll back */ }
    console.error('FAILED: ' + err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) main();

module.exports = { ask: ask, askSecret: askSecret };
