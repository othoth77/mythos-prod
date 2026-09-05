'use strict';
// =====================================================
// MYTHOS WP — generic CRUD over the resource registry
// projects/mythos-wp/reference/crud.js
//
// One implementation of list / get / create / update / remove for every
// resource in resources.js — the `dataProvider` half of the headless pattern.
//
// SQL SAFETY. Identifiers (table, columns, join fragments, sort column,
// filter expressions) are taken ONLY from the registry, which is a closed,
// code-reviewed object; every value from a request is a $n parameter. A
// sort or filter name that is not in the registry is refused, not escaped.
//
// SCOPE. `wp` resources carry project_id and every statement is fenced by
// it (or, for `global` resources such as projects, not at all). `catalog`
// resources are fenced by the connection itself: the pool is the project's
// catalogue database with search_path pinned to its schema.
//
// AUDIT. create / update / remove record a wp_audit_events row (audit.js)
// with the actor from the session. Reads are not audited.
//
// ERRORS are thrown as { code, status, detail } and mapped by api.js:
//   validation (400) · not_found (404) · conflict (409, unique) ·
//   referenced (409, FK) · constraint (400, CHECK) · forbidden (403).
// =====================================================

var validate = require('./validate');
var audit = require('./audit');

var MAX_LIMIT = 200;
var DEFAULT_LIMIT = 25;

function fail(code, status, detail, extra) {
  var e = new Error(code); e.code = code; e.status = status; e.detail = detail || null;
  if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

function fieldByName(r, name) {
  for (var i = 0; i < r.fields.length; i++) if (r.fields[i].name === name) return r.fields[i];
  return null;
}

// The SQL expression for a field name: a joined column for virtual fields,
// the table column otherwise. Refuses anything not in the registry.
function columnExpr(r, name) {
  var f = fieldByName(r, name);
  if (!f) return null;
  if (f.virtual) return f.sql || null;
  return 't."' + f.name + '"';
}

function selectList(r) {
  var cols = ['t.*'];
  r.fields.forEach(function (f) { if (f.virtual && f.sql) cols.push(f.sql + ' AS "' + f.name + '"'); });
  return cols.join(', ');
}

function fromClause(r) {
  var s = r.table + ' t';
  (r.joins || []).forEach(function (j) { s += ' ' + j.sql; });
  return s;
}

// A search column may be written 'alias.col' (joined) or 'col' (table).
function searchExpr(col) {
  return /^[a-z]+\./.test(col) ? col : 't."' + col + '"';
}

function scopeWhere(r, ctx, params) {
  if (r.scope !== 'wp' || r.global) return [];
  if (!ctx.project) {
    if (r.projectOptional) return [];
    throw fail('project_required', 400, 'a project is required for this resource');
  }
  params.push(ctx.project.id);
  return ['t.project_id = $' + params.length];
}

// list(r, ctx, q) → { rows, total, page, limit, sort, dir }
//   ctx = { pool, project, actor }   q = { page, limit, sort, dir, search, filters }
function list(r, ctx, q) {
  q = q || {};
  var params = [];
  var where = scopeWhere(r, ctx, params);

  if (q.search && String(q.search).trim()) {
    params.push('%' + String(q.search).trim().slice(0, 200) + '%');
    var n = params.length;
    where.push('(' + r.search.map(function (c) { return searchExpr(c) + '::text ILIKE $' + n; }).join(' OR ') + ')');
  }
  var filters = q.filters || {};
  Object.keys(filters).forEach(function (name) {
    var f = null;
    for (var i = 0; i < r.filters.length; i++) if (r.filters[i].name === name) f = r.filters[i];
    if (!f) throw fail('validation', 400, 'unknown filter: ' + name, { errors: { filter: name } });
    var v = filters[name];
    if (v === undefined || v === null || v === '') return;
    if (f.kind === 'flag') { if (v === true || v === 'true' || v === '1') where.push(f.sql); return; }
    if (f.enum && f.enum.indexOf(String(v)) === -1) throw fail('validation', 400, 'filter value not allowed: ' + name, { errors: { filter: name } });
    params.push(f.boolean ? (String(v) === 'true') : String(v));
    where.push('t."' + f.field + '"' + (f.boolean ? '' : '::text') + ' = $' + params.length);
  });

  var sortName = q.sort || r.defaultSort.field;
  var sortField = fieldByName(r, sortName);
  if (!sortField || (!sortField.sortable && sortName !== r.defaultSort.field && sortName !== r.idColumn)) throw fail('validation', 400, 'cannot sort by ' + sortName, { errors: { sort: 'not_sortable' } });
  var dir = String(q.dir || r.defaultSort.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  var order = columnExpr(r, sortName) + ' ' + dir + ' NULLS LAST, t."' + r.idColumn + '" ' + dir;

  var limit = Math.min(Math.max(parseInt(q.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  var page = Math.max(parseInt(q.page, 10) || 1, 1);
  var whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';

  var countSql = 'SELECT count(*)::int AS n FROM ' + fromClause(r) + whereSql;
  var rowsSql = 'SELECT ' + selectList(r) + ' FROM ' + fromClause(r) + whereSql + ' ORDER BY ' + order + ' LIMIT ' + limit + ' OFFSET ' + ((page - 1) * limit);
  return Promise.all([ctx.pool.query(countSql, params), ctx.pool.query(rowsSql, params)]).then(function (res) {
    return { rows: res[1].rows, total: res[0].rows[0].n, page: page, limit: limit, sort: sortName, dir: dir.toLowerCase() };
  });
}

function idParam(r, id) {
  if ((r.idType || 'integer') === 'integer') {
    var n = parseInt(String(id), 10);
    if (!/^\d{1,15}$/.test(String(id)) || n < 1) throw fail('not_found', 404, 'no such record');
    return n;
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(id))) throw fail('not_found', 404, 'no such record');
  return String(id);
}

function get(r, ctx, id) {
  var params = [idParam(r, id)];
  var where = ['t."' + r.idColumn + '" = $1'].concat(scopeWhere(r, ctx, params));
  return ctx.pool.query('SELECT ' + selectList(r) + ' FROM ' + fromClause(r) + ' WHERE ' + where.join(' AND '), params).then(function (res) {
    if (!res.rows.length) throw fail('not_found', 404, 'no such record');
    return res.rows[0];
  });
}

// Same as get, but by the stable external identifier (product_uid, …).
function getByUid(r, ctx, uid) {
  if (!r.uidColumn) throw fail('not_found', 404, 'no such record');
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(String(uid))) throw fail('not_found', 404, 'no such record');
  var params = [String(uid)];
  var where = ['t."' + r.uidColumn + '" = $1'].concat(scopeWhere(r, ctx, params));
  return ctx.pool.query('SELECT ' + selectList(r) + ' FROM ' + fromClause(r) + ' WHERE ' + where.join(' AND ') + ' LIMIT 1', params).then(function (res) {
    return res.rows.length ? res.rows[0] : null;
  });
}

function requireWrite(r, ctx, op) {
  var need = op === 'delete' ? (r.permissions.delete || null) : (r.permissions.write || null);
  if (!need) throw fail('forbidden', 403, 'this resource is read-only');
  if (!ctx.session || !ctx.hasRole(ctx.session, need)) throw fail('forbidden', 403, 'requires role ' + need);
}

// A `defaultValue: 'now'` on a timestamp means "now" at create time.
function applyDefaults(r, value) {
  r.fields.forEach(function (f) {
    if (f.readonly || f.virtual) return;
    if (value[f.name] === undefined && f.defaultValue === 'now' && f.type === 'timestamp') value[f.name] = new Date().toISOString();
  });
}

function runCheck(r, value, existing) {
  if (typeof r.check !== 'function') return;
  var errs = r.check(value, existing || null);
  if (errs && Object.keys(errs).length) throw fail('validation', 400, 'invalid data', { errors: errs });
}

function sqlValue(f, v) {
  if (v === null || v === undefined) return null;
  if (f.type === 'json') return JSON.stringify(v);
  return v;
}

function mapPgError(e) {
  if (!e || !e.code) return e;
  var constraint = e.constraint || null;
  if (e.code === '23505') return fail('conflict', 409, 'a record with the same unique value already exists', { constraint: constraint });
  if (e.code === '23503') return fail('referenced', 409, 'referenced by other records, or the reference does not exist', { constraint: constraint });
  if (e.code === '23514') return fail('constraint', 400, 'rejected by a data constraint', { constraint: constraint });
  if (e.code === '23502') return fail('validation', 400, 'a required column is missing', { column: e.column || null });
  if (e.code === '22P02' || e.code === '22003' || e.code === '22001') return fail('validation', 400, 'a value has the wrong shape for its column');
  if (e.code === '42P01') return fail('catalog_unavailable', 503, 'the catalogue table does not exist in this connection');
  if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === '57P03' || e.code === '28P01' || e.code === '3D000') return fail('database_unavailable', 503, 'the database is not reachable');
  return e;
}

function create(r, ctx, payload) {
  requireWrite(r, ctx, 'write');
  var v = validate.validate(r.fields, payload || {}, 'create');
  if (!v.ok) return Promise.reject(fail('validation', 400, 'invalid data', { errors: v.errors }));
  var value = v.value;
  applyDefaults(r, value);
  runCheck(r, value, null);
  // A required field may be missing entirely on create when it has no default.
  var missing = {};
  r.fields.forEach(function (f) { if (f.required && !f.readonly && !f.virtual && (value[f.name] === undefined || value[f.name] === null)) missing[f.name] = 'required'; });
  if (Object.keys(missing).length) return Promise.reject(fail('validation', 400, 'invalid data', { errors: missing }));

  var cols = [], vals = [], params = [];
  Object.keys(value).forEach(function (k) {
    var f = fieldByName(r, k);
    cols.push('"' + k + '"'); params.push(sqlValue(f, value[k])); vals.push('$' + params.length);
  });
  if (r.scope === 'wp' && !r.global) { cols.push('project_id'); params.push(ctx.project.id); vals.push('$' + params.length); }
  if (r.managed && r.managed.updated_by === 'actor') { cols.push('updated_by'); params.push(ctx.actor); vals.push('$' + params.length); }
  var sql = 'INSERT INTO ' + r.table + ' (' + cols.join(', ') + ') VALUES (' + vals.join(', ') + ') RETURNING *';
  return ctx.pool.query(sql, params).then(function (res) {
    var row = res.rows[0];
    return audit.record(ctx.auditPool, { actor: ctx.actor, role: ctx.session.role, action: 'create', resource: r.key, record_id: row[r.idColumn], project_id: ctx.project ? ctx.project.id : null, changed_fields: Object.keys(value), previous: null, next: row, request_id: ctx.requestId, client: ctx.client })
      .then(function (audited) { return { row: row, audited: audited }; });
  }, function (e) { throw mapPgError(e); });
}

function update(r, ctx, id, payload) {
  requireWrite(r, ctx, 'write');
  var v = validate.validate(r.fields, payload || {}, 'update');
  if (!v.ok) return Promise.reject(fail('validation', 400, 'invalid data', { errors: v.errors }));
  var value = v.value;
  var immutable = {};
  r.fields.forEach(function (f) { if (f.createOnly && value[f.name] !== undefined) immutable[f.name] = 'create_only'; });
  if (Object.keys(immutable).length) return Promise.reject(fail('validation', 400, 'invalid data', { errors: immutable }));
  if (!Object.keys(value).length) return Promise.reject(fail('validation', 400, 'nothing to update', { errors: { _: 'empty' } }));

  return get(r, ctx, id).then(function (existing) {
    runCheck(r, value, existing);
    var sets = [], params = [];
    Object.keys(value).forEach(function (k) {
      var f = fieldByName(r, k);
      params.push(sqlValue(f, value[k])); sets.push('"' + k + '" = $' + params.length);
    });
    if (r.managed && r.managed.updated_at === 'now') sets.push('updated_at = now()');
    if (r.managed && r.managed.updated_by === 'actor') { params.push(ctx.actor); sets.push('updated_by = $' + params.length); }
    params.push(existing[r.idColumn]);
    var where = ['"' + r.idColumn + '" = $' + params.length];
    if (r.scope === 'wp' && !r.global) { params.push(ctx.project.id); where.push('project_id = $' + params.length); }
    var sql = 'UPDATE ' + r.table + ' SET ' + sets.join(', ') + ' WHERE ' + where.join(' AND ') + ' RETURNING *';
    return ctx.pool.query(sql, params).then(function (res) {
      var row = res.rows[0];
      var d = audit.diff(existing, row);
      // Server-managed columns are not a change the actor made.
      Object.keys(r.managed || {}).forEach(function (k) { d.fields = d.fields.filter(function (x) { return x !== k; }); if (d.previous) delete d.previous[k]; if (d.next) delete d.next[k]; });
      return audit.record(ctx.auditPool, { actor: ctx.actor, role: ctx.session.role, action: 'update', resource: r.key, record_id: row[r.idColumn], project_id: ctx.project ? ctx.project.id : null, changed_fields: d.fields, previous: d.previous, next: d.next, request_id: ctx.requestId, client: ctx.client })
        .then(function (audited) { return { row: row, audited: audited, changed: d.fields }; });
    }, function (e) { throw mapPgError(e); });
  });
}

// remove: soft (status column) or hard, per the registry.
function remove(r, ctx, id) {
  requireWrite(r, ctx, 'delete');
  return get(r, ctx, id).then(function (existing) {
    var params = [existing[r.idColumn]];
    var where = ['"' + r.idColumn + '" = $1'];
    if (r.scope === 'wp' && !r.global) { params.push(ctx.project.id); where.push('project_id = $' + params.length); }
    var sql, action = 'delete';
    if (r.delete && r.delete.kind === 'soft') {
      params.push(r.delete.value);
      sql = 'UPDATE ' + r.table + ' SET "' + r.delete.field + '" = $' + params.length + (r.managed && r.managed.updated_at === 'now' ? ', updated_at = now()' : '') + ' WHERE ' + where.join(' AND ') + ' RETURNING *';
    } else {
      sql = 'DELETE FROM ' + r.table + ' WHERE ' + where.join(' AND ') + ' RETURNING *';
    }
    return ctx.pool.query(sql, params).then(function (res) {
      var row = res.rows[0] || null;
      var soft = r.delete && r.delete.kind === 'soft';
      return audit.record(ctx.auditPool, { actor: ctx.actor, role: ctx.session.role, action: action, resource: r.key, record_id: existing[r.idColumn], project_id: ctx.project ? ctx.project.id : null, changed_fields: soft ? [r.delete.field] : Object.keys(existing), previous: existing, next: soft ? { status: r.delete.value } : null, request_id: ctx.requestId, client: ctx.client })
        .then(function (audited) { return { row: row, audited: audited, soft: soft }; });
    }, function (e) { throw mapPgError(e); });
  });
}

// Upsert of a product-keyed overlay (commercial, stock) by product_uid.
function upsertByUid(r, ctx, uid, payload) {
  requireWrite(r, ctx, 'write');
  if (!r.uidColumn) return Promise.reject(fail('validation', 400, 'resource has no external identifier'));
  return getByUid(r, ctx, uid).then(function (existing) {
    if (existing) return update(r, ctx, existing[r.idColumn], payload).then(function (o) { o.created = false; return o; });
    var body = Object.assign({}, payload || {});
    body[r.uidColumn] = uid;
    return create(r, ctx, body).then(function (o) { o.created = true; return o; });
  });
}

// Small lookup for reference selects: [{ id, label }], by search text or ids.
function lookup(r, ctx, q) {
  var display = q.display || r.titleField;
  if (!fieldByName(r, display) || fieldByName(r, display).virtual) display = r.titleField;
  var by = q.by && fieldByName(r, q.by) && !fieldByName(r, q.by).virtual ? q.by : r.idColumn;
  var params = [];
  var where = scopeWhere(r, ctx, params);
  if (q.ids && q.ids.length) {
    params.push(q.ids.slice(0, 200).map(String));
    where.push('t."' + by + '"::text = ANY($' + params.length + '::text[])');
  } else if (q.search) {
    params.push('%' + String(q.search).slice(0, 100) + '%');
    var n = params.length;
    where.push('(' + r.search.map(function (c) { return searchExpr(c) + '::text ILIKE $' + n; }).join(' OR ') + ')');
  }
  var extra = r.key === 'products' ? ', t.product_title AS title, t.product_brand AS brand' : '';
  var sql = 'SELECT t."' + by + '" AS id, t."' + display + '" AS label' + extra + ' FROM ' + fromClause(r) + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY 2 ASC LIMIT 25';
  return ctx.pool.query(sql, params).then(function (res) { return res.rows; }, function (e) { throw mapPgError(e); });
}

module.exports = {
  MAX_LIMIT: MAX_LIMIT,
  DEFAULT_LIMIT: DEFAULT_LIMIT,
  fail: fail,
  mapPgError: mapPgError,
  fieldByName: fieldByName,
  list: list,
  get: get,
  getByUid: getByUid,
  create: create,
  update: update,
  remove: remove,
  upsertByUid: upsertByUid,
  lookup: lookup
};
