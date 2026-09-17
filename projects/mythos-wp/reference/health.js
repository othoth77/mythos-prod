'use strict';
// =====================================================
// MYTHOS WP V2 — health center (wp_health_checks)
// projects/mythos-wp/reference/health.js
//
// One run = one row per component, persisted so the dashboard shows the
// LAST KNOWN state even when nothing is reachable right now:
//
//   database              SELECT 1 on the panel pool
//   backend               this process (version, uptime, memory)
//   receiver              webhook receiver configuration (enabled + token file)
//   whatsapp:<key>        every enabled whatsapp_provider integration
//                         (evolution: GET /instance/fetchInstances with the key file)
//   number:<instance>     every wp_phone_numbers row (provider connectionState)
//   kitchen:<key>         every enabled kitchen integration (/api/health)
//   ai                    the free-LLM pool: ≥ 1 provider with a key → ok, none → warning
//   integration:<key>     every other enabled integration (HTTP GET probe;
//                         loopback and https only; MCP: any HTTP answer = reachable)
//
// Every probe delegates to integrations.probe (no credential value is ever
// kept, logged or stored). The table keeps the last 2000 rows. The scheduler
// never starts on its own: server.js calls start() when
// MYTHOS_WP_HEALTH_INTERVAL_MS != 0; tests call runAll() explicitly.
// =====================================================
var path = require('path');
var integrations = require('./integrations');
var numbers = require('./comms/numbers');

var KEEP_ROWS = 2000;
var DEFAULT_INTERVAL_MS = 300000;
var VERSION = (function () { try { return require('../package.json').version; } catch (e) { return null; } })();

function nowIso() { return new Date().toISOString(); }
function res(component, r) { return { component: component, status: r.status, detail: r.detail || {}, checked_at: r.checked_at || nowIso(), duration_ms: r.duration_ms === undefined ? null : r.duration_ms }; }
function quick(component, status, detail, started) { return { component: component, status: status, detail: detail || {}, checked_at: nowIso(), duration_ms: started ? Date.now() - started : 0 }; }

function checkDatabase(pool) {
  var t0 = Date.now();
  return pool.query('SELECT 1').then(function () { return quick('database', 'ok', { latency_ms: Date.now() - t0 }, t0); }, function (e) { return quick('database', 'error', { reason: e && e.code ? String(e.code) : 'QUERY_FAILED' }, t0); });
}

function checkBackend() {
  var mem = process.memoryUsage();
  var rss = Math.round(mem.rss / 1048576);
  return Promise.resolve(quick('backend', rss > 768 ? 'warning' : 'ok', { version: VERSION, node: process.version, uptime_s: Math.round(process.uptime()), rss_mb: rss, pid: process.pid }, Date.now()));
}

function checkReceiver() {
  var d = null;
  try { d = require('./comms/receiver').describe(); } catch (e) { d = null; }
  if (!d) return Promise.resolve(quick('receiver', 'warning', { reason: 'RECEIVER_MODULE_UNAVAILABLE' }));
  if (!d.enabled) return Promise.resolve(quick('receiver', 'warning', { reason: 'RECEIVER_DISABLED', providers: d.providers }));
  if (!d.token_present) return Promise.resolve(quick('receiver', 'error', { reason: 'WEBHOOK_TOKEN_MISSING', providers: d.providers }));
  return Promise.resolve(quick('receiver', 'ok', { providers: d.providers, route: d.route }));
}

// component name per integration kind (mirrors the contract's vocabulary; no duplicates)
function componentFor(row) {
  if (row.kind === 'whatsapp_provider') return 'whatsapp:' + (row.config && row.config.provider === 'evolution' ? 'evolution' : row.key);
  if (row.kind === 'kitchen') return 'kitchen:' + row.key;
  if (row.kind === 'llm') return 'ai';
  if (row.kind === 'database') return null; // covered by the 'database' component
  return 'integration:' + row.key;
}

function checkIntegrations(pool, deps) {
  return integrations.list(pool, { status: 'enabled' }).then(function (rows) {
    if (Array.isArray(deps.integrationKeys)) rows = rows.filter(function (r) { return deps.integrationKeys.indexOf(r.key) !== -1; });
    var seen = {};
    rows = rows.filter(function (r) { var c = componentFor(r); if (!c || seen[c]) return false; seen[c] = true; return true; });
    return Promise.all(rows.map(function (row) {
      return integrations.probe(row, { pool: pool }).then(function (r) {
        return integrations.record(pool, row.key, r).catch(function () { return null; }).then(function () { return res(componentFor(row), r); });
      });
    })).then(function (out) {
      // The ai component is always present: no llm integration row → probe the registry directly.
      if (!out.some(function (c) { return c.component === 'ai'; }) && !(Array.isArray(deps.integrationKeys))) {
        return integrations.probe({ key: 'free-llm-pool', kind: 'llm', config: {} }, { pool: pool }).then(function (r) { out.push(res('ai', r)); return out; });
      }
      return out;
    });
  });
}

var NUMBER_STATE = { open: 'ok', connecting: 'warning', pairing: 'warning', close: 'disconnected', closed: 'disconnected', unknown: 'warning', unreachable: 'error' };
var NUMBER_STATUS = { open: 'open', connecting: 'pairing', pairing: 'pairing', close: 'closed', closed: 'closed' };

function providerModule(provider) {
  if (!/^[a-z_]{2,24}$/.test(String(provider || ''))) return null;
  try { return require(path.join(__dirname, 'comms', 'providers', provider)); } catch (e) { return null; }
}

function checkNumbers(pool, deps) {
  return pool.query('SELECT id, provider, instance, display_name, status, phone_ref FROM wp_phone_numbers ORDER BY id').then(function (r) {
    var rows = r.rows;
    if (Array.isArray(deps.numberInstances)) rows = rows.filter(function (n) { return deps.numberInstances.indexOf(n.instance) !== -1; });
    return Promise.all(rows.map(function (n) {
      var t0 = Date.now();
      var mod = providerModule(n.provider);
      var p = mod && typeof mod.health === 'function' ? Promise.resolve(mod.health({ instance: n.instance, timeoutMs: 4000 })).catch(function () { return { ok: false, state: 'unreachable', reason: 'PROBE_FAILED' }; }) : Promise.resolve({ ok: false, state: 'unknown', reason: 'PROVIDER_PROBE_UNAVAILABLE' });
      return p.then(function (h) {
        var state = h && typeof h.state === 'string' ? h.state : 'unknown';
        var status = NUMBER_STATE[state] || (h && h.ok ? 'ok' : 'warning');
        var detail = { state: state, provider: n.provider, display_name: n.display_name };
        if (h && h.reason) detail.reason = String(h.reason).replace(/\/[^\s]*/g, '[path]').slice(0, 120);
        // A CHECK THAT COULD NOT REACH THE GATEWAY IS NOT A DEVICE STATUS. Only a state the provider
        // really reported (NUMBER_STATUS) may change wp_phone_numbers.status; otherwise the last known
        // status stays and health_state carries the failure — see numbers.connectionOf.
        var reported = NUMBER_STATUS[state] || null;
        var newStatus = reported || n.status;
        if (!reported) { detail.kept_status = n.status; if (!detail.reason) detail.reason = 'gateway unreachable'; }
        var out = quick('number:' + n.instance, status, detail, t0);
        out.detail.connection = numbers.connectionOf({ status: newStatus, health_state: status, phone_ref: n.phone_ref }).state;
        return pool.query('UPDATE wp_phone_numbers SET health_state = $2, health_detail = $3, last_health_at = now(), status = $4, updated_at = now() WHERE id = $1 RETURNING id, provider, instance, status', [n.id, status, JSON.stringify(detail).slice(0, 200), newStatus])
          .then(function (up) { return reported && up.rows[0] ? numbers.syncInboxStatus(pool, up.rows[0]) : null; }, function () { return null; })
          .then(function () { return out; });
      });
    }));
  }, function () { return []; });
}

function persist(pool, components) {
  var chain = Promise.resolve();
  components.forEach(function (c) {
    chain = chain.then(function () { return pool.query('INSERT INTO wp_health_checks (component, status, detail, duration_ms, checked_at) VALUES ($1,$2,$3,$4,$5)', [String(c.component).slice(0, 64), c.status, JSON.stringify(c.detail || {}), c.duration_ms === null ? null : Math.round(c.duration_ms), c.checked_at]); });
  });
  return chain;
}

function prune(pool, keep) {
  keep = keep || KEEP_ROWS;
  return pool.query('DELETE FROM wp_health_checks WHERE id <= (SELECT id FROM wp_health_checks ORDER BY id DESC OFFSET $1 LIMIT 1)', [keep]).then(function (r) { return r.rowCount; });
}

function summarise(components) {
  var s = { ok: 0, warning: 0, error: 0, disconnected: 0 };
  components.forEach(function (c) { if (s[c.status] !== undefined) s[c.status]++; });
  return s;
}

// runAll(pool, deps) → the center document of THIS run (also persisted)
//   deps: { log, integrationKeys?: [keys to probe], numberInstances?: [instances to probe] } (the filters exist for tests)
function runAll(pool, deps) {
  deps = Object.assign({}, deps || {});
  // Diagnostics / tests may restrict what a run touches (comma-separated lists); production leaves both unset.
  if (!deps.integrationKeys && process.env.MYTHOS_WP_HEALTH_ONLY_KEYS) deps.integrationKeys = String(process.env.MYTHOS_WP_HEALTH_ONLY_KEYS).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!deps.numberInstances && process.env.MYTHOS_WP_HEALTH_ONLY_INSTANCES) deps.numberInstances = String(process.env.MYTHOS_WP_HEALTH_ONLY_INSTANCES).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var started = Date.now();
  return Promise.all([checkDatabase(pool), checkBackend(), checkReceiver(), checkIntegrations(pool, deps), checkNumbers(pool, deps)]).then(function (x) {
    var components = [x[0], x[1], x[2]].concat(x[3], x[4]).filter(Boolean);
    components.sort(function (a, b) { return a.component < b.component ? -1 : a.component > b.component ? 1 : 0; });
    return persist(pool, components).then(function () { return prune(pool); }).then(function () {
      var doc = { components: components, summary: summarise(components), generated_at: nowIso(), duration_ms: Date.now() - started };
      if (deps.log) deps.log({ level: doc.summary.error || doc.summary.disconnected ? 'warn' : 'info', health: 'run', summary: doc.summary, duration_ms: doc.duration_ms });
      return doc;
    });
  });
}

// center(pool) → latest row per component
function center(pool) {
  return pool.query('SELECT DISTINCT ON (component) component, status, detail, duration_ms, checked_at FROM wp_health_checks ORDER BY component, checked_at DESC, id DESC').then(function (r) {
    return { components: r.rows, summary: summarise(r.rows), generated_at: nowIso() };
  });
}

var timer = null, running = false;
function isRunning() { return running; }
function start(o) {
  o = o || {};
  if (timer) return timer;
  var interval = o.intervalMs === undefined ? DEFAULT_INTERVAL_MS : o.intervalMs;
  if (!interval || interval <= 0) return null;
  var tick = function () {
    if (running) return;
    running = true;
    runAll(o.pool, { log: o.log }).catch(function (e) { if (o.log) o.log({ level: 'warn', health: 'run_failed', reason: String(e && e.message || e).slice(0, 120) }); }).then(function () { running = false; });
  };
  timer = setInterval(tick, Math.max(interval, 10000));
  if (timer.unref) timer.unref();
  setTimeout(tick, Math.min(5000, interval)).unref();
  return timer;
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { isRunning: isRunning, KEEP_ROWS: KEEP_ROWS, DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS, componentFor: componentFor, runAll: runAll, center: center, prune: prune, persist: persist, start: start, stop: stop };
