# Mythos Prod — Module Map

**Last audited:** 2026-07-29

This file maps every JS module, its global symbols, its localStorage dependencies, and its coupling to other modules.

---

## Module: auth.js

**Status:** Extracted, standalone  
**Load order:** blocking (body, after logger.js)

### Global object
- `AUTH` — singleton object

### Methods
- `AUTH.hashPassword(password)` — async, Web Crypto SHA-256
- `AUTH.isSessionValid()` — checks `mp_auth_session` in localStorage
- `AUTH.createSession()` / `AUTH.destroySession()`
- `AUTH.showLoginScreen()` — injects login DOM
- `AUTH.showLoadingScreen(msg)` / `AUTH.hideLoadingScreen()`
- `AUTH.updateLoadingMessage(msg, sub)`
- `AUTH.handleLogin()` — entry point for user login
- `AUTH.logout()` — flushes data via sendBeacon then reloads
- `AUTH.init()` — called on page load; gates app start

### localStorage used
- `mp_auth_session` (read/write) — session timestamp

### Cross-module calls (outward)
- `syncFromServer(callback)` — defined in app.js; called after login
- `bootstrapStableApp()` — defined in app.js; called after sync completes
- `LOGGER.log()` — optional; guarded with `typeof LOGGER !== 'undefined'`

### Cross-module calls (inward — who calls AUTH)
- `index.html` inline: `AUTH.init()` on DOMContentLoaded
- `index.html` onclick: `AUTH.logout()` via `handleGlobalLogout()`

### sessionStorage used
- None

### DOM dependencies
- Creates: `#mp-login-screen`, `#mp-loading-screen`, `#mp-logout-spinner`
- Reads: `#main-app` (show/hide)

---

## Module: logger.js

**Status:** Extracted, standalone  
**Load order:** blocking (body, first)

### Global object
- `LOGGER` — singleton object

### Methods
- `LOGGER.log(action, details)` — append to ring buffer
- `LOGGER.getLogs()` — return all logs
- `LOGGER.clearLogs()` / `LOGGER.exportLogs()`

### localStorage used
- `mp_activity_log` (read/write) — capped at 200 entries

### Cross-module dependencies
- None (pure, fully isolated)

---

## Module: taches.js

**Status:** Extracted, depends on app.js  
**Load order:** blocking (body, after app.js)

### Global variables
- `TCH_TYPES` — object with type styles (simple, importante, urgente)
- `TCH_ORDER` — array controlling sort order

### Global functions (prefix `_tch*`)
- `getTaches()` / `saveTaches(list)` — storage accessors
- `_tchFmt(dt)` / `_tchToday()` / `_tchIsInWeek(dateStr)` — date helpers
- `_tchToast(msg, type)` — UI notification
- `renderTaches()` — main render function
- `openTacheModal(id)` / `closeTacheModal()` / `saveTache()` / `deleteTache(id)`
- `filterTaches(type)` / `toggleTacheComplete(id)`

### localStorage used
- `mp_taches` (read/write via `_storeGet`/`_storeSave` if available, else raw)

### Cross-module calls (outward)
- `_storeGet('mp_taches', '[]')` — defined in app.js (conditional)
- `_storeSave('mp_taches', list)` — defined in app.js (conditional)

### DOM dependencies
- Reads/writes: `#taches-container`, `#tache-modal`, `#tache-*` fields

---

## Module: rappels.js

**Status:** Extracted, depends on app.js  
**Load order:** defer (executes after DOM parsed, after body scripts)

### Global functions (prefix `getRappel*`, `saveRappel*`, `renderRappel*`)
- `getRappels()` / `saveRappelsList(list)` — raw localStorage (does not use `_storeGet`)
- `getRappelTypes()` / `saveRappelTypes(list)` / `addRappelTypeIfNew(val)`
- `getNextRappelDate(dateDebut, periode)` — pure date calculation
- `renderRappels()` — main render
- `openRappelModal(id)` / `closeRappelModal()` / `saveRappel()` / `deleteRappel(id)`
- `_refreshRappelTypeSelect(currentVal)` — DOM helper

### Global variables
- `DEFAULT_RAPPEL_TYPES` — array of default reminder types

### localStorage used
- `mp_rappels` (read/write — raw localStorage)
- `mp_rappel_types` (read/write — raw localStorage)

### Cross-module calls (outward)
- `escHtml(text)` — defined in app.js (not guarded — hard dependency)

### DOM dependencies
- Reads/writes: `#rappels-container`, `#rappel-modal`, `#rappel-*` fields, `#rappel-type-select`

---

## Module: redaction.js

**Status:** Extracted, depends on app.js  
**Load order:** defer (executes after DOM parsed)

### Global variables
- `_rdDB` — in-memory document cache object
- `_rdCurrentDoc` — tracks currently open doc per category

### Global functions (prefix `_rd*`, `renderRedaction*`)
- `_rdInvalidateCache()` — clears in-memory cache after server sync
- `_rdRead(key, fallback)` / `_rdWrite(key, value)` — storage wrappers
- `_rdGetDocs(cat)` / `_rdSaveDocs(cat, docs)` — document list management
- `openRedactionDoc(cat, docId)` / `closeRedactionDoc()`
- `renderRedactionPage(cat)` / `renderRedactionDocList(cat)`
- `saveRedactionTemplate(cat, docId)` / `saveRedactionEntry(cat, docId)`
- `deleteRedactionDoc(cat, docId)` / `newRedactionDoc(cat)`
- Legacy migration: detects old `mp_rdtpl_{cat}` / `mp_rdent_{cat}` keys and upgrades

### localStorage used
- `mp_rddocs_{cat}` (read/write via `_storeGet`/`_storeSave` if available, else raw)
- `mp_rdtpl_{docId}` (dynamic — read/write)
- `mp_rdent_{docId}` (dynamic — read/write)

### Cross-module calls (outward)
- `_storeGet(key, default)` — conditional (falls back to raw localStorage)
- `_storeSave(key, value)` — conditional (falls back to raw localStorage)
- `syncFromServer()` — may be called after doc delete to force sync

### DOM dependencies
- Reads/writes: `#redaction-container`, `#rd-*` fields, dynamic doc lists

---

## Module: app.js — Sync engine (lines 63–507)

**Status:** Not extracted — lives in app.js  
**Risk:** CRITICAL — do not modify without full regression test

### Global functions
- `_storeGet(key, def)` — read from `_memCache` or localStorage; returns parsed value
- `_storeSave(key, data)` — write to `_memCache` + localStorage + push queue
- `_safeSet(key, value)` — raw localStorage write with error guard
- `_pushCollection(key, value, updatedAt, onDone)` — POST to api.php (chunked if >800)
- `syncFromServer(callback, silent)` — full bidirectional sync
- `_pullFromServerNow()` — GET `api.php?key=__all__` without callback
- `_flushPending()` — drain `_pendingKeys` queue via fetch
- `_flushPendingBeacon()` — drain queue via `sendBeacon` (used on pagehide/logout)
- `_triggerAutoBackup(label)` — POST `__auto_backup__` to server (debounced)
- `_showSyncIndicator(msg, color)` — DOM sync status toast
- `_mergeCollections(local, server)` — merge two arrays by id+updatedAt
- `_tombKey(key)` / `_getDeletedIds(key)` / `_markDeleted(key, id)` / `_filterTombstoned(key, list)` — soft-delete support

### Global variables
- `_localMeta` — IIFE from localStorage; per-collection timestamps
- `_pendingKeys` — IIFE from localStorage; Set of dirty keys
- `_lastPullTs` — debounce guard for pull
- `_memCache` — in-memory read-through cache object
- `_autoBackupTimer` / `_syncIndicatorTimer` — debounce timers

### Event listeners registered
- `window.pagehide` — calls `_flushPendingBeacon()`
- `window.focus` — calls `_pullFromServerNow()`
- `window.online` — calls `_pullFromServerNow()` after 1s

---

## Module: app.js — Utility functions (lines 612–699)

### Global functions
- `todayStr()` — returns `YYYY-MM-DD`
- `money(val)` — format number as currency string
- `escapeHtml(text)` — HTML-escape via DOM (alias used by rappels.js)
- `formatDate(dateStr)` / `formatDateLong(dateStr)` — localized date formatting
- `getStampSVG()` / `getStampSVGFor(societeId)` — SVG stamp for print
- `getSignatureSVG()` — SVG signature for print

Also scattered across the file (defined much later, also global):
- `esc(text)` (line 2388) — second HTML-escape, used by accounting sections
- `_escHtmlInsc(v)` (line 2530) — third HTML-escape, used by inscriptions section
- `escHtml(t)` — defined inside rappels.js for its own use (conflicts possible)
- `num(value)` (line 2392) — parse float safely
- `fmtMoney(value)` (line 2396) — format with thousands separator
- `sanitizeInput(str, maxLen)` (line 8385) — strip HTML, trim

---

## Module: app.js — STORE object (lines 508–611, 2341–2361)

Two STORE implementations coexist:

**STORE v1 (lines 508–560):** Object with methods that read/write via `_storeGet`/`_storeSave`.

**STORE v2 (lines 2341–2361):** Object with lambdas that read/write raw localStorage directly.  
Example: `rdvs: () => JSON.parse(localStorage.getItem('mp_rdvs') || '[]')`

Code written after line 2341 uses STORE v2. Code written before uses STORE v1 or direct `_storeGet` calls. Both write to the same localStorage keys so data is consistent, but v2 bypasses the server sync queue.

---

## Known duplicate function declarations in app.js

These are re-declarations of the same function name. In JavaScript the last declaration wins, but the early copies are dead code and a source of confusion.

| Function | First declaration | Second declaration (active) |
|----------|------------------|----------------------------|
| `addLine()` | line 1919 (no params) | line 4485 (with desc, qty, pu, unit) |
| `editInvoice(id)` | line 1078 | line 4599 |
| `deleteInvoice(id)` | line 1094 | line 4626 |
| `setOmDateQuick(offsetDays)` | line 1923 | line 5085 |
| `addOmPerson()` | line 1905 (no params) | line 5102 (with name param) |
| `cancelOM()` | line 1988 | line 5202 |

The early declarations (lines ~1078–1988) are compatibility stubs from when the app was refactored. They may still be called from HTML `onclick` attributes that were not updated. Do not remove them until all HTML callers are verified.

---

## Cross-module dependency matrix

```
             logger  auth  app.js  taches  rappels  redaction
logger         —      —      —       —        —         —
auth          uses    —     uses     —        —         —
taches         —      —     uses     —        —         —
rappels        —      —     uses     —        —         —
redaction      —      —     uses     —        —         —
app.js        uses   ref    —        —        ref       ref
index.html     —     uses  uses      —        —         —
```

`uses` = calls functions from that module  
`ref` = may invoke if loaded (checked with typeof)

---

## Data structures used across modules

### Invoice (`mp_invoices[]`)
```
{
  id, num, year, date, type,
  clientName, clientAddr, clientMF, clientTVANum,
  lines: [{id, desc, qty, pu, unit}],
  tva, total, totalTTC,
  paymentMode, paymentStatus, paidDate,
  notes, societeId, updatedAt
}
```

### Rendez-vous (`mp_rdvs[]`)
```
{
  id, titre, date, heure, lieu,
  clientName, type, statut,
  montantHT, montantTTC, feeType,
  invoiceId, devisId, contractId,
  persons: [{name, role}],
  notes, updatedAt
}
```

### Contact (`mp_repertoire_contacts[]`)
```
{
  id, nom, prenom, tel1, tel2, email,
  adresse, ville, gouvernorat, pays,
  metier, domaine, note,
  importBatchId, updatedAt,
  tags: [], responsable: '',
  history: [{type, note, outcome, ts}],
  numero: int (auto-assigned)
}
```

### Tache (`mp_taches[]`)
```
{
  id, titre, type (simple/importante/urgente),
  dateEcheance, complete, completedAt,
  note, updatedAt
}
```

### Rappel (`mp_rappels[]`)
```
{
  id, titre, type, dateDebut, periode,
  nextDate, note, done, updatedAt
}
```
