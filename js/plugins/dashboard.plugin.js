// =====================================================
// MYTHOS OS — Dashboard Plugin
// js/plugins/dashboard.plugin.js
//
// Registers the shared Dashboard application.
// Metadata only — rendering lives in app.js
// (updateDashboardStats, loadDashboardInscriptionsCount).
//
// The dashboard aggregates KPIs from other plugins'
// storage keys. It owns no storage of its own.
//
// Loaded: after js/core/platform.js
// Depends on: Platform (js/core/platform.js)
// =====================================================

Platform.registerPlugin({

  id:          'dashboard',
  label:       'Dashboard',
  version:     '1.0.0',
  type:        'shared',
  description: 'Vue synthétique de l\'activité : KPIs factures, '
              + 'clients, contrats, ordres de mission, solde bancaire '
              + 'et taux de recouvrement.',

  menu: {
    section: 'Général',
    order:   1,
    icon:    'dashboard'
  },

  routes: [
    { id: 'dashboard', label: 'Tableau de bord', icon: '🏠', render: null }
  ],

  // Dashboard reads from other plugins' keys for KPI aggregation.
  // It does not own storage of its own.
  storageKeys: [],

  onBoot:  function () {},
  onReady: function () {}

});
