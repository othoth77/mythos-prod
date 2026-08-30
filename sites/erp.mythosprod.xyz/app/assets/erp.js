/* Mythos ERP — shell navigation.
 *
 * Hash routing only. No inline handlers anywhere in the markup, because the
 * platform CSP is script-src 'self' and the legacy shell's onclick="showView(…)"
 * would be blocked by it. Every listener is bound here.
 *
 * This file deliberately contains NO data access. Stage 2 is the client tier
 * only: nothing here reads, writes, uploads or authenticates. The module views
 * render static structure so the design system can be reviewed before any
 * endpoint exists to connect to.
 */
(function () {
  'use strict';

  var MODULES = [
    'dashboard', 'clients', 'projects', 'planning', 'production',
    'finance', 'documents', 'reports', 'settings', 'inventory'
  ];
  var DEFAULT = 'dashboard';

  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function normalise(hash) {
    var id = String(hash || '').replace(/^#\/?/, '').toLowerCase();
    return MODULES.indexOf(id) >= 0 ? id : DEFAULT;
  }

  function show(id) {
    all('.view').forEach(function (v) {
      v.setAttribute('data-active', String(v.id === 'view-' + id));
    });
    all('.rail a[data-module]').forEach(function (a) {
      if (a.getAttribute('data-module') === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var active = el('#view-' + id);
    var title = active ? active.getAttribute('data-title') : null;
    var heading = el('#topbar-title');
    if (heading && title) heading.textContent = title;
    // Announce the change for screen readers without stealing focus mid-typing.
    var live = el('#route-live');
    if (live && title) live.textContent = title;
    document.title = (title ? title + ' — ' : '') + 'Mythos ERP';
  }

  function onRoute() { show(normalise(window.location.hash)); }

  function start() {
    window.addEventListener('hashchange', onRoute);
    onRoute();

    // Every control that would perform a real operation is inert in Stage 2 and
    // says so, rather than looking live and doing nothing.
    all('[data-stage3]').forEach(function (node) {
      node.setAttribute('aria-disabled', 'true');
      if ('disabled' in node) node.disabled = true;
      node.setAttribute('title', 'Disponible après le Stage 3 (données) et le Stage 4 (authentification).');
    });
  }

  /* Exported for tests before any DOM access: in a test process `document`
     does not exist, and touching it here would throw before the export ran. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MODULES: MODULES, normalise: normalise, DEFAULT: DEFAULT };
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
