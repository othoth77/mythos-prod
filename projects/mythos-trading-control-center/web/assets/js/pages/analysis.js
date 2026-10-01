/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Analysis
   projects/mythos-trading-control-center/web/assets/js/pages/analysis.js

   The Analysis Agent's report, shown as the agent wrote it. This page computes
   nothing: every number on it is a field of the stored report (or, for a live
   paper session, of the report the agent produced a moment ago over the
   session's own store).

   THE AGENT'S DISCIPLINE IS KEPT VISIBLE
     · Every group carries its sample size. A group below the threshold is
       marked INSUFFICIENT DATA beside its numbers — the numbers stay, labelled
       for what they are, so nobody mistakes a four-trade win rate for evidence
       and nobody wonders what was hidden.
     · Drawdown is reported once, for the run. There is no drawdown per
       strategy or per Jev band, because that is not a quantity: extracting a
       subset's trades invents an equity curve that never existed.
     · The Jev interpretation is the agent's own sentence. It reports a
       direction and refuses to conclude below two sufficient bands; it never
       recommends a threshold.
     · The caveats are computed from the report and are shown first.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;
  var ex = TCC.explore;

  function sample(g) {
    return el('span', { class: 'row-tight' }, [
      el('span', { class: 't-num', text: 'n=' + g.sampleSize }),
      g.sufficient ? ui.badge('sufficient', 'ok') : ui.badge('INSUFFICIENT DATA', 'warn')
    ]);
  }

  /** A table of the agent's groups: { key: { sampleSize, sufficient, winRate, … } }. */
  function groupTable(title, sub, groups, keyLabel) {
    var keys = Object.keys(groups || {});
    return ui.card({
      title: title, sub: sub, flush: true,
      body: ui.table({
        dense: true, caption: title,
        empty: ui.state({ tag: 'NO DATA', compact: true, body: 'No closed trade falls in any group.' }),
        columns: [
          { label: keyLabel, render: function (k) { return fmt.words(k); } },
          { label: 'Sample', render: function (k) { return sample(groups[k]); } },
          { label: 'Win rate', num: true, render: function (k) { return fmt.pct(groups[k].winRate); } },
          { label: 'Expectancy', num: true, render: function (k) { return ui.value(fmt.signedMoney(groups[k].expectancy, 4), { sign: groups[k].expectancy }); } },
          { label: 'Expectancy R', num: true, render: function (k) { return ui.value(fmt.r(groups[k].expectancyR), { sign: groups[k].expectancyR, naReason: 'no trade carried a risk amount' }); } },
          { label: 'Profit factor', num: true, render: function (k) { return fmt.num(groups[k].profitFactor, 3); } },
          { label: 'Net', num: true, render: function (k) { return ui.signedMoney(groups[k].netPnl); } },
          { label: 'Costs', num: true, render: function (k) { return fmt.money(groups[k].totalCosts); } },
          { label: 'Max streak', num: true, render: function (k) { return fmt.int(groups[k].maxConsecutiveLosses); } }
        ],
        rows: keys
      })
    });
  }

  function freq(list, emptyText) {
    return ui.bars((list || []).map(function (x) { return { label: fmt.words(x.value), value: x.count, text: fmt.int(x.count) }; }), { emptyText: emptyText });
  }

  function overview(a) {
    var o = a.overview;
    return el('div', { class: 'grid grid-6' }, [
      ui.kpi('Trades', fmt.int(o.trades), o.trades < a.minSample ? 'INSUFFICIENT DATA (n < ' + a.minSample + ')' : 'sample threshold n ≥ ' + a.minSample),
      ui.kpi('Net P&L', ui.signedMoney(o.netPnl), ['costs ', fmt.money(o.costs)]),
      ui.kpi('Expectancy', ui.value(fmt.signedMoney(o.expectancy, 4), { sign: o.expectancy }), 'net, per trade', { naReason: 'no trade closed' }),
      ui.kpi('Profit factor', fmt.num(o.profitFactor, 3), null, { naReason: 'no losing trade in the sample' }),
      ui.kpi('Max drawdown', fmt.pctRaw(o.maxDrawdownPct), 'for the run, never per group'),
      ui.kpi('Max losing streak', fmt.int(o.maxConsecutiveLosses), ['recovery level up to ', fmt.int(o.maxRecoveryLevel)])
    ]);
  }

  function funnel(a) {
    var f = a.funnel;
    var stages = Object.keys(f.rejectedByStage || {});
    return ui.card({
      title: 'Decision funnel',
      sub: 'What the strategies proposed, and where each rejection happened.',
      body: el('div', { class: 'stack' }, [
        el('div', { class: 'row-tight' }, [
          ui.badge(fmt.int(f.candidatesBuilt) + ' candidates built', 'neutral'),
          ui.badge(fmt.int(f.decisionsRecorded) + ' decisions recorded', 'neutral'),
          ui.badge(fmt.int(f.entered) + ' entered', 'ok'),
          ui.badge('entry rate ' + (fmt.pct(f.entryRate, 2) || 'n/a'), 'neutral')
        ]),
        stages.length ? ui.table({
          dense: true,
          columns: [
            { label: 'Stopped at', render: function (s) { return s; } },
            { label: 'Rejections', num: true, render: function (s) { return fmt.int(f.rejectedByStage[s].rejected); } },
            { label: 'Top recorded reasons', render: function (s) {
              return el('span', { class: 'chips' }, f.rejectedByStage[s].topReasons.map(function (r) { return ui.chip(r.value + ' ' + r.count); }));
            } }
          ],
          rows: stages
        }) : ui.state({ tag: 'NONE RECORDED', compact: true, body: 'No rejection is recorded.' })
      ])
    });
  }

  function regimes(a) {
    var r = a.regimes;
    return el('div', { class: 'stack' }, [
      el('div', { class: 'grid grid-2' }, [
        ui.card({ title: 'Regime distribution', sub: fmt.int(r.barsClassified) + ' bars classified. ' + r.note,
          body: freq(r.distribution, 'No bar was classified.') }),
        ui.card({ title: 'Classification', body: ui.kv([
          ['Held by hysteresis', ui.value(fmt.pct(r.heldShare))],
          ['Confidence — median', r.confidence ? el('span', { class: 't-num', text: fmt.num(r.confidence.median, 4) }) : null],
          ['Confidence — quartiles', r.confidence ? el('span', { class: 't-num', text: fmt.num(r.confidence.p25, 4) + ' – ' + fmt.num(r.confidence.p75, 4) }) : null]
        ]) })
      ]),
      groupTable('Regime statistics', 'Trades grouped by the regime they were taken under.', r.performanceByRegime, 'Regime')
    ]);
  }

  function jev(a) {
    var j = a.jev;
    if (!j.verdicts) return ui.card({ title: 'Jev bands', body: ui.state({ tag: 'NO DATA', compact: true, body: j.note || 'No Jev decision is recorded.' }) });
    var comps = Object.keys(j.components || {});
    return el('div', { class: 'stack' }, [
      ui.card({
        title: 'Jev — the agent\'s reading',
        sub: 'It reports a direction and refuses to conclude below two sufficient bands. It never recommends a threshold.',
        body: el('div', { class: 'stack-sm' }, [
          el('div', { class: 'row-tight' }, [ui.badge(fmt.words(j.interpretation.conclusion), /INSUFFICIENT/.test(j.interpretation.conclusion) ? 'warn' : 'neutral'),
            el('span', { class: 't-num', text: fmt.int(j.verdicts) + ' verdicts · ' + fmt.pct(j.enterRate) + ' allowed' })]),
          el('p', { class: 't-wrap', text: j.interpretation.detail }),
          ui.kv([
            ['Score — min / median / max', el('span', { class: 't-num', text: fmt.num(j.scoreDistribution.min, 2) + ' / ' + fmt.num(j.scoreDistribution.median, 2) + ' / ' + fmt.num(j.scoreDistribution.max, 2) })],
            ['Score — quartiles', el('span', { class: 't-num', text: fmt.num(j.scoreDistribution.p25, 2) + ' – ' + fmt.num(j.scoreDistribution.p75, 2) })]
          ])
        ])
      }),
      groupTable('Jev bands', 'Trades grouped by the band of the score they were taken under. BELOW BANDS means under the first reporting band.', j.bandPerformance, 'Band'),
      ui.card({
        title: 'Which components decided anything', sub: 'A component with no spread contributed a constant: it decided nothing.', flush: true,
        body: ui.table({
          dense: true,
          columns: [
            { label: 'Component', render: function (k) { return k; } },
            { label: 'Weight', num: true, render: function (k) { return fmt.num(j.components[k].weight, 2); } },
            { label: 'Mean', num: true, render: function (k) { return fmt.num(j.components[k].mean, 4); } },
            { label: 'Min – max', num: true, render: function (k) { return fmt.num(j.components[k].min, 4) + ' – ' + fmt.num(j.components[k].max, 4); } },
            { label: 'Discriminates', render: function (k) { return j.components[k].discriminates ? ui.badge('yes', 'ok') : ui.badge('NO — constant', 'warn'); } }
          ],
          rows: comps
        })
      })
    ]);
  }

  function costs(a) {
    var c = a.costs;
    if (!c.trades) return ui.card({ title: 'Costs', body: ui.state({ tag: 'NO DATA', compact: true, body: c.note || 'No trade closed.' }) });
    return ui.card({
      title: 'Costs', sub: c.costsFlippedTheSign ? 'COSTS FLIPPED THE SIGN: the result was positive before costs and negative after.' : 'How much of the outcome the cost model decided.',
      body: el('div', { class: 'stack-sm' }, [
        ui.kv([
          ['Gross P&L', ui.signedMoney(c.grossPnl, 4)],
          ['Total costs', el('span', { class: 't-num', text: fmt.money(c.totalCosts, 4) })],
          ['Net P&L', ui.signedMoney(c.netPnl, 4)],
          ['Average cost per trade', el('span', { class: 't-num', text: fmt.money(c.avgCostPerTrade, 4) })],
          ['Costs ÷ |gross movement|', ui.value(fmt.pct(c.costsOverAbsGross))]
        ]),
        ui.bars([
          { label: 'Spread', value: c.byComponent.spreadMoney, text: fmt.money(c.byComponent.spreadMoney, 4) },
          { label: 'Commission', value: c.byComponent.commissionMoney, text: fmt.money(c.byComponent.commissionMoney, 4) },
          { label: 'Slippage', value: c.byComponent.slippageMoney, text: fmt.money(c.byComponent.slippageMoney, 4) },
          { label: 'Swap', value: c.byComponent.swapMoney, text: fmt.money(c.byComponent.swapMoney, 4) }
        ])
      ])
    });
  }

  function streaks(a) {
    var s = a.losingStreaks;
    var hist = Object.keys(s.histogram || {}).map(Number).sort(function (x, y) { return x - y; });
    return ui.card({
      title: 'Losing streak', sub: s.note,
      body: el('div', { class: 'stack-sm' }, [
        ui.kv([
          ['Longest', el('span', { class: 't-num', text: fmt.int(s.maxConsecutiveLosses) })],
          ['Average', ui.value(fmt.num(s.avgLosingStreak, 2), { naReason: 'no losing streak occurred' })],
          ['Streaks', el('span', { class: 't-num', text: fmt.int(s.streakCount) })],
          s.worstStreak ? ['Worst streak', el('span', { class: 't-num', text: s.worstStreak.length + ' losses, net ' + fmt.signedMoney(s.worstStreak.netPnl, 4) +
            ', ' + fmt.barTime(s.worstStreak.fromTs) + ' → ' + fmt.barTime(s.worstStreak.toTs) })] : null,
          s.worstStreak ? ['Its composition', el('span', { class: 'chips' }, s.worstStreak.strategies.map(function (x) { return ui.chip(x.value + ' ' + x.count); }))] : null
        ]),
        hist.length ? el('div', null, [el('div', { class: 't-label', text: 'Streak lengths' }),
          ui.bars(hist.map(function (k) { return { label: k + ' in a row', value: s.histogram[k], text: fmt.int(s.histogram[k]) + ' time(s)' }; }))]) : null,
        s.probabilities && s.probabilities.length ? ui.table({
          dense: true,
          columns: [
            { label: 'k consecutive losses', num: true, render: function (p) { return String(p.k); } },
            { label: 'Measured frequency', num: true, render: function (p) { return fmt.pct(p.probability, 2); } },
            { label: 'Windows', num: true, render: function (p) { return p.hits + ' of ' + p.windows; } }
          ],
          rows: s.probabilities
        }) : null
      ])
    });
  }

  function drawdown(a) {
    var d = a.drawdown;
    return ui.card({
      title: 'Drawdown', sub: 'From the ' + (d.curveSource === 'MARK_TO_MARKET' ? 'mark-to-market equity curve' : 'trade closes only (understates it)') + '.',
      body: el('div', { class: 'stack-sm' }, [
        ui.kv([
          ['Maximum', el('span', { class: 't-num', text: fmt.pctRaw(d.maxDrawdownPct, 4) + ' (' + fmt.money(d.maxDrawdownMoney, 4) + ')' })],
          ['Peak → trough', el('span', { class: 't-num', text: (fmt.barTime(d.peakTs) || 'n/a') + ' → ' + (fmt.barTime(d.troughTs) || 'n/a') })],
          ['Recovered', d.neverRecovered ? ui.badge('NEVER RECOVERED in this run', 'danger') : (d.recoveredAtTs ? el('span', { class: 't-num', text: fmt.barTime(d.recoveredAtTs) }) : ui.na('no drawdown occurred'))],
          ['Episodes deeper than 1%', el('span', { class: 't-num', text: fmt.int(d.episodesOverOnePercent) })]
        ]),
        d.episodes && d.episodes.length ? ui.table({
          dense: true,
          columns: [
            { label: 'From', render: function (e) { return el('span', { class: 't-num', text: fmt.barTime(e.fromTs) }); } },
            { label: 'Trough', render: function (e) { return el('span', { class: 't-num', text: fmt.barTime(e.troughTs) }); } },
            { label: 'Depth', num: true, render: function (e) { return fmt.pctRaw(e.depthPct, 4); } },
            { label: 'Recovered', render: function (e) { return e.recoveredAtTs ? el('span', { class: 't-num', text: fmt.barTime(e.recoveredAtTs) }) : ui.badge('not recovered', 'warn'); } }
          ],
          rows: d.episodes
        }) : null
      ])
    });
  }

  function riskAndRecovery(a) {
    var r = a.risk;
    var c = a.recovery;
    return el('div', { class: 'grid grid-2' }, [
      ui.card({
        title: 'Risk verdicts',
        body: !r.assessments ? ui.state({ tag: 'NO DATA', compact: true, body: r.note || 'No risk assessment recorded.' }) : el('div', { class: 'stack-sm' }, [
          ui.kv([
            ['Assessments', el('span', { class: 't-num', text: fmt.int(r.assessments) })],
            ['By verdict', el('span', { class: 't-num', text: Object.keys(r.byVerdict).sort().map(function (k) { return k + ' ' + r.byVerdict[k]; }).join(' · ') })],
            ['Block rate', ui.value(fmt.pct(r.blockRate))], ['Clamp rate', ui.value(fmt.pct(r.clampRate))],
            ['Mean clamp factor', ui.value(fmt.num(r.meanClampFactor, 4), { naReason: 'no request was clamped' })]
          ]),
          el('div', { class: 't-label', text: 'Limits that bound' }), freq(r.topBindingLimits, 'No limit was binding.')
        ])
      }),
      ui.card({
        title: 'Recovery', sub: c.note,
        body: el('div', { class: 'stack-sm' }, [
          ui.kv([
            ['Transitions', el('span', { class: 't-num', text: fmt.int(c.transitions) })],
            ['Highest level reached', el('span', { class: 't-num', text: fmt.int(c.maxLevelReached) })],
            ['Trades above base level', ui.value(fmt.pct(c.shareAboveBase), { naReason: 'no trade closed' })],
            ['Abandoned at the cap', el('span', { class: 't-num', text: fmt.int(c.abandonedAtCap) })],
            ['Abandoned by a risk block', el('span', { class: 't-num', text: fmt.int(c.abandonedByRisk) })]
          ]),
          el('div', { class: 't-label', text: 'Transitions by reason' }), freq(c.byReason, 'The ladder did not move.')
        ])
      })
    ]);
  }

  function view(res) {
    var a = res.analysis;
    var thin = a.overview.trades < a.minSample;
    return el('div', { class: 'stack-lg', id: 'analysis-report' }, [
      ui.sourceLine(res.context),
      el('p', { class: 't-small t-secondary', text: 'Report by the ' + fmt.words(a.agent) + ' over ' + fmt.int(a.generatedFrom.trades) + ' trade(s); store digest ' +
        a.generatedFrom.digest.slice(0, 12) + '; ' + (res.computed === 'LIVE' ? 'computed now over the live session.' : 'stored with the run.') }),
      thin ? ui.banner('warn', 'Insufficient data', 'This source has ' + a.overview.trades + ' trade(s); the agent\'s threshold is ' + a.minSample +
        '. Every figure below is a number, not evidence.') : null,
      ui.card({ title: 'Caveats', sub: 'Computed from this report by the Analysis Agent.',
        body: el('ul', { class: 'stack-sm' }, a.caveats.map(function (c) { return el('li', { class: 't-wrap', text: '· ' + c }); })) }),
      overview(a),
      funnel(a),
      groupTable('Strategy statistics', 'Net of all costs. ' + (Object.keys(a.byStrategy)[0] ? a.byStrategy[Object.keys(a.byStrategy)[0]].drawdownNote + '.' : ''), a.byStrategy, 'Strategy'),
      groupTable('Symbol statistics', null, a.bySymbol, 'Asset'),
      groupTable('Direction statistics', null, a.byDirection, 'Direction'),
      regimes(a),
      jev(a),
      el('div', { class: 'grid grid-2' }, [costs(a), streaks(a)]),
      drawdown(a),
      riskAndRecovery(a)
    ]);
  }

  TCC.page('/analysis', {
    title: 'Analysis',
    render: function (ctx) {
      var run = ctx.query.get('run') || null;
      var host = el('div', { id: 'analysis-body' });
      var last = null;
      ctx.root.appendChild(ui.pageHead('Analysis', 'The Analysis Agent\'s report. Read-only: it changes no rule and recommends no threshold.',
        [ex.runPicker(run, function (v) { run = v; ex.setQuery('/analysis', { run: run }); load(false); })]));
      ctx.root.appendChild(host);
      function load(silent) {
        return ui.load(host, function () { return api.get('/api/analysis', { run: run }); }, function (res) {
          last = JSON.stringify(res.context) + (res.analysis ? res.analysis.generatedFrom.digest : '');
          if (res.context.available === false) return ui.noData(res.context.reason, [TCC.link('/backtest', 'Open the Backtest Center', 'btn btn-secondary')]);
          if (!res.analysis) return el('div', { class: 'stack' }, [ui.sourceLine(res.context), ui.noData(res.reason || 'No Analysis Agent report exists for this source.')]);
          return view(res);
        }, { silent: silent, alive: ctx.alive });
      }
      load(false);
      ctx.every(6000, function () {
        api.get('/api/analysis', { run: run }).then(function (res) {
          var key = JSON.stringify(res.context) + (res.analysis ? res.analysis.generatedFrom.digest : '');
          if (ctx.alive() && key !== last) load(true);
        }).catch(function () { /* the next beat retries */ });
      });
    }
  });
})();
