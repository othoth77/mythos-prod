'use strict';
// =====================================================
// Facebook Ads Monitor — configuration and secret loading
// projects/meta-ads-monitor/lib/config.js
//
// Same discipline as mythos-ai-executor/free-llm/secrets.js: one private
// env-style file per integration, absence = "not configured", never
// invented. The token is returned to the caller only; it is never logged,
// written to state, or placed in the process environment.
//
//   ~/.config/meta-ads-monitor/meta.env   (mode 600, owned by the runner)
//     META_ADS_READ_TOKEN=...          required — a token with ads_read only
//     META_ADS_ACCOUNT_IDS=123,456     optional — default: every account the token sees
//     META_GRAPH_VERSION=v24.0         optional
// =====================================================

var fs = require('fs');
var os = require('os');
var path = require('path');

function secretFile() {
  return process.env.META_ADS_MONITOR_SECRET_FILE ||
    path.join(os.homedir(), '.config', 'meta-ads-monitor', 'meta.env');
}

function stateDir() {
  return process.env.META_ADS_MONITOR_STATE_DIR ||
    path.join(os.homedir(), '.local', 'state', 'meta-ads-monitor');
}

function parseEnv(text) {
  var out = {};
  String(text).split(/\r?\n/).forEach(function (line) {
    var m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().charAt(0) === '#') return;
    var v = m[2];
    if ((v.charAt(0) === '"' && v.slice(-1) === '"') || (v.charAt(0) === "'" && v.slice(-1) === "'")) v = v.slice(1, -1);
    out[m[1]] = v;
  });
  return out;
}

// load() → { state: 'CONFIGURED'|'NOT_CONFIGURED'|'CONFIG_INSECURE'|'CONFIG_INVALID',
//            reason, token?, accountIds[], version?, file }
function load() {
  var file = secretFile();
  var st;
  try { st = fs.statSync(file); } catch (e) {
    return { state: 'NOT_CONFIGURED', reason: 'secret file absent', file: file, accountIds: [] };
  }
  if (!st.isFile()) return { state: 'CONFIG_INVALID', reason: 'secret path is not a file', file: file, accountIds: [] };
  if ((st.mode & 0o077) !== 0) {
    return { state: 'CONFIG_INSECURE', reason: 'secret file must be mode 600 (group/other access found)', file: file, accountIds: [] };
  }
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    return { state: 'CONFIG_INSECURE', reason: 'secret file is not owned by the running user', file: file, accountIds: [] };
  }
  var env = parseEnv(fs.readFileSync(file, 'utf8'));
  var token = env.META_ADS_READ_TOKEN || '';
  if (!token) return { state: 'NOT_CONFIGURED', reason: 'META_ADS_READ_TOKEN missing in secret file', file: file, accountIds: [] };
  var ids = String(env.META_ADS_ACCOUNT_IDS || '').split(',').map(function (s) { return s.trim().replace(/^act_/, ''); })
    .filter(function (s) { return s.length; });
  if (ids.some(function (s) { return !/^\d{1,20}$/.test(s); })) {
    return { state: 'CONFIG_INVALID', reason: 'META_ADS_ACCOUNT_IDS must be numeric ids', file: file, accountIds: [] };
  }
  return { state: 'CONFIGURED', reason: null, token: token, accountIds: ids,
    version: env.META_GRAPH_VERSION || null, file: file };
}

module.exports = { secretFile: secretFile, stateDir: stateDir, parseEnv: parseEnv, load: load };
