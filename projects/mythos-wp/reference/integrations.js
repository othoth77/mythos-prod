'use strict';
// =====================================================
// MYTHOS WP V2 — integrations registry (wp_integrations)
// projects/mythos-wp/reference/integrations.js
//
// One row per external system the platform talks to: WhatsApp providers,
// the MYTHOS AUTO Kitchen, n8n, MCP servers, the free-LLM pool, the panel's
// own database. A row holds a non-secret location (loopback or https), the
// NAME of the environment variable that references a credential (a value or
// a 0600 file path) and non-secret configuration. This module NEVER reads a
// credential except to say whether it is present (credentials_state), and
// the only time a credential VALUE is read at all is the Evolution probe,
// which sends it as a request header to the provider itself — it is never
// stored, logged or returned.
//
//   ensureDefaults(pool)      seed the platform rows (idempotent, key-wise)
//   list / get / create / update / remove
//   credentialsState(row)     present | missing | not_required
//   probe(row, deps)          → { status, detail, checked_at, duration_ms }
//   record(pool, key, result) → writes health columns
//   test(pool, key, deps)     → probe + record → { status, detail, checked_at }
// =====================================================
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');

var KINDS = ['whatsapp_provider', 'kitchen', 'n8n', 'mcp', 'api', 'project_system', 'database', 'llm'];
var STATUSES = ['enabled', 'disabled'];
var HEALTH = ['ok', 'warning', 'error', 'disconnected', 'unknown'];
var KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
var ENV_RE = /^[A-Z][A-Z0-9_]{2,62}$/;
var PROBE_TIMEOUT_MS = 4000;
var LOOPBACK_RE = /^(127\.[0-9.]+|localhost|::1|\[::1\])$/;
var META_MCP_TOOLS = [
  'whatsapp_biz_businesses', 'whatsapp_biz_accounts', 'whatsapp_biz_phone_numbers', 'whatsapp_biz_add_phone_number',
  'whatsapp_biz_send_verification_code', 'whatsapp_biz_verify_phone_number', 'whatsapp_biz_register_phone_number',
  'whatsapp_biz_list_templates', 'whatsapp_biz_get_template', 'whatsapp_biz_create_template', 'whatsapp_biz_update_template', 'whatsapp_biz_delete_template',
  'whatsapp_biz_send_message', 'whatsapp_biz_configure_webhooks', 'whatsapp_biz_subscribe_webhook', 'whatsapp_biz_configure_payments',
  'whatsapp_biz_verify_business', 'whatsapp_biz_system_user_token'
];
// The names above are the ones the official documentation page listed on 2026-09-17 (18); nothing is invented to reach a count.
var META_MCP_TOOLS_SOURCE = 'https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp (read 2026-09-17)';

var DEFAULTS = [
  { key: 'evolution', kind: 'whatsapp_provider', name: 'Evolution API (WhatsApp, unofficial)', base_url: 'http://127.0.0.1:8080', credential_env: 'MYTHOS_WP_EVOLUTION_API_KEY_FILE', config: { provider: 'evolution', official: false }, status: 'enabled' },
  { key: 'kitchen-mythos-auto', kind: 'kitchen', name: 'MYTHOS AUTO Shared Kitchen', base_url: 'http://127.0.0.1:3011', credential_env: null, config: { contract: '1.3.0', read_only: true }, status: 'enabled' },
  { key: 'n8n', kind: 'n8n', name: 'n8n automations', base_url: 'http://127.0.0.1:5678', credential_env: null, config: { webhook_base: 'http://127.0.0.1:5678/webhook' }, status: 'enabled' },
  { key: 'meta-cloud-api', kind: 'whatsapp_provider', name: 'WhatsApp Cloud API (Meta, official)', base_url: 'https://graph.facebook.com', credential_env: 'MYTHOS_WP_META_ACCESS_TOKEN_FILE', config: { provider: 'meta_cloud', official: true, graph_version: 'v21.0' }, status: 'disabled' },
  { key: 'meta-whatsapp-business-mcp', kind: 'mcp', name: 'WhatsApp Business Tools MCP (Meta, beta)', base_url: 'https://mcp.facebook.com/whatsapp_business_tools', credential_env: null,
    config: { transport: 'streamable-http', auth: 'oauth (Facebook Login for Business)', scopes: ['business_management', 'whatsapp_business_management', 'whatsapp_business_messaging'], tool_namespace: 'whatsapp_biz_', tools: META_MCP_TOOLS, tools_source: META_MCP_TOOLS_SOURCE, purpose: 'AI/developer operations only — never runtime customer messaging', docs: 'https://developers.facebook.com/documentation/mcp/whatsapp-business-tools-mcp' },
    status: 'disabled', credentials_state: 'missing' },
  { key: 'mythos-mcp', kind: 'mcp', name: 'MYTHOS MCP (ContextForge gateway)', base_url: 'https://mythosprod.xyz/mcp', credential_env: null, config: { transport: 'streamable-http', auth: 'oauth (Dex, owner identity)' }, status: 'enabled' },
  { key: 'free-llm-pool', kind: 'llm', name: 'Free LLM pool (mythos-ai-executor)', base_url: null, credential_env: null, config: { registry: 'projects/mythos-ai-executor/free-llm' }, status: 'enabled' },
  { key: 'database', kind: 'database', name: 'MYTHOS WP database (mythos_wp)', base_url: null, credential_env: null, config: { database: 'mythos_wp' }, status: 'enabled' }
];

function fail(code, status, detail, errors) { var e = new Error(detail || code); e.code = code; e.status = status; if (errors) e.errors = errors; return e; }
function nowIso() { return new Date().toISOString(); }

// --- credentials: presence only, never the value ---------------------------
function credentialsState(row) {
  if (!row) return 'unknown';
  var env = row.credential_env;
  if (!env) return row.config && row.config.auth ? (row.credentials_state === 'present' ? 'present' : 'missing') : 'not_required';
  if (!ENV_RE.test(String(env))) return 'unknown';
  var v = process.env[env];
  if (!v) return 'missing';
  if (v.charAt(0) === '/' || v.indexOf('./') === 0 || v.indexOf('~') === 0) {
    var st;
    try { st = fs.statSync(v); } catch (e) { return 'missing'; }
    if (!st.isFile() || (st.mode & 0o077) !== 0) return 'missing';
    return 'present';
  }
  return 'present';
}

// SECURITY: this module never reads a credential VALUE. Probes that need one go through the provider module
// that owns it (providers/evolution.readApiKey() — fixed env name, fixed loopback base URL), so an admin-editable
// base_url or credential_env can never redirect a secret to another host.
// credential_env names are allowlisted: integration credentials only, never the panel's own secrets.
var CREDENTIAL_ENV_RE = /^MYTHOS_WP_(EVOLUTION_API_KEY_FILE|META_ACCESS_TOKEN_FILE|META_APP_SECRET_FILE|META_VERIFY_TOKEN_FILE|INTEGRATION_[A-Z0-9_]{2,40}(_FILE)?)$/;

// --- validation --------------------------------------------------------------
function validateUrl(u, errors, field) {
  if (u === null || u === undefined || u === '') return null;
  var parsed;
  try { parsed = new URL(String(u)); } catch (e) { errors[field] = 'must be an http(s) URL'; return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { errors[field] = 'http or https only'; return null; }
  if (parsed.protocol === 'http:' && !LOOPBACK_RE.test(parsed.hostname)) { errors[field] = 'plain http is allowed on loopback only'; return null; }
  if (parsed.username || parsed.password) { errors[field] = 'credentials in a URL are refused'; return null; }
  if (String(u).length > 255) { errors[field] = 'at most 255 characters'; return null; }
  return String(u).replace(/\/+$/, '');
}

function validate(body, existing) {
  body = body || {};
  var errors = {}, out = {};
  var v = function (k) { return body[k] !== undefined ? body[k] : (existing ? existing[k] : undefined); };
  var key = v('key');
  if (!existing) { if (!KEY_RE.test(String(key || ''))) errors.key = 'a-z 0-9 - (2–63), starts alphanumeric'; else out.key = key; }
  var kind = v('kind');
  if (KINDS.indexOf(kind) === -1) errors.kind = KINDS.join('|'); else out.kind = kind;
  var name = v('name');
  if (typeof name !== 'string' || !name.trim() || name.length > 120) errors.name = '1–120 characters'; else out.name = name.trim();
  if (body.base_url !== undefined || !existing) out.base_url = validateUrl(v('base_url'), errors, 'base_url');
  if (body.credential_env !== undefined || !existing) {
    var env = v('credential_env');
    if (env === null || env === undefined || env === '') out.credential_env = null;
    else if (!ENV_RE.test(String(env))) errors.credential_env = 'an environment variable NAME (A-Z 0-9 _)';
    else if (!CREDENTIAL_ENV_RE.test(String(env))) errors.credential_env = 'only integration credential names are accepted (MYTHOS_WP_INTEGRATION_*, the Evolution key file, the Meta files) — never the panel\'s own secrets';
    else out.credential_env = String(env);
  }
  if (body.config !== undefined || !existing) {
    var cfg = v('config');
    if (cfg === undefined || cfg === null) out.config = {};
    else if (typeof cfg !== 'object' || Array.isArray(cfg) || JSON.stringify(cfg).length > 16384) errors.config = 'a small JSON object';
    else if (Object.keys(cfg).some(function (k) { return /(token|secret|password|api_?key|credential)/i.test(k); })) errors.config = 'config must not carry a credential (reference it by env NAME in credential_env)';
    else if (cfg.webhook_base !== undefined && cfg.webhook_base !== null && validateUrl(cfg.webhook_base, errors, 'config') === null && errors.config) { /* errors.config set by validateUrl */ }
    else out.config = cfg;
  }
  if (body.status !== undefined || !existing) { var st = v('status') || 'enabled'; if (STATUSES.indexOf(st) === -1) errors.status = 'enabled|disabled'; else out.status = st; }
  if (body.project_id !== undefined || !existing) { var pid = v('project_id'); if (pid === undefined || pid === null || pid === '') out.project_id = null; else if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(pid))) errors.project_id = 'a project id'; else out.project_id = String(pid); }
  if (Object.keys(errors).length) throw fail('validation', 400, 'invalid integration', errors);
  return out;
}

// --- row shape (no secret column exists; credential_env is a NAME) --------------
function publicRow(r) {
  if (!r) return null;
  return { id: r.id, key: r.key, kind: r.kind, name: r.name, project_id: r.project_id, base_url: r.base_url, credential_env: r.credential_env, config: r.config || {}, status: r.status,
    health_state: r.health_state, health_detail: r.health_detail, credentials_state: r.credentials_state, last_ok_at: r.last_ok_at, last_error: r.last_error, last_checked_at: r.last_checked_at, created_at: r.created_at, updated_at: r.updated_at };
}

function ensureDefaults(pool) {
  var chain = Promise.resolve(); var seeded = [];
  DEFAULTS.forEach(function (d) {
    chain = chain.then(function () {
      var cred = d.credentials_state || credentialsState(d);
      return pool.query('INSERT INTO wp_integrations (key, kind, name, base_url, credential_env, config, status, credentials_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (key) DO NOTHING RETURNING key',
        [d.key, d.kind, d.name, d.base_url, d.credential_env, JSON.stringify(d.config || {}), d.status, cred]).then(function (r) { if (r.rows[0]) seeded.push(d.key); });
    });
  });
  return chain.then(function () { return { seeded: seeded }; });
}

function list(pool, o) {
  o = o || {};
  var params = [], where = [];
  if (o.kind && KINDS.indexOf(o.kind) !== -1) { params.push(o.kind); where.push('kind = $' + params.length); }
  if (o.status && STATUSES.indexOf(o.status) !== -1) { params.push(o.status); where.push('status = $' + params.length); }
  if (Array.isArray(o.projects)) { params.push(o.projects.map(String)); where.push('(project_id IS NULL OR project_id = ANY($' + params.length + '::text[]))'); }
  return pool.query('SELECT * FROM wp_integrations' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY kind, key', params).then(function (r) {
    return r.rows.map(function (row) { var p = publicRow(row); p.credentials_state = credentialsState(row); return p; });
  });
}

function get(pool, key) {
  if (!KEY_RE.test(String(key || ''))) return Promise.resolve(null);
  return pool.query('SELECT * FROM wp_integrations WHERE key = $1', [key]).then(function (r) { return r.rows[0] || null; });
}

function create(pool, body) {
  var v = validate(body, null);
  var cred = credentialsState(v);
  return pool.query('INSERT INTO wp_integrations (key, kind, name, project_id, base_url, credential_env, config, status, credentials_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [v.key, v.kind, v.name, v.project_id, v.base_url, v.credential_env, JSON.stringify(v.config), v.status, cred]).then(function (r) { return publicRow(r.rows[0]); }, function (e) {
    if (e && e.code === '23505') throw fail('conflict', 409, 'an integration with this key exists');
    if (e && e.code === '23503') throw fail('not_found', 404, 'unknown project');
    throw e;
  });
}

function update(pool, key, body) {
  return get(pool, key).then(function (existing) {
    if (!existing) throw fail('not_found', 404, 'no such integration');
    var v = validate(body || {}, existing);
    var sets = [], params = [existing.id];
    ['kind', 'name', 'project_id', 'base_url', 'credential_env', 'status'].forEach(function (k) { if (v[k] !== undefined) { params.push(v[k]); sets.push(k + ' = $' + params.length); } });
    if (v.config !== undefined) { params.push(JSON.stringify(v.config)); sets.push('config = $' + params.length); }
    var merged = Object.assign({}, existing, v);
    params.push(credentialsState(merged)); sets.push('credentials_state = $' + params.length);
    sets.push('updated_at = now()');
    return pool.query('UPDATE wp_integrations SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING *', params).then(function (r) { return { previous: publicRow(existing), row: publicRow(r.rows[0]) }; }, function (e) {
      if (e && e.code === '23503') throw fail('not_found', 404, 'unknown project');
      throw e;
    });
  });
}

function remove(pool, key) {
  return get(pool, key).then(function (existing) {
    if (!existing) throw fail('not_found', 404, 'no such integration');
    return pool.query('DELETE FROM wp_integrations WHERE id = $1', [existing.id]).then(function () { return { key: existing.key, deleted: true, previous: publicRow(existing) }; });
  });
}

// --- HTTP probe (GET; loopback http or https only) -------------------------
// httpProbe(url, { headers, timeoutMs }) → { reached:true, status, body, ms } | { reached:false, reason, ms }
function httpProbe(urlStr, o) {
  o = o || {};
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(String(urlStr)); } catch (e) { return resolve({ reached: false, reason: 'URL_INVALID', ms: 0 }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve({ reached: false, reason: 'URL_SCHEME', ms: 0 });
    if (u.protocol === 'http:' && !LOOPBACK_RE.test(u.hostname)) return resolve({ reached: false, reason: 'NOT_LOOPBACK_NOT_PROBED', ms: 0 });
    var mod = u.protocol === 'https:' ? https : http;
    var started = Date.now(), done = false;
    var finish = function (r) { if (!done) { done = true; r.ms = Date.now() - started; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: (u.pathname || '/') + (u.search || ''), method: 'GET', headers: Object.assign({ accept: 'application/json' }, o.headers || {}), timeout: o.timeoutMs || PROBE_TIMEOUT_MS }, function (res) {
      var chunks = [], size = 0;
      res.on('data', function (c) { size += c.length; if (size <= 262144) chunks.push(c); });
      res.on('end', function () { var body = null; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { body = null; } finish({ reached: true, status: res.statusCode, body: body }); });
    });
    req.on('timeout', function () { req.destroy(new Error('TIMEOUT')); finish({ reached: false, reason: 'TIMEOUT' }); });
    req.on('error', function (e) { finish({ reached: false, reason: e && e.message === 'TIMEOUT' ? 'TIMEOUT' : (e && e.code ? String(e.code) : 'UNREACHABLE') }); });
    req.end();
  });
}

function join(base, p) { return String(base || '').replace(/\/+$/, '') + p; }
function result(status, detail, started) { return { status: HEALTH.indexOf(status) !== -1 ? status : 'error', detail: detail || {}, checked_at: nowIso(), duration_ms: started ? Date.now() - started : 0 }; }
function unreachable(r) { return r.reason === 'NOT_LOOPBACK_NOT_PROBED' ? 'warning' : 'disconnected'; }

function probeEvolution(row, started) {
  // the provider module owns the credential AND the base URL (env, loopback): the row's base_url is informational
  var evo = require('./comms/providers/evolution');
  var key = evo.readApiKey();
  var headers = key.present ? { apikey: key.value } : {};
  key = null;
  return httpProbe(join(evo.baseUrl(), '/instance/fetchInstances'), { headers: headers }).then(function (r) {
    if (!r.reached) return result(unreachable(r), { reason: r.reason }, started);
    if (r.status === 401 || r.status === 403) return result('error', { reason: 'UNAUTHORIZED', http: r.status, credentials: credentialsState(row) }, started);
    if (r.status >= 200 && r.status < 300) {
      var list = Array.isArray(r.body) ? r.body : (r.body && Array.isArray(r.body.instances) ? r.body.instances : []);
      var open = list.filter(function (i) { var s = i && (i.connectionStatus || (i.instance && i.instance.status)); return s === 'open'; }).length;
      return result('ok', { instances: list.length, open: open, latency_ms: r.ms }, started);
    }
    return result('error', { reason: 'HTTP_' + r.status }, started);
  });
}

function probeKitchen(row, started) {
  return httpProbe(join(row.base_url, '/api/health')).then(function (r) {
    if (!r.reached) return result(unreachable(r), { reason: r.reason }, started);
    if (r.status >= 200 && r.status < 300 && r.body && (r.body.status === 'ok' || r.body.counts)) return result('ok', { status: r.body.status || null, counts: r.body.counts || null, read_only: r.body.read_only !== false, latency_ms: r.ms }, started);
    return result('error', { reason: 'HTTP_' + r.status }, started);
  });
}

function probeN8n(row, started) {
  return httpProbe(join(row.base_url, '/healthz')).then(function (r) {
    if (!r.reached) return result(unreachable(r), { reason: r.reason }, started);
    if (r.status >= 200 && r.status < 300) return result('ok', { latency_ms: r.ms, webhook_base: row.config && row.config.webhook_base ? row.config.webhook_base : null }, started);
    return result('warning', { reason: 'HTTP_' + r.status }, started);
  });
}

// MCP endpoints answer 401/405/406 to a bare GET — any HTTP answer means reachable.
function probeMcp(row, started) {
  return httpProbe(row.base_url).then(function (r) {
    if (!r.reached) return result(unreachable(r), { reason: r.reason }, started);
    return result('ok', { reachable: true, http: r.status, latency_ms: r.ms, auth: row.config && row.config.auth ? row.config.auth : null, credentials: credentialsState(row) }, started);
  });
}

function probeGeneric(row, started) {
  if (!row.base_url) return Promise.resolve(result('warning', { reason: 'NO_BASE_URL' }, started));
  return httpProbe(row.base_url).then(function (r) {
    if (!r.reached) return result(unreachable(r), { reason: r.reason }, started);
    if (r.status < 400 || r.status === 401 || r.status === 403 || r.status === 405) return result('ok', { http: r.status, latency_ms: r.ms }, started);
    if (r.status < 500) return result('warning', { reason: 'HTTP_' + r.status }, started);
    return result('error', { reason: 'HTTP_' + r.status }, started);
  });
}

function probeLlm(row, started) {
  var registry;
  try { registry = require(path.join(__dirname, '..', '..', 'mythos-ai-executor', 'free-llm', 'registry')); } catch (e) { return Promise.resolve(result('warning', { reason: 'REGISTRY_UNAVAILABLE' }, started)); }
  var entries;
  try { entries = registry.listEntries(); } catch (e) { return Promise.resolve(result('warning', { reason: 'REGISTRY_ERROR' }, started)); }
  var providers = {};
  entries.forEach(function (e) { if (!providers[e.provider_id]) providers[e.provider_id] = { wired: e.wired, keyed: e.credential_present === true, health: e.health ? e.health.status : null }; });
  var ids = Object.keys(providers);
  var keyed = ids.filter(function (id) { return providers[id].wired && providers[id].keyed; });
  var detail = { providers: ids.length, wired: ids.filter(function (id) { return providers[id].wired; }).length, with_key: keyed.length, keyed_ids: keyed.slice(0, 20) };
  return Promise.resolve(result(keyed.length ? 'ok' : 'warning', keyed.length ? detail : Object.assign({ reason: 'NO_PROVIDER_KEY' }, detail), started));
}

function probeDatabase(row, started, deps) {
  var pool = deps && deps.pool;
  if (!pool) return Promise.resolve(result('warning', { reason: 'NO_POOL' }, started));
  var t0 = Date.now();
  return pool.query('SELECT 1').then(function () { return result('ok', { latency_ms: Date.now() - t0 }, started); }, function (e) { return result('error', { reason: e && e.code ? String(e.code) : 'QUERY_FAILED' }, started); });
}

// probe(row, deps) → Promise<{ status, detail, checked_at, duration_ms }>; never rejects, never logs a value.
function probe(row, deps) {
  var started = Date.now();
  var run;
  try {
    if (!row) run = Promise.resolve(result('error', { reason: 'NO_ROW' }, started));
    else if (row.kind === 'database') run = probeDatabase(row, started, deps);
    else if (row.kind === 'llm') run = probeLlm(row, started);
    else if (row.kind === 'whatsapp_provider' && row.config && row.config.provider === 'meta_cloud') run = probeGeneric(row, started);
    else if (row.kind === 'whatsapp_provider') run = probeEvolution(row, started);
    else if (row.kind === 'kitchen') run = probeKitchen(row, started);
    else if (row.kind === 'n8n') run = probeN8n(row, started);
    else if (row.kind === 'mcp') run = probeMcp(row, started);
    else run = probeGeneric(row, started);
  } catch (e) { run = Promise.resolve(result('error', { reason: 'PROBE_FAILED' }, started)); }
  return run.catch(function () { return result('error', { reason: 'PROBE_FAILED' }, started); });
}

function detailText(d) { var s = ''; try { s = JSON.stringify(d || {}); } catch (e) { s = '{}'; } return s.slice(0, 300); }

// record(pool, key, result) → the updated public row
function record(pool, key, r) {
  return get(pool, key).then(function (row) {
    if (!row) return null;
    var state = HEALTH.indexOf(r.status) !== -1 ? r.status : 'unknown';
    var err = state === 'ok' ? null : String((r.detail && r.detail.reason) || state).slice(0, 300);
    return pool.query('UPDATE wp_integrations SET health_state = $2, health_detail = $3, last_checked_at = now(), last_ok_at = COALESCE($6::timestamptz, last_ok_at), last_error = $4, credentials_state = $5, updated_at = now() WHERE id = $1 RETURNING *',
      [row.id, state, detailText(r.detail), err, credentialsState(row), state === 'ok' ? new Date() : null]).then(function (u) { return publicRow(u.rows[0]); });
  });
}

// test(pool, key, deps) → { key, status, detail, checked_at, duration_ms, row }
function test(pool, key, deps) {
  return get(pool, key).then(function (row) {
    if (!row) throw fail('not_found', 404, 'no such integration');
    return probe(row, Object.assign({ pool: pool }, deps || {})).then(function (r) {
      return record(pool, key, r).then(function (updated) { return { key: row.key, status: r.status, detail: r.detail, checked_at: r.checked_at, duration_ms: r.duration_ms, row: updated }; });
    });
  });
}

module.exports = {
  KINDS: KINDS, STATUSES: STATUSES, HEALTH: HEALTH, DEFAULTS: DEFAULTS, META_MCP_TOOLS: META_MCP_TOOLS, PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS,
  credentialsState: credentialsState, validate: validate, publicRow: publicRow, ensureDefaults: ensureDefaults,
  list: list, get: get, create: create, update: update, remove: remove, httpProbe: httpProbe, probe: probe, record: record, test: test
};
