/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — UI kit
   projects/mythos-trading-control-center/web/assets/js/ui.js

   The components every page is built from: page head, card, KPI, table, pager,
   badge, tabs, form fields, key/value list, and the four whole-surface states.

   NO DATA IS A COMPONENT, NOT AN ABSENCE. value() and kpi() take the API's
   { available: false, reason } shape directly and render it as the words
   "NO DATA" with the reason beside it. There is no code path here that turns a
   missing value into 0, "—" or an empty cell: a blank where a number should be
   reads as "zero", and that would be a fabricated figure.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var fmt = TCC.fmt;
  var ui = {};

  // ---------------------------------------------------------------------------
  // text and values
  // ---------------------------------------------------------------------------

  /** The inline NO DATA marker. The reason is always shown, never a tooltip. */
  ui.noDataInline = function (reason) {
    return el('span', { class: 'nodata' }, [
      'NO DATA',
      reason ? el('span', { class: 'nodata-reason', text: reason }) : null
    ]);
  };

  /** "n/a" for a value that is legitimately undefined (e.g. profit factor with no losses). */
  ui.na = function (why) {
    return el('span', { class: 't-secondary', text: 'n/a', title: why || 'not applicable for this sample' });
  };

  /**
   * A formatted value, or n/a when the formatter returned null.
   * `sign` colours a signed number — and the sign character itself is the
   * non-colour channel, so the meaning never rests on the colour.
   */
  ui.value = function (text, opts) {
    var o = opts || {};
    if (text === null || text === undefined) return ui.na(o.naReason);
    var cls = 't-num';
    if (o.sign && TCC.isNum(o.sign)) cls += o.sign > 0 ? ' t-pos' : (o.sign < 0 ? ' t-neg' : '');
    return el('span', { class: cls, text: text });
  };

  ui.signedMoney = function (v, dp) { return ui.value(fmt.signedMoney(v, dp), { sign: v }); };

  // ---------------------------------------------------------------------------
  // badges — every badge is a word; the colour only repeats it
  // ---------------------------------------------------------------------------

  ui.badge = function (text, kind) {
    return el('span', { class: 'badge' + (kind ? ' is-' + kind : ''), text: text });
  };

  var KINDS = {
    // modes
    BACKTEST: 'neutral', PAPER: 'info',
    // generic statuses
    OK: 'ok', WARN: 'warn', FAIL: 'danger', UNKNOWN: 'neutral', BUSY: 'info', STOPPED: 'danger', UNAVAILABLE: 'neutral',
    COMPLETED: 'ok', RUNNING: 'info', FAILED: 'danger', TIMEOUT: 'danger', INTERRUPTED: 'warn', CANCELLED: 'warn',
    PASSED: 'ok', NO_TESTS: 'warn',
    // pipeline
    ENTER: 'ok', NO_TRADE: 'neutral', REJECT: 'warn', ALLOW: 'ok', CLAMP: 'warn', BLOCK: 'danger',
    WIN: 'ok', LOSS: 'danger', BREAKEVEN: 'neutral',
    // paper states
    IDLE: 'neutral', PAUSED: 'warn', HALTED: 'danger',
    // audit
    ACCEPTED: 'ok', REFUSED: 'warn',
    // chain
    RECORDED: 'ok', NOT_REACHED: 'neutral', NOT_RECORDED: 'warn',
    // research
    CHAMPION: 'attention', CHALLENGER: 'info', PROMOTED: 'ok', RETIRED: 'neutral', REJECTED: 'danger',
    APPROVE_AS_CHALLENGER: 'ok', INCONCLUSIVE: 'warn',
    // severity
    INFO: 'neutral', ERROR: 'danger',
    // data labels
    SYNTHETIC: 'warn', HISTORICAL: 'ok',
    ENABLED: 'ok', DISABLED: 'danger'
  };

  /** A status word as a badge, with the kind looked up from the word itself. */
  ui.status = function (word, labelOverride) {
    if (word === null || word === undefined) return ui.noDataInline();
    return ui.badge(labelOverride || fmt.words(word), KINDS[word] || 'neutral');
  };

  /** The Jev decision under the Control Center's labels, with the stored value kept visible. */
  ui.jevDecision = function (decision) {
    if (decision === 'ENTER') return ui.badge('ALLOW', 'ok');
    if (decision === 'REJECT') return ui.badge('BLOCK', 'warn');
    return ui.status(decision);
  };

  /** SYNTHETIC / HISTORICAL / PAPER — the label that must accompany every result. */
  ui.dataLabel = function (label) {
    if (!label) return ui.badge('UNLABELLED', 'danger');
    return ui.badge(label, label === 'PAPER' ? 'info' : (label === 'HISTORICAL' ? 'ok' : 'warn'));
  };

  ui.chip = function (text, title) { return el('span', { class: 'chip', text: text, title: title || null }); };

  ui.codes = function (codes) {
    if (!codes || !codes.length) return el('span', { class: 't-secondary', text: 'none recorded' });
    return el('span', { class: 'chips' }, codes.map(function (c) { return ui.chip(c); }));
  };

  ui.hash = function (h, n) {
    if (!h) return ui.na('not recorded');
    return el('span', { class: 'chip', text: fmt.hash(h, n || 12), title: h });
  };

  // ---------------------------------------------------------------------------
  // page structure
  // ---------------------------------------------------------------------------

  ui.pageHead = function (title, sub, actions) {
    return el('header', { class: 'page-head' }, [
      el('div', { class: 'grow' }, [
        el('h1', { class: 't-h1', text: title }),
        sub ? el('p', { text: sub }) : null
      ]),
      actions && actions.length ? el('div', { class: 'page-actions' }, actions) : null
    ]);
  };

  /**
   * card({ title, sub, actions, body, flush, foot })
   */
  ui.card = function (o) {
    var head = (o.title || o.actions) ? el('div', { class: 'card-head' }, [
      el('div', null, [
        o.title ? el('h2', { class: 't-h3', text: o.title }) : null,
        o.sub ? el('p', { class: 'card-sub', text: o.sub }) : null
      ]),
      o.actions ? el('div', { class: 'row-tight' }, o.actions) : null
    ]) : null;
    return el('section', { class: 'card' + (o.flush ? ' card-flush' : '') + (o.class ? ' ' + o.class : '') }, [
      head,
      o.body,
      o.foot ? el('div', { class: 'card-foot' }, o.foot) : null
    ]);
  };

  /**
   * kpi(label, content, sub)
   * `content` is a string, a Node, or an API { available:false, reason } object.
   */
  ui.kpi = function (label, content, sub, opts) {
    var o = opts || {};
    if (content && typeof content === 'object' && content.available === false) {
      return el('div', { class: 'kpi is-nodata' }, [
        el('div', { class: 'kpi-label', text: label }),
        el('div', { class: 'kpi-value', text: 'NO DATA' }),
        el('div', { class: 'kpi-sub', text: content.reason || 'no source for this value' })
      ]);
    }
    var valueNode = el('div', { class: 'kpi-value' + (o.text ? ' is-text' : '') + (o.accent ? ' is-accent' : '') });
    if (content === null || content === undefined) valueNode.appendChild(ui.na(o.naReason));
    else TCC.append(valueNode, content);
    return el('div', { class: 'kpi' }, [
      el('div', { class: 'kpi-label', text: label }),
      valueNode,
      sub ? el('div', { class: 'kpi-sub' }, sub) : null
    ]);
  };

  /** Which run a page is showing, and under which label. */
  ui.sourceLine = function (context) {
    if (!context) return null;
    if (context.available === false) return null;
    var names = { PAPER_SESSION: 'live paper session', BACKTEST_RUN: 'backtest run', PAPER_RUN: 'paper session (archived)' };
    return el('div', { class: 'source-line' }, [
      el('span', { text: 'Source' }),
      ui.dataLabel(context.label),
      el('span', { text: names[context.source] || context.source }),
      ui.chip(context.runId),
      context.live ? ui.badge('LIVE UPDATING', 'info') : null,
      context.finishedAt ? el('span', { text: 'finished ' + fmt.wall(context.finishedAt) }) : null,
      context.configHash ? el('span', null, ['config ', ui.hash(context.configHash)]) : null
    ]);
  };

  // ---------------------------------------------------------------------------
  // whole-surface states
  // ---------------------------------------------------------------------------

  ui.state = function (o) {
    return el('div', { class: 'state' + (o.error ? ' is-error' : '') + (o.compact ? ' is-compact' : ''), attrs: { role: o.error ? 'alert' : 'status' } }, [
      o.tag ? el('div', { class: 'state-tag', text: o.tag }) : null,
      o.title ? el('div', { class: 'state-title', text: o.title }) : null,
      o.body ? el('div', { class: 'state-body' }, o.body) : null,
      o.actions ? el('div', { class: 'state-actions' }, o.actions) : null
    ]);
  };

  /** NO DATA, with the reason the API gave and, where there is one, the way to produce data. */
  ui.noData = function (reason, actions) {
    return ui.state({
      tag: 'NO DATA',
      title: 'There is nothing to show yet',
      body: reason || 'No source exists for this view.',
      actions: actions
    });
  };

  ui.empty = function (title, body) {
    return ui.state({ tag: 'EMPTY', title: title, body: body, compact: true });
  };

  ui.errorState = function (e, retry) {
    var forbidden = e && e.status === 403;
    return ui.state({
      error: true,
      tag: forbidden ? 'NOT PERMITTED' : 'ERROR',
      title: forbidden ? 'Your role does not allow this' : 'This view could not be loaded',
      body: TCC.describeError(e) + (e && e.requestId ? ' (request ' + e.requestId + ')' : ''),
      actions: retry ? [el('button', { class: 'btn btn-secondary', text: 'Try again', attrs: { type: 'button' }, on: { click: retry } })] : null
    });
  };

  /** A static skeleton — no shimmer, no loop (MOTION-1). */
  ui.skeleton = function (kind) {
    if (kind === 'kpi') {
      return el('div', { class: 'grid grid-kpi', attrs: { 'aria-busy': 'true', 'aria-label': 'Loading' } },
        [0, 1, 2, 3].map(function () { return el('div', { class: 'skeleton h-kpi' }); }));
    }
    if (kind === 'chart') return el('div', { class: 'skeleton h-chart', attrs: { 'aria-busy': 'true', 'aria-label': 'Loading' } });
    return el('div', { attrs: { 'aria-busy': 'true', 'aria-label': 'Loading' } }, [
      el('div', { class: 'skeleton w-70' }), el('div', { class: 'skeleton w-100' }), el('div', { class: 'skeleton w-40' })
    ]);
  };

  ui.banner = function (kind, tag, content) {
    return el('div', { class: 'banner is-' + kind, attrs: { role: kind === 'danger' ? 'alert' : 'note' } }, [
      el('span', { class: 'banner-tag', text: tag }),
      el('div', { class: 'grow' }, content)
    ]);
  };

  ui.progress = function (value, max, label, kind) {
    var pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    var bar = el('span');
    bar.style.width = pct.toFixed(1) + '%';
    return el('div', null, [
      label ? el('div', { class: 'progress-label' }, [el('span', { text: label }), el('span', { class: 't-num', text: value + ' / ' + max })]) : null,
      el('div', { class: 'progress' + (kind ? ' is-' + kind : ''), attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': String(value) } }, bar)
    ]);
  };

  // ---------------------------------------------------------------------------
  // tables
  // ---------------------------------------------------------------------------

  /**
   * table({ columns: [{ label, num, render(row) }], rows, onRow(row), rowKey(row), selected, dense, empty })
   */
  ui.table = function (o) {
    if (!o.rows || o.rows.length === 0) {
      return o.empty || ui.empty('No rows', 'Nothing matches.');
    }
    var thead = el('thead', null, el('tr', null, o.columns.map(function (c) {
      return el('th', { class: c.num ? 'num' : null, text: c.label, attrs: { scope: 'col' } });
    })));
    var tbody = el('tbody', null, o.rows.map(function (row) {
      var tr = el('tr', null, o.columns.map(function (c) {
        var content = c.render(row);
        var td = el('td', { class: c.num ? 'num' : (c.class || null) });
        if (content === null || content === undefined) td.appendChild(ui.na());
        else TCC.append(td, content);
        return td;
      }));
      if (o.onRow) {
        tr.className = 'is-clickable';
        tr.setAttribute('tabindex', '0');
        tr.addEventListener('click', function () { o.onRow(row); });
        tr.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); o.onRow(row); } });
      }
      if (o.selected !== undefined && o.rowKey && o.rowKey(row) === o.selected) tr.className += ' is-selected';
      return tr;
    }));
    return el('div', { class: 'table-wrap' }, el('table', { class: 'table' + (o.dense ? ' table-dense' : '') }, [
      o.caption ? el('caption', { class: 'visually-hidden', text: o.caption }) : null, thead, tbody
    ]));
  };

  /** pager({ total, limit, offset, onChange(offset) }) */
  ui.pager = function (o) {
    var from = o.total === 0 ? 0 : o.offset + 1;
    var to = Math.min(o.total, o.offset + o.limit);
    function btn(label, target, disabled) {
      return el('button', { class: 'btn btn-secondary btn-compact', text: label, attrs: { type: 'button', disabled: disabled ? true : null },
        on: { click: function () { o.onChange(target); } } });
    }
    return el('div', { class: 'pager' }, [
      el('span', { class: 't-num', text: from + '–' + to + ' of ' + o.total }),
      el('div', { class: 'row-tight' }, [
        btn('Previous', Math.max(0, o.offset - o.limit), o.offset <= 0),
        btn('Next', o.offset + o.limit, o.offset + o.limit >= o.total)
      ])
    ]);
  };

  ui.kv = function (pairs) {
    var nodes = [];
    pairs.forEach(function (p) {
      if (!p) return;
      nodes.push(el('dt', { text: p[0] }));
      var dd = el('dd');
      if (p[1] === null || p[1] === undefined) dd.appendChild(ui.na());
      else TCC.append(dd, p[1]);
      nodes.push(dd);
    });
    return el('dl', { class: 'kv' }, nodes);
  };

  /** A horizontal bar list. items: [{ label, value, text, kind }] */
  ui.bars = function (items, opts) {
    var o = opts || {};
    if (!items || !items.length) return ui.empty('Nothing to chart', o.emptyText || 'No values recorded.');
    var max = Math.max.apply(null, items.map(function (i) { return Math.abs(i.value); }));
    return el('div', { class: 'bars', attrs: { role: 'list' } }, items.map(function (i) {
      var fill = el('span', { class: 'bar-fill' + (i.kind ? ' is-' + i.kind : '') });
      fill.style.width = (max > 0 ? (Math.abs(i.value) / max) * 100 : 0).toFixed(1) + '%';
      return el('div', { class: 'bar-row', attrs: { role: 'listitem' } }, [
        el('span', { class: 'bar-label', text: i.label, title: i.label }),
        el('span', { class: 'bar-track' }, fill),
        el('span', { class: 'bar-value', text: i.text === undefined ? String(i.value) : i.text })
      ]);
    }));
  };

  // ---------------------------------------------------------------------------
  // tabs
  // ---------------------------------------------------------------------------

  /** tabs([{ id, label }], activeId, onChange) */
  ui.tabs = function (items, active, onChange) {
    var buttons = [];
    var bar = el('div', { class: 'tabs', attrs: { role: 'tablist' } }, items.map(function (t) {
      var b = el('button', { class: 'tab', text: t.label, attrs: { type: 'button', role: 'tab', 'aria-selected': t.id === active ? 'true' : 'false' } });
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.setAttribute('aria-selected', 'false'); });
        b.setAttribute('aria-selected', 'true');
        onChange(t.id);
      });
      buttons.push(b);
      return b;
    }));
    return bar;
  };

  // ---------------------------------------------------------------------------
  // forms
  // ---------------------------------------------------------------------------

  var fieldSeq = 0;

  /** field({ label, hint, control }) — the label is always visible. */
  ui.field = function (o) {
    var id = o.control.id || ('f-' + (++fieldSeq));
    o.control.id = id;
    var msg = el('span', { class: 'msg', hidden: true });
    var node = el('div', { class: 'field' }, [
      el('label', { text: o.label, attrs: { for: id } }),
      o.control,
      o.hint ? el('span', { class: 'hint', text: o.hint }) : null,
      msg
    ]);
    node.setError = function (text) {
      node.className = 'field' + (text ? ' is-error' : '');
      msg.hidden = !text;
      msg.textContent = text || '';
    };
    return node;
  };

  ui.input = function (o) {
    var a = { type: o.type || 'text', autocomplete: o.autocomplete || 'off' };
    ['min', 'max', 'step', 'maxlength', 'placeholder', 'inputmode', 'name'].forEach(function (k) { if (o[k] !== undefined) a[k] = o[k]; });
    if (o.disabled) a.disabled = true;
    if (o.required) a.required = true;
    var node = el('input', { class: 'input' + (o.num ? ' t-num' : '') + (o.compact ? ' input-compact' : ''), attrs: a });
    if (o.value !== undefined && o.value !== null) node.value = String(o.value);
    if (o.onInput) node.addEventListener('input', function () { o.onInput(node.value); });
    return node;
  };

  /** select([{ value, label }] | ['a','b'], value, onChange) */
  ui.select = function (options, value, onChange, opts) {
    var o = opts || {};
    var node = el('select', { class: 'select' + (o.compact ? ' select-compact' : ''), attrs: { disabled: o.disabled ? true : null } },
      options.map(function (opt) {
        var v = typeof opt === 'string' ? opt : opt.value;
        var l = typeof opt === 'string' ? opt : opt.label;
        var n = el('option', { text: l, attrs: { value: v } });
        if (opt.disabled) n.disabled = true;
        return n;
      }));
    if (value !== undefined && value !== null) node.value = String(value);
    if (onChange) node.addEventListener('change', function () { onChange(node.value); });
    return node;
  };

  /** A rectangular switch whose state is also written out. */
  ui.switch = function (label, checked, onChange, opts) {
    var o = opts || {};
    var input = el('input', { attrs: { type: 'checkbox', role: 'switch', disabled: o.disabled ? true : null } });
    input.checked = !!checked;
    var text = el('span', { class: 'switch-text' });
    function paint() { text.textContent = label + ': ' + (input.checked ? (o.on || 'ON') : (o.off || 'OFF')); }
    paint();
    input.addEventListener('change', function () { paint(); if (onChange) onChange(input.checked, input); });
    var node = el('label', { class: 'switch' }, [input, el('span', { class: 'track' }), text]);
    node.input = input;
    node.set = function (v) { input.checked = !!v; paint(); };
    return node;
  };

  ui.checkbox = function (label, checked, onChange, opts) {
    var o = opts || {};
    var input = el('input', { attrs: { type: 'checkbox', disabled: o.disabled ? true : null } });
    input.checked = !!checked;
    if (onChange) input.addEventListener('change', function () { onChange(input.checked); });
    var node = el('label', { class: 'check' }, [input, el('span', { text: label })]);
    node.input = input;
    return node;
  };

  ui.button = function (label, kind, onClick, opts) {
    var o = opts || {};
    var b = el('button', { class: 'btn ' + (kind || 'btn-secondary') + (o.compact ? ' btn-compact' : ''), text: label,
      title: o.title || null, attrs: { type: o.type || 'button', disabled: o.disabled ? true : null } });
    if (onClick) b.addEventListener('click', function (ev) { onClick(b, ev); });
    return b;
  };

  /**
   * Runs an async action from a button: disables it while pending, restores
   * it afterwards, and reports a failure as a toast. The button's label says
   * what is happening — there is no spinner.
   */
  ui.run = function (button, busyLabel, fn) {
    if (button.disabled) return Promise.resolve(null);
    var label = button.textContent;
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = busyLabel;
    return Promise.resolve().then(fn).catch(function (e) {
      TCC.toast('danger', e && e.status === 403 ? 'Refused' : 'Failed', TCC.describeError(e));
      return null;
    }).then(function (r) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = label;
      return r;
    });
  };

  /**
   * Loads data into a host element with the three states every view has:
   * loading (static skeleton), failed (with retry), loaded.
   *   ui.load(host, function () { return api.get(...); }, function (data) { return Node; })
   */
  ui.load = function (host, fetcher, render, opts) {
    var o = opts || {};
    if (!o.silent) TCC.replace(host, ui.skeleton(o.skeleton));
    return Promise.resolve().then(fetcher).then(function (data) {
      if (o.alive && !o.alive()) return null;
      TCC.replace(host, render(data));
      return data;
    }).catch(function (e) {
      if (o.alive && !o.alive()) return null;
      if (e && e.status === 401) return null;
      TCC.replace(host, ui.errorState(e, function () { ui.load(host, fetcher, render, opts); }));
      return null;
    });
  };

  /** Permission hint beside a control the current role cannot use. */
  ui.needsRole = function (role) {
    return el('span', { class: 't-small t-secondary', text: 'Requires the ' + role + ' role.' });
  };

  TCC.ui = ui;
})();
