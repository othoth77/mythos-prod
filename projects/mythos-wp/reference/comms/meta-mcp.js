'use strict';
// =====================================================
// MYTHOS WP V2 — Meta "WhatsApp Business Tools" MCP descriptor (builder A)
// projects/mythos-wp/reference/comms/meta-mcp.js
//
// Descriptor + reachability probe ONLY. No MCP tool is invoked here: the MCP
// authenticates with OAuth (Facebook Login for Business) which is an owner
// step, and Meta positions it for development / testing / configuration —
// never for production customer messaging. Source of the tool list:
// https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp
// (18 tools are documented on that page at the time of writing).
// =====================================================
var https = require('https');
var http = require('http');
var ENDPOINT = 'https://mcp.facebook.com/whatsapp_business_tools';
var DOCS = 'https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp';
var INTEGRATION_KEY = 'meta-whatsapp-business-mcp';
var TOOLS = [
  'whatsapp_biz_businesses', 'whatsapp_biz_accounts', 'whatsapp_biz_phone_numbers', 'whatsapp_biz_add_phone_number',
  'whatsapp_biz_send_verification_code', 'whatsapp_biz_verify_phone_number', 'whatsapp_biz_register_phone_number',
  'whatsapp_biz_list_templates', 'whatsapp_biz_get_template', 'whatsapp_biz_create_template', 'whatsapp_biz_update_template', 'whatsapp_biz_delete_template',
  'whatsapp_biz_send_message', 'whatsapp_biz_configure_webhooks', 'whatsapp_biz_subscribe_webhook',
  'whatsapp_biz_configure_payments', 'whatsapp_biz_verify_business', 'whatsapp_biz_system_user_token'
];
var SCOPES = ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'];
function describe(probe) {
  return {
    key: INTEGRATION_KEY, endpoint: ENDPOINT, transport: 'streamable-http', status: 'beta',
    auth: 'oauth (Facebook Login for Business) — owner step, no credential is stored by MYTHOS WP',
    scopes: SCOPES.slice(), tool_namespace: 'whatsapp_biz_', tools: TOOLS.slice(), tools_documented: TOOLS.length, docs: DOCS,
    claude_code_command: 'claude mcp add --transport http whatsapp_business_tools ' + ENDPOINT,
    purpose: 'AI/developer operations only (discover WABAs, numbers, templates, webhooks) — never runtime customer messaging',
    owner_step: 'Sign in with Facebook Login for Business from the MCP client (Claude Code / Claude.ai) and grant the three scopes; MYTHOS WP never performs this login',
    invocation: 'not implemented (by design)',
    reachable: probe ? probe.reachable : null, probed_at: probe ? probe.checked_at : null, http_status: probe ? probe.http_status : null
  };
}
// probe({ url?, timeoutMs? }) → { reachable, http_status, checked_at, detail } — any HTTP answer (401/405 included) = reachable
function probe(o) {
  o = o || {};
  var target = o.url || ENDPOINT; var u;
  try { u = new URL(target); } catch (e) { return Promise.resolve({ reachable: false, http_status: null, checked_at: new Date().toISOString(), detail: 'invalid url' }); }
  if (u.protocol !== 'https:' && !/^(127\.|localhost$)/.test(u.hostname)) return Promise.resolve({ reachable: false, http_status: null, checked_at: new Date().toISOString(), detail: 'https only' });
  var mod = u.protocol === 'https:' ? https : http;
  var started = Date.now();
  return new Promise(function (resolve) {
    var done = false; var finish = function (r) { if (!done) { done = true; r.checked_at = new Date().toISOString(); r.duration_ms = Date.now() - started; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'GET', headers: { Accept: 'application/json, text/event-stream' }, timeout: o.timeoutMs || 8000 }, function (res) {
      res.on('data', function () {}); res.on('end', function () { finish({ reachable: true, http_status: res.statusCode, detail: 'HTTP ' + res.statusCode + (res.statusCode === 401 || res.statusCode === 405 ? ' (expected without OAuth)' : '') }); }); res.resume();
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { finish({ reachable: false, http_status: null, detail: 'TRANSPORT: ' + String(e && e.message || e).slice(0, 80) }); });
    req.end();
  });
}
// record(pool, result) → persists the probe on the integration row (when seeded) and in wp_health_checks
function record(pool, r) {
  var state = r.reachable ? 'ok' : 'error';
  return pool.query('UPDATE wp_integrations SET health_state = $2, health_detail = $3, last_checked_at = now(), last_ok_at = CASE WHEN $2 = \'ok\' THEN now() ELSE last_ok_at END, last_error = CASE WHEN $2 = \'ok\' THEN NULL ELSE $3 END, updated_at = now() WHERE key = $1', [INTEGRATION_KEY, state, String(r.detail || '').slice(0, 300)])
    .then(function () { return pool.query('INSERT INTO wp_health_checks (component, status, detail, duration_ms) VALUES ($1,$2,$3,$4)', ['integration:' + INTEGRATION_KEY, state, JSON.stringify({ reachable: r.reachable, http_status: r.http_status, detail: r.detail }), r.duration_ms || null]); })
    .then(function () { return true; }, function () { return false; });
}
function integrationRow(pool) {
  return pool.query('SELECT id, key, kind, name, base_url, config, status, health_state, health_detail, credentials_state, last_ok_at, last_error, last_checked_at FROM wp_integrations WHERE key = $1', [INTEGRATION_KEY]).then(function (r) { return r.rows[0] || null; }, function () { return null; });
}
module.exports = { ENDPOINT: ENDPOINT, INTEGRATION_KEY: INTEGRATION_KEY, TOOLS: TOOLS, SCOPES: SCOPES, describe: describe, probe: probe, record: record, integrationRow: integrationRow };
