'use strict';
// =====================================================
// MYTHOS — ID Auto Stage IDA-2C — read-only API
// projects/idauto/reference/api-read.js
//
// Scope (enforced, not just documented):
//   - GET only. Every other HTTP method gets 405, including on routes
//     that otherwise match — there is no code path in this file capable
//     of writing to the database (db.js's query() is called with SELECT
//     statements only, all of them below, all parameterized).
//   - No `mythos_private`-scope data is ever returned, and no field
//     documented in schema.sql as "always MYTHOS_PRIVATE" (observation
//     capture_time, exact location, contributor/session identity, IP
//     hashes, raw OCR output, images) is ever included in a response.
//     This is a deliberate IDA-2C restriction, not a Phase-B-final
//     policy: the schema's own AD-9 enforcement rule requires
//     mythos_private access to be audit-logged on every access, and
//     IDA-2C explicitly has no audit-writing path yet (that is IDA-2D).
//     Exposing private-scope data here would violate the documented
//     policy this codebase already committed to. IDA-2D (write + audit
//     logging) or a later slice should revisit this restriction once
//     audit logging exists.
//   - Auth: a PLACEHOLDER admin gate only (static bearer token from
//     IDAUTO_ADMIN_PLACEHOLDER_TOKEN). This is explicitly not real
//     Mythos OS auth — IDA-2E replaces it. Every route requires it,
//     including /health, so nothing is reachable unauthenticated.
// =====================================================

var http = require('http');
var url = require('url');
var db = require('./db.js');

function requireAuth(req, res) {
  var header = req.headers['authorization'] || '';
  var expected = process.env.IDAUTO_ADMIN_PLACEHOLDER_TOKEN;
  if (!expected) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'server misconfigured: IDAUTO_ADMIN_PLACEHOLDER_TOKEN not set' }));
    return false;
  }
  if (header !== 'Bearer ' + expected) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized — placeholder admin token required (IDA-2E will replace this with real Mythos OS auth)' }));
    return false;
  }
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' });
}

// GET /api/vehicles/:internal_ref
// Public/professional-safe vehicle fields only. No owner fields exist in
// the schema at all (idauto_vehicles has none, by design — see AD-2).
async function getVehicle(res, internalRef) {
  var result = await db.query(
    'SELECT internal_ref, make, model, variant, year, body_type, fuel_type, colour, seats, ' +
    'gross_weight_kg, engine_cc, category_code, fiche_status, first_seen_at, last_seen_at, observation_count ' +
    'FROM idauto_vehicles WHERE internal_ref = $1',
    [internalRef]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/plates/:plate_number
// No owner fields exist in the schema (idauto_plates has none, by design).
async function getPlate(res, plateNumber) {
  var result = await db.query(
    'SELECT p.plate_number, p.format_code, g.name_fr AS governorate_name, p.status, ' +
    'p.vehicle_id, p.valid_from, p.valid_until ' +
    'FROM idauto_plates p LEFT JOIN idauto_governorates g ON g.id = p.governorate_id ' +
    'WHERE p.plate_number = $1',
    [plateNumber]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/observations/:id
// Deliberately excludes capture_time, plate_candidate, ocr_confidence,
// ip_hash, camera_source_id, contributor_id, capture_session_id — all
// documented in schema.sql as MYTHOS_PRIVATE or contributor/session
// identity. Returns only status-shaped fields safe without audit logging.
async function getObservation(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var result = await db.query(
    'SELECT id, vehicle_id, plate_id, capture_method, status ' +
    'FROM idauto_observations WHERE id = $1',
    [id]
  );
  if (result.rows.length === 0) return notFound(res);
  sendJson(res, 200, result.rows[0]);
}

// GET /api/vehicles/:vehicle_internal_ref/facts
// Filters access_scope != 'mythos_private' at the query level — the same
// enforcement point the schema's own design intends for this column.
async function getFactsForVehicle(res, internalRef) {
  var vehicle = await db.query('SELECT id FROM idauto_vehicles WHERE internal_ref = $1', [internalRef]);
  if (vehicle.rows.length === 0) return notFound(res);
  var result = await db.query(
    'SELECT fact_key, fact_value, fact_value_normalized, confidence_score, verification_status, ' +
    'access_scope, is_active, first_seen_at, last_seen_at ' +
    'FROM idauto_vehicle_facts WHERE vehicle_id = $1 AND access_scope != $2 ORDER BY fact_key',
    [vehicle.rows[0].id, 'mythos_private']
  );
  sendJson(res, 200, { vehicle_internal_ref: internalRef, facts: result.rows });
}

// GET /api/facts/:fact_id/evidence
async function getEvidenceForFact(res, factId) {
  if (!/^\d+$/.test(factId)) return notFound(res);
  var fact = await db.query('SELECT id, access_scope FROM idauto_vehicle_facts WHERE id = $1', [factId]);
  if (fact.rows.length === 0) return notFound(res);
  if (fact.rows[0].access_scope === 'mythos_private') return notFound(res);
  var result = await db.query(
    'SELECT evidence_type, weight, created_at FROM idauto_fact_evidence WHERE fact_id = $1 ORDER BY created_at',
    [factId]
  );
  sendJson(res, 200, { fact_id: parseInt(factId, 10), evidence: result.rows });
}

async function getHealth(res) {
  await db.query('SELECT 1');
  sendJson(res, 200, { status: 'ok' });
}

var ROUTES = [
  { method: 'GET', pattern: /^\/health$/, handler: function (res) { return getHealth(res); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (res, m) { return getFactsForVehicle(res, decodeURIComponent(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)$/, handler: function (res, m) { return getVehicle(res, decodeURIComponent(m[1])); } },
  { method: 'GET', pattern: /^\/api\/plates\/([^/]+)$/, handler: function (res, m) { return getPlate(res, decodeURIComponent(m[1])); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)$/, handler: function (res, m) { return getObservation(res, decodeURIComponent(m[1])); } },
  { method: 'GET', pattern: /^\/api\/facts\/([^/]+)\/evidence$/, handler: function (res, m) { return getEvidenceForFact(res, decodeURIComponent(m[1])); } }
];

function createServer() {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url);
    var pathname = parsed.pathname;

    if (!requireAuth(req, res)) return;

    var matchedPath = ROUTES.filter(function (r) { return r.pattern.test(pathname); });
    if (matchedPath.length === 0) return notFound(res);

    var matchedMethod = matchedPath.filter(function (r) { return r.method === req.method; });
    if (matchedMethod.length === 0) {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': 'GET' });
      return res.end(JSON.stringify({ error: 'method not allowed — this API is read-only (IDA-2C)' }));
    }

    var route = matchedMethod[0];
    var m = pathname.match(route.pattern);
    Promise.resolve(route.handler(res, m)).catch(function (err) {
      // Never include err.message in the response — driver errors can
      // echo back query fragments or connection detail.
      sendJson(res, 500, { error: 'internal error' });
    });
  });
}

if (require.main === module) {
  var port = parseInt(process.env.IDAUTO_API_PORT || '3001', 10);
  createServer().listen(port, '127.0.0.1', function () {
    console.log('IDA-2C read-only API listening on 127.0.0.1:' + port);
  });
}

module.exports = { createServer: createServer };
