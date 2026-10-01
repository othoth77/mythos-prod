#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS TRADING CONTROL CENTER — user file tool
// projects/mythos-trading-control-center/bin/tcc-user.js
//
//   node bin/tcc-user.js set   <users-file> <id> <OWNER|OPERATOR|VIEWER>
//   node bin/tcc-user.js remove <users-file> <id>
//   node bin/tcc-user.js list  <users-file>
//
// The password is read from STDIN — one line — so it never appears in the
// process list, the shell history or an environment variable:
//
//   read -rs PW; printf '%s\n' "$PW" | node bin/tcc-user.js set /path/users.json othman OWNER
//
// With --generate instead, a random password is created and printed ONCE to
// stdout; it is not stored anywhere but as a scrypt hash.
//
// The users file is written 0600. The server refuses to read it otherwise.
// =====================================================

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var auth = require(path.join(__dirname, '..', 'server', 'auth'));

function fail(msg) {
  process.stderr.write('tcc-user: ' + msg + '\n');
  process.exit(1);
}

function load(file) {
  var doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return { users: [] };
    fail('cannot read ' + file + ': ' + e.message);
  }
  if (!doc || !Array.isArray(doc.users)) fail(file + ' is not a users file');
  return doc;
}

function save(file, doc) {
  var tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function readStdinLine(cb) {
  var data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (d) { data += d; });
  process.stdin.on('end', function () { cb(data.split('\n')[0].replace(/\r$/, '')); });
}

function main() {
  var args = process.argv.slice(2);
  var generate = args.indexOf('--generate') !== -1;
  args = args.filter(function (a) { return a !== '--generate'; });
  var cmd = args[0];
  var file = args[1];
  if (!cmd || !file) fail('usage: tcc-user.js <set|remove|list> <users-file> [id] [role] [--generate]');

  if (cmd === 'list') {
    load(file).users.forEach(function (u) { process.stdout.write(u.id + '\t' + u.role + '\n'); });
    return;
  }
  if (cmd === 'remove') {
    var doc = load(file);
    var before = doc.users.length;
    doc.users = doc.users.filter(function (u) { return u.id !== args[2]; });
    if (doc.users.length === before) fail('no user ' + args[2]);
    save(file, doc);
    process.stdout.write('removed ' + args[2] + '\n');
    return;
  }
  if (cmd === 'set') {
    var id = args[2];
    var role = args[3];
    if (!id || !role) fail('set needs <id> <role>');
    var apply = function (password) {
      var user;
      try { user = auth.makeUser(id, role, password); } catch (e) { fail(e.message); }
      var d = load(file);
      d.users = d.users.filter(function (u) { return u.id !== id; });
      d.users.push(user);
      save(file, d);
      process.stdout.write('user ' + id + ' (' + role + ') written to ' + file + '\n');
    };
    if (generate) {
      var pw = crypto.randomBytes(18).toString('base64url');
      apply(pw);
      process.stdout.write('password (shown once): ' + pw + '\n');
      return;
    }
    if (process.stdin.isTTY) fail('the password is read from stdin; pipe it in, or pass --generate');
    readStdinLine(apply);
    return;
  }
  fail('unknown command ' + cmd);
}

main();
