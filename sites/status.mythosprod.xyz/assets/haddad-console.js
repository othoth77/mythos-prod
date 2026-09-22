/* Boot for the /haddad/ console. A separate file because the site's CSP is
   script-src 'self' — there are no inline scripts anywhere on this host. */
(function () {
  'use strict';
  if (window.MythosHaddad) window.MythosHaddad.mountConsole();
})();
