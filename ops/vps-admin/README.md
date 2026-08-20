# Mythos VPS — permanent administration model (`ops/vps-admin/`)

This directory is the **source of truth** for how the Mythos VPS
(`51.68.226.211`, OVH) is administered. The files here are installed onto the
host; the host copies are downstream of these.

## Why this exists

VPS access kept breaking because there was no stable, least-privilege admin
path: `ubuntu` was scoped down to read-only observability (correctly — see
`docs/MYTHOS_SUDO_RESTRICTION_PROPOSAL.md`), direct root SSH is disabled, and
recovery kept falling back to the OVH KVM console. This establishes one
documented path instead:

```
SSH  →  mythosadmin  →  sudo  →  mythos-deploy
```

## Files

| File | Installed to | Owner/mode | Purpose |
|---|---|---|---|
| `mythos-deploy` | `/usr/local/sbin/mythos-deploy` | `root:root 0755` | The single audited deployment tool. |
| `50-mythosadmin` | `/etc/sudoers.d/50-mythosadmin` | `root:root 0440` | Controlled sudo for `mythosadmin`. |
| `root-hook.sh` | run once as root | — | Idempotent bootstrap: creates the account, installs the key, tool and sudoers. |

## The administrator account — `mythosadmin`

- Dedicated login, **key-only** (password locked with `passwd -l`).
- Member of **no** privileged group — not `sudo`, not `docker`, not `deploy`.
- Its private key lives only on the owner's workstation
  (`~/.ssh/mythosadmin_ed25519`); the host holds the public key.
- SSH config was **not** weakened: password auth stays off, root SSH stays
  `prohibit-password`, no `sshd_config` file was edited.

## Controlled sudo (`50-mythosadmin`)

`mythosadmin` may run **only** these as root, with **no** file-copier,
interpreter, editor, container runtime, or arbitrary `systemctl`/unit control
— each of which would be equivalent to blanket root and would defeat the
governance boundary (`/etc/mythos/governance.key` stays unreadable to it):

- `/usr/local/sbin/mythos-deploy` (the audited tool)
- `nginx -t`, `systemctl reload|status|is-active nginx`
- `certbot`
- `/usr/local/sbin/mythos-logs` (read-only observability)

This mirrors, for a dedicated admin, the exact trust `deploy` already held.

## The deployment tool — `mythos-deploy`

Ownership of `/home/deploy/projects/mythos-prod` stays with **`deploy`**; the
tool runs all git operations *as* `deploy` (`runuser -u deploy`) and never
writes into the repo as root. Targets are resolved from a **fixed registry**
(`os`, `panel`, `ordre`, `tv`; `status` is PROTECTED and refused). Unrelated
production sites (DarHijama, fixpert, ssangyong, notrejour, …) are never
referenced and cannot be affected.

```
sudo mythos-deploy list                 # manageable targets
sudo mythos-deploy status [target|all]  # health (read-only)
sudo mythos-deploy preflight <target>   # validate git + nginx (read-only)
sudo mythos-deploy reload               # nginx -t + graceful reload (idempotent, safe)
sudo mythos-deploy deploy <target> [ref]# git → nginx -t → reload → health → rollback-on-fail
sudo mythos-deploy rollback <target>    # restore last known-good revision
sudo mythos-deploy cert <target>        # issue/renew TLS for the target's domain
```

Guarantees: idempotent; validates git state and refuses on a dirty tree;
validates nginx config **before** any reload; uses graceful reload so unrelated
sites keep serving; records a rollback point and **automatically rolls back** if
the post-deploy health check fails; reports failure explicitly and **never
prints success unless the health check passed**. Actions are appended to
`/var/log/mythos-deploy.log`.

## Bootstrap / re-provisioning

The bootstrap is idempotent — safe to re-run to repair drift.

1. Seed the staging dir (as `deploy`), from this repo:
   ```bash
   mkdir -p /tmp/mythos-bootstrap
   cp ops/vps-admin/mythos-deploy ops/vps-admin/50-mythosadmin ops/vps-admin/root-hook.sh /tmp/mythos-bootstrap/
   cp ~/mythosadmin.pub /tmp/mythos-bootstrap/mythosadmin.pub   # owner's mythosadmin public key
   ```
2. Run the bootstrap **once as root** (OVH KVM console, or any root shell):
   ```bash
   bash /tmp/mythos-bootstrap/root-hook.sh
   cat /tmp/mythos-bootstrap/result.txt
   ```
3. Verify from the owner workstation:
   ```bash
   ssh -i ~/.ssh/mythosadmin_ed25519 mythosadmin@51.68.226.211 'sudo mythos-deploy status all'
   ```

See `docs/AI_HANDOVER.md` → "Permanent VPS administration model" for the full
runbook including rollback and emergency KVM recovery.
