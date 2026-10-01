/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — application shell
   projects/mythos-trading-control-center/web/assets/js/app.js

   Loaded last. Resolves the session, builds the navigation from the registered
   pages, keeps the status bar current, and starts the router.

   THE STATUS BAR IS ALWAYS TRUE. Mode, the trading switch and the running job
   are polled from /api/status and shown on every page, so an operator never
   has to navigate to learn what state the platform is in — and a change made
   by somebody else shows up here within a few seconds.

   LIVE IS NOT A CONTROL. The sidebar states that live execution is not
   available. It is a statement, not a disabled button: there is nothing to
   enable.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var api = TCC.api;

  var NAV = [
    { title: 'Overview', items: ['/dashboard'] },
    { title: 'Operate', items: ['/control', '/paper', '/backtest'] },
    { title: 'Explore', items: ['/trades', '/candidates', '/decisions'] },
    { title: 'Engines', items: ['/strategies', '/jev', '/risk', '/recovery'] },
    { title: 'Insight', items: ['/analysis', '/research'] },
    { title: 'Assurance', items: ['/testing', '/activity', '/system'] }
  ];

  var status = null;
  var statusListeners = [];

  TCC.status = function () { return status; };
  /** Subscribe to status changes. Returns an unsubscribe function. */
  TCC.onStatus = function (fn) {
    statusListeners.push(fn);
    return function () { statusListeners = statusListeners.filter(function (f) { return f !== fn; }); };
  };
  TCC.refreshStatus = refreshStatus;

  function refreshStatus() {
    return api.get('/api/status').then(function (s) {
      var changed = !status || status.mode !== s.mode || status.tradingEnabled !== s.tradingEnabled ||
        status.configFingerprint !== s.configFingerprint || status.paper.state !== s.paper.state ||
        (status.job ? status.job.runId : null) !== (s.job ? s.job.runId : null) || status.testRun !== s.testRun;
      status = s;
      paintStatus();
      if (changed) statusListeners.slice().forEach(function (fn) { try { fn(s); } catch (e) { /* a listener must not stop the bar */ } });
      return s;
    }).catch(function () { /* the next beat retries; a 401 already redirected */ });
  }

  function paintStatus() {
    var host = document.getElementById('status');
    if (!host || !status) return;
    var nodes = [
      el('span', { class: 't-small t-secondary', text: 'Mode' }),
      ui.status(status.mode),
      el('span', { class: 't-small t-secondary', text: 'Trading' }),
      ui.status(status.tradingEnabled ? 'ENABLED' : 'DISABLED')
    ];
    if (status.paper && status.paper.state !== 'IDLE') {
      nodes.push(el('span', { class: 't-small t-secondary', text: status.paper.kind === 'DEMO' ? 'Demo' : 'Paper' }));
      nodes.push(ui.status(status.paper.state));
    }
    if (status.job) nodes.push(ui.badge(status.job.kind + ' RUNNING', 'info'));
    if (status.testRun) nodes.push(ui.badge('TESTS RUNNING', 'info'));
    nodes.push(el('span', { class: 't-small t-secondary', text: 'Config' }));
    nodes.push(ui.hash(status.configFingerprint));
    TCC.replace(host, nodes);
  }

  function buildNav() {
    var host = document.getElementById('nav');
    var defs = {};
    TCC.pages().forEach(function (p) { defs[p.path] = p.def; });
    TCC.replace(host, NAV.map(function (group) {
      return el('div', { class: 'nav-group' }, [
        el('div', { class: 'nav-title', text: group.title }),
        el('ul', null, group.items.map(function (path) {
          var def = defs[path];
          return el('li', null, el('a', { class: 'nav-link', attrs: { href: path, 'data-link': '', 'data-path': path } }, [
            el('span', { text: def ? def.nav || def.title : path }),
            def && def.pending ? el('span', { class: 'nav-mark', text: 'P' + def.pending, title: 'Delivered in phase ' + def.pending }) : null
          ]));
        }))
      ]);
    }));
  }

  function markActive(pathname) {
    var links = document.querySelectorAll('.nav-link');
    Array.prototype.forEach.call(links, function (a) {
      if (a.getAttribute('data-path') === pathname) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    closeNav();
  }

  function openNav() {
    document.getElementById('shell').classList.add('nav-open');
    document.getElementById('nav-toggle').setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    document.getElementById('shell').classList.remove('nav-open');
    document.getElementById('nav-toggle').setAttribute('aria-expanded', 'false');
  }

  function currentTheme() {
    var stated = document.documentElement.getAttribute('data-theme');
    if (stated === 'light' || stated === 'dark') return stated;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function wireTheme() {
    var btn = document.getElementById('theme-toggle');
    function paint() { btn.textContent = 'Theme: ' + currentTheme(); }
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { window.localStorage.setItem('tcc.theme', next); } catch (e) { /* preference simply does not persist */ }
      paint();
    });
    paint();
  }

  function wireSignOut() {
    document.getElementById('sign-out').addEventListener('click', function (ev) {
      ui.run(ev.currentTarget, 'Signing out…', function () {
        return api.post('/api/auth/logout', {}).then(function () { window.location.assign('/login'); });
      });
    });
  }

  function boot() {
    api.get('/api/auth/session').then(function (s) {
      if (!s.authenticated) { window.location.assign('/login'); return; }
      api.setSession(s);
      TCC.replace(document.getElementById('who'), [
        el('span', { class: 'who-name' }, [el('strong', { text: s.user.id })]),
        ui.badge(s.user.role, s.user.role === 'OWNER' ? 'attention' : 'neutral')
      ]);
      buildNav();
      wireTheme();
      wireSignOut();
      document.getElementById('nav-toggle').addEventListener('click', function () {
        if (document.getElementById('shell').classList.contains('nav-open')) closeNav(); else openNav();
      });
      document.getElementById('nav-scrim').addEventListener('click', closeNav);
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeNav(); });

      return refreshStatus().then(function () {
        window.setInterval(function () { if (!document.hidden) refreshStatus(); }, 5000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshStatus(); });
        TCC.router.start(document.getElementById('view'), markActive);
        document.documentElement.setAttribute('data-ready', 'true');
      });
    }).catch(function (e) {
      if (e && e.status === 401) return;
      TCC.replace(document.getElementById('view'), ui.errorState(e, function () { window.location.reload(); }));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
