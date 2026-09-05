# ERP API deployment (Phase 5)

Production runtime for `sites/erp.mythosprod.xyz/api` on the MYTHOS VPS.

| Item | Value |
|---|---|
| Unit | `~/deploy/.config/systemd/user/erp-api.service` (installed from `deploy/erp-api.user.service`) |
| User | `deploy` (user manager, linger enabled) |
| Bind | `127.0.0.1:8787` (loopback only; nginx is Phase 15) |
| Database role | **`erp_app`** — `server.js` refuses any other role at start; `GET /api/v1/health` reports `{ok, db, role}` from a live `SELECT` |
| Env file | `/home/deploy/deployments/erp-api/.env` (0600 deploy): `ERP_DATABASE_URL` (erp_app URL), `ERP_API_PORT=8787` |
| Logs | `journalctl --user -u erp-api` as deploy (or `journalctl _SYSTEMD_USER_UNIT=erp-api.service`) |
| Limits | `MemoryMax=384M`, `Restart=on-failure`, configuration errors (exit 2/3) do not restart-loop |

Health semantics: `200 {"ok":true,"db":"ready","role":"erp_app"}` = can serve;
`503` = database unreachable or wrong role. Liveness alone is never reported as ok.

Never place `erp_owner` in the env file: ownership bypasses RLS.
