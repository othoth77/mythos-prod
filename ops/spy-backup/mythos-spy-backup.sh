#!/usr/bin/env bash
# MYTHOS — SPY durability backup (PROPOSED — not installed by an agent).
#
# Takes a consistent ONLINE copy of the SPY SQLite database with the SQLite
# backup API (WAL-safe, no lock on writers, source opened read-only), plus a
# tarball of the page snapshots, then checksums, integrity-checks and applies
# retention (14 daily + 8 weekly). Off-host push is delegated to the existing
# offhost tooling (projects/infrastructure/ops/offhost-backup.js) in a later
# step — see ops/spy-backup/README.md §4; this script never deletes anything
# outside its own destination directory and never touches the live database
# other than reading it.
#
# Runs as `deploy` (the owner of spy.db). No sudo, no docker, no network.
set -euo pipefail

SRC_DB="${SPY_BACKUP_SRC_DB:-/home/deploy/deployments/spy/var/spy.db}"
SRC_SNAP="${SPY_BACKUP_SRC_SNAPSHOTS:-/home/deploy/deployments/spy/var/snapshots}"
DEST="${SPY_BACKUP_DEST:-/home/deploy/mythos-backups/spy-db}"
PY="${SPY_BACKUP_PYTHON:-/home/deploy/deployments/spy/venv/bin/python}"
KEEP_DAILY="${SPY_BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${SPY_BACKUP_KEEP_WEEKLY:-8}"
HEALTH="${SPY_BACKUP_HEALTH_FILE:-/home/deploy/mythos-backups/health/backup-health-spy.json}"

say()  { echo "[spy-backup] $*"; }
fail() { echo "[spy-backup] FAIL: $*" >&2; write_health "failed" "$*"; exit 1; }
write_health() {
  mkdir -p "$(dirname "$HEALTH")"
  printf '{"schema_version":"1.0.0","source":"ops/spy-backup/mythos-spy-backup.sh","status":"%s","finished_at":"%s","error":"%s"}\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-}" > "$HEALTH.tmp" && mv "$HEALTH.tmp" "$HEALTH"
}

[ "$(id -un)" = "deploy" ] || fail "must run as deploy (owner of $SRC_DB)"
[ -r "$SRC_DB" ] || fail "source database not readable: $SRC_DB"
case "$DEST" in /home/deploy/mythos-backups/*) : ;; *) fail "destination outside permitted root: $DEST" ;; esac
mkdir -p "$DEST"; chmod 700 "$DEST"
umask 077

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DOW="$(date -u +%u)"   # 7 = Sunday -> weekly slot
OUT="$DEST/spy-$TS.db"

# --- 1. Online copy via the SQLite backup API (source read-only) -------------
"$PY" - "$SRC_DB" "$OUT" <<'PYEOF' || fail "sqlite backup failed"
import sqlite3, sys, hashlib, os, json, time
src_path, dst = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
d = sqlite3.connect(dst)
t0 = time.time(); src.backup(d, pages=1024); d.close(); src.close()
chk = sqlite3.connect(f"file:{dst}?mode=ro", uri=True)
ic = chk.execute("pragma integrity_check").fetchall()[0][0]
counts = {t: chk.execute(f"select count(*) from {t}").fetchone()[0]
          for t in ("competitor","source","observation","event","event_correction","run","snapshot")}
chk.close()
for ext in ("-wal","-shm"):
    try: os.remove(dst+ext)
    except FileNotFoundError: pass
if ic != "ok":
    os.remove(dst); print("integrity_check:", ic); sys.exit(2)
h = hashlib.sha256(open(dst,"rb").read()).hexdigest()
open(dst+".sha256","w").write(f"{h}  {os.path.basename(dst)}\n")
json.dump({"created_at": os.path.basename(dst)[4:-3], "source": src_path,
           "method": "sqlite3 Connection.backup (online, read-only source)",
           "bytes": os.path.getsize(dst), "sha256": h, "integrity_check": ic,
           "counts": counts, "seconds": round(time.time()-t0, 2)},
          open(dst+".manifest.json","w"), indent=2)
print(json.dumps(counts))
PYEOF
say "database copied: $OUT ($(stat -c %s "$OUT") bytes), integrity ok"

# --- 2. Snapshots (page text on disk; small) ---------------------------------
if [ -d "$SRC_SNAP" ]; then
  tar -C "$(dirname "$SRC_SNAP")" -czf "$DEST/spy-snapshots-$TS.tar.gz" "$(basename "$SRC_SNAP")"
  ( cd "$DEST" && sha256sum "spy-snapshots-$TS.tar.gz" > "spy-snapshots-$TS.tar.gz.sha256" )
  say "snapshots archived"
fi

# --- 3. Weekly slot: Sunday copies are hard-linked into weekly/ ----------------
if [ "$DOW" = "7" ]; then
  mkdir -p "$DEST/weekly"
  ln -f "$OUT" "$DEST/weekly/spy-$TS.db"; ln -f "$OUT.sha256" "$DEST/weekly/spy-$TS.db.sha256"
  ln -f "$OUT.manifest.json" "$DEST/weekly/spy-$TS.db.manifest.json"
fi

# --- 4. Retention: newest N kept, only inside $DEST -----------------------------
prune() { # <dir> <glob> <keep>
  ls -1t "$1"/$2 2>/dev/null | tail -n +"$(( $3 + 1 ))" | while read -r f; do
    say "retention: removing $f"; rm -f "$f" "$f.sha256" "$f.manifest.json"
  done
}
prune "$DEST" 'spy-*.db' "$KEEP_DAILY"
prune "$DEST" 'spy-snapshots-*.tar.gz' "$KEEP_DAILY"
[ -d "$DEST/weekly" ] && prune "$DEST/weekly" 'spy-*.db' "$KEEP_WEEKLY"

write_health "ok" ""
say "done $TS"
