/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Trade Explorer and Candidate Explorer
   projects/mythos-trading-control-center/web/assets/js/pages/trades.js

   /trades      every closed trade: asset, strategy, direction, entry, SL, TP,
                requested size, approved size, Jev score and confidence, the
                Risk Engine's verdict, recovery level, costs, exit, P&L and R.
   /candidates  everything the strategies proposed, including what was
                rejected: strategy, signal, direction, regime, Jev, risk, the
                decision, and the RECORDED reason codes.

   TWO THINGS THESE PAGES NEVER DO
     · merge "requested" and "approved" into one size column. The ladder asks;
       the Risk Engine answers; the difference is the most important fact about
       how recovery behaves, so both are always on screen.
     · explain a rejection the store does not explain. A rejected candidate
       shows the reason codes that were written when it was rejected. If no
       decision row exists the cell says so — it does not infer one.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var ex = TCC.explore;

  function tradeDialog(t, run) {
    TCC.modal({
      title: 'Trade ' + t.tradeId, wide: true,
      body: el('div', { class: 'grid grid-2' }, [
        ui.kv([
          ['Asset', t.symbol], ['Strategy', t.strategyId], ['Direction', ex.direction(t.direction)],
          ['Entry', el('span', { class: 't-num', text: fmt.price(t.entry) + ' at ' + fmt.barTime(t.entryTs) })],
          ['Stop loss', ui.value(fmt.price(t.stopLoss))], ['Take profit', ui.value(fmt.price(t.takeProfit))],
          ['Exit', el('span', { class: 't-num', text: fmt.price(t.exit) + ' at ' + fmt.barTime(t.exitTs) })],
          ['Exit reason', fmt.words(t.exitReason) + (t.gapped ? ' (gapped)' : '')],
          ['Bars held', el('span', { class: 't-num', text: String(t.barsHeld) })],
          ['Regime', t.regime ? ui.badge(fmt.words(t.regime), 'neutral') : null]
        ]),
        ui.kv([
          ['Requested size', ui.value(fmt.lots(t.requestedLots), { naReason: 'no risk assessment recorded' })],
          ['Approved size', ui.value(fmt.lots(t.approvedLots), { naReason: 'no risk assessment recorded' })],
          ['Executed size', el('span', { class: 't-num', text: fmt.lots(t.lots) + ' lots' })],
          ['Risk verdict', t.riskVerdict ? ui.status(t.riskVerdict) : null],
          ['Risk reasons', ui.codes(t.riskReasons)],
          ['Jev', el('span', { class: 't-num', text: (fmt.num(t.jevScore, 2) || 'n/a') + ' score · ' + (fmt.num(t.jevConfidence, 2) || 'n/a') + ' confidence · band ' + (t.jevBand || 'n/a') })],
          ['Recovery level', el('span', { class: 't-num', text: String(t.recoveryLevel) })],
          ['Gross P&L', ui.signedMoney(t.grossPnl, 4)],
          ['Costs', el('span', { class: 't-num', text: fmt.money(t.costs.total, 4) + ' — spread ' + (fmt.money(t.costs.spread, 4) || 'n/a') + ', commission ' +
            (fmt.money(t.costs.commission, 4) || 'n/a') + ', slippage ' + (fmt.money(t.costs.slippage, 4) || 'n/a') + ', swap ' + (fmt.money(t.costs.swap, 4) || 'n/a') })],
          ['Net P&L', ui.signedMoney(t.netPnl, 4)],
          ['R', ui.value(fmt.r(t.rMultiple), { sign: t.rMultiple, naReason: 'no risk amount was recorded for this trade' })],
          ['Equity after', el('span', { class: 't-num', text: fmt.money(t.equityAfter, 4) })]
        ])
      ]),
      actions: [
        { label: 'Decision chain', kind: 'btn-secondary', onClick: function (b, h) {
          h.close();
          TCC.router.go('/decisions' + TCC.qs({ candidate: t.candidateId, run: run }));
        } },
        { label: 'Close', kind: 'btn-secondary', onClick: function (b, h) { h.close(); } }
      ]
    });
  }

  TCC.page('/trades', {
    title: 'Trades',
    render: function (ctx) {
      ex.list({
        ctx: ctx, id: 'trades-body', path: '/trades', endpoint: '/api/trades',
        title: 'Trade Explorer',
        sub: 'Every closed trade, with what was requested, what the Risk Engine approved, what it cost and what it returned.',
        filterOptions: ex.configOptions,
        filters: [
          { key: 'symbol', label: 'Asset' }, { key: 'strategy', label: 'Strategy' },
          { key: 'direction', label: 'Direction', options: ['LONG', 'SHORT'] },
          { key: 'outcome', label: 'Outcome', options: ['WIN', 'LOSS', 'BREAKEVEN'] },
          { key: 'regime', label: 'Regime', options: ex.REGIMES }
        ],
        summary: function (d) { return el('p', { class: 't-small t-secondary', text: d.total + ' trade(s) match. Sizes are in lots; R is net P&L over the risk taken.' }); },
        onRow: function (t, state) { tradeDialog(t, state.run); },
        columns: [
          { label: 'Exit', render: function (t) { return el('span', { class: 't-num', text: fmt.barTime(t.exitTs) }); } },
          { label: 'Asset', render: function (t) { return t.symbol; } },
          { label: 'Strategy', render: function (t) { return t.strategyId; } },
          { label: 'Dir', render: function (t) { return ex.direction(t.direction); } },
          { label: 'Entry', num: true, render: function (t) { return fmt.price(t.entry); } },
          { label: 'SL', num: true, render: function (t) { return fmt.price(t.stopLoss); } },
          { label: 'TP', num: true, render: function (t) { return fmt.price(t.takeProfit); } },
          { label: 'Requested', num: true, render: function (t) { return fmt.lots(t.requestedLots); } },
          { label: 'Approved', num: true, render: function (t) { return fmt.lots(t.approvedLots); } },
          { label: 'Jev', num: true, render: function (t) { return fmt.num(t.jevScore, 1); } },
          { label: 'Conf', num: true, render: function (t) { return fmt.num(t.jevConfidence, 2); } },
          { label: 'Risk', render: function (t) { return t.riskVerdict ? ui.status(t.riskVerdict) : null; } },
          { label: 'Rec', num: true, render: function (t) { return String(t.recoveryLevel); } },
          { label: 'Costs', num: true, render: function (t) { return fmt.money(t.costs.total, 4); } },
          { label: 'Exit', num: true, render: function (t) { return fmt.price(t.exit); } },
          { label: 'P&L', num: true, render: function (t) { return ui.signedMoney(t.netPnl, 4); } },
          { label: 'R', num: true, render: function (t) { return ui.value(fmt.r(t.rMultiple), { sign: t.rMultiple }); } }
        ]
      });
    }
  });

  TCC.page('/candidates', {
    title: 'Candidates',
    render: function (ctx) {
      ex.list({
        ctx: ctx, id: 'candidates-body', path: '/candidates', endpoint: '/api/candidates',
        title: 'Candidate Explorer',
        sub: 'Everything the strategies proposed — entered and rejected — with the reason codes recorded at the time.',
        filterOptions: ex.configOptions,
        filters: [
          { key: 'symbol', label: 'Asset' }, { key: 'strategy', label: 'Strategy' },
          { key: 'direction', label: 'Direction', options: ['LONG', 'SHORT'] },
          { key: 'regime', label: 'Regime', options: ex.REGIMES },
          { key: 'decision', label: 'Decision', options: [{ value: 'ENTER', label: 'ENTER' }, { value: 'NO_TRADE', label: 'NO TRADE (rejected)' }] },
          { key: 'stage', label: 'Stopped at', options: ex.STAGES }
        ],
        summary: function (d) {
          return el('div', { class: 'row-tight' }, [
            ui.badge(d.total + ' candidates', 'neutral'), ui.badge(d.entered + ' entered', 'ok'), ui.badge(d.rejected + ' rejected', 'warn'),
            d.withoutRecordedDecision ? ui.badge(d.withoutRecordedDecision + ' with no recorded decision', 'danger') : null
          ]);
        },
        onRow: function (c, state) { TCC.router.go('/decisions' + TCC.qs({ candidate: c.candidateId, run: state.run })); },
        columns: [
          { label: 'Bar', render: function (c) { return el('span', { class: 't-num', text: fmt.barTime(c.ts) }); } },
          { label: 'Asset', render: function (c) { return c.symbol; } },
          { label: 'Strategy', render: function (c) { return c.strategyId; } },
          { label: 'Signal', render: function (c) { return ui.codes(c.signal); } },
          { label: 'Dir', render: function (c) { return ex.direction(c.direction); } },
          { label: 'Regime', render: function (c) { return ui.badge(fmt.words(c.regime), 'neutral'); } },
          { label: 'Jev (score / conf)', render: function (c) { return ex.jevCell(c.jev); } },
          { label: 'Risk (req → appr)', render: function (c) { return ex.riskCell(c.risk); } },
          { label: 'Decision', render: function (c) {
            if (!c.decisionRecorded) return ui.badge('NOT RECORDED', 'danger');
            return el('span', { class: 'row-tight' }, [ui.status(c.decision), c.decision === 'NO_TRADE' ? el('span', { class: 't-small t-secondary', text: 'at ' + c.stage }) : null]);
          } },
          { label: 'Reason codes (recorded)', render: function (c) {
            return c.decisionRecorded ? ui.codes(c.reasonCodes) : el('span', { class: 't-secondary', text: 'no decision row exists for this candidate' });
          } }
        ]
      });
    }
  });
})();
