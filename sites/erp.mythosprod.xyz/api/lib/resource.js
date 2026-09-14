'use strict';

/* Declarative tenant-safe CRUD.
 *
 * Every module's list/get/create/update/retire goes through here, which means
 * the properties below are true for all of them at once instead of eleven
 * times over:
 *
 *   - Column names come from the DEFINITION, never from the request. A
 *     ?sort=<anything> cannot name a column that the module did not declare,
 *     so there is no identifier interpolation to get wrong.
 *   - Values are always bind parameters. There is no code path that builds SQL
 *     by concatenating a value.
 *   - tenant_id is never accepted from input and never settable. It is stamped
 *     from the request context, and RLS refuses the row if they disagree — so
 *     a forged tenant_id in a body is rejected twice, once by this layer and
 *     once by PostgreSQL.
 *   - Nothing is hard-deleted. Retiring sets deleted_at, matching the schema's
 *     rule that the ERP never destroys business records.
 *   - Every mutation returns an audit descriptor, which the pipeline requires.
 */

var MAX_PAGE = 200;
var DEFAULT_PAGE = 50;

function ident(name) {
  // Belt and braces: definitions are code, but a typo must not become a SQL
  // injection the day someone builds a definition from config.
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('unsafe identifier: ' + name);
  return '"' + name + '"';
}

function pick(def, body) {
  var out = {};
  def.fields.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(body || {}, f)) out[f] = body[f];
  });
  return out;
}

function validate(def, body, partial) {
  var value = pick(def, body || {});
  if (!partial) {
    for (var i = 0; i < def.required.length; i++) {
      var r = def.required[i];
      if (value[r] === undefined || value[r] === null || value[r] === '') {
        return { ok: false, error: r + ' is required' };
      }
    }
  }
  if (def.check) {
    var problem = def.check(value, partial);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, value: value };
}

function list(def, client, query) {
  var q = query || {};
  var limit = Math.min(Math.max(parseInt(q.limit, 10) || DEFAULT_PAGE, 1), MAX_PAGE);
  var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  var order = def.sortable.indexOf(q.sort) >= 0 ? q.sort : def.defaultSort;
  var dir = String(q.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  var where = ['deleted_at IS NULL'];
  var params = [];
  if (q.search && def.searchable.length) {
    params.push('%' + String(q.search) + '%');
    var idx = '$' + params.length;
    where.push('(' + def.searchable.map(function (c) {
      return ident(c) + '::text ILIKE ' + idx;
    }).join(' OR ') + ')');
  }
  (def.filters || []).forEach(function (f) {
    if (q[f] === undefined || q[f] === '') return;
    params.push(q[f]);
    where.push(ident(f) + ' = $' + params.length);
  });
  // Optional date/timestamp range on one declared column (def.range), for
  // calendar-shaped views. ?from / ?to are bind parameters like everything
  // else; a value that is not a plausible date is ignored rather than 500ing.
  var DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ][\d:.Z+-]+)?$/;
  if (def.range) {
    if (q.from && DATE_LIKE.test(String(q.from))) { params.push(q.from); where.push(ident(def.range) + ' >= $' + params.length); }
    if (q.to && DATE_LIKE.test(String(q.to))) {
      params.push(q.to);
      // A bare YYYY-MM-DD upper bound means "through the end of that day", not
      // midnight at its start — otherwise ?to=2026-09-06 would exclude every
      // event actually on the 6th (found in the Phase 10 E2E).
      where.push(String(q.to).length === 10
        ? ident(def.range) + ' < ($' + params.length + '::date + 1)'
        : ident(def.range) + ' <= $' + params.length);
    }
  }

  var cols = def.columns.map(ident).join(', ');
  var sql = 'SELECT ' + cols + ' FROM ' + ident(def.table) +
            ' WHERE ' + where.join(' AND ') +
            // NULLS LAST in both directions: a nullable sort column (score,
            // expected_value, next_action_on…) must not float empty rows to
            // the top of a descending list (Phase 8 E2E).
            ' ORDER BY ' + ident(order) + ' ' + dir + ' NULLS LAST' +
            ' LIMIT ' + limit + ' OFFSET ' + offset;
  return client.query(sql, params).then(function (r) {
    return client.query('SELECT count(*)::int AS n FROM ' + ident(def.table) +
                        ' WHERE ' + where.join(' AND '), params)
      .then(function (c) {
        return { rows: r.rows, total: (c.rows[0] || {}).n || 0, limit: limit, offset: offset };
      });
  });
}

function get(def, client, id) {
  return client.query(
    'SELECT ' + def.columns.map(ident).join(', ') + ' FROM ' + ident(def.table) +
    ' WHERE id = $1 AND deleted_at IS NULL', [id]
  ).then(function (r) { return (r.rows || [])[0] || null; });
}

function create(def, client, tenantId, value) {
  var cols = ['tenant_id'];
  var params = [tenantId];
  Object.keys(value).forEach(function (k) {
    cols.push(k);
    params.push(value[k]);
  });
  var placeholders = params.map(function (_, i) { return '$' + (i + 1); });
  return client.query(
    'INSERT INTO ' + ident(def.table) + ' (' + cols.map(ident).join(', ') + ')' +
    ' VALUES (' + placeholders.join(', ') + ') RETURNING ' + def.columns.map(ident).join(', '),
    params
  ).then(function (r) { return r.rows[0]; });
}

function update(def, client, id, value) {
  var keys = Object.keys(value);
  if (!keys.length) return get(def, client, id);
  var params = [id];
  var sets = keys.map(function (k) {
    params.push(value[k]);
    return ident(k) + ' = $' + params.length;
  });
  // No tenant_id in the WHERE clause on purpose: RLS already restricts this
  // statement to the active tenant. Adding it would suggest the filter is what
  // protects us, and invite someone to "optimise" it away later.
  return client.query(
    'UPDATE ' + ident(def.table) + ' SET ' + sets.join(', ') +
    ' WHERE id = $1 AND deleted_at IS NULL RETURNING ' + def.columns.map(ident).join(', '),
    params
  ).then(function (r) { return (r.rows || [])[0] || null; });
}

function retire(def, client, id) {
  return client.query(
    'UPDATE ' + ident(def.table) + ' SET deleted_at = now()' +
    ' WHERE id = $1 AND deleted_at IS NULL RETURNING id', [id]
  ).then(function (r) { return (r.rows || [])[0] || null; });
}

/* Build the four handlers the pipeline registers for a module. */
function handlers(def) {
  return {
    list: function (ctx, client) {
      return list(def, client, ctx.query).then(function (page) {
        return { status: 200, body: page };
      });
    },
    get: function (ctx, client) {
      return get(def, client, ctx.id).then(function (row) {
        // A row belonging to another tenant is invisible to this transaction,
        // so it is genuinely "not found" here — not "found but forbidden".
        // That is the correct answer and it leaks nothing about its existence.
        return row ? { status: 200, body: row } : { status: 404, body: { error: 'not_found' } };
      });
    },
    create: function (ctx, client) {
      return create(def, client, ctx.tenantId, ctx.input).then(function (row) {
        return {
          status: 201, body: row,
          audit: { action: 'record.created', entity_table: def.table, entity_id: row.id,
                   detail: { label: row[def.label] } }
        };
      });
    },
    update: function (ctx, client) {
      return update(def, client, ctx.id, ctx.input).then(function (row) {
        if (!row) return { status: 404, body: { error: 'not_found' }, audit: null };
        return {
          status: 200, body: row,
          audit: { action: 'record.updated', entity_table: def.table, entity_id: row.id,
                   detail: { fields: Object.keys(ctx.input) } }
        };
      });
    },
    retire: function (ctx, client) {
      return retire(def, client, ctx.id).then(function (row) {
        if (!row) return { status: 404, body: { error: 'not_found' }, audit: null };
        return {
          status: 200, body: { id: row.id, retired: true },
          audit: { action: 'record.deleted', entity_table: def.table, entity_id: row.id, detail: {} }
        };
      });
    }
  };
}

module.exports = {
  MAX_PAGE: MAX_PAGE,
  ident: ident,
  validate: validate,
  list: list, get: get, create: create, update: update, retire: retire,
  handlers: handlers
};
