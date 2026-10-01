/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — explorer scaffolding
   projects/mythos-trading-control-center/web/assets/js/explore.js

   What the read-only views over a run share: choosing WHICH run they look at,
   a filter bar, a paged table, and the decision-chain renderer.

   Every explorer names its source. With no run chosen it follows the platform's
   context — the live paper session when there is one, otherwise the latest
   completed run — and says which that is. With no source at all it shows
   NO DATA and the reason; it never shows an empty table that looks like
   "nothing happened".
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;

  var REGIMES = ['TREND', 'RANGE', 'BREAKOUT', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'UNSTABLE'];
  var STAGES = ['SCHEDULE', 'REGIME', 'STRATEGY', 'COST', 'JEV', 'RISK', 'RECOVERY', 'ONE_TRADE', 'EXECUTION'];

  /** Keeps the query string in step with the page's state, without a navigation. */
  function setQuery(path, params) {
    window.history.replaceState({}, '', path + TCC.qs(params));
  }

  /**
   * The run selector. onChange(runId | null) fires when the operator picks one.
   * `null` means "follow the platform's context".
   */
  function runPicker(current, onChange) {
    var sel = ui.select([{ value: '', label: 'Current — live session, else latest run' }], '', function (v) { onChange(v || null); }, { compact: true });
    sel.setAttribute('aria-label', 'Run to explore');
    api.get('/api/backtest').then(function (list) {
      var opts = [{ value: '', label: 'Current — live session, else latest run' }];
      list.runs.filter(function (r) { return r.status === 'COMPLETED' || (r.kind !== 'BACKTEST' && r.status === 'FAILED'); }).forEach(function (r) {
        opts.push({ value: r.runId, label: r.runId + ' · ' + (r.label === 'PAPER' ? 'PAPER' : (r.data ? r.data.label : '')) +
          (r.summary && r.summary.headline ? ' · ' + r.summary.headline.trades + ' trades' : '') });
      });
      TCC.replace(sel, opts.map(function (o) { return el('option', { text: o.label, attrs: { value: o.value } }); }));
      sel.value = current || '';
    }).catch(function () { /* the picker keeps its single default option */ });
    return sel;
  }

  /** filterSelect('Asset', [{value,label}] | [strings], current, onChange) */
  function filterSelect(label, options, current, onChange) {
    var opts = [{ value: '', label: 'All' }].concat(options.map(function (o) { return typeof o === 'string' ? { value: o, label: fmt.words(o) } : o; }));
    var sel = ui.select(opts, current || '', function (v) { onChange(v || null); }, { compact: true });
    return ui.field({ label: label, control: sel });
  }

  /**
   * A paged, filtered list page.
   *
   * list({ ctx, path, endpoint, title, sub, filters: [{ key, label, options }], columns, onRow, summary(data) })
   */
  function list(o) {
    var ctx = o.ctx;
    var state = { run: ctx.query.get('run') || null, offset: 0, limit: 50 };
    (o.filters || []).forEach(function (f) { state[f.key] = ctx.query.get(f.key) || null; });
    var host = el('div', { id: o.id });
    var summaryHost = el('div');
    var filterHost = el('div', { class: 'filters' });
    var lastKey = null;

    function params() {
      var p = { run: state.run, limit: state.limit, offset: state.offset };
      (o.filters || []).forEach(function (f) { p[f.key] = state[f.key]; });
      return p;
    }
    function urlParams() {
      var p = { run: state.run };
      (o.filters || []).forEach(function (f) { p[f.key] = state[f.key]; });
      return p;
    }

    function load(silent) {
      return ui.load(host, function () { return api.get(o.endpoint, params()); }, function (res) {
        lastKey = JSON.stringify(res);
        if (res.context.available === false) {
          TCC.clear(summaryHost);
          return ui.noData(res.context.reason, [TCC.link('/backtest', 'Open the Backtest Center', 'btn btn-secondary')]);
        }
        TCC.replace(summaryHost, [ui.sourceLine(res.context), o.summary ? o.summary(res.data, res) : null]);
        var d = res.data;
        return ui.card({
          flush: true,
          body: el('div', null, [
            ui.table({
              dense: true, caption: o.title, columns: o.columns, rows: d.items, onRow: o.onRow ? function (row) { o.onRow(row, state); } : null,
              empty: ui.state({ tag: 'NO MATCH', compact: true, body: 'No row matches these filters in this source (' + d.total + ' of the filtered set).' })
            }),
            ui.pager({ total: d.total, limit: d.limit, offset: d.offset, onChange: function (off) { state.offset = off; load(true); } })
          ])
        });
      }, { silent: silent, alive: ctx.alive });
    }

    function change(key, value) {
      state[key] = value;
      state.offset = 0;
      setQuery(o.path, urlParams());
      load(true);
    }

    ctx.root.appendChild(ui.pageHead(o.title, o.sub, [runPicker(state.run, function (v) { change('run', v); })]));
    Promise.resolve(o.filterOptions ? o.filterOptions() : {}).then(function (extra) {
      if (!ctx.alive()) return;
      TCC.replace(filterHost, (o.filters || []).map(function (f) {
        return filterSelect(f.label, f.options || extra[f.key] || [], state[f.key], function (v) { change(f.key, v); });
      }));
    });
    ctx.root.appendChild(filterHost);
    ctx.root.appendChild(summaryHost);
    ctx.root.appendChild(host);
    load(false);
    // A live session keeps growing; a sealed run does not. Refresh quietly, and
    // only redraw when something actually changed.
    ctx.every(4000, function () {
      api.get(o.endpoint, params()).then(function (res) {
        if (!ctx.alive() || JSON.stringify(res) === lastKey || document.querySelector('.scrim')) return;
        load(true);
      }).catch(function () { /* the next beat retries */ });
    });
    return { state: state, reload: load };
  }

  /** Assets and strategies for the filter bars, from the configuration. */
  function configOptions() {
    return api.get('/api/config').then(function (cfg) {
      return {
        symbol: cfg.assets.map(function (a) { return a.symbol; }),
        strategy: cfg.strategies.map(function (s) { return { value: s.strategyId, label: s.strategyId }; })
      };
    }).catch(function () { return { symbol: [], strategy: [] }; });
  }

  function direction(d) { return d ? ui.badge(d, d === 'LONG' ? 'info' : 'neutral') : null; }

  function jevCell(j) {
    if (!j) return el('span', { class: 't-secondary', text: 'not reached' });
    return el('span', { class: 'row-tight' }, [ui.jevDecision(j.decision), el('span', { class: 't-num', text: fmt.num(j.score, 1) + ' / ' + fmt.num(j.confidence, 2) })]);
  }

  function riskCell(r) {
    if (!r) return el('span', { class: 't-secondary', text: 'not reached' });
    return el('span', { class: 'row-tight' }, [ui.status(r.verdict), el('span', { class: 't-num', text: fmt.lots(r.requestedLots) + ' → ' + fmt.lots(r.approvedLots) })]);
  }

  TCC.explore = {
    REGIMES: REGIMES,
    STAGES: STAGES,
    setQuery: setQuery,
    runPicker: runPicker,
    filterSelect: filterSelect,
    list: list,
    configOptions: configOptions,
    direction: direction,
    jevCell: jevCell,
    riskCell: riskCell
  };
})();
