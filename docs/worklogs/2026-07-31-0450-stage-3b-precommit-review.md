# Worklog — Stage 3B Pre-Commit Review

**Date:** 2026-07-31  
**Time:** ~07:00 UTC  
**Agent:** mythos-implementer  
**Task:** Full behavioral parity audit of Stage 3B before commit approval

---

## Objective

Verify behavioral parity between `contacts.plugin.js` (deleted) and `contacts.runtime.js` (new) across all dimensions: plugin registration, lifecycle hooks, storage behavior, script loading order, backward compatibility, global APIs, events, and DOM/fallback behavior. Run the full test suite. Determine whether deletion of `contacts.plugin.js` is safe.

---

## Pre-task reads

| Doc | Key findings |
|-----|-------------|
| `docs/PROJECT_STATE.md` | Stage 3B complete, uncommitted. Test baseline listed as 742 (664+78) — see issue below. |
| `docs/AI_HANDOVER.md` | Groups 1–4 pending commit. Confirms 6 modified + 5 untracked files for Stage 3B. |
| `docs/ROADMAP.md` | Stage 3B in-progress, acceptance criteria defined. Stage 3C next. |
| `docs/worklogs/2026-07-31-0445-documentation-initialization.md` | Verified commit history, ran all tests, flagged AGENTS.md 939-count discrepancy. |

---

## Files audited

| File | Source | Lines |
|------|--------|-------|
| `js/plugins/contacts.plugin.js` | `git show HEAD:js/plugins/contacts.plugin.js` | 45 |
| `js/plugins/contacts.runtime.js` | Working tree | 177 |
| `index.html` | `git diff HEAD -- index.html` | 1 line changed |
| `tests/stage3b-test.js` | Working tree | 503 |
| `tests/stage1c-part1-test.js` | `git diff HEAD` | +1 load, 1 swap |
| `tests/stage2d-test.js` | `git diff HEAD` | 1 swap |
| `tests/stage3a-test.js` | `git diff HEAD` | 1 swap |
| `js/core/plugin-sdk.js` | Live | defineRoutes, defineSearch, build() |
| `js/core/platform.js` | Live | boot(), ready() lifecycle |
| `js/core/shell.js` | Live | render field usage |

---

## Behavioral parity — field-by-field

| Field | contacts.plugin.js | contacts.runtime.js | Safe? |
|-------|--------------------|---------------------|-------|
| `id` | `'contacts'` | `'contacts'` | ✅ |
| `label` | `'Contacts'` | `'Contacts'` | ✅ |
| `version` | `'1.0.0'` | `'1.0.0'` | ✅ |
| `type` | `'shared'` | `'shared'` | ✅ |
| `menu.section` | `'Général'` | `'Général'` | ✅ |
| `menu.order` | `5` | `5` | ✅ |
| `menu.icon` | `'contacts'` | `'contacts'` | ✅ |
| `routes[0].id` | `'gestion-contacts'` | `'gestion-contacts'` | ✅ |
| `routes[0].label` | `'Répertoire'` | `'Répertoire'` | ✅ |
| `routes[0].icon` | `'👥'` | `'👥'` | ✅ |
| `routes[1].id` | `'contact-fiche'` | `'contact-fiche'` | ✅ |
| `routes[1].label` | `'Fiche contact'` | `'Fiche contact'` | ✅ |
| `routes[1].icon` | `'👤'` | `'👤'` | ✅ |
| `storageKeys` | `['mp_repertoire_contacts', 'mp_repertoire_imports']` | same | ✅ |
| `onBoot` | empty stub | validates storage (additive) | ✅ |
| `onReady` | empty stub | registers MythosSearch (additive) | ✅ |
| `description` | `'Répertoire de contacts...'` | **dropped** | ✅ — Plugin SDK has no `_description` field; no UI renders it |
| `routes[*].render` | `null` | **omitted (undefined)** | ✅ — Shell uses `render` for widgets only (shell.js:205), not for route entries |

---

## Script loading order (index.html)

Verified load order around the swap:
```
…plugin-sdk.js          ← Plugin.create() dependency
…tasks.runtime.js
…planning.plugin.js
…contacts.runtime.js    ← correct position (was contacts.plugin.js)
…notes.plugin.js
…logger.js
…auth.js
…app.js                 ← STORE, showView defined here (after contacts.runtime.js)
```

**plugin-sdk.js loads before contacts.runtime.js** ✅  
**app.js loads after contacts.runtime.js** ✅ — STORE is accessed at call time in `_contactsSearchHandler`, not at definition time.

---

## Specific checks

### Platform lifecycle

- `Platform.boot()` calls `onBoot` for each registered plugin with per-plugin error isolation. Idempotent (second call is no-op). ✅
- `Platform.ready()` calls `onReady` for each registered plugin, auto-calling `boot()` first if needed. ✅
- No custom Events emitted by contacts.runtime.js — Platform emits `mythos:plugin:booted` automatically. ✅

### Storage behavior

`onBoot` validates both `mp_repertoire_contacts` and `mp_repertoire_imports`:
- `null` (never set) → unchanged ✅
- Valid JSON array → unchanged ✅
- Non-array JSON (object, string, number) → reset to `'[]'` ✅
- Invalid JSON → reset to `'[]'` ✅
- Called twice (double boot) → idempotent, valid data preserved ✅
- All `localStorage` calls wrapped in try/catch ✅

### MythosSearch registration

- `_contactsInit()` called from `onReady` with `MythosSearch.hasProvider('contacts')` guard ✅
- `defineSearch({ handler })` also stores handler in manifest for external consumers ✅
- `hasProvider` guard prevents double registration if both paths run ✅
- `MythosSearch` undefined → no throw ✅
- `STORE` undefined at search call time → returns `[]` safely ✅
- `STORE.repertoireContacts` not a function → returns `[]` safely ✅

### Global APIs

New globals introduced by contacts.runtime.js (all expected, no conflicts):
- `_CONTACTS_RT_STATE` — state object `{ initialized: false }`
- `_CONTACTS_SEARCH_FIELDS` — 8-element array
- `_contactsSearchHandler(query)` — search handler function
- `_contactsInit()` — guarded init function

### DOM initialization / fallback

- `window.addEventListener('load', ...)` registered during script load ✅
- Fires `_contactsInit()` if `initialized` is still false at window.load time ✅
- Guard prevents double-init if Platform.ready() already fired ✅
- Tested in stage3b Section 7: both paths confirmed ✅

### Backward compatibility

- All existing plugin consumers receive identical manifest structure (id, label, version, type, menu, routes, storageKeys, onBoot, onReady) ✅
- Contacts CRUD functions (`addRepertoireContactRow`, `deleteRepertoireContact`, etc.) remain untouched in `app.js` ✅
- Rendering functions (`renderRepertoireContactsPage`, `renderContactFiche`, etc.) remain untouched in `app.js` ✅
- `showView` hooks for `gestion-contacts` and `contact-fiche` remain untouched ✅
- State vars (`_rcFilterBatchId`, `currentContactFicheId`) remain untouched ✅

---

## Test results

All 10 test suites run:

| Suite | Tests | Result | Notes |
|-------|-------|--------|-------|
| tests/stage1b-test.js | 45 | ✅ PASS | Committed |
| tests/stage1c-part1-test.js | 58 | ✅ PASS | +plugin-sdk.js load added |
| tests/stage2a-test.js | 42 | ✅ PASS | Committed |
| tests/stage2b-test.js | 105 | ✅ PASS | Committed |
| tests/stage2c-test.js | 83 | ✅ PASS | Committed |
| tests/stage2d-test.js | 110 | ✅ PASS | contacts ref swapped |
| tests/stage3a-test.js | 69 | ✅ PASS | contacts ref swapped |
| tests/stage3a5-test.js | 152 | ✅ PASS | Committed |
| tests/stage1a-sync-bypass-regression-test.js | 77 | ✅ PASS | Committed in 05c80dd |
| tests/stage3b-test.js | 78 | ✅ PASS | **Untracked — Stage 3B** |
| **TOTAL** | **819** | **0 failures** | |

**Note:** Previous PROJECT_STATE.md listed 742 total (664+78). Corrected: 741 committed (664+77 from stage1a) + 78 untracked = 819 total. The stage1a test file was committed in `05c80dd` but was not counted in the 664 baseline (which reflects only the 8 suites in the prior doc initialization worklog).

---

## Is deletion of contacts.plugin.js safe?

**YES.**

Reasons:
1. Full manifest parity confirmed across all consumer-visible fields
2. The two dropped fields (`description`, `render: null` in routes) have no behavioral impact — Plugin SDK ignores `description`; Shell uses `render` for widgets only, not route entries
3. `onBoot` and `onReady` add behavior (storage validation, MythosSearch) that was not present in the stub implementations — this is additive and backward-compatible
4. Section 8 of `stage3b-test.js` explicitly verifies the file is absent and that `index.html` references only the runtime
5. All 819 tests pass with the file deleted from the working tree

---

## Issues found

### Stage 3B issues
None. No fixes required.

### Pre-existing documentation issues (fixed in this worklog update)

1. **PROJECT_STATE.md test count incorrect**: Listed 742 (664+78). Correct count is 819 (741 committed + 78 untracked). stage1a (77 tests, committed in 05c80dd) was omitted from the baseline. → Fixed below.

2. **stage3b regression suite omits stage1a**: `tests/stage3b-test.js` Section 9 runs 8 suites (stage1b through stage3a5) but not stage1a. This is intentional — stage1a tests the STORE sync engine (app.js), orthogonal to the contacts plugin. Acceptable gap; not a bug.

---

## Risks

| Risk | Severity | Status |
|------|----------|--------|
| `description` field dropped | None | Plugin SDK silently ignores it; no UI shows plugin descriptions |
| `render: null` in routes dropped → `undefined` | None | Shell processes `render` for widgets only, not routes |
| Double registration path (`defineSearch` + `_contactsInit`) | None | `hasProvider` guard prevents duplicates |
| New globals `_contactsInit`, `_CONTACTS_RT_STATE` conflict | None | Unique names, not present elsewhere |

---

## Rollback strategy

If issues appear in production after commit:

```bash
# On VPS, restore original plugin and revert index.html
git checkout HEAD~1 -- js/plugins/contacts.plugin.js
# Edit index.html: contacts.runtime.js → contacts.plugin.js
# Revert test file swaps in stage1c-part1-test.js, stage2d-test.js, stage3a-test.js
```

The original `contacts.plugin.js` content is preserved in git history (last present in `9a06d52`).

---

## Git status

```
 M .gitignore
 M index.html
 D js/plugins/contacts.plugin.js
 M tests/stage1c-part1-test.js
 M tests/stage2d-test.js
 M tests/stage3a-test.js
?? .opencode/
?? AGENTS.md
?? docs/AI_HANDOVER.md
?? docs/CHANGELOG.md
?? docs/PROJECT_STATE.md
?? docs/ROADMAP.md
?? docs/worklogs/
?? js/plugins/contacts.runtime.js
?? opencode.json
?? tests/stage3b-test.js
```

---

## Suggested commit message

```
feat(contacts): migrate to runtime plugin (Stage 3B)

- Replace contacts.plugin.js with contacts.runtime.js (177 lines)
- Add onBoot: storage validation for mp_repertoire_contacts/imports
- Add onReady: MythosSearch provider registration (8 searchable fields)
- Add idempotency guard and window.load fallback
- Update index.html (1-line swap)
- Update stage1c-part1/stage2d/stage3a tests to load runtime
- Add tests/stage3b-test.js (78 tests, 819 total pass, 0 failures)
```

### Recommended staging command

```bash
git add js/plugins/contacts.runtime.js \
        js/plugins/contacts.plugin.js \
        index.html \
        tests/stage3b-test.js \
        tests/stage1c-part1-test.js \
        tests/stage2d-test.js \
        tests/stage3a-test.js
git diff --staged --stat
```

**Do NOT stage in this commit:**
- `.gitignore` (environment hardening — separate commit)
- `AGENTS.md`, `opencode.json`, `.opencode/` (AI tooling — separate commit)
- `docs/` files (documentation — separate commit or alongside)

---

## Next recommended task

**Await commit approval for Stage 3B**, then proceed in order:

1. **Commit Stage 3B** (7 files above)
2. **Commit AI environment** (`AGENTS.md`, `opencode.json`, `.gitignore`, `.opencode/`)
3. **Commit documentation** (`docs/PROJECT_STATE.md`, `docs/AI_HANDOVER.md`, `docs/ROADMAP.md`, `docs/worklogs/`)
4. **Stage 3C — Notes Runtime** (read `js/plugins/notes.plugin.js` and `js/app.js` note functions first)
