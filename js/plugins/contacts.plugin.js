// =====================================================
// MYTHOS OS — Contacts Plugin
// js/plugins/contacts.plugin.js
//
// Registers the shared Contacts / Répertoire application.
// Metadata only — all contact logic lives in app.js
// (renderRepertoireContactsPage, renderRepertoireImportsHistory,
//  importPhoneContacts, deleteRepertoireContact,
//  renderContactFiche, renderContactsDirectory,
//  _rcFilterBatchId, _rcRenderDuplicatesBanner, etc.)
//
// Loaded: after js/core/platform.js
// Depends on: Platform (js/core/platform.js)
// =====================================================

Platform.registerPlugin({

  id:          'contacts',
  label:       'Contacts',
  version:     '1.0.0',
  type:        'shared',
  description: 'Répertoire de contacts : import depuis le téléphone ou CSV, '
              + 'déduplication, annuaire filtrable, fiche individuelle avec '
              + 'historique des interactions, tags et export.',

  menu: {
    section: 'Général',
    order:   5,
    icon:    'contacts'
  },

  routes: [
    { id: 'gestion-contacts', label: 'Répertoire',    icon: '👥', render: null },
    { id: 'contact-fiche',    label: 'Fiche contact', icon: '👤', render: null }
  ],

  storageKeys: [
    'mp_repertoire_contacts',
    'mp_repertoire_imports'
  ],

  onBoot:  function () {},
  onReady: function () {}

});
