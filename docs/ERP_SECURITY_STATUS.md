# ERP — security status and static preservation mode

**Route:** `erp.mythosprod.xyz`
**Mode:** STATIC PRESERVATION — PHP not executed, not publicly reachable
**Applied:** 2026-08-22
**Source of truth for deployment steps:** `sites/erp.mythosprod.xyz/DEPLOYMENT.md`

---

## 1. Current risk

The legacy ERP is the repository-root application: `index.html`, `js/` (72 files),
`css/`, `assets/`, `data/`, and six PHP endpoints. It predates the Mythos Hub and
was never served by any host.

Reading the source on 2026-08-22 found the following. **None of it is currently
exploitable, because PHP is not executed on this route and the `.php` files are
not in the docroot at all** — but each is the reason the route is static.

| Endpoint | Auth checks | Writes | Note |
|---|---|---|---|
| `api.php` | **0** | 10 | `$key` is allow-listed before path use |
| `upload.php` | **0** | 3 | `move_uploaded_file` |
| `cleanup.php` | **0** | 3 | |
| `google_auth.php` | 0 | 0 | |
| `google_callback.php` | 10 | 6 | |
| `google_fetch_result.php` | 4 | 1 | |

### 1.1 Arbitrary file write → remote code execution (the blocking one)

`upload.php` derives the stored file's extension from the **client-supplied
filename**:

```php
$ext  = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
$dest = $dir . $docId . '_' . time() . '.' . $ext;
move_uploaded_file($file['tmp_name'], $dest);
```

The only gate is a whitelist on `$file['type']` — the client's own
`Content-Type` header, which is trivially forged. Uploading `x.php` while
declaring `application/pdf` writes a `.php` file into the document directory.
With PHP enabled on the docroot that is **unauthenticated remote code
execution**, reachable by anyone who can reach the route.

### 1.2 Path traversal on the JSON store (secondary)

`api.php` validates `$key` against `ALLOWED_KEYS` or the prefixes `mp_rdtpl_` /
`mp_rdent_`. The allow-list is sound; the prefix rule is not — `mp_rdtpl_../../x`
satisfies `str_starts_with` and then reaches `DATA_DIR . $key . '.json'`. The
`.json` suffix is forced, so this is an arbitrary-JSON-write, not a code write.

### 1.3 No credential exposure

`google_config.php` does **not** exist on disk; only `google_config.php.example`
is committed. The served asset trees were scanned before deployment: **0 `.php`
files** and **0 credential patterns** in `js/`, `css/`, `assets/`, `data/`.

---

## 2. Static mode architecture

```
                 erp.mythosprod.xyz  (no DNS record)
                          │
                     nginx :80
                          │
        ┌─────────────────┼──────────────────────────┐
        │                 │                          │
  allow 127.0.0.1     location ~ \.php$        location ~ /\.
  allow ::1              return 404               deny all
  deny all                  │
        │                   └── location ~ ^/(api|upload|cleanup|
        │                         google_auth|google_callback|
        │                         google_fetch_result)\.php$  → 404
        │
   root /var/www/erp.mythosprod.xyz   ← 127 files, 6.3 MB
   index.html · manifest.json · robots.txt · js/ · css/ · assets/ · data/
   NO .php files present at all
```

Four independent layers, each sufficient on its own:

1. **The `.php` files are not in the docroot.** They were never copied. The
   application of record stays in Git.
2. **No PHP handler exists.** The vhost contains **zero** `fastcgi_pass`
   directives. PHP 8.5 and a working FPM socket are present on this host, and
   are deliberately not wired to this route.
3. **`location ~ \.php$` returns 404** for any `.php` path, executed or not, so
   a file restored by accident stays inert.
4. **The write endpoints are refused by name**, so a rename cannot reach them.

Plus **`allow 127.0.0.1; deny all;`**. `erp.mythosprod.xyz` has no DNS record,
but a `server_name` is reachable by Host-header spoofing against the IP — which
is exposure by another name. Until DNS, TLS and platform authentication exist,
only the host itself may read this route.

### 2.1 Verified behaviour

Measured on 2026-08-22 after `nginx -t` and reload:

| Request | Result |
|---|---|
| `/`, `/manifest.json`, `/js/app-fresh.js` (from localhost) | 200 |
| `/api.php` `/upload.php` `/cleanup.php` `/google_*.php` | **404** |
| `/anything.php`, `/js/x.php`, `/documents/x.php` | **404** |
| `POST /api.php`, `POST /cleanup.php` | **404** |
| `POST /upload.php` multipart, `filename=evil.php`, `type=application/pdf` | **404** |
| Any request from the public interface (`51.68.226.211`) | **403** |
| `/.git/config` | **403** |
| `documents/` directory in docroot | absent |

Unaffected by the change: the Hub, OS Console, Command Center, Status Center and
all five independent public projects continued to answer normally, unknown-Host
handling was unchanged, and `nginx -t` passed before every reload.

---

## 3. What static mode does and does not give you

**Does:** the ERP interface is preserved, readable and reviewable; its data is
untouched; nothing about it is reachable from the internet; and no future edit
can quietly turn it into an execution surface without deleting several
independent guards.

**Does not:** the application's browser-side features that call `api.php` or
`upload.php` will not function. Those calls return 404. This is a preservation
measure, not a working deployment — the ERP is kept, not restored.

---

## 4. Required remediation before dynamic PHP

All four must be true before `fastcgi_pass` may appear in the vhost, and before
the `deny all` guard is removed. They are ordered by dependency.

### 4.1 Authentication

No write endpoint has any authentication today. Every state-changing path must
sit behind the platform's authentication before it is reachable. The Hub's
access point (`os.mythosprod.xyz/login`) is the intended attachment point; the
ERP becomes a protected upstream behind it, never an independently reachable
origin.

### 4.2 Upload validation

- Derive the extension **server-side** from inspected content, never from
  `$file['name']` or the client's `Content-Type`.
- Enforce an **allow-list** of extensions, not a deny-list.
- Sanitise `$cat` and `$docId` — both currently reach a filesystem path.
- Cap size and count per request.

### 4.3 Storage isolation

- Uploads must land **outside the docroot** and be served through a handler that
  sets `Content-Disposition` and a non-executable content type.
- If they must live under the docroot, PHP execution must be disabled for that
  directory in nginx **and** the directory must not be writable by the PHP
  process — belt and braces, because either alone has failed before.
- Tighten the `mp_rdtpl_` / `mp_rdent_` prefix rule in `api.php` so `..` cannot
  appear in `$key`.

### 4.4 Code review

The six PHP endpoints have not had a security review. Before any of them is
served: a full read of each, with particular attention to every
`file_put_contents`, `mkdir`, `unlink` and `move_uploaded_file` call site, and to
`google_callback.php`, which is the only endpoint that both checks a session and
shells out.

---

## 5. Rollback

Static, no state, no database:

```bash
sudo rm /etc/nginx/sites-enabled/erp.mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
```

`/var/www/erp.mythosprod.xyz` is a copy; removing it loses nothing, because the
application of record is in Git and was never modified.

---

## 6. Data preservation

Nothing was migrated, moved or deleted at any point.

- The ERP has **no server-side database**. No PHP file references `mysqli`,
  `PDO` or `pg_connect`. State lives in the browser's `localStorage` and in JSON
  files under `data/`.
- `data/` contains one committed file, `default-data.js`, 83 bytes.
- The repository copy is byte-identical to `main`: `index.html`, `api.php`,
  `upload.php`, `cleanup.php`, `manifest.json`, 72 `js/` files, 8 `css/` files.
- The docroot is a **copy**. The source was never modified — the repository
  reported 0 dirty paths throughout.
