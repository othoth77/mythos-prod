// =====================================================
// MYTHOS OS — Notes Plugin
// js/plugins/notes.plugin.js
//
// Registers the shared Notes / Rédaction application.
// Metadata only — all notes logic lives in redaction.js
// (_rdRender, _rdRenderDocView, _rdGetDocs, _rdSaveDocs,
//  _rdRenderParamCanvas, redactionPrint, etc.)
//
// Storage key pattern:
//   mp_rddocs_{cat}  — document list per category
//   mp_rdtpl_{docId} — template fields per document (dynamic)
//   mp_rdent_{docId} — entry values per document (dynamic)
//
// Current categories: "das" (Direction des arts scéniques)
//                     "autres"
//
// Loaded: after js/core/platform.js
// Depends on: Platform (js/core/platform.js)
// =====================================================

Platform.registerPlugin({

  id:          'notes',
  label:       'Rédaction',
  version:     '1.0.0',
  type:        'shared',
  description: 'Éditeur de documents à champs dynamiques : modèles '
              + 'personnalisables, catégories DAS et Autres, aperçu '
              + 'et impression. Chaque document a ses propres clés '
              + 'de template (mp_rdtpl_*) et d\'entrée (mp_rdent_*).',

  menu: {
    section: 'Général',
    order:   6,
    icon:    'notes'
  },

  routes: [
    { id: 'redaction-das',    label: 'Rédaction DAS',    icon: '📝', render: null },
    { id: 'redaction-autres', label: 'Rédaction Autres', icon: '📝', render: null }
  ],

  // Category-level document lists (one key per category).
  // Per-document template and entry keys (mp_rdtpl_*, mp_rdent_*)
  // are created dynamically and are not enumerable at registration time.
  storageKeys: [
    'mp_rddocs_das',
    'mp_rddocs_autres'
  ],

  onBoot:  function () {},
  onReady: function () {}

});
