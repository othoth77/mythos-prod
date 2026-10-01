/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — browser core
   projects/mythos-trading-control-center/web/assets/js/core.js

   DOM building, formatting, the API client, the router, and the two overlays
   (modal and toast). No framework and no build step, like every other surface
   in this repository.

   THREE RULES THIS FILE ENFORCES FOR EVERYTHING BUILT ON IT

    1. THE DOM IS BUILT, NEVER PARSED. el() creates elements and text nodes.
       There is no HTML-string sink anywhere in this console, so a strategy id,
       a reason code or an error message from the server can never be read as
       markup. tests/web-test.js greps for the string sinks and fails on one.

    2. THE BROWSER TALKS ONLY TO ITS OWN ORIGIN'S /api/. Every request is a
       relative path through api.request(). The session cookie is httpOnly and
       unreadable here; the CSRF token is held in memory and sent as a header.
       Nothing is written to localStorage except the theme preference.

    3. A MISSING VALUE IS NEVER FORMATTED AS A NUMBER. The formatters return
       null for null, and the UI kit turns null into "n/a" or NO DATA with a
       reason. Zero is only ever shown for a real zero.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC = window.TCC || {};

  // ===========================================================================
  // DOM
  // ===========================================================================

  /**
   * el('div', { class: 'card', text: 'x', attrs: { role: 'img' }, on: { click: fn } }, [children])
   * A child may be a Node, a string (becomes a text node), or null (skipped).
   */
  function el(tag, props, children) {
    var node = document.createElement(tag);
    var p = props || {};
    if (p.class) node.className = p.class;
    if (p.text !== undefined && p.text !== null) node.textContent = String(p.text);
    if (p.id) node.id = p.id;
    if (p.title) node.title = p.title;
    if (p.hidden) node.hidden = true;
    if (p.attrs) {
      Object.keys(p.attrs).forEach(function (k) {
        var v = p.attrs[k];
        if (v === null || v === undefined || v === false) return;
        node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    if (p.on) Object.keys(p.on).forEach(function (k) { node.addEventListener(k, p.on[k]); });
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return append(node, c);
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function replace(node, children) {
    clear(node);
    return append(node, children);
  }

  /** Inline SVG element (namespaced). */
  function svg(tag, attrs, children) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      node.setAttribute(k, String(attrs[k]));
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  // ===========================================================================
  // formatting — null in, null out
  // ===========================================================================

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function group(s) {
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  var fmt = {
    num: function (v, dp) { return isNum(v) ? group(v.toFixed(dp === undefined ? 2 : dp)) : null; },
    int: function (v) { return isNum(v) ? group(String(Math.round(v))) : null; },
    money: function (v, dp) { return isNum(v) ? (v < 0 ? '−' : '') + '$' + group(Math.abs(v).toFixed(dp === undefined ? 2 : dp)) : null; },
    signedMoney: function (v, dp) { return isNum(v) ? (v > 0 ? '+' : (v < 0 ? '−' : '')) + '$' + group(Math.abs(v).toFixed(dp === undefined ? 2 : dp)) : null; },
    /** A fraction (0.33) as a percentage. */
    pct: function (v, dp) { return isNum(v) ? (v * 100).toFixed(dp === undefined ? 1 : dp) + '%' : null; },
    /** A value already in percent (4.65). */
    pctRaw: function (v, dp) { return isNum(v) ? v.toFixed(dp === undefined ? 2 : dp) + '%' : null; },
    lots: function (v) { return isNum(v) ? v.toFixed(2) : null; },
    price: function (v) { return isNum(v) ? String(v) : null; },
    r: function (v) { return isNum(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + 'R' : null; },
    /** A bar timestamp (epoch ms, UTC) — the simulated time of the data. */
    barTime: function (ms) {
      if (!isNum(ms)) return null;
      var d = new Date(ms);
      return d.toISOString().slice(0, 16).replace('T', ' ');
    },
    /** A wall-clock ISO timestamp, shown in UTC to the second. */
    wall: function (iso) {
      if (!iso) return null;
      var d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    },
    wallShort: function (iso) {
      if (!iso) return null;
      var d = new Date(iso);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(5, 19).replace('T', ' ');
    },
    duration: function (ms) {
      if (!isNum(ms)) return null;
      if (ms < 1000) return Math.round(ms) + ' ms';
      if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
      if (ms < 3600000) return Math.floor(ms / 60000) + ' m ' + Math.round((ms % 60000) / 1000) + ' s';
      return Math.floor(ms / 3600000) + ' h ' + Math.floor((ms % 3600000) / 60000) + ' m';
    },
    hash: function (h, n) { return typeof h === 'string' && h.length ? h.slice(0, n || 12) : null; },
    words: function (code) { return String(code || '').replace(/_/g, ' '); }
  };

  // ===========================================================================
  // API client
  // ===========================================================================

  function ApiError(status, body) {
    var err = (body && body.error) || {};
    var e = new Error(err.message || ('request failed (' + status + ')'));
    e.name = 'ApiError';
    e.status = status;
    e.code = err.code || 'ERROR';
    e.problems = err.problems || null;
    e.detail = err;
    e.requestId = body && body.requestId;
    return e;
  }

  var session = null;

  function request(method, path, body) {
    var headers = { Accept: 'application/json' };
    var init = { method: method, headers: headers, credentials: 'same-origin', cache: 'no-store' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      if (session && session.csrf) headers['X-TCC-CSRF'] = session.csrf;
      init.body = JSON.stringify(body === undefined ? {} : body);
    }
    return window.fetch(path, init).then(function (res) {
      return res.text().then(function (text) {
        var parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
        if (res.status === 401 && path !== '/api/auth/login') {
          // The session is gone. There is nothing useful to show; sign in again.
          window.location.assign('/login');
          throw ApiError(401, parsed);
        }
        if (!res.ok || !parsed || parsed.ok !== true) throw ApiError(res.status, parsed);
        return parsed;
      });
    });
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === '') return;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  var api = {
    get: function (path, params) { return request('GET', path + qs(params)).then(function (r) { return r.result; }); },
    post: function (path, body) { return request('POST', path, body); },
    patch: function (path, body) { return request('PATCH', path, body); },
    session: function () { return session; },
    setSession: function (s) { session = s; },
    can: function (what) { return !!(session && session.can && session.can[what]); }
  };

  // ===========================================================================
  // overlays: toast, modal, confirm
  // ===========================================================================

  function toast(kind, tag, message, ms) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var node = el('div', { class: 'toast is-' + kind, attrs: { role: kind === 'danger' ? 'alert' : 'status' } }, [
      el('span', { class: 'toast-tag', text: tag }),
      el('span', { class: 't-wrap', text: message }),
      el('button', { class: 'btn btn-ghost btn-compact toast-close', text: 'Dismiss', attrs: { type: 'button' },
        on: { click: function () { remove(); } } })
    ]);
    function remove() { if (node.parentNode) node.parentNode.removeChild(node); }
    host.appendChild(node);
    while (host.children.length > 4) host.removeChild(host.firstChild);
    window.setTimeout(remove, ms || (kind === 'danger' ? 12000 : 6000));
  }

  /** A readable message for any thrown error, including the server's problem list. */
  function describeError(e) {
    var msg = (e && e.message) || 'request failed';
    if (e && e.problems && e.problems.length) {
      msg += ' — ' + e.problems.slice(0, 4).map(function (p) { return p.path + ' ' + p.message; }).join('; ');
    }
    return msg;
  }

  var openModal = null;

  /**
   * modal({ title, sub, body: Node, actions: [{label, kind, onClick}], wide })
   * Focus is trapped while open and returned to the opener on close.
   */
  function modal(opts) {
    if (openModal) openModal.close();
    var opener = document.activeElement;
    var titleId = 'modal-title-' + Date.now();
    var foot = el('div', { class: 'modal-foot' });
    var body = el('div', { class: 'modal-body' }, opts.body);
    var box = el('div', { class: 'modal' + (opts.wide ? ' is-wide' : ''), attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId } }, [
      el('div', { class: 'modal-head' }, [
        el('div', null, [
          el('h2', { class: 't-h2', id: titleId, text: opts.title }),
          opts.sub ? el('p', { class: 't-secondary t-small', text: opts.sub }) : null
        ]),
        el('button', { class: 'btn btn-ghost btn-compact', text: 'Close', attrs: { type: 'button' }, on: { click: function () { handle.close(); } } })
      ]),
      body,
      foot
    ]);
    var scrim = el('div', { class: 'scrim', on: { mousedown: function (ev) { if (ev.target === scrim) handle.close(); } } }, box);

    function focusables() {
      return Array.prototype.slice.call(box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); handle.close(); return; }
      if (ev.key !== 'Tab') return;
      var f = focusables();
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
    }

    var handle = {
      body: body,
      foot: foot,
      setActions: function (actions) {
        replace(foot, (actions || []).map(function (a) {
          var b = el('button', { class: 'btn ' + (a.kind || 'btn-secondary'), text: a.label, attrs: { type: 'button', disabled: a.disabled ? true : null } });
          b.addEventListener('click', function () { a.onClick(b, handle); });
          return b;
        }));
      },
      close: function () {
        document.removeEventListener('keydown', onKey, true);
        if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
        if (openModal === handle) openModal = null;
        if (opts.onClose) opts.onClose();
        if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* the opener is gone */ } }
      }
    };
    handle.setActions(opts.actions);
    document.body.appendChild(scrim);
    document.addEventListener('keydown', onKey, true);
    openModal = handle;
    var first = focusables()[0];
    if (first) first.focus();
    return handle;
  }

  /**
   * confirm({ title, message, details: Node, confirmLabel, danger,
   *           reason: true,           // ask for a written reason (returned)
   *           reasonMin, reasonLabel, // its minimum length (5) and its label
   *           typed: 'ENABLE' })      // require the operator to type a word
   * Resolves to { reason } or null when cancelled.
   */
  function confirm(opts) {
    return new Promise(function (resolve) {
      var done = false;
      var reasonInput = null;
      var typedInput = null;
      var reasonMin = opts.reasonMin || 5;
      var msg = el('p', { class: 'msg', text: '' });
      var body = [el('p', { text: opts.message })];
      if (opts.details) body.push(opts.details);
      if (opts.reason) {
        reasonInput = el('textarea', { class: 'textarea', id: 'confirm-reason', attrs: { rows: '2', maxlength: '500' } });
        body.push(el('div', { class: 'field' }, [
          el('label', { text: (opts.reasonLabel || 'Reason') + ' — recorded in the audit log', attrs: { for: 'confirm-reason' } }),
          reasonInput,
          el('span', { class: 'hint', text: 'At least ' + reasonMin + ' characters.' })
        ]));
      }
      if (opts.typed) {
        typedInput = el('input', { class: 'input', id: 'confirm-typed', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false' } });
        body.push(el('div', { class: 'field' }, [
          el('label', { text: 'Type ' + opts.typed + ' to confirm', attrs: { for: 'confirm-typed' } }),
          typedInput
        ]));
      }
      body.push(el('div', { class: 'field is-error' }, msg));
      function finish(value, handle) {
        if (done) return;
        done = true;
        handle.close();
        resolve(value);
      }
      var m = modal({
        title: opts.title,
        body: el('div', { class: 'stack' }, body),
        onClose: function () { if (!done) { done = true; resolve(null); } },
        actions: [
          { label: 'Cancel', kind: 'btn-secondary', onClick: function (b, h) { finish(null, h); } },
          { label: opts.confirmLabel || 'Confirm', kind: opts.danger ? 'btn-danger' : 'btn-primary', onClick: function (b, h) {
            var reason = reasonInput ? reasonInput.value.trim() : null;
            if (reasonInput && reason.length < reasonMin) { msg.textContent = 'A reason of at least ' + reasonMin + ' characters is required.'; reasonInput.focus(); return; }
            if (typedInput && typedInput.value.trim() !== opts.typed) { msg.textContent = 'Type ' + opts.typed + ' exactly to confirm.'; typedInput.focus(); return; }
            finish({ reason: reason }, h);
          } }
        ]
      });
      void m;
    });
  }

  // ===========================================================================
  // router
  // ===========================================================================

  var pages = {};
  var order = [];
  var current = null;        // { path, cleanups, timers }
  var viewRoot = null;
  var onNavigate = null;

  /**
   * TCC.page('/dashboard', { title, group, render(ctx) })
   * render receives ctx: { root, query, every(ms, fn), onCleanup(fn), go(path), reload() }
   */
  function page(path, def) {
    if (!pages[path]) order.push(path);
    pages[path] = def;
  }

  function teardown() {
    if (!current) return;
    current.timers.forEach(function (t) { window.clearInterval(t); });
    current.cleanups.forEach(function (fn) { try { fn(); } catch (e) { /* a page's cleanup must not block navigation */ } });
    current = null;
  }

  function show(pathname, search) {
    var def = pages[pathname];
    teardown();
    clear(viewRoot);
    window.scrollTo(0, 0);
    if (!def) {
      viewRoot.appendChild(TCC.ui.state({ tag: 'NOT FOUND', title: 'There is no page at ' + pathname, body: 'Use the navigation to open a view.' }));
      if (onNavigate) onNavigate(pathname, null);
      return;
    }
    var state = { path: pathname, cleanups: [], timers: [], alive: true };
    current = state;
    state.cleanups.push(function () { state.alive = false; });
    var ctx = {
      root: viewRoot,
      path: pathname,
      query: new URLSearchParams(search || ''),
      alive: function () { return state.alive; },
      onCleanup: function (fn) { state.cleanups.push(fn); },
      /** Repeats fn while the page is open and the tab is visible. */
      every: function (ms, fn) {
        var t = window.setInterval(function () { if (state.alive && !document.hidden) fn(); }, ms);
        state.timers.push(t);
        return t;
      },
      go: go,
      reload: function () { show(pathname, search); }
    };
    document.title = def.title + ' — Mythos Trading Control Center';
    if (onNavigate) onNavigate(pathname, def);
    try {
      def.render(ctx);
    } catch (e) {
      clear(viewRoot);
      viewRoot.appendChild(TCC.ui.errorState(e, function () { show(pathname, search); }));
    }
    var h = viewRoot.querySelector('h1');
    if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e2) { /* focus is best-effort */ } }
  }

  function go(href) {
    var url = new URL(href, window.location.origin);
    if (url.pathname === window.location.pathname && url.search === window.location.search) return show(url.pathname, url.search);
    window.history.pushState({}, '', url.pathname + url.search);
    show(url.pathname, url.search);
  }

  function start(root, navigateCb) {
    viewRoot = root;
    onNavigate = navigateCb;
    window.addEventListener('popstate', function () { show(window.location.pathname, window.location.search); });
    // Internal links navigate client-side; everything else is left alone.
    document.addEventListener('click', function (ev) {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      var a = ev.target.closest ? ev.target.closest('a[data-link]') : null;
      if (!a) return;
      ev.preventDefault();
      go(a.getAttribute('href'));
    });
    show(window.location.pathname, window.location.search);
  }

  /** An internal link the router handles. */
  function link(href, text, cls) {
    return el('a', { class: cls || null, text: text, attrs: { href: href, 'data-link': '' } });
  }

  // ===========================================================================

  TCC.el = el;
  TCC.append = append;
  TCC.clear = clear;
  TCC.replace = replace;
  TCC.svg = svg;
  TCC.fmt = fmt;
  TCC.isNum = isNum;
  TCC.api = api;
  TCC.qs = qs;
  TCC.toast = toast;
  TCC.describeError = describeError;
  TCC.modal = modal;
  TCC.confirm = confirm;
  TCC.page = page;
  TCC.pages = function () { return order.map(function (p) { return { path: p, def: pages[p] }; }); };
  TCC.router = { start: start, go: go, show: show };
  TCC.link = link;
})();
