# MYTHOS Resource Guard

Host-memory admission control for the AI executor (GitHub Issue #101, built on the
investigation recorded in `control/reports/gh-issue-101.json` and Issue #99).

The guard answers exactly one question, every 15 seconds:

> **May a NEW AI task start on this host right now?**

It never kills a process, never touches a cgroup or a systemd unit, never changes a
task's status, and never cancels work. Under pressure a task simply stays `QUEUED`
and starts later, by itself.

---

## 1. Signals

| Signal | Source | Role |
|---|---|---|
| `MemAvailable` | `/proc/meminfo` | primary — what a new process can actually get |
| PSI memory `some avg60` | `/proc/pressure/memory` | how hard reclaim is working (leads the kills) |
| `oom_kill` delta | `/proc/vmstat` | kills that already happened |
| Swap used % | `/proc/meminfo` | **reported only — never a trigger** |

**Why swap is not a trigger.** Measured on this VPS: swap sits at 96–100 % used for
days while `MemAvailable` is ~2.5 GiB and PSI is `0.00`. A swap-percentage trigger
would park a provably healthy host in `CRITICAL` permanently. The committed telemetry
excerpt `tests/fixtures/resource-guard/memwatch-healthy.txt` (96–98 % swap, zero
transitions) is the regression test for that rule.

A missing signal degrades to `null` independently: a kernel without PSI still gets
`MemAvailable`-based protection.

---

## 2. States and thresholds

`NORMAL` → `WARNING` → `CRITICAL`. `RECOVERED` is the one-shot **alert kind** emitted
on the degraded → `NORMAL` edge (the resting state after recovery is `NORMAL`).

| Transition | Condition |
|---|---|
| enter `CRITICAL` | `MemAvailable ≤ 700 MiB` **or** `psi60 ≥ 30` **or** `oom_kill` delta > 0 |
| exit `CRITICAL` | `MemAvailable ≥ 1100 MiB` **and** `psi60 ≤ 10` **and** no new kills |
| enter `WARNING` | `MemAvailable ≤ 1200 MiB` **or** `psi60 ≥ 5` |
| exit `WARNING` | `MemAvailable ≥ 1600 MiB` **and** `psi60 ≤ 2` |

Hysteresis is enter/exit thresholds **plus** a confirmation count:

* **2 consecutive samples to escalate** (~4 min at the 2-minute sampler cadence, one
  sample per executor tick at 15 s in the daemon),
* **5 consecutive samples to de-escalate** (~10 min),
* **exception:** an `oom_kill` delta escalates to `CRITICAL` on the first sample — a
  kill is a confirmed event, not a noisy gauge. Leaving `CRITICAL` still costs the
  full 5-sample de-escalation.

Alerts are rate-limited to **one per kind per 30 minutes**. A suppressed alert still
records its transition (`alert_suppressed: "cooldown"`); the ledger stays truthful,
only the notification is throttled.

---

## 3. Enforcement points

Only **admission** is gated. Everything already admitted is a continuation and is
exempt, so in-flight work stays resumable:

| Path | Gated? | Note |
|---|---|---|
| `tick()` step 4 — start next `QUEUED` | **yes** | covers n8n intake **and** `requested_by='github-bridge'`, which never passes through the dispatcher |
| `dispatchTask()` — console start | **yes** | checked before the capacity check: a free slot on an out-of-memory host is not a slot |
| `drainQueue()` — console drain | **yes** | re-checked per iteration, so pressure starting mid-drain stops it |
| `tick()` step 1 — interrupted recovery | no | continuation |
| `tick()` step 2 — quota resume | no | continuation |
| `tick()` step 3 — retry | no | continuation |
| `runTask()` direct call | no | an explicit operator/bridge action, not an admission |

`WARNING` still admits: it is the watch band. Only `CRITICAL` — two confirmed samples
or a real kill — closes the door.

A refused admission appends `dispatch_deferred` with `reason: "resource_pressure"` to
the task's own event log, at most once per task per 10 minutes (the decision repeats
every tick; the event does not, so a pressure episode cannot bury a task's history).
`drainQueue()` is now also called once per daemon step, so a queue held back by
pressure re-drains after recovery without any manual re-queue — previously the drain
was edge-triggered only and had no event left to restart it.

---

## 4. Operating it

```bash
# current level, the sample behind it, and whether admission is open
node projects/mythos-ai-executor/bin/mythos-resource-guard status

# take one live sample (advances the state machine)
node projects/mythos-ai-executor/bin/mythos-resource-guard sample

# replay recorded telemetry through the PRODUCTION decision function
node projects/mythos-ai-executor/bin/mythos-resource-guard replay \
     /opt/mythos-memwatch/memwatch.log --transitions
```

HTTP (executor API, bearer token required): `GET /resource-guard`.

**Kill switch:** start the executor with `MYTHOS_RESOURCE_GUARD=off`. Nothing is then
sampled and every admission proceeds as before the guard existed.

**State files** (under `MYTHOS_EXECUTOR_HOME`, default `~/.mythos-ai-executor`):

* `resource-guard.json` — level, confirmation counters, kill baseline, per-kind alert
  timestamps, last 50 transitions. Atomically written; a corrupt file restarts the
  machine at `NORMAL` rather than throwing.
* `resource-guard-alerts.jsonl` — durable append-only alert ledger.

**Fail-open, by design.** Unreadable `/proc`, an unwritable state directory, a corrupt
state file: none of them may block admission. Sustained unreadable telemetry (5
samples) releases a degraded level back to `NORMAL` with
`reason: "telemetry_unavailable"`. The guard protects the host from MYTHOS; it must
never become a new way for MYTHOS to stop working.

---

## 5. Alerts

Alerts leave through the existing orchestrator notification path
(`projects/mythos-orchestrator/notify.sh`, fire-and-forget, always exits 0) and are
appended to `resource-guard-alerts.jsonl` regardless of delivery.

**WhatsApp is not wired.** `bridge/notify/whatsapp.js` does not exist on this line —
it lives on the sibling branch `mythos/gh/gh-20260902-wa-bridge-notify-01` (`b37491f`),
whose tree also deletes `bridge/github-issues.js`. Merging the two lines is an owner
decision (see the gh-issue-101 investigation report). Because every alert is in the
ledger, a sender added later can deliver from history without losing anything. Its
`KINDS`/`KEY_RE` fence would need widening for `WARNING`/`CRITICAL`/`RECOVERED`, which
is itself an owner decision.

---

## 6. Still requiring owner action

* **Essential-service protection** (`MemoryLow=` on production units, `MemoryHigh=` on
  the AI units) is a systemd change under `projects/mythos-ai-executor/service/`
  (governance-protected) and `~deploy/.config/systemd/user/`. No agent may install it.
* **WhatsApp branch integration** (above).
* **The dominant memory consumer is outside MYTHOS control** — root agent session
  scopes have repeatedly held 2–2.5 GB against the executor's ~0.5–0.7 GB. The guard
  correctly refuses to start MYTHOS work in that state, but it cannot reclaim that
  memory; only the systemd work above changes who loses memory first.

---

## 7. Validation

`tests/resource-guard-test.js` (91 checks, offline, fixture `/proc` files, mock
provider, no real notification) covers signal parsing, every threshold and both
confirmation counts, the swap non-trigger, the alert cooldown, one-shot `RECOVERED`,
restart persistence and corrupt state, fail-open, the executor admission paths
(bridge task deferred, retry exempt, console dispatch/drain gated, recovery →
automatic start), the kill switch, and the HTTP view.

Replayed against real telemetry (`/opt/mythos-memwatch/memwatch.log`, 911 samples,
2026-09-01 17:21 → 2026-09-02 23:42): 10 transitions, `CRITICAL` continuously from
2026-09-01 21:03 through the 22:16–22:18 mass kill until 2026-09-02 02:16 — the guard
was already refusing admissions **before every kill burst in the window** — and
`NORMAL` for the whole healthy remainder at 96–100 % swap.
