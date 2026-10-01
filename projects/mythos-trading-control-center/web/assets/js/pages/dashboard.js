/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Dashboard
   projects/mythos-trading-control-center/web/assets/js/pages/dashboard.js

   One screen that answers "what state is the platform in, and what did it last
   do?" Every figure is the API's — /api/dashboard — and every figure says
   where it came from.

   THE RULE OF THIS PAGE: NEVER FABRICATE. Each block of the API response is
   either { available: true, … } or { available: false, reason }. The second
   kind is rendered as NO DATA with the reason, in the same place the value
   would have been. Before the first backtest there is no balance, so the
   Balance tile says NO DATA — it does not say $0.00.

   A figure from a completed backtest is also not a live account, and the page
   says that too: the source line names the run and carries its SYNTHETIC label.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;

  /** A KPI whose block may be unavailable. `pick` builds the tile from an available block. */
  function tile(label, block, pick) {
    if (!block || block.available === false) return ui.kpi(label, block || { available: false, reason: 'not reported' });
    return pick(block);
  }

  function accountTiles(d) {
    var a = d.account;
    return el('div', { class: 'grid grid-kpi' }, [
      tile('Balance', a, function (x) { return ui.kpi('Balance', fmt.money(x.balance)); }),
      tile('Equity', a, function (x) { return ui.kpi('Equity', fmt.money(x.equity)); }),
      tile('Net P&L', a, function (x) {
        return ui.kpi('Net P&L', ui.signedMoney(x.netPnl), x.returnPct !== undefined ? ['return ', fmt.pctRaw(x.returnPct, 3)] : 'after all costs');
      }),
      tile('Drawdown', a, function (x) {
        return ui.kpi('Drawdown', fmt.pctRaw(x.drawdownPct),
          x.maxDrawdownPct !== undefined ? ['maximum ', fmt.pctRaw(x.maxDrawdownPct)] : 'current, from peak equity');
      })
    ]);
  }

  function performanceTiles(d) {
    var p = d.performance;
    return el('div', { class: 'grid grid-6' }, [
      tile('Trades', p, function (x) { return ui.kpi('Trades', fmt.int(x.trades), x.insufficient ? 'fewer than 20 — not evidence' : 'closed'); }),
      tile('Win rate', p, function (x) { return ui.kpi('Win rate', fmt.pct(x.winRate), null, { naReason: 'no trade has closed' }); }),
      tile('Profit factor', p, function (x) { return ui.kpi('Profit factor', fmt.num(x.profitFactor, 3), 'net wins ÷ net losses', { naReason: 'no losing trade in the sample' }); }),
      tile('Expectancy', p, function (x) { return ui.kpi('Expectancy', ui.value(fmt.signedMoney(x.expectancy, 4), { sign: x.expectancy }), 'net, per trade', { naReason: 'no trade has closed' }); }),
      tile('Losing streak', p, function (x) { return ui.kpi('Losing streak', fmt.int(x.losingStreak), 'current'); }),
      tile('Max losing streak', p, function (x) { return ui.kpi('Max losing streak', fmt.int(x.maxLosingStreak), 'longest recorded'); })
    ]);
  }

  function stateTiles(d) {
    var s = d.agentStatus;
    var h = d.health;
    return el('div', { class: 'grid grid-kpi' }, [
      ui.kpi('Agent status', fmt.words(s.state), s.detail, { text: true }),
      ui.kpi('Mode', ui.status(d.mode), d.mode === 'PAPER' ? 'reached by an owner-approval record' : 'the default; no order is simulated outside a run', { text: true }),
      ui.kpi('Trading status', ui.status(d.tradingStatus), d.tradingStatus === 'DISABLED' ? 'the Risk Engine blocks every candidate' : 'the Risk Engine decides each candidate', { text: true }),
      ui.kpi('Health', ui.status(h.status), [h.counts.ok + ' ok · ' + h.counts.warn + ' warn · ' + h.counts.fail + ' fail · ' + h.counts.unknown + ' unknown'], { text: true })
    ]);
  }

  function openPosition(d) {
    var o = d.openPosition;
    var body;
    if (!o || o.available === false) {
      body = ui.state({ tag: 'NO DATA', compact: true, body: (o && o.reason) || 'not reported' });
    } else {
      var p = o.position;
      body = ui.kv([
        ['Asset', p.symbol],
        ['Strategy', p.strategyId],
        ['Direction', ui.badge(p.direction, p.direction === 'LONG' ? 'info' : 'neutral')],
        ['Size', el('span', { class: 't-num', text: fmt.lots(p.lots) + ' lots (Risk Engine approved)' })],
        ['Entry', el('span', { class: 't-num', text: fmt.price(p.entryPrice) + ' at ' + fmt.barTime(p.entryTs) })],
        ['Stop / target', el('span', { class: 't-num', text: fmt.price(p.stopLoss) + ' / ' + fmt.price(p.takeProfit) })],
        ['Last close', ui.value(fmt.price(p.lastClose))],
        ['Recovery level', el('span', { class: 't-num', text: String(p.recoveryLevel) })]
      ]);
    }
    return ui.card({ title: 'Open position', sub: 'At most one position is open at any instant.', body: body });
  }

  function regime(d) {
    var r = d.regime;
    var body;
    if (!r || r.available === false) body = ui.state({ tag: 'NO DATA', compact: true, body: (r && r.reason) || 'not reported' });
    else {
      body = el('div', { class: 'stack-sm' }, [
        ui.kv(Object.keys(r.bySymbol).sort().map(function (sym) { return [sym, ui.badge(fmt.words(r.bySymbol[sym]), 'neutral')]; })),
        r.note ? el('p', { class: 't-small t-secondary', text: r.note + (r.asOfTs ? ' Bar time ' + fmt.barTime(r.asOfTs) + '.' : '') }) : null
      ]);
    }
    return ui.card({ title: 'Current regime', sub: 'Labels carry classification error; see Analysis.', body: body });
  }

  function strategies(d) {
    var a = d.activeStrategies;
    return ui.card({
      title: 'Active strategies',
      sub: a.enabled.length + ' of ' + a.total + ' families enabled',
      actions: [TCC.link('/strategies', 'Statistics')],
      body: el('div', { class: 'chips' }, a.enabled.map(function (id) { return ui.chip(id); }))
    });
  }

  function jev(d) {
    var j = d.jev;
    var rows = [
      ['Model', j.configured.model],
      ['Score threshold', el('span', { class: 't-num', text: String(j.configured.scoreThreshold) })],
      ['Min confidence', el('span', { class: 't-num', text: String(j.configured.minConfidence) })]
    ];
    var extra;
    if (j.available === false) extra = ui.state({ tag: 'NO DATA', compact: true, body: j.reason });
    else {
      rows.push(['Verdicts', el('span', { class: 't-num', text: fmt.int(j.verdicts) + ' — ' + fmt.int(j.allowed) + ' allow, ' + fmt.int(j.blocked) + ' block' })]);
      if (j.last) rows.push(['Last verdict', el('span', { class: 'row-tight' }, [ui.jevDecision(j.last.decision),
        el('span', { class: 't-num', text: 'score ' + fmt.num(j.last.score, 2) + ', confidence ' + fmt.num(j.last.confidence, 2) })])]);
    }
    return ui.card({ title: 'Jev status', sub: 'A decision gate. It carries no size and cannot overrule the Risk Engine.',
      actions: [TCC.link('/jev', 'Detail')], body: el('div', { class: 'stack-sm' }, [ui.kv(rows), extra]) });
  }

  function risk(d) {
    var r = d.risk;
    var L = r.limits;
    var rows = [
      ['Risk per trade', el('span', { class: 't-num', text: fmt.pctRaw(L.maxAccountRiskPerTradePct) + ' max' })],
      ['Max drawdown', el('span', { class: 't-num', text: fmt.pctRaw(L.maxDrawdownPct) })],
      ['Daily loss', el('span', { class: 't-num', text: fmt.pctRaw(L.maxDailyLossPct) })],
      ['Consecutive losses', el('span', { class: 't-num', text: String(L.maxConsecutiveLosses) })],
      ['Max position', el('span', { class: 't-num', text: fmt.lots(L.maxPositionSizeLots) + ' lots' })]
    ];
    var extra;
    if (r.available === false) extra = ui.state({ tag: 'NO DATA', compact: true, body: r.reason });
    else {
      rows.push(['Verdicts', el('span', { class: 't-num', text: fmt.int(r.byVerdict.ALLOW) + ' allow · ' + fmt.int(r.byVerdict.CLAMP) + ' clamp · ' + fmt.int(r.byVerdict.BLOCK) + ' block' })]);
      if (r.lastAssessment) rows.push(['Last verdict', el('span', { class: 'row-tight' }, [ui.status(r.lastAssessment.verdict),
        el('span', { class: 't-num', text: 'requested ' + fmt.lots(r.lastAssessment.requestedLots) + ' → approved ' + fmt.lots(r.lastAssessment.approvedLots) })])]);
    }
    return ui.card({ title: 'Risk status', sub: r.emergencyStopConfigured ? 'EMERGENCY STOP IS SET — every candidate is blocked.' : 'The Risk Engine is the final authority on size.',
      actions: [TCC.link('/risk', 'Detail')], body: el('div', { class: 'stack-sm' }, [ui.kv(rows), extra]) });
  }

  function recovery(d) {
    var r = d.recovery;
    var body;
    if (r.available === false) body = ui.state({ tag: 'NO DATA', compact: true, body: r.reason });
    else {
      var recorded = r.perAsset.filter(function (a) { return a.recorded; });
      body = el('div', { class: 'stack-sm' }, [
        ui.kv([
          ['Recovery ×3', ui.status(r.enabled ? 'ENABLED' : 'DISABLED')],
          ['Max level', el('span', { class: 't-num', text: String(r.maxRecoveryLevel) })],
          ['Transitions', el('span', { class: 't-num', text: fmt.int(r.transitions) })]
        ]),
        recorded.length ? ui.kv(recorded.map(function (a) {
          return [a.symbol, el('span', { class: 't-num', text: 'level ' + a.level + ' · requested ' +
            (fmt.lots(a.requestedLots) || 'n/a') + ' → approved ' + (fmt.lots(a.approvedLots) || 'n/a') })];
        })) : (r.note ? el('p', { class: 't-small t-secondary', text: r.note }) : null)
      ]);
    }
    return ui.card({ title: 'Recovery status', sub: 'The ladder only requests a size; the Risk Engine approves, clamps or blocks it.',
      actions: [TCC.link('/recovery', 'Detail')], body: body });
  }

  function activityCard(d) {
    var a = d.recentActivity;
    var body;
    if (!a || a.available === false) body = ui.state({ tag: 'NO DATA', compact: true, body: (a && a.reason) || 'nothing has been recorded' });
    else {
      body = el('div', { class: 'timeline' }, a.items.map(function (e) {
        return el('div', { class: 'tl-item' }, [
          el('span', { class: 'tl-time', text: e.clock === 'WALL' ? fmt.wallShort(e.at) : fmt.barTime(e.ts) }),
          ui.badge(e.type, e.severity === 'ERROR' ? 'danger' : (e.severity === 'WARN' ? 'warn' : 'neutral')),
          el('span', { class: 't-wrap', text: e.message })
        ]);
      }));
    }
    return ui.card({ title: 'Recent activity', actions: [TCC.link('/activity', 'All activity')], body: body });
  }

  function errorsCard(d) {
    var e = d.errors;
    var body = e.count === 0
      ? ui.state({ tag: 'NONE RECORDED', compact: true, body: 'No error is recorded in the audit chain, the runs, the test runs or the current data source.' })
      : el('div', { class: 'timeline' }, e.items.map(function (x) {
          return el('div', { class: 'tl-item' }, [
            el('span', { class: 'tl-time', text: x.clock === 'WALL' ? fmt.wallShort(x.at) : fmt.barTime(x.ts) }),
            ui.badge(x.type, 'danger'),
            el('span', { class: 't-wrap', text: x.message })
          ]);
        }));
    return ui.card({ title: 'Errors', sub: e.count + ' recorded', actions: [TCC.link('/activity?severity=ERROR', 'All errors')], body: body });
  }

  function healthCard(d) {
    var h = d.health;
    return ui.card({
      title: 'Health',
      sub: '13 checks. A check with nothing to evaluate is UNKNOWN, never OK.',
      actions: [TCC.link('/system', 'All checks')],
      body: el('div', { class: 'stack-sm' }, [
        el('div', { class: 'row-tight' }, [
          ui.status(h.status),
          ui.badge(h.counts.ok + ' ok', 'ok'), ui.badge(h.counts.warn + ' warn', h.counts.warn ? 'warn' : 'neutral'),
          ui.badge(h.counts.fail + ' fail', h.counts.fail ? 'danger' : 'neutral'),
          ui.badge(h.counts.unknown + ' unknown', h.counts.unknown ? 'warn' : 'neutral')
        ]),
        h.note ? el('p', { class: 't-small t-secondary', text: h.note }) : null
      ])
    });
  }

  function view(d) {
    var src = d.source;
    var nodes = [];
    if (src.available === false) {
      nodes.push(ui.banner('info', 'No data yet', [
        src.reason + ' ', TCC.link('/backtest', 'Open the Backtest Center')
      ]));
    } else {
      nodes.push(ui.sourceLine(src));
      if (src.label !== 'HISTORICAL') {
        nodes.push(ui.banner('warn', src.label === 'PAPER' ? 'Paper' : 'Synthetic',
          src.label === 'PAPER'
            ? 'Paper session on a replay feed of synthetic bars. No order is sent anywhere. These figures validate mechanics only.'
            : 'Every figure below comes from synthetic data. It validates mechanics only; no statement about edge or profitability can be derived from it.'));
      }
      if (src.source !== 'PAPER_SESSION' && d.account.available) {
        nodes.push(el('p', { class: 't-small t-secondary', text: d.account.note }));
      }
    }
    nodes.push(stateTiles(d));
    nodes.push(el('div', null, [el('div', { class: 'section-head' }, el('h2', { class: 't-label', text: 'Account' })), accountTiles(d)]));
    nodes.push(el('div', null, [el('div', { class: 'section-head' }, [
      el('h2', { class: 't-label', text: 'Performance' }),
      d.performance.available && d.performance.note ? el('span', { class: 't-small t-secondary', text: d.performance.note }) : null
    ]), performanceTiles(d)]));
    nodes.push(el('div', { class: 'grid grid-3' }, [openPosition(d), regime(d), strategies(d)]));
    nodes.push(el('div', { class: 'grid grid-3' }, [jev(d), risk(d), recovery(d)]));
    nodes.push(el('div', { class: 'grid grid-2' }, [activityCard(d), el('div', { class: 'stack' }, [healthCard(d), errorsCard(d)])]));
    return el('div', { class: 'stack-lg', id: 'dashboard-body' }, nodes);
  }

  TCC.page('/dashboard', {
    title: 'Dashboard',
    render: function (ctx) {
      var host = el('div');
      var last = null;
      ctx.root.appendChild(ui.pageHead('Dashboard', 'The platform\'s state, and what it last did. Refreshes every five seconds.'));
      ctx.root.appendChild(host);
      function load(silent) {
        return ui.load(host, function () { return api.get('/api/dashboard'); }, function (d) {
          last = JSON.stringify(d);
          return view(d);
        }, { silent: silent, skeleton: 'kpi', alive: ctx.alive });
      }
      load(false);
      // Re-render only when something changed, so a refresh never disturbs
      // the scroll position or the focused element for nothing.
      ctx.every(5000, function () {
        api.get('/api/dashboard').then(function (d) {
          if (!ctx.alive() || JSON.stringify(d) === last) return;
          last = JSON.stringify(d);
          TCC.replace(host, view(d));
        }).catch(function () { /* the next beat retries */ });
      });
    }
  });
})();
