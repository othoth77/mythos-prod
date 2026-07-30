// =====================================================
// MYTHOS OS — Tasks Plugin
// js/plugins/tasks.plugin.js
//
// Registers the shared Tasks application.
// Metadata only — all task logic lives in taches.js
// (getTaches, saveTaches, tachesOpenModal, renderTachePage,
//  renderTachesDashboard, renderTachesInCalendrier, etc.)
//
// Loaded: after js/core/platform.js
// Depends on: Platform (js/core/platform.js)
// =====================================================

Platform.registerPlugin({

  id:          'tasks',
  label:       'Tâches',
  version:     '1.0.0',
  type:        'shared',
  description: 'Gestionnaire de tâches : création, priorité (simple / '
              + 'importante / urgente), épinglage, archivage et widget '
              + 'intégré dans le dashboard et le calendrier.',

  menu: {
    section: 'Général',
    order:   3,
    icon:    'tasks'
  },

  routes: [
    { id: 'tache', label: 'Mes Tâches', icon: '📋', render: null }
  ],

  storageKeys: [
    'mp_taches'
  ],

  onBoot:  function () {},
  onReady: function () {}

});
