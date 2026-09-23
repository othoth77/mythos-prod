# Mythos Haddad V2.5 — the AI Team Console

> Companion to [TELEMETRY.md](TELEMETRY.md), which holds the transport, the
> signing and the thresholds, and to [AI_TEAM.md](AI_TEAM.md), which holds
> the roles this document makes visible. What is NOT done, and the one
> question this phase could not answer for itself, are stated at the end.

## The finding this phase turned on

V2.5 began as "build the console". It is not: **the console was already
running.** Measured on the node before a line was written, and again after:

```
sent seq=1790152060 -> HTTP 202 {"ok":true,"node":"haddad","seq":1790152060,"state":"ONLINE"}
```

`mythos-haddad-telemetry.timer`, every ten seconds, HTTP 202, `ONLINE`. The
envelope it pushes carries `health.schema = mythos-haddad-health/1` with
`{PASS:16, WARN:0, FAIL:0}`, **61 events**, 6 workers, 3 incidents, plus GPU,
resources, runtime and repo identity. `haddad-telemetry.js` reads
`state.readText(taskId, 'events.log')` and ships the last eighty.

So V2.5 was never a build. It was an audit that found **one** real gap, and
that gap was in the publisher, not the page.

## The gap: the console could not see its own decisions

`grep role projects/mythos-haddad/bin/haddad-telemetry.js` returned **zero
hits**. The console showed a task's provider and model — *who* ran the work
and *with what* — and said nothing about the **role**, which is the decision
V2.1 exists to make and which the V2.5 field list asks for by name
("workers/roles"). However the page had been written, the field was not
there to show.

This is the sixth instance of the pattern this V2 run kept producing: *a
mechanism exists and nothing reaches it.* `sanitizeTask()` on the receiver
had carried `validation` and `review` for months; `task.json` had carried
`role` and `role_reason` since V2.1; nothing joined them.

## What V2.5 changed — three lines of substance, in three places

| File | Change |
|---|---|
| `bin/haddad-telemetry.js` | publishes `role` and `role_reason`, read straight off `task.json`. Nothing is derived, so a task written before roles existed publishes `null` rather than a guess. |
| `status-center/haddad/lib/node-state.js` | the allow-list gains exactly those two keys, bounded at 40 and 80 characters and scrubbed like every other published string. |
| `sites/status.mythosprod.xyz/assets/haddad.js` | a **Role** row beside Provider, with the reason next to it. |

Role and reason share one row because either alone invites the wrong read: a
bare role looks like a label someone typed, and a bare reason says nothing
about what ran.

Verified end to end on the live node, through the real allow-list:

```
node envelope current_task.role        = "researcher"
node envelope current_task.role_reason = "action:investigate"
after the receiver allow-list: role    = "researcher" | reason = "action:investigate"
task: t-20260923075021-147rik | action github:gh-issue-411 | provider haddad-agent
state derived with the role present    = ONLINE
```

That last line is a guarantee, not a note: **the role changes what is
displayed and never what the node is.** What a node *is doing* decides its
state; *who* decided the work must not. It is pinned by a test that derives
the state twice from identical snapshots differing only in role and asserts
the two results are equal.

## The exit gate, item by item

`tests/haddad-ingest-test.js` — **154 assertions, 0 failing** (138 before).

- **Console reads only published state; zero write paths.** Not "no write
  route was added" — the receiver has two routes, anything but `POST /ingest`
  is refused, and it opens no outbound connection and spawns no process, so
  there is nothing for a write path to be built out of. The page holds no
  node address, no runtime port and no MCP tool name. The direction of the
  whole system is node→VPS; a console that could act would need a channel
  that does not exist.
- **`WARN` + `mode: quick` + `FAIL: 0` is not alerted as unhealthy.** Already
  held and still held: that snapshot derives `ONLINE`.
- **Schema pinned to `mythos-haddad-health/1`.** Held in production — a
  foreign schema is refused with 400.
- **No second monitoring stack.** The page renders the health report the node
  already produces and computes no health of its own.
- **STD-1**: telemetry 168/0 unchanged against main, status-center 81/0,
  console 1438/0, and the eleven Haddad suites unchanged.
- **STD-2**: two keys added to an existing allow-list and one row to an
  existing table. No new collector, transport, store or page.
- **STD-3**: the two new fields are bounded, control-character-scrubbed, and
  proved not to smuggle anything beside them — the role *brief* is not
  published, only the role name, and `next_action` remains excluded.

Each new guarantee was mutation-checked rather than assumed. Removing the
allow-list entry fails 4; unbounding it fails 2; mutating the page's read
fails 1; deleting the Role row fails 2. The page check had to be tightened
first: `indexOf('task.role')` passed while the row was mutated away, because
`task.role_reason` contains it as a substring. **A check that cannot fail is
not a check** — the same defect as the dormant `needs_gpu` rule in V2.3.

## What is NOT done

**The routing decision is not on the console.** V2.2 records it per task —
`exec.routing`, kept whole in the bridge's claims file — so the gate item
"recorded and auditable per task" is met. But it lives in the bridge's store
under `cfg.home`, and telemetry reads the *executor's* store. Publishing it
would mean the console reading a second store, which is the beginning of
exactly the second monitoring stack this gate forbids. The honest place to
fix it is the bridge writing its decision onto the attempt the executor
already keeps, which is a change to the VPS-critical dispatch path and does
not belong in a console phase. Recorded here rather than worked around.

**Deploy is unchanged and still the owner's gate.** Both halves of this
change are in this repo; the deployed VPS receiver runs the previous
allow-list until it is deployed, and until then it will drop `role` on
arrival. That is fail-closed and safe: the node publishes a field the
receiver ignores, which is the same thing that happens to every field added
before its deploy.

## The question this phase could not answer for itself

**The V2.5 gate names two sources that the console's host cannot reach.**

> "It must consume the existing `haddad_health` MCP tool and the
> `core/events.js` stream."

- `core/events.js` is required by `core/campaign.js`, `core/core-wiring.js`,
  `core/campaign-runner.js` and `core/orchestrator.js`, and by nothing else.
  `executor.js` does not require it and does not emit through it. With
  `MYTHOS_CORE_ENABLED=false` that stream is not produced at all. What the
  live executor emits is `lib/lifecycle` plus 24 `state.appendEvent` sites
  writing per-task `events.log` — and `events.log` is what the console has
  consumed since Track A.
- The console is served from the VPS. The VPS has no Tailscale and no
  VPS→Haddad SSH — registering one is a pending owner decision — and
  `OTH_MCP_HADDAD_HEALTH_FILE` is unset there, so `haddad_health` does not
  exist as a tool on that host. What the VPS has is `health.summary`, pushed
  by the node, read from the same `health-latest.json` the MCP tool reads,
  under the same pinned schema.

So both named sources are already served by live equivalents, and the gate's
sentence is stale rather than unmet. **Correcting a merged plan's gate is not
an implementer's call**, so it is recorded here and put to the owner —
see §"Open owner decisions" in
[MYTHOS_HADDAD_V2_MASTER_PLAN.md](MYTHOS_HADDAD_V2_MASTER_PLAN.md). The
implementation above stands either way: it adds visibility to sources the
console already consumed and re-points nothing.
