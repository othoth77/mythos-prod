# MYTHOS Guardian — architecture

How Guardian is put together, and why each seam is where it is.

Version 1.0.0, 2026-09-17.

---

## 1. The shape

```
                 ┌─────────────────────────────────────────────┐
  the host       │  /proc   systemd   docker   filesystem       │
                 └───────────────────┬─────────────────────────┘
                                     │  reads only
  existing ops   ┌──────────────────┴─────────────────────────┐
  (each owns     │ Resource Guard   memwatch   session guard   │
   its truth)    │ Status Center    ops/backup                 │
                 └───────────────────┬─────────────────────────┘
                                     │  their published state
 ─────────────────────────────────── │ ───────────────────────── Guardian
                                     ▼
                              sources.js          collect, bounded, read-only
                                     ▼
                              classify.js         per-domain verdict (pure)
                                     ▼
                              levels.js           hysteresis (pure)
                                     ▼
                              engine.js           roll-up, incidents, state
                                     ▼
                     ┌───────────────┴───────────────┐
                     ▼                               ▼
                remediate.js                    report.js
                 + actions.js                  text / OTH markdown
                     ▼                               ▼
                 io.act()                   ~/.local/state/mythos-guardian
             (disarmed by default)            → Status Center probe
```

Everything crossing the line into the host goes through **`io.js`**, and
nothing else. That is the whole security design in one sentence.

## 2. The modules, and why they are separate

| Module | Job | Pure? |
|---|---|---|
| `levels.js` | the ladder and hysteresis | yes |
| `config.js` | policy, validation, override rejection | yes |
| `io.js` | **the only** filesystem and process boundary | no — by definition |
| `sources.js` | read collectors, one per domain | no — takes `io` |
| `classify.js` | evidence → a domain verdict | yes |
| `actions.js` | the static registry of every possible action | yes |
| `remediate.js` | gates, planning, execution, audit | no — takes `io` |
| `engine.js` | tick, roll-up, incidents, persistence | no — takes `io` |
| `report.js` | rendering for humans | yes |
| `scenarios.js` | synthetic hosts for simulation | yes |

`fs` and `child_process` are required by **exactly one file**. `levels.js`,
`classify.js` and `report.js` require nothing outside their own directory. The
test suite asserts both, because the write boundary and the command allowlist
are only boundaries while there is one way out of the module.

The purity is not aesthetic. It is what makes a synthetic host possible: the
suite injects an `io` over a fixture tree, points `procRoot` at a fake
`/proc`, and replaces `spawn` with a table of canned output. Nothing is
executed and nothing real is read, so the decision logic can be exercised
against states this host may never reach.

## 3. Two clocks, two kinds of confirmation

Guardian consumes components that have already made up their minds, and also
looks at raw kernel state. Those disagree, legitimately, all the time.

- An **upstream-confirmed** level (the Resource Guard's, an OOM counter
  moving, a critical unit down) commits on the first tick that sees it. It has
  already been confirmed by something whose job that is.
- Guardian's **own inference** above that level has to earn two consecutive
  samples.

`levels.step()` takes both: `floor` for the confirmed part, `raw` for the
inferred part. Without that split, one source of confirmed evidence would be
delayed by another source's unconfirmed suspicion.

De-escalation is slower than escalation and passes through `RECOVERY`, so
nothing walks from EMERGENCY to NORMAL in one step.

## 4. The roll-up, and the two health states

```
host level = max( level of each domain Guardian could actually read )
```

A domain it could not read is `unknown`: excluded from the maximum, named in
`host.unknown_domains`, and the host level is flagged `partial`.

**Host health and Guardian health are separate states, in both directions.**
A CRITICAL host with a healthy Guardian is Guardian working. A DEGRADED
Guardian on a healthy host is a Guardian problem. `BLIND` means Guardian is
running and can read nothing, and then every green level below it is
unverified.

This is why the Status Center probe reports *Guardian* health only. Memory,
disk, services and backups already have probes there; a Guardian probe that
turned red for a full disk would count one outage twice.

## 5. Where state lives

```
~/.local/state/mythos-guardian/     0700
  state.json        hysteresis, incident, OOM counter, restart history,
                    action cooldowns — rewritten atomically each tick
  report.json       the last verdict; what the Status Center probe reads
  ticks.jsonl       one line per tick, rotated
  incidents.jsonl   open / escalate / close events, rotated
  actions.jsonl     the audit trail of actions actually taken, rotated
  guardian.lock     single-instance sentinel
```

Rotation keeps `keep` generations and drops the oldest **by renaming over
it** — Guardian has no delete primitive and is not acquiring one for log
rotation. History is bounded by `(keep + 1) × max_bytes` and by renames only.

`io.assertOwnState()` resolves every write path and throws unless it is this
directory or beneath it. The single exception is `publishAdvisory()`, which
writes one named file in one configured directory and is described in §7.

## 6. One tick

```
lock ─ collect ─ classify ─ hysteresis ─ roll-up ─ guardian health
     ─ incidents ─ plan remediation ─ [execute] ─ persist ─ report
```

- **lock** — a live tick that finds it held skips and says so. A dry run never
  takes it, so investigating an incident cannot block the tick recording it.
- **collect** — has a 45-second wall-clock budget. Domains not reached become
  `unknown`. Under real pressure this host slows everything down: a tick
  during the 2026-09-16 memory event took 76 seconds against a median of 0.8.
  A verdict that arrives beats a complete verdict that does not.
- **plan** — always computed, even in observe-only, because *"what would
  Guardian do about this, and why not"* is exactly what an operator wants
  during an incident.
- **execute** — only from `remediate --execute`. The scheduled tick
  (`run`) never executes, whatever the configuration says, so a timer and a
  deliberate change can never be confused for one another.

## 7. The action path

```
  plan ─► 10 gates ─► approved ─► io.armed = true
                                      │  exactly one operation
                                      ▼
                            io.act(argv)   │   io.publishAdvisory(dir,name,body)
                            ACTION_COMMANDS│   one file, validated name,
                            allowlist      │   no symlinked destination
                                      ▼
                                 verify() ─► audit record ─► io.armed = false
```

`ACTION_COMMANDS` is a **second** allowlist, never merged with
`READ_COMMANDS` and asserted disjoint from it. `io.armed` is false at every
moment except inside one deliberate call, and is cleared in a `finally`.

`PROTECTED` refuses ERP, databases, backups, credentials, repositories and
production containers by substring, plus thirteen units by name — at gate 6,
before the allowlist is consulted.

## 8. What Guardian is not allowed to become

These are the constraints that keep the design honest, and each has a place
in the code that enforces it:

| Constraint | Enforced by |
|---|---|
| no second source of truth | `sources.js` reads published state; `D2` |
| no arbitrary command | two fixed allowlists of argv **prefix arrays** |
| no arbitrary path write | `io.assertOwnState()` |
| no deletion | no primitive exists |
| no ERP, database, backup or credential | `PROTECTED`, gate 6 |
| no runtime-defined action | `actions.js` is static; `actionsMod.get()` |
| no config that widens behaviour | invalid overrides are ignored wholesale |
| no unbounded work | tick budget, spawn timeouts, bounded reads |
| no unbounded action | cooldown, daily ceiling, per-tick budget |
| no restart storm | `max_attempts`, then DEGRADED and left alone |

## 9. Deployment

One oneshot user unit and one timer, both owned by `deploy`. Guardian is
unprivileged: everything it reads is world-readable or already deploy's, so
root would buy nothing and widen the blast radius of an observer.

The unit's sandboxing directives are **inert** in a systemd user manager on
this host — measured, and documented in `MYTHOS_GUARDIAN_SECURITY.md` §5. The
enforced boundary is the code's, not the unit's. The directives are kept
because they are correct if Guardian is ever run as a system unit.

The installed CLI is a **symlink** into the production checkout, so the
command and the merged code cannot drift apart.

## 10. Reading order for someone new

1. `docs/MYTHOS_GUARDIAN.md` — what it does.
2. `ops/guardian/lib/levels.js` — the whole decision model, 110 lines, pure.
3. `ops/guardian/lib/io.js` — the entire security surface, one file.
4. `ops/guardian/lib/actions.js` — everything it can ever do.
5. `docs/MYTHOS_GUARDIAN_DECISIONS.md` — why, including what was wrong first.
