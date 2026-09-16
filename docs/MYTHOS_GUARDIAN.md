# MYTHOS Guardian

Guardian is the VPS's host-health observer. It reads what the existing
components already know, decides one deterministic level for the host, and
writes that down.

**This version does nothing else.** It cannot kill a process, restart a
unit, stop a service, delete a file, clean a cache or prune anything. There
is no such code in it. Everything below is written on that assumption, and
§6 explains how the assumption is enforced rather than merely stated.

Version 0.1.0. Last updated 2026-09-16.

---

## 1. Why it exists

The VPS has good instruments and no single answer. `mythos-memwatch` samples
memory every two minutes. The executor's Resource Guard runs a
NORMAL/WARNING/CRITICAL state machine. The session guard counts agent
sessions. The Status Center probes the public surface. `ops/backup` records
backup health. Each is right about its own domain and silent about the rest.

So on 2026-09-13 the host could be at 93 % disk, with agent sessions
accumulating toward an OOM event, while every individual instrument looked
reasonable. Nobody was wrong. Nobody was looking at all of it at once.

Guardian is that one place. It answers a single question — *how is this host,
right now, and how sure are we?* — and it answers it the same way every time.

## 2. What it is not

Guardian is **not** a second copy of anything.

| Domain | Who owns the signal | What Guardian adds |
|---|---|---|
| Memory pressure | Resource Guard (`projects/mythos-ai-executor/lib/resource-guard.js`) | reads its published level; notices when it stops matching the kernel |
| Memory telemetry | `mythos-memwatch` | reads the last line; never re-samples |
| Agent sessions | `mythos-session-guard` | reads its snapshot and unit state; counts nothing it can avoid counting |
| Public surface | Status Center (`projects/status-center/monitor`) | reads `live-status.json`; never re-probes an endpoint |
| Backups | `ops/backup` health records | reads them; never runs a backup |
| Scheduling | Dagu is the ratified maintenance scheduler | Guardian schedules nothing but its own tick |

It is also not a killer, a cleaner, or an autoscaler. A future version may
propose remediation; this one deliberately has none, so that the observation
layer can be trusted before anything is allowed to act on it.

## 3. The level

```
NORMAL  <  RECOVERY  <  WARNING  <  HIGH  <  CRITICAL  <  EMERGENCY
```

Five domains — `memory`, `sessions`, `disk`, `services`, `backup` — each get
their own level. The **host level is the maximum over the domains Guardian
could actually observe.**

Three rules make that trustworthy:

**Escalation costs samples; de-escalation costs more.** A condition must hold
for two consecutive ticks to escalate, and three to step down one level. From
EMERGENCY the walk back to NORMAL passes through CRITICAL, HIGH, WARNING and
RECOVERY — nothing jumps from the worst state to the best.

**Confirmed evidence does not wait.** An OOM kill, a Resource Guard level, a
down critical unit: these are events another component already confirmed, and
they commit on the first tick that sees them. Guardian's *own* inference above
that level still has to earn its samples. (See `floor` in `lib/levels.js`.)

**Unknown is never NORMAL.** If Guardian cannot read a domain, that domain is
`unknown`, it is excluded from the roll-up, and the host level is reported
`partial: true` with the missing domains named. Guardian never reports a green
host it could not see.

## 4. Host health is not Guardian health

These are separate, in both directions, and the distinction is the point.

- The **host** can be CRITICAL while Guardian is perfectly healthy. That is
  Guardian working.
- **Guardian** can be DEGRADED while the host is fine — the Status Center file
  went stale, say. That is a Guardian problem, not an outage.
- `BLIND` means Guardian is running and can no longer read anything. Then every
  green level below it is unverified, and the Status Center reports DOWN.

The `guardian-lifecycle` probe reports Guardian health only. Memory, disk,
services and backups already have their own probes there; counting them twice
would turn one outage into two.

**A Guardian that was never installed is `NOT_MONITORED`, not `DOWN`.**
Software the owner has not deployed is not an outage. `DOWN` is reserved for a
Guardian that *is* installed and has stopped reporting, or gone blind.

## 5. What each domain looks at

**memory** — the Resource Guard's published level is authoritative, and
Guardian also reads `/proc/meminfo`, `/proc/pressure/memory` and
`/proc/vmstat` itself. A new `oom_kill` since the last tick forces CRITICAL
immediately. A WARNING with `MemAvailable` under 1000 MiB, or PSI60 at or
above 20, becomes HIGH. A CRITICAL with `MemAvailable` under 400 MiB becomes
EMERGENCY.

Swap is reported and never triggers. This host sits at 97–100 % swap for days
while genuinely healthy — a swap threshold would park it in CRITICAL forever.
That was established by the Resource Guard's own investigation and Guardian
does not relitigate it.

If the Resource Guard's published level is *lower* than what the kernel shows,
Guardian reports the kernel level and records a `pressure_disagreement`. The
thresholds it uses for that are the Resource Guard's own enter thresholds, so
Guardian can never call pressure *earlier* than the RG would — it can only
notice when the RG has stopped tracking the host. A single tick of
disagreement is normal (the RG has its own confirmation delay); a sustained
one means something upstream is wedged.

**sessions** — agent sessions are counted from `/proc` by command line, with
resident memory and age. Above the hard maximum of 8 that is a WARNING. Under
memory pressure the ceiling tightens, and exceeding it while memory is
CRITICAL is HIGH. Tool processes reparented to PID 1 and older than ten
minutes are reported as orphans. A session guard that has not run in fifteen
minutes is reported, because an uncounted session is an unbounded one.

**disk** — `statfs` on `/`, blocks and inodes both, at 80 / 85 / 90 / 95 %.
`docker system df` names where the growth is, and is only collected once disk
is at or above 80 %: it costs about 2.8 seconds against the Docker daemon, and
a breakdown of where disk is going is only actionable under pressure. The disk
*level* always comes from `statfs`, which is free. Guardian only reports it.

**services** — 24 units (system and the deploy user manager) and 7 containers,
each classified `critical`, `production` or `support`. A down critical unit is
CRITICAL; production is HIGH; support is WARNING. A unit restarting 5 times in
30 minutes is a restart loop, which is HIGH for anything but a support unit —
a loop is worse than being cleanly down, because it hides the fault.

**backup** — the `ops/backup` health records, read with the per-mode semantics
introduced in PR #285: only a successful *backup* run counts. A clean `verify`
after a failed nightly backup does not make the backup fresh. Beyond 26 hours
is a WARNING, beyond 50 is FAILED, and a missing required record is FAILED —
never assumed healthy. Restore tests are read from their systemd unit results;
a backup that has never been restored is not yet a backup.

## 6. Observe-only, and how that is enforced

Four independent mechanisms, because a comment is not a control:

1. **No such code.** There is no kill, restart, stop, unlink, rmdir, chmod or
   chown call anywhere in Guardian. The test suite asserts this over the
   engine, the classifier and the collectors.
2. **A command allowlist.** Commands are matched against exact read-only argv
   prefixes — `systemctl show`, `systemctl is-active`, `systemctl list-timers`,
   `systemctl --user show`, `systemctl --user is-active`, `docker inspect`,
   `docker system df`. Anything else is refused *before* exec, so no dynamic
   input can become a command.
3. **A write boundary.** Every write goes through `io.assertOwnState()`, which
   refuses any path outside Guardian's own state directory. Not by convention —
   it throws.
4. **The unit.** `ProtectSystem=strict` with a single `ReadWritePaths` entry.
   The kernel refuses what the code would refuse anyway.

The configuration carries `allow_*` remediation flags so the future enablement
path is explicit and testable. In this version they must all be `false` and an
override that sets one is rejected outright — Guardian keeps its built-in
defaults and reports the rejection. Configuration cannot widen what Guardian
does.

`mythos-guardian selftest` proves points 1–3 on the host it runs on.

## 7. Using it

```bash
mythos-guardian run --dry-run     # observe, write nothing
mythos-guardian run               # observe, write Guardian state only
mythos-guardian status            # the last report
mythos-guardian incident          # the last report, OTH incident format
mythos-guardian simulate all      # 33 scenarios against synthetic hosts
mythos-guardian scenarios         # list them
mythos-guardian validate          # check the effective policy
mythos-guardian selftest          # prove the observe-only boundary here
```

`simulate` is always dry and always synthetic. It cannot be made to run a live
tick and it never reads the real host — the scenario supplies the data.

State lives in `~/.local/state/mythos-guardian`: `state.json` (hysteresis),
`report.json` (the last verdict, which the Status Center probe reads),
`ticks.jsonl` and `incidents.jsonl`.

## 8. Installing it

```bash
ops/guardian/install-guardian.sh              # install, do not schedule
ops/guardian/install-guardian.sh --enable     # install and start the timer
```

Run as `deploy`. The script refuses to run as root: Guardian is unprivileged
by design, everything it reads is world-readable or already deploy's, and root
would buy nothing while widening the blast radius of an observer.

The installer validates the configuration and runs the self-test, and stops if
either fails, so a broken configuration cannot become a scheduled job. Without
`--enable` nothing is scheduled.

Rollback:

```bash
systemctl --user disable --now mythos-guardian.timer
rm -f ~/.local/bin/mythos-guardian ~/.config/systemd/user/mythos-guardian.{service,timer}
systemctl --user daemon-reload
```

The state directory is left in place — it is Guardian's own history, and
removing it is a separate decision.

## 9. Files

```
ops/guardian/lib/levels.js       the ladder and hysteresis (pure)
ops/guardian/lib/config.js       policy, validation, override rejection
ops/guardian/lib/io.js           the single I/O boundary
ops/guardian/lib/sources.js      read-only collectors
ops/guardian/lib/classify.js     per-domain verdicts (pure)
ops/guardian/lib/engine.js       tick, roll-up, incidents, persistence
ops/guardian/lib/report.js       text and OTH incident rendering
ops/guardian/lib/scenarios.js    33 dry-run scenarios
ops/guardian/bin/mythos-guardian the CLI
ops/guardian/systemd/            the deploy user service and timer
ops/guardian/install-guardian.sh the installer
tests/guardian-test.js           310 assertions, fully isolated
```

## 10. Related

- `docs/MYTHOS_GUARDIAN_DECISIONS.md` — why it is shaped this way, including
  what PR #283 got wrong.
- `docs/MYTHOS_GUARDIAN_RUNBOOK.md` — what to do when Guardian says something.
- `docs/MYTHOS_SESSION_GUARD.md`, the Resource Guard header comment, and
  `docs/STATUS_CENTER.md` for the components Guardian reads.
