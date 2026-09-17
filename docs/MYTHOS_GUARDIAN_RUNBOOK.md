# MYTHOS Guardian — runbook

What to do when Guardian says something. Written 2026-09-16 for Guardian
0.1.0.

**Guardian never acts.** Everything below is a human decision. Nothing here
is automated, and nothing here should be automated without a separate,
explicit decision.

---

## 0. First, read it correctly

```bash
mythos-guardian status            # the last report
mythos-guardian incident          # the same report in the OTH incident format
mythos-guardian run --dry-run     # observe right now, change nothing
```

Two numbers matter and they are different:

- **Host level** — how the host is.
- **Guardian health** — whether Guardian could see it.

`NORMAL (partial)` with Guardian `DEGRADED` does **not** mean the host is
fine. It means Guardian could not see part of it. Fix the visibility before
trusting the verdict.

---

## 1. Guardian is DEGRADED or BLIND

Guardian's own problem. The host may be perfectly fine.

`status` names the issue. The usual ones:

| Issue | What it means | What to check |
|---|---|---|
| `memory: signal degraded` | the Resource Guard publication is missing or stale | is `mythos-ai-executor.service` running? is `/var/lib/mythos/pressure/resource-pressure.json` being updated? |
| `sessions: signal degraded` | the session guard has not run, or its snapshot is missing | `systemctl status mythos-session-guard.timer`; a missing snapshot is a known pre-existing issue and Guardian falls back to its own `/proc` scan |
| `services: signal unavailable` | the deploy user manager could not be queried | usually a missing `XDG_RUNTIME_DIR`/session bus; check `systemctl --user` works as deploy |
| `configuration: override rejected` | `~/.config/mythos/guardian.json` failed validation | `mythos-guardian validate` prints the exact reason; Guardian kept its built-in defaults, so it is still observing correctly |

`BLIND` means Guardian is running and can read nothing at all. Treat every
green level as unverified until it clears.

---

## 2. memory — WARNING / HIGH

The Resource Guard has entered WARNING, or Guardian sees low `MemAvailable`
or sustained PSI on top of it.

1. Look at what is resident. The report's `sessions` line gives the agent
   count and their total RSS; memwatch's last line names the top processes
   and cgroups.
2. If agent sessions dominate — which on this host they usually do — the
   correct action is to **close finished sessions from their own clients**.
   Do not kill them from the host: a session killed under the client leaves
   orphaned tool processes, which is how the orphan count grows.
3. If a service dominates, that is a different conversation. Note it and look
   at the unit's own memory accounting.

Do not add swap. Do not tune thresholds during an incident.

## 3. memory — CRITICAL / EMERGENCY

CRITICAL means the Resource Guard's own critical thresholds are met.
EMERGENCY adds `MemAvailable` under 400 MiB — in the 2026-09-01 episode the
OOM killer fired about 6.7 minutes after CRITICAL was entered.

1. **Check the production services first**, not the memory number. ERP,
   idauto, piece, the status site: are they answering? Guardian's `services`
   line and the Status Center both tell you. Memory pressure that has not hurt
   anything is urgent, not an outage.
2. Reduce the load that is reducible: finished agent sessions, closed from
   their clients.
3. If an OOM kill has already occurred (`oom_kill` finding, or the counter
   moved), find out **what** was killed. All deploy production units sit at
   `OOMScoreAdjust=0` since 2026-09-13 precisely so the kernel does not pick
   them; if one was chosen anyway, that is a finding worth recording.
4. Restarting a production service to free memory is a real option and an
   owner decision. It is not Guardian's.

## 4. `pressure_disagreement`

Guardian's reading of `/proc` is worse than the Resource Guard's published
level.

- **One or two ticks:** normal. The Resource Guard confirms before it commits,
  so it lags the kernel on every real event.
- **Sustained:** the Resource Guard is not tracking the host. Check that the
  executor is alive and sampling, that the publication's `updated_at` is
  advancing, and that the executor has not been restarted into a state where
  it publishes nothing.

Guardian reports the kernel's level while this lasts, so the host level is
still right. What is wrong is upstream.

## 5. sessions — WARNING / HIGH

Too many agent sessions, or too many for the current memory level.

- Guardian counts; it does not close anything.
- The session guard owns admission and enforcement. Its enforcement marker is
  **off**, and turning it on is an owner decision, not an incident response.
- `orphan_processes` means tool processes reparented to PID 1 and older than
  ten minutes. Identify the owning session before terminating anything — the
  `mythos-gh-runner` `KillMode=control-group` drop-in (2026-09-13) exists
  because orphaned listeners caused a session-conflict loop.

## 6. disk — WARNING and above

1. Read the `disk_growth_sources` finding: Docker images, build cache, local
   volumes, with reclaimable sizes.
2. **Do not run a broad cleanup.** Not `docker system prune -a`, not
   `docker volume prune`, not `rm -rf` on anything you have not read. The
   2026-09-13 cleanup took the host from 93 % to 60 % in owner-gated steps,
   and everything deleted had a verified R2 copy first. That is the standard.
3. Every candidate needs a verified copy and an owner decision. The disk audit
   in `docs/` lists what is safe and what is not.

## 7. services — a unit or container is not OK

| Class | Level | Meaning |
|---|---|---|
| critical | CRITICAL | nginx, docker, the deploy user manager, erp-api, idauto-postgres |
| production | HIGH | the public services |
| support | WARNING | timers, memwatch, hostops, the runner |

`restart_loop` (5 restarts in 30 minutes) is **HIGH for production, worse than
being cleanly down**. A looping unit looks alive and is not. Read its journal
before restarting it again — another restart usually just resets the evidence.

`status_center_down` means the Status Center's own probe says a public
endpoint is down. Guardian does not re-probe; go and read the Status Center,
which has the HTTP detail.

A unit reported `MISSING` is not installed. That may be entirely correct
(Dagu, for instance, is ratified but not installed). If it is expected, remove
it from `services.units` in the configuration rather than living with a
permanent WARNING.

## 8. backup — WARNING / FAILED

| State | Meaning |
|---|---|
| `BACKUP_OK` | a successful backup inside 26 hours |
| `BACKUP_WARNING` | 26–50 hours, or the last backup run failed |
| `BACKUP_FAILED` | no successful backup for over 50 hours, or the record is missing |

Only a successful **backup** run counts. A clean `verify` does not refresh
freshness — that was PR #285, and the reason is that `verify-remote` checks
integrity, not age, so a clean verify after a failed nightly backup used to
report a stale backup as fresh.

Before doing anything:

1. **Never delete a backup.** Not an old one, not a partial one, not to make
   room.
2. Verify against the remote copy before any corrective run.
3. A record showing failures with an `error` naming a path under `/tmp` is
   almost certainly a test artefact, not a real failure. That happened on
   2026-09-14; both backup suites now pin their health path so it cannot
   recur, but check the error text before responding to it.

`RESTORE_TEST_FAILED` or `RESTORE_TEST_UNVERIFIED` means the restore test is
overdue or its result is unreadable. A backup that has never been restored is
not yet a backup. `UNVERIFIED` is often just a reboot clearing the systemd
result — re-run the restore test unit on its own schedule rather than by hand.

## 8b. Remediation — what it may have done, and turning it off

By default Guardian does nothing: `observe_only` is true. If it is enabled:

```bash
mythos-guardian audit          # what it actually did, with verification
mythos-guardian remediate      # what it would do right now, and why not
mythos-guardian actions        # everything it can ever do
```

**Turn it off, immediately and without stopping Guardian:**

```bash
# edit ~/.config/mythos/guardian.json
{ "observe_only": true }
```

`observe_only` beats every flag, takes effect on the next tick, and leaves
Guardian observing. That is the first thing to reach for — not disabling the
timer, which also loses the observation you need during an incident.

**What it can never have done**, whatever the report says: touched ERP, a
database, a backup, a credential, a repository, a production container or
volume, or deleted any file chosen by path. Guardian has no delete primitive.
If a Guardian report appears to claim otherwise, that is a bug in the report
renderer and the audit record is the authority.

**If an action verified `false`**, Guardian recorded that the effect did not
happen and raised a WARNING finding. It does not retry. Read the record, and
treat the underlying condition as un-remediated.

**A service that stopped being restarted** has hit `max_attempts` and is
deliberately left alone. Read its journal; repeated restarts hide the fault.

## 9. Guardian itself

**Is it running?**

```bash
systemctl --user status mythos-guardian.timer
systemctl --user list-timers mythos-guardian.timer
```

**Stop it.** Safe at any time. Guardian holds nothing and owns nothing:

```bash
systemctl --user disable --now mythos-guardian.timer
```

**Is the boundary still intact?**

```bash
mythos-guardian selftest
```

Thirteen checks, run against this host: the write boundary, the command
allowlist, the absence of remediation, that a dry run writes nothing, that
missing inputs do not read as NORMAL, that escalation cannot starve, and that
a degraded signal still reports a real host level, the action channel is
disarmed, the action allowlist refuses every destructive argv, the two
allowlists are disjoint, and PROTECTED refuses the production resources.

**Did a change break it?**

```bash
node tests/guardian-test.js       # 310 assertions, touches nothing
mythos-guardian simulate all      # 33 scenarios, synthetic hosts only
```

Both are safe on production at any time. Neither reads a production path for
anything it asserts, and neither writes one.

---

## 10. What Guardian will never tell you to do

It does not propose deleting data, pruning volumes, force-resetting a
checkout, or stopping a production service. Its suggestions are read-only
observations with a named owner decision attached. If a Guardian report ever
appears to recommend a destructive action, that is a bug in the report
renderer — the test suite asserts it cannot.
