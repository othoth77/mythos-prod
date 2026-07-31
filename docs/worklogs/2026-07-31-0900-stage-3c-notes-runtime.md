# Worklog — Stage 3C: Notes Runtime Migration

**Date:** 2026-07-31
**Time:** ~09:00 UTC
**Agent:** mythos-implementer
**Task:** Migrate notes.plugin.js to notes.runtime.js (Stage 3C)

---

## Objective

Migrate `js/plugins/notes.plugin.js` (legacy static bootstrap) to `js/plugins/notes.runtime.js` (Plugin SDK runtime plugin) as Stage 3C of Phase 3 — Runtime Plugin Migration.

---

## Files modified

| File | Change |
|------|--------|
| `js/plugins/notes.runtime.js` | **NEW** — 115 lines |
| `js/plugins/notes.plugin.js` | **DELETED** — 55 lines |
| `index.html` | Line 2193: `notes.plugin.js?v=20260730` → `notes.runtime.js?v=20260730` |
| `tests/stage3c-test.js` | **NEW** — 74 tests |
| `tests/stage1c-part1-test.js` | Line 72: plugin ref swapped |
| `tests/stage2d-test.js` | Line 458: plugin ref swapped |
| `tests/stage3a-test.js` | Line 359: plugin ref swapped |

---

## Tests executed

All 11 suites run via `node tests/<file>`:

| Suite | Tests | Result |
|-------|-------|--------|
| tests/stage1b-test.js | 45 | PASS |
| tests/stage1c-part1-test.js | 58 | PASS |
| tests/stage2a-test.js | 42 | PASS |
| tests/stage2b-test.js | 105 | PASS |
| tests/stage2c-test.js | 83 | PASS |
| tests/stage2d-test.js | 110 | PASS |
| tests/stage3a-test.js | 69 | PASS |
| tests/stage3a5-test.js | 152 | PASS |
| tests/stage1a-sync-bypass-regression-test.js | 77 | PASS |
| tests/stage3b-test.js | 78 | PASS |
| tests/stage3c-test.js | 74 | PASS |
| **TOTAL** | **893** | **0 failures** |

---

## Exact test results

```
stage1b:        45 passed, 0 failed
stage1c-part1:  58/58 tests passed
stage2a:        42 passed, 0 failed
stage2b:       105 passed, 0 failed
stage2c:        83 passed, 0 failed
stage2d:       110/110 tests passed
stage3a:        69/69 tests passed
stage3a5:      152/152 tests passed
stage1a:        77/77 tests passed
stage3b:        78/78 tests passed
stage3c:        74/74 tests passed
```

---

## Risks

| Risk | Assessment |
|------|------------|
| `description` field dropped | Safe — Plugin SDK has no `_description`; no UI renders it |
| `render: null` on routes dropped | Safe — Shell uses `render` for widgets only, not routes |
| `_rdGetDocs` late-bound | Safe — function exists at search call time; guarded with `typeof` check |
| Dynamic storage keys (`mp_rdtpl_*`, `mp_rdent_*`) not validated | Intentional — per-document keys are created at runtime with valid values; only the category-level lists need onBoot validation |

---

## Rollback strategy

```bash
# On VPS, restore original plugin
git checkout HEAD -- js/plugins/notes.plugin.js
# Revert index.html line 2193
# Revert line swaps in stage1c-part1-test.js, stage2d-test.js, stage3a-test.js
# Delete js/plugins/notes.runtime.js, tests/stage3c-test.js
```

Original `notes.plugin.js` is in git history (last present in `0b5ab5f`).

---

## Git status

```
 M .gitignore                          (pre-existing — env hardening)
 M index.html                          (Stage 3C)
 D js/plugins/notes.plugin.js          (Stage 3C)
 M tests/stage1c-part1-test.js         (Stage 3C)
 M tests/stage2d-test.js               (Stage 3C)
 M tests/stage3a-test.js               (Stage 3C)
?? js/plugins/notes.runtime.js         (Stage 3C)
?? tests/stage3c-test.js               (Stage 3C)
?? .opencode/, AGENTS.md, opencode.json (AI env — separate commit)
?? docs/                                (documentation — separate commit)
```

HEAD: `0b5ab5f` — feat(contacts): migrate to runtime plugin (Stage 3B)

---

## Suggested commit message

```
feat(notes): migrate to runtime plugin (Stage 3C)

- Replace notes.plugin.js with notes.runtime.js (115 lines)
- Add onBoot: storage validation for mp_rddocs_das/autres
- Add onReady: MythosSearch provider (search by document name)
- Add idempotency guard and window.load fallback
- Update index.html (1-line swap)
- Update stage1c-part1/stage2d/stage3a tests to load runtime
- Add tests/stage3c-test.js (74 tests, 893 total pass, 0 failures)
```

---

## Next recommended task

**Stage 3D — Planning Runtime**

Before starting: read PROJECT_STATE.md, AI_HANDOVER.md, ROADMAP.md, latest worklog.

Scope:
1. Read `js/plugins/planning.plugin.js`
2. Search `js/app.js` / `js/rappels.js` for planning-related functions and storage keys (`mp_rappels`, `mp_rappel_types`)
3. Create `js/plugins/planning.runtime.js`
4. onBoot: validate `mp_rappels` / `mp_rappel_types`
5. onReady: register MythosCalendar + MythosSearch providers
6. Update `index.html`, update test files
7. Delete `planning.plugin.js`
8. Create `tests/stage3d-test.js`
9. All suites pass, 0 failures
