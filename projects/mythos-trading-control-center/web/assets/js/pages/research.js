/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Research and Champion / Challenger
   projects/mythos-trading-control-center/web/assets/js/pages/research.js

   RESEARCH PROPOSES. NOTHING ON THIS PAGE CHANGES A TRADING RULE.

   The page follows the Research Agent's own order, because the order is the
   discipline:

     observation  → a measurement, with its sample size
     hypothesis   → a claim, with the result that would REFUTE it stated first
     proposal     → an inert configuration override
     experiment   → the override against its baseline: in sample, out of
                    sample, walk-forward, stress — compared by the agent
     challenger   → a registered contender, collecting evidence
     champion     → the approved configuration RECORD

   A comparison is never return alone: expectancy, drawdown, losing streak,
   profit factor, win rate, trade count, costs and recovery are shown side by
   side, and the verdict rests on the out-of-sample columns.

   Promotion changes which configuration is RECORDED as approved. It does not
   change the running configuration — that is a separate owner change in the
   Control Center, with its own audit entry and its own mode consequences.
   Every button here ends in the registry's own gate; the page decides nothing.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;
  var ex = TCC.explore;

  function receipt(res, what) {
    TCC.toast('ok', 'Recorded', what + ' Audit entry #' + res.audit.seq + ' (' + res.audit.hash.slice(0, 12) + ').');
    return res.result;
  }
  function fail(e) {
    TCC.toast('danger', e && e.status === 403 ? 'Refused' : 'Not applied', TCC.describeError(e), 15000);
    return null;
  }

  /** An array element: a scalar as itself, a { value, count } pair as "value ×count". */
  function item(x) {
    if (x === null || typeof x !== 'object') return String(x);
    if (x.value !== undefined && x.count !== undefined) return x.value + ' ×' + x.count;
    return JSON.stringify(x);
  }

  /** { risk: { maxPositionSizeLots: 0.05 } } → ["risk.maxPositionSizeLots = 0.05"] */
  function flatten(obj, prefix, out) {
    var acc = out || [];
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      var p = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, acc);
      else acc.push(p + ' = ' + (Array.isArray(v) ? '[' + v.map(item).join(', ') + ']' : String(v)));
    });
    return acc;
  }
  function overrideChips(o) {
    var parts = flatten(o);
    if (!parts.length) return el('span', { class: 't-secondary', text: 'no change' });
    return el('span', { class: 'chips' }, parts.map(function (p) { return ui.chip(p); }));
  }
  function measurement(m) {
    return el('span', { class: 'chips' }, flatten(m).map(function (p) { return ui.chip(p); }));
  }
  function verdictBadge(v) {
    if (!v) return ui.na('no verdict recorded');
    return ui.badge(fmt.words(v), v === 'APPROVE_AS_CHALLENGER' ? 'ok' : (v === 'INCONCLUSIVE' ? 'warn' : 'danger'));
  }
  function passBadge(passed) { return passed ? ui.badge('PASSED', 'ok') : ui.badge('NOT PASSED', 'danger'); }

  // ---------------------------------------------------------------------------
  // champion
  // ---------------------------------------------------------------------------

  function seedDialog(data, runs, reload) {
    var basis = el('textarea', { class: 'textarea', id: 'seed-basis', attrs: { rows: '3', maxlength: '1000' } });
    var eligible = runs.filter(function (r) { return r.kind === 'BACKTEST' && r.status === 'COMPLETED' && r.configHash === data.registry.runningConfigHash; });
    var runSel = ui.select([{ value: '', label: 'None — record no metrics' }].concat(eligible.map(function (r) {
      return { value: r.runId, label: r.runId + (r.summary && r.summary.headline ? ' · ' + r.summary.headline.trades + ' trades' : '') };
    })), '');
    runSel.id = 'seed-run';
    var msg = el('p', { class: 'msg', text: '' });
    TCC.modal({
      title: 'Seed the first champion',
      sub: 'Records the RUNNING configuration (' + data.registry.runningConfigHash.slice(0, 12) + ') as the approved one.',
      body: el('div', { class: 'stack' }, [
        el('p', { class: 't-wrap', text: 'A seeded champion has not passed the promotion gate — there is no incumbent to compare it with. It is recorded as SEEDED, permanently, so nobody later mistakes it for a promoted one.' }),
        el('div', { class: 'field' }, [el('label', { text: 'Basis — why this configuration is the champion', attrs: { for: 'seed-basis' } }), basis,
          el('span', { class: 'hint', text: 'At least 20 characters. Recorded in the registry and the audit log.' })]),
        ui.field({ label: 'Metrics from a backtest of this exact configuration', control: runSel,
          hint: eligible.length ? 'Only runs produced under the running configuration are listed.' : 'No completed backtest was produced under the running configuration.' }),
        el('div', { class: 'field is-error' }, msg)
      ]),
      actions: [
        { label: 'Cancel', kind: 'btn-secondary', onClick: function (b, h) { h.close(); } },
        { label: 'Seed champion', kind: 'btn-primary', onClick: function (b, h) {
          var text = basis.value.trim();
          if (text.length < 20) { msg.textContent = 'A basis of at least 20 characters is required.'; basis.focus(); return; }
          var body = { basis: text };
          if (runSel.value) body.runId = runSel.value;
          ui.run(b, 'Seeding…', function () {
            return api.post('/api/research/champion/seed', body).then(function (res) { receipt(res, 'Champion seeded.'); h.close(); reload(); }).catch(fail);
          });
        } }
      ]
    });
  }

  function metricsKv(m) {
    if (!m) return ui.na('no metrics were recorded with this record');
    return el('span', { class: 't-num', text: [
      'trades ' + fmt.int(m.trades), 'expectancy ' + (fmt.signedMoney(m.expectancy, 4) || 'n/a'), 'max drawdown ' + (fmt.pctRaw(m.maxDrawdownPct) || 'n/a'),
      'max streak ' + fmt.int(m.maxConsecutiveLosses), 'profit factor ' + (fmt.num(m.profitFactor, 3) || 'n/a'), 'win rate ' + (fmt.pct(m.winRate) || 'n/a'),
      'costs ' + (fmt.money(m.costs) || 'n/a')
    ].join(' · ') });
  }

  function champion(data, runs, reload) {
    var c = data.registry.champion;
    var owner = api.can('own');
    if (!c) {
      return ui.card({
        title: 'Champion',
        sub: 'The configuration recorded as approved.',
        body: el('div', { id: 'research-champion', class: 'stack-sm' }, [
          ui.state({ tag: 'NO CHAMPION', compact: true, title: 'No champion has been recorded',
            body: 'Until one is seeded, a challenger has nothing to be compared against and cannot be promoted.' }),
          el('div', { class: 'row' }, [
            ui.button('Seed champion…', 'btn-primary', function () { seedDialog(data, runs, reload); }, { disabled: !owner }),
            !owner ? ui.needsRole('OWNER') : null
          ])
        ])
      });
    }
    return ui.card({
      title: 'Champion',
      sub: 'The configuration recorded as approved. Recording it does not run it.',
      body: el('div', { id: 'research-champion', class: 'stack-sm' }, [
        el('div', { class: 'row-tight' }, [
          ui.badge('CHAMPION', 'attention'), ui.chip(c.recordId), ui.badge(c.origin, c.origin === 'PROMOTED' ? 'ok' : 'warn'),
          c.isRunningConfig ? ui.badge('IS THE RUNNING CONFIGURATION', 'ok') : ui.badge('NOT THE RUNNING CONFIGURATION', 'warn')
        ]),
        !c.isRunningConfig ? el('p', { class: 't-small t-wrap', text: 'The platform is running ' + data.registry.runningConfigHash.slice(0, 12) +
          '. Putting the champion\'s settings into effect is a separate configuration change by the OWNER in the Control Center.' }) : null,
        ui.kv([
          ['Configuration', ui.hash(c.configHash, 16)],
          ['Basis', el('span', { class: 't-wrap', text: c.basis || 'none recorded' })],
          ['Recorded', el('span', { class: 't-num', text: fmt.wall(c.promotedAt) + (c.promotedBy ? ' by ' + c.promotedBy.id : '') })],
          ['Metrics', metricsKv(c.metrics)],
          ['Evidence carried', el('span', { class: 't-num', text: c.evidence.length ? c.evidence.length + ' item(s) from its promotion' : 'none — it was seeded, not promoted' })],
          ['Previous champion', c.previousChampionConfigHash ? ui.hash(c.previousChampionConfigHash, 16) : el('span', { class: 't-secondary', text: 'none' })]
        ]),
        c.previousChampionConfigHash ? el('div', { class: 'row' }, [
          ui.button('Roll back…', 'btn-danger', function (b) {
            TCC.confirm({ title: 'Roll the champion back', message: 'Restores the previous champion record (' + c.previousChampionConfigHash.slice(0, 12) +
              '). The running configuration is not changed.', reason: true, typed: 'ROLLBACK', confirmLabel: 'Roll back', danger: true }).then(function (a) {
              if (!a) return;
              ui.run(b, 'Rolling back…', function () {
                return api.post('/api/research/champion/rollback', { reason: a.reason, confirm: 'ROLLBACK' })
                  .then(function (res) { receipt(res, 'Champion rolled back.'); reload(); }).catch(fail);
              });
            });
          }, { disabled: !owner }),
          !owner ? ui.needsRole('OWNER') : null
        ]) : null
      ])
    });
  }

  // ---------------------------------------------------------------------------
  // the Research Agent's report
  // ---------------------------------------------------------------------------

  function report(data, run, busy, reload, select) {
    var ctx = data.context;
    if (ctx.available === false) {
      return el('div', { id: 'research-report' }, ui.noData(ctx.reason, [TCC.link('/backtest', 'Open the Backtest Center', 'btn btn-secondary')]));
    }
    if (!data.report) {
      return el('div', { id: 'research-report', class: 'stack' }, [ui.sourceLine(ctx), ui.noData(data.reportReason || 'No Research Agent report exists for this source.')]);
    }
    var r = data.report;
    var op = api.can('operate');
    var stored = ctx.source !== 'PAPER_SESSION';
    var proposalsByHyp = {};
    r.proposals.forEach(function (p) { proposalsByHyp[p.hypothesisId] = p; });
    var registered = {};
    data.registry.challengers.forEach(function (c) { if (c.state === 'CHALLENGER') registered[c.proposalId] = c.recordId; });

    var hyps = r.hypotheses.map(function (h) {
      var p = proposalsByHyp[h.hypothesisId];
      return el('article', { class: 'card', attrs: { 'data-hypothesis': h.hypothesisId } }, [
        el('div', { class: 'stack-sm' }, [
          el('div', { class: 'row-tight' }, [ui.chip(h.hypothesisId), ui.badge(fmt.words(h.state), 'neutral'), ui.badge('PROPOSAL ONLY', 'info'),
            el('span', { class: 't-small t-secondary', text: 'from ' + fmt.words(h.observation.kind) + ' · ' + h.observation.subject + ' · n=' + h.observation.sampleSize })]),
          el('p', { class: 't-wrap', text: h.statement }),
          ui.kv([
            ['Proposed change', overrideChips(h.proposedChange)],
            ['Falsified if', el('span', { class: 't-wrap', text: h.falsification })],
            p ? ['Proposal', el('span', { class: 'row-tight' }, [ui.chip(p.proposalId), el('span', { class: 't-small t-secondary', text: 'inert until tested' })])] : null,
            p ? ['Evidence it needs', ui.codes(p.requiredEvidence)] : null
          ]),
          p ? el('div', { class: 'row' }, [
            ui.button('Run experiment', 'btn-primary', function (b) {
              ui.run(b, 'Starting…', function () {
                return api.post('/api/research/experiments', { runId: ctx.runId, proposalId: p.proposalId }).then(function (res) {
                  var out = receipt(res, 'Experiment ' + res.result.run.runId + ' started.');
                  select(out.run.runId);
                  reload();
                }).catch(fail);
              });
            }, { disabled: !op || !stored || busy, title: busy ? 'Another job is running' : null }),
            registered[p.proposalId]
              ? el('span', { class: 't-small t-secondary', text: 'Registered as challenger ' + registered[p.proposalId] + '.' })
              : ui.button('Register as challenger', 'btn-secondary', function (b) {
                ui.run(b, 'Registering…', function () {
                  return api.post('/api/research/challengers', { runId: ctx.runId, proposalId: p.proposalId }).then(function (res) {
                    receipt(res, 'Challenger ' + res.result.recordId + ' registered.'); reload();
                  }).catch(fail);
                });
              }, { disabled: !op || !stored }),
            !op ? ui.needsRole('OPERATOR') : null,
            !stored ? el('span', { class: 't-small t-secondary', text: 'A live session\'s proposals become testable once the session is archived.' }) : null
          ]) : null
        ])
      ]);
    });

    return el('div', { id: 'research-report', class: 'stack' }, [
      ui.sourceLine(ctx),
      ui.card({
        title: 'Observations', flush: true,
        sub: 'Facts only: each is a measurement with its sample size. ' + r.actionable + ' of ' + r.observations.length + ' cleared the sample threshold.',
        body: ui.table({
          dense: true, caption: 'Observations',
          empty: ui.state({ tag: 'NONE', compact: true, body: 'The Research Agent recorded no observation for this source.' }),
          columns: [
            { label: 'Observation', render: function (o) { return fmt.words(o.kind); } },
            { label: 'Subject', render: function (o) { return o.subject === null || o.subject === undefined ? null : String(o.subject); } },
            { label: 'Sample', num: true, render: function (o) { return o.sampleSize === undefined || o.sampleSize === null ? null : 'n=' + o.sampleSize; } },
            { label: 'Actionable', render: function (o) { return o.actionable ? ui.badge('yes', 'ok') : ui.badge('NO — insufficient', 'warn'); } },
            { label: 'Measurement', render: function (o) { return o.measurement ? measurement(o.measurement) : null; } }
          ],
          rows: r.observations
        })
      }),
      el('div', { class: 'stack' }, [
        el('h2', { class: 't-h3', text: 'Hypotheses and proposals' }),
        el('p', { class: 't-small t-secondary t-wrap', text: r.nextStep }),
        hyps.length ? el('div', { class: 'stack', id: 'research-hypotheses' }, hyps)
          : ui.state({ tag: 'NONE', compact: true, title: 'No hypothesis', body: 'No actionable observation cleared the sample threshold, so the agent proposed nothing.' })
      ])
    ]);
  }

  // ---------------------------------------------------------------------------
  // experiments
  // ---------------------------------------------------------------------------

  var METRICS = [
    ['Expectancy', 'expectancy', function (v) { return fmt.signedMoney(v, 4); }, 1],
    ['Max drawdown', 'maxDrawdownPct', function (v) { return fmt.pctRaw(v, 3); }, -1],
    ['Max losing streak', 'maxConsecutiveLosses', fmt.int, -1],
    ['Profit factor', 'profitFactor', function (v) { return fmt.num(v, 3); }, 1],
    ['Win rate', 'winRate', fmt.pct, 1],
    ['Trade count', 'tradeCount', fmt.int, 0],
    ['Costs', 'totalCosts', function (v) { return fmt.money(v, 4); }, -1],
    ['Net P&L', 'netPnl', function (v) { return fmt.signedMoney(v, 4); }, 1],
    ['Recovery — highest level', 'maxRecoveryLevel', fmt.int, 0]
  ];

  function comparisonTable(res) {
    function cell(side, seg, m) { return m[2](res[side][seg][m[1]]); }
    function delta(m) {
      var b = res.baseline.outOfSample[m[1]];
      var v = res.variant.outOfSample[m[1]];
      if (!TCC.isNum(b) || !TCC.isNum(v)) return ui.na('one side has no value');
      var d = v - b;
      var word = d === 0 || m[3] === 0 ? '' : ((d > 0) === (m[3] > 0) ? ' better' : ' worse');
      return el('span', { class: 't-num' + (word === ' better' ? ' t-pos' : (word === ' worse' ? ' t-neg' : '')),
        text: (d > 0 ? '+' : (d < 0 ? '−' : '')) + Math.abs(d).toFixed(Math.abs(d) < 10 && d % 1 !== 0 ? 4 : 0) + word });
    }
    return ui.table({
      dense: true, caption: 'Baseline against variant',
      columns: [
        { label: 'Metric', render: function (m) { return m[0]; } },
        { label: 'Baseline in-sample', num: true, render: function (m) { return cell('baseline', 'inSample', m); } },
        { label: 'Variant in-sample', num: true, render: function (m) { return cell('variant', 'inSample', m); } },
        { label: 'Baseline out-of-sample', num: true, render: function (m) { return cell('baseline', 'outOfSample', m); } },
        { label: 'Variant out-of-sample', num: true, render: function (m) { return cell('variant', 'outOfSample', m); } },
        { label: 'Out-of-sample change', num: true, render: delta }
      ],
      rows: METRICS
    });
  }

  function walkForward(res) {
    function row(side) {
      var wf = res[side].walkForward;
      if (!wf) return [side, null];
      return [side, wf];
    }
    var rows = [row('baseline'), row('variant')];
    return ui.table({
      dense: true, caption: 'Walk-forward',
      columns: [
        { label: 'Side', render: function (r) { return r[0] === 'baseline' ? 'Baseline' : 'Variant'; } },
        { label: 'Folds', num: true, render: function (r) { return r[1] ? fmt.int(r[1].folds) : ui.na(res[r[0]].walkForwardError || 'walk-forward did not run'); } },
        { label: 'Profitable out of sample', num: true, render: function (r) { return r[1] ? r[1].outOfSample.profitableFolds + ' of ' + r[1].outOfSample.foldsWithTrades : null; } },
        { label: 'Hit rate', num: true, render: function (r) { return r[1] ? fmt.pct(r[1].outOfSampleHitRate, 0) : null; } },
        { label: 'OOS mean expectancy', num: true, render: function (r) { return r[1] ? fmt.signedMoney(r[1].outOfSample.meanExpectancy, 4) : null; } },
        { label: 'OOS trades', num: true, render: function (r) { return r[1] ? fmt.int(r[1].outOfSample.totalTrades) : null; } },
        { label: 'Worst OOS streak', num: true, render: function (r) { return r[1] ? fmt.int(r[1].outOfSample.worstMaxConsecutiveLosses) : null; } },
        { label: 'Degradation', render: function (r) {
          if (!r[1]) return null;
          return r[1].degradation === null ? el('span', { class: 't-small t-secondary t-wrap', text: 'n/a — ' + (r[1].degradationNote || 'not computable') }) : el('span', { class: 't-num', text: fmt.num(r[1].degradation, 3) });
        } }
      ],
      rows: rows
    });
  }

  function failuresText(f) {
    if (!f || !f.length) return el('span', { class: 't-secondary', text: 'none' });
    return el('span', { class: 't-small t-wrap', text: f.map(function (x) {
      if (typeof x === 'string') return x;
      if (x && x.limit) return x.limit + ': observed ' + x.observed + ', allowed ' + x.allowed;
      return JSON.stringify(x);
    }).join('; ') });
  }

  function stress(res) {
    var s = res.stress;
    return el('div', { class: 'stack-sm' }, [
      el('div', { class: 'row-tight' }, [
        s.survived ? ui.badge('SURVIVED', 'ok') : ui.badge('DID NOT SURVIVE', 'danger'),
        el('span', { class: 't-num', text: s.scenariosRun + ' run · ' + s.scenariosFailed + ' failed · ' + s.scenariosSkipped + ' skipped' })
      ]),
      s.coverageWarning ? el('p', { class: 't-small t-wrap', text: s.coverageWarning }) : null,
      ui.table({
        dense: true, caption: 'Stress scenarios',
        columns: [
          { label: 'Scenario', render: function (x) { return fmt.words(x.scenario); } },
          { label: 'Result', render: function (x) { return x.skipped ? ui.badge('SKIPPED', 'warn') : (x.passed ? ui.badge('PASSED', 'ok') : ui.badge('FAILED', 'danger')); } },
          { label: 'Trades', num: true, render: function (x) { return x.metrics ? fmt.int(x.metrics.trades) : null; } },
          { label: 'Expectancy', num: true, render: function (x) { return x.metrics ? fmt.signedMoney(x.metrics.expectancy, 4) : null; } },
          { label: 'Max drawdown', num: true, render: function (x) { return x.metrics ? fmt.pctRaw(x.metrics.maxDrawdownPct, 3) : null; } },
          { label: 'Max streak', num: true, render: function (x) { return x.metrics ? fmt.int(x.metrics.maxConsecutiveLosses) : null; } },
          { label: 'Limits breached', render: function (x) { return failuresText(x.failures); } }
        ],
        rows: s.scenarios
      })
    ]);
  }

  function experimentDetail(item) {
    var run = item.run;
    var res = item.result;
    if (run.status === 'RUNNING') {
      return ui.card({ title: 'Experiment ' + run.runId, body: el('div', { id: 'experiment-detail' },
        ui.state({ tag: 'RUNNING', compact: true, title: 'The experiment is running', body: 'Stage: ' + fmt.words(run.stage || 'RUNNING') + ('') + '. This view updates by itself.' })) });
    }
    if (!res) {
      return ui.card({ title: 'Experiment ' + run.runId, body: el('div', { id: 'experiment-detail' },
        ui.state({ tag: run.status, compact: true, error: true, title: 'This experiment produced no result',
          body: run.error ? run.error.message : 'No result is stored for it.' })) });
    }
    var c = res.comparison;
    return ui.card({
      title: 'Experiment ' + run.runId,
      sub: res.note,
      body: el('div', { id: 'experiment-detail', class: 'stack' }, [
        el('div', { class: 'row-tight' }, [verdictBadge(c.verdict), ui.dataLabel(res.data.label), ui.chip(res.proposal.proposalId), ui.chip(res.proposal.hypothesisId),
          el('span', { class: 't-small t-secondary', text: res.data.symbols.join(', ') + ' · ' + res.data.timeframe + ' · ' + fmt.int(res.data.window.bars) + ' bars' })]),
        el('p', { class: 't-wrap', text: c.note }),
        ui.kv([
          ['Change tested', overrideChips(res.proposal.override)],
          ['Baseline configuration', ui.hash(res.baselineConfigHash, 16)],
          ['Variant configuration', ui.hash(res.variantConfigHash, 16)],
          ['In-sample segment', el('span', { class: 't-num', text: fmt.barTime(res.segments.inSample.fromTs) + ' → ' + fmt.barTime(res.segments.inSample.toTs) })],
          ['Out-of-sample segment', el('span', { class: 't-num', text: fmt.barTime(res.segments.outOfSample.fromTs) + ' → ' + fmt.barTime(res.segments.outOfSample.toTs) })],
          res.proposal.hypothesis ? ['Falsification criterion', el('span', { class: 't-wrap', text: res.proposal.hypothesis.falsification })] : null,
          c.falsified ? ['Outcome', el('span', { class: 'row-tight' }, [ui.badge('FALSIFIED', 'danger'), el('span', { class: 't-small t-wrap', text: 'The refuting result occurred.' })])] : null
        ]),
        el('div', null, [
          el('div', { class: 't-label', text: 'Comparison — never return alone; the verdict rests on the out-of-sample columns' }),
          comparisonTable(res)
        ]),
        el('div', null, [
          el('div', { class: 't-label', text: 'Why it was not approved' }),
          c.blockers.length ? ui.table({
            dense: true, caption: 'Blockers',
            columns: [
              { label: 'Blocker', render: function (b) { return ui.chip(b.code); } },
              { label: 'Detail', render: function (b) { return el('span', { class: 't-small t-wrap', text: b.detail }); } }
            ],
            rows: c.blockers
          }) : ui.state({ tag: 'NO BLOCKER', compact: true, body: 'The Research Agent raised no blocker. That approves it as a challenger only.' })
        ]),
        el('div', null, [el('div', { class: 't-label', text: 'Walk-forward' }), walkForward(res)]),
        el('div', null, [el('div', { class: 't-label', text: 'Stress suite — run against the variant' }), stress(res)])
      ])
    });
  }

  function experiments(data, selected, select) {
    var list = data.experiments;
    var chosen = list.filter(function (x) { return x.run.runId === selected; })[0] || null;
    return el('div', { class: 'stack', id: 'research-experiments' }, [
      ui.card({
        title: 'Experiments', flush: true,
        sub: 'A proposal against its baseline: in sample, out of sample, walk-forward and stress. Select one to read it.',
        body: ui.table({
          dense: true, caption: 'Experiments',
          empty: ui.state({ tag: 'NONE YET', compact: true, body: 'No experiment has been run. Run one from a proposal above.' }),
          rowKey: function (x) { return x.run.runId; }, selected: selected,
          onRow: function (x) { select(x.run.runId); },
          columns: [
            { label: 'Experiment', render: function (x) { return ui.chip(x.run.runId); } },
            { label: 'Proposal', render: function (x) { return x.run.request ? x.run.request.proposalId : null; } },
            { label: 'Change', render: function (x) { return x.run.request ? overrideChips(x.run.request.override) : null; } },
            { label: 'Status', render: function (x) { return ui.status(x.run.status); } },
            { label: 'Verdict', render: function (x) { return x.run.summary ? verdictBadge(x.run.summary.verdict) : ui.na('no verdict: the run is ' + x.run.status); } },
            { label: 'Blockers', num: true, render: function (x) { return x.run.summary ? String(x.run.summary.blockers.length) : null; } },
            { label: 'Finished', render: function (x) { return x.run.finishedAt ? el('span', { class: 't-num', text: fmt.wallShort(x.run.finishedAt) }) : null; } }
          ],
          rows: list
        })
      }),
      chosen ? experimentDetail(chosen) : null
    ]);
  }

  // ---------------------------------------------------------------------------
  // challengers and the gate
  // ---------------------------------------------------------------------------

  function challenger(c, data, runs, reload) {
    var op = api.can('operate');
    var owner = api.can('own');
    var active = c.state === 'CHALLENGER';
    var required = data.registry.requiredEvidence;
    var rows = c.evidence.map(function (e) { return { kind: e.kind, e: e }; });
    required.forEach(function (k) { if (!c.evidence.some(function (e) { return e.kind === k; })) rows.push({ kind: k, e: null }); });
    rows.sort(function (a, b) { return required.indexOf(a.kind) - required.indexOf(b.kind); });

    var matching = data.experiments.filter(function (x) { return x.run.status === 'COMPLETED' && x.result && x.result.variantConfigHash === c.configHash; });
    var expSel = ui.select(matching.length ? matching.map(function (x) { return { value: x.run.runId, label: x.run.runId + ' · ' + fmt.words(x.result.comparison.verdict) }; })
      : [{ value: '', label: 'No experiment tested this configuration' }], matching.length ? matching[0].run.runId : '', null, { compact: true, disabled: !matching.length });
    expSel.setAttribute('aria-label', 'Experiment to take evidence from');
    var demos = runs.filter(function (r) { return r.kind === 'DEMO' && r.status === 'COMPLETED'; });
    var demoSel = ui.select(demos.length ? demos.map(function (r) { return { value: r.runId, label: r.runId }; })
      : [{ value: '', label: 'No demo session is archived' }], demos.length ? demos[0].runId : '', null, { compact: true, disabled: !demos.length });
    demoSel.setAttribute('aria-label', 'Demo session to take evidence from');

    function attach(body, b) {
      ui.run(b, 'Attaching…', function () {
        return api.post('/api/research/challengers/' + c.recordId + '/evidence', body).then(function (res) {
          var passed = res.result.attached.filter(function (x) { return x.passed; }).length;
          receipt(res, res.result.attached.length + ' evidence item(s) attached, ' + passed + ' passed.'); reload();
        }).catch(fail);
      });
    }

    var gate = c.gate;
    return el('article', { class: 'card', attrs: { 'data-challenger': c.recordId } }, [
      el('div', { class: 'stack-sm' }, [
        el('div', { class: 'row-tight' }, [ui.status(c.state), ui.chip(c.recordId), ui.hash(c.configHash, 16),
          gate ? (gate.promotable ? ui.badge('PROMOTABLE', 'ok') : ui.badge('NOT PROMOTABLE', 'warn')) : null]),
        ui.kv([
          ['Change', overrideChips(c.override)],
          ['From', el('span', { class: 't-num', text: (c.proposalId || 'no proposal') + ' · ' + (c.hypothesisId || 'no hypothesis') })],
          ['Compared against', ui.hash(c.baselineConfigHash, 16)],
          ['Registered', el('span', { class: 't-num', text: fmt.wall(c.createdAt) + (c.createdBy ? ' by ' + c.createdBy.id : '') })],
          c.rejectedReason ? ['Rejected because', el('span', { class: 't-wrap', text: c.rejectedReason })] : null
        ]),
        ui.table({
          dense: true, caption: 'Evidence for ' + c.recordId,
          columns: [
            { label: 'Evidence', render: function (r) { return fmt.words(r.kind); } },
            { label: 'State', render: function (r) { return r.e ? passBadge(r.e.passed) : ui.badge('MISSING', 'neutral'); } },
            { label: 'Segment', render: function (r) { return r.e ? el('span', { class: 't-small t-num', text: r.e.segment.split(':')[0] + (r.e.source ? ' · ' + r.e.source.run : '') }) : null; } },
            { label: 'Data', render: function (r) { return r.e && r.e.source ? ui.dataLabel(r.e.source.dataLabel) : null; } },
            { label: 'Rule it was judged by', render: function (r) { return r.e && r.e.detail && r.e.detail.rule ? el('span', { class: 't-small t-wrap', text: r.e.detail.rule }) : null; } }
          ],
          rows: rows
        }),
        gate && gate.blockers.length ? el('div', null, [
          el('div', { class: 't-label', text: 'What the promotion gate refuses' }),
          ui.table({
            dense: true, caption: 'Gate blockers for ' + c.recordId,
            columns: [
              { label: 'Blocker', render: function (b) { return ui.chip(b.code); } },
              { label: 'Detail', render: function (b) { return el('span', { class: 't-small t-wrap', text: b.detail }); } }
            ],
            rows: gate.blockers
          })
        ]) : null,
        gate && gate.unsatisfiableInCurrentMode.length ? el('p', { class: 't-small t-wrap', text: fmt.words(gate.unsatisfiableInCurrentMode.join(', ')) +
          ' cannot be produced while the platform is in BACKTEST: it comes from a two-arm DEMO session, which needs PAPER and therefore the owner\'s approval.' }) : null,
        active ? el('div', { class: 'grid grid-2' }, [
          el('div', { class: 'stack-sm' }, [expSel,
            el('div', null, ui.button('Attach experiment evidence', 'btn-secondary', function (b) { attach({ experimentRunId: expSel.value }, b); }, { disabled: !op || !matching.length }))]),
          el('div', { class: 'stack-sm' }, [demoSel,
            el('div', null, ui.button('Attach demo evidence', 'btn-secondary', function (b) { attach({ demoRunId: demoSel.value }, b); }, { disabled: !op || !demos.length }))])
        ]) : null,
        active ? el('div', { class: 'row' }, [
          ui.button('Promote…', 'btn-primary', function (b) {
            TCC.confirm({
              title: 'Promote ' + c.recordId + ' to champion',
              message: 'The champion RECORD changes to ' + c.configHash.slice(0, 12) + '. The running configuration does not change; applying it is a separate change in the Control Center. The registry\'s gate decides — this dialog cannot overrule it.',
              reason: true, reasonMin: 20, reasonLabel: 'Basis', typed: 'PROMOTE', confirmLabel: 'Promote'
            }).then(function (a) {
              if (!a) return;
              ui.run(b, 'Promoting…', function () {
                return api.post('/api/research/challengers/' + c.recordId + '/promote', { basis: a.reason, confirm: 'PROMOTE' })
                  .then(function (res) { receipt(res, 'Champion record changed. ' + res.result.note); reload(); }).catch(fail);
              });
            });
          }, { disabled: !owner }),
          ui.button('Reject…', 'btn-danger', function (b) {
            TCC.confirm({ title: 'Reject ' + c.recordId, message: 'A rejected challenger keeps its record and its evidence, and can no longer be promoted.', reason: true, confirmLabel: 'Reject', danger: true })
              .then(function (a) {
                if (!a) return;
                ui.run(b, 'Rejecting…', function () {
                  return api.post('/api/research/challengers/' + c.recordId + '/reject', { reason: a.reason })
                    .then(function (res) { receipt(res, 'Challenger rejected.'); reload(); }).catch(fail);
                });
              });
          }, { disabled: !op }),
          !owner ? el('span', { class: 't-small t-secondary', text: 'Promotion requires the OWNER role' + (op ? '.' : '; attaching evidence and rejecting require OPERATOR.') }) : null
        ]) : null
      ])
    ]);
  }

  function challengers(data, runs, reload) {
    var list = data.registry.challengers.slice().reverse();
    var rules = data.registry.rules;
    return el('div', { class: 'stack', id: 'research-challengers' }, [
      el('h2', { class: 't-h3', text: 'Challengers' }),
      el('p', { class: 't-small t-secondary t-wrap', text: 'Promotion needs every one of ' + data.registry.requiredEvidence.length + ' kinds of evidence, all passing, from at least ' +
        rules.minDistinctSegments + ' distinct data segments, with at least ' + rules.minOutOfSampleTrades + ' out-of-sample trades — and it is refused to an agent whatever the evidence says.' }),
      list.length ? el('div', { class: 'stack' }, list.map(function (c) { return challenger(c, data, runs, reload); }))
        : ui.state({ tag: 'NONE', compact: true, title: 'No challenger is registered', body: 'A challenger is registered from a proposal the Research Agent produced. It cannot be typed in.' })
    ]);
  }

  function history(data) {
    return ui.card({
      title: 'Registry history', flush: true, sub: 'Every change the registry accepted, newest first. It is replayed from a journal at start-up.',
      body: el('div', { id: 'research-history' }, [
        data.registry.replayProblems.length ? ui.banner('danger', 'Journal', data.registry.replayProblems.length + ' journal entr(ies) could not be replayed: ' +
          data.registry.replayProblems.map(function (p) { return 'line ' + p.line + ' ' + p.op + ' — ' + p.message; }).join('; ')) : null,
        ui.table({
          dense: true, caption: 'Registry history',
          empty: ui.state({ tag: 'EMPTY', compact: true, body: 'Nothing has been recorded.' }),
          columns: [
            { label: 'When', render: function (h) { return el('span', { class: 't-num', text: fmt.wall(h.at) }); } },
            { label: 'Event', render: function (h) { return fmt.words(h.event); } },
            { label: 'Record', render: function (h) { return h.recordId ? ui.chip(h.recordId) : null; } },
            { label: 'Detail', render: function (h) {
              var parts = [];
              if (h.kind) parts.push(fmt.words(h.kind) + (h.passed === true ? ' passed' : (h.passed === false ? ' not passed' : '')));
              if (h.configHash) parts.push('config ' + String(h.configHash).slice(0, 12));
              if (h.principal) parts.push('by ' + h.principal);
              if (h.reason) parts.push(h.reason);
              return parts.length ? el('span', { class: 't-small t-wrap', text: parts.join(' · ') }) : null;
            } }
          ],
          rows: data.registry.history
        })
      ])
    });
  }

  // ---------------------------------------------------------------------------
  // the page
  // ---------------------------------------------------------------------------

  TCC.page('/research', {
    title: 'Research',
    render: function (ctx) {
      var run = ctx.query.get('run') || null;
      var selected = ctx.query.get('exp') || null;
      var host = el('div', { id: 'research-body' });
      var last = null;
      ctx.root.appendChild(ui.pageHead('Research', 'Observations, hypotheses, experiments, and the champion / challenger record.',
        [ex.runPicker(run, function (v) { run = v; sync(); load(false); })]));
      ctx.root.appendChild(ui.banner('info', 'Authority', 'Research proposes only. Nothing on this page changes a trading rule, a limit, a size or the mode. ' +
        'A promotion changes which configuration is RECORDED as approved; applying one is a separate OWNER change in the Control Center.'));
      ctx.root.appendChild(host);

      function sync() { ex.setQuery('/research', { run: run, exp: selected }); }
      function select(id) { selected = id; sync(); load(true); }
      function fetchAll() {
        return Promise.all([api.get('/api/research', { run: run }), api.get('/api/backtest')]).then(function (r) { return { data: r[0], runs: r[1].runs, active: r[1].active }; });
      }
      function key(d) { return JSON.stringify([d.data, d.active, d.runs.length]); }
      function load(silent) {
        return ui.load(host, fetchAll, function (d) {
          last = key(d);
          var reload = function () { TCC.refreshStatus(); return load(true); };
          if (!selected && d.data.experiments.length) selected = d.data.experiments[0].run.runId;
          return el('div', { class: 'stack-lg' }, [
            champion(d.data, d.runs, reload),
            report(d.data, run, !!d.active, reload, select),
            experiments(d.data, selected, select),
            challengers(d.data, d.runs, reload),
            history(d.data)
          ]);
        }, { silent: silent, alive: ctx.alive });
      }
      load(false);
      ctx.every(3000, function () {
        fetchAll().then(function (d) { if (ctx.alive() && key(d) !== last && !document.querySelector('.scrim')) load(true); })
          .catch(function () { /* the next beat retries */ });
      });
    }
  });
})();
