'use strict';
// =====================================================
// MYTHOS WP V2 — automations engine (wp_automations / wp_automation_runs)
// projects/mythos-wp/reference/automations.js
//
// Small, deterministic rules that react to the comms bus:
//
//   trigger    conversation.created | message.received | conversation.inactive | handoff.requested
//   conditions { keywords:[…] (case-insensitive substring of the inbound text), inbox_id, handler, status, inactive_minutes }
//   actions    assign_agent { agent_id | agent:'project_default' } · assign_user { username } · tag { name }
//              set_status { status } · handoff { reason } · ai_suggest · ai_reply · n8n_webhook { path, include_text } · note { text }
//
// Rules of a project run together with the global rows (project_id NULL), in
// position order. Every matched rule leaves one wp_automation_runs row
// (result ok | skipped | error, detail = per-action outcomes and reasons —
// never message text). Modules other builders own (comms/handoff.js,
// ai/agents.js, assistant.autoReply) are required lazily: when absent the
// action is 'skipped' with reason MODULE_UNAVAILABLE, never an exception.
// The n8n webhook posts identifiers only unless action.include_text === true.
//
// attach(pool, log) subscribes once; start() also schedules sweepInactive()
// every 10 minutes. Nothing starts on require.
// =====================================================
var http = require('http');
var https = require('https');
var bus = require('./comms/bus');
var inbox = require('./comms/inbox');
var store = require('./projects-store');

var TRIGGERS = ['conversation.created', 'message.received', 'conversation.inactive', 'handoff.requested'];
var ACTIONS = ['assign_agent', 'assign_user', 'tag', 'set_status', 'handoff', 'ai_suggest', 'ai_reply', 'n8n_webhook', 'note'];
var HANDLERS = ['ai', 'human'];
var HUMAN_KEYWORDS = ['human', 'humain', 'agent', 'conseiller', 'personne', 'شخص', 'بشري', 'عون'];
var WEBHOOK_TIMEOUT_MS = 5000;
var SWEEP_INTERVAL_MS = 600000;
var SWEEP_LIMIT = 100;
var MAX_ACTIONS = 10;

var DEFAULTS = [
  { name: 'Route new conversation to the project agent', trigger: 'conversation.created', conditions: {}, actions: [{ type: 'assign_agent', agent: 'project_default' }], position: 10 },
  { name: 'Customer asks for a human', trigger: 'message.received', conditions: { keywords: HUMAN_KEYWORDS }, actions: [{ type: 'handoff', reason: 'CUSTOMER_REQUESTED_HUMAN' }], position: 20 },
  { name: 'Answer with the project agent', trigger: 'message.received', conditions: { handler: 'ai' }, actions: [{ type: 'ai_reply' }], position: 100 }
];

function fail(code, status, detail, errors) { var e = new Error(detail || code); e.code = code; e.status = status; if (errors) e.errors = errors; return e; }
function mask(n) { n = String(n || ''); return n.length > 3 ? '***' + n.slice(-3) : '***'; }
function clampInt(v, d, lo, hi) { var n = parseInt(v, 10); if (isNaN(n)) n = d; return Math.max(lo, Math.min(hi, n)); }
function lazy(mod) { try { return require(mod); } catch (e) { return null; } }

// --- validation --------------------------------------------------------------
function validateConditions(c, errors) {
  if (c === undefined || c === null) return {};
  if (typeof c !== 'object' || Array.isArray(c)) { errors.conditions = 'an object'; return null; }
  var out = {};
  if (c.keywords !== undefined) {
    if (!Array.isArray(c.keywords) || c.keywords.length > 20 || !c.keywords.every(function (k) { return typeof k === 'string' && k.trim().length >= 1 && k.length <= 64; })) { errors.conditions = 'keywords: up to 20 strings (1–64 chars)'; return null; }
    out.keywords = c.keywords.map(function (k) { return k.trim().toLowerCase(); }).filter(Boolean);
  }
  if (c.inbox_id !== undefined && c.inbox_id !== null) { var ib = parseInt(c.inbox_id, 10); if (!ib || ib < 1) { errors.conditions = 'inbox_id: a positive integer'; return null; } out.inbox_id = ib; }
  if (c.handler !== undefined && c.handler !== null) { if (HANDLERS.indexOf(c.handler) === -1) { errors.conditions = 'handler: ai|human'; return null; } out.handler = c.handler; }
  if (c.status !== undefined && c.status !== null) { if (inbox.STATUSES.indexOf(c.status) === -1) { errors.conditions = 'status: ' + inbox.STATUSES.join('|'); return null; } out.status = c.status; }
  if (c.inactive_minutes !== undefined && c.inactive_minutes !== null) { var im = parseInt(c.inactive_minutes, 10); if (!im || im < 5 || im > 43200) { errors.conditions = 'inactive_minutes: 5–43200'; return null; } out.inactive_minutes = im; }
  return out;
}

function validateAction(a) {
  if (!a || typeof a !== 'object' || ACTIONS.indexOf(a.type) === -1) return { error: 'type: ' + ACTIONS.join('|') };
  var out = { type: a.type };
  switch (a.type) {
    case 'assign_agent':
      if (a.agent === 'project_default' || a.agent_id === 'project_default') out.agent = 'project_default';
      else { var ag = parseInt(a.agent_id, 10); if (!ag || ag < 1) return { error: 'assign_agent needs agent_id or agent:"project_default"' }; out.agent_id = ag; }
      break;
    case 'assign_user':
      if (!/^[a-z][a-z0-9._-]{1,31}$/.test(String(a.username || ''))) return { error: 'assign_user needs a username' };
      out.username = a.username; break;
    case 'tag':
      if (!/^[a-z0-9][a-z0-9_.-]{0,47}$/.test(String(a.name || '').toLowerCase())) return { error: 'tag needs a name (a-z 0-9 _ . -)' };
      out.name = String(a.name).toLowerCase(); break;
    case 'set_status':
      if (inbox.STATUSES.indexOf(a.status) === -1) return { error: 'set_status: ' + inbox.STATUSES.join('|') };
      out.status = a.status; break;
    case 'handoff':
      if (a.reason !== undefined && !/^[A-Z][A-Z0-9_]{2,63}$/.test(String(a.reason))) return { error: 'handoff reason: UPPER_SNAKE' };
      out.reason = a.reason || 'AUTOMATION'; break;
    case 'n8n_webhook':
      if (!/^[A-Za-z0-9][A-Za-z0-9_\/.-]{0,199}$/.test(String(a.path || '')) || String(a.path).indexOf('..') !== -1) return { error: 'n8n_webhook needs a path (letters, digits, _ / . -)' };
      out.path = String(a.path).replace(/^\/+/, ''); out.include_text = a.include_text === true;
      if (a.integration !== undefined && a.integration !== null) { if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(a.integration))) return { error: 'n8n_webhook integration: an integration key' }; out.integration = String(a.integration); }
      break;
    case 'note':
      if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > 4000) return { error: 'note needs text (1–4000)' };
      out.text = a.text.trim(); break;
    default: break; // ai_suggest, ai_reply carry nothing
  }
  return { action: out };
}

function validate(body, existing) {
  body = body || {};
  var errors = {}, out = {};
  var v = function (k) { return body[k] !== undefined ? body[k] : (existing ? existing[k] : undefined); };
  var name = v('name');
  if (typeof name !== 'string' || !name.trim() || name.length > 120) errors.name = '1–120 characters'; else out.name = name.trim();
  var trigger = v('trigger');
  if (TRIGGERS.indexOf(trigger) === -1) errors.trigger = TRIGGERS.join('|'); else out.trigger = trigger;
  if (body.conditions !== undefined || !existing) { var c = validateConditions(v('conditions'), errors); if (c) out.conditions = c; }
  if (body.actions !== undefined || !existing) {
    var acts = v('actions');
    if (!Array.isArray(acts) || !acts.length || acts.length > MAX_ACTIONS) errors.actions = '1–' + MAX_ACTIONS + ' actions';
    else {
      var list = [], bad = null;
      acts.forEach(function (a, i) { var r = validateAction(a); if (r.error && !bad) bad = 'actions[' + i + ']: ' + r.error; else if (r.action) list.push(r.action); });
      if (bad) errors.actions = bad; else out.actions = list;
    }
  }
  if (body.enabled !== undefined || !existing) { var en = v('enabled'); if (en === undefined) en = true; if (typeof en !== 'boolean') errors.enabled = 'true|false'; else out.enabled = en; }
  if (body.position !== undefined || !existing) { var pos = v('position'); out.position = pos === undefined || pos === null ? 100 : clampInt(pos, 100, 0, 100000); }
  if (body.project_id !== undefined || !existing) { var pid = v('project_id'); if (pid === undefined || pid === null || pid === '' || pid === 'all') out.project_id = null; else if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(pid))) errors.project_id = 'a project id or null'; else out.project_id = String(pid); }
  if (out.trigger === 'conversation.inactive' && out.conditions && !out.conditions.inactive_minutes) errors.conditions = 'conversation.inactive needs conditions.inactive_minutes';
  if (Object.keys(errors).length) throw fail('validation', 400, 'invalid automation', errors);
  return out;
}

// --- CRUD ----------------------------------------------------------------------
function list(pool, o) {
  o = o || {};
  var params = [], where = [];
  if (o.project && o.project !== 'all') { params.push(String(o.project)); where.push('(project_id IS NULL OR project_id = $1)'); }
  else if (Array.isArray(o.projects)) { params.push(o.projects.map(String)); where.push('(project_id IS NULL OR project_id = ANY($1::text[]))'); }
  return pool.query('SELECT a.*, (SELECT count(*)::int FROM wp_automation_runs r WHERE r.automation_id = a.id AND r.at > now() - interval \'24 hours\') AS runs_24h, (SELECT max(r.at) FROM wp_automation_runs r WHERE r.automation_id = a.id) AS last_run_at FROM wp_automations a' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY position, id', params).then(function (r) { return r.rows; });
}
function get(pool, id) { return pool.query('SELECT * FROM wp_automations WHERE id = $1', [id]).then(function (r) { return r.rows[0] || null; }); }
function create(pool, actor, body) {
  var v = validate(body, null);
  return pool.query('INSERT INTO wp_automations (project_id, name, trigger, conditions, actions, enabled, position, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [v.project_id, v.name, v.trigger, JSON.stringify(v.conditions || {}), JSON.stringify(v.actions), v.enabled, v.position, String(actor || 'system').slice(0, 64)]).then(function (r) { return r.rows[0]; }, function (e) { if (e && e.code === '23503') throw fail('not_found', 404, 'unknown project'); throw e; });
}
function update(pool, id, body) {
  return get(pool, id).then(function (existing) {
    if (!existing) throw fail('not_found', 404, 'no such automation');
    var v = validate(body || {}, existing);
    var sets = [], params = [id];
    ['project_id', 'name', 'trigger', 'enabled', 'position'].forEach(function (k) { if (v[k] !== undefined) { params.push(v[k]); sets.push(k + ' = $' + params.length); } });
    if (v.conditions !== undefined) { params.push(JSON.stringify(v.conditions)); sets.push('conditions = $' + params.length); }
    if (v.actions !== undefined) { params.push(JSON.stringify(v.actions)); sets.push('actions = $' + params.length); }
    sets.push('updated_at = now()');
    return pool.query('UPDATE wp_automations SET ' + sets.join(', ') + ' WHERE id = $1 RETURNING *', params).then(function (r) { return { previous: existing, row: r.rows[0] }; }, function (e) { if (e && e.code === '23503') throw fail('not_found', 404, 'unknown project'); throw e; });
  });
}
function setEnabled(pool, id, enabled) {
  return pool.query('UPDATE wp_automations SET enabled = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, enabled === true]).then(function (r) { if (!r.rows[0]) throw fail('not_found', 404, 'no such automation'); return r.rows[0]; });
}
function remove(pool, id) {
  return get(pool, id).then(function (existing) {
    if (!existing) throw fail('not_found', 404, 'no such automation');
    return pool.query('DELETE FROM wp_automations WHERE id = $1', [id]).then(function () { return { id: existing.id, deleted: true, previous: existing }; });
  });
}
function listRuns(pool, o) {
  o = o || {};
  var params = [], where = [];
  if (o.automation_id) { params.push(o.automation_id); where.push('r.automation_id = $' + params.length); }
  if (o.project && o.project !== 'all') { params.push(String(o.project)); where.push('r.project_id = $' + params.length); }
  else if (Array.isArray(o.projects)) { params.push(o.projects.map(String)); where.push('(r.project_id IS NULL OR r.project_id = ANY($' + params.length + '::text[]))'); }
  if (o.conversation_id) { params.push(o.conversation_id); where.push('r.conversation_id = $' + params.length); }
  params.push(clampInt(o.limit, 50, 1, 500));
  return pool.query('SELECT r.id, r.automation_id, a.name AS automation_name, r.project_id, r.conversation_id, r.trigger, r.result, r.detail, r.at FROM wp_automation_runs r LEFT JOIN wp_automations a ON a.id = r.automation_id' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY r.at DESC, r.id DESC LIMIT $' + params.length, params).then(function (r) { return r.rows; });
}

function ensureDefaults(pool) {
  var chain = Promise.resolve(); var seeded = [];
  DEFAULTS.forEach(function (d) {
    chain = chain.then(function () {
      return pool.query('SELECT id FROM wp_automations WHERE project_id IS NULL AND name = $1', [d.name]).then(function (r) {
        if (r.rows[0]) return null;
        return pool.query('INSERT INTO wp_automations (project_id, name, trigger, conditions, actions, enabled, position, created_by) VALUES (NULL,$1,$2,$3,$4,true,$5,\'system\') RETURNING id', [d.name, d.trigger, JSON.stringify(d.conditions), JSON.stringify(d.actions), d.position]).then(function (i) { seeded.push(i.rows[0].id); });
      });
    });
  });
  return chain.then(function () { return { seeded: seeded }; });
}

// --- execution -----------------------------------------------------------------
function loadContext(pool, convId, messageId) {
  return pool.query('SELECT c.id, c.project_id, c.inbox_id, c.contact_id, c.handler, c.status, c.agent_id, c.last_intent, k.wa_id FROM wp_conversations c JOIN wp_contacts k ON k.id = c.contact_id WHERE c.id = $1', [convId]).then(function (r) {
    var c = r.rows[0];
    if (!c) return null;
    var textP = messageId ? pool.query('SELECT text FROM wp_messages WHERE id = $1 AND conversation_id = $2', [messageId, convId]) : pool.query("SELECT text FROM wp_messages WHERE conversation_id = $1 AND direction = 'in' ORDER BY created_at DESC, id DESC LIMIT 1", [convId]);
    return textP.then(function (t) { return { conversation: c, text: t.rows[0] && t.rows[0].text ? String(t.rows[0].text) : '', message_id: messageId || null }; });
  });
}

function matches(auto, ctx) {
  var c = auto.conditions || {};
  var conv = ctx.conversation;
  if (c.inbox_id && Number(c.inbox_id) !== Number(conv.inbox_id)) return false;
  if (c.handler && c.handler !== conv.handler) return false;
  if (c.status && c.status !== conv.status) return false;
  if (Array.isArray(c.keywords) && c.keywords.length) {
    var low = String(ctx.text || '').toLowerCase();
    if (!low || !c.keywords.some(function (k) { return k && low.indexOf(String(k).toLowerCase()) !== -1; })) return false;
  }
  return true;
}

function skipped(type, reason, extra) { return Object.assign({ type: type, result: 'skipped', reason: reason }, extra || {}); }
function done(type, extra) { return Object.assign({ type: type, result: 'ok' }, extra || {}); }
function errored(type, e) { return { type: type, result: 'error', reason: String(e && (e.code || e.message) || 'ERROR').slice(0, 80) }; }

function postJson(urlStr, payload) {
  return new Promise(function (resolve) {
    var u; try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, reason: 'URL_INVALID' }); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return resolve({ ok: false, reason: 'URL_SCHEME' });
    var body = JSON.stringify(payload);
    var mod = u.protocol === 'https:' ? https : http;
    var finished = false; var finish = function (r) { if (!finished) { finished = true; resolve(r); } };
    var req = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: WEBHOOK_TIMEOUT_MS }, function (res) {
      res.on('data', function () {}); res.on('end', function () { finish(res.statusCode >= 200 && res.statusCode < 300 ? { ok: true, status: res.statusCode } : { ok: false, reason: 'HTTP_' + res.statusCode, status: res.statusCode }); });
    });
    req.on('timeout', function () { req.destroy(new Error('TIMEOUT')); finish({ ok: false, reason: 'TIMEOUT' }); });
    req.on('error', function (e) { finish({ ok: false, reason: e && e.message === 'TIMEOUT' ? 'TIMEOUT' : (e && e.code ? String(e.code) : 'UNREACHABLE') }); });
    req.write(body); req.end();
  });
}

function runAction(pool, auto, action, ctx, trigger) {
  var conv = ctx.conversation, pid = conv.project_id, convId = conv.id;
  var actor = 'automation:' + auto.id;
  var p;
  try {
    switch (action.type) {
      case 'assign_agent':
        if (action.agent === 'project_default') {
          var agents = lazy('./ai/agents');
          if (!agents || typeof agents.resolveForConversation !== 'function') { p = Promise.resolve(skipped(action.type, 'MODULE_UNAVAILABLE')); break; }
          p = Promise.resolve(agents.resolveForConversation(pool, convId)).then(function (a) {
            var id = a && typeof a === 'object' ? a.id : a;
            if (!id) return skipped(action.type, 'NO_AGENT');
            return pool.query('UPDATE wp_conversations SET agent_id = $2, updated_at = now() WHERE id = $1', [convId, id]).then(function () { return done(action.type, { agent_id: id }); });
          });
        } else {
          p = pool.query('SELECT id FROM wp_agents WHERE id = $1', [action.agent_id]).then(function (r) {
            if (!r.rows[0]) return skipped(action.type, 'AGENT_UNKNOWN');
            return pool.query('UPDATE wp_conversations SET agent_id = $2, updated_at = now() WHERE id = $1', [convId, action.agent_id]).then(function () { return done(action.type, { agent_id: action.agent_id }); });
          });
        }
        break;
      case 'assign_user':
        p = inbox.updateConversation(pool, pid, convId, actor, { assigned_to: action.username }).then(function () { return done(action.type, { username: action.username }); });
        break;
      case 'tag':
        p = inbox.createTag(pool, pid, actor, { name: action.name }).then(function (t) { return inbox.tagConversation(pool, pid, convId, t.id, actor, false); }).then(function () { return done(action.type, { tag: action.name }); });
        break;
      case 'set_status':
        p = conv.status === action.status ? Promise.resolve(skipped(action.type, 'ALREADY_' + action.status.toUpperCase())) : inbox.updateConversation(pool, pid, convId, actor, { status: action.status }).then(function () { return done(action.type, { status: action.status }); });
        break;
      case 'handoff': {
        var handoff = lazy('./comms/handoff');
        if (!handoff || typeof handoff.toHuman !== 'function') { p = Promise.resolve(skipped(action.type, 'MODULE_UNAVAILABLE')); break; }
        if (conv.handler === 'human') { p = Promise.resolve(skipped(action.type, 'ALREADY_HUMAN')); break; }
        p = Promise.resolve(handoff.toHuman(pool, pid, convId, actor, { reason: action.reason || 'AUTOMATION' })).then(function (h) { return done(action.type, { handoff_id: h && h.handoff_id !== undefined ? h.handoff_id : (h && h.id) || null, reason: action.reason }); });
        break;
      }
      case 'ai_suggest':
      case 'ai_reply': {
        var assistant = lazy('./comms/assistant');
        var fnName = action.type === 'ai_reply' ? 'autoReply' : 'suggest';
        if (!assistant || typeof assistant[fnName] !== 'function') { p = Promise.resolve(skipped(action.type, 'MODULE_UNAVAILABLE')); break; }
        if (conv.handler !== 'ai') { p = Promise.resolve(skipped(action.type, 'HANDLER_NOT_AI')); break; }
        p = store.resolve(pid).then(function (resolved) {
          if (!resolved) return skipped(action.type, 'PROJECT_UNKNOWN');
          var call = action.type === 'ai_reply' ? assistant.autoReply(pool, resolved, convId, { message_id: ctx.message_id, trigger: 'automation' }) : assistant.suggest(pool, resolved, convId, actor, { message_id: ctx.message_id, trigger: 'automation' });
          return Promise.resolve(call).then(function (out) {
            if (!out) return skipped(action.type, 'NO_RESULT');
            if (action.type === 'ai_reply' && out.sent === false) return skipped(action.type, String(out.reason || 'NOT_SENT').slice(0, 60), { run_id: out.run_id || null });
            return done(action.type, { run_id: out.run_id || null, decision: out.decision || null, sent: out.sent === true });
          });
        }).catch(function (e) { if (e && e.status && e.status < 500) return skipped(action.type, String(e.code || 'REFUSED').toUpperCase()); throw e; });
        break;
      }
      case 'n8n_webhook':
        p = pool.query("SELECT base_url, config, status, kind FROM wp_integrations WHERE key = $1", [action.integration || 'n8n']).then(function (r) {
          var row = r.rows[0];
          if (!row || row.status !== 'enabled' || row.kind !== 'n8n') return skipped(action.type, 'N8N_NOT_CONFIGURED');
          var base = (row.config && row.config.webhook_base) || (row.base_url ? String(row.base_url).replace(/\/+$/, '') + '/webhook' : null);
          if (!base) return skipped(action.type, 'N8N_NOT_CONFIGURED');
          var payload = { event: trigger, automation_id: auto.id, project_id: pid, conversation_id: convId, contact_masked: mask(conv.wa_id), intent: conv.last_intent || null, handler: conv.handler, status: conv.status, at: new Date().toISOString() };
          if (action.include_text === true) payload.text = String(ctx.text || '').slice(0, 4000);
          return postJson(String(base).replace(/\/+$/, '') + '/' + action.path, payload).then(function (out) { return out.ok ? done(action.type, { path: action.path, http: out.status }) : { type: action.type, result: 'error', reason: out.reason, path: action.path }; });
        });
        break;
      case 'note':
        p = inbox.addNote(pool, pid, convId, actor, action.text).then(function (n) { return done(action.type, { message_id: n.id }); });
        break;
      default:
        p = Promise.resolve(skipped(action.type, 'UNKNOWN_ACTION'));
    }
  } catch (e) { p = Promise.resolve(errored(action.type, e)); }
  return p.catch(function (e) { return errored(action.type, e); });
}

function recordRun(pool, auto, ctx, trigger, result, detail) {
  return pool.query('INSERT INTO wp_automation_runs (automation_id, project_id, conversation_id, trigger, result, detail) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, at', [auto.id, ctx.conversation.project_id, ctx.conversation.id, trigger, result, JSON.stringify(detail)]).then(function (r) { return r.rows[0]; });
}

// runOne(pool, auto, ctx, trigger) → { run_id, result, actions } (conditions already matched)
function runOne(pool, auto, ctx, trigger) {
  var actions = Array.isArray(auto.actions) ? auto.actions : [];
  var outcomes = [];
  var chain = Promise.resolve();
  actions.forEach(function (a) { chain = chain.then(function () { return runAction(pool, auto, a, ctx, trigger).then(function (o) { outcomes.push(o); }); }); });
  return chain.then(function () {
    var result = outcomes.some(function (o) { return o.result === 'error'; }) ? 'error' : (outcomes.length && outcomes.every(function (o) { return o.result === 'skipped'; }) ? 'skipped' : 'ok');
    return recordRun(pool, auto, ctx, trigger, result, { actions: outcomes, conditions: Object.keys(auto.conditions || {}) }).then(function (r) {
      bus.publish({ type: 'automation.run', event: 'automation.run', project_id: ctx.conversation.project_id, conversation_id: ctx.conversation.id, automation_id: auto.id, run_id: r.id, result: result });
      return { run_id: r.id, automation_id: auto.id, result: result, actions: outcomes };
    });
  });
}

// fire(pool, trigger, { conversation_id, message_id }) → [run outcomes]
function fire(pool, trigger, ev, log) {
  if (TRIGGERS.indexOf(trigger) === -1 || !ev || !ev.conversation_id) return Promise.resolve([]);
  return loadContext(pool, ev.conversation_id, ev.message_id).then(function (ctx) {
    if (!ctx) return [];
    return pool.query('SELECT * FROM wp_automations WHERE enabled AND trigger = $1 AND (project_id IS NULL OR project_id = $2) ORDER BY position, id', [trigger, ctx.conversation.project_id]).then(function (r) {
      var out = [];
      var chain = Promise.resolve();
      r.rows.forEach(function (auto) {
        chain = chain.then(function () {
          // re-read the conversation between rules so a status/handler change by one rule is seen by the next
          return loadContext(pool, ctx.conversation.id, ctx.message_id).then(function (fresh) {
            if (!fresh || !matches(auto, fresh)) return null;
            return runOne(pool, auto, fresh, trigger).then(function (o) { out.push(o); });
          });
        });
      });
      return chain.then(function () { return out; });
    });
  }).catch(function (e) { if (log) log({ level: 'warn', automations: 'fire_failed', trigger: trigger, conversation_id: ev.conversation_id, reason: String(e && e.message || e).slice(0, 120) }); return []; });
}

var attached = false;
function attach(pool, log) {
  if (attached) return false;
  attached = true;
  bus.bus.on('comms', function (ev) {
    if (!ev || !ev.conversation_id) return;
    if (ev.type === 'message.in') {
      var chain = ev.opened ? fire(pool, 'conversation.created', ev, log) : Promise.resolve([]);
      chain.then(function () { return fire(pool, 'message.received', ev, log); });
    } else if (ev.type === 'handoff' && (ev.event === 'handoff.requested' || ev.event === 'handoff.created' || ev.direction === 'ai_to_human')) {
      fire(pool, 'handoff.requested', ev, log);
    }
  });
  return true;
}

// sweepInactive(pool) → runs conversation.inactive rules for conversations quiet longer than conditions.inactive_minutes
function sweepInactive(pool, log) {
  return pool.query("SELECT * FROM wp_automations WHERE enabled AND trigger = 'conversation.inactive' ORDER BY position, id").then(function (r) {
    var out = [];
    var chain = Promise.resolve();
    r.rows.forEach(function (auto) {
      var minutes = auto.conditions && auto.conditions.inactive_minutes ? parseInt(auto.conditions.inactive_minutes, 10) : 0;
      if (!minutes) return;
      chain = chain.then(function () {
        var params = [auto.id, minutes, SWEEP_LIMIT];
        var scope = '';
        if (auto.project_id) { params.push(auto.project_id); scope = ' AND c.project_id = $4'; }
        return pool.query("SELECT c.id FROM wp_conversations c WHERE c.status IN ('open','pending') AND c.last_inbound_at IS NOT NULL AND c.last_inbound_at < now() - ($2::int * interval '1 minute') AND NOT EXISTS (SELECT 1 FROM wp_automation_runs r WHERE r.automation_id = $1 AND r.conversation_id = c.id AND r.at > now() - interval '24 hours')" + scope + ' ORDER BY c.last_inbound_at LIMIT $3', params).then(function (cv) {
          var inner = Promise.resolve();
          cv.rows.forEach(function (row) {
            inner = inner.then(function () { return loadContext(pool, row.id, null).then(function (ctx) { if (!ctx || !matches(auto, ctx)) return null; return runOne(pool, auto, ctx, 'conversation.inactive').then(function (o) { out.push(o); }); }); });
          });
          return inner;
        });
      });
    });
    return chain.then(function () { if (log && out.length) log({ level: 'info', automations: 'sweep', runs: out.length }); return out; });
  });
}

var timer = null;
function start(o) {
  o = o || {};
  attach(o.pool, o.log);
  if (!timer) {
    timer = setInterval(function () { sweepInactive(o.pool, o.log).catch(function () {}); }, o.intervalMs || SWEEP_INTERVAL_MS);
    if (timer.unref) timer.unref();
  }
  return timer;
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = {
  TRIGGERS: TRIGGERS, ACTIONS: ACTIONS, DEFAULTS: DEFAULTS, HUMAN_KEYWORDS: HUMAN_KEYWORDS, WEBHOOK_TIMEOUT_MS: WEBHOOK_TIMEOUT_MS,
  validate: validate, matches: matches, list: list, get: get, create: create, update: update, setEnabled: setEnabled, remove: remove, listRuns: listRuns,
  ensureDefaults: ensureDefaults, fire: fire, runOne: runOne, attach: attach, sweepInactive: sweepInactive, start: start, stop: stop
};
