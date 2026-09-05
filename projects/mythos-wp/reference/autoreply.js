'use strict';
// =====================================================
// MYTHOS WP — Auto-Reply control centre (status + simulation)
// projects/mythos-wp/reference/autoreply.js
//
// Reads the MYTHOS AUTO engine of Issue #173 (projects/automotive/comms);
// builds nothing of its own. Two functions:
//
//   status(resolved)   OFF / DRY-RUN / ACTIVE plus provider, receiver,
//                      business-data, last event, last error, readiness —
//                      from the real configuration file named by
//                      MYTHOS_WP_COMMS_CONFIG (outside Git). No file → OFF,
//                      "not configured", and every other probe still runs.
//                      The provider probe is an unauthenticated GET of the
//                      gateway root on loopback; no token is read or sent.
//
//   simulate(resolved, text)  runs the WHOLE engine (engine.process) with
//                      forceDryRun on an in-memory ledger, with the panel's
//                      business-data ports connected: exactly what a live
//                      run would decide, the exact proposed text, every
//                      policy gate a live run would hit. Nothing leaves.
//                      When no real config exists a minimal in-memory one
//                      is derived from the project row (adapter evolution,
//                      loopback gateway, dry-run, auto_reply off).
// =====================================================

var fs = require('fs');
var http = require('http');
var path = require('path');
var crypto = require('crypto');

var COMMS = path.join(__dirname, '..', '..', 'automotive', 'comms');
var projects = require(path.join(COMMS, 'lib/projects'));
var engine = require(path.join(COMMS, 'lib/engine'));
var ledgerLib = require(path.join(COMMS, 'lib/ledger'));
var businessData = require(path.join(COMMS, 'lib/business-data'));
var evolutionAdapter = require(path.join(COMMS, 'lib/crm/evolution'));
var portsLib = require('./comms/ports');

var DEFAULT_GATEWAY = 'http://127.0.0.1:8080';
var PROBE_TIMEOUT_MS = 1500;

function loadConfig() {
  var file = process.env.MYTHOS_WP_COMMS_CONFIG;
  if (!file) return { present: false, reason: 'NOT_CONFIGURED', cfg: null, problems: [] };
  var cfg;
  try { cfg = projects.load(file); } catch (e) { return { present: false, reason: 'UNREADABLE', cfg: null, problems: [] }; }
  var problems = projects.validate(cfg);
  return { present: true, reason: null, cfg: cfg, problems: problems, file: path.basename(file) };
}

function probe(urlStr, pathname) {
  return new Promise(function (resolve) {
    var u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ reachable: false, reason: 'URL_INVALID' }); }
    if (!/^(127\.|localhost$|::1$)/.test(u.hostname)) return resolve({ reachable: null, reason: 'NOT_LOOPBACK_NOT_PROBED' });
    var started = Date.now();
    var req = http.request({ host: u.hostname, port: u.port || 80, path: pathname || '/', method: 'GET', timeout: PROBE_TIMEOUT_MS }, function (res) {
      var chunks = [];
      res.on('data', function (c) { if (chunks.length < 8) chunks.push(c); });
      res.on('end', function () {
        var body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8').slice(0, 4096)); } catch (e) { body = null; }
        resolve({ reachable: res.statusCode < 500, status: res.statusCode, ms: Date.now() - started, version: body && typeof body.version === 'string' ? body.version : null, body: body });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('TIMEOUT')); });
    req.on('error', function (e) { resolve({ reachable: false, reason: e && e.code ? e.code : 'ERROR', ms: Date.now() - started }); });
    req.end();
  });
}

// The ledger keeps one JSON file per event; names are hashes. Read the
// newest few for "last processed" / "last error" — names and states only.
function ledgerSummary(stateDir) {
  if (!stateDir) return { available: false, reason: 'STATE_DIR_NOT_SET' };
  var dir = path.join(projects.expandHome(stateDir), 'events');
  var files;
  try { files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }); } catch (e) { return { available: false, reason: 'STATE_DIR_UNREADABLE' }; }
  var stats = files.map(function (f) { try { return { f: f, m: fs.statSync(path.join(dir, f)).mtimeMs }; } catch (e) { return null; } }).filter(Boolean).sort(function (a, b) { return b.m - a.m; });
  var counts = {};
  var last = null, lastError = null;
  stats.slice(0, 200).forEach(function (s) {
    var rec; try { rec = JSON.parse(fs.readFileSync(path.join(dir, s.f), 'utf8')); } catch (e) { return; }
    counts[rec.state] = (counts[rec.state] || 0) + 1;
    var view = { event_id: rec.event_id, state: rec.state, project_id: rec.project_id || null, action: rec.action || null, intent: rec.intent || null, decision_reason: rec.decision_reason || null, rejections: rec.rejections || null, at: rec.updated_at || rec.received_at || null };
    if (!last) last = view;
    if (!lastError && (rec.state === 'SEND_FAILED' || rec.error)) lastError = Object.assign({ error: rec.error || null }, view);
  });
  var provider = null;
  try { provider = JSON.parse(fs.readFileSync(path.join(projects.expandHome(stateDir), 'provider.json'), 'utf8')); } catch (e) { provider = null; }
  return { available: true, events_total: files.length, states: counts, last_event: last, last_error: lastError, provider_breaker: provider ? { failures: provider.failures, open: provider.open_until > Date.now(), last_error: provider.last_error || null } : null };
}

function mode(loaded, readiness) {
  if (!loaded.present || loaded.problems.length) return 'OFF';
  if (!readiness.projects_auto_reply_on.length) return 'OFF';
  return readiness.can_send ? 'ACTIVE' : 'DRY-RUN';
}

function businessDataStatus(resolved) {
  var ports = portsLib.create({ resolveProject: function () { return resolved; } });
  return Promise.all([
    resolved.catalogPool ? resolved.catalogPool.query("SELECT count(*)::int AS n FROM sya_products WHERE status IN ('active','updated')").then(function (r) { return r.rows[0].n; }, function () { return null; }) : Promise.resolve(null),
    resolved.wpPool.query('SELECT count(*)::int AS n FROM wp_product_commercial WHERE project_id = $1 AND selling_price IS NOT NULL', [resolved.project.id]).then(function (r) { return r.rows[0].n; }),
    resolved.wpPool.query("SELECT count(*)::int AS n FROM wp_stock WHERE project_id = $1 AND availability <> 'unknown'", [resolved.project.id]).then(function (r) { return r.rows[0].n; }),
    resolved.wpPool.query("SELECT count(*)::int AS n FROM wp_knowledge WHERE project_id = $1 AND status = 'active' AND allowed_for_auto_reply", [resolved.project.id]).then(function (r) { return r.rows[0].n; })
  ]).then(function (r) {
    return {
      connected: ports.connected, not_connected: ports.notConnected,
      catalogue: { configured: !!resolved.catalogPool, reachable: r[0] !== null, active_products: r[0] },
      verified_prices: r[1], verified_stock: r[2], knowledge_allowed: r[3],
      required_by_intent: businessData.REQUIRED_BY_INTENT
    };
  });
}

function status(resolved) {
  var loaded = loadConfig();
  var readiness = loaded.present ? engine.readiness(loaded.cfg) : null;
  var eng = loaded.present ? projects.engine(loaded.cfg) : null;
  var gateway = loaded.present && loaded.cfg.crm && loaded.cfg.crm.base_url ? loaded.cfg.crm.base_url : DEFAULT_GATEWAY;
  var receiverUrl = eng ? 'http://' + (eng.receiver.bind || '127.0.0.1') + ':' + eng.receiver.port : null;
  var projectCfg = loaded.present ? (loaded.cfg.projects || []).filter(function (p) { return p && p.id === resolved.project.id; })[0] || null : null;
  return Promise.all([
    probe(gateway, '/'),
    receiverUrl ? probe(receiverUrl, '/healthz') : Promise.resolve({ reachable: null, reason: 'NOT_CONFIGURED' }),
    businessDataStatus(resolved)
  ]).then(function (r) {
    var m = loaded.present ? mode(loaded, readiness) : 'OFF';
    return {
      mode: m,
      config: { present: loaded.present, reason: loaded.reason, file: loaded.file || null, problems: loaded.problems, engine_mode: eng ? eng.mode : null, send_handoff_ack: eng ? eng.send_handoff_ack : null, max_replies_per_hour: eng ? eng.max_replies_per_conversation_per_hour : null, generator: eng ? eng.ai.generator : null },
      project: projectCfg ? { id: projectCfg.id, handler: projectCfg.business && projectCfg.business.handler || 'handoff', auto_reply: !!(projectCfg.business && projectCfg.business.auto_reply), provider: projectCfg.whatsapp && projectCfg.whatsapp.provider || null, inboxes: projectCfg.crm && projectCfg.crm.inbox_ids || [] } : { id: resolved.project.id, configured: false },
      readiness: readiness ? { can_send: readiness.can_send, mode: readiness.mode, state_dir_set: readiness.state_dir_set, webhook_token: readiness.webhook_token, api_token: readiness.api_token, projects_auto_reply_on: readiness.projects_auto_reply_on, ai: readiness.ai } : null,
      provider: Object.assign({ kind: 'evolution', url_host: (function () { try { return new URL(gateway).host; } catch (e) { return null; } })() }, r[0]),
      receiver: Object.assign({ url_host: receiverUrl ? receiverUrl.replace(/^http:\/\//, '') : null }, r[1]),
      business_data: r[2],
      ledger: eng ? ledgerSummary(eng.state_dir) : { available: false, reason: 'NOT_CONFIGURED' },
      safety: {
        default_off: true,
        never_invented: ['price', 'stock', 'compatibility', 'oem_reference', 'availability', 'order_status'],
        unknown_outcome: 'REQUIRES_HUMAN',
        gates: ['AUTO_REPLY_DISABLED', 'MODE_DRY_RUN', 'BUSINESS_DATA_MISSING', 'REQUIRES_HUMAN', 'FACT_GUARD_VIOLATION', 'REPLY_RATE_EXCEEDED', 'PROVIDER_NOT_CONFIGURED', 'CREDENTIAL_MISSING']
      },
      generated_at: new Date().toISOString()
    };
  });
}

// A minimal, valid configuration for simulation only, derived from the
// project row. Token files are NAMES that do not exist: simulate never
// reads them (forceDryRun) and the policy reports CREDENTIAL_MISSING.
function syntheticConfig(project, vehicleModels) {
  return {
    schema: 'mythos-auto-comms-config/1',
    crm: { adapter: 'evolution', base_url: DEFAULT_GATEWAY, api_token_file: '/nonexistent/mythos-wp-simulation/api-token', webhook_token_file: '/nonexistent/mythos-wp-simulation/webhook-token', reserved_inbox_ids: ['mythos-bridge'] },
    auto_reply: { mode: 'dry-run', send_handoff_ack: false },
    projects: [{
      id: project.id, display_name: project.display_name,
      crm: { account_id: evolutionAdapter.ACCOUNT_ID || 'evolution', inbox_ids: [project.id] },
      whatsapp: { provider: 'evolution', unofficial_acknowledged: true },
      business: { handler: 'auto-reply', auto_reply: false, vehicle_models: vehicleModels }
    }]
  };
}

function webhookBody(instance, text) {
  return {
    event: 'messages.upsert', instance: instance, sender: '21600000000@s.whatsapp.net',
    data: { key: { remoteJid: '21699000000@s.whatsapp.net', fromMe: false, id: 'SIM' + crypto.randomBytes(8).toString('hex').toUpperCase() }, pushName: 'Simulation', message: { conversation: String(text) }, messageTimestamp: Math.floor(Date.now() / 1000) }
  };
}

// simulate(resolved, text) → the engine's redacted outcome record + the
// facts each port answered (names and verified data), so the operator sees
// VERIFIED vs UNKNOWN per kind.
function simulate(resolved, text) {
  text = String(text || '').slice(0, 2000);
  var loaded = loadConfig();
  var vehicles = resolved.catalogPool ? resolved.catalogPool.query('SELECT DISTINCT model_name FROM sya_vehicle_models ORDER BY 1 LIMIT 60').then(function (r) { return r.rows.map(function (x) { return x.model_name; }).filter(function (m) { return /^[A-Za-z0-9][A-Za-z0-9 .-]{0,39}$/.test(m); }); }, function () { return []; }) : Promise.resolve([]);
  return vehicles.then(function (models) {
    var cfg, instance, source;
    var real = loaded.present && !loaded.problems.length ? (loaded.cfg.projects || []).filter(function (p) { return p && p.id === resolved.project.id; })[0] : null;
    if (real && real.crm && real.crm.inbox_ids && real.crm.inbox_ids.length) { cfg = loaded.cfg; instance = String(real.crm.inbox_ids[0]); source = 'config'; }
    else { cfg = syntheticConfig(resolved.project, models); instance = resolved.project.id; source = 'synthetic'; }
    var ports = portsLib.create({ resolveProject: function () { return resolved; } });
    var token = 'simulation-token-' + crypto.randomBytes(8).toString('hex');
    return engine.process({
      cfg: cfg, body: webhookBody(instance, text), query: { token: token }, headers: {}, expectedToken: token, apiToken: null,
      ledger: ledgerLib.open({ memory: true }), business_data: ports, forceDryRun: true
    }).then(function (rec) {
      var d = rec.decision || {};
      var facts = d.facts || { required: [], available: [], missing: [] };
      return {
        source: source, mode: 'dry-run', sent: false,
        outcome: rec.outcome, reason: rec.reason, stage: rec.stage,
        intent: d.intent || null, language: d.language || null, entities: d.entities || null,
        action: d.action || null, decision_reason: d.reason || null, requires_human: d.requires_human === true,
        facts: { required: facts.required, verified: facts.available, unknown: facts.missing },
        proposed_text: rec.proposed ? rec.proposed.text : null,
        policy: rec.policy || null,
        would_send_live: !!(rec.policy && rec.policy.rejections && rec.policy.rejections.filter(function (x) { return x !== 'MODE_DRY_RUN' && x !== 'AUTO_REPLY_DISABLED' && x !== 'CREDENTIAL_MISSING'; }).length === 0 && d.action === 'reply')
      };
    });
  });
}

module.exports = { loadConfig: loadConfig, probe: probe, ledgerSummary: ledgerSummary, status: status, simulate: simulate, syntheticConfig: syntheticConfig, webhookBody: webhookBody };
