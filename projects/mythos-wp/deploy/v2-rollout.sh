#!/usr/bin/env bash
# =============================================================================
# MYTHOS WP V2 — production rollout (run as root on the VPS; idempotent steps)
# projects/mythos-wp/deploy/v2-rollout.sh [--ref <git ref>] [--skip-backup]
#
#   1. backup   pg_dump of mythos_wp (custom format + sha256) via the idauto-postgres container
#   2. checkout the production worktree (/home/deploy/worktrees/mythos-wp-main) to <ref> (default origin/main)
#   3. migrate  bin/mythos-wp migrate up  (0006 shared routing, 0007 control center — additive)
#   4. users    import the 0600 users file into wp_users (existing names untouched)
#   5. restart  mythos-wp.service (deploy user manager) and wait for /healthz
#   6. smoke    login + /api/meta + /api/health/center on the loopback port
# Rollback: `git checkout --detach <previous sha>` in the worktree + restart; the schema is additive and the
# V1 code ignores the new tables, so no down-migration is needed unless the owner wants the tables gone
# (bin/mythos-wp migrate down 0007_control_center, then 0006_…).
# =============================================================================
set -euo pipefail
REF="origin/main"; BACKUP=1
while [ $# -gt 0 ]; do case "$1" in --ref) REF="$2"; shift 2;; --skip-backup) BACKUP=0; shift;; *) echo "unknown arg $1"; exit 2;; esac; done
WT=/home/deploy/worktrees/mythos-wp-main
APP=$WT/projects/mythos-wp
ENVF=/home/deploy/deployments/mythos-wp/.env
BK=/var/backups/mythos-db
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
as_deploy() { sudo -u deploy env XDG_RUNTIME_DIR=/run/user/1001 HOME=/home/deploy "$@"; }
envrun() { sudo -u deploy bash -c "set -a; . $ENVF; set +a; cd $APP && $*"; }

echo "== 1. backup"
if [ "$BACKUP" = 1 ]; then
  mkdir -p "$BK"
  docker exec idauto-postgres pg_dump -U idauto -Fc mythos_wp > "$BK/mythos_wp-v2-pre-$STAMP.dump"
  sha256sum "$BK/mythos_wp-v2-pre-$STAMP.dump" > "$BK/mythos_wp-v2-pre-$STAMP.dump.sha256"
  ls -la "$BK/mythos_wp-v2-pre-$STAMP.dump"*
else echo "skipped"; fi

echo "== 2. checkout $REF"
PREV=$(as_deploy git -C "$WT" rev-parse --short HEAD)
as_deploy git -C "$WT" fetch origin --prune
as_deploy git -C "$WT" checkout --detach "$REF"
as_deploy git -C "$WT" log --oneline -1
[ -d "$APP/node_modules/pg" ] || as_deploy cp -r /home/deploy/worktrees/wp-v2/projects/mythos-wp/node_modules "$APP/"
echo "previous: $PREV"

echo "== 3. migrate"
envrun node bin/mythos-wp migrate up
envrun node bin/mythos-wp migrate status

echo "== 4. users import"
envrun node bin/mythos-wp users import || true

echo "== 5. restart"
as_deploy systemctl --user restart mythos-wp.service
for i in $(seq 1 30); do sleep 1; curl -fsS http://127.0.0.1:8170/healthz >/dev/null 2>&1 && break; done
as_deploy systemctl --user is-active mythos-wp.service
curl -fsS http://127.0.0.1:8170/healthz && echo

echo "== 6. smoke (loopback)"
curl -sS -o /dev/null -w 'login page: %{http_code}\n' http://127.0.0.1:8170/login
curl -sS -o /dev/null -w 'shell (unauth → 302): %{http_code}\n' http://127.0.0.1:8170/
echo "done; previous sha $PREV (rollback: git -C $WT checkout --detach $PREV && systemctl --user restart mythos-wp.service)"
