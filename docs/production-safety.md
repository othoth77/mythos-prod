# Mythos Prod — Production Safety

**Last updated:** 2026-07-29

This document defines what must never be done, what must always be verified, and how to deploy safely.

---

## The golden rule

**The production server is `/var/www/uthinachess/0726/Prod/` on the VPS.**  
**Git lives in `/home/deploy/projects/mythos-prod/`.**  
These are two separate directories. Git is never initialized inside `/var/www`.

---

## Files that must never be committed to Git

| File/Path | Why |
|-----------|-----|
| `google_config.php` | Contains real Google OAuth `client_id` and `client_secret` |
| `ACCES.txt` | Contains plaintext access code (numeric PIN) |
| `appdata/` | Live client data — invoices, contracts, clients, contacts |
| `documents/` | Uploaded client documents |
| `data/restore-*.js` | Data restore snapshots from production |

All of these are in `.gitignore`. Before every commit, verify with `git status` that none appear.

---

## Verification before any deployment

Run this from `/home/deploy/projects/mythos-prod/` before copying any file to production:

```bash
# 1. Confirm no secrets staged
git status
git diff --cached --name-only | grep -E "google_config|ACCES|appdata/"

# 2. Secret scan of changed files
git diff --name-only HEAD | xargs grep -l "client_secret\s*=\s*['\"]" 2>/dev/null
```

If either command returns output, stop. Fix before deploying.

---

## How to deploy a change to production

Copy only source files. Never copy `appdata/`, `documents/`, or credentials.

```bash
rsync -av \
  --exclude='appdata/' \
  --exclude='documents/' \
  --exclude='google_config.php' \
  --exclude='ACCES.txt' \
  --exclude='data/restore-*.js' \
  --exclude='.git/' \
  --exclude='docs/' \
  --exclude='README.md' \
  --exclude='google_config.php.example' \
  /home/deploy/projects/mythos-prod/ \
  /var/www/uthinachess/0726/Prod/
```

Run as `deploy` user. The `appdata/` directory on the server is owned by `www-data` and must not be overwritten.

---

## High-risk functions — do not modify without full regression test

These functions are load-bearing for data integrity. A bug here causes data loss or login failure.

| Function | File | Lines | Risk |
|----------|------|-------|------|
| `syncFromServer()` | app.js | 392–507 | Boots entire app; controls data merge |
| `_storeSave()` | app.js | 278–303 | All writes go through this |
| `_storeGet()` | app.js | 192–213 | All reads go through this |
| `_flushPendingBeacon()` | app.js | 125–151 | Last chance to save on tab close |
| `_pushCollection()` | app.js | 241–276 | Handles chunked upload for large arrays |
| `AUTH.logout()` | auth.js | — | Syncs data before destroying session |
| `AUTH.handleLogin()` | auth.js | — | Triggers sync + app bootstrap |
| `bootstrapStableApp()` | app.js | 8456 | Initializes all UI after sync |

**Do not add `await` to `_flushPendingBeacon`** — it uses `sendBeacon` which is fire-and-forget by design. Making it async will cause the data save to be abandoned when the page unloads.

---

## Migration guards — never delete

Two one-time data migration functions exist in app.js:

```javascript
const RESTORE_20260516_FLAG = 'mp_restored_from_1778961756472_v2';   // line 560
const RESTORE_20260516_FORCE_FLAG = 'mp_restored_from_1778961756472_v4'; // line 2363
```

These functions (`restoreBackup20260516Once`, `forceRestoreBackup20260516`) check a localStorage flag before running. If the flag is already set they do nothing. They are safe to keep indefinitely.

**Do not remove them** until you have confirmed that every production user's browser already has the flag set. There is currently no way to confirm this remotely.

---

## Known risks

### 1. localStorage quota

The browser allows ~5–10 MB per origin. The contact directory (`mp_repertoire_contacts`) can grow large after Google imports. If quota is exceeded, `_storeSave` will throw. The try/catch in `_safeSet` (app.js:204) prevents a crash but the write is silently dropped.

**Mitigation:** Large collections are chunked on upload to the server (see `_pushCollection`). The server is the source of truth. If localStorage fills up, the user can clear it — data will re-sync from the server on next login.

### 2. Duplicate global function declarations

JavaScript uses the last declaration when a function name appears twice. The early stubs (lines ~1078–1988) are effectively dead code. However, if any HTML `onclick` attribute calls a function by an argument signature that only exists in the early version, behavior could differ.

**Rule:** Never remove an early stub until all HTML `onclick` callers have been verified against the later implementation.

### 3. STORE v2 bypasses sync queue

The STORE object defined at app.js:2341–2361 writes directly to localStorage without going through `_storeSave`. Data written via STORE v2 will not be pushed to the server until the next `syncFromServer()` call (which happens only on login or window focus).

**Rule:** Do not use STORE v2 for any new collection writes. Use `_storeSave()` directly or the unified Store from Phase 3 of the refactoring plan.

### 4. No access control on api.php

`api.php` has no authentication. Any client with network access to the server can read or write any collection. This is acceptable because:
- The server is behind nginx; `appdata/` is not web-accessible directly
- The application itself is password-protected (auth.js)
- The VPS is not publicly listed

**Risk if exposed:** Anyone who discovers the URL can read all invoices, clients, and contacts without a password.

**Mitigation before any public deployment:** Add a shared secret header check to api.php, or move `appdata/` outside the web root.

### 5. Google OAuth uses `online` access_type

`google_callback.php` requests `access_type: online`. This means the access token expires after 1 hour and there is no refresh token. Long import sessions that take more than 1 hour will fail mid-import.

This is intentional (simpler security) and acceptable for the current use case (infrequent contact imports). Do not change to `offline` without also implementing refresh token storage.

---

## What to verify after every deployment

1. Load `https://uthinachess.tn/0726/Prod/` — login screen appears.
2. Login succeeds and the dashboard loads.
3. Check browser console for errors.
4. Create one test invoice, save it. Reload the page. Invoice still appears.
5. Run `https://uthinachess.tn/0726/Prod/api.php?action=health` — response should show `dataDirWritable: true`.
6. Logout — ensure spinner shows "Sauvegarde en cours…" and then page reloads.

---

## Emergency rollback

If a bad deployment breaks production:

```bash
# The old source is still on the server — restore from git
git -C /home/deploy/projects/mythos-prod log --oneline -5

# Copy the previous version's files to production
git -C /home/deploy/projects/mythos-prod show HEAD~1:js/app.js > /var/www/uthinachess/0726/Prod/js/app.js
```

Or restore all source files from the previous commit using rsync from a `git worktree` checkout.

**Data in `appdata/` is never affected by a source file rollback** — it is owned by `www-data` and never overwritten by the deploy procedure above.

---

## Backup verification

Server-side backups are created automatically by api.php whenever a `__auto_backup__` POST is received (triggered by `_triggerAutoBackup()` in app.js on every save, debounced 3s).

Backups are kept in `appdata/backups/`, max 10 files. To verify:

```bash
ls -lht /var/www/uthinachess/0726/Prod/appdata/backups/ | head -5
```

If no backups exist, the auto-backup mechanism is not firing — check browser console for network errors on `api.php` POST.
