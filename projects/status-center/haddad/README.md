# Status Center — AI node ingest (`projects/status-center/haddad/`)

The VPS half of **MYTHOS HADDAD**, the live AI-node section of
`status.mythosprod.xyz`. The node half is
[`projects/mythos-haddad/`](../../mythos-haddad/), and the design, the
thresholds and the security argument are in
[`projects/mythos-haddad/docs/TELEMETRY.md`](../../mythos-haddad/docs/TELEMETRY.md).

## Why this exists at all

The Status Center already has live monitoring: STC-2's collector
(`../monitor/`) polls every service every five minutes and computes
LIVE/DEGRADED/DOWN from real checks. **It cannot poll Haddad.** The VPS has
no Tailscale and no VPS→Haddad SSH credential — registering one is a
pending owner decision (`projects/mythos-haddad/STATUS.md`). Haddad→VPS
HTTPS does work (verified on the node, `curl https://status.mythosprod.xyz/health`
→ 200).

So the direction is inverted: **the node pushes, this host receives.**
That is not a workaround, it is the safer arrangement — Haddad opens no
port, publishes no endpoint, and needs no inbound firewall rule, which is
exactly the boundary the V1 scope asked for.

```
Haddad (othman)                            VPS
  mythos-haddad-telemetry.timer  ── 10 s
    haddad-telemetry.js
      health-latest.json  ─┐
      executor lib/state.js│  reads only
      llama-server :8600   │  what already
      systemctl --user     │  exists
      haddad-gpu-vram.py  ─┘
      │ sign (Ed25519, key never leaves the node)
      ▼  HTTPS POST /ingest
                              nginx  location = /ingest
                                POST only · 64 KiB cap · 10 r/s
                                ▼
                              mythos-haddad-ingest.service
                                127.0.0.1:8190, loopback only
                                verify → allow-list → derive state
                                ▼
                              data/haddad-node.json          (atomic snapshot)
                              data/haddad-history/*.jsonl    (append-only)
                              data/haddad-history/transitions.jsonl
                                ▼
                              assets/haddad.js
                                the card on /  and the console on /haddad/
```

## Files

| File | Role |
|---|---|
| `lib/node-state.js` | The contract. `sanitize()` is the **allow-list** that decides what may be published; `deriveState()` is the one place a node state is decided. No I/O, no clock of its own — the tests drive it directly. |
| `bin/haddad-ingest.js` | The receiver. Verifies, sanitises, derives, writes three files. `GET /health` and `POST /ingest` are the only routes; there is no verb that reaches a node. |
| `bin/register-node.sh` | Registers, re-keys, disables or lists a node. Refuses a key the receiver could not use, and refuses a private key pasted by mistake. |
| `systemd/mythos-haddad-ingest.service` | The unit, sandboxed (see below). |
| `install.sh` | Idempotent install/rollback: service user, registry, data ownership, unit, and two **additive** nginx locations between managed markers. |
| `nodes.example.json` | The committed shape of the registry. The deployed file is `/etc/mythos/haddad-nodes.json` and is **not** in git — it carries per-node public keys registered operationally. |

## Install

```bash
sudo bash projects/status-center/haddad/install.sh
```

Fail-closed preflight (`node --check` on both modules, docroot present,
vhost present, port free), then: the `mythos-ingest` system user (no
shell, no home), `/etc/mythos/haddad-nodes.json` **with an empty node
list**, ownership of the receiver's two output paths, the unit (verified
with `systemd-analyze verify` and confirmed answering `/health`), and the
nginx block inserted before the catch-all `location /`.

Rollback:

```bash
sudo bash projects/status-center/haddad/install.sh --rollback
```

removes the unit, the nginx block (keeping a timestamped `.bak` of the
vhost) and the service user. It deliberately **keeps** the registry and
the published history: node registrations and the record of what was
actually seen are not this script's to destroy.

## Registering a node

A node is invisible until its public key is here. That is the whole
access-control story — there is no shared secret and no inbound path.

On the node:

```bash
projects/mythos-haddad/bin/haddad-telemetry-setup.sh
```

It generates an Ed25519 key **on that machine**, keeps the private half
0600, and prints the public half. On the VPS:

```bash
sudo bash projects/status-center/haddad/bin/register-node.sh haddad <base64-public-key> "MYTHOS HADDAD"
bash projects/status-center/haddad/bin/register-node.sh --list
sudo bash projects/status-center/haddad/bin/register-node.sh --disable haddad
```

The receiver re-reads the registry on **every** request, so registering,
re-keying or disabling a node takes effect immediately and loses no beat.

Adding a second node (`haddad-02`) is this registration and nothing else:
the published document has been an array of nodes since version 1. No
scheduler, routing or fleet control is implemented, and none is implied.

## Security boundary

Asserted by `tests/haddad-ingest-test.js` §6, not just described:

- **The receiver cannot reach a node.** It contains no `child_process`,
  no outbound request of any kind, and no outbound socket. It only
  listens. The unit adds `IPAddressDeny=any` + `IPAddressAllow=localhost`,
  so this is enforced by the kernel and not only by the code.
- **Loopback only.** It binds `127.0.0.1:8190`. nginx is the only way in,
  and it accepts `POST` alone.
- **No shared secret.** Ed25519, public keys only on this host. Nothing
  secret crosses the wire, a transcript or a backup.
- **Replay and skew.** A per-node strictly increasing sequence, and a
  120 s clock bound. An oversized body is refused before it is buffered.
- **Fail closed.** An unreadable registry answers 503 and accepts
  nothing. An unusable or non-Ed25519 key registers nothing.
- **A node cannot publish a secret.** `sanitize()` is an allow-list, so an
  agent that starts sending `api_key` publishes nothing new. The suite
  drives real secret-shaped fields through the whole path and asserts they
  reach neither the snapshot nor the history.
- **A node cannot rename itself.** The display name comes from the
  registry, not the envelope.
- **Own user, own directory.** `mythos-ingest`, `ProtectSystem=strict`,
  `ProtectHome=tmpfs` plus one read-only bind of this directory, and
  exactly one `ReadWritePaths`. `systemd-analyze security` → **2.9 OK**.
- **Explicit memory ceiling.** `MemoryMax=128M`. This host has been
  OOM-killed by accumulated Node processes before.

`MemoryDenyWriteExecute` is deliberately **absent**: V8 needs W→X memory
for its JIT and aborts under it. That was verified here on 2026-09-22
(SIGTRAP in `MemoryAllocator::SetPermissionsOnExecutableMemoryChunk`),
not assumed — and it is the same class of trap already recorded for the
Haddad runtime unit, where a `SystemCallFilter` negation killed the
Vulkan driver with SIGSYS.

## Node states

Computed in `deriveState()`, never curated, precedence total:

| State | When | Threshold |
|---|---|---|
| `OFFLINE` | no heartbeat | ≥ 45 s (4.5 missed beats) |
| `DEGRADED` | late heartbeat, **or** any failing health check, **or** a stopped/degraded worker | ≥ 30 s (3 missed beats) for the heartbeat case |
| `BUSY` | a task is really executing | — |
| `WAITING` | work queued/waiting, none executing | — |
| `ONLINE` | everything passes, nothing in flight | — |
| `UNKNOWN` | the node has never reported | — |

Every branch names its reason and the reason is published, so the UI never
shows a state without saying why.

Two cases the owner named specifically:

- **Haddad's process is up but the Qwen runtime is dead → `DEGRADED`**, not
  ONLINE. A stopped worker outranks a healthy-looking process.
- **Haddad is up and Qwen is executing → `BUSY`.**

And one the node itself flagged: the scheduled health run is `--quick`,
which skips the GPU stress test and records the skip as `WARN`. A `WARN`
with zero `FAIL` is **not** a degradation — keying off `status` alone
would page on every scheduled run. Only `counts.FAIL > 0` degrades.

## The browser re-derives, on purpose

`data/haddad-node.json` keeps its last contents if this receiver dies. A
frozen `ONLINE` would be a lie, so `assets/haddad.js` recomputes the state
from `received_at` and the thresholds published inside the document, and
says so on the page when it overrides. The receiver also republishes on a
15 s tick, so a node that goes away decays to OFFLINE in the file too —
belt and braces, because each covers the other's failure.

## Tests

```bash
node tests/haddad-ingest-test.js     # 114 assertions
node tests/haddad-telemetry-test.js  # 109 assertions
```

Offline, zero dependencies. The ingest suite drives the **real** receiver
over a real loopback socket with **real** Ed25519 signatures — nothing is
stubbed that production would do for itself.

## Known limitations

- **No historical charts.** Every beat is persisted to
  `data/haddad-history/YYYY-MM.jsonl`, but the console charts only what the
  open browser has observed since the page loaded, and labels it as such.
  Charting the durable history is not built. Nothing is back-filled or
  interpolated.
- **No notifications.** Alerts are rendered on the page only. Nothing is
  sent to WhatsApp, Telegram or email.
- **History resolution is one minute, not one beat.** Every state change is
  kept unconditionally; between changes at most one row per 60 s. A row per
  10 s beat would cost ~72 MB a node a month on a host that has been
  disk-pressured before, for a resolution nothing reads back. Measured cost
  as built: **289 B/row, 11.9 MB per node per month**, retired after six
  months by an hourly sweep. `transitions.jsonl` is never swept — it is one
  line per real state change and does not grow.
