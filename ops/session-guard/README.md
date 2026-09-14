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

The runner reads the Resource Guard state written by the executor:
`/home/deploy/mythos-ai-executor/resource-guard.json` (override:
`MYTHOS_SESSION_GUARD_RG_STATE`). Until 2026-09-14 the default pointed at a
dot-prefixed directory that does not exist, so the guard always read
`NORMAL`. Every journal line now carries `pressure_source`
(`{ path, status }`) with `status` one of `ok`, `missing`, `unreadable`,
`invalid`, `stale`. Anything but `ok` still reads as `NORMAL` (fail-soft).

**Permission prerequisite (owner decision, not changed here).** The unit
keeps `CapabilityBoundingSet=CAP_KILL`. Root without a DAC capability cannot
traverse the deploy-owned `0700` executor home (verified 2026-09-14 with
`setpriv --bounding-set=-all,+kill`: EACCES), so after re-installing this
runner the journal will show `pressure_source.status: "unreadable"`. Making
the level usable requires one of: granting the unit `CAP_DAC_READ_SEARCH`
(broad: read access to every file the sandbox exposes), an ACL for root on
the executor home and state file (host change; the file is replaced by
rename, so a default ACL is needed), or the executor publishing its level to
a root-readable path. Pick one before relying on pressure-aware reclamation.

## Files

| file | role |
|---|---|
| `mythos-session-guard-run.js` | the root runner; requires only `fs`, `path` and its sibling `session-guard.js` |
| `mythos-session-guard.service` | oneshot, `User=root`, `ProtectSystem=strict`, `CapabilityBoundingSet=CAP_KILL`, `MemoryMax=192M`. No `[Install]` — the timer drives it |
| `mythos-session-guard.timer` | every 5 minutes |
| `user-0.slice.d/memory.conf` | **optional, separate owner decision** — `MemoryHigh=2G` soft ceiling on the root login slice. No `MemoryMax`: a hard cap there would OOM-kill. Install/rollback in the file header |
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
