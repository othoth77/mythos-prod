'use strict';

/* Comptabilité — general ledger (0005-accounting.sql).
 *
 * Everything runs inside the tenant transaction the pipeline opened: RLS scopes
 * every table, the database triggers enforce balance / immutability / period
 * state, and this module adds the business shape on top:
 *
 *   entries   : list, get (with lines), create draft, update draft (lines
 *               replaced wholesale), void draft, POST /post, POST /reverse
 *   periods   : list, ensure-for-date (auto-created monthly, open), POST /close
 *   reports   : trial balance, ledger (running balance), VAT
 *   setup     : seed chart/journals/counter for a tenant that has none
 *   automatic : postInvoiceIssue / postPayment / reverseInvoice, called by the
 *               invoices module in the SAME transaction as the business change
 *
 * Extra permissions beyond the pipeline's accounting.write on POST:
 * accounting.post (post, reverse), accounting.close (close, setup).
 */

var authz = require('../lib/authz');
var audit = require('../lib/audit');
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function money(n) { return Number(Number(n || 0).toFixed(3)); }
function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
/* pg returns DATE columns as JS Date objects (local midnight); normalise both
   shapes to YYYY-MM-DD without a timezone shift. */
function isoDate(v) {
  if (v instanceof Date) return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  return String(v || '').slice(0, 10);
}

function deny(ctx, client, key, entityTable, entityId) {
  return audit.write(client, {
    actor_id: ctx.user.id, actor_label: ctx.user.email, action: 'permission.denied',
    entity_table: entityTable, entity_id: entityId || null, outcome: 'denied',
    detail: { reason: 'missing_permission', required: key }, ip: ctx.ip, tenant_id: ctx.tenantId
  }).then(function () { return { status: 403, body: { error: 'forbidden', required: key } }; });
}
function requirePerm(ctx, client, key, entityTable, entityId, fn) {
  return authz.has(client, ctx.user.id, ctx.tenantId, key).then(function (ok) {
    return ok ? fn() : deny(ctx, client, key, entityTable, entityId);
  });
}

/* ── Configuration lookups ─────────────────────────────────────────────── */
function systemAccounts(client) {
  return client.query("SELECT system_key, id, code FROM accounts WHERE system_key IS NOT NULL AND deleted_at IS NULL AND is_active")
    .then(function (r) { var m = {}; (r.rows || []).forEach(function (a) { m[a.system_key] = a; }); return m; });
}
function journalByKind(client, kind) {
  return client.query('SELECT id, code FROM journals WHERE kind = $1 AND deleted_at IS NULL AND is_active ORDER BY code LIMIT 1', [kind])
    .then(function (r) { return (r.rows || [])[0] || null; });
}
function isConfigured(client) {
  return client.query("SELECT (SELECT count(*) FROM accounts WHERE system_key IS NOT NULL) AS a, (SELECT count(*) FROM journals) AS j, (SELECT count(*) FROM accounting_counters) AS c")
    .then(function (r) { var x = r.rows[0]; return Number(x.a) >= 6 && Number(x.j) >= 1 && Number(x.c) === 1; });
}

/* Monthly period covering a date; created open on demand. Closing is manual. */
function ensurePeriod(client, tenantId, dateStr) {
  var d = isoDate(dateStr);
  return client.query('SELECT id, code, status FROM fiscal_periods WHERE $1::date BETWEEN starts_on AND ends_on ORDER BY starts_on LIMIT 1', [d])
    .then(function (r) {
      if (r.rows.length) return r.rows[0];
      var y = d.slice(0, 4), m = d.slice(5, 7);
      return client.query(
        "INSERT INTO fiscal_periods (tenant_id, code, starts_on, ends_on) VALUES ($1, $2, make_date($3::int, $4::int, 1), (make_date($3::int, $4::int, 1) + interval '1 month - 1 day')::date)" +
        ' ON CONFLICT (tenant_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id, code, status',
        [tenantId, y + '-' + m, y, m]
      ).then(function (i) { return i.rows[0]; });
    });
}

function claimEntryNo(client) {
  return client.query('UPDATE accounting_counters SET next_entry_no = next_entry_no + 1 RETURNING next_entry_no - 1 AS n')
    .then(function (r) {
      if (!r.rows.length) { var e = new Error('accounting_not_configured'); e.code = 'ACC_NOT_CONFIGURED'; throw e; }
      return r.rows[0].n;
    });
}

/* Validate and normalise lines: [{account_id, label, debit, credit, vat_rate}] */
function normaliseLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return { ok: false, error: 'at least two lines are required' };
  var out = [], td = 0, tc = 0;
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i] || {};
    if (!UUID.test(String(l.account_id || ''))) return { ok: false, error: 'line ' + (i + 1) + ': account_id must be a uuid' };
    var d = money(l.debit), c = money(l.credit);
    if (d < 0 || c < 0) return { ok: false, error: 'line ' + (i + 1) + ': amounts must be non-negative' };
    if (d > 0 && c > 0) return { ok: false, error: 'line ' + (i + 1) + ': a line is either debit or credit' };
    if (d === 0 && c === 0) return { ok: false, error: 'line ' + (i + 1) + ': amount is zero' };
    if (l.vat_rate !== undefined && l.vat_rate !== null && l.vat_rate !== '' && isNaN(Number(l.vat_rate))) return { ok: false, error: 'line ' + (i + 1) + ': vat_rate must be numeric' };
    td += d; tc += c;
    out.push({ account_id: l.account_id, label: l.label ? String(l.label).slice(0, 200) : null, debit: d, credit: c,
      vat_rate: (l.vat_rate === undefined || l.vat_rate === null || l.vat_rate === '') ? null : Number(l.vat_rate) });
  }
  return { ok: true, lines: out, debit: money(td), credit: money(tc), balanced: money(td) === money(tc) };
}

function insertLines(client, tenantId, entryId, lines) {
  if (!lines.length) return Promise.resolve();
  var params = [], chunks = [];
  lines.forEach(function (l, i) {
    params.push(tenantId, entryId, i, l.account_id, l.label, l.debit, l.credit, l.vat_rate);
    var b = i * 8;
    chunks.push('($' + (b + 1) + ',$' + (b + 2) + ',$' + (b + 3) + ',$' + (b + 4) + ',$' + (b + 5) + ',$' + (b + 6) + ',$' + (b + 7) + ',$' + (b + 8) + ')');
  });
  return client.query('INSERT INTO journal_lines (tenant_id, entry_id, position, account_id, label, debit, credit, vat_rate) VALUES ' + chunks.join(','), params);
}

function hydrate(client, row) {
  return client.query(
    'SELECT l.id, l.position, l.account_id, a.code AS account_code, a.label AS account_label, l.label, l.debit, l.credit, l.vat_rate' +
    ' FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.position', [row.id]
  ).then(function (r) {
    var td = 0, tc = 0; r.rows.forEach(function (l) { td += Number(l.debit); tc += Number(l.credit); });
    return Object.assign({}, row, { lines: r.rows, totals: { debit: td.toFixed(3), credit: tc.toFixed(3), balanced: money(td) === money(tc) } });
  });
}

var ENTRY_COLS = 'e.id, e.entry_no, e.journal_id, j.code AS journal_code, e.period_id, p.code AS period_code, e.entry_date, e.reference, e.memo,' +
  ' e.status, e.posted_at, e.reverses_id, e.reversed_by_id, e.source_table, e.source_id, e.created_at, e.updated_at';
var ENTRY_FROM = ' FROM journal_entries e JOIN journals j ON j.id = e.journal_id JOIN fiscal_periods p ON p.id = e.period_id';

function getEntry(client, id) {
  if (!UUID.test(String(id || ''))) return Promise.resolve(null);
  return client.query('SELECT ' + ENTRY_COLS + ENTRY_FROM + ' WHERE e.id = $1', [id]).then(function (r) { return (r.rows || [])[0] || null; });
}

/* Create a draft (or directly posted) entry. Used by manual and automatic paths. */
function createEntry(client, ctx, spec) {
  // spec: { journal_id, entry_date, reference, memo, lines, post, source_table, source_id }
  var v = normaliseLines(spec.lines);
  if (!v.ok) return Promise.resolve({ error: v.error, status: 422 });
  if (spec.post && !v.balanced) return Promise.resolve({ error: 'entry is unbalanced (debit ' + v.debit.toFixed(3) + ' / credit ' + v.credit.toFixed(3) + ')', status: 422 });
  return ensurePeriod(client, ctx.tenantId, spec.entry_date).then(function (period) {
    if (spec.post && period.status !== 'open') return { error: 'fiscal period ' + period.code + ' is closed', status: 409 };
    return claimEntryNo(client).then(function (no) {
      return client.query(
        'INSERT INTO journal_entries (tenant_id, entry_no, journal_id, period_id, entry_date, reference, memo, status, source_table, source_id, created_by, reverses_id)' +
        " VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11) RETURNING id",
        [ctx.tenantId, no, spec.journal_id, period.id, spec.entry_date, spec.reference || null, spec.memo || null,
         spec.source_table || null, spec.source_id || null, ctx.user.id, spec.reverses_id || null]
      ).then(function (r) {
        var id = r.rows[0].id;
        return insertLines(client, ctx.tenantId, id, v.lines).then(function () {
          if (!spec.post) return { id: id, entry_no: no, status: 'draft' };
          return client.query("UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1", [id, ctx.user.id])
            .then(function () { return { id: id, entry_no: no, status: 'posted' }; });
        });
      });
    });
  });
}

/* ── Handlers ──────────────────────────────────────────────────────────── */
var entries = {
  list: function (ctx, client) {
    var q = ctx.query || {}, params = [], where = [];
    if (q.status) { params.push(q.status); where.push('e.status = $' + params.length); }
    if (q.journal_id && UUID.test(q.journal_id)) { params.push(q.journal_id); where.push('e.journal_id = $' + params.length); }
    if (q.period) { params.push(q.period); where.push('p.code = $' + params.length); }
    if (q.from && isDate(q.from)) { params.push(q.from); where.push('e.entry_date >= $' + params.length); }
    if (q.to && isDate(q.to)) { params.push(q.to); where.push('e.entry_date <= $' + params.length); }
    if (q.search) { params.push('%' + String(q.search) + '%'); where.push('(e.reference ILIKE $' + params.length + ' OR e.memo ILIKE $' + params.length + ')'); }
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200), offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    var w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    return Promise.all([
      client.query('SELECT ' + ENTRY_COLS + ', (SELECT coalesce(sum(debit),0) FROM journal_lines l WHERE l.entry_id = e.id)::numeric(14,3) AS total' + ENTRY_FROM + w +
        ' ORDER BY e.entry_date DESC, e.entry_no DESC LIMIT ' + limit + ' OFFSET ' + offset, params),
      client.query('SELECT count(*)::int AS n' + ENTRY_FROM + w, params)
    ]).then(function (out) { return { status: 200, body: { rows: out[0].rows, total: out[1].rows[0].n, limit: limit, offset: offset } }; });
  },
  get: function (ctx, client) {
    return getEntry(client, ctx.id).then(function (row) {
      if (!row) return { status: 404, body: { error: 'not_found' } };
      return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
    });
  },
  create: function (ctx, client) {
    var b = ctx.body || {};
    if (!UUID.test(String(b.journal_id || ''))) return Promise.resolve({ status: 422, body: { error: 'journal_id must be a uuid' } });
    if (!isDate(b.entry_date)) return Promise.resolve({ status: 422, body: { error: 'entry_date must be YYYY-MM-DD' } });
    if (b.post === true) {
      return requirePerm(ctx, client, 'accounting.post', 'journal_entries', null, function () { return doCreate(); });
    }
    return doCreate();
    function doCreate() {
      return createEntry(client, ctx, { journal_id: b.journal_id, entry_date: b.entry_date, reference: b.reference, memo: b.memo, lines: b.lines, post: b.post === true })
        .then(function (r) {
          if (r.error) return { status: r.status, body: { error: r.error } };
          return getEntry(client, r.id).then(hydrate.bind(null, client)).then(function (full) {
            return { status: 201, body: full,
              audit: { action: 'record.created', entity_table: 'journal_entries', entity_id: r.id,
                       detail: { entry_no: r.entry_no, status: r.status, total: full.totals.debit } } };
          });
        });
    }
  },
  /* Draft only: header fields and lines replaced wholesale. */
  update: function (ctx, client) {
    var b = ctx.body || {};
    return getEntry(client, ctx.id).then(function (cur) {
      if (!cur) return { status: 404, body: { error: 'not_found' } };
      if (cur.status !== 'draft') return { status: 409, body: { error: 'entry is ' + cur.status + ' and cannot be edited' } };
      var sets = [], params = [ctx.id];
      if (b.reference !== undefined) { params.push(b.reference); sets.push('reference = $' + params.length); }
      if (b.memo !== undefined) { params.push(b.memo); sets.push('memo = $' + params.length); }
      if (b.journal_id !== undefined) { if (!UUID.test(String(b.journal_id))) return { status: 422, body: { error: 'journal_id must be a uuid' } }; params.push(b.journal_id); sets.push('journal_id = $' + params.length); }
      var datePromise = Promise.resolve(null);
      if (b.entry_date !== undefined) {
        if (!isDate(b.entry_date)) return { status: 422, body: { error: 'entry_date must be YYYY-MM-DD' } };
        datePromise = ensurePeriod(client, ctx.tenantId, b.entry_date).then(function (p) { params.push(b.entry_date); sets.push('entry_date = $' + params.length); params.push(p.id); sets.push('period_id = $' + params.length); });
      }
      var v = b.lines !== undefined ? normaliseLines(b.lines) : { ok: true };
      if (!v.ok) return { status: 422, body: { error: v.error } };
      return datePromise.then(function () {
        return (sets.length ? client.query('UPDATE journal_entries SET ' + sets.join(', ') + ' WHERE id = $1', params) : Promise.resolve())
          .then(function () {
            if (b.lines === undefined) return null;
            return client.query('DELETE FROM journal_lines WHERE entry_id = $1', [ctx.id]).then(function () { return insertLines(client, ctx.tenantId, ctx.id, v.lines); });
          })
          .then(function () { return getEntry(client, ctx.id).then(hydrate.bind(null, client)); })
          .then(function (full) {
            return { status: 200, body: full, audit: { action: 'record.updated', entity_table: 'journal_entries', entity_id: ctx.id,
              detail: { entry_no: full.entry_no, fields: sets.length, lines_replaced: b.lines !== undefined } } };
          });
      });
    });
  },
  /* Discard a draft: it keeps its number (numbering has no holes to explain). */
  void: function (ctx, client) {
    return getEntry(client, ctx.id).then(function (cur) {
      if (!cur) return { status: 404, body: { error: 'not_found' } };
      if (cur.status !== 'draft') return { status: 409, body: { error: 'entry is ' + cur.status + '; only drafts can be voided (post → reverse instead)' } };
      return client.query("UPDATE journal_entries SET status = 'void' WHERE id = $1", [ctx.id]).then(function () {
        return { status: 200, body: { id: ctx.id, status: 'void' },
          audit: { action: 'record.updated', entity_table: 'journal_entries', entity_id: ctx.id, detail: { entry_no: cur.entry_no, status: 'void' } } };
      });
    });
  },
  post: function (ctx, client) {
    return requirePerm(ctx, client, 'accounting.post', 'journal_entries', ctx.id, function () {
      return getEntry(client, ctx.id).then(function (cur) {
        if (!cur) return { status: 404, body: { error: 'not_found' } };
        if (cur.status !== 'draft') return { status: 409, body: { error: 'entry is ' + cur.status } };
        return hydrate(client, cur).then(function (full) {
          if (full.lines.length < 2) return { status: 422, body: { error: 'at least two lines are required' } };
          if (!full.totals.balanced) return { status: 422, body: { error: 'entry is unbalanced (debit ' + full.totals.debit + ' / credit ' + full.totals.credit + ')' } };
          return client.query('SELECT status FROM fiscal_periods WHERE id = $1', [cur.period_id]).then(function (p) {
            if ((p.rows[0] || {}).status !== 'open') return { status: 409, body: { error: 'fiscal period ' + cur.period_code + ' is closed' } };
            return client.query("UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1", [ctx.id, ctx.user.id]).then(function () {
              return { status: 200, body: { id: ctx.id, entry_no: cur.entry_no, status: 'posted' },
                audit: { action: 'record.updated', entity_table: 'journal_entries', entity_id: ctx.id, detail: { entry_no: cur.entry_no, status: 'posted', total: full.totals.debit } } };
            });
          });
        });
      });
    });
  },
  reverse: function (ctx, client) {
    return requirePerm(ctx, client, 'accounting.post', 'journal_entries', ctx.id, function () {
      return reverseEntry(client, ctx, ctx.id, (ctx.body || {}).memo, null).then(function (r) {
        if (r.error) return { status: r.status, body: { error: r.error } };
        return { status: 201, body: r.body,
          audit: { action: 'record.created', entity_table: 'journal_entries', entity_id: r.body.reversal.id,
                   detail: { reverses_entry_no: r.body.original.entry_no, entry_no: r.body.reversal.entry_no } } };
      });
    });
  }
};

/* Mirror a posted entry (debit ⇄ credit) into a new posted entry dated today (or
   the original date when its period is still open), then mark the original reversed. */
function reverseEntry(client, ctx, id, memo, source) {
  return getEntry(client, id).then(function (cur) {
    if (!cur) return { error: 'not_found', status: 404 };
    if (cur.status !== 'posted') return { error: 'entry is ' + cur.status + '; only posted entries can be reversed', status: 409 };
    return hydrate(client, cur).then(function (full) {
      return client.query('SELECT status FROM fiscal_periods WHERE id = $1', [cur.period_id]).then(function (p) {
        var date = (p.rows[0] || {}).status === 'open' ? isoDate(cur.entry_date) : isoDate(new Date());
        var lines = full.lines.map(function (l) { return { account_id: l.account_id, label: l.label, debit: l.credit, credit: l.debit, vat_rate: l.vat_rate }; });
        return createEntry(client, ctx, { journal_id: cur.journal_id, entry_date: date, reference: cur.reference,
          memo: memo || ('Extourne de l\'écriture n° ' + cur.entry_no), lines: lines, post: true,
          source_table: source ? source.table : null, source_id: source ? source.id : null,
          // the link is written at creation: a posted entry is immutable afterwards
          reverses_id: cur.id })
          .then(function (rev) {
            if (rev.error) return rev;
            return client.query("UPDATE journal_entries SET status = 'reversed', reversed_by_id = $2 WHERE id = $1", [cur.id, rev.id])
              .then(function () { return { body: { original: { id: cur.id, entry_no: cur.entry_no, status: 'reversed' }, reversal: { id: rev.id, entry_no: rev.entry_no, status: 'posted' } } }; });
          });
      });
    });
  });
}

var periods = {
  list: function (ctx, client) {
    return client.query(
      'SELECT p.id, p.code, p.starts_on, p.ends_on, p.status, p.closed_at,' +
      " (SELECT count(*) FROM journal_entries e WHERE e.period_id = p.id AND e.status IN ('posted','reversed'))::int AS posted," +
      " (SELECT count(*) FROM journal_entries e WHERE e.period_id = p.id AND e.status = 'draft')::int AS drafts" +
      ' FROM fiscal_periods p ORDER BY p.starts_on DESC'
    ).then(function (r) { return { status: 200, body: { rows: r.rows } }; });
  },
  close: function (ctx, client) {
    return requirePerm(ctx, client, 'accounting.close', 'fiscal_periods', ctx.id, function () {
      return client.query('SELECT id, code, status FROM fiscal_periods WHERE id = $1', [ctx.id]).then(function (r) {
        var p = r.rows[0];
        if (!p) return { status: 404, body: { error: 'not_found' } };
        if (p.status === 'closed') return { status: 409, body: { error: 'period already closed' } };
        return client.query("SELECT count(*)::int AS n FROM journal_entries WHERE period_id = $1 AND status = 'draft'", [ctx.id]).then(function (d) {
          if (d.rows[0].n > 0) return { status: 409, body: { error: 'period has ' + d.rows[0].n + ' draft entries; post or void them first' } };
          return client.query("UPDATE fiscal_periods SET status = 'closed', closed_at = now(), closed_by = $2 WHERE id = $1", [ctx.id, ctx.user.id]).then(function () {
            return { status: 200, body: { id: p.id, code: p.code, status: 'closed' },
              audit: { action: 'record.updated', entity_table: 'fiscal_periods', entity_id: p.id, detail: { code: p.code, status: 'closed' } } };
          });
        });
      });
    });
  }
};

var reports = {
  /* Per-account sums of POSTED lines; optional ?period=YYYY-MM or ?from&to. */
  trialBalance: function (ctx, client) {
    var q = ctx.query || {}, params = [], where = ["e.status IN ('posted','reversed')"];
    if (q.period) { params.push(q.period); where.push('p.code = $' + params.length); }
    if (q.from && isDate(q.from)) { params.push(q.from); where.push('e.entry_date >= $' + params.length); }
    if (q.to && isDate(q.to)) { params.push(q.to); where.push('e.entry_date <= $' + params.length); }
    return client.query(
      'SELECT a.id AS account_id, a.code, a.label, a.type,' +
      ' coalesce(sum(l.debit),0)::numeric(14,3) AS debit, coalesce(sum(l.credit),0)::numeric(14,3) AS credit,' +
      ' (coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0))::numeric(14,3) AS balance' +
      ' FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id' +
      ' LEFT JOIN journal_entries e ON e.id = l.entry_id LEFT JOIN fiscal_periods p ON p.id = e.period_id' +
      ' WHERE a.deleted_at IS NULL AND (l.id IS NULL OR (' + where.join(' AND ') + '))' +
      ' GROUP BY a.id, a.code, a.label, a.type ORDER BY a.code', params
    ).then(function (r) {
      var td = 0, tc = 0; r.rows.forEach(function (x) { td += Number(x.debit); tc += Number(x.credit); });
      return { status: 200, body: { rows: r.rows, totals: { debit: td.toFixed(3), credit: tc.toFixed(3), balanced: money(td) === money(tc) },
        filter: { period: q.period || null, from: q.from || null, to: q.to || null } } };
    });
  },
  /* Lines of one account with running balance; opening balance = before ?from. */
  ledger: function (ctx, client) {
    var q = ctx.query || {};
    if (!UUID.test(String(q.account_id || ''))) return Promise.resolve({ status: 422, body: { error: 'account_id must be a uuid' } });
    var params = [q.account_id], where = ["e.status IN ('posted','reversed')", 'l.account_id = $1'];
    var openingParams = [q.account_id];
    var opening = Promise.resolve(0);
    if (q.from && isDate(q.from)) {
      params.push(q.from); where.push('e.entry_date >= $' + params.length);
      openingParams.push(q.from);
      opening = client.query("SELECT (coalesce(sum(l.debit),0) - coalesce(sum(l.credit),0))::numeric(14,3) AS b FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.account_id = $1 AND e.status IN ('posted','reversed') AND e.entry_date < $2", openingParams)
        .then(function (r) { return Number(r.rows[0].b); });
    }
    if (q.to && isDate(q.to)) { params.push(q.to); where.push('e.entry_date <= $' + params.length); }
    return Promise.all([
      client.query('SELECT id, code, label, type FROM accounts WHERE id = $1', [q.account_id]),
      client.query('SELECT l.id, e.id AS entry_id, e.entry_no, e.entry_date, j.code AS journal_code, e.reference, e.memo, e.status AS entry_status, l.label, l.debit, l.credit' +
        ' FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN journals j ON j.id = e.journal_id' +
        ' WHERE ' + where.join(' AND ') + ' ORDER BY e.entry_date, e.entry_no, l.position', params),
      opening
    ]).then(function (out) {
      var acc = out[0].rows[0];
      if (!acc) return { status: 404, body: { error: 'not_found' } };
      var bal = out[2];
      var rows = out[1].rows.map(function (l) { bal = money(bal + Number(l.debit) - Number(l.credit)); return Object.assign({}, l, { running_balance: bal.toFixed(3) }); });
      return { status: 200, body: { account: acc, opening_balance: Number(out[2]).toFixed(3), rows: rows, closing_balance: bal.toFixed(3) } };
    });
  },
  /* VAT: collected (vat_collected account, credit − debit) vs deductible; by rate from the line's vat_rate. */
  vat: function (ctx, client) {
    var q = ctx.query || {}, params = [], where = ["e.status IN ('posted','reversed')", 'a.system_key IN (\'vat_collected\',\'vat_deductible\')'];
    if (q.period) { params.push(q.period); where.push('p.code = $' + params.length); }
    if (q.from && isDate(q.from)) { params.push(q.from); where.push('e.entry_date >= $' + params.length); }
    if (q.to && isDate(q.to)) { params.push(q.to); where.push('e.entry_date <= $' + params.length); }
    return client.query(
      'SELECT a.system_key, coalesce(l.vat_rate, 0)::numeric(5,2) AS vat_rate,' +
      ' coalesce(sum(l.debit),0)::numeric(14,3) AS debit, coalesce(sum(l.credit),0)::numeric(14,3) AS credit' +
      ' FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id JOIN fiscal_periods p ON p.id = e.period_id' +
      ' WHERE ' + where.join(' AND ') + ' GROUP BY a.system_key, coalesce(l.vat_rate, 0) ORDER BY 1, 2', params
    ).then(function (r) {
      var collected = 0, deductible = 0;
      var by_rate = r.rows.map(function (x) {
        var amt = x.system_key === 'vat_collected' ? Number(x.credit) - Number(x.debit) : Number(x.debit) - Number(x.credit);
        if (x.system_key === 'vat_collected') collected += amt; else deductible += amt;
        return { kind: x.system_key, vat_rate: x.vat_rate, amount: amt.toFixed(3) };
      });
      return { status: 200, body: { collected: collected.toFixed(3), deductible: deductible.toFixed(3), net_due: (collected - deductible).toFixed(3), by_rate: by_rate,
        filter: { period: q.period || null, from: q.from || null, to: q.to || null } } };
    });
  }
};

var setup = {
  status: function (ctx, client) {
    return Promise.all([isConfigured(client), systemAccounts(client), client.query('SELECT count(*)::int AS n FROM journals'), client.query('SELECT next_entry_no FROM accounting_counters')])
      .then(function (out) {
        return { status: 200, body: { configured: out[0], system_accounts: Object.keys(out[1]).sort(), journals: out[2].rows[0].n,
          next_entry_no: out[3].rows[0] ? out[3].rows[0].next_entry_no : null } };
      });
  },
  /* Seed the default chart/journals/counter for a tenant that has none. */
  run: function (ctx, client) {
    return requirePerm(ctx, client, 'accounting.close', 'accounts', null, function () {
      return client.query('SELECT accounting_seed_tenant($1) AS n', [ctx.tenantId]).then(function (r) {
        return { status: 200, body: { seeded_accounts: r.rows[0].n },
          audit: { action: 'record.created', entity_table: 'accounts', detail: { seeded_accounts: r.rows[0].n, setup: true } } };
      });
    });
  }
};

/* ── Automatic links from invoices and payments ─────────────────────────── */
/* All three return a Promise of { entry, skipped } and never throw for a tenant
   that has not configured accounting or has the module disabled: the business
   operation must not fail because bookkeeping is not set up. They throw for a
   configured tenant when the posting itself fails (unbalanced would be a bug). */
function accountingActive(client) {
  return client.query("SELECT enabled FROM tenant_modules WHERE module_key = 'accounting' LIMIT 1").then(function (r) {
    if (!r.rows.length || !r.rows[0].enabled) return false;
    return isConfigured(client);
  });
}

function postInvoiceIssue(client, ctx, invoice) {
  // invoice: { id, number, issued_on, lines: [{line_ht, vat_rate, description}] }
  return accountingActive(client).then(function (active) {
    if (!active) return { skipped: 'accounting_not_configured' };
    return Promise.all([systemAccounts(client), journalByKind(client, 'sales'),
      client.query('SELECT 1 FROM journal_entries WHERE source_table = $1 AND source_id = $2', ['invoices', invoice.id])])
      .then(function (out) {
        var acc = out[0], journal = out[1];
        if (out[2].rows.length) return { skipped: 'already_posted' };
        if (!acc.receivable || !acc.sales || !acc.vat_collected || !journal) return { skipped: 'system_accounts_missing' };
        var ht = 0, byRate = {};
        invoice.lines.forEach(function (l) {
          var lh = Number(l.line_ht), rate = Number(l.vat_rate);
          ht += lh; byRate[rate] = (byRate[rate] || 0) + lh * rate / 100;
        });
        var vat = Object.keys(byRate).reduce(function (a, k) { return a + byRate[k]; }, 0);
        var ttc = money(ht + vat);
        if (ttc <= 0) return { skipped: 'zero_amount' };
        var lines = [{ account_id: acc.receivable.id, label: 'Facture ' + invoice.number, debit: ttc, credit: 0 },
                     { account_id: acc.sales.id, label: 'Ventes HT ' + invoice.number, debit: 0, credit: money(ht) }];
        Object.keys(byRate).sort().forEach(function (rate) {
          if (money(byRate[rate]) > 0) lines.push({ account_id: acc.vat_collected.id, label: 'TVA collectée ' + rate + ' %', debit: 0, credit: money(byRate[rate]), vat_rate: Number(rate) });
        });
        // rounding: force balance on the receivable side to the millime
        var sumC = lines.slice(1).reduce(function (a, l) { return a + l.credit; }, 0);
        lines[0].debit = money(sumC);
        return createEntry(client, ctx, { journal_id: journal.id, entry_date: isoDate(invoice.issued_on), reference: invoice.number,
          memo: 'Émission facture ' + invoice.number, lines: lines, post: true, source_table: 'invoices', source_id: invoice.id })
          .then(function (r) { if (r.error) throw Object.assign(new Error('accounting: ' + r.error), { status: r.status || 409, expose: true }); return { entry: r }; });
      });
  });
}

function postPayment(client, ctx, payment) {
  // payment: { id, invoice_number, paid_on, amount, method }
  return accountingActive(client).then(function (active) {
    if (!active) return { skipped: 'accounting_not_configured' };
    var cash = /esp[eè]ces|cash|caisse|liquide/i.test(String(payment.method || ''));
    return Promise.all([systemAccounts(client), journalByKind(client, cash ? 'cash' : 'bank'),
      client.query('SELECT 1 FROM journal_entries WHERE source_table = $1 AND source_id = $2', ['payments', payment.id])])
      .then(function (out) {
        var acc = out[0], journal = out[1] || null;
        if (out[2].rows.length) return { skipped: 'already_posted' };
        var treasury = cash ? (acc.cash || acc.bank) : acc.bank;
        if (!acc.receivable || !treasury || !journal) return { skipped: 'system_accounts_missing' };
        var amt = money(payment.amount);
        return createEntry(client, ctx, { journal_id: journal.id, entry_date: isoDate(payment.paid_on), reference: payment.invoice_number,
          memo: 'Règlement facture ' + payment.invoice_number + (payment.method ? ' (' + payment.method + ')' : ''),
          lines: [{ account_id: treasury.id, label: 'Encaissement ' + payment.invoice_number, debit: amt, credit: 0 },
                  { account_id: acc.receivable.id, label: 'Règlement ' + payment.invoice_number, debit: 0, credit: amt }],
          post: true, source_table: 'payments', source_id: payment.id })
          .then(function (r) { if (r.error) throw Object.assign(new Error('accounting: ' + r.error), { status: r.status || 409, expose: true }); return { entry: r }; });
      });
  });
}

/* Invoice cancelled after issue: reverse its issue entry (payments stay: money moved). */
function reverseInvoice(client, ctx, invoice) {
  return accountingActive(client).then(function (active) {
    if (!active) return { skipped: 'accounting_not_configured' };
    return client.query("SELECT id, status FROM journal_entries WHERE source_table = 'invoices' AND source_id = $1", [invoice.id]).then(function (r) {
      var e = r.rows[0];
      if (!e) return { skipped: 'no_issue_entry' };
      if (e.status !== 'posted') return { skipped: 'issue_entry_' + e.status };
      return reverseEntry(client, ctx, e.id, 'Annulation facture ' + invoice.number, { table: 'invoice_cancel', id: invoice.id })
        .then(function (rv) { if (rv.error) throw Object.assign(new Error('accounting: ' + rv.error), { status: rv.status || 409, expose: true }); return { entry: rv.body.reversal }; });
    });
  });
}

module.exports = {
  entries: entries, periods: periods, reports: reports, setup: setup,
  postInvoiceIssue: postInvoiceIssue, postPayment: postPayment, reverseInvoice: reverseInvoice,
  normaliseLines: normaliseLines, ensurePeriod: ensurePeriod
};
