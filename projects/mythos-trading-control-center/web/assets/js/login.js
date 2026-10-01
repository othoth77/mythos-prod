/* MYTHOS TRADING CONTROL CENTER — sign-in
   projects/mythos-trading-control-center/web/assets/js/login.js

   Posts the credentials to this origin's /api/auth/login and, on success,
   goes to the dashboard. The session cookie is httpOnly; this script never
   sees it, and nothing is stored in the browser. A failure is reported in
   words — the server deliberately does not say whether the user exists. */
(function () {
  'use strict';

  var form = document.getElementById('login-form');
  var error = document.getElementById('login-error');
  var submit = document.getElementById('login-submit');
  var user = document.getElementById('user');
  var password = document.getElementById('password');

  function fail(text) {
    error.textContent = text;
    submit.disabled = false;
    submit.textContent = 'Sign in';
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    error.textContent = '';
    if (!user.value.trim() || !password.value) { fail('Enter your user name and password.'); return; }
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    window.fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ user: user.value.trim(), password: password.value })
    }).then(function (res) {
      if (res.ok) { window.location.assign('/dashboard'); return; }
      password.value = '';
      if (res.status === 429) fail('Too many attempts. Wait a few minutes and try again.');
      else if (res.status === 401) fail('The user name or password is not correct.');
      else fail('Sign-in is not available right now (' + res.status + ').');
    }).catch(function () {
      fail('The server could not be reached.');
    });
  });

  user.focus();
})();
