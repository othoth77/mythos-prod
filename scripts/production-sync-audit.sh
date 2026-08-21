#!/usr/bin/env bash
# scripts/production-sync-audit.sh — READ-ONLY production-vs-main audit.
# Post-audit execution phase, Phase 3 (2026-08-21).
#
# Run ON THE VPS as deploy (or mythosadmin where noted). Compares what is
# actually deployed against origin/main and prints a drift report. This
# script NEVER mutates anything: no checkout, no restart, no rsync, no
# reload — findings only. Deployment itself stays with the operator
# (`sudo mythos-deploy …`, scripts/deploy-status-center.sh, service
# restarts) per the repository's Level-3 boundary.
set -u -o pipefail

CHECKOUT="${MYTHOS_PROD_CHECKOUT:-/home/deploy/projects/mythos-prod}"
STATUS_DOCROOT="/var/www/status.mythosprod.xyz"
DRIFT=0

say()  { printf '%s\n' "$*"; }
head_of() { git -C "$CHECKOUT" rev-parse --short "$1" 2>/dev/null || echo "unknown"; }
drift() { DRIFT=$((DRIFT + 1)); say "  DRIFT: $*"; }
ok()    { say "  OK: $*"; }
info()  { say "  INFO: $*"; }

say "== Mythos production sync audit ($(date -u +%Y-%m-%dT%H:%M:%SZ)) =="
say ""
say "-- 1. Deploy checkout vs origin/main"
if [ ! -d "$CHECKOUT/.git" ]; then
  drift "checkout missing at $CHECKOUT"
else
  git -C "$CHECKOUT" fetch origin main --quiet 2>/dev/null || info "fetch failed (offline?) — comparing against last-known origin/main"
  LOCAL="$(head_of HEAD)"; REMOTE="$(head_of origin/main)"
  if [ "$LOCAL" = "$REMOTE" ]; then ok "checkout at origin/main ($LOCAL)"; else
    drift "checkout $LOCAL != origin/main $REMOTE (behind by $(git -C "$CHECKOUT" rev-list --count HEAD..origin/main 2>/dev/null || echo '?') commits)"
  fi
  if [ -n "$(git -C "$CHECKOUT" status --porcelain 2>/dev/null | grep -v '^??' || true)" ]; then
    drift "checkout worktree carries local modifications"
  else ok "worktree clean (tracked files)"; fi
fi

say ""
say "-- 2. Running services vs checkout (stale-process detection)"
# The MOS-CONSOLE-LIVE incident: services running code older than the
# checkout. A service started BEFORE the checkout's last relevant commit
# is suspect and needs an operator restart to pick the code up.
for svc in mythos-ai-executor mythos-os-console; do
  START="$(systemctl --user show "$svc" --property=ExecMainStartTimestamp --value 2>/dev/null || true)"
  if [ -z "$START" ] || [ "$START" = "n/a" ]; then
    info "$svc: not queryable from this user session (run as deploy with the user bus)"
    continue
  fi
  START_EPOCH="$(date -d "$START" +%s 2>/dev/null || echo 0)"
  LAST_CODE_EPOCH="$(git -C "$CHECKOUT" log -1 --format=%ct -- projects/mythos-ai-executor projects/mythos-os-console 2>/dev/null || echo 0)"
  if [ "$START_EPOCH" -ge "$LAST_CODE_EPOCH" ] && [ "$START_EPOCH" -gt 0 ]; then
    ok "$svc started $START (newer than last service-code commit)"
  else
    drift "$svc started $START — OLDER than the last service-code commit; restart needed to run current main"
  fi
done

say ""
say "-- 3. Status Center webroot vs repo"
if [ ! -d "$STATUS_DOCROOT" ]; then
  drift "status webroot missing ($STATUS_DOCROOT)"
else
  for f in index.html assets/app.js assets/app.css data/current.json; do
    if [ ! -f "$STATUS_DOCROOT/$f" ]; then drift "webroot missing $f"; continue; fi
    A="$(sha256sum "$STATUS_DOCROOT/$f" | cut -d' ' -f1)"
    B="$(sha256sum "$CHECKOUT/sites/status.mythosprod.xyz/$f" 2>/dev/null | cut -d' ' -f1)"
    if [ "$A" = "$B" ]; then ok "webroot $f matches repo"; else drift "webroot $f differs from repo (deployed content stale — resync per DEPLOYMENT.md)"; fi
  done
  if [ -f "$STATUS_DOCROOT/data/live-status.json" ]; then
    GEN="$(sed -n 's/.*"generated_at": *"\([^"]*\)".*/\1/p' "$STATUS_DOCROOT/data/live-status.json" | head -1)"
    ok "live monitor snapshot present (generated_at $GEN)"
  else
    drift "no live-status.json in webroot — STC-2 monitor not installed/run (projects/status-center/monitor/install.sh)"
  fi
fi

say ""
say "-- 4. Configuration & environment presence (names only, values never printed)"
for f in \
  "/home/deploy/.config/mythos/idauto-offhost.env:backup credential (O-BACKUP-6)" \
  "/home/deploy/.config/mythos/backup-schedule.env:backup schedule config (ops/backup)" ; do
  P="${f%%:*}"; L="${f#*:}"
  if [ -f "$P" ]; then
    M="$(stat -c %a "$P")"
    [ "$M" = "600" ] && ok "$L present, mode 0600" || drift "$L present but mode $M (must be 0600)"
  else drift "$L MISSING ($P)"; fi
done
KJ="$CHECKOUT/config/knowledge.json"
if [ -f "$KJ" ]; then
  EN="$(sed -n 's/.*"enabled": *\(true\|false\).*/\1/p' "$KJ" | head -1)"
  info "knowledge layer enabled=$EN (owner decision; PR #63 context)"
fi

say ""
say "-- 5. Scheduled timers expected on this host"
for t in mythos-backup.timer mythos-backup-verify.timer mythos-restore-test.timer mythos-status-monitor.timer; do
  if systemctl list-timers --all --no-pager 2>/dev/null | grep -q "$t"; then
    ok "$t installed"
  else
    drift "$t not installed (ops/backup/install.sh · projects/status-center/monitor/install.sh)"
  fi
done

say ""
say "-- 6. Recorded repo-side deltas that need operator deployment (from the 2026-08-21 audit)"
say "  - MIG-1/2/3 design migrations: committed to main, production app host still needs the manual rsync (README)."
say "  - sites/mythosprod.xyz hub: built, apex DNS + deployment pending (BLOCKER-HUB-DNS)."
say "  - MOS-v2 M-12 (runtime skills + governed MCP): built, NOT deployed."
say "  - PR #58 (Status Center Arabic layer): unmerged, undeployed."
say "  - ssangyong.autos nginx drift (101 lines): unreconciled (BLOCKER-SYA-NGINX-DRIFT)."

say ""
if [ "$DRIFT" -eq 0 ]; then
  say "RESULT: NO DRIFT DETECTED (sections 1-5)."
else
  say "RESULT: $DRIFT drift finding(s). Fix via the documented operator paths only — this script changes nothing."
fi
exit 0
