# Proposed sudo restriction for the Mythos session user

**Status: PROPOSAL. Nothing here has been applied.** Sudo configuration is
unchanged on the host.

## The problem

The governance delivery invariant rests on one property: an interactive Claude
session (running as `ubuntu`) cannot read the signing key or alter the
installed verifier. File permissions already enforce that —
`/etc/mythos/governance.key` is `root:deploy 0640`, the approval store is
`root:deploy 0750`, and the verifier is `root:root 0644` — and all three are
verified unreadable/unwritable by `ubuntu` in the test suite.

Sudo defeats all of it. Two files grant the session user blanket root:

| File | Rule |
|---|---|
| `/etc/sudoers.d/90-cloud-init-users` | `ubuntu ALL=(ALL) NOPASSWD:ALL` |
| `/etc/sudoers.d/99-claude-desktop` | `ubuntu ALL=(ALL:ALL) NOPASSWD: ALL` |

Both must be addressed; removing one leaves the other.

**A command blocklist cannot work.** Today's own sudo log shows `install -o`,
`cp`, `sh -c`, `env`, and `docker exec` in routine use — every one of those is
root-equivalent and can read the key or overwrite the verifier. Any allowlist
containing a general-purpose file copier, an interpreter, or `docker` is
equivalent to blanket root. So the restriction has to be an allowlist of
narrow, specific commands, and the interesting question is what the session
genuinely needs.

Note that `mythos-ai-executor` is a **user** unit — `systemctl --user` needs no
sudo at all. The real sudo surface is small.

## Minimum safe change

### 1. Remove the blanket grants

```
sudo rm /etc/sudoers.d/99-claude-desktop
sudo sed -i 's/^ubuntu ALL=(ALL) NOPASSWD:ALL$/# removed: replaced by 50-mythos-session/' /etc/sudoers.d/90-cloud-init-users
```

### 2. Add the scoped grant

`/etc/sudoers.d/50-mythos-session`, mode `0440 root:root`, validated with
`visudo -c -f` **before** the blanket grants are removed:

```sudoers
# Mythos session user — scoped root.
#
# Blanket NOPASSWD:ALL is removed so an interactive Claude session cannot read
# /etc/mythos/governance.key or overwrite /usr/local/lib/mythos/governance-verify.js.
# Everything below is chosen to contain no file copier, no interpreter, no
# editor and no container runtime — each of which would be equivalent to
# restoring blanket root.

# Mythos system units only. NOT `systemctl edit` (spawns an editor → shell),
# NOT a bare `systemctl` wildcard.
Cmnd_Alias MYTHOS_UNIT_CTL = \
    /usr/bin/systemctl start mythos-git-push.service, \
    /usr/bin/systemctl start mythos-git-push.timer, \
    /usr/bin/systemctl stop mythos-git-push.timer, \
    /usr/bin/systemctl enable mythos-git-push.timer, \
    /usr/bin/systemctl disable mythos-git-push.timer, \
    /usr/bin/systemctl is-active mythos-git-push.timer, \
    /usr/bin/systemctl is-enabled mythos-git-push.timer, \
    /usr/bin/systemctl status mythos-git-push.service, \
    /usr/bin/systemctl daemon-reload

# Read-only observability through a fixed-argument wrapper, because
# `journalctl` with a pager can spawn a shell.
Cmnd_Alias MYTHOS_OBSERVE = /usr/local/sbin/mythos-logs

ubuntu ALL=(root) NOPASSWD: MYTHOS_UNIT_CTL, MYTHOS_OBSERVE
```

### 3. Add the read-only log wrapper

`/usr/local/sbin/mythos-logs`, `root:root 0755` — fixed arguments, no pager,
no user-supplied unit:

```bash
#!/usr/bin/env bash
# Read-only Mythos observability for the session user. Fixed arguments so no
# pager can be spawned and no arbitrary unit can be read.
set -euo pipefail
case "${1:-relay}" in
  relay)    exec journalctl --no-pager -n "${2:-50}" -u mythos-git-push.service ;;
  denials)  exec cat /var/lib/mythos/governance/log/denied.log ;;
  approvals) exec /usr/local/bin/mythos-governance-approve --list ;;
  *) echo "usage: mythos-logs [relay [n] | denials | approvals]" >&2; exit 2 ;;
esac
```

### 4. Deliberately NOT granted

| Excluded | Why |
|---|---|
| `docker` | `docker run -v /etc:/host` reads the key. Container runtime access is root access. |
| `install`, `cp`, `tee`, `dd`, `sed -i` | Overwrite the installed verifier. |
| `sh`, `bash`, `node`, `python`, `env` | Arbitrary code as root. |
| `systemctl edit`, `visudo`, any editor | Editor shell escape. |
| `cat`, `less`, `head` on arbitrary paths | Reads the key directly. |
| `mythos-governance-approve` | **The session must never be able to run the approval tool at all.** It is the owner's command, invoked from a human shell. |

## Consequence to accept

**n8n management stops being available to the session.** Today sessions run
`sudo docker exec n8n-n8n-1 n8n …`, and keeping that is equivalent to keeping
blanket root. Two honest options:

- **(a) Accept it** — the owner performs n8n changes; sessions read state
  through the API instead. Recommended: n8n work is rare and deliberate.
- **(b) Add a fixed-argument wrapper** `/usr/local/sbin/mythos-n8n` allowing
  only `n8n list:workflow`, `n8n update:workflow --id=<id> --active=<bool>` and
  `n8n import:workflow --input=<path under a fixed dir>`, with the id matched
  against a literal allowlist. More work, keeps the capability, still shuts the
  mount escape.

## The change that removes the problem instead of containing it

Everything above is host configuration, and host configuration is only as good
as the next person with root. The structural fix is to **make the signing key
absent from this host**:

Replace the HMAC key with an **ed25519 keypair**. The public key lives at
`/etc/mythos/governance.pub` (world-readable — verification needs no secret);
the private key never exists on the VPS. The owner signs an approval on their
own machine and copies the signed record into the store. Then no amount of
host root — sudo, docker, a compromised session, or a future me — can mint an
approval, because the secret is not here to steal.

`governance-verify.js` would change only in `signatureValid()`:
`crypto.verify(null, canonicalPayload, publicKey, sigBuffer)`. The store,
binding, fail-closed behaviour and DENY + RECORD + CONTINUE all stay as they
are.

Recommended sequence: apply the sudo scoping now as containment, then move to
asymmetric signing so the containment stops being load-bearing.

## Verification after applying (do not skip)

```bash
sudo visudo -c                      # config parses BEFORE logging out
sudo -l -U ubuntu                   # exactly the scoped list, nothing more
sudo cat /etc/mythos/governance.key  # must fail
node tests/mythos-governance-invariant-test.js   # isolation assertions
```

Keep one root shell open while applying, so a mistake in `sudoers` cannot lock
the host out.
