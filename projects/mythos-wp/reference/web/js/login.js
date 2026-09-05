'use strict';
/* MYTHOS WP — sign-in form. Posts JSON to /api/login with the CSRF header;
   on success the server sets the httpOnly cookie and we navigate to /. */
(function () {
  var form = document.getElementById('login-form');
  var err = document.getElementById('login-error');
  var btn = document.getElementById('login-submit');
  function showError(msg) { err.textContent = msg; err.hidden = false; }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    var body = { username: document.getElementById('login-username').value.trim(), password: document.getElementById('login-password').value };
    fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'MythosWP' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
      .then(function (r) {
        if (r.json && r.json.ok) { window.location.replace('/'); return; }
        var code = r.json && r.json.error;
        showError(code === 'throttled' ? 'Too many failed attempts. Try again in fifteen minutes.' : code === 'auth_unavailable' ? 'Authentication is not configured on the server.' : 'Invalid username or password.');
        btn.disabled = false;
      })
      .catch(function () { showError('The server could not be reached.'); btn.disabled = false; });
  });
}());
