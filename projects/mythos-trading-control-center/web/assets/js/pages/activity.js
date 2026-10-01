/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Activity
   projects/mythos-trading-control-center/web/assets/js/pages/activity.js

   One timeline over three sources: the audit chain (what operators did), this
   process (runs, test runs, system events) and the store of a run (what the
   Trading Agent recorded).

   TWO CLOCKS, NEVER MIXED. Operator actions carry the wall clock. Store rows
   carry the BAR's time — the simulated time of the data, which for a fixture
   is a date in the past. Sorting the two into one sequence would show a 2023
   trade "before" the configuration change that produced it. So wall-clock
   events come first, newest first, then the store's events in reverse bar
   order — and every row says which clock it is on.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;
  var ex = TCC.explore;

  var SEVERITY_KIND = { INFO: 'neutral', WARN: 'warn', ERROR: 'danger' };

  function refCell(e) {
    var r = e.ref;
    if (!r) return el('span', { class: 't-secondary', text: e.source === 'CONTROL_CENTER' ? 'this process' : 'none' });
    if (r.auditSeq) return TCC.link('/system?audit=' + r.auditSeq, 'audit #' + r.auditSeq, 'chip');
    if (r.testRunId) return TCC.link('/testing?run=' + encodeURIComponent(r.testRunId), r.testRunId, 'chip');
    if (r.runId) return TCC.link('/backtest?run=' + encodeURIComponent(r.runId), r.runId, 'chip');
    if (r.tradeId) return ui.chip(r.tradeId);
    if (r.candidateId) return ui.chip(r.candidateId);
    return el('span', { class: 't-secondary', text: 'none' });
  }

  function dayStart(v) { var t = Date.parse(v + 'T00:00:00Z'); return isNaN(t) ? null : t; }
  function dayEnd(v) { var t = Date.parse(v + 'T23:59:59Z'); return isNaN(t) ? null : t + 999; }

  TCC.page('/activity', {
    title: 'Activity',
    render: function (ctx) {
      var q = ctx.query;
      var state = {
        run: q.get('run') || null, type: q.get('type') || null, severity: q.get('severity') || null,
        asset: q.get('asset') || null, strategy: q.get('strategy') || null,
        from: q.get('from') || null, to: q.get('to') || null, offset: 0, limit: 100
      };
      var host = el('div', { id: 'activity-body' });
      var filterHost = el('div', { class: 'filters', id: 'activity-filters' });
      var last = null;

      ctx.root.appendChild(ui.pageHead('Activity', 'Configuration changes, agent events, candidates, decisions, trades, risk, Jev, recovery, tests, backtests, paper sessions, errors and warnings.',
        [ex.runPicker(state.run, function (v) { state.run = v; state.offset = 0; sync(); load(false); })]));
      ctx.root.appendChild(filterHost);
      ctx.root.appendChild(host);

      function sync() {
        ex.setQuery('/activity', { run: state.run, type: state.type, severity: state.severity, asset: state.asset, strategy: state.strategy, from: state.from, to: state.to });
      }
      function params() {
        return { run: state.run, type: state.type, severity: state.severity, asset: state.asset, strategy: state.strategy,
          fromTs: state.from ? dayStart(state.from) : null, toTs: state.to ? dayEnd(state.to) : null, limit: state.limit, offset: state.offset };
      }
      function set(key) { return function (v) { state[key] = v || null; state.offset = 0; sync(); load(true); }; }

      function dateField(label, key, id) {
        var input = ui.input({ type: 'date', value: state[key] || '', compact: true });
        input.id = id;
        input.addEventListener('change', function () { set(key)(input.value); });
        return ui.field({ label: label, control: input });
      }

      // The filter bar is built once: its options come from the configuration,
      // not from the page of results, so a filter never removes its own choices.
      api.get('/api/config').then(function (cfg) {
        if (!ctx.alive()) return;
        var types = ['configuration', 'agent', 'candidate', 'decision', 'trade', 'risk', 'jev', 'recovery', 'test', 'backtest', 'paper', 'error', 'warning', 'system'];
        TCC.replace(filterHost, [
          ex.filterSelect('Type', types.map(function (t) { return { value: t, label: t }; }), state.type, set('type')),
          ex.filterSelect('Severity', ['INFO', 'WARN', 'ERROR'], state.severity, set('severity')),
          ex.filterSelect('Asset', cfg.assets.map(function (a) { return { value: a.symbol || a, label: a.symbol || a }; }), state.asset, set('asset')),
          ex.filterSelect('Strategy', cfg.strategies.map(function (s) { return { value: s.strategyId || s.id || s, label: s.strategyId || s.id || s }; }), state.strategy, set('strategy')),
          dateField('From (UTC day)', 'from', 'activity-from'),
          dateField('To (UTC day)', 'to', 'activity-to'),
          el('div', { class: 'field' }, [el('span', { class: 't-label', text: ' ' }),
            ui.button('Clear filters', 'btn-ghost', function () {
              state.type = state.severity = state.asset = state.strategy = state.from = state.to = null;
              state.offset = 0;
              Array.prototype.forEach.call(filterHost.querySelectorAll('select, input'), function (n) { n.value = ''; });
              sync(); load(true);
            }, { compact: true })])
        ]);
        filterHost.querySelectorAll('.field select')[0].id = 'activity-type';
        filterHost.querySelectorAll('.field select')[1].id = 'activity-severity';
        filterHost.querySelectorAll('.field select')[2].id = 'activity-asset';
        filterHost.querySelectorAll('.field select')[3].id = 'activity-strategy';
      }).catch(function () { /* the list still loads; only the filter bar is missing */ });

      function load(silent) {
        return ui.load(host, function () { return api.get('/api/activity', params()); }, function (d) {
          last = JSON.stringify([d.total, d.items.length ? d.items[0] : null, d.storeSource]);
          var src = d.storeSource;
          return el('div', { class: 'stack' }, [
            src.available === false
              ? el('div', { class: 'source-line' }, [el('span', { text: 'Store events' }), ui.badge('NO DATA', 'neutral'), el('span', { text: src.reason })])
              : el('div', { class: 'source-line' }, [el('span', { text: 'Store events from' }), ui.dataLabel(src.label), ui.chip(src.runId), src.live ? ui.badge('LIVE UPDATING', 'info') : null]),
            el('p', { class: 't-small t-secondary t-wrap', text: 'Two clocks, never mixed. WALL: ' + d.clocks.WALL + '. BAR: ' + d.clocks.BAR +
              '. Wall-clock events are listed first; a date filter is applied to each event on its own clock.' }),
            ui.card({
              title: fmt.int(d.total) + ' event(s)', flush: true,
              body: el('div', null, [
                ui.table({
                  dense: true, caption: 'Activity',
                  empty: ui.state({ tag: 'NOTHING MATCHES', compact: true, title: 'No event matches these filters',
                    body: src.available === false ? 'There are no store events yet either: ' + src.reason : 'Widen or clear the filters.' }),
                  columns: [
                    { label: 'When', render: function (e) { return el('span', { class: 't-num', text: e.clock === 'WALL' ? fmt.wall(e.at) : fmt.barTime(e.ts) }); } },
                    { label: 'Clock', render: function (e) { return ui.badge(e.clock, e.clock === 'WALL' ? 'neutral' : 'info'); } },
                    { label: 'Type', render: function (e) { return ui.chip(e.type); } },
                    { label: 'Severity', render: function (e) { return ui.badge(e.severity, SEVERITY_KIND[e.severity] || 'neutral'); } },
                    { label: 'Asset', render: function (e) { return e.asset || el('span', { class: 't-secondary', text: '—' }); } },
                    { label: 'Strategy', render: function (e) { return e.strategy || el('span', { class: 't-secondary', text: '—' }); } },
                    { label: 'Event', render: function (e) { return el('span', { class: 't-small t-wrap', text: e.message }); } },
                    { label: 'Record', render: refCell }
                  ],
                  rows: d.items
                }),
                d.total > d.limit ? ui.pager({ total: d.total, limit: d.limit, offset: d.offset, onChange: function (off) { state.offset = off; load(true); } }) : null
              ])
            })
          ]);
        }, { silent: silent, alive: ctx.alive });
      }
      load(false);
      ctx.every(5000, function () {
        if (state.offset !== 0) return;       // a reader on a later page is not moved
        api.get('/api/activity', params()).then(function (d) {
          var key = JSON.stringify([d.total, d.items.length ? d.items[0] : null, d.storeSource]);
          if (ctx.alive() && key !== last) load(true);
        }).catch(function () { /* the next beat retries */ });
      });
    }
  });
})();
