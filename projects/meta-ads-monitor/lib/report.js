'use strict';
// =====================================================
// Facebook Ads Monitor — plain-language daily report (Arabic, Markdown)
// projects/meta-ads-monitor/lib/report.js
//
// For the owner, not for engineers: no ids unless needed to find a
// campaign, no API vocabulary. Sections are exactly: what works, what
// changed, what needs attention, spend/budget, delivery problems,
// campaigns to review, significant changes. Every recommendation is a
// question for the owner — this system never acts.
// =====================================================

var FOOTER = '— هذا التقرير للقراءة فقط. النظام لا يغيّر أي حملة أو ميزانية (Facebook Ads Monitor is READ-ONLY by design).';

var KIND_TEXT = {
  new: 'جديد', removed: 'اختفى أو حُذف', status: 'تغيّرت الحالة', effective_status: 'تغيّرت حالة العرض',
  daily_budget: 'تغيّرت الميزانية اليومية', lifetime_budget: 'تغيّرت الميزانية الإجمالية',
  account_status: 'تغيّرت حالة الحساب', daily_spend: 'تغيّر إنفاق اليوم بشكل كبير'
};
var TYPE_TEXT = { campaign: 'حملة', adset: 'مجموعة إعلانية', ad: 'إعلان', account: 'الحساب' };
var STATUS_TEXT = {
  ACTIVE: 'نشطة', PAUSED: 'متوقفة', DISAPPROVED: 'مرفوضة', WITH_ISSUES: 'بها مشاكل', PENDING_REVIEW: 'قيد المراجعة',
  PENDING_BILLING_INFO: 'تنتظر معلومات الدفع', CAMPAIGN_PAUSED: 'حملتها متوقفة', ADSET_PAUSED: 'مجموعتها متوقفة',
  ARCHIVED: 'مؤرشفة', DELETED: 'محذوفة', IN_PROCESS: 'قيد المعالجة', PREAPPROVED: 'موافق عليها مبدئياً'
};
function ar(text) {
  return String(text).replace(/\b[A-Z][A-Z_]{3,}\b/g, function (w) { return STATUS_TEXT[w] || w; });
}

function money(v, cur) { return v === null || v === undefined ? 'غير متوفر' : (Math.round(v * 100) / 100) + ' ' + (cur || ''); }
function bullets(list, empty) { return list.length ? list.map(function (x) { return '- ' + x; }).join('\n') : '- ' + empty; }
function changeLine(c, cur) {
  var money2 = ['daily_budget', 'lifetime_budget', 'daily_spend'].indexOf(c.kind) !== -1;
  var fmt = function (v) { return v === null || v === undefined ? '—' : (money2 ? money(v, cur) : ar(v)); };
  var s = (TYPE_TEXT[c.type] || c.type) + ' «' + (c.name || c.id) + '»: ' + (KIND_TEXT[c.kind] || c.kind);
  if (c.kind !== 'new' && c.kind !== 'removed') s += ' (' + fmt(c.before) + ' ← ' + fmt(c.after) + ')';
  return s;
}

function renderAccount(a) {
  var cur = a.currency;
  var sig = a.changes.filter(function (c) { return c.significant; });
  var lines = [];
  lines.push('## الحساب: ' + (a.name || a.id) + ' — ' + (a.account_status === 'ACTIVE' ? 'نشط' : a.account_status));
  lines.push('');
  lines.push('### ما يعمل');
  lines.push(bullets(a.working.map(function (w) {
    return '«' + w.name + '»: ظهر ' + w.impressions_yesterday + ' مرة أمس، إنفاق ' + money(w.spend_yesterday, cur) +
      (w.actions_yesterday !== null ? '، نتائج مُبلَّغة: ' + w.actions_yesterday : '');
  }), 'لا توجد حملة نشطة ظهرت أمس.'));
  lines.push('');
  lines.push('### ما تغيّر منذ الفحص السابق');
  lines.push(a.compared === false ? '- هذا أول فحص — لا يوجد فحص سابق للمقارنة.'
    : bullets(a.changes.filter(function (c) { return c.kind !== 'updated_time'; }).map(function (c) { return changeLine(c, cur); }), 'لا تغييرات.'));
  lines.push('');
  lines.push('### ما يحتاج انتباهك');
  var att = a.attention.map(function (x) { return x.text; })
    .concat(a.delivery.length ? ['يوجد ' + a.delivery.length + ' مشكلة في العرض (انظر أدناه).'] : [])
    .concat(a.review.length ? ['يوجد ' + a.review.length + ' ملاحظة على حملات تحتاج مراجعة (انظر أدناه).'] : []);
  lines.push(bullets(att, 'لا شيء عاجل.'));
  lines.push('');
  lines.push('### الإنفاق والميزانية');
  lines.push('- إنفاق أمس: ' + money(a.spend.yesterday, cur));
  lines.push('- إنفاق آخر 7 أيام: ' + money(a.spend.last_7d, cur));
  lines.push('- الإنفاق الكلي للحساب: ' + money(a.spend.amount_spent_lifetime, cur) +
    (a.spend.spend_cap ? ' من حد ' + money(a.spend.spend_cap, cur) : ' (لا يوجد حد إنفاق للحساب)'));
  a.spend.active_daily_budgets.forEach(function (b) {
    lines.push('- ميزانية «' + b.name + '»: ' + (b.daily_budget !== null ? 'يومية ' + money(b.daily_budget, cur)
      : b.lifetime_budget !== null ? 'إجمالية ' + money(b.lifetime_budget, cur) : 'على مستوى المجموعات الإعلانية') +
      (b.budget_remaining !== null ? '، المتبقي ' + money(b.budget_remaining, cur) : ''));
  });
  lines.push('');
  lines.push('### مشاكل العرض');
  lines.push(bullets(a.delivery.map(function (d) { return '«' + d.name + '»: ' + ar(d.text); }), 'لا توجد مشاكل عرض.'));
  lines.push('');
  lines.push('### حملات تحتاج مراجعة');
  lines.push(bullets(a.review.map(function (r) { return '«' + r.name + '»: ' + r.text + ' — القرار لك، لم يُنفَّذ أي شيء.'; }), 'لا توجد.'));
  lines.push('');
  lines.push('### أهم التغييرات');
  lines.push(a.compared === false ? '- لا يوجد فحص سابق.' : bullets(sig.map(function (c) { return changeLine(c, cur); }), 'لا تغييرات مهمة.'));
  if (a.unavailable.length) {
    lines.push('');
    lines.push('### بيانات لم تتوفر هذه المرة');
    lines.push(bullets(a.unavailable, ''));
  }
  return lines.join('\n');
}

// render({ date, findings }) → markdown
function render(ctx) {
  var f = ctx.findings;
  var lines = ['# تقرير Facebook Ads اليومي — ' + ctx.date, ''];
  var totalAtt = 0;
  f.accounts.forEach(function (a) { totalAtt += a.attention.length + a.delivery.length + a.review.length; });
  lines.push('**الخلاصة:** ' + f.accounts.length + ' حساب، ' +
    (totalAtt ? totalAtt + ' نقطة تحتاج نظرك.' : 'لا شيء يحتاج تدخلاً اليوم.') +
    (f.compared ? ' (مقارنة مع فحص ' + String(f.previous_at).slice(0, 16).replace('T', ' ') + ' UTC)' : ' (أول فحص)'));
  lines.push('');
  f.accounts.forEach(function (a) { a.compared = f.compared; lines.push(renderAccount(a)); lines.push(''); });
  if (!f.accounts.length) lines.push('لا يوجد أي حساب إعلاني متاح لهذا الرمز.');
  lines.push('');
  lines.push(FOOTER);
  return lines.join('\n') + '\n';
}

function renderNotConfigured(ctx) {
  return ['# تقرير Facebook Ads اليومي — ' + ctx.date, '',
    '**المراقبة غير مُفعّلة بعد:** ' + ctx.reason + '.', '',
    'لتفعيلها يضع المالك رمز قراءة فقط (صلاحية ads_read) في الملف:', '',
    '`' + ctx.file + '`', '',
    'بالصيغة: `META_ADS_READ_TOKEN=...` (صلاحيات الملف 600).', '', FOOTER, ''].join('\n');
}

module.exports = { FOOTER: FOOTER, render: render, renderNotConfigured: renderNotConfigured };
