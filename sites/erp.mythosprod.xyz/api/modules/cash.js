'use strict';

var accounting = require('./accounting');

/* Cash register — Phase 8 (P1). Manual cash movements (cash_entries): the
 * money into or out of the till that is NOT a document — a withdrawal from
 * the bank for the till, a deposit of till cash at the bank, an injection or
 * an outflow against a chosen account. Documents (customer receipts,
 * supplier payments, expenses paid in cash) already post to the cash
 * account through their own modules and are NOT recorded here twice; the
 * cash book is the ledger of the cash account (GET /accounting/ledger).
 *
 *   - Each movement posts one balanced entry in the CA journal at creation,
 *     idempotent on (source_table 'cash_entries', source_id); reversed on
 *     retire. amount / entry_date / kind / counterpart are immutable once
 *     posted — retire and record a new one — label and reference are not.
 *   - other_in / other_out need an explicit counterpart account (any active
 *     account of this tenant): the accountant's judgement, never a hidden
 *     default. withdrawal / deposit use the bank system account.
 *   - No closing / count / variance workflow: the legacy ERP had none.
 */

var KINDS = ['withdrawal', 'deposit', 'other_in', 'other_out'];
var COLUMNS = ['id', 'entry_date', 'label', 'amount', 'kind', 'counterpart_account_id', 'reference', 'legacy_id', 'created_at', 'updated_at'];
var SETTABLE = ['entry_date', 'label', 'amount', 'kind', 'counterpart_account_id', 'reference', 'legacy_id'];
var POSTED_IMMUTABLE = ['entry_date', 'amount', 'kind', 'counterpart_account_id'];

function cols(list) { return list.map(function (c) { return '"' + c + '"'; }).join(','); }
function money(n) { return Number(Number(n || 0).toFixed(3)); }

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  SETTABLE.forEach(function (f) { if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f]; });
  ['counterpart_account_id', 'reference', 'legacy_id'].forEach(function (f) { if (out[f] === '') out[f] = null; });
  if (out.kind !== undefined && KINDS.indexOf(String(out.kind)) < 0) return { ok: false, error: 'kind must be one of ' + KINDS.join('|') };
  if (!partial && out.kind === undefined) return { ok: false, error: 'kind is required' };
  if (out.entry_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(out.entry_date))) return { ok: false, error: 'entry_date must be YYYY-MM-DD' };
  if (!partial && out.entry_date === undefined) return { ok: false, error: 'entry_date is required' };
  if (out.label !== undefined && !String(out.label || '').trim()) return { ok: false, error: 'label must not be empty' };
  if (!partial && out.label === undefined) return { ok: false, error: 'label is required' };
  if (out.amount !== undefined) {
    var a = (typeof out.amount === 'number' || typeof out.amount === 'string') ? Number(String(out.amount).trim()) : NaN;
    if (!Number.isFinite(a) || a <= 0) return { ok: false, error: 'amount must be a positive number' };
    out.amount = money(a);
  }
  if (!partial && out.amount === undefined) return { ok: false, error: 'amount is required' };
  if (!partial && (out.kind === 'other_in' || out.kind === 'other_out') && !out.counterpart_account_id) {
    return { ok: false, error: 'counterpart_account_id is required for other_in / other_out' };
  }
  if (out.counterpart_account_id !== undefined && out.counterpart_account_id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(out.counterpart_account_id))) {
    return { ok: false, error: 'counterpart_account_id must be a uuid' };
  }
  return { ok: true, value: out };
}

function postedEntry(client, id) {
  return client.query("SELECT id, entry_no, status FROM journal_entries WHERE source_table = 'cash_entries' AND source_id = $1", [id])
    .then(function (r) { return (r.rows || [])[0] || null; });
}

function hydrate(client, row) {
  return postedEntry(client, row.id).then(function (e) {
    return Object.assign({}, row, { accounting: e ? { entry_no: e.entry_no, status: e.status } : null });
  });
}

var handlers = {
  /* The till's position from the ledger (posted + reversed lines of the
     cash system account), plus today's in/out — reused, not recomputed. */
  summary: function (ctx, client) {
    return client.query("SELECT id, code, label FROM accounts WHERE system_key = 'cash' AND deleted_at IS NULL AND is_active LIMIT 1").then(function (a) {
      var acc = (a.rows || [])[0];
      if (!acc) return { status: 200, body: { account: null, balance: '0.000', today: { in: '0.000', out: '0.000' }, configured: false } };
      return Promise.all([
        client.query("SELECT (coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0))::numeric(14,3) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.status IN ('posted','reversed')", [acc.id]),
        // "Today" in the tenant's own timezone (tenants.timezone), not the
        // database session's.
        client.query("SELECT coalesce(sum(l.debit),0)::numeric(14,3) AS i, coalesce(sum(l.credit),0)::numeric(14,3) AS o FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.status IN ('posted','reversed') AND e.entry_date = (now() AT TIME ZONE coalesce((SELECT timezone FROM tenants LIMIT 1), 'UTC'))::date", [acc.id])
      ]).then(function (out) {
        return { status: 200, body: { account: acc, balance: out[0].rows[0].b, today: { in: out[1].rows[0].i, out: out[1].rows[0].o }, configured: true } };
      });
    });
  },

  /* The cash book: the ledger of the cash system account, served under the
     finance gate so a finance_user (who has no accounting.read) can keep the
     till — the account is forced server-side, never chosen by the client. */
  book: function (ctx, client) {
    return client.query("SELECT id FROM accounts WHERE system_key = 'cash' AND deleted_at IS NULL AND is_active LIMIT 1").then(function (a) {
      var acc = (a.rows || [])[0];
      if (!acc) return { status: 200, body: { account: null, opening_balance: '0.000', rows: [], closing_balance: '0.000', configured: false } };
      var q = Object.assign({}, ctx.query || {}, { account_id: acc.id });
      return accounting.reports.ledger(Object.assign({}, ctx, { query: q }), client);
    });
  },

  /* Active accounts a movement may be posted against (id, code, label,
     type), finance-gated for the same reason. */
  counterparts: function (ctx, client) {
    return client.query('SELECT id, code, label, type FROM accounts WHERE deleted_at IS NULL AND is_active ORDER BY code')
      .then(function (r) { return { status: 200, body: { rows: r.rows } }; });
  },

  list: function (ctx, client) {
    var q = ctx.query || {};
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    var where = ['deleted_at IS NULL'];
    var params = [];
    if (q.kind) { params.push(q.kind); where.push('kind = $' + params.length); }
    if (q.from) { params.push(q.from); where.push('entry_date >= $' + params.length); }
    if (q.to)   { params.push(q.to);   where.push('entry_date <= $' + params.length); }
    if (q.search) { params.push('%' + q.search + '%'); where.push('(label ILIKE $' + params.length + ' OR reference ILIKE $' + params.length + ')'); }
    params.push(limit, offset);
    return client.query('SELECT ' + cols(COLUMNS) + ' FROM cash_entries WHERE ' + where.join(' AND ') +
      ' ORDER BY entry_date DESC, created_at DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM cash_entries WHERE ' + where.join(' AND '), params.slice(0, params.length - 2))
        .then(function (c) { return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } }; });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + cols(COLUMNS) + ' FROM cash_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id]).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
    });
  },

  create: function (ctx, client) {
    var h = ctx.input;
    if (h.kind === 'withdrawal' || h.kind === 'deposit') h.counterpart_account_id = null;
    var checkAcc = h.counterpart_account_id
      ? client.query('SELECT 1 FROM accounts WHERE id = $1 AND deleted_at IS NULL AND is_active', [h.counterpart_account_id]).then(function (r) { return r.rows.length > 0; })
      : Promise.resolve(true);
    return checkAcc.then(function (ok) {
      if (!ok) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown or inactive counterpart_account_id' } };
      var cIn = ['tenant_id'].concat(Object.keys(h));
      var params = [ctx.tenantId].concat(Object.keys(h).map(function (k) { return h[k]; }));
      return client.query('INSERT INTO cash_entries (' + cols(cIn) + ') VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ') RETURNING ' + cols(COLUMNS), params)
        .then(function (r) {
          var row = r.rows[0];
          return accounting.postCashMovement(client, ctx, row).then(function (a) {
            return hydrate(client, row).then(function (full) {
              return {
                status: 201, body: Object.assign({}, full, { accounting: a.entry ? { entry_no: a.entry.entry_no } : { skipped: a.skipped } }),
                audit: { action: 'record.created', entity_table: 'cash_entries', entity_id: row.id,
                         detail: { kind: row.kind, amount: row.amount, accounting_entry: a.entry ? a.entry.entry_no : null } }
              };
            });
          });
        });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input;
    return client.query('SELECT id FROM cash_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id]).then(function (r) {
      if (!(r.rows || []).length) return { status: 404, body: { error: 'not_found' } };
      return postedEntry(client, ctx.id).then(function (posted) {
        var locked = posted ? Object.keys(h).filter(function (k) { return POSTED_IMMUTABLE.indexOf(k) >= 0; }) : [];
        if (locked.length) return { status: 409, body: { error: 'cash movement is posted to the ledger (entry ' + posted.entry_no + '); retire it and record a new one to change ' + locked.join(', ') } };
        // Unposted row: keep kind / counterpart coherent (the DB CHECK would
        // refuse it too, but with a generic constraint message).
        return client.query('SELECT kind, counterpart_account_id FROM cash_entries WHERE id = $1', [ctx.id]).then(function (cr) {
          var cur = cr.rows[0];
          var kind = h.kind !== undefined ? h.kind : cur.kind;
          var cp = h.counterpart_account_id !== undefined ? h.counterpart_account_id : cur.counterpart_account_id;
          if ((kind === 'other_in' || kind === 'other_out') && !cp) return { status: 422, body: { error: 'counterpart_account_id is required for other_in / other_out' } };
          if (kind === 'withdrawal' || kind === 'deposit') h.counterpart_account_id = null;
          return null;
        }).then(function (bad) {
        if (bad) return bad;
        var p = [ctx.id];
        var sets = Object.keys(h).map(function (k) { p.push(h[k]); return '"' + k + '" = $' + p.length; });
        var step = sets.length ? client.query('UPDATE cash_entries SET ' + sets.join(',') + ' WHERE id = $1', p) : Promise.resolve();
        return step.then(function () { return client.query('SELECT ' + cols(COLUMNS) + ' FROM cash_entries WHERE id = $1', [ctx.id]); })
          .then(function (r2) { return hydrate(client, r2.rows[0]); })
          .then(function (full) {
            return { status: 200, body: full, audit: { action: 'record.updated', entity_table: 'cash_entries', entity_id: ctx.id, detail: { fields: Object.keys(h) } } };
          });
        });
      });
    });
  },

  retire: function (ctx, client) {
    return client.query('UPDATE cash_entries SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, label, amount, kind', [ctx.id]).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return accounting.reverseCashMovement(client, ctx, row).then(function (a) {
        return {
          status: 200, body: { id: row.id, retired: true, accounting: a.entry ? { reversal_entry_no: a.entry.entry_no } : { skipped: a.skipped } },
          audit: { action: 'record.deleted', entity_table: 'cash_entries', entity_id: row.id,
                   detail: { kind: row.kind, amount: row.amount, accounting_reversal: a.entry ? a.entry.entry_no : null } }
        };
      });
    });
  }
};

module.exports = { KINDS: KINDS, COLUMNS: COLUMNS, validateHeader: validateHeader, handlers: handlers };
