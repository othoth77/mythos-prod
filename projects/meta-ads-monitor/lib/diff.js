'use strict';
// =====================================================
// Facebook Ads Monitor — findings: current vs previous snapshot
// projects/meta-ads-monitor/lib/diff.js
//
// Pure functions. Only compares numbers Meta actually returned; a missing
// section or metric produces "unknown", never a guessed value. Thresholds
// are observations for the owner to look at — nothing here ever acts.
// =====================================================

var THRESHOLDS = Object.freeze({
  spendChangeRatio: 0.5,     // yesterday's spend moved by >= 50 % vs the previous run's "yesterday"
  spendChangeMin: 1,         // ... and by at least 1 unit of account currency
  frequencyHigh: 3,          // 7-day frequency above this on an active campaign
  spendNoResultsMin: 5,      // 7-day spend with zero reported actions
  spendCapWarnRatio: 0.9     // account spend >= 90 % of its spend cap
});

var ACCOUNT_STATUS = {
  1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT',
  9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED'
};

var DELIVERY_PROBLEM = ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'];

function byId(list, key) {
  var m = {};
  (list || []).forEach(function (o) { if (o && o[key || 'id'] !== undefined) m[String(o[key || 'id'])] = o; });
  return m;
}

// "Results" = Meta's own `results` metric (the Results column of Ads
// Manager: the campaign's optimisation event, e.g. messaging conversations
// started). Never the sum of every action type — that counts engagement,
// message depth, link clicks... several times over. No row, or a snapshot
// taken before the field was collected = unknown (null).
function resultsOf(row) {
  if (!row) return null;
  return typeof row.results === 'number' ? row.results : null;
}

function isActive(o) { return o && o.effective_status === 'ACTIVE'; }

function compareEntities(changes, acct, type, cur, prev, fields) {
  if (!cur || !prev) return;
  var c = byId(cur), p = byId(prev);
  Object.keys(c).forEach(function (id) {
    var a = c[id], b = p[id];
    if (!b) { changes.push({ account: acct.id, type: type, id: id, name: a.name, kind: 'new', significant: type !== 'ad' }); return; }
    fields.forEach(function (f) {
      if (a[f] === undefined && b[f] === undefined) return;
      if (String(a[f]) !== String(b[f])) {
        changes.push({ account: acct.id, type: type, id: id, name: a.name, kind: f, before: b[f] === undefined ? null : b[f],
          after: a[f] === undefined ? null : a[f], significant: f !== 'updated_time' });
      }
    });
  });
  Object.keys(p).forEach(function (id) {
    if (!c[id]) changes.push({ account: acct.id, type: type, id: id, name: p[id].name, kind: 'removed', significant: type !== 'ad' });
  });
}

// analyse(current, previous|null) → findings
function analyse(cur, prev) {
  var out = { compared: !!prev, previous_at: prev ? prev.collected_at : null, accounts: [] };
  var prevAccounts = byId(prev ? prev.accounts : []);

  (cur.accounts || []).forEach(function (acct) {
    var pa = prevAccounts[acct.id] || null;
    var f = {
      id: acct.id, name: acct.name, currency: acct.currency,
      account_status: ACCOUNT_STATUS[acct.account_status] || (acct.account_status === null ? 'UNKNOWN' : String(acct.account_status)),
      working: [], changes: [], attention: [], delivery: [], review: [], spend: {}, unavailable: (acct.errors || []).map(function (e) { return e.section; })
    };

    // --- spend / budget ---
    var insY = acct.insights && acct.insights.yesterday, ins7 = acct.insights && acct.insights.last_7d;
    f.spend.yesterday = insY ? insY.reduce(function (s, r) { return s + (r.spend || 0); }, 0) : null;
    f.spend.last_7d = ins7 ? ins7.reduce(function (s, r) { return s + (r.spend || 0); }, 0) : null;
    f.spend.amount_spent_lifetime = acct.amount_spent;
    f.spend.spend_cap = acct.spend_cap;
    f.spend.active_daily_budgets = (acct.campaigns || []).filter(isActive).map(function (c) {
      return { id: c.id, name: c.name, daily_budget: c.daily_budget === undefined ? null : c.daily_budget,
        lifetime_budget: c.lifetime_budget === undefined ? null : c.lifetime_budget,
        budget_remaining: c.budget_remaining === undefined ? null : c.budget_remaining };
    });

    if (acct.account_status !== null && acct.account_status !== 1) {
      f.attention.push({ kind: 'account_status', text: 'حالة الحساب ليست نشطة: ' + f.account_status });
    }
    if (acct.spend_cap && acct.amount_spent !== null && acct.amount_spent >= acct.spend_cap * THRESHOLDS.spendCapWarnRatio) {
      f.attention.push({ kind: 'spend_cap', text: 'الإنفاق الكلي اقترب من حد الإنفاق للحساب (' + acct.amount_spent + ' من ' + acct.spend_cap + ' ' + acct.currency + ')' });
    }

    // --- per campaign ---
    var y = byId(insY, 'campaign_id'), w = byId(ins7, 'campaign_id');
    (acct.campaigns || []).forEach(function (c) {
      var ry = y[c.id], rw = w[c.id];
      if (isActive(c)) {
        if (ry && ry.impressions > 0) {
          f.working.push({ id: c.id, name: c.name, spend_yesterday: ry.spend, impressions_yesterday: ry.impressions, results_yesterday: resultsOf(ry) });
        } else if (insY) {
          f.delivery.push({ id: c.id, name: c.name, text: 'الحملة نشطة لكن لم تُعرض أمس (لا ظهور)' });
        }
        if (rw && typeof rw.frequency === 'number' && rw.frequency > THRESHOLDS.frequencyHigh) {
          f.review.push({ id: c.id, name: c.name, text: 'نفس الأشخاص يرون الإعلان كثيراً (التكرار ' + rw.frequency.toFixed(1) + ' خلال 7 أيام)' });
        }
        if (rw && rw.spend >= THRESHOLDS.spendNoResultsMin && resultsOf(rw) === 0) {
          f.review.push({ id: c.id, name: c.name, text: 'إنفاق ' + rw.spend + ' ' + acct.currency + ' خلال 7 أيام بدون أي نتيجة مُبلَّغة' });
        }
      }
      if (DELIVERY_PROBLEM.indexOf(c.effective_status) !== -1) {
        f.delivery.push({ id: c.id, name: c.name, text: 'حالة العرض: ' + c.effective_status });
      }
    });

    // --- ads with problems ---
    var campName = byId(acct.campaigns);
    (acct.ads || []).forEach(function (a) {
      var bad = DELIVERY_PROBLEM.indexOf(a.effective_status) !== -1 || (a.issues_info && a.issues_info.length);
      if (!bad) return;
      var why = a.issues_info && a.issues_info.length && a.issues_info[0].error_summary ? a.issues_info[0].error_summary : a.effective_status;
      f.delivery.push({ id: a.id, name: a.name, text: 'إعلان به مشكلة: ' + why });
      var cn = campName[a.campaign_id];
      if (cn && !f.review.some(function (r) { return r.id === cn.id && r.kind === 'ad_problem'; })) {
        f.review.push({ id: cn.id, name: cn.name, kind: 'ad_problem', text: 'تحتوي على إعلان مرفوض أو به مشكلة' });
      }
    });

    // --- changes vs previous run ---
    if (pa) {
      compareEntities(f.changes, acct, 'campaign', acct.campaigns, pa.campaigns, ['status', 'effective_status', 'daily_budget', 'lifetime_budget']);
      compareEntities(f.changes, acct, 'adset', acct.adsets, pa.adsets, ['status', 'effective_status', 'daily_budget', 'lifetime_budget']);
      compareEntities(f.changes, acct, 'ad', acct.ads, pa.ads, ['status', 'effective_status']);
      if (pa.account_status !== acct.account_status) {
        f.changes.push({ account: acct.id, type: 'account', id: acct.id, name: acct.name, kind: 'account_status',
          before: ACCOUNT_STATUS[pa.account_status] || pa.account_status, after: f.account_status, significant: true });
      }
      var py = byId(pa.insights && pa.insights.yesterday, 'campaign_id');
      var names = byId(acct.campaigns);
      // Meta omits insights rows with no delivery: when both runs have insights,
      // a campaign present only in the previous run spent 0 yesterday.
      var ids = insY && pa.insights && pa.insights.yesterday
        ? Object.keys(y).concat(Object.keys(py).filter(function (k) { return !y[k]; })) : Object.keys(y);
      ids.forEach(function (id) {
        var now = y[id] ? y[id].spend : (py[id] ? 0 : null), before = py[id] ? py[id].spend : null;
        if (typeof now !== 'number' || typeof before !== 'number') return;
        var delta = now - before;
        if (Math.abs(delta) >= THRESHOLDS.spendChangeMin && Math.abs(delta) >= Math.max(before, 0.01) * THRESHOLDS.spendChangeRatio) {
          f.changes.push({ account: acct.id, type: 'campaign', id: id,
            name: (y[id] && y[id].campaign_name) || (names[id] && names[id].name) || (py[id] && py[id].campaign_name) || id, kind: 'daily_spend',
            before: before, after: now, significant: true });
        }
      });
    }
    out.accounts.push(f);
  });
  return out;
}

module.exports = { THRESHOLDS: THRESHOLDS, ACCOUNT_STATUS: ACCOUNT_STATUS, analyse: analyse };
