'use strict';

/* Mission orders ("Ordres de mission") — Phase 4 (P1). A vehicle/driver
 * dispatch sheet, faithfully scoped to what the legacy system actually
 * proves is required: no client/project/event link, no amount, no approval
 * workflow, no numbering scheme (the row's own id is the identifier, same
 * as legacy's `'om_' + Date.now()`). See db/0010-mission-orders.sql's header
 * for the full rationale.
 *
 * driver_id optionally links to collaborators (reuse, not a duplicate
 * personnel entity); driver_name/cin/license are kept as plain fields on
 * the row because a mission's driver credentials are a fact about that trip,
 * not something that should force a hard dependency on collaborator record
 * hygiene. passengers is a small JSONB roster (name only) — there is
 * nothing to compute per passenger, only a list to print.
 *
 * No accounting effect, no invoice/payment link: purely operational.
 */

var MISSION_TYPES = ['aller_retour', 'aller_simple'];

var COLUMNS = ['id', 'driver_id', 'driver_name', 'driver_cin', 'driver_license', 'vehicle_plate',
  'mission_type', 'mission', 'departure_location', 'arrival_location', 'starts_at', 'ends_at',
  'add_stamp', 'passengers', 'notes', 'created_by', 'created_at', 'updated_at'];

var SETTABLE = ['driver_id', 'driver_name', 'driver_cin', 'driver_license', 'vehicle_plate',
  'mission_type', 'mission', 'departure_location', 'arrival_location', 'starts_at', 'ends_at',
  'add_stamp', 'passengers', 'notes'];

function cols(list) { return list.map(function (c) { return '"' + c + '"'; }).join(','); }

function validPassengers(v) {
  if (!Array.isArray(v)) return false;
  return v.every(function (p) {
    return p && typeof p === 'object' && typeof p.name === 'string' && p.name.trim().length > 0;
  });
}

function validateHeader(body, partial) {
  var b = body || {};
  var out = {};
  SETTABLE.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(b, f)) out[f] = b[f];
  });
  if (out.mission_type !== undefined && MISSION_TYPES.indexOf(String(out.mission_type)) < 0) {
    return { ok: false, error: 'mission_type must be one of ' + MISSION_TYPES.join('|') };
  }
  ['starts_at', 'ends_at'].forEach(function (f) {
    if (out[f] !== undefined && out[f] !== null && isNaN(Date.parse(out[f]))) out.__bad = f;
  });
  if (out.__bad) return { ok: false, error: out.__bad + ' must be a valid date/time' };
  delete out.__bad;
  if (out.ends_at && out.starts_at && new Date(out.ends_at) < new Date(out.starts_at)) {
    return { ok: false, error: 'ends_at precedes starts_at' };
  }
  if (out.passengers !== undefined && !validPassengers(out.passengers)) {
    return { ok: false, error: 'passengers must be an array of {name}' };
  }
  if (out.add_stamp !== undefined) out.add_stamp = !!out.add_stamp;
  var required = ['driver_name', 'vehicle_plate', 'mission', 'departure_location', 'arrival_location', 'starts_at'];
  if (!partial) {
    for (var i = 0; i < required.length; i++) {
      if (!out[required[i]]) return { ok: false, error: required[i] + ' is required' };
    }
  }
  return { ok: true, value: out };
}

function checkDriver(client, driverId) {
  if (!driverId) return Promise.resolve(true);
  return client.query('SELECT 1 FROM collaborators WHERE id = $1 AND deleted_at IS NULL', [driverId])
    .then(function (r) { return r.rows.length > 0; });
}

function hydrate(client, row) {
  if (!row.driver_id) return Promise.resolve(Object.assign({}, row, { driver: null }));
  return client.query('SELECT id, full_name, role_label FROM collaborators WHERE id = $1', [row.driver_id])
    .then(function (r) { return Object.assign({}, row, { driver: r.rows[0] || null }); });
}

var handlers = {
  list: function (ctx, client) {
    var q = ctx.query || {};
    var limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 200);
    var offset = Math.max(parseInt(q.offset, 10) || 0, 0);
    var where = ['deleted_at IS NULL'];
    var params = [];
    if (q.driver_id) { params.push(q.driver_id); where.push('driver_id = $' + params.length); }
    if (q.from) { params.push(q.from); where.push('starts_at >= $' + params.length); }
    if (q.to) { params.push(q.to); where.push('starts_at <= $' + params.length); }
    if (q.search) {
      params.push('%' + q.search + '%');
      where.push('(driver_name ILIKE $' + params.length + ' OR vehicle_plate ILIKE $' + params.length +
        ' OR departure_location ILIKE $' + params.length + ' OR arrival_location ILIKE $' + params.length + ')');
    }
    params.push(limit, offset);
    return client.query(
      'SELECT ' + cols(COLUMNS) + ' FROM mission_orders WHERE ' + where.join(' AND ') +
      ' ORDER BY starts_at DESC LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length, params
    ).then(function (r) {
      return client.query('SELECT count(*)::int AS n FROM mission_orders WHERE ' + where.join(' AND '), params.slice(0, params.length - 2))
        .then(function (c) { return { status: 200, body: { rows: r.rows, total: c.rows[0].n, limit: limit, offset: offset } }; });
    });
  },

  get: function (ctx, client) {
    return client.query('SELECT ' + cols(COLUMNS) + ' FROM mission_orders WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        var row = (r.rows || [])[0];
        if (!row) return { status: 404, body: { error: 'not_found' } };
        return hydrate(client, row).then(function (full) { return { status: 200, body: full }; });
      });
  },

  create: function (ctx, client) {
    var h = ctx.input;
    return checkDriver(client, h.driver_id).then(function (ok) {
      if (!ok) return { status: 422, body: { error: 'invalid_reference', detail: 'unknown driver_id' } };
      var input = Object.assign({}, h);
      if (input.passengers !== undefined) input.passengers = JSON.stringify(input.passengers);
      var cIn = ['tenant_id', 'created_by'].concat(Object.keys(input));
      var params = [ctx.tenantId, ctx.user.id].concat(Object.keys(input).map(function (k) { return input[k]; }));
      return client.query(
        'INSERT INTO mission_orders (' + cols(cIn) + ') VALUES (' +
        params.map(function (_, i) { return '$' + (i + 1); }).join(',') + ')' +
        ' RETURNING ' + cols(COLUMNS), params
      ).then(function (r) {
        var row = r.rows[0];
        return hydrate(client, row).then(function (full) {
          return {
            status: 201, body: full,
            audit: { action: 'record.created', entity_table: 'mission_orders', entity_id: row.id,
                     detail: { driver_name: row.driver_name, vehicle_plate: row.vehicle_plate, starts_at: row.starts_at } }
          };
        });
      });
    });
  },

  update: function (ctx, client) {
    var h = ctx.input;
    return client.query('SELECT id FROM mission_orders WHERE id = $1 AND deleted_at IS NULL', [ctx.id])
      .then(function (r) {
        if (!(r.rows || []).length) return { status: 404, body: { error: 'not_found' } };
        var checkD = h.driver_id !== undefined ? checkDriver(client, h.driver_id).then(function (ok) {
          return ok ? null : { status: 422, body: { error: 'invalid_reference', detail: 'unknown driver_id' } };
        }) : Promise.resolve(null);
        return checkD.then(function (bad) {
          if (bad) return bad;
          var input = Object.assign({}, h);
          if (input.passengers !== undefined) input.passengers = JSON.stringify(input.passengers);
          var p = [ctx.id];
          var sets = Object.keys(input).map(function (k) { p.push(input[k]); return '"' + k + '" = $' + p.length; });
          var step = sets.length ? client.query('UPDATE mission_orders SET ' + sets.join(',') + ' WHERE id = $1', p) : Promise.resolve();
          return step
            .then(function () { return client.query('SELECT ' + cols(COLUMNS) + ' FROM mission_orders WHERE id = $1', [ctx.id]); })
            .then(function (r2) { return hydrate(client, r2.rows[0]); })
            .then(function (full) {
              return {
                status: 200, body: full,
                audit: { action: 'record.updated', entity_table: 'mission_orders', entity_id: ctx.id, detail: { fields: Object.keys(h) } }
              };
            });
        });
      });
  }
  // No retire/archive handler: the 'production' module has no delete
  // permission in the catalogue (schema-auth.sql only seeds production.read
  // and production.write) — see server.js's routing comment for the full
  // reasoning. Not implemented here rather than exposed unreachable.
};

module.exports = { MISSION_TYPES: MISSION_TYPES, COLUMNS: COLUMNS, validateHeader: validateHeader, handlers: handlers };
