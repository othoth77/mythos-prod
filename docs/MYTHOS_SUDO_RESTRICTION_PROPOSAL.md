# Proposed sudo restriction for the Mythos session user

**Status: PROPOSAL. Nothing here has been applied.** Sudo is unchanged.

## Current state

Two files grant the interactive session user blanket root:

| File | Rule |
|---|---|
| `/etc/sudoers.d/90-cloud-init-users` | `ubuntu ALL=(ALL) NOPASSWD:ALL` |
| `/etc/sudoers.d/99-claude-desktop` | `ubuntu ALL=(ALL:ALL) NOPASSWD: ALL` |

Both must be addressed; removing one leaves the other. Every prohibited
capability is reachable today:

| Must be prevented | Reachable today via |
|---|---|
| read `governance.key` | `sudo cat /etc/mythos/governance.key` |
| write the governance verifier | `sudo install`/`cp`/`tee` → `/usr/local/lib/mythos/` |
| install root binaries | `sudo install -o root … /usr/local/bin/` |
| modify systemd units/timers | `sudo sed -i /etc/systemd/system/…`, `systemctl edit` |
| restart governance infrastructure | `sudo systemctl start mythos-git-push.*` |
| arbitrary root shell/interpreter | `sudo sh -c`, `sudo node -e`, `sudo env …` |
| docker as a root escape | `sudo docker run -v /etc:/host` |

**A blocklist cannot work.** Today's sudo log shows `install -o`, `cp`, `sh -c`,
`env` and `docker exec` in routine use. Any allowlist containing a file
copier, an interpreter, an editor, or a container runtime is equivalent to
restoring blanket root.

## The proposed change

Because *restarting governance infrastructure* and *modifying units* are both
prohibited, almost nothing mutating remains legitimate. The session's sudo
surface reduces to **read-only observability**.

### 1. Remove the blanket grants

```bash
sudo rm /etc/sudoers.d/99-claude-desktop
sudo cp /etc/sudoers.d/90-cloud-init-users /root/90-cloud-init-users.bak
sudo sed -i 's|^ubuntu ALL=(ALL) NOPASSWD:ALL$|# ubuntu blanket root removed — see /etc/sudoers.d/50-mythos-session|' /etc/sudoers.d/90-cloud-init-users
```

### 2. `/etc/sudoers.d/50-mythos-session` — `root:root 0440`

```sudoers
# Mythos session user — read-only root, nothing more.
#
# The governance delivery invariant depends on this user being unable to read
# /etc/mythos/governance.key or alter /usr/local/lib/mythos/governance-verify.js.
# File permissions already enforce that; blanket sudo defeated it.
#
# Contains NO file copier, NO interpreter, NO editor, NO container runtime and
# NO service control — each would be equivalent to blanket root, and service
# control is itself prohibited for this user.

Cmnd_Alias MYTHOS_OBSERVE = /usr/local/sbin/mythos-logs

ubuntu ALL=(root) NOPASSWD: MYTHOS_OBSERVE
```

### 3. `/usr/local/sbin/mythos-logs` — `root:root 0755`

Fixed arguments only: no user-supplied unit, no user-supplied path, no pager
(a pager can spawn a shell).

```bash
#!/usr/bin/env bash
set -euo pipefail
case "${1:-relay}" in
  relay)     exec journalctl --no-pager -n "${2:-50}" -u mythos-git-push.service ;;
  executor)  exec journalctl --no-pager -n "${2:-50}" --user-unit mythos-ai-executor ;;
  denials)   exec cat /var/lib/mythos/governance/log/denied.log ;;
  approvals) exec /usr/local/bin/mythos-governance-approve --list ;;
  status)    exec systemctl is-active mythos-git-push.timer ;;
  *) echo "usage: mythos-logs [relay|executor [n]|denials|approvals|status]" >&2; exit 2 ;;
esac
```

`--list` is read-only; the approval tool still refuses to *create* anything
unless invoked directly as root, and the session cannot invoke it directly.

## What still works without sudo — normal development is not broken

| Activity | Needs sudo? |
|---|---|
| `git`, editing the repo, `node tests/*.js` | no |
| **Executor start/stop/restart** (`systemctl --user`) | **no — it is a user unit** |
| Campaign control via the executor HTTP API | no |
| Reading orchestration state, worktrees, event log | no |
| Committing; local mission branches | no |

The campaign, the executor and the whole autonomous loop therefore remain
fully operable by a session **without any root at all**.

## What the session loses (deliberate)

| Lost | Who does it instead |
|---|---|
| `sudo systemctl start mythos-git-push.service` (delivery) | Owner, from a human shell |
| Enabling/disabling the relay timer | Owner |
| Installing/updating root binaries and the verifier | Owner |
| `sudo docker exec n8n-n8n-1 …` (n8n management) | Owner |

**n8n management is the one real cost.** Keeping `sudo docker` keeps blanket
root, so it cannot stay as-is. If it must be retained, add a fixed-argument
wrapper allowing only `n8n list:workflow`, `n8n update:workflow --id=<id from
a literal allowlist> --active=<true|false>` and `n8n import:workflow
--input=<path under one fixed directory>` — never a bare `docker exec`, never
`docker run`, never `-v`.

## Verification after applying

```bash
sudo visudo -c                                   # parses, BEFORE logging out
sudo -l -U ubuntu                                # exactly mythos-logs, nothing else
sudo cat /etc/mythos/governance.key              # must fail
sudo install -m0644 /dev/null /usr/local/lib/mythos/x   # must fail
node tests/mythos-governance-invariant-test.js   # isolation assertions still pass
```

Keep a second root shell open while applying, so a sudoers mistake cannot lock
the host out.

---

# Asymmetric approval design (Phase 4 — evaluation only)

## Verdict: NOT already supported. Do not implement yet.

Verification is a one-function change; **signing is not**. Today
`mythos-governance-approve` signs on the host with the shared HMAC key, which
is exactly the thing being removed. Moving to asymmetric approval needs new
owner-side tooling and a new import path, so it is a deliberate stage, not a
refactor.

## Why it is worth doing

Every protection above is host configuration, and host configuration is only
as good as the next person with root. If the secret is not on the VPS, no
amount of host root — sudo, docker, a compromised session, a future agent —
can mint an approval.

## Design

```
owner's machine                     VPS
───────────────                     ───
ed25519 PRIVATE key   ──signs──►    approval JSON + signature
(never leaves)                      stored in /var/lib/mythos/governance/approvals
                                    verified against /etc/mythos/governance.pub
                                    (world-readable — verification needs no secret)
                                            │
                                            ▼
                                    relay delivers, or DENY + RECORD + CONTINUE
```

Changes required:

1. **`governance-verify.js`** — `signatureValid()` becomes
   `crypto.verify(null, Buffer.from(canonicalPayload(a)), publicKey, Buffer.from(a.sig,'base64'))`.
   Canonical payload, commit binding, path coverage, fail-closed and
   DENY + RECORD + CONTINUE are all unchanged. `sign()` is deleted from the
   host entirely.
2. **New owner-side signer** (runs on the owner's machine, not here): takes a
   commit sha and its protected paths, produces the signed JSON.
3. **New import path on the VPS** — `mythos-governance-approve --import <file>`
   which only *verifies and stores* a signed record. It can no longer create
   one, so it no longer needs to be root-only for secrecy, only for store
   write access.
4. **Key handling** — `/etc/mythos/governance.pub` world-readable; delete
   `/etc/mythos/governance.key` once migrated. Keep a documented rotation
   procedure.

Migration is safe: verification can accept both formats during a transition
window, then HMAC support is removed.

**Cost:** the owner must be at their signing machine to approve a governance
change. That is the intended property, not a drawback.

## Recommended sequence

1. Apply the sudo scoping (containment, reversible, minutes).
2. Then move to asymmetric signing, so the containment stops being
   load-bearing.
