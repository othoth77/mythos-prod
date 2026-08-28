# Mythos ERP — secure backend (reference implementation)

**Status: BUILT + TESTED in-repo, NOT DEPLOYED, NOT EXPOSED.** This is the
backend-evolution reference the ERP needs before `erp.mythosprod.xyz` can serve
dynamically. It is gated shut and must stay so until the verification below
passes on the host and the owner approves DNS/TLS (per
`sites/erp.mythosprod.xyz/DEPLOYMENT.md` §5 and `docs/ERP_SECURITY_STATUS.md`).

---

## 1. Architecture decision (SEARCH FIRST → REUSE → BUILD)

**Chosen: secure PHP 8.4 + SQLite (WAL), reusing the in-repo OTHMODE session
pattern and PHP-native argon2id. No Composer dependencies.**

Why, evidenced:

| Dimension | Decision | Rationale |
|---|---|---|
| Runtime | **PHP-FPM 8.4** | The host already runs nginx + PHP-FPM (per `DEPLOYMENT.md`). No new service/runtime to operate. |
| Compatibility | **Drop-in for `api.php`'s contract** | The frontend already speaks `GET ?key=` / `POST {key,data}`. Preserving that shape means the UI + business logic transition without a rewrite (§15, no big-bang). |
| Auth | **PHP `password_hash(PASSWORD_ARGON2ID)` + server sessions** | argon2id is the OWASP-recommended hash and is native in PHP 8.4 — no library, no supply chain. Sessions reuse the OTHMODE model (hashed session id, `__Host-` `HttpOnly; Secure; SameSite=Strict` cookie). |
| RBAC | **3 roles → closed action set** | §5: no over-built engine. Evaluated server-side only. |
| DB (reference) | **SQLite + WAL** | Zero external service (fully testable in-repo now), ACID, WAL = many readers + one writer (adequate for a small team). Schema is portable. |
| DB (production option) | **MariaDB** | Already on the host; same PDO layer + portable schema — switch via `ERP_DB_DRIVER=mysql`. |
| Build step | **None** | Matches the repo's no-build ethos; smaller attack surface. |

**Alternatives evaluated and rejected** (§3): **FastAPI / Django** (new Python
runtime + ASGI/WSGI process management — new infra to operate); **Node/Express**
(new runtime + process manager); **Laravel / Symfony** (heavy frameworks +
Composer + more surface/maintenance — a re-platform, not the smallest secure
evolution). A full OSS ERP (Odoo/ERPNext/Dolibarr) was already rejected in
`docs/MYTHOS_ERP_CAPABILITY_AUDIT.md` as a re-platform that discards the working
domain modules.

**Reused:** the OTHMODE session design (`projects/command-center/reference/othmode/sessions.js`);
PHP stdlib crypto (`password_hash`/`password_verify`/`hash_equals`/`random_bytes`);
`finfo` for magic-byte MIME; the legacy `ALLOWED_KEYS` list (hardened).
**Built (only what was missing):** the auth/RBAC/audit/collection/upload PHP
layer and its tests. **Sources:** OWASP Session Management, Password Storage,
CSRF Prevention, and File Upload cheat sheets (see `docs/MYTHOS_ERP_CAPABILITY_AUDIT.md`
and the PR description for links).

---

## 2. What it provides

- **Authentication** — argon2id passwords; server sessions stored as sha-256
  hashes; `__Host-` `HttpOnly; Secure; SameSite=Strict` cookie; login
  regenerates the session id (fixation defence); constant-time verify against a
  dummy hash (anti-enumeration); login throttling; logout invalidates the session.
- **RBAC** — `viewer` (read) / `editor` (read+write+upload) / `admin` (+admin),
  enforced server-side on every request.
- **Secure collection API** — `GET /api/collections?key=` / `?action=meta` /
  `POST /api/collections` with auth, authorization, input validation, a strict
  key character class (closes the legacy `..` traversal), transactions, and
  optimistic concurrency (`baseVersion` → `409`).
- **Secure uploads** — server-side magic-byte MIME (finfo) against a closed
  allow-list, server-generated random filename + extension, size cap, stored
  **outside** the web root; nginx disables PHP execution there. Fixes the legacy
  `upload.php` RCE.
- **Append-only audit** — login/logout/write/upload/import recorded with actor,
  action, resource, timestamp, ip; no API path mutates audit rows.
- **CSRF** — session-bound token required on cookie-authenticated writes, plus a
  same-origin check when an origin allow-list is configured.
- **Security headers + closed CORS** (never `*`).

## 3. Layout

```
schema.sql            portable DDL (users/roles/sessions/collections/documents/audit/login_attempts)
src/bootstrap.php     env config, PDO factory, security headers, JSON helpers
src/db.php            idempotent migrate()
src/auth.php          argon2id, sessions, cookies, CSRF, throttle
src/rbac.php          roles → actions, require_auth / require_permission
src/audit.php         append-only audit()
src/api.php           collections API + strict key validation
src/uploads.php       secure upload
public/index.php      the ONLY web-served file (front controller)
cli/migrate.php       apply schema
cli/create-user.php   create/update a user + role (password from env/stdin)
cli/import-localstorage.php   migrate a localStorage/backup export into the DB
tests/security-test.sh   integration §17 matrix (php -S + curl) — 24 checks
tests/unit-test.php      fast pure-logic checks — 13 checks
deploy/nginx-erp-backend.conf   gated vhost
deploy/.env.example      environment template (no secrets)
```

## 4. Run the tests (in this repo)

```bash
cd projects/erp-backend
php tests/unit-test.php            # 13/0  — pure logic (no server)
bash tests/security-test.sh       # 24/0  — §17 security matrix (php -S + curl)
bash tests/migration-test.sh      # 11/0  — §7 localStorage→DB migration
# frontend↔backend end-to-end (needs Playwright + chromium):
PLAYWRIGHT_PATH=<path> bash tests/e2e/run-e2e.sh   # 19/0
```

## 5. Security verification (§17) — all covered by tests/security-test.sh

unauthenticated API denied · authenticated API works · unauthorized role denied ·
authorization enforced server-side · upload magic-byte attack rejected · path
traversal rejected · invalid input rejected · sessions expire (TTL) · logout
invalidates · audit rows created · DB transactions · session id stored as hash
only · CORS restricted · security headers set · login rate-limited. **No secret
is committed** (passwords come from env/stdin; the DB and uploads live off-repo).

## 6. Frontend integration — `js/core/secure-client.js` (built, DORMANT)

The integration layer exists and is **verified end-to-end**, but is **inert by
default** so the live app (localStorage + legacy sync) is byte-for-byte
unchanged until the backend is deployed. `window.MythosSecure` provides
`login/logout/me/getCollection/putCollection/upload` (credentials included,
CSRF header on writes, typed errors) and an `applyRbac()` UX helper (server
stays authoritative). It activates only when enabled:

```js
localStorage.setItem('mythos_secure_backend', '1');
localStorage.setItem('mythos_secure_base', 'https://<backend-origin>');
```

`tests/e2e/run-e2e.sh` drives this real client against the real backend in a
headless browser through the full scenario (§19): 3-role login, read/create/
update, upload, RBAC UX enable/disable, server-authoritative 403 for a viewer
write, logout invalidation, and session + data persistence across reload —
**19/0, zero uncaught JS errors**.

The remaining transition (routing the app's `STORE`/`sync` reads/writes through
`MythosSecure` once the flag is on, and a login screen replacing the
client-side `js/auth.js` gate) is wired module-by-module during the deployment
stage — kept off the live app until then.

## 7. Deployment (§18) — owner + host, only after §5 passes on the host

1. Owner approves and creates DNS `erp.mythosprod.xyz → 51.68.226.211`.
2. `git pull`; place `public/` under `/var/www/erp-backend/`, keep `src/ cli/`
   off the web root; create `/var/lib/erp-backend/{uploads}` and the DB path.
3. `php cli/migrate.php`; `php cli/create-user.php <admin> admin` (password via
   `ERP_NEW_PASSWORD`); optionally `php cli/import-localstorage.php <export>`.
4. Install `deploy/nginx-erp-backend.conf`, inject env (no secrets in git),
   `nginx -t`, reload, `certbot`.
5. Re-run the §17 checks against the host; add the `erp` monitor probe.
6. Only then wire the frontend (step 6) and retire the static-preservation lock.

## 8. Rollback

Static, additive: remove the vhost + reload nginx. The DB and uploads are
off-repo; the frontend of record stays in Git.
