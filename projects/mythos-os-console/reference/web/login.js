'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — sign-in client (MOS-v2 M-01)
   projects/mythos-os-console/reference/web/login.js

   The whole of this file's job is to move a password from one input to
   POST /api/login and then get out of the way. It holds no credential,
   derives none, and decides nothing — the server does all three.

   What it deliberately does NOT do, each replacing something the MOS-1
   gate did do:

     · No digest, no comparison, no secret material of any kind. The
       gate carried a SHA-256 of the password in a file the browser
       downloads; anyone could take it offline. There is nothing here to
       take.
     · No sessionStorage and no localStorage. The session lives in an
       httpOnly cookie the browser attaches on its own, which no script
       on this page — or injected into it — can read.
     · No "unlocked" flag. Being signed in is a fact the server holds;
       this page cannot assert it.
     · Errors are rendered through textContent, like the rest of this
       console. Nothing here builds markup.
   ===================================================== */

(function () {
  var form = document.getElementById('login-form');
  var input = document.getElementById('login-password');
  var submit = document.getElementById('login-submit');
  var error = document.getElementById('login-error');

  if (!form || !input || !submit) return; // markup missing: no form, nothing submits, fails closed

  // The server distinguishes far more cases than these; it deliberately
  // tells the browser only which of three things happened, so a caller
  // cannot probe the deployment's configuration from the login page.
  var MESSAGES = {
    invalid_credentials: 'Incorrect password.',
    too_many_attempts: 'Too many failed attempts. Wait a few minutes and try again.',
    bad_request: 'Enter a password.'
  };

  function showError(code) {
    if (!error) return;
    error.textContent = MESSAGES[code] || 'Sign-in failed. Try again.';
    error.hidden = false;
    input.value = '';
    input.focus();
  }

  function clearError() {
    if (error) { error.hidden = true; error.textContent = ''; }
  }

  form.addEventListener('submit', function (evt) {
    evt.preventDefault();
    clearError();

    var password = input.value;
    if (!password) { showError('bad_request'); return; }

    submit.disabled = true;
    fetch('/api/login', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: password })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (body) {
        // The response body carries an expiry and nothing else. The
        // session identifier arrives as a Set-Cookie header the browser
        // stores itself; this script never sees it and never stores
        // anything.
        if (res.ok && body && body.ok) { location.replace('/'); return; }
        showError(body && body.error);
      });
    }).catch(function () {
      showError('network');
    }).then(function () {
      submit.disabled = false;
    });
  });

  input.focus();
}());
