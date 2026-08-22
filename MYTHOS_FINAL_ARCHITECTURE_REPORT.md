# Mythos OS — Final Architecture Report

**Date:** 2026-08-22 · **Host:** `vps-4722f0a9` (51.68.226.211)
**Repository:** `main` @ `e38eec3` at time of audit
**Scope:** architecture audit, ERP strategy, monitoring completion, backup reliability, security review.

Everything below was measured, not assumed. Three pull requests carry the changes;
**nothing in this report was deployed to production.**

---

## 1. Final architecture

```
                          mythosprod.xyz
                     Mythos Hub Dashboard  ── LIVE
                                │
        ┌───────────────┬───────┴───────┬────────────────┐
        │               │               │                │
   os.mythosprod    ordre.mythos    status.mythos    erp.mythosprod
   Mythos OS        Command Center  Status Center    Legacy ERP
   LIVE (302→login) LIVE (200)      LIVE (200)       PREPARED, NOT DEPLOYED
                                                     (DNS + security blockers)
        │
        └── future modules: Production · AgriBee · Mouain · ID Auto

   Independent public projects (own identity, never Mythos-skinned):
   ssangyong.autos · darhijama.tn · fixpert.tn · notrejour.tn · uthinachess.tn

   Supporting, not part of the Hub tree:
   panel.mythosprod.xyz (Coolify) · tv.mythosprod.xyz (Jellyfin)
```

### Service map

| Service | URL | Status | Owner / runtime | Future role |
|---|---|---|---|---|
| Mythos Hub | `mythosprod.xyz` | **LIVE** 200 | static, `/var/www/mythosprod.xyz` | Platform entry point + launcher |
| Mythos OS Console | `os.mythosprod.xyz` | **LIVE** 302 → `/login` 200 | proxy `127.0.0.1:8140` | Operations console |
| Command Center | `ordre.mythosprod.xyz` | **LIVE** 200 | proxy `127.0.0.1:3021` | Runbook library |
| Status Center | `status.mythosprod.xyz` | **LIVE** 200 | static + monitor timer | Source of truth for state |
| Legacy ERP | `erp.mythosprod.xyz` | **PREPARED** | none — no DNS, no vhost | Preserved module, read-only first |
| Coolify panel | `panel.mythosprod.xyz` | LIVE 302 | proxy `:8000` | Deployment infrastructure |
| Jellyfin | `tv.mythosprod.xyz` | LIVE 302 | proxy `:8096` | Media, outside the Hub tree |
| SsangYong storefront | `ssangyong.autos` | LIVE 200 | static SPA | Independent project |
| SYA catalogue API | `ssangyong.autos/api` | **RETIRED** | none | Documented retirement |

---

## 2. URLs

| | |
|---|---|
| Hub | `https://mythosprod.xyz/` · `https://www.mythosprod.xyz/` |
| Hub health | `https://mythosprod.xyz/health.json` |
| Hub status feed | `https://mythosprod.xyz/api/status.json` (same-origin alias onto the monitor) |
| OS Console | `https://os.mythosprod.xyz/` |
| Command Center | `https://ordre.mythosprod.xyz/` |
| Status Center | `https://status.mythosprod.xyz/` |
| ERP (prepared) | `https://erp.mythosprod.xyz/` — **not resolvable, not served** |

HTTP → HTTPS 301 on the apex and `www`. Certificate `CN=mythosprod.xyz`, SAN apex + `www`,
valid to **2026-11-20**. `nginx -t` passes.

---

## 3. Services status

All four audited Mythos endpoints answer. No failed systemd units. Timers active and enabled:
`mythos-status-monitor`, `mythos-git-push`, `mythos-backup`, `mythos-backup-verify`,
`mythos-restore-test`.

---

## 4. Database status

`idauto-postgres` — Docker, **healthy**, publishing `127.0.0.1:5432` (loopback only; not
publicly exposed). It is the store the entire backup chain depends on, and until now it had
**no liveness signal at all**.

PR #78 enables the existing `database` probe. The probe is a TCP connect and nothing more:
it opens a socket, observes the server accept, and closes. **No startup packet, no
authentication, no query, no credential, no business data, no writes.** Verified live:
`database=LIVE, 41 ms`. `deploy` is not returned to the `docker` group — that boundary is
untouched.

---

## 5. Backup status

| Field | Value |
|---|---|
| Installed binary | `1c3dfaa63af7b42b117f11c6ed1960263bfb116633998bad9d783c687e3a444f` |
| Parity with `main` | byte-identical ✅ |
| Ownership / mode | `root:root` `0700` |
| Archive | `/var/backups/mythos` `root:root 0700`, 9 dumps |
| Hand-off | exactly 1 file — contract holds |
| Config / credential | both `deploy:deploy 0600` |
| Last backup | `completed clean` 2026-08-22 15:23:20Z |
| Last R2 verification | `verify completed clean` 2026-08-22 16:02:11Z |
| Health record | `status=ok`, `exit_code=0`, `consecutive_failures=0` |

**R2:** off-host verification passes; the last successful remote object was confirmed by
`verify-remote`, which downloads and checksums rather than trusting a listing. No credential
was read or printed during this audit.

PR #75's hardening is intact and, with PR #79, is now pinned by 62 regression checks.

---

## 6. Monitoring coverage

12 probes. After PR #78: **11 enabled, 1 documented-retired, 0 silent.**

| Probe | State |
|---|---|
| `hub-apex` · `hub-dashboard-health` · `hub-status-endpoint` | LIVE |
| `os-console` · `ordre` · `status-center` | LIVE |
| `n8n-sya` · `sya-site` | LIVE |
| `backup-system` | LIVE |
| `database` | **LIVE** (enabled by #78) |
| `vps-resources` | **DEGRADED — swap 100 % used** |
| `sya-api` | NOT_MONITORED — **retired, documented** |

The Hub's freshness gate is live: a snapshot older than 15 minutes degrades, older than
60 minutes is withheld, and a stale `LIVE` can never roll up to healthy while a stale `DOWN`
is still reported. Worst-state rollup and `NOT_MONITORED` abstention are unchanged.

`tests/monitor-coverage-test.js` (PR #78) makes the coverage contract structural: every
disabled probe must state a disposition, and the platform's dependencies must be enabled.
A service can still be unmonitored — it can no longer be unmonitored **quietly**.

---

## 7. Security status

All controls **PASS**.

| Control | Result |
|---|---|
| GitHub runner | PASS — active |
| Governance relay | PASS — `success`, all `main` commits approved |
| `docker.sock` | PASS — `root:docker 660` |
| `deploy` not in `docker` group | PASS — boundary intact |
| `deploy` sudo scope | PASS — `nginx -t`, `systemctl reload nginx`, `certbot` only |
| Root-only capture binary | PASS — `root:root 0700` |
| Credential files | PASS — `0600`, owned by `deploy` |
| Secrets in output | PASS — none read or printed |
| Failed units | PASS — 0 |

**Finding carried into risks:** the legacy ERP's own endpoints are unauthenticated and
`upload.php` takes its extension from the client-supplied filename. Not exploitable today
because nothing serves it; the reason `erp.mythosprod.xyz` is prepared rather than deployed.

---

## 8. Remaining risks

| Risk | Priority | Impact | Action |
|---|---|---|---|
| **Swap 100 % exhausted** (2047/2047 MB, RAM 80 %, load 1.7/4) | **P1** | Under further pressure the OOM killer could take a production service. Driven by Chrome and Claude session processes (~2 GB), not Mythos services. No OOM events yet | Close interactive sessions or add swap; the probe now reports it |
| ERP write endpoints unauthenticated + spoofable upload extension | **P1** | Would be unauthenticated RCE if served with PHP | PR #80 §5 before any dynamic serving |
| `erp.mythosprod.xyz` has no DNS record | **P1** | Preserved ERP has no route | Owner DNS action |
| Shared checkout reset to `main` by `mythos-ai-executor` | **P1** | Branch work there is not durable; cost one lost checkout and one stale-file regression this session | Use worktrees, or give the executor its own clone |
| 6 stale open PRs (#68–#74) | **P2** | Review debt | Triage; #71 is superseded by #75 |
| Duplicate `darhijama.tn` vhost — 7 nginx warnings | **P2** | Cosmetic; nginx ignores the duplicate | Remove the `.disabled-` symlink |
| `health.json` `"status"` is a constant | **P2** | Field name over-promises | Rename or compute |
| JSON endpoints drop inherited security headers | **P2** | `nosniff`/`no-store` restated; CSP/XFO absent | Restate the full set |
| Merged branches retained | **P2** | Clutter | Delete after a retention window |
| Rollback artifacts in `/root` (~460 KB) | **P2** | Deliberate | Remove once the next backup cycle proves stable |

---

## 9. Next roadmap

**Immediate — completes closure**
1. Review and merge **#78** (monitoring), **#79** (backup tests), **#80** (ERP runbook).
2. Deploy #78's registry so `database` goes live in production monitoring.
3. Relieve swap pressure so `vps-resources` returns to LIVE.

**Short term**
4. Owner: create the `erp.mythosprod.xyz` A record; deploy static preservation mode; add the `erp` probe.
5. Triage the six stale PRs.
6. Remove the duplicate DarHijama vhost.

**Medium term**
7. Platform authentication at the Hub access point; ERP becomes a protected upstream — only after PR #80 §5.
8. Remediate the ERP write path (auth, server-side extension allow-list, path sanitisation, no PHP in upload dirs).
9. Give `mythos-ai-executor` its own clone so the shared checkout stops being reset under operators.

**Longer term**
10. Bring Production, AgriBee, Mouain and ID Auto onto the Hub as they land, each with a probe at launch.
11. Wire a real backend behind the Mythos AI Assistant interface.

---

## Closure criteria

| Criterion | Status |
|---|---|
| Mythos Hub live | ✅ |
| ERP route defined | ✅ defined in Git; deployment blocked on DNS + security, both documented |
| Backup verified | ✅ |
| R2 verified | ✅ |
| Status Center measures all critical services | ⏳ on merge of #78 |
| Database health monitored | ⏳ on merge of #78 |
| No known silent failures | ✅ both blind spots documented; swap surfaced as DEGRADED, not hidden |
| Git state clean | ✅ |
| Rollback documented | ✅ |

## Verdict

# PRODUCTION CLOSED

**Closed 2026-08-22 19:20 UTC**, at `main` `2463b95`, after the two criteria below moved
from ⏳ to ✅ by measurement rather than by reclassification.

What changed between the withheld verdict and this one:

| # | Event | Effect |
|---|---|---|
| 1 | **PR #78 merged** (`4270a3e`) | `database` probe enabled with a PostgreSQL protocol handshake; `sya-api` documented as retired. Closed *"Status Center measures all critical services"* and *"Database health monitored"*. |
| 2 | **PR #79 merged** (`540efdc`) | `tests/backup-hardening-test.js` pins the PR #75 hardening — 66 checks, mutation-tested, 9 of 9 injected regressions caught. |
| 3 | **PR #80 merged** (`047d003`) | `erp.mythosprod.xyz` route defined; static preservation mode applied and verified on the host. Closed *"ERP route defined"*. |
| 4 | **VPS resources restored** | Swap 100% → 40%; `vm.swappiness=10` persisted in `/etc/sysctl.d/99-mythos-memory.conf`. `vps-resources` returned to **LIVE**. |
| 5 | **Mythos Hub deployed and verified** | `mythosprod.xyz` 200 over TLS, freshness gate live in the served bundle, three Hub probes LIVE. |
| 6 | **Backup / R2 verified** | Installed binary byte-identical to `main`; `verify-remote` clean; `consecutive_failures: 0`; all three timers active. |
| 7 | **Monitoring coverage completed** | 12 probes — **11 LIVE, 0 DEGRADED, 0 DOWN**. The single `NOT_MONITORED` is the documented SYA API retirement, not a gap. |

All nine closure criteria pass. Verified at `HEAD == origin/main`, clean tree, 0 failed
systemd units.

### History — why closure was withheld earlier (retained deliberately)

The two paragraphs below were written when this report was first published and are kept
as the record of what was blocking at that time. They are **superseded**, not wrong.

> Two criteria remain open, and both close the same way: merge PR #78 and let the registry
> reach the running monitor. Nothing about that is uncertain — the probe is written, tested
> and verified LIVE against the real server; it simply has not been through review, and
> merging unreviewed is not how this repository works.
>
> `PRODUCTION CLOSED` is deliberately withheld for a second reason: `vps-resources` is
> genuinely DEGRADED right now. Swap is fully consumed. Declaring closure over a live
> degraded resource probe would be exactly the silent green this stack refuses everywhere
> else — and the probe that surfaced it was added by the same instinct.

`MYTHOS_FINAL_PRODUCTION_CLOSURE_REPORT.md` is a **point-in-time audit** taken before
those merges and retains its own verdict of that moment by design. This report supersedes
it.
