'use strict';
// =====================================================
// MYTHOS WP — project registry access
// projects/mythos-wp/reference/projects-store.js
//
// Reads wp_projects and hands out, per project, the pair of pools the rest
// of the panel needs: the project's catalogue pool (db.catalog) and the
// panel pool (db.wp). Rows are cached for a short time so a request does
// not hit the registry table twice; a write through the `projects`
// resource calls invalidate().
// =====================================================

var db = require('./db');

var CACHE_MS = 15000;
var cache = { at: 0, rows: null };

function all(force) {
  var now = Date.now();
  if (!force && cache.rows && now - cache.at < CACHE_MS) return Promise.resolve(cache.rows);
  return db.wp().query('SELECT * FROM wp_projects ORDER BY id').then(function (r) {
    cache = { at: Date.now(), rows: r.rows };
    return r.rows;
  });
}

function invalidate() { cache = { at: 0, rows: null }; }

function get(id) {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(id || ''))) return Promise.resolve(null);
  return all().then(function (rows) {
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
    return null;
  });
}

// resolve(id) → { project, catalogPool | null, wpPool, catalogError } | null
function resolve(id) {
  return get(id).then(function (project) {
    if (!project) return null;
    var out = { project: project, wpPool: db.wp(), catalogPool: null, catalogError: null };
    try { out.catalogPool = db.catalog(project); } catch (e) { out.catalogError = e.code || 'CATALOG_ERROR'; }
    return out;
  });
}

module.exports = { all: all, get: get, resolve: resolve, invalidate: invalidate };
