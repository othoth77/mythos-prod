# Facebook Ads Monitor (META-ADS-MONITOR-0)

**Facebook Ads Monitor is READ-ONLY by design.**

An unattended, hourly read of the owner's Meta (Facebook) ad accounts, running
on the VPS as a systemd timer. It reads accounts, campaigns, ad sets, ads,
status, spend, budgets, results and cost metrics, plus 60 days of per-campaign
daily history (spend, impressions, clicks, results — today included, in the
account's timezone), compares them with the previous run, and writes a
plain-language report. Its snapshots are the data source of the Ads Mythos
dashboard (othoth77/ads-mythos), which never holds a Meta credential itself.

**Results** are Meta's own `results` metric — the Results column of Ads
Manager (the campaign's optimisation event, e.g. messaging conversations
started) — never the sum of every action type (engagement, message depth and
link clicks would be counted several times over). It never creates,
edits, pauses, activates or deletes anything, and it performs no optimisation.

## Why a separate VPS monitor

- Claude Desktop Routines run on the owner's Windows machine, not on the VPS,
  and never started a session for this job (2026-09-15 → 17), so they are not a
  dependency of this system.
- The Meta Ads MCP connector exists only inside Claude sessions. Its write
  tools stay **denied** in `/root/.claude/settings.json` (41 tools); `ask`
  rules do not gate connector tools, `deny` rules do (tested 2026-09-17).
- The Claude CLI on the host (`~deploy/.local/bin/claude`) has an expired
  OAuth session, so an unattended Claude run cannot reach the connector either.
- Therefore the monitor talks to the Meta Graph API directly, with a
  **read-only token** and a **GET-only client**.

## Read-only, three independent layers

1. **Code** — `lib/graph.js` is the only network path. The HTTP method is a
   constant `GET`; paths must match an allowlist (`me/adaccounts`, `act_<id>`,
   `act_<id>/{campaigns,adsets,ads,insights}`); the verb-override parameters
   Graph honours (`method`, `_method`) and `access_token`/`batch` are refused
   before any request; redirects are refused; the client exports only `get`/`getAll`/`cancel`. The test suite
   statically scans every file for non-GET methods and write verbs.
2. **Token** — the owner creates a token with the `ads_read` permission only;
   Meta itself rejects writes made with it.
3. **Host** — the systemd unit is sandboxed (`ProtectSystem=strict`, writes
   only to its state directory, no capabilities, `MemoryMax=256M`).

## Files

```
bin/meta-ads-monitor.js      run | run --fixture <file> [--now <ISO>] | status
lib/graph.js                 GET-only Graph client: allowlist, timeout 30 s, 3 retries (2/10/30 s backoff), cursor paging
lib/collect.js               one snapshot, explicit field allowlists, budgets converted from minor units
lib/diff.js                  findings: what works, changes vs previous, attention, delivery, review
lib/report.js                Arabic Markdown report for the owner
lib/store.js                 state, atomic 0600 writes, secret scan, retention, duplicate-run lock
lib/config.js                secret file loading (mode 600 enforced)
systemd/meta-ads-monitor.service|timer
tests/meta-ads-monitor-test.js  (repo root) — offline, 118 assertions
```

## Secret (owner step)

```
~deploy/.config/meta-ads-monitor/meta.env     mode 600, owner deploy
META_ADS_READ_TOKEN=<token with ads_read only>
META_ADS_ACCOUNT_IDS=4176121335962594          optional; default = every account the token sees
META_GRAPH_VERSION=v24.0                        optional
```

Recommended token: Meta Business Settings → Users → System users → add a
system user → assign the ad account with **view/analyse** access only →
Generate token with only `ads_read`. Without this file every run writes a short
"not configured" report and makes **no** Meta request (state `NOT_CONFIGURED`).
A file readable by group/others is refused (`CONFIG_INSECURE`).

## Runtime state (outside Git)

```
~deploy/.local/state/meta-ads-monitor/
  reports/YYYY-MM-DD.md        the daily report (keep 90 days / max 120)
  snapshots/<UTC stamp>.json   previous-run memory + daily history, allowlisted fields only (keep 60 days / max 200)
  status.json                  state OK | NOT_CONFIGURED | CONFIG_INSECURE | CONFIG_INVALID | FAILED,
                               last_success_at, consecutive_failures, last_error (redacted)
  run.lock                     duplicate-run protection (stale after 2 h or dead pid)
```

Every file is written atomically and mode 0600; every payload passes a secret
scan (the live token, `EAA…` tokens, `access_token=`, bearer strings) before it
reaches disk. Reports are stored locally: Google Drive is reachable only from
Claude sessions (connector), not from the VPS — recorded limitation.

## Schedule and failure handling

- Timer: hourly at `:40 UTC` + up to 5 min jitter (≈ 8 GET requests per run),
  `Persistent=true` (a run missed while the host was down runs at boot). The
  report file is per day and rewritten by each run of that day.
- Per request: 30 s timeout, 3 retries on 5xx / 429 / Graph throttling codes.
  Whole run: 10 min deadline inside the process, `TimeoutStartSec=15min`.
- A section that still fails is listed as "data not available" in the report;
  if every section fails the run is `FAILED` (exit 1, journal line, previous
  snapshot kept, `consecutive_failures` incremented) and the next run retries.
- Exit 75 = another run holds the lock (`SuccessExitStatus=75`, not a failure).

## Install / operate (root)

```bash
install -d -o deploy -g deploy -m 700 /home/deploy/.local/state/meta-ads-monitor
install -m 644 projects/meta-ads-monitor/systemd/meta-ads-monitor.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now meta-ads-monitor.timer
systemctl start meta-ads-monitor.service      # one manual run
journalctl -u meta-ads-monitor.service -n 20
sudo -u deploy node projects/meta-ads-monitor/bin/meta-ads-monitor.js status
```

Rollback: `systemctl disable --now meta-ads-monitor.timer` and remove the two
unit files; the state directory can be deleted at any time (no other consumer).

## Tests

```bash
node tests/meta-ads-monitor-test.js      # offline, no network, temp state dir
```
