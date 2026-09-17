# MYTHOS Guardian

Guardian is the VPS's host-health observer. It reads what the existing
components already know, decides one deterministic level for the host, and
writes that down.

**It takes no action unless you deliberately turn that on**, and even then it
has no kill and no delete. Out of the box `observe_only` is true and every
remediation flag is false, so Guardian reports and does nothing else.

When remediation is enabled it can do exactly four things, listed in §7, each
a static entry in `ops/guardian/lib/actions.js` behind ten gates. There is no
runtime path that can add a fifth. §6 explains how that is enforced rather
than merely stated.

Version 1.0.0. Last updated 2026-09-17.

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

## 6. The boundary, and how it is enforced

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
4. **The unit** carries `ProtectSystem=strict` with a single `ReadWritePaths`
   entry — but **measure before relying on it.** On this host it is inert: a
   systemd *user* manager cannot create a mount namespace, so every sandboxing
   directive is silently not applied. Verified 2026-09-17 by running a user
   unit with `ProtectSystem=strict` and watching it write
   `/var/lib/mythos/guardian` anyway; the mount table inside the unit was
   byte-identical to the host's. `/etc` is blocked by ordinary file
   permissions, not by the sandbox. The directives are kept because they cost
   nothing and would apply if Guardian ever ran as a system unit, but they are
   **not** part of the enforced boundary here. See
   `docs/MYTHOS_GUARDIAN_SECURITY.md` for the measurement and how to repeat it.

Mechanisms 1–3 are the real boundary, and 3 is what stops Guardian writing the
production checkout, the backup health records or `~/.ssh` — none of which the
unit protects. The suite tests `assertOwnState()` against those paths by name.

The configuration carries `allow_*` remediation flags so the future enablement
path is explicit and testable. In this version they must all be `false` and an
override that sets one is rejected outright — Guardian keeps its built-in
defaults and reports the rejection. Configuration cannot widen what Guardian
does.

`mythos-guardian selftest` proves points 1–3 on the host it runs on.

## 7. What it can do, if you let it

Nothing, by default. With `observe_only: false` and the matching flag:

| Action | Domain | From | Reversible |
|---|---|---|---|
| `ACTION_CLEAR_NPM_CACHE` | disk | HIGH | fully — npm re-downloads |
| `ACTION_PRUNE_DOCKER_BUILD_CACHE` | disk | HIGH | the next build rebuilds those layers |
| `ACTION_PUBLISH_ADMISSION_ADVISORY` | sessions | WARNING | fully — one small advisory file |
| `ACTION_RESTART_APPROVED_SERVICE` | services | WARNING | a restart; support units only |

Ten gates, in order, and the plan records the first one each action failed:

```
observe_only · flag · registry · level · precondition
protected · allowlist · cooldown · rate_limit · budget
```

`observe_only` beats an enabled flag. `PROTECTED` refuses ERP, every database,
backups, credentials, repositories and production containers — at gate 6,
before the command allowlist is consulted — and configuration cannot promote a
unit past it.

**Automation is a separate decision from permission.** Enabling a flag says
*Guardian may clear a cache*. `remediation.on_schedule` says *it may do so
unattended*. They are never the same checkbox, and `on_schedule` is false by
default — so out of the box remediation exists and waits to be asked:

```json
{ "observe_only": false,
  "allow_disk_remediation": true,
  "remediation": { "on_schedule": true } }
```

Without `on_schedule`, the timer observes and only `remediate --execute` acts.

The advisory is idempotent: it does not rewrite an identical file, so running
on a schedule does not fill the audit log with events carrying no information.

What it deliberately cannot do, and why, is in
`docs/MYTHOS_GUARDIAN_CLEANUP_POLICY.md`. The short version: it removes
**derived data by named command**, never anything chosen by path, and it still
has no delete primitive at all.

```bash
mythos-guardian actions           # everything it can ever do
mythos-guardian remediate         # what it would do right now, and why not
mythos-guardian remediate --execute
mythos-guardian audit             # what it actually did
```

## 8. Using it

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

A tick has a wall-clock budget (45 s, well under the unit's 120 s timeout).
Domains not reached inside it are marked unknown, so the host level comes back
`partial` with them named, rather than late or not at all. This is not
theoretical: during a real memory event on 2026-09-16 a tick took 76 seconds
against a median of 0.8 s, because the host was stalled on memory 57 % of the
time — exactly the moment Guardian most needs to report. A collection slower
than 5 s is itself reported as a `slow_tick` finding, which is almost always a
symptom of the host being slow rather than of Guardian.

State lives in `~/.local/state/mythos-guardian`: `state.json` (hysteresis),
`report.json` (the last verdict, which the Status Center probe reads),
`ticks.jsonl` and `incidents.jsonl`.

## 9. Installing it

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

## 10. Files

```
ops/guardian/lib/levels.js       the ladder and hysteresis (pure)
ops/guardian/lib/config.js       policy, validation, override rejection
ops/guardian/lib/io.js           the single I/O boundary
ops/guardian/lib/sources.js      read-only collectors
ops/guardian/lib/classify.js     per-domain verdicts (pure)
ops/guardian/lib/engine.js       tick, roll-up, incidents, persistence
ops/guardian/lib/report.js       text and OTH incident rendering
ops/guardian/lib/scenarios.js    33 dry-run scenarios
ops/guardian/lib/actions.js      every action that can ever exist
ops/guardian/lib/remediate.js    the ten gates, planning, audit
ops/guardian/bin/mythos-guardian the CLI
ops/guardian/systemd/            the deploy user service and timer
ops/guardian/install-guardian.sh the installer
tests/guardian-test.js           310 assertions, fully isolated
```

## 11. Related

- `docs/MYTHOS_GUARDIAN_ARCHITECTURE.md` — how it is put together.
- `docs/MYTHOS_GUARDIAN_DECISIONS.md` — why, including what was wrong first.
- `docs/MYTHOS_GUARDIAN_RUNBOOK.md` — what to do when Guardian says something.
- `docs/MYTHOS_GUARDIAN_SECURITY.md` — what is enforced, measured not assumed.
- `docs/MYTHOS_GUARDIAN_CLEANUP_POLICY.md` — what it may and may not remove.
- `docs/MYTHOS_GUARDIAN_INCIDENTS.md` — the incident record and how to read it.
- `docs/MYTHOS_SESSION_GUARD.md`, the Resource Guard header comment, and
  `docs/STATUS_CENTER.md` for the components Guardian reads.
