# Mythos OS — Final Production Closure Report

**Audit date:** 2026-08-22 (17:48–17:54 UTC)
**Host:** `vps-4722f0a9` (51.68.226.211)
**Scope:** read-only audit of the production state after the Mythos Hub Dashboard deployment.
Nothing was deployed, restarted, modified or merged to produce this report.

---

# Executive status

**REPOSITORY:** ✅ `main` @ `33696dcbe4741ede586c571c36f19b290576f050`, working tree clean, 0 ahead / 0 behind `origin/main`.

**HOST:** ✅ 0 failed systemd units. Uptime 4 h. Disk 73 % used, 20 G free. `nginx -t` passes.

**PRODUCTION:** ✅ Operational. All four audited Mythos endpoints answer; 10 of 12 monitored surfaces LIVE, 0 DEGRADED, 0 DOWN, 2 NOT_MONITORED by design.

---

# Deployment

| Field | Value |
|---|---|
| Deployed commit | `33696dcbe4741ede586c571c36f19b290576f050` |
| Deployed at | 2026-08-22T17:49:03Z |
| Application / version | `mythos-hub` 1.0.0 |
| Repository parity | served content byte-identical to `origin/main` |

**Last production commits**

```
33696dc (HEAD -> main, origin/main) feat(monitor): report swap headroom in the resources probe (B8)
d2fb479 Merge pull request #77 from othoth77/feat/hub-dashboard
21da41c hub: refuse to certify health from a stale snapshot
f508642 hub: make mythosprod.xyz the Mythos Hub Dashboard
99ef70b fix(gates): make three production closure gates trustworthy (B2, B3, B4)
c4416db docs(othk): OTHK-PROD-VERIFIED — on-host live gate PASS on the production VPS
ef91aa0 Merge pull request #75 from othoth77/backup-production-capture-finalize
```

**Services deployed / active:** nginx, `mythos-status-monitor.timer`, `mythos-git-push.timer`,
`mythos-backup.timer`, `mythos-backup-verify.timer`, `mythos-restore-test.timer`.

---

# Mythos Hub

**Status: LIVE.**

| Check | Result |
|---|---|
| `https://mythosprod.xyz/` | 200, TLS verify 0 |
| `https://www.mythosprod.xyz/` | 200 |
| `http://mythosprod.xyz/` | 301 → HTTPS |
| Certificate | `CN=mythosprod.xyz`, Let's Encrypt, SAN apex + www, valid to **2026-11-20** (89 d) |
| `/health.json` | 200 — head `33696dc…`, `deployed_at 2026-08-22T17:49:03Z` |
| `/api/status.json` | 200 — **12 checks**, LIVE 10 · DEGRADED 0 · DOWN 0 · NOT_MONITORED 2 |
| Feed freshness at audit | 4 min old → tier `FRESH` (gate threshold 15 min) |

The freshness gate is present in the served bundle and verified against production data:
a snapshot older than 15 min degrades, older than 60 min is withheld, and a stale
`LIVE` can never roll up to healthy while a stale `DOWN` is still reported.

---

# Backup

**Status: operational. Not run, not modified during this audit.**

| Field | Value |
|---|---|
| Installed binary | `1c3dfaa63af7b42b117f11c6ed1960263bfb116633998bad9d783c687e3a444f` |
| Binary parity | byte-identical to `origin/main` ✅ |
| Ownership / mode | `root:root` `0700`, 20 616 bytes |
| Archive | `/var/backups/mythos` `root:root 0700` — 9 dumps retained |
| Hand-off | `/home/deploy/mythos-backups/db-dumps` `deploy:deploy 0700` — exactly 1 file (contract holds) |
| Config / credential | both `deploy:deploy 0600` |

**Timers**

| Timer | Active | Enabled | Next |
|---|---|---|---|
| `mythos-backup.timer` | active | enabled | Sun 2026-08-23 03:35 UTC |
| `mythos-backup-verify.timer` | active | enabled | Sun 2026-08-23 15:12 UTC |
| `mythos-restore-test.timer` | active | enabled | Tue 2026-09-01 05:09 UTC |

**Last executions**

- Backup: `backup completed clean` — 2026-08-22 15:23:20 UTC
- Capture: `capture complete` — database 15:22:48Z, media 15:22:49Z
- Verify (R2 remote): `verify completed clean` — 2026-08-22 16:02:11 UTC

**R2 / off-host:** last successful remote verification `2026-08-22T16:02:11Z`,
`status=ok`, `exit_code=0`, `consecutive_failures=0`, prefix `mythos`, duration 5 s.
No credential value was read or printed at any point in this audit.

---

# Monitoring

**Status: healthy.** `mythos-status-monitor.timer` active + enabled, last run `success`, cadence 5 min.

- **Probes defined:** 12 — **enabled 10**, disabled 2 (`sya-api`, `database`)
- **Published checks:** 12 — LIVE 10 · DEGRADED 0 · DOWN 0 · NOT_MONITORED 2
- **Failures:** 0 · **Warnings:** 0 · **Stale data:** none (snapshot 4 min old, `FRESH`)

**Hub probes — 3/3 present and LIVE**

| Probe | Target | State |
|---|---|---|
| `hub-apex` | `https://mythosprod.xyz/` | LIVE (200, cert 89 d) |
| `hub-dashboard-health` | `https://mythosprod.xyz/health.json` | LIVE (200) |
| `hub-status-endpoint` | `https://mythosprod.xyz/api/status.json` | LIVE (200) |

Remaining probes: `os-console` LIVE (cert 85 d), `ordre` LIVE (85 d), `status-center` LIVE (87 d),
`n8n-sya` LIVE (46 d), `sya-site` LIVE (44 d), `vps-resources` LIVE, `backup-system` LIVE.
`sya-api` and `database` report `NOT_MONITORED` — an honest declaration, not a silent green.

---

# Security

All checks **PASS**.

| Control | Result |
|---|---|
| GitHub runner service | PASS — active |
| Governance relay last result | PASS — `success` |
| Governance relay timer | PASS — active |
| `docker.sock` ownership/mode | PASS — `root:docker 660` |
| `deploy` **not** in `docker` group | PASS — privilege boundary intact |
| `deploy` sudo boundary | PASS — scoped to `nginx -t`, `systemctl reload nginx`, `certbot`; no shell, no docker, no backup |
| Root-only capture binary | PASS — `root:root 0700` |
| Credential files | PASS — `0600`, owned by `deploy` |
| Failed systemd units | PASS — 0 |

**Runner:** active. **Governance:** relay operational; all commits on `main` approved
(`governance: ok (0 protected commit(s), all approved)`). One mission branch
(`mythos/m-msy4a8iz…`) remains denied for an unapproved protected change — the gate
working as designed, not a fault.

---

# Nginx and domains

`nginx -t` — **syntax OK, test successful**. 7 warnings, all the same pre-existing cause
(`conflicting server name "darhijama.tn"` / `www.darhijama.tn` on :80 and :443) from two
DarHijama vhosts being enabled simultaneously. Unrelated to Mythos; not modified.

| Domain | HTTP | Certificate |
|---|---|---|
| `mythosprod.xyz` | 200 | 89 d |
| `os.mythosprod.xyz` | 302 (`/login` → 200) | 85 d |
| `ordre.mythosprod.xyz` | 200 | 85 d |
| `status.mythosprod.xyz` | 200 (`/health.json` → 200) | 87 d |

---

# Remaining issues

| Issue | Priority | Impact | Recommended action |
|---|---|---|---|
| `sya-api` probe disabled — catalog API unmonitored and reportedly down since 2026-08-16 | **P1** | A real service has no health signal; `NOT_MONITORED` is honest but blind | Confirm the true read-only health path (SYA-API-1), keep `expect_content_type`, then enable |
| `database` probe disabled (`idauto-postgres`) | **P1** | The database the backup depends on has no liveness probe | Enable the TCP probe against `127.0.0.1:5432` |
| 6 stale open PRs (#68, #69, #71, #72, #73, #74) | **P1** | Review debt; #71 explicitly superseded by #75 | Triage: close superseded, rebase or close the rest |
| `erp.mythosprod.xyz` has no DNS record | **P1** | Preserved ERP has no route; Hub card says so honestly | Owner DNS action, then vhost + certificate |
| Shared checkout is reset to `main` by `mythos-ai-executor` | **P1** | Branch work in `/home/deploy/projects/mythos-prod` is not durable; caused one lost checkout and one stale-file regression this session | Use a dedicated worktree for all branch work, or give the executor its own clone |
| 7 nginx warnings — duplicate `darhijama.tn` vhost | **P2** | Cosmetic; nginx ignores the duplicate | Remove `darhijama.tn.disabled-20260729-171012` from `sites-enabled` |
| `health.json` `"status"` is a constant `"ok"` | **P2** | Field name over-promises; probe deliberately matches `"application"` instead | Rename to a liveness marker or compute it |
| No regression tests for the backup hardening (parser, allowlist, JSON escaper, archive guard) | **P2** | Hardening is unpinned by tests | Fold the 34 ad-hoc checks into `tests/backup-scheduler-test.js` |
| JSON endpoints drop inherited security headers | **P2** | `nosniff`/`no-store` restated; CSP/XFO absent on JSON bodies | Restate the full header set in both `location` blocks |
| Merged branches still present (`feat/hub-dashboard`, `backup-production-capture-finalize`, `hub-apex-platform-entry-point`) | **P2** | Repository clutter | Delete after a retention window |
| Rollback artifacts in `/root` (~460 KB) | **P2** | Deliberate retention | Keep until the next backup cycle proves stable, then remove |

**P0 (production blocker): none.**

### Rollback artifacts retained

| Artifact | Purpose |
|---|---|
| `/root/www-mythosprod.xyz.bak-20260822-predashboard` (404 K) | Pre-dashboard site |
| `/root/nginx-mythosprod.xyz.bak-20260822-pre-dashboard` | Pre-dashboard vhost |
| `/root/mythos-backup-capture.pre-hardening-20260822` | Pre-hardening capture binary |
| `/root/mythos-backup-dirty-preserve-20260822-142300` (52 K) | Uncommitted backup work, pre-commit |
| `/root/dashboard.js.stale-leftover-20260822` | Discarded pre-gate `dashboard.js` |

---

# Final verdict

## PRODUCTION OPERATIONAL WITH NON-BLOCKING ITEMS

Every production surface audited is healthy: repository synced and clean, Hub live on TLS with a
working freshness gate, all three Hub probes green, backup operational with a verified R2 object
and untouched hardening, governance relay passing, and zero failed units.

It is deliberately **not** declared `PRODUCTION CLOSED`. Two monitored surfaces (`sya-api`,
`database`) are blind by configuration rather than by measurement, six pull requests remain
open and unreviewed, and the preserved ERP still has no route. None of these blocks operation,
but calling the system closed while a known-down API and the production database carry no health
signal would be the kind of silent green this stack is explicitly built to refuse.
