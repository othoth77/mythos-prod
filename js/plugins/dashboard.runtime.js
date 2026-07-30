// =====================================================
// MYTHOS OS — Dashboard Runtime Plugin
// js/plugins/dashboard.runtime.js
//
// Registers the shared Dashboard application via the
// Plugin SDK. Replaces dashboard.plugin.js.
//
// DESIGN PRINCIPLE — Dashboard is a PURE AGGREGATION CONSUMER:
//   - It does NOT own any storage of its own.
//   - It does NOT register a search provider (no own data to search).
//   - It does NOT register a calendar provider (it is not a calendar source).
//   - It READS from other plugins via existing global functions:
//       updateDashboardStats()           — reads STORE.invoices/clients/oms/contracts/...
//       updateDashboardOperational()     — reads STORE.rdvs/oms/representations/...
//       loadDashboardInscriptionsCount() — reads external Google Sheets feed
//       renderTachesDashboard()          — reads mp_taches (owned by tasks)
//
// What lives HERE:
//   - Plugin registration (replaces dashboard.plugin.js)
//   - onBoot: no-op (Dashboard owns no storage keys)
//   - onReady: initialize once, wire lifecycle guard, register widgets when available
//   - window.load fallback
//
// What stays in app.js (untouched):
//   - updateDashboardStats()            — KPI aggregation, KPI DOM writes
//   - updateDashboardOperational()      — operational section renderer
//   - loadDashboardInscriptionsCount()  — external inscriptions fetch
//   - renderBackupDashboard()           — backup dashboard view
//   - currentPage / navigateTo()        — legacy navigation state
//   - showView('dashboard')             — triggers updateDashboardStats() + inscriptions load
//
// Rendering is triggered by showView('dashboard') in app.js:
//   if (view === 'dashboard') { updateDashboardStats(); loadDashboardInscriptionsCount(); }
//
// Depends on: Plugin (js/core/plugin-sdk.js)
// Loaded:     after js/core/plugin-sdk.js, before calendar.runtime.js
// =====================================================

// ── State guard — idempotent init ────────────────────────────────────
var _DASHBOARD_RT_STATE = { initialized: false };

// ── _dashboardInit ────────────────────────────────────────────────────
//
// Called once: from onReady() when Platform.ready() fires, OR from the
// window.load fallback if Platform lifecycle is not wired in the host app.
// Guarded by _DASHBOARD_RT_STATE.initialized — safe to call multiple times.
//
// Dashboard has no initialization side-effects requiring MythosWidgets
// registration at this stage: the dashboard DOM zones (dash-taches-zone,
// dashboard-recent-invoices, dashboard-upcoming-rdvs, etc.) are written to
// directly by updateDashboardStats(), updateDashboardOperational(), and
// renderTachesDashboard() — they are not wrapped in MythosWidgets.register()
// in the current codebase.
//
// The guard pattern and MythosWidgets scaffolding is kept in place so that
// a future stage can add widget registrations here without modifying the
// plugin structure.
//
function _dashboardInit() {
  if (_DASHBOARD_RT_STATE.initialized) return;
  _DASHBOARD_RT_STATE.initialized = true;

  // Dashboard is a pure aggregation consumer:
  //   - Navigation hook is already wired in app.js showView()
  //   - No MythosCalendar provider (Dashboard does not produce calendar events)
  //   - No MythosSearch provider (Dashboard has no own data to search)
  //   - No MythosWidgets to register at this stage:
  //       renderTachesDashboard()  — injected by tasks.runtime.js into dash-taches-zone
  //       updateDashboardStats()   — writes KPI DOM elements directly in app.js
  //     A future stage may wrap these in MythosWidgets.register() calls here.
  //
  // Graceful guard: if MythosWidgets is available, future code can extend here:
  // if (typeof MythosWidgets !== 'undefined') { ... }
}

// ── Plugin registration via SDK ───────────────────────────────────────

Plugin.create({
  id:      'dashboard',
  label:   'Dashboard',
  version: '1.0.0',
  type:    'shared',

  onBoot: function () {
    // Dashboard owns no storage keys.
    // All data it displays is owned by other plugins:
    //   production plugin: mp_invoices, mp_clients, mp_oms, mp_contracts,
    //                      mp_rdvs, mp_bank_entries, mp_cash_entries,
    //                      mp_representations, mp_expenses, mp_validated_inscriptions
    //   tasks plugin:      mp_taches
    // No localStorage recovery needed here.
  },

  onReady: function () {
    // Platform.ready() fires after all plugins have booted and data is loaded.
    // Wire the lifecycle guard; rendering is triggered by showView() in app.js.
    _dashboardInit();
  }

})
.defineMenu({
  section: 'Général',
  order:   1,
  icon:    'dashboard'
})
.defineRoutes([
  { id: 'dashboard', label: 'Tableau de bord', icon: '🏠', render: null }
])
.defineStorage([])
.build();

// ── Fallback: fire _dashboardInit on window.load ──────────────────────
//
// If Platform.ready() is never called by the host application
// (e.g., during a partial migration or in environments without the
//  Platform lifecycle wired up), ensure Dashboard still initializes.
// The guard inside _dashboardInit() prevents double-execution.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function () {
    if (!_DASHBOARD_RT_STATE.initialized) { _dashboardInit(); }
  });
}
