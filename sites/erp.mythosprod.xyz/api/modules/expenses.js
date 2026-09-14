'use strict';

var accounting = require('./accounting');

/* Expenses — Phase 7 (P1). The record of money already spent (a receipt, a
 * taxi, a hotel night): the legacy ERP's date / label / category / payment
 * mode / amount, and now a ledger entry for it.
 *
 * Design decisions worth stating:
 *   - amount is what was PAID (TTC). vat_rate (default 0) splits it into HT
 *     and deductible VAT the way the legacy purchase calculator reversed a
 *     TTC — never a second, client-supplied total.
 *   - Posting happens at creation (the cash has already left) into the cash
 *     or bank journal by the same method rule invoice/supplier payments use,
 *     idempotent on (source_table 'expenses', source_id). Retiring reverses.
 *   - Once posted, amount / spent_on / vat_rate / payment_method / category
 *     are IMMUTABLE — retire and recreate — so the ledger never drifts from
 *     the row it was posted from (the same rule invoices apply to a paid
 *     document). description, project and supplier links stay editable.
 *   - No approval workflow, no attachment: the legacy ERP had neither and
 *     nothing here is invented beyond its evidence.
 */

var COLUMNS = ['id', 'category_id', 'supplier_id', 'project_id', 'spent_on', 'amount', 'vat_rate',
  'payment_method', 'description', 'legacy_id', 'created_at', 'updated_at'];
var SETTABLE = ['category_id', 'supplier_id', 'project_id', 'spent_on', 'amount', 'vat_rate',
  'payment_method', 'description', 'legacy_id'];
var POSTED_IMMUTABLE = ['category_id', 'spent_on', 'amount', 'vat_rate', 'payment_method'];

function cols(list) { return list.map(function (c) { return '"' + c + '"'; }).join(','); }
function money(n) { return Number(Number(n || 0).toFixed(3)); }

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  SETTABLE.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f];
  });
  ['category_id', 'supplier_id', 'project_id', 'payment_method', 'legacy_id'].forEach(function (f) {
    if (out[f] === '') out[f] = null;
  });
  if (out.description !== undefined && !String(out.description || '').trim()) {
    return { ok: false, error: 'description must not be empty' };
  }
  if (!partial && out.description === undefined) return { ok: false, error: 'description is required' };
  if (out.spent_on !== undefined && out.spent_on !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(out.spent_on))) {
    return { ok: false, error: 'spent_on must be YYYY-MM-DD' };
  }
  if (out.amount !== undefined) {
    var a = (typeof out.amount === 'number' || typeof out.amount === 'string') ? Number(String(out.amount).trim()) : NaN;
    if (!Number.isFinite(a) || a <= 0) return { ok: false, error: 'amount must be a positive number' };
    out.amount = money(a);
  }
  if (!partial && out.amount === undefined) return { ok: false, error: 'amount is required' };
  if (out.vat_rate !== undefined && out.vat_rate !== null) {
    var v = Number(out.vat_rate);
    if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, error: 'vat_rate must be between 0 and 100' };
    out.vat_rate = Number(v.toFixed(2));
  }
  if (out.vat_rate === null) out.vat_rate = 0;
  if (out.payment_method !== undefined && out.payment_method !== null) out.payment_method = String(out.payment_method).trim().slice(0, 80) || null;
  return { ok: true, value: out };
}

/* HT / VAT split of the amount paid. */
function totals(row) {
  var amount = money(row.amount);
  var rate = Number(row.vat_rate || 0);
  var ht = money(amount / (1 + rate / 100));
  var vat = money(amount - ht);
  return { amount: amount.toFixed(3), total_ht: ht.toFixed(3), total_vat: vat.toFixed(3) };
}

function checkRef(client, table, id) {
  if (!id) return Promise.resolve(true);
  return client.query('SELECT 1 FROM ' + table + ' WHERE id = $1 AND deleted_at IS NULL', [id])
    .then(function (r) { return r.rows.length > 0; });
}

function checkRefs(client, h) {
  return Promise.all([
    h.category_id !== undefined ? checkRef(client, 'expense_categories', h.category_id) : true,
    h.supplier_id !== undefined ? checkRef(client, 'suppliers', h.supplier_id) : true,
    h.project_id !== undefined ? checkRef(client, 'projects', h.project_id) : true
  ]).then(function (ok) {
    if (!ok[0]) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown category_id' } };
    if (!ok[1]) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown supplier_id' } };
    if (!ok[2]) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown project_id' } };
    return null;
  });
}

function postedEntry(client, id) {
  return client.query("SELECT id, entry_no, status FROM journal_entries WHERE source_table = 'expenses' AND source_id = $1", [id])
    .then(function (r) { return (r.rows || [])[0] || null; });
}

function hydrate(client, row) {
  return postedEntry(client, row.id).then(function (e) {
    return Object.assign({}, row, { totals: totals(row), accounting: e ? { entry_no: e.entry_no, status: e.status } : null });
  });
}

var handlers = {
  list: function (ctx, client) {
    var q = ctx.query || {};
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    var where = ['deleted_at IS NULL'];
    var params = [];
    ['category_id', 'supplier_id', 'project_id'].forEach(function (f) {
      if (q[f]) { params.push(q[f]); where.push('"' + f + '" = $' + params.length); }
    });
    if (q.from) { params.push(q.from); where.push('spent_on >= $' + params.length); }
    if (q.to)   { params.push(q.to);   where.push('spent_on <= $' + params.length); }
    if (q.search) { params.push('%' + q.search + '%'); where.push('(description ILIKE $' + params.length + ' OR payment_method ILIKE $' + params.length + ')'); }
    params.push(limit, offset);
    return client.query(
      'SELECT ' + cols(COLUMNS) + ' FROM expenses WHERE ' + where.join(' AND ') +
      ' ORDER BY spent_on DESC, created_at DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM expenses WHERE ' + where.join(' AND '), params.slice(0, params.length - 2))
        .then(function (c) { return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } }; });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + cols(COLUMNS) + ' FROM expenses WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var row = (r.rows || [])[0];
        if (!row) return { status: 404, body: { error: 'not_found' } };
        return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
      });
  },

  create: function (ctx, client) {
    var h = ctx.input;
    return checkRefs(client, h).then(function (bad) {
      if (bad) return bad;
      var cIn = ['tenant_id'].concat(Object.keys(h));
      var params = [ctx.tenantId].concat(Object.keys(h).map(function (k) { return h[k]; }));
      return client.query(
        'INSERT INTO expenses (' + cols(cIn) + ') VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
        ' RETURNING ' + cols(COLUMNS), params
      ).then(function (r) {
        var row = r.rows[0];
        return accounting.postExpense(client, ctx, row).then(function (a) {
          return hydrate(client, row).then(function (full) {
            return {
              status: 201, body: Object.assign({}, full, { accounting: a.entry ? { entry_no: a.entry.entry_no } : { skipped: a.skipped } }),
              audit: { action: 'record.created', entity_table: 'expenses', entity_id: row.id,
                       detail: { amount: row.amount, payment_method: row.payment_method, category_id: row.category_id,
                                 accounting_entry: a.entry ? a.entry.entry_no : null } }
            };
          });
        });
      });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input;
    return client.query('SELECT id FROM expenses WHERE id = $1 AND deleted_at IS NULL', [ctx.id]).then(function (r) {
      if (!(r.rows || []).length) return { status: 404, body: { error: 'not_found' } };
      return postedEntry(client, ctx.id).then(function (posted) {
        var locked = posted ? Object.keys(h).filter(function (k) { return POSTED_IMMUTABLE.indexOf(k) >= 0; }) : [];
        if (locked.length) {
          return { status: 409, body: { error: 'expense is posted to the ledger (entry ' + posted.entry_no + '); retire it and record a new one to change ' + locked.join(', ') } };
        }
        return checkRefs(client, h).then(function (bad) {
          if (bad) return bad;
          var p = [ctx.id];
          var sets = Object.keys(h).map(function (k) { p.push(h[k]); return '"' + k + '" = $' + p.length; });
          var step = sets.length ? client.query('UPDATE expenses SET ' + sets.join(',') + ' WHERE id = $1', p) : Promise.resolve();
          return step
            .then(function () { return client.query('SELECT ' + cols(COLUMNS) + ' FROM expenses WHERE id = $1', [ctx.id]); })
            .then(function (r2) { return hydrate(client, r2.rows[0]); })
            .then(function (full) {
              return {
                status: 200, body: full,
                audit: { action: 'record.updated', entity_table: 'expenses', entity_id: ctx.id, detail: { fields: Object.keys(h) } }
              };
            });
        });
      });
    });
  },

  retire: function (ctx, client) {
    return client.query(
      'UPDATE expenses SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, description, amount',
      [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return accounting.reverseExpense(client, ctx, row).then(function (a) {
        return {
          status: 200, body: { id: row.id, retired: true, accounting: a.entry ? { reversal_entry_no: a.entry.entry_no } : { skipped: a.skipped } },
          audit: { action: 'record.deleted', entity_table: 'expenses', entity_id: row.id,
                   detail: { description: row.description, amount: row.amount, accounting_reversal: a.entry ? a.entry.entry_no : null } }
        };
      });
    });
  }
};

module.exports = { COLUMNS: COLUMNS, POSTED_IMMUTABLE: POSTED_IMMUTABLE, validateHeader: validateHeader, totals: totals, handlers: handlers };
