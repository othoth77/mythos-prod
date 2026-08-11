'use strict';
// =====================================================
// MYTHOS — ID Auto API — projects/idauto/reference/api.js
// (renamed from api-read.js in IDA-2D — see git history — because this
// file is no longer read-only)
//
// IDA-2C (original scope): GET-only, placeholder admin gate, excludes
// mythos_private data (no audit-on-read path existed).
//
// IDA-2D added: write routes (POST /api/vehicles, /api/plates,
// /api/observations, /api/vehicles/:ref/facts), each going through
// projects/idauto/reference/writes.js's withAudit() — every mutation
// creates its idauto_audit_log row in the same transaction, atomically.
// Reads are UNCHANGED from IDA-2C, including the mythos_private exclusion
// — writes are now audited (satisfying AD-9), but reads still are not, so
// GET responses still exclude that scope. The placeholder admin gate
// (IDAUTO_ADMIN_PLACEHOLDER_TOKEN) is preserved unchanged and still guards
// every route, read or write — IDA-2E replaces it with real Mythos OS auth.
// =====================================================

var http = require('http');
var url = require('url');
var db = require('./db.js');
var writes = require('./writes.js');

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

// Reads and JSON-parses the request body, capped at 64KB (this API takes
// small admin-entry payloads only — not file/image uploads, which remain
// out of scope, see IDA-2F object storage wiring).
function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > 65536) {
        reject(Object.assign(new Error('payload too large'), { httpStatus: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error('invalid JSON body'), { httpStatus: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// POST /api/vehicles
async function postVehicle(req, res) {
  var body = await readJsonBody(req);
  var record = await writes.createVehicle(body);
  sendJson(res, 201, record);
}

// POST /api/plates
async function postPlate(req, res) {
  var body = await readJsonBody(req);
  if (!body.plate_number || !body.format_code) {
    return sendJson(res, 400, { error: 'plate_number and format_code are required' });
  }
  var record = await writes.createPlate(body);
  sendJson(res, 201, record);
}

// POST /api/observations
async function postObservation(req, res) {
  var body = await readJsonBody(req);
  if (!body.vehicle_internal_ref) {
    return sendJson(res, 400, { error: 'vehicle_internal_ref is required' });
  }
  var record = await writes.createObservation(body);
  sendJson(res, 201, record);
}

// POST /api/vehicles/:internal_ref/facts
async function postFact(req, res, internalRef) {
  var body = await readJsonBody(req);
  if (!body.fact_key || typeof body.fact_value === 'undefined') {
    return sendJson(res, 400, { error: 'fact_key and fact_value are required' });
  }
  var record = await writes.createFact(internalRef, body);
  sendJson(res, 201, record);
}

var ROUTES = [
  { method: 'GET', pattern: /^\/health$/, handler: function (req, res) { return getHealth(res); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (req, res, m) { return getFactsForVehicle(res, decodeURIComponent(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles\/([^/]+)\/facts$/, handler: function (req, res, m) { return postFact(req, res, decodeURIComponent(m[1])); } },
  { method: 'GET', pattern: /^\/api\/vehicles\/([^/]+)$/, handler: function (req, res, m) { return getVehicle(res, decodeURIComponent(m[1])); } },
  { method: 'POST', pattern: /^\/api\/vehicles$/, handler: function (req, res) { return postVehicle(req, res); } },
  { method: 'GET', pattern: /^\/api\/plates\/([^/]+)$/, handler: function (req, res, m) { return getPlate(res, decodeURIComponent(m[1])); } },
  { method: 'POST', pattern: /^\/api\/plates$/, handler: function (req, res) { return postPlate(req, res); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)$/, handler: function (req, res, m) { return getObservation(res, decodeURIComponent(m[1])); } },
  { method: 'POST', pattern: /^\/api\/observations$/, handler: function (req, res) { return postObservation(req, res); } },
  { method: 'GET', pattern: /^\/api\/facts\/([^/]+)\/evidence$/, handler: function (req, res, m) { return getEvidenceForFact(res, decodeURIComponent(m[1])); } }
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
      var allowed = matchedPath.map(function (r) { return r.method; }).join(', ');
      res.writeHead(405, { 'Content-Type': 'application/json', 'Allow': allowed });
      return res.end(JSON.stringify({ error: 'method not allowed' }));
    }

    var route = matchedMethod[0];
    var m = pathname.match(route.pattern);
    Promise.resolve(route.handler(req, res, m)).catch(function (err) {
      if (err.httpStatus) return sendJson(res, err.httpStatus, { error: err.message });
      // Never include the raw driver error message in the response — it
      // can echo back query fragments or connection detail. mapDbError()
      // translates known Postgres error codes to a safe, specific message;
      // anything unrecognized falls through to a generic 500.
      var mapped = writes.mapDbError(err);
      sendJson(res, mapped.status, { error: mapped.error });
    });
  });
}

if (require.main === module) {
  var port = parseInt(process.env.IDAUTO_API_PORT || '3001', 10);
  createServer().listen(port, '127.0.0.1', function () {
    console.log('ID Auto API listening on 127.0.0.1:' + port);
  });
}

module.exports = { createServer: createServer };
