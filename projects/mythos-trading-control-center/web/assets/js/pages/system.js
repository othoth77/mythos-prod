/* =============================================================================
   MYTHOS TRADING CONTROL CENTER — System
   projects/mythos-trading-control-center/web/assets/js/pages/system.js

   What is running, from which commit, in what state — and the audit chain.

   Three rules the page keeps:
     · UNKNOWN IS NOT A PASS. A health check with nothing to evaluate is shown
       as UNKNOWN and counted apart; the overall status is never OK while any
       check is unknown.
     · The data-provenance check is WARN on synthetic data, permanently. It is
       shown as WARN.
     · The audit log is a hash chain. "Verify" recomputes it on the server from
       the first entry and reports the first broken link, if there is one.
       The page shows the result; it does not compute one.
   ============================================================================= */
(function () {
  'use strict';

  var TCC = window.TCC;
  var el = TCC.el;
  var ui = TCC.ui;
  var fmt = TCC.fmt;
  var api = TCC.api;

  function uptime(s) { return fmt.duration(s * 1000); }
  function json(v) { return v === null || v === undefined ? null : el('div', { class: 'pre', text: JSON.stringify(v, null, 2) }); }

  // ---------------------------------------------------------------------------
  // components, health, deployment
  // ---------------------------------------------------------------------------

  function overview(s) {
    return el('div', { class: 'grid grid-6', id: 'system-overview' }, [
      ui.kpi('Version', s.version, null, { text: true }),
      ui.kpi('Commit', s.commitKnown ? s.commit.slice(0, 12) : null, s.commitKnown ? null : 'PAPER approvals are refused', { text: true, naReason: 'the running commit could not be determined' }),
      ui.kpi('Environment', s.environment, 'node ' + s.node, { text: true }),
      ui.kpi('Uptime', uptime(s.uptimeSeconds), 'since ' + fmt.wallShort(s.startedAt), { text: true }),
      ui.kpi('Mode', ui.status(s.mode), 'LIVE: not available'),
      ui.kpi('Health', ui.status(s.health.status), s.health.counts.ok + ' ok · ' + s.health.counts.warn + ' warn · ' + s.health.counts.fail + ' fail · ' + s.health.counts.unknown + ' unknown')
    ]);
  }

  function components(s) {
    return ui.card({
      title: 'Components', flush: true,
      body: el('div', { id: 'system-components' }, ui.table({
        dense: true, caption: 'Components',
        columns: [
          { label: 'Component', render: function (c) { return c.component; } },
          { label: 'Status', render: function (c) { return ui.status(c.status); } },
          { label: 'Detail', render: function (c) { return el('span', { class: 't-small t-wrap', text: c.detail }); } }
        ],
        rows: s.components
      }))
    });
  }

  function health(s) {
    var h = s.health;
    var rows = h.staticChecks.map(function (c) { return { c: c, from: 'evaluated now' }; });
    (h.runChecks || []).forEach(function (c) { rows.push({ c: c, from: 'run ' + h.runChecksSource.runId }); });
    return ui.card({
      title: 'Health checks',
      sub: '13 checks: 4 evaluated against the running configuration, 9 against the latest completed backtest.',
      body: el('div', { id: 'system-health', class: 'stack-sm' }, [
        h.note ? ui.banner('warn', 'Unknown', h.note) : null,
        h.runChecksSource ? el('div', { class: 'source-line' }, [el('span', { text: 'Run checks from' }), ui.chip(h.runChecksSource.runId),
          el('span', { text: 'finished ' + fmt.wall(h.runChecksSource.finishedAt) }),
          h.runChecksSource.configCurrent ? ui.badge('CURRENT CONFIGURATION', 'ok') : ui.badge('AN EARLIER CONFIGURATION', 'warn')])
          : el('div', { class: 'source-line' }, [el('span', { text: 'Run checks' }), ui.badge('NO DATA', 'neutral'), el('span', { text: h.runChecksReason })]),
        ui.table({
          dense: true, caption: 'Health checks',
          columns: [
            { label: 'Check', render: function (r) { return fmt.words(r.c.check); } },
            { label: 'Status', render: function (r) { return ui.status(r.c.status); } },
            { label: 'Detail', render: function (r) { return el('span', { class: 't-small t-wrap', text: r.c.detail || '' }); } },
            { label: 'Evaluated', render: function (r) { return el('span', { class: 't-small t-secondary', text: r.from }); } }
          ],
          rows: rows
        })
      ])
    });
  }

  function deployment(s) {
    var d = s.deployment;
    var wb = d.webBuild || {};
    return el('div', { class: 'grid grid-2', id: 'system-deployment' }, [
      ui.card({ title: 'Deployment', body: ui.kv([
        ['Service', el('span', { class: 't-num', text: d.service })],
        ['Listening on', d.bind && d.bind.port ? el('span', { class: 't-num', text: d.bind.host + ':' + d.bind.port }) : null],
        ['Public origin', d.publicOrigin ? el('span', { class: 't-num', text: d.publicOrigin }) : el('span', { class: 't-secondary', text: 'not configured — same-origin checks use the request host' })],
        ['Release commit', d.releaseCommit ? ui.hash(d.releaseCommit, 16) : ui.na('the running commit could not be determined')],
        ['Interface build', wb.built === false ? el('span', { class: 't-small', text: 'unbuilt sources (web/) are being served' })
          : el('span', { class: 't-num', text: (wb.files || '?') + ' files · sources ' + String(wb.sourceDigest || '').slice(0, 12) + (wb.commit ? ' · commit ' + String(wb.commit).slice(0, 12) : '') })],
        ['LIVE execution', el('span', { class: 'row-tight' }, [ui.badge('NOT AVAILABLE', 'neutral'),
          el('span', { class: 't-small', text: s.liveExecution.adapter + (s.liveExecution.refusalVerified ? ' — refusal verified by a health check' : ' — REFUSAL NOT VERIFIED') })])]
      ]) }),
      ui.card({ title: 'Process and state', body: ui.kv([
        ['Memory', el('span', { class: 't-num', text: s.memory.rssMb + ' MB resident · ' + s.memory.heapUsedMb + ' MB heap' })],
        ['State', el('span', { class: 'row-tight' }, [ui.badge(s.persistence.persistence, s.persistence.persistence === 'PERSISTENT' ? 'ok' : 'warn'),
          s.persistence.note ? el('span', { class: 't-small t-wrap', text: s.persistence.note }) : null])],
        ['Runs kept', el('span', { class: 't-num', text: s.runs.retained + ' of ' + s.runs.limits.maxRuns + ' · job limit ' + fmt.duration(s.runs.limits.timeoutMs) })],
        ['Users', s.auth ? el('span', { class: 'row-tight' }, [el('span', { class: 't-num', text: String(s.auth.users) }),
          s.auth.provisioned ? (s.auth.hasOwner ? ui.badge('owner present', 'ok') : ui.badge('NO OWNER', 'warn')) : ui.badge('NOT PROVISIONED', 'danger'),
          s.auth.reason ? el('span', { class: 't-small', text: s.auth.reason }) : null]) : null],
        ['Signed-in sessions', TCC.isNum(s.sessions) ? el('span', { class: 't-num', text: String(s.sessions) }) : null],
        ['Configuration', ui.hash(s.configFingerprint, 16)]
      ]) })
    ]);
  }

  function events(s) {
    return ui.card({
      title: 'System events', flush: true, sub: 'What this process reported since it started, newest first. Kept in memory: the last 50.',
      body: el('div', { id: 'system-events' }, ui.table({
        dense: true, caption: 'System events',
        empty: ui.state({ tag: 'NONE', compact: true, body: 'This process has reported no event since it started.' }),
        columns: [
          { label: 'When', render: function (e) { return el('span', { class: 't-num', text: fmt.wall(e.ts) }); } },
          { label: 'Severity', render: function (e) { return ui.status(e.severity); } },
          { label: 'Event', render: function (e) { return fmt.words(e.kind); } },
          { label: 'Detail', render: function (e) { return el('span', { class: 't-small t-wrap', text: e.message }); } }
        ],
        rows: s.events
      }))
    });
  }

  // ---------------------------------------------------------------------------
  // the audit chain
  // ---------------------------------------------------------------------------

  function entryDialog(e) {
    TCC.modal({
      title: 'Audit entry #' + e.seq, wide: true,
      sub: e.action + ' · ' + e.outcome,
      body: el('div', { class: 'stack-sm', id: 'audit-entry' }, [
        ui.kv([
          ['When', el('span', { class: 't-num', text: fmt.wall(e.ts) })],
          ['Actor', el('span', { class: 't-num', text: e.actor.id + ' (' + e.actor.role + ')' })],
          ['Action', el('span', { class: 't-num', text: e.action })],
          ['Target', e.target ? el('span', { class: 't-num', text: e.target }) : el('span', { class: 't-secondary', text: 'none' })],
          ['Outcome', el('span', { class: 'row-tight' }, [ui.status(e.outcome), e.code ? ui.chip(e.code) : null])],
          ['Reason', e.reason ? el('span', { class: 't-wrap', text: e.reason }) : el('span', { class: 't-secondary', text: 'none given' })],
          ['Configuration before', e.fingerprintBefore ? ui.hash(e.fingerprintBefore, 16) : el('span', { class: 't-secondary', text: 'not recorded' })],
          ['Configuration after', e.fingerprintAfter ? ui.hash(e.fingerprintAfter, 16) : el('span', { class: 't-secondary', text: 'not recorded' })],
          ['Commit', e.commit ? ui.hash(e.commit, 16) : el('span', { class: 't-secondary', text: 'not recorded' })],
          ['Previous hash', el('span', { class: 't-num t-wrap', text: e.prevHash })],
          ['This entry\'s hash', el('span', { class: 't-num t-wrap', text: e.hash })]
        ]),
        e.oldValue !== null && e.oldValue !== undefined ? el('div', null, [el('div', { class: 't-label', text: 'Old value' }), json(e.oldValue)]) : null,
        e.newValue !== null && e.newValue !== undefined ? el('div', null, [el('div', { class: 't-label', text: 'New value' }), json(e.newValue)]) : null,
        e.detail !== null && e.detail !== undefined ? el('div', null, [el('div', { class: 't-label', text: 'Detail' }), json(e.detail)]) : null
      ]),
      actions: [{ label: 'Close', kind: 'btn-secondary', onClick: function (b, h) { h.close(); } }]
    });
  }

  function auditSection(ctx, info) {
    var state = { action: null, outcome: null, actor: null, offset: 0, limit: 50 };
    var listHost = el('div', { id: 'audit-list' });
    var verifyHost = el('div', { id: 'audit-verify' });
    var want = ctx.query.get('audit');
    var lastHead = null;

    function paintVerify(v) {
      TCC.replace(verifyHost, v.ok
        ? ui.banner('ok', 'Chain intact', 'All ' + fmt.int(v.entries) + ' entries verified from the first; head ' + String(v.head).slice(0, 16) + '.')
        : ui.banner('danger', 'CHAIN BROKEN', 'Entry #' + v.brokenAtSeq + ': ' + v.problem + '. Entries from that point on cannot be trusted.'));
    }
    var verifyBtn = ui.button('Verify chain', 'btn-secondary', function (b) {
      ui.run(b, 'Verifying…', function () { return api.get('/api/audit/verify').then(paintVerify); });
    });

    var actionInput = ui.input({ compact: true, placeholder: 'e.g. config. or paper.start', maxlength: 48 });
    actionInput.id = 'audit-action';
    actionInput.addEventListener('change', function () { state.action = actionInput.value.trim() || null; state.offset = 0; load(true); });
    var outcomeSel = ui.select([{ value: '', label: 'All' }, 'ACCEPTED', 'REFUSED', 'FAILED'], '', function (v) { state.outcome = v || null; state.offset = 0; load(true); }, { compact: true });
    outcomeSel.id = 'audit-outcome';
    var actorInput = ui.input({ compact: true, placeholder: 'user id', maxlength: 32 });
    actorInput.id = 'audit-actor';
    actorInput.addEventListener('change', function () { state.actor = actorInput.value.trim() || null; state.offset = 0; load(true); });

    function load(silent) {
      return ui.load(listHost, function () {
        return api.get('/api/audit', { action: state.action, outcome: state.outcome, actor: state.actor, limit: state.limit, offset: state.offset });
      }, function (d) {
        lastHead = d.head.seq;
        return el('div', null, [
          ui.table({
            dense: true, caption: 'Audit log',
            empty: ui.state({ tag: 'NOTHING MATCHES', compact: true, body: 'No audit entry matches these filters.' }),
            onRow: entryDialog,
            columns: [
              { label: '#', num: true, render: function (e) { return String(e.seq); } },
              { label: 'When', render: function (e) { return el('span', { class: 't-num', text: fmt.wall(e.ts) }); } },
              { label: 'Actor', render: function (e) { return e.actor.id + ' · ' + e.actor.role; } },
              { label: 'Action', render: function (e) { return el('span', { class: 't-num', text: e.action }); } },
              { label: 'Target', render: function (e) { return e.target ? el('span', { class: 't-small', text: e.target }) : el('span', { class: 't-secondary', text: '—' }); } },
              { label: 'Outcome', render: function (e) { return el('span', { class: 'row-tight' }, [ui.status(e.outcome), e.code ? ui.chip(e.code) : null]); } },
              { label: 'Reason', render: function (e) { return e.reason ? el('span', { class: 't-small t-wrap', text: e.reason }) : el('span', { class: 't-secondary', text: '—' }); } },
              { label: 'Hash', render: function (e) { return ui.hash(e.hash, 10); } }
            ],
            rows: d.items
          }),
          d.total > state.limit ? ui.pager({ total: d.total, limit: state.limit, offset: state.offset, onChange: function (off) { state.offset = off; load(true); } }) : null,
          el('p', { class: 't-small t-secondary', text: fmt.int(d.total) + ' matching entr' + (d.total === 1 ? 'y' : 'ies') + '. Select a row to read the whole entry.' })
        ]);
      }, { silent: silent, alive: ctx.alive }).then(function (d) {
        // /system?audit=<seq> opens that entry, once.
        if (d && want) {
          var seq = Number(want);
          want = null;
          var hit = d.items.filter(function (e) { return e.seq === seq; })[0];
          if (hit) entryDialog(hit);
          else TCC.toast('warn', 'Audit', 'Entry #' + seq + ' is not on this page of the log.');
        }
        return d;
      });
    }
    load(false);
    ctx.every(6000, function () {
      if (state.offset !== 0 || document.querySelector('.scrim')) return;
      api.get('/api/audit', { limit: 1 }).then(function (d) { if (ctx.alive() && d.head.seq !== lastHead) load(true); }).catch(function () { /* next beat */ });
    });

    var atStart = info.integrityAtStart;
    return ui.card({
      title: 'Audit log',
      sub: 'Append-only and hash-chained: each entry carries the hash of the one before it. Every accepted and every refused change is here.',
      actions: [verifyBtn],
      body: el('div', { class: 'stack-sm', id: 'system-audit' }, [
        el('div', { class: 'row-tight' }, [
          el('span', { class: 't-num', text: fmt.int(info.entries) + ' entries · head ' + String(info.head.hash).slice(0, 16) }),
          atStart ? (atStart.ok ? ui.badge('INTACT WHEN LOADED', 'ok') : ui.badge('BROKEN WHEN LOADED AT #' + atStart.brokenAtSeq, 'danger')) : null
        ]),
        verifyHost,
        el('div', { class: 'filters' }, [
          ui.field({ label: 'Action starts with', control: actionInput }),
          ui.field({ label: 'Outcome', control: outcomeSel }),
          ui.field({ label: 'Actor', control: actorInput })
        ]),
        listHost
      ])
    });
  }

  // ---------------------------------------------------------------------------
  // the page
  // ---------------------------------------------------------------------------

  TCC.page('/system', {
    title: 'System',
    render: function (ctx) {
      var host = el('div', { id: 'system-body' });
      var auditHost = el('div');
      var auditBuilt = false;
      var last = null;
      ctx.root.appendChild(ui.pageHead('System', 'Components, version, commit, environment, uptime, health checks, deployment and the audit chain.'));
      ctx.root.appendChild(host);
      ctx.root.appendChild(auditHost);

      function key(s) { return JSON.stringify([s.components, s.health, s.mode, s.configFingerprint, s.events.length, s.runs, s.sessions]); }
      function load(silent) {
        return ui.load(host, function () { return api.get('/api/system'); }, function (s) {
          last = key(s);
          if (!auditBuilt && s.audit) { auditBuilt = true; auditHost.appendChild(auditSection(ctx, s.audit)); }
          return el('div', { class: 'stack-lg' }, [overview(s), components(s), health(s), deployment(s), events(s), el('div')]);
        }, { silent: silent, alive: ctx.alive });
      }
      load(false);
      ctx.every(5000, function () {
        api.get('/api/system').then(function (s) {
          if (!ctx.alive()) return;
          if (key(s) !== last) { load(true); return; }
          // Uptime and memory move every beat; update them without redrawing the page.
          var tiles = host.querySelectorAll('#system-overview .kpi');
          if (tiles[3]) tiles[3].querySelector('.kpi-value').textContent = uptime(s.uptimeSeconds);
        }).catch(function () { /* the next beat retries */ });
      });
    }
  });
})();
