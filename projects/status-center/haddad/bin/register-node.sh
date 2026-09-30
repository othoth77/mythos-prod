#!/usr/bin/env bash
# =====================================================================
# MYTHOS HADDAD — register (or re-key, or disable) an AI node
# projects/status-center/haddad/bin/register-node.sh
#
# A node is INVISIBLE to the Status Center until its public key is here.
# That is the whole access-control story: no shared secret, no password,
# no inbound path to the node. The key is public — the private half was
# generated on the node and never leaves it.
#
#   sudo bash register-node.sh <id> <base64-public-key> [display name]
#   sudo bash register-node.sh --disable <id>
#   sudo bash register-node.sh --list
#
# The receiver re-reads the registry on every request, so nothing needs a
# restart and no beat is lost.
# =====================================================================
set -euo pipefail

NODES_FILE="${MYTHOS_HADDAD_NODES_FILE:-/etc/mythos/haddad-nodes.json}"
fail() { printf 'FAILED: %s\n' "$*" >&2; exit 1; }

[ -f "${NODES_FILE}" ] || fail "registry not found: ${NODES_FILE} (run install.sh first)"

if [ "${1:-}" = "--list" ]; then
  node -e '
    var d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    (d.nodes || []).forEach(function (n) {
      console.log([n.id, n.enabled === false ? "DISABLED" : "enabled", n.name || "",
        "key:" + String(n.public_key || "").slice(0, 12) + "..."].join("  "));
    });
    if (!(d.nodes || []).length) console.log("(no nodes registered)");
  ' "${NODES_FILE}"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || fail "must run as root (the registry is root-owned)"

if [ "${1:-}" = "--disable" ]; then
  ID="${2:?usage: register-node.sh --disable <id>}"
  node -e '
    var fs = require("fs"), f = process.argv[1], id = process.argv[2];
    var d = JSON.parse(fs.readFileSync(f, "utf8"));
    var hit = (d.nodes || []).filter(function (n) { return n.id === id; })[0];
    if (!hit) { console.error("no such node: " + id); process.exit(1); }
    hit.enabled = false;
    fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2) + "\n", { mode: 0o644 });
    fs.renameSync(f + ".tmp", f);
    console.log("disabled: " + id + " — its beats are refused from the next request on");
  ' "${NODES_FILE}" "${ID}"
  exit 0
fi

ID="${1:?usage: register-node.sh <id> <base64-public-key> [display name]}"
KEY="${2:?usage: register-node.sh <id> <base64-public-key> [display name]}"
NAME="${3:-}"

node -e '
  var fs = require("fs"), crypto = require("crypto");
  var f = process.argv[1], id = process.argv[2], key = process.argv[3], name = process.argv[4] || "";

  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) { console.error("invalid node id: " + id); process.exit(1); }

  // Refuse a key the receiver could not use. Registering an unusable key
  // would look like success and then silently refuse every beat.
  var pub;
  try {
    pub = crypto.createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" });
  } catch (e) { console.error("not a usable public key: " + e.message); process.exit(1); }
  if (pub.asymmetricKeyType !== "ed25519") { console.error("key is " + pub.asymmetricKeyType + ", expected ed25519"); process.exit(1); }

  // A private key pasted here by mistake must never be written to a
  // world-readable file.
  if (/PRIVATE KEY/.test(key) || /^MC4CAQAw/.test(key)) { console.error("that looks like a PRIVATE key — only the public half belongs here"); process.exit(1); }

  var d = JSON.parse(fs.readFileSync(f, "utf8"));
  d.nodes = d.nodes || [];
  var hit = d.nodes.filter(function (n) { return n.id === id; })[0];
  var action;
  if (hit) {
    action = hit.public_key === key ? "unchanged" : "re-keyed";
    hit.public_key = key;
    hit.enabled = true;
    if (name) hit.name = name;
  } else {
    action = "registered";
    d.nodes.push({
      id: id,
      name: name || id.toUpperCase(),
      subtitle: "AI COMPUTE NODE",
      enabled: true,
      public_key: key
    });
  }
  fs.writeFileSync(f + ".tmp", JSON.stringify(d, null, 2) + "\n", { mode: 0o644 });
  fs.renameSync(f + ".tmp", f);
  console.log(action + ": " + id + " (ed25519). The receiver picks this up on its next request.");
' "${NODES_FILE}" "${ID}" "${KEY}" "${NAME}"
