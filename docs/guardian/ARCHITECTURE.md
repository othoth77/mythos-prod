# MYTHOS Guardian — architecture

## 1. Search first → reuse → connect → build last

Discovery (2026-09-14, `/tmp/mythos-guardian-discovery.md` on the host) found most of the capabilities already present. Guardian connects them and builds only what was missing.

| Capability | Existing component | Guardian's relationship |
|---|---|---|
| Memory decision (levels, hysteresis, OOM delta) | Resource Guard `projects/mythos-ai-executor/lib/resource-guard.js` | **Reused as a library**. Same thresholds. Guardian keeps its own state so protection survives the executor dying with `user@1001`. |
| Memory telemetry history | `mythos-memwatch` (120 s log) | Untouched; Guardian points incidents at it. |
| Agent session reclamation | `mythos-session-guard` (root, CAP_KILL, marker-gated) | **Remains the only signaller.** Guardian feeds it a working pressure level and reports its state. |
| Dashboard / public status | Status Center + `mythos-status-monitor` | **Connected**: new probe type `guardian-health` reads Guardian's public status. |
| Backups, verification, restore tests | `mythos-backup*`, `mythos-restore-*` | **Read-only consumer** of their health records and systemd results. |
| Read-only host verbs for agents | `mythos-hostops` | Untouched. |
| Runner orphan handling | `KillMode=control-group` drop-in (2026-09-13) | Verified; Guardian watches the unit. |
| Disk pressure policy + safe cleanup | none | **Built** (disk domain + code-owned allowlist). |
| Service restart-loop / degraded detection | none | **Built** (services domain). |
| Cross-domain host level + incident ledger | none | **Built** (decision engine + report). |

## 2. Components

One root oneshot, `mythos-guardian.service`, is driven every 2 minutes by `mythos-guardian.timer`. It is a single package with separated modules. Seven daemons were rejected: they would add seven failure modes and seven sandboxes for one host scan.

```
ops/guardian/
  bin/mythos-guardian     run | --dry-run | simulate | scenarios | status | validate
  lib/guardian.js         decision engine (tick, gating, incidents, simulations)
  lib/levels.js           level ladder + hysteresis state machine (pure)
  lib/memory.js           memory guard     — wraps resource-guard.js
  lib/disk.js             disk guard       — thresholds + code-owned cleanup allowlist
  lib/services.js         service guard    — systemd (system + deploy manager), docker, loopback HTTP
  lib/backup.js           backup guard     — health records + restore-test results
  lib/sessions.js         session view     — counts, session-guard liveness, orphans, advisory admission
  lib/report.js           reporter         — incidents, state, public status, pressure file
  lib/config.js           policy defaults + override + validation
  lib/procs.js, lib/io.js one /proc scan per tick; the only I/O boundary
  systemd/                unit, timer, two drop-ins
  install-guardian.sh     install | rollback | status
```

The order's requested logical components map onto these modules as follows: mythos-memory-guard → memory.js; mythos-session-guard → the existing unit plus sessions.js; mythos-disk-guard → disk.js; mythos-service-guard → services.js; mythos-backup-guard → backup.js; mythos-guardian-reporter → report.js together with the Status Center probe.

## 3. Decision engine

```
             collect (read-only)          classify (pure)            hysteresis (pure)
 /proc ──┐   memory  ─────────────▶  raw level + findings ──▶  levels.step ─▶ confirmed level
 statfs ─┤   disk    ─────────────▶  raw level + findings ──▶  levels.step ─▶ confirmed level
 systemd ┤   services ────────────▶  raw + restart plans  ──▶  levels.step ─▶ confirmed level
 docker ─┤   backup  ─────────────▶  raw level + states   ──▶  levels.step ─▶ confirmed level
 files ──┘   sessions ────────────▶  raw level + findings ──▶  levels.step ─▶ confirmed level
                                                                              │
                                  overall = max(confirmed) ◀──────────────────┘
                                              │
                    plan (from CONFIRMED levels only: disk ≥ HIGH cleanup, failed restart-safe units)
                                              │
   gate: dry-run → kill switch → config error → marker → cooldown → per-tick cap (3)
                                              │
                      execute (re-verified) → incidents → state → public status → pressure file
```

Hysteresis (`lib/levels.js`):
- **Escalation** needs 2 consecutive ticks, except *immediate* evidence: an oom_kill delta, a level already confirmed by the Resource Guard, a failed critical unit, or disk ≥ 95 %.
- **De-escalation** moves one step per 3 ticks, and leaving WARNING passes through RECOVERY for 3 ticks. EMERGENCY → NORMAL therefore takes 15 ticks (30 min).
- Alternating evidence never commits a transition (tested).

Per-domain policy summary (full numbers in CONFIGURATION.md):

| Domain | WARNING | HIGH | CRITICAL | EMERGENCY |
|---|---|---|---|---|
| memory | RG WARNING (avail ≤ 1200 MiB or PSI ≥ 5), or swap ≥ 95 % **and** avail ≤ 1200 MiB | — | RG CRITICAL (avail ≤ 700 MiB, PSI ≥ 30, or an OOM kill) | CRITICAL and avail ≤ 400 MiB |
| disk (fs % or inode %) | ≥ 80 % report | ≥ 85 % safe cleanup | ≥ 90 % + CRITICAL targets | ≥ 95 % + journal vacuum |
| services | support unit down | production unit down / restart loop / budget exhausted | critical unit down (user@1001, nginx, docker, ERP, idauto-postgres) | — |
| backup | stale / restore test failed or overdue | BACKUP_FAILED | — | — |
| sessions | > 8 sessions, over the pressure ceiling, stale session guard, ≥ 5 orphans | sessions above the CRITICAL ceiling | — | — |

## 4. Actions and who owns them

| Action | Marker | Domain trigger |
|---|---|---|
| Pressure file for the session guard | none (information only) | every tick |
| Advisory admission ceiling (6/5/4/3/0/0) | none (information only) | every tick |
| Allowlisted path cleanup | `disk-cleanup` | disk ≥ target min level |
| Docker build cache / dangling images | `docker-cleanup` | disk ≥ HIGH / ≥ CRITICAL |
| Journal vacuum to 300 M | `disk-emergency` | disk EMERGENCY |
| `systemctl reset-failed` + `start` of a restart-safe unit | `service-recovery` | unit failed, no loop, budget left |
| SIGTERM of idle agent sessions | **session guard's own marker** | the session guard's plan (fed by Guardian's pressure level) |

"Prevent new agent sessions" is **advisory** by construction. Desktop Remote sessions are created by the Claude Desktop app's server, which nothing on this host can refuse. Guardian therefore publishes `admission.max_heavy_sessions` and lowers the session guard's idle threshold under pressure. It does not pretend to block.

## 5. Failure posture

| Failure | Behaviour |
|---|---|
| Guardian crashes or its timer stops | Nothing else depends on it. The pressure file ages past 5 min, so the session guard reverts to NORMAL, its pre-Guardian behaviour. The Status Center probe turns DOWN after 10 min. |
| A domain throws | It keeps its previous confirmed level, plans nothing and reports `domain_error`. |
| Invalid override config | Guardian observes with the built-in defaults, refuses every action and reports `config_error`. |
| Status Center unavailable | No effect: the Status Center pulls the file, Guardian never pushes. |
| Public status / pressure write fails (e.g. disk full) | `report_errors` is recorded and protection continues. `last-incident.json` is a fixed-size overwrite. |
| Beszel unavailable | No effect: Guardian has no Beszel code path. |

## 6. Beszel evaluation (Phase 12)

Upstream `henrygd/beszel` **v0.19.0** (2026-09-03), MIT. A hub (PocketBase web app with dashboard, alerts, OAuth/OIDC, S3/disk backups) plus one agent per host. The agent reports CPU/memory/swap/disk/disk-IO/network/load/temperature and Docker per-container stats. Install options: a single Go binary (`beszel_linux_amd64.tar.gz` / `beszel-agent_linux_amd64.tar.gz`, `.deb` for the agent) or Docker images.

| Question | Finding on this host |
|---|---|
| Resource footprint | Two more resident processes (hub web app + agent), tens of MB. It also adds a history database that grows on a disk Guardian is protecting, on a host whose swap sits at 91–100 %. |
| Network exposure | The hub needs a web UI plus an agent port (45876). Keeping them loopback-only still needs a new authenticated nginx vhost or an SSH tunnel for any human to use it. |
| Authentication | Separate user database or OIDC: one more credential surface. The existing Dex/OAuth bridge could front it, but that is new integration work. |
| Alerting | Its own notifier configuration, duplicating the WhatsApp/Status Center channels. |
| Duplication | Host and Docker time series overlap memwatch (memory history), the Status Center `vps-resources` probe (disk/memory/swap/load now) and Guardian (levels). What it would add is per-container CPU/network history graphs. |
| Remediation | None, which is correct: Beszel must never own remediation. |

**Decision: NOT INSTALLED in this change.** It is not blocked, only not justified yet. The meaningful gap it fills (per-container history graphs) is a nice-to-have. The costs are a new persistent service, a new auth surface and a new growing database on a memory-tight host. If the owner wants the graphs, the least invasive path is: agent binary as a systemd unit bound to 127.0.0.1, hub binary bound to 127.0.0.1 behind the existing OAuth proxy, `MemoryMax=96M` on each, data under `/var/lib/beszel` added to Guardian's disk watch. Guardian needs no change either way.
