'use strict';
/* =====================================================
   MYTHOS OS COMMAND CENTER — client
   projects/mythos-os-console/reference/web/app.js

   Structure, and the reason for it:

     el()            the only way a node is made. Text always goes in
                     through textContent — there is no innerHTML,
                     outerHTML or insertAdjacentHTML anywhere in this
                     file, and tests/mos-1-console-test.js asserts that
                     at source level. Mission bodies, event payloads and
                     provider errors are all upstream text; none of it
                     may become markup.

     RENDERERS       one function per module id, keyed by the same id as
                     the registry in modules.js. A module that has no
                     renderer falls through to the honest "not built"
                     panel automatically, so a registry entry is never a
                     broken route.

     route()         hash routing. #/<module-id>, nothing else.

   The console reads. It has no POST, PUT, PATCH or DELETE, and adding
   one is a governance change, not a feature.
   ===================================================== */

(function () {
  var registry = window.MythosModules;

  // ---------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.text !== undefined && opts.text !== null) node.textContent = String(opts.text);
    if (opts.attrs) {
      Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, String(opts.attrs[k])); });
    }
    if (opts.on) {
      Object.keys(opts.on).forEach(function (k) { node.addEventListener(k, opts.on[k]); });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ---------------------------------------------------------------
  // State vocabulary
  //
  // The mapping from an executor state to a colour is a design
  // decision, documented in docs/MYTHOS_OS_DESIGN_SYSTEM.md §6. Gold —
  // the Mythos accent — is reserved for "the owner is being waited on".
  // Nothing else in the console is gold-badged, so a gold pill anywhere
  // on the screen means exactly one thing.
  // ---------------------------------------------------------------

  var STATE_CLASS = {
    RUNNING: 'is-running', DISPATCHED: 'is-running', IN_PROGRESS: 'is-running',
    COMPLETED: 'is-ok', SUCCEEDED: 'is-ok', IMPLEMENTED: 'is-ok', DONE: 'is-ok',
    FAILED: 'is-error', ERROR: 'is-error', BASELINE_MISMATCH: 'is-error',
    CANCELLED: 'is-inert', SKIPPED: 'is-inert', ARCHIVED: 'is-inert',
    QUEUED: 'is-planned', PLANNED: 'is-planned', DRAFT: 'is-planned', PENDING: 'is-planned',
    WAITING_FOR_QUOTA: 'is-waiting', WAITING_RETRY: 'is-waiting', INTERRUPTED: 'is-waiting',
    WAITING_FOR_APPROVAL: 'is-attention', BLOCKED: 'is-attention',
    NEEDS_HUMAN: 'is-attention', APPROVAL_REQUIRED: 'is-attention'
  };

  function badge(state, extraText) {
    var key = String(state || 'UNKNOWN').toUpperCase();
    var cls = STATE_CLASS[key] || 'is-inert';
    return el('span', { className: 'mythos-badge ' + cls, text: extraText || key.replace(/_/g, ' ') });
  }

  // ---------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------

  function stamp(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  }

  function ago(iso) {
    if (!iso) return '';
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function money(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    return Number(n).toFixed(2);
  }

  // ---------------------------------------------------------------
  // Reusable blocks
  // ---------------------------------------------------------------

  function pageHeader(title, sub, aside) {
    var h = el('h1', { className: 'mythos-page-title' }, [
      el('span', { text: 'MYTHOS ' }), document.createTextNode(title)
    ]);
    var left = el('div', {}, [h, sub ? el('div', { className: 'mythos-page-sub', text: sub }) : null]);
    return el('header', { className: 'mythos-page-header' }, [left, aside || null]);
  }

  function statePanel(icon, title, body, isError) {
    return el('div', { className: 'mythos-state' + (isError ? ' is-error' : '') }, [
      el('span', { className: 'mythos-state-icon', attrs: { 'aria-hidden': 'true' }, text: icon }),
      el('div', { className: 'mythos-state-title', text: title }),
      el('p', { className: 'mythos-state-body', text: body })
    ]);
  }

  function kpi(icon, value, label) {
    return el('div', { className: 'mythos-kpi' }, [
      el('span', { className: 'mythos-kpi-icon', attrs: { 'aria-hidden': 'true' }, text: icon }),
      el('div', { className: 'mythos-kpi-value', text: value }),
      el('div', { className: 'mythos-kpi-label', text: label })
    ]);
  }

  function fact(label, value, big) {
    return el('div', { className: 'console-fact' }, [
      el('span', { className: 'mythos-label', text: label }),
      el('div', { className: 'v' + (big ? ' num' : ''), text: value })
    ]);
  }

  function sectionTitle(text) { return el('h2', { className: 'mythos-section-title', text: text }); }

  function readonlyNotice(text) {
    return el('div', { className: 'console-readonly' }, [
      el('span', { className: 'ico', attrs: { 'aria-hidden': 'true' }, text: '⚿' }),
      el('span', { text: text })
    ]);
  }

  function row(cells) {
    return el('div', { className: 'mythos-row' }, cells);
  }

  function cellMain(title, sub) {
    return el('div', { className: 'mythos-row-main' }, [
      el('div', { className: 'mythos-row-title', text: title }),
      sub ? el('div', { className: 'mythos-row-sub mythos-mono', text: sub }) : null
    ]);
  }

  function cellText(label, value) {
    return el('div', { className: 'mythos-row-main' }, [
      el('span', { className: 'mythos-label', text: label }),
      el('div', { className: 'mythos-row-sub', text: value === undefined || value === null || value === '' ? '—' : String(value) })
    ]);
  }

  // ---------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------

  function api(path) {
    return fetch(path, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (res) {
        return res.json()
          .catch(function () { return { ok: false, error: 'bad_response', detail: 'HTTP ' + res.status }; })
          .then(function (body) {
            if (res.ok && body && body.ok) return body;
            var err = new Error(body && body.detail ? body.detail : 'HTTP ' + res.status);
            err.code = (body && body.error) || 'http_' + res.status;
            throw err;
          });
      });
  }

  // MOS-2: the one write call this console makes. Same-origin POST to
  // the one relay route server.js accepts; the browser never addresses
  // a provider or an executor endpoint directly.
  function postJSON(path, payload) {
    return fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload || {})
    }).then(function (res) {
      return res.json()
        .catch(function () { return { ok: false, error: 'bad_response', detail: 'HTTP ' + res.status }; })
        .then(function (body) {
          if (res.ok && body && body.ok) return body;
          var err = new Error(body && body.detail ? body.detail : 'HTTP ' + res.status);
          err.code = (body && body.error) || 'http_' + res.status;
          throw err;
        });
    });
  }

  // A failed read is rendered as what it is. It is never rendered as an
  // empty list — an operator who cannot tell "nothing is running" from
  // "I cannot see what is running" has been misinformed by the console.
  function upstreamFailure(err, source) {
    var title = err.code === 'upstream_unreachable' ? 'Control plane unreachable'
              : err.code === 'upstream_unauthorized' ? 'Console is not authorised'
              : 'Read failed';
    var body = err.code === 'upstream_unreachable'
      ? 'The console could not reach ' + source + '. This is not an empty result — the current state is unknown. ' + err.message
      : err.code === 'upstream_unauthorized'
      ? 'The control plane refused the console’s token. Reads will stay blocked until it is provisioned. ' + err.message
      : err.message;
    return statePanel('⚠', title, body, true);
  }

  function notBuilt(mod) {
    return el('div', {}, [
      statePanel('◌', 'Not built', mod.summary),
      el('div', { className: 'mythos-card' }, [
        el('span', { className: 'mythos-label', text: 'What would back it' }),
        el('div', { className: 'mythos-card-meta', text: mod.source })
      ])
    ]);
  }

  // ---------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------

  var RENDERERS = {};

  RENDERERS['command-center'] = function (view) {
    view.appendChild(pageHeader('COMMAND CENTER', 'Live state of the Mythos control plane.'));
    view.appendChild(readonlyNotice(
      'This console is read-only by construction, with one deliberate exception: Missions — Pending below can ' +
      'start a new mission on a real provider. It still cannot stop, approve or cancel anything; those remain ' +
      'owner actions on the host.'
    ));

    var slot = el('div', {});
    view.appendChild(slot);

    Promise.all([
      api('/api/health').catch(function (e) { return { ok: false, err: e }; }),
      api('/api/missions').catch(function (e) { return { ok: false, err: e }; }),
      api('/api/campaigns').catch(function (e) { return { ok: false, err: e }; }),
      api('/api/events?limit=12').catch(function (e) { return { ok: false, err: e }; })
    ]).then(function (r) {
      var health = r[0], missions = r[1], campaigns = r[2], events = r[3];
      clear(slot);

      if (!missions.ok) { slot.appendChild(upstreamFailure(missions.err, 'the executor task API')); return; }

      var tasks = missions.data.tasks || [];
      var camps = campaigns.ok ? (campaigns.data.campaigns || []) : [];
      var attention = tasks.filter(function (t) {
        return STATE_CLASS[String(t.effective || t.status).toUpperCase()] === 'is-attention';
      });
      var running = tasks.filter(function (t) { return String(t.effective || t.status) === 'RUNNING'; });
      var waiting = tasks.filter(function (t) {
        return STATE_CLASS[String(t.effective || t.status).toUpperCase()] === 'is-waiting';
      });

      var grid = el('div', { className: 'mythos-kpi-grid' }, [
        kpi('▶', String(running.length), 'Missions running'),
        kpi('☷', String(camps.length), 'Campaigns'),
        kpi('◴', String(waiting.length), 'Waiting on a limit'),
        kpi('⚖', String(attention.length), 'Awaiting the owner'),
        kpi('◈', health.ok ? (health.data.upstream.ok ? 'UP' : 'DEGRADED') : 'UNKNOWN', 'Control plane')
      ]);
      slot.appendChild(grid);

      var pending = tasks.filter(function (t) { return String(t.effective || t.status).toUpperCase() === 'QUEUED'; });
      slot.appendChild(sectionTitle('Missions — Pending'));
      slot.appendChild(startMissionSection(pending));

      slot.appendChild(sectionTitle('Executions'));
      slot.appendChild(executionsSection(tasks));

      if (attention.length) {
        slot.appendChild(sectionTitle('Awaiting the owner'));
        var list = el('div', { className: 'mythos-list' });
        attention.forEach(function (t) { list.appendChild(missionRow(t)); });
        slot.appendChild(list);
      }

      slot.appendChild(sectionTitle('In flight'));
      if (!running.length) {
        slot.appendChild(statePanel('◌', 'Nothing running', 'The executor reports no mission in the RUNNING state.'));
      } else {
        var rl = el('div', { className: 'mythos-list' });
        running.forEach(function (t) { rl.appendChild(missionRow(t)); });
        slot.appendChild(rl);
      }

      slot.appendChild(sectionTitle('Recent activity'));
      if (!events.ok) {
        slot.appendChild(upstreamFailure(events.err, 'the executor event stream'));
      } else {
        slot.appendChild(eventFeed(events.data.events || []));
      }
    });
  };

  function missionRow(t) {
    var state = t.effective || t.status;
    return row([
      cellMain(t.project || 'unknown project', t.task_id || ''),
      cellText('Stage', t.stage),
      cellText('Next action', t.next_action),
      el('div', { className: 'mythos-row-end' }, [badge(state)])
    ]);
  }

  // MOS-2: the real, currently runnable provider enum, mirrored 1:1 from
  // server.js's own REAL_PROVIDERS — anything else this select could offer
  // would be rejected by that check, so nothing else is offered. Excludes
  // 'mock' (test-only) and 'gemini' (registered but unconfigured — no
  // credential exists, and it is not in the Phase 1 provider enum at all).
  var START_PROVIDERS = [
    { value: 'claude-code', label: 'claude-code — execution authority' },
    { value: 'openai-compat', label: 'openai-compat — advisory, via OmniRoute' }
  ];

  function pendingRow(t) {
    return row([
      cellMain(t.stage || 'unstaged', t.task_id || ''),
      cellText('Provider', t.provider),
      cellText('Model', t.model || '(default)'),
      cellText('Priority', t.priority),
      el('div', { className: 'mythos-row-end' }, [badge(t.effective || t.status)])
    ]);
  }

  // A new mission: title + instruction + provider (+ optional model). No
  // other field exists client-side to send — project, execution_profile,
  // mode and requested_by are fixed server-side in server.js and are never
  // part of this payload. Feedback renders inline; this file has no
  // alert()/confirm() anywhere and this does not start one.
  function startMissionSection(pending) {
    var wrap = el('div', {});
    var feedback = el('div', { className: 'mythos-start-feedback' });

    var titleInput = el('input', {
      className: 'mythos-input',
      attrs: { type: 'text', id: 'mission-title', maxlength: '200', placeholder: 'Short mission title', autocomplete: 'off' }
    });
    var instructionInput = el('textarea', {
      className: 'mythos-input mythos-textarea',
      attrs: { id: 'mission-instruction', maxlength: '20000', rows: '3',
        placeholder: 'What should the agent do? Read-only analysis only — this pathway cannot write, commit or deploy.' }
    });
    var providerSelect = el('select', { className: 'mythos-input', attrs: { id: 'mission-provider' } },
      START_PROVIDERS.map(function (p) { return el('option', { attrs: { value: p.value }, text: p.label }); }));
    var modelInput = el('input', {
      className: 'mythos-input',
      attrs: { type: 'text', id: 'mission-model', maxlength: '100', placeholder: 'model (optional — provider default if blank)', autocomplete: 'off' }
    });

    var startBtn = el('button', {
      className: 'mythos-btn mythos-btn-gold',
      attrs: { type: 'button' },
      text: 'Start Mission'
    });

    startBtn.addEventListener('click', function () {
      clear(feedback);
      var title = titleInput.value.trim();
      var instruction = instructionInput.value.trim();
      if (!title || !instruction) {
        feedback.appendChild(statePanel('⚠', 'Missing fields', 'Title and instruction are both required.', true));
        return;
      }
      startBtn.disabled = true;
      startBtn.textContent = 'Starting…';
      postJSON('/api/missions/start', {
        title: title,
        instruction: instruction,
        provider: providerSelect.value,
        model: modelInput.value.trim() || undefined
      }).then(function (r) {
        clear(feedback);
        feedback.appendChild(statePanel('▶', 'Mission started', r.data.task_id + ' — ' + r.data.status +
          ' on ' + r.data.provider + (r.data.model ? ' (' + r.data.model + ')' : '') +
          '. It will appear under Missions once the next status refresh loads.'));
        titleInput.value = ''; instructionInput.value = ''; modelInput.value = '';
      }).catch(function (e) {
        clear(feedback);
        feedback.appendChild(statePanel('⚠', 'Could not start mission', e.message, true));
      }).then(function () {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Mission';
      });
    });

    var form = el('div', { className: 'mythos-start-form' }, [
      el('label', { className: 'mythos-label', attrs: { for: 'mission-title' }, text: 'Title' }), titleInput,
      el('label', { className: 'mythos-label', attrs: { for: 'mission-instruction' }, text: 'Instruction' }), instructionInput,
      el('div', { className: 'mythos-start-row' }, [
        el('div', {}, [el('label', { className: 'mythos-label', attrs: { for: 'mission-provider' }, text: 'Provider' }), providerSelect]),
        el('div', {}, [el('label', { className: 'mythos-label', attrs: { for: 'mission-model' }, text: 'Model (optional)' }), modelInput])
      ]),
      startBtn, feedback
    ]);
    wrap.appendChild(form);

    if (!pending.length) {
      wrap.appendChild(statePanel('◌', 'No missions pending', 'Nothing is QUEUED right now — start one above.'));
    } else {
      var list = el('div', { className: 'mythos-list' });
      pending.forEach(function (t) { list.appendChild(pendingRow(t)); });
      wrap.appendChild(list);
    }
    return wrap;
  }

  // MOS-2.1: the complete lifecycle view. Every task from the SAME
  // /api/missions response already fetched for this page — no second
  // list fetch. States not covered by an explicit card class fall
  // through to badge()'s own is-inert default, so a future executor
  // state is shown honestly rather than dropped from the list.
  var CANCELLABLE_STATES = ['QUEUED', 'RUNNING', 'WAITING_FOR_QUOTA', 'WAITING_RETRY', 'INTERRUPTED'];

  function executionsSection(tasks) {
    var wrap = el('div', {});
    if (!tasks.length) {
      wrap.appendChild(statePanel('◌', 'No executions yet', 'Nothing has been created. Start a mission above.'));
      return wrap;
    }
    var sorted = tasks.slice().sort(function (a, b) {
      return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
    });
    var list = el('div', { className: 'mythos-list' });
    sorted.forEach(function (t) { list.appendChild(executionCard(t)); });
    wrap.appendChild(list);
    return wrap;
  }

  function executionCard(t) {
    var state = String(t.effective || t.status || 'UNKNOWN').toUpperCase();
    var detailSlot = el('div', { className: 'mythos-exec-detail' });
    var detailOpen = false;

    var viewBtn = el('button', { className: 'mythos-btn mythos-btn-outline', attrs: { type: 'button' }, text: 'View Details' });
    viewBtn.addEventListener('click', function () {
      if (detailOpen) { clear(detailSlot); detailOpen = false; viewBtn.textContent = 'View Details'; return; }
      detailOpen = true;
      viewBtn.textContent = 'Hide Details';
      clear(detailSlot);
      detailSlot.appendChild(statePanel('◌', 'Loading…', ''));
      var calls = [api('/api/missions/' + encodeURIComponent(t.task_id)).catch(function (e) { return { ok: false, err: e }; })];
      var terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED'].indexOf(state) !== -1;
      if (terminal) calls.push(api('/api/missions/' + encodeURIComponent(t.task_id) + '/report').catch(function (e) { return { ok: false, err: e }; }));
      Promise.all(calls).then(function (r) {
        clear(detailSlot);
        var detail = r[0], report = r[1];
        if (!detail.ok) { detailSlot.appendChild(upstreamFailure(detail.err, 'the execution detail')); return; }
        detailSlot.appendChild(fact('Instruction', detail.data.task.instruction));
        detailSlot.appendChild(fact('Execution ID', detail.data.status.execution_id || '(not started)'));
        detailSlot.appendChild(fact('Next action', detail.data.status.next_action));
        if (detail.data.status.last_error) detailSlot.appendChild(fact('Last error', detail.data.status.last_error));
        if (report && report.ok && report.data.summary) detailSlot.appendChild(fact('Result summary', report.data.summary));
        if (report && report.ok && report.data.problems && report.data.problems.length) {
          detailSlot.appendChild(fact('Report problems', report.data.problems.join('; ')));
        }
      });
    });

    var cancelBtn = null;
    if (CANCELLABLE_STATES.indexOf(state) !== -1) {
      cancelBtn = el('button', { className: 'mythos-btn mythos-btn-outline', attrs: { type: 'button' }, text: 'Cancel' });
      cancelBtn.addEventListener('click', function () {
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling…';
        postJSON('/api/missions/' + encodeURIComponent(t.task_id) + '/cancel', {}).then(function () {
          cancelBtn.textContent = 'Cancelled';
        }).catch(function (e) {
          clear(detailSlot);
          detailSlot.appendChild(statePanel('⚠', 'Could not cancel', e.message, true));
          cancelBtn.disabled = false;
          cancelBtn.textContent = 'Cancel';
        });
      });
    }

    var actions = el('div', { className: 'mythos-exec-actions' }, [viewBtn, cancelBtn]);

    return el('div', { className: 'mythos-exec-card' }, [
      row([
        cellMain(t.stage || 'unstaged', 'Execution ID: ' + (t.execution_id || t.task_id)),
        cellText('Model', (t.provider || '—') + (t.model ? ' (' + t.model + ')' : '')),
        cellText('Started', t.started_at ? stamp(t.started_at) : '—'),
        el('div', { className: 'mythos-row-end' }, [badge(state), actions])
      ]),
      detailSlot
    ]);
  }

  RENDERERS.missions = function (view) {
    view.appendChild(pageHeader('MISSIONS', 'Every executor task, newest first.'));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/missions').then(function (r) {
      clear(slot);
      var tasks = (r.data.tasks || []).slice().sort(function (a, b) {
        return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
      });
      if (!tasks.length) {
        slot.appendChild(statePanel('◌', 'No missions', 'The executor task store is empty.'));
        return;
      }
      slot.appendChild(el('div', { className: 'mythos-kpi-grid' }, countByState(tasks).map(function (c) {
        return kpi('•', String(c.n), c.state.replace(/_/g, ' '));
      })));
      var list = el('div', { className: 'mythos-list' });
      tasks.forEach(function (t) {
        list.appendChild(row([
          cellMain(t.project || 'unknown project', t.task_id || ''),
          cellText('Stage / provider', [t.stage, t.provider].filter(Boolean).join(' · ')),
          cellText('Updated', stamp(t.updated_at) + (ago(t.updated_at) ? '  (' + ago(t.updated_at) + ')' : '')),
          el('div', { className: 'mythos-row-end' }, [badge(t.effective || t.status)])
        ]));
      });
      slot.appendChild(sectionTitle('All missions'));
      slot.appendChild(list);
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the executor task API'));
    });
  };

  function countByState(items) {
    var seen = {};
    items.forEach(function (t) {
      var s = String(t.effective || t.status || 'UNKNOWN');
      seen[s] = (seen[s] || 0) + 1;
    });
    return Object.keys(seen).sort().map(function (k) { return { state: k, n: seen[k] }; });
  }

  RENDERERS.campaigns = function (view) {
    view.appendChild(pageHeader('CAMPAIGNS', 'Multi-mission campaigns and where each has reached.'));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/campaigns').then(function (r) {
      clear(slot);
      var camps = r.data.campaigns || [];
      if (!camps.length) {
        slot.appendChild(statePanel('◌', 'No campaigns', 'The orchestration core reports no campaign.'));
        return;
      }
      var list = el('div', { className: 'mythos-list' });
      camps.forEach(function (c) {
        var done = c.missions_completed !== undefined ? c.missions_completed : (c.completed || 0);
        var total = c.missions_total !== undefined ? c.missions_total : (c.total || 0);
        list.appendChild(row([
          cellMain(c.title || c.goal || c.campaign_id || 'campaign', c.campaign_id || ''),
          cellText('Progress', total ? done + ' / ' + total + ' missions' : String(done) + ' missions'),
          cellText('Needs human', c.needs_human ? 'YES — the owner is being waited on' : 'no'),
          el('div', { className: 'mythos-row-end' }, [badge(c.state || c.status)])
        ]));
      });
      slot.appendChild(list);
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the executor campaign API'));
    });
  };

  RENDERERS.agents = function (view) {
    view.appendChild(pageHeader('AGENTS', 'Registered agents and their execution authority.'));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/agents').then(function (r) {
      clear(slot);
      var agents = r.data.agents || {};
      var ids = Object.keys(agents);
      if (!ids.length) {
        slot.appendChild(statePanel('◌', 'No agents registered', 'The agent registry is empty.'));
        return;
      }
      var grid = el('div', { className: 'mythos-grid' });
      ids.forEach(function (id) {
        var a = agents[id] || {};
        grid.appendChild(el('div', { className: 'mythos-card' }, [
          el('div', { className: 'mythos-card-head' }, [
            el('div', { className: 'mythos-card-title', text: id }),
            badge(a.enabled === false ? 'ARCHIVED' : 'COMPLETED', a.enabled === false ? 'DISABLED' : 'ENABLED')
          ]),
          el('div', { className: 'console-facts' }, [
            fact('Provider', a.provider || '—'),
            fact('Model', a.model || 'default'),
            fact('Risk', String(a.risk_level || '—')),
            fact('Cost tier', (a.cost && a.cost.tier) || '—')
          ]),
          el('div', {}, [
            el('span', { className: 'mythos-label', text: 'Execution authority' }),
            badge(a.execution_authority ? 'BLOCKED' : 'ARCHIVED',
                  a.execution_authority ? 'CAN MODIFY REPOSITORIES' : 'ADVISORY ONLY')
          ]),
          el('div', {}, [
            el('span', { className: 'mythos-label', text: 'Capabilities' }),
            el('div', { className: 'mythos-card-meta', text: (a.capabilities || []).join(', ') || '—' })
          ])
        ]));
      });
      slot.appendChild(grid);
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the agent registry'));
    });
  };

  RENDERERS.providers = function (view) {
    view.appendChild(pageHeader('PROVIDERS', 'Provider routing and the fallback policy.'));
    view.appendChild(readonlyNotice(
      'No credential, key or endpoint is read or served by this console. Provider identity and policy only.'
    ));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/providers').then(function (r) {
      clear(slot);
      var router = r.data.router || {};
      var fb = router.fallback || {};
      slot.appendChild(sectionTitle('Fallback policy'));
      slot.appendChild(el('div', { className: 'mythos-card' }, [
        el('div', { className: 'console-facts' }, [
          fact('Router', router.router_id || '—'),
          fact('Fallback', fb.enabled ? 'enabled' : 'disabled'),
          fact('Never for execution authority', fb.never_for_execution_authority ? 'enforced' : 'not enforced')
        ]),
        el('div', {}, [
          el('span', { className: 'mythos-label', text: 'Task types permitted to fall back' }),
          el('div', { className: 'mythos-card-meta', text: (fb.allowed_task_types || []).join(', ') || '—' })
        ]),
        router.description
          ? el('div', { className: 'mythos-card-meta', text: router.description })
          : null
      ]));

      slot.appendChild(sectionTitle('Providers in use'));
      var provs = r.data.providers || [];
      if (!provs.length) {
        slot.appendChild(statePanel('◌', 'No providers', 'No agent declares a provider.'));
        return;
      }
      var wrap = el('div', { className: 'mythos-table-wrap' });
      var table = el('table', { className: 'mythos-table' });
      table.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Provider' }), el('th', { text: 'Agents' }),
        el('th', { text: 'Execution authority' }), el('th', { text: 'Enabled' })
      ])]));
      var tb = el('tbody');
      provs.forEach(function (p) {
        tb.appendChild(el('tr', {}, [
          el('td', {}, [el('span', { className: 'mythos-mono', text: p.provider })]),
          el('td', { text: (p.agents || []).join(', ') }),
          el('td', {}, [badge(p.execution_authority ? 'BLOCKED' : 'ARCHIVED',
                              p.execution_authority ? 'YES' : 'NO')]),
          el('td', { text: p.enabled + ' of ' + (p.agents || []).length })
        ]));
      });
      table.appendChild(tb);
      wrap.appendChild(table);
      slot.appendChild(wrap);
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the provider registry'));
    });
  };

  RENDERERS.budget = function (view) {
    view.appendChild(pageHeader('BUDGET', 'Per-project ledger, reservations and spend.'));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/budget').then(function (r) {
      clear(slot);
      var rows = r.data.projects || [];
      if (!rows.length) {
        slot.appendChild(statePanel('◌', 'No budget records', 'No project has a budget ledger entry yet.'));
        return;
      }
      var grid = el('div', { className: 'mythos-grid' });
      rows.forEach(function (b) {
        grid.appendChild(el('div', { className: 'mythos-card' }, [
          el('div', { className: 'mythos-card-head' }, [
            el('div', { className: 'mythos-card-title', text: b.project }),
            b.error ? badge('FAILED', 'UNREADABLE') : null
          ]),
          b.error
            ? el('div', { className: 'mythos-card-meta', text: b.error })
            : el('div', { className: 'console-facts' }, [
                fact('Spent', money(b.spent), true),
                fact('Limit', b.limit === null || b.limit === undefined ? 'none' : money(b.limit)),
                fact('Reserved', money(b.reserved)),
                fact('Remaining', b.remaining === null || b.remaining === undefined ? '—' : money(b.remaining))
              ])
        ]));
      });
      slot.appendChild(grid);
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the budget ledger'));
    });
  };

  RENDERERS.roadmap = function (view) {
    view.appendChild(pageHeader('ROADMAP', 'Capability status as the executor records it.'));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/roadmap').then(function (r) {
      clear(slot);
      var caps = r.data.capabilities || {};
      var keys = Object.keys(caps).sort();
      if (!keys.length) {
        slot.appendChild(statePanel('◌', 'No roadmap state', 'The executor holds no capability record.'));
        return;
      }
      var list = el('div', { className: 'mythos-list' });
      keys.forEach(function (k) {
        var c = caps[k] || {};
        var ev = c.evidence || {};
        list.appendChild(el('div', { className: 'mythos-row console-cap' }, [
          el('div', { className: 'key', text: k }),
          el('div', { className: 'mythos-row-main' }, [
            el('div', { className: 'mythos-row-title', text: c.title || ev.note || 'capability ' + k }),
            ev.commit ? el('div', { className: 'mythos-row-sub mythos-mono', text: 'commit ' + String(ev.commit).slice(0, 12) }) : null
          ]),
          badge(c.status)
        ]));
      });
      slot.appendChild(list);
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the roadmap state file'));
    });
  };

  RENDERERS.audit = function (view) {
    view.appendChild(pageHeader('AUDIT', 'The append-only event trail, newest first.'));
    var slot = el('div', {});
    view.appendChild(slot);

    api('/api/events?limit=200').then(function (r) {
      clear(slot);
      slot.appendChild(eventFeed(r.data.events || []));
    }).catch(function (e) {
      clear(slot);
      slot.appendChild(upstreamFailure(e, 'the executor event stream'));
    });
  };

  function eventFeed(events) {
    if (!events.length) {
      return statePanel('◌', 'No events', 'The event stream holds no record for this window.');
    }
    var feed = el('div', { className: 'console-feed' });
    events.forEach(function (ev) {
      var what = el('div', { className: 'what' }, [
        el('b', { text: String(ev.type || ev.event || 'event') }),
        document.createTextNode('  '),
        document.createTextNode(describeEvent(ev))
      ]);
      feed.appendChild(el('div', { className: 'console-event' }, [
        el('div', { className: 'at', text: stamp(ev.at || ev.ts || ev.time) }),
        what
      ]));
    });
    return feed;
  }

  // Event payloads are upstream data of unknown shape. Rather than
  // guessing at fields, the known identifiers are named and the rest is
  // serialised — truncated, and always as text.
  function describeEvent(ev) {
    var bits = [];
    ['task_id', 'campaign_id', 'goal_id', 'mission_id', 'project', 'status', 'state', 'reason'].forEach(function (k) {
      if (ev[k]) bits.push(k + '=' + ev[k]);
    });
    if (bits.length) return bits.join('  ');
    var rest = {};
    Object.keys(ev).forEach(function (k) {
      if (['type', 'event', 'at', 'ts', 'time'].indexOf(k) === -1) rest[k] = ev[k];
    });
    var s = JSON.stringify(rest);
    if (!s || s === '{}') return '';
    return s.length > 240 ? s.slice(0, 240) + '…' : s;
  }

  // ---------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------

  var app = document.getElementById('app');
  var navEl = document.getElementById('nav');
  var viewEl = document.getElementById('view');
  var toggle = document.getElementById('nav-toggle');
  var scrim = document.getElementById('scrim');

  function setNavOpen(open) {
    app.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  toggle.addEventListener('click', function () { setNavOpen(!app.classList.contains('nav-open')); });
  scrim.addEventListener('click', function () { setNavOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setNavOpen(false); });

  function buildNav(activeId) {
    clear(navEl);
    registry.sections.forEach(function (section) {
      navEl.appendChild(el('div', { className: 'mythos-nav-section', text: section }));
      registry.modules.filter(function (m) { return m.section === section; }).forEach(function (m) {
        var cls = 'mythos-nav-btn' + (m.state === 'planned' ? ' planned' : '') + (m.id === activeId ? ' active' : '');
        var btn = el('a', {
          className: cls,
          attrs: { href: '#/' + m.id, 'aria-current': m.id === activeId ? 'page' : 'false' },
          on: { click: function () { setNavOpen(false); } }
        }, [
          el('span', { className: 'ico', attrs: { 'aria-hidden': 'true' }, text: m.icon }),
          el('span', { className: 'label', text: m.label }),
          m.state === 'planned' ? el('span', { className: 'tag', text: 'soon' }) : null
        ]);
        navEl.appendChild(btn);
      });
    });
  }

  function refreshLink() {
    var strip = document.getElementById('link-state');
    api('/api/health').then(function (r) {
      clear(strip);
      var up = r.data.upstream || {};
      strip.appendChild(badge(up.ok ? 'COMPLETED' : (up.reachable ? 'BLOCKED' : 'FAILED'),
                              up.ok ? 'CONTROL PLANE UP' : (up.reachable ? 'DEGRADED' : 'UNREACHABLE')));
      // `at` is on the envelope, not inside data — see ok() in server.js.
      strip.appendChild(el('span', { className: 'stamp', text: 'read ' + stamp(r.at) }));
    }).catch(function () {
      clear(strip);
      strip.appendChild(badge('FAILED', 'CONSOLE API UNREACHABLE'));
    });
  }

  function identity() {
    var box = document.getElementById('identity');
    api('/api/health').then(function (r) {
      clear(box);
      var d = r.data || {};
      [['Console', d.version || '—'], ['Plane', (d.upstream && d.upstream.target) || '—']].forEach(function (kv) {
        box.appendChild(el('div', { className: 'row' }, [
          el('span', { className: 'k', text: kv[0] }),
          el('span', { className: 'v', text: kv[1] })
        ]));
      });
    }).catch(function () { clear(box); });
  }

  function route() {
    var id = (location.hash || '').replace(/^#\/?/, '') || registry.defaultId;
    var mod = registry.byId(id);
    if (!mod) {
      buildNav(null);
      clear(viewEl);
      viewEl.appendChild(pageHeader('NOT FOUND', 'No module is registered at this address.'));
      viewEl.appendChild(statePanel('⚠', 'Unknown module', 'The address “' + id + '” matches no entry in the MYTHOS OS module registry.', true));
      return;
    }

    document.title = 'MYTHOS OS — ' + mod.label;
    buildNav(mod.id);
    clear(viewEl);

    var renderer = mod.state === 'live' ? RENDERERS[mod.id] : null;
    if (renderer) {
      renderer(viewEl);
    } else {
      viewEl.appendChild(pageHeader(mod.label.toUpperCase(), mod.summary));
      viewEl.appendChild(notBuilt(mod));
    }
    viewEl.focus();
    refreshLink();
  }

  window.addEventListener('hashchange', route);
  route();
  identity();
  setInterval(refreshLink, 60000);
}());
