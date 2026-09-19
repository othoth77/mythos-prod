'use strict';
// =====================================================
// MYTHOS WP V2 — internal notes (wp_notes)
// projects/mythos-wp/reference/notes.js
//
// Free-text notes an operator leaves on a contact, a conversation or a
// project. Conversation notes in the timeline stay activity messages
// (inbox.addNote); wp_notes is the side channel the Contacts 360 view and
// the project page read. Every row belongs to one project; a caller only
// ever sees the rows of the projects it may access (the route passes the
// accessible ids). Never a secret, never customer message text.
// =====================================================
var KINDS = ['contact', 'conversation', 'project'];
var MAX_BODY = 8000;
var LIMIT = 100;

function fail(code, status, detail, errors) { var e = new Error(detail || code); e.code = code; e.status = status; if (errors) e.errors = errors; return e; }
function clampInt(v, d, lo, hi) { var n = parseInt(v, 10); if (isNaN(n)) n = d; return Math.max(lo, Math.min(hi, n)); }

function validKind(k) { return KINDS.indexOf(String(k || '')) !== -1; }
function validTarget(id) { return /^[A-Za-z0-9._:-]{1,64}$/.test(String(id || '')); }

// list(pool, { kind, id, projects: [accessible ids], project?: id, limit })
//   → { items:[{ id, project_id, target_kind, target_id, author, body, created_at }] }
function list(pool, o) {
  o = o || {};
  if (!validKind(o.kind)) throw fail('validation', 400, 'kind must be contact|conversation|project', { kind: 'contact|conversation|project' });
  if (!validTarget(o.id)) throw fail('validation', 400, 'id is required', { id: 'required' });
  var ids = Array.isArray(o.projects) ? o.projects.map(String) : [];
  if (o.project) ids = ids.filter(function (p) { return p === String(o.project); });
  if (!ids.length) return Promise.resolve({ items: [] });
  return pool.query('SELECT id, project_id, target_kind, target_id, author, body, created_at FROM wp_notes WHERE target_kind = $1 AND target_id = $2 AND project_id = ANY($3::text[]) ORDER BY created_at DESC, id DESC LIMIT $4',
    [o.kind, String(o.id), ids, clampInt(o.limit, LIMIT, 1, 500)]).then(function (r) { return { items: r.rows }; });
}

// add(pool, actor, { kind, id, project_id, body }) → the row (201 by the route)
function add(pool, actor, body) {
  body = body || {};
  var errors = {};
  if (!validKind(body.kind)) errors.kind = 'contact|conversation|project';
  if (!validTarget(body.id)) errors.id = 'required';
  var projectId = body.project_id !== undefined ? body.project_id : (body.kind === 'project' ? body.id : null);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(projectId || ''))) errors.project_id = 'required';
  var text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > MAX_BODY) errors.body = '1–' + MAX_BODY + ' characters';
  if (body.kind === 'project' && String(body.id) !== String(projectId)) errors.id = 'a project note targets its own project';
  if (Object.keys(errors).length) throw fail('validation', 400, 'invalid note', errors);
  return pool.query('INSERT INTO wp_notes (project_id, target_kind, target_id, author, body) VALUES ($1,$2,$3,$4,$5) RETURNING id, project_id, target_kind, target_id, author, body, created_at',
    [String(projectId), body.kind, String(body.id), String(actor || 'unknown').slice(0, 64), text]).then(function (r) { return r.rows[0]; }, function (e) {
    if (e && e.code === '23503') throw fail('not_found', 404, 'unknown project');
    throw e;
  });
}

// get(pool, id, projects) → row | null (scoped)
function get(pool, id, projects) {
  var ids = Array.isArray(projects) ? projects.map(String) : [];
  if (!ids.length) return Promise.resolve(null);
  return pool.query('SELECT id, project_id, target_kind, target_id, author, body, created_at FROM wp_notes WHERE id = $1 AND project_id = ANY($2::text[])', [id, ids]).then(function (r) { return r.rows[0] || null; });
}

// remove(pool, id, { actor, canManage, projects }) → { id, deleted:true }; 403 unless manager+ or the author
function remove(pool, id, o) {
  o = o || {};
  return get(pool, id, o.projects).then(function (row) {
    if (!row) throw fail('not_found', 404, 'no such note');
    if (!o.canManage && row.author !== o.actor) throw fail('forbidden', 403, 'only the author or a manager may delete this note');
    return pool.query('DELETE FROM wp_notes WHERE id = $1', [row.id]).then(function () { return { id: row.id, project_id: row.project_id, target_kind: row.target_kind, target_id: row.target_id, deleted: true }; });
  });
}

module.exports = { KINDS: KINDS, MAX_BODY: MAX_BODY, list: list, add: add, get: get, remove: remove };
