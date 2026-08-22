# erp.mythosprod.xyz — legacy ERP preservation runbook

**Status: PREPARED, NOT DEPLOYED — and deliberately not deployable yet.**

Two independent things block go-live. One is administrative, one is a
security finding. Both are recorded here because the second is the reason
this runbook does not simply say "run certbot".

---

## 0. What the legacy ERP actually is

The application at the repository root — `index.html` (143 KB), `js/` (72
files), `css/`, `data/`, and six PHP endpoints. It is the pre-Hub Mythos Prod
ERP.

Audited 2026-08-22:

- **It has no server-side database.** No PHP file references `mysqli`, `PDO`
  or `pg_connect`. State lives in the browser (`localStorage`) and in
  JSON files written under `data/` by `api.php`.
- **`data/` holds one committed file** (`default-data.js`, 83 bytes). There
  is no accumulated production dataset in the repository.
- **Nothing on the host serves it.** No nginx site roots the checkout. It has
  never been reachable from the internet, and it was never on the apex.

**Preservation therefore means leaving it exactly where it is.** It is
committed to `main`, and nothing about the Hub deployment moved, rewrote or
deleted any part of it. There is no data migration to perform, because there
is no server-side data to migrate.

---

## 1. Blocker A — DNS does not exist (owner action)

```
dig +short erp.mythosprod.xyz A   ->  (empty)
```

An `A` record for `erp.mythosprod.xyz` → `51.68.226.211` is required before
any vhost can be served or any certificate issued. DNS changes are an
owner-approval action (AGENTS.md §25.3). Nothing in this runbook can proceed
without it.

---

## 2. Blocker B — the ERP's own endpoints are unauthenticated (security)

This is the one that matters. Audited 2026-08-22 by reading the source:

| Endpoint | Auth checks | Writes | Note |
|---|---|---|---|
| `api.php` | **0** | 10 | `$key` is allow-listed before path use |
| `upload.php` | **0** | 3 | `move_uploaded_file` |
| `cleanup.php` | **0** | 3 | |
| `google_auth.php` | 0 | 0 | |
| `google_callback.php` | 10 | 6 | |
| `google_fetch_result.php` | 4 | 1 | |

`upload.php` derives the stored file's extension from the **client-supplied
filename**:

```php
$ext  = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
$dest = $dir . $docId . '_' . time() . '.' . $ext;
move_uploaded_file($file['tmp_name'], $dest);
```

The only gate is a whitelist on `$file['type']`, which is the client-supplied
`Content-Type` header and is trivially spoofed. Uploading `x.php` while
declaring `application/pdf` therefore writes a `.php` file into the document
directory. **If that directory sits inside a PHP-executing docroot, this is
unauthenticated remote code execution.**

`api.php` is better — `$key` is validated against `ALLOWED_KEYS` or the
`mp_rdtpl_` / `mp_rdent_` prefixes — but the prefix rule still admits
`mp_rdtpl_../../…`, giving traversal for `.json` writes.

None of this is exploitable today **only because nothing serves the
application.** Publishing it with PHP enabled would create the exposure. That
is why §3 disables PHP rather than wiring up `php-fpm`, even though PHP 8.5
and a working FPM socket are present on this host.

**Do not enable PHP for this vhost until §5 is done.**

---

## 3. The vhost — static preservation mode

Serves the ERP read-only. PHP is not executed; the write endpoints are not
reachable. The application's browser-side features that depend on
`localStorage` continue to work, because those never involved the server.

`/etc/nginx/sites-available/erp.mythosprod.xyz`:

```nginx
# erp.mythosprod.xyz — legacy Mythos Prod ERP, preserved read-only.
# Runbook: sites/erp.mythosprod.xyz/DEPLOYMENT.md
# PHP is deliberately NOT executed here: the application's write endpoints
# carry no authentication and upload.php takes its extension from the
# client-supplied filename. Until that is fixed, this route is static only.
server {
    listen 80;
    listen [::]:80;
    server_name erp.mythosprod.xyz;

    root /var/www/erp.mythosprod.xyz;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    # PHP is served as inert text, never executed. This is belt-and-braces:
    # there is no fastcgi_pass in this file at all, and this block makes an
    # accidental future include harmless rather than fatal.
    location ~ \.php$ {
        return 404;
    }

    # The write endpoints are refused by name as well, so a rename or a new
    # handler cannot quietly expose them.
    location ~ ^/(api|upload|cleanup|google_auth|google_callback|google_fetch_result)\.php$ {
        return 404;
    }

    location / {
        try_files $uri $uri/ =404;
    }

    location ~ /\. {
        deny all;
    }
}
```

Content is copied, not symlinked, so the served tree cannot be altered by a
checkout operation:

```bash
sudo mkdir -p /var/www/erp.mythosprod.xyz
sudo cp -a <checkout>/{index.html,js,css,assets,data,manifest.json} /var/www/erp.mythosprod.xyz/
sudo chown -R www-data:www-data /var/www/erp.mythosprod.xyz
sudo ln -sfn /etc/nginx/sites-available/erp.mythosprod.xyz /etc/nginx/sites-enabled/erp.mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d erp.mythosprod.xyz --non-interactive --agree-tos --redirect
```

**Do not copy the `.php` files.** They are preserved in Git; they have no
business in a docroot.

---

## 4. Monitoring

Once the route is live, add to `projects/status-center/monitor/probes.json`:

```json
{
  "id": "erp",
  "name": "erp.mythosprod.xyz (legacy ERP, preserved)",
  "type": "https",
  "url": "https://erp.mythosprod.xyz/",
  "expect_status": [200],
  "enabled": true,
  "note": "Static preservation mode — PHP is not executed on this route. A 200 here means the preserved application is being served, not that its write endpoints work; those are deliberately 404."
}
```

`tests/monitor-coverage-test.js` will then require it to be enabled or
explicitly documented, so the route cannot go live unmonitored.

---

## 5. Before the ERP may serve dynamically

Static mode is a preservation measure, not a fix. Restoring the write path
requires all of:

1. **Authentication** in front of every write endpoint. There is none today.
2. **An extension allow-list** in `upload.php` derived from server-side
   inspection, not from `$file['name']` or the client's `Content-Type`.
3. **`$cat` and `$docId` sanitisation** in `upload.php`, and tightening the
   `mp_rdtpl_` / `mp_rdent_` prefix rule in `api.php` so `..` cannot appear.
4. **No PHP execution inside any upload directory**, enforced in nginx.

Only then should `location ~ \.php$` be changed from `return 404` to a
`fastcgi_pass`.

---

## 6. Rollback

Static, no state, no database:

```bash
sudo rm /etc/nginx/sites-enabled/erp.mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
```

The certificate may remain; it is harmless unreferenced. `/var/www/erp.mythosprod.xyz`
is a copy — removing it loses nothing, because the application of record is in Git.

---

## 7. Isolation from the Hub

The Hub (`mythosprod.xyz`) and the ERP share no docroot, no vhost, no
certificate and no origin. The Hub's CSP is `default-src 'self'` and it
neither frames nor fetches the ERP; it links to it. When platform
authentication arrives it attaches at the Hub's access point, and the ERP
becomes a protected upstream behind it — which is also the point at which
§5 must already be satisfied.
