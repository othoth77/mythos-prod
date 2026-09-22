// ══════════════════════════════════════════════════════════════════════
// MYTHOS OS — Secure backend client (opt-in, dormant by default)
// js/core/secure-client.js
//
// The frontend integration layer for projects/erp-backend. It is INERT until
// explicitly enabled, so the live application (localStorage + the legacy sync)
// is byte-for-byte unchanged until the backend is deployed and verified:
//
//   enable:  localStorage.setItem('mythos_secure_backend','1')
//            localStorage.setItem('mythos_secure_base','https://<backend-origin>')
//   (or set window.MYTHOS_SECURE_BACKEND / window.MYTHOS_SECURE_BASE)
//
// When enabled, every request carries the session cookie (credentials:
// 'include') and, on writes, the session-bound CSRF token returned by
// /auth/login. The server remains authoritative for authorization — this
// client's role checks only improve UX (§5). No secret is stored here; the
// session lives in an HttpOnly cookie the JS never sees.
// ══════════════════════════════════════════════════════════════════════

window.MythosSecure = (function () {
  'use strict';

  var _csrf = null;
  var _user = null;

  function ls(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function enabled() {
    return ls('mythos_secure_backend') === '1' || window.MYTHOS_SECURE_BACKEND === true;
  }
  function base() {
    return ls('mythos_secure_base') || window.MYTHOS_SECURE_BASE || '';
  }

  function parse(r) {
    return r.text().then(function (t) {
      var j = {};
      try { j = t ? JSON.parse(t) : {}; } catch (e) { j = {}; }
      if (!r.ok) {
        var err = new Error(j.error || ('HTTP ' + r.status));
        err.status = r.status;
        err.body = j;
        throw err;
      }
      return j;
    });
  }

  function req(path, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({}, opts.headers || {});
    var method = (opts.method || 'GET').toUpperCase();
    if (_csrf && method !== 'GET' && method !== 'HEAD') {
      opts.headers['X-CSRF-Token'] = _csrf;
    }
    return fetch(base() + path, opts).then(parse);
  }

  function jsonBody(obj) {
    return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
  }

  // ── Auth ────────────────────────────────────────────────────────────
  function login(username, password) {
    return req('/auth/login', Object.assign({ method: 'POST' },
      jsonBody({ username: username, password: password }))).then(function (j) {
      _csrf = j.csrf; _user = j.user; return j.user;
    });
  }
  function me() {
    return req('/auth/me', { method: 'GET' }).then(function (j) {
      _csrf = j.csrf; _user = j.user; return j.user;
    }, function (err) { _user = null; _csrf = null; throw err; });
  }
  function logout() {
    return req('/auth/logout', Object.assign({ method: 'POST' }, jsonBody({})))
      .then(function () { _user = null; _csrf = null; });
  }

  // ── Collections (same shape the app already uses) ─────────────────────
  function getCollection(key) {
    return req('/api/collections?key=' + encodeURIComponent(key), { method: 'GET' });
  }
  function meta() {
    return req('/api/collections?action=meta', { method: 'GET' });
  }
  function putCollection(key, data, baseVersion) {
    var body = { key: key, data: data };
    if (baseVersion !== undefined && baseVersion !== null) body.baseVersion = baseVersion;
    return req('/api/collections', Object.assign({ method: 'POST' }, jsonBody(body)));
  }

  // ── Uploads (multipart; CSRF header, no JSON content-type) ────────────
  function upload(file, category) {
    var fd = new FormData();
    fd.append('file', file);
    if (category) fd.append('category', category);
    return req('/api/upload', { method: 'POST', body: fd });
  }

  // ── RBAC UX helper (server stays authoritative) ───────────────────────
  var ROLE_ACTIONS = {
    viewer: ['read'],
    editor: ['read', 'write', 'upload'],
    admin:  ['read', 'write', 'upload', 'admin']
  };
  function can(action) {
    if (!_user || !_user.roles) return false;
    for (var i = 0; i < _user.roles.length; i++) {
      var acts = ROLE_ACTIONS[_user.roles[i]] || [];
      if (acts.indexOf(action) >= 0) return true;
    }
    return false;
  }
  // Disable (not merely hide) controls the current user cannot use. Modules
  // opt in by tagging a control with data-requires="write|upload|admin".
  function applyRbac(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-requires]');
    for (var i = 0; i < nodes.length; i++) {
      var need = nodes[i].getAttribute('data-requires');
      var allowed = can(need);
      nodes[i].toggleAttribute('disabled', !allowed);
      nodes[i].setAttribute('aria-disabled', String(!allowed));
    }
  }

  function currentUser() { return _user; }

  return {
    enabled: enabled, base: base,
    login: login, logout: logout, me: me,
    getCollection: getCollection, meta: meta, putCollection: putCollection,
    upload: upload, can: can, applyRbac: applyRbac, currentUser: currentUser
  };
})();
