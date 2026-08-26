'use strict';
// =====================================================
// OTHMODE — platform screens
// projects/command-center/reference/web/othmode.js
//
// Loaded after app.js; registers the OTHMODE navigation and screens
// through window.MccApp. Same discipline as app.js: no innerHTML, no
// eval, every dynamic string through textContent. All new screens are
// read models plus a few token-gated writes; nothing here can touch a
// command's rendering path or execute anything.
// =====================================================

(function () {
  var A = window.MccApp;
  var t = window.MccI18n.t;
  if (!A) return;

  var el = A.el;

  // ── shared helpers ────────────────────────────────────────────────────

  function pageHead(titleKey, subKey) {
    return el('div.page-head', {}, [
      el('h1.page-title', { text: t(titleKey) }),
      subKey ? el('p.page-sub', { text: t(subKey) }) : null
    ]);
  }

  function loadingView(titleKey, subKey) {
    A.mount(el('div', {}, [pageHead(titleKey, subKey), el('div.loading', { text: t('oth.common.loading') })]));
  }

  function errorView(titleKey, subKey, err) {
    var needsAuth = err && err.status === 401;
    A.mount(el('div', {}, [
      pageHead(titleKey, subKey),
      el('div.callout.' + (needsAuth ? 'callout-warn' : 'callout-danger'), {}, [
        el('span', { text: needsAuth ? t('oth.common.auth_needed') : t('oth.common.error') })
      ]),
      needsAuth ? el('button.btn.btn-primary', {
        type: 'button', text: t('auth.title'),
        onclick: function () { A.openAuthDialog(); }
      }) : el('button.btn', {
        type: 'button', text: t('oth.common.refresh'),
        onclick: function () { A.rerender(); }
      })
    ]));
  }

  function emptyState(msgKey) {
    return el('div.empty', { text: t(msgKey) });
  }

  function stateChip(state) {
    var key = 'oth.state.' + state;
    var label = t(key) === key ? state : t(key);
    return el('span.badge.oth-state.oth-state-' + String(state).toLowerCase(), { text: label });
  }

  function table(headers, rows) {
    var thead = el('thead', {}, [el('tr', {}, headers.map(function (h) { return el('th', { text: h }); }))]);
    var tbody = el('tbody', {}, rows.map(function (cells) {
      return el('tr', {}, cells.map(function (c) {
        return el('td', {}, [typeof c === 'object' && c !== null ? c : document.createTextNode(String(c == null ? '—' : c))]);
      }));
    }));
    return el('div.tablewrap', {}, [el('table.oth-table', {}, [thead, tbody])]);
  }

  function fmtDuration(ms) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return ms + ' ms';
    if (ms < 60000) return Math.round(ms / 1000) + ' s';
    return Math.round(ms / 60000) + ' min';
  }

  // ── Sidebar (grouped OTHMODE navigation) ──────────────────────────────

  A.registerSidebar(function (sidebar, h) {
    function item(labelKey, hash, routeName) {
      return el('button.nav-item', {
        type: 'button',
        'aria-current': A.state.route.name === routeName ? 'page' : null,
        onclick: function () { h.navigate(hash); }
      }, [el('span', { text: t(labelKey) })]);
    }
    function group(labelKey, items) {
      return el('div.sidebar-group', {}, [el('div.sidebar-label', { text: t(labelKey) })].concat(items));
    }
    sidebar.appendChild(group('oth.group.overview', [
      item('nav.dashboard', '#/', 'dashboard')
    ]));
    sidebar.appendChild(group('oth.group.library', [
      item('nav.library', '#/library', 'library'),
      item('oth.nav.saved', '#/saved', 'saved'),
      item('nav.workflows', '#/workflows', 'workflows')
    ]));
    sidebar.appendChild(group('oth.group.capabilities', [
      item('oth.nav.skills', '#/skills', 'skills'),
      item('oth.nav.tools', '#/tools', 'tools'),
      item('oth.nav.providers', '#/providers', 'providers')
    ]));
    sidebar.appendChild(group('oth.group.operations', [
      item('oth.nav.projects', '#/projects', 'projects'),
      item('oth.nav.health', '#/health', 'health'),
      item('oth.nav.status', '#/status', 'status'),
      item('oth.nav.history', '#/history', 'history')
    ]));
    sidebar.appendChild(group('oth.group.intelligence', [
      item('oth.nav.memory', '#/memory', 'memory'),
      item('oth.nav.evolution', '#/evolution', 'evolution')
    ]));
    sidebar.appendChild(group('oth.group.system', [
      item('nav.statistics', '#/stats', 'statistics'),
      item('oth.nav.settings', '#/settings', 'settings')
    ]));
    sidebar.appendChild(el('div.sidebar-group', {}, [
      el('div.sidebar-label', { text: t('shortcuts.title') }),
      h.shortcutRow('/', t('shortcuts.search')),
      h.shortcutRow('c', t('shortcuts.copy')),
      h.shortcutRow('esc', t('shortcuts.close'))
    ]));
  });

  // ── Dashboard extras: OthMode pill + health strip + open reviews ──────

  A.registerDashboardExtras(function () {
    var strip = el('div.oth-dash-strip');

    var modeCard = el('button.oth-dash-card', {
      type: 'button', onclick: function () { A.navigate('#/settings'); }
    }, [el('span.oth-dash-label', { text: t('oth.dash.mode') }), el('span.oth-dash-value', { text: '…' })]);
    var healthCard = el('button.oth-dash-card', {
      type: 'button', onclick: function () { A.navigate('#/health'); }
    }, [el('span.oth-dash-label', { text: t('oth.dash.health') }), el('span.oth-dash-value', { text: '…' })]);
    var reviewCard = el('button.oth-dash-card', {
      type: 'button', onclick: function () { A.navigate('#/evolution'); }
    }, [el('span.oth-dash-label', { text: t('oth.dash.reviews') }), el('span.oth-dash-value', { text: '…' })]);

    strip.appendChild(modeCard);
    strip.appendChild(healthCard);
    strip.appendChild(reviewCard);

    A.api('/othmode/mode').then(function (m) {
      // Availability report, not a state: always READY by design.
      modeCard.lastChild.textContent = m.status === 'READY' ? t('oth.mode.ready') : '—';
      modeCard.classList.add('is-on');
    }).catch(function () { modeCard.lastChild.textContent = '—'; });

    A.api('/othmode/health').then(function (hv) {
      var act = hv.counts.ACTIVE || 0;
      modeCardNoop();
      healthCard.lastChild.textContent = act + ' / ' + hv.total + ' ' + t('oth.state.ACTIVE');
      if ((hv.counts.FAILED || 0) > 0) healthCard.classList.add('is-bad');
      else if ((hv.counts.DEGRADED || 0) > 0 || (hv.counts.BLOCKED || 0) > 0) healthCard.classList.add('is-warn');
    }).catch(function () { healthCard.lastChild.textContent = '—'; });

    function modeCardNoop() { /* layout hook kept deliberately inert */ }

    if (A.state.identity) {
      A.api('/othmode/evolution/events').then(function (ev) {
        var open = (ev.events || []).filter(function (e) {
          return !e.terminal && (e.risk_tier !== 'LOW') && e.review_decision !== 'APPROVED' && e.review_decision !== 'REJECTED';
        }).length;
        reviewCard.lastChild.textContent = String(open);
      }).catch(function () { reviewCard.lastChild.textContent = '—'; });
    } else {
      reviewCard.lastChild.textContent = '—';
    }

    return strip;
  });

  // ── Screens ───────────────────────────────────────────────────────────

  function renderSaved() {
    loadingView('oth.nav.saved', null);
    Promise.all([
      A.api('/commands?favorite=true&sort=favorite&limit=100'),
      A.api('/notes?limit=100')
    ]).then(function (r) {
      var favorites = r[0], notes = r[1];
      A.mount(el('div', {}, [
        pageHead('oth.nav.saved', null),
        A.section('section.favorites', favorites.commands.length ? A.cardGrid(favorites.commands) : emptyState('section.empty')),
        A.section('notes.title', notes.notes.length
          ? el('div', {}, notes.notes.map(function (note) {
              return el('div.note-item', {}, [
                el('h3.note-title', { text: note.title }),
                el('p.note-body', { text: note.content }),
                el('div.note-meta', {}, [
                  el('span', { text: A.formatDate(note.updated_at) }),
                  note.command_slug ? el('button.btn.btn-sm.btn-ghost', {
                    type: 'button', text: note.command_title || note.command_slug,
                    onclick: function () { A.navigate('#/command/' + encodeURIComponent(note.command_slug)); }
                  }) : null
                ])
              ]);
            }))
          : emptyState('notes.empty'))
      ]));
    }).catch(function (err) { errorView('oth.nav.saved', null, err); });
  }

  function renderSkills() {
    loadingView('oth.skills.title', 'oth.skills.sub');
    A.api('/othmode/skills').then(function (data) {
      A.mount(el('div', {}, [
        pageHead('oth.skills.title', 'oth.skills.sub'),
        data.skills.length ? table(
          [t('field.title'), t('oth.skills.registry'), t('field.version'), t('field.status'), t('field.description')],
          data.skills.map(function (s) {
            return [
              el('button.btn.btn-sm.btn-ghost.mono', {
                type: 'button', text: s.id,
                onclick: function () { A.navigate('#/skills/' + encodeURIComponent(s.id)); }
              }),
              s.registry,
              s.version || '—',
              stateChip(s.status),
              el('span.oth-cell-wrap', { text: s.description || '—' })
            ];
          })
        ) : emptyState('oth.skills.empty')
      ]));
    }).catch(function (err) { errorView('oth.skills.title', 'oth.skills.sub', err); });
  }

  function renderSkillDetail(id) {
    loadingView('oth.skills.title', null);
    A.api('/othmode/skills/' + encodeURIComponent(id)).then(function (data) {
      var s = data.skill;
      A.mount(el('div.detail', {}, [
        el('button.btn.btn-sm.btn-ghost', { type: 'button', text: '← ' + t('action.back'), onclick: function () { A.navigate('#/skills'); } }),
        el('div.detail-head', {}, [
          el('h1.detail-title', { text: s.id }),
          el('div.detail-badges', {}, [
            el('span.badge', { text: s.registry }),
            s.version ? el('span.badge', { text: 'v' + s.version }) : null,
            stateChip(s.status)
          ])
        ]),
        s.description ? el('p.detail-desc', { text: s.description }) : null,
        el('p.field-hint', { text: s.source_path }),
        s.body ? el('div.detail-block', {}, [el('pre.command-body', { text: s.body })]) : emptyState('section.empty')
      ]));
    }).catch(function (err) { errorView('oth.skills.title', null, err); });
  }

  function renderTools() {
    loadingView('oth.tools.title', 'oth.tools.sub');
    A.api('/othmode/tools').then(function (data) {
      A.mount(el('div', {}, [
        pageHead('oth.tools.title', 'oth.tools.sub'),
        data.tools.length ? table(
          [t('field.title'), t('oth.tools.policy'), t('oth.tools.risk'), 'Provider', t('oth.skills.registry')],
          data.tools.map(function (tool) {
            return [
              el('span.mono', { text: tool.id }),
              tool.policy_class || '—',
              tool.risk || '—',
              tool.provider || '—',
              tool.source
            ];
          })
        ) : emptyState('oth.tools.empty')
      ]));
    }).catch(function (err) { errorView('oth.tools.title', 'oth.tools.sub', err); });
  }

  function renderProviders() {
    loadingView('oth.providers.title', 'oth.providers.sub');
    A.api('/othmode/providers').then(function (data) {
      var cards = el('div.card-grid');
      data.providers.forEach(function (p) {
        cards.appendChild(el('article.command-card', {}, [
          el('div.card-top', {}, [
            el('h3.card-title', { text: p.id }),
            p.primary ? el('span.badge.badge-category', { text: t('oth.providers.primary') }) : null
          ]),
          el('div.card-meta', {}, [
            el('span.badge.' + (p.execution_authority ? 'badge-safety-DESTRUCTIVE' : 'badge-safety-READ_ONLY'), {
              text: t(p.execution_authority ? 'oth.providers.exec_authority' : 'oth.providers.advisory')
            }),
            stateChip(p.enabled ? 'ACTIVE' : 'DISABLED')
          ]),
          el('p.card-desc', {
            text: p.credential_present === null ? t('oth.providers.credential_unknown')
              : (p.credential_present ? t('oth.providers.credential_present') : t('oth.providers.credential_absent'))
          }),
          p.note ? el('p.field-hint', { text: p.note }) : null
        ]));
      });
      A.mount(el('div', {}, [
        pageHead('oth.providers.title', 'oth.providers.sub'),
        data.providers.length ? cards : emptyState('oth.providers.empty'),
        data.routing ? el('div.detail-block', {}, [
          el('h2.block-title', { text: t('oth.providers.routing') }),
          el('div.callout.callout-info', { text: t('oth.providers.routing_rule') })
        ]) : null
      ]));
    }).catch(function (err) { errorView('oth.providers.title', 'oth.providers.sub', err); });
  }

  function renderProjects() {
    loadingView('oth.projects.title', 'oth.projects.sub');
    A.api('/othmode/projects').then(function (data) {
      A.mount(el('div', {}, [
        pageHead('oth.projects.title', 'oth.projects.sub'),
        data.projects.length ? table(
          [t('field.title'), t('field.status'), t('oth.projects.stage'), t('oth.projects.next')],
          data.projects.map(function (p) {
            return [
              el('span.mono', { text: p.id }),
              p.implementation_status ? el('span.badge', { text: p.implementation_status }) : '—',
              el('span.oth-cell-wrap', { text: p.current_stage || '—' }),
              el('span.oth-cell-wrap', { text: p.next_stage || '—' })
            ];
          })
        ) : emptyState('oth.projects.empty')
      ]));
    }).catch(function (err) { errorView('oth.projects.title', 'oth.projects.sub', err); });
  }

  function renderHealth() {
    loadingView('oth.health.title', 'oth.health.sub');
    A.api('/othmode/health').then(function (data) {
      var recovery = data.recovery && data.recovery.incidents ? data.recovery.incidents : [];
      A.mount(el('div', {}, [
        pageHead('oth.health.title', 'oth.health.sub'),
        data.monitor && !data.monitor.available ? el('div.callout.callout-warn', { text: t('oth.health.monitor_unavailable') }) : null,
        data.components.length ? table(
          [t('field.title'), t('field.category'), t('field.status'), t('field.description')],
          data.components.map(function (c) {
            return [
              el('span.mono', { text: c.name }),
              c.kind,
              stateChip(c.state),
              el('span.oth-cell-wrap', { text: c.detail || (c.latency_ms !== null ? c.latency_ms + ' ms' : '—') })
            ];
          })
        ) : emptyState('oth.health.empty'),
        el('div.detail-block', {}, [
          el('h2.block-title', { text: t('oth.health.recovery') }),
          recovery.length ? el('div', {}, recovery.map(function (inc) {
            return el('div.note-item', {}, [
              el('h3.note-title', { text: inc.component + ' — ' + inc.incident }),
              el('div.oth-stage-row', {}, ['DETECT', 'NOTIFY', 'SEARCH', 'COMPARE', 'SELECT', 'REPLACE', 'TEST', 'UPDATE_STATUS'].map(function (step) {
                var done = inc.steps.some(function (s) { return s.step === step; });
                var current = inc.current_step === step;
                return el('span.oth-stage' + (current ? '.is-now' : (done ? '.is-done' : '')), { text: step.replace('_', ' ') });
              })),
              inc.state ? el('div.note-meta', {}, [stateChip(inc.state)]) : null
            ]);
          })) : emptyState('oth.health.recovery_none')
        ])
      ]));
    }).catch(function (err) { errorView('oth.health.title', 'oth.health.sub', err); });
  }

  function renderStatus() {
    loadingView('oth.status.title', 'oth.status.sub');
    A.api('/othmode/status').then(function (data) {
      A.mount(el('div', {}, [
        pageHead('oth.status.title', 'oth.status.sub'),
        el('div.callout.callout-info', { text: data.authority }),
        data.available && data.current ? el('div.detail-block', {}, [
          el('h2.block-title', { text: data.current.review_id || '—' }),
          el('p.prose', { text: (data.current.timestamp || '') }),
          data.current.head ? el('p.field-hint', { text: 'HEAD ' + data.current.head + (data.current.branch ? ' · ' + data.current.branch : '') }) : null
        ]) : el('div.callout.callout-warn', { text: t('oth.status.unavailable') }),
        el('a.btn.btn-primary', { href: data.link, target: '_blank', rel: 'noopener', text: t('oth.status.open') + ' ↗' })
      ]));
    }).catch(function (err) { errorView('oth.status.title', 'oth.status.sub', err); });
  }

  function renderHistory(segments, params) {
    // #/history/task/<id> — one OTHMODE Task Report, opened from the list.
    if (segments[1] === 'task' && segments[2]) {
      return renderTaskDetail(decodeURIComponent(segments[2]));
    }
    loadingView('oth.history.title', 'oth.history.sub');
    var qs = [];
    ['source', 'status', 'project', 'q'].forEach(function (k) {
      if (params && params[k]) qs.push(k + '=' + encodeURIComponent(params[k]));
    });
    A.api('/othmode/history' + (qs.length ? '?' + qs.join('&') : '')).then(function (data) {
      var sourceNotes = [];
      Object.keys(data.sources).forEach(function (s) {
        if (data.sources[s] !== 'loaded') sourceNotes.push(s + ': ' + data.sources[s]);
      });
      function filterSelect() {
        var select = el('select', {
          'aria-label': t('oth.history.source'),
          onchange: function () {
            A.navigate('#/history' + (select.value ? '?source=' + select.value : ''));
          }
        });
        [['', t('oth.history.source')], ['othmode', 'othmode'], ['library', 'library'], ['executor', 'executor'], ['orchestrator', 'orchestrator']].forEach(function (o) {
          select.appendChild(el('option', { value: o[0], text: o[1], selected: (params && params.source || '') === o[0] }));
        });
        return select;
      }
      A.mount(el('div', {}, [
        pageHead('oth.history.title', 'oth.history.sub'),
        sourceNotes.length ? el('div.callout.callout-warn', { text: sourceNotes.join(' · ') }) : null,
        el('div.filter-bar', {}, [filterSelect()]),
        data.rows.length ? table(
          [t('field.body'), t('oth.history.source'), t('meta.created'), t('oth.history.duration'), t('field.status'), t('oth.history.result'), t('oth.history.next_action')],
          data.rows.map(function (r) {
            // An OTHMODE task row opens its full persistent report.
            var commandCell = r.source === 'othmode'
              ? el('button.btn.btn-sm.btn-ghost.mono.oth-cell-wrap', {
                  type: 'button', text: r.command_ref + ' · ' + r.command,
                  onclick: function () { A.navigate('#/history/task/' + encodeURIComponent(r.command_ref)); }
                })
              : el('span.mono.oth-cell-wrap', { text: r.command });
            return [
              commandCell,
              r.source,
              r.timestamp ? A.formatDateTime(r.timestamp) : '—',
              fmtDuration(r.duration_ms),
              el('span.badge', { text: r.status }),
              el('span.oth-cell-wrap', { text: r.result || '—' }),
              el('span.oth-cell-wrap', { text: r.next_action || '—' })
            ];
          })
        ) : emptyState('oth.history.empty')
      ]));
    }).catch(function (err) { errorView('oth.history.title', 'oth.history.sub', err); });
  }

  // One OTHMODE Task Report: the summary is immediately readable (status,
  // lifecycle, result, next action); the technical sections open
  // progressively below it. All text through textContent, as everywhere.
  function renderTaskDetail(id) {
    loadingView('oth.task.title', null);
    A.api('/othmode/tasks/' + encodeURIComponent(id)).then(function (data) {
      var task = data.task;
      var lifecycle = ['PREFLIGHT', 'SEARCH', 'PLAN', 'EXECUTION', 'VALIDATION', 'DEPLOYMENT', 'VERIFICATION', 'COMPLETED'];
      var reached = lifecycle.indexOf(task.phase);
      var stopped = task.terminal && task.status !== 'COMPLETED';

      var outcome = task.sections && task.sections.outcome;
      var result = typeof outcome === 'string' ? outcome
        : (outcome && (outcome.final_result || outcome.result)) || null;
      var nextAction = outcome && typeof outcome === 'object' ? (outcome.next_action || null) : null;

      var sectionBlocks = [];
      Object.keys(task.sections || {}).forEach(function (key, idx) {
        var value = task.sections[key];
        var body = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        var labelKey = 'oth.task.sec.' + key;
        var label = t(labelKey) === labelKey ? key.replace(/_/g, ' ') : t(labelKey);
        sectionBlocks.push(el('details.oth-task-section', { open: idx === 0 ? 'open' : null }, [
          el('summary', { text: label }),
          el('pre.command-body', { text: body })
        ]));
      });

      A.mount(el('div.detail', {}, [
        el('button.btn.btn-sm.btn-ghost', { type: 'button', text: '← ' + t('action.back'), onclick: function () { A.navigate('#/history'); } }),
        el('div.detail-head', {}, [
          el('h1.detail-title.mono', { text: task.id }),
          el('div.detail-badges', {}, [
            stateChip(task.status),
            el('span.badge', { text: t('oth.task.phase') + ': ' + task.phase }),
            task.evolution_ref ? el('span.badge.mono', { text: 'evolution: ' + task.evolution_ref } ) : null
          ])
        ]),
        el('pre.command-body', { text: task.command }),
        el('div.note-meta', {}, [
          el('span', { text: task.started_at ? A.formatDateTime(task.started_at) : '—' }),
          el('span', { text: fmtDuration(task.duration_ms) }),
          el('span', { text: task.actor || '—' }),
          task.project ? el('span.mono', { text: task.project }) : null
        ]),
        el('div.oth-stage-row', {}, lifecycle.map(function (name, i) {
          var cls = '';
          if (reached >= 0 && i <= reached) cls = (stopped && i === reached) ? '.is-stop' : '.is-done';
          if (stopped && i === (reached >= 0 ? reached : 0)) cls = '.is-stop';
          return el('span.oth-stage' + cls, { text: name });
        })),
        el('div.detail-block', {}, [
          el('h2.block-title', { text: t('oth.task.result') }),
          el('p.prose', { text: result || '—' }),
          nextAction ? el('h2.block-title', { text: t('oth.history.next_action') }) : null,
          nextAction ? el('p.prose', { text: nextAction }) : null
        ]),
        el('div.detail-block', {}, [
          el('h2.block-title', { text: t('oth.task.sections') })
        ].concat(sectionBlocks.length ? sectionBlocks : [emptyState('section.empty')]))
      ]));
    }).catch(function (err) { errorView('oth.task.title', null, err); });
  }

  function renderMemory(segments, params) {
    loadingView('oth.memory.title', 'oth.memory.sub');
    var q = params && params.q ? params.q : '';

    function searchBox() {
      var input = el('input', { type: 'text', value: q, placeholder: t('oth.memory.search') });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          A.navigate('#/memory' + (input.value.trim() ? '?q=' + encodeURIComponent(input.value.trim()) : ''));
        }
      });
      return el('div.filter-bar', {}, [input]);
    }

    A.api('/othmode/memory/status').then(function (status) {
      if (!status.enabled) {
        A.mount(el('div', {}, [
          pageHead('oth.memory.title', 'oth.memory.sub'),
          el('div.callout.callout-warn', {}, [
            el('strong', { text: t('oth.memory.disabled') + ' ' }),
            el('span', { text: status.reason || '' })
          ])
        ]));
        return null;
      }
      if (!q) {
        A.mount(el('div', {}, [pageHead('oth.memory.title', 'oth.memory.sub'), searchBox()]));
        return null;
      }
      return A.api('/othmode/memory/search?q=' + encodeURIComponent(q)).then(function (data) {
        var hits = data.hits || [];
        A.mount(el('div', {}, [
          pageHead('oth.memory.title', 'oth.memory.sub'),
          searchBox(),
          data.reason ? el('div.callout.callout-warn', { text: data.reason }) : null,
          hits.length ? el('div.card-grid', {}, hits.map(function (h) {
            return el('article.command-card', {}, [
              el('div.card-top', {}, [el('h3.card-title', { text: h.title || h.id || '—' })]),
              h.text ? el('p.card-desc', { text: h.text }) : null,
              el('div.card-meta', {}, [
                h.kind ? el('span.badge', { text: h.kind }) : null,
                h.source_class ? el('span.badge.badge-category', { text: h.source_class }) : null
              ].concat((h.tags || []).slice(0, 4).map(function (tag) { return el('span.badge', { text: '#' + tag }); })))
            ]);
          })) : emptyState('oth.memory.empty')
        ]));
      });
    }).catch(function (err) { errorView('oth.memory.title', 'oth.memory.sub', err); });
  }

  // ── Evolution (one screen, seven tabs) ────────────────────────────────

  function renderEvolution(segments) {
    var tab = segments[1] || 'events';
    loadingView('oth.evo.title', 'oth.evo.sub');

    function tabs() {
      var bar = el('div.oth-tabs');
      ['events', 'genes', 'capsules', 'signals', 'review', 'validation', 'rollback'].forEach(function (name) {
        bar.appendChild(el('button.oth-tab' + (name === tab ? '.is-active' : ''), {
          type: 'button', text: t('oth.evo.tab.' + name),
          onclick: function () { A.navigate('#/evolution/' + name); }
        }));
      });
      return bar;
    }

    function shell(content) {
      A.mount(el('div', {}, [pageHead('oth.evo.title', 'oth.evo.sub'), tabs(), content]));
    }

    function notProvisioned(reason) {
      shell(el('div.callout.callout-warn', {}, [
        el('strong', { text: t('oth.evo.not_provisioned') + ' ' }),
        el('span', { text: reason || '' })
      ]));
    }

    function stageRow(ev) {
      var row = el('div.oth-stage-row');
      ['TRIGGER', 'SIGNAL', 'CANDIDATE', 'SELECTION', 'REVIEW', 'VALIDATION', 'RESULT'].forEach(function (name) {
        var found = ev.stages.filter(function (s) { return s.stage === name; })[0];
        var cls = '';
        if (found) {
          if (name === 'RESULT') cls = /FAIL|REJECT|ROLL/i.test(String(found.data.outcome || '')) ? '.is-stop' : '.is-done';
          else if (name === 'VALIDATION') cls = found.data.result === 'FAIL' ? '.is-stop' : '.is-done';
          else if (name === 'REVIEW') cls = found.data.decision === 'REJECTED' ? '.is-stop' : '.is-done';
          else cls = '.is-done';
        }
        var label = name;
        if (found && name === 'SELECTION' && found.data.verdict) label = 'SELECTION: ' + found.data.verdict;
        if (found && name === 'REVIEW' && found.data.decision) label = 'REVIEW: ' + found.data.decision;
        if (found && name === 'VALIDATION' && found.data.result) label = 'VALIDATION: ' + found.data.result;
        if (found && name === 'RESULT' && found.data.outcome) label = 'RESULT: ' + found.data.outcome;
        row.appendChild(el('span.oth-stage' + cls, { text: label }));
      });
      return row;
    }

    if (tab === 'events' || tab === 'review' || tab === 'validation' || tab === 'rollback') {
      A.api('/othmode/evolution/' + (tab === 'rollback' ? 'rollback' : 'events')).then(function (data) {
        if (data.provisioned === false) return notProvisioned(data.reason);

        if (tab === 'rollback') {
          var entries = data.entries || [];
          return shell(el('div', {}, [
            el('div.callout.callout-info', { text: t('oth.evo.rollback_rule') }),
            entries.length ? table(['Event', t('field.title'), 'Rollback point', t('oth.history.result')],
              entries.map(function (e) {
                return [el('span.mono', { text: e.event_id }), e.title,
                  el('span.mono', { text: e.rollback_point || '—' }),
                  e.rolled_back ? stateChip('FAILED') : (e.outcome || '—')];
              })) : emptyState('oth.evo.rollback_empty')
          ]));
        }

        var events = data.events || [];
        if (tab === 'review') {
          events = events.filter(function (e) { return !e.terminal && e.risk_tier !== 'LOW' && !e.review_decision; });
          return shell(el('div', {}, [
            el('div.callout.callout-warn', { text: t('oth.evo.review_rule') }),
            events.length ? el('div', {}, events.map(eventCard)) : emptyState('oth.evo.review_empty')
          ]));
        }
        if (tab === 'validation') {
          events = events.filter(function (e) { return e.validation_result; });
          return shell(events.length ? table(['Event', t('field.title'), t('oth.evo.risk'), t('oth.history.result')],
            events.map(function (e) {
              return [el('span.mono', { text: e.id }), e.title, e.risk_tier,
                el('span.badge.' + (e.validation_result === 'PASS' ? 'badge-safety-SAFE' : 'badge-safety-DESTRUCTIVE'), { text: e.validation_result })];
            })) : emptyState('oth.evo.validation_empty'));
        }
        return shell(events.length ? el('div', {}, events.map(eventCard)) : emptyState('oth.evo.events_empty'));

        function eventCard(ev) {
          return el('div.note-item', {}, [
            el('h3.note-title', { text: ev.title }),
            el('div.card-meta', {}, [
              el('span.badge', { text: t('oth.evo.risk') + ': ' + ev.risk_tier }),
              ev.gene_type ? el('span.badge', { text: ev.gene_type }) : null,
              el('span.badge.mono', { text: ev.id })
            ]),
            stageRow(ev),
            ev.rollback_point ? el('p.field-hint', { text: 'rollback: ' + ev.rollback_point }) : null
          ]);
        }
      }).catch(function (err) { errorView('oth.evo.title', 'oth.evo.sub', err); });
      return;
    }

    if (tab === 'signals') {
      A.api('/othmode/evolution/signals').then(function (data) {
        if (data.provisioned === false) return notProvisioned(data.reason);
        var signals = data.signals || [];
        shell(signals.length ? table(
          [t('field.description'), t('oth.history.source'), t('oth.evo.occurrences'), t('oth.evo.disposition')],
          signals.map(function (s) {
            return [el('span.oth-cell-wrap', { text: s.description }), s.source, String(s.occurrences),
              el('span.badge', { text: s.disposition })];
          })
        ) : emptyState('oth.evo.signals_empty'));
      }).catch(function (err) { errorView('oth.evo.title', 'oth.evo.sub', err); });
      return;
    }

    // genes / capsules — Git-stored artifacts
    A.api('/othmode/evolution/' + tab).then(function (data) {
      var rows = data[tab] || [];
      if (tab === 'genes') {
        shell(rows.length ? table(
          ['ID', t('field.category'), t('field.version'), t('field.status')],
          rows.map(function (g) {
            return [el('span.mono', { text: g.id }), g.type || '—', g.version || '—', stateChip(g.status || 'DRAFT')];
          })
        ) : emptyState('oth.evo.genes_empty'));
      } else {
        shell(rows.length ? table(
          ['ID', t('field.version'), t('oth.evo.tab.validation'), t('oth.evo.tab.review'), t('field.status')],
          rows.map(function (c) {
            return [el('span.mono', { text: c.id }), c.version || '—', c.validation || '—', c.review || '—', stateChip(c.status)];
          })
        ) : emptyState('oth.evo.capsules_empty'));
      }
    }).catch(function (err) { errorView('oth.evo.title', 'oth.evo.sub', err); });
  }

  // ── Settings ──────────────────────────────────────────────────────────

  function renderSettings() {
    loadingView('oth.settings.title', 'oth.settings.sub');
    Promise.all([
      A.api('/othmode/mode'),
      A.api('/othmode/oss-registry').catch(function () { return { records: [] }; })
    ]).then(function (r) {
      var oss = r[1];

      // No switch, no toggle, no hidden state: OTHMODE is always
      // available, and one Claude command activates it by containing the
      // standalone keyword "othmode". This block only STATES that rule.
      A.mount(el('div', {}, [
        pageHead('oth.settings.title', 'oth.settings.sub'),
        el('div.detail-block', {}, [
          el('h2.block-title', { text: 'OTHMODE' }),
          el('div.card-meta', {}, [
            el('span.badge.badge-safety-SAFE', { text: t('oth.mode.ready') })
          ]),
          el('p.prose', { text: t('oth.mode.always_hint') }),
          el('pre.command-body', { text: 'othmode <your command>' })
        ]),
        el('div.detail-block', {}, [
          el('h2.block-title', { text: t('oth.settings.oss') }),
          el('p.page-sub', { text: t('oth.settings.oss_sub') }),
          (oss.records && oss.records.length) ? table(
            [t('field.title'), t('oth.history.source'), t('field.version'), 'License', t('field.status'), 'OTHMODE'],
            oss.records.map(function (rec) {
              return [rec.name, el('span.mono.oth-cell-wrap', { text: rec.repository || rec.source || '—' }),
                rec.version || '—', rec.license || '—',
                el('span.badge', { text: rec.status || '—' }),
                el('span.oth-cell-wrap', { text: rec.othmode_usage || '—' })];
            })
          ) : emptyState('oth.settings.oss_empty')
        ])
      ]));
    }).catch(function (err) { errorView('oth.settings.title', 'oth.settings.sub', err); });
  }

  // ── Registration ──────────────────────────────────────────────────────

  A.registerRoutes({
    'saved': function () { renderSaved(); },
    'skills': function (segments) { segments[1] ? renderSkillDetail(decodeURIComponent(segments[1])) : renderSkills(); },
    'tools': function () { renderTools(); },
    'providers': function () { renderProviders(); },
    'projects': function () { renderProjects(); },
    'health': function () { renderHealth(); },
    'status': function () { renderStatus(); },
    'history': function (segments, params) { renderHistory(segments, params); },
    'memory': function (segments, params) { renderMemory(segments, params); },
    'evolution': function (segments) { renderEvolution(segments); },
    'settings': function () { renderSettings(); }
  });

}());
