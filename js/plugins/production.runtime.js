// =====================================================
// MYTHOS OS — Production Runtime Plugin
// js/plugins/production.runtime.js
//
// Registers the Production business plugin via the
// Plugin SDK. Replaces production.plugin.js.
//
// DESIGN PRINCIPLE — Production is the PRIMARY DATA OWNER:
//   - It OWNS all core business collections (invoices, devis,
//     contracts, RDVs, OMs, clients, collabs, accounting, etc.).
//   - It REGISTERS a MythosSearch provider across all collections.
//   - It REGISTERS a MythosCalendar provider for dated events
//     (RDVs via mp_rdvs and representations via mp_representations).
//   - It validates its own storage on boot (JSON parse + array guard).
//   - Dashboard statistics (updateDashboardStats, updateDashboardOperational)
//     stay in app.js and are triggered by showView('dashboard') unchanged.
//
// What lives HERE:
//   - Plugin registration via Plugin SDK (replaces production.plugin.js)
//   - onBoot: localStorage validation for all 20 owned storage keys
//   - onReady: idempotent _productionInit(), search + calendar registration
//   - window.load fallback guard
//   - _productionSearchHandler  — late-bound, reads STORE at call time
//   - _productionCalendarProvider — late-bound, reads STORE at call time
//
// What lives in js/shared/natures.js (Stage 4F extraction):
//   - renderNatures, showNatureDetail, openNatureModal,
//     closeNatureModal, saveNature, deleteNature
//
// What stays in app.js:
//   - Remaining CRUD (saveInvoice, saveDevis, saveClient, rdvSave, omSave, …)
//   - All other rendering (renderInvoiceList, renderClientsList, rdvList, …)
//   - Business logic (getInvoiceTotal, normalizeRdv, getRdvAmount, …)
//   - loadDashboardInscriptionsCount()
//   - Sync engine (syncFromServer, _buildPendingBulk, sendBeacon, …)
//   - STORE object and all its accessors
//   - Print/export functions
//
// Search collections: invoices, clients, devis, contracts, rdvs,
//                     oms, representations, collabs
// Calendar collections: rdvs (mp_rdvs), representations (mp_representations)
//
// Depends on:  Plugin (js/core/plugin-sdk.js)
//              STORE  (js/app.js)              [accessed at call time]
//              MythosSearch  (js/core/services/search.js)   [optional]
//              MythosCalendar (js/core/services/calendar.js) [optional]
// Loaded:      after js/core/plugin-sdk.js, before dashboard.runtime.js
// =====================================================

// ── State guard — idempotent init ────────────────────────────────────
var _PRODUCTION_RT_STATE = { initialized: false };

// ── _productionSearchHandler ───────────────────────────────────────────
//
// Late-bound: STORE is accessed at call time, not at registration time.
// Searches across 8 Production collections and returns normalized results.
//
// Searched collections and matched fields:
//   invoices       mp_invoices      clientName, num
//   clients        mp_clients       name, contact, tel, email
//   devis          mp_devis         clientName, num
//   contracts      mp_contracts     clientName, ref
//   rdvs           mp_rdvs          nature, client, lieu, notes
//   oms            mp_oms           destination, chauffeur, num
//   representations mp_representations  spectacle, clientName
//   collabs        mp_collabs       nom, role
//
// Result schema: { id, providerId, type, title, subtitle, route, data }
//   id prefix:  'prod-'
//   type:       'production'
//
function _productionSearchHandler(query) {
  if (typeof STORE === 'undefined') return [];
  var q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  var results = [];

  // ── Helper: safe accessor ──────────────────────────────────────────
  function safeList(accessor) {
    try {
      if (typeof accessor !== 'function') return [];
      var arr = accessor();
      return Array.isArray(arr) ? arr : [];
    } catch(e) { return []; }
  }

  // ── Helper: matches any of the given field values ──────────────────
  function matches(entry, fields) {
    if (!entry || typeof entry !== 'object') return false;
    for (var i = 0; i < fields.length; i++) {
      var v = String(entry[fields[i]] || '').toLowerCase();
      if (v && v.indexOf(q) !== -1) return true;
    }
    return false;
  }

  // ── 1. Invoices ────────────────────────────────────────────────────
  safeList(STORE.invoices).forEach(function(inv) {
    try {
      if (!inv || !inv.id) return;
      if (!matches(inv, ['clientName', 'num'])) return;
      results.push({
        id:       'prod-' + inv.id,
        title:    inv.clientName || inv.num || 'Facture',
        subtitle: (inv.num || '') + (inv.status ? ' · ' + inv.status : ''),
        type:     'production',
        route:    'list',
        data:     inv
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 2. Clients ─────────────────────────────────────────────────────
  safeList(STORE.clients).forEach(function(c) {
    try {
      if (!c || !c.id) return;
      if (!matches(c, ['name', 'contact', 'tel', 'email'])) return;
      results.push({
        id:       'prod-' + c.id,
        title:    c.name || c.contact || 'Client',
        subtitle: c.tel || c.email || '',
        type:     'production',
        route:    'clients',
        data:     c
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 3. Devis ───────────────────────────────────────────────────────
  safeList(STORE.devis).forEach(function(d) {
    try {
      if (!d || !d.id) return;
      if (!matches(d, ['clientName', 'num'])) return;
      results.push({
        id:       'prod-' + d.id,
        title:    d.clientName || d.num || 'Devis',
        subtitle: d.num || '',
        type:     'production',
        route:    'devis',
        data:     d
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 4. Contracts ───────────────────────────────────────────────────
  safeList(STORE.contracts).forEach(function(ct) {
    try {
      if (!ct || !ct.id) return;
      if (!matches(ct, ['clientName', 'ref'])) return;
      results.push({
        id:       'prod-' + ct.id,
        title:    ct.clientName || ct.ref || 'Contrat',
        subtitle: ct.ref || ct.date || '',
        type:     'production',
        route:    'contracts',
        data:     ct
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 5. RDVs ────────────────────────────────────────────────────────
  safeList(STORE.rdvs).forEach(function(r) {
    try {
      if (!r || !r.id) return;
      if (!matches(r, ['nature', 'client', 'lieu', 'notes'])) return;
      results.push({
        id:       'prod-' + r.id,
        title:    r.nature || 'Rendez-vous',
        subtitle: (r.client || '') + (r.date ? ' · ' + r.date : ''),
        type:     'production',
        route:    'rendez-vous',
        data:     r
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 6. OMs ─────────────────────────────────────────────────────────
  safeList(STORE.oms).forEach(function(om) {
    try {
      if (!om || !om.id) return;
      if (!matches(om, ['destination', 'chauffeur', 'num'])) return;
      results.push({
        id:       'prod-' + om.id,
        title:    om.destination || om.num || 'Ordre de mission',
        subtitle: om.chauffeur || om.date || '',
        type:     'production',
        route:    'om-list',
        data:     om
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 7. Representations ─────────────────────────────────────────────
  safeList(STORE.representations).forEach(function(rep) {
    try {
      if (!rep || !rep.id) return;
      if (!matches(rep, ['spectacle', 'clientName'])) return;
      results.push({
        id:       'prod-' + rep.id,
        title:    rep.spectacle || 'Représentation',
        subtitle: rep.clientName || rep.date || '',
        type:     'production',
        route:    'representations',
        data:     rep
      });
    } catch(e) { /* skip malformed entry */ }
  });

  // ── 8. Collabs ─────────────────────────────────────────────────────
  safeList(STORE.collabs).forEach(function(col) {
    try {
      if (!col || !col.id) return;
      if (!matches(col, ['nom', 'role'])) return;
      results.push({
        id:       'prod-' + col.id,
        title:    col.nom || 'Collaborateur',
        subtitle: col.role || '',
        type:     'production',
        route:    'collaborateurs',
        data:     col
      });
    } catch(e) { /* skip malformed entry */ }
  });

  return results;
}

// ── _productionCalendarProvider ───────────────────────────────────────
//
// Late-bound: STORE is accessed at call time, not at registration.
// Exposes two dated event types:
//   • RDVs            (mp_rdvs)            — date field, route: rendez-vous
//   • Representations (mp_representations) — date field, route: representations
//
// Events are sorted chronologically by start (ascending).
// Entries with missing or invalid date are skipped gracefully.
// Range filtering: [range.start, range.end] (ISO date strings).
// Returns a Promise (async-safe per MythosCalendar contract).
//
// Normalized event schema:
//   { id, title, start (YYYY-MM-DD), end (null), allDay (true), route, data }
//
function _productionCalendarProvider(range) {
  var results = [];
  if (typeof STORE === 'undefined') return Promise.resolve(results);

  var rangeStart = (range && range.start) ? String(range.start).slice(0, 10) : null;
  var rangeEnd   = (range && range.end)   ? String(range.end).slice(0, 10)   : null;

  // Validate YYYY-MM-DD format
  var dateRe = /^\d{4}-\d{2}-\d{2}$/;

  // ── RDVs ──────────────────────────────────────────────────────────
  try {
    var rdvList = typeof STORE.rdvs === 'function' ? STORE.rdvs() : [];
    if (!Array.isArray(rdvList)) rdvList = [];
    rdvList.forEach(function(r) {
      try {
        if (!r || typeof r !== 'object') return;
        var d = r.date;
        if (!d || typeof d !== 'string') return;
        var date = d.slice(0, 10);
        if (!dateRe.test(date)) return;
        if (rangeStart && date < rangeStart) return;
        if (rangeEnd   && date > rangeEnd)   return;
        results.push({
          id:     'prod-rdv-' + r.id,
          title:  (r.nature || 'RDV') + (r.client ? ' — ' + r.client : ''),
          start:  date,
          end:    null,
          allDay: true,
          route:  'rendez-vous',
          data:   r
        });
      } catch(e) { /* skip malformed entry */ }
    });
  } catch(e) { /* STORE.rdvs unavailable */ }

  // ── Representations ────────────────────────────────────────────────
  try {
    var repList = typeof STORE.representations === 'function' ? STORE.representations() : [];
    if (!Array.isArray(repList)) repList = [];
    repList.forEach(function(rep) {
      try {
        if (!rep || typeof rep !== 'object') return;
        var d = rep.date;
        if (!d || typeof d !== 'string') return;
        var date = d.slice(0, 10);
        if (!dateRe.test(date)) return;
        if (rangeStart && date < rangeStart) return;
        if (rangeEnd   && date > rangeEnd)   return;
        results.push({
          id:     'prod-rep-' + rep.id,
          title:  rep.spectacle || 'Représentation',
          start:  date,
          end:    null,
          allDay: true,
          route:  'representations',
          data:   rep
        });
      } catch(e) { /* skip malformed entry */ }
    });
  } catch(e) { /* STORE.representations unavailable */ }

  // Sort chronologically
  results.sort(function(a, b) {
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });

  return Promise.resolve(results);
}

// ── _productionInit ───────────────────────────────────────────────────
//
// Called once: from onReady() when Platform.ready() fires, OR from the
// window.load fallback if Platform lifecycle is not wired in the host app.
// Guarded by _PRODUCTION_RT_STATE.initialized — safe to call multiple times.
//
function _productionInit() {
  if (_PRODUCTION_RT_STATE.initialized) return;
  _PRODUCTION_RT_STATE.initialized = true;

  if (typeof MythosSearch !== 'undefined' && !MythosSearch.hasProvider('production')) {
    MythosSearch.registerProvider({
      id:     'production',
      label:  'Production',
      order:  10,
      search: _productionSearchHandler
    });
  }

  if (typeof MythosCalendar !== 'undefined' && !MythosCalendar.hasProvider('production')) {
    MythosCalendar.registerProvider({
      id:        'production',
      label:     'Production',
      order:     10,
      getEvents: _productionCalendarProvider
    });
  }
}

// ── Plugin registration via SDK ───────────────────────────────────────

Plugin.create({
  id:      'production',
  label:   'Production',
  version: '1.0.0',
  type:    'business',

  onBoot: function() {
    // Validate each owned storage key.
    // Rule: if the stored value is malformed JSON or a non-array → reset to '[]'.
    //       If the key was never set (null) → leave untouched (STORE handles default).
    //       Valid arrays (including []) are never overwritten.
    var keys = [
      'mp_invoices',
      'mp_devis',
      'mp_contracts',
      'mp_rdvs',
      'mp_rendez_vous',
      'mp_representations',
      'mp_oms',
      'mp_clients',
      'mp_collabs',
      'mp_natures',
      'mp_bank_entries',
      'mp_cash_entries',
      'mp_expenses',
      'mp_expense_categories',
      'mp_suppliers',
      'mp_purchases',
      'mp_vehicules',
      'mp_documents',
      'mp_validated_inscriptions',
      'mp_appels'
    ];
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
        // null → untouched (STORE will return default '[]' on first read)
      } catch(e) { /* localStorage unavailable — silently skip */ }
    }
  },

  onReady: function() {
    // Platform.ready() fires after all plugins have booted and data is loaded.
    // app.js is guaranteed to have executed by this point, so STORE is available.
    _productionInit();
  }

})
.defineMenu({
  section: 'Production',
  order:   10,
  icon:    'production'
})
.defineRoutes([
  // Dashboard
  { id: 'dashboard',              label: 'Tableau de bord',       icon: '📊', render: null },
  // Invoicing & quotes
  { id: 'list',                   label: 'Factures',              icon: '🧾', render: null },
  { id: 'new',                    label: 'Nouvelle facture',       icon: '➕', render: null },
  { id: 'devis',                  label: 'Devis',                 icon: '📋', render: null },
  { id: 'devis-form',             label: 'Nouveau devis',          icon: '➕', render: null },
  { id: 'contracts',              label: 'Contrats',              icon: '📄', render: null },
  { id: 'contract-form',          label: 'Nouveau contrat',        icon: '➕', render: null },
  // Productions & shows
  { id: 'rendez-vous',            label: 'Rendez-vous',           icon: '📅', render: null },
  { id: 'representations',        label: 'Représentations',       icon: '🎭', render: null },
  // Missions
  { id: 'om-list',                label: 'Ordres de mission',     icon: '🗂️', render: null },
  { id: 'om-new',                 label: 'Nouvel OM',             icon: '➕', render: null },
  // People & taxonomy
  { id: 'clients',                label: 'Clients',               icon: '🏢', render: null },
  { id: 'collaborateurs',         label: 'Collaborateurs',        icon: '👥', render: null },
  { id: 'natures',                label: 'Natures de prestation',  icon: '🏷️', render: null },
  { id: 'fournisseurs',           label: 'Fournisseurs',          icon: '🚚', render: null },
  // Accounting
  { id: 'comptabilite',           label: 'Comptabilité',          icon: '💳', render: null },
  { id: 'compta-bank',            label: 'Extrait bancaire',      icon: '🏦', render: null },
  { id: 'compta-cash',            label: 'Caisse',                icon: '💰', render: null },
  { id: 'compta-expenses',        label: 'Dépenses',              icon: '📉', render: null },
  { id: 'compta-purchases',       label: 'Factures achats',       icon: '🛒', render: null },
  { id: 'compta-suppliers',       label: 'Fournisseurs compta',   icon: '📦', render: null },
  { id: 'compta-categories',      label: 'Catégories dépenses',   icon: '🗂️', render: null },
  { id: 'compta-reconciliation',  label: 'Réconciliation',        icon: '🔄', render: null },
  // Stats & tools
  { id: 'statistique',            label: 'Statistiques',          icon: '📈', render: null },
  { id: 'calculateur-spectacle',  label: 'Calculateur spectacle',  icon: '🎪', render: null },
  // Admin
  { id: 'inscriptions',           label: 'Inscriptions',          icon: '📝', render: null },
  { id: 'appel',                  label: 'Suivi des appels',      icon: '📞', render: null },
  { id: 'conformite',             label: 'Liste conforme',        icon: '✅', render: null },
  { id: 'sauvegarde',             label: 'Sauvegarde',            icon: '💾', render: null },
  { id: 'parametres',             label: 'Paramètres',            icon: '⚙️', render: null }
])
.defineStorage([
  // Invoicing & contracts
  'mp_invoices',
  'mp_devis',
  'mp_contracts',
  // Productions & shows
  'mp_rdvs',
  'mp_rendez_vous',
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
])
.defineSearch({ handler: _productionSearchHandler })
.defineCalendar({ provider: _productionCalendarProvider })
.build();

// ── Fallback: fire _productionInit on window.load ─────────────────────
//
// If Platform.ready() is never called by the host application
// (e.g., during a partial migration or in environments without the
//  Platform lifecycle wired up), ensure Production still initializes.
// The guard inside _productionInit() prevents double-execution.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() {
    if (!_PRODUCTION_RT_STATE.initialized) { _productionInit(); }
  });
}
