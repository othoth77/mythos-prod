'use strict';
// =====================================================
// MYTHOS AI COMMAND CENTER — front end
// projects/command-center/reference/web/app.js
//
// Vanilla ES5-flavoured JavaScript, no framework, no build step. That is a
// deliberate match to the repository's existing front ends
// (projects/idauto/reference/admin-ui.js, projects/ssangyong-autos/
// reference/shop-ui.js) rather than a new stack to maintain.
//
// XSS: user text is NEVER assigned through innerHTML. Every dynamic string
// goes through textContent or a text node, via the el() helper below. This
// matters more here than in a normal app — the whole content of this site
// is arbitrary text the owner pastes in, including text copied from
// untrusted places. Combined with the strict CSP in api.js, a stored
// command cannot become script.
//
// EXECUTION: nothing in this file executes a command. There is no eval, no
// Function constructor, no dynamic import. "Use command" copies text.
// =====================================================

(function () {

  var t = window.MccI18n.t;
  var i18n = window.MccI18n;

  // ── State ─────────────────────────────────────────────────────────────

  var state = {
    route: { name: 'dashboard', params: {} },
    token: null,
    identity: null,
    categories: [],
    projects: [],
    tags: [],
    // The card the keyboard shortcuts act on. Set by hovering/clicking a
    // card or by opening a detail page, so `c` and `f` always have an
    // unambiguous target.
    selected: null,
    lastSearch: '',
    filters: {}
  };

  var TOKEN_KEY = 'mcc.token';
  var THEME_KEY = 'mcc.theme';
  var LOCALE_KEY = 'mcc.locale';

  // ── DOM helpers ───────────────────────────────────────────────────────

  // el('div.card', { onclick: fn }, [children | 'text'])
  // Text children become text nodes. There is no path through this helper
  // that interprets a string as markup.
  function el(spec, attrs, children) {
    var parts = String(spec).split('.');
    var tag = parts.shift() || 'div';
    var node = document.createElement(tag);
    if (parts.length) node.className = parts.join(' ');

    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2), value);
        } else if (key === 'text') {
          node.textContent = String(value);
        } else if (key === 'value') {
          node.value = value;
        } else if (key === 'checked' || key === 'disabled' || key === 'selected') {
          node[key] = !!value;
        } else {
          node.setAttribute(key, String(value));
        }
      });
    }

    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function mount(node) {
    var view = document.getElementById('view');
    clear(view).appendChild(node);
    view.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function formatDate(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(i18n.getLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(i18n.getLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  }

  // ── Toasts ────────────────────────────────────────────────────────────

  function toast(message, kind) {
    var root = document.getElementById('toast-root');
    var node = el('div.toast' + (kind ? '.toast-' + kind : ''), { text: message });
    root.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, kind === 'error' ? 6000 : 2600);
  }

  // ── API ───────────────────────────────────────────────────────────────

  function api(path, options) {
    var opts = options || {};
    var headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;

    return fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (payload) {
        if (!response.ok) {
          var error = new Error(payload.error || ('HTTP ' + response.status));
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    });
  }

  function reportError(err) {
    if (err && err.status === 401) {
      toast(t('auth.required'), 'error');
      openAuthDialog();
      return;
    }
    toast((err && err.message) || t('error.load'), 'error');
  }

  // ── Badges ────────────────────────────────────────────────────────────

  function safetyBadge(level) {
    return el('span.badge.badge-safety-' + level, { text: t('safety.' + level) });
  }

  function categoryBadge(category) {
    if (!category) return null;
    return el('span.badge.badge-category', { text: i18n.categoryName(category) });
  }

  function usesBadge(count) {
    var label = count === 1 ? t('meta.use') : t('meta.uses');
    return el('span.badge.badge-uses', { text: count + ' ' + label });
  }

  function statusBadge(status) {
    if (status === 'ACTIVE') return null;
    return el('span.badge.badge-status-' + status, { text: t('status.' + status) });
  }

  // ── Copy, with the destructive gate (§14) ─────────────────────────────

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for non-secure contexts (plain http before the certificate
    // exists). Without it, copying — the app's second-priority action —
    // would silently do nothing.
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  // Records the copy, then updates the counter in place. The usage endpoint
  // is public, so this works whether or not an editing token is held.
  function trackUsage(command, eventType) {
    return api('/commands/' + encodeURIComponent(command.slug) + '/usage', {
      method: 'POST',
      body: { event_type: eventType || 'COPY' }
    }).catch(function () {
      // A failed counter must never block the copy that already succeeded.
      return null;
    });
  }

  function doCopy(command, button, text) {
    var payload = text === undefined ? command.body : text;
    return writeClipboard(payload).then(function () {
      if (button) {
        var original = button.textContent;
        button.textContent = t('action.copied');
        button.classList.add('is-copied');
        setTimeout(function () {
          button.textContent = original;
          button.classList.remove('is-copied');
        }, 1600);
      } else {
        toast(t('action.copied'), 'ok');
      }
      return trackUsage(command, 'COPY');
    }).then(function (result) {
      if (result && typeof result.usage_count === 'number') {
        command.usage_count = result.usage_count;
        command.last_used_at = result.last_used_at;
        var counter = document.querySelector('[data-uses-for="' + command.slug + '"]');
        if (counter) {
          counter.textContent = result.usage_count + ' ' +
            (result.usage_count === 1 ? t('meta.use') : t('meta.uses'));
        }
      }
    }).catch(function () {
      toast(t('error.save'), 'error');
    });
  }

  // DESTRUCTIVE and PRODUCTION commands warn before the text reaches the
  // clipboard. The warning is about what the text does if RUN — this app
  // never runs it, and the dialog says so, so the caution lands on the
  // real risk rather than on the copy itself.
  function copyCommand(command, button, text) {
    if (command.safety_level !== 'DESTRUCTIVE' && command.safety_level !== 'PRODUCTION') {
      return doCopy(command, button, text);
    }
    var isDestructive = command.safety_level === 'DESTRUCTIVE';
    openDialog({
      title: t(isDestructive ? 'warn.destructive.title' : 'warn.production.title'),
      subtitle: t(isDestructive ? 'warn.destructive.body' : 'warn.production.body'),
      body: [
        el('div.callout.callout-info', { text: t('warn.never_executes') }),
        command.warnings ? el('pre.command-body', { text: command.warnings }) : null
      ],
      confirmLabel: t('warn.copy_anyway'),
      confirmClass: isDestructive ? 'btn-danger' : 'btn-primary',
      onConfirm: function () {
        closeDialog();
        doCopy(command, button, text);
      }
    });
  }

  // ── Favorites ─────────────────────────────────────────────────────────

  function toggleFavorite(command, onDone) {
    if (!state.token) {
      toast(t('auth.required'), 'error');
      openAuthDialog();
      return;
    }
    api('/commands/' + encodeURIComponent(command.slug) + '/favorite', {
      method: 'POST',
      body: { favorite: !command.is_favorite }
    }).then(function (payload) {
      command.is_favorite = payload.command.is_favorite;
      if (onDone) onDone(payload.command);
    }).catch(reportError);
  }

  // ── Command card (§4) ─────────────────────────────────────────────────

  function commandCard(command) {
    var star = el('button.star' + (command.is_favorite ? '.is-on' : ''), {
      type: 'button',
      title: t(command.is_favorite ? 'action.unfavorite' : 'action.favorite'),
      'aria-label': t(command.is_favorite ? 'action.unfavorite' : 'action.favorite'),
      text: command.is_favorite ? '★' : '☆',
      onclick: function (event) {
        event.stopPropagation();
        toggleFavorite(command, function (updated) {
          star.textContent = updated.is_favorite ? '★' : '☆';
          star.classList.toggle('is-on', updated.is_favorite);
        });
      }
    });

    var copyButton = el('button.btn.btn-sm.btn-primary', {
      type: 'button',
      text: t('action.copy'),
      onclick: function (event) {
        event.stopPropagation();
        copyCommand(command, copyButton);
      }
    });

    var card = el('article.command-card', {
      tabindex: '0',
      role: 'button',
      'data-slug': command.slug,
      onclick: function () { navigate('#/command/' + encodeURIComponent(command.slug)); },
      onmouseenter: function () { state.selected = command; },
      onfocus: function () { state.selected = command; },
      onkeydown: function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate('#/command/' + encodeURIComponent(command.slug));
        }
      }
    }, [
      el('div.card-top', {}, [
        el('h3.card-title', { text: command.title }),
        star
      ]),
      el('p.card-desc', { text: command.description || command.when_to_use || '' }),
      el('div.card-meta', {}, [
        categoryBadge(command.category),
        safetyBadge(command.safety_level),
        statusBadge(command.status),
        el('span.badge.badge-uses', {
          text: command.usage_count + ' ' + (command.usage_count === 1 ? t('meta.use') : t('meta.uses')),
          'data-uses-for': command.slug
        })
      ]),
      el('div.card-actions', {}, [
        copyButton,
        el('button.btn.btn-sm', {
          type: 'button',
          text: t('action.open'),
          onclick: function (event) {
            event.stopPropagation();
            navigate('#/command/' + encodeURIComponent(command.slug));
          }
        })
      ])
    ]);

    return card;
  }

  function cardGrid(commands) {
    if (!commands.length) return el('div.empty', { text: t('section.empty') });
    var grid = el('div.card-grid');
    commands.forEach(function (command) { grid.appendChild(commandCard(command)); });
    return grid;
  }

  function section(titleKey, content, action) {
    return el('section.section', {}, [
      el('div.section-head', {}, [
        el('h2.section-title', { text: t(titleKey) }),
        action || null
      ]),
      content
    ]);
  }

  // ── Dashboard (§4) ────────────────────────────────────────────────────

  function renderDashboard() {
    api('/dashboard').then(function (data) {
      var quickActions = el('div.card-actions', {}, [
        el('button.btn.btn-primary', {
          type: 'button', text: t('action.new_command'),
          onclick: function () { navigate('#/new'); }
        }),
        el('button.btn', {
          type: 'button', text: t('notes.new'),
          onclick: function () { openNoteDialog(null); }
        }),
        el('button.btn', {
          type: 'button', text: t('nav.library'),
          onclick: function () { navigate('#/library'); }
        }),
        el('button.btn', {
          type: 'button', text: t('action.export'),
          onclick: function () { window.location.href = '/api/export'; }
        })
      ]);

      var categoryTiles = el('div.category-grid');
      data.categories.filter(function (c) { return c.command_count > 0; }).forEach(function (category) {
        categoryTiles.appendChild(el('button.category-tile', {
          type: 'button',
          onclick: function () { navigate('#/library?category=' + encodeURIComponent(category.slug)); }
        }, [
          el('span', { text: i18n.categoryName(category) }),
          el('span.nav-count', { text: String(category.command_count) })
        ]));
      });

      mount(el('div', {}, [
        el('div.page-head', {}, [
          el('h1.page-title', { text: t('app.title') }),
          el('p.page-sub', { text: t('app.subtitle') })
        ]),
        section('section.quick_actions', quickActions),
        section('section.most_used', cardGrid(data.most_used)),
        data.favorites.length ? section('section.favorites', cardGrid(data.favorites)) : null,
        data.recently_used.length ? section('section.recently_used', cardGrid(data.recently_used)) : null,
        section('section.recently_added', cardGrid(data.recently_added)),
        data.recommended.length ? section('section.recommended', cardGrid(data.recommended)) : null,
        section('section.categories', categoryTiles)
      ]));
    }).catch(function (err) {
      mount(el('div.empty', { text: t('error.load') }));
      reportError(err);
    });
  }

  // ── Library / search (§12) ────────────────────────────────────────────

  function renderLibrary(params) {
    var query = {
      q: params.q || '',
      category: params.category || '',
      project: params.project || '',
      difficulty: params.difficulty || '',
      safety: params.safety || '',
      status: params.status || '',
      favorite: params.favorite || '',
      sort: params.sort || ''
    };

    function buildQueryString(overrides) {
      var merged = {};
      Object.keys(query).forEach(function (key) { merged[key] = query[key]; });
      Object.keys(overrides || {}).forEach(function (key) { merged[key] = overrides[key]; });
      var pairs = [];
      Object.keys(merged).forEach(function (key) {
        if (merged[key] !== '' && merged[key] !== undefined && merged[key] !== null) {
          pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(merged[key]));
        }
      });
      return pairs.join('&');
    }

    function applyFilter(key, value) {
      navigate('#/library' + (buildQueryString(makeOverride(key, value)) ? '?' + buildQueryString(makeOverride(key, value)) : ''));
    }

    function makeOverride(key, value) {
      var override = {};
      override[key] = value;
      return override;
    }

    function selectFilter(key, options, currentValue) {
      var select = el('select', {
        'aria-label': key,
        onchange: function () { applyFilter(key, select.value); }
      });
      options.forEach(function (option) {
        select.appendChild(el('option', {
          value: option.value,
          text: option.label,
          selected: String(currentValue) === String(option.value)
        }));
      });
      return select;
    }

    api('/commands?' + buildQueryString({ limit: 100 })).then(function (data) {
      var filterBar = el('div.filter-bar', {}, [
        selectFilter('category', [{ value: '', label: t('filter.all_categories') }].concat(
          state.categories.map(function (c) { return { value: c.slug, label: i18n.categoryName(c) }; })
        ), query.category),

        selectFilter('project', [{ value: '', label: t('filter.all_projects') }].concat(
          state.projects.map(function (p) { return { value: p.slug, label: p.name }; })
        ), query.project),

        selectFilter('difficulty', [{ value: '', label: t('filter.all_difficulties') }].concat(
          ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map(function (d) { return { value: d, label: t('difficulty.' + d) }; })
        ), query.difficulty),

        selectFilter('safety', [{ value: '', label: t('filter.all_safety') }].concat(
          ['SAFE', 'READ_ONLY', 'WRITE', 'PRODUCTION', 'DESTRUCTIVE'].map(function (s) { return { value: s, label: t('safety.' + s) }; })
        ), query.safety),

        selectFilter('status', [
          { value: '', label: t('status.ACTIVE') },
          { value: 'ARCHIVED', label: t('status.ARCHIVED') },
          { value: 'DRAFT', label: t('status.DRAFT') },
          { value: 'ALL', label: t('status.ALL') }
        ], query.status),

        selectFilter('sort', [
          { value: '', label: t('filter.sort') },
          { value: 'most_used', label: t('sort.most_used') },
          { value: 'recent_used', label: t('sort.recent_used') },
          { value: 'recent_added', label: t('sort.recent_added') },
          { value: 'updated', label: t('sort.updated') },
          { value: 'title', label: t('sort.title') }
        ], query.sort),

        el('label.filter-check', {}, [
          el('input', {
            type: 'checkbox',
            checked: query.favorite === 'true',
            onchange: function (event) { applyFilter('favorite', event.target.checked ? 'true' : ''); }
          }),
          t('filter.favorites_only')
        ]),

        query.q ? el('button.btn.btn-sm.btn-ghost', {
          type: 'button', text: t('search.clear'),
          onclick: function () { applyFilter('q', ''); }
        }) : null
      ]);

      mount(el('div', {}, [
        el('div.page-head', {}, [
          el('h1.page-title', { text: query.q ? t('search.results') : t('nav.library') }),
          el('p.page-sub', { text: data.total + ' ' + t('meta.commands') + (query.q ? ' · “' + query.q + '”' : '') })
        ]),
        filterBar,
        data.commands.length ? cardGrid(data.commands) : el('div.empty', { text: t('search.none') })
      ]));
    }).catch(function (err) {
      mount(el('div.empty', { text: t('error.load') }));
      reportError(err);
    });
  }

  // ── Command detail (§6) ───────────────────────────────────────────────

  function renderCommandDetail(slug) {
    api('/commands/' + encodeURIComponent(slug)).then(function (payload) {
      var command = payload.command;
      state.selected = command;
      // OPEN is recorded for the usage history but does not count as a use.
      trackUsage(command, 'OPEN');

      var copyButton = el('button.btn.btn-primary', {
        type: 'button', text: t('action.copy'),
        onclick: function () { copyCommand(command, copyButton); }
      });

      var favButton = el('button.btn', {
        type: 'button',
        text: (command.is_favorite ? '★ ' : '☆ ') + t('action.favorite'),
        onclick: function () {
          toggleFavorite(command, function (updated) {
            favButton.textContent = (updated.is_favorite ? '★ ' : '☆ ') + t('action.favorite');
          });
        }
      });

      var relationsByType = { NEXT: [], PREVIOUS: [], RELATED: [] };
      command.related.forEach(function (related) {
        (relationsByType[related.relation_type] || relationsByType.RELATED).push(related);
      });

      function relatedBlock(titleKey, items) {
        if (!items.length) return null;
        var list = el('div.related-list');
        items.forEach(function (item) {
          list.appendChild(el('button.related-item', {
            type: 'button',
            onclick: function () { navigate('#/command/' + encodeURIComponent(item.slug)); }
          }, [
            el('span.relation-tag', { text: t('detail.' + titleKey.split('.')[1]) }),
            el('span', { text: item.title }),
            safetyBadge(item.safety_level)
          ]));
        });
        return el('div.detail-block', {}, [
          el('h2.block-title', { text: t(titleKey) }),
          list
        ]);
      }

      function textBlock(titleKey, value) {
        if (!value) return null;
        return el('div.detail-block', {}, [
          el('h2.block-title', { text: t(titleKey) }),
          el('p.prose', { text: value })
        ]);
      }

      var notesBlock = el('div.detail-block', {}, [
        el('h2.block-title', { text: t('detail.notes') }),
        command.notes.length
          ? el('div', {}, command.notes.map(function (note) {
              return el('div.note-item', {}, [
                el('h3.note-title', { text: note.title }),
                el('p.note-body', { text: note.content }),
                el('div.note-meta', {}, [el('span', { text: formatDate(note.created_at) })])
              ]);
            }))
          : el('div.empty', { text: t('detail.no_notes') })
      ]);

      var usageBlock = el('div.detail-block', {}, [
        el('h2.block-title', { text: t('detail.usage_history') }),
        command.usage_history.length
          ? el('ul.timeline', {}, command.usage_history.map(function (event) {
              return el('li', {}, [
                el('span', { text: event.event_type }),
                el('span', { text: formatDateTime(event.occurred_at) })
              ]);
            }))
          : el('div.empty', { text: t('detail.no_usage') })
      ]);

      var versionsBlock = command.versions.length ? el('div.detail-block', {}, [
        el('h2.block-title', { text: t('detail.versions') }),
        el('ul.timeline', {}, command.versions.map(function (version) {
          return el('li', {}, [
            el('span', { text: 'v' + version.version }),
            el('span', { text: version.change_note }),
            el('span', { text: formatDate(version.created_at) })
          ]);
        }))
      ]) : null;

      mount(el('div.detail', {}, [
        el('button.btn.btn-sm.btn-ghost', {
          type: 'button', text: '← ' + t('action.back'),
          onclick: function () { window.history.back(); }
        }),

        el('div.detail-head', {}, [
          el('h1.detail-title', { text: command.title }),
          el('div.detail-badges', {}, [
            categoryBadge(command.category),
            command.project ? el('span.badge', { text: command.project.name }) : null,
            safetyBadge(command.safety_level),
            statusBadge(command.status),
            el('span.badge', { text: t('difficulty.' + command.difficulty) }),
            el('span.badge', { text: 'v' + command.version }),
            el('span.badge.badge-uses', {
              text: command.usage_count + ' ' + (command.usage_count === 1 ? t('meta.use') : t('meta.uses')),
              'data-uses-for': command.slug
            })
          ].concat(command.tags.map(function (tag) { return el('span.badge', { text: '#' + tag }); }))),
          command.description ? el('p.detail-desc', { text: command.description }) : null
        ]),

        el('div.detail-actions', {}, [
          copyButton,
          el('button.btn', {
            type: 'button', text: t('action.edit'),
            onclick: function () { navigate('#/edit/' + encodeURIComponent(command.slug)); }
          }),
          favButton,
          el('button.btn', {
            type: 'button', text: t('action.customize'),
            onclick: function () { openVariablesDialog(command); }
          }),
          el('button.btn', {
            type: 'button', text: t('action.add_note'),
            onclick: function () { openNoteDialog(command); }
          }),
          el('button.btn', {
            type: 'button', text: t('action.duplicate'),
            onclick: function () { duplicateCommand(command); }
          }),
          command.status === 'ARCHIVED'
            ? el('button.btn', {
                type: 'button', text: t('action.restore'),
                onclick: function () { changeStatus(command, 'ACTIVE'); }
              })
            : el('button.btn.btn-danger', {
                type: 'button', text: t('action.archive'),
                onclick: function () { confirmArchive(command); }
              })
        ]),

        command.safety_level === 'DESTRUCTIVE'
          ? el('div.callout.callout-danger', {}, [
              el('strong', { text: t('warn.destructive.title') }),
              t('warn.destructive.body')
            ])
          : (command.safety_level === 'PRODUCTION'
              ? el('div.callout.callout-warn', {}, [
                  el('strong', { text: t('warn.production.title') }),
                  t('warn.production.body')
                ])
              : null),

        textBlock('detail.when_to_use', command.when_to_use),

        el('div.detail-block', {}, [
          el('h2.block-title', { text: t('detail.command') }),
          el('pre.command-body', { text: command.body }),
          command.variables.length
            ? el('p.field-hint', {
                text: t('detail.variables') + ': ' +
                      command.variables.map(function (v) { return '{{' + v.name + '}}'; }).join('  ')
              })
            : null
        ]),

        textBlock('detail.explanation', command.explanation),
        textBlock('detail.best_practices', command.best_practices),

        command.warnings ? el('div.detail-block', {}, [
          el('h2.block-title', { text: t('detail.warnings') }),
          el('div.callout.callout-warn', {}, [el('span.prose', { text: command.warnings })])
        ]) : null,

        relatedBlock('detail.next', relationsByType.NEXT),
        relatedBlock('detail.previous', relationsByType.PREVIOUS),
        relatedBlock('detail.related', relationsByType.RELATED),

        command.workflows.length ? el('div.detail-block', {}, [
          el('h2.block-title', { text: t('detail.in_workflows') }),
          el('div.related-list', {}, command.workflows.map(function (workflow) {
            return el('button.related-item', {
              type: 'button',
              onclick: function () { navigate('#/workflows'); }
            }, [
              el('span.relation-tag', { text: '#' + workflow.position }),
              el('span', { text: workflow.title })
            ]);
          }))
        ]) : null,

        notesBlock,
        usageBlock,
        versionsBlock,

        command.source ? el('p.field-hint', { text: t('meta.source') + ': ' + command.source }) : null,
        el('p.field-hint', {
          text: t('meta.created') + ' ' + formatDate(command.created_at) +
                ' · ' + t('meta.updated') + ' ' + formatDate(command.updated_at)
        })
      ]));
    }).catch(function (err) {
      mount(el('div.empty', { text: t('error.load') }));
      reportError(err);
    });
  }

  function changeStatus(command, status) {
    api('/commands/' + encodeURIComponent(command.slug) + '/status', {
      method: 'POST', body: { status: status }
    }).then(function () {
      renderCommandDetail(command.slug);
    }).catch(reportError);
  }

  function confirmArchive(command) {
    openDialog({
      title: t('action.archive'),
      subtitle: t('confirm.archive'),
      body: [],
      confirmLabel: t('action.archive'),
      confirmClass: 'btn-danger',
      onConfirm: function () {
        closeDialog();
        changeStatus(command, 'ARCHIVED');
      }
    });
  }

  function duplicateCommand(command) {
    api('/commands/' + encodeURIComponent(command.slug) + '/duplicate', {
      method: 'POST', body: {}
    }).then(function (payload) {
      navigate('#/edit/' + encodeURIComponent(payload.command.slug));
    }).catch(reportError);
  }

  // ── Editor (§11) ──────────────────────────────────────────────────────

  function renderEditor(slug) {
    var isNew = !slug;

    function build(command) {
      var fields = {};

      function textField(name, labelKey, value, options) {
        var opts = options || {};
        var input = opts.multiline
          ? el('textarea' + (opts.mono ? '.mono' : ''), { rows: opts.rows || 4 })
          : el('input', { type: 'text' });
        input.value = value || '';
        fields[name] = input;
        return el('div.form-row', {}, [
          el('label', { text: t(labelKey), for: 'field-' + name }),
          (input.id = 'field-' + name, input),
          opts.hint ? el('p.field-hint', { text: opts.hint }) : null
        ]);
      }

      function selectField(name, labelKey, options, current) {
        var select = el('select');
        options.forEach(function (option) {
          select.appendChild(el('option', {
            value: option.value, text: option.label,
            selected: String(current || '') === String(option.value)
          }));
        });
        fields[name] = select;
        return el('div', {}, [el('label', { text: t(labelKey) }), select]);
      }

      var form = el('div.form', {}, [
        textField('title', 'field.title', command.title),
        el('div.form-row', {}, [
          el('div.form-grid', {}, [
            selectField('category', 'field.category',
              [{ value: '', label: '—' }].concat(state.categories.map(function (c) {
                return { value: c.slug, label: i18n.categoryName(c) };
              })), command.category ? command.category.slug : ''),
            selectField('project', 'field.project',
              [{ value: '', label: '—' }].concat(state.projects.map(function (p) {
                return { value: p.slug, label: p.name };
              })), command.project ? command.project.slug : ''),
            selectField('difficulty', 'field.difficulty',
              ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map(function (d) {
                return { value: d, label: t('difficulty.' + d) };
              }), command.difficulty),
            selectField('safety_level', 'field.safety',
              ['SAFE', 'READ_ONLY', 'WRITE', 'PRODUCTION', 'DESTRUCTIVE'].map(function (s) {
                return { value: s, label: t('safety.' + s) };
              }), command.safety_level),
            selectField('status', 'field.status',
              ['ACTIVE', 'DRAFT', 'ARCHIVED'].map(function (s) {
                return { value: s, label: t('status.' + s) };
              }), command.status)
          ])
        ]),
        textField('description', 'field.description', command.description),
        textField('body', 'field.body', command.body, {
          multiline: true, mono: true,
          hint: 'Use {{PLACEHOLDER}} for values you fill in when you use the command.'
        }),
        textField('when_to_use', 'field.when_to_use', command.when_to_use, { multiline: true }),
        textField('explanation', 'field.explanation', command.explanation, { multiline: true }),
        textField('best_practices', 'field.best_practices', command.best_practices, { multiline: true }),
        textField('warnings', 'field.warnings', command.warnings, { multiline: true }),
        textField('tags', 'field.tags', (command.tags || []).join(', ')),
        textField('related', 'field.related', (command.related || []).map(function (r) { return r.slug; }).join(', ')),
        !isNew ? textField('change_note', 'field.change_note', '') : null
      ]);

      function collect() {
        var payload = {
          title: fields.title.value.trim(),
          description: fields.description.value,
          body: fields.body.value,
          when_to_use: fields.when_to_use.value,
          explanation: fields.explanation.value,
          best_practices: fields.best_practices.value,
          warnings: fields.warnings.value,
          category: fields.category.value || null,
          project: fields.project.value || null,
          difficulty: fields.difficulty.value,
          safety_level: fields.safety_level.value,
          status: fields.status.value,
          tags: fields.tags.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          related: fields.related.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
            .map(function (s) { return { slug: s, relation_type: 'RELATED' }; })
        };
        if (fields.change_note) payload.change_note = fields.change_note.value;
        return payload;
      }

      function handleSaveError(err) {
        if (err.payload && err.payload.findings) {
          openDialog({
            title: t('secret.blocked'),
            subtitle: err.payload.guidance || '',
            body: [el('ul', {}, err.payload.findings.map(function (finding) {
              return el('li', { text: finding.label + ' — ' + finding.field + ':' + finding.line });
            }))],
            confirmLabel: t('action.close'),
            onConfirm: closeDialog
          });
          return;
        }
        reportError(err);
      }

      function afterSave(payload) {
        if (payload.secret_warnings && payload.secret_warnings.length) {
          toast(t('secret.warning') + ' ' +
                payload.secret_warnings.map(function (w) { return w.field + ':' + w.line; }).join(', '), 'error');
        }
        navigate('#/command/' + encodeURIComponent(payload.command.slug));
      }

      var actions = el('div.form-actions', {}, [
        el('button.btn.btn-primary', {
          type: 'button', text: t('action.save'),
          onclick: function () {
            var payload = collect();
            if (!payload.title || !payload.body) {
              toast(t('error.save'), 'error');
              return;
            }
            var request = isNew
              ? api('/commands', { method: 'POST', body: payload })
              : api('/commands/' + encodeURIComponent(command.slug), { method: 'PATCH', body: payload });
            request.then(afterSave).catch(handleSaveError);
          }
        }),
        !isNew ? el('button.btn', {
          type: 'button', text: t('action.save_as_new'),
          onclick: function () {
            var payload = collect();
            payload.title = payload.title + ' (copy)';
            payload.status = 'DRAFT';
            api('/commands', { method: 'POST', body: payload }).then(afterSave).catch(handleSaveError);
          }
        }) : null,
        el('button.btn.btn-ghost', {
          type: 'button', text: t('action.cancel'),
          onclick: function () { window.history.back(); }
        })
      ]);

      mount(el('div', {}, [
        el('div.page-head', {}, [
          el('h1.page-title', { text: isNew ? t('action.new_command') : t('action.edit') + ' — ' + command.title })
        ]),
        !state.token ? el('div.callout.callout-warn', { text: t('auth.required') }) : null,
        form,
        actions
      ]));
    }

    if (isNew) {
      build({ title: '', body: '', difficulty: 'INTERMEDIATE', safety_level: 'SAFE', status: 'ACTIVE', tags: [], related: [] });
    } else {
      api('/commands/' + encodeURIComponent(slug)).then(function (payload) {
        build(payload.command);
      }).catch(function (err) {
        mount(el('div.empty', { text: t('error.load') }));
        reportError(err);
      });
    }
  }

  // ── Favorites (§9) ────────────────────────────────────────────────────

  function renderFavorites() {
    api('/commands?favorite=true&sort=favorite&limit=100').then(function (data) {
      mount(el('div', {}, [
        el('div.page-head', {}, [
          el('h1.page-title', { text: t('nav.favorites') }),
          el('p.page-sub', { text: data.total + ' ' + t('meta.commands') })
        ]),
        data.commands.length ? cardGrid(data.commands) : el('div.empty', { text: t('section.empty') })
      ]));
    }).catch(reportError);
  }

  // ── Notes (§10) ───────────────────────────────────────────────────────

  function renderNotes() {
    api('/notes?limit=200').then(function (data) {
      var general = data.notes.filter(function (n) { return n.scope !== 'COMMAND'; });
      var onCommands = data.notes.filter(function (n) { return n.scope === 'COMMAND'; });

      function noteList(notes) {
        if (!notes.length) return el('div.empty', { text: t('notes.empty') });
        return el('div', {}, notes.map(function (note) {
          return el('div.note-item', {}, [
            el('h3.note-title', { text: note.title }),
            el('p.note-body', { text: note.content }),
            el('div.note-meta', {}, [
              el('span', { text: formatDate(note.updated_at) }),
              note.command_slug ? el('button.btn.btn-sm.btn-ghost', {
                type: 'button', text: note.command_title || note.command_slug,
                onclick: function () { navigate('#/command/' + encodeURIComponent(note.command_slug)); }
              }) : null,
              note.tags && note.tags.length ? el('span', { text: note.tags.map(function (x) { return '#' + x; }).join(' ') }) : null
            ])
          ]);
        }));
      }

      mount(el('div', {}, [
        el('div.page-head', {}, [
          el('h1.page-title', { text: t('notes.title') }),
          el('p.page-sub', { text: data.notes.length + '' })
        ]),
        section('notes.general', noteList(general), el('button.btn.btn-sm.btn-primary', {
          type: 'button', text: t('notes.new'), onclick: function () { openNoteDialog(null); }
        })),
        section('notes.command_notes', noteList(onCommands))
      ]));
    }).catch(reportError);
  }

  // ── Statistics (§20) ──────────────────────────────────────────────────

  function renderStatistics() {
    api('/statistics').then(function (data) {
      var grid = el('div.stat-grid');
      [
        ['stats.total_commands', data.totals.total_commands],
        ['stats.active_commands', data.totals.active_commands],
        ['stats.archived_commands', data.totals.archived_commands],
        ['stats.draft_commands', data.totals.draft_commands],
        ['stats.total_uses', data.totals.total_uses],
        ['stats.added_this_month', data.totals.added_this_month],
        ['stats.used_this_week', data.totals.used_this_week],
        ['stats.total_favorites', data.totals.total_favorites],
        ['stats.total_notes', data.totals.total_notes],
        ['stats.total_categories', data.totals.total_categories],
        ['stats.total_tags', data.totals.total_tags],
        ['stats.total_projects', data.totals.total_projects]
      ].forEach(function (entry) {
        grid.appendChild(el('div.stat-card', {}, [
          el('div.stat-value', { text: String(entry[1]) }),
          el('div.stat-label', { text: t(entry[0]) })
        ]));
      });

      function board(titleKey, rows) {
        return el('div', {}, [
          el('h2.block-title', { text: t(titleKey) }),
          rows.length
            ? el('ol.leaderboard', {}, rows.map(function (row, index) {
                return el('li', {}, [
                  el('span.rank', { text: String(index + 1) }),
                  el('button.btn.btn-sm.btn-ghost', {
                    type: 'button', text: row.title,
                    onclick: function () { navigate('#/command/' + encodeURIComponent(row.slug)); }
                  }),
                  el('span.count', { text: String(row.uses) })
                ]);
              }))
            : el('div.empty', { text: t('section.empty') })
        ]);
      }

      mount(el('div', {}, [
        el('div.page-head', {}, [el('h1.page-title', { text: t('nav.statistics') })]),
        grid,
        el('div.columns', {}, [
          board('stats.today', data.most_used_today),
          board('stats.week', data.most_used_week),
          board('stats.month', data.most_used_month),
          board('stats.all_time', data.most_used_all_time)
        ]),
        el('div.section', {}, [
          el('h2.block-title', { text: t('stats.by_category') }),
          el('ol.leaderboard', {}, data.by_category.map(function (row, index) {
            return el('li', {}, [
              el('span.rank', { text: String(index + 1) }),
              el('span', { text: row.name_en }),
              el('span.count', { text: row.commands + ' · ' + row.uses })
            ]);
          }))
        ])
      ]));
    }).catch(reportError);
  }

  // ── Workflows (§18) ───────────────────────────────────────────────────

  function renderWorkflows() {
    api('/workflows').then(function (data) {
      mount(el('div', {}, [
        el('div.page-head', {}, [
          el('h1.page-title', { text: t('nav.workflows') }),
          el('p.page-sub', { text: t('warn.never_executes') })
        ])
      ].concat(data.workflows.map(function (workflow) {
        return el('section.section', {}, [
          el('div.section-head', {}, [el('h2.section-title', { text: workflow.title })]),
          el('p.page-sub', { text: workflow.description }),
          el('div.related-list', {}, workflow.steps.map(function (step) {
            return el('button.related-item', {
              type: 'button',
              onclick: function () { navigate('#/command/' + encodeURIComponent(step.slug)); }
            }, [
              el('span.relation-tag', { text: String(step.position) }),
              el('span', { text: step.title }),
              safetyBadge(step.safety_level),
              el('span.nav-count', { text: step.note })
            ]);
          }))
        ]);
      }))));
    }).catch(reportError);
  }

  // ── Dialogs ───────────────────────────────────────────────────────────

  var dialogPreviousFocus = null;

  function openDialog(config) {
    closeDialog();
    dialogPreviousFocus = document.activeElement;

    var dialog = el('div.dialog', {
      role: 'dialog', 'aria-modal': 'true', 'aria-label': config.title
    }, [
      el('h2.dialog-title', { text: config.title }),
      config.subtitle ? el('p.dialog-sub', { text: config.subtitle }) : null
    ].concat(config.body || []).concat([
      el('div.dialog-actions', {}, [
        el('button.btn.btn-ghost', {
          type: 'button', text: t('action.cancel'), onclick: closeDialog
        }),
        config.onConfirm ? el('button.btn.' + (config.confirmClass || 'btn-primary'), {
          type: 'button', text: config.confirmLabel || t('action.save'),
          onclick: config.onConfirm
        }) : null
      ].concat(config.extraActions || []))
    ]));

    var backdrop = el('div.dialog-backdrop', {
      onclick: function (event) { if (event.target === backdrop) closeDialog(); }
    }, [dialog]);

    document.getElementById('dialog-root').appendChild(backdrop);
    var focusable = dialog.querySelector('input, textarea, select, button');
    if (focusable) focusable.focus();
  }

  function closeDialog() {
    var root = document.getElementById('dialog-root');
    if (root.firstChild) {
      clear(root);
      if (dialogPreviousFocus && dialogPreviousFocus.focus) dialogPreviousFocus.focus();
      dialogPreviousFocus = null;
    }
  }

  function dialogIsOpen() {
    return document.getElementById('dialog-root').firstChild !== null;
  }

  // "Customize Command" (§15) — fill placeholders, then copy the result.
  // The substitution happens server-side through /render so that the API
  // and the UI can never disagree about what a filled command looks like.
  function openVariablesDialog(command) {
    if (!command.variables.length) {
      toast(t('variables.none'));
      return;
    }

    var inputs = {};
    var output = el('pre.command-body', { text: command.body });
    var unresolvedLine = el('p.field-hint', { text: '' });

    function refresh() {
      var values = {};
      Object.keys(inputs).forEach(function (name) { values[name] = inputs[name].value; });
      api('/commands/' + encodeURIComponent(command.slug) + '/render', {
        method: 'POST', body: { values: values }
      }).then(function (payload) {
        output.textContent = payload.rendered;
        unresolvedLine.textContent = payload.unresolved.length
          ? t('variables.unresolved') + ' ' + payload.unresolved.join(', ')
          : '';
      }).catch(reportError);
    }

    var rows = command.variables.map(function (variable) {
      var input = el('input', { type: 'text', value: variable.default || '', oninput: refresh });
      inputs[variable.name] = input;
      return el('div.var-row', {}, [
        el('span.var-name', { text: '{{' + variable.name + '}}' }),
        input
      ]);
    });

    openDialog({
      title: t('action.customize') + ' — ' + command.title,
      subtitle: t('variables.intro'),
      body: rows.concat([
        el('h3.block-title', { text: t('variables.result') }),
        output,
        unresolvedLine
      ]),
      confirmLabel: t('action.copy'),
      onConfirm: function () {
        copyCommand(command, null, output.textContent);
        trackUsage(command, 'CUSTOMIZE');
        closeDialog();
      }
    });
    refresh();
  }

  function openNoteDialog(command) {
    if (!state.token) {
      toast(t('auth.required'), 'error');
      openAuthDialog();
      return;
    }

    var titleInput = el('input', { type: 'text' });
    var contentInput = el('textarea', { rows: 8 });
    var tagsInput = el('input', { type: 'text' });

    openDialog({
      title: t('notes.new'),
      subtitle: command ? command.title : t('notes.general'),
      body: [
        el('div.form-row', {}, [el('label', { text: t('field.title') }), titleInput]),
        el('div.form-row', {}, [el('label', { text: t('field.content') }), contentInput]),
        el('div.form-row', {}, [el('label', { text: t('field.tags') }), tagsInput])
      ],
      confirmLabel: t('action.save'),
      onConfirm: function () {
        var payload = {
          title: titleInput.value.trim(),
          content: contentInput.value,
          scope: command ? 'COMMAND' : 'GENERAL',
          tags: tagsInput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
        };
        if (command) payload.command = command.slug;
        if (!payload.title) { toast(t('error.save'), 'error'); return; }
        api('/notes', { method: 'POST', body: payload }).then(function () {
          closeDialog();
          toast(t('action.save'), 'ok');
          if (command) renderCommandDetail(command.slug); else renderRoute();
        }).catch(reportError);
      }
    });
  }

  function openAuthDialog() {
    var input = el('input', { type: 'password', value: state.token || '' });
    // type=password so the token is not shoulder-surfable or captured by a
    // screenshot; it is stored in localStorage, never sent anywhere but
    // this origin's Authorization header.
    openDialog({
      title: t('auth.title'),
      subtitle: t('auth.explain'),
      body: [
        el('div.form-row', {}, [el('label', { text: t('auth.token') }), input])
      ],
      confirmLabel: t('auth.save'),
      extraActions: [
        state.token ? el('button.btn.btn-ghost', {
          type: 'button', text: t('auth.forget'),
          onclick: function () {
            state.token = null;
            state.identity = null;
            try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
            updateAuthButton();
            closeDialog();
          }
        }) : null
      ],
      onConfirm: function () {
        var candidate = input.value.trim();
        if (!candidate) return;
        var previous = state.token;
        state.token = candidate;
        api('/session').then(function (payload) {
          state.identity = payload.identity;
          try { localStorage.setItem(TOKEN_KEY, candidate); } catch (e) { /* private mode */ }
          updateAuthButton();
          closeDialog();
          toast(t('auth.signed_in') + ' ' + payload.identity, 'ok');
        }).catch(function () {
          state.token = previous;
          toast(t('auth.invalid'), 'error');
        });
      }
    });
  }

  function updateAuthButton() {
    var button = document.getElementById('auth-button');
    button.textContent = state.identity ? (t('auth.signed_in') + ' ' + state.identity) : t('auth.signed_out');
  }

  // ── Sidebar ───────────────────────────────────────────────────────────

  function renderSidebar() {
    var sidebar = clear(document.getElementById('sidebar'));

    function navItem(labelKey, hash, routeName, count) {
      return el('button.nav-item', {
        type: 'button',
        'aria-current': state.route.name === routeName ? 'page' : null,
        onclick: function () { navigate(hash); }
      }, [
        el('span', { text: t(labelKey) }),
        count !== undefined ? el('span.nav-count', { text: String(count) }) : null
      ]);
    }

    var main = el('div.sidebar-group', {}, [
      el('div.sidebar-label', { text: 'MYTHOS' }),
      navItem('nav.dashboard', '#/', 'dashboard'),
      navItem('nav.library', '#/library', 'library'),
      navItem('nav.favorites', '#/favorites', 'favorites'),
      navItem('nav.notes', '#/notes', 'notes'),
      navItem('nav.workflows', '#/workflows', 'workflows'),
      navItem('nav.statistics', '#/stats', 'statistics')
    ]);
    sidebar.appendChild(main);

    if (state.categories.length) {
      var categoryGroup = el('div.sidebar-group', {}, [
        el('div.sidebar-label', { text: t('section.categories') })
      ]);
      state.categories.filter(function (c) { return c.command_count > 0; }).forEach(function (category) {
        categoryGroup.appendChild(el('button.nav-item', {
          type: 'button',
          onclick: function () { navigate('#/library?category=' + encodeURIComponent(category.slug)); }
        }, [
          el('span', { text: i18n.categoryName(category) }),
          el('span.nav-count', { text: String(category.command_count) })
        ]));
      });
      sidebar.appendChild(categoryGroup);
    }

    var shortcuts = el('div.sidebar-group', {}, [
      el('div.sidebar-label', { text: t('shortcuts.title') }),
      shortcutRow('/', t('shortcuts.search')),
      shortcutRow('c', t('shortcuts.copy')),
      shortcutRow('f', t('shortcuts.favorite')),
      shortcutRow('n', t('shortcuts.note')),
      shortcutRow('esc', t('shortcuts.close'))
    ]);
    sidebar.appendChild(shortcuts);
  }

  function shortcutRow(key, label) {
    return el('div.nav-item', {}, [
      el('span', { text: label }),
      el('kbd', { text: key })
    ]);
  }

  // ── Routing ───────────────────────────────────────────────────────────

  function parseHash() {
    var raw = window.location.hash.replace(/^#/, '') || '/';
    var queryIndex = raw.indexOf('?');
    var path = queryIndex === -1 ? raw : raw.slice(0, queryIndex);
    var params = {};
    if (queryIndex !== -1) {
      raw.slice(queryIndex + 1).split('&').forEach(function (pair) {
        if (!pair) return;
        var bits = pair.split('=');
        params[decodeURIComponent(bits[0])] = decodeURIComponent(bits.slice(1).join('=') || '');
      });
    }
    var segments = path.split('/').filter(Boolean);
    return { segments: segments, params: params };
  }

  function navigate(hash) {
    if (window.location.hash === hash) renderRoute();
    else window.location.hash = hash;
  }

  function renderRoute() {
    var parsed = parseHash();
    var head = parsed.segments[0] || '';

    var routes = {
      '':          function () { state.route = { name: 'dashboard' }; renderDashboard(); },
      'library':   function () { state.route = { name: 'library' };   renderLibrary(parsed.params); },
      'command':   function () { state.route = { name: 'library' };   renderCommandDetail(parsed.segments[1]); },
      'favorites': function () { state.route = { name: 'favorites' }; renderFavorites(); },
      'notes':     function () { state.route = { name: 'notes' };     renderNotes(); },
      'stats':     function () { state.route = { name: 'statistics' };renderStatistics(); },
      'workflows': function () { state.route = { name: 'workflows' }; renderWorkflows(); },
      'new':       function () { state.route = { name: 'library' };   renderEditor(null); },
      'edit':      function () { state.route = { name: 'library' };   renderEditor(parsed.segments[1]); }
    };

    (routes[head] || routes[''])();
    renderSidebar();

    // Keep the search box showing the query it produced, so refining a
    // search does not mean retyping it.
    var searchInput = document.getElementById('search-input');
    if (head === 'library') searchInput.value = parsed.params.q || '';
    else if (head === '') searchInput.value = '';
  }

  // ── Keyboard shortcuts (§27) ──────────────────────────────────────────

  function isTypingTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function installShortcuts() {
    document.addEventListener('keydown', function (event) {
      // Esc closes a dialog from anywhere, including from inside a field —
      // it is the escape hatch, so it must not be blocked by focus.
      if (event.key === 'Escape') {
        if (dialogIsOpen()) {
          event.preventDefault();
          closeDialog();
        } else if (document.activeElement === document.getElementById('search-input')) {
          document.getElementById('search-input').blur();
        }
        return;
      }

      // Every other shortcut is suppressed while typing, so `c` in a
      // command body never copies instead of inserting a letter.
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (dialogIsOpen()) return;

      if (event.key === '/') {
        event.preventDefault();
        var input = document.getElementById('search-input');
        input.focus();
        input.select();
        return;
      }

      if (event.key === 'c' && state.selected) {
        event.preventDefault();
        copyCommand(state.selected, null);
        return;
      }

      if (event.key === 'f' && state.selected) {
        event.preventDefault();
        toggleFavorite(state.selected, function () { renderRoute(); });
        return;
      }

      if (event.key === 'n') {
        event.preventDefault();
        openNoteDialog(state.route.name === 'library' && state.selected ? state.selected : null);
      }
    });
  }

  // ── Search box ────────────────────────────────────────────────────────

  function installSearch() {
    var input = document.getElementById('search-input');
    input.placeholder = t('search.placeholder');

    var timer = null;
    input.addEventListener('input', function () {
      // Debounced: the search endpoint is fast, but firing on every
      // keystroke would still queue requests that arrive out of order.
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        var value = input.value.trim();
        state.lastSearch = value;
        navigate(value ? '#/library?q=' + encodeURIComponent(value) : '#/library');
        input.focus();
      }, 220);
    });

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        if (timer) clearTimeout(timer);
        var value = input.value.trim();
        navigate(value ? '#/library?q=' + encodeURIComponent(value) : '#/library');
      }
    });
  }

  // ── Theme and locale ──────────────────────────────────────────────────

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }
  }

  function installChrome() {
    var stored = null;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));

    document.getElementById('theme-toggle').addEventListener('click', function () {
      applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    var localeSelect = document.getElementById('locale-select');
    i18n.availableLocales().forEach(function (locale) {
      localeSelect.appendChild(el('option', { value: locale.code, text: locale.label }));
    });
    var storedLocale = null;
    try { storedLocale = localStorage.getItem(LOCALE_KEY); } catch (e) { /* private mode */ }
    localeSelect.value = i18n.setLocale(storedLocale || (navigator.language || 'en').slice(0, 2));

    localeSelect.addEventListener('change', function () {
      i18n.setLocale(localeSelect.value);
      try { localStorage.setItem(LOCALE_KEY, localeSelect.value); } catch (e) { /* private mode */ }
      document.getElementById('search-input').placeholder = t('search.placeholder');
      document.getElementById('brand-sub').textContent = t('app.subtitle');
      updateAuthButton();
      renderRoute();
    });

    document.getElementById('brand-sub').textContent = t('app.subtitle');
    document.getElementById('auth-button').addEventListener('click', openAuthDialog);
  }

  // ── Boot ──────────────────────────────────────────────────────────────

  function boot() {
    installChrome();
    installSearch();
    installShortcuts();

    try { state.token = localStorage.getItem(TOKEN_KEY); } catch (e) { state.token = null; }

    // Taxonomy is loaded once and reused by the sidebar, the filters and
    // the editor, so switching views does not re-fetch it.
    Promise.all([
      api('/categories').catch(function () { return { categories: [] }; }),
      api('/projects').catch(function () { return { projects: [] }; }),
      api('/tags').catch(function () { return { tags: [] }; })
    ]).then(function (results) {
      state.categories = results[0].categories;
      state.projects = results[1].projects;
      state.tags = results[2].tags;

      if (state.token) {
        return api('/session').then(function (payload) {
          state.identity = payload.identity;
        }).catch(function () {
          // A token that is no longer valid is dropped rather than left to
          // fail every write with a confusing 401.
          state.token = null;
          try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* private mode */ }
        });
      }
      return null;
    }).then(function () {
      updateAuthButton();
      renderRoute();
    }).catch(function (err) {
      mount(el('div.empty', { text: t('error.load') }));
      reportError(err);
    });

    window.addEventListener('hashchange', renderRoute);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

}());
