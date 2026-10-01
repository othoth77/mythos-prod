/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Decision Explorer
   projects/mythos-trading-control-center/web/assets/js/pages/decisions.js

   The complete decision chain for one candidate, in the mission's order:

     MARKET → REGIME → STRATEGY → CANDIDATE → JEV → COST → RISK ENGINE
            → RECOVERY → EXECUTION → RESULT → ANALYSIS

   EVERY STAGE SHOWS A STORED RECORD OR SAYS IT HAS NONE. Three states, three
   different marks, never blended:

     RECORDED      a row exists; its values are shown, and the row itself can
                   be opened underneath
     NOT REACHED   the pipeline stopped earlier; the stage names where and why
     NOT RECORDED  the stage may have run but nothing was stored for it

   Nothing here is reconstructed. If the store has no regime row for the bar,
   the regime stage says NOT RECORDED and shows the label the candidate itself
   carried — as that, not as a regime classification.

   The agent applies the cost filter before the Jev gate; the chain keeps the
   mission's order and says so at the COST stage, rather than reordering the
   list to match the code or the code to match the list.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;
  var ex = TCC.explore;

  var NAMES = {
    MARKET: 'Market', REGIME: 'Regime', STRATEGY: 'Strategy', CANDIDATE: 'Candidate', JEV: 'Jev', COST: 'Cost',
    RISK_ENGINE: 'Risk Engine', RECOVERY: 'Recovery', EXECUTION: 'Execution', RESULT: 'Result', ANALYSIS: 'Analysis'
  };

  function num(v, dp) { return el('span', { class: 't-num', text: fmt.num(v, dp === undefined ? 4 : dp) || 'n/a' }); }

  function group(g) {
    if (!g) return el('span', { class: 't-secondary', text: 'no group recorded' });
    return el('span', { class: 'row-tight' }, [
      el('span', { class: 't-num', text: 'n=' + g.sampleSize }),
      g.sufficient ? ui.badge('sufficient', 'ok') : ui.badge('INSUFFICIENT DATA', 'warn'),
      el('span', { class: 't-num', text: 'expectancy ' + (fmt.signedMoney(g.expectancy, 4) || 'n/a') + ' · win rate ' + (fmt.pct(g.winRate) || 'n/a') })
    ]);
  }

  /** The facts worth reading first, per stage. The full row is always available below them. */
  var FACTS = {
    MARKET: function (r) {
      return [['Asset', r.symbol], ['Bar time', el('span', { class: 't-num', text: fmt.barTime(r.barTs) })], ['Timeframe', r.timeframe],
        ['Dataset version', r.datasetVersion ? ui.chip(r.datasetVersion) : null], ['Source', r.sourceKind],
        ['Bars in series', r.barCount === undefined ? null : el('span', { class: 't-num', text: fmt.int(r.barCount) + (r.gapCount ? ' · ' + r.gapCount + ' gaps' : '') })]];
    },
    REGIME: function (r) {
      if (r.regimeOnCandidate) return [['Label on the candidate', ui.badge(fmt.words(r.regimeOnCandidate), 'neutral')], ['Its confidence', num(r.regimeConfidence, 2)]];
      return [['Regime', ui.badge(fmt.words(r.regime), 'neutral')], ['Direction', r.direction], ['Confidence', num(r.confidence, 4)],
        ['Held by hysteresis', r.held ? 'yes' : 'no']];
    },
    STRATEGY: function (r) {
      return [['Strategy', r.strategyId], ['Family', r.family ? fmt.words(r.family) : null], ['Name', r.name], ['Version', r.version === undefined ? null : String(r.version)],
        ['Parameters hash', r.paramsHash ? ui.chip(r.paramsHash) : null], ['Signal', ui.codes(r.signal)], ['Strategy confidence', num(r.strategyConfidence, 2)],
        ['Preferred regimes', r.preferredRegimes ? ui.codes(r.preferredRegimes) : null]];
    },
    CANDIDATE: function (r) {
      return [['Direction', ex.direction(r.direction)], ['Entry', num(r.entry, 5)], ['Stop loss', num(r.stopLoss, 5)], ['Take profit', num(r.takeProfit, 5)],
        ['Reward / risk', el('span', { class: 't-num', text: fmt.num(r.rewardRisk, 3) + ' gross · ' + fmt.num(r.netRewardRisk, 3) + ' net of costs' })],
        ['Spread', el('span', { class: 't-num', text: fmt.num(r.spreadPips, 2) + ' pips' })],
        ['Expected net', el('span', { class: 't-num', text: fmt.money(r.expectedNetMoney, 4) + ' at ' + fmt.num(r.costBasisLots, 2) + ' lots' })],
        ['Win probability', el('span', { class: 't-num', text: fmt.num(r.winProbability, 2) + ' (' + fmt.words(r.winProbabilitySource) + ')' })],
        ['Breakeven win rate', num(r.breakevenWinRate, 4)]];
    },
    JEV: function (r) {
      var comps = r.components ? Object.keys(r.components).map(function (k) {
        var c = r.components[k];
        return { label: k + ' (w ' + c.weight + ')', value: c.value, text: fmt.num(c.value, 3) };
      }) : [];
      return [['Verdict', el('span', { class: 'row-tight' }, [ui.jevDecision(r.decision), el('span', { class: 't-small t-secondary', text: 'stored as ' + r.decision })])],
        ['Score', el('span', { class: 't-num', text: fmt.num(r.score, 4) + ' against a threshold of ' + r.threshold })],
        ['Confidence', el('span', { class: 't-num', text: fmt.num(r.confidence, 4) + ' against a minimum of ' + r.minConfidence })],
        ['Band', r.band === 'BELOW_70' ? 'below 70' : r.band], ['Reason codes', ui.codes(r.reasonCodes)], ['Risk flags', ui.codes(r.riskFlags)],
        r.hardFlags && r.hardFlags.length ? ['Hard flags', ui.codes(r.hardFlags)] : null,
        comps.length ? ['Components', ui.bars(comps)] : null];
    },
    COST: function (r) {
      return [['Passed', r.passed ? ui.badge('yes', 'ok') : ui.badge('no', 'warn')], ['Total cost', el('span', { class: 't-num', text: fmt.money(r.totalCostMoney, 4) })],
        ['Breakdown', el('span', { class: 't-num', text: 'spread ' + fmt.money(r.spreadMoney, 4) + ' · commission ' + fmt.money(r.commissionMoney, 4) +
          ' · slippage ' + fmt.money(r.slippageMoney, 4) + ' · swap ' + fmt.money(r.swapMoney, 4) })],
        ['Cost / net reward', el('span', { class: 't-num', text: fmt.num(r.costPips, 2) + ' / ' + fmt.num(r.netRewardPips, 2) + ' pips' })],
        ['Reason codes', ui.codes(r.reasonCodes)]];
    },
    RISK_ENGINE: function (r) {
      return [['Verdict', ui.status(r.verdict)],
        ['Requested size', el('span', { class: 't-num', text: fmt.lots(r.requestedLots) + ' lots' })],
        ['Approved size', el('span', { class: 't-num', text: fmt.lots(r.approvedLots) + ' lots' })],
        ['Reason codes', ui.codes(r.reasonCodes)], ['Binding limits', ui.codes(r.bindingLimits)],
        ['Account equity', el('span', { class: 't-num', text: fmt.money(r.accountEquity, 4) })],
        ['Risk budget', r.riskBudgetMoney === null || r.riskBudgetMoney === undefined ? null : el('span', { class: 't-num', text: fmt.money(r.riskBudgetMoney, 4) })],
        ['Approved risk', r.approvedRiskMoney === null || r.approvedRiskMoney === undefined ? null
          : el('span', { class: 't-num', text: fmt.money(r.approvedRiskMoney, 4) + (r.approvedRiskPct !== null && r.approvedRiskPct !== undefined ? ' (' + fmt.num(r.approvedRiskPct, 3) + '%)' : '') })]];
    },
    RECOVERY: function (r) {
      if (r.level === undefined) {
        return [['Requested size', ui.value(fmt.lots(r.requestedLots))], ['Approved size', ui.value(fmt.lots(r.approvedLots))]];
      }
      return [['Level', el('span', { class: 't-num', text: String(r.level) })], ['Last transition', fmt.words(r.reason)],
        ['Cumulative loss', el('span', { class: 't-num', text: fmt.money(r.cumulativeLossMoney, 4) })],
        ['Ladder wanted', el('span', { class: 't-num', text: fmt.lots(r.nextLotsUncapped) + ' uncapped · ' + fmt.lots(r.nextLotsRequested) + ' requested' })],
        ['Risk Engine answered', el('span', { class: 't-num', text: (fmt.lots(r.requestedLots) || 'n/a') + ' → ' + (fmt.lots(r.approvedLots) || 'n/a') })],
        r.requiredPips !== null && r.requiredPips !== undefined ? ['Recovery target', el('span', { class: 't-num', text: 'needs ' + r.requiredPips + ' pips, offered ' + r.offeredPips })] : null,
        ['State as of', el('span', { class: 't-num', text: fmt.barTime(r.stateTs) })]];
    },
    EXECUTION: function (r) {
      return [['Orders', el('div', { class: 'stack-sm' }, r.orders.map(function (o) {
        return el('div', { class: 'row-tight' }, [ui.badge(o.status, o.status === 'FILLED' ? 'ok' : (o.status === 'PENDING' ? 'info' : 'warn')),
          el('span', { class: 't-num', text: fmt.barTime(o.ts) + ' · ' + o.direction + ' ' + fmt.lots(o.lots) + ' @ ' + (o.filledPrice !== null ? o.filledPrice : o.requestedPrice) +
            (o.rejectReason ? ' · ' + o.rejectReason : '') }), o.paper ? ui.badge('paper', 'info') : null]);
      }))],
      ['Positions', el('div', { class: 'stack-sm' }, r.positions.map(function (p) {
        return el('span', { class: 't-num', text: p.status + ' · entry ' + p.entryPrice + ' at ' + fmt.barTime(p.entryTs) + (p.exitPrice !== null ? ' · exit ' + p.exitPrice + ' at ' + fmt.barTime(p.exitTs) : '') });
      }))]];
    },
    RESULT: function (r) {
      return [['Outcome', ui.status(r.outcome)], ['Exit reason', fmt.words(r.exitReason) + (r.gapped ? ' (gapped)' : '')],
        ['Entry → exit', el('span', { class: 't-num', text: r.entryPrice + ' → ' + r.exitPrice + ' · ' + r.barsHeld + ' bars' })],
        ['Size', el('span', { class: 't-num', text: fmt.lots(r.lots) + ' lots' })],
        ['Gross', ui.signedMoney(r.grossPnl, 4)], ['Costs', el('span', { class: 't-num', text: fmt.money(r.costsMoney, 4) })],
        ['Net', ui.signedMoney(r.netPnl, 4)], ['R', ui.value(fmt.r(r.rMultiple), { sign: r.rMultiple, naReason: 'no risk amount recorded' })],
        ['Equity after', el('span', { class: 't-num', text: fmt.money(r.equityAfter, 4) })]];
    },
    ANALYSIS: function (r) {
      return [['By strategy', group(r.byStrategy)], ['By asset', group(r.bySymbol)], ['By regime', group(r.byRegime)], ['By Jev band', group(r.byJevBand)],
        ['In the worst losing streak', r.inWorstLosingStreak ? 'yes' : 'no'],
        ['Sample threshold', el('span', { class: 't-num', text: 'n ≥ ' + r.minSample })]];
    }
  };

  function stageNode(s) {
    var cls = s.status === 'RECORDED' ? 'is-recorded' : (s.status === 'NOT_REACHED' ? 'is-not-reached' : 'is-not-recorded');
    var body = [];
    if (s.record && FACTS[s.stage]) body.push(ui.kv(FACTS[s.stage](s.record)));
    if (s.note) body.push(el('p', { class: 't-small t-secondary', text: s.note }));
    if (s.record) {
      body.push(el('details', null, [
        el('summary', { class: 't-small', text: 'Stored record' }),
        el('pre', { class: 'pre', text: JSON.stringify(s.record, null, 2) })
      ]));
    }
    return el('li', { class: 'chain-stage ' + cls, attrs: { 'data-stage': s.stage, 'data-status': s.status } }, [
      el('div', null, [el('div', { class: 'chain-name', text: NAMES[s.stage] }), ui.status(s.status)]),
      el('div', { class: 'stack-sm' }, body)
    ]);
  }

  function chainView(res) {
    var c = res.chain;
    var i = c.integrity;
    return el('div', { class: 'stack', id: 'chain' }, [
      ui.sourceLine(res.context),
      ui.card({
        title: 'Candidate ' + c.candidateId,
        sub: c.symbol + ' at ' + fmt.barTime(c.ts),
        body: el('div', { class: 'stack-sm' }, [
          el('div', { class: 'row-tight' }, [
            c.decisionRecorded ? ui.status(c.decision) : ui.badge('NO DECISION RECORDED', 'danger'),
            c.stoppedAt ? el('span', { text: 'stopped at ' + c.stoppedAt }) : null,
            ui.badge(i.recorded + ' of ' + i.stages + ' stages recorded', 'neutral'),
            i.notReached ? ui.badge(i.notReached + ' not reached', 'neutral') : null,
            i.notRecorded.length ? ui.badge(i.notRecorded.length + ' not recorded', 'warn') : null
          ]),
          c.reasonCodes.length ? el('div', null, [el('span', { class: 't-label', text: 'Recorded reason codes ' }), ui.codes(c.reasonCodes)]) : null
        ])
      }),
      ui.card({ title: 'Decision chain', sub: 'Stored values only. A stage with no stored row says so.',
        body: el('ol', { class: 'chain' }, c.stages.map(stageNode)) })
    ]);
  }

  TCC.page('/decisions', {
    title: 'Decisions',
    render: function (ctx) {
      var candidate = ctx.query.get('candidate');
      if (candidate) {
        var run = ctx.query.get('run') || null;
        var host = el('div');
        ctx.root.appendChild(ui.pageHead('Decision Explorer', 'The complete chain for one candidate.',
          [TCC.link('/decisions' + TCC.qs({ run: run }), 'All decisions', 'btn btn-secondary')]));
        ctx.root.appendChild(host);
        ui.load(host, function () { return api.get('/api/decisions/' + encodeURIComponent(candidate), { run: run }); }, function (res) {
          if (res.context.available === false) return ui.noData(res.context.reason);
          return chainView(res);
        }, { alive: ctx.alive });
        return;
      }
      ex.list({
        ctx: ctx, id: 'decisions-body', path: '/decisions', endpoint: '/api/decisions',
        title: 'Decision Explorer',
        sub: 'One row per recorded verdict — ENTER, or NO TRADE at a named stage. Open a row for its complete chain.',
        filterOptions: ex.configOptions,
        filters: [
          { key: 'symbol', label: 'Asset' }, { key: 'strategy', label: 'Strategy' },
          { key: 'decision', label: 'Decision', options: [{ value: 'ENTER', label: 'ENTER' }, { value: 'NO_TRADE', label: 'NO TRADE' }] },
          { key: 'stage', label: 'Stage', options: ex.STAGES }
        ],
        summary: function (d, res) {
          return el('div', { class: 'stack-sm' }, [
            el('div', { class: 'row-tight' }, [ui.badge(d.total + ' decisions', 'neutral'), ui.badge(d.entered + ' entered', 'ok')].concat(
              d.byStage.map(function (s) { return ui.badge(s.count + ' stopped at ' + s.value, 'neutral'); }))),
            el('p', { class: 't-small t-secondary', text: 'Chain order: ' + res.stages.map(function (s) { return NAMES[s]; }).join(' → ') })
          ]);
        },
        onRow: function (d, state) {
          if (!d.candidateId) { TCC.toast('warn', 'No chain', 'This verdict was recorded before any candidate was built, so there is no chain to open.'); return; }
          TCC.router.go('/decisions' + TCC.qs({ candidate: d.candidateId, run: state.run }));
        },
        columns: [
          { label: 'Bar', render: function (d) { return el('span', { class: 't-num', text: fmt.barTime(d.ts) }); } },
          { label: 'Asset', render: function (d) { return d.symbol; } },
          { label: 'Strategy', render: function (d) { return d.strategyId; } },
          { label: 'Dir', render: function (d) { return ex.direction(d.direction); } },
          { label: 'Decision', render: function (d) { return ui.status(d.decision); } },
          { label: 'Stage', render: function (d) { return d.stage; } },
          { label: 'Reason codes (recorded)', render: function (d) { return ui.codes(d.reasonCodes); } },
          { label: 'Trade', render: function (d) { return d.hasTrade ? ui.badge('closed trade', 'ok') : el('span', { class: 't-secondary', text: 'none' }); } },
          { label: 'Candidate', render: function (d) { return d.candidateId ? ui.chip(d.candidateId.slice(-11)) : el('span', { class: 't-secondary', text: 'none built' }); } }
        ]
      });
    }
  });
})();
