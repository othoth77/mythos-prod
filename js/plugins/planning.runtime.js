// =====================================================
// MYTHOS OS — Planning Runtime Plugin
// js/plugins/planning.runtime.js
//
// Registers the Planning / Rappels module via the Plugin SDK
// and wires the bootstrap/initialization logic through the
// Platform lifecycle (Platform.ready() → onReady → _planningInit).
//
// What lives HERE:
//   - Plugin registration (replaces planning.plugin.js)
//   - onBoot: localStorage validation for mp_rappels and mp_rappel_types
//     (recover from malformed JSON, never delete valid data)
//   - onReady: idempotent init, MythosSearch provider registration,
//     MythosCalendar provider registration
//   - window.load fallback guard
//   - Search handler (late-bound: accesses localStorage at call time)
//   - Calendar provider (late-bound: accesses localStorage at call time)
//
// What stays in rappels.js / app.js:
//   - All rappel CRUD (getRappels, saveRappelsList, saveRappel, deleteRappel)
//   - All rendering (renderRappelsTable, openRappelsModal, closeRappelsModal,
//     openRappelsListModal, closeRappelsListModal, updateRappelsBadge)
//   - Recurrence logic (getNextRappelDate, periodeLabel, getRappelsForRdv)
//   - Rappel types management (getRappelTypes, saveRappelTypes, addRappelTypeIfNew)
//   - DOM creation for rappel modals (DOMContentLoaded handler in rappels.js)
//   - Badge logic
//   - Calendar rendering integration (app.js: filteredRappels → renderCalendrier)
//
// Storage keys (static — enumerable at registration):
//   mp_rappels       — array of rappel objects
//   mp_rappel_types  — array of strings (type names)
//
// Rappel object schema:
//   { id, titre, dateDebut, periode, details, type, createdAt, rdvId? }
//
// Depends on:  Plugin (js/core/plugin-sdk.js)
//              localStorage              [accessed directly at call time]
//              MythosSearch  (js/core/services/search.js)   [optional]
//              MythosCalendar (js/core/services/calendar.js) [optional]
// Loaded:      after js/core/plugin-sdk.js and tasks.runtime.js,
//              before contacts.runtime.js and js/app.js
// =====================================================

// ── State object ───────────────────────────────────────────────────────
var _PLANNING_RT_STATE = { initialized: false };

// ── Search handler ─────────────────────────────────────────────────────
//
// Late-bound: localStorage is accessed at call time, not at registration
// time. Searches mp_rappels entries by titre, type, and details.
//
// Rappel objects stored in mp_rappels have the shape:
//   { id, titre, dateDebut, periode, details, type, createdAt, rdvId? }
//
// Searchable fields: titre, type, details
// Result id prefix: 'plan-'
// Result type:      'planning'
// Result route:     null (planning is modal-based; no dedicated full-page route)
//
function _planningSearchHandler(query) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  var results = [];
  try {
    var raw = localStorage.getItem('mp_rappels');
    if (!raw) return [];
    var rappels;
    try { rappels = JSON.parse(raw); } catch(e) { return []; }
    if (!Array.isArray(rappels)) return [];
    for (var i = 0; i < rappels.length; i++) {
      try {
        var r = rappels[i];
        if (!r || typeof r !== 'object') continue;
        var fields = [
          String(r.titre   || '').toLowerCase(),
          String(r.type    || '').toLowerCase(),
          String(r.details || '').toLowerCase()
        ];
        var match = false;
        for (var j = 0; j < fields.length; j++) {
          if (fields[j] && fields[j].indexOf(q) !== -1) { match = true; break; }
        }
        if (match) {
          results.push({
            id:       'plan-' + r.id,
            title:    r.titre || 'Rappel',
            subtitle: r.type || (r.details ? String(r.details).slice(0, 60) : ''),
            type:     'planning',
            route:    null,
            data:     r
          });
        }
      } catch(e) { /* skip malformed entry */ }
    }
  } catch(e) { /* localStorage unavailable — silently skip */ }
  return results;
}

// ── Calendar provider ──────────────────────────────────────────────────
//
// Late-bound: localStorage is accessed at call time, not at registration.
// Returns rappels as calendar events using dateDebut as the start date.
// Filters by range.start and range.end (ISO date strings) when present.
// Entries with missing or invalid dateDebut are skipped gracefully.
// Returns [] if mp_rappels is empty or absent.
//
// Events are sorted chronologically by start (ascending).
//
// Event schema emitted:
//   { id, title, start (YYYY-MM-DD), end (null), allDay (true), route (null), data }
//
function _planningCalendarProvider(range) {
  var results = [];
  try {
    var raw = localStorage.getItem('mp_rappels');
    if (!raw) return results;
    var rappels;
    try { rappels = JSON.parse(raw); } catch(e) { return results; }
    if (!Array.isArray(rappels)) return results;
    var rangeStart = (range && range.start) ? String(range.start).slice(0, 10) : null;
    var rangeEnd   = (range && range.end)   ? String(range.end).slice(0, 10)   : null;
    for (var i = 0; i < rappels.length; i++) {
      try {
        var r = rappels[i];
        if (!r || typeof r !== 'object') continue;
        var d = r.dateDebut;
        if (!d || typeof d !== 'string') continue;
        var date = d.slice(0, 10);
        // Basic date format guard: must be YYYY-MM-DD
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        // Range filtering
        if (rangeStart && date < rangeStart) continue;
        if (rangeEnd   && date > rangeEnd)   continue;
        results.push({
          id:     'plan-' + r.id,
          title:  r.titre || 'Rappel',
          start:  date,
          end:    null,
          allDay: true,
          route:  null,
          data:   r
        });
      } catch(e) { /* skip malformed entry */ }
    }
  } catch(e) { /* localStorage unavailable — silently skip */ }
  // Sort chronologically
  results.sort(function(a, b) {
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });
  return results;
}

// ── Initialization guard ───────────────────────────────────────────────
//
// Called once from onReady() or from the window.load fallback.
// Guarded by _PLANNING_RT_STATE.initialized — safe to call multiple times.
// PluginServices also wires search.handler and calendar.provider from the
// manifest on 'mythos:plugin:registered'; the hasProvider() guard prevents
// duplicate registration if both paths run.
//
function _planningInit() {
  if (_PLANNING_RT_STATE.initialized) return;
  _PLANNING_RT_STATE.initialized = true;
  if (typeof MythosSearch !== 'undefined' && !MythosSearch.hasProvider('planning')) {
    MythosSearch.registerProvider({
      id:     'planning',
      label:  'Planning',
      order:  7,
      search: _planningSearchHandler
    });
  }
  if (typeof MythosCalendar !== 'undefined' && !MythosCalendar.hasProvider('planning')) {
    MythosCalendar.registerProvider({
      id:        'planning',
      label:     'Planning',
      order:     5,
      getEvents: _planningCalendarProvider
    });
  }
}

// ── Plugin registration ────────────────────────────────────────────────

Plugin.create({
  id: 'planning', label: 'Planning', version: '1.0.0', type: 'shared',

  onBoot: function() {
    // Validate localStorage for both planning storage keys.
    // Rule: only reset if the stored value is invalid JSON or a non-array.
    // Never delete valid data. Never overwrite a non-empty valid array.
    // If the key was never set (null), leave it untouched — rappels.js
    // handles the default (empty array) at first access.
    var keys = ['mp_rappels', 'mp_rappel_types'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (raw !== null) {
          try {
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) { localStorage.setItem(keys[i], '[]'); }
          } catch(e) {
            localStorage.setItem(keys[i], '[]');
          }
        }
      } catch(e) { /* localStorage unavailable — silently skip */ }
    }
  },

  onReady: function() { _planningInit(); }
})
.defineMenu({ section: 'Général', order: 4, icon: 'planning' })
.defineRoutes([])
.defineStorage(['mp_rappels', 'mp_rappel_types'])
.defineSearch({ handler: _planningSearchHandler })
.defineCalendar({ provider: _planningCalendarProvider })
.build();

// ── window.load fallback ───────────────────────────────────────────────
//
// If Platform.ready() is never called (e.g., during tests or partial
// bootstrap), this ensures initialization still happens once.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() {
    if (!_PLANNING_RT_STATE.initialized) { _planningInit(); }
  });
}
