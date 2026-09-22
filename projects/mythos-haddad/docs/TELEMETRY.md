# Mythos Haddad — telemetry and the Status Center console

**Stage:** MYTHOS HADDAD live console · **Date:** 2026-09-22 ·
**Branch:** `mythos-haddad/status-live-console`
**Node half:** `projects/mythos-haddad/bin/haddad-telemetry.js`
**VPS half:** [`projects/status-center/haddad/`](../../status-center/haddad/README.md)
**Surfaces:** `https://status.mythosprod.xyz/` (card) and `/haddad/` (console)

Haddad stops being a machine you can only reach by SSH and becomes a node
you can watch. The operational shape is HiveOS-like — node, hardware, GPU,
workload, resources, job, log, alert — but nothing of HiveOS is installed
and no monitoring stack is added.

---

## 1. Why the node pushes

The Status Center already monitors live services: STC-2's collector
(`projects/status-center/monitor/`) polls every target every five minutes
and computes LIVE/DEGRADED/DOWN from real checks. Reusing it for Haddad
was the first thing tried, and it cannot work:

| | Finding |
|---|---|
| VPS → Haddad, network | **No route.** Tailscale is not installed on the VPS; `ping 100.78.7.10` gets nothing. |
| VPS → Haddad, credential | **None exists.** `docs/HADDAD_MCP.md` §1 records it explicitly — "no SSH from Haddad to the VPS exists, and none was created" — and `STATUS.md` lists registering a VPS→Haddad credential as a *deferred owner decision*. |
| Haddad → VPS | **Works.** Verified on the node: `curl -o /dev/null -w '%{http_code}' https://status.mythosprod.xyz/health` → `200`. |

So the direction inverts. That is not a workaround around a missing
credential — it is the better answer to the V1 security rule ("no new
port on Haddad"):

- Haddad opens **no** port, publishes **no** endpoint, needs **no**
  inbound firewall rule.
- The VPS needs **no** credential for Haddad, so there is nothing on the
  public-facing host that could be stolen and used to reach the node.
- Adding a second node later requires no VPS-side network change at all.

It also means this feature does **not** block on the pending owner
decision about a VPS→Haddad SSH credential. That decision stays open and
unaffected.

## 2. Data flow

```
Haddad (user othman, no root anywhere in this path)
│
├ mythos-haddad-telemetry.timer            every 10 s, AccuracySec=1s, Persistent=false
│   └ mythos-haddad-telemetry.service      Type=oneshot, TimeoutStartSec=9
│       └ bin/haddad-telemetry.js
│            reads, and only reads:
│              ~/.local/state/mythos-haddad/health-latest.json     written by the EXISTING health timer
│              the executor store, through the executor's OWN lib/state.js
│              http://127.0.0.1:8600/{v1/models,health,props}      the EXISTING llama-server
│              systemctl --user is-active <the four existing units>
│              bin/haddad-gpu-vram.py                              the EXISTING GPU probe
│              /proc/{meminfo,pressure/*}, statfs, loadavg
│            signs the body with Ed25519 (private key 0600, never transmitted)
│
▼ HTTPS POST https://status.mythosprod.xyz/ingest        the ONLY outbound call
│
VPS
├ nginx  location = /ingest      POST only · 64 KiB cap · limit_req 10 r/s burst 5 · no cookie
│
├ mythos-haddad-ingest.service   127.0.0.1:8190, loopback only, user mythos-ingest
│    verify signature → look up node → refuse replay/skew → ALLOW-LIST → derive state
│
├ data/haddad-node.json                    atomic snapshot, the UI's only source
├ data/haddad-history/YYYY-MM.jsonl        downsampled, append-only
└ data/haddad-history/transitions.jsonl    one line per real state change
     │
     ▼ same-origin fetch, every 5 s
   assets/haddad.js  →  the card on / and the console on /haddad/
```

## 3. What was reused, and what is new

**Reused, unmodified:** the executor and its `lib/state.js` (the task
vocabulary, the store layout, `effectiveStatus`), the health timer and its
`mythos-haddad-health/1` report, `haddad-gpu-vram.py`, the llama-server,
systemd as the scheduler, the Status Center docroot, its vhost, its TLS,
its `/data/` no-cache rule, STC-2's atomic-write + append-only-history
idiom, and the site's tokens, pills, cards, tables and Arabic explanatory
layer.

**New, and only this:** one agent (a collector and a signer — it schedules
nothing), one loopback receiver, one shared contract module, one page, one
stylesheet block.

**Deliberately not built:** a queue, a scheduler, an executor, a provider,
a second state machine, a monitoring stack, an MCP server, a database, an
event system, a resource monitor, a notification channel.

### Why not the Haddad MCP

The node offers `haddad_health` over SSH-stdio (`docs/HADDAD_MCP.md`), and
it is the right contract for a *client that can reach Haddad*. The Status
Center cannot: an MCP client on the VPS would need the SSH credential that
does not exist. Reaching it through the MCP would therefore require
creating exactly the inbound path this design avoids. The MCP stays the
interface for interactive sessions; telemetry is the interface for
continuous observation. They read the same underlying files.

## 4. Trust: no shared secret anywhere

Each node generates an **Ed25519** key pair on itself
(`haddad-telemetry-setup.sh`). The private half is 0600 and never leaves
the machine — not over the wire, not through a transcript, not into a
backup. The VPS is given only the public half, which is not a secret, and
which is why registering a node is safe to do over any channel.

| Attack | Refusal |
|---|---|
| Forged envelope | signature verified against the registered key → `401` |
| Valid signature, wrong key | the key is looked up **by node id** → `401` |
| Unregistered / disabled node | registry lookup → `401` |
| Body claiming another node than the header | the signature covers the body, so the two must agree → `400` |
| Replay of a captured beat | per-node strictly increasing sequence → `409` |
| Old captured beat | 120 s clock bound → `400` |
| Oversized body | refused at `Content-Length`, and again while streaming → `413` |
| Flood | nginx `limit_req` 10 r/s (100× the heartbeat) before the receiver sees it |
| Registry unreadable | **fail closed** — `503`, nothing accepted |
| Key that is not Ed25519 | registers nothing; `register-node.sh` refuses it up front |
| Private key pasted into the registry | `register-node.sh` refuses it explicitly |

## 5. Secrets: the allow-list, not a denylist

`projects/status-center/haddad/lib/node-state.js` → `sanitize()` names
every field that may be published. A field it does not name **cannot**
reach the snapshot, the history, or the page. This is structural: an agent
that starts sending `api_key` tomorrow publishes nothing new, and no
regex has to anticipate the name.

On the node side the agent never carries a credential either: the runtime
API key is used only as an `Authorization` header on a loopback request,
and the executor bearer is read by reference from the executor's own 0600
file — the same idiom `haddad-mcp-stdio.sh` uses. Neither is ever placed
in an envelope or logged.

`tests/haddad-ingest-test.js` §1 drives real secret-shaped values through
the whole path and asserts they reach neither output.

### What IS published, and the owner's decision about it

The page is served over TLS, is `noindex`, and `robots.txt` disallows
everything — but it is **not authenticated**. What a node publishes about
its work is therefore public to anyone with the URL:

- structured task identity: task id, GitHub issue number, project, action,
  execution profile, provider, model, attempt, status, elapsed time
- a validation **verdict as counts** ("2 / 2 checks passed")
- the review state
- the event stream as **timestamp / source / event name / task / severity**,
  plus the executor's own controlled vocabulary (`to=`, `from=`, `reason=`,
  `classification=`, `provider=`, `model=`, `attempt=`)

This is the same class of information the Status Center already publishes
about every project in `data/current.json`. Three free-text fields were
**deliberately removed** after review rather than published:
`next_action`, the validator's prose, and event `error` / `summary` text —
each is written per task, can contain anything, and none of them appears
in the owner's requested field list.

**If the owner wants even the structured task identity off a public page,
the fix is to gate the page, not to blank fields** — a half-blanked view
invites the reader to guess. That is an owner decision and is recorded in
STATUS.md as open.

## 6. States and thresholds

Heartbeat **10 s**. Both thresholds are derived from it, written once in
`DEFAULT_THRESHOLDS`, published inside every snapshot, and applied
identically by the receiver and the browser.

| State | Condition | Threshold |
|---|---|---|
| `OFFLINE` | no beat received | **≥ 45 s** (4.5 missed beats) |
| `DEGRADED` | beat late | **≥ 30 s** (3 missed beats) |
| `DEGRADED` | `health.counts.FAIL > 0` | — |
| `DEGRADED` | any worker `STOPPED` or `DEGRADED` | — |
| `BUSY` | a task is really executing | — |
| `WAITING` | queued/waiting work, none executing | — |
| `ONLINE` | everything passes, nothing in flight | — |
| `UNKNOWN` | the node has never reported | — |

Precedence is total and in that order. One late beat never pages: DEGRADED
needs three missed beats and OFFLINE four and a half.

Three cases worth stating because getting them wrong would be a lie:

- **Process up, Qwen runtime dead → `DEGRADED`.** A stopped worker
  outranks a process that is merely alive.
- **Up and executing → `BUSY`**, and `OFFLINE` outranks `BUSY`, so a node
  that dies mid-task is never shown working.
- **`health.status: WARN` with `FAIL: 0` → still `ONLINE`.** The scheduled
  health run is `--quick`, which skips the GPU stress test and records the
  skip as a WARN. Keying off `status` would page on every scheduled run.
  Only `counts.FAIL` degrades. (Flagged by the node itself during review.)

Task states are the **executor's existing vocabulary** — QUEUED, RUNNING,
WAITING_FOR_QUOTA, WAITING_RETRY, COMPLETED, FAILED, BLOCKED, CANCELLED,
plus the derived INTERRUPTED. No second state machine was created.

## 7. A frozen file cannot lie

`haddad-node.json` keeps its last contents if the receiver dies. A frozen
`ONLINE` would be the worst possible failure for a status page, so two
independent mechanisms cover it:

1. **The receiver republishes on a 15 s tick**, so a node that stops
   beating decays to OFFLINE in the file itself, and that decay is written
   to `transitions.jsonl` like any other change.
2. **The browser re-derives** state from `received_at` and the published
   thresholds on every poll, and says on the page when it has overridden
   the stored value.

Each covers the other's failure: (1) fails if the receiver is dead, which
is exactly when (2) applies.

## 8. Measured cost

Measured on the VPS, 2026-09-22, with the real agent against the real
endpoint over public HTTPS:

| | Value |
|---|---|
| Per beat, wall | 0.32–0.40 s |
| Per beat, CPU | **0.32 CPU-s** (of which ~0.15 s is Node process startup) |
| Per beat, peak RSS | 68 MB, for ~0.35 s — **nothing resident between beats** |
| Envelope on the wire | ~2.4 KB |
| Continuous CPU at 10 s | **~3.2 % of one core** — on Haddad's 6 cores, ~0.5 % of the machine |
| Published history | 289 B/row, one row/minute → **11.9 MB per node per month**, retired after 6 months |

Three collectors are cached because they read facts that cannot change
between beats, and re-deriving them was the whole cost:

| Cached | Keyed on | Was costing |
|---|---|---|
| runtime load facts (GPU layers, model VRAM) | the runtime unit's `ActiveEnterTimestamp` | 600 journal lines per beat |
| GPU identity + total VRAM + whether any counter exists | boot time | a `python3` start + `lspci` per beat |
| repo HEAD / branch / dirty | 5 minutes | three `git` spawns per beat, incl. `git status` |

That took the beat from 0.49 to 0.32 CPU-s. **A timer was kept over a
daemon on purpose:** a daemon would cost ~0.01 CPU-s per beat but hold
~68 MB resident forever, and Haddad is RAM-constrained (8 GB, with Qwen
already at ~2.1 GB RSS) and CPU-plentiful (6 cores). It is also
crash-proof — there is no long-running process to hang.

## 9. Operation

**On the node:**

```bash
projects/mythos-haddad/bin/haddad-telemetry-setup.sh            # configure, print the public key
projects/mythos-haddad/bin/haddad-telemetry-setup.sh --print-key
node projects/mythos-haddad/bin/haddad-telemetry.js --dry-run   # collect and print, send nothing
systemctl --user enable --now mythos-haddad-telemetry.timer     # only after the key is registered
```

`--dry-run` is the honest way to inspect what a node would publish before
a single beat goes out.

**On the VPS:** see
[`projects/status-center/haddad/README.md`](../../status-center/haddad/README.md).

**Rollback, node:**

```bash
systemctl --user disable --now mythos-haddad-telemetry.timer
rm ~/.config/systemd/user/mythos-haddad-telemetry.{service,timer}
rm ~/.config/mythos-haddad/telemetry.env ~/.config/mythos-haddad/telemetry-key.pem
```

**Rollback, VPS:** `sudo bash projects/status-center/haddad/install.sh --rollback`.
Disabling one node without touching anything else:
`sudo bash .../bin/register-node.sh --disable haddad`. Its beats are
refused from the next request, with no restart.

Neither rollback deletes the history or the registry.

## 10. Two traps recorded so nobody repeats them

**The executor home.** The agent originally read `MYTHOS_EXECUTOR_HOME`
from `~/.config/mythos-ai-executor/executor.env`. On Haddad that file
holds only `MYTHOS_EXECUTOR_TOKEN`; the home is set in
`~/.config/mythos-haddad/worker.env`, which is what the worker unit
actually loads. The result was not an error — `state.js` fell back to a
directory that does not exist and the agent published `task_counts: {}`,
which renders **exactly like a healthy idle node**. Found by review on the
real host before any beat was sent. `worker.env` is now consulted first,
and `tests/haddad-telemetry-test.js` §9 drives a fixture store and asserts
the counts are non-empty, because a silent empty view is the failure mode
no assertion on shape would ever catch.

**`HADDAD_MCP_REPO` is already taken.** It means the MCP launcher's
checkout on that host. Borrowing it for the telemetry repo path would let
a scratch value left in a shell silently repoint the live MCP launcher at
a temporary worktree. The agent uses `HADDAD_TELEMETRY_REPO`, and defaults
to the checkout it was itself run from, so a dry run needs no environment
at all.

(A third, on the VPS side, is in the ingest README: `MemoryDenyWriteExecute`
aborts V8.)

## 11. Known limitations

| | State |
|---|---|
| GPU utilisation, temperature, power, live VRAM | **N/A by driver limitation.** nouveau/NVK exposes no counter to an unprivileged reader and there is no `nvidia-smi` on the open stack; the Vulkan budget probe returns `heapUsage: 0` even with the model resident (already recorded in `AI_RUNTIME.md`). Published as `null` with the reason stated. The **runtime's own** load accounting is published instead, labelled with its provenance. |
| Historical charts | **Not built.** Every beat's downsampled row is persisted, but the console charts only what the open browser has observed since page load, and labels it so. Nothing is back-filled or interpolated. |
| Notifications | **Not built.** Alerts render on the page only. Nothing is sent to WhatsApp, Telegram or email. |
| Inference speed (`tokens_per_s`) | **N/A.** llama-server exposes it per request, not as a rolling figure; deriving one would mean sampling the runtime, which the monitoring must not do. |
| FABLE | **UNKNOWN by construction.** It is an interactive Claude session, not a unit; the node genuinely cannot observe it and the row says so. |
| Fleet | The document is an array of nodes and `haddad-02` is a registration away. **No scheduler, routing or fleet control is implemented**, and none is implied by the shape. |
