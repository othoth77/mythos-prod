'use strict';

/* Invoices — the module the brief singles out, and the one where getting it
 * casually wrong is most expensive.
 *
 * Design decisions worth stating:
 *
 *   - Totals are COMPUTED from lines, never accepted from the client. The
 *     legacy ERP totalled in the browser and stored the result, which is the
 *     origin of the reconciliation drift the accounting screens work around.
 *   - The invoice number is claimed with UPDATE ... RETURNING inside the
 *     request's transaction, so two simultaneous creations cannot take the
 *     same number. A SELECT-then-UPDATE would be a race that only appears
 *     under load, in production, on the one document customers keep.
 *   - Numbering is per tenant (tenants.invoice_next_seq). Company B's first
 *     invoice is 1, whatever Company A has issued.
 *   - Status is DERIVED from payments where payment determines it. A user may
 *     set draft/sent/cancelled; paid and part_paid are facts about money
 *     received, not opinions.
 *   - Money is numeric(14,3) end to end. The domain is Tunisian; the dinar has
 *     1000 millimes, and float would be wrong in a way that only surfaces in
 *     reconciliation.
 */

var STATUS = ['draft', 'sent', 'part_paid', 'paid', 'cancelled'];
var USER_SETTABLE = ['draft', 'sent', 'cancelled'];

var COLUMNS = ['id', 'number', 'client_id', 'project_id', 'quote_id', 'issued_on',
  'due_on', 'status', 'currency', 'payment_mode', 'notes', 'legacy_id',
  'created_at', 'updated_at'];

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  ['client_id', 'project_id', 'quote_id', 'issued_on', 'due_on', 'currency',
   'payment_mode', 'notes', 'legacy_id', 'status'].forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f];
  });
  if (out.status !== undefined && USER_SETTABLE.indexOf(String(out.status)) < 0) {
    return { ok: false, error: 'status may only be set to ' + USER_SETTABLE.join('|') +
                              ' — paid and part_paid follow from payments' };
  }
  ['issued_on', 'due_on'].forEach(function (f) {
    if (out[f] && !/^\d{4}-\d{2}-\d{2}$/.test(String(out[f]))) out.__bad = f;
  });
  if (out.__bad) return { ok: false, error: out.__bad + ' must be YYYY-MM-DD' };
  if (out.due_on && out.issued_on && String(out.due_on) < String(out.issued_on)) {
    return { ok: false, error: 'due_on precedes issued_on' };
  }
  var lines = b.lines;
  if (!partial) {
    if (!Array.isArray(lines) || !lines.length) return { ok: false, error: 'at least one line is required' };
  }
  if (lines !== undefined) {
    if (!Array.isArray(lines)) return { ok: false, error: 'lines must be an array' };
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i] || {};
      if (!l.description || !String(l.description).trim()) return { ok: false, error: 'line ' + (i + 1) + ' needs a description' };
      if (isNaN(Number(l.quantity)) || Number(l.quantity) <= 0) return { ok: false, error: 'line ' + (i + 1) + ' quantity must be a positive number' };
      if (isNaN(Number(l.unit_price)) || Number(l.unit_price) < 0) return { ok: false, error: 'line ' + (i + 1) + ' unit_price must be a non-negative number' };
      if (l.vat_rate !== undefined && (isNaN(Number(l.vat_rate)) || Number(l.vat_rate) < 0 || Number(l.vat_rate) > 100)) {
        return { ok: false, error: 'line ' + (i + 1) + ' vat_rate must be between 0 and 100' };
      }
    }
  }
  return { ok: true, value: { header: out, lines: lines } };
}

function replaceLines(client, invoiceId, tenantId, lines) {
  return client.query('DELETE FROM invoice_lines WHERE invoice_id = $1', [invoiceId])
    .then(function () {
      if (!lines || !lines.length) return null;
      var params = [];
      var chunks = lines.map(function (l, i) {
        var base = i * 7;
        params.push(tenantId, invoiceId, i, String(l.description),
          l.unit || null, Number(l.quantity), Number(l.unit_price));
        return '($' + (base + 1) + ',$' + (base + 2) + ',$' + (base + 3) + ',$' + (base + 4) +
               ',$' + (base + 5) + ',$' + (base + 6) + ',$' + (base + 7) + ',' +
               (l.vat_rate === undefined ? '19.00' : Number(l.vat_rate)) + ')';
      });
      return client.query(
        'INSERT INTO invoice_lines (tenant_id, invoice_id, position, description, unit, quantity, unit_price, vat_rate)' +
        ' VALUES ' + chunks.join(','), params);
    });
}

/* One query, one source of truth. line_ht is a STORED generated column, so the
   database computes the line and this computes the document. */
function totals(client, invoiceId) {
  return client.query(
    'SELECT coalesce(sum(line_ht),0)::numeric(14,3) AS total_ht,' +
    ' coalesce(sum(line_ht * vat_rate / 100),0)::numeric(14,3) AS total_vat,' +
    ' coalesce(sum(line_ht * (1 + vat_rate / 100)),0)::numeric(14,3) AS total_ttc' +
    ' FROM invoice_lines WHERE invoice_id = $1', [invoiceId]
  ).then(function (r) { return r.rows[0]; });
}

function paidSoFar(client, invoiceId) {
  return client.query(
    'SELECT coalesce(sum(amount),0)::numeric(14,3) AS paid FROM payments WHERE invoice_id = $1',
    [invoiceId]
  ).then(function (r) { return Number(r.rows[0].paid); });
}

/* Status follows the money, except for the states a human legitimately owns. */
function reconcileStatus(client, invoiceId) {
  return Promise.all([totals(client, invoiceId), paidSoFar(client, invoiceId),
    client.query('SELECT status FROM invoices WHERE id = $1', [invoiceId])
  ]).then(function (out) {
    var ttc = Number(out[0].total_ttc), paid = out[1];
    var current = (out[2].rows[0] || {}).status;
    // Only cancellation is terminal. A draft that has been paid is not still a
    // draft — money arriving is a fact about the invoice, and refusing to
    // reflect it was the bug that let a paid invoice stay editable.
    if (current === 'cancelled') return current;
    if (paid <= 0) return current;                      // draft stays draft, sent stays sent
    var next = paid + 0.0005 >= ttc ? 'paid' : 'part_paid';
    if (next === current) return current;
    return client.query('UPDATE invoices SET status = $2 WHERE id = $1', [invoiceId, next])
      .then(function () { return next; });
  });
}

function hydrate(client, row) {
  return Promise.all([
    client.query('SELECT id, position, description, unit, quantity, unit_price, vat_rate, line_ht' +
                 ' FROM invoice_lines WHERE invoice_id = $1 ORDER BY position', [row.id]),
    totals(client, row.id),
    client.query('SELECT id, paid_on, amount, method, reference FROM payments' +
                 ' WHERE invoice_id = $1 ORDER BY paid_on', [row.id])
  ]).then(function (out) {
    var paid = out[2].rows.reduce(function (a, p) { return a + Number(p.amount); }, 0);
    return Object.assign({}, row, {
      lines: out[0].rows,
      totals: Object.assign({}, out[1], {
        paid: paid.toFixed(3),
        balance: (Number(out[1].total_ttc) - paid).toFixed(3)
      }),
      payments: out[2].rows
    });
  });
}

var handlers = {
  list: function (ctx, client) {
    var q = ctx.query || {};
    var where = ['deleted_at IS NULL'];
    var params = [];
    ['client_id', 'project_id', 'status'].forEach(function (f) {
      if (!q[f]) return;
      params.push(q[f]);
      where.push('"' + f + '" = $' + params.length);
    });
    if (q.search) {
      params.push('%' + String(q.search) + '%');
      where.push('(number ILIKE $' + params.length + ' OR notes ILIKE $' + params.length + ')');
    }
    if (q.from) { params.push(q.from); where.push('issued_on >= $' + params.length); }
    if (q.to)   { params.push(q.to);   where.push('issued_on <= $' + params.length); }
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    return client.query(
      'SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM invoices WHERE ' + where.join(' AND ') +
      ' ORDER BY issued_on DESC, number DESC LIMIT ' + limit + ' OFFSET ' + offset, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM invoices WHERE ' + where.join(' AND '), params)
        .then(function (c) {
          return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } };
        });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM invoices WHERE id = $1 AND deleted_at IS NULL', [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
    });
  },

  create: function (ctx, client) {
    var tenancy = require('../lib/tenancy');
    var h = ctx.input.header;
    return tenancy.claimInvoiceNumber(client).then(function (number) {
      var cols = ['tenant_id', 'number'];
      var params = [ctx.tenantId, number];
      Object.keys(h).forEach(function (k) { cols.push(k); params.push(h[k]); });
      return client.query(
        'INSERT INTO invoices (' + cols.map(function (c) { return '"' + c + '"'; }).join(',') + ')' +
        ' VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
        ' RETURNING ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(','), params);
    }).then(function (r) {
      var row = r.rows[0];
      return replaceLines(client, row.id, ctx.tenantId, ctx.input.lines)
        .then(function () { return hydrate(client, row); })
        .then(function (full) {
          return {
            status: 201, body: full,
            audit: { action: 'record.created', entity_table: 'invoices', entity_id: row.id,
                     detail: { number: row.number, total_ttc: full.totals.total_ttc,
                               line_count: full.lines.length } }
          };
        });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input.header;
    var lines = ctx.input.lines;
    return client.query('SELECT status FROM invoices WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        // A paid invoice is an accounting record, not a document. Editing it
        // would silently rewrite history someone has already been charged for.
        if (cur.status === 'paid' || cur.status === 'cancelled') {
          return { status: 409, body: { error: 'invoice is ' + cur.status + ' and cannot be edited' } };
        }
        var p = [ctx.id];
        var sets = Object.keys(h).map(function (k) { p.push(h[k]); return '"' + k + '" = $' + p.length; });
        var step = sets.length
          ? client.query('UPDATE invoices SET ' + sets.join(',') + ' WHERE id = $1', p)
          : Promise.resolve();
        return step
          .then(function () { return lines === undefined ? null : replaceLines(client, ctx.id, ctx.tenantId, lines); })
          .then(function () { return reconcileStatus(client, ctx.id); })
          .then(function () {
            return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
              ' FROM invoices WHERE id = $1', [ctx.id]);
          })
          .then(function (r2) { return hydrate(client, r2.rows[0]); })
          .then(function (full) {
            return {
              status: 200, body: full,
              audit: { action: 'record.updated', entity_table: 'invoices', entity_id: ctx.id,
                       detail: { fields: Object.keys(h), lines_replaced: lines !== undefined,
                                 total_ttc: full.totals.total_ttc } }
            };
          });
      });
  },

  retire: function (ctx, client) {
    return client.query(
      "UPDATE invoices SET deleted_at = now(), status = 'cancelled'" +
      ' WHERE id = $1 AND deleted_at IS NULL RETURNING id, number', [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return {
        status: 200, body: { id: row.id, cancelled: true },
        audit: { action: 'record.deleted', entity_table: 'invoices', entity_id: row.id,
                 detail: { number: row.number } }
      };
    });
  },

  addPayment: function (ctx, client) {
    var b = ctx.body || {};
    var amount = Number(b.amount);
    if (!(amount > 0)) return Promise.resolve({ status: 422, body: { error: 'amount must be greater than zero' } });
    return client.query('SELECT id FROM invoices WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        if (!(r.rows || []).length) return { status: 404, body: { error: 'not_found' } };
        return client.query(
          'INSERT INTO payments (tenant_id, invoice_id, paid_on, amount, method, reference)' +
          ' VALUES ($1,$2,coalesce($3::date, current_date),$4,$5,$6) RETURNING id',
          [ctx.tenantId, ctx.id, b.paid_on || null, amount, b.method || null, b.reference || null]
        ).then(function (p) {
          return reconcileStatus(client, ctx.id).then(function (status) {
            return {
              status: 201, body: { id: p.rows[0].id, invoice_status: status },
              audit: { action: 'record.created', entity_table: 'payments', entity_id: p.rows[0].id,
                       detail: { invoice_id: ctx.id, amount: amount, invoice_status: status } }
            };
          });
        });
      });
  }
};

module.exports = {
  STATUS: STATUS,
  USER_SETTABLE: USER_SETTABLE,
  COLUMNS: COLUMNS,
  validateHeader: validateHeader,
  totals: totals,
  reconcileStatus: reconcileStatus,
  handlers: handlers
};
