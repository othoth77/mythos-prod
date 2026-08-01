// =====================================================
// MYTHOS OS — Calendar Runtime Plugin
// js/plugins/calendar.runtime.js
//
// Registers the shared Calendar application via the
// Plugin SDK. Replaces calendar.plugin.js.
//
// DESIGN PRINCIPLE — Calendar is an AGGREGATION LAYER:
//   - It does NOT own external business data.
//   - It does NOT register a search provider (no own data to search).
//   - It does NOT register a calendar provider (it IS the consumer).
//   - It reads aggregated events from MythosCalendar, which is fed by:
//       tasks.runtime.js   → provider id 'tasks'
//       planning.runtime.js → provider id 'planning'
//
// What lives HERE:
//   - Plugin registration (replaces calendar.plugin.js)
//   - onBoot: no-op (calendar has no own storage keys)
//   - onReady: initialize once, wire lifecycle guard
//   - window.load fallback
//
// What lives in js/shared/calendar.js (Stage 4D extraction):
//   - renderCalendrier()     — main calendar render function
//   - setCalFilter()         — filter mode setter
//   - _calDateLabel()        — date label helper
//   - _calDateSeparator()    — date separator HTML helper
//   - _calRenderItem()       — card renderer
//   - calFilterMode          — filter state variable
//
// What stays in app.js:
//   - All rdv CRUD functions (rdvOpenForm, rdvSave, rdvEdit, etc.)
//
// Rendering is triggered by showView('calendrier') in router.js:
//   if (view === 'calendrier') renderCalendrier();
//
// Depends on: Plugin (js/core/plugin-sdk.js)
// Loaded:     after js/core/plugin-sdk.js, before tasks.runtime.js
// =====================================================

// ── State guard — idempotent init ────────────────────────────────────
var _CALENDAR_RT_STATE = { initialized: false };

// ── _calendarInit ─────────────────────────────────────────────────────
//
// Called once: from onReady() when Platform.ready() fires, OR from the
// window.load fallback if Platform lifecycle is not wired in the host app.
// Guarded by _CALENDAR_RT_STATE.initialized — safe to call multiple times.
//
// Calendar rendering is already wired in app.js via showView():
//   if (view === 'calendrier') renderCalendrier();
// This function does NOT call renderCalendrier() directly — it provides
// no forced render at initialization time.
//
// MythosCalendar aggregation: renderCalendrier() (in app.js) currently
// reads STORE.rdvs() and getRappels() directly. A future stage may
// replace those calls with MythosCalendar.getEvents(range) so that all
// registered providers (tasks, planning) are consumed uniformly.
// That refactor is deferred — this stage only migrates the bootstrap.
//
function _calendarInit() {
  if (_CALENDAR_RT_STATE.initialized) return;
  _CALENDAR_RT_STATE.initialized = true;

  // Calendar has no initialization side-effects to run at boot:
  //   - Navigation hook is already wired in app.js showView()
  //   - No MythosCalendar provider to register (Calendar is the consumer)
  //   - No MythosSearch provider (Calendar has no own data)
  //   - No dashboard widget to inject
  // A future stage may add provider-registration wiring here when
  // renderCalendrier() is refactored to use MythosCalendar.getEvents().
}

// ── Plugin registration via SDK ───────────────────────────────────────

Plugin.create({
  id:      'calendar',
  label:   'Calendrier',
  version: '1.0.0',
  type:    'shared',

  onBoot: function () {
    // Calendar owns no storage keys — nothing to validate.
    // Event data lives in mp_rdvs (production), mp_taches (tasks),
    // mp_rappels (planning). Those plugins handle their own storage
    // validation in their respective onBoot handlers.
  },

  onReady: function () {
    // Platform.ready() fires after all plugins have booted and data is loaded.
    // Wire the lifecycle guard; rendering is triggered by showView() in app.js.
    _calendarInit();
  }

})
.defineMenu({
  section: 'Général',
  order:   2,
  icon:    'calendar'
})
.defineRoutes([
  { id: 'calendrier', label: 'Calendrier', icon: '📅' }
])
.defineStorage([])
.build();

// ── Fallback: fire _calendarInit on window.load ───────────────────────
//
// If Platform.ready() is never called by the host application
// (e.g., during a partial migration or in environments without the
//  Platform lifecycle wired up), ensure Calendar still initializes.
// The guard inside _calendarInit() prevents double-execution.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function () {
    if (!_CALENDAR_RT_STATE.initialized) { _calendarInit(); }
  });
}
