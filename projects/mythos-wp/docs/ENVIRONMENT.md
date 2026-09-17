# MYTHOS WP V2.1 — Environment

All variables live in `/home/deploy/deployments/mythos-wp/.env` (0600, owner `deploy`), loaded by the unit's `EnvironmentFile`. Nothing is read from the repository. A variable marked **secret** must never appear in a log, an audit row, an API response or a commit; a variable marked **file** names a 0600 file whose *content* is the secret (the panel refuses a file with any group/other permission bit).

`node bin/mythos-wp check-env` reports which variables and files are present — names only.

## 1. Server

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_WP_PORT` | listening port | `8170` | no |
| `MYTHOS_WP_BIND` | bind address; anything but `127.*`, `::1`, `localhost` is refused at start | `127.0.0.1` | no |
| `MYTHOS_WP_SESSION_TTL_MS` | absolute session lifetime (min 1000) | `28800000` (8 h) | no |
| `MYTHOS_WP_INSECURE_COOKIE` | `1` drops the `Secure` cookie flag — **tests over plain loopback only**, never in production | unset | no |

## 2. Database (required — the server refuses to start without them)

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_WP_DB_HOST` | PostgreSQL host (the `idauto-postgres` container is published on loopback) | — | no |
| `MYTHOS_WP_DB_PORT` | port | — | no |
| `MYTHOS_WP_DB_USER` | role (`mythos_wp_owner`) | — | no |
| `MYTHOS_WP_DB_PASSWORD` | role password | — | **secret** |
| `MYTHOS_WP_DB_NAME` | database (`mythos_wp`; tests use `mythos_wp_test`) | — | no |

## 3. Users and sessions

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_WP_USERS_FILE` | 0600 JSON `{ "users": [ { username, role, scrypt } ] }` — bootstrap / break-glass source; imported into `wp_users` by `users import`; still answers a login for a name absent from the table | unset (then only `wp_users` can log in) | **file** (hashes, not passwords) |
| `MYTHOS_WP_NEW_PASSWORD` | CLI only: password for `set-password` / `users add` instead of stdin | unset | **secret** (shell env, never persisted) |

## 4. WhatsApp — receiver and Evolution API (production transport)

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_WP_RECEIVER_ENABLED` | `1` mounts `/hooks/<provider>`; absent = the route answers 404 | unset | no |
| `MYTHOS_WP_WEBHOOK_TOKEN_FILE` | 0600 file with the shared webhook token (≥ 16 chars) Evolution presents as `?token=` or header `x-mythos-webhook-token` | unset (receiver answers 503 `receiver_not_configured`) | **file** |
| `MYTHOS_WP_RECEIVER_MAX_BODY` | max webhook body in bytes, clamped to 16 KiB … 4 MiB | `524288` | no |
| `MYTHOS_WP_RECEIVER_URL` | the URL the panel expects on every Evolution instance webhook (used by **WhatsApp → Sync all** to compute `webhook_state ok|mismatch`, i.e. the *Receiving* / *Not receiving* badge) | `http://127.0.0.1:<MYTHOS_WP_PORT>` + `/hooks/evolution` | no |
| `MYTHOS_WP_EVOLUTION_API_KEY_FILE` | 0600 file with the Evolution API key (≥ 8 chars); read at call time for sends, health, discovery | unset (sends and probes answer `CONFIG: credential missing`) | **file** |
| `MYTHOS_WP_EVOLUTION_BASE_URL` | Evolution API base | `http://127.0.0.1:8080` | no |
| `MYTHOS_WP_OUTBOUND_CAP_PER_HOUR` | per-conversation outbound cap (429 above) | `30` | no |
| `MYTHOS_WP_ACK_THRESHOLD_MIN` | `comms reconcile`: minutes before an unacknowledged outbound row gets its single `delivery.alarm` | `15` | no |
| `MYTHOS_WP_HEARTBEAT_STALE_MIN` | `comms heartbeat`: quiet window before `stale` | `10` | no |

## 5. WhatsApp Cloud API (Meta, official) — implemented, NOT configured in production

None of these files exist on the host today; `meta_cloud.describe()` reports `configured:false` with the missing names, the `meta-cloud-api` integration row stays `disabled`, and no runtime path uses the provider until an owner creates them.

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_WP_META_ACCESS_TOKEN_FILE` | 0600 file: system-user / permanent access token (≥ 16 chars) | unset | **file** |
| `MYTHOS_WP_META_APP_SECRET_FILE` | 0600 file: app secret for `X-Hub-Signature-256` HMAC verification | unset | **file** |
| `MYTHOS_WP_META_VERIFY_TOKEN_FILE` | 0600 file: webhook verify token answered on `GET /hooks/meta_cloud?hub.mode=subscribe` | unset | **file** |
| `MYTHOS_WP_META_GRAPH_BASE` | Graph API base (plain http accepted for loopback tests only) | `https://graph.facebook.com/v21.0` | no |

## 6. Platform workers

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_WP_HEALTH_INTERVAL_MS` | health center scheduler interval (min 10 000); `0` = never scheduled (checks still run on demand) | `300000` | no |
| `MYTHOS_WP_AUTOMATIONS_SWEEP_MS` | `conversation.inactive` sweep interval; `0` = off | `600000` | no |
| `MYTHOS_WP_COMMS_CONFIG` | path of the real `projects/automotive/comms` (#173) configuration file (outside git); absent = Auto-Reply status shows OFF / not configured and the simulator derives a minimal in-memory config | unset | no (the file may reference secrets by path) |

## 7. Free-LLM pool (read by `ai/llm.js` through `projects/mythos-ai-executor/free-llm`)

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `MYTHOS_FREE_LLM_KEY_DIR` | key directory of the free-LLM pool (`secrets.loadKey` reads a provider key at call time; the value is never returned to WP). Groq is the active provider in production | pool default | **directory of secrets** |

WP never holds an LLM key. `GET /api/ai/status` reports presence only (`credential_present`).

## 8. Legacy (V1 catalogue) — unused since V2.1, safe to remove from the env file

| Variable | Purpose | State |
|---|---|---|
| `MYTHOS_WP_CATALOG_<PROJECT>` (e.g. `MYTHOS_WP_CATALOG_SSANGYONG_AUTOS`) | libpq URL of a project's V1 catalogue database, named by the hidden legacy column `wp_projects.catalog_dsn_env` | **secret** (URL with password). **Unused since V2.1**: the catalogue pool code (`db.catalog()`) is gone, no route, resource, probe or agent reads the variable; `check-env` only names it when it is still set. Still present in the production env today — **safe to remove from `.env`** (then restart). Keep a copy with the other rollback material only if a V1 rollback is still contemplated |

## 9. Tests and tooling only

| Variable | Purpose |
|---|---|
| `MYTHOS_WP_TEST_DB_URL` | libpq URL of `mythos_wp_test` for every `tests/mythos-wp-*` suite (**secret**, shell only) |
| `MYTHOS_WP_TEST_CATALOG_URL` | V1 catalogue fixture URL (legacy suites only; nothing in V2.1 reads it) |
| `MYTHOS_WP_ALLOW_SKIP` | `1` lets `tools/check.sh` exit 0 when the database section is skipped |
| `MYTHOS_WP_PG_CONTAINER` | container name for `deploy/provision-db.sh` (default `idauto-postgres`) |

## 10. Production env today (names only, verified 2026-09-17)

`MYTHOS_WP_PORT`, `MYTHOS_WP_BIND`, `MYTHOS_WP_DB_HOST`, `MYTHOS_WP_DB_PORT`, `MYTHOS_WP_DB_USER`, `MYTHOS_WP_DB_PASSWORD`, `MYTHOS_WP_DB_NAME`, `MYTHOS_WP_USERS_FILE`, `MYTHOS_WP_CATALOG_SSANGYONG_AUTOS` (legacy, unused — §8), `MYTHOS_WP_WEBHOOK_TOKEN_FILE`, `MYTHOS_WP_RECEIVER_ENABLED`, `MYTHOS_WP_EVOLUTION_API_KEY_FILE`. Files in the same directory: `users.json`, `webhook.token` (both 0600). No `MYTHOS_WP_META_*` variable or file exists.

## 11. Rules

- Reference a credential only by the **name** of its variable (`wp_integrations.credential_env`; the legacy `wp_projects.catalog_dsn_env` followed the same rule); the panel validates the shape `^[A-Z][A-Z0-9_]{2,62}$` and refuses a value that looks like a credential in any JSON config.
- Changing the env requires `systemctl --user restart mythos-wp.service` (as deploy); a restart signs every user out (sessions are in memory).
- Never print the env (`cat .env`) in a shared terminal or a ticket; use `check-env`.
