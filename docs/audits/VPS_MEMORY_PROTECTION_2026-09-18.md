# VPS memory protection — 2026-09-18

**State: APPLIED + LIVE VERIFIED on the VPS** (17:15–17:30 UTC). This branch
records what is installed; merging it changes nothing on the host except
that `probes.json` in the repo then matches the live file.

## Why

2026-09-18 07:34–10:43 UTC: ~130 global OOM kills, swap 4095/4095 MB,
PSI60 65–83 %, then 285 minutes without a memwatch sample until a hard
reboot at 15:28:38. memwatch shows the demand:

| consumer | during the storm | cap before today |
|---|---|---|
| root login session scope (Claude Desktop remote agent sessions, `ccd-cli`) | 3.6–3.9 GB | `MemoryHigh=3.5G` soft only (applied after the storm), swap unbounded |
| `omniroute` container | RSS 490–613 MB (+449 MB already swapped at 17:15) | none (Node heap 1024 MB via `.env`, container unbounded) |
| deploy Node units | small (10–65 MB peak) | 6 of 9 had no cgroup cap |

A soft `MemoryHigh` does not bound swap: pages reclaimed from a throttled
slice are swapped out, which is how global swap filled.

## Reused, not duplicated

| need | existing component reused |
|---|---|
| OmniRoute container limit | its own compose file `/home/ubuntu/omniroute/compose.yaml` + `docker update` |
| Node heap limits | `OMNIROUTE_MEMORY_MB`/`NODE_OPTIONS` (OmniRoute, already 1024) and the `oom.conf` drop-in pattern of `ops/oom` for deploy units |
| systemd limits | `user-0.slice` properties already set by `systemctl set-property` (`system.control`), and `ops/session-guard/user-0.slice.d/memory.conf` |
| monitoring | `mythos-memwatch` (sampler Guardian and the Resource Guard already parse) — extended, not replaced |
| alerts / status | Status Center probe list (transition alerts go to its alert log) and Guardian's existing memory domain (OOM-kill delta, swap, PSI) — unchanged, already counts cgroup-local OOM kills via `/proc/vmstat` |

## Changes

1. **OmniRoute** — `docker update --memory=1536m --memory-swap=2560m omniroute`
   (live, no restart; cgroup `memory.max` 1610612736, `memory.swap.max`
   1073741824), and `mem_limit: 1536m` / `memswap_limit: 2560m` in
   `/home/ubuntu/omniroute/compose.yaml` (backup `compose.yaml.bak-pre-memlimit-20260918`)
   so a recreate keeps them. Heap 1024 MB was already in force (verified in
   `/proc/1/environ` inside the container; it is the only node process).
   The compose config hash now differs from the running container, so the
   next `docker compose up -d` recreates it — with the same limits.
   Rollback: `docker update --memory=0 --memory-swap=-1 omniroute` and remove
   the two compose lines.
2. **Root login slice** — `systemctl set-property user-0.slice MemoryMax=4608M MemorySwapMax=1G`
   (MemoryHigh 3.5G unchanged). This reverses the Session Guard's original
   "no MemoryMax" stance on evidence; see the header of
   `ops/session-guard/user-0.slice.d/memory.conf`. Effect: a runaway there
   is killed inside the slice (largest process = an agent session) rather
   than by a global OOM. Rollback: `systemctl set-property user-0.slice MemoryMax=infinity MemorySwapMax=infinity`.
3. **Deploy Node units** — `ops/oom/memory/*/memory.conf` installed beside
   `oom.conf`; cgroup caps live via daemon-reload, `NODE_OPTIONS` live via a
   sequential restart of 8 units, each confirmed back on its port. The
   executor was NOT restarted (no heap flag; cap only).
4. **memwatch** — appends `| lim …`: the root slice always, plus any capped
   cgroup at ≥ 80 % of its cap or with an OOM kill. Prefix unchanged; both
   parsers (Guardian `sources.js`, Resource Guard `MEMWATCH_RE`) re-verified
   against a live line. Source now tracked in `ops/memwatch/`. Backup
   `/opt/mythos-memwatch/memwatch.py.bak-20260918`.
5. **Status Center** — new `omniroute-loopback` probe (existing `https` type,
   `/api/monitoring/health`). OmniRoute had no probe; a cgroup kill + Docker
   restart is now a DOWN transition in the alert log. First run: 27/27 LIVE.

## Worst-case budget after this change (7.6 GB RAM + 4 GB swap)

Root slice ≤ 4.5 GB RAM + 1 GB swap; OmniRoute ≤ 1.5 GB + 1 GB; the rest of
the capped estate is bounded by its own caps. What is still **uncapped** and
could drive a global OOM on its own: `dar-hijama-production-{app,mysql,web,scheduler,queue}`,
`mythos-context7`, `mythos-github-mcp` (container), host `mariadb`/`php-fpm`,
and the deploy user manager's non-Node units. Dar Hijama MySQL needs the
review in `VPS_MEMORY_BUDGET_PLAN_2026-08-10.md` §10 step 5 first.

## Verification (2026-09-18 17:25 UTC)

- `memory.max`/`memory.high` read back from `/sys/fs/cgroup` for every unit and the slice.
- piece.autos 200, erp `/api/v1/health` 200, wp auth wall 401 (expected), idauto.tn 200, status 200.
- Guardian memory domain NORMAL; its three WARNINGs (sessions above ceiling, hostops inactive, restore test unverified) predate this change.
- No OOM kill anywhere (`oom_kill 0` in the slice and `/proc/vmstat` delta 0).
