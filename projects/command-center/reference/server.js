'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — process entry point
// projects/command-center/reference/server.js
//
// Separate from api.js on purpose: api.js exports createServer() and is
// required by tests, which must be able to mount the app on an ephemeral
// port without a module-load side effect starting a listener. This file is
// the only thing that binds a port, and it is what the systemd unit runs.
//
// BINDS LOOPBACK ONLY. Public exposure is nginx's job
// (deploy/nginx-ordre.mythosprod.xyz.conf), which terminates TLS and
// proxies to 127.0.0.1. Nothing here should ever listen on 0.0.0.0.
// =====================================================

var api = require('./api.js');
var auth = require('./auth.js');
var db = require('./db.js');

var PORT = parseInt(process.env.MCC_PORT || '3021', 10);
var HOST = '127.0.0.1';

// Refuse to start with an open write surface. The alternative — starting
// anyway and logging a warning — puts an editable library on a public
// domain and relies on someone reading logs. A process that will not start
// is noticed immediately; a warning is not.
if (auth.isUnconfigured()) {
  console.error(
    'FATAL: MCC_ADMIN_TOKENS is not configured. Refusing to start: without it every\n' +
    '       write endpoint would be open to anyone who can reach this server.\n' +
    '       Set it to a JSON object mapping bearer tokens to identity strings, e.g.\n' +
    '       MCC_ADMIN_TOKENS=\'{"<generated-token>":"owner"}\' in the EnvironmentFile.'
  );
  process.exit(1);
}

var missingDbEnv = db.REQUIRED_ENV.filter(function (name) { return !process.env[name]; });
if (missingDbEnv.length) {
  // Names only — never values.
  console.error('FATAL: missing required database environment variable(s): ' + missingDbEnv.join(', '));
  process.exit(1);
}

var server = api.createServer();

server.listen(PORT, HOST, function () {
  console.log('MYTHOS AI COMMAND CENTER listening on http://' + HOST + ':' + PORT);
});

// systemd sends SIGTERM on stop/restart. Draining the pool first avoids
// leaving a PostgreSQL backend allocated on every deploy.
function shutdown(signal) {
  return function () {
    console.log('received ' + signal + ', shutting down');
    server.close(function () {
      db.closePool().then(function () { process.exit(0); }).catch(function () { process.exit(0); });
    });
    // A client holding a connection open must not block a restart forever.
    setTimeout(function () { process.exit(0); }, 10000).unref();
  };
}

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));
