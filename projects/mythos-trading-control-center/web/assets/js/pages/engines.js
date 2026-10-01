/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Strategies, Jev, Risk, Recovery
   projects/mythos-trading-control-center/web/assets/js/pages/engines.js

   Four views over one run's store, each about one part of the pipeline.

   WHO DECIDES WHAT is stated at the top of each page, because it is the thing
   most easily misread from a table of numbers:

     Strategies  propose a signal. They cannot express a size.
     Jev         returns a verdict — ALLOW or BLOCK. It carries no size and
                 cannot overrule anything downstream.
     Recovery    REQUESTS a size, and nothing else.
     Risk Engine is the last writer of size and the final authority on whether
                 to trade. ALLOW, CLAMP or BLOCK — a clamp is shown as a clamp.

   STATISTICS CARRY THEIR SAMPLE SIZE. A group below the threshold is marked
   INSUFFICIENT DATA next to its numbers; the numbers stay visible, labelled as
   what they are, rather than being hidden or presented as evidence.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;
  var ex = TCC.explore;

  /** The shared frame: heading, run picker, source line, and NO DATA handling. */
  function frame(ctx, o) {
    var run = ctx.query.get('run') || null;
    var host = el('div', { id: o.id });
    var last = null;
    ctx.root.appendChild(ui.pageHead(o.title, o.sub, [ex.runPicker(run, function (v) {
      run = v; ex.setQuery(o.path, { run: run }); last = null; load(false);
    })]));
    ctx.root.appendChild(ui.banner('info', 'Authority', o.authority));
    ctx.root.appendChild(host);
    function load(silent) {
      return ui.load(host, function () { return api.get(o.endpoint, { run: run }); }, function (res) {
        last = JSON.stringify(res);
        var nodes = [];
        if (o.configured) nodes.push(o.configured(res));
        if (res.context.available === false) {
          nodes.push(ui.noData(res.context.reason, [TCC.link('/backtest', 'Open the Backtest Center', 'btn btn-secondary')]));
        } else {
          nodes.push(ui.sourceLine(res.context));
          nodes = nodes.concat(o.render(res, run));
        }
        return el('div', { class: 'stack-lg' }, nodes);
      }, { silent: silent, alive: ctx.alive });
    }
    load(false);
    ctx.every(4000, function () {
      api.get(o.endpoint, { run: run }).then(function (res) {
        if (ctx.alive() && JSON.stringify(res) !== last) load(true);
      }).catch(function () { /* the next beat retries */ });
    });
  }

  /** "n=12 INSUFFICIENT DATA" or "n=48 sufficient". */
  function sample(s) {
    return el('span', { class: 'row-tight' }, [
      el('span', { class: 't-num', text: 'n=' + s.sampleSize }),
      s.sampleSize === 0 ? null : (s.sufficient ? ui.badge('sufficient', 'ok') : ui.badge('INSUFFICIENT DATA', 'warn'))
    ]);
  }

  function freqBars(list, emptyText) {
    return ui.bars((list || []).map(function (x) { return { label: fmt.words(x.value), value: x.count, text: fmt.int(x.count) }; }), { emptyText: emptyText });
  }

  // ---------------------------------------------------------------------------
  // strategies
  // ---------------------------------------------------------------------------

  TCC.page('/strategies', {
    title: 'Strategies',
    render: function (ctx) {
      frame(ctx, {
        id: 'strategies-body', path: '/strategies', endpoint: '/api/strategies', title: 'Strategies',
        sub: 'The fourteen families: what each proposed, what happened to it, and how its trades did.',
        authority: 'A strategy proposes a signal with a stop and a target. It cannot express a position size; sizing belongs to the Risk Engine alone.',
        render: function (res) {
          var rows = res.strategies;
          var withTrades = rows.filter(function (s) { return s.trades && s.trades.sampleSize > 0; });
          return [
            el('div', { class: 'row-tight' }, [
              ui.badge(res.enabled.length + ' of ' + rows.length + ' enabled now', 'neutral'),
              ui.badge(withTrades.length + ' traded in this source', 'neutral'),
              ui.badge(withTrades.filter(function (s) { return s.trades.sufficient; }).length + ' with a sufficient sample (n ≥ ' + res.minSample + ')', 'neutral')
            ]),
            ui.card({
              title: 'Strategy statistics', sub: 'Net of all costs. Drawdown is path-dependent and is reported once for the run, never per strategy.', flush: true,
              body: ui.table({
                dense: true,
                columns: [
                  { label: 'Strategy', render: function (s) { return el('span', null, [s.strategyId, el('span', { class: 'cell-sub', text: fmt.words(s.family) })]); } },
                  { label: 'Now', render: function (s) { return ui.status(s.enabled ? 'ENABLED' : 'DISABLED'); } },
                  { label: 'Candidates', num: true, render: function (s) { return fmt.int(s.candidates); } },
                  { label: 'Entered', num: true, render: function (s) { return fmt.int(s.entered); } },
                  { label: 'Stopped at', render: function (s) {
                    return s.rejectedByStage && s.rejectedByStage.length
                      ? el('span', { class: 'chips' }, s.rejectedByStage.map(function (r) { return ui.chip(r.value + ' ' + r.count); }))
                      : el('span', { class: 't-secondary', text: 'none' });
                  } },
                  { label: 'Sample', render: function (s) { return sample(s.trades); } },
                  { label: 'Win rate', num: true, render: function (s) { return fmt.pct(s.trades.winRate); } },
                  { label: 'Expectancy', num: true, render: function (s) { return ui.value(fmt.signedMoney(s.trades.expectancy, 4), { sign: s.trades.expectancy, naReason: 'no trade' }); } },
                  { label: 'Profit factor', num: true, render: function (s) { return fmt.num(s.trades.profitFactor, 3); } },
                  { label: 'Net', num: true, render: function (s) { return ui.value(fmt.signedMoney(s.trades.netPnl), { sign: s.trades.netPnl, naReason: 'no trade' }); } },
                  { label: 'Max streak', num: true, render: function (s) { return fmt.int(s.trades.maxConsecutiveLosses); } }
                ],
                rows: rows
              })
            }),
            ui.card({
              title: 'Candidates by regime', sub: 'Where each strategy fired. A preferred regime is a hypothesis, not a filter.', flush: true,
              body: ui.table({
                dense: true,
                columns: [
                  { label: 'Strategy', render: function (s) { return s.strategyId; } },
                  { label: 'Preferred regimes', render: function (s) { return s.preferredRegimes.length ? ui.codes(s.preferredRegimes) : el('span', { class: 't-secondary', text: 'none declared' }); } },
                  { label: 'Fired in', render: function (s) {
                    return s.byRegime && s.byRegime.length ? el('span', { class: 'chips' }, s.byRegime.map(function (r) { return ui.chip(r.value + ' ' + r.count); }))
                      : el('span', { class: 't-secondary', text: 'did not fire' });
                  } }
                ],
                rows: rows
              })
            })
          ];
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Jev
  // ---------------------------------------------------------------------------

  TCC.page('/jev', {
    title: 'Jev',
    render: function (ctx) {
      frame(ctx, {
        id: 'jev-body', path: '/jev', endpoint: '/api/jev', title: 'Jev',
        sub: 'The decision gate: score, confidence, verdict, and how each score band did.',
        authority: 'Jev returns a verdict and its reasons. It carries no size and cannot overrule the Risk Engine. Stored decisions are ENTER and REJECT; they are shown here as ALLOW and BLOCK.',
        configured: function (res) {
          var c = res.configured;
          return el('div', { class: 'grid grid-kpi' }, [
            ui.kpi('Gate', ui.status('ENABLED'), 'always part of the pipeline', { text: true }),
            ui.kpi('Score threshold', fmt.num(c.scoreThreshold, 0), 'configured now'),
            ui.kpi('Min confidence', fmt.num(c.minConfidence, 2), 'configured now'),
            ui.kpi('Model', c.model, 'bands ' + c.thresholdBands.map(function (b) { return b[0] + '–' + b[1]; }).join(', '), { text: true })
          ]);
        },
        render: function (res, run) {
          var d = res.data;
          if (!d.verdicts) return [ui.noData('No Jev verdict is recorded in this source.')];
          return [
            el('div', { class: 'grid grid-kpi' }, [
              ui.kpi('Verdicts', fmt.int(d.verdicts), 'in this source'),
              ui.kpi('ALLOW', fmt.int(d.allowed), fmt.pct(d.allowed / d.verdicts) + ' of verdicts'),
              ui.kpi('BLOCK', fmt.int(d.blocked), fmt.pct(d.blocked / d.verdicts) + ' of verdicts'),
              ui.kpi('Threshold in this source', fmt.num(d.threshold, 0), 'min confidence ' + fmt.num(d.minConfidence, 2))
            ]),
            ui.card({
              title: 'Score bands', sub: 'How candidates in each band were judged, and how the trades taken in it did. A band with few trades is not evidence.', flush: true,
              body: ui.table({
                dense: true, caption: 'Jev score bands',
                columns: [
                  { label: 'Band', render: function (b) { return el('span', { class: 't-num', text: b.band === 'BELOW_70' ? 'below 70' : b.band.replace('-', '–') }); } },
                  { label: 'Considered', num: true, render: function (b) { return fmt.int(b.considered); } },
                  { label: 'ALLOW', num: true, render: function (b) { return fmt.int(b.allowed); } },
                  { label: 'BLOCK', num: true, render: function (b) { return fmt.int(b.blocked); } },
                  { label: 'Trades', render: function (b) { return sample(b.trades); } },
                  { label: 'Win rate', num: true, render: function (b) { return fmt.pct(b.trades.winRate); } },
                  { label: 'Expectancy', num: true, render: function (b) { return ui.value(fmt.signedMoney(b.trades.expectancy, 4), { sign: b.trades.expectancy, naReason: 'no trade in this band' }); } },
                  { label: 'Net', num: true, render: function (b) { return ui.value(fmt.signedMoney(b.trades.netPnl), { sign: b.trades.netPnl, naReason: 'no trade in this band' }); } }
                ],
                rows: d.bands
              }),
              foot: 'Bands are the mission\'s reporting bands. "below 70" exists because the configured threshold may sit under them.'
            }),
            el('div', { class: 'grid grid-2' }, [
              ui.card({ title: 'Reason codes', sub: 'Most frequent, across all verdicts.', body: freqBars(d.topReasonCodes, 'No reason code recorded.') }),
              ui.card({ title: 'Risk flags', sub: 'A hard flag forces a BLOCK whatever the score.', body: freqBars(d.topRiskFlags, 'No risk flag recorded.') })
            ]),
            ui.card({
              title: 'Latest verdicts', flush: true,
              body: ui.table({
                dense: true,
                onRow: function (v) { TCC.router.go('/decisions' + TCC.qs({ candidate: v.candidateId, run: run })); },
                columns: [
                  { label: 'Bar', render: function (v) { return el('span', { class: 't-num', text: fmt.barTime(v.ts) }); } },
                  { label: 'Asset', render: function (v) { return v.symbol; } },
                  { label: 'Strategy', render: function (v) { return v.strategyId; } },
                  { label: 'Score', num: true, render: function (v) { return fmt.num(v.score, 2); } },
                  { label: 'Confidence', num: true, render: function (v) { return fmt.num(v.confidence, 2); } },
                  { label: 'Band', render: function (v) { return v.band === 'BELOW_70' ? 'below 70' : v.band; } },
                  { label: 'Verdict', render: function (v) { return ui.jevDecision(v.decision); } },
                  { label: 'Reason codes', render: function (v) { return ui.codes(v.reasonCodes); } }
                ],
                rows: d.recent
              })
            })
          ];
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Risk
  // ---------------------------------------------------------------------------

  var OBSERVED = [
    ['RISK_BUDGET_MONEY', 'Risk budget', 'money'], ['MAX_LOTS_BY_RISK', 'Largest size the budget allows', 'lots'],
    ['MAX_DRAWDOWN_PCT', 'Drawdown', 'pct'], ['DRAWDOWN_HEADROOM_MONEY', 'Drawdown headroom', 'money'],
    ['MAX_DAILY_LOSS_PCT', 'Daily loss', 'pct'], ['DAILY_LOSS_HEADROOM_MONEY', 'Daily loss headroom', 'money'],
    ['MAX_CONSECUTIVE_LOSSES', 'Consecutive losses', 'int'], ['MAX_POSITION_SIZE_LOTS', 'Position size', 'lots'],
    ['INSTRUMENT_MAX_LOT', 'Instrument maximum', 'lots'], ['MAX_RECOVERY_LEVEL', 'Recovery level', 'int'],
    ['MAX_SPREAD_PIPS', 'Spread (pips)', 'num'], ['EMERGENCY_STOP', 'Emergency stop', 'bool']
  ];

  function observedValue(v, kind) {
    if (typeof v === 'boolean') return v ? 'SET' : 'not set';
    if (kind === 'money') return fmt.money(v, 4);
    if (kind === 'pct') return fmt.pctRaw(v, 3);
    if (kind === 'lots') return fmt.lots(v);
    if (kind === 'int') return fmt.int(v);
    return fmt.num(v, 4);
  }

  function assessmentTable(rows, run, emptyText) {
    return ui.table({
      dense: true,
      empty: ui.state({ tag: 'NONE RECORDED', compact: true, body: emptyText }),
      onRow: function (a) { TCC.router.go('/decisions' + TCC.qs({ candidate: a.candidateId, run: run })); },
      columns: [
        { label: 'Bar', render: function (a) { return el('span', { class: 't-num', text: fmt.barTime(a.ts) }); } },
        { label: 'Asset', render: function (a) { return a.symbol; } },
        { label: 'Strategy', render: function (a) { return a.strategyId; } },
        { label: 'Requested', num: true, render: function (a) { return fmt.lots(a.requestedLots); } },
        { label: 'Approved', num: true, render: function (a) { return fmt.lots(a.approvedLots); } },
        { label: 'Reason codes', render: function (a) { return ui.codes(a.reasonCodes); } },
        { label: 'Binding limits', render: function (a) { return ui.codes(a.bindingLimits); } }
      ],
      rows: rows
    });
  }

  TCC.page('/risk', {
    title: 'Risk',
    render: function (ctx) {
      frame(ctx, {
        id: 'risk-body', path: '/risk', endpoint: '/api/risk', title: 'Risk',
        sub: 'Budget, exposure, drawdown, daily loss, consecutive losses, position limits — and every clamp and block.',
        authority: 'The Risk Engine is the final authority. It is the last writer of position size; nothing in this console sets a size, and no other component can turn a BLOCK into an ALLOW.',
        configured: function (res) {
          var L = res.limits;
          return el('div', { class: 'stack-sm' }, [
            !res.tradingEnabled ? ui.banner('danger', 'Emergency stop', 'Trading is disabled: the emergency stop is set, so every candidate is blocked.') : null,
            el('div', { class: 'grid grid-6' }, [
              ui.kpi('Risk per trade', fmt.pctRaw(L.maxAccountRiskPerTradePct), 'of equity, maximum'),
              ui.kpi('Max drawdown', fmt.pctRaw(L.maxDrawdownPct), 'breach raises the stop'),
              ui.kpi('Daily loss', fmt.pctRaw(L.maxDailyLossPct), 'limit'),
              ui.kpi('Consecutive losses', fmt.int(L.maxConsecutiveLosses), 'then ' + L.consecutiveLossCooldownHours + ' h cooling-off'),
              ui.kpi('Max position', fmt.lots(L.maxPositionSizeLots), 'lots — a ceiling'),
              ui.kpi('Open trades', fmt.int(L.maxOpenTrades), 'globally, always')
            ])
          ]);
        },
        render: function (res, run) {
          var d = res.data;
          if (!d.assessments) return [ui.noData('The Risk Engine was never consulted in this source.')];
          var obs = d.lastObserved || {};
          var x = d.exposure;
          return [
            el('div', { class: 'grid grid-kpi' }, [
              ui.kpi('Assessments', fmt.int(d.assessments), 'candidates that reached the Risk Engine'),
              ui.kpi('ALLOW', fmt.int(d.byVerdict.ALLOW), 'approved as requested'),
              ui.kpi('CLAMP', fmt.int(d.byVerdict.CLAMP), fmt.pct(d.clampRate) + ' — approved at a smaller size'),
              ui.kpi('BLOCK', fmt.int(d.byVerdict.BLOCK), fmt.pct(d.blockRate) + ' — no trade')
            ]),
            el('div', { class: 'grid grid-2' }, [
              ui.card({
                title: 'Limits as last observed', sub: 'The most recent recorded measurement of each limit, with the bar it was taken at.', flush: true,
                body: ui.table({
                  dense: true,
                  columns: [
                    { label: 'Measure', render: function (r) { return r[1]; } },
                    { label: 'Observed', num: true, render: function (r) { return obs[r[0]] ? observedValue(obs[r[0]].observed, r[2]) : null; } },
                    { label: 'Limit', num: true, render: function (r) { return obs[r[0]] ? observedValue(obs[r[0]].limit, r[2]) : null; } },
                    { label: 'Binding', render: function (r) { return obs[r[0]] ? (obs[r[0]].binding ? ui.badge('BINDING', 'warn') : el('span', { class: 't-secondary', text: 'no' })) : null; } },
                    { label: 'Measured at', render: function (r) { return obs[r[0]] ? el('span', { class: 't-num', text: fmt.barTime(obs[r[0]].ts) }) : null; } }
                  ],
                  rows: OBSERVED.filter(function (r) { return obs[r[0]] !== undefined; })
                })
              }),
              el('div', { class: 'stack' }, [
                ui.card({ title: 'Exposure', sub: 'The last recorded account state in this source.', body: x ? ui.kv([
                  ['As of', el('span', { class: 't-num', text: fmt.barTime(x.ts) })],
                  ['Equity', el('span', { class: 't-num', text: fmt.money(x.equity, 4) })],
                  ['Balance', el('span', { class: 't-num', text: fmt.money(x.balance, 4) })],
                  ['Open risk', el('span', { class: 't-num', text: fmt.money(x.openRiskMoney, 4) })],
                  ['Drawdown', el('span', { class: 't-num', text: fmt.pctRaw(x.drawdownPct, 3) })]
                ]) : ui.state({ tag: 'NO DATA', compact: true, body: 'No equity sample is recorded.' }) }),
                ui.card({ title: 'Why it blocked or clamped', sub: 'Reason codes across every assessment.', body: freqBars(d.topReasons) }),
                ui.card({ title: 'Which limits bound', body: freqBars(d.topBindingLimits, 'No limit was binding.') })
              ])
            ]),
            ui.card({ title: 'Clamps', sub: 'Approved at a smaller size than requested. The latest ' + d.clamps.length + '.', flush: true,
              body: assessmentTable(d.clamps, run, 'No request was clamped in this source.') }),
            ui.card({ title: 'Blocks', sub: 'No trade. The latest ' + d.blocks.length + '.', flush: true,
              body: assessmentTable(d.blocks, run, 'No candidate was blocked in this source.') }),
            ui.card({ title: 'Risk events', sub: 'Emergency stops and the consecutive-loss breaker.', flush: true,
              body: ui.table({
                dense: true, empty: ui.state({ tag: 'NONE RECORDED', compact: true, body: 'No emergency stop or breaker event in this source.' }),
                columns: [
                  { label: 'Bar', render: function (e) { return el('span', { class: 't-num', text: fmt.barTime(e.ts) }); } },
                  { label: 'Event', render: function (e) { return fmt.words(e.kind); } },
                  { label: 'Severity', render: function (e) { return ui.status(e.severity); } },
                  { label: 'Detail', render: function (e) { return el('span', { class: 't-wrap', text: e.message }); } }
                ],
                rows: d.events
              }) })
          ];
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Recovery
  // ---------------------------------------------------------------------------

  TCC.page('/recovery', {
    title: 'Recovery',
    render: function (ctx) {
      frame(ctx, {
        id: 'recovery-body', path: '/recovery', endpoint: '/api/recovery', title: 'Recovery',
        sub: 'The ×3 ladder, per asset: its level, what it asked for, and what the Risk Engine approved.',
        authority: 'The recovery ladder only REQUESTS a size. The Risk Engine approves it, clamps it or blocks it — and remains authoritative. Reaching the maximum level abandons the ladder; it does not escalate.',
        configured: function (res) {
          var c = res.configured;
          return el('div', { class: 'stack-sm' }, [
            el('div', { class: 'grid grid-kpi' }, [
              ui.kpi('Recovery', ui.status(c.enabled ? 'ENABLED' : 'DISABLED'), c.enabled ? 'configured now' : 'opt-in; off by default', { text: true }),
              ui.kpi('Max level', fmt.int(c.maxRecoveryLevel), 'then the ladder is abandoned'),
              ui.kpi('Multiplier', '×' + c.multiplier, 'base ' + fmt.lots(c.baseLots) + ' lots'),
              ui.kpi('Position cap', fmt.lots(c.maxPositionSizeLots), 'lots — the Risk Engine\'s ceiling')
            ]),
            ui.card({ title: 'Requested ladder against the cap', sub: 'What each rung would ask for. Anything above the cap is clamped.',
              body: ui.bars(c.requestedLadder.map(function (lots, i) {
                return { label: 'level ' + i, value: lots, text: fmt.lots(lots) + (lots > c.maxPositionSizeLots ? ' → clamped to ' + fmt.lots(c.maxPositionSizeLots) : ''),
                  kind: lots > c.maxPositionSizeLots ? 'neg' : null };
              })) })
          ]);
        },
        render: function (res) {
          var d = res.data;
          return [
            ui.card({
              title: 'State per asset', sub: 'Recovery state is kept per asset. "Reset" counts the wins that returned the ladder to its base.', flush: true,
              body: ui.table({
                dense: true, caption: 'Recovery state per asset',
                columns: [
                  { label: 'Asset', render: function (a) { return a.symbol; } },
                  { label: 'Level', num: true, render: function (a) { return a.recorded ? String(a.level) : ui.noDataInline('no transition recorded'); } },
                  { label: 'Cumulative loss', num: true, render: function (a) { return a.recorded ? fmt.money(a.cumulativeLossMoney, 4) : null; } },
                  { label: 'Requested size', num: true, render: function (a) { return fmt.lots(a.requestedLots); } },
                  { label: 'Approved size', num: true, render: function (a) { return fmt.lots(a.approvedLots); } },
                  { label: 'Risk verdict', render: function (a) { return a.riskVerdict ? ui.status(a.riskVerdict) : null; } },
                  { label: 'Last transition', render: function (a) { return a.lastReason ? fmt.words(a.lastReason) : null; } },
                  { label: 'Max level', num: true, render: function (a) { return a.recorded ? String(a.maxLevel) : null; } },
                  { label: 'Reset', num: true, render: function (a) { return a.recorded ? fmt.int(a.resets) : null; } },
                  { label: 'Abandoned', num: true, render: function (a) { return a.recorded ? fmt.int(a.abandonedAtCap + a.abandonedByRisk) : null; } }
                ],
                rows: d.perAsset
              })
            }),
            el('div', { class: 'grid grid-2' }, [
              ui.card({ title: 'Transitions by reason', sub: d.transitions + ' recorded.', body: freqBars(d.byReason, 'No recovery transition is recorded in this source.') }),
              ui.card({ title: 'Reading this', body: el('ul', { class: 'stack-sm' }, [
                el('li', { text: '· LOSS ESCALATED — a loss moved the ladder up one level.' }),
                el('li', { text: '· WIN RESET — a win returned it to base.' }),
                el('li', { text: '· CAP ABANDONED — the maximum level was reached; the accumulated loss was realised, not chased.' }),
                el('li', { text: '· RISK BLOCK ABANDONED — the Risk Engine blocked the rung, so the ladder was dropped.' }),
                el('li', { text: '· TP UNREACHABLE — the target could not recover the loss at the APPROVED size, so no trade was taken.' })
              ]) })
            ]),
            ui.card({
              title: 'History', sub: 'The latest ' + d.history.length + ' transitions.', flush: true,
              body: ui.table({
                dense: true, empty: ui.state({ tag: 'NONE RECORDED', compact: true, body: 'The ladder did not move in this source.' }),
                columns: [
                  { label: 'Bar', render: function (r) { return el('span', { class: 't-num', text: fmt.barTime(r.ts) }); } },
                  { label: 'Asset', render: function (r) { return r.symbol; } },
                  { label: 'Transition', render: function (r) { return fmt.words(r.reason); } },
                  { label: 'Level', num: true, render: function (r) { return String(r.level); } },
                  { label: 'Cumulative loss', num: true, render: function (r) { return fmt.money(r.cumulativeLossMoney, 4); } },
                  { label: 'Wanted (uncapped)', num: true, render: function (r) { return fmt.lots(r.nextLotsUncapped); } },
                  { label: 'Requested', num: true, render: function (r) { return fmt.lots(r.nextLotsRequested); } },
                  { label: 'Trade net', num: true, render: function (r) { return r.netPnl === null ? el('span', { class: 't-secondary', text: 'none' }) : ui.signedMoney(r.netPnl, 4); } }
                ],
                rows: d.history
              })
            })
          ];
        }
      });
    }
  });
})();
