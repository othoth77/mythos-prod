# MYTHOS WP V2 — Deployment

See also `ENVIRONMENT.md` (variables), `OPERATIONS.md` (day-2), `TROUBLESHOOTING.md`, `SECURITY.md`.

## 1. Where it runs

| Item | Value |
|---|---|
| Host | the MYTHOS VPS (the same host as Evolution, the Kitchen, n8n, the database) |
| Unit | `mythos-wp.service` in the **deploy user manager** (`~deploy/.config/systemd/user/mythos-wp.service`, linger enabled), source `deploy/mythos-wp.user.service` |
| Drop-in | `mythos-wp.service.d/oom.conf` → `OOMScoreAdjust=0` (production parity with other deploy units) |
| Checkout | `/home/deploy/worktrees/mythos-wp-main/projects/mythos-wp` (`WorkingDirectory` and `ExecStart` of the unit) |
| Bind | `127.0.0.1:8170` — the process refuses any non-loopback bind |
| Public surface | nginx vhost `wp.mythosprod.xyz` (`deploy/nginx-wp.mythosprod.xyz.conf`, TLS block written by certbot) |
| Env | `/home/deploy/deployments/mythos-wp/.env` (0600, deploy), plus 0600 files in the same directory: `users.json`, `webhook.token` |
| Memory | `MemoryMax=256M`, `MemoryHigh=200M` (the panel idles near 90 MiB) |
| Database | `mythos_wp`, role `mythos_wp_owner`, inside the `idauto-postgres` container (PostgreSQL 15). There is no host `psql`: use `docker exec idauto-postgres psql|pg_dump …` |
| Backups | `mythos_wp` is **not** in the scheduled multi-DB backup; the rollout script takes a pre-migration dump to `/var/backups/mythos-db/` |

Hardening in the unit: `NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`, `ProtectHome=read-only`, `ReadWritePaths=` (empty: the process writes only to PostgreSQL), syscall filter `@system-service`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`.

## 2. Worktree model

The unit executes from a **detached checkout** in `/home/deploy/worktrees/mythos-wp-main`, not from the developer worktree. Development of V2 happens in `/home/deploy/worktrees/wp-v2` (branch `mythos/wp-v2-control-center-20260917`). A rollout = move the production checkout to a git ref, migrate, import users, restart, smoke-test. The application "build" is the tree itself (no bundler); `node_modules` holds only `pg`.

Provisioning (once per host, root): `deploy/provision-db.sh` creates the role, `mythos_wp` and `mythos_wp_test`, applies `database/schema.sql` and writes the initial 0600 env. Already done on the VPS (2026-09-05).

## 3. Rollout — `deploy/v2-rollout.sh`

Run as **root** on the VPS. Idempotent steps; every step prints names only, never a value.

```bash
bash /home/deploy/worktrees/wp-v2/projects/mythos-wp/deploy/v2-rollout.sh            # ref = origin/main
bash …/v2-rollout.sh --ref <sha-or-branch>                                           # explicit ref
bash …/v2-rollout.sh --skip-backup                                                   # only when a dump was just taken
```

| Step | What happens | Verify |
|---|---|---|
| 1 backup | `docker exec idauto-postgres pg_dump -U idauto -Fc mythos_wp` → `/var/backups/mythos-db/mythos_wp-v2-pre-<stamp>.dump` + `.sha256` | file listed with size |
| 2 checkout | `git fetch --prune` then `git checkout --detach <ref>` in `mythos-wp-main` (as deploy); copies `node_modules` from the wp-v2 worktree if `pg` is missing | previous sha printed — keep it for rollback |
| 3 migrate | `bin/mythos-wp migrate up` with the production env (applies `0006_shared_account_routing`, `0007_control_center` — additive), then `migrate status` | `pending: []` |
| 4 users | `bin/mythos-wp users import` — the 0600 users file becomes `wp_users` rows (existing names untouched; failure is non-fatal) | `{"imported":n,"skipped":m}` |
| 5 restart | `systemctl --user restart mythos-wp.service` (as deploy) and wait ≤ 30 s for `GET /healthz` | `is-active` = active |
| 6 smoke | loopback `GET /login` → 200, `GET /` unauthenticated → 302 | then sign in at https://wp.mythosprod.xyz/ and open **Health** |

After the rollout the server seeds, at boot: the default integrations (`integrations.ensureDefaults`), the default agent (`mythos-assistant`, engine-173, suggest, bound to nothing) and the three default automations (`automations.ensureDefaults`). Seeding is idempotent and key-wise.

Post-rollout owner checks: **WhatsApp → Numbers → Sync** (discovers the Evolution instances; marks the reserved account as personal), **Health → Run now**, **Integrations** (credentials_state of `evolution`, `kitchen-mythos-auto`, `n8n`).

## 4. Rollback

Schema is additive and the V1 code ignores the new tables, so a code rollback needs no down-migration:

```bash
# as deploy
git -C /home/deploy/worktrees/mythos-wp-main checkout --detach <previous sha>     # printed by step 2
systemctl --user restart mythos-wp.service
curl -fsS http://127.0.0.1:8170/healthz
```

Only if the owner wants the V2 tables gone (data in them is lost — take a dump first):

```bash
node bin/mythos-wp migrate down 0007_control_center
node bin/mythos-wp migrate down 0006_shared_account_routing
```

Restore from a dump (destructive; stop the unit first):

```bash
systemctl --user -M deploy@ stop mythos-wp.service
docker exec -i idauto-postgres pg_restore -U idauto -d mythos_wp --clean --if-exists < /var/backups/mythos-db/mythos_wp-v2-pre-<stamp>.dump
systemctl --user -M deploy@ start mythos-wp.service
```

Feature-level rollback without redeploying: switch `inbound_enabled` / `outbound_enabled` off on an inbox, set an agent's `mode` to `off` or its status to `paused`, disable an automation, set `MYTHOS_WP_HEALTH_INTERVAL_MS=0`, remove `MYTHOS_WP_RECEIVER_ENABLED` and restart (the webhook route then answers 404).

## 5. Backup

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker exec idauto-postgres pg_dump -U idauto -Fc mythos_wp > /var/backups/mythos-db/mythos_wp-$STAMP.dump
sha256sum /var/backups/mythos-db/mythos_wp-$STAMP.dump > /var/backups/mythos-db/mythos_wp-$STAMP.dump.sha256
```

The database holds customer conversations: treat dumps as personal data (root-only directory, copy to R2 under the archive prefix the host already uses, never into a git tree). The 0600 files in `/home/deploy/deployments/mythos-wp/` (`.env`, `users.json`, `webhook.token`) are not in any dump and must be backed up separately by the owner.

## 6. nginx

`deploy/nginx-wp.mythosprod.xyz.conf` → `/etc/nginx/sites-available/wp.mythosprod.xyz`, symlinked into `sites-enabled`, `nginx -t && systemctl reload nginx`, certificate by `certbot --nginx -d wp.mythosprod.xyz` (certbot rewrites the file; do not hand-write the TLS block). `client_max_body_size 512k` (the API caps JSON at 256 KiB; the receiver caps at `MYTHOS_WP_RECEIVER_MAX_BODY`). `robots.txt` disallows everything. Application security headers come from `server.js`; nginx repeats the transport ones.

The receiver (`/hooks/*`) is reachable through nginx as well as on loopback; Evolution posts to the loopback URL, and the token / HMAC checks apply on both paths.

## 7. Migrations on their own

```bash
set -a; . /home/deploy/deployments/mythos-wp/.env; set +a
node bin/mythos-wp migrate status
node bin/mythos-wp migrate up
node bin/mythos-wp migrate down <version>        # ONE version
node tests/mythos-wp-comms-schema-test.js       # apply → fixtures → rollback → re-apply on mythos_wp_test
```

Each file runs in one transaction; a failing statement leaves the database as it was. Versions are the file names in `database/migrations/`; nothing is built from input.
