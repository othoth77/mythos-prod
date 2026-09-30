#!/usr/bin/env node
'use strict';
// Test double for /usr/bin/docker (restart + inspect only), used by
// tests/mythos-hostops-controlled-test.js via a generated wrapper:
//   fake-docker.js <stateDir> <args...>
var fs = require('fs');
var path = require('path');
var stateDir = process.argv[2];
var args = process.argv.slice(3);
fs.appendFileSync(path.join(stateDir, 'docker-calls.log'), JSON.stringify(args) + '\n');
if (args[0] === 'restart') process.exit(0);
if (args[0] === 'inspect') { process.stdout.write(JSON.stringify({ Status: 'running', Running: true, StartedAt: new Date().toISOString(), ExitCode: 0, OOMKilled: false }) + '\n'); process.exit(0); }
process.exit(1);
