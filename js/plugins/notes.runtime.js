// =====================================================
// MYTHOS OS — Notes Runtime Plugin
// js/plugins/notes.runtime.js
//
// Registers the Notes / Rédaction module via the Plugin SDK
// and wires the bootstrap/initialization logic through the
// Platform lifecycle (Platform.ready() → onReady → _notesInit).
//
// What lives HERE:
//   - Plugin registration (replaces notes.plugin.js)
//   - onBoot: localStorage validation for mp_rddocs_das
//     and mp_rddocs_autres (recover from malformed JSON)
//   - onReady: idempotent init, MythosSearch provider registration
//   - window.load fallback guard
//   - Search handler (late-bound: accesses localStorage at call time)
//
// What stays in redaction.js / app.js:
//   - All document CRUD (_rdGetDocs, _rdSaveDocs, _rdGetTemplate,
//     _rdSaveTemplate, _rdGetEntries, _rdSaveEntries)
//   - All rendering (_rdRender, renderRedactionPage, renderRedactionDocList,
//     openRedactionDoc, closeRedactionDoc, newRedactionDoc, deleteRedactionDoc)
//   - Template/entry management (saveRedactionTemplate, saveRedactionEntry)
//   - Print/export logic (redactionPrint, _rdRenderDocView)
//   - Legacy migration (mp_rdtpl_{cat}, mp_rdent_{cat} → mp_rddocs_{cat})
//   - In-memory cache (_rdDB, _rdCurrentDoc)
//   - Storage helpers (_rdRead, _rdWrite, _rdInvalidateCache)
//   - showView triggers: _rdRender('das'), _rdRender('autres') in app.js
//
// Storage keys (static — enumerable at registration):
//   mp_rddocs_das    — document list for DAS category
//   mp_rddocs_autres — document list for Autres category
//
// Dynamic keys (per document — NOT enumerated here):
//   mp_rdtpl_{docId} — template fields per document
//   mp_rdent_{docId} — entry values per document
//
// Depends on:  Plugin (js/core/plugin-sdk.js)
//              localStorage           [accessed directly at call time]
//              MythosSearch (js/core/services/search.js) [optional]
// Loaded:      after js/core/plugin-sdk.js and contacts.runtime.js,
//              before js/logger.js and js/app.js
// =====================================================

// ── State object ───────────────────────────────────────────────────────
var _NOTES_RT_STATE = { initialized: false };

// ── Search handler ─────────────────────────────────────────────────────
//
// Late-bound: localStorage is accessed at call time, not at registration
// time. Searches both document categories.
//
// Document objects stored in mp_rddocs_{cat} have the shape:
//   { id: string, name: string, createdAt: ISO string }
//
// The 'name' field is the only user-visible searchable field
// available statically. Template fields and entry values live in
// dynamic per-document keys (mp_rdtpl_*, mp_rdent_*) and are not
// searched here to avoid O(n*docs) localStorage reads.
//
function _notesSearchHandler(query) {
  var q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  var results = [];
  var cats = [
    { key: 'mp_rddocs_das',    route: 'redaction-das',    label: 'DAS' },
    { key: 'mp_rddocs_autres', route: 'redaction-autres', label: 'Autres' }
  ];
  for (var i = 0; i < cats.length; i++) {
    var cat = cats[i];
    try {
      var raw = localStorage.getItem(cat.key);
      if (!raw) continue;
      var docs;
      try { docs = JSON.parse(raw); } catch(e) { continue; }
      if (!Array.isArray(docs)) continue;
      for (var j = 0; j < docs.length; j++) {
        try {
          var doc = docs[j];
          if (!doc || typeof doc !== 'object') continue;
          var name = String(doc.name || '').toLowerCase();
          if (name && name.indexOf(q) !== -1) {
            results.push({
              id:       'note-' + doc.id,
              title:    doc.name || 'Document',
              subtitle: cat.label,
              type:     'note',
              route:    cat.route,
              data:     doc
            });
          }
        } catch(e) { /* skip malformed entry */ }
      }
    } catch(e) { /* skip malformed category */ }
  }
  return results;
}

// ── Initialization guard ───────────────────────────────────────────────
//
// Called once from onReady() or from the window.load fallback.
// Guarded by _NOTES_RT_STATE.initialized — safe to call multiple times.
//
function _notesInit() {
  if (_NOTES_RT_STATE.initialized) return;
  _NOTES_RT_STATE.initialized = true;
  if (typeof MythosSearch !== 'undefined' && !MythosSearch.hasProvider('notes')) {
    MythosSearch.registerProvider({
      id:     'notes',
      label:  'Notes',
      order:  7,
      search: _notesSearchHandler
    });
  }
}

// ── Plugin registration ────────────────────────────────────────────────

Plugin.create({
  id: 'notes', label: 'Rédaction', version: '1.0.0', type: 'shared',

  onBoot: function() {
    // Validate localStorage for both static notes storage keys.
    // Rule: only reset if the stored value is invalid JSON or non-array.
    // Never delete valid data. Never overwrite a non-empty valid array.
    // If the key was never set (null), leave it untouched — redaction.js
    // handles the default (empty docs array) at first access.
    var keys = ['mp_rddocs_das', 'mp_rddocs_autres'];
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
      } catch(e) { /* localStorage unavailable — silently skip */ }
    }
  },

  onReady: function() { _notesInit(); }
})
.defineMenu({ section: 'Général', order: 6, icon: 'notes' })
.defineRoutes([
  { id: 'redaction-das',    label: 'Rédaction DAS',    icon: '📝', render: null },
  { id: 'redaction-autres', label: 'Rédaction Autres', icon: '📝', render: null }
])
.defineStorage(['mp_rddocs_das', 'mp_rddocs_autres'])
.defineSearch({ handler: _notesSearchHandler })
.build();

// ── window.load fallback ───────────────────────────────────────────────
//
// If Platform.ready() is never called (e.g., during tests or partial
// bootstrap), this ensures initialization still happens once.
//
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() {
    if (!_NOTES_RT_STATE.initialized) { _notesInit(); }
  });
}
