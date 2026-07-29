# Mythos Prod — Architecture

**Stack:** Pure PHP + Vanilla JS SPA. No framework. No build step. No npm.
**Last audited:** 2026-07-29
**Production path:** `/var/www/uthinachess/0726/Prod/`

---

## Overview

Mythos Prod is a single-page application running entirely in the browser. The server serves static files (nginx) and handles `api.php` (PHP 8.x). All UI state, business logic, and data reside in JavaScript.

```
Browser (JS SPA)
    <-> localStorage  (client cache / write buffer)
    <-> fetch / sendBeacon (sync engine)
PHP api.php
    <-> file I/O
appdata/*.json  (server-side flat JSON — source of truth)
```

---

## File inventory

| File | Lines | Size | Role |
|------|------:|-----:|------|
| `index.html` | ~2 800 | 136 KB | Shell HTML + all page templates inline |
| `js/app.js` | 9 948 | 510 KB | **Monolith** — everything not extracted yet |
| `js/auth.js` | 429 | 17 KB | Authentication and session |
| `js/rappels.js` | 620 | 37 KB | Reminders module (extracted) |
| `js/redaction.js` | 1 198 | 66 KB | Document drafting module (extracted) |
| `js/taches.js` | 644 | 37 KB | Task manager (extracted) |
| `js/logger.js` | 46 | 1.3 KB | Activity logger |
| `js/app-fresh.js` | 348 | 9 KB | Experimental rewrite — unused in production |
| `js/storage.js` | 1 | stub | Reserved — code still in app.js |
| `js/utils.js` | 1 | stub | Reserved — code still in app.js |
| `js/calendrier.js` | 1 | stub | Reserved — code still in app.js |
| `js/clients.js` | 1 | stub | Reserved — code still in app.js |
| `js/collaborateurs.js` | 1 | stub | Reserved — code still in app.js |
| `js/dashboard.js` | 1 | stub | Reserved — code still in app.js |
| `js/factures.js` | 1 | stub | Reserved — code still in app.js |
| `js/natures.js` | 1 | stub | Reserved — code still in app.js |
| `js/ordres-mission.js` | 1 | stub | Reserved — code still in app.js |
| `api.php` | ~290 | 11 KB | REST API — flat JSON read/write + sync |
| `google_auth.php` | ~20 | — | Initiates Google OAuth redirect |
| `google_callback.php` | ~120 | — | Token exchange + contact import |
| `google_fetch_result.php` | ~20 | — | One-time import token endpoint |
| `cleanup.php` | — | — | Manual data cleanup (key-gated) |
| `upload.php` | — | — | Document/photo upload |

---

## Script loading order

In `<head>` with `defer` (execute after DOM is fully parsed):
1. `js/rappels.js`
2. `js/redaction.js`

In `<body>` — blocking, in document order:
3. `js/logger.js` — LOGGER object
4. `js/auth.js` — AUTH object
5. `js/app.js` — sync engine + all business logic
6. `js/taches.js` — depends on `_storeGet` from app.js

After DOM parsed (defer fires):
7. `js/rappels.js` — depends on `escHtml` from app.js
8. `js/redaction.js` — depends on `_storeGet`/`_storeSave` from app.js

`taches.js` and `redaction.js` have conditional fallbacks: if `_storeGet` is undefined they fall back to raw `localStorage`. Two storage paths coexist.

---

## Sync engine (app.js lines 63–507)

The most critical subsystem. All reads and writes go through here.

```
_storeGet(key, default)      read from in-memory cache or localStorage
_storeSave(key, data)        write to localStorage + queue server push
     |
_pendingKeys                 Set persisted as _mp_pending_keys
     |
_pushCollection(key, value)  POST to api.php (chunked if >800 items)
```

**On login:** `syncFromServer()` fires -> GET `api.php?key=__all__` -> merge server+local by `updatedAt` -> push any local-only keys back up to server.

**On every save:** `_storeSave()` -> immediate localStorage write -> key added to `_pendingKeys` -> debounced server push (within 3s) -> auto-backup trigger.

**On logout/pagehide:** `_flushPendingBeacon()` -> `navigator.sendBeacon()` sends all pending keys as `__bulk__` payload. Data loss risk if beacon is blocked.

---

## Business localStorage keys (all synced to server)

```
mp_invoices              Sales invoices
mp_devis                 Quotes
mp_contracts             Contracts
mp_clients               Clients
mp_oms                   Ordres de mission
mp_collabs               Collaborators
mp_natures               Nature of services
mp_rdvs                  Rendez-vous
mp_representations       Representations
mp_suppliers             Suppliers
mp_purchases             Purchase invoices
mp_expenses              Expenses
mp_expense_categories    Expense categories
mp_bank_entries          Bank statement lines
mp_cash_entries          Cash entries
mp_documents             Document metadata
mp_vehicules             Vehicles (OM)
mp_taches                Tasks
mp_rappels               Reminders
mp_rappel_types          Reminder categories
mp_repertoire_contacts   Contact directory
mp_repertoire_imports    Import batch history
mp_appels                Call logs
mp_validated_inscriptions  Validated inscriptions
mp_call_script           Call script text
mp_sheet_webhook_url     Google Sheet webhook URL
mp_backup_versions       Manual backup snapshots
mp_rddocs_das            Redaction: DAS document list
mp_rddocs_autres         Redaction: other document list
mp_rdtpl_{docId}         Redaction: template data (dynamic key)
mp_rdent_{docId}         Redaction: entry data (dynamic key)
```

Sync engine internals (not business data):
```
_mp_sync_meta            Per-collection timestamps
_mp_pending_keys         Dirty key queue
```

Auth and logs (never synced to server):
```
mp_auth_session          Session token {ts} — 8h validity
mp_activity_log          Activity log (max 200 entries)
```

Migration guards (never delete — one-time flags):
```
mp_restored_from_1778961756472_v2
mp_restored_from_1778961756472_v4
```

---

## api.php endpoints

| Method | Param / Body | Action |
|--------|-------------|--------|
| GET | `?key=__all__` | All collections + metadata |
| GET | `?action=meta` | Timestamps only |
| GET | `?action=health` | Server health check |
| GET | `?action=list_backups` | List backup files |
| GET | `?key={collection}` | Single collection |
| POST | `{key, value, updatedAt}` | Save single collection |
| POST | `{__bulk__, updatedAt}` | Bulk save (logout flush) |
| POST | `{__auto_backup__, label}` | Create backup snapshot |
| POST | `{__chunk__, key, ...}` | Chunked upload for large arrays |
| POST | `{__restore_backup__: file}` | Restore from backup file |

---

## Server-side file layout

```
appdata/
  {collection}.json          one file per collection
  meta.json                  {key: {updatedAt, count}}
  backups/
    YYYY-MM-DD_HH-mm-ss_*.json   auto-backup snapshots (max 10 kept)
  google_imports/
    {token}.json             one-time Google import result (purged after 1h)
  chunks_{key}/              temporary chunk assembly (auto-cleaned)
documents/                   uploaded files (excluded from git)
```

---

## Google OAuth contact import flow

1. User clicks "Importer depuis Google"
2. JS: `startGoogleContactsImport()` -> GET `google_auth.php`
3. PHP: 302 redirect to `accounts.google.com` (OAuth consent)
4. Google: 302 redirect to `google_callback.php?code=...`
5. PHP: exchange code for access_token via People API
6. PHP: fetch all contacts (paginated, 1000/page)
7. PHP: write directly to `appdata/mp_repertoire_contacts.json` (server-side — avoids localStorage quota issues on large imports)
8. PHP: store one-time result in `appdata/google_imports/{token}.json`
9. PHP: 302 redirect to `index.html?googleImportToken={token}#gestion-contacts`
10. JS: `_checkGoogleImportToken()` detects URL param on app start
11. JS: GET `google_fetch_result.php?token={token}` (file deleted after read)
12. JS: refresh contacts view from server

---

## Global objects

| Name | File | Description |
|------|------|-------------|
| `AUTH` | auth.js | Login, session, logout |
| `LOGGER` | logger.js | Activity log ring buffer |
| `STORE` | app.js:2344 | Collection read/write accessors |
| `SOCIETES` | app.js:10 | Company data for OM headers |
| `DEVIS_SOCIETES` | app.js:27 | Company data for quote headers |

---

## app.js section map

| Lines | Section |
|-------|---------|
| 1–62 | Logo constants + company data |
| 63–507 | **Sync engine** (critical — do not touch) |
| 508–611 | STORE object + restore guards |
| 612–699 | Utility functions |
| 700–975 | Dashboard |
| 976–1015 | Navigation |
| 1016–2340 | Devis, Rendez-vous v1, OM wrappers, init |
| 2341–2527 | STORE v2 + bootstrapStableApp |
| 2528–2870 | Inscriptions + call management |
| 2871–3070 | Sidebar stats, view routing |
| 3071–4413 | Contact directory (repertoire) |
| 4413–4965 | Invoices (CRUD + print) |
| 4966–5296 | Ordres de Mission |
| 5297–5568 | Clients, Collaborateurs, Natures |
| 5569–5740 | Fournisseurs |
| 5741–8382 | Accounting (expenses, bank, cash, purchases) |
| 8378–8599 | Helpers, bootstrapStableApp, sidebar, bg sync |
| 8600–8841 | Calendar |
| 8842–9040 | Backup/restore/export |
| 9040–9168 | Spectacle calculator |
| 9168–9660 | Documentation module |
| 9660–9948 | Camera module |
