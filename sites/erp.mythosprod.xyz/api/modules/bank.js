'use strict';

/* Bank transactions & reconciliation — Phase 3 (P1). Design decisions worth
 * stating up front, because the one that matters most is easy to get wrong:
 *
 *   - A bank_entries row is an EXTERNAL statement record, not a second
 *     accounting event. The journal entry for money moving already exists —
 *     it was posted the moment the payment itself was recorded, by
 *     accounting.js's postPayment / postSupplierPayment, idempotently keyed
 *     on (source_table:'payments', source_id). Matching a bank transaction
 *     to that payment records a correspondence; it never creates, reverses,
 *     or alters a journal entry. This module never imports accounting.js
 *     and never touches journal_entries/journal_lines — that omission is
 *     intentional, not an oversight.
 *   - Reused bank_entries (schema.sql, unwired since Stage 3) rather than a
 *     new table — see 0009-bank-reconciliation.sql's header for why.
 *   - status is the single source of truth for reconciliation state:
 *     unmatched (default) -> matched | ignored. matched_payment_id/at/by are
 *     never client-settable directly; they change only through match(),
 *     unmatch() and ignore() below, each of which is a deliberate, audited
 *     state transition — never a side effect of a generic PATCH.
 *   - A transaction that is matched or ignored cannot be edited by a plain
 *     PATCH; the caller must unmatch() it first. This is the same shape as
 *     invoices/purchases refusing to edit a paid/cancelled document.
 *   - Candidate matches are a read-only suggestion (amount within a small
 *     tolerance, date within a practical window) — the endpoint never
 *     matches anything itself. Matching amount/date is NOT enforced at
 *     match() time: the human has already looked at the statement and the
 *     candidate list, and may deliberately match amounts that differ (a
 *     bank fee netted out, a partial clearing) — the tolerance is guidance,
 *     not a gate.
 *   - One payment can be claimed by at most one bank transaction. Enforced
 *     by a partial unique index on matched_payment_id (0009), not only by
 *     the application-level check here — a race between two concurrent
 *     match attempts on the same payment is decided by the database.
 */

var STATUS = ['unmatched', 'matched', 'ignored'];

var COLUMNS = ['id', 'account_id', 'entry_date', 'label', 'amount', 'status',
  'matched_payment_id', 'matched_at', 'matched_by', 'legacy_id', 'created_at', 'updated_at'];

var SETTABLE = ['account_id', 'entry_date', 'label', 'amount', 'legacy_id'];

function cols(list) { return list.map(function (c) { return '"' + c + '"'; }).join(','); }

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  SETTABLE.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f];
  });
  if (out.entry_date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(out.entry_date))) {
    return { ok: false, error: 'entry_date must be YYYY-MM-DD' };
  }
  if (!partial && !out.entry_date) return { ok: false, error: 'entry_date is required' };
  if (!partial && !out.account_id) return { ok: false, error: 'account_id is required' };
  if (out.label !== undefined && !String(out.label || '').trim()) {
    return { ok: false, error: 'label must not be empty' };
  }
  if (!partial && out.label === undefined) return { ok: false, error: 'label is required' };
  if (out.amount !== undefined) {
    if (isNaN(Number(out.amount)) || Number(out.amount) === 0) {
      return { ok: false, error: 'amount must be a non-zero number (signed: credit positive, debit negative)' };
    }
  }
  if (!partial && out.amount === undefined) return { ok: false, error: 'amount is required' };
  return { ok: true, value: out };
}

function checkAccount(client, accountId) {
  return client.query('SELECT 1 FROM bank_accounts WHERE id = $1 AND deleted_at IS NULL', [accountId])
    .then(function (r) { return r.rows.length > 0; });
}

/* Small, deliberately unscored: same amount within a cent-level tolerance,
   same tenant (RLS), not already claimed by another transaction, within a
   practical date window. This is a suggestion list for a human, not a
   matching algorithm — see the header comment. */
var AMOUNT_TOLERANCE = 0.01;
var DATE_WINDOW_DAYS = 30;

function candidateQuery(client, entry) {
  return client.query(
    'SELECT p.id, p.amount, p.paid_on, p.method, p.reference, p.invoice_id, p.purchase_id' +
    ' FROM payments p' +
    ' WHERE NOT EXISTS (SELECT 1 FROM bank_entries be WHERE be.matched_payment_id = p.id)' +
    '   AND abs(p.amount - abs($1::numeric)) <= $2' +
    '   AND p.paid_on BETWEEN $3::date - $4::int AND $3::date + $4::int' +
    ' ORDER BY abs(p.paid_on - $3::date), abs(p.amount - abs($1::numeric))' +
    ' LIMIT 20',
    [entry.amount, AMOUNT_TOLERANCE, entry.entry_date, DATE_WINDOW_DAYS]
  ).then(function (r) { return r.rows; });
}

function hydrateMatch(client, row) {
  if (!row.matched_payment_id) return Promise.resolve(Object.assign({}, row, { matched_payment: null }));
  return client.query(
    'SELECT id, amount, paid_on, method, reference, invoice_id, purchase_id FROM payments WHERE id = $1',
    [row.matched_payment_id]
  ).then(function (r) { return Object.assign({}, row, { matched_payment: r.rows[0] || null }); });
}

var handlers = {
  list: function (ctx, client) {
    var q = ctx.query || {};
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    var where = ['deleted_at IS NULL'];
    var params = [];
    if (q.account_id) { params.push(q.account_id); where.push('account_id = $' + params.length); }
    if (q.status) { params.push(q.status); where.push('status = $' + params.length); }
    if (q.from) { params.push(q.from); where.push('entry_date >= $' + params.length); }
    if (q.to) { params.push(q.to); where.push('entry_date <= $' + params.length); }
    if (q.search) { params.push('%' + q.search + '%'); where.push('label ILIKE $' + params.length); }
    params.push(limit, offset);
    return client.query(
      'SELECT ' + cols(COLUMNS) + ' FROM bank_entries WHERE ' + where.join(' AND ') +
      ' ORDER BY entry_date DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM bank_entries WHERE ' + where.join(' AND '), params.slice(0, params.length - 2))
        .then(function (c) { return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } }; });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + cols(COLUMNS) + ' FROM bank_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var row = (r.rows || [])[0];
        if (!row) return { status: 404, body: { error: 'not_found' } };
        return hydrateMatch(client, row).then(function (full) { return { status: 200, body: full }; });
      });
  },

  create: function (ctx, client) {
    var h = ctx.input;
    return checkAccount(client, h.account_id).then(function (ok) {
      if (!ok) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown account_id' } };
      var cIn = ['tenant_id'].concat(Object.keys(h));
      var params = [ctx.tenantId].concat(Object.keys(h).map(function (k) { return h[k]; }));
      return client.query(
        'INSERT INTO bank_entries (' + cols(cIn) + ') VALUES (' +
        params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
        ' RETURNING ' + cols(COLUMNS), params
      ).then(function (r) {
        var row = r.rows[0];
        return {
          status: 201, body: Object.assign({}, row, { matched_payment: null }),
          audit: { action: 'record.created', entity_table: 'bank_entries', entity_id: row.id,
                   detail: { account_id: row.account_id, entry_date: row.entry_date, amount: row.amount } }
        };
      });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input;
    return client.query('SELECT status FROM bank_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status !== 'unmatched') {
          return { status: 409, body: { error: 'bank transaction is ' + cur.status + ' — unmatch it before editing' } };
        }
        var checkAcc = h.account_id ? checkAccount(client, h.account_id).then(function (ok) {
          return ok ? null : { status: 422, body: { error: 'invalid_reference', detail: 'unknown account_id' } };
        }) : Promise.resolve(null);
        return checkAcc.then(function (bad) {
          if (bad) return bad;
          var p = [ctx.id];
          var sets = Object.keys(h).map(function (k) { p.push(h[k]); return '"' + k + '" = $' + p.length; });
          var step = sets.length ? client.query('UPDATE bank_entries SET ' + sets.join(',') + ' WHERE id = $1', p) : Promise.resolve();
          return step
            .then(function () { return client.query('SELECT ' + cols(COLUMNS) + ' FROM bank_entries WHERE id = $1', [ctx.id]); })
            .then(function (r2) {
              var row = r2.rows[0];
              return {
                status: 200, body: Object.assign({}, row, { matched_payment: null }),
                audit: { action: 'record.updated', entity_table: 'bank_entries', entity_id: ctx.id, detail: { fields: Object.keys(h) } }
              };
            });
        });
      });
  },

  candidates: function (ctx, client) {
    return client.query('SELECT id, amount, entry_date FROM bank_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var row = (r.rows || [])[0];
        if (!row) return { status: 404, body: { error: 'not_found' } };
        return candidateQuery(client, row).then(function (rows) { return { status: 200, body: { rows: rows } }; });
      });
  },

  match: function (ctx, client) {
    var paymentId = ctx.body && ctx.body.payment_id;
    if (!paymentId) return Promise.resolve({ status: 422, body: { error: 'payment_id is required' } });
    return client.query('SELECT id, status FROM bank_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status !== 'unmatched') {
          return { status: 409, body: { error: 'bank transaction is already ' + cur.status } };
        }
        // RLS already scopes this read to the caller's tenant: a payment_id
        // belonging to another tenant simply does not exist from here.
        return client.query('SELECT id FROM payments WHERE id = $1', [paymentId]).then(function (pr) {
          if (!pr.rows.length) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown payment_id' } };
          return client.query(
            "UPDATE bank_entries SET status = 'matched', matched_payment_id = $2, matched_at = now()," +
            ' matched_by = $3, reconciled = true WHERE id = $1 AND status = \'unmatched\'' +
            ' RETURNING ' + cols(COLUMNS),
            [ctx.id, paymentId, ctx.user.id]
          ).then(function (u) {
            if (!u.rows.length) return { status: 409, body: { error: 'bank transaction is already matched' } };
            var row = u.rows[0];
            return {
              status: 200, body: Object.assign({}, row, { matched_payment: { id: paymentId } }),
              audit: { action: 'record.updated', entity_table: 'bank_entries', entity_id: row.id,
                       detail: { transition: 'match', matched_payment_id: paymentId } }
            };
          }).catch(function (e) {
            // The unique index on matched_payment_id is the final guard
            // against a race: two transactions cannot both win a match on
            // the same payment, even if both passed the checks above.
            if (e && e.code === '23505') return { status: 409, body: { error: 'payment already matched by another transaction' } };
            throw e;
          });
        });
      });
  },

  /* Clears a matched OR ignored transaction back to unmatched. Never touches
     the payment, its amount, its status, or any journal entry — only this
     row's own reconciliation fields. */
  unmatch: function (ctx, client) {
    return client.query('SELECT id, status, matched_payment_id FROM bank_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status === 'unmatched') return { status: 409, body: { error: 'bank transaction is already unmatched' } };
        return client.query(
          "UPDATE bank_entries SET status = 'unmatched', matched_payment_id = NULL, matched_at = NULL," +
          ' matched_by = NULL, reconciled = false WHERE id = $1 RETURNING ' + cols(COLUMNS),
          [ctx.id]
        ).then(function (u) {
          var row = u.rows[0];
          return {
            status: 200, body: Object.assign({}, row, { matched_payment: null }),
            audit: { action: 'record.updated', entity_table: 'bank_entries', entity_id: row.id,
                     detail: { transition: 'unmatch', previous_status: cur.status, previous_matched_payment_id: cur.matched_payment_id } }
          };
        });
      });
  },

  ignore: function (ctx, client) {
    return client.query('SELECT id, status FROM bank_entries WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status !== 'unmatched') {
          return { status: 409, body: { error: 'bank transaction is ' + cur.status + ' — unmatch it before ignoring' } };
        }
        return client.query("UPDATE bank_entries SET status = 'ignored' WHERE id = $1 RETURNING " + cols(COLUMNS), [ctx.id])
          .then(function (u) {
            var row = u.rows[0];
            return {
              status: 200, body: Object.assign({}, row, { matched_payment: null }),
              audit: { action: 'record.updated', entity_table: 'bank_entries', entity_id: row.id, detail: { transition: 'ignore' } }
            };
          });
      });
  }
};

module.exports = { STATUS: STATUS, COLUMNS: COLUMNS, validateHeader: validateHeader, handlers: handlers };
