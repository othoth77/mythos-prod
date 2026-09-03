# MYTHOS Session Guard

Lifecycle control for **Claude Desktop Remote sessions** on this VPS
(GitHub Issue #144). Sibling of, and deliberately separate from, the
[Resource Guard](MYTHOS_SESSION_GUARD.md#8-relationship-to-the-resource-guard)
described in `docs/MYTHOS_RESOURCE_GUARD.md`.

It answers exactly one question, every five minutes:

> **Which Claude Desktop Remote sessions are provably finished, and may this
> host reclaim them?**

---

## 1. The measured problem

`/root/.claude/remote/srv/<rev>/server --serve` forks one `ccd-cli` process
per Desktop Remote session. When the client goes away the server closes the
connection but **does not reap the session process**. The server has no idle
timeout and no concurrency ceiling, and none can be added to it — it is not
ours.

Measured on this host on 2026-09-03 and committed as
`tests/fixtures/session-guard/host-20260903.json`:

| | |
|---|---|
| Sessions started since 2026-08-30 | 47 |
| Still resident | 14 (15 at the time the issue was filed) |
| RSS per session | 135 – 273 MiB |
| Total held | ~2.6 GiB |
| Oldest | days |
| Owner | `root`, inside `user-0.slice` |

Production services live under `user-1001.slice`. Swap has been at 96–100 %
for days; that is a **historical artefact of accumulated pages, not the root
cause** — the root cause is unbounded process accumulation, and that is what
this guard bounds.

**These are not MYTHOS processes.** The executor's own Claude subprocess runs
as `deploy` with argv `claude -p --output-format json --session-id <uuid> …`
under `mythos-ai-executor.service`. Never confusing the two is the module's
first responsibility, not an afterthought.

---

## 2. Classification

`lib/session-guard.js` sorts every process on the host into four kinds. Only
one is ever a reclamation candidate.

| kind | matched by | treatment |
|---|---|---|
| `executor` | `claude -p …`, or an argv containing `mythos-ai-executor` / `mythos-github-bridge` | **absolutely protected**, checked FIRST |
| `remote-server` | `/…/.claude/remote/srv/<rev>/server` (`--serve` and `--bridge`) | protected |
| `remote-session` | argv path under `/…/.claude/remote/ccd-cli/` | the only candidate kind |
| `other` | everything else | protected by omission |

The executor test runs **before** the session test, so a process whose argv
somehow matched both patterns is classified `executor` and can never be
signalled. The reverse ordering would be the one catastrophic bug in this
module; `tests/session-guard-test.js` pins it directly.

The `executor` class is deliberately over-inclusive — any argv mentioning the
executor is protected. Over-matching costs a session that is not reclaimed;
under-matching would cost a running MYTHOS task.

### Identity, not PID

A session is keyed by `pid:starttime` (the kernel's own incarnation field),
not by PID. A recycled PID therefore inherits no idle history and no pending
SIGKILL escalation. Identity is **re-verified from `/proc` immediately before
every signal** (`verifyIdentity()`): a PID recycled between the plan and the
signal is aborted and recorded, never signalled.

Where the argv carries `--resume=<uuid>` or `--session-id <uuid>`, that uuid
is recorded as `session_ref` and used to locate the session's transcript.

---

## 3. Session states

| state | meaning |
|---|---|
| `active` | at least one activity signal moved inside the idle window |
| `idle` | no activity signal moved for `idle_seconds` |
| `orphaned` | the forking server is gone — nothing can ever reconnect |
| `terminating` | SIGTERM sent; awaiting exit or the SIGKILL escalation |
| `exited` | gone; retained 24 h so a confirmed termination stays auditable |

Three **independent activity signals**, ORed. Any one keeps a session alive,
so a session is declared idle only when every available signal says nothing
happened:

1. **CPU ticks** (`utime + stime` from `/proc/<pid>/stat`) — the primary signal.
2. **RSS movement** of at least `rss_activity_mib` (8 MiB) — smaller changes are noise.
3. **Transcript mtime** of `<session_ref>.jsonl` under `/root/.claude/projects/` —
   present when the guard runs as root, `null` (never wrong) when it does not.

On **first sighting** `last_active_at` is set to *now*, never to the process
start: "no history" must never read as "idle since boot". A session is
therefore never reclaimable on the run that first sees it.

---

## 4. Decision rules, in order

Each rule declares the inactivity it requires; a rule can never be more
permissive than its own threshold.

| # | rule | signal | required inactivity |
|---|---|---|---|
| 1 | `sigterm_ignored` | SIGKILL | 0 — a session already SIGTERMed may legitimately burn CPU shutting down |
| 2 | `orphaned` | SIGTERM | 0, but only after `orphan_grace_seconds` (5 min) of settled orphanhood |
| 3 | `idle_timeout` | SIGTERM | `idle_seconds` (1 h), or `pressure_idle_seconds` (15 min) under memory pressure |
| 4 | `concurrency_limit` | SIGTERM | `concurrency_idle_seconds` (10 min) |

### Fences (`veto()`), evaluated for every candidate

A non-null veto reason blocks the signal and is written to the ledger. No
rule can bypass any of them.

`not_a_remote_session` · `pid_explicitly_protected` · `refuses_init` ·
`has_child_processes` · `cpu_telemetry_unreadable` · `age_unknown` ·
`below_min_age` (15 min) · `single_observation` · `orphan_grace_not_elapsed` ·
`recent_activity` · `max_terminations_per_run`

**Blast radius:** at most `max_terminations_per_run` (3) sessions per run.
The deferred excess is recorded as a veto, never silently dropped.

**Escalation:** SIGTERM first, always. SIGKILL only after
`sigkill_grace_seconds` (120 s), only when the session is still present,
still the same incarnation and still classified `remote-session`, and only
when `escalate` is on.

---

## 5. Concurrency guard

Default ceiling **6** concurrent sessions; hard cap **8**, which cannot be
configured upward — a larger value is clamped and the clamp is reported as
`max_sessions_clamped`.

**The ceiling is enforced by reclamation, not by admission — and the
distinction is real.** The Desktop Remote server is closed to us and exposes
no admission hook, so nothing here can refuse its fork. What the guard can do
is bring the population back under the ceiling within a tick by reclaiming
sessions that have been quiet for at least `concurrency_idle_seconds`, oldest
first, and exactly the excess — never more.

`admission()` therefore returns an **advisory** signal (`GET /session-guard`,
`mythos-session-guard status`) for an operator, a shell profile or a future
hook to consult. It is labelled `advisory: true` in every response. A breach
that cannot be resolved without touching a working session is reported as
`unreclaimable` and left alone — the cap must never become a reason to kill
live work.

---

## 6. Memory-pressure guard

Three independent layers, none of which can OOM-kill anything:

1. **Lowered idle threshold.** At `WARNING` or `CRITICAL` the idle timeout
   drops from 1 h to 15 min, so reclamation starts *before* the kernel is
   choosing victims. Pressure lowers a threshold; it never removes a fence.
2. **`ops/session-guard/user-0.slice.d/memory.conf`** — `MemoryHigh=2G` on
   the root login slice that holds the sessions. A soft throttle: crossing it
   applies reclaim pressure to that slice first. `MemoryMax` is deliberately
   **not** set — a hard cap there would OOM-kill a root process at an
   arbitrary moment, exactly the uncontrolled outcome this issue forbids.
3. **The guard's own unit is capped** (`MemoryMax=192M`, `CPUQuota=25%`,
   `OOMScoreAdjust=500`) so it can never be the cause of pressure and is an
   early victim if it ever is.

The memory level is **read from the Resource Guard**, never recomputed:
gh-issue-101 owns the thresholds, the hysteresis and the rule that swap is
reported and never a trigger. A Resource Guard state file older than five
minutes is ignored and read as `NORMAL` — a stale file must never be a reason
to reclaim.

---

## 7. Operating it

```bash
# classified process view: sessions, servers, and the protected executor set
node projects/mythos-ai-executor/bin/mythos-session-guard inventory

# counts, ceiling, memory level, advisory admission, enforcement state
node projects/mythos-ai-executor/bin/mythos-session-guard status

# exactly what enforcement would do, and every veto that stopped it
node projects/mythos-ai-executor/bin/mythos-session-guard plan

# one tracking sample (advances idle history, signals nothing)
node projects/mythos-ai-executor/bin/mythos-session-guard observe

# apply the plan — requires --yes AND the enable marker
node projects/mythos-ai-executor/bin/mythos-session-guard enforce --yes

# lifecycle ledger
node projects/mythos-ai-executor/bin/mythos-session-guard ledger -n 40
```

HTTP (executor API, bearer token required): `GET /session-guard`. That route
is **strictly observational** — it calls `snapshot()`, which never writes the
guard's state and never signals a process, so polling it can neither advance
an idle clock nor race the enforcing unit. There is no `POST /session-guard`:
the HTTP surface cannot terminate a session.

### Switches

| | |
|---|---|
| enable | `touch /var/lib/mythos-session-guard/session-guard.enabled` |
| rollback | `rm /var/lib/mythos-session-guard/session-guard.enabled` |
| hard off | `MYTHOS_SESSION_GUARD=off`, or `systemctl disable --now mythos-session-guard.timer` |
| protect a pid | `MYTHOS_SESSION_GUARD_PROTECT=<pid>[,<pid>…]` |

`enforce --yes` **without** the marker is not an error: it runs the full
cycle with enforcement off, so idle history accumulates and the plan can be
watched before enforcement is turned on. That is what makes the timer safe to
install before the decision to enforce is taken.

### Files

Under `MYTHOS_SESSION_GUARD_HOME` (`/var/lib/mythos-session-guard` for the
root unit) or `MYTHOS_EXECUTOR_HOME` (for the CLI):

* `session-guard.json` — tracked sessions, idle clocks, orphan clocks,
  pending terminations, last 50 events. Written atomically, mode 0600; a
  corrupt file restarts tracking rather than throwing.
* `session-guard.jsonl` — append-only lifecycle ledger: `session_seen`,
  `session_state`, `session_exited` (with `terminated_by_guard` and the
  reason), `terminate_signalled`, `terminate_aborted`, `terminate_failed`,
  `terminate_vetoed` — each with pid, session uuid, age, idle seconds, RSS
  and the evidence behind the decision.

---

## 8. Relationship to the Resource Guard

They are not the same guard and must not be merged.

| | Resource Guard (gh-issue-101) | Session Guard (gh-issue-144) |
|---|---|---|
| Question | may a new MYTHOS task start? | which Desktop Remote sessions may be reclaimed? |
| Subject | MYTHOS's own work | processes MYTHOS does not own |
| Enforcement | admission only; never touches a process | SIGTERM, then SIGKILL after a grace window |
| Failure posture | **fail-open** — unreadable telemetry must never block MYTHOS | **fail-closed** — no evidence, no signal |
| Owns memory thresholds | yes | no: it reads the level from the Resource Guard |

The Session Guard consumes the Resource Guard's level and adds nothing to it.
`ops/oom/user@1001.service.d/oom.conf` (kill-priority parity for the deploy
user manager) is a third, independent layer and is unchanged by this work.

---

## 9. Installation (owner action)

Root-owned system units and `/usr/local` writes are outside every agent's
permission boundary. Nothing here is installed by an agent.

```bash
sudo bash ops/session-guard/install-session-guard.sh
```

The installer copies **exactly two files** — `lib/session-guard.js` and
`ops/session-guard/mythos-session-guard-run.js` — into
`/usr/local/lib/mythos-session-guard/` as `root:root`, creates
`/var/lib/mythos-session-guard` (0700), installs the unit and timer, and
enables the timer. Root must never execute code from the deploy-writable
checkout, so **re-run the installer after any merged change to either file**.

It does **not** create the enable marker. After installation the guard runs
every five minutes in observe mode and signals nothing. Watch it, then
enable:

```bash
journalctl -u mythos-session-guard.service -f          # one JSON line per run
cat /var/lib/mythos-session-guard/session-guard.jsonl  # the durable ledger
touch /var/lib/mythos-session-guard/session-guard.enabled   # enable
rm    /var/lib/mythos-session-guard/session-guard.enabled   # rollback
```

The optional soft memory ceiling on the root login slice
(`ops/session-guard/user-0.slice.d/memory.conf`) is a **separate owner
decision** with its own install and rollback instructions in the file header.

---

## 10. Validation

`tests/session-guard-test.js` — **274 checks, offline, deterministic.**
Nothing signals a real process: every enforcement test injects a `killFn`
that records the call instead of making it, and the scanner runs over
synthetic `/proc` trees built in a temp directory through the documented
`proc_root` override.

Covered: `/proc` parsing (including a `comm` containing spaces and
parentheses, and the USER_HZ regression that made an unresolved config
produce a `NaN` age); classification and the executor-precedence rule;
identity keying and PID-reuse; the three activity signals; idle, orphan,
concurrency and pressure rules; every fence; the blast-radius cap; SIGTERM →
SIGKILL escalation and its grace window; identity re-verification aborting a
recycled PID, a vanished process and an executor subprocess; the kill switch
and enable marker; fail-closed behaviour on unreadable `/proc`, unreadable
`stat` and a corrupt state file; state and ledger persistence; the read-only
`snapshot()` proving observation writes nothing; the systemd artifacts; the
root runner end to end in the installed layout (observe, kill switch,
enforce, stale and fresh Resource Guard states); and the operator CLI,
including that `enforce` without `--yes` refuses.

The classification regression runs against the **real** 2026-09-03 capture
(`tests/fixtures/session-guard/host-20260903.json`, argv truncated to 280
chars, every UUID replaced with a deterministic placeholder, the remote
server's `--token-file` name redacted): 14 root-owned Desktop Remote
sessions, 2 servers, and the deploy-owned executor processes — each
classified as recorded, over 2 GiB held, over the ceiling by eight, and
**zero actions on first observation**.
