# MYTHOS Guardian — configuration

The policy lives in `ops/guardian/lib/config.js` (`DEFAULTS`), reviewed in git. An optional override at `/etc/mythos-guardian/config.json` is deep-merged over it: objects merge, arrays replace.

```bash
mythos-guardian validate --config /etc/mythos-guardian/config.json   # exit 3 = invalid
```

An override that fails validation is **ignored as a whole**. Guardian keeps observing with the defaults, refuses every action and reports `config_error`.

## Invariants no override can relax (enforced in `validate`)

- `recover: true` is refused for anything matching erp, postgres, mysql, mariadb, docker or containerd, and for any Docker or HTTP entry.
- HTTP checks must be `http://127.0.0.1:<port>/…`.
- Cleanup ids must exist in code (`disk.js TARGETS`). Config can enable or disable an id, raise its `min_level` or lengthen `min_age_days`. It can **never** add a path or a command, lower a level or shorten an age.
- `backup.records` must keep `mythos-erp` with `required: true`.
- Disk thresholds must ascend: warning < high < critical < emergency.

## Thresholds and the evidence behind them

### Memory (reused Resource Guard numbers, docs/MYTHOS_RESOURCE_GUARD.md)

| Level | Enter | Exit |
|---|---|---|
| WARNING | MemAvailable ≤ 1200 MiB or PSI some avg60 ≥ 5 | ≥ 1600 MiB and PSI ≤ 2 |
| CRITICAL | ≤ 700 MiB, PSI ≥ 30, or any oom_kill delta (immediate) | ≥ 1100 MiB and PSI ≤ 10 |
| EMERGENCY (Guardian) | CRITICAL and MemAvailable ≤ 400 MiB, 2 ticks | via one-step de-escalation |

**Deviation from the order, on purpose: swap percentage alone is not a trigger.** The order proposed swap > 80 % = WARNING and > 95 % = CRITICAL. On this host swap sat at 91 % at discovery (01:04 UTC) and at 100 % at 01:08, while MemAvailable was 3.5–3.7 GiB and PSI 0.00–1.11. The Resource Guard replay over ~30 h of memwatch data (the 2026-09-01 mass-kill included) shows swap at 96–100 % through healthy days. A swap-only rule would park the host in CRITICAL permanently: every agent session would be held at a zero ceiling, and the session guard's 15-minute pressure idle threshold would be armed forever. Guardian instead uses swap as a *compound* rule: swap ≥ 95 % **and** MemAvailable ≤ 1200 MiB → WARNING. Swap % is still reported everywhere.

### Disk

| Level | fs used % or inode % | Behaviour |
|---|---|---|
| WARNING | ≥ 80 | report only |
| HIGH | ≥ 85 | HIGH cleanup targets |
| CRITICAL | ≥ 90 | + CRITICAL targets (old agent CLI versions, old scratchpads, dangling images) |
| EMERGENCY | ≥ 95 (immediate) | + journal vacuum to 300 M |

Cooldown: 360 minutes per cleanup target, and at most 3 actions per tick.

### Services

- Restart loop: NRestarts / Docker RestartCount rising by ≥ 5 within 30 min → `LOOP`, DEGRADED, never restarted.
- Recovery budget: 3 attempts per unit per 6 h, then DEGRADED and hands off. Cooldown between attempts: 10 min.
- A unit that hit its own StartLimit is, by construction, a loop. It becomes eligible for **one** Guardian attempt only after 30 quiet minutes. This is deliberate: Guardian recovers units left dead (e.g. by a killed user manager), not units that keep crashing.

| Class | Down means | Examples |
|---|---|---|
| critical | CRITICAL, immediate | user@1001 (recover), nginx (recover), docker, erp-api, ERP health, idauto-postgres |
| production | HIGH | idauto-api, executor, command-center, os-console, mythos-wp, piece-autos, spy, storefront, mcp-http, php-fpm (recover); mariadb, containers (observe) |
| support | WARNING | memwatch, hostops, oth-knowledge, spy-monitor (recover); runner, backup/restore/monitor timers, omniroute (observe) |

### Backup

Records must be < 26 h fresh (OK). Up to 50 h is a WARNING, beyond that FAILED. Restore tests must have succeeded within 40 days (monthly timer plus randomised delay). Without a systemd result, a recent `restore-test-*` directory counts as UNVERIFIED (WARNING).

### Sessions

Hard max 8. Advisory ceiling by overall level: NORMAL 6 · RECOVERY 5 · WARNING 4 · HIGH 3 · CRITICAL 0 · EMERGENCY 0. The session guard state must be < 15 min old. Orphans are counted when their PPID is 1, they sit in a login-session scope, they are a known tool command and they are ≥ 10 min old; ≥ 5 → WARNING.

## Systemd resource-control audit (Phase 3)

Measured 2026-09-14 01:05 UTC. "Change" lists only what this work applies; everything else was examined and deliberately left alone.

| Unit | Mem now | MemoryMax | Restart | OOMScoreAdj | Change | Reason |
|---|---|---|---|---|---|---|
| erp-api (deploy) | 16 MB | 384M, High 300M | on-failure, 5/5min | 0 | **none** | already bounded and OOM-parity protected (09-13); ERP is out of scope |
| mythos-wp (deploy) | 24 MB | 256M, High 200M | on-failure | 0 | none | bounded |
| piece-autos / spy / spy-monitor | 107 / 145 / 13 MB | 300M / 512M / 128M | on-failure | 0 | none | bounded |
| idauto-api, executor, command-center, os-console, oth-knowledge, storefront | 5–43 MB | none | on-failure | 0 | **none** | tiny, never the OOM cause (victims, not culprits, 09-01 analysis). A hard MemoryMax would add a *new* kill path to production without evidence of growth. Guardian watches them and recovers them. |
| mythos-status-monitor | oneshot | none | — | 0 | **MemoryMax=192M, TimeoutStartSec=120** (drop-in) | unbounded collector; normal run < 60 MB / < 10 s |
| mythos-session-guard | oneshot | 192M | — | 500 | **Environment=MYTHOS_SESSION_GUARD_RG_STATE** (drop-in) | fixes the dot-prefix path defect so pressure is ever seen |
| mythos-memwatch | 3.6 MB | 64M | always | 0 | none | bounded |
| mythos-gh-runner | 90 MB | none | always | 0 | none | KillMode=control-group already fixes orphans; a job-time MemoryMax needs job evidence first |
| mythos-hostops / mcp-http / studio | 2 / 14 / 6 MB | none / 256M / 1G | on-failure | 0 | none | small |
| docker / containerd | 179 / 260 MB | none | always | −500 / −999 | none | vendor defaults, never touched |
| user-0.slice (agent sessions) | 3.3 GB | none | — | — | **none** — recommended, not applied | `MemoryHigh` on this slice is the only real demand-side limit. With swap at 100 %, reclaim inside the slice would stall the owner's live sessions (one was running a DarHijama rollback audit). Owner decision; see RUNBOOK §6. |
| mythos-guardian | oneshot | 192M, CPU 25 %, Tasks 32 | — | −100 | new | bounded; slightly OOM-protected so it can report an incident |
