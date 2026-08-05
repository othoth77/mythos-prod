# Mythos OS — Roadmap

**Last updated:** 2026-08-05 UTC

---

## Completed Stages

| Stage | Description | Status |
|-------|-------------|--------|
| 0 | Architecture documentation | ✓ Done |
| 1A | Core: storage.js + api.js | ✓ Done |
| 1B | Core: events.js + platform.js | ✓ Done |
| 1C-P1 | API layer: fetch() audit | ✓ Done |
| 2A | Plugin: production plugin | ✓ Done |
| 2B | Plugin: 6 shared plugins | ✓ Done |
| 2C | Shell: sidebar/workspace/nav | ✓ Done |
| 2D | Plugin SDK: fluent builder | ✓ Done |
| 3A | Tasks Runtime | ✓ Done |
| 3A.5 | Runtime Services | ✓ Done |
| 3B | Contacts Runtime | ✓ Done |
| 3C | Notes Runtime | ✓ Done |

---

## In Progress

*None. Stage 3D is next.*

---

## Upcoming Stages (in dependency order)

### Stage 3C — Notes Runtime
**Soft dependency:** Stage 3B establishes the runtime plugin pattern; Stage 3C can proceed independently if the pattern is understood.  
**Deliverable:** `js/plugins/notes.runtime.js`  
**Replaces:** `js/plugins/notes.plugin.js`  
**Test file:** `tests/stage3c-test.js`  
**What it provides:** onBoot: validate `mp_rddocs_das`/`mp_rddocs_autres` localStorage. onReady: register MythosSearch provider.  
**What stays in app.js/redaction.js:** All CRUD, rendering, template/entry logic.

### Stage 3D — Planning Runtime
**Depends on:** None (can run any time)  
**Deliverable:** `js/plugins/planning.runtime.js`  
**Replaces:** `js/plugins/planning.plugin.js`  
**Test file:** `tests/stage3d-test.js`  
**What it provides:** onBoot: validate `mp_rappels`/`mp_rappel_types`. onReady: register MythosCalendar + MythosSearch providers.

### Stage 3E — Calendar Runtime
**Depends on:** 3B, 3C, 3D (wiring all providers)  
**Deliverable:** `js/plugins/calendar.runtime.js`  
**Replaces:** `js/plugins/calendar.plugin.js`  
**Test file:** `tests/stage3e-test.js`

### Stage 3F — Dashboard Runtime
**Depends on:** 3B–3E (consumes all providers)  
**Deliverable:** `js/plugins/dashboard.runtime.js`  
**Replaces:** `js/plugins/dashboard.plugin.js`  
**Test file:** `tests/stage3f-test.js`

### Stage 3G — Production Runtime
**Depends on:** 3B–3F (all services established)  
**Deliverable:** `js/plugins/production.runtime.js`  
**Replaces:** `js/plugins/production.plugin.js`  
**Test file:** `tests/stage3g-test.js`  
**Risk:** HIGH — production plugin has 30 routes and 19 storage keys.

---

## Future Stages (post-3G)

### Stage 4 — Shared Module Extraction
Move generic modules out of app.js into `js/shared/`:
1. `shared/tasks.js` — rename from taches.js
2. `shared/planning.js` — rename from rappels.js
3. `shared/notes.js` — rename from redaction.js
4. `shared/contacts.js` — extract from app.js lines 3071–4413
5. `shared/calendar.js` — extract from app.js lines 8600–8841
6. `shared/dashboard.js` — extract from app.js lines 700–975

### Stage 5 — Production Module Extraction
Move production-specific domains out of app.js into `js/prod/`:
1. `prod/clients.js`, `prod/collaborators.js` (simple CRUD)
2. `prod/equipment.js` (vehicles)
3. `prod/mission-orders.js`
4. `prod/invoices.js`
5. `prod/accounting.js` (largest, extract last)

### Stage 6 — Directory Reorganisation
Rename files to match target hierarchy. Update all `<script src>` tags.

---

## Current Priority

1. **Immediate (Mythos OS):** Stage 4AG — Invoice/OM helper duplicates audit (`js/app.js`)
2. **Parallel track (ID Auto):** IDA-1 — Product and legal specification (may begin after Stage 4AG)

---

## ID Auto — Separate Product Track

ID Auto (`idauto.tn`) is a vehicle-plate lookup and professional subscription platform for Tunisia. It shares this repository under `projects/idauto/` but maintains entirely separate storage, deployment, and lifecycle.

See `docs/IDAUTO_ROADMAP.md` for the full ID Auto stage plan.

| Stage | Description | Status |
|-------|-------------|--------|
| IDA-0 | Foundation — schema, config, architecture, privacy contract | ✓ Done (2026-08-05) |
| IDA-1 | Product and legal specification | Planned |
| IDA-2 | MVP plate search API | Planned |
| IDA-3 | Professional subscription portal | Planned |
| IDA-4 | Service event tracking and fleet integration | Planned |
| IDA-5 | Public launch and data enrichment | Future |

**Active priority:** Mythos OS Stage 4AG is the current priority. IDA-1 does not begin until Stage 4AG is complete or explicitly paused.

---

## Acceptance Criteria — Stage 3C (Notes Runtime)

- [ ] `js/plugins/notes.runtime.js` created
- [ ] onBoot: validates `mp_rddocs_das` and `mp_rddocs_autres` localStorage (try/catch JSON.parse; reset to `"[]"` on corruption)
- [ ] onReady: registers MythosSearch provider
- [ ] `index.html` updated: `notes.plugin.js` → `notes.runtime.js`
- [ ] `js/plugins/notes.plugin.js` deleted
- [ ] All existing tests updated to load notes.runtime.js
- [ ] `tests/stage3c-test.js`: ≥50 new tests, all pass
- [ ] All regressions pass (stage2d, stage3a, stage3a5, stage3b)
- [ ] 0 failures across full suite