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
// GET responses still exclude that scope.
//
// IDA-2E-PRE replaced the single undifferentiated placeholder token with
// projects/idauto/reference/identity.js's minimal admin-identity map —
// see that file's header for exactly what this is and is not. Full IDA-2E
// (real Mythos OS auth service integration per docs/IDAUTO_ARCHITECTURE.md
// §4.1) remains blocked: no such service exists anywhere in this
// codebase. requireAuth() now resolves a real identity string per request
// (req.mythosIdentity) instead of a boolean match against one shared
// token, and every write handler passes it through to writes.js so audit
// records carry the authenticated identity, never the raw bearer token.
//
// IDA-2F added object-storage wiring: POST/GET /api/observations/:id/media,
// backed by projects/idauto/reference/storage.js (local, content-addressed
// filesystem storage — not a cloud service; see that file's header for
// why). The write goes through writes.js's withAudit() exactly like every
// other mutation. The read (like every other GET in this file) still
// excludes mythos_private-scope rows — unchanged policy, not relaxed by
// adding a new resource type.
// =====================================================

var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var db = require('./db.js');
var writes = require('./writes.js');
var identity = require('./identity.js');
var storage = require('./storage.js');

function requireAuth(req, res) {
  var header = req.headers['authorization'] || '';
  var match = /^Bearer (.+)$/.exec(header);
  var token = match ? match[1] : null;
  var resolved = identity.resolveIdentity(token);
  if (!resolved) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized — a recognized admin identity token is required' }));
    return false;
  }
  req.mythosIdentity = resolved;
  return true;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function notFound(res) {
  sendJson(res, 404, { error: 'not found' });
}

var ADMIN_ASSETS = {
  '/admin': { file: 'admin.html', contentType: 'text/html; charset=utf-8' },
  '/admin/': { file: 'admin.html', contentType: 'text/html; charset=utf-8' },
  '/admin/admin-ui.js': { file: 'admin-ui.js', contentType: 'application/javascript; charset=utf-8' },
  '/admin/admin.css': { file: 'admin.css', contentType: 'text/css; charset=utf-8' }
};

// The admin shell contains no data or credentials. API calls made by the
// page still pass through requireAuth() below; the bearer token is held only
// in page memory and is never written to browser storage.
function serveAdminAsset(req, res, pathname) {
  var asset = ADMIN_ASSETS[pathname];
  if (!asset || req.method !== 'GET') return false;
  fs.readFile(path.join(__dirname, asset.file), function (err, content) {
    if (err) return sendJson(res, 500, { error: 'admin UI unavailable' });
    res.writeHead(200, {
      'Content-Type': asset.contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    res.end(content);
  });
  return true;
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

// GET /api/observations/:id/media
// Metadata only — object_key is a local storage reference, never a
// fetchable URL, and this endpoint never streams file bytes (no UI, no
// image-serving path exists in this stage). Excludes mythos_private-scope
// rows, same policy as every other read in this file (default access_scope
// on this table is 'mythos_private' per schema.sql, so most rows are
// excluded unless a caller explicitly chose a wider scope on write).
async function getObservationMedia(res, id) {
  if (!/^\d+$/.test(id)) return notFound(res);
  var obs = await db.query('SELECT id FROM idauto_observations WHERE id = $1', [id]);
  if (obs.rows.length === 0) return notFound(res);
  var result = await db.query(
    'SELECT id, media_type, mime_type, file_size_bytes, image_hash, access_scope, blurred, retention_status, created_at ' +
    'FROM idauto_observation_media WHERE observation_id = $1 AND access_scope != $2 ORDER BY created_at',
    [id, 'mythos_private']
  );
  sendJson(res, 200, { observation_id: parseInt(id, 10), media: result.rows });
}

// Reads and JSON-parses the request body, capped at 64KB (this API's
// JSON-bodied routes take small admin-entry payloads only; file/image
// uploads use readBinaryBody() below instead, with its own larger cap).
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

// Reads a raw binary body, capped at storage.MAX_UPLOAD_BYTES (distinct
// cap from readJsonBody's 64KB — this endpoint carries file bytes, not a
// small admin-entry payload).
function readBinaryBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > storage.MAX_UPLOAD_BYTES) {
        reject(Object.assign(new Error('payload too large — max ' + (storage.MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB'), { httpStatus: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// POST /api/observations/:id/media
// Body is the raw file content. Content-Type header is the mime type.
// Optional X-Idauto-Media-Type / X-Idauto-Access-Scope headers (both
// validated + defaulted in writes.js) — kept out of the body since the
// body IS the file, not JSON, matching this being a binary-upload
// endpoint rather than a JSON one like every other write route.
async function postObservationMedia(req, res, observationId) {
  if (!/^\d+$/.test(observationId)) return notFound(res);
  var buffer = await readBinaryBody(req);
  var mimeType = (req.headers['content-type'] || '').split(';')[0].trim();
  var body = {
    media_type: req.headers['x-idauto-media-type'],
    access_scope: req.headers['x-idauto-access-scope'],
    blurred: req.headers['x-idauto-blurred'] === 'true'
  };
  var record = await writes.createObservationMedia(observationId, buffer, mimeType, body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/vehicles
async function postVehicle(req, res) {
  var body = await readJsonBody(req);
  var record = await writes.createVehicle(body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/plates
async function postPlate(req, res) {
  var body = await readJsonBody(req);
  if (!body.plate_number || !body.format_code) {
    return sendJson(res, 400, { error: 'plate_number and format_code are required' });
  }
  var record = await writes.createPlate(body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/observations
async function postObservation(req, res) {
  var body = await readJsonBody(req);
  if (!body.vehicle_internal_ref) {
    return sendJson(res, 400, { error: 'vehicle_internal_ref is required' });
  }
  var record = await writes.createObservation(body, req.mythosIdentity);
  sendJson(res, 201, record);
}

// POST /api/vehicles/:internal_ref/facts
async function postFact(req, res, internalRef) {
  var body = await readJsonBody(req);
  if (!body.fact_key || typeof body.fact_value === 'undefined') {
    return sendJson(res, 400, { error: 'fact_key and fact_value are required' });
  }
  var record = await writes.createFact(internalRef, body, req.mythosIdentity);
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
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)\/media$/, handler: function (req, res, m) { return getObservationMedia(res, decodeURIComponent(m[1])); } },
  { method: 'POST', pattern: /^\/api\/observations\/([^/]+)\/media$/, handler: function (req, res, m) { return postObservationMedia(req, res, decodeURIComponent(m[1])); } },
  { method: 'GET', pattern: /^\/api\/observations\/([^/]+)$/, handler: function (req, res, m) { return getObservation(res, decodeURIComponent(m[1])); } },
  { method: 'POST', pattern: /^\/api\/observations$/, handler: function (req, res) { return postObservation(req, res); } },
  { method: 'GET', pattern: /^\/api\/facts\/([^/]+)\/evidence$/, handler: function (req, res, m) { return getEvidenceForFact(res, decodeURIComponent(m[1])); } }
];

function createServer() {
  return http.createServer(function (req, res) {
    var parsed = url.parse(req.url);
    var pathname = parsed.pathname;

    if (serveAdminAsset(req, res, pathname)) return;
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
