# MYTHOS WhatsApp — provider strategy, hardening and the replacement gate

**Stage:** `gh-issue-147` (2026-09-03) · GitHub Issue #147 · **§3 re-verified live by WA-PROVIDER-2 (2026-09-04)**
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

## 3. Candidate evaluation — live-verified 2026-09-04 (WA-PROVIDER-2)

### 3.1 Verification status

The gh-issue-147 run had no outbound research capability and recorded every
upstream fact as `TO-VERIFY`. **WA-PROVIDER-2 (2026-09-04) closed that gap**
with a networked session: every fact in §3.2 was read from the upstream
source named in the "Source" column on 2026-09-04 (GitHub REST API, the raw
repository files, Docker Hub / ghcr.io registry manifests, and the vendors'
own documentation). Nothing below is recalled knowledge. **Footprint figures
are image sizes and vendor-stated minimums, not measurements on this host** —
step 3 of the gate (§6) is still owed and is still the only source of a
resident-set number.

### 3.2 What was verified

The requirement is unchanged and still tiny: **one outbound plain-text
message, to one or a few fixed recipients, a few times a day, from a process
on the same host.** No inbound, no webhooks, no media, no multi-tenancy.

| Fact | **Evolution API** | **wa-evolution** | **WAHA** | Source |
|---|---|---|---|---|
| Repository | `evolution-foundation/evolution-api` (the `EvolutionAPI/…` URL in older MYTHOS docs now **301-redirects** here) | `jfelipesjc/wa-evolution` | `devlikeapro/waha` | api.github.com |
| Licence | **Apache-2.0 with two added conditions** (`LICENSE`): keep the logo/copyright in its frontend, and a *"Usage Notification Requirement"* — a system using it "is required to display a clear notification … visible to system administrators and accessible from the system's documentation or settings page", else a commercial licence "may" be required. GitHub classifies it `NOASSERTION`. | MIT | **Apache-2.0** (`LICENSE` at branch `core`). Since **2026.6.1** the former Plus features (unlimited sessions, media, all storages, built-in security) are in Core; *"There's no separate Plus image anymore - just use `devlikeapro/waha`."* | raw `LICENSE` files; waha.devlike.pro/docs/how-to/waha-plus |
| Maintenance | 9,528 ★ · pushed 2026-07-14 · 208 open issues · last **stable** release **2.3.7 on 2025-12-05**, then only `2.4.0-rc1/rc2` (2026-05) — no stable release for 9 months | **0 ★ · 0 forks · 1 contributor** (51 commits) · created 2026-06-26 · last push 2026-08-01 · tags v0.1.0…**v0.1.10** in five weeks · CI = build, vet, `go test -race`, docker build | 7,334 ★ · pushed 2026-09-01 · releases **2026.8.2 (2026-09-01)**, 2026.8.1, 2026.7.2 — monthly cadence · 2 core maintainers (1,663 + 668 commits) · 2.48 M Docker Hub pulls | api.github.com `/repos`, `/releases`, `/contributors`; hub.docker.com |
| Protocol stack | Node.js; Baileys-class WhatsApp Web session | **`jfelipesjc/wa-go`** — a WhatsApp Web protocol (Noise/Signal/app-state) **re-implemented from scratch by the same single author** (MIT, 1 ★, 162 Go files / 70 test files, pushed 2026-08-06); *not* whatsmeow, *not* Baileys | engines: **WEBJS** (default, Chromium via Puppeteer), WPP (browser), **NOWEB** (Node WebSocket, no browser), **GOWS** (Go WebSocket, no browser) | README / `go.mod`; waha.devlike.pro/docs/how-to/engines |
| Required services | **PostgreSQL or MySQL + Redis** (production) · Node 20+ · the reference `docker-compose.yaml` runs **4 containers** (api, manager, redis, postgres:15) | **none** — single static Go binary, embedded SQLite (`modernc.org/sqlite`, no CGO); **1 container** or one systemd unit (a hardened unit file ships in `deploy/`: `NoNewPrivileges`, `ProtectSystem=full`, own user) | none beyond the image; state on a volume | vendor installation docs; repository files |
| Vendor-stated minimum | *"At least 2GB of available RAM"*, *"5GB of free disk space"* | not stated | not stated. Docs give **no RAM number** for any engine; only *"Not running Chromium saves you CPU and Memory"* and a scaling article's 50 sessions (WEBJS) vs 500 (NOWEB) per server | vendor docs |
| Image (compressed, registry-reported) | `evoapicloud/evolution-api:latest` **389 MB** (2026-05-06) — **already pulled on this host: 1.83 GB on disk, no container** (`docker images`, 2026-09-04) | `ghcr.io/jfelipesjc/wa-evolution:0.1.10` linux/amd64 **9.6 MB** (alpine + one binary, runs as uid 10001) | `devlikeapro/waha:latest-2026.8.2` **1,156 MB** (ships Chromium; the NOWEB/GOWS engines run inside the same image) | hub.docker.com v2 API; ghcr.io manifest |
| Text-send contract | `POST /message/sendText/{instance}` · header `apikey` · `{"number","text"}` · id at `key.id` | **byte-identical to Evolution:** `POST /message/sendText/{instance}`, `apikey`, `{"number","text"}`, replies `201 {"key":{"remoteJid","fromMe","id"},"status":"PENDING"}` (`internal/api/messages.go`) — `providers/evolution.js` drives it **unchanged** | `POST /api/sendText` · header **`X-Api-Key`** · `{"session","chatId":"<msisdn>@c.us","text"}` · returns a `WAMessage` whose message id is the top-level **`id`** string (`src/structures/responses.dto.ts`) | source files |
| `generic` adapter mapping | defaults | defaults (or `evolution` itself) | `PATH=/api/sendText` · `AUTH_HEADER=X-Api-Key` · `BODY={"session":"{{instance}}","chatId":"{{to}}@c.us","text":"{{text}}"}` · `ID_PATH=id` — **no code change**; the template substitutes inside string values, so `{{to}}@c.us` is legal. **Proven** against a local recorder: `tests/mythos-bridge-whatsapp-resilience-test.js` sections `generic-waha` and `evolution-wa-evolution` | `providers/generic.js`; the suite |
| Security notes | `apikey` header; manager UI is a separate container | `WA_APIKEY` empty **disables auth** (must be set); the `/manager` dashboard has **no auth** and shows QR codes → bind to loopback only, never publish the port | `X-Api-Key`; the Core image now includes the former Plus "built-in security" | README; docs |

**MultiWA / WaSphere** (named in #126 as unidentifiable): they do exist —
`ribato22/MultiWA` (28 ★, MIT, pushed 2026-09-01) and `wasphere/wasphere`
(49 ★, MIT, pushed 2026-07-19) — both multi-engine, multi-tenant "WhatsApp
Business API gateway" products. They are **larger than the requirement, not
smaller**, and neither is lighter than the three above; they are recorded
as identified and **not shortlisted**, not as unverifiable.

### 3.3 The decision criterion, applied to verified facts

Issue #147's criterion: *if a ready-made provider is proven light, compatible
and safe, prepare a clear path; if no better alternative is proven, keep
Evolution API and strengthen isolation instead.* With live data:

| | Light | Compatible | Safe (maintained, licensed, reviewable) |
|---|---|---|---|
| Evolution API | **no** on this host — 2 GB stated minimum + Postgres + Redis + 4 containers, against 1,035 MiB available and 0 swap headroom (§2, re-read 2026-09-04) | yes (the default adapter) | licence carries a **notification obligation** MYTHOS must satisfy in its docs/settings; last stable release 9 months old; maintained |
| **wa-evolution** | **yes** — 9.6 MB image, one process, SQLite, no services | **yes, byte-for-byte** with the existing adapter | **not proven** — 0 stars, one author, a from-scratch protocol stack two months old with no independent review; a single-maintainer dependency for a production notification channel |
| **WAHA** | **partly** — the image is the largest (1.16 GB, Chromium included), but the NOWEB/GOWS engines run without a browser; no vendor RAM figure exists, so only a measurement can answer this | yes via `generic` (four environment variables) | **yes** — Apache-2.0, monthly releases, two active maintainers, no Core/Plus split since 2026.6.1 |

> **Decision (WA-PROVIDER-2, 2026-09-04): Evolution API stays the default
> adapter and nothing is replaced — but the reason has changed from "nothing
> could be verified" to "nothing is *proven* on this host yet".** The path is
> now concrete: the two live candidates for gate step 3 are **WAHA with the
> NOWEB (or GOWS) engine** as the *safe* candidate and **wa-evolution** as the
> *light* candidate, and both are driven by the existing code — WAHA through
> `generic` with the mapping above, wa-evolution through `evolution`
> unchanged. Whichever survives a week under a hard `--memory` cap on this
> host (gate step 3) is adopted by setting environment variables. Evolution
> API's own image is the only one already present on the host, and it is also
> the one whose stated minimum this host cannot currently meet.

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
2. **Live-verify the candidate** — **DONE 2026-09-04 (WA-PROVIDER-2, §3.2)**
   for Evolution API, wa-evolution and WAHA: repository, maintenance, licence,
   release cadence, protocol stack, required services, registry-reported image
   size and the exact text-send contract, each with its source. Re-run this
   step if more than ~60 days pass before step 3 starts.
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

- **The provider question is narrowed, not answered.** #147 removed the cost
  of choosing; WA-PROVIDER-2 verified the candidates and named the two to
  measure. No provider has been replaced, deployed or measured on this host.
- **`wa-evolution` is examined (§3.2) but not proven.** It is the lightest
  candidate by an order of magnitude and a byte-for-byte contract match, and
  it is also a two-month-old, zero-star, single-author re-implementation of
  the WhatsApp Web protocol. Adopting it means trusting one person's protocol
  stack for a production channel; that is a measured risk for the owner to
  accept or refuse at gate step 3, not a reason to pretend it was not looked at.
- **Evolution API's licence carries an obligation.** Its Apache-2.0 addendum
  requires a visible "Evolution API is being utilized" notice for
  administrators; if it is ever deployed, that notice belongs in
  `docs/MYTHOS_BRIDGE_WHATSAPP_NOTIFY.md` and the Status Center, and its
  stated 2 GB minimum is not met by this host today.
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
