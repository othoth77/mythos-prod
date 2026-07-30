// =====================================================
// MYTHOS OS — Calendar Plugin
// js/plugins/calendar.plugin.js
//
// Registers the shared Calendar application.
// Metadata only — rendering lives in app.js
// (renderCalendrier, patched in taches.js for task overlay).
//
// The calendar view aggregates events from:
//   mp_rdvs, mp_representations (owned by production)
//   mp_taches                   (owned by tasks plugin)
// It does not own storage keys of its own.
//
// Loaded: after js/core/platform.js
// Depends on: Platform (js/core/platform.js)
// =====================================================

Platform.registerPlugin({

  id:          'calendar',
  label:       'Calendrier',
  version:     '1.0.0',
  type:        'shared',
  description: 'Vue calendrier mensuelle affichant rendez-vous, '
              + 'représentations et tâches sur une grille temporelle. '
              + 'Données agrégées depuis les modules Production et Tâches.',

  menu: {
    section: 'Général',
    order:   2,
    icon:    'calendar'
  },

  routes: [
    { id: 'calendrier', label: 'Calendrier', icon: '📅', render: null }
  ],

  // Calendar reads from production (mp_rdvs, mp_representations)
  // and tasks (mp_taches). It owns no storage of its own.
  storageKeys: [],

  onBoot:  function () {},
  onReady: function () {}

});
