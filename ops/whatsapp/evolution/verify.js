#!/usr/bin/env node
'use strict';
// =====================================================
// MYTHOS WhatsApp gateway — read-only readiness verifier
// ops/whatsapp/evolution/verify.js
//
// Answers, without sending anything, the questions Issue #170 asks before
// activation is even considered:
//   1. does the bridge see a complete, private, credentialed configuration
//      (same code path as `mythos-github-bridge notify-config`)?
//   2. is the gateway reachable from this host, and which version?
//   3. is the Evolution instance paired — connectionState `open`?
//   4. is sending still disabled?
//
// Guarantees: two GET requests at most, never a POST; the API key is read
// from the same 0600 file the bridge uses, sent as a header, and never
// printed, logged or echoed; response bodies pass the shared redaction
// before any part of them can reach the output; the gateway host is
// refused unless it is private (or ALLOW_PUBLIC=1), exactly like the bridge.
//
// Run it with the bridge's own environment, e.g. after installing the
// drop-in (README §5):
//   systemctl --user show-environment >/dev/null   # sanity
//   set -a; . <(sed -n 's/^Environment=//p' \
//        ~/.config/systemd/user/mythos-github-bridge.service.d/20-whatsapp.conf); set +a
//   node ops/whatsapp/evolution/verify.js
//
// Exit codes: 0 = ready for activation review; 2 = reachable but not ready
// (see `problems` / `instance_state`); 1 = gateway unreachable or the
// configuration is unusable.
// =====================================================

var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var url = require('url');

var ROOT = path.resolve(__dirname, '..', '..', '..');
var whatsapp = require(path.join(ROOT, 'projects/mythos-ai-executor/bridge/notify/whatsapp.js'));
var redact = require(path.join(ROOT, 'projects/mythos-orchestrator/lib/redact.js'));

var INSTANCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
var TIMEOUT_MS = 10000;
var MAX_BODY = 4000;

function credentialFileMode() {
  var file = process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE;
  if (!file) return null;
  try {
    var st = fs.statSync(file);
    return { path_set: true, mode: '0' + (st.mode & 511).toString(8), mode_ok: (st.mode & 511) === 384 };
  } catch (e) {
    return { path_set: true, mode: null, mode_ok: false, error: e.code || 'STAT_FAILED' };
  }
}

function readKey() {
  var file = process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE;
  if (file) {
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { return ''; }
  }
  return String(process.env.MYTHOS_BRIDGE_WHATSAPP_API_KEY || '').trim();
}

// GET helper: resolves { statusCode, json|null, text } — headers are never
// returned or logged; the body is truncated and redacted.
function getJson(target, key) {
  return new Promise(function (resolve, reject) {
    var parsed = new url.URL(target);
    var mod = parsed.protocol === 'https:' ? https : http;
    var req = mod.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'GET',
      headers: { accept: 'application/json', apikey: key, 'user-agent': 'mythos-whatsapp-verify/1' }
    }, function (res) {
      var chunks = [];
      var size = 0;
      res.on('data', function (c) { size += c.length; if (size <= MAX_BODY * 4) chunks.push(c); });
      res.on('end', function () {
        var text = redact.redact(Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY));
        var json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        resolve({ statusCode: res.statusCode, json: json, text: text });
      });
    });
    var settled = false;
    function fail(err) {
      if (settled) return;
      settled = true;
      try { req.destroy(); } catch (e) { /* gone */ }
      reject(new Error(redact.redact(String((err && err.message) || err)).slice(0, 200)));
    }
    req.setTimeout(TIMEOUT_MS, function () { fail(new Error('TIMEOUT')); });
    req.on('error', fail);
    req.end();
  });
}

async function main() {
  var cfg = whatsapp.config();
  var described = whatsapp.describe();
  var out = {
    checked_at: new Date().toISOString(),
    sending_enabled: cfg.enabled,
    provider: cfg.provider,
    base_url_host: described.base_url_host,
    base_url_private: described.base_url_private,
    instance: cfg.instance || null,
    instance_name_valid: INSTANCE_RE.test(cfg.instance || ''),
    recipients_configured: described.recipients_configured,
    credential_present: described.credential_present,
    credential_file: credentialFileMode(),
    bridge_problems: described.problems || [],
    gateway_reachable: false,
    gateway_version: null,
    instance_state: null,
    ready: false,
    verdict: null
  };

  var fatal = [];
  if (!cfg.baseUrl) fatal.push('MYTHOS_BRIDGE_WHATSAPP_BASE_URL is not set');
  if (!out.instance_name_valid) fatal.push('MYTHOS_BRIDGE_WHATSAPP_INSTANCE is missing or has an invalid alphabet');
  if (!out.credential_present) fatal.push('no credential readable (API_KEY_FILE unreadable/empty and API_KEY unset)');
  var host = null;
  try { host = new url.URL(cfg.baseUrl).hostname; } catch (e) { fatal.push('base URL is not a valid URL'); }
  if (host && !whatsapp.isPrivateHost(host) && !cfg.allowPublic) {
    fatal.push('gateway host is not private and ALLOW_PUBLIC=1 is not set — refusing to contact it');
  }
  if (fatal.length) {
    out.verdict = 'UNUSABLE_CONFIG';
    out.fatal = fatal;
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  var key = readKey();
  try {
    var root = await getJson(cfg.baseUrl + '/', key);
    out.gateway_reachable = root.statusCode > 0;
    out.gateway_http_status = root.statusCode;
    out.gateway_version = root.json && root.json.version ? String(root.json.version) : null;
    out.gateway_auth_ok = root.statusCode !== 401 && root.statusCode !== 403;
  } catch (e) {
    out.verdict = 'GATEWAY_UNREACHABLE';
    out.error = e.message;
    console.log(JSON.stringify(out, null, 2));
    process.exit(1);
  }

  try {
    var st = await getJson(cfg.baseUrl + '/instance/connectionState/' + encodeURIComponent(cfg.instance), key);
    out.instance_http_status = st.statusCode;
    if (st.statusCode === 404) {
      out.instance_state = 'NOT_CREATED';
    } else if (st.statusCode === 401 || st.statusCode === 403) {
      out.instance_state = 'UNAUTHORIZED';
      out.gateway_auth_ok = false;
    } else {
      var inst = st.json && (st.json.instance || st.json);
      out.instance_state = inst && inst.state ? String(inst.state) : 'UNKNOWN';
    }
  } catch (e) {
    out.instance_state = 'ERROR';
    out.error = e.message;
  }

  var paired = out.instance_state === 'open';
  var bridgeClean = out.bridge_problems.length === 0;
  var credOk = !out.credential_file || out.credential_file.mode_ok;
  out.ready = paired && bridgeClean && credOk && out.gateway_auth_ok === true;

  if (out.ready) {
    out.verdict = out.sending_enabled
      ? 'READY_AND_SENDING_ENABLED'
      : 'READY_FOR_ACTIVATION_REVIEW';
  } else {
    out.verdict = 'NOT_READY';
    out.why = []
      .concat(paired ? [] : ['instance not paired: connectionState is ' + out.instance_state + ' (needs `open`)'])
      .concat(bridgeClean ? [] : ['bridge notify-config problems are not empty'])
      .concat(credOk ? [] : ['credential file mode must be 0600'])
      .concat(out.gateway_auth_ok === true ? [] : ['gateway rejected the credential']);
  }
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ready ? 0 : 2);
}

main().catch(function (e) {
  console.log(JSON.stringify({ verdict: 'VERIFIER_ERROR', error: redact.redact(String(e && e.message || e)).slice(0, 200) }, null, 2));
  process.exit(1);
});
