# MYTHOS Guardian — design decisions

Why Guardian is shaped the way it is, what was rejected, and what the first
attempt got wrong. Written 2026-09-16 for Guardian 0.1.0.

---

## D1. Observe first, act never (in this version)

**Decision.** Version 0 observes, classifies and reports. It has no
remediation of any kind.

**Why.** The first implementation (PR #283) could restart units, and its
review found it would have restarted units an operator had deliberately
stopped, with a restart budget that refilled forever. That is not a bug to
patch. It is what happens when a component that has not yet earned trust is
given the ability to act.

The ordering is deliberate: prove the observation is correct, let it run
against the real host long enough to be boring, and only then discuss what may
act on it. A wrong observation that only writes a file is a wrong file. A
wrong observation that restarts `erp-api` is an outage.

**Consequence.** The `allow_*` flags exist in the configuration and must all
be `false`. They are not a switch waiting to be flipped — the code they would
enable does not exist. They are there so that the enablement path is explicit,
testable, and visible in the report, rather than appearing later as a surprise.

## D2. Consume, never duplicate

**Decision.** Every signal is read from the component that already owns it.
Guardian re-implements nothing.

**Why.** PR #283 contained its own memory state machine, its own session
counting and admission logic, its own disk and backup verdicts, its own
version of the hostops read verbs, and its own maintenance scheduler. Six
duplications. Each one is a second source of truth that can disagree with the
first, and a second thing to keep correct when the host changes.

The Resource Guard's swap decision is the clearest case. It does not trigger
on swap, because this host runs at 97–100 % swap for days while healthy — a
finding that cost a real investigation. A Guardian with its own memory state
machine would have had to rediscover that, or alarm forever.

**Consequence.** Guardian is thin, and it is only as good as its inputs. That
is why a missing input is a first-class state (see D4) rather than an
inconvenience.

## D3. Escalation must not starve

**Decision.** When evidence supports escalation, Guardian tracks the *minimum*
level every consecutive sample supported, and commits that.

**Why.** PR #283 stored a single `pending_level` and reset the counter whenever
the new sample differed. Evidence that alternates between two higher levels —
which is exactly what a threshold edge produces — reset the counter every
sample and never escalated at all. A host oscillating between HIGH and
CRITICAL would have been reported NORMAL indefinitely.

The fix is to ask the right question. Not *"has the same level repeated?"* but
*"what is the highest level that every sample so far agreed on?"* Two samples
of CRITICAL then HIGH both support HIGH, so HIGH commits.

`mythos-guardian simulate oscillating-evidence` demonstrates it, and the
self-test asserts it on the host.

## D4. Unknown is not NORMAL

**Decision.** A domain Guardian cannot read is `unknown`. It is excluded from
the host roll-up, the host level is flagged `partial`, and Guardian's own
health degrades.

**Why.** The default failure mode of a monitor is to go quiet and look green.
Every collector therefore returns an envelope that says whether it worked, and
an absent signal produces an explicit unknown rather than a zero.

**With a correction.** The first cut of this was too aggressive: a missing
Resource Guard publication marked the whole memory domain unknown, which meant
that if the executor stopped publishing while the host was genuinely starving,
Guardian would have reported `NORMAL (partial)`. A domain is unknown only when
it has *no* usable evidence at all. A missing publication degrades Guardian and
raises a finding, but `/proc` is still read and still believed.

## D5. Trust upstream, but verify against the kernel

**Decision.** The Resource Guard's published level commits immediately as a
floor. If the kernel reads *worse* than that level, Guardian reports the
kernel's level, but only after its own two samples.

**Why.** Trusting the published level unconditionally means a wedged or
mis-thresholded Resource Guard holds Guardian at NORMAL while the host
starves — the same masking class the #283 review objected to, just relocated
upstream. This was observed live during development: at 22:29 the publication
read NORMAL while `MemAvailable` was 906 MiB and swap was fully consumed.

Ignoring the published level instead would rebuild the Resource Guard inside
Guardian, which D2 forbids.

So: believe it, and check it. The thresholds Guardian uses for the check are
the Resource Guard's *own* enter thresholds, which means Guardian can never
call pressure earlier than the RG would. It can only notice when the RG has
stopped agreeing with the kernel — and it says so, as a
`pressure_disagreement` finding, instead of silently overriding it.

The two-sample delay is what keeps this from being noise: the RG's confirmation
delay produces a tick or two of legitimate disagreement on every real event,
and a single tick of it is not an alarm.

## D6. Host health and Guardian health are different things

**Decision.** Two independent states, always reported separately.

**Why.** "The monitor is broken" and "the host is broken" require different
people to do different things, and conflating them makes both invisible. A
CRITICAL host with a healthy Guardian is Guardian working correctly. A DEGRADED
Guardian on a healthy host is a Guardian problem.

**Consequence for the Status Center.** The `guardian-lifecycle` probe reports
Guardian health only. Memory, disk, services and backups already have probes
there; a Guardian probe that turned red for a full disk would count one outage
twice and make the board harder to read, not easier.

## D7. NOT_INSTALLED is not DOWN

**Decision.** With no report file and no installed timer, the Status Center
probe reads `NOT_MONITORED`.

**Why.** The #283 probe would have reported DOWN the moment it merged —
before anyone had installed anything — turning a public status board red for
software that had never been deployed. A status board that cries wolf about its
own unreleased components trains people to ignore it.

DOWN is reserved for a Guardian that *is* installed and has stopped reporting,
or has gone blind. Those mean the observer has failed, and every green state
below it is unverified. That is worth a red light.

## D8. Unprivileged, deliberately

**Decision.** Guardian runs as `deploy` and the installer refuses to run as
root.

**Why.** Everything Guardian reads is world-readable (`/proc`, the Option C
publication, the Status Center output) or already owned by deploy (the backup
health records). Root buys nothing. It would only widen the blast radius of a
component whose entire job is to read.

This is also what makes the Option C work (PR #286) pay off. The session
guard's problem was the opposite — it is root but restricted to `CAP_KILL`, so
it could not read the executor's private state. The answer there was to publish
a minimal `{level, updated_at}` file rather than to widen root. Guardian reads
that same file. Neither component got more access; a narrow, explicit channel
was created instead.

**The unit is the second line.** `ProtectSystem=strict` with exactly one
`ReadWritePaths` entry. The code refuses to write outside its state directory,
and so does the kernel.

## D9. A simulation must not be able to touch the host

**Decision.** `simulate` drives synthetic collectors and always ticks dry.

**Why.** In PR #283, `simulate status-center-down` executed live ticks that
wrote Guardian state and could act if action markers existed, and `simulate
all` included it. A command whose entire purpose is "show me what would
happen" must not be able to make it happen.

Here the scenario *is* the data: `collectors` is a plain object of functions
returning fixtures, `dry_run` is set by the CLI, and the engine returns before
any write path when it is set. There is no argument that makes `simulate` live.

## D10. A dry run does not take the lock

**Decision.** `run --dry-run` never acquires the single-instance lock.

**Why.** PR #283 had no mutual exclusion at all between a manual run and the
timer. Adding a lock fixes that, but a naive lock creates a new problem: an
operator investigating an incident with `--dry-run` would block the scheduled
tick that is recording it.

A dry run changes nothing, so it cannot conflict with anything, so it does not
need the lock. A live tick that finds the lock held skips and says so, rather
than racing.

## D11. Two minutes

**Decision.** The timer runs every two minutes, and confirmation takes two
samples.

**Why.** Two minutes matches memwatch's sampling interval and the Resource
Guard's cadence, so Guardian never reports on evidence older than one upstream
sample — a faster tick would re-report the same numbers and a slower one would
lag them.

A sustained condition is therefore confirmed in about four minutes, and a
confirmed upstream event (an OOM kill, an RG CRITICAL, a down critical unit) is
reported on the first tick that sees it. For context: in the 2026-09-01
episode the Resource Guard entered CRITICAL 6.7 minutes before the kill.

`Persistent=true` is deliberately not set. Guardian reports on the host as it
is now; a catch-up tick after a reboot would only re-report a moment that has
already passed.

## D12. Rejected alternatives

**Beszel** (or any off-the-shelf host monitor). Evaluated and not adopted. It
would give dashboards and historical graphs, which is real value, but it
answers "what are the numbers" and not "what does this host's own ops stack
conclude". It cannot read the Resource Guard's level, the session guard's
ledger, the backup health records or the Status Center's verdicts, which are
precisely the signals that matter here. It also adds an agent, a server, a
port and a database to a host that is already short on memory and disk. Guardian
is a few hundred milliseconds of reads every two minutes with a 192 MB cap.
Revisit if the estate grows past one host.

**A root Guardian with `CAP_DAC_READ_SEARCH`.** Rejected: host-wide read
access for an observer that does not need it. See D8.

**Guardian as a long-running daemon.** Rejected: a oneshot timer cannot leak,
cannot accumulate memory on a host whose main problem is memory, and restarts
clean every tick. Guardian must never be part of the problem it observes.

**Reusing PR #283.** Rejected, and kept open as reference material only. Its
defects were structural — what it was allowed to do, and when — not a list of
bugs to fix. Merging it to save time would have shipped the review's findings.
