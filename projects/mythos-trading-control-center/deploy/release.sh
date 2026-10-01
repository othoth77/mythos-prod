#!/usr/bin/env bash
# =====================================================
# MYTHOS TRADING CONTROL CENTER — build a release and switch to it
# projects/mythos-trading-control-center/deploy/release.sh
#
#   deploy/release.sh <commit> [--no-switch]
#
# Run as the `deploy` user, from a checkout that has <commit>.
#
# A release is an EXPORT of one commit — the Trading Agent, this project and
# the brand sources its tests compare against — into
# <root>/releases/<commit>/ , with the interface built and the commit
# written to a COMMIT file. Nothing is edited in place and the checkout it was
# exported from is never what runs.
#
# ONLY DEPLOY AFTER ALL PASS: both suites run from the release directory, as
# exported, before the `current` symlink moves. A failure leaves `current`
# exactly where it was.
#
# This script never touches nginx, certificates, the users file or the state
# directory. State and users live beside the releases and survive every
# switch and every rollback.
#
# ROLLBACK:  ln -sfn releases/<previous-commit> <root>/current
#            systemctl --user restart mythos-trading-control-center
# =====================================================
set -euo pipefail

ROOT="${TCC_DEPLOY_ROOT:-/home/deploy/deployments/mythos-trading-control-center}"
UNIT="mythos-trading-control-center"
BRANCH="mythos/trading-control-center"
AGENT_BASE="82b1ce0c"      # the Trading Agent commit this project was built on

COMMIT="${1:-}"
SWITCH=1
[ "${2:-}" = "--no-switch" ] && SWITCH=0

say() { printf '%s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 1; }

[ -n "$COMMIT" ] || die "usage: release.sh <commit> [--no-switch]"
[ "$(id -un)" != "root" ] || die "run as the deploy user, not root"
REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die "run from inside the repository"
FULL="$(git -C "$REPO" rev-parse --verify "${COMMIT}^{commit}" 2>/dev/null)" || die "unknown commit $COMMIT"

# The commit must be on the remote branch: what runs in production is what is
# on GitHub, not something that exists only on this machine.
git -C "$REPO" fetch -q origin "$BRANCH"
git -C "$REPO" merge-base --is-ancestor "$FULL" "origin/$BRANCH" || die "$FULL is not on origin/$BRANCH"

# The Trading Agent in the release must be the one the LIVE lock was audited
# against. This is the same comparison tests/live-lock-test.js makes.
if [ -n "$(git -C "$REPO" diff --stat "$AGENT_BASE" "$FULL" -- projects/mythos-trading-agent)" ]; then
  die "the Trading Agent at $FULL differs from $AGENT_BASE; a LIVE protection may have changed — stop and review"
fi

REL="$ROOT/releases/$FULL"
mkdir -p "$ROOT/releases"
[ -d "$ROOT/state" ] || { mkdir -p "$ROOT/state"; chmod 700 "$ROOT/state"; }

if [ -e "$REL" ]; then
  say "release $FULL already exists; reusing it"
else
  TMP="$ROOT/releases/.tmp-$FULL-$$"
  rm -rf "$TMP"; mkdir -p "$TMP"
  trap 'rm -rf "$TMP"' EXIT
  # The agent, this project, and the canonical brand sources: the interface
  # tests compare the served tokens, fonts and mark against them byte for
  # byte, and that comparison must keep working from a release — at the gate
  # below and later from the Testing Center.
  git -C "$REPO" archive "$FULL" projects/mythos-trading-agent projects/mythos-trading-control-center \
    assets/brand/tokens assets/brand/fonts assets/brand/master | tar -x -C "$TMP"
  APP="$TMP/projects/mythos-trading-control-center"
  printf '%s\n' "$FULL" > "$APP/COMMIT"
  ( cd "$APP" && node bin/build.js --commit "$FULL" )

  say "running the Trading Agent suite from the release…"
  ( cd "$TMP/projects/mythos-trading-agent" && HOME="$(mktemp -d)" npm test > "$TMP/agent-tests.log" 2>&1 ) \
    || { grep -E '^not ok|^# (tests|pass|fail)' "$TMP/agent-tests.log" | tail -20; cp "$TMP/agent-tests.log" "$ROOT/last-failed-agent-tests.log"; die "the Trading Agent suite failed; nothing was switched"; }
  grep -E '^# (tests|pass|fail|skipped)' "$TMP/agent-tests.log"

  say "running the Control Center suite from the release…"
  ( cd "$APP" && HOME="$(mktemp -d)" TCC_CHROME="${TCC_CHROME:-/home/deploy/wpv2-ui-test/headless-shell/chrome-headless-shell}" npm test > "$TMP/cc-tests.log" 2>&1 ) \
    || { grep -E '^not ok|^# (tests|pass|fail)' "$TMP/cc-tests.log" | tail -20; cp "$TMP/cc-tests.log" "$ROOT/last-failed-cc-tests.log"; die "the Control Center suite failed; nothing was switched"; }
  grep -E '^# (tests|pass|fail|skipped)' "$TMP/cc-tests.log"

  # The release is read-only from here on.
  chmod -R a-w "$TMP/projects" "$TMP/assets"
  mv "$TMP" "$REL"
  trap - EXIT
  say "release built: $REL"
fi

if [ "$SWITCH" -eq 0 ]; then
  say "not switching (--no-switch). To switch:  ln -sfn releases/$FULL $ROOT/current"
  exit 0
fi

PREV="$(readlink "$ROOT/current" 2>/dev/null || true)"
ln -sfn "releases/$FULL" "$ROOT/current"
say "current -> releases/$FULL  (was: ${PREV:-nothing})"

if systemctl --user list-unit-files "$UNIT.service" >/dev/null 2>&1 && systemctl --user cat "$UNIT.service" >/dev/null 2>&1; then
  systemctl --user restart "$UNIT.service"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS --max-time 3 http://127.0.0.1:8210/api/health >/dev/null 2>&1; then break; fi
    sleep 1
  done
  if ! "$(dirname "$0")/smoke.sh" http://127.0.0.1:8210 "$FULL"; then
    say "SMOKE TEST FAILED — rolling back"
    if [ -n "$PREV" ]; then ln -sfn "$PREV" "$ROOT/current"; systemctl --user restart "$UNIT.service"; say "rolled back to $PREV"; else systemctl --user stop "$UNIT.service"; say "no previous release; the service was stopped"; fi
    exit 1
  fi
  say "service restarted on release $FULL and passed the smoke test"
else
  say "the unit $UNIT.service is not installed; install it (deploy/README.md), then: systemctl --user start $UNIT"
fi
