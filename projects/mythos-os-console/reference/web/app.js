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

  // MOS-v2 M-01: a 401 from any route means this browser no longer has a
  // session -- it expired, the server restarted, or someone signed out in
  // another tab. There is nothing a renderer can usefully do with that,
  // and showing operational chrome around an empty console would be a
  // lie about what the operator can see. So the transport short-circuits
  // to the login page and the promise never resolves, which stops the
  // caller's .then chain from painting anything.
  //
  // location.replace, not assign: a dead session must not sit in the
  // history stack for the back button to return to.
  function signedOut() {
    if (location.pathname !== '/login') location.replace('/login');
    return new Promise(function () { /* deliberately never settles: the page is navigating away */ });
  }

  function api(path) {
    return fetch(path, { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) return signedOut();
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
      if (res.status === 401) return signedOut();
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
      api('/api/events?limit=12').catch(function (e) { return { ok: false, err: e }; }),
      api('/api/dispatcher').catch(function (e) { return { ok: false, err: e }; })
    ]).then(function (r) {
      var health = r[0], missions = r[1], campaigns = r[2], events = r[3], dispatcher = r[4];
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
      // MOS-3B: capacity first, then the form. An operator about to start a
      // mission should see whether a slot exists before they type, and the
      // provider list in the form below is the dispatcher's, not ours.
      slot.appendChild(capacitySlot(dispatcher));
      slot.appendChild(startMissionSection(pending, dispatcher.ok ? dispatcher.data.providers : null,
        dispatcher.ok ? dispatcher.data.profiles : null, dispatcher.ok ? dispatcher.data.models : null));

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

      startPolling('command-center');
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

  // MOS-3B: the dispatcher's own capacity, stated in one line. running and
  // max_parallel are the executor's real ceiling; queued is what is waiting
  // behind it. A missing number renders as an em dash — the strip never
  // invents a figure, because "0 running" and "I cannot see what is
  // running" are different facts.
  function capacityStrip(d) {
    d = d || {};
    return el('div', { className: 'console-capacity' }, [
      el('span', { className: 'k', text: 'Executions running:' }),
      el('span', { className: 'v mythos-mono', text: countText(d.running) + ' / ' + countText(d.max_parallel) }),
      el('span', { attrs: { 'aria-hidden': 'true' }, text: '·' }),
      el('span', { className: 'k', text: 'queued:' }),
      el('span', { className: 'v mythos-mono', text: countText(d.queued) })
    ]);
  }

  function countText(n) {
    return n === null || n === undefined || isNaN(Number(n)) ? '—' : String(n);
  }

  // The strip and its failure share one call site, so no page can end up
  // rendering an empty strip where a failed read belongs.
  function capacitySlot(dispatcher) {
    return dispatcher.ok ? capacityStrip(dispatcher.data)
                         : upstreamFailure(dispatcher.err, 'the dispatcher');
  }

  function pendingRow(t) {
    return row([
      cellMain(t.stage || 'unstaged', t.task_id || ''),
      cellText('Provider', t.provider),
      cellText('Model', t.model || '(default)'),
      cellText('Priority', t.priority),
      el('div', { className: 'mythos-row-end' }, [badge(t.effective || t.status)])
    ]);
  }

  // A new mission: title + instruction + provider (+ optional model, +
  // optional execution profile, + priority). No other field exists
  // client-side to send — project, mode and requested_by are fixed
  // server-side in server.js and are never part of this payload. Feedback
  // renders inline; this file has no alert()/confirm() anywhere and this
  // does not start one.
  //
  // MOS-3B: `providers` is the list GET /api/dispatcher returned — the
  // server's own source of truth for what can actually run — or null when
  // that read failed. This function holds no provider knowledge at all:
  // no hardcoded enum, no per-provider label, no per-provider behaviour.
  // A provider added or withdrawn server-side changes this select with no
  // edit here, and a provider the console cannot confirm is never offered.
  //
  // MOS-v2 M-04: `profiles` is likewise the dispatcher's own list of
  // { name, authorized } — never a hardcoded enum here, and the browser
  // never computes authorization itself. An unauthorized profile (today,
  // only repo-write when MOS_ALLOW_REPO_WRITE is off) is rendered but
  // disabled, so an operator can see it exists without being able to pick
  // it — the option server.js would refuse anyway is never offered as if
  // it would work.
  //
  // MOS-v2 M-05: `models` is model-catalog.js's own enabledModels(), as
  // served by GET /api/dispatcher — { provider, id, label, capability,
  // recommended_task_types }, never a hardcoded list here and never a
  // disabled entry. There is no free-text model field any more: only a
  // model this server has already agreed to relay can be selected at
  // all. The select is repopulated whenever the provider changes, to the
  // subset of `models` whose provider matches, with a first option of
  // '(provider default)' (empty value) — omitting the field entirely, so
  // the server/provider's own default applies, same as before this stage.
  function startMissionSection(pending, providers, profiles, models) {
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
    var providerList = providers || [];
    var providerSelect = el('select', { className: 'mythos-input', attrs: { id: 'mission-provider' } },
      providerList.map(function (p) { return el('option', { attrs: { value: p }, text: String(p) }); }));
    var providerNote = null;
    if (!providerList.length) {
      providerSelect.disabled = true;
      providerNote = el('div', { className: 'mythos-row-sub',
        text: 'provider list unavailable — the control plane could not be read' });
    }
    var modelList = models || [];
    function modelOptionsFor(providerValue) {
      var opts = [el('option', { attrs: { value: '' }, text: '(provider default)' })];
      modelList.filter(function (m) { return m.provider === providerValue; }).forEach(function (m) {
        opts.push(el('option', { attrs: { value: m.id }, text: m.label + ' — ' + m.capability }));
      });
      return opts;
    }
    var modelSelect = el('select', { className: 'mythos-input', attrs: { id: 'mission-model' } },
      modelOptionsFor(providerList[0]));
    var modelNote = null;
    if (!modelList.length) {
      modelSelect.disabled = true;
      modelNote = el('div', { className: 'mythos-row-sub',
        text: 'model list unavailable — the control plane could not be read' });
    }
    // Repopulate the model select whenever the provider changes, to the
    // subset of `models` for the newly chosen provider — a model valid
    // for one provider is never left selectable under another.
    providerSelect.addEventListener('change', function () {
      clear(modelSelect);
      modelOptionsFor(providerSelect.value).forEach(function (opt) { modelSelect.appendChild(opt); });
    });

    var profileList = profiles || [];
    var profileSelect = el('select', { className: 'mythos-input', attrs: { id: 'mission-profile' } },
      profileList.map(function (p) {
        var opt = el('option', { attrs: { value: p.name }, text: p.name + (p.authorized ? '' : ' (not authorized)') });
        if (!p.authorized) opt.disabled = true;
        if (p.name === 'repo-read') opt.selected = true;
        return opt;
      }));
    var profileNote = null;
    if (!profileList.length) {
      profileSelect.disabled = true;
      profileNote = el('div', { className: 'mythos-row-sub',
        text: 'execution profile list unavailable — the control plane could not be read' });
    }

    // MOS-v2 M-06: priority is a fixed lifecycle vocabulary of the
    // executor (PRIORITY_WEIGHT — 'high'|'normal'|'low'), not a
    // server-authorized capability like provider/model/profile above, so a
    // hardcoded three-option list here is acceptable — there is nothing
    // server.js could withdraw or expand at this layer. Always sent
    // (never omitted) for explicitness, defaulting to 'normal'.
    var PRIORITY_OPTIONS = ['high', 'normal', 'low'];
    var prioritySelect = el('select', { className: 'mythos-input', attrs: { id: 'mission-priority' } },
      PRIORITY_OPTIONS.map(function (p) {
        var opt = el('option', { attrs: { value: p }, text: p });
        if (p === 'normal') opt.selected = true;
        return opt;
      }));

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
      // execution_profile is sent only when the operator actually picked
      // one from a populated, server-sourced list — never a client
      // default invented here. An empty/unavailable select sends nothing,
      // and the server's own 'repo-read' default applies.
      var chosenProfile = (profileList.length && profileSelect.value) ? profileSelect.value : undefined;
      postJSON('/api/missions/start', {
        title: title,
        instruction: instruction,
        provider: providerSelect.value,
        model: (modelList.length && modelSelect.value) ? modelSelect.value : undefined,
        execution_profile: chosenProfile,
        priority: prioritySelect.value
      }).then(function (r) {
        clear(feedback);
        // MOS-3B: the dispatcher is capacity-gated, so a created mission is
        // RUNNING or QUEUED, and the two are not the same news. The server's
        // own note (why it queued, against which ceiling) is shown verbatim
        // rather than paraphrased into a cheerier sentence.
        var d = r.data || {};
        var isRunning = String(d.status).toUpperCase() === 'RUNNING';
        feedback.appendChild(statePanel(
          isRunning ? '▶' : '◌',
          isRunning ? 'Mission started' : 'Mission queued',
          d.task_id + ' — ' + d.status + ' on ' + d.provider + (d.model ? ' (' + d.model + ')' : '') + '.' +
          (d.note ? ' ' + d.note + '.' : '') +
          ' It will appear under Missions once the next status refresh loads.'
        ));
        titleInput.value = ''; instructionInput.value = ''; modelSelect.value = '';
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
        el('div', {}, [el('label', { className: 'mythos-label', attrs: { for: 'mission-provider' }, text: 'Provider' }), providerSelect, providerNote]),
        el('div', {}, [el('label', { className: 'mythos-label', attrs: { for: 'mission-model' }, text: 'Model (optional)' }), modelSelect, modelNote]),
        el('div', {}, [el('label', { className: 'mythos-label', attrs: { for: 'mission-profile' }, text: 'Execution profile' }), profileSelect, profileNote]),
        el('div', {}, [el('label', { className: 'mythos-label', attrs: { for: 'mission-priority' }, text: 'Priority' }), prioritySelect])
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
        var dTask = detail.data.task || {};
        var dStatus = detail.data.status || {};
        detailSlot.appendChild(fact('Stage', dTask.stage || '—'));
        detailSlot.appendChild(fact('Instruction', dTask.instruction));
        detailSlot.appendChild(fact('Provider', dTask.provider || '—'));
        detailSlot.appendChild(fact('Model', dTask.model || '(default)'));
        detailSlot.appendChild(fact('Priority', dTask.priority || '—'));
        detailSlot.appendChild(fact('Execution profile', dTask.execution_profile || '—'));
        detailSlot.appendChild(fact('Status', dStatus.status || state));
        detailSlot.appendChild(fact('Execution ID', dStatus.execution_id || '(not started)'));
        detailSlot.appendChild(fact('Created', dTask.created_at ? stamp(dTask.created_at) : '—'));
        detailSlot.appendChild(fact('Started', dStatus.started_at ? stamp(dStatus.started_at) : '—'));
        detailSlot.appendChild(fact('Ended', dStatus.ended_at ? stamp(dStatus.ended_at) : '—'));
        detailSlot.appendChild(fact('Next action', dStatus.next_action));
        if (dStatus.last_error) detailSlot.appendChild(fact('Last error', dStatus.last_error));
        if (report && report.ok && report.data.summary) detailSlot.appendChild(fact('Result summary', report.data.summary));
        if (report && report.ok && report.data.next_stage) detailSlot.appendChild(fact('Next stage', report.data.next_stage));
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

    // MOS-3B: an explicit start for a task the daemon has not picked up
    // yet. The dispatcher is capacity-gated, so "I asked" and "it ran" are
    // two different outcomes and the button says which one happened rather
    // than claiming the optimistic one. Either way it stays disabled — the
    // task is already committed and asking twice would only race.
    var startNowBtn = null;
    if (state === 'QUEUED') {
      startNowBtn = el('button', { className: 'mythos-btn mythos-btn-outline', attrs: { type: 'button' }, text: 'Start now' });
      startNowBtn.addEventListener('click', function () {
        startNowBtn.disabled = true;
        startNowBtn.textContent = 'Starting…';
        postJSON('/api/missions/' + encodeURIComponent(t.task_id) + '/dispatch', {}).then(function (r) {
          var d = r.data || {};
          startNowBtn.textContent = d.dispatched ? 'Started'
                                  : d.queued ? 'Queued — at capacity'
                                  : 'Queued — start not confirmed';
        }).catch(function (e) {
          clear(detailSlot);
          detailSlot.appendChild(statePanel('⚠', 'Could not start now', e.message, true));
          startNowBtn.disabled = false;
          startNowBtn.textContent = 'Start now';
        });
      });
    }

    var actions = el('div', { className: 'mythos-exec-actions' }, [viewBtn, startNowBtn, cancelBtn]);

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

  // MOS-3B: the lifecycle, in the order an operator walks it — what has not
  // started, what is running, what is held up by a limit, what is held up
  // by the owner, and then the three terminal outcomes. The order is the
  // page; a flat newest-first list made the operator do this grouping in
  // their own head, every time they opened it.
  //
  // Pending and Running are always drawn, empty or not: those two answers
  // are the reason the page is opened, and an absent section reads as "not
  // loaded" rather than "none". Every other section is omitted when empty.
  var MISSION_GROUPS = [
    { title: 'Pending', states: ['QUEUED'], always: true,
      emptyTitle: 'No missions pending',
      emptyBody: 'Nothing is QUEUED right now — start one from the Command Center.' },
    { title: 'Running', states: ['RUNNING'], always: true,
      emptyTitle: 'Nothing running',
      emptyBody: 'The executor reports no mission in the RUNNING state.' },
    { title: 'Waiting', states: ['WAITING_FOR_QUOTA', 'WAITING_RETRY', 'INTERRUPTED'] },
    { title: 'Awaiting the owner', states: ['BLOCKED', 'WAITING_FOR_APPROVAL'] },
    { title: 'Completed', states: ['COMPLETED'] },
    { title: 'Failed', states: ['FAILED'] },
    { title: 'Cancelled', states: ['CANCELLED'] }
  ];

  function taskState(t) { return String(t.effective || t.status || 'UNKNOWN').toUpperCase(); }

  function isGroupedState(state) {
    return MISSION_GROUPS.some(function (g) { return g.states.indexOf(state) !== -1; });
  }

  function missionCards(tasks) {
    var list = el('div', { className: 'mythos-list' });
    tasks.forEach(function (t) { list.appendChild(executionCard(t)); });
    return list;
  }

  RENDERERS.missions = function (view) {
    view.appendChild(pageHeader('MISSIONS', 'Every executor task, grouped by where it stands in its lifecycle.'));
    var slot = el('div', {});
    view.appendChild(slot);

    Promise.all([
      api('/api/missions').catch(function (e) { return { ok: false, err: e }; }),
      api('/api/dispatcher').catch(function (e) { return { ok: false, err: e }; })
    ]).then(function (r) {
      var missions = r[0], dispatcher = r[1];
      clear(slot);
      slot.appendChild(capacitySlot(dispatcher));

      if (!missions.ok) { slot.appendChild(upstreamFailure(missions.err, 'the executor task API')); return; }

      var tasks = (missions.data.tasks || []).slice().sort(function (a, b) {
        return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
      });

      MISSION_GROUPS.forEach(function (g) {
        var members = tasks.filter(function (t) { return g.states.indexOf(taskState(t)) !== -1; });
        if (!members.length && !g.always) return;
        slot.appendChild(sectionTitle(g.title + ' · ' + members.length));
        slot.appendChild(members.length ? missionCards(members)
                                        : statePanel('◌', g.emptyTitle, g.emptyBody));
      });

      // A state this console has never heard of is a state the executor is
      // genuinely in. It is shown, badged as itself, rather than filtered
      // out of a page whose whole claim is that it lists every task.
      var other = tasks.filter(function (t) { return !isGroupedState(taskState(t)); });
      if (other.length) {
        slot.appendChild(sectionTitle('Other · ' + other.length));
        slot.appendChild(el('div', { className: 'mythos-card-meta',
          text: 'States this console has no lifecycle group for, shown exactly as the executor reports them.' }));
        slot.appendChild(missionCards(other));
      }

      startPolling('missions');
    });
  };

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

  // Ending a session is a server-side act: POST /api/logout destroys the
  // session entry and clears the cookie. Clearing the cookie in the
  // browser alone would leave a live session behind for anyone holding a
  // copy of the identifier -- and this script cannot read the cookie in
  // the first place, which is the point.
  function signOut() {
    var button = document.getElementById('signout');
    if (!button) return;
    button.addEventListener('click', function () {
      button.disabled = true;
      fetch('/api/logout', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: '{}'
      }).catch(function () { /* the redirect below is correct either way */ })
        .then(function () { location.replace('/login'); });
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

  // ---------------------------------------------------------------
  // Auto-refresh (MOS-3B)
  //
  // The lifecycle pages go stale the moment they are drawn: a mission
  // starts, a slot frees, a run ends. Until now the only way to see that
  // was F5, which is also the fastest way to lose a half-typed mission.
  // So the poller re-renders in place, and refuses to run at all whenever
  // a re-render would destroy something the operator is holding. Every
  // guard below is a thing the operator would have lost. A skipped cycle
  // costs twelve seconds; a destroyed one costs their work.
  // ---------------------------------------------------------------

  var POLL_TIMER = null;
  var POLL_MS = 12000;

  function stopPolling() {
    if (POLL_TIMER) { clearInterval(POLL_TIMER); POLL_TIMER = null; }
  }

  function startPolling(moduleId) {
    stopPolling();
    POLL_TIMER = setInterval(function () {
      if (!canRefresh()) return;              // skipped silently — see canRefresh
      var mod = registry.byId(moduleId);
      if (!mod) return;
      renderModule(mod);
    }, POLL_MS);
  }

  function canRefresh() {
    // (a) A background tab has no operator watching it. Re-rendering it
    //     buys nothing and keeps polling the control plane for no reader.
    if (document.hidden) return false;

    // (b) Focus inside a field in #view means someone is typing into a
    //     node this refresh is about to remove. Their caret, selection and
    //     unsent text would all go with it.
    var active = document.activeElement;
    if (active && viewEl.contains(active) &&
        ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(active.tagName) !== -1) return false;

    // (c) An open detail panel is a deliberate act — the operator asked for
    //     that execution's instruction, error or report and is reading it.
    //     A refresh would collapse it with no warning and no way back to
    //     the same scroll position.
    var details = document.querySelectorAll('.mythos-exec-detail');
    for (var i = 0; i < details.length; i++) {
      if (details[i].firstChild) return false;
    }

    // (d) A half-written mission is unsaved work that exists nowhere else.
    //     Not focused is not the same as not started: the operator may be
    //     reading the page, or copying text from another window, with a
    //     drafted title and instruction already in the form.
    var titleInput = document.getElementById('mission-title');
    var instructionInput = document.getElementById('mission-instruction');
    if (titleInput && titleInput.value !== '') return false;
    if (instructionInput && instructionInput.value !== '') return false;

    return true;
  }

  // The one place a module is painted into #view. route() and the
  // auto-refresh poller both go through it, so a refresh cannot drift from
  // what a real navigation would have drawn. Focus and the connection strip
  // stay in route(): a poll must not move the operator's focus.
  function renderModule(mod) {
    clear(viewEl);
    var renderer = mod.state === 'live' ? RENDERERS[mod.id] : null;
    if (renderer) {
      renderer(viewEl);
    } else {
      viewEl.appendChild(pageHeader(mod.label.toUpperCase(), mod.summary));
      viewEl.appendChild(notBuilt(mod));
    }
  }

  function route() {
    // MOS-3B: a poller belongs to the module that started it. Leaving one
    // running across a route change would repaint #view with the previous
    // module's content.
    stopPolling();

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
    renderModule(mod);
    viewEl.focus();
    refreshLink();
  }

  window.addEventListener('hashchange', route);
  route();
  identity();
  signOut();
  setInterval(refreshLink, 60000);
}());
