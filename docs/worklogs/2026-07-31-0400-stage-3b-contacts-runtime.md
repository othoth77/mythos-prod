# Worklog — Stage 3B: Contacts Runtime Migration

**Date:** 2026-07-31  
**Time:** ~04:00  
**Agent:** mythos-implementer  
**Session:** d3e68e14-7091-476e-841f-db645e0d0383

---

## 1. Objective

Migrate `js/plugins/contacts.plugin.js` (legacy static bootstrap) to `js/plugins/contacts.runtime.js` (Plugin SDK runtime plugin) as Stage 3B of Phase 3 — Runtime Plugin Migration.

Requirements:
- Preserve backward compatibility (same plugin id, menu, routes, storage keys)
- Add `onBoot` storage validation
- Add `onReady` MythosSearch provider registration
- Delete `contacts.plugin.js` only after confirming parity
- Add regression test suite `tests/stage3b-test.js`
- All existing test suites must continue to pass (0 failures)

---

## 2. Analysis

**Legacy file (`contacts.plugin.js`, 45 lines):**
```javascript
Platform.registerPlugin({
  id: 'contacts',
  label: 'Contacts',
  description: 'Carnet de contacts',
  version: '1.0.0',
  type: 'shared',
  menu: { section: 'Général', order: 5, icon: 'contacts' },
  routes: [
    { id: 'gestion-contacts', label: 'Répertoire', icon: '👥' },
    { id: 'contact-fiche', label: 'Fiche contact', icon: '👤' }
  ],
  storageKeys: ['mp_repertoire_contacts', 'mp_repertoire_imports'],
  onBoot: function() {},
  onReady: function() {}
});
```

No `onBoot` storage validation existed. No MythosSearch provider existed. The `description` field is silently dropped by the Plugin SDK (`PluginBuilder` has no `_description` — confirmed by reading `plugin-sdk.js`).

**Contact storage keys used in `app.js`:**
- `mp_repertoire_contacts` — main contacts array
- `mp_repertoire_imports` — import staging array
- `STORE.repertoireContacts()` / `STORE.saveRepertoireContacts(d)`

**Searchable fields in contact objects (from `app.js` filter code):**
`nom`, `prenom`, `tel1`, `tel2`, `email`, `metier`, `domaine`, `note`

**MythosSearch API** (from `js/core/services/search.js`):
- `MythosSearch.registerProvider({ id, label, order, search })`
- `MythosSearch.hasProvider(id)` — prevents duplicate registration

---

## 3. Decisions

1. **Storage validation in `onBoot`**: validate both `mp_repertoire_contacts` and `mp_repertoire_imports`. If present but not a valid JSON array, reset to `'[]'`. Silently ignore localStorage errors (try/catch). This mirrors the `tasks.runtime.js` pattern from Stage 3A.

2. **Search handler**: extract to named function `_contactsSearchHandler` (referenced in both `onReady` and `defineSearch`). Returns `[]` if `STORE` or `STORE.repertoireContacts` is unavailable (safe for test environments). Searches all 8 fields case-insensitively.

3. **Idempotency guard**: `_CONTACTS_RT_STATE = { initialized: false }` prevents duplicate `_contactsInit()` calls. Guard checked in `onReady` and in the `window.load` fallback.

4. **`window.load` fallback**: matches established pattern from tasks runtime. If `onReady` fires before DOM/services are ready, `window.addEventListener('load', ...)` ensures init still runs.

5. **`description` field**: dropped — Plugin SDK does not support it. No UI renders it, so no behavioral difference.

6. **Deletion trigger**: `contacts.plugin.js` deleted only after uploading the new test file and confirming all 78 Stage 3B tests pass.

---

## 4. Files Modified

| File | Change |
|---|---|
| `js/plugins/contacts.runtime.js` | **NEW** — 177 lines, runtime plugin |
| `js/plugins/contacts.plugin.js` | **DELETED** — 45 lines, legacy static plugin |
| `index.html` | 1 line changed: `contacts.plugin.js?v=20260730` → `contacts.runtime.js?v=20260730` |
| `tests/stage3b-test.js` | **NEW** — 78 tests, 9 sections |
| `tests/stage1c-part1-test.js` | 2 lines changed: added `load('js/core/plugin-sdk.js')`, updated plugin filename |
| `tests/stage2d-test.js` | 1 line changed: updated plugin filename |
| `tests/stage3a-test.js` | 1 line changed: updated plugin filename |

---

## 5. Functions Modified

| Function/Object | Location | Change |
|---|---|---|
| `_CONTACTS_RT_STATE` | contacts.runtime.js | NEW — idempotency state object |
| `_CONTACTS_SEARCH_FIELDS` | contacts.runtime.js | NEW — 8-field array |
| `_contactsSearchHandler(query)` | contacts.runtime.js | NEW — MythosSearch handler |
| `_contactsInit()` | contacts.runtime.js | NEW — guarded init |
| Plugin definition | contacts.runtime.js | NEW — `Plugin.create().build()` |
| window.load fallback | contacts.runtime.js | NEW — fallback guard |

No existing functions in `app.js` or other files were modified.

---

## 6. Tests Executed

All 10 test suites run via `node tests/<file>` on the VPS.

```
node tests/stage1b-test.js
node tests/stage1c-part1-test.js
node tests/stage2a-test.js
node tests/stage2b-test.js
node tests/stage2c-test.js
node tests/stage2d-test.js
node tests/stage3a-test.js
node tests/stage3a5-test.js
node tests/stage1a-sync-bypass-regression-test.js
node tests/stage3b-test.js
```

---

## 7. Test Results

| Suite | Tests | Passed | Failed |
|---|---|---|---|
| stage1b-test.js | 45 | 45 | 0 |
| stage1c-part1-test.js | 58 | 58 | 0 |
| stage2a-test.js | 42 | 42 | 0 |
| stage2b-test.js | 105 | 105 | 0 |
| stage2c-test.js | 83 | 83 | 0 |
| stage2d-test.js | 110 | 110 | 0 |
| stage3a-test.js | 69 | 69 | 0 |
| stage3a5-test.js | 152 | 152 | 0 |
| stage1a-sync-bypass-regression-test.js | 77 | 77 | 0 |
| stage3b-test.js | 78 | 78 | 0 |
| **TOTAL** | **819** | **819** | **0** |

---

## 8. Risks

**Low risk:**
- The old `contacts.plugin.js` made no behavior guarantees beyond registration — its `onBoot` and `onReady` were empty stubs. The new runtime adds behavior (storage validation, search) without removing any existing behavior.
- The `description` field silently dropped — no UI renders it.

**Mitigated during implementation:**
- **Phone number collision in test fixtures**: initial fixture had `c2.tel1='33445566'` and `c3.tel1='55667788'` — search for '5566' matched both, causing test ambiguity. Fixed by using globally unique 8-digit prefixes: `c1.tel1='20000001'`, `c2.tel1='30000002'`, `c2.tel2='40000003'`, `c3.tel1='50000004'`.
- **Regression output format mismatch**: stage1b, stage2a, stage2b, stage2c output `"N passed, M failed"` not `"X/Y tests passed"`. Stage3b regression section uses dual-pattern matching.
- **Missing Plugin SDK in stage1c sandbox**: fixed by adding `load('js/core/plugin-sdk.js')` to the test load sequence.

---

## 9. Rollback Strategy

If this change causes issues in production:

1. Re-add `js/plugins/contacts.plugin.js` (original 45 lines — recoverable from git history via `git show HEAD:js/plugins/contacts.plugin.js` from any commit before this one, or from the session transcript)
2. Revert `index.html` line: `contacts.runtime.js?v=20260730` → `contacts.plugin.js?v=20260730`
3. Optionally: revert the 3 test file changes

The original `contacts.plugin.js` content:
```javascript
(function() {
  'use strict';
  Platform.registerPlugin({
    id: 'contacts',
    label: 'Contacts',
    description: 'Carnet de contacts',
    version: '1.0.0',
    type: 'shared',
    menu: { section: 'Général', order: 5, icon: 'contacts' },
    routes: [
      { id: 'gestion-contacts', label: 'Répertoire', icon: '👥' },
      { id: 'contact-fiche', label: 'Fiche contact', icon: '👤' }
    ],
    storageKeys: ['mp_repertoire_contacts', 'mp_repertoire_imports'],
    onBoot: function() {},
    onReady: function() {}
  });
})();
```

---

## 10. Git Status

```
 M .gitignore
 M index.html
 D js/plugins/contacts.plugin.js
 M tests/stage1c-part1-test.js
 M tests/stage2d-test.js
 M tests/stage3a-test.js
?? .opencode/
?? AGENTS.md
?? js/plugins/contacts.runtime.js
?? opencode.json
?? tests/stage3b-test.js
```

Latest committed: `05c80dd fix(sync): route STORE.save* through _storeSave (Phase 1A)`

---

## 11. Suggested Commit Message

**Stage 3B commit** (awaiting approval):
```
feat(contacts): migrate to runtime plugin (Stage 3B)

- Replace contacts.plugin.js with contacts.runtime.js
- Add onBoot storage validation for mp_repertoire_contacts/imports
- Add onReady MythosSearch provider (8 searchable fields)
- Add idempotency guard and window.load fallback
- Update index.html, stage1c/2d/3a test files
- Add tests/stage3b-test.js (78 tests, 819 total pass)
```

**AI environment commit** (awaiting approval, separate):
```
chore(ai): configure secure OpenCode agent environment
```

---

## 12. Next Recommended Task

**Stage 3C — Notes Runtime**

Before starting: read `docs/PROJECT_STATE.md`, `docs/ROADMAP.md`, and this worklog.

Scope:
1. Read `js/plugins/notes.plugin.js` — identify capabilities, storage keys, routes
2. Read `js/app.js` — search for note-related functions and storage keys
3. Create `js/plugins/notes.runtime.js` using `Plugin.create().build()`
4. Add `onBoot` storage validation
5. Add `onReady` MythosSearch provider for note content
6. Update `index.html`: swap `notes.plugin.js` → `notes.runtime.js`
7. Update test files referencing `notes.plugin.js`
8. Delete `notes.plugin.js` if parity is complete
9. Create `tests/stage3c-test.js`
10. All suites pass, 0 failures
