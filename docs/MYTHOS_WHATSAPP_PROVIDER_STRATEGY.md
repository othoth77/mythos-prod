# MYTHOS WhatsApp — provider strategy, hardening and the replacement gate

**Stage:** `gh-issue-147` (2026-09-03) · GitHub Issue #147
**Predecessors:** #126 (original integration), #124 (PR), #141, #146 (BLOCKED: VPS pressure + deploy permissions)
**Code:** `projects/mythos-ai-executor/bridge/notify/` · **Layer doc:** `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`
**Decision:** **keep Evolution API as the default adapter; do NOT replace it on unverified grounds; harden the layer and make the provider a configuration value.**

> This document is the *strategy and evidence* record. The behaviour of the
> notification layer itself is documented in
> `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md`.

---

## 1. What is actually broken — four separate things, not one

"WhatsApp is down" was one symptom covering four independent causes. They are
separated here because three of them are code and one is not, and only the
code ones could be fixed by this task.

| # | Fact | How it was established | State after this task |
|---|---|---|---|
| **F1** | **No WhatsApp gateway is deployed on this host.** `docker ps` lists 26 running containers (Coolify, MCP, n8n, Jellyfin, dar-hijama, …); none of them is a WhatsApp gateway. `mythos-github-bridge notify-config` reports `enabled: false` and four readiness problems (no base url, no instance, no recipients, no credential). | direct inspection, 2026-09-03 21:06 UTC | **unchanged, and deliberately so.** Deploying a gateway is a privileged deployment task, out of scope here (§2). |
| **F2** | **The notification layer was inert in the only configuration production runs.** `bin/mythos-github-bridge tick` took an early branch when `MYTHOS_ISSUES_ENABLED=1` — the mode the deploy timer drop-in sets, and the mode this very task was dispatched through — and that branch **never called `flushNotifications()`**. Every terminal task wrote a ledger entry and nothing ever delivered it. The `daemon` path and the non-Issues `tick` path did flush, which is why the defect survived the suite. | reading `bin/mythos-github-bridge` against `github-issues.js` `issuesTick()` | **FIXED.** Both branches flush, with the same "strictly after the tick has returned" ordering. Regression-guarded in `tests/mythos-bridge-whatsapp-resilience-test.js` §7. |
| **F3** | **Nothing bounded the cost of a provider that is down or hung.** `tick` waits for the flush before it exits, so a dead gateway cost `FLUSH_LIMIT × recipients × TIMEOUT_MS` — 150 s on the defaults with two recipients — on **every** 2-minute tick, forever. Worse, each of those flushes consumed one of `MAX_ATTEMPTS` on every queued notification, so a long outage did not *delay* the messages, it **destroyed** them (`EXHAUSTED`, never sent). | reading `whatsapp.js` `flush()`/`deliverEntry()` against the unit's `TimeoutStartSec=600` and the 120 s timer | **FIXED.** Provider circuit breaker + flush wall-clock budget (§5.2, §5.3). |
| **F4** | **A terminal notification could be lost permanently by a transient credential read.** `onReport()` required *full* readiness, including the credential, and a REPORT is written exactly once and never revisited. If the `0600` key file was unreadable at that instant, the notification was never queued and no retry existed at any layer. | reading `onReport()` → `readiness()` | **FIXED.** Queue-scope vs delivery-scope readiness (§5.4). |

**F1 is the reason the pipe is empty. F2 is the reason it would have stayed
empty even with a gateway deployed.** Fixing code does not deploy a gateway,
and deploying a gateway would not have fixed F2 — the issue's instruction not
to treat a VPS problem as solved by a code change cuts both ways, and both
halves are stated here rather than merged into a single claim of success.

---

## 2. Resource reality on this VPS (measured 2026-09-03 21:06 UTC)

| Measurement | Value | Consequence |
|---|---|---|
| `free -m` | total 7746 MiB · used 5964 · **available 1781** | there is headroom in RAM, but not much |
| swap | **4095 MiB of 4095 in use — fully consumed** | the machine has already pushed everything it can to swap; a new resident workload has nowhere to spill |
| `/proc/pressure/memory` | `some avg60=0.00`, `full avg60=0.00` | no *active* stall right now — the exhausted swap is accumulated history, not a live thrash |
| CPU | 4 vCPU, load 0.97 / 1.51 / 1.44 | CPU is not the constraint |
| disk | `/` 83 % used, 13 GiB free | a gateway's session/media store must be bounded and watched |
| Docker | the `deploy` user **can** reach the daemon (26 containers running) — this changed since #126, where it could not | a gateway deployment is now technically possible for this user, which makes the resource question, not the permission question, the decisive one |

**Verdict on "can a lighter provider run on this VPS without endangering the
current services?" — not yet, and not on the strength of this measurement.**
1781 MiB available with **zero** swap headroom is not a budget you spend on a
Chromium- or JVM-backed WhatsApp stack, and a Baileys/Node-based gateway's
resident set is dominated by the number of live sessions and the size of the
session store, neither of which can be estimated from a datasheet. The
honest sequence is: resolve the swap exhaustion first (the Desktop-Remote
session accumulation bounded by gh-issue-144 is the identified consumer, and
its guard is written but **not installed**), then measure a candidate under
`docker stats` with a hard `--memory` cap for a week, then decide.

---

## 3. Candidate evaluation — and what this run could NOT verify

### 3.1 Verification status — read this before trusting anything in §3.2

This run had **no outbound research capability**: `WebSearch` and `WebFetch`
were not granted, `gh` and `curl` were not permitted. Upstream facts about
every candidate — whether the project is maintained, its licence, its release
cadence, its real resident memory — could **not** be verified, including for
**`wa-evolution`**, which Issue #147 names explicitly as a candidate to check.

That is a hard blocker on one bullet of the scope, and it is reported as such
rather than papered over with recalled knowledge. **No candidate was adopted,
recommended for adoption, or introduced into the tree on the strength of
unverified information**, which is exactly what the issue's decision criterion
requires.

### 3.2 What can be said without upstream access

The requirement, established from the bridge code rather than assumed, is
still deliberately tiny: **one outbound plain-text message, to one or a few
fixed recipients, a few times a day, from a process on the same host.** No
inbound, no webhooks, no media, no sessions, no templates, no multi-tenancy.

| Candidate | Verified here | Not verified |
|---|---|---|
| **Evolution API** | the endpoint contract MYTHOS drives (`POST /message/sendText/{instance}`, `apikey` header) is implemented, exercised against a real HTTP server, and covered by 131 checks | current upstream maintenance, licence, real footprint |
| **wa-evolution** | *nothing* — it could not be reached | everything: existence, maintenance, licence, API shape, footprint |
| **WAHA** | *nothing* | everything |
| **MultiWA / WaSphere** | *nothing*; already flagged unidentifiable in #126 | everything |

### 3.3 The decision criterion, applied

Issue #147 states it: *if a ready-made provider is proven light, compatible
and safe, prepare a clear path; **if no better alternative is proven, keep the
current Evolution API and propose stronger isolation and resource management
instead of replacing it.*** Nothing was proven. Therefore:

> **Evolution API remains the default adapter. No replacement is adopted. The
> effort goes into removing the coupling and hardening the failure paths — so
> that when a candidate *is* verified, adopting it costs an environment
> variable rather than a project.**

---

## 4. The one architectural change that matters

The previous design already had a provider *registry*, but adopting any other
gateway still meant **writing a new adapter file, reviewing it, and deploying
new code**. That is the coupling — not the choice of Evolution API itself.

`providers/generic.js` removes it. Every HTTP WhatsApp gateway in this class
differs in exactly four things: the URL path, the auth header, the JSON body
field names, and where the message id sits in the response. All four are now
**configuration**:

```ini
MYTHOS_BRIDGE_WHATSAPP_PROVIDER=generic
MYTHOS_BRIDGE_WHATSAPP_GENERIC_PATH=/api/v1/sessions/{instance}/messages
MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_HEADER=authorization
MYTHOS_BRIDGE_WHATSAPP_GENERIC_AUTH_PREFIX=Bearer␣
MYTHOS_BRIDGE_WHATSAPP_GENERIC_BODY={"chatId":"{{to}}","text":"{{text}}"}
MYTHOS_BRIDGE_WHATSAPP_GENERIC_ID_PATH=result.messageId
```

Its defaults reproduce the Evolution API shape byte for byte — asserted by
sending through both adapters to the same server and comparing the recorded
URL and body — so it is a proven-equivalent drop-in, not a guess.

**Template safety is the part that had to be right.** The body template is
JSON-**parsed first**, and `{{to}}` / `{{text}}` / `{{instance}}` are
substituted into the already-parsed *values*. A recipient or a REPORT summary
therefore lands in a string slot and is re-escaped on the way out: it cannot
add a JSON key, and a placeholder that arrives *inside* untrusted text is not
re-expanded (substitution is a single pass over the template). String
substitution into raw JSON text — the obvious implementation — would be a
template-injection hole and is not used. Path templates are validated against
a closed alphabet with the substituted values URL-encoded; the header name is
validated; the header *value* is the credential and is never described,
returned or logged.

Nothing about this makes the layer more powerful: `generic` still implements
`sendText` and nothing else, the gateway host must still pass the
private-network fence, and the scope fence against MYTHOS AUTO customer chat
is unchanged.

---

## 5. Hardening delivered

### 5.1 The Issues-mode flush (F2)

`bin/mythos-github-bridge tick` now flushes in **both** branches, strictly
after the tick has returned, with the outcome still unable to change the exit
code. Guarded by a source-level regression assertion, because the Issues path
cannot be exercised end-to-end offline (it needs a GitHub token and network).

### 5.2 Provider circuit breaker (F3)

After `MYTHOS_BRIDGE_WHATSAPP_BREAKER_THRESHOLD` (default **3**) consecutive
**provider-level** failures the circuit opens for
`MYTHOS_BRIDGE_WHATSAPP_BREAKER_COOLDOWN_MS` (default **5 min**, doubling per
consecutive open, capped at 30 min). While open, a flush touches nothing:
zero requests, zero attempts consumed, every entry left `PENDING`. On expiry
the circuit is half-open and lets **exactly one** entry through as a probe;
success closes it, failure re-opens it with a doubled cooldown. The circuit
is re-checked *between entries within one flush*, so the first flush of an
outage costs `THRESHOLD` timeouts, not one per due entry.

- **A 4xx never opens it.** That is the gateway rejecting *this message* (bad
  recipient, bad body); it says nothing about the gateway's health. Only a
  transport error, a timeout, or a 5xx counts.
- **It fails closed.** A missing, unreadable or corrupt breaker file reads as
  "closed", i.e. *towards* attempting delivery. It can never silently
  suppress notifications.
- **It is why an outage no longer destroys notifications.** No attempt is
  consumed while the circuit is open, so nothing drifts to `EXHAUSTED`.
- Kill switch: `MYTHOS_BRIDGE_WHATSAPP_BREAKER=off` restores the exact
  pre-existing behaviour. Operator repair path:
  `mythos-github-bridge notify-breaker-reset` (closes the circuit, sends
  nothing, touches no entry).

### 5.3 Flush wall-clock budget (F3)

`MYTHOS_BRIDGE_WHATSAPP_FLUSH_BUDGET_MS` (default **60 s**) bounds one whole
flush, checked **between entries and between recipients** — one entry with
many recipients cannot consume the tick on its own. Work that does not fit is
left `PENDING` and due immediately.

Two correctness rules go with it, and both are asserted:

- **`SENT` now means every recipient is in `delivered_to`.** Deriving it from
  "this attempt had no failure" would have marked an entry delivered whose
  remaining recipients were cut by the budget. (This was a latent bug the
  budget would otherwise have made reachable.)
- **A budget cut consumes no attempt.** It is a local scheduling decision,
  not a delivery failure, so it must not push an entry towards `EXHAUSTED`,
  and it is reported as `deferred`, never as `failed`.

### 5.4 Queue-scope vs delivery-scope readiness (F4)

Readiness is now split by *what actually needs it*:

- **queue scope** — every static, structural decision: provider registration,
  gateway address and the private-network fence, instance name, recipients,
  adapter configuration. All come from the same drop-in, are wrong only
  because a human made them wrong, and stay wrong until a human fixes them.
  Refusing to queue on these is unchanged, including the documented rule that
  a **non-private gateway queues nothing**.
- **delivery scope** — the credential, and only the credential: the one input
  that is a file read at send time and can therefore fail transiently. It is
  re-read on every flush, where being unreadable costs a retry instead of the
  message.

### 5.5 What was deliberately NOT changed

The two-phase design, the ledger, the `(task_id, kind)` key, the `O_EXCL`
locking, the at-least-once guarantee and its documented residual window, the
redaction, the private-network fence, the recipient/instance validation, the
`SENT`-is-never-pruned retention rule, the scope fence against customer chat,
`providers/evolution.js`, `http-json.js`, and every call site in
`github-bridge.js`. The issue asked for the notification layer to be
preserved and changed only where a defect is proven; F2, F3 and F4 are the
proven defects, and the changes stop there.

---

## 6. The gate before any provider is deployed or replaced

Nothing below was performed in this task, and none of it may be skipped.

1. **Resolve the swap exhaustion first.** Install and observe the gh-issue-144
   session guard, and re-measure. A gateway deployed onto 0 MiB of swap
   headroom endangers the 26 containers already running, and that risk is not
   worth a notification channel.
2. **Live-verify the candidate** (this is the step this run could not do):
   repository exists and is maintained, licence, release cadence, whether it
   is Baileys/web-session based or Cloud-API based, and its documented text-send
   contract. `wa-evolution` gets this treatment before it is called a candidate
   in any report, not after.
3. **Measure it, don't read about it.** Run it with a hard `--memory` cap on
   this host for at least a week, `docker stats` sampled, and confirm the
   resident set and the growth of its session store. A footprint claim from a
   README is not a measurement.
4. **Drive it through `generic` first.** Configure path/header/body/id-path and
   prove it against a local HTTP recorder before it touches a real WhatsApp
   account. If `generic` can drive it, no code is needed at all; if it cannot,
   *that* is when a dedicated adapter file is justified.
5. **Keep the fences.** Private-network host (or an explicit `ALLOW_PUBLIC=1`
   decision), credential in a `0600` file, no credential in Git, no unit file
   in Git carrying configuration.
6. **Then, and only then, the single controlled real message:**
   `mythos-github-bridge notify-test --confirm` (human-invoked, bypasses the
   ledger, carries no task data) — `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md` §7.1.
7. **No auto-merge and no automatic production deployment**, per the issue's
   governance clause. Delivery is GitHub → Bridge → OTHMODE/Governance →
   Executor → Relay.

---

## 7. Residual risks

- **The provider question is still open, not answered.** This task did not
  choose a lighter provider; it removed the cost of choosing one later. Any
  report that describes #147 as "provider replaced" would be false.
- **`wa-evolution` remains unexamined.** It needs a networked session (§6.2).
- **F1 is not fixed.** No gateway is deployed, so end-to-end WhatsApp delivery
  is still unproven on this host. Everything up to the socket is proven
  against a real HTTP server; the WhatsApp side is not.
- **The Issues-mode flush fix is guarded at source level, not end to end.**
  That path needs a GitHub token and network to run; the guard prevents the
  branch from silently losing the call again, but it does not prove a live
  Issues tick delivers a message.
- **A flush that can never fit its budget** (an extremely slow gateway plus
  many recipients) leaves entries `PENDING` indefinitely rather than failing
  them. That is visible in `notify-status`, and is the correct trade — but it
  is a state an operator has to look at, not one that raises an alarm.
- **The breaker adds latency to recovery by design.** After an outage, the
  first notification waits up to one cooldown. That is the intended exchange
  for not destroying the queue.
