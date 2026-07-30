// =====================================================
// MYTHOS OS — Production Plugin
// js/plugins/production.plugin.js
//
// Registers the Mythos Prod business application with
// the Platform registry. Metadata only — no business
// logic lives here. All rendering functions remain in
// js/app.js until their respective extraction stages.
//
// Loaded: after js/core/platform.js, before logger.js
// Depends on: Platform (js/core/platform.js)
//             Events  (js/core/events.js)
// =====================================================

Platform.registerPlugin({

  // ── Identity ──────────────────────────────────────
  id:          'production',
  label:       'Production',
  version:     '1.0.0',
  type:        'business',
  description: 'Gestion complète d\'une société de production événementielle : '
              + 'facturation, devis, contrats, ordres de mission, '
              + 'collaborateurs, comptabilité et répertoire client.',

  // ── Sidebar ───────────────────────────────────────
  menu: {
    section: 'Production',
    order:   10,
    icon:    'production'
  },

  // ── Routes ────────────────────────────────────────
  // All render functions remain in app.js for now.
  // The `render` field is null until extraction stages.
  routes: [
    // Dashboard
    { id: 'dashboard',              label: 'Tableau de bord',      icon: '📊', render: null },

    // Invoicing & quotes
    { id: 'list',                   label: 'Factures',             icon: '🧾', render: null },
    { id: 'new',                    label: 'Nouvelle facture',      icon: '➕', render: null },
    { id: 'devis',                  label: 'Devis',                icon: '📋', render: null },
    { id: 'devis-form',             label: 'Nouveau devis',         icon: '➕', render: null },
    { id: 'contracts',              label: 'Contrats',             icon: '📄', render: null },
    { id: 'contract-form',          label: 'Nouveau contrat',       icon: '➕', render: null },

    // Productions & shows
    { id: 'rendez-vous',            label: 'Rendez-vous',          icon: '📅', render: null },
    { id: 'representations',        label: 'Représentations',      icon: '🎭', render: null },

    // Missions
    { id: 'om-list',                label: 'Ordres de mission',    icon: '🗂️', render: null },
    { id: 'om-new',                 label: 'Nouvel OM',            icon: '➕', render: null },

    // People & taxonomy
    { id: 'clients',                label: 'Clients',              icon: '🏢', render: null },
    { id: 'collaborateurs',         label: 'Collaborateurs',       icon: '👥', render: null },
    { id: 'natures',                label: 'Natures de prestation', icon: '🏷️', render: null },
    { id: 'fournisseurs',           label: 'Fournisseurs',         icon: '🚚', render: null },

    // Accounting
    { id: 'comptabilite',           label: 'Comptabilité',         icon: '💳', render: null },
    { id: 'compta-bank',            label: 'Extrait bancaire',     icon: '🏦', render: null },
    { id: 'compta-cash',            label: 'Caisse',               icon: '💰', render: null },
    { id: 'compta-expenses',        label: 'Dépenses',             icon: '📉', render: null },
    { id: 'compta-purchases',       label: 'Factures achats',      icon: '🛒', render: null },
    { id: 'compta-suppliers',       label: 'Fournisseurs compta',  icon: '📦', render: null },
    { id: 'compta-categories',      label: 'Catégories dépenses',  icon: '🗂️', render: null },
    { id: 'compta-reconciliation',  label: 'Réconciliation',       icon: '🔄', render: null },

    // Stats & tools
    { id: 'statistique',            label: 'Statistiques',         icon: '📈', render: null },
    { id: 'calculateur-spectacle',  label: 'Calculateur spectacle', icon: '🎪', render: null },

    // Admin
    { id: 'inscriptions',           label: 'Inscriptions',         icon: '📝', render: null },
    { id: 'appel',                  label: 'Suivi des appels',     icon: '📞', render: null },
    { id: 'conformite',             label: 'Liste conforme',       icon: '✅', render: null },
    { id: 'sauvegarde',             label: 'Sauvegarde',           icon: '💾', render: null },
    { id: 'parametres',             label: 'Paramètres',           icon: '⚙️', render: null }
  ],

  // ── Storage keys owned by this plugin ────────────
  // Used by Platform for backup awareness and future
  // permission scoping. Does not affect current behaviour.
  storageKeys: [
    // Invoicing & contracts
    'mp_invoices',
    'mp_devis',
    'mp_contracts',
    // Productions & shows
    'mp_rdvs',
    'mp_representations',
    // Missions
    'mp_oms',
    // People
    'mp_clients',
    'mp_collabs',
    'mp_natures',
    // Accounting
    'mp_bank_entries',
    'mp_cash_entries',
    'mp_expenses',
    'mp_expense_categories',
    'mp_suppliers',
    'mp_purchases',
    // Assets
    'mp_vehicules',
    'mp_documents',
    // Inscriptions & calls
    'mp_validated_inscriptions',
    'mp_appels'
  ],

  // ── Lifecycle hooks ───────────────────────────────
  // Empty for now — business modules are still in app.js.
  // These will be populated as domains are extracted.
  onBoot: function () {
    // Future: verify required collections exist, run migrations
  },

  onReady: function () {
    // Future: register dashboard KPIs, calendar sources, search sources
  }

});
