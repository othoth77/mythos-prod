# STC-2 — Status Center live monitor (`projects/status-center/monitor/`)

**Created:** 2026-08-21 (post-audit execution phase, Phase 2). Closes the
audit's §9.1 finding: the Status Center was a curated record with no real
monitoring — a service could go down while the page still said LIVE.

## Architecture

```
probes.json (registry)            per service: health check
        │
bin/monitor.js (collector)        HTTP/TLS · TCP · resources · backup health
        │
<out>/live-history/YYYY-MM.jsonl  immutable append-only history
<out>/live-history/alerts.jsonl   state transitions (failure detection)
<out>/live-status.json            atomic snapshot consumed by the UI
        │
sites/status.mythosprod.xyz       "Live services" section (renders states,
                                  latency, HTTP, cert days, last check,
                                  history dots, error detail)
```

States are **computed, never curated**: `LIVE`, `DEGRADED` (met with a
warning — e.g. TLS certificate < 21 days, disk above soft threshold,
backup success older than 26 h), `DOWN` (failure, timeout, unexpected
status, cert < 7 days, backup success older than 50 h or absent),
`NOT_MONITORED` (probe shipped disabled pending operator confirmation —
honest grey, never guessed green). A stale `generated_at` (> 15 min)
makes the UI flag the monitor itself as down. The collector is read-only
against every target, credential-free, shell-out-free, and writes only
inside `--out`.

## Monitored targets (see `probes.json`)

mythosprod.xyz (hub apex — currently reports DOWN honestly, the hub is
undeployed) · os.mythosprod.xyz · ordre.mythosprod.xyz ·
status.mythosprod.xyz `/health.json` · n8n.ssangyong.autos ·
ssangyong.autos storefront · SYA catalog API (**disabled** until the
operator confirms the real health path) · idauto-postgres (**disabled**
until the operator confirms a host-reachable port — deploy is
deliberately outside the docker group) · VPS disk/memory/**swap**/load ·
the off-host backup system (via `ops/backup`'s health record).

The resources probe reports `swap_used_pct` and `swap_free_gb` alongside
disk, memory and load. Swap is **reported but not judged** by default: it
legitimately fills with cold pages on healthy hosts, so alarming on it
out of the box would be noise. Set `swap_warn_pct` on the `vps-resources`
probe to make exhaustion DEGRADED — `0` means "warn at any swap use" and
is honoured as written. Hosts with no swap, and any host where
`/proc/meminfo` cannot be read, report both fields as `null` and are never
penalised for it.

## Operator installation (on the VPS, after the site is deployed)

```bash
sudo bash /home/deploy/projects/mythos-prod/projects/status-center/monitor/install.sh
```

Fail-closed preflight (node present, `node --check`, docroot exists,
`systemd-analyze verify`), installs `mythos-status-monitor.timer`
(every 5 min), runs one supervised snapshot and verifies
`live-status.json` exists. Rollback:
`sudo systemctl disable --now mythos-status-monitor.timer`.

Notes:
- `scripts/deploy-status-center.sh` rsyncs the site with `--delete`; a
  redeploy removes `live-status.json` for at most one monitor interval
  (≤ 5 min) until the next snapshot rewrites it. The UI renders the
  documented "no live monitor data" note during that window.
- To enable the two shipped-disabled probes, edit
  `projects/status-center/monitor/probes.json` in a normal reviewed
  commit (never on-host drift), set `"enabled": true` with the confirmed
  target, and redeploy.

## Local / ad-hoc run

```bash
node projects/status-center/monitor/bin/monitor.js \
  --config projects/status-center/monitor/probes.json --out /tmp/stc2-out
```

Exit 0 = ran and wrote output (states may still be DOWN — that is data,
not an error); exit 1 = usage/environment failure.

## Tests

`tests/stc-2-monitor-test.js` (offline, mock HTTP servers): expected/
unexpected status, body substring, timeout, TCP up/down, disabled →
NOT_MONITORED, backup-health translation (ok/stale/missing → LIVE/
DEGRADED/DOWN), resource probe shape, atomic snapshot + summary,
append-only history, alert emission on state transitions, history_tail,
UI data-contract fields, unit-file contract, and static safety
(read-only, no credentials, no shell-out).
