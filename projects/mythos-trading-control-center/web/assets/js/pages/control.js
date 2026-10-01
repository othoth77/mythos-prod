/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — Control Center
   projects/mythos-trading-control-center/web/assets/js/pages/control.js

   Where the platform's configuration and execution mode are changed.

   EVERY CHANGE GOES THROUGH THE SAME FOUR STEPS, and the interface makes each
   one visible rather than implicit:

     1. PREVIEW   the server computes the exact diff, which protections the
                  change loosens, and whether it would return the platform to
                  BACKTEST. Nothing is applied.
     2. CONFIRM   the operator sees old → new for every key, writes a reason,
                  and — when a protection is loosened — types CONFIRM.
     3. APPLY     the Trading Agent's own schema validates the result; a
                  refusal is shown with every problem it found.
     4. RECEIPT   the audit sequence number and hash of the recorded change.

   WHAT THIS PAGE CANNOT DO. It offers BACKTEST and PAPER. DEMO is a two-arm
   PAPER session and is started from the Paper page. LIVE is described, in
   words, as not available — it is not a disabled control, because there is
   nothing behind it to enable. No field here sets a position size: the risk
   limits bound what the Risk Engine may approve, and the Risk Engine decides.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return o === undefined || o === null ? undefined : o[k]; }, obj);
  }

  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = value;
  }

  function show(v) {
    if (v === null || v === undefined) return 'not set';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /**
   * The four-step change. `changes` is a partial configuration object.
   * Resolves to the server's result, or null when cancelled or refused.
   */
  function applyChange(changes, cfg, title) {
    return api.post('/api/config/preview', { changes: changes }).then(function (res) {
      var pre = res.result;
      if (!pre.diff.length) { TCC.toast('warn', 'No change', 'The values are the ones already in effect.'); return null; }
      var details = el('div', { class: 'stack-sm' }, [
        ui.table({
          dense: true,
          caption: 'The change, key by key',
          columns: [
            { label: 'Key', render: function (d) { return el('code', { text: d.path }); } },
            { label: 'Current', render: function (d) { return el('span', { class: 't-num t-wrap', text: show(d.oldValue) }); } },
            { label: 'New', render: function (d) { return el('span', { class: 't-num t-wrap', text: show(d.newValue) }); } }
          ],
          rows: pre.diff
        }),
        pre.loosened.length ? ui.banner('warn', 'Loosens', 'This change loosens ' + pre.loosened.length + ' protection(s): ' +
          pre.loosened.map(function (l) { return l.path; }).join(', ') + '. It needs an explicit confirmation.') : null,
        pre.wouldResetMode ? ui.banner('warn', 'Mode', 'The platform is in PAPER under an approval bound to the current configuration. ' +
          'Applying this returns it to BACKTEST; PAPER will need a new owner approval.') : null,
        el('p', { class: 't-small t-secondary' }, ['Fingerprint ', ui.hash(pre.fingerprintBefore), ' → ', ui.hash(pre.fingerprintAfter)])
      ]);
      return TCC.confirm({
        title: title, message: 'Review the change. It is validated by the Trading Agent and recorded in the audit log.',
        details: details, reason: true, typed: pre.loosened.length ? 'CONFIRM' : null,
        confirmLabel: 'Apply change', danger: pre.loosened.length > 0
      }).then(function (answer) {
        if (!answer) return null;
        var body = { changes: changes, reason: answer.reason, expectedFingerprint: cfg.fingerprint };
        if (pre.loosened.length) body.confirm = 'CONFIRM';
        return api.patch('/api/config', body).then(receipt);
      });
    });
  }

  /** Step 4: say what was recorded. */
  function receipt(res) {
    var r = res.result;
    TCC.toast('ok', 'Recorded', 'Applied. Audit entry #' + res.audit.seq + ' (' + res.audit.hash.slice(0, 12) + ').');
    if (r.modeReset) TCC.toast('warn', 'Mode', 'The configuration changed, so the platform returned to BACKTEST.', 12000);
    if (r.paperSessionStopped) TCC.toast('warn', 'Paper', 'The active paper session was stopped first.', 12000);
    TCC.refreshStatus();
    return r;
  }

  function fail(e) {
    TCC.toast('danger', e && e.status === 403 ? 'Refused' : 'Not applied', TCC.describeError(e), 15000);
    return null;
  }

  // ---------------------------------------------------------------------------
  // sections
  // ---------------------------------------------------------------------------

  function modeSection(cfg, modeInfo, reload) {
    var owner = api.can('own');
    var operate = api.can('operate');
    var inPaper = cfg.mode === 'PAPER';
    var body = [
      el('div', { class: 'grid grid-3' }, [
        modeOption('BACKTEST', cfg.mode === 'BACKTEST', 'Replays recorded bars through the pipeline. The default, and where a restart always returns.'),
        modeOption('PAPER', inPaper, 'The same pipeline from an incremental feed, with paper-marked records. Needs an owner-approval record.'),
        modeOption('DEMO', false, 'A two-arm PAPER session — champion against challenger on identical ticks. Not a separate mode: it runs inside PAPER.',
          TCC.link('/paper', 'Start from the Paper page'))
      ]),
      ui.banner('info', 'Live', 'LIVE execution is not available in this build: there is no venue connection, no credential, and the ' +
        'Trading Agent\'s live adapter refuses every call. This console cannot select it.')
    ];

    if (inPaper) {
      body.push(el('div', { class: 'row' }, [
        ui.button('Return to BACKTEST', 'btn-secondary', function (b) {
          TCC.confirm({ title: 'Return to BACKTEST', message: 'Lowering the mode needs no approval. An active paper session is stopped first. Going back to PAPER will need a new owner approval.', reason: true, confirmLabel: 'Return to BACKTEST' })
            .then(function (a) {
              if (!a) return;
              ui.run(b, 'Lowering…', function () {
                return api.post('/api/config/mode', { to: 'BACKTEST', reason: a.reason }).then(receipt).then(reload).catch(fail);
              });
            });
        }, { disabled: !operate }),
        !operate ? ui.needsRole('OPERATOR') : null
      ]));
    } else if (modeInfo.toPaper) {
      body.push(el('div', { class: 'row' }, [
        ui.button('Approve PAPER…', 'btn-primary', function () { approvalDialog(cfg, modeInfo.toPaper, reload); }, { disabled: !owner }),
        !owner ? ui.needsRole('OWNER') : el('span', { class: 't-small t-secondary', text: 'Requires a complete owner-approval record: ' + modeInfo.toPaper.gates.length + ' gates, each with evidence.' })
      ]));
    }
    return ui.card({ title: 'Mode', sub: 'The execution mode changes only through the Trading Agent\'s mode controller.', body: el('div', { class: 'stack' }, body) });
  }

  function modeOption(name, active, text, extra) {
    return el('div', { class: 'kpi' + (active ? '' : ' is-nodata') }, [
      el('div', { class: 'kpi-label', text: name }),
      el('div', { class: 'kpi-value is-text' }, active ? ui.badge('ACTIVE', 'ok') : ui.badge(name === 'DEMO' ? 'SESSION TYPE' : 'NOT ACTIVE', 'neutral')),
      el('div', { class: 'kpi-sub', text: text }),
      extra ? el('div', { class: 'kpi-sub' }, extra) : null
    ]);
  }

  /** The owner-approval record. The owner types the statement and writes evidence per gate. */
  function approvalDialog(cfg, req, reload) {
    var statement = ui.input({ value: '' });
    var reason = el('textarea', { class: 'textarea', attrs: { rows: '2', maxlength: '500' } });
    var ack = ui.checkbox('I am the owner and I approve this transition for exactly this configuration and commit.', false);
    var verdict = el('div');
    var gates = req.gates.map(function (g) {
      var check = ui.checkbox(fmt.words(g.gate), false);
      var evidence = el('textarea', { class: 'textarea', attrs: { rows: '2', maxlength: '2000', 'aria-label': 'Evidence for ' + g.gate } });
      return { gate: g.gate, check: check, evidence: evidence,
        node: el('div', { class: 'stack-sm' }, [check, el('p', { class: 't-small t-secondary', text: g.description }), evidence]) };
    });

    function record() {
      var evidence = {};
      gates.forEach(function (g) { if (g.evidence.value.trim()) evidence[g.gate] = g.evidence.value.trim(); });
      return {
        ownerApproval: ack.input.checked,
        statement: statement.value.trim(),
        configFingerprint: req.configFingerprint,
        commit: req.commit,
        gatesPassed: gates.filter(function (g) { return g.check.input.checked; }).map(function (g) { return g.gate; }),
        gateEvidence: evidence,
        nonce: 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
      };
    }

    function showProblems(problems, ok) {
      TCC.replace(verdict, ok
        ? ui.banner('ok', 'Would be accepted', 'The Trading Agent\'s mode controller would accept this record.')
        : ui.banner('danger', 'Would be refused', el('ul', null, problems.map(function (p) { return el('li', { text: p }); }))));
    }

    var body = el('div', { class: 'stack' }, [
      ui.kv([
        ['Transition', req.fromMode + ' → ' + req.toMode],
        ['Configuration', ui.hash(req.configFingerprint, 16)],
        ['Commit', req.commitKnown ? ui.hash(req.commit, 12) : ui.badge('UNKNOWN — approval will be refused', 'danger')]
      ]),
      el('p', { class: 't-small t-secondary', text: 'The record is bound to this configuration fingerprint and commit, is single-use, and stops being valid the moment the configuration changes.' }),
      ui.field({ label: 'Type the approval statement exactly', hint: req.requiredStatement, control: statement }),
      el('fieldset', null, [
        el('legend', { class: 't-h3', text: 'Gates — tick each one you attest, and write the evidence' }),
        el('div', { class: 'stack' }, gates.map(function (g) { return g.node; }))
      ]),
      ui.field({ label: 'Reason — recorded in the audit log', control: reason }),
      ack,
      verdict
    ]);

    var m = TCC.modal({
      title: 'Owner approval — BACKTEST → PAPER', wide: true, body: body,
      actions: [
        { label: 'Cancel', kind: 'btn-secondary', onClick: function (b, h) { h.close(); } },
        { label: 'Check record', kind: 'btn-secondary', onClick: function (b) {
          ui.run(b, 'Checking…', function () {
            var rec = record();
            if (rec.statement.length < 10) { showProblems(['type the approval statement'], false); return null; }
            return api.post('/api/config/mode/dry-run', { to: 'PAPER', approval: rec }).then(function (res) {
              showProblems(res.result.problems || [], res.result.ok);
            }).catch(function (e) { showProblems([TCC.describeError(e)], false); });
          });
        } },
        { label: 'Approve PAPER', kind: 'btn-primary', onClick: function (b, h) {
          var rec = record();
          if (reason.value.trim().length < 5) { showProblems(['write a reason of at least 5 characters'], false); return; }
          if (rec.statement.length < 10) { showProblems(['type the approval statement'], false); return; }
          ui.run(b, 'Submitting…', function () {
            return api.post('/api/config/mode', { to: 'PAPER', reason: reason.value.trim(), approval: rec }).then(function (res) {
              h.close();
              receipt(res);
              TCC.toast('ok', 'PAPER', 'The Trading Agent accepted the approval record ' + res.result.approvalId + '.');
              reload();
            }).catch(function (e) { showProblems(String(e.message).split('\n').map(function (l) { return l.replace(/^\s*-\s*/, ''); }).filter(Boolean), false); });
          });
        } }
      ]
    });
    void m;
  }

  function tradingSection(cfg, reload) {
    var enabled = cfg.tradingEnabled;
    var owner = api.can('own');
    var operate = api.can('operate');
    return ui.card({
      title: 'Trading',
      sub: 'This is the Risk Engine\'s own emergency stop. Disabled means every candidate is blocked — not hidden.',
      body: el('div', { class: 'row' }, [
        ui.status(enabled ? 'ENABLED' : 'DISABLED'),
        enabled
          ? ui.button('Disable trading', 'btn-danger', function (b) {
              TCC.confirm({ title: 'Disable trading', message: 'The Risk Engine will block every candidate. An active paper session is stopped. If the platform is in PAPER it returns to BACKTEST.', reason: true, confirmLabel: 'Disable trading', danger: true })
                .then(function (a) {
                  if (!a) return;
                  ui.run(b, 'Disabling…', function () {
                    return api.post('/api/config/trading', { enabled: false, reason: a.reason }).then(receipt).then(reload).catch(fail);
                  });
                });
            }, { disabled: !operate })
          : ui.button('Enable trading…', 'btn-primary', function (b) {
              TCC.confirm({ title: 'Enable trading', message: 'The Risk Engine will again decide each candidate inside the configured limits.', reason: true, typed: 'ENABLE', confirmLabel: 'Enable trading' })
                .then(function (a) {
                  if (!a) return;
                  ui.run(b, 'Enabling…', function () {
                    return api.post('/api/config/trading', { enabled: true, reason: a.reason, confirm: 'ENABLE' }).then(receipt).then(reload).catch(fail);
                  });
                });
            }, { disabled: !owner }),
        enabled ? (!operate ? ui.needsRole('OPERATOR') : null) : (!owner ? ui.needsRole('OWNER') : null)
      ])
    });
  }

  /** A section of numeric / boolean keys with one Save button. */
  function formSection(o, cfg, reload) {
    var owner = api.can('own');
    var controls = o.fields.map(function (f) {
      var current = getPath(cfg.config, f.path);
      var range = cfg.ranges[f.path] || {};
      var control, read;
      if (f.kind === 'switch') {
        var sw = ui.switch(f.label, current, null, { disabled: !owner, on: 'ENABLED', off: 'DISABLED' });
        control = el('div', { class: 'field' }, [sw, f.hint ? el('span', { class: 'hint', text: f.hint }) : null]);
        read = function () { return sw.input.checked; };
      } else if (f.kind === 'select') {
        var sel = ui.select(range.values || f.options, current, null, { disabled: !owner });
        control = ui.field({ label: f.label, hint: f.hint, control: sel });
        read = function () { return sel.value; };
      } else {
        var input = ui.input({ type: 'number', value: current, min: range.min, max: range.max,
          step: range.type === 'integer' ? '1' : 'any', num: true, disabled: !owner, inputmode: 'decimal' });
        control = ui.field({ label: f.label, hint: (f.hint ? f.hint + ' ' : '') + (range.min !== undefined ? 'Allowed ' + range.min + ' – ' + range.max + '.' : ''), control: input });
        read = function () { return input.value === '' ? NaN : Number(input.value); };
      }
      return { path: f.path, node: control, read: read, current: current };
    });
    var save = ui.button('Save ' + o.title.toLowerCase(), 'btn-secondary', function (b) {
      var changes = {};
      var bad = [];
      controls.forEach(function (c) {
        var v = c.read();
        if (typeof v === 'number' && !isFinite(v)) { bad.push(c.path); return; }
        if (JSON.stringify(v) !== JSON.stringify(c.current)) setPath(changes, c.path, v);
      });
      if (bad.length) { TCC.toast('danger', 'Not applied', 'Enter a number for: ' + bad.join(', ')); return; }
      if (!Object.keys(changes).length) { TCC.toast('warn', 'No change', 'Nothing was edited in this section.'); return; }
      ui.run(b, 'Previewing…', function () { return applyChange(changes, cfg, 'Change ' + o.title.toLowerCase()).then(function (r) { if (r) reload(); }).catch(fail); });
    }, { disabled: !owner });
    return ui.card({
      title: o.title, sub: o.sub,
      body: el('div', { class: 'stack' }, [
        o.note ? ui.banner('info', 'Note', o.note) : null,
        el('div', { class: 'form-grid' }, controls.map(function (c) { return c.node; })),
        o.extra ? o.extra : null,
        el('div', { class: 'form-actions' }, [!owner ? ui.needsRole('OWNER') : null, save])
      ])
    });
  }

  function assetsSection(cfg, reload) {
    var owner = api.can('own');
    var boxes = cfg.assets.map(function (a) {
      var box = ui.checkbox(a.symbol, a.inUniverse, null, { disabled: !owner });
      return { symbol: a.symbol, box: box, asset: a };
    });
    var save = ui.button('Save assets', 'btn-secondary', function (b) {
      var universe = boxes.filter(function (x) { return x.box.input.checked; }).map(function (x) { return x.symbol; });
      if (!universe.length) { TCC.toast('danger', 'Not applied', 'At least one asset must stay in the universe.'); return; }
      if (JSON.stringify(universe) === JSON.stringify(cfg.config.universe)) { TCC.toast('warn', 'No change', 'The universe is unchanged.'); return; }
      ui.run(b, 'Previewing…', function () { return applyChange({ universe: universe }, cfg, 'Change the asset universe').then(function (r) { if (r) reload(); }).catch(fail); });
    }, { disabled: !owner });
    return ui.card({
      title: 'Assets', sub: 'Every instrument in the catalog. The universe is what the pipeline considers.',
      body: el('div', { class: 'stack' }, [
        ui.table({
          dense: true,
          columns: [
            { label: 'In universe', render: function (x) { return x.box; } },
            { label: 'Class', render: function (x) { return x.asset.assetClass; } },
            { label: 'Min lot', num: true, render: function (x) { return fmt.lots(x.asset.minLot); } },
            { label: 'Typical spread', num: true, render: function (x) { return x.asset.typicalSpreadPips + ' pips'; } },
            { label: 'Hours UTC', render: function (x) { var t = x.asset.tradingHoursUtc; return t.start === t.end ? '24h' : t.start + ':00 – ' + t.end + ':00'; } },
            { label: 'Reachable', render: function (x) { return x.asset.reachable ? ui.badge('yes', 'ok') : ui.badge('min lot above the position cap', 'warn'); } }
          ],
          rows: boxes
        }),
        el('div', { class: 'form-actions' }, [!owner ? ui.needsRole('OWNER') : null, save])
      ])
    });
  }

  function strategiesSection(cfg, reload) {
    var owner = api.can('own');
    var rows = cfg.strategies.map(function (s) {
      return { s: s, sw: ui.switch(s.strategyId, s.enabled, null, { disabled: !owner, on: 'ENABLED', off: 'DISABLED' }) };
    });
    var save = ui.button('Save strategies', 'btn-secondary', function (b) {
      var enabled = rows.filter(function (r) { return r.sw.input.checked; }).map(function (r) { return r.s.strategyId; });
      if (!enabled.length) { TCC.toast('danger', 'Not applied', 'At least one strategy must stay enabled. To stop trading, disable trading instead.'); return; }
      var before = cfg.strategies.filter(function (s) { return s.enabled; }).map(function (s) { return s.strategyId; });
      if (JSON.stringify(enabled) === JSON.stringify(before)) { TCC.toast('warn', 'No change', 'The enabled set is unchanged.'); return; }
      TCC.confirm({
        title: 'Change the enabled strategies',
        message: enabled.length + ' of ' + rows.length + ' families will be enabled. The set is part of the configuration fingerprint, so an existing PAPER approval stops being valid.',
        reason: true, confirmLabel: 'Apply change'
      }).then(function (a) {
        if (!a) return;
        ui.run(b, 'Applying…', function () {
          return api.post('/api/config/strategies', { enabled: enabled, reason: a.reason, expectedFingerprint: cfg.fingerprint }).then(receipt).then(reload).catch(fail);
        });
      });
    }, { disabled: !owner });
    return ui.card({
      title: 'Strategies', sub: 'All fourteen families. A strategy proposes a signal; it can never express a size.',
      body: el('div', { class: 'stack' }, [
        ui.table({
          dense: true,
          columns: [
            { label: 'Strategy', render: function (r) { return r.sw; } },
            { label: 'Family', render: function (r) { return fmt.words(r.s.family); } },
            { label: 'Name', render: function (r) { return r.s.name; } },
            { label: 'Preferred regimes', render: function (r) { return r.s.preferredRegimes.length ? ui.codes(r.s.preferredRegimes) : 'none declared'; } }
          ],
          rows: rows
        }),
        el('div', { class: 'form-actions' }, [!owner ? ui.needsRole('OWNER') : null, save])
      ])
    });
  }

  function sessionsSection(cfg, reload) {
    var owner = api.can('own');
    var hours = [{ value: '', label: 'instrument hours' }];
    for (var hI = 0; hI < 24; hI++) hours.push({ value: String(hI), label: (hI < 10 ? '0' : '') + hI + ':00' });
    var rows = cfg.assets.filter(function (a) { return a.inUniverse; }).map(function (a) {
      var s = a.schedule;
      return {
        symbol: a.symbol,
        enabled: ui.checkbox('Trade ' + a.symbol, s.enabled, null, { disabled: !owner }),
        start: ui.select(hours, s.startHourUtc === null ? '' : String(s.startHourUtc), null, { compact: true, disabled: !owner }),
        end: ui.select(hours, s.endHourUtc === null ? '' : String(s.endHourUtc), null, { compact: true, disabled: !owner }),
        days: DAYS.map(function (d, i) { return ui.checkbox(d, !!(s.blockedWeekdaysUtc && s.blockedWeekdaysUtc.indexOf(i) !== -1), null, { disabled: !owner }); })
      };
    });
    rows.forEach(function (r) {
      r.start.setAttribute('aria-label', r.symbol + ' session start (UTC)');
      r.end.setAttribute('aria-label', r.symbol + ' session end (UTC)');
    });
    var save = ui.button('Save sessions', 'btn-secondary', function (b) {
      var perAsset = {};
      var bad = [];
      rows.forEach(function (r) {
        var entry = {};
        if (!r.enabled.input.checked) entry.enabled = false;
        if ((r.start.value === '') !== (r.end.value === '')) bad.push(r.symbol);
        if (r.start.value !== '' && r.end.value !== '') { entry.startHourUtc = Number(r.start.value); entry.endHourUtc = Number(r.end.value); }
        var blocked = [];
        r.days.forEach(function (d, i) { if (d.input.checked) blocked.push(i); });
        if (blocked.length) entry.blockedWeekdaysUtc = blocked;
        if (Object.keys(entry).length) perAsset[r.symbol] = entry;
      });
      if (bad.length) { TCC.toast('danger', 'Not applied', 'Set both a start and an end hour, or neither, for: ' + bad.join(', ')); return; }
      ui.run(b, 'Previewing…', function () {
        return applyChange({ schedule: { perAsset: perAsset } }, cfg, 'Change the trading sessions').then(function (r) { if (r) reload(); }).catch(fail);
      });
    }, { disabled: !owner });
    return ui.card({
      title: 'Sessions', sub: 'Per-asset trading windows, in UTC. An asset with no window follows its instrument hours.',
      body: el('div', { class: 'stack' }, [
        ui.table({
          dense: true,
          columns: [
            { label: 'Asset', render: function (r) { return r.enabled; } },
            { label: 'From (UTC)', render: function (r) { return r.start; } },
            { label: 'To (UTC)', render: function (r) { return r.end; } },
            { label: 'Blocked weekdays', render: function (r) { return el('div', { class: 'row-tight' }, r.days); } }
          ],
          rows: rows
        }),
        el('div', { class: 'form-actions' }, [!owner ? ui.needsRole('OWNER') : null, save])
      ])
    });
  }

  function historySection(hist) {
    return ui.card({
      title: 'Change history', sub: 'Every configuration change: who, when, what, why, and both fingerprints.',
      flush: true,
      body: ui.table({
        dense: true,
        empty: ui.state({ tag: 'EMPTY', compact: true, body: 'No configuration change has been recorded. The shipped defaults are in effect.' }),
        columns: [
          { label: 'When', render: function (h) { return el('span', { class: 't-num', text: fmt.wall(h.ts) }); } },
          { label: 'Who', render: function (h) { return h.actor.id + ' (' + h.actor.role + ')'; } },
          { label: 'Kind', render: function (h) { return fmt.words(h.kind); } },
          { label: 'Change', render: function (h) {
            return el('div', { class: 'stack-sm' }, h.diff.map(function (d) {
              return el('div', { class: 't-wrap' }, [el('code', { text: d.path }), ' ', el('span', { class: 't-num', text: show(d.oldValue) + ' → ' + show(d.newValue) })]);
            }));
          } },
          { label: 'Reason', render: function (h) { return el('span', { class: 't-wrap', text: h.reason || 'none given' }); } },
          { label: 'Fingerprint', render: function (h) { return el('span', null, [ui.hash(h.fingerprintBefore, 8), ' → ', ui.hash(h.fingerprintAfter, 8)]); } }
        ],
        rows: hist.items
      }),
      foot: hist.total + ' change(s) recorded.'
    });
  }

  function modeEventsSection(hist) {
    return ui.card({
      title: 'Mode events', sub: 'Who changed the execution mode, when, and under which approval.',
      flush: true,
      body: ui.table({
        dense: true,
        columns: [
          { label: 'When', render: function (e) { return el('span', { class: 't-num', text: fmt.wall(e.ts) }); } },
          { label: 'Transition', render: function (e) { return (e.fromMode || 'start') + ' → ' + e.toMode; } },
          { label: 'Direction', render: function (e) { return ui.badge(e.direction, e.direction === 'UPGRADE' ? 'attention' : 'neutral'); } },
          { label: 'By', render: function (e) { return e.principalKind + ' ' + e.principalId; } },
          { label: 'Approval', render: function (e) { return e.approvalId ? ui.chip(e.approvalId) : el('span', { class: 't-secondary', text: 'none needed' }); } },
          { label: 'Reason', render: function (e) { return el('span', { class: 't-wrap', text: e.reason || 'none given' }); } }
        ],
        rows: hist.modeEvents
      })
    });
  }

  function view(cfg, modeInfo, hist, reload) {
    var c = cfg.config;
    var ladder = [];
    for (var i = 0; i <= c.recovery.maxRecoveryLevel; i++) ladder.push((c.recovery.baseLots * Math.pow(c.recovery.multiplier, i)).toFixed(2));
    return el('div', { class: 'stack-lg', id: 'control-body' }, [
      cfg.startupProblem ? ui.banner('danger', 'Configuration', cfg.startupProblem) : null,
      el('div', { class: 'source-line' }, [el('span', { text: 'Configuration' }), ui.hash(cfg.fingerprint, 16),
        el('span', { text: 'revision ' + cfg.revision }), el('span', { text: 'commit' }), ui.hash(cfg.commit)]),
      modeSection(cfg, modeInfo, reload),
      tradingSection(cfg, reload),
      el('div', { class: 'grid grid-2' }, [
        formSection({
          title: 'Risk', sub: 'Limits the Risk Engine enforces. It remains the final authority on whether to trade and at what size.',
          fields: [
            { path: 'risk.maxAccountRiskPerTradePct', label: 'Maximum account risk per trade (%)', hint: 'The risk % a single trade may put at stake.' },
            { path: 'risk.maxDrawdownPct', label: 'Maximum drawdown (%)', hint: 'Breach raises the emergency stop.' },
            { path: 'risk.maxDailyLossPct', label: 'Daily loss limit (%)' },
            { path: 'risk.maxConsecutiveLosses', label: 'Maximum consecutive losses', hint: 'A circuit breaker with a cooling-off.' },
            { path: 'risk.consecutiveLossCooldownHours', label: 'Cooling-off after the streak limit (hours)' },
            { path: 'risk.maxPositionSizeLots', label: 'Maximum position size (lots)', hint: 'A ceiling on what may be approved — not a size.' }
          ]
        }, cfg, reload),
        el('div', { class: 'stack' }, [
          formSection({
            title: 'Jev', sub: 'The decision gate. It is always part of the pipeline; its hard flags cannot be switched off.',
            note: 'Model ' + c.jev.model + '. Reporting bands ' + c.jev.thresholdBands.map(function (b) { return b[0] + '–' + b[1]; }).join(', ') + '.',
            fields: [
              { path: 'jev.scoreThreshold', label: 'Score threshold', hint: 'A candidate below it is blocked.' },
              { path: 'jev.minConfidence', label: 'Minimum confidence', hint: 'How much the inputs must be worth.' }
            ]
          }, cfg, reload),
          formSection({
            title: 'Recovery', sub: 'The ×3 ladder is opt-in. It only requests a size; the Risk Engine approves, clamps or blocks it.',
            note: 'Requested ladder at the current settings: ' + ladder.join(' → ') + ' lots. Position cap ' + fmt.lots(c.risk.maxPositionSizeLots) + ' lots.',
            fields: [
              { path: 'recovery.enabled', label: 'Recovery', kind: 'switch', hint: 'Off by default.' },
              { path: 'recovery.maxRecoveryLevel', label: 'Maximum recovery level', hint: 'Reaching it abandons the ladder.' }
            ]
          }, cfg, reload)
        ])
      ]),
      strategiesSection(cfg, reload),
      assetsSection(cfg, reload),
      sessionsSection(cfg, reload),
      historySection(hist),
      modeEventsSection(hist)
    ]);
  }

  TCC.page('/control', {
    title: 'Control Center',
    render: function (ctx) {
      var host = el('div');
      ctx.root.appendChild(ui.pageHead('Control Center',
        'Mode, trading switch, assets, strategies, Jev, risk, recovery and sessions. Every change is validated, authorized, persisted and audited.'));
      ctx.root.appendChild(host);
      function load(silent) {
        return ui.load(host, function () {
          return Promise.all([api.get('/api/config'), api.get('/api/config/mode'), api.get('/api/config/history', { limit: 25 })]);
        }, function (r) { return view(r[0], r[1], r[2], function () { load(true); }); }, { silent: silent, alive: ctx.alive });
      }
      load(false);
      // Somebody else changing the configuration must not leave this page
      // showing — and offering to edit — a configuration that no longer exists.
      var seen = TCC.status() ? TCC.status().configFingerprint + '|' + TCC.status().mode : null;
      ctx.onCleanup(TCC.onStatus(function (s) {
        var now = s.configFingerprint + '|' + s.mode;
        if (seen !== null && now !== seen && !document.querySelector('.scrim')) load(true);
        seen = now;
      }));
    }
  });
})();
