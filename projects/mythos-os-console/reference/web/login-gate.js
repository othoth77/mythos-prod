'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — temporary internal login gate
   projects/mythos-os-console/reference/web/login-gate.js

   A TEMPORARY internal access gate, not the final authentication
   architecture. It exists only so the Command Center is not open to
   anyone who reaches the URL while it is internal-only. It has no
   backend, changes nothing about the control-plane API, and grants no
   permission the console did not already have read access to — it is
   a UI-level gate, not a data boundary. Replace it with real
   authentication/authorization; do not extend it.

   The temporary password is never stored here — only its SHA-256
   digest, computed with the Web Crypto API already available in every
   browser this console targets. The digest is not a secret; comparing
   against it does not reveal the password.

   sessionStorage, not localStorage: the unlocked state is meant to
   survive a refresh within the same tab/session, per the current
   requirement, and nothing more — it clears itself when the browser
   session ends, matching the "temporary" scope of this gate.
   ===================================================== */

(function () {
  var STORAGE_KEY = 'mythos-gate-unlocked';
  var HASH = '32b03b523eca3a105479143d94b0cde4ded94b05ee30e7c83502da909f3c3b3b';

  var gate = document.getElementById('mythos-gate');
  var form = document.getElementById('mythos-gate-form');
  var input = document.getElementById('mythos-gate-password');
  var error = document.getElementById('mythos-gate-error');

  function removeGate() {
    if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
  }

  function unlock() {
    try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch (e) { /* storage unavailable; gate re-prompts next load, which is safe */ }
    removeGate();
  }

  function alreadyUnlocked() {
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function showError() {
    if (!error) return;
    error.textContent = 'Mot de passe incorrect.';
    error.hidden = false;
    if (input) { input.value = ''; input.focus(); }
  }

  if (alreadyUnlocked()) { unlock(); return; }
  if (!gate || !form || !input) return; // markup missing: fail closed, gate stays up

  if (!(window.crypto && window.crypto.subtle)) {
    // No Web Crypto (non-secure context or very old browser). Fail
    // closed rather than silently accept every password.
    if (error) { error.textContent = 'Secure context required.'; error.hidden = false; }
    return;
  }

  form.addEventListener('submit', function (evt) {
    evt.preventDefault();
    if (error) error.hidden = true;
    var value = input.value;
    window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
      .then(function (buf) { if (toHex(buf) === HASH) unlock(); else showError(); })
      .catch(function () { showError(); });
  });
})();
