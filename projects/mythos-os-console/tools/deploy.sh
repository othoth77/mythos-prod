#!/usr/bin/env bash
# =====================================================
# MYTHOS OS COMMAND CENTER — deployment
# projects/mythos-os-console/tools/deploy.sh
#
# Executes docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md §10.2 with every gate
# enforced as a hard stop rather than remembered. Run it ON THE VPS, as
# the `deploy` user:
#
#   bash projects/mythos-os-console/tools/deploy.sh
#
# WHAT IT WILL NOT DO
#   - It will not run anywhere that is not the real host. Phase 0 asserts
#     the environment and aborts otherwise; an ephemeral container has
#     no business touching production, and "it looked close enough" is
#     how the wrong machine gets deployed to.
#   - It never prints, logs or echoes the control-plane token. xtrace is
#     refused outright, because `set -x` would leak it.
#   - It never writes projects/mythos-ai-executor/config/roadmap-state.json
#     or anything under projects/ssangyong-autos/. Both are fingerprinted
#     at the start and re-checked at the end.
#   - It does not install the nginx vhost itself. `deploy` cannot write
#     /etc/nginx, and its sudo grant is exactly three commands. Phase 5
#     stops and prints the two root commands rather than pretending.
#
# ON FAILURE it stops at once (set -e) and prints what was done and how
# to undo it. The one automatic rollback is removing a vhost symlink this
# run created when `nginx -t` then fails — leaving a broken config staged
# is worse than removing it, and nginx has not been reloaded at that
# point so the running config is untouched.
#
# Re-running is safe. Every step checks for its own prior result first.
# =====================================================

set -euo pipefail

# `set -x` would print the token. Refuse rather than leak.
case "$-" in *x*) echo "FATAL: xtrace is enabled; refusing to run (it would leak the token)." >&2; exit 2 ;; esac

DOMAIN="${MOS_DOMAIN:-os.mythosprod.xyz}"
EXPECT_IP="${MOS_EXPECT_IP:-51.68.226.211}"
PORT="${MOS_PORT:-8140}"
EXECUTOR="${MOS_EXECUTOR_URL:-http://127.0.0.1:8130}"
REPO="${MOS_REPO:-/home/deploy/projects/mythos-prod}"
ENVDIR="${MOS_ENVDIR:-/home/deploy/deployments/mythos-os-console}"
ENVFILE="$ENVDIR/.env"
UNIT_SRC_REL="projects/mythos-os-console/deploy/mythos-os-console.user.service"
VHOST_SRC_REL="projects/mythos-os-console/deploy/nginx-os.mythosprod.xyz.conf"
UNIT_DST="$HOME/.config/systemd/user/mythos-os-console.service"
VHOST_AVAIL="/etc/nginx/sites-available/$DOMAIN"
VHOST_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"
NEIGHBOURS=(ordre.mythosprod.xyz panel.mythosprod.xyz tv.mythosprod.xyz)
ASSUME_YES="${MOS_ASSUME_YES:-0}"
READY_TIMEOUT="${MOS_READY_TIMEOUT:-30}"
[ "${1:-}" = "--assume-yes" ] && ASSUME_YES=1

DID_ENV=0; DID_UNIT=0; DID_SYMLINK=0

say()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
info() { printf '  ..    %s\n' "$1"; }
die()  { printf '  \033[31mSTOP\033[0m  %s\n' "$1" >&2; exit 1; }

confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  local reply
  read -rp "  >> $1 [y/N] " reply
  case "$reply" in y|Y|yes|YES) return 0 ;; *) die "declined by operator" ;; esac
}

on_exit() {
  local rc=$?
  [ "$rc" -eq 0 ] && return 0
  printf '\n\033[31mDEPLOYMENT STOPPED (exit %s).\033[0m What this run changed:\n' "$rc" >&2
  [ "$DID_ENV"     = 1 ] && printf '  - wrote %s  (rm it to undo)\n' "$ENVFILE" >&2
  [ "$DID_UNIT"    = 1 ] && printf '  - installed+started the user unit  (systemctl --user disable --now mythos-os-console)\n' >&2
  [ "$DID_SYMLINK" = 1 ] && printf '  - created %s  (already removed if nginx -t failed)\n' "$VHOST_ENABLED" >&2
  { [ "$DID_ENV" = 0 ] && [ "$DID_UNIT" = 0 ] && [ "$DID_SYMLINK" = 0 ]; } && printf '  - nothing; the host is unchanged\n' >&2
  printf '\nnginx was NOT reloaded unless phase 6 reported it. Fix the cause and re-run; the script is idempotent.\n' >&2
}
trap on_exit EXIT

# ---------------------------------------------------------------------
say "Phase 0 — environment assertions (refuse to run on the wrong machine)"

[ -d "$REPO/.git" ]        || die "no git worktree at $REPO. This is not the VPS, or MOS_REPO is wrong."
[ -d /etc/nginx ]          || die "/etc/nginx does not exist. This is not the VPS."
[ -d /home/deploy ]        || die "/home/deploy does not exist. This is not the VPS."
command -v node >/dev/null || die "node is not installed."
command -v curl >/dev/null || die "curl is not installed."
command -v systemctl >/dev/null || die "systemctl is not available."
ok "on a host with $REPO, /etc/nginx and /home/deploy"
ok "node $(node -v)"

cd "$REPO"
[ -f "$UNIT_SRC_REL" ]  || die "missing $UNIT_SRC_REL — is this checkout on the merged main?"
[ -f "$VHOST_SRC_REL" ] || die "missing $VHOST_SRC_REL — is this checkout on the merged main?"
ok "deployment sources present"

resolved="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
[ -n "$resolved" ] || die "$DOMAIN does not resolve. Create the A record at OVH -> $EXPECT_IP (owner action)."
[ "$resolved" = "$EXPECT_IP" ] || die "$DOMAIN resolves to $resolved, expected $EXPECT_IP."
ok "$DOMAIN resolves to $resolved"

# Fingerprint the two things this script must never touch.
GUARD_ROADMAP="projects/mythos-ai-executor/config/roadmap-state.json"
RM_BEFORE="$(sha256sum "$GUARD_ROADMAP" 2>/dev/null | awk '{print $1}' || echo absent)"
SY_BEFORE="$(git status --porcelain -- projects/ssangyong-autos/ 2>/dev/null | sha256sum | awk '{print $1}')"
ok "fingerprinted roadmap-state.json and the SSANGYONG tree"

# ---------------------------------------------------------------------
say "Phase 1 — repository and tests"
info "HEAD $(git rev-parse HEAD)"
node tests/mos-1-console-test.js >/tmp/mos-1-tests.$$ 2>&1 \
  || { tail -20 /tmp/mos-1-tests.$$ >&2; rm -f /tmp/mos-1-tests.$$; die "tests/mos-1-console-test.js FAILED — not deploying."; }
ok "$(tail -1 /tmp/mos-1-tests.$$)"; rm -f /tmp/mos-1-tests.$$

# ---------------------------------------------------------------------
say "Phase 2 — credentials"
if [ -f "$ENVFILE" ] && grep -q '^MOS_EXECUTOR_TOKEN=.\+$' "$ENVFILE"; then
  ok "$ENVFILE already holds a token (value not read)"
else
  umask 077
  install -d -m 700 "$ENVDIR"
  # Read into a variable in THIS shell, prompt explicitly, and print
  # with printf. Not `"$(read -rs T; echo "$T")"`: that works under bash
  # but prints no prompt, and `echo` is not backslash-safe, so the same
  # line under sh/dash corrupts a token containing a backslash.
  # printf is a bash builtin, so the value never reaches the process
  # table, and `read` never writes it to shell history.
  printf '  >> MOS_EXECUTOR_TOKEN (input hidden): '
  IFS= read -rs MOS_TOK || die "could not read the token"
  printf '\n'
  [ -n "$MOS_TOK" ] || die "empty token."
  printf 'MOS_EXECUTOR_TOKEN=%s\n' "$MOS_TOK" > "$ENVFILE"
  unset MOS_TOK
  chmod 600 "$ENVFILE"
  DID_ENV=1
  ok "wrote $ENVFILE"
fi
[ "$(stat -c '%a' "$ENVFILE")" = "600" ] || die "$ENVFILE is mode $(stat -c '%a' "$ENVFILE"), expected 600."
[ "$(grep -c '^MOS_EXECUTOR_TOKEN=.\+$' "$ENVFILE")" = "1" ] || die "$ENVFILE does not contain exactly one non-empty MOS_EXECUTOR_TOKEN line."
ok "mode 600, exactly one token line (verified by count, never printed)"

case "$(git check-ignore -v "$ENVFILE" 2>/dev/null; git ls-files --error-unmatch "$ENVFILE" 2>/dev/null || true)" in
  *"$ENVFILE"*) die "$ENVFILE is inside the git worktree and tracked. Move it outside the repo." ;;
esac
ok "credential file is outside the git worktree"

# ---------------------------------------------------------------------
say "Phase 3 — systemd user unit"
mkdir -p "$(dirname "$UNIT_DST")"
if ! cmp -s "$UNIT_SRC_REL" "$UNIT_DST"; then
  cp "$UNIT_SRC_REL" "$UNIT_DST"; DID_UNIT=1; ok "installed $UNIT_DST"
else
  ok "unit already current"
fi
systemctl --user daemon-reload
systemctl --user enable --now mythos-os-console >/dev/null 2>&1 || true
systemctl --user restart mythos-os-console
DID_UNIT=1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  systemctl --user is-active --quiet mythos-os-console && break
  sleep 1
done
systemctl --user is-active --quiet mythos-os-console \
  || { journalctl --user -u mythos-os-console -n 30 --no-pager >&2 || true; die "unit is not active. Log above."; }
ok "mythos-os-console is $(systemctl --user is-active mythos-os-console)"

# systemd calls a Type=simple unit active as soon as it has forked, which is
# before Node has bound the port. Phase 4 curls /api/health immediately, so
# without an explicit wait it intermittently reports a connection refused on
# a service that is perfectly healthy a second later — a false failure that
# aborts a deployment for no reason. `is-active` answers "did it start"; only
# the socket answers "can it serve". Gate on the socket.
#
# Bounded by wall clock, not by attempt count: each probe may itself take up
# to --max-time, so counting iterations would silently overshoot the budget.
say "Phase 3.1 — readiness (GATE: the port must answer before anything is verified)"
ready=0; last_code=000
ready_started="$(date +%s)"; ready_deadline=$(( ready_started + READY_TIMEOUT ))
while :; do
  # A crash loop must fail fast and loudly rather than burn the whole budget.
  if systemctl --user is-failed --quiet mythos-os-console; then
    printf '\n  --- journalctl --user -u mythos-os-console -n 40 ---\n' >&2
    journalctl --user -u mythos-os-console -n 40 --no-pager >&2 || true
    die "unit entered a failed state $(( $(date +%s) - ready_started ))s into the readiness wait. Log above."
  fi
  # `curl -w` prints 000 itself on a refused connection, so `|| echo 000`
  # would concatenate to "000000" and fall through the 000 diagnostic branch,
  # mislabelling "nothing listening" as "bound but erroring". Let curl's own
  # value stand; `|| true` is only there to satisfy set -e.
  last_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/api/health")" || true
  [ -n "$last_code" ] || last_code=000
  [ "$last_code" = "200" ] && { ready=1; break; }
  [ "$(date +%s)" -ge "$ready_deadline" ] && break
  sleep 1
done
if [ "$ready" != 1 ]; then
  printf '\n  waited %ss for http://127.0.0.1:%s/api/health; last HTTP code: %s\n' \
    "$(( $(date +%s) - ready_started ))" "$PORT" "$last_code" >&2
  case "$last_code" in
    000) printf '  000 — nothing accepted the connection: the process never bound the port.\n' >&2 ;;
    *)   printf '  %s — the port answered but not with 200: it bound and is erroring.\n' "$last_code" >&2 ;;
  esac
  printf '\n  --- systemctl --user status mythos-os-console ---\n' >&2
  systemctl --user status mythos-os-console --no-pager -n 0 >&2 || true
  printf '\n  --- journalctl --user -u mythos-os-console -n 40 ---\n' >&2
  journalctl --user -u mythos-os-console -n 40 --no-pager >&2 || true
  die "127.0.0.1:$PORT did not serve /api/health with HTTP 200 within ${READY_TIMEOUT}s."
fi
ok "127.0.0.1:$PORT answering /api/health with 200 after $(( $(date +%s) - ready_started ))s"

# ---------------------------------------------------------------------
say "Phase 4 — local verification (GATE: nothing is exposed until this passes)"
health="$(curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health")" || die "GET /api/health failed on 127.0.0.1:$PORT."
echo "$health" | grep -q '"ok":true' || die "/api/health did not report ok:true."
echo "$health" | grep -q '"token_provisioned":true' || die "/api/health reports token_provisioned:false — the unit is not reading $ENVFILE."
ok "/api/health ok, token provisioned"

if echo "$health" | grep -q '"upstream":{"ok":true'; then
  ok "control plane reachable"
else
  info "control plane not reporting ok — the console will render that honestly; continuing"
fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/")"
[ "$code" = "200" ] || die "shell returned $code on loopback, expected 200."
ok "shell 200"

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "http://127.0.0.1:$PORT/")"
[ "$code" = "405" ] || die "POST returned $code, expected 405. The read-only property is a governance claim — refusing to expose this publicly."
ok "POST 405 — read-only surface confirmed"

for p in /api/missions /api/agents /api/providers /api/roadmap /api/modules; do
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$PORT$p")"
  case "$c" in 200|502|503) ok "$p -> $c" ;; *) die "$p returned $c" ;; esac
done

# ---------------------------------------------------------------------
say "Phase 5 — nginx vhost"
if [ ! -f "$VHOST_AVAIL" ]; then
  if [ -w /etc/nginx/sites-available ]; then
    cp "$VHOST_SRC_REL" "$VHOST_AVAIL"; ok "installed $VHOST_AVAIL"
  else
    cat >&2 <<EOF

  STOP — the vhost needs root, which \`deploy\` does not have for file writes.
  Its sudo grant is exactly: nginx -t, systemctl reload nginx, certbot.

  Run these two as root, then re-run this script (it is idempotent and
  will resume here):

    cp $REPO/$VHOST_SRC_REL $VHOST_AVAIL
    ln -s $VHOST_AVAIL $VHOST_ENABLED

EOF
    exit 1
  fi
fi
if [ ! -e "$VHOST_ENABLED" ]; then
  if [ -w /etc/nginx/sites-enabled ]; then
    ln -s "$VHOST_AVAIL" "$VHOST_ENABLED"; DID_SYMLINK=1; ok "enabled $VHOST_ENABLED"
  else
    die "vhost present but not enabled, and sites-enabled is not writable. As root: ln -s $VHOST_AVAIL $VHOST_ENABLED"
  fi
else
  ok "vhost already enabled"
fi

# ---------------------------------------------------------------------
say "Phase 6 — nginx -t (GATE: no reload unless this passes)"
if ! sudo nginx -t; then
  if [ "$DID_SYMLINK" = 1 ]; then
    rm -f "$VHOST_ENABLED"; DID_SYMLINK=0
    printf '  rolled back: removed %s (nginx was NOT reloaded; the running config is untouched)\n' "$VHOST_ENABLED" >&2
  fi
  die "nginx -t FAILED. Config not reloaded."
fi
ok "nginx -t passed"
sudo systemctl reload nginx
ok "nginx reloaded"

# ---------------------------------------------------------------------
say "Phase 7 — neighbours (GATE: no TLS work until these are healthy)"
for h in "${NEIGHBOURS[@]}"; do
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$h/" || echo 000)"
  case "$c" in 2*|3*|401|403) ok "$h -> $c" ;; *) die "$h returned $c after the reload. Investigate before continuing." ;; esac
done

c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$DOMAIN/" || echo 000)"
case "$c" in 2*|3*) ok "http://$DOMAIN -> $c" ;; *) die "http://$DOMAIN returned $c; the vhost is not serving." ;; esac

# ---------------------------------------------------------------------
say "Phase 8 — TLS"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  ok "certificate already present"
else
  sudo certbot --nginx -d "$DOMAIN" --dry-run || die "certbot dry run FAILED. No certificate requested."
  ok "certbot dry run passed"
  confirm "request the real certificate for $DOMAIN? (Let's Encrypt rate limits apply)"
  sudo certbot --nginx -d "$DOMAIN" || die "certbot FAILED."
  ok "certificate issued"
fi

# ---------------------------------------------------------------------
say "Phase 9 — public verification"
curl -fsS --max-time 20 "https://$DOMAIN/api/health" >/dev/null || die "https://$DOMAIN/api/health failed."
ok "https://$DOMAIN/api/health 200"
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/")"
[ "$c" = "200" ] || die "https://$DOMAIN/ returned $c."
ok "https://$DOMAIN/ 200"
c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "https://$DOMAIN/")"
[ "$c" = "405" ] || die "POST to the public URL returned $c, expected 405."
ok "public POST 405 — read-only holds in production"
for h in "${NEIGHBOURS[@]}"; do
  c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$h/" || echo 000)"
  case "$c" in 2*|3*|401|403) ok "$h still $c" ;; *) die "$h returned $c after TLS work." ;; esac
done

# ---------------------------------------------------------------------
say "Phase 10 — final preflight and untouched-state proof"
bash projects/mythos-os-console/tools/host-preflight.sh || die "post-deploy preflight reported a blocking item."

RM_AFTER="$(sha256sum "$GUARD_ROADMAP" 2>/dev/null | awk '{print $1}' || echo absent)"
SY_AFTER="$(git status --porcelain -- projects/ssangyong-autos/ 2>/dev/null | sha256sum | awk '{print $1}')"
[ "$RM_BEFORE" = "$RM_AFTER" ] || die "roadmap-state.json CHANGED during this run. Investigate before proceeding."
ok "roadmap-state.json byte-identical to the start of this run"
[ "$SY_BEFORE" = "$SY_AFTER" ] || die "the SSANGYONG tree changed during this run."
ok "SSANGYONG tree unchanged"

printf '\n\033[32mDEPLOYED.\033[0m https://%s is live and read-only.\n' "$DOMAIN"
printf 'HEAD %s\n' "$(git rev-parse HEAD)"
printf 'Rollback: systemctl --user disable --now mythos-os-console\n'
printf '          rm %s && sudo nginx -t && sudo systemctl reload nginx\n' "$VHOST_ENABLED"
