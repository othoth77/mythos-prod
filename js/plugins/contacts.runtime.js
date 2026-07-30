// =====================================================
// MYTHOS OS — Contacts Runtime Plugin
// js/plugins/contacts.runtime.js
//
// Registers the Contacts module via the Plugin SDK and wires
// the bootstrap/initialization logic through the Platform
// lifecycle (Platform.ready() → onReady → _contactsInit).
//
// What lives HERE:
//   - Plugin registration (replaces contacts.plugin.js)
//   - onBoot: localStorage validation for mp_repertoire_contacts
//     and mp_repertoire_imports (recover from malformed JSON)
//   - onReady: idempotent init, MythosSearch provider registration
//   - window.load fallback guard
//   - Search handler (late-bound: accesses STORE at call time)
//
// What stays in app.js:
//   - All contact CRUD (addRepertoireContactRow, updateRepertoireContactField,
//     deleteRepertoireContact, deleteRepertoireImport, etc.)
//   - All rendering (renderRepertoireContactsPage, renderContactsDirectory,
//     renderContactFiche, renderRepertoireImportsHistory, etc.)
//   - Import/export (importPhoneContacts, startGoogleContactsImport,
//     triggerContactsFileImport, handleContactsFileImport,
//     exportContactsDirectoryCSV)
//   - Synchronization (_markDeleted, sync engine integration)
//   - Business logic (_rcMergeGroupInList, _rcDuplicateGroups,
//     logContactHistory, setLastCallOutcome, etc.)
//   - State variables (_rcFilterBatchId, _rcActiveTab, etc.)
//   - STORE.repertoireContacts / STORE.saveRepertoireContacts
//   - STORE.repertoireImports  / STORE.saveRepertoireImports
//
// Depends on:  Plugin (js/core/plugin-sdk.js)
//              STORE  (js/app.js)              [accessed at call time]
//              MythosSearch (js/core/services/search.js) [optional]
// Loaded:      after js/core/plugin-sdk.js, before app.js
// =====================================================

// State object
var _CONTACTS_RT_STATE = { initialized: false };

// Fields searched by the contacts search handler
var _CONTACTS_SEARCH_FIELDS = ['nom','prenom','tel1','tel2','email','metier','domaine','note'];

// ── Search handler ─────────────────────────────────────────────────────
//
// Late-bound: STORE is accessed at call time, not at registration time.
// Returns an array of normalized result objects for MythosSearch.
//
function _contactsSearchHandler(query) {
  if (typeof STORE === 'undefined' || typeof STORE.repertoireContacts !== 'function') return [];
  var q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  return STORE.repertoireContacts()
    .filter(function(c) {
      if (!c || typeof c !== 'object') return false;
      for (var i = 0; i < _CONTACTS_SEARCH_FIELDS.length; i++) {
        var val = String(c[_CONTACTS_SEARCH_FIELDS[i]] || '').toLowerCase();
        if (val && val.indexOf(q) !== -1) return true;
      }
      if (Array.isArray(c.tags)) {
        for (var j = 0; j < c.tags.length; j++) {
          if (String(c.tags[j]).toLowerCase().indexOf(q) !== -1) return true;
        }
      }
      return false;
    })
    .map(function(c) {
      var name = [c.prenom, c.nom].filter(Boolean).join(' ') || c.tel1 || 'Contact';
      var sub  = c.metier || c.email || c.tel1 || '';
      return { id: 'contact-' + c.id, title: name, subtitle: sub, type: 'contact', route: 'gestion-contacts', data: c };
    });
}

// ── Initialization guard ───────────────────────────────────────────────
//
// Called once from onReady() or from the window.load fallback.
// Guarded by _CONTACTS_RT_STATE.initialized — safe to call multiple times.
//
function _contactsInit() {
  if (_CONTACTS_RT_STATE.initialized) return;
  _CONTACTS_RT_STATE.initialized = true;
  if (typeof MythosSearch !== 'undefined' && !MythosSearch.hasProvider('contacts')) {
    MythosSearch.registerProvider({ id:'contacts', label:'Contacts', order:5, search:_contactsSearchHandler });
  }
}

// ── Plugin registration ────────────────────────────────────────────────

Plugin.create({
  id: 'contacts', label: 'Contacts', version: '1.0.0', type: 'shared',

  onBoot: function() {
    // Validate localStorage for both contacts storage keys.
    // Rule: only reset if the stored value is invalid JSON or non-array.
    // Never delete valid data. Never overwrite a non-empty valid array.
    // If the key was never set (null), leave it untouched — STORE handles default.
    var keys = ['mp_repertoire_contacts', 'mp_repertoire_imports'];
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
      } catch(e) {}
    }
  },

  onReady: function() { _contactsInit(); }
})
.defineMenu({ section: 'Général', order: 5, icon: 'contacts' })
.defineRoutes([
  { id: 'gestion-contacts', label: 'Répertoire', icon: '👥' },
  { id: 'contact-fiche',    label: 'Fiche contact', icon: '👤' }
])
.defineStorage(['mp_repertoire_contacts', 'mp_repertoire_imports'])
.defineSearch({ handler: _contactsSearchHandler })
.build();

// ── window.load fallback ───────────────────────────────────────────────
//
// If Platform.ready() is never called (e.g., during tests or partial
// bootstrap), this ensures initialization still happens once.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() {
    if (!_CONTACTS_RT_STATE.initialized) { _contactsInit(); }
  });
}
