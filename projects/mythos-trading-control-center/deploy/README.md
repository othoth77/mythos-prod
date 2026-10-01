# Deploying the Trading Control Center

Target: `https://trading.mythosprod.xyz`, on the Mythos VPS, as a user-level
systemd service of `deploy` behind nginx — the same shape as `os.mythosprod.xyz`.

What is deployed is a control and observation surface over the Trading Agent
in **BACKTEST and PAPER** modes. It has no venue connection and no LIVE
execution path, and it opens no outbound connection.

## Layout on the host

```
/home/deploy/deployments/mythos-trading-control-center/
  releases/<commit>/        an export of one commit, read-only, interface built
  current -> releases/<commit>
  state/                    0700 — configuration, audit chain, runs, journals
  users.json                0600 — scrypt records only
```

State and the users file are outside the releases: switching or rolling back a
release never touches them.

## One-time setup

As `deploy`:

```bash
ROOT=/home/deploy/deployments/mythos-trading-control-center
mkdir -p "$ROOT/releases" "$ROOT/state" && chmod 700 "$ROOT" "$ROOT/state"

# 1. Build the first release (runs both suites from the export; switches `current`).
cd /home/deploy/worktrees/trading-control-center
projects/mythos-trading-control-center/deploy/release.sh <commit>

# 2. Create the users. The password is printed ONCE; it is never stored in clear.
cd "$ROOT/current/projects/mythos-trading-control-center"
node bin/tcc-user.js set "$ROOT/users.json" owner OWNER --generate
node bin/tcc-user.js list "$ROOT/users.json"

# 3. Install and start the unit.
install -m 0644 deploy/mythos-trading-control-center.user.service \
  ~/.config/systemd/user/mythos-trading-control-center.service
systemctl --user daemon-reload
systemctl --user enable --now mythos-trading-control-center
deploy/smoke.sh http://127.0.0.1:8210 <commit>
```

As `root` (the vhost and the certificate are the only root steps):

```bash
install -m 0644 /home/deploy/deployments/mythos-trading-control-center/current/projects/mythos-trading-control-center/deploy/nginx-trading.mythosprod.xyz.conf \
  /etc/nginx/sites-available/trading.mythosprod.xyz
ln -s ../sites-available/trading.mythosprod.xyz /etc/nginx/sites-enabled/trading.mythosprod.xyz
nginx -t && systemctl reload nginx
certbot --nginx -d trading.mythosprod.xyz        # adds the 443 block and the redirect
nginx -t && systemctl reload nginx
```

Then, from anywhere:

```bash
deploy/smoke.sh https://trading.mythosprod.xyz <commit>
```

## Releasing a new commit

```bash
cd /home/deploy/worktrees/trading-control-center && git pull --ff-only
projects/mythos-trading-control-center/deploy/release.sh <commit>
```

`release.sh` refuses a commit that is not on `origin/mythos/trading-control-center`,
refuses one whose Trading Agent differs from the audited base, runs both suites
from the exported release, and only then moves `current` and restarts the
service. If the smoke test fails after the restart it switches back by itself.

## Rollback

```bash
cd /home/deploy/deployments/mythos-trading-control-center
ln -sfn releases/<previous-commit> current
systemctl --user restart mythos-trading-control-center
```

The configuration, the audit chain and every stored run are untouched by a
rollback. A restart always comes up in BACKTEST: a PAPER approval does not
survive it, by design.

## Taking it down

```bash
systemctl --user disable --now mythos-trading-control-center          # as deploy
rm /etc/nginx/sites-enabled/trading.mythosprod.xyz && systemctl reload nginx   # as root
```

## What to check after any change

| Check | Command |
|---|---|
| service is up | `systemctl --user status mythos-trading-control-center` |
| start-up line | `journalctl --user -u mythos-trading-control-center -n 20` — one JSON line with `commit`, `mode: BACKTEST`, `web: dist`, `authProvisioned: true`, `liveExecution: NOT AVAILABLE` |
| anonymous surface | `deploy/smoke.sh https://trading.mythosprod.xyz` |
| signed-in surface | `TCC_SMOKE_USER=… TCC_SMOKE_PASSWORD_FILE=… deploy/smoke.sh https://trading.mythosprod.xyz <commit>` |
| LIVE lock | System page → *LIVE execution: NOT AVAILABLE — refusal verified by a health check*; Testing Center → run **Security** |
| audit chain | System page → **Verify chain** |

## Notes

- The service listens on `127.0.0.1:8210` only. It is never exposed directly.
- `TCC_TRUST_PROXY=1` makes the server take the client address from `X-Real-IP`
  **only** when the peer is loopback, which is nginx.
- `TCC_PUBLIC_ORIGIN` makes it accept state-changing requests from that exact
  origin only.
- The Testing Center can run the full regression in production. It is one file
  at a time under the unit's memory limit and takes several minutes; while it
  runs, backtests are still accepted. It writes nothing into the state
  directory except its own run records.
