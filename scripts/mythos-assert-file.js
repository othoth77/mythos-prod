#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS — deterministic file assertion for task acceptance checks
// scripts/mythos-assert-file.js
//
//   node scripts/mythos-assert-file.js <repo-relative path> <token>
//
// Exit 0 only when <path> is a regular file inside the current directory
// (the task worktree) and its content contains <token>; otherwise exit 1
// with the reason. Made for a task's Validation section, which the executor
// re-runs itself after the worker has finished (lib/measured-outcome.js):
// that grammar splits arguments on whitespace, so the token is one word —
// a unique marker such as LIVE-E2E-20260930-FABLE-OK.
// Reads one file; writes nothing; no network.
// =====================================================

var fs = require('fs');
var path = require('path');

function check(rel, token, cwd) {
  if (!rel || !token) return { ok: false, why: 'usage: mythos-assert-file.js <repo-relative path> <token>' };
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).indexOf('..') !== -1) return { ok: false, why: 'path must be repo-relative without ..: ' + rel };
  var abs = path.join(cwd, rel);
  var st;
  try { st = fs.lstatSync(abs); } catch (e) { return { ok: false, why: 'missing: ' + rel }; }
  if (!st.isFile()) return { ok: false, why: 'not a regular file: ' + rel };
  var text = fs.readFileSync(abs, 'utf8');
  if (text.indexOf(token) === -1) return { ok: false, why: rel + ' does not contain ' + token };
  return { ok: true, why: rel + ' contains ' + token + ' (' + text.length + ' bytes)' };
}

if (require.main === module) {
  var r = check(process.argv[2], process.argv[3], process.cwd());
  (r.ok ? console.log : console.error)((r.ok ? 'ok: ' : 'FAIL: ') + r.why);
  process.exit(r.ok ? 0 : 1);
}

module.exports = { check: check };
