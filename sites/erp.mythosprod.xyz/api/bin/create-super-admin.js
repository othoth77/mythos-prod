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
    process.stdout.write(question);
    var stdin = process.stdin;
    var chars = [];
    var wasRaw = stdin.isRaw;
    try { stdin.setRawMode(true); } catch (e) { return reject(new Error('cannot disable echo on this terminal')); }
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
      "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE key = 'super_admin'",
      [userId]);

    await client.query(
      'INSERT INTO audit_log (actor_id, actor_label, action, entity_table, entity_id, outcome, detail)' +
      " VALUES ($1,$2,'user.created','users',$1,'ok',$3::jsonb)",
      [userId, email, JSON.stringify({ bootstrap: true, role: 'super_admin' })]);

    await client.query('COMMIT');

    console.log('');
    console.log('Created super_admin ' + email + ' (' + userId + ').');
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
