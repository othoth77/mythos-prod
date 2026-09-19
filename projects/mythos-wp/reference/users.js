'use strict';
// =====================================================
// MYTHOS WP — users, roles and project access (V2)
// projects/mythos-wp/reference/users.js
//
// wp_users is the account store of the Control Center. The 0600 users file
// (MYTHOS_WP_USERS_FILE) stays the bootstrap / break-glass source: it is
// imported once (`mythos-wp users import`) and still answers a login when a
// name is absent from the table (auth.verifyCredentials). Passwords are
// scrypt hashes; the hash column is `hidden` in the registry and never
// leaves this module except for verification.
//
// Project access: owner/admin (and `all_projects`) see everything;
// everybody else sees only wp_user_projects rows. The session carries the
// list at login and is refreshed by setProjects().
// =====================================================
var auth = require('./auth');
var fail = require('./crud').fail;

function list(pool) {
  return pool.query('SELECT username, display_name, role, status, all_projects, last_login_at, created_by, created_at, updated_at FROM wp_users ORDER BY username').then(function (r) { return r.rows; });
}
// forLogin(pool) → rows WITH the hash, for auth.verifyCredentials only
function forLogin(pool) {
  return pool.query('SELECT username, role, scrypt, status, all_projects FROM wp_users').then(function (r) { return r.rows; }, function () { return []; });
}
function projectsOf(pool, username) {
  return pool.query('SELECT project_id, role FROM wp_user_projects WHERE username = $1 ORDER BY project_id', [username]).then(function (r) { return r.rows; }, function () { return []; });
}
// accessList(pool, user) → null (all) | [project ids]
function accessList(pool, user) {
  if (!user) return Promise.resolve([]);
  if (auth.ROLE_RANK[user.role] >= auth.ROLE_RANK.admin || user.all_projects === true || user.source === 'file') return Promise.resolve(null);
  return projectsOf(pool, user.username).then(function (rows) { return rows.map(function (x) { return x.project_id; }); });
}
function touchLogin(pool, username) {
  return pool.query('UPDATE wp_users SET last_login_at = now() WHERE username = $1', [username]).catch(function () {});
}
function setPassword(pool, username, password, actor) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw fail('validation', 400, 'password must be 12–256 characters', { errors: { password: 'length' } });
  return pool.query('UPDATE wp_users SET scrypt = $2, updated_at = now() WHERE username = $1 RETURNING username', [username, auth.hashPassword(password)]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such user');
    return { username: username };
  });
}
// setProjects(pool, username, { add: [], remove: [] }, actor) → { projects }
function setProjects(pool, username, patch, actor) {
  patch = patch || {};
  var add = Array.isArray(patch.add) ? patch.add : [], remove = Array.isArray(patch.remove) ? patch.remove : [];
  var bad = add.concat(remove).filter(function (id) { return !/^[a-z0-9][a-z0-9-]{1,62}$/.test(String(id)); });
  if (bad.length) throw fail('validation', 400, 'project id shape', { errors: { projects: bad } });
  return pool.query('SELECT username FROM wp_users WHERE username = $1', [username]).then(function (r) {
    if (!r.rows[0]) throw fail('not_found', 404, 'no such user');
    var chain = Promise.resolve();
    add.forEach(function (id) { chain = chain.then(function () { return pool.query('INSERT INTO wp_user_projects (username, project_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [username, id, actor || 'system']).catch(function (e) { if (e.code === '23503') throw fail('not_found', 404, 'unknown project ' + id); throw e; }); }); });
    remove.forEach(function (id) { chain = chain.then(function () { return pool.query('DELETE FROM wp_user_projects WHERE username = $1 AND project_id = $2', [username, id]); }); });
    return chain.then(function () { return projectsOf(pool, username); }).then(function (rows) { return { username: username, projects: rows.map(function (x) { return x.project_id; }) }; });
  });
}
// importFile(pool, file, actor) → { imported, skipped } — bootstraps wp_users from the 0600 users file (existing names untouched)
function importFile(pool, actor) {
  var loaded = auth.loadUsers();
  if (!loaded.ok) return Promise.resolve({ imported: 0, skipped: 0, reason: loaded.reason });
  var imported = 0, skipped = 0, chain = Promise.resolve();
  loaded.users.forEach(function (u) {
    chain = chain.then(function () {
      return pool.query('INSERT INTO wp_users (username, role, scrypt, status, all_projects, created_by) VALUES ($1,$2,$3,\'active\',true,$4) ON CONFLICT (username) DO NOTHING RETURNING username', [u.username, auth.normalizeRole(u.role), u.scrypt, actor || 'import'])
        .then(function (r) { if (r.rows[0]) imported++; else skipped++; });
    });
  });
  return chain.then(function () { return { imported: imported, skipped: skipped, reason: null }; });
}
// upsert(pool, { username, role, password, display_name, status, all_projects }, actor) — CLI helper
function upsert(pool, u, actor) {
  if (!auth.USERNAME_RE.test(String(u.username || ''))) throw fail('validation', 400, 'username shape');
  if (auth.ROLES.indexOf(u.role) === -1) throw fail('validation', 400, 'role must be one of ' + auth.ROLES.join('|'));
  if (typeof u.password !== 'string' || u.password.length < 12) throw fail('validation', 400, 'password must be at least 12 characters');
  return pool.query('INSERT INTO wp_users (username, display_name, role, scrypt, status, all_projects, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role, scrypt = EXCLUDED.scrypt, display_name = COALESCE(EXCLUDED.display_name, wp_users.display_name), status = EXCLUDED.status, all_projects = EXCLUDED.all_projects, updated_at = now() RETURNING username, role, status, all_projects, (xmax = 0) AS created',
    [u.username, u.display_name || null, u.role, auth.hashPassword(u.password), u.status || 'active', u.all_projects === true, actor || 'cli']).then(function (r) { return r.rows[0]; });
}
module.exports = { list: list, forLogin: forLogin, projectsOf: projectsOf, accessList: accessList, touchLogin: touchLogin, setPassword: setPassword, setProjects: setProjects, importFile: importFile, upsert: upsert };
