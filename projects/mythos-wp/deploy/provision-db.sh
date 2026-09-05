#!/usr/bin/env bash
# =============================================================================
# MYTHOS WP — database provisioning (idempotent; run on the VPS as root)
# projects/mythos-wp/deploy/provision-db.sh
#
# Creates, in the EXISTING idauto-postgres cluster (no new server):
#   role      mythos_wp_owner           (login, no superuser)
#   database  mythos_wp                 (panel data — schema.sql)
#   database  mythos_wp_test            (test fixture: panel schema + an empty
#                                        ssangyong_autos-shaped catalogue)
# and writes /home/deploy/deployments/mythos-wp/.env (0600, deploy) with the
# generated credential. The catalogue URL for ssangyong.autos is derived from
# the storefront's existing credential file so no second catalogue role is
# minted. Nothing is printed but names.
#
#   sudo bash projects/mythos-wp/deploy/provision-db.sh
# =============================================================================
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTAINER="${MYTHOS_WP_PG_CONTAINER:-idauto-postgres}"
ENV_DIR=/home/deploy/deployments/mythos-wp
ENV_FILE="$ENV_DIR/.env"
SF_ENV=/home/deploy/deployments/ssangyong-autos-storefront/.env

psql_super() { docker exec -i "$CONTAINER" psql -U idauto -v ON_ERROR_STOP=1 -q "$@"; }

if [ -f "$ENV_FILE" ] && grep -q '^MYTHOS_WP_DB_PASSWORD=' "$ENV_FILE"; then
  PASS="$(sed -n 's/^MYTHOS_WP_DB_PASSWORD=//p' "$ENV_FILE" | head -1)"
  echo "env: existing credential reused"
else
  PASS="$(openssl rand -hex 24)"
  echo "env: new credential generated"
fi

# role
if psql_super -d postgres -Atc "select 1 from pg_roles where rolname='mythos_wp_owner'" | grep -q 1; then
  echo "role: mythos_wp_owner exists"
  psql_super -d postgres -c "ALTER ROLE mythos_wp_owner WITH LOGIN PASSWORD '$PASS'" >/dev/null
else
  psql_super -d postgres -c "CREATE ROLE mythos_wp_owner WITH LOGIN PASSWORD '$PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE" >/dev/null
  echo "role: mythos_wp_owner created"
fi

for DB in mythos_wp mythos_wp_test; do
  if psql_super -d postgres -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
    echo "database: $DB exists"
  else
    psql_super -d postgres -c "CREATE DATABASE $DB OWNER mythos_wp_owner" >/dev/null
    echo "database: $DB created"
  fi
  psql_super -d "$DB" -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC" >/dev/null
  docker exec -i "$CONTAINER" psql -U mythos_wp_owner -d "$DB" -v ON_ERROR_STOP=1 -q < "$REPO/projects/mythos-wp/database/schema.sql"
  echo "schema: $DB applied"
done

# Test catalogue: the ssangyong_autos table shape inside mythos_wp_test.
if ! docker exec -i "$CONTAINER" psql -U mythos_wp_owner -d mythos_wp_test -Atc "select 1 from pg_namespace where nspname='ssangyong_autos'" | grep -q 1; then
  docker exec -i "$CONTAINER" psql -U mythos_wp_owner -d mythos_wp_test -v ON_ERROR_STOP=1 -q -c "CREATE SCHEMA ssangyong_autos"
  { echo "SET search_path = ssangyong_autos;"; cat "$REPO/projects/ssangyong-autos/database/schema.sql"; } | docker exec -i "$CONTAINER" psql -U mythos_wp_owner -d mythos_wp_test -v ON_ERROR_STOP=1 -q
  echo "test catalogue: ssangyong_autos schema created in mythos_wp_test"
else
  echo "test catalogue: exists"
fi

# env file
install -d -m 0750 -o deploy -g deploy "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  # Catalogue URL for ssangyong.autos from the storefront credential (same role, same DB).
  CAT_URL=""
  if [ -f "$SF_ENV" ]; then
    CAT_URL="$(node -e '
      var fs=require("fs"); var t=fs.readFileSync(process.argv[1],"utf8"); var o={};
      t.split(/\n/).forEach(function(l){var m=/^([A-Z_]+)=(.*)$/.exec(l); if(m) o[m[1]]=m[2].replace(/^"(.*)"$/,"$1");});
      if(!o.SSANGYONG_DB_USER) process.exit(0);
      process.stdout.write("postgres://"+encodeURIComponent(o.SSANGYONG_DB_USER)+":"+encodeURIComponent(o.SSANGYONG_DB_PASSWORD)+"@"+o.SSANGYONG_DB_HOST+":"+o.SSANGYONG_DB_PORT+"/"+o.SSANGYONG_DB_NAME);
    ' "$SF_ENV")"
  fi
  umask 077
  cat > "$ENV_FILE" <<ENV
# MYTHOS WP runtime environment — NEVER commit, NEVER print. 0600, outside Git.
MYTHOS_WP_PORT=8170
MYTHOS_WP_BIND=127.0.0.1
MYTHOS_WP_DB_HOST=127.0.0.1
MYTHOS_WP_DB_PORT=5432
MYTHOS_WP_DB_USER=mythos_wp_owner
MYTHOS_WP_DB_PASSWORD=$PASS
MYTHOS_WP_DB_NAME=mythos_wp
# Users file (0600): { "users": [ { "username", "role", "scrypt" } ] } — bin/mythos-wp set-password
MYTHOS_WP_USERS_FILE=$ENV_DIR/users.json
# Catalogue connections, one variable per project; wp_projects.catalog_dsn_env names the variable.
MYTHOS_WP_CATALOG_SSANGYONG_AUTOS=$CAT_URL
# Optional: the real MYTHOS AUTO comms configuration (outside Git). Absent = Auto-Reply shows OFF / not configured.
# MYTHOS_WP_COMMS_CONFIG=/home/deploy/deployments/mythos-auto-comms/comms.json
ENV
  chown deploy:deploy "$ENV_FILE"; chmod 0600 "$ENV_FILE"
  echo "env: written $ENV_FILE"
else
  echo "env: $ENV_FILE kept"
fi
echo "provision: done"
