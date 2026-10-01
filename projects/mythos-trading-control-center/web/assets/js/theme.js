/* MYTHOS TRADING CONTROL CENTER — theme bootstrap
   projects/mythos-trading-control-center/web/assets/js/theme.js

   Loaded blocking in <head> so the stated theme is applied before first paint.
   Dark is the default (A-010); with no stated preference the token file's own
   prefers-color-scheme fallback decides. The preference is the ONLY thing this
   console keeps in localStorage — never a session, a token or any data. */
(function () {
  'use strict';
  try {
    var t = window.localStorage.getItem('tcc.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: the system preference applies */ }
})();
