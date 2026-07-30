// =====================================================
// MYTHOS OS — Tasks Runtime Plugin
// js/plugins/tasks.runtime.js
//
// Registers the Tasks module via the Plugin SDK and wires
// the bootstrap/initialization logic through the Platform
// lifecycle (Platform.ready() → onReady → _tasksInit).
//
// What lives HERE:
//   - Plugin registration (replaces tasks.plugin.js)
//   - Bootstrap logic moved from taches.js:
//       • Calendar header button injection
//       • renderCalendrier patch (integrate task cards)
//       • updateDashboardStats patch (task dashboard widget)
//       • showView patch (render task page on navigation)
//       • Initial dashboard render
//   - Search provider (finds tasks by note text)
//   - Calendar provider (exposes tasks with due dates)
//
// What stays in taches.js:
//   - All task CRUD (tachesSave, tachesDelete, etc.)
//   - All rendering functions (renderTachePage, etc.)
//   - Storage helpers (getTaches, saveTaches)
//   - UI utilities (_tchToast, _tchEsc, etc.)
//   - Synchronization (tachesManualSync)
//
// Depends on:  Plugin (js/core/plugin-sdk.js)
//              Events (js/core/events.js)
//              Shell  (js/core/shell.js)   [optional at build time]
// Loaded:      after js/core/plugin-sdk.js, before taches.js
// =====================================================

// State object — accessible as sandbox.Tasks_RT in tests
var _TASKS_RT_STATE = { initialized: false };

// ── Bootstrap / Initialization ────────────────────────────────────────
//
// Called once: from onReady() when Platform.ready() fires, OR from the
// window.load fallback if Platform lifecycle is not wired in the host app.
// Guarded by _TASKS_RT_STATE.initialized — safe to call multiple times.
//
function _tasksInit() {
  if (_TASKS_RT_STATE.initialized) return;
  _TASKS_RT_STATE.initialized = true;

  // 1. Add "📋 + Tâche" button to calendar header
  (function () {
    var calHeader = document.querySelector
      ? document.querySelector('#view-calendrier .page-header > div')
      : null;
    if (calHeader && typeof tachesOpenModal === 'function' &&
        !calHeader.querySelector('[data-tasks-cal-btn]')) {
      var btn = document.createElement('button');
      btn.className = 'btn btn-outline';
      btn.style.cssText = 'border-color:#d4af37;color:#d4af37;';
      btn.innerHTML = '📋 + Tâche';
      btn.setAttribute('data-tasks-cal-btn', '1');
      btn.onclick = function () { tachesOpenModal(); };
      calHeader.insertBefore(btn, calHeader.firstChild);
    }
  })();

  // 2. Patch renderCalendrier — inject task cards after calendar renders
  if (typeof renderCalendrier === 'function' &&
      typeof renderTachesInCalendrier === 'function') {
    var _origCal = renderCalendrier;
    renderCalendrier = function () {   // eslint-disable-line no-func-assign
      _origCal.apply(this, arguments);
      renderTachesInCalendrier();
    };
  }

  // 3. Patch updateDashboardStats — append task widget after stats update
  if (typeof updateDashboardStats === 'function' &&
      typeof renderTachesDashboard === 'function') {
    var _origDash = updateDashboardStats;
    updateDashboardStats = function () {  // eslint-disable-line no-func-assign
      _origDash.apply(this, arguments);
      renderTachesDashboard();
    };
  }

  // 4. Patch showView — render task page when navigating to 'tache'
  if (typeof showView === 'function' &&
      typeof renderTachePage === 'function') {
    var _origShow = showView;
    showView = function (viewName) {    // eslint-disable-line no-func-assign
      _origShow.apply(this, arguments);
      if (viewName === 'tache') renderTachePage();
    };
  }

  // 5. Initial dashboard widget render
  if (typeof renderTachesDashboard === 'function') {
    renderTachesDashboard();
  }

  // 6. Handle #tache in URL hash at load time
  if (typeof location !== 'undefined' && location.hash === '#tache' &&
      typeof renderTachePage === 'function') {
    renderTachePage();
  }

  // 7. Direct registration with runtime services (fallback if plugin-services.js
  //    did not handle automatic wiring, e.g. partial migration scenarios).
  if (typeof MythosSearch !== 'undefined' && !MythosSearch.hasProvider('tasks')) {
    MythosSearch.registerProvider({
      id:     'tasks',
      label:  'Taches',
      order:  3,
      search: function (query) {
        if (typeof getTaches !== 'function') return [];
        var q = String(query || '').toLowerCase();
        return getTaches()
          .filter(function (t) { return !t.archived && t.note && t.note.toLowerCase().indexOf(q) !== -1; })
          .map(function (t) { return { label: t.note.slice(0, 80), route: 'tache', data: t }; });
      }
    });
  }

  if (typeof MythosCalendar !== 'undefined' && !MythosCalendar.hasProvider('tasks')) {
    MythosCalendar.registerProvider({
      id:        'tasks',
      label:     'Taches',
      order:     3,
      getEvents: function (range) {
        if (typeof getTaches !== 'function') return [];
        var start = range && range.start ? new Date(range.start) : new Date(0);
        var end   = range && range.end   ? new Date(range.end)   : new Date(8.64e15);
        return getTaches()
          .filter(function (t) { return !t.archived && t.dueDate && new Date(t.dueDate) >= start && new Date(t.dueDate) <= end; })
          .map(function (t) { return { id: 'task-' + t.id, title: t.note.slice(0, 60), start: t.dueDate, allDay: true, route: 'tache', data: t }; });
      }
    });
  }
}

// ── Plugin registration via SDK ───────────────────────────────────────

Plugin.create({
  id:      'tasks',
  label:   'Tâches',
  version: '1.0.0',
  type:    'shared',

  onBoot: function () {
    // Validate storage key early (before taches.js runs)
    try {
      var raw = localStorage.getItem('mp_taches');
      if (raw !== null && raw.charAt(0) !== '[') {
        localStorage.setItem('mp_taches', '[]');
      }
    } catch (e) {}
  },

  onReady: function () {
    // Platform.ready() fires after all plugins boot and data is loaded.
    // By this point taches.js is guaranteed to have executed (it is a
    // blocking <script> tag declared before app.js which calls Platform.ready).
    _tasksInit();
  }

})
.defineMenu({
  section: 'Général',
  order:   3,
  icon:    'tasks'
})
.defineRoutes([
  { id: 'tache', label: 'Mes Tâches', icon: '📋' }
])
.defineStorage([
  'mp_taches'
])
.defineSearch({
  // Handler is a late-bound wrapper — getTaches() exists at call time
  // even though taches.js is not yet loaded when this manifest is built.
  handler: function (query) {
    if (typeof getTaches !== 'function') return [];
    var q = String(query || '').toLowerCase();
    return getTaches()
      .filter(function (t) {
        return !t.archived && t.note &&
               t.note.toLowerCase().indexOf(q) !== -1;
      })
      .map(function (t) {
        return {
          label: t.note.slice(0, 80) + (t.note.length > 80 ? '…' : ''),
          route: 'tache',
          data:  t
        };
      });
  }
})
.defineCalendar({
  // Provider is a late-bound wrapper — getTaches() exists at call time.
  provider: function (range) {
    if (typeof getTaches !== 'function') return [];
    var start = range && range.start ? new Date(range.start) : new Date(0);
    var end   = range && range.end   ? new Date(range.end)   : new Date(8.64e15);
    return getTaches()
      .filter(function (t) {
        if (!t.dueDate || t.archived) return false;
        var d = new Date(t.dueDate);
        return d >= start && d <= end;
      })
      .map(function (t) {
        return {
          id:    'task-' + t.id,
          title: t.note.slice(0, 60) + (t.note.length > 60 ? '…' : ''),
          date:  t.dueDate,
          type:  'task',
          data:  t
        };
      });
  }
})
.build();

// ── Fallback: fire _tasksInit on window.load ──────────────────────────
//
// If Platform.ready() is never called by the host application
// (e.g., during a partial migration or in environments without the
//  Platform lifecycle wired up), ensure Tasks still initializes.
// The guard inside _tasksInit() prevents double-execution.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function () {
    if (!_TASKS_RT_STATE.initialized) { _tasksInit(); }
  });
}
