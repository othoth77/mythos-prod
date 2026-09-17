'use strict';
// =====================================================
// MYTHOS WP V2 — AI agents layer tests (builder C)   needs MYTHOS_WP_TEST_DB_URL
// tests/mythos-wp-v2-ai-test.js
//
// Loopback server, four file users (admin / manager / agent / owner), one
// project 'v2ai-proj' (no catalogue, no Kitchen), a FAKE Evolution server on
// loopback and a FAKE free-LLM transport (adapter.chatCompletion option): no
// real network, no real key file (MYTHOS_FREE_LLM_KEY_DIR / HOME /
// MYTHOS_EXECUTOR_HOME point to a temp dir holding a fake groq.env).
// Covers: agents CRUD + validation + roles, bindings + resolveForConversation
// priority, effectiveMode, tool registry + least privilege + knowledge.lookup
// + conversation.history (same conversation only), llm.complete / parseAction
// / status, the JSON tool protocol (tool round → reply; fact guard rejection →
// template fallback; malformed JSON; fences; handoff), wp_ai_runs rows with
// agent_id / tools_used / model, every autoReply gate, attach() on
// core.ingest, the test endpoint (no run row), runs listing, delete refusal,
// ensureDefaults idempotency. Only rows prefixed v2ai- are touched.
// =====================================================
var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var ROOT = path.resolve(__dirname, '..');
var WP = path.join(ROOT, 'projects/mythos-wp');
var TEST_URL = process.env.MYTHOS_WP_TEST_DB_URL || null;
var passed = 0, failed = 0;
function ok(c, n) { if (c) passed++; else { failed++; console.error('FAIL: ' + n); } }
function finish(code) { console.log('mythos-wp-v2-ai: ' + passed + ' passed, ' + failed + ' failed'); process.exit(code !== undefined ? code : (failed ? 1 : 0)); }
if (!TEST_URL) { console.error('MYTHOS_WP_TEST_DB_URL not set'); finish(process.env.MYTHOS_WP_ALLOW_SKIP === '1' ? 0 : 3); }

// --- isolation: fake key dir, fake executor home, fake HOME — set BEFORE any module loads
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-wp-v2ai-'));
var KEY_DIR = path.join(tmp, 'keys'); fs.mkdirSync(KEY_DIR, { mode: 0o700 });
var FAKE_KEY = 'fake-test-key-v2ai-0000000000';
fs.writeFileSync(path.join(KEY_DIR, 'groq.env'), 'MYTHOS_FREE_LLM_GROQ_API_KEY=' + FAKE_KEY + '\n', { mode: 0o600 });
process.env.MYTHOS_FREE_LLM_KEY_DIR = KEY_DIR;
process.env.MYTHOS_EXECUTOR_HOME = path.join(tmp, 'executor');
process.env.HOME = path.join(tmp, 'home'); fs.mkdirSync(process.env.HOME, { mode: 0o700 });
var EVO_KEY = 'FAKE-EVOLUTION-KEY-v2ai-1234567890'; var evoKeyFile = path.join(tmp, 'evolution.key'); fs.writeFileSync(evoKeyFile, EVO_KEY + '\n', { mode: 0o600 });
process.env.MYTHOS_WP_USERS_FILE = path.join(tmp, 'users.json'); process.env.MYTHOS_WP_INSECURE_COOKIE = '1';
process.env.MYTHOS_WP_EVOLUTION_API_KEY_FILE = evoKeyFile;
delete process.env.MYTHOS_WP_COMMS_CONFIG; delete process.env.MYTHOS_WP_RECEIVER_ENABLED; delete process.env.MYTHOS_WP_CATALOG_V2AI;
var u = new URL(TEST_URL); process.env.MYTHOS_WP_DB_HOST = u.hostname; process.env.MYTHOS_WP_DB_PORT = u.port || '5432'; process.env.MYTHOS_WP_DB_USER = decodeURIComponent(u.username); process.env.MYTHOS_WP_DB_PASSWORD = decodeURIComponent(u.password); process.env.MYTHOS_WP_DB_NAME = u.pathname.slice(1);

// --- fake Evolution (outbound target) ---
var evoCalls = []; var evoSeq = 0;
var evo = http.createServer(function (req, res) { var b = ''; req.on('data', function (c) { b += c; }); req.on('end', function () { evoCalls.push({ path: req.url, apikey: req.headers.apikey, body: b }); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ key: { id: 'V2AIOUT' + (++evoSeq) } })); }); });

// --- fake free-LLM transport (adapter.chatCompletion opts.transport) ---
var script = []; var llmRequests = [];
function transport(options, body) {
  var parsed = null; try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
  llmRequests.push({ url: options.url, auth: options.headers.Authorization, model: parsed && parsed.model, system: parsed && parsed.messages[0].content, user: parsed && parsed.messages[1].content });
  var next = script.length ? script.shift() : { content: '{"action":"reply","text":"(unscripted)","confidence":0.1}' };
  if (next.status && next.status >= 400) return Promise.resolve({ status: next.status, body: JSON.stringify({ error: { message: next.error || 'provider error' } }) });
  if (next.throw) return Promise.reject(new Error('socket hang up'));
  return Promise.resolve({ status: 200, body: JSON.stringify({ model: parsed && parsed.model, choices: [{ message: { content: next.content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) });
}
function say(content) { script.push({ content: content }); }

var auth = require(path.join(WP, 'reference/auth'));
var migrate = require(path.join(WP, 'reference/migrate'));
var db = require(path.join(WP, 'reference/db'));
var store = require(path.join(WP, 'reference/projects-store'));
var core = require(path.join(WP, 'reference/comms/core'));
var assistant = require(path.join(WP, 'reference/comms/assistant'));
var agents = require(path.join(WP, 'reference/ai/agents'));
var tools = require(path.join(WP, 'reference/ai/tools'));
var llm = require(path.join(WP, 'reference/ai/llm'));
var providerMod = require(path.join(WP, 'reference/comms/providers/evolution'));
var pool = db.wp();
fs.writeFileSync(process.env.MYTHOS_WP_USERS_FILE, JSON.stringify({ users: [
  { username: 'v2ai-admin', role: 'admin', scrypt: auth.hashPassword('admin-password-1') },
  { username: 'v2ai-manager', role: 'manager', scrypt: auth.hashPassword('manager-password-1') },
  { username: 'v2ai-agent', role: 'agent', scrypt: auth.hashPassword('agent-password-1') },
  { username: 'v2ai-owner', role: 'owner', scrypt: auth.hashPassword('owner-password-1') }
] }), { mode: 0o600 });
var server = require(path.join(WP, 'reference/server')).createServer();
var PORT = 0; var S = { admin: '', manager: '', agent: '', owner: '' };
function req(method, p, body, cookie) {
  return new Promise(function (resolve, reject) {
    var data = body !== undefined ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }; if (data) h['Content-Length'] = Buffer.byteLength(data); var ck = cookie === undefined ? S.admin : cookie; if (ck) h.Cookie = ck;
    var rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h, agent: false }, function (res) { var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { var j = null; try { j = JSON.parse(b); } catch (e) {} resolve({ status: res.statusCode, body: j, data: j && j.data, cookie: (res.headers['set-cookie'] || [''])[0].split(';')[0] }); }); });
    rq.on('error', reject); if (data) rq.write(data); rq.end();
  });
}
function q(sql, p) { return pool.query(sql, p || []); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var PROJECT = 'v2ai-proj';
var msgSeq = 0;
function inbound(text, from, instance) { return providerMod.parseInbound({ event: 'messages.upsert', instance: instance || 'v2ai-inbox', sender: '21600000000@s.whatsapp.net', data: { key: { remoteJid: (from || '21699100001') + '@s.whatsapp.net', fromMe: false, id: 'V2AI' + Date.now().toString(36).toUpperCase() + (++msgSeq) }, pushName: 'Client', message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) } }).event; }

function cleanup() {
  var steps = [
    ['UPDATE wp_messages SET ai_run_id = NULL WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_ai_suggestions WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id = $1)', [PROJECT]],
    ['DELETE FROM wp_ai_runs WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_handoffs WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_automation_runs WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_conversation_events WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_message_attachments WHERE message_id IN (SELECT id FROM wp_messages WHERE project_id = $1)', [PROJECT]],
    ['DELETE FROM wp_messages WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_conversation_tags WHERE conversation_id IN (SELECT id FROM wp_conversations WHERE project_id = $1)', [PROJECT]],
    ['DELETE FROM wp_conversations WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_contact_identities WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_contact_tags WHERE contact_id IN (SELECT id FROM wp_contacts WHERE project_id = $1)', [PROJECT]],
    ['DELETE FROM wp_contacts WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_tags WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_knowledge WHERE project_id = $1', [PROJECT]],
    ["DELETE FROM wp_project_agents WHERE project_id = $1 OR agent_id IN (SELECT id FROM wp_agents WHERE slug LIKE 'v2ai-%')", [PROJECT]],
    ['DELETE FROM wp_inbox_routes WHERE project_id = $1', [PROJECT]],
    ['DELETE FROM wp_inboxes WHERE project_id = $1', [PROJECT]],
    ["DELETE FROM wp_agents WHERE slug LIKE 'v2ai-%'", []],
    ["DELETE FROM wp_audit_events WHERE project_id = $1 OR actor LIKE 'v2ai-%'", [PROJECT]],
    ['DELETE FROM wp_projects WHERE id = $1', [PROJECT]]
  ];
  var chain = Promise.resolve();
  steps.forEach(function (s) { chain = chain.then(function () { return q(s[0], s[1]).catch(function () { /* table may not exist in this schema */ }); }); });
  return chain;
}

var ids = {}; var resolved, inboxA, inboxB, defaultsCreated = false, evoBefore = 0;

// A sequential runner: a step that throws marks one failure and the suite continues.
var steps = [];
function step(name, fn) { steps.push({ name: name, fn: fn }); }
function runSteps() {
  var chain = Promise.resolve();
  steps.forEach(function (s) { chain = chain.then(function () { return Promise.resolve().then(s.fn).catch(function (e) { failed++; console.error('STEP ERROR [' + s.name + ']: ' + (e && e.stack || e)); }); }); });
  return chain;
}

// ------------------------------------------------------------- fixtures
step('setup', function () {
  return migrate.up(pool).then(cleanup)
    .then(function () { return agents.ensureDefaults(pool); })
    .then(function (r) { defaultsCreated = r.created === true; return agents.ensureDefaults(pool); })
    .then(function (r) { ok(r.created === false, 'ensureDefaults is idempotent (second call creates nothing)'); return q("SELECT count(*)::int AS n FROM wp_agents"); })
    .then(function (r) { ok(r.rows[0].n >= 1, 'at least one agent exists after ensureDefaults'); })
    .then(function () { return q("INSERT INTO wp_projects (id, display_name, domain, brand_car, catalog_dsn_env, catalog_schema, status, kind, settings) VALUES ($1,'V2AI Autos','v2ai.test','TESTBRAND','MYTHOS_WP_CATALOG_V2AI','ssangyong_autos','active','automotive','{\"kitchen\": false}'::jsonb)", [PROJECT]); })
    .then(function () { return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled, outbound_enabled, status) VALUES ($1,'evolution','v2ai-inbox','V2AI A', true, true, 'open') RETURNING *", [PROJECT]); })
    .then(function (r) { inboxA = r.rows[0]; return q("INSERT INTO wp_inboxes (project_id, provider, instance, display_name, inbound_enabled, outbound_enabled, status) VALUES ($1,'evolution','v2ai-inbox2','V2AI B', true, false, 'open') RETURNING *", [PROJECT]); })
    .then(function (r) { inboxB = r.rows[0]; return q("INSERT INTO wp_knowledge (project_id, kind, title, customer_text, language, allowed_for_auto_reply, status) VALUES ($1,'faq','Horaires d ouverture','Nous sommes ouverts du lundi au samedi de 8h à 17h.','fr',true,'active'), ($1,'faq','Horaires secret','Brouillon horaires interne','fr',false,'active'), ($1,'policy','Horaires draft','Draft horaires','fr',true,'draft')", [PROJECT]); })
    .then(function () { store.invalidate(); return store.resolve(PROJECT); })
    .then(function (r) { resolved = r; ok(resolved && !resolved.catalogPool, 'project resolves without a catalogue'); })
    .then(function () { return new Promise(function (resolve) { evo.listen(0, '127.0.0.1', function () { process.env.MYTHOS_WP_EVOLUTION_BASE_URL = 'http://127.0.0.1:' + evo.address().port; server.listen(0, '127.0.0.1', function () { PORT = server.address().port; resolve(); }); }); }); })
    .then(function () { return req('POST', '/api/login', { username: 'v2ai-admin', password: 'admin-password-1' }, ''); })
    .then(function (x) { S.admin = x.cookie; return req('POST', '/api/login', { username: 'v2ai-manager', password: 'manager-password-1' }, ''); })
    .then(function (x) { S.manager = x.cookie; return req('POST', '/api/login', { username: 'v2ai-agent', password: 'agent-password-1' }, ''); })
    .then(function (x) { S.agent = x.cookie; return req('POST', '/api/login', { username: 'v2ai-owner', password: 'owner-password-1' }, ''); })
    .then(function (x) { S.owner = x.cookie; ok(S.admin && S.manager && S.agent && S.owner, 'four sessions'); });
});

// ------------------------------------------------------------- registry + status
step('tools registry + status', function () {
  return req('GET', '/api/ai/tools', undefined, S.agent).then(function (x) {
    ok(x.status === 200 && Array.isArray(x.data.items) && x.data.items.length === 8, 'GET /api/ai/tools → 8 tools');
    var byId = {}; x.data.items.forEach(function (t) { byId[t.id] = t; });
    ok(byId['kitchen.quote'] && byId['kitchen.quote'].scope === 'kitchen' && byId['kitchen.quote'].requires === 'kitchen', 'kitchen tools require a kitchen');
    ok(byId['knowledge.lookup'] && byId['knowledge.lookup'].requires === null && byId['conversation.history'].scope === 'conversation' && byId['handoff.request'].scope === 'handoff', 'scopes as in the contract');
    return req('GET', '/api/ai/status', undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 200 && x.data.engine_173.available === true, 'status: engine-173 available');
    ok(x.data.llm && x.data.llm.configured === true && x.data.llm.providers.some(function (p) { return p.id === 'groq' && p.credential_present === true; }), 'status: llm pool configured (fake groq key present)');
    ok(JSON.stringify(x.data).indexOf(FAKE_KEY) === -1, 'status never carries a key value');
    ok(x.data.agents && typeof x.data.agents.active === 'number' && x.data.defaults.mode === 'suggest' && x.data.defaults.confidence_min === 0.8, 'status: agent counts + defaults');
  });
});

// ------------------------------------------------------------- CRUD + validation + roles
step('agents CRUD', function () {
  var base = { slug: 'v2ai-alpha', name: 'V2AI Alpha', engine: 'engine-173', mode: 'suggest', language: 'fr', tools: ['knowledge.lookup', 'handoff.request', 'conversation.history'], confidence_min: 0.6, settings: { max_replies_per_hour: 10 } };
  return req('POST', '/api/ai/agents', base, S.agent).then(function (x) {
    ok(x.status === 403, 'agent role cannot create agents (' + x.status + ')');
    return req('POST', '/api/ai/agents', base, S.manager);
  }).then(function (x) {
    ok(x.status === 403, 'manager cannot create agents');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { slug: 'Bad Slug!' }));
  }).then(function (x) {
    ok(x.status === 400 && x.body.errors && x.body.errors.slug, 'slug shape validated');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { mode: 'yolo' }));
  }).then(function (x) {
    ok(x.status === 400 && x.body.errors.mode, 'mode domain validated');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { engine: 'gpt' }));
  }).then(function (x) {
    ok(x.status === 400 && x.body.errors.engine, 'engine domain validated');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { language: 'de' }));
  }).then(function (x) {
    ok(x.status === 400 && x.body.errors.language, 'language domain validated');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { tools: ['knowledge.lookup', 'shell.exec'] }));
  }).then(function (x) {
    ok(x.status === 400 && /shell\.exec/.test(x.body.errors.tools), 'tools must be registry ids');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { confidence_min: 1.5 }));
  }).then(function (x) {
    ok(x.status === 400 && x.body.errors.confidence_min, 'confidence_min 0–1 validated');
    return req('POST', '/api/ai/agents', Object.assign({}, base, { system_prompt: new Array(8002).join('x') }));
  }).then(function (x) {
    ok(x.status === 400 && x.body.errors.system_prompt, 'system_prompt ≤ 8000 validated');
    return req('POST', '/api/ai/agents', base);
  }).then(function (x) {
    ok(x.status === 201 && x.data.id && x.data.slug === 'v2ai-alpha' && x.data.confidence_min === 0.6 && x.data.tools.length === 3 && Array.isArray(x.data.projects) && x.data.stats.runs_24h === 0, 'admin creates agent A → 201 with projects + stats');
    ids.A = x.data.id;
    return req('POST', '/api/ai/agents', base);
  }).then(function (x) {
    ok(x.status === 409, 'duplicate slug → 409');
    return req('POST', '/api/ai/agents', { slug: 'v2ai-beta', name: 'V2AI Beta', engine: 'llm', mode: 'suggest', tools: ['knowledge.lookup', 'handoff.request', 'conversation.history'], system_prompt: 'Tu es l assistant de V2AI Autos.' });
  }).then(function (x) {
    ok(x.status === 201 && x.data.engine === 'llm' && x.data.confidence_min === 0.8, 'agent B (llm) created with default confidence_min');
    ids.B = x.data.id;
    return req('PATCH', '/api/ai/agents/' + ids.A, { mode: 'auto', description: 'auto mode' });
  }).then(function (x) {
    ok(x.status === 200 && x.data.mode === 'auto' && x.data.description === 'auto mode', 'PATCH updates mode');
    return req('PATCH', '/api/ai/agents/' + ids.A, { engine: 'nope' });
  }).then(function (x) {
    ok(x.status === 400, 'PATCH validates');
    return req('PATCH', '/api/ai/agents/' + ids.A, { mode: 'off' }, S.agent);
  }).then(function (x) {
    ok(x.status === 403, 'agent role cannot PATCH');
    return req('GET', '/api/ai/agents/' + ids.A, undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 200 && x.data.id === ids.A && x.data.mode === 'auto', 'GET one (any role)');
    return req('GET', '/api/ai/agents/999999999', undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 404, 'GET unknown → 404');
    return req('GET', '/api/ai/agents', undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 200 && x.data.items.some(function (a) { return a.id === ids.A; }) && x.data.items.some(function (a) { return a.id === ids.B; }), 'list includes both agents');
    return q("SELECT action, count(*)::int AS n FROM wp_audit_events WHERE resource = 'agents' AND actor = 'v2ai-admin' GROUP BY action");
  }).then(function (r) {
    var by = {}; r.rows.forEach(function (x) { by[x.action] = x.n; });
    ok(by.create === 2 && by.update === 1, 'create/update audited (' + JSON.stringify(by) + ')');
  });
});

// ------------------------------------------------------------- bindings + resolution
step('bindings + resolveForConversation', function () {
  return req('POST', '/api/ai/agents/' + ids.A + '/projects', { project_id: PROJECT }).then(function (x) {
    ok(x.status === 201 && x.data.id && x.data.project_id === PROJECT && x.data.inbox_id === null, 'bind A to (project, NULL) → 201');
    ids.linkA = x.data.id;
    return req('POST', '/api/ai/agents/' + ids.A + '/projects', { project_id: PROJECT });
  }).then(function (x) {
    ok(x.status === 409, 'duplicate binding → 409');
    return req('POST', '/api/ai/agents/' + ids.B + '/projects', { project_id: PROJECT, inbox_id: 999999999 });
  }).then(function (x) {
    ok(x.status === 400, 'inbox of another project / unknown → 400');
    return req('POST', '/api/ai/agents/' + ids.B + '/projects', { project_id: PROJECT, inbox_id: inboxA.id, priority: 10 });
  }).then(function (x) {
    ok(x.status === 201 && String(x.data.inbox_id) === String(inboxA.id), 'bind B to (project, inbox A) → 201');
    ids.linkB = x.data.id;
    return req('POST', '/api/ai/agents/' + ids.B + '/projects', { project_id: PROJECT }, S.agent);
  }).then(function (x) {
    ok(x.status === 403, 'agent role cannot bind');
    return req('POST', '/api/ai/agents/' + ids.B + '/projects', { project_id: 'v2ai-nope' });
  }).then(function (x) {
    ok(x.status === 404, 'unknown project → 404');
    return core.ingest(pool, inboxA, inbound('Bonjour', '21699100001'));
  }).then(function (r) {
    ids.conv = r.conversation_id; ids.msg1 = r.message_id;
    return agents.resolveForConversation(pool, ids.conv);
  }).then(function (a) {
    ok(a && a.id === ids.B && a.resolved_by === 'inbox', '(project, inbox) binding wins over (project, NULL)');
    return q('UPDATE wp_conversations SET agent_id = $2 WHERE id = $1', [ids.conv, ids.A]).then(function () { return agents.resolveForConversation(pool, ids.conv); });
  }).then(function (a) {
    ok(a && a.id === ids.A && a.resolved_by === 'conversation', 'conversation.agent_id wins over bindings');
    return q('UPDATE wp_conversations SET agent_id = NULL WHERE id = $1', [ids.conv]).then(function () { return req('DELETE', '/api/ai/agents/' + ids.B + '/projects/' + ids.linkB); });
  }).then(function (x) {
    ok(x.status === 200 && x.data.deleted === true, 'unlink B');
    return agents.resolveForConversation(pool, ids.conv);
  }).then(function (a) {
    ok(a && a.id === ids.A && a.resolved_by === 'project', '(project, NULL) binding resolves when no inbox binding');
    return q("UPDATE wp_agents SET status = 'paused' WHERE id = $1", [ids.A]).then(function () { return agents.resolveForConversation(pool, ids.conv); });
  }).then(function (a) {
    ok(a === null, 'a paused agent does not resolve');
    return q("UPDATE wp_agents SET status = 'active' WHERE id = $1", [ids.A]);
  }).then(function () {
    return core.ingest(pool, inboxB, inbound('Salut', '21699100002', 'v2ai-inbox2')).then(function (r) { ids.convB = r.conversation_id; return agents.resolveForConversation(pool, ids.convB); });
  }).then(function (a) {
    ok(a && a.id === ids.A, 'project-wide binding serves every inbox of the project');
    return req('GET', '/api/ai/agents/' + ids.A);
  }).then(function (x) {
    ok(x.data.projects.length === 1 && x.data.projects[0].project_id === PROJECT && x.data.projects[0].display_name === 'V2AI Autos', 'agent view lists its bindings');
    return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE resource = 'agents' AND action IN ('link','unlink')");
  }).then(function (r) { ok(r.rows[0].n === 3, 'link/unlink audited (' + r.rows[0].n + ')'); });
});

// ------------------------------------------------------------- effectiveMode
step('effectiveMode', function () {
  var A = { status: 'active', mode: 'auto' }, Sg = { status: 'active', mode: 'suggest' }, Off = { status: 'active', mode: 'off' };
  ok(agents.effectiveMode(A, { ai_mode: 'inherit' }) === 'auto', 'inherit → agent.mode');
  ok(agents.effectiveMode(A, { ai_mode: 'off' }) === 'off', 'inbox off wins');
  ok(agents.effectiveMode(Off, { ai_mode: 'auto' }) === 'off', 'agent off wins');
  ok(agents.effectiveMode(A, { ai_mode: 'suggest' }) === 'suggest', 'inbox may restrict auto → suggest');
  ok(agents.effectiveMode(Sg, { ai_mode: 'auto' }) === 'suggest', 'inbox cannot escalate suggest → auto');
  ok(agents.effectiveMode(A, null) === 'auto' && agents.effectiveMode(null, { ai_mode: 'auto' }) === 'off', 'no inbox → agent mode; no agent → off');
  ok(agents.effectiveMode({ status: 'paused', mode: 'auto' }, { ai_mode: 'inherit' }) === 'off', 'paused agent → off');
});

// ------------------------------------------------------------- tools
step('tools least privilege + knowledge + history', function () {
  var noTools = { id: 0, tools: [] };
  var withTools = { id: 0, tools: ['knowledge.lookup', 'conversation.history', 'handoff.request', 'kitchen.search_products'] };
  var ctx = { pool: pool, resolved: resolved, project_id: PROJECT, conversation_id: ids.conv, agent: noTools, toolsUsed: [] };
  return tools.run('knowledge.lookup', ctx, { q: 'horaires' }).then(function (r) {
    ok(r.ok === false && r.reason === 'TOOL_NOT_ALLOWED', 'tool not in agent.tools → TOOL_NOT_ALLOWED');
    ok(ctx.toolsUsed.length === 1 && ctx.toolsUsed[0].tool === 'knowledge.lookup' && ctx.toolsUsed[0].ok === false && ctx.toolsUsed[0].reason === 'TOOL_NOT_ALLOWED' && typeof ctx.toolsUsed[0].ms === 'number', 'refused call recorded in toolsUsed');
    return tools.run('shell.exec', ctx, {});
  }).then(function (r) {
    ok(r.ok === false && r.reason === 'TOOL_UNKNOWN', 'unknown tool refused');
    ctx.agent = withTools;
    return tools.run('knowledge.lookup', ctx, { q: 'horaires' });
  }).then(function (r) {
    ok(r.ok === true && r.data.count === 1 && r.data.items[0].title === 'Horaires d ouverture' && /8h/.test(r.data.items[0].customer_text) && r.data.items[0].language === 'fr', 'knowledge.lookup returns only active + allowed rows (' + (r.data && r.data.count) + ')');
    return tools.run('knowledge.lookup', ctx, { q: 'x' });
  }).then(function (r) {
    ok(r.ok === false && r.reason === 'QUERY_REQUIRED', 'knowledge.lookup needs a query');
    return core.ingest(pool, inboxA, inbound('Message dans une AUTRE conversation', '21699100009'));
  }).then(function (r) {
    ids.convOther = r.conversation_id;
    return tools.run('conversation.history', ctx, {});
  }).then(function (r) {
    ok(r.ok === true && r.data.count >= 1 && r.data.messages.every(function (m) { return !/AUTRE conversation/.test(String(m.text)); }) && r.data.messages.some(function (m) { return m.text === 'Bonjour' && m.direction === 'in' && m.sender_kind === 'customer'; }), 'conversation.history returns the same conversation only');
    return tools.run('conversation.history', Object.assign({}, ctx, { conversation_id: null }), {});
  }).then(function (r) {
    ok(r.ok === false && r.reason === 'NO_CONVERSATION', 'history without a conversation → NO_CONVERSATION');
    return tools.run('handoff.request', ctx, { reason: 'customer angry' });
  }).then(function (r) {
    ok(r.ok === true && r.data.requested === true && r.data.reason === 'CUSTOMER_ANGRY', 'handoff.request → decision flag');
    return tools.run('kitchen.search_products', ctx, { q: 'filtre' });
  }).then(function (r) {
    ok(r.ok === false && r.reason === 'KITCHEN_NOT_CONFIGURED', 'kitchen tool on a project without Kitchen → KITCHEN_NOT_CONFIGURED (' + r.reason + ')');
    tools.setKitchenLoader(function () { var e = new Error("Cannot find module '../kitchen'"); e.code = 'MODULE_NOT_FOUND'; throw e; });
    return tools.run('kitchen.search_products', ctx, { q: 'filtre' });
  }).then(function (r) {
    tools.setKitchenLoader(null);
    ok(r.ok === false && r.reason === 'KITCHEN_MODULE_UNAVAILABLE', 'kitchen module absent → KITCHEN_MODULE_UNAVAILABLE');
    ok(ctx.toolsUsed.length === 9 && ctx.toolsUsed.every(function (t) { return typeof t.ms === 'number' && typeof t.ok === 'boolean'; }), 'every run is timed and recorded (' + ctx.toolsUsed.length + ')');
  });
});

// ------------------------------------------------------------- llm primitives
step('llm.complete / parseAction / status', function () {
  var st = llm.status();
  ok(st.configured === true && st.providers.some(function (p) { return p.id === 'groq' && p.credential_present === true && typeof p.health === 'string'; }), 'llm.status reports presence + health without values');
  ok(JSON.stringify(st).indexOf(FAKE_KEY) === -1, 'llm.status never exposes the key');
  ok(llm.parseAction('```json\n{"action":"reply","text":"Bonjour","confidence":0.9}\n```').text === 'Bonjour', 'parseAction strips code fences');
  ok(llm.parseAction('Sure! {"action":"tool","tool":"knowledge.lookup","args":{"q":"h"}} hope this helps').tool === 'knowledge.lookup', 'parseAction finds the object inside prose');
  ok(llm.parseAction('no json here') === null && llm.parseAction('{"action":"fly"}') === null && llm.parseAction('[1,2]') === null, 'parseAction rejects junk');
  ok(llm.parseAction('{"action":"reply","text":"x","confidence":7}').confidence === 1 && llm.parseAction('{"action":"reply","text":"x"}').confidence === 0.5, 'confidence clamped / defaulted');
  say('{"action":"reply","text":"pong","confidence":0.7}');
  return llm.complete({ system: 'sys', prompt: 'ping', transport: transport }).then(function (r) {
    ok(r.ok === true && r.text.indexOf('pong') !== -1 && r.provider_id === 'groq' && typeof r.model_id === 'string' && r.latency_ms >= 0, 'llm.complete through the pool with the fake transport (' + r.provider_id + '/' + r.model_id + ')');
    var last = llmRequests[llmRequests.length - 1];
    ok(last.auth === 'Bearer ' + FAKE_KEY && /groq/.test(last.url) && last.system === 'sys' && last.user === 'ping', 'adapter sent the fake key to the wired groq endpoint (never a real one)');
    script.push({ status: 500, error: 'boom' });
    return llm.complete({ system: 'sys', prompt: 'ping', transport: transport });
  }).then(function (r) {
    ok(r.ok === false && r.reason === 'ALL_CANDIDATES_FAILED' && r.attempts[0].reason === 'PROVIDER_ERROR', 'provider error → ok:false with named attempts (' + r.reason + ')');
    script.push({ throw: true });
    return llm.complete({ system: 'sys', prompt: 'ping', transport: transport });
  }).then(function (r) {
    ok(r.ok === false && /FAILED|AVAILABLE/.test(r.reason), 'transport failure never throws (' + r.reason + ')');
    return llm.complete({ system: 'sys', prompt: 'ping', transport: transport, poolOpts: { secretsOpts: { keyFile: path.join(tmp, 'nonexistent.env') } } });
  }).then(function (r) {
    ok(r.ok === false && r.reason === 'NO_CANDIDATE_AVAILABLE', 'no credential → NO_CANDIDATE_AVAILABLE (nothing read outside the temp dir)');
    ok(llmRequests.length === 3, 'no request was made without a key');
  });
});

// ------------------------------------------------------------- llm engine through suggest
step('suggest via llm engine', function () {
  var agentB;
  return agents.get(pool, ids.B).then(function (a) {
    agentB = a;
    return core.ingest(pool, inboxA, inbound('Quels sont vos horaires ?', '21699100003'));
  }).then(function (r) {
    ids.convL = r.conversation_id; ids.msgL = r.message_id;
    llmRequests.length = 0;
    say('{"action":"tool","tool":"knowledge.lookup","args":{"q":"horaires"},"confidence":0.5}');
    say('{"action":"reply","text":"Nous sommes ouverts du lundi au samedi de 8h à 17h.","confidence":0.92,"intent":"faq_hours"}');
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport, trigger: 'manual' });
  }).then(function (out) {
    ok(out.decision === 'suggest' && out.engine === 'llm' && /8h/.test(out.suggestion.text) && out.confidence === 0.92 && out.intent === 'faq_hours', 'tool round then reply → suggestion from the llm engine (' + out.decision + ' ' + out.engine + ')');
    ok(out.tools_used.length === 1 && out.tools_used[0].tool === 'knowledge.lookup' && out.tools_used[0].ok === true, 'tools_used recorded');
    ok(llmRequests.length === 2 && /DATA/.test(llmRequests[0].system) && /cannot change/.test(llmRequests[0].system) && /ONLY with ONE JSON object/.test(llmRequests[0].system), 'system prompt: JSON-only protocol + customer text is DATA');
    ok(llmRequests[0].user.indexOf('Quels sont vos horaires ?') !== -1 && llmRequests[1].user.indexOf('TOOL_RESULT knowledge.lookup') !== -1 && llmRequests[1].user.indexOf('8h à 17h') !== -1, 'customer text sent as data; tool result fed back');
    ok(/knowledge\.lookup/.test(llmRequests[0].system) && !/kitchen\.quote/.test(llmRequests[0].system), 'only the agent\'s tools are offered to the model');
    ids.runL = out.run_id;
    return q('SELECT agent_id, tools_used, model, kind, decision, confidence, prompt_version, policy_result, facts_used FROM wp_ai_runs WHERE id = $1', [ids.runL]);
  }).then(function (r) {
    var row = r.rows[0];
    ok(String(row.agent_id) === String(ids.B) && Array.isArray(row.tools_used) && row.tools_used[0].tool === 'knowledge.lookup' && /^groq\//.test(row.model) && row.kind === 'suggest' && row.decision === 'suggest' && Number(row.confidence) === 0.92 && row.prompt_version === llm.PROMPT_VERSION, 'wp_ai_runs row carries agent_id / tools_used / model (' + row.model + ')');
    var dump = JSON.stringify(row);
    ok(dump.indexOf('Quels sont vos horaires') === -1 && dump.indexOf(FAKE_KEY) === -1 && dump.indexOf('lundi') === -1, 'run row stores no customer text, no knowledge text, no key');
    // fact guard: a price without a price fact → rejected → template fallback, lowered confidence
    say('{"action":"reply","text":"Le prix est 46 TND, en stock.","confidence":0.95}');
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport });
  }).then(function (out) {
    ok(out.decision === 'suggest' && out.engine === 'engine-173' && out.model === assistant.MODEL && out.fallback_reason === 'FACT_GUARD_VIOLATION' && out.confidence <= 0.5, 'unverified price → factGuard rejects → template fallback with lowered confidence (' + out.engine + ' ' + out.fallback_reason + ' ' + out.confidence + ')');
    ok(!/46|TND|stock/i.test(out.suggestion.text), 'fallback text states no price');
    return q('SELECT model, policy_result FROM wp_ai_runs WHERE id = $1', [out.run_id]);
  }).then(function (r) {
    ok(r.rows[0].model === assistant.MODEL && r.rows[0].policy_result.fallback_reason === 'FACT_GUARD_VIOLATION' && r.rows[0].policy_result.fallback.guard.violations[0].kind === 'price', 'fallback recorded in policy_result with the guard violation');
    say('Bien sûr ! Voici la réponse que vous attendiez.');
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport });
  }).then(function (out) {
    ok(out.engine === 'engine-173' && out.fallback_reason === 'MALFORMED_JSON' && out.decision === 'suggest', 'malformed JSON → handled (template fallback, ' + out.fallback_reason + ')');
    say('```json\n{"action":"reply","text":"Bonjour, comment puis-je vous aider ?","confidence":0.8}\n```');
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport });
  }).then(function (out) {
    ok(out.engine === 'llm' && out.suggestion && out.suggestion.text === 'Bonjour, comment puis-je vous aider ?', 'fenced JSON parsed');
    // least privilege through the protocol: a tool outside agent.tools is refused and the model told so
    llmRequests.length = 0;
    say('{"action":"tool","tool":"kitchen.quote","args":{"uids":["x"]}}');
    say('{"action":"reply","text":"Un conseiller vous confirme le tarif.","confidence":0.6}');
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport });
  }).then(function (out) {
    ok(out.tools_used.length === 1 && out.tools_used[0].tool === 'kitchen.quote' && out.tools_used[0].reason === 'TOOL_NOT_ALLOWED' && /TOOL_NOT_ALLOWED/.test(llmRequests[1].user), 'model cannot widen its tools (TOOL_NOT_ALLOWED fed back)');
    // more than 3 tool rounds → TOOL_ROUNDS_EXCEEDED → fallback
    for (var i = 0; i < 4; i++) say('{"action":"tool","tool":"knowledge.lookup","args":{"q":"horaires"}}');
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport });
  }).then(function (out) {
    ok(out.fallback_reason === 'TOOL_ROUNDS_EXCEEDED' && out.tools_used.length === 3, 'max 3 tool rounds (' + out.fallback_reason + ' ' + out.tools_used.length + ')');
    script.length = 0;
    // no candidate → fallback with NO_CANDIDATE_AVAILABLE
    return assistant.suggest(pool, resolved, ids.convL, 'v2ai-admin', { agent: agentB, transport: transport, poolOpts: { secretsOpts: { keyFile: path.join(tmp, 'nonexistent.env') } } });
  }).then(function (out) {
    ok(out.engine === 'engine-173' && out.fallback_reason === 'NO_CANDIDATE_AVAILABLE', 'no provider → template fallback (' + out.fallback_reason + ')');
    // handoff decision
    return core.ingest(pool, inboxA, inbound('Je veux me plaindre de ma commande', '21699100004'));
  }).then(function (r) {
    ids.convH = r.conversation_id;
    say('{"action":"handoff","reason":"complaint","confidence":0.9,"intent":"complaint"}');
    return assistant.suggest(pool, resolved, ids.convH, 'v2ai-admin', { agent: agentB, transport: transport });
  }).then(function (out) {
    ok(out.decision === 'handoff' && out.suggestion === null && out.engine === 'llm', 'llm handoff decision → handoff, no text');
    return q('SELECT handler, status FROM wp_conversations WHERE id = $1', [ids.convH]);
  }).then(function (r) {
    ok(r.rows[0].handler === 'human', 'handoff sets the conversation handler to human (status ' + r.rows[0].status + ')');
    return q("SELECT count(*)::int AS n FROM wp_handoffs WHERE conversation_id = $1 AND status IN ('NEW','REQUIRES_HUMAN','IN_PROGRESS')", [ids.convH]);
  }).then(function (r) {
    ok(r.rows[0].n === 1, 'one open wp_handoffs row');
    return assistant.suggest(pool, resolved, ids.convH, 'v2ai-admin', { agent: agentB, transport: transport }).then(function () { ok(false, 'suggest after handoff must refuse'); }, function (e) { ok(e.status === 412, 'suggest after handoff → 412'); });
  });
});

// ------------------------------------------------------------- engine-173 unchanged without an agent
step('engine-173 path without an agent', function () {
  return core.ingest(pool, inboxB, inbound('Bonjour', '21699100005', 'v2ai-inbox2')).then(function (r) {
    ids.convN = r.conversation_id;
    return q('DELETE FROM wp_project_agents WHERE agent_id = $1', [ids.A]);
  }).then(function () {
    return req('POST', '/api/projects/' + PROJECT + '/comms/conversations/' + ids.convN + '/suggest', {}, S.manager);
  }).then(function (x) {
    ok(x.status === 201 && x.data.decision === 'suggest' && x.data.intent === 'greeting' && x.data.suggestion && x.data.suggestion.text && x.data.agent_id === null && x.data.engine === 'engine-173' && x.data.model === assistant.MODEL, 'no agent bound → greeting → suggestion via engine-173 (' + x.status + ' ' + (x.data && x.data.decision) + ')');
    return q("SELECT kind, model, agent_id, tools_used FROM wp_ai_runs WHERE id = $1", [x.data.run_id]);
  }).then(function (r) {
    ok(r.rows[0].model === 'mythos-auto-reply/template' && r.rows[0].agent_id === null && Array.isArray(r.rows[0].tools_used) && r.rows[0].tools_used.length === 0, 'legacy run row shape kept (MODEL template, no agent)');
    return req('POST', '/api/ai/agents/' + ids.A + '/projects', { project_id: PROJECT });
  }).then(function (x) { ok(x.status === 201, 'A re-bound'); ids.linkA = x.data.id; });
});

// ------------------------------------------------------------- autoReply gates
step('autoReply gates', function () {
  function reload() { return agents.get(pool, ids.A); }
  return q("UPDATE wp_agents SET mode = 'suggest', confidence_min = 0.6, settings = '{\"max_replies_per_hour\": 10}'::jsonb WHERE id = $1", [ids.A]).then(reload).then(function () {
    evoBefore = evoCalls.length;
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' });
  }).then(function (r) {
    ok(r.ran === true && r.sent === false && r.reason === 'MODE_NOT_AUTO' && r.decision === 'suggest' && r.suggestion && evoCalls.length === evoBefore, 'mode suggest → suggestion only, no send (' + r.reason + ')');
    return q("UPDATE wp_agents SET mode = 'auto', confidence_min = 0.99 WHERE id = $1", [ids.A]).then(reload);
  }).then(function () {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' });
  }).then(function (r) {
    ok(r.ran === true && r.sent === false && r.reason === 'CONFIDENCE_BELOW_MIN' && evoCalls.length === evoBefore, 'auto + confidence below min → no send (' + r.reason + ' ' + r.confidence + ')');
    return q('SELECT kind, policy_result FROM wp_ai_runs WHERE id = $1', [r.run_id]);
  }).then(function (rr) {
    ok(rr.rows[0].kind === 'auto_reply' && rr.rows[0].policy_result.auto_reply && rr.rows[0].policy_result.auto_reply.sent === false && rr.rows[0].policy_result.auto_reply.blocked_by.indexOf('CONFIDENCE_MIN') !== -1, 'gates recorded in policy_result');
    return q("UPDATE wp_agents SET confidence_min = 0.6 WHERE id = $1", [ids.A]).then(reload);
  }).then(function () {
    return q('UPDATE wp_inboxes SET outbound_enabled = false WHERE id = $1', [inboxA.id]);
  }).then(function () {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' });
  }).then(function (r) {
    ok(r.ran === true && r.sent === false && r.reason === 'OUTBOUND_DISABLED' && evoCalls.length === evoBefore, 'auto + outbound disabled → no send (' + r.reason + ')');
    return q('UPDATE wp_inboxes SET outbound_enabled = true, ai_mode = \'off\' WHERE id = $1', [inboxA.id]);
  }).then(function () {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' });
  }).then(function (r) {
    ok(r.ran === false && r.reason === 'MODE_OFF', 'inbox ai_mode off → nothing runs (' + r.reason + ')');
    return q('UPDATE wp_inboxes SET ai_mode = \'inherit\' WHERE id = $1', [inboxA.id]);
  }).then(function () {
    return q("UPDATE wp_conversations SET handler = 'human' WHERE id = $1", [ids.conv]).then(function () { return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE conversation_id = $1', [ids.conv]); });
  }).then(function (before) {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' }).then(function (r) {
      return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE conversation_id = $1', [ids.conv]).then(function (after) {
        ok(r.ran === false && r.reason === 'HANDLER_NOT_AI' && after.rows[0].n === before.rows[0].n, 'handler human → no run (' + r.reason + ')');
      });
    });
  }).then(function () {
    return q("UPDATE wp_conversations SET handler = 'ai' WHERE id = $1", [ids.conv]);
  }).then(function () {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' });
  }).then(function (r) {
    ok(r.ran === true && r.sent === true && r.decision === 'auto_reply' && r.message_id && evoCalls.length === evoBefore + 1, 'auto + every gate → sent through outbound (' + r.reason + ')');
    ok(/\/message\/sendText\/v2ai-inbox$/.test(evoCalls[evoCalls.length - 1].path) && evoCalls[evoCalls.length - 1].apikey === EVO_KEY, 'fake Evolution received the text for the right instance');
    ids.sentRun = r.run_id; ids.sentMsg = r.message_id; ids.sentSug = r.suggestion.id;
    return q('SELECT m.status, m.sender_kind, m.sender_ref, m.client_ref, m.ai_run_id, m.text, s.status AS sug_status, s.sent_message_id, s.decided_by, r.decision FROM wp_messages m JOIN wp_ai_suggestions s ON s.id = $2 JOIN wp_ai_runs r ON r.id = $3 WHERE m.id = $1', [ids.sentMsg, ids.sentSug, ids.sentRun]);
  }).then(function (rr) {
    var m = rr.rows[0];
    ok(m.status === 'sent' && m.sender_kind === 'ai' && m.sender_ref === 'ai:' + ids.sentRun && m.client_ref === assistant.clientRef(ids.sentRun) && /^auto-/.test(m.client_ref) && String(m.ai_run_id) === String(ids.sentRun), 'message row: sent, sender_kind ai, client_ref auto-<run>, ai_run_id (' + m.client_ref + ')');
    ok(m.sug_status === 'sent' && String(m.sent_message_id) === String(ids.sentMsg) && m.decided_by === 'ai' && m.decision === 'auto_reply', 'suggestion marked sent by ai; run decision auto_reply');
    return q("SELECT count(*)::int AS n FROM wp_conversation_events WHERE conversation_id = $1 AND event_name = 'ai.sent'", [ids.conv]);
  }).then(function (rr) {
    ok(rr.rows[0].n === 1, 'ai.sent journaled');
    // per-conversation cap
    return q("UPDATE wp_agents SET settings = '{\"max_replies_per_hour\": 1}'::jsonb WHERE id = $1", [ids.A]).then(reload);
  }).then(function () {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' });
  }).then(function (r) {
    ok(r.ran === true && r.sent === false && r.reason === 'REPLY_RATE_EXCEEDED' && evoCalls.length === evoBefore + 1, 'per-conversation cap (settings.max_replies_per_hour) → no send (' + r.reason + ')');
    return q("UPDATE wp_agents SET settings = '{\"max_replies_per_hour\": 10}'::jsonb WHERE id = $1", [ids.A]).then(reload);
  }).then(function () {
    // open handoff gate: suggest refuses (412) before any send
    return q("INSERT INTO wp_handoffs (project_id, event_id, conversation_id, channel, reason, status) VALUES ($1,'v2ai-manual-handoff',$2,'whatsapp','MANUAL','NEW')", [PROJECT, ids.conv]);
  }).then(function () {
    return assistant.autoReply(pool, resolved, ids.conv, { trigger: 'manual' }).then(function () { ok(false, 'open handoff must block'); }, function (e) { ok(e.status === 412 && evoCalls.length === evoBefore + 1, 'open handoff → refused, no send'); });
  }).then(function () {
    return q("DELETE FROM wp_handoffs WHERE event_id = 'v2ai-manual-handoff'");
  }).then(function () {
    // the route (manager) with audit 'run'
    return req('POST', '/api/projects/' + PROJECT + '/comms/conversations/' + ids.conv + '/auto-reply', {}, S.agent);
  }).then(function (x) {
    ok(x.status === 403, 'auto-reply route needs manager');
    return req('POST', '/api/projects/' + PROJECT + '/comms/conversations/' + ids.conv + '/auto-reply', {}, S.manager);
  }).then(function (x) {
    ok(x.status === 200 && x.data.ran === true && x.data.sent === true && evoCalls.length === evoBefore + 2, 'POST …/auto-reply (manager) → sent (' + x.status + ' ' + (x.data && x.data.reason) + ')');
    return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE action = 'run' AND resource = 'ai_runs' AND actor = 'v2ai-manager'");
  }).then(function (r) { ok(r.rows[0].n === 1, 'auto-reply audited as run'); });
});

// ------------------------------------------------------------- attach()
step('attach() on core.ingest', function () {
  assistant.attach(pool, function () {});
  var before = evoCalls.length; var msgId;
  return core.ingest(pool, inboxA, inbound('Bonjour, une question', '21699100001')).then(function (r) {
    msgId = r.message_id;
    return wait(1500);
  }).then(function () {
    ok(evoCalls.length === before + 1, 'inbound on an ai-handled conversation with an auto agent → auto reply sent');
    return q('SELECT count(*)::int AS n, max(kind) AS kind FROM wp_ai_runs WHERE message_id = $1', [msgId]);
  }).then(function (r) {
    ok(r.rows[0].n === 1 && r.rows[0].kind === 'auto_reply', 'exactly one run for the message');
    return assistant.autoReply(pool, resolved, ids.conv, { message_id: msgId, trigger: 'auto' });
  }).then(function (r) {
    ok(r.ran === false && r.reason === 'DUPLICATE_MESSAGE', 'a second automatic trigger for the same message is deduplicated');
    return q("UPDATE wp_agents SET mode = 'suggest' WHERE id = $1", [ids.A]);
  }).then(function () {
    before = evoCalls.length;
    return core.ingest(pool, inboxA, inbound('Encore bonjour', '21699100001'));
  }).then(function (r) {
    msgId = r.message_id; return wait(1500);
  }).then(function () {
    return q('SELECT count(*)::int AS n, max(kind) AS kind, max(decision) AS decision FROM wp_ai_runs WHERE message_id = $1', [msgId]);
  }).then(function (r) {
    ok(evoCalls.length === before && r.rows[0].n === 1 && r.rows[0].kind === 'suggest' && r.rows[0].decision === 'suggest', 'mode suggest → suggestion, no send');
    return q("UPDATE wp_agents SET mode = 'off' WHERE id = $1", [ids.A]);
  }).then(function () {
    return core.ingest(pool, inboxA, inbound('Et encore', '21699100001'));
  }).then(function (r) {
    msgId = r.message_id; return wait(1000);
  }).then(function () {
    return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE message_id = $1', [msgId]);
  }).then(function (r) {
    ok(r.rows[0].n === 0 && evoCalls.length === before, 'mode off → nothing');
    return q("UPDATE wp_agents SET mode = 'auto' WHERE id = $1", [ids.A]);
  }).then(function () {
    // legacy: no agent for inbox B conversation? A is project-wide → unbind, set ai_suggest on inbox B
    return q('DELETE FROM wp_project_agents WHERE agent_id = $1', [ids.A]);
  }).then(function () {
    return q("UPDATE wp_inboxes SET settings = settings || '{\"ai_suggest\": true}'::jsonb WHERE id = $1", [inboxB.id]);
  }).then(function () {
    return core.ingest(pool, inboxB, inbound('Bonjour legacy', '21699100005', 'v2ai-inbox2'));
  }).then(function (r) {
    msgId = r.message_id; return wait(1500);
  }).then(function () {
    return q("SELECT count(*)::int AS n, max(policy_result->>'trigger') AS trig, max(agent_id) AS agent_id FROM wp_ai_runs WHERE message_id = $1", [msgId]);
  }).then(function (r) {
    ok(r.rows[0].n === 1 && r.rows[0].trig === 'auto' && r.rows[0].agent_id === null, 'legacy settings.ai_suggest still suggests without an agent');
    return req('POST', '/api/ai/agents/' + ids.A + '/projects', { project_id: PROJECT });
  }).then(function (x) { ids.linkA = x.data && x.data.id; });
});

// ------------------------------------------------------------- test endpoint + runs listing
step('test endpoint + runs', function () {
  var runsBefore;
  return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE project_id = $1', [PROJECT]).then(function (r) {
    runsBefore = r.rows[0].n;
    return req('POST', '/api/ai/agents/' + ids.A + '/test', { project_id: PROJECT, text: 'Bonjour' }, S.agent);
  }).then(function (x) {
    ok(x.status === 403, 'test endpoint needs manager');
    return req('POST', '/api/ai/agents/' + ids.A + '/test', { project_id: PROJECT }, S.manager);
  }).then(function (x) {
    ok(x.status === 400, 'test endpoint requires text');
    return req('POST', '/api/ai/agents/' + ids.A + '/test', { project_id: PROJECT, text: 'Bonjour', contact_masked: '***001' }, S.manager);
  }).then(function (x) {
    ok(x.status === 200 && x.data.decision === 'suggest' && x.data.intent === 'greeting' && x.data.text && x.data.engine === 'engine-173' && x.data.model === assistant.MODEL && Array.isArray(x.data.tools_used) && x.data.dry_run === true && x.data.facts, 'test (manager) → outcome ' + x.status + ' ' + (x.data && x.data.decision));
    return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE project_id = $1', [PROJECT]);
  }).then(function (r) {
    ok(r.rows[0].n === runsBefore, 'test writes no wp_ai_runs row');
    return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE action = 'test' AND resource = 'agents' AND record_id = $1", [String(ids.A)]);
  }).then(function (r) {
    ok(r.rows[0].n === 1, 'test audited at the route');
    say('{"action":"reply","text":"Bonjour, envoyez-nous votre modèle et la pièce.","confidence":0.8}');
    return agents.get(pool, ids.B).then(function (b) { return assistant.test(pool, resolved, b, 'Bonjour', { transport: transport }); });
  }).then(function (out) {
    ok(out.engine === 'llm' && out.decision === 'suggest' && /modèle/.test(out.text) && out.kind === 'test', 'assistant.test with the llm engine (no conversation)');
    return req('GET', '/api/ai/runs?project=' + PROJECT + '&limit=100', undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 200 && x.data.items.length === runsBefore && x.data.items.every(function (r) { return r.text === undefined && Object.prototype.hasOwnProperty.call(r, 'agent_id') && Object.prototype.hasOwnProperty.call(r, 'tools_used'); }), 'GET /api/ai/runs?project= lists runs without text (' + x.data.items.length + ')');
    ok(x.data.items.some(function (r) { return r.agent_slug === 'v2ai-beta'; }) && JSON.stringify(x.data).indexOf('Quels sont vos horaires') === -1, 'runs joined with the agent slug, no customer text');
    return req('GET', '/api/ai/runs?project=' + PROJECT + '&agent=' + ids.B, undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 200 && x.data.items.length > 0 && x.data.items.every(function (r) { return r.agent_id === ids.B; }), 'runs filtered by agent');
    return req('GET', '/api/ai/runs?limit=5', undefined, S.agent);
  }).then(function (x) {
    ok(x.status === 200 && x.data.items.length <= 5, 'runs across accessible projects with limit');
    return req('GET', '/api/ai/agents', undefined, S.agent);
  }).then(function (x) {
    var a = x.data.items.filter(function (i) { return i.id === ids.A; })[0];
    ok(a && a.stats.runs_24h > 0 && typeof a.stats.handoffs_24h === 'number', 'list stats count 24 h runs (' + (a && a.stats.runs_24h) + ')');
  });
});

// ------------------------------------------------------------- delete
step('delete refusal + owner delete', function () {
  return q('UPDATE wp_conversations SET agent_id = $2 WHERE id = $1', [ids.conv, ids.A]).then(function () {
    return req('DELETE', '/api/ai/agents/' + ids.A, undefined, S.owner);
  }).then(function (x) {
    ok(x.status === 409, 'delete refused while a conversation references the agent (' + x.status + ')');
    return q('UPDATE wp_conversations SET agent_id = NULL WHERE agent_id = $1', [ids.A]);
  }).then(function () {
    return req('DELETE', '/api/ai/agents/' + ids.A, undefined, S.admin);
  }).then(function (x) {
    ok(x.status === 403, 'admin cannot delete (owner only)');
    return req('DELETE', '/api/ai/agents/' + ids.A, undefined, S.owner);
  }).then(function (x) {
    ok(x.status === 200 && x.data.deleted === true, 'owner deletes');
    return q('SELECT count(*)::int AS n FROM wp_ai_runs WHERE agent_id = $1', [ids.A]);
  }).then(function (r) {
    ok(r.rows[0].n === 0, 'runs keep their rows (agent_id set null)');
    return q("SELECT count(*)::int AS n FROM wp_audit_events WHERE action = 'delete' AND resource = 'agents' AND actor = 'v2ai-owner'");
  }).then(function (r) { ok(r.rows[0].n === 1, 'delete audited'); });
});

runSteps()
  .then(function () { return new Promise(function (resolve) { server.close(resolve); }); })
  .then(function () { return new Promise(function (resolve) { evo.close(resolve); }); })
  .then(cleanup)
  .then(function () { if (defaultsCreated) return q("DELETE FROM wp_agents WHERE slug = $1 AND created_by = 'system:defaults'", [agents.DEFAULT_AGENT.slug]); })
  .then(function () { return pool.end(); })
  .then(function () { finish(); })
  .catch(function (e) { console.error('ERROR: ' + (e && e.stack || e)); failed++; pool.end().catch(function () {}); finish(1); });
