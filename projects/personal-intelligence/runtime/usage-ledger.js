// =====================================================
// Mythos Personal Intelligence — O-4-1 Free-Usage Ledger
// projects/personal-intelligence/runtime/usage-ledger.js
//
// A metadata-only local ledger for the OpenRouter free allowance.
// HONESTY CONTRACT (spec §2.2): OpenRouter's API exposes no exact
// free-requests-remaining counter, so everything here is an ESTIMATED
// LOCAL COUNT and is always labelled as such. "Used" counts attempts that
// actually reached the provider (any HTTP response, success or failure);
// refusals that never left the machine are not counted.
//
// Stored fields ONLY: date (UTC — the documented reset boundary), counts,
// provider, model, success/failure tallies, last request id. NEVER prompts,
// packages, memory, responses, or keys.
// =====================================================
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LEDGER_FILE = '/home/ubuntu/.config/mythos/openrouter-usage.json';
const FREE_DAILY_LIMIT = 50; // documented (accounts under $10 credits), UTC-day reset

function refusal(code) {
  const e = new Error(code);
  e.refused = true;
  return e;
}

function utcDate(now) {
  return (now || new Date()).toISOString().slice(0, 10);
}

function emptyDay(date, provider, model) {
  return { date_utc: date, provider: provider, model: model, sent: 0, succeeded: 0, failed: 0, last_request_id: null };
}

// createLedger({ file, limit, now }) — `now` injectable for reset tests.
function createLedger(opts) {
  const o = opts || {};
  const file = o.file || DEFAULT_LEDGER_FILE;
  const limit = o.limit || FREE_DAILY_LIMIT;
  const nowFn = o.now || function () { return new Date(); };

  function load(provider, model) {
    const today = utcDate(nowFn());
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { /* absent or unreadable -> fresh day */ }
    if (!data || data.date_utc !== today) return emptyDay(today, provider, model);
    return data;
  }

  function save(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  }

  return {
    // status(provider, model) -> the honest display state.
    status(provider, model) {
      const d = load(provider, model);
      const remaining = Math.min(limit, Math.max(0, limit - d.sent));
      return {
        dateUtc: d.date_utc,
        limit: limit,
        usedEstimated: d.sent,
        remainingEstimated: remaining,
        succeeded: d.succeeded,
        failed: d.failed,
        counterType: 'ESTIMATED_LOCAL',
        counterNote: 'Estimated local usage — OpenRouter exposes no exact free-remaining counter',
        reset: 'UTC day boundary (documented)'
      };
    },
    // assertQuota() — fail-closed BEFORE any request is sent.
    assertQuota(provider, model) {
      const d = load(provider, model);
      if (d.sent >= limit) throw refusal('FREE_LIMIT_REACHED (estimated local count ' + d.sent + '/' + limit + ')');
    },
    // recordSent()/recordResult() — called around an actual provider attempt.
    recordSent(provider, model, requestId) {
      const d = load(provider, model);
      d.sent += 1;
      if (requestId) d.last_request_id = requestId;
      save(d);
      return d.sent;
    },
    recordResult(provider, model, ok, requestId) {
      const d = load(provider, model);
      if (ok) d.succeeded += 1; else d.failed += 1;
      if (requestId) d.last_request_id = requestId;
      save(d);
    }
  };
}

module.exports = {
  createLedger: createLedger,
  FREE_DAILY_LIMIT: FREE_DAILY_LIMIT,
  DEFAULT_LEDGER_FILE: DEFAULT_LEDGER_FILE
};
