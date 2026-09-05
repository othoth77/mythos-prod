'use strict';
// =====================================================================
// MYTHOS notification presenter — ONE presentation layer for every outbound
// owner notification (gh-issue-191).
// projects/mythos-ai-executor/bridge/notify/presenter.js
//
// Channels (WhatsApp `notify/whatsapp.js`, Telegram unified events
// `notify/telegram-events.js`, Telegram channel replies `telegram.js`) do
// not format messages themselves any more: they hand the presenter either
// a validated control REPORT (`presentReport`) or a lifecycle EVENT
// (`presentEvent`) and send `.text`. The channel decides only transport.
//
// Contract (Issue #191, owner decision 2026-09-05):
//   1. header + state           — level icon, MYTHOS, kind/event, task id
//   2. what happened            — one short line, from the report/event
//   3. simple Arabic explanation — non-technical, what it means for the owner
//   4. what the owner must do    — always present; says "nothing" explicitly
//   5. where the details are     — reference only, never the content
// Three levels: 🔴 CRITICAL (failed, blocked, governance/bridge failures),
// 🟠 IMPORTANT (a human decision is required), 🟢 INFO/SUCCESS (short).
// Technical detail (branches, file lists, commit shas, executor/OTHMODE/
// execution ids, host paths, rate limiting, logs) stays OUT of the normal
// message: it lives in the report, docs/AI_HANDOVER.md and the ledgers.
// Nothing is deleted from the underlying data — this is presentation only.
//
// Every text is passed through stripInternal() (identifiers/paths) and the
// governance redactor (secret shapes) before it is returned. Deterministic:
// the same input yields the same text, so channel ledgers can hash it.
// =====================================================================
var redact = require('../../../mythos-orchestrator/lib/redact');

var LEVELS = {
  CRITICAL: { icon: '🔴', label_ar: 'حرج' },
  IMPORTANT: { icon: '🟠', label_ar: 'مهم' },
  INFO: { icon: '🟢', label_ar: 'معلومة' }
};

// Report kinds (the four WhatsApp kinds; CANCELLED never notifies there but
// the Telegram channel reply may present it).
var KIND_LEVEL = { COMPLETED: 'INFO', FAILED: 'CRITICAL', BLOCKED: 'CRITICAL', HUMAN_APPROVAL: 'IMPORTANT', CANCELLED: 'INFO' };
var KIND_AR = {
  COMPLETED: { state: 'نجاح ✅', explain: 'اكتملت المهمة بنجاح والنتيجة جاهزة للمراجعة.', need: 'لا شيء حالياً.', need_commits: 'راجع النتيجة، وادمج التغييرات إن كانت مناسبة.' },
  FAILED: { state: 'فشل ❌', explain: 'لم تكتمل المهمة بسبب خطأ أثناء التنفيذ.', need: 'راجع سبب الفشل، ثم صحّح الطلب أو أعد تشغيل المهمة (rerun).' },
  BLOCKED: { state: 'متوقفة ⛔', explain: 'توقفت المهمة قبل الاكتمال لأن شرطاً مطلوباً غير متوفر.', need: 'راجع سبب التوقف وقرر الخطوة التالية.' },
  HUMAN_APPROVAL: { state: 'بانتظار قرارك 🙋', explain: 'المهمة متوقفة في انتظار قرار بشري، ولن تتقدم تلقائياً.', need: 'قرارك مطلوب: وافق أو ارفض، ثم أعد التشغيل أو أغلق المهمة.' },
  CANCELLED: { state: 'أُلغيت', explain: 'أُلغيت المهمة بطلب من صاحبها.', need: 'لا شيء حالياً.' }
};

// Lifecycle events (category:event) — level + Arabic meaning.
var EVENT_AR = {
  'task:created': { level: 'INFO', explain: 'تم استلام مهمة جديدة وستبدأ قريباً.', need: 'لا شيء حالياً.' },
  'task:claimed': { level: 'INFO', explain: 'بدأ تنفيذ المهمة.', need: 'لا شيء حالياً.' },
  'task:completed': { level: 'INFO', explain: KIND_AR.COMPLETED.explain, need: KIND_AR.COMPLETED.need },
  'task:failed': { level: 'CRITICAL', explain: KIND_AR.FAILED.explain, need: KIND_AR.FAILED.need },
  'task:blocked': { level: 'CRITICAL', explain: KIND_AR.BLOCKED.explain, need: KIND_AR.BLOCKED.need },
  'task:human_approval': { level: 'IMPORTANT', explain: KIND_AR.HUMAN_APPROVAL.explain, need: KIND_AR.HUMAN_APPROVAL.need },
  'task:cancelled': { level: 'INFO', explain: KIND_AR.CANCELLED.explain, need: KIND_AR.CANCELLED.need },
  'pr:opened': { level: 'INFO', explain: 'تم فتح طلب دمج جديد للمراجعة.', need: 'راجع طلب الدمج عندما يناسبك.' },
  'pr:updated': { level: 'INFO', explain: 'تم تحديث طلب دمج مفتوح.', need: 'لا شيء حالياً.' },
  'pr:review': { level: 'INFO', explain: 'وصلت مراجعة على طلب دمج.', need: 'اطّلع على المراجعة.' },
  'pr:checks': { level: 'INFO', explain: 'اكتملت فحوصات طلب الدمج.', need: 'لا شيء حالياً.' },
  'pr:checks_failed': { level: 'CRITICAL', explain: 'فشلت فحوصات طلب الدمج.', need: 'راجع الفحوصات الفاشلة قبل الدمج.' },
  'pr:merged': { level: 'INFO', explain: 'تم دمج التغييرات في الفرع الرئيسي.', need: 'لا شيء حالياً.' },
  'pr:closed_without_merge': { level: 'INFO', explain: 'أُغلق طلب الدمج دون دمج.', need: 'لا شيء حالياً.' },
  'pr:conflict': { level: 'CRITICAL', explain: 'يوجد تعارض يمنع دمج طلب الدمج.', need: 'يجب حل التعارض قبل الدمج.' },
  'git:deploy': { level: 'INFO', explain: 'تم نشر إصدار جديد.', need: 'لا شيء حالياً.' },
  'git:sync_blocker': { level: 'CRITICAL', explain: 'تعذّر مزامنة الكود مع GitHub.', need: 'راجع حالة المزامنة قبل تشغيل مهام جديدة.' },
  'git:governance_blocker': { level: 'CRITICAL', explain: 'أوقفت الحوكمة تغييراً غير معتمد ولم يُنشر.', need: 'راجع التغيير واعتمده أو ارفضه.' },
  'git:bridge_failure': { level: 'CRITICAL', explain: 'حدث خلل في جسر MYTHOS ويحتاج إلى فحص.', need: 'راجع التفاصيل وقرر الخطوة التالية.' }
};
var DEFAULT_EVENT_AR = { level: 'INFO', explain: 'حدث جديد في MYTHOS.', need: 'لا شيء حالياً.' };

// Internal identifiers that must never leave the presenter, even if a caller
// passes them inside free text (summary / title / next action).
var EXECUTOR_ID_RE = /\bt-\d{8,}-[a-z0-9]{4,10}\b/g;
var OTHMODE_ID_RE = /\bOTH-\d{4}-\d{3,8}\b/g;
var EXECUTION_ID_RE = /\bx-[a-z0-9]{6,16}\b/g;
var PATH_RE = /(?:\/home\/[^\s]+|~\/[^\s]+|\/srv\/[^\s]+|\/var\/lib\/[^\s]+)/g;

function stripInternal(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(EXECUTOR_ID_RE, '[task ref]')
    .replace(OTHMODE_ID_RE, '[guard ref]')
    .replace(EXECUTION_ID_RE, '[run ref]')
    .replace(PATH_RE, '[path]');
}

function clip(text, max) {
  var s = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Sanitise every free-text fragment: identifiers out, secret shapes out.
function safe(text, max) { return redact.redact(stripInternal(clip(text, max))); }

function testsLine(report) {
  var tests = Array.isArray(report.tests) ? report.tests : [];
  if (!tests.length) return null;
  // "X passed / Y failed" style entries are summarised as counts only.
  var pass = 0, fail = 0, counted = 0;
  tests.forEach(function (t) {
    var m = /(\d+)\s*(?:passed|\/)\s*(?:\/\s*)?(\d+)?/i.exec(String(t));
    if (m) { counted++; pass += parseInt(m[1], 10) || 0; fail += parseInt(m[2] || '0', 10) || 0; }
  });
  if (counted && fail === 0) return 'الاختبارات: ' + pass + ' ناجحة (' + tests.length + ' مجموعة)';
  if (counted) return 'الاختبارات: ' + pass + ' ناجحة / ' + fail + ' فاشلة';
  return 'الاختبارات: ' + tests.length + ' نتيجة مسجّلة';
}

// presentReport(report, kind, opts) → { level, icon, kind, task_id, lines, text }
//   kind: COMPLETED | FAILED | BLOCKED | HUMAN_APPROVAL | CANCELLED
//   opts.details_ref: 'path' (default; names control/reports/<id>) | 'none'
//   opts.model: Claude model name to show (when the caller knows it)
//   opts.guard: true → generic "MYTHOS protection/monitoring active" line
function presentReport(report, kind, opts) {
  opts = opts || {};
  report = report || {};
  kind = KIND_LEVEL[kind] ? kind : (KIND_LEVEL[report.status] ? report.status : 'BLOCKED');
  var level = KIND_LEVEL[kind];
  var L = LEVELS[level];
  var ar = KIND_AR[kind];
  var commits = Array.isArray(report.commits) ? report.commits.length : 0;
  var problems = Array.isArray(report.problems) ? report.problems.filter(function (p) { return p && !/^no problems$/i.test(String(p)); }) : [];
  var lines = [];
  lines.push(L.icon + ' MYTHOS ' + kind + ' — ' + String(report.task_id || '?'));
  lines.push('الحالة: ' + ar.state);
  if (report.summary) lines.push('ماذا حدث: ' + safe(report.summary, 220));
  var tl = testsLine(report);
  if (tl) lines.push(tl);
  if (level === 'CRITICAL' || level === 'IMPORTANT') {
    if (report.blocker && report.blocker.code) lines.push('السبب: ' + safe(report.blocker.code + (report.blocker.reason ? ' — ' + report.blocker.reason : ''), 200));
    else if (problems.length) lines.push('المشكلة: ' + safe(problems[0], 200));
    if (report.next_recommended_action) lines.push('الخطوة التالية: ' + safe(report.next_recommended_action, 200));
  }
  lines.push('');
  lines.push('ببساطة: ' + ar.explain);
  lines.push('المطلوب منك: ' + (kind === 'COMPLETED' && commits > 0 ? ar.need_commits : ar.need));
  var tail = [];
  if (opts.model) tail.push('model ' + clip(opts.model, 60));
  if (opts.guard) tail.push('guard: MYTHOS protection/monitoring active');
  if (tail.length) { lines.push(''); lines.push(tail.join(' · ')); }
  lines.push('');
  if (opts.details_ref === 'none') lines.push('📄 التفاصيل التقنية محفوظة في تقرير المهمة.');
  else lines.push('📄 التفاصيل: control/reports/' + String(report.task_id || '?') + '.md (فرع mythos/control)');
  var text = redact.redact(stripInternal(lines.join('\n')));
  return { level: level, icon: L.icon, kind: kind, task_id: report.task_id || null, lines: lines, text: text };
}

// presentEvent(evt) → { level, icon, event, text }
//   evt = { category: 'task'|'pr'|'git', event, id, status, title, result,
//           next_action, model, guard, critical }
var CATEGORY_LABEL = { task: 'TASK', pr: 'PR', git: 'SYSTEM' };
function presentEvent(evt) {
  evt = evt || {};
  var category = String(evt.category || 'task');
  var event = String(evt.event || '').split(':').pop();
  var full = category + ':' + event;
  var ar = EVENT_AR[full] || DEFAULT_EVENT_AR;
  var level = evt.critical === true && ar.level === 'INFO' ? 'CRITICAL' : ar.level;
  var L = LEVELS[level];
  var label = CATEGORY_LABEL[category] || category.toUpperCase();
  var lines = [];
  var head = L.icon + ' MYTHOS ' + label + ': ' + event + (evt.id !== undefined && evt.id !== null ? ' ' + evt.id : '');
  if (evt.status) head += ' (' + evt.status + ')';
  lines.push(head);
  if (evt.title) lines.push(safe(evt.title, 200));
  if (evt.result) lines.push('result: ' + safe(evt.result, 200));
  if (evt.next_action && level !== 'INFO') lines.push('next: ' + safe(evt.next_action, 200));
  lines.push('');
  lines.push('ببساطة: ' + ar.explain);
  lines.push('المطلوب منك: ' + ar.need);
  var tail = [];
  if (evt.model) tail.push('model ' + clip(evt.model, 60));
  if (evt.guard) tail.push('guard: MYTHOS protection/monitoring active');
  if (tail.length) { lines.push(''); lines.push(tail.join(' · ')); }
  var text = redact.redact(stripInternal(lines.join('\n')));
  return { level: level, icon: L.icon, event: full, lines: lines, text: text };
}

module.exports = {
  LEVELS: LEVELS,
  KIND_LEVEL: KIND_LEVEL,
  EVENT_AR: EVENT_AR,
  stripInternal: stripInternal,
  clip: clip,
  presentReport: presentReport,
  presentEvent: presentEvent
};
