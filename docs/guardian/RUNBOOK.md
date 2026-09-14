# MYTHOS Guardian — runbook

## 1. Install (root)

```bash
cd /home/deploy/projects/mythos-prod            # a checkout at the reviewed commit
sudo bash ops/guardian/install-guardian.sh install --with-session-guard-pressure --with-status-monitor-bounds
```

Preflight is fail-closed: `node --check`, config validation and the full test suite must pass. The installer then copies the files root:root into `/usr/local/lib/mythos-guardian`, installs the unit, timer and requested drop-ins, runs `daemon-reload` and one supervised tick. It verifies `Result=success` and a written public status, and only then enables the timer. **It never creates an enable marker.**

After install, verify:

```bash
systemctl show mythos-guardian.service -p Result          # success
systemctl list-timers mythos-guardian.timer
systemctl show mythos-session-guard.service -p Environment   # MYTHOS_SESSION_GUARD_RG_STATE=/var/lib/mythos-guardian/public/memory-level.json
systemctl show mythos-status-monitor.service -p MemoryMax -p TimeoutStartUSec
systemctl --failed
```

The Status Center shows the `guardian` probe once the production checkout contains the probe (merge of this change + fast-forward of the checkout).

## 2. Staged enablement (the deployment order)

Each stage is one file and is reversible instantly with `rm`. Leave each stage at least a day and read the incidents before the next.

| Stage | Command | Effect |
|---|---|---|
| 0 observe (installed) | — | levels, incidents, status, advisory admission, session-guard pressure feed |
| 1 memory protection | session guard: `touch /var/lib/mythos-session-guard/session-guard.enabled` (its own README) | the session guard reclaims idle sessions, with a 15-min idle threshold under Guardian pressure |
| 2 service recovery | `touch /var/lib/mythos-guardian/enable/service-recovery` | failed restart-safe units are started (3 per 6 h per unit) |
| 3 disk cleanup | `touch /var/lib/mythos-guardian/enable/disk-cleanup` | allowlisted path cleanup at disk ≥ HIGH |
| 4 docker cleanup | `touch /var/lib/mythos-guardian/enable/docker-cleanup` | build cache at HIGH, dangling images at CRITICAL |
| 5 emergency | `touch /var/lib/mythos-guardian/enable/disk-emergency` | journal vacuum at disk ≥ 95 % |

Kill switch (overrides all markers): `touch /var/lib/mythos-guardian/enable/disabled`. An environment variable does the same: `MYTHOS_GUARDIAN=off` in a drop-in.

Note on stage 1: the installed session guard predates the Execution Lifecycle turn-idle clock (PR #149). Until `ops/session-guard/install-session-guard.sh` is re-run, it vetoes every session as `recent_activity`, so enforcing reclaims little. Re-install it before relying on stage 1.

## 3. Reading the state

```bash
mythos-guardian status | jq '.level, .mode, (.domains|map_values(.level)), .admission'
mythos-guardian run --dry-run                      # human: DETECTED / WOULD DO / PROTECTED / SKIPPED / EXPECTED
mythos-guardian simulate all                       # every scenario, dry-run, real host evidence
tail -n 20 /var/lib/mythos-guardian/incidents.jsonl | jq -r .oth
journalctl -u mythos-guardian --since -1h --no-pager
```

## 4. Emergency procedure

**Memory CRITICAL / EMERGENCY**
1. `tail -n 20 /opt/mythos-memwatch/memwatch.log`: who is growing.
2. `mythos-guardian status | jq .domains.sessions.summary`: agent count and resident MiB.
3. Close idle sessions in the Claude Desktop app (owner). Or, if the session guard is enforcing, let it act. `journalctl -u mythos-session-guard -n 3`.
4. If production died: `systemctl is-active user@1001.service`. If failed, `systemctl start user@1001.service` (Guardian does this itself with `service-recovery` enabled).
5. Never kill ERP, PostgreSQL or Docker to free memory.

**Disk HIGH and above**
1. `mythos-guardian simulate disk-high` shows what the allowlist can reclaim.
2. Growth sources: `journalctl --disk-usage`, `docker system df`, `du -xsh /var/lib/docker /var/lib/containerd /home/* /root /tmp 2>/dev/null | sort -h`.
3. Anything outside the allowlist is a human decision; see `docs/audits/VPS_OOM_P2_AUDIT_2026-09-13.md` §20 for the classified inventory.

**Service DEGRADED (loop or budget exhausted)**
1. `journalctl --user -M deploy@ -u <unit> -n 100` or `journalctl -u <unit> -n 100`.
2. Fix the cause. Guardian will not keep restarting it.
3. To let Guardian try again before the 6 h window passes, edit `/var/lib/mythos-guardian/state.json` → `domains.services.private.recovery.<id>`, or simply start the unit yourself.

**ERP down**: Guardian only reports. Follow the ERP runbook; Guardian verifies health, DB readiness and migration processes on every tick.

## 5. Troubleshooting

| Symptom | Check |
|---|---|
| Status Center shows Guardian DOWN "not reporting" | `systemctl status mythos-guardian.timer`; `journalctl -u mythos-guardian -n 20` |
| `services` shows `UNKNOWN ... manager query failed` | the deploy user manager is not reachable: `systemctl is-active user@1001.service` |
| `config_errors` present | `mythos-guardian validate --config /etc/mythos-guardian/config.json` |
| an action shows `observe_only_marker_absent` | intended; see §2 |
| `report_errors` present | disk full or `/var/lib/mythos-guardian` unwritable; protection still ran |
| tick is slow (> 20 s) | only during disk ≥ HIGH (in-use scan and tree walks); check `tick_ms` |

## 6. Recommended owner decisions (not applied)

1. `systemctl set-property user-0.slice MemoryHigh=3500M` is the real demand-side ceiling for agent sessions (live, reversible with `MemoryHigh=infinity`). Apply it in a quiet window, when fewer than 6 sessions are open.
2. Re-run `ops/session-guard/install-session-guard.sh` (Execution Lifecycle idle clock), then stage 1.
3. Bridge `events.log` (45 MB) needs rotation in code: `gov-notify.js` tails it, so a copytruncate logrotate would break its cursor.
4. `DefaultOOMScoreAdjust=0` for the deploy manager, and DB OOM protection. See the 09-13 audit.

## 7. Rollback

Everything this change installed, and exactly how to undo it:

| Change | Original state | New state | Rollback |
|---|---|---|---|
| `/usr/local/lib/mythos-guardian/` | absent | root:root copy of ops/guardian + resource-guard.js + docs | `install-guardian.sh rollback` (moves it to `.removed.<ts>`) |
| `/etc/systemd/system/mythos-guardian.{service,timer}` | absent | installed, timer enabled | `systemctl disable --now mythos-guardian.timer && rm /etc/systemd/system/mythos-guardian.{service,timer} && systemctl daemon-reload` |
| `/etc/systemd/system/mythos-session-guard.service.d/20-guardian-pressure.conf` | absent (session guard read a non-existent path → always NORMAL) | `Environment=MYTHOS_SESSION_GUARD_RG_STATE=…/memory-level.json` | `rm` it, then `systemctl daemon-reload` (takes effect at the next 5-min tick; no restart needed) |
| `/etc/systemd/system/mythos-status-monitor.service.d/20-bounds.conf` | no MemoryMax / TimeoutStartSec | `MemoryMax=192M`, `TimeoutStartSec=120` | `rm` it, then `systemctl daemon-reload` |
| `/var/lib/mythos-guardian/` | absent | state, incidents, public status, enable/ | kept as evidence; `rm -rf` only after review |
| Status Center probe `guardian` + `guardian-health` type | absent | in probes.json / monitor.js | `git revert` of the commit; the monitor picks it up at its next run |

Service behaviour: `mythos-guardian.service` is a oneshot with no `[Install]`, is never "restarted", and is only started by its timer. Disabling the timer stops Guardian completely; nothing else starts or depends on it.
