#!/usr/bin/env node
// tests/notification-presenter-test.js — gh-issue-191: ONE shared notification
// presenter for WhatsApp and Telegram (short format, simple Arabic
// explanation, explicit owner action, levels, redaction, dedup). Offline.
'use strict';
var fs = require('fs'), path = require('path'), os = require('os');
var FIX = fs.mkdtempSync(path.join(os.tmpdir(), 'mythos-presenter-'));
process.env.MYTHOS_AI_EXECUTOR_HOME = path.join(FIX, 'exec');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'bridge');
process.env.MYTHOS_BRIDGE_WHATSAPP_ENABLED = '1';
process.env.MYTHOS_BRIDGE_WHATSAPP_PROVIDER = 'evolution';
process.env.MYTHOS_BRIDGE_WHATSAPP_BASE_URL = 'http://127.0.0.1:9';
process.env.MYTHOS_BRIDGE_WHATSAPP_INSTANCE = 'fixture';
process.env.MYTHOS_BRIDGE_WHATSAPP_TO = '21620000000';
delete process.env.MYTHOS_TELEGRAM_ENABLED;           // Telegram stays OFF — compatibility only
delete process.env.MYTHOS_TELEGRAM_BOT_TOKEN;
var ROOT = path.resolve(__dirname, '..');
var presenter = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'bridge', 'notify', 'presenter'));
var whatsapp = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'bridge', 'notify', 'whatsapp'));
var telegramEvents = require(path.join(ROOT, 'projects', 'mythos-ai-executor', 'bridge', 'notify', 'telegram-events'));
var passed = 0, failed = 0;
function ok(c, name) { if (c) passed++; else { failed++; console.error('FAIL: ' + name); } }

var SECRET = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0';
function report(over) {
  var r = {
    protocol: 'mythos-control/1', task_id: 'gh-issue-4242', status: 'COMPLETED',
    summary: 'Implemented the feature (executor t-20260905150207-y87efh, OTH-2026-00181, run x-mtoihc63) under /home/deploy/worktrees/x with token ' + SECRET + '.',
    files_changed: ['projects/x/a.js', 'projects/x/b.js'], commits: [{ sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', subject: 'feat: x', on_origin: true }],
    tests: ['tests/x-test.js: 12 passed / 0 failed', 'tests/y-test.js: 3 passed / 0 failed'], problems: ['no problems'],
    next_recommended_action: 'Owner: review and merge PR #999 from /home/deploy/worktrees/x', completed_at: '2026-09-05T15:00:00.000Z',
    execution: { executor_task_id: 't-20260905150207-y87efh', othmode_task_id: 'OTH-2026-00181', model: 'claude-sonnet-5', branch: 'mythos/gh/gh-issue-4242' },
    delivery: { branch: 'mythos/gh/gh-issue-4242', commits_on_origin: true }
  };
  Object.keys(over || {}).forEach(function (k) { r[k] = over[k]; });
  return r;
}
function leaks(text) {
  return ['t-20260905150207-y87efh', 'OTH-2026-00181', 'x-mtoihc63', '/home/deploy', SECRET, 'deadbeefdead', 'projects/x/a.js', 'mythos/gh/gh-issue-4242']
    .filter(function (s) { return text.indexOf(s) !== -1; });
}

// --- 1. the four kinds + CANCELLED: level, icon, Arabic, owner action ------------
var kinds = { COMPLETED: ['INFO', '🟢'], FAILED: ['CRITICAL', '🔴'], BLOCKED: ['CRITICAL', '🔴'], HUMAN_APPROVAL: ['IMPORTANT', '🟠'] };
Object.keys(kinds).forEach(function (kind) {
  var r = report({ status: kind === 'HUMAN_APPROVAL' ? 'BLOCKED' : kind, blocker: kind === 'COMPLETED' ? null : { code: kind === 'HUMAN_APPROVAL' ? 'HUMAN_APPROVAL' : 'PROVIDER_FAILED', reason: 'the reason' } });
  var p = presenter.presentReport(r, kind, { model: 'claude-sonnet-5' });
  ok(p.level === kinds[kind][0] && p.icon === kinds[kind][1] && p.text.indexOf(kinds[kind][1] + ' MYTHOS ' + kind + ' — gh-issue-4242') === 0, kind + ': level ' + kinds[kind][0] + ', header with icon, kind and task id');
  ok(/\nالحالة: /.test(p.text) && /\nماذا حدث: /.test(p.text), kind + ': status line + what happened');
  ok(/\nببساطة: [^\n]{10,}/.test(p.text) && /\nالمطلوب منك: [^\n]{5,}/.test(p.text), kind + ': simple Arabic explanation + explicit owner action');
  ok(leaks(p.text).length === 0, kind + ': no executor/OTHMODE/execution id, path, secret, sha, file or branch in the text (' + leaks(p.text).join(',') + ')');
  ok(p.text.length <= 900, kind + ': short (' + p.text.length + ' chars ≤ 900)');
  ok(p.text.indexOf('control/reports/gh-issue-4242.md') !== -1, kind + ': details reference present by default');
  ok(p.text.indexOf('model claude-sonnet-5') !== -1, kind + ': model name shown when known');
  if (kind !== 'COMPLETED') ok(p.text.indexOf('السبب: ' + (kind === 'HUMAN_APPROVAL' ? 'HUMAN_APPROVAL' : 'PROVIDER_FAILED')) !== -1 && p.text.indexOf('الخطوة التالية: ') !== -1, kind + ': blocker code + next step shown for non-INFO levels');
  else ok(p.text.indexOf('السبب:') === -1 && p.text.indexOf('الخطوة التالية:') === -1, 'COMPLETED: INFO level carries no reason/next-step lines');
});
var pc = presenter.presentReport(report({ commits: [] }), 'COMPLETED');
ok(pc.text.indexOf('المطلوب منك: لا شيء حالياً.') !== -1, 'COMPLETED without commits: "nothing required" is said explicitly');
ok(presenter.presentReport(report(), 'COMPLETED').text.indexOf('المطلوب منك: راجع النتيجة') !== -1, 'COMPLETED with commits: asks for review/merge');
ok(presenter.presentReport(report(), 'COMPLETED').text.indexOf('الاختبارات: 15 ناجحة (2 مجموعة)') !== -1, 'tests are summarised as counts, not listed');
ok(presenter.presentReport(report({ status: 'CANCELLED' }), 'CANCELLED').text.indexOf('🟢 MYTHOS CANCELLED') === 0, 'CANCELLED presents too (Telegram channel reply)');
ok(presenter.presentReport(report(), 'NOPE').kind === 'COMPLETED', 'unknown kind falls back to the report status');
var pn = presenter.presentReport(report(), 'COMPLETED', { details_ref: 'none', guard: true });
ok(pn.text.indexOf('control/reports/') === -1 && pn.text.indexOf('التفاصيل التقنية محفوظة') !== -1 && pn.text.indexOf('guard: MYTHOS protection/monitoring active') !== -1, 'details_ref none: no path, guard only described');
ok(presenter.presentReport(report(), 'COMPLETED').text === presenter.presentReport(report(), 'COMPLETED').text, 'deterministic: same report → identical text (ledger-hashable)');
ok(presenter.presentReport(report(), 'COMPLETED').text !== presenter.presentReport(report({ task_id: 'gh-issue-4243' }), 'COMPLETED').text, 'different task → different text');

// --- 2. redaction / stripping -------------------------------------------------------
ok(presenter.stripInternal('a t-20260905150207-y87efh b OTH-2026-00181 c x-mtoihc63 d /home/deploy/x e /var/lib/mythos/f') === 'a [task ref] b [guard ref] c [run ref] d [path] e [path]', 'stripInternal: ids and paths replaced');
ok(presenter.presentReport(report({ summary: 'token ' + SECRET }), 'COMPLETED').text.indexOf(SECRET) === -1, 'redaction: a secret-shaped string in the summary never reaches the text');
ok(presenter.presentReport(report({ next_recommended_action: 'see ' + SECRET }), 'FAILED').text.indexOf(SECRET) === -1, 'redaction: a secret in next_recommended_action never reaches the text');
ok(presenter.presentReport(report({ problems: ['api_key=' + SECRET] }), 'FAILED').text.indexOf(SECRET) === -1, 'redaction: a secret in problems never reaches the text');
ok(presenter.presentReport({ task_id: 'gh-issue-1', status: 'FAILED', summary: 'x'.repeat(5000) }, 'FAILED').text.length < 1200, 'clipping: a 5000-char summary stays short');

// --- 3. WhatsApp rendering + dedup ----------------------------------------------------
var wa = whatsapp.buildMessage(report(), 'COMPLETED');
ok(wa === presenter.presentReport(report(), 'COMPLETED', { model: 'claude-sonnet-5', details_ref: 'path' }).text, 'whatsapp: buildMessage IS the presenter text (model from the report)');
ok(leaks(wa).length === 0 && wa.indexOf('ببساطة: ') !== -1, 'whatsapp: rendered text is stripped/redacted and carries the Arabic explanation');
var q1 = whatsapp.onReport(report(), {});
var q2 = whatsapp.onReport(report(), {});
ok(q1.queued === true && q1.kind === 'COMPLETED', 'whatsapp dedup: first report queues (' + JSON.stringify(q1) + ')');
ok(q2.queued === false && /already in the ledger/.test(q2.skipped), 'whatsapp dedup: the same report a second time is NOT queued again');
var entry = whatsapp.readEntry(whatsapp.config(), q1.key);
ok(entry && entry.message === wa && entry.message_sha256 && entry.state === 'PENDING', 'whatsapp: the ledger entry stores the presenter text + its hash, PENDING (no network in this test)');
var qh = whatsapp.onReport(report({ status: 'BLOCKED', blocker: { code: 'HUMAN_APPROVAL', reason: 'decide' } }), { human_approval: true });
ok(qh.queued === true && qh.kind === 'HUMAN_APPROVAL' && whatsapp.readEntry(whatsapp.config(), qh.key).message.indexOf('🟠 MYTHOS HUMAN_APPROVAL') === 0, 'whatsapp: HUMAN_APPROVAL renders as IMPORTANT');

// --- 4. Telegram compatibility WITHOUT activation ------------------------------------
var evts = { 'task:created': '🟢', 'task:claimed': '🟢', 'task:completed': '🟢', 'task:failed': '🔴', 'task:blocked': '🔴', 'task:human_approval': '🟠', 'task:cancelled': '🟢', 'pr:opened': '🟢', 'pr:checks_failed': '🔴', 'pr:conflict': '🔴', 'pr:merged': '🟢', 'git:sync_blocker': '🔴', 'git:governance_blocker': '🔴', 'git:bridge_failure': '🔴', 'git:deploy': '🟢' };
Object.keys(evts).forEach(function (full) {
  var c = full.split(':');
  var t = telegramEvents.formatEvent({ category: c[0], event: c[1], id: '#7', status: 'S', title: 'title ' + SECRET + ' /home/deploy/z', result: 'r', next_action: 'n', model: 'claude-haiku-4-5', guard: true });
  ok(t.indexOf(evts[full] + ' MYTHOS ') === 0 && t.indexOf('ببساطة: ') !== -1 && t.indexOf('المطلوب منك: ') !== -1 && t.indexOf(SECRET) === -1 && t.indexOf('/home/deploy') === -1, 'telegram formatEvent ' + full + ': presenter header/level, Arabic, redacted');
});
ok(telegramEvents.stripInternal === presenter.stripInternal, 'telegram-events reuses the presenter stripInternal (one implementation)');
ok(telegramEvents.formatEvent({ category: 'task', event: 'completed', id: '#1' }) === presenter.presentEvent({ category: 'task', event: 'completed', id: '#1' }).text, 'telegram formatEvent IS presentEvent');
telegramEvents.notifyEvent({ category: 'task', event: 'completed', key: 'k1', id: '#1' }).then(function (r) {
  ok(r.sent === false && r.reason === 'disabled', 'telegram stays OFF: notifyEvent with MYTHOS_TELEGRAM_ENABLED unset sends nothing (' + JSON.stringify(r) + ')');
  ok(!fs.existsSync(path.join(process.env.MYTHOS_BRIDGE_HOME, 'telegram-events', 'ledger.json')), 'telegram stays OFF: no Telegram ledger was written');
}).catch(function (e) { ok(false, 'unexpected: ' + (e && e.stack || e)); }).then(function () {
  fs.rmSync(FIX, { recursive: true, force: true });
  console.log('notification-presenter tests: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
});
