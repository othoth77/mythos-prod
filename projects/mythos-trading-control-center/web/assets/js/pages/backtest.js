/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Backtest Center
   projects/mythos-trading-control-center/web/assets/js/pages/backtest.js

   Configure a run, start it, read it. A run is a separate process driving the
   Trading Agent's own engine; it is recorded with its id, timestamps,
   configuration, commit, data source and status, and its store is kept so the
   explorers can open it later.

   EVERY RESULT WEARS ITS LABEL — SYNTHETIC, HISTORICAL or PAPER — on the list
   row, on the detail header and above the figures. In this build every dataset
   is synthetic, and HISTORICAL is listed as unavailable with the reason rather
   than left out, so nobody wonders whether it was forgotten.

   NO SYNTHETIC PROFITABILITY CLAIM. A positive net figure on synthetic data is
   shown with the statement that it is not evidence of edge. Costs, drawdown
   and the losing streak sit beside any profit figure, never on another tab.

   The inputs bound the run. They do not set a position size: "maximum position
   size" is a ceiling the Risk Engine enforces, and the Risk Engine decides.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;
  var charts = TCC.charts;

  function dateOf(ts) { return new Date(ts).toISOString().slice(0, 10); }

  // ---------------------------------------------------------------------------
  // the form
  // ---------------------------------------------------------------------------

  function form(options, onStarted) {
    var op = api.can('operate');
    var d = options.defaults;
    var kinds = options.data.kinds;
    var kindSel = ui.select(kinds.map(function (k) {
      return { value: k.kind, label: k.kind + ' — ' + k.label.toLowerCase() + (k.available ? '' : ' (not available)'), disabled: !k.available };
    }), 'FIXTURE', null, { disabled: !op });
    var tfSel = ui.select(['M15'], 'M15', null, { disabled: !op });
    var bars = ui.input({ type: 'number', value: 3000, min: 300, max: 6000, step: '1', num: true, disabled: !op });
    var seed = ui.input({ value: 'backtest', maxlength: 64, disabled: !op });
    var from = ui.input({ type: 'date', disabled: !op });
    var to = ui.input({ type: 'date', disabled: !op });
    var capital = ui.input({ type: 'number', value: d.initialCapital, min: 1, step: 'any', num: true, disabled: !op });
    var label = ui.input({ value: 'backtest', maxlength: 48, disabled: !op });

    var jevScore = ui.input({ type: 'number', value: d.jev.scoreThreshold, min: 0, max: 100, step: 'any', num: true, disabled: !op });
    var jevConf = ui.input({ type: 'number', value: d.jev.minConfidence, min: 0, max: 1, step: 'any', num: true, disabled: !op });

    var riskPct = ui.input({ type: 'number', value: d.risk.maxAccountRiskPerTradePct, min: 0.01, max: 25, step: 'any', num: true, disabled: !op });
    var riskDd = ui.input({ type: 'number', value: d.risk.maxDrawdownPct, min: 0.5, max: 90, step: 'any', num: true, disabled: !op });
    var riskDaily = ui.input({ type: 'number', value: d.risk.maxDailyLossPct, min: 0.1, max: 50, step: 'any', num: true, disabled: !op });
    var riskStreak = ui.input({ type: 'number', value: d.risk.maxConsecutiveLosses, min: 1, max: 50, step: '1', num: true, disabled: !op });
    var riskLots = ui.input({ type: 'number', value: d.risk.maxPositionSizeLots, min: 0.01, max: 100, step: 'any', num: true, disabled: !op });

    var recOn = ui.switch('Recovery ×3', d.recovery.enabled, null, { disabled: !op, on: 'ENABLED', off: 'DISABLED' });
    var recLevel = ui.input({ type: 'number', value: d.recovery.maxRecoveryLevel, min: 0, max: 8, step: '1', num: true, disabled: !op });

    var spreadModel = ui.select(['instrument-typical', 'fixed', 'bar-derived'], d.cost.spreadModel, null, { disabled: !op });
    var spreadPips = ui.input({ type: 'number', value: d.cost.fixedSpreadPips === undefined ? 1.5 : d.cost.fixedSpreadPips, min: 0, step: 'any', num: true, disabled: !op });
    var slipModel = ui.select(['gaussian', 'fixed', 'none'], d.cost.slippageModel, null, { disabled: !op });
    var slipPips = ui.input({ type: 'number', value: d.cost.fixedSlippagePips === undefined ? 0.3 : d.cost.fixedSlippagePips, min: 0, step: 'any', num: true, disabled: !op });
    var commission = ui.switch('Commission', d.cost.includeCommission, null, { disabled: !op, on: 'CHARGED', off: 'NOT CHARGED' });
    var swap = ui.switch('Swap', d.cost.includeSwap, null, { disabled: !op, on: 'CHARGED', off: 'NOT CHARGED' });

    var symbolHost = el('div', { class: 'row-tight' });
    var symbolBoxes = [];
    var stratBoxes = options.strategies.map(function (s) { return { id: s.strategyId, box: ui.checkbox(s.strategyId, s.enabled, null, { disabled: !op }) }; });
    var rangeHint = el('span', { class: 'hint' });
    var spreadField = ui.field({ label: 'Fixed spread (pips)', control: spreadPips });
    var slipField = ui.field({ label: 'Fixed slippage (pips)', control: slipPips });
    var seedField = ui.field({ label: 'Seed', hint: 'The synthetic series is reproducible from it.', control: seed });
    var error = el('div');

    function kind() { return kinds.filter(function (k) { return k.kind === kindSel.value; })[0]; }

    function paintData() {
      var k = kind();
      var tfs = options.timeframes[k.kind] || ['M15'];
      TCC.replace(tfSel, tfs.map(function (t) { return el('option', { text: t, attrs: { value: t } }); }));
      tfSel.value = tfs.indexOf('M15') !== -1 ? 'M15' : tfs[0];
      var symbols = k.symbols || [];
      symbolBoxes = symbols.map(function (s) {
        return { symbol: s, box: ui.checkbox(s, options.universe.indexOf(s) !== -1 && symbolBoxes.length === 0 ? true : false, null, { disabled: !op }) };
      });
      // Default: the first asset of the universe that this data kind can serve.
      var first = symbolBoxes.filter(function (b) { return options.universe.indexOf(b.symbol) !== -1; })[0] || symbolBoxes[0];
      symbolBoxes.forEach(function (b) { b.box.input.checked = b === first; });
      TCC.replace(symbolHost, symbolBoxes.map(function (b) { return b.box; }));
      seedField.hidden = k.kind !== 'SYNTHETIC';
      if (k.kind === 'FIXTURE' && k.ranges && first) {
        var r = k.ranges[first.symbol];
        from.min = to.min = dateOf(r.fromTs);
        from.max = to.max = dateOf(r.toTs);
        rangeHint.textContent = 'Fixture window ' + dateOf(r.fromTs) + ' to ' + dateOf(r.toTs) + ' (UTC), ' + r.bars + ' bars. Leave empty for all of it.';
      } else {
        from.removeAttribute('min'); from.removeAttribute('max'); to.removeAttribute('min'); to.removeAttribute('max');
        rangeHint.textContent = 'Synthetic series start 2023-01-02 (UTC). Leave empty for all generated bars.';
      }
    }
    function paintCost() {
      spreadField.hidden = spreadModel.value !== 'fixed';
      slipField.hidden = slipModel.value !== 'fixed';
    }
    kindSel.addEventListener('change', paintData);
    spreadModel.addEventListener('change', paintCost);
    slipModel.addEventListener('change', paintCost);

    function n(input) { return input.value === '' ? NaN : Number(input.value); }

    var run = ui.button('Run backtest', 'btn-primary', function (b) {
      TCC.clear(error);
      var symbols = symbolBoxes.filter(function (x) { return x.box.input.checked; }).map(function (x) { return x.symbol; });
      var strategies = stratBoxes.filter(function (x) { return x.box.input.checked; }).map(function (x) { return x.id; });
      var problems = [];
      if (!symbols.length) problems.push('choose at least one asset');
      if (!strategies.length) problems.push('choose at least one strategy');
      var nums = { 'initial capital': n(capital), 'Jev threshold': n(jevScore), 'Jev confidence': n(jevConf), 'risk %': n(riskPct),
        'maximum drawdown': n(riskDd), 'daily loss': n(riskDaily), 'consecutive losses': n(riskStreak), 'maximum position size': n(riskLots),
        'recovery level': n(recLevel), bars: n(bars) };
      Object.keys(nums).forEach(function (k) { if (!isFinite(nums[k])) problems.push('enter a number for ' + k); });
      if (problems.length) { TCC.replace(error, ui.banner('danger', 'Not started', problems.join('; ') + '.')); return; }

      var body = {
        label: label.value.trim() || 'backtest',
        symbols: symbols, timeframe: tfSel.value,
        data: { kind: kindSel.value, bars: nums.bars },
        strategies: strategies,
        initialCapital: nums['initial capital'],
        jev: { scoreThreshold: nums['Jev threshold'], minConfidence: nums['Jev confidence'] },
        risk: { maxAccountRiskPerTradePct: nums['risk %'], maxDrawdownPct: nums['maximum drawdown'], maxDailyLossPct: nums['daily loss'],
          maxConsecutiveLosses: nums['consecutive losses'], maxPositionSizeLots: nums['maximum position size'] },
        recovery: { enabled: recOn.input.checked, maxRecoveryLevel: nums['recovery level'] },
        cost: { spreadModel: spreadModel.value, slippageModel: slipModel.value, includeCommission: commission.input.checked, includeSwap: swap.input.checked }
      };
      if (kindSel.value === 'SYNTHETIC') body.data.seed = seed.value.trim() || 'backtest';
      if (spreadModel.value === 'fixed') body.cost.fixedSpreadPips = n(spreadPips);
      if (slipModel.value === 'fixed') body.cost.fixedSlippagePips = n(slipPips);
      if (from.value) body.fromTs = Date.parse(from.value + 'T00:00:00Z');
      if (to.value) body.toTs = Date.parse(to.value + 'T23:59:59Z');

      ui.run(b, 'Starting…', function () {
        return api.post('/api/backtest', body).then(function (res) {
          TCC.toast('ok', 'Started', 'Run ' + res.result.run.runId + '. Audit entry #' + res.audit.seq + '.');
          onStarted(res.result.run);
        }).catch(function (e) { TCC.replace(error, ui.banner('danger', e.code === 'JOB_ALREADY_RUNNING' ? 'Busy' : 'Refused', TCC.describeError(e))); });
      });
    }, { disabled: !op });

    paintData();
    paintCost();

    function group(title, nodes) {
      return el('fieldset', null, [el('legend', { class: 't-label', text: title }), el('div', { class: 'form-grid' }, nodes)]);
    }

    return ui.card({
      title: 'New backtest',
      sub: 'One run at a time. The run is validated before any process starts.',
      body: el('div', { class: 'stack', id: 'backtest-form' }, [
        ui.banner('warn', 'Synthetic', options.data.warning),
        group('Data', [
          ui.field({ label: 'Data source', hint: (kinds.filter(function (k) { return !k.available; })[0] || {}).reason, control: kindSel }),
          ui.field({ label: 'Timeframe', control: tfSel }),
          ui.field({ label: 'Bars', hint: '300 – ' + options.maxSyntheticBars + '.', control: bars }),
          seedField,
          ui.field({ label: 'From (UTC)', control: from }),
          el('div', { class: 'field' }, [el('label', { text: 'To (UTC)', attrs: { for: 'bt-to' } }), (to.id = 'bt-to', to), rangeHint])
        ]),
        el('fieldset', null, [el('legend', { class: 't-label', text: 'Assets' }), symbolHost]),
        el('fieldset', null, [el('legend', { class: 't-label', text: 'Strategies' }), el('div', { class: 'row-tight' }, stratBoxes.map(function (s) { return s.box; }))]),
        group('Account', [
          ui.field({ label: 'Initial capital', control: capital }),
          ui.field({ label: 'Run label', hint: 'Letters, digits, dot, dash, underscore.', control: label })
        ]),
        group('Jev', [
          ui.field({ label: 'Score threshold', control: jevScore }),
          ui.field({ label: 'Minimum confidence', control: jevConf })
        ]),
        group('Risk — limits the Risk Engine enforces', [
          ui.field({ label: 'Risk per trade (%)', control: riskPct }),
          ui.field({ label: 'Maximum drawdown (%)', control: riskDd }),
          ui.field({ label: 'Daily loss (%)', control: riskDaily }),
          ui.field({ label: 'Consecutive losses', control: riskStreak }),
          ui.field({ label: 'Maximum position size (lots)', hint: 'A ceiling, not a size.', control: riskLots })
        ]),
        group('Recovery', [
          el('div', { class: 'field' }, [recOn]),
          ui.field({ label: 'Maximum recovery level', control: recLevel })
        ]),
        group('Costs', [
          ui.field({ label: 'Spread', control: spreadModel }), spreadField,
          ui.field({ label: 'Slippage', control: slipModel }), slipField,
          el('div', { class: 'field' }, [commission]),
          el('div', { class: 'field' }, [swap])
        ]),
        error,
        el('div', { class: 'form-actions' }, [!op ? ui.needsRole('OPERATOR') : null, run])
      ])
    });
  }

  // ---------------------------------------------------------------------------
  // run list
  // ---------------------------------------------------------------------------

  function runsTable(list, selected, onOpen) {
    return ui.card({
      title: 'Runs', sub: list.runs.length + ' retained (the newest ' + list.limits.maxRuns + ' are kept).', flush: true,
      body: ui.table({
        dense: true, rowKey: function (r) { return r.runId; }, selected: selected, onRow: onOpen,
        empty: ui.state({ tag: 'NO DATA', compact: true, body: 'No run exists yet. Configure one above and run it.' }),
        columns: [
          { label: 'Run', render: function (r) { return ui.chip(r.runId); } },
          { label: 'Label', render: function (r) { return ui.dataLabel(r.label === 'PAPER' ? 'PAPER' : (r.data ? r.data.label : null)); } },
          { label: 'Status', render: function (r) { return ui.status(r.status); } },
          { label: 'Started', render: function (r) { return el('span', { class: 't-num', text: fmt.wallShort(r.startedAt) }); } },
          { label: 'Assets', render: function (r) { return r.data && r.data.symbols ? r.data.symbols.join(', ') : null; } },
          { label: 'Trades', num: true, render: function (r) { return r.summary && r.summary.headline ? fmt.int(r.summary.headline.trades) : null; } },
          { label: 'Net', num: true, render: function (r) { return r.summary && r.summary.headline ? ui.signedMoney(r.summary.headline.netPnl) : null; } },
          { label: 'Max DD', num: true, render: function (r) { return r.summary && r.summary.headline ? fmt.pctRaw(r.summary.headline.maxDrawdownPct) : null; } },
          { label: 'By', render: function (r) { return r.actor ? r.actor.id : null; } }
        ],
        rows: list.runs
      })
    });
  }

  // ---------------------------------------------------------------------------
  // run detail
  // ---------------------------------------------------------------------------

  function identity(run, result, dataLabel) {
    var data = (result && result.data) || run.data || {};
    return ui.card({
      title: 'Run identity', sub: 'Everything needed to reproduce it.',
      body: ui.kv([
        ['Run ID', ui.chip(run.runId)],
        ['Kind', run.kind],
        ['Label', ui.dataLabel(dataLabel)],
        ['Status', ui.status(run.status)],
        ['Started', el('span', { class: 't-num', text: fmt.wall(run.startedAt) })],
        ['Finished', run.finishedAt ? el('span', { class: 't-num', text: fmt.wall(run.finishedAt) + ' (' + fmt.duration(run.durationMs) + ')' }) : null],
        ['Started by', run.actor ? run.actor.id + ' (' + run.actor.role + ')' : null],
        ['Commit', ui.hash(run.commit)],
        ['Configuration', ui.hash(run.configHash, 16)],
        ['Data source', data.kind ? data.kind + (data.provenance && data.provenance.generator ? ' · ' + data.provenance.generator : '') : null],
        ['Dataset version', data.datasetVersion ? ui.chip(data.datasetVersion) : null],
        ['Window', data.window ? el('span', { class: 't-num', text: fmt.barTime(data.window.fromTs) + ' → ' + fmt.barTime(data.window.toTs) + ' · ' + data.window.bars + ' bars · ' + data.timeframe }) : null],
        ['Assets', data.symbols ? data.symbols.join(', ') : null],
        result && result.reproducible !== undefined ? ['Reproducible', result.reproducible === null ? ui.badge('NOT VERIFIED', 'warn')
          : (result.reproducible ? ui.badge('YES — a second run produced the same store digest', 'ok') : ui.badge('NO — digests differ', 'danger'))] : null,
        result && result.digest ? ['Store digest', ui.hash(result.digest, 16)] : null
      ])
    });
  }

  function resultTiles(result) {
    var r = result.results;
    var m = result.metrics;
    return el('div', { class: 'stack' }, [
      el('div', { class: 'grid grid-6' }, [
        ui.kpi('Net P&L', ui.signedMoney(r.netPnl), 'after all costs'),
        ui.kpi('Return', ui.value(fmt.pctRaw(r.returnPct, 3), { sign: r.returnPct })),
        ui.kpi('Max drawdown', fmt.pctRaw(r.maxDrawdownPct), m.equityCurveSource === 'MARK_TO_MARKET' ? 'mark-to-market' : 'trade closes only'),
        ui.kpi('Win rate', fmt.pct(r.winRate), null, { naReason: 'no trade closed' }),
        ui.kpi('Profit factor', fmt.num(r.profitFactor, 3), null, { naReason: 'no losing trade in the sample' }),
        ui.kpi('Expectancy', ui.value(fmt.signedMoney(r.expectancy, 4), { sign: r.expectancy }), 'net, per trade', { naReason: 'no trade closed' })
      ]),
      el('div', { class: 'grid grid-6' }, [
        ui.kpi('Trades', fmt.int(r.trades), r.trades < 20 ? 'fewer than 20 — not evidence' : 'closed'),
        ui.kpi('Average win', fmt.money(r.avgWin, 4), null, { naReason: 'no winning trade' }),
        ui.kpi('Average loss', fmt.money(r.avgLoss, 4), null, { naReason: 'no losing trade' }),
        ui.kpi('Max losing streak', fmt.int(r.maxConsecutiveLosses)),
        ui.kpi('Recovery failures', fmt.int(r.recoveryFailures.abandonedAtCap + r.recoveryFailures.abandonedByRisk),
          [fmt.int(r.recoveryFailures.abandonedAtCap) + ' at cap · ' + fmt.int(r.recoveryFailures.abandonedByRisk) + ' by risk']),
        ui.kpi('Largest position', r.largestPositionLots === null ? null : fmt.lots(r.largestPositionLots) + ' lots', 'approved size', { naReason: 'no trade closed' })
      ])
    ]);
  }

  function costsCard(result) {
    var c = result.results.costs;
    if (!c || c.trades === 0) return ui.card({ title: 'Costs', body: ui.state({ tag: 'NO DATA', compact: true, body: 'No trade closed, so no cost was charged.' }) });
    var b = c.byComponent;
    return ui.card({
      title: 'Costs', sub: c.costsFlippedTheSign ? 'COSTS FLIPPED THE SIGN — the result was positive before costs.' : 'Every trade is net of spread, commission, slippage and swap.',
      body: el('div', { class: 'stack-sm' }, [
        ui.kv([
          ['Gross P&L', ui.signedMoney(result.metrics.grossPnl, 4)],
          ['Total costs', el('span', { class: 't-num', text: fmt.money(c.total, 4) })],
          ['Net P&L', ui.signedMoney(result.metrics.netPnl, 4)],
          ['Costs ÷ |gross|', ui.value(fmt.pct(c.costsOverAbsGross))]
        ]),
        ui.bars([
          { label: 'Spread', value: b.spreadMoney, text: fmt.money(b.spreadMoney, 4) },
          { label: 'Commission', value: b.commissionMoney, text: fmt.money(b.commissionMoney, 4) },
          { label: 'Slippage', value: b.slippageMoney, text: fmt.money(b.slippageMoney, 4) },
          { label: 'Swap', value: b.swapMoney, text: fmt.money(b.swapMoney, 4) }
        ])
      ])
    });
  }

  function chartsGrid(c) {
    var eq = c.equity.series;
    return el('div', { class: 'grid grid-2' }, [
      ui.card({ title: 'Equity', sub: 'Mark-to-market, ' + c.equity.points + ' samples' + (eq.length < c.equity.points ? ' (every ' + Math.ceil(c.equity.points / eq.length) + 'th drawn)' : '') + '.',
        body: charts.line({ label: 'Equity curve', series: [{ name: 'Equity', cls: 's2', area: true, points: eq.map(function (p) { return { x: p.ts, y: p.equity }; }) }],
          xFormat: function (x) { return dateOf(x); }, yFormat: function (v) { return '$' + v.toFixed(0); } }) }),
      ui.card({ title: 'Drawdown', sub: 'Percent below the running peak of equity.',
        body: charts.line({ label: 'Drawdown', includeZero: true, series: [{ name: 'Drawdown %', cls: 's-danger', fill: 'f-danger', area: true, areaBase: 0,
          points: eq.map(function (p) { return { x: p.ts, y: -p.drawdownPct }; }) }],
          xFormat: function (x) { return dateOf(x); }, yFormat: function (v) { return v.toFixed(2) + '%'; } }) }),
      ui.card({ title: 'Trade distribution', sub: 'Net P&L per trade, in buckets.',
        body: charts.bars({ label: 'Trade distribution', items: c.tradeDistribution.map(function (b) { return { label: b.from.toFixed(1), value: b.count }; }),
          yFormat: function (v) { return String(Math.round(v)); }, emptyText: 'No trade closed.' }) }),
      ui.card({ title: 'Strategy contribution', sub: 'Net P&L by strategy. Small samples are not evidence.',
        body: ui.bars(c.strategyContribution.map(function (s) {
          return { label: s.strategyId + ' (n=' + s.trades + ')', value: s.netPnl, text: fmt.signedMoney(s.netPnl), kind: s.netPnl >= 0 ? 'pos' : 'neg' };
        }), { emptyText: 'No trade closed.' }) }),
      ui.card({ title: 'Jev bands', sub: 'Verdicts considered per score band; the bar is how many were considered.',
        body: ui.bars(c.jevBands.map(function (b) {
          return { label: b.band === 'BELOW_70' ? 'below 70' : b.band, value: b.considered,
            text: b.considered + ' considered · ' + b.allowed + ' allow · ' + b.trades + ' trades' };
        })) }),
      ui.card({ title: 'Regime distribution', sub: 'Bars classified per regime. Labels carry classification error.',
        body: ui.bars(c.regimeDistribution.map(function (r) { return { label: fmt.words(r.value), value: r.count, text: fmt.int(r.count) }; }), { emptyText: 'No bar was classified.' }) })
    ]);
  }

  function detail(d) {
    var run = d.run;
    var result = d.result;
    var nodes = [
      el('div', { class: 'row-between' }, [
        el('h2', { class: 't-h2' }, ['Run ', el('span', { class: 't-num', text: run.runId })]),
        el('div', { class: 'row-tight' }, [ui.dataLabel(d.dataLabel), ui.status(run.status)])
      ])
    ];
    if (run.status === 'RUNNING') {
      nodes.push(ui.banner('info', 'Running', 'Stage: ' + (run.stage || 'starting') + '. This page updates by itself.'));
      nodes.push(identity(run, null, d.dataLabel));
      return el('div', { class: 'stack', id: 'backtest-detail' }, nodes);
    }
    if (run.status !== 'COMPLETED' || !result) {
      nodes.push(ui.state({ error: true, tag: fmt.words(run.status), title: 'This run did not complete',
        body: run.error ? run.error.code + ': ' + run.error.message : 'No result was recorded.' }));
      nodes.push(identity(run, result, d.dataLabel));
      return el('div', { class: 'stack', id: 'backtest-detail' }, nodes);
    }
    if (d.dataLabel !== 'HISTORICAL') {
      nodes.push(ui.banner('warn', d.dataLabel === 'PAPER' ? 'Paper' : 'Synthetic',
        (d.dataLabel === 'PAPER' ? 'Paper session on a replay of synthetic bars. ' : 'Synthetic data. ') +
        'These figures validate mechanics only. ' +
        (result.metrics.netPnl > 0 ? 'The positive net result is NOT evidence of edge or profitability.' : 'No statement about edge or profitability can be derived from them.')));
    }
    if (result.emergencyStopped) nodes.push(ui.banner('danger', 'Emergency stop', 'The run was emergency-stopped: ' + result.emergencyReason));
    nodes.push(resultTiles(result));
    nodes.push(el('div', { class: 'grid grid-2' }, [identity(run, result, d.dataLabel), costsCard(result)]));
    if (d.charts) nodes.push(chartsGrid(d.charts));
    if (result.health) {
      nodes.push(ui.card({
        title: 'Health checks for this run', sub: result.health.counts.ok + ' ok · ' + result.health.counts.warn + ' warn · ' + result.health.counts.fail + ' fail · ' + result.health.counts.unknown + ' unknown',
        flush: true,
        body: ui.table({ dense: true, columns: [
          { label: 'Check', render: function (c) { return fmt.words(c.check); } },
          { label: 'Status', render: function (c) { return ui.status(c.status); } },
          { label: 'Detail', render: function (c) { return el('span', { class: 't-wrap', text: c.detail }); } }
        ], rows: result.health.checks })
      }));
    }
    if (result.caveats && result.caveats.length) {
      nodes.push(ui.card({ title: 'Caveats', sub: 'Computed from this run by the Analysis Agent.',
        body: el('ul', { class: 'stack-sm' }, result.caveats.map(function (c) { return el('li', { class: 't-wrap', text: '· ' + c }); })) }));
    }
    nodes.push(ui.card({
      title: 'Open this run in', body: el('div', { class: 'row' }, [
        TCC.link('/trades?run=' + run.runId, 'Trades', 'btn btn-secondary'),
        TCC.link('/candidates?run=' + run.runId, 'Candidates', 'btn btn-secondary'),
        TCC.link('/decisions?run=' + run.runId, 'Decisions', 'btn btn-secondary'),
        TCC.link('/analysis?run=' + run.runId, 'Analysis', 'btn btn-secondary'),
        TCC.link('/research?run=' + run.runId, 'Research', 'btn btn-secondary')
      ])
    }));
    nodes.push(ui.card({ title: 'Configuration', sub: 'The exact configuration this run executed under.',
      body: el('pre', { class: 'pre', text: JSON.stringify(result.config, null, 2) }) }));
    return el('div', { class: 'stack', id: 'backtest-detail' }, nodes);
  }

  // ---------------------------------------------------------------------------

  TCC.page('/backtest', {
    title: 'Backtest',
    render: function (ctx) {
      var formHost = el('div');
      var listHost = el('div');
      var detailHost = el('div');
      var selected = ctx.query.get('run');
      var lastList = null;
      var lastDetail = null;

      ctx.root.appendChild(ui.pageHead('Backtest Center',
        'Configure a run, start it, read it. Every result is labelled SYNTHETIC, HISTORICAL or PAPER.'));
      ctx.root.appendChild(formHost);
      ctx.root.appendChild(listHost);
      ctx.root.appendChild(detailHost);

      function open(runId) {
        selected = runId;
        window.history.replaceState({}, '', '/backtest?run=' + encodeURIComponent(runId));
        lastDetail = null;
        loadList(true);
        loadDetail(false).then(function () { detailHost.scrollIntoView({ block: 'start' }); });
      }

      function loadList(silent) {
        return api.get('/api/backtest').then(function (list) {
          if (!ctx.alive()) return;
          var key = JSON.stringify(list.runs) + '|' + selected;
          if (key === lastList) return list;
          lastList = key;
          TCC.replace(listHost, runsTable(list, selected, function (r) { open(r.runId); }));
          return list;
        }).catch(function (e) { if (!silent && ctx.alive()) TCC.replace(listHost, ui.errorState(e, function () { loadList(false); })); });
      }

      function loadDetail(silent) {
        if (!selected) { TCC.clear(detailHost); return Promise.resolve(); }
        if (!silent) TCC.replace(detailHost, ui.skeleton('chart'));
        return api.get('/api/backtest/' + encodeURIComponent(selected)).then(function (d) {
          if (!ctx.alive()) return;
          var key = JSON.stringify([d.run.status, d.run.stage, d.run.finishedAt]);
          if (key === lastDetail) return;
          lastDetail = key;
          TCC.replace(detailHost, detail(d));
        }).catch(function (e) {
          if (!ctx.alive() || (e && e.status === 401)) return;
          TCC.replace(detailHost, ui.errorState(e, function () { loadDetail(false); }));
        });
      }

      ui.load(formHost, function () { return api.get('/api/backtest/options'); }, function (options) {
        return form(options, function (run) { open(run.runId); });
      }, { alive: ctx.alive });
      loadList(false).then(function (list) {
        // With no run named, show the newest completed one.
        if (!selected && list && list.runs.length) { selected = list.runs[0].runId; lastList = null; loadList(true); }
        loadDetail(false);
      });
      ctx.every(1000, function () {
        loadList(true);
        if (selected) loadDetail(true);
      });
    }
  });
})();
