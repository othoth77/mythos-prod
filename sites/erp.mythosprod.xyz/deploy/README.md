# ERP API deployment (Phase 5)

Production runtime for `sites/erp.mythosprod.xyz/api` on the MYTHOS VPS.

| Item | Value |
|---|---|
| Unit | `~/deploy/.config/systemd/user/erp-api.service` (installed from `deploy/erp-api.user.service`) |
| User | `deploy` (user manager, linger enabled) |
| Bind | `127.0.0.1:8787` (loopback only) |
| Public URL | **`https://erp.mythosprod.xyz`** (live since 2026-09-07). nginx vhost `/etc/nginx/sites-available/erp.mythosprod.xyz` (host-level, root-owned; tracked copy since 2026-09-13: `deploy/nginx-erp.mythosprod.xyz.conf` — it adds the app CSP (server.js `APP_CSP`, byte-for-byte) on `location /` and HSTS `max-age=31536000` on every response; apply as root with `install -m 0644 sites/erp.mythosprod.xyz/deploy/nginx-erp.mythosprod.xyz.conf /etc/nginx/sites-available/erp.mythosprod.xyz && nginx -t && systemctl reload nginx`; rollback = reinstall the previous copy, or set HSTS `max-age=0` for one release if HSTS must be withdrawn) serves `sites/erp.mythosprod.xyz/app` as static docroot and reverse-proxies `location /api/` to `http://127.0.0.1:8787` with the request path unchanged. TLS reuses the existing Let's Encrypt certificate for this hostname. **This hostname previously served the legacy static-preservation PHP ERP** (`/var/www/erp.mythosprod.xyz`, loopback-only) — that vhost was replaced, not the app: the legacy docroot is untouched on disk, just no longer routed here. See `docs/AI_HANDOVER.md` (2026-09-07, "PUBLIC URL / NGINX 403 FINAL FIX") for the full diagnosis and decision record. |
| Database role | **`erp_app`** — `server.js` refuses any other role at start; `GET /api/v1/health` reports `{ok, db, role}` from a live `SELECT` |
| Env file | `/home/deploy/deployments/erp-api/.env` (0600 deploy): `ERP_DATABASE_URL` (erp_app URL), `ERP_API_PORT=8787` |
| Logs | `journalctl --user -u erp-api` as deploy (or `journalctl _SYSTEMD_USER_UNIT=erp-api.service`) |
| Limits | `MemoryMax=384M`, `Restart=on-failure`, configuration errors (exit 2/3) do not restart-loop |

Health semantics: `200 {"ok":true,"db":"ready","role":"erp_app"}` = can serve;
`503` = database unreachable or wrong role. Liveness alone is never reported as ok.

Never place `erp_owner` in the env file: ownership bypasses RLS.
