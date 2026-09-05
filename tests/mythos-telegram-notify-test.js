'use strict';
// =====================================================
// MYTHOS — unified Telegram notification sink tests
// tests/mythos-telegram-notify-test.js
//
// Offline and deterministic. The Telegram Bot API is stood in for by a local
// http server on 127.0.0.1 that records every request — the real adapter
// (bridge/telegram.js's createClient) and the real sink
// (bridge/notify/telegram-notify.js) are both exercised; only the far end is
// a fixture. No real token, no real chat.
//
// Sections:
//   1. disabled by default
//   2. message formatting (every kind; Arabic templates; no internal ids)
//   3. deduplication (unchanged content never resent; changed content does)
//   4. rate limiting / pacing between sends
//   5. failure/blocker kinds are never silently dropped
//   6. security: bot token and internal identifiers never leak
//   7. operator surface (describe / ledgerStatus)
// =====================================================
var fs = require('fs');
var os = require('os');
var path = require('path');
var http = require('http');

var BASE = path.join(__dirname, '..');
var EXEC = path.join(BASE, 'projects', 'mythos-ai-executor');
var FIX = path.join(os.homedir(), 'mythos-tg-notify-test-' + process.pid);
fs.mkdirSync(FIX, { recursive: true });

var TOKEN = '987654321:BBtestTOKENabcdefghijklmnopqrstuvwx';
var OWNER = 555001;

process.env.MYTHOS_EXECUTOR_HOME = path.join(FIX, 'home');
process.env.MYTHOS_BRIDGE_HOME = path.join(FIX, 'home', 'bridge');
process.env.MYTHOS_TELEGRAM_BOT_TOKEN = TOKEN;
process.env.MYTHOS_TELEGRAM_ALLOWED_USER_IDS = String(OWNER);
delete process.env.MYTHOS_TELEGRAM_BOT_TOKEN_FILE;
delete process.env.MYTHOS_TELEGRAM_NOTIFY_CHAT_IDS;
delete process.env.MYTHOS_TELEGRAM_ENABLED; // the notify sink has its own flag, independent of the intake channel
process.env.MYTHOS_TELEGRAM_NOTIFY_MIN_GAP_MS = '30';
process.env.MYTHOS_TELEGRAM_NOTIFY_MAX_PER_FLUSH = '10';
delete process.env.MYTHOS_TELEGRAM_NOTIFY_ENABLED;

var tn = require(path.join(EXEC, 'bridge', 'notify', 'telegram-notify'));

var passed = 0, failed = 0, failures = [];
function ok(cond, name) { if (cond) passed++; else { failed++; failures.push(name); console.error('FAIL: ' + name); } }

// --- fake Telegram Bot API ----------------------------------------------------------
var api = { sent: [], failNext: 0 };
var server = http.createServer(function (req, res) {
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', function () {
    var text = Buffer.concat(chunks).toString('utf8');
    var body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    var u = new URL(req.url, 'http://x');
    function send(code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
    var m = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
    if (!m) return send(404, { ok: false, description: 'Not Found' });
    if (m[1] !== TOKEN) return send(401, { ok: false, description: 'Unauthorized' });
    if (m[2] === 'sendMessage') {
      if (api.failNext > 0) { api.failNext--; return send(500, { ok: false, description: 'fixture outage' }); }
      var entry = { chat_id: body.chat_id, text: body.text, at: Date.now() };
      api.sent.push(entry);
      return send(200, { ok: true, result: { message_id: api.sent.length, chat: { id: body.chat_id }, text: body.text } });
    }
    send(404, { ok: false, description: 'unhandled ' + m[2] });
  });
});

function run() {
  var PORT = server.address().port;
  process.env.MYTHOS_TELEGRAM_API_BASE = 'http://127.0.0.1:' + PORT;

  // ================================================================
  // 1. disabled by default
  // ================================================================
  var d0 = tn.describe();
  ok(d0.enabled === false, 'default: telegram-notify is disabled until MYTHOS_TELEGRAM_NOTIFY_ENABLED=1');
  var e0 = tn.enqueue('TASK_COMPLETED', 'gh-issue-1', { number: 1, result: 'done' });
  ok(e0.queued === false && /disabled/.test(e0.skipped), 'default: enqueue is a no-op while disabled');

  return tn.flush().then(function (f0) {
    ok(f0.ok === true && f0.enabled === false && f0.attempted === 0, 'default: flush is a no-op while disabled');
    ok(api.sent.length === 0, 'default: no request reached the Bot API');

    process.env.MYTHOS_TELEGRAM_NOTIFY_ENABLED = '1';

    // ================================================================
    // 2. message formatting
    // ================================================================
    var mCreated = tn.formatMessage('TASK_CREATED', { number: 180, description: 'وصف قصير' });
    ok(/^🟡 TASK #180 — تم إنشاء المهمة\./.test(mCreated) && /الوصف: وصف قصير/.test(mCreated), 'format: TASK_CREATED matches the unified template');

    var mStarted = tn.formatMessage('TASK_STARTED', { taskId: 't-1', model: 'Claude Haiku 4.5' });
    ok(/^🔵 TASK t-1 — بدأ التنفيذ\./.test(mStarted) && mStarted.indexOf('🤖 Claude Haiku 4.5') !== -1, 'format: TASK_STARTED shows the model when known');

    var mDone = tn.formatMessage('TASK_COMPLETED', { number: 5, result: 'كل شيء نجح' });
    ok(/^🟢 TASK #5 — اكتملت المهمة\./.test(mDone) && /النتيجة: كل شيء نجح/.test(mDone), 'format: TASK_COMPLETED');

    var mBlocked = tn.formatMessage('TASK_BLOCKED', { number: 7, reason: 'protected path' });
    ok(/^🔴 TASK #7 — متوقفة\./.test(mBlocked) && /السبب: protected path/.test(mBlocked) && /👉 المطلوب: تدخل المالك\./.test(mBlocked), 'format: TASK_BLOCKED asks for owner intervention');

    var mHuman = tn.formatMessage('HUMAN_APPROVAL', { number: 8, reason: 'owner decision required' });
    ok(/بانتظار قرار المالك/.test(mHuman) && /👉 المطلوب: تدخل المالك\./.test(mHuman), 'format: HUMAN_APPROVAL');

    var mMerged = tn.formatMessage('PR_MERGED', { subjectLabel: 'PR', number: 42, result: 'squash merge' });
    ok(/^🔀 PR #42 — تم الدمج\./.test(mMerged), 'format: PR_MERGED');

    var mClosed = tn.formatMessage('PR_CLOSED', { subjectLabel: 'PR', number: 43, reason: 'superseded' });
    ok(/^⚪ PR #43 — أُغلق دون دمج\./.test(mClosed), 'format: PR_CLOSED');

    var mChecksFail = tn.formatMessage('PR_CHECKS', { subjectLabel: 'PR', number: 9, mark: '❌', result: 'اختبار مهم فشل.' });
    ok(mChecksFail.indexOf('❌') === 0 && /نتائج الاختبارات/.test(mChecksFail), 'format: PR_CHECKS honours a dynamic mark');

    var mGov = tn.formatMessage('GOVERNANCE_BLOCKER', { reason: 'merge denied by policy' });
    ok(/نظام حماية\/مراقبة MYTHOS/.test(mGov) && mGov.indexOf('OTHMODE') === -1, 'format: OTHMODE is described generically, never named, in a system-level blocker');

    // kindForReport() / fieldsFromReport(): the mapping github-bridge.js's
    // finishTask() actually relies on.
    ok(tn.kindForReport('COMPLETED', {}) === 'TASK_COMPLETED', 'kindForReport: COMPLETED -> TASK_COMPLETED');
    ok(tn.kindForReport('FAILED', {}) === 'TASK_FAILED', 'kindForReport: FAILED -> TASK_FAILED');
    ok(tn.kindForReport('BLOCKED', {}) === 'TASK_BLOCKED', 'kindForReport: BLOCKED -> TASK_BLOCKED');
    ok(tn.kindForReport('BLOCKED', { human_approval: true }) === 'HUMAN_APPROVAL', 'kindForReport: BLOCKED + human_approval -> HUMAN_APPROVAL');
    ok(tn.kindForReport('CANCELLED', {}) === null && tn.kindForReport('PENDING', {}) === null, 'kindForReport: CANCELLED and non-terminal statuses never notify');

    var fakeTask = { task_id: 'gh-issue-77', model: 'sonnet', source: { kind: 'github-issue', issue_number: 77 } };
    var fakeReport = {
      status: 'BLOCKED', summary: 'stopped', problems: ['owner decision required: merge blocked'],
      next_recommended_action: 'ask the owner', blocker: { code: 'GOVERNANCE_DENIED', reason: 'protected path touched' },
      execution: { executor_task_id: 'x-secret-exec-id', othmode_task_id: 'OTH-2026-99999', model: 'claude-sonnet-5' }
    };
    var flds = tn.fieldsFromReport(fakeTask, fakeReport);
    ok(flds.number === 77 && flds.taskId === 'gh-issue-77', 'fieldsFromReport: number comes from the Issue source block');
    ok(flds.reason === 'protected path touched', 'fieldsFromReport: prefers the structured blocker reason');
    ok(JSON.stringify(flds).indexOf('x-secret-exec-id') === -1 && JSON.stringify(flds).indexOf('OTH-2026-99999') === -1,
      'fieldsFromReport: never carries the executor task id or the OTHMODE id, even though the report itself has them');

    // Internal identifiers are never accepted as a formatting field in the
    // first place — every builder in this file only ever receives task_id /
    // issue-or-PR number / short text, proven again in section 6 below.

    // ================================================================
    // 3. deduplication
    // ================================================================
    var k1 = tn.enqueue('TASK_COMPLETED', 'gh-issue-11', { number: 11, result: 'first result' });
    ok(k1.queued === true, 'dedup: first enqueue for a (subject, kind) is queued');
    var k2 = tn.enqueue('TASK_COMPLETED', 'gh-issue-11', { number: 11, result: 'first result' });
    ok(k2.queued === false && /duplicate/.test(k2.skipped), 'dedup: identical content for the same (subject, kind) is never queued twice');
    var k3 = tn.enqueue('TASK_COMPLETED', 'gh-issue-11', { number: 11, result: 'a DIFFERENT result' });
    ok(k3.queued === true && k3.key === k1.key, 'dedup: changed content for the same key replaces the stale entry instead of being suppressed');

    return tn.flush({ limit: 1 }).then(function (f1) {
      ok(f1.sent === 1, 'dedup: flush delivers the (now single, updated) pending entry once');
      ok(api.sent.length === 1 && /a DIFFERENT result/.test(api.sent[0].text), 'dedup: the delivered message is the latest content, not the superseded one');
      var again = tn.enqueue('TASK_COMPLETED', 'gh-issue-11', { number: 11, result: 'a DIFFERENT result' });
      ok(again.queued === false, 'dedup: once SENT, resubmitting the exact same content is refused');

      // ================================================================
      // 4. rate limiting / pacing
      // ================================================================
      api.sent.length = 0;
      tn.enqueue('TASK_CREATED', 'gh-issue-20', { number: 20, description: 'a' });
      tn.enqueue('TASK_CREATED', 'gh-issue-21', { number: 21, description: 'b' });
      tn.enqueue('TASK_CREATED', 'gh-issue-22', { number: 22, description: 'c' });
      return tn.flush({ limit: 3 }).then(function (f2) {
        ok(f2.sent === 3, 'rate limit: all 3 distinct events are eventually delivered');
        var gaps = [];
        for (var i = 1; i < api.sent.length; i++) gaps.push(api.sent[i].at - api.sent[i - 1].at);
        ok(gaps.every(function (g) { return g >= 25; }), 'rate limit: consecutive sends respect the configured minimum gap (allowing small timer slack)');

        // A per-flush cap bounds a burst instead of sending everything at once.
        api.sent.length = 0;
        for (var n = 0; n < 5; n++) tn.enqueue('PR_OPENED', 'PR-' + (100 + n), { subjectLabel: 'PR', number: 100 + n, description: 'x' });
        return tn.flush({ limit: 2 }).then(function (f3) {
          ok(f3.attempted === 2 && f3.sent === 2, 'rate limit: a per-flush cap limits one flush to its configured batch size');
          var remaining = tn.listEntries(tn.config()).filter(function (e) { return e.state === 'PENDING'; });
          ok(remaining.length === 3, 'rate limit: the rest stays queued for the next flush rather than being dropped');
          return tn.flush({ limit: 10 });
        }).then(function (f4) {
          ok(f4.sent === 3, 'rate limit: the deferred remainder is delivered on the next flush');

          // ================================================================
          // 5. failure / blocker kinds are never silently dropped
          // ================================================================
          api.failNext = 2; // fail this entry's next 2 attempts, then let it through
          var bk = tn.enqueue('TASK_BLOCKED', 'gh-issue-99', { number: 99, reason: 'governance denied' });
          ok(bk.queued === true, 'resilience: a blocked-task notification is queued like any other');
          return tn.flush({ limit: 1 }).then(function (r1) {
            ok(r1.sent === 0 && r1.failed === 1, 'resilience: a transient Bot API failure does not mark the entry delivered');
            var entry = tn.readEntry(tn.config(), bk.key);
            ok(entry.state === 'PENDING' && entry.attempts === 1, 'resilience: a failed attempt schedules a retry instead of being discarded');
            entry.next_attempt_at = new Date(0).toISOString(); // force it due immediately for the test
            fs.writeFileSync(path.join(tn.config().ledgerDir, bk.key + '.json'), JSON.stringify(entry));
            return tn.flush({ limit: 1 });
          }).then(function (r2) {
            var entry = tn.readEntry(tn.config(), bk.key);
            if (entry.state === 'PENDING') { entry.next_attempt_at = new Date(0).toISOString(); fs.writeFileSync(path.join(tn.config().ledgerDir, bk.key + '.json'), JSON.stringify(entry)); }
            return tn.flush({ limit: 1 });
          }).then(function () {
            var entry = tn.readEntry(tn.config(), bk.key);
            ok(entry.state === 'SENT', 'resilience: the blocker notification is eventually delivered once the Bot API recovers, never abandoned');
            ok(api.sent.some(function (m) { return /governance denied/.test(m.text); }), 'resilience: the delivered message carries the real reason');

            // ================================================================
            // 6. security: bot token and internal identifiers never leak
            // ================================================================
            var everySent = api.sent.map(function (m) { return m.text; }).join('\n');
            ok(everySent.indexOf(TOKEN) === -1, 'security: the bot token never appears in any delivered message');
            ok(everySent.indexOf('OTH-2026') === -1 && everySent.indexOf('OTHMODE') === -1, 'security: no OTHMODE identifier ever appears in a delivered message');
            ok(everySent.indexOf('/home/') === -1 && everySent.indexOf(FIX) === -1, 'security: no filesystem path ever appears in a delivered message');
            var ledgerRaw = fs.readdirSync(tn.config().ledgerDir).map(function (f) { return fs.readFileSync(path.join(tn.config().ledgerDir, f), 'utf8'); }).join('\n');
            ok(ledgerRaw.indexOf(TOKEN) === -1, 'security: the bot token is never written to the ledger either');

            // ================================================================
            // 7. operator surface
            // ================================================================
            var d = tn.describe();
            ok(d.enabled === true && Array.isArray(d.kinds) && d.kinds.length === tn.KINDS.length, 'operator: describe() reports live configuration');
            var st = tn.ledgerStatus();
            ok(st.counts.SENT >= 1 && typeof st.ledger_dir === 'string', 'operator: ledgerStatus() reports counts without message bodies leaking secrets in the summary row');
            ok(st.entries.every(function (e) { return e.message === undefined; }), 'operator: ledgerStatus() rows never include the raw message body');
          });
        });
      });
    });
  });
}

server.listen(0, '127.0.0.1', function () {
  run().then(function () {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    server.close();
    fs.rmSync(FIX, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }, function (e) {
    console.error('FATAL', e && e.stack || e);
    server.close();
    process.exit(1);
  });
});
