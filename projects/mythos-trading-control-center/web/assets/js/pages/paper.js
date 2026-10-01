/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Paper / Demo control room
   projects/mythos-trading-control-center/web/assets/js/pages/paper.js

   Drives the Trading Agent's own paper session and shows what it records.

   WHAT THIS PAGE IS HONEST ABOUT
     · No order is sent anywhere. The paper adapter computes fills.
     · The feed is a REPLAY of synthetic bars — this build has no market data —
       so a session here is a mechanics check, not a forward test on real
       prices. The banner says so for as long as a session is on screen.
     · It cannot start outside PAPER mode, and PAPER needs an owner-approval
       record. When the platform is in BACKTEST the page explains that instead
       of offering a Start button that would only be refused.

   THE EVENT STREAM is server-sent events. Each event carries a sequence
   number; the browser reconnects by itself and resumes from the last one it
   saw, so a dropped connection loses nothing. If the server no longer holds
   the events a client asks for it says so (a `gap` event) and the page reloads
   the state rather than pretending the stream was complete.

   Every size shown is the Risk Engine's approved size. There is no control
   here that sets one.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;

  var STREAM_ROWS = 300;
  var TYPES = ['candidate', 'strategy', 'regime', 'jev', 'cost', 'risk', 'recovery', 'decision', 'execution', 'sl', 'tp', 'close', 'result', 'session', 'system', 'error'];

  function armTiles(arm) {
    return el('div', { class: 'grid grid-6' }, [
      ui.kpi('Balance', fmt.money(arm.balance)),
      ui.kpi('Equity', fmt.money(arm.equity)),
      ui.kpi('Net P&L', ui.signedMoney(arm.netProfit), ['return ', fmt.pctRaw(arm.returnPct, 3)]),
      ui.kpi('Drawdown', fmt.pctRaw(arm.drawdownPct), ['maximum ', fmt.pctRaw(arm.maxDrawdownPct)]),
      ui.kpi('Trades', fmt.int(arm.trades), arm.trades ? [fmt.int(arm.wins) + ' won · ' + fmt.int(arm.losses) + ' lost'] : 'none closed'),
      ui.kpi('Losing streak', fmt.int(arm.consecutiveLosses), ['maximum ', fmt.int(arm.maxConsecutiveLosses)])
    ]);
  }

  function positionCard(arm) {
    var p = arm.openPosition;
    var body;
    if (p) {
      body = ui.kv([
        ['Asset', p.symbol], ['Strategy', p.strategyId],
        ['Direction', ui.badge(p.direction, p.direction === 'LONG' ? 'info' : 'neutral')],
        ['Size', el('span', { class: 't-num', text: fmt.lots(p.lots) + ' lots (approved)' })],
        ['Entry', el('span', { class: 't-num', text: fmt.price(p.entryPrice) + ' at ' + fmt.barTime(p.entryTs) })],
        ['Stop / target', el('span', { class: 't-num', text: fmt.price(p.stopLoss) + ' / ' + fmt.price(p.takeProfit) })],
        ['Last close', ui.value(fmt.price(p.lastClose))],
        ['Regime / Jev', el('span', { class: 't-num', text: (p.regime || 'n/a') + ' / ' + (fmt.num(p.jevScore, 2) || 'n/a') })],
        ['Recovery level', el('span', { class: 't-num', text: String(p.recoveryLevel) })]
      ]);
    } else if (arm.pendingEntry) {
      body = ui.state({ tag: 'PENDING', compact: true, body: 'An entry on ' + arm.pendingEntry.symbol + ' (' + arm.pendingEntry.direction + ', ' +
        fmt.lots(arm.pendingEntry.lots) + ' lots) was decided at ' + fmt.barTime(arm.pendingEntry.decidedAtTs) + ' and fills at the next bar\'s open.' });
    } else {
      body = ui.state({ tag: 'NO DATA', compact: true, body: 'No position is open.' });
    }
    return ui.card({ title: 'Open position', sub: arm.emergencyStopped ? 'EMERGENCY STOPPED — ' + arm.emergencyReason : 'One trade globally.', body: body });
  }

  function pipelineCard(arm, engines) {
    var c = arm.counts;
    var rows = [
      ['Decisions asked', el('span', { class: 't-num', text: fmt.int(c.decisionsRequested) })],
      ['Entries filled', el('span', { class: 't-num', text: fmt.int(c.entriesFilled) })],
      ['Slot blocked', el('span', { class: 't-num', text: fmt.int(c.slotBlocked) })]
    ];
    if (engines) {
      if (engines.candidates) rows.unshift(['Candidates', el('span', { class: 't-num', text: fmt.int(engines.candidates.total) + ' — ' + fmt.int(engines.candidates.entered) + ' entered, ' + fmt.int(engines.candidates.rejected) + ' rejected' })]);
      if (engines.jev) rows.push(['Jev', el('span', { class: 't-num', text: fmt.int(engines.jev.allowed) + ' allow · ' + fmt.int(engines.jev.blocked) + ' block' })]);
      if (engines.risk) rows.push(['Risk Engine', el('span', { class: 't-num', text: fmt.int(engines.risk.byVerdict.ALLOW) + ' allow · ' + fmt.int(engines.risk.byVerdict.CLAMP) + ' clamp · ' + fmt.int(engines.risk.byVerdict.BLOCK) + ' block' })]);
      if (engines.recovery) rows.push(['Recovery', el('span', { class: 't-num', text: fmt.int(engines.recovery.transitions) + ' transition(s)' +
        (engines.recovery.perAsset.filter(function (a) { return a.recorded; }).map(function (a) { return ' · ' + a.symbol + ' L' + a.level; }).join('')) })]);
    }
    var stages = Object.keys(c.noTradeByStage || {}).sort();
    return ui.card({
      title: 'Candidates, Jev, Risk, Recovery',
      sub: 'Counts from the session\'s own store.',
      actions: [TCC.link('/candidates', 'Candidates'), TCC.link('/trades', 'Trades')],
      body: el('div', { class: 'stack-sm' }, [
        ui.kv(rows),
        stages.length ? el('div', null, [
          el('div', { class: 't-label', text: 'No-trade by stage' }),
          ui.bars(stages.map(function (s) { return { label: s, value: c.noTradeByStage[s], text: fmt.int(c.noTradeByStage[s]) }; }))
        ]) : null
      ])
    });
  }

  function tradesCard(trades) {
    return ui.card({
      title: 'Latest trades', flush: true,
      body: ui.table({
        dense: true,
        empty: ui.state({ tag: 'NO DATA', compact: true, body: 'No trade has closed in this session.' }),
        columns: [
          { label: 'Exit', render: function (t) { return el('span', { class: 't-num', text: fmt.barTime(t.exitTs) }); } },
          { label: 'Asset', render: function (t) { return t.symbol; } },
          { label: 'Strategy', render: function (t) { return t.strategyId; } },
          { label: 'Dir', render: function (t) { return t.direction; } },
          { label: 'Req → appr', num: true, render: function (t) { return (fmt.lots(t.requestedLots) || 'n/a') + ' → ' + (fmt.lots(t.approvedLots) || 'n/a'); } },
          { label: 'Exit reason', render: function (t) { return fmt.words(t.exitReason); } },
          { label: 'Net', num: true, render: function (t) { return ui.signedMoney(t.netPnl, 4); } }
        ],
        rows: trades || []
      })
    });
  }

  function comparisonCard(cmp) {
    return ui.card({
      title: 'Demo comparison', sub: cmp.note,
      body: ui.kv([
        ['Arms', cmp.armA + ' vs ' + cmp.armB],
        ['Net P&L delta', ui.signedMoney(cmp.netPnlDelta, 4)],
        ['Expectancy delta', ui.value(fmt.signedMoney(cmp.expectancyDelta, 4), { sign: cmp.expectancyDelta })],
        ['Drawdown delta', ui.value(fmt.num(cmp.drawdownDeltaPct, 4), { naReason: 'not computed' })],
        ['Losing-streak delta', el('span', { class: 't-num', text: String(cmp.streakDelta) })],
        ['Trades', el('span', { class: 't-num', text: cmp.tradeCountA + ' vs ' + cmp.tradeCountB })]
      ])
    });
  }

  // ---------------------------------------------------------------------------
  // the start dialog
  // ---------------------------------------------------------------------------

  function startDialog(options, registry, onStarted) {
    var kinds = options.data.kinds.filter(function (k) { return k.available; });
    var kindSel = ui.select(kinds.map(function (k) { return { value: k.kind, label: k.kind + ' — ' + k.label.toLowerCase() }; }), 'FIXTURE');
    var bars = ui.input({ type: 'number', value: 1200, min: 300, max: 6000, step: '1', num: true });
    var seed = ui.input({ value: 'paper-session', maxlength: 64 });
    var speed = ui.select([{ value: '4', label: '4 ticks / second' }, { value: '20', label: '20 ticks / second' },
      { value: '100', label: '100 ticks / second' }, { value: '400', label: '400 ticks / second' }], '20');
    var symbolHost = el('div', { class: 'row-tight' });
    var boxes = [];
    function paintSymbols() {
      var kind = kinds.filter(function (k) { return k.kind === kindSel.value; })[0];
      var available = kind.symbols.filter(function (s) { return options.universe.indexOf(s) !== -1; });
      boxes = available.map(function (s, i) { return { symbol: s, box: ui.checkbox(s, i === 0) }; });
      TCC.replace(symbolHost, boxes.length ? boxes.map(function (b) { return b.box; })
        : el('span', { class: 't-small t-secondary', text: 'No asset in the configured universe has ' + kind.kind.toLowerCase() + ' data.' }));
      seedField.hidden = kindSel.value !== 'SYNTHETIC';
    }
    var challengers = (registry.challengers || []).filter(function (c) { return c.state === 'CHALLENGER' && c.override; });
    var demoSel = ui.select([{ value: '', label: 'PAPER — one arm, the running configuration' }].concat(challengers.map(function (c) {
      return { value: c.recordId, label: 'DEMO — champion vs challenger ' + c.recordId };
    })), '');
    var seedField = ui.field({ label: 'Seed', hint: 'The synthetic series is reproducible from it.', control: seed });
    kindSel.addEventListener('change', paintSymbols);
    var error = el('div');
    var body = el('div', { class: 'stack' }, [
      ui.banner('warn', 'Replay', 'The feed replays synthetic bars one timestamp at a time. No order is sent anywhere.'),
      el('div', { class: 'form-grid' }, [
        ui.field({ label: 'Session type', hint: challengers.length ? null : 'DEMO needs a registered challenger (Research).', control: demoSel }),
        ui.field({ label: 'Data', control: kindSel }),
        ui.field({ label: 'Bars', hint: '300 – 6000.', control: bars }),
        seedField,
        ui.field({ label: 'Speed', control: speed })
      ]),
      el('fieldset', null, [el('legend', { class: 't-label', text: 'Assets' }), symbolHost]),
      error
    ]);
    paintSymbols();
    TCC.modal({
      title: 'Start a paper session', body: body,
      actions: [
        { label: 'Cancel', kind: 'btn-secondary', onClick: function (b, h) { h.close(); } },
        { label: 'Start session', kind: 'btn-primary', onClick: function (b, h) {
          var symbols = boxes.filter(function (x) { return x.box.input.checked; }).map(function (x) { return x.symbol; });
          if (!symbols.length) { TCC.replace(error, ui.banner('danger', 'Assets', 'Choose at least one asset.')); return; }
          var req = { data: { kind: kindSel.value, symbols: symbols, bars: Number(bars.value) }, ticksPerSecond: Number(speed.value) };
          if (kindSel.value === 'SYNTHETIC') req.data.seed = seed.value.trim() || 'paper-session';
          if (demoSel.value) req.demo = { challengerRecordId: demoSel.value };
          ui.run(b, 'Starting…', function () {
            return api.post('/api/paper/start', req).then(function (res) {
              h.close();
              TCC.toast('ok', 'Started', 'Session ' + res.result.session.sessionId + '. Audit entry #' + res.audit.seq + '.');
              onStarted();
            }).catch(function (e) { TCC.replace(error, ui.banner('danger', 'Refused', TCC.describeError(e))); });
          });
        } }
      ]
    });
  }

  // ---------------------------------------------------------------------------
  // the page
  // ---------------------------------------------------------------------------

  TCC.page('/paper', {
    title: 'Paper / Demo',
    nav: 'Paper / Demo',
    render: function (ctx) {
      var controls = el('div', { class: 'controls' });
      var stateHost = el('div', { id: 'paper-state', class: 'stack' });
      var streamHost = el('div', { class: 'stream', id: 'paper-stream', attrs: { role: 'log', 'aria-label': 'Session events', 'aria-live': 'off' } });
      var streamStatus = el('span', { class: 'badge is-neutral', id: 'paper-stream-status', text: 'stream: connecting' });
      var filterSel = ui.select([{ value: '', label: 'All events' }].concat(TYPES.map(function (t) { return { value: t, label: t }; })), '', function () { repaintStream(); }, { compact: true });
      filterSel.setAttribute('aria-label', 'Filter events by type');

      var view = null;
      var engines = null;
      var trades = null;
      var buffer = [];          // newest last
      var lastSeq = 0;
      var source = null;
      var lastKey = null;

      ctx.root.appendChild(ui.pageHead('Paper / Demo',
        'The Trading Agent\'s own paper session, one tick at a time. PAPER mode only; no order is sent anywhere.', [controls]));
      ctx.root.appendChild(stateHost);
      ctx.root.appendChild(ui.card({
        title: 'Event stream', sub: 'candidate · strategy · regime · Jev · risk · recovery · execution · SL · TP · close · result',
        actions: [streamStatus, filterSel], flush: true, body: streamHost
      }));
      TCC.replace(stateHost, ui.skeleton('kpi'));

      // ---- controls -------------------------------------------------------

      function act(path, busy, body) {
        return function (b) {
          ui.run(b, busy, function () {
            return api.post(path, body || {}).then(function (res) { paint(res.result); refresh(); });
          });
        };
      }

      function paintControls() {
        var op = api.can('operate');
        var s = view.state;
        var nodes = [ui.status(s)];
        if (!view.paperModeActive && s === 'IDLE') {
          nodes.push(el('span', { class: 't-small t-secondary', text: 'Needs PAPER mode.' }));
        } else if (s === 'IDLE') {
          nodes.push(ui.button('Start…', 'btn-primary', function () {
            Promise.all([api.get('/api/backtest/options'), api.get('/api/research')]).then(function (r) {
              startDialog(r[0], r[1].registry, refresh);
            }).catch(function (e) { TCC.toast('danger', 'Failed', TCC.describeError(e)); });
          }, { disabled: !op || !view.tradingEnabled, title: view.tradingEnabled ? null : 'Trading is disabled' }));
          if (!view.tradingEnabled) nodes.push(el('span', { class: 't-small t-secondary', text: 'Trading is disabled; enable it in the Control Center.' }));
        }
        if (s === 'RUNNING') nodes.push(ui.button('Pause', 'btn-secondary', act('/api/paper/pause', 'Pausing…'), { disabled: !op }));
        if (s === 'PAUSED') nodes.push(ui.button('Resume', 'btn-primary', act('/api/paper/resume', 'Resuming…'), { disabled: !op }));
        if (s === 'RUNNING' || s === 'PAUSED') nodes.push(ui.button('Stop', 'btn-danger', act('/api/paper/stop', 'Stopping…'), { disabled: !op }));
        if (s !== 'IDLE') {
          nodes.push(ui.button('Reset…', 'btn-secondary', function (b) {
            TCC.confirm({
              title: 'Reset the control room',
              message: (s === 'RUNNING' || s === 'PAUSED' ? 'The active session is stopped and archived first. ' : '') +
                'The session is archived as a run — nothing it recorded is deleted — and the room returns to IDLE.',
              typed: 'RESET', confirmLabel: 'Reset', danger: true
            }).then(function (a) {
              if (!a) return;
              ui.run(b, 'Resetting…', function () {
                return api.post('/api/paper/reset', { confirm: 'RESET' }).then(function (res) {
                  TCC.toast('ok', 'Reset', 'The room is IDLE. Audit entry #' + res.audit.seq + '.');
                  paint(res.result); refresh();
                });
              });
            });
          }, { disabled: !op }));
        }
        if (!op) nodes.push(ui.needsRole('OPERATOR'));
        TCC.replace(controls, nodes);
      }

      // ---- state ----------------------------------------------------------

      function paint(v) {
        view = v;
        paintControls();
        var session = v.session;
        var nodes = [];
        if (!session) {
          nodes.push(v.paperModeActive
            ? ui.state({ tag: 'NO SESSION', title: 'No paper session', body: 'Start one to begin. ' + v.feedNote })
            : ui.state({ tag: 'NO DATA', title: 'The platform is in ' + v.mode, body: v.reason, actions: [TCC.link('/control', 'Open the Control Center', 'btn btn-secondary')] }));
          if (v.lastArchived) {
            nodes.push(el('p', { class: 't-small t-secondary' }, ['Last session ', ui.chip(v.lastArchived.sessionId), ' was archived (' +
              fmt.words(v.lastArchived.stopReason) + '). ', TCC.link('/backtest?run=' + v.lastArchived.sessionId, 'Open it as a run')]));
          }
          TCC.replace(stateHost, nodes);
          return;
        }
        nodes.push(el('div', { class: 'source-line' }, [
          ui.dataLabel('PAPER'), ui.badge(session.kind, session.kind === 'DEMO' ? 'attention' : 'info'), ui.chip(session.sessionId),
          el('span', { text: session.data.symbols.join(', ') + ' · ' + session.data.timeframe + ' · ' + session.data.kind.toLowerCase() + ' data (' + session.data.dataLabel + ')' }),
          el('span', null, ['config ', ui.hash(session.configHash)]),
          el('span', { text: 'started ' + fmt.wall(session.startedAt) + (session.startedBy ? ' by ' + session.startedBy.id : '') })
        ]));
        nodes.push(ui.banner('warn', 'Paper', v.feedNote + ' Figures validate mechanics only.'));
        if (session.error) nodes.push(ui.banner('danger', 'Halted', session.error.code + ': ' + session.error.message));
        if (!session.configCurrent) nodes.push(ui.banner('warn', 'Configuration', 'The platform configuration changed after this session started; it ran under ' + session.configHash.slice(0, 12) + '.'));
        if (session.stopReason) nodes.push(el('p', { class: 't-small t-secondary', text: 'Stopped ' + fmt.wall(session.stoppedAt) + ' — ' + fmt.words(session.stopReason) + '. Archived as a run; reset to start another.' }));
        nodes.push(ui.progress(session.ticks, session.totalTicks || session.ticks, 'Feed progress (ticks) at ' + session.ticksPerSecond + ' / second', v.state === 'HALTED' ? 'danger' : null));
        session.arms.forEach(function (arm) {
          if (session.arms.length > 1) nodes.push(el('h2', { class: 't-label', text: 'Arm: ' + arm.label + ' · config ' + arm.configHash.slice(0, 12) }));
          nodes.push(armTiles(arm));
        });
        var main = session.arms[0];
        nodes.push(el('div', { class: 'grid grid-2' }, [positionCard(main), pipelineCard(main, engines)]));
        if (session.comparison) nodes.push(comparisonCard(session.comparison));
        nodes.push(tradesCard(trades));
        TCC.replace(stateHost, nodes);
      }

      function refresh() {
        return api.get('/api/paper').then(function (v) {
          if (!ctx.alive()) return;
          var jobs = [Promise.resolve(v)];
          if (v.session) {
            jobs.push(api.get('/api/candidates', { limit: 1 }), api.get('/api/jev'), api.get('/api/risk'), api.get('/api/recovery'), api.get('/api/trades', { limit: 8 }));
          }
          return Promise.all(jobs).then(function (r) {
            if (!ctx.alive()) return;
            if (v.session && r[1].context.available && r[1].context.runId === v.session.sessionId) {
              engines = { candidates: r[1].data, jev: r[2].data, risk: r[3].data, recovery: r[4].data };
              trades = r[5].data.items;
            } else { engines = null; trades = null; }
            var key = JSON.stringify([v, engines, trades]);
            if (key === lastKey) return;
            lastKey = key;
            paint(v);
          });
        }).catch(function (e) {
          if (!ctx.alive() || (e && e.status === 401)) return;
          if (!view) TCC.replace(stateHost, ui.errorState(e, refresh));
        });
      }

      // ---- event stream ---------------------------------------------------

      function row(ev) {
        var loss = ev.type === 'result' && ev.data && ev.data.outcome === 'LOSS';
        return el('div', { class: 'stream-row is-' + ev.type + (loss ? ' is-loss' : ''), attrs: { 'data-seq': ev.seq } }, [
          el('span', { class: 't-num t-secondary', text: '#' + ev.seq }),
          el('span', { class: 'stream-type', text: ev.type }),
          el('span', { class: 'stream-text t-wrap' }, [
            ev.ts ? el('span', { class: 't-num t-secondary', text: fmt.barTime(ev.ts) + '  ' }) : null,
            ev.arm && view && view.session && view.session.arms.length > 1 ? el('span', { class: 't-secondary', text: '[' + ev.arm + '] ' }) : null,
            ev.summary
          ])
        ]);
      }

      function repaintStream() {
        var f = filterSel.value;
        var rows = buffer.filter(function (e) { return !f || e.type === f; }).slice(-STREAM_ROWS).reverse().map(row);
        TCC.replace(streamHost, rows.length ? rows
          : ui.state({ tag: 'NO DATA', compact: true, body: buffer.length ? 'No event of this type yet.' : 'No event has been emitted. Events appear here as the session records them.' }));
      }

      function accept(ev) {
        if (ev.seq <= lastSeq) return;          // a replayed event after a reconnect
        lastSeq = ev.seq;
        buffer.push(ev);
        if (buffer.length > 2000) buffer.splice(0, buffer.length - 2000);
        var f = filterSel.value;
        if (f && ev.type !== f) return;
        if (streamHost.firstChild && streamHost.firstChild.classList && streamHost.firstChild.classList.contains('state')) TCC.clear(streamHost);
        streamHost.insertBefore(row(ev), streamHost.firstChild);
        while (streamHost.children.length > STREAM_ROWS) streamHost.removeChild(streamHost.lastChild);
      }

      function setStream(text, kind) {
        streamStatus.className = 'badge is-' + kind;
        streamStatus.textContent = 'stream: ' + text;
      }

      function connect() {
        if (!window.EventSource) { setStream('polling', 'warn'); return; }
        source = new EventSource('/api/paper/stream');
        source.addEventListener('ready', function () { setStream('connected', 'ok'); });
        source.addEventListener('paper', function (m) { try { accept(JSON.parse(m.data)); } catch (e) { /* a malformed frame is skipped */ } });
        source.addEventListener('gap', function () {
          // The server no longer holds everything since our cursor. Say so and
          // take the state from the API instead of trusting a partial stream.
          TCC.toast('warn', 'Stream', 'Some events were no longer available; the state was reloaded.');
          refresh();
        });
        source.onerror = function () {
          // EventSource reconnects on its own and resends Last-Event-ID.
          setStream(source.readyState === 2 ? 'closed' : 'reconnecting', 'warn');
        };
      }

      // Polling backstop: also the only path when EventSource is unavailable.
      function pollEvents() {
        if (source && source.readyState === 1) return;
        api.get('/api/paper/events', { since: lastSeq, limit: 500 }).then(function (r) {
          if (!ctx.alive()) return;
          r.items.forEach(accept);
        }).catch(function () { /* the next beat retries */ });
      }

      repaintStream();
      refresh().then(function () {
        if (!ctx.alive()) return;
        connect();
      });
      ctx.every(1500, function () { refresh(); });
      ctx.every(4000, pollEvents);
      ctx.onCleanup(TCC.onStatus(function () { refresh(); }));
      ctx.onCleanup(function () { if (source) source.close(); });
    }
  });
})();
