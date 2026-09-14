'use strict';

var accounting = require('./accounting');

/* Purchases — Phase 2 (P1): the exact mirror of invoices.js, flipped to the
 * supplier side. Design decisions worth stating, matching invoices.js's own:
 *
 *   - No lines table. A purchase already carries a single amount_ht/vat_rate
 *     pair (schema.sql, Stage 3) — the simplest coherent model for a
 *     supplier document, and the one already on disk. Totals are computed
 *     from those two fields, never accepted as a separate total from the
 *     client.
 *   - Status is DERIVED from payments where payment determines it, exactly
 *     like invoices: a user may set draft/confirmed/cancelled; paid and
 *     part_paid are facts about money paid out, not opinions.
 *   - reference is the supplier's own invoice/document number — free text,
 *     already existed, never enforced unique (a supplier can reuse their own
 *     numbering across periods; uniqueness would be this tenant inventing a
 *     rule the supplier doesn't follow).
 *   - Money is numeric(14,3) end to end, same as everywhere else in this
 *     codebase.
 */

var STATUS = ['draft', 'confirmed', 'part_paid', 'paid', 'cancelled'];
var USER_SETTABLE = ['draft', 'confirmed', 'cancelled'];

var COLUMNS = ['id', 'supplier_id', 'reference', 'purchased_on', 'due_on',
  'amount_ht', 'vat_rate', 'stamp_amount', 'status', 'notes', 'legacy_id', 'created_at', 'updated_at'];

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  ['supplier_id', 'reference', 'purchased_on', 'due_on', 'amount_ht', 'vat_rate',
   'notes', 'legacy_id', 'status', 'stamp_amount'].forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f];
  });
  // Phase 5: the supplier's fiscal stamp, part of what is owed (TTC), a
  // per-document snapshot (0 when the supplier's invoice carries none).
  if (out.stamp_amount === null || (typeof out.stamp_amount === 'string' && out.stamp_amount.trim() === '')) delete out.stamp_amount;
  if (out.stamp_amount !== undefined) {
    var stampN = (typeof out.stamp_amount === 'number' || typeof out.stamp_amount === 'string') ? Number(String(out.stamp_amount).trim()) : NaN;
    if (!Number.isFinite(stampN) || stampN < 0 || stampN > 1000) {
      return { ok: false, error: 'stamp_amount must be a number between 0 and 1000' };
    }
    out.stamp_amount = Number(stampN.toFixed(3));
  }
  if (out.status !== undefined && USER_SETTABLE.indexOf(String(out.status)) < 0) {
    return { ok: false, error: 'status may only be set to ' + USER_SETTABLE.join('|') +
                              ' — paid and part_paid follow from payments' };
  }
  ['purchased_on', 'due_on'].forEach(function (f) {
    if (out[f] && !/^\d{4}-\d{2}-\d{2}$/.test(String(out[f]))) out.__bad = f;
  });
  if (out.__bad) return { ok: false, error: out.__bad + ' must be YYYY-MM-DD' };
  if (out.due_on && out.purchased_on && String(out.due_on) < String(out.purchased_on)) {
    return { ok: false, error: 'due_on precedes purchased_on' };
  }
  if (!partial && !out.supplier_id) return { ok: false, error: 'supplier_id is required' };
  if (out.amount_ht !== undefined && (isNaN(Number(out.amount_ht)) || Number(out.amount_ht) < 0)) {
    return { ok: false, error: 'amount_ht must be a non-negative number' };
  }
  if (!partial && out.amount_ht === undefined) return { ok: false, error: 'amount_ht is required' };
  if (out.vat_rate !== undefined && out.vat_rate !== null && (isNaN(Number(out.vat_rate)) || Number(out.vat_rate) < 0 || Number(out.vat_rate) > 100)) {
    return { ok: false, error: 'vat_rate must be between 0 and 100' };
  }
  return { ok: true, value: out };
}

function money(n) { return Number(Number(n || 0).toFixed(3)); }

function totals(row) {
  var ht = money(row.amount_ht);
  var vat = money(ht * Number(row.vat_rate || 0) / 100);
  var stamp = money(row.stamp_amount || 0);
  return { total_ht: ht.toFixed(3), total_vat: vat.toFixed(3), stamp_amount: stamp.toFixed(3),
           total_ttc: money(ht + vat + stamp).toFixed(3) };
}

function paidSoFar(client, purchaseId) {
  return client.query(
    'SELECT coalesce(sum(amount),0)::numeric(14,3) AS paid FROM payments WHERE purchase_id = $1',
    [purchaseId]
  ).then(function (r) { return Number(r.rows[0].paid); });
}

/* Status follows the money, except for the states a human legitimately owns —
   the exact mirror of invoices.js's reconcileStatus. */
function reconcileStatus(client, purchaseId) {
  return Promise.all([
    client.query('SELECT amount_ht, vat_rate, stamp_amount, status FROM purchases WHERE id = $1', [purchaseId]),
    paidSoFar(client, purchaseId)
  ]).then(function (out) {
    var row = out[0].rows[0];
    var ttc = Number(totals(row).total_ttc), paid = out[1];
    var current = row.status;
    if (current === 'cancelled') return current;
    if (paid <= 0) return current;
    var next = paid + 0.0005 >= ttc ? 'paid' : 'part_paid';
    if (next === current) return current;
    return client.query('UPDATE purchases SET status = $2 WHERE id = $1', [purchaseId, next])
      .then(function () { return next; });
  });
}

function hydrate(client, row) {
  return Promise.all([
    client.query('SELECT id, paid_on, amount, method, reference FROM payments WHERE purchase_id = $1 ORDER BY paid_on', [row.id])
  ]).then(function (out) {
    var paid = out[0].rows.reduce(function (a, p) { return a + Number(p.amount); }, 0);
    var t = totals(row);
    return Object.assign({}, row, {
      totals: Object.assign({}, t, { paid: paid.toFixed(3), balance: (Number(t.total_ttc) - paid).toFixed(3) }),
      payments: out[0].rows
    });
  });
}

var handlers = {
  list: function (ctx, client) {
    var q = ctx.query || {};
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    var where = ['deleted_at IS NULL'];
    var params = [];
    if (q.supplier_id) { params.push(q.supplier_id); where.push('supplier_id = $' + params.length); }
    if (q.status) { params.push(q.status); where.push('status = $' + params.length); }
    if (q.search) { params.push('%' + q.search + '%'); where.push('(reference ILIKE $' + params.length + ' OR notes ILIKE $' + params.length + ')'); }
    params.push(limit, offset);
    return client.query(
      'SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM purchases WHERE ' + where.join(' AND ') +
      ' ORDER BY purchased_on DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM purchases WHERE ' + where.join(' AND '), params.slice(0, params.length - 2))
        .then(function (c) { return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } }; });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM purchases WHERE id = $1 AND deleted_at IS NULL', [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
    });
  },

  create: function (ctx, client) {
    var h = ctx.input;
    return require('../lib/tenancy').fiscalStamp(client).then(function (fs) {
      // A Tunisian supplier's invoice carries the same stamp; the tenant's
      // policy is the default, 0 when the supplier's document has none.
      if (h.stamp_amount === undefined) h.stamp_amount = fs.enabled ? fs.amount : 0;
      return client.query('SELECT 1 FROM suppliers WHERE id = $1 AND deleted_at IS NULL', [h.supplier_id]);
    }).then(function (sr) {
      if (!sr.rows.length) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown supplier_id' } };
      var cols = ['tenant_id'].concat(Object.keys(h));
      var params = [ctx.tenantId].concat(Object.keys(h).map(function (k) { return h[k]; }));
      return client.query(
        'INSERT INTO purchases (' + cols.map(function (c) { return '"' + c + '"'; }).join(',') + ')' +
        ' VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
        ' RETURNING ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(','), params
      ).then(function (r) {
        var row = r.rows[0];
        return hydrate(client, row).then(function (full) {
          var acc = full.status === 'confirmed' ? accounting.postPurchaseInvoice(client, ctx, full) : Promise.resolve({ skipped: 'draft' });
          return acc.then(function (a) {
            return {
              status: 201, body: Object.assign({}, full, { accounting: a.entry ? { entry_no: a.entry.entry_no } : { skipped: a.skipped } }),
              audit: { action: 'record.created', entity_table: 'purchases', entity_id: row.id,
                       detail: { supplier_id: row.supplier_id, reference: row.reference, total_ttc: full.totals.total_ttc,
                                 accounting_entry: a.entry ? a.entry.entry_no : null } }
            };
          });
        });
      });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input;
    return client.query('SELECT status FROM purchases WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status === 'paid' || cur.status === 'cancelled') {
          return { status: 409, body: { error: 'purchase is ' + cur.status + ' and cannot be edited' } };
        }
        var checkSupplier = h.supplier_id
          ? client.query('SELECT 1 FROM suppliers WHERE id = $1 AND deleted_at IS NULL', [h.supplier_id])
              .then(function (sr) { return sr.rows.length ? null : { status: 422, body: { error: 'invalid_reference', detail: 'unknown supplier_id' } }; })
          : Promise.resolve(null);
        return checkSupplier.then(function (bad) {
          if (bad) return bad;
          var p = [ctx.id];
          var sets = Object.keys(h).map(function (k) { p.push(h[k]); return '"' + k + '" = $' + p.length; });
          var step = sets.length ? client.query('UPDATE purchases SET ' + sets.join(',') + ' WHERE id = $1', p) : Promise.resolve();
          return step
            .then(function () { return reconcileStatus(client, ctx.id); })
            .then(function () {
              return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') + ' FROM purchases WHERE id = $1', [ctx.id]);
            })
            .then(function (r2) { return hydrate(client, r2.rows[0]); })
            .then(function (full) {
              var confirmed = cur.status === 'draft' && full.status !== 'draft' && full.status !== 'cancelled';
              var acc = confirmed ? accounting.postPurchaseInvoice(client, ctx, full) : Promise.resolve({ skipped: 'not_a_confirmation' });
              return acc.then(function (a) {
                return {
                  status: 200, body: Object.assign({}, full, { accounting: a.entry ? { entry_no: a.entry.entry_no } : { skipped: a.skipped } }),
                  audit: { action: 'record.updated', entity_table: 'purchases', entity_id: ctx.id,
                           detail: { fields: Object.keys(h), total_ttc: full.totals.total_ttc, accounting_entry: a.entry ? a.entry.entry_no : null } }
                };
              });
            });
        });
      });
  },

  retire: function (ctx, client) {
    return client.query(
      "UPDATE purchases SET deleted_at = now(), status = 'cancelled' WHERE id = $1 AND deleted_at IS NULL RETURNING id, reference",
      [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return accounting.reversePurchase(client, ctx, row).then(function (a) {
        return {
          status: 200, body: { id: row.id, cancelled: true, accounting: a.entry ? { reversal_entry_no: a.entry.entry_no } : { skipped: a.skipped } },
          audit: { action: 'record.deleted', entity_table: 'purchases', entity_id: row.id,
                   detail: { reference: row.reference, accounting_reversal: a.entry ? a.entry.entry_no : null } }
        };
      });
    });
  },

  addPayment: function (ctx, client) {
    var b = ctx.body || {};
    var amount = Number(b.amount);
    if (!(amount > 0)) return Promise.resolve({ status: 422, body: { error: 'amount must be greater than zero' } });
    return client.query('SELECT id, status, reference, amount_ht, vat_rate, stamp_amount FROM purchases WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        if (!(r.rows || []).length) return { status: 404, body: { error: 'not_found' } };
        var cur = r.rows[0];
        if (cur.status === 'paid' || cur.status === 'cancelled') {
          return { status: 409, body: { error: 'purchase is ' + cur.status + ' and accepts no payment' } };
        }
        var label = cur.reference || cur.id;
        // Money leaving against a DRAFT confirms it (posts the purchase entry),
        // exactly like invoices: the payment never precedes the purchase it settles.
        var confirm = cur.status !== 'draft' ? Promise.resolve({ skipped: 'already_confirmed' })
          : client.query("UPDATE purchases SET status = 'confirmed' WHERE id = $1 RETURNING " + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(','), [ctx.id])
              .then(function (u) { return hydrate(client, u.rows[0]); })
              .then(function (full) { return accounting.postPurchaseInvoice(client, ctx, full); });
        return confirm.then(function (confirmed) {
          return Promise.all([client.query('SELECT amount_ht, vat_rate, stamp_amount FROM purchases WHERE id = $1', [ctx.id]), paidSoFar(client, ctx.id)]).then(function (tp) {
            var balance = Number(totals(tp[0].rows[0]).total_ttc) - tp[1];
            if (amount > balance + 0.0005) {
              return { status: 422, body: { error: 'amount exceeds the outstanding balance', balance: balance.toFixed(3) } };
            }
            return client.query(
              'INSERT INTO payments (tenant_id, purchase_id, paid_on, amount, method, reference)' +
              ' VALUES ($1,$2,coalesce($3::date, current_date),$4,$5,$6) RETURNING id',
              [ctx.tenantId, ctx.id, b.paid_on || null, amount, b.method || null, b.reference || null]
            ).then(function (p) {
              return reconcileStatus(client, ctx.id).then(function (status) {
                return accounting.postSupplierPayment(client, ctx, { id: p.rows[0].id, purchase_label: label,
                  paid_on: b.paid_on || new Date().toISOString().slice(0, 10), amount: amount, method: b.method || null })
                  .then(function (a) {
                    return {
                      status: 201, body: { id: p.rows[0].id, purchase_status: status,
                        accounting: a.entry ? { entry_no: a.entry.entry_no, confirm_entry_no: confirmed.entry ? confirmed.entry.entry_no : undefined } : { skipped: a.skipped } },
                      audit: { action: 'record.created', entity_table: 'payments', entity_id: p.rows[0].id,
                               detail: { purchase_id: ctx.id, amount: amount, purchase_status: status, accounting_entry: a.entry ? a.entry.entry_no : null,
                                         confirmed_by_payment: cur.status === 'draft' } }
                    };
                  });
              });
            });
          });
        });
      });
  }
};

module.exports = { STATUS: STATUS, USER_SETTABLE: USER_SETTABLE, COLUMNS: COLUMNS, validateHeader: validateHeader, totals: totals, handlers: handlers };
