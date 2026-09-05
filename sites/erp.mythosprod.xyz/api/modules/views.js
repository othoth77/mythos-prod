'use strict';

/* Read-oriented modules: dashboard, reports, settings, users, audit.
 *
 * Every query here runs inside the tenant transaction, so none of them carries
 * a tenant filter and none of them needs one — RLS has already narrowed the
 * tables. That is the property worth having: the aggregate that forgets a
 * WHERE clause returns this tenant's numbers, not everyone's.
 */

var tenancy = require('../lib/tenancy');

var dashboard = {
  summary: function (ctx, client) {
    return Promise.all([
      client.query('SELECT count(*)::int AS n FROM clients WHERE deleted_at IS NULL'),
      client.query("SELECT count(*)::int AS n FROM projects WHERE deleted_at IS NULL AND status <> 'closed'"),
      client.query("SELECT count(*)::int AS n FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','part_paid')"),
      client.query(
        "SELECT coalesce(sum(l.line_ht * (1 + l.vat_rate/100)),0)::numeric(14,3) AS ttc" +
        ' FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id' +
        " WHERE i.deleted_at IS NULL AND i.status IN ('sent','part_paid','paid')" +
        "   AND i.issued_on >= date_trunc('year', current_date)"),
      client.query('SELECT coalesce(sum(amount),0)::numeric(14,3) AS paid FROM payments' +
        " WHERE paid_on >= date_trunc('year', current_date)"),
      client.query('SELECT count(*)::int AS n FROM appointments' +
        ' WHERE deleted_at IS NULL AND starts_at >= now() AND starts_at < now() + interval \'7 days\''),
      // Stock is not a column: on-hand = the signed sum of inventory_movements,
      // and the reorder threshold is inventory_items.min_quantity (0 = none).
      // The previous query named reorder_level / quantity_on_hand, columns that
      // never existed, so /dashboard was a guaranteed 500 (found 2026-09-05).
      client.query('SELECT count(*)::int AS n FROM inventory_items i' +
        ' WHERE i.deleted_at IS NULL AND i.min_quantity > 0' +
        '   AND coalesce((SELECT sum(m.quantity) FROM inventory_movements m WHERE m.item_id = i.id), 0) <= i.min_quantity')
    ]).then(function (r) {
      return { status: 200, body: {
        clients: r[0].rows[0].n,
        open_projects: r[1].rows[0].n,
        unpaid_invoices: r[2].rows[0].n,
        invoiced_ttc_ytd: r[3].rows[0].ttc,
        collected_ytd: r[4].rows[0].paid,
        appointments_next_7d: r[5].rows[0].n,
        items_below_reorder: r[6].rows[0].n
      } };
    });
  }
};

var reports = {
  revenue: function (ctx, client) {
    return client.query(
      "SELECT to_char(date_trunc('month', i.issued_on), 'YYYY-MM') AS month," +
      ' coalesce(sum(l.line_ht),0)::numeric(14,3) AS ht,' +
      ' coalesce(sum(l.line_ht * l.vat_rate/100),0)::numeric(14,3) AS vat,' +
      ' coalesce(sum(l.line_ht * (1 + l.vat_rate/100)),0)::numeric(14,3) AS ttc' +
      ' FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id' +
      " WHERE i.deleted_at IS NULL AND i.status <> 'cancelled'" +
      " GROUP BY 1 ORDER BY 1 DESC LIMIT 24"
    ).then(function (r) { return { status: 200, body: { months: r.rows } }; });
  },

  receivables: function (ctx, client) {
    return client.query(
      'SELECT i.id, i.number, i.client_id, c.name AS client_name, i.issued_on, i.due_on, i.status,' +
      ' coalesce(t.ttc,0)::numeric(14,3) AS total_ttc,' +
      ' coalesce(p.paid,0)::numeric(14,3) AS paid,' +
      ' (coalesce(t.ttc,0) - coalesce(p.paid,0))::numeric(14,3) AS balance' +
      ' FROM invoices i' +
      ' LEFT JOIN clients c ON c.id = i.client_id' +
      ' LEFT JOIN (SELECT invoice_id, sum(line_ht * (1 + vat_rate/100)) AS ttc' +
      '            FROM invoice_lines GROUP BY invoice_id) t ON t.invoice_id = i.id' +
      ' LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM payments GROUP BY invoice_id) p' +
      '        ON p.invoice_id = i.id' +
      " WHERE i.deleted_at IS NULL AND i.status IN ('sent','part_paid')" +
      ' ORDER BY i.due_on NULLS LAST, i.issued_on'
    ).then(function (r) {
      var open = r.rows.reduce(function (a, x) { return a + Number(x.balance); }, 0);
      return { status: 200, body: { rows: r.rows, outstanding_total: open.toFixed(3) } };
    });
  },

  expenses: function (ctx, client) {
    return client.query(
      "SELECT to_char(date_trunc('month', e.spent_on), 'YYYY-MM') AS month," +
      ' ec.label AS category, coalesce(sum(e.amount),0)::numeric(14,3) AS amount' +
      ' FROM expenses e LEFT JOIN expense_categories ec ON ec.id = e.category_id' +
      ' WHERE e.deleted_at IS NULL GROUP BY 1,2 ORDER BY 1 DESC, 3 DESC LIMIT 200'
    ).then(function (r) { return { status: 200, body: { rows: r.rows } }; });
  }
};

var settings = {
  read: function (ctx, client) {
    return Promise.all([
      tenancy.tenantSettings(client),
      client.query('SELECT module_key, enabled FROM tenant_modules ORDER BY module_key')
    ]).then(function (r) {
      return { status: 200, body: { tenant: r[0], modules: r[1].rows } };
    });
  },

  /* Branding and identity a company owns. invoice_next_seq is deliberately not
     settable through the API: moving a counter backwards manufactures duplicate
     invoice numbers, and that is a decision for a migration, not a form. */
  update: function (ctx, client) {
    var allowed = ['display_name', 'legal_name', 'logo_storage_key', 'brand_primary',
      'brand_accent', 'locale', 'timezone', 'currency', 'invoice_prefix',
      'invoice_pattern', 'tax_identifier', 'address', 'settings'];
    var b = ctx.body || {};
    var params = [];
    var sets = [];
    allowed.forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return;
      params.push(k === 'settings' ? JSON.stringify(b[k]) : b[k]);
      sets.push('"' + k + '" = $' + params.length + (k === 'settings' ? '::jsonb' : ''));
    });
    if (!sets.length) return Promise.resolve({ status: 422, body: { error: 'nothing to update' } });
    for (var i = 0; i < params.length; i++) {
      if (typeof params[i] === 'string' && /^brand_/.test(allowed[i])) { /* checked below */ }
    }
    if (b.brand_primary && !/^#[0-9a-f]{6}$/i.test(String(b.brand_primary))) {
      return Promise.resolve({ status: 422, body: { error: 'brand_primary must be #rrggbb' } });
    }
    if (b.brand_accent && !/^#[0-9a-f]{6}$/i.test(String(b.brand_accent))) {
      return Promise.resolve({ status: 422, body: { error: 'brand_accent must be #rrggbb' } });
    }
    // No tenant id in the WHERE clause: RLS restricts this UPDATE to the one
    // row this transaction may see, which is the active tenant's.
    return client.query('UPDATE tenants SET ' + sets.join(', ') + ' RETURNING id', params)
      .then(function (r) {
        return {
          status: 200, body: { updated: true },
          audit: { action: 'tenant.updated', entity_table: 'tenants',
                   entity_id: (r.rows[0] || {}).id, detail: { fields: sets.length } }
        };
      });
  },

  setModule: function (ctx, client) {
    var b = ctx.body || {};
    if (tenancy.MODULES.indexOf(b.module_key) < 0) {
      return Promise.resolve({ status: 422, body: { error: 'unknown module' } });
    }
    var enabled = b.enabled !== false;
    return client.query(
      'INSERT INTO tenant_modules (tenant_id, module_key, enabled) VALUES ($1,$2,$3)' +
      ' ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled',
      [ctx.tenantId, b.module_key, enabled]
    ).then(function () {
      return {
        status: 200, body: { module_key: b.module_key, enabled: enabled },
        audit: { action: enabled ? 'module.enabled' : 'module.disabled',
                 entity_table: 'tenant_modules', detail: { module_key: b.module_key } }
      };
    });
  }
};

var users = {
  /* Members of THIS tenant only. tenant_memberships is RLS-scoped, so the join
     cannot reach a user who is not a member here — a global user list would
     otherwise be a directory of every customer's staff. */
  list: function (ctx, client) {
    return client.query(
      'SELECT u.id, u.email, u.display_name, u.is_active, u.last_login_at, tm.status,' +
      " coalesce(array_agg(r.key) FILTER (WHERE r.key IS NOT NULL), '{}') AS roles" +
      ' FROM tenant_memberships tm' +
      ' JOIN users u ON u.id = tm.user_id' +
      ' LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = tm.tenant_id' +
      ' LEFT JOIN roles r ON r.id = ur.role_id' +
      ' WHERE u.deleted_at IS NULL' +
      ' GROUP BY u.id, u.email, u.display_name, u.is_active, u.last_login_at, tm.status' +
      ' ORDER BY u.display_name'
    ).then(function (r) { return { status: 200, body: { rows: r.rows } }; });
  },

  assignRole: function (ctx, client) {
    var b = ctx.body || {};
    return client.query('SELECT id FROM roles WHERE key = $1', [b.role_key]).then(function (r) {
      var role = (r.rows || [])[0];
      if (!role) return { status: 422, body: { error: 'unknown role' } };
      // The INSERT is RLS-checked: a user_roles row for another tenant is
      // refused by the database, so this cannot grant access elsewhere.
      return client.query(
        'INSERT INTO user_roles (user_id, tenant_id, role_id) VALUES ($1,$2,$3)' +
        ' ON CONFLICT DO NOTHING', [b.user_id, ctx.tenantId, role.id]
      ).then(function () {
        return {
          status: 200, body: { assigned: true },
          audit: { action: 'role.assigned', entity_table: 'user_roles', entity_id: b.user_id,
                   detail: { role: b.role_key } }
        };
      });
    });
  }
};

var auditView = {
  list: function (ctx, client) {
    var q = ctx.query || {};
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 100, 1), 500);
    var params = [];
    var where = [];
    if (q.action) { params.push(q.action); where.push('action = $' + params.length); }
    if (q.entity_table) { params.push(q.entity_table); where.push('entity_table = $' + params.length); }
    return client.query(
      'SELECT id, occurred_at, actor_label, action, entity_table, entity_id, outcome, detail, ip' +
      ' FROM audit_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY occurred_at DESC LIMIT ' + limit, params
    ).then(function (r) { return { status: 200, body: { rows: r.rows } }; });
  }
};

module.exports = { dashboard: dashboard, reports: reports, settings: settings, users: users, audit: auditView };
