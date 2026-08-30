# ERP endpoint security audit — Stage 1

**Scope:** the six PHP endpoints of the legacy Mythos Prod ERP.
**Audited at:** `92d83ab`, in `/home/deploy/worktrees/erp-redesign` (branch `feat/erp-redesign`).
**Method:** full source read of all 6 files (735 lines), plus empirical confirmation
of the traversal finding.
**Date:** 2026-08-22.

**Current exposure: none.** PHP is not executed on `erp.mythosprod.xyz`, the
`.php` files are not in the docroot, every `.php` path returns 404, and the
vhost is loopback-only. Everything below is **latent** — a property of the code,
not a live vulnerability. It becomes live the moment PHP is enabled.

---

## 1. Endpoint inventory

Six files, **16 logical endpoints**. "Auth" is authentication *enforced by the
server*; `js/auth.js` is client-side and is not counted.

### api.php — 285 lines, 10 endpoints

| # | Method | Endpoint | Purpose | Auth | Writes |
|---|---|---|---|---|---|
| 1 | GET | `?action=meta` | read collection metadata | **none** | – |
| 2 | GET | `?action=cleanup&key=` | `include_once cleanup.php` | shared key | via include |
| 3 | GET | `?action=health` | disk probe — writes then deletes a test file | **none** | ✔ |
| 4 | GET | `?action=list_backups` | enumerate backups | **none** | – |
| 5 | GET | `?key=…` / `?key=__all__` | read any allowed collection (incl. `glob` of `mp_rdtpl_*`, `mp_rdent_*`) | **none** | – |
| 6 | POST | `chunkIndex`/`totalChunks` | chunked collection write | **none** | ✔ |
| 7 | POST | `__create_backup__` | snapshot all collections; prunes old backups (`unlink`) | **none** | ✔ |
| 8 | POST | `__restore_backup__` | overwrite all collections from a backup file | **none** | ✔ |
| 9 | POST | bulk sync | mass overwrite, "sending device wins" | **none** | ✔ |
| 10 | POST | single `key`/`value` | write one collection | **none** | ✔ |

### upload.php — 105 lines, 2 endpoints

| # | Method | Endpoint | Purpose | Auth | Writes |
|---|---|---|---|---|---|
| 11 | POST | `/upload.php` | document upload → `documents/$cat/` | **none** | ✔ |
| 12 | DELETE | `/upload.php` | delete a document by URL | **none** | ✔ |

### cleanup.php — 127 lines, 1 endpoint

| # | Method | Endpoint | Purpose | Auth | Writes |
|---|---|---|---|---|---|
| 13 | GET/POST | `?key=` | prune backups, report disk usage | shared key | ✔ `unlink` |

### Google OAuth — 3 files, 3 endpoints

| # | Method | Endpoint | Purpose | Auth | Writes |
|---|---|---|---|---|---|
| 14 | GET | `google_auth.php` | start OAuth (contacts.readonly) | **none** | – |
| 15 | GET | `google_callback.php` | token exchange, People API fetch, write contacts | **none** | ✔ |
| 16 | GET | `google_fetch_result.php?token=` | one-time read of import result | token only | ✔ `unlink` |

**Admin areas:** none. There is no admin UI, no role check, and no privileged
endpoint — endpoints 2, 7, 8 and 13 are administrative *in effect* (mass
overwrite, deletion, pruning) while being reachable exactly like any other.

**Database access points:** **none.** No file references `mysqli`, `PDO` or
`pg_connect`. All persistence is `file_put_contents` / `file_get_contents` under
`appdata/`, plus `localStorage` in the browser.

**File operations:** 23 call sites across `file_put_contents`, `file_get_contents`,
`unlink`, `mkdir`, `glob`, `move_uploaded_file`.

---

## 2. Risk classification

| ID | Finding | Severity | Endpoint |
|---|---|---|---|
| **C1** | Upload extension taken from the client-supplied filename | **Critical** | 11 |
| **C2** | No server-side authentication on any data endpoint | **Critical** | 1,3–12,14–16 |
| **H3** | Path traversal in the collection key → arbitrary `.json` read/write | **High** | 5, 10 |
| **H4** | Shared secret hardcoded in source and committed | **High** | 2, 13 |
| **H5** | Uploads land inside the document root | **High** | 11 |
| **H6** | `Access-Control-Allow-Origin: *` on write endpoints | **High** | 1–12, 16 |
| **M7** | OAuth flow has no `state` parameter | **Medium** | 14, 15 |
| **M8** | Import token travels in a URL query string | **Medium** | 15, 16 |
| **M9** | No audit log of any state change | **Medium** | all |
| **M10** | Restore overwrites every collection with no confirmation step | **Medium** | 8, 9 |
| **L11** | Delete-by-URL regex permits `.` sequences | **Low** | 12 |
| **L12** | `require` of an absent config fatals | **Low** | 14, 15 |

### C1 — Upload extension is attacker-controlled (Critical)

```php
if (!in_array($file['type'], $allowed)) { … }          // client-supplied MIME
$ext      = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));   // client-supplied
$filename = $docId . '_' . time() . '.' . $ext;
$dest     = $dir . $filename;                           // __DIR__/documents/$cat/
move_uploaded_file($file['tmp_name'], $dest);
```

The only gate is `$file['type']` — the client's own `Content-Type` header, freely
forged. There is **no allow-list on `$ext` itself**. Uploading `x.php` while
declaring `application/pdf` writes `…_1234567890.php` into the docroot. With PHP
enabled that is **unauthenticated remote code execution**.

`$cat` and `$docId` **are** properly sanitised
(`preg_replace('/[^a-z\-]/','')` and `/[^a-zA-Z0-9_\-]/`), so there is no
traversal here — the extension alone is the defect.

### C2 — No authentication (Critical)

Zero of six files call `session_start()`. Fifteen of sixteen endpoints require
nothing at all; the two "protected" ones share a static key (H4). Any party who
can reach the route can read every client, invoice, contract and bank entry, and
can overwrite or destroy all of them.

### H3 — Path traversal in the collection key (High)

```php
function is_key_allowed(string $key): bool {
    if (in_array($key, ALLOWED_KEYS, true)) return true;
    if (str_starts_with($key, 'mp_rdtpl_')) return true;   // ← prefix, not shape
    if (str_starts_with($key, 'mp_rdent_')) return true;
    return false;
}
function data_write(string $key, mixed $value, …): bool {
    $ok = file_put_contents(DATA_DIR . $key . '.json', …);  // ← unsanitised
}
```

The allow-list branch is sound; the **prefix branch is not**. Confirmed
empirically during this audit:

```
mp_clients                        allowed=YES  -> appdata/mp_clients.json
mp_rdtpl_ok                       allowed=YES  -> appdata/mp_rdtpl_ok.json
mp_rdtpl_../../../../tmp/pwned    allowed=YES  -> appdata/mp_rdtpl_../../../../tmp/pwned.json
mp_evil                           allowed=no
```

Arbitrary **write** (endpoint 10) and arbitrary **read** (endpoint 5) of any
`.json` path the PHP process can reach. The `.json` suffix is forced, so this is
not directly code execution — but combined with C1 it does not need to be.

Note the chunked-write path (endpoint 6) *does* sanitise
(`preg_replace('/[^a-zA-Z0-9_]/','',$key)`) and the restore path (endpoint 8)
uses `basename()`. The defect is confined to `data_read`/`data_write`.

### H4 — Committed shared secret (High)

`cleanup.php:11` defines `CLEANUP_KEY` as a string literal in source. The file
is committed to a repository that is public. **The value must be treated as
compromised**, and rotating it is not a fix — the mechanism is wrong. It gates
endpoints 2 and 13, both destructive.

### H5 — Uploads inside the document root (High)

`$dir = __DIR__ . '/documents/' . $cat . '/'`, served back as
`/documents/$cat/$filename`. Uploaded bytes are directly addressable. This is
what converts C1 from "writes a file" into "executes a file".

### H6 — Wildcard CORS on write endpoints (High)

`api.php`, `upload.php` and `google_fetch_result.php` all send
`Access-Control-Allow-Origin: *`, with `POST, DELETE` allowed. Any website a
logged-in user visits can call these endpoints cross-origin. Combined with C2
(no auth) the browser needs no credentials for it to work.

### M7 / M8 — OAuth weaknesses (Medium)

`google_auth.php` builds the authorisation URL with no `state` parameter, and
`google_callback.php` never validates one — the flow has **no CSRF protection**.
Separately, the import token is returned via
`Location: /index.html?googleImportToken=…`, so it lands in browser history,
`Referer` headers and any intermediary log.

Positives worth recording: the token itself is `bin2hex(random_bytes(16))`
(128-bit), `google_fetch_result.php` sanitises it to `[a-f0-9]` and deletes the
file on first read, the requested scope is `contacts.readonly`, and
`gc_write()` is only ever called with hardcoded literal keys — no traversal.

### M9 / M10 (Medium), L11 / L12 (Low)

No endpoint records who changed what. Restore and bulk-sync overwrite every
collection in one call with no confirmation or dry-run. The delete-by-URL regex
`^/documents/[a-z\-]+/[a-zA-Z0-9_\-\.]+$` permits `.` sequences in the filename
segment (no slash, so traversal is not reachable, but it is looser than needed).
`google_auth.php` and `google_callback.php` `require` an absent
`google_config.php`, so both currently fatal — an availability defect that can
also surface paths in error output.

---

## 3. Required fixes

Ordered by dependency. **None may be skipped before PHP is enabled.**

| # | Fix | Closes |
|---|---|---|
| F1 | Server-side session auth in front of **every** endpoint; deny by default | C2 |
| F2 | Roles and permissions enforced at the endpoint, not the UI; endpoints 2, 7, 8, 13 become admin-only | C2, H4 |
| F3 | Upload: derive type from **server-side content inspection**; allow-list extensions; reject anything not on it | C1 |
| F4 | Move upload storage **outside the docroot**; serve through a handler that sets `Content-Disposition` and a non-executable type | H5, C1 |
| F5 | Replace the key prefix rule with a shape check (`/^mp_(rdtpl\|rdent)_[A-Za-z0-9_]+$/`) and `basename()` before every path concat | H3 |
| F6 | Delete `CLEANUP_KEY`; cleanup becomes an authenticated admin action | H4 |
| F7 | Replace `Access-Control-Allow-Origin: *` with an explicit origin allow-list, or drop CORS entirely if same-origin | H6 |
| F8 | Add `state` to the OAuth request and validate it on callback | M7 |
| F9 | Return the import token in a one-time `POST` body or a short-lived cookie, not a URL | M8 |
| F10 | Append-only audit log: actor, action, collection, timestamp, outcome | M9 |
| F11 | Restore/bulk-sync require explicit confirmation and write a pre-restore snapshot | M10 |
| F12 | Tighten the delete regex; make config absence a handled error, not a fatal | L11, L12 |

---

## 4. Migration recommendations

The redesign should not carry these endpoints forward as they are. Recommended
shape:

1. **Single authenticated API boundary.** One entry point behind the platform
   session; the current 16 ad-hoc endpoints become routed actions. F1, F2 and F7
   are then structural rather than per-file patches.
2. **Storage in a real datastore.** The traversal class (H3) exists because
   collection names are filesystem paths. With PostgreSQL — the Stage 0
   recommendation — a collection name is a value, not a path, and the whole
   class disappears. It also brings the ERP into the verified R2 backup, closing
   the durability gap.
3. **Uploads as an isolated service.** Content-inspected, extension-allow-listed,
   stored outside the docroot, served through an authenticated handler. F3, F4
   and L11 collapse into one component.
4. **Google import as an optional adapter**, off by default, with `state`
   validation and no URL-borne tokens. It is currently non-functional (L12), so
   there is no regression risk in rebuilding it.
5. **Audit log from day one** (F10). Retrofitting one across 16 endpoints is
   harder than building one behind a single boundary.

**What deliberately survives:** the plugin SDK, router, event bus and the 28
extracted domain modules. The defects are in the PHP tier and the storage model,
not in the client architecture.

---

## 5. Stage 1 conclusion

- **16 endpoints** audited across 735 lines.
- **2 Critical, 4 High, 4 Medium, 2 Low.**
- **0 database access points** — there is no database.
- **0 admin areas** — but 4 endpoints are administrative in effect and unguarded.
- **1 committed secret**, to be treated as compromised.
- **1 traversal confirmed empirically**, not merely by reading.

Stage 2 (design system) may proceed in the worktree without touching any of
this. **No PHP endpoint may be enabled until F1–F12 are complete and re-audited
(Stage 6).**
