# Mythos OS Console — deploy relay operator runbook

Stage: MOS-v2 M-02. Scope: two root-installable systemd oneshot units that
let an authorized non-`deploy` session (e.g. `ubuntu`) trigger
`deploy`-owned console operations without ever holding `deploy`'s
credentials — mirroring `projects/mythos-ai-executor/service/mythos-git-push.service`,
which already solves this exact class of problem for git delivery.

## ⚠ Do not use until M-01 is deployed

**M-01 — the Mythos OS Console's own first deployment — must already be
live before either relay unit is installed or started.** Both units only
operate on an *existing* deployment:

- `mythos-os-console-restart` restarts an already-installed
  `mythos-os-console` systemd `--user` service. If that unit does not
  exist yet, it fails immediately with `Unit mythos-os-console.service not
  found` — the safe, expected failure, not something to work around.
- `mythos-os-console-deploy` re-runs `tools/deploy.sh`, which is safe to
  repeat only because every phase re-checks its own prior result. Its
  first-ever run still needs a human at an interactive terminal for two
  one-time steps: Phase 2 (token entry) and Phase 8 (the real-certificate
  request). Until those have happened once, interactively, as documented
  in `tools/deploy.sh`'s own header, this relay has nothing to safely
  automate.

If you are not certain M-01 is live, stop here and verify first (see
**Verify**, below, which works without either relay installed).

## What this is not

- Not a general-purpose root shell. Each unit has one fixed `ExecStart`,
  no arguments, no flags. An authorized session can only `systemctl
  start` a named unit — it cannot pass it a command.
- Not a credential store or credential path. Neither script reads,
  prints, or forwards the console's executor token, an SSH key, or any
  other secret. `mythos-os-console-restart` touches no file at all;
  `mythos-os-console-deploy` runs `tools/deploy.sh`, which already
  refuses to run with `set -x` (would leak the token) and never echoes
  it.
- Not a new grant of privilege. `deploy`'s sudo grant (`nginx -t`,
  `systemctl reload nginx`, `certbot` — exactly three commands) already
  exists independent of this relay. These units let an authorized session
  trigger deploy's *existing* authority; they do not widen it.

## Install

Run as root, on the real host, one time per unit:

```bash
# Restart relay
cp projects/mythos-os-console/deploy/relay/mythos-os-console-restart.sh \
  /usr/local/bin/mythos-os-console-restart
chown root:root /usr/local/bin/mythos-os-console-restart
chmod 0755 /usr/local/bin/mythos-os-console-restart
cp projects/mythos-os-console/deploy/relay/mythos-os-console-restart.service \
  /etc/systemd/system/

# Phase-8 deployment relay
cp projects/mythos-os-console/deploy/relay/mythos-os-console-deploy.sh \
  /usr/local/bin/mythos-os-console-deploy
chown root:root /usr/local/bin/mythos-os-console-deploy
chmod 0755 /usr/local/bin/mythos-os-console-deploy
cp projects/mythos-os-console/deploy/relay/mythos-os-console-deploy.service \
  /etc/systemd/system/

systemctl daemon-reload
```

Both `ExecStart` paths point at these root-owned `/usr/local/bin` copies,
not at the repository checkout — the checkout is writable by `ubuntu`, so
code that runs as `deploy` must not be editable by a less-privileged user.
Re-copy after any change to either `.sh` file in this directory; systemd
reads the installed copy, not the repo.

Confirm the units are known and not enabled to run on their own (they are
`Type=oneshot` with no `[Install]` section — nothing starts them except an
explicit `systemctl start`):

```bash
systemctl status mythos-os-console-restart.service --no-pager
systemctl status mythos-os-console-deploy.service --no-pager
```

## Execute

Run as any session with permission to talk to systemd (typically root, or
`sudo systemctl start`; the unit itself switches to `deploy` internally —
no `deploy` credential is needed by the caller):

```bash
# Restart the running console service
systemctl start mythos-os-console-restart.service

# Re-run the full deploy.sh (idempotent; needs M-01 already live)
systemctl start mythos-os-console-deploy.service
```

Both are foreground-blocking `oneshot` units: `systemctl start` returns
once the run finishes (success or failure), reflected in the unit's exit
status.

## Verify

Independent of which relay ran, confirm the console itself:

```bash
# Unit state and recent log
systemctl --user -M deploy@ status mythos-os-console --no-pager   # or, as deploy: systemctl --user status mythos-os-console
journalctl --user -u mythos-os-console -n 30 --no-pager           # as deploy

# Relay unit's own last result
systemctl status mythos-os-console-restart.service --no-pager
systemctl status mythos-os-console-deploy.service --no-pager

# Loopback health (unprivileged, works from any session on the host)
curl -fsS http://127.0.0.1:8140/api/health

# Public (only meaningful once nginx + TLS are live)
curl -fsS https://os.mythosprod.xyz/api/health
```

Expect `"ok":true` and `"token_provisioned":true` from `/api/health`. A
non-zero exit from `systemctl start ...relay.service` means the relay
itself refused or the underlying command failed — read the unit's log
(`journalctl -u mythos-os-console-restart.service` /
`...-deploy.service`) before retrying; do not retry blindly.

## Rollback

Neither relay unit changes deployed state itself beyond what it's scoped
to (a restart, or a deploy.sh re-run) — there is nothing relay-specific to
undo. To back out:

**Undo a restart:** none needed. `systemctl restart` does not change
configuration; if the service is unhealthy after a restart, the fault
predates the restart (bad code on `main`, bad env file, etc.) and the fix
is the normal one for that, not a relay rollback.

**Undo a deploy.sh run:** use the rollback `tools/deploy.sh` itself
prints on success, or the standard console rollback recorded in
`docs/MYTHOS_OS_CONSOLE_ARCHITECTURE.md` §10.2:

```bash
# As deploy:
systemctl --user disable --now mythos-os-console

# As root, only if the nginx vhost needs to come back out:
rm /etc/nginx/sites-enabled/os.mythosprod.xyz
sudo nginx -t && sudo systemctl reload nginx
```

**Remove the relay units entirely** (root):

```bash
systemctl disable --now mythos-os-console-restart.service 2>/dev/null || true
systemctl disable --now mythos-os-console-deploy.service 2>/dev/null || true
rm /etc/systemd/system/mythos-os-console-restart.service \
   /etc/systemd/system/mythos-os-console-deploy.service
rm /usr/local/bin/mythos-os-console-restart /usr/local/bin/mythos-os-console-deploy
systemctl daemon-reload
```

## Files in this directory

| File | Purpose |
|---|---|
| `mythos-os-console-restart.sh` | Script installed to `/usr/local/bin`; restarts the console's `--user` service only |
| `mythos-os-console-restart.service` | System unit, `User=deploy`, triggers the script above |
| `mythos-os-console-deploy.sh` | Script installed to `/usr/local/bin`; runs `tools/deploy.sh` unmodified, no flags |
| `mythos-os-console-deploy.service` | System unit, `User=deploy`, triggers the script above |
| `RUNBOOK.md` | This file |

No host action was taken to produce these files — installation, execution,
and verification above are operator steps, not something this stage
performed.
