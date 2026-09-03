# MYTHOS GitHub bridge — WhatsApp notification layer

**Stage:** `gh-20260902-wa-bridge-notify-01` (2026-09-02)
**Code:** `projects/mythos-ai-executor/bridge/notify/` (`whatsapp.js`, `http-json.js`, `providers/evolution.js`)
**Wiring:** `projects/mythos-ai-executor/bridge/github-bridge.js` (2 call sites), CLI `bin/mythos-github-bridge`
**Suite:** `tests/mythos-bridge-whatsapp-notify-test.js` — 116 checks, offline, no real message
**Default state:** **DISABLED.** Nothing is sent, no ledger is created, no request is made, until it is explicitly configured *and* `MYTHOS_BRIDGE_WHATSAPP_ENABLED=1`.

> **Scope fence.** This is the *bridge notification* layer only: one outbound
> text when a control task reaches a state a human must know about. It is
> **not** MYTHOS AUTO WhatsApp, not customer chat, not an inbound channel.
> The adapter deliberately implements `sendText` and nothing else — no
> instance lifecycle, no QR/pairing, no media, no groups, no webhooks. A
> future customer-messaging project must not be built on top of this module.

---

## 1. Why the design is two-phase (the whole safety argument)

The hard requirement is that WhatsApp can never change a GitHub task's
status or break a bridge tick. That is not achieved by wrapping a send in a
`try/catch` — a slow or hung gateway would still stall the tick, and a send
performed *before* the tick finished could still interleave with the control
commit. It is achieved by making the network call impossible inside the tick:

| Phase | Function | When | Nature |
|---|---|---|---|
| 1 — enqueue | `whatsapp.onReport(report, opts)` | inside `finishTask()`, immediately **after** the REPORT has been written | synchronous, local filesystem only, **never network** |
| 2 — deliver | `bridge.flushNotifications()` → `whatsapp.flush()` | **after** `tick()` has already returned, from the CLI or the daemon | asynchronous, network, always resolves |

Consequences, each one a stage requirement:

- **The tick cannot be slowed, failed or altered by the provider.** By the
  time anything reaches a gateway, the REPORT is on disk, the task status is
  decided and the control commit is made.
- **The control branch has no notification state at all.** `onReport` never
  writes to `control/`. A delivery failure leaves the TASK file and the
  REPORT file byte-identical and produces no commit — asserted in the suite.
- **Idempotency, restart safety and duplicate-poll safety are one property.**
  A durable ledger entry keyed `(task_id, kind)` is written once; a recipient
  that has been delivered to is recorded and never messaged again.
- **Concurrency is safe.** An `O_EXCL` lock file per ledger key serialises
  delivery attempts across ticks, processes and a manual `notify-flush`.

```text
executor status ─▶ bridge tick ─▶ REPORT written ─▶ control commit ─▶ tick returns
                                         │                                  │
                                  onReport(): 1 ledger entry          flushNotifications()
                                  (local, sync, no network)            (network, retries)
                                                                             │
                                                                    Evolution API (private)
                                                                             │
                                                                        WhatsApp
```

---

## 2. Which states notify

Exactly four kinds, and nothing else:

| Report status | Notification kind | Why |
|---|---|---|
| `COMPLETED` | `COMPLETED` | the work landed; the owner decides whether to merge |
| `FAILED` | `FAILED` | the run ended badly and needs attention |
| `BLOCKED` | `BLOCKED` | the executor stopped on a prerequisite |
| `BLOCKED` **+ human decision required** | `HUMAN_APPROVAL` | see below |
| `CANCELLED` | *(none)* | it was the human's own action; they already know |
| `PENDING`, `CLAIMED`, `IN_PROGRESS`, `VALIDATING` | *(none)* | non-terminal; the layer only ever sees terminal reports |

**On `HUMAN_APPROVAL`.** There is no `HUMAN_APPROVAL` *status* in
`mythos-control/1`, and inventing one would have changed the control
protocol — out of scope and a breaking change for the planner. Instead the
kind is attached to the bridge's existing "this stops here until a person
decides" condition: the claim exists on GitHub but the executor record is
gone (host or store loss), so the bridge refuses to silently re-execute and
writes a BLOCKED report whose next action is *"A human decides…"*. That is
precisely the case where a message on a phone is the point, so it gets its
own kind and its own message line. The control task status is still
`BLOCKED` — the notification kind is a notification concept only, and never
leaks back into the protocol.

`MYTHOS_BRIDGE_WHATSAPP_EVENTS` can narrow the set further (e.g.
`FAILED,BLOCKED,HUMAN_APPROVAL` to drop success noise). It can never widen it.

---

## 3. Provider evaluation and the decision

### 3.1 What the use case actually requires

Established from the bridge code, not assumed: **one outbound plain-text
message, to one or a few fixed recipients, a few times a day at most, from a
process on the same host.** No inbound messages, no webhooks, no media, no
sessions, no chat state, no multi-tenancy, no template approval.

That is a deliberately tiny requirement, and it is the single most important
input to the decision: the *provider* matters far less than the *coupling*.

### 3.2 Locally verified constraints (measured on this VPS, 2026-09-02)

| Fact | Measurement | Consequence |
|---|---|---|
| Swap fully consumed | `free -m`: swap 4095 MiB used of 4095, ~425 MiB RAM free | any provider stack that adds a JVM/Postgres/Redis footprint is a production risk **today** |
| No container access for the executor user | `docker ps` → permission denied on `/var/run/docker.sock` | provisioning a provider is a separate, privileged, human-run deployment task |
| Bridge integration surface | `github-bridge.js` `finishTask()` | one call site; no provider feature beyond `sendText` is reachable |

### 3.3 Candidate comparison

**Verification status — read this before trusting the table.** This run had
**no outbound network access** (`WebFetch`/`WebSearch` unavailable, direct
HTTPS blocked by the sandbox), so upstream facts about the four candidates —
current maintenance, licence, release cadence, memory footprint — could
**not** be live-verified. They are marked `TO-VERIFY` and are recorded that
way in the Open Source Registry too. The columns that *are* verified are the
ones derived from this repository and this host.

| Candidate | Fit for "one outbound text" | Weight | Licence / maintenance | Status |
|---|---|---|---|---|
| **Evolution API** | good — a documented single-endpoint text send (`POST /message/sendText/{instance}`) with a simple `apikey` header | heaviest of the four in its full deployment (API + Postgres + Redis); a minimal single-instance deployment is much smaller | TO-VERIFY | **selected as the default adapter** |
| **WAHA** | good — comparable single-endpoint send | lighter minimal profile than a full Evolution stack | TO-VERIFY (core/plus licensing split needs confirming) | viable alternative, **not implemented** |
| **MultiWA** | unknown | unknown | TO-VERIFY — could not be identified as a maintained project without network access | **not selected**: an unverifiable dependency cannot be the default |
| **WaSphere** | unknown | unknown | TO-VERIFY — same | **not selected**: same |

### 3.4 Verdict

**The bridge depends on an adapter contract, not on a provider.** Evolution
API is implemented as the default adapter because the task prefers it and
because its text-send endpoint is the simplest of the candidates to drive
safely from a 100-line adapter. But the decision that actually protects
MYTHOS is that the choice is **cheap to reverse**: swapping to WAHA, or
migrating to the official WhatsApp Business Cloud API, is a new file in
`bridge/notify/providers/` plus one line in the `PROVIDERS` map.
`github-bridge.js`, the ledger, the idempotency, the retry policy and the
tests do not change. The suite asserts the contract shape so a second
adapter has something to conform to.

This is recorded as **PROVISIONAL** in the Open Source Registry: before the
provider is actually deployed, a networked session must confirm licence,
maintenance status and resource footprint, and MUST re-open the choice if
Evolution API's real footprint is incompatible with the swap pressure above.

### 3.5 The adapter contract

```js
module.exports = {
  id: 'evolution',              // matches MYTHOS_BRIDGE_WHATSAPP_PROVIDER
  requirements: [...],          // config keys that must be present
  describe(),                   // no secrets, ever
  isValidRecipient(to),         // refuse anything that could inject
  sendText({ baseUrl, instance, apiKey, to, text, timeoutMs, apiVersion })
    // → Promise<{ ok, status, provider_message_id, error }>
    // MUST NOT throw on an HTTP error status
    // MUST NOT return or log the credential
    // MUST NOT retry internally — retry and idempotency belong to the ledger
};
```

---

## 4. Configuration

All configuration is environment-only. **Nothing here is committed, and no
value below appears in any log, report, ledger entry or CLI output.**

| Variable | Default | Meaning |
|---|---|---|
| `MYTHOS_BRIDGE_WHATSAPP_ENABLED` | *(unset → off)* | `1` enables the layer. Anything else is off. |
| `MYTHOS_BRIDGE_WHATSAPP_PROVIDER` | `evolution` | adapter id from the registry |
| `MYTHOS_BRIDGE_WHATSAPP_BASE_URL` | — | e.g. `http://127.0.0.1:8080`. Must be private (see §5.2) |
| `MYTHOS_BRIDGE_WHATSAPP_INSTANCE` | — | Evolution instance name (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`) |
| `MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE` | — | **preferred**: path to a `0600` file holding the key |
| `MYTHOS_BRIDGE_WHATSAPP_API_KEY` | — | fallback; avoid — it is inherited by child processes |
| `MYTHOS_BRIDGE_WHATSAPP_TO` | — | comma-separated MSISDNs (digits only) or WhatsApp JIDs |
| `MYTHOS_BRIDGE_WHATSAPP_EVENTS` | all four | subset of `COMPLETED,FAILED,BLOCKED,HUMAN_APPROVAL` |
| `MYTHOS_BRIDGE_WHATSAPP_API_VERSION` | `v2` | `v1` switches to the older `{ number, textMessage:{text} }` body |
| `MYTHOS_BRIDGE_WHATSAPP_ALLOW_PUBLIC` | *(unset → off)* | `1` permits a non-private gateway host. Deliberate decision only. |
| `MYTHOS_BRIDGE_WHATSAPP_TIMEOUT_MS` | `15000` | per-request hard timeout |
| `MYTHOS_BRIDGE_WHATSAPP_MAX_ATTEMPTS` | `5` | attempts before `EXHAUSTED` |
| `MYTHOS_BRIDGE_WHATSAPP_BACKOFF_MS` | `60000` | base backoff; doubles per attempt, capped at 30 min |
| `MYTHOS_BRIDGE_WHATSAPP_LEASE_MS` | `120000` | after this, an abandoned in-flight claim may be reclaimed |
| `MYTHOS_BRIDGE_WHATSAPP_FLUSH_LIMIT` | `5` | deliveries per flush; keeps `tick` well inside `TimeoutStartSec=600`. A backlog drains over following ticks. |
| `MYTHOS_BRIDGE_WHATSAPP_HOME` | `$MYTHOS_BRIDGE_HOME/notify` | ledger location |

### 4.1 Installing the credential (host, as `deploy`)

```bash
install -m 700 -d ~/mythos-ai-executor/secrets
printf '%s' 'THE-EVOLUTION-API-KEY' > ~/mythos-ai-executor/secrets/evolution.key
chmod 600 ~/mythos-ai-executor/secrets/evolution.key
```

Then a systemd **drop-in** for the existing timer unit — the unit file in
Git stays credential-free:

```bash
systemctl --user edit mythos-github-bridge.service
```

```ini
[Service]
Environment=MYTHOS_BRIDGE_WHATSAPP_ENABLED=1
Environment=MYTHOS_BRIDGE_WHATSAPP_BASE_URL=http://127.0.0.1:8080
Environment=MYTHOS_BRIDGE_WHATSAPP_INSTANCE=mythos-bridge
Environment=MYTHOS_BRIDGE_WHATSAPP_TO=216XXXXXXXX
Environment=MYTHOS_BRIDGE_WHATSAPP_API_KEY_FILE=%h/mythos-ai-executor/secrets/evolution.key
```

The drop-in lives under `~/.config/systemd/user/mythos-github-bridge.service.d/`
and is **not** in the repository. No unit file in Git changes.

### 4.2 Integration with the existing service and timer

None of the existing units change. `mythos-github-bridge.timer` fires
`mythos-github-bridge tick` every 2 minutes, and `tick` now flushes due
notifications **after** the tick has returned, before exiting. Nothing about
`Type=oneshot`, `TimeoutStartSec=600` or the tick's exit code changes: a
WhatsApp failure never alters the exit code, by design. In `daemon` mode the
flush runs on its own guard, so a slow gateway delays the next *notification*
attempt and never the next tick.

---

## 5. Security

### 5.1 The credential

- Read at send time only, from a `0600` file (preferred) or the environment.
- Never written to the ledger, a log line, a report, a message body, or the
  output of `notify-config` / `notify-status`.
- Never placed on a command line (no `curl` subprocess — hence the pure-Node
  `http-json.js`, which also avoids adding an npm dependency).
- `http-json.js` never logs, echoes or returns request headers.
- The suite proves it: a real key is used throughout, and section 11 greps
  the entire fixture tree, the bridge event log and every committed Git tree
  for it. Zero hits outside the `0600` key file itself.

### 5.2 Private networking

A gateway host is accepted without `ALLOW_PUBLIC=1` only when it is
loopback, RFC1918/RFC6598 private, IPv6 unique-local, a single-label name (a
container/service name on a private network), or `*.internal|.local`.
Anything else is refused at readiness time and **nothing is queued**.
Reaching a WhatsApp gateway across the public internet is a deliberate
decision, never a default.

### 5.3 Untrusted content

A REPORT summary is written by an executing agent session — untrusted text
that is about to be handed to a third-party gateway. Every message passes
`redact.redact()` before it leaves `buildMessage()`, and is clipped to 3500
characters. Recipients are validated as digits-only MSISDNs or WhatsApp JIDs,
and the instance name against a safe alphabet, so neither can inject into the
provider URL or body.

### 5.4 What was NOT touched

No governance-protected path was modified: `lib/policy.js`, budget/service
files, `redact.js`, `.github/`, and anything matching credential/secret/.env
are all unchanged. No `git push` was run. Nothing under `control/` was
edited. The existing `mythos-git-push` relay remains the only path to GitHub.

---

## 6. Retry, recovery and the ledger

The ledger is the executor store convention already used by the bridge's
claims cache — one small atomic JSON file per notification, `0600`, under
`$MYTHOS_BRIDGE_HOME/notify/ledger/`. **No database is added.**

Key: `<task_id>__<KIND>`. States:

| State | Meaning | Next |
|---|---|---|
| `PENDING` | queued, or a failed attempt awaiting backoff | retried when `next_attempt_at` passes |
| `SENDING` | a live process holds the claim | reclaimed only if the holder dies and the lease expires |
| `SENT` | delivered to every recipient | **never attempted again**, never pruned |
| `EXHAUSTED` | `MAX_ATTEMPTS` reached | never attempted again; visible in `notify-status` |

- **Backoff:** `BACKOFF_MS × 2^(attempt-1)`, capped at 30 minutes.
- **Partial delivery:** each recipient that succeeded is written to
  `delivered_to` **immediately**, right after that recipient's own send is
  acknowledged — not batched until the whole attempt (every recipient)
  finishes. A retry sends only to the ones not yet in `delivered_to`.
- **Crash mid-send:** the entry is marked `SENDING` on disk *before* the
  request. After a restart, `reclaimStale()` requeues it only if the owning
  pid is gone and the lease expired. A `SENT` entry is never touched, so a
  crash after every recipient has already been durably recorded cannot
  produce a duplicate.
- **The actual guarantee is at-least-once, not exactly-once.** There is an
  irreducible window between the provider acknowledging a message and the
  synchronous ledger write that records it: a process crash inside that one
  synchronous write — not before the provider ACK, not after the write
  returns — can still leave a delivered recipient absent from
  `delivered_to`, and a reclaimed retry would then re-send to it once.
  Evolution API's `sendText` has no idempotency-key parameter (see §3.5 /
  `providers/evolution.js`), so this module cannot ask the provider to
  de-duplicate on its side; closing this last window would require
  provider-side idempotency support that does not exist today. Do not
  describe this layer as exactly-once in any report, doc or message — it is
  at-least-once delivery with best-effort de-duplication, and the window
  above is the reason.
- **Concurrency:** `O_EXCL` lock per key. A lock is considered stale only
  when its holder is demonstrably not running (age alone is not enough — a
  slow provider is not a dead process, and stealing a live claim is exactly
  how a duplicate gets sent).
- **Retention:** `SENT` entries are never pruned. They are the durable proof
  that a task was already notified; deleting one is the only way to make the
  system send a second message for the same task.
- **task_id length:** the ledger key is `<task_id>__<KIND>`; the key pattern
  accepts the full 6–64 char `task_id` range that `github-bridge.js`
  (`TASK_ID_RE`) accepts. A task_id the bridge accepts but the ledger key
  pattern rejected would previously leave `onReport()` silently queuing
  nothing (its try/catch swallows the `NOTIFY_KEY_INVALID` error) — a
  64-char task_id is a regression case in the test suite (§8, row 13).

---

## 7. Operating

```bash
mythos-github-bridge notify-config    # configuration + readiness problems (no secrets)
mythos-github-bridge notify-status    # the ledger: states, attempts, errors (no message bodies)
mythos-github-bridge notify-flush     # deliver due notifications now; safe to repeat
mythos-github-bridge notify-test --confirm   # ONE real smoke-test message (human only)
```

`notify-flush` is safe to run at any time and as often as you like — the
ledger makes it idempotent.

### 7.1 The controlled real smoke test

`notify-test` is the **only** path that sends a real message, it is never
reachable from a tick, a timer or a test suite, and it refuses to run without
`--confirm`. It bypasses the ledger (it is not a task notification) and its
body carries no task data. Procedure, once the provider is deployed:

1. Run the automated suites (§8) and confirm they are green.
2. `mythos-github-bridge notify-config` → `problems` must be empty.
3. `mythos-github-bridge notify-test --confirm` → exit 0.
4. Confirm the message arrived on the handset.
5. `mythos-github-bridge notify-status` → the smoke test creates **no**
   ledger entry; the ledger must be unchanged.

**Status in this stage: NOT PERFORMED.** No WhatsApp provider is deployed on
this host, the executor user has no Docker access, and this run had no
outbound network. Performing it would have required a provider deployment,
which is a separate privileged task and is explicitly unsafe to attempt while
swap is fully consumed (§3.2). Everything up to the real send is verified;
the real send is the documented first step of the deployment task.

---

## 8. Tests

`node tests/mythos-bridge-whatsapp-notify-test.js` — **116 checks, all
passing.** No real WhatsApp message is sent: the far end is a local
`http.createServer` on `127.0.0.1` that records every request, while the
**real** adapter and the **real** HTTP path are exercised.

| Section | Covers |
|---|---|
| 1 | disabled by default: no ledger, no request, flush is a no-op |
| 2 | readiness, the private-network rule, no credential in `notify-config` |
| 3 | the four notifying kinds; `CANCELLED` and every non-terminal state notify nothing |
| 4 | end-to-end delivery of all four kinds; endpoint shape, `apikey` header, v2 body |
| 5 | duplicate polling and repeated flushes → exactly one message |
| 6 | four parallel in-process flushes **and** four concurrent OS processes → exactly one message |
| 7 | gateway 500 → retryable, backoff respected, recovery succeeds once, attempts bounded → `EXHAUSTED` |
| 8 | partial multi-recipient delivery: the recipient that succeeded is not messaged twice |
| 9 | crash mid-send reclaimed and delivered once; a live sender never reclaimed; restart re-sends nothing |
| 10 | a real bridge tick: `COMPLETED` and `HUMAN_APPROVAL` end to end; a failing gateway leaves the TASK and REPORT **byte-identical** and produces no control commit |
| 11 | the credential appears in no file, log, report or committed tree; a secret shape in an untrusted summary is redacted out of the message |
| 12 | the adapter contract, and refusal of injecting recipients/instance names |
| 13 | task_id length: a 64-char id (the bridge's own max) reaches the ledger and is delivered; a 65-char id is refused by `ledgerKey()` |
| 14 | the crash/failure window: a recipient's success is durable on disk before the rest of the attempt finishes; a simulated crash + reclaim retries only the recipient still missing, never re-sending to one already recorded |

Existing suites re-run and still green:

| Suite | Result |
|---|---|
| `tests/mythos-github-bridge-test.js` | 97 passed, 0 failed |
| `tests/mythos-ai-executor-test.js` | 265 passed, 0 failed |
| `tests/mythos-governance-invariant-test.js` | 111 passed, 0 failed |
| `tests/othmode-3-tasks-test.js` | 94 passed, 0 failed |
| `tests/othmode-2-platform-test.js` | 141 passed, 0 failed (http section skipped: no `pg` on this host) |

---

## 9. Rollback

Three levels, cheapest first — all reversible, none touching Git history:

1. **Disable.** Remove `MYTHOS_BRIDGE_WHATSAPP_ENABLED=1` from the drop-in
   and `systemctl --user daemon-reload`. The layer returns to its default:
   no ledger writes, no requests, `flush()` a no-op. The bridge is unaffected
   because it never depended on it.
2. **Suppress a stuck notification.** Set the ledger entry's state to
   `EXHAUSTED`, or delete `$MYTHOS_BRIDGE_HOME/notify/ledger/<key>.json` to
   allow exactly one fresh attempt. Deleting a `SENT` entry is the only way
   to cause a duplicate message — do it only deliberately.
3. **Remove the code.** Revert this stage's commit. The only bridge changes
   are one `require`, one call in `finishTask()`, one `human_approval: true`
   flag, `flushNotifications()`, and the daemon/CLI flush calls. Nothing in
   the control protocol, the schemas, the executor or OTHMODE changed, so a
   revert cannot orphan any data on the control branch.

---

## 10. Residual risks

- **The provider is not yet chosen against live upstream data.** §3.3 is
  explicitly `TO-VERIFY`. The decision is provisional and the adapter
  boundary is what makes it cheap to change.
- **The real smoke test has not been performed** (§7.1). Everything up to
  the socket is proven against a real HTTP server; the WhatsApp side is not.
- **Deploying any provider on this host is currently risky**: swap is fully
  consumed. The provider deployment is a separate task that must first
  address the memory pressure.
- **A message is not an audit record.** The ledger, not WhatsApp, is the
  evidence that a notification happened; the REPORT on the control branch
  remains the record of the task itself.
