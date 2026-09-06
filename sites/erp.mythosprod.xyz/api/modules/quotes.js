'use strict';

/* Quotes — header + lines, mirroring the invoices module exactly, minus
 * payments (a quote is not yet money) plus one extra action: converting an
 * accepted quote into an invoice.
 *
 * Same non-negotiables as invoices, reused rather than reinvented:
 *   - Totals are COMPUTED from lines, never accepted from the client.
 *   - Money is numeric(14,3) end to end.
 *   - A quote_lines row exists per line, same shape as invoice_lines.
 */

var STATUS = ['draft', 'sent', 'accepted', 'refused', 'expired'];
var USER_SETTABLE = STATUS; // unlike invoices, no status here is money-derived

var COLUMNS = ['id', 'number', 'client_id', 'project_id', 'issued_on',
  'valid_until', 'status', 'currency', 'notes', 'legacy_id',
  'created_at', 'updated_at'];

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  ['client_id', 'project_id', 'issued_on', 'valid_until', 'currency',
   'notes', 'legacy_id', 'status'].forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f];
  });
  if (out.status !== undefined && USER_SETTABLE.indexOf(String(out.status)) < 0) {
    return { ok: false, error: 'status must be one of ' + USER_SETTABLE.join('|') };
  }
  ['issued_on', 'valid_until'].forEach(function (f) {
    if (out[f] && !/^\d{4}-\d{2}-\d{2}$/.test(String(out[f]))) out.__bad = f;
  });
  if (out.__bad) return { ok: false, error: out.__bad + ' must be YYYY-MM-DD' };
  if (out.valid_until && out.issued_on && String(out.valid_until) < String(out.issued_on)) {
    return { ok: false, error: 'valid_until precedes issued_on' };
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

function replaceLines(client, quoteId, tenantId, lines) {
  return client.query('DELETE FROM quote_lines WHERE quote_id = $1', [quoteId])
    .then(function () {
      if (!lines || !lines.length) return null;
      var params = [];
      var chunks = lines.map(function (l, i) {
        var base = i * 7;
        params.push(tenantId, quoteId, i, String(l.description),
          l.unit || null, Number(l.quantity), Number(l.unit_price));
        return '($' + (base + 1) + ',$' + (base + 2) + ',$' + (base + 3) + ',$' + (base + 4) +
               ',$' + (base + 5) + ',$' + (base + 6) + ',$' + (base + 7) + ',' +
               (l.vat_rate === undefined ? '19.00' : Number(l.vat_rate)) + ')';
      });
      return client.query(
        'INSERT INTO quote_lines (tenant_id, quote_id, position, description, unit, quantity, unit_price, vat_rate)' +
        ' VALUES ' + chunks.join(','), params);
    });
}

function totals(client, quoteId) {
  return client.query(
    'SELECT coalesce(sum(line_ht),0)::numeric(14,3) AS total_ht,' +
    ' coalesce(sum(line_ht * vat_rate / 100),0)::numeric(14,3) AS total_vat,' +
    ' coalesce(sum(line_ht * (1 + vat_rate / 100)),0)::numeric(14,3) AS total_ttc' +
    ' FROM quote_lines WHERE quote_id = $1', [quoteId]
  ).then(function (r) { return r.rows[0]; });
}

function hydrate(client, row) {
  return Promise.all([
    client.query('SELECT id, position, description, unit, quantity, unit_price, vat_rate, line_ht' +
                 ' FROM quote_lines WHERE quote_id = $1 ORDER BY position', [row.id]),
    totals(client, row.id)
  ]).then(function (out) {
    return Object.assign({}, row, { lines: out[0].rows, totals: out[1] });
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
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    return client.query(
      'SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM quotes WHERE ' + where.join(' AND ') +
      ' ORDER BY issued_on DESC, number DESC LIMIT ' + limit + ' OFFSET ' + offset, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM quotes WHERE ' + where.join(' AND '), params)
        .then(function (c) {
          return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } };
        });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM quotes WHERE id = $1 AND deleted_at IS NULL', [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
    });
  },

  create: function (ctx, client) {
    var h = ctx.input.header;
    // Quotes have no claimed per-tenant sequence (tenants.invoice_next_seq
    // has no quote counterpart, and adding one is a migration — out of
    // reach without an owner GO). Unlike an invoice number, a quote number
    // carries no legal sequential-numbering expectation, so a
    // collision-resistant generated one is a correct MVP answer, not a
    // placeholder: DEV-<year>-<8 hex>, 2^32 keyspace. A genuine clash (never
    // observed at any realistic quote volume) surfaces as the same clean
    // 409 duplicate every other UNIQUE violation in this API produces
    // (server.js's PG-error map) — not silently retried inside a
    // transaction a failed INSERT has already aborted.
    var number = 'DEV-' + new Date().getUTCFullYear() + '-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
    var cols = ['tenant_id', 'number'];
    var params = [ctx.tenantId, number];
    Object.keys(h).forEach(function (k) { cols.push(k); params.push(h[k]); });
    return client.query(
      'INSERT INTO quotes (' + cols.map(function (c) { return '"' + c + '"'; }).join(',') + ')' +
      ' VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
      ' RETURNING ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(','), params
    ).then(function (r) {
      var row = r.rows[0];
      return replaceLines(client, row.id, ctx.tenantId, ctx.input.lines)
        .then(function () { return hydrate(client, row); })
        .then(function (full) {
          return {
            status: 201, body: full,
            audit: { action: 'record.created', entity_table: 'quotes', entity_id: row.id,
                     detail: { number: row.number, total_ttc: full.totals.total_ttc, line_count: full.lines.length } }
          };
        });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input.header;
    var lines = ctx.input.lines;
    return client.query('SELECT status FROM quotes WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var cur = (r.rows || [])[0];
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status === 'accepted' || cur.status === 'refused') {
          return { status: 409, body: { error: 'quote is ' + cur.status + ' and cannot be edited' } };
        }
        var p = [ctx.id];
        var sets = Object.keys(h).map(function (k) { p.push(h[k]); return '"' + k + '" = $' + p.length; });
        var step = sets.length
          ? client.query('UPDATE quotes SET ' + sets.join(',') + ' WHERE id = $1', p)
          : Promise.resolve();
        return step
          .then(function () { return lines === undefined ? null : replaceLines(client, ctx.id, ctx.tenantId, lines); })
          .then(function () {
            return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
              ' FROM quotes WHERE id = $1', [ctx.id]);
          })
          .then(function (r2) { return hydrate(client, r2.rows[0]); })
          .then(function (full) {
            return {
              status: 200, body: full,
              audit: { action: 'record.updated', entity_table: 'quotes', entity_id: ctx.id,
                       detail: { fields: Object.keys(h), lines_replaced: lines !== undefined, total_ttc: full.totals.total_ttc } }
            };
          });
      });
  },

  retire: function (ctx, client) {
    return client.query(
      "UPDATE quotes SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id, number",
      [ctx.id]
    ).then(function (r) {
      var row = (r.rows || [])[0];
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return {
        status: 200, body: { id: row.id, retired: true },
        audit: { action: 'record.deleted', entity_table: 'quotes', entity_id: row.id, detail: { number: row.number } }
      };
    });
  },

  /* An accepted quote becomes a draft invoice: header fields carried over
   * (client, project, currency, notes), lines copied verbatim, quote_id set
   * so the invoice remembers where it came from. The quote itself is left
   * exactly as it was (still 'accepted') — converting does not consume it,
   * so re-reading the quote later still shows what was agreed. Converting
   * twice creates two invoices, which is correct: a quote can legitimately
   * be split into more than one invoice, and the reverse (refusing to allow
   * it) would be a policy this module has no business enforcing silently. */
  convert: function (ctx, client) {
    var tenancy = require('../lib/tenancy');
    return client.query('SELECT ' + COLUMNS.map(function (c) { return '"' + c + '"'; }).join(',') +
      ' FROM quotes WHERE id = $1 AND deleted_at IS NULL', [ctx.id]
    ).then(function (r) {
      var q = (r.rows || [])[0];
      if (!q) return { status: 404, body: { error: 'not_found' } };
      if (q.status !== 'accepted') {
        return { status: 409, body: { error: 'only an accepted quote may be converted', status: q.status } };
      }
      return client.query('SELECT description, unit, quantity, unit_price, vat_rate FROM quote_lines WHERE quote_id = $1 ORDER BY position', [q.id])
        .then(function (lr) {
          var lines = lr.rows;
          if (!lines.length) return { status: 409, body: { error: 'quote has no lines to convert' } };
          return tenancy.claimInvoiceNumber(client).then(function (number) {
            var header = { tenant_id: ctx.tenantId, number: number, client_id: q.client_id, project_id: q.project_id,
              quote_id: q.id, currency: q.currency, notes: q.notes };
            var cols = Object.keys(header);
            var params = cols.map(function (k) { return header[k]; });
            return client.query(
              'INSERT INTO invoices (' + cols.map(function (c) { return '"' + c + '"'; }).join(',') + ')' +
              ' VALUES (' + params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
              ' RETURNING id, number', params);
          }).then(function (ir) {
            var inv = ir.rows[0];
            var invoices = require('./invoices');
            return replaceInvoiceLines(client, inv.id, ctx.tenantId, lines).then(function () {
              return invoices.totals(client, inv.id);
            }).then(function (t) {
              return {
                status: 201, body: { invoice_id: inv.id, invoice_number: inv.number, quote_id: q.id, totals: t },
                audit: { action: 'record.created', entity_table: 'invoices', entity_id: inv.id,
                         detail: { converted_from_quote: q.id, quote_number: q.number, invoice_number: inv.number, line_count: lines.length } }
              };
            });
          });
        });
    });
  }
};

/* Same insert shape as invoices.js's replaceLines, targeting invoice_lines —
   duplicated rather than imported across modules for one INSERT statement,
   because the two tables' column lists could legitimately diverge later and
   a shared helper would then need to know which table it is writing to. */
function replaceInvoiceLines(client, invoiceId, tenantId, lines) {
  var params = [];
  var chunks = lines.map(function (l, i) {
    var base = i * 7;
    params.push(tenantId, invoiceId, i, String(l.description),
      l.unit || null, Number(l.quantity), Number(l.unit_price));
    return '($' + (base + 1) + ',$' + (base + 2) + ',$' + (base + 3) + ',$' + (base + 4) +
           ',$' + (base + 5) + ',$' + (base + 6) + ',$' + (base + 7) + ',' + Number(l.vat_rate) + ')';
  });
  return client.query(
    'INSERT INTO invoice_lines (tenant_id, invoice_id, position, description, unit, quantity, unit_price, vat_rate)' +
    ' VALUES ' + chunks.join(','), params);
}

module.exports = {
  STATUS: STATUS,
  USER_SETTABLE: USER_SETTABLE,
  COLUMNS: COLUMNS,
  validateHeader: validateHeader,
  totals: totals,
  handlers: handlers
};
