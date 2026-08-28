# Mythos ERP — production deployment & cutover runbook

**Status: HOST EXECUTION PACKAGE — NOT YET DEPLOYED.** Every artifact and
command below is prepared and, where possible, tested in-repo. The steps marked
**[HOST]** require SSH/host access + owner approval and have **not** been run —
they cannot be executed from the build sandbox (no host access; the egress proxy
blocks the origin). Do **not** claim the site is live until §L (external
verification) passes.

Safety invariants (§0, §1, §20, §24): the current static-preservation route
stays up until §H passes; the legacy `api.php`/`upload.php`/`cleanup.php` stay
disabled; DNS is an owner action; nothing is destructive; rollback (§K) is ready
before go-live.

Paths used below (adjust to the host): web root `/var/www/erp-backend/public`;
private data `/var/lib/erp-backend/{erp.db,uploads}`; repo checkout `<repo>`.

---

## A. [HOST] Prerequisite audit (§3) — verify, do not assume
```bash
cd <repo>/projects/erp-backend
bash deploy/preflight-check.sh          # PHP≥8.1, pdo_sqlite, fileinfo, argon2id,
                                        # php-fpm, nginx, certbot, systemd, disk, curl
```
Resolve every FAIL before continuing. (Verified in-repo: the script runs and
reports correctly; here it FAILs only on nginx/certbot, which the host provides.)

## B. [HOST] Place files (§2) — public/ is the ONLY web-served dir
```bash
sudo mkdir -p /var/www/erp-backend /var/lib/erp-backend/uploads
sudo cp -a <repo>/projects/erp-backend/public /var/www/erp-backend/
sudo cp -a <repo>/projects/erp-backend/src <repo>/projects/erp-backend/schema.sql /var/lib/erp-backend/app/  # OFF the web root
# src/ is referenced from public/index.php via ../src — keep them adjacent OR set an include path.
sudo chown -R www-data:www-data /var/www/erp-backend /var/lib/erp-backend
sudo chmod 750 /var/lib/erp-backend /var/lib/erp-backend/uploads
```
> Simplest layout: copy the whole `projects/erp-backend/` tree to
> `/var/lib/erp-backend/app/` and point nginx root at `.../app/public`. Never
> put `src/`, `cli/`, `tests/`, `schema.sql`, the DB or uploads under a web root.

## C. [HOST] Environment (§2, no secrets in Git)
Create `/etc/erp-backend.env` (root-owned, 0600) from `deploy/.env.example`:
```
ERP_DB_DRIVER=sqlite
ERP_DB_PATH=/var/lib/erp-backend/erp.db
ERP_UPLOAD_DIR=/var/lib/erp-backend/uploads
ERP_COOKIE_SECURE=1
ERP_SESSION_TTL_DAYS=7
ERP_ALLOWED_ORIGIN=https://erp.mythosprod.xyz
```
Inject via the php-fpm pool (`env[...] = ...`) or an `EnvironmentFile=` on the
FPM service. (MariaDB option: set `ERP_DB_DRIVER=mysql` + `ERP_DB_DSN/USER/PASS`.)

## D. [HOST] Database init + schema version (§4, §16)
```bash
sudo -u www-data ERP_DB_DRIVER=sqlite ERP_DB_PATH=/var/lib/erp-backend/erp.db \
  php <repo>/projects/erp-backend/cli/migrate.php          # -> "migrated"
# verify schema version:
sqlite3 /var/lib/erp-backend/erp.db 'SELECT version FROM schema_migrations;'  # 001-initial
```
Never hand-create tables; never delete existing data.

## E. [HOST] Admin user (§6, no plaintext in Git)
```bash
sudo -u www-data ERP_DB_PATH=/var/lib/erp-backend/erp.db \
  ERP_NEW_PASSWORD='<choose-a-strong-password>' \
  php <repo>/projects/erp-backend/cli/create-user.php <admin-username> admin "Administrator"
unset ERP_NEW_PASSWORD    # do not leave it in the shell history/env
```
Create `editor`/`viewer` users the same way as needed.

## F. [HOST] Migrate localStorage data (§5, §7, §19) — reuse the tool
1. In the running ERP browser, export the data (the app's backup/export produces
   the `{ "<collection>": <data>, … }` JSON the tool consumes).
2. **Back up first**, then import, then verify:
```bash
sudo -u www-data ... php cli/backup.php /var/lib/erp-backend/backups    # snapshot BEFORE import
sudo -u www-data ... php cli/import-localstorage.php <export.json> <admin-username>
# verify counts / representative records (invoices, clients, suppliers, expenses):
sqlite3 /var/lib/erp-backend/erp.db \
  "SELECT key, json_array_length(data) FROM collections ORDER BY key;"
```
Compare against the source counts. **Do not delete the browser localStorage** —
keep it for rollback until acceptance is complete (§5, §8).

## G. [HOST] nginx vhost (§10, §12) — no PHP exec in uploads, no secret exposure
Install `deploy/nginx-erp-backend.conf` (already isolates `public/` as the only
root, routes only `/index.php` to FPM, `return 404` for any other `.php`, denies
dotfiles). Adjust `fastcgi_pass` to the host's FPM socket. Keep on port 80 until
TLS (§I). **Do not** `nginx -t && reload` into public exposure yet — first run the
security gate (§H) against it bound to localhost or an internal port.

## H. [HOST] SECURITY GATE (§9, §18) — MUST pass before any public access
With the backend reachable at an internal URL (e.g. `http://127.0.0.1:8080`),
and admin/viewer/editor users seeded:
```bash
ERP_ADMIN_PASS=… ERP_VIEWER_PASS=… ERP_EDITOR_PASS=… \
  bash deploy/verify-deployed.sh http://127.0.0.1:8080
```
Asserts: unauth→401, bad/unknown creds→401 (uniform), HttpOnly cookie, CSRF-less
write→403, traversal→400, php-as-pdf upload→415, real upload ok, viewer write→403,
editor write→200, logout→401. **If any FAIL: STOP. Do not open public access.**
(Verified in-repo against a deployed instance: 16/0.)

## I. [HOST + OWNER] DNS + TLS (§13, §14) — owner action
1. **Owner** creates DNS: `erp.mythosprod.xyz  A  51.68.226.211`.
2. `sudo ln -sfn /etc/nginx/sites-available/erp-backend.mythosprod.xyz /etc/nginx/sites-enabled/`
   then `sudo nginx -t && sudo systemctl reload nginx`.
3. `sudo certbot --nginx -d erp.mythosprod.xyz --non-interactive --agree-tos --redirect`.
4. Confirm HTTPS, HTTP→HTTPS redirect, `Secure` cookies, no mixed content.

## J. [HOST] Monitoring (§15) — reuse, do not duplicate
Add the `erp` probe already specified in `sites/erp.mythosprod.xyz/DEPLOYMENT.md`
§4 to `projects/status-center/monitor/probes.json` (`expect_status: [200]`,
enabled). `tests/monitor-coverage-test.js` then enforces it. Do **not** add the
probe before the route actually serves 200, or the monitor will report a false
outage.

## K. [HOST] Backup wiring + restore test (§16, §17) — reuse ops/backup
`cli/backup.php` is the DB-specific capture primitive; wire it as an input to the
existing `ops/backup/` off-host pipeline (same pattern as the PostgreSQL capture
in `ops/backup/mythos-backup-capture.sh`) — **not** a new off-host system.
Perform a **real restore test** before declaring ready:
```bash
SET=$(sudo -u www-data ... php cli/backup.php /var/lib/erp-backend/backups)
# on a scratch copy, prove restore integrity (fail-closed on tamper):
ERP_DB_PATH=/tmp/restore-check.db ERP_UPLOAD_DIR=/tmp/restore-uploads \
  php cli/restore.php "$SET"      # "restored … (checksums verified)"
```
(Verified in-repo: `tests/backup-test.sh` 8/0, disaster→restore byte-for-byte.)

## L. [HOST] Rollback readiness (§17) — before go-live
`deploy/rollback.sh [backup-set]` disables the new vhost, re-enables the static
one, reloads nginx, and optionally restores DB+uploads from a verified set.
Confirm it is present and the last backup set restores cleanly (§K) **before**
opening public access.

## M. [HOST] Production E2E + data integrity (§18, §19)
After §I, run the 20-step browser scenario against `https://erp.mythosprod.xyz`
with clearly-labelled TEST data; remove only test records afterward. Compare
invoice totals / VAT / timbre / retention / clients / suppliers / expenses /
contracts / mission-orders / documents against pre-migration values — **no silent
financial changes**. (The same scenario is verified in-repo end-to-end:
`tests/e2e/run-e2e.sh` 19/0.)

## N. Frontend cutover (§7, §8, §21) — only after H–M pass
1. Enable per browser: `localStorage.setItem('mythos_secure_backend','1');`
   `localStorage.setItem('mythos_secure_base','https://erp.mythosprod.xyz');`
2. Verify login→dashboard→read→create→update→delete→upload→audit→logout.
3. Route the app's `STORE`/`sync` reads/writes through `MythosSecure`
   module-by-module (server becomes authoritative; keep localStorage only for UI
   prefs/temp state/migration fallback).
4. Once stable, remove the client-side `js/auth.js` gate as a *security* boundary
   (it stays only as UX if at all) — the backend is authoritative (§21).

## O. Post-core: server-side notifications (§22) — after stable
Move server-required scheduled tasks (reminders that must fire while no browser
is open) to a systemd timer calling a PHP job (`cli/run-jobs.php`, to be added in
that stage) — reuse systemd (already on the host), do not add a scheduler
dependency. Browser-side reminders keep working meanwhile.

---

## Host-only commands that remain (the ONLY things not done)
DNS A record (owner) · file placement (B) · env file (C) · migrate (D) · admin
user (E) · data import + verify (F) · nginx enable + FPM (G) · security gate (H)
· certbot/TLS (I) · monitor probe (J) · backup wiring + restore test (K) ·
rollback rehearsal (L) · production E2E (M) · flag cutover (N).

Everything else — the backend, the migration/backup/restore tools, the security
+ E2E + migration + backup test suites, the nginx/env artifacts, the preflight,
verify-deployed and rollback scripts — is **built and verified in-repo**. This
runbook is the exact, ordered host execution package; run it top to bottom.
