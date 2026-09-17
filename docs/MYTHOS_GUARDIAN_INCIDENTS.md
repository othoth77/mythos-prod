# MYTHOS Guardian — incidents

How Guardian records an incident, what the record contains, and what a human
does with it.

Version 1.0.0, 2026-09-17.

---

## 1. What counts as an incident

An incident opens when the **host level** reaches `WARNING` or above, and
closes when it falls back below. One incident at a time: a host that escalates
from WARNING to CRITICAL is the same incident getting worse, not a second one.

```
GRD-20260916T230029Z   opened   WARNING   23:00:29
                       escalate HIGH      23:36:52
                       escalate CRITICAL  23:39:39
                       closed             (duration recorded)
```

The id is the opening timestamp. It is stable, sortable, and the same string
appears in `incidents.jsonl`, in `report.json` and in the OTH markdown.

An incident tracks its **peak**, not just its current level, so a spike that
has already decayed is still visible in the record.

## 2. Where the record lives

```
~/.local/state/mythos-guardian/
  incidents.jsonl    incident_opened / incident_escalated / incident_closed
  ticks.jsonl        one line per tick: host, domains, guardian, transitions
  actions.jsonl      every action taken, with before / argv / verification
  report.json        the current verdict in full
```

All rotated, all bounded, none ever deleted — rotation drops the oldest
generation by renaming over it.

## 3. Reading one

```bash
mythos-guardian status      # the current verdict
mythos-guardian incident    # the same, in the OTH incident format
mythos-guardian audit       # what Guardian actually did
```

`mythos-guardian incident` produces the format used for OTH records:

- **Observed at**, tick, mode
- **Host level**, and whether it is partial
- **Guardian health**, and how many domains it could read
- **Incident** id, state, peak, duration, domains involved
- **What Guardian saw** — a row per domain with its evidence
- **Findings** — severity, domain, kind, and the trigger in words
- **Transitions this tick**
- **What Guardian did** — see §4
- **For a human to consider** — non-destructive observations, each with the
  owner decision attached

## 4. "What Guardian did" is never vague

If Guardian took no action, the report says so *and lists what it considered
and why each was refused*, naming the gate:

```
- `ACTION_CLEAR_NPM_CACHE` — level: disk is NORMAL, below HIGH
- `ACTION_RESTART_APPROVED_SERVICE` on `spy-monitor` — precondition:
  spy-monitor is already restarting in a loop — restarting again would hide
  the fault
```

That is the part worth reading during an incident. "Guardian did nothing" is
not useful; "Guardian did nothing because the disk is only at 72 %, and here
is the threshold it is waiting for" is.

If Guardian did act, every action appears with the exact argv, whether
verification passed, and what undoing it costs.

## 5. The audit record

One JSON object per action, appended to `actions.jsonl`:

| Field | Meaning |
|---|---|
| `at` | when |
| `action`, `target` | which action, on what |
| `trigger` | the evidence that made it a candidate |
| `before` | the measured state the precondition recorded |
| `argv` | exactly what ran |
| `mode` | `dry-run` or `executed` |
| `result` | `would-run`, `ran`, `published`, `failed` |
| `verified` | did the effect actually happen |
| `verification` | the measurement, in words |
| `reversible` | what undoing it costs |
| `protects` | what the action asserted it was not touching |
| `error` | if it failed |

A dry run produces the same record with `mode: dry-run` and is **not** written
to history — so simulating an action can never consume its cooldown.

## 6. Severity, and what each actually means

| Level | Meaning |
|---|---|
| `NORMAL` | nothing to do |
| `RECOVERY` | was worse, walking back; do not intervene yet |
| `WARNING` | real, not urgent; look when convenient |
| `HIGH` | acting soon is better than acting later |
| `CRITICAL` | production is at risk now |
| `EMERGENCY` | protect production first, diagnose second |

`partial: true` on any of these means Guardian could not see part of the host.
Fix the visibility before trusting the verdict.

## 7. Three incidents worth knowing about

These are real, from this host, and they are why parts of Guardian look the
way they do.

**2026-09-16 23:38 — memory.** MemAvailable 861 MiB, PSI60 at 37 then 57, swap
fully consumed. Guardian walked `WARNING → HIGH` (23:36:52) `→ CRITICAL`
(23:39:39), escalated the sessions domain as the memory ceiling tightened, and
de-escalated as pressure eased. The CRITICAL tick took **76 seconds** against a
median of 843 ms, because the host was stalled on memory 57 % of the time. That
produced the 45-second collection budget: a verdict that arrives beats a
complete verdict that does not.

**2026-09-14 — a test wrote production.** Four runs of a backup suite wrote
`status: fail, consecutive_failures: 4` into the live ERP backup health
record, through a `$HOME` default. The ERP admin view reported failed for
eleven hours. No backup data was touched. Both suites now pin their health
path and `HOME` in the `run()` helper, and each has a regression that
reproduces the incident's exact shape.

**2026-09-01 20:41 — the episode the Resource Guard was built from.** CRITICAL
was entered 6.7 minutes before the OOM killer fired. That margin is why
Guardian's tick is two minutes and why a confirmed upstream level commits on
the first tick that sees it rather than waiting for a second sample.

## 8. Writing an incident up

For an OTH record or a handover:

```bash
mythos-guardian incident > /tmp/incident.md
```

Then add what Guardian cannot know: what a human changed, what the cause turned
out to be, and what should be different. Guardian records the *observation*
accurately; the *explanation* is yours.

Distinguish, always and in these words: **DISCOVERED / IMPLEMENTED /
COMMITTED / MERGED / INSTALLED / DEPLOYED / ACTIVATED / LIVE VERIFIED /
ENABLED**. An incident write-up that blurs "merged" and "deployed" is how the
next person loses an afternoon.
