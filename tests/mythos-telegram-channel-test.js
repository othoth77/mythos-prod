'use strict';
// =====================================================
// MYTHOS — Telegram → TASK channel adapter tests
// tests/mythos-telegram-channel-test.js
//
// Offline and deterministic. Same fixture shape as the Issues suite (bare
// origin, main checkout, control worktree, mock executor provider, isolated
// OTHMODE store) plus an in-process fake of the Telegram Bot API that
// records every request. No network, no real token, no real chat.
//
// Sections:
//   1. Telegram update → normalised MYTHOS message → TASK
//   2. invalid / malformed updates
//   3. missing token configuration
//   4. secret redaction (token never in logs, files, replies or errors)
//   5. authorisation rejection (allowlist)
//   6. full Telegram → bridge → executor (mock) → OTHMODE → report → Telegram flow
//   7. the combined `tick` CLI with the channel disabled is unchanged
//
// Run with: node tests/mythos-telegram-channel-test.js
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-telegram-channel-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

// Fake token with the real shape (<bot id>:<35 chars>). It must never appear
// anywhere except in the URL path the fake Bot API receives.
var TOKEN = '123456789:AAtestTOKENabcdefghijklmnopqrstuvwxy';
var OWNER = 111222333;
var STRANGER = 444555666;

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_EXECUTOR_ALLOW_MOCK = '1';
process.env.MYTHOS_ADVISORY_KEY_FILE = path.join(FIX, 'no-advisory-credential.env');
process.env.MYTHOS_BRIDGE_PROJECT = 'executor-selftest';
process.env.MYTHOS_BRIDGE_REPO = path.join(FIX, 'repo');
process.env.MYTHOS_BRIDGE_CONTROL_DIR = path.join(FIX, 'control');
process.env.MYTHOS_BRIDGE_TASK_WORKTREES = path.join(FIX, 'wt');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_BRIDGE_PROVIDER = 'mock';
process.env.MYTHOS_BRIDGE_USER = os.userInfo().username;
process.env.OTHMODE_STORE_ROOT = path.join(FIX, 'othstore');
process.env.MYTHOS_TELEGRAM_ENABLED = '1';
process.env.MYTHOS_TELEGRAM_BOT_TOKEN = TOKEN;
process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = String(OWNER);
delete process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE;
delete process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS;
delete process.env.MYTHOS_TELEGRAM_DEFAULT_ACTION;
delete process.env.MYTHOS_TELEGRAM_POLL_SECONDS;
delete process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED;
delete process.env.MYTHOS_ISSUES_ENABLED;
delete process.env.MYTHOS_MOCK_SCRIPT;
fs.mkdirSync(process.env.OTHMODE_STORE_ROOT, { recursive: true, mode: 0o700 });

var executor = require(path.join(EXEC, 'executor'));
var state = require(path.join(EXEC, 'lib', 'state'));
var bridge = require(path.join(EXEC, 'bridge', 'github-bridge'));
var telegram = require(path.join(EXEC, 'bridge', 'telegram'));
var mockProvider = require(path.join(EXEC, 'providers', 'mock'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }
function git(cwd, args) {
  return cp.execFileSync('git', args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' }) }).trim();
}
function readJson(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }

// --- fake Telegram Bot API -----------------------------------------------------------
var api = { pending: [], sent: [], requests: [], nextMessageId: 5000, nextUpdateId: 900000001, failSend: false };
function pushUpdate(over) {
  var id = api.nextUpdateId++;
  var u = Object.assign({ update_id: id }, over || {});
  api.pending.push(u);
  return u;
}
function privateMessage(userId, text, over) {
  return pushUpdate({ message: Object.assign({ message_id: api.nextMessageId++, date: Math.floor(Date.now() / 1000), text: text,
    chat: { id: userId, type: 'private', first_name: 'T' }, from: { id: userId, is_bot: false, first_name: 'T' } }, over || {}) });
}
function sentTo(chatId) { return api.sent.filter(function (m) { return m.chat_id === chatId; }); }

var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var text = Buffer.concat(chunks).toString('utf8');
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    var u = new URL(req.url, 'http://x');
    api.requests.push({ method: req.method, path: u.pathname, body: text });
    function send(code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
    var m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m) return send(404, { ok: false, error_code: 404, description: 'Not Found' });
    if (m[1] !== TOKEN) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' });
    if (m[2] === 'getMe') return send(200, { ok: true, result: { id: 123456789, is_bot: true, username: 'mythos_fixture_bot' } });
    if (m[2] === 'getUpdates') {
      var offset = (body && body.offset) || 0;
      var list = api.pending.filter(function (x) { return x.update_id >= offset; }).slice(0, (body && body.limit) || 100);
      return send(200, { ok: true, result: list });
    }
    if (m[2] === 'sendMessage') {
      if (api.failSend) return send(500, { ok: false, error_code: 500, description: 'fixture outage' });
      var msg = { message_id: api.nextMessageId++, chat_id: body.chat_id, text: body.text, date: Math.floor(Date.now() / 1000) };
      api.sent.push(msg);
      return send(200, { ok: true, result: { message_id: msg.message_id, chat: { id: body.chat_id, type: 'private' }, text: body.text } });
    }
    send(404, { ok: false, error_code: 404, description: 'unhandled ' + m[2] });
  });
});

// --- fixture repositories ---------------------------------------------------------------
var ORIGIN = path.join(FIX, 'origin.git');
var REPO = path.join(FIX, 'repo');
git(FIX, ['init', '--bare', '-q', '-b', 'main', ORIGIN]);
git(FIX, ['clone', '-q', ORIGIN, REPO]);
fs.writeFileSync(path.join(REPO, 'README.md'), '# fixture\n');
git(REPO, ['add', 'README.md']);
git(REPO, ['commit', '-q', '-m', 'init']);
git(REPO, ['push', '-q', 'origin', 'main']);
var MAIN_AT_START = git(REPO, ['rev-parse', 'main']);

function relay() {
  git(REPO, ['push', '-q', 'origin', 'refs/heads/mythos/control:refs/heads/mythos/control']);
}
var bcfg = bridge.config();
bridge.init();
relay();
var cfg;
function taskOnDisk(id) { var f = path.join(bcfg.controlDir, 'control', 'tasks', id + '.json'); return fs.existsSync(f) ? readJson(f) : null; }
function reportOnDisk(id) { var f = path.join(bcfg.controlDir, 'control', 'reports', id + '.json'); return fs.existsSync(f) ? readJson(f) : null; }
function actionsOf(r, kind) { return (r.actions || []).filter(function (a) { return a.action === kind; }); }
function runExecutor(script) { mockProvider.reset(); process.env.MYTHOS_MOCK_SCRIPT = JSON.stringify(script); return executor.tick(); }
function full(opts) { return telegram.telegramTick(executor, opts || {}); }

// Every file the adapter, the bridge and the executor wrote during the run.
function walk(dir, out) {
  out = out || [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (n) {
    if (n === '.git' || n === 'origin.git' || n === 'wt' || n === 'repo') return;
    var full = path.join(dir, n);
    var st = fs.lstatSync(full);
    if (st.isDirectory()) walk(full, out); else if (st.isFile()) out.push(full);
  });
  return out;
}
function filesContaining(needle) {
  return walk(FIX).filter(function (f) { try { return fs.readFileSync(f, 'utf8').indexOf(needle) !== -1; } catch (e) { return false; } });
}

server.listen(0, '127.0.0.1', function () {
  process.env.MYTHOS_TELEGRAM_API_BASE = 'http://127.0.0.1:' + server.address().port;
  cfg = telegram.config();
  run().catch(function (e) { ok(false, 'unexpected error: ' + (e && e.stack || e)); }).then(finish);
});

async function run() {
  // --- 1. update → normalised message → TASK ------------------------------------------
  ok(cfg.enabled && cfg.allowedUserIds.length === 1 && cfg.allowedUserIds[0] === String(OWNER) && cfg.allowedActions.join(',') === 'investigate,review' && cfg.defaultAction === 'investigate',
    'config: enabled, one allowlisted id, READ-only actions by default, default investigate');
  var u1 = { update_id: 42, message: { message_id: 7, date: 1788600000, text: 'Investigate the fixture repository and report its HEAD commit.', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false, username: 'owner' } } };
  var n1 = telegram.normalizeUpdate(u1);
  ok(n1.ok && n1.message.channel === 'telegram' && n1.message.update_id === 42 && n1.message.chat_id === OWNER && n1.message.user_id === OWNER && n1.message.message_id === 7 && n1.message.date === new Date(1788600000 * 1000).toISOString() && n1.message.text === u1.message.text,
    'normalise: private text message → {channel, update_id, chat_id, user_id, message_id, date, text}');
  var c1 = telegram.updateToTask(cfg, u1);
  ok(c1.task && c1.errors.length === 0, 'convert: valid message converts to a VALID task (' + c1.errors.join('; ') + ')');
  ok(c1.task.task_id === 'tg-000000042' && c1.task.status === 'PENDING' && c1.task.project === 'executor-selftest' && c1.task.protocol === bridge.PROTOCOL, 'convert: deterministic id tg-<update_id zero-padded>, PENDING, bridge project, control protocol');
  ok(c1.task.objective === u1.message.text && c1.task.requested_action === 'investigate' && c1.task.action_source === 'default' && /defaulted/.test(c1.task.notes), 'convert: objective = text, no Action stated → investigate (default), notes say so');
  ok(c1.task.created_by === 'telegram:' + OWNER && c1.task.source.kind === 'telegram' && c1.task.source.update_id === 42 && c1.task.source.chat_id === OWNER && c1.task.source.user_id === OWNER && c1.task.source.message_id === 7,
    'convert: created_by + source block carry the sender/chat identifiers (ids only)');
  ok(JSON.stringify(c1.task).indexOf('"username"') === -1 && JSON.stringify(c1.task).indexOf('owner') === -1, 'convert: the Telegram username is NOT stored (ids only)');
  ok(c1.task.source.resolution.execution_profile === 'repo-read' && c1.task.source.resolution.expected_delivery === 'report' && c1.task.source.resolution.channel_allowed_actions.join(',') === 'investigate,review', 'convert: resolution records profile repo-read / delivery report / channel allowlist');
  ok(bridge.validateTask(bcfg, c1.task, 'tg-000000042.json').length === 0, 'convert: the task passes the UNCHANGED bridge validator');
  var c2 = telegram.updateToTask(cfg, { update_id: 43, message: { message_id: 8, text: 'Action: review\n\nReview the README of the fixture for typos.', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false } } });
  ok(c2.task && c2.task.requested_action === 'review' && c2.task.action_source === 'explicit_current_issue' && c2.task.objective === 'Review the README of the fixture for typos.' && c2.task.action_raw === 'review',
    'convert: "Action: review" is honoured (engine) and stripped from the objective (got "' + (c2.task ? c2.task.objective : c2.errors.join('; ')) + '")');
  var c3 = telegram.updateToTask(cfg, { update_id: 44, message: { message_id: 9, text: 'Action: implement\n\nImplement a new endpoint in the fixture right now.', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false } } });
  ok(!c3.task && c3.errors.some(function (e) { return /not allowed on the Telegram channel/.test(e); }), 'convert: Action implement is refused by the channel allowlist (READ only)');
  var c4 = telegram.updateToTask(cfg, { update_id: 45, message: { message_id: 10, text: 'Action: deploy\n\nDeploy everything to production.', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false } } });
  ok(!c4.task && c4.errors.some(function (e) { return /Action "deploy"/.test(e); }), 'convert: Action deploy is refused (closed action set of the engine)');
  var c5 = telegram.updateToTask(cfg, { update_id: 46, message: { message_id: 11, text: 'hi', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false } } });
  ok(!c5.task && c5.errors.some(function (e) { return /objective is too short/.test(e); }), 'convert: a 2-character message is refused (objective too short)');
  process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS = 'investigate, review, test';
  ok(telegram.config().allowedActions.join(',') === 'investigate,review,test', 'config: MYTHOS_TELEGRAM_ALLOWED_ACTIONS widens the channel set explicitly');
  process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS = 'bogus';
  ok(telegram.config().allowedActions.join(',') === 'investigate,review', 'config: an unrecognised allowed-actions list falls back to READ-only, never to everything');
  delete process.env.MYTHOS_TELEGRAM_ALLOWED_ACTIONS;

  // --- 2. malformed updates ----------------------------------------------------------------
  var bad = [
    [null, 'update is not an object'],
    ['str', 'update is not an object'],
    [{ message: {} }, 'update_id missing'],
    [{ update_id: 1.5, message: {} }, 'update_id missing or not an integer'],
    [{ update_id: 2 }, 'no message'],
    [{ update_id: 3, edited_message: { text: 'x' } }, 'no message'],
    [{ update_id: 4, message: { text: 'hello there world', from: { id: OWNER } } }, 'chat.id missing'],
    [{ update_id: 5, message: { text: 'hello there world', chat: { id: OWNER, type: 'private' } } }, 'from.id missing'],
    [{ update_id: 6, message: { text: 'hello there world', chat: { id: -100, type: 'group' }, from: { id: OWNER } } }, 'not private'],
    [{ update_id: 7, message: { text: 'hello there world', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: true } } }, 'sender is a bot'],
    [{ update_id: 8, message: { text: 'hello there world', chat: { id: 999, type: 'private' }, from: { id: OWNER } } }, 'does not match'],
    [{ update_id: 9, message: { chat: { id: OWNER, type: 'private' }, from: { id: OWNER }, photo: [] } }, 'no text'],
    [{ update_id: 10, message: { text: '   ', chat: { id: OWNER, type: 'private' }, from: { id: OWNER } } }, 'no text'],
    [{ update_id: 11, message: { text: 'hello there world', chat: { id: OWNER, type: 'private' }, from: { id: OWNER } } }, 'message_id missing']
  ];
  var badOk = bad.every(function (b) { var r = telegram.normalizeUpdate(b[0]); return r.ok === false && r.reason.indexOf(b[1]) !== -1; });
  ok(badOk, 'malformed: ' + bad.length + ' malformed shapes are refused with a specific reason and never throw');
  var cm = telegram.updateToTask(cfg, { update_id: 12, message: { text: 'x' } });
  ok(!cm.task && cm.malformed === true && /malformed update/.test(cm.errors[0]), 'malformed: updateToTask flags malformed=true');

  // --- 3. missing token --------------------------------------------------------------------
  delete process.env.MYTHOS_TELEGRAM_BOT_TOKEN;
  var d0 = telegram.describe();
  ok(d0.token_present === false && d0.ready === false && d0.problems.some(function (p) { return /no bot token/.test(p); }) && d0.token_source === 'none', 'missing token: describe() reports token_present=false, ready=false, names the fix');
  var beforeReq = api.requests.length;
  var threw = null;
  try { await full(); } catch (e) { threw = e; }
  ok(threw && /TELEGRAM_TOKEN_MISSING/.test(threw.message), 'missing token: telegramTick refuses with TELEGRAM_TOKEN_MISSING');
  ok(api.requests.length === beforeReq && !fs.existsSync(cfg.home), 'missing token: no request left the process and no channel state was created');
  var tokenFile = path.join(FIX, 'telegram-bot.env');
  fs.writeFileSync(tokenFile, '# fixture\nMYTHOS_TELEGRAM_BOT_TOKEN="' + TOKEN + '"\n', { mode: 0o600 });
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE = tokenFile;
  ok(telegram.readToken() === TOKEN && telegram.config().tokenSource === 'file' && telegram.describe().ready === true, 'token file: KEY=VALUE file (quoted) is read; describe() is ready and never returns the value');
  ok(JSON.stringify(telegram.describe()).indexOf(TOKEN) === -1 && JSON.stringify(telegram.config()).indexOf(TOKEN) === -1, 'token file: neither describe() nor config() contains the token');
  fs.chmodSync(tokenFile, 0o644);
  var dLoose = telegram.describe();
  ok(dLoose.ready === false && dLoose.problems.some(function (p) { return /mode is 644 \(must be 0600\)/.test(p); }) && JSON.stringify(dLoose).indexOf(TOKEN) === -1, 'token file: a world-readable token file is reported as a problem (not ready), value never shown');
  fs.chmodSync(tokenFile, 0o600);
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE = path.join(FIX, 'missing-token.env');
  var dMissing = telegram.describe();
  ok(dMissing.token_present === false && dMissing.problems.some(function (p) { return /does not exist/.test(p); }), 'token file: a missing file is reported, never thrown');
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE = tokenFile;
  ok(telegram.describe().ready === true, 'token file: back to ready');
  var altFile = path.join(FIX, 'telegram-bot-alt.env');
  fs.writeFileSync(altFile, 'TELEGRAM_BOT_TOKEN=' + TOKEN + '\n', { mode: 0o600 });
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE = altFile;
  ok(telegram.readToken() === TOKEN, 'token file: the plain TELEGRAM_BOT_TOKEN key name is accepted too');
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE = tokenFile;
  process.env.MYTHOS_TELEGRAM_BOT_TOKEN = TOKEN;

  // --- 4. secret redaction ----------------------------------------------------------------
  ok(telegram.scrub('call https://api.telegram.org/bot' + TOKEN + '/sendMessage failed', TOKEN).indexOf(TOKEN) === -1, 'scrub: the configured token is masked in strings');
  ok(telegram.scrub('other bot 987654321:BBanotherTOKENabcdefghijklmnopqrstuvw leaked').indexOf('987654321:') === -1, 'scrub: any bot-token shape is masked, even an unknown one');
  ok(telegram.scrub('MYTHOS_TELEGRAM_BOT_TOKEN=' + TOKEN).indexOf(TOKEN) === -1, 'scrub: KEY=VALUE assignments are masked (shared redaction)');
  var cLeak = telegram.updateToTask(cfg, { update_id: 47, message: { message_id: 12, text: 'Investigate why the bot ' + TOKEN + ' stopped answering.', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false } } });
  ok(!cLeak.task && cLeak.secret === true && /telegram-bot-token/.test(cLeak.errors[0]) && cLeak.errors.join(' ').indexOf(TOKEN) === -1, 'secret in message: refused, kind named, value never echoed');
  ok(telegram.rejectedText('tg-47', cLeak.errors, true).indexOf(TOKEN) === -1, 'secret in message: the rejection reply does not echo the value');
  var cGh = telegram.updateToTask(cfg, { update_id: 48, message: { message_id: 13, text: 'Investigate using ghp_LEAKEDvalue9876543210zyxwvutsrqponmlk please.', chat: { id: OWNER, type: 'private' }, from: { id: OWNER, is_bot: false } } });
  ok(!cGh.task && cGh.secret === true && /github-token/.test(cGh.errors[0]), 'secret in message: shared redaction kinds are refused too');
  var badClient = telegram.createClient(telegram.config(), '111111111:WRONGtokenABCDEFGHIJKLMNOPQRSTUVWXYZab', {});
  var errMsg = null;
  try { await badClient.getMe(); } catch (e) { errMsg = e.message; }
  ok(errMsg && /TELEGRAM_API_401/.test(errMsg) && errMsg.indexOf('WRONGtoken') === -1, 'client error: HTTP 401 surfaces as TELEGRAM_API_401 and the token is not in the message');
  var goodClient = telegram.createClient(telegram.config(), TOKEN, {});
  var me = await goodClient.getMe();
  ok(me && me.username === 'mythos_fixture_bot' && goodClient.calls.length === 1 && JSON.stringify(goodClient.calls).indexOf(TOKEN) === -1, 'client: getMe works and the call log carries no token');

  // --- 5. authorisation rejection -----------------------------------------------------------
  var strangerUpdate = privateMessage(STRANGER, 'Investigate the fixture and report everything you can find.');
  var r5 = await full();
  ok(r5.ok && actionsOf(r5.phases.intake, 'unauthorized').length === 1 && actionsOf(r5.phases.intake, 'unauthorized')[0].user_id === STRANGER, 'authz: a private message from a non-allowlisted user is recorded as unauthorized');
  ok(actionsOf(r5.phases.intake, 'create').length === 0 && !taskOnDisk(telegram.taskIdFor(strangerUpdate.update_id)) && sentTo(STRANGER).length === 0, 'authz: no task file, no reply to the stranger (the bot does not reveal itself)');
  ok(telegram.readOffset(telegram.config()) === strangerUpdate.update_id + 1, 'authz: the poll offset advanced past the dropped update');
  var groupUpdate = pushUpdate({ message: { message_id: 77, text: 'Investigate this from a group please.', chat: { id: -1001, type: 'supergroup' }, from: { id: OWNER, is_bot: false } } });
  var r5b = await full();
  ok(actionsOf(r5b.phases.intake, 'skip_malformed').length === 1 && !taskOnDisk(telegram.taskIdFor(groupUpdate.update_id)) && sentTo(-1001).length === 0, 'authz: the allowlisted user writing from a group is ignored (private chats only)');
  process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = '';
  var fetchesBefore = api.requests.filter(function (q) { return /getUpdates/.test(q.path); }).length;
  var r5c = await full({ skipBridge: true });
  ok(actionsOf(r5c.phases.intake, 'refuse_all').length === 1 && api.requests.filter(function (q) { return /getUpdates/.test(q.path); }).length === fetchesBefore, 'authz: an empty allowlist fails closed — nothing is fetched at all');
  process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = String(OWNER);

  // --- 6. full flow: Telegram → task → bridge → executor (mock) → OTHMODE → report → Telegram ----
  var ownerUpdate = privateMessage(OWNER, 'Investigate the fixture repository and report its HEAD commit and file list.');
  var tid = telegram.taskIdFor(ownerUpdate.update_id);
  var r6 = await full();
  var cr = actionsOf(r6.phases.intake, 'create');
  ok(r6.ok && cr.length === 1 && cr[0].task_id === tid && cr[0].update_id === ownerUpdate.update_id && cr[0].chat_id === OWNER && cr[0].execution_profile === 'repo-read', 'flow: intake created ' + tid + ' from the allowlisted private message');
  var q6 = sentTo(OWNER).filter(function (m) { return /queued/.test(m.text); });
  ok(q6.length === 1 && q6[0].text.indexOf(tid) !== -1 && /investigate → profile repo-read/.test(q6[0].text), 'flow: one "queued" reply with the task id and the profile');
  var t6 = taskOnDisk(tid);
  ok(t6 && t6.source.notifications.queued && t6.source.notifications.queued.message_id === q6[0].message_id, 'flow: the task file records the queued reply message_id');
  ok(actionsOf(r6.phases.intake, 'commit')[0].result.committed === true && git(bcfg.controlDir, ['log', '--format=%s', '-5']).split('\n').filter(function (s) { return s === 'control: telegram → ' + tid; }).length === 1, 'flow: one control commit "telegram → ' + tid + '"');
  ok(actionsOf(r6.phases.bridge, 'claim').length === 1, 'flow: the UNCHANGED bridge claimed the task in the same tick');
  t6 = taskOnDisk(tid);
  ok(t6.status === 'CLAIMED' && t6.execution.executor_task_id && /^OTH-/.test(t6.execution.othmode_task_id || '') && t6.execution.execution_profile === 'repo-read', 'flow: claimed → executor_task_id + OTHMODE record + profile repo-read on the task file');
  var st6 = sentTo(OWNER).filter(function (m) { return /started/.test(m.text); });
  ok(st6.length === 1 && st6[0].text.indexOf(t6.execution.executor_task_id) !== -1 && st6[0].text.indexOf(t6.execution.othmode_task_id) !== -1, 'flow: one "started" reply carrying executor id + OTHMODE id');
  var ex6 = state.readJSON(t6.execution.executor_task_id, 'task.json');
  ok(ex6 && ex6.execution_profile === 'repo-read' && ex6.stage === 'github:' + tid && /^othmode /.test(ex6.instruction) && ex6.instruction.indexOf(t6.execution.othmode_task_id) !== -1, 'flow: the executor task runs profile repo-read under the OTHMODE contract, correlated by stage github:' + tid);
  var r6b = await full();
  ok(actionsOf(r6b.phases.intake, 'create').length === 0 && actionsOf(r6b.phases.notify, 'notify').length === 0 && sentTo(OWNER).length === 2, 'flow: a repeated tick sends nothing twice (offset + ledger idempotency)');
  await runExecutor([{ kind: 'success', summary: 'fixture HEAD ' + MAIN_AT_START.slice(0, 12) + ' reported' }]);
  var r6c = await full();
  var rep6 = reportOnDisk(tid);
  ok(rep6 && rep6.status === 'COMPLETED' && rep6.execution.executor_task_id === t6.execution.executor_task_id, 'flow: bridge wrote control/reports/' + tid + '.json COMPLETED with the executor id');
  var rp6 = sentTo(OWNER).filter(function (m) { return /COMPLETED/.test(m.text); });
  ok(rp6.length === 1 && rp6[0].text.indexOf(tid) !== -1 && rp6[0].text.indexOf('fixture HEAD ' + MAIN_AT_START.slice(0, 12)) !== -1 && /mock: pass/.test(rp6[0].text) && rp6[0].text.indexOf(t6.execution.executor_task_id) !== -1 && rp6[0].text.indexOf(t6.execution.othmode_task_id) !== -1,
    'flow: one report reply with status, summary, tests, executor id and OTHMODE id');
  t6 = taskOnDisk(tid);
  ok(t6.status === 'COMPLETED' && t6.source.notifications.report && t6.source.notifications.report.status === 'COMPLETED' && t6.source.notifications.report.message_id === rp6[0].message_id && t6.source.notifications.started.executor_task_id === t6.execution.executor_task_id,
    'flow: the task file holds the full correlation update_id → task_id → executor_task_id → OTHMODE id → reply message_ids');
  var oth = require(path.join(BASE, 'projects', 'command-center', 'reference', 'othmode', 'tasks.js')).getTask(t6.execution.othmode_task_id);
  ok(oth && oth.status === 'COMPLETED' && oth.terminal === true, 'flow: the OTHMODE record was closed COMPLETED by the bridge (not by the channel)');
  var r6d = await full();
  ok(actionsOf(r6d.phases.notify, 'notify').length === 0 && sentTo(OWNER).filter(function (m) { return /COMPLETED/.test(m.text); }).length === 1, 'flow: the report is replied once');
  ok(git(REPO, ['rev-parse', 'main']) === MAIN_AT_START && git(ORIGIN, ['rev-parse', 'main']) === MAIN_AT_START, 'flow: main and origin/main are untouched (read-only action, report delivery)');
  var stat6 = telegram.status();
  ok(stat6.tasks.length === 1 && stat6.tasks[0].task_id === tid && stat6.tasks[0].report_status === 'COMPLETED' && stat6.tasks[0].othmode_task_id === t6.execution.othmode_task_id && stat6.tasks[0].notifications.report === rp6[0].message_id, 'status: update_id ⇄ task ⇄ executor ⇄ OTHMODE ⇄ report ⇄ replies relation');

  // Reply outage: a failed send is retried on the next tick, never lost, never doubled.
  api.failSend = true;
  var outageUpdate = privateMessage(OWNER, 'Investigate the fixture again during a Telegram outage, reporting HEAD only.');
  var r7 = await full({ skipBridge: true });
  ok(r7.phases.intake.ok === false && /TELEGRAM_API_500/.test(r7.phases.intake.reason) && !taskOnDisk(telegram.taskIdFor(outageUpdate.update_id)) && telegram.readOffset(telegram.config()) === outageUpdate.update_id, 'outage: a failed queued reply aborts the intake, no task file, offset not advanced');
  api.failSend = false;
  var r7b = await full({ skipBridge: true });
  ok(actionsOf(r7b.phases.intake, 'create').length === 1 && sentTo(OWNER).filter(function (m) { return m.text.indexOf(telegram.taskIdFor(outageUpdate.update_id)) !== -1 && /queued/.test(m.text); }).length === 1, 'outage: the next tick creates the task and sends the queued reply exactly once');

  // --- 4b. redaction, end to end: the token appears nowhere on disk except the fixture token file -----
  var leaks = filesContaining(TOKEN).filter(function (f) { return f !== tokenFile && f !== altFile; });
  ok(leaks.length === 0, 'redaction e2e: the token appears in NO task file, report, ledger, offset, OTHMODE record, executor store or bridge log (' + leaks.map(function (f) { return path.relative(FIX, f); }).join(', ') + ')');
  var urlLeaks = api.requests.filter(function (q) { return q.body && q.body.indexOf(TOKEN) !== -1; });
  ok(urlLeaks.length === 0 && api.sent.every(function (m) { return m.text.indexOf(TOKEN) === -1; }), 'redaction e2e: no request body and no reply text carries the token (it is only ever in the URL path)');
  var eventsLog = fs.readFileSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'events.log'), 'utf8');
  ok(/"bridge":"telegram:created"/.test(eventsLog) && /"bridge":"telegram:notify_report"/.test(eventsLog) && /"bridge":"telegram:unauthorized"/.test(eventsLog) && eventsLog.indexOf(TOKEN) === -1,
    'redaction e2e: correlation events (created / notify_report / unauthorized) are logged, token-free');

  // --- 7. the combined CLI with the channel disabled is unchanged ----------------------
  var cli = path.join(EXEC, 'bin', 'mythos-github-bridge');
  // Asynchronous: the fake Bot API is served by THIS process, so a
  // synchronous spawn would starve it and every call would time out.
  function runCli(args, env) {
    return new Promise(function (resolve) {
      var child = cp.spawn(process.execPath, [cli].concat(args), { env: env });
      var so = '', se = '';
      child.stdout.on('data', function (d) { so += d; });
      child.stderr.on('data', function (d) { se += d; });
      child.on('close', function (code) { resolve({ status: code, stdout: so, stderr: se }); });
    });
  }
  var envOff = Object.assign({}, process.env); delete envOff.MYTHOS_TELEGRAM_ENABLED;
  var outOff = await runCli(['tick'], envOff);
  // The CLI prints single-line log entries first and the pretty-printed result last.
  function lastJson(text) { var i = text.lastIndexOf('\n{\n'); try { return JSON.parse(i === -1 ? text : text.slice(i + 1)); } catch (e) { return null; } }
  var jOff = lastJson(outOff.stdout);
  ok(outOff.status === 0 && jOff && jOff.telegram_intake === undefined && jOff.telegram_notify === undefined && jOff.notifications !== undefined, 'cli: `tick` without MYTHOS_TELEGRAM_ENABLED has no Telegram phases and still flushes WhatsApp notifications (status ' + outOff.status + ' ' + outOff.stderr.slice(0, 300) + ')');
  var outOn = await runCli(['tick'], process.env);
  var jOn = lastJson(outOn.stdout);
  ok(outOn.status === 0 && jOn && jOn.telegram_intake && jOn.telegram_intake.ok === true && jOn.telegram_notify && jOn.telegram_notify.ok === true && jOn.notifications !== undefined, 'cli: `tick` with MYTHOS_TELEGRAM_ENABLED=1 runs intake before and notify after the bridge tick, then flushes WhatsApp (status ' + outOn.status + ' ' + outOn.stderr.slice(0, 300) + ')');
  ok(outOn.stdout.indexOf(TOKEN) === -1 && outOn.stderr.indexOf(TOKEN) === -1 && outOff.stdout.indexOf(TOKEN) === -1, 'cli: neither stdout nor stderr of `tick` contains the token');
  var outCfg = await runCli(['telegram-config'], process.env);
  ok(outCfg.status === 0 && /"token_present": true/.test(outCfg.stdout) && outCfg.stdout.indexOf(TOKEN) === -1, 'cli: telegram-config reports token_present without the value');
  var outChk = await runCli(['telegram-check'], process.env);
  ok(outChk.status === 0 && /mythos_fixture_bot/.test(outChk.stdout) && outChk.stdout.indexOf(TOKEN) === -1, 'cli: telegram-check prints the bot username, never the token (status ' + outChk.status + ' ' + outChk.stderr.slice(0, 300) + ')');
  var updFile = path.join(FIX, 'update.json');
  fs.writeFileSync(updFile, JSON.stringify(u1));
  var outParse = await runCli(['telegram-parse', updFile], process.env);
  ok(outParse.status === 0 && /"task_id": "tg-000000042"/.test(outParse.stdout), 'cli: telegram-parse converts an update payload offline');
}

function finish() {
  server.close();
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log('telegram-channel tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.error(failures.join('\n')); process.exit(1); }
  process.exit(0);
}
