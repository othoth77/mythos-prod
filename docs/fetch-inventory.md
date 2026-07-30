# fetch() Call Inventory — Mythos OS Stage 1C Part 1

**Date:** 2026-07-30  
**Audited files:** js/app.js, js/taches.js, js/rappels.js, js/redaction.js, js/auth.js  
**Total fetch() calls found:** 23 (22 in app.js, 2 in auth.js, 0 in taches/rappels/redaction)

---

## Categories

### 1 — SYNC ENGINE — DO NOT MIGRATE

The core bidirectional sync pipeline. These calls use `keepalive: true`, share
`AbortController` signals, or are called from `pagehide` event handlers. They
must remain raw `fetch()` calls.

| Line | Function | Method | URL | Notes |
|------|----------|--------|-----|-------|
| 108 | `_flushPending()` | POST | api.php | Flushes localStorage queue to server; core sync |
| 135 | `_flushPendingBeacon()` fallback A | POST | api.php | `keepalive: true` — browser keepalive, must not change |
| 138 | `_flushPendingBeacon()` fallback B | POST | api.php | `keepalive: true` — browser keepalive, must not change |
| 230 | `_pushCollection()` chunked path | POST | api.php | Chunked push loop; custom retry logic |
| 244 | `_pushCollection()` simple path | POST | api.php | Single-chunk push |
| 379 | `syncFromServer()` | GET | api.php?key=__all__ | Uses `_syncController.signal` (AbortController) |
| 8679 | `pushAllToServer()` | POST | api.php | User-triggered bulk push; no timeout by design |

**Why untouched:** `_apiPost` adds a 20 s AbortController timeout and rejects on
HTTP ≥ 400. The sync functions deliberately lack timeouts (retries handle
failures) and use `keepalive` for reliable delivery at page teardown. Changing
these would alter retry semantics, beacon behavior, and abort semantics.

---

### 2 — AUTO-BACKUP — DO NOT MIGRATE

Triggered automatically after write operations. Part of the data-safety layer.

| Line | Function | Method | URL | Notes |
|------|----------|--------|-----|-------|
| 205 | `_triggerAutoBackup()` | POST | api.php | Auto-triggered after every save; must never timeout |

**Why untouched:** Backup calls run silently in the background; a 20 s timeout
could silently drop a backup on large datasets. The user spec explicitly lists
`_triggerAutoBackup` in the "do not modify" category.

---

### 3 — BACKUP / RESTORE / CLEANUP — DO NOT MIGRATE

User-initiated maintenance operations. Server creates or reads `.zip`/`.json`
backup files.

| Line | Function | Method | URL | Notes |
|------|----------|--------|-----|-------|
| 8766 | `renderBackupDashboard()` | GET | api.php?action=list_backups | Fetches backup file list for display |
| 8801 | `runDiskCleanup()` | GET | api.php?action=cleanup | Triggers server-side file deletion |
| 8846 | `_restoreServerBackup()` POST | POST | api.php | Initiates server restore from backup id |
| 8855 | `_restoreServerBackup()` GET | GET | api.php?key=__all__ | Re-fetches all data after restore |

**Why untouched:** Stage 1C Part 1 explicitly excludes "backup or restore"
functions. The cleanup call has destructive server-side effects; incorrect
timeout behavior could corrupt the restore sequence.

---

### 4 — FILE UPLOAD / DOWNLOAD / DELETE — DO NOT MIGRATE

All calls to `/upload.php` for document attachments and camera captures.

| Line | Function | Method | URL | Notes |
|------|----------|--------|-----|-------|
| 9123 | `_openTextDocument()` | GET | dynamic `targetUrl` | Downloads document from server for editing |
| 9283 | (file save) | POST | /upload.php | Sends `FormData` — not JSON |
| 9331 | `deleteDoc()` | DELETE | /upload.php | Non-standard HTTP verb |
| 9473 | `_saveBulkDocs()` | POST | /upload.php | `FormData` — not JSON |
| 9632 | (camera save) | POST | /upload.php | `FormData` — not JSON |

**Why untouched:** These calls use `FormData` (not `application/json`), a
dynamic target URL, or the `DELETE` verb — none of which are supported by
`_apiPost` / `_apiGet`. They also target `/upload.php`, not `api.php`.

---

### 5 — GOOGLE SHEETS / EXTERNAL URLS — DO NOT MIGRATE

All calls to the Google Apps Script inscriptions endpoint.

| Line | Function | Method | URL | Notes |
|------|----------|--------|-----|-------|
| 2389 | `loadDashboardInscriptionsCount()` | GET | `INSCRIPTIONS_SCRIPT_URL` | External GAS endpoint |
| 2416 | `loadInscriptions()` | GET | `INSCRIPTIONS_SCRIPT_URL` | External GAS endpoint |
| 2595 | `reinitialiserListes()` | GET | `INSCRIPTIONS_SCRIPT_URL` | External GAS endpoint |
| 2733 | `pushToGoogleSheet()` | POST | Google Apps Script URL | Pushes row to Google Sheet |

**Why untouched:** `_apiGet` / `_apiPost` are hardwired to `api.php`. These
calls target external Google endpoints; routing them through `_apiFetch` would
require API layer changes outside the scope of Stage 1C.

---

### 6 — GOOGLE OAUTH / PHP PROXY — DO NOT MIGRATE

Contact import via Google OAuth token exchange.

| Line | Function | Method | URL | Notes |
|------|----------|--------|-----|-------|
| 3056 | (contact import) | GET | google_fetch_result.php | PHP proxy returning Google Contacts JSON |

**Why untouched:** Stage 1C Part 1 explicitly excludes Google OAuth flows.
`google_fetch_result.php` is not `api.php` and requires the OAuth token in the
query string.

---

### 7 — AUTH LOGOUT BEACON — DO NOT MIGRATE

Fire-and-forget calls during the logout sequence.

| File | Line | Function | Method | URL | Notes |
|------|------|----------|--------|-----|-------|
| auth.js | 233 | `AUTH.logout()` | POST | api.php | `keepalive: true` — session flush |
| auth.js | 234 | `AUTH.logout()` | POST | api.php | `keepalive: true` — backup payload |

**Why untouched:** Both calls use `keepalive: true` and immediately discard the
response (`.catch(() => {})`). They must survive page unload; adding an
AbortController timeout (as `_apiPost` does) would race against page teardown.

---

## Migration verdict for Stage 1C Part 1

**Zero calls qualify for migration in Part 1.**

Every `fetch()` call in the codebase falls into at least one protected
category. The criteria for a safe Part 1 migration require a call that
simultaneously:

- targets `api.php` ✓ (many qualify individually)
- is not part of the sync engine ✗
- is not backup / restore / cleanup ✗
- is not upload / download / file delete ✗
- is not Google-related ✗
- does not use `keepalive` or an external `AbortController` ✗

No call satisfies all criteria at once.

**The deliverable for Part 1 is this audit document.** Stage 1C Part 2 will
revisit after Stage 3 extracts business-module fetch calls into dedicated
plugin files, where the context and error handling are cleaner and migration
candidates can be isolated individually.

---

## taches.js / rappels.js / redaction.js

These three files contain **zero** `fetch()` calls. All server communication
from the tasks, reminders, and document modules flows through the shared sync
pipeline in `app.js` (`_flushPending`, `_pushCollection`).

---

## Compatibility layer

`_apiGet` and `_apiPost` from `js/core/api.js` are already in production from
Stage 1B (committed `682556a`). Their presence is verified by the Stage 1B
core tests (`tests/core-test.js`, 28/28 pass). No compatibility fallback is
required in Stage 1C Part 1 because no calls are being migrated.

When Stage 1C Part 2 does migrate calls, the compatibility guard will be:

```javascript
if (typeof _apiPost === 'function') {
  _apiPost({ ... }).then(...).catch(...);
} else {
  fetch('api.php', { method: 'POST', ... }).then(...).catch(...);
}
```

This guard is documented here for Part 2 implementation.
