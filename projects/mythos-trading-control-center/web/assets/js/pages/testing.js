/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Testing Center
   projects/mythos-trading-control-center/web/assets/js/pages/testing.js

   Runs the real suites — the Trading Agent's and this project's — and reports
   what the test runner reported.

   NEVER HIDE A FAILURE shapes the page:
     · A run's failing tests are shown FIRST, each with the runner's own
       output, before any total.
     · Skipped is its own column and its own list, with the runner's reason.
       A skipped test is never counted as passed.
     · A file that crashed, timed out or does not exist is a failure, with the
       reason in words.
     · A category that has never been run shows NEVER RUN — not zeros, which
       would read as "nothing failed".

   Every result carries the commit it was run against and when it finished.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;

  function fail(e) {
    TCC.toast('danger', e && e.status === 403 ? 'Refused' : 'Not started', TCC.describeError(e), 15000);
    return null;
  }
  function countCell(n, kind) {
    if (!TCC.isNum(n)) return null;
    return el('span', { class: 't-num' + (n > 0 && kind ? ' ' + kind : ''), text: fmt.int(n) });
  }
  function commitChip(c) { return c ? ui.chip(String(c).slice(0, 12), c) : ui.na('the commit was not known when this ran'); }
  function scopeText(r) {
    if (r.scope === 'all') return 'ALL';
    if (r.scope === 'category') return 'category: ' + r.category;
    return 'one test: ' + (r.target ? r.target.file : '');
  }

  // ---------------------------------------------------------------------------
  // categories
  // ---------------------------------------------------------------------------

  function categories(v, start) {
    var op = api.can('operate');
    var busy = !!v.active;
    return ui.card({
      title: 'Categories', flush: true,
      sub: 'The latest finished result per category, from a run of that category or of everything.',
      body: el('div', { id: 'testing-categories' }, ui.table({
        caption: 'Test categories',
        columns: [
          { label: 'Category', render: function (c) {
            return el('div', null, [
              el('div', { text: c.label }),
              el('div', { class: 't-small t-secondary t-wrap', text: c.description }),
              c.missingFiles.length ? el('div', { class: 'row-tight' }, [ui.badge('MISSING FILE', 'danger'), el('span', { class: 't-small', text: c.missingFiles.join(', ') })]) : null
            ]);
          } },
          { label: 'Tests', num: true, render: function (c) { return fmt.int(c.testCount); } },
          { label: 'Status', render: function (c) { var l = v.latest[c.id]; return l ? ui.status(l.status, l.status === 'NO_TESTS' ? 'NO TESTS RAN' : null) : ui.badge('NEVER RUN', 'neutral'); } },
          { label: 'Passed', num: true, render: function (c) { var l = v.latest[c.id]; return l ? countCell(l.passed) : ui.na('never run'); } },
          { label: 'Failed', num: true, render: function (c) { var l = v.latest[c.id]; return l ? countCell(l.failed, 't-neg') : ui.na('never run'); } },
          { label: 'Skipped', num: true, render: function (c) { var l = v.latest[c.id]; return l ? countCell(l.skipped) : ui.na('never run'); } },
          { label: 'Duration', num: true, render: function (c) { var l = v.latest[c.id]; return l ? fmt.duration(l.durationMs) : ui.na('never run'); } },
          { label: 'Finished', render: function (c) { var l = v.latest[c.id]; return l ? el('span', { class: 't-num', text: fmt.wallShort(l.finishedAt) }) : ui.na('never run'); } },
          { label: 'Commit', render: function (c) { var l = v.latest[c.id]; return l ? commitChip(l.commit) : ui.na('never run'); } },
          { label: 'Run', render: function (c) {
            return ui.button('Run category', 'btn-secondary', function (b) { start({ scope: 'category', category: c.id }, b); },
              { compact: true, disabled: !op || busy, title: busy ? 'A test run is in progress' : 'Run the ' + c.label + ' category' });
          } }
        ],
        rows: v.categories
      }))
    });
  }

  // ---------------------------------------------------------------------------
  // run one test
  // ---------------------------------------------------------------------------

  function oneTest(v, start, pick) {
    var op = api.can('operate');
    var files = {};
    var order = [];
    v.categories.forEach(function (c) {
      if (c.pattern) return;                 // a filtered category lists a subset of a file's tests
      c.files.forEach(function (f) { if (f.exists && !files[f.id]) { files[f.id] = f; order.push(f.id); } });
    });
    order.sort();
    if (!order.length) return null;
    // The choice lives outside the render, so a refresh while a run is in
    // progress does not put the pickers back to their first entry.
    if (!files[pick.file]) { pick.file = order[0]; pick.name = null; }
    var nameSel = ui.select([], null, function (n) { pick.name = n; });
    nameSel.id = 'testing-test-name';
    function fill(id) {
      TCC.replace(nameSel, files[id].tests.map(function (n) { return el('option', { text: n, attrs: { value: n } }); }));
      if (files[id].tests.indexOf(pick.name) === -1) pick.name = files[id].tests[0] || null;
      if (pick.name !== null) nameSel.value = pick.name;
    }
    var fileSel = ui.select(order.map(function (id) { return { value: id, label: files[id].project + ' / ' + files[id].file + ' (' + files[id].tests.length + ')' }; }),
      pick.file, function (id) { pick.file = id; pick.name = null; fill(id); });
    fileSel.id = 'testing-test-file';
    fill(pick.file);
    return ui.card({
      title: 'Run one test',
      sub: 'One named test from one file, by exact name.',
      body: el('div', { class: 'stack-sm' }, [
        el('div', { class: 'grid grid-2' }, [
          ui.field({ label: 'File', control: fileSel }),
          ui.field({ label: 'Test', control: nameSel })
        ]),
        el('div', { class: 'row' }, [
          ui.button('Run test', 'btn-secondary', function (b) { start({ scope: 'test', file: fileSel.value, name: nameSel.value }, b); },
            { disabled: !op || !!v.active }),
          !op ? ui.needsRole('OPERATOR') : null
        ])
      ])
    });
  }

  // ---------------------------------------------------------------------------
  // one run, read in full
  // ---------------------------------------------------------------------------

  function runDetail(run) {
    var t = run.totals;
    var failed = [];
    var skipped = [];
    var outputs = [];
    run.files.forEach(function (f) {
      if (f.problem) failed.push({ file: f, name: '(the file itself)', failure: f.problem });
      if (f.output) outputs.push(f);
      f.tests.forEach(function (x) {
        if (x.status === 'failed') failed.push({ file: f, name: x.name, failure: x.failure, durationMs: x.durationMs });
        if (x.status === 'skipped' || x.status === 'todo') skipped.push({ file: f, name: x.name, reason: x.skipReason, status: x.status });
      });
    });
    var running = run.status === 'RUNNING';
    return ui.card({
      title: 'Run ' + run.runId,
      sub: scopeText(run) + (run.target ? ' — ' + run.target.name : ''),
      body: el('div', { id: 'testing-run', class: 'stack', attrs: { 'data-run': run.runId, 'data-status': run.status } }, [
        el('div', { class: 'row-tight' }, [
          ui.status(run.status), commitChip(run.commit),
          el('span', { class: 't-small t-secondary', text: 'started ' + fmt.wall(run.startedAt) + (run.finishedAt ? ' · finished ' + fmt.wall(run.finishedAt) : '') +
            (run.actor ? ' · by ' + run.actor.id : '') })
        ]),
        run.note ? ui.banner('warn', 'Note', run.note) : null,
        running ? ui.progress(t.filesDone, t.files, 'Files finished') : null,
        el('div', { class: 'grid grid-6' }, [
          ui.kpi('Passed', fmt.int(t.passed)),
          ui.kpi('Failed', el('span', { class: t.failed > 0 ? 't-neg' : null, text: fmt.int(t.failed) })),
          ui.kpi('Skipped', fmt.int(t.skipped), t.skipped > 0 ? 'not counted as passed' : null),
          ui.kpi('Total', fmt.int(t.total)),
          ui.kpi('Files', t.filesDone + ' / ' + t.files),
          ui.kpi('Duration', running ? null : fmt.duration(run.durationMs), null, { naReason: 'the run has not finished' })
        ]),
        failed.length ? el('div', { id: 'testing-failures' }, [
          el('div', { class: 't-label', text: 'Failures — ' + failed.length }),
          el('div', { class: 'stack-sm' }, failed.map(function (x) {
            return el('div', { class: 'stack-sm' }, [
              el('div', { class: 'row-tight' }, [ui.badge('FAILED', 'danger'), ui.chip(x.file.id), el('span', { class: 't-wrap', text: x.name })]),
              el('div', { class: 'pre', text: x.failure || 'The runner reported a failure without output.' })
            ]);
          }).concat(outputs.map(function (f) {
            return el('div', { class: 'stack-sm' }, [
              el('div', { class: 'row-tight' }, [ui.badge('OUTPUT', 'neutral'), ui.chip(f.id), el('span', { class: 't-small t-secondary', text: 'what this file printed while it ran' })]),
              el('div', { class: 'pre', text: f.output })
            ]);
          })))
        ]) : (running ? null : el('div', { id: 'testing-failures' }, ui.state({ tag: 'NO FAILURE', compact: true, body: 'No test and no file failed in this run.' }))),
        skipped.length ? el('div', { id: 'testing-skipped' }, [
          el('div', { class: 't-label', text: 'Skipped — ' + skipped.length + ' (not counted as passed)' }),
          ui.table({
            dense: true, caption: 'Skipped tests',
            columns: [
              { label: 'File', render: function (x) { return ui.chip(x.file.id); } },
              { label: 'Test', render: function (x) { return el('span', { class: 't-wrap', text: x.name }); } },
              { label: 'Reason', render: function (x) { return x.reason ? el('span', { class: 't-small t-wrap', text: x.reason }) : el('span', { class: 't-secondary', text: 'none given' }); } }
            ],
            rows: skipped
          })
        ]) : null,
        el('div', null, [
          el('div', { class: 't-label', text: 'Files' }),
          ui.table({
            dense: true, caption: 'Files in this run',
            empty: ui.state({ tag: 'STARTING', compact: true, body: 'No file has started yet.' }),
            columns: [
              { label: 'File', render: function (f) { return ui.chip(f.id); } },
              { label: 'Project', render: function (f) { return f.project; } },
              { label: 'Status', render: function (f) { return ui.status(f.status); } },
              { label: 'Passed', num: true, render: function (f) { return countCell(f.passed); } },
              { label: 'Failed', num: true, render: function (f) { return countCell(f.failed, 't-neg'); } },
              { label: 'Skipped', num: true, render: function (f) { return countCell(f.skipped); } },
              { label: 'Duration', num: true, render: function (f) { return f.status === 'RUNNING' ? ui.na('still running') : fmt.duration(f.durationMs); } },
              { label: 'Filter', render: function (f) { return f.pattern ? ui.chip(f.pattern) : el('span', { class: 't-secondary', text: 'none' }); } },
              { label: 'Problem', render: function (f) { return f.problem ? el('span', { class: 't-small t-wrap t-neg', text: f.problem }) : el('span', { class: 't-secondary', text: 'none' }); } }
            ],
            rows: run.files
          })
        ])
      ])
    });
  }

  function history(v, selected, select) {
    return ui.card({
      title: 'Run history', flush: true, sub: 'The most recent ' + v.runs.length + ' run(s). Select one to read it.',
      body: el('div', { id: 'testing-history' }, ui.table({
        dense: true, caption: 'Test runs',
        empty: ui.state({ tag: 'NEVER RUN', compact: true, body: 'No test run has been started from this console.' }),
        rowKey: function (r) { return r.runId; }, selected: selected, onRow: function (r) { select(r.runId); },
        columns: [
          { label: 'Run', render: function (r) { return ui.chip(r.runId); } },
          { label: 'Scope', render: function (r) { return scopeText(r); } },
          { label: 'Status', render: function (r) { return ui.status(r.status); } },
          { label: 'Passed', num: true, render: function (r) { return countCell(r.totals.passed); } },
          { label: 'Failed', num: true, render: function (r) { return countCell(r.totals.failed, 't-neg'); } },
          { label: 'Skipped', num: true, render: function (r) { return countCell(r.totals.skipped); } },
          { label: 'Duration', num: true, render: function (r) { return r.durationMs === null ? ui.na('not finished') : fmt.duration(r.durationMs); } },
          { label: 'Started', render: function (r) { return el('span', { class: 't-num', text: fmt.wallShort(r.startedAt) }); } },
          { label: 'Commit', render: function (r) { return commitChip(r.commit); } },
          { label: 'By', render: function (r) { return r.actor ? r.actor.id : null; } }
        ],
        rows: v.runs
      }))
    });
  }

  // ---------------------------------------------------------------------------
  // the page
  // ---------------------------------------------------------------------------

  TCC.page('/testing', {
    title: 'Testing',
    render: function (ctx) {
      var selected = ctx.query.get('run') || null;
      var followActive = !selected;
      var pick = { file: null, name: null };
      var host = el('div', { id: 'testing-body' });
      var actions = el('div', { class: 'page-actions' });
      var last = null;
      var head = ui.pageHead('Testing Center', 'The real suites of the Trading Agent and of this console, run from here and reported as the runner reported them.');
      head.appendChild(actions);
      ctx.root.appendChild(head);
      ctx.root.appendChild(host);

      function select(id) {
        selected = id;
        followActive = false;
        window.history.replaceState({}, '', '/testing' + TCC.qs({ run: id }));
        load(true);
      }
      function start(body, b) {
        return ui.run(b, 'Starting…', function () {
          return api.post('/api/testing/run', body).then(function (res) {
            TCC.toast('ok', 'Started', 'Test run ' + res.result.run.runId + ' started. Audit entry #' + res.audit.seq + '.');
            selected = res.result.run.runId;
            followActive = true;
            return load(true);
          }).catch(fail);
        });
      }
      function fetchAll() {
        return api.get('/api/testing').then(function (v) {
          var id = (followActive && v.active ? v.active.runId : selected) || (v.runs.length ? v.runs[0].runId : null);
          if (!id) return { view: v, run: null, id: null };
          return api.get('/api/testing/runs/' + encodeURIComponent(id)).then(function (run) { return { view: v, run: run, id: id }; })
            .catch(function (e) { if (e && e.status === 404) return { view: v, run: null, id: id, missing: true }; throw e; });
        });
      }
      function paintActions(v) {
        var op = api.can('operate');
        TCC.replace(actions, [
          v.active ? ui.button('Cancel run', 'btn-danger', function (b) {
            ui.run(b, 'Cancelling…', function () {
              return api.post('/api/testing/cancel', {}).then(function () { TCC.toast('warn', 'Cancelled', 'The test run was cancelled.'); return load(true); }).catch(fail);
            });
          }, { disabled: !op }) : ui.button('Run all', 'btn-primary', function (b) { start({ scope: 'all' }, b); }, { disabled: !op }),
          ui.button('Refresh', 'btn-secondary', function () { load(false); }),
          !op ? ui.needsRole('OPERATOR') : null
        ]);
      }
      function load(silent) {
        return ui.load(host, fetchAll, function (d) {
          var v = d.view;
          last = JSON.stringify(d);
          if (d.id) selected = d.id;
          paintActions(v);
          return el('div', { class: 'stack-lg' }, [
            el('div', { class: 'source-line' }, [el('span', { text: 'Commit under test' }), commitChip(v.commit),
              el('span', { text: 'Tests run with a throwaway HOME and cannot write to this console\'s state.' })]),
            v.active ? ui.banner('info', 'Running', el('div', { class: 'stack-sm', id: 'testing-active' }, [
              el('span', { text: 'Run ' + v.active.runId + ' (' + scopeText(v.active) + ') is in progress' + (v.activeProgress.current ? ' — ' + v.activeProgress.current : '') + '.' }),
              ui.progress(v.activeProgress.filesDone, v.activeProgress.files, 'Files finished')
            ])) : null,
            categories(v, start),
            oneTest(v, start, pick),
            d.run ? runDetail(d.run) : (d.missing ? ui.state({ tag: 'NOT FOUND', compact: true, error: true, title: 'No test run ' + d.id, body: 'It may have been pruned: the last 30 runs are kept.' }) : null),
            history(v, selected, select)
          ]);
        }, { silent: silent, alive: ctx.alive });
      }
      load(false);
      ctx.every(2000, function () {
        fetchAll().then(function (d) {
          if (!ctx.alive() || JSON.stringify(d) === last) return;
          // An open picker is not replaced under the operator's hand.
          var a = document.activeElement;
          if (a && a.tagName === 'SELECT' && host.contains(a)) return;
          load(true);
        }).catch(function () { /* the next beat retries */ });
      });
    }
  });
})();
