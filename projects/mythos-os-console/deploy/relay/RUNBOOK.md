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

M-01 also replaces the console's earlier client-side login-gate
placeholder (`login-gate.js`, a `sessionStorage`-based SHA-256 password
check — never a real credential) with real, server-side authentication:
unauthenticated requests get a login page or a `401`, never application
data. See **Verify** for the exact expected responses, and
**One-time `MOS_CONSOLE_SECRET` setup** for what the operator provisions
before relying on it.

If you are not certain M-01 is live, stop here and verify first (see
**Verify**, below, which works without either relay installed).

## One-time `MOS_CONSOLE_SECRET` setup

Do this once, as `deploy`, on the host, before treating M-01's
authentication as live — and before either relay unit is used against a
console that is supposed to be gated:

1. Generate a new secret. **Do not reuse the old login-gate password (or
   any digest of it).** That value was a client-side placeholder, never
   a real credential, and authorizing anything with it would carry
   forward exactly the weakness M-01 exists to close.

   ```bash
   openssl rand -base64 32
   ```

2. Store it **outside the repository/worktree**, in the same 0600 env
   file `tools/deploy.sh` Phase 2 already uses for `MOS_EXECUTOR_TOKEN`:

   ```
   /home/deploy/deployments/mythos-os-console/.env
   ```

   Add one line: `MOS_CONSOLE_SECRET=<the generated value>`. Confirm the
   file is mode `600`, owned by `deploy`, and not tracked by git — the
   same checks `deploy.sh` Phase 2 already runs for `MOS_EXECUTOR_TOKEN`
   apply here.

3. Restart the console (`mythos-os-console-restart.service`, or a full
   `mythos-os-console-deploy.service` run) so the running process picks
   up the new value from the env file.

Neither relay script in this directory reads, generates, or forwards
`MOS_CONSOLE_SECRET` — provisioning it is entirely an operator action, on
the host, outside git, and outside what this stage performed.

## What this is not

- Not a general-purpose root shell. Each unit has one fixed `ExecStart`,
  no arguments, no flags. An authorized session can only `systemctl
  start` a named unit — it cannot pass it a command.
- Not a credential store or credential path. Neither script reads,
  prints, or forwards the console's executor token, `MOS_CONSOLE_SECRET`,
  an SSH key, or any other secret. `mythos-os-console-restart` touches no
  file at all; `mythos-os-console-deploy` runs `tools/deploy.sh`, which
  already refuses to run with `set -x` (would leak the token) and never
  echoes it.
- Not a new grant of privilege. `deploy`'s sudo grant (`nginx -t`,
  `systemctl reload nginx`, `certbot` — exactly three commands) already
  exists independent of this relay. These units let an authorized session
  trigger deploy's *existing* authority; they do not widen it.

## `deploy`'s systemd --user session environment

Both relay units run as `deploy` via a root-installed *system* unit,
which starts the process under `deploy`'s UID but with no login session —
so `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` are not set by
default, and any `systemctl --user ...` call inside either script would
fail exactly the way `sudo -u deploy systemctl --user ...` did in MOS-1.6
(no path to deploy's own D-Bus session bus). Both `mythos-os-console-restart.sh`
and `mythos-os-console-deploy.sh` (the latter needs it too, because
`tools/deploy.sh` Phase 3 itself calls `systemctl --user daemon-reload` /
`enable --now` / `restart` / `is-active`) export these explicitly before
doing anything else:

```bash
export XDG_RUNTIME_DIR="/run/user/${MYTHOS_DEPLOY_UID:-1001}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${MYTHOS_DEPLOY_UID:-1001}/bus"
```

`1001` is `deploy`'s UID as recorded in `docs/AI_HANDOVER.md` (MOS-1.6:
"`deploy` has linger active (uid 1001)"). Linger is what keeps deploy's
user manager — and this socket — alive with no session logged in;
without it, this environment would point at a bus that does not exist. If
the operator's host ever assigns `deploy` a different UID, override it at
install time by adding `Environment=MYTHOS_DEPLOY_UID=<uid>` to the
relevant `.service` file, rather than editing the script.

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

Independent of which relay ran, confirm the console itself.

```bash
# Unit state and recent log
systemctl --user -M deploy@ status mythos-os-console --no-pager   # or, as deploy: systemctl --user status mythos-os-console
journalctl --user -u mythos-os-console -n 30 --no-pager           # as deploy

# Relay unit's own last result
systemctl status mythos-os-console-restart.service --no-pager
systemctl status mythos-os-console-deploy.service --no-pager
```

**Unauthenticated checks** (no session, no credentials presented — M-01's
real auth, not the old login-gate placeholder). Run these first, on
loopback (`http://127.0.0.1:8140`) before the public domain, and expect
identical results on both:

| Request | Expected |
|---|---|
| `GET /login` | `200` |
| `GET /` | `302` → `/login` |
| `GET /api/health` | `401` |
| `POST /` | `405` |

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8140/login
curl -s -o /dev/null -w '%{http_code} -> %header{location}\n' http://127.0.0.1:8140/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8140/api/health
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8140/
```

A `200` on `/api/health` with no credentials presented, or a `200`/`3xx`
on `/` instead of a `302` to `/login`, means the console is **not**
actually gated — stop and treat that as a real finding, not a pass; do
not proceed to install or exercise either relay against that host until
it is understood.

**Authenticated check**, once `MOS_CONSOLE_SECRET` is provisioned (see
above): authenticate via the console's own login flow using the current
secret, then confirm `/api/health` now answers normally
(`"ok":true`, `"token_provisioned":true`). The exact login request/response
shape (form field name, session cookie, or equivalent) is owned by
application source, which is out of scope for this relay to
document or modify — read `reference/server.js` /
`reference/web/login-gate.js` at deploy time as the current source of
truth, or ask whoever implemented M-01's server-side auth.

## On-host verification required before production installation

Two things this session could not prove without a real host, and that
must be confirmed before trusting either unit in production — do this as
part of a deliberate rehearsal, not as part of routine operation:

1. **The D-Bus session environment above.** `XDG_RUNTIME_DIR=/run/user/1001`
   and the matching `DBUS_SESSION_BUS_ADDRESS` are set from
   `docs/AI_HANDOVER.md`'s own recorded evidence (`deploy` has linger
   active, uid 1001) and the working pattern already used by
   `mythos-os-console-restart.sh`, but this session has no real host to
   run `systemctl start mythos-os-console-restart.service` against and
   watch it actually reach `mythos-os-console`'s `--user` manager. Before
   relying on either relay: install just the restart unit, run it once,
   and confirm via `journalctl --user -u mythos-os-console` (as `deploy`)
   that the restart it triggered is the one that shows up — not a
   silent D-Bus connection failure that `set -e` happened to also exit
   non-zero for a different reason.

2. **`ProtectSystem=strict` vs `sudo certbot`, in `mythos-os-console-deploy.service`.**
   The unit now grants `ReadWritePaths` for `/etc/letsencrypt`,
   `/var/lib/letsencrypt`, and `/var/log/letsencrypt` — the three paths
   certbot needs — but whether a `sudo`-elevated `certbot` child process
   actually inherits and respects this unit's mount namespace the way
   expected has not been exercised against a real Let's Encrypt call
   from this session. Before the first production run of
   `mythos-os-console-deploy.service` that would reach Phase 8 with no
   certificate yet present: run `sudo certbot certonly --nginx -d
   os.mythosprod.xyz --dry-run` **manually, as `deploy`, through the
   installed unit** (`systemctl start mythos-os-console-deploy.service`
   with `/etc/letsencrypt/live/os.mythosprod.xyz` absent) and confirm the
   dry run itself succeeds and that certbot's log/state files land where
   expected, rather than failing on a read-only filesystem. If it fails
   there, widen `ReadWritePaths` by the smallest amount the failure
   actually points at — do not remove `ProtectSystem=strict` to work
   around it.

Do not skip either rehearsal on the assumption that the reasoning above is
sufficient on its own; it is the best analysis available without host
access, not a substitute for the check.

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
