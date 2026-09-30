#!/usr/bin/env bash
# =====================================================
# MYTHOS HADDAD — telemetry agent setup (idempotent, no root)
# projects/mythos-haddad/bin/haddad-telemetry-setup.sh
#
# Installs the heartbeat that makes Haddad visible in the Status Center.
# Four user-level files, all in this user's home, no sudo, no port:
#
#   ~/.config/mythos-haddad/telemetry.env       endpoint + node id, 0600, NO secret
#   ~/.config/mythos-haddad/telemetry-key.pem   Ed25519 PRIVATE key, 0600,
#                                               generated HERE and never transmitted
#   ~/.config/systemd/user/mythos-haddad-telemetry.service
#   ~/.config/systemd/user/mythos-haddad-telemetry.timer
#
# The VPS is given only the PUBLIC half, which this script prints. Nothing
# secret ever crosses the wire or a transcript, and nothing on the VPS can
# be used to impersonate this node.
#
# It starts nothing by itself unless --enable is passed: printing the
# public key first, registering it on the VPS, and only then enabling the
# timer, is the order that avoids a stream of refused beats.
#
#   haddad-telemetry-setup.sh              configure + print the public key
#   haddad-telemetry-setup.sh --enable     also enable and start the timer
#   haddad-telemetry-setup.sh --print-key  print the public key and exit
#
# Rollback:
#   systemctl --user disable --now mythos-haddad-telemetry.timer
#   rm ~/.config/systemd/user/mythos-haddad-telemetry.{service,timer}
#   rm ~/.config/mythos-haddad/telemetry.env ~/.config/mythos-haddad/telemetry-key.pem
#   (and remove this node from the VPS registry — see
#    projects/status-center/haddad/README.md)
# =====================================================
set -euo pipefail

HADDAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The checkout the INSTALLED unit will run from, forever, long after this
# shell exits. Resolution order is deliberate:
#
#   1. HADDAD_TELEMETRY_REPO — an explicit, considered operator choice
#   2. this script's own tree — so a normal run needs no environment at all
#
# HADDAD_MCP_REPO is NOT consulted and must never be. It already means the
# MCP launcher's checkout on this host, it is routinely exported while
# re-pointing that launcher, and borrowing it here would let one setup
# silently redirect the other — installing a telemetry unit pinned to
# whatever tree the MCP work happened to be using.
REPO_EXPLICIT="${HADDAD_TELEMETRY_REPO:-}"
REPO="${REPO_EXPLICIT:-$(cd "$HADDAD_DIR/../.." && pwd)}"
CONFIG_DIR="${HADDAD_TELEMETRY_CONFIG_DIR:-$HOME/.config/mythos-haddad}"
UNIT_DIR="${HADDAD_TELEMETRY_UNIT_DIR:-$HOME/.config/systemd/user}"
KEY_FILE="$CONFIG_DIR/telemetry-key.pem"
ENV_FILE="$CONFIG_DIR/telemetry.env"
NODE_ID="${HADDAD_TELEMETRY_NODE:-haddad}"
ENDPOINT="${HADDAD_TELEMETRY_ENDPOINT:-https://status.mythosprod.xyz/ingest}"

say() { printf '[haddad-telemetry-setup] %s\n' "$*"; }
die() { printf '[haddad-telemetry-setup] FAILED: %s\n' "$*" >&2; exit 1; }

print_key() {
  [ -f "$KEY_FILE" ] || die "no key yet at $KEY_FILE — run the setup without --print-key first"
  node -e '
    var crypto = require("crypto"), fs = require("fs");
    var k = crypto.createPrivateKey(fs.readFileSync(process.argv[1], "utf8"));
    var pub = crypto.createPublicKey(k).export({ format: "der", type: "spki" });
    process.stdout.write(pub.toString("base64") + "\n");
  ' "$KEY_FILE"
}

if [ "${1:-}" = "--print-key" ]; then print_key; exit 0; fi

command -v node >/dev/null || die "node is required"
command -v systemctl >/dev/null || die "systemctl is required"

# The unit runs the agent from REPO, not from this script's tree. Validate
# the file the UNIT will execute — checking a different copy and then
# installing this one is how a setup reports success for something that
# cannot start.
UNIT_AGENT="$REPO/projects/mythos-haddad/bin/haddad-telemetry.js"
case "$REPO" in
  /*) : ;;
  *) die "the repository path must be absolute, got: $REPO" ;;
esac
[ -f "$UNIT_AGENT" ] || die "agent missing at the path the unit would run: $UNIT_AGENT (wrong checkout? set HADDAD_TELEMETRY_REPO)"
node --check "$UNIT_AGENT" || die "the agent at $UNIT_AGENT does not parse"

# A LINKED GIT WORKTREE IS NOT A DEPLOYMENT TARGET. In a linked worktree
# `.git` is a FILE pointing into the parent repository; in a primary
# checkout it is a directory. Worktrees here are created and removed
# routinely (the MCP launcher was pinned to one until it was re-pointed),
# so a unit installed against one dies silently the day it is removed —
# the timer keeps firing and every beat fails to start.
#
# Refused rather than warned, because the failure is invisible until the
# console has been dark long enough for someone to notice. An operator who
# genuinely means it says so with HADDAD_TELEMETRY_REPO.
if [ -z "$REPO_EXPLICIT" ] && [ -f "$REPO/.git" ]; then
  die "$REPO is a linked git worktree, which is temporary by nature and must not be pinned into a systemd unit.
    Run this from the production checkout, or set HADDAD_TELEMETRY_REPO=<path> deliberately if you really mean this tree."
fi

say "1/5 directories"
mkdir -p "$CONFIG_DIR" "$UNIT_DIR"
chmod 700 "$CONFIG_DIR" 2>/dev/null || true

say "2/5 signing key"
if [ -f "$KEY_FILE" ]; then
  say "    key already present — kept (rotating it would orphan the VPS registration)"
else
  # Generated on this machine. The private half never leaves it.
  node -e '
    var crypto = require("crypto"), fs = require("fs");
    var kp = crypto.generateKeyPairSync("ed25519");
    fs.writeFileSync(process.argv[1], kp.privateKey.export({ format: "pem", type: "pkcs8" }), { mode: 0o600 });
  ' "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  say "    generated a new Ed25519 key at $KEY_FILE (0600)"
fi

say "3/5 configuration (no secret in this file)"
umask 077
cat > "$ENV_FILE" <<EOF
# MYTHOS HADDAD telemetry — generated by haddad-telemetry-setup.sh
# Contains NO secret: the private key lives in its own 0600 file and is
# named here only by path.
HADDAD_TELEMETRY_NODE=$NODE_ID
HADDAD_TELEMETRY_ENDPOINT=$ENDPOINT
HADDAD_TELEMETRY_KEY_FILE=$KEY_FILE
HADDAD_TELEMETRY_TIMEOUT_MS=8000
EOF
chmod 600 "$ENV_FILE"

say "4/5 systemd user units"
for u in mythos-haddad-telemetry.service mythos-haddad-telemetry.timer; do
  sed "s#%h/projects/mythos-prod#$REPO#g" "$HADDAD_DIR/systemd/$u" > "$UNIT_DIR/$u"
done
# Say what got baked in. The one number an operator needs to sanity-check
# after this runs is the path the service will execute, so it is printed
# rather than left to `systemctl cat`.
say "    ExecStart pinned to $REPO"
grep -q "$UNIT_AGENT" "$UNIT_DIR/mythos-haddad-telemetry.service" ||
  die "the generated unit does not point at $UNIT_AGENT — refusing to leave a unit that would not start"
systemctl --user daemon-reload

say "5/5 one real collection (dry run — sends nothing)"
# Deliberately the UNIT's copy, with the unit's own repo resolution, so
# "collection OK" is a statement about what will actually run.
HADDAD_TELEMETRY_REPO="$REPO" node "$UNIT_AGENT" --dry-run > /dev/null || die "the agent could not collect this node's state"
say "    collection OK (ran $UNIT_AGENT)"

echo
say "PUBLIC KEY for node '$NODE_ID' — register this on the VPS, it is not a secret:"
echo
printf '  %s\n' "$(print_key)"
echo
say "On the VPS: add it to projects/status-center/haddad/nodes.json and reload nothing"
say "(the receiver re-reads the registry on every request)."
echo

if [ "${1:-}" = "--enable" ]; then
  say "enabling the timer (10 s heartbeat)"
  systemctl --user enable --now mythos-haddad-telemetry.timer
  systemctl --user list-timers mythos-haddad-telemetry.timer --no-pager || true
  say "ENABLED. Beats that the VPS has not yet registered are refused with HTTP 401 —"
  say "that is expected until the public key above is registered."
else
  say "NOT enabled. After registering the key on the VPS, run:"
  say "  systemctl --user enable --now mythos-haddad-telemetry.timer"
fi
