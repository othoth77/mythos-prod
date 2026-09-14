# MYTHOS Guardian

The permanent protection layer of the MYTHOS VPS. It watches memory, disk, services, backups and agent sessions every two minutes, and turns evidence into a confirmed host level:

`NORMAL < RECOVERY < WARNING < HIGH < CRITICAL < EMERGENCY`

It **reports by default** and acts only where an operator has enabled an action class.

| Document | Read it for |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | components, what is reused, decision engine, Beszel evaluation |
| [CONFIGURATION.md](CONFIGURATION.md) | thresholds and why, the override file, the systemd resource audit |
| [CLEANUP_POLICY.md](CLEANUP_POLICY.md) | exactly what may be removed, when, and the 10-step verification |
| [RUNBOOK.md](RUNBOOK.md) | install, staged enablement, emergency procedure, troubleshooting, rollback |
| [INCIDENTS.md](INCIDENTS.md) | the incident record, where it lives, retention |
| [SECURITY.md](SECURITY.md) | privileges, sandbox, threat review |

## One-minute view

```bash
systemctl list-timers mythos-guardian.timer
journalctl -u mythos-guardian -n 5 --no-pager        # one JSON line per tick
/usr/local/lib/mythos-guardian/bin/mythos-guardian status | head -40
/usr/local/lib/mythos-guardian/bin/mythos-guardian run --dry-run   # what it sees and would do now
ls /var/lib/mythos-guardian/enable/                  # which action classes are enabled
tail -n 3 /var/lib/mythos-guardian/incidents.jsonl
```

The Status Center shows Guardian as the `guardian` probe (status.mythosprod.xyz → Live services).

## What it will never do

- restart, modify or migrate the ERP, PostgreSQL, MariaDB or any Docker container
- delete repositories, worktrees, backups, dumps, credentials, `.env` files, SSH material, production volumes
- run `docker system prune`, `docker volume prune` or any `-a` prune
- signal an agent session (that remains `mythos-session-guard`'s job, under its own marker)
- act on a single sample, loop restarts, or act when its configuration is invalid
