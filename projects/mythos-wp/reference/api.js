'use strict';
// =====================================================
// MYTHOS WP — API route table
// projects/mythos-wp/reference/api.js
//
// Every route is declared once with: method, path pattern, required role
// ('any' = authenticated, 'operator', 'owner', or false for the two public
// routes) and a handler(req, res, ctx). server.js resolves the session,
// enforces the role and the CSRF rule for state-changing methods, parses
// the JSON body and calls the handler; handlers return a value (200) or
// throw { code, status } (mapped to one error shape).
//
// Project scope: `?project=<id>` (or the :project path segment) selects
// the registry row; the handler receives ctx.resolved = { project,
// catalogPool, wpPool }.
// =====================================================

var url = require('url');
var db = require('./db');
var auth = require('./auth');
var resources = require('./resources');
var crud = require('./crud');
var audit = require('./audit');
var store = require('./projects-store');
var dashboard = require('./dashboard');
var search = require('./search');
var autoreply = require('./autoreply');
var receiver = require('./comms/receiver');
var inbox = require('./comms/inbox');
var outbound = require('./comms/outbound');
var assistant = require('./comms/assistant');
var commsBus = require('./comms/bus');

var VERSION = require('../package.json').version;
var fail = crud.fail;

function q(req) { return url.parse(req.url, true).query || {}; }

function projectFrom(req, params) {
  var id = (params && params.project) || q(req).project;
  if (!id) return Promise.resolve(null);
  return store.resolve(String(id)).then(function (r) { if (!r) throw fail('not_found', 404, 'unknown project'); return r; });
}

function resourceOr404(key) {
  var r = resources.get(key);
  if (!r) throw fail('not_found', 404, 'unknown resource');
  return r;
}

function poolFor(r, resolved) {
  if (r.scope === 'wp') return db.wp();
  if (!resolved) throw fail('project_required', 400, 'a project is required for catalogue resources');
  if (!resolved.catalogPool) throw fail('catalog_unavailable', 503, 'catalogue connection not configured for this project (' + (resolved.catalogError || 'unknown') + ')');
  return resolved.catalogPool;
}

function crudCtx(req, r, resolved) {
  if (r.scope === 'catalog' && !resolved) throw fail('project_required', 400, 'a project is required for catalogue resources');
  if (r.scope === 'wp' && !r.global && !r.projectOptional && !resolved) throw fail('project_required', 400, 'a project is required for this resource');
  return {
    pool: poolFor(r, resolved), auditPool: db.wp(),
    project: resolved ? resolved.project : null,
    session: req.session, actor: req.session.username, hasRole: auth.hasRole,
    requestId: req.requestId, client: req.socket.remoteAddress
  };
}

function requireRead(req, r) {
  if (!auth.hasRole(req.session, r.permissions.read || 'operator')) throw fail('forbidden', 403, 'insufficient role');
}

function parseFilters(query) {
  var out = {};
  Object.keys(query).forEach(function (k) { var m = /^f\.([a-z_]+)$/.exec(k); if (m) out[m[1]] = query[k]; });
  return out;
}

// merged product-centric views (catalogue rows + panel overlay by uid)
function overlayView(resolved, kind, query) {
  var r = resources.get('products');
  var ctx = { pool: poolFor(r, resolved), project: resolved.project };
  var filters = parseFilters(query);
  return crud.list(r, ctx, { page: query.page, limit: query.limit, sort: query.sort, dir: query.dir, search: query.q, filters: filters }).then(function (page) {
    var uids = page.rows.map(function (x) { return x.product_uid; });
    var table = kind === 'pricing' ? 'wp_product_commercial' : 'wp_stock';
    return resolved.wpPool.query('SELECT * FROM ' + table + ' WHERE project_id = $1 AND product_uid = ANY($2::text[])', [resolved.project.id, uids]).then(function (o) {
      var by = {};
      o.rows.forEach(function (row) { by[row.product_uid] = row; });
      page.rows = page.rows.map(function (p) {
        var ov = by[p.product_uid] || null;
        var base = { id: p.id, product_uid: p.product_uid, canonical_reference: p.canonical_reference, product_title: p.product_title, product_brand: p.product_brand, status: p.status, catalogue_price: p.price_tnd, catalogue_availability: p.availability, currency: p.currency };
        if (kind === 'pricing') {
          base.purchase_price = ov ? ov.purchase_price : null; base.selling_price = ov ? ov.selling_price : null; base.selling_currency = ov ? ov.currency : null;
          base.margin = ov && ov.selling_price !== null && ov.purchase_price !== null ? Number((Number(ov.selling_price) - Number(ov.purchase_price)).toFixed(2)) : null;
          base.margin_pct = base.margin !== null && Number(ov.selling_price) > 0 ? Number((base.margin / Number(ov.selling_price) * 100).toFixed(1)) : null;
          base.price_state = ov && ov.selling_price !== null ? 'verified' : 'unknown';
          base.updated_at = ov ? ov.updated_at : null; base.updated_by = ov ? ov.updated_by : null;
        } else {
          base.quantity = ov ? ov.quantity : null; base.min_quantity = ov ? ov.min_quantity : null; base.availability = ov ? ov.availability : 'unknown'; base.location = ov ? ov.location : null; base.lead_time_days = ov ? ov.lead_time_days : null;
          base.stock_state = !ov || ov.availability === 'unknown' ? 'unknown' : (ov.quantity <= ov.min_quantity && ov.availability !== 'unavailable' ? 'low' : 'verified');
          base.updated_at = ov ? ov.updated_at : null; base.updated_by = ov ? ov.updated_by : null;
        }
        return base;
      });
      return page;
    });
  });
}

function referencesView(resolved, query) {
  var r = resources.get('products');
  var ctx = { pool: poolFor(r, resolved), project: resolved.project };
  var filters = parseFilters(query);
  return crud.list(r, ctx, { page: query.page, limit: query.limit, sort: query.sort || 'canonical_reference', dir: query.dir || 'asc', search: query.q, filters: filters }).then(function (page) {
    page.rows = page.rows.map(function (p) {
      var specs = p.technical_specs || {};
      return { id: p.id, product_uid: p.product_uid, canonical_reference: p.canonical_reference, oem_reference: p.oem_reference, pair_reference: p.pair_reference, oe_from_specs: specs['pour numéro OE'] || specs['OE'] || null, product_brand: p.product_brand, product_title: p.product_title, status: p.status, reference_state: p.oem_reference ? 'complete' : 'missing_oem' };
    });
    return page;
  });
}

// the full record view of one part: catalogue row + fitments + images + overlays + knowledge + history
function productFull(resolved, uid) {
  var r = resources.get('products');
  var ctx = { pool: poolFor(r, resolved), project: resolved.project };
  return crud.getByUid(r, ctx, uid).then(function (p) {
    if (!p) throw fail('not_found', 404, 'no such part');
    return Promise.all([
      ctx.pool.query('SELECT c.*, m.model_name, m.generation_code FROM sya_product_vehicle_compatibility c LEFT JOIN sya_vehicle_models m ON m.id = c.vehicle_model_id WHERE c.product_id = $1 ORDER BY m.model_name, c.year_from', [p.id]),
      ctx.pool.query('SELECT * FROM sya_product_images WHERE product_id = $1 ORDER BY position, id', [p.id]),
      resolved.wpPool.query('SELECT * FROM wp_product_commercial WHERE project_id = $1 AND product_uid = $2', [resolved.project.id, uid]),
      resolved.wpPool.query('SELECT * FROM wp_stock WHERE project_id = $1 AND product_uid = $2', [resolved.project.id, uid]),
      resolved.wpPool.query('SELECT id, kind, title, language, status, allowed_for_auto_reply, updated_at FROM wp_knowledge WHERE project_id = $1 AND product_uid = $2 ORDER BY updated_at DESC', [resolved.project.id, uid]),
      audit.history(resolved.wpPool, 'products', p.id, 30),
      resolved.wpPool.query("SELECT id, status, reason, intent, created_at FROM wp_handoffs WHERE project_id = $1 AND related_product_uid = $2 AND status <> 'RESOLVED' ORDER BY created_at DESC LIMIT 10", [resolved.project.id, uid])
    ]).then(function (x) {
      var commercial = x[2].rows[0] || null, stock = x[3].rows[0] || null;
      return {
        product: p, compatibility: x[0].rows, images: x[1].rows, commercial: commercial, stock: stock, knowledge: x[4].rows, history: x[5], open_handoffs: x[6].rows,
        auto_reply_facts: {
          price: commercial && commercial.selling_price !== null ? 'VERIFIED' : 'UNKNOWN',
          stock: stock && stock.availability !== 'unknown' ? 'VERIFIED' : 'UNKNOWN',
          compatibility: x[0].rows.length ? 'VERIFIED' : 'UNKNOWN',
          oem_reference: p.oem_reference ? 'VERIFIED' : 'UNKNOWN'
        }
      };
    });
  });
}

// ---------------------------------------------------------------- handlers

var ROUTES = [
  // --- session ---------------------------------------------------------
  { method: 'POST', path: /^\/api\/login$/, role: false, csrf: false, handler: function (req, res, ctx) {
    if (!auth.loginAllowed(req)) throw fail('throttled', 429, 'too many failed attempts; try again later');
    var body = ctx.body || {};
    var v = auth.verifyCredentials(body.username, body.password);
    if (!v.ok) {
      auth.recordLoginFailure(req);
      audit.record(db.wp(), { actor: auth.USERNAME_RE.test(String(body.username || '').toLowerCase()) ? String(body.username).toLowerCase() : 'invalid', action: 'login_failed', resource: 'session', request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
      if (v.reason === 'invalid') throw fail('unauthorized', 401, 'invalid credentials');
      throw fail('auth_unavailable', 503, 'authentication is not configured');
    }
    auth.clearLoginFailures(req);
    var s = auth.createSession(v.user);
    ctx.setCookie(auth.sessionCookie(s.id));
    audit.record(db.wp(), { actor: v.user.username, role: v.user.role, action: 'login', resource: 'session', request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
    return { username: v.user.username, role: v.user.role, expires_at: new Date(s.expiresAt).toISOString() };
  } },
  { method: 'POST', path: /^\/api\/logout$/, role: 'any', handler: function (req, res, ctx) {
    auth.destroySession(req.session.id);
    ctx.setCookie(auth.clearedCookie());
    audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'logout', resource: 'session', request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
    return { signed_out: true };
  } },
  { method: 'GET', path: /^\/api\/session$/, role: 'any', handler: function (req) {
    return { username: req.session.username, role: req.session.role, expires_at: new Date(req.session.expiresAt).toISOString() };
  } },

  // --- meta ------------------------------------------------------------
  { method: 'GET', path: /^\/api\/meta$/, role: 'any', handler: function (req) {
    return store.all().then(function (rows) {
      return {
        version: VERSION, product: 'MYTHOS WP',
        user: { username: req.session.username, role: req.session.role },
        roles: auth.ROLES,
        resources: resources.publicAll(), groups: resources.GROUPS,
        projects: rows.map(function (p) { return { id: p.id, display_name: p.display_name, domain: p.domain, status: p.status, kind: p.kind || 'automotive', currency: p.currency, catalog_configured: db.catalogConfigured(p) }; })
      };
    });
  } },

  // --- health ----------------------------------------------------------
  { method: 'GET', path: /^\/api\/health$/, role: 'any', handler: function () {
    var users = auth.usersState();
    return db.wp().query('SELECT 1').then(function () { return true; }, function () { return false; }).then(function (wpOk) {
      return store.all(true).then(function (rows) {
        return Promise.all(rows.map(function (p) {
          var configured = db.catalogConfigured(p);
          if (!configured) return { id: p.id, catalog_configured: false, catalog_reachable: null };
          return db.catalog(p).query('SELECT 1').then(function () { return { id: p.id, catalog_configured: true, catalog_reachable: true }; }, function (e) { return { id: p.id, catalog_configured: true, catalog_reachable: false, error: e && e.code ? String(e.code) : 'ERROR' }; });
        })).then(function (cats) {
          return {
            ok: wpOk, version: VERSION, node: process.version, uptime_s: Math.round(process.uptime()), rss_mb: Math.round(process.memoryUsage().rss / 1048576),
            database: { wp: wpOk, catalogues: cats },
            auth: { users_provisioned: users.provisioned, users_reason: users.reason, users_count: users.count, session_ttl_ms: auth.ttlMs() },
            comms_config: autoreply.loadConfig().present ? 'present' : 'absent'
          };
        });
      }, function () { return { ok: false, version: VERSION, database: { wp: wpOk, catalogues: [] }, auth: { users_provisioned: users.provisioned, users_reason: users.reason } }; });
    });
  } },

  // --- generic resources ---------------------------------------------
  { method: 'GET', path: /^\/api\/r\/([a-z_]+)$/, role: 'any', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    requireRead(req, r);
    var query = q(req);
    return projectFrom(req).then(function (resolved) {
      return crud.list(r, crudCtx(req, r, resolved), { page: query.page, limit: query.limit, sort: query.sort, dir: query.dir, search: query.q, filters: parseFilters(query) });
    });
  } },
  { method: 'GET', path: /^\/api\/r\/([a-z_]+)\/lookup$/, role: 'any', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    requireRead(req, r);
    var query = q(req);
    return projectFrom(req).then(function (resolved) {
      return crud.lookup(r, crudCtx(req, r, resolved), { search: query.q, ids: query.ids ? String(query.ids).split(',') : null, display: query.display, by: query.by });
    });
  } },
  { method: 'GET', path: /^\/api\/r\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'any', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    requireRead(req, r);
    return projectFrom(req).then(function (resolved) {
      var c = crudCtx(req, r, resolved);
      return crud.get(r, c, ctx.params[2]).then(function (row) {
        return audit.history(db.wp(), r.key, row[r.idColumn], 20).then(function (h) { return { row: row, history: h }; });
      });
    });
  } },
  { method: 'POST', path: /^\/api\/r\/([a-z_]+)$/, role: 'operator', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    return projectFrom(req).then(function (resolved) {
      return crud.create(r, crudCtx(req, r, resolved), ctx.body).then(function (o) { if (r.key === 'projects') store.invalidate(); ctx.status(201); return o; });
    });
  } },
  { method: 'PATCH', path: /^\/api\/r\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'operator', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    return projectFrom(req).then(function (resolved) {
      var body = ctx.body || {};
      // Handoff resolution stamps: set by the server, never by the client.
      if (r.key === 'handoffs' && body.status === 'RESOLVED') {
        return crud.update(r, crudCtx(req, r, resolved), ctx.params[2], body).then(function (o) {
          return db.wp().query('UPDATE wp_handoffs SET resolved_by = $1, resolved_at = now() WHERE id = $2 AND project_id = $3 RETURNING *', [req.session.username, o.row.id, resolved.project.id]).then(function (u) { o.row = u.rows[0] || o.row; return o; });
        });
      }
      return crud.update(r, crudCtx(req, r, resolved), ctx.params[2], body).then(function (o) { if (r.key === 'projects') store.invalidate(); return o; });
    });
  } },
  { method: 'DELETE', path: /^\/api\/r\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'operator', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[1]);
    return projectFrom(req).then(function (resolved) {
      return crud.remove(r, crudCtx(req, r, resolved), ctx.params[2]).then(function (o) { if (r.key === 'projects') store.invalidate(); return o; });
    });
  } },

  // --- project-centric views -------------------------------------------
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/dashboard$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return dashboard.build(resolved); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/pricing$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return overlayView(resolved, 'pricing', q(req)); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/stock$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return overlayView(resolved, 'stock', q(req)); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/references$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return referencesView(resolved, q(req)); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/parts\/([A-Za-z0-9._:-]+)$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return productFull(resolved, ctx.params[2]); });
  } },
  { method: 'PUT', path: /^\/api\/projects\/([a-z0-9-]+)\/overlay\/(commercial|stock)\/([A-Za-z0-9._:-]+)$/, role: 'operator', handler: function (req, res, ctx) {
    var r = resourceOr404(ctx.params[2]);
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var products = resources.get('products');
      return crud.getByUid(products, { pool: poolFor(products, resolved), project: resolved.project }, ctx.params[3]).then(function (p) {
        if (!p) throw fail('not_found', 404, 'no such part in the catalogue');
        return crud.upsertByUid(r, crudCtx(req, r, resolved), ctx.params[3], ctx.body);
      });
    });
  } },
  { method: 'GET', path: /^\/api\/search$/, role: 'any', handler: function (req) {
    return projectFrom(req).then(function (resolved) {
      if (!resolved) throw fail('project_required', 400, 'a project is required');
      return search.search(resolved, q(req).q);
    });
  } },

  // --- Communication OS: inbox / conversations / contacts / tags / SSE ----
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var qq = q(req);
      return inbox.scope(db.wp(), req.session.username).then(function (scope) {
        return Promise.all([inbox.listConversations(db.wp(), resolved.project.id, { status: qq.status, assigned: qq.assigned, username: req.session.username, inbox: qq.inbox, tag: qq.tag, q: qq.q, before: qq.before, limit: qq.limit, scope: scope }), inbox.counts(db.wp(), resolved.project.id, scope)])
          .then(function (x) { return { items: x[0].items, next_before: x[0].next_before, counts: x[1], scoped: scope !== null }; });
      });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.getConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), scope); }); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/messages$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { var qq = q(req); return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.getConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), scope).then(function () { return inbox.listMessages(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), { before_id: qq.before_id, limit: qq.limit }); }); }); });
  } },
  // --- AI assistant (suggest-only) ------------------------------------
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/suggest$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10);
      return assistant.suggest(db.wp(), resolved, cid, req.session.username, { message_id: ctx.body && ctx.body.message_id, trigger: 'manual' }).then(function (out) {
        ctx.status(201);
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'create', resource: 'ai_runs', record_id: String(out.run_id), project_id: resolved.project.id, next: { conversation_id: cid, decision: out.decision, intent: out.intent, confidence: out.confidence }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return out;
      });
    });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/suggestions$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return assistant.listSuggestions(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10)); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/suggestions\/([0-9]+)\/decide$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10), sid = parseInt(ctx.params[3], 10);
      return assistant.decide(db.wp(), resolved.project.id, cid, sid, req.session.username, ctx.body || {}).then(function (out) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'ai_suggestions', record_id: String(sid), project_id: resolved.project.id, next: { action: (ctx.body || {}).action, conversation_id: cid }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return out;
      });
    });
  } },

  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/messages$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var cid = parseInt(ctx.params[2], 10);
      return outbound.send(db.wp(), resolved.project.id, cid, req.session.username, ctx.body || {}).then(function (r) {
        ctx.status(r.duplicate ? 200 : 201);
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'create', resource: 'messages', record_id: String(r.message_id), project_id: resolved.project.id, next: { conversation_id: cid, status: r.status, duplicate: r.duplicate, length: String((ctx.body || {}).text || '').length }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return r;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/messages\/([0-9]+)\/retry$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return outbound.retry(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username).then(function (r) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'messages', record_id: String(r.message_id), project_id: resolved.project.id, next: { retry: true, status: r.status }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return r;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/read$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.markRead(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username); });
  } },
  { method: 'PATCH', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return inbox.updateConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username, ctx.body || {}).then(function (row) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'conversations', record_id: String(row.id), project_id: resolved.project.id, next: ctx.body, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return row;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/notes$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { ctx.status(201); return inbox.addNote(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username, ctx.body && ctx.body.text); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, false); });
  } },
  { method: 'DELETE', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/conversations\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagConversation(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, true); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/tags$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.listTags(db.wp(), resolved.project.id); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/tags$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { ctx.status(201); return inbox.createTag(db.wp(), resolved.project.id, req.session.username, ctx.body || {}); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { var qq = q(req); return inbox.scope(db.wp(), req.session.username).then(function (scope) { return inbox.listContacts(db.wp(), resolved.project.id, { q: qq.q, status: qq.status, tag: qq.tag, limit: qq.limit, scope: scope }); }); });
  } },
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.getContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10)); });
  } },
  { method: 'PATCH', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return inbox.updateContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), req.session.username, ctx.body || {}).then(function (row) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'update', resource: 'contacts', record_id: String(row.id), project_id: resolved.project.id, next: ctx.body, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return row;
      });
    });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, false); });
  } },
  { method: 'DELETE', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/contacts\/([0-9]+)\/tags\/([0-9]+)$/, role: 'operator', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return inbox.tagContact(db.wp(), resolved.project.id, parseInt(ctx.params[2], 10), parseInt(ctx.params[3], 10), req.session.username, true); });
  } },
  // SSE: per-project change feed (types + ids only; never message text). Heartbeat every 25 s.
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/comms\/events$/, role: 'any', stream: true, handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      var pid = resolved.project.id;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 5000\n\n');
      var write = function (ev) { if (ev.project_id !== pid) return; try { res.write('event: ' + ev.type + '\ndata: ' + JSON.stringify(ev) + '\n\n'); } catch (e) { /* closed */ } };
      var hb = setInterval(function () { try { res.write(': hb\n\n'); } catch (e) { /* closed */ } }, 25000);
      commsBus.bus.on('comms', write);
      var done = function () { clearInterval(hb); commsBus.bus.removeListener('comms', write); };
      req.on('close', done); res.on('close', done);
    });
  } },

  // --- Communication providers: contract status + capabilities (non-secret) ---
  { method: 'GET', path: /^\/api\/comms\/providers$/, role: 'any', handler: function () {
    var reg = receiver.registry;
    return { providers: reg.all().map(function (p) { return { id: p.id, describe: p.describe(), capabilities: p.capabilities() }; }) };
  } },

  // --- Multi-service: the caller's inbox memberships (visibility scope) ---
  { method: 'GET', path: /^\/api\/comms\/my-inboxes$/, role: 'any', handler: function (req) {
    return inbox.memberships(db.wp(), req.session.username).then(function (rows) { return { username: req.session.username, scoped: rows.length > 0, inboxes: rows }; });
  } },

  // --- Communication Receiver status (non-secret) ---------------------
  { method: 'GET', path: /^\/api\/comms\/receiver$/, role: 'any', handler: function () {
    var d = receiver.describe();
    return db.wp().query("SELECT id, project_id, provider, instance, status, inbound_enabled, outbound_enabled, last_event_at FROM wp_inboxes ORDER BY id").then(function (r) {
      return { receiver: d, inboxes: r.rows };
    }, function () { return { receiver: d, inboxes: [] }; });
  } },

  // --- Auto-Reply control centre ---------------------------------------
  { method: 'GET', path: /^\/api\/projects\/([a-z0-9-]+)\/autoreply\/status$/, role: 'any', handler: function (req, res, ctx) {
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) { return autoreply.status(resolved); });
  } },
  { method: 'POST', path: /^\/api\/projects\/([a-z0-9-]+)\/autoreply\/simulate$/, role: 'operator', handler: function (req, res, ctx) {
    var text = ctx.body && typeof ctx.body.text === 'string' ? ctx.body.text : '';
    if (!text.trim()) throw fail('validation', 400, 'text is required', { errors: { text: 'required' } });
    return projectFrom(req, { project: ctx.params[1] }).then(function (resolved) {
      return autoreply.simulate(resolved, text).then(function (out) {
        audit.record(db.wp(), { actor: req.session.username, role: req.session.role, action: 'simulate', resource: 'autoreply', project_id: resolved.project.id, next: { intent: out.intent, action: out.action, outcome: out.outcome, verified: out.facts.verified, unknown: out.facts.unknown }, request_id: req.requestId, client: req.socket.remoteAddress }).catch(function () {});
        return out;
      });
    });
  } },
  { method: 'GET', path: /^\/api\/audit\/([a-z_]+)\/([A-Za-z0-9._:-]+)$/, role: 'any', handler: function (req, res, ctx) {
    return audit.history(db.wp(), ctx.params[1], ctx.params[2], q(req).limit).then(function (h) { return { history: h }; });
  } }
];

module.exports = { ROUTES: ROUTES, VERSION: VERSION, overlayView: overlayView, referencesView: referencesView, productFull: productFull };
