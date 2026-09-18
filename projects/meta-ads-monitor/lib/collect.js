'use strict';
// =====================================================
// Facebook Ads Monitor — collect one read-only snapshot
// projects/meta-ads-monitor/lib/collect.js
//
// Reads, through lib/graph.js (GET only): ad accounts, campaigns, ad sets,
// ads, and insights (campaign level for yesterday and the last 7 days, ad
// level for the last 7 days). Every object is reduced to an explicit field
// allowlist before it enters the snapshot — nothing Meta returns beyond
// these fields is stored. A section that still fails after retries is
// recorded as unavailable instead of being guessed.
// =====================================================

var FIELDS = Object.freeze({
  account: ['id', 'account_id', 'name', 'account_status', 'disable_reason', 'currency', 'timezone_name', 'amount_spent', 'spend_cap'],
  campaign: ['id', 'name', 'status', 'effective_status', 'objective', 'daily_budget', 'lifetime_budget', 'budget_remaining', 'start_time', 'stop_time', 'updated_time'],
  adset: ['id', 'name', 'campaign_id', 'status', 'effective_status', 'daily_budget', 'lifetime_budget', 'budget_remaining', 'optimization_goal', 'start_time', 'end_time', 'updated_time'],
  ad: ['id', 'name', 'adset_id', 'campaign_id', 'status', 'effective_status', 'updated_time', 'issues_info'],
  campaignInsights: ['campaign_id', 'campaign_name', 'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpc', 'cpm', 'actions', 'cost_per_action_type'],
  adInsights: ['ad_id', 'ad_name', 'campaign_id', 'spend', 'impressions', 'clicks', 'ctr', 'actions']
});

var ZERO_DECIMAL = ['BIF', 'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'UGX', 'VND'];

// Meta returns budgets/spend caps/amount_spent in the currency's minor unit.
function minorToMajor(v, currency) {
  if (v === undefined || v === null || v === '') return null;
  var n = Number(v);
  if (!isFinite(n)) return null;
  return ZERO_DECIMAL.indexOf(String(currency || '').toUpperCase()) !== -1 ? n : n / 100;
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function pick(obj, fields) {
  var out = {};
  fields.forEach(function (f) { if (obj && obj[f] !== undefined) out[f] = obj[f]; });
  return out;
}

function actionList(list) {
  return (Array.isArray(list) ? list : []).map(function (a) {
    return { action_type: String(a.action_type || ''), value: num(a.value) };
  }).filter(function (a) { return a.action_type; });
}

function normInsight(row, fields) {
  var r = pick(row, fields);
  ['spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpc', 'cpm'].forEach(function (k) {
    if (r[k] !== undefined) r[k] = num(r[k]);
  });
  if (r.actions !== undefined) r.actions = actionList(r.actions);
  if (r.cost_per_action_type !== undefined) r.cost_per_action_type = actionList(r.cost_per_action_type);
  return r;
}

function normIssues(list) {
  return (Array.isArray(list) ? list : []).map(function (i) {
    return { level: i.level || null, error_summary: i.error_summary ? String(i.error_summary).slice(0, 300) : null };
  });
}

async function section(errors, name, fn) {
  try { return await fn(); } catch (e) {
    errors.push({ section: name, code: e.code || 'ERROR', message: String(e.message || e).slice(0, 300) });
    return null;
  }
}

async function collectAccount(client, raw, opts) {
  var acct = pick(raw, FIELDS.account);
  var cur = acct.currency;
  var id = String(acct.account_id || String(acct.id || '').replace(/^act_/, ''));
  var node = 'act_' + id;
  var errors = [];
  var limit = { limit: 200 };

  var campaigns = await section(errors, 'campaigns', function () {
    return client.getAll(node + '/campaigns', Object.assign({ fields: FIELDS.campaign.join(',') }, limit));
  });
  var adsets = await section(errors, 'adsets', function () {
    return client.getAll(node + '/adsets', Object.assign({ fields: FIELDS.adset.join(',') }, limit));
  });
  var ads = await section(errors, 'ads', function () {
    return client.getAll(node + '/ads', Object.assign({ fields: FIELDS.ad.join(',') }, limit));
  });
  var insY = await section(errors, 'insights_yesterday', function () {
    return client.getAll(node + '/insights', { level: 'campaign', date_preset: 'yesterday', fields: FIELDS.campaignInsights.join(','), limit: 200 });
  });
  var ins7 = await section(errors, 'insights_last_7d', function () {
    return client.getAll(node + '/insights', { level: 'campaign', date_preset: 'last_7d', fields: FIELDS.campaignInsights.join(','), limit: 200 });
  });
  var adIns7 = await section(errors, 'ad_insights_last_7d', function () {
    return client.getAll(node + '/insights', { level: 'ad', date_preset: 'last_7d', fields: FIELDS.adInsights.join(','), limit: 500 });
  });

  function budgets(o, fields) {
    var r = pick(o, fields);
    ['daily_budget', 'lifetime_budget', 'budget_remaining'].forEach(function (k) {
      if (r[k] !== undefined) r[k] = minorToMajor(r[k], cur);
    });
    return r;
  }

  return {
    id: id,
    name: acct.name || null,
    currency: cur || null,
    timezone: acct.timezone_name || null,
    account_status: num(acct.account_status),
    disable_reason: num(acct.disable_reason),
    amount_spent: minorToMajor(acct.amount_spent, cur),
    spend_cap: minorToMajor(acct.spend_cap, cur) || null,
    campaigns: campaigns ? campaigns.map(function (c) { return budgets(c, FIELDS.campaign); }) : null,
    adsets: adsets ? adsets.map(function (a) { return budgets(a, FIELDS.adset); }) : null,
    ads: ads ? ads.map(function (a) { var r = pick(a, FIELDS.ad); r.issues_info = normIssues(a.issues_info); return r; }) : null,
    insights: {
      yesterday: insY ? insY.map(function (r) { return normInsight(r, FIELDS.campaignInsights); }) : null,
      last_7d: ins7 ? ins7.map(function (r) { return normInsight(r, FIELDS.campaignInsights); }) : null,
      ads_last_7d: adIns7 ? adIns7.map(function (r) { return normInsight(r, FIELDS.adInsights); }) : null
    },
    errors: errors
  };
}

// collect(client, { accountIds?, now?, version? }) → snapshot
async function collect(client, opts) {
  opts = opts || {};
  var rawAccounts;
  if (opts.accountIds && opts.accountIds.length) {
    rawAccounts = [];
    for (var i = 0; i < opts.accountIds.length; i++) {
      rawAccounts.push(await client.get('act_' + opts.accountIds[i], { fields: FIELDS.account.join(',') }));
    }
  } else {
    rawAccounts = await client.getAll('me/adaccounts', { fields: FIELDS.account.join(','), limit: 50 });
  }
  var accounts = [];
  for (var j = 0; j < rawAccounts.length; j++) accounts.push(await collectAccount(client, rawAccounts[j], opts));
  return {
    schema: 'meta-ads-monitor.snapshot.v1',
    collected_at: (opts.now || new Date()).toISOString(),
    graph_version: opts.version || null,
    accounts: accounts
  };
}

module.exports = { FIELDS: FIELDS, minorToMajor: minorToMajor, collect: collect };
