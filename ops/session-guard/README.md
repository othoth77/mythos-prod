# Claude Desktop Remote session guard — install and operate

**Owner action. Not installed by any agent** — the permission layer refuses
writes under `/etc/systemd` and `/usr/local` from a session, correctly.

Full behaviour, thresholds and rationale: `docs/MYTHOS_SESSION_GUARD.md`.
Issue: [#144](https://github.com/othoth77/mythos-prod/issues/144).

## The gap

`/root/.claude/remote/srv/<rev>/server --serve` forks one `ccd-cli` process
per Desktop Remote session and never reaps it. On 2026-09-03: 47 sessions
started since 08-30, **14 still resident holding ~2.6 GiB**, some days old,
all root-owned in `user-0.slice`. The server has no idle timeout and no
concurrency ceiling, and it is not ours to change. Reclamation from outside
is the only available lever, and it needs uid 0 — which is why this is a
root unit and not part of the executor.

## Install

```bash
sudo bash ops/session-guard/install-session-guard.sh
```

Copies exactly two root-owned files into `/usr/local/lib/mythos-session-guard`
(`session-guard.js` + the runner), creates `/var/lib/mythos-session-guard`
(0700), installs the unit and timer, enables the timer, and runs it once.

**Installing does not start enforcing.** Without the enable marker the guard
observes: it tracks sessions, writes its ledger, logs what it would reclaim,
and signals nothing.

Root must never execute code from the deploy-writable checkout, so the unit
runs the installed copy — **re-run the installer after any merged change to
`lib/session-guard.js` or `mythos-session-guard-run.js`.**

## Enable, roll back, kill

```bash
touch /var/lib/mythos-session-guard/session-guard.enabled   # enable
rm    /var/lib/mythos-session-guard/session-guard.enabled   # rollback, instant
systemctl disable --now mythos-session-guard.timer          # hard off
```

`MYTHOS_SESSION_GUARD=off` in the unit environment overrides the marker.

Recommended rollout: leave it in observe mode for several hours, read the
plans it logs, confirm the veto reasons look right for this host, then touch
the marker.

## Watch it in ten seconds

```bash
systemctl list-timers mythos-session-guard.timer
journalctl -u mythos-session-guard.service -n 20 --no-pager   # one JSON line per run
cat /var/lib/mythos-session-guard/session-guard.jsonl          # durable ledger
```

Each journal line carries `mode` (`observe` / `enforce`), the
active/idle/orphaned counts, `resident_mib`, the Resource Guard level,
whether the ceiling is breached, what it planned, what it applied, and how
many vetoes fired.

## Memory-pressure input

The runner reads ONLY the pressure summary the executor publishes:
`/var/lib/mythos/pressure/resource-pressure.json` (override:
`MYTHOS_SESSION_GUARD_PRESSURE_FILE`), containing exactly
`{ "level", "updated_at" }`. It never reads the executor's private home
(`/home/deploy/mythos-ai-executor`, `0700`, holds `secrets/`), and the unit
keeps `CapabilityBoundingSet=CAP_KILL` — no DAC capability, no ACL.

The installer provisions `/var/lib/mythos/pressure` deploy-owned `0755`
inside `root:deploy 0750 /var/lib/mythos`: root traverses the parent as its
owner and reads the `0644` file as "other"; nobody outside root and the
deploy group can reach it. The executor writes it atomically on every sample
(O_EXCL temp + fsync + rename) and never creates the directory.

The runner opens the file with `O_NOFOLLOW|O_NONBLOCK` (the directory is
deploy-writable), requires a regular file of at most 4 KiB, and maps the
published level onto what the guard acts on (`HIGH`→`WARNING`,
`EMERGENCY`→`CRITICAL`). Every journal line carries `pressure_source`
(`{ path, status, published_level?, error? }`) with `status` one of `ok`,
`missing`, `unreadable`, `invalid`, `stale`; anything but `ok` reads as
`NORMAL` (fail-soft), older than 5 minutes is `stale`.

Activation needs, in order: the executor running this code (it publishes
only once the directory exists), and this runner re-installed with
`install-session-guard.sh` (which also creates the directory). Until then the
journal says `missing`.

## Files

| file | role |
|---|---|
| `mythos-session-guard-run.js` | the root runner; requires only `fs`, `path` and its sibling `session-guard.js` |
| `mythos-session-guard.service` | oneshot, `User=root`, `ProtectSystem=strict`, `CapabilityBoundingSet=CAP_KILL`, `MemoryMax=192M`. No `[Install]` — the timer drives it |
| `mythos-session-guard.timer` | every 5 minutes |
| `user-0.slice.d/memory.conf` | **LIVE since 2026-09-18** (applied with `systemctl set-property`) — `MemoryHigh=3584M` soft, `MemoryMax=4608M` hard, `MemorySwapMax=1G`. The original "no `MemoryMax`" stance was reversed after the 2026-09-18 global OOM storm; reasoning, and the rollback, in the file header and `docs/audits/VPS_MEMORY_PROTECTION_2026-09-18.md` |
| `install-session-guard.sh` | the installer |

## Related, and deliberately not merged with this

* `ops/oom/` — OOM kill-priority parity for the **deploy** user manager
  (2026-09-01 incident). Untouched by this work.
* `docs/MYTHOS_RESOURCE_GUARD.md` — admission control for **MYTHOS's own**
  tasks. This guard reads its memory level and adds no thresholds of its own.

## Execution Lifecycle (2026-09-04)

The runner now (a) reads the deploy-owned lifecycle registry (`MYTHOS_SESSION_GUARD_LIFECYCLE`, default
`/home/deploy/mythos-ai-executor/lifecycle`) so sessions bound to an active execution are never signalled and
lifecycle close requests become SIGTERM candidates, and (b) snapshots pid ↔ Claude session uuid ↔ transcript
turn state into `/var/lib/mythos/lifecycle/host-sessions.json` **before** planning, giving the plan a
transcript-turn idle clock (an idle ccd-cli still burns CPU). The installer copies `runtime-vps.js` beside the
runner and creates the snapshot directory; the unit gained `ReadWritePaths=/var/lib/mythos/lifecycle`.
Both inputs are optional: absent, the guard behaves exactly as before. See `docs/MYTHOS_SESSION_GUARD.md` §11.
