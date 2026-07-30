// =====================================================
// MYTHOS OS — Planning Plugin
// js/plugins/planning.plugin.js
//
// Registers the shared Planning / Rappels application.
// Metadata only — all reminder logic lives in rappels.js
// (getRappels, saveRappelsList, getRappelTypes, saveRappelTypes,
//  renderRappels, renderRappelsTable, openRappelModal, etc.)
//
// Planning has no dedicated full-page route: reminders are
// accessed via a floating modal (#rappel-types-modal) and
// widgets embedded inside the Calendrier view and Dashboard.
// Routes will be added when a dedicated planning page is built.
//
// Loaded: after js/core/platform.js
// Depends on: Platform (js/core/platform.js)
// =====================================================

Platform.registerPlugin({

  id:          'planning',
  label:       'Planning',
  version:     '1.0.0',
  type:        'shared',
  description: 'Système de rappels récurrents : types personnalisables, '
              + 'périodicité (quotidien / hebdomadaire / mensuel / annuel), '
              + 'widget calendrier. Accessible via modal depuis toute vue.',

  menu: {
    section: 'Général',
    order:   4,
    icon:    'planning'
  },

  // No dedicated full-page route yet: rappels are modal/widget-based.
  // A standalone /planning view will be added in a future stage.
  routes: [],

  storageKeys: [
    'mp_rappels',
    'mp_rappel_types'
  ],

  onBoot:  function () {},
  onReady: function () {}

});
